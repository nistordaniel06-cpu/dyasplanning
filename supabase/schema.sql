-- =====================================================================
-- DYASPlanning — schema Supabase (PostgreSQL)
-- Rulează acest fișier o singură dată în Supabase → SQL Editor.
-- Conține: tabele, constrângeri, permisiuni (RLS), funcții RPC, audit.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- Tipuri
-- ---------------------------------------------------------------------
do $$ begin
  create type app_role as enum ('admin', 'sef_echipa', 'angajat');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_status as enum ('planificata', 'in_desfasurare', 'suspendata', 'finalizata', 'anulata');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum ('neinceputa', 'in_lucru', 'blocata', 'finalizata');
exception when duplicate_object then null; end $$;

do $$ begin
  create type assignment_status as enum ('planificata', 'confirmata', 'anulata');
exception when duplicate_object then null; end $$;

do $$ begin
  create type time_entry_status as enum ('ciorna', 'trimis', 'aprobat', 'respins');
exception when duplicate_object then null; end $$;

do $$ begin
  create type absence_type as enum ('concediu', 'medical', 'absent', 'alt_motiv');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- Firmă și utilizatori
-- ---------------------------------------------------------------------
create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  timezone text not null default 'Europe/Bucharest',
  travel_buffer_minutes int not null default 30 check (travel_buffer_minutes between 0 and 240),
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  leader_employee_id uuid,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  phone text,
  trade text,                                   -- meserie
  skills text[] not null default '{}',          -- competențe
  team_id uuid references teams(id) on delete set null,
  user_id uuid unique,                          -- null = angajat fără cont
  work_start time not null default '08:00',     -- program obișnuit
  work_end time not null default '16:00',
  work_days int[] not null default '{1,2,3,4,5}', -- 1=luni … 7=duminică
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);

alter table teams drop constraint if exists teams_leader_fk;
alter table teams add constraint teams_leader_fk
  foreign key (leader_employee_id) references employees(id) on delete set null;

create table if not exists memberships (
  user_id uuid primary key,                     -- auth.users.id (un cont = o firmă în v1)
  company_id uuid not null references companies(id) on delete cascade,
  role app_role not null default 'angajat',
  employee_id uuid references employees(id) on delete set null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  code text not null unique,
  role app_role not null default 'angajat',
  employee_id uuid references employees(id) on delete cascade,
  created_by uuid,
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists absences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  type absence_type not null default 'concediu',
  start_date date not null,
  end_date date not null,
  note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- ---------------------------------------------------------------------
-- Lucrări, misiuni, alocări
-- ---------------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  client_name text,
  contact_name text,
  contact_phone text,
  address text,
  city text,
  start_date date,
  due_date date,
  manager_employee_id uuid references employees(id) on delete set null,
  status project_status not null default 'planificata',
  color text not null default '#2563eb',
  created_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  status task_status not null default 'neinceputa',
  progress int not null default 0 check (progress between 0 and 100),
  due_date date,
  created_at timestamptz not null default now()
);

create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes int not null default 0 check (break_minutes >= 0),
  status assignment_status not null default 'planificata',
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '24 hours'),
  check (break_minutes * interval '1 minute' < ends_at - starts_at),
  -- Un angajat nu poate avea două alocări active care se suprapun.
  constraint assignments_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status <> 'anulata')
);

-- ---------------------------------------------------------------------
-- Pontaje (ore efectiv lucrate) — separate de planificare
-- ---------------------------------------------------------------------
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  project_id uuid not null references projects(id) on delete restrict,
  task_id uuid references tasks(id) on delete set null,
  assignment_id uuid references assignments(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  break_minutes int not null default 0 check (break_minutes >= 0),   -- pauze neplătite
  worked_minutes int generated always as (
    (extract(epoch from (ended_at - started_at)) / 60)::int - break_minutes
  ) stored,
  status time_entry_status not null default 'ciorna',
  notes text,
  rejection_reason text,
  flag_note text,                              -- semnalare de la șeful de echipă
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at > started_at),
  check (ended_at - started_at <= interval '24 hours'),
  check (break_minutes * interval '1 minute' < ended_at - started_at),
  constraint time_entries_reject_reason check (status <> 'respins' or coalesce(length(trim(rejection_reason)), 0) > 0),
  constraint time_entries_no_overlap exclude using gist (
    employee_id with =,
    tstzrange(started_at, ended_at, '[)') with &&
  ) where (status <> 'respins')
);

