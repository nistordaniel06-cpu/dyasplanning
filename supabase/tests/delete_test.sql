-- Teste 007: ștergerea definitivă a unei firme (la final, pe firma c1 cu date complete)
\set ON_ERROR_STOP 1
reset role;
select set_config('request.jwt.claim.sub', '', false);
select count(*) as phones from memberships m join auth.users u on u.id = m.user_id where m.company_id = tst.id('c1') and u.email like '%@telefon.dyasplanning.app' \gset
select tst.assert((select count(*) from time_entries where company_id = tst.id('c1')) > 0, 'firma are pontaje înainte de ștergere');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.expect_error($$select owner_delete_company(tst.id('c1'), 'Construct SRL')$$, 'doar proprietarului');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select tst.expect_error($$select owner_delete_company(tst.id('c1'), 'construct')$$, 'exact numele');
select owner_delete_company(tst.id('c1'), 'Construct SRL');
select tst.assert(is_platform_owner(), 'proprietarul rămâne proprietar după ștergere');
reset role;
select tst.assert((select count(*) from companies where id = tst.id('c1')) = 0, 'firma ștearsă');
select tst.assert((select count(*) from employees where company_id = tst.id('c1')) = 0, 'angajații șterși');
select tst.assert((select count(*) from time_entries where company_id = tst.id('c1')) = 0, 'pontajele șterse');
select tst.assert((select count(*) from time_entry_history where company_id = tst.id('c1')) = 0, 'istoricul pontajelor șters');
select tst.assert((select count(*) from memberships where company_id = tst.id('c1')) = 0, 'conturile nu mai aparțin firmei');
select tst.assert((select count(*) from auth.users where email like '%@telefon.dyasplanning.app' and id not in (select user_id from memberships)) = 0, 'conturile de telefon ale firmei au fost șterse');
select tst.assert((select count(*) from companies) >= 2, 'celelalte firme rămân');
select 'STERGERE_TESTE_TRECUTE';
