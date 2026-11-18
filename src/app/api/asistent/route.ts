import { NextResponse } from "next/server";
import { TOOLS, contextFor, describe, runReadTool, systemPrompt, type Action } from "@/lib/assistant/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
type Msg = { role: "user" | "assistant"; content: string | unknown[] };

const API = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com";
const MODEL = process.env.ASSISTANT_MODEL ?? "claude-haiku-5-5";

async function claude(system: string, messages: Msg[]) {
  const r = await fetch(`${API}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, system, tools: TOOLS, messages }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as { content: Block[]; stop_reason: string };
}

/** Conversația cu asistentul: citirile se fac aici, modificările se întorc ca propunere de confirmat. */
export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Asistentul AI nu este activat încă. Proprietarul aplicației trebuie să adauge cheia ANTHROPIC_API_KEY în Vercel." }, { status: 503 });
  }
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ctx = await contextFor(token);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const body = (await req.json().catch(() => ({}))) as { messages?: { role: string; content: string }[] };
  const history: Msg[] = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20).map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 4000) }));
  if (!history.length || history[history.length - 1].role !== "user") return NextResponse.json({ error: "Scrie un mesaj." }, { status: 400 });
  while (history.length && history[0].role !== "user") history.shift();

  const system = systemPrompt(ctx);
  const msgs: Msg[] = [...history];
  try {
    for (let step = 0; step < 8; step++) {
      const res = await claude(system, msgs);
      const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
      const uses = res.content.filter((b) => b.type === "tool_use");
      const propose = uses.find((u) => u.name === "propune_actiuni");
      if (propose) {
        const p = propose.input as { rezumat?: string; actiuni?: Action[] };
        const actiuni = (p.actiuni ?? []).filter((a) => a && typeof a.tip === "string").slice(0, 20);
        if (!actiuni.length) return NextResponse.json({ text: text || "Nu am găsit ce să modific." });
        return NextResponse.json({ text, proposal: { rezumat: p.rezumat ?? "", actiuni, descrieri: await describe(ctx, actiuni) } });
      }
      if (!uses.length) return NextResponse.json({ text: text || "…" });
      msgs.push({ role: "assistant", content: res.content });
      const results = [];
      for (const u of uses) {
        let out: unknown;
        try { out = await runReadTool(ctx, String(u.name), (u.input ?? {}) as Record<string, unknown>); }
        catch (e) { out = { eroare: e instanceof Error ? e.message : String(e) }; }
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out).slice(0, 20000) });
      }
      msgs.push({ role: "user", content: results });
    }
    return NextResponse.json({ text: "Cererea e prea complicată pentru un singur pas. Împarte-o în bucăți mai mici." });
  } catch (e) {
    console.error("asistent", e);
    return NextResponse.json({ error: "Asistentul nu răspunde acum. Încearcă din nou peste un minut." }, { status: 502 });
  }
}
