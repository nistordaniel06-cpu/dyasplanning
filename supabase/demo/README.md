# Date demo pentru prezentări

Firma **Construct Demo SRL** este complet separată de firmele reale. Programul și pontajele sunt generate relativ la ziua în care rulezi scriptul (săptămâna trecută, cea curentă și cea viitoare).

| Rol | Autentificare | Parolă / cod |
|---|---|---|
| Administrator (Andreea Dobre) | admin.demo@dyasplanning.ro | Demo2026! |
| Șef de echipă (Marian Popa, Echipa Nord) — conduce și Dacia Logan | telefon 0722 100 002 | 222222 |
| Angajat (Ion Stan, rigipsar) — conduce și Ford Transit | telefon 0722 100 003 | 111111 |

„Șofer” nu este un rol separat: este o bifă pe fișa angajatului. Orice angajat sau șef de echipă bifat ca șofer vede în „Astăzi” caseta „Km la plecare”, deasupra lucrării și misiunii lui.

**Reîmprospătare înainte de o prezentare** (Supabase → SQL Editor): rulează `seed_demo_data.sql`. Șterge doar firma demo și o recreează cu date pentru săptămâna curentă. `seed_demo_users.sql` se rulează o singură dată (sau ca să resetezi parolele).
