"""Scene pe telefon (390 px): ziua lui Andrei (angajat) și seara lui Mihai (șef de echipă). Cadre 780x1220."""
import asyncio, datetime, os, re, sys, time
from playwright.async_api import async_playwright
from record import CURSOR_JS, Rec, glide, click, smooth_scroll, sql, IDS, TZ, B
import record

record.W, record.H, record.DPR = 390, 610, 2
W, H = 390, 610
D = "/home/claude/demo"


async def ctx(p, who, at):
    b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", env={**os.environ, "LANG": "ro_RO.UTF-8", "LC_ALL": "ro_RO.UTF-8", "LANGUAGE": "ro"},
                                args=["--no-sandbox", "--lang=ro-RO", "--hide-scrollbars", "--force-device-scale-factor=2"])
    c = await b.new_context(viewport={"width": W, "height": H}, device_scale_factor=2, locale="ro-RO", timezone_id="Europe/Bucharest",
                            storage_state=f"{D}/state_{who}.json")
    await c.add_init_script(CURSOR_JS)
    pg = await c.new_page(); pg.set_default_timeout(20000)
    await pg.clock.install(time=at)
    pg.on("pageerror", lambda e: print("PAGEERROR", e))
    cdp = await c.new_cdp_session(pg)
    return b, pg, Rec(pg, cdp)


def T(h, m):
    t = datetime.datetime(2026, 11, 16, h, m, tzinfo=TZ)
    # ceasul bazei locale de demo urmează scena
    sql(f"update demo_clock set offset_i = timestamptz '{t.isoformat()}' - now() where id = 1")
    return t


async def angajat(p):
    sql(f"delete from time_entries where company_id='{IDS['CID']}'; delete from project_extras; delete from notifications")
    b, pg, rec = await ctx(p, "andrei", T(7, 35))
    await pg.goto(B + "/astazi"); await pg.get_by_text("Misiunea ta").wait_for(); await asyncio.sleep(1.0)
    await pg.mouse.move(W * 0.75, H * 0.4)
    await rec.start("m1_dimineata")
    await asyncio.sleep(1.6)
    card = pg.locator("article").first
    await smooth_scroll(pg, await pg.evaluate("(el) => el.getBoundingClientRect().top + scrollY - 8", await card.element_handle()), 900)
    await asyncio.sleep(0.6)
    rec.mark("misiune")
    await glide(pg, pg.get_by_text("Montaj pereți gips-carton").first); await asyncio.sleep(2.2)
    rec.mark("colegi")
    col = pg.get_by_text("Colegi pe lucrare azi")
    await smooth_scroll(pg, await pg.evaluate("(el) => el.getBoundingClientRect().top + scrollY - 260", await col.element_handle()), 900)
    await glide(pg, pg.get_by_text(re.compile("Mihai Stan — ")).first); await asyncio.sleep(2.4)
    await rec.stop()

    # la prânz: lucru extra cu poză
    await pg.clock.set_system_time(T(13, 10))
    await pg.goto(B + "/astazi"); await pg.get_by_text("Misiunea ta").wait_for(); await asyncio.sleep(0.6)
    btn = pg.get_by_role("link", name="Lucru extra").first
    await pg.evaluate("(el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 330)", await btn.element_handle()); await asyncio.sleep(0.5)
    await pg.mouse.move(W * 0.7, H * 0.3)
    await rec.start("m2_extra")
    await asyncio.sleep(0.8)
    await click(pg, btn, 0.2)
    await pg.get_by_role("button", name="Adaugă lucrare extra").wait_for(); await asyncio.sleep(0.8)
    rec.mark("pagina")
    await click(pg, pg.get_by_role("button", name="Adaugă lucrare extra"), 0.5)
    ta = pg.get_by_label("Ce s-a făcut în plus")
    await glide(pg, ta); await ta.click()
    rec.mark("scrie")
    await ta.press_sequentially("Clientul a cerut o nișă pentru televizor în peretele din living.", delay=38)
    await asyncio.sleep(0.6)
    await pg.locator("input[type=file]").first.set_input_files(f"{D}/nisa.jpg"); await asyncio.sleep(1.2)
    rec.mark("poza")
    save = pg.get_by_role("button", name="Salvează", exact=True)
    await click(pg, save, 0.2)
    await pg.get_by_text("De verificat").first.wait_for()
    await smooth_scroll(pg, 0, 500)
    rec.mark("salvat")
    await asyncio.sleep(2.6)
    await rec.stop()

    # seara: orele
    await pg.clock.set_system_time(T(16, 35))
    await pg.goto(B + "/astazi"); await pg.get_by_text("Misiunea ta").wait_for(); await asyncio.sleep(0.6)
    add = pg.get_by_role("link", name="Adaugă orele").first
    await pg.evaluate("(el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 380)", await add.element_handle()); await asyncio.sleep(0.5)
    await pg.mouse.move(W * 0.7, H * 0.3)
    await rec.start("m3_ore")
    await asyncio.sleep(0.8)
    await click(pg, add, 0.2)
    await pg.get_by_role("button", name="Trimite pontaj").wait_for(); await asyncio.sleep(1.0)
    rec.mark("formular")
    await glide(pg, pg.get_by_text(re.compile("Timp efectiv lucrat")).first); await asyncio.sleep(2.0)
    rec.mark("trimite")
    await click(pg, pg.get_by_role("button", name="Trimite pontaj"), 0.2)
    await asyncio.sleep(2.2)
    rec.mark("trimis")
    await asyncio.sleep(1.6)
    await rec.stop()
    await b.close()


