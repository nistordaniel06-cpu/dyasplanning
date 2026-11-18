"use client";
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { isNativeApp } from "@/lib/native";
import { Button } from "./ui";

const KEY = "dyas.loc";

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
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    void (async () => {
      try { await sendPresence(); } catch { /* nu blochează aplicația */ }
      const st = await permission();
      let choice: string | null = null;
      try { choice = localStorage.getItem(KEY); } catch { /* ignoră */ }
      if (st === "denied") return;
      if (st === "granted" || choice === "yes") {
        const gps = await locate();
        if (gps) await sendPresence(gps).catch(() => undefined);
        return;
      }
      const later = choice?.startsWith("no:") ? Number(choice.slice(3)) : 0;
      if (Date.now() - later > 7 * 24 * 3600 * 1000) setAsk(true);
    })();
  }, []);

  if (!ask) return null;
  return (
    <div className="fixed inset-x-0 bottom-20 z-50 px-3 md:bottom-6 md:left-auto md:right-6 md:max-w-sm" role="dialog" aria-labelledby="loc-title">
      <div className="rounded-xl border border-orange-200 bg-white p-4 shadow-xl">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-orange-100 p-2 text-orange-700"><MapPin className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h2 id="loc-title" className="font-semibold">Locația la deschiderea aplicației</h2>
            <p className="mt-1 text-sm text-slate-600">DYASPlanning salvează locația telefonului doar în momentul în care deschizi aplicația (nu în fundal), pentru evidența prezenței. Telefonul îți va cere permisiunea.</p>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => { try { localStorage.setItem(KEY, `no:${Date.now()}`); } catch { /* ignoră */ } setAsk(false); }}>Nu acum</Button>
          <Button size="sm" variant="primary" onClick={async () => {
            try { localStorage.setItem(KEY, "yes"); } catch { /* ignoră */ }
            setAsk(false);
            const gps = await locate();
            if (gps) await sendPresence(gps).catch(() => undefined);
          }}>Permite locația</Button>
        </div>
      </div>
    </div>
  );
}
