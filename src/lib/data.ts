"use client";
import { supabase } from "./supabase/client";
import { must } from "./useQuery";
import type { Absence, Assignment, Employee, OdometerReading, Project, Task, Team, TimeEntry, Vehicle } from "./types";

const sb = () => supabase();

export async function loadEmployees(opts: { includeInactive?: boolean } = {}): Promise<Employee[]> {
  let q = sb().from("employees").select("*").order("full_name");
  if (!opts.includeInactive) q = q.eq("active", true);
  return must(await q) as Employee[];
}

export async function loadTeams(): Promise<Team[]> {
  return must(await sb().from("teams").select("*").order("name")) as Team[];
}

export async function loadProjects(): Promise<Project[]> {
  return must(await sb().from("projects").select("*").order("name")) as Project[];
}

export async function loadTasks(projectId?: string): Promise<Task[]> {
  let q = sb().from("tasks").select("*").order("created_at");
  if (projectId) q = q.eq("project_id", projectId);
  return must(await q) as Task[];
}

/** Alocările care încep în intervalul UTC [from, to). Include o zi înainte pentru turele de noapte. */
export async function loadAssignments(fromUtc: string, toUtc: string, filter: { employeeId?: string; projectId?: string } = {}): Promise<Assignment[]> {
  const before = new Date(new Date(fromUtc).getTime() - 24 * 3600 * 1000).toISOString();
  let q = sb().from("assignments").select("*").gte("starts_at", before).lt("starts_at", toUtc).gt("ends_at", fromUtc).order("starts_at");
  if (filter.employeeId) q = q.eq("employee_id", filter.employeeId);
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  return must(await q) as Assignment[];
}

export async function loadAbsences(fromDate: string, toDate: string): Promise<Absence[]> {
  return must(await sb().from("absences").select("*").lte("start_date", toDate).gte("end_date", fromDate).order("start_date")) as Absence[];
}

export async function loadTimeEntries(fromUtc: string, toUtc: string, filter: { employeeId?: string; projectId?: string; status?: string } = {}): Promise<TimeEntry[]> {
  let q = sb().from("time_entries").select("*").gte("started_at", fromUtc).lt("started_at", toUtc).order("started_at", { ascending: false });
  if (filter.employeeId) q = q.eq("employee_id", filter.employeeId);
  if (filter.projectId) q = q.eq("project_id", filter.projectId);
  if (filter.status) q = q.eq("status", filter.status);
  return must(await q) as TimeEntry[];
}

export function byId<T extends { id: string }>(rows: T[] | null | undefined): Map<string, T> {
  return new Map((rows ?? []).map((r) => [r.id, r]));
}

export async function loadVehicles(): Promise<Vehicle[]> {
  return must(await sb().from("vehicles").select("*").order("name")) as Vehicle[];
}

/** Citirile de km (doar administratorul le poate citi — RLS). */
export async function loadOdometer(fromDate: string, toDate: string): Promise<OdometerReading[]> {
  return must(await sb().from("odometer_readings").select("*").gte("reading_date", fromDate).lte("reading_date", toDate).order("reading_date")) as OdometerReading[];
}
