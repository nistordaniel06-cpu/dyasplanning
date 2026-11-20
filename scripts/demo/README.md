# Demonstrația DYAS Planning (video + capturi)

Filmul și capturile de pe `/prezentare` sunt înregistrate din aplicația reală, rulată local cu date fictive
(„Construcții Exemplu SRL”, Andrei / Mihai / Elena, lucrările din Militari și Grozăvești).

1. Pornește mediul de test (`tests/e2e`: Postgres local + `fake-supabase.mjs` + `npm start`), apoi `tests/e2e/reset.sh`.
2. `python3 seed.py` — firma și datele fictive.
3. `python3 record.py` — scenele, cu Playwright + CDP screencast la 1920×1080 (ceasul browserului: luni, 16.11.2026).
4. `python3 edit.py` — montajul cu FFmpeg (prim-planuri, subtitrări, final) → `dyas-planning-demo.mp4`.
5. `python3 shots.py` — cele trei capturi de telefon (390 px).

Butonul „Cere o demonstrație” folosește variabila `NEXT_PUBLIC_SALES_WHATSAPP` (doar cifre, cu prefixul țării, ex. `40722123456`).
