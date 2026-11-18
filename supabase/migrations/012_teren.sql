-- 012: Funcții de teren
-- • pontaj cu buton „Am început / Am terminat” (ora + locația notate automat)
-- • poze la pontaj (dovadă pentru client)
-- • poze și mesaje vocale în chat
-- Fișierele stau în Supabase Storage, în bucket-uri private; accesul e verificat pe server.

-- ================= Pontaj: locații și sursă =================
alter table time_entries add column if not exists source text not null default 'manual';
do $$ begin
  alter table time_entries add constraint time_entries_source_chk check (source in ('manual', 'buton', 'offline'));
exception when duplicate_object then null; end $$;
alter table time_entries add column if not exists start_lat double precision;
alter table time_entries add column if not exists start_lon double precision;
alter table time_entries add column if not exists start_accuracy int;
alter table time_entries add column if not exists start_address text;
alter table time_entries add column if not exists end_lat double precision;
alter table time_entries add column if not exists end_lon double precision;
alter table time_entries add column if not exists end_accuracy int;
alter table time_entries add column if not exists end_address text;

-- ================= Pontaj cu buton: tura deschisă =================
create table if not exists time_clocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null unique references employees(id) on delete cascade,   -- o singură tură deschisă pe angajat
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  assignment_id uuid references assignments(id) on delete set null,
  started_at timestamptz not null,
  start_lat double precision, start_lon double precision, start_accuracy int, start_address text,
  created_at timestamptz not null default now()
);
alter table time_clocks enable row level security;
drop policy if exists time_clocks_select on time_clocks;
create policy time_clocks_select on time_clocks for select using (
  company_id = app_company_id() and (
    app_is_admin() or employee_id = app_employee_id()
    or (app_role() = 'sef_echipa' and employee_id in (select app_led_employee_ids()))));
-- scrierea se face doar prin funcțiile de mai jos
revoke insert, update, delete on time_clocks from anon, authenticated;
grant select on time_clocks to authenticated;

-- ora venită de pe telefon (inclusiv când a fost salvată fără semnal): acceptată doar dacă e plauzibilă
create or replace function clock_time(p_at timestamptz) returns timestamptz language sql stable as $$
  select case when p_at is null or p_at > now() + interval '5 minutes' or p_at < now() - interval '36 hours' then now() else p_at end
$$;

