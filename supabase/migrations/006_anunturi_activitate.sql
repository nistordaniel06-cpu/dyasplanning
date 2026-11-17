-- 006: Anunțuri globale, notificări pentru pontaje și km, activitatea adminilor (pentru proprietar)

-- ================= Anunțuri pentru toate firmele =================
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text,
  tone text not null default 'info' check (tone in ('info', 'warning')),
  created_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true
);
alter table announcements enable row level security;

create or replace function current_announcement()
returns table (id uuid, title text, body text, tone text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select a.id, a.title, a.body, a.tone, a.created_at from announcements a
  where a.active and (a.ends_at is null or a.ends_at > now()) and auth.uid() is not null
  order by a.created_at desc limit 1
$$;

create or replace function owner_publish_announcement(p_title text, p_body text, p_tone text, p_days int, p_push boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid; c record;
begin
  perform owner_guard();
  if coalesce(trim(p_title), '') = '' then raise exception 'Scrie un titlu pentru anunț.' using errcode = '22023'; end if;
  update announcements set active = false where active;
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
  update announcements set active = false where active;
end $$;

create or replace function owner_announcements()
returns table (id uuid, title text, body text, tone text, created_at timestamptz, ends_at timestamptz, active boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  perform owner_guard();
  return query select a.id, a.title, a.body, a.tone, a.created_at, a.ends_at, a.active from announcements a order by a.created_at desc limit 50;
end $$;

-- ================= Pontaj trimis → adminii firmei =================
create or replace function fmt_minutes(m int) returns text language sql immutable as $$
  select (coalesce(m, 0) / 60)::text || 'h' || case when coalesce(m, 0) % 60 > 0 then ' ' || (m % 60)::text || 'm' else '' end
$$;

create or replace function trg_notify_time_entry_submitted() returns trigger
language plpgsql security definer set search_path = public as $$
declare emp text; proj text; tz text;
begin
  if new.status <> 'trimis' or (tg_op = 'UPDATE' and old.status = 'trimis') then return null; end if;
  select full_name into emp from employees where id = new.employee_id;
  select name into proj from projects where id = new.project_id;
  select timezone into tz from companies where id = new.company_id;
  perform notify_users(new.company_id,
    array(select user_id from memberships where company_id = new.company_id and role = 'admin'),
    'Pontaj nou: ' || coalesce(emp, 'Angajat'),
    fmt_minutes(new.worked_minutes) || ' · ' || coalesce(proj, 'Lucrare') || ' · ' ||
      to_char(new.started_at at time zone coalesce(tz, 'Europe/Bucharest'), 'DD.MM HH24:MI') || '–' ||
      to_char(new.ended_at at time zone coalesce(tz, 'Europe/Bucharest'), 'HH24:MI'),
    '/pontaje', 'pontaj_trimis', true);
  return null;
end $$;
drop trigger if exists trg_notify_time_entry_submitted on time_entries;
create trigger trg_notify_time_entry_submitted after insert or update of status on time_entries
  for each row execute function trg_notify_time_entry_submitted();

-- ================= Km mașină introduși → adminii firmei =================
create or replace function trg_notify_odometer() returns trigger
language plpgsql security definer set search_path = public as $$
declare veh text; emp text; prev int;
begin
  if tg_op = 'UPDATE' and new.km = old.km then return null; end if;
  select name || coalesce(' (' || plate || ')', '') into veh from vehicles where id = new.vehicle_id;
  select full_name into emp from employees where id = new.employee_id;
  select km into prev from odometer_readings where vehicle_id = new.vehicle_id and reading_date < new.reading_date order by reading_date desc limit 1;
  perform notify_users(new.company_id,
    array(select user_id from memberships where company_id = new.company_id and role = 'admin'),
    'Km: ' || coalesce(veh, 'Mașină'),
    replace(to_char(new.km, 'FM9,999,999'), ',', '.') || ' km' ||
      case when prev is not null then ' (+' || replace(to_char(new.km - prev, 'FM9,999,999'), ',', '.') || ' km de la ultima citire)' else '' end ||
      ' · ' || coalesce(emp, 'necunoscut'),
    '/masini', 'km', true);
  return null;
end $$;
drop trigger if exists trg_notify_odometer on odometer_readings;
create trigger trg_notify_odometer after insert or update of km on odometer_readings
  for each row execute function trg_notify_odometer();

-- ================= Activitatea adminilor (pentru proprietar) =================
create table if not exists owner_activity (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  company_id uuid references companies(id) on delete cascade,
  user_id uuid,
  actor text,
  entity text not null,
  op text not null,
  n int not null default 1,
  summary text not null,
  pushed boolean not null default false
);
create index if not exists idx_owner_activity_at on owner_activity(at desc);
alter table owner_activity enable row level security; -- fără politici: doar proprietarul, prin funcții

insert into platform_settings(key, value) values ('owner_activity_push', 'true'::jsonb) on conflict do nothing;

create or replace function trg_owner_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int; cid uuid; actor text; what text; verb text; summary text; do_push boolean;
begin
  if auth.uid() is null or app_role() is distinct from 'admin' or is_platform_owner() then return null; end if;
  cid := app_company_id();
  if cid is null then return null; end if;
  execute format('select count(*) from %I', case when tg_op = 'DELETE' then 'old_rows' else 'new_rows' end) into n;
  if n = 0 then return null; end if;

  what := case tg_table_name
    when 'projects' then 'lucrări' when 'tasks' then 'misiuni' when 'assignments' then 'alocări'
    when 'employees' then 'angajați' when 'teams' then 'echipe' when 'absences' then 'absențe'
    when 'vehicles' then 'mașini' when 'time_entries' then 'pontaje' when 'invites' then 'invitații'
    when 'companies' then 'setările firmei' else tg_table_name end;
  verb := case tg_op when 'INSERT' then 'a adăugat' when 'UPDATE' then 'a modificat' else 'a șters' end;
  select coalesce(m.display_name, e.full_name, 'Admin') into actor
    from memberships m left join employees e on e.id = m.employee_id where m.user_id = auth.uid();
  summary := actor || ' ' || verb || ' ' || case when tg_table_name = 'companies' then what else n || ' ' || what end;

  -- push: cel mult unul la 2 minute pentru aceeași firmă + tabel + operație
  do_push := coalesce((select value = 'true'::jsonb from platform_settings where key = 'owner_activity_push'), true)
    and not exists (select 1 from owner_activity where company_id = cid and entity = tg_table_name and op = tg_op
                    and pushed and at > now() - interval '2 minutes');

  insert into owner_activity(company_id, user_id, actor, entity, op, n, summary, pushed)
  values (cid, auth.uid(), actor, tg_table_name, tg_op, n, summary, do_push);
  delete from owner_activity where at < now() - interval '90 days';

  if do_push then
    perform notify_users(cid, array(select user_id from platform_owners), (select name from companies where id = cid),
      summary, '/proprietar?tab=activitate', 'owner_activity', false);
  end if;
  return null;
exception when others then
  raise warning 'trg_owner_activity: %', sqlerrm; -- jurnalul nu are voie să blocheze lucrul firmei
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['projects', 'tasks', 'assignments', 'employees', 'teams', 'absences', 'vehicles', 'time_entries', 'invites', 'companies'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists trg_owner_activity_ins on %I', t);
    execute format('drop trigger if exists trg_owner_activity_upd on %I', t);
    execute format('drop trigger if exists trg_owner_activity_del on %I', t);
    execute format('create trigger trg_owner_activity_ins after insert on %I referencing new table as new_rows for each statement execute function trg_owner_activity()', t);
    execute format('create trigger trg_owner_activity_upd after update on %I referencing new table as new_rows for each statement execute function trg_owner_activity()', t);
    execute format('create trigger trg_owner_activity_del after delete on %I referencing old table as old_rows for each statement execute function trg_owner_activity()', t);
  end loop;
end $$;

create or replace function owner_activity_feed(p_company uuid default null, p_limit int default 200)
returns table (at timestamptz, company_id uuid, company_name text, actor text, entity text, op text, n int, summary text)
language plpgsql stable security definer set search_path = public as $$
begin
  perform owner_guard();
  return query
  select a.at, a.company_id, c.name, a.actor, a.entity, a.op, a.n, a.summary
  from owner_activity a left join companies c on c.id = a.company_id
  where p_company is null or a.company_id = p_company
  order by a.at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;

create or replace function owner_set_activity_push(p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform owner_guard();
  insert into platform_settings(key, value, updated_at) values ('owner_activity_push', to_jsonb(coalesce(p_enabled, true)), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

create or replace function owner_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform owner_guard();
  return jsonb_build_object(
    'signup_enabled', signup_enabled(),
    'activity_push', coalesce((select value = 'true'::jsonb from platform_settings where key = 'owner_activity_push'), true));
end $$;

-- ================= Drepturi =================
revoke execute on function current_announcement(), owner_publish_announcement(text, text, text, int, boolean), owner_end_announcement(),
  owner_announcements(), fmt_minutes(int), trg_notify_time_entry_submitted(), trg_notify_odometer(), trg_owner_activity(),
  owner_activity_feed(uuid, int), owner_set_activity_push(boolean), owner_settings() from public, anon;
revoke execute on function trg_notify_time_entry_submitted(), trg_notify_odometer(), trg_owner_activity() from authenticated;
grant execute on function current_announcement(), owner_publish_announcement(text, text, text, int, boolean), owner_end_announcement(),
  owner_announcements(), owner_activity_feed(uuid, int), owner_set_activity_push(boolean), owner_settings() to authenticated;
revoke all on announcements, owner_activity from anon, authenticated;
