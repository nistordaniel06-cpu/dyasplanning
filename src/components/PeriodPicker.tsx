"use client";
import { addDays, endOfMonth, startOfMonth, startOfWeek, todayIn, addMonths } from "@/lib/time";
import { Input, Select } from "./ui";

export type Preset = "azi" | "saptamana" | "saptamana_trecuta" | "luna" | "luna_trecuta" | "custom";

export function presetRange(p: Preset, tz: string, custom: [string, string]): [string, string] {
  const t = todayIn(tz);
  switch (p) {
    case "azi": return [t, t];
    case "saptamana": return [startOfWeek(t), addDays(startOfWeek(t), 6)];
    case "saptamana_trecuta": return [addDays(startOfWeek(t), -7), addDays(startOfWeek(t), -1)];
    case "luna": return [startOfMonth(t), endOfMonth(t)];
    case "luna_trecuta": { const m = addMonths(t, -1); return [startOfMonth(m), endOfMonth(m)]; }
    default: return custom;
  }
}

export function PeriodPicker({ preset, onPreset, custom, onCustom }: { preset: Preset; onPreset: (p: Preset) => void; custom: [string, string]; onCustom: (c: [string, string]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={preset} onChange={(e) => onPreset(e.target.value as Preset)} className="w-auto" aria-label="Perioadă">
        <option value="azi">Azi</option>
        <option value="saptamana">Săptămâna aceasta</option>
        <option value="saptamana_trecuta">Săptămâna trecută</option>
        <option value="luna">Luna aceasta</option>
        <option value="luna_trecuta">Luna trecută</option>
        <option value="custom">Perioadă personalizată</option>
      </Select>
      {preset === "custom" && (
        <>
          <Input type="date" className="w-auto" value={custom[0]} onChange={(e) => onCustom([e.target.value, custom[1]])} aria-label="De la" />
          <Input type="date" className="w-auto" value={custom[1]} min={custom[0]} onChange={(e) => onCustom([custom[0], e.target.value])} aria-label="Până la" />
        </>
      )}
    </div>
  );
}
