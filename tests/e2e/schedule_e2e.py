# Rulează după v3_e2e.py (firma „Construct Test SRL”, lucrarea „Apartament Militari”, angajatul „Ion Pop”).
import re
from playwright.sync_api import sync_playwright, expect
B="http://localhost:3000"; probs=[]
def ok(m): print("✓", m, flush=True)
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    c=b.new_context(viewport={"width":1280,"height":900}, locale="ro-RO", timezone_id="Europe/Bucharest")
    c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
    a=c.new_page(); a.set_default_timeout(15000)
    a.on("pageerror", lambda e: probs.append(f"pageerror {e}"))
    a.on("dialog", lambda d: d.accept())
    a.goto(B+"/login"); a.get_by_label("Număr de telefon").fill("patron@firma.ro"); a.get_by_label("Parolă").fill("parola1234"); a.get_by_role("button", name="Intră în aplicație").click(); a.wait_for_url(re.compile("/dashboard"))
    # Setări: programul implicit
    a.goto(B+"/setari"); card=a.locator("section, div").filter(has=a.get_by_text("Programul de lucru implicit")).last
    expect(a.get_by_label("De la", exact=True)).to_have_value("07:00"); expect(a.get_by_label("Până la", exact=True)).to_have_value("16:00")
    expect(a.get_by_text("= 8h lucrate pe zi")).to_be_visible(); a.screenshot(path="shots/93_setari_program.png", full_page=True); ok("Setări: implicit 07:00–16:00, pauză 60 = 8h")
    # angajat nou: precompletat 07–16 / 60
    a.goto(B+"/angajati"); a.get_by_role("button", name="Adaugă angajat").first.click(); d=a.get_by_role("dialog")
    expect(d.get_by_label("Program — de la")).to_have_value("07:00"); expect(d.get_by_label("Pauză (min)")).to_have_value("60"); expect(d.get_by_text(re.compile(r"= 8h lucrate pe zi"))).to_be_visible()
    d.get_by_role("button", name="Renunță").click(); ok("angajat nou: 07:00–16:00, pauză 60")
    # Ion Pop: program personalizat 06:00–15:00, pauză 30
    a.get_by_text("Ion Pop", exact=True).click(); a.get_by_role("button", name="Modifică").click(); d=a.get_by_role("dialog")
    d.get_by_label("Program — de la").fill("06:00"); d.get_by_label("până la").fill("15:00"); d.get_by_label("Pauză (min)").fill("30")
    expect(d.get_by_text(re.compile(r"= 8h 30m lucrate pe zi"))).to_be_visible(); d.get_by_role("button", name="Salvează").click(); expect(d).to_be_hidden()
    expect(a.get_by_text(re.compile(r"06:00–15:00 · pauză 30 min · 8h 30m / zi"))).to_be_visible(); ok("program personalizat pe angajat (06:00–15:00, pauză 30)")
    # alocare: Ion primește programul lui
    a.goto(B+"/planning/aloca"); a.get_by_text("Apartament Militari").first.click()
    a.get_by_text("Ion Pop").first.click()
    a.get_by_text(re.compile("Personalizează pe angajat")).click()
    row=a.locator("input[type=time]")
    vals=[row.nth(i).input_value() for i in range(row.count())]
    assert "06:00" in vals and "15:00" in vals, vals; ok("alocare: Ion primește automat programul lui")
    # pontaj nou: 07–16, pauză 60 = 8h (programul adminului)
    a.goto(B+"/pontaje"); a.get_by_role("button", name="Adaugă pontaj").first.click(); d=a.get_by_role("dialog")
    expect(d.get_by_label("Pauze (min)")).to_have_value("60"); expect(d.get_by_text(re.compile(r"8h(?! \d)")).first).to_be_visible()
    d.screenshot(path="shots/94_pontaj_8h.png"); ok("pontaj nou: 07:00–16:00, pauză 60 = 8h")
    b.close()
print("PROBLEME:", probs if probs else "niciuna")
