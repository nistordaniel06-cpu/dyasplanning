import type { Assignment, Employee, Project, Task, TimeEntry } from "./types";
import { decimalHours } from "./hours";
import { localDate, localTime } from "./time";

export interface HoursRow {
  key: string;
  label: string;
  plannedMinutes: number;
  approvedMinutes: number;
  submittedMinutes: number; // trimise, neaprobate
  draftMinutes: number;
  rejectedMinutes: number;
}

export function plannedMinutes(a: Pick<Assignment, "starts_at" | "ends_at" | "break_minutes">): number {
  return Math.round((new Date(a.ends_at).getTime() - new Date(a.starts_at).getTime()) / 60000) - a.break_minutes;
}

function emptyRow(key: string, label: string): HoursRow {
  return { key, label, plannedMinutes: 0, approvedMinutes: 0, submittedMinutes: 0, draftMinutes: 0, rejectedMinutes: 0 };
}

function addEntry(row: HoursRow, e: TimeEntry) {
  if (e.status === "aprobat") row.approvedMinutes += e.worked_minutes;
  else if (e.status === "trimis") row.submittedMinutes += e.worked_minutes;
  else if (e.status === "ciorna") row.draftMinutes += e.worked_minutes;
  else row.rejectedMinutes += e.worked_minutes;
}

export function aggregateHours(
  by: "employee" | "project",
  assignments: Assignment[],
  entries: TimeEntry[],
  labels: Map<string, string>,
): { rows: HoursRow[]; total: HoursRow } {
  const map = new Map<string, HoursRow>();
  const get = (k: string) => {
    let r = map.get(k);
    if (!r) { r = emptyRow(k, labels.get(k) ?? "—"); map.set(k, r); }
    return r;
  };
  for (const a of assignments) {
    if (a.status === "anulata") continue;
    get(by === "employee" ? a.employee_id : a.project_id).plannedMinutes += plannedMinutes(a);
  }
  for (const e of entries) addEntry(get(by === "employee" ? e.employee_id : e.project_id), e);
  const rows = [...map.values()].sort((x, y) => x.label.localeCompare(y.label, "ro"));
  const total = rows.reduce((t, r) => {
    t.plannedMinutes += r.plannedMinutes; t.approvedMinutes += r.approvedMinutes;
    t.submittedMinutes += r.submittedMinutes; t.draftMinutes += r.draftMinutes; t.rejectedMinutes += r.rejectedMinutes;
    return t;
  }, emptyRow("total", "Total"));
  return { rows, total };
}

/** CSV compatibil cu Excel în limba română: separator „;”, BOM UTF-8, virgulă zecimală. */
export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

export function summaryCsv(rows: HoursRow[], total: HoursRow, firstCol: string): string {
  const line = (r: HoursRow) => [
    r.label, decimalHours(r.plannedMinutes), decimalHours(r.approvedMinutes), decimalHours(r.submittedMinutes),
    decimalHours(r.draftMinutes), decimalHours(r.approvedMinutes - r.plannedMinutes),
  ];
  return toCsv(
    [firstCol, "Ore planificate", "Ore aprobate", "Ore trimise (neaprobate)", "Ore ciornă", "Diferență aprobat − planificat"],
    [...rows.map(line), line(total)],
  );
}

const STATUS_LABEL: Record<string, string> = { ciorna: "Ciornă", trimis: "Trimis", aprobat: "Aprobat", respins: "Respins" };

export function entriesCsv(entries: TimeEntry[], employees: Map<string, Employee>, projects: Map<string, Project>, tasks: Map<string, Task>, tz: string): string {
  const sorted = [...entries].sort((a, b) => a.started_at.localeCompare(b.started_at));
  return toCsv(
    ["Data", "Angajat", "Lucrare", "Misiune", "Început", "Sfârșit", "Pauză (min)", "Ore lucrate", "Status", "Observații"],
    sorted.map((e) => [
      localDate(e.started_at, tz),
      employees.get(e.employee_id)?.full_name ?? "",
      projects.get(e.project_id)?.name ?? "",
      e.task_id ? tasks.get(e.task_id)?.name ?? "" : "",
      localTime(e.started_at, tz),
      localTime(e.ended_at, tz) + (localDate(e.ended_at, tz) !== localDate(e.started_at, tz) ? " (+1 zi)" : ""),
      e.break_minutes,
      decimalHours(e.worked_minutes),
      STATUS_LABEL[e.status] ?? e.status,
      e.notes ?? "",
    ]),
  );
}

export function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
