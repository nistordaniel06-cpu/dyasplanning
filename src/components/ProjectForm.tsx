"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { humanError } from "@/lib/errors";
import { PROJECT_COLORS, PROJECT_STATUS, pickProjectColor } from "@/lib/labels";
import type { Employee, Project, ProjectStatus } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea, cx } from "./ui";

export function ProjectForm({ project, employees, usedColors, onClose, onSaved }: {
  project?: Project | null; employees: Employee[]; usedColors: string[]; onClose: () => void; onSaved: (p: Project) => void;
}) {
  const { company } = useSession();
  const [f, setF] = useState({
    name: project?.name ?? "", description: project?.description ?? "", client_name: project?.client_name ?? "",
    contact_name: project?.contact_name ?? "", contact_phone: project?.contact_phone ?? "", address: project?.address ?? "",
    city: project?.city ?? "", start_date: project?.start_date ?? "", due_date: project?.due_date ?? "",
    manager_employee_id: project?.manager_employee_id ?? "", status: (project?.status ?? "planificata") as ProjectStatus,
    color: project?.color ?? pickProjectColor(usedColors),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.start_date && f.due_date && f.due_date < f.start_date) { setError("Termenul trebuie să fie după data de început."); return; }
    setBusy(true); setError(null);
    const payload = {
      ...f, name: f.name.trim(),
      description: f.description.trim() || null, client_name: f.client_name.trim() || null, contact_name: f.contact_name.trim() || null,
      contact_phone: f.contact_phone.trim() || null, address: f.address.trim() || null, city: f.city.trim() || null,
      start_date: f.start_date || null, due_date: f.due_date || null, manager_employee_id: f.manager_employee_id || null,
    };
    const sb = supabase();
    const res = project
      ? await sb.from("projects").update(payload).eq("id", project.id).select().single()
      : await sb.from("projects").insert({ ...payload, company_id: company!.id }).select().single();
    setBusy(false);
    if (res.error) { setError(humanError(res.error)); return; }
    onSaved(res.data as Project);
  }

  return (
    <Modal open onClose={onClose} wide title={project ? "Modifică lucrarea" : "Adaugă lucrare"}
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" type="submit" form="project-form" loading={busy}>{project ? "Salvează" : "Adaugă lucrare"}</Button></>}>
      <form id="project-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nume lucrare" className="sm:col-span-2"><Input required value={f.name} onChange={set("name")} placeholder="ex. Renovare apartament — București" /></Field>
        <Field label="Adresă"><Input value={f.address} onChange={set("address")} placeholder="Str., nr., bloc, ap." /></Field>
        <Field label="Localitate"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="Client"><Input value={f.client_name} onChange={set("client_name")} /></Field>
        <Field label="Persoană de contact"><Input value={f.contact_name} onChange={set("contact_name")} /></Field>
        <Field label="Telefon contact"><Input type="tel" value={f.contact_phone} onChange={set("contact_phone")} /></Field>
        <Field label="Responsabil">
          <Select value={f.manager_employee_id} onChange={set("manager_employee_id")}>
            <option value="">— neales —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </Select>
        </Field>
        <Field label="Data de început"><Input type="date" value={f.start_date} onChange={set("start_date")} /></Field>
        <Field label="Termen estimat"><Input type="date" value={f.due_date} onChange={set("due_date")} /></Field>
        <Field label="Status">
          <Select value={f.status} onChange={set("status")}>
            {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Culoare în planning">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PROJECT_COLORS.map((c) => (
              <button type="button" key={c} onClick={() => setF({ ...f, color: c })} aria-label={`Culoare ${c}`}
                className={cx("h-8 w-8 rounded-full ring-offset-2", f.color === c && "ring-2 ring-slate-900")} style={{ background: c }} />
            ))}
          </div>
        </Field>
        <Field label="Descriere" className="sm:col-span-2"><Textarea value={f.description} onChange={set("description")} /></Field>
        {error && <div className="sm:col-span-2"><ErrorBox message={error} /></div>}
      </form>
    </Modal>
  );
}
