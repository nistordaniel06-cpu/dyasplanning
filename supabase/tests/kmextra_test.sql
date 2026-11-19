-- Teste 024: km extra (scriși de mână sau cu GPS)
\set ON_ERROR_STOP 1
reset role;
insert into vehicles(company_id, name, plate) values (tst.id('c1'), 'Dacia Extra', 'B 77 EXT') returning id as xv \gset
insert into vehicles(company_id, name, plate) values (tst.id('c1'), 'Ford Extra', 'B 78 EXT') returning id as xv2 \gset
update employees set is_driver = true where id = tst.id('mihai');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select add_extra_trip(:'xv', 12.34, 'Dedeman → Vila Otopeni', 'gps', now() - interval '30 minutes', now(), app_today());
select add_extra_trip(:'xv2', 35, null, 'manual');
select tst.assert((select count(*) from extra_trips) = 2, 'șoferul își vede traseele (și cu altă mașină)');
select tst.assert((select km from extra_trips where source = 'gps') = 12.3, 'km rotunjiți la 0,1');
select tst.expect_error(format('select add_extra_trip(%L, 0)', :'xv'), 'Scrie câți km');
select tst.expect_error(format('select add_extra_trip(%L, 5000)', :'xv'), 'maxim 3000');
select tst.expect_error(format('insert into extra_trips(company_id, vehicle_id, trip_date, km) values (%L, %L, app_today(), 5)', tst.id('c1'), :'xv'), 'row-level security');
select delete_my_extra_trip((select id from extra_trips where source = 'manual'));
select tst.assert((select count(*) from extra_trips) = 1, 'șoferul își șterge traseul greșit');
-- colegul nu vede traseele altuia și nu le poate șterge
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select tst.assert((select count(*) from extra_trips) = 0, 'colegul nu vede traseele');
reset role;
select id as gid from extra_trips where source = 'gps' \gset
set role authenticated;
select tst.expect_error(format('select delete_my_extra_trip(%L)', :'gid'), 'nu poate fi șters');
-- altă firmă
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from extra_trips) = 0, 'altă firmă nu vede traseele');
-- adminul vede tot și primește notificare
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.assert((select count(*) from extra_trips) = 1, 'adminul vede traseele');
reset role;
select tst.assert((select count(*) from notifications where title like 'Km extra:%') >= 2, 'adminul e anunțat');
delete from extra_trips; delete from vehicles where id in (:'xv', :'xv2');
select 'KMEXTRA_TESTE_TRECUTE';
