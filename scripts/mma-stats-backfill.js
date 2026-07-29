#!/usr/bin/env node
// mma-stats-backfill.js — R4 (29-jul): stats finas de api-sports API-MMA (plan PRO activado).
// Verificado 29-jul con la key: /fights/statistics/fighters?id= devuelve POR PELEADOR strikes
// head/body/legs (total+power), takedowns attempt/landed, submissions, control_time, knockdowns.
// Cobertura de su base: 2022-01 → hoy (era moderna). El histórico viejo sigue siendo ESPN.
//   Paso 1: /fights?date= día a día 2022-01-01→hoy (~1.3k req) → catálogo de peleas (id, fecha, nombres).
//   Paso 2: /fights/statistics/fighters?id= por pelea (~1 req/pelea).
// Salida: data/combat/afstats-mma.json { fights:[{id,date,slug,f1,f2}], stats:{fightId:[{fighter,strikes..}]}, done:[] }
// Idempotente/re-ejecutable (done-set). Educado: 180ms entre requests (~330/min, bajo el límite del PRO).
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'combat', 'afstats-mma.json');
const KEY = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
if (!KEY) { console.error('sin API_FOOTBALL_KEY'); process.exit(1); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const arg = (k, d) => { const m = process.argv.find(a => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };

function load() { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return { fights: [], stats: {}, done_days: [], done_stats: [] }; } }
function save(db) { fs.writeFileSync(OUT, JSON.stringify(db)); }

async function j(p, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch('https://v1.mma.api-sports.io' + p, { headers: { 'x-apisports-key': KEY }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { await sleep(20000); continue; } // límite por minuto → espera larga
      const out = await r.json();
      if (out && out.errors && Object.keys(out.errors).length && !Array.isArray(out.errors)) {
        const es = JSON.stringify(out.errors);
        if (/rate|limit/i.test(es)) { await sleep(20000); continue; }
        throw new Error(es.slice(0, 120));
      }
      return out;
    } catch (e) { if (i === tries - 1) throw e; await sleep(2500 * (i + 1)); }
  }
}

async function step1(fromStr) {
  const db = load();
  const doneDays = new Set(db.done_days || []);
  const byId = new Set(db.fights.map(f => f.id));
  const from = new Date(fromStr);
  const today = new Date();
  let d = new Date(from), n = 0;
  while (d <= today) {
    const ds = d.toISOString().slice(0, 10);
    d = new Date(+d + 864e5);
    if (doneDays.has(ds)) continue;
    let out;
    try { out = await j('/fights?date=' + ds); } catch (e) { console.error('[step1]', ds, e.message); continue; }
    for (const f of (out.response || [])) {
      if (byId.has(f.id)) continue;
      const fighters = f.fighters || {};
      db.fights.push({
        id: f.id, date: (f.date || ds).slice(0, 10), slug: f.slug || (f.league && f.league.name) || null,
        category: f.category || null, is_main: !!f.is_main,
        f1: { id: (fighters.first || {}).id, name: (fighters.first || {}).name, winner: !!(fighters.first || {}).winner },
        f2: { id: (fighters.second || {}).id, name: (fighters.second || {}).name, winner: !!(fighters.second || {}).winner },
        status: (f.status || {}).short || null,
      });
      byId.add(f.id);
    }
    doneDays.add(ds); n++;
    if (n % 50 === 0) { db.done_days = [...doneDays]; save(db); console.log('[step1]', ds, 'días:', n, 'peleas:', db.fights.length); }
    await sleep(180);
  }
  db.done_days = [...doneDays]; save(db);
  console.log('[step1] FIN — peleas:', db.fights.length);
}

async function step2() {
  const db = load();
  const done = new Set(db.done_stats || []);
  const todo = db.fights.filter(f => !done.has(f.id) && f.status !== 'CANC');
  console.log('[step2] stats pendientes:', todo.length);
  let n = 0, got = 0;
  for (const f of todo) {
    try {
      const out = await j('/fights/statistics/fighters?id=' + f.id);
      if ((out.response || []).length) { db.stats[f.id] = out.response; got++; }
      done.add(f.id);
    } catch (e) { console.error('[step2]', f.id, e.message); }
    n++;
    if (n % 100 === 0) { db.done_stats = [...done]; save(db); console.log('[step2]', n + '/' + todo.length, '(con stats:', got + ')'); }
    await sleep(180);
  }
  db.done_stats = [...done]; save(db);
  console.log('[step2] FIN:', n, 'procesadas,', got, 'con stats');
}

(async () => {
  const step = arg('step', 'all');
  const from = arg('from', '2022-01-01');
  if (step === '1' || step === 'all') await step1(from);
  if (step === '2' || step === 'all') await step2();
  console.log('[mma-stats-backfill] FIN');
})();
