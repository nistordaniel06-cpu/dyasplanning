-- 019: Proprietarul comunică cu firmele
--   1) mesaj direct către o firmă sau un utilizator (notificare pe telefon + opțional banner în aplicația firmei);
--   2) „Ce e nou”: noutăți afișate o singură dată fiecărui utilizator;
--   3) cereri de ajutor din aplicație, cu răspuns de la proprietar;
--   4) mod mentenanță.

-- ================= 1) Mesaje directe =================
alter table announcements add column if not exists company_id uuid references companies(id) on delete cascade;

create table if not exists owner_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  audience text not null default 'toti' check (audience in ('toti', 'admini')),
  title text not null,
  body text,
  banner boolean not null default false,
  recipients int not null default 0,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table owner_messages enable row level security;
revoke all on owner_messages from anon, authenticated;

-- bannerul curent: anunțul general sau cel trimis doar acestei firme (cel mai nou)
create or replace function current_announcement()
returns table (id uuid, title text, body text, tone text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.title, a.body, a.tone, a.created_at from announcements a
  where a.active and (a.ends_at is null or a.ends_at > now()) and auth.uid() is not null
    and (a.company_id is null or a.company_id = app_company_id())
  order by a.created_at desc limit 1
$$;

-- anunțurile generale nu mai opresc bannerele trimise unei singure firme
create or replace function owner_publish_announcement(p_title text, p_body text, p_tone text, p_days int, p_push boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid; c record;
begin
  perform owner_guard();
  if coalesce(trim(p_title), '') = '' then raise exception 'Scrie un titlu pentru anunț.' using errcode = '22023'; end if;
  update announcements set active = false where active and company_id is null;
  insert into announcements(title, body, tone, ends_at)
  values (trim(p_title), nullif(trim(p_body), ''), coalesce(p_tone, 'info'),
          case when coalesce(p_days, 0) > 0 then now() + make_interval(days => p_days) end)
  returning id into aid;
  if coalesce(p_push, false) then
    for c in select id from companies where status = 'activ' loop
      perform notify_users(c.id, array(select user_id from memberships where company_id = c.id),
        trim(p_title), coalesce(nullif(trim(p_body), ''), 'Anunț DYASPlanning'), '/notificari', 'announcement', true);
    end loop;
  end if;
  return aid;
end $$;

create or replace function owner_end_announcement() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform owner_guard();
  update announcements set active = false where active and company_id is null;
end $$;

create or replace function owner_announcements()
returns table (id uuid, title text, body text, tone text, created_at timestamptz, ends_at timestamptz, active boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform owner_guard();
  return query select a.id, a.title, a.body, a.tone, a.created_at, a.ends_at, a.active from announcements a
    where a.company_id is null order by a.created_at desc limit 50;
end $$;

create or replace function owner_send_message(p_company uuid, p_user uuid, p_title text, p_body text,
  p_audience text default 'toti', p_banner boolean default false, p_days int default 7)
returns int language plpgsql security definer set search_path = public as $$
declare cid uuid := p_company; targets uuid[]; aud text := case when p_audience = 'admini' then 'admini' else 'toti' end;
begin
  perform owner_guard();
  if coalesce(trim(p_title), '') = '' then raise exception 'Scrie un titlu pentru mesaj.' using errcode = '22023'; end if;
  if p_user is not null then
    select company_id into cid from memberships where user_id = p_user;
    if cid is null then raise exception 'Utilizatorul nu aparține niciunei firme.' using errcode = 'P0002'; end if;
    targets := array[p_user];
  else
    if cid is null or not exists (select 1 from companies where id = cid) then raise exception 'Alege firma.' using errcode = '22023'; end if;
    targets := array(select user_id from memberships where company_id = cid and (aud = 'toti' or role = 'admin'));
  end if;
  perform notify_users(cid, targets, trim(p_title), coalesce(nullif(trim(p_body), ''), 'Mesaj de la DYASPlanning'), '/notificari', 'owner_message', true);
  if coalesce(p_banner, false) and p_user is null then
    update announcements set active = false where active and company_id = cid;
    insert into announcements(title, body, tone, ends_at, company_id)
    values (trim(p_title), nullif(trim(p_body), ''), 'info', now() + make_interval(days => greatest(coalesce(p_days, 7), 1)), cid);
  end if;
  insert into owner_messages(company_id, user_id, audience, title, body, banner, recipients, sent_by)
  values (cid, p_user, aud, trim(p_title), nullif(trim(p_body), ''), coalesce(p_banner, false) and p_user is null, coalesce(cardinality(targets), 0), auth.uid());
  return coalesce(cardinality(targets), 0);
end $$;

create or replace function owner_messages_list()
returns table (id uuid, company_name text, user_name text, audience text, title text, body text, banner boolean, recipients int, created_at timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform owner_guard();
  return query select m.id, c.name, coalesce(mm.display_name, e.full_name, u.email::text), m.audience, m.title, m.body, m.banner, m.recipients, m.created_at
    from owner_messages m left join companies c on c.id = m.company_id
    left join auth.users u on u.id = m.user_id left join memberships mm on mm.user_id = m.user_id left join employees e on e.id = mm.employee_id
    order by m.created_at desc limit 100;
end $$;

-- ================= 2) Ce e nou =================
create table if not exists app_news (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 2 and 120),
  body text not null check (length(trim(body)) between 2 and 4000),
  audience text not null default 'toti' check (audience in ('toti', 'admini')),
  published boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table app_news enable row level security;
revoke all on app_news from anon, authenticated;

create table if not exists app_news_seen (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table app_news_seen enable row level security;
revoke all on app_news_seen from anon, authenticated;

-- noutățile pe care utilizatorul nu le-a văzut încă (doar cele apărute după ce și-a făcut contul)
create or replace function my_news()
returns table (id uuid, title text, body text, created_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select n.id, n.title, n.body, n.created_at from app_news n
  where n.published and auth.uid() is not null
    and n.created_at > coalesce((select seen_at from app_news_seen where user_id = auth.uid()), (select created_at from auth.users where id = auth.uid()))
    and (n.audience = 'toti' or exists (select 1 from memberships where user_id = auth.uid() and role = 'admin'))
    and exists (select 1 from memberships where user_id = auth.uid())
  order by n.created_at desc limit 5
$$;

create or replace function mark_news_seen() returns void
language sql security definer set search_path = public as $$
  insert into app_news_seen(user_id, seen_at) select auth.uid(), now() where auth.uid() is not null
  on conflict (user_id) do update set seen_at = now()
$$;

create or replace function owner_news_list()
returns table (id uuid, title text, body text, audience text, published boolean, created_at timestamptz, seen int)
language plpgsql stable security definer set search_path = public as $$
begin
  perform owner_guard();
  return query select n.id, n.title, n.body, n.audience, n.published, n.created_at,
    (select count(*)::int from app_news_seen s where s.seen_at >= n.created_at)
  from app_news n order by n.created_at desc limit 100;
end $$;

create or replace function owner_news_save(p_id uuid, p_title text, p_body text, p_audience text, p_published boolean, p_push boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid := p_id; aud text := case when p_audience = 'admini' then 'admini' else 'toti' end; c record;
begin
  perform owner_guard();
  if coalesce(length(trim(p_title)), 0) < 2 then raise exception 'Scrie un titlu.' using errcode = '22023'; end if;
  if coalesce(length(trim(p_body)), 0) < 2 then raise exception 'Scrie ce e nou.' using errcode = '22023'; end if;
  if nid is null then
    insert into app_news(title, body, audience, published, created_by) values (trim(p_title), trim(p_body), aud, coalesce(p_published, true), auth.uid())
    returning id into nid;
  else
    update app_news set title = trim(p_title), body = trim(p_body), audience = aud, published = coalesce(p_published, true) where id = nid;
    if not found then raise exception 'Noutatea nu există.' using errcode = 'P0002'; end if;
  end if;
  if coalesce(p_push, false) and coalesce(p_published, true) then
    for c in select id from companies where status = 'activ' loop
      perform notify_users(c.id, array(select user_id from memberships where company_id = c.id and (aud = 'toti' or role = 'admin')),
        'Ce e nou: ' || trim(p_title), left(trim(p_body), 180), '/', 'news', false);
    end loop;
  end if;
  return nid;
end $$;

create or replace function owner_news_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform owner_guard();
  delete from app_news where id = p_id;
end $$;

-- ================= 3) Cereri de ajutor =================
create table if not exists support_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  name text,
  role text,
  page text,
  message text not null check (length(trim(message)) between 3 and 4000),
  status text not null default 'nou' check (status in ('nou', 'raspuns', 'rezolvat')),
  reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
alter table support_requests enable row level security;
revoke all on support_requests from anon, authenticated;
grant select on support_requests to authenticated;
drop policy if exists support_requests_own on support_requests;
create policy support_requests_own on support_requests for select using (user_id = auth.uid());

create or replace function send_support_request(p_message text, p_page text default null)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare rid uuid; m memberships%rowtype; who text; cname text;
begin
  if auth.uid() is null then raise exception 'Trebuie să fii autentificat.' using errcode = '42501'; end if;
  if coalesce(length(trim(p_message)), 0) < 3 then raise exception 'Scrie cu ce te putem ajuta.' using errcode = '22023'; end if;
  if (select count(*) from support_requests where user_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Ai trimis multe cereri în ultima oră. Încearcă puțin mai târziu.' using errcode = '54000';
  end if;
  select * into m from memberships where user_id = auth.uid();
  select coalesce(e.full_name, m.display_name, u.email) into who from auth.users u left join employees e on e.id = m.employee_id where u.id = auth.uid();
  select name into cname from companies where id = m.company_id;
  insert into support_requests(company_id, user_id, name, role, page, message)
  values (m.company_id, auth.uid(), who, m.role::text, left(p_page, 200), left(trim(p_message), 4000)) returning id into rid;
  if m.company_id is not null then
    perform notify_users(m.company_id, array(select user_id from platform_owners), 'Cerere de ajutor: ' || coalesce(cname, 'fără firmă'),
      coalesce(who, '') || ': ' || left(trim(p_message), 160), '/proprietar?tab=ajutor', 'support', true);
  end if;
  return rid;
end $$;

create or replace function owner_support_list(p_status text default null)
returns table (id uuid, company_name text, name text, role text, page text, message text, status text, reply text, replied_at timestamptz, created_at timestamptz, user_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  perform owner_guard();
  return query select r.id, c.name, r.name, r.role, r.page, r.message, r.status, r.reply, r.replied_at, r.created_at, r.user_id
    from support_requests r left join companies c on c.id = r.company_id
    where p_status is null or r.status = p_status
    order by (r.status = 'nou') desc, r.created_at desc limit 200;
end $$;

create or replace function owner_support_reply(p_id uuid, p_reply text, p_resolve boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r support_requests%rowtype;
begin
  perform owner_guard();
  select * into r from support_requests where id = p_id;
  if not found then raise exception 'Cererea nu există.' using errcode = 'P0002'; end if;
  if coalesce(trim(p_reply), '') <> '' then
    update support_requests set reply = trim(p_reply), replied_at = now(), status = case when p_resolve then 'rezolvat' else 'raspuns' end where id = p_id;
    if r.company_id is not null and r.user_id is not null then
      perform notify_users(r.company_id, array[r.user_id], 'Răspuns la cererea de ajutor', left(trim(p_reply), 180), '/ajutor', 'support', true);
    end if;
  else
    update support_requests set status = case when p_resolve then 'rezolvat' else status end where id = p_id;
  end if;
end $$;

-- ================= 4) Mod mentenanță =================
create or replace function app_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'maintenance', coalesce((value->>'on')::boolean, false) and (value->>'until' is null or (value->>'until')::timestamptz > now()),
    'message', value->>'message', 'until', value->>'until')
  from (select coalesce((select value from platform_settings where key = 'maintenance'), '{}'::jsonb) as value) s
$$;

create or replace function owner_set_maintenance(p_on boolean, p_message text default null, p_minutes int default null)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform owner_guard();
  insert into platform_settings(key, value, updated_at)
  values ('maintenance', jsonb_build_object('on', coalesce(p_on, false), 'message', nullif(trim(p_message), ''),
          'until', case when coalesce(p_on, false) and coalesce(p_minutes, 0) > 0 then now() + make_interval(mins => p_minutes) end), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return app_status();
end $$;

-- ================= Drepturi =================
revoke execute on function owner_send_message(uuid, uuid, text, text, text, boolean, int), owner_messages_list(), my_news(), mark_news_seen(),
  owner_news_list(), owner_news_save(uuid, text, text, text, boolean, boolean), owner_news_delete(uuid),
  send_support_request(text, text), owner_support_list(text), owner_support_reply(uuid, text, boolean), owner_set_maintenance(boolean, text, int)
  from public, anon;
grant execute on function owner_send_message(uuid, uuid, text, text, text, boolean, int), owner_messages_list(), my_news(), mark_news_seen(),
  owner_news_list(), owner_news_save(uuid, text, text, text, boolean, boolean), owner_news_delete(uuid),
  send_support_request(text, text), owner_support_list(text), owner_support_reply(uuid, text, boolean), owner_set_maintenance(boolean, text, int)
  to authenticated;
revoke execute on function app_status() from public;
grant execute on function app_status() to anon, authenticated;
