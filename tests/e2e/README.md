# Teste end-to-end

Rulează aplicația reală în Chrome (telefon 390×844 și desktop), pe un PostgreSQL local cu `supabase/schema.sql`.

`fake-supabase.mjs` imită API-urile REST și Auth ale Supabase pentru operațiile folosite de aplicație. Fiecare cerere rulează ca rol `authenticated`, cu id-ul utilizatorului setat ca în Supabase, deci RLS, trigger-ele și constrângerile reale se aplică integral. Este un instrument de test, nu un înlocuitor pentru Supabase.

```bash
# PostgreSQL pe socket /tmp, port 5433
createdb -h /tmp -p 5433 -U postgres dyas_e2e
psql -h /tmp -p 5433 -U postgres -d dyas_e2e -f ../../supabase/tests/supabase_stub.sql
psql -h /tmp -p 5433 -U postgres -d dyas_e2e -c "create table auth.passwords(id uuid primary key, hash text not null)"
psql -h /tmp -p 5433 -U postgres -d dyas_e2e -f ../../supabase/schema.sql
npm install && node fake-supabase.mjs        # afișează ANON_KEY

# în rădăcina proiectului:
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY> npm run build && npm start

pip install playwright
./reset.sh && python3 flow.py && python3 smoke.py   # capturile de ecran se salvează în shots/
```

`flow.py` acoperă criteriile de acceptare: 3 angajați pe aceeași lucrare cu misiuni diferite, lucrări în locații diferite, mutare fără efect asupra colegilor, detectarea suprapunerilor, pontaj trimis de angajat, aprobare, totaluri corecte, persistență după reîncărcare, flux complet pe telefon, drag-and-drop pe desktop.
`smoke.py` acoperă: echipe, șef de echipă, concedii, alocări recurente, copierea săptămânii, observații, istoric, export CSV, semnalări.
