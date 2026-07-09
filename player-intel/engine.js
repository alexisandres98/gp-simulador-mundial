// player-intel/engine.js — CAPA DE INTELIGENCIA POR JUGADOR (8-jul). PURO: sin DB, sin red.
// Fusiona TODAS las capas que antes trabajaban por separado en una lectura única y EXPLICABLE por jugador:
//   · historial de producción (prop-engine/players: tasas por 90' con shrinkage por posición)
//   · rol proyectado (once histórico) y rol CONFIRMADO (alineación oficial cuando sale)
//   · disponibilidad del observer (con corroboración multi-fuente)
//   · contexto del partido (λ de goles del modelo GP → volumen de ataque esperado)
// Devuelve proyección + confianza + CÓDIGOS DE RAZÓN (el cliente los localiza ES/EN; nunca se exponen
// fuentes ni métodos — caja negra). Es el sustrato del producto "por qué el sistema concluye X sobre Y".
// Nota de diseño (honesta): a esta escala de datos (un torneo) el "ML" correcto es fusión calibrada +
// shrinkage jerárquico, no una red neuronal que memorice 92 partidos. Post-Mundial, con 80+ ligas de
// historial, esta misma interfaz se re-implementa con modelos entrenados (gradient boosting) sin tocar
// a los consumidores.
'use strict';
const { projectPlayer, POS_PRIOR } = require('../prop-engine/players');

// availability: { status, prob_miss, corroborated } | null (observer). projectedStarter/confirmedStarter:
// true/false/null. teamLambda: λ GP del equipo en este partido (null = liga).
// setPieceReasons: códigos SET_PIECE_* precomputados por el caller (player-intel/setPieces, tabla curada).
function playerIntel(fitres, pid, { teamLambda = null, projectedStarter = null, confirmedStarter = null, availability = null, setPieceReasons = [] } = {}) {
  const pl = fitres.players[pid];
  if (!pl) return null;
  const reasons = [];
  const role = confirmedStarter === true ? 'STARTER_CONFIRMED'
    : confirmedStarter === false ? 'BENCH_CONFIRMED'
      : projectedStarter === true ? 'STARTER_PROJECTED'
        : projectedStarter === false ? 'BENCH_PROJECTED' : 'ROLE_UNKNOWN';
  const willStart = role === 'STARTER_CONFIRMED' || role === 'STARTER_PROJECTED' || role === 'ROLE_UNKNOWN';
  const proj = projectPlayer(fitres, pid, { teamLambda, willStart });
  if (!proj) return null;

  // Rol
  if (role === 'STARTER_CONFIRMED') reasons.push('ROLE_STARTER_CONFIRMED');
  else if (role === 'STARTER_PROJECTED') reasons.push('ROLE_STARTER_PROJECTED');
  else if (role === 'BENCH_CONFIRMED' || role === 'BENCH_PROJECTED') reasons.push('ROLE_BENCH');
  // Muestra
  const sampleStrong = pl.minutes >= 270 && pl.starts >= 3;
  reasons.push(sampleStrong ? 'SAMPLE_STRONG' : 'SAMPLE_THIN');
  // Producción vs. lo típico de su posición
  const prior = POS_PRIOR[pl.pos] || POS_PRIOR.M;
  if (pl.xg90 >= Math.max(0.45, prior.xg90 * 1.6)) reasons.push('RATES_ELITE');
  else if (pl.xg90 >= prior.xg90 * 1.25) reasons.push('RATES_ABOVE_POS');
  // Definición caliente/fría (goles reales vs. esperados por su generación)
  const expGoals = pl.xg90 * pl.minutes / 90;
  if (pl.goals >= 2 && pl.goals >= expGoals * 1.5) reasons.push('FINISHING_HOT');
  else if (expGoals >= 1.5 && pl.goals <= expGoals * 0.4) reasons.push('FINISHING_COLD');
  // Contexto del partido (volumen de ataque del equipo según el modelo)
  if (proj.match_adj >= 1.15) reasons.push('TEAM_ATTACK_UP');
  else if (proj.match_adj <= 0.87) reasons.push('TEAM_ATTACK_DOWN');
  // Disponibilidad (observer, con corroboración)
  if (availability && Number(availability.prob_miss) > 0) {
    const st = availability.status, cor = availability.corroborated !== false;
    if (st === 'OUT') reasons.push(cor ? 'AVAIL_OUT' : 'AVAIL_UNVERIFIED');
    else if (st === 'SUSPENDED') reasons.push(cor ? 'AVAIL_SUSP' : 'AVAIL_UNVERIFIED');
    else if (st === 'DOUBT') reasons.push('AVAIL_DOUBT');
    else if (st === 'REST_RISK') reasons.push('AVAIL_REST');
  }

  // Balón parado (tabla curada del torneo, vía caller): penal/tiro libre/córners suman a la lectura
  // de gol y remates del jugador — un penalero convierte más "anytime" del que sugieren sus tasas de jugada.
  for (const sp of (setPieceReasons || [])) if (['SET_PIECE_PEN', 'SET_PIECE_FK', 'SET_PIECE_CORNERS'].includes(sp)) reasons.push(sp);

  // Confianza agregada: rol conocido + muestra + sin nubarrones = alta.
  let score = 0;
  score += role === 'STARTER_CONFIRMED' ? 2 : role === 'STARTER_PROJECTED' ? 1 : 0;
  score += sampleStrong ? 1 : 0;
  score -= (availability && Number(availability.prob_miss) >= 0.3) ? 2 : 0;
  const confidence = score >= 3 ? 'HIGH' : score >= 1 ? 'MEDIUM' : 'LOW';

  return {
    pid, name: pl.name, team: pl.team, pos: pl.pos, role, confidence, reasons,
    projection: {
      minutes: proj.minutes, xg_match: proj.xg_match, anytime_goal: proj.anytime_goal,
      shots_match: proj.shots_match, sot_match: proj.sot_match, match_adj: proj.match_adj,
      sot_over_0_5: proj.sot_over_0_5, shots_over_1_5: proj.shots_over_1_5,
    },
    availability: availability ? { status: availability.status, prob_miss: availability.prob_miss, corroborated: availability.corroborated !== false } : null,
    sample: { minutes: pl.minutes, apps: pl.apps, starts: pl.starts, goals: pl.goals },
  };
}

module.exports = { playerIntel };
