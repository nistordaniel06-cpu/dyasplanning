"use client";
import { useState } from "react";
import { Copy, Link2, Palette } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { COLOR_PRESETS, DEFAULT_COLOR, slugify } from "@/lib/brand";
import { TIMEZONES } from "@/lib/time";
import { Button, ErrorBox, Field, Input, Notice, Select, cx } from "../ui";

export interface EditableCompany {
  id: string; name: string; timezone: string;
  default_work_start: string | null; default_work_end: string | null; default_break_minutes: number | null;
  app_name: string | null; app_slug: string | null; brand_color: string | null;
}

const hhmm = (t: string | null, d: string) => (t ?? d).slice(0, 5);

/** Proprietarul modifică datele firmei și aplicația ei (nume, link, culori). */
export function CompanyEditor({ c, onSaved }: { c: EditableCompany; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(c.name);
  const [tz, setTz] = useState(c.timezone);
  const [start, setStart] = useState(hhmm(c.default_work_start, "07:00"));
  const [end, setEnd] = useState(hhmm(c.default_work_end, "16:00"));
  const [brk, setBrk] = useState(String(c.default_break_minutes ?? 60));
  const [appName, setAppName] = useState(c.app_name ?? "");
  const [slug, setSlug] = useState(c.app_slug ?? "");
  const [color, setColor] = useState(c.brand_color ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [copied, setCopied] = useState(false);
  const site = typeof window !== "undefined" ? window.location.origin : "";
  const link = c.app_slug ? `${site}/app/${c.app_slug}` : null;
  const tzs = TIMEZONES.some((t) => t.value === tz) ? TIMEZONES : [{ value: tz, label: tz }, ...TIMEZONES];
  const shown = color || DEFAULT_COLOR;

  async function save() {
    setBusy(true); setErr(null); setOk(false);
    const { error } = await supabase().rpc("owner_edit_company", {
      p_company: c.id, p_name: name, p_timezone: tz, p_work_start: start, p_work_end: end, p_break: Number(brk) || 0,
      p_app_name: appName.trim() || null, p_app_slug: slug.trim() || null, p_brand_color: color || null,
    });
    setBusy(false);
    if (error) { setErr(humanError(error)); return; }
    setOk(true);
    await onSaved();
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 p-3">
      <h3 className="text-sm font-semibold">Datele firmei</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Numele firmei"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Fus orar">
          <Select value={tz} onChange={(e) => setTz(e.target.value)}>
            {tzs.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Program de la"><Input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="până la"><Input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Pauză (min)"><Input type="number" min={0} step={5} value={brk} onChange={(e) => setBrk(e.target.value)} /></Field>
      </div>

      <h3 className="flex items-center gap-1.5 pt-2 text-sm font-semibold"><Palette className="h-4 w-4" />Aplicația firmei</h3>
      <p className="-mt-2 text-xs text-slate-600">Angajații firmei văd numele și culorile de aici, iar aplicația instalată pe telefon are numele ales. Gol = DYASPlanning.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Numele aplicației" hint="ex. Pop Construct">
          <Input value={appName} maxLength={40} placeholder="DYASPlanning" onChange={(e) => setAppName(e.target.value)} />
        </Field>
        <Field label="Link propriu" hint={`${site}/app/${slug || "…"}`}>
          <div className="flex gap-2">
            <Input value={slug} maxLength={40} placeholder="pop-construct" onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} />
            <Button type="button" onClick={() => setSlug(slugify(appName || name))}><Link2 className="h-4 w-4" />Generează</Button>
          </div>
        </Field>
      </div>
      <Field label="Culoarea aplicației">
        <div className="flex flex-wrap items-center gap-2">
          {COLOR_PRESETS.map((p) => (
            <button key={p} type="button" aria-label={`Culoare ${p}`} onClick={() => setColor(p === DEFAULT_COLOR ? "" : p)}
              className={cx("h-8 w-8 rounded-full border-2", shown === p ? "border-slate-900 ring-2 ring-offset-1 ring-slate-400" : "border-white shadow")}
              style={{ background: p }} />
          ))}
          <label className="flex items-center gap-1 text-xs text-slate-600">
            <input type="color" value={shown} onChange={(e) => setColor(e.target.value.toLowerCase())} className="h-8 w-10 cursor-pointer rounded border border-slate-300" aria-label="Altă culoare" />
            altă culoare
          </label>
        </div>
      </Field>
      {/* previzualizare */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <svg viewBox="0 0 64 64" className="h-10 w-10 shrink-0" aria-hidden><rect width="64" height="64" rx="14" fill={shown} /><path d="M14 46V22l18-10 18 10v24H38V32H26v14z" fill="#fff" /></svg>
        <div className="min-w-0 flex-1">
          <div className="font-bold" data-no-i18n>{appName.trim() || "DYASPlanning"}</div>
          <div className="truncate text-xs text-slate-500" data-no-i18n>{name}</div>
        </div>
        <span className="rounded-lg px-3 py-1.5 text-sm font-semibold text-white" style={{ background: shown }}>Buton</span>
      </div>
      {link && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-orange-50 p-2 text-sm">
          <span className="font-semibold">Linkul aplicației:</span>
          <a href={link} target="_blank" rel="noreferrer" className="min-w-0 break-all text-orange-800 underline" data-no-i18n>{link}</a>
          <Button size="sm" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
            <Copy className="h-4 w-4" />{copied ? "Copiat" : "Copiază"}</Button>
        </div>
      )}
      {err && <ErrorBox message={err} />}
      {ok && <Notice tone="green">Salvat. Utilizatorii firmei văd schimbările la următoarea deschidere a aplicației.</Notice>}
      <Button variant="primary" onClick={save} loading={busy}>Salvează firma și aplicația</Button>
    </div>
  );
}
