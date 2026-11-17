-- Teste 005: alerte pentru proprietar (după owner_test)
\set ON_ERROR_STOP 1
reset role;
delete from notifications where user_id = '00000000-0000-0000-0000-0000000000f0';
-- firmă nouă → alertă
insert into auth.users(id, email) values ('00000000-0000-0000-0000-0000000000e1', 'nou@firma4.ro') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', false);
select create_company('Firma Patru SRL', 'Europe/Amsterdam', 'Eva') as c4 \gset
reset role;
select tst.assert((select count(*) from notifications where user_id = '00000000-0000-0000-0000-0000000000f0' and kind = 'owner_signup' and title = 'Firmă nouă: Firma Patru SRL' and body like 'Admin: nou@firma4.ro%') = 1, 'alertă firmă nouă cu emailul adminului');
select tst.assert((select count(*) from notifications where kind = 'owner_signup' and user_id <> '00000000-0000-0000-0000-0000000000f0') = 0, 'alerta ajunge doar la proprietar');
-- verificarea zilnică (rulează fără utilizator, ca jobul programat)
select set_config('request.jwt.claim.sub', '', false);
update companies set trial_until = (now() at time zone 'Europe/Bucharest')::date + 3 where id = :'c4';
update companies set trial_until = (now() at time zone 'Europe/Bucharest')::date - 1 where id = tst.id('c1');
select tst.assert(owner_daily_check() >= 2, 'verificarea zilnică găsește probele');
select tst.assert((select count(*) from notifications where kind = 'owner_trial_soon' and title like '%Firma Patru SRL') = 1, 'alertă: proba expiră în 3 zile');
select tst.assert((select count(*) from notifications where kind = 'owner_trial_expired') = 1, 'alertă: proba a expirat');
-- firmă inactivă de 14 zile
delete from login_events where company_id = :'c4';
update auth.users set last_sign_in_at = now() - interval '14 days' where id = '00000000-0000-0000-0000-0000000000e1';
update companies set trial_until = null where id = :'c4';
select owner_daily_check();
select tst.assert((select count(*) from notifications where kind = 'owner_inactive' and title like '%Firma Patru SRL') = 1, 'alertă: firmă inactivă 14 zile');
-- utilizatorii obișnuiți nu pot apela funcțiile interne
set role authenticated;
select tst.expect_error($$select owner_daily_check()$$, 'permission denied');
select tst.expect_error($$select owner_alert('x','y','z',null)$$, 'permission denied');
select tst.expect_error($$select owner_test_alert()$$, 'doar proprietarului');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_test_alert();
reset role;
select tst.assert((select count(*) from notifications where kind = 'owner_test' and user_id = '00000000-0000-0000-0000-0000000000f0') = 1, 'alerta de test ajunge la proprietar');
select 'ALERTE_TESTE_TRECUTE';
