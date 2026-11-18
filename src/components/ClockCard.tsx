"use client";
import { useCallback, useEffect, useState } from "react";
import { MapPin, Play, Square, Timer } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { humanError } from "@/lib/errors";
import { addressFor, locateOnce } from "@/lib/geo";
import { isNetworkError, runOrQueue } from "@/lib/offline";
import { formatMinutes } from "@/lib/hours";
import { localTime } from "@/lib/time";
import type { Assignment, Project, Task } from "@/lib/types";
import { PhotoPicker } from "./PhotoPicker";
import { Button, ErrorBox, Field, Input, Modal, Notice, Select, Textarea } from "./ui";

interface OpenClock { project_id: string; task_id: string | null; assignment_id: string | null; started_at: string; start_address?: string | null; local?: boolean }
const LOCAL = "dyas.clock.local";
const readLocal = (): OpenClock | null => { try { return JSON.parse(localStorage.getItem(LOCAL) ?? "null") as OpenClock | null; } catch { return null; } };
const forgetServer = (id: string) => { try { localStorage.setItem(`dyas.cache.clock.${id}`, "null"); } catch { /* ignoră */ } };
const writeLocal = (c: OpenClock | null) => { try { if (c) localStorage.setItem(LOCAL, JSON.stringify(c)); else localStorage.removeItem(LOCAL); } catch { /* ignoră */ } };

/** Pontaj cu un buton: „Am început” / „Am terminat”, cu ora și locul notate automat. */
export function ClockCard({ assignments, projects, tasks, onChanged }: {
  assignments: Assignment[]; projects: Map<string, Project>; tasks: Map<string, Task>; onChanged: () => Promise<void> | void;
}) {
  const { tz, employee, company } = useSession();
  const [clock, setClock] = useState<OpenClock | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const key = `dyas.cache.clock.${employee!.id}`;
    const { data, error } = await supabase().from("time_clocks").select("project_id,task_id,assignment_id,started_at,start_address").eq("employee_id", employee!.id).maybeSingle();
    const local = readLocal();
    if (!error) { try { localStorage.setItem(key, JSON.stringify(data ?? null)); } catch { /* ignoră */ } }
    let server = !error ? (data as OpenClock | null) : null;
    // fără semnal: ultima tură știută de pe server
    if (error && isNetworkError(error)) { try { server = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { server = null; } }
    if (server && !local) setClock(server);
    else if (!error && server) { writeLocal(null); setClock(server); }
    else setClock(local ? { ...local, local: true } : null);
    setLoaded(true);
  }, [employee]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  const current = assignments.find((a) => a.id === pick) ?? assignments[0];
  if (!loaded || (!clock && assignments.length === 0)) return null;

  async function start() {
    if (!current) return;
    setBusy(true); setErr(null); setInfo(null);
    const gps = await locateOnce(8000);
    const address = await addressFor(gps);
    const startedAt = new Date().toISOString();
    try {
      const r = await runOrQueue({
        kind: "clock_in", label: `Am început · ${projects.get(current.project_id)?.name ?? ""}`,
        args: { p_project: current.project_id, p_task: current.task_id, p_assignment: current.id, p_lat: gps?.lat ?? null, p_lon: gps?.lon ?? null, p_accuracy: gps?.accuracy ?? null, p_address: address, p_at: startedAt },
      });
      if (r.queued) {
        const c = { project_id: current.project_id, task_id: current.task_id, assignment_id: current.id, started_at: startedAt, start_address: address, local: true };
        writeLocal(c); setClock(c); setInfo("Fără semnal: ora de început e salvată pe telefon și se trimite când revine internetul.");
      } else await load();
    } catch (e) { setErr(humanError(e)); }
    setBusy(false);
  }

  async function cancel() {
    if (!window.confirm("Anulezi tura începută? Nu se salvează nicio oră.")) return;
    setErr(null);
    if (clock?.local) { writeLocal(null); setClock(null); return; }
    const { error } = await supabase().rpc("clock_cancel");
    if (error) setErr(humanError(error)); else { forgetServer(employee!.id); setClock(null); }
  }

  if (clock) {
    const p = projects.get(clock.project_id);
    const mins = Math.max(0, Math.round((Date.now() - new Date(clock.started_at).getTime()) / 60000));
    return (
      <section className="mb-4 overflow-hidden rounded-2xl border-2 border-green-400 bg-white shadow-sm">
        <div className="flex items-center gap-2 bg-green-50 px-4 py-3">
          <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-green-600" /></span>
          <h2 className="font-bold">Lucrezi acum</h2>
        </div>
        <div className="space-y-2 p-4">
          <div className="text-lg font-semibold" data-no-i18n>{p?.name ?? "Lucrare"}</div>
          <div className="flex items-center gap-2 text-2xl font-bold tabular-nums"><Timer className="h-6 w-6 text-green-700" />{formatMinutes(mins)}</div>
          <div className="text-sm text-slate-600">început la <strong>{localTime(clock.started_at, tz)}</strong></div>
          {clock.start_address && <div className="flex items-start gap-1 text-xs text-slate-500"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span data-no-i18n>{clock.start_address}</span></div>}
          {info && <Notice tone="amber">{info}</Notice>}
          {err && <ErrorBox message={err} />}
          <Button size="lg" variant="danger" className="w-full" onClick={() => setFinishing(true)}><Square className="h-5 w-5" />Am terminat</Button>
          <button className="w-full text-center text-xs text-slate-500 underline" onClick={cancel}>Anulează tura</button>
        </div>
        {finishing && <FinishDialog clock={clock} projectName={p?.name ?? ""} defaultBreak={employee?.break_minutes ?? company?.default_break_minutes ?? 60}
          companyId={company!.id} employeeId={employee!.id}
          onClose={() => setFinishing(false)}
          onDone={async (queued) => {
            setFinishing(false); writeLocal(null); forgetServer(employee!.id); setClock(null);
            setInfo(null);
            if (queued) setErr(null);
            await onChanged();
          }} />}
      </section>
    );
  }

  return (
    <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="font-bold">Pontaj cu un buton</h2>
      <p className="mt-0.5 text-sm text-slate-600">Apasă când începi lucrul. Ora și locul se notează singure.</p>
      {assignments.length > 1 && (
        <Field label="Lucrarea" className="mt-3">
          <Select value={current?.id ?? ""} onChange={(e) => setPick(e.target.value)}>
            {assignments.map((a) => <option key={a.id} value={a.id}>{projects.get(a.project_id)?.name}{a.task_id ? ` · ${tasks.get(a.task_id)?.name ?? ""}` : ""}</option>)}
          </Select>
        </Field>
      )}
      {err && <div className="mt-3"><ErrorBox message={err} /></div>}
      <Button size="lg" variant="success" className="mt-3 w-full" onClick={start} loading={busy}><Play className="h-5 w-5" />Am început</Button>
    </section>
  );
}

