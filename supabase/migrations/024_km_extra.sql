-- 024: Km extra — trasee în afara drumului obișnuit (scrise de mână sau măsurate cu GPS-ul telefonului)
create table if not exists extra_trips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  trip_date date not null,
  km numeric(7,1) not null check (km > 0 and km <= 3000),
  note text,
  source text not null default 'manual' check (source in ('manual', 'gps')),
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_extra_trips_company_date on extra_trips(company_id, trip_date);
create index if not exists idx_extra_trips_employee_date on extra_trips(employee_id, trip_date);

drop trigger if exists trg_vehicle_company on extra_trips;
create trigger trg_vehicle_company before insert or update on extra_trips for each row execute function check_vehicle_company();
drop trigger if exists trg_lock_company on extra_trips;
create trigger trg_lock_company before update on extra_trips for each row execute function lock_company_id();

-- RLS: adminul vede și modifică tot; șoferul își vede doar traseele lui (le adaugă/șterge prin funcțiile de mai jos).
alter table extra_trips enable row level security;
grant select, insert, update, delete on extra_trips to authenticated;
drop policy if exists extra_trips_select on extra_trips;
drop policy if exists extra_trips_admin on extra_trips;
create policy extra_trips_select on extra_trips for select using (
  company_id = app_company_id() and (app_is_admin() or employee_id = app_employee_id()));
create policy extra_trips_admin on extra_trips for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

create or replace function add_extra_trip(p_vehicle_id uuid, p_km numeric, p_note text default null, p_source text default 'manual',
  p_started_at timestamptz default null, p_ended_at timestamptz default null, p_date date default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_employee_id();
  d date := case when p_date between app_today() - 2 and app_today() then p_date else app_today() end;
  r extra_trips%rowtype;
  emp text; veh text;
begin
  if auth.uid() is null or app_company_id() is null then raise exception 'Trebuie să fii autentificat.' using errcode = '42501'; end if;
  if me is null then raise exception 'Contul nu este legat de o fișă de angajat.' using errcode = '42501'; end if;
  if not app_is_admin() and not exists (select 1 from employees where id = me and is_driver) then
    raise exception 'Nu ești setat ca șofer. Cere administratorului să te marcheze ca șofer.' using errcode = '42501';
  end if;
  if not exists (select 1 from vehicles where id = p_vehicle_id and company_id = app_company_id() and active) then
    raise exception 'Mașina nu există sau nu este activă.' using errcode = '22023';
  end if;
  if p_km is null or p_km <= 0 then raise exception 'Scrie câți km ai făcut.' using errcode = '22023'; end if;
  if p_km > 3000 then raise exception 'Prea mulți km pentru un traseu (maxim 3000).' using errcode = '22023'; end if;
  insert into extra_trips(company_id, vehicle_id, employee_id, trip_date, km, note, source, started_at, ended_at, created_by)
  values (app_company_id(), p_vehicle_id, me, d, round(p_km, 1), nullif(trim(p_note), ''),
    case when p_source = 'gps' then 'gps' else 'manual' end, p_started_at, p_ended_at, auth.uid())
  returning * into r;

  -- anunță administratorii (fără să blocheze salvarea dacă notificarea nu merge)
  begin
    select full_name into emp from employees where id = me;
    select name into veh from vehicles where id = p_vehicle_id;
    perform notify_users(app_company_id(),
      array(select m.user_id from memberships m where m.company_id = app_company_id() and m.role = 'admin' and m.user_id <> auth.uid()),
      'Km extra: ' || coalesce(emp, 'șofer'),
      to_char(r.km, 'FM99990.0') || ' km cu ' || coalesce(veh, 'mașina') || case when r.source = 'gps' then ' (GPS)' else '' end
        || coalesce(' — ' || r.note, ''),
      '/masini', 'km', true);
  exception when others then null;
  end;
  return json_build_object('id', r.id, 'km', r.km, 'trip_date', r.trip_date);
end $$;
revoke execute on function add_extra_trip(uuid, numeric, text, text, timestamptz, timestamptz, date) from public, anon;
grant execute on function add_extra_trip(uuid, numeric, text, text, timestamptz, timestamptz, date) to authenticated;

-- Șoferul își poate șterge un traseu greșit (doar al lui, din ultimele 2 zile).
create or replace function delete_my_extra_trip(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from extra_trips where id = p_id and company_id = app_company_id()
    and (app_is_admin() or (employee_id = app_employee_id() and trip_date >= app_today() - 2));
  if not found then raise exception 'Traseul nu poate fi șters.' using errcode = '42501'; end if;
end $$;
revoke execute on function delete_my_extra_trip(uuid) from public, anon;
grant execute on function delete_my_extra_trip(uuid) to authenticated;
