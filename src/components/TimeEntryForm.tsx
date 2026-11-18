"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { humanError } from "@/lib/errors";
import { formatMinutes, validateShift } from "@/lib/hours";
import { localDate, localTime, shiftFromLocal, todayIn } from "@/lib/time";
import { employeeSchedule } from "@/lib/schedule";
import type { Assignment, Employee, Project, Task, TimeEntry, TimeEntryStatus } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Modal, Notice, Select, Textarea } from "./ui";
import { PhotoPicker } from "./PhotoPicker";
import { PhotoThumbs, useEntryPhotos } from "./EntryPhotos";
import { isNetworkError, runOrQueue } from "@/lib/offline";
import { attachEntryPhotos } from "@/lib/media";

export interface EntryPrefill {
  employeeId?: string;
  projectId?: string;
  taskId?: string | null;
  assignmentId?: string | null;
  date?: string;
  start?: string;
  end?: string;
  breakMin?: number;
}

/**
 * Pontaj manual: ora de început, ora de sfârșit și pauzele neplătite.
 * Orele lucrate sunt calculate (și verificate) în baza de date.
 */
export function TimeEntryForm({ entry, prefill, employees, projects, tasks, assignments, onClose, onSaved }: {
  entry?: TimeEntry | null;
  prefill?: EntryPrefill;
  employees: Employee[];
  projects: Project[];
  tasks: Task[];
  assignments?: Assignment[];
  onClose: () => void;
  onSaved: (status: TimeEntryStatus) => void;
}) {
  const { tz, isAdmin, employee, company } = useSession();
  const [employeeId, setEmployeeId] = useState(entry?.employee_id ?? prefill?.employeeId ?? employee?.id ?? "");
  const [projectId, setProjectId] = useState(entry?.project_id ?? prefill?.projectId ?? "");
  const [taskId, setTaskId] = useState(entry?.task_id ?? prefill?.taskId ?? "");
  const [date, setDate] = useState(entry ? localDate(entry.started_at, tz) : prefill?.date ?? todayIn(tz));
  // implicit: programul angajatului (07:00–16:00, pauză 60 min = 8 ore, dacă nu s-a setat altul)
  const sched = employeeSchedule(employees.find((x) => x.id === (entry?.employee_id ?? prefill?.employeeId ?? employee?.id)) ?? employee, company);
  const [start, setStart] = useState(entry ? localTime(entry.started_at, tz) : prefill?.start ?? sched.start);
  const [end, setEnd] = useState(entry ? localTime(entry.ended_at, tz) : prefill?.end ?? sched.end);
  const [breakMin, setBreakMin] = useState(String(entry?.break_minutes ?? prefill?.breakMin ?? sched.breakMin));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [busy, setBusy] = useState<TimeEntryStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [savedOffline, setSavedOffline] = useState(false);
  const existingPhotos = useEntryPhotos(entry ? [entry.id] : []);

  const shift = useMemo(() => (date && start && end ? shiftFromLocal(date, start, end, tz) : null), [date, start, end, tz]);
  const v = shift ? validateShift(shift.startsAt, shift.endsAt, Number(breakMin) || 0) : { ok: false, error: "Completează data și orele.", minutes: 0 };
  const projTasks = tasks.filter((t) => t.project_id === projectId);

  // Leagă automat pontajul de alocarea din aceeași zi și lucrare (pentru comparația planificat/efectiv).
  const linkedAssignment = useMemo(() => {
    if (prefill?.assignmentId && !entry) return prefill.assignmentId;
    if (entry?.assignment_id) return entry.assignment_id;
    return (assignments ?? []).find((a) => a.employee_id === employeeId && a.project_id === projectId && a.status !== "anulata" && localDate(a.starts_at, tz) === date)?.id ?? null;
  }, [assignments, employeeId, projectId, date, tz, entry, prefill]);

  const planned = (assignments ?? []).find((a) => a.id === linkedAssignment);

  async function save(status: TimeEntryStatus) {
    if (!shift || !v.ok || !projectId || !employeeId) return;
    setBusy(status); setError(null);
    const payload = {
      employee_id: employeeId, project_id: projectId, task_id: taskId || null, assignment_id: linkedAssignment,
      started_at: shift.startsAt.toISOString(), ended_at: shift.endsAt.toISOString(),
      break_minutes: Number(breakMin) || 0, notes: notes.trim() || null, status,
    };
    const sb = supabase();
    if (!entry) {
      // pontaj nou: fără semnal se salvează pe telefon și se trimite mai târziu (cu tot cu poze)
      try {
        const r = await runOrQueue({
          kind: "time_entry", label: `Pontaj ${date} ${start}–${end}`,
          row: { ...payload, company_id: company!.id }, photos, meta: { companyId: company!.id, employeeId },
        });
        setBusy(null);
        if (r.queued) { setSavedOffline(true); setTimeout(() => onSaved(status), 1800); return; }
        onSaved(status);
      } catch (e) { setBusy(null); setError(humanError(e)); }
      return;
    }
    const res = await sb.from("time_entries").update(payload).eq("id", entry.id).select().single();
    if (!res.error && photos.length) {
      try { await attachEntryPhotos({ companyId: company!.id, employeeId: entry.employee_id, entryId: entry.id, photos }); }
      catch (e) { setBusy(null); setError(humanError(e)); return; }
    }
    setBusy(null);
    if (res.error) { setError(isNetworkError(res.error) ? "Fără semnal: modificarea unui pontaj existent se poate face când revine internetul." : humanError(res.error)); return; }
    onSaved(status);
  }

  const visibleProjects = projects.filter((p) => !["anulata"].includes(p.status) || p.id === projectId);
  const canEdit = !entry || (entry.status !== "aprobat" && (isAdmin || entry.status === "ciorna" || entry.status === "respins"));

  return (
    <Modal open onClose={onClose} title={entry ? "Modifică pontajul" : "Adaugă pontaj"}
      footer={canEdit ? (
        <>
          <Button onClick={onClose}>Renunță</Button>
          <Button onClick={() => save("ciorna")} loading={busy === "ciorna"} disabled={!v.ok || !projectId || !employeeId}>Salvează ciornă</Button>
          {isAdmin && <Button variant="success" onClick={() => save("aprobat")} loading={busy === "aprobat"} disabled={!v.ok || !projectId || !employeeId}>Salvează și aprobă</Button>}
          <Button variant="primary" onClick={() => save("trimis")} loading={busy === "trimis"} disabled={!v.ok || !projectId || !employeeId}>Trimite pontaj</Button>
        </>
      ) : <Button onClick={onClose}>Închide</Button>}>
      <div className="space-y-4">
        {entry?.status === "respins" && entry.rejection_reason && <Notice tone="red"><strong>Respins:</strong> {entry.rejection_reason}</Notice>}
        {entry?.status === "trimis" && !isAdmin && <Notice tone="amber">Pontajul a fost trimis. Pentru a-l modifica, retrage-l mai întâi în ciornă.</Notice>}
        {isAdmin && (
          <Field label="Angajat" hint="Poți ponta și angajați fără cont în aplicație.">
            <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={!canEdit}>
              <option value="">Alege angajatul</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.user_id ? "" : " (fără cont)"}</option>)}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lucrare">
            <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setTaskId(""); }} disabled={!canEdit}>
              <option value="">Alege lucrarea</option>
              {visibleProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Misiune (opțional)">
            <Select value={taskId ?? ""} onChange={(e) => setTaskId(e.target.value)} disabled={!canEdit}>
              <option value="">— fără misiune —</option>
              {projTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
        {!isAdmin && visibleProjects.length === 0 && <Notice tone="amber">Nu ai încă lucrări alocate. Pontajul se poate face doar pe lucrările la care ești programat.</Notice>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Data" className="col-span-2 sm:col-span-1"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Început"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Sfârșit"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Pauze (min)" hint="neplătite"><Input type="number" min={0} step={5} inputMode="numeric" value={breakMin} onChange={(e) => setBreakMin(e.target.value)} disabled={!canEdit} /></Field>
        </div>
        {shift?.overnight && v.ok && <Notice tone="blue">Tura trece peste miezul nopții — se termină pe {localDate(shift.endsAt, tz)}.</Notice>}
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          {v.ok ? <>Timp efectiv lucrat: <strong className="text-base">{formatMinutes(v.minutes)}</strong></> : <span className="font-medium text-red-700">{v.error}</span>}
          {planned && <div className="mt-1 text-slate-600">Planificat: {localTime(planned.starts_at, tz)}–{localTime(planned.ends_at, tz)} (pauză {planned.break_minutes} min)</div>}
        </div>
        <Field label="Poze cu lucrarea (opțional)" hint="Dovadă pentru client: cum arată lucrarea la final.">
          <>
            <PhotoThumbs photos={entry ? existingPhotos[entry.id] : undefined} />
            {canEdit && <div className="mt-2"><PhotoPicker photos={photos} onChange={setPhotos} label="Fă o poză" /></div>}
          </>
        </Field>
        {savedOffline && <Notice tone="amber">Fără semnal: pontajul este salvat pe telefon și se trimite singur când revine internetul.</Notice>}
        <Field label="Observații"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="ex. am rămas mai mult pentru finisaje" disabled={!canEdit} /></Field>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
