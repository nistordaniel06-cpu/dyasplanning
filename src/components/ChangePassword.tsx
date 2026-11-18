"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { humanError } from "@/lib/errors";
import { Button, Card, ErrorBox, Field, Input, Notice } from "./ui";

/** Schimbarea parolei (conturile cu email; cei cu telefon primesc cod de la administrator). */
export function ChangePasswordCard() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setOk(false);
    if (pw.length < 8) { setErr("Parola trebuie să aibă cel puțin 8 caractere."); return; }
    if (pw !== pw2) { setErr("Parolele nu coincid."); return; }
    setBusy(true);
    const { error } = await supabase().auth.updateUser({ password: pw });
    setBusy(false);
    if (error) { setErr(humanError(error)); return; }
    setPw(""); setPw2(""); setOk(true);
  }
  return (
    <Card title="Schimbă parola">
      <form onSubmit={save} className="space-y-3">
        <Field label="Parolă nouă"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        <Field label="Repetă parola nouă"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
        {err && <ErrorBox message={err} />}
        {ok && <Notice tone="green">Parola a fost schimbată.</Notice>}
        <Button type="submit" loading={busy} disabled={!pw || !pw2}>Salvează parola</Button>
      </form>
    </Card>
  );
}
