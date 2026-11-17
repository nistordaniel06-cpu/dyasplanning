-- =====================================================================
-- DYASPlanning — conturile DEMO (rulează în Supabase SQL Editor, apoi seed_demo_data.sql).
-- Parola tuturor conturilor demo: Demo2026!
-- Dacă un cont există deja, i se resetează parola.
-- =====================================================================
do $$
declare
  r record;
  uid uuid;
begin
  for r in select * from (values
    ('admin.demo@dyasplanning.ro'), ('sef.demo@dyasplanning.ro'), ('angajat.demo@dyasplanning.ro'), ('sofer.demo@dyasplanning.ro')
  ) as x(email) loop
    select id into uid from auth.users where email = r.email;
    if uid is null then
      uid := gen_random_uuid();
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, email_change, email_change_token_new, recovery_token)
      values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', r.email,
        extensions.crypt('Demo2026!', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{"demo":true}', now(), now(), '', '', '', '');
      insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (gen_random_uuid(), uid, uid::text, json_build_object('sub', uid::text, 'email', r.email, 'email_verified', true)::jsonb, 'email', now(), now(), now());
    else
      update auth.users set encrypted_password = extensions.crypt('Demo2026!', extensions.gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = uid;
    end if;
  end loop;
end $$;
