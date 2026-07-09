// scripts/fotmob-backfill.js — Backfill de event data del Mundial 2026 desde FotMob (shotmaps con situación
// + momentum) → data/fotmob-events.json. RESUMIBLE e idempotente: los partidos ya guardados no se re-piden;
// re-correrlo tras cada jornada agrega solo lo nuevo. Ritmo educado (~2.5s/req, hereda del provider).
// Uso: node scripts/fotmob-backfill.js [--from 20260611] [--to 20260709]
'use strict';
const fs = require('fs');
const path = require('path');
const fotmob = require('../data-providers/fotmob');

const OUT = path.join(__dirname, '..', 'data', 'fotmob-events.json');

function dateRange(from, to) {
  const out = [];
  const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)));
  const end = new Date(Date.UTC(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8)));
  while (d <= end) { out.push(d.toISOString().slice(0, 10).replace(/-/g, '')); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

(async () => {
  const args = process.argv.slice(2);
  const arg = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const from = arg('--from') || '20260611';
  const to = arg('--to') || new Date().toISOString().slice(0, 10).replace(/-/g, '');

  let store = { _meta: { source: 'fotmob', league_id: fotmob.WC_LEAGUE_ID }, matches: [] };
  if (fs.existsSync(OUT)) { try { store = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* re-crear */ } }
  const have = new Set(store.matches.map(m => m.matchId));

  let found = 0, fetched = 0, failed = 0;
  for (const date of dateRange(from, to)) {
    const list = await fotmob.matchesByDate(date).catch(() => []);
    const done = list.filter(m => m.finished);
    found += done.length;
    for (const m of done) {
      if (have.has(m.matchId)) continue;
      const ev = await fotmob.matchEvents(m.matchId).catch(() => null);
      if (!ev || !ev.shots.length) { failed++; console.log(`  ✗ ${date} ${m.home}-${m.away} (${m.matchId}) sin data`); continue; }
      ev.date = date;
      store.matches.push(ev);
      have.add(m.matchId);
      fetched++;
      console.log(`  ✓ ${date} ${ev.homeCode || ev.home}-${ev.awayCode || ev.away}: ${ev.shots.length} remates`);
      // checkpoint incremental: si el proceso muere, lo hecho queda
      fs.writeFileSync(OUT, JSON.stringify(store));
    }
  }
  store._meta.updated_at = new Date().toISOString();
  store._meta.matches = store.matches.length;
  fs.writeFileSync(OUT, JSON.stringify(store));
  console.log(`\nfotmob-backfill: ${found} terminados vistos, ${fetched} nuevos, ${failed} fallidos, total ${store.matches.length} → ${OUT}`);
})();
