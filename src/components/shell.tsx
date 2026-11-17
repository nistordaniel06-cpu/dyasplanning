"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  BarChart3, Bell, CalendarDays, Car, CalendarRange, ClipboardCheck, Clock, Hammer, LayoutDashboard, LogOut, Menu, MessageCircle, Settings, Sun, User, Users, X,
} from "lucide-react";
import { UnreadProvider, useUnread } from "@/lib/unread";
import { useServiceWorker } from "./AppSetup";
import { setScreenSecure, startNativePush } from "@/lib/native";
import { supabase } from "@/lib/supabase/client";
import { SessionProvider, useSession } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/labels";
import type { AppRole } from "@/lib/types";
import { Button, ErrorBox, Loading, cx } from "./ui";

interface NavItem { href: string; label: string; icon: typeof Sun }

const ADMIN_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/planning", label: "Planning", icon: CalendarRange },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/lucrari", label: "Lucrări", icon: Hammer },
  { href: "/angajati", label: "Angajați", icon: Users },
  { href: "/pontaje", label: "Pontaje", icon: ClipboardCheck },
  { href: "/rapoarte", label: "Rapoarte", icon: BarChart3 },
  { href: "/masini", label: "Mașini", icon: Car },
  { href: "/setari", label: "Setări", icon: Settings },
];
const EMPLOYEE_NAV: NavItem[] = [
  { href: "/astazi", label: "Astăzi", icon: Sun },
  { href: "/program", label: "Program", icon: CalendarDays },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/pontaj", label: "Pontaj", icon: Clock },
  { href: "/profil", label: "Profil", icon: User },
];
const LEADER_NAV: NavItem[] = [
  { href: "/astazi", label: "Astăzi", icon: Sun },
  { href: "/echipa", label: "Echipa", icon: Users },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/pontaj", label: "Pontaj", icon: Clock },
  { href: "/program", label: "Programul meu", icon: CalendarDays },
  { href: "/profil", label: "Profil", icon: User },
];

export function navFor(role: AppRole | null): NavItem[] {
  if (role === "admin") return ADMIN_NAV;
  if (role === "sef_echipa") return LEADER_NAV;
  return EMPLOYEE_NAV;
}

export function homeFor(role: AppRole | null): string {
  return role === "admin" ? "/dashboard" : "/astazi";
}

function Dot({ n, className }: { n: number; className?: string }) {
  if (!n) return null;
  return <span className={cx("min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white", className)}>{n > 99 ? "99+" : n}</span>;
}

