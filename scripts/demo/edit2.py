"""Montaj pentru cele 3 filme DYAS Planning (patron 16:9, angajați 9:16, șefi de echipă 9:16).
Fiecare segment: bucată din scena reală + subtitrare + (opțional) voce. Segmentul ține cât vocea, dacă vocea e mai lungă."""
import asyncio, base64, json, os, subprocess, sys

D = "/home/claude/demo"
FR = f"{D}/frames"
SEG = f"{D}/seg2"; os.makedirs(SEG, exist_ok=True)
OUT = f"{D}/out"; os.makedirs(OUT, exist_ok=True)
FONT = "/usr/share/fonts/opentype/inter/Inter-Bold.otf"
FPS = 30
VOICE = os.environ.get("VOICE_MODEL", f"{D}/voice/ro_RO-mihai-medium.onnx")
HAS_VOICE = os.path.exists(VOICE)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        print(" ".join(cmd)[:400]); print(r.stderr[-2500:]); raise SystemExit(1)
    return r.stdout


def dur(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]))


def raw(scene, size):
    tl = json.load(open(f"{FR}/{scene}/timeline.json"))
    fr = tl["frames"]; lst = f"{SEG}/{scene}.txt"
    with open(lst, "w") as f:
        j = 0
        for k in range(int(tl["end"] * FPS)):
            t = k / FPS
            while j + 1 < len(fr) and fr[j + 1][1] <= t:
                j += 1
            f.write(f"file '{FR}/{scene}/{fr[j][0]}'\nduration {1 / FPS:.6f}\n")
        f.write(f"file '{FR}/{scene}/{fr[j][0]}'\n")
    out = f"{SEG}/{scene}_raw.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-vf", f"fps={FPS},scale={size}:flags=lanczos,format=yuv420p",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", out])
    return out, tl


def crop_for(box, W=1920, H=1080):
    pad = box.get("pad", 32)
    x0, y0 = box["x"] - pad, box["y"] - pad
    w, h = box["width"] + 2 * pad, box["height"] + 2 * pad
    cw = max(w, h / 0.78 * 16 / 9); ch = cw * 9 / 16
    cw, ch = min(cw, W), min(ch, H)
    cx = x0 + w / 2; cy = y0 + h / 2 + ch * 0.11
    x = min(max(cx - cw / 2, 0), W - cw); y = min(max(cy - ch / 2, 0), H - ch)
    return f"crop={int(cw)//2*2}:{int(ch)//2*2}:{int(x)}:{int(y)},scale={W}:{H}:flags=lanczos"


def tts(key, text):
    """Vocea (Piper, română) pentru un segment -> wav; None dacă nu avem model."""
    if not HAS_VOICE or not text:
        return None
    out = f"{SEG}/voice_{key}.wav"
    if not os.path.exists(out) or os.path.getmtime(out) < os.path.getmtime(__file__):
        tmp = out + ".raw.wav"
        p = subprocess.run([sys.executable, "-m", "piper", "-m", VOICE, "-f", tmp, "--length-scale", "1.04", "--sentence-silence", "0.25"],
                           input=text, capture_output=True, text=True)
        if p.returncode:
            print(p.stderr[-1500:]); raise SystemExit(1)
        # ton mai cald, fără zgomot, volum constant
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-af", "highpass=f=70,lowpass=f=9000,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=48000",
             "-ac", "2", out])
        os.remove(tmp)
    return out


def caption_filters(caps, tall, top=False):
    fs = []
    for (a, b, text) in caps:
        lines = text.split("\n")[:2]; n = len(lines)
        for j, line in enumerate(lines):
            tf = f"{SEG}/cap_{abs(hash((a, b, line, j, tall)))}.txt"; open(tf, "w").write(line)
            if tall:
                fsz, step = 50, 70
                y = f"{1920 - 230 + (230 - n * step) // 2 + j * step + 8}"
                fs.append(f"drawtext=fontfile={FONT}:expansion=none:textfile={tf}:fontsize={fsz}:fontcolor=white:x=(w-tw)/2:y={y}:enable='between(t,{a},{b})'")
            else:
                y = f"{60 + j * 84}" if top else f"h-{70 + (n - 1 - j) * 84}-th"
                fs.append(f"drawtext=fontfile={FONT}:expansion=none:textfile={tf}:fontsize=60:fontcolor=white:x=(w-tw)/2:y={y}:box=1:boxcolor=0x0f172a@0.82:boxborderw=22:enable='between(t,{a},{b})'")
    return fs


