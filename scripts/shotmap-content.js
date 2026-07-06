// scripts/shotmap-content.js — Genera la pieza de CONTENIDO "mapa de remates" de un partido terminado.
// Fuente: TheStatsAPI shotmap (x = distancia a la portería atacada, y = ancho 0-100, xG por remate).
// Produce ig-src/shotmap-<home>-<away>.html (1080x1350, estilo dark premium de la casa) listo para render
// con Chrome headless → public/ig/shotmap-<home>-<away>.png.
// Uso: THESTATSAPI_KEY=... node scripts/shotmap-content.js BRA NOR "1 - 2" "Noruega dio el golpe"
'use strict';
const fs = require('fs');
const path = require('path');
const tsa = require('../data-providers/theStatsApi');
const { TEAMS } = require('../data/tournament');

const [home, away, scoreArg, hookArg] = process.argv.slice(2);
if (!home || !away) { console.error('uso: node scripts/shotmap-content.js HOME AWAY [marcador] [gancho]'); process.exit(1); }
const NAME = {}; TEAMS.forEach(t => NAME[t.id] = t.name || t.en);
const FLAG = {}; TEAMS.forEach(t => FLAG[t.id] = t.flag || '');

(async () => {
  const sm = await tsa.shotmap(home, away);
  if (!sm) { console.error('sin shotmap para ' + home + '-' + away); process.exit(1); }
  const shots = sm.shots || [];
  // lado de cada remate: team_name del proveedor → código local vía la tabla de alias del torneo
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const A2I = {};
  TEAMS.forEach(t => { [t.en, t.name, t.id, ...(t.aliases || [])].filter(Boolean).forEach(a => { A2I[norm(a)] = t.id; }); });
  A2I[norm('Cape Verde Islands')] = 'CPV';
  const sideShots = side => shots.filter(s => A2I[norm(s.team_name)] === (side === 'home' ? home : away));
  const xgSum = arr => arr.reduce((x, s) => x + (s.expected_goals || 0), 0);

  const panel = (side, code) => {
    const arr = sideShots(side);
    const dots = arr.map(s => {
      const gx = Math.min(45, Math.max(0, Number(s.x) || 0));         // distancia a la portería (m aprox)
      const gy = Math.min(100, Math.max(0, Number(s.y) || 50));       // ancho de cancha 0-100
      const top = 40 + (gx / 45) * 560;                                // portería arriba
      const left = 30 + (gy / 100) * 380;
      const r = Math.max(9, Math.min(30, 9 + (s.expected_goals || 0) * 46));
      const goal = s.result === 'goal';
      const onT = s.result === 'save' || s.is_on_target;
      const style = goal ? 'background:#1FE3A4;box-shadow:0 0 18px rgba(31,227,164,.65);border:2px solid #fff'
        : onT ? 'background:rgba(52,214,200,.30);border:2px solid #34D6C8'
          : 'background:rgba(255,255,255,.10);border:2px solid rgba(255,255,255,.30)';
      return `<div class="dot" style="left:${left.toFixed(0)}px;top:${top.toFixed(0)}px;width:${r * 2}px;height:${r * 2}px;margin:-${r}px 0 0 -${r}px;${style}" title="${s.player_name} ${s.expected_goals}"></div>`;
    }).join('');
    return `<div class="half">
      <div class="hh">${FLAG[code] || ''} ${NAME[code] || code} <span class="hxg">${xgSum(arr).toFixed(2)} xG · ${arr.length} remates</span></div>
      <div class="pitch">
        <div class="goal"></div><div class="box"></div><div class="boxin"></div><div class="pen"></div>
        ${dots}
      </div>
    </div>`;
  };

  const score = scoreArg || '';
  const hook = hookArg || '';
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
body { width:1080px; height:1350px; font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;
  background:linear-gradient(160deg,#06090B 0%,#0B1714 50%,#0A5C3C 145%); color:#EAF1F2; padding:46px 60px; position:relative; }
.brand { display:flex; align-items:center; gap:11px; margin-bottom:16px; }
.badge { width:42px; height:42px; border-radius:12px; background:rgba(31,227,164,.16); display:flex; align-items:center; justify-content:center; font-size:23px; border:1px solid rgba(31,227,164,.4); }
.bname { font-size:22px; font-weight:800; color:#fff; }
.tag { margin-left:auto; background:rgba(229,72,77,.95); color:#fff; font-weight:800; font-size:15px; padding:9px 18px; border-radius:99px; letter-spacing:1.5px; }
h1 { font-size:44px; font-weight:800; letter-spacing:-1.5px; color:#fff; }
.sub { font-size:19px; color:#9DB0B5; font-weight:600; margin:6px 0 26px; }
.halves { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
.half .hh { font-size:21px; font-weight:800; margin-bottom:10px; display:flex; align-items:center; gap:8px; }
.half .hxg { margin-left:auto; font-size:15px; color:#1FE3A4; font-weight:700; }
.pitch { position:relative; height:640px; background:linear-gradient(180deg,rgba(31,227,164,.10),rgba(31,227,164,.03)); border:2px solid rgba(255,255,255,.16); border-radius:14px; overflow:hidden; }
.goal { position:absolute; top:-2px; left:50%; width:120px; height:10px; margin-left:-60px; background:#1FE3A4; border-radius:0 0 6px 6px; opacity:.85; }
.box { position:absolute; top:0; left:50%; width:300px; height:150px; margin-left:-150px; border:1.5px solid rgba(255,255,255,.22); border-top:none; }
.boxin { position:absolute; top:0; left:50%; width:140px; height:56px; margin-left:-70px; border:1.5px solid rgba(255,255,255,.22); border-top:none; }
.pen { position:absolute; top:100px; left:50%; width:5px; height:5px; margin-left:-2.5px; border-radius:50%; background:rgba(255,255,255,.5); }
.dot { position:absolute; border-radius:50%; }
.legend { display:flex; gap:26px; margin-top:20px; font-size:16px; color:#9DB0B5; font-weight:600; align-items:center; }
.li { display:flex; align-items:center; gap:8px; }
.sw { width:16px; height:16px; border-radius:50%; display:inline-block; }
.xgbar { display:flex; align-items:center; gap:16px; margin-top:26px; }
.xgl { font-size:24px; color:#EAF1F2; width:130px; } .xgl b { color:#1FE3A4; font-size:30px; }
.xgtrack { flex:1; height:16px; border-radius:99px; background:rgba(91,168,255,.35); overflow:hidden; }
.xgtrack i { display:block; height:100%; background:#1FE3A4; border-radius:99px 0 0 99px; }
.foot { position:absolute; bottom:40px; left:60px; right:60px; display:flex; align-items:center; justify-content:space-between; }
.small { font-size:17px; color:#9DB0B5; font-weight:600; max-width:640px; }
.cta { background:#1FE3A4; color:#06231A; font-size:20px; font-weight:800; padding:14px 30px; border-radius:99px; }
</style></head>
<body>
  <div class="brand"><div class="badge">⚽</div><div class="bname">GP Simulador del Mundial</div><div class="tag">● MAPA DE REMATES</div></div>
  <h1>${FLAG[home] || ''} ${NAME[home]} ${score || 'vs'} ${NAME[away]} ${FLAG[away] || ''}</h1>
  <div class="sub">Cada burbuja es un remate · el tamaño es qué tan clara fue la ocasión</div>
  <div class="halves">${panel('home', home)}${panel('away', away)}</div>
  <div class="legend">
    <span class="li"><span class="sw" style="background:#1FE3A4"></span>Gol</span>
    <span class="li"><span class="sw" style="background:rgba(52,214,200,.30);border:2px solid #34D6C8"></span>Al arco</span>
    <span class="li"><span class="sw" style="background:rgba(255,255,255,.10);border:2px solid rgba(255,255,255,.30)"></span>Desviado / bloqueado</span>
  </div>
  <div class="xgbar">
    <div class="xgl"><b>${xgSum(sideShots('home')).toFixed(2)}</b> xG</div>
    <div class="xgtrack"><i style="width:${(xgSum(sideShots('home')) / Math.max(0.01, xgSum(sideShots('home')) + xgSum(sideShots('away'))) * 100).toFixed(1)}%"></i></div>
    <div class="xgl" style="text-align:right"><b>${xgSum(sideShots('away')).toFixed(2)}</b> xG</div>
  </div>
  <div class="foot"><div class="small">${hook}</div><div class="cta">gpsimulador.com</div></div>
</body></html>`;
  const slug = `shotmap-${home.toLowerCase()}-${away.toLowerCase()}`;
  const dest = path.join(__dirname, '..', 'ig-src', slug + '.html');
  fs.writeFileSync(dest, html);
  console.log('generado ' + dest + ` · remates ${sideShots('home').length}+${sideShots('away').length} · xG ${xgSum(sideShots('home')).toFixed(2)}-${xgSum(sideShots('away')).toFixed(2)}`);
  console.log(`render: Chrome headless --window-size=1080,1350 → public/ig/${slug}.png`);
})().catch(e => { console.error(e); process.exit(1); });
