# Rulează după v3_e2e.py (firma „Construct Test SRL”, lucrarea „Apartament Militari” cu Ion Pop alocat azi).
# Acoperă: pontaj cu butonul „Am început / Am terminat”, poză la pontaj, lucru fără semnal (coadă pe telefon),
# poze și mesaje vocale în chat, raportul lunar PDF.
import re, struct, zlib, subprocess
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:3000"; probs = []
def ok(m): print("✓", m, flush=True)
def sql(q): return subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "dyas_e2e", "-tAc", q], capture_output=True, text=True).stdout.strip()

def png(path, rgb):
    w = h = 64
    raw = b"".join(b"\x00" + bytes(rgb) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
png("/tmp/lucrare.png", (200, 120, 40)); png("/tmp/chat.png", (40, 120, 200))

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
    def ctx(**kw):
        c = b.new_context(locale="ro-RO", timezone_id="Europe/Bucharest", **kw)
        c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
        pg = c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: probs.append(f"pageerror {e}")); pg.on("dialog", lambda d: d.accept())
        return c, pg
    ac, a = ctx(viewport={"width": 1280, "height": 900}, accept_downloads=True)
    a.goto(B + "/login"); a.get_by_label("Număr de telefon").fill("patron@firma.ro"); a.get_by_label("Parolă").fill("parola1234")
    a.get_by_role("button", name="Intră în aplicație").click(); a.wait_for_url(re.compile("/dashboard"))
    a.goto(B + "/angajati"); a.get_by_text("Ion Pop", exact=True).click()
    a.get_by_role("button", name="Cod nou de acces").click(); d = a.get_by_role("dialog"); d.get_by_role("button", name="Generează codul").click()
    code = d.locator("div.font-mono").inner_text().strip(); d.get_by_role("button", name="Gata").click()

    ic, i = ctx(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                geolocation={"latitude": 44.4355, "longitude": 26.0423, "accuracy": 12}, permissions=["geolocation", "microphone"])
    i.goto(B + "/login"); i.get_by_label("Număr de telefon").fill("0722 111 222"); i.get_by_label("Cod de acces").fill(code)
    i.get_by_role("button", name="Intră în aplicație").click(); i.wait_for_url(re.compile("/astazi"))

    # 1) pontaj cu butonul + poză
    before = int(sql("select count(*) from time_entries"))
    i.get_by_role("button", name="Am început").click()
    expect(i.get_by_text("Lucrezi acum")).to_be_visible()
    assert sql("select count(*) from time_clocks") == "1"
    assert sql("select round(start_lat::numeric, 3) from time_clocks") == "44.436", sql("select start_lat from time_clocks")
    i.screenshot(path="shots/100_lucrezi_acum.png", full_page=True); ok("„Am început”: tura pornește, ora și locul (GPS) notate")
    i.get_by_role("button", name="Am terminat").click(); d = i.get_by_role("dialog")
    d.locator("input[type=file]").set_input_files("/tmp/lucrare.png")
    expect(d.locator("img")).to_have_count(1)
    d.get_by_role("button", name="Trimite pontajul").click(); expect(d).to_be_hidden()
    expect(i.get_by_text("Lucrezi acum")).to_be_hidden()
    assert int(sql("select count(*) from time_entries")) == before + 1
    assert sql("select source || ' ' || status from time_entries order by created_at desc limit 1") == "buton trimis"
    assert sql("select count(*) from time_entry_photos") == "1"
    assert sql("select count(*) from storage.objects where bucket_id = 'pontaj'") == "1"
    ok("„Am terminat”: pontaj trimis automat + poza încărcată")

    # adminul vede pontajul cu poza
    a.goto(B + "/pontaje"); expect(a.get_by_text(re.compile("Pontat cu butonul")).first).to_be_visible()
    thumb = a.locator("img[alt='Poză de la lucrare']").first
    expect(thumb).to_be_visible(); a.wait_for_function("(img) => img.complete && img.naturalWidth > 0", arg=thumb.element_handle())
    a.screenshot(path="shots/101_pontaj_cu_poza.png", full_page=True); ok("adminul vede pontajul, locul și poza")

    # 2) fără semnal: aplicația se deschide, tura și poza se salvează pe telefon
    i.reload(); expect(i.get_by_role("button", name="Am început")).to_be_visible()
    ic.set_offline(True)
    i.reload(); expect(i.get_by_role("button", name="Am început")).to_be_visible(timeout=20000)
    ok("fără semnal: aplicația se deschide din telefon, cu datele de azi")
    i.get_by_role("button", name="Am început").click()
    expect(i.get_by_text(re.compile("ora de început e salvată pe telefon"))).to_be_visible()
    i.get_by_role("button", name="Am terminat").click(); d = i.get_by_role("dialog")
    d.locator("input[type=file]").set_input_files("/tmp/lucrare.png")
    d.get_by_role("button", name="Trimite pontajul").click(); expect(d).to_be_hidden()
    expect(i.get_by_text(re.compile("înregistrări sunt salvate pe telefon"))).to_be_visible()
    i.screenshot(path="shots/102_fara_semnal.png", full_page=True)
    assert int(sql("select count(*) from time_entries")) == before + 1
    ok("fără semnal: „Am început / Am terminat” + poza rămân în coada de pe telefon")
    ic.set_offline(False)
    expect(i.get_by_text(re.compile("salvate pe telefon"))).to_be_hidden(timeout=40000)
    assert int(sql("select count(*) from time_entries")) == before + 2, sql("select count(*) from time_entries")
    assert sql("select count(*) from time_entry_photos") == "2"
    assert sql("select count(*) from time_clocks") == "0"
    ok("revine internetul: pontajul și poza se trimit singure")

    # 3) chat: poză + mesaj vocal
    i.goto(B + "/chat"); i.get_by_text("Toată firma").click()
    i.locator("input[type=file][capture]").set_input_files("/tmp/chat.png")
    img = i.locator("img[alt='Poză']").last
    expect(img).to_be_visible(); i.wait_for_function("(img) => img.complete && img.naturalWidth > 0", arg=img.element_handle())
    ok("chat: poză făcută cu camera, trimisă și afișată")
    i.get_by_test_id("chat-galerie").set_input_files(["/tmp/chat.png", "/tmp/lucrare.png"])
    expect(i.locator("img[alt='Poză']")).to_have_count(3)
    ok("chat: 2 poze încărcate din galerie deodată")
    i.get_by_role("button", name="Mesaj vocal").click()
    expect(i.get_by_text("Se înregistrează…")).to_be_visible(); i.wait_for_timeout(1500)
    i.get_by_role("button", name="Trimite").click()
    expect(i.locator("audio").last).to_be_attached()
    assert sql("select count(*) from chat_messages where attachment_type = 'audio'") == "1"
    i.screenshot(path="shots/103_chat_poza_voce.png", full_page=True); ok("chat: mesaj vocal înregistrat și trimis")
    a.goto(B + "/chat"); a.get_by_text("Toată firma").first.click()
    expect(a.locator("audio").last).to_be_attached(); ok("adminul primește poza și mesajul vocal")

    # 4) raport lunar PDF
    a.goto(B + "/rapoarte"); a.get_by_role("button", name="PDF lunar").click(); d = a.get_by_role("dialog")
    d.get_by_label("Angajat").select_option(label="Ion Pop")
    with a.expect_download() as dl: d.get_by_role("button", name="Descarcă PDF").click()
    path = dl.value.path(); data = open(path, "rb").read()
    assert data[:5] == b"%PDF-", data[:20]; assert dl.value.suggested_filename.startswith("pontaj_") and "ion_pop" in dl.value.suggested_filename, dl.value.suggested_filename
    open("shots/104_pontaj_ion.pdf", "wb").write(data); ok(f"PDF lunar descărcat ({dl.value.suggested_filename}, {len(data)//1024} KB)")
    b.close()
print("PROBLEME:", probs if probs else "niciuna")
