"use client";
// Validarea programului la final de zi: șeful de echipă (pentru echipa lui) și administratorul (pentru toți)
// verifică orele introduse, le corectează sau le adaugă dacă lipsesc, apoi le validează.
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCheck, ChevronLeft, ChevronRight, Pencil, Plus, ShieldCheck } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, StatusBadge } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { byId, loadAbsences, loadAssignments, loadEmployees, loadProjects, loadTasks } from "@/lib/data";
import { formatMinutes, workedMinutes } from "@/lib/hours";
import { ABSENCE_TYPE, ENTRY_STATUS } from "@/lib/labels";
import { addDays, localTime, prettyDate, rangeUtc, shiftFromLocal, todayIn } from "@/lib/time";
import type { Assignment, Employee, Project, Task, TimeEntry } from "@/lib/types";

export default function ValidarePage() {
  return <RequireRole roles={["admin", "sef_echipa"]}><Validare /></RequireRole>;
}

/** E deja în regulă pentru cine validează? (admin: aprobat; șef: validat sau aprobat) */
const isDone = (e: TimeEntry, admin: boolean) => e.status === "aprobat" || (!admin && !!e.validated_at && e.status !== "respins");

function Validare() {
  const { tz, isAdmin } = useSession();
  const today = todayIn(tz);
  const [date, setDate] = useState(today);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState<{ employee: Employee; entry: TimeEntry | null; plan?: Assignment } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  const refs = useQuery(async () => {
    const [employees, projects, tasks, scope] = await Promise.all([
      loadEmployees(), loadProjects(), loadTasks(),
      supabase().rpc("my_review_employee_ids").then((r) => new Set(((must(r) ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : (x as { my_review_employee_ids: string }).my_review_employee_ids)))),
    ]);
    return { employees: employees.filter((e) => scope.has(e.id)), projects, tasks };
  }, []);
  const q = useQuery(async () => {
    const [f, t] = rangeUtc(date, date, tz);
    const [assignments, entries, absences] = await Promise.all([
      loadAssignments(f, t),
      supabase().from("time_entries").select("*").gte("started_at", f).lt("started_at", t).order("started_at").then((r) => must(r) as TimeEntry[]),
      loadAbsences(date, date),
    ]);
    return { assignments: assignments.filter((a) => a.status !== "anulata"), entries, absences };
  }, [date, tz]);

  const projects = useMemo(() => byId(refs.data?.projects), [refs.data]);
  const people = useMemo(() => {
    const d = q.data;
    if (!refs.data || !d) return [];
    return refs.data.employees.map((e) => ({
      e,
      plan: d.assignments.filter((a) => a.employee_id === e.id),
      entries: d.entries.filter((x) => x.employee_id === e.id),
      absence: d.absences.find((a) => a.employee_id === e.id),
    })).filter((p) => showAll || p.plan.length > 0 || p.entries.length > 0 || p.absence)
      .sort((a, b) => Number(a.entries.every((x) => isDone(x, isAdmin)) && a.entries.length > 0) - Number(b.entries.every((x) => isDone(x, isAdmin)) && b.entries.length > 0) || a.e.full_name.localeCompare(b.e.full_name));
  }, [refs.data, q.data, showAll, isAdmin]);

  const pending = people.flatMap((p) => p.entries.filter((x) => !isDone(x, isAdmin) && x.status !== "respins"));
  const missing = people.filter((p) => p.plan.length > 0 && p.entries.length === 0 && !p.absence);
  const doneCount = people.filter((p) => p.entries.length > 0 && p.entries.every((x) => isDone(x, isAdmin))).length;

  async function validate(ids: string[], label: string) {
    if (!ids.length) return;
    setBusy(label); setMsg(null);
    const { data, error } = await supabase().rpc("validate_day_entries", { p_ids: ids });
    setBusy(null);
    if (error) { setMsg({ tone: "red", text: humanError(error) }); return; }
    setMsg({ tone: "green", text: `${data ?? ids.length} ${Number(data) === 1 ? "program validat" : "programe validate"}${isAdmin ? " și aprobate" : ""}.` });
    await q.reload();
  }

  const err = refs.error || q.error;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Validare program" subtitle={isAdmin ? "Verifici orele introduse de toți. Validarea le și aprobă." : "Verifici orele echipei tale la final de zi. Administratorul le aprobă apoi."} />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDate(addDays(date, -1))} aria-label="Ziua anterioară"><ChevronLeft className="h-5 w-5" /></Button>
        <Input type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="!w-40" aria-label="Ziua" />
        <Button onClick={() => setDate(addDays(date, 1))} disabled={date >= today} aria-label="Ziua următoare"><ChevronRight className="h-5 w-5" /></Button>
        <span className="w-full font-semibold sm:w-auto">{prettyDate(date)}</span>
        <label className="ml-auto flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />Arată și pe cei fără program</label>
      </div>

      {err && <ErrorBox message={err} onRetry={() => { void refs.reload(); void q.reload(); }} />}
      {(!refs.data || !q.data) && !err && <Loading />}

      {refs.data && q.data && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
            <Badge tone="green">{doneCount} validați</Badge>
            <Badge tone={pending.length ? "amber" : "gray"}>{pending.length} de validat</Badge>
            {missing.length > 0 && <Badge tone="red">{missing.length} fără ore</Badge>}
            <Button variant="primary" className="ml-auto" disabled={!pending.length} loading={busy === "all"}
              onClick={() => validate(pending.map((x) => x.id), "all")}><CheckCheck className="h-4 w-4" />Validează tot ({pending.length})</Button>
          </div>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          {people.length === 0 && <Empty title="Nimeni programat în această zi">Bifează „Arată și pe cei fără program” ca să adaugi ore cuiva.</Empty>}

          <ul className="space-y-3">
            {people.map(({ e, plan, entries, absence }) => {
              const todo = entries.filter((x) => !isDone(x, isAdmin) && x.status !== "respins");
              const total = entries.filter((x) => x.status !== "respins").reduce((a, x) => a + x.worked_minutes, 0);
              const allDone = entries.length > 0 && todo.length === 0 && entries.every((x) => x.status !== "respins");
              return (
                <li key={e.id} className={`rounded-xl border bg-white p-3 ${allDone ? "border-green-300" : entries.length === 0 && plan.length ? "border-red-300" : "border-slate-200"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-base">{e.full_name}</strong>
                    {absence && <StatusBadge s={ABSENCE_TYPE[absence.type]} />}
                    {allDone && <Badge tone="green"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />Validat</Badge>}
                    <span className="ml-auto text-sm text-slate-600">Total: <strong className="tabular-nums">{formatMinutes(total)}</strong></span>
                  </div>
                  {plan.length > 0 && (
                    <p className="mt-1 text-sm text-slate-600">Planificat: {plan.map((a) => `${projects.get(a.project_id)?.name ?? "—"} ${localTime(a.starts_at, tz)}–${localTime(a.ends_at, tz)}`).join(" · ")}</p>
                  )}
                  {entries.length === 0 ? (
                    <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-red-700"><AlertTriangle className="h-4 w-4" />{absence ? "Absent — fără ore" : "Nu are ore introduse"}</p>
                  ) : (
                    <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-100">
                      {entries.map((x) => (
                        <li key={x.id} className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center">
                          <div className="min-w-0 sm:flex-1">
                            <div className="font-semibold">{projects.get(x.project_id)?.name ?? "—"}</div>
                            <div className="tabular-nums text-slate-600">{localTime(x.started_at, tz)}–{localTime(x.ended_at, tz)} · pauză {x.break_minutes} min · <strong>{formatMinutes(x.worked_minutes)}</strong></div>
                            {x.notes && <div className="text-xs text-slate-500">{x.notes}</div>}
                            {x.status === "respins" && x.rejection_reason && <div className="text-xs text-red-700">Respins: {x.rejection_reason}</div>}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge s={ENTRY_STATUS[x.status]} />
                            {x.validated_at && x.status !== "aprobat" && <Badge tone="green">validat de șef</Badge>}
                            {(isAdmin || x.status !== "aprobat") && <Button size="sm" variant="ghost" onClick={() => setForm({ employee: e, entry: x })}><Pencil className="h-4 w-4" />Modifică</Button>}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {todo.length > 0 && <Button variant="primary" loading={busy === e.id} onClick={() => validate(todo.map((x) => x.id), e.id)}><CheckCheck className="h-4 w-4" />Corect — validează</Button>}
                    {entries.length === 0 && plan[0] && <Button onClick={() => setForm({ employee: e, entry: null, plan: plan[0] })}><Plus className="h-4 w-4" />Adaugă după planificare</Button>}
                    <Button variant="ghost" onClick={() => setForm({ employee: e, entry: null })}><Plus className="h-4 w-4" />Adaugă ore</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {form && refs.data && (
        <ReviewForm date={date} tz={tz} employee={form.employee} entry={form.entry} plan={form.plan} projects={refs.data.projects} tasks={refs.data.tasks}
          onClose={() => setForm(null)} onSaved={async (text) => { setForm(null); setMsg({ tone: "green", text }); await q.reload(); }} />
      )}
    </div>
  );
}

function ReviewForm({ date, tz, employee, entry, plan, projects, tasks, onClose, onSaved }: {
  date: string; tz: string; employee: Employee; entry: TimeEntry | null; plan?: Assignment; projects: Project[]; tasks: Task[];
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const src = entry ?? plan;
  const [projectId, setProjectId] = useState(entry?.project_id ?? plan?.project_id ?? "");
  const [taskId, setTaskId] = useState(entry?.task_id ?? plan?.task_id ?? "");
  const [start, setStart] = useState(src ? localTime(entry ? entry.started_at : plan!.starts_at, tz) : "08:00");
  const [end, setEnd] = useState(src ? localTime(entry ? entry.ended_at : plan!.ends_at, tz) : "16:00");
  const [pause, setPause] = useState(String(entry?.break_minutes ?? plan?.break_minutes ?? 30));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = projects.filter((p) => !["anulata"].includes(p.status) || p.id === projectId);
  const { startsAt, endsAt } = shiftFromLocal(date, start, end, tz);
  const minutes = workedMinutes(startsAt, endsAt, Number(pause) || 0);

  async function save() {
    if (!projectId) { setError("Alege lucrarea."); return; }
    if (minutes <= 0) { setError("Verifică orele: timpul lucrat iese 0 sau negativ."); return; }
    setBusy(true); setError(null);
    const { error: e } = await supabase().rpc("review_save_time_entry", {
      p_id: entry?.id ?? null, p_employee_id: employee.id, p_project_id: projectId, p_task_id: taskId || null,
      p_started_at: startsAt.toISOString(), p_ended_at: endsAt.toISOString(), p_break_minutes: Number(pause) || 0,
      p_notes: notes.trim() || null, p_reason: reason.trim() || null,
    });
    setBusy(false);
    if (e) { setError(humanError(e)); return; }
    onSaved(`${employee.full_name}: ${start}–${end} ${entry ? "corectat" : "adăugat"} și validat. Angajatul a fost anunțat.`);
  }

  return (
    <Modal open onClose={onClose} title={`${entry ? "Corectează" : "Adaugă"} programul — ${employee.full_name}`}
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" onClick={save} loading={busy}>Salvează și validează</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{prettyDate(date)}</p>
        <Field label="Lucrarea">
          <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId(""); }}>
            <option value="">— alege —</option>
            {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        {tasks.some((t) => t.project_id === projectId) && (
          <Field label="Misiune (opțional)">
            <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">Fără misiune</option>
              {tasks.filter((t) => t.project_id === projectId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Început"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Sfârșit"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Pauză (min)"><Input inputMode="numeric" value={pause} onChange={(e) => setPause(e.target.value.replace(/[^\d]/g, ""))} /></Field>
        </div>
        <p className="-mt-2 text-sm">Lucrat: <strong className="tabular-nums">{minutes > 0 ? formatMinutes(minutes) : "—"}</strong></p>
        <Field label="Notă (opțional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Motivul corectării (îl vede angajatul)"><Input placeholder="ex. a plecat la 15:00, a uitat să ponteze" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
