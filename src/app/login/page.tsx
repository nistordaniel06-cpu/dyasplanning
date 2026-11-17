"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { Button, ErrorBox, Field, Input, Notice, Tabs } from "@/components/ui";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setInfo(null);
    const sb = supabase();
    try {
      if (mode === "login") {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        const next = new URLSearchParams(window.location.search).get("next");
        window.location.href = next && next.startsWith("/") ? next : "/";
      } else {
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/` } });
        if (error) throw error;
        if (data.session) window.location.href = "/onboarding";
        else setInfo("Cont creat. Ți-am trimis un email de confirmare — deschide linkul, apoi autentifică-te aici.");
      }
    } catch (err) {
      setError(humanError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-11 w-11" />
          <div>
            <div className="text-xl font-bold">DYASPlanning</div>
            <div className="text-sm text-slate-600">Planning și pontaj pentru șantier</div>
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Tabs value={mode} onChange={(v) => { setMode(v); setError(null); setInfo(null); }}
            items={[{ value: "login", label: "Autentificare" }, { value: "signup", label: "Cont nou" }]} />
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Parolă" hint={mode === "signup" ? "Minim 6 caractere." : undefined}>
              <Input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {error && <ErrorBox message={error} />}
            {info && <Notice tone="green">{info}</Notice>}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
              {mode === "login" ? "Intră în cont" : "Creează cont"}
            </Button>
          </form>
          {mode === "signup" && (
            <p className="mt-4 text-xs text-slate-600">
              După creare poți înființa firma (devii administrator) sau te poți alătura unei firme cu un cod de invitație primit de la administrator.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
