"use client";
// Foaia de parcurs pentru administrator: toate cursele, ca foaia de hârtie (nr., km start, km stop, de la → la, motiv, șofer).
import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, Download, MapPin, Navigation, Pencil, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { humanError } from "@/lib/errors";
import { localeTag } from "@/lib/lang";
import { loadTrips } from "@/lib/data";
import { downloadText, toCsv } from "@/lib/reports";
import { addDays, localTime, shortDate, todayIn } from "@/lib/time";
import type { Employee, Trip, Vehicle } from "@/lib/types";
import { PeriodPicker, presetRange, type Preset } from "./PeriodPicker";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, Select } from "./ui";

const nf = (n: number) => n.toLocaleString(localeTag());
const len = (t: Trip) => (t.km_end == null ? null : t.km_end - t.km_start);

export interface TripRow extends Trip { gap: number | null }

/** Adaugă la fiecare cursă km nenotați față de sosirea cursei anterioare a aceleiași mașini. */
export function withGaps(trips: Trip[]): TripRow[] {
  const byCar = new Map<string, Trip[]>();
  for (const t of trips) byCar.set(t.vehicle_id, [...(byCar.get(t.vehicle_id) ?? []), t]);
  const out: TripRow[] = [];
  for (const list of byCar.values()) {
    list.sort((a, b) => a.seq - b.seq);
    list.forEach((t, i) => {
      const prev = list[i - 1];
      out.push({ ...t, gap: prev && prev.km_end != null && t.km_start > prev.km_end ? t.km_start - prev.km_end : null });
    });
  }
  return out.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

export function TripsAdmin({ vehicles, employees, onlyVehicle }: { vehicles: Vehicle[]; employees: Employee[]; onlyVehicle?: string }) {
  const { tz } = useSession();
  const today = todayIn(tz);
  const [preset, setPreset] = useState<Preset>("luna");
  const [custom, setCustom] = useState<[string, string]>([today, today]);
  const [fVehicle, setFVehicle] = useState(onlyVehicle ?? "");
  const [fDriver, setFDriver] = useState("");
  const [form, setForm] = useState<{ trip: Trip | null } | null>(null);
  const [from, to] = presetRange(preset, tz, custom);
  // cu o lună înainte, ca prima cursă din perioadă să-și știe cursa anterioară
  const q = useQuery(() => loadTrips(addDays(from, -31), to), [from, to]);
  const vById = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const eById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  const rows = useMemo(() => withGaps(q.data ?? []).filter((t) => t.trip_date >= from && t.trip_date <= to)
    .filter((t) => (!fVehicle || t.vehicle_id === fVehicle) && (!fDriver || t.employee_id === fDriver)), [q.data, from, to, fVehicle, fDriver]);
  const finished = rows.filter((t) => t.km_end != null);
  const openNow = (q.data ?? []).filter((t) => t.km_end == null);
  const sum = (list: TripRow[]) => list.reduce((a, t) => a + (len(t) ?? 0), 0);
  const total = sum(finished), personal = sum(finished.filter((t) => t.private));
  const gaps = rows.reduce((a, t) => a + (t.gap ?? 0), 0);
  const group = (key: (t: TripRow) => string) => {
    const m = new Map<string, number>();
    for (const t of finished) m.set(key(t), (m.get(key(t)) ?? 0) + (len(t) ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const vLabel = (id: string) => { const v = vById.get(id); return v ? `${v.name}${v.plate ? ` · ${v.plate}` : ""}` : "—"; };
  const eLabel = (id: string | null) => (id ? eById.get(id)?.full_name ?? "—" : "—");

  function exportCsv() {
    downloadText(`foaie_de_parcurs_${from}_${to}.csv`, toCsv(
      ["Data", "Nr. cursă", "Km start", "Km stop", "Km", "De la", "La", "Motiv deplasare", "Șofer", "Mașina", "Nr. înmatriculare", "Serviciu/Personal", "Plecare", "Sosire", "Km GPS"],
      rows.map((t) => [t.trip_date, t.seq, t.km_start, t.km_end ?? "", len(t) ?? "", t.from_place, t.to_place ?? "(în drum)", t.purpose ?? "", eLabel(t.employee_id),
        vById.get(t.vehicle_id)?.name ?? "", vById.get(t.vehicle_id)?.plate ?? "", t.private ? "Personal" : "Serviciu",
        localTime(t.started_at, tz), t.ended_at ? localTime(t.ended_at, tz) : "", t.gps_km ?? ""]),
    ));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
        <Select className="w-auto" value={fVehicle} onChange={(e) => setFVehicle(e.target.value)} aria-label="Mașina">
          <option value="">Toate mașinile</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>)}
        </Select>
        <Select className="w-auto" value={fDriver} onChange={(e) => setFDriver(e.target.value)} aria-label="Șofer">
          <option value="">Toți șoferii</option>
          {employees.filter((e) => e.is_driver || (q.data ?? []).some((t) => t.employee_id === e.id)).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </Select>
        <div className="ml-auto flex gap-2">
          <Button onClick={exportCsv} disabled={rows.length === 0}><Download className="h-4 w-4" />CSV</Button>
          <Button variant="primary" onClick={() => setForm({ trip: null })}><Plus className="h-4 w-4" />Adaugă cursă</Button>
        </div>
      </div>

      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <Loading />}

      {openNow.length > 0 && (
        <Notice tone="blue">
          <span className="flex items-start gap-2"><Navigation className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong>În drum acum:</strong> {openNow.map((t) => `${eLabel(t.employee_id)} cu ${vById.get(t.vehicle_id)?.name ?? "mașina"} — de la ${t.from_place}, ${localTime(t.started_at, tz)} (${nf(t.km_start)} km)`).join("; ")}</span>
          </span>
        </Notice>
      )}
      {gaps > 0 && (
        <Notice tone="amber">
          <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span><strong>{nf(gaps)} km nenotați</strong> în perioadă: km la plecare mai mari decât km la sosirea cursei anterioare a aceleiași mașini. Sunt marcați în tabel.</span>
          </span>
        </Notice>
      )}

      {q.data && (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs font-semibold uppercase text-slate-500">Total km în perioadă</div>
            <div className="text-2xl font-bold tabular-nums">{nf(total)} km</div>
            <div className="mt-1 text-xs text-slate-600">serviciu <strong className="tabular-nums">{nf(total - personal)}</strong> · personal <strong className="tabular-nums">{nf(personal)}</strong> · {finished.length} curse</div>
          </div>
          <Card title="Pe mașină">
            {finished.length === 0 ? <p className="text-sm text-slate-500">—</p> : <ul className="space-y-1 text-sm">{group((t) => t.vehicle_id).map(([id, km]) => <li key={id} className="flex justify-between gap-2"><span>{vById.get(id)?.name}</span><strong className="tabular-nums">{nf(km)} km</strong></li>)}</ul>}
          </Card>
          <Card title="Pe șofer">
            {finished.length === 0 ? <p className="text-sm text-slate-500">—</p> : <ul className="space-y-1 text-sm">{group((t) => t.employee_id ?? "").map(([id, km]) => <li key={id || "x"} className="flex justify-between gap-2"><span>{eLabel(id || null)}</span><strong className="tabular-nums">{nf(km)} km</strong></li>)}</ul>}
          </Card>
        </div>
      )}

      {q.data && rows.length === 0 && <Empty title="Nicio cursă în perioada aleasă">Șoferii notează din „Astăzi” km la plecare și km la sosire pentru fiecare drum.</Empty>}

      {rows.length > 0 && (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
                <tr>
                  <th className="px-3 py-2">Data</th><th className="px-3 py-2">Nr.</th><th className="px-3 py-2 text-right">Km start</th><th className="px-3 py-2 text-right">Km stop</th>
                  <th className="px-3 py-2 text-right">Km</th><th className="px-3 py-2">De la → La</th><th className="px-3 py-2">Motiv</th><th className="px-3 py-2">Șofer</th><th className="px-3 py-2">Mașina</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <Fragment key={t.id}>
                    {t.gap != null && (
                      <tr className="bg-amber-50 text-amber-900"><td colSpan={10} className="px-3 py-1 text-xs"><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{nf(t.gap)} km nenotați înainte de această cursă ({vById.get(t.vehicle_id)?.name})</td></tr>
                    )}
                    <tr className="border-t border-slate-100">
                      <td className="whitespace-nowrap px-3 py-2">{shortDate(t.trip_date)}<div className="text-xs text-slate-500">{localTime(t.started_at, tz)}{t.ended_at ? `–${localTime(t.ended_at, tz)}` : ""}</div></td>
                      <td className="px-3 py-2 text-slate-500">{t.seq}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{nf(t.km_start)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{t.km_end != null ? nf(t.km_end) : <Badge tone="blue">în drum</Badge>}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{len(t) != null ? nf(len(t)!) : "—"}{t.gps_km ? <div className="text-xs font-normal text-slate-500">GPS {nf(Number(t.gps_km))}</div> : null}</td>
                      <td className="px-3 py-2">{t.from_place} → {t.to_place ?? "…"}{t.private && <Badge tone="gray">personal</Badge>}</td>
                      <td className="px-3 py-2 text-slate-600">{t.purpose}</td>
                      <td className="px-3 py-2">{eLabel(t.employee_id)}</td>
                      <td className="px-3 py-2">{vById.get(t.vehicle_id)?.name} <span className="text-xs text-slate-500">{vById.get(t.vehicle_id)?.plate}</span></td>
                      <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => setForm({ trip: t })} aria-label="Modifică"><Pencil className="h-4 w-4" /></Button></td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {rows.map((t) => (
              <li key={t.id} className="rounded-xl border border-slate-200 bg-white p-3">
                {t.gap != null && <div className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{nf(t.gap)} km nenotați înainte</div>}
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{shortDate(t.trip_date)} · #{t.seq} · {vById.get(t.vehicle_id)?.name}</span>
                  <button onClick={() => setForm({ trip: t })} className="rounded p-2 text-slate-500" aria-label="Modifică"><Pencil className="h-4 w-4" /></button>
                </div>
                <div className="text-sm">{t.from_place} → {t.to_place ?? "…"} {t.private && <Badge tone="gray">personal</Badge>}</div>
                <div className="text-sm tabular-nums text-slate-600">{nf(t.km_start)} → {t.km_end != null ? nf(t.km_end) : "în drum"} · <strong>{len(t) != null ? `${nf(len(t)!)} km` : ""}</strong></div>
                <div className="text-xs text-slate-500">{eLabel(t.employee_id)}{t.purpose ? ` · ${t.purpose}` : ""}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-slate-500"><MapPin className="mr-1 inline h-3.5 w-3.5" />Fiecare cursă are km din bord la plecare și la sosire. Km la plecare se completează singuri cu km de la ultima sosire a mașinii; dacă diferă, apar ca „km nenotați”.</p>

      {form && <TripForm trip={form.trip} vehicles={vehicles} employees={employees} onClose={() => setForm(null)} onSaved={async () => { setForm(null); await q.reload(); }} />}
    </div>
  );
}

function TripForm({ trip, vehicles, employees, onClose, onSaved }: { trip: Trip | null; vehicles: Vehicle[]; employees: Employee[]; onClose: () => void; onSaved: () => void }) {
  const { company, tz } = useSession();
  const [f, setF] = useState({
    vehicle_id: trip?.vehicle_id ?? vehicles[0]?.id ?? "", employee_id: trip?.employee_id ?? "", trip_date: trip?.trip_date ?? todayIn(tz),
    km_start: trip ? String(trip.km_start) : "", km_end: trip?.km_end != null ? String(trip.km_end) : "",
    from_place: trip?.from_place ?? "Acasă", to_place: trip?.to_place ?? "", purpose: trip?.purpose ?? "", private: trip?.private ?? false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (s: string) => s.replace(/[^\d]/g, "");

  async function save() {
    const ks = Number(f.km_start), ke = f.km_end ? Number(f.km_end) : null;
    if (!f.km_start) { setError("Scrie km start."); return; }
    if (ke != null && ke < ks) { setError("Km stop trebuie să fie cel puțin cât km start."); return; }
    if (!f.from_place.trim()) { setError("Scrie de unde a plecat."); return; }
    if (ke != null && !f.to_place.trim()) { setError("Scrie unde a ajuns."); return; }
    setBusy(true); setError(null);
    const payload = {
      vehicle_id: f.vehicle_id, employee_id: f.employee_id || null, trip_date: f.trip_date, km_start: ks, km_end: ke,
      from_place: f.from_place.trim(), to_place: f.to_place.trim() || null, purpose: f.purpose.trim() || null, private: f.private,
      ended_at: ke != null ? (trip?.ended_at ?? new Date().toISOString()) : null,
    };
    const sb = supabase();
    const { error: e } = trip ? await sb.from("trips").update(payload).eq("id", trip.id)
      : await sb.from("trips").insert({ ...payload, company_id: company!.id, started_at: new Date(`${f.trip_date}T12:00:00`).toISOString() });
    setBusy(false);
    if (e) { setError(e.code === "23505" ? "Mașina are deja o cursă pornită. Termin-o întâi." : humanError(e)); return; }
    onSaved();
  }
  async function remove() {
    if (!trip || !confirm(`Ștergi cursa #${trip.seq} (${trip.from_place} → ${trip.to_place ?? "…"})?`)) return;
    const { error: e } = await supabase().from("trips").delete().eq("id", trip.id);
    if (e) { setError(humanError(e)); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={trip ? `Modifică cursa #${trip.seq}` : "Adaugă cursă"}
      footer={<>
        {trip && <Button variant="danger" className="sm:mr-auto" onClick={remove}>Șterge</Button>}
        <Button onClick={onClose}>Renunță</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!f.vehicle_id}>Salvează</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mașina"><Select value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })}>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>)}</Select></Field>
          <Field label="Data"><Input type="date" value={f.trip_date} onChange={(e) => setF({ ...f, trip_date: e.target.value })} /></Field>
        </div>
        <Field label="Șofer">
          <Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })}>
            <option value="">— necunoscut —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Km start"><Input inputMode="numeric" value={f.km_start} onChange={(e) => setF({ ...f, km_start: num(e.target.value) })} /></Field>
          <Field label="Km stop"><Input inputMode="numeric" placeholder="gol = încă în drum" value={f.km_end} onChange={(e) => setF({ ...f, km_end: num(e.target.value) })} /></Field>
          <Field label="De la"><Input value={f.from_place} onChange={(e) => setF({ ...f, from_place: e.target.value })} /></Field>
          <Field label="La"><Input value={f.to_place} onChange={(e) => setF({ ...f, to_place: e.target.value })} /></Field>
        </div>
        {f.km_start && f.km_end && Number(f.km_end) >= Number(f.km_start) && <p className="-mt-2 text-sm">Cursa: <strong>{nf(Number(f.km_end) - Number(f.km_start))} km</strong></p>}
        <Field label="Motiv deplasare"><Input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-orange-600" checked={f.private} onChange={(e) => setF({ ...f, private: e.target.checked })} />Drum personal</label>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
