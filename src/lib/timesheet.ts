// Foaia lunară de pontaj pe angajat (date pure, fără PDF — ușor de testat).
import { datesBetween, endOfMonth, isoWeekday, localDate, localTime, startOfMonth } from "./time";
import type { Absence, AbsenceType, Employee, Project, Task, TimeEntry } from "./types";

export interface SheetLine {
  project: string;
  task: string | null;
  start: string;
  end: string;
  breakMinutes: number;
  minutes: number;
  status: TimeEntry["status"];
  byButton: boolean;
}

export interface SheetDay {
  date: string;
  weekday: number; // 1 = luni … 7 = duminică
  lines: SheetLine[];
  absence: AbsenceType | null;
  minutes: number; // doar aprobate + trimise
}

export interface MonthSheet {
  employee: Employee;
  month: string; // YYYY-MM-01
  days: SheetDay[];
  approvedMinutes: number;
  submittedMinutes: number;
  workedDays: number;
  absenceDays: Partial<Record<AbsenceType, number>>;
}

/** Ce intră în foaie: doar pontajele aprobate și cele trimise (ciornele și cele respinse nu). */
const COUNTED = new Set<TimeEntry["status"]>(["aprobat", "trimis"]);

export function buildMonthSheet(opts: {
  employee: Employee;
  month: string;
  entries: TimeEntry[];
  absences: Absence[];
  projects: Map<string, Project>;
  tasks: Map<string, Task>;
  tz: string;
}): MonthSheet {
  const { employee, entries, absences, projects, tasks, tz } = opts;
  const month = startOfMonth(opts.month);
  const dates = datesBetween(month, endOfMonth(month));
  const mine = entries
    .filter((e) => e.employee_id === employee.id && COUNTED.has(e.status))
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const absent = absences.filter((a) => a.employee_id === employee.id);

  let approved = 0, submitted = 0, workedDays = 0;
  const absenceDays: Partial<Record<AbsenceType, number>> = {};
  const days = dates.map((date): SheetDay => {
    const lines = mine.filter((e) => localDate(e.started_at, tz) === date).map((e): SheetLine => ({
      project: projects.get(e.project_id)?.name ?? "—",
      task: e.task_id ? tasks.get(e.task_id)?.name ?? null : null,
      start: localTime(e.started_at, tz),
      end: localTime(e.ended_at, tz),
      breakMinutes: e.break_minutes,
      minutes: e.worked_minutes,
      status: e.status,
      byButton: e.source === "buton",
    }));
    for (const l of lines) { if (l.status === "aprobat") approved += l.minutes; else submitted += l.minutes; }
    if (lines.length) workedDays++;
    const abs = absent.find((a) => a.start_date <= date && a.end_date >= date)?.type ?? null;
    if (abs && !lines.length) absenceDays[abs] = (absenceDays[abs] ?? 0) + 1;
    return { date, weekday: isoWeekday(date), lines, absence: abs, minutes: lines.reduce((s, l) => s + l.minutes, 0) };
  });
  return { employee, month, days, approvedMinutes: approved, submittedMinutes: submitted, workedDays, absenceDays };
}

