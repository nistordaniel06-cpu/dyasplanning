"use client";
import { useEffect, useState } from "react";
import { BellRing, MapPin } from "lucide-react";
import { enablePush, isIOS, pushState } from "@/lib/push";
import { supabase } from "@/lib/supabase/client";
import { isNativeApp } from "@/lib/native";
import { Button } from "./ui";

const KEY = "dyas.loc";
const PUSH_KEY = "dyas.push";
const later = (k: string, ms: number) => {
  let v: string | null = null;
  try { v = localStorage.getItem(k); } catch { /* ignoră */ }
  return !!v && v.startsWith("no:") && Date.now() - Number(v.slice(3)) < ms;
};
const remember = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignoră */ } };

async function sendPresence(gps?: { lat: number; lon: number; accuracy?: number }) {
  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;
  const installed = window.matchMedia?.("(display-mode: standalone)").matches || isNativeApp();
  await fetch("/api/presence", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ installed, gps }),
  });
}

function locate(): Promise<{ lat: number; lon: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

async function permission(): Promise<"granted" | "denied" | "prompt"> {
  try {
    const p = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return p.state as "granted" | "denied" | "prompt";
  } catch { return "prompt"; }
}

/**
 * La deschiderea aplicației: înregistrează conectarea, apoi (cu permisiunea utilizatorului) locația exactă.
 * Locația se ia o singură dată, la deschidere — nu se urmărește în fundal.
 */
export function PresenceAndLocation() {
  const [ask, setAsk] = useState<null | "push" | "push-ios" | "loc">(null);
  const [pushErr, setPushErr] = useState<string | null>(null);

  async function askLocation() {
    const st = await permission();
    let choice: string | null = null;
    try { choice = localStorage.getItem(KEY); } catch { /* ignoră */ }
    if (st === "denied") return;
    if (st === "granted" || choice === "yes") {
      const gps = await locate();
      if (gps) await sendPresence(gps).catch(() => undefined);
      return;
    }
    if (!later(KEY, 7 * 24 * 3600 * 1000)) setAsk("loc");
  }

  useEffect(() => {
    void (async () => {
      try { await sendPresence(); } catch { /* nu blochează aplicația */ }
      // notificările: întâi ele, fiindcă fără ele omul nu află de mesaje și de schimbări de program
      const ps = await pushState().catch(() => "unsupported" as const);
      if (ps === "off" && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { await enablePush(); } catch { /* reîncercăm la următoarea deschidere */ } // telefonul a permis deja: îl reînscriem singuri
      } else if (ps === "off" && !later(PUSH_KEY, 24 * 3600 * 1000)) {
        setAsk("push"); return;
      } else if (ps === "ios-needs-install" && isIOS() && !later(PUSH_KEY, 3 * 24 * 3600 * 1000)) {
        setAsk("push-ios"); return;
      }
      await askLocation();
    })();
  }, []);

  if (!ask) return null;
  const box = (icon: React.ReactNode, title: string, text: React.ReactNode, buttons: React.ReactNode) => (
    <div className="fixed inset-x-0 bottom-20 z-50 px-3 md:bottom-6 md:left-auto md:right-6 md:max-w-sm" role="dialog" aria-labelledby="prompt-title">
      <div className="rounded-xl border border-orange-200 bg-white p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-orange-100 p-2 text-orange-700">{icon}</span>
          <div className="min-w-0">
            <h2 id="prompt-title" className="font-semibold">{title}</h2>
            <div className="mt-1 text-sm text-slate-600">{text}</div>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">{buttons}</div>
      </div>
    </div>
  );

  if (ask === "push") return box(<BellRing className="h-5 w-5" />, "Pornește notificările",
    <>
      <p>Ca să afli imediat când primești un mesaj în chat sau când ți se schimbă programul.</p>
      {pushErr && <p className="mt-1 font-medium text-red-700">{pushErr}</p>}
    </>,
    <>
      <Button size="sm" variant="ghost" onClick={() => { remember(PUSH_KEY, `no:${Date.now()}`); setAsk(null); void askLocation(); }}>Mai târziu</Button>
      <Button size="sm" variant="primary" onClick={async () => {
        setPushErr(null);
        try { await enablePush(); setAsk(null); void askLocation(); }
        catch (e) { setPushErr(e instanceof Error ? e.message : String(e)); }
      }}>Activează</Button>
    </>);

  if (ask === "push-ios") return box(<BellRing className="h-5 w-5" />, "Notificări pe iPhone",
    <p>Pe iPhone, notificările merg doar din aplicația instalată: în Safari apasă <strong>Partajare</strong> → <strong>„Adaugă pe ecranul principal”</strong>, apoi deschide DYASPlanning de pe ecran și apasă „Activează”.</p>,
    <Button size="sm" variant="primary" onClick={() => { remember(PUSH_KEY, `no:${Date.now()}`); setAsk(null); void askLocation(); }}>Am înțeles</Button>);

  return box(<MapPin className="h-5 w-5" />, "Locația la deschiderea aplicației",
    <p>DYASPlanning salvează locația telefonului doar în momentul în care deschizi aplicația (nu în fundal), pentru evidența prezenței. Telefonul îți va cere permisiunea.</p>,
    <>
      <Button size="sm" variant="ghost" onClick={() => { remember(KEY, `no:${Date.now()}`); setAsk(null); }}>Nu acum</Button>
      <Button size="sm" variant="primary" onClick={async () => {
        remember(KEY, "yes");
        setAsk(null);
        const gps = await locate();
        if (gps) await sendPresence(gps).catch(() => undefined);
      }}>Permite locația</Button>
    </>);
}
