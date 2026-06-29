// context-engine/collectorFactors.js — Grupo 2 (jun-29). Convierte las OBSERVACIONES del collector
// (clima Open-Meteo en weather_snapshots + claims de noticias en context_claims) en FACTORES que
// AJUSTAN la probabilidad GP de un evento y se MUESTRAN en el cockpit (/x).
//
// Hasta ahora `evaluateUpcomingContext` solo usaba buildH2HDeep (factores deportivos: forma/plantilla/
// lesiones/descanso/táctico). El clima y las noticias se escribían por separado y NO se fusionaban.
// Este módulo es PURO (sin I/O, testeable) y trabaja en ESPACIO DE PROBABILIDAD sobre el vector final
// de buildH2HDeep: cada factor aporta un pequeño delta (en puntos de probabilidad) que se aplica y
// renormaliza. El efecto NETO queda en el snapshot (context_adjustments) y cada factor se persiste como
// observación con su evidencia (Dato/Inferencia) derivada del ORIGEN real.
//
// Filosofía anti-leakage / honestidad:
//  • El clima es un PRONÓSTICO → evidence = INFERENCE (azul). Empuja hacia el empate (menos goles,
//    comprime al favorito) — efecto chico y simétrico-ish, nunca decide un partido por sí solo.
//  • Una noticia CONFIRMADA (FACT, p.ej. PLAYER_CONFIRMED_OUT) → evidence = FACT (verde): es un dato.
//  • RUMOR / review_required → impacto 0 (no entra). La fuente NUNCA define el impacto: lo define la
//    policy de magnitudes de acá abajo (versionada).
'use strict';

const POLICY = 'collector-factor-policy-1';

// --- Magnitudes (en puntos de probabilidad, fracción 0..1). Conservadoras y versionadas. ---
// Clima adverso: cada factor mueve ~este monto del favorito hacia el empate. Tope total de clima.
const WEATHER_PP = { EXTREME_HEAT: 0.012, HIGH_HUMIDITY: 0.010, HEAVY_RAIN: 0.015, STRONG_WIND: 0.012 };
const WEATHER_CAP = 0.030; // máx. 3 pp por clima en total
// Noticias por clase de claim: pp que pierde (o gana) el equipo sujeto. FACT pesa más que INFERENCE.
const NEWS_PP = {
  PLAYER_CONFIRMED_OUT:        { pp: 0.030, dir: 'negative', display: 'AVAILABILITY' },
  PLAYER_SUSPENDED:            { pp: 0.028, dir: 'negative', display: 'AVAILABILITY' },
  STARTING_GOALKEEPER_CONFIRMED: { pp: 0.010, dir: 'positive', display: 'GOALKEEPER' },
  PLAYER_DOUBTFUL:             { pp: 0.012, dir: 'negative', display: 'AVAILABILITY' },
  PLAYER_RETURNED_TO_TRAINING: { pp: 0.012, dir: 'positive', display: 'AVAILABILITY' },
  PLAYER_CONFIRMED_STARTER:    { pp: 0.008, dir: 'positive', display: 'LINEUP' },
  FORMATION_CHANGE_EXPECTED:   { pp: 0.004, dir: 'neutral',  display: 'TACTICS' },
  COACH_ROTATION_CONFIRMED:    { pp: 0.010, dir: 'negative', display: 'AVAILABILITY' },
};
const NEWS_CAP_PER_TEAM = 0.045; // tope por equipo de ajustes de noticias

// Open-Meteo emite EXTREME_HEAT/HIGH_HUMIDITY/HEAVY_RAIN/STRONG_WIND; el cockpit conoce
// HIGH_HEAT/HIGH_HUMIDITY/RAIN/WIND. Normalizamos para el display sin perder el código crudo.
const WEATHER_DISPLAY = { EXTREME_HEAT: 'HIGH_HEAT', HIGH_HUMIDITY: 'HIGH_HUMIDITY', HEAVY_RAIN: 'RAIN', STRONG_WIND: 'WIND' };

