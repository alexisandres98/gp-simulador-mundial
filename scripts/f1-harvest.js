// scripts/f1-harvest.js — LA MEMORIA DE CARRERA PROPIA (blueprint 7.0 F-0081+): Jolpica-F1 (CC BY 4.0)
//
// Baja resultados + clasificación 2014→2026 y el calendario vigente, y los reduce EN LA MISMA PASADA
// a la base compacta que viaja en el repo (los crudos no se versionan):
//   data/f1/races.json  — por carrera: ronda, circuito, fecha + por piloto: parrilla, final, estado,
//                         puntos, quali (posición) — la materia del Coche×Piloto y del gemelo.
//   data/f1/schedule.json — calendario 2026 con fechas/circuitos (la agenda del producto).
//   data/f1/meta.json   — lineage, conteos, frescura.
//
// Educado con la tasa pública de Jolpica: limit=100, ~350ms entre páginas, reintentos con espera.
// USO: node scripts/f1-harvest.js [--since=2014]
'use strict';

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'f1');
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const SINCE = +arg('since', 2014);
const NOW_YEAR = new Date().getUTCFullYear();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jget(pathQ) {
  let last = null;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch('https://api.jolpi.ca/ergast/f1/' + pathQ, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'GP-Simulador/1.0 (codigo@gpsimulador.com)' } });
      if (r.status === 429) { await sleep(20e3 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return (await r.json()).MRData;
    } catch (e) { last = e; await sleep(5e3 * (i + 1)); }
  }
  throw last;
}

async function pageAll(mk, pick) {
  const rows = [];
  for (let offset = 0; ; offset += 100) {
    const d = await jget(mk(offset));
    const part = pick(d);
    rows.push(...part);
    if (offset + 100 >= +d.total || !part.length) break;
    await sleep(350);
  }
  return rows;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const races = {}; // key season|round → {season, round, name, circuit, cid, date, rows: {driverId: {...}}}
  const drivers = {}, constructors = {};
  const keyOf = (s, r) => s + '|' + r;

  for (let y = SINCE; y <= NOW_YEAR; y++) {
    const res = await pageAll((o) => `${y}/results.json?limit=100&offset=${o}`, (d) => d.RaceTable.Races);
    for (const rc of res) {
      const k = keyOf(rc.season, rc.round);
      const R = races[k] = races[k] || { season: +rc.season, round: +rc.round, name: rc.raceName, cid: rc.Circuit.circuitId, circuit: rc.Circuit.circuitName, country: (rc.Circuit.Location || {}).country || null, date: rc.date, rows: {} };
      for (const x of rc.Results || []) {
        const did = x.Driver.driverId;
        drivers[did] = { id: did, code: x.Driver.code || null, name: `${x.Driver.givenName} ${x.Driver.familyName}`, country: x.Driver.nationality || null, dob: x.Driver.dateOfBirth || null };
        const cid2 = x.Constructor.constructorId;
        constructors[cid2] = { id: cid2, name: x.Constructor.name };
        R.rows[did] = {
          d: did, c: cid2, grid: +x.grid || null, pos: /^\d+$/.test(x.positionText) ? +x.position : null,
          txt: x.positionText, status: x.status || null, pts: +x.points || 0, laps: +x.laps || 0, q: null,
        };
      }
    }
    const qu = await pageAll((o) => `${y}/qualifying.json?limit=100&offset=${o}`, (d) => d.RaceTable.Races);
    for (const rc of qu) {
      const R = races[keyOf(rc.season, rc.round)];
      if (!R) continue;
      for (const x of rc.QualifyingResults || []) {
        const row = R.rows[x.Driver.driverId];
        if (row) row.q = +x.position || null;
      }
    }
    console.log(`[f1] ${y}: ${res.length} carreras con resultado`);
    await sleep(500);
  }

  const sched = await jget(`${NOW_YEAR}.json?limit=100`);
  const schedule = (sched.RaceTable.Races || []).map((rc) => ({
    season: +rc.season, round: +rc.round, name: rc.raceName, cid: rc.Circuit.circuitId,
    circuit: rc.Circuit.circuitName, country: (rc.Circuit.Location || {}).country || null,
    locality: (rc.Circuit.Location || {}).locality || null,
    date: rc.date, time: rc.time || null,
    quali: rc.Qualifying ? rc.Qualifying.date + (rc.Qualifying.time ? 'T' + rc.Qualifying.time : '') : null,
    sprint: rc.Sprint ? rc.Sprint.date : null,
  }));

  const list = Object.values(races).sort((a, b) => (a.season - b.season) || (a.round - b.round));
  const lastDone = list.filter((r) => Object.values(r.rows).some((x) => x.pos != null)).slice(-1)[0];
  fs.writeFileSync(path.join(OUT, 'races.json'), JSON.stringify({ source: 'Jolpica-F1 (CC BY 4.0)', races: list, drivers, constructors }));
  fs.writeFileSync(path.join(OUT, 'schedule.json'), JSON.stringify({ source: 'Jolpica-F1 (CC BY 4.0)', season: NOW_YEAR, races: schedule }));
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
    built_at: new Date().toISOString(), source: 'Jolpica-F1 (api.jolpi.ca), datos CC BY 4.0 — atribución obligatoria',
    window: `${SINCE}-${NOW_YEAR}`, races: list.length, drivers: Object.keys(drivers).length,
    last_completed: lastDone ? { season: lastDone.season, round: lastDone.round, name: lastDone.name, date: lastDone.date } : null,
  }, null, 1));
  console.log(`[f1] LISTO: ${list.length} carreras · ${Object.keys(drivers).length} pilotos · última completada: ${lastDone && lastDone.name} ${lastDone && lastDone.date}`);
})().catch((e) => { console.error('[f1] FALLO:', e.message); process.exit(1); });
