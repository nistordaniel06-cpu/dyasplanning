"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Phone, Plus, Search } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Badge, Button, Empty, ErrorBox, Input, Loading, PageHeader, Select } from "@/components/ui";
import { EmployeeForm } from "@/components/EmployeeForm";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { byId, loadAbsences, loadAssignments, loadEmployees, loadTeams } from "@/lib/data";
import { availabilityFor } from "@/lib/conflicts";
import { formatMinutes } from "@/lib/hours";
import { isoWeekday, rangeUtc, todayIn } from "@/lib/time";

export default function AngajatiPage() {
  return <RequireRole roles={["admin"]}><Angajati /></RequireRole>;
}

function Angajati() {
  const { tz } = useSession();
  const today = todayIn(tz);
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const q = useQuery(async () => {
    const [f, t] = rangeUtc(today, today, tz);
    const [employees, teams, assignments, absences] = await Promise.all([loadEmployees({ includeInactive: true }), loadTeams(), loadAssignments(f, t), loadAbsences(today, today)]);
    return { employees, teams, assignments, absences };
  }, [today, tz]);
  const teams = useMemo(() => byId(q.data?.teams), [q.data]);

  const list = (q.data?.employees ?? []).filter((e) => (showInactive || e.active) && (!team || e.team_id === team)
    && (!search || `${e.full_name} ${e.trade ?? ""} ${e.phone ?? ""} ${e.skills.join(" ")}`.toLowerCase().includes(search.toLowerCase())));

  return (
    <div>
      <PageHeader title="Angajați" subtitle="Inclusiv angajați fără cont în aplicație"
        actions={<Button variant="primary" onClick={() => setFormOpen(true)} disabled={!q.data}><Plus className="h-4 w-4" />Adaugă angajat</Button>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Caută nume, meserie, competență" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select className="sm:w-48" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Echipă">
          <option value="">Toate echipele</option>
          {q.data?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-orange-600" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Arată inactivi</label>
      </div>
      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <Loading />}
      {q.data && q.data.employees.length === 0 && (
        <Empty title="Nu există angajați" action={<Button variant="primary" onClick={() => setFormOpen(true)}>Adaugă primul angajat</Button>}>
          Poți adăuga și angajați fără cont — îi poți planifica și ponta tu.
        </Empty>
      )}
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {list.map((e) => {
          const av = availabilityFor({ employeeId: e.id, workDays: e.work_days, weekday: isoWeekday(today), date: today, assignments: q.data!.assignments, absences: q.data!.absences, tz });
          return (
            <Link key={e.id} href={`/angajati/${e.id}`} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-orange-300">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 font-bold text-slate-700">
                {e.full_name.split(" ").map((x) => x[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold">{e.full_name}</span>
                  {!e.active && <Badge tone="gray">Inactiv</Badge>}
                  {!e.user_id && <Badge tone="gray">Fără cont</Badge>}
                </div>
                <div className="text-sm text-slate-600">{e.trade ?? "—"}{e.team_id ? ` · ${teams.get(e.team_id)?.name}` : ""}</div>
                {e.phone && <div className="flex items-center gap-1 text-xs text-slate-500"><Phone className="h-3 w-3" />{e.phone}</div>}
                <div className="mt-1.5">
                  {e.active && (av.kind === "disponibil" ? <Badge tone="green">Disponibil azi</Badge>
                    : av.kind === "absent" ? <Badge tone="red">Azi: {av.label}</Badge>
                    : av.kind === "nelucratoare" ? <Badge tone="gray">Zi liberă</Badge>
                    : <Badge tone="blue">Programat azi · {formatMinutes(av.minutes)}</Badge>)}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {formOpen && q.data && <EmployeeForm teams={q.data.teams} onClose={() => setFormOpen(false)} onSaved={async () => { setFormOpen(false); await q.reload(); }} />}
    </div>
  );
}
