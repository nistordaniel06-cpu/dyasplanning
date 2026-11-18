-- 021: Doar proprietarul aplicației pornește/oprește asistentul AI al unei firme (adminul firmei nu-l poate schimba).
create or replace function companies_protect_assistant() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assistant_enabled is distinct from old.assistant_enabled and not is_platform_owner() then
    new.assistant_enabled := old.assistant_enabled;
  end if;
  return new;
end $$;
drop trigger if exists trg_companies_protect_assistant on companies;
create trigger trg_companies_protect_assistant before update on companies for each row execute function companies_protect_assistant();
