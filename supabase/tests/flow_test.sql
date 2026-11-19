-- Test end-to-end pentru schema DYASPlanning (rulează pe PostgreSQL local cu supabase_stub.sql).
\set ON_ERROR_STOP 1
\set QUIET 1

create schema if not exists tst;
grant usage on schema tst to authenticated;

create or replace function tst.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm ilike '%' || p_like || '%' or sqlstate = p_like then
      raise notice 'OK (eroare așteptată): %', sqlerrm; return;
    end if;
    raise exception 'Eroare neașteptată pentru [%]: % (%)', p_sql, sqlerrm, sqlstate;
  end;
  raise exception 'Se aștepta eroare pentru: %', p_sql;
end $$;

create or replace function tst.assert(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'ASSERT EȘUAT: %', p_msg; end if;
  raise notice 'OK: %', p_msg;
end $$;
grant execute on all functions in schema tst to authenticated;

create table if not exists tst.ids (k text primary key, v uuid);
grant select, insert, update on tst.ids to authenticated;
create or replace function tst.id(k text) returns uuid language sql stable as $$ select v from tst.ids where ids.k = $1 $$;

insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@firma1.ro'),
  ('00000000-0000-0000-0000-0000000000b1', 'ion@firma1.ro'),
  ('00000000-0000-0000-0000-0000000000b2', 'sef@firma1.ro'),
  ('00000000-0000-0000-0000-0000000000c1', 'admin@firma2.ro')
on conflict do nothing;

set role authenticated;

-- ================= Admin firma 1 =================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into tst.ids values ('c1', create_company('Construct SRL', 'Europe/Bucharest', 'Dan Admin'));
select tst.expect_error($$select create_company('Alta', 'Europe/Bucharest')$$, 'aparține deja');
select tst.expect_error($$insert into companies(name) values ('x')$$, 'permission denied');

insert into teams(company_id, name) values (tst.id('c1'), 'Echipa A') returning id \gset team_
insert into tst.ids values ('teamA', :'team_id');

insert into employees(company_id, full_name, trade, team_id) values (tst.id('c1'), 'Ion Popescu', 'Rigipsar', tst.id('teamA')) returning id \gset e_
insert into tst.ids values ('ion', :'e_id');
insert into employees(company_id, full_name, trade, team_id) values (tst.id('c1'), 'Mihai Ionescu', 'Electrician', tst.id('teamA')) returning id \gset e_
insert into tst.ids values ('mihai', :'e_id');
insert into employees(company_id, full_name, trade, team_id) values (tst.id('c1'), 'Andrei Vasile', 'Zugrav', tst.id('teamA')) returning id \gset e_
insert into tst.ids values ('andrei', :'e_id');
insert into employees(company_id, full_name, trade) values (tst.id('c1'), 'George Șef', 'Șef de echipă') returning id \gset e_
insert into tst.ids values ('george', :'e_id');
update teams set leader_employee_id = tst.id('george') where id = tst.id('teamA');
insert into employees(company_id, full_name, trade) values (tst.id('c1'), 'Vasile Fără Cont', 'Zidar') returning id \gset e_
insert into tst.ids values ('vasile', :'e_id');

insert into projects(company_id, name, address, city, status) values (tst.id('c1'), 'Renovare apartament — București', 'Str. Lujerului 10', 'București', 'in_desfasurare') returning id \gset p_
insert into tst.ids values ('p1', :'p_id');
insert into projects(company_id, name, address, city, status) values (tst.id('c1'), 'Casă Ploiești', 'Str. Republicii 3', 'Ploiești', 'in_desfasurare') returning id \gset p_
insert into tst.ids values ('p2', :'p_id');

insert into tasks(company_id, project_id, name) values (tst.id('c1'), tst.id('p1'), 'Montaj rigips') returning id \gset t_
insert into tst.ids values ('t_rigips', :'t_id');
insert into tasks(company_id, project_id, name) values (tst.id('c1'), tst.id('p1'), 'Instalație electrică') returning id \gset t_
insert into tst.ids values ('t_elec', :'t_id');
insert into tasks(company_id, project_id, name) values (tst.id('c1'), tst.id('p1'), 'Pregătire pereți') returning id \gset t_
insert into tst.ids values ('t_pereti', :'t_id');
insert into tasks(company_id, project_id, name) values (tst.id('c1'), tst.id('p2'), 'Turnare beton') returning id \gset t_
insert into tst.ids values ('t_beton', :'t_id');

-- Criteriu: trei angajați, aceeași lucrare, misiuni diferite (insert atomic)
insert into assignments(company_id, employee_id, project_id, task_id, starts_at, ends_at, break_minutes) values
  (tst.id('c1'), tst.id('ion'),    tst.id('p1'), tst.id('t_rigips'), '2026-11-18 08:00 Europe/Bucharest', '2026-11-18 16:00 Europe/Bucharest', 30),
  (tst.id('c1'), tst.id('mihai'),  tst.id('p1'), tst.id('t_elec'),   '2026-11-18 08:00 Europe/Bucharest', '2026-11-18 14:00 Europe/Bucharest', 0),
  (tst.id('c1'), tst.id('andrei'), tst.id('p1'), tst.id('t_pereti'), '2026-11-18 10:00 Europe/Bucharest', '2026-11-18 18:00 Europe/Bucharest', 30);
-- Altă lucrare, altă locație, aceeași zi
insert into assignments(company_id, employee_id, project_id, task_id, starts_at, ends_at) values
  (tst.id('c1'), tst.id('vasile'), tst.id('p2'), tst.id('t_beton'), '2026-11-18 07:00 Europe/Bucharest', '2026-11-18 15:00 Europe/Bucharest');
select tst.assert((select count(*) from assignments where project_id = tst.id('p1')) = 3, '3 alocări individuale pe aceeași lucrare');

-- Criteriu: suprapunere detectată
select tst.expect_error($$insert into assignments(company_id, employee_id, project_id, starts_at, ends_at)
  values (tst.id('c1'), tst.id('ion'), tst.id('p2'), '2026-11-18 15:00 Europe/Bucharest', '2026-11-18 17:00 Europe/Bucharest')$$, 'assignments_no_overlap');
-- Alocare consecutivă (fără suprapunere) e permisă
insert into assignments(company_id, employee_id, project_id, starts_at, ends_at)
  values (tst.id('c1'), tst.id('ion'), tst.id('p2'), '2026-11-18 16:00 Europe/Bucharest', '2026-11-18 18:00 Europe/Bucharest');
-- Misiune din altă lucrare = respinsă
select tst.expect_error($$insert into assignments(company_id, employee_id, project_id, task_id, starts_at, ends_at)
  values (tst.id('c1'), tst.id('mihai'), tst.id('p2'), tst.id('t_rigips'), '2026-11-19 08:00 Europe/Bucharest', '2026-11-19 10:00 Europe/Bucharest')$$, 'Misiunea nu aparține');

-- Criteriu: mut alocarea lui Mihai fără a modifica programul colegilor
update assignments set starts_at = '2026-11-18 09:00 Europe/Bucharest', ends_at = '2026-11-18 15:00 Europe/Bucharest'
  where employee_id = tst.id('mihai') and project_id = tst.id('p1');
select tst.assert((select starts_at from assignments where employee_id = tst.id('ion') and task_id = tst.id('t_rigips')) = '2026-11-18 08:00 Europe/Bucharest', 'programul lui Ion a rămas neschimbat');

-- Pontaj pentru angajat fără cont (admin), tură peste miezul nopții
insert into time_entries(company_id, employee_id, project_id, started_at, ended_at, break_minutes, status)
  values (tst.id('c1'), tst.id('vasile'), tst.id('p2'), '2026-11-18 22:00 Europe/Bucharest', '2026-11-19 06:00 Europe/Bucharest', 30, 'aprobat')
  returning id \gset te_
insert into tst.ids values ('te_vasile', :'te_id');
select tst.assert((select worked_minutes from time_entries where id = tst.id('te_vasile')) = 450, 'tura de noapte: 8h - 30 min = 450 min');

-- Invitații pentru Ion (angajat) și George (șef de echipă)
select create_invite(tst.id('ion'), 'angajat') as code \gset inv_
\set code_ion :inv_code
select create_invite(tst.id('george'), 'sef_echipa') as code \gset inv_
\set code_george :inv_code

-- ================= Ion (angajat) =================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
select accept_invite(:'code_ion');
select tst.assert(app_employee_id() = tst.id('ion'), 'Ion e legat de fișa lui');
select tst.assert((select count(*) from assignments where employee_id = tst.id('ion')) = 2, 'Ion își vede alocările');
select tst.assert((select count(*) from time_entries where employee_id = tst.id('vasile')) = 0, 'Ion nu vede pontajele altora');
select tst.assert((select count(*) from invites) = 0, 'Ion nu vede invitațiile');
-- Nu poate modifica alocări
update assignments set ends_at = ends_at + interval '1 hour' where employee_id = tst.id('ion');
select tst.assert((select ends_at from assignments where task_id = tst.id('t_rigips')) = '2026-11-18 16:00 Europe/Bucharest', 'Ion nu poate modifica alocări (RLS)');
-- Nu poate ponta pentru alții
select tst.expect_error($$insert into time_entries(company_id, employee_id, project_id, started_at, ended_at)
  values (tst.id('c1'), tst.id('mihai'), tst.id('p1'), '2026-11-18 08:00+02', '2026-11-18 12:00+02')$$, 'doar pentru tine');
-- Nu poate aproba singur
select tst.expect_error($$insert into time_entries(company_id, employee_id, project_id, started_at, ended_at, status)
  values (tst.id('c1'), tst.id('ion'), tst.id('p1'), '2026-11-18 08:00+02', '2026-11-18 12:00+02', 'aprobat')$$, 'ciornă sau trimis');
-- Pontaj propriu: ciornă → trimis
insert into time_entries(company_id, employee_id, project_id, task_id, started_at, ended_at, break_minutes, status)
  values (tst.id('c1'), tst.id('ion'), tst.id('p1'), tst.id('t_rigips'), '2026-11-18 08:05 Europe/Bucharest', '2026-11-18 16:20 Europe/Bucharest', 30, 'ciorna')
  returning id \gset te_
insert into tst.ids values ('te_ion', :'te_id');
-- Pontaje suprapuse blocate
select tst.expect_error($$insert into time_entries(company_id, employee_id, project_id, started_at, ended_at)
  values (tst.id('c1'), tst.id('ion'), tst.id('p1'), '2026-11-18 12:00 Europe/Bucharest', '2026-11-18 13:00 Europe/Bucharest')$$, 'time_entries_no_overlap');
update time_entries set status = 'trimis' where id = tst.id('te_ion');
select tst.assert((select status from time_entries where id = tst.id('te_ion')) = 'trimis', 'Ion a trimis pontajul');
select tst.expect_error($$update time_entries set status = 'aprobat' where id = tst.id('te_ion')$$, 'Doar administratorul');
-- Progres misiune
select update_task_progress(tst.id('t_rigips'), 40, 'in_lucru', 'Am terminat camera 1');
select tst.expect_error($$select update_task_progress(tst.id('t_elec'), 10, 'in_lucru')$$, 'Nu ai dreptul');
select tst.assert((select count(*) from notes where task_id = tst.id('t_rigips')) = 1, 'observația a fost salvată');
select tst.assert((select count(*) from projects) = 2, 'Ion vede ambele lucrări unde e alocat');

-- ================= George (șef de echipă) =================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select accept_invite(:'code_george');
select tst.expect_error(format('select accept_invite(%L)', :'code_ion'), 'aparține deja');
select tst.assert((select count(*) from time_entries where employee_id = tst.id('ion')) = 1, 'șeful vede pontajele echipei');
select tst.assert((select count(*) from time_entries where employee_id = tst.id('vasile')) = 0, 'șeful nu vede pontaje din afara echipei');
select flag_time_entry(tst.id('te_ion'), 'Verifică ora de sfârșit');
select tst.assert((select flag_note from time_entries where id = tst.id('te_ion')) = 'Verifică ora de sfârșit', 'șeful a semnalat o problemă');
update time_entries set status = 'aprobat' where id = tst.id('te_ion');
select tst.assert((select status from time_entries where id = tst.id('te_ion')) = 'trimis', 'șeful nu poate aproba pontaje');
select update_task_progress(tst.id('t_elec'), 20, 'in_lucru');
select tst.assert((select progress from tasks where id = tst.id('t_elec')) = 20, 'șeful actualizează progresul pe lucrarea echipei');
-- șeful vede tot planningul firmei (doar citire)
select tst.assert((select count(*) from assignments) = (select count(*) from assignments a where a.company_id = tst.id('c1')) and (select count(*) from assignments) >= 3, 'șeful vede toate alocările firmei');
select tst.assert((select count(*) from employees where id = tst.id('vasile')) = 1, 'șeful vede toți angajații firmei');
select tst.assert((select count(*) from projects) = 2, 'șeful vede toate lucrările');
update assignments set ends_at = ends_at + interval '1 hour' where employee_id = tst.id('vasile');
delete from assignments where employee_id = tst.id('mihai');
select tst.assert((select count(*) from assignments where employee_id = tst.id('mihai')) > 0, 'șeful nu poate șterge alocări');
select tst.expect_error($$insert into assignments(company_id, employee_id, project_id, starts_at, ends_at)
  values (tst.id('c1'), tst.id('vasile'), tst.id('p1'), '2026-11-25 08:00+02', '2026-11-25 10:00+02')$$, 'row-level security');
select tst.assert((select count(*) from my_scope_project_ids()) >= 1, 'lucrările proprii ale șefului rămân separate');

-- ================= Admin firma 2 (izolare) =================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select create_company('Alta Firma SRL', 'Europe/Bucharest', 'Ana');
select tst.assert((select count(*) from projects) = 0, 'firma 2 nu vede lucrările firmei 1');
select tst.assert((select count(*) from employees) = 1, 'firma 2 vede doar angajații proprii');
select tst.assert((select count(*) from time_entries) = 0, 'firma 2 nu vede pontajele firmei 1');
select tst.expect_error($$insert into assignments(company_id, employee_id, project_id, starts_at, ends_at)
  values (tst.id('c1'), tst.id('ion'), tst.id('p1'), '2026-11-20 08:00+02', '2026-11-20 10:00+02')$$, 'row-level security');
select tst.expect_error($$insert into projects(company_id, name) values (tst.id('c1'), 'intrus')$$, 'row-level security');

-- ================= Admin firma 1: aprobare + corecție =================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.expect_error($$update time_entries set status = 'respins' where id = tst.id('te_ion')$$, 'time_entries_reject_reason');
update time_entries set status = 'respins', rejection_reason = 'Lipsește pauza' where id = tst.id('te_ion');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
update time_entries set status = 'ciorna' where id = tst.id('te_ion');
update time_entries set break_minutes = 45 where id = tst.id('te_ion');
update time_entries set status = 'trimis' where id = tst.id('te_ion');
select tst.assert((select rejection_reason is null from time_entries where id = tst.id('te_ion')), 'motivul respingerii se șterge la retrimitere');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update time_entries set status = 'aprobat' where id = tst.id('te_ion');
select tst.assert((select worked_minutes from time_entries where id = tst.id('te_ion')) = 450, 'total corect: 08:05–16:20 minus 45 min = 7h30');
select tst.expect_error($$update time_entries set break_minutes = 0 where id = tst.id('te_ion')$$, 'corectat doar de administrator');
select tst.expect_error($$select correct_approved_time_entry(tst.id('te_ion'), '2026-11-18 08:00 Europe/Bucharest', '2026-11-18 16:20 Europe/Bucharest', 45, '')$$, 'Motivul');
select correct_approved_time_entry(tst.id('te_ion'), '2026-11-18 08:00 Europe/Bucharest', '2026-11-18 16:20 Europe/Bucharest', 45, 'Ora reală de început confirmată de șef');
select tst.assert((select worked_minutes from time_entries where id = tst.id('te_ion')) = 455, 'corecția aplicată');
select tst.assert((select status from time_entries where id = tst.id('te_ion')) = 'aprobat', 'rămâne aprobat după corecție');
select tst.assert((select count(*) from time_entry_history where time_entry_id = tst.id('te_ion') and action = 'corectat' and reason like 'Ora reală%') = 1, 'corecția e în istoric cu motiv');
select tst.assert((select count(*) from time_entry_history where time_entry_id = tst.id('te_ion')) >= 7, 'istoricul complet al modificărilor');
select tst.assert((select string_agg(action, ',' order by id) from time_entry_history where time_entry_id = tst.id('te_ion'))
  = 'creat,trimis,semnalat,respins,ciorna,modificat,trimis,aprobat,corectat', 'ordinea acțiunilor din istoric');
delete from time_entries where id = tst.id('te_ion');
select tst.assert(exists (select 1 from time_entries where id = tst.id('te_ion')), 'pontajul aprobat nu poate fi șters');
-- Revocare acces: fișa rămâne, contul se dezleagă, se poate reinvita
delete from memberships where user_id = '00000000-0000-0000-0000-0000000000b1';
select tst.assert((select user_id is null from employees where id = tst.id('ion')), 'revocarea dezleagă contul de fișă');
select tst.assert((select count(*) from time_entries where employee_id = tst.id('ion')) = 1, 'istoricul pontajelor rămâne după revocare');
select tst.assert(length(create_invite(tst.id('ion'), 'angajat')) = 8, 'angajatul poate fi reinvitat');
delete from memberships where user_id = '00000000-0000-0000-0000-00000000000a';
select tst.assert(app_is_admin(), 'adminul nu își poate revoca propriul acces');
update memberships set role = 'angajat' where user_id = '00000000-0000-0000-0000-00000000000a';
select tst.assert(app_is_admin(), 'adminul nu își poate retrograda propriul rol');
\echo TOATE_TESTELE_AU_TRECUT
