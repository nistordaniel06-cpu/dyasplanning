-- Jurnalul de activitate al proprietarului pe înțelesul tuturor:
-- fără nume tehnice de coloane (status, reviewed_at, reviewed_by…), fără id-uri și date în format ISO.

-- numele câmpurilor, în română
create or replace function activity_field_label(col text) returns text language sql immutable as $$
  select case col
    when 'name' then 'nume' when 'full_name' then 'nume' when 'phone' then 'telefon' when 'trade' then 'meserie'
    when 'skills' then 'competențe' when 'team_id' then 'echipa' when 'user_id' then 'cont în aplicație'
    when 'work_start' then 'început program' when 'work_end' then 'sfârșit program' when 'work_days' then 'zile lucrătoare'
    when 'active' then 'activ' when 'is_driver' then 'șofer' when 'default_vehicle_id' then 'mașina obișnuită'
    when 'status' then 'stare' when 'progress' then 'progres' when 'due_date' then 'termen'
    when 'starts_at' then 'început' when 'ends_at' then 'sfârșit' when 'started_at' then 'început' when 'ended_at' then 'sfârșit'
    when 'break_minutes' then 'pauză (min)' when 'task_id' then 'misiune' when 'project_id' then 'lucrare'
    when 'employee_id' then 'angajat' when 'notes' then 'observații' when 'note' then 'observații'
    when 'address' then 'adresă' when 'city' then 'localitate' when 'client_name' then 'client'
    when 'contact_name' then 'persoană de contact' when 'contact_phone' then 'telefon contact' when 'color' then 'culoare'
    when 'plate' then 'nr. înmatriculare' when 'start_date' then 'data de început' when 'end_date' then 'data de sfârșit'
    when 'type' then 'tip' when 'timezone' then 'fus orar' when 'travel_buffer_minutes' then 'timp de deplasare'
    when 'description' then 'descriere' when 'manager_employee_id' then 'responsabil' when 'leader_employee_id' then 'șef de echipă'
    when 'reject_reason' then 'motivul respingerii' when 'rejection_reason' then 'motivul respingerii'
    when 'flag_note' then 'problemă semnalată' when 'role' then 'rol'
    when 'reviewed_at' then 'verificat la' when 'reviewed_by' then 'verificat de'
    when 'validated_at' then 'validat la' when 'validated_by' then 'validat de' when 'validated_role' then 'validat ca'
    when 'submitted_at' then 'trimis la' when 'source' then 'mod de pontare'
    when 'start_address' then 'adresa la început' when 'end_address' then 'adresa la sfârșit'
    when 'assignment_id' then 'alocare' when 'display_name' then 'nume afișat'
    when 'default_work_start' then 'început program (implicit)' when 'default_work_end' then 'sfârșit program (implicit)'
    when 'default_break_minutes' then 'pauză implicită (min)' when 'fuel_reminders' then 'mementouri combustibil'
    when 'app_name' then 'numele aplicației' when 'brand_color' then 'culoarea firmei' when 'plan' then 'abonament'
    when 'trial_until' then 'perioadă de probă până la' when 'kind' then 'tip'
    when 'expires_at' then 'expiră la' when 'used_at' then 'folosită la' when 'used_by' then 'folosită de' when 'code' then 'cod'
    else replace(col, '_', ' ') end
$$;

-- coloane care nu spun nimic unui om (coordonate, precizie GPS) — nu apar în jurnal
create or replace function activity_hidden_field(col text) returns boolean language sql immutable as $$
  select col = any(array['id', 'company_id', 'created_at', 'updated_at', 'created_by', 'worked_minutes', 'search', 'fts',
    'start_lat', 'start_lon', 'end_lat', 'end_lon', 'start_accuracy', 'end_accuracy', 'gps_lat', 'gps_lon', 'gps_accuracy',
    'lat', 'lon', 'app_slug', 'last_backup_at'])
$$;

