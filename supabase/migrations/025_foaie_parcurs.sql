-- 025: Foaia de parcurs — curse cu km de plecare și km de sosire (ca foaia de hârtie)
-- O cursă: de la → la, km start (din bord), km stop (din bord), motiv, șofer, mașină, personal/serviciu.
-- Km de plecare se completează automat cu km de sosire ai ultimei curse a mașinii.
create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  seq int not null default 0,
  trip_date date not null,
  km_start int not null check (km_start >= 0 and km_start < 10000000),
  km_end int check (km_end is null or (km_end >= km_start and km_end - km_start <= 3000)),
  from_place text not null check (length(from_place) between 1 and 120),
  to_place text check (to_place is null or length(to_place) between 1 and 120),
  from_project_id uuid references projects(id) on delete set null,
  to_project_id uuid references projects(id) on delete set null,
  purpose text check (purpose is null or length(purpose) <= 300),
  private boolean not null default false,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  gps_km numeric(7,1),
  start_lat double precision, start_lon double precision, end_lat double precision, end_lon double precision,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_trips_company_date on trips(company_id, trip_date);
create index if not exists idx_trips_vehicle_seq on trips(vehicle_id, seq);
create index if not exists idx_trips_employee_open on trips(employee_id) where km_end is null;
-- o mașină nu poate fi „în drum” de două ori în același timp
create unique index if not exists uq_trips_vehicle_open on trips(vehicle_id) where km_end is null;

drop trigger if exists trg_vehicle_company on trips;
create trigger trg_vehicle_company before insert or update on trips for each row execute function check_vehicle_company();
drop trigger if exists trg_lock_company on trips;
create trigger trg_lock_company before update on trips for each row execute function lock_company_id();
drop trigger if exists trg_touch on trips;
create trigger trg_touch before update on trips for each row execute function touch_updated_at();

-- numărul cursei: continuu pe mașină (ca „Rit nr.” de pe foaie)
create or replace function trips_set_seq() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.seq is null or new.seq = 0 then
    perform pg_advisory_xact_lock(hashtext('trips_seq:' || new.vehicle_id::text));
    select coalesce(max(seq), 0) + 1 into new.seq from trips where vehicle_id = new.vehicle_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_trips_seq on trips;
create trigger trg_trips_seq before insert on trips for each row execute function trips_set_seq();

alter table trips enable row level security;
grant select, insert, update, delete on trips to authenticated;
drop policy if exists trips_select on trips;
drop policy if exists trips_admin on trips;
create policy trips_select on trips for select using (
  company_id = app_company_id() and (app_is_admin() or employee_id = app_employee_id()));
create policy trips_admin on trips for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

-- Ultimii km cunoscuți ai mașinii (din curse și din citirile vechi), pentru completarea automată.
create or replace function vehicle_last_km(p_vehicle_id uuid) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('km', km, 'place', place, 'at', at) from (
    select coalesce(t.km_end, t.km_start) as km, case when t.km_end is not null then t.to_place end as place, coalesce(t.ended_at, t.started_at) as at
      from trips t where t.vehicle_id = p_vehicle_id and t.company_id = app_company_id()
    union all
    select r.km, null, coalesce(r.recorded_at, r.reading_date::timestamptz) from odometer_readings r
      where r.vehicle_id = p_vehicle_id and r.company_id = app_company_id()
    order by km desc, at desc limit 1
  ) x
$$;
revoke execute on function vehicle_last_km(uuid) from public, anon;
grant execute on function vehicle_last_km(uuid) to authenticated;

create or replace function trip_driver_guard() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare me uuid := app_employee_id();
begin
  if auth.uid() is null or app_company_id() is null then raise exception 'Trebuie să fii autentificat.' using errcode = '42501'; end if;
  if me is null then raise exception 'Contul nu este legat de o fișă de angajat.' using errcode = '42501'; end if;
  if not app_is_admin() and not exists (select 1 from employees where id = me and is_driver) then
    raise exception 'Nu ești setat ca șofer. Cere administratorului să te marcheze ca șofer.' using errcode = '42501';
  end if;
  return me;
