// DYASPlanning — service worker: notificări push + instalare ca aplicație.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Fără cache: datele vin mereu proaspete de pe server.
self.addEventListener("fetch", () => {});

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
