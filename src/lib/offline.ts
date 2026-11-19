"use client";
// Funcționare fără semnal: operațiile (pontaj, „Am început / Am terminat”, km, poze) se salvează pe telefon
// (IndexedDB) și se trimit în ordine când revine internetul. Pozele se păstrează ca fișiere în aceeași coadă.
import { supabase } from "./supabase/client";
import { attachEntryPhotos } from "./media";

export interface PhotoMeta { companyId: string; employeeId: string }
export type QueuedOp =
  | { kind: "clock_in"; label: string; args: Record<string, unknown> }
  | { kind: "clock_out"; label: string; args: Record<string, unknown>; photos: Blob[]; meta: PhotoMeta }
  | { kind: "time_entry"; label: string; row: Record<string, unknown>; photos: Blob[]; meta: PhotoMeta }
  | { kind: "odometer"; label: string; args: Record<string, unknown> }
  | { kind: "extra_trip"; label: string; args: Record<string, unknown> }
  | { kind: "trip_start"; label: string; args: Record<string, unknown> }
  | { kind: "trip_end"; label: string; args: Record<string, unknown> }
  | { kind: "entry_photos"; label: string; entryId: string; photos: Blob[]; meta: PhotoMeta; lat?: number | null; lon?: number | null };
type Stored = QueuedOp & { id?: number; createdAt: string };

const DB = "dyas-offline", STORE = "queue", FAILED_KEY = "dyas.queue.failed";

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

const listeners = new Set<() => void>();
export function onQueueChange(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
const emit = () => listeners.forEach((f) => f());

export async function queued(): Promise<Stored[]> {
  try { return ((await tx("readonly", (s) => s.getAll())) as Stored[]).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)); } catch { return []; }
}
export interface FailedOp { label: string; message: string; at: string }
export function failedOps(): FailedOp[] {
  try { return JSON.parse(localStorage.getItem(FAILED_KEY) ?? "[]") as FailedOp[]; } catch { return []; }
}
export function clearFailed() { try { localStorage.removeItem(FAILED_KEY); } catch { /* ignoră */ } emit(); }

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const m = String((e as { message?: string })?.message ?? e ?? "");
  return /Failed to fetch|NetworkError|Load failed|fetch failed|network|ERR_INTERNET|ERR_NETWORK|timeout/i.test(m);
}

export async function enqueue(op: QueuedOp): Promise<void> {
  await tx("readwrite", (s) => s.add({ ...op, createdAt: new Date().toISOString() } as Stored));
  emit();
}

/** Execută o operație. Întoarce id-ul pontajului creat (dacă e cazul). */
async function run(op: QueuedOp): Promise<string | null> {
  const sb = supabase();
  switch (op.kind) {
    case "clock_in": {
      const { error } = await sb.rpc("clock_in", op.args);
      if (error) throw error;
      return null;
    }
    case "clock_out": {
      const { data, error } = await sb.rpc("clock_out", op.args);
      if (error) throw error;
      const entryId = data as string;
      if (op.photos.length) await photosOrQueue(entryId, op.photos, op.meta, op.args.p_lat as number | null, op.args.p_lon as number | null);
      return entryId;
    }
    case "time_entry": {
      const { data, error } = await sb.from("time_entries").insert(op.row).select("id").single();
      if (error) throw error;
      const entryId = (data as { id: string }).id;
      if (op.photos.length) await photosOrQueue(entryId, op.photos, op.meta);
      return entryId;
    }
    case "odometer": {
      let { error } = await sb.rpc("submit_odometer", op.args);
      if (error && (error.code === "PGRST202" || /p_date/.test(error.message))) {
        // server fără parametrul p_date (versiune mai veche a bazei de date): trimitem fără el
        const { p_date: _omit, ...rest } = op.args; void _omit;
        ({ error } = await sb.rpc("submit_odometer", rest));
      }
      if (error) throw error;
      return null;
    }
    case "trip_start": case "trip_end": {
      const { error } = await sb.rpc(op.kind === "trip_start" ? "start_trip" : "end_trip", op.args);
      if (error) throw error;
      return null;
    }
    case "extra_trip": {
      const { error } = await sb.rpc("add_extra_trip", op.args);
      if (error) throw error;
      return null;
    }
    case "entry_photos": {
      await attachEntryPhotos({ ...op.meta, entryId: op.entryId, photos: op.photos, lat: op.lat, lon: op.lon });
      return op.entryId;
    }
  }
}

async function photosOrQueue(entryId: string, photos: Blob[], meta: PhotoMeta, lat?: number | null, lon?: number | null) {
  try { await attachEntryPhotos({ ...meta, entryId, photos, lat, lon }); }
  catch (e) {
    if (isNetworkError(e)) await enqueue({ kind: "entry_photos", label: "Poze la pontaj", entryId, photos, meta, lat, lon });
    else throw e;
  }
}

/**
 * Încearcă imediat; fără semnal, pune operația în coadă.
 * Întoarce { queued: true } dacă a rămas pe telefon, altfel { id } (pontajul creat, dacă e cazul).
 * Erorile reale (ex. date greșite) sunt aruncate mai departe, ca să fie arătate omului.
 */
export async function runOrQueue(op: QueuedOp): Promise<{ queued: boolean; id: string | null }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) { await enqueue(op); return { queued: true, id: null }; }
  // dacă sunt deja operații în așteptare, ordinea contează (ex. „Am început” trimis înainte de „Am terminat”)
  if ((await queued()).length) { await enqueue(op); void flushQueue(); return { queued: true, id: null }; }
  try { return { queued: false, id: await run(op) }; }
  catch (e) {
    if (isNetworkError(e)) { await enqueue(op); return { queued: true, id: null }; }
    throw e;
  }
}

let flushing = false;
/** Trimite tot ce e în coadă, în ordine. Se oprește la prima problemă de rețea. */
export async function flushQueue(): Promise<void> {
  if (flushing || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  flushing = true;
  try {
    for (const op of await queued()) {
      try {
        await run(op);
      } catch (e) {
        if (isNetworkError(e)) break;
        const msg = String((e as { message?: string })?.message ?? e);
        try { localStorage.setItem(FAILED_KEY, JSON.stringify([...failedOps(), { label: op.label, message: msg, at: new Date().toISOString() }].slice(-20))); } catch { /* ignoră */ }
      }
      await tx("readwrite", (s) => s.delete(op.id!));
      emit();
    }
  } finally {
    flushing = false;
    emit();
  }
}
