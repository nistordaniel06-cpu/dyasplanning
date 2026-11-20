-- 026: Validarea zilnică a programului (șef de echipă + administrator) și lucrări extra la lucrări (poze + comentarii)

-- ================= Validare zilnică =================
alter table time_entries add column if not exists validated_by uuid;
alter table time_entries add column if not exists validated_at timestamptz;
alter table time_entries add column if not exists validated_role text check (validated_role is null or validated_role in ('admin', 'sef_echipa'));

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
    if coalesce(current_setting('app.leader_review', true), '') = 'on' then
      if new.status = 'trimis' then new.submitted_at := now(); end if;
      return new;
    end if;
    if not is_admin then
      if new.employee_id is distinct from me then
        raise exception 'Poți înregistra ore doar pentru tine.' using errcode = '42501';
      end if;
      if new.status not in ('ciorna', 'trimis') then
        raise exception 'Pontajul poate fi salvat doar ca ciornă sau trimis.' using errcode = '42501';
      end if;
      new.reviewed_by := null; new.reviewed_at := null; new.rejection_reason := null; new.flag_note := null;
      if coalesce(current_setting('app.leader_review', true), '') <> 'on' then new.validated_by := null; new.validated_at := null; new.validated_role := null; end if;
    end if;
    if new.status = 'trimis' then new.submitted_at := now(); end if;
    if new.status = 'aprobat' then new.reviewed_by := auth.uid(); new.reviewed_at := now(); end if;
    return new;
  end if;

  -- Validarea / corectarea făcută de șeful de echipă (prin funcțiile validate_day_entries / review_save_time_entry)
  if coalesce(current_setting('app.leader_review', true), '') = 'on' then
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    if new.status = 'trimis' and old.status <> 'trimis' then new.submitted_at := now(); end if;
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
    -- validarea nu o poate pune angajatul; dacă își schimbă orele sau retrage pontajul, validarea se pierde
    new.validated_by := old.validated_by; new.validated_at := old.validated_at; new.validated_role := old.validated_role;
    if new.status = 'ciorna' or new.started_at is distinct from old.started_at or new.ended_at is distinct from old.ended_at
       or new.break_minutes is distinct from old.break_minutes or new.project_id is distinct from old.project_id then
      new.validated_by := null; new.validated_at := null; new.validated_role := null;
    end if;
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


-- angajații pe care îi validează utilizatorul curent (admin: toți; șef: echipa lui)
create or replace function my_review_employee_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.id from employees e where e.company_id = app_company_id() and (
    app_is_admin() or (app_role() = 'sef_echipa' and e.id in (select app_led_employee_ids())))
$$;
revoke execute on function my_review_employee_ids() from public, anon;
grant execute on function my_review_employee_ids() to authenticated;

