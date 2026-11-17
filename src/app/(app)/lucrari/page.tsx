"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MapPin, Plus, Search } from "lucide-react";
import { RequireRole } from "@/components/shell";
import { Button, Empty, ErrorBox, Input, Loading, PageHeader, ProgressBar, Select, StatusBadge } from "@/components/ui";
import { ProjectForm } from "@/components/ProjectForm";
import { useQuery } from "@/lib/useQuery";
import { byId, loadEmployees, loadProjects, loadTasks } from "@/lib/data";
import { PROJECT_STATUS } from "@/lib/labels";
import type { ProjectStatus } from "@/lib/types";

export default function LucrariPage() {
  return <RequireRole roles={["admin"]}><Suspense fallback={<Loading />}><Lucrari /></Suspense></RequireRole>;
}

function Lucrari() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | "active" | ProjectStatus>("active");
  const [formOpen, setFormOpen] = useState(false);
  const urlParams = useSearchParams();
  useEffect(() => { if (urlParams.get("nou")) setFormOpen(true); }, [urlParams]);

  const q = useQuery(async () => {
    const [projects, tasks, employees] = await Promise.all([loadProjects(), loadTasks(), loadEmployees()]);
    return { projects, tasks, employees };
  }, []);
  const employees = useMemo(() => byId(q.data?.employees), [q.data]);

  const list = (q.data?.projects ?? []).filter((p) =>
    (status === "" || (status === "active" ? ["planificata", "in_desfasurare", "suspendata"].includes(p.status) : p.status === status)) &&
    (!search || `${p.name} ${p.client_name ?? ""} ${p.address ?? ""} ${p.city ?? ""}`.toLowerCase().includes(search.toLowerCase())));

  return (
    <div>
      <PageHeader title="Lucrări" subtitle="Proiecte și șantiere"
        actions={<Button variant="primary" onClick={() => setFormOpen(true)} disabled={!q.data}><Plus className="h-4 w-4" /> Adaugă lucrare</Button>} />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-slate-400" /><Input className="pl-9" placeholder="Caută după nume, client, adresă" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Select className="sm:w-56" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
          <option value="active">Active (planificate, în desfășurare, suspendate)</option>
          <option value="">Toate</option>
          {Object.entries(PROJECT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
      </div>
      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <Loading />}
      {q.data && q.data.projects.length === 0 && (
        <Empty title="Nu ai adăugat încă nicio lucrare" action={<Button variant="primary" onClick={() => setFormOpen(true)}>Adaugă lucrare</Button>}>
          O lucrare reprezintă un proiect sau un șantier, cu adresă, client, perioadă și misiuni.
        </Empty>
      )}
      {q.data && q.data.projects.length > 0 && list.length === 0 && <Empty title="Nicio lucrare pentru filtrele alese" />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((p) => {
          const pt = q.data!.tasks.filter((t) => t.project_id === p.id);
          const progress = pt.length ? Math.round(pt.reduce((s, t) => s + t.progress, 0) / pt.length) : 0;
          return (
            <Link key={p.id} href={`/lucrari/${p.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-orange-300" style={{ borderTop: `5px solid ${p.color}` }}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{p.name}</h2>
                <StatusBadge s={PROJECT_STATUS[p.status]} />
              </div>
              {(p.address || p.city) && <p className="mt-1 flex items-center gap-1 text-sm text-slate-600"><MapPin className="h-3.5 w-3.5" />{[p.address, p.city].filter(Boolean).join(", ")}</p>}
              <p className="mt-1 text-sm text-slate-600">{p.client_name ? `Client: ${p.client_name}` : "Fără client"}{p.manager_employee_id ? ` · Resp.: ${employees.get(p.manager_employee_id)?.full_name ?? "—"}` : ""}</p>
              <p className="mt-1 text-xs text-slate-500">{p.start_date ?? "?"} → {p.due_date ?? "?"} · {pt.length} misiuni</p>
              <div className="mt-3"><ProgressBar value={progress} /></div>
            </Link>
          );
        })}
      </div>
      {formOpen && q.data && (
        <ProjectForm employees={q.data.employees} usedColors={q.data.projects.map((p) => p.color)} onClose={() => setFormOpen(false)}
          onSaved={(p) => { setFormOpen(false); window.location.href = `/lucrari/${p.id}`; }} />
      )}
    </div>
  );
}
