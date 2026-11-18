import { describe, expect, it, vi, beforeAll } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildMonthSheet } from "./timesheet";
import type { Absence, Employee, Project, Task, TimeEntry } from "./types";

const emp = { id: "e1", full_name: "Ion Țăranu", trade: "Zidar", active: true } as Employee;
const proj = new Map([["p1", { id: "p1", name: "Bloc Ș. Mihăilescu" } as Project]]);
const tasks = new Map([["t1", { id: "t1", name: "Tencuială" } as Task]]);
const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: Math.random().toString(), company_id: "c", employee_id: "e1", project_id: "p1", task_id: "t1", assignment_id: null,
  started_at: "2026-10-05T04:00:00Z", ended_at: "2026-10-05T13:00:00Z", break_minutes: 60, worked_minutes: 480,
  status: "aprobat", notes: null, rejection_reason: null, flag_note: null, submitted_at: null, reviewed_at: null, created_at: "", ...over,
});
const entries = [
  entry({}),
  entry({ started_at: "2026-10-06T04:00:00Z", ended_at: "2026-10-06T12:00:00Z", worked_minutes: 420, status: "trimis", source: "buton" }),
  entry({ started_at: "2026-10-07T04:00:00Z", status: "ciorna" }),
  entry({ started_at: "2026-10-08T04:00:00Z", status: "respins" }),
  entry({ employee_id: "e2" }),
  entry({ started_at: "2026-09-30T04:00:00Z" }),
];
const absences = [{ id: "a", company_id: "c", employee_id: "e1", type: "medical", start_date: "2026-10-12", end_date: "2026-10-13", note: null } as Absence];

describe("foaia lunară", () => {
  const s = buildMonthSheet({ employee: emp, month: "2026-10-15", entries, absences, projects: proj, tasks, tz: "Europe/Bucharest" });
  it("are fiecare zi din lună", () => {
    expect(s.days).toHaveLength(31);
    expect(s.days[0].date).toBe("2026-10-01");
    expect(s.days[0].weekday).toBe(4);
  });
  it("adună doar aprobate și trimise, separat", () => {
    expect(s.approvedMinutes).toBe(480);
    expect(s.submittedMinutes).toBe(420);
    expect(s.workedDays).toBe(2);
    const d5 = s.days[4];
    expect(d5.lines[0]).toMatchObject({ project: "Bloc Ș. Mihăilescu", task: "Tencuială", start: "07:00", end: "16:00", minutes: 480 });
    expect(s.days[5].lines[0].byButton).toBe(true);
    expect(s.days[6].lines).toHaveLength(0);
  });
  it("numără zilele de absență", () => {
    expect(s.absenceDays).toEqual({ medical: 2 });
    expect(s.days[11].absence).toBe("medical");
  });
});

describe("PDF", () => {
  beforeAll(() => {
    vi.stubGlobal("fetch", async (u: string) => ({ arrayBuffer: async () => { const b = readFileSync(path.join("public", u)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } }));
  });
  it("se generează cu diacritice", async () => {
    const { monthlyPdf } = await import("./pdf");
    const s = buildMonthSheet({ employee: emp, month: "2026-10-01", entries, absences, projects: proj, tasks, tz: "Europe/Bucharest" });
    const blob = await monthlyPdf({ companyName: "Construcții Șerban SRL", sheets: [s, { ...s, employee: { ...emp, id: "e9", full_name: "Ana Pop" } }] });
    const buf = Buffer.from(await blob.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(20000);
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, buf);
  });
});
