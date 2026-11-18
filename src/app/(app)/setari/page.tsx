"use client";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select } from "@/components/ui";
import { useSession } from "@/lib/session";
import { companySchedule, scheduleMinutes } from "@/lib/schedule";
import { formatMinutes } from "@/lib/hours";
import { useQuery, must } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { loadEmployees, loadTeams } from "@/lib/data";
import { ROLE_LABEL } from "@/lib/labels";
import { displayLogin } from "@/lib/phone";
import { TIMEZONES, localDate } from "@/lib/time";
import type { AppRole, CompanyUser, Invite } from "@/lib/types";

export default function SetariPage() {
  return <RequireRole roles={["admin"]}><Setari /></RequireRole>;
}

function Setari() {
  const { company, reload, user, tz } = useSession();
  const [name, setName] = useState(company?.name ?? "");
  const [timezone, setTimezone] = useState(company?.timezone ?? "Europe/Bucharest");
  const [buffer, setBuffer] = useState(String(company?.travel_buffer_minutes ?? 30));
  const defSched = companySchedule(company);
  const [wStart, setWStart] = useState(defSched.start);
  const [wEnd, setWEnd] = useState(defSched.end);
  const [wBreak, setWBreak] = useState(String(defSched.breakMin));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const [teamName, setTeamName] = useState("");

  const q = useQuery(async () => {
    const sb = supabase();
    const [teams, employees, users, invites] = await Promise.all([
      loadTeams(), loadEmployees(),
      sb.rpc("company_users").then((r) => must(r) as CompanyUser[]),
      sb.from("invites").select("*").is("used_at", null).order("created_at", { ascending: false }).then((r) => must(r) as Invite[]),
    ]);
    return { teams, employees, users, invites };
  }, []);

  async function run(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true); setMsg(null);
    const { error } = await fn();
    setBusy(false);
    if (error) { setMsg({ tone: "red", text: humanError(error) }); return false; }
    setMsg({ tone: "green", text: ok });
    return true;
  }

  async function saveCompany() {
    const ok = await run(() => supabase().from("companies").update({ name: name.trim(), timezone, travel_buffer_minutes: Number(buffer) || 0 }).eq("id", company!.id), "Setările firmei au fost salvate.");
    if (ok) await reload();
  }

  async function saveSchedule(applyAll: boolean) {
    const br = Math.min(240, Math.max(0, Number(wBreak) || 0));
    const ok = await run(() => supabase().from("companies").update({ default_work_start: wStart, default_work_end: wEnd, default_break_minutes: br }).eq("id", company!.id), "Programul implicit a fost salvat.");
    if (!ok) return;
    if (applyAll) {
      if (!window.confirm("Aplici acest program tuturor angajaților activi? Programele personalizate se vor înlocui.")) { await reload(); return; }
      const { data, error } = await supabase().rpc("apply_default_schedule_to_all");
      if (error) setMsg({ tone: "red", text: humanError(error) });
      else setMsg({ tone: "green", text: `Program aplicat la ${data} angajați.` });
    }
    await reload();
  }

  const d = q.data;
  const empName = (id: string | null) => d?.employees.find((e) => e.id === id)?.full_name ?? "—";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Setări" />
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      <Card title="Firmă">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Numele firmei" className="sm:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Fus orar" hint="Programul și pontajele se afișează în acest fus orar.">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {!TIMEZONES.some((z) => z.value === timezone) && <option value={timezone}>{timezone}</option>}{TIMEZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}</Select>
          </Field>
          <Field label="Timp minim de deplasare (min)" hint="Avertizare când un angajat are lucrări consecutive în locații diferite.">
            <Input type="number" min={0} max={240} value={buffer} onChange={(e) => setBuffer(e.target.value)} />
          </Field>
        </div>
        <Button className="mt-4" variant="primary" onClick={saveCompany} loading={busy} disabled={!name.trim()}>Salvează</Button>
      </Card>

      <Card title="Programul de lucru implicit">
        <p className="mb-3 text-sm text-slate-600">Se completează automat la angajații noi, în planning și la pontaj. Fiecare angajat poate avea programul lui (din fișa angajatului → Modifică).</p>
        <div className="grid grid-cols-3 gap-3">
          <Field label="De la"><Input type="time" value={wStart} onChange={(e) => setWStart(e.target.value)} /></Field>
          <Field label="Până la"><Input type="time" value={wEnd} onChange={(e) => setWEnd(e.target.value)} /></Field>
          <Field label="Pauză (min)"><Input type="number" min={0} max={240} step={5} inputMode="numeric" value={wBreak} onChange={(e) => setWBreak(e.target.value)} /></Field>
        </div>
        <p className="mt-2 text-sm font-medium text-slate-800">= {formatMinutes(scheduleMinutes({ start: wStart, end: wEnd, breakMin: Number(wBreak) || 0 }))} lucrate pe zi</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => saveSchedule(false)} loading={busy}>Salvează programul</Button>
          <Button onClick={() => saveSchedule(true)} disabled={busy}>Salvează și aplică tuturor angajaților</Button>
        </div>
      </Card>

      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !d && <Loading />}
      {d && (
        <>
          <Card title="Echipe">
            <ul className="divide-y divide-slate-100">
              {d.teams.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <span className="font-semibold sm:w-40">{t.name}</span>
                  <span className="text-xs text-slate-500 sm:w-24">{d.employees.filter((e) => e.team_id === t.id).length} membri</span>
                  <Select className="sm:flex-1" value={t.leader_employee_id ?? ""} aria-label="Șef de echipă"
                    onChange={async (e) => { if (await run(() => supabase().from("teams").update({ leader_employee_id: e.target.value || null }).eq("id", t.id), "Șeful de echipă a fost actualizat.")) await q.reload(); }}>
                    <option value="">— fără șef de echipă —</option>
                    {d.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                  </Select>
                  <Button size="sm" variant="ghost" aria-label="Șterge echipa"
                    onClick={async () => { if (window.confirm(`Ștergi echipa „${t.name}”? Membrii rămân fără echipă.`) && await run(() => supabase().from("teams").delete().eq("id", t.id), "Echipa a fost ștearsă.")) await q.reload(); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2">
              <Input placeholder="Nume echipă nouă" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              <Button disabled={!teamName.trim() || busy}
                onClick={async () => { if (await run(() => supabase().from("teams").insert({ company_id: company!.id, name: teamName.trim() }), "Echipa a fost creată.")) { setTeamName(""); await q.reload(); } }}>
                Adaugă echipă
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Membrii se aleg din fișa fiecărui angajat. Șeful de echipă trebuie să aibă rolul „Șef de echipă” pentru a vedea echipa în aplicație.</p>
          </Card>

          <Card title="Utilizatori cu cont">
            <ul className="divide-y divide-slate-100">
              {d.users.map((u) => (
                <li key={u.user_id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{u.display_name ?? "—"}{u.user_id === user.id && <span className="ml-1 text-xs text-slate-500">(tu)</span>}</div>
                    <div className="truncate text-xs text-slate-500">{displayLogin(u.email)}{u.employee_id ? "" : " · nelegat de un angajat"}</div>
                  </div>
                  {u.user_id === user.id ? <Badge tone="orange">{ROLE_LABEL[u.role]}</Badge> : (
                    <div className="flex gap-2">
                      <Select className="w-auto" value={u.role} aria-label="Rol"
                        onChange={async (e) => { if (await run(() => supabase().from("memberships").update({ role: e.target.value as AppRole }).eq("user_id", u.user_id), "Rolul a fost schimbat.")) await q.reload(); }}>
                        {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                      <Button size="sm" variant="danger"
                        onClick={async () => { if (window.confirm(`Revoci accesul pentru ${u.display_name ?? u.email}? Fișa de angajat și istoricul rămân.`) && await run(() => supabase().from("memberships").delete().eq("user_id", u.user_id), "Accesul a fost revocat.")) await q.reload(); }}>
                        Revocă
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-slate-500">Pentru a da acces unui angajat, deschide fișa lui din „Angajați” și apasă „Acces în aplicație”: primește un cod pe WhatsApp și intră cu numărul de telefon.</p>
          </Card>

          <Card title="Invitații active">
            {d.invites.length === 0 ? <p className="text-sm text-slate-600">Nicio invitație activă.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {d.invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="font-mono font-bold tracking-widest">{i.code}</span>
                    <span>{empName(i.employee_id)}</span>
                    <Badge tone="gray">{ROLE_LABEL[i.role]}</Badge>
                    <span className="text-xs text-slate-500">expiră {localDate(i.expires_at, tz)}</span>
                    <Button size="sm" variant="ghost" className="ml-auto"
                      onClick={async () => { if (await run(() => supabase().from("invites").delete().eq("id", i.id), "Invitația a fost anulată.")) await q.reload(); }}>Anulează</Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
