# Rulează după v3_e2e.py (folosește firma și datele create acolo).
import re, subprocess, json, os
D=json.load(open(os.path.join(os.path.dirname(__file__), "../../public/i18n-en.json")))
EXACT=set(D["exact"].keys()); PATS=[re.compile(r) for r,_ in D["patterns"]]
def untranslated(t):
    t=t.strip()
    if t in EXACT and D["exact"][t]!=t: return True
    return any(p.search(t) for p in PATS)
from playwright.sync_api import sync_playwright, expect
B="http://localhost:3000"; probs=[]; leftovers={}
RO=re.compile(r"[ăâîșțĂÂÎȘȚ]|\b(și|pentru|lucrări|angajați|pontaj|Salvează|Adaugă|Modifică|Șterge|Ieșire|azi|ore)\b")
def ok(m): print("✓", m, flush=True)
def sql(q): return subprocess.run(["psql","-h","/tmp","-p","5433","-U","postgres","-d","dyas_e2e","-tAc",q],capture_output=True,text=True,check=True).stdout.strip()
def scan(pg, name):
    pg.wait_for_timeout(700)
    txt=pg.evaluate("""() => { const out=[]; const w=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for(let n=w.nextNode(); n; n=w.nextNode()){ if(n.parentElement.closest('[data-no-i18n],script,style')) continue; const t=n.nodeValue.trim(); if(t) out.push(t); }
      document.querySelectorAll('[placeholder],[aria-label],[title]').forEach(e=>['placeholder','aria-label','title'].forEach(a=>{const v=e.getAttribute(a); if(v) out.push(v)}));
      return out; }""")
    bad=[t for t in txt if (RO.search(t) or untranslated(t)) and t not in ("Moldova (Chișinău)",)]
    if bad: leftovers[name]=sorted(set(bad))
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
    def ctx(w=1280,h=860,mobile=False):
        c=b.new_context(viewport={"width":w,"height":h}, is_mobile=mobile, has_touch=mobile, locale="ro-RO", timezone_id="Europe/Bucharest")
        c.add_init_script("try{localStorage.getItem('dyas.loc')||localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.getItem('dyas.push')||localStorage.setItem('dyas.push','no:'+Date.now())}catch(e){}"); pg=c.new_page(); pg.set_default_timeout(15000)
        pg.on("pageerror", lambda e: probs.append(f"pageerror {e}"))
        pg.on("console", lambda m: m.type=="error" and not re.search(r"WebSocket|realtime|Failed to load resource|hydrat", m.text, re.I) and probs.append(m.text))
        pg.on("dialog", lambda d: d.accept())
        return pg
    a=ctx(); a.goto(B+"/login")
    expect(a.get_by_role("heading", name="Autentificare")).to_be_visible()
    a.get_by_role("button", name="EN").click(); a.wait_for_load_state()
    expect(a.get_by_role("heading", name="Sign in")).to_be_visible(); expect(a.get_by_label("Phone number")).to_be_visible()
    a.screenshot(path="shots/90_login_en.png"); scan(a,"login"); ok("pagina de autentificare în engleză")
    a.get_by_label("Phone number").fill("patron@firma.ro"); a.get_by_label("Password").fill("parola1234"); a.get_by_role("button", name="Sign in").click()
    a.wait_for_url(re.compile("/dashboard")); expect(a.get_by_role("heading", name="Dashboard")).to_be_visible()
    for path,name in [("/dashboard","dashboard"),("/planning","planning"),("/lucrari","lucrari"),("/angajati","angajati"),("/pontaje","pontaje"),("/rapoarte","rapoarte"),("/masini","masini"),("/setari","setari"),("/chat","chat"),("/notificari","notificari"),("/planning/aloca","aloca"),("/utilizare","utilizare")]:
        a.goto(B+path); a.wait_for_load_state("networkidle"); scan(a,name); a.screenshot(path=f"shots/91_en_{name}.png", full_page=True)
    a.goto(B+"/lucrari"); a.locator("main a[href^='/lucrari/']").first.click(); a.wait_for_load_state("networkidle"); scan(a,"lucrare"); a.screenshot(path="shots/91_en_lucrare.png", full_page=True)
    a.goto(B+"/angajati"); a.locator("main a[href^='/angajati/']").first.click(); a.wait_for_load_state("networkidle"); scan(a,"angajat"); a.screenshot(path="shots/91_en_angajat.png", full_page=True)
    ok("paginile administratorului în engleză")
    # angajat pe telefon
    e=ctx(390,844,True); e.goto(B+"/login"); e.evaluate("localStorage.setItem('dyas.lang','en')"); e.reload()
    e.get_by_label("Phone number").fill("0722 111 222"); code=None
    # codul a fost generat în v3_e2e; îl setăm din nou direct în baza de date
    sql("update auth.users set encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf')) where email='t40722111222@telefon.dyasplanning.app'")
    e.get_by_label("Access code").fill("123456"); e.get_by_role("button", name="Sign in").click(); e.wait_for_url(re.compile("/astazi"))
    for path,name in [("/astazi","astazi"),("/program","program"),("/pontaj","pontaj"),("/profil","profil")]:
        e.goto(B+path); e.wait_for_load_state("networkidle"); scan(e,"angajat_"+name); e.screenshot(path=f"shots/92_en_{name}.png", full_page=True)
    ok("paginile angajatului în engleză")
    # înapoi în română
    a.goto(B+"/dashboard"); a.get_by_role("button", name="RO").first.click(); a.wait_for_load_state()
    expect(a.get_by_role("heading", name="Dashboard")).to_be_visible(); expect(a.get_by_role("link", name="Lucrări").first).to_be_visible(); ok("înapoi în română")
    # proprietar fără firmă: poate ieși din cont pe telefon
    o=ctx(390,844,True); o.goto(B+"/creare-cont-dyas-7k2m"); o.get_by_label("Email").fill("owner@dyas.ro"); o.get_by_label("Parolă").fill("parola1234"); o.get_by_role("button", name="Creează cont").click()
    o.wait_for_url(re.compile("/onboarding")); sql("insert into platform_owners(user_id) select id from auth.users where email='owner@dyas.ro'")
    o.goto(B+"/"); o.wait_for_url(re.compile("/proprietar"))
    o.locator("nav").get_by_role("button", name="Ieșire").click(); o.wait_for_url(re.compile("/login")); ok("proprietarul fără firmă iese din cont de pe telefon")
    b.close()
print("RAMASE IN ROMANA:")
for k,v in leftovers.items(): print(" ", k, v)
print("PROBLEME:", probs if probs else "niciuna")
