-- Teste 012: pontaj cu buton, poze la pontaj, atașamente chat, reguli pentru fișiere (înainte de delete_test)
\set ON_ERROR_STOP 1
reset role;
select set_config('request.jwt.claim.sub', '', false);
select employee_id as b3emp from memberships where user_id = '00000000-0000-0000-0000-0000000000b3' \gset
select employee_id as b2emp from memberships where user_id = '00000000-0000-0000-0000-0000000000b2' \gset
delete from time_entries where employee_id = :'b3emp' and started_at > now() - interval '2 days';
insert into assignments(company_id, employee_id, project_id, starts_at, ends_at, break_minutes)
values (tst.id('c1'), :'b3emp', tst.id('p1'), now() - interval '10 hours', now() + interval '1 hour', 60) on conflict do nothing;

-- angajatul: Am început → Am terminat
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select clock_in(tst.id('p1'), null, null, 44.43, 26.10, 15, 'Strada Șantierului 1, București', now() - interval '9 hours');
select tst.assert((select count(*) from time_clocks) = 1, 'tura începută e vizibilă angajatului');
select tst.expect_error($$select clock_in(tst.id('p1'))$$, 'deja o tură');
select tst.expect_error($$insert into time_clocks(company_id, employee_id, project_id, started_at) values (tst.id('c1'), tst.id('ion'), tst.id('p1'), now())$$, 'permission denied');
select clock_out(60, 'Gata pe azi', 44.431, 26.101, 12, 'Strada Șantierului 1, București') as te \gset
select tst.assert((select count(*) from time_clocks) = 0, 'tura s-a închis');
select tst.assert((select status = 'trimis' and source = 'buton' and break_minutes = 60 and worked_minutes between 479 and 481
  and start_address like 'Strada Șantierului%' and end_lat = 44.431 from time_entries where id = :'te'), 'pontaj creat: 9h − 60 min = 8h, cu locațiile');
select tst.expect_error($$select clock_out()$$, 'nicio tură');
-- ora venită de pe telefon, implauzibilă → ora serverului
select clock_in(tst.id('p1'), null, null, null, null, null, null, now() - interval '10 days');
select tst.assert((select started_at > now() - interval '1 minute' from time_clocks), 'ora implauzibilă e înlocuită');
select clock_cancel();
select tst.assert((select count(*) from time_clocks) = 0, 'tura poate fi anulată');
-- „Am început” imediat după „Am terminat”: nu se suprapune cu tura închisă
select clock_in(tst.id('p1'), null, null, null, null, null, null, now() - interval '1 minute');
select tst.assert((select c.started_at = t.ended_at from time_clocks c, time_entries t where t.id = :'te'), 'tura nouă pornește de la sfârșitul celei închise');
select clock_cancel();
select tst.expect_error($$select clock_in(tst.id('p1'), null, null, null, null, null, null, now() - interval '3 hours')$$, 'Ai deja un pontaj până la');

-- poze la pontaj
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
insert into storage.objects(bucket_id, name) values ('pontaj', tst.id('c1') || '/' || :'b3emp' || '/' || :'te' || '/1.jpg');
select tst.expect_error(format('insert into storage.objects(bucket_id, name) values (%L, %L)', 'pontaj', tst.id('c1') || '/' || :'b2emp' || '/x.jpg'), 'row-level security');
insert into time_entry_photos(company_id, employee_id, time_entry_id, path) values (tst.id('c1'), :'b3emp', :'te', tst.id('c1') || '/' || :'b3emp' || '/' || :'te' || '/1.jpg');
select tst.expect_error(format('insert into time_entry_photos(company_id, employee_id, time_entry_id, path) values (%L, %L, %L, %L)', tst.id('c1'), :'b3emp', :'te', 'alta/cale.jpg'), 'row-level security');
-- adminul vede poza și fișierul; alt angajat nu
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.assert((select count(*) from time_entry_photos where time_entry_id = :'te') = 1, 'adminul vede poza');
select tst.assert((select count(*) from storage.objects where bucket_id = 'pontaj') = 1, 'adminul poate deschide fișierul');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from time_entry_photos) = 0, 'altă firmă nu vede poza');
select tst.assert((select count(*) from storage.objects where bucket_id = 'pontaj') = 0, 'altă firmă nu vede fișierul');

-- chat: mesaj vocal fără text
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select id as ch from chat_channels where company_id = tst.id('c1') and kind = 'general' \gset
insert into storage.objects(bucket_id, name) values ('chat', tst.id('c1') || '/' || :'ch' || '/v1.webm');
insert into chat_messages(channel_id, body, attachment_path, attachment_type, attachment_duration)
values (:'ch', '', tst.id('c1') || '/' || :'ch' || '/v1.webm', 'audio', 7);
select tst.assert((select body from chat_messages where attachment_path like '%v1.webm') = '🎤 Mesaj vocal', 'mesaj vocal cu text automat');
select tst.expect_error(format('insert into chat_messages(channel_id, body, attachment_path, attachment_type) values (%L, %L, %L, %L)', :'ch', '', 'alta-firma/x/y.jpg', 'image'), 'Atașament invalid');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from storage.objects where bucket_id = 'chat') = 0, 'altă firmă nu vede fișierele din chat');
reset role;
-- km salvați fără semnal: păstrează ziua (max 2 zile în urmă)
update employees set is_driver = true where id = :'b3emp';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select (submit_odometer(tst.id('car'), 100100, null, app_today() - 1, 'acasa')->>'reading_date')::date = app_today() - 1 as ok1 \gset
select tst.assert(:'ok1'::boolean, 'citire offline pe ziua de ieri');
select (submit_odometer(tst.id('car'), 100300, null, app_today() - 30, 'acasa')->>'reading_date')::date = app_today() as ok2 \gset
select tst.assert(:'ok2'::boolean, 'dată prea veche → azi');
reset role;
select 'TEREN_TESTE_TRECUTE';
