"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { NeedsEmployee } from "@/components/shell";
import { Button, ErrorBox, Loading, PageHeader, StatusBadge, cx } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { byId, loadAbsences, loadAssignments, loadProjects, loadTasks } from "@/lib/data";
import { ABSENCE_TYPE, ASSIGNMENT_STATUS } from "@/lib/labels";
import { formatMinutes } from "@/lib/hours";
import { plannedMinutes } from "@/lib/reports";
import { addDays, datesBetween, isoWeekday, localDate, localTime, prettyDate, rangeUtc, shortDate, startOfWeek, todayIn } from "@/lib/time";

export default function ProgramPage() {
  return <NeedsEmployee><Program /></NeedsEmployee>;
}

function Program() {
  const { tz, employee } = useSession();
  const today = todayIn(tz);
  const [weekStart, setWeekStart] = useState(startOfWeek(today));
  const to = addDays(weekStart, 13);

  const q = useQuery(async () => {
    const [f, t] = rangeUtc(weekStart, to, tz);
    const [assignments, projects, tasks, absences] = await Promise.all([
      loadAssignments(f, t, { employeeId: employee!.id }), loadProjects(), loadTasks(), loadAbsences(weekStart, to),
    ]);
    return { assignments: assignments.filter((a) => a.status !== "anulata"), projects, tasks, absences: absences.filter((a) => a.employee_id === employee!.id) };
  }, [weekStart, tz, employee?.id]);

  const projects = useMemo(() => byId(q.data?.projects), [q.data]);
  const tasks = useMemo(() => byId(q.data?.tasks), [q.data]);
  const total = (q.data?.assignments ?? []).reduce((s, a) => s + plannedMinutes(a), 0);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Programul meu" subtitle={`${shortDate(weekStart)} – ${shortDate(to)} · ${formatMinutes(total)} planificate`}
        actions={<div className="flex gap-1">
          <Button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Înapoi"><ChevronLeft className="h-5 w-5" /></Button>
          <Button onClick={() => setWeekStart(startOfWeek(today))}>Azi</Button>
          <Button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Înainte"><ChevronRight className="h-5 w-5" /></Button>
        </div>} />
      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <Loading />}
      {q.data && (
        <ol className="space-y-2">
          {datesBetween(weekStart, to).map((day) => {
            const items = q.data!.assignments.filter((a) => localDate(a.starts_at, tz) === day);
            const abs = q.data!.absences.find((a) => a.start_date <= day && a.end_date >= day);
            const off = !employee!.work_days.includes(isoWeekday(day));
            return (
              <li key={day} className={cx("rounded-xl border bg-white p-3", day === today ? "border-orange-400 ring-1 ring-orange-400" : "border-slate-200", day < today && "opacity-70")}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-semibold">{prettyDate(day)}</span>
                  {abs && <StatusBadge s={ABSENCE_TYPE[abs.type]} />}
                </div>
                {items.length === 0 && !abs && <p className="text-sm text-slate-500">{off ? "Zi liberă" : "Neprogramat"}</p>}
                <ul className="space-y-2">
                  {items.map((a) => {
                    const p = projects.get(a.project_id);
                    return (
                      <li key={a.id} className="rounded-lg px-3 py-2" style={{ background: `${p?.color}12`, borderLeft: `4px solid ${p?.color}` }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold tabular-nums">{localTime(a.starts_at, tz)}–{localTime(a.ends_at, tz)}</span>
                          {a.status !== "planificata" && <StatusBadge s={ASSIGNMENT_STATUS[a.status]} />}
                        </div>
                        <div className="font-semibold">{p?.name}</div>
                        <div className="text-sm text-slate-700">{a.task_id ? tasks.get(a.task_id)?.name : "Fără misiune"}</div>
                        {(p?.address || p?.city) && <div className="flex items-center gap-1 text-xs text-slate-600"><MapPin className="h-3 w-3" />{[p?.address, p?.city].filter(Boolean).join(", ")}</div>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
