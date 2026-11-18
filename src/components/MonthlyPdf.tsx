"use client";
import { useState } from "react";
import { FileDown } from "lucide-react";
import { useSession } from "@/lib/session";
import { humanError } from "@/lib/errors";
import { byId, loadAbsences, loadEmployees, loadProjects, loadTasks, loadTimeEntries } from "@/lib/data";
import { addMonths, endOfMonth, monthLabel, rangeUtc, startOfMonth, todayIn } from "@/lib/time";
import { buildMonthSheet } from "@/lib/timesheet";
import { monthlyPdf, shareOrSave } from "@/lib/pdf";
import type { Employee } from "@/lib/types";
import { Button, ErrorBox, Field, Modal, Notice, Select } from "./ui";

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();

/** Buton „PDF lunar” + fereastra de alegere (luna, angajatul). */
export function MonthlyPdfButton({ employees, employeeId, variant }: { employees?: Employee[]; employeeId?: string; variant?: "primary" | "secondary" }) {
  const { tz, company } = useSession();
  const thisMonth = startOfMonth(todayIn(tz));
  // implicit luna trecută în primele zile ale lunii (când se trimite la contabilitate)
  const [month, setMonth] = useState(Number(todayIn(tz).slice(8, 10)) <= 10 ? addMonths(thisMonth, -1) : thisMonth);
  const [who, setWho] = useState(employeeId ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const months = Array.from({ length: 13 }, (_, i) => addMonths(thisMonth, -i));

  async function make() {
    setBusy(true); setErr(null); setEmpty(false);
    try {
      const from = month, to = endOfMonth(month);
      const [f, t] = rangeUtc(from, to, tz);
      const [emps, projects, tasks, entries, absences] = await Promise.all([
        employees ? Promise.resolve(employees) : loadEmployees({ includeInactive: true }),
        loadProjects(), loadTasks(), loadTimeEntries(f, t, { employeeId: who || undefined }), loadAbsences(from, to),
      ]);
      const pMap = byId(projects), tMap = byId(tasks);
      const chosen = who ? emps.filter((e) => e.id === who)
        // toți: angajații activi + cei inactivi care au ore în luna aleasă
        : emps.filter((e) => e.active || entries.some((x) => x.employee_id === e.id)).sort((a, b) => a.full_name.localeCompare(b.full_name, "ro"));
      const sheets = chosen.map((employee) => buildMonthSheet({ employee, month, entries, absences, projects: pMap, tasks: tMap, tz }))
        .filter((s) => who || s.workedDays > 0 || Object.keys(s.absenceDays).length > 0);
      if (sheets.length === 0) { setEmpty(true); return; }
      const blob = await monthlyPdf({ companyName: company?.name ?? "", sheets });
      const name = `pontaj_${month.slice(0, 7)}_${who ? slug(chosen[0]?.full_name ?? "angajat") : "toti_angajatii"}.pdf`;
      await shareOrSave(name, blob, `${monthLabel(month)} — ${company?.name ?? ""}`);
      setOpen(false);
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant={variant} onClick={() => { setErr(null); setEmpty(false); setOpen(true); }}><FileDown className="h-4 w-4" />PDF lunar</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Raport lunar PDF"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Renunță</Button><Button onClick={make} disabled={busy}>{busy ? "Se pregătește…" : "Descarcă PDF"}</Button></>}>
        <div className="space-y-3">
          <Field label="Luna">
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
            </Select>
          </Field>
          {!employeeId && (
            <Field label="Angajat">
              <Select value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Toți angajații (o pagină pentru fiecare)</option>
                {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.full_name}{e.active ? "" : " (inactiv)"}</option>)}
              </Select>
            </Field>
          )}
          <Notice tone="blue">Foaia are fiecare zi din lună, lucrarea, intervalul, pauza și orele, plus totalul de ore aprobate și locul pentru semnături. Gata de trimis la contabilitate.</Notice>
          {empty && <Notice tone="amber">Nu există ore sau absențe în luna aleasă.</Notice>}
          {err && <ErrorBox message={err} />}
        </div>
      </Modal>
    </>
  );
}
