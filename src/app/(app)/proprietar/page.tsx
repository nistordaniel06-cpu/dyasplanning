"use client";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Copy, MapPin, Search } from "lucide-react";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Stat, Tabs, Textarea, cx } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { ROLE_LABEL } from "@/lib/labels";
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
  at: string; user_login: string | null; user_name: string | null; company_name: string | null; ip: string | null;
  city: string | null; region: string | null; country: string | null; lat: number | null; lon: number | null;
  device: string | null; installed: boolean;
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
  return d === 1 ? "ieri" : d < 30 ? `acum ${d} zile` : new Date(iso).toLocaleDateString("ro-RO");
}
const dt = (iso: string) => new Date(iso).toLocaleString("ro-RO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toISOString().slice(0, 10);

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
  return <Proprietar />;
}

type Tab = "prezentare" | "firme" | "conectari" | "platforma";

function Proprietar() {
  const [tab, setTab] = useState<Tab>("prezentare");
  const [companyFilter, setCompanyFilter] = useState<string>("");
  return (
    <div>
      <PageHeader title="Panoul proprietarului" subtitle="Toate firmele înregistrate în DYASPlanning. Vizibil doar pentru tine." />
      <div className="mb-4 overflow-x-auto">
        <Tabs value={tab} onChange={setTab} items={[
          { value: "prezentare", label: "Prezentare" },
          { value: "firme", label: "Firme" },
          { value: "conectari", label: "Conectări" },
          { value: "platforma", label: "Platformă" },
        ]} />
      </div>
      {tab === "prezentare" && <OverviewTab onOpen={(t) => setTab(t)} />}
      {tab === "firme" && <CompaniesTab onLogins={(id) => { setCompanyFilter(id); setTab("conectari"); }} />}
      {tab === "conectari" && <LoginsTab company={companyFilter} setCompany={setCompanyFilter} />}
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
  const max = Math.max(1, ...o.signups_by_week.map((w) => w.count));
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
        <Card title="Firme noi pe săptămână (ultimele 12)">
          {o.signups_by_week.length === 0 ? <p className="text-sm text-slate-600">Nicio firmă nouă în ultimele 12 săptămâni.</p> : (
            <div className="flex h-36 items-end gap-1.5">
              {o.signups_by_week.map((w) => (
                <div key={w.week} className="flex flex-1 flex-col items-center gap-1" title={`Săpt. ${w.week}: ${w.count}`}>
                  <span className="text-xs font-semibold text-slate-700">{w.count}</span>
                  <div className="w-full rounded-t bg-orange-500" style={{ height: `${(w.count / max) * 100}px` }} />
                  <span className="text-[10px] text-slate-500">{w.week.slice(5).split("-").reverse().join(".")}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Țări (utilizatori conectați în ultimele 30 de zile)" action={<button className="text-sm font-semibold text-orange-700" onClick={() => onOpen("conectari")}>Vezi conectările</button>}>
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
function CompaniesTab({ onLogins }: { onLogins: (id: string) => void }) {
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
                  {c.trial_until && <Badge tone={expired ? "red" : "amber"}>{expired ? "Proba a expirat" : `Probă până ${new Date(c.trial_until).toLocaleDateString("ro-RO")}`}</Badge>}
                </div>
                <div className="mt-1 truncate text-sm text-slate-600">{c.admin_email ?? "fără admin"} · înscrisă {new Date(c.created_at).toLocaleDateString("ro-RO")}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {c.users} conturi · {c.employees} angajați · {c.projects} lucrări · {c.assignments_7d} alocări / 7 zile · activitate {ago(c.last_sign_in)}
                </div>
                <div className="mt-0.5 text-xs text-slate-500">Ultima locație: {place(c.last_city, c.last_country)}</div>
              </div>
              {isOpen ? <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />}
            </button>
            {isOpen && <CompanyDetails c={c} onSaved={q.reload} onLogins={() => onLogins(c.id)} />}
          </div>
        );
      })}
    </div>
  );
}

function CompanyDetails({ c, onSaved, onLogins }: { c: OwnerCompany; onSaved: () => Promise<void>; onLogins: () => void }) {
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

      <div>
        <h3 className="mb-2 text-sm font-semibold">Conturi ({users.data?.length ?? "…"})</h3>
        {users.loading && !users.data ? <Loading /> : users.error ? <ErrorBox message={users.error} onRetry={users.reload} /> : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {(users.data ?? []).map((u) => (
              <li key={u.user_id} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:items-center sm:justify-between">
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
function LoginsTab({ company, setCompany }: { company: string; setCompany: (v: string) => void }) {
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
      <p className="text-xs text-slate-500">Locația e aproximativă (după rețeaua de internet, la nivel de oraș), nu GPS. Istoricul se păstrează 90 de zile.</p>
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
              {q.data!.map((e, i) => (
                <li key={i} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">{e.user_name ?? displayLogin(e.user_login)} <span className="text-xs font-normal text-slate-500">· {e.company_name ?? "fără firmă"}</span></div>
                    <div className="text-xs text-slate-500">{e.device ?? "—"}{e.installed ? " · aplicație instalată" : ""}{e.ip ? ` · IP ${e.ip}` : ""}</div>
                  </div>
                  <div className="text-xs text-slate-600 sm:text-right">
                    <div>{dt(e.at)}</div>
                    <div>
                      {place(e.city, e.country)}
                      {e.lat != null && e.lon != null && (
                        <a className="ml-1 font-semibold text-orange-700" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${e.lat},${e.lon}`}>hartă</a>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

// ---------- Platformă ----------
function PlatformTab() {
  const q = useQuery(async () => must(await supabase().rpc("owner_overview")) as Overview, []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const signupUrl = typeof window !== "undefined" ? `${window.location.origin}${HIDDEN_SIGNUP_PATH}` : HIDDEN_SIGNUP_PATH;

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
