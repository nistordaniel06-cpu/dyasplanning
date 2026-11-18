-- Teste 011: program implicit 07:00–16:00, pauză 60 min
\set ON_ERROR_STOP 1
reset role;
select set_config('request.jwt.claim.sub', '', false);
select tst.assert((select default_work_start = '07:00' and default_work_end = '16:00' and default_break_minutes = 60 from companies where id = tst.id('c1')), 'implicit firmă: 07–16, 60 min');
insert into employees(company_id, full_name) values (tst.id('c1'), 'Nou Implicit') returning id as n1 \gset
select tst.assert((select work_start = '07:00' and work_end = '16:00' and break_minutes = 60 from employees where id = :'n1'), 'angajat nou: 07–16, pauză 60');
-- firma își schimbă programul implicit → angajații noi îl primesc
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update companies set default_work_start = '06:30', default_work_end = '15:00', default_break_minutes = 30 where id = tst.id('c1');
-- program personalizat trimis din formular rămâne
insert into employees(company_id, full_name, work_start, work_end, break_minutes) values (tst.id('c1'), 'Nou Propriu', '08:00', '17:00', 45) returning id as n3 \gset
select tst.assert((select work_start = '08:00' and break_minutes = 45 from employees where id = :'n3'), 'programul personalizat rămâne');
select tst.assert(apply_default_schedule_to_all() >= 1, 'aplicare la toți');
select tst.assert((select count(*) from employees where company_id = tst.id('c1') and active and (work_start <> '06:30' or break_minutes <> 30)) = 0, 'toți activi au programul firmei');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select tst.expect_error($$select apply_default_schedule_to_all()$$, 'Doar administratorul');
reset role;
select 'PROGRAM_TESTE_TRECUTE';
