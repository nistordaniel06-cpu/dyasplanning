"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import type { Task, TaskStatus } from "@/lib/types";
import { Button, ErrorBox, Field, Modal, Select, Textarea } from "./ui";

/** Actualizarea progresului unei misiuni + observație (verificat pe server prin RPC). */
export function TaskProgressDialog({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: () => void }) {
  const [progress, setProgress] = useState(task.progress);
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    const { error } = await supabase().rpc("update_task_progress", { p_task_id: task.id, p_progress: progress, p_status: status, p_note: note });
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    onDone();
  }

  return (
    <Modal open onClose={onClose} title={`Progres: ${task.name}`}
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" onClick={save} loading={busy}>Salvează progresul</Button></>}>
      <div className="space-y-4">
        <Field label={`Progres: ${progress}%`}>
          <input type="range" min={0} max={100} step={5} value={progress} className="w-full accent-orange-600"
            onChange={(e) => { const v = Number(e.target.value); setProgress(v); if (v === 100) setStatus("finalizata"); else if (v > 0 && status === "neinceputa") setStatus("in_lucru"); }} />
        </Field>
        <div className="grid grid-cols-4 gap-2">
          {[0, 25, 50, 75, 100].slice(1).map((v) => <Button key={v} size="sm" onClick={() => { setProgress(v); setStatus(v === 100 ? "finalizata" : "in_lucru"); }}>{v}%</Button>)}
        </div>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
            <option value="neinceputa">Neîncepută</option><option value="in_lucru">În lucru</option>
            <option value="blocata">Blocată (problemă)</option><option value="finalizata">Finalizată</option>
          </Select>
        </Field>
        <Field label="Observație (opțional)"><Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. lipsesc plăci de rigips pentru camera 2" /></Field>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
