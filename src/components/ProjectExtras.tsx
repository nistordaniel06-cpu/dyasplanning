"use client";
// Lucrări extra: ce s-a făcut în plus față de proiectul stabilit — comentariu + poze, confirmate de administrator.
import { useEffect, useState } from "react";
import { Check, ClipboardPlus, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { useQuery, must } from "@/lib/useQuery";
import { humanError } from "@/lib/errors";
import { extFor, newId, signedUrls, upload } from "@/lib/media";
import { localTime, prettyDate, todayIn } from "@/lib/time";
import type { ProjectExtra } from "@/lib/types";
import { PhotoPicker } from "./PhotoPicker";
import { PhotoThumbs } from "./EntryPhotos";
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Textarea } from "./ui";

const STATUS: Record<ProjectExtra["status"], { label: string; tone: "amber" | "green" | "red" }> = {
  nou: { label: "De verificat", tone: "amber" },
  confirmat: { label: "Confirmat", tone: "green" },
  respins: { label: "Nu se ia în calcul", tone: "red" },
};

export function ProjectExtras({ projectId }: { projectId: string }) {
  const { company, isAdmin, tz } = useSession();
  const q = useQuery(async () => must(await supabase().from("project_extras").select("*").eq("project_id", projectId).order("extra_date", { ascending: false }).order("created_at", { ascending: false })) as ProjectExtra[], [projectId]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectExtra | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => { void supabase().auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);

  const key = (q.data ?? []).flatMap((x) => x.photos).join("|");
  useEffect(() => {
    const paths = (q.data ?? []).flatMap((x) => x.photos);
    if (paths.length) void signedUrls("lucrari", paths).then(setUrls);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function setStatus(x: ProjectExtra, status: ProjectExtra["status"]) {
    const { error: e } = await supabase().from("project_extras").update({ status }).eq("id", x.id);
    if (e) setError(humanError(e)); else await q.reload();
  }
  async function remove(x: ProjectExtra) {
    if (!confirm("Ștergi această lucrare extra?")) return;
    const { error: e } = await supabase().from("project_extras").delete().eq("id", x.id);
    if (e) { setError(humanError(e)); return; }
    if (x.photos.length) await supabase().storage.from("lucrari").remove(x.photos);
    await q.reload();
  }

  const list = q.data ?? [];
  const open = list.filter((x) => x.status === "nou").length;
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="text-sm sm:flex-1 text-slate-600">Tot ce s-a făcut <strong>în plus față de proiectul stabilit</strong> (cerut de client pe loc, modificări, reparații), cu poze. {isAdmin ? "Le confirmi tu, ca să știi ce se facturează în plus." : "Administratorul le vede și le confirmă."}</p>
        {!adding && <Button variant="primary" onClick={() => { setAdding(true); setEditing(null); }}><ClipboardPlus className="h-4 w-4" />Adaugă lucrare extra</Button>}
      </div>
      {error && <ErrorBox message={error} />}
      {(adding || editing) && company && (
        <ExtraForm projectId={projectId} companyId={company.id} extra={editing} today={todayIn(tz)}
          onClose={() => { setAdding(false); setEditing(null); }} onSaved={async () => { setAdding(false); setEditing(null); await q.reload(); }} />
      )}
      {q.loading && !q.data && <Loading />}
      {q.error && <ErrorBox message={q.error} onRetry={q.reload} />}
      {q.data && list.length === 0 && !adding && <Empty title="Nicio lucrare extra">Când faceți ceva în plus față de proiect, notați aici cu poze, ca să nu se piardă.</Empty>}
      {isAdmin && open > 0 && <p className="text-sm font-semibold text-amber-800">{open} de verificat</p>}
      <ul className="space-y-3">
        {list.map((x) => {
          const st = STATUS[x.status];
          const mine = x.author_user_id === me;
          return (
            <li key={x.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <strong>{prettyDate(x.extra_date)}</strong>
                <span className="text-slate-500">· {x.author_name} · {localTime(x.created_at, tz)}</span>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              <p className="mt-1 whitespace-pre-wrap">{x.body}</p>
              <PhotoThumbs photos={x.photos.filter((p) => urls[p]).map((p) => ({ id: p, url: urls[p] }))} />
              {x.admin_note && <p className="mt-1 text-sm text-slate-600">Notă administrator: {x.admin_note}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {isAdmin && x.status !== "confirmat" && <Button size="sm" onClick={() => setStatus(x, "confirmat")}><Check className="h-4 w-4 text-green-700" />Confirmă</Button>}
                {isAdmin && x.status !== "respins" && <Button size="sm" onClick={() => setStatus(x, "respins")}><X className="h-4 w-4 text-red-700" />Nu se ia în calcul</Button>}
                {isAdmin && x.status !== "nou" && <Button size="sm" variant="ghost" onClick={() => setStatus(x, "nou")}>Înapoi la verificat</Button>}
                {(isAdmin || (mine && x.status === "nou")) && <>
                  <Button size="sm" variant="ghost" onClick={() => { setEditing(x); setAdding(false); }}><Pencil className="h-4 w-4" />Modifică</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(x)}><Trash2 className="h-4 w-4" />Șterge</Button>
                </>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ExtraForm({ projectId, companyId, extra, today, onClose, onSaved }: { projectId: string; companyId: string; extra: ProjectExtra | null; today: string; onClose: () => void; onSaved: () => void }) {
  const [body, setBody] = useState(extra?.body ?? "");
  const [date, setDate] = useState(extra?.extra_date ?? today);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [keep, setKeep] = useState<string[]>(extra?.photos ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!body.trim()) { setError("Scrie ce s-a făcut în plus."); return; }
    setBusy(true); setError(null);
    try {
      const paths: string[] = [];
      for (const b of photos) {
        const path = `${companyId}/${projectId}/${newId()}.${extFor(b.type || "image/jpeg")}`;
        await upload("lucrari", path, b); paths.push(path);
      }
      const all = [...keep, ...paths];
      const sb = supabase();
      const { error: e } = extra
        ? await sb.from("project_extras").update({ body: body.trim(), extra_date: date, photos: all }).eq("id", extra.id)
        : await sb.from("project_extras").insert({ company_id: companyId, project_id: projectId, body: body.trim(), extra_date: date, photos: all });
      if (e) throw e;
      const removed = (extra?.photos ?? []).filter((p) => !keep.includes(p));
      if (removed.length) await sb.storage.from("lucrari").remove(removed);
      onSaved();
    } catch (e) { setError(humanError(e)); }
    setBusy(false);
  }

  return (
    <div className="space-y-3 rounded-xl border border-orange-300 bg-orange-50 p-3">
      <div className="font-bold">{extra ? "Modifică lucrarea extra" : "Lucrare extra nouă"}</div>
      <Field label="Ce s-a făcut în plus"><Textarea rows={3} placeholder="ex. Clientul a cerut încă o priză în dormitor; am mutat chiuveta 40 cm" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <Field label="Data"><Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="w-auto" /></Field>
      {keep.length > 0 && <p className="text-sm text-slate-600">{keep.length} poze deja salvate <button type="button" className="ml-2 font-semibold underline" onClick={() => setKeep([])}>Scoate-le</button></p>}
      <PhotoPicker photos={photos} onChange={setPhotos} max={8} label="Adaugă poze" />
      {error && <ErrorBox message={error} />}
      <div className="flex gap-2">
        <Button onClick={onClose}>Renunță</Button>
        <Button variant="primary" className="flex-1" onClick={save} loading={busy}>Salvează</Button>
      </div>
    </div>
  );
}
