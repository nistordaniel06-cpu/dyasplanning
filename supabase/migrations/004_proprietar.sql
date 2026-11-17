-- 004: Panoul proprietarului platformei (cel care a făcut aplicația)
-- Proprietarii se adaugă manual, din SQL:  insert into platform_owners(user_id) select id from auth.users where email = '...';

create table if not exists platform_owners (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);
alter table platform_owners enable row level security; -- fără politici: doar funcțiile de mai jos

create or replace function is_platform_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (select 1 from platform_owners where user_id = auth.uid())
$$;

create or replace function owner_guard() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_owner() then raise exception 'Acces permis doar proprietarului aplicației.' using errcode = '42501'; end if;
end $$;

-- ---------- Stare firmă: activă / suspendată, plan, perioadă de probă, notă internă ----------
alter table companies add column if not exists status text not null default 'activ';
alter table companies add column if not exists plan text not null default 'gratuit';
alter table companies add column if not exists trial_until date;
alter table companies add column if not exists owner_note text;
do $$ begin
  alter table companies add constraint companies_status_chk check (status in ('activ', 'suspendat'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table companies add constraint companies_plan_chk check (plan in ('gratuit', 'proba', 'standard', 'premium'));
exception when duplicate_object then null; end $$;

-- Firma suspendată: utilizatorii ei nu mai văd și nu mai pot modifica nimic (toate politicile folosesc app_company_id()).
create or replace function app_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select m.company_id from memberships m join companies c on c.id = m.company_id
  where m.user_id = auth.uid() and c.status = 'activ'
$$;

-- Ce vede utilizatorul când firma e suspendată
create or replace function my_company_status() returns text
language sql stable security definer set search_path = public as $$
  select c.status from memberships m join companies c on c.id = m.company_id where m.user_id = auth.uid()
$$;

-- Admin-ul firmei nu își poate schimba singur statusul / planul (doar proprietarul)
create or replace function companies_owner_fields_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_platform_owner() or auth.uid() is null then return new; end if;
  if new.status is distinct from old.status or new.plan is distinct from old.plan
     or new.trial_until is distinct from old.trial_until or new.owner_note is distinct from old.owner_note then
    raise exception 'Doar proprietarul aplicației poate schimba planul sau statusul firmei.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_companies_owner_fields on companies;
create trigger trg_companies_owner_fields before update on companies for each row execute function companies_owner_fields_guard();

-- ---------- Setări platformă ----------
create table if not exists platform_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table platform_settings enable row level security;
insert into platform_settings(key, value) values ('signup_enabled', 'true'::jsonb) on conflict do nothing;

create or replace function signup_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from platform_settings where key = 'signup_enabled'), true)
$$;

-- create_company: respectă oprirea înscrierilor (proprietarul poate oricând)
create or replace function create_company(p_name text, p_timezone text default 'Europe/Bucharest', p_admin_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; eid uuid;
begin
  if auth.uid() is null then raise exception 'Trebuie să fii autentificat.' using errcode = '42501'; end if;
  if not signup_enabled() and not is_platform_owner() then
    raise exception 'Înscrierea firmelor noi este închisă momentan.' using errcode = '42501';
  end if;
  if exists (select 1 from memberships where user_id = auth.uid()) then
    raise exception 'Contul tău aparține deja unei firme.' using errcode = '23505';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Fus orar invalid: %', p_timezone using errcode = '22023';
  end if;
  insert into companies(name, timezone) values (trim(p_name), p_timezone) returning id into cid;
  if coalesce(trim(p_admin_name), '') <> '' then
    insert into employees(company_id, full_name, user_id, trade) values (cid, trim(p_admin_name), auth.uid(), 'Administrator')
    returning id into eid;
  end if;
  insert into memberships(user_id, company_id, role, employee_id, display_name)
  values (auth.uid(), cid, 'admin', eid, nullif(trim(p_admin_name), ''));
  return cid;
end $$;

-- ---------- Conectări (oraș / țară / dispozitiv), păstrate 90 de zile ----------
create table if not exists login_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  company_id uuid references companies(id) on delete cascade,
  at timestamptz not null default now(),
  ip text,
  city text, region text, country text,
  lat double precision, lon double precision,
  device text,
  installed boolean not null default false
);
create index if not exists idx_login_events_at on login_events(at desc);
create index if not exists idx_login_events_user on login_events(user_id, at desc);
alter table login_events enable row level security; -- fără politici: scris doar de server, citit doar de proprietar

