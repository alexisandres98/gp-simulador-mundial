// prop-engine/players.js — PROPS DE JUGADOR (fase 2, TheStatsAPI). PURO: sin DB, sin red.
// Modelo (research 4-jul): tasas por 90' del jugador (xG/remates/al arco) con shrinkage por minutos jugados +
// proyección de minutos (titular/suplente según historial) + acople al partido vía la λ de goles del equipo
// del modelo GP (el reparto del ataque del equipo entre sus jugadores se conserva; el volumen lo fija la λ).
// Mercados MVP: ANYTIME SCORER (Poisson: P = 1 − exp(−xG_match)), REMATES O/U (NB), AL ARCO O/U (NB).
// Nota: usamos xG TOTAL (incluye penales) para el goleador — el pateador designado ES más probable anotador;
// npxg queda en la fila para afinar después. AET/PEN: tasas por 90' usan minutos reales (incluyen prórroga).
'use strict';
const { nbPmf } = require('../goal-engine/negativeBinomial');

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Priors por posición (por 90'): con pocos minutos el jugador cae a la tasa típica de su posición.
// Valores del research/fútbol de selecciones; el shrinkage los mezcla con lo observado (K_MIN minutos prior).
const POS_PRIOR = {
  F: { xg90: 0.38, shots90: 2.4, sot90: 0.9 },
  M: { xg90: 0.12, shots90: 1.3, sot90: 0.45 },
  D: { xg90: 0.05, shots90: 0.6, sot90: 0.2 },
  G: { xg90: 0.0, shots90: 0.02, sot90: 0.01 },
};
const DEFAULTS = {
  K_MIN: 180,            // minutos de prior en el shrinkage (2 partidos completos)
  TEAM_LAMBDA_LEAGUE: 1.4, // λ media de liga (goles esperados por equipo)
  MATCH_ADJ_CLAMP: 0.5,  // el acople al partido mueve las tasas hasta ±50% (λ 2.8 vs 1.4 → ×1.41 con exp 0.5... clamp)
  MATCH_ADJ_EXP: 0.75,   // exponente del acople (xG del jugador escala casi lineal con la λ del equipo)
  R_SHOTS: 6,            // dispersión NB de remates por jugador-partido (colas pesadas)
  MIN_MINUTES_SAMPLE: 45 // menos de esto en total → jugador sin proyección propia (prior puro)
};

// ── Ajuste: tasas por 90' por jugador desde el dataset (data/player-props-history.json → matches) ───────────
function fitPlayers(matches, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const acc = {}; // pid → agregados
  for (const m of matches) {
    for (const p of m.players) {
      const a = acc[p.pid] || (acc[p.pid] = {
        pid: p.pid, name: p.name, team: p.team, pos: p.pos || 'M',
        min: 0, xg: 0, npxg: 0, shots: 0, sot: 0, goals: 0, starts: 0, apps: 0, minAsStarter: 0, starterApps: 0,
        xa: 0, assists: 0, fouls: 0, yc: 0, rc: 0,
      });
      a.min += p.min; a.apps++;
      if (p.started) { a.starts++; a.starterApps++; a.minAsStarter += p.min; }
      a.xg += p.xg || 0; a.npxg += p.npxg || 0; a.shots += p.shots || 0; a.sot += p.sot || 0; a.goals += p.goals || 0;
      a.xa += p.xa || 0; a.assists += p.assists || 0; a.fouls += p.fouls || 0; a.yc += p.yc || 0; a.rc += p.rc || 0;
      a.pos = p.pos || a.pos; a.team = p.team;
    }
  }
  const players = {};
  for (const pid in acc) {
    const a = acc[pid];
    const prior = POS_PRIOR[a.pos] || POS_PRIOR.M;
    const K = cfg.K_MIN;
    // shrinkage por minutos: tasa = (K·prior + 90·conteo) / (K + minutos)
    const rate = (count, pr90) => ((K * pr90) / 90 + count) / ((K + a.min) / 90);
    players[pid] = {
      pid, name: a.name, team: a.team, pos: a.pos,
      minutes: a.min, apps: a.apps, starts: a.starts, goals: a.goals,
      assists: a.assists, fouls: a.fouls, yc: a.yc, rc: a.rc,
      xg90: rate(a.xg, prior.xg90),
      shots90: rate(a.shots, prior.shots90),
      sot90: rate(a.sot, prior.sot90),
      xa90: a.min > 0 ? (a.xa / a.min) * 90 : 0, // creación: sin prior de posición (informativo, no mercado)
      exp_minutes_start: a.starterApps ? clamp(a.minAsStarter / a.starterApps, 45, 90) : 78,
      reliable: a.min >= cfg.MIN_MINUTES_SAMPLE,
    };
  }
  return { players, cfg };
}

// ── Proyección de un jugador en un partido ──────────────────────────────────────────────────────────────────
// fitres = fitPlayers(...). opciones: teamLambda (λ GP del equipo en ESTE partido), willStart (true/false/null),
// minutesOverride. Devuelve xG del partido + P(gol) + distribución de remates.
function projectPlayer(fitres, pid, { teamLambda = null, willStart = true, minutesOverride = null } = {}) {
  const cfg = fitres.cfg;
  const pl = fitres.players[pid];
  if (!pl) return null;
  const minutes = minutesOverride != null ? minutesOverride : (willStart ? pl.exp_minutes_start : 30);
  // acople al partido: la λ del equipo escala el volumen de ataque que le toca al jugador.
  let adj = 1;
  if (teamLambda && teamLambda > 0) {
    adj = clamp(Math.pow(teamLambda / cfg.TEAM_LAMBDA_LEAGUE, cfg.MATCH_ADJ_EXP), 1 - cfg.MATCH_ADJ_CLAMP, 1 + cfg.MATCH_ADJ_CLAMP);
  }
  const frac = minutes / 90;
  const xgMatch = pl.xg90 * frac * adj;
  const shotsMatch = pl.shots90 * frac * adj;
  const sotMatch = pl.sot90 * frac * adj;
  const overShots = line => { let under = 0; for (let k = 0; k <= Math.floor(line); k++) under += nbPmf(shotsMatch, cfg.R_SHOTS, k); return clamp(1 - under, 0, 1); };
  const overSot = line => { let under = 0; for (let k = 0; k <= Math.floor(line); k++) under += nbPmf(sotMatch, cfg.R_SHOTS, k); return clamp(1 - under, 0, 1); };
  return {
    pid, name: pl.name, team: pl.team, pos: pl.pos, minutes, reliable: pl.reliable,
    xg_match: xgMatch, shots_match: shotsMatch, sot_match: sotMatch, match_adj: adj,
    anytime_goal: 1 - Math.exp(-xgMatch),                    // Poisson sobre el xG del jugador
    shots_over_0_5: overShots(0.5), shots_over_1_5: overShots(1.5), shots_over_2_5: overShots(2.5),
    sot_over_0_5: overSot(0.5), sot_over_1_5: overSot(1.5),
  };
}

// Proyección de un EQUIPO: los N jugadores con mayor P(gol) dado el once probable.
// starters: array de pids (once confirmado/probable) o null → usa los que más arrancan.
function projectTeam(fitres, teamCode, { teamLambda = null, starters = null, top = 8 } = {}) {
  const pool = Object.values(fitres.players).filter(p => p.team === teamCode);
  let chosen;
  if (starters && starters.length) chosen = pool.filter(p => starters.includes(p.pid));
  else chosen = pool.sort((a, b) => (b.starts - a.starts) || (b.minutes - a.minutes)).slice(0, 11);
  const rows = chosen
    .map(p => projectPlayer(fitres, p.pid, { teamLambda, willStart: true }))
    .filter(Boolean)
    .sort((a, b) => b.anytime_goal - a.anytime_goal);
  return rows.slice(0, top);
}

module.exports = { fitPlayers, projectPlayer, projectTeam, POS_PRIOR, DEFAULTS };
