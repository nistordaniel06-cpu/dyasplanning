// Asistentul AI pentru administratorii firmelor (doar pe server).
// Citirile se fac imediat; modificările sunt doar PROPUSE și se execută după ce adminul apasă „Confirmă”.
// Toate cererile către baza de date folosesc tokenul adminului, deci regulile de acces (RLS) se aplică exact ca în aplicație.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { SUPABASE_KEY, SUPABASE_URL } from "../supabase/env";

type Row = Record<string, unknown>;
export interface Ctx {
  sb: SupabaseClient; userId: string; companyId: string; tz: string;
  schedule: { start: string; end: string; breakMin: number };
}

export async function contextFor(token: string): Promise<Ctx | { error: string; status: number }> {
  if (!SUPABASE_URL) return { error: "Aplicația nu e configurată.", status: 500 };
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u } = await sb.auth.getUser(token);
  if (!u.user) return { error: "Trebuie să fii autentificat.", status: 401 };
  const { data: m } = await sb.from("memberships").select("company_id, role").eq("user_id", u.user.id).maybeSingle();
  if (!m || m.role !== "admin") return { error: "Asistentul este disponibil doar pentru administratorii firmei.", status: 403 };
  const { data: c } = await sb.from("companies").select("timezone, default_work_start, default_work_end, default_break_minutes, status").eq("id", m.company_id).single();
  if (c?.status === "suspendat") return { error: "Firma este suspendată.", status: 403 };
  return {
    sb, userId: u.user.id, companyId: m.company_id as string, tz: (c?.timezone as string) ?? "Europe/Bucharest",
    schedule: { start: String(c?.default_work_start ?? "07:00").slice(0, 5), end: String(c?.default_work_end ?? "16:00").slice(0, 5), breakMin: Number(c?.default_break_minutes ?? 60) },
  };
}

