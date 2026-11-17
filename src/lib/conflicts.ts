import type { Absence, Assignment, Project } from "./types";
import { localDate, localTime } from "./time";

export interface Slot {
  /** id existent (la editare) — se exclude din verificare */
  id?: string;
  key?: string;
  employee_id: string;
  project_id: string;
  starts_at: string;
  ends_at: string;
  status?: string;
}

export type ConflictKind = "suprapunere" | "absenta" | "deplasare";

export interface Conflict {
  kind: ConflictKind;
  /** suprapunere/absență = blocant; deplasare = avertizare */
  blocking: boolean;
  employee_id: string;
  slotKey?: string;
  message: string;
}

const t = (s: string) => new Date(s).getTime();

export function overlaps(a: { starts_at: string; ends_at: string }, b: { starts_at: string; ends_at: string }): boolean {
  return t(a.starts_at) < t(b.ends_at) && t(b.starts_at) < t(a.ends_at);
}

const ABSENCE_LABEL: Record<string, string> = {
  concediu: "concediu",
  medical: "concediu medical",
  absent: "absent",
  alt_motiv: "indisponibil",
};

function sameLocation(a?: Project, b?: Project): boolean {
  if (!a || !b) return true;
  if (a.id === b.id) return true;
  const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
  return norm(a.address) !== "" && norm(a.address) === norm(b.address);
}

/**
 * Verifică alocările propuse față de cele existente, între ele, față de absențe
 * și față de timpul de deplasare între locații diferite.
 */
export function findConflicts(params: {
  proposed: Slot[];
  existing: Assignment[];
  absences: Absence[];
  projects: Project[];
  tz: string;
  travelBufferMinutes: number;
  employeeName?: (id: string) => string;
}): Conflict[] {
  const { proposed, existing, absences, projects, tz, travelBufferMinutes } = params;
  const name = params.employeeName ?? ((id: string) => id);
  const proj = new Map(projects.map((p) => [p.id, p]));
  const editingIds = new Set(proposed.map((p) => p.id).filter(Boolean) as string[]);
  const active = existing.filter((a) => a.status !== "anulata" && !editingIds.has(a.id));
  const out: Conflict[] = [];
  const iv = (s: { starts_at: string; ends_at: string }) => `${localTime(s.starts_at, tz)}–${localTime(s.ends_at, tz)}`;

  proposed.forEach((p, i) => {
    if (p.status === "anulata") return;
    const who = name(p.employee_id);
    // 1. suprapuneri cu alocări existente
    for (const e of active) {
      if (e.employee_id === p.employee_id && overlaps(p, e)) {
        out.push({
          kind: "suprapunere", blocking: true, employee_id: p.employee_id, slotKey: p.key,
          message: `${who} are deja o alocare ${iv(e)} (${proj.get(e.project_id)?.name ?? "altă lucrare"}) în ${localDate(e.starts_at, tz)}.`,
        });
      }
    }
    // 2. suprapuneri între alocările propuse
    for (let j = 0; j < i; j++) {
      const q = proposed[j];
      if (q.status !== "anulata" && q.employee_id === p.employee_id && overlaps(p, q)) {
        out.push({
          kind: "suprapunere", blocking: true, employee_id: p.employee_id, slotKey: p.key,
          message: `${who} are două alocări noi care se suprapun în ${localDate(p.starts_at, tz)} (${iv(q)} și ${iv(p)}).`,
        });
      }
    }
    // 3. absențe / concedii
    const d1 = localDate(p.starts_at, tz), d2 = localDate(new Date(t(p.ends_at) - 1), tz);
    for (const a of absences) {
      if (a.employee_id === p.employee_id && a.start_date <= d2 && a.end_date >= d1) {
        out.push({
          kind: "absenta", blocking: true, employee_id: p.employee_id, slotKey: p.key,
          message: `${who} este în ${ABSENCE_LABEL[a.type] ?? a.type} (${a.start_date} – ${a.end_date}).`,
        });
      }
    }
    // 4. timp de deplasare între locații diferite
    if (travelBufferMinutes > 0) {
      const others = [...active, ...proposed.filter((_, j) => j !== i && proposed[j].status !== "anulata")]
        .filter((o) => o.employee_id === p.employee_id && !overlaps(o, p));
      for (const o of others) {
        const gapAfter = (t(p.starts_at) - t(o.ends_at)) / 60000; // o înainte de p
        if (gapAfter >= 0 && gapAfter < travelBufferMinutes && !sameLocation(proj.get(o.project_id), proj.get(p.project_id))) {
          out.push({
            kind: "deplasare", blocking: false, employee_id: p.employee_id, slotKey: p.key,
            message: `${who}: doar ${Math.round(gapAfter)} min între „${proj.get(o.project_id)?.name ?? "?"}” (până la ${localTime(o.ends_at, tz)}) și „${proj.get(p.project_id)?.name ?? "?"}” — locații diferite, fără timp de deplasare (minim ${travelBufferMinutes} min).`,
          });
        }
      }
    }
  });

  // elimină duplicatele identice
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.kind}|${c.slotKey}|${c.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type DayAvailability =
  | { kind: "absent"; label: string }
  | { kind: "ocupat"; minutes: number }
  | { kind: "liber_partial"; minutes: number }
  | { kind: "disponibil" }
  | { kind: "nelucratoare" };

/** Starea unui angajat într-o zi (pentru panoul de disponibilitate). */
export function availabilityFor(params: {
  employeeId: string;
  workDays: number[];
  weekday: number;
  date: string;
  assignments: Assignment[];
  absences: Absence[];
  tz: string;
}): DayAvailability {
  const { employeeId, date, tz } = params;
  const abs = params.absences.find((a) => a.employee_id === employeeId && a.start_date <= date && a.end_date >= date);
  if (abs) return { kind: "absent", label: ABSENCE_LABEL[abs.type] ?? abs.type };
  const mine = params.assignments.filter(
    (a) => a.employee_id === employeeId && a.status !== "anulata" && localDate(a.starts_at, tz) === date,
  );
  const minutes = mine.reduce((s, a) => s + (t(a.ends_at) - t(a.starts_at)) / 60000 - a.break_minutes, 0);
  if (mine.length > 0) return minutes >= 6 * 60 ? { kind: "ocupat", minutes } : { kind: "liber_partial", minutes };
  if (!params.workDays.includes(params.weekday)) return { kind: "nelucratoare" };
  return { kind: "disponibil" };
}
