-- Teste 003 (după flow_test și km_test, pe aceleași date)
\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

-- normalizare telefon (funcție internă)
reset role;
select tst.assert(norm_phone('0722 100 003') = '40722100003', 'telefon RO 07.. → 407..');
select tst.assert(norm_phone('+31 6 1234 5678') = '31612345678', 'telefon NL cu +31');
select tst.assert(norm_phone('0031612345678') = '31612345678', 'telefon cu 00');
set role authenticated;
select tst.expect_error($$select norm_phone('1')$$, 'permission denied');

-- acces cu telefon pentru Andrei (fără cont)
update employees set phone = '0744 555 666' where id = tst.id('andrei');
select tst.expect_error($$select grant_phone_access(tst.id('vasile'))$$, 'Completează numărul');
select grant_phone_access(tst.id('andrei'), 'angajat')->>'code' as code \gset g_
select tst.assert(:'g_code' ~ '^[0-9]{6}$', 'codul are 6 cifre');
reset role;
select tst.assert((select encrypted_password = extensions.crypt(:'g_code', encrypted_password) from auth.users where email = 't40744555666@telefon.dyasplanning.app'), 'contul cu telefon are parola = codul');
select tst.assert((select m.role = 'angajat' from memberships m join employees e on e.user_id = m.user_id where e.id = tst.id('andrei')), 'angajatul e legat de firmă');
select id as uid from auth.users where email = 't40744555666@telefon.dyasplanning.app' \gset andrei_
set role authenticated;
-- resetare cod: același cont, parolă nouă
select grant_phone_access(tst.id('andrei'), 'angajat')->>'code' as code \gset g2_
reset role;
select tst.assert((select count(*) from auth.users where email = 't40744555666@telefon.dyasplanning.app') = 1, 'resetarea nu creează cont nou');
select tst.assert((select encrypted_password = extensions.crypt(:'g2_code', encrypted_password) from auth.users where email = 't40744555666@telefon.dyasplanning.app'), 'codul nou funcționează');
set role authenticated;
-- același telefon la alt angajat = refuzat
update employees set phone = '+40744555666' where id = tst.id('vasile');
select tst.expect_error($$select grant_phone_access(tst.id('vasile'))$$, 'folosit de alt angajat');
update employees set phone = null where id = tst.id('vasile');

-- schimbare număr: contul trece pe numărul nou
update employees set phone = '0755 000 111' where id = tst.id('andrei');
select grant_phone_access(tst.id('andrei'))->>'code' as code \gset g3_
reset role;
select tst.assert((select email from auth.users where id = :'andrei_uid') = 't40755000111@telefon.dyasplanning.app', 'contul a trecut pe numărul nou');
set role authenticated;

-- angajatul nu poate genera coduri
select set_config('request.jwt.claim.sub', :'andrei_uid', false);
select tst.expect_error($$select grant_phone_access(tst.id('mihai'))$$, 'Doar administratorul');

-- notificări la modificarea programului
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
insert into assignments(company_id, employee_id, project_id, starts_at, ends_at)
  values (tst.id('c1'), tst.id('andrei'), tst.id('p2'), now() + interval '2 days', now() + interval '2 days 4 hours');
select set_config('request.jwt.claim.sub', :'andrei_uid', false);
select tst.assert((select count(*) from notifications where title = 'Program nou') = 1, 'angajatul primește notificare la alocare nouă');
select tst.assert((select body from notifications where title = 'Program nou') like 'Casă Ploiești%', 'notificarea conține lucrarea');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
update assignments set ends_at = ends_at + interval '1 hour' where employee_id = tst.id('andrei') and project_id = tst.id('p2');
select tst.assert((select count(*) from notifications where user_id <> auth.uid()) = 0, 'adminul nu vede notificările altora');
select set_config('request.jwt.claim.sub', :'andrei_uid', false);
select tst.assert((select count(*) from notifications where title = 'Programul tău s-a schimbat') = 1, 'notificare la modificare');
update notifications set read_at = now();
select tst.assert((select count(*) from notifications where read_at is null) = 0, 'angajatul își marchează notificările citite');
select tst.expect_error($$insert into notifications(company_id, user_id, title) values (tst.id('c1'), auth.uid(), 'fals')$$, 'permission denied');

-- chat
select count(*) from my_chat_channels();
select tst.assert((select count(*) from my_chat_channels() where kind = 'general') = 1, 'canalul „Toată firma” există');
select tst.assert((select count(*) from my_chat_channels() where kind = 'project') >= 1, 'angajatul vede canalul lucrării lui');
select id as gen from my_chat_channels() where kind = 'general' \gset ch_
insert into chat_messages(channel_id, body) values (:'ch_gen', 'Salut tuturor!');
select tst.assert((select author_name from chat_messages where body = 'Salut tuturor!') = 'Andrei Vasile', 'autorul mesajului e setat corect');
select open_direct_chat('00000000-0000-0000-0000-00000000000a') as dm \gset d_
insert into chat_messages(channel_id, body) values (:'d_dm', 'Mâine întârzii 15 minute.');

-- firma 2 nu vede chatul firmei 1
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', false);
select tst.assert((select count(*) from chat_messages) = 0, 'firma 2 nu vede mesajele firmei 1');
select tst.expect_error(format('insert into chat_messages(channel_id, body) values (%L, %L)', :'ch_gen', 'intrus'), 'row-level security');

-- adminul vede mesajul privat și are necitite
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select tst.assert((select (my_unread_counts()->>'chat')::int) = 2, 'adminul are 2 mesaje necitite');
select mark_chat_read(:'d_dm');
select tst.assert((select (my_unread_counts()->>'chat')::int) = 1, 'citirea conversației scade necititele');

-- șeful de echipă (George) nu vede conversația privată Andrei–admin
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select tst.assert((select count(*) from chat_messages where channel_id = :'d_dm') = 0, 'mesajele private nu sunt vizibile altora');
select tst.assert((select count(*) from chat_messages where channel_id = :'ch_gen') = 1, 'mesajul din „Toată firma” e vizibil tuturor');
\echo V3_TESTE_TRECUTE
