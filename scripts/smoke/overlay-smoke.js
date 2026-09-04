#!/usr/bin/env node
'use strict';
// scripts/smoke/overlay-smoke.js — humo del patrón BASE DEL REPO + OVERLAY EN DISCO.
//
// POR QUÉ EXISTE. El 4-sep, auditando si cada deporte incorpora solo los resultados, aparecieron dos que no:
// baloncesto y NFL leían únicamente el directorio del repo, que se recongela en cada deploy. La WNBA estaba
// clavada en el 15-ago estando en playoffs y la NFL iba a sacar el 9-sep con base del 17-ago. El arreglo es
// el patrón que ya usaban F1 y fútbol americano universitario: histórico versionado en el repo + overlay en
// el disco persistente que MANDA. Este humo comprueba las tres cosas que tienen que ser ciertas:
//   1. sin overlay, todo sigue exactamente igual que antes (no romper lo que funciona);
//   2. un dato nuevo del overlay ENTRA;
//   3. un dato del overlay que ya existía en el repo lo PISA, y no se duplica.
//
//   node scripts/smoke/overlay-smoke.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let ok = 0, ko = 0;
const t = (n, c, extra) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };
const frescos = (m) => { for (const k of Object.keys(require.cache)) if (k.includes(m)) delete require.cache[k]; };

// ── BALONCESTO ──────────────────────────────────────────────────────────────────────────────────────────
{
  console.log('\n── baloncesto: repo + overlay ──────────────────────────────────────');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-hoops-'));
  process.env.DB_FILE = path.join(TMP, 'db.json');
  frescos('basketball-engine'); delete global._hoops;
  const S0 = require(path.join(ROOT, 'basketball-engine', 'store'));
  const base = S0.load('wnba', { force: true });
  t('sin overlay carga la base del repo', base && base.games.length > 0, base && base.games.length);
  const nRepo = base.games.length;
  const primero = base.games[0];

  fs.mkdirSync(path.join(TMP, 'hoops'), { recursive: true });
  const corregido = { ...primero, pace: 77.7 };
  fs.writeFileSync(path.join(TMP, 'hoops', 'games-wnba-2026.json'), JSON.stringify({
    league: 'wnba', season: 2026,
    games: { 999999: { id: '999999', date: '2026-09-01', league: 'wnba', home: { id: 'x' }, away: { id: 'y' }, pace: 100 },
      [primero.id]: corregido },
  }));
  frescos('basketball-engine'); delete global._hoops;
  const S1 = require(path.join(ROOT, 'basketball-engine', 'store'));
  const con = S1.load('wnba', { force: true });
  t('el partido NUEVO del overlay entra', con.games.some((g) => String(g.id) === '999999'));
  t('el partido corregido PISA al del repo', con.games.some((g) => g.pace === 77.7));
  t('no se duplica ninguno', con.games.length === nRepo + 1
    && new Set(con.games.map((g) => String(g.id))).size === con.games.length, { antes: nRepo, ahora: con.games.length });
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* da igual */ }
}

// ── NFL ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  console.log('\n── NFL: repo + agregado del disco ──────────────────────────────────');
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-nfl-'));
  process.env.DB_FILE = path.join(TMP, 'db.json');
  frescos('nfl-engine'); delete global._nfldata;
  const D0 = require(path.join(ROOT, 'nfl-engine', 'data'));
  const b = D0.load();
  t('sin overlay carga la base del repo', b.available && b.games.length > 0, b.games.length);
  const nRepo = b.games.length, nTw = b.tw.length;
  const r0 = D0.ratings(b);
  t('el rating sale de los márgenes de esa base', r0.n > 0, r0.n);

  // el agregado del disco trae UN partido más de la temporada nueva, con resultado
  fs.mkdirSync(path.join(TMP, 'nfl-agg'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'nfl-agg', 'games.json'), JSON.stringify({
    at: new Date().toISOString(), current_season: 2026,
    games: b.games.concat([{ season: 2026, week: 1, date: '2026-09-11', home: 'KC', away: 'BUF', result: 7, type: 'REG', location: 'Home' }]),
  }));
  frescos('nfl-engine'); delete global._nfldata;
  const D1 = require(path.join(ROOT, 'nfl-engine', 'data'));
  const c = D1.load();
  t('el agregado del disco manda sobre el del repo', c.games.length === nRepo + 1, { antes: nRepo, ahora: c.games.length });
  t('el partido nuevo está y con su margen', c.games.some((g) => g.date === '2026-09-11' && g.result === 7));
  t('los ficheros que el disco NO trae siguen saliendo del repo', c.tw.length === nTw, { repo: nTw, ahora: c.tw.length });
  const r1 = D1.ratings(c);
  t('y el rating lo incorpora (n sube)', r1.n === r0.n + 1, { antes: r0.n, ahora: r1.n });
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* da igual */ }
}

// ── los cosechadores saben escribir al disco ────────────────────────────────────────────────────────────
{
  console.log('\n── los cosechadores apuntan al disco con --out=disk ────────────────');
  const hb = fs.readFileSync(path.join(ROOT, 'scripts', 'hoops-backfill.js'), 'utf8');
  t('hoops-backfill acepta --out=disk', /AL_DISCO/.test(hb) && /out.*disk/.test(hb));
  t('hoops-backfill escribe atómico', /renameSync/.test(hb));
  const nh = fs.readFileSync(path.join(ROOT, 'scripts', 'nfl-harvest.js'), 'utf8');
  t('nfl-harvest acepta --out=disk', /AL_DISCO/.test(nh) && /--out=disk/.test(nh));
  const hf = fs.readFileSync(path.join(ROOT, 'scripts', 'hoops-fit.js'), 'utf8');
  t('el re-ajuste de hoops lee repo + disco', /DISK_DIR/.test(hf) && /REPO_DIR/.test(hf));
  const sv = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  t('hay trabajo diario de baloncesto', /hoopsHarvestJob/.test(sv) && /--out=disk/.test(sv));
  t('hay trabajo diario de NFL', /nflHarvestJob/.test(sv));
}

console.log(`\n${ok} comprobaciones en verde, ${ko} en rojo.`);
process.exit(ko ? 1 : 0);
