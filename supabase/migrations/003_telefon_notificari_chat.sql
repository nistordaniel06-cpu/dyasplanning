-- =====================================================================
-- DYASPlanning — 003: acces cu telefon + cod, notificări (în aplicație și push), chat.
-- Se poate rula de mai multe ori.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Acces cu numărul de telefon și cod de 6 cifre (generat de administrator)
-- ---------------------------------------------------------------------
-- Normalizare: păstrează cifrele; 00 → prefix internațional; 07xxxxxxxx (RO) → 407xxxxxxxx.
create or replace function norm_phone(p text) returns text
language sql immutable as $$
  select case
    when d like '00%' then substr(d, 3)
    when d ~ '^0[0-9]{9}$' then '4' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

create or replace function phone_login_email(p text) returns text
language sql immutable as $$ select 't' || norm_phone(p) || '@telefon.dyasplanning.app' $$;

-- Creează sau resetează accesul unui angajat: login = numărul lui de telefon, parolă = cod de 6 cifre.
create or replace function grant_phone_access(p_employee_id uuid, p_role app_role default 'angajat')
returns json language plpgsql security definer set search_path = public as $$
declare
  emp employees%rowtype;
  ph text; em text; uid uuid; code text;
begin
  if not app_is_admin() then raise exception 'Doar administratorul poate da acces.' using errcode = '42501'; end if;
  select * into emp from employees where id = p_employee_id and company_id = app_company_id();
  if not found then raise exception 'Angajat inexistent.' using errcode = '42501'; end if;
  if not emp.active then raise exception 'Angajatul este inactiv.' using errcode = '22023'; end if;
  if emp.user_id = auth.uid() then raise exception 'Acesta este contul tău de administrator.' using errcode = '22023'; end if;
  ph := norm_phone(emp.phone);
  if length(ph) < 9 then
    raise exception 'Completează numărul de telefon al angajatului (pentru numere din afara României, cu prefix: ex. +31 6 1234 5678).' using errcode = '22023';
  end if;
  em := phone_login_email(emp.phone);
  code := lpad(((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % 1000000)::text, 6, '0');

  select id into uid from auth.users where lower(email) = em;
  if emp.user_id is not null and uid is distinct from emp.user_id then
    if uid is null and (select email from auth.users where id = emp.user_id) like '%@telefon.dyasplanning.app' then
      -- i s-a schimbat numărul de telefon: contul trece pe numărul nou
      update auth.users set email = em, updated_at = now() where id = emp.user_id;
      update auth.identities set identity_data = jsonb_set(identity_data, '{email}', to_jsonb(em)) where user_id = emp.user_id and provider = 'email';
      uid := emp.user_id;
    else
      raise exception 'Angajatul are deja cont cu email. Revocă-i accesul din Setări, apoi generează codul.' using errcode = '23505';
    end if;
  end if;
  if uid is not null then
    if exists (select 1 from employees where user_id = uid and id <> emp.id) then
      raise exception 'Numărul de telefon este folosit de alt angajat.' using errcode = '23505';
    end if;
    if exists (select 1 from memberships where user_id = uid and company_id <> emp.company_id) then
      raise exception 'Numărul de telefon este folosit în altă firmă.' using errcode = '23505';
    end if;
    update auth.users set encrypted_password = extensions.crypt(code, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = uid;
  else
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', em,
      extensions.crypt(code, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', json_build_object('phone', '+' || ph)::jsonb, now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), uid, uid::text, json_build_object('sub', uid::text, 'email', em, 'email_verified', true)::jsonb, 'email', now(), now(), now());
  end if;

  update employees set user_id = uid where id = emp.id;
  insert into memberships(user_id, company_id, role, employee_id, display_name)
  values (uid, emp.company_id, p_role, emp.id, emp.full_name)
  on conflict (user_id) do update set role = excluded.role, employee_id = excluded.employee_id, display_name = excluded.display_name;
  return json_build_object('code', code, 'phone', '+' || ph);
end $$;

-- ---------------------------------------------------------------------
-- 2. Notificări
-- ---------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null,
  kind text not null default 'info',
  title text not null,
  body text,
  url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on notifications(user_id, created_at desc);

create table if not exists push_subscriptions (
  endpoint text primary key,
  user_id uuid not null,
  company_id uuid references companies(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_user on push_subscriptions(user_id);

-- configurare internă (URL-ul serviciului de push și secretul); fără acces din aplicație
create table if not exists app_config (key text primary key, value text not null);

alter table notifications enable row level security;
alter table push_subscriptions enable row level security;
alter table app_config enable row level security;
drop policy if exists notifications_own_select on notifications;
drop policy if exists notifications_own_update on notifications;
drop policy if exists notifications_own_delete on notifications;
drop policy if exists push_own on push_subscriptions;
create policy notifications_own_select on notifications for select using (user_id = auth.uid());
create policy notifications_own_update on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_own_delete on notifications for delete using (user_id = auth.uid());
create policy push_own on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Trimite notificări: le salvează în aplicație (opțional) și le trimite push către telefoanele abonate.
create or replace function notify_users(p_company uuid, p_users uuid[], p_title text, p_body text, p_url text, p_kind text, p_store boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare
  targets uuid[];
  payload jsonb;
  push_url text; push_secret text;
begin
  select coalesce(array_agg(distinct u), '{}') into targets
  from unnest(p_users) u where u is not null and u is distinct from auth.uid();
  if cardinality(targets) = 0 then return; end if;

  if p_store then
    insert into notifications(company_id, user_id, kind, title, body, url)
    select p_company, u, p_kind, p_title, p_body, p_url from unnest(targets) u;
  end if;

  select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
           'title', p_title, 'body', p_body, 'url', coalesce(p_url, '/'), 'tag', p_kind))
    into payload
  from push_subscriptions s where s.user_id = any(targets);
  if payload is null then return; end if;

  select value into push_url from app_config where key = 'push_url';
  select value into push_secret from app_config where key = 'push_secret';
  if push_url is null or push_secret is null then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using push_url, jsonb_build_object('messages', payload),
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', push_secret);
exception when others then
  -- o problemă la push nu are voie să blocheze salvarea programului
  raise warning 'notify_users: %', sqlerrm;
end $$;

-- Notificări la modificarea programului (o notificare per angajat per operație, chiar dacă se modifică mai multe alocări)
create or replace function notify_assignment_rows(p_rows jsonb, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  zile text[] := array['Lun','Mar','Mie','Joi','Vin','Sâm','Dum'];
  tz text;
  title text; body text;
begin
  for r in
    select x.company_id, x.employee_id, count(*) as n,
           min(x.starts_at) as s, max(x.ends_at) as e,
           (array_agg(x.project_id order by x.starts_at))[1] as project_id,
           (array_agg(x.task_id order by x.starts_at))[1] as task_id
    from jsonb_to_recordset(p_rows) as x(company_id uuid, employee_id uuid, project_id uuid, task_id uuid, starts_at timestamptz, ends_at timestamptz)
    where x.ends_at > now() - interval '12 hours'
    group by x.company_id, x.employee_id
  loop
    select timezone into tz from companies where id = r.company_id;
    title := case p_kind when 'nou' then 'Program nou' when 'modificat' then 'Programul tău s-a schimbat' else 'Alocare anulată' end;
    if r.n = 1 then
      body := (select name from projects where id = r.project_id)
        || coalesce(' · ' || (select name from tasks where id = r.task_id), '')
        || ' · ' || zile[extract(isodow from (r.s at time zone tz))::int] || ' ' || to_char(r.s at time zone tz, 'DD.MM HH24:MI')
        || '–' || to_char(r.e at time zone tz, 'HH24:MI');
    else
      body := r.n || ' alocări între ' || to_char(r.s at time zone tz, 'DD.MM') || ' și ' || to_char(r.e at time zone tz, 'DD.MM') || '. Deschide programul.';
    end if;
    perform notify_users(r.company_id, array(select user_id from memberships where employee_id = r.employee_id), title, body, '/program', 'program');
  end loop;
end $$;

create or replace function trg_assignments_notify_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_assignment_rows((select jsonb_agg(to_jsonb(n)) from new_rows n where n.status <> 'anulata'), 'nou');
  return null;
end $$;

create or replace function trg_assignments_notify_upd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- angajatul nou / același angajat: programul s-a schimbat
  perform notify_assignment_rows((
    select jsonb_agg(to_jsonb(n)) from new_rows n join old_rows o on o.id = n.id
    where (n.starts_at, n.ends_at, n.project_id, n.task_id, n.status, n.employee_id) is distinct from (o.starts_at, o.ends_at, o.project_id, o.task_id, o.status, o.employee_id)
      and n.status <> 'anulata'), 'modificat');
  -- anulată sau mutată la alt angajat: vechiul angajat află
  perform notify_assignment_rows((
    select jsonb_agg(to_jsonb(o)) from new_rows n join old_rows o on o.id = n.id
    where (n.status = 'anulata' and o.status <> 'anulata') or n.employee_id <> o.employee_id), 'anulat');
  return null;
end $$;

create or replace function trg_assignments_notify_del() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_assignment_rows((select jsonb_agg(to_jsonb(o)) from old_rows o where o.status <> 'anulata'), 'anulat');
  return null;
end $$;

drop trigger if exists trg_notify_ins on assignments;
create trigger trg_notify_ins after insert on assignments referencing new table as new_rows for each statement execute function trg_assignments_notify_ins();
drop trigger if exists trg_notify_upd on assignments;
create trigger trg_notify_upd after update on assignments referencing old table as old_rows new table as new_rows for each statement execute function trg_assignments_notify_upd();
drop trigger if exists trg_notify_del on assignments;
create trigger trg_notify_del after delete on assignments referencing old table as old_rows for each statement execute function trg_assignments_notify_del();

-- Notificare la respingerea pontajului
create or replace function trg_time_entry_rejected() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'respins' and old.status <> 'respins' then
    perform notify_users(new.company_id, array(select user_id from memberships where employee_id = new.employee_id),
      'Pontaj respins', coalesce(new.rejection_reason, 'Verifică și retrimite pontajul.'), '/pontaj', 'pontaj');
  end if;
  return null;
end $$;
drop trigger if exists trg_notify_rejected on time_entries;
create trigger trg_notify_rejected after update on time_entries for each row execute function trg_time_entry_rejected();

-- Abonare la push (telefonul curent)
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Trebuie să fii autentificat.' using errcode = '42501'; end if;
  insert into push_subscriptions(endpoint, user_id, company_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), app_company_id(), p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set user_id = excluded.user_id, company_id = excluded.company_id,
    p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent;
end $$;

-- Serviciul de push raportează abonamentele expirate (verificat cu secretul)
create or replace function prune_push_subscriptions(p_secret text, p_endpoints text[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_secret is null or p_secret is distinct from (select value from app_config where key = 'push_secret') then
    raise exception 'Secret invalid.' using errcode = '42501';
  end if;
  delete from push_subscriptions where endpoint = any(p_endpoints);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 3. Chat: toată firma, pe lucrare, mesaje private
-- ---------------------------------------------------------------------
create table if not exists chat_channels (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null check (kind in ('general', 'project', 'direct')),
  project_id uuid references projects(id) on delete cascade,
  direct_key text,
  name text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_chat_general on chat_channels(company_id) where kind = 'general';
create unique index if not exists uq_chat_project on chat_channels(project_id) where kind = 'project';
create unique index if not exists uq_chat_direct on chat_channels(company_id, direct_key) where kind = 'direct';

create table if not exists chat_members (
  channel_id uuid not null references chat_channels(id) on delete cascade,
  user_id uuid not null,
  primary key (channel_id, user_id)
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references chat_channels(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null,
  author_name text,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_channel on chat_messages(channel_id, created_at desc);

create table if not exists chat_reads (
  channel_id uuid not null references chat_channels(id) on delete cascade,
  user_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create or replace function app_can_access_channel(p_channel uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from chat_channels c
    where c.id = p_channel and c.company_id = app_company_id() and (
      c.kind = 'general'
      or (c.kind = 'project' and app_can_see_project(c.project_id))
      or (c.kind = 'direct' and exists (select 1 from chat_members m where m.channel_id = c.id and m.user_id = auth.uid()))
    ))
$$;

-- Destinatarii unui canal (pentru notificări)
create or replace function chat_channel_users(p_channel uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.user_id from chat_channels c join memberships m on m.company_id = c.company_id
  where c.id = p_channel and c.kind = 'general'
  union
  select m.user_id from chat_channels c join memberships m on m.company_id = c.company_id
  where c.id = p_channel and c.kind = 'project' and (
    m.role = 'admin'
    or m.employee_id in (select a.employee_id from assignments a where a.project_id = c.project_id)
    or m.employee_id = (select p.manager_employee_id from projects p where p.id = c.project_id)
    or (m.role = 'sef_echipa' and exists (
          select 1 from assignments a join employees e on e.id = a.employee_id join teams t on t.id = e.team_id
          where a.project_id = c.project_id and t.leader_employee_id = m.employee_id)))
  union
  select cm.user_id from chat_members cm where cm.channel_id = p_channel
$$;

create or replace function chat_messages_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  new.company_id := (select company_id from chat_channels where id = new.channel_id);
  new.author_name := (select coalesce(m.display_name, e.full_name, 'Utilizator') from memberships m left join employees e on e.id = m.employee_id where m.user_id = new.user_id);
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end $$;
drop trigger if exists trg_chat_before on chat_messages;
create trigger trg_chat_before before insert on chat_messages for each row execute function chat_messages_before();

create or replace function chat_messages_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare c chat_channels%rowtype; title text;
begin
  select * into c from chat_channels where id = new.channel_id;
  title := case c.kind
    when 'general' then 'Chat: Toată firma'
    when 'project' then 'Chat: ' || coalesce((select name from projects where id = c.project_id), 'Lucrare')
    else 'Mesaj de la ' || new.author_name end;
  perform notify_users(new.company_id, array(select chat_channel_users(new.channel_id)), title,
    case when c.kind = 'direct' then left(new.body, 140) else new.author_name || ': ' || left(new.body, 120) end,
    '/chat?c=' || new.channel_id, 'chat', false);
  insert into chat_reads(channel_id, user_id, last_read_at) values (new.channel_id, new.user_id, now())
  on conflict (channel_id, user_id) do update set last_read_at = now();
  return null;
end $$;
drop trigger if exists trg_chat_after on chat_messages;
create trigger trg_chat_after after insert on chat_messages for each row execute function chat_messages_after();

alter table chat_channels enable row level security;
alter table chat_members enable row level security;
alter table chat_messages enable row level security;
alter table chat_reads enable row level security;
drop policy if exists chat_channels_select on chat_channels;
drop policy if exists chat_members_select on chat_members;
drop policy if exists chat_messages_select on chat_messages;
drop policy if exists chat_messages_insert on chat_messages;
drop policy if exists chat_messages_delete on chat_messages;
drop policy if exists chat_reads_own on chat_reads;
create policy chat_channels_select on chat_channels for select using (app_can_access_channel(id));
create policy chat_members_select on chat_members for select using (app_can_access_channel(channel_id));
create policy chat_messages_select on chat_messages for select using (app_can_access_channel(channel_id));
create policy chat_messages_insert on chat_messages for insert with check (app_can_access_channel(channel_id) and user_id = auth.uid());
create policy chat_messages_delete on chat_messages for delete using (user_id = auth.uid() or (app_is_admin() and company_id = app_company_id()));
create policy chat_reads_own on chat_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Canalele mele (le creează automat pe cele lipsă: firma + lucrările active vizibile)
create or replace function my_chat_channels()
returns table(id uuid, kind text, name text, project_id uuid, color text, last_body text, last_author text, last_at timestamptz, unread bigint)
language plpgsql security definer set search_path = public as $$
declare cid uuid := app_company_id();
begin
  if cid is null then return; end if;
  insert into chat_channels(company_id, kind, name) values (cid, 'general', 'Toată firma') on conflict do nothing;
  insert into chat_channels(company_id, kind, project_id, name)
  select cid, 'project', p.id, p.name from projects p
  where p.company_id = cid and p.status in ('planificata', 'in_desfasurare', 'suspendata')
  on conflict do nothing;

  return query
  select c.id, c.kind,
    case c.kind
      when 'general' then 'Toată firma'
      when 'project' then p.name
      else (select coalesce(m.display_name, e.full_name, 'Coleg') from chat_members cm
            join memberships m on m.user_id = cm.user_id left join employees e on e.id = m.employee_id
            where cm.channel_id = c.id and cm.user_id <> auth.uid() limit 1)
    end,
    c.project_id, p.color,
    lm.body, lm.author_name, lm.created_at,
    (select count(*) from chat_messages x where x.channel_id = c.id and x.user_id <> auth.uid()
       and x.created_at > coalesce((select r.last_read_at from chat_reads r where r.channel_id = c.id and r.user_id = auth.uid()), '-infinity'))
  from chat_channels c
  left join projects p on p.id = c.project_id
  left join lateral (select body, author_name, created_at from chat_messages x where x.channel_id = c.id order by created_at desc limit 1) lm on true
  where c.company_id = cid and app_can_access_channel(c.id)
    and (c.kind <> 'project' or p.status in ('planificata', 'in_desfasurare', 'suspendata') or lm.created_at is not null)
  order by (c.kind = 'general') desc, lm.created_at desc nulls last, 3;
end $$;

-- Persoanele cu care pot începe o conversație privată
create or replace function chat_contacts()
returns table(user_id uuid, name text, role app_role, trade text)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(m.display_name, e.full_name, 'Utilizator'), m.role, e.trade
  from memberships m left join employees e on e.id = m.employee_id
  where m.company_id = app_company_id() and m.user_id <> auth.uid()
  order by (m.role = 'admin') desc, 2
$$;

create or replace function open_direct_chat(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare cid uuid := app_company_id(); k text; ch uuid;
begin
  if cid is null or p_user is null or p_user = auth.uid() then raise exception 'Conversație invalidă.' using errcode = '22023'; end if;
  if not exists (select 1 from memberships where user_id = p_user and company_id = cid) then
    raise exception 'Persoana nu face parte din firmă.' using errcode = '42501';
  end if;
  k := least(auth.uid()::text, p_user::text) || ':' || greatest(auth.uid()::text, p_user::text);
  select id into ch from chat_channels where company_id = cid and kind = 'direct' and direct_key = k;
  if ch is null then
    insert into chat_channels(company_id, kind, direct_key) values (cid, 'direct', k) returning id into ch;
    insert into chat_members(channel_id, user_id) values (ch, auth.uid()), (ch, p_user);
  end if;
  return ch;
end $$;

create or replace function mark_chat_read(p_channel uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not app_can_access_channel(p_channel) then return; end if;
  insert into chat_reads(channel_id, user_id, last_read_at) values (p_channel, auth.uid(), now())
  on conflict (channel_id, user_id) do update set last_read_at = now();
end $$;

-- Numărul de mesaje necitite (pentru bulina din meniu)
create or replace function my_unread_counts() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'notifications', (select count(*) from notifications where user_id = auth.uid() and read_at is null),
    'chat', (select count(*) from chat_messages x
             where x.company_id = app_company_id() and x.user_id <> auth.uid() and app_can_access_channel(x.channel_id)
               and x.created_at > coalesce((select r.last_read_at from chat_reads r where r.channel_id = x.channel_id and r.user_id = auth.uid()), '-infinity')))
$$;

-- Realtime pentru chat și notificări (dacă publicația Supabase există)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table chat_messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table notifications; exception when duplicate_object then null; end;
  end if;
end $$;

-- Permisiuni
grant select, insert, update, delete on notifications, push_subscriptions, chat_channels, chat_members, chat_messages, chat_reads to authenticated;
revoke all on app_config from authenticated, anon;
revoke insert, update on notifications from authenticated;
grant update (read_at) on notifications to authenticated;
revoke insert, update, delete on chat_channels, chat_members from authenticated;
revoke execute on function norm_phone(text), phone_login_email(text), grant_phone_access(uuid, app_role), notify_users(uuid, uuid[], text, text, text, text, boolean),
  notify_assignment_rows(jsonb, text), trg_assignments_notify_ins(), trg_assignments_notify_upd(), trg_assignments_notify_del(), trg_time_entry_rejected(),
  save_push_subscription(text, text, text, text), prune_push_subscriptions(text, text[]), app_can_access_channel(uuid), chat_channel_users(uuid),
  chat_messages_before(), chat_messages_after(), my_chat_channels(), chat_contacts(), open_direct_chat(uuid), mark_chat_read(uuid), my_unread_counts()
  from public, anon;
grant execute on function grant_phone_access(uuid, app_role), save_push_subscription(text, text, text, text), app_can_access_channel(uuid),
  my_chat_channels(), chat_contacts(), open_direct_chat(uuid), mark_chat_read(uuid), my_unread_counts() to authenticated;
-- prune: apelat de serviciul de push cu cheia publică + secretul
grant execute on function prune_push_subscriptions(text, text[]) to anon, authenticated;
