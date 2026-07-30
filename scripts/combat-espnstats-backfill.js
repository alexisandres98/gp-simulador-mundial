#!/usr/bin/env node
/**
 * BACKFILL DE STATS DETALLADAS DE ESPN (#5, 30-jul) — 43 métricas por peleador por pelea, gratis.
 *
 * CONTEXTO: el objetivo original de #5 era el desglose POR ROUND (curva de desgaste). Está BLOQUEADO:
 * la única fuente con datos por round es ufcstats.com, que sirve un desafío de prueba-de-trabajo en JS
 * (anti-bot) y NO se saltan protecciones. api-sports tampoco tiene rounds (verificado: "The Round field
 * do not exist").
 *
 * PERO buscando eso apareció algo mejor: el core API de ESPN expone
 *   .../competitions/{compId}/competitors/{athleteId}/statistics/0
 * con 43 stats por pelea — estrictamente MÁS RICO que el api-sports PRO que pagamos:
 *   · ACCURACY real: intentos Y conectados en cada categoría (api-sports solo da conectados)
 *   · POSICIÓN: distancia / clinch / suelo por separado (api-sports solo da cabeza/cuerpo/piernas)
 *   · GRAPPLING de verdad: advances a media guardia / lateral / montada / espalda, reversiones, slams
 *   · timeInControl, takedownAccuracy, targetBreakdown, posBreakdown
 * Y con cobertura COMPLETA desde 2010 (verificado 3/3 en 2010, 2014, 2017, 2020, 2022, 2024, 2026),
 * o sea ~3x las peleas que cubre api-sports (2022+).
 *
 * Uso: node scripts/combat-espnstats-backfill.js [--org=ufc] [--from=2010] [--sleep=ms] [--limit=N]
 * Salida: data/combat/espnstats-<org>.json → { comp_id: { <fighterId>: {..43 stats..} } }
 * Idempotente: re-ejecutable, solo pide lo que falta.
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const ORG = args.org || 'ufc';
const FROM = args.from || '2010';
const SLEEP = +args.sleep || 130;
const LIMIT = args.limit ? +args.limit : Infinity;
const OUT = path.join(__dirname, '..', 'data', 'combat', `espnstats-${ORG}.json`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// solo las métricas que aportan algo nuevo (se descarta wallclock y los precomputados redundantes)
const KEEP = new Set(['knockDowns', 'totalStrikesAttempted', 'totalStrikesLanded', 'sigStrikesAttempted', 'sigStrikesLanded',
  'sigDistanceHeadStrikesAttempted', 'sigDistanceHeadStrikesLanded', 'sigDistanceBodyStrikesAttempted', 'sigDistanceBodyStrikesLanded',
  'sigDistanceLegStrikesAttempted', 'sigDistanceLegStrikesLanded', 'sigClinchHeadStrikesAttempted', 'sigClinchHeadStrikesLanded',
  'sigClinchBodyStrikesAttempted', 'sigClinchBodyStrikesLanded', 'sigClinchLegStrikesAttempted', 'sigClinchLegStrikesLanded',
  'sigGroundHeadStrikesAttempted', 'sigGroundHeadStrikesLanded', 'sigGroundBodyStrikesAttempted', 'sigGroundBodyStrikesLanded',
  'sigGroundLegStrikesAttempted', 'sigGroundLegStrikesLanded', 'takedownsAttempted', 'takedownsLanded', 'takedownsSlams',
  'advances', 'advanceToHalfGuard', 'advanceToSide', 'advanceToMount', 'advanceToBack', 'reversals', 'submissions', 'timeInControl']);

async function statsFor(lg, evId, compId, athId) {
  const u = `https://sports.core.api.espn.com/v2/sports/mma/leagues/${lg}/events/${evId}/competitions/${compId}/competitors/${athId}/statistics/0`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'GPSimulador/1.0' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1)); continue; }
      if (r.status === 404) return null;         // esa pelea no tiene stats
      if (!r.ok) return null;
      const j = await r.json();
      const st = (((j.splits || {}).categories || [])[0] || {}).stats || [];
      if (!st.length) return null;
      const out = {};
      for (const s of st) if (KEEP.has(s.name)) out[s.name] = +s.value;
      return Object.keys(out).length ? out : null;
    } catch { await sleep(700 * (i + 1)); }
  }
  return undefined;   // indeterminado → reintentar otro día
}

(async () => {
  const F = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'combat', `fights-${ORG}.json`), 'utf8'));
  const fights = (F.fights || []).filter(f => f.completed && f.comp_id && f.event_id && f.f1.id && f.f2.id && f.date >= FROM)
    .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, LIMIT);
  let db = {}; try { db = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { db = { stats: {} }; }
  db.stats = db.stats || {};
  console.log(`${fights.length} peleas de ${ORG} desde ${FROM}`);

  let done = 0, got = 0, none = 0;
  for (const f of fights) {
    if (db.stats[f.comp_id] !== undefined) { done++; continue; }
    const lg = f.lg || (ORG === 'ufc' ? 'ufc' : 'ufc');
    const a = await statsFor(lg, f.event_id, f.comp_id, f.f1.id); await sleep(SLEEP);
    const b = await statsFor(lg, f.event_id, f.comp_id, f.f2.id); await sleep(SLEEP);
    done++;
    if (a === undefined || b === undefined) continue;      // throttled: se reintenta
    if (!a && !b) { db.stats[f.comp_id] = null; none++; }
    else { const row = {}; if (a) row[f.f1.id] = a; if (b) row[f.f2.id] = b; db.stats[f.comp_id] = row; got++; }
    if (done % 150 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(db));
      console.log(`  ${done}/${fights.length} · con stats ${got} · sin stats ${none}`);
    }
  }
  db.updated_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(db));
  const vals = Object.values(db.stats).filter(Boolean);
  console.log(`\nLISTO → ${OUT}`);
  console.log(`peleas con stats detalladas: ${vals.length} · tamaño ${(fs.statSync(OUT).size / 1e6).toFixed(1)}MB`);
})();
