// combat-photos-tsdb.js — pase 6 de fotos (12-ago, orden de Alexis: "no quiero peleadores sin foto").
// Los 5 pases de Wikipedia/Wikidata dejaron miles sin foto porque el artículo no tiene imagen (caso Conor
// Benn: página SIN pageimage) o no hay artículo. TheSportsDB (API libre, deporte 'Fighting') tiene foto y
// recorte de la mayoría de boxeadores/peleadores activos → searchplayers por nombre.
// REGLAS DE LA CASA: match por nombre normalizado EXACTO dentro del deporte Fighting; empate con imágenes
// distintas → null (mejor sin foto que con la foto de otro). Idempotente y retomable: marca tsdb_tried
// para no re-preguntar misses en cada corrida; guarda cada 25.
// Uso: node scripts/combat-photos-tsdb.js [boxing|ufc|mma|regional] [--limit=N] [--retry-misses]
'use strict';
const fs = require('fs');
const path = require('path');

const ORG = (process.argv[2] || 'boxing').replace(/^--.*/, '') || 'boxing';
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const RETRY = process.argv.includes('--retry-misses');
const FILE = path.join(__dirname, '..', 'data', 'combat', `fighters-${ORG}.json`);
const UA = 'GPSimulador/1.0 (gpsimulador.com; contacto@gpsimulador.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) { await sleep(4000 * (i + 1)); continue; } // throttle ≠ inexistente
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

async function tsdbPhoto(name) {
  const j = await getJson(`https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${encodeURIComponent(name)}`);
  const players = (j && j.player) || [];
  const n = norm(name);
  // solo deporte de combate y nombre EXACTO normalizado
  const hits = players.filter(p => /fighting|boxing/i.test(p.strSport || '') && norm(p.strPlayer) === n);
  const withImg = hits.map(p => p.strCutout || p.strThumb || p.strRender).filter(Boolean);
  if (!withImg.length) return null;
  // empate honesto: dos imágenes DISTINTAS para el mismo nombre = ambiguo → null
  const uniq = [...new Set(withImg)];
  if (uniq.length > 1 && hits.length > 1) return null;
  return uniq[0];
}

(async () => {
  const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const ids = Object.keys(db).filter(id => {
    const f = db[id];
    if (!f || f.headshot) return false;
    if (!RETRY && f.tsdb_tried) return false;
    return !!f.name;
  });
  console.log(`[tsdb:${ORG}] sin foto y sin intentar: ${ids.length}${LIMIT ? ` (limit ${LIMIT})` : ''}`);
  let done = 0, found = 0;
  for (const id of ids) {
    if (LIMIT && done >= LIMIT) break;
    const f = db[id];
    const url = await tsdbPhoto(f.name);
    f.tsdb_tried = new Date().toISOString().slice(0, 10);
    if (url) { f.headshot = url; f.photo_src = 'tsdb'; found++; }
    done++;
    if (done % 25 === 0) {
      fs.writeFileSync(FILE, JSON.stringify(db));
      console.log(`[tsdb:${ORG}] ${done}/${ids.length} — fotos nuevas: ${found}`);
    }
    await sleep(1200);
  }
  fs.writeFileSync(FILE, JSON.stringify(db));
  const total = Object.keys(db).length, con = Object.values(db).filter(x => x && x.headshot).length;
  console.log(`[tsdb:${ORG}] FIN — procesados ${done}, fotos nuevas ${found}. Cobertura: ${con}/${total} (${Math.round(con / total * 100)}%)`);
})();
