"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { looksLikeEmail, phoneLoginEmail } from "@/lib/phone";
import { Button, ErrorBox, Field, Input } from "@/components/ui";

/** Pagina principală: doar autentificare. Angajații intră cu telefonul și codul primit de la administrator. */
export default function LoginPage() {
  const [login, setLogin] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEmail = looksLikeEmail(login);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const email = isEmail ? login.trim() : phoneLoginEmail(login);
      const { error } = await supabase().auth.signInWithPassword({ email, password: secret.trim() });
      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          throw new Error(isEmail ? "Email sau parolă greșită." : "Număr de telefon sau cod greșit. Verifică mesajul primit de la administrator.");
        }
        throw error;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch (err) {
      setError(humanError(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-12 w-12" />
          <div>
            <div className="text-2xl font-bold">DYASPlanning</div>
            <div className="text-sm text-slate-600">Planning și pontaj pentru șantier</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-lg font-semibold">Autentificare</h1>
          <Field label="Număr de telefon" hint={isEmail ? "Autentificare cu email (administrator)." : "Numărul tău de WhatsApp, ex. 0722 123 456."}>
            <Input autoComplete="username" inputMode={isEmail ? "email" : "tel"} required value={login} onChange={(e) => setLogin(e.target.value)} placeholder="07xx xxx xxx" />
          </Field>
          <Field label={isEmail ? "Parolă" : "Cod de acces"} hint={isEmail ? undefined : "Codul de 6 cifre primit de la administrator."}>
            <Input type="password" autoComplete="current-password" inputMode={isEmail ? "text" : "numeric"} required value={secret} onChange={(e) => setSecret(e.target.value)}
              className={isEmail ? "" : "tracking-[0.4em]"} />
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Intră în aplicație</Button>
          <p className="text-center text-xs text-slate-500">Nu ai cod? Cere-l administratorului firmei.</p>
        </form>
      </div>
    </main>
  );
}
