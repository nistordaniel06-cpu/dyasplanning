-- 009: Utilizarea aplicației — pentru adminul firmei (angajații lui) și pentru proprietar (orice firmă)
-- Fără locații: doar zile active, ultima deschidere, aplicație instalată, notificări, pontaje, km.

create or replace function usage_report(p_company uuid, p_days int)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  days int := least(greatest(coalesce(p_days, 30), 1), 90);
  tz text;
  since timestamptz;
  r jsonb;
begin
  select coalesce(timezone, 'Europe/Bucharest') into tz from companies where id = p_company;
  if tz is null then raise exception 'Firma nu există.' using errcode = 'P0002'; end if;
  since := ((now() at time zone tz)::date - (days - 1))::timestamp at time zone tz;

  select jsonb_build_object(
    'days', days,
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'users', coalesce(x.n, 0)) order by d)
      from generate_series((now() at time zone tz)::date - (days - 1), (now() at time zone tz)::date, interval '1 day') d
      left join (
        select (l.at at time zone tz)::date as day, count(distinct l.user_id) n
        from login_events l where l.company_id = p_company and l.at >= since group by 1
      ) x on x.day = d::date), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(p order by (p->>'last_seen') desc nulls last, p->>'name')
      from (
        select jsonb_build_object(
          'employee_id', e.id,
          'name', e.full_name,
          'trade', e.trade,
          'has_account', e.user_id is not null,
          'role', m.role,
          'last_seen', greatest(u.last_sign_in_at, (select max(l.at) from login_events l where l.user_id = e.user_id)),
          'active_days', (select count(distinct (l.at at time zone tz)::date) from login_events l where l.user_id = e.user_id and l.at >= since),
          'installed', coalesce((select bool_or(l.installed) from login_events l where l.user_id = e.user_id and l.at >= since), false),
          'push', exists (select 1 from push_subscriptions s where s.user_id = e.user_id),
          'devices', (select count(distinct l.device) from login_events l where l.user_id = e.user_id and l.at >= since),
          'timesheets', (select count(*) from time_entries t where t.employee_id = e.id and t.status <> 'ciorna' and t.started_at >= since),
          'km_readings', (select count(*) from odometer_readings o where o.employee_id = e.id and o.reading_date >= (since at time zone tz)::date),
          'assignments', (select count(*) from assignments a where a.employee_id = e.id and a.starts_at >= since and a.starts_at < now() and a.status <> 'anulata'),
          'messages', (select count(*) from chat_messages cm where cm.user_id = e.user_id and cm.created_at >= since)
        ) p
        from employees e
        left join memberships m on m.user_id = e.user_id and m.company_id = e.company_id
        left join auth.users u on u.id = e.user_id
        where e.company_id = p_company and e.active
      ) s), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- adminul firmei: doar firma lui
create or replace function company_app_usage(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not app_is_admin() or app_company_id() is null then
    raise exception 'Doar administratorul poate vedea utilizarea aplicației.' using errcode = '42501';
  end if;
  return usage_report(app_company_id(), p_days);
end $$;

-- proprietarul: orice firmă
create or replace function owner_company_usage(p_company uuid, p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform owner_guard();
  return usage_report(p_company, p_days);
end $$;

revoke execute on function usage_report(uuid, int), company_app_usage(int), owner_company_usage(uuid, int) from public, anon;
revoke execute on function usage_report(uuid, int) from authenticated;
grant execute on function company_app_usage(int), owner_company_usage(uuid, int) to authenticated;
