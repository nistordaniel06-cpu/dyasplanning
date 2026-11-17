"use client";
import { useEffect, useState } from "react";
import { Bell, Download, Share, X } from "lucide-react";
import { disablePush, enablePush, isIOS, isStandalone, pushState, registerSW, type PushState } from "@/lib/push";
import { humanError } from "@/lib/errors";
import { Button, ErrorBox } from "./ui";
import { isNativeApp } from "@/lib/native";

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferredInstall: InstallEvent | null = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e as InstallEvent; window.dispatchEvent(new Event("dyas-install-ready")); });
}

/** Înregistrează service worker-ul (necesar pentru instalare și notificări). */
export function useServiceWorker() {
  useEffect(() => { void registerSW(); }, []);
}

/** Card: instalează aplicația + activează notificările. `compact` = banner care se poate închide. */
export function AppSetupCard({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<PushState | null>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    void pushState().then(setState);
    setInstalled(isStandalone());
    setCanInstall(!!deferredInstall);
    const on = () => setCanInstall(true);
    window.addEventListener("dyas-install-ready", on);
    try { if (compact && localStorage.getItem("dyas.setup.hidden") === "1") setHidden(true); } catch { /* fără stocare */ }
    return () => window.removeEventListener("dyas-install-ready", on);
  }, [compact]);

  if (state === null || hidden) return null;
  if (isNativeApp()) return null; // în aplicația Android nu e nevoie de instalare din browser
  const needPush = state === "off" || state === "ios-needs-install";
  if (compact && !needPush && installed) return null;

  async function turnOn() {
    setBusy(true); setError(null);
    try { await enablePush(); setState("on"); } catch (e) { setError(humanError(e)); } finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true); setError(null);
    try { await disablePush(); setState("off"); } catch (e) { setError(humanError(e)); } finally { setBusy(false); }
  }
  async function install() {
    if (!deferredInstall) return;
    await deferredInstall.prompt();
    const r = await deferredInstall.userChoice;
    if (r.outcome === "accepted") { setInstalled(true); deferredInstall = null; setCanInstall(false); }
  }

  return (
    <section className="relative mb-4 rounded-2xl border border-orange-200 bg-orange-50 p-4">
      {compact && <button className="absolute right-2 top-2 rounded p-1.5 text-slate-500" aria-label="Închide"
        onClick={() => { setHidden(true); try { localStorage.setItem("dyas.setup.hidden", "1"); } catch { /* ignoră */ } }}><X className="h-4 w-4" /></button>}
      <h2 className="font-semibold">Aplicația pe telefon</h2>
      <div className="mt-3 space-y-3 text-sm">
        {!installed && (
          canInstall ? (
            <Button variant="primary" className="w-full" onClick={install}><Download className="h-4 w-4" />Instalează aplicația</Button>
          ) : isIOS() ? (
            <p className="flex items-start gap-2 text-slate-700"><Share className="mt-0.5 h-4 w-4 shrink-0" /><span>Pe iPhone: apasă <strong>Partajare</strong> în Safari, apoi <strong>„Adaugă pe ecranul principal”</strong>. Notificările merg pe iPhone doar din aplicația instalată.</span></p>
          ) : (
            <p className="flex items-start gap-2 text-slate-700"><Download className="mt-0.5 h-4 w-4 shrink-0" /><span>Din meniul browserului (⋮) alege <strong>„Instalează aplicația”</strong> sau <strong>„Adaugă pe ecranul de pornire”</strong>.</span></p>
          )
        )}
        {state === "off" && <Button variant={installed ? "primary" : "secondary"} className="w-full" onClick={turnOn} loading={busy}><Bell className="h-4 w-4" />Activează notificările</Button>}
        {state === "on" && !compact && (
          <div className="flex items-center justify-between gap-2"><span className="text-green-800">✓ Notificările sunt active pe acest telefon.</span><Button size="sm" onClick={turnOff} loading={busy}>Oprește</Button></div>
        )}
        {state === "denied" && !compact && <p className="text-slate-700">Notificările sunt blocate pentru acest site. Le poți permite din setările browserului sau ale telefonului.</p>}
        {state === "unsupported" && !compact && <p className="text-slate-700">Acest browser nu suportă notificări. Folosește Chrome pe Android sau aplicația instalată pe iPhone.</p>}
        {error && <ErrorBox message={error} />}
      </div>
    </section>
  );
}
