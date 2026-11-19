"use client";
// Backup și export pentru administratorul firmei: Excel (citibil de om) și ZIP complet (JSON + CSV + Excel + poze).
import { supabase } from "./supabase/client";
import { ABSENCE_TYPE, ASSIGNMENT_STATUS, ENTRY_STATUS, PROJECT_STATUS, ROLE_LABEL, TASK_STATUS } from "./labels";
import { KIND_LABEL } from "./odometer";
import { localDate, localTime } from "./time";
import { toCsv } from "./reports";

type Row = Record<string, unknown>;

/** Tabelele firmei (RLS lasă adminul să le citească pe toate). */
export const TABLES = [
  "companies", "teams", "employees", "employee_private", "memberships", "projects", "tasks", "assignments",
  "time_entries", "time_entry_photos", "absences", "vehicles", "odometer_readings", "extra_trips", "notes",
  "chat_channels", "chat_messages",
] as const;
export type TableName = (typeof TABLES)[number];
export type BackupData = Record<TableName, Row[]>;

async function fetchAll(table: TableName): Promise<Row[]> {
  const out: Row[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase().from(table).select("*").range(from, from + page - 1);
    if (error) {
      // tabele opționale (ex. chat) pe care contul nu le poate citi: le sărim, nu oprim backup-ul
      if (["42501", "42P01", "PGRST205"].includes(error.code ?? "")) return out;
      throw error;
    }
    out.push(...(data as Row[]));
    if (!data || data.length < page) return out;
  }
}

export async function collect(onProgress?: (msg: string) => void): Promise<BackupData> {
  const data = {} as BackupData;
  for (const t of TABLES) {
    onProgress?.(`Se citesc datele: ${LABEL[t]}…`);
    data[t] = await fetchAll(t);
  }
  return data;
}

export const LABEL: Record<TableName, string> = {
  companies: "Firma", teams: "Echipe", employees: "Angajați", employee_private: "Adrese", memberships: "Conturi",
  projects: "Lucrări", tasks: "Misiuni", assignments: "Program", time_entries: "Pontaje", time_entry_photos: "Poze pontaj",
  absences: "Absențe", vehicles: "Mașini", odometer_readings: "Km mașini", extra_trips: "Km extra", notes: "Observații",
  chat_channels: "Conversații", chat_messages: "Mesaje chat",
};

const s = (v: unknown) => (v == null ? "" : String(v));
const hhmm = (v: unknown) => s(v).slice(0, 5);
const yesNo = (v: unknown) => (v ? "da" : "nu");
const ro = (d: unknown) => { const x = s(d); return x.length >= 10 ? `${x.slice(8, 10)}.${x.slice(5, 7)}.${x.slice(0, 4)}` : x; };

export interface Sheet { name: string; columns: string[]; rows: (string | number)[][]; widths?: number[] }

