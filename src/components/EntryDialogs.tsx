"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { humanError } from "@/lib/errors";
import { formatMinutes, validateShift } from "@/lib/hours";
import { fmt, localDate, localTime, shiftFromLocal } from "@/lib/time";
import { ENTRY_STATUS, HISTORY_ACTION } from "@/lib/labels";
import type { TimeEntry, TimeEntryHistory } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Loading, Modal, Notice, Textarea } from "./ui";

export function RejectDialog({ entries, onClose, onDone }: { entries: TimeEntry[]; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabase().from("time_entries").update({ status: "respins", rejection_reason: reason.trim() }).in("id", entries.map((e) => e.id));
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title={entries.length === 1 ? "Respinge pontajul" : `Respinge ${entries.length} pontaje`}
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 3}>Respinge</Button></>}>
      <div className="space-y-3">
        <Field label="Motivul respingerii" hint="Angajatul vede motivul și poate corecta pontajul.">
          <Textarea autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex. Lipsește pauza de masă" />
        </Field>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}

export function CorrectDialog({ entry, onClose, onDone }: { entry: TimeEntry; onClose: () => void; onDone: () => void }) {
  const { tz } = useSession();
  const [date, setDate] = useState(localDate(entry.started_at, tz));
  const [start, setStart] = useState(localTime(entry.started_at, tz));
  const [end, setEnd] = useState(localTime(entry.ended_at, tz));
  const [breakMin, setBreakMin] = useState(String(entry.break_minutes));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = shiftFromLocal(date, start, end, tz);
  const v = validateShift(s.startsAt, s.endsAt, Number(breakMin) || 0);

  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabase().rpc("correct_approved_time_entry", {
      p_entry_id: entry.id, p_started_at: s.startsAt.toISOString(), p_ended_at: s.endsAt.toISOString(),
      p_break_minutes: Number(breakMin) || 0, p_reason: reason.trim(),
    });
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Corectează pontaj aprobat"
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" onClick={submit} loading={busy} disabled={!v.ok || reason.trim().length < 3}>Salvează corecția</Button></>}>
      <div className="space-y-4">
        <Notice tone="amber">Pontajul este deja aprobat. Corecția se înregistrează în istoric, împreună cu motivul și autorul.</Notice>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Data" className="col-span-2 sm:col-span-1"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Început"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Sfârșit"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Pauze (min)"><Input type="number" min={0} value={breakMin} onChange={(e) => setBreakMin(e.target.value)} /></Field>
        </div>
        <p className="text-sm">{v.ok ? <>Ore lucrate după corecție: <strong>{formatMinutes(v.minutes)}</strong> (înainte: {formatMinutes(entry.worked_minutes)})</> : <span className="text-red-700">{v.error}</span>}</p>
        <Field label="Motivul corecției (obligatoriu)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}

export function HistoryDialog({ entry, onClose }: { entry: TimeEntry; onClose: () => void }) {
  const { tz } = useSession();
  const q = useQuery(async () => must(await supabase().from("time_entry_history").select("*").eq("time_entry_id", entry.id).order("id")) as TimeEntryHistory[], [entry.id]);
  const summary = (d: Partial<TimeEntry> | null) => d && d.started_at && d.ended_at
    ? `${localDate(d.started_at, tz)} ${localTime(d.started_at, tz)}–${localTime(d.ended_at, tz)}, pauză ${d.break_minutes} min${d.status ? `, ${ENTRY_STATUS[d.status]?.label ?? d.status}` : ""}`
    : "";
  return (
    <Modal open onClose={onClose} title="Istoricul pontajului" footer={<Button onClick={onClose}>Închide</Button>}>
      {q.loading && <Loading />}
      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.data && q.data.length === 0 && <p className="text-sm text-slate-600">Nu există înregistrări în istoric.</p>}
      <ol className="space-y-3">
        {q.data?.map((h) => (
          <li key={h.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex justify-between gap-2"><strong>{HISTORY_ACTION[h.action] ?? h.action}</strong><span className="text-slate-500">{fmt(h.changed_at, tz, "dd.MM.yyyy HH:mm")}</span></div>
            {h.reason && <div className="mt-1 text-slate-700">Motiv: {h.reason}</div>}
            {h.action !== "creat" && h.old_data && summary(h.old_data) !== summary(h.new_data) && <div className="mt-1 text-xs text-slate-500">Înainte: {summary(h.old_data)}</div>}
            {h.new_data && <div className="mt-1 text-xs text-slate-600">{h.action === "creat" ? "" : "După: "}{summary(h.new_data)}</div>}
          </li>
        ))}
      </ol>
    </Modal>
  );
}

export function FlagDialog({ entry, onClose, onDone }: { entry: TimeEntry; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(entry.flag_note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true); setError(null);
    const { error } = await supabase().rpc("flag_time_entry", { p_entry_id: entry.id, p_note: note });
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    onDone();
  }
  return (
    <Modal open onClose={onClose} title="Semnalează o problemă"
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" onClick={submit} loading={busy}>{note.trim() ? "Salvează semnalarea" : "Șterge semnalarea"}</Button></>}>
      <div className="space-y-3">
        <Field label="Ce trebuie verificat?" hint="Administratorul vede nota la aprobare."><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
