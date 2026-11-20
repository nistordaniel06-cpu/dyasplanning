"use client";
// Player-ul demonstrației: butonul „Vezi demonstrația” pornește filmul în pagină (cu sunet oprit, ca pe telefon).
import { useRef, useState } from "react";
import { Play } from "lucide-react";

export function DemoPlayer({ src, poster, duration }: { src: string; poster: string; duration: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);

  function play() {
    const v = ref.current;
    if (!v) return;
    setStarted(true);
    v.scrollIntoView({ behavior: "smooth", block: "center" });
    void v.play().catch(() => undefined);
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={play}
        className="flex w-full items-center justify-center gap-3 rounded-2xl bg-orange-600 px-6 py-4 text-lg font-bold text-white shadow-lg shadow-orange-600/25 active:scale-[.99] sm:w-auto">
        <Play className="h-6 w-6 fill-white" aria-hidden />
        Vezi demonstrația
        <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-sm font-semibold">{duration}</span>
      </button>
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 shadow-xl">
        <video ref={ref} src={src} poster={poster} controls playsInline preload="metadata" onPlay={() => setStarted(true)}
          className="aspect-video w-full bg-slate-900" aria-label="Demonstrație DYAS Planning: o zi cu două șantiere">
          Browserul tău nu poate reda filmul. <a href={src}>Descarcă demonstrația (MP4)</a>.
        </video>
        {!started && (
          <button type="button" onClick={play} aria-label="Pornește demonstrația"
            className="absolute inset-0 flex items-center justify-center bg-slate-900/10">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-orange-600 shadow-2xl ring-8 ring-white/60">
              <Play className="ml-1 h-9 w-9 fill-white text-white" />
            </span>
          </button>
        )}
      </div>
      <p className="text-sm text-slate-500">Filmul are subtitrări — se înțelege și cu sunetul oprit.</p>
    </div>
  );
}