/** Foile citibile: nume în loc de coduri, date în format românesc. */
export function sheets(d: BackupData, tz: string): Sheet[] {
  const byId = (t: TableName) => new Map(d[t].map((r) => [s(r.id), r]));
  const emp = byId("employees"), proj = byId("projects"), task = byId("tasks"), team = byId("teams"), veh = byId("vehicles");
  const name = (m: Map<string, Row>, id: unknown, f = "name") => s(m.get(s(id))?.[f]);
  const addr = new Map(d.employee_private.map((r) => [s(r.employee_id), s(r.home_address)]));
  const role = new Map(d.memberships.map((r) => [s(r.employee_id), ROLE_LABEL[r.role as keyof typeof ROLE_LABEL] ?? s(r.role)]));
  const photos = new Map<string, number>();
  for (const p of d.time_entry_photos) photos.set(s(p.time_entry_id), (photos.get(s(p.time_entry_id)) ?? 0) + 1);
  const hours = (min: unknown) => Math.round(Number(min ?? 0) / 6) / 10;
  const sortBy = <T extends Row>(rows: T[], k: string) => [...rows].sort((a, b) => s(a[k]).localeCompare(s(b[k])));

  return [
    { name: "Angajați", columns: ["Nume", "Telefon", "Meserie", "Echipa", "Rol în aplicație", "Activ", "Șofer", "Mașina", "Program", "Pauză (min)", "Competențe", "Adresa de acasă"],
      widths: [24, 16, 16, 16, 16, 8, 8, 18, 14, 10, 30, 34],
      rows: sortBy(d.employees, "full_name").map((e) => [s(e.full_name), s(e.phone), s(e.trade), name(team, e.team_id), role.get(s(e.id)) ?? "fără cont",
        yesNo(e.active ?? true), yesNo(e.is_driver), name(veh, e.default_vehicle_id), `${hhmm(e.work_start)}–${hhmm(e.work_end)}`, Number(e.break_minutes ?? 60),
        Array.isArray(e.skills) ? (e.skills as string[]).join(", ") : "", addr.get(s(e.id)) ?? ""]) },
    { name: "Echipe", columns: ["Echipa", "Șef de echipă", "Membri"], widths: [20, 24, 60],
      rows: d.teams.map((t) => [s(t.name), name(emp, t.leader_employee_id, "full_name"),
        d.employees.filter((e) => e.team_id === t.id).map((e) => s(e.full_name)).join(", ")]) },
    { name: "Lucrări", columns: ["Lucrare", "Status", "Client", "Persoană de contact", "Telefon contact", "Adresa", "Localitate", "Început", "Termen", "Responsabil", "Descriere"],
      widths: [30, 14, 22, 20, 16, 30, 14, 12, 12, 20, 40],
      rows: sortBy(d.projects, "name").map((p) => [s(p.name), PROJECT_STATUS[p.status as keyof typeof PROJECT_STATUS]?.label ?? s(p.status), s(p.client_name),
        s(p.contact_name), s(p.contact_phone), s(p.address), s(p.city), ro(p.start_date), ro(p.due_date), name(emp, p.manager_employee_id, "full_name"), s(p.description)]) },
    { name: "Misiuni", columns: ["Lucrare", "Misiune", "Status", "Progres %", "Termen", "Descriere"], widths: [30, 26, 14, 10, 12, 40],
      rows: d.tasks.map((t) => [name(proj, t.project_id), s(t.name), TASK_STATUS[t.status as keyof typeof TASK_STATUS]?.label ?? s(t.status), Number(t.progress ?? 0), ro(t.due_date), s(t.description)]) },
    { name: "Program", columns: ["Data", "Angajat", "Lucrare", "Misiune", "De la", "Până la", "Pauză (min)", "Status", "Observații"], widths: [12, 24, 30, 24, 8, 8, 10, 14, 30],
      rows: sortBy(d.assignments, "starts_at").map((a) => [ro(localDate(s(a.starts_at), tz)), name(emp, a.employee_id, "full_name"), name(proj, a.project_id), name(task, a.task_id),
        localTime(s(a.starts_at), tz), localTime(s(a.ends_at), tz), Number(a.break_minutes ?? 0), ASSIGNMENT_STATUS[a.status as keyof typeof ASSIGNMENT_STATUS]?.label ?? s(a.status), s(a.notes)]) },
    { name: "Pontaje", columns: ["Data", "Angajat", "Lucrare", "Misiune", "Început", "Sfârșit", "Pauză (min)", "Ore lucrate", "Status", "Pontat cu butonul", "Loc început", "Loc sfârșit", "Poze", "Observații", "Motiv respingere"],
      widths: [12, 24, 30, 24, 8, 8, 10, 10, 12, 10, 30, 30, 6, 30, 30],
      rows: sortBy(d.time_entries, "started_at").map((t) => [ro(localDate(s(t.started_at), tz)), name(emp, t.employee_id, "full_name"), name(proj, t.project_id), name(task, t.task_id),
        localTime(s(t.started_at), tz), localTime(s(t.ended_at), tz), Number(t.break_minutes ?? 0), hours(t.worked_minutes),
        ENTRY_STATUS[t.status as keyof typeof ENTRY_STATUS]?.label ?? s(t.status), yesNo(t.source === "buton"), s(t.start_address), s(t.end_address),
        photos.get(s(t.id)) ?? 0, s(t.notes), s(t.rejection_reason)]) },
    { name: "Absențe", columns: ["Angajat", "Tip", "De la", "Până la", "Observații"], widths: [24, 18, 12, 12, 30],
      rows: sortBy(d.absences, "start_date").map((a) => [name(emp, a.employee_id, "full_name"), ABSENCE_TYPE[a.type as keyof typeof ABSENCE_TYPE]?.label ?? s(a.type), ro(a.start_date), ro(a.end_date), s(a.note)]) },
    { name: "Mașini", columns: ["Mașina", "Nr. înmatriculare", "Activă", "Șoferi obișnuiți"], widths: [22, 16, 8, 40],
      rows: d.vehicles.map((v) => [s(v.name), s(v.plate), yesNo(v.active), d.employees.filter((e) => e.default_vehicle_id === v.id).map((e) => s(e.full_name)).join(", ")]) },
    { name: "Km mașini", columns: ["Data", "Moment", "Ora", "Mașina", "Nr. înmatriculare", "Șofer", "Km bord", "Observații"], widths: [12, 16, 8, 22, 16, 24, 10, 30],
      rows: [...d.odometer_readings].sort((a, b) => s(a.reading_date).localeCompare(s(b.reading_date)) || (a.kind === "acasa" ? 1 : -1))
        .map((r) => [ro(r.reading_date), KIND_LABEL[(r.kind as "munca" | "acasa") ?? "munca"], r.recorded_at ? localTime(s(r.recorded_at), tz) : "",
          name(veh, r.vehicle_id), name(veh, r.vehicle_id, "plate"), name(emp, r.employee_id, "full_name"), Number(r.km), s(r.note)]) },
    { name: "Km extra", columns: ["Data", "Mașina", "Nr. înmatriculare", "Șofer", "Km", "Sursa", "Început", "Sfârșit", "Traseu / motiv"], widths: [12, 22, 16, 24, 8, 8, 8, 8, 40],
      rows: sortBy(d.extra_trips ?? [], "created_at").map((x) => [ro(x.trip_date), name(veh, x.vehicle_id), name(veh, x.vehicle_id, "plate"), name(emp, x.employee_id, "full_name"),
        Number(x.km), x.source === "gps" ? "GPS" : "manual", x.started_at ? localTime(s(x.started_at), tz) : "", x.ended_at ? localTime(s(x.ended_at), tz) : "", s(x.note)]) },
    { name: "Observații", columns: ["Data", "Lucrare", "Misiune", "Autor", "Text"], widths: [12, 30, 24, 20, 60],
      rows: sortBy(d.notes, "created_at").map((n) => [ro(localDate(s(n.created_at), tz)), name(proj, n.project_id), name(task, n.task_id), s(n.author_name), s(n.body)]) },
  ];
}

