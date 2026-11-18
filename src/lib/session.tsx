"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";
import { humanError } from "./errors";
import { isNetworkError } from "./offline";
import { nativePushToken } from "./native";
import type { AppRole, Company, Employee, Membership } from "./types";

export interface SessionValue {
  user: User;
  membership: Membership | null;
  company: Company | null;
  employee: Employee | null;
  role: AppRole | null;
  tz: string;
  isAdmin: boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Proprietarul platformei (cel care a făcut aplicația) */
  isOwner: boolean;
  /** Proprietar fără firmă activă: vede doar panoul proprietarului */
  ownerOnly: boolean;
}

const Ctx = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession în afara SessionProvider");
  return v;
}

const SESSION_CACHE = "dyas.session.cache";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "anon" }
  | { status: "suspended" }
  | { status: "ready"; user: User; membership: Membership | null; company: Company | null; employee: Employee | null; isOwner: boolean; ownerOnly: boolean };

export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: (s: { status: "loading" | "error" | "anon" | "suspended"; message?: string; retry: () => void }) => ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    const sb = supabase();
    // fără semnal: folosim sesiunea de pe telefon și ultimele date salvate
    const offlineFallback = async (): Promise<boolean> => {
      const { data } = await sb.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return false;
      try {
        const c = JSON.parse(localStorage.getItem(SESSION_CACHE) ?? "null") as (Omit<Extract<State, { status: "ready" }>, "status">) | null;
        if (c && c.user.id === uid) { setState({ status: "ready", ...c }); return true; }
      } catch { /* ignoră */ }
      return false;
    };
    try {
      const { data: u, error: ue } = await sb.auth.getUser();
      if (ue && isNetworkError(ue) && await offlineFallback()) return;
      if (ue || !u.user) { setState({ status: "anon" }); return; }
      const [{ data: m, error: me }, own] = await Promise.all([
        sb.from("memberships").select("*").eq("user_id", u.user.id).maybeSingle(),
        sb.rpc("is_platform_owner"),
      ]);
      if (me) throw me;
      const isOwner = own.data === true;
      if (m) {
        const st = await sb.rpc("my_company_status");
        if (st.data === "suspendat") {
          // proprietarul păstrează panoul chiar dacă firma lui e suspendată
          if (isOwner) { setState({ status: "ready", user: u.user, membership: null, company: null, employee: null, isOwner, ownerOnly: true }); return; }
          setState({ status: "suspended" }); return;
        }
      }
      let company: Company | null = null, employee: Employee | null = null;
      if (m) {
        const [c, e] = await Promise.all([
          sb.from("companies").select("*").eq("id", m.company_id).single(),
          m.employee_id ? sb.from("employees").select("*").eq("id", m.employee_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        ]);
        if (c.error) throw c.error;
        if (e.error) throw e.error;
        company = c.data as Company;
        employee = (e.data as Employee) ?? null;
      }
      const ready = { user: u.user, membership: (m as Membership) ?? null, company, employee, isOwner, ownerOnly: isOwner && !m };
      try { localStorage.setItem(SESSION_CACHE, JSON.stringify(ready)); } catch { /* ignoră */ }
      setState({ status: "ready", ...ready });
    } catch (err) {
      if (isNetworkError(err) && await offlineFallback()) return;
      setState({ status: "error", message: humanError(err) });
    }
  }, []);

  useEffect(() => {
    void load();
    const { data } = supabase().auth.onAuthStateChange((ev) => {
      if (ev === "SIGNED_OUT") setState({ status: "anon" });
    });
    return () => data.subscription.unsubscribe();
  }, [load]);

  const signOut = useCallback(async () => {
    // telefonul nu mai primește notificările acestui cont
    const t = nativePushToken();
    if (t) await supabase().from("push_subscriptions").delete().eq("endpoint", `fcm:${t}`).then(undefined, () => undefined);
    await supabase().auth.signOut();
    window.location.href = "/login";
  }, []);

  if (state.status !== "ready") return <>{fallback({ status: state.status, message: state.status === "error" ? state.message : undefined, retry: () => void load() })}</>;

  const value: SessionValue = {
    user: state.user,
    membership: state.membership,
    company: state.company,
    employee: state.employee,
    role: state.membership?.role ?? null,
    tz: state.company?.timezone ?? "Europe/Bucharest",
    isAdmin: state.membership?.role === "admin",
    isOwner: state.isOwner,
    ownerOnly: state.ownerOnly,
    reload: load,
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
