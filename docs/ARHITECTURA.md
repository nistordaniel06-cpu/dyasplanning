# DYASPlanning — arhitectură, ecrane și model de date

## 1. Stack

| Strat | Tehnologie | De ce |
|---|---|---|
| Interfață | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 | Responsive, rapid, găzduire gratuită pe Vercel |
| Date, autentificare | Supabase (PostgreSQL + Auth) | Permisiuni în baza de date (RLS), fără server separat |
| Logică critică | În PostgreSQL: constrângeri, trigger-e, funcții RPC | Regulile nu pot fi ocolite din browser |

**Unde sunt aplicate permisiunile:**
1. `src/proxy.ts`: pe server, la fiecare cerere, verifică sesiunea la Supabase Auth și redirecționează la login.
2. **Row Level Security** pe fiecare tabel: fiecare firmă își vede doar datele proprii, iar fiecare rol doar ce îi este permis.
3. **Trigger-e** pentru regulile de flux (statusurile pontajelor, corecțiile, apartenența la aceeași firmă).
4. Interfața ascunde ce nu e permis, dar asta e doar pentru confort. Securitatea e asigurată de punctele 1–3.

## 2. Structura ecranelor

### Administrator — `Dashboard · Planning · Lucrări · Angajați · Pontaje · Rapoarte · Setări`

| Ecran | Rută | Conținut |
|---|---|---|
| Dashboard | `/dashboard` | Lucrări active, cine lucrează azi (pe lucrare, cu misiune și interval), disponibili/absenți, pontaje de aprobat, misiuni întârziate/blocate, ore planificate vs. efective în săptămână |
| Planning | `/planning` | **Zi** (desktop: angajați pe rânduri, ore pe coloane, drag-and-drop pentru mutare/redimensionare/schimbarea angajatului; telefon: agendă grupată pe lucrare, editare prin atingere), **Săptămână** (desktop: grilă angajat × zi cu drag-and-drop; telefon: listă pe zile), **Lună** (calendar cu numărul de oameni și lucrările zilei). Filtre: angajat, echipă, lucrare, locație, status. Panou de disponibilitate. Copiere zi/săptămână cu previzualizare |
| Alocă angajați | `/planning/aloca` | Flux în 6 pași: lucrare → misiune (alegere/creare) → angajați (cu disponibilitate) → zi, interval, pauză, repetare opțională → personalizare pe angajat → verificare și salvare |
| Lucrări | `/lucrari`, `/lucrari/[id]` | Listă cu filtre; pagina lucrării reunește detaliile, navigația, misiunile cu progres, programul, echipa, orele planificate/aprobate/în așteptare, pontajele și observațiile |
| Angajați | `/angajati`, `/angajati/[id]` | Listă cu disponibilitatea de azi; fișa angajatului: profil, program obișnuit, ore pe zi/săptămână/lună, concedii și absențe, alocări viitoare, invitație în aplicație |
| Pontaje | `/pontaje` | „De aprobat” (aprobare individuală sau în masă, respingere cu motiv) și „Toate” (filtre); editare, corecție pentru pontaje aprobate (cu motiv), istoric complet |
| Rapoarte | `/rapoarte` | Pe angajat sau pe lucrare, pe perioadă: planificat, aprobat, trimis (neaprobat), ciornă, diferență. Export CSV (sumar și detaliat) |
| Setări | `/setari` | Firmă (nume, fus orar, timp minim de deplasare), echipe și șefi de echipă, utilizatori și roluri, invitații active |

### Angajat — `Astăzi · Programul meu · Pontaj · Profil`
### Șef de echipă — `Astăzi · Programul meu · Echipa · Pontaj · Profil`

| Ecran | Rută | Conținut |
|---|---|---|
| Astăzi | `/astazi` | Pentru fiecare alocare: lucrarea, adresa și butonul de navigație, intervalul, misiunea cu progresul, colegii, contactul de pe șantier; butoanele „Adaugă orele” (pontaj precompletat) și „Progres” |
| Programul meu | `/program` | Două săptămâni, zi cu zi, inclusiv concediile |
| Pontaj | `/pontaj` | Orele proprii pe perioadă (aprobate / trimise / ciorne / respinse), adăugare, modificare, trimitere, retragere. Șeful de echipă are și tabul „Echipa mea”, unde poate semnala probleme |
| Echipa | `/echipa` | (șef de echipă) Cine lucrează și unde, pe zile; progresul misiunilor de pe lucrările lui |
| Profil | `/profil` | Date personale, orele pe zi/săptămână/lună, ieșire |

