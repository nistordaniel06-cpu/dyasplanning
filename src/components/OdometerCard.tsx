"use client";
import { useState } from "react";
import { Car, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { humanError } from "@/lib/errors";
import type { Vehicle } from "@/lib/types";
import { Button, ErrorBox, Field, Input, Loading, Select } from "./ui";

interface Today { vehicle_id: string; vehicle_name: string; plate: string | null; km: number; reading_date: string }

/** Cardul șoferului: km din bord la plecare, dimineața. */
export function OdometerCard() {
  const { employee } = useSession();
  const q = useQuery(async () => {
    const sb = supabase();
    const [vehicles, today] = await Promise.all([
      sb.from("vehicles").select("*").eq("active", true).order("name").then((r) => must(r) as Vehicle[]),
      sb.rpc("my_odometer_today").then((r) => must(r) as Today[]),
    ]);
    return { vehicles, today };
  }, []);
  const [vehicleId, setVehicleId] = useState<string>("");
  const [km, setKm] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!employee?.is_driver) return null;
  const d = q.data;
  const selected = vehicleId || employee.default_vehicle_id || d?.vehicles[0]?.id || "";
  const done = d?.today.find((t) => t.vehicle_id === selected) ?? (vehicleId ? undefined : d?.today[0]);

  async function save() {
    const n = Number(km.replace(/[^\d]/g, ""));
    if (!selected || !km.trim() || !Number.isFinite(n)) { setError("Introdu kilometrii de pe bord."); return; }
    setBusy(true); setError(null);
    const { error } = await supabase().rpc("submit_odometer", { p_vehicle_id: selected, p_km: n });
    setBusy(false);
    if (error) { setError(humanError(error)); return; }
    setEditing(false); setKm("");
    await q.reload();
  }

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border-2 border-orange-300 bg-white shadow-sm">
      <div className="flex items-center gap-2 bg-orange-50 px-4 py-3">
        <Car className="h-5 w-5 text-orange-700" />
        <h2 className="font-bold">Km la plecare</h2>
      </div>
      <div className="p-4">
        {q.loading && !d && <Loading />}
        {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
        {d && d.vehicles.length === 0 && <p className="text-sm text-slate-600">Nu există mașini adăugate. Cere administratorului să adauge mașina.</p>}
        {d && d.vehicles.length > 0 && (done && !editing ? (
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-8 w-8 shrink-0 text-green-700" />
            <div className="flex-1">
              <div className="text-xl font-bold tabular-nums">{done.km.toLocaleString("ro-RO")} km</div>
              <div className="text-sm text-slate-600">{done.vehicle_name}{done.plate ? ` · ${done.plate}` : ""} · salvat azi</div>
            </div>
            <Button size="sm" onClick={() => { setEditing(true); setVehicleId(done.vehicle_id); setKm(String(done.km)); }}>Corectează</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">Când pleci cu mașina, scrie kilometrii de pe bord.</p>
            {d.vehicles.length > 1 && (
              <Field label="Mașina">
                <Select value={selected} onChange={(e) => setVehicleId(e.target.value)}>
                  {d.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>)}
                </Select>
              </Field>
            )}
            {d.vehicles.length === 1 && <p className="text-sm font-semibold">{d.vehicles[0].name}{d.vehicles[0].plate ? ` · ${d.vehicles[0].plate}` : ""}</p>}
            <Field label="Km din bord">
              <Input inputMode="numeric" pattern="[0-9]*" placeholder="ex. 124580" value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d]/g, ""))}
                className="h-14 text-2xl font-bold tracking-wider tabular-nums" />
            </Field>
            {error && <ErrorBox message={error} />}
            <div className="flex gap-2">
              {editing && <Button size="lg" onClick={() => { setEditing(false); setError(null); }}>Renunță</Button>}
              <Button size="lg" variant="primary" className="flex-1" onClick={save} loading={busy} disabled={!km}>Salvează km</Button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
