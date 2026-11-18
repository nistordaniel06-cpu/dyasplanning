"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bot, CheckCircle2, Mic, MicOff, RotateCcw, Send, Sparkles, XCircle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSession } from "@/lib/session";
import { getLang } from "@/lib/lang";
import { Button, ErrorBox, cx } from "@/components/ui";

interface Proposal { rezumat: string; actiuni: Record<string, unknown>[]; descrieri: string[] }
interface Result { ok: boolean; text: string; link?: string }
interface Item {
  role: "user" | "assistant";
  text: string;
  proposal?: Proposal;
  state?: "propus" | "confirmat" | "anulat";
  results?: Result[];
}

const KEY = "dyas.asistent";
const EXAMPLES = [
  "Creează lucrarea Vila Otopeni și alocă-i pe Gigel, Florin și Ion de luni, două săptămâni",
  "Adaugă un angajat nou: Marius Popescu, zidar, 0722 123 456",
  "Adaugă mașina Ford Transit, B 123 ABC",
  "Cine lucrează mâine și unde?",
  "Trece-l pe Ion în concediu de vineri până marțea viitoare",
  "Câte pontaje am de aprobat?",
];

async function call(path: string, body: unknown) {
  const { data } = await supabase().auth.getSession();
  const r = await fetch(path, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${data.session?.access_token ?? ""}` },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "Asistentul nu răspunde acum.");
  return j;
}

/** Asistentul AI al administratorului: spui ce vrei, el pregătește modificările, tu confirmi. */
export default function AsistentPage() {
  const { membership } = useSession();
  const [items, setItems] = useState<Item[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const rec = useRef<{ stop: () => void } | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(items.slice(-40))); } catch { /* ignoră */ } end.current?.scrollIntoView({ behavior: "smooth" }); }, [items]);

  if (membership?.role !== "admin") return <ErrorBox message="Asistentul este disponibil doar pentru administratorii firmei." />;

  // istoricul trimis modelului: textele, plus ce s-a confirmat/anulat
  const history = (list: Item[]) => list.map((it) => ({
    role: it.role,
    content: it.role === "assistant" && it.proposal
      ? `${it.text ? it.text + "\n" : ""}[Propunere: ${it.proposal.descrieri.join("; ")}] → ${it.state === "confirmat" ? `CONFIRMATĂ. Rezultat: ${(it.results ?? []).map((r) => r.text).join(" ")}` : it.state === "anulat" ? "ANULATĂ de administrator." : "în așteptarea confirmării."}`
      : it.text,
  })).filter((m) => m.content);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setErr(null); setInput("");
    // o propunere neconfirmată devine anulată când adminul scrie altceva
    const next: Item[] = [...items.map((it) => (it.state === "propus" ? { ...it, state: "anulat" as const } : it)), { role: "user", text: t }];
    setItems(next); setBusy(true);
    try {
      const j = await call("/api/asistent", { messages: history(next) });
      setItems((x) => [...x, { role: "assistant", text: j.text ?? "", proposal: j.proposal, state: j.proposal ? "propus" : undefined }]);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function confirm(i: number) {
    const it = items[i];
    if (!it.proposal) return;
    setBusy(true); setErr(null);
    try {
      const j = await call("/api/asistent/executa", { actiuni: it.proposal.actiuni });
      setItems((x) => x.map((y, k) => (k === i ? { ...y, state: "confirmat", results: j.results } : y)));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  function toggleMic() {
    if (listening) { rec.current?.stop(); return; }
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const SR = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!SR) { setErr("Telefonul sau browserul nu permite dictarea. Scrie mesajul."); return; }
    const r = new SR();
    r.lang = getLang() === "en" ? "en-GB" : "ro-RO"; r.interimResults = true; r.continuous = false;
    const base = input ? input.trimEnd() + " " : "";
    r.onresult = (ev) => { let s = ""; for (let k = 0; k < ev.results.length; k++) s += ev.results[k][0].transcript; setInput(base + s); };
    r.onend = () => { setListening(false); rec.current = null; };
    r.onerror = () => { setListening(false); rec.current = null; };
    rec.current = r; setListening(true); r.start();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col" style={{ minHeight: "calc(100dvh - 9rem)" }}>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-6 w-6 text-orange-600" />
        <h1 className="flex-1 text-2xl font-bold">Asistent AI</h1>
        {items.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setItems([]); setErr(null); }}><RotateCcw className="h-4 w-4" />Conversație nouă</Button>}
      </div>

      <div className="flex-1 space-y-3 pb-4">
        {items.length === 0 && (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-sm text-slate-700">Spune-mi ce vrei să faci, cu cuvintele tale. Pregătesc modificările și le salvez doar după ce apeși <strong>Confirmă</strong>.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => send(e)} className="rounded-full border border-orange-300 bg-white px-3 py-1.5 text-left text-sm text-slate-800 hover:bg-orange-100">{e}</button>
              ))}
            </div>
          </div>
        )}
        {items.map((it, i) => (
          <div key={i} className={cx("flex", it.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cx("max-w-[88%] rounded-2xl px-4 py-2.5 text-sm", it.role === "user" ? "bg-orange-600 text-white" : "border border-slate-200 bg-white")}>
              {it.role === "assistant" && <Bot className="mb-1 h-4 w-4 text-orange-600" aria-hidden />}
              {it.text && <p className="whitespace-pre-line" data-no-i18n>{it.text}</p>}
              {it.proposal && (
                <div className={cx("mt-2 rounded-xl border p-3", it.state === "confirmat" ? "border-green-300 bg-green-50" : it.state === "anulat" ? "border-slate-200 bg-slate-50 opacity-70" : "border-orange-300 bg-orange-50")}>
                  {it.proposal.rezumat && <div className="font-semibold" data-no-i18n>{it.proposal.rezumat}</div>}
                  <ul className="mt-1 list-disc space-y-1 pl-5" data-no-i18n>{it.proposal.descrieri.map((d, k) => <li key={k}>{d}</li>)}</ul>
                  {it.state === "propus" && (
                    <div className="mt-3 flex gap-2">
                      <Button variant="primary" size="sm" onClick={() => confirm(i)} loading={busy}><CheckCircle2 className="h-4 w-4" />Confirmă</Button>
                      <Button size="sm" onClick={() => setItems((x) => x.map((y, k) => (k === i ? { ...y, state: "anulat" } : y)))} disabled={busy}>Anulează</Button>
                    </div>
                  )}
                  {it.state === "anulat" && <div className="mt-2 text-xs text-slate-500">Anulat — nu s-a salvat nimic.</div>}
                  {it.results && (
                    <ul className="mt-2 space-y-1">
                      {it.results.map((r, k) => (
                        <li key={k} className="flex items-start gap-1.5">
                          {r.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                          <span><span data-no-i18n>{r.text}</span>{r.link && <> <Link href={r.link} className="font-semibold text-orange-700 underline">Deschide</Link></>}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="text-sm text-slate-500">Asistentul lucrează…</div>}
        {err && <ErrorBox message={err} />}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void send(input); }}
        className="sticky bottom-20 flex items-end gap-2 rounded-2xl border border-slate-300 bg-white p-2 shadow-lg md:bottom-4">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={1} maxLength={2000}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder="Scrie sau dictează ce vrei să faci…" aria-label="Mesaj pentru asistent"
          className="max-h-40 min-h-[44px] flex-1 resize-none rounded-xl px-3 py-2.5 text-[15px] outline-none" />
        <button type="button" onClick={toggleMic} aria-label={listening ? "Oprește dictarea" : "Dictează"}
          className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", listening ? "animate-pulse bg-red-600 text-white" : "text-slate-600 hover:bg-slate-100")}>
          {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </button>
        <Button type="submit" variant="primary" disabled={busy || !input.trim()} aria-label="Trimite"><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}

interface SpeechRec {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: (ev: { results: { [k: number]: { [k: number]: { transcript: string } }; length: number } }) => void;
  onend: () => void; onerror: () => void; start: () => void; stop: () => void;
}
