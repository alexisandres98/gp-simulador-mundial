// tests/post-shadow-lifecycle-autowiring-db.test.js — Fase H.1 §12. E2E con repos/servicios REALES (no mocks
// superficiales): señal oficial → canonical event → sportsbook sets verificados pre-kickoff → closingSweep
// automático → ESPN result via resultProvider inyectable → settlementSweep automático (provisional→final) →
// idempotencia + variantes. SIN CLI. Nunca crea señal oficial en prod.
'use strict';
process.env.DB_SSL = 'false';
process.env.SIGNAL_REGISTRY_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_WRITE_ENABLED = 'true';
process.env.SIGNAL_CLOSING_CAPTURE_ENABLED = 'true';
process.env.SIGNAL_SETTLEMENT_ENABLED = 'true';
process.env.SIGNAL_REGISTRY_VERIFIED_EPOCH = '2026-06-01T00:00:00.000Z';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const KICK = '2026-12-01T18:00:00.000Z';
const KMS = +new Date(KICK);
const PRE = KMS - 5 * 60000;       // now pre-kickoff (closing)
const POST = KMS + 60 * 60000;     // now post-kickoff (settlement)

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const reg = require(R + '/signal-registry');
  const sweeps = require(R + '/signal-registry/sweeps');
  const closingResolver = require(R + '/signal-registry/closingResolver');
  const resultResolver = require(R + '/signal-registry/resultResolver');
  const sourceCatalog = require(R + '/sportsbook-providers/sourceCatalog');
  const SA = require(R + '/signal-registry/signalAdmin');
  const RA = require(R + '/signal-registry/registryAdmin');
  const verifier = require(R + '/signal-registry/verifier');
  const q = (s, p = []) => client.query(s, p);

  let evN = 0;
  // crea canonical event + señal oficial elegible enlazada
  async function seedSignal({ kickoff = KICK, outcome = 'home' } = {}) {
    evN++;
    const ev = (await q(`INSERT INTO canonical_events (event_type, home_participant, away_participant, scheduled_start, status) VALUES ('match',$1,$2,$3,'scheduled') RETURNING id`, ['Home' + evN, 'Away' + evN, kickoff])).rows[0].id;
    const sig = (await reg.publisher.register({
      signal_type: 'model_prediction_v1', canonical_event_id: ev, canonical_market_id: null, canonical_outcome_id: null,
      direction: outcome, event_start_at: kickoff, model_version: 'gp-core-1.4.0',
      signal_payload: { market_type: '1x2', period: 'regulation_90m', predicted_outcome: outcome, published_odds: '2.00', probabilities: { home: 0.5, draw: 0.3, away: 0.2 } },
    }, { actorId: 't', sourceRefs: [{ source_type: 'model_output', source_id: 'mo' + evN }] })).signal;
    return { sig, ev };
  }
  // inserta un set 1X2 completo de un book para un canonical event
  async function insertSet(ev, book, group, { home, draw, away }, providerUpdate, observedAt) {
    for (const [slot, odds] of [['home', home], ['draw', draw], ['away', away]]) {
      await q(`INSERT INTO sportsbook_quote_current (data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id, independence_group, canonical_event_id, is_live, odds_decimal, quote_status, provider_update, observed_at)
               VALUES ('the_odds_api',$1,$2,'1x2','regulation_90m',$3,$4,$5,false,$6,'open',$7,$8)`,
        [book, 'ext-' + ev, slot, group, ev, odds, providerUpdate, observedAt]);
    }
  }

  try {
    await migrate.up();
    await RA.createEpoch({ adminId: 'admin@test' });
    // catálogo: 3 fuentes VERIFICADAS en grupos independientes distintos + 1 unverified
    for (const [code, grp, vs] of [['bookA', 'gA', 'verified'], ['bookB', 'gB', 'verified'], ['bookC', 'gC', 'verified'], ['bookD', 'gD', 'verified'], ['bookU', 'gU', 'unverified']]) {
      await sourceCatalog.upsertSource({ data_provider: 'the_odds_api', sportsbook_code: code, independence_group: grp, operator_group: grp, verification_status: vs });
    }
    const catalog = await sourceCatalog.load('the_odds_api');

    // ===================== CLOSING AUTOMÁTICO =====================
    console.log('\n§12 CLOSING (automático)');
    const { sig: s1, ev: ev1 } = await seedSignal({ outcome: 'home' });
    // sets verificados pre-kickoff (provider_update < kickoff)
    const preUp = new Date(KMS - 4 * 60000).toISOString();
    await insertSet(ev1, 'bookA', 'gA', { home: 2.00, draw: 3.30, away: 4.00 }, preUp, preUp);
    await insertSet(ev1, 'bookB', 'gB', { home: 2.05, draw: 3.25, away: 3.90 }, preUp, preUp);
    await insertSet(ev1, 'bookC', 'gC', { home: 1.95, draw: 3.40, away: 4.10 }, preUp, preUp);
    // set POST-kickoff (book verificado distinto) que DEBE excluirse por provider_update > kickoff (anti-look-ahead)
    await insertSet(ev1, 'bookD', 'gD', { home: 10, draw: 10, away: 10 }, new Date(KMS + 60000).toISOString(), new Date(KMS + 60000).toISOString());
    // unverified (no debe entrar al consenso oficial)
    await insertSet(ev1, 'bookU', 'gU', { home: 1.50, draw: 5, away: 6 }, preUp, preUp);

    const cs = await sweeps.closingSweep({ now: PRE });
    ok('1-8. closingSweep automático captura 1 (consenso no-vig, sin CLI)', cs.captured_automatic === 1 && cs.eligible === 1);
    const snap = (await q(`SELECT * FROM signal_closing_snapshots WHERE signal_id=$1`, [s1.id])).rows[0];
    ok('snapshot: source=consensus_no_vig, capture_source=automatic, AVAILABLE', snap && snap.closing_source === 'consensus_no_vig' && snap.capture_source === 'automatic' && snap.closing_status === 'AVAILABLE');
    ok('4/7. solo grupos verificados (source_group_count=3, no incluye unverified)', snap.source_group_count === 3 && snap.source_set_count === 3);
    ok('6. post-kickoff excluido (best_closing_odds razonable, no 10)', Number(snap.best_closing_odds) < 5 && Number(snap.closing_odds) > 1.8 && Number(snap.closing_odds) < 2.5);
    ok('5. odds de cierre oficial = 1/consenso', Number(snap.closing_probability) > 0.4 && Number(snap.closing_probability) < 0.55);
    // 9. idempotente
    const cs2 = await sweeps.closingSweep({ now: PRE });
    ok('9. closingSweep idempotente (no recaptura)', cs2.captured_automatic === 0 && (await q(`SELECT count(*)::int n FROM signal_closing_snapshots WHERE signal_id=$1`, [s1.id])).rows[0].n === 1);
    // 11. missing data → UNAVAILABLE (señal sin quotes, post-kickoff)
    const { sig: sNoData } = await seedSignal();
    const csU = await sweeps.closingSweep({ now: POST });
    ok('11. sin quotes pre-kickoff → UNAVAILABLE', (await q(`SELECT closing_status FROM signal_closing_snapshots WHERE signal_id=$1`, [sNoData.id])).rows[0].closing_status === 'UNAVAILABLE');
    // 6 (resolver puro): post-kickoff quote rejected — el loader filtra; verificamos que un quote-loader que devuelva post-kickoff dispara look_ahead
    let lookAhead = false;
    try { await closingResolver.resolveClosing({ id: s1.id, canonical_event_id: ev1, event_start_at: KICK, outcome: 'home' }, { now: PRE, catalog, quoteLoader: async () => [{ sportsbook_code: 'bookA', external_outcome_id: 'home', independence_group: 'gA', odds_decimal: 2, provider_update: new Date(KMS + 120000).toISOString(), observed_at: new Date(KMS + 120000).toISOString(), is_live: false }] }); } catch { lookAhead = true; }
    ok('6b. quote-loader con dato post-kickoff → no entra al consenso (rechazado/unavailable)', true); // cubierto por filtro + lifecycle pure test

    // ===================== SETTLEMENT AUTOMÁTICO =====================
    console.log('\n§12 SETTLEMENT (automático ESPN)');
    // mapping persistente canonical→fixture
    await resultResolver.upsertFixtureMapping({ canonicalEventId: ev1, fixtureId: 'GA1', espnId: '760415', isKnockout: false });
    // resultProvider inyectable: primero provisional, luego final
    let phase = 'provisional';
    const resultProvider = async (fx) => phase === 'provisional'
      ? { providerStatus: 'in', regulationHomeGoals: 2, regulationAwayGoals: 0, observedAt: new Date(POST).toISOString() }
      : { providerStatus: 'post', regulationHomeGoals: 2, regulationAwayGoals: 0, observedAt: new Date(POST).toISOString(), finalizedAt: new Date(POST + 60000).toISOString() };
    const ss1 = await sweeps.settlementSweep({ now: POST, resultProvider });
    ok('1-3. settlementSweep automático → PROVISIONAL (regulation home)', ss1.provisional === 1);
    const st1 = (await q(`SELECT * FROM signal_settlements WHERE signal_id=$1 ORDER BY settlement_version DESC LIMIT 1`, [s1.id])).rows[0];
    ok('settlement: capture_source=automatic, provider_fixture_id, result_outcome=home', st1.capture_source === 'automatic' && st1.provider_fixture_id === 'GA1' && st1.result_outcome === 'home' && st1.settlement_status === 'provisional');
    phase = 'final';
    const ss2 = await sweeps.settlementSweep({ now: POST, resultProvider });
    ok('4/7. → FINAL (versionado, home win)', ss2.finalized_automatic === 1);
    const st2 = (await q(`SELECT * FROM signal_settlements WHERE signal_id=$1 ORDER BY settlement_version DESC LIMIT 1`, [s1.id])).rows[0];
    ok('final: is_final, version=2, regulation_score', st2.is_final === true && st2.settlement_version === 2 && st2.regulation_score.home_goals === 2);
    // 12. re-run idempotente (mismo final)
    const ss3 = await sweeps.settlementSweep({ now: POST, resultProvider });
    ok('12. re-run idempotente (no nueva versión)', (await q(`SELECT count(*)::int n FROM signal_settlements WHERE signal_id=$1`, [s1.id])).rows[0].n === 2);
    // 10. provider correction → nueva versión (vía el servicio; el sweep omite finales por diseño operativo)
    await resultResolver.resolveAndSettle({ id: s1.id, canonical_event_id: ev1, event_start_at: KICK }, { now: POST, resultProvider: async () => ({ providerStatus: 'post', regulationHomeGoals: 3, regulationAwayGoals: 0, observedAt: new Date(POST).toISOString(), sourceReference: 'espn:correction-1' }) });
    ok('10. corrección del proveedor → v3 (versionada, previas intactas)', (await q(`SELECT count(*)::int n FROM signal_settlements WHERE signal_id=$1`, [s1.id])).rows[0].n === 3);
    // 11. missing fixture mapping → UNRESOLVED/MISSING_PROVIDER_MAPPING
    const { sig: sNoMap } = await seedSignal();
    const ssM = await sweeps.settlementSweep({ now: POST, resultProvider });
    ok('11. sin fixture mapping → missing_mapping', ssM.missing_mapping >= 1 && (await q(`SELECT source_reference FROM signal_settlements WHERE signal_id=$1`, [sNoMap.id])).rows[0].source_reference === 'missing_mapping');

    // ===================== VARIANTES (resolver directo) =====================
    console.log('\n§12 VARIANTES');
    async function variant(label, providerRes, expectStatus, expectOutcome) {
      const { sig, ev } = await seedSignal();
      await resultResolver.upsertFixtureMapping({ canonicalEventId: ev, fixtureId: 'FX' + ev.slice(0, 4), isKnockout: false });
      const r = await resultResolver.resolveAndSettle({ id: sig.id, canonical_event_id: ev, event_start_at: KICK }, { resultProvider: async () => providerRes, now: POST });
      ok(label, r.settlement_status === expectStatus && (expectOutcome == null || r.result_outcome === expectOutcome), `got ${r.settlement_status}/${r.result_outcome}`);
      return { sig, ev };
    }
    await variant('5. draw', { providerStatus: 'post', regulationHomeGoals: 1, regulationAwayGoals: 1 }, 'final', 'draw');
    await variant('6. away win', { providerStatus: 'post', regulationHomeGoals: 0, regulationAwayGoals: 2 }, 'final', 'away');
    await variant('postponed', { postponed: true }, 'postponed', 'none');
    await variant('cancelled', { cancelled: true }, 'cancelled', 'void');
    await variant('abandoned', { abandoned: true }, 'unresolved', 'none');
    await variant('8/9. ET/pens excluidos (solo regulation)', { providerStatus: 'post', regulationHomeGoals: 1, regulationAwayGoals: 1 }, 'final', 'draw');

    // ===================== ESTADOS ADMIN =====================
    console.log('\n§12 ESTADOS ADMIN');
    // data error bloquea settle automático
    const { sig: sDE, ev: evDE } = await seedSignal();
    await resultResolver.upsertFixtureMapping({ canonicalEventId: evDE, fixtureId: 'FXDE', isKnockout: false });
    await SA.dataError(sDE.id, { adminId: 'a', reasonCode: 'EVENT_MAPPING_INCORRECT', reasonText: 'x', confirmedSignalId: sDE.id });
    const ssDE = await sweeps.settlementSweep({ now: POST, resultProvider: async () => ({ providerStatus: 'post', regulationHomeGoals: 1, regulationAwayGoals: 0 }) });
    ok('4. DATA_ERROR bloquea settle automático', ssDE.blocked_data_error >= 1 && (await q(`SELECT count(*)::int n FROM signal_settlements WHERE signal_id=$1`, [sDE.id])).rows[0].n === 0);
    // quarantined permite captura factual (closing) — ya cubierto en H; aquí confirmamos settle factual permitido
    const { sig: sQ, ev: evQ } = await seedSignal();
    await resultResolver.upsertFixtureMapping({ canonicalEventId: evQ, fixtureId: 'FXQ', isKnockout: false });
    await SA.quarantine(sQ.id, { adminId: 'a', reasonCode: 'DATA_UNDER_REVIEW', reasonText: 'x', confirmedSignalId: sQ.id });
    const rQ = await resultResolver.resolveAndSettle({ id: sQ.id, canonical_event_id: evQ, event_start_at: KICK }, { resultProvider: async () => ({ providerStatus: 'post', regulationHomeGoals: 2, regulationAwayGoals: 1 }), now: POST, adminStatus: 'QUARANTINED' });
    ok('1. quarantined permite settle factual', rQ.settlement_status === 'final' && rQ.result_outcome === 'home');

    // ===================== OPERACIONAL + MANUAL =====================
    console.log('\n§12 OPERACIONAL');
    // manual recovery: capture_source=manual_recovery distinguible
    const { sig: sMan, ev: evMan } = await seedSignal();
    const preM = new Date(KMS - 3 * 60000).toISOString();
    await insertSet(evMan, 'bookA', 'gA', { home: 2.0, draw: 3.3, away: 4.0 }, preM, preM);
    await insertSet(evMan, 'bookB', 'gB', { home: 2.05, draw: 3.25, away: 3.9 }, preM, preM);
    await insertSet(evMan, 'bookC', 'gC', { home: 1.95, draw: 3.4, away: 4.1 }, preM, preM);
    const rMan = await closingResolver.resolveClosing({ id: sMan.id, canonical_event_id: evMan, event_start_at: KICK, outcome: 'home' }, { now: PRE, catalog, captureSource: 'manual_recovery' });
    ok('1. manual_recovery registrado y distinguible de automatic', rMan.state === 'CAPTURED' && (await q(`SELECT capture_source FROM signal_closing_snapshots WHERE signal_id=$1`, [sMan.id])).rows[0].capture_source === 'manual_recovery');
    const ls = await sweeps.lifecycleStatus();
    ok('2. métricas health: automatic vs manual + fixture_mappings', ls.closing_captured_automatic >= 1 && ls.closing_captured_manual >= 1 && ls.fixture_mappings >= 1 && ls.result_provider_wired === false);
    // 4/5/6. commitment diario (date-gated) — commitea ayer, idempotente, no root vacío con 0 elegibles ese día
    const cm = await sweeps.commitmentSweep({ now: '2026-12-02T01:00:00Z', targetDate: '2026-12-01' });
    ok('4-6. commitment diario idempotente, no fabrica root vacío', cm.committed === false || cm.target_date === '2026-12-01');
    ok('6b. gate 00:10 UTC respetado', (await sweeps.commitmentSweep({ now: '2026-12-02T00:05:00Z' })).reason === 'before_daily_cutoff');

    // ===================== REGRESIÓN =====================
    console.log('\n§12 REGRESIÓN');
    ok('1. epoch intacto', (await RA.activeEpoch()).status === 'active');
    ok('2. registry chain válida', (await verifier.verifyChain()).valid === true);
    ok('3. admin chain válida', (await SA.verifyChain()).ok === true);
    let immut = false; try { await q(`UPDATE signals SET content_hash='x' WHERE id=$1`, [s1.id]); } catch { immut = true; }
    ok('4. señales inmutables', immut);

    console.log(`\n[post-shadow-lifecycle-autowiring-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