const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const isDate = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
const must = <T>(r: { data: T | null; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data as T; };

// ================== instrumente pentru model ==================
export const TOOLS = [
  { name: "cauta_angajati", description: "Caută angajații firmei după nume (sau toți, dacă textul lipsește). Folosește-l ÎNAINTE de orice acțiune cu angajați, ca să afli id-urile exacte.",
    input_schema: { type: "object", properties: { text: { type: "string", description: "nume sau parte din nume; gol = toți" }, doar_soferi: { type: "boolean" } } } },
  { name: "lista_lucrari", description: "Lucrările (proiectele) firmei, cu id, client, oraș, status și date.",
    input_schema: { type: "object", properties: { text: { type: "string" }, doar_active: { type: "boolean" } } } },
  { name: "lista_masini", description: "Mașinile firmei.", input_schema: { type: "object", properties: {} } },
  { name: "lista_echipe", description: "Echipele firmei, cu șeful și membrii.", input_schema: { type: "object", properties: {} } },
  { name: "program", description: "Programul (alocările) dintr-o perioadă, opțional pe o lucrare sau un angajat. Pentru întrebări de tipul „cine lucrează mâine la X”.",
    input_schema: { type: "object", properties: { de_la: { type: "string", description: "YYYY-MM-DD" }, pana_la: { type: "string", description: "YYYY-MM-DD" }, lucrare_id: { type: "string" }, angajat_id: { type: "string" } }, required: ["de_la", "pana_la"] } },
  { name: "pontaje_de_aprobat", description: "Câte pontaje așteaptă aprobarea și de la cine.", input_schema: { type: "object", properties: {} } },
  { name: "propune_actiuni",
    description: "Propune administratorului modificările de făcut. NIMIC nu se salvează până nu apasă „Confirmă”. Folosește id-uri reale (din căutări). Pentru o lucrare creată în aceeași propunere, dă-i un „ref” (ex. \"L1\") și folosește lucrare_ref în acțiunile următoare.",
    input_schema: { type: "object", required: ["rezumat", "actiuni"], properties: {
      rezumat: { type: "string", description: "Ce urmează să faci, într-o propoziție, în română." },
      actiuni: { type: "array", items: { type: "object", required: ["tip"], properties: {
        tip: { type: "string", enum: ["creeaza_lucrare", "adauga_angajat", "adauga_masina", "aloca_angajati", "adauga_misiune", "adauga_absenta", "schimba_status_lucrare", "adauga_echipa"] },
        ref: { type: "string" }, nume: { type: "string" }, client: { type: "string" }, adresa: { type: "string" }, oras: { type: "string" },
        persoana_contact: { type: "string" }, telefon_contact: { type: "string" }, descriere: { type: "string" },
        data_inceput: { type: "string", description: "YYYY-MM-DD" }, data_sfarsit: { type: "string", description: "YYYY-MM-DD" }, termen: { type: "string", description: "YYYY-MM-DD" },
        telefon: { type: "string" }, meserie: { type: "string" }, echipa_id: { type: "string" }, sofer: { type: "boolean" },
        nr_inmatriculare: { type: "string" },
        lucrare_id: { type: "string" }, lucrare_ref: { type: "string" }, angajati_ids: { type: "array", items: { type: "string" } },
        ora_inceput: { type: "string", description: "HH:MM" }, ora_sfarsit: { type: "string", description: "HH:MM" }, pauza_min: { type: "integer" },
        include_weekend: { type: "boolean" }, misiune: { type: "string" },
        angajat_id: { type: "string" }, tip_absenta: { type: "string", enum: ["concediu", "medical", "absent", "alt_motiv"] }, nota: { type: "string" },
        status: { type: "string", enum: ["planificata", "in_desfasurare", "suspendata", "finalizata", "anulata"] },
        sef_id: { type: "string" }, membri_ids: { type: "array", items: { type: "string" } },
      } } },
    } } },
] as const;

export function systemPrompt(ctx: Ctx): string {
  const today = formatInTimeZone(new Date(), ctx.tz, "yyyy-MM-dd (EEEE)");
  return [
    "Ești asistentul aplicației DYASPlanning (planning și pontaj pentru firme de construcții). Vorbești cu ADMINISTRATORUL unei firme, în română, scurt și clar, ca un coleg de birou.",
    `Azi este ${today}, fusul orar ${ctx.tz}. Programul implicit al firmei: ${ctx.schedule.start}–${ctx.schedule.end}, pauză ${ctx.schedule.breakMin} min.`,
    "Poți: crea lucrări, adăuga angajați, adăuga mașini, aloca angajați pe lucrări (program), adăuga misiuni, trece absențe/concedii, schimba statusul unei lucrări, crea echipe; și poți răspunde la întrebări despre angajați, lucrări, mașini, program și pontaje.",
    "Reguli:",
    "1. Caută întâi (cauta_angajati, lista_lucrari etc.) ca să folosești id-urile reale. Nu inventa id-uri.",
    "2. Dacă un nume se potrivește cu mai mulți angajați sau cu niciunul, întreabă înainte să propui. Dacă un angajat cerut nu există, spune și oferă-te să-l adaugi.",
    "3. Orice modificare o faci DOAR prin propune_actiuni, o singură dată pe răspuns, cu toate acțiunile împreună. Adminul o confirmă din aplicație.",
    "4. Datele relative („mâine”, „luni”, „săptămâna viitoare”) le transformi în date exacte YYYY-MM-DD față de azi. Dacă nu se spune perioada la alocare, întreabă de când până când; dacă se spune doar o zi, folosește acea zi.",
    "5. La alocare, dacă nu se spun orele, folosește programul implicit al fiecărui angajat (nu trimite ora_inceput/ora_sfarsit). Weekendul se sare dacă nu se cere altfel.",
    "6. La o lucrare nouă cu angajați: creeaza_lucrare (cu ref) + aloca_angajati cu lucrare_ref, în aceeași propunere. Dacă nu se spune data de început, folosește azi pentru lucrare, dar pentru alocare întreabă perioada.",
    "7. Nu ai acces la salarii, parole, ștergeri de date sau setările aplicației. Dacă ți se cere așa ceva, spune ce pagină din aplicație să folosească.",
    "8. Răspunsurile text: fără titluri mari, maxim câteva rânduri; liste scurte doar când ajută.",
  ].join("\n");
}

// ================== citiri ==================
export async function runReadTool(ctx: Ctx, name: string, input: Row): Promise<unknown> {
  const { sb } = ctx;
  switch (name) {
    case "cauta_angajati": {
      const [emps, teams, veh] = await Promise.all([
        sb.from("employees").select("id, full_name, trade, team_id, is_driver, active, phone, default_vehicle_id").order("full_name").then(must) as Promise<Row[]>,
        sb.from("teams").select("id, name").then(must) as Promise<Row[]>,
        sb.from("vehicles").select("id, name").then(must) as Promise<Row[]>,
      ]);
      const q = norm(input.text);
      const tName = new Map(teams.map((t) => [t.id, t.name])), vName = new Map(veh.map((v) => [v.id, v.name]));
      const list = emps.filter((e) => e.active !== false)
        .filter((e) => !q || norm(e.full_name).split(/\s+/).some((w) => w.startsWith(q)) || norm(e.full_name).includes(q))
        .filter((e) => !input.doar_soferi || e.is_driver);
      return list.slice(0, 60).map((e) => ({ id: e.id, nume: e.full_name, meserie: e.trade, echipa: tName.get(e.team_id) ?? null, sofer: e.is_driver, masina: vName.get(e.default_vehicle_id) ?? null, telefon: e.phone }));
    }
    case "lista_lucrari": {
      const rows = (await sb.from("projects").select("id, name, client_name, city, address, status, start_date, due_date").order("created_at", { ascending: false }).then(must)) as Row[];
      const q = norm(input.text);
      return rows.filter((p) => !q || norm(p.name).includes(q) || norm(p.client_name).includes(q) || norm(p.city).includes(q))
        .filter((p) => !input.doar_active || ["planificata", "in_desfasurare"].includes(String(p.status)))
        .slice(0, 60).map((p) => ({ id: p.id, nume: p.name, client: p.client_name, oras: p.city, adresa: p.address, status: p.status, inceput: p.start_date, termen: p.due_date }));
    }
    case "lista_masini":
      return ((await sb.from("vehicles").select("id, name, plate, active").order("name").then(must)) as Row[]).map((v) => ({ id: v.id, nume: v.name, nr: v.plate, activa: v.active }));
    case "lista_echipe": {
      const [teams, emps] = await Promise.all([
        sb.from("teams").select("id, name, leader_employee_id").then(must) as Promise<Row[]>,
        sb.from("employees").select("id, full_name, team_id").eq("active", true).then(must) as Promise<Row[]>,
      ]);
      const n = new Map(emps.map((e) => [e.id, e.full_name]));
      return teams.map((t) => ({ id: t.id, nume: t.name, sef: n.get(t.leader_employee_id) ?? null, membri: emps.filter((e) => e.team_id === t.id).map((e) => e.full_name) }));
    }
    case "program": {
      if (!isDate(input.de_la) || !isDate(input.pana_la)) return { eroare: "de_la și pana_la trebuie să fie YYYY-MM-DD" };
      const from = fromZonedTime(`${input.de_la}T00:00:00`, ctx.tz).toISOString();
      const to = fromZonedTime(`${input.pana_la}T23:59:59`, ctx.tz).toISOString();
      let q = sb.from("assignments").select("employee_id, project_id, starts_at, ends_at, status").gte("starts_at", from).lte("starts_at", to).neq("status", "anulata").order("starts_at").limit(400);
      if (input.lucrare_id) q = q.eq("project_id", input.lucrare_id as string);
      if (input.angajat_id) q = q.eq("employee_id", input.angajat_id as string);
      const [rows, emps, projs] = await Promise.all([
        q.then(must) as Promise<Row[]>,
        sb.from("employees").select("id, full_name").then(must) as Promise<Row[]>,
        sb.from("projects").select("id, name").then(must) as Promise<Row[]>,
      ]);
      const en = new Map(emps.map((e) => [e.id, e.full_name])), pn = new Map(projs.map((p) => [p.id, p.name]));
      return rows.map((a) => ({ data: formatInTimeZone(String(a.starts_at), ctx.tz, "yyyy-MM-dd"), angajat: en.get(a.employee_id), lucrare: pn.get(a.project_id),
        interval: `${formatInTimeZone(String(a.starts_at), ctx.tz, "HH:mm")}–${formatInTimeZone(String(a.ends_at), ctx.tz, "HH:mm")}` }));
    }
    case "pontaje_de_aprobat": {
      const [rows, emps] = await Promise.all([
        sb.from("time_entries").select("employee_id").eq("status", "trimis").limit(1000).then(must) as Promise<Row[]>,
        sb.from("employees").select("id, full_name").then(must) as Promise<Row[]>,
      ]);
      const en = new Map(emps.map((e) => [e.id, e.full_name]));
      const by = new Map<string, number>();
      for (const r of rows) by.set(String(en.get(r.employee_id) ?? "?"), (by.get(String(en.get(r.employee_id) ?? "?")) ?? 0) + 1);
      return { total: rows.length, pe_angajat: Object.fromEntries(by), unde: "Pontaje → filtrul „De aprobat”" };
    }
  }
  return { eroare: `Instrument necunoscut: ${name}` };
}

// ================== propuneri: descriere + validare ==================
export interface Action extends Row { tip: string }
export interface Proposal { rezumat: string; actiuni: Action[]; descrieri: string[] }

const ABS: Record<string, string> = { concediu: "concediu", medical: "concediu medical", absent: "absent", alt_motiv: "indisponibil" };
const STAT: Record<string, string> = { planificata: "planificată", in_desfasurare: "în desfășurare", suspendata: "suspendată", finalizata: "finalizată", anulata: "anulată" };
const roDate = (d: unknown) => (isDate(d) ? `${String(d).slice(8, 10)}.${String(d).slice(5, 7)}.${String(d).slice(0, 4)}` : "");

/** Text pe înțeles pentru fiecare acțiune (cu numele reale), afișat înainte de „Confirmă”. */
export async function describe(ctx: Ctx, actions: Action[]): Promise<string[]> {
  const [emps, projs, teams] = await Promise.all([
    ctx.sb.from("employees").select("id, full_name").then(must) as Promise<Row[]>,
    ctx.sb.from("projects").select("id, name").then(must) as Promise<Row[]>,
    ctx.sb.from("teams").select("id, name").then(must) as Promise<Row[]>,
  ]);
  const en = new Map(emps.map((e) => [e.id, String(e.full_name)])), pn = new Map(projs.map((p) => [p.id, String(p.name)])), tn = new Map(teams.map((t) => [t.id, String(t.name)]));
  const refs = new Map(actions.filter((a) => a.tip === "creeaza_lucrare" && a.ref).map((a) => [String(a.ref), String(a.nume)]));
  const proj = (a: Action) => (a.lucrare_ref ? refs.get(String(a.lucrare_ref)) : pn.get(a.lucrare_id)) ?? "lucrare necunoscută";
  const who = (ids: unknown) => (Array.isArray(ids) ? ids.map((i) => en.get(i) ?? "angajat necunoscut").join(", ") : "");
  return actions.map((a) => {
    switch (a.tip) {
      case "creeaza_lucrare": return `Lucrare nouă: „${a.nume}”${a.client ? `, client ${a.client}` : ""}${a.oras || a.adresa ? `, ${[a.adresa, a.oras].filter(Boolean).join(", ")}` : ""}${a.data_inceput ? `, din ${roDate(a.data_inceput)}` : ""}${a.termen ? `, termen ${roDate(a.termen)}` : ""}`;
      case "adauga_angajat": return `Angajat nou: ${a.nume}${a.meserie ? ` (${a.meserie})` : ""}${a.telefon ? `, tel. ${a.telefon}` : ""}${a.echipa_id ? `, echipa ${tn.get(a.echipa_id) ?? "?"}` : ""}${a.sofer ? ", șofer" : ""}`;
      case "adauga_masina": return `Mașină nouă: ${a.nume}${a.nr_inmatriculare ? ` (${a.nr_inmatriculare})` : ""}`;
      case "aloca_angajati": {
        const per = a.data_sfarsit && a.data_sfarsit !== a.data_inceput ? `${roDate(a.data_inceput)} – ${roDate(a.data_sfarsit)}${a.include_weekend ? " (inclusiv weekend)" : ", fără weekend"}` : roDate(a.data_inceput);
        const ore = isTime(a.ora_inceput) && isTime(a.ora_sfarsit) ? `${a.ora_inceput}–${a.ora_sfarsit}` : "programul obișnuit al fiecăruia";
        return `Alocă pe „${proj(a)}”: ${who(a.angajati_ids)} · ${per} · ${ore}${a.misiune ? ` · misiunea „${a.misiune}”` : ""}`;
      }
      case "adauga_misiune": return `Misiune nouă la „${proj(a)}”: ${a.nume}${a.termen ? `, termen ${roDate(a.termen)}` : ""}`;
      case "adauga_absenta": return `${ABS[String(a.tip_absenta)] ?? "Absență"} pentru ${en.get(a.angajat_id) ?? "angajat necunoscut"}: ${roDate(a.data_inceput)}${a.data_sfarsit && a.data_sfarsit !== a.data_inceput ? ` – ${roDate(a.data_sfarsit)}` : ""}`.replace(/^./, (c) => c.toUpperCase());
      case "schimba_status_lucrare": return `Lucrarea „${proj(a)}” devine ${STAT[String(a.status)] ?? a.status}`;
      case "adauga_echipa": return `Echipă nouă: ${a.nume}${a.sef_id ? `, șef ${en.get(a.sef_id) ?? "?"}` : ""}${Array.isArray(a.membri_ids) && a.membri_ids.length ? `, membri: ${who(a.membri_ids)}` : ""}`;
      default: return `Acțiune necunoscută (${a.tip})`;
    }
  });
}

// ================== execuție (după „Confirmă”) ==================
export async function execute(ctx: Ctx, actions: Action[]): Promise<{ ok: boolean; text: string; link?: string }[]> {
  const { sb, companyId: cid, tz } = ctx;
  const refs = new Map<string, string>();
  const out: { ok: boolean; text: string; link?: string }[] = [];
  const projectOf = (a: Action) => (a.lucrare_ref ? refs.get(String(a.lucrare_ref)) : (a.lucrare_id as string | undefined));
  for (const a of actions.slice(0, 20)) {
    try {
      switch (a.tip) {
        case "creeaza_lucrare": {
          if (!a.nume) throw new Error("Lipsește numele lucrării.");
          const { count } = await sb.from("projects").select("id", { count: "exact", head: true });
          const COLORS = ["#2563eb", "#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#ca8a04", "#4f46e5"];
          const p = must(await sb.from("projects").insert({
            company_id: cid, name: String(a.nume).trim(), client_name: a.client ?? null, address: a.adresa ?? null, city: a.oras ?? null,
            contact_name: a.persoana_contact ?? null, contact_phone: a.telefon_contact ?? null, description: a.descriere ?? null,
            start_date: isDate(a.data_inceput) ? a.data_inceput : formatInTimeZone(new Date(), tz, "yyyy-MM-dd"), due_date: isDate(a.termen) ? a.termen : null,
            status: "planificata", color: COLORS[(count ?? 0) % COLORS.length],
          }).select("id, name").single()) as Row;
          if (a.ref) refs.set(String(a.ref), String(p.id));
          out.push({ ok: true, text: `Lucrarea „${p.name}” a fost creată.`, link: `/lucrari/${p.id}` });
          break;
        }
        case "adauga_angajat": {
          if (!a.nume) throw new Error("Lipsește numele angajatului.");
          const e = must(await sb.from("employees").insert({
            company_id: cid, full_name: String(a.nume).trim(), phone: a.telefon ?? null, trade: a.meserie ?? null,
            team_id: a.echipa_id ?? null, is_driver: !!a.sofer,
            work_start: ctx.schedule.start, work_end: ctx.schedule.end, break_minutes: ctx.schedule.breakMin,
          }).select("id, full_name").single()) as Row;
          out.push({ ok: true, text: `${e.full_name} a fost adăugat. Pentru cont în aplicație, generează-i un cod de acces din fișa lui.`, link: `/angajati/${e.id}` });
          break;
        }
        case "adauga_masina": {
          if (!a.nume) throw new Error("Lipsește numele mașinii.");
          must(await sb.from("vehicles").insert({ company_id: cid, name: String(a.nume).trim(), plate: a.nr_inmatriculare ? String(a.nr_inmatriculare).toUpperCase() : null }).select("id").single());
          out.push({ ok: true, text: `Mașina ${a.nume} a fost adăugată.`, link: "/masini" });
          break;
        }
        case "adauga_misiune": {
          const pid = projectOf(a);
          if (!pid || !a.nume) throw new Error("Lipsesc lucrarea sau numele misiunii.");
          must(await sb.from("tasks").insert({ company_id: cid, project_id: pid, name: String(a.nume).trim(), due_date: isDate(a.termen) ? a.termen : null }).select("id").single());
          out.push({ ok: true, text: `Misiunea „${a.nume}” a fost adăugată.`, link: `/lucrari/${pid}` });
          break;
        }
        case "aloca_angajati": out.push(await allocate(ctx, a, projectOf(a))); break;
        case "adauga_absenta": {
          if (!a.angajat_id || !isDate(a.data_inceput)) throw new Error("Lipsesc angajatul sau data.");
          const type = ["concediu", "medical", "absent", "alt_motiv"].includes(String(a.tip_absenta)) ? a.tip_absenta : "concediu";
          must(await sb.from("absences").insert({ company_id: cid, employee_id: a.angajat_id, type, start_date: a.data_inceput,
            end_date: isDate(a.data_sfarsit) ? a.data_sfarsit : a.data_inceput, note: a.nota ?? null }).select("id").single());
          out.push({ ok: true, text: "Absența a fost trecută.", link: `/angajati/${a.angajat_id}` });
          break;
        }
        case "schimba_status_lucrare": {
          const pid = projectOf(a);
          if (!pid || !a.status) throw new Error("Lipsesc lucrarea sau statusul.");
          must(await sb.from("projects").update({ status: a.status }).eq("id", pid).select("id").single());
          out.push({ ok: true, text: `Statusul lucrării a fost schimbat (${STAT[String(a.status)] ?? a.status}).`, link: `/lucrari/${pid}` });
          break;
        }
        case "adauga_echipa": {
          if (!a.nume) throw new Error("Lipsește numele echipei.");
          const t = must(await sb.from("teams").insert({ company_id: cid, name: String(a.nume).trim(), leader_employee_id: a.sef_id ?? null }).select("id").single()) as Row;
          const ids = [...new Set([...(Array.isArray(a.membri_ids) ? a.membri_ids : []), ...(a.sef_id ? [a.sef_id] : [])])];
          if (ids.length) must(await sb.from("employees").update({ team_id: t.id }).in("id", ids).select("id"));
          out.push({ ok: true, text: `Echipa ${a.nume} a fost creată.`, link: "/setari" });
          break;
        }
        default: out.push({ ok: false, text: `Acțiune necunoscută: ${a.tip}` });
      }
    } catch (e) {
      out.push({ ok: false, text: friendly(e) });
    }
  }
  return out;
}

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/assignments_no_overlap|exclusion/i.test(m)) return "Unele alocări se suprapun cu programul existent.";
  if (/row-level security|permission/i.test(m)) return "Nu ai dreptul să faci această modificare.";
  return m;
}

