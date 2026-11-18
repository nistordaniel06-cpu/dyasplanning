-- 013: Km introduși fără semnal păstrează ziua lor; „Am început” nu se suprapune cu tura abia închisă
drop function if exists submit_odometer(uuid, int, text);
create or replace function submit_odometer(p_vehicle_id uuid, p_km int, p_note text default null, p_date date default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  me uuid := app_employee_id();
  -- ziua citirii: azi; o citire salvată fără semnal poate păstra ziua ei (cel mult 2 zile în urmă)
  d date := case when p_date between app_today() - 2 and app_today() then p_date else app_today() end;
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
revoke execute on function submit_odometer(uuid, int, text, date) from public, anon;
grant execute on function submit_odometer(uuid, int, text, date) to authenticated;

-- „Am început” imediat după „Am terminat”: tura precedentă e rotunjită la minim 1 minut, deci noua tură
-- pornește de la sfârșitul ei (nu se suprapune). O suprapunere reală cu alt pontaj primește un mesaj clar.
create or replace function clock_in(p_project uuid, p_task uuid default null, p_assignment uuid default null,
  p_lat double precision default null, p_lon double precision default null, p_accuracy int default null, p_address text default null,
  p_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := app_employee_id(); cid uuid := app_company_id(); id uuid; started timestamptz; prev time_entries%rowtype;
begin
  if me is null or cid is null then raise exception 'Contul nu este legat de o fișă de angajat.' using errcode = '42501'; end if;
  if not exists (select 1 from projects where projects.id = p_project and company_id = cid) then
    raise exception 'Lucrarea nu aparține acestei firme.' using errcode = '42501';
  end if;
  if p_task is not null and not exists (select 1 from tasks where tasks.id = p_task and project_id = p_project) then p_task := null; end if;
  if p_assignment is not null and not exists (select 1 from assignments a where a.id = p_assignment and a.employee_id = me) then p_assignment := null; end if;
  if exists (select 1 from time_clocks where employee_id = me) then
    raise exception 'Ai deja o tură începută. Apasă „Am terminat” mai întâi.' using errcode = '23505';
  end if;
  started := clock_time(p_at);
  select * into prev from time_entries t
   where t.employee_id = me and t.status <> 'respins' and t.started_at <= started and t.ended_at > started
   order by t.ended_at desc limit 1;
  if found then
    if prev.ended_at - started <= interval '2 minutes' then started := prev.ended_at;
    else raise exception 'Ai deja un pontaj până la %. Modifică-l sau începe după această oră.',
      to_char(prev.ended_at at time zone coalesce((select timezone from companies where companies.id = cid), 'Europe/Bucharest'), 'HH24:MI') using errcode = '23P01';
    end if;
  end if;
  insert into time_clocks(company_id, employee_id, project_id, task_id, assignment_id, started_at, start_lat, start_lon, start_accuracy, start_address)
  values (cid, me, p_project, p_task, p_assignment, started, p_lat, p_lon, p_accuracy, left(p_address, 300))
  returning time_clocks.id into id;
  return id;
end $$;
