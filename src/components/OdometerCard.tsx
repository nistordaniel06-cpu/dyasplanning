"use client";
import { localeTag } from "@/lib/lang";
import { useState } from "react";
import { Briefcase, Car, CheckCircle2, Home } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { withOfflineCache } from "@/lib/cache";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { humanError } from "@/lib/errors";
import { locateOnce } from "@/lib/geo";
import type { OdometerKind, Vehicle } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Loading, Notice, Select, cx } from "./ui";
import { runOrQueue } from "@/lib/offline";
import { todayIn } from "@/lib/time";

interface Today { vehicle_id: string; vehicle_name: string; plate: string | null; km: number; reading_date: string; kind?: OdometerKind | null; recorded_at?: string | null }

const MOMENTS: { kind: OdometerKind; title: string; hint: string; icon: typeof Home }[] = [
  { kind: "munca", title: "Am ajuns la muncă", hint: "Când ajungi la lucrare, scrie kilometrii de pe bord.", icon: Briefcase },
  { kind: "acasa", title: "Am ajuns acasă", hint: "Când ajungi acasă, scrie kilometrii de pe bord.", icon: Home },
];

/** Cardul șoferului: km din bord când ajunge la muncă și când ajunge acasă. */
export function OdometerCard() {
  const { employee, tz } = useSession();
  const q = useQuery(() => withOfflineCache(`km2.${employee?.id}.${todayIn(tz)}`, async () => {
    const sb = supabase();
    const [vehicles, today] = await Promise.all([
      sb.from("vehicles").select("*").eq("active", true).order("name").then((r) => must(r) as Vehicle[]),
      sb.rpc("my_odometer_today").then((r) => must(r) as Today[]),
    ]);
    return { vehicles, today };
  }), []);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [km, setKm] = useState("");
  const [editing, setEditing] = useState<OdometerKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState<Partial<Record<OdometerKind, number>>>({});

  if (!employee?.is_driver) return null;
  const d = q.data;
  const selected = vehicleId || employee.default_vehicle_id || d?.today[0]?.vehicle_id || d?.vehicles[0]?.id || "";
  const doneFor = (k: OdometerKind) => d?.today.find((t) => t.vehicle_id === selected && (t.kind ?? "munca") === k);
  const savedKm = (k: OdometerKind) => offline[k] ?? doneFor(k)?.km;
  // următorul moment de completat: întâi „la muncă”, apoi „acasă”
  const active: OdometerKind = editing ?? (savedKm("munca") == null ? "munca" : "acasa");
  const allDone = savedKm("munca") != null && savedKm("acasa") != null && !editing;
  const moment = MOMENTS.find((m) => m.kind === active)!;

  async function save() {
    const n = Number(km.replace(/[^\d]/g, ""));
    if (!selected || !km.trim() || !Number.isFinite(n)) { setError("Introdu kilometrii de pe bord."); return; }
    setBusy(true); setError(null);
    // locul citirii (dacă telefonul dă locația repede); nu blochează salvarea
    const pos = await locateOnce(4000).catch(() => null);
    try {
      const r = await runOrQueue({ kind: "odometer", label: `Km ${n}`, args: {
        p_vehicle_id: selected, p_km: n, p_date: todayIn(tz), p_kind: active, p_lat: pos?.lat ?? null, p_lon: pos?.lon ?? null,
      } });
      setBusy(false);
      if (r.queued) { setOffline((o) => ({ ...o, [active]: n })); setEditing(null); setKm(""); return; }
    } catch (e) { setBusy(false); setError(humanError(e)); return; }
    setOffline((o) => { const x = { ...o }; delete x[active]; return x; });
    setEditing(null); setKm("");
    await q.reload();
  }

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border-2 border-orange-300 bg-white shadow-sm">
      <div className="flex items-center gap-2 bg-orange-50 px-4 py-3">
        <Car className="h-5 w-5 text-orange-700" />
        <h2 className="font-bold">Km mașină</h2>
      </div>
      <div className="space-y-3 p-4">
        {q.loading && !d && <Loading />}
        {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
        {Object.values(offline).map((n) => (
          <Notice key={n} tone="amber">Fără semnal: {n!.toLocaleString(localeTag())} km sunt salvați pe telefon și se trimit singuri când revine internetul.</Notice>
        ))}
        {d && d.vehicles.length === 0 && <p className="text-sm text-slate-600">Nu există mașini adăugate. Cere administratorului să adauge mașina.</p>}
        {d && d.vehicles.length > 0 && (
          <>
            {d.vehicles.length > 1 ? (
              <Field label="Mașina">
                <Select value={selected} onChange={(e) => { setVehicleId(e.target.value); setEditing(null); }}>
                  {d.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>)}
                </Select>
              </Field>
            ) : <p className="text-sm font-semibold">{d.vehicles[0].name}{d.vehicles[0].plate ? ` · ${d.vehicles[0].plate}` : ""}</p>}

            {/* cele două momente ale zilei */}
            <ul className="grid grid-cols-2 gap-2">
              {MOMENTS.map((m) => {
                const v = savedKm(m.kind);
                const at = doneFor(m.kind)?.recorded_at;
                return (
                  <li key={m.kind} className={cx("rounded-xl border p-3", v != null ? "border-green-300 bg-green-50" : m.kind === active ? "border-orange-300 bg-orange-50" : "border-slate-200")}>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"><m.icon className="h-4 w-4" />{m.title}</div>
                    {v != null ? (
                      <>
                        <div className="mt-1 flex items-center gap-1 text-lg font-bold tabular-nums"><CheckCircle2 className="h-4 w-4 text-green-700" />{v.toLocaleString(localeTag())}</div>
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <span>{at ? new Date(at).toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "în așteptare"}</span>
                          <button type="button" className="font-semibold text-orange-700 underline" onClick={() => { setEditing(m.kind); setKm(String(v)); setError(null); }}>Corectează</button>
                        </div>
                      </>
                    ) : <div className="mt-1 text-sm text-slate-500">nescris încă</div>}
                  </li>
                );
              })}
            </ul>
            {savedKm("munca") != null && savedKm("acasa") != null && (
              <p className="text-sm text-slate-700">Azi: <strong className="tabular-nums">{(savedKm("acasa")! - savedKm("munca")!).toLocaleString(localeTag())} km</strong> de la muncă până acasă.</p>
            )}

            {!allDone && (
              <div className="space-y-3 rounded-xl border border-slate-200 p-3">
                <div className="flex items-center gap-2 font-bold"><moment.icon className="h-5 w-5 text-orange-700" />{moment.title}</div>
                <p className="-mt-2 text-sm text-slate-600">{moment.hint}</p>
                <Field label="Km din bord">
                  <Input inputMode="numeric" pattern="[0-9]*" placeholder="ex. 124580" value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d]/g, ""))}
                    className="h-14 text-2xl font-bold tracking-wider tabular-nums" />
                </Field>
                {error && <ErrorBox message={error} />}
                <div className="flex gap-2">
                  {editing && <Button size="lg" onClick={() => { setEditing(null); setKm(""); setError(null); }}>Renunță</Button>}
                  <Button size="lg" variant="primary" className="flex-1" onClick={save} loading={busy} disabled={!km}>Salvează km</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
