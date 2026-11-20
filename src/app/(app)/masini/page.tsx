"use client";
import { localeTag } from "@/lib/lang";
import { useMemo, useState } from "react";
import { AlertTriangle, Briefcase, Download, Home, MapPin, Navigation, Pencil, Plus, Trash2 } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { PeriodPicker, presetRange, type Preset } from "@/components/PeriodPicker";
import { TripsAdmin } from "@/components/TripsAdmin";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { byId, loadEmployees, loadExtraTrips, loadOdometer, loadVehicles } from "@/lib/data";
import { KIND_LABEL, formatKm, segmentLabel, sumBy, withDistances, type ReadingWithDistance } from "@/lib/odometer";
import { downloadText, toCsv } from "@/lib/reports";
import { addDays, shortDate, todayIn } from "@/lib/time";
import type { Employee, ExtraTrip, OdometerKind, OdometerReading, Vehicle } from "@/lib/types";

export default function MasiniPage() {
  return <RequireRole roles={["admin"]}><Masini /></RequireRole>;
}

function Masini() {
  const { tz } = useSession();
  const today = todayIn(tz);
  const [tab, setTab] = useState<"curse" | "km" | "masini">("curse");
  const [preset, setPreset] = useState<Preset>("luna");
  const [custom, setCustom] = useState<[string, string]>([today, today]);
  const [fVehicle, setFVehicle] = useState("");
  const [fDriver, setFDriver] = useState("");
  const [readingForm, setReadingForm] = useState<{ reading: OdometerReading | null } | null>(null);
  const [vehicleForm, setVehicleForm] = useState<{ vehicle: Vehicle | null } | null>(null);
  const [from, to] = presetRange(preset, tz, custom);

  // Se încarcă și citirile de după perioadă, ca ultima zi din perioadă să aibă km calculați.
  const q = useQuery(async () => {
    const sb = supabase();
    const [vehicles, employees, readings, todayReadings, extras, oldCount] = await Promise.all([
      loadVehicles(), loadEmployees({ includeInactive: true }), loadOdometer(from, addDays(to, 31)), loadOdometer(today, today), loadExtraTrips(from, to),
      Promise.all([sb.from("odometer_readings").select("id", { count: "exact", head: true }), sb.from("extra_trips").select("id", { count: "exact", head: true })])
        .then(([a, b]) => (a.count ?? 0) + (b.count ?? 0)),
    ]);
    return { vehicles, employees, readings, todayReadings, extras, oldCount };
  }, [from, to, today]);

  const d = q.data;
  const vehicles = useMemo(() => byId(d?.vehicles), [d]);
  const employees = useMemo(() => byId(d?.employees), [d]);
  const rows = useMemo(() => withDistances(d?.readings ?? [])
    .filter((r) => r.reading_date >= from && r.reading_date <= to)
    .filter((r) => (!fVehicle || r.vehicle_id === fVehicle) && (!fDriver || r.employee_id === fDriver)), [d, from, to, fVehicle, fDriver]);
  const extras = useMemo(() => (d?.extras ?? []).filter((x) => (!fVehicle || x.vehicle_id === fVehicle) && (!fDriver || x.employee_id === fDriver)), [d, fVehicle, fDriver]);
  const extraTotal = extras.reduce((a, x) => a + Number(x.km), 0);
  const byVehicle = sumBy(rows, (r) => r.vehicle_id);
  const byDriver = sumBy(rows, (r) => r.employee_id ?? "");
  const total = [...byVehicle.values()].reduce((a, b) => a + b, 0);
  const bySegment = sumBy(rows, (r) => segmentLabel(r));
  const missingToday = (d?.vehicles ?? []).filter((v) => v.active && !d!.todayReadings.some((r) => r.vehicle_id === v.id));
  const drivers = (d?.employees ?? []).filter((e) => e.is_driver);

  function exportCsv() {
    const csv = toCsv(
      ["Data", "Moment", "Mașina", "Nr. înmatriculare", "Șofer", "Km bord", "Km parcurși", "Drum", "Până la citirea din", "Observații"],
      [...rows].reverse().map((r) => [
        r.reading_date, KIND_LABEL[r.kind ?? "munca"], vehicles.get(r.vehicle_id)?.name ?? "", vehicles.get(r.vehicle_id)?.plate ?? "",
        r.employee_id ? employees.get(r.employee_id)?.full_name ?? "" : "", r.km, r.distance ?? "", segmentLabel(r), r.nextDate ?? "", r.note ?? "",
      ]).concat([...extras].reverse().map((x) => [
        x.trip_date, x.source === "gps" ? "Km extra (GPS)" : "Km extra", vehicles.get(x.vehicle_id)?.name ?? "", vehicles.get(x.vehicle_id)?.plate ?? "",
        x.employee_id ? employees.get(x.employee_id)?.full_name ?? "" : "", "", Number(x.km), "traseu extra", "", x.note ?? "",
      ])),
    );
    downloadText(`dyasplanning_km_${from}_${to}.csv`, csv);
  }

  return (
    <div>
      <PageHeader title="Mașini și kilometri" subtitle="Vizibil doar pentru administrator"
        actions={tab === "curse" ? undefined : tab === "km"
          ? <>
              <Button onClick={exportCsv} disabled={rows.length === 0}><Download className="h-4 w-4" />CSV</Button>
              <Button variant="primary" onClick={() => setReadingForm({ reading: null })} disabled={!d || d.vehicles.length === 0}><Plus className="h-4 w-4" />Adaugă citire</Button>
            </>
          : <Button variant="primary" onClick={() => setVehicleForm({ vehicle: null })}><Plus className="h-4 w-4" />Adaugă mașină</Button>} />

      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[
        { value: "curse", label: "Foaie de parcurs" }, { value: "masini", label: "Mașini" },
        ...(d?.oldCount ? [{ value: "km" as const, label: "Citiri vechi" }] : []),
      ]} /></div>

      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !d && <Loading />}

      {d && d.vehicles.length === 0 && (
        <Empty title="Nu ai adăugat încă nicio mașină" action={<Button variant="primary" onClick={() => setVehicleForm({ vehicle: null })}>Adaugă mașină</Button>}>
          Adaugă mașinile firmei, apoi marchează șoferii din fișa angajatului („Șofer”). Din ecranul „Astăzi” ei notează fiecare cursă: km din bord la plecare și la sosire.
        </Empty>
      )}

      {d && d.vehicles.length > 0 && tab === "curse" && (
        <>
          {drivers.length === 0 && <div className="mb-4"><Notice tone="blue">Niciun angajat nu este marcat ca șofer. Deschide fișa angajatului → Modifică → bifează „Șofer”.</Notice></div>}
          <TripsAdmin vehicles={d.vehicles} employees={d.employees} />
        </>
      )}

      {d && d.vehicles.length > 0 && tab === "km" && (
        <div className="space-y-4">
          {missingToday.length > 0 && (
            <Notice tone="amber">
              <span className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span><strong>Fără km introduși azi:</strong> {missingToday.map((v) => `${v.name}${v.plate ? ` (${v.plate})` : ""}`).join(", ")}</span>
              </span>
            </Notice>
          )}
          {drivers.length === 0 && <Notice tone="blue">Niciun angajat nu este marcat ca șofer. Deschide fișa angajatului → Modifică → bifează „Șofer”.</Notice>}

          <div className="flex flex-wrap gap-2">
            <PeriodPicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
            <Select className="w-auto" value={fVehicle} onChange={(e) => setFVehicle(e.target.value)} aria-label="Mașina">
              <option value="">Toate mașinile</option>
              {d.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>)}
            </Select>
            <Select className="w-auto" value={fDriver} onChange={(e) => setFDriver(e.target.value)} aria-label="Șofer">
              <option value="">Toți șoferii</option>
              {d.employees.filter((e) => e.is_driver || d.readings.some((r) => r.employee_id === e.id)).map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.trade ? ` — ${e.trade}` : ""}</option>)}
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase text-slate-500">Total km în perioadă</div>
              <div className="text-2xl font-bold">{formatKm(total)}</div>
              {(bySegment.get("acasă → muncă") || bySegment.get("muncă → acasă")) ? (
                <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                  {bySegment.get("acasă → muncă") ? <div>acasă → muncă: <strong className="tabular-nums">{formatKm(bySegment.get("acasă → muncă")!)}</strong></div> : null}
                  {bySegment.get("muncă → acasă") ? <div>muncă → acasă: <strong className="tabular-nums">{formatKm(bySegment.get("muncă → acasă")!)}</strong></div> : null}
                </div>
              ) : null}
              <div className="text-xs text-slate-500">{rows.filter((r) => r.distance === null).length > 0 ? "ultima citire se calculează după următoarea" : " "}</div>
            </div>
            <Card title="Pe mașină">
              {byVehicle.size === 0 ? <p className="text-sm text-slate-500">—</p> : (
                <ul className="space-y-1 text-sm">{[...byVehicle.entries()].sort((a, b) => b[1] - a[1]).map(([id, km]) => (
                  <li key={id} className="flex justify-between"><span>{vehicles.get(id)?.name}</span><strong className="tabular-nums">{formatKm(km)}</strong></li>))}</ul>
              )}
            </Card>
            <Card title="Pe șofer">
              {byDriver.size === 0 ? <p className="text-sm text-slate-500">—</p> : (
                <ul className="space-y-1 text-sm">{[...byDriver.entries()].sort((a, b) => b[1] - a[1]).map(([id, km]) => (
                  <li key={id || "x"} className="flex justify-between"><span>{id ? employees.get(id)?.full_name : "Fără șofer"}</span><strong className="tabular-nums">{formatKm(km)}</strong></li>))}</ul>
              )}
            </Card>
          </div>

          {rows.length === 0 ? <Empty title="Nicio citire în perioada aleasă" /> : (
            <ReadingsTable rows={rows} vehicles={vehicles} employees={employees} onEdit={(r) => setReadingForm({ reading: r })} />
          )}
          <ExtraTrips rows={extras} total={extraTotal} vehicles={vehicles} employees={employees} onChanged={q.reload} />
          <p className="text-xs text-slate-500">Șoferul scrie km de pe bord când ajunge la muncă și când ajunge acasă. Km parcurși = citirea următoare − citirea curentă: „muncă → acasă” e ziua de lucru plus drumul spre casă, „acasă → muncă” e drumul de dimineață.</p>
        </div>
      )}

      {d && d.vehicles.length > 0 && tab === "masini" && (
        <Card>
          <ul className="divide-y divide-slate-100">
            {d.vehicles.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold"><span aria-hidden className="mr-1">⛽</span>{v.name} {!v.active && <Badge tone="gray">Inactivă</Badge>}</div>
                  <div className="text-sm text-slate-600">{v.plate ?? "Fără număr"} · {d.employees.filter((e) => e.default_vehicle_id === v.id).map((e) => e.full_name).join(", ") || "fără șofer obișnuit"}</div>
                </div>
                <Button size="sm" onClick={() => setVehicleForm({ vehicle: v })}><Pencil className="h-4 w-4" />Modifică</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {readingForm && d && <ReadingForm reading={readingForm.reading} vehicles={d.vehicles} employees={d.employees} onClose={() => setReadingForm(null)} onSaved={async () => { setReadingForm(null); await q.reload(); }} />}
      {vehicleForm && <VehicleForm vehicle={vehicleForm.vehicle} onClose={() => setVehicleForm(null)} onSaved={async () => { setVehicleForm(null); await q.reload(); }} />}
    </div>
  );
}

function ExtraTrips({ rows, total, vehicles, employees, onChanged }: { rows: ExtraTrip[]; total: number; vehicles: Map<string, Vehicle>; employees: Map<string, Employee>; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function remove(x: ExtraTrip) {
    if (!confirm(`Ștergi traseul de ${formatKm(Number(x.km))}?`)) return;
    const { error: e } = await supabase().from("extra_trips").delete().eq("id", x.id);
    if (e) setError(humanError(e)); else onChanged();
  }
  const time = (v: string | null) => (v ? new Date(v).toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" }) : "");
  return (
    <Card title={`Km extra în perioadă: ${formatKm(total)}`}>
      <p className="-mt-1 mb-2 text-xs text-slate-500">Trasee în afara drumului obișnuit, scrise de șofer sau măsurate cu GPS-ul telefonului. Sunt separate de km din bord.</p>
      {error && <ErrorBox message={error} />}
      {rows.length === 0 ? <p className="text-sm text-slate-500">Niciun traseu extra.</p> : (
        <ul className="divide-y divide-slate-100 text-sm">
          {[...rows].reverse().map((x) => (
            <li key={x.id} className="flex items-center gap-3 py-2">
              {x.source === "gps" ? <Navigation className="h-4 w-4 shrink-0 text-blue-600" aria-label="GPS" /> : <Plus className="h-4 w-4 shrink-0 text-slate-400" />}
              <div className="min-w-0 flex-1">
                <div><strong className="tabular-nums">{formatKm(Number(x.km))}</strong> · {vehicles.get(x.vehicle_id)?.name ?? "Mașină"} · {x.employee_id ? employees.get(x.employee_id)?.full_name : "—"}</div>
                <div className="text-xs text-slate-500">{shortDate(x.trip_date)}{x.source === "gps" && x.started_at ? ` · GPS ${time(x.started_at)}–${time(x.ended_at)}` : ""}{x.note ? ` · ${x.note}` : ""}</div>
              </div>
              <button type="button" onClick={() => remove(x)} className="rounded p-2 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Șterge"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ReadingsTable({ rows, vehicles, employees, onEdit }: { rows: ReadingWithDistance[]; vehicles: Map<string, Vehicle>; employees: Map<string, Employee>; onEdit: (r: OdometerReading) => void }) {
  const dist = (r: ReadingWithDistance) => r.distance === null
    ? <span className="text-slate-400">după următoarea citire</span>
    : <span className="font-semibold">{formatKm(r.distance)}{segmentLabel(r) ? <span className="font-normal text-slate-500"> ({segmentLabel(r)})</span> : null}</span>;
  const moment = (r: ReadingWithDistance) => {
    const k = r.kind ?? "munca"; const Icon = k === "acasa" ? Home : Briefcase;
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        <Icon className="h-3.5 w-3.5 text-slate-500" />{KIND_LABEL[k]}
        {r.recorded_at ? <span className="text-xs text-slate-500">{new Date(r.recorded_at).toLocaleTimeString(localeTag(), { hour: "2-digit", minute: "2-digit" })}</span> : null}
        {r.lat != null && r.lon != null ? <a href={`https://www.google.com/maps?q=${r.lat},${r.lon}`} target="_blank" rel="noreferrer" aria-label="Locul citirii" className="text-orange-700"><MapPin className="h-3.5 w-3.5" /></a> : null}
      </span>
    );
  };
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-600">
            <tr><th className="px-3 py-2">Data</th><th className="px-3 py-2">Moment</th><th className="px-3 py-2">Mașina</th><th className="px-3 py-2">Șofer</th><th className="px-3 py-2 text-right">Km bord</th><th className="px-3 py-2 text-right">Km parcurși</th><th className="px-3 py-2">Observații</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-3 py-2">{shortDate(r.reading_date)}</td>
                <td className="px-3 py-2">{moment(r)}</td>
                <td className="px-3 py-2">{vehicles.get(r.vehicle_id)?.name} <span className="text-xs text-slate-500">{vehicles.get(r.vehicle_id)?.plate}</span></td>
                <td className="px-3 py-2">{r.employee_id ? employees.get(r.employee_id)?.full_name : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.km.toLocaleString(localeTag())}</td>
                <td className="px-3 py-2 text-right tabular-nums">{dist(r)}</td>
                <td className="px-3 py-2 text-slate-600">{r.note}</td>
                <td className="px-3 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => onEdit(r)} aria-label="Modifică"><Pencil className="h-4 w-4" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{shortDate(r.reading_date)} · {vehicles.get(r.vehicle_id)?.name}</span>
              <button onClick={() => onEdit(r)} className="rounded p-2 text-slate-500" aria-label="Modifică"><Pencil className="h-4 w-4" /></button>
            </div>
            <div className="text-sm">{moment(r)}</div>
            <div className="text-sm text-slate-600">{r.employee_id ? employees.get(r.employee_id)?.full_name : "—"} · bord {r.km.toLocaleString(localeTag())} km</div>
            <div className="mt-1 text-sm">Parcurși: {dist(r)}</div>
            {r.note && <div className="mt-1 text-xs text-slate-500">{r.note}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}

function ReadingForm({ reading, vehicles, employees, onClose, onSaved }: { reading: OdometerReading | null; vehicles: Vehicle[]; employees: Employee[]; onClose: () => void; onSaved: () => void }) {
  const { tz, company } = useSession();
  const [vehicleId, setVehicleId] = useState(reading?.vehicle_id ?? vehicles.find((v) => v.active)?.id ?? "");
  const [date, setDate] = useState(reading?.reading_date ?? todayIn(tz));
  const [employeeId, setEmployeeId] = useState(reading?.employee_id ?? "");
  const [km, setKm] = useState(reading ? String(reading.km) : "");
  const [kind, setKind] = useState<OdometerKind>(reading?.kind ?? "munca");
  const [note, setNote] = useState(reading?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true); setError(null);
    const payload = { vehicle_id: vehicleId, reading_date: date, kind, employee_id: employeeId || null, km: Number(km), note: note.trim() || null };
    const sb = supabase();
    const { error } = reading ? await sb.from("odometer_readings").update(payload).eq("id", reading.id) : await sb.from("odometer_readings").insert({ ...payload, company_id: company!.id });
    setBusy(false);
    if (error) { setError(error.code === "23505" ? "Există deja o citire pentru această mașină în ziua și momentul alese. Modific-o pe aceea." : humanError(error)); return; }
    onSaved();
  }
  async function remove() {
    if (!reading || !window.confirm("Ștergi această citire de km?")) return;
    const { error } = await supabase().from("odometer_readings").delete().eq("id", reading.id);
    if (error) { setError(humanError(error)); return; }
    onSaved();
  }

  return (
    <Modal open onClose={onClose} title={reading ? "Modifică citirea" : "Adaugă citire de km"}
      footer={<>
        {reading && <Button variant="danger" className="sm:mr-auto" onClick={remove}>Șterge</Button>}
        <Button onClick={onClose}>Renunță</Button>
        <Button variant="primary" onClick={save} loading={busy} disabled={!vehicleId || !km || !date}>Salvează</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Mașina"><Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.plate ? ` · ${v.plate}` : ""}</option>)}</Select></Field>
        <Field label="Moment">
          <Select value={kind} onChange={(e) => setKind(e.target.value as OdometerKind)}>
            <option value="munca">{KIND_LABEL.munca}</option>
            <option value="acasa">{KIND_LABEL.acasa}</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Km bord"><Input inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d]/g, ""))} /></Field>
        </div>
        <Field label="Șofer">
          <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">— necunoscut —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.trade ? ` — ${e.trade}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Observații"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}

function VehicleForm({ vehicle, onClose, onSaved }: { vehicle: Vehicle | null; onClose: () => void; onSaved: () => void }) {
  const { company } = useSession();
  const [name, setName] = useState(vehicle?.name ?? "");
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [active, setActive] = useState(vehicle?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    const payload = { name: name.trim(), plate: plate.trim().toUpperCase() || null, active };
    const sb = supabase();
    const { error } = vehicle ? await sb.from("vehicles").update(payload).eq("id", vehicle.id) : await sb.from("vehicles").insert({ ...payload, company_id: company!.id });
    setBusy(false);
    if (error) { setError(error.code === "23505" ? "Există deja o mașină cu acest număr." : humanError(error)); return; }
    onSaved();
  }
  return (
    <Modal open onClose={onClose} title={vehicle ? "Modifică mașina" : "Adaugă mașină"}
      footer={<><Button onClick={onClose}>Renunță</Button><Button variant="primary" onClick={save} loading={busy} disabled={!name.trim()}>Salvează</Button></>}>
      <div className="space-y-4">
        <Field label="Denumire"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Dacia Duster" /></Field>
        <Field label="Număr de înmatriculare"><Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ex. B 123 ABC" /></Field>
        {vehicle && (
          <label className="flex items-center gap-3 text-sm font-medium">
            <input type="checkbox" className="h-5 w-5 accent-orange-600" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Activă (mașinile inactive nu mai apar la șoferi; istoricul rămâne)
          </label>
        )}
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
