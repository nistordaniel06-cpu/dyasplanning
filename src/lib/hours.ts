/** Minute efectiv lucrate = durata - pauzele neplătite (identic cu coloana generată din DB). */
export function workedMinutes(startIso: string | Date, endIso: string | Date, breakMinutes: number): number {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Math.trunc(ms / 60000) - (breakMinutes || 0);
}

/** "7h 30m" / "45m" / "0h". */
export function formatMinutes(min: number): string {
  const sign = min < 0 ? "−" : "";
  const a = Math.abs(Math.round(min));
  const h = Math.floor(a / 60), m = a % 60;
  if (h === 0 && m === 0) return "0h";
  if (h === 0) return `${sign}${m}m`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${String(m).padStart(2, "0")}m`;
}

/** Ore zecimale pentru export: 7.5 → "7,50". */
export function decimalHours(min: number): string {
  return (min / 60).toFixed(2).replace(".", ",");
}

export interface ShiftValidation {
  ok: boolean;
  error?: string;
  minutes: number;
}

export function validateShift(startIso: Date | string, endIso: Date | string, breakMinutes: number): ShiftValidation {
  const total = workedMinutes(startIso, endIso, 0);
  if (!Number.isFinite(total)) return { ok: false, error: "Oră invalidă.", minutes: 0 };
  if (total <= 0) return { ok: false, error: "Ora de sfârșit trebuie să fie după ora de început.", minutes: 0 };
  if (total > 24 * 60) return { ok: false, error: "Un interval nu poate depăși 24 de ore.", minutes: 0 };
  if (breakMinutes < 0) return { ok: false, error: "Pauza nu poate fi negativă.", minutes: 0 };
  if (breakMinutes >= total) return { ok: false, error: "Pauza nu poate fi mai lungă decât intervalul.", minutes: 0 };
  return { ok: true, minutes: total - breakMinutes };
}
