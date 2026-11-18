-- Teste 019: mesaje directe, „Ce e nou”, cereri de ajutor, mod mentenanță
\set ON_ERROR_STOP 1
reset role;
delete from notifications;
set role authenticated;
-- un utilizator obișnuit nu poate folosi funcțiile proprietarului
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.expect_error(format('select owner_send_message(%L, null, %L, %L)', tst.id('c1'), 'Salut', 'x'), 'doar proprietarului');
select tst.expect_error($$select owner_set_maintenance(true, 'x', 10)$$, 'doar proprietarului');
select tst.expect_error($$select owner_news_save(null, 'Titlu', 'Text', 'toti', true)$$, 'doar proprietarului');

-- 1) mesaj direct
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_send_message(tst.id('c1'), null, 'Funcție nouă', 'Am adăugat backup.', 'admini', true, 3) as n_adm \gset
select tst.assert(:n_adm >= 1, 'mesaj către adminii firmei');
select owner_send_message(null, '00000000-0000-0000-0000-0000000000b3', 'Salut Mihai', 'Test', 'toti', false) as n_one \gset
select tst.assert(:n_one = 1, 'mesaj către un singur utilizator');
select tst.assert((select count(*) from owner_messages_list()) = 2, 'istoricul mesajelor');
reset role;
select tst.assert((select count(*) from notifications where kind = 'owner_message' and user_id = '00000000-0000-0000-0000-0000000000b3') = 1, 'Mihai a primit doar mesajul lui');
select tst.assert((select count(*) from notifications where kind = 'owner_message' and user_id = '00000000-0000-0000-0000-00000000000a') = 1, 'adminul a primit mesajul');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.assert((select title from current_announcement()) = 'Funcție nouă', 'bannerul apare în firma aleasă');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from current_announcement() where title = 'Funcție nouă') = 0, 'nu apare în altă firmă');

-- 2) Ce e nou
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_news_save(null, 'Backup din Setări', 'Poți descărca toate datele.', 'admini', true) as news1 \gset
select owner_news_save(null, 'Km acasă', 'Șoferii scriu km și acasă.', 'toti', true) as news2 \gset
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.assert((select count(*) from my_news()) = 2, 'adminul vede ambele noutăți');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select tst.assert((select count(*) from my_news()) = 1, 'angajatul vede doar noutatea pentru toți');
select mark_news_seen();
select tst.assert((select count(*) from my_news()) = 0, 'o dată văzute, nu mai apar');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select tst.assert((select seen from owner_news_list() where id = :'news2') >= 1, 'proprietarul vede câți au citit');

-- 3) cereri de ajutor
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select tst.expect_error($$select send_support_request('x')$$, 'Scrie cu ce te putem ajuta');
select send_support_request('Nu pot adăuga poze la pontaj.', '/pontaj') as req \gset
select tst.assert((select count(*) from support_requests) = 1, 'angajatul își vede cererea');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.assert((select count(*) from support_requests) = 0, 'alții nu văd cererea');
reset role;
select tst.assert((select count(*) from notifications where kind = 'support' and user_id = '00000000-0000-0000-0000-0000000000f0') = 1, 'proprietarul e anunțat');
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select tst.assert((select status from owner_support_list(null) where id = :'req') = 'nou', 'cererea apare la proprietar');
select owner_support_reply(:'req', 'Permite camera din setările telefonului.', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b3', false);
select tst.assert((select status = 'rezolvat' and reply like 'Permite camera%' from support_requests where id = :'req'), 'angajatul vede răspunsul');
reset role;
select tst.assert((select count(*) from notifications where kind = 'support' and user_id = '00000000-0000-0000-0000-0000000000b3') = 1, 'angajatul e anunțat de răspuns');
set role authenticated;

-- 4) mentenanță
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select (app_status()->>'maintenance')::boolean as m0 \gset
set role authenticated;
select tst.assert(not :'m0'::boolean, 'implicit fără mentenanță');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_set_maintenance(true, 'Revenim în 10 minute.', 10);
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select (app_status()->>'maintenance')::boolean as m1, app_status()->>'message' as msg \gset
set role authenticated;
select tst.assert(:'m1'::boolean and :'msg' = 'Revenim în 10 minute.', 'mentenanța se vede și fără cont');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000f0', false);
select owner_set_maintenance(true, 'expirat', null);
reset role;
update platform_settings set value = jsonb_set(value, '{until}', to_jsonb((now() - interval '1 minute')::text)) where key = 'maintenance';
select tst.assert(not (app_status()->>'maintenance')::boolean, 'mentenanța expiră singură');
delete from platform_settings where key = 'maintenance';
delete from announcements where company_id is not null;
delete from app_news; delete from app_news_seen; delete from support_requests; delete from owner_messages;
select 'COMUNICARE_TESTE_TRECUTE';
