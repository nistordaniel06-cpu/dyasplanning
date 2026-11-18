// Doar pe server: transformă coordonatele în adresă (OpenStreetMap / Nominatim).
/** Adresa aproximativă (stradă, număr, localitate) din coordonate, prin OpenStreetMap. */
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
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
