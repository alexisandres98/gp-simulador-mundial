// scripts/clubs-af-datapass.js — DATA PASS vía API-FOOTBALL (13-ago, paridad total parte 2).
// Genera results-<liga>.json y player-history-<liga>.json (MISMO formato que el backfill TSA) desde
// fixtures + fixtures/players de AF, y los SUBE al disco persistente de prod vía /api/internal/clubs-data.
// Con eso las ligas AF-fit y las COPAS tienen: forma/H2H, goals-fit, xG observado, match intel (goleadores),
// percentiles/scout/props del player-intel — el mismo nivel de inteligencia que Liga MX.
//
// Resolución de equipos: tm_af<id> directo (ligas AF-fit) → af-team-map de prod invertido (copas: el club
// vive en su liga doméstica) → match por nombre contra ratings.json. Sin resolución limpia, se omite.
//
// Uso: API_FOOTBALL_KEY=xxx GP_EXPORT_KEY=xxx [GP_BASE=https://gpsimulador.com] node scripts/clubs-af-datapass.js [liga ...]
'use strict';
const fs = require('fs');
const path = require('path');

const AFK = process.env.API_FOOTBALL_KEY || '';
const XK = process.env.GP_EXPORT_KEY || '';
const BASE = process.env.GP_BASE || 'https://gpsimulador.com';
if (!AFK) { console.error('Falta API_FOOTBALL_KEY'); process.exit(1); }

const PASS = [
  { key: 'saudi', af: 307, seasons: [2025, 2026] },
  { key: 'aleague', af: 188, seasons: [2025] },
  { key: 'libertadores', af: 13, seasons: [2026] },
  { key: 'sudamericana', af: 11, seasons: [2026] },
  { key: 'leaguescup', af: 772, seasons: [2026] },
];
const only = process.argv.slice(2);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function af(q) {
  const r = await fetch(`https://v3.football.api-sports.io/${q}`, { headers: { 'x-apisports-key': AFK }, signal: AbortSignal.timeout(25000) });
  const j = await r.json().catch(() => null);
  return (j && j.response) || [];
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(fc|cf|cd|club|deportivo|sc|ac|afc|de|the)\b/g, '').replace(/[^a-z0-9]/g, '');

(async () => {
  const RT = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'clubs', 'ratings.json'), 'utf8'));
  // af-team-map de prod invertido: af_id → tm_ (los tm_ son globales entre ligas)
  let inv = {};
  try {
    const r = await fetch(`${BASE}/api/internal/clubs-data?key=${XK}&name=af-team-map.json`);
    const m = await r.json();
    for (const lg of Object.keys(m)) for (const [tm, e] of Object.entries(m[lg])) if (e && e.af_id && !inv[e.af_id]) inv[e.af_id] = tm;
    console.log(`af-team-map: ${Object.keys(inv).length} equipos invertidos`);
  } catch (e) { console.log('af-team-map no disponible:', e.message); }

  for (const P of PASS) {
    if (only.length && !only.includes(P.key)) continue;
    const L = (RT.leagues || {})[P.key] || { ratings: {} };
    const nameIdx = {}; for (const [tid, t] of Object.entries(L.ratings || {})) nameIdx[norm(t.name)] = tid;
    const resolveTm = (afId, name) => {
      if (L.ratings[`tm_af${afId}`]) return `tm_af${afId}`;
      if (inv[afId]) return inv[afId];
      const n = norm(name); if (nameIdx[n]) return nameIdx[n];
      for (const k of Object.keys(nameIdx)) if (k && n && (k.includes(n) || n.includes(k))) return nameIdx[k];
      return null;
    };
    // 1) RESULTS — mismo formato del backfill TSA {id,date,home_id,away_id,hg,ag,winner}
    const results = []; const finished = [];
    for (const sn of P.seasons) {
      const fxs = await af(`fixtures?league=${P.af}&season=${sn}`);
      for (const fx of fxs) {
        const st = fx.fixture && fx.fixture.status && fx.fixture.status.short;
        if (!['FT', 'AET', 'PEN'].includes(st)) continue;
        const th = fx.teams.home, ta = fx.teams.away;
        const hId = resolveTm(th.id, th.name), aId = resolveTm(ta.id, ta.name);
        if (!hId || !aId) continue;
        const hg = num(fx.goals.home), ag = num(fx.goals.away);
        if (hg == null || ag == null) continue;
        results.push({ id: 'af-' + fx.fixture.id, date: fx.fixture.date, home_id: hId, away_id: aId, hg, ag, winner: hg > ag ? hId : ag > hg ? aId : null });
        finished.push({ fid: fx.fixture.id, date: fx.fixture.date });
      }
      await sleep(300);
    }
    console.log(`[${P.key}] results: ${results.length}`);
    // 2) PLAYER-HISTORY — /fixtures/players por partido, filas formato TSA (xg/npxg/xa/touches: AF no los da → null/0)
    const rows = [];
    let done = 0;
    for (const f of finished) {
      const resp = await af(`fixtures/players?fixture=${f.fid}`);
      for (const side of resp) {
        const tmId = resolveTm(side.team && side.team.id, side.team && side.team.name);
        if (!tmId) continue;
        for (const pl of side.players || []) {
          const g = (pl.statistics && pl.statistics[0]) || {};
          const gm = g.games || {}, sh = g.shots || {}, gl = g.goals || {}, pa = g.passes || {}, cd = g.cards || {}, fl = g.fouls || {};
          const min = num(gm.minutes) || 0;
          if (!min) continue;
          rows.push({
            match: 'af-' + f.fid, date: f.date, league: P.key,
            pid: 'afp' + pl.player.id, name: pl.player.name, team: tmId, pos: gm.position ? String(gm.position).slice(0, 1) : null,
            min, started: gm.substitute === false, rating: num(gm.rating),
            goals: num(gl.total) || 0, shots: num(sh.total) || 0, sot: num(sh.on) || 0,
            xg: null, npxg: null, xa: null, big_chances: 0,
            assists: num(gl.assists) || 0, key_passes: num(pa.key) || 0,
            passes: num(pa.total) || 0, passes_acc: num(pa.accuracy) || 0,
            crosses: 0, touches: 0, fouls: num(fl.committed) || 0,
            yc: num(cd.yellow) || 0, rc: num(cd.red) || 0,
          });
        }
      }
      done++;
      if (done % 50 === 0) console.log(`  [${P.key}] players: ${done}/${finished.length} partidos…`);
      await sleep(220);
    }
    console.log(`[${P.key}] player-history: ${rows.length} filas de ${finished.length} partidos`);
    // 3) SUBIR a prod (y copia local en data/clubs para dev)
    const up = async (name, obj) => {
      const body = JSON.stringify(obj);
      try { fs.writeFileSync(path.join(__dirname, '..', 'data', 'clubs', name), body); } catch { /* dev-only */ }
      if (!XK) { console.log(`  (sin GP_EXPORT_KEY: ${name} solo local)`); return; }
      const r = await fetch(`${BASE}/api/internal/clubs-data?key=${XK}&name=${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const j = await r.json().catch(() => null);
      console.log(`  → prod ${name}: ${r.status} ${(j && j.bytes) || ''}b`);
    };
    await up(`results-${P.key}.json`, { league: P.key, rows: results });
    await up(`player-history-${P.key}.json`, { league: P.key, rows, done: Object.fromEntries(finished.map(f => ['af-' + f.fid, true])) });
  }
  console.log('data pass AF completo');
})();
