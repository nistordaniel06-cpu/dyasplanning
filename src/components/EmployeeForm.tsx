"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { humanError } from "@/lib/errors";
import { WEEKDAY_SHORT } from "@/lib/time";
import type { Employee, Team, Vehicle } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Modal, Select, cx } from "./ui";
import { PhoneInput } from "./PhoneInput";
import { countryForTimezone, formatStored, phoneProblem, splitStored } from "@/lib/countries";
import { companySchedule, scheduleMinutes } from "@/lib/schedule";
import { formatMinutes } from "@/lib/hours";

export function EmployeeForm({ employee, teams, vehicles = [], onClose, onSaved }: { employee?: Employee | null; teams: Team[]; vehicles?: Vehicle[]; onClose: () => void; onSaved: (e: Employee) => void }) {
  const { company } = useSession();
  const def = companySchedule(company);
  const [f, setF] = useState({
    full_name: employee?.full_name ?? "", phone: employee?.phone ?? "", trade: employee?.trade ?? "",
    skills: (employee?.skills ?? []).join(", "), team_id: employee?.team_id ?? "",
    work_start: employee?.work_start?.slice(0, 5) ?? def.start, work_end: employee?.work_end?.slice(0, 5) ?? def.end,
    break_minutes: String(employee?.break_minutes ?? def.breakMin),
    work_days: employee?.work_days ?? [1, 2, 3, 4, 5], active: employee?.active ?? true,
    is_driver: employee?.is_driver ?? false, default_vehicle_id: employee?.default_vehicle_id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialPhone = splitStored(employee?.phone, countryForTimezone(company?.timezone));
  const [country, setCountry] = useState(initialPhone.country);
  const [local, setLocal] = useState(initialPhone.local);
  const phoneErr = phoneProblem(country.dial, local);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (phoneErr) { setError(`Telefon: ${phoneErr}`); return; }
    setBusy(true); setError(null);
    const payload = {
      full_name: f.full_name.trim(), phone: formatStored(country.dial, local) || null, trade: f.trade.trim() || null,
      skills: f.skills.split(",").map((s) => s.trim()).filter(Boolean), team_id: f.team_id || null,
      work_start: f.work_start, work_end: f.work_end, break_minutes: Math.min(240, Math.max(0, Number(f.break_minutes) || 0)), work_days: [...f.work_days].sort(), active: f.active,
      is_driver: f.is_driver, default_vehicle_id: f.is_driver && f.default_vehicle_id ? f.default_vehicle_id : null,
    };
    const sb = supabase();
    const res = employee
      ? await sb.from("employees").update(payload).eq("id", employee.id).select().single()
      : await sb.from("employees").insert({ ...payload, company_id: company!.id }).select().single();
    setBusy(false);
    if (res.error) { setError(humanError(res.error)); return; }
    onSaved(res.data as Employee);
  }

  return (
    <Modal open onClose={onClose} title={employee ? "Modifică angajatul" : "Adaugă angajat"}
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" type="submit" form="emp-form" loading={busy}>{employee ? "Salvează" : "Adaugă angajat"}</Button></>}>
      <form id="emp-form" onSubmit={save} className="space-y-4">
        <Field label="Nume și prenume"><Input required value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field className="sm:col-span-2" label="Telefon (WhatsApp)" error={phoneErr} hint="Alege țara numărului. Cu acest număr intră în aplicație.">
            <PhoneInput label="Telefon (WhatsApp)" country={country} local={local} onCountry={setCountry} onLocal={setLocal} />
          </Field>
          <Field label="Meserie"><Input value={f.trade} onChange={(e) => setF({ ...f, trade: e.target.value })} placeholder="ex. Electrician" /></Field>
        </div>
        <Field label="Competențe" hint="Separate prin virgulă, ex. rigips, gresie, zugrăveli"><Input value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} /></Field>
        <Field label="Echipă">
          <Select value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })}>
            <option value="">— fără echipă —</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Program — de la"><Input type="time" value={f.work_start} onChange={(e) => setF({ ...f, work_start: e.target.value })} /></Field>
          <Field label="până la"><Input type="time" value={f.work_end} onChange={(e) => setF({ ...f, work_end: e.target.value })} /></Field>
          <Field label="Pauză (min)"><Input type="number" min={0} max={240} step={5} inputMode="numeric" value={f.break_minutes} onChange={(e) => setF({ ...f, break_minutes: e.target.value })} /></Field>
        </div>
        <p className="-mt-2 text-xs text-slate-500">= {formatMinutes(scheduleMinutes({ start: f.work_start, end: f.work_end, breakMin: Number(f.break_minutes) || 0 }))} lucrate pe zi. Programul acesta se completează automat în planning și la pontaj.</p>
        <Field label="Zile lucrătoare">
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7].map((w) => (
              <button type="button" key={w} onClick={() => setF({ ...f, work_days: f.work_days.includes(w) ? f.work_days.filter((x) => x !== w) : [...f.work_days, w] })}
                className={cx("h-10 w-12 rounded-lg border text-sm font-semibold", f.work_days.includes(w) ? "border-orange-600 bg-orange-600 text-white" : "border-slate-300 bg-white")}>{WEEKDAY_SHORT[w]}</button>
            ))}
          </div>
        </Field>
        <label className="flex items-center gap-3 text-sm font-medium">
          <input type="checkbox" className="h-5 w-5 accent-orange-600" checked={f.is_driver} onChange={(e) => setF({ ...f, is_driver: e.target.checked })} />
          Șofer — introduce dimineața km de la bordul mașinii
        </label>
        {f.is_driver && (
          <Field label="Mașina obișnuită" hint={vehicles.length === 0 ? "Adaugă mașini din secțiunea „Mașini”." : "Apare preselectată când șoferul introduce km."}>
            <Select value={f.default_vehicle_id} onChange={(e) => setF({ ...f, default_vehicle_id: e.target.value })}>
              <option value="">— alege la fiecare citire —</option>
              {vehicles.filter((v) => v.active || v.id === f.default_vehicle_id).map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>)}
            </Select>
          </Field>
        )}
        {employee && (
          <label className="flex items-center gap-3 text-sm font-medium">
            <input type="checkbox" className="h-5 w-5 accent-orange-600" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
            Activ (dezactivarea păstrează istoricul, dar angajatul nu mai apare în planning)
          </label>
        )}
        {error && <ErrorBox message={error} />}
      </form>
    </Modal>
  );
}
