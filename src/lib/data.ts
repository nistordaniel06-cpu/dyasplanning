"use client";
import { supabase } from "./supabase/client";
import { must } from "./useQuery";
import type { ExtraTrip, Trip, Absence, Assignment, Employee, OdometerReading, Project, Task, Team, TimeEntry, Vehicle } from "./types";

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

/** Lucrările de care răspunde / pe care lucrează utilizatorul (șeful de echipă vede toate în planning, dar pontează doar aici). */
export async function loadScopeProjectIds(): Promise<Set<string>> {
  const { data, error } = await sb().rpc("my_scope_project_ids");
  if (error) throw new Error(error.message);
  return new Set(((data ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : (x as { my_scope_project_ids: string }).my_scope_project_ids)));
}

export async function loadExtraTrips(fromDate: string, toDate: string): Promise<ExtraTrip[]> {
  return must(await sb().from("extra_trips").select("*").gte("trip_date", fromDate).lte("trip_date", toDate).order("trip_date").order("created_at")) as ExtraTrip[];
}

export async function loadTrips(fromDate: string, toDate: string): Promise<Trip[]> {
  return must(await sb().from("trips").select("*").gte("trip_date", fromDate).lte("trip_date", toDate).order("vehicle_id").order("seq")) as Trip[];
}
