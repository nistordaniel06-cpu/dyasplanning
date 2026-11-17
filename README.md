# DYASPlanning

Aplicație web de planning și pontaj pentru firme de construcții. Merge pe telefon, tabletă și desktop.

Răspunde rapid la întrebările: **cine lucrează azi, la ce lucrare și adresă, ce misiune are, în ce interval, câte ore a lucrat efectiv și cine e disponibil pentru o lucrare nouă.**

- Stack: Next.js 16 + TypeScript + Tailwind, Supabase (PostgreSQL + Auth)
- Structura ecranelor, modelul de date și permisiunile: [`docs/ARHITECTURA.md`](docs/ARHITECTURA.md)

## Ce conține prima versiune

- Conturi, firme izolate între ele, roluri (administrator, șef de echipă, angajat), invitații prin cod
- Angajați (inclusiv **fără cont**), echipe, concedii și absențe
- Lucrări cu misiuni, progres, observații și buton de navigație
- Planning pe zi, săptămână și lună. Pe desktop: drag-and-drop. Pe telefon: agendă, cu editare prin atingere
- Fluxul „Alocă angajați”, cu personalizare pe fiecare angajat și repetare pe mai multe zile
- Detectarea suprapunerilor (blocată și în baza de date), a concediilor și a lipsei timpului de deplasare
- Copierea unei zile sau săptămâni, cu previzualizare și verificarea conflictelor
- Pontaj manual (început, sfârșit, pauze neplătite, ture peste miezul nopții) cu statusurile ciornă / trimis / aprobat / respins, istoric complet și corecții cu motiv
- Dashboard și rapoarte (planificat vs. aprobat vs. neaprobat), export CSV pentru Excel

## Punere în funcțiune (merge integral de pe telefon)

### 1. Baza de date — Supabase
1. Creează un proiect pe [supabase.com](https://supabase.com) (regiunea *Central EU (Frankfurt)*).
2. **SQL Editor → New query** → lipește tot conținutul fișierului [`supabase/schema.sql`](supabase/schema.sql) → **Run**. Scriptul se poate rula din nou fără probleme.
3. **Authentication → Sign In / Providers → Email**: lasă activat. Pentru teste rapide poți dezactiva *Confirm email*. Pentru utilizare reală, las-o activată.
4. **Project Settings → API**: copiază *Project URL* și cheia *anon / publishable*.

### 2. Aplicația — Vercel
1. Pune codul într-un repository GitHub.
2. Pe [vercel.com](https://vercel.com): **Add New → Project → Import** repository-ul.
3. La **Environment Variables** adaugă:
   - `NEXT_PUBLIC_SUPABASE_URL` = Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = cheia anon / publishable
4. **Deploy**.
5. Înapoi în Supabase: **Authentication → URL Configuration → Site URL** = adresa Vercel (ex. `https://dyasplanning.vercel.app`).

### 3. Prima utilizare
1. Deschide aplicația → **Cont nou** → **Înființez firma**. Devii administrator.
2. **Angajați → Adaugă angajat** (pentru cei fără telefon nu e nevoie de cont).
3. **Lucrări → Adaugă lucrare** → adaugă misiunile.
4. **Planning → Alocă angajați**.
5. Pentru ca un angajat să intre în aplicație: fișa lui → **Invită în aplicație** → trimite codul pe WhatsApp. Angajatul își face cont și introduce codul.

## Dezvoltare locală

```bash
cp .env.example .env.local   # completează URL-ul și cheia
npm install
npm run dev                  # http://localhost:3000
```

## Teste

| Comandă | Ce verifică |
|---|---|
| `npm test` | Logica de calcul: fusuri orare, ora de vară/iarnă, ture de noapte, suprapuneri, deplasare, agregarea orelor, CSV |
| `npm run test:db` | Schema pe un PostgreSQL local: izolarea firmelor, permisiunile fiecărui rol, blocarea suprapunerilor, fluxul de pontaj, corecțiile și istoricul |
| `tests/e2e/` | Fluxul complet în browser (telefon + desktop), pe un server local care imită API-urile Supabase. Detalii în `tests/e2e/README.md` |

## Structura proiectului

```
supabase/schema.sql      tabele, constrângeri, RLS, funcții RPC, audit
supabase/tests/          teste SQL
src/proxy.ts             verificarea sesiunii pe server
src/lib/                 timp/fus orar, ore, conflicte, rapoarte, acces la date
src/components/          interfață reutilizabilă (dialoguri, formulare, liste)
src/app/(app)/           ecranele aplicației
docs/ARHITECTURA.md      ecrane, model de date, permisiuni, decizii
```
