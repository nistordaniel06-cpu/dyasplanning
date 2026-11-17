"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { NeedsEmployee } from "@/components/shell";
import { Button, Empty, ErrorBox, Loading, Notice, PageHeader, Tabs } from "@/components/ui";
import { EntryList } from "@/components/EntryList";
import { TimeEntryForm, type EntryPrefill } from "@/components/TimeEntryForm";
import { FlagDialog, HistoryDialog } from "@/components/EntryDialogs";
import { PeriodPicker, presetRange, type Preset } from "@/components/PeriodPicker";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { byId, loadAssignments, loadEmployees, loadProjects, loadTasks, loadTimeEntries } from "@/lib/data";
import { formatMinutes } from "@/lib/hours";
import { addDays, rangeUtc, todayIn } from "@/lib/time";
import type { TimeEntry } from "@/lib/types";

export default function PontajPage() {
  return <NeedsEmployee><Suspense fallback={<Loading />}><Pontaj /></Suspense></NeedsEmployee>;
}

function readPrefill(p: URLSearchParams): EntryPrefill | undefined {
  if (!p.get("lucrare")) return undefined;
  return {
    projectId: p.get("lucrare") ?? undefined, taskId: p.get("misiune"), assignmentId: p.get("alocare"),
    date: p.get("data") ?? undefined, start: p.get("start") ?? undefined, end: p.get("sfarsit") ?? undefined,
    breakMin: p.get("pauza") ? Number(p.get("pauza")) : undefined,
  };
}