function FinishDialog({ clock, projectName, defaultBreak, companyId, employeeId, onClose, onDone }: {
  clock: OpenClock; projectName: string; defaultBreak: number; companyId: string; employeeId: string;
  onClose: () => void; onDone: (queued: boolean) => Promise<void>;
}) {
  const { tz } = useSession();
  const total = Math.max(1, Math.round((Date.now() - new Date(clock.started_at).getTime()) / 60000));
  const [brk, setBrk] = useState(String(total > defaultBreak + 30 ? defaultBreak : 0));
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const worked = Math.max(0, total - (Number(brk) || 0));

  async function finish() {
    setBusy(true); setErr(null);
    const gps = await locateOnce(8000);
    const address = await addressFor(gps);
    try {
      const r = await runOrQueue({
        kind: "clock_out", label: `Am terminat · ${projectName}`,
        args: { p_break: Number(brk) || 0, p_notes: notes.trim() || null, p_lat: gps?.lat ?? null, p_lon: gps?.lon ?? null, p_accuracy: gps?.accuracy ?? null, p_address: address, p_at: new Date().toISOString() },
        photos, meta: { companyId, employeeId },
      });
      if (r.queued) { setSavedOffline(true); setBusy(false); setTimeout(() => void onDone(true), 1800); return; }
      await onDone(false);
    } catch (e) { setErr(humanError(e)); }
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title="Am terminat"
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" onClick={finish} loading={busy} disabled={savedOffline}>Trimite pontajul</Button></>}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <div className="font-semibold" data-no-i18n>{projectName}</div>
          <div className="mt-1 tabular-nums">{localTime(clock.started_at, tz)} – {localTime(new Date().toISOString(), tz)}</div>
        </div>
        <Field label="Pauză (min)" hint="neplătite">
          <Input type="number" min={0} step={5} inputMode="numeric" value={brk} onChange={(e) => setBrk(e.target.value)} />
        </Field>
        <div className="rounded-xl bg-orange-50 p-3 text-sm">Timp efectiv lucrat: <strong>{formatMinutes(worked)}</strong></div>
        <Field label="Poze cu lucrarea (opțional)" hint="Dovadă pentru client: cum arată lucrarea la final.">
          <PhotoPicker photos={photos} onChange={setPhotos} label="Fă o poză" />
        </Field>
        <Field label="Observații (opțional)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {savedOffline && <Notice tone="amber">Fără semnal: pontajul și pozele sunt salvate pe telefon și se trimit singure când revine internetul.</Notice>}
        {err && <ErrorBox message={err} />}
      </div>
    </Modal>
  );
}
