import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email către proprietarul aplicației (alerte: firmă nouă, probă care expiră, firmă inactivă).
 * Apelat doar de baza de date, cu secretul intern. Trimite prin Resend dacă RESEND_API_KEY e setat.
 */
export async function POST(req: Request) {
  const secret = process.env.PUSH_SECRET;
  if (!secret || req.headers.get("x-push-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ sent: false, reason: "email neconfigurat" });

  const { to, subject, text } = (await req.json()) as { to: string[]; subject: string; text: string };
  const override = process.env.OWNER_ALERT_EMAIL;
  const recipients = override ? override.split(",").map((s) => s.trim()).filter(Boolean) : (to ?? []).slice(0, 5);
  if (!recipients.length || !subject) return NextResponse.json({ sent: false, reason: "fără destinatar" });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.ALERT_FROM ?? "DYASPlanning <onboarding@resend.dev>",
      to: recipients,
      subject: `[DYASPlanning] ${subject}`,
      text: `${text}\n\nPanoul proprietarului: https://dyasplanning.vercel.app/proprietar`,
    }),
  });
  return NextResponse.json({ sent: res.ok, status: res.status });
}
