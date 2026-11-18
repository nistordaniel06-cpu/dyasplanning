"use client";
import { useState } from "react";
import { Archive, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { collect, counts, excelBlob, zipBlob } from "@/lib/backup";
import { saveBlob } from "@/lib/pdf";
import { todayIn } from "@/lib/time";
import { localeTag } from "@/lib/lang";
import { Button, Card, ErrorBox, Notice } from "./ui";

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "firma";

/** Setări → Backup și export: Excel cu toate datele sau backup complet (ZIP). */
export function BackupCard() {
  const { company, tz, reload } = useSession();
  const [busy, setBusy] = useState<"excel" | "zip" | null>(null);
  const [progress, setProgress] = useState("");
  const [photos, setPhotos] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const last = company?.last_backup_at ? new Date(company.last_backup_at) : null;
  const old = !last || Date.now() - last.getTime() > 30 * 864e5;
  const name = `${slug(company?.name ?? "")}_${todayIn(tz)}`;

  async function run(kind: "excel" | "zip") {
    setBusy(kind); setErr(null); setDone(null); setProgress("Se pregătește…");
    try {
      const data = await collect(setProgress);
      if (kind === "excel") {
        setProgress("Se pregătește fișierul Excel…");
        saveBlob(`date_${name}.xlsx`, await excelBlob(data, tz, company?.name ?? ""));
      } else {
        const blob = await zipBlob(data, tz, company?.name ?? "", { photos, onProgress: setProgress });
        saveBlob(`backup_${name}.zip`, blob);
        await supabase().rpc("mark_company_backup");
        void reload();
      }
      setDone(counts(data).filter((c) => c.n > 0).map((c) => `${c.label}: ${c.n}`).join(" · "));
    } catch (e) {
      setErr(humanError(e));
    } finally {
      setBusy(null); setProgress("");
    }
  }

  return (
    <Card title="Backup și export date">
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Descarcă toate datele firmei pe telefon sau calculator: angajați, echipe, lucrări, misiuni, program, pontaje, absențe, mașini, km, observații și chat.</p>
        <Notice tone={old ? "amber" : "green"}>
          <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0" />
            {last ? <>Ultimul backup complet: <strong>{last.toLocaleString(localeTag(), { dateStyle: "medium", timeStyle: "short", timeZone: tz })}</strong>{old ? ". Recomandăm un backup pe lună." : "."}</> : "Nu ai făcut încă un backup complet. Recomandăm unul pe lună."}
          </span>
        </Notice>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center gap-2 font-semibold"><FileSpreadsheet className="h-5 w-5 text-green-700" />Excel</div>
            <p className="mt-1 text-xs text-slate-600">Un fișier cu câte o foaie pentru fiecare categorie, cu nume în loc de coduri. Bun de trimis la contabilitate sau de lucrat în Excel.</p>
            <Button className="mt-3 w-full" onClick={() => run("excel")} loading={busy === "excel"} disabled={!!busy}>Descarcă Excel</Button>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-center gap-2 font-semibold"><Archive className="h-5 w-5 text-orange-700" />Backup complet (ZIP)</div>
            <p className="mt-1 text-xs text-slate-600">Excel + copia completă a datelor (pentru restaurare) + fiecare tabel separat. Păstrează-l în Google Drive sau pe calculator.</p>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" checked={photos} onChange={(e) => setPhotos(e.target.checked)} className="h-4 w-4 accent-orange-600" />
              Include pozele și mesajele vocale (fișierul e mai mare)
            </label>
            <Button variant="primary" className="mt-3 w-full" onClick={() => run("zip")} loading={busy === "zip"} disabled={!!busy}>Descarcă backup complet</Button>
          </div>
        </div>
        {busy && <p className="text-xs text-slate-600" aria-live="polite">{progress}</p>}
        {done && <Notice tone="green">Gata. Fișierul a fost descărcat. Conține: {done}.</Notice>}
        {err && <ErrorBox message={err} />}
      </div>
    </Card>
  );
}