### Acces
`/login` (autentificare / cont nou), `/onboarding` (înființare firmă **sau** cod de invitație).

## 3. Modelul de date

```
companies ──┬── teams ──────────────┐ (leader_employee_id)
            ├── employees ◄─────────┘   user_id → auth.users (opțional: angajat fără cont)
            ├── memberships (user_id → companie, rol, employee_id)
            ├── invites (cod de 8 caractere, rol, angajat, expiră în 14 zile)
            ├── absences (angajat, tip, interval de zile)
            └── projects (lucrări) ── tasks (misiuni)
                    │                    │
                    └──── assignments (alocări) ───── employee
                    │      employee + lucrare + misiune? + starts_at/ends_at + pauză + status
                    │
                    └──── time_entries (pontaje) ──── employee
                           started_at/ended_at, pauze neplătite, worked_minutes (calculat),
                           status ciornă/trimis/aprobat/respins, motiv respingere, semnalare,
                           legat opțional de alocare (pentru planificat vs. efectiv)
                           └── time_entry_history (audit: cine, ce, când, motiv, înainte/după)
            notes (observații pe lucrare / misiune)
```

**Decizii importante**
- **Planificat ≠ efectiv.** Alocarea (`assignments`) e programul; pontajul (`time_entries`) e realitatea. Rapoartele le arată separat.
- **Timp:** totul se stochează în UTC (`timestamptz`) și se afișează în fusul orar al firmei (`companies.timezone`). Turele peste miezul nopții se stochează ca interval continuu (sfârșitul a doua zi). Trecerea la ora de vară/iarnă e calculată corect.
- **Suprapuneri:** baza de date refuză două alocări active care se suprapun pentru același angajat (constrângere `EXCLUDE … tstzrange`), la fel și pentru pontaje. Interfața verifică dinainte și explică exact conflictul.
- **Alocări multiple:** „Alocă angajați” creează câte o alocare individuală pentru fiecare angajat și zi, într-o singură operație atomică. Fiecare alocare se poate modifica separat.
- **Ore lucrate:** `worked_minutes` este coloană generată în baza de date (durată − pauze neplătite), deci totalurile nu pot fi falsificate din browser.
- **Corecții:** un pontaj aprobat poate fi modificat doar de un administrator prin funcția `correct_approved_time_entry`, cu motiv obligatoriu salvat în istoric.
- **Dezactivare:** angajații se dezactivează (`active = false`); istoricul rămâne. Revocarea accesului păstrează fișa și pontajele.

## 4. Matricea de permisiuni (aplicată în baza de date)

| Acțiune | Admin | Șef de echipă | Angajat |
|---|---|---|---|
| Vede lucrările | toate | cele de care răspunde + unde lucrează echipa | cele unde e alocat |
| Creează/modifică lucrări, misiuni, angajați, alocări | ✓ | — | — |
| Actualizează progresul misiunii | ✓ | pe lucrările lui | pe misiunile la care e alocat |
| Vede pontaje | toate | ale echipei | proprii |
| Creează pontaj | pentru oricine (inclusiv fără cont) | propriu | propriu |
| Trimite / retrage pontaj | ✓ | propriu | propriu |
| Aprobă / respinge | ✓ | — (doar semnalează) | — |
| Corectează pontaj aprobat | ✓ cu motiv | — | — |
| Setări, roluri, invitații | ✓ | — | — |

## 5. Ce urmează (după prima versiune)
Cronometru (Pornire · Pauză · Reluare · Oprire), fotografii și documente pe lucrare (Supabase Storage), notificări, aplicație instalabilă offline (PWA complet). În afara scopului: salarizare, contabilitate, gestiune de materiale.