function Pontaj() {
  const { tz, employee, role } = useSession();
  const isLeader = role === "sef_echipa";
  const [tab, setTab] = useState<"mele" | "echipa">("mele");
  const [preset, setPreset] = useState<Preset>("saptamana");
  const [custom, setCustom] = useState<[string, string]>([todayIn(tz), todayIn(tz)]);
  const search = useSearchParams();
  const router = useRouter();
  const [form, setForm] = useState<{ entry: TimeEntry | null; prefill?: EntryPrefill } | null>(null);
  useEffect(() => {
    const pf = readPrefill(new URLSearchParams(search.toString()));
    if (pf) setForm({ entry: null, prefill: pf });
  }, [search]);
  const [flagging, setFlagging] = useState<TimeEntry | null>(null);
  const [history, setHistory] = useState<TimeEntry | null>(null);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [from, to] = presetRange(preset, tz, custom);

  const refs = useQuery(async () => {
    const [employees, projects, tasks] = await Promise.all([loadEmployees({ includeInactive: true }), loadProjects(), loadTasks()]);
    // asignările recente — pentru legarea pontajului de programul planificat
    const t = todayIn(tz);
    const [f, tt] = rangeUtc(addDays(t, -31), addDays(t, 1), tz);
    const assignments = await loadAssignments(f, tt, { employeeId: employee!.id });
    return { employees, projects, tasks, assignments };
  }, [employee?.id]);

  const q = useQuery(async () => {
    const [f, t] = rangeUtc(from, to, tz);
    const all = await loadTimeEntries(f, t);
    return all;
  }, [from, to, tz]);

  const employees = useMemo(() => byId(refs.data?.employees), [refs.data]);
  const projects = useMemo(() => byId(refs.data?.projects), [refs.data]);
  const tasks = useMemo(() => byId(refs.data?.tasks), [refs.data]);
  const assignments = useMemo(() => byId(refs.data?.assignments), [refs.data]);

  const mine = (q.data ?? []).filter((e) => e.employee_id === employee!.id);
  const team = (q.data ?? []).filter((e) => e.employee_id !== employee!.id);
  const list = tab === "mele" ? mine : team;
  const sum = (s: string) => mine.filter((e) => e.status === s).reduce((a, e) => a + e.worked_minutes, 0);

  async function setStatus(e: TimeEntry, status: "trimis" | "ciorna") {
    const { error } = await supabase().from("time_entries").update({ status }).eq("id", e.id);
    if (error) { setMsg({ tone: "red", text: humanError(error) }); return; }
    setMsg({ tone: "green", text: status === "trimis" ? "Pontaj trimis spre aprobare." : "Pontaj readus în ciornă — îl poți modifica." });
    await q.reload();
  }
  async function remove(e: TimeEntry) {
    if (!window.confirm("Ștergi această ciornă?")) return;
    const { error } = await supabase().from("time_entries").delete().eq("id", e.id);
    if (error) { setMsg({ tone: "red", text: humanError(error) }); return; }
    await q.reload();
  }

  // Lucrările pe care angajatul le poate ponta = cele vizibile lui (RLS: unde e alocat).
  const myProjects = refs.data?.projects.filter((p) => p.status !== "anulata") ?? [];

  return (
    <div>
      <PageHeader title="Pontaj" subtitle="Înregistrează orele efectiv lucrate"
        actions={<Button variant="primary" size="lg" onClick={() => setForm({ entry: null })} disabled={!refs.data}><Plus className="h-5 w-5" /> Adaugă ore lucrate</Button>} />

      <div className="mb-4 flex flex-col gap-3">
        {isLeader && <Tabs value={tab} onChange={setTab} items={[{ value: "mele", label: "Pontajele mele" }, { value: "echipa", label: "Echipa mea" }]} />}
        <PeriodPicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
      </div>

      {tab === "mele" && q.data && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["Aprobate", "aprobat"], ["Trimise", "trimis"], ["Ciorne", "ciorna"], ["Respinse", "respins"]].map(([l, s]) => (
            <div key={s} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold text-slate-500">{l}</div>
              <div className="text-lg font-bold">{formatMinutes(sum(s))}</div>
            </div>
          ))}
        </div>
      )}

      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      {(q.error || refs.error) && <ErrorBox message={(q.error || refs.error)!} onRetry={() => { void refs.reload(); void q.reload(); }} />}
      {(q.loading || refs.loading) && !q.data && <Loading />}
      {q.data && refs.data && list.length === 0 && (
        <Empty title={tab === "mele" ? "Nu ai pontaje în această perioadă" : "Nu există pontaje ale echipei în această perioadă"}>
          {tab === "mele" && "Apasă „Adaugă ore lucrate” după ce termini lucrul."}
        </Empty>
      )}
      {q.data && refs.data && list.length > 0 && (
        <EntryList entries={list} employees={employees} projects={projects} tasks={tasks} assignments={assignments} showEmployee={tab === "echipa"}
          onHistory={setHistory}
          actions={(e) => tab === "echipa" ? (
            <Button size="sm" onClick={() => setFlagging(e)}>{e.flag_note ? "Modifică semnalarea" : "Semnalează problemă"}</Button>
          ) : (
            <>
              {(e.status === "ciorna" || e.status === "respins") && <>
                {e.status === "ciorna" && <Button size="sm" variant="ghost" onClick={() => remove(e)}>Șterge</Button>}
                <Button size="sm" onClick={() => setForm({ entry: e })}>Modifică</Button>
                <Button size="sm" variant="primary" onClick={() => setStatus(e, "trimis")}>Trimite pontaj</Button>
              </>}
              {e.status === "trimis" && <Button size="sm" onClick={() => setStatus(e, "ciorna")}>Retrage în ciornă</Button>}
            </>
          )} />
      )}

      {form && refs.data && (
        <TimeEntryForm entry={form.entry} prefill={form.prefill} employees={refs.data.employees} projects={myProjects} tasks={refs.data.tasks}
          assignments={refs.data.assignments} onClose={() => { setForm(null); router.replace("/pontaj"); }}
          onSaved={async (st) => { setForm(null); router.replace("/pontaj"); setMsg({ tone: "green", text: st === "trimis" ? "Pontaj trimis spre aprobare." : "Ciornă salvată." }); await q.reload(); }} />
      )}
      {flagging && <FlagDialog entry={flagging} onClose={() => setFlagging(null)} onDone={async () => { setFlagging(null); setMsg({ tone: "green", text: "Semnalarea a fost salvată." }); await q.reload(); }} />}
      {history && <HistoryDialog entry={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
