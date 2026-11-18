import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

// Manifestul aplicației instalate pe telefon, cu numele și culoarea firmei.
export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get("app") ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  let b: { name: string; color: string | null; slug: string } | null = null;
  if (slug) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/app_brand`, {
        method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_slug: slug }), next: { revalidate: 300 },
      });
      if (r.ok) b = await r.json();
    } catch { /* manifestul implicit */ }
  }
  const color = b?.color ?? "#ea580c";
  const icon = (s: number, purpose: string) => ({ src: b ? `/api/icon?app=${b.slug}&s=${s}${purpose === "maskable" ? "&m=1" : ""}` : purpose === "maskable" ? "/icon-maskable-512.png" : `/icon-${s}.png`, sizes: `${s}x${s}`, type: "image/png", purpose });
  return NextResponse.json({
    name: b?.name ?? "DYASPlanning",
    short_name: b?.name ?? "DYASPlanning",
    description: "Planning și pontaj pentru șantier",
    id: b ? `/app/${b.slug}` : "/",
    start_url: b ? `/app/${b.slug}` : "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: color,
    lang: "ro",
    icons: [icon(192, "any"), icon(512, "any"), icon(512, "maskable")],
  }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=300" } });
}