function BellLink({ className }: { className?: string }) {
  const u = useUnread();
  return (
    <Link href="/notificari" className={cx("relative rounded-lg p-2 text-slate-700 hover:bg-slate-100", className)} aria-label={`Notificări${u.notifications ? `, ${u.notifications} necitite` : ""}`}>
      <Bell className="h-6 w-6" />
      <Dot n={u.notifications} className="absolute -right-0.5 -top-0.5" />
    </Link>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const s = useSession();
  return <UnreadProvider userId={s.user.id}><FrameInner>{children}</FrameInner></UnreadProvider>;
}

function FrameInner({ children }: { children: ReactNode }) {
  const s = useSession();
  const unread = useUnread();
  useServiceWorker();
  // Aplicația Android: capturile de ecran sunt permise doar administratorului
  useEffect(() => { void setScreenSecure(s.role !== "admin"); }, [s.role]);
  const router = useRouter();
  useEffect(() => {
    void startNativePush(
      async (token) => { await supabase().rpc("save_push_subscription", { p_endpoint: `fcm:${token}`, p_p256dh: "fcm", p_auth: "fcm", p_user_agent: "DYASPlanning Android" }); },
      (url) => router.push(url),
    );
  }, [router]);
  const path = usePathname();
  const [more, setMore] = useState(false);
  const nav = navFor(s.role);

  useEffect(() => {
    if (!s.membership) window.location.href = "/onboarding";
  }, [s.membership]);
  useEffect(() => setMore(false), [path]);

  if (!s.membership) return <Loading />;

  const active = (href: string) => path === href || path.startsWith(href + "/");
  // Pe telefon: maximum 5 butoane jos; restul în „Mai mult”.
  const mobileMain = nav.length > 5 ? nav.slice(0, 4) : nav;
  const mobileMore = nav.length > 5 ? nav.slice(4) : [];

  return (
    <div className="min-h-dvh md:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex md:sticky md:top-0 md:h-dvh">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <div className="min-w-0 flex-1">
            <div className="font-bold leading-tight">DYASPlanning</div>
            <div className="truncate text-xs text-slate-500">{s.company?.name}</div>
          </div>
          <BellLink className="-mr-2" />
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((n) => (
            <Link key={n.href} href={n.href}
              className={cx("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
                active(n.href) ? "bg-orange-50 text-orange-800" : "text-slate-700 hover:bg-slate-100")}>
              <n.icon className="h-5 w-5" aria-hidden /> <span className="flex-1">{n.label}</span>
              {n.href === "/chat" && <Dot n={unread.chat} />}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <div className="truncate text-sm font-semibold">{s.employee?.full_name ?? s.membership.display_name ?? s.user.email}</div>
          <div className="text-xs text-slate-500">{s.role ? ROLE_LABEL[s.role] : ""}</div>
          <Button size="sm" variant="ghost" className="mt-2 -ml-3" onClick={s.signOut}><LogOut className="h-4 w-4" /> Ieșire</Button>
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur md:hidden">
        <img src="/icon.svg" alt="" className="h-7 w-7" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold leading-tight">DYASPlanning</div>
          <div className="truncate text-[11px] text-slate-500">{s.company?.name}</div>
        </div>
        <BellLink />
      </header>

      <main className="min-w-0 flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-10">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid" style={{ gridTemplateColumns: `repeat(${mobileMain.length + (mobileMore.length ? 1 : 0)}, minmax(0, 1fr))` }}>
          {mobileMain.map((n) => (
            <Link key={n.href} href={n.href}
              className={cx("relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold", active(n.href) ? "text-orange-700" : "text-slate-600")}>
              <n.icon className="h-6 w-6" aria-hidden /> {n.label}
              {n.href === "/chat" && <Dot n={unread.chat} className="absolute left-1/2 top-1 ml-1" />}
            </Link>
          ))}
          {mobileMore.length > 0 && (
            <button onClick={() => setMore(true)}
              className={cx("flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold", mobileMore.some((n) => active(n.href)) ? "text-orange-700" : "text-slate-600")}>
              <Menu className="h-6 w-6" aria-hidden /> Mai mult
            </button>
          )}
        </div>
      </nav>

      {more && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 md:hidden" onClick={() => setMore(false)}>
          <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">{s.company?.name}</span>
              <button onClick={() => setMore(false)} className="p-2" aria-label="Închide"><X className="h-5 w-5" /></button>
            </div>
            {mobileMore.map((n) => (
              <Link key={n.href} href={n.href} className="flex items-center gap-3 rounded-lg px-3 py-3.5 text-base font-medium hover:bg-slate-100">
                <n.icon className="h-5 w-5" /> {n.label}
              </Link>
            ))}
            <button onClick={s.signOut} className="flex w-full items-center gap-3 rounded-lg px-3 py-3.5 text-base font-medium text-red-700 hover:bg-red-50">
              <LogOut className="h-5 w-5" /> Ieșire
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider
      fallback={({ status, message, retry }) => {
        if (status === "anon") { if (typeof window !== "undefined") window.location.href = "/login"; return <Loading />; }
        if (status === "error") return <div className="p-6"><ErrorBox message={message ?? "Eroare"} onRetry={retry} /></div>;
        return <Loading />;
      }}>
      <Frame>{children}</Frame>
    </SessionProvider>
  );
}

/** Restricționează o pagină la anumite roluri (datele sunt protejate oricum prin RLS). */
export function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const s = useSession();
  if (!s.role || !roles.includes(s.role)) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-bold">Acces restricționat</h1>
        <p className="mt-2 text-sm text-slate-600">Această secțiune nu este disponibilă pentru rolul tău.</p>
        <Link href={homeFor(s.role)} className="mt-4 inline-block font-semibold text-orange-700 underline">Înapoi</Link>
      </div>
    );
  }
  return <>{children}</>;
}

export function NeedsEmployee({ children }: { children: ReactNode }) {
  const s = useSession();
  if (!s.employee) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-bold">Contul nu este legat de o fișă de angajat</h1>
        <p className="mt-2 text-sm text-slate-600">Cere administratorului un cod de invitație legat de fișa ta.</p>
      </div>
    );
  }
  return <>{children}</>;
}