def segment(name, src, t_in, t_out, caption, voice=None, speed=1.0, crop=None, tall=False, top=False, fade_in=False, min_hold=0.0):
    v = tts(name, voice)
    vis = (t_out - t_in) / speed
    target = max(vis + min_hold, (dur(v) + 0.45) if v else 0)
    hold = max(0.0, target - vis)
    vf = [f"trim=start={t_in}:end={t_out}", "setpts=PTS-STARTPTS"]
    if speed != 1.0: vf.append(f"setpts=PTS/{speed}")
    if crop: vf.append(crop)
    if tall: vf.append("pad=1080:1920:0:0:color=0x0f172a")
    if hold: vf.append(f"tpad=stop_mode=clone:stop_duration={hold:.3f}")
    vf.append(f"fps={FPS},setsar=1")
    vf += caption_filters([(0, 999, caption)] if caption else [], tall, top)
    if fade_in: vf.append("fade=t=in:st=0:d=0.35")
    out = f"{SEG}/{name}.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", ",".join(vf), "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", out])
    return out, dur(out), v


async def card_png(path, w, h, title, cta, sub):
    from playwright.async_api import async_playwright
    icon = open("/home/claude/dyasplanning/public/icon.svg").read()
    tall = h > w
    s = 1.0 if not tall else 0.95
    html = f"""<html><body style="margin:0;width:{w}px;height:{h}px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#fff7ed 0%,#ffffff 55%,#fff7ed 100%);font-family:Inter,sans-serif;color:#0f172a">
      <div style="text-align:center;max-width:{w - 160}px">
        <div style="display:flex;align-items:center;justify-content:center;gap:{28*s}px;margin-bottom:{56*s}px">
          <div style="width:{132*s}px;height:{132*s}px">{icon}</div>
          <div style="font-size:{104*s}px;font-weight:800;letter-spacing:-2px">DYAS Planning</div>
        </div>
        <div style="font-size:{66*s}px;font-weight:700;line-height:1.2">{title}</div>
        <div style="display:inline-block;margin-top:{56*s}px;background:#ea580c;color:#fff;font-size:{56*s}px;font-weight:700;padding:{30*s}px {56*s}px;border-radius:28px;line-height:1.2">{cta}</div>
        <div style="margin-top:{46*s}px;font-size:{40*s}px;color:#475569;line-height:1.35">{sub}</div>
      </div></body></html>"""
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", args=["--no-sandbox"])
        pg = await b.new_page(viewport={"width": w, "height": h})
        await pg.set_content(html); await pg.wait_for_timeout(300)
        await pg.screenshot(path=path); await b.close()


def outro(name, w, h, title, cta, sub, voice):
    png = f"{SEG}/{name}.png"
    asyncio.run(card_png(png, w, h, title, cta, sub))
    v = tts(name, voice)
    d = max(6.0, (dur(v) + 1.2) if v else 0)
    out = f"{SEG}/{name}.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-t", f"{d:.2f}", "-i", png, "-vf", f"fps={FPS},format=yuv420p,setsar=1,fade=t=in:st=0:d=0.5",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", out])
    return out, d, v


def assemble(segs, out_path, w, h):
    total = sum(d for _, d, _ in segs)
    lst = f"{SEG}/{os.path.basename(out_path)}.txt"
    open(lst, "w").write("".join(f"file '{p}'\n" for p, _, _ in segs))
    vid = f"{SEG}/{os.path.basename(out_path)}.video.mp4"
    run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", vid])
    # coloana sonoră: vocea fiecărui segment, începând la 0,15 s de la tăietură; liniște în rest
    inputs, filt, t = [], [], 0.0
    for i, (_, d, v) in enumerate(segs):
        if v:
            inputs += ["-i", v]
            k = len(inputs) // 2
            filt.append(f"[{k}:a]adelay={int((t + 0.15) * 1000)}|{int((t + 0.15) * 1000)}[a{k}]")
        t += d
    n = len(inputs) // 2
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", vid] + inputs + ["-f", "lavfi", "-t", f"{total:.2f}", "-i", "anullsrc=r=48000:cl=stereo"]
    mix = ";".join(filt) + (";" if filt else "") + "".join(f"[a{k}]" for k in range(1, n + 1)) + f"[{n + 1}:a]amix=inputs={n + 1}:normalize=0:duration=longest,atrim=0:{total:.2f}[aout]"
    cmd += ["-filter_complex", mix + f";[0:v]fade=t=out:st={total - 0.6:.2f}:d=0.6[vout]", "-map", "[vout]", "-map", "[aout]",
            "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "slow", "-crf", "20", "-maxrate", "3500k", "-bufsize", "7000k",
            "-pix_fmt", "yuv420p", "-r", str(FPS), "-g", "60", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out_path]
    run(cmd)
    print(f"{out_path}: {total:.1f}s, {os.path.getsize(out_path) // 1024} KB, voce={'da' if HAS_VOICE else 'nu'}")
    return total


