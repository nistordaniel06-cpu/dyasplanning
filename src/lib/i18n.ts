"use client";
// Traducerea interfeței în engleză. Textele aplicației rămân scrise în română în cod; când limba e „en”,
// fiecare text afișat (și placeholder / aria-label / title) e înlocuit din dicționarul public/i18n-en.json.
// Același dicționar e folosit și de service worker pentru notificările de pe telefon.
import dict from "../../public/i18n-en.json";
import { getLang } from "./lang";

type Dict = { exact: Record<string, string>; patterns: [string, string][]; inline: [string, Record<string, string>][] };
const D = dict as unknown as Dict;
const exact = new Map(Object.entries(D.exact));
const patterns = D.patterns.map(([re, out]) => [new RegExp(re), out] as const);
const inline = D.inline.map(([re, map]) => [new RegExp(re, "g"), map] as const);

/** Traduce un text (fără să țină cont de limba curentă). Întoarce null dacă nu există traducere. */
export function translateText(text: string): string | null {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  if (!m || !m[2]) return null;
  const [, lead, core, trail] = m;
  let out = exact.get(core) ?? null;
  if (out == null) {
    for (const [re, rep] of patterns) {
      const g = re.exec(core);
      if (!g) continue;
      out = rep.replace(/\$(\d)/g, (_, i) => { const v = g[Number(i)] ?? ""; return exact.get(v) ?? v; });
      break;
    }
  }
  let res = out ?? core;
  for (const [re, map] of inline) res = res.replace(re, (w) => map[w] ?? map[w.trim()] ?? w);
  if (out == null && res === core) return null;
  return lead + res + trail;
}

/** Pentru texte construite în cod (confirm, mesaje): traduce doar dacă limba e engleza. */
export function tr(s: string): string {
  return getLang() === "en" ? translateText(s) ?? s : s;
}

const ATTRS = ["placeholder", "aria-label", "title"];
const seen = new WeakMap<Node, string>();
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE"]);

function skipped(el: Element | null): boolean {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.hasAttribute("data-no-i18n")) return true;
  }
  return false;
}

function doText(n: Text) {
  const v = n.nodeValue ?? "";
  if (seen.get(n) === v || !/[A-Za-zăâîșțĂÂÎȘȚ]/.test(v)) return;
  if (skipped(n.parentElement)) { seen.set(n, v); return; }
  const t = translateText(v);
  if (t != null && t !== v) { seen.set(n, t); n.nodeValue = t; } else seen.set(n, v);
}

function doAttrs(el: Element) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const t = translateText(v);
    if (t != null && t !== v && !el.hasAttribute("data-no-i18n") && !skipped(el.parentElement)) el.setAttribute(a, t);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { doText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) doAttrs(root as Element);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text); else doAttrs(n as Element);
  }
}

let started = false;
/** Pornește traducerea automată (doar când limba e engleza). */
export function startI18n() {
  if (typeof window === "undefined") return;
  const lang = getLang();
  document.documentElement.lang = lang;
  try { void caches.open("dyas-settings").then((c) => c.put("/__lang", new Response(lang))); } catch { /* ignoră */ }
  if (lang !== "en" || started) { document.documentElement.classList.remove("i18n-pending"); return; }
  started = true;
  const origConfirm = window.confirm.bind(window);
  window.confirm = (msg?: string) => origConfirm(msg == null ? msg : tr(String(msg)));
  const origAlert = window.alert.bind(window);
  window.alert = (msg?: unknown) => origAlert(msg == null ? msg : tr(String(msg)));
  walk(document.body);
  document.title = tr(document.title);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "characterData") doText(m.target as Text);
      else if (m.type === "attributes") doAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  document.documentElement.classList.remove("i18n-pending");
}
