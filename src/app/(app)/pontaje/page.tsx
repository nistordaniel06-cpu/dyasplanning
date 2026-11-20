"use client";
import { AbsenceStrip } from "@/components/AbsenceStrip";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Button, Empty, ErrorBox, Loading, Notice, PageHeader, Select, Tabs } from "@/components/ui";
import { EntryList } from "@/components/EntryList";
import { TimeEntryForm } from "@/components/TimeEntryForm";
import { CorrectDialog, HistoryDialog, RejectDialog } from "@/components/EntryDialogs";
import { PeriodPicker, presetRange, type Preset } from "@/components/PeriodPicker";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { byId, loadAbsences, loadAssignments, loadEmployees, loadProjects, loadTasks, loadTimeEntries } from "@/lib/data";
import { formatMinutes } from "@/lib/hours";
import { rangeUtc, todayIn } from "@/lib/time";
import type { Assignment, TimeEntry } from "@/lib/types";

export default function PontajePage() {
  return <RequireRole roles={["admin"]}><Pontaje /></RequireRole>;
}

function Pontaje() {
  const { tz } = useSession();
  const [tab, setTab] = useState<"aprobare" | "toate">("aprobare");
  const [preset, setPreset] = useState<Preset>("saptamana");
  const [custom, setCustom] = useState<[string, string]>([todayIn(tz), todayIn(tz)]);
  const [fEmployee, setFEmployee] = useState("");
  const [fProject, setFProject] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<{ entry: TimeEntry | null } | null>(null);
  const [rejecting, setRejecting] = useState<TimeEntry[] | null>(null);
  const [correcting, setCorrecting] = useState<TimeEntry | null>(null);
  const [history, setHistory] = useState<TimeEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  const [from, to] = presetRange(preset, tz, custom);

  const refs = useQuery(async () => {
    const [employees, projects, tasks] = await Promise.all([loadEmployees({ includeInactive: true }), loadProjects(), loadTasks()]);
    return { employees, projects, tasks };
  }, []);

  const q = useQuery(async () => {
    let entries: TimeEntry[];
    if (tab === "aprobare") {
      let qq = supabase().from("time_entries").select("*").eq("status", "trimis").order("started_at");
      if (fEmployee) qq = qq.eq("employee_id", fEmployee);
      if (fProject) qq = qq.eq("project_id", fProject);
      entries = must(await qq) as TimeEntry[];
    } else {
      const [f, t] = rangeUtc(from, to, tz);
      entries = await loadTimeEntries(f, t, { employeeId: fEmployee || undefined, projectId: fProject || undefined, status: fStatus || undefined });
    }
    const ids = [...new Set(entries.map((e) => e.assignment_id).filter(Boolean))] as string[];
    const assignments: Assignment[] = ids.length ? (must(await supabase().from("assignments").select("*").in("id", ids)) as Assignment[]) : [];
    const absences = tab === "aprobare" ? [] : (await loadAbsences(from, to)).filter((a) => !fEmployee || a.employee_id === fEmployee);
    return { entries, assignments, absences };
  }, [tab, from, to, fEmployee, fProject, fStatus, tz]);

  const formAssignments = useQuery(async () => {
    const [f, t] = rangeUtc(from, to, tz);
    return loadAssignments(f, t);
  }, [from, to, tz]);

  const employees = useMemo(() => byId(refs.data?.employees), [refs.data]);
  const projects = useMemo(() => byId(refs.data?.projects), [refs.data]);
  const tasks = useMemo(() => byId(refs.data?.tasks), [refs.data]);
  const assignments = useMemo(() => byId(q.data?.assignments), [q.data]);
  const entries = q.data?.entries ?? [];
  const totalMin = entries.reduce((s, e) => s + e.worked_minutes, 0);

  async function approve(ids: string[]) {
    setBusy(true); setMsg(null);
    const { error } = await supabase().from("time_entries").update({ status: "aprobat" }).in("id", ids);
    setBusy(false);
    if (error) { setMsg({ tone: "red", text: humanError(error) }); return; }
    setMsg({ tone: "green", text: ids.length === 1 ? "Pontaj aprobat." : `${ids.length} pontaje aprobate.` });
    setSelected(new Set());
    await q.reload();
  }
  async function remove(e: TimeEntry) {
    if (!window.confirm("Ștergi definitiv acest pontaj?")) return;
    const { error } = await supabase().from("time_entries").delete().eq("id", e.id);
    if (error) { setMsg({ tone: "red", text: humanError(error) }); return; }
    setMsg({ tone: "green", text: "Pontaj șters." });
    await q.reload();
  }

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selEntries = entries.filter((e) => selected.has(e.id) && e.status === "trimis");

  return (
    <div>
      <PageHeader title="Pontaje" subtitle="Orele efectiv lucrate — separate de planificare"
        actions={<Button variant="primary" onClick={() => setForm({ entry: null })} disabled={!refs.data}><Plus className="h-4 w-4" /> Adaugă pontaj</Button>} />

      <div className="mb-4 flex flex-col gap-3">
        <Tabs value={tab} onChange={(v) => { setTab(v); setSelected(new Set()); }} items={[{ value: "aprobare", label: "De aprobat" }, { value: "toate", label: "Toate pontajele" }]} />
        <div className="flex flex-wrap gap-2">
          {tab === "toate" && <PeriodPicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />}
          <Select className="w-auto" value={fEmployee} onChange={(e) => setFEmployee(e.target.value)} aria-label="Angajat">
            <option value="">Toți angajații</option>
            {refs.data?.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </Select>
          <Select className="w-auto" value={fProject} onChange={(e) => setFProject(e.target.value)} aria-label="Lucrare">
            <option value="">Toate lucrările</option>
            {refs.data?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          {tab === "toate" && (
            <Select className="w-auto" value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Status">
              <option value="">Toate statusurile</option>
              <option value="ciorna">Ciornă</option><option value="trimis">Trimis</option><option value="aprobat">Aprobat</option><option value="respins">Respins</option>
            </Select>
          )}
        </div>
      </div>

      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {(q.error || refs.error) && <ErrorBox message={(q.error || refs.error)!} onRetry={() => { void refs.reload(); void q.reload(); }} />}
      {(q.loading || refs.loading) && !q.data && <Loading />}

      {q.data && refs.data && <AbsenceStrip absences={q.data.absences} employees={employees} from={from} to={to} showEmployee />}
      {q.data && refs.data && (
        entries.length === 0 ? (
          <Empty title={tab === "aprobare" ? "Nu există pontaje care așteaptă aprobare" : "Niciun pontaj în perioada aleasă"}>
            {tab === "aprobare" ? "Pontajele trimise de angajați apar aici." : "Schimbă filtrele sau adaugă un pontaj."}
          </Empty>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
              <span>{entries.length} pontaje · total {formatMinutes(totalMin)}</span>
              {tab === "aprobare" && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setSelected(selected.size === entries.length ? new Set() : new Set(entries.map((e) => e.id)))}>
                    {selected.size === entries.length ? "Deselectează" : "Selectează tot"}
                  </Button>
                  {selEntries.length > 0 && <>
                    <Button size="sm" variant="danger" onClick={() => setRejecting(selEntries)}>Respinge ({selEntries.length})</Button>
                    <Button size="sm" variant="success" loading={busy} onClick={() => approve(selEntries.map((e) => e.id))}>Aprobă ({selEntries.length})</Button>
                  </>}
                </div>
              )}
            </div>
            <EntryList entries={entries} employees={employees} projects={projects} tasks={tasks} assignments={assignments}
              selectable={tab === "aprobare" ? (e) => e.status === "trimis" : undefined} selected={selected} onToggle={toggle}
              onHistory={setHistory}
              actions={(e) => (
                <>
                  {e.status === "trimis" && <>
                    <Button size="sm" variant="danger" onClick={() => setRejecting([e])}>Respinge</Button>
                    <Button size="sm" variant="success" disabled={busy} onClick={() => approve([e.id])}>Aprobă</Button>
                  </>}
                  {e.status === "aprobat" ? <Button size="sm" onClick={() => setCorrecting(e)}>Corectează</Button>
                    : <Button size="sm" onClick={() => setForm({ entry: e })}>Editează</Button>}
                  {e.status !== "aprobat" && e.status !== "trimis" && <Button size="sm" variant="ghost" onClick={() => remove(e)}>Șterge</Button>}
                </>
              )} />
          </>
        )
      )}

      {form && refs.data && (
        <TimeEntryForm entry={form.entry} employees={refs.data.employees.filter((e) => e.active || e.id === form.entry?.employee_id)} projects={refs.data.projects} tasks={refs.data.tasks}
          assignments={formAssignments.data ?? []} onClose={() => setForm(null)}
          onSaved={async (st) => { setForm(null); setMsg({ tone: "green", text: st === "aprobat" ? "Pontaj salvat și aprobat." : st === "trimis" ? "Pontaj salvat ca trimis." : "Pontaj salvat ca ciornă." }); await q.reload(); }} />
      )}
      {rejecting && <RejectDialog entries={rejecting} onClose={() => setRejecting(null)} onDone={async () => { setRejecting(null); setSelected(new Set()); setMsg({ tone: "green", text: "Pontaj respins; angajatul vede motivul." }); await q.reload(); }} />}
      {correcting && <CorrectDialog entry={correcting} onClose={() => setCorrecting(null)} onDone={async () => { setCorrecting(null); setMsg({ tone: "green", text: "Corecția a fost salvată în istoric." }); await q.reload(); }} />}
      {history && <HistoryDialog entry={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