/** Creează programul zi de zi; zilele care se suprapun cu alt program sau cu o absență sunt sărite (și raportate). */
async function allocate(ctx: Ctx, a: Action, pid: string | undefined) {
  const { sb, tz, companyId: cid } = ctx;
  if (!pid) throw new Error("Lipsește lucrarea pentru alocare.");
  const ids = Array.isArray(a.angajati_ids) ? (a.angajati_ids as string[]) : [];
  if (!ids.length || !isDate(a.data_inceput)) throw new Error("Lipsesc angajații sau data de început.");
  const end = isDate(a.data_sfarsit) ? String(a.data_sfarsit) : String(a.data_inceput);
  const days: string[] = [];
  for (let d = new Date(`${a.data_inceput}T12:00:00Z`); d <= new Date(`${end}T12:00:00Z`) && days.length < 62; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const [emps, abs, tasks] = await Promise.all([
    sb.from("employees").select("id, full_name, work_start, work_end, break_minutes, work_days").in("id", ids).then(must) as Promise<Row[]>,
    sb.from("absences").select("employee_id, start_date, end_date").in("employee_id", ids).lte("start_date", end).gte("end_date", a.data_inceput).then(must) as Promise<Row[]>,
    a.misiune ? sb.from("tasks").select("id, name").eq("project_id", pid).then(must) as Promise<Row[]> : Promise.resolve([] as Row[]),
  ]);
  let taskId: string | null = null;
  if (a.misiune) {
    taskId = (tasks.find((t) => norm(t.name) === norm(a.misiune))?.id as string | undefined) ?? null;
    if (!taskId) taskId = (must(await sb.from("tasks").insert({ company_id: cid, project_id: pid, name: String(a.misiune).trim() }).select("id").single()) as Row).id as string;
  }
  const rows: Row[] = [];
  let skippedAbs = 0;
  for (const e of emps) {
    const wd = Array.isArray(e.work_days) && (e.work_days as number[]).length ? (e.work_days as number[]) : [1, 2, 3, 4, 5];
    const start = isTime(a.ora_inceput) ? String(a.ora_inceput) : String(e.work_start ?? ctx.schedule.start).slice(0, 5);
    const finish = isTime(a.ora_sfarsit) ? String(a.ora_sfarsit) : String(e.work_end ?? ctx.schedule.end).slice(0, 5);
    const brk = Number.isFinite(Number(a.pauza_min)) && a.pauza_min != null ? Number(a.pauza_min) : Number(e.break_minutes ?? ctx.schedule.breakMin);
    for (const day of days) {
      const iso = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
      if (!a.include_weekend && !wd.includes(iso)) continue;
      if (abs.some((x) => x.employee_id === e.id && String(x.start_date) <= day && String(x.end_date) >= day)) { skippedAbs++; continue; }
      const s = fromZonedTime(`${day}T${start}:00`, tz);
      let f = fromZonedTime(`${day}T${finish}:00`, tz);
      if (f <= s) f = new Date(f.getTime() + 864e5);
      rows.push({ company_id: cid, employee_id: e.id, project_id: pid, task_id: taskId, starts_at: s.toISOString(), ends_at: f.toISOString(),
        break_minutes: Math.max(0, Math.min(brk, Math.floor((f.getTime() - s.getTime()) / 60000) - 1)), status: "planificata", created_by: ctx.userId });
    }
  }
  if (!rows.length) return { ok: false, text: "Nu am ce aloca în perioada aleasă (zile libere sau absențe)." };
  let made = 0, overlap = 0;
  const all = await sb.from("assignments").insert(rows);
  if (!all.error) made = rows.length;
  else {
    // unele zile se suprapun: le salvăm pe rând pe cele care încap
    for (const r of rows) { const one = await sb.from("assignments").insert(r); if (one.error) overlap++; else made++; }
  }
  const missing = ids.length - emps.length;
  const notes = [overlap ? `${overlap} zile sărite (aveau deja program)` : "", skippedAbs ? `${skippedAbs} zile sărite (absențe)` : "", missing ? `${missing} angajați negăsiți` : ""].filter(Boolean).join("; ");
  return { ok: made > 0, text: `Am creat ${made} ${made === 1 ? "zi" : "zile"} de program pentru ${emps.map((e) => e.full_name).join(", ")}.${notes ? ` ${notes}.` : ""}`, link: "/planning" };
}
