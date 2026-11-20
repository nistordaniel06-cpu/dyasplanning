"""Montaj: cadrele reale -> segmente (tăieturi, prim-planuri, subtitrări) -> demo MP4 1080p H.264."""
import json, os, subprocess, asyncio

D = "/home/claude/demo"
FR = f"{D}/frames"
SEG = f"{D}/seg"; os.makedirs(SEG, exist_ok=True)
FONT = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
FPS = 30


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(r.stderr[-2500:]); raise SystemExit(1)


def raw(scene):
    """Cadrele screencast (la momente neregulate) -> video constant 30 fps."""
    tl = json.load(open(f"{FR}/{scene}/timeline.json"))
    fr = tl["frames"]
    lst = f"{FR}/{scene}/list.txt"
    with open(lst, "w") as f:
        n = int(tl["end"] * FPS)
        j = 0
        for k in range(n):
            t = k / FPS
            while j + 1 < len(fr) and fr[j + 1][1] <= t:
                j += 1
            f.write(f"file '{FR}/{scene}/{fr[j][0]}'\nduration {1 / FPS:.6f}\n")
        f.write(f"file '{FR}/{scene}/{fr[j][0]}'\n")
    out = f"{SEG}/{scene}_raw.mp4"
    # cadrele încep un pic după t=0: primul cadru acoperă și începutul
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-vf", f"fps={FPS},scale=1920:1080:flags=lanczos,format=yuv420p",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", out])
    return out, tl


def crop_for(box, zoom_min=1.0, extra=0):
    """Dreptunghi 16:9 în jurul zonei (cu margine), în limitele cadrului 1920x1080."""
    pad = box.get("pad", 32) + extra
    x0, y0 = box["x"] - pad, box["y"] - pad
    w, h = box["width"] + 2 * pad, box["height"] + 2 * pad
    # spațiu jos pentru subtitrare (~22% din înălțime)
    h_need = h / 0.78
    W = max(w, h_need * 16 / 9); H = W * 9 / 16
    W, H = min(W, 1920), min(H, 1080)
    cx = x0 + w / 2; cy = y0 + h / 2 + H * 0.11
    x = min(max(cx - W / 2, 0), 1920 - W); y = min(max(cy - H / 2, 0), 1080 - H)
    W, H, x, y = int(W) // 2 * 2, int(H) // 2 * 2, int(x), int(y)
    return f"crop={W}:{H}:{x}:{y},scale=1920:1080:flags=lanczos"


def esc(t):
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "’").replace("%", "\\%").replace(",", "\\,")


def caption_filters(caps, top=False):
    """caps: [(start, end, 'rând 1\\nrând 2')] -> drawtext (max 2 rânduri, centrate, jos)."""
    fs = []
    for i, (a, b, text) in enumerate(caps):
        lines = text.split("\n")[:2]
        n = len(lines)
        for j, line in enumerate(lines):
            tf = f"{SEG}/cap_{abs(hash((a, b, line, j)))}.txt"
            open(tf, "w").write(line)
            y = f"{60 + j * 84}" if top else f"h-{70 + (n - 1 - j) * 84}-th"
            fs.append(f"drawtext=fontfile={FONT}:textfile={tf}:fontsize=60:fontcolor=white:x=(w-tw)/2:y={y}:box=1:boxcolor=0x0f172a@0.82:boxborderw=22:enable='between(t,{a},{b})'")
    return fs


def segment(name, src, t_in, t_out, speed=1.0, crop=None, hold=0.0, caps=(), fade_in=False, top=False):
    vf = [f"trim=start={t_in}:end={t_out}", "setpts=PTS-STARTPTS"]
    if speed != 1.0:
        vf.append(f"setpts=PTS/{speed}")
    if crop:
        vf.append(crop)
    if hold:
        vf.append(f"tpad=stop_mode=clone:stop_duration={hold}")
    vf.append(f"fps={FPS},setsar=1")
    vf += caption_filters(caps, top)
    if fade_in:
        vf.append("fade=t=in:st=0:d=0.35")
    out = f"{SEG}/{name}.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", ",".join(vf), "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", out])
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out], capture_output=True, text=True).stdout)
    print(f"{name}: {dur:.2f}s")
    return out, dur


async def outro_png():
    from playwright.async_api import async_playwright
    icon = open("/home/claude/dyasplanning/public/icon.svg").read()
    html = f"""<html><body style="margin:0;width:1920px;height:1080px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#fff7ed 0%,#ffffff 55%,#fff7ed 100%);font-family:Inter,sans-serif;color:#0f172a">
      <div style="text-align:center;max-width:1500px">
        <div style="display:flex;align-items:center;justify-content:center;gap:28px;margin-bottom:56px">
          <div style="width:132px;height:132px">{icon}</div>
          <div style="font-size:104px;font-weight:800;letter-spacing:-2px">DYAS Planning</div>
        </div>
        <div style="font-size:66px;font-weight:700;line-height:1.2">Vrei să vezi cum ai organiza echipa ta?</div>
        <div style="display:inline-block;margin-top:56px;background:#ea580c;color:#fff;font-size:58px;font-weight:700;padding:30px 60px;border-radius:28px">Cere o demonstrație DYAS Planning</div>
        <div style="margin-top:46px;font-size:40px;color:#475569">Lucrări · oameni · sarcini · ore — pe telefon</div>
      </div></body></html>"""
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": 1920, "height": 1080})
        await pg.set_content(html); await pg.wait_for_timeout(400)
        await pg.screenshot(path=f"{SEG}/outro.png"); await b.close()


