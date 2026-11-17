"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Filter, MapPin, Plus } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { AssignmentEditor, type PlanningRefs } from "@/components/AssignmentEditor";
import { CopyDialog } from "@/components/CopyDialog";
import { Badge, Button, Empty, ErrorBox, Input, Loading, PageHeader, Select, Tabs, cx } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { byId, loadAbsences, loadAssignments, loadEmployees, loadProjects, loadTasks, loadTeams } from "@/lib/data";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { availabilityFor, findConflicts, type DayAvailability } from "@/lib/conflicts";
import { ASSIGNMENT_STATUS } from "@/lib/labels";
import { formatMinutes } from "@/lib/hours";
import { plannedMinutes } from "@/lib/reports";
import {
  addDays, addMonths, datesBetween, endOfMonth, isoWeekday, localDate, localTime, minutesFromDayStart, minutesToHHmm,
  monthLabel, moveToDate, prettyDate, rangeUtc, shortDate, startOfMonth, startOfWeek, todayIn, WEEKDAY_SHORT,
} from "@/lib/time";
import type { Assignment, Employee, Project } from "@/lib/types";

type View = "zi" | "saptamana" | "luna";

export default function PlanningPage() {
  return <RequireRole roles={["admin"]}><Planning /></RequireRole>;
}