async def sef(p):
    # Mihai și-a pus și el orele; Andrei a trimis 08:00–16:30, dar a plecat la 16:00
    sql(f"delete from notifications")
    if not sql(f"select 1 from time_entries where employee_id='{IDS['ANDREI']}' limit 1"):
        sql(f"insert into time_entries(company_id,employee_id,project_id,task_id,started_at,ended_at,break_minutes,status) values ('{IDS['CID']}','{IDS['ANDREI']}','{IDS['PM']}','{IDS['T_GIPS']}','2026-11-16 08:00+02','2026-11-16 16:30+02',30,'trimis')")
    sql(f"delete from time_entries where employee_id='{IDS['MIHAI']}'")
    sql(f"insert into time_entries(company_id,employee_id,project_id,task_id,started_at,ended_at,break_minutes,status) values ('{IDS['CID']}','{IDS['MIHAI']}','{IDS['PM']}','{IDS['T_EL']}','2026-11-16 08:00+02','2026-11-16 16:30+02',30,'trimis')")
    sql(f"update time_entries set status='trimis', ended_at='2026-11-16 16:30+02', validated_at=null, validated_by=null, validated_role=null where employee_id='{IDS['ANDREI']}'")
    sql(f"update tasks set progress=40 where id='{IDS['T_GIPS']}'")
    b, pg, rec = await ctx(p, "mihai", T(17, 20))
    await pg.goto(B + "/echipa"); await pg.get_by_text("Cine lucrează și unde").wait_for(); await asyncio.sleep(1.2)
    await pg.mouse.move(W * 0.75, H * 0.35)
    await rec.start("l1_echipa")
    await asyncio.sleep(1.4)
    rec.mark("cine")
    await glide(pg, pg.get_by_text("Andrei Ionescu").first); await asyncio.sleep(1.6)
    prog = pg.get_by_text("Lucrări și progresul misiunilor")
    await smooth_scroll(pg, await pg.evaluate("(el) => el.getBoundingClientRect().top + scrollY - 10", await prog.element_handle()), 900)
    await asyncio.sleep(0.5)
    rec.mark("progres")
    upd = pg.get_by_role("button", name="Actualizează").first
    await click(pg, upd, 0.3)
    slider = pg.locator("input[type=range]")
    await slider.wait_for(); await asyncio.sleep(0.5)
    await glide(pg, slider); await slider.focus()
    for _ in range(4):
        await pg.keyboard.press("ArrowRight"); await asyncio.sleep(0.25)
    await asyncio.sleep(0.6)
    await click(pg, pg.get_by_role("button", name="Salvează progresul"), 0.2)
    await asyncio.sleep(1.2)
    rec.mark("salvat")
    await asyncio.sleep(1.4)
    await rec.stop()

    # validarea zilei
    await pg.goto(B + "/validare"); await pg.get_by_text("Andrei Ionescu").first.wait_for(); await asyncio.sleep(1.0)
    await pg.mouse.move(W * 0.7, H * 0.3)
    await rec.start("l2_validare")
    await asyncio.sleep(1.2)
    card_a = pg.locator("li").filter(has=pg.get_by_text("Andrei Ionescu", exact=True)).first
    await smooth_scroll(pg, await pg.evaluate("(el) => el.getBoundingClientRect().top + scrollY - 10", await card_a.element_handle()), 900)
    await asyncio.sleep(0.4)
    rec.mark("andrei")
    await glide(pg, card_a.get_by_text(re.compile("08:00–16:30")).first); await asyncio.sleep(1.4)
    rec.mark("modifica")
    await click(pg, card_a.get_by_role("button", name="Modifică").first, 0.4)
    dlg = pg.get_by_role("dialog")
    end = dlg.get_by_label("Sfârșit")
    await glide(pg, end); await end.fill("16:00"); await asyncio.sleep(0.6)
    reason = dlg.get_by_label(re.compile("Motivul corectării"))
    await glide(pg, reason); await reason.click(); await reason.press_sequentially("A plecat la 16:00 la medic.", delay=40)
    await asyncio.sleep(0.5)
    await click(pg, dlg.get_by_role("button", name="Salvează și validează"), 0.2)
    await dlg.wait_for(state="hidden"); await asyncio.sleep(0.6)
    rec.mark("corectat")
    await asyncio.sleep(1.6)
    await smooth_scroll(pg, 0, 600)
    rec.mark("tot")
    await click(pg, pg.get_by_role("button", name=re.compile("Validează tot")), 0.2)
    await pg.get_by_text(re.compile("validat")).first.wait_for(); await asyncio.sleep(0.4)
    rec.mark("gata")
    await asyncio.sleep(2.6)
    await rec.stop()

    # Andrei vede corectarea
    await b.close()
    b, pg, rec = await ctx(p, "andrei", T(17, 40))
    await pg.goto(B + "/notificari"); await pg.get_by_text("Ți s-a corectat programul").first.wait_for(); await asyncio.sleep(1.0)
    await pg.mouse.move(W * 0.8, H * 0.8)
    await rec.start("l3_notificare")
    await asyncio.sleep(1.0)
    await glide(pg, pg.get_by_text("Ți s-a corectat programul").first); await asyncio.sleep(2.6)
    await rec.stop()
    await b.close()


async def main(which):
    async with async_playwright() as p:
        if "angajat" in which: await angajat(p)
        if "sef" in which: await sef(p)

asyncio.run(main(sys.argv[1:] or ["angajat", "sef"]))
