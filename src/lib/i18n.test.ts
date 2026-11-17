import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { translateText } from "./i18n";

const samples = [
  "Pontaj nou: Ion Stan",
  "Programul tău s-a schimbat",
  "Casă Ploiești · Montaj rigips · Lun 18.11 08:00–16:00",
  "Km: Ford Transit (B 123 ABC)",
  "123.456 km (+184 km de la ultima citire) · Ion Stan",
  "Cristi a adăugat 3 alocări",
  "Mesaj de la Ana",
  "Firmă nouă: Bouw BV",
];

describe("traducere în engleză", () => {
  it("texte exacte, cu spațiile păstrate", () => {
    expect(translateText("Salvează")).toBe("Save");
    expect(translateText("  Ieșire ")).toBe("  Sign out ");
    expect(translateText("Ion Popescu")).toBeNull();
  });
  it("texte cu nume și cifre", () => {
    expect(translateText("Pontaj nou: Ion Stan")).toBe("New timesheet: Ion Stan");
    expect(translateText("acum 5 min")).toBe("5 min ago");
    expect(translateText("Notificări, 3 necitite")).toBe("Notifications, 3 unread");
    expect(translateText("Cristi a adăugat 3 alocări")).toBe("Cristi added 3 assignments");
    expect(translateText("Dan a modificat setările firmei")).toBe("Dan updated the company settings");
    expect(translateText("Casă Ploiești · Lun 18.11 08:00–16:00")).toBe("Casă Ploiești · Mon 18.11 08:00–16:00");
    expect(translateText("Kilometrajul introdus (100 km) este mai mic decât ultima citire (200 km, din 17.11.2026). Verifică cifrele de pe bord."))
      .toBe("The mileage entered (100 km) is lower than the last reading (200 km, from 17.11.2026). Check the dashboard digits.");
  });
  it("service worker-ul traduce la fel ca aplicația", async () => {
    const code = readFileSync("public/sw.js", "utf8");
    const ctx: Record<string, unknown> = { self: { addEventListener: () => {} }, Map, RegExp, Object, Number };
    vm.createContext(ctx);
    vm.runInContext(code + "\n;globalThis.__t = translate;", ctx);
    const d = JSON.parse(readFileSync("public/i18n-en.json", "utf8"));
    const D = { exact: new Map(Object.entries(d.exact)), patterns: d.patterns.map(([r, o]: [string, string]) => [new RegExp(r), o]), inline: d.inline.map(([r, m]: [string, Record<string, string>]) => [new RegExp(r, "g"), m]) };
    const t = (ctx as { __t: (D: unknown, s: string) => string }).__t;
    for (const s of samples) expect(t(D, s)).toBe(translateText(s) ?? s);
  });
});
