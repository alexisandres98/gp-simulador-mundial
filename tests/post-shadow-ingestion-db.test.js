// tests/post-shadow-ingestion-db.test.js — Post-shadow Bloque A. Persistencia batch + idempotencia natural
// + current/history contra PostgreSQL real (embedded-postgres). Cubre §19 Ingesta + Storage.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// fila estilo normalizer.setsToQuoteRows
function row(book, ev, slot, odds, over = {}) {
  return {
    data_provider: 'the_odds_api', sportsbook_code: book, sportsbook_name: book.toUpperCase(),
    operator_group: over.operator_group || book, independence_group: over.independence_group || book,
    source_role: 'market_consensus', jurisdiction: 'eu',
    external_event_id: ev, external_market_id: `${book}:${ev}:1x2`, external_outcome_id: `${book}:${ev}:${slot}`,
    market_family: '1x2', period: 'regulation', is_live: false, odds_format: 'decimal',
    odds_decimal: odds, implied_probability: +(1 / odds).toFixed(8), raw_implied_probability: +(1 / odds).toFixed(8),
    quote_status: over.quote_status || 'open', quote_timestamp: over.ts || '2026-06-25T18:00:00Z',
    stake_limit_status: 'unknown', maximum_stake: null, normalizer_version: 'odds-normalize-1',
    metadata: { outcome_slot: slot },
  };
}
// set 1X2 de N books para un evento
function bookSet(ev, n) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(row('bk' + i, ev, 'home', 1.9 + i * 0.01), row('bk' + i, ev, 'draw', 3.5), row('bk' + i, ev, 'away', 4.2));
  return rows;
}

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const P = require(R + '/sportsbook-providers/persistence');
  const q = (s, p = []) => client.query(s, p);
  try {
    await migrate.up();
    const runId = async () => (await q(`INSERT INTO sportsbook_ingestion_runs (status) VALUES ('running') RETURNING id`)).rows[0].id;

    // 1) BATCH INSERT
    let r1 = await runId();
    let m = await P.persistCurrentBatch(bookSet('evtA', 3), r1);  // 3 books × 3 outcomes = 9
    ok('batch insert: inserted=9', m.inserted === 9, JSON.stringify(m));
    ok('batch insert: 0 rejected', m.rejected === 0);
    ok('current tiene 9 filas', (await q(`SELECT count(*)::int n FROM sportsbook_quote_current`)).rows[0].n === 9);
    ok('history new=9', (await q(`SELECT count(*)::int n FROM sportsbook_quote_history WHERE change_type='new'`)).rows[0].n === 9);

    // 2) IDEMPOTENT REPLAY (mismas filas, otro run) → 0 inserted, 0 updated, 9 unchanged, sin history nueva
    let r2 = await runId();
    m = await P.persistCurrentBatch(bookSet('evtA', 3), r2);
    ok('replay: inserted=0', m.inserted === 0, JSON.stringify(m));
    ok('replay: updated=0', m.updated === 0);
    ok('replay: unchanged=9', m.unchanged === 9, JSON.stringify(m));
    ok('replay: current sigue en 9 (no duplica)', (await q(`SELECT count(*)::int n FROM sportsbook_quote_current`)).rows[0].n === 9);
    ok('replay: history NO crece', (await q(`SELECT count(*)::int n FROM sportsbook_quote_history`)).rows[0].n === 9);
    ok('replay: observation_count subió a 2', (await q(`SELECT min(observation_count)::int n FROM sportsbook_quote_current`)).rows[0].n === 2);

    // 3) PRICE CHANGE preservado en history + current
    let r3 = await runId();
    const changed = bookSet('evtA', 3);
    changed[0].odds_decimal = 2.50;  // bk0 home cambia 1.90 → 2.50
    m = await P.persistCurrentBatch(changed, r3);
    ok('price change: updated=1', m.updated === 1, JSON.stringify(m));
    ok('price change: history price=1', (await q(`SELECT count(*)::int n FROM sportsbook_quote_history WHERE change_type='price'`)).rows[0].n === 1);
    ok('price change: current refleja 2.50', Number((await q(`SELECT odds_decimal FROM sportsbook_quote_current WHERE external_outcome_id='bk0:evtA:home'`)).rows[0].odds_decimal) === 2.5);
    ok('price change: prev_odds=1.90 en history', Number((await q(`SELECT prev_odds_decimal FROM sportsbook_quote_history WHERE change_type='price'`)).rows[0].prev_odds_decimal) === 1.9);

    // 4) IDENTICAL ignorado (re-persistir el mismo estado cambiado)
    let r4 = await runId();
    m = await P.persistCurrentBatch(changed, r4);
    ok('identical: unchanged=9, updated=0', m.unchanged === 9 && m.updated === 0, JSON.stringify(m));

    // 5) SUSPENDED transition → history 'status'
    let r5 = await runId();
    const susp = bookSet('evtA', 3).map(x => ({ ...x, odds_decimal: x.external_outcome_id === 'bk0:evtA:home' ? 2.50 : x.odds_decimal }));
    susp[1].quote_status = 'suspended';  // bk0 draw open→suspended
    m = await P.persistCurrentBatch(susp, r5);
    ok('suspended: history status=1', (await q(`SELECT count(*)::int n FROM sportsbook_quote_history WHERE change_type='status'`)).rows[0].n === 1, JSON.stringify(m));

    // 6) PROVIDER TIMESTAMP change SIN cambio de precio/estado → NO history, observed_at avanza
    let r6 = await runId();
    const tsOnly = susp.map(x => ({ ...x, quote_timestamp: '2026-06-25T19:00:00Z' }));
    const histBefore = (await q(`SELECT count(*)::int n FROM sportsbook_quote_history`)).rows[0].n;
    m = await P.persistCurrentBatch(tsOnly, r6);
    const histAfter = (await q(`SELECT count(*)::int n FROM sportsbook_quote_history`)).rows[0].n;
    ok('timestamp-only: history NO crece', histAfter === histBefore, `${histBefore}->${histAfter}`);
    ok('timestamp-only: provider_update avanzó', new Date((await q(`SELECT provider_update FROM sportsbook_quote_current WHERE external_outcome_id='bk0:evtA:away'`)).rows[0].provider_update).toISOString() === '2026-06-25T19:00:00.000Z');

    // 7) PERFORMANCE: 3000 cuotas (40 books × 25 eventos × 3) en un lote
    let r7 = await runId();
    const big = [];
    for (let e = 0; e < 25; e++) for (let b = 0; b < 40; b++) big.push(row('pb' + b, 'pev' + e, 'home', 1.8), row('pb' + b, 'pev' + e, 'draw', 3.6), row('pb' + b, 'pev' + e, 'away', 4.5));
    const t0 = Date.now();
    m = await P.persistCurrentBatch(big, r7);
    const ms = Date.now() - t0;
    ok(`performance: 3000 inserted (${ms}ms)`, m.inserted === 3000, JSON.stringify({ inserted: m.inserted, ms }));
    ok('performance: < 10s', ms < 10000, `${ms}ms`);
    // replay del big: idempotente y rápido
    let r8 = await runId();
    const t1 = Date.now();
    m = await P.persistCurrentBatch(big, r8);
    ok(`performance replay: 0 inserted, 3000 unchanged (${Date.now() - t1}ms)`, m.inserted === 0 && m.unchanged === 3000, JSON.stringify(m));

    // 8) NO SECRETS en errores: forzar fila inválida y revisar sanitización
    const bad = [{ ...row('xb', 'xev', 'home', 1.9), odds_decimal: 'not_a_number' }];
    let r9 = await runId();
    m = await P.persistCurrentBatch(bad, r9);
    ok('row error: rejected=1 y sanitizado', m.rejected === 1 && m.errors.length === 1, JSON.stringify(m.errors));
    ok('row error: sin valores numéricos crudos en el detalle', !/\d{3,}/.test(JSON.stringify(m.errors)));

    console.log(`\n[post-shadow-ingestion-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
