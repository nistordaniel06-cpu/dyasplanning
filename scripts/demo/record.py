"""Înregistrează scenele demo DYAS Planning din aplicația reală (local, date fictive), cu CDP screencast la 1920x1080.
Fiecare scenă -> frames/<scena>/ + timeline.json (cadre cu timp) + boxes.json (zone pentru prim-planuri)."""
import asyncio, base64, datetime, json, os, re, subprocess, sys, time
from playwright.async_api import async_playwright

B = "http://localhost:3000"
OUT = "/home/claude/demo/frames"
TZ = datetime.timezone(datetime.timedelta(hours=2))
IDS = dict(l.strip().split("=", 1) for l in open("/home/claude/demo/ids.env") if "=" in l)
W, H, DPR = 960, 540, 2


def sql(q):
    return subprocess.run(["psql", "-h", "/tmp", "-p", "5433", "-U", "postgres", "-d", "dyas_e2e", "-qtAc", q],
                          check=True, capture_output=True, text=True).stdout.strip()


CURSOR_JS = """
(() => {
  const mk = () => {
    if (document.getElementById('__demo_cursor')) return;
    const c = document.createElement('div'); c.id = '__demo_cursor';
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;border-radius:50%;background:rgba(15,23,42,.85);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);transition:transform .12s';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', e => {
      c.style.transform = 'translate(-50%,-50%) scale(.75)';
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:16px;height:16px;border-radius:50%;border:3px solid #ea580c;z-index:2147483646;pointer-events:none;transform:translate(-50%,-50%);transition:all .45s ease-out;opacity:1`;
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.width = '64px'; r.style.height = '64px'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
    addEventListener('mouseup', () => { c.style.transform = 'translate(-50%,-50%)'; }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mk); else mk();
  try { localStorage.setItem('dyas.loc','no:'+Date.now()); localStorage.setItem('dyas.push','no:'+Date.now()); localStorage.setItem('dyas.install','no:'+Date.now()); } catch (e) {}
})();
"""


class Rec:
    def __init__(self, page, cdp):
        self.page, self.cdp, self.frames, self.on, self.boxes = page, cdp, [], False, {}
        cdp.on("Page.screencastFrame", self._frame)

    async def _frame(self, ev):
        if self.on:
            self.frames.append((time.monotonic(), ev["data"]))
        try:
            await self.cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})
        except Exception:
            pass

    async def start(self, name):
        self.name, self.frames, self.marks, self.boxes = name, [], [], {}
        self.on = True
        self.t0 = time.monotonic()
        await self.cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92, "maxWidth": W * DPR, "maxHeight": H * DPR, "everyNthFrame": 1})
        await asyncio.sleep(0.3)

    def mark(self, label):
        self.marks.append((label, time.monotonic() - self.t0))

    async def box(self, label, locator, pad=16):
        b = await locator.bounding_box()
        self.boxes[label] = {k: v * DPR for k, v in b.items()} | {"pad": pad * DPR}

    async def stop(self):
        await asyncio.sleep(0.2)
        await self.cdp.send("Page.stopScreencast")
        self.on = False
        t_end = time.monotonic()
        d = os.path.join(OUT, self.name)
        os.makedirs(d, exist_ok=True)
        for f in os.listdir(d):
            os.remove(os.path.join(d, f))
        tl = []
        for i, (t, data) in enumerate(self.frames):
            fn = f"{i:05d}.jpg"
            open(os.path.join(d, fn), "wb").write(base64.b64decode(data))
            tl.append([fn, t - self.t0])
        json.dump({"frames": tl, "end": t_end - self.t0, "marks": self.marks, "boxes": self.boxes}, open(os.path.join(d, "timeline.json"), "w"), indent=1)
        print(f"scena {self.name}: {len(tl)} cadre, {t_end - self.t0:.1f}s, marks={self.marks}", flush=True)


async def glide(page, locator, steps=22):
    """Mișcă mouse-ul lin până la element (ca să se vadă pe ecran)."""
    await locator.scroll_into_view_if_needed()
    b = await locator.bounding_box()
    x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    await page.mouse.move(x, y, steps=steps)
    await asyncio.sleep(0.15)
    return x, y


async def click(page, locator, pause=0.5):
    await glide(page, locator)
    await page.mouse.down(); await asyncio.sleep(0.08); await page.mouse.up()
    await asyncio.sleep(pause)


