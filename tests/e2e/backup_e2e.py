# Rulează după v3_e2e.py și teren_e2e.py (pontaje cu poze). Backup: Excel și ZIP complet, cu poze.
import re, subprocess, zipfile, io, json
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:3000"; probs = []
def ok(m): print("✓", m, flush=True)
def sql(q): return subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "dyas_e2e", "-tAc", q], capture_output=True, text=True).stdout.strip()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    c = b.new_context(viewport={"width": 1280, "height": 900}, locale="ro-RO", timezone_id="Europe/Bucharest", accept_downloads=True)
    c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
    a = c.new_page(); a.set_default_timeout(30000); a.on("pageerror", lambda e: probs.append(f"pageerror {e}"))
    a.goto(B + "/login"); a.get_by_label("Număr de telefon").fill("patron@firma.ro"); a.get_by_label("Parolă").fill("parola1234")
    a.get_by_role("button", name="Intră în aplicație").click(); a.wait_for_url(re.compile("/dashboard"))
    a.goto(B + "/setari"); expect(a.get_by_text("Nu ai făcut încă un backup complet")).to_be_visible()
    with a.expect_download() as dl: a.get_by_role("button", name="Descarcă Excel").click()
    x = dl.value; assert x.suggested_filename.endswith(".xlsx"), x.suggested_filename
    data = open(x.path(), "rb").read(); z = zipfile.ZipFile(io.BytesIO(data))
    wb = z.read("xl/workbook.xml").decode()
    for sh in ["Angajați", "Lucrări", "Pontaje", "Km mașini"]: assert sh in wb, sh
    strings = z.read("xl/sharedStrings.xml").decode()
    assert "Ion Pop" in strings and "Apartament Militari" in strings
    ok(f"Excel cu foi citibile ({x.suggested_filename})")
    with a.expect_download(timeout=60000) as dl: a.get_by_role("button", name="Descarcă backup complet").click()
    x = dl.value; zf = zipfile.ZipFile(x.path()); names = zf.namelist()
    assert "backup.json" in names and "date_firma.xlsx" in names and "tabele/time_entries.csv" in names and "CITESTE-MA.txt" in names, names[:10]
    bj = json.loads(zf.read("backup.json")); assert len(bj["tables"]["employees"]) >= 2 and len(bj["tables"]["time_entries"]) >= 1
    pics = [n for n in names if n.startswith("fisiere/")]
    assert len(pics) >= 2, pics
    expect(a.get_by_text(re.compile("Gata. Fișierul a fost descărcat"))).to_be_visible()
    expect(a.get_by_text(re.compile("Ultimul backup complet"))).to_be_visible()
    assert sql("select last_backup_at is not null from companies where name='Construct Test SRL'") == "t"
    a.screenshot(path="shots/150_backup.png", full_page=True)
    ok(f"backup complet ZIP: JSON, CSV, Excel și {len(pics)} poze/mesaje vocale; data backup-ului salvată")
    b.close()
print("PROBLEME:", probs if probs else "niciuna")
