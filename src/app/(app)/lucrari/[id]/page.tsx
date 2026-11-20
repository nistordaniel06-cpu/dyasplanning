"use client";
import { ProjectExtras } from "@/components/ProjectExtras";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, MapPin, Navigation, Pencil, Phone, Plus, Trash2, ClipboardPlus } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, ProgressBar, Select, StatusBadge, Textarea } from "@/components/ui";
import { ProjectForm } from "@/components/ProjectForm";
import { TaskProgressDialog } from "@/components/TaskProgressDialog";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { byId, loadEmployees, loadProjects } from "@/lib/data";
import { ENTRY_STATUS, PROJECT_STATUS, TASK_STATUS, mapsUrl } from "@/lib/labels";
import { formatMinutes } from "@/lib/hours";
import { plannedMinutes } from "@/lib/reports";
import { fmt, localDate, localTime, shortDate, todayIn } from "@/lib/time";
import type { Assignment, Note, Project, Task, TaskStatus, TimeEntry } from "@/lib/types";

export default function LucrarePage() {
  return <RequireRole roles={["admin"]}><Lucrare /></RequireRole>;
}

function Lucrare() {
  const { id } = useParams<{ id: string }>();
  const { tz, user, membership } = useSession();
  const [editOpen, setEditOpen] = useState(false);
  const [taskForm, setTaskForm] = useState<{ task: Task | null } | null>(null);
  const [progressTask, setProgressTask] = useState<Task | null>(null);
  const [note, setNote] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery(async () => {
    const sb = supabase();
    const [project, tasks, assignments, entries, notes, employees, projects] = await Promise.all([
      sb.from("projects").select("*").eq("id", id).maybeSingle(),
      sb.from("tasks").select("*").eq("project_id", id).order("created_at"),
      sb.from("assignments").select("*").eq("project_id", id).order("starts_at"),
      sb.from("time_entries").select("*").eq("project_id", id).order("started_at", { ascending: false }),
      sb.from("notes").select("*").eq("project_id", id).order("created_at", { ascending: false }),
      loadEmployees({ includeInactive: true }), loadProjects(),
    ]);
    return {
      project: must(project) as Project | null, tasks: must(tasks) as Task[], assignments: must(assignments) as Assignment[],
      entries: must(entries) as TimeEntry[], notes: must(notes) as Note[], employees, projects,
    };
  }, [id]);

  const d = q.data;
  const employees = useMemo(() => byId(d?.employees), [d]);
  const tasks = useMemo(() => byId(d?.tasks), [d]);

  if (q.loading && !d) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!d) return null;
  if (!d.project) return <Empty title="Lucrarea nu există" action={<Link href="/lucrari"><Button>Înapoi la lucrări</Button></Link>} />;

  const p = d.project;
  const active = d.assignments.filter((a) => a.status !== "anulata");
  const planned = active.reduce((s, a) => s + plannedMinutes(a), 0);
  const sumBy = (st: string) => d.entries.filter((e) => e.status === st).reduce((s, e) => s + e.worked_minutes, 0);
  const today = todayIn(tz);
  const upcoming = active.filter((a) => localDate(a.starts_at, tz) >= today).slice(0, 30);
  const teamIds = [...new Set(active.map((a) => a.employee_id))];
  const nav = mapsUrl(p.address, p.city);
  const plannedByTask = (tid: string) => active.filter((a) => a.task_id === tid).reduce((s, a) => s + plannedMinutes(a), 0);
  const workedByTask = (tid: string) => d.entries.filter((e) => e.task_id === tid && e.status !== "respins").reduce((s, e) => s + e.worked_minutes, 0);

  async function addNote() {
    if (!note.trim()) return;
    setNoteBusy(true); setErr(null);
    const { error } = await supabase().from("notes").insert({ company_id: p.company_id, project_id: p.id, author_user_id: user.id, author_name: membership?.display_name ?? user.email, body: note.trim() });
    setNoteBusy(false);
    if (error) { setErr(humanError(error)); return; }
    setNote("");
    await q.reload();
  }

  return (
    <div className="space-y-4">
      <Link href="/lucrari" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />Lucrări</Link>
      <PageHeader title={p.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge s={PROJECT_STATUS[p.status]} />{p.client_name && <span>Client: {p.client_name}</span>}</span>}
        actions={<>
<a href="#lucru-extra"><Button><ClipboardPlus className="h-4 w-4" />Lucru extra</Button></a>
                    {nav && <a href={nav} target="_blank" rel="noreferrer"><Button><Navigation className="h-4 w-4" />Navigație</Button></a>}
          <Button onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" />Modifică</Button>
          <Link href={`/planning/aloca?lucrare=${p.id}`}><Button variant="primary"><Plus className="h-4 w-4" />Alocă angajați</Button></Link>
        </>} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold text-slate-500">ORE PLANIFICATE</div><div className="text-2xl font-bold">{formatMinutes(planned)}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold text-slate-500">ORE APROBATE</div><div className="text-2xl font-bold">{formatMinutes(sumBy("aprobat"))}</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold text-slate-500">ÎN AȘTEPTARE</div><div className="text-2xl font-bold">{formatMinutes(sumBy("trimis"))}</div><div className="text-xs text-slate-500">trimise, neaprobate</div></div>
        <div className="rounded-xl border border-slate-200 bg-white p-4"><div className="text-xs font-semibold text-slate-500">ECHIPĂ</div><div className="text-2xl font-bold">{teamIds.length}</div><div className="text-xs text-slate-500">angajați alocați</div></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={`Misiuni (${d.tasks.length})`} action={<Button size="sm" onClick={() => setTaskForm({ task: null })}><Plus className="h-4 w-4" />Misiune</Button>}>
            {d.tasks.length === 0 ? <p className="text-sm text-slate-600">Nicio misiune. Adaugă activități precum montaj rigips, instalații electrice, zugrăvit.</p> : (
              <ul className="divide-y divide-slate-100">
                {d.tasks.map((t) => {
                  const overdue = t.due_date && t.due_date < today && t.status !== "finalizata";
                  return (
                    <li key={t.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{t.name}</span>
                        <StatusBadge s={TASK_STATUS[t.status]} />
                        {overdue && <Badge tone="red">Întârziată</Badge>}
                        <span className="ml-auto flex gap-1">
                          <Button size="sm" onClick={() => setProgressTask(t)}>Progres</Button>
                          <Button size="sm" variant="ghost" onClick={() => setTaskForm({ task: t })} aria-label="Modifică"><Pencil className="h-4 w-4" /></Button>
                        </span>
                      </div>
                      <div className="mt-1.5"><ProgressBar value={t.progress} /></div>
                      <div className="mt-1 text-xs text-slate-500">
                        {t.due_date ? `Termen ${t.due_date} · ` : ""}Planificat {formatMinutes(plannedByTask(t.id))} · Pontat {formatMinutes(workedByTask(t.id))}
                        {" · "}{active.filter((a) => a.task_id === t.id).map((a) => a.employee_id).filter((v, i, arr) => arr.indexOf(v) === i).map((eid) => employees.get(eid)?.full_name).join(", ") || "neatribuită"}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div id="lucru-extra" className="scroll-mt-20">
            <Card title="Lucru extra (în afara proiectului)">
              <ProjectExtras projectId={id} />
            </Card>
          </div>
          <Card title="Program (următoarele alocări)">
            {upcoming.length === 0 ? <p className="text-sm text-slate-600">Nicio alocare viitoare.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {upcoming.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 py-2">
                    <span className="w-20 font-medium">{shortDate(localDate(a.starts_at, tz))}</span>
                    <span className="w-24 tabular-nums">{localTime(a.starts_at, tz)}–{localTime(a.ends_at, tz)}</span>
                    <span className="font-semibold">{employees.get(a.employee_id)?.full_name}</span>
                    <span className="text-slate-600">{a.task_id ? tasks.get(a.task_id)?.name : "fără misiune"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Pontaje pe lucrare">
            {d.entries.length === 0 ? <p className="text-sm text-slate-600">Niciun pontaj înregistrat.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {d.entries.slice(0, 25).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-3 py-2">
                    <span className="w-20">{shortDate(localDate(e.started_at, tz))}</span>
                    <span className="font-semibold">{employees.get(e.employee_id)?.full_name}</span>
                    <span className="tabular-nums text-slate-600">{localTime(e.started_at, tz)}–{localTime(e.ended_at, tz)}</span>
                    <span className="font-semibold">{formatMinutes(e.worked_minutes)}</span>
                    <span className="ml-auto"><StatusBadge s={ENTRY_STATUS[e.status]} /></span>
                  </li>
                ))}
              </ul>
            )}
            {d.entries.length > 25 && <Link href={`/rapoarte?lucrare=${p.id}`} className="mt-2 inline-block text-sm font-semibold text-orange-700 underline">Vezi toate în rapoarte</Link>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Detalii">
            <dl className="space-y-2 text-sm">
              {(p.address || p.city) && <div className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />{[p.address, p.city].filter(Boolean).join(", ")}</div>}
              {p.contact_name && <div className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /><span>{p.contact_name}{p.contact_phone && <> · <a href={`tel:${p.contact_phone}`} className="font-semibold text-orange-700 underline">{p.contact_phone}</a></>}</span></div>}
              <div><dt className="inline text-slate-500">Perioadă: </dt><dd className="inline">{p.start_date ?? "?"} → {p.due_date ?? "?"}</dd></div>
              <div><dt className="inline text-slate-500">Responsabil: </dt><dd className="inline">{p.manager_employee_id ? employees.get(p.manager_employee_id)?.full_name : "—"}</dd></div>
              {p.description && <p className="whitespace-pre-line text-slate-700">{p.description}</p>}
            </dl>
          </Card>
          <Card title={`Echipa (${teamIds.length})`}>
            {teamIds.length === 0 ? <p className="text-sm text-slate-600">Niciun angajat alocat.</p> : (
              <ul className="space-y-1 text-sm">
                {teamIds.map((eid) => {
                  const e = employees.get(eid);
                  return <li key={eid}><Link href={`/angajati/${eid}`} className="font-medium hover:underline">{e?.full_name}</Link> <span className="text-slate-500">{e?.trade}</span></li>;
                })}
              </ul>
            )}
          </Card>
          <Card title="Observații">
            <div className="space-y-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Adaugă o observație…" />
              <Button size="sm" onClick={addNote} loading={noteBusy} disabled={!note.trim()}>Adaugă observația</Button>
              {err && <ErrorBox message={err} />}
            </div>
            <ul className="mt-4 space-y-3">
              {d.notes.map((n) => (
                <li key={n.id} className="text-sm">
                  <div className="text-xs text-slate-500">{n.author_name ?? "—"} · {fmt(n.created_at, tz, "dd.MM.yyyy HH:mm")}{n.task_id ? ` · ${tasks.get(n.task_id)?.name}` : ""}</div>
                  <p className="whitespace-pre-line">{n.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {editOpen && <ProjectForm project={p} employees={d.employees.filter((e) => e.active)} usedColors={d.projects.map((x) => x.color)} onClose={() => setEditOpen(false)} onSaved={async () => { setEditOpen(false); await q.reload(); }} />}
      {taskForm && <TaskForm project={p} task={taskForm.task} onClose={() => setTaskForm(null)} onSaved={async () => { setTaskForm(null); await q.reload(); }} />}
      {progressTask && <TaskProgressDialog task={progressTask} onClose={() => setProgressTask(null)} onDone={async () => { setProgressTask(null); await q.reload(); }} />}
    </div>
  );
}

function TaskForm({ project, task, onClose, onSaved }: { project: Project; task: Task | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(task?.name ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [due, setDue] = useState(task?.due_date ?? "");
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "neinceputa");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    const payload = { name: name.trim(), description: description.trim() || null, due_date: due || null, status };
    const sb = supabase();
    const { error } = task ? await sb.from("tasks").update(payload).eq("id", task.id) : await sb.from("tasks").insert({ ...payload, company_id: project.company_id, project_id: project.id });
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    onSaved();
  }
  async function remove() {
    if (!task || !window.confirm("Ștergi misiunea? Alocările și pontajele rămân, dar fără misiune.")) return;
    setBusy(true);
    const { error } = await supabase().from("tasks").delete().eq("id", task.id);
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={task ? "Modifică misiunea" : "Misiune nouă"}
      footer={<>
        {task && <Button variant="danger" className="sm:mr-auto" onClick={remove}><Trash2 className="h-4 w-4" />Șterge</Button>}
        <Button onClick={onClose}>Renunță</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!name.trim()}>Salvează</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Denumire"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Montaj rigips" /></Field>
        <Field label="Descriere / instrucțiuni"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Termen"><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
              {Object.entries(TASK_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
        </div>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
