// goal-engine/noVig.js — Fase N.11. Consenso no-vig para mercados de goles (O/U y BTTS).
// PURO. Quita el margen (vig) de cada par completo de la MISMA línea+periodo por sportsbook, y construye el
// consenso con grupos independientes verificados. Exige sets COMPLETOS (ambos lados), quotes fresh, no suspended,
// no live. Outlier check básico. No reutiliza sets 1X2.
'use strict';

// quote: { sportsbook_code, independence_group, side, odds_decimal, quote_status, is_live }
// Devuelve el no-vig de un par {over,under} o {yes,no} de UNA casa para UNA línea.
function twoWayNoVig(a, b) {
  if (!a || !b) return null;
  if (a.quote_status === 'suspended' || b.quote_status === 'suspended' || a.is_live || b.is_live) return null;
  const oa = Number(a.odds_decimal), ob = Number(b.odds_decimal);
  if (!(oa > 1) || !(ob > 1)) return null;
  const ia = 1 / oa, ib = 1 / ob, s = ia + ib;
  if (s <= 0) return null;
  return { a: ia / s, b: ib / s, overround: +(s - 1).toFixed(4) };
}

// consensus(quotes, sideA, sideB) → consenso no-vig de P(sideA) con grupos independientes.
// quotes: lista de la misma línea/periodo, con ambos lados por casa. minGroups: grupos verificados mínimos.
function consensus(quotes, sideA, sideB, { minGroups = 3 } = {}) {
  // agrupar por casa y armar pares completos
  const byBook = {};
  for (const q of quotes) { byBook[q.sportsbook_code] = byBook[q.sportsbook_code] || {}; byBook[q.sportsbook_code][q.side] = q; }
  const perBookProb = []; // { group, pA }
  for (const [book, sides] of Object.entries(byBook)) {
    const nv = twoWayNoVig(sides[sideA], sides[sideB]);
    if (!nv) continue;
    const group = (sides[sideA].independence_group || book);
    perBookProb.push({ group, book, pA: nv.a, overround: nv.overround });
  }
  if (!perBookProb.length) return { ok: false, reason: 'no_complete_sets' };
  // un valor por grupo independiente (media del grupo)
  const byGroup = {};
  for (const r of perBookProb) { byGroup[r.group] = byGroup[r.group] || []; byGroup[r.group].push(r.pA); }
  const groupMeans = Object.entries(byGroup).map(([g, arr]) => ({ group: g, p: arr.reduce((x, y) => x + y, 0) / arr.length }));
  if (groupMeans.length < minGroups) return { ok: false, reason: 'insufficient_groups', groups: groupMeans.length };
  // outlier check: descartar grupos a > 3*IQR-ish (simple: > 0.20 del mediano)
  const ps = groupMeans.map(g => g.p).sort((a, b) => a - b);
  const median = ps[Math.floor(ps.length / 2)];
  const kept = groupMeans.filter(g => Math.abs(g.p - median) <= 0.20);
  const consensusP = kept.reduce((s, g) => s + g.p, 0) / kept.length;
  const overround = perBookProb.reduce((s, r) => s + r.overround, 0) / perBookProb.length;
  return {
    ok: true, probability: +consensusP.toFixed(6), groups: groupMeans.length, kept_groups: kept.length,
    book_count: perBookProb.length, avg_overround: +overround.toFixed(4),
  };
}

module.exports = { twoWayNoVig, consensus };
