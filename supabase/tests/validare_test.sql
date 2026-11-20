-- Teste 026: validarea zilnică (șef + admin) și lucrări extra
\set ON_ERROR_STOP 1
reset role;
-- echipă proprie pentru test: șeful Sorin și muncitorul Radu (cu conturi)
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a7', 'sorin@test.ro'), ('00000000-0000-0000-0000-0000000000a8', 'radu@test.ro') on conflict do nothing;
insert into teams(company_id, name) values (tst.id('c1'), 'Echipa Validare') returning id as vteam \gset
insert into employees(company_id, full_name, team_id, user_id) values (tst.id('c1'), 'Sorin Șef', :'vteam', '00000000-0000-0000-0000-0000000000a7') returning id as sorin \gset
insert into employees(company_id, full_name, team_id, user_id) values (tst.id('c1'), 'Radu Muncitor', :'vteam', '00000000-0000-0000-0000-0000000000a8') returning id as radu \gset
update teams set leader_employee_id = :'sorin' where id = :'vteam';
insert into memberships(user_id, company_id, role, employee_id) values ('00000000-0000-0000-0000-0000000000a7', tst.id('c1'), 'sef_echipa', :'sorin'), ('00000000-0000-0000-0000-0000000000a8', tst.id('c1'), 'angajat', :'radu');
-- Ion are programul pus (ciornă)
reset role;
insert into time_entries(company_id, employee_id, project_id, started_at, ended_at, break_minutes, status)
values (tst.id('c1'), :'radu', tst.id('p1'), '2026-12-01 08:00+02', '2026-12-01 17:00+02', 60, 'ciorna') returning id as v1 \gset
set role authenticated;
-- George (șef) validează și corectează
reset role; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', false); set role authenticated;
select tst.assert(:'radu' in (select my_review_employee_ids()), 'șeful își vede echipa la validare');
select tst.assert(tst.id('vasile') not in (select my_review_employee_ids()), 'șeful nu vede alte echipe la validare');
select tst.assert(validate_day_entries(array[:'v1'::uuid]) = 1, 'șeful validează programul');
select tst.assert((select status = 'trimis' and validated_role = 'sef_echipa' from time_entries where id = :'v1'), 'validat de șef = trimis spre aprobare');
select review_save_time_entry(:'v1', :'radu', tst.id('p1'), null, '2026-12-01 08:00+02', '2026-12-01 16:00+02', 60, null, 'a plecat la 16');
select tst.assert((select worked_minutes = 420 and validated_role = 'sef_echipa' from time_entries where id = :'v1'), 'șeful corectează orele');
select review_save_time_entry(null, :'radu', tst.id('p1'), null, '2026-12-02 08:00+02', '2026-12-02 16:00+02', 30, 'adăugat de șef', 'a uitat să ponteze') as v2 \gset
select tst.assert((select status = 'trimis' and employee_id = :'radu' from time_entries where id = :'v2'), 'șeful adaugă ore lipsă');
select tst.expect_error(format('select review_save_time_entry(null, %L, %L, null, %L, %L, 0)', tst.id('vasile'), tst.id('p1'), '2026-12-01 08:00+02', '2026-12-01 16:00+02'), 'echipa ta');
select tst.expect_error(format('select validate_day_entries(array[%L::uuid])', tst.id('te_vasile')), 'echipa ta');
-- angajatul: dacă își retrage pontajul, validarea se pierde
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', false);
set role authenticated;
update time_entries set status = 'ciorna' where id = :'v2';
reset role;
select tst.assert((select validated_at is null from time_entries where id = :'v2'), 'retras de angajat → nevalidat');
select tst.assert((select count(*) from notifications n where n.title like 'Ți s-a corectat programul%') >= 1, 'angajatul e anunțat de corectare');
select tst.assert((select count(*) from time_entry_history where time_entry_id = :'v1' and reason = 'a plecat la 16') = 1, 'motivul corectării e în istoric');
-- adminul validează = aprobă
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select validate_day_entries(array[:'v1'::uuid]);
select tst.assert((select status = 'aprobat' and validated_role = 'admin' from time_entries where id = :'v1'), 'adminul validează = aprobă');
select review_save_time_entry(:'v1', :'radu', tst.id('p1'), null, '2026-12-01 08:00+02', '2026-12-01 16:30+02', 60, null, 'corectat de admin');
select tst.assert((select worked_minutes = 450 and status = 'aprobat' from time_entries where id = :'v1'), 'adminul corectează și un pontaj aprobat');
reset role; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a7', false); set role authenticated;
select tst.expect_error(format('select review_save_time_entry(%L, %L, %L, null, %L, %L, 0)', :'v1', :'radu', tst.id('p1'), '2026-12-01 08:00+02', '2026-12-01 16:00+02'), 'deja aprobat');

-- ================= lucrări extra =================
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', false);
set role authenticated;
insert into project_extras(company_id, project_id, extra_date, body, photos, status)
values (tst.id('c1'), tst.id('p1'), '2026-12-01', 'Am mutat o priză în baie, cerută de client', array['x/y/1.jpg'], 'confirmat') returning id as x1 \gset
select tst.assert((select status = 'nou' and author_name = 'Radu Muncitor' from project_extras where id = :'x1'), 'angajatul adaugă lucrare extra (stare nouă, autor setat)');
update project_extras set status = 'confirmat', body = 'Am mutat două prize' where id = :'x1';
select tst.assert((select status = 'nou' and body = 'Am mutat două prize' from project_extras where id = :'x1'), 'autorul corectează textul, nu și starea');
select tst.expect_error(format('insert into project_extras(company_id, project_id, extra_date, body) values (%L, %L, %L, %L)', tst.id('c1'), tst.id('p2'), '2026-12-01', 'x'), 'row-level security');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from project_extras) = 0, 'altă firmă nu vede lucrările extra');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update project_extras set status = 'confirmat', admin_note = 'se facturează' where id = :'x1';
select tst.assert((select status = 'confirmat' from project_extras where id = :'x1'), 'adminul confirmă lucrarea extra');
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', false);
set role authenticated;
delete from project_extras where id = :'x1';
select tst.assert((select count(*) from project_extras where id = :'x1') = 1, 'după confirmare, autorul nu mai poate șterge');
reset role;
select tst.assert((select count(*) from notifications where title like 'Lucrare extra:%') >= 1, 'adminul e anunțat de lucrarea extra');
delete from project_extras; delete from time_entries where employee_id = :'radu'; delete from notifications where user_id in ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000a8');
delete from memberships where employee_id in (:'sorin', :'radu'); update teams set leader_employee_id = null where id = :'vteam'; delete from employees where id in (:'sorin', :'radu'); delete from teams where id = :'vteam';
select 'VALIDARE_TESTE_TRECUTE';
