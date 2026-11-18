"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { compressImage } from "@/lib/media";
import { Button } from "./ui";

/** Poze făcute cu camera (sau alese din galerie), micșorate înainte de trimitere. */
export function PhotoPicker({ photos, onChange, max = 6, label = "Adaugă poză" }: { photos: Blob[]; onChange: (p: Blob[]) => void; max?: number; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const u = photos.map((p) => URL.createObjectURL(p));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [photos]);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    const out: Blob[] = [];
    for (const f of Array.from(files).slice(0, max - photos.length)) out.push(await compressImage(f));
    setBusy(false);
    onChange([...photos, ...out]);
    if (input.current) input.current.value = "";
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <div key={u} className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" className="h-full w-full object-cover" />
            <button type="button" aria-label="Elimină poza" onClick={() => onChange(photos.filter((_, j) => j !== i))}
              className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white"><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
        {photos.length < max && (
          <Button type="button" onClick={() => input.current?.click()} loading={busy} className="h-20 flex-col gap-1 px-4 text-xs">
            <Camera className="h-5 w-5" />{label}
          </Button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => add(e.target.files)} />
    </div>
  );
}
