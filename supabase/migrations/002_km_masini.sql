-- =====================================================================
-- DYASPlanning — 002: mașini și kilometri de bord
-- Șoferul introduce dimineața km din bord; aplicația calculează km parcurși
-- din diferența cu citirea următoare. Citirile sunt vizibile doar administratorului.
-- Se poate rula de mai multe ori.
-- =====================================================================

create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  plate text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_vehicles_plate on vehicles(company_id, upper(plate)) where plate is not null;

alter table employees add column if not exists is_driver boolean not null default false;
alter table employees add column if not exists default_vehicle_id uuid references vehicles(id) on delete set null;

create table if not exists odometer_readings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  reading_date date not null,
  km int not null check (km >= 0 and km < 10000000),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id, reading_date)
);
create index if not exists idx_odometer_company_date on odometer_readings(company_id, reading_date);

-- Integritate: mașina și angajatul trebuie să fie din aceeași firmă
create or replace function check_vehicle_company() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new);
begin
  if j ? 'vehicle_id' and j->>'vehicle_id' is not null then
    if not exists (select 1 from vehicles where id = (j->>'vehicle_id')::uuid and company_id = new.company_id) then
      raise exception 'Mașina nu aparține acestei firme.' using errcode = '42501';
    end if;
  end if;
  if j ? 'default_vehicle_id' and j->>'default_vehicle_id' is not null then
    if not exists (select 1 from vehicles where id = (j->>'default_vehicle_id')::uuid and company_id = new.company_id) then
      raise exception 'Mașina nu aparține acestei firme.' using errcode = '42501';
    end if;
  end if;
  if tg_table_name = 'odometer_readings' and j->>'employee_id' is not null then
    if not exists (select 1 from employees where id = (j->>'employee_id')::uuid and company_id = new.company_id) then
      raise exception 'Angajatul nu aparține acestei firme.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_vehicle_company on odometer_readings;
create trigger trg_vehicle_company before insert or update on odometer_readings for each row execute function check_vehicle_company();
drop trigger if exists trg_vehicle_company on employees;
create trigger trg_vehicle_company before insert or update on employees for each row execute function check_vehicle_company();
drop trigger if exists trg_lock_company on vehicles;
create trigger trg_lock_company before update on vehicles for each row execute function lock_company_id();
drop trigger if exists trg_lock_company on odometer_readings;
create trigger trg_lock_company before update on odometer_readings for each row execute function lock_company_id();
drop trigger if exists trg_touch on odometer_readings;
create trigger trg_touch before update on odometer_readings for each row execute function touch_updated_at();

-- RLS: mașinile le văd toți din firmă (șoferul își alege mașina); citirile doar adminul.
alter table vehicles enable row level security;
alter table odometer_readings enable row level security;
drop policy if exists vehicles_select on vehicles;
drop policy if exists vehicles_write on vehicles;
drop policy if exists odometer_admin on odometer_readings;
create policy vehicles_select on vehicles for select using (company_id = app_company_id());
create policy vehicles_write on vehicles for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());
create policy odometer_admin on odometer_readings for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

-- Data de azi în fusul orar al firmei
create or replace function app_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone coalesce((select timezone from companies where id = app_company_id()), 'Europe/Bucharest'))::date
$$;

-- Șoferul trimite km de bord pentru azi. O citire pe mașină pe zi; o poate corecta doar cine a introdus-o, în aceeași zi.
create or replace function submit_odometer(p_vehicle_id uuid, p_km int, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_employee_id();
  d date := app_today();
  prev odometer_readings%rowtype;
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

  select * into prev from odometer_readings where vehicle_id = p_vehicle_id and reading_date < d order by reading_date desc limit 1;
  if found and p_km < prev.km then
    raise exception 'Kilometrajul introdus (% km) este mai mic decât ultima citire (% km, din %). Verifică cifrele de pe bord.', p_km, prev.km, to_char(prev.reading_date, 'DD.MM.YYYY') using errcode = '22023';
  end if;

  select * into cur from odometer_readings where vehicle_id = p_vehicle_id and reading_date = d;
  if found then
    if cur.employee_id is distinct from me and not app_is_admin() then
      raise exception 'Pentru această mașină s-au introdus deja km azi.' using errcode = '23505';
    end if;
    update odometer_readings set km = p_km, note = nullif(trim(p_note), ''), employee_id = coalesce(cur.employee_id, me)
      where id = cur.id returning * into cur;
  else
    insert into odometer_readings(company_id, vehicle_id, employee_id, reading_date, km, note, created_by)
    values (app_company_id(), p_vehicle_id, me, d, p_km, nullif(trim(p_note), ''), auth.uid()) returning * into cur;
  end if;
  return json_build_object('reading_date', cur.reading_date, 'km', cur.km, 'vehicle_id', cur.vehicle_id);
end $$;

-- Citirile de azi introduse de mine (șoferul își vede doar confirmarea, nu istoricul).
create or replace function my_odometer_today()
returns table(vehicle_id uuid, vehicle_name text, plate text, km int, reading_date date)
language sql stable security definer set search_path = public as $$
  select r.vehicle_id, v.name, v.plate, r.km, r.reading_date
  from odometer_readings r join vehicles v on v.id = r.vehicle_id
  where r.employee_id = app_employee_id() and r.company_id = app_company_id() and r.reading_date = app_today()
$$;

grant select, insert, update, delete on vehicles, odometer_readings to authenticated;
revoke execute on function app_today(), submit_odometer(uuid, int, text), my_odometer_today(), check_vehicle_company() from public, anon;
grant execute on function app_today(), submit_odometer(uuid, int, text), my_odometer_today() to authenticated;
