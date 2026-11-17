import { localeTag } from "@/lib/lang";
import type { OdometerReading } from "./types";
import { diffDays } from "./time";

export interface ReadingWithDistance extends OdometerReading {
  /** km parcurși de la această citire până la următoarea (null = încă nu există citirea următoare) */
  distance: number | null;
  nextDate: string | null;
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
    list.sort((a, b) => a.reading_date.localeCompare(b.reading_date));
    list.forEach((r, i) => {
      const next = list[i + 1];
      out.push({
        ...r,
        distance: next ? next.km - r.km : null,
        nextDate: next?.reading_date ?? null,
        spanDays: next ? diffDays(next.reading_date, r.reading_date) : null,
      });
    });
  }
  return out.sort((a, b) => b.reading_date.localeCompare(a.reading_date) || a.vehicle_id.localeCompare(b.vehicle_id));
}

export function sumBy<T>(rows: ReadingWithDistance[], key: (r: ReadingWithDistance) => T): Map<T, number> {
  const m = new Map<T, number>();
  for (const r of rows) if (r.distance !== null) m.set(key(r), (m.get(key(r)) ?? 0) + r.distance);
  return m;
}

export function formatKm(n: number): string {
  return `${n.toLocaleString(localeTag())} km`;
}
