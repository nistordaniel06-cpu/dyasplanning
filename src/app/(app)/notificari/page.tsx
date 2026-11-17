"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Bell } from "lucide-react";
import { Button, Empty, ErrorBox, Loading, PageHeader, cx } from "@/components/ui";
import { AppSetupCard } from "@/components/AppSetup";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { useUnread } from "@/lib/unread";
import { supabase } from "@/lib/supabase/client";
import { fmt } from "@/lib/time";

interface Notif { id: string; kind: string; title: string; body: string | null; url: string | null; read_at: string | null; created_at: string }

export default function NotificariPage() {
  const { tz, user } = useSession();
  const unread = useUnread();
  const q = useQuery(async () => must(await supabase().from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100)) as Notif[], [user.id]);

  async function markAll() {
    await supabase().from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
    await q.reload(); unread.refresh();
  }
  // deschiderea paginii marchează notificările ca citite (după ce au fost afișate)
  useEffect(() => {
    if (q.data?.some((n) => !n.read_at)) {
      const t = setTimeout(() => void markAll(), 1500);
      return () => clearTimeout(t);
    }
  }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Notificări" actions={q.data?.some((n) => !n.read_at) ? <Button size="sm" onClick={markAll}>Marchează toate citite</Button> : undefined} />
      <AppSetupCard compact />
      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.loading && !q.data && <Loading />}
      {q.data && q.data.length === 0 && <Empty title="Nu ai notificări">Aici apar modificările de program și pontajele respinse.</Empty>}
      <ul className="space-y-2">
        {q.data?.map((n) => (
          <li key={n.id}>
            <Link href={n.url ?? "/"} className={cx("flex gap-3 rounded-xl border bg-white p-3", n.read_at ? "border-slate-200" : "border-orange-300 bg-orange-50")}>
              <Bell className={cx("mt-0.5 h-5 w-5 shrink-0", n.read_at ? "text-slate-400" : "text-orange-600")} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{n.title}</span>
                  <span className="shrink-0 text-xs text-slate-500">{fmt(n.created_at, tz, "dd.MM HH:mm")}</span>
                </div>
                {n.body && <p className="text-sm text-slate-700">{n.body}</p>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