-- Apelat de server (/api/presence) după ce a verificat utilizatorul; o înregistrare la 30 min sau la schimbarea IP-ului
create or replace function record_presence(p_secret text, p_user uuid, p_ip text, p_city text, p_region text, p_country text,
  p_lat double precision, p_lon double precision, p_device text, p_installed boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare last record;
begin
  if p_secret is null or p_secret is distinct from (select value from app_config where key = 'push_secret') then
    raise exception 'Secret invalid.' using errcode = '42501';
  end if;
  select ip, at into last from login_events where user_id = p_user order by at desc limit 1;
  if found and last.ip is not distinct from p_ip and last.at > now() - interval '30 minutes' then return false; end if;
  insert into login_events(user_id, company_id, ip, city, region, country, lat, lon, device, installed)
  values (p_user, (select company_id from memberships where user_id = p_user), left(p_ip, 64), left(p_city, 100), left(p_region, 100),
          left(p_country, 8), p_lat, p_lon, left(p_device, 100), coalesce(p_installed, false));
  delete from login_events where at < now() - interval '90 days';
  return true;
end $$;

-- ---------- Rapoarte pentru proprietar ----------
create or replace function owner_overview() returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb;
begin
  perform owner_guard();
  select jsonb_build_object(
    'companies', (select count(*) from companies),
    'companies_active', (select count(*) from companies where status = 'activ'),
    'companies_suspended', (select count(*) from companies where status = 'suspendat'),
    'users', (select count(*) from memberships),
    'employees', (select count(*) from employees where coalesce(active, true)),
    'active_7d', (select count(*) from auth.users u join memberships m on m.user_id = u.id where u.last_sign_in_at > now() - interval '7 days'),
    'online_now', (select count(distinct user_id) from login_events where at > now() - interval '30 minutes'),
    'projects', (select count(*) from projects),
    'assignments_7d', (select count(*) from assignments where created_at > now() - interval '7 days'),
    'time_entries_7d', (select count(*) from time_entries where created_at > now() - interval '7 days'),
    'messages_7d', (select count(*) from chat_messages where created_at > now() - interval '7 days'),
    'push_devices', (select count(*) from push_subscriptions),
    'signup_enabled', signup_enabled(),
    'signups_by_week', coalesce((
      select jsonb_agg(jsonb_build_object('week', w, 'count', n) order by w)
      from (select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') w, count(*) n from companies
            where created_at > now() - interval '12 weeks' group by 1) s), '[]'::jsonb),
    'countries', coalesce((
      select jsonb_agg(jsonb_build_object('country', country, 'users', n) order by n desc)
      from (select coalesce(country, '?') country, count(distinct user_id) n from login_events
            where at > now() - interval '30 days' group by 1) s), '[]'::jsonb)
  ) into r;
  return r;
end $$;

create or replace function owner_companies()
returns table (id uuid, name text, created_at timestamptz, timezone text, status text, plan text, trial_until date, owner_note text,
  admin_email text, users int, employees int, projects int, assignments_7d int, time_entries_7d int,
  last_sign_in timestamptz, last_city text, last_country text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform owner_guard();
  return query
  select c.id, c.name, c.created_at, c.timezone, c.status, c.plan, c.trial_until, c.owner_note,
    (select u.email::text from memberships m join auth.users u on u.id = m.user_id
      where m.company_id = c.id and m.role = 'admin' order by u.created_at limit 1),
    (select count(*)::int from memberships m where m.company_id = c.id),
    (select count(*)::int from employees e where e.company_id = c.id and coalesce(e.active, true)),
    (select count(*)::int from projects p where p.company_id = c.id),
    (select count(*)::int from assignments a where a.company_id = c.id and a.created_at > now() - interval '7 days'),
    (select count(*)::int from time_entries t where t.company_id = c.id and t.created_at > now() - interval '7 days'),
    (select max(u.last_sign_in_at) from memberships m join auth.users u on u.id = m.user_id where m.company_id = c.id),
    (select l.city from login_events l where l.company_id = c.id order by l.at desc limit 1),
    (select l.country from login_events l where l.company_id = c.id order by l.at desc limit 1)
  from companies c
  order by c.created_at desc;
end $$;

create or replace function owner_company_users(p_company uuid)
returns table (user_id uuid, login text, name text, role app_role, created_at timestamptz, last_sign_in timestamptz,
  last_city text, last_country text, last_device text, installed boolean, logins_30d int)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform owner_guard();
  return query
  select m.user_id, u.email::text, coalesce(e.full_name, m.display_name), m.role, u.created_at, u.last_sign_in_at,
    l.city, l.country, l.device, coalesce(l.installed, false),
    (select count(*)::int from login_events x where x.user_id = m.user_id and x.at > now() - interval '30 days')
  from memberships m
  join auth.users u on u.id = m.user_id
  left join employees e on e.id = m.employee_id
  left join lateral (select x.city, x.country, x.device, x.installed from login_events x where x.user_id = m.user_id order by x.at desc limit 1) l on true
  where m.company_id = p_company
  order by m.role, u.last_sign_in_at desc nulls last;
end $$;

create or replace function owner_login_events(p_company uuid default null, p_limit int default 200)
returns table (at timestamptz, user_login text, user_name text, company_name text, ip text, city text, region text, country text,
  lat double precision, lon double precision, device text, installed boolean)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform owner_guard();
  return query
  select l.at, u.email::text, coalesce(e.full_name, m.display_name), c.name, l.ip, l.city, l.region, l.country, l.lat, l.lon, l.device, l.installed
  from login_events l
  left join auth.users u on u.id = l.user_id
  left join memberships m on m.user_id = l.user_id
  left join employees e on e.id = m.employee_id
  left join companies c on c.id = l.company_id
  where p_company is null or l.company_id = p_company
  order by l.at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;

create or replace function owner_update_company(p_company uuid, p_status text, p_plan text, p_trial_until date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform owner_guard();
  update companies set status = p_status, plan = p_plan, trial_until = p_trial_until, owner_note = nullif(trim(p_note), '')
  where id = p_company;
  if not found then raise exception 'Firma nu există.' using errcode = 'P0002'; end if;
end $$;

create or replace function owner_set_signup(p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform owner_guard();
  insert into platform_settings(key, value, updated_at) values ('signup_enabled', to_jsonb(coalesce(p_enabled, true)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

-- ---------- Drepturi ----------
revoke execute on function is_platform_owner(), owner_guard(), my_company_status(), signup_enabled(),
  record_presence(text, uuid, text, text, text, text, double precision, double precision, text, boolean),
  owner_overview(), owner_companies(), owner_company_users(uuid), owner_login_events(uuid, int),
  owner_update_company(uuid, text, text, date, text), owner_set_signup(boolean) from public, anon;
grant execute on function is_platform_owner(), my_company_status(), signup_enabled(),
  owner_overview(), owner_companies(), owner_company_users(uuid), owner_login_events(uuid, int),
  owner_update_company(uuid, text, text, date, text), owner_set_signup(boolean) to authenticated;
grant execute on function signup_enabled() to anon;
grant execute on function record_presence(text, uuid, text, text, text, text, double precision, double precision, text, boolean) to anon, authenticated;
revoke all on platform_owners, platform_settings, login_events from anon, authenticated;