create table if not exists time_entry_history (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  time_entry_id uuid not null,
  action text not null,                        -- creat / modificat / trimis / aprobat / respins / corectat / sters
  changed_by uuid,
  reason text,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Observații (lucrare / misiune)
-- ---------------------------------------------------------------------
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete cascade,
  author_user_id uuid,
  author_name text,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

-- Indexuri
create index if not exists idx_employees_company on employees(company_id);
create index if not exists idx_projects_company on projects(company_id);
create index if not exists idx_tasks_project on tasks(project_id);
create index if not exists idx_assignments_company_time on assignments(company_id, starts_at);
create index if not exists idx_assignments_employee_time on assignments(employee_id, starts_at);
create index if not exists idx_time_entries_company_time on time_entries(company_id, started_at);
create index if not exists idx_time_entries_employee on time_entries(employee_id, started_at);
create index if not exists idx_absences_employee on absences(employee_id, start_date);
create index if not exists idx_history_entry on time_entry_history(time_entry_id);

-- ---------------------------------------------------------------------
-- Funcții ajutătoare (contextul utilizatorului curent)
-- ---------------------------------------------------------------------
create or replace function app_company_id() returns uuid
language sql stable security definer set search_path = public as $$
  select company_id from memberships where user_id = auth.uid()
$$;

create or replace function app_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from memberships where user_id = auth.uid()
$$;

create or replace function app_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from memberships where user_id = auth.uid()
$$;

create or replace function app_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from memberships where user_id = auth.uid()), false)
$$;

-- Angajații pe care șeful de echipă curent îi coordonează (inclusiv el însuși).
create or replace function app_led_employee_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.id from employees e
  join teams t on t.id = e.team_id
  where t.leader_employee_id = app_employee_id()
    and e.company_id = app_company_id()
  union
  select app_employee_id() where app_employee_id() is not null
$$;

-- Lucrările de care răspunde șeful de echipă: unde e responsabil
-- sau unde are alocați oameni din echipa lui.
create or replace function app_led_project_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from projects p
  where p.company_id = app_company_id()
    and (p.manager_employee_id = app_employee_id()
         or exists (select 1 from assignments a
                    where a.project_id = p.id
                      and a.employee_id in (select app_led_employee_ids())))
$$;

-- Lucrările vizibile pentru angajatul curent (unde are alocări sau pontaje).
create or replace function app_my_project_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct project_id from assignments where employee_id = app_employee_id()
  union
  select distinct project_id from time_entries where employee_id = app_employee_id()
$$;

