"use client";
import { localeTag } from "@/lib/lang";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, Copy, Crosshair, Globe, MapPin, Megaphone, Search } from "lucide-react";
import dynamic from "next/dynamic";
import type { MapPoint } from "@/components/owner/OwnerMap";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Stat, Tabs, Textarea, cx } from "@/components/ui";
const OwnerMap = dynamic(() => import("@/components/owner/OwnerMap").then((m) => m.OwnerMap), { ssr: false, loading: () => <Loading /> });
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { ROLE_LABEL } from "@/lib/labels";
import { tr } from "@/lib/i18n";
import { HIDDEN_SIGNUP_PATH, displayLogin } from "@/lib/phone";
import type { AppRole } from "@/lib/types";

interface Overview {
  companies: number; companies_active: number; companies_suspended: number; users: number; employees: number;
  active_7d: number; online_now: number; projects: number; assignments_7d: number; time_entries_7d: number;
  messages_7d: number; push_devices: number; signup_enabled: boolean;
  signups_by_week: { week: string; count: number }[];
  countries: { country: string; users: number }[];
}
interface OwnerCompany {
  id: string; name: string; created_at: string; timezone: string; status: "activ" | "suspendat"; plan: Plan;
  trial_until: string | null; owner_note: string | null; admin_email: string | null; users: number; employees: number;
  projects: number; assignments_7d: number; time_entries_7d: number; last_sign_in: string | null;
  last_city: string | null; last_country: string | null;
}
interface OwnerUser {
  user_id: string; login: string; name: string | null; role: AppRole; created_at: string; last_sign_in: string | null;
  last_city: string | null; last_country: string | null; last_device: string | null; installed: boolean; logins_30d: number;
}
interface LoginEvent {
  at: string; user_id: string; user_login: string | null; user_name: string | null; company_name: string | null; ip: string | null;
  city: string | null; region: string | null; country: string | null; lat: number | null; lon: number | null;
  device: string | null; installed: boolean;
  gps_lat: number | null; gps_lon: number | null; gps_accuracy: number | null; address: string | null;
}
type Plan = "gratuit" | "proba" | "standard" | "premium";
const PLAN_LABEL: Record<Plan, string> = { gratuit: "Gratuit", proba: "Perioadă de probă", standard: "Standard", premium: "Premium" };

