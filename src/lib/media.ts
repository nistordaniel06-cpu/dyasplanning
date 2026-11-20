"use client";
import { supabase } from "./supabase/client";

/** Micșorează o poză (max 1600 px, JPEG) ca să se încarce repede și pe semnal slab. */
export async function compressImage(file: Blob, max = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const out = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    return out ?? file;
  } catch {
    return file; // formate pe care browserul nu le poate desena (ex. HEIC pe Android): le trimitem așa cum sunt
  }
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function extFor(type: string): string {
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("png")) return "png";
  if (type.includes("webp")) return "webp";
  if (type.includes("heic")) return "heic";
  if (type.includes("webm")) return "webm";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
  if (type.includes("mpeg")) return "mp3";
  return "bin";
}

export async function upload(bucket: "pontaj" | "chat" | "lucrari", path: string, blob: Blob): Promise<void> {
  const contentType = (blob.type || "application/octet-stream").split(";")[0];
  const { error } = await supabase().storage.from(bucket).upload(path, blob, { contentType, upsert: false });
  if (error) throw error;
}

const cache = new Map<string, { url: string; exp: number }>();
/** Linkuri temporare (1 oră) pentru fișiere private. */
export async function signedUrls(bucket: "pontaj" | "chat" | "lucrari", paths: string[]): Promise<Record<string, string>> {
  const now = Date.now(), out: Record<string, string> = {}, missing: string[] = [];
  for (const p of paths) {
    const c = cache.get(bucket + p);
    if (c && c.exp > now) out[p] = c.url; else missing.push(p);
  }
  if (missing.length) {
    const { data } = await supabase().storage.from(bucket).createSignedUrls(missing, 3600);
    for (const r of data ?? []) {
      if (r.signedUrl && r.path) { out[r.path] = r.signedUrl; cache.set(bucket + r.path, { url: r.signedUrl, exp: now + 50 * 60 * 1000 }); }
    }
  }
  return out;
}

/** Încarcă pozele unui pontaj și le leagă de el. */
export async function attachEntryPhotos(opts: { companyId: string; employeeId: string; entryId: string; photos: Blob[]; lat?: number | null; lon?: number | null; takenAt?: string }): Promise<void> {
  for (const b of opts.photos) {
    const path = `${opts.companyId}/${opts.employeeId}/${opts.entryId}/${newId()}.${extFor(b.type)}`;
    await upload("pontaj", path, b);
    const { error } = await supabase().from("time_entry_photos").insert({
      company_id: opts.companyId, employee_id: opts.employeeId, time_entry_id: opts.entryId, path,
      lat: opts.lat ?? null, lon: opts.lon ?? null, taken_at: opts.takenAt ?? new Date().toISOString(),
    });
    if (error) throw error;
  }
}
