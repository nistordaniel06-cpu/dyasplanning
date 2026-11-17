"use client";
import { useEffect, useState } from "react";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { TIMEZONES } from "@/lib/time";
import { Button, ErrorBox, Field, Input, Loading, Select, Tabs } from "@/components/ui";

export default function Onboarding() {
  const [checking, setChecking] = useState(true);
  const [mode, setMode] = useState<"invite" | "create">("invite");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [tz, setTz] = useState("Europe/Bucharest");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const { data: u } = await sb.auth.getUser();
      if (!u.user) { window.location.href = "/login"; return; }
      const { data: m } = await sb.from("memberships").select("user_id").eq("user_id", u.user.id).maybeSingle();
      if (m) { window.location.href = "/"; return; }
      setChecking(false);
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const sb = supabase();
      const res = mode === "create"
        ? await sb.rpc("create_company", { p_name: company, p_timezone: tz, p_admin_name: name })
        : await sb.rpc("accept_invite", { p_code: code });
      if (res.error) throw res.error;
      window.location.href = "/";
    } catch (err) {
      setError(humanError(err));
      setBusy(false);
    }
  }

  if (checking) return <Loading />;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <LanguageSwitch className="fixed right-3 top-3 z-50" />
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-bold">Bun venit în DYASPlanning</h1>
        <p className="mt-1 text-sm text-slate-600">Contul tău nu este încă legat de o firmă.</p>
        <div className="mt-4">
          <Tabs value={mode} onChange={(v) => { setMode(v); setError(null); }}
            items={[{ value: "invite", label: "Am cod de invitație" }, { value: "create", label: "Înființez firma" }]} />
        </div>
        <form onSubmit={submit} className="mt-5 space-y-4">
          {mode === "invite" ? (
            <Field label="Cod de invitație" hint="Codul de 8 caractere primit de la administrator.">
              <Input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ex. 3FA9C21B" className="font-mono tracking-widest uppercase" maxLength={12} />
            </Field>
          ) : (
            <>
              <Field label="Numele firmei"><Input required value={company} onChange={(e) => setCompany(e.target.value)} placeholder="ex. Construct Grup SRL" /></Field>
              <Field label="Numele tău" hint="Vei fi administratorul firmei."><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Fus orar al firmei" hint="Programul se afișează în acest fus orar.">
                <Select value={tz} onChange={(e) => setTz(e.target.value)}>{TIMEZONES.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}</Select>
              </Field>
            </>
          )}
          {error && <ErrorBox message={error} />}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            {mode === "invite" ? "Alătură-te firmei" : "Creează firma"}
          </Button>
          <button type="button" className="w-full text-sm text-slate-600 underline" onClick={async () => { await supabase().auth.signOut(); window.location.href = "/login"; }}>
            Ieși din cont
          </button>
        </form>
      </div>
    </main>
  );
}
