import { NextResponse } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { deviceLabel } from "@/lib/device";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dec = (v: string | null) => { if (!v) return null; try { return decodeURIComponent(v); } catch { return v; } };
const num = (v: string | null) => { const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };

/**
 * Înregistrează conectarea utilizatorului (oraș/țară din rețeaua Vercel, dispozitiv), pentru panoul proprietarului.
 * Utilizatorul e verificat cu token-ul lui; scrierea se face cu secretul intern.
 */
export async function POST(req: Request) {
  const secret = process.env.PUSH_SECRET;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !token || !SUPABASE_URL) return NextResponse.json({ ok: false }, { status: 400 });

  const ures = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  if (!ures.ok) return NextResponse.json({ ok: false }, { status: 401 });
  const user = (await ures.json()) as { id?: string };
  if (!user.id) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { installed?: boolean; gps?: { lat: number; lon: number; accuracy?: number } };
  const gps = body.gps && Number.isFinite(body.gps.lat) && Number.isFinite(body.gps.lon)
    && Math.abs(body.gps.lat) <= 90 && Math.abs(body.gps.lon) <= 180 ? body.gps : null;
  const address = gps ? await reverseGeocode(gps.lat, gps.lon) : null;
  const h = req.headers;
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_presence_v2`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_secret: secret,
      p_user: user.id,
      p_ip: ip,
      p_city: dec(h.get("x-vercel-ip-city")),
      p_region: dec(h.get("x-vercel-ip-country-region")),
      p_country: h.get("x-vercel-ip-country"),
      p_lat: num(h.get("x-vercel-ip-latitude")),
      p_lon: num(h.get("x-vercel-ip-longitude")),
      p_device: deviceLabel(h.get("user-agent") ?? ""),
      p_installed: !!body.installed,
      p_gps_lat: gps ? gps.lat : null,
      p_gps_lon: gps ? gps.lon : null,
      p_gps_accuracy: gps && Number.isFinite(gps.accuracy) ? Math.round(gps.accuracy!) : null,
      p_address: address,
    }),
  });
  return NextResponse.json({ ok: res.ok });
}

/** Adresa aproximativă (stradă, număr, localitate) din coordonate, prin OpenStreetMap. */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=ro&lat=${lat}&lon=${lon}`, {
      headers: { "User-Agent": "DYASPlanning/1.0 (https://dyasplanning.vercel.app)" }, signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = (await r.json()) as { display_name?: string; address?: Record<string, string> };
    const a = j.address ?? {};
    const street = [a.road ?? a.pedestrian ?? a.footway, a.house_number].filter(Boolean).join(" ");
    const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb;
    const parts = [street, city, a.country].filter(Boolean);
    return parts.length ? parts.join(", ") : j.display_name ?? null;
  } catch {
    return null;
  }
}
