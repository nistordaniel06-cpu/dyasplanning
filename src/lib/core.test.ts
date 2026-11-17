import { describe, expect, it } from "vitest";
import { addDays, endOfMonth, isoWeekday, localDate, localTime, moveToDate, rangeUtc, shiftFromLocal, startOfWeek, zonedToUtc } from "./time";
import { formatMinutes, validateShift, workedMinutes } from "./hours";
import { availabilityFor, findConflicts } from "./conflicts";
import { aggregateHours, toCsv } from "./reports";
import type { Absence, Assignment, Project, TimeEntry } from "./types";

const TZ = "Europe/Bucharest";

describe("time", () => {
  it("convertește ora locală în UTC (iarnă UTC+2, vară UTC+3)", () => {
    expect(zonedToUtc("2026-11-18", "08:00", TZ).toISOString()).toBe("2026-11-18T06:00:00.000Z");
    expect(zonedToUtc("2026-07-01", "08:00", TZ).toISOString()).toBe("2026-07-01T05:00:00.000Z");
  });
  it("tură peste miezul nopții", () => {
    const s = shiftFromLocal("2026-11-18", "22:00", "06:00", TZ);
    expect(s.overnight).toBe(true);
    expect(workedMinutes(s.startsAt, s.endsAt, 30)).toBe(450);
    expect(localDate(s.endsAt, TZ)).toBe("2026-11-19");
  });
  it("trecerea la ora de iarnă (25 oct 2026) e calculată corect", () => {
    const s = shiftFromLocal("2026-10-24", "22:00", "06:00", TZ);
    expect(workedMinutes(s.startsAt, s.endsAt, 0)).toBe(9 * 60);
  });
  it("aritmetică pe date", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(isoWeekday("2026-11-22")).toBe(7);
    expect(startOfWeek("2026-11-22")).toBe("2026-11-16");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29");
    expect(rangeUtc("2026-11-18", "2026-11-18", TZ)).toEqual(["2026-11-17T22:00:00.000Z", "2026-11-18T22:00:00.000Z"]);
  });
  it("mutarea pe altă zi păstrează ora locală", () => {
    const m = moveToDate("2026-11-18T06:00:00.000Z", "2026-11-18T14:00:00.000Z", "2026-11-20", TZ);
    expect(localTime(m.startsAt, TZ)).toBe("08:00");
    expect(localDate(m.startsAt, TZ)).toBe("2026-11-20");
    expect(localTime(m.endsAt, TZ)).toBe("16:00");
  });
});

describe("hours", () => {
  it("formatare", () => {
    expect(formatMinutes(450)).toBe("7h 30m");
    expect(formatMinutes(480)).toBe("8h");
    expect(formatMinutes(45)).toBe("45m");
  });
  it("validare", () => {
    expect(validateShift("2026-11-18T08:00:00Z", "2026-11-18T07:00:00Z", 0).ok).toBe(false);
    expect(validateShift("2026-11-18T08:00:00Z", "2026-11-18T09:00:00Z", 60).ok).toBe(false);
    expect(validateShift("2026-11-18T08:00:00Z", "2026-11-18T16:00:00Z", 30)).toEqual({ ok: true, minutes: 450 });
  });
});

const proj = (id: string, address: string): Project => ({
  id, company_id: "c", name: `Lucrare ${id}`, description: null, client_name: null, contact_name: null, contact_phone: null,
  address, city: null, start_date: null, due_date: null, manager_employee_id: null, status: "in_desfasurare", color: "#000", created_at: "",
});
const asg = (id: string, emp: string, project: string, s: string, e: string, status: Assignment["status"] = "planificata"): Assignment => ({
  id, company_id: "c", employee_id: emp, project_id: project, task_id: null,
  starts_at: zonedToUtc("2026-11-18", s, TZ).toISOString(), ends_at: zonedToUtc("2026-11-18", e, TZ).toISOString(),
  break_minutes: 0, status, notes: null,
});

