"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Clock, MapPin, Navigation, Phone, Users } from "lucide-react";
import { NeedsEmployee } from "@/components/shell";
import { Badge, Button, Empty, ErrorBox, Loading, PageHeader, ProgressBar, StatusBadge } from "@/components/ui";
import { TaskProgressDialog } from "@/components/TaskProgressDialog";
import { TripCard } from "@/components/TripCard";
import { ClockCard } from "@/components/ClockCard";
import { AppSetupCard } from "@/components/AppSetup";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { withOfflineCache } from "@/lib/cache";
import { byId, loadAssignments, loadEmployees, loadProjects, loadTasks, loadTimeEntries } from "@/lib/data";
import { ASSIGNMENT_STATUS, ENTRY_STATUS, TASK_STATUS, mapsUrl } from "@/lib/labels";
import { formatMinutes } from "@/lib/hours";
import { plannedMinutes } from "@/lib/reports";
import { localDate, localTime, prettyDate, rangeUtc, todayIn } from "@/lib/time";
import type { Task } from "@/lib/types";

export default function AstaziPage() {
  return <NeedsEmployee><Astazi /></NeedsEmployee>;
}

function Astazi() {
  const { tz, employee } = useSession();
  const today = todayIn(tz);
  const [progressTask, setProgressTask] = useState<Task | null>(null);

  const q = useQuery(() => withOfflineCache(`astazi.${employee!.id}.${today}`, async () => {
    const [f, t] = rangeUtc(today, today, tz);
    const [assignments, projects, tasks, employees, entries] = await Promise.all([
      loadAssignments(f, t), loadProjects(), loadTasks(), loadEmployees(), loadTimeEntries(f, t, { employeeId: employee!.id }),
    ]);
    return { assignments: assignments.filter((a) => a.status !== "anulata"), projects, tasks, employees, entries };
  }), [today, tz, employee?.id]);

  const d = q.data;
  const projects = useMemo(() => byId(d?.projects), [d]);
  const tasks = useMemo(() => byId(d?.tasks), [d]);
  const employees = useMemo(() => byId(d?.employees), [d]);
  const mine = (d?.assignments ?? []).filter((a) => a.employee_id === employee!.id && localDate(a.starts_at, tz) === today);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`Bună, ${employee!.full_name.split(" ")[0]}!`} subtitle={prettyDate(today)} />
      <AppSetupCard compact />
      <TripCard />
      {d && <ClockCard assignments={mine} projects={projects} tasks={tasks} onChanged={q.reload} />}
      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !d && <Loading />}
      {d && mine.length === 0 && (
        <Empty title="Nu ești programat astăzi">Verifică <Link href="/program" className="font-semibold text-orange-700 underline">programul tău</Link> pentru zilele următoare.</Empty>
      )}
      <div className="space-y-4">
        {d && mine.map((a) => {
          const p = projects.get(a.project_id);
          const task = a.task_id ? tasks.get(a.task_id) : undefined;
          const nav = mapsUrl(p?.address ?? null, p?.city);
          const colleagues = d.assignments.filter((x) => x.project_id === a.project_id && x.employee_id !== employee!.id && localDate(x.starts_at, tz) === today);
          const entry = d.entries.find((e) => e.assignment_id === a.id || (e.project_id === a.project_id && localDate(e.started_at, tz) === today));
          const prefill = new URLSearchParams({
            lucrare: a.project_id, misiune: a.task_id ?? "", alocare: a.id, data: today,
            start: localTime(a.starts_at, tz), sfarsit: localTime(a.ends_at, tz), pauza: String(a.break_minutes),
          });
          return (
            <article key={a.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="p-4" style={{ borderTop: `6px solid ${p?.color}` }}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg font-bold">{p?.name}</h2>
                  {a.status !== "planificata" && <StatusBadge s={ASSIGNMENT_STATUS[a.status]} />}
                </div>
                {(p?.address || p?.city) && <p className="mt-1 flex items-start gap-1.5 text-slate-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{[p?.address, p?.city].filter(Boolean).join(", ")}</p>}
                <div className="mt-3 flex items-center gap-2 text-2xl font-bold tabular-nums"><Clock className="h-6 w-6 text-orange-600" />{localTime(a.starts_at, tz)} – {localTime(a.ends_at, tz)}</div>
                <p className="text-sm text-slate-600">Pauză planificată {a.break_minutes} min · {formatMinutes(plannedMinutes(a))} de lucru</p>

                <div className="mt-4 rounded-xl bg-orange-50 p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-orange-800">Misiunea ta</div>
                  <div className="mt-0.5 text-lg font-semibold">{task?.name ?? "Fără misiune specificată"}</div>
                  {task?.description && <p className="mt-1 text-sm text-slate-700">{task.description}</p>}
                  {task && <div className="mt-2 space-y-2"><ProgressBar value={task.progress} /><StatusBadge s={TASK_STATUS[task.status]} /></div>}
                  {a.notes && <p className="mt-2 text-sm text-slate-700">Notă: {a.notes}</p>}
                </div>

                {colleagues.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center gap-1 text-sm font-semibold text-slate-700"><Users className="h-4 w-4" />Colegi pe lucrare azi</div>
                    <ul className="space-y-1 text-sm">
                      {colleagues.map((c) => (
                        <li key={c.id} className="flex justify-between gap-2">
                          <span>{employees.get(c.employee_id)?.full_name ?? "Coleg"} — {c.task_id ? tasks.get(c.task_id)?.name : "fără misiune"}</span>
                          <span className="tabular-nums text-slate-500">{localTime(c.starts_at, tz)}–{localTime(c.ends_at, tz)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {p?.contact_name && (
                  <p className="mt-3 flex items-center gap-1.5 text-sm text-slate-700"><Phone className="h-4 w-4" />Contact: {p.contact_name}{p.contact_phone && <> · <a className="font-semibold text-orange-700 underline" href={`tel:${p.contact_phone}`}>{p.contact_phone}</a></>}</p>
                )}
              </div>
              <div className="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-3">
                {nav && <a href={nav} target="_blank" rel="noreferrer"><Button size="lg" className="w-full"><Navigation className="h-5 w-5" />Navigație</Button></a>}
                {task && <Button size="lg" onClick={() => setProgressTask(task)}>Progres</Button>}
                {entry ? (
                  <Link href="/pontaj"><Button size="lg" className="w-full">Pontaj: <Badge tone={ENTRY_STATUS[entry.status].tone}>{ENTRY_STATUS[entry.status].label}</Badge></Button></Link>
                ) : (
                  <Link href={`/pontaj?${prefill}`}><Button size="lg" variant="primary" className="w-full">Adaugă orele</Button></Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {progressTask && <TaskProgressDialog task={progressTask} onClose={() => setProgressTask(null)} onDone={async () => { setProgressTask(null); await q.reload(); }} />}
    </div>
  );
}
