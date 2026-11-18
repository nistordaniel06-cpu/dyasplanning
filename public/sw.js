// DYASPlanning — service worker: notificări push + instalare ca aplicație.
const SHELL = "dyas-shell-v1";
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/icon-192.png"]).catch(() => undefined)));
});
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("dyas-shell-") && k !== SHELL) await caches.delete(k);
  await self.clients.claim();
})()));

// Fără semnal: aplicația se deschide din ultima versiune salvată pe telefon.
// Datele (Supabase, /api) nu se pun niciodată în cache aici.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?|ttf)$/.test(url.pathname)) {
    event.respondWith(caches.open(SHELL).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const c = await caches.open(SHELL);
      try {
        const res = await fetch(req);
        if (res.ok && !res.redirected) c.put(req, res.clone());
        return res;
      } catch (e) {
        const hit = await c.match(req, { ignoreSearch: true });
        if (hit) return hit;
        // orice pagină a aplicației deschisă înainte poate porni aplicația (navigarea e pe client)
        for (const p of ["/astazi", "/", "/pontaj", "/dashboard"]) { const r = await c.match(p); if (r) return r; }
        return Response.error();
      }
    })());
  }
});

// Traducerea notificărilor în engleză (același dicționar ca aplicația: /i18n-en.json)
let dictPromise = null;
async function userLang() {
  try { const c = await caches.open("dyas-settings"); const r = await c.match("/__lang"); return r ? (await r.text()) : "ro"; } catch { return "ro"; }
}
function loadDict() {
  dictPromise = dictPromise || fetch("/i18n-en.json").then((r) => r.json()).then((d) => ({
    exact: new Map(Object.entries(d.exact)),
    patterns: d.patterns.map(([re, out]) => [new RegExp(re), out]),
    inline: d.inline.map(([re, map]) => [new RegExp(re, "g"), map]),
  })).catch(() => null);
  return dictPromise;
}
function translate(D, text) {
  if (!D || !text) return text;
  let out = D.exact.get(text);
  if (out == null) {
    for (const [re, rep] of D.patterns) {
      const g = re.exec(text);
      if (!g) continue;
      out = rep.replace(/\$(\d)/g, (_, i) => { const v = g[Number(i)] || ""; return D.exact.get(v) || (v.indexOf(", ") >= 0 ? v.split(", ").map((x) => D.exact.get(x) || x).join(", ") : v); });
      break;
    }
  }
  let res = out == null ? text : out;
  for (const [re, map] of D.inline) res = res.replace(re, (w) => map[w] || map[w.trim()] || w);
  return res;
}

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "DYASPlanning", body: event.data && event.data.text() }; }
  event.waitUntil((async () => {
    let title = data.title || "DYASPlanning", body = data.body || "";
    if ((await userLang()) === "en") { const D = await loadDict(); title = translate(D, title); body = translate(D, body); }
    await self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if ("focus" in c) { await c.focus(); if ("navigate" in c) await c.navigate(url); return; }
    }
    await self.clients.openWindow(url);
  })());
});
