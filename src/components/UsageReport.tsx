"use client";
import { useMemo, useState } from "react";
import { Bell, Check, Smartphone } from "lucide-react";
import { Badge, Card, Empty, ErrorBox, Loading, Stat, Tabs, cx } from "./ui";
import { useQuery } from "@/lib/useQuery";
import { ROLE_LABEL } from "@/lib/labels";
import { localeTag } from "@/lib/lang";
import type { AppRole } from "@/lib/types";

export interface Usage {
  days: number;
  daily: { day: string; users: number }[];
  people: {
    employee_id: string; name: string; trade: string | null; has_account: boolean; role: AppRole | null; last_seen: string | null;
    active_days: number; installed: boolean; push: boolean; devices: number; timesheets: number; km_readings: number;
    assignments: number; messages: number;
  }[];
}

type Level = "activ" | "rar" | "inactiv" | "niciodata" | "fara_cont";
function level(p: Usage["people"][number]): Level {
  if (!p.has_account) return "fara_cont";
  if (!p.last_seen) return "niciodata";
  const d = (Date.now() - new Date(p.last_seen).getTime()) / 86400000;
  return d <= 2 ? "activ" : d <= 7 ? "rar" : "inactiv";
}
const LEVEL: Record<Level, { label: string; tone: "green" | "amber" | "red" | "gray" }> = {
  activ: { label: "Folosește aplicația", tone: "green" },
  rar: { label: "Intră rar", tone: "amber" },
  inactiv: { label: "Nu a mai intrat", tone: "red" },
  niciodata: { label: "Nu a intrat niciodată", tone: "red" },
  fara_cont: { label: "Fără cont", tone: "gray" },
};

function ago(iso: string | null): string {
  if (!iso) return "niciodată";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return s < 60 ? "acum" : `acum ${Math.floor(s / 60)} min`;
  if (s < 86400) return `acum ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "ieri" : d < 30 ? `acum ${d} zile` : new Date(iso).toLocaleDateString(localeTag());
}

/** Raportul de utilizare a aplicației (pentru adminul firmei sau pentru proprietar). */
export function UsageReport({ load }: { load: (days: number) => Promise<Usage> }) {
  const [days, setDays] = useState<"7" | "30">("30");
  const q = useQuery(async () => load(Number(days)), [days]);
  const u = q.data;
  const stats = useMemo(() => {
    if (!u) return null;
    const withAcc = u.people.filter((p) => p.has_account);
    return {
      total: u.people.length,
      withAcc: withAcc.length,
      active: withAcc.filter((p) => level(p) === "activ").length,
      notUsing: withAcc.filter((p) => ["inactiv", "niciodata"].includes(level(p))).length,
      installed: withAcc.filter((p) => p.installed).length,
      push: withAcc.filter((p) => p.push).length,
      today: u.daily.at(-1)?.users ?? 0,
    };
  }, [u]);
  const max = Math.max(1, ...(u?.daily.map((d) => d.users) ?? [1]));

  return (
    <div className="space-y-4">
      <Tabs value={days} onChange={setDays} items={[{ value: "7", label: "7 zile" }, { value: "30", label: "30 de zile" }]} />
      {q.loading && !u ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : u && stats && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Au intrat azi" value={stats.today} sub={`din ${stats.withAcc} cu cont`} />
            <Stat label="Folosesc aplicația" value={stats.active} sub="intrat în ultimele 2 zile" />
            <Stat label="Nu mai intră" value={stats.notUsing} sub="de peste 7 zile sau niciodată" />
            <Stat label="Notificări pornite" value={`${stats.push} / ${stats.withAcc}`} sub={`${stats.installed} au aplicația instalată`} />
          </div>
          <Card title="Persoane care au deschis aplicația, pe zile">
            <div className="flex h-28 items-end gap-[2px] border-b border-slate-200">
              {u.daily.map((d) => (
                <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end" title={`${d.day.slice(8, 10)}.${d.day.slice(5, 7)}: ${d.users}`}>
                  {u.days <= 7 && d.users > 0 && <span className="text-[11px] font-semibold text-slate-700">{d.users}</span>}
                  <div className={cx("w-full max-w-[22px] rounded-t", d.users ? "bg-orange-500" : "bg-slate-100")} style={{ height: d.users ? `${Math.max(6, (d.users / max) * 90)}px` : "3px" }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-slate-500">
              <span>{u.daily[0]?.day.slice(8, 10)}.{u.daily[0]?.day.slice(5, 7)}</span><span>Azi</span>
            </div>
          </Card>
          <Card title={`Pe persoane (${u.people.length})`}>
            {u.people.length === 0 ? <Empty title="Nu există angajați activi" /> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {u.people.map((p) => {
                  const lv = level(p);
                  return (
                    <li key={p.employee_id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium"><span data-no-i18n>{p.name}</span>{p.role && <span className="text-xs font-normal text-slate-500"> · {ROLE_LABEL[p.role]}</span>}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                          <Badge tone={LEVEL[lv].tone}>{LEVEL[lv].label}</Badge>
                          {p.has_account && <span>ultima dată: {ago(p.last_seen)}</span>}
                          {p.installed && <span className="inline-flex items-center gap-0.5 text-green-800"><Smartphone className="h-3.5 w-3.5" />aplicație instalată</span>}
                          {p.has_account && (p.push
                            ? <span className="inline-flex items-center gap-0.5 text-green-800"><Bell className="h-3.5 w-3.5" />notificări pornite</span>
                            : <span className="inline-flex items-center gap-0.5 text-amber-800"><Bell className="h-3.5 w-3.5" />fără notificări</span>)}
                        </div>
                      </div>
                      <div className="grid shrink-0 grid-cols-4 gap-3 text-center text-xs text-slate-600 sm:w-[300px]">
                        <div><div className="text-base font-bold text-slate-900">{p.active_days}</div>zile active</div>
                        <div><div className="text-base font-bold text-slate-900">{p.timesheets}</div>pontaje</div>
                        <div><div className="text-base font-bold text-slate-900">{p.km_readings}</div>citiri km</div>
                        <div><div className="text-base font-bold text-slate-900">{p.messages}</div>mesaje</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <p className="flex items-start gap-1.5 text-xs text-slate-500"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />Cine nu primește notificări nu află când i se schimbă programul. Roagă-l să deschidă aplicația și să apese „Activează notificările”.</p>
        </>
      )}
    </div>
  );
}
