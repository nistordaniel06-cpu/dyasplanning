-- 011: Program implicit 07:00–16:00 cu 60 min pauză (= 8 ore lucrate), editabil pe firmă și pe fiecare angajat
alter table companies add column if not exists default_work_start time not null default '07:00';
alter table companies add column if not exists default_work_end time not null default '16:00';
alter table companies add column if not exists default_break_minutes int not null default 60;
do $$ begin
  alter table companies add constraint companies_default_break_chk check (default_break_minutes between 0 and 240);
exception when duplicate_object then null; end $$;

alter table employees add column if not exists break_minutes int not null default 60;
do $$ begin
  alter table employees add constraint employees_break_chk check (break_minutes between 0 and 240);
exception when duplicate_object then null; end $$;
alter table employees alter column work_start set default '07:00';
alter table employees alter column work_end set default '16:00';

-- angajații rămași pe vechiul program implicit (08:00–16:00) trec pe noul program implicit
update employees set work_start = '07:00', work_end = '16:00' where work_start = '08:00' and work_end = '16:00';

-- angajații noi primesc programul implicit al firmei din formular (precompletat)

-- adminul aplică programul implicit al firmei tuturor angajaților activi
create or replace function apply_default_schedule_to_all() returns int
language plpgsql security definer set search_path = public as $$
declare c companies; n int;
begin
  if not app_is_admin() or app_company_id() is null then
    raise exception 'Doar administratorul poate schimba programul angajaților.' using errcode = '42501';
  end if;
  select * into c from companies where id = app_company_id();
  update employees set work_start = c.default_work_start, work_end = c.default_work_end, break_minutes = c.default_break_minutes
  where company_id = c.id and active
    and (work_start, work_end, break_minutes) is distinct from (c.default_work_start, c.default_work_end, c.default_break_minutes);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function apply_default_schedule_to_all() from public, anon;
grant execute on function apply_default_schedule_to_all() to authenticated;
