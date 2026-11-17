"use client";
import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { humanError } from "@/lib/errors";
import { loadAbsences, loadAssignments } from "@/lib/data";
import { findConflicts } from "@/lib/conflicts";
import { addDays, diffDays, localDate, localTime, moveToDate, rangeUtc, shortDate, startOfWeek } from "@/lib/time";
import type { Absence, Assignment, Employee, Project, Task } from "@/lib/types";
import { Badge, Button, ErrorBox, Field, Input, Loading, Modal, Notice } from "./ui";

/** Copierea unei zile sau săptămâni, cu previzualizare și verificarea conflictelor. */
export function CopyDialog({ mode, from, to, source, refs, onClose, onDone }: {
  mode: "zi" | "saptamana"; from: string; to: string; source: Assignment[];
  refs: { employees: Employee[]; projects: Project[]; tasks: Task[]; absences: Absence[] };
  onClose: () => void; onDone: (n: number) => void;
}) {
  const { tz, company, membership } = useSession();
  const [target, setTarget] = useState(mode === "zi" ? addDays(from, 1) : addDays(from, 7));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const targetStart = mode === "saptamana" ? startOfWeek(target) : target;
  const offset = diffDays(targetStart, from);
  const targetEnd = addDays(to, offset);

  const sourceItems = source.filter((a) => a.status !== "anulata" && localDate(a.starts_at, tz) >= from && localDate(a.starts_at, tz) <= to);

  const existing = useQuery(async () => {
    const [f, t] = rangeUtc(targetStart, targetEnd, tz);
    const [a, ab] = await Promise.all([loadAssignments(f, t), loadAbsences(targetStart, targetEnd)]);
    return { assignments: a, absences: ab };
  }, [targetStart, targetEnd, tz]);

  const preview = useMemo(() => {
    if (!existing.data || offset === 0) return [];
    const proposed = sourceItems.map((a) => {
      const m = moveToDate(a.starts_at, a.ends_at, addDays(localDate(a.starts_at, tz), offset), tz);
      return { src: a, key: a.id, employee_id: a.employee_id, project_id: a.project_id, starts_at: m.startsAt.toISOString(), ends_at: m.endsAt.toISOString() };
    });
    const conflicts = findConflicts({
      proposed, existing: existing.data.assignments, absences: existing.data.absences, projects: refs.projects, tz,
      travelBufferMinutes: company?.travel_buffer_minutes ?? 30,
      employeeName: (id) => refs.employees.find((e) => e.id === id)?.full_name ?? "",
    });
    return proposed.map((p) => ({ ...p, conflicts: conflicts.filter((c) => c.slotKey === p.key) }));
  }, [existing.data, sourceItems, offset, tz, refs, company]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = preview.filter((p) => !p.conflicts.some((c) => c.blocking));
  const emp = new Map(refs.employees.map((e) => [e.id, e]));
  const proj = new Map(refs.projects.map((p) => [p.id, p]));
  const tsk = new Map(refs.tasks.map((t) => [t.id, t]));

  async function copy() {
    setBusy(true); setError(null);
    const rows = ok.map((p) => ({
      company_id: p.src.company_id, employee_id: p.employee_id, project_id: p.project_id, task_id: p.src.task_id,
      starts_at: p.starts_at, ends_at: p.ends_at, break_minutes: p.src.break_minutes, status: "planificata", notes: p.src.notes,
      created_by: membership?.user_id,
    }));
    const { error } = await supabase().from("assignments").insert(rows);
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    onDone(rows.length);
  }

  return (
    <Modal open onClose={onClose} wide title={mode === "zi" ? `Copiază ziua ${shortDate(from)}` : `Copiază săptămâna ${shortDate(from)} – ${shortDate(to)}`}
      footer={<>
        <Button onClick={onClose}>Renunță</Button>
        <Button variant="primary" onClick={copy} loading={busy} disabled={ok.length === 0 || existing.loading}>
          Copiază {ok.length} {ok.length === 1 ? "alocare" : "alocări"}
        </Button>
      </>}>
      <div className="space-y-4">
        <Field label={mode === "zi" ? "Copiază în ziua" : "Copiază în săptămâna care conține data"}
          hint={mode === "saptamana" ? `Săptămâna țintă: ${shortDate(targetStart)} – ${shortDate(targetEnd)}` : undefined}>
          <Input type="date" value={target} onChange={(e) => e.target.value && setTarget(e.target.value)} />
        </Field>
        <Notice tone="blue">Se copiază alocările afișate acum (respectând filtrele). Cele cu conflicte sunt sărite automat; restul se salvează ca alocări noi, independente.</Notice>
        {offset === 0 && <Notice tone="amber">Alege altă {mode === "zi" ? "zi" : "săptămână"} decât cea sursă.</Notice>}
        {existing.error && <ErrorBox message={existing.error} onRetry={existing.reload} />}
        {existing.loading && <Loading label="Verific programul țintă…" />}
        {sourceItems.length === 0 && <Notice tone="amber">Nu există alocări de copiat în perioada selectată.</Notice>}
        {preview.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {preview.map((p) => {
              const blocking = p.conflicts.some((c) => c.blocking);
              return (
                <li key={p.key} className="px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{emp.get(p.employee_id)?.full_name}</span>
                    <span className="text-slate-600">{shortDate(localDate(p.starts_at, tz))} {localTime(p.starts_at, tz)}–{localTime(p.ends_at, tz)}</span>
                    <span className="text-slate-600">· {proj.get(p.project_id)?.name}{p.src.task_id ? ` / ${tsk.get(p.src.task_id)?.name}` : ""}</span>
                    <span className="ml-auto">{blocking ? <Badge tone="red">Conflict — sărită</Badge> : p.conflicts.length ? <Badge tone="amber">Atenție</Badge> : <Badge tone="green">OK</Badge>}</span>
                  </div>
                  {p.conflicts.map((c, i) => <div key={i} className={blocking ? "mt-1 text-xs text-red-700" : "mt-1 text-xs text-amber-800"}>{c.message}</div>)}
                </li>
              );
            })}
          </ul>
        )}
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
