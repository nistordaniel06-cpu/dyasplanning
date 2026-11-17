"""Smoke test pentru ecranele neacoperite de flow.py (rulează după flow.py, pe aceleași date)."""
import os, re, datetime
from playwright.sync_api import sync_playwright, expect

BASE = "http://localhost:3000"
TOMORROW = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
problems = []

def ok(m): print("✓", m, flush=True)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), args=["--no-sandbox"])
    def ctx(w=1280, h=860, mobile=False):
        c = b.new_context(viewport={"width": w, "height": h}, is_mobile=mobile, has_touch=mobile, locale="ro-RO", timezone_id="Europe/Bucharest")
        pg = c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: problems.append(f"pageerror: {e}"))
        pg.on("console", lambda m: m.type == "error" and problems.append(f"console: {m.text}"))
        return pg
    def login(pg, email):
        pg.goto(f"{BASE}/login"); pg.get_by_label("Email").fill(email); pg.get_by_label("Parolă").fill("parola123")
        pg.get_by_role("button", name="Intră în cont").click(); pg.wait_for_url(re.compile(r"/(dashboard|astazi)"))
    def no_error_box(pg, where):
        alerts = pg.locator("[role=alert]").filter(has_text=re.compile(r".+")).filter(visible=True)
        texts = [t for t in alerts.all_inner_texts() if t.strip()]
        if texts: problems.append(f"{where}: {texts}")

    a = ctx()
    login(a, "admin@construct.ro")

    # Setări: echipă + șef
    a.goto(f"{BASE}/setari")
    expect(a.get_by_text("admin@construct.ro")).to_be_visible()
    a.get_by_placeholder("Nume echipă nouă").fill("Echipa Nord")
    a.get_by_role("button", name="Adaugă echipă").click()
    expect(a.get_by_text("Echipa a fost creată.")).to_be_visible()
    no_error_box(a, "setari"); ok("Setări: utilizatori + echipă creată")

    # Angajat nou (George) în echipă, șef de echipă
    a.goto(f"{BASE}/angajati")
    a.get_by_role("button", name="Adaugă angajat").first.click()
    d = a.get_by_role("dialog"); d.get_by_label("Nume și prenume").fill("George Marin"); d.get_by_label("Meserie").fill("Șef de echipă")
    d.get_by_label("Echipă").select_option(label="Echipa Nord"); d.get_by_role("button", name="Adaugă angajat").click(); expect(d).to_be_hidden()
    for n in ["Ion Popescu", "Mihai Ionescu"]:
        a.get_by_text(n, exact=True).click(); expect(a.get_by_role("heading", name=n)).to_be_visible(); a.get_by_role("button", name="Modifică").click()
        dd = a.get_by_role("dialog"); dd.get_by_label("Echipă").select_option(label="Echipa Nord"); dd.get_by_role("button", name="Salvează").click(); expect(dd).to_be_hidden()
        a.goto(f"{BASE}/angajati")
    a.goto(f"{BASE}/setari")
    a.locator("li").filter(has_text="Echipa Nord").get_by_label("Șef de echipă").select_option(label="George Marin")
    expect(a.get_by_text("Șeful de echipă a fost actualizat.")).to_be_visible()
    ok("echipă cu șef și membri")

    # Concediu pentru Andrei mâine + verificare în alocare
    a.goto(f"{BASE}/angajati"); a.get_by_text("Andrei Vasile", exact=True).click()
    expect(a.get_by_role("heading", name="Andrei Vasile")).to_be_visible()
    a.get_by_role("button", name="Adaugă", exact=True).click()
    d = a.get_by_role("dialog"); d.get_by_label("De la", exact=True).fill(TOMORROW); d.get_by_label("Până la (inclusiv)").fill(TOMORROW); d.get_by_role("button", name="Salvează").click()
    expect(a.get_by_text(f"{TOMORROW} – {TOMORROW}")).to_be_visible()
    expect(a.get_by_text("Săptămâna aceasta")).to_be_visible()
    no_error_box(a, "angajat detaliu"); ok("fișa angajatului + concediu")
    a.goto(f"{BASE}/planning/aloca?date={TOMORROW}")
    a.locator("button").filter(has_text="Casă Ploiești").click()
    expect(a.locator("button[aria-pressed]").filter(has_text="Andrei Vasile").get_by_text("concediu")).to_be_visible()
    a.locator("button[aria-pressed]").filter(has_text="Andrei Vasile").click()
    expect(a.get_by_text(re.compile(r"Conflict:.*Andrei Vasile este în concediu"))).to_be_visible()
    expect(a.get_by_role("button", name="Salvează alocările")).to_be_disabled()
    ok("concediul blochează alocarea")

    # Recurență: Mihai, 3 zile lucrătoare de mâine
    a.locator("button[aria-pressed]").filter(has_text="Andrei Vasile").click()
    a.locator("button[aria-pressed]").filter(has_text="Mihai Ionescu").click()
    a.get_by_label(re.compile("Repetă pe mai multe zile")).check()
    end = (datetime.date.today() + datetime.timedelta(days=7)).isoformat()
    a.get_by_label("Până la data (inclusiv)").fill(end)
    expect(a.get_by_text(re.compile(r"Se vor crea \d+ alocări"))).to_be_visible()
    n = int(re.search(r"Se vor crea (\d+)", a.get_by_text(re.compile(r"Se vor crea")).inner_text()).group(1))
    a.get_by_role("button", name="Salvează alocările").click()
    expect(a.get_by_role("heading", name="Alocări salvate")).to_be_visible()
    ok(f"alocare recurentă: {n} zile lucrătoare")

    # Planning lună + copiere săptămână cu previzualizare
    a.goto(f"{BASE}/planning")
    a.get_by_role("tab", name="Lună").click()
    expect(a.get_by_text(re.compile(r"\d+ oameni|1 om")).first).to_be_visible()
    a.get_by_role("tab", name="Săptămână").click()
    a.get_by_role("button", name="Copiază săptămâna").click()
    d = a.get_by_role("dialog")
    expect(d.get_by_text(re.compile(r"OK|Conflict"))).not_to_have_count(0)
    btn = d.get_by_role("button", name=re.compile(r"^Copiază \d+"))
    cnt = int(re.search(r"(\d+)", btn.inner_text()).group(1))
    if cnt > 0:
        btn.click(); expect(a.get_by_text(re.compile(r"alocări copiate și salvate"))).to_be_visible()
    ok(f"copiere săptămână cu previzualizare: {cnt} alocări fără conflict")

    # Lucrare detaliu, pontaje toate, rapoarte pe lucrare + CSV
    a.goto(f"{BASE}/lucrari"); a.get_by_text("Renovare apartament — București").click()
    expect(a.get_by_text("ORE APROBATE")).to_be_visible()
    a.get_by_placeholder("Adaugă o observație…").fill("Materialele ajung joi.")
    a.get_by_role("button", name="Adaugă observația").click(); expect(a.get_by_text("Materialele ajung joi.")).to_be_visible()
    no_error_box(a, "lucrare"); ok("pagina lucrării + observație")
    a.goto(f"{BASE}/pontaje"); a.get_by_role("tab", name="Toate pontajele").click(); expect(a.get_by_text("Aprobat").filter(visible=True).first).to_be_visible()
    a.get_by_role("button", name="Istoric").filter(visible=True).first.click()
    expect(a.get_by_role("dialog").get_by_text("Aprobat").first).to_be_visible(); a.get_by_role("dialog").get_by_role("button", name="Închide").first.click()
    ok("pontaje: toate + istoric")
    a.goto(f"{BASE}/rapoarte"); a.get_by_role("tab", name="Pe lucrare").click()
    expect(a.locator("tr").filter(has_text="Casă Ploiești")).to_be_visible()
    with a.expect_download() as dl:
        a.get_by_role("button", name="CSV pontaje").click()
    path = dl.value.path(); content = open(path, encoding="utf-8-sig").read()
    assert "Ion Popescu" in content and "7,83" in content, content
    ok("export CSV pontaje (7,83 ore = 7h 50m)")

    # Invitație George ca șef de echipă
    a.goto(f"{BASE}/angajati"); a.get_by_text("George Marin", exact=True).click(); expect(a.get_by_role("heading", name="George Marin")).to_be_visible()
    a.get_by_role("button", name="Invită în aplicație").click()
    d = a.get_by_role("dialog"); d.get_by_label("Rol în aplicație").select_option("sef_echipa"); d.get_by_role("button", name="Generează cod").click()
    code = d.locator("div.font-mono").inner_text().strip()

    g = ctx(390, 844, True)
    g.goto(f"{BASE}/login"); g.get_by_role("tab", name="Cont nou").click(); g.get_by_label("Email").fill("george@construct.ro"); g.get_by_label("Parolă").fill("parola123")
    g.get_by_role("button", name="Creează cont").click(); g.wait_for_url(re.compile("/onboarding"))
    g.get_by_label("Cod de invitație").fill(code); g.get_by_role("button", name="Alătură-te firmei").click(); g.wait_for_url(re.compile("/astazi"))
    g.goto(f"{BASE}/echipa")
    expect(g.get_by_text("Ion Popescu").first).to_be_visible()
    expect(g.get_by_text("Montaj rigips").first).to_be_visible()
    g.locator("li").filter(has_text="Montaj rigips").get_by_role("button", name="Actualizează").first.click()
    dd = g.get_by_role("dialog"); dd.get_by_role("button", name="50%").click(); dd.get_by_role("button", name="Salvează progresul").click(); expect(dd).to_be_hidden()
    expect(g.get_by_text("50%").first).to_be_visible()
    ok("șef de echipă: vede echipa, actualizează progresul")
    g.goto(f"{BASE}/pontaj"); g.get_by_role("tab", name="Echipa mea").click()
    expect(g.get_by_text("Ion Popescu").filter(visible=True).first).to_be_visible()
    g.get_by_role("button", name="Semnalează problemă").filter(visible=True).first.click()
    g.get_by_role("dialog").get_by_label("Ce trebuie verificat?").fill("Confirmă ora de plecare")
    g.get_by_role("dialog").get_by_role("button", name="Salvează semnalarea").click()
    expect(g.get_by_text("Confirmă ora de plecare").filter(visible=True).first).to_be_visible()
    ok("șef de echipă: semnalează problemă la pontaj")
    for path in ["/program", "/profil", "/astazi"]:
        g.goto(f"{BASE}{path}"); g.wait_for_timeout(800); no_error_box(g, path)
    g.goto(f"{BASE}/pontaje"); expect(g.get_by_text("Acces restricționat")).to_be_visible()
    g.screenshot(path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots", "21_sef_echipa.png"), full_page=True)
    ok("șef de echipă: program, profil; fără acces la pontajele firmei")

    real = [x for x in problems if "favicon" not in x]
    print("PROBLEME:", real if real else "niciuna")
    b.close()
    print("SMOKE COMPLET")
