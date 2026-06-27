// tests/post-shadow-o1-db.test.js — Fase O.1 (DB): migración 037 (venues + federation + weather venue cols).
'use strict';
process.env.DB_SSL = 'false';
const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const h = await boot();
  const client = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const q = (s, p = []) => client.query(s, p);
  const tbl = async () => (await q(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('canonical_venues','federation_mappings','event_venue_resolution')`)).rows[0].n;
  try {
    await migrate.up();
    ok('UP: 3 tablas O.1', (await tbl()) === 3);
    ok('weather_snapshots tiene venue_exact/venue_id/weather_status', (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='weather_snapshots' AND column_name IN ('venue_id','venue_exact','weather_status')`)).rows[0].n === 3);
    let rolls = 0; while ((await tbl()) > 0 && rolls < 6) { await migrate.rollback(); rolls++; }
    ok('DOWN: tablas O.1 desaparecen', (await tbl()) === 0);
    ok('DOWN: columnas venue revertidas', (await q(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='weather_snapshots' AND column_name='venue_exact'`)).rows[0].n === 0);
    await migrate.up();
    ok('RE-UP: vuelven', (await tbl()) === 3);

    // canonical_venues + resolución
    const v = (await q(`INSERT INTO canonical_venues (canonical_name,aliases,city,country,latitude,longitude,timezone,source,verified_at) VALUES ('Lincoln Financial Field',$1,'Philadelphia','USA',39.9008,-75.1675,'America/New_York','seed',now()) RETURNING venue_id`, [JSON.stringify(['Lincoln Financial', 'Philadelphia Stadium'])])).rows[0].venue_id;
    ok('canonical_venue insertado con coords', !!v);
    const ev = (await q(`INSERT INTO canonical_events (event_type,home_participant,away_participant,scheduled_start,status,competition) VALUES ('match','Croatia','Ghana','2026-07-01T18:00:00Z','scheduled','FIFA World Cup') RETURNING id`)).rows[0].id;
    await q(`INSERT INTO event_venue_resolution (canonical_event_id,venue_id,espn_venue_name,match_confidence,match_method,status) VALUES ($1,$2,'Lincoln Financial Field',1.0,'name_exact','resolved')`, [ev, v]);
    ok('event_venue_resolution resuelto', (await q(`SELECT status FROM event_venue_resolution WHERE canonical_event_id=$1`, [ev])).rows[0].status === 'resolved');
    // weather con venue exacto vs sin venue (representativo = no elegible)
    await q(`INSERT INTO weather_snapshots (canonical_event_id,venue,venue_id,venue_exact,weather_status,apparent_c,weather_factors,input_hash) VALUES ($1,'Lincoln Financial Field',$2,true,'AVAILABLE',34,$3,'wx-exact')`, [ev, v, JSON.stringify(['EXTREME_HEAT'])]);
    const exact = (await q(`SELECT count(*)::int n FROM weather_snapshots WHERE venue_exact=true`)).rows[0].n;
    ok('weather con venue_exact contabilizado', exact === 1);

    console.log('\n§O.1 INVARIANTES');
    const inv = (await q(`SELECT (SELECT count(*) FROM signals)::int s,(SELECT count(*) FROM internal_picks)::int p`)).rows[0];
    ok('no toca Signals/Picks', inv.s === 0 && inv.p === 0);
    console.log(`\n[post-shadow-o1-db] ${pass} pass, ${fail} fail`);
  } catch (e) { fail++; console.error('ERROR', e.message, e.stack); }
  finally { try { await client.close(); } catch {} await h.stop(); process.exit(fail ? 1 : 0); }
})();
