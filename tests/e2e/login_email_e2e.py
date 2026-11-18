# Autentificare: tab „Cu email” (tastatură cu litere) pentru administratori, „Cu telefon” implicit. Rulează după v3_e2e.py.
import re
from playwright.sync_api import sync_playwright, expect
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    c=b.new_context(viewport={"width":390,"height":844}, is_mobile=True, has_touch=True, locale="ro-RO")
    c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
    pg=c.new_page(); pg.set_default_timeout(15000)
    pg.goto("http://localhost:3000/login")
    pg.get_by_role("tab", name="Cu email").click()
    inp=pg.get_by_label("Email"); assert inp.get_attribute("inputmode")=="email" and inp.get_attribute("type")=="email"
    inp.press_sequentially("patron@firma.ro"); pg.get_by_label("Parolă").fill("parola1234")
    pg.screenshot(path="shots/130_login_email.png")
    pg.get_by_role("button", name="Intră în aplicație").click(); pg.wait_for_url(re.compile("/dashboard")); print("✓ autentificare cu tab-ul Email (tastatură cu litere)")
    c2=b.new_context(viewport={"width":390,"height":844}, is_mobile=True, locale="ro-RO"); p2=c2.new_page()
    p2.goto("http://localhost:3000/login"); assert p2.get_by_label("Număr de telefon").get_attribute("inputmode")=="tel"; print("✓ implicit: telefon, tastatură cu cifre")
    b.close()
