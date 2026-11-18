-- 018: Data ultimului backup al firmei (pentru amintirea „Fă un backup” de pe dashboard).
alter table companies add column if not exists last_backup_at timestamptz;

create or replace function mark_company_backup() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare t timestamptz := now();
begin
  if app_company_id() is null or not app_is_admin() then
    raise exception 'Doar administratorul firmei poate face backup.' using errcode = '42501';
  end if;
  update companies set last_backup_at = t where id = app_company_id();
  return t;
end $$;
revoke execute on function mark_company_backup() from public, anon;
grant execute on function mark_company_backup() to authenticated;
