"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, ProgressBar, StatusBadge } from "@/components/ui";
import { TaskProgressDialog } from "@/components/TaskProgressDialog";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { byId, loadAbsences, loadAssignments, loadEmployees, loadProjects, loadScopeProjectIds, loadTasks, loadTeams } from "@/lib/data";
import { availabilityFor } from "@/lib/conflicts";
import { PROJECT_STATUS, TASK_STATUS } from "@/lib/labels";
import { addDays, isoWeekday, localDate, localTime, prettyDate, rangeUtc, todayIn } from "@/lib/time";
import type { Task } from "@/lib/types";

export default function EchipaPage() {
  return <RequireRole roles={["sef_echipa", "admin"]}><Echipa /></RequireRole>;
}

function Echipa() {
  const { tz, employee } = useSession();
  const [date, setDate] = useState(todayIn(tz));
  const [progressTask, setProgressTask] = useState<Task | null>(null);

  const q = useQuery(async () => {
    const [f, t] = rangeUtc(date, date, tz);
    const [teams, employees, allProjects, tasks, assignments, absences, scope] = await Promise.all([
      loadTeams(), loadEmployees(), loadProjects(), loadTasks(), loadAssignments(f, t), loadAbsences(date, date), loadScopeProjectIds(),
    ]);
    const projects = allProjects.filter((p) => scope.has(p.id));
    return { teams, employees, projects, allProjects, tasks, assignments: assignments.filter((a) => a.status !== "anulata"), absences };
  }, [date, tz]);

  const d = q.data;
  const projects = useMemo(() => byId(d?.allProjects), [d]);
  const tasks = useMemo(() => byId(d?.tasks), [d]);
  const myTeams = (d?.teams ?? []).filter((t) => t.leader_employee_id === employee?.id);
  const members = (d?.employees ?? []).filter((e) => myTeams.some((t) => t.id === e.team_id));
  // doar lucrările de care răspunde șeful sau unde lucrează echipa lui
  const ledProjects = (d?.projects ?? []).filter((p) => !["finalizata", "anulata"].includes(p.status));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Echipa mea" subtitle={myTeams.map((t) => t.name).join(", ") || "Nu ești setat ca șef al unei echipe"} />
      <div className="flex items-center gap-1">
        <Button onClick={() => setDate(addDays(date, -1))} aria-label="Ziua anterioară"><ChevronLeft className="h-5 w-5" /></Button>
        <Button onClick={() => setDate(todayIn(tz))}>Azi</Button>
        <Button onClick={() => setDate(addDays(date, 1))} aria-label="Ziua următoare"><ChevronRight className="h-5 w-5" /></Button>
        <Input type="date" className="w-auto" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </div>
      <p className="font-semibold">{prettyDate(date)}</p>
      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !d && <Loading />}
      {d && (
        <>
          <Card title="Cine lucrează și unde">
            {members.length === 0 ? <p className="text-sm text-slate-600">Nu există membri în echipele tale.</p> : (
              <ul className="divide-y divide-slate-100">
                {members.map((m) => {
                  const items = d.assignments.filter((a) => a.employee_id === m.id && localDate(a.starts_at, tz) === date);
                  const av = availabilityFor({ employeeId: m.id, workDays: m.work_days, weekday: isoWeekday(date), date, assignments: d.assignments, absences: d.absences, tz });
                  return (
                    <li key={m.id} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{m.full_name}</span>
                        {av.kind === "absent" ? <Badge tone="red">{av.label}</Badge> : items.length === 0 ? <Badge tone={av.kind === "nelucratoare" ? "gray" : "green"}>{av.kind === "nelucratoare" ? "Zi liberă" : "Disponibil"}</Badge> : null}
                      </div>
                      {items.map((a) => (
                        <div key={a.id} className="mt-1 text-sm text-slate-700">
                          <span className="tabular-nums font-medium">{localTime(a.starts_at, tz)}–{localTime(a.ends_at, tz)}</span> · {projects.get(a.project_id)?.name} · {a.task_id ? tasks.get(a.task_id)?.name : "fără misiune"}
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <h2 className="pt-2 text-lg font-semibold">Lucrări și progresul misiunilor</h2>
          {ledProjects.length === 0 && <Empty title="Nicio lucrare activă" />}
          {ledProjects.map((p) => (
            <Card key={p.id} title={<span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: p.color }} />{p.name}</span>} action={<StatusBadge s={PROJECT_STATUS[p.status]} />}>
              <ul className="space-y-3">
                {d.tasks.filter((t) => t.project_id === p.id).map((t) => (
                  <li key={t.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="font-medium">{t.name}</span><StatusBadge s={TASK_STATUS[t.status]} /></div>
                      <ProgressBar value={t.progress} />
                    </div>
                    <Button size="sm" onClick={() => setProgressTask(t)}>Actualizează</Button>
                  </li>
                ))}
                {d.tasks.filter((t) => t.project_id === p.id).length === 0 && <li className="text-sm text-slate-500">Nicio misiune definită.</li>}
              </ul>
            </Card>
          ))}
        </>
      )}
      {progressTask && <TaskProgressDialog task={progressTask} onClose={() => setProgressTask(null)} onDone={async () => { setProgressTask(null); await q.reload(); }} />}
    </div>
  );
}
