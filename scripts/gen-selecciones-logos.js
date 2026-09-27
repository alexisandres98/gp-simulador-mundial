// gen-selecciones-logos.js — escudos de SELECCIONES (27-sep-2026, orden de Alexis: «ponle los logos de la
// selección» a las copas de selecciones). Misma línea que gen-club-logos.js: tile self-hosteado en
// public/logos/<tm_id>.png, que el cliente ya pinta para cualquier id tm_* (premium.js clubLogo / landing.js).
// Fuente: API-Football, determinista por id — los ids del pool `selecciones` son tm_af<id>, así que el escudo
// oficial vive en media.api-sports.io/football/teams/<id>.png sin emparejar nombres.
// Logos de competición: FotMob leaguelogo (ids verificados contra /allLeagues el 27-sep).
// Uso: node scripts/gen-selecciones-logos.js           (solo baja los que faltan; FORCE=1 re-baja todos)
'use strict';
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'public', 'logos');
fs.mkdirSync(OUT, { recursive: true });
const RT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'clubs', 'ratings.json'), 'utf8'));
const POOL = (RT.leagues && RT.leagues.selecciones && RT.leagues.selecciones.ratings) || {};
const LEAGUE_LOGO = { uefanl: 9806, concacafnl: 9821, amistososel: 114 };
const FORCE = /^(1|true)$/i.test(String(process.env.FORCE || ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function dl(url, dest) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 200) return false;   // placeholder o roto
    fs.writeFileSync(dest, buf);
    return true;
  } catch { return false; }
}
(async () => {
  let ok = 0, miss = 0, skip = 0;
  const missNames = [];
  for (const [tid, t] of Object.entries(POOL)) {
    const m = String(tid).match(/^tm_af(\d+)$/);
    if (!m) { miss++; missNames.push(t.name + ' (id no AF)'); continue; }
    const dest = path.join(OUT, tid + '.png');
    if (!FORCE && fs.existsSync(dest)) { skip++; continue; }
    if (await dl(`https://media.api-sports.io/football/teams/${m[1]}.png`, dest)) ok++; else { miss++; missNames.push(t.name); }
    await sleep(120);
  }
  let lg = 0;
  for (const [key, id] of Object.entries(LEAGUE_LOGO)) {
    const dest = path.join(OUT, 'league-' + key + '.png');
    if (!FORCE && fs.existsSync(dest)) continue;
    if (await dl(`https://images.fotmob.com/image_resources/logo/leaguelogo/${id}.png`, dest)) lg++;
  }
  console.log(`selecciones: ${ok} escudos bajados, ${skip} ya estaban, ${miss} sin escudo${missNames.length ? ' (' + missNames.slice(0, 12).join(', ') + ')' : ''} · logos de competición nuevos: ${lg}`);
})();
