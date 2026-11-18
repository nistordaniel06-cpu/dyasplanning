-- 022: Asistentul AI scos complet din aplicație
drop trigger if exists trg_companies_protect_assistant on companies;
drop function if exists companies_protect_assistant();
drop function if exists owner_set_assistant(boolean, uuid);
delete from platform_settings where key = 'assistant_enabled';

create or replace function app_status() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'maintenance', coalesce((value->>'on')::boolean, false) and (value->>'until' is null or (value->>'until')::timestamptz > now()),
    'message', value->>'message', 'until', value->>'until')
  from (select coalesce((select value from platform_settings where key = 'maintenance'), '{}'::jsonb) as value) s
$$;

create or replace function owner_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform owner_guard();
  return jsonb_build_object(
    'signup_enabled', signup_enabled(),
    'activity_push', coalesce((select value = 'true'::jsonb from platform_settings where key = 'owner_activity_push'), true));
end $$;

drop function if exists owner_companies();
create function owner_companies()
returns table (id uuid, name text, created_at timestamptz, timezone text, status text, plan text, trial_until date, owner_note text,
  admin_email text, users int, employees int, projects int, assignments_7d int, time_entries_7d int,
  last_sign_in timestamptz, last_city text, last_country text,
  default_work_start time, default_work_end time, default_break_minutes int, app_name text, app_slug text, brand_color text)
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
    greatest((select max(u.last_sign_in_at) from memberships m join auth.users u on u.id = m.user_id where m.company_id = c.id),
             (select max(l.at) from login_events l where l.company_id = c.id)),
    (select l.city from login_events l where l.company_id = c.id order by l.at desc limit 1),
    (select l.country from login_events l where l.company_id = c.id order by l.at desc limit 1),
    c.default_work_start, c.default_work_end, c.default_break_minutes, c.app_name, c.app_slug, c.brand_color
  from companies c
  order by c.created_at desc;
end $$;

revoke execute on function owner_companies() from public, anon;
grant execute on function owner_companies() to authenticated;
alter table companies drop column if exists assistant_enabled;
notify pgrst, 'reload schema';
