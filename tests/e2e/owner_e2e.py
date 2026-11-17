import re, subprocess
from playwright.sync_api import sync_playwright, expect
B="http://localhost:3000"; probs=[]
def ok(m): print("✓", m, flush=True)
def sql(q): return subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","dyas_e2e","-tAc",q],capture_output=True,text=True,check=True).stdout.strip()
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def ctx(w=390,h=844,mobile=True):
        c=b.new_context(viewport={"width":w,"height":h}, is_mobile=mobile, has_touch=mobile, locale="ro-RO", timezone_id="Europe/Bucharest")
        pg=c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: probs.append(f"pageerror {e}"))
        pg.on("console", lambda m: m.type=="error" and not re.search(r"WebSocket|realtime|Failed to load resource", m.text) and probs.append(m.text))
        pg.on("dialog", lambda d: d.accept())
        return pg
    def signup(pg, email, firm, name):
        pg.goto(B+"/creare-cont-dyas-7k2m")
        pg.get_by_label("Email").fill(email); pg.get_by_label("Parolă").fill("parola1234"); pg.get_by_role("button", name="Creează cont").click()
        pg.wait_for_url(re.compile("/onboarding")); pg.get_by_role("tab", name="Înființez firma").click()
        pg.get_by_label("Numele firmei").fill(firm); pg.get_by_label("Numele tău").fill(name); pg.get_by_role("button", name="Creează firma").click()
        pg.wait_for_url(re.compile("/dashboard"))
    o=ctx(1280,900,False); signup(o,"dani@dyas.ro","Test srl","Dani")
    c=ctx(); signup(c,"client@firma.ro","Client Construct SRL","Cristi")
    sql("insert into platform_owners(user_id) select id from auth.users where email='dani@dyas.ro'")
    ok("2 firme create; Dani setat proprietar")
    # clientul nu are acces
    c.goto(B+"/proprietar"); expect(c.get_by_role("heading", name="Acces restricționat")).to_be_visible()
    expect(c.get_by_role("link", name="Proprietar")).to_have_count(0)
    ok("adminul unei firme nu vede panoul (nici în meniu)")
    # proprietarul
    o.goto(B+"/dashboard"); o.get_by_role("link", name="Proprietar").first.click()
    expect(o.get_by_role("heading", name="Panoul proprietarului")).to_be_visible()
    expect(o.get_by_text("Firme", exact=True).first).to_be_visible()
    o.wait_for_timeout(500); o.screenshot(path="shots/70_proprietar_prezentare.png", full_page=True)
    ok("prezentare: statistici platformă")
    o.get_by_role("tab", name="Firme").click()
    expect(o.get_by_text("Client Construct SRL")).to_be_visible(); expect(o.get_by_text("client@firma.ro", exact=False)).to_be_visible()
    o.get_by_text("Client Construct SRL").click()
    expect(o.get_by_text("Conturi (1)")).to_be_visible()
    o.get_by_label("Plan").select_option("proba"); o.get_by_label("Perioadă de probă până la").fill("2026-12-31")
    o.get_by_label("Notă internă (o vezi doar tu)").fill("A cerut demo, sună în decembrie"); o.get_by_role("button", name="Salvează").click()
    expect(o.get_by_text("Salvat.")).to_be_visible()
    o.screenshot(path="shots/71_proprietar_firme.png", full_page=True)
    assert sql("select plan||'|'||trial_until||'|'||owner_note from companies where name='Client Construct SRL'")=="proba|2026-12-31|A cerut demo, sună în decembrie"
    ok("plan, probă și notă internă salvate")
    o.get_by_role("button", name="Suspendă firma").click(); expect(o.get_by_role("button", name="Reactivează firma")).to_be_visible()
    c.goto(B+"/dashboard"); expect(c.get_by_role("heading", name="Contul firmei este suspendat")).to_be_visible()
    c.screenshot(path="shots/72_firma_suspendata.png"); ok("firmă suspendată → clientul vede mesajul de suspendare")
    o.get_by_role("button", name="Reactivează firma").click(); expect(o.get_by_role("button", name="Suspendă firma")).to_be_visible()
    c.goto(B+"/dashboard"); expect(c.get_by_role("heading", name="Contul firmei este suspendat")).to_have_count(0)
    expect(c.get_by_role("heading", name="Lucrări active")).to_be_visible(); ok("reactivare → clientul are din nou acces")
    # conectări
    n=int(sql("select count(*) from login_events")); assert n>=2, n
    o.get_by_role("tab", name="Conectări").click()
    expect(o.get_by_text(re.compile("Ultimele conectări"))).to_be_visible(); expect(o.get_by_text("Cristi").first).to_be_visible()
    o.screenshot(path="shots/73_proprietar_conectari.png", full_page=True); ok(f"conectări înregistrate și afișate ({n})")
    # înscrieri închise
    o.get_by_role("tab", name="Platformă").click(); o.get_by_role("button", name="Închide înscrierile").click()
    expect(o.get_by_role("button", name="Deschide înscrierile")).to_be_visible()
    n2=ctx(); n2.goto(B+"/creare-cont-dyas-7k2m"); n2.get_by_label("Email").fill("nou@x.ro"); n2.get_by_label("Parolă").fill("parola1234"); n2.get_by_role("button", name="Creează cont").click()
    expect(n2.get_by_text("Înscrierea firmelor noi este închisă momentan.")).to_be_visible()
    assert sql("select count(*) from auth.users where email='nou@x.ro'")=="0"
    o.get_by_role("button", name="Deschide înscrierile").click(); expect(o.get_by_role("button", name="Închide înscrierile")).to_be_visible()
    o.get_by_role("button", name="Trimite o alertă de test").click(); expect(o.get_by_text(re.compile("Trimisă"))).to_be_visible()
    assert sql("select count(*) from notifications n join auth.users u on u.id=n.user_id where u.email='dani@dyas.ro' and n.kind='owner_test'")=="1"
    ok("alertă de test trimisă proprietarului")
    o.screenshot(path="shots/74_proprietar_platforma.png", full_page=True); ok("închiderea înscrierilor blochează pagina de creare cont")
    # mobil
    m=o.context.browser.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, locale="ro-RO").new_page()
    m.goto(B+"/login"); m.get_by_label(re.compile("telefon", re.I)).fill("dani@dyas.ro"); m.get_by_label(re.compile("Cod|Parolă")).fill("parola1234")
    m.get_by_role("button", name=re.compile("Intră|Autentific")).click(); m.wait_for_url(re.compile("/dashboard"))
    m.goto(B+"/proprietar"); m.get_by_role("tab", name="Firme").click(); expect(m.get_by_text("Client Construct SRL")).to_be_visible()
    m.screenshot(path="shots/75_proprietar_mobil.png", full_page=True); ok("panoul merge pe telefon")
    b.close()
print("PROBLEME:", probs if probs else "niciuna")
