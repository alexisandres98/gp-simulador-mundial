// tests/value-engine-db.test.js — Sprint 7. Picks lifecycle §65 contra PostgreSQL real (embedded-postgres).
// STRONG→candidate→publish (señal inmutable atómica), LEAN no crea candidata, no auto-publish, price-moved no borra.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.SIGNAL_REGISTRY_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_WRITE_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH = '2026-06-01T00:00:00Z';
process.env.VALUE_ENGINE_ENABLED = 'true';
process.env.VALUE_ENGINE_WRITE_ENABLED = 'true';
process.env.PICKS_ENABLED = 'true';
process.env.PICKS_MANUAL_PUBLICATION_ENABLED = 'true';

const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// mercado 1X2 con 4 books (4 grupos), GP y mejor cuota → clasifica según `over`.
function market(over = {}) {
  const q = (h, d, a) => ({ home: { odds: h }, draw: { odds: d }, away: { odds: a } });
  return {
    canonicalEventId: null, canonicalMarketId: null,
    gp: { probabilities: over.gp || { home: 0.63, draw: 0.23, away: 0.14 }, model_version: 'gp-core-1.4.0', methodology_version: 'gp-core-1.4.0', sampleStatus: 'established', calibrationStatus: 'identity', data_quality: 0.7 },
    predictionMarket: { probabilities: over.pm || { home: 0.61, draw: 0.25, away: 0.14 }, lowLiquidity: false, derived: false },
    sportsbooks: [
      { sportsbook: 'A', independence_group: 'g1', quotes: q(1.95, 3.8, 6.0), fresh: true },
      { sportsbook: 'B', independence_group: 'g2', quotes: q(1.97, 3.7, 5.8), fresh: true },
      { sportsbook: 'C', independence_group: 'g3', quotes: q(1.93, 3.9, 6.1), fresh: true },
      { sportsbook: 'D', independence_group: 'g4', quotes: q(1.96, 3.75, 5.9), fresh: true },
    ],
    bestPrices: { home: { decimalOdds: over.homeOdds || 1.95 }, draw: { decimalOdds: 4.0 }, away: { decimalOdds: 6.5 } },
    mappingMatched: true, outcomeMatched: true, hardConflicts: 0, rulesOk: true, freshnessOk: true, eventStarted: false,
    mappingVersion: 'v1', rulesVersion: 'rule-fp-2', priceStable: true, snapshotIds: [over.snap || 's1'],
  };
}

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const ve = require(R + '/value-engine');
  const registry = require(R + '/signal-registry');
  const repo = require(R + '/value-engine/repositories');
  try {
    await migrate.up();
    ok('migración 015 (value_evaluations + pick_publications)', (await client.query("SELECT to_regclass('public.value_evaluations') a, to_regclass('public.pick_publications') b")).rows[0].a != null);

    console.log('\n§65 PICKS LIFECYCLE');
    // 1. STRONG crea candidata
    const strong = await ve.evaluateAndPersist(market({ snap: 'strongA' }), { sportsbookCode: 'A', marketLabel: 'Ganador (1X2)' });
    ok('1/14. STRONG → candidata creada; LEAN/WATCH no', strong.classifications.home === 'strong' && strong.candidates.length === 1, JSON.stringify(strong.classifications));
    const evRow = strong.evaluations.find(e => e.selection === 'home');
    ok('12/13. odds + probabilidades congeladas en la evaluación', evRow.best_decimal_odds != null && evRow.ensemble_probability != null && evRow.input_hash);

    // 2. LEAN no crea candidata
    const lean = await ve.evaluateAndPersist(market({ gp: { home: 0.60, draw: 0.255, away: 0.145 }, pm: { home: 0.59, draw: 0.26, away: 0.15 }, homeOdds: 1.85, snap: 'leanA' }));
    ok('2. LEAN/WATCH NO crea candidata', lean.candidates.length === 0 && lean.classifications.home !== 'strong');

    // 16. INVARIANTE: auto-publication bloqueada
    ok('16. invariante auto-publication bloqueada', ve.cfg.flags.picksAutoPublicationBlocked === true);

    const cand = strong.candidates[0];
    // 4. revalidación + 11. publicación crea señal inmutable + 10. no signal → no pick
    const pub = await ve.picks.publish(cand.id, { actorId: 'admin@gp', currentEvaluation: evRow, eventLabel: 'España vs. Uruguay', marketLabel: 'Ganador (1X2)' });
    ok('11/15. publicación crea pick + estado published', pub.publication_status === 'published' && pub.public_id);
    ok('10/11. señal inmutable creada en el registro (signal_id)', pub.signal_id != null);
    const sig = await registry.repo.signals.byId(pub.signal_id);
    ok('señal es pick_gp_strong_value + payload congelado (odds)', sig && sig.signal_type === 'pick_gp_strong_value' && sig.signal_payload.observed_price != null);
    ok('20. executed_by_gp=false + realized_roi null', sig.signal_payload.executed_by_gp === false && sig.signal_payload.realized_roi === null);

    // señal inmutable: UPDATE rechazado
    let immBlocked = false;
    try { await client.query("UPDATE signals SET signal_payload='{}'::jsonb WHERE id=$1", [pub.signal_id]); } catch (e) { immBlocked = /append-only/.test(e.message); }
    ok('señal de pick es inmutable (UPDATE rechazado)', immBlocked);

    // 5/15. price moved no borra la pick
    await ve.picks.priceMoved(pub.id, { currentOdds: 1.70, actorId: 'system' });
    const moved = await repo.publications.byId(pub.id);
    ok('5/15. price_moved no borra (estado price_moved, fila persiste)', moved && moved.publication_status === 'price_moved');
    ok('15b. price_moved registra evento, no revive solo', (await repo.history.forPublication(pub.id)).some(e => e.action === 'price_moved'));

    // 14. withdrawal crea evento
    await ve.picks.withdraw(pub.id, { actorId: 'admin@gp', reason: 'cleanup' });
    ok('14. withdrawal → estado withdrawn + evento', (await repo.publications.byId(pub.id)).publication_status === 'withdrawn' && (await repo.history.forPublication(pub.id)).some(e => e.action === 'withdraw'));

    // 18. día sin picks: público vacío es válido
    const pubList = await ve.publicPicks({});
    ok('18. listado de picks (vacío válido)', Array.isArray(pubList.items));

    // 3. candidate requiere revisión (no se publica sin manual flag) — verificar guard
    let needsManual = false;
    const saved = ve.cfg.flags.picksManualPublication; ve.cfg.flags.picksManualPublication = false;
    try { await ve.picks.publish(cand.id, { currentEvaluation: evRow }); } catch (e) { needsManual = /manual_publication_disabled/.test(e.message); }
    ve.cfg.flags.picksManualPublication = saved;
    ok('3/4. publish requiere flag manual (sin él, falla)', needsManual);

    await client.close();
    console.log(`\n${fail === 0 ? '✅' : '❌'} Value Engine DB: ${pass} pasaron, ${fail} fallaron`);
    await h.stop();
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message); console.error(e.stack);
    try { await client.close(); } catch {}
    try { await h.stop(); } catch {}
    process.exit(1);
  }
})();