export async function excelBlob(d: BackupData, tz: string, companyName: string): Promise<Blob> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "DYASPlanning"; wb.created = new Date();
  wb.title = `Date ${companyName}`;
  for (const sh of sheets(d, tz)) {
    const ws = wb.addWorksheet(sh.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = sh.columns.map((h, i) => ({ header: h, key: String(i), width: sh.widths?.[i] ?? 16 }));
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEA580C" } };
    sh.rows.forEach((r) => ws.addRow(r));
    if (sh.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sh.columns.length } };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

/** Backup complet: date brute (JSON, pentru restaurare), CSV pe fiecare tabel, Excel, opțional pozele. */
export async function zipBlob(d: BackupData, tz: string, companyName: string, opts: { photos: boolean; onProgress?: (msg: string) => void }): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");
  const files: Record<string, Uint8Array> = {};
  const stamp = new Date().toISOString();
  files["backup.json"] = strToU8(JSON.stringify({ app: "DYASPlanning", version: 1, created_at: stamp, company: companyName, tables: d }, null, 1));
  for (const t of TABLES) {
    const rows = d[t];
    const cols = rows.length ? Object.keys(rows[0]) : [];
    files[`tabele/${t}.csv`] = strToU8(toCsv(cols, rows.map((r) => cols.map((c) => { const v = r[c]; return v != null && typeof v === "object" ? JSON.stringify(v) : (v as string | number | null) ?? ""; }))));
  }
  opts.onProgress?.("Se pregătește fișierul Excel…");
  files["date_firma.xlsx"] = new Uint8Array(await (await excelBlob(d, tz, companyName)).arrayBuffer());
  let photoCount = 0, photoFail = 0;
  if (opts.photos) {
    const list = [
      ...d.time_entry_photos.map((p) => ({ bucket: "pontaj", path: s(p.path) })),
      ...d.chat_messages.filter((m) => m.attachment_path).map((m) => ({ bucket: "chat", path: s(m.attachment_path) })),
    ];
    for (const bucket of ["pontaj", "chat"]) {
      const paths = list.filter((x) => x.bucket === bucket).map((x) => x.path);
      for (let i = 0; i < paths.length; i += 50) {
        const chunk = paths.slice(i, i + 50);
        const { data } = await supabase().storage.from(bucket).createSignedUrls(chunk, 600);
        for (const it of data ?? []) {
          opts.onProgress?.(`Se descarcă pozele și mesajele vocale: ${photoCount + photoFail + 1} din ${list.length}…`);
          try {
            if (!it.signedUrl) throw new Error("fără acces");
            const res = await fetch(it.signedUrl);
            if (!res.ok) throw new Error(String(res.status));
            files[`fisiere/${bucket}/${it.path}`] = new Uint8Array(await res.arrayBuffer());
            photoCount++;
          } catch { photoFail++; }
        }
      }
    }
  }
  files["CITESTE-MA.txt"] = strToU8([
    `Backup DYASPlanning — ${companyName}`,
    `Creat: ${new Date(stamp).toLocaleString("ro-RO", { timeZone: tz })}`,
    "",
    "date_firma.xlsx   — toate datele, citibile, câte o foaie pe categorie (se deschide în Excel / Google Sheets).",
    "tabele/*.csv      — fiecare tabel exact cum e în baza de date.",
    "backup.json       — copia completă a datelor, pentru restaurare.",
    opts.photos ? `fisiere/          — pozele de la pontaj și din chat, plus mesajele vocale (${photoCount} fișiere${photoFail ? `, ${photoFail} nu s-au putut descărca` : ""}).` : "fisiere/          — nu sunt incluse (bifează „Include pozele” la backup).",
    "",
    ...TABLES.map((t) => `${LABEL[t].padEnd(16)} ${d[t].length}`),
  ].join("\r\n"));
  return new Blob([zipSync(files, { level: 6 })], { type: "application/zip" });
}

export function counts(d: BackupData): { label: string; n: number }[] {
  return (["employees", "projects", "tasks", "assignments", "time_entries", "absences", "vehicles", "odometer_readings", "extra_trips", "notes", "chat_messages", "time_entry_photos"] as TableName[])
    .map((t) => ({ label: LABEL[t], n: d[t].length }));
}