-- valori lizibile: id → nume, date → zz.ll.aaaa oo:mm, stări → cuvinte normale
create or replace function activity_value(col text, v jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare t text; u uuid;
begin
  if v is null or v = 'null'::jsonb then return '—'; end if;
  if jsonb_typeof(v) = 'boolean' then return case when v::text = 'true' then 'da' else 'nu' end; end if;
  t := case when jsonb_typeof(v) = 'string' then v #>> '{}' else v::text end;
  if t in ('—', '') then return '—'; end if;

  if t ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    u := t::uuid;
    if col in ('user_id', 'reviewed_by', 'validated_by', 'used_by', 'created_by') then
      t := coalesce((select coalesce(m.display_name, e.full_name) from memberships m left join employees e on e.id = m.employee_id
                     where m.user_id = u limit 1),
                    (select full_name from employees where user_id = u limit 1),
                    'un utilizator');
      if col = 'user_id' then t := 'cont legat'; end if;
    else
      t := coalesce(
        case when col in ('employee_id', 'manager_employee_id', 'leader_employee_id') then (select full_name from employees where id = u) end,
        case when col = 'project_id' then (select name from projects where id = u) end,
        case when col = 'task_id' then (select name from tasks where id = u) end,
        case when col = 'team_id' then (select name from teams where id = u) end,
        case when col = 'default_vehicle_id' then (select name || coalesce(' (' || plate || ')', '') from vehicles where id = u) end,
        '—');
    end if;
  elsif t ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then
    begin t := to_char((t::timestamptz) at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'); exception when others then null; end;
  elsif t ~ '^\d{4}-\d{2}-\d{2}$' then
    t := to_char(t::date, 'DD.MM.YYYY');
  elsif t ~ '^\d{2}:\d{2}:\d{2}$' then
    t := left(t, 5);
  else
    t := case t
      when 'ciorna' then 'ciornă' when 'trimis' then 'trimis spre aprobare' when 'aprobat' then 'aprobat' when 'respins' then 'respins'
      when 'planificata' then 'planificată' when 'in_desfasurare' then 'în desfășurare' when 'suspendata' then 'suspendată'
      when 'finalizata' then 'finalizată' when 'anulata' then 'anulată' when 'neinceputa' then 'neîncepută'
      when 'in_lucru' then 'în lucru' when 'blocata' then 'blocată' when 'confirmata' then 'confirmată'
      when 'admin' then 'administrator' when 'sef_echipa' then 'șef de echipă' when 'angajat' then 'angajat'
      when 'medical' then 'concediu medical' when 'alt_motiv' then 'alt motiv' when 'manual' then 'manual'
      else t end;
  end if;
  return left(t, 80);
end $$;

-- propoziția scurtă din jurnal
create or replace function activity_summary(actor text, tbl text, op text, n int, items jsonb) returns text
language plpgsql immutable as $$
declare
  ent_one text; ent_many text; verb text; lbl text; ch jsonb; st text; reason text; fields text;
  technical text[] := array['verificat la', 'verificat de', 'validat la', 'validat de', 'validat ca', 'trimis la'];
begin
  ent_one := case tbl
    when 'projects' then 'lucrarea' when 'tasks' then 'misiunea' when 'assignments' then 'alocarea'
    when 'employees' then 'angajatul' when 'teams' then 'echipa' when 'absences' then 'absența'
    when 'vehicles' then 'mașina' when 'time_entries' then 'pontajul' when 'invites' then 'invitația'
    when 'companies' then 'setările firmei' else tbl end;
  ent_many := case tbl
    when 'projects' then 'lucrări' when 'tasks' then 'misiuni' when 'assignments' then 'alocări'
    when 'employees' then 'angajați' when 'teams' then 'echipe' when 'absences' then 'absențe'
    when 'vehicles' then 'mașini' when 'time_entries' then 'pontaje' when 'invites' then 'invitații'
    when 'companies' then 'setările firmei' else tbl end;
  verb := case op when 'INSERT' then 'a adăugat' when 'UPDATE' then 'a modificat' else 'a șters' end;
  if tbl = 'companies' then return coalesce(actor, 'Admin') || ' ' || verb || ' setările firmei'; end if;
  if n <> 1 then return coalesce(actor, 'Admin') || ' ' || verb || ' ' || n || ' ' || ent_many; end if;

  lbl := ' „' || coalesce(items -> 0 ->> 'label', '') || '”';
  ch := coalesce(items -> 0 -> 'changes', '[]'::jsonb);
  if op = 'UPDATE' then
    select c ->> 'to' into st from jsonb_array_elements(ch) c where c ->> 'f' = 'stare' limit 1;
    select c ->> 'to' into reason from jsonb_array_elements(ch) c where c ->> 'f' = 'motivul respingerii' limit 1;
    if tbl = 'time_entries' and st = 'respins' then
      return coalesce(actor, 'Admin') || ' a respins pontajul' || lbl || coalesce(' — motiv: ' || nullif(reason, '—'), '');
    elsif tbl = 'time_entries' and st = 'aprobat' then
      return coalesce(actor, 'Admin') || ' a aprobat pontajul' || lbl;
    elsif tbl = 'time_entries' and st = 'trimis spre aprobare' then
      return coalesce(actor, 'Admin') || ' a trimis spre aprobare pontajul' || lbl;
    end if;
    select string_agg(c ->> 'f', ', ') into fields from jsonb_array_elements(ch) c where not (c ->> 'f' = any(technical));
    if fields is null and tbl = 'time_entries' and exists (select 1 from jsonb_array_elements(ch) c where c ->> 'f' = 'validat de') then
      return coalesce(actor, 'Admin') || ' a validat pontajul' || lbl;
    end if;
    return coalesce(actor, 'Admin') || ' a modificat ' || ent_one || lbl || coalesce(' — a schimbat: ' || fields, '');
  end if;
  return coalesce(actor, 'Admin') || ' ' || verb || ' ' || ent_one || lbl;
end $$;

create or replace function trg_owner_activity() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int; cid uuid; actor text; summary text; do_push boolean;
  items jsonb := '[]'::jsonb; r record; changes jsonb; k text;
begin
  if auth.uid() is null or app_role() is distinct from 'admin' or is_platform_owner() then return null; end if;
  cid := app_company_id();
  if cid is null then return null; end if;

  if tg_op = 'UPDATE' then
    for r in execute 'select to_jsonb(o) as o, to_jsonb(nw) as nw from old_rows o join new_rows nw on nw.id = o.id' loop
      changes := '[]'::jsonb;
      for k in select jsonb_object_keys(r.nw) loop
        if activity_hidden_field(k) or (r.o -> k) is not distinct from (r.nw -> k) then continue; end if;
        changes := changes || jsonb_build_object('f', activity_field_label(k), 'from', activity_value(k, r.o -> k), 'to', activity_value(k, r.nw -> k));
      end loop;
      if jsonb_array_length(changes) > 0 and jsonb_array_length(items) < 10 then
        items := items || jsonb_build_object('label', activity_row_label(tg_table_name, r.nw), 'changes', changes);
      end if;
    end loop;
    n := jsonb_array_length(items);
    if n = 0 then return null; end if;
  else
    for r in execute format('select to_jsonb(x) as j from %I x limit 10', case when tg_op = 'DELETE' then 'old_rows' else 'new_rows' end) loop
      items := items || jsonb_build_object('label', activity_row_label(tg_table_name, r.j));
    end loop;
    execute format('select count(*) from %I', case when tg_op = 'DELETE' then 'old_rows' else 'new_rows' end) into n;
    if n = 0 then return null; end if;
  end if;

  select coalesce(m.display_name, e.full_name, 'Admin') into actor
    from memberships m left join employees e on e.id = m.employee_id where m.user_id = auth.uid();
  summary := activity_summary(actor, tg_table_name, tg_op, n, items);

  do_push := coalesce((select value = 'true'::jsonb from platform_settings where key = 'owner_activity_push'), true)
    and not exists (select 1 from owner_activity where company_id = cid and entity = tg_table_name and op = tg_op
                    and pushed and at > now() - interval '2 minutes');

  insert into owner_activity(company_id, user_id, actor, entity, op, n, summary, pushed, details)
  values (cid, auth.uid(), actor, tg_table_name, tg_op, n, left(summary, 300), do_push, items);
  delete from owner_activity where at < now() - interval '90 days';

  if do_push then
    perform notify_users(cid, array(select user_id from platform_owners), (select name from companies where id = cid),
      left(summary, 200), '/proprietar?tab=activitate', 'owner_activity', false);
  end if;
  return null;
exception when others then
  raise warning 'trg_owner_activity: %', sqlerrm;
  return null;
end $$;

-- rescrie intrările deja existente (câmpuri tehnice → cuvinte, valori → format citeț)
do $$
declare a record; items jsonb; it jsonb; ch jsonb; c jsonb; newch jsonb; raw text;
begin
  for a in select id, actor, entity, op, n, details from owner_activity where details is not null loop
    items := '[]'::jsonb;
    for it in select * from jsonb_array_elements(a.details) loop
      if it ? 'changes' then
        newch := '[]'::jsonb;
        for c in select * from jsonb_array_elements(it -> 'changes') loop
          raw := c ->> 'f';
          if activity_hidden_field(raw) then continue; end if;
          if activity_field_label(raw) <> raw or raw = 'status' then
            c := jsonb_build_object('f', activity_field_label(raw),
                                    'from', activity_value(raw, c -> 'from'), 'to', activity_value(raw, c -> 'to'));
          end if;
          newch := newch || c;
        end loop;
        it := jsonb_set(it, '{changes}', newch);
      end if;
      items := items || it;
    end loop;
    update owner_activity set details = items, summary = left(activity_summary(a.actor, a.entity, a.op, a.n, items), 300)
    where id = a.id;
  end loop;
end $$;
