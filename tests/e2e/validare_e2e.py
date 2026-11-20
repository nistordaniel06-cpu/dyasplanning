import re, json, subprocess
from playwright.sync_api import sync_playwright, expect
B="http://localhost:3000"; probs=[]
def ok(m): print("✓", m, flush=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path=__import__("os").environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox"])
    def ctx(w=390,h=844,mobile=True):
        c=b.new_context(viewport={"width":w,"height":h}, is_mobile=mobile, has_touch=mobile, locale="ro-RO", timezone_id="Europe/Bucharest")
        c.add_init_script("try{localStorage.getItem('dyas.loc')||localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.getItem('dyas.push')||localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}"); pg=c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: probs.append(f"pageerror {e}"))
        pg.on("console", lambda m: m.type=="error" and not re.search(r"WebSocket|realtime|Failed to load resource", m.text) and probs.append(m.text))
        return pg
    import struct, zlib
    def png(path, rgb, w=64, h=48):
        raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
        chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
        open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    png("/tmp/extra.png", (30, 160, 90))
    def sql(q): return subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","dyas_e2e","-qtAc",q], check=True, capture_output=True, text=True).stdout.strip()
    a=ctx(1280,900,False)
    a.goto(B+"/firma-noua-5lo4x0")
    a.get_by_label("Email").fill("patron@firma.ro"); a.get_by_label("Parolă").fill("parola1234"); a.get_by_role("button", name="Creează cont").click()
    a.wait_for_url(re.compile("/onboarding")); a.get_by_role("tab", name="Înființez firma").click()
    a.get_by_label("Numele firmei").fill("Construct Test SRL"); a.get_by_label("Numele tău").fill("Dan Patron"); a.get_by_role("button", name="Creează firma").click()
    a.wait_for_url(re.compile("/dashboard"))
    def employee(name, phone):
        a.goto(B+"/angajati"); a.get_by_role("button", name="Adaugă angajat").first.click()
        d=a.get_by_role("dialog"); d.get_by_label("Nume și prenume").fill(name); d.get_by_label(re.compile("^Telefon")).fill(phone)
        d.get_by_role("button", name="Adaugă angajat").click(); expect(d).to_be_hidden()
    def code_for(name):
        a.goto(B+"/angajati"); a.get_by_text(name, exact=True).click()
        a.get_by_role("button", name="Acces în aplicație").click(); d=a.get_by_role("dialog"); d.get_by_role("button", name="Generează codul").click()
        c=d.locator("div.font-mono").inner_text().strip(); d.get_by_role("button", name="Gata").click(); return c
    employee("Ion Pop", "0722 111 222"); employee("George Șef", "0722 333 444")
    a.goto(B+"/lucrari?nou=1"); d=a.get_by_role("dialog"); d.get_by_label("Nume lucrare").fill("Vila Otopeni"); d.get_by_label("Status").select_option("in_desfasurare")
    d.get_by_role("button", name="Adaugă lucrare").click(); a.wait_for_url(re.compile("/lucrari/")); pid=a.url.rstrip("/").split("/")[-1]
    a.get_by_role("link", name="Alocă angajați").click()
    a.locator("button[aria-pressed]").filter(has_text="Ion Pop").click(); a.locator("button[aria-pressed]").filter(has_text="George Șef").click()
    a.get_by_role("button", name="Salvează alocările").click(); expect(a.get_by_role("heading", name="Alocări salvate")).to_be_visible()
    ci=code_for("Ion Pop"); cg=code_for("George Șef")
    cid=sql("select id from companies where name='Construct Test SRL'")
    tid=sql(f"insert into teams(company_id,name) values ('{cid}','Echipa George') returning id").splitlines()[0]
    sql(f"update employees set team_id='{tid}' where company_id='{cid}' and full_name in ('Ion Pop','George Șef')")
    sql(f"update teams set leader_employee_id=(select id from employees where full_name='George Șef' and company_id='{cid}') where id='{tid}'")
    def login(code, phone):
        c=ctx(); c.goto(B+"/login"); c.get_by_label("Număr de telefon").fill(phone); c.get_by_label("Cod de acces").fill(code); c.get_by_role("button", name="Intră în aplicație").click()
        c.wait_for_url(re.compile("/astazi")); return c
    i=login(ci, "0722 111 222"); g=login(cg, "0722 333 444")
    sql(f"update memberships set role='sef_echipa' where employee_id=(select id from employees where full_name='George Șef' and company_id='{cid}')")
    # Ion a pus 07:00–17:00 (dar a plecat la 16)
    sql(f"insert into time_entries(company_id,employee_id,project_id,started_at,ended_at,break_minutes,status) select '{cid}', id, '{pid}', (current_date + time '07:00') at time zone 'Europe/Bucharest', (current_date + time '17:00') at time zone 'Europe/Bucharest', 60, 'trimis' from employees where full_name='Ion Pop' and company_id='{cid}'")
    # --- șeful de echipă validează
    g.goto(B+"/astazi"); g.reload()
    g.get_by_role("link", name="Validare zi").click(); g.wait_for_url(re.compile("/validare"))
    card_ion=g.locator("li").filter(has=g.get_by_text("Ion Pop", exact=True)).first
    expect(card_ion.get_by_text(re.compile("07:00–17:00")).first).to_be_visible()
    card_g=g.locator("li").filter(has=g.get_by_text("George Șef", exact=True)).first
    expect(card_g.get_by_text("Nu are ore introduse")).to_be_visible(); ok("șeful vede orele echipei și cine n-a pontat")
    card_ion.get_by_role("button", name="Modifică").click()
    d=g.get_by_role("dialog"); d.get_by_label("Sfârșit").fill("16:00"); d.get_by_label(re.compile("Motivul corectării")).fill("a plecat la 16")
    expect(d.get_by_text("Lucrat: 8h")).to_be_visible(); d.get_by_role("button", name="Salvează și validează").click(); expect(d).to_be_hidden()
    expect(card_ion.get_by_text(re.compile("07:00–16:00")).first).to_be_visible(); expect(card_ion.get_by_text("validat de șef").first).to_be_visible(); ok("șeful corectează orele (rămân validate)")
    card_g.get_by_role("button", name="Adaugă după planificare").click(); d=g.get_by_role("dialog"); d.get_by_role("button", name="Salvează și validează").click(); expect(d).to_be_hidden()
    expect(card_g.get_by_text("validat de șef").first).to_be_visible(); ok("șeful adaugă orele lipsă după planificare")
    g.screenshot(path="shots/90_validare_sef.png", full_page=True)
    # --- Ion e anunțat
    i.goto(B+"/notificari"); expect(i.get_by_text("Ți s-a corectat programul")).to_be_visible(); expect(i.get_by_text(re.compile("a plecat la 16"))).to_be_visible(); ok("angajatul e anunțat de corectare")
    # --- adminul validează (= aprobă)
    a.goto(B+"/validare"); expect(a.get_by_text("validat de șef").first).to_be_visible()
    a.get_by_role("button", name=re.compile("Validează tot")).click(); expect(a.get_by_text(re.compile("2 programe validate și aprobate"))).to_be_visible()
    expect(a.get_by_text("Aprobat").first).to_be_visible(); ok("adminul validează tot = aprobă")
    # --- lucrare extra de la angajat, cu poză
    i.goto(B+"/astazi"); i.get_by_role("link", name="Lucru extra").first.click(); i.wait_for_url(re.compile("/extra/"))
    i.get_by_role("button", name="Adaugă lucrare extra").click()
    i.get_by_label("Ce s-a făcut în plus").fill("Clientul a cerut încă o priză în dormitor")
    i.locator("input[type=file]").first.set_input_files("/tmp/extra.png"); i.wait_for_timeout(800)
    i.get_by_role("button", name="Salvează").click()
    expect(i.get_by_text("Clientul a cerut încă o priză în dormitor")).to_be_visible(); expect(i.get_by_text("De verificat")).to_be_visible()
    expect(i.locator("img[alt='Poză de la lucrare']")).to_have_count(1); i.screenshot(path="shots/91_extra_angajat.png", full_page=True); ok("angajatul adaugă lucrare extra cu poză")
    a.goto(B+f"/lucrari/{pid}"); a.get_by_role("link", name="Lucru extra").click(); expect(a.get_by_text("Clientul a cerut încă o priză în dormitor")).to_be_in_viewport()
    a.get_by_role("button", name="Confirmă").click(); expect(a.get_by_text("Confirmat", exact=True)).to_be_visible()
    a.screenshot(path="shots/92_extra_admin.png", full_page=True); ok("adminul vede și confirmă lucrarea extra")
    print("PROBLEME:", probs or "niciuna"); b.close(); print("VALIDARE E2E COMPLET")
