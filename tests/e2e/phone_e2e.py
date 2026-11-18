import re
from playwright.sync_api import sync_playwright, expect
B="http://localhost:3000"; probs=[]
def ok(m): print("✓", m, flush=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def ctx(w=390,h=844,mobile=True,tz="Europe/Bucharest"):
        c=b.new_context(viewport={"width":w,"height":h}, is_mobile=mobile, has_touch=mobile, locale="ro-RO", timezone_id=tz)
        c.add_init_script("try{localStorage.getItem('dyas.loc')||localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.getItem('dyas.push')||localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}"); pg=c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: probs.append(f"pageerror {e}"))
        pg.on("console", lambda m: m.type=="error" and not re.search(r"WebSocket|realtime|Failed to load resource", m.text) and probs.append(m.text))
        return pg
    a=ctx(1280,860,False)
    a.goto(B+"/creare-cont-dyas-7k2m")
    a.get_by_label("Email").fill("sef@bouw.nl"); a.get_by_label("Parolă").fill("parola1234"); a.get_by_role("button", name="Creează cont").click()
    a.wait_for_url(re.compile("/onboarding")); a.get_by_role("tab", name="Înființez firma").click()
    a.get_by_label("Numele firmei").fill("Bouw Team BV"); a.get_by_label("Numele tău").fill("Dani")
    fus=a.get_by_label("Fus orar")
    if fus.count(): fus.select_option("Europe/Amsterdam")
    a.get_by_role("button", name="Creează firma").click(); a.wait_for_url(re.compile("/dashboard")); ok("firmă creată")
    # angajat olandez, număr local
    a.goto(B+"/angajati"); a.get_by_role("button", name="Adaugă angajat").first.click()
    d=a.get_by_role("dialog"); d.get_by_label("Nume și prenume").fill("Jan de Vries")
    d.get_by_label("Țara").select_option("NL"); d.get_by_label("Telefon (WhatsApp)").fill("06 1234 5678")
    d.screenshot(path="shots/80_telefon_tara.png")
    d.get_by_role("button", name="Adaugă angajat").click(); expect(d).to_be_hidden()
    a.get_by_text("Jan de Vries", exact=True).click(); expect(a.get_by_text("+31 612345678")).to_be_visible(); ok("numărul olandez salvat ca +31 612345678")
    a.get_by_role("button", name="Acces în aplicație").click(); d=a.get_by_role("dialog"); d.get_by_role("button", name="Generează codul").click()
    code=d.locator("div.font-mono").inner_text().strip()
    href=d.get_by_role("link").filter(has_text="Trimite pe WhatsApp").get_attribute("href"); assert href.startswith("https://wa.me/31612345678?text="), href
    d.get_by_role("button", name="Gata").click(); ok("link WhatsApp către +31 612345678")
    # angajat din Moldova scris direct cu prefix
    a.goto(B+"/angajati"); a.get_by_role("button", name="Adaugă angajat").first.click()
    d=a.get_by_role("dialog"); d.get_by_label("Nume și prenume").fill("Ion Rusu"); d.get_by_label("Telefon (WhatsApp)").fill("+373 69 123 456")
    expect(d.get_by_label("Țara")).to_be_disabled()
    d.get_by_role("button", name="Adaugă angajat").click(); expect(d).to_be_hidden()
    a.get_by_text("Ion Rusu", exact=True).click(); expect(a.get_by_text("+373 69123456")).to_be_visible(); ok("număr scris cu +373 → salvat corect")
    # număr prea scurt
    a.goto(B+"/angajati"); a.get_by_role("button", name="Adaugă angajat").first.click()
    d=a.get_by_role("dialog"); d.get_by_label("Nume și prenume").fill("Test"); d.get_by_label("Telefon (WhatsApp)").fill("123")
    expect(d.get_by_text("Numărul pare prea scurt.")).to_be_visible(); d.get_by_role("button", name="Renunță").click(); ok("validare număr prea scurt")
    # Jan intră de pe telefonul lui (fus orar Olanda → țara preselectată)
    j=ctx(tz="Europe/Amsterdam"); j.goto(B+"/login")
    expect(j.get_by_label("Țara")).to_have_value("NL")
    j.get_by_label("Număr de telefon").fill("06 1234 5678"); j.get_by_label("Cod de acces").fill(code)
    j.screenshot(path="shots/81_login_olanda.png")
    j.get_by_role("button", name="Intră în aplicație").click(); j.wait_for_url(re.compile("/astazi")); ok("Jan intră cu 06 1234 5678 + Olanda")
    # admin cu email: câmpul nu pierde focusul la „@”
    e=ctx(); e.goto(B+"/login"); f=e.get_by_label("Număr de telefon"); f.click(); e.keyboard.type("sef@bouw.nl")
    expect(f).to_have_value("sef@bouw.nl"); expect(e.get_by_label("Țara")).to_have_count(0)
    e.get_by_label("Parolă").fill("parola1234"); e.get_by_role("button", name="Intră în aplicație").click(); e.wait_for_url(re.compile("/dashboard")); ok("adminul intră cu email (fără selector de țară)")
    b.close()
print("PROBLEME:", probs if probs else "niciuna")
