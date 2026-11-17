"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase/client";

interface Unread { notifications: number; chat: number; refresh: () => void }
const Ctx = createContext<Unread>({ notifications: 0, chat: 0, refresh: () => {} });
export const useUnread = () => useContext(Ctx);

/** Necititele (notificări + chat): la intervale, la revenirea în aplicație și la evenimente în timp real. */
export function UnreadProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [state, setState] = useState({ notifications: 0, chat: 0 });
  const refresh = useCallback(async () => {
    const { data, error } = await supabase().rpc("my_unread_counts");
    if (!error && data) setState({ notifications: Number((data as { notifications: number }).notifications) || 0, chat: Number((data as { chat: number }).chat) || 0 });
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 30000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const ch = supabase().channel(`unread-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => void refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => void refresh())
      .subscribe();
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); void supabase().removeChannel(ch); };
  }, [refresh, userId]);

  return <Ctx.Provider value={{ ...state, refresh }}>{children}</Ctx.Provider>;
}
