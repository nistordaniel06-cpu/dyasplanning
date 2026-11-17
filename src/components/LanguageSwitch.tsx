"use client";
import { useEffect, useState } from "react";
import { getLang, setLang, type Lang } from "@/lib/lang";
import { cx } from "./ui";

/** Comutator RO / EN. */
export function LanguageSwitch({ className }: { className?: string }) {
  const [lang, setL] = useState<Lang | null>(null);
  useEffect(() => setL(getLang()), []);
  return (
    <div data-no-i18n role="group" aria-label="Language / Limba" className={cx("inline-flex shrink-0 rounded-lg border border-slate-300 bg-white p-0.5 text-xs font-bold", className)}>
      {(["ro", "en"] as const).map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} onClick={() => { if (lang !== l) void setLang(l); }}
          className={cx("rounded-md px-2 py-1", lang === l ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100")}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
