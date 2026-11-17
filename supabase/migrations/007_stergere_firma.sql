-- 007: Proprietarul poate șterge definitiv o firmă (cu confirmare prin numele exact al firmei)
create or replace function owner_delete_company(p_company uuid, p_confirm_name text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare cname text; phone_users uuid[];
begin
  perform owner_guard();
  select name into cname from companies where id = p_company;
  if cname is null then raise exception 'Firma nu există.' using errcode = 'P0002'; end if;
  if trim(coalesce(p_confirm_name, '')) is distinct from cname then
    raise exception 'Scrie exact numele firmei pentru confirmare.' using errcode = '22023';
  end if;
  -- conturile de telefon ale angajaților firmei dispar odată cu ea (proprietarul nu e atins)
  select coalesce(array_agg(u.id), '{}') into phone_users
  from memberships m join auth.users u on u.id = m.user_id
  where m.company_id = p_company and u.email like '%@telefon.dyasplanning.app'
    and u.id not in (select user_id from platform_owners);

  -- ștergerea rulează ca sistem (fără utilizator), ca regulile pontajelor și notificările să nu se aplice
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  delete from time_entries where company_id = p_company;
  delete from companies where id = p_company;
  delete from time_entry_history where company_id = p_company;
  delete from auth.users where id = any(phone_users);
end $$;

revoke execute on function owner_delete_company(uuid, text) from public, anon;
grant execute on function owner_delete_company(uuid, text) to authenticated;