describe("conflicts", () => {
  const projects = [proj("p1", "Str. A 1"), proj("p2", "Str. B 2")];
  const existing = [asg("a1", "ion", "p1", "08:00", "16:00")];

  it("detectează suprapunerea", () => {
    const c = findConflicts({ proposed: [{ ...asg("x", "ion", "p2", "15:00", "17:00"), id: undefined }], existing, absences: [], projects, tz: TZ, travelBufferMinutes: 30 });
    expect(c.some((x) => x.kind === "suprapunere" && x.blocking)).toBe(true);
  });
  it("nu raportează conflict când edităm aceeași alocare", () => {
    const c = findConflicts({ proposed: [{ ...asg("a1", "ion", "p1", "09:00", "17:00") }], existing, absences: [], projects, tz: TZ, travelBufferMinutes: 30 });
    expect(c).toHaveLength(0);
  });
  it("ignoră alocările anulate", () => {
    const c = findConflicts({ proposed: [{ ...asg("x", "ion", "p1", "09:00", "10:00"), id: undefined }], existing: [asg("a9", "ion", "p1", "08:00", "16:00", "anulata")], absences: [], projects, tz: TZ, travelBufferMinutes: 0 });
    expect(c).toHaveLength(0);
  });
  it("avertizează pentru deplasare fără timp suficient", () => {
    const c = findConflicts({ proposed: [{ ...asg("x", "ion", "p2", "16:00", "18:00"), id: undefined }], existing, absences: [], projects, tz: TZ, travelBufferMinutes: 30 });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "deplasare", blocking: false });
  });
  it("aceeași locație, consecutiv = fără avertizare", () => {
    const c = findConflicts({ proposed: [{ ...asg("x", "ion", "p1", "16:00", "18:00"), id: undefined }], existing, absences: [], projects, tz: TZ, travelBufferMinutes: 30 });
    expect(c).toHaveLength(0);
  });
  it("blochează în concediu", () => {
    const absences: Absence[] = [{ id: "z", company_id: "c", employee_id: "mihai", type: "concediu", start_date: "2026-11-17", end_date: "2026-11-19", note: null }];
    const c = findConflicts({ proposed: [{ ...asg("x", "mihai", "p1", "08:00", "12:00"), id: undefined }], existing: [], absences, projects, tz: TZ, travelBufferMinutes: 30 });
    expect(c[0]).toMatchObject({ kind: "absenta", blocking: true });
    expect(availabilityFor({ employeeId: "mihai", workDays: [1, 2, 3, 4, 5], weekday: 3, date: "2026-11-18", assignments: [], absences, tz: TZ }).kind).toBe("absent");
  });
  it("detectează suprapuneri între alocări noi", () => {
    const c = findConflicts({ proposed: [
      { ...asg("x", "andrei", "p1", "08:00", "12:00"), id: undefined, key: "1" },
      { ...asg("y", "andrei", "p2", "11:00", "13:00"), id: undefined, key: "2" },
    ], existing: [], absences: [], projects, tz: TZ, travelBufferMinutes: 0 });
    expect(c.filter((x) => x.kind === "suprapunere")).toHaveLength(1);
  });
});

describe("reports", () => {
  it("separă orele aprobate de cele neaprobate", () => {
    const e = (status: TimeEntry["status"], min: number): TimeEntry => ({
      id: Math.random().toString(), company_id: "c", employee_id: "ion", project_id: "p1", task_id: null, assignment_id: null,
      started_at: "", ended_at: "", break_minutes: 0, worked_minutes: min, status, notes: null, rejection_reason: null,
      flag_note: null, submitted_at: null, reviewed_at: null, created_at: "",
    });
    const { rows, total } = aggregateHours("employee", [asg("a1", "ion", "p1", "08:00", "16:00")], [e("aprobat", 450), e("trimis", 60), e("ciorna", 30), e("respins", 99)], new Map([["ion", "Ion"]]));
    expect(rows[0]).toMatchObject({ label: "Ion", plannedMinutes: 480, approvedMinutes: 450, submittedMinutes: 60, draftMinutes: 30, rejectedMinutes: 99 });
    expect(total.approvedMinutes).toBe(450);
  });
  it("CSV cu BOM, separator ; și escapare", () => {
    const csv = toCsv(["A", "B"], [["x;y", 'zi "bună"']]);
    expect(csv.startsWith("﻿A;B\r\n")).toBe(true);
    expect(csv).toContain('"x;y";"zi ""bună"""');
  });
});

import { inRange } from "./time";
describe("inRange", () => {
  it("compară corect formate ISO diferite (Supabase întoarce +00:00)", () => {
    expect(inRange("2026-11-16T22:00:00+00:00", "2026-11-16T22:00:00.000Z", "2026-11-17T22:00:00.000Z")).toBe(true);
    expect(inRange("2026-11-17T22:00:00.123456+00:00", "2026-11-16T22:00:00.000Z", "2026-11-17T22:00:00.000Z")).toBe(false);
  });
});
