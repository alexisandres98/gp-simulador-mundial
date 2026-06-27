// tests/post-shadow-o-collector-db.test.js — Fase O (DB). Migración 036 + persistencia collector + dedup +
// idempotencia + invariantes. No toca tablas oficiales.
'use strict';
process.env.DB_SSL = 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
const sec = require(R + '/collector/security');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const repo = require(R + '/collector/repository');
  const tbl = async () => (await client.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('context_source_catalog','context_fetch_runs','context_source_documents','context_claims','weather_snapshots')`)).rows[0].n;
  try {
    await migrate.up();
    console.log('\n§O MIGRACIÓN 036');
    ok('UP: 5 tablas collector', (await tbl()) === 5);
    let rolls = 0; while ((await tbl()) > 0 && rolls < 5) { await migrate.rollback(); rolls++; }
    ok('DOWN: desaparecen', (await tbl()) === 0);
    await migrate.up();
    ok('RE-UP: vuelven', (await tbl()) === 5);

    console.log('\n§O CATÁLOGO + ENABLED GATE');
    const src = await repo.upsertSource({ source_key: 'open-meteo', source_name: 'Open-Meteo', source_type: 'weather', domain: 'open-meteo.com', reliability_tier: 'TIER_1_OFFICIAL', allowed_collection_method: 'weather_api', terms_review_status: 'approved', robots_review_status: 'approved', enabled: true });
    ok('upsert source TIER_1 enabled', src.reliability_tier === 'TIER_1_OFFICIAL' && src.enabled === true);
    await repo.upsertSource({ source_key: 'unverified-blog', source_name: 'Blog', source_type: 'news', reliability_tier: 'TIER_4_UNVERIFIED', enabled: false });
    const en = await repo.enabledSources();
    ok('enabledSources solo trae aprobadas+enabled (no la TIER_4 disabled)', en.length === 1 && en[0].source_key === 'open-meteo');

    console.log('\n§O DOCUMENTOS + DEDUP');
    const fr = await repo.recordFetch({ source_id: src.source_id, http_status: 200, content_hash: sec.contentHash('abc'), bytes: 3, fetch_status: 'ok' });
    ok('fetch run registrado', !!fr);
    const d1 = await repo.recordDocument({ source_id: src.source_id, canonical_url: 'https://x/a', title: 'Preview', normalized_content_hash: 'nh1', content_excerpt: 'Croatia vs Ghana', fetch_run_id: fr });
    const d2 = await repo.recordDocument({ source_id: src.source_id, canonical_url: 'https://x/a', title: 'Preview', normalized_content_hash: 'nh1', content_excerpt: 'Croatia vs Ghana' });
    ok('documento duplicado (mismo hash) NO se duplica', d1.duplicate === false && d2.duplicate === true && d1.row.document_id === d2.row.document_id);

    console.log('\n§O CLAIMS + WEATHER');
    const cl = await repo.recordClaim({ document_id: d1.row.document_id, factor_code: 'PLAYER_CONFIRMED_OUT', subject_type: 'player', fact_or_inference: 'FACT', confidence: 0.85, materiality: 'MATERIAL', applied: false, applied_impact: 0 });
    ok('claim persistido (FACT, sin impacto directo)', cl.factor_code === 'PLAYER_CONFIRMED_OUT' && cl.applied === false);
    const wr = await repo.recordWeather({ canonical_event_id: null, venue: 'Test', latitude: 10, longitude: -74, apparent_c: 35, weather_factors: ['EXTREME_HEAT'], input_hash: 'wh1' });
    const wr2 = await repo.recordWeather({ canonical_event_id: null, venue: 'Test', apparent_c: 35, weather_factors: ['EXTREME_HEAT'], input_hash: 'wh1' });
    ok('weather idempotente por input_hash', wr.idempotent === false && wr2.idempotent === true);

    console.log('\n§O INVARIANTES');
    const inv = (await client.query(`SELECT (SELECT count(*) FROM signals)::int s,(SELECT count(*) FROM internal_picks)::int p`)).rows[0];
    ok('no toca Signals/Picks', inv.s === 0 && inv.p === 0);

    console.log(`\n[post-shadow-o-collector-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
