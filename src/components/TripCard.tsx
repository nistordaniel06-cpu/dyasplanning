"use client";
// Foaia de parcurs a șoferului: fiecare cursă are km la plecare și km la sosire (ca foaia de hârtie).
// Km la plecare se completează singuri cu km de la ultima sosire a mașinii. GPS-ul (dacă e pornit) ajută la km de sosire.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Car, Flag, MapPin, Navigation, Pencil, Play } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { withOfflineCache } from "@/lib/cache";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { humanError } from "@/lib/errors";
import { localeTag } from "@/lib/lang";
import { locateOnce } from "@/lib/geo";
import { runOrQueue } from "@/lib/offline";
import { localDate, localTime, rangeUtc, todayIn } from "@/lib/time";
import { addPoint, estKmOf, kmOf, loadTodayCar, loadTrip, saveTodayCar, saveTrip, type TripState } from "@/lib/gpsTrip";
import type { Assignment, Project, Trip, Vehicle } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Loading, Notice, Select, cx } from "./ui";

export const HOME = "Acasă";
const OTHER = "__alt__";
const nf = (n: number) => n.toLocaleString(localeTag());
type WakeLock = { release: () => Promise<void> };

interface Place { label: string; projectId: string | null }
function PlacePicker({ label, places, value, onChange }: { label: string; places: Place[]; value: Place; onChange: (p: Place) => void }) {
  const known = places.some((p) => p.label === value.label);
  const [custom, setCustom] = useState(!known && value.label !== "");
  const sel = custom ? OTHER : value.label;
  return (
    <div className="space-y-2">
      <Field label={label}>
        <Select value={sel} onChange={(e) => {
          if (e.target.value === OTHER) { setCustom(true); onChange({ label: "", projectId: null }); return; }
          setCustom(false); onChange(places.find((p) => p.label === e.target.value) ?? { label: e.target.value, projectId: null });
        }}>
          {places.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
          <option value={OTHER}>Alt loc…</option>
        </Select>
      </Field>
      {custom && <Input aria-label={`${label} — alt loc`} placeholder="ex. Dedeman Militari" value={value.label} onChange={(e) => onChange({ label: e.target.value, projectId: null })} />}
    </div>
  );
}

const pendingKey = (emp: string) => `dyas.trip.pending.${emp}`;
type PendingOpen = Pick<Trip, "id" | "vehicle_id" | "km_start" | "from_place" | "started_at"> & { seq?: number };

export function TripCard() {
  const { employee, tz } = useSession();
  const today = todayIn(tz);
  const q = useQuery(() => withOfflineCache(`curse.${employee?.id}.${today}`, async () => {
    const sb = supabase();
    const [f, t] = rangeUtc(today, today, tz);
    const [vehicles, trips, projects, assignments] = await Promise.all([
      sb.from("vehicles").select("*").eq("active", true).order("name").then((r) => must(r) as Vehicle[]),
      Promise.all([
        sb.from("trips").select("*").eq("employee_id", employee!.id).gte("trip_date", today).order("started_at").then((r) => must(r) as Trip[]),
        sb.from("trips").select("*").eq("employee_id", employee!.id).is("km_end", null).then((r) => must(r) as Trip[]),
      ]).then(([a, b]) => [...a, ...b.filter((t) => !a.some((x) => x.id === t.id))].sort((x, y) => x.started_at.localeCompare(y.started_at))),
      sb.from("projects").select("id, name, status").in("status", ["planificata", "in_desfasurare"]).order("name").then((r) => must(r) as Pick<Project, "id" | "name" | "status">[]),
      sb.from("assignments").select("project_id, starts_at, status").eq("employee_id", employee!.id).gte("starts_at", f).lt("starts_at", t).order("starts_at")
        .then((r) => must(r) as Pick<Assignment, "project_id" | "starts_at" | "status">[]),
    ]);
    return { vehicles, trips, projects, assignments: assignments.filter((a) => a.status !== "anulata") };
  }), [employee?.id, today]);

  const [vehicleId, setVehicleId] = useState("");
  const [from, setFrom] = useState<Place | null>(null);
  const [kmStart, setKmStart] = useState("");
  const [lastKm, setLastKm] = useState<number | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [kmEnd, setKmEnd] = useState<string | null>(null); // null = încă neatins (se propune din GPS)
  const [purpose, setPurpose] = useState("");
  const [priv, setPriv] = useState(false);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingOpen | null>(null);
  const [queuedMsg, setQueuedMsg] = useState<string | null>(null);
  const [gps, setGps] = useState<TripState | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const wake = useRef<WakeLock | null>(null);

  const d = q.data;
  const empId = employee?.id ?? "";
  useEffect(() => { if (!empId) return; try { setPending(JSON.parse(localStorage.getItem(pendingKey(empId)) ?? "null")); } catch { /* */ } setGps(loadTrip(empId)); }, [empId]);

  const serverOpen = d?.trips.find((t) => t.km_end === null) ?? null;
  // cursa pornită fără semnal rămâne pe telefon până apare pe server
  useEffect(() => {
    if (pending && (serverOpen?.id === pending.id || d?.trips.some((t) => t.id === pending.id && t.km_end !== null))) {
      localStorage.removeItem(pendingKey(empId)); setPending(null);
    }
  }, [d, pending, serverOpen, empId]);
  const open: PendingOpen | null = serverOpen ?? pending;
  const done = (d?.trips ?? []).filter((t) => t.km_end !== null && t.trip_date === today);

  const places: Place[] = useMemo(() => {
    const list: Place[] = [{ label: HOME, projectId: null }];
    const assigned = new Set((d?.assignments ?? []).map((a) => a.project_id));
    const projs = [...(d?.projects ?? [])].sort((a, b) => Number(assigned.has(b.id)) - Number(assigned.has(a.id)));
    for (const p of projs) list.push({ label: p.name, projectId: p.id });
    for (const t of d?.trips ?? []) for (const l of [t.from_place, t.to_place]) if (l && !list.some((x) => x.label === l)) list.push({ label: l, projectId: null });
    return list;
  }, [d]);
  const firstJob = places.find((p) => p.projectId && (d?.assignments ?? []).some((a) => a.project_id === p.projectId)) ?? places.find((p) => p.projectId) ?? null;

  const remembered = empId ? loadTodayCar(empId, today) : null;
  const valid = (id: string | null | undefined) => (id && d?.vehicles.some((v) => v.id === id) ? id : "");
  const car = valid(vehicleId) || valid(remembered) || valid(employee?.default_vehicle_id) || d?.vehicles[0]?.id || "";
  const lastDone = done[done.length - 1];
  const fromValue: Place = from ?? (lastDone?.to_place ? { label: lastDone.to_place, projectId: lastDone.to_project_id } : { label: HOME, projectId: null });

  // km la plecare = ultimii km ai mașinii
  useEffect(() => {
    if (!car || open) return;
    let alive = true;
    supabase().rpc("vehicle_last_km", { p_vehicle_id: car }).then(({ data }) => {
      if (!alive) return;
      const km = (data as { km: number | null } | null)?.km ?? null;
      setLastKm(km); setKmStart(km != null ? String(km) : "");
    });
    return () => { alive = false; };
  }, [car, open?.id, d]); // eslint-disable-line react-hooks/exhaustive-deps

  // GPS cât e cursa pornită (dacă telefonul dă locația)
  const keepAwake = useCallback(async () => {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLock> } };
      if (nav.wakeLock && document.visibilityState === "visible") wake.current = await nav.wakeLock.request("screen");
    } catch { /* fără wake lock */ }
  }, []);
  const tracking = !!open && !!gps;
  useEffect(() => {
    if (!tracking || !("geolocation" in navigator)) return;
    void keepAwake();
    const onVis = () => { if (document.visibilityState === "visible") void keepAwake(); };
    document.addEventListener("visibilitychange", onVis);
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGpsMsg(null);
        setGps((s) => {
          if (!s) return s;
          const n = addPoint(s, { lat: p.coords.latitude, lon: p.coords.longitude, t: p.timestamp || Date.now(), acc: Math.round(p.coords.accuracy) });
          if (n !== s) saveTrip(empId, n);
          return n;
        });
      },
      (e) => setGpsMsg(e.code === e.PERMISSION_DENIED ? "Locația e oprită — km se scriu doar din bord." : "Caut semnal GPS…"),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 },
    );
    return () => {
      navigator.geolocation.clearWatch(id); document.removeEventListener("visibilitychange", onVis);
      void wake.current?.release().catch(() => undefined); wake.current = null;
    };
  }, [tracking, empId, keepAwake]);

  if (!employee?.is_driver) return null;

  const toDefault: Place = open
    ? (open.from_place === HOME ? (firstJob ?? { label: "", projectId: null }) : { label: HOME, projectId: null })
    : { label: HOME, projectId: null };
  const toValue = to ?? toDefault;
  const gpsKm = gps ? kmOf(gps) : 0;
  const suggestedEnd = open && gpsKm > 0 ? String(open.km_start + Math.round(gpsKm)) : "";

  async function start() {
    const n = Number(kmStart);
    if (!car) { setError("Alege mașina."); return; }
    if (!kmStart || !Number.isFinite(n)) { setError("Scrie km din bord la plecare."); return; }
    if (!fromValue.label.trim()) { setError("Scrie de unde pleci."); return; }
    setBusy(true); setError(null);
    const pos = await locateOnce(4000).catch(() => null);
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    try {
      const r = await runOrQueue({ kind: "trip_start", label: `Plecare ${n} km`, args: {
        p_id: id, p_vehicle_id: car, p_km_start: n, p_from: fromValue.label.trim(), p_from_project: fromValue.projectId,
        p_started_at: startedAt, p_lat: pos?.lat ?? null, p_lon: pos?.lon ?? null,
      } });
      const p: PendingOpen = { id, vehicle_id: car, km_start: n, from_place: fromValue.label.trim(), started_at: startedAt };
      localStorage.setItem(pendingKey(empId), JSON.stringify(p)); setPending(p);
      setQueuedMsg(r.queued ? "Fără semnal: plecarea e salvată pe telefon și se trimite singură când revine internetul." : null);
      saveTodayCar(empId, today, car);
      const g: TripState = { vehicleId: car, startedAt: Date.now(), meters: 0, last: pos && pos.accuracy <= 50 ? { lat: pos.lat, lon: pos.lon, t: Date.now(), acc: pos.accuracy } : null, points: 0 };
      saveTrip(empId, g); setGps(g);
      setFrom(null); setTo(null); setKmEnd(null); setPurpose(""); setPriv(false);
      await q.reload();
    } catch (e) { setError(humanError(e)); }
    setBusy(false);
  }

  async function finish(trip: { id: string; km_start: number }, isEdit: boolean) {
    const endStr = kmEnd ?? (isEdit ? "" : suggestedEnd);
    const n = Number(endStr);
    if (!endStr || !Number.isFinite(n)) { setError("Scrie km din bord la sosire."); return; }
    if (n < trip.km_start) { setError(`Km la sosire trebuie să fie cel puțin ${nf(trip.km_start)}.`); return; }
    if (!toValue.label.trim()) { setError("Scrie unde ai ajuns."); return; }
    setBusy(true); setError(null);
    const pos = isEdit ? null : await locateOnce(4000).catch(() => null);
    try {
      const r = await runOrQueue({ kind: "trip_end", label: `Sosire ${n} km`, args: {
        p_id: trip.id, p_km_end: n, p_to: toValue.label.trim(), p_to_project: toValue.projectId, p_purpose: purpose.trim() || null, p_private: priv,
        p_gps_km: !isEdit && gps ? kmOf(gps) : null, p_ended_at: isEdit ? null : new Date().toISOString(), p_lat: pos?.lat ?? null, p_lon: pos?.lon ?? null,
      } });
      setQueuedMsg(r.queued ? "Fără semnal: sosirea e salvată pe telefon și se trimite singură când revine internetul." : null);
      if (!isEdit) { saveTrip(empId, null); setGps(null); localStorage.removeItem(pendingKey(empId)); setPending(null); }
      setEditing(null); setTo(null); setKmEnd(null); setPurpose(""); setPriv(false);
      await q.reload();
    } catch (e) { setError(humanError(e)); }
    setBusy(false);
  }

  async function cancel() {
    if (!open || !confirm("Anulezi cursa pornită? Km la plecare se șterg.")) return;
    const { error: e } = await supabase().rpc("cancel_my_trip", { p_id: open.id });
    if (e && pending?.id !== open.id) { setError(humanError(e)); return; }
    saveTrip(empId, null); setGps(null); localStorage.removeItem(pendingKey(empId)); setPending(null);
    await q.reload();
  }

  const vName = (id: string) => { const v = d?.vehicles.find((x) => x.id === id); return v ? `${v.name}${v.plate ? ` · ${v.plate}` : ""}` : "Mașină"; };
  const totalToday = done.reduce((a, t) => a + (t.km_end! - t.km_start), 0);

  const endForm = (trip: { id: string; km_start: number }, isEdit: boolean) => (
    <div className="space-y-3">
      <PlacePicker label="Unde ai ajuns" places={places} value={toValue} onChange={setTo} />
      <Field label="Km din bord la sosire" hint={!isEdit && gps && gpsKm > 0 ? `GPS: ${gpsKm.toLocaleString(localeTag())} km de la plecare${estKmOf(gps) > 0 ? " (o parte estimată)" : ""} — verifică pe bord` : undefined}>
        <Input inputMode="numeric" pattern="[0-9]*" placeholder={suggestedEnd && !isEdit ? suggestedEnd : "ex. 20100"} value={kmEnd ?? (!isEdit ? suggestedEnd : "")}
          onChange={(e) => setKmEnd(e.target.value.replace(/[^\d]/g, ""))} className="h-14 text-2xl font-bold tracking-wider tabular-nums" />
      </Field>
      {(() => { const v = kmEnd ?? (!isEdit ? suggestedEnd : ""); return v && Number(v) >= trip.km_start
        ? <p className="-mt-1 text-sm">Cursa: <strong className="tabular-nums">{nf(Number(v) - trip.km_start)} km</strong></p> : null; })()}
      <Field label="Motiv / cu cine (opțional)"><Input placeholder="ex. Andrei, Denis · materiale" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-orange-600" checked={priv} onChange={(e) => setPriv(e.target.checked)} />Drum personal (nu de serviciu)</label>
      {error && <ErrorBox message={error} />}
      <div className="flex gap-2">
        {isEdit && <Button size="lg" onClick={() => { setEditing(null); setError(null); }}>Renunță</Button>}
        <Button size="lg" variant="primary" className="flex-1" onClick={() => finish(trip, isEdit)} loading={busy}><Flag className="h-5 w-5" />{isEdit ? "Salvează" : "Am ajuns"}</Button>
      </div>
    </div>
  );

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border-2 border-orange-300 bg-white shadow-sm">
      <div className="flex items-center gap-2 bg-orange-50 px-4 py-3">
        <Car className="h-5 w-5 text-orange-700" />
        <h2 className="flex-1 font-bold">Foaie de parcurs</h2>
        {done.length > 0 && <span className="text-sm text-slate-600">Azi: <strong className="tabular-nums">{nf(totalToday)} km</strong></span>}
      </div>
      <div className="space-y-3 p-4">
        {q.loading && !d && <Loading />}
        {q.error && !d && <ErrorBox message={q.error} onRetry={q.reload} />}
        {queuedMsg && <Notice tone="amber">{queuedMsg}</Notice>}
        {d && d.vehicles.length === 0 && <p className="text-sm text-slate-600">Nu există mașini adăugate. Cere administratorului să adauge mașina.</p>}

        {d && d.vehicles.length > 0 && done.length > 0 && (
          <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
            {done.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                <span className="w-7 shrink-0 text-xs font-semibold text-slate-400">#{t.seq}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t.from_place} → {t.to_place} <span className="font-normal tabular-nums text-slate-600">· {nf(t.km_end! - t.km_start)} km</span>{t.private && <span className="ml-1 text-xs text-slate-500">(personal)</span>}</div>
                  <div className="truncate text-xs text-slate-500 tabular-nums">{nf(t.km_start)} → {nf(t.km_end!)} · {localTime(t.started_at, tz)}–{t.ended_at ? localTime(t.ended_at, tz) : ""}{t.purpose ? ` · ${t.purpose}` : ""}</div>
                </div>
                <button type="button" aria-label="Corectează" className="rounded p-2 text-slate-400 hover:bg-orange-50 hover:text-orange-700"
                  onClick={() => { setEditing(t); setTo({ label: t.to_place ?? "", projectId: t.to_project_id }); setKmEnd(String(t.km_end)); setPurpose(t.purpose ?? ""); setPriv(t.private); setError(null); }}>
                  <Pencil className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ol>
        )}

        {d && editing && (
          <div className="space-y-3 rounded-xl border border-orange-300 bg-orange-50 p-3">
            <div className="font-bold">Corectează cursa #{editing.seq}: {editing.from_place} → …</div>
            <p className="-mt-2 text-sm text-slate-600">Plecare: {nf(editing.km_start)} km</p>
            {endForm(editing, true)}
          </div>
        )}

        {d && d.vehicles.length > 0 && !editing && open && (
          <div className="space-y-3 rounded-xl border-2 border-blue-300 bg-blue-50 p-3">
            <div className="flex items-start gap-2">
              <Navigation className="mt-0.5 h-5 w-5 shrink-0 text-blue-700" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">În drum de la {open.from_place}</div>
                <div className="text-sm text-slate-700 tabular-nums">{vName(open.vehicle_id)} · plecat la {localTime(open.started_at, tz)} cu {nf(open.km_start)} km</div>
                {localDate(open.started_at, tz) !== today && <div className="text-sm font-semibold text-amber-800">Cursa a pornit în altă zi — scrie km la sosire.</div>}
                {gps && <div className="mt-1 flex items-center gap-1 text-sm text-blue-800"><MapPin className="h-4 w-4" />GPS: <strong className="tabular-nums">{gpsKm.toLocaleString(localeTag())} km</strong>{gpsMsg ? ` · ${gpsMsg}` : ""}</div>}
              </div>
            </div>
            <div className="rounded-xl bg-white p-3">
              <div className="mb-2 font-bold">Am ajuns</div>
              {endForm(open, false)}
            </div>
            <button type="button" className="text-sm font-semibold text-slate-500 underline" onClick={cancel}>Anulează cursa (pornită din greșeală)</button>
          </div>
        )}

        {d && d.vehicles.length > 0 && !editing && !open && (
          <div className="space-y-3 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center gap-2 font-bold"><Play className="h-5 w-5 text-orange-700" />{done.length ? "Pornesc din nou la drum" : "Pornesc la drum"}</div>
            {d.vehicles.length > 1 ? (
              <Field label="Mașina pe care o conduci">
                <Select value={car} onChange={(e) => { setVehicleId(e.target.value); saveTodayCar(empId, today, e.target.value); }}>
                  {d.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>)}
                </Select>
              </Field>
            ) : <p className="text-sm font-semibold">{vName(car)}</p>}
            <PlacePicker label="De unde pleci" places={places} value={fromValue} onChange={setFrom} />
            <Field label="Km din bord la plecare" hint={lastKm != null ? `Completat automat: ultimii km ai mașinii (${nf(lastKm)}). Schimbă doar dacă bordul arată altceva.` : "Prima cursă cu această mașină: scrie km de pe bord."}>
              <Input inputMode="numeric" pattern="[0-9]*" placeholder="ex. 20000" value={kmStart} onChange={(e) => setKmStart(e.target.value.replace(/[^\d]/g, ""))}
                className={cx("h-14 text-2xl font-bold tracking-wider tabular-nums")} />
            </Field>
            {lastKm != null && Number(kmStart) > lastKm && <Notice tone="amber">{nf(Number(kmStart) - lastKm)} km față de ultima sosire — apar la administrator ca km nenotați.</Notice>}
            {error && <ErrorBox message={error} />}
            <Button size="lg" variant="primary" className="w-full" onClick={start} loading={busy} disabled={!kmStart}><Play className="h-5 w-5" />Pornesc</Button>
            <p className="text-xs text-slate-500">Dacă locația e pornită, GPS-ul numără km pe drum și îți propune km la sosire. Merge și cu Waze deschis.</p>
          </div>
        )}
      </div>
    </section>
  );
}
