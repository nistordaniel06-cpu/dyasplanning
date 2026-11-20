import asyncio, datetime, os, re
from playwright.async_api import async_playwright
from record import CURSOR_JS, IDS, TZ, B
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", env={**os.environ, "LANG": "ro_RO.UTF-8", "LC_ALL": "ro_RO.UTF-8", "LANGUAGE": "ro"}, args=["--no-sandbox", "--lang=ro-RO", "--hide-scrollbars"])
        c = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=3, is_mobile=True, has_touch=True, locale="ro-RO", timezone_id="Europe/Bucharest")
        await c.add_init_script("try{localStorage.setItem('dyas.loc','no:'+Date.now());localStorage.setItem('dyas.push','no:'+Date.now());localStorage.setItem('dyas.install','no:'+Date.now())}catch(e){}")
        pg = await c.new_page(); pg.set_default_timeout(20000)
        await pg.clock.install(time=datetime.datetime(2026, 11, 16, 17, 40, tzinfo=TZ))
        await pg.goto(B + "/login"); await pg.get_by_role("tab", name="Cu email").click()
        await pg.get_by_label("Email").fill("coordonator@exemplu-demo.ro"); await pg.get_by_label("Parolă").fill("demo12345")
        await pg.get_by_role("button", name=re.compile("Intră")).click(); await pg.wait_for_url(re.compile("/dashboard"))
        os.makedirs("out/shots", exist_ok=True)
        # 1. planul zilei
        await pg.goto(B + "/planning"); await pg.get_by_role("tab", name="Zi").click()
        await pg.get_by_text(re.compile("Montaj pereți gips-carton")).first.wait_for(); await pg.wait_for_timeout(800)
        h = await pg.get_by_text("Luni, 16 noiembrie 2026").first.element_handle()
        await pg.evaluate("(el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 70)", h); await pg.wait_for_timeout(500)
        await pg.screenshot(path="out/shots/1-planul-zilei.png")
        # 2. sarcini diferite pe același șantier (alocare, pasul 5) — fără salvare
        await pg.goto(B + f"/planning/aloca?lucrare={IDS["PM"]}&date=2026-11-17"); await pg.get_by_text("Selectează angajații").wait_for(); await pg.wait_for_timeout(600)
        if await pg.get_by_text("Alege lucrarea").count() and await pg.get_by_role("button", name="Schimbă").count() == 0:
            await pg.get_by_text("Renovare apartament · Militari").first.click()
        await pg.locator("button[aria-pressed]").filter(has_text="Andrei Ionescu").click()
        await pg.locator("button[aria-pressed]").filter(has_text="Mihai Stan").click()
        sel = pg.get_by_label("Misiune", exact=True)
        await sel.nth(0).select_option(label="Montaj pereți gips-carton"); await sel.nth(1).select_option(label="Pregătire instalație electrică")
        p5 = await pg.get_by_text("Personalizează pe angajat").element_handle()
        await pg.evaluate("(el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 76)", p5); await pg.wait_for_timeout(500)
        await pg.screenshot(path="out/shots/2-sarcini.png")
        # 3. validarea zilei
        await pg.goto(B + "/validare"); await pg.get_by_text("Andrei Ionescu").first.wait_for(); await pg.wait_for_timeout(900)
        await pg.screenshot(path="out/shots/3-validare.png")
        await b.close()
asyncio.run(main())
