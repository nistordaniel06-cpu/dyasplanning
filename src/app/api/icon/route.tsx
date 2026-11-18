import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

// Iconița aplicației firmei (casa albă pe culoarea firmei).
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const size = p.get("s") === "512" ? 512 : 192;
  const maskable = p.get("m") === "1";
  let color = "#ea580c";
  const slug = (p.get("app") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  if (slug) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/app_brand`, {
        method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_slug: slug }), next: { revalidate: 300 },
      });
      const b = r.ok ? await r.json() : null;
      if (b?.color) color = b.color;
    } catch { /* culoarea implicită */ }
  }
  const pad = maskable ? size * 0.2 : size * 0.12;
  const house = size - pad * 2;
  return new ImageResponse(
    (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: color, borderRadius: maskable ? 0 : size * 0.22 }}>
        <svg width={house} height={house} viewBox="0 0 64 64"><path d="M14 46V22l18-10 18 10v24H38V32H26v14z" fill="#fff" /></svg>
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
