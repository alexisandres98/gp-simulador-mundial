// boxing-photos-backfill.js — fotos para los boxeadores sin headshot (4-ago, orden de Alexis: "todos o
// la mayoría"). Dos pases por peleador, idempotente, retomable:
//   1. en.wikipedia pageimages (thumbnail 500px) sobre el título wiki que ya tenemos del cosechador
//   2. Wikidata: enwiki título → entidad → claim P18 (imagen) → URL de Commons via Special:FilePath
// LECCIÓN DEL 29-jul APLICADA: un 429/503 de Wikipedia NO es "no existe" — backoff y reintento; solo
// missing/notfound cuenta como negativo. Guarda cada 25 para no perder progreso.
// Uso: node scripts/boxing-photos-backfill.js [--limit=N]
'use strict';
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'combat', 'fighters-boxing.json');
const UA = 'GPSimulador/1.0 (gpsimulador.com; contacto@gpsimulador.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) { await sleep(2500 * (i + 1)); continue; } // throttle ≠ inexistente
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(1500 * (i + 1)); }
  }
  return null;
}

async function wikiImage(title) {
  const j = await getJson(`https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=500&redirects=1`);
  if (!j || !j.query) return null;
  for (const p of Object.values(j.query.pages || {})) {
    if (p.thumbnail && p.thumbnail.source) return p.thumbnail.source;
  }
  return null;
}

function p18Url(ent) {
  const p18 = ent && ent.claims && ent.claims.P18 && ent.claims.P18[0];
  const file = p18 && p18.mainsnak && p18.mainsnak.datavalue && p18.mainsnak.datavalue.value;
  return file ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(String(file).replace(/ /g, '_'))}?width=500` : null;
}
async function wikidataImage(title) {
  const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&sites=enwiki&titles=${encodeURIComponent(title)}&props=claims&format=json`);
  if (!j || !j.entities) return null;
  for (const ent of Object.values(j.entities)) { const u = p18Url(ent); if (u) return u; }
  return null;
}
// pase 3: el MISMO título en wikis de otros idiomas (muchos boxeadores tienen foto en es/de/ru/pt/ja y no en en)
const LANGS = ['es', 'de', 'ru', 'pt', 'ja', 'uk'];
async function wikiImageAnyLang(title) {
  for (const lg of LANGS) {
    const j = await getJson(`https://${lg}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=pageimages&format=json&pithumbsize=500&redirects=1`);
    if (j && j.query) for (const p of Object.values(j.query.pages || {})) if (p.thumbnail && p.thumbnail.source) return p.thumbnail.source;
    await sleep(150);
  }
  return null;
}
// pase 4: búsqueda por NOMBRE en Wikidata (título distinto al de la página) → entidad humana con P18.
// Desambiguación honesta: solo si el match es único con imagen (empate → null, regla de la casa).
async function wikidataSearchImage(name) {
  const j = await getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name + ' boxer')}&language=en&type=item&limit=5&format=json`);
  const hits = (j && j.search) || [];
  const cand = hits.filter((h) => /boxer|boxeador/i.test(h.description || ''));
  if (cand.length !== 1) return null;
  const e = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${cand[0].id}&props=claims&format=json`);
  return e && e.entities ? p18Url(e.entities[cand[0].id]) : null;
}

(async () => {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? +limitArg.split('=')[1] : Infinity;
  const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const all = Object.values(db);
  const missing = all.filter((f) => !f.headshot && (f.wiki || f.name) && f.photo_miss !== true);
  console.log(`boxeadores: ${all.length} · con foto: ${all.length - missing.length - all.filter(f=>f.photo_miss).length + 0} · a buscar: ${Math.min(missing.length, limit)}`);
  let ok = 0, miss = 0, done = 0;
  const save = () => fs.writeFileSync(FILE, JSON.stringify(db));
  for (const f of missing) {
    if (done >= limit) break;
    done++;
    const title = f.wiki || f.name;
    let img = await wikiImage(title);
    if (!img) { await sleep(300); img = await wikidataImage(title); }
    if (!img) { img = await wikiImageAnyLang(title); }
    if (!img) { await sleep(300); img = await wikidataSearchImage(f.name || title); }
    if (img) { f.headshot = img; delete f.photo_miss; ok++; }
    else { f.photo_miss = true; miss++; } // marca negativa: no re-buscar cada corrida (borrarla para reintentar)
    if (done % 25 === 0) { save(); console.log(`  ${done}/${Math.min(missing.length, limit)} · encontradas ${ok} · sin foto ${miss}`); }
    await sleep(450); // educado: ~2 req/s pico entre ambos endpoints
  }
  save();
  const withPhoto = Object.values(db).filter((f) => f.headshot).length;
  console.log(`FIN: +${ok} fotos nuevas · ${miss} sin fuente · total con foto ${withPhoto}/${all.length} (${Math.round(withPhoto / all.length * 100)}%)`);
})();
