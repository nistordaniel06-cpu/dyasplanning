"use client";
import { LogOut } from "lucide-react";
import { Button, Card, ErrorBox, Loading, PageHeader } from "@/components/ui";
import { AppSetupCard } from "@/components/AppSetup";
import { ChangePasswordCard } from "@/components/ChangePassword";
import { useSession } from "@/lib/session";
import { useQuery } from "@/lib/useQuery";
import { loadTeams, loadTimeEntries } from "@/lib/data";
import { ROLE_LABEL } from "@/lib/labels";
import { displayLogin } from "@/lib/phone";
import { formatMinutes } from "@/lib/hours";
import { addDays, endOfMonth, inRange, rangeUtc, startOfMonth, startOfWeek, todayIn, WEEKDAY_SHORT } from "@/lib/time";

export default function ProfilPage() {
  const { employee, role, user, company, tz, signOut } = useSession();
  const today = todayIn(tz);

  const q = useQuery(async () => {
    if (!employee) return null;
    const from = startOfWeek(today) < startOfMonth(today) ? startOfWeek(today) : startOfMonth(today);
    const end = addDays(startOfWeek(today), 6) > endOfMonth(today) ? addDays(startOfWeek(today), 6) : endOfMonth(today);
    const [f, t] = rangeUtc(from, end, tz);
    const [entries, teams] = await Promise.all([loadTimeEntries(f, t, { employeeId: employee.id }), loadTeams()]);
    return { entries, teams };
  }, [employee?.id, today, tz]);

  const sum = (from: string, to: string, statuses: string[]) => {
    const [f, t] = rangeUtc(from, to, tz);
    return (q.data?.entries ?? []).filter((e) => inRange(e.started_at, f, t) && statuses.includes(e.status)).reduce((s, e) => s + e.worked_minutes, 0);
  };
  const periods: [string, string, string][] = [["Azi", today, today], ["Săptămâna aceasta", startOfWeek(today), addDays(startOfWeek(today), 6)], ["Luna aceasta", startOfMonth(today), endOfMonth(today)]];
  const team = q.data?.teams.find((t) => t.id === employee?.team_id);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Profil" />
      <AppSetupCard />
      <Card title="Datele mele">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Nume</dt><dd className="font-semibold">{employee?.full_name ?? "—"}</dd>
          <dt className="text-slate-500">Cont</dt><dd>{displayLogin(user.email)}</dd>
          <dt className="text-slate-500">Rol</dt><dd>{role ? ROLE_LABEL[role] : "—"}</dd>
          <dt className="text-slate-500">Firmă</dt><dd>{company?.name}</dd>
          {employee && <>
            <dt className="text-slate-500">Meserie</dt><dd>{employee.trade ?? "—"}</dd>
            <dt className="text-slate-500">Telefon</dt><dd>{employee.phone ?? "—"}</dd>
            <dt className="text-slate-500">Echipă</dt><dd>{team?.name ?? "—"}</dd>
            <dt className="text-slate-500">Program obișnuit</dt>
            <dd>{employee.work_start.slice(0, 5)}–{employee.work_end.slice(0, 5)} · pauză {employee.break_minutes ?? 60} min, {[...employee.work_days].sort().map((d) => WEEKDAY_SHORT[d]).join(", ")}</dd>
            {employee.skills.length > 0 && <><dt className="text-slate-500">Competențe</dt><dd>{employee.skills.join(", ")}</dd></>}
          </>}
        </dl>
      </Card>
      {employee && (
        <Card title="Orele mele">
          {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
          {q.loading && !q.data && <Loading />}
          {q.data && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">Perioadă</th><th className="py-1 text-right">Aprobate</th><th className="py-1 text-right">Neaprobate</th></tr></thead>
              <tbody>
                {periods.map(([l, a, b]) => (
                  <tr key={l} className="border-t border-slate-100">
                    <td className="py-2">{l}</td>
                    <td className="py-2 text-right font-semibold">{formatMinutes(sum(a, b, ["aprobat"]))}</td>
                    <td className="py-2 text-right text-slate-600">{formatMinutes(sum(a, b, ["trimis", "ciorna"]))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
      {!user.email?.endsWith("@telefon.dyasplanning.app") && <ChangePasswordCard />}
      <Button size="lg" variant="danger" className="w-full" onClick={signOut}><LogOut className="h-5 w-5" /> Ieșire din cont</Button>
    </div>
  );
}
