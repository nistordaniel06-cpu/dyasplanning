// Traseu măsurat cu GPS-ul telefonului: se adună distanța dintre punctele bune, cât timp aplicația e deschisă.
// Starea se ține pe telefon (localStorage), ca traseul să continue și după ce aplicația se redeschide.

export interface TripPoint { lat: number; lon: number; t: number; acc: number }
export interface TripState { vehicleId: string; startedAt: number; meters: number; last: TripPoint | null; points: number }

/** Distanța în metri între două puncte (formula haversine). */
export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const MAX_ACCURACY_M = 50; // punctele mai imprecise de atât se ignoră
const MAX_SPEED_MS = 70; // ~250 km/h: peste asta e un salt greșit al GPS-ului

/** Adaugă un punct nou la traseu. Ignoră punctele imprecise, săriturile imposibile și „tremurul” pe loc. */
export function addPoint(s: TripState, p: TripPoint): TripState {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || p.acc > MAX_ACCURACY_M) return s;
  if (!s.last) return { ...s, last: p, points: s.points + 1 };
  const d = distanceM(s.last, p);
  const dt = Math.max(1, (p.t - s.last.t) / 1000);
  // pe loc: mișcarea e mai mică decât precizia GPS-ului → nu e drum
  if (d < Math.max(15, (p.acc + s.last.acc) / 2)) return s;
  if (d / dt > MAX_SPEED_MS) return s;
  return { ...s, meters: s.meters + d, last: p, points: s.points + 1 };
}

export const kmOf = (s: TripState) => Math.round(s.meters / 100) / 10;

const key = (employeeId: string) => `dyas.gpstrip.${employeeId}`;
export function loadTrip(employeeId: string): TripState | null {
  try { const v = localStorage.getItem(key(employeeId)); return v ? (JSON.parse(v) as TripState) : null; } catch { return null; }
}
export function saveTrip(employeeId: string, s: TripState | null) {
  try { if (s) localStorage.setItem(key(employeeId), JSON.stringify(s)); else localStorage.removeItem(key(employeeId)); } catch { /* fără spațiu: traseul merge doar în memorie */ }
}

/** Mașina aleasă azi de șofer (ținută minte pe telefon pentru ziua respectivă). */
const carKey = (employeeId: string) => `dyas.car.${employeeId}`;
export function loadTodayCar(employeeId: string, today: string): string | null {
  try { const v = JSON.parse(localStorage.getItem(carKey(employeeId)) ?? "null") as { d: string; v: string } | null; return v && v.d === today ? v.v : null; } catch { return null; }
}
export function saveTodayCar(employeeId: string, today: string, vehicleId: string) {
  try { localStorage.setItem(carKey(employeeId), JSON.stringify({ d: today, v: vehicleId })); } catch { /* ignorat */ }
}
