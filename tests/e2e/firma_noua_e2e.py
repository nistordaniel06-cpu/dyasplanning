# Proprietarul creează o firmă nouă cu emailul și parola administratorului; administratorul intră și își schimbă parola.
import re, subprocess
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:3000"; probs = []
def ok(m): print("✓", m, flush=True)
def sql(q): return subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "dyas_e2e", "-tAc", q], capture_output=True, text=True).stdout.strip()
sql("insert into auth.users(id, email, encrypted_password, email_confirmed_at) values (gen_random_uuid(), 'sef2@dyas.ro', extensions.crypt('Bucur3st!', extensions.gen_salt('bf')), now()) on conflict do nothing")
sql("insert into platform_owners(user_id) select id from auth.users where email='sef2@dyas.ro' on conflict do nothing")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def ctx(w=1280, h=900, mobile=False):
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile, locale="ro-RO", timezone_id="Europe/Bucharest")
        c.grant_permissions(["clipboard-read", "clipboard-write"])
        c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
        pg = c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: probs.append(f"pageerror {e}")); pg.on("dialog", lambda d: d.accept())
        return pg
    def login(pg, user, pw):
        pg.goto(B + "/login"); pg.get_by_label("Număr de telefon").fill(user); pg.get_by_label(re.compile("Parolă|Cod de acces")).fill(pw)
        pg.get_by_role("button", name="Intră în aplicație").click()
    o = ctx(); login(o, "sef2@dyas.ro", "Bucur3st!"); o.wait_for_url(re.compile("/proprietar"))
    o.get_by_role("tab", name="Firme").click(); o.get_by_role("button", name="Firmă nouă").click(); d = o.get_by_role("dialog")
    d.get_by_label("Numele firmei").fill("Instal Expert SRL"); d.get_by_label("Numele administratorului").fill("Maria Ionescu")
    d.get_by_label("Email administrator").fill("maria@instalexpert.ro"); d.locator("input[autocomplete=new-password]").fill("ParolaMaria1")
    d.screenshot(path="shots/120_firma_noua.png")
    d.get_by_role("button", name="Creează firma").click()
    expect(d.get_by_text(re.compile("Firma a fost creată"))).to_be_visible()
    expect(d.get_by_text(re.compile("Parolă: ParolaMaria1"))).to_be_visible()
    d.screenshot(path="shots/121_firma_creata.png"); d.get_by_role("button", name="Gata").click()
    expect(o.locator("main").get_by_text("maria@instalexpert.ro").first).to_be_visible()
    ok("proprietarul creează firma cu emailul și parola administratorului")
    d2 = o.get_by_role("button", name="Firmă nouă"); d2.click(); d = o.get_by_role("dialog")
    d.get_by_label("Numele firmei").fill("Alta"); d.get_by_label("Numele administratorului").fill("X Y")
    d.get_by_label("Email administrator").fill("maria@instalexpert.ro"); d.get_by_role("button", name="Creează firma").click()
    expect(d.get_by_text(re.compile("Există deja un cont"))).to_be_visible(); d.get_by_role("button", name="Renunță").click()
    ok("email deja folosit = mesaj clar")
    m = ctx(390, 844, True); login(m, "maria@instalexpert.ro", "ParolaMaria1"); m.wait_for_url(re.compile("/dashboard"))
    expect(m.locator("header").get_by_text("Instal Expert SRL")).to_be_visible(); ok("administratorul intră imediat, fără confirmare pe email")
    m.goto(B + "/profil"); m.get_by_label("Parolă nouă").fill("NouaParola22"); m.get_by_label("Repetă parola nouă").fill("NouaParola22")
    m.get_by_role("button", name="Salvează parola").click()
    expect(m.get_by_text("Parola a fost schimbată.")).to_be_visible()
    assert sql("select encrypted_password = extensions.crypt('NouaParola22', encrypted_password) from auth.users where email='maria@instalexpert.ro'") == "t"
    ok("pagina Profil are schimbarea parolei")
    o.goto(B + "/profil"); expect(o.get_by_role("heading", name="Schimbă parola")).to_be_visible(); ok("și proprietarul își poate schimba parola din Profil")
    b.close()
print("PROBLEME:", probs if probs else "niciuna")
