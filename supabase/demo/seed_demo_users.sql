-- =====================================================================
-- DYASPlanning — conturile DEMO (rulează în Supabase SQL Editor, apoi seed_demo_data.sql).
-- Administrator: admin.demo@dyasplanning.ro / Demo2026!
-- Angajat (Ion Stan): telefon 0722 100 003 / cod 111111 · Șef de echipă (Marian Popa): telefon 0722 100 002 / cod 222222
-- Dacă un cont există deja, i se resetează parola.
-- =====================================================================
do $$
declare
  r record;
  uid uuid;
begin
  for r in select * from (values
    ('admin.demo@dyasplanning.ro', 'Demo2026!'), ('t40722100002@telefon.dyasplanning.app', '222222'), ('t40722100003@telefon.dyasplanning.app', '111111')
  ) as x(email, pw) loop
    select id into uid from auth.users where email = r.email;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', r.email,
        extensions.crypt(r.pw, extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{"demo":true}', now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, json_build_object('sub', uid::text, 'email', r.email, 'email_verified', true)::jsonb, 'email', now(), now(), now());
    else
      update auth.users set encrypted_password = extensions.crypt(r.pw, extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = uid;
    end if;
  end loop;
end $$;
