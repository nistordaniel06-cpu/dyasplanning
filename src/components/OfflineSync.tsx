"use client";
import { useEffect, useState } from "react";
import { CloudOff, RefreshCw, X } from "lucide-react";
import { clearFailed, failedOps, flushQueue, onQueueChange, queued, type FailedOp } from "@/lib/offline";

/** Bara de sus: fără semnal / se trimit datele salvate pe telefon / ce nu s-a putut trimite. */
export function OfflineSync() {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<FailedOp[]>([]);

  useEffect(() => {
    const refresh = async () => { setPending((await queued()).length); setFailed(failedOps()); };
    const up = () => { setOnline(true); void flushQueue(); };
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    void refresh();
    void flushQueue();
    const off = onQueueChange(() => { void refresh(); });
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    const t = setInterval(() => { void flushQueue(); }, 30000);
    return () => { off(); window.removeEventListener("online", up); window.removeEventListener("offline", down); clearInterval(t); };
  }, []);

  if (online && pending === 0 && failed.length === 0) return null;
  return (
    <div className="mb-3 space-y-2">
      {(!online || pending > 0) && (
        <div className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${online ? "border-blue-200 bg-blue-50 text-blue-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
          {online ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : <CloudOff className="h-4 w-4 shrink-0" />}
          <span className="flex-1">
            {online ? <>Se trimit datele salvate pe telefon ({pending}).</>
              : pending > 0 ? <>Fără semnal. {pending} înregistrări sunt salvate pe telefon și se trimit singure când revine internetul.</>
              : <>Fără semnal. Pontajul, „Am început / Am terminat” și km se salvează pe telefon și se trimit când revine internetul.</>}
          </span>
        </div>
      )}
      {failed.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-950">
          <div className="flex items-start gap-2">
            <span className="flex-1 font-semibold">Unele date salvate fără semnal nu au putut fi trimise:</span>
            <button aria-label="Închide" onClick={clearFailed}><X className="h-4 w-4" /></button>
          </div>
          <ul className="mt-1 list-disc pl-5">{failed.map((f, i) => <li key={i}><span>{f.label}</span>: <span>{f.message}</span></li>)}</ul>
        </div>
      )}
    </div>
  );
}