// ---------- utilitare de afișare ----------
let regionNames: Intl.DisplayNames | null = null;
function countryName(code: string | null): string {
  if (!code || code === "?") return "Necunoscut";
  try { regionNames ??= new Intl.DisplayNames(["ro"], { type: "region" }); return regionNames.of(code) ?? code; } catch { return code; }
}
function flag(code: string | null): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
function place(city: string | null, country: string | null): string {
  if (!city && !country) return "—";
  return `${flag(country)} ${[city, country ? countryName(country) : null].filter(Boolean).join(", ")}`;
}
function ago(iso: string | null): string {
  if (!iso) return "niciodată";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "acum";
  if (s < 3600) return `acum ${Math.floor(s / 60)} min`;
  if (s < 86400) return `acum ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ieri" : d < 30 ? `acum ${d} zile` : new Date(iso).toLocaleDateString(localeTag());
}
const dt = (iso: string) => new Date(iso).toLocaleString(localeTag(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toISOString().slice(0, 10);
/** Lunea ultimelor n săptămâni (YYYY-MM-DD), ca în baza de date (date_trunc week, UTC). */
function lastWeeks(n: number): string[] {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return Array.from({ length: n }, (_, i) => { const x = new Date(d); x.setUTCDate(d.getUTCDate() - 7 * (n - 1 - i)); return x.toISOString().slice(0, 10); });
}
const fmtWeek = (w: string) => w.slice(5).split("-").reverse().join(".");

export default function ProprietarPage() {
  const { isOwner } = useSession();
  if (!isOwner) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-bold">Acces restricționat</h1>
        <p className="mt-2 text-sm text-slate-600">Această secțiune este disponibilă doar proprietarului aplicației.</p>
      </div>
    );
  }
  return <Suspense fallback={<Loading />}><Proprietar /></Suspense>;
}

type Tab = "prezentare" | "firme" | "activitate" | "conectari" | "harta" | "anunturi" | "platforma";
const TABS: Tab[] = ["prezentare", "firme", "activitate", "conectari", "harta", "anunturi", "platforma"];

function Proprietar() {
  const sp = useSearchParams();
  const initial = sp.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && TABS.includes(initial) ? initial : "prezentare");
  const [companyFilter, setCompanyFilter] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null);
  return (
    <div>
      <PageHeader title="Panoul proprietarului" subtitle="Toate firmele înregistrate în DYASPlanning. Vizibil doar pentru tine." />
      <div className="-mx-4 mb-4 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        <Tabs value={tab} onChange={setTab} items={[
          { value: "prezentare", label: "Prezentare" },
          { value: "firme", label: "Firme" },
          { value: "activitate", label: "Activitate" },
          { value: "conectari", label: "Conectări" },
          { value: "harta", label: "Hartă" },
          { value: "anunturi", label: "Anunțuri" },
          { value: "platforma", label: "Platformă" },
        ]} />
      </div>
      {tab === "prezentare" && <OverviewTab onOpen={(t) => setTab(t)} />}
      {tab === "firme" && <CompaniesTab onLogins={(id) => { setCompanyFilter(id); setTab("conectari"); }} onUser={setUserId} />}
      {tab === "activitate" && <ActivityTab company={companyFilter} setCompany={setCompanyFilter} onUser={setUserId} />}
      {tab === "conectari" && <LoginsTab company={companyFilter} setCompany={setCompanyFilter} onUser={setUserId} />}
      {tab === "harta" && <MapTab company={companyFilter} setCompany={setCompanyFilter} onUser={setUserId} />}
      <UserDetailModal userId={userId} onClose={() => setUserId(null)} />
      {tab === "anunturi" && <AnnouncementsTab />}
      {tab === "platforma" && <PlatformTab />}
    </div>
  );
}

// ---------- Prezentare ----------
function OverviewTab({ onOpen }: { onOpen: (t: Tab) => void }) {
  const q = useQuery(async () => must(await supabase().rpc("owner_overview")) as Overview, []);
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  const o = q.data!;
  const weeks = lastWeeks(12).map((w) => ({ week: w, count: o.signups_by_week.find((x) => x.week === w)?.count ?? 0 }));
  const max = Math.max(1, ...weeks.map((w) => w.count));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Firme" value={o.companies} sub={`${o.companies_active} active${o.companies_suspended ? ` · ${o.companies_suspended} suspendate` : ""}`} />
        <Stat label="Utilizatori" value={o.users} sub={`${o.employees} angajați în total`} />
        <Stat label="Activi 7 zile" value={o.active_7d} sub={`${o.online_now} conectați acum`} />
        <Stat label="Telefoane cu notificări" value={o.push_devices} />
        <Stat label="Lucrări" value={o.projects} />
        <Stat label="Alocări (7 zile)" value={o.assignments_7d} />
        <Stat label="Pontaje (7 zile)" value={o.time_entries_7d} />
        <Stat label="Mesaje chat (7 zile)" value={o.messages_7d} />
      </div>
      {!o.signup_enabled && <Notice tone="amber">Înscrierea firmelor noi este <strong>închisă</strong>. O poți redeschide din tab-ul Platformă.</Notice>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Firme noi pe săptămână">
          <div className="flex h-32 items-end gap-1 border-b border-slate-200">
            {weeks.map((w) => (
              <div key={w.week} className="flex h-full flex-1 flex-col items-center justify-end" title={`Săptămâna ${fmtWeek(w.week)}: ${w.count}`}>
                {w.count > 0 && <span className="mb-0.5 text-[11px] font-semibold text-slate-700">{w.count}</span>}
                <div className={cx("w-full max-w-[18px] rounded-t", w.count ? "bg-orange-500" : "bg-slate-100")} style={{ height: w.count ? `${Math.max(8, (w.count / max) * 96)}px` : "3px" }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-500"><span>{fmtWeek(weeks[0].week)}</span><span>săpt. curentă</span></div>
        </Card>
        <Card title="Țări · ultimele 30 de zile" action={<button className="text-sm font-semibold text-orange-700" onClick={() => onOpen("conectari")}>Detalii</button>}>
          {o.countries.length === 0 ? <p className="text-sm text-slate-600">Încă nu există conectări înregistrate. Apar de la următoarea deschidere a aplicației.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {o.countries.map((c) => (
                <li key={c.country} className="flex justify-between py-2"><span>{flag(c.country)} {countryName(c.country)}</span><span className="font-semibold">{c.users}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- Firme ----------
function CompaniesTab({ onLogins, onUser }: { onLogins: (id: string) => void; onUser: (id: string) => void }) {
  const q = useQuery(async () => must(await supabase().rpc("owner_companies")) as OwnerCompany[], []);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "activ" | "suspendat">("");
  const [open, setOpen] = useState<string | null>(null);
  const list = useMemo(() => (q.data ?? []).filter((c) =>
    (!status || c.status === status) &&
    (!search || `${c.name} ${c.admin_email ?? ""}`.toLowerCase().includes(search.toLowerCase()))), [q.data, search, status]);

  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Caută firmă sau email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="sm:w-48">
          <option value="">Toate firmele ({q.data?.length ?? 0})</option>
          <option value="activ">Active</option>
          <option value="suspendat">Suspendate</option>
        </Select>
      </div>
      {list.length === 0 && <Empty title="Nicio firmă găsită" />}
      {list.map((c) => {
        const expired = c.trial_until && c.trial_until < today();
        const isOpen = open === c.id;
        return (
          <div key={c.id} className={cx("rounded-xl border bg-white shadow-sm", c.status === "suspendat" ? "border-red-200" : "border-slate-200")}>
            <button className="flex w-full items-start justify-between gap-3 p-4 text-left" onClick={() => setOpen(isOpen ? null : c.id)}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.name}</span>
                  {c.status === "suspendat" ? <Badge tone="red">Suspendată</Badge> : <Badge tone="green">Activă</Badge>}
                  <Badge tone={c.plan === "gratuit" ? "gray" : "blue"}>{PLAN_LABEL[c.plan]}</Badge>
                  {c.trial_until && <Badge tone={expired ? "red" : "amber"}>{expired ? "Proba a expirat" : `Probă până ${new Date(c.trial_until).toLocaleDateString(localeTag())}`}</Badge>}
                </div>
                <div className="mt-1 truncate text-sm text-slate-600">{c.admin_email ?? "fără admin"} · înscrisă {new Date(c.created_at).toLocaleDateString(localeTag())}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {c.users} conturi · {c.employees} angajați · {c.projects} lucrări · {c.assignments_7d} alocări / 7 zile · activitate {ago(c.last_sign_in)}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">Ultima locație: {place(c.last_city, c.last_country)}</div>
              </div>
              {isOpen ? <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />}
            </button>
            {isOpen && <CompanyDetails c={c} onSaved={q.reload} onLogins={() => onLogins(c.id)} onUser={onUser} onDeleted={async () => { setOpen(null); await q.reload(); }} />}
          </div>
        );
      })}
    </div>
  );
}

function CompanyDetails({ c, onSaved, onLogins, onDeleted, onUser }: { c: OwnerCompany; onSaved: () => Promise<void>; onLogins: () => void; onDeleted: () => Promise<void>; onUser: (id: string) => void }) {
  const [delOpen, setDelOpen] = useState(false);
  const [delName, setDelName] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);
  async function remove() {
    setDelBusy(true); setDelErr(null);
    const { error } = await supabase().rpc("owner_delete_company", { p_company: c.id, p_confirm_name: delName });
    setDelBusy(false);
    if (error) { setDelErr(humanError(error)); return; }
    await onDeleted();
  }
  const users = useQuery(async () => must(await supabase().rpc("owner_company_users", { p_company: c.id })) as OwnerUser[], [c.id]);
  const [status, setStatus] = useState(c.status);
  const [plan, setPlan] = useState<Plan>(c.plan);
  const [trial, setTrial] = useState(c.trial_until ?? "");
  const [note, setNote] = useState(c.owner_note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);

  async function save(nextStatus = status) {
    if (nextStatus === "suspendat" && c.status !== "suspendat" &&
      !window.confirm(`Suspenzi firma „${c.name}”? Toți utilizatorii ei pierd imediat accesul (datele rămân salvate).`)) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase().rpc("owner_update_company", { p_company: c.id, p_status: nextStatus, p_plan: plan, p_trial_until: trial || null, p_note: note });
    setBusy(false);
    if (error) { setMsg({ tone: "red", text: humanError(error) }); return; }
    setStatus(nextStatus);
    setMsg({ tone: "green", text: "Salvat." });
    await onSaved();
  }

  return (
    <div className="space-y-4 border-t border-slate-100 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Plan">
          <Select value={plan} onChange={(e) => setPlan(e.target.value as Plan)}>
            {(Object.keys(PLAN_LABEL) as Plan[]).map((p) => <option key={p} value={p}>{PLAN_LABEL[p]}</option>)}
          </Select>
        </Field>
        <Field label="Perioadă de probă până la" hint="Gol = fără limită">
          <Input type="date" value={trial} onChange={(e) => setTrial(e.target.value)} />
        </Field>
        <Field label="Fus orar"><Input value={c.timezone} disabled /></Field>
      </div>
      <Field label="Notă internă (o vezi doar tu)">
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. a plătit până în martie, persoană de contact…" />
      </Field>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => save()} loading={busy}>Salvează</Button>
        {status === "activ"
          ? <Button variant="danger" onClick={() => save("suspendat")} disabled={busy}>Suspendă firma</Button>
          : <Button onClick={() => save("activ")} disabled={busy}>Reactivează firma</Button>}
        <Button variant="ghost" onClick={onLogins}><MapPin className="h-4 w-4" /> Conectările firmei</Button>
      </div>

      <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
        {!delOpen ? (
          <button className="text-sm font-semibold text-red-700" onClick={() => setDelOpen(true)}>Șterge firma definitiv…</button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-red-900">Se șterg <strong>toate datele</strong> firmei: lucrări, alocări, pontaje, mașini, chat și conturile de telefon ale angajaților. <strong>Nu se mai poate recupera.</strong> Dacă vrei doar să le oprești accesul, folosește „Suspendă firma”.</p>
            <Field label={`Scrie numele firmei pentru confirmare: ${c.name}`}>
              <Input value={delName} onChange={(e) => setDelName(e.target.value)} placeholder={c.name} />
            </Field>
            {delErr && <ErrorBox message={delErr} />}
            <div className="flex gap-2">
              <Button variant="danger" onClick={remove} loading={delBusy} disabled={delName.trim() !== c.name}>Șterge definitiv</Button>
              <Button onClick={() => { setDelOpen(false); setDelName(""); }}>Renunță</Button>
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Conturi ({users.data?.length ?? "…"})</h3>
        {users.loading && !users.data ? <Loading /> : users.error ? <ErrorBox message={users.error} onRetry={users.reload} /> : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {(users.data ?? []).map((u) => (
              <li key={u.user_id} role="button" tabIndex={0} onClick={() => onUser(u.user_id)} onKeyDown={(e) => e.key === "Enter" && onUser(u.user_id)}
                className="flex cursor-pointer flex-col gap-0.5 p-3 hover:bg-orange-50/50 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="font-medium">{u.name ?? displayLogin(u.login)} <span className="text-xs font-normal text-slate-500">· {ROLE_LABEL[u.role]}</span></div>
                  <div className="truncate text-xs text-slate-500">{displayLogin(u.login)}{u.installed ? " · aplicație instalată" : ""}</div>
                </div>
                <div className="text-xs text-slate-600 sm:text-right">
                  <div>{ago(u.last_sign_in)} · {u.logins_30d} conectări / 30 zile</div>
                  <div>{place(u.last_city, u.last_country)}{u.last_device ? ` · ${u.last_device}` : ""}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- Conectări ----------
function LoginsTab({ company, setCompany, onUser }: { company: string; setCompany: (v: string) => void; onUser: (id: string) => void }) {
  const companies = useQuery(async () => must(await supabase().rpc("owner_companies")) as OwnerCompany[], []);
  const q = useQuery(async () => must(await supabase().rpc("owner_login_events", { p_company: company || null, p_limit: 300 })) as LoginEvent[], [company]);
  const cities = useMemo(() => {
    const m = new Map<string, { label: string; n: number; users: Set<string> }>();
    for (const e of q.data ?? []) {
      const k = `${e.city ?? "?"}|${e.country ?? "?"}`;
      const v = m.get(k) ?? { label: place(e.city, e.country), n: 0, users: new Set<string>() };
      v.n++; if (e.user_login) v.users.add(e.user_login);
      m.set(k, v);
    }
    return [...m.values()].sort((a, b) => b.users.size - a.users.size).slice(0, 12);
  }, [q.data]);

  return (
    <div className="space-y-4">
      <Select value={company} onChange={(e) => setCompany(e.target.value)} className="sm:w-80">
        <option value="">Toate firmele</option>
        {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <p className="text-xs text-slate-500">
        <Crosshair className="inline h-3.5 w-3.5 text-orange-600" /> GPS = locația exactă a telefonului (când omul a permis locația).{" "}
        <Globe className="inline h-3.5 w-3.5" /> IP = aproximativ, după rețeaua de internet; pe iPhone cu „iCloud Private Relay” sau cu VPN orașul poate fi greșit. Istoricul se păstrează 90 de zile.
      </p>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : (q.data ?? []).length === 0 ? (
        <Empty title="Nicio conectare înregistrată încă">Conectările apar de acum înainte, la fiecare deschidere a aplicației.</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Orașe" className="lg:col-span-1">
            <ul className="divide-y divide-slate-100 text-sm">
              {cities.map((c) => (
                <li key={c.label} className="flex justify-between gap-2 py-2"><span className="truncate">{c.label}</span><span className="shrink-0 text-slate-600">{c.users.size} pers.</span></li>
              ))}
            </ul>
          </Card>
          <Card title={`Ultimele conectări (${q.data!.length})`} className="lg:col-span-2">
            <ul className="divide-y divide-slate-100 text-sm">
              {q.data!.map((e, i) => <LoginRow key={i} e={e} onUser={onUser} />)}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------- Activitate ----------
interface Activity {
  at: string; company_id: string; company_name: string | null; user_id: string | null; actor: string | null; entity: string; op: string; n: number; summary: string;
  details: { label: string; changes?: { f: string; from: string; to: string }[] }[] | null;
}
function ActivityTab({ company, setCompany, onUser }: { company: string; setCompany: (v: string) => void; onUser: (id: string) => void }) {
  const companies = useQuery(async () => must(await supabase().rpc("owner_companies")) as OwnerCompany[], []);
  const q = useQuery(async () => must(await supabase().rpc("owner_activity_feed", { p_company: company || null, p_limit: 300 })) as Activity[], [company]);
  const tone = (op: string) => (op === "DELETE" ? "red" : op === "INSERT" ? "green" : "blue") as "red" | "green" | "blue";
  return (
    <div className="space-y-3">
      <Select value={company} onChange={(e) => setCompany(e.target.value)} className="sm:w-80">
        <option value="">Toate firmele</option>
        {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <p className="text-xs text-slate-500">Tot ce fac administratorii firmelor: lucrări, alocări, angajați, pontaje aprobate, mașini, setări. Păstrat 90 de zile.</p>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : (q.data ?? []).length === 0 ? (
        <Empty title="Nicio activitate încă">Acțiunile administratorilor apar aici de acum înainte.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100 text-sm">
            {q.data!.map((a, i) => <ActivityRow key={i} a={a} tone={tone(a.op)} onUser={onUser} />)}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------- Anunțuri ----------
interface Ann { id: string; title: string; body: string | null; tone: "info" | "warning"; created_at: string; ends_at: string | null; active: boolean }
function AnnouncementsTab() {
  const q = useQuery(async () => must(await supabase().rpc("owner_announcements")) as Ann[], []);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tone, setTone] = useState<"info" | "warning">("info");
  const [days, setDays] = useState("7");
  const [pushToo, setPushToo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "green" | "red"; text: string } | null>(null);
  const live = (q.data ?? []).find((a) => a.active && (!a.ends_at || new Date(a.ends_at) > new Date()));

  async function publish() {
    setBusy(true); setMsg(null);
    const { error } = await supabase().rpc("owner_publish_announcement", { p_title: title, p_body: body, p_tone: tone, p_days: Number(days) || 0, p_push: pushToo });
    setBusy(false);
    if (error) { setMsg({ tone: "red", text: humanError(error) }); return; }
    setTitle(""); setBody(""); setMsg({ tone: "green", text: pushToo ? "Anunț publicat și trimis ca notificare tuturor." : "Anunț publicat." });
    await q.reload();
  }
  async function stop() {
    setBusy(true);
    const { error } = await supabase().rpc("owner_end_announcement");
    setBusy(false);
    if (error) setMsg({ tone: "red", text: humanError(error) }); else await q.reload();
  }

  return (
    <div className="space-y-4">
      {live && (
        <Card title="Anunț activ acum" action={<Button size="sm" variant="danger" onClick={stop} loading={busy}>Oprește</Button>}>
          <div className={cx("rounded-lg border p-3 text-sm", live.tone === "warning" ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-blue-50")}>
            <div className="font-semibold">{live.title}</div>
            {live.body && <div className="mt-0.5 whitespace-pre-line">{live.body}</div>}
          </div>
          <p className="mt-2 text-xs text-slate-500">{live.ends_at ? `Se afișează până pe ${dt(live.ends_at)}.` : "Fără dată de final."}</p>
        </Card>
      )}
      <Card title="Anunț nou pentru toate firmele">
        <div className="space-y-3">
          <Field label="Titlu"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Mentenanță duminică 22:00–23:00" /></Field>
          <Field label="Mesaj (opțional)"><Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Detalii pentru utilizatori…" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tip">
              <Select value={tone} onChange={(e) => setTone(e.target.value as "info" | "warning")}>
                <option value="info">Informare (albastru)</option>
                <option value="warning">Atenționare (galben)</option>
              </Select>
            </Field>
            <Field label="Se afișează">
              <Select value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">1 zi</option><option value="3">3 zile</option><option value="7">7 zile</option>
                <option value="30">30 de zile</option><option value="0">Până îl opresc</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-orange-600" checked={pushToo} onChange={(e) => setPushToo(e.target.checked)} />Trimite și ca notificare pe telefon tuturor utilizatorilor</label>
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <Button variant="primary" onClick={publish} loading={busy} disabled={!title.trim()}><Megaphone className="h-4 w-4" /> Publică anunțul</Button>
          <p className="text-xs text-slate-500">Apare sus în aplicație la toate firmele active. Un anunț nou îl înlocuiește pe cel vechi. Fiecare utilizator îl poate închide.</p>
        </div>
      </Card>
      {(q.data ?? []).length > 0 && (
        <Card title="Istoric">
          <ul className="divide-y divide-slate-100 text-sm">
            {q.data!.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{a.title}</span>
                <span className="shrink-0 text-xs text-slate-500">{new Date(a.created_at).toLocaleDateString(localeTag())}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ---------- Platformă ----------
function PlatformTab() {
  const q = useQuery(async () => must(await supabase().rpc("owner_settings")) as { signup_enabled: boolean; activity_push: boolean }, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [testState, setTestState] = useState<"idle" | "busy" | "sent">("idle");
  async function testAlert() {
    setTestState("busy"); setErr(null);
    const { error } = await supabase().rpc("owner_test_alert");
    if (error) { setErr(humanError(error)); setTestState("idle"); } else setTestState("sent");
  }
  const signupUrl = typeof window !== "undefined" ? `${window.location.origin}${HIDDEN_SIGNUP_PATH}` : HIDDEN_SIGNUP_PATH;

  async function toggleActivity(v: boolean) {
    setBusy(true); setErr(null);
    const { error } = await supabase().rpc("owner_set_activity_push", { p_enabled: v });
    setBusy(false);
    if (error) setErr(humanError(error)); else await q.reload();
  }
  async function toggle(v: boolean) {
    setBusy(true); setErr(null);
    const { error } = await supabase().rpc("owner_set_signup", { p_enabled: v });
    setBusy(false);
    if (error) setErr(humanError(error)); else await q.reload();
  }
  if (q.loading && !q.data) return <Loading />;
  if (q.error) return <ErrorBox message={q.error} onRetry={q.reload} />;
  const on = q.data!.signup_enabled;
  return (
    <div className="space-y-4">
      <Card title="Înscrierea firmelor noi">
        <p className="text-sm text-slate-700">
          Pagina ascunsă de creare cont este <strong>{on ? "deschisă" : "închisă"}</strong>.
          {on ? " Oricine are linkul își poate face firmă." : " Nimeni nu își mai poate crea firmă (tu poți oricând)."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {on ? <Button variant="danger" onClick={() => toggle(false)} loading={busy}>Închide înscrierile</Button>
            : <Button variant="primary" onClick={() => toggle(true)} loading={busy}>Deschide înscrierile</Button>}
          <Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(signupUrl); setCopied(true); } catch { /* ignoră */ } }}>
            <Copy className="h-4 w-4" /> {copied ? "Link copiat" : "Copiază linkul de înscriere"}
          </Button>
        </div>
        {err && <div className="mt-3"><ErrorBox message={err} /></div>}
      </Card>
      <Card title="Alerte pentru tine">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li><strong>Firmă nouă</strong> înscrisă: imediat, cu emailul adminului.</li>
          <li><strong>Proba expiră în 3 zile</strong> și <strong>proba a expirat</strong>: zilnic la 08:17.</li>
          <li><strong>Firmă inactivă de 14 zile</strong> (nimeni nu a mai deschis aplicația): zilnic la 08:17.</li>
          <li><strong>Fiecare acțiune a unui administrator de firmă</strong> (cel mult o notificare la 2 minute pentru același tip de acțiune; toate apar în tab-ul Activitate).</li>
        </ul>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-orange-600" checked={q.data!.activity_push} disabled={busy} onChange={(e) => toggleActivity(e.target.checked)} />
          Notificare pe telefon pentru acțiunile administratorilor
        </label>
        <p className="mt-2 text-xs text-slate-500">Ajung în clopoțel, ca notificare pe telefon (dacă ai activat notificările pe acest dispozitiv) și pe email (după configurarea serviciului de email).</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={testAlert} loading={testState === "busy"}>Trimite o alertă de test</Button>
          {testState === "sent" && <span className="text-sm text-green-800">✓ Trimisă: verifică clopoțelul, telefonul și emailul.</span>}
        </div>
      </Card>
      <Card title="Ce poți face din acest panou">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li><strong>Suspendă</strong> o firmă (de ex. neplată): utilizatorii ei văd „Contul firmei este suspendat”, datele rămân intacte și revin la reactivare.</li>
          <li>Setează <strong>planul</strong> și <strong>perioada de probă</strong>; probele expirate apar cu roșu în lista de firme.</li>
          <li>Ține <strong>note interne</strong> pe fiecare firmă (plăți, persoană de contact).</li>
          <li>Vezi <strong>de unde se conectează</strong> oamenii: oraș, țară, dispozitiv, dacă au aplicația instalată.</li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">Administratorii firmelor nu pot vedea acest panou și nu își pot schimba singuri planul sau statusul.</p>
      </Card>
    </div>
  );
}

// ---------- Conectare (rând) ----------
function LoginRow({ e, onUser }: { e: LoginEvent; onUser: (id: string) => void }) {
  const gps = e.gps_lat != null && e.gps_lon != null;
  const mapUrl = gps ? `https://www.google.com/maps?q=${e.gps_lat},${e.gps_lon}` : e.lat != null && e.lon != null ? `https://www.google.com/maps?q=${e.lat},${e.lon}` : null;
  return (
    <li className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <button className="text-left font-medium text-slate-900 hover:text-orange-700" onClick={() => onUser(e.user_id)}>
          <span data-no-i18n>{e.user_name ?? displayLogin(e.user_login)}</span>
        </button>{" "}
        <span className="text-xs text-slate-500">· {e.company_name ?? "fără firmă"}</span>
        <div className="text-xs text-slate-500">{e.device ?? "—"}{e.installed ? " · aplicație instalată" : ""}{e.ip ? ` · IP ${e.ip}` : ""}</div>
      </div>
      <div className="text-xs text-slate-600 sm:max-w-[55%] sm:text-right">
        <div>{dt(e.at)}</div>
        {gps ? (
          <div className="text-slate-800">
            <Crosshair className="mr-1 inline h-3.5 w-3.5 text-orange-600" />
            <span data-no-i18n>{e.address ?? `${e.gps_lat!.toFixed(5)}, ${e.gps_lon!.toFixed(5)}`}</span>
            {e.gps_accuracy != null && <span className="text-slate-500"> (±{e.gps_accuracy} m)</span>}
          </div>
        ) : (
          <div><Globe className="mr-1 inline h-3.5 w-3.5" />{place(e.city, e.country)} <span className="text-slate-400">· aproximativ (IP)</span></div>
        )}
        {mapUrl && <a className="font-semibold text-orange-700" target="_blank" rel="noreferrer" href={mapUrl}>hartă</a>}
      </div>
    </li>
  );
}