create or replace function app_can_see_project(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case app_role()
    when 'admin' then exists (select 1 from projects where id = p and company_id = app_company_id())
    when 'sef_echipa' then p in (select app_led_project_ids()) or p in (select app_my_project_ids())
    when 'angajat' then p in (select app_my_project_ids())
    else false end
$$;

-- ---------------------------------------------------------------------
-- Integritate: toate referințele trebuie să fie din aceeași firmă
-- ---------------------------------------------------------------------
create or replace function check_same_company() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new);
begin
  if j ? 'employee_id' and tg_table_name <> 'employees' then
    if not exists (select 1 from employees where id = (j->>'employee_id')::uuid and company_id = new.company_id) then
      raise exception 'Angajatul nu aparține acestei firme.' using errcode = '42501';
    end if;
  end if;
  if j ? 'project_id' then
    if not exists (select 1 from projects where id = (j->>'project_id')::uuid and company_id = new.company_id) then
      raise exception 'Lucrarea nu aparține acestei firme.' using errcode = '42501';
    end if;
  end if;
  if j ? 'task_id' and j->>'task_id' is not null then
    if not exists (select 1 from tasks where id = (j->>'task_id')::uuid and project_id = (j->>'project_id')::uuid) then
      raise exception 'Misiunea nu aparține lucrării selectate.' using errcode = '23514';
    end if;
  end if;
  if j ? 'team_id' and j->>'team_id' is not null then
    if not exists (select 1 from teams where id = (j->>'team_id')::uuid and company_id = new.company_id) then
      raise exception 'Echipa nu aparține acestei firme.' using errcode = '42501';
    end if;
  end if;
  if j ? 'manager_employee_id' and j->>'manager_employee_id' is not null then
    if not exists (select 1 from employees where id = (j->>'manager_employee_id')::uuid and company_id = new.company_id) then
      raise exception 'Responsabilul nu aparține acestei firme.' using errcode = '42501';
    end if;
  end if;
  if j ? 'assignment_id' and j->>'assignment_id' is not null then
    if not exists (select 1 from assignments where id = (j->>'assignment_id')::uuid and company_id = new.company_id) then
      raise exception 'Alocarea nu aparține acestei firme.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_same_company on assignments;
create trigger trg_same_company before insert or update on assignments for each row execute function check_same_company();
drop trigger if exists trg_same_company on time_entries;
create trigger trg_same_company before insert or update on time_entries for each row execute function check_same_company();
drop trigger if exists trg_same_company on absences;
create trigger trg_same_company before insert or update on absences for each row execute function check_same_company();
drop trigger if exists trg_same_company on tasks;
create trigger trg_same_company before insert or update on tasks for each row execute function check_same_company();
drop trigger if exists trg_same_company on notes;
create trigger trg_same_company before insert or update on notes for each row execute function check_same_company();
drop trigger if exists trg_same_company on employees;
create trigger trg_same_company before insert or update on employees for each row execute function check_same_company();
drop trigger if exists trg_same_company on projects;
create trigger trg_same_company before insert or update on projects for each row execute function check_same_company();

-- Firma unui rând nu se poate schimba.
create or replace function lock_company_id() returns trigger
language plpgsql as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'Firma nu poate fi schimbată.' using errcode = '42501';
  end if;
  return new;
end $$;

do $$ declare t text; begin
  foreach t in array array['teams','employees','absences','projects','tasks','assignments','time_entries','notes','invites'] loop
    execute format('drop trigger if exists trg_lock_company on %I', t);
    execute format('create trigger trg_lock_company before update on %I for each row execute function lock_company_id()', t);
  end loop;
end $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_touch on assignments;
create trigger trg_touch before update on assignments for each row execute function touch_updated_at();
drop trigger if exists trg_touch on time_entries;
create trigger trg_touch before update on time_entries for each row execute function touch_updated_at();

-- La revocarea accesului, fișa angajatului rămâne (cu istoricul), dar se dezleagă de cont.
create or replace function memberships_unlink_employee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update employees set user_id = null where user_id = old.user_id and company_id = old.company_id;
  return old;
end $$;
drop trigger if exists trg_memberships_unlink on memberships;
create trigger trg_memberships_unlink after delete on memberships for each row execute function memberships_unlink_employee();

-- ---------------------------------------------------------------------
-- Reguli pentru pontaje (fluxul de status + corecții autorizate)
-- ---------------------------------------------------------------------
create or replace function time_entries_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_admin boolean := app_is_admin();
  is_correction boolean := coalesce(current_setting('app.correction', true), '') = 'on';
  me uuid := app_employee_id();
