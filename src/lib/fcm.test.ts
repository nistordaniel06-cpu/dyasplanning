import { afterEach, describe, expect, it, vi } from "vitest";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { fcmAccount, sendFcm } from "./fcm";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

afterEach(() => { vi.unstubAllGlobals(); delete process.env.FIREBASE_SERVICE_ACCOUNT; });

describe("FCM", () => {
  it("citește contul de serviciu (cu \\n escapate)", () => {
    process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: "p", client_email: "a@b", private_key: pem.replace(/\n/g, "\\n") });
    expect(fcmAccount()?.private_key).toContain("\n");
    process.env.FIREBASE_SERVICE_ACCOUNT = "{bad";
    expect(fcmAccount()).toBeNull();
  });

  it("semnează JWT-ul, trimite mesajul și recunoaște token-urile expirate", async () => {
    const calls: { url: string; body: string; auth?: string }[] = [];
    let status = 200;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const body = String(init.body);
      calls.push({ url, body, auth: (init.headers as Record<string, string>).Authorization });
      if (url.includes("oauth2")) {
        const jwt = new URLSearchParams(body).get("assertion")!;
        const [h, c, sig] = jwt.split(".");
        const ok = createVerify("RSA-SHA256").update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, "base64url"));
        expect(ok).toBe(true);
        return new Response(JSON.stringify({ access_token: "AT", expires_in: 3600 }));
      }
      return new Response(status === 200 ? "{}" : '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', { status });
    }));
    const sa = { project_id: "dyas", client_email: "x@y", private_key: pem };
    expect(await sendFcm(sa, { token: "TOK", title: "Program nou", body: "Luni", url: "/program", tag: "assignment" })).toBe("ok");
    const send = calls.find((c) => c.url.includes("fcm.googleapis.com/v1/projects/dyas/messages:send"))!;
    expect(send.auth).toBe("Bearer AT");
    const msg = JSON.parse(send.body).message;
    expect(msg.token).toBe("TOK");
    expect(msg.data.url).toBe("/program");
    expect(msg.android.notification.channel_id).toBe("program");
    status = 404;
    expect(await sendFcm(sa, { token: "OLD", title: "x" })).toBe("expired");
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1); // token reutilizat
  });
});
