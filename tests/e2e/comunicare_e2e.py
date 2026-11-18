# Rulează după v3_e2e.py. Proprietarul: mesaj direct + banner, „Ce e nou”, cereri de ajutor, mod mentenanță.
import re, subprocess
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:3000"; probs = []
def ok(m): print("✓", m, flush=True)
def sql(q): return subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "dyas_e2e", "-tAc", q], capture_output=True, text=True).stdout.strip()
sql("insert into auth.users(id, email, encrypted_password, email_confirmed_at) values (gen_random_uuid(), 'sef3@dyas.ro', extensions.crypt('Bucur3st!', extensions.gen_salt('bf')), now()) on conflict do nothing")
sql("insert into platform_owners(user_id) select id from auth.users where email='sef3@dyas.ro' on conflict do nothing")
# noutățile se arată doar celor cu cont mai vechi decât noutatea
sql("update auth.users set created_at = now() - interval '1 day' where email in ('patron@firma.ro')")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def ctx(w=1280, h=900, mobile=False):
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile, locale="ro-RO", timezone_id="Europe/Bucharest")
        c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
        pg = c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: probs.append(f"pageerror {e}")); pg.on("dialog", lambda d: d.accept())
        return pg
    def login(pg, user, pw):
        pg.goto(B + "/login"); pg.get_by_label("Număr de telefon").fill(user); pg.get_by_label(re.compile("Parolă")).fill(pw)
        pg.get_by_role("button", name="Intră în aplicație").click()
    o = ctx(); login(o, "sef3@dyas.ro", "Bucur3st!"); o.wait_for_url(re.compile("/proprietar"))

    # 1) mesaj direct + banner
    o.get_by_role("tab", name="Mesaje").click()
    o.get_by_label("Firma").select_option(label="Construct Test SRL"); o.get_by_label("Către").select_option(label="Doar administratorii")
    o.get_by_label("Titlu").fill("Am adăugat backup-ul"); o.get_by_label("Mesaj", exact=True).fill("Îl găsiți în Setări.")
    o.get_by_label("Afișează și ca banner în aplicația firmei").check(); o.get_by_role("button", name="Trimite").click()
    expect(o.get_by_text(re.compile("Trimis către 1"))).to_be_visible(); expect(o.get_by_text("Am adăugat backup-ul").last).to_be_visible()
    ok("proprietarul trimite mesaj adminilor firmei, cu banner")

    # 2) Ce e nou
    o.get_by_role("tab", name="Ce e nou").click(); o.get_by_role("button", name="Noutate nouă").click(); d = o.get_by_role("dialog")
    d.get_by_label("Titlu").fill("Km și seara"); d.get_by_label("Ce e nou").fill("Șoferii scriu km și când ajung acasă.")
    d.get_by_role("button", name="Publică").click(); expect(d).to_be_hidden(); expect(o.get_by_text("Km și seara")).to_be_visible()
    ok("proprietarul publică o noutate")

    a = ctx(390, 844, True); login(a, "patron@firma.ro", "parola1234"); a.wait_for_url(re.compile("/dashboard"))
    nd = a.get_by_role("dialog"); expect(nd.get_by_text("Km și seara")).to_be_visible()
    a.screenshot(path="shots/160_ce_e_nou.png"); nd.get_by_role("button", name="Am înțeles").click(); expect(nd).to_be_hidden()
    expect(a.get_by_text("Am adăugat backup-ul").first).to_be_visible()
    a.wait_for_timeout(1000); a.reload(); a.wait_for_timeout(2000)
    assert a.get_by_role("dialog").count() == 0, a.get_by_role("dialog").first.inner_text()
    assert sql("select count(*) from notifications n join auth.users u on u.id=n.user_id where u.email='patron@firma.ro' and kind='owner_message'") == "1"
    ok("adminul vede „Ce e nou” o singură dată, bannerul și notificarea mesajului")

    # 3) cerere de ajutor
    a.get_by_role("link", name="Ajutor").first.click(); a.wait_for_url(re.compile("/ajutor"))
    a.get_by_label("Cu ce te putem ajuta?").fill("Cum adaug un șofer nou?"); a.get_by_role("button", name="Trimite").click()
    expect(a.get_by_text(re.compile("Mesajul a fost trimis"))).to_be_visible()
    o.reload(); o.get_by_role("tab", name=re.compile("Ajutor")).click()
    expect(o.get_by_role("tab", name=re.compile(r"Ajutor\s*1"))).to_be_visible()
    o.get_by_text("Cum adaug un șofer nou?").click(); d = o.get_by_role("dialog")
    expect(d.get_by_text(re.compile("/dashboard"))).to_be_visible()
    d.get_by_label("Răspunsul tău").fill("Angajați → fișa omului → Modifică → bifează Șofer."); d.get_by_role("button", name="Trimite și închide").click(); expect(d).to_be_hidden()
    a.reload(); expect(a.get_by_text(re.compile("Angajați → fișa omului"))).to_be_visible(); expect(a.get_by_text("Rezolvată")).to_be_visible()
    a.screenshot(path="shots/161_ajutor.png", full_page=True)
    ok("cererea de ajutor ajunge la proprietar (cu pagina de unde a scris), răspunsul ajunge înapoi")

    # 4) mentenanță
    o.get_by_role("tab", name="Platformă").click(); o.get_by_role("button", name="Pornește mentenanța").click()
    expect(o.get_by_text("Mentenanța e pornită.")).to_be_visible()
    expect(o.get_by_text("Mod mentenanță pornit.")).to_be_visible()
    a.reload(); expect(a.get_by_role("heading", name="Aplicația se actualizează")).to_be_visible()
    a.screenshot(path="shots/162_mentenanta.png")
    n = ctx(390, 844, True); n.goto(B + "/login"); expect(n.get_by_text("Aplicația se actualizează.", exact=True)).to_be_visible()
    ok("mentenanță: utilizatorii văd ecranul de mentenanță, proprietarul doar o bară, pagina de login avertizează")
    o.get_by_role("button", name="Oprește mentenanța").click(); expect(o.get_by_text("Mentenanța e pornită.")).to_be_hidden()
    a.reload(); expect(a.get_by_role("heading", name="Aplicația se actualizează")).to_be_hidden(); expect(a.get_by_role("heading", name="Ajutor")).to_be_visible()
    ok("oprirea mentenanței readuce aplicația")
    b.close()
print("PROBLEME:", probs if probs else "niciuna")
