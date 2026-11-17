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
