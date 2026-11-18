-- 015: Proprietarul aplicației creează o firmă nouă direct, cu emailul și parola administratorului.
create or replace function owner_create_company(p_company_name text, p_admin_name text, p_email text, p_password text,
  p_timezone text default 'Europe/Bucharest')
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare em text := lower(trim(p_email)); uid uuid := gen_random_uuid(); cid uuid; eid uuid;
begin
  perform owner_guard();
  if coalesce(length(trim(p_company_name)), 0) < 2 then raise exception 'Scrie numele firmei.' using errcode = '22023'; end if;
  if coalesce(length(trim(p_admin_name)), 0) < 2 then raise exception 'Scrie numele administratorului.' using errcode = '22023'; end if;
  if em is null or em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Adresa de email nu e validă.' using errcode = '22023'; end if;
  if em like '%@telefon.dyasplanning.app' then raise exception 'Adresa de email nu e validă.' using errcode = '22023'; end if;
  if coalesce(length(p_password), 0) < 8 then raise exception 'Parola trebuie să aibă cel puțin 8 caractere.' using errcode = '22023'; end if;
  if exists (select 1 from auth.users where lower(email) = em) then
    raise exception 'Există deja un cont cu emailul %.', em using errcode = '23505';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Fus orar necunoscut.' using errcode = '22023';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}'::jsonb, now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text, json_build_object('sub', uid::text, 'email', em, 'email_verified', true)::jsonb, 'email', now(), now(), now());

  insert into companies(name, timezone) values (trim(p_company_name), p_timezone) returning id into cid;
  insert into employees(company_id, full_name, user_id, trade) values (cid, trim(p_admin_name), uid, 'Administrator') returning id into eid;
  insert into memberships(user_id, company_id, role, employee_id, display_name) values (uid, cid, 'admin', eid, trim(p_admin_name));
  insert into owner_activity(company_id, user_id, actor, entity, op, summary, pushed)
  values (cid, auth.uid(), 'Proprietarul aplicației', 'proprietar', 'firma_noua',
          format('Proprietarul aplicației a creat firma „%s” (administrator %s)', trim(p_company_name), em), true);
  return cid;
end $$;
revoke execute on function owner_create_company(text, text, text, text, text) from public, anon;
grant execute on function owner_create_company(text, text, text, text, text) to authenticated;
