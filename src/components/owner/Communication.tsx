"use client";
// Panoul proprietarului: mesaje directe, „Ce e nou”, cereri de ajutor, mod mentenanță.
import { useState } from "react";
import { CheckCircle2, Construction, Megaphone, Pencil, Send, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { useQuery, must } from "@/lib/useQuery";
import { ROLE_LABEL } from "@/lib/labels";
import type { AppRole } from "@/lib/types";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, Select, Textarea } from "../ui";

const when = (iso: string) => new Date(iso).toLocaleString("ro-RO", { dateStyle: "medium", timeStyle: "short" });

// ================= Mesaje directe =================
interface CompanyLite { id: string; name: string }
interface UserLite { user_id: string; name: string | null; login: string; role: AppRole }
interface SentMessage { id: string; company_name: string | null; user_name: string | null; audience: string; title: string; body: string | null; banner: boolean; recipients: number; created_at: string }

export function MessagesTab() {
  const companies = useQuery(async () => (must(await supabase().rpc("owner_companies")) as CompanyLite[]), []);
  const history = useQuery(async () => must(await supabase().rpc("owner_messages_list")) as SentMessage[], []);
  const [company, setCompany] = useState("");
  const users = useQuery(async () => company ? must(await supabase().rpc("owner_company_users", { p_company: company })) as UserLite[] : [], [company]);
  const [to, setTo] = useState<"toti" | "admini" | "unul">("toti");
  const [user, setUser] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [banner, setBanner] = useState(false);
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setSent(null);
    if (!company) { setErr("Alege firma."); return; }
    if (to === "unul" && !user) { setErr("Alege persoana."); return; }
    setBusy(true);
    const { data, error } = await supabase().rpc("owner_send_message", {
      p_company: company, p_user: to === "unul" ? user : null, p_title: title, p_body: body,
      p_audience: to === "admini" ? "admini" : "toti", p_banner: to !== "unul" && banner, p_days: Number(days) || 7,
    });
    setBusy(false);
    if (error) { setErr(humanError(error)); return; }
    setSent(data as number); setTitle(""); setBody(""); setBanner(false);
    await history.reload();
  }

  return (
    <div className="space-y-4">
      <Card title="Trimite un mesaj">
        <form onSubmit={send} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Firma">
              <Select value={company} onChange={(e) => { setCompany(e.target.value); setUser(""); }}>
                <option value="">Alege firma…</option>
                {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Către">
              <Select value={to} onChange={(e) => setTo(e.target.value as typeof to)}>
                <option value="toti">Toți oamenii firmei</option>
                <option value="admini">Doar administratorii</option>
                <option value="unul">O singură persoană</option>
              </Select>
            </Field>
          </div>
          {to === "unul" && (
            <Field label="Persoana">
              <Select value={user} onChange={(e) => setUser(e.target.value)} disabled={!company}>
                <option value="">{company ? "Alege persoana…" : "Alege întâi firma"}</option>
                {(users.data ?? []).map((u) => <option key={u.user_id} value={u.user_id}>{u.name ?? u.login} · {ROLE_LABEL[u.role]}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Titlu"><Input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Am adăugat backup-ul datelor" /></Field>
          <Field label="Mesaj"><Textarea rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          {to !== "unul" && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={banner} onChange={(e) => setBanner(e.target.checked)} className="h-4 w-4 accent-orange-600" />Afișează și ca banner în aplicația firmei</label>
              {banner && <label className="flex items-center gap-2">timp de <Input className="h-8 w-16" type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} /> zile</label>}
            </div>
          )}
          <p className="text-xs text-slate-500">Mesajul ajunge ca notificare pe telefon și rămâne în „Notificări”.</p>
          {err && <ErrorBox message={err} />}
          {sent !== null && <Notice tone="green">Trimis către {sent} {sent === 1 ? "persoană" : "persoane"}.</Notice>}
          <Button variant="primary" type="submit" loading={busy}><Send className="h-4 w-4" />Trimite</Button>
        </form>
      </Card>
      <Card title="Mesaje trimise">
        {history.loading && !history.data ? <Loading /> : history.error ? <ErrorBox message={history.error} onRetry={history.reload} /> :
          (history.data ?? []).length === 0 ? <p className="text-sm text-slate-500">Niciun mesaj încă.</p> : (
            <ul className="divide-y divide-slate-100">
              {history.data!.map((m) => (
                <li key={m.id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold" data-no-i18n>{m.title}</span>
                    {m.banner && <Badge tone="blue">banner</Badge>}
                    <span className="text-xs text-slate-500">{when(m.created_at)}</span>
                  </div>
                  <div className="text-xs text-slate-600">
                    <span data-no-i18n>{m.company_name ?? "—"}</span> · {m.user_name ? <span data-no-i18n>{m.user_name}</span> : m.audience === "admini" ? "administratorii" : "toată firma"} · {m.recipients} destinatari
                  </div>
                  {m.body && <div className="mt-0.5 text-slate-700" data-no-i18n>{m.body}</div>}
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  );
}

// ================= Ce e nou =================
interface News { id: string; title: string; body: string; audience: "toti" | "admini"; published: boolean; created_at: string; seen: number }

export function NewsTab() {
  const q = useQuery(async () => must(await supabase().rpc("owner_news_list")) as News[], []);
  const [edit, setEdit] = useState<Partial<News> | null>(null);
  return (
    <div className="space-y-4">
      <Notice tone="blue">
        <span className="flex items-start gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Scrie aici ce ai adăugat nou. Fiecare utilizator vede noutățile o singură dată, într-o fereastră „Ce e nou”, la următoarea deschidere a aplicației.</span>
        </span>
      </Notice>
      <Button variant="primary" onClick={() => setEdit({ audience: "toti", published: true })}><Megaphone className="h-4 w-4" />Noutate nouă</Button>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> :
        (q.data ?? []).length === 0 ? <Empty title="Nicio noutate încă" /> : (
          <ul className="space-y-2">
            {q.data!.map((n) => (
              <li key={n.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold" data-no-i18n>{n.title}</span>
                  {!n.published && <Badge tone="gray">ciornă</Badge>}
                  <Badge tone={n.audience === "admini" ? "amber" : "blue"}>{n.audience === "admini" ? "doar administratori" : "toți"}</Badge>
                  <span className="text-xs text-slate-500">{when(n.created_at)} · văzută de {n.seen}</span>
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" variant="ghost" aria-label="Modifică" onClick={() => setEdit(n)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" aria-label="Șterge" onClick={async () => {
                      if (!confirm("Ștergi noutatea?")) return;
                      const { error } = await supabase().rpc("owner_news_delete", { p_id: n.id });
                      if (error) alert(humanError(error)); else await q.reload();
                    }}><Trash2 className="h-4 w-4" /></Button>
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700" data-no-i18n>{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      {edit && <NewsForm news={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await q.reload(); }} />}
    </div>
  );
}

function NewsForm({ news, onClose, onSaved }: { news: Partial<News>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(news.title ?? "");
  const [body, setBody] = useState(news.body ?? "");
  const [aud, setAud] = useState<"toti" | "admini">(news.audience ?? "toti");
  const [published, setPublished] = useState(news.published ?? true);
  const [push, setPush] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const { error } = await supabase().rpc("owner_news_save", { p_id: news.id ?? null, p_title: title, p_body: body, p_audience: aud, p_published: published, p_push: push });
    setBusy(false);
    if (error) { setErr(humanError(error)); return; }
    await onSaved();
  }
  return (
    <Modal open onClose={onClose} title={news.id ? "Modifică noutatea" : "Noutate nouă"}
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" type="submit" form="news-form" loading={busy}>{published ? "Publică" : "Salvează ciorna"}</Button></>}>
      <form id="news-form" onSubmit={save} className="space-y-3">
        <Field label="Titlu"><Input required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ex. Km la mașină și seara" /></Field>
        <Field label="Ce e nou" hint="Scurt și pe înțeles. Poți scrie pe mai multe rânduri."><Textarea required rows={5} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
        <Field label="Cine o vede">
          <Select value={aud} onChange={(e) => setAud(e.target.value as "toti" | "admini")}>
            <option value="toti">Toți utilizatorii</option>
            <option value="admini">Doar administratorii firmelor</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} className="h-4 w-4 accent-orange-600" />Publicată (nebifat = ciornă, n-o vede nimeni)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={push} disabled={!published} onChange={(e) => setPush(e.target.checked)} className="h-4 w-4 accent-orange-600" />Trimite și notificare pe telefon</label>
        {err && <ErrorBox message={err} />}
      </form>
    </Modal>
  );
}

// ================= Cereri de ajutor =================
interface SupportReq { id: string; company_name: string | null; name: string | null; role: string | null; page: string | null; message: string; status: "nou" | "raspuns" | "rezolvat"; reply: string | null; replied_at: string | null; created_at: string }
const STATUS: Record<SupportReq["status"], { label: string; tone: "red" | "blue" | "green" }> = {
  nou: { label: "Nouă", tone: "red" }, raspuns: { label: "Răspuns trimis", tone: "blue" }, rezolvat: { label: "Rezolvată", tone: "green" },
};

export function SupportTab({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState("");
  const q = useQuery(async () => must(await supabase().rpc("owner_support_list", { p_status: status || null })) as SupportReq[], [status]);
  const [open, setOpen] = useState<SupportReq | null>(null);
  return (
    <div className="space-y-4">
      <Select className="w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
        <option value="">Toate cererile</option>
        <option value="nou">Noi</option>
        <option value="raspuns">Cu răspuns</option>
        <option value="rezolvat">Rezolvate</option>
      </Select>
      {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> :
        (q.data ?? []).length === 0 ? <Empty title="Nicio cerere de ajutor" /> : (
          <ul className="space-y-2">
            {q.data!.map((r) => (
              <li key={r.id}>
                <button onClick={() => setOpen(r)} className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-orange-300">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    <span className="font-semibold" data-no-i18n>{r.name ?? "—"}</span>
                    <span className="text-xs text-slate-500"><span data-no-i18n>{r.company_name ?? "fără firmă"}</span>{r.role ? ` · ${ROLE_LABEL[r.role as AppRole] ?? r.role}` : ""} · {when(r.created_at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-slate-700" data-no-i18n>{r.message}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      {open && <SupportReply req={open} onClose={() => setOpen(null)} onSaved={async () => { setOpen(null); await q.reload(); onChange?.(); }} />}
    </div>
  );
}

function SupportReply({ req, onClose, onSaved }: { req: SupportReq; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reply, setReply] = useState(req.reply ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save(resolve: boolean) {
    setBusy(true); setErr(null);
    const { error } = await supabase().rpc("owner_support_reply", { p_id: req.id, p_reply: reply === (req.reply ?? "") ? "" : reply, p_resolve: resolve });
    setBusy(false);
    if (error) { setErr(humanError(error)); return; }
    await onSaved();
  }
  return (
    <Modal open onClose={onClose} title="Cerere de ajutor"
      footer={<>
        <Button onClick={() => save(true)} loading={busy}><CheckCircle2 className="h-4 w-4" />{reply.trim() && reply !== (req.reply ?? "") ? "Trimite și închide" : "Marchează rezolvată"}</Button>
        <Button variant="primary" onClick={() => save(false)} loading={busy} disabled={!reply.trim() || reply === (req.reply ?? "")}><Send className="h-4 w-4" />Trimite răspunsul</Button>
      </>}>
      <div className="space-y-3 text-sm">
        <div className="text-slate-600"><strong data-no-i18n>{req.name}</strong> · <span data-no-i18n>{req.company_name ?? "fără firmă"}</span>{req.role ? ` · ${ROLE_LABEL[req.role as AppRole] ?? req.role}` : ""}</div>
        <div className="text-xs text-slate-500">{when(req.created_at)}{req.page ? <> · scris din pagina <code data-no-i18n>{req.page}</code></> : null}</div>
        <p className="whitespace-pre-line rounded-lg bg-slate-50 p-3" data-no-i18n>{req.message}</p>
        {req.replied_at && <div className="text-xs text-slate-500">Răspuns trimis: {when(req.replied_at)}</div>}
        <Field label="Răspunsul tău" hint="Ajunge ca notificare pe telefonul persoanei și îl vede în pagina „Ajutor”.">
          <Textarea rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
        </Field>
        {err && <ErrorBox message={err} />}
      </div>
    </Modal>
  );
}

// ================= Mod mentenanță =================
interface Status { maintenance: boolean; message: string | null; until: string | null }

export function MaintenanceCard() {
  const q = useQuery(async () => must(await supabase().rpc("app_status")) as Status, []);
  const [msg, setMsg] = useState("Aplicația se actualizează. Revine în câteva minute.");
  const [mins, setMins] = useState("15");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const on = q.data?.maintenance;
  async function set(v: boolean) {
    if (v && !confirm("Pornești modul mentenanță? Toți utilizatorii (în afară de proprietari) vor vedea doar mesajul de mentenanță.")) return;
    setBusy(true); setErr(null);
    const { error } = await supabase().rpc("owner_set_maintenance", { p_on: v, p_message: msg, p_minutes: Number(mins) || null });
    setBusy(false);
    if (error) setErr(humanError(error)); else { await q.reload(); window.dispatchEvent(new Event("dyas-status")); }
  }
  return (
    <Card title="Mod mentenanță">
      <div className="space-y-3 text-sm">
        {on ? (
          <Notice tone="amber">
            <span className="flex items-start gap-2"><Construction className="mt-0.5 h-4 w-4 shrink-0" />
              <span><strong>Mentenanța e pornită.</strong> Utilizatorii văd: „<span data-no-i18n>{q.data?.message}</span>”{q.data?.until ? <> · se oprește singură la {when(q.data.until)}</> : null}</span>
            </span>
          </Notice>
        ) : <p className="text-slate-600">Când pornești mentenanța, toți utilizatorii firmelor văd doar un ecran cu mesajul tău. Tu și ceilalți proprietari folosiți aplicația normal.</p>}
        {!on && (
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Mesajul afișat"><Input value={msg} maxLength={200} onChange={(e) => setMsg(e.target.value)} /></Field>
            <Field label="Se oprește singură după">
              <Select value={mins} onChange={(e) => setMins(e.target.value)}>
                <option value="10">10 minute</option><option value="15">15 minute</option><option value="30">30 de minute</option>
                <option value="60">1 oră</option><option value="120">2 ore</option><option value="">Doar manual</option>
              </Select>
            </Field>
          </div>
        )}
        {err && <ErrorBox message={err} />}
        {on
          ? <Button variant="primary" onClick={() => set(false)} loading={busy}>Oprește mentenanța</Button>
          : <Button variant="danger" onClick={() => set(true)} loading={busy}><Construction className="h-4 w-4" />Pornește mentenanța</Button>}
      </div>
    </Card>
  );
}