begin
  -- Apelurile din backend fără utilizator (ex. service role) nu sunt restricționate.
  if auth.uid() is null then return new; end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if not is_admin then
      if new.employee_id is distinct from me then
        raise exception 'Poți înregistra ore doar pentru tine.' using errcode = '42501';
      end if;
      if new.status not in ('ciorna', 'trimis') then
        raise exception 'Pontajul poate fi salvat doar ca ciornă sau trimis.' using errcode = '42501';
      end if;
      new.reviewed_by := null; new.reviewed_at := null; new.rejection_reason := null; new.flag_note := null;
    end if;
    if new.status = 'trimis' then new.submitted_at := now(); end if;
    if new.status = 'aprobat' then new.reviewed_by := auth.uid(); new.reviewed_at := now(); end if;
    return new;
  end if;

  -- UPDATE prin flag_time_entry: se poate schimba doar semnalarea
  if coalesce(current_setting('app.flagging', true), '') = 'on' then
    if (to_jsonb(new) - 'flag_note' - 'updated_at' - 'worked_minutes') is distinct from (to_jsonb(old) - 'flag_note' - 'updated_at' - 'worked_minutes') then
      raise exception 'Semnalarea poate modifica doar nota.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.employee_id is distinct from old.employee_id and not is_admin then
    raise exception 'Nu poți muta pontajul pe alt angajat.' using errcode = '42501';
  end if;

  if old.status = 'aprobat' and not is_correction then
    if new.started_at is distinct from old.started_at or new.ended_at is distinct from old.ended_at
       or new.break_minutes is distinct from old.break_minutes or new.project_id is distinct from old.project_id
       or new.task_id is distinct from old.task_id or new.employee_id is distinct from old.employee_id
       or new.status is distinct from old.status then
      raise exception 'Pontajul aprobat poate fi corectat doar de administrator, cu motiv.' using errcode = '42501';
    end if;
  end if;

  if not is_admin then
    -- Angajatul: poate edita ciorna / respins și poate trimite; nu aprobă.
    if old.status not in ('ciorna', 'respins', 'trimis') then
      raise exception 'Pontajul nu mai poate fi modificat.' using errcode = '42501';
    end if;
    if new.status not in ('ciorna', 'trimis') then
      raise exception 'Doar administratorul poate aproba sau respinge pontaje.' using errcode = '42501';
    end if;
    if old.status = 'trimis' and new.status = 'trimis' and (
         new.started_at is distinct from old.started_at or new.ended_at is distinct from old.ended_at
         or new.break_minutes is distinct from old.break_minutes) then
      raise exception 'Retrage pontajul în ciornă înainte de a-l modifica.' using errcode = '42501';
    end if;
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    new.flag_note := old.flag_note;
    if new.status = 'trimis' then new.rejection_reason := null; else new.rejection_reason := old.rejection_reason; end if;
  else
    if new.status in ('aprobat', 'respins') and new.status is distinct from old.status then
      new.reviewed_by := auth.uid(); new.reviewed_at := now();
    end if;
    if new.status = 'trimis' and old.status <> 'trimis' then new.rejection_reason := null; end if;
  end if;

  if new.status = 'trimis' and old.status <> 'trimis' then new.submitted_at := now(); end if;
  return new;
end $$;

drop trigger if exists trg_time_entries_guard on time_entries;
create trigger trg_time_entries_guard before insert or update on time_entries
  for each row execute function time_entries_guard();

