-- 027: (1) Nu se pot pune ore cuiva în zilele în care e absent / în concediu.
--      (2) Notificare „⛽ Verifică combustibilul” de 3 ori pe zi pentru șoferii care lucrează în ziua respectivă.

-- ================= Absențe: fără ore în zilele de absență =================
create or replace function time_entries_block_absence() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  tz text := coalesce((select timezone from companies where id = new.company_id), 'Europe/Bucharest');
  d date := (new.started_at at time zone tz)::date;
  ab record;
begin
  if tg_op = 'UPDATE' and new.started_at is not distinct from old.started_at and new.employee_id is not distinct from old.employee_id then
    return new;
  end if;
  select a.type, a.start_date, a.end_date, e.full_name into ab
  from absences a join employees e on e.id = a.employee_id
  where a.employee_id = new.employee_id and a.company_id = new.company_id and d between a.start_date and a.end_date
  limit 1;
  if found then
    raise exception '% este % pe % — nu se pot pune ore în această zi. Dacă a lucrat totuși, scoate întâi absența.',
      ab.full_name,
      case ab.type when 'concediu' then 'în concediu' when 'medical' then 'în concediu medical' when 'absent' then 'absent' else 'indisponibil' end,
      to_char(d, 'DD.MM.YYYY')
      using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists trg_time_entries_absence on time_entries;
create trigger trg_time_entries_absence before insert or update of started_at, employee_id on time_entries
  for each row execute function time_entries_block_absence();

-- ================= Combustibil =================
alter table companies add column if not exists fuel_reminders boolean not null default true;

create table if not exists fuel_reminder_log (
  employee_id uuid not null references employees(id) on delete cascade,
  day date not null,
  slot int not null,
  sent_at timestamptz not null default now(),
  primary key (employee_id, day, slot)
);
alter table fuel_reminder_log enable row level security; -- doar funcția de mai jos scrie aici

-- Rulează la 10 minute. Pentru fiecare șofer care lucrează azi (alocat pe o lucrare sau cu o cursă azi):
-- 3 notificări în intervalul lui de lucru: la 30 min după început, la mijloc și cu 45 min înainte de final.
create or replace function fuel_reminders_tick() returns int
language plpgsql security definer set search_path = public as $$
declare
  c record; e record; n int := 0;
  tz text; loc timestamp; d date;
  w_start timestamp; w_end timestamp; slots timestamp[]; i int; car text;
begin
  for c in select * from companies where fuel_reminders and coalesce(status, 'activ') <> 'suspendat' loop
    tz := coalesce(c.timezone, 'Europe/Bucharest');
    loc := now() at time zone tz; d := loc::date;
    for e in
      select emp.id, emp.full_name, emp.default_vehicle_id, emp.work_days
      from employees emp
      where emp.company_id = c.id and emp.is_driver and coalesce(emp.active, true)
        and exists (select 1 from memberships m where m.employee_id = emp.id and m.company_id = c.id)
        and not exists (select 1 from absences a where a.employee_id = emp.id and d between a.start_date and a.end_date)
        and (exists (select 1 from assignments a where a.employee_id = emp.id and a.status <> 'anulata'
                      and (a.starts_at at time zone tz)::date = d)
             or exists (select 1 from trips t where t.employee_id = emp.id and t.trip_date = d))
    loop
      select min(a.starts_at at time zone tz), max(a.ends_at at time zone tz) into w_start, w_end
      from assignments a where a.employee_id = e.id and a.status <> 'anulata' and (a.starts_at at time zone tz)::date = d;
      if w_start is null or w_end is null or w_end <= w_start then
        w_start := d + coalesce(c.default_work_start, time '08:00');
        w_end := d + coalesce(c.default_work_end, time '17:00');
      end if;
      slots := array[w_start + interval '30 minutes', w_start + (w_end - w_start) / 2, w_end - interval '45 minutes'];
      for i in 1..3 loop
        if loc >= slots[i] and loc < slots[i] + interval '40 minutes'
           and not exists (select 1 from fuel_reminder_log l where l.employee_id = e.id and l.day = d and l.slot = i) then
          insert into fuel_reminder_log(employee_id, day, slot) values (e.id, d, i) on conflict do nothing;
          select v.name || coalesce(' · ' || v.plate, '') into car from vehicles v
          where v.id = coalesce(
            (select t.vehicle_id from trips t where t.employee_id = e.id and t.trip_date = d order by t.started_at desc limit 1),
            e.default_vehicle_id);
          begin
            perform notify_users(c.id,
              array(select m.user_id from memberships m where m.employee_id = e.id and m.company_id = c.id),
              '⛽ Verifică combustibilul',
              coalesce(car || ': ', '') || 'uită-te la nivelul de combustibil. Dacă e sub un sfert, alimentează la prima ocazie.',
              '/astazi', 'combustibil', true);
            n := n + 1;
          exception when others then null;
          end;
        end if;
      end loop;
    end loop;
  end loop;
  delete from fuel_reminder_log where day < current_date - 7;
  return n;
end $$;
revoke execute on function fuel_reminders_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dyas_fuel_reminders';
    perform cron.schedule('dyas_fuel_reminders', '*/10 * * * *', 'select public.fuel_reminders_tick()');
  end if;
end $$;

notify pgrst, 'reload schema';
