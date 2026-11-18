"use client";
import { useState } from "react";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { Button, ErrorBox, Field, Input, Notice } from "@/components/ui";

/** Pagină ascunsă (nelegată de nicăieri): crearea contului de administrator, apoi înființarea firmei. */
export default function HiddenSignup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    try {
      const open = await supabase().rpc("signup_enabled");
      if (open.data === false) { setError("Înscrierea firmelor noi este închisă momentan."); return; }
      const { data, error } = await supabase().auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/onboarding` } });
      if (error) throw error;
      if (data.session) window.location.href = "/onboarding";
      else setInfo("Cont creat. Deschide linkul de confirmare primit pe email, apoi autentifică-te pe pagina principală.");
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <LanguageSwitch className="fixed right-3 top-3 z-50" />
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-lg font-semibold">Cont nou de administrator</h1>
        <p className="text-sm text-slate-600">După creare înființezi firma. Angajații nu au nevoie de pagina aceasta: primesc acces cu telefonul și un cod.</p>
        <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Parolă" hint="Minim 8 caractere."><Input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <ErrorBox message={error} />}
        {info && <Notice tone="green">{info}</Notice>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Creează cont</Button>
      </form>
    </main>
  );
}