// ---------- Activitate (rând, cu detalii) ----------
const OP_LABEL: Record<string, string> = { INSERT: "adăugare", UPDATE: "modificare", DELETE: "ștergere" };
function ActivityRow({ a, tone, onUser }: { a: Activity; tone: "red" | "green" | "blue"; onUser: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const items = a.details ?? [];
  const hasMore = items.length > 0 && (items.length > 1 || (items[0].changes?.length ?? 0) > 0);
  return (
    <li className="py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{a.summary}</div>
          <div className="text-xs text-slate-500">
            {a.user_id ? <button className="font-semibold text-orange-700" onClick={() => onUser(a.user_id!)}><span data-no-i18n>{a.actor}</span></button> : <span data-no-i18n>{a.actor}</span>}
            {" · "}{a.company_name ?? "—"}
          </div>
          {hasMore && (
            <button className="mt-1 text-xs font-semibold text-slate-600 underline" onClick={() => setOpen(!open)}>{open ? "Ascunde detaliile" : "Vezi ce s-a schimbat"}</button>
          )}
        </div>
        <div className="shrink-0 text-right">
          <Badge tone={tone}>{OP_LABEL[a.op] ?? a.op}</Badge>
          <div className="mt-1 text-xs text-slate-500">{ago(a.at)}</div>
          <div className="text-[11px] text-slate-400">{dt(a.at)}</div>
        </div>
      </div>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2.5 text-xs">
          {items.map((it, j) => (
            <div key={j}>
              <div className="font-semibold text-slate-800" data-no-i18n>{it.label}</div>
              {(it.changes ?? []).map((c, k) => (
                <div key={k} className="mt-0.5 flex flex-wrap gap-x-1 text-slate-600">
                  <span className="font-medium">{c.f}:</span>
                  <span className="line-through decoration-slate-400">{c.from}</span>
                  <span>→</span>
                  <span className="font-medium text-slate-900">{c.to}</span>
                </div>
              ))}
            </div>
          ))}
          {a.n > items.length && <div className="text-slate-500">… și încă {a.n - items.length}</div>}
        </div>
      )}
    </li>
  );
}

