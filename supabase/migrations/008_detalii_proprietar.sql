-- 008: Panoul proprietarului mai detaliat
-- • locație GPS exactă (cu permisiunea utilizatorului) + adresă, fără dubluri când același cont e pe 2 telefoane
-- • activitatea adminilor cu numele elementelor și câmpurile schimbate (înainte → după)
-- • fișa unui utilizator și harta ultimelor poziții

-- ================= Conectări cu GPS =================
alter table login_events add column if not exists gps_lat double precision;
alter table login_events add column if not exists gps_lon double precision;
alter table login_events add column if not exists gps_accuracy int;
alter table login_events add column if not exists address text;

-- distanța aproximativă în metri între două puncte
create or replace function geo_distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable as $$
  select 6371000 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)))
$$;

create or replace function record_presence_v2(p_secret text, p_user uuid, p_ip text, p_city text, p_region text, p_country text,
  p_lat double precision, p_lon double precision, p_device text, p_installed boolean,
  p_gps_lat double precision, p_gps_lon double precision, p_gps_accuracy int, p_address text)
returns boolean language plpgsql security definer set search_path = public as $$
declare prev record;
begin
  if p_secret is null or p_secret is distinct from (select value from app_config where key = 'push_secret') then
    raise exception 'Secret invalid.' using errcode = '42501';
  end if;
  -- ultima conectare de pe ACELAȘI telefon (același IP + dispozitiv), ca două telefoane pe același cont să nu se dubleze
  select * into prev from login_events
  where user_id = p_user and ip is not distinct from left(p_ip, 64) and device is not distinct from left(p_device, 100)
    and at > now() - interval '30 minutes'
  order by at desc limit 1;
  if found then
    if p_gps_lat is null then return false; end if;
    if prev.gps_lat is not null and geo_distance_m(prev.gps_lat, prev.gps_lon, p_gps_lat, p_gps_lon) < 200 then return false; end if;
    if prev.gps_lat is null then
      -- același telefon tocmai a trimis GPS-ul: completăm rândul existent
      update login_events set gps_lat = p_gps_lat, gps_lon = p_gps_lon, gps_accuracy = p_gps_accuracy, address = left(p_address, 300)
      where id = prev.id;
      return true;
    end if;
  end if;
  insert into login_events(user_id, company_id, ip, city, region, country, lat, lon, device, installed, gps_lat, gps_lon, gps_accuracy, address)
  values (p_user, (select company_id from memberships where user_id = p_user), left(p_ip, 64), left(p_city, 100), left(p_region, 100),
          left(p_country, 8), p_lat, p_lon, left(p_device, 100), coalesce(p_installed, false),
          p_gps_lat, p_gps_lon, p_gps_accuracy, left(p_address, 300));
  delete from login_events where at < now() - interval '90 days';
  return true;
end $$;

-- ================= Activitate detaliată =================
alter table owner_activity add column if not exists details jsonb;

create or replace function activity_field_label(col text) returns text language sql immutable as $$
  select case col
    when 'name' then 'nume' when 'full_name' then 'nume' when 'phone' then 'telefon' when 'trade' then 'meserie'
    when 'skills' then 'competențe' when 'team_id' then 'echipa' when 'user_id' then 'cont în aplicație'
    when 'work_start' then 'început program' when 'work_end' then 'sfârșit program' when 'work_days' then 'zile lucrătoare'
    when 'active' then 'activ' when 'is_driver' then 'șofer' when 'default_vehicle_id' then 'mașina obișnuită'
    when 'status' then 'status' when 'progress' then 'progres' when 'due_date' then 'termen'
    when 'starts_at' then 'început' when 'ends_at' then 'sfârșit' when 'started_at' then 'început' when 'ended_at' then 'sfârșit'
    when 'break_minutes' then 'pauză (min)' when 'task_id' then 'misiune' when 'project_id' then 'lucrare'
    when 'employee_id' then 'angajat' when 'notes' then 'observații' when 'note' then 'observații'
    when 'address' then 'adresă' when 'city' then 'localitate' when 'client_name' then 'client'
    when 'contact_name' then 'persoană de contact' when 'contact_phone' then 'telefon contact' when 'color' then 'culoare'
    when 'plate' then 'nr. înmatriculare' when 'start_date' then 'data de început' when 'end_date' then 'data de sfârșit'
    when 'type' then 'tip' when 'timezone' then 'fus orar' when 'travel_buffer_minutes' then 'timp de deplasare'
    when 'description' then 'descriere' when 'manager_employee_id' then 'responsabil' when 'leader_employee_id' then 'șef de echipă'
    when 'reject_reason' then 'motivul respingerii' when 'flag_note' then 'problemă semnalată' when 'role' then 'rol'
    else col end
