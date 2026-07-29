#!/usr/bin/env node
/**
 * BACKFILL DE OFICIALES (#4, 29-jul) — árbitro y jueces por pelea, desde el core API de ESPN.
 *
 * `.../competitions/{id}/officials` devuelve el ÁRBITRO y los tres JUECES con nombre y posición, y la
 * cobertura es completa en todas las eras probadas (2012→2026).
 *
 * POR QUÉ IMPORTA: en fútbol el árbitro es nuestro edge en tarjetas. En MMA el árbitro decide cuánto se
 * permite antes de parar una pelea — o sea que toca directo a las familias METHOD y ROUNDS, que SÍ
 * publicamos. Y los jueces tienen sesgos documentados en decisiones divididas.
 *
 * Uso: node scripts/combat-officials-backfill.js [--org=ufc] [--sleep=ms] [--limit=N]
 * Salida: data/combat/officials-<org>.json  → { comp_id: { ref, judges:[] } }
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const ORG = args.org || 'ufc';
const LEAGUE = ORG === 'mma' ? null : 'ufc';   // el dataset mma agrupa varias ligas: se usa la del fight
const SLEEP = +args.sleep || 190;
const LIMIT = args.limit ? +args.limit : Infinity;
const OUT = path.join(__dirname, '..', 'data', 'combat', `officials-${ORG}.json`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function officials(lg, evId, compId) {
  const u = `https://sports.core.api.espn.com/v2/sports/mma/leagues/${lg}/events/${evId}/competitions/${compId}/officials`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'GPSimulador/1.0' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) { await sleep(1200 * (i + 1)); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      const out = { ref: null, judges: [] };
      for (const it of (j.items || [])) {
        const nm = ((it.firstName || '') + ' ' + (it.lastName || '')).trim();
        const pos = ((it.position || {}).displayName || (it.position || {}).name || '').toLowerCase();
        if (!nm) continue;
        if (pos.includes('referee')) out.ref = nm;
        else if (pos.includes('judge')) out.judges.push(nm);
      }
      return (out.ref || out.judges.length) ? out : null;
    } catch { await sleep(800 * (i + 1)); }
  }
  return undefined; // no determinado → se reintenta otro día
}

(async () => {
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'combat', `fights-${ORG}.json`), 'utf8'));
  const fights = (F.fights || []).filter(f => f.completed && f.comp_id && f.event_id)
    .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, LIMIT);
  let db = {}; try { db = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { db = { officials: {} }; }
  db.officials = db.officials || {};

  let done = 0, got = 0, none = 0;
  for (const f of fights) {
    if (db.officials[f.comp_id] !== undefined) { done++; continue; }   // idempotente
    const lg = LEAGUE || f.lg || 'ufc';
    const o = await officials(lg, f.event_id, f.comp_id);
    await sleep(SLEEP);
    done++;
    if (o === undefined) continue;                 // throttled: se reintenta
    if (!o) { db.officials[f.comp_id] = null; none++; continue; }
    db.officials[f.comp_id] = o; got++;
    if (done % 200 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(db));
      console.log(`  ${done}/${fights.length} · con oficiales ${got} · sin datos ${none}`);
    }
  }
  db.updated_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(db));
  const vals = Object.values(db.officials).filter(Boolean);
  const refs = {}; for (const v of vals) if (v.ref) refs[v.ref] = (refs[v.ref] || 0) + 1;
  console.log(`\nLISTO → ${OUT}`);
  console.log(`peleas con oficiales: ${vals.length} · árbitros distintos: ${Object.keys(refs).length}`);
  console.log('árbitros más frecuentes:', Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} (${v})`).join(' · '));
})();
