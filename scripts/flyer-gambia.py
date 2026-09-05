#!/usr/bin/env python3
"""Volante impreso para casas de apuestas en Gambia (5-sep-2026), una variante por vendedor.

v2 (mismo día, pedido de Alexis): marketing directo. Foto de campaña (Higgsfield) arriba, un solo mensaje
—"te decimos dónde poner tu dinero: a quién, a qué cuota y cuánto"—, QR grande con el código del vendedor.
Sin tecnicismos (nada de simulaciones ni de casas que cobran de más). Se conservan 18+ y el aviso de que
son estimaciones, no garantías: es lo único que no se negocia en ninguna pieza de la casa.

El QR apunta a gpsimulador.com/landing?ref=<code>&lang=en → cada registro y cada pago queda atribuido al
vendedor (atribución first-touch que ya usa la plataforma; si el código es de un usuario, comisión de afiliado).

  python3 scripts/flyer-gambia.py <code> [--img ruta.png]
  → ig-src/flyer-gambia-<code>.html  (A6 a 300 dpi: 1240×1748 px; la foto va embebida en base64)
  luego, de UNO en uno (Chrome se cuelga con dos en el mismo script):
  chromium --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=1240,1840 \
    --screenshot=public/ig/flyer-gambia-<code>.png ig-src/flyer-gambia-<code>.html
  node scripts/png-crop.js public/ig/flyer-gambia-<code>.png 1748

Requiere `segno` (pip install segno): QR en SVG, sin red ni binarios.
"""
import base64
import html
import os
import sys
import segno

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'ig-src')
IMG_DEFAULT = os.path.join(HERE, '..', 'ig-src', 'assets', 'gambia-hero.png')

