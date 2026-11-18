import { NextResponse } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { reverseGeocode } from "@/lib/geocode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Adresa pentru un punct GPS (folosită la pontajul cu buton). Doar pentru utilizatori autentificați. */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !SUPABASE_URL) return NextResponse.json({ address: null }, { status: 401 });
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` } });
  if (!u.ok) return NextResponse.json({ address: null }, { status: 401 });
  const { lat, lon } = (await req.json().catch(() => ({}))) as { lat?: number; lon?: number };
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NextResponse.json({ address: null }, { status: 400 });
  return NextResponse.json({ address: await reverseGeocode(lat!, lon!) });
}
