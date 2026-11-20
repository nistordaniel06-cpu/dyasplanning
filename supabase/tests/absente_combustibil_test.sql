-- Teste 027: fără ore în zilele de absență + notificări combustibil
\set ON_ERROR_STOP 1
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000a9', 'sofer.comb@test.ro') on conflict do nothing;
insert into vehicles(company_id, name, plate) values (tst.id('c1'), 'Caddy Comb', 'VX-1') returning id as fv \gset
insert into employees(company_id, full_name, user_id, is_driver, default_vehicle_id) values (tst.id('c1'), 'Șofer Combustibil', '00000000-0000-0000-0000-0000000000a9', true, :'fv') returning id as fe \gset
insert into memberships(user_id, company_id, role, employee_id) values ('00000000-0000-0000-0000-0000000000a9', tst.id('c1'), 'angajat', :'fe');
-- absență 2026-12-10..12
insert into absences(company_id, employee_id, type, start_date, end_date) values (tst.id('c1'), :'fe', 'medical', '2026-12-10', '2026-12-12');
select tst.expect_error(format($q$insert into time_entries(company_id, employee_id, project_id, started_at, ended_at, status) values (%L, %L, %L, '2026-12-11 08:00+02', '2026-12-11 16:00+02', 'ciorna')$q$, tst.id('c1'), :'fe', tst.id('p1')), 'concediu medical');
insert into time_entries(company_id, employee_id, project_id, started_at, ended_at, status) values (tst.id('c1'), :'fe', tst.id('p1'), '2026-12-09 08:00+02', '2026-12-09 16:00+02', 'ciorna') returning id as fte \gset
select tst.expect_error(format($q$update time_entries set started_at = '2026-12-10 08:00+02', ended_at = '2026-12-10 16:00+02' where id = %L$q$, :'fte'), 'nu se pot pune ore');
select tst.assert(true, 'nu se pot pune ore în zilele de absență (nici prin mutare)');
delete from time_entries where id = :'fte';
-- combustibil: alocat azi, a început acum 35 min → prima notificare
insert into assignments(company_id, employee_id, project_id, starts_at, ends_at) values (tst.id('c1'), :'fe', tst.id('p1'), now() - interval '35 minutes', now() + interval '6 hours');
select fuel_reminders_tick();
select tst.assert((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000a9' and title = '⛽ Verifică combustibilul' and body like 'Caddy Comb%') = 1, 'șoferul primește „Verifică combustibilul” (cu mașina lui)');
select fuel_reminders_tick();
select tst.assert((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000a9' and title like '⛽%') = 1, 'nu primește de două ori aceeași notificare');
update companies set fuel_reminders = false where id = tst.id('c1');
delete from fuel_reminder_log where employee_id = :'fe';
select fuel_reminders_tick();
select tst.assert((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000a9' and title like '⛽%') = 1, 'oprit din setări = fără notificări');
update companies set fuel_reminders = true where id = tst.id('c1');
delete from notifications where user_id = '00000000-0000-0000-0000-0000000000a9'; delete from assignments where employee_id = :'fe';
delete from absences where employee_id = :'fe'; delete from memberships where employee_id = :'fe'; delete from employees where id = :'fe'; delete from vehicles where id = :'fv';
select 'COMBUSTIBIL_TESTE_TRECUTE';
