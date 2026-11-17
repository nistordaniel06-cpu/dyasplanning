export type AppRole = "admin" | "sef_echipa" | "angajat";
export type ProjectStatus = "planificata" | "in_desfasurare" | "suspendata" | "finalizata" | "anulata";
export type TaskStatus = "neinceputa" | "in_lucru" | "blocata" | "finalizata";
export type AssignmentStatus = "planificata" | "confirmata" | "anulata";
export type TimeEntryStatus = "ciorna" | "trimis" | "aprobat" | "respins";
export type AbsenceType = "concediu" | "medical" | "absent" | "alt_motiv";

export interface Company {
  id: string;
  name: string;
  timezone: string;
  travel_buffer_minutes: number;
  created_at: string;
}

export interface Membership {
  user_id: string;
  company_id: string;
  role: AppRole;
  employee_id: string | null;
  display_name: string | null;
}

export interface Team {
  id: string;
  company_id: string;
  name: string;
  leader_employee_id: string | null;
}

export interface Employee {
  id: string;
  company_id: string;
  full_name: string;
  phone: string | null;
  trade: string | null;
  skills: string[];
  team_id: string | null;
  user_id: string | null;
  work_start: string; // "08:00:00"
  work_end: string;
  work_days: number[];
  active: boolean;
  created_at: string;
}

export interface Absence {
  id: string;
  company_id: string;
  employee_id: string;
  type: AbsenceType;
  start_date: string;
  end_date: string;
  note: string | null;
}

export interface Project {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  client_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  address: string | null;
  city: string | null;
  start_date: string | null;
  due_date: string | null;
  manager_employee_id: string | null;
  status: ProjectStatus;
  color: string;
  created_at: string;
}

export interface Task {
  id: string;
  company_id: string;
  project_id: string;
  name: string;
  description: string | null;
  status: TaskStatus;
  progress: number;
  due_date: string | null;
  created_at: string;
}

export interface Assignment {
  id: string;
  company_id: string;
  employee_id: string;
  project_id: string;
  task_id: string | null;
  starts_at: string;
  ends_at: string;
  break_minutes: number;
  status: AssignmentStatus;
  notes: string | null;
}

export interface TimeEntry {
  id: string;
  company_id: string;
  employee_id: string;
  project_id: string;
  task_id: string | null;
  assignment_id: string | null;
  started_at: string;
  ended_at: string;
  break_minutes: number;
  worked_minutes: number;
  status: TimeEntryStatus;
  notes: string | null;
  rejection_reason: string | null;
  flag_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface TimeEntryHistory {
  id: number;
  time_entry_id: string;
  action: string;
  changed_by: string | null;
  reason: string | null;
  old_data: Partial<TimeEntry> | null;
  new_data: Partial<TimeEntry> | null;
  changed_at: string;
}

export interface Note {
  id: string;
  project_id: string;
  task_id: string | null;
  author_user_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface Invite {
  id: string;
  code: string;
  role: AppRole;
  employee_id: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface CompanyUser {
  user_id: string;
  role: AppRole;
  employee_id: string | null;
  display_name: string | null;
  email: string | null;
  created_at: string;
}
