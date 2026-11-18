-- Teste 008: activitate detaliată, GPS, fișa utilizatorului, harta (înainte de delete_test)
\set ON_ERROR_STOP 1
reset role;
select set_config('request.jwt.claim.sub', '', false);
delete from owner_activity;
-- modificare reală → câmpurile schimbate, înainte → după
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update employees set phone = '+40 799000111', trade = 'Faianțar' where id = tst.id('ion');
reset role;
select tst.assert((select summary from owner_activity where entity = 'employees' order by id desc limit 1) = 'Dan Admin a modificat angajatul „Ion Popescu” (telefon, meserie)', 'rezumat cu numele și câmpurile');
select tst.assert((select details->0->'changes'->1->>'to' from owner_activity where entity = 'employees' order by id desc limit 1) = 'Faianțar', 'valoarea nouă');
-- salvare fără nicio schimbare → nu apare
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update employees set trade = trade where id = tst.id('ion');
reset role;
select tst.assert((select count(*) from owner_activity where entity = 'employees') = 1, 'salvarea fără schimbări nu apare în jurnal');
-- id-urile devin nume
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update employees set team_id = null where id = tst.id('ion') and team_id is not null;
reset role;

-- GPS: același cont pe două telefoane nu se dublează
select tst.assert(record_presence_v2('S3CRET', '00000000-0000-0000-0000-0000000000b2', '10.0.0.1', 'Voluntari', 'IF', 'RO', 44.49, 26.17, 'Android · Chrome', true, null, null, null, null), 'telefon 1');
select tst.assert(record_presence_v2('S3CRET', '00000000-0000-0000-0000-0000000000b2', '10.0.0.2', 'Rotterdam', 'ZH', 'NL', 51.9, 4.47, 'iPhone · Safari', true, null, null, null, null), 'telefon 2');
select tst.assert(not record_presence_v2('S3CRET', '00000000-0000-0000-0000-0000000000b2', '10.0.0.1', 'Voluntari', 'IF', 'RO', 44.49, 26.17, 'Android · Chrome', true, null, null, null, null), 'telefon 1 din nou: fără dublură');
select tst.assert(not record_presence_v2('S3CRET', '00000000-0000-0000-0000-0000000000b2', '10.0.0.2', 'Rotterdam', 'ZH', 'NL', 51.9, 4.47, 'iPhone · Safari', true, null, null, null, null), 'telefon 2 din nou: fără dublură');
-- GPS-ul completează conectarea existentă
select tst.assert(record_presence_v2('S3CRET', '00000000-0000-0000-0000-0000000000b2', '10.0.0.1', 'Voluntari', 'IF', 'RO', 44.49, 26.17, 'Android · Chrome', true, 44.4801, 26.1302, 12, 'Strada Exemplu 5, Voluntari'), 'GPS adăugat');
select tst.assert((select count(*) from login_events where user_id = '00000000-0000-0000-0000-0000000000b2' and ip = '10.0.0.1') = 1, 'GPS-ul completează rândul, nu face altul');
select tst.assert((select address from login_events where user_id = '00000000-0000-0000-0000-0000000000b2' and ip = '10.0.0.1') = 'Strada Exemplu 5, Voluntari', 'adresa salvată');
select tst.assert(not record_presence_v2('S3CRET', '00000000-0000-0000-0000-0000000000b2', '10.0.0.1', 'Voluntari', 'IF', 'RO', 44.49, 26.17, 'Android · Chrome', true, 44.4802, 26.1303, 10, 'x'), 'mutare sub 200 m: nimic nou');
select tst.assert(record_presence_v2('S3CRET', '00000000-0000-0000-0000-0000000000b2', '10.0.0.1', 'Voluntari', 'IF', 'RO', 44.49, 26.17, 'Android · Chrome', true, 44.50, 26.20, 15, 'Alt loc'), 'mutare peste 200 m: conectare nouă');

-- proprietarul: fișa utilizatorului, harta, filtrare pe utilizator
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select tst.assert((owner_user_detail('00000000-0000-0000-0000-0000000000b2')->>'company') = 'Construct SRL', 'fișa: firma');
select tst.assert(jsonb_array_length(owner_user_detail('00000000-0000-0000-0000-0000000000b2')->'devices') >= 2, 'fișa: telefoanele utilizatorului');
select tst.assert((select precise from owner_map_points() where user_id = '00000000-0000-0000-0000-0000000000b2'), 'harta folosește poziția GPS');
select tst.assert((select count(*) from owner_login_events(null, 50, '00000000-0000-0000-0000-0000000000b2')) >= 3, 'conectări filtrate pe utilizator');
select tst.assert((select count(*) from owner_activity_feed(null, 50, '00000000-0000-0000-0000-00000000000a')) >= 1, 'activitate filtrată pe utilizator');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.expect_error($$select owner_user_detail('00000000-0000-0000-0000-0000000000b2')$$, 'doar proprietarului');
select tst.expect_error($$select * from owner_map_points()$$, 'doar proprietarului');
reset role;
select 'DETALII_TESTE_TRECUTE';
