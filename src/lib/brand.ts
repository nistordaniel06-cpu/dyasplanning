"use client";
// Aplicația fiecărei firme: nume, link și culoare proprie. Fără setări = DYASPlanning (portocaliu).
import { useSyncExternalStore } from "react";

export interface Brand { name: string; color: string | null; slug: string | null }
export const DEFAULT_BRAND: Brand = { name: "DYASPlanning", color: null, slug: null };
export const DEFAULT_COLOR = "#ea580c";
const KEY = "dyas.brand";
const EVT = "dyas-brand";

/** Nuanțele culorii principale (înlocuiesc portocaliul folosit în toată aplicația). */
export function brandCss(color: string): string {
  const mix = (p: number, w: string) => `color-mix(in oklab, ${color} ${p}%, ${w})`;
  const shades: Record<string, string> = {
    50: mix(7, "white"), 100: mix(15, "white"), 200: mix(30, "white"), 300: mix(50, "white"), 400: mix(75, "white"),
    500: mix(90, "white"), 600: color, 700: mix(85, "black"), 800: mix(70, "black"), 900: mix(55, "black"), 950: mix(35, "black"),
  };
  return `:root{${Object.entries(shades).map(([k, v]) => `--color-orange-${k}:${v};`).join("")}}`;
}

/** Același cod, ca text, rulat în <head> înainte de afișare (fără „flash” portocaliu). */
export const BRAND_BOOT_SCRIPT = `(function(){var b=null;try{b=JSON.parse(localStorage.getItem("${KEY}")||"null")}catch(e){}var mf=document.createElement("link");mf.rel="manifest";mf.id="app-manifest";mf.href=b&&b.slug?"/api/manifest?app="+encodeURIComponent(b.slug):"/manifest.webmanifest";document.head.appendChild(mf);try{if(!b||!b.color)return;var c=b.color,m=function(p,w){return"color-mix(in oklab, "+c+" "+p+"%, "+w+")"};var s={50:m(7,"white"),100:m(15,"white"),200:m(30,"white"),300:m(50,"white"),400:m(75,"white"),500:m(90,"white"),600:c,700:m(85,"black"),800:m(70,"black"),900:m(55,"black"),950:m(35,"black")};var t=":root{";for(var k in s)t+="--color-orange-"+k+":"+s[k]+";";var el=document.createElement("style");el.id="brand-css";el.textContent=t+"}";document.head.appendChild(el);}catch(e){}})();`;

let current: Brand | null = null;
function read(): Brand {
  if (current) return current;
  try { const b = JSON.parse(localStorage.getItem(KEY) ?? "null") as Brand | null; current = b?.name ? b : DEFAULT_BRAND; }
  catch { current = DEFAULT_BRAND; }
  return current;
}

function apply(b: Brand) {
  if (typeof document === "undefined") return;
  let el = document.getElementById("brand-css") as HTMLStyleElement | null;
  if (b.color) {
    if (!el) { el = document.createElement("style"); el.id = "brand-css"; document.head.appendChild(el); }
    el.textContent = brandCss(b.color);
  } else el?.remove();
  document.title = b.name;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", b.color ?? DEFAULT_COLOR);
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute("content", b.name);
  const manifest = document.getElementById("app-manifest");
  manifest?.setAttribute("href", b.slug ? `/api/manifest?app=${encodeURIComponent(b.slug)}` : "/manifest.webmanifest");
}

export function setBrand(b: Brand) {
  const next: Brand = { name: b.name || DEFAULT_BRAND.name, color: b.color || null, slug: b.slug || null };
  const prev = read();
  current = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignoră */ }
  apply(next);
  if (prev.name !== next.name || prev.color !== next.color || prev.slug !== next.slug) window.dispatchEvent(new Event(EVT));
}

export function brandFromCompany(c: { app_name?: string | null; brand_color?: string | null; app_slug?: string | null } | null): Brand {
  if (!c) return DEFAULT_BRAND;
  return { name: c.app_name?.trim() || DEFAULT_BRAND.name, color: c.brand_color ?? null, slug: c.app_slug ?? null };
}

export function initBrand() { apply(read()); }

export function useBrand(): Brand {
  return useSyncExternalStore(
    (cb) => { window.addEventListener(EVT, cb); return () => window.removeEventListener(EVT, cb); },
    read,
    () => DEFAULT_BRAND,
  );
}

export const COLOR_PRESETS = ["#ea580c", "#dc2626", "#db2777", "#9333ea", "#4f46e5", "#2563eb", "#0891b2", "#0d9488", "#16a34a", "#65a30d", "#ca8a04", "#334155"];

/** Link sugerat din numele aplicației: „Pop Construct” → „pop-construct”. */
export function slugify(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}