end $$;
revoke execute on function trip_driver_guard() from public, anon;

-- Pornesc la drum. p_id vine de pe telefon (ca să meargă și fără semnal).
create or replace function start_trip(p_id uuid, p_vehicle_id uuid, p_km_start int, p_from text, p_from_project uuid default null,
  p_started_at timestamptz default null, p_lat double precision default null, p_lon double precision default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  me uuid := trip_driver_guard();
  last_km int;
  other text;
  r trips%rowtype;
  at timestamptz := least(coalesce(p_started_at, now()), now());
begin
  if exists (select 1 from trips where id = p_id) then
    select * into r from trips where id = p_id and employee_id = me;
    if not found then raise exception 'Cursa nu este a ta.' using errcode = '42501'; end if;
    return json_build_object('id', r.id, 'seq', r.seq); -- trimisă de două ori (fără semnal): o dată e destul
  end if;
  if not exists (select 1 from vehicles where id = p_vehicle_id and company_id = app_company_id() and active) then
    raise exception 'Mașina nu există sau nu este activă.' using errcode = '22023';
  end if;
  if p_km_start is null or p_km_start < 0 or p_km_start >= 10000000 then raise exception 'Kilometraj invalid.' using errcode = '22023'; end if;
  if coalesce(trim(p_from), '') = '' then raise exception 'Alege de unde pleci.' using errcode = '22023'; end if;
  if exists (select 1 from trips where employee_id = me and km_end is null) then
    raise exception 'Ai deja o cursă pornită. Termin-o întâi (scrie km la sosire).' using errcode = '23505';
  end if;
  select e.full_name into other from trips t left join employees e on e.id = t.employee_id where t.vehicle_id = p_vehicle_id and t.km_end is null;
  if found then raise exception 'Mașina e deja în drum cu %. Cursa lui trebuie terminată întâi.', coalesce(other, 'alt șofer') using errcode = '23505'; end if;
  last_km := (vehicle_last_km(p_vehicle_id)->>'km')::int;
  if last_km is not null and p_km_start < last_km then
    raise exception 'Km la plecare (% km) sunt mai mici decât ultimii km ai mașinii (% km). Verifică cifrele de pe bord.', p_km_start, last_km using errcode = '22023';
  end if;
  insert into trips(id, company_id, vehicle_id, employee_id, trip_date, km_start, from_place, from_project_id, started_at, start_lat, start_lon, created_by)
  values (p_id, app_company_id(), p_vehicle_id, me, (at at time zone coalesce((select timezone from companies where id = app_company_id()), 'Europe/Bucharest'))::date,
    p_km_start, left(trim(p_from), 120),
    (select id from projects where id = p_from_project and company_id = app_company_id()), at, p_lat, p_lon, auth.uid())
  returning * into r;
  return json_build_object('id', r.id, 'seq', r.seq, 'gap', case when last_km is not null then p_km_start - last_km end);
end $$;
revoke execute on function start_trip(uuid, uuid, int, text, uuid, timestamptz, double precision, double precision) from public, anon;
grant execute on function start_trip(uuid, uuid, int, text, uuid, timestamptz, double precision, double precision) to authenticated;

-- Am ajuns: km la sosire + unde. Poate fi corectată de șofer în aceeași zi sau a doua zi.
create or replace function end_trip(p_id uuid, p_km_end int, p_to text, p_to_project uuid default null, p_purpose text default null,
  p_private boolean default false, p_gps_km numeric default null, p_ended_at timestamptz default null,
  p_lat double precision default null, p_lon double precision default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  me uuid := trip_driver_guard();
  r trips%rowtype;
  nxt int;
begin
  select * into r from trips where id = p_id and company_id = app_company_id();
  if not found then raise exception 'Cursa nu există.' using errcode = '22023'; end if;
  if r.employee_id is distinct from me and not app_is_admin() then raise exception 'Cursa nu este a ta.' using errcode = '42501'; end if;
  if r.km_end is not null and not app_is_admin() and r.trip_date < app_today() - 1 then
    raise exception 'Cursa e prea veche ca s-o mai corectezi. Cere administratorului.' using errcode = '42501';
  end if;
  if coalesce(trim(p_to), '') = '' then raise exception 'Alege unde ai ajuns.' using errcode = '22023'; end if;
  if p_km_end is null or p_km_end < r.km_start then
    raise exception 'Km la sosire (% km) trebuie să fie cel puțin cât km la plecare (% km).', p_km_end, r.km_start using errcode = '22023';
  end if;
  if p_km_end - r.km_start > 3000 then raise exception 'Prea mulți km pentru o cursă (peste 3000). Verifică cifrele.' using errcode = '22023'; end if;
  select min(km_start) into nxt from trips where vehicle_id = r.vehicle_id and seq > r.seq;
  if nxt is not null and p_km_end > nxt then
    raise exception 'Km la sosire (% km) sunt mai mari decât km la plecare ai cursei următoare (% km).', p_km_end, nxt using errcode = '22023';
  end if;
  update trips set km_end = p_km_end, to_place = left(trim(p_to), 120),
    to_project_id = (select id from projects where id = p_to_project and company_id = app_company_id()),
    purpose = nullif(left(trim(coalesce(p_purpose, '')), 300), ''), private = coalesce(p_private, false),
    gps_km = case when p_gps_km > 0 then round(p_gps_km, 1) end,
    ended_at = coalesce(ended_at, least(coalesce(p_ended_at, now()), now())),
    end_lat = coalesce(p_lat, end_lat), end_lon = coalesce(p_lon, end_lon)
  where id = r.id returning * into r;
  return json_build_object('id', r.id, 'km', r.km_end - r.km_start);
end $$;
revoke execute on function end_trip(uuid, int, text, uuid, text, boolean, numeric, timestamptz, double precision, double precision) from public, anon;
grant execute on function end_trip(uuid, int, text, uuid, text, boolean, numeric, timestamptz, double precision, double precision) to authenticated;

-- Șoferul își anulează o cursă pornită din greșeală (doar cea pornită, nu și cele terminate).
create or replace function cancel_my_trip(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from trips where id = p_id and company_id = app_company_id() and km_end is null
    and (employee_id = app_employee_id() or app_is_admin());
  if not found then raise exception 'Cursa nu poate fi anulată.' using errcode = '42501'; end if;
end $$;
revoke execute on function cancel_my_trip(uuid) from public, anon;
grant execute on function cancel_my_trip(uuid) to authenticated;

-- Notificare la administratori când se termină o cursă
create or replace function trg_notify_trip() returns trigger
language plpgsql security definer set search_path = public as $$
declare veh text; emp text;
begin
  if new.km_end is null or (tg_op = 'UPDATE' and old.km_end is not distinct from new.km_end and old.to_place is not distinct from new.to_place) then return null; end if;
  select name || coalesce(' (' || plate || ')', '') into veh from vehicles where id = new.vehicle_id;
  select full_name into emp from employees where id = new.employee_id;
  perform notify_users(new.company_id,
    array(select user_id from memberships where company_id = new.company_id and role = 'admin' and user_id is distinct from auth.uid()),
    'Cursă: ' || new.from_place || ' → ' || coalesce(new.to_place, '?'),
    replace(to_char(new.km_end - new.km_start, 'FM9,999,999'), ',', '.') || ' km · ' || coalesce(veh, 'Mașină') || ' · ' || coalesce(emp, 'necunoscut'),
    '/masini', 'km', true);
  return null;
end $$;
drop trigger if exists trg_trips_notify on trips;
create trigger trg_trips_notify after insert or update of km_end, to_place on trips for each row execute function trg_notify_trip();

notify pgrst, 'reload schema';
