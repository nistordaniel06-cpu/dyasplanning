// Limba interfeței (ro / en). Fără dependențe, ca să poată fi folosită oriunde (inclusiv în time.ts).
export type Lang = "ro" | "en";
const KEY = "dyas.lang";
let current: Lang | null = null;

/** Limba aleasă; implicit după limba telefonului (română → ro, altfel en). */
export function getLang(): Lang {
  if (current) return current;
  if (typeof window === "undefined") return "ro";
  try {
    const s = localStorage.getItem(KEY);
    if (s === "ro" || s === "en") return (current = s);
  } catch { /* ignoră */ }
  const nav = (navigator.language || "ro").toLowerCase();
  return (current = nav.startsWith("ro") || nav.startsWith("mo") ? "ro" : "en");
}

/** Schimbă limba și reîncarcă pagina (toată interfața, datele și notificările trec pe noua limbă). */
export async function setLang(l: Lang): Promise<void> {
  try { localStorage.setItem(KEY, l); } catch { /* ignoră */ }
  current = l;
  // service worker-ul citește limba de aici, ca notificările pe telefon să fie traduse
  try { const c = await caches.open("dyas-settings"); await c.put("/__lang", new Response(l)); } catch { /* ignoră */ }
  window.location.reload();
}

/** Eticheta pentru formatarea numerelor și datelor cu Intl. */
export function localeTag(): string {
  return getLang() === "en" ? "en-GB" : "ro-RO";
}
