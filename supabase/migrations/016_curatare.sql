-- 016: curățare (funcții de test vechi pe proprietar, dacă există)
drop function if exists view_as_pre_request();
drop function if exists owner_view_as_start(uuid);
drop function if exists owner_view_as_stop();
drop function if exists view_as_whoami();
drop function if exists real_uid();
drop table if exists owner_view_as;
drop policy if exists "proprietar citire fisiere" on storage.objects;
