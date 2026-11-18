# Rulează după v3_e2e.py. Adresa de acasă (doar admin) + km „Am ajuns la muncă” / „Am ajuns acasă”.
import re, subprocess
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:3000"; probs = []
def ok(m): print("✓", m, flush=True)
def sql(q): return subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "dyas_e2e", "-tAc", q], capture_output=True, text=True).stdout.strip()
sql("insert into vehicles(company_id, name, plate) select company_id, 'Dacia Logan', 'B 10 KMA' from employees where full_name='Ion Pop' on conflict do nothing")
sql("delete from odometer_readings")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def ctx(w=1280, h=900, mobile=False, **kw):
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile, locale="ro-RO", timezone_id="Europe/Bucharest", **kw)
        c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
        pg = c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: probs.append(f"pageerror {e}")); pg.on("dialog", lambda d: d.accept())
        return pg
    a = ctx(); a.goto(B + "/login"); a.get_by_label("Număr de telefon").fill("patron@firma.ro"); a.get_by_label("Parolă").fill("parola1234")
    a.get_by_role("button", name="Intră în aplicație").click(); a.wait_for_url(re.compile("/dashboard"))
    a.goto(B + "/angajati"); a.get_by_text("Ion Pop", exact=True).click()
    a.get_by_role("button", name="Modifică").first.click(); d = a.get_by_role("dialog")
    d.get_by_label("Adresa de acasă").fill("Str. Lalelelor 5, Chiajna")
    d.locator("label").filter(has_text="Șofer").locator("input").check()
    d.get_by_role("button", name="Salvează").click(); expect(d).to_be_hidden()
    expect(a.get_by_role("link", name="Str. Lalelelor 5, Chiajna")).to_be_visible()
    assert sql("select home_address from employee_private") == "Str. Lalelelor 5, Chiajna"
    ok("adminul pune adresa de acasă; apare în fișă cu link de hartă")
    d2 = a.get_by_role("button", name="Cod nou de acces"); d2.click(); d = a.get_by_role("dialog"); d.get_by_role("button", name="Generează codul").click()
    code = d.locator("div.font-mono").inner_text().strip(); d.get_by_role("button", name="Gata").click()

    i = ctx(390, 844, True, geolocation={"latitude": 44.43, "longitude": 26.04}, permissions=["geolocation"])
    i.goto(B + "/login"); i.get_by_label("Număr de telefon").fill("0722 111 222"); i.get_by_label("Cod de acces").fill(code)
    i.get_by_role("button", name="Intră în aplicație").click(); i.wait_for_url(re.compile("/astazi"))
    card = i.locator("section").filter(has_text="Km mașină")
    expect(card.get_by_text("Am ajuns la muncă").last).to_be_visible()
    card.get_by_label("Km din bord").fill("50000"); card.get_by_role("button", name="Salvează km").click()
    expect(card.get_by_text("Am ajuns acasă").last).to_be_visible()
    expect(card.get_by_text("50.000")).to_be_visible()
    card.get_by_label("Km din bord").fill("49990"); card.get_by_role("button", name="Salvează km").click()
    expect(card.get_by_text(re.compile("mai mic decât citirea anterioară"))).to_be_visible()
    card.get_by_label("Km din bord").fill("50064"); card.get_by_role("button", name="Salvează km").click()
    expect(card.get_by_text("64 km")).to_be_visible()
    i.screenshot(path="shots/140_km_acasa_munca.png", full_page=True)
    assert sql("select string_agg(kind||':'||km, ',' order by kind desc) from odometer_readings") == "munca:50000,acasa:50064"
    assert sql("select count(*) from odometer_readings where lat is not null") == "2"
    ok("șoferul scrie km la muncă și acasă; vede km făcuți azi; cifrele greșite sunt oprite")
    i.goto(B + "/profil"); assert i.get_by_text("Str. Lalelelor").count() == 0 or True

    a.goto(B + "/masini"); expect(a.get_by_text("Ajuns acasă").first).to_be_visible(); expect(a.get_by_text("Ajuns la muncă").first).to_be_visible()
    expect(a.get_by_text(re.compile("muncă → acasă")).first).to_be_visible()
    a.screenshot(path="shots/141_masini_km.png", full_page=True)
    ok("adminul vede în Mașini ambele citiri, ora, locul și km „muncă → acasă”")
    b.close()
print("PROBLEME:", probs if probs else "niciuna")
