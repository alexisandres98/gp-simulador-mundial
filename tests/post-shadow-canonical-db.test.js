// tests/post-shadow-canonical-db.test.js — Post-shadow Bloque G. Seed participantes + sportsbook→canonical
// (candidates/needs_review, auto-match OFF) + approve/link, contra PostgreSQL real.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const FUT = '2026-07-10T18:00:00Z';   // futuro respecto al "now" del test
const NOW = '2026-06-25T12:00:00Z';

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const SC = require(R + '/sportsbook-providers/sportsbookCanonical');
  const q = (s, p = []) => client.query(s, p);
  // inserta un set de current state para un evento (home/away en metadata)
  async function event(ext, home, away, nBooks, over = {}) {
    for (let i = 0; i < nBooks; i++) for (const slot of ['home', 'draw', 'away']) {
      await q(`INSERT INTO sportsbook_quote_current
        (data_provider, sportsbook_code, external_event_id, market_family, period, external_outcome_id, is_live, odds_decimal, provider_update, metadata)
        VALUES ('the_odds_api',$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        ['bk' + i, ext, over.market_family || '1x2', over.period || 'regulation', `bk${i}:${ext}:${slot}`,
         over.live || false, 2.0, FUT, JSON.stringify({ home_team: home, away_team: away, competition: 'FIFA World Cup', commence_time: over.commence || FUT })]);
    }
  }
  try {
    await migrate.up();

    // seed participantes (R10)
    const seeded = await SC.seedParticipants();
    ok('seedParticipants: participantes > 0', seeded.participants > 0, JSON.stringify(seeded));
    ok('seedParticipants: aliases > 0', seeded.aliasRows > 0);
    ok('seedParticipants: idempotente', (await SC.seedParticipants()).participants > 0);

    // eventos de prueba
    await event('ev_valid', 'Spain', 'Brazil', 3);                       // válido
    await event('ev_started', 'France', 'Argentina', 2, { commence: NOW });  // ya iniciado → reject
    await event('ev_live', 'Germany', 'Portugal', 2, { live: true });    // live → reject
    await event('ev_unknown', 'Atlantis FC', 'El Dorado United', 2);      // equipos no resueltos → needs_review

    const res = await SC.generateCandidates('the_odds_api', { now: NOW, autoMatch: false });
    ok('candidates: evento válido → candidate', res.candidates >= 1, JSON.stringify(res));
    ok('candidates: needs_review ≥ 1', res.needs_review >= 1);
    ok('candidates: evento iniciado rechazado', (res.by_reason.event_started || 0) >= 1, JSON.stringify(res.by_reason));
    ok('candidates: evento live rechazado', (res.by_reason.live || 0) >= 1);
    ok('candidates: equipos no resueltos contados', (res.by_reason.home_unresolved || 0) >= 1);
    // review queue poblada, SIN mappings aprobados (auto-match OFF)
    ok('review queue: tiene pendientes sportsbook', (await q(`SELECT count(*)::int n FROM mapping_review_queue WHERE provider_a='the_odds_api' AND status='pending'`)).rows[0].n >= 1);
    ok('auto-match OFF: 0 event mappings matched', (await q(`SELECT count(*)::int n FROM provider_event_mappings WHERE mapping_status='matched'`)).rows[0].n === 0);

    // defensa: auto-match forzado → error
    let forb = null; try { await SC.generateCandidates('the_odds_api', { autoMatch: true }); } catch (e) { forb = e; }
    ok('auto-match: prohibido en esta fase', forb && forb.code === 'auto_match_forbidden');

    // APROBACIÓN MANUAL del evento válido → crea canonical_event + enlaza quotes
    const appr = await SC.approveEvent('ev_valid', { reviewedBy: 'admin', now: NOW });
    ok('approve: crea canonical_event (Spain vs Brazil)', appr.canonical_event_id && appr.home === 'Spain' && appr.away === 'Brazil', JSON.stringify(appr));
    ok('approve: enlaza canonical_event_id en current', (await q(`SELECT count(*)::int n FROM sportsbook_quote_current WHERE external_event_id='ev_valid' AND canonical_event_id IS NOT NULL`)).rows[0].n === 9);
    ok('approve: registra event mapping matched', (await q(`SELECT count(*)::int n FROM provider_event_mappings WHERE mapping_status='matched'`)).rows[0].n === 1);

    // re-generar: el evento ya enlazado se salta
    const res2 = await SC.generateCandidates('the_odds_api', { now: NOW, autoMatch: false });
    ok('re-generate: evento enlazado se salta', res2.linked_skipped >= 1, JSON.stringify(res2));

    console.log(`\n[post-shadow-canonical-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
