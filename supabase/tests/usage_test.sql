-- Teste 009: utilizarea aplicației (după details_test, înainte de delete_test)
\set ON_ERROR_STOP 1
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select company_app_usage(30) as u \gset
select tst.assert(jsonb_array_length(:'u'::jsonb->'daily') = 30, 'serie zilnică de 30 de zile');
select tst.assert(jsonb_array_length(:'u'::jsonb->'people') = (select count(*) from employees where company_id = tst.id('c1') and active), 'toți angajații activi');
select tst.assert((select (p->>'active_days')::int from jsonb_array_elements(:'u'::jsonb->'people') p where p->>'employee_id' = (select id::text from employees where user_id = '00000000-0000-0000-0000-0000000000b2')) >= 1, 'zile active din conectări');
select tst.assert(company_app_usage(7)->>'days' = '7', 'perioadă de 7 zile');
-- angajatul nu are acces
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select tst.expect_error($$select company_app_usage(30)$$, 'Doar administratorul');
select tst.expect_error($$select usage_report(tst.id('c1'), 30)$$, 'permission denied');
-- proprietarul vede orice firmă
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select tst.assert(jsonb_array_length(owner_company_usage(tst.id('c1'), 30)->'people') > 0, 'proprietarul vede utilizarea firmei');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.expect_error($$select owner_company_usage(tst.id('c1'), 30)$$, 'doar proprietarului');
reset role;
select 'UTILIZARE_TESTE_TRECUTE';
