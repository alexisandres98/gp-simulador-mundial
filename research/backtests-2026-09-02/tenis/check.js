const P = require('./pass.js');
for (const tour of [0, 1]) {
  const cfg = { ...P.frozen(tour), needComp: true };
  const t0 = Date.now();
  const ho = P.runPass(tour, cfg, 20250101, 99999999);
  const m = (k) => P.metrics(ho.map((p) => ({ p: p[k], y: p.y })));
  const e = P.metrics(ho.map((p) => ({ p: P.ens(p, cfg.u), y: p.y })));
  console.log(tour === 0 ? 'ATP' : 'WTA', 'n', ho.length, 'ms', Date.now() - t0, 'mix', m('mix').skill_pct.toFixed(2), 'comp', m('comp').skill_pct.toFixed(2), 'ens', e.skill_pct.toFixed(2), 'brier', e.brier.toFixed(4));
  // cobertura de rasgos
  const hasMin = ho.filter((p) => p.fX.prevMin > 0 && p.fY.prevMin > 0).length, hasAge = ho.filter((p) => p.fX.age != null && p.fY.age != null).length, hasRank = ho.filter((p) => p.fX.rank && p.fY.rank).length;
  console.log('  prevMin ambos', hasMin, 'age ambos', hasAge, 'rank ambos', hasRank, 'spine(<20260526)', ho.filter((p) => p.date < 20260526).length);
  console.log('  ejemplo', JSON.stringify(ho[100].fX), JSON.stringify(ho[100].fY));
}
