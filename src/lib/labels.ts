import type { AbsenceType, AppRole, AssignmentStatus, ProjectStatus, TaskStatus, TimeEntryStatus } from "./types";

type Tone = "gray" | "blue" | "green" | "amber" | "red" | "orange" | "violet";

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrator",
  sef_echipa: "Șef de echipă",
  angajat: "Angajat",
};

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: Tone }> = {
  planificata: { label: "Planificată", tone: "blue" },
  in_desfasurare: { label: "În desfășurare", tone: "green" },
  suspendata: { label: "Suspendată", tone: "amber" },
  finalizata: { label: "Finalizată", tone: "gray" },
  anulata: { label: "Anulată", tone: "red" },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; tone: Tone }> = {
  neinceputa: { label: "Neîncepută", tone: "gray" },
  in_lucru: { label: "În lucru", tone: "blue" },
  blocata: { label: "Blocată", tone: "red" },
  finalizata: { label: "Finalizată", tone: "green" },
};

export const ASSIGNMENT_STATUS: Record<AssignmentStatus, { label: string; tone: Tone }> = {
  planificata: { label: "Planificată", tone: "blue" },
  confirmata: { label: "Confirmată", tone: "green" },
  anulata: { label: "Anulată", tone: "red" },
};

export const ENTRY_STATUS: Record<TimeEntryStatus, { label: string; tone: Tone }> = {
  ciorna: { label: "Ciornă", tone: "gray" },
  trimis: { label: "Trimis", tone: "amber" },
  aprobat: { label: "Aprobat", tone: "green" },
  respins: { label: "Respins", tone: "red" },
};

export const ABSENCE_TYPE: Record<AbsenceType, { label: string; tone: Tone }> = {
  concediu: { label: "Concediu", tone: "violet" },
  medical: { label: "Concediu medical", tone: "violet" },
  absent: { label: "Absent", tone: "red" },
  alt_motiv: { label: "Indisponibil", tone: "gray" },
};

export const HISTORY_ACTION: Record<string, string> = {
  creat: "Creat",
  modificat: "Modificat",
  ciorna: "Readus în ciornă",
  trimis: "Trimis",
  aprobat: "Aprobat",
  respins: "Respins",
  corectat: "Corectat după aprobare",
  semnalat: "Problemă semnalată",
  sters: "Șters",
};

export const PROJECT_COLORS = [
  "#2563eb", "#16a34a", "#9333ea", "#0891b2", "#db2777", "#ca8a04", "#4f46e5", "#059669", "#dc2626", "#7c3aed", "#0d9488", "#b45309",
];

export function pickProjectColor(used: string[]): string {
  const free = PROJECT_COLORS.find((c) => !used.includes(c));
  return free ?? PROJECT_COLORS[used.length % PROJECT_COLORS.length];
}

export function mapsUrl(address: string | null, city?: string | null): string | null {
  const q = [address, city].filter(Boolean).join(", ");
  if (!q.trim()) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
