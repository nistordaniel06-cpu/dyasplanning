-- Teste 004: panoul proprietarului (după celelalte teste, pe aceleași date)
\set ON_ERROR_STOP 1
reset role;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000f0', 'owner@dyas.ro') on conflict do nothing;
insert into platform_owners(user_id) values ('00000000-0000-0000-0000-0000000000f0') on conflict do nothing;
insert into app_config(key, value) values ('push_secret', 'S3CRET') on conflict (key) do update set value = excluded.value;

-- admin obișnuit: nu are acces
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.assert(not is_platform_owner(), 'adminul firmei nu e proprietar');
select tst.expect_error($$select owner_overview()$$, 'doar proprietarului');
select tst.expect_error($$select * from owner_companies()$$, 'doar proprietarului');
select tst.expect_error($$select * from owner_login_events()$$, 'doar proprietarului');
select tst.expect_error($$select owner_update_company(tst.id('c1'), 'suspendat', 'gratuit', null, null)$$, 'doar proprietarului');
select tst.expect_error($$select owner_set_signup(false)$$, 'doar proprietarului');
select tst.expect_error($$select * from login_events$$, 'permission denied');
select tst.expect_error($$select * from platform_owners$$, 'permission denied');
-- adminul nu își poate schimba singur planul
select tst.expect_error($$update companies set plan = 'premium' where id = tst.id('c1')$$, 'Doar proprietarul');
update companies set travel_buffer_minutes = 25 where id = tst.id('c1');
select tst.assert((select travel_buffer_minutes from companies where id = tst.id('c1')) = 25, 'adminul poate schimba restul setărilor');

-- prezență: doar cu secret, cu limitare la 30 min pe același IP
select tst.expect_error($$select record_presence('gresit', '00000000-0000-0000-0000-0000000000b2', '1.2.3.4', 'Cluj', null, 'RO', 46.7, 23.6, 'Android · Chrome')$$, 'Secret invalid');
select tst.assert(record_presence('S3CRET', '00000000-0000-0000-0000-0000000000b2', '1.2.3.4', 'Cluj-Napoca', 'CJ', 'RO', 46.7, 23.6, 'Android · Chrome', true), 'prima conectare salvată');
select tst.assert(not record_presence('S3CRET', '00000000-0000-0000-0000-0000000000b2', '1.2.3.4', 'Cluj-Napoca', 'CJ', 'RO', 46.7, 23.6, 'Android · Chrome', true), 'repetarea imediată nu dublează');
select tst.assert(record_presence('S3CRET', '00000000-0000-0000-0000-0000000000b2', '5.6.7.8', 'Utrecht', 'UT', 'NL', 52.1, 5.1, 'Android · Chrome', true), 'IP nou = conectare nouă');

-- proprietarul vede tot
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select tst.assert(is_platform_owner(), 'proprietarul e recunoscut');
select tst.assert((owner_overview()->>'companies')::int >= 2, 'prezentare: numără firmele');
select tst.assert((select count(*) from owner_companies()) >= 2, 'lista tuturor firmelor');
select tst.assert((select admin_email from owner_companies() where id = tst.id('c1')) = 'admin@firma1.ro', 'emailul adminului firmei');
select tst.assert((select last_city from owner_companies() where id = tst.id('c1')) = 'Utrecht', 'ultimul oraș al firmei');
select tst.assert((select count(*) from owner_login_events(tst.id('c1'))) = 2, 'istoric conectări pe firmă');
select tst.assert((select last_country from owner_company_users(tst.id('c1')) where user_id = '00000000-0000-0000-0000-0000000000b2') = 'NL', 'ultima locație a utilizatorului');

-- suspendare: utilizatorii firmei nu mai văd nimic
select owner_update_company(tst.id('c1'), 'suspendat', 'proba', current_date + 14, 'neplătit');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select tst.assert(my_company_status() = 'suspendat', 'angajatul vede că firma e suspendată');
select tst.assert((select count(*) from projects) = 0, 'firma suspendată nu vede lucrările');
select tst.assert((select count(*) from employees) = 0, 'firma suspendată nu vede angajații');
select tst.expect_error($$insert into projects(company_id, name) values (tst.id('c1'), 'X')$$, '');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from companies) = 1, 'altă firmă nu e afectată');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_update_company(tst.id('c1'), 'activ', 'standard', null, '');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select tst.assert((select count(*) from projects) > 0, 'reactivare: datele revin');

-- închiderea înscrierilor
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_set_signup(false);
reset role;
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000d1', 'nou@firma3.ro') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select tst.expect_error($$select create_company('Firma 3', 'Europe/Bucharest')$$, 'închisă');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_set_signup(true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
select tst.assert(create_company('Firma 3', 'Europe/Bucharest') is not null, 'înscrierea redeschisă');
reset role;
select 'OWNER_TESTE_TRECUTE';
