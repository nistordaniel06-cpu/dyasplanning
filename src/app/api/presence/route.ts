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

  const body = (await req.json().catch(() => ({}))) as { installed?: boolean };
  const h = req.headers;
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip");
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_presence`, {
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
    }),
  });
  return NextResponse.json({ ok: res.ok });
}
