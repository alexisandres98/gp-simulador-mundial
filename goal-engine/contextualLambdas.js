// goal-engine/contextualLambdas.js — Anexo M-G (G.3). Ajuste CONTEXTUAL de las tasas de gol (lambdas) en
// LOG-SPACE. El contexto (portero, delanteros, ritmo, táctica, clima) actúa sobre ataque/defensa, no como frase.
// PURO. Caps por factor/total + confidence + regresión a la media (muestra pequeña → impacto pequeño). El caso
// Cabo Verde se resuelve como CAPACIDAD GENERAL: si los datos del portero lo justifican, baja la lambda rival;
// si no hay datos suficientes, el impacto es 0 (regresión). No hardcodea ningún equipo.
'use strict';
const num = (v, d) => (v == null || isNaN(Number(v))) ? d : Number(v);
const clampAbs = (v, cap) => Math.abs(v) > cap ? Math.sign(v) * cap : v;

const DEFAULTS = { maxPerFactor: 0.25, maxTotal: 0.45 }; // en log-space sobre cada lambda

// factor: { affects: 'home_attack'|'home_defense'|'away_attack'|'away_defense'|'tempo', log_delta, confidence }
// CONVENCIÓN de signo: cada log_delta es el efecto DIRECTO (aditivo en log-space) sobre la lambda afectada.
//   - *_attack: efecto sobre la lambda del PROPIO equipo (positivo = marca más).
//   - *_defense: efecto sobre la lambda del RIVAL (negativo = defensa fuerte → reduce la lambda rival).
// home_lambda += home_attack + away_defense + tempo ; away_lambda += away_attack + home_defense + tempo.
function adjustLambdas({ baseLambdaHome, baseLambdaAway, factors = [], caps = {} } = {}) {
  const c = { ...DEFAULTS, ...caps };
  const acc = { home_attack: 0, home_defense: 0, away_attack: 0, away_defense: 0, tempo: 0 };
  let applied = 0;
  for (const f of factors) {
    if (!(f.affects in acc)) continue;
    const conf = Math.max(0, Math.min(1, num(f.confidence, 0)));
    const d = clampAbs(num(f.log_delta, 0) * conf, c.maxPerFactor);
    if (Math.abs(d) > 1e-9) { acc[f.affects] += d; applied++; }
  }
  let homeAdj = clampAbs(acc.home_attack + acc.away_defense + acc.tempo, c.maxTotal);
  let awayAdj = clampAbs(acc.away_attack + acc.home_defense + acc.tempo, c.maxTotal);
  const lh = Math.max(0.05, baseLambdaHome * Math.exp(homeAdj));
  const la = Math.max(0.05, baseLambdaAway * Math.exp(awayAdj));
  return {
    lambda_home: +lh.toFixed(6), lambda_away: +la.toFixed(6),
    base_lambda_home: +baseLambdaHome.toFixed(6), base_lambda_away: +baseLambdaAway.toFixed(6),
    adjustments: { home_log: +homeAdj.toFixed(6), away_log: +awayAdj.toFixed(6), components: acc }, applied_factor_count: applied,
  };
}

// Ajuste del portero (capacidad general; caso Cabo Verde). Devuelve un factor de DEFENSA del equipo del portero
// (reduce la lambda del rival) con regresión por tamaño de muestra. NO inventa: sin datos → log_delta 0.
//  input: { savesAboveExpected (goles evitados aprox, +bueno), shotsFaced (muestra), priorLogDelta? }
function goalkeeperFactor({ teamSide /* 'home'|'away' */, savesAboveExpected, shotsFaced, maxLogDelta = 0.18 } = {}) {
  const sae = num(savesAboveExpected, null), n = num(shotsFaced, 0);
  // sin datos o muestra nula → impacto 0
  if (sae == null || n <= 0) return { affects: teamSide === 'home' ? 'home_defense' : 'away_defense', log_delta: 0, confidence: 0, reason: 'insufficient_data' };
  // regresión: confianza crece con la muestra (shrinkage tipo n/(n+k)); k=20 tiros como medio-punto.
  const k = 20; const shrink = n / (n + k);
  // goles evitados por tiro → efecto defensivo (negativo en la lambda rival): cap y escala conservadora.
  const perShot = sae / Math.max(1, n);
  let logDelta = clampAbs(-perShot * 1.0, maxLogDelta) * shrink;   // negativo = baja lambda rival
  return { affects: teamSide === 'home' ? 'home_defense' : 'away_defense', log_delta: +logDelta.toFixed(6), confidence: +shrink.toFixed(4), reason: 'goalkeeper_form', sample: n };
}

module.exports = { DEFAULTS, adjustLambdas, goalkeeperFactor };
