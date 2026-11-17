// Prefixe de țară pentru numerele de telefon (login + WhatsApp). Ordinea = ordinea din listă.
export interface Country { code: string; dial: string; name: string }

export const COUNTRIES: Country[] = [
  { code: "RO", dial: "40", name: "România" },
  { code: "NL", dial: "31", name: "Olanda" },
  { code: "DE", dial: "49", name: "Germania" },
  { code: "BE", dial: "32", name: "Belgia" },
  { code: "IT", dial: "39", name: "Italia" },
  { code: "ES", dial: "34", name: "Spania" },
  { code: "FR", dial: "33", name: "Franța" },
  { code: "AT", dial: "43", name: "Austria" },
  { code: "GB", dial: "44", name: "Marea Britanie" },
  { code: "IE", dial: "353", name: "Irlanda" },
  { code: "MD", dial: "373", name: "Republica Moldova" },
  { code: "HU", dial: "36", name: "Ungaria" },
  { code: "BG", dial: "359", name: "Bulgaria" },
  { code: "PL", dial: "48", name: "Polonia" },
  { code: "UA", dial: "380", name: "Ucraina" },
  { code: "RS", dial: "381", name: "Serbia" },
  { code: "CZ", dial: "420", name: "Cehia" },
  { code: "SK", dial: "421", name: "Slovacia" },
  { code: "HR", dial: "385", name: "Croația" },
  { code: "GR", dial: "30", name: "Grecia" },
  { code: "PT", dial: "351", name: "Portugalia" },
  { code: "CH", dial: "41", name: "Elveția" },
  { code: "LU", dial: "352", name: "Luxemburg" },
  { code: "DK", dial: "45", name: "Danemarca" },
  { code: "SE", dial: "46", name: "Suedia" },
  { code: "NO", dial: "47", name: "Norvegia" },
  { code: "FI", dial: "358", name: "Finlanda" },
  { code: "CY", dial: "357", name: "Cipru" },
  { code: "MT", dial: "356", name: "Malta" },
  { code: "TR", dial: "90", name: "Turcia" },
  { code: "IL", dial: "972", name: "Israel" },
  { code: "AE", dial: "971", name: "Emiratele Arabe Unite" },
  { code: "US", dial: "1", name: "SUA / Canada" },
];

export function flag(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const TZ_COUNTRY: Record<string, string> = {
  "Europe/Bucharest": "RO", "Europe/Amsterdam": "NL", "Europe/Berlin": "DE", "Europe/Brussels": "BE", "Europe/Rome": "IT",
  "Europe/Madrid": "ES", "Europe/Paris": "FR", "Europe/Vienna": "AT", "Europe/London": "GB", "Europe/Dublin": "IE",
  "Europe/Chisinau": "MD", "Europe/Budapest": "HU", "Europe/Sofia": "BG", "Europe/Warsaw": "PL", "Europe/Kyiv": "UA",
  "Europe/Kiev": "UA", "Europe/Belgrade": "RS", "Europe/Prague": "CZ", "Europe/Bratislava": "SK", "Europe/Zagreb": "HR",
  "Europe/Athens": "GR", "Europe/Lisbon": "PT", "Europe/Zurich": "CH", "Europe/Luxembourg": "LU", "Europe/Copenhagen": "DK",
  "Europe/Stockholm": "SE", "Europe/Oslo": "NO", "Europe/Helsinki": "FI", "Asia/Nicosia": "CY", "Europe/Malta": "MT",
  "Europe/Istanbul": "TR", "Asia/Jerusalem": "IL", "Asia/Dubai": "AE",
};

/** Țara implicită după fusul orar (al firmei sau al telefonului). */
export function countryForTimezone(tz: string | null | undefined): Country {
  const code = (tz && TZ_COUNTRY[tz]) || "RO";
  return COUNTRIES.find((c) => c.code === code) ?? COUNTRIES[0];
}

const digits = (s: string) => (s ?? "").replace(/\D/g, "");

/** Numărul complet (doar cifre, cu prefix): „06 1234 5678” + Olanda → 31612345678. „+…”/„00…” păstrează prefixul scris. */
export function fullDigits(dial: string, local: string): string {
  const raw = (local ?? "").trim();
  const d = digits(raw);
  if (raw.startsWith("+")) return d;
  if (d.startsWith("00")) return d.slice(2);
  const national = dial === "39" ? d : d.replace(/^0+/, ""); // în Italia 0 face parte din număr
  return national ? dial + national : "";
}

/** Formatul salvat: „+31 612345678”. */
export function formatStored(dial: string, local: string): string {
  const full = fullDigits(dial, local);
  if (!full) return "";
  const c = matchCountry(full);
  return c ? `+${c.dial} ${full.slice(c.dial.length)}` : `+${full}`;
}

function matchCountry(full: string): Country | null {
  return [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find((c) => full.startsWith(c.dial)) ?? null;
}

/** Desparte un număr salvat în țară + partea națională (pentru editare). */
export function splitStored(stored: string | null | undefined, fallback: Country): { country: Country; local: string } {
  const raw = (stored ?? "").trim();
  if (!raw) return { country: fallback, local: "" };
  const d = digits(raw);
  if (raw.startsWith("+") || d.startsWith("00")) {
    const full = d.startsWith("00") ? d.slice(2) : d;
    const c = matchCountry(full);
    if (c) return { country: c, local: full.slice(c.dial.length) };
    return { country: fallback, local: raw };
  }
  if (/^0\d{9}$/.test(d)) return { country: COUNTRIES[0], local: d }; // numere vechi, românești
  return { country: fallback, local: raw };
}

/** Verificare simplă: 6–14 cifre fără prefix. */
export function phoneProblem(dial: string, local: string): string | null {
  const full = fullDigits(dial, local);
  if (!full) return null;
  const c = matchCountry(full);
  const national = c ? full.length - c.dial.length : full.length;
  if (national < 6) return "Numărul pare prea scurt.";
  if (national > 14) return "Numărul pare prea lung.";
  return null;
}
