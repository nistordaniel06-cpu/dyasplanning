"use client";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { humanError } from "@/lib/errors";
import { findConflicts } from "@/lib/conflicts";
import { localDate, localTime, shiftFromLocal } from "@/lib/time";
import { formatMinutes, validateShift } from "@/lib/hours";
import type { Absence, Assignment, AssignmentStatus, Employee, Project, Task } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Modal, Notice, Select, Textarea } from "./ui";

export interface PlanningRefs {
  employees: Employee[];
  projects: Project[];
  tasks: Task[];
  assignments: Assignment[];
  absences: Absence[];
}

export function ConflictList({ items }: { items: { blocking: boolean; message: string }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-2">
      {items.map((c, i) => (
        <li key={i} className={c.blocking ? "flex gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800" : "flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900"}>
          {c.blocking ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
          <span><strong>{c.blocking ? "Conflict: " : "Atenție: "}</strong>{c.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Editarea unei singure alocări. Modificarea nu afectează alocările colegilor. */
export function AssignmentEditor({ assignment, refs, onClose, onSaved }: {
  assignment: Assignment; refs: PlanningRefs; onClose: () => void; onSaved: () => void;
}) {
  const { tz, company } = useSession();
  const [employeeId, setEmployeeId] = useState(assignment.employee_id);
  const [projectId, setProjectId] = useState(assignment.project_id);
  const [taskId, setTaskId] = useState(assignment.task_id ?? "");
  const [date, setDate] = useState(localDate(assignment.starts_at, tz));
  const [start, setStart] = useState(localTime(assignment.starts_at, tz));
  const [end, setEnd] = useState(localTime(assignment.ends_at, tz));
  const [breakMin, setBreakMin] = useState(String(assignment.break_minutes));
  const [status, setStatus] = useState<AssignmentStatus>(assignment.status);
  const [notes, setNotes] = useState(assignment.notes ?? "");
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const projTasks = refs.tasks.filter((t) => t.project_id === projectId);
  useEffect(() => { if (taskId && !projTasks.some((t) => t.id === taskId)) setTaskId(""); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const shift = useMemo(() => (date && start && end ? shiftFromLocal(date, start, end, tz) : null), [date, start, end, tz]);
  const validation = shift ? validateShift(shift.startsAt, shift.endsAt, Number(breakMin) || 0) : { ok: false, error: "Completează data și orele.", minutes: 0 };
  const empName = (id: string) => refs.employees.find((e) => e.id === id)?.full_name ?? "Angajat";

  const conflicts = useMemo(() => {
    if (!shift || !validation.ok) return [];
    return findConflicts({
      proposed: [{ id: assignment.id, employee_id: employeeId, project_id: projectId, starts_at: shift.startsAt.toISOString(), ends_at: shift.endsAt.toISOString(), status }],
      existing: refs.assignments, absences: refs.absences, projects: refs.projects, tz,
      travelBufferMinutes: company?.travel_buffer_minutes ?? 30, employeeName: empName,
    });
  }, [shift, validation.ok, employeeId, projectId, status, refs, tz, company]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocking = conflicts.some((c) => c.blocking);

  async function save() {
    if (!shift || !validation.ok) return;
    setBusy("save"); setError(null);
    const { error } = await supabase().from("assignments").update({
      employee_id: employeeId, project_id: projectId, task_id: taskId || null,
      starts_at: shift.startsAt.toISOString(), ends_at: shift.endsAt.toISOString(),
      break_minutes: Number(breakMin) || 0, status, notes: notes.trim() || null,
    }).eq("id", assignment.id);
    setBusy(null);
    if (error) { setError(humanError(error)); return; }
    onSaved();
  }

  async function remove() {
    setBusy("delete"); setError(null);
    const { error } = await supabase().from("assignments").delete().eq("id", assignment.id);
    setBusy(null);
    if (error) { setError(humanError(error)); return; }
    onSaved();
  }

  const activeEmployees = refs.employees.filter((e) => e.active || e.id === assignment.employee_id);

  return (
    <Modal open onClose={onClose} title="Modifică alocarea"
      footer={confirmDelete ? (
        <>
          <Button onClick={() => setConfirmDelete(false)}>Renunță</Button>
          <Button variant="danger" loading={busy === "delete"} onClick={remove}>Da, șterge definitiv</Button>
        </>
      ) : (
        <>
          <Button variant="danger" onClick={() => setConfirmDelete(true)} className="sm:mr-auto">Șterge</Button>
          <Button onClick={onClose}>Renunță</Button>
          <Button variant="primary" onClick={save} loading={busy === "save"} disabled={!validation.ok || blocking}>Salvează</Button>
        </>
      )}>
      <div className="space-y-4">
        {confirmDelete && <Notice tone="red">Alocarea va fi ștearsă. Pontajele deja înregistrate rămân. Pentru a păstra istoricul, poți folosi statusul „Anulată”.</Notice>}
        <Field label="Angajat">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lucrare">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {refs.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Misiune">
            <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">— fără misiune —</option>
              {projTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Data" className="col-span-2 sm:col-span-1"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="De la"><Input type="time" step={900} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Până la"><Input type="time" step={900} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Pauză (min)"><Input type="number" min={0} step={5} inputMode="numeric" value={breakMin} onChange={(e) => setBreakMin(e.target.value)} /></Field>
        </div>
        {shift?.overnight && validation.ok && <Notice tone="blue">Intervalul trece peste miezul nopții (se termină a doua zi).</Notice>}
        {validation.ok ? <p className="text-sm text-slate-600">Ore planificate: <strong>{formatMinutes(validation.minutes)}</strong></p> : <p className="text-sm font-medium text-red-700">{validation.error}</p>}
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as AssignmentStatus)}>
            <option value="planificata">Planificată</option>
            <option value="confirmata">Confirmată</option>
            <option value="anulata">Anulată</option>
          </Select>
        </Field>
        <Field label="Observații"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <ConflictList items={conflicts} />
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
