"use client";
// Legătura cu aplicația Android (Capacitor). Pe site-ul obișnuit, funcțiile nu fac nimic.

interface ScreenGuard { setSecure(o: { secure: boolean }): Promise<unknown> }
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  registerPlugin?: <T>(name: string) => T;
  Plugins?: Record<string, unknown>;
}

function cap(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNativeApp(): boolean {
  return !!cap()?.isNativePlatform?.();
}

let guard: ScreenGuard | null = null;
/** Blochează (true) sau permite (false) capturile de ecran în aplicația Android. */
export async function setScreenSecure(secure: boolean): Promise<void> {
  const c = cap();
  if (!c?.isNativePlatform?.()) return;
  try {
    guard ??= (c.registerPlugin ? c.registerPlugin<ScreenGuard>("ScreenGuard") : (c.Plugins?.ScreenGuard as ScreenGuard | undefined)) ?? null;
    await guard?.setSecure({ secure });
  } catch {
    /* fără plugin: rămâne blocat (implicit în aplicație) */
  }
}

// ---------- Notificări în aplicația Android (Firebase Cloud Messaging) ----------
interface Listener { remove(): Promise<void> }
interface PushPlugin {
  checkPermissions(): Promise<{ receive: string }>;
  requestPermissions(): Promise<{ receive: string }>;
  register(): Promise<void>;
  addListener(ev: string, cb: (d: unknown) => void): Promise<Listener>;
}
interface PushGuard { pushAvailable(): Promise<{ available: boolean }> }

let pushStarted = false;
let lastToken: string | null = null;
let saver: ((token: string) => Promise<void>) | null = null;
/** Token-ul Firebase al acestui telefon (după înregistrare), ca să poată fi șters la deconectare. */
export function nativePushToken(): string | null { return lastToken; }
/**
 * În aplicația Android: cere permisiunea de notificări, ia token-ul Firebase și îl salvează pe server
 * (în aceeași tabelă ca abonamentele web, cu prefixul „fcm:”). Pe site nu face nimic.
 */
export async function startNativePush(save: (token: string) => Promise<void>, open: (url: string) => void): Promise<void> {
  const c = cap();
  saver = save;
  if (lastToken) { void save(lastToken); } // alt utilizator s-a conectat pe același telefon
  if (pushStarted || !c?.isNativePlatform?.() || !c.registerPlugin) return;
  pushStarted = true;
  try {
    const g = c.registerPlugin<PushGuard>("ScreenGuard");
    const ok = await g.pushAvailable?.().then((r) => r.available).catch(() => false);
    if (!ok) return; // aplicație construită fără Firebase
    const push = c.registerPlugin<PushPlugin>("PushNotifications");
    await push.addListener("registration", (d) => { lastToken = (d as { value: string }).value; void saver?.(lastToken); });
    await push.addListener("pushNotificationActionPerformed", (d) => {
      const url = (d as { notification?: { data?: { url?: string } } }).notification?.data?.url;
      if (url && url.startsWith("/")) open(url);
    });
    let perm = (await push.checkPermissions()).receive;
    if (perm === "prompt" || perm === "prompt-with-rationale") perm = (await push.requestPermissions()).receive;
    if (perm === "granted") await push.register();
  } catch {
    pushStarted = false;
  }
}
