// context-engine/contextEngine.js — Fase M.4. Núcleo matemático del Context Engine de GP Intelligence V2.
// PURO y determinista. Transforma una probabilidad base 1X2 (V1 calibrada) en una probabilidad V2 aplicando
// ajustes de contexto EN LOG-SPACE y normalizando con softmax → SIEMPRE suma 1, sin negativos (§8 del spec).
// Reglas: caps por factor / por categoría / total; dedup anti-double-counting; penalización por uncertainty
// (a mayor incertidumbre, el resultado se acerca a la base); fallback seguro a la base. NO se cablea aún.
'use strict';

const OUTCOMES = ['home', 'draw', 'away'];
const EPS = 1e-9;

const DEFAULTS = {
  maxPerFactor: 0.40,     // cap |delta| por factor (log-odds)
  maxPerCategory: 0.60,   // cap |delta| acumulado por categoría
  maxTotal: 0.90,         // cap |delta| total contextual
  maxUncertaintyShrink: 0.5, // a uncertainty=1, el final se mezcla 50% hacia la base
};

const clampDelta = (v, cap) => { const n = Number(v) || 0; return Math.abs(n) > cap ? Math.sign(n) * cap : n; };
function softmax(logits) {
  const m = Math.max(logits.home, logits.draw, logits.away);
  const e = { home: Math.exp(logits.home - m), draw: Math.exp(logits.draw - m), away: Math.exp(logits.away - m) };
  const s = e.home + e.draw + e.away;
  return { home: e.home / s, draw: e.draw / s, away: e.away / s };
}
function toLogits(p) {
  return { home: Math.log(Math.max(EPS, p.home)), draw: Math.log(Math.max(EPS, p.draw)), away: Math.log(Math.max(EPS, p.away)) };
}

// Dedup anti-double-counting: un mismo factor_code no se cuenta dos veces (se queda el de mayor |impacto| total).
function dedupeFactors(factors) {
  const by = new Map();
  for (const f of factors || []) {
    const key = f.factor_code || JSON.stringify([f.category, f.home_logit_delta, f.draw_logit_delta, f.away_logit_delta]);
    const mag = Math.abs(f.home_logit_delta || 0) + Math.abs(f.draw_logit_delta || 0) + Math.abs(f.away_logit_delta || 0);
    const prev = by.get(key);
    if (!prev || mag > prev._mag) by.set(key, { ...f, _mag: mag });
  }
  return [...by.values()];
}

// applyContext({ base:{home,draw,away}, factors:[{factor_code,category,home_logit_delta,draw_logit_delta,away_logit_delta,confidence}],
//                contextUncertainty:0..1, missingCritical:bool, caps?, state? })
// Devuelve la estructura §8/§11 completa.
function applyContext(opts = {}) {
  const caps = { ...DEFAULTS, ...(opts.caps || {}) };
  const base = normalizeVector(opts.base);
  const factors = dedupeFactors(opts.factors);

  // BLOCKED / fallback explícitos
  if (opts.state === 'BLOCKED') return result(base, base, base, factors.length, 0, 1, 'BLOCKED', {});
  if (!factors.length) return result(base, base, base, 0, 0, num(opts.contextUncertainty, 0), 'BASE_ONLY_FALLBACK', {});

  // acumular deltas por outcome, con cap por factor y por categoría
  const total = { home: 0, draw: 0, away: 0 };
  const byCat = {};
  let applied = 0;
  for (const f of factors) {
    const cat = f.category || 'uncategorized';
    byCat[cat] = byCat[cat] || { home: 0, draw: 0, away: 0 };
    let moved = false;
    for (const o of OUTCOMES) {
      let d = clampDelta(f[`${o}_logit_delta`], caps.maxPerFactor);
      // cap por categoría (sobre el acumulado de la categoría en ese outcome)
      const room = caps.maxPerCategory - Math.abs(byCat[cat][o]);
      if (room <= 0) d = 0; else if (Math.abs(d) > room) d = Math.sign(d) * room;
      byCat[cat][o] += d; total[o] += d;
      if (Math.abs(d) > EPS) moved = true;
    }
    if (moved) applied++;
  }
  // cap TOTAL contextual (sobre la norma L1 del vector de deltas)
  const l1 = Math.abs(total.home) + Math.abs(total.draw) + Math.abs(total.away);
  if (l1 > caps.maxTotal && l1 > 0) { const k = caps.maxTotal / l1; for (const o of OUTCOMES) total[o] *= k; }

  const baseLogits = toLogits(base);
  const preVec = softmax({ home: baseLogits.home + total.home, draw: baseLogits.draw + total.draw, away: baseLogits.away + total.away });

  // penalización por uncertainty: mezclar el pre-uncertainty hacia la base (no inventar certeza)
  const u = Math.max(0, Math.min(1, num(opts.contextUncertainty, 0)));
  const shrink = u * caps.maxUncertaintyShrink;
  const finalVec = normalizeVector({
    home: (1 - shrink) * preVec.home + shrink * base.home,
    draw: (1 - shrink) * preVec.draw + shrink * base.draw,
    away: (1 - shrink) * preVec.away + shrink * base.away,
  });

  const state = opts.missingCritical ? 'PARTIAL_CONTEXT' : (opts.state || 'FULL_CONTEXT');
  const confidence = +(1 - u).toFixed(4);
  return result(base, preVec, finalVec, factors.length, applied, u, state, total);
}

function result(base, pre, final, factorCount, applied, uncertainty, state, adjustments) {
  return {
    base_vector: round3(base),
    context_adjustments: { home: +(+adjustments.home || 0).toFixed(6), draw: +(+adjustments.draw || 0).toFixed(6), away: +(+adjustments.away || 0).toFixed(6) },
    pre_uncertainty_vector: round3(pre),
    final_vector: round3(final),
    factor_count: factorCount,
    applied_factor_count: applied,
    uncertainty: +(+uncertainty).toFixed(4),
    confidence: +(1 - uncertainty).toFixed(4),
    context_state: state,
  };
}

const num = (v, d) => (v == null || isNaN(Number(v))) ? d : Number(v);
function normalizeVector(v) {
  const h = Math.max(0, num(v && v.home, 0)), d = Math.max(0, num(v && v.draw, 0)), a = Math.max(0, num(v && v.away, 0));
  const s = h + d + a; if (s <= 0) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: h / s, draw: d / s, away: a / s };
}
const round3 = v => ({ home: +v.home.toFixed(4), draw: +v.draw.toFixed(4), away: +v.away.toFixed(4) });

module.exports = { OUTCOMES, DEFAULTS, softmax, toLogits, dedupeFactors, applyContext, normalizeVector };