// ---------- Hartă ----------
function MapTab({ company, setCompany, onUser }: { company: string; setCompany: (v: string) => void; onUser: (id: string) => void }) {
  const companies = useQuery(async () => must(await supabase().rpc("owner_companies")) as OwnerCompany[], []);
  const q = useQuery(async () => must(await supabase().rpc("owner_map_points", { p_company: company || null })) as MapPoint[], [company]);
  const labels = useMemo(() => ({ precise: tr("GPS exact"), approx: tr("aproximativ (IP)"), details: tr("Vezi fișa") }), []);
  const precise = (q.data ?? []).filter((p) => p.precise).length;
  return (
    <div className="space-y-3">
      <Select value={company} onChange={(e) => setCompany(e.target.value)} className="sm:w-80">
        <option value="">Toate firmele</option>
        {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </Select>
      <p className="text-xs text-slate-500">
        Ultima poziție a fiecărui utilizator (ultimele 30 de zile).{" "}
        <span className="font-semibold text-orange-700">● GPS exact</span>{" "}
        <span className="font-semibold text-slate-500">● aproximativ (IP)</span>
        {q.data && <> · {precise} / {q.data.length} cu GPS</>}
      </p>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : (
        <OwnerMap points={q.data ?? []} onUser={onUser} labels={labels} />
      )}
    </div>
  );
}

