/** Identic cu norm_phone() din baza de date. 07xxxxxxxx (RO) → 407xxxxxxxx; 00/+ → prefix internațional. */
export function normPhone(p: string): string {
  const d = (p ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) return d.slice(2);
  if (/^0\d{9}$/.test(d)) return "4" + d;
  return d;
}

export const PHONE_EMAIL_DOMAIN = "@telefon.dyasplanning.app";

export function phoneLoginEmail(p: string): string {
  return `t${normPhone(p)}${PHONE_EMAIL_DOMAIN}`;
}

/** Afișează contul: numărul de telefon pentru conturile de angajat, altfel emailul. */
export function displayLogin(email: string | null | undefined): string {
  if (!email) return "—";
  if (email.endsWith(PHONE_EMAIL_DOMAIN)) return "+" + email.slice(1, -PHONE_EMAIL_DOMAIN.length);
  return email;
}

export function looksLikeEmail(v: string): boolean {
  return v.includes("@");
}

/** Link WhatsApp către un număr (wa.me cere doar cifre, cu prefix de țară). */
export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${normPhone(phone)}?text=${encodeURIComponent(text)}`;
}

/** Adresa ascunsă pentru crearea contului de administrator (nu apare nicăieri în aplicație). */
export const HIDDEN_SIGNUP_PATH = "/creare-cont-dyas-7k2m";
