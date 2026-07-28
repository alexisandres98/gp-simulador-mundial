#!/usr/bin/env node
// combat-backfill.js — F0 de Combat Sports (27-jul): histórico UFC completo desde ESPN.
//   Paso 1 (rápido):  scoreboard por año 1997→hoy → eventos + peleas (winners, rounds, weight class)
//   Paso 2 (lento):   método de victoria por pelea (core status, 1 req/pelea, throttle educado)
//   Paso 3 (lento):   perfiles de peleadores (bio: alcance/altura/stance/dob + headshot + récord)
// Salida: data/combat/fights-<suffix>.json + fighters-<suffix>.json. Idempotente (done-sets); re-ejecutable.
// Uso: node scripts/combat-backfill.js [--step=1|2|3|all] [--from=1997] [--league=ufc] [--suffix=<league>]
// F5 MMA (27-jul): --league acepta lista (bellator,pfl) y --suffix=mma mergea promociones en un dataset
// (comp_ids únicos, athlete ids COMPARTIDOS entre ligas ESPN → Elo cross-promotion). Default = UFC idéntico.
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'combat');
fs.mkdirSync(OUT, { recursive: true });
const LEAGUES = (process.argv.find(a => a.startsWith('--league=')) || '--league=ufc').split('=')[1].split(',');
const SUFFIX = (process.argv.find(a => a.startsWith('--suffix=')) || ('--suffix=' + LEAGUES[0])).split('=')[1];
const FIGHTS_F = path.join(OUT, `fights-${SUFFIX}.json`);
const FIGHTERS_F = path.join(OUT, `fighters-${SUFFIX}.json`);
const UA = 'Mozilla/5.0 (compatible; GPSimulador/1.0)';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const arg = (k, d) => { const m = process.argv.find(a => a.startsWith('--' + k + '=')); return m ? m.split('=')[1] : d; };

function load(f, empty) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return empty; } }
function save(f, obj) { fs.writeFileSync(f, JSON.stringify(obj)); }

async function j(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (i === tries - 1) throw e; await sleep(1200 * (i + 1)); }
  }
}

// ---------- Paso 1: eventos + peleas por año ----------
async function step1(fromYear, league) {
  const db = load(FIGHTS_F, { fights: [], events: {}, method_done: [] });
  const byId = new Set(db.fights.map(f => f.comp_id));
  const thisYear = new Date().getUTCFullYear();
  for (let y = fromYear; y <= thisYear; y++) {
    const d = await j(`https://site.api.espn.com/apis/site/v2/sports/mma/${league}/scoreboard?dates=${y}0101-${y}1231&limit=200`);
    const evs = (d && d.events) || [];
    let added = 0;
    for (const e of evs) {
      db.events[e.id] = { id: e.id, name: e.name, date: e.date, venue: ((e.competitions || [])[0] || {}).venue ? undefined : undefined };
      for (const c of (e.competitions || [])) {
        if (byId.has(c.id)) continue;
        const comp = (c.competitors || []);
        if (comp.length !== 2) continue;
        const f1 = comp.find(x => x.order === 1) || comp[0];
        const f2 = comp.find(x => x.order === 2) || comp[1];
        const st = c.status || {};
        db.fights.push({
          comp_id: c.id, event_id: e.id, event: e.name, date: c.date || e.date, lg: league !== 'ufc' ? league : undefined,
          weight: (c.type || {}).abbreviation || null,
          rounds_sched: ((c.format || {}).regulation || {}).periods || null,
          f1: { id: f1.id, name: (f1.athlete || {}).displayName || null, winner: !!f1.winner },
          f2: { id: f2.id, name: (f2.athlete || {}).displayName || null, winner: !!f2.winner },
          end_round: st.period || null, end_clock: st.displayClock || null,
          completed: !!((st.type || {}).completed), method: null,
        });
        byId.add(c.id); added++;
      }
    }
    console.log(`[step1] ${y}: eventos=${evs.length} peleas_nuevas=${added} total=${db.fights.length}`);
    save(FIGHTS_F, db);
    await sleep(400);
  }
}

// ---------- Paso 2: método por pelea (core status) ----------
async function step2() {
  const db = load(FIGHTS_F, null);
  if (!db) { console.error('sin fights-ufc.json — corré step1'); return; }
  const done = new Set(db.method_done || []);
  const todo = db.fights.filter(f => f.completed && !f.method && !done.has(f.comp_id));
  console.log(`[step2] métodos pendientes: ${todo.length}`);
  let n = 0;
  for (const f of todo) {
    try {
      const st = await j(`https://sports.core.api.espn.com/v2/sports/mma/leagues/${f.lg || 'ufc'}/events/${f.event_id}/competitions/${f.comp_id}/status?lang=en`);
      const r = st && st.result;
      if (r) f.method = { id: r.id, name: r.name || null, display: r.displayName || null };
      done.add(f.comp_id);
    } catch { /* se reintenta en la próxima corrida */ }
    n++;
    if (n % 100 === 0) { db.method_done = [...done]; save(FIGHTS_F, db); console.log(`[step2] ${n}/${todo.length}`); }
    await sleep(220);
  }
  db.method_done = [...done]; save(FIGHTS_F, db);
  console.log(`[step2] listo: ${n} procesadas`);
}

// ---------- Paso 3: perfiles de peleadores ----------
async function step3() {
  const db = load(FIGHTS_F, null);
  if (!db) { console.error('sin fights — corré step1'); return; }
  const fighters = load(FIGHTERS_F, {});
  const ids = new Set();
  for (const f of db.fights) { if (f.f1.id) ids.add(f.f1.id); if (f.f2.id) ids.add(f.f2.id); }
  const todo = [...ids].filter(id => !fighters[id]);
  console.log(`[step3] peleadores únicos: ${ids.size} · pendientes: ${todo.length}`);
  let n = 0;
  for (const id of todo) {
    try {
      const d = await j(`https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes/${id}`);
      const a = (d && d.athlete) || d || {};
      fighters[id] = {
        id, name: a.displayName || a.fullName || null,
        nick: a.nickname || null,
        dob: a.dateOfBirth || null,
        height_in: a.displayHeight || a.height || null,
        weight_lb: a.displayWeight || a.weight || null,
        reach_in: a.displayReach || a.reach || null,
        stance: (a.stance || {}).text || a.stance || null,
        country: (a.citizenship || a.birthPlace && (a.birthPlace.country || null)) || null,
        flag: (a.flag || {}).href || null,
        headshot: (a.headshot || {}).href || null,
        assoc: (a.association || {}).name || null,
      };
    } catch { fighters[id] = { id, name: null, error: true }; }
    n++;
    if (n % 100 === 0) { save(FIGHTERS_F, fighters); console.log(`[step3] ${n}/${todo.length}`); }
    await sleep(220);
  }
  save(FIGHTERS_F, fighters);
  console.log(`[step3] listo: ${n} perfiles`);
}

(async () => {
  const step = arg('step', 'all');
  const from = parseInt(arg('from', '1997'), 10);
  if (step === '1' || step === 'all') for (const lg of LEAGUES) await step1(from, lg);
  if (step === '2' || step === 'all') await step2();
  if (step === '3' || step === 'all') await step3();
  console.log('[combat-backfill] FIN');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