def main():
    s1, t1 = raw("s1_plan"); s2, t2 = raw("s2_aloca"); s3, t3 = raw("s3_sarcini"); s4, t4 = raw("s4_validare")
    m2 = dict(t2["marks"]); m4 = dict(t4["marks"]); b2, b3, b4 = t2["boxes"], t3["boxes"], t4["boxes"]
    # zona de selecție: Andrei + Mihai (al doilea card e sub primul pe același rând/grilă)
    sel = dict(b2["selectati"]); sel["width"] = 1312; sel["x"] = 544; sel["height"] = 300
    main_area = {"x": 520, "y": 40, "width": 1380, "height": 700, "pad": 0}
    segs = [
        segment("a_plan", s1, 0, t1["end"], hold=0.6, fade_in=True, crop=crop_for(main_area), caps=[(0, 7.5, "Două șantiere azi.\nCine merge unde?")], top=True),
        segment("b_lucrare", s2, 0, m2["selectie"], caps=[(0, 9, "Coordonatorul deschide lucrarea din Militari\nși apasă „Alocă angajați”.")]),
        segment("c_selectie", s2, m2["selectie"], m2["sarcini"], crop=crop_for(sel), caps=[(0, 9, "Îi alege pe Andrei și pe Mihai.")]),
        segment("d_sarcini", s2, m2["sarcini"], m2["salvat"], crop=crop_for(b2["sarcini"]), hold=0.6, caps=[(0, 9, "Fiecare primește sarcina lui:\ngips-carton pentru Andrei, electrice pentru Mihai.")]),
        segment("e_salvat", s2, m2["salvat"], t2["end"], hold=1.0, caps=[(0, 9, "Gata. Repartizarea e salvată.")]),
        segment("f_plan", s3, 0, 2.4, crop=crop_for(main_area), caps=[(0, 9, "Planul zilei: cine, unde, ce face.")]),
        segment("g_militari", s3, 2.4, 6.0, speed=0.55, crop=crop_for(b3["militari"]), hold=0.8, caps=[(0, 3.8, "Același șantier, sarcini diferite."), (3.8, 20, "Andrei: pereți de gips-carton.\nMihai: instalația electrică.")]),
        segment("h_elena", s3, 6.0, t3["end"], speed=0.6, crop=crop_for(b3["tabel"]), hold=2.2, caps=[(0, 20, "Elena rămâne la finisaje,\nîn Grozăvești.")]),
        segment("i_seara", s4, 0, m4["ore"], hold=0.4, crop=crop_for(main_area), caps=[(0, 9, "Seara, coordonatorul verifică\norele fiecăruia.")]),
        segment("j_andrei", s4, m4["ore"], m4["mihai"], speed=0.85, crop=crop_for(b4["andrei"]), caps=[(0, 9, "Andrei: 8 ore,\npe Renovare apartament · Militari.")]),
        segment("k_mihai", s4, m4["mihai"], m4["valideaza"], speed=0.9, crop=crop_for(b4["mihai"]), caps=[(0, 9, "Mihai: 8 ore și 30 de minute,\npe aceeași lucrare.")]),
        segment("l_valid", s4, m4["valideaza"], t4["end"], hold=1.2, crop=crop_for(main_area), caps=[(0, 9, "Un clic: ziua e validată\nși orele sunt aprobate.")]),
    ]
    asyncio.run(outro_png())
    run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-t", "6.5", "-i", f"{SEG}/outro.png", "-vf", f"fps={FPS},format=yuv420p,fade=t=in:st=0:d=0.5",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", f"{SEG}/z_outro.mp4"])
    segs.append((f"{SEG}/z_outro.mp4", 6.5))
    total = sum(d for _, d in segs)
    print(f"TOTAL {total:.1f}s")
    lst = f"{SEG}/concat.txt"
    open(lst, "w").write("".join(f"file '{p}'\n" for p, _ in segs))
    out = f"{D}/out/dyas-planning-demo.mp4"; os.makedirs(f"{D}/out", exist_ok=True)
    # final: H.264 High, 1080p30, faststart, pistă audio mută (compatibilitate WhatsApp / iOS)
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
         "-map", "0:v", "-map", "1:a", "-shortest", "-vf", "setsar=1,fade=t=out:st=%.2f:d=0.6" % (total - 0.6),
         "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "slow", "-crf", "20", "-maxrate", "3500k", "-bufsize", "7000k",
         "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", "60", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", out])
    print(out, os.path.getsize(out) // 1024, "KB")


main()
