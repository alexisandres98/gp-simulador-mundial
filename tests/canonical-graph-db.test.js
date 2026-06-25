// tests/canonical-graph-db.test.js — integración del Canonical Event Graph contra PostgreSQL (Sprint 2).
// Flags + PG embebido (base aislada compatible) se arrancan aquí, igual que el resto de tests DB.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.CANONICAL_GRAPH_ENABLED = 'true';
process.env.CANONICAL_GRAPH_WRITE_ENABLED = 'true';
process.env.CANONICAL_AUTO_MATCH_ENABLED = 'true';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
const { pmChamp, ksChamp, pmMatch, ksMatch } = require(R + '/canonical-graph/fixtures/golden');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const _h = await boot();  // setea DATABASE_URL ANTES de requerir los módulos de DB
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const dbRepos = require(R + '/database/repositories');
  const graphRepo = require(R + '/canonical-graph/repositories/graphRepository');
  const index = require(R + '/canonical-graph');
  const review = require(R + '/canonical-graph/review');
  try {
    await migrate.up();
    console.log('Seed de participantes');
    const seed = await graphRepo.seedParticipants();
    ok('48 participantes sembrados', seed.participants === 48, `=${seed.participants}`);
    ok('aliases sembrados (>48)', seed.aliasRows > 48, `=${seed.aliasRows}`);
    const again = await graphRepo.seedParticipants();
    ok('seed idempotente (no duplica)', again.aliasRows === 0);

    // proveedores
    const pm = await dbRepos.providers.upsertByCode({ code: 'polymarket', name: 'Polymarket' });
    const ks = await dbRepos.providers.upsertByCode({ code: 'kalshi', name: 'Kalshi' });

    console.log('Auto-match de equivalencia clara (campeón)');
    const matched = index.matchProviders([pmChamp('Brazil').market, pmChamp('Argentina').market], [ksChamp('Brazil').market, ksChamp('Argentina').market], 'polymarket', 'kalshi');
    const persistedM = await review.persistResults(matched.results, { providerA: 'polymarket', providerB: 'kalshi' });
    ok('persistencia ejecutada (write on)', persistedM.persisted === true);
    ok('auto-matches escritos (Brazil+Argentina)', persistedM.autoMatches >= 2, JSON.stringify(persistedM));
    const mm = await client.query("SELECT count(*)::int n FROM provider_market_mappings WHERE mapping_status='matched'");
    ok('provider_market_mappings matched persistidos', mm.rows[0].n >= 4, `=${mm.rows[0].n}`);
    const cm = await client.query("SELECT count(*)::int n FROM canonical_markets");
    ok('canonical_markets creados (controlado)', cm.rows[0].n >= 2);

    console.log('Casos a revisión (conditional / needs_review)');
    const cond = index.matchProviders(
      [pmMatch('Spain', 'France', { q: 'to win the match', desc: 'Winner including extra time. Two-way, no draw.' }).market],
      [ksMatch('Spain', 'France', { q: 'to win the match', rules: 'Winner within 90 minutes. Two-way, no draw.' }).market],
      'polymarket', 'kalshi');
    const persistedC = await review.persistResults(cond.results, { providerA: 'polymarket', providerB: 'kalshi' });
    ok('conditional va a la cola de revisión', persistedC.reviews >= 1, JSON.stringify(persistedC));
    const rq = await graphRepo.listReview('pending', 10);
    ok('review queue con pendientes', rq.length >= 1);
    ok('item de revisión tiene evidencia/score', rq[0].score != null && rq[0].conflicts != null);

    console.log('Decisión manual auditada');
    const decided = await index.reviewDecide(rq[0].id, { decision: 'conditional', reviewedBy: 'admin@test', notes: 'diferencia de periodo' });
    ok('decisión aplicada (status conditional)', decided && decided.status === 'conditional');
    const hist = await client.query("SELECT count(*)::int n FROM mapping_decision_history WHERE decision_source='manual'");
    ok('historial de decisión manual registrado', hist.rows[0].n >= 1);

    console.log('verify de integridad');
    const badMatched = await client.query(`SELECT count(*)::int n FROM provider_market_mappings WHERE mapping_status='matched' AND canonical_market_id IS NULL`);
    ok('ningún matched sin canónico', badMatched.rows[0].n === 0);
    const noVersion = await client.query(`SELECT count(*)::int n FROM provider_market_mappings WHERE mapping_version IS NULL`);
    ok('ningún mapping sin versión', noVersion.rows[0].n === 0);

    console.log('Performance (48×2 mercados de campeón)');
    const { TEAMS } = require(R + '/data/tournament');
    const A = TEAMS.map(t => pmChamp(t.en || t.name).market);
    const B = TEAMS.map(t => ksChamp(t.en || t.name).market);
    const t0 = Date.now();
    const perf = index.matchProviders(A, B, 'polymarket', 'kalshi');
    const elapsed = Date.now() - t0;
    ok(`matching de ${A.length}×${B.length} en ${elapsed}ms`, elapsed < 3000, `=${elapsed}ms`);
    ok('candidatos generados por bucket (no O(n²) sin filtro)', perf.candidateCount > 0);
    const matchedPerf = perf.results.filter(r => r.outcomes[0] && r.outcomes[0].status === 'matched').length;
    ok('48 equivalencias de campeón detectadas', matchedPerf === 48, `=${matchedPerf}`);
    const fpPerf = perf.results.filter(r => r.outcomes[0] && r.outcomes[0].status === 'matched' && r.a.outcomeParticipant.code !== r.b.outcomeParticipant.code).length;
    ok('0 falsos positivos en performance (outcomes de distinto equipo no matchean)', fpPerf === 0);

    await client.close();
    console.log(`\n${fail === 0 ? '✅' : '❌'} Canonical Graph DB: ${pass} pasaron, ${fail} fallaron`);
    try { await _h.stop(); } catch {}
    process.exit(fail === 0 ? 0 : 1);
  } catch (e) {
    console.error('\n❌ ERROR:', e.message); console.error(e.stack);
    try { await client.close(); } catch {}
    try { await _h.stop(); } catch {}
    process.exit(1);
  }
})();
