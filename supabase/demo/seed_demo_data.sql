-- =====================================================================
-- DYASPlanning — date DEMONSTRATIVE pentru prezentări.
-- Creează (sau recreează de la zero) firma „Construct Demo SRL”, complet separată
-- de firmele reale. Datele sunt relative la ziua de azi, ca demo-ul să pară mereu actual.
-- Necesită ca cele 4 conturi demo să existe deja în auth.users (vezi seed_demo_users.sql).
-- =====================================================================
do $$
declare
  tz constant text := 'Europe/Bucharest';
  cname constant text := 'Construct Demo SRL';
  today date := (now() at time zone tz)::date;
  mon date := today - (extract(isodow from today)::int - 1);
  cid uuid;
  u_admin uuid; u_sef uuid; u_ang uuid;
  e_admin uuid; e_marian uuid; e_ion uuid; e_gheorghe uuid; e_cristian uuid; e_florin uuid;
  e_vasile uuid; e_mihai uuid; e_daniel uuid; e_costel uuid;
  t_nord uuid; t_sud uuid;
  p_dt uuid; p_ch uuid; p_pi uuid; p_mi uuid; p_sn uuid;
  k uuid;
  v_transit uuid; v_logan uuid;
  d date; i int; wd int;
  a_id uuid; s_at timestamptz; e_at timestamptz;
  plan record;
  km_t int := 148320; km_l int := 96410;
  ts constant text := 'Europe/Bucharest';
  last_wd date;
