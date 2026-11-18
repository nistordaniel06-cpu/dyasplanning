-- 017: Adresa de acasă a angajatului; km la mașină de două ori pe zi: „Am ajuns la muncă” și „Am ajuns acasă”.
-- Adresa stă separat de fișa angajatului: colegii văd fișele unii altora, dar adresa o văd doar adminii și angajatul însuși.
create table if not exists employee_private (
  employee_id uuid primary key references employees(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  home_address text check (home_address is null or length(home_address) <= 300),
  updated_at timestamptz not null default now()
);
alter table employee_private enable row level security;
drop policy if exists employee_private_select on employee_private;
drop policy if exists employee_private_write on employee_private;
create policy employee_private_select on employee_private for select using (
  company_id = app_company_id() and (app_is_admin() or employee_id = app_employee_id()));
create policy employee_private_write on employee_private for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());
grant select, insert, update, delete on employee_private to authenticated;
create or replace function employee_private_company() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from employees where id = new.employee_id and company_id = new.company_id) then
    raise exception 'Angajatul nu aparține acestei firme.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_employee_private_company on employee_private;
create trigger trg_employee_private_company before insert or update on employee_private for each row execute function employee_private_company();

-- tipul citirii: 'munca' = la sosirea la muncă (citirile vechi, de dimineață), 'acasa' = la sosirea acasă
alter table odometer_readings add column if not exists kind text not null default 'munca';
alter table odometer_readings drop constraint if exists odometer_readings_kind_check;
alter table odometer_readings add constraint odometer_readings_kind_check check (kind in ('munca', 'acasa'));
alter table odometer_readings add column if not exists recorded_at timestamptz;
alter table odometer_readings add column if not exists lat double precision;
alter table odometer_readings add column if not exists lon double precision;
alter table odometer_readings drop constraint if exists odometer_readings_vehicle_id_reading_date_key;
create unique index if not exists odometer_readings_vehicle_day_kind on odometer_readings(vehicle_id, reading_date, kind);

-- ordinea în zi: întâi la muncă, apoi acasă
create or replace function odometer_seq(d date, k text) returns int language sql immutable as $$
  select (d - date '2000-01-01') * 2 + case when k = 'acasa' then 1 else 0 end
$$;

