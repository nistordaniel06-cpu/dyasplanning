# Rulează după v3_e2e.py, cu serverul pornit cu ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:54321/anthropic
# Asistentul AI: propune → confirmă → se salvează; anulare; întrebări; doar pentru admin.
import re, subprocess, json
from playwright.sync_api import sync_playwright, expect
B = "http://localhost:3000"; probs = []
def ok(m): print("✓", m, flush=True)
def sql(q): return subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "dyas_e2e", "-tAc", q], capture_output=True, text=True).stdout.strip()
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    c = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, locale="ro-RO", timezone_id="Europe/Bucharest")
    c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
    a = c.new_page(); a.set_default_timeout(20000); a.on("pageerror", lambda e: probs.append(f"pageerror {e}"))
    a.goto(B + "/login"); a.get_by_label("Număr de telefon").fill("patron@firma.ro"); a.get_by_label("Parolă").fill("parola1234")
    a.get_by_role("button", name="Intră în aplicație").click(); a.wait_for_url(re.compile("/dashboard"))
    a.get_by_role("link", name="Asistent AI").first.click(); a.wait_for_url(re.compile("/asistent"))
    box = a.get_by_label("Mesaj pentru asistent")

    # 1) lucrare nouă + alocare
    box.fill("Creează lucrarea Vila Otopeni și alocă-l pe Ion de mâine o săptămână"); a.get_by_role("button", name="Trimite").click()
    expect(a.get_by_text("Lucrare nouă: „Vila Otopeni”", exact=False)).to_be_visible()
    expect(a.get_by_text(re.compile("Alocă pe „Vila Otopeni”: Ion Pop"))).to_be_visible()
    assert sql("select count(*) from projects where name='Vila Otopeni'") == "0", "nimic salvat înainte de confirmare"
    a.screenshot(path="shots/170_asistent_propunere.png", full_page=True)
    a.get_by_role("button", name="Confirmă").click()
    expect(a.get_by_text("Lucrarea „Vila Otopeni” a fost creată.")).to_be_visible()
    expect(a.get_by_text(re.compile(r"Am creat \d+ zile de program pentru Ion Pop"))).to_be_visible()
    n = int(sql("select count(*) from assignments a join projects p on p.id=a.project_id where p.name='Vila Otopeni'"))
    assert 4 <= n <= 6, n
    a.screenshot(path="shots/171_asistent_confirmat.png", full_page=True)
    ok(f"lucrare nouă + {n} zile de program pentru Ion, doar după „Confirmă”")

    # 2) anulare: nu se salvează nimic
    box.fill("Adaugă mașina Ford Transit B 123 ABC"); a.get_by_role("button", name="Trimite").click()
    expect(a.get_by_text("Mașină nouă: Ford Transit (b 123 abc)")).to_be_visible()
    a.get_by_role("button", name="Anulează").click(); expect(a.get_by_text("Anulat — nu s-a salvat nimic.")).to_be_visible()
    assert sql("select count(*) from vehicles where name='Ford Transit'") == "0"
    ok("„Anulează” nu salvează nimic")
    box.fill("Adaugă mașina Ford Transit B 123 ABC"); a.get_by_role("button", name="Trimite").click()
    a.get_by_role("button", name="Confirmă").last.click(); expect(a.get_by_text("Mașina Ford Transit a fost adăugată.")).to_be_visible()
    assert sql("select plate from vehicles where name='Ford Transit'") == "B 123 ABC"
    ok("mașina adăugată după confirmare")
    box.fill("Vreau să adaug un angajat nou"); a.get_by_role("button", name="Trimite").click()
    a.get_by_role("button", name="Confirmă").last.click(); expect(a.get_by_text(re.compile("Marius Popescu a fost adăugat"))).to_be_visible()
    assert sql("select trade from employees where full_name='Marius Popescu'") == "Zidar"
    ok("angajat nou adăugat")

    # 3) întrebare (doar citire)
    box.fill("Cine lucrează mâine?"); a.get_by_role("button", name="Trimite").click()
    expect(a.get_by_text(re.compile("Mâine lucrează: .*Ion Pop la Vila Otopeni"))).to_be_visible()
    ok("răspunde la întrebări din datele firmei")

    # 4) doar proprietarul oprește asistentul (aici: doar pentru această firmă)
    a.goto(B + "/setari"); expect(a.get_by_text("Asistentul AI este pornit")).to_have_count(0)
    sql("insert into auth.users(id, email, encrypted_password, email_confirmed_at) values (gen_random_uuid(), 'sef5@dyas.ro', extensions.crypt('Bucur3st!', extensions.gen_salt('bf')), now()) on conflict do nothing")
    sql("insert into platform_owners(user_id) select id from auth.users where email='sef5@dyas.ro' on conflict do nothing")
    oc = b.new_context(viewport={"width": 1280, "height": 900}, locale="ro-RO"); o = oc.new_page(); o.set_default_timeout(20000)
    o.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
    o.goto(B + "/login"); o.get_by_label("Număr de telefon").fill("sef5@dyas.ro"); o.get_by_label("Parolă").fill("Bucur3st!")
    o.get_by_role("button", name="Intră în aplicație").click(); o.wait_for_url(re.compile("/proprietar"))
    o.get_by_role("tab", name="Firme").click(); o.locator("main").get_by_role("button").filter(has_text="Construct Test SRL").first.click()
    o.get_by_label("Asistent AI pornit pentru această firmă").uncheck(); o.wait_for_timeout(1500)
    assert sql("select assistant_enabled from companies where name='Construct Test SRL'") == "f"
    ok("proprietarul oprește asistentul pentru o firmă din panoul lui")
    a.goto(B + "/asistent"); expect(a.get_by_text("Asistentul AI este oprit")).to_be_visible()
    st = a.evaluate("""async () => { const parts = document.cookie.split('; ').filter((c) => /^sb-.*-auth-token/.test(c)).sort().map((c) => decodeURIComponent(c.split('=').slice(1).join('=')));
      let raw = parts.join(''); if (raw.startsWith('base64-')) raw = atob(raw.slice(7).replace(/-/g, '+').replace(/_/g, '/'));
      const t = JSON.parse(raw).access_token;
      const r = await fetch('/api/asistent', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ messages: [{ role: 'user', content: 'salut' }] }) }); return r.status; }""")
    assert st == 403, st
    a.goto(B + "/dashboard"); expect(a.get_by_role("link", name="Asistent AI")).to_have_count(0)
    ok("oprit de proprietar: dispare din meniul adminului, serverul refuză cererile")
    d = b.new_context(viewport={"width": 1280, "height": 800}, locale="ro-RO"); dp = d.new_page()
    dp.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}")
    dp.goto(B + "/login"); dp.get_by_label("Număr de telefon").fill("patron@firma.ro"); dp.get_by_label("Parolă").fill("parola1234")
    dp.get_by_role("button", name="Intră în aplicație").click(); dp.wait_for_url(re.compile("/dashboard"))
    expect(dp.locator("aside").get_by_role("link", name="Ajutor")).to_be_visible(); dp.locator("aside").screenshot(path="shots/172_meniu_ajutor.png")
    ok("pe calculator, „Ajutor” e în meniu, jos (nu mai acoperă numele aplicației)")
    b.close()
print("PROBLEME:", probs if probs else "niciuna")
