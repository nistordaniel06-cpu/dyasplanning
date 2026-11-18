# Rulează după v3_e2e.py (firma „Construct Test SRL”, adminul patron@firma.ro, angajatul Ion Pop).
# Acoperă: proprietarul modifică firma și aplicația firmei (nume, link, culoare).
import re, subprocess, json, urllib.request
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:3000"; probs = []
def ok(m): print("✓", m, flush=True)
def sql(q): return subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "dyas_e2e", "-tAc", q], capture_output=True, text=True).stdout.strip()

sql("insert into auth.users(id, email, encrypted_password, email_confirmed_at) values (gen_random_uuid(), 'sef@dyas.ro', extensions.crypt('Bucur3st!', extensions.gen_salt('bf')), now()) on conflict do nothing")
sql("insert into platform_owners(user_id) select id from auth.users where email='sef@dyas.ro' on conflict do nothing")

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def ctx(w=1280, h=900, mobile=False):
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile, locale="ro-RO", timezone_id="Europe/Bucharest")
        c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
        pg = c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: probs.append(f"pageerror {e}")); pg.on("dialog", lambda d: d.accept())
        return pg
    def login(pg, user, pw):
        pg.goto(B + "/login"); pg.get_by_label("Număr de telefon").fill(user); pg.get_by_label(re.compile("Parolă|Cod de acces")).fill(pw)
        pg.get_by_role("button", name="Intră în aplicație").click()

    o = ctx(); login(o, "sef@dyas.ro", "Bucur3st!"); o.wait_for_url(re.compile("/proprietar"))
    ok("al doilea proprietar intră direct în panou")
    o.get_by_role("tab", name="Firme").click()
    o.locator("main").get_by_role("button").filter(has_text="Construct Test SRL").first.click()
    # 1) modificarea firmei + aplicația ei
    o.get_by_label("Numele firmei").fill("Construct Test SRL")
    o.get_by_label("Numele aplicației").fill("Pop Construct")
    o.get_by_role("button", name="Generează").click(); expect(o.get_by_label("Link propriu")).to_have_value("pop-construct")
    o.get_by_role("button", name="Culoare #2563eb").click()
    o.get_by_label("Pauză (min)").last.fill("45")
    o.get_by_role("button", name="Salvează firma și aplicația").click()
    expect(o.get_by_text(re.compile("Salvat. Utilizatorii firmei"))).to_be_visible()
    expect(o.locator("a[href$='/app/pop-construct']")).to_be_visible()
    assert sql("select app_name||'|'||app_slug||'|'||brand_color||'|'||default_break_minutes from companies where name='Construct Test SRL'") == "Pop Construct|pop-construct|#2563eb|45"
    o.screenshot(path="shots/110_editare_firma.png", full_page=True); ok("proprietarul modifică firma: nume aplicație, link, culoare, program")

    # 2) adminul firmei vede aplicația cu numele și culoarea noi
    a = ctx(); login(a, "patron@firma.ro", "parola1234"); a.wait_for_url(re.compile("/dashboard"))
    expect(a.locator("aside").get_by_text("Pop Construct")).to_be_visible()
    c600 = a.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--color-orange-600').trim()")
    assert c600 == "#2563eb", c600
    a.screenshot(path="shots/111_aplicatie_albastra.png"); ok("adminul firmei vede „Pop Construct” în albastru")

    # 3) linkul propriu al aplicației
    n = ctx(390, 844, True); n.goto(B + "/app/pop-construct"); n.wait_for_url(re.compile("/login"))
    expect(n.get_by_text("Pop Construct").first).to_be_visible()
    href = n.locator('#app-manifest').get_attribute("href"); assert "app=pop-construct" in href, href
    m = json.loads(urllib.request.urlopen(B + href).read()); assert m["name"] == "Pop Construct" and m["theme_color"] == "#2563eb", m
    icon = urllib.request.urlopen(B + m["icons"][0]["src"]); assert icon.headers["content-type"] == "image/png"
    n.screenshot(path="shots/112_link_aplicatie.png"); ok("linkul /app/pop-construct: autentificare, manifest și iconiță cu numele/culoarea firmei")
    n.goto(B + "/app/nu-exista"); expect(n.get_by_text("Linkul aplicației nu există")).to_be_visible(); ok("link greșit = mesaj clar")

    b.close()
print("PROBLEME:", probs if probs else "niciuna")