create or replace function clock_in(p_project uuid, p_task uuid default null, p_assignment uuid default null,
  p_lat double precision default null, p_lon double precision default null, p_accuracy int default null, p_address text default null,
  p_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := app_employee_id(); cid uuid := app_company_id(); id uuid;
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
  insert into time_clocks(company_id, employee_id, project_id, task_id, assignment_id, started_at, start_lat, start_lon, start_accuracy, start_address)
  values (cid, me, p_project, p_task, p_assignment, clock_time(p_at), p_lat, p_lon, p_accuracy, left(p_address, 300))
  returning time_clocks.id into id;
  return id;
end $$;

-- închide tura și creează pontajul (trimis spre aprobare)
create or replace function clock_out(p_break int default null, p_notes text default null,
  p_lat double precision default null, p_lon double precision default null, p_accuracy int default null, p_address text default null,
  p_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := app_employee_id(); c time_clocks; ended timestamptz; brk int; total int; eid uuid;
begin
  select * into c from time_clocks where employee_id = me;
  if not found then raise exception 'Nu ai nicio tură începută.' using errcode = 'P0002'; end if;
  ended := greatest(clock_time(p_at), c.started_at + interval '1 minute');
  if ended - c.started_at > interval '24 hours' then
    raise exception 'Tura a depășit 24 de ore. Anulează tura și adaugă orele manual.' using errcode = '22023';
  end if;
  total := (extract(epoch from (ended - c.started_at)) / 60)::int;
  brk := coalesce(p_break, (select break_minutes from employees where id = me), 0);
  if brk >= total then brk := 0; end if;  -- tură scurtă: fără pauză
  insert into time_entries(company_id, employee_id, project_id, task_id, assignment_id, started_at, ended_at, break_minutes,
    status, notes, source, start_lat, start_lon, start_accuracy, start_address, end_lat, end_lon, end_accuracy, end_address)
  values (c.company_id, me, c.project_id, c.task_id, c.assignment_id, c.started_at, ended, greatest(brk, 0),
    'trimis', nullif(trim(p_notes), ''), 'buton', c.start_lat, c.start_lon, c.start_accuracy, c.start_address,
    p_lat, p_lon, p_accuracy, left(p_address, 300))
  returning id into eid;
  delete from time_clocks where id = c.id;
  return eid;
end $$;

create or replace function clock_cancel() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from time_clocks where employee_id = app_employee_id();
end $$;

-- ================= Poze la pontaj =================
create table if not exists time_entry_photos (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  time_entry_id uuid not null references time_entries(id) on delete cascade,
  path text not null unique,
  taken_at timestamptz not null default now(),
  lat double precision, lon double precision,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists idx_te_photos_entry on time_entry_photos(time_entry_id);
alter table time_entry_photos enable row level security;
drop policy if exists te_photos_select on time_entry_photos;
create policy te_photos_select on time_entry_photos for select using (
  company_id = app_company_id() and (
    app_is_admin() or employee_id = app_employee_id()
    or (app_role() = 'sef_echipa' and employee_id in (select app_led_employee_ids()))));
drop policy if exists te_photos_insert on time_entry_photos;
create policy te_photos_insert on time_entry_photos for insert with check (
  company_id = app_company_id()
  and exists (select 1 from time_entries t where t.id = time_entry_id and t.employee_id = time_entry_photos.employee_id and t.company_id = app_company_id())
  and (app_is_admin() or employee_id = app_employee_id())
  and path like company_id::text || '/' || employee_id::text || '/%');
drop policy if exists te_photos_delete on time_entry_photos;
create policy te_photos_delete on time_entry_photos for delete using (
  company_id = app_company_id() and (app_is_admin() or (employee_id = app_employee_id()
    and exists (select 1 from time_entries t where t.id = time_entry_id and t.status <> 'aprobat'))));
grant select, insert, delete on time_entry_photos to authenticated;

-- ================= Chat: poze și mesaje vocale =================
alter table chat_messages add column if not exists attachment_path text;
alter table chat_messages add column if not exists attachment_type text;
alter table chat_messages add column if not exists attachment_duration int;
do $$ begin
  alter table chat_messages add constraint chat_messages_attachment_chk check (attachment_type is null or attachment_type in ('image', 'audio'));
exception when duplicate_object then null; end $$;

-- mesajul fără text, doar cu atașament, primește un text scurt (folosit în listă și în notificări)
create or replace function chat_messages_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  new.company_id := (select company_id from chat_channels where id = new.channel_id);
  new.author_name := (select coalesce(m.display_name, e.full_name, 'Utilizator') from memberships m left join employees e on e.id = m.employee_id where m.user_id = new.user_id);
  if new.attachment_path is not null then
    if new.attachment_path not like new.company_id::text || '/' || new.channel_id::text || '/%' then
      raise exception 'Atașament invalid.' using errcode = '42501';
    end if;
    if coalesce(trim(new.body), '') = '' then
      new.body := case new.attachment_type when 'audio' then '🎤 Mesaj vocal' else '📷 Poză' end;
    end if;
  end if;
  new.body := trim(new.body);
  new.created_at := now();
  return new;
end $$;

-- ================= Storage: bucket-uri private =================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pontaj', 'pontaj', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
       ('chat', 'chat', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/aac', 'audio/x-m4a'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- pontaj: <firmă>/<angajat>/<fișier>
drop policy if exists "pontaj citire" on storage.objects;
create policy "pontaj citire" on storage.objects for select to authenticated using (
  bucket_id = 'pontaj' and (storage.foldername(name))[1] = app_company_id()::text and (
    app_is_admin() or (storage.foldername(name))[2] = app_employee_id()::text
    or (app_role() = 'sef_echipa' and (storage.foldername(name))[2] in (select x::text from app_led_employee_ids() x))));
drop policy if exists "pontaj incarcare" on storage.objects;
create policy "pontaj incarcare" on storage.objects for insert to authenticated with check (
  bucket_id = 'pontaj' and (storage.foldername(name))[1] = app_company_id()::text
  and (app_is_admin() or (storage.foldername(name))[2] = app_employee_id()::text));
drop policy if exists "pontaj stergere" on storage.objects;
create policy "pontaj stergere" on storage.objects for delete to authenticated using (
  bucket_id = 'pontaj' and (storage.foldername(name))[1] = app_company_id()::text
  and (app_is_admin() or (storage.foldername(name))[2] = app_employee_id()::text));

-- chat: <firmă>/<conversație>/<fișier>, doar membrii conversației
drop policy if exists "chat citire" on storage.objects;
create policy "chat citire" on storage.objects for select to authenticated using (
  bucket_id = 'chat' and (storage.foldername(name))[1] = app_company_id()::text
  and app_can_access_channel(((storage.foldername(name))[2])::uuid));
drop policy if exists "chat incarcare" on storage.objects;
create policy "chat incarcare" on storage.objects for insert to authenticated with check (
  bucket_id = 'chat' and (storage.foldername(name))[1] = app_company_id()::text
  and app_can_access_channel(((storage.foldername(name))[2])::uuid));

revoke execute on function clock_in(uuid, uuid, uuid, double precision, double precision, int, text, timestamptz),
  clock_out(int, text, double precision, double precision, int, text, timestamptz), clock_cancel(), clock_time(timestamptz) from public, anon;
grant execute on function clock_in(uuid, uuid, uuid, double precision, double precision, int, text, timestamptz),
  clock_out(int, text, double precision, double precision, int, text, timestamptz), clock_cancel() to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table time_clocks; exception when duplicate_object then null; end;
  end if;
end $$;
