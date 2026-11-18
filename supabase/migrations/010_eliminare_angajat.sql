-- 010: Adminul firmei poate elimina (dezactiva + scoate accesul) sau șterge definitiv un angajat
create or replace function admin_remove_employee(p_employee uuid, p_delete boolean default false, p_confirm text default null)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  e employees; uid uuid; is_phone boolean := false; actor text; cid uuid;
begin
  if not app_is_admin() or app_company_id() is null then
    raise exception 'Doar administratorul poate elimina angajați.' using errcode = '42501';
  end if;
  cid := app_company_id();
  select * into e from employees where id = p_employee and company_id = cid;
  if not found then raise exception 'Angajatul nu există.' using errcode = 'P0002'; end if;
  if e.user_id = auth.uid() then raise exception 'Nu te poți elimina pe tine.' using errcode = '42501'; end if;
  if p_delete and trim(coalesce(p_confirm, '')) is distinct from e.full_name then
    raise exception 'Scrie exact numele angajatului pentru confirmare.' using errcode = '22023';
  end if;

  -- accesul în aplicație: contul de telefon dispare (numărul poate fi refolosit), contul cu email doar se dezleagă
  uid := e.user_id;
  if uid is not null then
    select u.email like '%@telefon.dyasplanning.app' into is_phone from auth.users u where u.id = uid;
    delete from push_subscriptions where user_id = uid;
    delete from memberships where user_id = uid and company_id = cid;
    update employees set user_id = null where id = e.id;
    if coalesce(is_phone, false) and not exists (select 1 from platform_owners where user_id = uid) then
      delete from auth.users where id = uid;
    end if;
  end if;
  delete from invites where employee_id = e.id and used_at is null;

  if not p_delete then
    update employees set active = false, is_driver = false, default_vehicle_id = null where id = e.id;
    return;
  end if;

  -- ștergere definitivă: notăm în jurnalul proprietarului, apoi ștergem ca sistem (regulile pontajelor nu se aplică)
  select coalesce(m.display_name, x.full_name, 'Admin') into actor
    from memberships m left join employees x on x.id = m.employee_id where m.user_id = auth.uid();
  insert into owner_activity(company_id, user_id, actor, entity, op, n, summary, pushed, details)
  values (cid, auth.uid(), actor, 'employees', 'DELETE', 1, actor || ' a șters angajatul „' || e.full_name || '”', false,
          jsonb_build_array(jsonb_build_object('label', e.full_name)));
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  delete from time_entry_history where time_entry_id in (select id from time_entries where employee_id = e.id);
  delete from time_entries where employee_id = e.id;
  delete from employees where id = e.id;
end $$;

revoke execute on function admin_remove_employee(uuid, boolean, text) from public, anon;
grant execute on function admin_remove_employee(uuid, boolean, text) to authenticated;
