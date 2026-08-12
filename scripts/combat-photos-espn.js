// combat-photos-espn.js — pase 7 de fotos (12-ago): headshot de ESPN por ID directo.
// Nuestros ids de UFC/MMA/regional SON ids de ESPN y el CDN sirve headshots por patrón fijo —
// el harvest original solo guardó los que la API devolvió en su momento; peleadores dados de alta
// después (caso Namsrai Batbayar, UFC 330) quedaron sin foto teniéndola. HEAD por id, barato,
// idempotente (espn_tried), y solo acepta 200 con peso real (>3KB — el CDN no sirve siluetas).
// Uso: node scripts/combat-photos-espn.js [ufc|mma|regional|boxing] [--limit=N]
'use strict';
const fs = require('fs');
const path = require('path');

const ORG = (process.argv[2] || 'ufc').replace(/^--.*/, '') || 'ufc';
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || 0);
const FILE = path.join(__dirname, '..', 'data', 'combat', `fighters-${ORG}.json`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function espnHead(id) {
  const url = `https://a.espncdn.com/i/headshots/mma/players/full/${id}.png`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      if (r.status === 404) return null;
      if (r.status === 200) {
        const size = Number(r.headers.get('content-length') || 0);
        return size > 3000 ? url : null;
      }
      await sleep(1500 * (i + 1));
    } catch { await sleep(1000 * (i + 1)); }
  }
  return null;
}

(async () => {
  const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const ids = Object.keys(db).filter(id => {
    const f = db[id];
    return f && !f.headshot && !f.espn_tried && /^\d+$/.test(id); // solo ids numéricos = ids de ESPN
  });
  console.log(`[espn:${ORG}] sin foto con id ESPN: ${ids.length}${LIMIT ? ` (limit ${LIMIT})` : ''}`);
  let done = 0, found = 0;
  for (const id of ids) {
    if (LIMIT && done >= LIMIT) break;
    const url = await espnHead(id);
    db[id].espn_tried = new Date().toISOString().slice(0, 10);
    if (url) { db[id].headshot = url; db[id].photo_src = 'espn'; found++; }
    done++;
    if (done % 100 === 0) { fs.writeFileSync(FILE, JSON.stringify(db)); console.log(`[espn:${ORG}] ${done}/${ids.length} — nuevas: ${found}`); }
    await sleep(150);
  }
  fs.writeFileSync(FILE, JSON.stringify(db));
  const total = Object.keys(db).length, con = Object.values(db).filter(x => x && x.headshot).length;
  console.log(`[espn:${ORG}] FIN — procesados ${done}, fotos nuevas ${found}. Cobertura: ${con}/${total} (${Math.round(con / total * 100)}%)`);
})();