// ---------- Fișa utilizatorului ----------
interface UserDetail {
  user_id: string; login: string | null; created_at: string; last_sign_in: string | null; name: string | null; role: AppRole | null;
  company_id: string | null; company: string | null; phone: string | null; trade: string | null; is_driver: boolean | null;
  logins_30d: number; push_devices: number; assignments_7d: number; time_entries_30d: number; hours_30d: number; messages_30d: number;
  devices: { device: string | null; ip: string | null; city: string | null; country: string | null; installed: boolean; count: number; first: string; last: string }[];
}
function UserDetailModal({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const d = useQuery(async () => (userId ? must(await supabase().rpc("owner_user_detail", { p_user: userId })) as UserDetail : null), [userId]);
  const logins = useQuery(async () => (userId ? must(await supabase().rpc("owner_login_events", { p_user: userId, p_limit: 50 })) as LoginEvent[] : []), [userId]);
  const acts = useQuery(async () => (userId ? must(await supabase().rpc("owner_activity_feed", { p_user: userId, p_limit: 50 })) as Activity[] : []), [userId]);
  const u = d.data;
  return (
    <Modal open={!!userId} onClose={onClose} title={u?.name ?? (u ? displayLogin(u.login) : "…")} wide>
      {d.loading && !u ? <Loading /> : d.error ? <ErrorBox message={d.error} /> : u && (
        <div className="space-y-4 text-sm">
          <div className="grid gap-1 text-slate-700 sm:grid-cols-2">
            <div><span className="text-slate-500">Firmă:</span> <span data-no-i18n>{u.company ?? "—"}</span></div>
            <div><span className="text-slate-500">Rol:</span> {u.role ? ROLE_LABEL[u.role] : "—"}{u.is_driver ? " · Șofer" : ""}</div>
            <div><span className="text-slate-500">Cont:</span> <span data-no-i18n>{displayLogin(u.login)}</span></div>
            {u.phone && <div><span className="text-slate-500">Telefon:</span> <a className="text-orange-700" href={`tel:${u.phone.replace(/\s/g, "")}`}>{u.phone}</a></div>}
            {u.trade && <div><span className="text-slate-500">Meserie:</span> <span data-no-i18n>{u.trade}</span></div>}
            <div><span className="text-slate-500">Cont creat:</span> {new Date(u.created_at).toLocaleDateString(localeTag())}</div>
            <div><span className="text-slate-500">Ultima autentificare:</span> {u.last_sign_in ? dt(u.last_sign_in) : "niciodată"}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Conectări / 30 zile" value={u.logins_30d} />
            <Stat label="Ore aprobate / 30 zile" value={u.hours_30d} />
            <Stat label="Mesaje / 30 zile" value={u.messages_30d} />
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Dispozitive ({u.devices.length}) · {u.push_devices} cu notificări</h3>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {u.devices.map((v, i) => (
                <li key={i} className="flex flex-col gap-0.5 p-2.5 sm:flex-row sm:justify-between">
                  <div>
                    <div className="font-medium">{v.device ?? "—"}{v.installed ? " · aplicație instalată" : ""}</div>
                    <div className="text-xs text-slate-500">IP {v.ip ?? "—"} · {place(v.city, v.country)}</div>
                  </div>
                  <div className="text-xs text-slate-600 sm:text-right">
                    <div>{v.count} conectări</div>
                    <div>{dt(v.first)} → {dt(v.last)}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Ultimele conectări</h3>
            {logins.loading && !logins.data ? <Loading /> : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-2.5">
                {(logins.data ?? []).map((e, i) => <LoginRow key={i} e={e} onUser={() => undefined} />)}
              </ul>
            )}
          </div>
          {(acts.data ?? []).length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">Acțiuni ca administrator</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 px-2.5">
                {acts.data!.map((a, i) => <ActivityRow key={i} a={a} tone={(a.op === "DELETE" ? "red" : a.op === "INSERT" ? "green" : "blue")} onUser={() => undefined} />)}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
