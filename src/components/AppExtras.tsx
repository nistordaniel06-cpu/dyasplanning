"use client";
// Ajutor, „Ce e nou” și modul mentenanță — părțile vizibile utilizatorilor.
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Construction, LifeBuoy, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { Button, Modal, cx } from "./ui";

export function HelpLink({ className }: { className?: string }) {
  const path = usePathname();
  return (
    <Link href={`/ajutor?din=${encodeURIComponent(path)}`} aria-label="Ajutor" title="Ajutor"
      className={cx("rounded-lg p-2 text-slate-700 hover:bg-slate-100", className)}>
      <LifeBuoy className="h-6 w-6" />
    </Link>
  );
}

interface News { id: string; title: string; body: string; created_at: string }

/** Fereastra „Ce e nou”: apare o singură dată pentru noutățile publicate de proprietar. */
export function WhatsNew() {
  const s = useSession();
  const [news, setNews] = useState<News[]>([]);
  useEffect(() => {
    if (s.ownerOnly || !s.membership) return;
    void supabase().rpc("my_news").then(({ data }) => setNews((data as News[] | null) ?? []));
  }, [s.ownerOnly, s.membership]);
  if (news.length === 0) return null;
  const close = () => { setNews([]); void supabase().rpc("mark_news_seen").then(() => undefined); };
  return (
    <Modal open onClose={close} title="Ce e nou"
      footer={<Button variant="primary" onClick={close}>Am înțeles</Button>}>
      <ul className="space-y-4">
        {news.map((n) => (
          <li key={n.id}>
            <div className="flex items-center gap-2 font-bold"><Sparkles className="h-4 w-4 shrink-0 text-orange-600" /><span data-no-i18n>{n.title}</span></div>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-700" data-no-i18n>{n.body}</p>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

interface Status { maintenance: boolean; message: string | null; until: string | null; assistant?: boolean }

// o singură verificare pentru toată aplicația (mentenanță + asistent), la 60 s și la revenirea în aplicație
let statusCache: Status | null = null;
const statusSubs = new Set<(s: Status) => void>();
let statusTimer: ReturnType<typeof setInterval> | null = null;
function refreshStatus() {
  void supabase().rpc("app_status").then(({ data }) => {
    if (!data) return;
    statusCache = data as Status;
    statusSubs.forEach((f) => f(statusCache!));
  });
}
function startStatus() {
  if (statusTimer) return;
  refreshStatus();
  statusTimer = setInterval(refreshStatus, 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshStatus(); });
  window.addEventListener("dyas-status", refreshStatus);
}

export function useAppStatus(): Status | null {
  const [st, setSt] = useState<Status | null>(statusCache);
  useEffect(() => {
    startStatus();
    statusSubs.add(setSt);
    return () => { statusSubs.delete(setSt); };
  }, []);
  return st;
}

/** Asistentul AI e pornit pentru firma asta (și global)? */
export function useAssistantEnabled(): boolean {
  const s = useSession();
  const st = useAppStatus();
  return s.membership?.role === "admin" && s.company?.assistant_enabled !== false && st?.assistant !== false;
}

export function MaintenanceScreen({ status }: { status: Status }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-50 p-6 text-center" role="alert">
      <div className="max-w-sm">
        <Construction className="mx-auto h-14 w-14 text-orange-600" />
        <h1 className="mt-4 text-xl font-bold">Aplicația se actualizează</h1>
        <p className="mt-2 text-slate-700" data-no-i18n>{status.message ?? "Revine în câteva minute."}</p>
        {status.until && <p className="mt-2 text-sm text-slate-500">Estimăm că revine la {new Date(status.until).toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" })}.</p>}
        <p className="mt-4 text-xs text-slate-500">Datele tale sunt în siguranță. Pagina se reîncarcă singură.</p>
      </div>
    </div>
  );
}

/** În aplicație: utilizatorii văd ecranul de mentenanță; proprietarii doar o bară de avertizare. */
export function MaintenanceGate() {
  const s = useSession();
  const st = useAppStatus();
  if (!st?.maintenance) return null;
  if (s.isOwner) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
        <Construction className="h-5 w-5 shrink-0" />
        <span className="flex-1"><strong>Mod mentenanță pornit.</strong> Utilizatorii firmelor nu pot folosi aplicația.</span>
        <Link href="/proprietar?tab=platforma" className="font-semibold underline">Oprește</Link>
      </div>
    );
  }
  return <MaintenanceScreen status={st} />;
}