const clamp01 = (x) => Math.max(0.001, Math.min(0.998, x));
function normVec(v) {
  const s = v.home + v.draw + v.away;
  if (!(s > 0)) return { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  return { home: v.home / s, draw: v.draw / s, away: v.away / s };
}

// Clima → factores. El clima adverso reduce la varianza de goles → sube el empate y comprime al favorito.
function weatherFactors(weatherRow) {
  if (!weatherRow) return [];
  let codes = weatherRow.weather_factors;
  if (typeof codes === 'string') { try { codes = JSON.parse(codes); } catch { codes = []; } }
  if (!Array.isArray(codes)) codes = [];
  const out = [];
  let total = 0;
  for (const code of codes) {
    const pp = WEATHER_PP[code];
    if (!pp || total >= WEATHER_CAP) continue;
    const eff = Math.min(pp, WEATHER_CAP - total);
    total += eff;
    out.push({
      factorCode: WEATHER_DISPLAY[code] || code, rawCode: code, category: 'conditions',
      side: 'match', evidence: 'inference', confidence: 0.6, dir: 'draw',
      drawPp: eff, // sube empate en `eff`, se descuenta del favorito al aplicar
      detail: code, source: 'open-meteo',
    });
  }
  return out;
}

// Claims de noticias (event-linked, no rumor, review auto) → factores por equipo.
// claim: { factor_code, fact_or_inference (FACT/INFERENCE/RUMOR), confidence, team_id, review_status, applied }
function newsFactors(claims, homeId, awayId) {
  if (!Array.isArray(claims)) return [];
  const out = [];
  const perTeam = { [homeId]: 0, [awayId]: 0 };
  for (const c of claims) {
    const klass = String(c.fact_or_inference || '').toUpperCase();
    if (klass === 'RUMOR' || klass === 'UNKNOWN') continue;     // rumor → impacto 0
    if (c.review_status && c.review_status === 'review_required') continue;
    const spec = NEWS_PP[c.factor_code];
    if (!spec) continue;
    // resolver el equipo sujeto: team_id explícito, si no se omite (no adivinar)
    const teamId = c.team_id || c.subject_id || null;
    const side = teamId === homeId ? 'a' : teamId === awayId ? 'b' : null;
    if (!side) continue;
    const cap = NEWS_CAP_PER_TEAM - (perTeam[teamId] || 0);
    if (cap <= 0) continue;
    // FACT pesa al 100%, INFERENCE al 55%.
    const w = klass === 'FACT' ? 1 : 0.55;
    const mag = Math.min(spec.pp * w, cap);
    if (mag <= 0) continue;
    perTeam[teamId] = (perTeam[teamId] || 0) + mag;
    out.push({
      factorCode: spec.display, rawCode: c.factor_code, category: 'squad',
      side, teamId, evidence: klass === 'FACT' ? 'fact' : 'inference',
      confidence: c.confidence != null ? Number(c.confidence) : (klass === 'FACT' ? 0.85 : 0.5),
      dir: spec.dir, teamPp: spec.dir === 'positive' ? mag : -mag, // signo sobre la prob del equipo
      detail: c.factor_code, source: 'news',
    });
  }
  return out;
}

// Aplica los deltas de los factores sobre el vector final (prob) y renormaliza.
// factors: salida de weatherFactors()+newsFactors(). Devuelve vector ajustado.
function applyToVector(finalVec, factors, homeId, awayId) {
  let v = { home: finalVec.home, draw: finalVec.draw, away: finalVec.away };
  for (const f of factors) {
    if (f.side === 'match' && f.drawPp) {
      // sube empate, descuenta del favorito proporcional a su tamaño
      const w = f.drawPp;
      const denom = v.home + v.away || 1;
      v = { home: v.home - w * (v.home / denom), draw: v.draw + w, away: v.away - w * (v.away / denom) };
    } else if (f.teamPp != null && f.teamId) {
      const delta = f.teamPp; // signo ya incorporado
      if (f.side === 'a') {
        const rest = v.draw + v.away || 1;
        v = { home: v.home + delta, draw: v.draw - delta * (v.draw / rest), away: v.away - delta * (v.away / rest) };
      } else {
        const rest = v.draw + v.home || 1;
        v = { away: v.away + delta, draw: v.draw - delta * (v.draw / rest), home: v.home - delta * (v.home / rest) };
      }
    }
    v = { home: clamp01(v.home), draw: clamp01(v.draw), away: clamp01(v.away) };
  }
  return normVec(v);
}

// API principal: dado el vector final de buildH2HDeep + observaciones del collector, devuelve el vector
// ajustado, la lista de factores (para persistir como observaciones) y el set de equipos cuya
// disponibilidad quedó CONFIRMADA por una fuente (para promover el factor deportivo de Inferencia→Dato).
function fuse(finalVec, { weatherRow = null, claims = [], homeId, awayId } = {}) {
  const wf = weatherFactors(weatherRow);
  const nf = newsFactors(claims, homeId, awayId);
  const factors = wf.concat(nf);
  const adjusted = factors.length ? applyToVector(finalVec, factors, homeId, awayId) : { ...finalVec };
  // equipos con disponibilidad confirmada por noticia FACT (lesión/suspensión confirmada)
  const confirmedAvailability = new Set();
  for (const f of nf) {
    if (f.evidence === 'fact' && (f.rawCode === 'PLAYER_CONFIRMED_OUT' || f.rawCode === 'PLAYER_SUSPENDED')) confirmedAvailability.add(f.teamId);
  }
  return { factors, adjusted, confirmedAvailability, policy: POLICY };
}

module.exports = { POLICY, WEATHER_PP, NEWS_PP, weatherFactors, newsFactors, applyToVector, fuse, normVec };
