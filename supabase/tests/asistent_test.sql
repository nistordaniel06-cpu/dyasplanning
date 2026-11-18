-- Teste 020: oprirea asistentului AI
\set ON_ERROR_STOP 1
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.expect_error('select owner_set_assistant(false)', 'doar proprietarului');
select tst.assert((app_status()->>'assistant')::boolean, 'implicit pornit');
-- adminul îl oprește pentru firma lui
update companies set assistant_enabled = false where id = tst.id('c1');
select tst.assert(not (select assistant_enabled from companies where id = tst.id('c1')), 'adminul îl poate opri');
update companies set assistant_enabled = true where id = tst.id('c1');
-- proprietarul: global și pe firmă
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_set_assistant(false);
select tst.assert(not (app_status()->>'assistant')::boolean and not (owner_settings()->>'assistant_enabled')::boolean, 'oprit global');
select owner_set_assistant(true);
select owner_set_assistant(false, tst.id('c1'));
select tst.assert(not (select assistant_enabled from owner_companies() where id = tst.id('c1')), 'oprit pentru o firmă');
select owner_set_assistant(true, tst.id('c1'));
reset role;
delete from platform_settings where key = 'assistant_enabled';
select 'ASISTENT_TESTE_TRECUTE';
