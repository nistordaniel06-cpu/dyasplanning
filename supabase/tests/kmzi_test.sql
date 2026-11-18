-- Teste 017: adresa de acasă; km „ajuns la muncă” și „ajuns acasă” în aceeași zi
\set ON_ERROR_STOP 1
reset role;
insert into vehicles(company_id, name, plate) values (tst.id('c1'), 'Logan Test', 'B 55 KMZ') returning id as lv \gset
set role authenticated;
-- adresa de acasă: o scrie adminul; o vede adminul și angajatul, nu și colegii
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into employee_private(employee_id, company_id, home_address) values (tst.id('mihai'), tst.id('c1'), 'Str. Lalelelor 5, Chiajna');
select tst.expect_error(format('insert into employee_private(employee_id, company_id, home_address) values (%L, %L, %L)', tst.id('mihai'), tst.id('c1'), repeat('x', 301)), 'check');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from employee_private) = 0, 'altă firmă nu vede adresa');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select tst.assert((select home_address from employee_private where employee_id = tst.id('mihai')) like 'Str. Lalelelor%', 'angajatul își vede adresa');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select tst.assert((select count(*) from employee_private where employee_id = tst.id('mihai')) = 0, 'colegul nu vede adresa');
select tst.expect_error(format('insert into employee_private(employee_id, company_id, home_address) values (%L, %L, %L)', tst.id('mihai'), tst.id('c1'), 'x'), 'row-level security');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
-- dimineața: ajuns la muncă; seara: ajuns acasă (aceeași zi, aceeași mașină)
select submit_odometer(:'lv', 50000, null, app_today() - 1, 'munca', 44.43, 26.04);
select submit_odometer(:'lv', 50060, null, app_today() - 1, 'acasa', 44.40, 25.98);
select submit_odometer(:'lv', 50085, null, app_today(), 'munca');
select tst.expect_error(format('select submit_odometer(%L, 50070, null, app_today(), %L)', :'lv', 'acasa'), 'mai mic decât citirea anterioară');
select tst.expect_error(format('select submit_odometer(%L, 50090, null, app_today() - 1, %L)', :'lv', 'acasa'), 'mai mare decât citirea următoare');
select submit_odometer(:'lv', 50140, null, app_today(), 'acasa');
select tst.assert((select count(*) from my_odometer_today() where vehicle_id = :'lv') = 2, 'două citiri azi: la muncă și acasă');
select tst.assert((select string_agg(kind, ',') from my_odometer_today() where vehicle_id = :'lv') = 'munca,acasa', 'ordinea: întâi la muncă');
-- corectare: aceeași citire (aceeași zi și același moment) se actualizează
select submit_odometer(:'lv', 50145, null, app_today(), 'acasa');
reset role;
select tst.assert((select count(*) from odometer_readings where vehicle_id = :'lv') = 4, 'patru citiri (2 zile × 2)');
select tst.assert((select km from odometer_readings where vehicle_id = :'lv' and reading_date = app_today() and kind = 'acasa') = 50145, 'corectată');
select tst.assert((select lat is not null and recorded_at is not null from odometer_readings where vehicle_id = :'lv' and kind = 'munca' and reading_date = app_today() - 1), 'locul și ora citirii');
select tst.assert((select count(*) from notifications where title like 'Km ajuns acasă:%') >= 1, 'notificarea spune momentul');
select tst.expect_error(format('insert into odometer_readings(company_id, vehicle_id, reading_date, kind, km) values (%L, %L, app_today(), %L, 1)', tst.id('c1'), :'lv', 'pauza'), 'odometer_readings_kind_check');
delete from vehicles where id = :'lv';
delete from employee_private;
select 'KMZI_TESTE_TRECUTE';
