"""E2E: fluxul complet DYASPlanning pe telefon (390x844), apoi verificări pe desktop."""
import os, re, sys, datetime
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:3000"
SHOTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
TODAY = datetime.date.today().isoformat()
step_no = 0

def shot(page, name):
    global step_no
    step_no += 1
    page.screenshot(path=f"{SHOTS}/{step_no:02d}_{name}.png", full_page=True)

def ok(msg):
    print("✓", msg, flush=True)

def dialog(page):
    return page.get_by_role("dialog")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox"])
    phone = dict(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2, locale="ro-RO", timezone_id="Europe/Bucharest")
    admin_ctx = browser.new_context(**phone)
    page = admin_ctx.new_page()
    page.set_default_timeout(15000)
    errors = []
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))

    # 1. Cont + firmă
    page.goto(f"{BASE}/dashboard")
    expect(page).to_have_url(re.compile(r"/login"))
    page.get_by_role("tab", name="Cont nou").click()
    page.get_by_label("Email").fill("admin@construct.ro")
    page.get_by_label("Parolă").fill("parola123")
    shot(page, "login")
    page.get_by_role("button", name="Creează cont").click()
    expect(page).to_have_url(re.compile(r"/onboarding"))
    page.get_by_role("tab", name="Înființez firma").click()
    page.get_by_label("Numele firmei").fill("Construct Grup SRL")
    page.get_by_label("Numele tău").fill("Dan Popa")
    page.get_by_role("button", name="Creează firma").click()
    expect(page).to_have_url(re.compile(r"/dashboard"))
    expect(page.get_by_role("heading", name="Dashboard")).to_be_visible()
    shot(page, "dashboard_gol")
    ok("cont creat, firmă înființată, administrator pe dashboard")

    # 2. Angajați
    page.goto(f"{BASE}/angajati")
    for name, trade in [("Ion Popescu", "Rigipsar"), ("Mihai Ionescu", "Electrician"), ("Andrei Vasile", "Zugrav")]:
        page.get_by_role("button", name="Adaugă angajat").first.click()
        d = dialog(page)
        d.get_by_label("Nume și prenume").fill(name)
        d.get_by_label("Meserie").fill(trade)
        d.get_by_label("Telefon").fill("0722000000")
        d.get_by_role("button", name="Adaugă angajat").click()
        expect(d).to_be_hidden()
        expect(page.get_by_text(name)).to_be_visible()
    shot(page, "angajati")
    ok("3 angajați creați")

    # 3. Lucrări + misiuni
    def add_project(name, addr, city):
        page.goto(f"{BASE}/lucrari")
        page.get_by_role("button", name="Adaugă lucrare").first.click()
        d = dialog(page)
        d.get_by_label("Nume lucrare").fill(name)
        d.get_by_label("Adresă").fill(addr)
        d.get_by_label("Localitate").fill(city)
        d.get_by_label("Status").select_option("in_desfasurare")
        d.get_by_role("button", name="Adaugă lucrare").click()
        expect(page).to_have_url(re.compile(r"/lucrari/[0-9a-f-]{36}"))
        expect(page.get_by_role("heading", name=name)).to_be_visible()
        return page.url
    url1 = add_project("Renovare apartament — București", "Str. Lujerului 10", "București")
    for t in ["Montaj rigips", "Instalație electrică", "Pregătire pereți"]:
        page.get_by_role("button", name="Misiune").click()
        d = dialog(page)
        d.get_by_label("Denumire").fill(t)
        d.get_by_role("button", name="Salvează").click()
        expect(d).to_be_hidden()
        expect(page.get_by_text(t, exact=True)).to_be_visible()
    shot(page, "lucrare_detaliu")
    url2 = add_project("Casă Ploiești", "Str. Republicii 3", "Ploiești")
    ok("2 lucrări în locații diferite, 3 misiuni")

    # 4. Alocă 3 angajați, aceeași lucrare, misiuni diferite
    page.goto(url1)
    page.get_by_role("link", name="Alocă angajați").click()
    expect(page.get_by_role("heading", name="Alocă angajați")).to_be_visible()
    expect(page.get_by_text("Renovare apartament — București").first).to_be_visible()
    page.get_by_label(re.compile(r"^Misiune \(pentru toți")).select_option(label="Montaj rigips")
    for n in ["Ion Popescu", "Mihai Ionescu", "Andrei Vasile"]:
        btn = page.locator("button[aria-pressed]").filter(has_text=n)
        expect(btn.get_by_text("Disponibil")).to_be_visible()
        btn.click()
    page.get_by_label("Ziua").fill(TODAY)
    def per(name):
        return page.locator("div.rounded-lg.border").filter(has=page.get_by_text(name, exact=True)).filter(has=page.locator("select"))
    m = per("Mihai Ionescu")
    m.get_by_label("Misiune").select_option(label="Instalație electrică")
    m.get_by_label("Până la").fill("14:00")
    a = per("Andrei Vasile")
    a.get_by_label("Misiune").select_option(label="Pregătire pereți")
    a.get_by_label("De la").fill("10:00")
    a.get_by_label("Până la").fill("18:00")
    expect(page.get_by_text("Toți angajații selectați sunt disponibili")).to_be_visible()
    shot(page, "aloca_verificare")
    page.get_by_role("button", name="Salvează alocările").click()
    expect(page.get_by_role("heading", name="Alocări salvate")).to_be_visible()
    expect(page.get_by_text("3 alocări au fost create")).to_be_visible()
    shot(page, "aloca_salvat")
    ok("criteriu: 3 angajați, aceeași lucrare, misiuni și intervale diferite")

    # 5. Altă lucrare, altă locație — mai întâi un conflict, apoi o alocare validă
    page.get_by_role("button", name="Alocă altă echipă").click()
    page.locator("button").filter(has_text="Casă Ploiești").click()
    page.locator("button[aria-pressed]").filter(has_text="Ion Popescu").click()
    page.get_by_label("Ziua").fill(TODAY)
    page.get_by_label("De la").first.fill("15:00")
    page.get_by_label("Până la").first.fill("17:00")
    expect(page.get_by_text(re.compile(r"Conflict:.*Ion Popescu are deja o alocare 08:00–16:00"))).to_be_visible()
    expect(page.get_by_role("button", name="Salvează alocările")).to_be_disabled()
    shot(page, "aloca_conflict")
    ok("criteriu: suprapunerea este detectată, salvarea e blocată")
    page.get_by_label("De la").first.fill("16:00")
    page.get_by_label("Până la").first.fill("18:00")
    page.get_by_label("Pauză (min)").first.fill("0")
    expect(page.get_by_text(re.compile(r"Atenție:.*locații diferite"))).to_be_visible()
    expect(page.get_by_role("button", name="Salvează alocările")).to_be_enabled()
    shot(page, "aloca_deplasare")
    page.get_by_role("button", name="Salvează alocările").click()
    expect(page.get_by_role("heading", name="Alocări salvate")).to_be_visible()
    ok("criteriu: lucrări simultane în locații diferite + avertizare de deplasare")

    # 6. Planning pe telefon: agendă, mutarea lui Mihai prin atingere
    page.goto(f"{BASE}/planning")
    expect(page.get_by_text("Renovare apartament — București").filter(visible=True).first).to_be_visible()
    expect(page.get_by_text("Casă Ploiești").filter(visible=True).first).to_be_visible()
    shot(page, "planning_telefon")
    page.locator("button").filter(has_text="Mihai Ionescu").filter(has_text="08:00–14:00").click()
    d = dialog(page)
    expect(d.get_by_role("heading", name="Modifică alocarea")).to_be_visible()
    d.get_by_label("De la").fill("09:00")
    d.get_by_label("Până la").fill("15:00")
    shot(page, "planning_editare")
    d.get_by_role("button", name="Salvează").click()
    expect(page.get_by_text("Modificarea a fost salvată.")).to_be_visible()
    expect(page.locator("button").filter(has_text="Mihai Ionescu").filter(has_text="09:00–15:00")).to_be_visible()
    expect(page.locator("button").filter(has_text="Ion Popescu").filter(has_text="08:00–16:00")).to_be_visible()
    expect(page.locator("button").filter(has_text="Andrei Vasile").filter(has_text="10:00–18:00")).to_be_visible()
    ok("criteriu: mutarea alocării lui Mihai nu a modificat programul colegilor")

    # 7. Invitație pentru Ion
    page.goto(f"{BASE}/angajati")
    page.get_by_text("Ion Popescu").click()
    page.get_by_role("button", name="Invită în aplicație").click()
    dialog(page).get_by_role("button", name="Generează cod").click()
    code_el = dialog(page).locator("div.font-mono")
    expect(code_el).to_have_text(re.compile(r"^[0-9A-F]{8}$"))
    code = code_el.inner_text().strip()
    shot(page, "invitatie")
    dialog(page).get_by_role("button", name="Gata").click()
    ok(f"cod de invitație generat: {code}")

    # 8. Ion: cont, cod, Astăzi, pontaj
    ion_ctx = browser.new_context(**phone)
    ip = ion_ctx.new_page()
    ip.set_default_timeout(15000)
    ip.goto(f"{BASE}/login")
    ip.get_by_role("tab", name="Cont nou").click()
    ip.get_by_label("Email").fill("ion@construct.ro")
    ip.get_by_label("Parolă").fill("parola123")
    ip.get_by_role("button", name="Creează cont").click()
    expect(ip).to_have_url(re.compile(r"/onboarding"))
    ip.get_by_label("Cod de invitație").fill(code)
    ip.get_by_role("button", name="Alătură-te firmei").click()
    expect(ip).to_have_url(re.compile(r"/astazi"))
    expect(ip.get_by_text("Montaj rigips")).to_be_visible()
    expect(ip.get_by_text("Str. Lujerului 10, București")).to_be_visible()
    expect(ip.get_by_text("08:00 – 16:00")).to_be_visible()
    expect(ip.get_by_text("Mihai Ionescu — Instalație electrică")).to_be_visible()
    shot(ip, "ion_astazi")
    ok("criteriu: angajatul își vede misiunea, adresa, intervalul și colegii")

    ip.goto(f"{BASE}/planning")
    expect(ip.get_by_text("Acces restricționat")).to_be_visible()
    ok("angajatul nu are acces la planning")

    ip.goto(f"{BASE}/astazi")
    ip.get_by_role("link", name="Adaugă orele").first.click()
    d = dialog(ip)
    expect(d.get_by_role("heading", name="Adaugă pontaj")).to_be_visible()
    d.get_by_label("Sfârșit").fill("16:20")
    expect(d.get_by_text("7h 50m")).to_be_visible()
    shot(ip, "ion_pontaj_form")
    d.get_by_role("button", name="Trimite pontaj").click()
    expect(ip.get_by_text("Pontaj trimis spre aprobare.")).to_be_visible()
    expect(ip.get_by_text("Trimis").first).to_be_visible()
    shot(ip, "ion_pontaj_trimis")
    ok("criteriu: angajatul trimite orele lucrate")

    # 9. Admin: aprobare + raport
    page.goto(f"{BASE}/pontaje")
    expect(page.get_by_text("Ion Popescu").filter(visible=True).first).to_be_visible()
    shot(page, "admin_de_aprobat")
    page.get_by_role("button", name="Aprobă", exact=True).first.click()
    expect(page.get_by_text("Pontaj aprobat.")).to_be_visible()
    ok("administratorul a aprobat pontajul")

    page.goto(f"{BASE}/rapoarte")
    row = page.locator("tr").filter(has_text="Ion Popescu")
    expect(row).to_contain_text("9h 30m")   # planificat: 08–16 (−30) + 16–18
    expect(row).to_contain_text("7h 50m")   # aprobat: 08:00–16:20 (−30)
    shot(page, "raport")
    page.reload()
    expect(page.locator("tr").filter(has_text="Ion Popescu")).to_contain_text("7h 50m")
    ok("criteriu: totaluri corecte în raport și date păstrate după reîncărcare")

    ip.goto(f"{BASE}/pontaj")
    expect(ip.get_by_text("Aprobat").first).to_be_visible()
    ok("angajatul vede pontajul aprobat")

    # 10. Desktop
    desk = browser.new_context(viewport={"width": 1440, "height": 900}, locale="ro-RO", timezone_id="Europe/Bucharest", storage_state=admin_ctx.storage_state())
    dp = desk.new_page()
    dp.set_default_timeout(15000)
    dp.goto(f"{BASE}/planning")
    card = dp.locator("[role=button][aria-label^='Casă Ploiești']")
    expect(card).to_be_visible()
    shot(dp, "desktop_planning_zi")
    box = card.bounding_box()
    track = dp.locator("[data-row]").first.bounding_box()
    px_per_hour = track["width"] / 14  # 06–20
    dp.mouse.move(box["x"] + 10, box["y"] + box["height"] / 2)
    dp.mouse.down()
    dp.mouse.move(box["x"] + 10 + px_per_hour * 0.5, box["y"] + box["height"] / 2, steps=8)
    dp.mouse.move(box["x"] + 10 + px_per_hour * 1.0, box["y"] + box["height"] / 2, steps=8)
    dp.mouse.up()
    expect(dp.get_by_text(re.compile("Alocarea a fost mutată și salvată|Salvat"))).to_be_visible()
    expect(dp.locator("[role=button][aria-label^='Casă Ploiești, 17:00–19:00']")).to_be_visible()
    shot(dp, "desktop_dupa_drag")
    ok("drag-and-drop pe desktop: alocarea mutată cu o oră și salvată")
    dp.get_by_role("tab", name="Săptămână").click()
    expect(dp.get_by_text("Ion Popescu").filter(visible=True).first).to_be_visible()
    shot(dp, "desktop_planning_saptamana")
    dp.goto(f"{BASE}/dashboard")
    expect(dp.get_by_text("Cine lucrează astăzi")).to_be_visible()
    shot(dp, "desktop_dashboard")

    real_errors = [e for e in errors if "favicon" not in e]
    print("Erori consolă (telefon admin):", real_errors[:5])
    browser.close()
    print("E2E COMPLET")
