// scripts/player-props-project.js — Proyecciones de PROPS DE JUGADOR para partidos próximos.
// Top anotadores probables + líneas de remates, con las tasas del Mundial (data/player-props-history.json)
// y la λ de goles del equipo según el modelo GP.
// Uso: node scripts/player-props-project.js '[{"team":"FRA","lambda":2.05},{"team":"MAR","lambda":0.65}]'
// Sin args: QF definidos al momento de escribirlo (FRA-MAR y NOR-ENG con λ del modelo).
'use strict';
const { fitPlayers, projectTeam } = require('../prop-engine/players');
const hist = require('../data/player-props-history.json');

const DEFAULT = [
  { team: 'FRA', lambda: 2.05 }, { team: 'MAR', lambda: 0.65 },
  { team: 'NOR', lambda: 1.02 }, { team: 'ENG', lambda: 1.71 },
];
const teams = process.argv[2] ? JSON.parse(process.argv[2]) : DEFAULT;

const F = fitPlayers(hist.matches);
const pct = x => (100 * x).toFixed(1) + '%';
console.log(`dataset: ${hist.matches.length} partidos · ${Object.keys(F.players).length} jugadores\n`);
for (const tm of teams) {
  const rows = projectTeam(F, tm.team, { teamLambda: tm.lambda, top: 6 });
  console.log(`── ${tm.team} (λ GP ${tm.lambda}) ──`);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(24)} ${String(r.pos).padEnd(2)} gol ${pct(r.anytime_goal).padStart(6)} · remates μ ${r.shots_match.toFixed(1)} (O1.5 ${pct(r.shots_over_1_5)}) · al arco O0.5 ${pct(r.sot_over_0_5)}${r.reliable ? '' : ' · [muestra corta]'}`);
  }
  console.log();
}
