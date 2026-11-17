-- 005: Alerte pentru proprietarul aplicației
-- • firmă nouă înscrisă (imediat)
-- • verificare zilnică (08:00 România): proba expiră în 3 zile, proba a expirat ieri, firmă inactivă de 14 zile
-- Alerta ajunge în clopoțelul aplicației + notificare pe telefon (push) + email (dacă e configurat Resend pe server).

create or replace function owner_alert(p_kind text, p_title text, p_body text, p_company uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  owners uuid[];
  emails jsonb;
  url text; secret text;
begin
  select coalesce(array_agg(user_id), '{}') into owners from platform_owners;
  if cardinality(owners) = 0 then return; end if;
  perform notify_users(p_company, owners, p_title, p_body, '/proprietar', p_kind, true);

  select jsonb_agg(u.email) into emails from auth.users u where u.id = any(owners) and u.email is not null;
  select value into url from app_config where key = 'owner_email_url';
  select value into secret from app_config where key = 'push_secret';
  if emails is null or url is null or secret is null then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using url, jsonb_build_object('to', emails, 'subject', p_title, 'text', coalesce(p_body, '')),
          jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret);
exception when others then
  raise warning 'owner_alert: %', sqlerrm; -- o alertă eșuată nu blochează înscrierea
end $$;

-- Firmă nouă: declanșat la primul membru (adminul), ca să știm și emailul lui
create or replace function trg_owner_new_company() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare cname text; ctz text; email text;
begin
  if new.role <> 'admin' then return new; end if;
  if exists (select 1 from memberships m where m.company_id = new.company_id and m.user_id <> new.user_id) then return new; end if;
  select name, timezone into cname, ctz from companies where id = new.company_id;
  select u.email into email from auth.users u where u.id = new.user_id;
  perform owner_alert('owner_signup', 'Firmă nouă: ' || cname,
    'Admin: ' || coalesce(email, '—') || ' · fus orar ' || coalesce(ctz, '—') || '. Vezi detalii în panoul proprietarului.', new.company_id);
  return new;
end $$;
drop trigger if exists trg_owner_new_company on memberships;
create trigger trg_owner_new_company after insert on memberships for each row execute function trg_owner_new_company();

-- Verificarea zilnică; întoarce câte alerte a trimis
create or replace function owner_daily_check() returns int
language plpgsql security definer set search_path = public, auth as $$
declare
  today date := (now() at time zone 'Europe/Bucharest')::date;
  r record;
  n int := 0;
begin
  for r in select id, name, trial_until from companies where status = 'activ' and trial_until = today + 3 loop
    perform owner_alert('owner_trial_soon', 'Proba expiră în 3 zile: ' || r.name,
      'Perioada de probă se termină pe ' || to_char(r.trial_until, 'DD.MM.YYYY') || '. E momentul să îi contactezi.', r.id);
    n := n + 1;
  end loop;
  for r in select id, name from companies where status = 'activ' and trial_until = today - 1 loop
    perform owner_alert('owner_trial_expired', 'Proba a expirat: ' || r.name,
      'Perioada de probă s-a terminat ieri. Poți schimba planul sau suspenda firma din panoul proprietarului.', r.id);
    n := n + 1;
  end loop;
  for r in
    select c.id, c.name from companies c
    where c.status = 'activ'
      and (greatest(
             (select max(u.last_sign_in_at) from memberships m join auth.users u on u.id = m.user_id where m.company_id = c.id),
             (select max(l.at) from login_events l where l.company_id = c.id)
           ) at time zone 'Europe/Bucharest')::date = today - 14
  loop
    perform owner_alert('owner_inactive', 'Firmă inactivă de 14 zile: ' || r.name,
      'Nimeni din firmă nu a mai deschis aplicația de 2 săptămâni. Merită un telefon.', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function owner_alert(text, text, text, uuid), trg_owner_new_company(), owner_daily_check() from public, anon, authenticated;

-- Programare zilnică la 08:17 ora României (06:17 UTC iarna); doar dacă pg_cron e instalat
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dyas_owner_daily';
    perform cron.schedule('dyas_owner_daily', '17 6 * * *', 'select public.owner_daily_check()');
  end if;
end $$;

-- Buton „Trimite o alertă de test” din panou
create or replace function owner_test_alert() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform owner_guard();
  -- notify_users nu trimite către utilizatorul curent, așa că alerta de test o scriem direct + push/email
  insert into notifications(company_id, user_id, kind, title, body, url)
  select coalesce(app_company_id(), (select id from companies order by created_at limit 1)), auth.uid(), 'owner_test', 'Alertă de test', 'Alertele proprietarului funcționează.', '/proprietar';
  perform owner_alert_direct('owner_test', 'Alertă de test', 'Alertele proprietarului funcționează (telefon + email).');
end $$;

-- Push + email către proprietari, inclusiv către utilizatorul curent (fără a salva în clopoțel)
create or replace function owner_alert_direct(p_kind text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = public, auth as $$
declare payload jsonb; emails jsonb; purl text; eurl text; secret text;
begin
  select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
           'title', p_title, 'body', p_body, 'url', '/proprietar', 'tag', p_kind))
    into payload from push_subscriptions s where s.user_id in (select user_id from platform_owners);
  select jsonb_agg(u.email) into emails from auth.users u where u.id in (select user_id from platform_owners);
  select value into purl from app_config where key = 'push_url';
  select value into eurl from app_config where key = 'owner_email_url';
  select value into secret from app_config where key = 'push_secret';
  if secret is null or not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  if payload is not null and purl is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3)' using purl, jsonb_build_object('messages', payload),
      jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret);
  end if;
  if emails is not null and eurl is not null then
    execute 'select net.http_post(url := $1, body := $2, headers := $3)' using eurl,
      jsonb_build_object('to', emails, 'subject', p_title, 'text', p_body),
      jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret);
  end if;
exception when others then
  raise warning 'owner_alert_direct: %', sqlerrm;
end $$;

revoke execute on function owner_test_alert(), owner_alert_direct(text, text, text) from public, anon;
revoke execute on function owner_alert_direct(text, text, text) from authenticated;
grant execute on function owner_test_alert() to authenticated;
