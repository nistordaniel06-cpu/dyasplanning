-- Teste 025: foaia de parcurs (curse cu km start / km stop)
\set ON_ERROR_STOP 1
reset role;
insert into vehicles(company_id, name, plate) values (tst.id('c1'), 'VW Caddy', 'VX-758-G') returning id as cv \gset
insert into vehicles(company_id, name, plate) values (tst.id('c1'), 'Ford Curse', 'B 99 CRS') returning id as cv2 \gset
update employees set is_driver = true where id in (tst.id('mihai'));
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
-- dimineața: Acasă → Muncă 1
select start_trip('11111111-0000-0000-0000-000000000001', :'cv', 20000, 'Acasă');
select tst.expect_error(format('select start_trip(%L, %L, 20100, %L)', '11111111-0000-0000-0000-000000000009', :'cv2', 'Acasă'), 'deja o cursă pornită');
select tst.expect_error($$select end_trip('11111111-0000-0000-0000-000000000001', 19999, 'Muncă 1')$$, 'cel puțin cât km la plecare');
select end_trip('11111111-0000-0000-0000-000000000001', 20100, 'Muncă 1', null, 'Andrei');
-- trimisă de două ori (fără semnal): nu dublează
select start_trip('11111111-0000-0000-0000-000000000001', :'cv', 20000, 'Acasă');
select tst.assert((vehicle_last_km(:'cv')->>'km')::int = 20100, 'ultimii km ai mașinii = km la sosire');
select tst.expect_error(format('select start_trip(%L, %L, 20050, %L)', '11111111-0000-0000-0000-000000000002', :'cv', 'Muncă 1'), 'mai mici decât ultimii km');
-- seara: Muncă 1 → Acasă, apoi a doua zi Acasă → Muncă 2
select start_trip('11111111-0000-0000-0000-000000000002', :'cv', 20100, 'Muncă 1');
select end_trip('11111111-0000-0000-0000-000000000002', 20200, 'Acasă', null, 'Denis');
select start_trip('11111111-0000-0000-0000-000000000003', :'cv', 20200, 'Acasă');
select end_trip('11111111-0000-0000-0000-000000000003', 20250, 'Muncă 2', null, null, true, 48.7);
select tst.assert((select string_agg(seq::text || ':' || from_place || '>' || to_place || '=' || (km_end - km_start), ',' order by seq) from trips where vehicle_id = :'cv')
  = '1:Acasă>Muncă 1=100,2:Muncă 1>Acasă=100,3:Acasă>Muncă 2=50', 'foaia de parcurs: nr., de la → la, km');
select tst.assert((select private and gps_km = 48.7 from trips where seq = 3 and vehicle_id = :'cv'), 'personal + km GPS');
-- corectare: km la sosire nu pot depăși km de plecare ai cursei următoare
select tst.expect_error($$select end_trip('11111111-0000-0000-0000-000000000002', 20210, 'Acasă')$$, 'mai mari decât km la plecare ai cursei următoare');
select end_trip('11111111-0000-0000-0000-000000000002', 20195, 'Acasă', null, 'Denis');
-- anulare cursă pornită din greșeală
select start_trip('11111111-0000-0000-0000-000000000004', :'cv', 20250, 'Muncă 2');
select tst.expect_error($$select cancel_my_trip('11111111-0000-0000-0000-000000000003')$$, 'nu poate fi anulată');
select cancel_my_trip('11111111-0000-0000-0000-000000000004');
-- colegul nu vede cursele, nu le poate modifica, nu poate porni (nu e șofer)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select tst.assert((select count(*) from trips) = 0, 'colegul nu vede cursele');
select tst.expect_error($$select end_trip('11111111-0000-0000-0000-000000000003', 20260, 'X')$$, 'Nu ești setat ca șofer');
select tst.expect_error(format('select start_trip(gen_random_uuid(), %L, 20250, %L)', :'cv', 'Acasă'), 'Nu ești setat ca șofer');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from trips) = 0, 'altă firmă nu vede cursele');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.assert((select count(*) from trips) = 3, 'adminul vede cursele');
update trips set purpose = 'corectat de admin' where seq = 1 and vehicle_id = :'cv';
reset role;
select tst.assert((select count(*) from notifications where title like 'Cursă: Acasă → Muncă 1%') >= 1, 'adminul e anunțat la sosire');
delete from trips; delete from vehicles where id in (:'cv', :'cv2');
select 'CURSE_TESTE_TRECUTE';
