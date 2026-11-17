"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "./supabase/client";

export interface Toast { id: string; title: string; body: string; url: string }
interface Unread { notifications: number; chat: number; refresh: () => void; toasts: Toast[]; dismiss: (id: string) => void }
const Ctx = createContext<Unread>({ notifications: 0, chat: 0, refresh: () => {}, toasts: [], dismiss: () => {} });
export const useUnread = () => useContext(Ctx);

/** Necititele (notificări + chat): la intervale, la revenirea în aplicație și la evenimente în timp real. */
export function UnreadProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, setState] = useState({ notifications: 0, chat: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback((t: Toast) => {
    setToasts((cur) => (cur.some((x) => x.id === t.id) ? cur : [t, ...cur].slice(0, 3)));
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== t.id)), 7000);
  }, []);
  const pushRef = useRef(push);
  const prevN = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    const { data, error } = await supabase().rpc("my_unread_counts");
    if (error || !data) return;
    const n = Number((data as { notifications: number }).notifications) || 0;
    setState({ notifications: n, chat: Number((data as { chat: number }).chat) || 0 });
    // rezervă fără timp real: o notificare nouă apare pe ecran și la verificarea periodică
    if (prevN.current !== null && n > prevN.current) {
      const { data: last } = await supabase().from("notifications").select("id,title,body,url").is("read_at", null).order("created_at", { ascending: false }).limit(1);
      const r = (last as { id: string; title: string; body: string | null; url: string | null }[] | null)?.[0];
      if (r) pushRef.current({ id: r.id, title: r.title, body: r.body ?? "", url: r.url ?? "/notificari" });
    }
    prevN.current = n;
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 30000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const ch = supabase().channel(`unread-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, (p) => {
        void refresh();
        const n = p.new as { id?: string; title?: string; body?: string | null; url?: string | null };
        if (n?.id && n.title) push({ id: n.id, title: n.title, body: n.body ?? "", url: n.url ?? "/notificari" });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (p) => {
        void refresh();
        const m = p.new as { id?: string; user_id?: string; author_name?: string; body?: string; channel_id?: string };
        if (!m?.id || m.user_id === userId) return;
        const here = window.location.pathname.startsWith("/chat") && new URLSearchParams(window.location.search).get("c") === m.channel_id;
        if (!here) push({ id: m.id, title: `Mesaj nou de la ${m.author_name ?? "un coleg"}`, body: (m.body ?? "").slice(0, 140), url: `/chat?c=${m.channel_id}` });
      })
      .subscribe();
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); void supabase().removeChannel(ch); };
  }, [refresh, push, userId]);

  return <Ctx.Provider value={{ ...state, refresh, toasts, dismiss }}>{children}</Ctx.Provider>;
}