function Planning() {
  const { tz, company } = useSession();
  const [view, setView] = useState<View>("saptamana");
  const [layout, setLayoutState] = useState<"lucrari" | "angajati">("lucrari");
  useEffect(() => {
    try { const v = localStorage.getItem("dyas.planning.layout"); if (v === "angajati" || v === "lucrari") setLayoutState(v); } catch { /* fără stocare */ }
  }, []);
  const setLayout = (v: "lucrari" | "angajati") => { setLayoutState(v); try { localStorage.setItem("dyas.planning.layout", v); } catch { /* ignoră */ } };
  const [date, setDate] = useState(() => todayIn(tz));
  const [fEmployee, setFEmployee] = useState("");
  const [fTeam, setFTeam] = useState("");
  const [fProject, setFProject] = useState("");
  const [fLocation, setFLocation] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<Assignment | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [toast, setToast] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.tone === "ok" ? 5000 : 9000);
    return () => clearTimeout(t);
  }, [toast]);

  const [from, to] = useMemo((): [string, string] => {
    if (view === "zi") return [date, date];
    if (view === "saptamana") { const s = startOfWeek(date); return [s, addDays(s, 6)]; }
    return [startOfWeek(startOfMonth(date)), addDays(startOfWeek(endOfMonth(date)), 6)];
  }, [view, date]);

  const q = useQuery(async () => {
    const [fromUtc, toUtc] = rangeUtc(from, to, tz);
    const [employees, teams, projects, tasks, assignments, absences] = await Promise.all([
      loadEmployees(), loadTeams(), loadProjects(), loadTasks(), loadAssignments(fromUtc, toUtc), loadAbsences(from, to),
    ]);
    return { employees, teams, projects, tasks, assignments, absences };
  }, [from, to, tz]);

  const d = q.data;
  const projects = useMemo(() => byId(d?.projects), [d]);
  const tasks = useMemo(() => byId(d?.tasks), [d]);

  const employees = useMemo(() => (d?.employees ?? []).filter((e) =>
    (!fEmployee || e.id === fEmployee) && (!fTeam || e.team_id === fTeam)), [d, fEmployee, fTeam]);

  const matchesLocation = (p?: Project) => !fLocation || [p?.city, p?.address].some((x) => (x ?? "").toLowerCase().includes(fLocation.toLowerCase()));
  const assignments = useMemo(() => (d?.assignments ?? []).filter((a) =>
    (!fProject || a.project_id === fProject) && (!fStatus ? a.status !== "anulata" : a.status === fStatus) && matchesLocation(projects.get(a.project_id))),
    [d, fProject, fStatus, fLocation, projects]); // eslint-disable-line react-hooks/exhaustive-deps

  // Când filtrăm pe lucrare/locație, ascundem angajații fără alocări în perioadă.
  const narrowed = fProject || fLocation || fStatus;
  const rows = narrowed ? employees.filter((e) => assignments.some((a) => a.employee_id === e.id)) : employees;

  const refs: PlanningRefs | null = d ? { employees: d.employees, projects: d.projects, tasks: d.tasks, assignments: d.assignments, absences: d.absences } : null;

  function shift(n: number) {
    if (view === "zi") setDate(addDays(date, n));
    else if (view === "saptamana") setDate(addDays(date, 7 * n));
    else setDate(addMonths(date, n));
  }

  /** Mutare / redimensionare din drag-and-drop: verifică și salvează doar alocarea mutată. */
  async function moveAssignment(a: Assignment, startsAt: Date, endsAt: Date, employeeId: string, projectId: string = a.project_id) {
    if (!d) return;
    const proposed = [{ id: a.id, employee_id: employeeId, project_id: projectId, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString() }];
    const conflicts = findConflicts({
      proposed, existing: d.assignments, absences: d.absences, projects: d.projects, tz,
      travelBufferMinutes: company?.travel_buffer_minutes ?? 30,
      employeeName: (id) => d.employees.find((e) => e.id === id)?.full_name ?? "",
    });
    const block = conflicts.find((c) => c.blocking);
    if (block) { setToast({ tone: "err", text: `Nu s-a mutat: ${block.message}` }); return; }
    setSaving(true);
    const { error } = await supabase().from("assignments").update({
      starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), employee_id: employeeId,
      ...(projectId !== a.project_id ? { project_id: projectId, task_id: null } : {}),
    }).eq("id", a.id);
    setSaving(false);
    if (error) { setToast({ tone: "err", text: humanError(error) }); return; }
    const warn = conflicts.find((c) => !c.blocking);
    setToast({ tone: "ok", text: warn ? `Salvat. Atenție: ${warn.message}` : projectId !== a.project_id ? "Alocarea a fost mutată pe altă lucrare (fără misiune — alege una din detalii)." : "Alocarea a fost mutată și salvată." });
    await q.reload();
  }

  const title = view === "zi" ? prettyDate(date) : view === "saptamana" ? `${shortDate(from)} – ${shortDate(to)}` : monthLabel(date);
  const filtersActive = [fEmployee, fTeam, fProject, fLocation, fStatus].filter(Boolean).length;

  return (
    <div>
      <PageHeader title="Planning" subtitle={company?.name}
        actions={<>
          {view !== "luna" && <Button onClick={() => setCopyOpen(true)}><Copy className="h-4 w-4" /> Copiază {view === "zi" ? "ziua" : "săptămâna"}</Button>}
          <Link href={`/planning/aloca?date=${view === "zi" ? date : todayIn(tz) > from ? todayIn(tz) : from}`}>
            <Button variant="primary"><Plus className="h-4 w-4" /> Alocă angajați</Button>
          </Link>
        </>} />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onChange={setView} items={[{ value: "zi", label: "Zi" }, { value: "saptamana", label: "Săptămână" }, { value: "luna", label: "Lună" }]} />
          {view !== "luna" && <Tabs value={layout} onChange={setLayout} items={[{ value: "lucrari", label: "Pe lucrări" }, { value: "angajati", label: "Pe angajați" }]} />}
          <div className="flex items-center gap-1">
            <Button size="md" variant="secondary" onClick={() => shift(-1)} aria-label="Înapoi"><ChevronLeft className="h-5 w-5" /></Button>
            <Button size="md" variant="secondary" onClick={() => setDate(todayIn(tz))}>Azi</Button>
            <Button size="md" variant="secondary" onClick={() => shift(1)} aria-label="Înainte"><ChevronRight className="h-5 w-5" /></Button>
          </div>
          <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="w-auto" aria-label="Alege data" />
        </div>
        <Button variant={filtersActive ? "primary" : "secondary"} className="lg:hidden" onClick={() => setShowFilters((v) => !v)}>
          <Filter className="h-4 w-4" /> Filtre{filtersActive ? ` (${filtersActive})` : ""}
        </Button>
      </div>

      <div className={cx("mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5", !showFilters && "hidden lg:grid")}>
        <Select value={fEmployee} onChange={(e) => setFEmployee(e.target.value)} aria-label="Angajat">
          <option value="">Toți angajații</option>
          {d?.employees.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </Select>
        <Select value={fTeam} onChange={(e) => setFTeam(e.target.value)} aria-label="Echipă">
          <option value="">Toate echipele</option>
          {d?.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
        <Select value={fProject} onChange={(e) => setFProject(e.target.value)} aria-label="Lucrare">
          <option value="">Toate lucrările</option>
          {d?.projects.filter((p) => p.status !== "anulata").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Input placeholder="Locație (oraș, adresă)" value={fLocation} onChange={(e) => setFLocation(e.target.value)} aria-label="Locație" />
        <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Status">
          <option value="">Active (fără anulate)</option>
          <option value="planificata">Planificate</option>
          <option value="confirmata">Confirmate</option>
          <option value="anulata">Anulate</option>
        </Select>
      </div>

      <h2 className="mb-3 text-lg font-semibold">{title}{saving && <span className="ml-2 text-sm font-normal text-slate-500">Se salvează…</span>}</h2>

      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !d && <Loading />}
      {d && d.employees.length === 0 && (
        <Empty title="Nu există încă angajați" action={<Link href="/angajati"><Button variant="primary">Adaugă angajați</Button></Link>}>
          Adaugă angajați și lucrări, apoi alocă-i în planning.
        </Empty>
      )}

      {d && d.employees.length > 0 && (
        <>
          {view === "zi" && <AvailabilityPanel date={date} employees={employees} d={d} tz={tz} />}
          {view !== "luna" && layout === "lucrari" && (
            <JobGrid days={view === "zi" ? [date] : datesBetween(from, to)} projects={d.projects}
              assignments={assignments.filter((a) => employees.some((e) => e.id === a.employee_id) || (!fEmployee && !fTeam))}
              onlyProject={fProject} location={fLocation} employees={byId(d.employees)} tasks={tasks} tz={tz}
              onOpen={setEditing} onMove={moveAssignment} onPickDay={(day) => { setDate(day); setView("zi"); }} />
          )}
          {view === "zi" && layout === "angajati" && (
            <>
              <div className="hidden md:block">
                <DayTimeline date={date} employees={rows} assignments={assignments} projects={projects} tasks={tasks} tz={tz}
                  onOpen={setEditing} onMove={moveAssignment} />
              </div>
              <div className="md:hidden"><DayAgenda date={date} assignments={assignments} d={d} tz={tz} onOpen={setEditing} /></div>
            </>
          )}
          {view === "saptamana" && layout === "angajati" && (
            <>
              <div className="hidden md:block">
                <WeekGrid from={from} employees={rows} assignments={assignments} projects={projects} tasks={tasks} tz={tz} absences={d.absences}
                  onOpen={setEditing} onMove={moveAssignment} />
              </div>
              <div className="space-y-5 md:hidden">
                {datesBetween(from, to).map((day) => (
                  <div key={day}>
                    <button className="mb-2 text-left font-semibold text-slate-800 underline-offset-2 hover:underline" onClick={() => { setDate(day); setView("zi"); }}>{prettyDate(day)}</button>
                    <DayAgenda date={day} assignments={assignments} d={d} tz={tz} onOpen={setEditing} compact />
                  </div>
                ))}
              </div>
            </>
          )}
          {view === "luna" && <MonthGrid date={date} from={from} to={to} assignments={assignments} projects={projects} tz={tz} onPick={(day) => { setDate(day); setView("zi"); }} />}
          {layout === "angajati" && narrowed && rows.length === 0 && <div className="mt-4"><Empty title="Nicio alocare pentru filtrele alese" /></div>}
        </>
      )}

      {editing && refs && (
        <AssignmentEditor assignment={editing} refs={refs} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); setToast({ tone: "ok", text: "Modificarea a fost salvată." }); await q.reload(); }} />
      )}
      {copyOpen && d && view !== "luna" && (
        <CopyDialog mode={view} from={from} to={to} source={assignments} refs={d} onClose={() => setCopyOpen(false)}
          onDone={async (n) => { setCopyOpen(false); setToast({ tone: "ok", text: `${n} alocări copiate și salvate.` }); await q.reload(); }} />
      )}

      {toast && (
        <div className="fixed inset-x-4 bottom-24 z-40 md:inset-x-auto md:right-8 md:bottom-8 md:max-w-md" role="status">
          <div className={cx("flex items-start gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg", toast.tone === "ok" ? "bg-slate-900" : "bg-red-700")}>
            <span className="flex-1">{toast.text}</span>
            <button onClick={() => setToast(null)} className="font-bold" aria-label="Închide">×</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------- Disponibilitate ----------------------------- */

type PD = { employees: Employee[]; assignments: Assignment[]; absences: import("@/lib/types").Absence[]; projects: Project[]; tasks: import("@/lib/types").Task[] };

function AvailabilityPanel({ date, employees, d, tz }: { date: string; employees: Employee[]; d: PD; tz: string }) {
  const groups = useMemo(() => {
    const g: Record<string, { e: Employee; a: DayAvailability }[]> = { disponibil: [], liber_partial: [], ocupat: [], absent: [], nelucratoare: [] };
    for (const e of employees) {
      const a = availabilityFor({ employeeId: e.id, workDays: e.work_days, weekday: isoWeekday(date), date, assignments: d.assignments, absences: d.absences, tz });
      g[a.kind].push({ e, a });
    }
    return g;
  }, [date, employees, d, tz]);
  const chip = (label: string, tone: "green" | "blue" | "gray" | "red" | "amber", items: { e: Employee; a: DayAvailability }[]) => items.length > 0 && (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge tone={tone}>{label}: {items.length}</Badge>
      {items.slice(0, 12).map(({ e, a }) => (
        <span key={e.id} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {e.full_name}{a.kind === "absent" ? ` (${a.label})` : a.kind === "liber_partial" ? ` (${formatMinutes(a.minutes)})` : ""}
        </span>
      ))}
      {items.length > 12 && <span className="text-xs text-slate-500">+{items.length - 12}</span>}
    </div>
  );
  return (
    <div className="mb-4 space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      {chip("Disponibili", "green", groups.disponibil)}
      {chip("Program parțial", "amber", groups.liber_partial)}
      {chip("Programați", "blue", groups.ocupat)}
      {chip("Absenți / concediu", "red", groups.absent)}
      {chip("Zi liberă", "gray", groups.nelucratoare)}
    </div>
  );
}

/* ----------------------------- Card de alocare ----------------------------- */

function CardBody({ a, p, taskName, tz, compact }: { a: Assignment; p?: Project; taskName?: string; tz: string; compact?: boolean }) {
  const st = ASSIGNMENT_STATUS[a.status];
  return (
    <>
      <div className="truncate text-xs font-bold text-slate-900">{p?.name ?? "Lucrare"}</div>
      {!compact && <div className="truncate text-xs text-slate-700">{taskName ?? "Fără misiune"}</div>}
      <div className="flex items-center gap-1 truncate text-[11px] text-slate-600">
        <span>{localTime(a.starts_at, tz)}–{localTime(a.ends_at, tz)}</span>
        {a.status !== "planificata" && <span className="font-semibold">· {st.label}</span>}
      </div>
    </>
  );
}

const cardStyle = (p?: Project, status?: string) => ({
  borderLeft: `4px solid ${p?.color ?? "#64748b"}`,
  background: status === "anulata" ? "repeating-linear-gradient(45deg,#fff,#fff 6px,#f1f5f9 6px,#f1f5f9 12px)" : `${p?.color ?? "#64748b"}14`,
});

/* ----------------------------- Zi (desktop) ----------------------------- */

interface DragState { id: string; mode: "move" | "resize"; startX: number; startY: number; delta: number; targetEmp: string | null; moved: boolean }

function DayTimeline({ date, employees, assignments, projects, tasks, tz, onOpen, onMove }: {
  date: string; employees: Employee[]; assignments: Assignment[]; projects: Map<string, Project>; tasks: Map<string, import("@/lib/types").Task>;
  tz: string; onOpen: (a: Assignment) => void; onMove: (a: Assignment, s: Date, e: Date, emp: string) => void;
}) {
  const dayAssignments = assignments.filter((a) => {
    const s = minutesFromDayStart(a.starts_at, date, tz), e = minutesFromDayStart(a.ends_at, date, tz);
    return e > 0 && s < 1440;
  });
  let startH = 6, endH = 20;
  for (const a of dayAssignments) {
    startH = Math.min(startH, Math.floor(Math.max(0, minutesFromDayStart(a.starts_at, date, tz)) / 60));
    endH = Math.max(endH, Math.ceil(Math.min(1440, minutesFromDayStart(a.ends_at, date, tz)) / 60));
  }
  const rangeMin = (endH - startH) * 60;
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const hours = Array.from({ length: endH - startH + 1 }, (_, i) => startH + i);

  function pxPerMin() { return (trackRef.current?.getBoundingClientRect().width ?? 800) / rangeMin; }

  function onDown(e: React.PointerEvent, a: Assignment, mode: "move" | "resize") {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: a.id, mode, startX: e.clientX, startY: e.clientY, delta: 0, targetEmp: a.employee_id, moved: false });
  }
  function onMoveEv(e: React.PointerEvent) {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.startX) / pxPerMin() / 15) * 15;
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => (x as HTMLElement).dataset?.row) as HTMLElement | undefined;
    const moved = drag.moved || Math.abs(e.clientX - drag.startX) > 4 || Math.abs(e.clientY - drag.startY) > 4;
    setDrag({ ...drag, delta, targetEmp: drag.mode === "move" ? el?.dataset.row ?? drag.targetEmp : drag.targetEmp, moved });
  }
  function onUp(a: Assignment) {
    if (!drag) return;
    const dr = drag;
    setDrag(null);
    if (!dr.moved) { onOpen(a); return; }
    const s = new Date(a.starts_at), en = new Date(a.ends_at);
    const ms = dr.delta * 60000;
    if (dr.mode === "move") {
      if (dr.delta === 0 && dr.targetEmp === a.employee_id) return;
      onMove(a, new Date(s.getTime() + ms), new Date(en.getTime() + ms), dr.targetEmp ?? a.employee_id);
    } else {
      const newEnd = new Date(en.getTime() + ms);
      if (newEnd.getTime() - s.getTime() < 30 * 60000 || dr.delta === 0) return;
      onMove(a, s, newEnd, a.employee_id);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <div className="min-w-[900px]">
        <div className="flex border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
          <div className="w-48 shrink-0 px-3 py-2 font-semibold">Angajat</div>
          <div className="relative h-8 flex-1" ref={trackRef}>
            {hours.slice(0, -1).map((h) => (
              <div key={h} className="absolute top-2" style={{ left: `${((h - startH) * 60 / rangeMin) * 100}%` }}>
                <span className="-ml-3">{String(h).padStart(2, "0")}:00</span>
              </div>
            ))}
          </div>
        </div>
        {employees.map((emp) => {
          const mine = dayAssignments.filter((a) => a.employee_id === emp.id);
          const total = mine.reduce((s, a) => s + plannedMinutes(a), 0);
          const isTarget = drag?.mode === "move" && drag.moved && drag.targetEmp === emp.id;
          return (
            <div key={emp.id} className={cx("flex border-b border-slate-100 last:border-0", isTarget && "bg-orange-50")}>
              <div className="w-48 shrink-0 px-3 py-2">
                <div className="truncate text-sm font-semibold">{emp.full_name}</div>
                <div className="truncate text-xs text-slate-500">{emp.trade ?? ""}{total > 0 ? ` · ${formatMinutes(total)}` : ""}</div>
              </div>
              <div className="relative h-[68px] flex-1" data-row={emp.id}>
                {hours.slice(1, -1).map((h) => (
                  <div key={h} className="pointer-events-none absolute inset-y-0 border-l border-slate-100" style={{ left: `${((h - startH) * 60 / rangeMin) * 100}%` }} />
                ))}
                {mine.map((a) => {
                  const p = projects.get(a.project_id);
                  let s = Math.max(0, minutesFromDayStart(a.starts_at, date, tz)) - startH * 60;
                  let e = Math.min(1440, minutesFromDayStart(a.ends_at, date, tz)) - startH * 60;
                  const isDrag = drag?.id === a.id && drag.moved;
                  if (isDrag && drag.mode === "move") { s += drag.delta; e += drag.delta; }
                  if (isDrag && drag.mode === "resize") e = Math.max(s + 30, e + drag.delta);
                  const yShift = isDrag && drag.mode === "move" && drag.targetEmp !== a.employee_id ? "opacity-70" : "";
                  return (
                    <div key={a.id}
                      onPointerDown={(ev) => onDown(ev, a, "move")} onPointerMove={onMoveEv} onPointerUp={() => onUp(a)}
                      onKeyDown={(ev) => ev.key === "Enter" && onOpen(a)} tabIndex={0} role="button"
                      aria-label={`${p?.name}, ${localTime(a.starts_at, tz)}–${localTime(a.ends_at, tz)}. Apasă Enter pentru a modifica.`}
                      className={cx("absolute top-1.5 bottom-1.5 cursor-grab touch-none select-none overflow-hidden rounded-md px-2 py-1 shadow-sm ring-1 ring-slate-200 hover:ring-orange-400", isDrag && "z-10 cursor-grabbing shadow-lg ring-2 ring-orange-500", yShift)}
                      style={{ left: `${(s / rangeMin) * 100}%`, width: `calc(${((e - s) / rangeMin) * 100}% - 2px)`, ...cardStyle(p, a.status) }}>
                      <CardBody a={a} p={p} taskName={a.task_id ? tasks.get(a.task_id)?.name : undefined} tz={tz} />
                      {isDrag && <div className="absolute right-1 top-1 rounded bg-slate-900 px-1 text-[10px] text-white">
                        {minutesToHHmm(s + startH * 60)}–{minutesToHHmm(e + startH * 60)}</div>}
                      <div onPointerDown={(ev) => onDown(ev, a, "resize")} onPointerMove={onMoveEv} onPointerUp={(ev) => { ev.stopPropagation(); onUp(a); }}
                        className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize bg-slate-400/0 hover:bg-orange-400/40" aria-hidden />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        Trage un card pentru a-l muta (inclusiv pe alt angajat), trage marginea dreaptă pentru a schimba ora de sfârșit, sau dă clic pentru detalii. Pașii sunt de 15 minute.
      </p>
    </div>
  );
}

/* ----------------------------- Săptămână (desktop) ----------------------------- */

function WeekGrid({ from, employees, assignments, projects, tasks, tz, absences, onOpen, onMove }: {
  from: string; employees: Employee[]; assignments: Assignment[]; projects: Map<string, Project>; tasks: Map<string, import("@/lib/types").Task>;
  tz: string; absences: import("@/lib/types").Absence[]; onOpen: (a: Assignment) => void; onMove: (a: Assignment, s: Date, e: Date, emp: string) => void;
}) {
  const days = datesBetween(from, addDays(from, 6));
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; cell: string | null; moved: boolean } | null>(null);
  const today = todayIn(tz);

  function onDown(e: React.PointerEvent, a: Assignment) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: a.id, x: e.clientX, y: e.clientY, dx: 0, dy: 0, cell: null, moved: false });
  }
  function onMoveEv(e: React.PointerEvent) {
    if (!drag) return;
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => (x as HTMLElement).dataset?.cell) as HTMLElement | undefined;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    setDrag({ ...drag, dx, dy, cell: el?.dataset.cell ?? null, moved: drag.moved || Math.abs(dx) + Math.abs(dy) > 6 });
  }
  function onUp(a: Assignment) {
    const dr = drag; setDrag(null);
    if (!dr) return;
    if (!dr.moved) { onOpen(a); return; }
    if (!dr.cell) return;
    const [emp, day] = dr.cell.split("|");
    if (emp === a.employee_id && day === localDate(a.starts_at, tz)) return;
    const m = moveToDate(a.starts_at, a.ends_at, day, tz);
    onMove(a, m.startsAt, m.endsAt, emp);
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[1000px] table-fixed border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs text-slate-600">
            <th className="w-44 px-3 py-2 text-left font-semibold">Angajat</th>
            {days.map((day) => (
              <th key={day} className={cx("px-2 py-2 text-left font-semibold", day === today && "text-orange-700")}>{shortDate(day)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((emp) => (
            <tr key={emp.id} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2">
                <div className="truncate font-semibold">{emp.full_name}</div>
                <div className="text-xs text-slate-500">
                  {formatMinutes(assignments.filter((a) => a.employee_id === emp.id && days.includes(localDate(a.starts_at, tz))).reduce((s, a) => s + plannedMinutes(a), 0))}
                </div>
              </td>
              {days.map((day) => {
                const cellKey = `${emp.id}|${day}`;
                const items = assignments.filter((a) => a.employee_id === emp.id && localDate(a.starts_at, tz) === day);
                const abs = absences.find((x) => x.employee_id === emp.id && x.start_date <= day && x.end_date >= day);
                const off = !emp.work_days.includes(isoWeekday(day));
                return (
                  <td key={day} data-cell={cellKey}
                    className={cx("h-20 space-y-1 border-l border-slate-100 p-1", off && "bg-slate-50", drag?.moved && drag.cell === cellKey && "bg-orange-50 ring-2 ring-inset ring-orange-400")}>
                    {abs && <div className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">{abs.type === "concediu" ? "Concediu" : abs.type === "medical" ? "Medical" : "Absent"}</div>}
                    {items.map((a) => {
                      const p = projects.get(a.project_id);
                      const isDrag = drag?.id === a.id && drag.moved;
                      return (
                        <div key={a.id} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === "Enter" && onOpen(a)}
                          onPointerDown={(ev) => onDown(ev, a)} onPointerMove={onMoveEv} onPointerUp={() => onUp(a)}
                          className={cx("cursor-grab touch-none select-none rounded-md px-1.5 py-1 ring-1 ring-slate-200 hover:ring-orange-400", isDrag && "relative z-20 shadow-lg ring-2 ring-orange-500")}
                          style={{ ...cardStyle(p, a.status), ...(isDrag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {}) }}>
                          <CardBody a={a} p={p} taskName={a.task_id ? tasks.get(a.task_id)?.name : undefined} tz={tz} />
                        </div>
                      );
                    })}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">Trage un card în altă zi sau la alt angajat; orele se păstrează. Clic pentru a modifica.</p>
    </div>
  );
}

/* ----------------------------- Agendă (telefon) ----------------------------- */

function DayAgenda({ date, assignments, d, tz, onOpen, compact }: { date: string; assignments: Assignment[]; d: PD; tz: string; onOpen: (a: Assignment) => void; compact?: boolean }) {
  const items = assignments.filter((a) => localDate(a.starts_at, tz) === date).sort((x, y) => x.starts_at.localeCompare(y.starts_at));
  const emp = byId(d.employees), proj = byId(d.projects), tk = byId(d.tasks);
  if (items.length === 0) return <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">Nicio alocare.</p>;
  // grupare pe lucrare — așa vede administratorul rapid cine e unde
  const groups = new Map<string, Assignment[]>();
  for (const a of items) groups.set(a.project_id, [...(groups.get(a.project_id) ?? []), a]);
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([pid, list]) => {
        const p = proj.get(pid);
        return (
          <div key={pid} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="flex items-start gap-2 px-3 py-2.5" style={{ borderLeft: `5px solid ${p?.color}` }}>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{p?.name}</div>
                {!compact && (p?.address || p?.city) && <div className="flex items-center gap-1 text-xs text-slate-600"><MapPin className="h-3 w-3" />{[p?.address, p?.city].filter(Boolean).join(", ")}</div>}
              </div>
              <Badge tone="gray">{list.length} {list.length === 1 ? "om" : "oameni"}</Badge>
            </div>
            <ul className="divide-y divide-slate-100">
              {list.map((a) => (
                <li key={a.id}>
                  <button onClick={() => onOpen(a)} className="flex w-full items-center gap-3 px-3 py-3 text-left active:bg-slate-50">
                    <div className="w-[88px] shrink-0 text-sm font-semibold tabular-nums">{localTime(a.starts_at, tz)}–{localTime(a.ends_at, tz)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{emp.get(a.employee_id)?.full_name}</div>
                      <div className="truncate text-xs text-slate-600">{a.task_id ? tk.get(a.task_id)?.name : "Fără misiune"}</div>
                    </div>
                    {a.status !== "planificata" && <Badge tone={ASSIGNMENT_STATUS[a.status].tone}>{ASSIGNMENT_STATUS[a.status].label}</Badge>}
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- Lună ----------------------------- */

function MonthGrid({ date, from, to, assignments, projects, tz, onPick }: { date: string; from: string; to: string; assignments: Assignment[]; projects: Map<string, Project>; tz: string; onPick: (d: string) => void }) {
  const days = datesBetween(from, to);
  const month = date.slice(0, 7);
  const today = todayIn(tz);
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="grid grid-cols-7 bg-slate-50 text-center text-xs font-semibold text-slate-600">
        {[1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="py-2">{WEEKDAY_SHORT[i]}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const items = assignments.filter((a) => localDate(a.starts_at, tz) === day);
          const people = new Set(items.map((a) => a.employee_id)).size;
          const projs = [...new Set(items.map((a) => a.project_id))];
          return (
            <button key={day} onClick={() => onPick(day)}
              className={cx("min-h-[72px] border-t border-l border-slate-100 p-1.5 text-left align-top hover:bg-orange-50 md:min-h-[96px]", day.slice(0, 7) !== month && "bg-slate-50 text-slate-400")}>
              <div className={cx("text-xs font-semibold", day === today && "inline-block rounded-full bg-orange-600 px-1.5 text-white")}>{Number(day.slice(8))}</div>
              {people > 0 && <div className="mt-1 text-[11px] font-semibold text-slate-700">{people} {people === 1 ? "om" : "oameni"}</div>}
              <div className="mt-1 hidden space-y-0.5 md:block">
                {projs.slice(0, 3).map((pid) => (
                  <div key={pid} className="truncate rounded px-1 text-[11px]" style={{ background: `${projects.get(pid)?.color}1f`, borderLeft: `3px solid ${projects.get(pid)?.color}` }}>{projects.get(pid)?.name}</div>
                ))}
                {projs.length > 3 && <div className="text-[11px] text-slate-500">+{projs.length - 3}</div>}
              </div>
              <div className="mt-1 flex gap-0.5 md:hidden">{projs.slice(0, 4).map((pid) => <span key={pid} className="h-1.5 w-1.5 rounded-full" style={{ background: projects.get(pid)?.color }} />)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Pe lucrări: rând = lucrare, coloană = zi ----------------------------- */

const ACTIVE_PROJECT = ["planificata", "in_desfasurare", "suspendata"];

function JobGrid({ days, projects, assignments, onlyProject, location, employees, tasks, tz, onOpen, onMove, onPickDay }: {
  days: string[]; projects: Project[]; assignments: Assignment[]; onlyProject: string; location: string;
  employees: Map<string, Employee>; tasks: Map<string, import("@/lib/types").Task>; tz: string;
  onOpen: (a: Assignment) => void; onMove: (a: Assignment, s: Date, e: Date, emp: string, projectId?: string) => void; onPickDay: (d: string) => void;
}) {
  const today = todayIn(tz);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; cell: string | null; moved: boolean } | null>(null);
  const inDays = (a: Assignment) => days.includes(localDate(a.starts_at, tz));
  const loc = location.toLowerCase();
  const rows = projects
    .filter((p) => (!onlyProject || p.id === onlyProject))
    .filter((p) => !loc || [p.city, p.address].some((x) => (x ?? "").toLowerCase().includes(loc)))
    .filter((p) => ACTIVE_PROJECT.includes(p.status) || assignments.some((a) => a.project_id === p.id && inDays(a)))
    .map((p) => ({ p, count: assignments.filter((a) => a.project_id === p.id && inDays(a)).length }))
    .sort((x, y) => (y.count > 0 ? 1 : 0) - (x.count > 0 ? 1 : 0) || x.p.name.localeCompare(y.p.name, "ro"));

  function onDown(e: React.PointerEvent, a: Assignment) {
    if (e.pointerType !== "mouse") return; // pe telefon: atingere = deschide detaliile
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: a.id, x: e.clientX, y: e.clientY, dx: 0, dy: 0, cell: null, moved: false });
  }
  function onMoveEv(e: React.PointerEvent) {
    if (!drag) return;
    const el = document.elementsFromPoint(e.clientX, e.clientY).find((x) => (x as HTMLElement).dataset?.jobcell) as HTMLElement | undefined;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    setDrag({ ...drag, dx, dy, cell: el?.dataset.jobcell ?? null, moved: drag.moved || Math.abs(dx) + Math.abs(dy) > 6 });
  }
  function onUp(a: Assignment) {
    const dr = drag; setDrag(null);
    if (!dr || !dr.moved) { onOpen(a); return; }
    if (!dr.cell) return;
    const [pid, day] = dr.cell.split("|");
    if (pid === a.project_id && day === localDate(a.starts_at, tz)) return;
    const m = moveToDate(a.starts_at, a.ends_at, day, tz);
    onMove(a, m.startsAt, m.endsAt, a.employee_id, pid);
  }

  if (rows.length === 0) return <Empty title="Nicio lucrare activă" action={<Link href="/lucrari?nou=1"><Button variant="primary">Adaugă lucrare</Button></Link>} />;

  const single = days.length === 1;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className={cx("w-full border-collapse text-sm", !single && "table-fixed")} style={single ? undefined : { minWidth: 136 + days.length * 132 }}>
        <thead>
          <tr className="bg-slate-50 text-xs text-slate-600">
            <th className="sticky left-0 z-10 w-[136px] bg-slate-50 px-2 py-2 text-left font-semibold md:w-56 md:px-3">Lucrare</th>
            {days.map((day) => (
              <th key={day} className={cx("px-2 py-2 text-left font-semibold", day === today && "text-orange-700")}>
                {single ? prettyDate(day) : <button className="hover:underline" onClick={() => onPickDay(day)}>{shortDate(day)}</button>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p }) => (
            <tr key={p.id} className="border-t border-slate-100 align-top">
              <td className="sticky left-0 z-10 bg-white py-2 pr-2 pl-3 md:px-3" style={{ boxShadow: `inset 4px 0 0 ${p.color}, 1px 0 0 #e2e8f0` }}>
                <Link href={`/lucrari/${p.id}`} className="block text-[13px] font-semibold leading-tight hover:underline md:text-sm">{p.name}</Link>
                {(p.city || p.address) && <div className="mt-0.5 flex items-start gap-1 text-xs text-slate-500"><MapPin className="mt-0.5 h-3 w-3 shrink-0" /><span className="line-clamp-2">{[p.address, p.city].filter(Boolean).join(", ")}</span></div>}
              </td>
              {days.map((day) => {
                const key = `${p.id}|${day}`;
                const items = assignments.filter((a) => a.project_id === p.id && localDate(a.starts_at, tz) === day).sort((x, y) => x.starts_at.localeCompare(y.starts_at));
                return (
                  <td key={day} data-jobcell={key}
                    className={cx("group border-l border-slate-100 p-1.5", day === today && "bg-orange-50/40", drag?.moved && drag.cell === key && "bg-orange-50 ring-2 ring-inset ring-orange-400")}>
                    <div className="space-y-1">
                      {items.map((a) => {
                        const e = employees.get(a.employee_id);
                        const isDrag = drag?.id === a.id && drag.moved;
                        return (
                          <div key={a.id} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === "Enter" && onOpen(a)}
                            onPointerDown={(ev) => onDown(ev, a)} onPointerMove={onMoveEv} onPointerUp={() => onUp(a)}
                            className={cx("cursor-pointer select-none rounded-md px-2 py-1 ring-1 ring-slate-200 hover:ring-orange-400 md:cursor-grab", isDrag && "relative z-20 shadow-lg ring-2 ring-orange-500", a.status === "anulata" && "line-through opacity-60")}
                            style={{ background: `${p.color}14`, ...(isDrag ? { transform: `translate(${drag.dx}px, ${drag.dy}px)` } : {}) }}>
                            <div className="truncate text-xs font-semibold text-slate-900">{e?.full_name ?? "—"}</div>
                            <div className="truncate text-[11px] text-slate-600">{localTime(a.starts_at, tz)}–{localTime(a.ends_at, tz)}{a.task_id ? ` · ${tasks.get(a.task_id)?.name ?? ""}` : ""}</div>
                          </div>
                        );
                      })}
                      <Link href={`/planning/aloca?lucrare=${p.id}&date=${day}`} aria-label={`Alocă la ${p.name} în ${shortDate(day)}`}
                        className={cx("flex h-7 items-center justify-center rounded-md text-xs font-semibold text-slate-400 hover:bg-orange-50 hover:text-orange-700", items.length > 0 && "md:opacity-0 md:group-hover:opacity-100")}>
                        <Plus className="h-3.5 w-3.5" />{items.length === 0 ? <span className="ml-1">Alocă</span> : null}
                      </Link>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
        Fiecare rând e o lucrare; în fiecare zi apar angajații alocați. Atinge un nume pentru detalii. Pe desktop poți trage un nume în altă zi sau pe altă lucrare.
      </p>
    </div>
  );
}
