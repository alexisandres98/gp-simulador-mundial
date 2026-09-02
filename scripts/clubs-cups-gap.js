#!/usr/bin/env node
'use strict';
// scripts/clubs-cups-gap.js — ¿baja la discrepancia modelo−mercado en COPAS con el prior por división?
//
// Recalcula el 1X2 del modelo para las picks SOLID de copas del libro con la MISMA regla de fusión de pools
// que usa el servidor (clubs-engine/cups.js) para GAP=0 (lo que había: pools fusionados sin recalibrar) y
// GAP=150 (el prior declarado), y reporta la discrepancia media modelo−mercado en pp del lado elegido,
// separando cruces de la misma división y cruces entre divisiones. Con resultados también da el Brier.
//
// Uso:
//   node scripts/clubs-cups-gap.js --src <picks.json> [--gap 150] [--ratings data/clubs/ratings.json]
//   <picks.json> = export de /api/internal/clubs-picks?key=...&limit=10000  ({ picks: [...] })
//                  o el clubs_picks_full.json del backtest (mismo shape).
// Limitaciones honestas: usa el Elo BASE de ratings.json (el overlay dinámico db.clubElos vive en db.json y
// no está disponible fuera del servidor), sin descanso ni observer. La comparación GAP=0 vs GAP=150 sí es
// limpia porque ambas corren sobre el mismo Elo base. No arranca el servidor ni toca nada en disco.

const fs = require('fs');
const path = require('path');
const { matchProbs } = require('../engine');
const CUPS = require('../clubs-engine/cups');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const SRC = arg('--src', null);
const GAP = Number(arg('--gap', 150));
const RATINGS = arg('--ratings', path.join(__dirname, '..', 'data', 'clubs', 'ratings.json'));

if (!SRC || !fs.existsSync(SRC)) {
  console.error('Falta --src <picks.json> (export de /api/internal/clubs-picks?key=...&limit=10000 o clubs_picks_full.json).');
  process.exit(2);
}
const RT0 = JSON.parse(fs.readFileSync(RATINGS, 'utf8'));
const raw = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const picks = Array.isArray(raw) ? raw : (raw.picks || raw.clubs && raw.clubs.picks || []);

// liga virtual de copa para un GAP dado (copias; RT0 no se muta)
function cupLeagues(gap) {
  const out = {};
  for (const [key, cfg] of Object.entries(CUPS.CLUB_CUPS)) if (cfg.from.length) out[key] = CUPS.buildCupLeague(RT0, key, cfg, gap);
  return out;
}
const L0 = cupLeagues(0), LG = cupLeagues(GAP);
const cupKeys = new Set(Object.keys(LG));

const r1 = (x) => (x == null || !isFinite(x)) ? null : +x.toFixed(1);
const r3 = (x) => (x == null || !isFinite(x)) ? null : +x.toFixed(3);
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

const rows = [];
let skipped = { no_cup: 0, no_team: 0, no_market: 0 };
for (const p of picks) {
  if (p.family !== 'SOLID' || !cupKeys.has(p.league)) { skipped.no_cup++; continue; }
  const ev = p.event || {};
  const h = ev.home_team_id, a = ev.away_team_id;
  const A = LG[p.league], B = L0[p.league];
  if (!A.ratings[h] || !A.ratings[a]) { skipped.no_team++; continue; }
  const k = Number(p.market_prob);
  if (!(k > 0 && k < 1)) { skipped.no_market++; continue; }
  const side = String(p.selection_code || '').replace(/^not_/, '');
  if (!['home', 'draw', 'away'].includes(side)) continue;
  const prob = (L) => matchProbs(L.ratings[h].elo + (L.hfa || 55), L.ratings[a].elo)[side];
  const m0 = prob(B), mG = prob(A);
  const cross = A.ratings[h].tier !== A.ratings[a].tier;
  const y = p.result_code === 'WIN' ? 1 : p.result_code === 'LOSS' ? 0 : null;
  rows.push({ league: p.league, side, cross, k, m0, mG, y, m_saved: Number(p.model_prob_raw != null ? p.model_prob_raw : p.model_prob) || null });
}

function block(rs, label) {
  const d0 = rs.map((r) => (r.m0 - r.k) * 100), dG = rs.map((r) => (r.mG - r.k) * 100);
  const dec = rs.filter((r) => r.y != null);
  const brier = (f) => dec.length ? mean(dec.map((r) => (f(r) - r.y) ** 2)) : null;
  return {
    tramo: label, n: rs.length,
    disc_gap0_pp: r1(mean(d0)), disc_gapX_pp: r1(mean(dG)),
    abs_disc_gap0_pp: r1(mean(d0.map(Math.abs))), abs_disc_gapX_pp: r1(mean(dG.map(Math.abs))),
    sd_gap0: r1(sd(d0)), sd_gapX: r1(sd(dG)),
    n_decididas: dec.length, brier_mercado: r3(brier((r) => r.k)), brier_gap0: r3(brier((r) => r.m0)), brier_gapX: r3(brier((r) => r.mG)),
  };
}
const out = {
  src: SRC, gap: GAP, picks_total: picks.length, solid_copas: rows.length, skipped,
  tramos: [block(rows, 'todas'), block(rows.filter((r) => r.cross), 'cruzan división'), block(rows.filter((r) => !r.cross), 'misma división')],
  por_copa: Object.fromEntries([...new Set(rows.map((r) => r.league))].map((lg) => [lg, block(rows.filter((r) => r.league === lg), lg)])),
};
console.log(JSON.stringify(out, null, 1));
if (!rows.length) console.error('\nSin picks SOLID de copas fusionadas en el libro dado (o sin ids de equipo resolubles).');