def patron():
    s1, t1 = raw("s1_plan", "1920:1080"); s2, t2 = raw("s2_aloca", "1920:1080"); s3, t3 = raw("s3_sarcini", "1920:1080"); s4, t4 = raw("s4_validare", "1920:1080")
    m2 = dict(t2["marks"]); m4 = dict(t4["marks"]); b2, b3, b4 = t2["boxes"], t3["boxes"], t4["boxes"]
    main_area = {"x": 520, "y": 40, "width": 1380, "height": 700, "pad": 0}
    sel = dict(b2["selectati"]); sel.update(width=1312, x=544, height=300)
    segs = [
        segment("p_a", s1, 0, t1["end"], "Două șantiere azi.\nCine merge unde?", "Luni dimineață. Două șantiere, o singură echipă. Cine merge unde?", crop=crop_for(main_area), top=True, fade_in=True, min_hold=0.6),
        segment("p_b", s2, 0, m2["selectie"], "Coordonatorul deschide lucrarea din Militari\nși apasă „Alocă angajați”.", "Coordonatorul deschide lucrarea din Militari și apasă: Alocă angajați."),
        segment("p_c", s2, m2["selectie"], m2["sarcini"], "Îi alege pe Andrei și pe Mihai.", "Îi alege pe Andrei și pe Mihai.", crop=crop_for(sel)),
        segment("p_d", s2, m2["sarcini"], m2["salvat"], "Fiecare primește sarcina lui:\ngips-carton pentru Andrei, electrice pentru Mihai.", "Fiecare primește sarcina lui. Andrei montează pereții de gips-carton, Mihai pregătește instalația electrică.", crop=crop_for(b2["sarcini"]), min_hold=0.6),
        segment("p_e", s2, m2["salvat"], t2["end"], "Gata. Repartizarea e salvată.", "Gata. Repartizarea e salvată.", min_hold=1.0),
        segment("p_f", s3, 0, 2.4, "Planul zilei: cine, unde, ce face.", "În planul zilei vezi cine, unde și ce face.", crop=crop_for(main_area)),
        segment("p_g", s3, 2.4, 6.0, "Același șantier, sarcini diferite:\nAndrei la gips-carton, Mihai la electrice.", "Același șantier, sarcini diferite. Fiecare știe exact ce are de făcut.", speed=0.55, crop=crop_for(b3["militari"]), min_hold=0.8),
        segment("p_h", s3, 6.0, t3["end"], "Elena rămâne la finisaje,\nîn Grozăvești.", "Elena rămâne la finisaje, în Grozăvești.", speed=0.6, crop=crop_for(b3["tabel"]), min_hold=1.5),
        segment("p_i", s4, 0, t4["marks"][0][1], "Seara, coordonatorul verifică\norele fiecăruia.", "Seara, coordonatorul verifică orele fiecăruia.", crop=crop_for(main_area), min_hold=0.4),
        segment("p_j", s4, m4["ore"], m4["mihai"], "Andrei: 8 ore,\npe Renovare apartament · Militari.", "Andrei: opt ore, pe lucrarea din Militari.", speed=0.85, crop=crop_for(b4["andrei"])),
        segment("p_k", s4, m4["mihai"], m4["valideaza"], "Mihai: 8 ore și 30 de minute,\npe aceeași lucrare.", "Mihai: opt ore și jumătate, pe aceeași lucrare.", speed=0.9, crop=crop_for(b4["mihai"])),
        segment("p_l", s4, m4["valideaza"], t4["end"], "Un clic: ziua e validată\nși orele sunt aprobate.", "Un clic, și ziua e validată. Orele sunt aprobate.", crop=crop_for(main_area), min_hold=1.2),
        outro("p_z", 1920, 1080, "Vrei să vezi cum ai organiza echipa ta?", "Cere o demonstrație DYAS Planning", "Lucrări · oameni · sarcini · ore — pe telefon",
              "Vrei să vezi cum ai organiza echipa ta? Cere o demonstrație DYAS Planning."),
    ]
    return assemble(segs, f"{OUT}/dyas-planning-demo.mp4", 1920, 1080)