create or replace function review_guard(p_employee uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or app_company_id() is null then raise exception 'Trebuie să fii autentificat.' using errcode = '42501'; end if;
  if not (app_is_admin() or (app_role() = 'sef_echipa' and p_employee in (select app_led_employee_ids()))) then
    raise exception 'Poți valida doar programul oamenilor din echipa ta.' using errcode = '42501';
  end if;
end $$;
revoke execute on function review_guard(uuid) from public, anon;

-- Validează pontajele (programul e corect). Adminul le și aprobă.
create or replace function validate_day_entries(p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare te time_entries%rowtype; n int := 0; adm boolean := app_is_admin();
begin
  for te in select * from time_entries where id = any(p_ids) and company_id = app_company_id() loop
    perform review_guard(te.employee_id);
    if adm then
      if te.status = 'aprobat' then continue; end if;
      update time_entries set status = 'aprobat', validated_by = auth.uid(), validated_at = now(), validated_role = 'admin' where id = te.id;
    else
      if te.status = 'aprobat' then continue; end if;
      perform set_config('app.leader_review', 'on', true);
      update time_entries set status = 'trimis', rejection_reason = null, validated_by = auth.uid(), validated_at = now(), validated_role = 'sef_echipa' where id = te.id;
      perform set_config('app.leader_review', 'off', true);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function validate_day_entries(uuid[]) from public, anon;
grant execute on function validate_day_entries(uuid[]) to authenticated;

-- Corectează sau adaugă programul unui om (din validare). Rămâne validat de cel care a corectat.
create or replace function review_save_time_entry(p_id uuid, p_employee_id uuid, p_project_id uuid, p_task_id uuid,
  p_started_at timestamptz, p_ended_at timestamptz, p_break_minutes int, p_notes text default null, p_reason text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  te time_entries%rowtype; adm boolean := app_is_admin(); rid uuid; who text; tz text; d text;
begin
  perform review_guard(p_employee_id);
  if not exists (select 1 from projects where id = p_project_id and company_id = app_company_id()) then
    raise exception 'Alege lucrarea.' using errcode = '22023';
  end if;
  if p_ended_at <= p_started_at then raise exception 'Ora de final trebuie să fie după ora de început.' using errcode = '22023'; end if;
  perform set_config('app.change_reason', coalesce(nullif(trim(p_reason), ''), 'corectat la validarea zilei'), true);
  if p_id is not null then
    select * into te from time_entries where id = p_id and company_id = app_company_id();
    if not found then raise exception 'Pontaj inexistent.' using errcode = '22023'; end if;
    perform review_guard(te.employee_id);
    if te.status = 'aprobat' and not adm then raise exception 'Pontajul e deja aprobat de administrator.' using errcode = '42501'; end if;
    if te.status = 'aprobat' then perform set_config('app.correction', 'on', true); end if;
    perform set_config('app.leader_review', case when adm then 'off' else 'on' end, true);
    update time_entries set project_id = p_project_id, task_id = p_task_id, started_at = p_started_at, ended_at = p_ended_at,
      break_minutes = greatest(coalesce(p_break_minutes, 0), 0), notes = coalesce(nullif(trim(p_notes), ''), notes),
      status = case when adm then 'aprobat'::time_entry_status else 'trimis'::time_entry_status end, rejection_reason = null,
      validated_by = auth.uid(), validated_at = now(), validated_role = case when adm then 'admin' else 'sef_echipa' end
    where id = te.id returning id into rid;
  else
    perform set_config('app.leader_review', case when adm then 'off' else 'on' end, true);
    insert into time_entries(company_id, employee_id, project_id, task_id, started_at, ended_at, break_minutes, notes, status, validated_by, validated_at, validated_role)
    values (app_company_id(), p_employee_id, p_project_id, p_task_id, p_started_at, p_ended_at, greatest(coalesce(p_break_minutes, 0), 0),
      nullif(trim(p_notes), ''), case when adm then 'aprobat'::time_entry_status else 'trimis'::time_entry_status end,
      auth.uid(), now(), case when adm then 'admin' else 'sef_echipa' end)
    returning id into rid;
  end if;
  perform set_config('app.leader_review', 'off', true);
  perform set_config('app.correction', 'off', true);

  -- anunță angajatul că i s-a modificat programul
  begin
    select coalesce(e.full_name, 'Șeful de echipă') into who from employees e where e.id = app_employee_id();
    select coalesce(timezone, 'Europe/Bucharest') into tz from companies where id = app_company_id();
    d := to_char(p_started_at at time zone tz, 'DD.MM') || ': ' || to_char(p_started_at at time zone tz, 'HH24:MI') || '–' || to_char(p_ended_at at time zone tz, 'HH24:MI');
    perform notify_users(app_company_id(),
      array(select m.user_id from memberships m where m.employee_id = p_employee_id and m.company_id = app_company_id() and m.user_id <> auth.uid()),
      case when p_id is null then 'Ți s-a adăugat programul' else 'Ți s-a corectat programul' end,
      d || ' · ' || coalesce(who, 'administrator') || coalesce(' — ' || nullif(trim(p_reason), ''), ''), '/pontaj', 'pontaj', true);
  exception when others then null;
  end;
  return rid;
end $$;
revoke execute on function review_save_time_entry(uuid, uuid, uuid, uuid, timestamptz, timestamptz, int, text, text) from public, anon;
grant execute on function review_save_time_entry(uuid, uuid, uuid, uuid, timestamptz, timestamptz, int, text, text) to authenticated;

-- ================= Lucrări extra (în afara proiectului stabilit) =================
create table if not exists project_extras (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  extra_date date not null,
  body text not null check (length(trim(body)) between 1 and 2000),
  photos text[] not null default '{}',
  status text not null default 'nou' check (status in ('nou', 'confirmat', 'respins')),
  admin_note text,
  author_user_id uuid default auth.uid(),
  author_employee_id uuid references employees(id) on delete set null,
  author_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_project_extras_project on project_extras(project_id, created_at desc);
create index if not exists idx_project_extras_company on project_extras(company_id, created_at desc);
drop trigger if exists trg_lock_company on project_extras;
create trigger trg_lock_company before update on project_extras for each row execute function lock_company_id();
drop trigger if exists trg_touch on project_extras;
create trigger trg_touch before update on project_extras for each row execute function touch_updated_at();

create or replace function project_extras_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from projects where id = new.project_id and company_id = new.company_id) then
    raise exception 'Lucrarea nu aparține firmei.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.author_user_id := auth.uid();
    new.author_employee_id := app_employee_id();
    new.author_name := coalesce((select full_name from employees where id = app_employee_id()), 'Administrator');
    new.created_at := now();
    if not app_is_admin() then new.status := 'nou'; new.admin_note := null; end if;
  elsif not app_is_admin() then
    -- autorul își poate corecta textul și pozele, nu și starea
    new.status := old.status; new.admin_note := old.admin_note; new.project_id := old.project_id;
    new.author_user_id := old.author_user_id; new.author_employee_id := old.author_employee_id; new.author_name := old.author_name; new.created_at := old.created_at;
  end if;
  return new;
end $$;
drop trigger if exists trg_project_extras_before on project_extras;
create trigger trg_project_extras_before before insert or update on project_extras for each row execute function project_extras_before();

alter table project_extras enable row level security;
grant select, insert, update, delete on project_extras to authenticated;
drop policy if exists project_extras_select on project_extras;
drop policy if exists project_extras_insert on project_extras;
drop policy if exists project_extras_update on project_extras;
drop policy if exists project_extras_delete on project_extras;
create policy project_extras_select on project_extras for select using (company_id = app_company_id() and app_can_see_project(project_id));
create policy project_extras_insert on project_extras for insert with check (company_id = app_company_id() and app_can_see_project(project_id));
create policy project_extras_update on project_extras for update using (
  company_id = app_company_id() and (app_is_admin() or (author_user_id = auth.uid() and status = 'nou')))
  with check (company_id = app_company_id());
create policy project_extras_delete on project_extras for delete using (
  company_id = app_company_id() and (app_is_admin() or (author_user_id = auth.uid() and status = 'nou')));

-- anunță administratorii când cineva adaugă o lucrare extra
create or replace function trg_notify_extra() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify_users(new.company_id,
    array(select user_id from memberships where company_id = new.company_id and role = 'admin' and user_id is distinct from auth.uid()),
    'Lucrare extra: ' || coalesce((select name from projects where id = new.project_id), 'lucrare'),
    coalesce(new.author_name, '') || ': ' || left(new.body, 120) || case when cardinality(new.photos) > 0 then ' · 📷 ' || cardinality(new.photos) else '' end,
    '/extra/' || new.project_id, 'lucrare', true);
  return null;
exception when others then return null;
end $$;
drop trigger if exists trg_project_extras_notify on project_extras;
create trigger trg_project_extras_notify after insert on project_extras for each row execute function trg_notify_extra();

-- poze: bucket privat „lucrari”, cale <firmă>/<lucrare>/<fișier>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lucrari', 'lucrari', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "lucrari citire" on storage.objects;
create policy "lucrari citire" on storage.objects for select to authenticated using (
  bucket_id = 'lucrari' and (storage.foldername(name))[1] = app_company_id()::text
  and app_can_see_project(((storage.foldername(name))[2])::uuid));
drop policy if exists "lucrari incarcare" on storage.objects;
create policy "lucrari incarcare" on storage.objects for insert to authenticated with check (
  bucket_id = 'lucrari' and (storage.foldername(name))[1] = app_company_id()::text
  and app_can_see_project(((storage.foldername(name))[2])::uuid));
drop policy if exists "lucrari stergere" on storage.objects;
create policy "lucrari stergere" on storage.objects for delete to authenticated using (
  bucket_id = 'lucrari' and (storage.foldername(name))[1] = app_company_id()::text
  and (app_is_admin() or owner = auth.uid()));

notify pgrst, 'reload schema';
