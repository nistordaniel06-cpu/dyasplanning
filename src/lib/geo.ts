"use client";
import { supabase } from "./supabase/client";

export interface GeoPoint { lat: number; lon: number; accuracy: number }

/** Poziția telefonului o singură dată (null dacă nu e permisă sau nu se găsește la timp). */
export function locateOnce(timeoutMs = 10000): Promise<GeoPoint | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) return resolve(null);
    const t = setTimeout(() => resolve(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); resolve({ lat: p.coords.latitude, lon: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }); },
      () => { clearTimeout(t); resolve(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 2 * 60 * 1000 },
    );
  });
}

/** Adresa (stradă, număr, oraș) pentru un punct; null fără internet. */
export async function addressFor(p: GeoPoint | null): Promise<string | null> {
  if (!p || (typeof navigator !== "undefined" && !navigator.onLine)) return null;
  try {
    const { data } = await supabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return null;
    const r = await fetch("/api/geocode", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ lat: p.lat, lon: p.lon }) });
    return r.ok ? ((await r.json()) as { address: string | null }).address : null;
  } catch { return null; }
}
