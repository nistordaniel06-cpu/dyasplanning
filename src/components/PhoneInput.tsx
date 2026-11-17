"use client";
import { COUNTRIES, flag, type Country } from "@/lib/countries";
import { ChevronDown } from "lucide-react";
import { Input, cx } from "./ui";

/** Telefon cu alegerea țării (prefix). Numărul se poate scrie și direct cu +prefix. */
export function PhoneInput({ country, local, onCountry, onLocal, label, placeholder, autoComplete, required, showCountry = true, inputMode = "tel" }: {
  country: Country; local: string; onCountry: (c: Country) => void; onLocal: (v: string) => void; label: string;
  placeholder?: string; autoComplete?: string; required?: boolean; showCountry?: boolean; inputMode?: "tel" | "email";
}) {
  const typedPrefix = local.trim().startsWith("+") || local.replace(/\D/g, "").startsWith("00");
  return (
    <div className="flex gap-2">
      {showCountry && (
        <div key="country" className={cx("relative w-[6.5rem] shrink-0 [&:focus-within>div]:border-orange-500 [&:focus-within>div]:ring-2 [&:focus-within>div]:ring-orange-200", typedPrefix && "opacity-50")}>
          {/* afișaj clar (steag + prefix); selectul nativ e deasupra, invizibil, ca lista de țări să fie cea a telefonului */}
          <div aria-hidden className="flex h-11 items-center justify-between rounded-lg border border-slate-300 bg-white px-3 text-base">
            <span className="whitespace-nowrap">{flag(country.code)} +{country.dial}</span>
            <ChevronDown className="h-4 w-4 text-slate-500" />
          </div>
          <select aria-label="Țara" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={country.code} disabled={typedPrefix}
            onChange={(e) => onCountry(COUNTRIES.find((c) => c.code === e.target.value) ?? COUNTRIES[0])}>
            {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{flag(c.code)} +{c.dial} · {c.name}</option>)}
          </select>
        </div>
      )}
      <Input key="number" aria-label={label} type={inputMode === "email" ? "text" : "tel"} inputMode={inputMode} autoComplete={autoComplete}
        required={required} className="min-w-0 flex-1" value={local} onChange={(e) => onLocal(e.target.value)}
        placeholder={placeholder ?? (!showCountry ? undefined : country.code === "RO" ? "0722 123 456" : "număr de telefon")} />
    </div>
  );
}
