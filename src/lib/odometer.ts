import { localeTag } from "@/lib/lang";
import type { OdometerKind, OdometerReading } from "./types";

export const KIND_LABEL: Record<OdometerKind, string> = { munca: "Ajuns la muncă", acasa: "Ajuns acasă" };
const kindOf = (r: OdometerReading): OdometerKind => r.kind ?? "munca";
/** Ordinea în timp: zi, apoi „la muncă” înainte de „acasă”. */
export const readingOrder = (a: OdometerReading, b: OdometerReading) =>
  a.reading_date.localeCompare(b.reading_date) || (kindOf(a) === kindOf(b) ? 0 : kindOf(a) === "munca" ? -1 : 1);

/** Ce acoperă km de la o citire la următoarea. */
export function segmentLabel(r: { kind?: OdometerKind; nextKind?: OdometerKind | null; spanDays?: number | null }): string {
  if (!r.nextKind) return "";
  const from = r.kind ?? "munca";
  if (from === "munca" && r.nextKind === "acasa" && r.spanDays === 0) return "muncă → acasă";
  if (from === "acasa" && r.nextKind === "munca" && r.spanDays === 1) return "acasă → muncă";
  if (from === "munca" && r.nextKind === "munca" && r.spanDays === 1) return "de pe o zi pe alta";
  return r.spanDays && r.spanDays > 1 ? `${r.spanDays} zile` : "";
}
import { diffDays } from "./time";

export interface ReadingWithDistance extends OdometerReading {
  /** km parcurși de la această citire până la următoarea (null = încă nu există citirea următoare) */
  distance: number | null;
  nextDate: string | null;
  nextKind: OdometerKind | null;
  /** câte zile acoperă diferența (1 = de pe o zi pe alta) */
  spanDays: number | null;
}

/**
 * Km parcurși = citirea următoare − citirea curentă, pe aceeași mașină.
 * Distanța se atribuie zilei (și șoferului) citirii curente: a doua zi, când se introduce noua citire,
 * aplicația calculează câți km s-au făcut în ziua precedentă.
 */
export function withDistances(readings: OdometerReading[]): ReadingWithDistance[] {
  const byVehicle = new Map<string, OdometerReading[]>();
  for (const r of readings) byVehicle.set(r.vehicle_id, [...(byVehicle.get(r.vehicle_id) ?? []), r]);
  const out: ReadingWithDistance[] = [];
  for (const list of byVehicle.values()) {
    list.sort(readingOrder);
    list.forEach((r, i) => {
      const next = list[i + 1];
      out.push({
        ...r,
        distance: next ? next.km - r.km : null,
        nextDate: next?.reading_date ?? null,
        nextKind: next ? kindOf(next) : null,
        spanDays: next ? diffDays(next.reading_date, r.reading_date) : null,
      });
    });
  }
  return out.sort((a, b) => -readingOrder(a, b) || a.vehicle_id.localeCompare(b.vehicle_id));
}

export function sumBy<T>(rows: ReadingWithDistance[], key: (r: ReadingWithDistance) => T): Map<T, number> {
  const m = new Map<T, number>();
  for (const r of rows) if (r.distance !== null) m.set(key(r), (m.get(key(r)) ?? 0) + r.distance);
  return m;
}

export function formatKm(n: number): string {
  return `${n.toLocaleString(localeTag())} km`;
}
