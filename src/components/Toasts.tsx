"use client";
import { useRouter } from "next/navigation";
import { Bell, X } from "lucide-react";
import { useUnread } from "@/lib/unread";

/** Notificările care apar pe ecran când aplicația e deschisă (mesaje chat, pontaje, km, program etc.). */
export function Toasts() {
  const { toasts, dismiss } = useUnread();
  const router = useRouter();
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[60] flex flex-col items-center gap-2 px-3" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border border-orange-200 bg-white p-3 shadow-lg">
          <button className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => { dismiss(t.id); router.push(t.url); }}>
            <span className="mt-0.5 rounded-full bg-orange-100 p-1.5 text-orange-700"><Bell className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-slate-900">{t.title}</span>
              {t.body && <span className="mt-0.5 line-clamp-2 block text-sm text-slate-600">{t.body}</span>}
            </span>
          </button>
          <button aria-label="Închide" className="rounded p-1 text-slate-400 hover:text-slate-700" onClick={() => dismiss(t.id)}><X className="h-4 w-4" /></button>
        </div>
      ))}
    </div>
  );
}
