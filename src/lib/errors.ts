/** Transformă erorile Supabase/PostgreSQL în mesaje clare, în română. */
export function humanError(err: unknown): string {
  if (!err) return "Eroare necunoscută.";
  const e = err as { message?: string; code?: string; details?: string };
  const msg = e.message ?? String(err);
  if (e.code === "23P01" || msg.includes("assignments_no_overlap"))
    return "Alocarea se suprapune cu o altă alocare a aceluiași angajat. Nu s-a salvat nimic.";
  if (msg.includes("time_entries_no_overlap"))
    return "Pontajul se suprapune cu un alt pontaj al aceluiași angajat. Nu s-a salvat nimic.";
  if (msg.includes("time_entries_reject_reason")) return "La respingere trebuie completat motivul.";
  if (msg.includes("time_entries_check")) return "Intervalul nu este valid (verifică orele și pauza).";
  if (msg.includes("assignments_check")) return "Intervalul alocării nu este valid (verifică orele și pauza).";
  if (e.code === "42501" && msg.includes("row-level security"))
    return "Nu ai dreptul să faci această modificare.";
  if (e.code === "23503") return "Elementul este folosit în altă parte și nu poate fi șters.";
  if (e.code === "23505") return msg.includes("teams_company_id_name") ? "Există deja o echipă cu acest nume." : msg;
  if (msg === "Failed to fetch" || msg.includes("NetworkError"))
    return "Nu există conexiune la server. Verifică internetul și încearcă din nou.";
  if (msg.includes("Invalid login credentials")) return "Email sau parolă greșită.";
  if (msg.includes("Email not confirmed")) return "Confirmă adresa de email din mesajul primit, apoi autentifică-te.";
  if (msg.includes("User already registered")) return "Există deja un cont cu acest email. Autentifică-te.";
  if (msg.includes("Password should be at least")) return "Parola trebuie să aibă cel puțin 6 caractere.";
  return msg;
}
