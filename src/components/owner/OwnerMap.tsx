"use client";
import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  user_id: string; name: string | null; company_name: string | null; at: string;
  lat: number; lon: number; precise: boolean; accuracy: number | null; place: string | null; device: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Harta OpenStreetMap cu ultima poziție a fiecărui utilizator (portocaliu = GPS exact, gri = aproximativ după IP). */
export function OwnerMap({ points, onUser, labels }: {
  points: MapPoint[]; onUser: (id: string) => void;
  labels: { precise: string; approx: string; details: string };
}) {
  const el = useRef<HTMLDivElement>(null);
  const onUserRef = useRef(onUser);
  onUserRef.current = onUser;

  useEffect(() => {
    let map: import("leaflet").Map | null = null;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "&copy; OpenStreetMap",
      }).addTo(map);
      const bounds: [number, number][] = [];
      for (const p of points) {
        const color = p.precise ? "#ea580c" : "#64748b";
        if (p.precise && p.accuracy && p.accuracy > 30) {
          L.circle([p.lat, p.lon], { radius: p.accuracy, color, weight: 1, fillOpacity: 0.08 }).addTo(map);
        }
        const m = L.circleMarker([p.lat, p.lon], { radius: 9, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1 }).addTo(map);
        const when = new Date(p.at).toLocaleString(document.documentElement.lang === "en" ? "en-GB" : "ro-RO", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        m.bindPopup(
          `<div style="min-width:180px"><b>${esc(p.name ?? "—")}</b><br><span style="color:#64748b">${esc(p.company_name ?? "")}</span><br>` +
          `${esc(p.place ?? "")}<br><span style="color:#64748b">${when} · ${p.precise ? `${esc(labels.precise)}${p.accuracy ? ` ±${p.accuracy} m` : ""}` : esc(labels.approx)}</span><br>` +
          `<a href="#" data-user="${p.user_id}" style="color:#c2410c;font-weight:600">${esc(labels.details)}</a></div>`,
        );
        bounds.push([p.lat, p.lon]);
      }
      if (bounds.length === 1) map.setView(bounds[0], 13);
      else if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
      else map.setView([46, 15], 4);
      map.on("popupopen", (e) => {
        const a = e.popup.getElement()?.querySelector<HTMLAnchorElement>("a[data-user]");
        a?.addEventListener("click", (ev) => { ev.preventDefault(); onUserRef.current(a.dataset.user!); });
      });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [points, labels.precise, labels.approx, labels.details]);

  return <div ref={el} className="z-0 h-[60vh] min-h-[320px] w-full overflow-hidden rounded-xl border border-slate-200" />;
}