TEMPLATE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
/* A6 a 300 dpi. Zona segura 56 px (~5 mm). */
body { width: 1240px; height: 1748px; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  background: #061009; color: #fff; position: relative; overflow: hidden; }
.hero { position: absolute; left: 0; top: 0; width: 1240px; height: 980px; background: url('__IMG__') center 0% / cover no-repeat; }
.hero::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(6,16,9,.35) 0%, rgba(6,16,9,0) 28%, rgba(6,16,9,.45) 62%, #061009 100%), linear-gradient(90deg, rgba(6,16,9,0) 45%, rgba(6,16,9,.55) 100%); }
.top { position: absolute; left: 56px; right: 56px; top: 52px; display: flex; align-items: center; gap: 14px; z-index: 2; }
.badge { width: 58px; height: 58px; border-radius: 15px; background: rgba(6,16,9,.55); border: 2px solid rgba(31,227,164,.8); display: flex; align-items: center; justify-content: center; font-size: 30px; backdrop-filter: blur(4px); }
.bname { font-size: 32px; font-weight: 800; color: #fff; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
.tag { margin-left: auto; background: #1FE3A4; color: #06231A; font-weight: 800; font-size: 20px; padding: 12px 20px; border-radius: 99px; letter-spacing: 1.2px; text-transform: uppercase; }
.head { position: absolute; left: 500px; right: 56px; top: 500px; z-index: 2; text-align: right; }
.kicker { display: inline-block; background: #1FE3A4; color: #06231A; font-weight: 800; font-size: 24px; padding: 10px 18px; border-radius: 10px; letter-spacing: .5px; margin-bottom: 16px; text-transform: uppercase; }
h1 { font-size: 92px; line-height: .94; font-weight: 900; letter-spacing: -3.5px; color: #fff; text-shadow: 0 4px 24px rgba(0,0,0,.55); }
h1 span { color: #1FE3A4; }
.body { position: absolute; left: 56px; right: 56px; top: 1000px; z-index: 2; }
.sub { font-size: 31px; line-height: 1.28; color: #EAF1F2; font-weight: 600; margin-bottom: 22px; }
.sub b { color: #1FE3A4; font-weight: 800; }
.chips { display: flex; flex-wrap: nowrap; gap: 10px; margin-bottom: 24px; }
.chip { background: rgba(255,255,255,.07); border: 2px solid rgba(255,255,255,.16); border-radius: 99px; padding: 11px 18px; font-size: 20px; font-weight: 700; color: #EAF1F2; white-space: nowrap; }
.chip b { color: #1FE3A4; }
.scan { display: flex; gap: 34px; align-items: center; background: #0E1A14; border: 3px solid #1FE3A4; border-radius: 30px; padding: 34px 36px; }
.qr { flex: 0 0 350px; width: 350px; height: 350px; background: #fff; border-radius: 22px; padding: 20px; }
.qr svg { width: 100%; height: 100%; display: block; }
.scan-t { flex: 1; }
.scan-t .big { font-size: 46px; font-weight: 900; color: #fff; line-height: 1.02; letter-spacing: -1.5px; margin-bottom: 14px; }
.scan-t .big span { color: #1FE3A4; }
.scan-t .free { display: inline-block; background: #1FE3A4; color: #06231A; font-weight: 800; font-size: 24px; padding: 9px 18px; border-radius: 99px; margin-bottom: 18px; }
.scan-t .url { font-size: 28px; color: #fff; font-weight: 800; }
.scan-t .code { font-size: 22px; color: #9DB0B5; font-weight: 600; margin-top: 8px; }
.scan-t .code b { color: #1FE3A4; letter-spacing: 2px; font-size: 26px; }
.foot { position: absolute; left: 56px; right: 56px; bottom: 44px; font-size: 19px; line-height: 1.35; color: #8FA3A8; font-weight: 600; display: flex; justify-content: space-between; gap: 24px; z-index: 2; }
</style></head>
<body>
  <div class="hero"></div>
  <div class="top"><div class="badge">🎯</div><div class="bname">GP Simulador</div><div class="tag">Sports betting predictions</div></div>

  <div class="head">
    <div class="kicker">Stop guessing. Start winning smarter.</div>
    <h1>We tell you<br><span>where to put</span><br>your money.</h1>
  </div>

  <div class="body">
    <div class="sub">Our software analyses every match and hands you the <b>full prediction</b>: <b>who to bet on</b>, the <b>odds</b> and <b>how much to stake</b>. Everything. Every day.</div>
    <div class="chips">
      <div class="chip">⚽ <b>Football</b> · Premier League · LaLiga · Serie A</div>
      <div class="chip">🎮 <b>Esports</b> · CS2 · LoL</div>
      <div class="chip">📊 <b>Results</b> published daily</div>
    </div>
    <div class="scan">
      <div class="qr">__QR__</div>
      <div class="scan-t">
        <div class="big">Scan now.<br>Get <span>today's predictions</span></div>
        <div class="free">FREE TO JOIN · NO CARD</div>
        <div class="url">gpsimulador.com</div>
        <div class="code">Your code: <b>__CODE__</b></div>
      </div>
    </div>
  </div>

  <div class="foot">
    <div>18+ only. Predictions are statistical estimates, not guarantees. Bet responsibly.</div>
    <div>Questions? Ask the person who gave you this.</div>
  </div>
</body></html>
"""


def build(code: str, img: str) -> tuple:
    url = f"https://gpsimulador.com/landing?ref={code}&lang=en"
    qr = segno.make(url, error='h')   # corrección alta: papel doblado, luz mala
    svg = qr.svg_inline(scale=10, border=0, dark='#061009', light=None)
    with open(img, 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('ascii')
    mime = 'image/jpeg' if img.lower().endswith(('.jpg', '.jpeg')) else 'image/png'
    out = (TEMPLATE.replace('__QR__', svg).replace('__CODE__', html.escape(code.upper()))
           .replace('__IMG__', f'data:{mime};base64,{b64}'))
    dest = os.path.join(OUT, f'flyer-gambia-{code}.html')
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(out)
    return dest, url


if __name__ == '__main__':
    args = [a for a in sys.argv[1:]]
    img = IMG_DEFAULT
    if '--img' in args:
        i = args.index('--img'); img = args[i + 1]; del args[i:i + 2]
    codes = [c.strip() for c in args if c.strip()]
    if not codes:
        print(__doc__); sys.exit(1)
    if not os.path.exists(img):
        print('no existe la imagen:', img); sys.exit(2)
    for c in codes:
        dest, url = build(c, img)
        print(f'{dest}  →  {url}')
