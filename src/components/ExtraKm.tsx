"use client";
// Km extra: trasee în afara drumului obișnuit — scrise de mână sau măsurate cu GPS-ul telefonului.
import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Navigation, Plus, Square, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useQuery, must } from "@/lib/useQuery";
import { humanError } from "@/lib/errors";
import { localeTag } from "@/lib/lang";
import { runOrQueue } from "@/lib/offline";
import { addPoint, estKmOf, kmOf, loadTrip, saveTrip, MAX_ACCURACY_M, type TripState } from "@/lib/gpsTrip";
import type { Vehicle } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Notice, Select, Tabs } from "./ui";

interface Trip { id: string; vehicle_id: string; km: number; note: string | null; source: "manual" | "gps"; created_at: string }

const fmtKm = (n: number) => `${n.toLocaleString(localeTag(), { maximumFractionDigits: 1 })} km`;
const carLabel = (v?: Vehicle) => (v ? `${v.name}${v.plate ? ` · ${v.plate}` : ""}` : "Mașină");

type WakeLock = { release: () => Promise<void> };

export function ExtraKm({ employeeId, today, vehicles, selected }: { employeeId: string; today: string; vehicles: Vehicle[]; selected: string }) {
  const q = useQuery(async () => must(await supabase().from("extra_trips").select("id, vehicle_id, km, note, source, created_at")
    .eq("employee_id", employeeId).eq("trip_date", today).order("created_at")) as Trip[], [employeeId, today]);
  const [form, setForm] = useState<null | { vehicleId: string; km: string; note: string; mode: "km" | "bord"; from: string; to: string; gps?: TripState; endedAt?: number }>(null);
  const [trip, setTrip] = useState<TripState | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number[]>([]);
  const [, tick] = useState(0);
  const wake = useRef<WakeLock | null>(null);
  const byId = new Map(vehicles.map((v) => [v.id, v]));

  // un traseu început înainte (aplicația a fost închisă) continuă
  useEffect(() => { setTrip(loadTrip(employeeId)); }, [employeeId]);

  const keepAwake = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLock> } };
      if (nav.wakeLock && document.visibilityState === "visible") wake.current = await nav.wakeLock.request("screen");
    } catch { /* telefonul nu permite: traseul merge cât ecranul e aprins */ }
  }, []);

  const running = trip !== null;
  useEffect(() => {
    if (!running) return;
    if (!("geolocation" in navigator)) { setGpsMsg("Telefonul nu are GPS disponibil în browser."); return; }
    void keepAwake();
    const onVis = () => { if (document.visibilityState === "visible") void keepAwake(); };
    document.addEventListener("visibilitychange", onVis);
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const acc = Math.round(p.coords.accuracy);
        setGpsMsg(acc > MAX_ACCURACY_M ? `Semnal GPS slab (±${acc} m) — punctele imprecise nu se numără.` : null);
        setTrip((s) => {
          if (!s) return s;
          const n = addPoint(s, { lat: p.coords.latitude, lon: p.coords.longitude, t: p.timestamp || Date.now(), acc });
          if (n !== s) saveTrip(employeeId, n);
          return n;
        });
      },
      (e) => setGpsMsg(e.code === e.PERMISSION_DENIED
        ? "Locația e blocată. Permite locația pentru această aplicație din setările telefonului, apoi încearcă din nou."
        : "Nu găsesc semnal GPS. Ieși în zonă deschisă și ține aplicația deschisă."),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => {
      navigator.geolocation.clearWatch(id); clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
      void wake.current?.release().catch(() => undefined); wake.current = null;
    };
  }, [running, employeeId, keepAwake]);

  function startGps() {
    const s: TripState = { vehicleId: selected, startedAt: Date.now(), meters: 0, last: null, points: 0 };
    saveTrip(employeeId, s); setTrip(s); setGpsMsg("Se caută semnalul GPS…"); setError(null);
  }
  function stopGps() {
    if (!trip) return;
    const endedAt = Date.now();
    setForm({ vehicleId: trip.vehicleId, km: String(kmOf(trip)).replace(".", ","), note: "", mode: "km", from: "", to: "", gps: trip, endedAt });
    saveTrip(employeeId, null); setTrip(null); setGpsMsg(null);
  }

  async function save() {
    if (!form) return;
    let km = Number(form.km.replace(",", "."));
    const parts: string[] = [];
    if (form.mode === "bord") {
      const a = Number(form.from), b = Number(form.to);
      if (!form.from || !form.to || !(b > a)) { setError("Scrie km din bord la plecare și la sosire (sosirea trebuie să fie mai mare)."); return; }
      km = b - a; parts.push(`bord ${a.toLocaleString(localeTag())} → ${b.toLocaleString(localeTag())}`);
    }
    if (!Number.isFinite(km) || km <= 0) { setError(form.gps ? "Traseul are 0 km — scrie km de mână sau din bord." : "Scrie câți km ai făcut."); return; }
    // GPS păstrat doar dacă șoferul n-a schimbat cifra măsurată
    const measured = form.gps ? kmOf(form.gps) : null;
    const isGps = measured !== null && form.mode === "km" && Math.abs(km - measured) < 0.05;
    if (form.gps && !isGps) parts.push(`GPS a măsurat ${fmtKm(measured!)}`);
    if (isGps && form.gps && estKmOf(form.gps) >= 0.5) parts.push(`din care ~${fmtKm(estKmOf(form.gps))} estimați (aplicația în fundal)`);
    const note = [form.note.trim(), ...parts].filter(Boolean).join(" · ") || null;
    setBusy(true); setError(null);
    try {
      const r = await runOrQueue({ kind: "extra_trip", label: `Km extra ${km}`, args: {
        p_vehicle_id: form.vehicleId, p_km: km, p_note: note, p_source: isGps ? "gps" : "manual",
        p_started_at: form.gps ? new Date(form.gps.startedAt).toISOString() : null,
        p_ended_at: form.endedAt ? new Date(form.endedAt).toISOString() : null, p_date: today,
      } });
      if (r.queued) setPending((p) => [...p, km]);
      setForm(null);
      await q.reload();
    } catch (e) { setError(humanError(e)); }
    setBusy(false);
  }

  async function remove(t: Trip) {
    if (!confirm(`Ștergi traseul de ${fmtKm(t.km)}?`)) return;
    const { error: e } = await supabase().rpc("delete_my_extra_trip", { p_id: t.id });
    if (e) setError(humanError(e)); else await q.reload();
  }

  const trips = q.data ?? [];
  const total = trips.reduce((a, t) => a + Number(t.km), 0);
  const elapsed = trip ? Math.floor((Date.now() - trip.startedAt) / 1000) : 0;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="font-bold">Km extra</div>
        {trips.length > 0 && <div className="text-sm text-slate-600">Azi: <strong className="tabular-nums">{fmtKm(total)}</strong></div>}
      </div>
      <p className="-mt-2 text-sm text-slate-600">Pentru drumurile în afara traseului obișnuit (materiale, altă lucrare) sau când schimbi mașina.</p>

      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {pending.map((n, i) => <Notice key={i} tone="amber">Fără semnal: {fmtKm(n)} sunt salvați pe telefon și se trimit singuri când revine internetul.</Notice>)}

      {trips.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm">
          {trips.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              {t.source === "gps" ? <Navigation className="h-4 w-4 shrink-0 text-blue-600" /> : <Plus className="h-4 w-4 shrink-0 text-slate-400" />}
              <div className="min-w-0 flex-1">
                <div className="font-semibold tabular-nums">{fmtKm(Number(t.km))} <span className="font-normal text-slate-500">· {byId.get(t.vehicle_id)?.name ?? "Mașină"}{t.source === "gps" ? " · GPS" : ""}</span></div>
                {t.note && <div className="truncate text-slate-600">{t.note}</div>}
              </div>
              <button type="button" aria-label="Șterge" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" onClick={() => remove(t)}><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}

      {trip && (
        <div className="space-y-2 rounded-xl border-2 border-blue-300 bg-blue-50 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-blue-800"><MapPin className="h-4 w-4 animate-pulse" />Traseu GPS pornit · {carLabel(byId.get(trip.vehicleId))}</div>
          <div className="text-4xl font-bold tabular-nums">{fmtKm(kmOf(trip))}</div>
          <div className="text-sm text-slate-600 tabular-nums">{Math.floor(elapsed / 3600)}h {String(Math.floor(elapsed / 60) % 60).padStart(2, "0")}m {String(elapsed % 60).padStart(2, "0")}s</div>
          {estKmOf(trip) > 0 && <p className="text-sm text-slate-700">din care ~{fmtKm(estKmOf(trip))} estimați cât aplicația a stat în fundal</p>}
          {gpsMsg && <p className="text-sm text-amber-800">{gpsMsg}</p>}
          <p className="text-xs text-slate-600">Cel mai exact: lasă aplicația deschisă pe ecran. Poți folosi și Waze: cât timp Waze e deasupra, aplicația nu primește locația, iar când revii în ea completează drumul lipsă cu o estimare. La final poți corecta km de mână sau din bord.</p>
          <Button size="lg" variant="danger" className="w-full" onClick={stopGps}><Square className="h-4 w-4" />Oprește traseul</Button>
        </div>
      )}

      {form && (
        <div className="space-y-3 rounded-xl border border-orange-300 bg-orange-50 p-3">
          <div className="font-bold">{form.gps ? "Traseu GPS terminat" : "Adaugă km extra"}</div>
          {vehicles.length > 1 && (
            <Field label="Mașina">
              <Select value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{carLabel(v)}</option>)}
              </Select>
            </Field>
          )}
          {form.gps && (
            <p className="text-sm text-slate-700">GPS-ul a măsurat <strong className="tabular-nums">{fmtKm(kmOf(form.gps))}</strong>
              {estKmOf(form.gps) > 0 ? <> (din care ~{fmtKm(estKmOf(form.gps))} estimați)</> : null}. Dacă nu e corect, schimbă cifra sau scrie km din bord.</p>
          )}
          <Tabs value={form.mode} onChange={(m) => setForm({ ...form, mode: m })} items={[{ value: "km", label: "Câți km" }, { value: "bord", label: "Din bord" }]} />
          {form.mode === "km"
            ? <Field label="Km făcuți"><Input inputMode="decimal" placeholder="ex. 35" value={form.km} onChange={(e) => setForm({ ...form, km: e.target.value.replace(/[^\d.,]/g, "") })} className="h-12 text-xl font-bold tabular-nums" /></Field>
            : (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Bord la plecare"><Input inputMode="numeric" placeholder="ex. 124580" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value.replace(/[^\d]/g, "") })} className="tabular-nums" /></Field>
                <Field label="Bord la sosire"><Input inputMode="numeric" placeholder="ex. 124615" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value.replace(/[^\d]/g, "") })} className="tabular-nums" /></Field>
                {Number(form.to) > Number(form.from) && form.from && <p className="col-span-2 text-sm">= <strong className="tabular-nums">{fmtKm(Number(form.to) - Number(form.from))}</strong></p>}
              </div>
            )}
          <Field label="Traseu / motiv (opțional)"><Input placeholder="ex. Dedeman Militari → Vila Otopeni" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
          {error && <ErrorBox message={error} />}
          <div className="flex gap-2">
            <Button onClick={() => { if (!form.gps || confirm("Renunți la traseul măsurat? Km nu se salvează.")) { setForm(null); setError(null); } }}>Renunță</Button>
            <Button variant="primary" className="flex-1" onClick={save} loading={busy}>Salvează km extra</Button>
          </div>
        </div>
      )}

      {!trip && !form && (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => { setForm({ vehicleId: selected, km: "", note: "", mode: "km", from: "", to: "" }); setError(null); }}><Plus className="h-4 w-4" />Scriu km</Button>
          <Button variant="primary" onClick={startGps}><Navigation className="h-4 w-4" />Pornește GPS</Button>
        </div>
      )}
      {!form && error && <ErrorBox message={error} />}
    </div>
  );
}
