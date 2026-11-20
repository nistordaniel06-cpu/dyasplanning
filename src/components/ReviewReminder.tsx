"use client";
// Spre finalul zilei: amintește șefului de echipă / administratorului să valideze programul de azi.
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { fmt, rangeUtc, todayIn } from "@/lib/time";
import type { TimeEntry } from "@/lib/types";

export function ReviewReminder() {
  const { tz, isAdmin, role, employee } = useSession();
  const show = isAdmin || role === "sef_echipa";
  const hour = Number(fmt(new Date(), tz, "H"));
  const q = useQuery(async () => {
    if (!show || hour < 15) return 0;
    const today = todayIn(tz);
    const [f, t] = rangeUtc(today, today, tz);
    const rows = must(await supabase().from("time_entries").select("id, status, validated_at, employee_id").gte("started_at", f).lt("started_at", t).neq("status", "aprobat")) as Pick<TimeEntry, "id" | "status" | "validated_at" | "employee_id">[];
    return rows.filter((r) => r.status !== "respins" && (isAdmin || (!r.validated_at && r.employee_id !== employee?.id))).length;
  }, [show, hour, tz, isAdmin]);
  if (!show || !q.data) return null;
  return (
    <Link href="/validare" className="mb-4 flex items-center gap-3 rounded-2xl border-2 border-green-300 bg-green-50 p-4">
      <CheckCheck className="h-6 w-6 shrink-0 text-green-700" />
      <span className="flex-1"><strong>Validează programul de azi</strong><br /><span className="text-sm text-slate-700">{q.data} {q.data === 1 ? "pontaj așteaptă" : "pontaje așteaptă"} verificarea ta.</span></span>
      <span className="font-semibold text-green-800">Deschide →</span>
    </Link>
  );
}
