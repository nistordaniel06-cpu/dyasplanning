import { NextResponse } from "next/server";
import { contextFor, execute, type Action } from "@/lib/assistant/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Execută acțiunile propuse de asistent, după ce administratorul a apăsat „Confirmă”. */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ctx = await contextFor(token);
  if ("error" in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const body = (await req.json().catch(() => ({}))) as { actiuni?: Action[] };
  const actiuni = (body.actiuni ?? []).filter((a) => a && typeof a.tip === "string");
  if (!actiuni.length) return NextResponse.json({ error: "Nicio acțiune de executat." }, { status: 400 });
  return NextResponse.json({ results: await execute(ctx, actiuni) });
}
