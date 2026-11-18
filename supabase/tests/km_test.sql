-- Teste pentru 002_km_masini (rulează după flow_test.sql, pe aceleași date).
\set ON_ERROR_STOP 1
set role authenticated;

-- Admin: mașină + Mihai șofer (Mihai nu are cont → îi dăm unul prin invitație)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into vehicles(company_id, name, plate) values (tst.id('c1'), 'Dacia Duster', 'B 123 ABC') returning id \gset v_
insert into tst.ids values ('car', :'v_id');
insert into vehicles(company_id, name, plate) values (tst.id('c1'), 'Ford Transit', 'B 77 DYS') returning id \gset v_
insert into tst.ids values ('van', :'v_id');
select tst.expect_error($$insert into vehicles(company_id, name, plate) values (tst.id('c1'), 'Dublura', 'b 123 abc')$$, 'uq_vehicles_plate');
update employees set is_driver = true, default_vehicle_id = tst.id('car') where id = tst.id('mihai');
select create_invite(tst.id('mihai'), 'angajat') as code \gset inv_
reset role;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000b3', 'mihai@firma1.ro') on conflict do nothing;
set role authenticated;

-- Citiri istorice (inserate de admin): ieri 100000, alaltăieri 99800
insert into odometer_readings(company_id, vehicle_id, employee_id, reading_date, km) values
  (tst.id('c1'), tst.id('car'), tst.id('mihai'), app_today() - 2, 99800),
  (tst.id('c1'), tst.id('car'), tst.id('mihai'), app_today() - 1, 100000);

-- Mihai (șofer)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select accept_invite(:'inv_code');
select tst.assert((select count(*) from vehicles) = 2, 'șoferul vede lista de mașini');
select tst.assert((select count(*) from odometer_readings) = 0, 'șoferul NU vede citirile de km (doar adminul)');
select tst.expect_error($$insert into odometer_readings(company_id, vehicle_id, reading_date, km) values (tst.id('c1'), tst.id('car'), current_date, 1)$$, 'row-level security');
select tst.expect_error($$select submit_odometer(tst.id('car'), 99999)$$, 'mai mic decât citirea anterioară');
select submit_odometer(tst.id('car'), 100250, 'plecare 07:10');
select tst.assert((select km from my_odometer_today()) = 100250, 'șoferul își vede confirmarea de azi');
select submit_odometer(tst.id('car'), 100245);
select tst.assert((select km from my_odometer_today()) = 100245, 'șoferul își poate corecta citirea în aceeași zi');



-- George (șef de echipă, nu e șofer)
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select tst.expect_error($$select submit_odometer(tst.id('car'), 100300)$$, 'Nu ești setat ca șofer');
select tst.assert((select count(*) from odometer_readings) = 0, 'șeful de echipă nu vede citirile');

-- Firma 2 nu vede nimic
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from vehicles) = 0, 'firma 2 nu vede mașinile firmei 1');
select tst.expect_error($$select submit_odometer(tst.id('car'), 100300)$$, '');

-- Admin vede tot; diferențele se pot calcula
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.assert((select count(*) from odometer_readings where vehicle_id = tst.id('car')) = 3, 'adminul vede toate citirile');
select tst.assert((select km - lag(km) over (order by reading_date) from odometer_readings where vehicle_id = tst.id('car') order by reading_date desc limit 1) = 245, 'km parcurși ieri = 245');
select tst.assert((select note from odometer_readings where reading_date = app_today() and vehicle_id = tst.id('car')) is null, 'nota a fost înlocuită la corecție');
\echo KM_TESTE_TRECUTE