drop function if exists submit_odometer(uuid, int, text, date);
create or replace function submit_odometer(p_vehicle_id uuid, p_km int, p_note text default null, p_date date default null,
  p_kind text default 'munca', p_lat double precision default null, p_lon double precision default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_employee_id();
  d date := case when p_date between app_today() - 2 and app_today() then p_date else app_today() end;
  k text := case when p_kind = 'acasa' then 'acasa' else 'munca' end;
  prev odometer_readings%rowtype;
  nxt odometer_readings%rowtype;
  cur odometer_readings%rowtype;
begin
  if auth.uid() is null or app_company_id() is null then raise exception 'Trebuie să fii autentificat.' using errcode = '42501'; end if;
  if me is null then raise exception 'Contul nu este legat de o fișă de angajat.' using errcode = '42501'; end if;
  if not app_is_admin() and not exists (select 1 from employees where id = me and is_driver) then
    raise exception 'Nu ești setat ca șofer. Cere administratorului să te marcheze ca șofer.' using errcode = '42501';
  end if;
  if not exists (select 1 from vehicles where id = p_vehicle_id and company_id = app_company_id() and active) then
    raise exception 'Mașina nu există sau nu este activă.' using errcode = '22023';
  end if;
  if p_km is null or p_km < 0 or p_km >= 10000000 then raise exception 'Kilometraj invalid.' using errcode = '22023'; end if;

  select * into prev from odometer_readings where vehicle_id = p_vehicle_id and odometer_seq(reading_date, kind) < odometer_seq(d, k)
    order by odometer_seq(reading_date, kind) desc limit 1;
  if found and p_km < prev.km then
    raise exception 'Kilometrajul introdus (% km) este mai mic decât citirea anterioară (% km, %, %). Verifică cifrele de pe bord.',
      p_km, prev.km, to_char(prev.reading_date, 'DD.MM.YYYY'), case prev.kind when 'acasa' then 'ajuns acasă' else 'ajuns la muncă' end using errcode = '22023';
  end if;
  select * into nxt from odometer_readings where vehicle_id = p_vehicle_id and odometer_seq(reading_date, kind) > odometer_seq(d, k)
    order by odometer_seq(reading_date, kind) limit 1;
  if found and p_km > nxt.km then
    raise exception 'Kilometrajul introdus (% km) este mai mare decât citirea următoare (% km). Verifică cifrele de pe bord.', p_km, nxt.km using errcode = '22023';
  end if;

  select * into cur from odometer_readings where vehicle_id = p_vehicle_id and reading_date = d and kind = k;
  if found then
    if cur.employee_id is distinct from me and not app_is_admin() then
      raise exception 'Pentru această mașină s-au introdus deja km (%).', case k when 'acasa' then 'ajuns acasă' else 'ajuns la muncă' end using errcode = '23505';
    end if;
    update odometer_readings set km = p_km, note = nullif(trim(p_note), ''), employee_id = coalesce(cur.employee_id, me),
      recorded_at = now(), lat = coalesce(p_lat, lat), lon = coalesce(p_lon, lon)
      where id = cur.id returning * into cur;
  else
    insert into odometer_readings(company_id, vehicle_id, employee_id, reading_date, kind, km, note, created_by, recorded_at, lat, lon)
    values (app_company_id(), p_vehicle_id, me, d, k, p_km, nullif(trim(p_note), ''), auth.uid(), now(), p_lat, p_lon) returning * into cur;
  end if;
  return json_build_object('reading_date', cur.reading_date, 'kind', cur.kind, 'km', cur.km, 'vehicle_id', cur.vehicle_id);
end $$;
revoke execute on function submit_odometer(uuid, int, text, date, text, double precision, double precision) from public, anon;
grant execute on function submit_odometer(uuid, int, text, date, text, double precision, double precision) to authenticated;

drop function if exists my_odometer_today();
create function my_odometer_today()
returns table(vehicle_id uuid, vehicle_name text, plate text, km int, reading_date date, kind text, recorded_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.vehicle_id, v.name, v.plate, r.km, r.reading_date, r.kind, r.recorded_at
  from odometer_readings r join vehicles v on v.id = r.vehicle_id
  where r.employee_id = app_employee_id() and r.company_id = app_company_id() and r.reading_date = app_today()
  order by r.kind = 'acasa'
$$;
revoke execute on function my_odometer_today() from public, anon;
grant execute on function my_odometer_today() to authenticated;

-- notificarea către admin: spune și momentul (ajuns la muncă / acasă) și km față de citirea anterioară
create or replace function trg_notify_odometer() returns trigger
language plpgsql security definer set search_path = public as $$
declare veh text; emp text; prev int;
begin
  if tg_op = 'UPDATE' and new.km = old.km then return null; end if;
  select name || coalesce(' (' || plate || ')', '') into veh from vehicles where id = new.vehicle_id;
  select full_name into emp from employees where id = new.employee_id;
  select km into prev from odometer_readings where vehicle_id = new.vehicle_id
    and odometer_seq(reading_date, kind) < odometer_seq(new.reading_date, new.kind) order by odometer_seq(reading_date, kind) desc limit 1;
  perform notify_users(new.company_id,
    array(select user_id from memberships where company_id = new.company_id and role = 'admin'),
    'Km ' || case new.kind when 'acasa' then 'ajuns acasă' else 'ajuns la muncă' end || ': ' || coalesce(veh, 'Mașină'),
    replace(to_char(new.km, 'FM9,999,999'), ',', '.') || ' km' ||
      case when prev is not null then ' (+' || replace(to_char(new.km - prev, 'FM9,999,999'), ',', '.') || ' km de la citirea anterioară)' else '' end ||
      ' · ' || coalesce(emp, 'necunoscut'),
    '/masini', 'km', true);
  return null;
end $$;
