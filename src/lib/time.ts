// Toate orele se stochează în UTC (timestamptz) și se afișează în fusul orar al firmei.
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { enGB, ro } from "date-fns/locale";
import { getLang } from "./lang";

/** "YYYY-MM-DD" + "HH:mm" interpretate în fusul orar `tz` → Date (UTC). */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const t = time.length === 5 ? `${time}:00` : time;
  return fromZonedTime(`${date}T${t}`, tz);
}

/** Data locală (în fusul firmei) a unui moment, ca "YYYY-MM-DD". */
export function localDate(d: Date | string, tz: string): string {
  return formatInTimeZone(new Date(d), tz, "yyyy-MM-dd");
}

/** Ora locală "HH:mm". */
export function localTime(d: Date | string, tz: string): string {
  return formatInTimeZone(new Date(d), tz, "HH:mm");
}

export function fmt(d: Date | string, tz: string, pattern: string): string {
  return formatInTimeZone(new Date(d), tz, pattern, { locale: getLang() === "en" ? enGB : ro });
}

/** Ziua de azi în fusul firmei. */
export function todayIn(tz: string): string {
  return localDate(new Date(), tz);
}

/** Aritmetică pe date calendaristice "YYYY-MM-DD" (fără ore, fără fus). */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  const pa = a.split("-").map(Number), pb = b.split("-").map(Number);
  return Math.round((Date.UTC(pa[0], pa[1] - 1, pa[2]) - Date.UTC(pb[0], pb[1] - 1, pb[2])) / 86400000);
}

/** Ziua săptămânii ISO: 1 = luni … 7 = duminică. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function startOfWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

export function startOfMonth(date: string): string {
  return date.slice(0, 8) + "01";
}

export function endOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 8)}${String(last).padStart(2, "0")}`;
}

export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return dt.toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Intervalul UTC [început, sfârșit) pentru zilele locale from..to inclusiv. */
export function rangeUtc(from: string, to: string, tz: string): [string, string] {
  return [zonedToUtc(from, "00:00", tz).toISOString(), zonedToUtc(addDays(to, 1), "00:00", tz).toISOString()];
}

/**
 * Construiește intervalul unei ture din dată + ore locale.
 * Dacă ora de sfârșit e mai mică sau egală cu cea de început, tura trece peste miezul nopții.
 */
export function shiftFromLocal(date: string, start: string, end: string, tz: string): { startsAt: Date; endsAt: Date; overnight: boolean } {
  const overnight = end <= start;
  const startsAt = zonedToUtc(date, start, tz);
  const endsAt = zonedToUtc(overnight ? addDays(date, 1) : date, end, tz);
  return { startsAt, endsAt, overnight };
}

/** Mută un interval păstrând ora locală, pe o altă zi. */
export function moveToDate(startIso: string, endIso: string, newDate: string, tz: string): { startsAt: Date; endsAt: Date } {
  const offsetDays = diffDays(newDate, localDate(startIso, tz));
  const s = localDate(startIso, tz), e = localDate(endIso, tz);
  return {
    startsAt: zonedToUtc(addDays(s, offsetDays), localTime(startIso, tz), tz),
    endsAt: zonedToUtc(addDays(e, offsetDays), localTime(endIso, tz), tz),
  };
}

/** Minute de la miezul nopții (local) pentru un moment, relativ la ziua `date`. */
export function minutesFromDayStart(iso: string, date: string, tz: string): number {
  return Math.round((new Date(iso).getTime() - zonedToUtc(date, "00:00", tz).getTime()) / 60000);
}

export function minutesToHHmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export const WEEKDAY_SHORT = ["", "Lun", "Mar", "Mie", "Joi", "Vin", "Sâm", "Dum"];
export const WEEKDAY_LONG = ["", "Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă", "Duminică"];

const EN_WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const EN_WEEKDAY_LONG = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const RO_MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (getLang() === "en") return `${EN_WEEKDAY_LONG[isoWeekday(date)]}, ${d} ${EN_MONTHS[m - 1]} ${y}`;
  return `${WEEKDAY_LONG[isoWeekday(date)]}, ${d} ${RO_MONTHS[m - 1]} ${y}`;
}

export function shortDate(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  const days = getLang() === "en" ? EN_WEEKDAY_SHORT : WEEKDAY_SHORT;
  return `${days[isoWeekday(date)]} ${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}`;
}

export function monthLabel(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const name = getLang() === "en" ? EN_MONTHS[m - 1] : RO_MONTHS[m - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`;
}

export const TIMEZONES: { value: string; label: string }[] = [
  { value: "Europe/Bucharest", label: "România (București)" },
  { value: "Europe/Amsterdam", label: "Olanda (Amsterdam)" },
  { value: "Europe/Chisinau", label: "Republica Moldova (Chișinău)" },
  { value: "Europe/Brussels", label: "Belgia (Bruxelles)" },
  { value: "Europe/Berlin", label: "Germania (Berlin)" },
  { value: "Europe/Vienna", label: "Austria (Viena)" },
  { value: "Europe/Paris", label: "Franța (Paris)" },
  { value: "Europe/Rome", label: "Italia (Roma)" },
  { value: "Europe/Madrid", label: "Spania (Madrid)" },
  { value: "Europe/London", label: "Regatul Unit (Londra)" },
  { value: "Europe/Athens", label: "Grecia (Atena)" },
  { value: "Europe/Istanbul", label: "Turcia (Istanbul)" },
  { value: "UTC", label: "UTC" },
];

/** Momentul `iso` este în intervalul [from, to)? Compară numeric (formatele ISO pot diferi: „Z” vs „+00:00”). */
export function inRange(iso: string, fromIso: string, toIso: string): boolean {
  const x = new Date(iso).getTime();
  return x >= new Date(fromIso).getTime() && x < new Date(toIso).getTime();
}
