#!/usr/bin/env python3
"""Volante impreso para casas de apuestas en Gambia (5-sep-2026), una variante por repartidor.

Cada repartidor lleva su propio código de referido: el QR apunta a
gpsimulador.com/landing?ref=<code>&lang=en, así que cada registro y cada pago queda atribuido a quien
entregó el volante (misma atribución first-touch que ya usa la plataforma: `?ref=` → users[e].ref y, si
el código es de un usuario, la comisión de afiliado).

  python3 scripts/flyer-gambia.py <code1> [<code2> ...]
  → ig-src/flyer-gambia-<code>.html  (A6 a 300 dpi: 1240×1748 px)
  luego, de UNO en uno (Chrome se cuelga con dos en el mismo script):
  chromium --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=1240,1840 \
    --screenshot=public/ig/flyer-gambia-<code>.png ig-src/flyer-gambia-<code>.html
  node scripts/png-crop.js public/ig/flyer-gambia-<code>.png 1748

Requiere `segno` (pip install segno): QR en SVG, sin red ni binarios.
"""
import html
import sys
import os
import segno

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'ig-src')

TEMPLATE = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; box-sizing: border-box; }
/* A6 a 300 dpi. Margen de seguridad 60 px (~5 mm): nada importante toca el borde. */
body { width: 1240px; height: 1748px; font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
  background: #07110d; color: #EAF1F2; padding: 70px 64px 60px; position: relative; display: flex; flex-direction: column; overflow: hidden; }
body::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 20% 0%, rgba(31,227,164,.22), transparent 55%), radial-gradient(ellipse at 100% 100%, rgba(31,227,164,.14), transparent 50%); pointer-events: none; }
.brand { display: flex; align-items: center; gap: 16px; margin-bottom: 46px; position: relative; }
.badge { width: 62px; height: 62px; border-radius: 16px; background: rgba(31,227,164,.16); border: 2px solid rgba(31,227,164,.5); display: flex; align-items: center; justify-content: center; font-size: 34px; }
.bname { font-size: 34px; font-weight: 800; color: #fff; letter-spacing: -.5px; }
.tag { margin-left: auto; background: #1FE3A4; color: #06231A; font-weight: 800; font-size: 22px; padding: 12px 22px; border-radius: 99px; letter-spacing: 1px; }
h1 { font-size: 96px; line-height: .98; font-weight: 800; letter-spacing: -3.5px; color: #fff; margin-bottom: 26px; position: relative; }
h1 span { color: #1FE3A4; }
.sub { font-size: 34px; line-height: 1.25; color: #C7D3D6; font-weight: 600; margin-bottom: 44px; position: relative; }
.list { display: flex; flex-direction: column; gap: 22px; margin-bottom: 46px; position: relative; }
.li { display: flex; gap: 20px; align-items: flex-start; font-size: 30px; line-height: 1.3; color: #EAF1F2; font-weight: 600; }
.li .ck { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 12px; background: rgba(31,227,164,.16); border: 2px solid rgba(31,227,164,.55); color: #1FE3A4; font-weight: 800; font-size: 26px; display: flex; align-items: center; justify-content: center; margin-top: 1px; }
.li b { color: #1FE3A4; }
.steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-bottom: 40px; position: relative; }
.step { background: rgba(255,255,255,.04); border: 2px solid rgba(255,255,255,.10); border-radius: 22px; padding: 24px 22px; }
.step .n { width: 46px; height: 46px; border-radius: 50%; background: #1FE3A4; color: #06231A; font-weight: 800; font-size: 26px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; }
.step .t { font-size: 27px; font-weight: 800; color: #fff; line-height: 1.15; margin-bottom: 8px; }
.step .d { font-size: 22px; color: #9DB0B5; font-weight: 600; line-height: 1.3; }
.scan { margin-top: auto; display: flex; gap: 40px; align-items: center; background: #0F1A17; border: 2px solid rgba(31,227,164,.35); border-radius: 30px; padding: 40px; position: relative; }
.qr { flex: 0 0 380px; width: 380px; height: 380px; background: #fff; border-radius: 22px; padding: 22px; }
.qr svg { width: 100%; height: 100%; display: block; }
.scan-t { flex: 1; }
.scan-t .big { font-size: 44px; font-weight: 800; color: #fff; line-height: 1.05; letter-spacing: -1px; margin-bottom: 14px; }
.scan-t .big span { color: #1FE3A4; }
.scan-t .free { display: inline-block; background: #1FE3A4; color: #06231A; font-weight: 800; font-size: 26px; padding: 10px 20px; border-radius: 99px; margin-bottom: 22px; }
.scan-t .url { font-size: 27px; color: #C7D3D6; font-weight: 700; word-break: break-all; line-height: 1.3; }
.scan-t .code { font-size: 24px; color: #8FA3A8; font-weight: 600; margin-top: 10px; }
.scan-t .code b { color: #fff; letter-spacing: 1px; }
.foot { margin-top: 34px; font-size: 21px; line-height: 1.4; color: #8FA3A8; font-weight: 600; position: relative; display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; }
.foot .wa { color: #C7D3D6; }
</style></head>
<body>
  <div class="brand"><div class="badge">🎯</div><div class="bname">GP Simulador</div><div class="tag">FOR FOOTBALL BETTORS</div></div>

  <h1>Not sure<br>who to <span>bet on?</span></h1>
  <div class="sub">Check the numbers before you place your ticket. Stop guessing.</div>

  <div class="list">
    <div class="li"><div class="ck">✓</div><div><b>10,000 simulations</b> of every match, every day. Premier League, LaLiga, Serie A, Bundesliga, Brasileirão, esports and more.</div></div>
    <div class="li"><div class="ck">✓</div><div>We tell you which bets are <b>worth the price</b> and which ones the bookie is <b>overcharging you</b> for.</div></div>
    <div class="li"><div class="ck">✓</div><div>Every pick is published <b>with its result</b>. Wins and losses. Nothing hidden, nothing deleted.</div></div>
    <div class="li"><div class="ck">✓</div><div>Works on any phone. <b>In English.</b> Takes one minute to join.</div></div>
  </div>

  <div class="steps">
    <div class="step"><div class="n">1</div><div class="t">Scan the code</div><div class="d">Open your camera and point it at the QR below.</div></div>
    <div class="step"><div class="n">2</div><div class="t">Join with your email</div><div class="d">Free. No card, no app to download.</div></div>
    <div class="step"><div class="n">3</div><div class="t">Get today's picks</div><div class="d">Before you bet. Every day. With the reasoning.</div></div>
  </div>

  <div class="scan">
    <div class="qr">__QR__</div>
    <div class="scan-t">
      <div class="big">Scan for <span>today's picks</span></div>
      <div class="free">FREE TO JOIN</div>
      <div class="url">gpsimulador.com</div>
      <div class="code">Your code: <b>__CODE__</b></div>
    </div>
  </div>

  <div class="foot">
    <div>18+ only. Statistical estimates, not financial advice. Bet responsibly.</div>
    <div class="wa">Questions? Ask the person who gave you this flyer.</div>
  </div>
</body></html>
"""


def build(code: str) -> str:
    url = f"https://gpsimulador.com/landing?ref={code}&lang=en"
    # corrección alta: un volante vive doblado en un bolsillo y se escanea con luz mala
    qr = segno.make(url, error='h')
    svg = qr.svg_inline(scale=10, border=0, dark='#07110d', light=None)
    out = TEMPLATE.replace('__QR__', svg).replace('__CODE__', html.escape(code.upper()))
    dest = os.path.join(OUT, f'flyer-gambia-{code}.html')
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(out)
    return dest, url


if __name__ == '__main__':
    codes = [c.strip() for c in sys.argv[1:] if c.strip()]
    if not codes:
        print(__doc__)
        sys.exit(1)
    for c in codes:
        dest, url = build(c)
        print(f'{dest}  →  {url}')
