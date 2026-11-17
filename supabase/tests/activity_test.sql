-- Teste 006: anunțuri, notificări pontaj/km, activitatea adminilor (după alerts_test)
\set ON_ERROR_STOP 1
reset role;
select set_config('request.jwt.claim.sub', '', false);
delete from notifications;
delete from owner_activity;

-- activitatea adminului → jurnal + push (limitat la unul / 2 min)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into projects(company_id, name) values (tst.id('c1'), 'Vilă Snagov');
insert into projects(company_id, name) values (tst.id('c1'), 'Hală Chitila');
update projects set address = 'Snagov' where name = 'Vilă Snagov';
reset role;
select tst.assert((select count(*) from owner_activity where entity = 'projects') = 3, 'acțiunile adminului sunt în jurnal');
select tst.assert((select summary from owner_activity where entity = 'projects' and op = 'INSERT' order by id limit 1) = 'Dan Admin a adăugat 1 lucrări', 'descrierea acțiunii');
select tst.assert((select count(*) from owner_activity where entity = 'projects' and op = 'INSERT' and pushed) = 1, 'push limitat la unul la 2 minute');
select tst.assert((select count(*) from owner_activity where entity = 'projects' and op = 'UPDATE' and pushed) = 1, 'altă operație = push separat');
-- angajații nu apar în jurnal
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select count(*) from projects;
reset role;

-- pontaj trimis → adminii firmei
select set_config('request.jwt.claim.sub', '', false);
insert into time_entries(company_id, employee_id, project_id, started_at, ended_at, break_minutes, status)
values (tst.id('c1'), tst.id('ion'), tst.id('p1'), '2026-11-10 06:00+00', '2026-11-10 15:00+00', 30, 'trimis');
select tst.assert((select count(*) from notifications n join memberships m on m.user_id = n.user_id
  where n.kind = 'pontaj_trimis' and m.role = 'admin' and n.title = 'Pontaj nou: Ion Popescu' and n.body like '8h 30m · %') = 1, 'adminul primește pontajul trimis');
select tst.assert((select count(*) from notifications n join memberships m on m.user_id = n.user_id where n.kind = 'pontaj_trimis' and m.role <> 'admin') = 0, 'doar adminii primesc pontajele');

-- km mașină → adminii firmei
insert into odometer_readings(company_id, vehicle_id, employee_id, reading_date, km)
values (tst.id('c1'), tst.id('car'), tst.id('ion'), '2030-01-01', 250000);
select tst.assert((select count(*) from notifications where kind = 'km' and body like '250.000 km%Ion Popescu') = 1, 'adminul primește km introduși');

-- anunțuri
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.expect_error($$select owner_publish_announcement('x', 'y', 'info', 1, false)$$, 'doar proprietarului');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_publish_announcement('Mentenanță duminică', 'Aplicația nu va fi disponibilă 22:00–23:00.', 'warning', 3, true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select tst.assert((select title from current_announcement()) = 'Mentenanță duminică', 'angajatul vede anunțul');
reset role;
select tst.assert((select count(*) from notifications where kind = 'announcement') = (select count(*) from memberships m join companies c on c.id = m.company_id where c.status = 'activ'), 'anunțul ajunge la toți utilizatorii');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_end_announcement();
select tst.assert((select count(*) from owner_activity_feed()) >= 3, 'proprietarul vede jurnalul');
select tst.assert((owner_settings()->>'activity_push')::boolean, 'setare push activitate');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select tst.assert((select count(*) from current_announcement()) = 0, 'anunțul oprit nu mai apare');
select tst.expect_error($$select * from owner_activity_feed()$$, 'doar proprietarului');
select tst.expect_error($$select * from owner_activity$$, 'permission denied');
reset role;
select 'ACTIVITATE_TESTE_TRECUTE';
