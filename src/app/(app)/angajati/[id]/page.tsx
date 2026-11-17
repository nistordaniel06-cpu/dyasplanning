"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { EmployeeForm } from "@/components/EmployeeForm";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { byId, loadProjects, loadTasks, loadTeams, loadVehicles } from "@/lib/data";
import { ABSENCE_TYPE, ROLE_LABEL } from "@/lib/labels";
import { formatMinutes } from "@/lib/hours";
import { plannedMinutes } from "@/lib/reports";
import { addDays, endOfMonth, inRange, localDate, localTime, rangeUtc, shortDate, startOfMonth, startOfWeek, todayIn, WEEKDAY_SHORT } from "@/lib/time";
import type { Absence, AbsenceType, AppRole, Assignment, Employee, Invite, TimeEntry } from "@/lib/types";

export default function AngajatPage() {
  return <RequireRole roles={["admin"]}><Angajat /></RequireRole>;
}

function Angajat() {
  const { id } = useParams<{ id: string }>();
  const { tz } = useSession();
  const today = todayIn(tz);
  const [editOpen, setEditOpen] = useState(false);
  const [absOpen, setAbsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const q = useQuery(async () => {
    const sb = supabase();
    const monthStart = startOfMonth(today) < startOfWeek(today) ? startOfMonth(today) : startOfWeek(today);
    const [f] = rangeUtc(monthStart, today, tz);
    const [, t] = rangeUtc(today, addDays(today, 30), tz);
    const [emp, absences, assignments, entries, invites, teams, projects, tasks, vehicles] = await Promise.all([
      sb.from("employees").select("*").eq("id", id).maybeSingle(),
      sb.from("absences").select("*").eq("employee_id", id).gte("end_date", addDays(today, -90)).order("start_date"),
      sb.from("assignments").select("*").eq("employee_id", id).gte("starts_at", f).lt("starts_at", t).order("starts_at"),
      sb.from("time_entries").select("*").eq("employee_id", id).gte("started_at", f).order("started_at", { ascending: false }),
      sb.from("invites").select("*").eq("employee_id", id).is("used_at", null).order("created_at", { ascending: false }),
      loadTeams(), loadProjects(), loadTasks(), loadVehicles(),
    ]);
    return {
      employee: must(emp) as Employee | null, absences: must(absences) as Absence[], assignments: must(assignments) as Assignment[],
      entries: must(entries) as TimeEntry[], invites: must(invites) as Invite[], teams, projects, tasks, vehicles,
    };
  }, [id, today, tz]);

  const d = q.data;
  const projects = useMemo(() => byId(d?.projects), [d]);
  const tasks = useMemo(() => byId(d?.tasks), [d]);

  if (q.loading && !d) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  if (!d) return null;
  if (!d.employee) return <p>Angajatul nu există.</p>;
  const e = d.employee;
  const team = d.teams.find((t) => t.id === e.team_id);

  const sum = (from: string, to: string, st: string[]) => {
    const [f, t] = rangeUtc(from, to, tz);
    return d.entries.filter((x) => inRange(x.started_at, f, t) && st.includes(x.status)).reduce((s, x) => s + x.worked_minutes, 0);
  };
  const plannedSum = (from: string, to: string) => {
    const [f, t] = rangeUtc(from, to, tz);
    return d.assignments.filter((a) => a.status !== "anulata" && inRange(a.starts_at, f, t)).reduce((s, a) => s + plannedMinutes(a), 0);
  };
  const periods: [string, string, string][] = [["Azi", today, today], ["Săptămâna aceasta", startOfWeek(today), addDays(startOfWeek(today), 6)], ["Luna aceasta", startOfMonth(today), endOfMonth(today)]];
  const upcoming = d.assignments.filter((a) => a.status !== "anulata" && localDate(a.starts_at, tz) >= today);

  async function deleteAbsence(a: Absence) {
    setErr(null);
    const { error } = await supabase().from("absences").delete().eq("id", a.id);
    if (error) { setErr(humanError(error)); return; }
    await q.reload();
  }

  return (
    <div className="space-y-4">
      <Link href="/angajati" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900"><ArrowLeft className="h-4 w-4" />Angajați</Link>
      <PageHeader title={e.full_name}
        subtitle={<span className="flex flex-wrap items-center gap-2">{e.trade ?? "—"}{team && <> · {team.name}</>}{!e.active && <Badge tone="gray">Inactiv</Badge>}{e.user_id ? <Badge tone="green">Are cont</Badge> : <Badge tone="gray">Fără cont</Badge>}{e.is_driver && <Badge tone="orange">Șofer</Badge>}</span>}
        actions={<>
          {!e.user_id && e.active && <Button onClick={() => setInviteOpen(true)}><KeyRound className="h-4 w-4" />Invită în aplicație</Button>}
          <Button onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" />Modifică</Button>
        </>} />
      {err && <ErrorBox message={err} />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Ore">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Perioadă</th><th className="py-1 text-right">Planif.</th><th className="py-1 text-right">Aprobat</th><th className="py-1 text-right">Neaprob.</th></tr></thead>
            <tbody>
              {periods.map(([l, a, b]) => (
                <tr key={l} className="border-t border-slate-100">
                  <td className="py-2">{l}</td>
                  <td className="py-2 text-right">{formatMinutes(plannedSum(a, b))}</td>
                  <td className="py-2 text-right font-semibold">{formatMinutes(sum(a, b, ["aprobat"]))}</td>
                  <td className="py-2 text-right text-slate-600">{formatMinutes(sum(a, b, ["trimis", "ciorna"]))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Profil">
          <dl className="space-y-1.5 text-sm">
            <div><span className="text-slate-500">Telefon: </span>{e.phone ? <a href={`tel:${e.phone}`} className="font-semibold text-orange-700 underline">{e.phone}</a> : "—"}</div>
            <div><span className="text-slate-500">Program: </span>{e.work_start.slice(0, 5)}–{e.work_end.slice(0, 5)}, {[...e.work_days].sort().map((x) => WEEKDAY_SHORT[x]).join(", ")}</div>
            <div><span className="text-slate-500">Competențe: </span>{e.skills.length ? e.skills.join(", ") : "—"}</div>
          </dl>
          {d.invites.length > 0 && (
            <div className="mt-3"><Notice tone="blue">Cod de invitație activ: <strong className="font-mono tracking-widest">{d.invites[0].code}</strong> (expiră {localDate(d.invites[0].expires_at, tz)}, rol {ROLE_LABEL[d.invites[0].role]})</Notice></div>
          )}
        </Card>
        <Card title="Concedii și absențe" action={<Button size="sm" onClick={() => setAbsOpen(true)}><Plus className="h-4 w-4" />Adaugă</Button>}>
          {d.absences.length === 0 ? <p className="text-sm text-slate-600">Nicio absență înregistrată.</p> : (
            <ul className="space-y-2 text-sm">
              {d.absences.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <StatusBadge s={ABSENCE_TYPE[a.type]} />
                  <span className="flex-1">{a.start_date} – {a.end_date}{a.note ? ` · ${a.note}` : ""}</span>
                  <button onClick={() => deleteAbsence(a)} className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700" aria-label="Șterge absența"><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={`Lucrări și misiuni alocate (următoarele 30 de zile: ${upcoming.length})`}>
        {upcoming.length === 0 ? <p className="text-sm text-slate-600">Nicio alocare viitoare.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {upcoming.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 py-2">
                <span className="w-20 font-medium">{shortDate(localDate(a.starts_at, tz))}</span>
                <span className="w-24 tabular-nums">{localTime(a.starts_at, tz)}–{localTime(a.ends_at, tz)}</span>
                <Link href={`/lucrari/${a.project_id}`} className="font-semibold hover:underline">{projects.get(a.project_id)?.name}</Link>
                <span className="text-slate-600">{a.task_id ? tasks.get(a.task_id)?.name : "fără misiune"}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editOpen && <EmployeeForm employee={e} teams={d.teams} vehicles={d.vehicles} onClose={() => setEditOpen(false)} onSaved={async () => { setEditOpen(false); await q.reload(); }} />}
      {absOpen && <AbsenceForm employee={e} onClose={() => setAbsOpen(false)} onSaved={async () => { setAbsOpen(false); await q.reload(); }} />}
      {inviteOpen && <InviteDialog employee={e} onClose={() => { setInviteOpen(false); void q.reload(); }} />}
    </div>
  );
}

function AbsenceForm({ employee, onClose, onSaved }: { employee: Employee; onClose: () => void; onSaved: () => void }) {
  const { tz } = useSession();
  const [type, setType] = useState<AbsenceType>("concediu");
  const [start, setStart] = useState(todayIn(tz));
  const [end, setEnd] = useState(todayIn(tz));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (end < start) { setError("Data de sfârșit trebuie să fie după data de început."); return; }
    setBusy(true); setError(null);
    const { error } = await supabase().from("absences").insert({ company_id: employee.company_id, employee_id: employee.id, type, start_date: start, end_date: end, note: note.trim() || null });
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title={`Absență — ${employee.full_name}`} footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" onClick={save} loading={busy}>Salvează</Button></>}>
      <div className="space-y-4">
        <Field label="Tip">
          <Select value={type} onChange={(e) => setType(e.target.value as AbsenceType)}>
            {Object.entries(ABSENCE_TYPE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="De la"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Până la (inclusiv)"><Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Notă"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Notice tone="blue">Alocările existente în această perioadă nu se șterg automat; planning-ul va semnala conflictul la orice alocare nouă.</Notice>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}

function InviteDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const [role, setRole] = useState<AppRole>("angajat");
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function create() {
    setBusy(true); setError(null);
    const { data, error } = await supabase().rpc("create_invite", { p_employee_id: employee.id, p_role: role });
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    setCode(data as string);
  }
  const link = typeof window !== "undefined" ? `${window.location.origin}/login` : "";
  const message = code ? `Salut ${employee.full_name.split(" ")[0]}! Intră pe ${link}, creează-ți cont, apoi introdu codul de invitație ${code} pentru a vedea programul și a trimite orele lucrate.` : "";
  return (
    <Modal open onClose={onClose} title="Invită în aplicație" footer={code ? <Button variant="primary" onClick={onClose}>Gata</Button> : <><Button onClick={onClose}>Renunță</Button><Button variant="primary" onClick={create} loading={busy}>Generează cod</Button></>}>
      <div className="space-y-4">
        {!code ? (
          <>
            <p className="text-sm text-slate-700">{employee.full_name} își va crea un cont și va introduce codul. Contul va fi legat automat de această fișă.</p>
            <Field label="Rol în aplicație">
              <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                <option value="angajat">Angajat — își vede programul și trimite orele</option>
                <option value="sef_echipa">Șef de echipă — vede echipa, actualizează progresul</option>
                <option value="admin">Administrator — acces complet</option>
              </Select>
            </Field>
          </>
        ) : (
          <>
            <div className="rounded-xl bg-slate-900 p-5 text-center font-mono text-3xl font-bold tracking-[0.3em] text-white">{code}</div>
            <p className="text-sm text-slate-600">Codul este valabil 14 zile și poate fi folosit o singură dată.</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <a className="flex-1" href={`https://wa.me/${(employee.phone ?? "").replace(/[^\d]/g, "").replace(/^0/, "40")}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
                <Button className="w-full" disabled={!employee.phone}>Trimite pe WhatsApp</Button>
              </a>
              <Button className="flex-1" onClick={async () => { try { await navigator.clipboard.writeText(message); setCopied(true); } catch { setError("Nu s-a putut copia automat. Selectează codul și copiază-l manual."); } }}>{copied ? "Copiat ✓" : "Copiază mesajul"}</Button>
            </div>
          </>
        )}
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
