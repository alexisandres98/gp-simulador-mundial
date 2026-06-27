// calibration/replay.js — Fase M.3/M.7/G.6. Replay POINT-IN-TIME (sin leakage) de la fase de grupos.
// Reconstruye los Elos pre-partido replayando los resultados en orden cronológico desde la base pre-torneo
// (TEAMS[].elo, snapshot 8-jun-2026): para cada partido la predicción usa SOLO Elos de partidos anteriores; el
// resultado real se usa únicamente para PUNTUAR (no como feature). Devuelve registros V1 (1X2) + Goal Engine.
// PURO (sin DB). No toca el modelo: usa engine.matchProbs/lambdas/effElo/eloUpdate y goal-engine/distribution.
'use strict';
const { TEAMS, GROUP_FIXTURES } = require('../data/tournament');
const { matchProbs, lambdas, effElo, eloUpdate } = require('../engine');
const goalEngine = require('../goal-engine/distribution');

const teamById = Object.fromEntries(TEAMS.map(t => [t.id, t]));
function baseElos() { const e = {}; for (const t of TEAMS) e[t.id] = t.elo; return e; }

// results: mapa { fixtureId: { hg, ag, status } }. Solo se replayan los 'final'. Orden cronológico estricto.
function pointInTimeReplay({ results }) {
  const elos = baseElos();
  const fixtures = GROUP_FIXTURES
    .filter(f => results[f.id] && results[f.id].status === 'final' && typeof results[f.id].hg === 'number')
    .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
  const records = [];
  for (const f of fixtures) {
    const r = results[f.id], hg = r.hg, ag = r.ag;
    const homeHost = !!teamById[f.home] && teamById[f.home].host, awayHost = !!teamById[f.away] && teamById[f.away].host;
    if (elos[f.home] == null || elos[f.away] == null) continue;
    const eh = effElo(elos, f.home), ea = effElo(elos, f.away);   // Elo efectivo PRE-partido
    const probs = matchProbs(eh, ea);                              // V1 1X2 (calibrado actual)
    const [lh, la] = lambdas(eh, ea);
    const goal = goalEngine.goalModelOutput(lh, la);
    const outcome = hg > ag ? 'home' : hg === ag ? 'draw' : 'away';
    records.push({
      id: f.id, date: f.datetime, home: f.home, away: f.away,
      pre_elo_home: elos[f.home], pre_elo_away: elos[f.away], eff_home: eh, eff_away: ea, elo_diff: eh - ea,
      probs, raw_1x2: goal.one_x2_raw, lambdas: { home: lh, away: la }, goal,
      hg, ag, total: hg + ag, outcome,
    });
    const [nh, na] = eloUpdate(elos[f.home], elos[f.away], hg, ag, homeHost, awayHost); // update DESPUÉS (point-in-time)
    elos[f.home] = nh; elos[f.away] = na;
  }
  return records;
}

module.exports = { pointInTimeReplay, baseElos };
