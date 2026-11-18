"use client";
import { isNetworkError } from "./offline";

/** Rulează cererea; dacă nu e semnal, întoarce ultimul rezultat salvat pe telefon (dacă există). */
export async function withOfflineCache<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = `dyas.cache.${key}`;
  try {
    const v = await fn();
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* spațiu plin: ignorăm */ }
    return v;
  } catch (e) {
    if (isNetworkError(e)) {
      try { const raw = localStorage.getItem(k); if (raw) return JSON.parse(raw) as T; } catch { /* ignoră */ }
    }
    throw e;
  }
}
