"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Button, Card, Empty, ErrorBox, Loading, Notice, PageHeader, Select, Tabs, cx } from "@/components/ui";
import { MonthlyPdfButton } from "@/components/MonthlyPdf";
import { PeriodPicker, presetRange, type Preset } from "@/components/PeriodPicker";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { byId, loadAssignments, loadEmployees, loadProjects, loadTasks, loadTimeEntries } from "@/lib/data";
import { aggregateHours, downloadText, entriesCsv, summaryCsv, type HoursRow } from "@/lib/reports";
import { formatMinutes } from "@/lib/hours";
import { inRange, rangeUtc, todayIn } from "@/lib/time";

export default function RapoartePage() {
  return <RequireRole roles={["admin"]}><Suspense fallback={<Loading />}><Rapoarte /></Suspense></RequireRole>;
}

function Rapoarte() {
  const { tz } = useSession();
  const [preset, setPreset] = useState<Preset>("luna");
  const [custom, setCustom] = useState<[string, string]>([todayIn(tz), todayIn(tz)]);
  const [fEmployee, setFEmployee] = useState("");
  const [fProject, setFProject] = useState("");
  const [by, setBy] = useState<"employee" | "project">("employee");
  const search = useSearchParams();
  useEffect(() => { const p = search.get("lucrare"); if (p) { setFProject(p); setBy("employee"); } }, [search]);
  const [from, to] = presetRange(preset, tz, custom);

  const q = useQuery(async () => {
    const [f, t] = rangeUtc(from, to, tz);
    const filter = { employeeId: fEmployee || undefined, projectId: fProject || undefined };
    const [employees, projects, tasks, assignments, entries] = await Promise.all([
      loadEmployees({ includeInactive: true }), loadProjects(), loadTasks(), loadAssignments(f, t, filter), loadTimeEntries(f, t, filter),
    ]);
    // loadAssignments include și turele începute cu o zi înainte; raportul le ia doar pe cele din perioadă.
    return { employees, projects, tasks, assignments: assignments.filter((a) => inRange(a.starts_at, f, t)), entries };
  }, [from, to, fEmployee, fProject, tz]);

  const d = q.data;
  const emp = useMemo(() => byId(d?.employees), [d]);
  const proj = useMemo(() => byId(d?.projects), [d]);
  const tk = useMemo(() => byId(d?.tasks), [d]);
  const labels = useMemo(() => new Map<string, string>([...(d?.employees ?? []).map((e) => [e.id, e.full_name] as [string, string]), ...(d?.projects ?? []).map((p) => [p.id, p.name] as [string, string])]), [d]);
  const agg = useMemo(() => (d ? aggregateHours(by, d.assignments, d.entries, labels) : null), [d, by, labels]);

  const fileBase = `dyasplanning_${from}_${to}`;
  const col = by === "employee" ? "Angajat" : "Lucrare";

  return (
    <div>
      <PageHeader title="Rapoarte" subtitle="Ore planificate față de ore efectiv lucrate"
        actions={<>
          <MonthlyPdfButton variant="primary" employees={d?.employees} />
          {d && agg && <>
          <Button onClick={() => downloadText(`${fileBase}_sumar_${by === "employee" ? "angajati" : "lucrari"}.csv`, summaryCsv(agg.rows, agg.total, col))} disabled={agg.rows.length === 0}><Download className="h-4 w-4" />CSV sumar</Button>
          <Button onClick={() => downloadText(`${fileBase}_pontaje.csv`, entriesCsv(d.entries, emp, proj, tk, tz))} disabled={d.entries.length === 0}><Download className="h-4 w-4" />CSV pontaje</Button>
          </>}
        </>} />

      <div className="mb-4 flex flex-wrap gap-2">
        <PeriodPicker preset={preset} onPreset={setPreset} custom={custom} onCustom={setCustom} />
        <Select className="w-auto" value={fEmployee} onChange={(e) => setFEmployee(e.target.value)} aria-label="Angajat">
          <option value="">Toți angajații</option>
          {d?.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.active ? "" : " (inactiv)"}</option>)}
        </Select>
        <Select className="w-auto" value={fProject} onChange={(e) => setFProject(e.target.value)} aria-label="Lucrare">
          <option value="">Toate lucrările</option>
          {d?.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>

      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !d && <Loading />}
      {d && agg && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Box label="Planificate" value={agg.total.plannedMinutes} />
            <Box label="Aprobate" value={agg.total.approvedMinutes} tone="green" />
            <Box label="Trimise, neaprobate" value={agg.total.submittedMinutes} tone="amber" />
            <Box label="Ciorne" value={agg.total.draftMinutes} />
          </div>
          <Notice tone="blue">Totalurile oficiale sunt cele <strong>aprobate</strong>. Orele trimise și ciornele sunt afișate separat și nu sunt incluse în coloana „Aprobate”. Pontajele respinse nu se adună.</Notice>
          <Card title={<Tabs value={by} onChange={setBy} items={[{ value: "employee", label: "Pe angajat" }, { value: "project", label: "Pe lucrare" }]} />}>
            {agg.rows.length === 0 ? <Empty title="Nu există date în perioada aleasă" /> : <SummaryTable rows={agg.rows} total={agg.total} col={col} />}
          </Card>
        </div>
      )}
    </div>
  );
}

function Box({ label, value, tone }: { label: string; value: number; tone?: "green" | "amber" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs font-semibold uppercase text-slate-500">{label}</div>
      <div className={cx("text-2xl font-bold", tone === "green" && "text-green-800", tone === "amber" && "text-amber-800")}>{formatMinutes(value)}</div>
    </div>
  );
}

function SummaryTable({ rows, total, col }: { rows: HoursRow[]; total: HoursRow; col: string }) {
  const diff = (r: HoursRow) => r.approvedMinutes - r.plannedMinutes;
  const line = (r: HoursRow, bold?: boolean) => (
    <tr key={r.key} className={cx("border-t border-slate-100", bold && "bg-slate-50 font-bold")}>
      <td className="px-2 py-2">{r.label}</td>
      <td className="px-2 py-2 text-right tabular-nums">{formatMinutes(r.plannedMinutes)}</td>
      <td className="px-2 py-2 text-right font-semibold tabular-nums text-green-800">{formatMinutes(r.approvedMinutes)}</td>
      <td className="px-2 py-2 text-right tabular-nums text-amber-800">{formatMinutes(r.submittedMinutes)}</td>
      <td className="px-2 py-2 text-right tabular-nums text-slate-500">{formatMinutes(r.draftMinutes)}</td>
      <td className={cx("px-2 py-2 text-right tabular-nums", diff(r) < 0 ? "text-red-700" : "text-slate-700")}>{formatMinutes(diff(r))}</td>
    </tr>
  );
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs font-semibold text-slate-600">
          <tr>
            <th className="px-2 py-2">{col}</th>
            <th className="px-2 py-2 text-right">Planificat</th>
            <th className="px-2 py-2 text-right">Aprobat</th>
            <th className="px-2 py-2 text-right">Trimis (neaprobat)</th>
            <th className="px-2 py-2 text-right">Ciornă</th>
            <th className="px-2 py-2 text-right">Aprobat − planificat</th>
          </tr>
        </thead>
        <tbody>{rows.map((r) => line(r))}{line(total, true)}</tbody>
      </table>
    </div>
  );
}
