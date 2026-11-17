import * as webpush from "web-push";
import { NextResponse } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Msg { endpoint: string; p256dh: string; auth: string; title: string; body?: string; url?: string; tag?: string }

/**
 * Trimite notificările push. Apelat doar de baza de date (trigger), autentificat cu un secret comun.
 * Abonamentele expirate (404/410) sunt raportate înapoi ca să fie șterse.
 */
export async function POST(req: Request) {
  const secret = process.env.PUSH_SECRET;
  if (!secret || req.headers.get("x-push-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return NextResponse.json({ error: "push not configured" }, { status: 503 });
  webpush.setVapidDetails("mailto:notificari@dyasplanning.app", pub, priv);

  const { messages } = (await req.json()) as { messages: Msg[] };
  const expired: string[] = [];
  let sent = 0;
  await Promise.all((messages ?? []).slice(0, 500).map(async (m) => {
    try {
      await webpush.sendNotification(
        { endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } },
        JSON.stringify({ title: m.title, body: m.body ?? "", url: m.url ?? "/", tag: m.tag }),
        { TTL: 60 * 60 * 24, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) expired.push(m.endpoint);
    }
  }));

  if (expired.length && SUPABASE_URL) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/prune_push_subscriptions`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_secret: secret, p_endpoints: expired }),
    }).catch(() => undefined);
  }
  return NextResponse.json({ sent, expired: expired.length });
}
