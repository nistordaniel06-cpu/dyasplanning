"use client";
// Zilele de absență / concediu din perioada aleasă, afișate în foaia de pontaj (în ele nu se pot pune ore).
import type { Absence, Employee } from "@/lib/types";
import { ABSENCE_TYPE } from "@/lib/labels";
import { shortDate } from "@/lib/time";
import { StatusBadge } from "./ui";

export function AbsenceStrip({ absences, employees, from, to, showEmployee }: {
  absences: Absence[]; employees: Map<string, Employee>; from: string; to: string; showEmployee?: boolean;
}) {
  const list = absences.filter((a) => a.end_date >= from && a.start_date <= to)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (!list.length) return null;
  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-3">
      <div className="mb-2 text-sm font-bold text-violet-900">Absențe în perioadă — în aceste zile nu se pot pune ore</div>
      <ul className="space-y-1.5 text-sm">
        {list.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2">
            <StatusBadge s={ABSENCE_TYPE[a.type]} />
            <span className="font-semibold tabular-nums">{a.start_date === a.end_date ? shortDate(a.start_date) : `${shortDate(a.start_date)} – ${shortDate(a.end_date)}`}</span>
            {showEmployee && <span>{employees.get(a.employee_id)?.full_name ?? ""}</span>}
            {a.note && <span className="text-slate-600">· {a.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
