import type { Company, Employee } from "./types";

/** Programul implicit: 07:00–16:00 cu 60 min pauză = 8 ore lucrate. */
export const DEFAULT_SCHEDULE = { start: "07:00", end: "16:00", breakMin: 60 };

export interface Schedule { start: string; end: string; breakMin: number }

/** Programul firmei (pentru angajații noi). */
export function companySchedule(c?: Pick<Company, "default_work_start" | "default_work_end" | "default_break_minutes"> | null): Schedule {
  return {
    start: c?.default_work_start?.slice(0, 5) ?? DEFAULT_SCHEDULE.start,
    end: c?.default_work_end?.slice(0, 5) ?? DEFAULT_SCHEDULE.end,
    breakMin: c?.default_break_minutes ?? DEFAULT_SCHEDULE.breakMin,
  };
}

/** Programul unui angajat; dacă lipsește, cel al firmei. */
export function employeeSchedule(e?: Pick<Employee, "work_start" | "work_end" | "break_minutes"> | null, c?: Parameters<typeof companySchedule>[0]): Schedule {
  const base = companySchedule(c);
  if (!e) return base;
  return { start: e.work_start?.slice(0, 5) ?? base.start, end: e.work_end?.slice(0, 5) ?? base.end, breakMin: e.break_minutes ?? base.breakMin };
}

/** Minute lucrate pe zi pentru un program (trece și peste miezul nopții). */
export function scheduleMinutes(s: Schedule): number {
  const m = (t: string) => { const [h, mm] = t.split(":").map(Number); return h * 60 + mm; };
  let total = m(s.end) - m(s.start);
  if (total <= 0) total += 24 * 60;
  return Math.max(0, total - (s.breakMin || 0));
}
