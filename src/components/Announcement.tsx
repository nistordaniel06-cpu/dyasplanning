"use client";
import { useEffect, useState } from "react";
import { Megaphone, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { cx } from "./ui";

interface Ann { id: string; title: string; body: string | null; tone: "info" | "warning" }
const KEY = "dyas.ann.closed";

/** Anunțul proprietarului aplicației, afișat sus la toate firmele (se poate închide). */
export function AnnouncementBar() {
  const [a, setA] = useState<Ann | null>(null);
  useEffect(() => {
    void supabase().rpc("current_announcement").then(({ data }) => {
      const row = (data as Ann[] | null)?.[0];
      if (!row) return;
      let closed = "";
      try { closed = localStorage.getItem(KEY) ?? ""; } catch { /* ignoră */ }
      if (closed !== row.id) setA(row);
    });
  }, []);
  if (!a) return null;
  const warn = a.tone === "warning";
  return (
    <div className={cx("mb-4 flex items-start gap-3 rounded-xl border p-3 text-sm", warn ? "border-amber-300 bg-amber-50 text-amber-950" : "border-blue-200 bg-blue-50 text-blue-950")}>
      <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{a.title}</div>
        {a.body && <div className="mt-0.5 whitespace-pre-line">{a.body}</div>}
      </div>
      <button aria-label="Închide anunțul" className="rounded p-1 opacity-60 hover:opacity-100"
        onClick={() => { try { localStorage.setItem(KEY, a.id); } catch { /* ignoră */ } setA(null); }}><X className="h-4 w-4" /></button>
    </div>
  );
}
