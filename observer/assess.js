// observer/assess.js — CAPA DE OBSERVACIÓN (shadow): agrega señales por jugador → disponibilidad, y
// sugiere el factor de λ del equipo vía prop-engine/lineupAdjust. PURO. NADA de esto toca el modelo
// oficial: es el output que se APLICARÁ cuando se encienda la aplicación (post pago The Odds API).
//
// Agregación por jugador (ventana de recencia): la señal más SEVERA y más RECIENTE manda; BACK/CONFIRMED
// posteriores a una señal negativa la limpian. prob_miss por categoría: OUT 0.85 · SUSPENDED 0.95 ·
// DOUBT 0.45 · REST_RISK 0.25 (con decaimiento por edad de la noticia:半vida 36h).
'use strict';
const { lineupAdjustment, usualXi } = require('../prop-engine/lineupAdjust');

const PROB_MISS = { OUT: 0.85, SUSPENDED: 0.95, DOUBT: 0.45, REST_RISK: 0.25, BACK: 0, CONFIRMED: 0 };
const HALF_LIFE_H = 36;

function decay(publishedAt, nowMs) {
  const t = publishedAt ? new Date(publishedAt).getTime() : nowMs;
  const ageH = Math.max(0, (nowMs - t) / 3600e3);
  return Math.pow(0.5, ageH / HALF_LIFE_H);
}

// signals: señales del EQUIPO (observer/extract). Devuelve mapa pid → assessment.
function assessPlayers(signals, { now = Date.now() } = {}) {
  const byPid = {};
  for (const s of signals || []) {
    if (!s.pid) continue;
    (byPid[s.pid] = byPid[s.pid] || []).push(s);
  }
  const out = {};
  for (const pid in byPid) {
    const arr = byPid[pid].slice().sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
    // limpieza: si la señal MÁS RECIENTE es BACK/CONFIRMED, el jugador queda OK
    const latest = arr[0];
    if (latest.category === 'BACK' || latest.category === 'CONFIRMED') {
      out[pid] = { pid, player: latest.player, status: 'OK', prob_miss: 0, evidence: arr.slice(0, 3) };
      continue;
    }
    // peor señal negativa vigente, con decaimiento por edad
    let worst = null, worstP = 0;
    for (const s of arr) {
      const base = PROB_MISS[s.category] || 0;
      const p = base * decay(s.published_at, now);
      if (p > worstP) { worstP = p; worst = s; }
    }
    if (worst && worstP >= 0.1) {
      // CORROBORACIÓN (8-jul): un OUT/SUSPENDED con UNA sola fuente puede ser clickbait o error de lectura.
      // Solo con ≥2 fuentes independientes (mismo diagnóstico) se confirma la severidad completa; con una
      // sola, la probabilidad se capea al nivel de una DUDA hasta que otra fuente lo respalde (o la
      // alineación confirmada lo zanje). DOUBT/REST_RISK no exigen corroboración (ya son blandas).
      let corroborated = true, srcCount = 1;
      if (worst.category === 'OUT' || worst.category === 'SUSPENDED') {
        const srcs = new Set(arr.filter(s => s.category === worst.category).map(s => s.source || s.title));
        srcCount = srcs.size;
        corroborated = srcCount >= 2;
        if (!corroborated) worstP = Math.min(worstP, PROB_MISS.DOUBT * decay(worst.published_at, now));
      }
      out[pid] = { pid, player: worst.player, status: worst.category, prob_miss: +worstP.toFixed(2), corroborated, source_count: srcCount, evidence: arr.slice(0, 3) };
    } else {
      out[pid] = { pid, player: latest.player, status: 'OK', prob_miss: 0, corroborated: true, source_count: 0, evidence: arr.slice(0, 2) };
    }
  }
  return out;
}

// Sugerencia de factor λ del equipo: por cada jugador del once habitual con señal, factor individual si
// falta (lineupAdjustment sin él) ponderado por prob_miss. Factor esperado = Π (1 − p·(1 − f_i)).
// fitres = prop-engine/players.fitPlayers(dataset). Devuelve { factor, detail:[...] } — SOLO SUGERENCIA.
function suggestTeamFactor(fitres, teamCode, assessments) {
  const xi = usualXi(fitres, teamCode);
  const xiPids = new Set(xi.map(p => p.pid));
  let factor = 1;
  const detail = [];
  for (const pid in assessments || {}) {
    const a = assessments[pid];
    if (!a.prob_miss || !xiPids.has(pid)) continue;
    const without = xi.filter(p => p.pid !== pid).map(p => ({ pid: p.pid }));
    const pos = (fitres.players[pid] && fitres.players[pid].pos) || 'M';
    const fi = lineupAdjustment(fitres, teamCode, without.concat([{ pos }])).factor;
    factor *= (1 - a.prob_miss * (1 - fi));
    detail.push({ pid, player: a.player, status: a.status, prob_miss: a.prob_miss, factor_if_out: +fi.toFixed(3) });
  }
  detail.sort((x, y) => (x.factor_if_out - y.factor_if_out));
  return { factor: +factor.toFixed(3), detail };
}

module.exports = { assessPlayers, suggestTeamFactor, PROB_MISS, HALF_LIFE_H };
