import re, subprocess, os
from playwright.sync_api import sync_playwright, expect
B="http://localhost:3000"
def sql(q): return subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","dyas_e2e","-qtAc",q], check=True, capture_output=True, text=True).stdout.strip()
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    c=b.new_context(viewport={"width":1280,"height":800}, locale="ro-RO", timezone_id="Europe/Bucharest"); a=c.new_page(); a.set_default_timeout(15000)
    a.goto(B+"/firma-noua-5lo4x0")
    a.get_by_label("Email").fill("coordonator@exemplu-demo.ro"); a.get_by_label("Parolă").fill("demo12345"); a.get_by_role("button", name="Creează cont").click()
    a.wait_for_url(re.compile("/onboarding")); a.get_by_role("tab", name="Înființez firma").click()
    a.get_by_label("Numele firmei").fill("Construcții Exemplu SRL"); a.get_by_label("Numele tău").fill("Coordonator"); a.get_by_role("button", name="Creează firma").click()
    a.wait_for_url(re.compile("/dashboard")); b.close()
cid=sql("select id from companies where name='Construcții Exemplu SRL'")
sql(f"update companies set default_work_start='08:00', default_work_end='16:30', default_break_minutes=30 where id='{cid}'")
emps={}
for n,ph,col in [("Andrei Ionescu","0700 000 101","#f97316"),("Mihai Stan","0700 000 102","#2563eb"),("Elena Dobre","0700 000 103","#16a34a")]:
    emps[n.split()[0]]=sql(f"insert into employees(company_id, full_name, phone, work_start, work_end, break_minutes) values ('{cid}','{n}','{ph}','08:00','16:30',30) returning id").splitlines()[0]
pm=sql(f"insert into projects(company_id,name,status,address,city,color,start_date) values ('{cid}','Renovare apartament · Militari','in_desfasurare','Militari (adresă fictivă)','București','#f97316','2026-11-09') returning id").splitlines()[0]
pg=sql(f"insert into projects(company_id,name,status,address,city,color,start_date) values ('{cid}','Amenajare birouri · Grozăvești','in_desfasurare','Grozăvești (adresă fictivă)','București','#7c3aed','2026-11-02') returning id").splitlines()[0]
t_gips=sql(f"insert into tasks(company_id,project_id,name) values ('{cid}','{pm}','Montaj pereți gips-carton') returning id").splitlines()[0]
t_el=sql(f"insert into tasks(company_id,project_id,name) values ('{cid}','{pm}','Pregătire instalație electrică') returning id").splitlines()[0]
t_fin=sql(f"insert into tasks(company_id,project_id,name) values ('{cid}','{pg}','Finisaje: glet și vopsea') returning id").splitlines()[0]
sql(f"insert into assignments(company_id,employee_id,project_id,task_id,starts_at,ends_at,break_minutes,status) values ('{cid}','{emps['Elena']}','{pg}','{t_fin}','2026-11-16 08:00+02','2026-11-16 16:30+02',30,'confirmata')")
open("ids.env","w").write(f"CID={cid}\nPM={pm}\nPG={pg}\nT_GIPS={t_gips}\nT_EL={t_el}\nT_FIN={t_fin}\nANDREI={emps['Andrei']}\nMIHAI={emps['Mihai']}\nELENA={emps['Elena']}\n")
print(open("ids.env").read())