async def smooth_scroll(page, y, ms=700):
    await page.evaluate("""([y, ms]) => new Promise(r => { const s = scrollY, t0 = performance.now();
      const f = (t) => { const k = Math.min(1, (t - t0) / ms), e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k + 2, 2) / 2; scrollTo(0, s + (y - s) * e); k < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); })""", [y, ms])


async def main(which):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", env={**os.environ, "LANG": "ro_RO.UTF-8", "LC_ALL": "ro_RO.UTF-8", "LANGUAGE": "ro"}, args=["--no-sandbox", "--lang=ro-RO", "--hide-scrollbars", "--force-device-scale-factor=2"])
        c = await b.new_context(viewport={"width": W, "height": H}, device_scale_factor=DPR, locale="ro-RO", timezone_id="Europe/Bucharest")
        await c.add_init_script(CURSOR_JS)
        page = await c.new_page(); page.set_default_timeout(20000)
        await page.clock.install(time=datetime.datetime(2026, 11, 16, 7, 40, tzinfo=TZ))
        page.on("pageerror", lambda e: print("PAGEERROR", e))
        cdp = await c.new_cdp_session(page)
        rec = Rec(page, cdp)

        sql("delete from notifications")
        await page.goto(B + "/login")
        await page.get_by_role("tab", name="Cu email").click()
        await page.get_by_label("Email").fill("coordonator@exemplu-demo.ro"); await page.get_by_label("Parolă").fill("demo12345")
        await page.get_by_role("button", name=re.compile("Intră")).click()
        await page.wait_for_url(re.compile("/dashboard"))
        await page.mouse.move(W * 0.62, H * 0.55)

        if "plan" in which:
            # resetează alocările din Militari (ca filmarea să înceapă de la zero)
            sql(f"delete from assignments where project_id='{IDS['PM']}'")
            await page.goto(B + "/planning"); await page.get_by_role("tab", name="Zi").click()
            await page.get_by_text("Finisaje: glet și vopsea").first.wait_for()
            await asyncio.sleep(0.8)
            await page.evaluate("(el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 12)", await page.get_by_text("Luni, 16 noiembrie 2026").first.element_handle())
            await asyncio.sleep(0.5)
            await rec.start("s1_plan")
            await asyncio.sleep(1.2)
            await glide(page, page.locator("table").get_by_text("Amenajare birouri · Grozăvești").first)
            await asyncio.sleep(1.4)
            await glide(page, page.locator("table").get_by_text("Renovare apartament · Militari").first)
            await asyncio.sleep(0.3)
            await rec.box("randuri", page.locator("table").first)
            await asyncio.sleep(2.2)
            await rec.stop()

            # ---- scena 2: deschide lucrarea din Militari și repartizează oamenii
            await rec.start("s2_aloca")
            await click(page, page.get_by_role("link", name="Lucrări").first, 0.2)
            await page.get_by_text("Renovare apartament · Militari").first.wait_for(); await asyncio.sleep(0.7)
            await click(page, page.get_by_text("Renovare apartament · Militari").first, 0.2)
            await page.wait_for_url(re.compile("/lucrari/")); await page.get_by_role("link", name="Alocă angajați").wait_for(); await asyncio.sleep(1.0)
            rec.mark("lucrare")
            await click(page, page.get_by_role("link", name="Alocă angajați"), 0.2)
            await page.get_by_text("Selectează angajații").wait_for(); await asyncio.sleep(0.6)
            andrei = page.locator("button[aria-pressed]").filter(has_text="Andrei Ionescu")
            await smooth_scroll(page, await page.evaluate("(el) => el.getBoundingClientRect().top + scrollY - 140", await andrei.element_handle()))
            await asyncio.sleep(0.4)
            rec.mark("selectie")
            await click(page, andrei, 0.5)
            await click(page, page.locator("button[aria-pressed]").filter(has_text="Mihai Stan"), 0.7)
            await rec.box("selectati", page.locator("button[aria-pressed]").filter(has_text="Andrei Ionescu"))
            # pasul 5: sarcina fiecăruia
            p5 = page.get_by_text("Personalizează pe angajat")
            await smooth_scroll(page, await page.evaluate("(el) => el.getBoundingClientRect().top + scrollY - 70", await p5.element_handle()), 900)
            await asyncio.sleep(0.5)
            rec.mark("sarcini")
            sel = page.get_by_label("Misiune", exact=True)
            await glide(page, sel.nth(0)); await sel.nth(0).select_option(label="Montaj pereți gips-carton"); await asyncio.sleep(0.9)
            await glide(page, sel.nth(1)); await sel.nth(1).select_option(label="Pregătire instalație electrică"); await asyncio.sleep(0.9)
            await rec.box("sarcini", p5.locator("xpath=ancestor::*[contains(@class,'rounded')][1]"))
            await asyncio.sleep(1.0)
            save = page.get_by_role("button", name=re.compile("Salvează alocările"))
            await click(page, save, 0.2)
            await page.get_by_role("heading", name="Alocări salvate").wait_for()
            rec.mark("salvat")
            await asyncio.sleep(2.0)
            await rec.stop()

            # ---- scena 3: planul zilei — același șantier, sarcini diferite
            await page.goto(B + "/planning"); await page.get_by_role("tab", name="Zi").click()
            await page.get_by_text(re.compile("Montaj pereți gips-carton")).first.wait_for(); await asyncio.sleep(0.8)
            await page.evaluate("(el) => scrollTo(0, el.getBoundingClientRect().top + scrollY - 12)", await page.get_by_text("Luni, 16 noiembrie 2026").first.element_handle())
            await page.mouse.move(W * 0.5, H * 0.95)
            await asyncio.sleep(0.5)
            await rec.start("s3_sarcini")
            await asyncio.sleep(1.0)
            row = page.locator("tr").filter(has_text="Renovare apartament · Militari").first
            await rec.box("militari", row)
            await rec.box("tabel", page.locator("table").first)
            await glide(page, page.locator("table").get_by_text("Andrei Ionescu").first)
            await asyncio.sleep(1.6)
            await glide(page, page.locator("table").get_by_text("Mihai Stan").first)
            await asyncio.sleep(1.6)
            await glide(page, page.locator("table").get_by_text("Elena Dobre").first)
            await asyncio.sleep(1.5)
            await rec.stop()

        if "seara" in which:
            # seara: orele înregistrate de oameni (simulăm finalul zilei)
            sql(f"delete from time_entries where company_id='{IDS['CID']}'")
            for emp, proj, task, s, e in [("ANDREI", "PM", "T_GIPS", "08:00", "16:30"), ("MIHAI", "PM", "T_EL", "08:00", "17:00"), ("ELENA", "PG", "T_FIN", "08:00", "16:30")]:
                sql(f"insert into time_entries(company_id,employee_id,project_id,task_id,started_at,ended_at,break_minutes,status,notes) values ('{IDS['CID']}','{IDS[emp]}','{IDS[proj]}','{IDS[task]}','2026-11-16 {s}+02','2026-11-16 {e}+02',30,'trimis',null)")
            sql("delete from notifications")
            await page.clock.set_system_time(datetime.datetime(2026, 11, 16, 17, 35, tzinfo=TZ))
            await page.goto(B + "/validare")
            await page.get_by_text("Andrei Ionescu").first.wait_for(); await asyncio.sleep(1.0)
            await page.mouse.move(W * 0.7, H * 0.3)
            await rec.start("s4_validare")
            await asyncio.sleep(1.0)
            card_a = page.locator("li").filter(has=page.get_by_text("Andrei Ionescu", exact=True)).first
            card_m = page.locator("li").filter(has=page.get_by_text("Mihai Stan", exact=True)).first
            await smooth_scroll(page, await page.evaluate("(el) => el.getBoundingClientRect().top + scrollY - 150", await card_a.element_handle()), 900)
            await asyncio.sleep(0.4)
            await rec.box("andrei", card_a)
            rec.mark("ore")
            await glide(page, card_a.get_by_text(re.compile("08:00–16:30")).first); await asyncio.sleep(1.8)
            await glide(page, card_m.get_by_text(re.compile("08:00–17:00")).first); rec.mark("mihai"); await rec.box("mihai", card_m); await asyncio.sleep(1.8)
            await smooth_scroll(page, 0, 800)
            rec.mark("valideaza")
            btn = page.get_by_role("button", name=re.compile("Validează tot"))
            await click(page, btn, 0.2)
            await page.get_by_text(re.compile("validate și aprobate")).wait_for()
            await rec.box("rezultat", page.get_by_text(re.compile("validate și aprobate")))
            rec.mark("validat")
            await asyncio.sleep(2.6)
            await rec.stop()
        await b.close()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["plan", "seara"]))
