"use client";
import { useEffect, useState } from "react";
import { Camera } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { signedUrls } from "@/lib/media";
import { Modal } from "./ui";

interface Photo { id: string; time_entry_id: string; path: string; taken_at: string }

/** Încarcă pozele pentru o listă de pontaje (o singură cerere). */
export function useEntryPhotos(entryIds: string[]) {
  const key = [...entryIds].sort().join(",");
  const [map, setMap] = useState<Record<string, (Photo & { url: string })[]>>({});
  useEffect(() => {
    if (!key) { setMap({}); return; }
    let alive = true;
    void (async () => {
      const ids = key.split(",");
      const out: Photo[] = [];
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await supabase().from("time_entry_photos").select("id,time_entry_id,path,taken_at").in("time_entry_id", ids.slice(i, i + 100)).order("taken_at");
        out.push(...((data as Photo[]) ?? []));
      }
      const urls = out.length ? await signedUrls("pontaj", out.map((p) => p.path)) : {};
      const m: Record<string, (Photo & { url: string })[]> = {};
      for (const p of out) if (urls[p.path]) (m[p.time_entry_id] ??= []).push({ ...p, url: urls[p.path] });
      if (alive) setMap(m);
    })();
    return () => { alive = false; };
  }, [key]);
  return map;
}

/** Miniaturi pentru pozele unui pontaj; apăsare = poza mare. */
export function PhotoThumbs({ photos }: { photos?: { id: string; url: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!photos?.length) return null;
  return (
    <>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Camera className="h-3.5 w-3.5 text-slate-500" />
        {photos.map((p) => (
          <button key={p.id} type="button" onClick={() => setOpen(p.url)} className="h-12 w-12 overflow-hidden rounded-md border border-slate-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="Poză de la lucrare" className="h-full w-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
      <Modal open={!!open} onClose={() => setOpen(null)} title="Poză de la lucrare" wide>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {open && <img src={open} alt="Poză de la lucrare" className="mx-auto max-h-[75vh] w-auto rounded-lg" />}
      </Modal>
    </>
  );
}
