"use client";
import { useEffect, useState } from "react";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { setScreenSecure } from "@/lib/native";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { looksLikeEmail, phoneLoginEmail } from "@/lib/phone";
import { Button, ErrorBox, Field, Input } from "@/components/ui";
import { PhoneInput } from "@/components/PhoneInput";
import { BrandLogo, BrandName } from "@/components/Brand";
import { useAppStatus } from "@/components/AppExtras";
import { COUNTRIES, countryForTimezone, fullDigits, type Country } from "@/lib/countries";

/** Pagina principală: doar autentificare. Angajații intră cu telefonul și codul primit de la administrator. */
export default function LoginPage() {
  const [login, setLogin] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // „Email” = administratori și proprietari (tastatură cu litere); „Telefon” = angajați (tastatură cu cifre)
  const [mode, setMode] = useState<"telefon" | "email">("telefon");
  const status = useAppStatus();
  const isEmail = mode === "email" || looksLikeEmail(login);
  const [country, setCountry] = useState<Country>(COUNTRIES[0]);
  useEffect(() => {
    void setScreenSecure(true);
    // țara: ultima folosită pe acest telefon, altfel după fusul orar al telefonului
    let saved: string | null = null;
    try { saved = localStorage.getItem("dyas.login.country"); } catch { /* ignoră */ }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setCountry(COUNTRIES.find((c) => c.code === saved) ?? countryForTimezone(tz));
    try { if (localStorage.getItem("dyas.login.mode") === "email") setMode("email"); } catch { /* ignoră */ }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const email = isEmail ? login.trim() : phoneLoginEmail("+" + fullDigits(country.dial, login));
      const { error } = await supabase().auth.signInWithPassword({ email, password: secret.trim() });
      if (error) {
        if (error.message.includes("Invalid login credentials")) {
          throw new Error(isEmail ? "Email sau parolă greșită." : "Număr de telefon sau cod greșit. Verifică mesajul primit de la administrator.");
        }
        throw error;
      }
      if (!isEmail) { try { localStorage.setItem("dyas.login.country", country.code); } catch { /* ignoră */ } }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch (err) {
      setError(humanError(err));
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <LanguageSwitch className="fixed right-3 top-3 z-50" />
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <BrandLogo className="h-12 w-12" />
          <div>
            <div className="text-2xl font-bold"><BrandName /></div>
            <div className="text-sm text-slate-600">Planning și pontaj pentru șantier</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-lg font-semibold">Autentificare</h1>
          {status?.maintenance && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <strong>Aplicația se actualizează.</strong> <span data-no-i18n>{status.message ?? ""}</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold" role="tablist">
            {([["telefon", "Cu telefon"], ["email", "Cu email"]] as const).map(([m, l]) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m}
                onClick={() => { setMode(m); setLogin(""); setSecret(""); setError(null); try { localStorage.setItem("dyas.login.mode", m); } catch { /* ignoră */ } }}
                className={mode === m ? "rounded-lg bg-white py-2 text-slate-900 shadow-sm" : "rounded-lg py-2 text-slate-600"}>{l}</button>
            ))}
          </div>
          {mode === "email" ? (
            <Field label="Email" hint="Pentru administratori.">
              <Input type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required
                value={login} onChange={(e) => setLogin(e.target.value)} placeholder="nume@firma.ro" />
            </Field>
          ) : (
            <Field label="Număr de telefon" hint={isEmail ? "Autentificare cu email (administrator)." : "Alege țara și scrie numărul tău de WhatsApp."}>
              <PhoneInput label="Număr de telefon" autoComplete="username" required showCountry={!isEmail} inputMode={isEmail ? "email" : "tel"}
                country={country} local={login} onCountry={setCountry} onLocal={setLogin} />
            </Field>
          )}
          <Field label={isEmail ? "Parolă" : "Cod de acces"} hint={isEmail ? undefined : "Codul de 6 cifre primit de la administrator."}>
            <Input type="password" autoComplete="current-password" inputMode={isEmail ? "text" : "numeric"} required value={secret} onChange={(e) => setSecret(e.target.value)}
              className={isEmail ? "" : "tracking-[0.4em]"} />
          </Field>
          {error && <ErrorBox message={error} />}
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Intră în aplicație</Button>
          {!isEmail && <p className="text-center text-xs text-slate-500">Nu ai cod? Cere-l administratorului firmei.</p>}
        </form>
      </div>
    </main>
  );
}