create or replace function time_entries_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare act text; rsn text := nullif(current_setting('app.change_reason', true), '');
begin
  if tg_op = 'INSERT' then
    insert into time_entry_history(company_id, time_entry_id, action, changed_by, new_data)
    values (new.company_id, new.id, 'creat', auth.uid(), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into time_entry_history(company_id, time_entry_id, action, changed_by, old_data)
    values (old.company_id, old.id, 'sters', auth.uid(), to_jsonb(old));
    return old;
  end if;
  act := case
    when coalesce(current_setting('app.correction', true), '') = 'on' then 'corectat'
    when coalesce(current_setting('app.flagging', true), '') = 'on' then 'semnalat'
    when new.status <> old.status then new.status::text
    else 'modificat' end;
  if act = 'respins' then rsn := new.rejection_reason; end if;
  insert into time_entry_history(company_id, time_entry_id, action, changed_by, reason, old_data, new_data)
  values (new.company_id, new.id, act, auth.uid(), rsn, to_jsonb(old), to_jsonb(new));
  return new;
end $$;

drop trigger if exists trg_time_entries_audit on time_entries;
create trigger trg_time_entries_audit after insert or update or delete on time_entries
  for each row execute function time_entries_audit();

-- ---------------------------------------------------------------------
-- RLS — izolarea firmelor și permisiunile pe roluri
-- ---------------------------------------------------------------------
alter table companies enable row level security;
alter table teams enable row level security;
alter table employees enable row level security;
alter table memberships enable row level security;
alter table invites enable row level security;
alter table absences enable row level security;
alter table projects enable row level security;
alter table tasks enable row level security;
alter table assignments enable row level security;
alter table time_entries enable row level security;
alter table time_entry_history enable row level security;
alter table notes enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- companies
create policy companies_select on companies for select using (id = app_company_id());
create policy companies_update on companies for update using (id = app_company_id() and app_is_admin())
  with check (id = app_company_id());

-- teams: toți membrii firmei le văd; doar adminul le modifică
create policy teams_select on teams for select using (company_id = app_company_id());
create policy teams_write on teams for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

-- employees: adminul vede tot; șeful vede echipa lui + colegii de pe lucrările lui; angajatul se vede pe sine și colegii de alocare
create policy employees_select on employees for select using (
  company_id = app_company_id() and (
    app_is_admin()
    or id = app_employee_id()
    or (app_role() = 'sef_echipa' and id in (select app_led_employee_ids()))
    or id in (select a.employee_id from assignments a where a.project_id in (select app_my_project_ids()))
    or (app_role() = 'sef_echipa' and id in (select a.employee_id from assignments a where a.project_id in (select app_led_project_ids())))
  ));
create policy employees_write on employees for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

-- memberships: fiecare își vede rândul; adminul vede și modifică rolurile din firmă
create policy memberships_select on memberships for select using (
  user_id = auth.uid() or (company_id = app_company_id() and app_is_admin()));
create policy memberships_update on memberships for update using (company_id = app_company_id() and app_is_admin() and user_id <> auth.uid())
  with check (company_id = app_company_id());
create policy memberships_delete on memberships for delete using (company_id = app_company_id() and app_is_admin() and user_id <> auth.uid());

-- invites: doar adminul
create policy invites_all on invites for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

-- absences
create policy absences_select on absences for select using (
  company_id = app_company_id() and (app_is_admin() or employee_id = app_employee_id()
    or (app_role() = 'sef_echipa' and employee_id in (select app_led_employee_ids()))));
create policy absences_write on absences for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

-- projects
create policy projects_select on projects for select using (company_id = app_company_id() and app_can_see_project(id));
create policy projects_write on projects for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

-- tasks (progresul se actualizează prin RPC update_task_progress)
create policy tasks_select on tasks for select using (company_id = app_company_id() and app_can_see_project(project_id));
create policy tasks_write on tasks for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

-- assignments: doar adminul modifică; ceilalți văd ce îi privește
create policy assignments_select on assignments for select using (
  company_id = app_company_id() and (
    app_is_admin()
    or employee_id = app_employee_id()
    or project_id in (select app_my_project_ids())
    or (app_role() = 'sef_echipa' and (employee_id in (select app_led_employee_ids()) or project_id in (select app_led_project_ids())))
  ));
create policy assignments_write on assignments for all using (company_id = app_company_id() and app_is_admin())
  with check (company_id = app_company_id() and app_is_admin());

-- time_entries
create policy time_entries_select on time_entries for select using (
  company_id = app_company_id() and (
    app_is_admin() or employee_id = app_employee_id()
    or (app_role() = 'sef_echipa' and employee_id in (select app_led_employee_ids()))));
create policy time_entries_insert on time_entries for insert with check (
  company_id = app_company_id() and (app_is_admin() or employee_id = app_employee_id()));
create policy time_entries_update on time_entries for update using (
  company_id = app_company_id() and (app_is_admin() or employee_id = app_employee_id()))
  with check (company_id = app_company_id() and (app_is_admin() or employee_id = app_employee_id()));
create policy time_entries_delete on time_entries for delete using (
  company_id = app_company_id() and (
    (app_is_admin() and status <> 'aprobat')
    or (employee_id = app_employee_id() and status = 'ciorna')));

create policy history_select on time_entry_history for select using (
  company_id = app_company_id() and (
    app_is_admin()
    or time_entry_id in (select id from time_entries where employee_id = app_employee_id())
    or (app_role() = 'sef_echipa' and time_entry_id in (select id from time_entries where employee_id in (select app_led_employee_ids())))));

-- notes
create policy notes_select on notes for select using (company_id = app_company_id() and app_can_see_project(project_id));
create policy notes_insert on notes for insert with check (
  company_id = app_company_id() and app_can_see_project(project_id) and author_user_id = auth.uid());
create policy notes_delete on notes for delete using (
  company_id = app_company_id() and (app_is_admin() or author_user_id = auth.uid()));

-- ---------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------

-- Creează firma la primul cont; utilizatorul devine administrator.
create or replace function create_company(p_name text, p_timezone text default 'Europe/Bucharest', p_admin_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; eid uuid;
begin
  if auth.uid() is null then raise exception 'Trebuie să fii autentificat.' using errcode = '42501'; end if;
  if exists (select 1 from memberships where user_id = auth.uid()) then
    raise exception 'Contul tău aparține deja unei firme.' using errcode = '23505';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Fus orar invalid: %', p_timezone using errcode = '22023';
  end if;
  insert into companies(name, timezone) values (trim(p_name), p_timezone) returning id into cid;
  if coalesce(trim(p_admin_name), '') <> '' then
    insert into employees(company_id, full_name, user_id, trade) values (cid, trim(p_admin_name), auth.uid(), 'Administrator')
    returning id into eid;
  end if;
  insert into memberships(user_id, company_id, role, employee_id, display_name)
  values (auth.uid(), cid, 'admin', eid, nullif(trim(p_admin_name), ''));
  return cid;
end $$;

-- Generează un cod de invitație pentru un angajat (doar admin).
create or replace function create_invite(p_employee_id uuid, p_role app_role default 'angajat')
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not app_is_admin() then raise exception 'Doar administratorul poate invita.' using errcode = '42501'; end if;
  if p_employee_id is not null and not exists (select 1 from employees where id = p_employee_id and company_id = app_company_id()) then
    raise exception 'Angajat inexistent.' using errcode = '42501';
  end if;
  if p_employee_id is not null and exists (select 1 from employees where id = p_employee_id and user_id is not null) then
    raise exception 'Angajatul are deja cont.' using errcode = '23505';
  end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into invites(company_id, code, role, employee_id, created_by)
  values (app_company_id(), c, p_role, p_employee_id, auth.uid());
  return c;
end $$;

-- Folosește codul de invitație: leagă contul de firmă și de fișa angajatului.
create or replace function accept_invite(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Trebuie să fii autentificat.' using errcode = '42501'; end if;
  if exists (select 1 from memberships where user_id = auth.uid()) then
    raise exception 'Contul tău aparține deja unei firme.' using errcode = '23505';
  end if;
  select * into inv from invites where code = upper(trim(p_code)) for update;
  if not found then raise exception 'Cod de invitație invalid.' using errcode = '22023'; end if;
  if inv.used_at is not null then raise exception 'Codul a fost deja folosit.' using errcode = '22023'; end if;
  if inv.expires_at < now() then raise exception 'Codul a expirat.' using errcode = '22023'; end if;
  insert into memberships(user_id, company_id, role, employee_id, display_name)
  values (auth.uid(), inv.company_id, inv.role, inv.employee_id,
          (select full_name from employees where id = inv.employee_id));
  if inv.employee_id is not null then
    update employees set user_id = auth.uid() where id = inv.employee_id;
  end if;
  update invites set used_at = now(), used_by = auth.uid() where id = inv.id;
  return inv.company_id;
end $$;

-- Actualizarea progresului unei misiuni (admin, șef de echipă pe lucrările lui, angajat alocat).
create or replace function update_task_progress(p_task_id uuid, p_progress int, p_status task_status, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare t tasks%rowtype; allowed boolean;
begin
  select * into t from tasks where id = p_task_id and company_id = app_company_id();
  if not found then raise exception 'Misiune inexistentă.' using errcode = '42501'; end if;
  allowed := app_is_admin()
    or (app_role() = 'sef_echipa' and t.project_id in (select app_led_project_ids()))
    or exists (select 1 from assignments a where a.task_id = t.id and a.employee_id = app_employee_id() and a.status <> 'anulata');
  if not allowed then raise exception 'Nu ai dreptul să actualizezi această misiune.' using errcode = '42501'; end if;
  if p_progress < 0 or p_progress > 100 then raise exception 'Progresul trebuie să fie între 0 și 100.' using errcode = '22023'; end if;
  update tasks set progress = p_progress, status = p_status where id = t.id;
  if coalesce(trim(p_note), '') <> '' then
    insert into notes(company_id, project_id, task_id, author_user_id, author_name, body)
    values (t.company_id, t.project_id, t.id, auth.uid(),
            (select coalesce(m.display_name, e.full_name) from memberships m left join employees e on e.id = m.employee_id where m.user_id = auth.uid()),
            trim(p_note));
  end if;
end $$;

-- Semnalarea unei probleme la un pontaj (șef de echipă sau admin).
create or replace function flag_time_entry(p_entry_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare te time_entries%rowtype;
begin
  select * into te from time_entries where id = p_entry_id and company_id = app_company_id();
  if not found then raise exception 'Pontaj inexistent.' using errcode = '42501'; end if;
  if not (app_is_admin() or (app_role() = 'sef_echipa' and te.employee_id in (select app_led_employee_ids()))) then
    raise exception 'Nu ai dreptul să semnalezi acest pontaj.' using errcode = '42501';
  end if;
  perform set_config('app.change_reason', coalesce(p_note, ''), true);
  perform set_config('app.flagging', 'on', true);
  update time_entries set flag_note = nullif(trim(p_note), '') where id = te.id;
  perform set_config('app.flagging', 'off', true);
end $$;

-- Corectarea unui pontaj aprobat (doar admin, cu motiv obligatoriu).
create or replace function correct_approved_time_entry(
  p_entry_id uuid, p_started_at timestamptz, p_ended_at timestamptz, p_break_minutes int, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_is_admin() then raise exception 'Doar administratorul poate corecta pontaje aprobate.' using errcode = '42501'; end if;
  if coalesce(length(trim(p_reason)), 0) < 3 then raise exception 'Motivul corecției este obligatoriu.' using errcode = '22023'; end if;
  if not exists (select 1 from time_entries where id = p_entry_id and company_id = app_company_id() and status = 'aprobat') then
    raise exception 'Pontajul nu există sau nu este aprobat.' using errcode = '22023';
  end if;
  perform set_config('app.correction', 'on', true);
  perform set_config('app.change_reason', trim(p_reason), true);
  update time_entries set started_at = p_started_at, ended_at = p_ended_at, break_minutes = p_break_minutes,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_entry_id;
  perform set_config('app.correction', 'off', true);
end $$;

-- Lista utilizatorilor firmei (pentru Setări).
create or replace function company_users()
returns table(user_id uuid, role app_role, employee_id uuid, display_name text, email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, m.role, m.employee_id, coalesce(m.display_name, e.full_name),
         (select u.email::text from auth.users u where u.id = m.user_id), m.created_at
  from memberships m left join employees e on e.id = m.employee_id
  where m.company_id = app_company_id() and app_is_admin()
  order by m.created_at
$$;

-- Permisiuni pentru rolurile Supabase
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on time_entry_history from authenticated;
grant select on time_entry_history to authenticated;
revoke insert, delete on companies from authenticated;
revoke insert on memberships from authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
