"use client";
import { useState } from "react";
import { LifeBuoy, Send } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { useQuery, must } from "@/lib/useQuery";
import { localeTag } from "@/lib/lang";
import { Badge, Button, Card, ErrorBox, Field, Loading, Notice, PageHeader, Textarea } from "@/components/ui";

interface Req { id: string; message: string; status: "nou" | "raspuns" | "rezolvat"; reply: string | null; replied_at: string | null; created_at: string; page: string | null }

/** Cereri de ajutor către echipa DYASPlanning, cu răspunsurile primite. */
export default function AjutorPage() {
  const q = useQuery(async () => must(await supabase().from("support_requests").select("id,message,status,reply,replied_at,created_at,page").order("created_at", { ascending: false }).limit(50)) as Req[], []);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const from = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("din") : null;
  const when = (iso: string) => new Date(iso).toLocaleString(localeTag(), { dateStyle: "medium", timeStyle: "short" });

  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setSent(false);
    const { error } = await supabase().rpc("send_support_request", { p_message: msg, p_page: from ?? null });
    setBusy(false);
    if (error) { setErr(humanError(error)); return; }
    setMsg(""); setSent(true); await q.reload();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Ajutor" subtitle="Scrie-ne dacă ceva nu merge sau ai o întrebare. Îți răspundem aici și primești notificare." />
      <Card>
        <form onSubmit={send} className="space-y-3">
          <Field label="Cu ce te putem ajuta?" hint="Spune ce încercai să faci și ce s-a întâmplat. Poți scrie și o idee de funcție nouă.">
            <Textarea required rows={5} maxLength={4000} value={msg} onChange={(e) => setMsg(e.target.value)} />
          </Field>
          {err && <ErrorBox message={err} />}
          {sent && <Notice tone="green">Mesajul a fost trimis. Primești notificare când îți răspundem.</Notice>}
          <Button variant="primary" type="submit" loading={busy} disabled={msg.trim().length < 3}><Send className="h-4 w-4" />Trimite</Button>
        </form>
      </Card>
      <Card title="Cererile mele">
        {q.loading && !q.data ? <Loading /> : q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> :
          (q.data ?? []).length === 0 ? <p className="flex items-center gap-2 text-sm text-slate-500"><LifeBuoy className="h-4 w-4" />Nu ai trimis încă nicio cerere.</p> : (
            <ul className="space-y-3">
              {q.data!.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    {when(r.created_at)}
                    <Badge tone={r.status === "nou" ? "amber" : r.status === "raspuns" ? "blue" : "green"}>{r.status === "nou" ? "Trimisă" : r.status === "raspuns" ? "Ai răspuns" : "Rezolvată"}</Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-line" data-no-i18n>{r.message}</p>
                  {r.reply && (
                    <div className="mt-2 rounded-lg bg-orange-50 p-2">
                      <div className="text-xs font-semibold text-orange-800">Răspuns DYASPlanning · {r.replied_at ? when(r.replied_at) : ""}</div>
                      <p className="mt-0.5 whitespace-pre-line" data-no-i18n>{r.reply}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </Card>
    </div>
  );
}