begin
  last_wd := today - case extract(isodow from today)::int when 1 then 3 when 7 then 2 else 1 end;
  select id into u_admin from auth.users where email = 'admin.demo@dyasplanning.ro';
  select id into u_sef   from auth.users where email = 't40722100002@telefon.dyasplanning.app';
  select id into u_ang   from auth.users where email = 't40722100003@telefon.dyasplanning.app';
  if u_admin is null or u_sef is null or u_ang is null then
    raise exception 'Lipsesc conturile demo din auth.users.';
  end if;

  -- curăță demo-ul anterior (doar firma demo)
  delete from memberships where user_id in (u_admin, u_sef, u_ang);
  for cid in select id from companies where name = cname loop
    delete from time_entries where company_id = cid;
    delete from time_entry_history where company_id = cid;
    delete from companies where id = cid;
  end loop;

  insert into companies(name, timezone, travel_buffer_minutes) values (cname, tz, 30) returning id into cid;

  -- echipe
  insert into teams(company_id, name) values (cid, 'Echipa Nord') returning id into t_nord;
  insert into teams(company_id, name) values (cid, 'Echipa Sud') returning id into t_sud;

  -- mașini
  insert into vehicles(company_id, name, plate) values (cid, 'Ford Transit', 'B 101 DMO') returning id into v_transit;
  insert into vehicles(company_id, name, plate) values (cid, 'Dacia Logan Van', 'B 202 DMO') returning id into v_logan;

  -- angajați (cei cu cont: admin, șef de echipă, angajat). „Șofer” nu e rol: e o bifă pe fișa unui angajat obișnuit.
  insert into employees(company_id, full_name, phone, trade, user_id) values (cid, 'Andreea Dobre', '0722 100 001', 'Administrator', u_admin) returning id into e_admin;
  insert into employees(company_id, full_name, phone, trade, skills, team_id, user_id, work_start, work_end, is_driver, default_vehicle_id)
    values (cid, 'Marian Popa', '0722 100 002', 'Șef de echipă', '{coordonare,rigips,zidărie,permis B}', t_nord, u_sef, '07:30', '16:00', true, v_logan) returning id into e_marian;
  insert into employees(company_id, full_name, phone, trade, skills, team_id, user_id, is_driver, default_vehicle_id)
    values (cid, 'Ion Stan', '0722 100 003', 'Rigipsar', '{rigips,glet,tavane false,permis B}', t_nord, u_ang, true, v_transit) returning id into e_ion;
  insert into employees(company_id, full_name, phone, trade, skills, team_id)
    values (cid, 'Gheorghe Matei', '0722 100 004', 'Muncitor', '{transport materiale,demolări}', t_nord) returning id into e_gheorghe;
  insert into employees(company_id, full_name, phone, trade, skills, team_id) values (cid, 'Cristian Neagu', '0722 100 005', 'Electrician', '{instalații electrice,tablouri}', t_nord) returning id into e_cristian;
  insert into employees(company_id, full_name, phone, trade, skills, team_id) values (cid, 'Florin Radu', '0722 100 006', 'Zugrav', '{zugrăveli,glet,tapet}', t_nord) returning id into e_florin;
  insert into employees(company_id, full_name, phone, trade, skills, team_id)
    values (cid, 'Vasile Dumitru', '0722 100 007', 'Zidar', '{zidărie,tencuieli,beton}', t_sud) returning id into e_vasile;
  insert into employees(company_id, full_name, phone, trade, skills, team_id) values (cid, 'Mihai Toma', '0722 100 008', 'Instalator', '{sanitare,termice}', t_sud) returning id into e_mihai;
  insert into employees(company_id, full_name, phone, trade, skills, team_id) values (cid, 'Daniel Ene', '0722 100 009', 'Faianțar', '{faianță,gresie}', t_sud) returning id into e_daniel;
  insert into employees(company_id, full_name, phone, trade, skills, team_id) values (cid, 'Costel Barbu', '0722 100 010', 'Muncitor', '{demolări,curățenie,ajutor}', t_sud) returning id into e_costel;
  update teams set leader_employee_id = e_marian where id = t_nord;
  update teams set leader_employee_id = e_vasile where id = t_sud;

  insert into memberships(user_id, company_id, role, employee_id, display_name) values
    (u_admin, cid, 'admin', e_admin, 'Andreea Dobre'),
    (u_sef, cid, 'sef_echipa', e_marian, 'Marian Popa'),
    (u_ang, cid, 'angajat', e_ion, 'Ion Stan');

  -- lucrări
  insert into projects(company_id, name, description, client_name, contact_name, contact_phone, address, city, start_date, due_date, manager_employee_id, status, color)
    values (cid, 'Renovare apartament — Drumul Taberei', 'Apartament 3 camere: pereți rigips, instalație electrică nouă, zugrăveli.', 'Familia Georgescu', 'Elena Georgescu', '0733 200 001',
            'Str. Brașov 21, bl. 4, ap. 12', 'București', mon - 7, mon + 18, e_marian, 'in_desfasurare', '#2563eb') returning id into p_dt;
  insert into projects(company_id, name, description, client_name, contact_name, contact_phone, address, city, start_date, due_date, manager_employee_id, status, color)
    values (cid, 'Casă P+1 — Chiajna', 'Construcție la roșu finalizată; urmează tencuieli, instalații și finisaje.', 'Radu Constantinescu', 'Radu Constantinescu', '0733 200 002',
            'Str. Tineretului 14', 'Chiajna', mon - 21, mon + 45, e_vasile, 'in_desfasurare', '#16a34a') returning id into p_ch;
  insert into projects(company_id, name, description, client_name, contact_name, contact_phone, address, city, start_date, due_date, manager_employee_id, status, color)
    values (cid, 'Amenajare birouri — Pipera', 'Open space 240 mp: compartimentări rigips și iluminat.', 'Nordic Soft SRL', 'Ioana Marin', '0733 200 003',
            'Bd. Pipera 1/VII', 'Voluntari', mon - 2, mon + 25, e_marian, 'in_desfasurare', '#9333ea') returning id into p_pi;
  insert into projects(company_id, name, description, client_name, contact_name, contact_phone, address, city, start_date, due_date, manager_employee_id, status, color)
    values (cid, 'Baie și bucătărie — Militari', 'Refacere completă baie și bucătărie.', 'Andrei Vlad', 'Andrei Vlad', '0733 200 004',
            'Bd. Iuliu Maniu 55, bl. C2', 'București', mon + 7, mon + 16, e_vasile, 'planificata', '#0891b2') returning id into p_mi;
  insert into projects(company_id, name, description, client_name, address, city, start_date, due_date, manager_employee_id, status, color)
    values (cid, 'Vilă — Snagov', 'Finisaje interioare.', 'Familia Dinu', 'Str. Lacului 8', 'Snagov', mon - 60, mon - 10, e_vasile, 'finalizata', '#db2777') returning id into p_sn;

  -- misiuni
  insert into tasks(company_id, project_id, name, status, progress, due_date) values
    (cid, p_dt, 'Montaj rigips', 'in_lucru', 70, mon + 4),
    (cid, p_dt, 'Instalație electrică', 'in_lucru', 45, mon + 8),
    (cid, p_dt, 'Glet și zugrăveli', 'neinceputa', 0, mon + 16),
    (cid, p_ch, 'Tencuieli interioare', 'in_lucru', 60, mon + 10),
    (cid, p_ch, 'Instalații sanitare', 'in_lucru', 30, mon + 20),
    (cid, p_ch, 'Șapă', 'blocata', 10, today - 2),
    (cid, p_pi, 'Compartimentări rigips', 'in_lucru', 25, mon + 12),
    (cid, p_pi, 'Iluminat', 'neinceputa', 0, mon + 20),
    (cid, p_mi, 'Demolare', 'neinceputa', 0, mon + 8),
    (cid, p_mi, 'Faianță și gresie', 'neinceputa', 0, mon + 14),
    (cid, p_sn, 'Finisaje', 'finalizata', 100, mon - 10);

  -- absențe: Daniel în concediu medical azi + 2 zile; Florin concediu vinerea viitoare
  insert into absences(company_id, employee_id, type, start_date, end_date, note) values
    (cid, e_daniel, 'medical', today, today + 2, 'Certificat medical'),
    (cid, e_florin, 'concediu', mon + 11, mon + 11, 'Zi liberă cerută');

  -- program: săptămâna trecută, săptămâna curentă și săptămâna viitoare, zile lucrătoare
  for i in -7..13 loop
    d := mon + i;
    wd := extract(isodow from d)::int;
    continue when wd > 5;
    for plan in
      select * from (values
        (e_marian,   p_dt, 'Montaj rigips',          '07:30', '16:00', 30),
        (e_ion,      p_dt, 'Montaj rigips',          '08:00', '16:30', 30),
        (e_cristian, p_dt, 'Instalație electrică',   '08:00', '16:00', 30),
        (e_florin,   p_pi, 'Compartimentări rigips', '08:00', '16:30', 30),
        (e_gheorghe, p_pi, 'Compartimentări rigips', '07:00', '12:00', 0),
        (e_gheorghe, p_ch, 'Tencuieli interioare',   '12:30', '16:30', 0),
        (e_vasile,   p_ch, 'Tencuieli interioare',   '08:00', '16:30', 30),
        (e_mihai,    p_ch, 'Instalații sanitare',    '08:00', '16:30', 30),
        (e_daniel,   p_ch, 'Tencuieli interioare',   '08:00', '16:30', 30),
        (e_costel,   p_ch, 'Tencuieli interioare',   '08:00', '16:30', 30)
      ) as x(emp, proj, task, st, en, brk)
    loop
      -- săptămâna viitoare: Daniel și Costel trec pe Militari, Florin lipsește când e în concediu
      continue when exists (select 1 from absences ab where ab.employee_id = plan.emp and d between ab.start_date and ab.end_date);
      if i >= 7 and plan.emp in (e_daniel, e_costel) then
        plan.proj := p_mi; plan.task := case when plan.emp = e_daniel then 'Faianță și gresie' else 'Demolare' end;
      end if;
      continue when i >= 7 and plan.proj = p_mi and d < mon + 7;
      s_at := (d + plan.st::time) at time zone ts;
      e_at := (d + plan.en::time) at time zone ts;
      insert into assignments(company_id, employee_id, project_id, task_id, starts_at, ends_at, break_minutes, status)
      values (cid, plan.emp, plan.proj, (select id from tasks where project_id = plan.proj and name = plan.task), s_at, e_at, plan.brk,
              (case when d < today then 'confirmata' else 'planificata' end)::assignment_status)
      returning id into a_id;

      -- pontaje: zilele trecute aprobate; ieri trimise (de aprobat); câteva cu mici diferențe față de plan
      if d < today then
        insert into time_entries(company_id, employee_id, project_id, task_id, assignment_id, started_at, ended_at, break_minutes, status, notes, submitted_at, reviewed_at)
        values (cid, plan.emp, plan.proj, (select task_id from assignments where id = a_id), a_id,
                s_at + make_interval(mins => (case when plan.emp = e_ion and wd = 2 then 15 else 0 end)),
                e_at + make_interval(mins => (case when plan.emp in (e_vasile, e_mihai) and wd in (3, 4) then 45 when plan.emp = e_florin and wd = 5 then -30 else 0 end)),
                plan.brk,
                case when d = last_wd then 'trimis'::time_entry_status else 'aprobat'::time_entry_status end,
                case when plan.emp in (e_vasile, e_mihai) and wd in (3, 4) then 'Am rămas pentru finalizarea zonei de baie.' end,
                e_at, case when d < last_wd then e_at + interval '1 day' end);
      end if;
    end loop;
  end loop;

  -- un pontaj respins (de corectat de angajat) și o semnalare de la șeful de echipă
  update time_entries set status = 'respins', rejection_reason = 'Lipsește pauza de masă — te rog corectează.'
   where id = (select id from time_entries where company_id = cid and employee_id = e_ion and status = 'trimis' order by started_at desc limit 1);
  update time_entries set flag_note = 'A plecat mai devreme cu acordul meu.'
   where id = (select id from time_entries where company_id = cid and employee_id = e_cristian and status = 'trimis' order by started_at desc limit 1);

  -- km de bord: ultimele zile lucrătoare; azi lipsesc ambele (Ion și Marian îi introduc live la prezentare)
  for i in reverse 14..0 loop
    d := today - i;
    continue when extract(isodow from d)::int > 5;
    continue when d >= today;
    insert into odometer_readings(company_id, vehicle_id, employee_id, reading_date, km)
      values (cid, v_transit, e_ion, d, km_t);
    km_t := km_t + 38 + ((extract(day from d)::int * 7) % 45);
    insert into odometer_readings(company_id, vehicle_id, employee_id, reading_date, km)
      values (cid, v_logan, e_marian, d, km_l);
    km_l := km_l + 52 + ((extract(day from d)::int * 11) % 60);
  end loop;

  -- observații
  insert into notes(company_id, project_id, task_id, author_user_id, author_name, body, created_at) values
    (cid, p_dt, (select id from tasks where project_id = p_dt and name = 'Montaj rigips'), u_sef, 'Marian Popa', 'Camera mare și holul sunt gata. Mai rămâne dormitorul mic.', now() - interval '1 day'),
    (cid, p_ch, (select id from tasks where project_id = p_ch and name = 'Șapă'), u_admin, 'Andreea Dobre', 'Șapa e blocată: clientul n-a ales încă sistemul de încălzire în pardoseală.', now() - interval '2 days'),
    (cid, p_pi, null, u_admin, 'Andreea Dobre', 'Acces în clădire doar cu ecuson — se ridică de la recepție, etaj 0.', now() - interval '3 days');
end $$;
