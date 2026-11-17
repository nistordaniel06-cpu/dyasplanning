// Trimitere notificări către aplicația Android prin Firebase Cloud Messaging (API HTTP v1).
// Folosit doar pe server (/api/push). Cheia contului de serviciu stă în FIREBASE_SERVICE_ACCOUNT (JSON).
import { createSign } from "node:crypto";

interface ServiceAccount { project_id: string; client_email: string; private_key: string }

let cached: { token: string; exp: number } | null = null;

export function fcmAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
    return { ...sa, private_key: sa.private_key.replace(/\\n/g, "\n") };
  } catch {
    return null;
  }
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${claims}`);
  const jwt = `${head}.${claims}.${signer.sign(sa.private_key).toString("base64url")}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Firebase auth ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

export interface FcmMsg { token: string; title: string; body?: string; url?: string; tag?: string }

/** Trimite un mesaj; întoarce "ok", "expired" (token-ul nu mai e valid, trebuie șters) sau "error". */
export async function sendFcm(sa: ServiceAccount, m: FcmMsg): Promise<"ok" | "expired" | "error"> {
  const token = await accessToken(sa);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: m.token,
        notification: { title: m.title, body: m.body ?? "" },
        data: { url: m.url ?? "/", tag: m.tag ?? "" },
        android: {
          priority: "HIGH",
          ttl: "86400s",
          notification: { channel_id: "program", tag: m.tag || undefined, default_sound: true },
        },
      },
    }),
  });
  if (res.ok) return "ok";
  if (res.status === 404) return "expired";
  if (res.status === 400) {
    const t = await res.text();
    if (t.includes("UNREGISTERED") || t.includes("registration token")) return "expired";
  }
  return "error";
}
