// tests/context-engine.test.js — Fase M.4. Núcleo del Context Engine (PURO). Matemática logit→softmax,
// caps, dedup, uncertainty, fallback, determinismo. No toca pipeline.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const ce = require(R + '/context-engine/contextEngine');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const sum = v => v.home + v.draw + v.away;
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
const BASE = { home: 0.50, draw: 0.27, away: 0.23 };

(async () => {
  console.log('\n§M.4 INVARIANTES');
  const r1 = ce.applyContext({ base: BASE, factors: [{ factor_code: 'GK', category: 'player', home_logit_delta: -0.2, away_logit_delta: 0.15, confidence: 0.8 }], contextUncertainty: 0.2 });
  ok('final suma 1', close(sum(r1.final_vector), 1));
  ok('pre-uncertainty suma 1', close(sum(r1.pre_uncertainty_vector), 1));
  ok('sin negativos', r1.final_vector.home >= 0 && r1.final_vector.draw >= 0 && r1.final_vector.away >= 0);

  console.log('\n§M.4 DIRECCIÓN');
  const up = ce.applyContext({ base: BASE, factors: [{ factor_code: 'F', category: 'team', home_logit_delta: 0.3, confidence: 1 }], contextUncertainty: 0 });
  ok('un factor que sube home → sube P(home)', up.final_vector.home > BASE.home);
  const down = ce.applyContext({ base: BASE, factors: [{ factor_code: 'F', category: 'team', home_logit_delta: -0.3, confidence: 1 }], contextUncertainty: 0 });
  ok('un factor que baja home → baja P(home)', down.final_vector.home < BASE.home);

  console.log('\n§M.4 CAPS');
  const huge = ce.applyContext({ base: BASE, factors: [{ factor_code: 'X', category: 'team', home_logit_delta: 9.0, confidence: 1 }], contextUncertainty: 0, caps: { maxPerFactor: 0.4, maxPerCategory: 0.6, maxTotal: 0.9, maxUncertaintyShrink: 0.5 } });
  ok('cap por factor limita el ajuste (|adj.home| ≤ 0.4)', Math.abs(huge.context_adjustments.home) <= 0.4 + 1e-9);
  const many = ce.applyContext({ base: BASE, factors: [
    { factor_code: 'A', category: 'team', home_logit_delta: 0.4, confidence: 1 },
    { factor_code: 'B', category: 'team', home_logit_delta: 0.4, confidence: 1 },
    { factor_code: 'C', category: 'team', home_logit_delta: 0.4, confidence: 1 },
  ], contextUncertainty: 0 });
  ok('cap por categoría limita el acumulado (|adj.home| ≤ 0.6)', Math.abs(many.context_adjustments.home) <= 0.6 + 1e-9);

  console.log('\n§M.4 DOUBLE-COUNT / DEDUP');
  const dup = ce.applyContext({ base: BASE, factors: [
    { factor_code: 'SAME', category: 'team', home_logit_delta: 0.3, confidence: 1 },
    { factor_code: 'SAME', category: 'team', home_logit_delta: 0.3, confidence: 1 },
  ], contextUncertainty: 0 });
  const single = ce.applyContext({ base: BASE, factors: [{ factor_code: 'SAME', category: 'team', home_logit_delta: 0.3, confidence: 1 }], contextUncertainty: 0 });
  ok('mismo factor_code NO se cuenta dos veces', close(dup.final_vector.home, single.final_vector.home, 1e-9) && dup.factor_count === 1);

  console.log('\n§M.4 FALLBACK / UNCERTAINTY');
  const none = ce.applyContext({ base: BASE, factors: [], contextUncertainty: 0 });
  ok('sin factores → final = base + estado BASE_ONLY_FALLBACK', close(none.final_vector.home, BASE.home, 1e-4) && none.context_state === 'BASE_ONLY_FALLBACK');
  const blocked = ce.applyContext({ base: BASE, factors: [{ factor_code: 'F', category: 'team', home_logit_delta: 0.5 }], state: 'BLOCKED', contextUncertainty: 0 });
  ok('estado BLOCKED → final = base', close(blocked.final_vector.home, BASE.home, 1e-4) && blocked.context_state === 'BLOCKED');
  const loU = ce.applyContext({ base: BASE, factors: [{ factor_code: 'F', category: 'team', home_logit_delta: 0.4, confidence: 1 }], contextUncertainty: 0 });
  const hiU = ce.applyContext({ base: BASE, factors: [{ factor_code: 'F', category: 'team', home_logit_delta: 0.4, confidence: 1 }], contextUncertainty: 1 });
  ok('mayor uncertainty → final más cerca de la base', Math.abs(hiU.final_vector.home - BASE.home) < Math.abs(loU.final_vector.home - BASE.home));
  ok('confidence = 1 − uncertainty', close(hiU.confidence, 0, 1e-9) && close(loU.confidence, 1, 1e-9));
  ok('missingCritical → PARTIAL_CONTEXT', ce.applyContext({ base: BASE, factors: [{ factor_code: 'F', category: 'team', home_logit_delta: 0.2 }], missingCritical: true, contextUncertainty: 0.3 }).context_state === 'PARTIAL_CONTEXT');

  console.log('\n§M.4 DETERMINISMO');
  const a = JSON.stringify(ce.applyContext({ base: BASE, factors: [{ factor_code: 'F', category: 'team', home_logit_delta: 0.2, confidence: 0.7 }], contextUncertainty: 0.3 }));
  const b = JSON.stringify(ce.applyContext({ base: BASE, factors: [{ factor_code: 'F', category: 'team', home_logit_delta: 0.2, confidence: 0.7 }], contextUncertainty: 0.3 }));
  ok('mismo input → mismo output', a === b);

  console.log(`\n[context-engine] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
