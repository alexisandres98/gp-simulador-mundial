// tests/props-phase.test.js — multiplicadores de FASE aprendidos del dataset (grupos vs eliminatoria).
// El modelo NO usa una media estática: aprende de los datos que la fase cambia el nivel de córners/tarjetas
// y lo aplica con shrinkage. Diseño multi-competición: fases etiquetadas libres por dataset.
'use strict';
const model = require('../prop-engine/model');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

// dataset sintético: 30 partidos de grupos tranquilos + 20 de playoff bravos
const mk = (phase, corners, cards, i) => ({
  round: phase === 'group' ? 'Group Stage - 1' : 'Quarter-final', et: false, referee: 'Ref ' + (i % 5),
  home: { code: 'A' + (i % 8), corners: Math.round(corners / 2), yellows: Math.round(cards / 2), reds: 0 },
  away: { code: 'B' + (i % 8), corners: corners - Math.round(corners / 2), yellows: cards - Math.round(cards / 2), reds: 0 },
});
const matches = [];
for (let i = 0; i < 30; i++) matches.push(mk('group', 8, 2, i));
for (let i = 0; i < 20; i++) matches.push(mk('ko', 12, 5, i));

const F = model.fit(matches);
t('aprende multiplicador de grupos < 1', F.league.phaseMult.group && F.league.phaseMult.group.corners < 1);
t('aprende multiplicador de knockout > 1 (córners y tarjetas)',
  F.league.phaseMult.knockout && F.league.phaseMult.knockout.corners > 1.1 && F.league.phaseMult.knockout.cards > 1.2);
t('shrinkage: multiplicador crudo (12/9.6=1.25) queda amortiguado', F.league.phaseMult.knockout.corners < 1.25);

const pG = model.project(F, { home: 'A1', away: 'B1', phase: 'group' });
const pK = model.project(F, { home: 'A1', away: 'B1', phase: 'knockout' });
const p0 = model.project(F, { home: 'A1', away: 'B1' });
t('project aplica el multiplicador (KO > sin fase > grupos)', pK.corners.total > p0.corners.total && p0.corners.total > pG.corners.total);
t('tarjetas también escalan por fase', pK.cards.total > pG.cards.total);
t('sin fase → sin cambio (compat con calibraciones previas)', Math.abs(p0.corners.total - F.league.totalCornersMean) < 1e-9);
t('fase desconocida → multiplicador 1', model.project(F, { home: 'A1', away: 'B1', phase: 'nope' }).corners.total === p0.corners.total);
t('per-team también escala', pK.corners.home > pG.corners.home);
t('phaseOf deriva de round', model.phaseOf({ round: 'Group Stage - 3' }) === 'group' && model.phaseOf({ round: 'Round of 16' }) === 'knockout');
t('phase explícito gana', model.phaseOf({ phase: 'playoff', round: 'Group Stage' }) === 'playoff');

console.log(`\n[props-phase] ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
