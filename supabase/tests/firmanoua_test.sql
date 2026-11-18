-- Teste 015: proprietarul creează o firmă nouă cu emailul și parola administratorului
\set ON_ERROR_STOP 1
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.expect_error($$select owner_create_company('Firma X', 'Ana', 'ana@x.ro', 'parola123')$$, 'doar proprietarului');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select tst.expect_error($$select owner_create_company('Firma X', 'Ana', 'nu-e-email', 'parola123')$$, 'email nu e validă');
select tst.expect_error($$select owner_create_company('Firma X', 'Ana', 'ana@x.ro', 'scurt')$$, 'cel puțin 8');
select tst.expect_error($$select owner_create_company('Firma X', 'Ana', 'owner@dyas.ro', 'parola123')$$, 'Există deja un cont');
select owner_create_company('Firma Nouă SRL', 'Ana Popescu', ' Ana@FirmaNoua.ro ', 'parola123') as nc \gset
select tst.assert((select count(*) from owner_companies() where id = :'nc' and admin_email = 'ana@firmanoua.ro') = 1, 'firma apare în panou cu emailul administratorului');
reset role;
select tst.assert((select encrypted_password = extensions.crypt('parola123', encrypted_password) and email_confirmed_at is not null
  from auth.users where email = 'ana@firmanoua.ro'), 'cont creat cu parola aleasă, confirmat');
select tst.assert((select m.role = 'admin' and e.full_name = 'Ana Popescu' from memberships m join auth.users u on u.id = m.user_id
  join employees e on e.id = m.employee_id where u.email = 'ana@firmanoua.ro' and m.company_id = :'nc'), 'administratorul firmei noi');
select tst.assert((select count(*) from owner_activity where op = 'firma_noua') = 1, 'apare în jurnal');
delete from companies where id = :'nc';
delete from auth.users where email = 'ana@firmanoua.ro';
select 'FIRMANOUA_TESTE_TRECUTE';
