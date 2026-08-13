// scripts/clubs-af-photos.js — fotos de jugadores de ligas AF (13-ago, paridad parte 2).
// Los pids afp<id> tienen foto oficial determinista en media.api-sports.io/football/players/<id>.png.
// Baja el player-photos.json de prod, mergea las entradas afp* de los player-history AF locales y re-sube.
// Uso: GP_EXPORT_KEY=xxx [GP_BASE=...] node scripts/clubs-af-photos.js [liga ...]
'use strict';
const fs = require('fs');
const path = require('path');
const XK = process.env.GP_EXPORT_KEY || '';
const BASE = process.env.GP_BASE || 'https://gpsimulador.com';
if (!XK) { console.error('Falta GP_EXPORT_KEY'); process.exit(1); }
const LEAGUES = process.argv.slice(2).length ? process.argv.slice(2) : ['saudi', 'aleague', 'libertadores', 'sudamericana', 'leaguescup'];

(async () => {
  let photos = {};
  try { photos = await (await fetch(`${BASE}/api/internal/clubs-data?key=${XK}&name=player-photos.json`)).json(); } catch { /* arranca vacío */ }
  if (!photos || typeof photos !== 'object' || photos.error) photos = {};
  const before = Object.keys(photos).length;
  for (const lg of LEAGUES) {
    let H = null;
    try { H = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'clubs', `player-history-${lg}.json`), 'utf8')); } catch { continue; }
    for (const r of H.rows || []) {
      const m = String(r.pid || '').match(/^afp(\d+)$/);
      if (m && !photos[r.pid]) photos[r.pid] = { photo: `https://media.api-sports.io/football/players/${m[1]}.png`, af_id: Number(m[1]) };
    }
  }
  const added = Object.keys(photos).length - before;
  const r = await fetch(`${BASE}/api/internal/clubs-data?key=${XK}&name=player-photos.json`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(photos) });
  console.log(`player-photos.json: ${before} → ${Object.keys(photos).length} (+${added}) · subida ${r.status}`);
})();