$$;

-- valoare lizibilă: id-urile devin nume, restul text scurt
create or replace function activity_value(col text, v jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare t text; u uuid;
begin
  if v is null or v = 'null'::jsonb then return '—'; end if;
  if jsonb_typeof(v) = 'boolean' then return case when v::text = 'true' then 'da' else 'nu' end; end if;
  t := case when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end;
  if col like '%\_id' escape '\' and t ~ '^[0-9a-f-]{36}$' then
    u := t::uuid;
    t := coalesce(
      case when col in ('employee_id', 'manager_employee_id', 'leader_employee_id') then (select full_name from employees where id = u) end,
      case when col = 'project_id' then (select name from projects where id = u) end,
      case when col = 'task_id' then (select name from tasks where id = u) end,
      case when col = 'team_id' then (select name from teams where id = u) end,
      case when col = 'default_vehicle_id' then (select name || coalesce(' (' || plate || ')', '') from vehicles where id = u) end,
      case when col = 'user_id' then 'cont legat' end,
      '—');
  elsif col in ('starts_at', 'ends_at', 'started_at', 'ended_at') then
    begin t := to_char((t::timestamptz) at time zone 'Europe/Bucharest', 'DD.MM HH24:MI'); exception when others then null; end;
  end if;
  return left(t, 80);
end $$;

-- descrierea unui rând (ce element e)
create or replace function activity_row_label(tbl text, r jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare emp text; proj text;
begin
  if r ? 'employee_id' then select full_name into emp from employees where id = (r->>'employee_id')::uuid; end if;
  if r ? 'project_id' then select name into proj from projects where id = (r->>'project_id')::uuid; end if;
  return left(case tbl
    when 'projects' then r->>'name'
    when 'tasks' then coalesce(r->>'name', '') || coalesce(' · ' || proj, '')
    when 'employees' then r->>'full_name'
    when 'teams' then r->>'name'
    when 'vehicles' then (r->>'name') || coalesce(' (' || (r->>'plate') || ')', '')
    when 'companies' then r->>'name'
    when 'assignments' then coalesce(emp, '?') || ' · ' || coalesce(proj, '?') || ' · ' ||
      coalesce(to_char(((r->>'starts_at')::timestamptz) at time zone 'Europe/Bucharest', 'DD.MM HH24:MI'), '')
    when 'time_entries' then coalesce(emp, '?') || ' · ' || coalesce(proj, '?') || ' · ' ||
      coalesce(to_char(((r->>'started_at')::timestamptz) at time zone 'Europe/Bucharest', 'DD.MM HH24:MI'), '')
    when 'absences' then coalesce(emp, '?') || ' · ' || coalesce(r->>'start_date', '') || ' – ' || coalesce(r->>'end_date', '')
    when 'invites' then coalesce(emp, 'invitație') || ' · ' || coalesce(r->>'role', '')
    else coalesce(r->>'name', r->>'id') end, 120);
end $$;

create or replace function trg_owner_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int; cid uuid; actor text; ent_one text; ent_many text; verb text; summary text; do_push boolean;
  items jsonb := '[]'::jsonb; r record; changes jsonb; k text; first_label text; first_fields text;
  ignore text[] := array['id', 'company_id', 'created_at', 'updated_at', 'created_by', 'worked_minutes', 'search', 'fts'];
begin
  if auth.uid() is null or app_role() is distinct from 'admin' or is_platform_owner() then return null; end if;
  cid := app_company_id();
  if cid is null then return null; end if;

  if tg_op = 'UPDATE' then
    for r in execute 'select to_jsonb(o) as o, to_jsonb(nw) as nw from old_rows o join new_rows nw on nw.id = o.id' loop
      changes := '[]'::jsonb;
      for k in select jsonb_object_keys(r.nw) loop
        if k = any(ignore) or (r.o -> k) is not distinct from (r.nw -> k) then continue; end if;
        changes := changes || jsonb_build_object('f', activity_field_label(k), 'from', activity_value(k, r.o -> k), 'to', activity_value(k, r.nw -> k));
      end loop;
      if jsonb_array_length(changes) > 0 and jsonb_array_length(items) < 10 then
        items := items || jsonb_build_object('label', activity_row_label(tg_table_name, r.nw), 'changes', changes);
      end if;
    end loop;
    n := jsonb_array_length(items);
    if n = 0 then return null; end if; -- salvare fără nicio schimbare reală: nu apare în jurnal
  else
    for r in execute format('select to_jsonb(x) as j from %I x limit 10', case when tg_op = 'DELETE' then 'old_rows' else 'new_rows' end) loop
      items := items || jsonb_build_object('label', activity_row_label(tg_table_name, r.j));
    end loop;
    execute format('select count(*) from %I', case when tg_op = 'DELETE' then 'old_rows' else 'new_rows' end) into n;
    if n = 0 then return null; end if;
  end if;

  ent_one := case tg_table_name
    when 'projects' then 'lucrarea' when 'tasks' then 'misiunea' when 'assignments' then 'alocarea'
    when 'employees' then 'angajatul' when 'teams' then 'echipa' when 'absences' then 'absența'
    when 'vehicles' then 'mașina' when 'time_entries' then 'pontajul' when 'invites' then 'invitația'
    when 'companies' then 'setările firmei' else tg_table_name end;
  ent_many := case tg_table_name
    when 'projects' then 'lucrări' when 'tasks' then 'misiuni' when 'assignments' then 'alocări'
    when 'employees' then 'angajați' when 'teams' then 'echipe' when 'absences' then 'absențe'
    when 'vehicles' then 'mașini' when 'time_entries' then 'pontaje' when 'invites' then 'invitații'
    when 'companies' then 'setările firmei' else tg_table_name end;
  verb := case tg_op when 'INSERT' then 'a adăugat' when 'UPDATE' then 'a modificat' else 'a șters' end;
  select coalesce(m.display_name, e.full_name, 'Admin') into actor
    from memberships m left join employees e on e.id = m.employee_id where m.user_id = auth.uid();
  first_label := items -> 0 ->> 'label';
  select string_agg(c ->> 'f', ', ') into first_fields from jsonb_array_elements(items -> 0 -> 'changes') c;
  summary := actor || ' ' || verb || ' ' ||
    case when tg_table_name = 'companies' then ent_one
         when n = 1 then ent_one || ' „' || coalesce(first_label, '') || '”' || coalesce(' (' || first_fields || ')', '')
         else n || ' ' || ent_many end;

  do_push := coalesce((select value = 'true'::jsonb from platform_settings where key = 'owner_activity_push'), true)
    and not exists (select 1 from owner_activity where company_id = cid and entity = tg_table_name and op = tg_op
                    and pushed and at > now() - interval '2 minutes');

  insert into owner_activity(company_id, user_id, actor, entity, op, n, summary, pushed, details)
  values (cid, auth.uid(), actor, tg_table_name, tg_op, n, left(summary, 300), do_push, items);
  delete from owner_activity where at < now() - interval '90 days';

  if do_push then
    perform notify_users(cid, array(select user_id from platform_owners), (select name from companies where id = cid),
      left(summary, 200), '/proprietar?tab=activitate', 'owner_activity', false);
  end if;
  return null;
exception when others then
  raise warning 'trg_owner_activity: %', sqlerrm;
  return null;
end $$;

-- la modificare avem nevoie și de rândurile vechi (înainte → după)
do $$
declare t text;
begin
  foreach t in array array['projects', 'tasks', 'assignments', 'employees', 'teams', 'absences', 'vehicles', 'time_entries', 'invites', 'companies'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists trg_owner_activity_upd on %I', t);
    execute format('create trigger trg_owner_activity_upd after update on %I referencing old table as old_rows new table as new_rows for each statement execute function trg_owner_activity()', t);
  end loop;
end $$;

drop function if exists owner_activity_feed(uuid, int);
create or replace function owner_activity_feed(p_company uuid default null, p_limit int default 200, p_user uuid default null)
returns table (at timestamptz, company_id uuid, company_name text, user_id uuid, actor text, entity text, op text, n int, summary text, details jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform owner_guard();
  return query
  select a.at, a.company_id, c.name, a.user_id, a.actor, a.entity, a.op, a.n, a.summary, a.details
  from owner_activity a left join companies c on c.id = a.company_id
  where (p_company is null or a.company_id = p_company) and (p_user is null or a.user_id = p_user)
  order by a.at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;

-- ================= Conectări (cu GPS) =================
drop function if exists owner_login_events(uuid, int);
create or replace function owner_login_events(p_company uuid default null, p_limit int default 200, p_user uuid default null)
returns table (at timestamptz, user_id uuid, user_login text, user_name text, company_name text, ip text, city text, region text, country text,
  lat double precision, lon double precision, device text, installed boolean,
  gps_lat double precision, gps_lon double precision, gps_accuracy int, address text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform owner_guard();
  return query
  select l.at, l.user_id, u.email::text, coalesce(e.full_name, m.display_name), c.name, l.ip, l.city, l.region, l.country, l.lat, l.lon,
    l.device, l.installed, l.gps_lat, l.gps_lon, l.gps_accuracy, l.address
  from login_events l
  left join auth.users u on u.id = l.user_id
  left join memberships m on m.user_id = l.user_id
  left join employees e on e.id = m.employee_id
  left join companies c on c.id = l.company_id
  where (p_company is null or l.company_id = p_company) and (p_user is null or l.user_id = p_user)
  order by l.at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end $$;

-- ================= Fișa unui utilizator =================
create or replace function owner_user_detail(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, auth as $$
declare r jsonb;
begin
  perform owner_guard();
  select jsonb_build_object(
    'user_id', u.id, 'login', u.email, 'created_at', u.created_at, 'last_sign_in', u.last_sign_in_at,
    'name', coalesce(e.full_name, m.display_name), 'role', m.role, 'company_id', m.company_id, 'company', c.name,
    'phone', e.phone, 'trade', e.trade, 'is_driver', e.is_driver,
    'logins_30d', (select count(*) from login_events x where x.user_id = u.id and x.at > now() - interval '30 days'),
    'devices', coalesce((
      select jsonb_agg(d order by d->>'last' desc) from (
        select jsonb_build_object('device', x.device, 'ip', x.ip, 'city', max(x.city), 'country', max(x.country),
          'installed', bool_or(x.installed), 'count', count(*), 'first', min(x.at), 'last', max(x.at)) d
        from login_events x where x.user_id = u.id group by x.device, x.ip) s), '[]'::jsonb),
    'push_devices', (select count(*) from push_subscriptions s where s.user_id = u.id),
    'assignments_7d', (select count(*) from assignments a where a.employee_id = e.id and a.starts_at > now() - interval '7 days'),
    'time_entries_30d', (select count(*) from time_entries t where t.employee_id = e.id and t.started_at > now() - interval '30 days'),
    'hours_30d', (select round(coalesce(sum(t.worked_minutes), 0) / 60.0, 1) from time_entries t
                  where t.employee_id = e.id and t.started_at > now() - interval '30 days' and t.status = 'aprobat'),
    'messages_30d', (select count(*) from chat_messages cm where cm.user_id = u.id and cm.created_at > now() - interval '30 days')
  ) into r
  from auth.users u
  left join memberships m on m.user_id = u.id
  left join employees e on e.id = m.employee_id
  left join companies c on c.id = m.company_id
  where u.id = p_user;
  if r is null then raise exception 'Utilizatorul nu există.' using errcode = 'P0002'; end if;
  return r;
end $$;

-- ================= Harta: ultima poziție a fiecărui utilizator (30 de zile) =================
create or replace function owner_map_points(p_company uuid default null)
returns table (user_id uuid, name text, company_name text, at timestamptz, lat double precision, lon double precision,
  precise boolean, accuracy int, place text, device text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform owner_guard();
  return query
  select distinct on (l.user_id) l.user_id, coalesce(e.full_name, m.display_name, u.email::text), c.name, l.at,
    coalesce(l.gps_lat, l.lat), coalesce(l.gps_lon, l.lon), l.gps_lat is not null, l.gps_accuracy,
    coalesce(l.address, concat_ws(', ', l.city, l.country)), l.device
  from login_events l
  left join auth.users u on u.id = l.user_id
  left join memberships m on m.user_id = l.user_id
  left join employees e on e.id = m.employee_id
  left join companies c on c.id = l.company_id
  where l.at > now() - interval '30 days' and coalesce(l.gps_lat, l.lat) is not null
    and (p_company is null or l.company_id = p_company)
  order by l.user_id, (l.gps_lat is not null) desc, l.at desc;
end $$;

revoke execute on function geo_distance_m(double precision, double precision, double precision, double precision),
  record_presence_v2(text, uuid, text, text, text, text, double precision, double precision, text, boolean, double precision, double precision, int, text),
  activity_field_label(text), activity_value(text, jsonb), activity_row_label(text, jsonb),
  owner_activity_feed(uuid, int, uuid), owner_login_events(uuid, int, uuid), owner_user_detail(uuid), owner_map_points(uuid) from public, anon;
revoke execute on function activity_value(text, jsonb), activity_row_label(text, jsonb) from authenticated;
grant execute on function record_presence_v2(text, uuid, text, text, text, text, double precision, double precision, text, boolean, double precision, double precision, int, text) to anon, authenticated;
grant execute on function owner_activity_feed(uuid, int, uuid), owner_login_events(uuid, int, uuid), owner_user_detail(uuid), owner_map_points(uuid) to authenticated;
