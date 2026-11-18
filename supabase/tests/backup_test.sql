-- Teste 018: data ultimului backup
\set ON_ERROR_STOP 1
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select tst.expect_error('select mark_company_backup()', 'Doar administratorul');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select mark_company_backup();
select tst.assert((select last_backup_at > now() - interval '1 minute' from companies where id = tst.id('c1')), 'data backup-ului salvată');
reset role;
select 'BACKUP_TESTE_TRECUTE';