def angajati():
    m1, t1 = raw("m1_dimineata", "1080:1690"); m2, t2 = raw("m2_extra", "1080:1690"); m3, t3 = raw("m3_ore", "1080:1690")
    a, b, c = dict(t1["marks"]), dict(t2["marks"]), dict(t3["marks"])
    segs = [
        segment("e_a", m1, 0, a["misiune"], "Dimineața, Andrei vede\nunde lucrează azi și la ce oră.", "Dimineața, Andrei deschide aplicația și vede unde lucrează azi: renovarea apartamentului din Militari, de la opt la patru și jumătate.", tall=True, fade_in=True),
        segment("e_b", m1, a["misiune"], a["colegi"], "Misiunea lui:\nmontaj pereți gips-carton.", "Misiunea lui e clară: montaj pereți de gips-carton.", tall=True),
        segment("e_c", m1, a["colegi"], t1["end"], "Vede și cine mai e pe lucrare azi:\nMihai, la instalația electrică.", "Vede și cine mai e pe lucrare: Mihai, la instalația electrică.", tall=True),
        segment("e_d", m2, 0, b["pagina"], "Clientul cere ceva în plus?\nApasă „Lucru extra”.", "La prânz, clientul cere ceva în plus. Andrei apasă: Lucru extra.", tall=True),
        segment("e_e", m2, b["pagina"], b["poza"], "Scrie ce s-a cerut\nși pune o poză.", "Scrie ce s-a cerut și pune o poză.", tall=True),
        segment("e_f", m2, b["poza"], t2["end"], "Patronul vede imediat\nlucrarea extra, cu poză.", "Trimite, iar patronul vede imediat lucrarea extra, cu poză.", tall=True),
        segment("e_g", m3, 0, c["formular"], "Seara: „Adaugă orele”.\nProgramul e deja completat.", "Seara apasă: Adaugă orele. Programul e deja completat.", tall=True),
        segment("e_h", m3, c["formular"], c["trimite"], "Verifică: 8 ore lucrate.", "Verifică: opt ore lucrate.", tall=True),
        segment("e_i", m3, c["trimite"], t3["end"], "Trimite pontajul.\nFără hârtii, fără telefoane.", "Și trimite pontajul. Fără hârtii, fără telefoane.", tall=True, min_hold=0.8),
        outro("e_z", 1080, 1920, "Știi unde lucrezi, ce ai de făcut<br>și îți trimiți orele de pe telefon.", "DYAS Planning<br>pentru echipa ta", "Cere o demonstrație pentru firma ta",
              "Cu DYAS Planning știi unde lucrezi, ce ai de făcut, și îți trimiți orele de pe telefon."),
    ]
    return assemble(segs, f"{OUT}/dyas-planning-angajati.mp4", 1080, 1920)


def sefi():
    l1, t1 = raw("l1_echipa", "1080:1690"); l2, t2 = raw("l2_validare", "1080:1690"); l3, t3 = raw("l3_notificare", "1080:1690")
    a, b = dict(t1["marks"]), dict(t2["marks"])
    segs = [
        segment("s_a", l1, 0, a["cine"], "Mihai e șef de echipă.\nÎn „Echipa mea” vede cine lucrează azi.", "Mihai e șef de echipă. În Echipa mea vede cine lucrează azi și unde.", tall=True, fade_in=True),
        segment("s_b", l1, a["cine"], a["progres"], "Andrei la gips-carton,\nMihai la instalația electrică.", "Andrei la gips-carton, el la instalația electrică.", tall=True),
        segment("s_c", l1, a["progres"], t1["end"], "Actualizează progresul:\ngips-carton, 60%.", "Seara actualizează progresul: pereții de gips-carton sunt gata în proporție de șaizeci la sută.", tall=True),
        segment("s_d", l2, 0, b["andrei"], "Apoi deschide „Validare zi”\nși verifică orele echipei.", "Apoi deschide Validare zi și verifică orele echipei.", tall=True),
        segment("s_e", l2, b["andrei"], b["modifica"], "Andrei a trecut până la 16:30,\ndar a plecat la 16:00.", "Andrei a trecut până la patru și jumătate, dar a plecat la patru.", tall=True),
        segment("s_f", l2, b["modifica"], b["corectat"], "Mihai corectează ora\nși scrie motivul.", "Mihai corectează ora și scrie motivul.", tall=True),
        segment("s_g", l2, b["corectat"], t2["end"], "Validează ziua. Patronul primește\norele deja verificate.", "Apoi validează toată ziua. Patronul primește orele deja verificate.", tall=True, min_hold=0.6),
        segment("s_h", l3, 0, t3["end"], "Andrei primește notificare\ncu ora corectată și motivul.", "Iar Andrei primește notificare, cu ora corectată și motivul.", tall=True, min_hold=0.6),
        outro("s_z", 1080, 1920, "Șeful de echipă ține ordinea<br>pe șantier, de pe telefon.", "DYAS Planning<br>pentru șefii de echipă", "Cere o demonstrație pentru firma ta",
              "Cu DYAS Planning, șeful de echipă ține ordinea pe șantier, direct de pe telefon."),
    ]
    return assemble(segs, f"{OUT}/dyas-planning-sefi-de-echipa.mp4", 1080, 1920)


if __name__ == "__main__":
    which = sys.argv[1:] or ["patron", "angajati", "sefi"]
    for w in which:
        globals()[w]()
