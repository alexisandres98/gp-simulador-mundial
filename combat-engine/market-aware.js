'use strict';
// ═══ MODELO CONSCIENTE DEL MERCADO — combate (3-sep) ═══
// El 2-sep se midió, sobre 4.180 peleas de UFC con cuota de cierre, que el modelo market-blind (Elo + rasgos) NO
// añade información al cierre mezclado linealmente (w* = 1,00 en todos los años). Este módulo es la forma honesta
// de la pregunta: el cierre como ANCLA y cada rasgo como corrección residual sobre su logit,
//
//     logit(p) = close · logit(p_cierre) + Σ feats[i] · x_i
//
// con x_i los rasgos antisimétricos de combat-engine/ratings.js (featDiff, misma escala) más `delo`, la
// discrepancia del Elo puro con el cierre: logit(p_elo) − logit(p_cierre). Sin intercepto: antisimétrico, inmune
// al orden f1/f2 de ESPN. Los coeficientes SALEN del backtest (scripts/combat-market-aware.js) y viven en
// data/combat/market-aware-priors.json con la fecha y la muestra; si ningún rasgo pasa el criterio fuera de
// muestra, son 0 y la función devuelve el cierre tal cual.
//
// TODO lo de aquí es PURO (sin db, sin red) e INFORMATIVO: en la pick FIGHT se persiste `p_mkt_aware` y
// `edge_mkt_aware_pp` para juzgar después; ninguno es compuerta. NO toca ratings.js, ni el blend 0,5, ni el
// umbral 2 pp, ni el techo 3. Se prueba con scripts/smoke/combat-mkt-smoke.js.
const fs = require('fs');
const path = require('path');

// Rasgos que el modelo puede corregir: los 13 de featDiff (sin COMBAT_X_FEATURES) + delo. Se listan a mano
// a propósito —no se importan de ratings.js— para que el archivo de priors sea legible sin el motor.
const FEATURE_KEYS = ['reach', 'exp', 'years', 'age', 'chin', 'streak', 'mileage', 'misswt', 'slpm', 'td15', 'tddef', 'ctrl', 'kdr', 'delo'];
const DEFAULT_PRIORS_FILE = path.join(__dirname, '..', 'data', 'combat', 'market-aware-priors.json');

const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
const logit = (p) => Math.log(clamp(p) / (1 - clamp(p)));
const sigm = (z) => 1 / (1 + Math.exp(-z));

// Coeficientes nulos: close = 1 y todos los rasgos a 0 → la función devuelve p_cierre.
function zeroCoefs() { return { close: 1, feats: Object.fromEntries(FEATURE_KEYS.map(k => [k, 0])) }; }

// Rasgos para UNA pelea a partir de lo que el motor ya calcula: `fd` = CE.featDiff(...) (13 claves) y `pElo` =
// probabilidad del Elo PURO de f1 (CE.expected sobre los ratings con rust, sin capa logística). `delo` necesita
// pClose; sin él queda 0 (el rasgo no actúa).
function featuresFor({ fd, pElo, pClose }) {
  const out = {};
  for (const k of FEATURE_KEYS) {
    if (k === 'delo') out.delo = (isFinite(Number(pElo)) && isFinite(Number(pClose)) && pClose > 0 && pClose < 1) ? logit(pElo) - logit(pClose) : 0;
    else { const v = fd ? Number(fd[k]) : 0; out[k] = isFinite(v) ? v : 0; }
  }
  return out;
}

// Probabilidad de f1 consciente del mercado. pClose = fair de f1 (de-vig proporcional, como combatFightOdds).
// Devuelve null si pClose no es una probabilidad. Con coefs nulos (o ausentes) devuelve pClose exacto.
function marketAwareProb({ pClose, features, coefs }) {
  const k = Number(pClose);
  if (!isFinite(k) || k <= 0 || k >= 1) return null;
  const c = coefs || zeroCoefs();
  const a = isFinite(Number(c.close)) ? Number(c.close) : 1;
  let z = a * logit(k);
  const b = c.feats || {};
  const x = features || {};
  let moved = a !== 1;
  for (const key of FEATURE_KEYS) {
    const w = Number(b[key]), v = Number(x[key]);
    if (!w || !isFinite(w) || !isFinite(v) || v === 0) continue;
    z += w * v; moved = true;
  }
  if (!moved) return k; // sin corrección: el cierre tal cual, sin pasar por clamp/logit (byte-idéntico)
  return sigm(z);
}

// Ventaja informativa en puntos porcentuales de NUESTRO lado: (p − k)·100. null si falta algo.
function edgePP(p, k) {
  const a = Number(p), b = Number(k);
  return (isFinite(a) && isFinite(b)) ? +((a - b) * 100).toFixed(2) : null;
}

// Lee data/combat/market-aware-priors.json. Sin archivo, o roto, devuelve coeficientes nulos: el modelo nunca
// tumba la creación de la pick. `meta` trae fecha, muestra y veredicto para /api/internal.
function loadPriors(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file || DEFAULT_PRIORS_FILE, 'utf8'));
    const z = zeroCoefs();
    const coefs = { close: isFinite(Number((raw.coefs || {}).close)) ? Number(raw.coefs.close) : 1, feats: Object.assign(z.feats, {}) };
    for (const k of FEATURE_KEYS) { const v = Number(((raw.coefs || {}).feats || {})[k]); coefs.feats[k] = isFinite(v) ? v : 0; }
    return { coefs, meta: { generado: raw.generado || null, variante: raw.variante || null, muestra: raw.muestra || null, veredicto: raw.veredicto || null, ok: true } };
  } catch (e) {
    return { coefs: zeroCoefs(), meta: { ok: false, error: e.message } };
  }
}

module.exports = { FEATURE_KEYS, DEFAULT_PRIORS_FILE, zeroCoefs, featuresFor, marketAwareProb, edgePP, loadPriors };
