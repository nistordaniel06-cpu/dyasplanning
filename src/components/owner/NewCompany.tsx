"use client";
import { useState } from "react";
import { Copy, Eye, EyeOff, Plus, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { TIMEZONES } from "@/lib/time";
import { Button, ErrorBox, Field, Input, Modal, Notice, Select } from "../ui";

const newPassword = () => {
  const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const r = crypto.getRandomValues(new Uint32Array(10));
  return Array.from(r, (x) => a[x % a.length]).join("");
};

/** Proprietarul creează o firmă cu emailul și parola administratorului (contul e gata de folosit). */
export function NewCompanyButton({ onCreated }: { onCreated: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [admin, setAdmin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(newPassword);
  const [show, setShow] = useState(true);
  const [tz, setTz] = useState("Europe/Bucharest");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() { setName(""); setAdmin(""); setEmail(""); setPassword(newPassword()); setErr(null); setDone(null); setCopied(false); }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const { data, error } = await supabase().rpc("owner_create_company", {
      p_company_name: name, p_admin_name: admin, p_email: email, p_password: password, p_timezone: tz,
    });
    setBusy(false);
    if (error) { setErr(humanError(error)); return; }
    const site = window.location.origin;
    setDone({ id: data as string, text: `Contul firmei ${name.trim()} în aplicație:\n\n1. Deschide: ${site}/login\n2. Email: ${email.trim().toLowerCase()}\n3. Parolă: ${password}\n\nDupă prima intrare, schimbă parola din Profil.` });
  }

  return (
    <>
      <Button variant="primary" onClick={() => { reset(); setOpen(true); }}><Plus className="h-4 w-4" />Firmă nouă</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Firmă nouă"
        footer={done
          ? <Button variant="primary" onClick={async () => { setOpen(false); await onCreated(done.id); }}>Gata</Button>
          : <><Button onClick={() => setOpen(false)}>Renunță</Button><Button variant="primary" type="submit" form="firma-noua" loading={busy}>Creează firma</Button></>}>
        {done ? (
          <div className="space-y-3">
            <Notice tone="green">Firma a fost creată. Administratorul poate intra imediat cu emailul și parola de mai jos.</Notice>
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm" data-no-i18n>{done.text}</pre>
            <div className="flex flex-wrap gap-2">
              <Button onClick={async () => { await navigator.clipboard.writeText(done.text); setCopied(true); }}><Copy className="h-4 w-4" />{copied ? "Copiat" : "Copiază datele"}</Button>
              <a className="inline-flex h-10 items-center rounded-lg border border-green-300 bg-white px-4 text-sm font-semibold text-green-800 hover:bg-green-50"
                href={`https://wa.me/?text=${encodeURIComponent(done.text)}`} target="_blank" rel="noreferrer">Trimite pe WhatsApp</a>
            </div>
          </div>
        ) : (
          <form id="firma-noua" onSubmit={create} className="space-y-3">
            <Field label="Numele firmei"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Construct Pop SRL" /></Field>
            <Field label="Numele administratorului"><Input required value={admin} onChange={(e) => setAdmin(e.target.value)} placeholder="ex. Ion Pop" /></Field>
            <Field label="Email administrator" hint="Cu acest email intră în aplicație."><Input required type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Parolă" hint="Minim 8 caractere. O poate schimba după prima intrare.">
              <div className="flex gap-2">
                <Input required minLength={8} type={show ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} data-no-i18n />
                <Button type="button" aria-label={show ? "Ascunde parola" : "Arată parola"} onClick={() => setShow(!show)}>{show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button>
                <Button type="button" aria-label="Parolă nouă" onClick={() => setPassword(newPassword())}><RefreshCw className="h-4 w-4" /></Button>
              </div>
            </Field>
            <Field label="Fus orar">
              <Select value={tz} onChange={(e) => setTz(e.target.value)}>{TIMEZONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
            </Field>
            {err && <ErrorBox message={err} />}
          </form>
        )}
      </Modal>
    </>
  );
}
