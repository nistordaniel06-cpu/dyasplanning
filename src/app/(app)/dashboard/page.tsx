"use client";
import { localeTag } from "@/lib/lang";
import Link from "next/link";
import { useMemo } from "react";
import { Plus } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { AppSetupCard } from "@/components/AppSetup";
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { byId, loadAbsences, loadAssignments, loadEmployees, loadProjects, loadTasks, loadTimeEntries, loadTrips, loadVehicles } from "@/lib/data";
import { availabilityFor } from "@/lib/conflicts";
import { PROJECT_STATUS, ABSENCE_TYPE } from "@/lib/labels";
import { formatMinutes } from "@/lib/hours";
import { plannedMinutes } from "@/lib/reports";
import { addDays, isoWeekday, localDate, localTime, prettyDate, rangeUtc, startOfWeek, todayIn } from "@/lib/time";
import type { TimeEntry } from "@/lib/types";

export default function DashboardPage() {
  return <RequireRole roles={["admin"]}><Dashboard /></RequireRole>;
}

function Dashboard() {
  const { tz, company } = useSession();
  const today = todayIn(tz);
  const ws = startOfWeek(today), we = addDays(ws, 6);

  const q = useQuery(async () => {
    const [tf, tt] = rangeUtc(today, today, tz);
    const [wf, wt] = rangeUtc(ws, we, tz);
    const [employees, projects, tasks, todayAs, weekAs, absences, weekEntries, pending, vehicles, odo] = await Promise.all([
      loadEmployees(), loadProjects(), loadTasks(), loadAssignments(tf, tt), loadAssignments(wf, wt), loadAbsences(today, today),
      loadTimeEntries(wf, wt),
      supabase().from("time_entries").select("*").eq("status", "trimis").order("started_at").then((r) => must(r) as TimeEntry[]),
      loadVehicles(), loadTrips(today, today),
    ]);
    return { vehicles: vehicles.filter((v) => v.active), odo, employees, projects, tasks, todayAs: todayAs.filter((a) => a.status !== "anulata" && localDate(a.starts_at, tz) === today), weekAs: weekAs.filter((a) => a.status !== "anulata"), absences, weekEntries, pending };
  }, [today, tz]);

  const d = q.data;
  const emp = useMemo(() => byId(d?.employees), [d]);
  const proj = useMemo(() => byId(d?.projects), [d]);
  const tk = useMemo(() => byId(d?.tasks), [d]);

  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (q.loading && !d) return <Loading />;
  if (!d) return null;

  const activeProjects = d.projects.filter((p) => p.status === "in_desfasurare");
  const scheduledIds = new Set(d.todayAs.map((a) => a.employee_id));
  const avail = d.employees.map((e) => ({ e, a: availabilityFor({ employeeId: e.id, workDays: e.work_days, weekday: isoWeekday(today), date: today, assignments: d.todayAs, absences: d.absences, tz }) }));
  const available = avail.filter((x) => x.a.kind === "disponibil");
  const absent = avail.filter((x) => x.a.kind === "absent");
  const overdue = d.tasks.filter((t) => t.status !== "finalizata" && ((t.due_date && t.due_date < today) || false))
    .concat(d.tasks.filter((t) => t.status === "blocata" && !(t.due_date && t.due_date < today)));
  const weekPlanned = d.weekAs.reduce((s, a) => s + plannedMinutes(a), 0);
  const weekApproved = d.weekEntries.filter((e) => e.status === "aprobat").reduce((s, e) => s + e.worked_minutes, 0);
  const weekPending = d.weekEntries.filter((e) => e.status === "trimis" || e.status === "ciorna").reduce((s, e) => s + e.worked_minutes, 0);

  // „Cine lucrează astăzi, unde, ce misiune, în ce interval” — grupat pe lucrare
  const byProject = new Map<string, typeof d.todayAs>();
  for (const a of [...d.todayAs].sort((x, y) => x.starts_at.localeCompare(y.starts_at))) byProject.set(a.project_id, [...(byProject.get(a.project_id) ?? []), a]);

  return (
    <div className="space-y-5">
      <PageHeader title="Dashboard" subtitle={`${company?.name} · ${prettyDate(today)}`}
        actions={<>
          <Link href="/lucrari?nou=1"><Button><Plus className="h-4 w-4" />Adaugă lucrare</Button></Link>
          <Link href="/planning/aloca"><Button variant="primary"><Plus className="h-4 w-4" />Alocă angajați</Button></Link>
        </>} />

      <AppSetupCard compact />
      {company && Date.now() - new Date(company.created_at).getTime() > 14 * 864e5
        && (!company.last_backup_at || Date.now() - new Date(company.last_backup_at).getTime() > 30 * 864e5) && (
        <Link href="/setari" className="block rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 hover:bg-amber-100">
          <strong>Fă un backup al datelor firmei.</strong> {company.last_backup_at ? "Ultimul backup e mai vechi de o lună." : "Nu ai făcut încă niciun backup."} Durează un minut, din Setări → Backup.
        </Link>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Lucrări active" value={activeProjects.length} sub={`${d.projects.filter((p) => p.status === "planificata").length} planificate`} href="/lucrari" />
        <Stat label="Programați azi" value={scheduledIds.size} sub={`din ${d.employees.length} angajați activi`} href="/planning" />
        <Stat label="Disponibili azi" value={available.length} sub={`${absent.length} absenți / concediu`} />
        <Stat label="Pontaje de aprobat" value={d.pending.length} sub={formatMinutes(d.pending.reduce((s, e) => s + e.worked_minutes, 0))} href="/pontaje" />
        <Stat label="Misiuni întârziate" value={overdue.length} sub="sau blocate" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Cine lucrează astăzi" action={<Link href="/planning" className="text-sm font-semibold text-orange-700">Planning →</Link>}>
          {byProject.size === 0 ? <p className="text-sm text-slate-600">Nimeni nu este programat astăzi.</p> : (
            <div className="space-y-4">
              {[...byProject.entries()].map(([pid, list]) => {
                const p = proj.get(pid);
                return (
                  <div key={pid}>
                    <div className="mb-1 flex items-baseline gap-2" style={{ borderLeft: `4px solid ${p?.color}`, paddingLeft: 8 }}>
                      <Link href={`/lucrari/${pid}`} className="font-semibold hover:underline">{p?.name}</Link>
                      <span className="text-xs text-slate-500">{[p?.address, p?.city].filter(Boolean).join(", ")}</span>
                    </div>
                    <ul className="ml-3 divide-y divide-slate-100 text-sm">
                      {list.map((a) => (
                        <li key={a.id} className="flex flex-wrap gap-x-3 py-1.5">
                          <span className="w-24 tabular-nums font-medium">{localTime(a.starts_at, tz)}–{localTime(a.ends_at, tz)}</span>
                          <span className="font-semibold">{emp.get(a.employee_id)?.full_name}</span>
                          <span className="text-slate-600">{a.task_id ? tk.get(a.task_id)?.name : "fără misiune"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Ore săptămâna aceasta">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>Planificate</dt><dd className="font-semibold">{formatMinutes(weekPlanned)}</dd></div>
              <div className="flex justify-between"><dt>Efective aprobate</dt><dd className="font-semibold text-green-800">{formatMinutes(weekApproved)}</dd></div>
              <div className="flex justify-between"><dt>Efective neaprobate</dt><dd className="font-semibold text-amber-800">{formatMinutes(weekPending)}</dd></div>
            </dl>
            <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200" aria-hidden>
              <div className="flex h-full">
                <div className="bg-green-600" style={{ width: `${weekPlanned ? Math.min(100, (weekApproved / weekPlanned) * 100) : 0}%` }} />
                <div className="bg-amber-400" style={{ width: `${weekPlanned ? Math.min(100, (weekPending / weekPlanned) * 100) : 0}%` }} />
              </div>
            </div>
            <Link href="/rapoarte" className="mt-3 inline-block text-sm font-semibold text-orange-700">Rapoarte →</Link>
          </Card>
          {d.vehicles.length > 0 && (() => {
            const done = d.odo.filter((t) => t.km_end != null);
            const km = done.reduce((a, t) => a + (t.km_end! - t.km_start), 0);
            const onRoad = d.odo.filter((t) => t.km_end == null);
            return (
              <Card title="Foaie de parcurs azi" action={<Link href="/masini" className="text-sm font-semibold text-orange-700">Mașini →</Link>}>
                <p className="text-sm">{done.length} curse · <strong className="tabular-nums">{km.toLocaleString(localeTag())} km</strong></p>
                {onRoad.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{onRoad.map((t) => <Badge key={t.id} tone="blue">În drum: {d.vehicles.find((v) => v.id === t.vehicle_id)?.name ?? "mașină"} · de la {t.from_place}</Badge>)}</div>}
              </Card>
            );
          })()}
          <Card title="Disponibili / absenți azi">
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-1">{available.length === 0 ? <span className="text-slate-500">Niciun angajat liber.</span> : available.map(({ e }) => <Badge key={e.id} tone="green">{e.full_name}</Badge>)}</div>
              {absent.length > 0 && <div className="flex flex-wrap gap-1">{absent.map(({ e }) => {
                const ab = d.absences.find((x) => x.employee_id === e.id)!;
                return <Badge key={e.id} tone="red">{e.full_name} · {ABSENCE_TYPE[ab.type].label}</Badge>;
              })}</div>}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Misiuni întârziate sau blocate">
          {overdue.length === 0 ? <p className="text-sm text-slate-600">Nicio misiune întârziată.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {overdue.slice(0, 10).map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Link href={`/lucrari/${t.project_id}`} className="font-semibold hover:underline">{t.name}</Link>
                  <span className="text-slate-600">{proj.get(t.project_id)?.name}</span>
                  <span className="ml-auto">{t.status === "blocata" ? <Badge tone="red">Blocată</Badge> : <Badge tone="red">Termen {t.due_date}</Badge>} <span className="text-xs text-slate-500">{t.progress}%</span></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Lucrări active">
          {activeProjects.length === 0 ? <p className="text-sm text-slate-600">Nicio lucrare în desfășurare.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {activeProjects.slice(0, 10).map((p) => (
                <li key={p.id} className="flex items-center gap-2 py-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: p.color }} />
                  <Link href={`/lucrari/${p.id}`} className="font-semibold hover:underline">{p.name}</Link>
                  <span className="text-slate-600">{p.city}</span>
                  <span className="ml-auto"><StatusBadge s={PROJECT_STATUS[p.status]} /></span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
