-- Teste 010: eliminarea / ștergerea unui angajat de către admin (înainte de delete_test)
\set ON_ERROR_STOP 1
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into employees(company_id, full_name, phone) values (tst.id('c1'), 'Vasile Test', '+40 711000222') returning id as v_id \gset
insert into employees(company_id, full_name, phone) values (tst.id('c1'), 'Gigel Sters', '+40 711000333') returning id as g_id \gset
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select grant_phone_access(:'v_id', 'angajat');
reset role;
select tst.assert((select user_id is not null from employees where id = :'v_id'), 'Vasile are cont');
-- angajatul nu poate elimina
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select tst.expect_error(format('select admin_remove_employee(%L)', :'v_id'), 'Doar administratorul');
-- adminul elimină: inactiv, fără acces, contul de telefon șters
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select admin_remove_employee(:'v_id');
reset role;
select tst.assert((select not active and user_id is null from employees where id = :'v_id'), 'eliminat: inactiv și fără acces');
select tst.assert((select count(*) from auth.users where email = 't40711000222@telefon.dyasplanning.app') = 0, 'contul de telefon a fost șters');
-- poate primi din nou acces (același număr)
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update employees set active = true where id = :'v_id';
select tst.assert((grant_phone_access(:'v_id', 'angajat')->>'code') is not null, 'cod nou după reactivare');
-- ștergere definitivă cu confirmare
insert into time_entries(company_id, employee_id, project_id, started_at, ended_at, status) values (tst.id('c1'), :'g_id', tst.id('p1'), '2026-11-11 06:00+00', '2026-11-11 14:00+00', 'ciorna');
select tst.expect_error(format('select admin_remove_employee(%L, true, %L)', :'g_id', 'gigel'), 'exact numele');
select admin_remove_employee(:'g_id', true, 'Gigel Sters');
reset role;
select tst.assert((select count(*) from employees where id = :'g_id') = 0, 'angajat șters definitiv');
select tst.assert((select count(*) from time_entries where employee_id = :'g_id') = 0, 'pontajele lui șterse');
select tst.assert((select count(*) from owner_activity where summary = 'Dan Admin a șters angajatul „Gigel Sters”') = 1, 'ștergerea apare în jurnalul proprietarului');
-- adminul nu se poate elimina pe el
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.expect_error(format('select admin_remove_employee(%L)', (select employee_id from memberships where user_id = '00000000-0000-0000-0000-00000000000a')), 'pe tine');
reset role;
select 'ELIMINARE_TESTE_TRECUTE';
