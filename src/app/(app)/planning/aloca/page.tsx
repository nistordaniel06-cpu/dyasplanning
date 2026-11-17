"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Check, CheckCircle2, MapPin, Search } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { ConflictList } from "@/components/AssignmentEditor";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, cx } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { loadAbsences, loadAssignments, loadEmployees, loadProjects, loadTasks, loadTeams } from "@/lib/data";
import { availabilityFor, findConflicts, type Slot } from "@/lib/conflicts";
import { formatMinutes, validateShift } from "@/lib/hours";
import { addDays, datesBetween, isoWeekday, prettyDate, rangeUtc, shiftFromLocal, shortDate, todayIn, WEEKDAY_SHORT } from "@/lib/time";
import { PROJECT_STATUS } from "@/lib/labels";
import type { Task } from "@/lib/types";

export default function AlocaPage() {
  return <RequireRole roles={["admin"]}><Suspense fallback={<Loading />}><Aloca /></Suspense></RequireRole>;
}

interface PerEmployee { taskId: string; start: string; end: string; breakMin: string }

function Aloca() {
  const { tz, company, membership } = useSession();
  const params = useSearchParams();
  const [projectId, setProjectId] = useState(params.get("lucrare") ?? "");
  const [projectSearch, setProjectSearch] = useState("");
  const [taskId, setTaskId] = useState("");
  const [newTask, setNewTask] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [empSearch, setEmpSearch] = useState("");
  const [date, setDate] = useState(params.get("date") ?? todayIn(tz));
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("16:00");
  const [breakMin, setBreakMin] = useState("30");
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState(addDays(params.get("date") ?? todayIn(tz), 4));
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [custom, setCustom] = useState<Record<string, PerEmployee>>({});
  const [skipConflicts, setSkipConflicts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const refs = useQuery(async () => {
    const [employees, teams, projects, tasks] = await Promise.all([loadEmployees(), loadTeams(), loadProjects(), loadTasks()]);
    return { employees, teams, projects, tasks };
  }, []);
  const [extraTasks, setExtraTasks] = useState<Task[]>([]);

  const dates = useMemo(() => {
    if (!repeat) return [date];
    if (until < date) return [];
    return datesBetween(date, until).filter((d) => weekdays.includes(isoWeekday(d))).slice(0, 62);
  }, [repeat, date, until, weekdays]);
  const lastDate = dates[dates.length - 1] ?? date;

  const sched = useQuery(async () => {
    const [f, t] = rangeUtc(date, addDays(lastDate, 1), tz);
    const [assignments, absences] = await Promise.all([loadAssignments(f, t), loadAbsences(date, lastDate)]);
    return { assignments, absences };
  }, [date, lastDate, tz]);

  const d = refs.data;
  const project = d?.projects.find((p) => p.id === projectId);
  const tasks = [...(d?.tasks ?? []), ...extraTasks].filter((t) => t.project_id === projectId);
  const empName = (id: string) => d?.employees.find((e) => e.id === id)?.full_name ?? "";

  const settingsFor = (eid: string): PerEmployee => custom[eid] ?? { taskId, start, end, breakMin };

  const slots = useMemo(() => {
    const out: (Slot & { date: string; per: PerEmployee; valid: ReturnType<typeof validateShift> })[] = [];
    if (!projectId) return out;
    for (const day of dates) {
      for (const eid of selected) {
        const per = settingsFor(eid);
        if (!per.start || !per.end) continue;
        const s = shiftFromLocal(day, per.start, per.end, tz);
        out.push({
          key: `${eid}|${day}`, date: day, per, employee_id: eid, project_id: projectId,
          starts_at: s.startsAt.toISOString(), ends_at: s.endsAt.toISOString(),
          valid: validateShift(s.startsAt, s.endsAt, Number(per.breakMin) || 0),
        });
      }
    }
    return out;
  }, [dates, selected, custom, taskId, start, end, breakMin, projectId, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  const conflicts = useMemo(() => {
    if (!sched.data || !d) return [];
    return findConflicts({
      proposed: slots, existing: sched.data.assignments, absences: sched.data.absences, projects: d.projects, tz,
      travelBufferMinutes: company?.travel_buffer_minutes ?? 30, employeeName: empName,
    });
  }, [slots, sched.data, d, tz, company]); // eslint-disable-line react-hooks/exhaustive-deps

  const blockedKeys = new Set(conflicts.filter((c) => c.blocking).map((c) => c.slotKey));
  const invalid = slots.filter((s) => !s.valid.ok);
  const toCreate = slots.filter((s) => s.valid.ok && (!blockedKeys.has(s.key) || false));
  const hasBlocking = blockedKeys.size > 0;
  const canSave = projectId && selected.length > 0 && slots.length > 0 && invalid.length === 0 && !sched.loading && !sched.error
    && (!hasBlocking || (skipConflicts && toCreate.length > 0));

  async function createTask() {
    if (!newTask.trim() || !project) return;
    setCreatingTask(true); setLocalError(null);
    const { data, error } = await supabase().from("tasks").insert({ company_id: project.company_id, project_id: project.id, name: newTask.trim() }).select().single();
    setCreatingTask(false);
    if (error) { setLocalError(humanError(error)); return; }
    setExtraTasks((x) => [...x, data as Task]);
    setTaskId((data as Task).id);
    setNewTask("");
  }

  async function save() {
    if (!project) return;
    setSaving(true); setSaveError(null);
    const rows = toCreate.map((s) => ({
      company_id: project.company_id, employee_id: s.employee_id, project_id: project.id, task_id: s.per.taskId || null,
      starts_at: s.starts_at, ends_at: s.ends_at, break_minutes: Number(s.per.breakMin) || 0, status: "planificata",
      created_by: membership?.user_id,
    }));
    // Un singur insert = atomic: ori se salvează toate, ori niciuna.
    const { error } = await supabase().from("assignments").insert(rows);
    setSaving(false);
    if (error) { setSaveError(humanError(error)); await sched.reload(); return; }
    setDone(rows.length);
  }

  function toggle(eid: string) {
    setSelected((s) => (s.includes(eid) ? s.filter((x) => x !== eid) : [...s, eid]));
  }
  function setPer(eid: string, patch: Partial<PerEmployee>) {
    setCustom((c) => ({ ...c, [eid]: { ...settingsFor(eid), ...patch } }));
  }

  if (refs.loading && !d) return <Loading />;
  if (refs.error) return <ErrorBox message={refs.error} onRetry={refs.reload} />;
  if (!d) return null;

  if (done !== null) {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-green-700" />
        <h1 className="mt-3 text-2xl font-bold">Alocări salvate</h1>
        <p className="mt-2 text-slate-700">{done} {done === 1 ? "alocare a fost creată" : "alocări au fost create"} pentru „{project?.name}”.</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/planning"><Button variant="primary" size="lg" className="w-full">Vezi în planning</Button></Link>
          <Button size="lg" onClick={() => { setDone(null); setSelected([]); setCustom({}); setProjectId(""); setTaskId(""); void sched.reload(); }}>Alocă altă echipă</Button>
        </div>
      </div>
    );
  }

  const activeProjects = d.projects.filter((p) => !["finalizata", "anulata"].includes(p.status))
    .filter((p) => !projectSearch || `${p.name} ${p.city ?? ""} ${p.address ?? ""} ${p.client_name ?? ""}`.toLowerCase().includes(projectSearch.toLowerCase()));
  const employees = d.employees.filter((e) => !empSearch || `${e.full_name} ${e.trade ?? ""} ${e.skills.join(" ")}`.toLowerCase().includes(empSearch.toLowerCase()));

  const step = (n: number, title: string, doneFlag: boolean) => (
    <span className="flex items-center gap-2">
      <span className={cx("flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold", doneFlag ? "bg-green-700 text-white" : "bg-slate-200 text-slate-700")}>
        {doneFlag ? <Check className="h-4 w-4" /> : n}
      </span>{title}
    </span>
  );

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Alocă angajați" subtitle="Lucrare → misiune → angajați → program → verificare" actions={<Link href="/planning"><Button>Înapoi la planning</Button></Link>} />
      <div className="space-y-4">
        {/* 1. Lucrarea */}
        <Card title={step(1, "Alege lucrarea", !!project)}>
          {project ? (
            <div className="flex items-start justify-between gap-3">
              <div style={{ borderLeft: `4px solid ${project.color}` }} className="pl-3">
                <div className="font-semibold">{project.name}</div>
                <div className="text-sm text-slate-600">{[project.address, project.city].filter(Boolean).join(", ") || "Fără adresă"}</div>
              </div>
              <Button size="sm" onClick={() => { setProjectId(""); setTaskId(""); setCustom({}); }}>Schimbă</Button>
            </div>
          ) : d.projects.length === 0 ? (
            <Empty title="Nu există lucrări" action={<Link href="/lucrari?nou=1"><Button variant="primary">Adaugă lucrare</Button></Link>} />
          ) : (
            <div className="space-y-2">
              <div className="relative"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Caută lucrare, oraș, client…" value={projectSearch} onChange={(e) => setProjectSearch(e.target.value)} /></div>
              <div className="max-h-72 space-y-1.5 overflow-y-auto">
                {activeProjects.map((p) => (
                  <button key={p.id} onClick={() => { setProjectId(p.id); setTaskId(""); setCustom({}); }}
                    className="flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-3 text-left hover:border-orange-400 hover:bg-orange-50" style={{ borderLeft: `5px solid ${p.color}` }}>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{p.name}</div>
                      <div className="flex items-center gap-1 truncate text-xs text-slate-600"><MapPin className="h-3 w-3" />{[p.address, p.city].filter(Boolean).join(", ") || "Fără adresă"}</div>
                    </div>
                    <Badge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</Badge>
                  </button>
                ))}
                {activeProjects.length === 0 && <p className="text-sm text-slate-500">Nicio lucrare activă găsită.</p>}
              </div>
            </div>
          )}
        </Card>

        {project && (
          <>
            {/* 2. Misiunea */}
            <Card title={step(2, "Alege sau creează misiunea", !!taskId)}>
              <div className="space-y-3">
                <Field label="Misiune (pentru toți cei selectați; se poate schimba individual la pasul 5)">
                  <Select value={taskId} onChange={(e) => { setTaskId(e.target.value); setCustom((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { ...v, taskId: e.target.value }]))); }}>
                    <option value="">— fără misiune —</option>
                    {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </Field>
                <div className="flex gap-2">
                  <Input placeholder="Misiune nouă, ex. Montaj rigips" value={newTask} onChange={(e) => setNewTask(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void createTask())} />
                  <Button onClick={createTask} loading={creatingTask} disabled={!newTask.trim()}>Creează</Button>
                </div>
                {localError && <ErrorBox message={localError} />}
              </div>
            </Card>

            {/* 3. Angajați */}
            <Card title={step(3, `Selectează angajații${selected.length ? ` (${selected.length})` : ""}`, selected.length > 0)}>
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Caută după nume, meserie, competență" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} /></div>
                  {d.teams.map((t) => (
                    <Button key={t.id} size="md" onClick={() => setSelected((s) => [...new Set([...s, ...d.employees.filter((e) => e.team_id === t.id).map((e) => e.id)])])}>+ {t.name}</Button>
                  ))}
                </div>
                <p className="text-xs text-slate-500">Disponibilitatea afișată este pentru {prettyDate(date)}.</p>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {employees.map((e) => {
                    const av = sched.data ? availabilityFor({ employeeId: e.id, workDays: e.work_days, weekday: isoWeekday(date), date, assignments: sched.data.assignments, absences: sched.data.absences, tz }) : null;
                    const on = selected.includes(e.id);
                    return (
                      <button key={e.id} onClick={() => toggle(e.id)} aria-pressed={on}
                        className={cx("flex items-center gap-3 rounded-lg border px-3 py-3 text-left", on ? "border-orange-500 bg-orange-50 ring-1 ring-orange-500" : "border-slate-200 hover:border-slate-400")}>
                        <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2", on ? "border-orange-600 bg-orange-600 text-white" : "border-slate-300")}>{on && <Check className="h-4 w-4" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{e.full_name}</span>
                          <span className="block truncate text-xs text-slate-600">{e.trade ?? "—"}</span>
                        </span>
                        {av && (av.kind === "disponibil" ? <Badge tone="green">Disponibil</Badge>
                          : av.kind === "absent" ? <Badge tone="red">{av.label}</Badge>
                          : av.kind === "nelucratoare" ? <Badge tone="gray">Zi liberă</Badge>
                          : <Badge tone={av.kind === "ocupat" ? "blue" : "amber"}>Programat {formatMinutes(av.minutes)}</Badge>)}
                      </button>
                    );
                  })}
                </div>
                {d.employees.length === 0 && <Empty title="Nu există angajați activi" action={<Link href="/angajati"><Button variant="primary">Adaugă angajați</Button></Link>} />}
              </div>
            </Card>

            {/* 4. Program */}
            <Card title={step(4, "Ziua, intervalul și pauza", !!date && !!start && !!end)}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Ziua" className="col-span-2 sm:col-span-1"><Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
                  <Field label="De la"><Input type="time" step={900} value={start} onChange={(e) => { setStart(e.target.value); setCustom({}); }} /></Field>
                  <Field label="Până la"><Input type="time" step={900} value={end} onChange={(e) => { setEnd(e.target.value); setCustom({}); }} /></Field>
                  <Field label="Pauză (min)"><Input type="number" min={0} step={5} inputMode="numeric" value={breakMin} onChange={(e) => { setBreakMin(e.target.value); setCustom({}); }} /></Field>
                </div>
                {end <= start && <Notice tone="blue">Intervalul trece peste miezul nopții (se termină a doua zi).</Notice>}
                <label className="flex items-center gap-3 text-sm font-medium">
                  <input type="checkbox" className="h-5 w-5 accent-orange-600" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
                  Repetă pe mai multe zile (lucrare de mai multe zile)
                </label>
                {repeat && (
                  <div className="space-y-3 rounded-lg bg-slate-50 p-3">
                    <Field label="Până la data (inclusiv)"><Input type="date" value={until} min={date} onChange={(e) => e.target.value && setUntil(e.target.value)} /></Field>
                    <div className="flex flex-wrap gap-1.5">
                      {[1, 2, 3, 4, 5, 6, 7].map((w) => (
                        <button key={w} onClick={() => setWeekdays((x) => x.includes(w) ? x.filter((y) => y !== w) : [...x, w])}
                          className={cx("h-10 w-12 rounded-lg border text-sm font-semibold", weekdays.includes(w) ? "border-orange-600 bg-orange-600 text-white" : "border-slate-300 bg-white")}>{WEEKDAY_SHORT[w]}</button>
                      ))}
                    </div>
                    <p className="text-xs text-slate-600">{dates.length} {dates.length === 1 ? "zi" : "zile"}: {dates.slice(0, 8).map(shortDate).join(", ")}{dates.length > 8 ? "…" : ""}. Fiecare zi devine o alocare separată, modificabilă individual.</p>
                  </div>
                )}
              </div>
            </Card>

            {/* 5. Personalizare */}
            {selected.length > 0 && (
              <Card title={step(5, "Personalizează pe angajat (opțional)", true)}>
                <div className="space-y-3">
                  {selected.map((eid) => {
                    const per = settingsFor(eid);
                    return (
                      <div key={eid} className="rounded-lg border border-slate-200 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-semibold">{empName(eid)}</span>
                          <button className="text-sm text-slate-500 underline" onClick={() => toggle(eid)}>Elimină</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                          <Select className="col-span-2 sm:col-span-1" value={per.taskId} onChange={(e) => setPer(eid, { taskId: e.target.value })} aria-label="Misiune">
                            <option value="">— fără misiune —</option>
                            {tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          </Select>
                          <Input type="time" step={900} value={per.start} onChange={(e) => setPer(eid, { start: e.target.value })} aria-label="De la" />
                          <Input type="time" step={900} value={per.end} onChange={(e) => setPer(eid, { end: e.target.value })} aria-label="Până la" />
                          <Input type="number" min={0} step={5} value={per.breakMin} onChange={(e) => setPer(eid, { breakMin: e.target.value })} aria-label="Pauză (min)" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* 6. Verificare */}
            {selected.length > 0 && (
              <Card title={step(6, "Verifică disponibilitatea și salvează", false)}>
                <div className="space-y-3">
                  {sched.loading && <Loading label="Verific programul…" />}
                  {sched.error && <ErrorBox message={sched.error} onRetry={sched.reload} />}
                  {invalid.length > 0 && <Notice tone="red">{invalid.length} intervale nu sunt valide: {invalid[0].valid.error}</Notice>}
                  {repeat && dates.length === 0 && <Notice tone="red">Nicio zi selectată pentru repetare.</Notice>}
                  <ConflictList items={conflicts} />
                  {!sched.loading && conflicts.length === 0 && invalid.length === 0 && slots.length > 0 && <Notice tone="green">Toți angajații selectați sunt disponibili. Nu există suprapuneri.</Notice>}
                  {hasBlocking && (
                    <label className="flex items-center gap-3 text-sm font-medium">
                      <input type="checkbox" className="h-5 w-5 accent-orange-600" checked={skipConflicts} onChange={(e) => setSkipConflicts(e.target.checked)} />
                      Salvează doar alocările fără conflict ({toCreate.length} din {slots.length})
                    </label>
                  )}
                  <div className="rounded-lg bg-slate-50 p-3 text-sm">
                    Se vor crea <strong>{hasBlocking ? (skipConflicts ? toCreate.length : 0) : toCreate.length}</strong> alocări individuale
                    {" "}pentru „{project.name}”, totalizând <strong>{formatMinutes((hasBlocking && !skipConflicts ? [] : toCreate).reduce((s, x) => s + x.valid.minutes, 0))}</strong> planificate.
                  </div>
                  {saveError && <ErrorBox message={saveError} />}
                  <Button variant="primary" size="lg" className="w-full" disabled={!canSave} loading={saving} onClick={save}>Salvează alocările</Button>
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
