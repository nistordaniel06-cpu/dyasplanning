-- 014: Proprietarul aplicației
--   1) modifică orice firmă (nume, fus orar, program implicit);
--   2) aplicații separate pe firmă: nume, link propriu și culori.

-- ---------- 2) Aplicația firmei ----------
alter table companies add column if not exists app_name text;
alter table companies add column if not exists app_slug text;
alter table companies add column if not exists brand_color text;
alter table companies drop constraint if exists companies_app_slug_format;
alter table companies add constraint companies_app_slug_format check (app_slug is null or app_slug ~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$');
alter table companies drop constraint if exists companies_brand_color_format;
alter table companies add constraint companies_brand_color_format check (brand_color is null or brand_color ~ '^#[0-9a-f]{6}$');
alter table companies drop constraint if exists companies_app_name_len;
alter table companies add constraint companies_app_name_len check (app_name is null or length(trim(app_name)) between 2 and 40);
create unique index if not exists companies_app_slug_key on companies(app_slug) where app_slug is not null;

-- numele și culorile aplicației după link (pagina de autentificare, înainte de cont)
create or replace function app_brand(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object('name', coalesce(app_name, 'DYASPlanning'), 'color', brand_color, 'slug', app_slug)
  from companies where app_slug = lower(trim(p_slug)) and status <> 'suspendat'
$$;

-- ---------- 1) Modificarea firmei de către proprietar ----------
create or replace function owner_edit_company(p_company uuid, p_name text, p_timezone text,
  p_work_start time, p_work_end time, p_break int, p_app_name text, p_app_slug text, p_brand_color text)
returns void language plpgsql security definer set search_path = public as $$
declare slug text := nullif(lower(trim(p_app_slug)), ''); color text := nullif(lower(trim(p_brand_color)), '');
begin
  perform owner_guard();
  if coalesce(length(trim(p_name)), 0) < 2 then raise exception 'Numele firmei e prea scurt.' using errcode = '22023'; end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Fus orar necunoscut.' using errcode = '22023';
  end if;
  if p_work_start is null or p_work_end is null or p_work_end <= p_work_start then
    raise exception 'Programul trebuie să se termine după ce începe.' using errcode = '22023';
  end if;
  if p_break is null or p_break < 0 or p_break * interval '1 minute' >= p_work_end - p_work_start then
    raise exception 'Pauza trebuie să fie mai scurtă decât programul.' using errcode = '22023';
  end if;
  if slug is not null and slug !~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$' then
    raise exception 'Linkul poate avea doar litere mici, cifre și cratimă (3–40 de caractere).' using errcode = '22023';
  end if;
  if slug is not null and exists (select 1 from companies where app_slug = slug and id <> p_company) then
    raise exception 'Linkul „%” e folosit deja de altă firmă.', slug using errcode = '23505';
  end if;
  if color is not null and color !~ '^#[0-9a-f]{6}$' then raise exception 'Culoare invalidă.' using errcode = '22023'; end if;
  update companies set name = trim(p_name), timezone = p_timezone,
    default_work_start = p_work_start, default_work_end = p_work_end, default_break_minutes = p_break,
    app_name = nullif(trim(p_app_name), ''), app_slug = slug, brand_color = color
  where id = p_company;
  if not found then raise exception 'Firma nu există.' using errcode = 'P0002'; end if;
end $$;

drop function if exists owner_companies();
create function owner_companies()
returns table (id uuid, name text, created_at timestamptz, timezone text, status text, plan text, trial_until date, owner_note text,
  admin_email text, users int, employees int, projects int, assignments_7d int, time_entries_7d int,
  last_sign_in timestamptz, last_city text, last_country text,
  default_work_start time, default_work_end time, default_break_minutes int, app_name text, app_slug text, brand_color text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform owner_guard();
  return query
  select c.id, c.name, c.created_at, c.timezone, c.status, c.plan, c.trial_until, c.owner_note,
    (select u.email::text from memberships m join auth.users u on u.id = m.user_id
      where m.company_id = c.id and m.role = 'admin' order by u.created_at limit 1),
    (select count(*)::int from memberships m where m.company_id = c.id),
    (select count(*)::int from employees e where e.company_id = c.id and coalesce(e.active, true)),
    (select count(*)::int from projects p where p.company_id = c.id),
    (select count(*)::int from assignments a where a.company_id = c.id and a.created_at > now() - interval '7 days'),
    (select count(*)::int from time_entries t where t.company_id = c.id and t.created_at > now() - interval '7 days'),
    greatest((select max(u.last_sign_in_at) from memberships m join auth.users u on u.id = m.user_id where m.company_id = c.id),
             (select max(l.at) from login_events l where l.company_id = c.id)),
    (select l.city from login_events l where l.company_id = c.id order by l.at desc limit 1),
    (select l.country from login_events l where l.company_id = c.id order by l.at desc limit 1),
    c.default_work_start, c.default_work_end, c.default_break_minutes, c.app_name, c.app_slug, c.brand_color
  from companies c
  order by c.created_at desc;
end $$;

revoke execute on function owner_edit_company(uuid, text, text, time, time, int, text, text, text), owner_companies() from public, anon;
grant execute on function owner_edit_company(uuid, text, text, time, time, int, text, text, text), owner_companies() to authenticated;
revoke execute on function app_brand(text) from public;
grant execute on function app_brand(text) to anon, authenticated;

