-- 023: șeful de echipă vede tot planningul firmei (doar citire, ca administratorul)
-- Modificările rămân doar la administrator (politicile *_write nu se schimbă).
-- Chat-ul, pozele și pontajele lucrărilor NU se deschid: app_can_see_project rămâne la fel.

drop policy if exists employees_select on employees;
create policy employees_select on employees for select using (
  company_id = app_company_id() and (
    app_is_admin()
    or app_role() = 'sef_echipa'
    or id = app_employee_id()
    or id in (select a.employee_id from assignments a where a.project_id in (select app_my_project_ids()))
  ));

drop policy if exists absences_select on absences;
create policy absences_select on absences for select using (
  company_id = app_company_id() and (app_is_admin() or app_role() = 'sef_echipa' or employee_id = app_employee_id()));

drop policy if exists projects_select on projects;
create policy projects_select on projects for select using (
  company_id = app_company_id() and (app_role() = 'sef_echipa' or app_can_see_project(id)));

drop policy if exists tasks_select on tasks;
create policy tasks_select on tasks for select using (
  company_id = app_company_id() and (app_role() = 'sef_echipa' or app_can_see_project(project_id)));

drop policy if exists assignments_select on assignments;
create policy assignments_select on assignments for select using (
  company_id = app_company_id() and (
    app_is_admin()
    or app_role() = 'sef_echipa'
    or employee_id = app_employee_id()
    or project_id in (select app_my_project_ids())
  ));

-- lucrările „proprii” (ca înainte): pentru pontaj și pagina Echipa mea
create or replace function my_scope_project_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id from projects p where p.company_id = app_company_id() and app_can_see_project(p.id)
$$;
revoke execute on function my_scope_project_ids() from public, anon;
grant execute on function my_scope_project_ids() to authenticated;
