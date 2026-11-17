"use client";
import { AlertTriangle, History } from "lucide-react";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session";
import { ENTRY_STATUS } from "@/lib/labels";
import { formatMinutes } from "@/lib/hours";
import { localDate, localTime, shortDate } from "@/lib/time";
import type { Assignment, Employee, Project, Task, TimeEntry } from "@/lib/types";
import { plannedMinutes } from "@/lib/reports";
import { StatusBadge, cx } from "./ui";

/** Listă de pontaje: tabel pe desktop, carduri pe telefon. */
export function EntryList({ entries, employees, projects, tasks, assignments, actions, selectable, selected, onToggle, onHistory, showEmployee = true }: {
  entries: TimeEntry[];
  employees: Map<string, Employee>;
  projects: Map<string, Project>;
  tasks: Map<string, Task>;
  assignments?: Map<string, Assignment>;
  actions: (e: TimeEntry) => ReactNode;
  selectable?: (e: TimeEntry) => boolean;
  selected?: Set<string>;
  onToggle?: (id: string) => void;
  onHistory?: (e: TimeEntry) => void;
  showEmployee?: boolean;
}) {
  const { tz } = useSession();
  const iv = (e: TimeEntry) => `${localTime(e.started_at, tz)}–${localTime(e.ended_at, tz)}${localDate(e.ended_at, tz) !== localDate(e.started_at, tz) ? " (+1)" : ""}`;
  const planned = (e: TimeEntry) => (e.assignment_id && assignments?.get(e.assignment_id) ? plannedMinutes(assignments.get(e.assignment_id)!) : null);

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
            <tr>
              {selectable && <th className="w-10 px-3 py-2" />}
              <th className="px-3 py-2">Data</th>
              {showEmployee && <th className="px-3 py-2">Angajat</th>}
              <th className="px-3 py-2">Lucrare / misiune</th>
              <th className="px-3 py-2">Interval</th>
              <th className="px-3 py-2 text-right">Pauză</th>
              <th className="px-3 py-2 text-right">Lucrat</th>
              <th className="px-3 py-2 text-right">Planificat</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Acțiuni</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const p = planned(e);
              return (
                <tr key={e.id} className="border-t border-slate-100 align-top">
                  {selectable && <td className="px-3 py-2.5">{selectable(e) && <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={selected?.has(e.id)} onChange={() => onToggle?.(e.id)} aria-label="Selectează" />}</td>}
                  <td className="whitespace-nowrap px-3 py-2.5">{shortDate(localDate(e.started_at, tz))}</td>
                  {showEmployee && <td className="px-3 py-2.5 font-medium">{employees.get(e.employee_id)?.full_name ?? "—"}</td>}
                  <td className="px-3 py-2.5">
                    <div>{projects.get(e.project_id)?.name ?? "—"}</div>
                    <div className="text-xs text-slate-500">{e.task_id ? tasks.get(e.task_id)?.name : ""}</div>
                    {e.notes && <div className="text-xs italic text-slate-600">„{e.notes}”</div>}
                    {e.flag_note && <div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-800"><AlertTriangle className="h-3 w-3" />{e.flag_note}</div>}
                    {e.status === "respins" && e.rejection_reason && <div className="mt-1 text-xs text-red-700">Motiv: {e.rejection_reason}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{iv(e)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{e.break_minutes} min</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatMinutes(e.worked_minutes)}</td>
                  <td className={cx("px-3 py-2.5 text-right tabular-nums", p !== null && p !== e.worked_minutes ? "text-amber-800" : "text-slate-500")}>{p === null ? "—" : formatMinutes(p)}</td>
                  <td className="px-3 py-2.5"><StatusBadge s={ENTRY_STATUS[e.status]} /></td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      {actions(e)}
                      {onHistory && <button onClick={() => onHistory(e)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="Istoric" aria-label="Istoric"><History className="h-4 w-4" /></button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {entries.map((e) => {
          const p = planned(e);
          return (
            <li key={e.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-2">
                {selectable && selectable(e) && <input type="checkbox" className="mt-1 h-5 w-5 accent-orange-600" checked={selected?.has(e.id)} onChange={() => onToggle?.(e.id)} aria-label="Selectează" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{showEmployee ? employees.get(e.employee_id)?.full_name : shortDate(localDate(e.started_at, tz))}</span>
                    <StatusBadge s={ENTRY_STATUS[e.status]} />
                  </div>
                  <div className="text-sm text-slate-700">{projects.get(e.project_id)?.name}{e.task_id ? ` · ${tasks.get(e.task_id)?.name}` : ""}</div>
                  <div className="mt-1 text-sm tabular-nums text-slate-600">
                    {showEmployee && `${shortDate(localDate(e.started_at, tz))} · `}{iv(e)} · pauză {e.break_minutes} min
                  </div>
                  <div className="mt-1 text-sm">Lucrat: <strong>{formatMinutes(e.worked_minutes)}</strong>{p !== null && <span className="text-slate-500"> · planificat {formatMinutes(p)}</span>}</div>
                  {e.flag_note && <div className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-800"><AlertTriangle className="h-3 w-3" />{e.flag_note}</div>}
                  {e.status === "respins" && e.rejection_reason && <div className="mt-1 text-xs text-red-700">Motiv: {e.rejection_reason}</div>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {actions(e)}
                {onHistory && <button onClick={() => onHistory(e)} className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-100"><History className="h-4 w-4" />Istoric</button>}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
