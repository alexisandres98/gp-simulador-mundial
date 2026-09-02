// scripts/lol-aggregate.js — DE LA COSECHA CRUDA A LOS AGREGADOS QUE VIAJAN EN EL REPO (18-ago).
//
// El crudo de jugadores (250k+ filas) no se versiona: pesa y el deploy no lo necesita. Lo que viaja es
// exactamente lo que el motor y las pantallas consumen — el mismo criterio que la base de CS2:
//   games.json          (ya slim de la cosecha; se queda tal cual: lo necesita la validación walk-forward)
//   player-stats.json   identidad + stats por jugador con rating GP normalizado POR ROL (LOL-0007: cada
//                       jugador se evalúa dentro de su rol) + bitácora reciente.
//   mastery.json        jugador × campeón con recencia (LOL-0198): n, victorias, peso reciente.
//   champions.json      posterior de campeón por PARCHE MAYOR × rol con encogimiento (LOL-0183) +
//                       presencia (pick+ban, LOL-0187) del parche vigente y el anterior.
//   comps.json          composición por partida (campeones por lado, parche, ganador) — el dataset de
//                       investigación del draft (LOL-0057: draft replay dataset).
//
// USO: node scripts/lol-aggregate.js [--raw-dir=data/esports/lol]
'use strict';

const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const DIR = path.resolve(arg('raw-dir', path.join(__dirname, '..', 'data', 'esports', 'lol')));
const OUTD = path.join(__dirname, '..', 'data', 'esports', 'lol');
// --base: además de los agregados, EMBARCA la base cruda (games.json.gz + drafts.json.gz) desde el crudo.
// Desde el 2-sep la base que viaja en el repo es la cosecha PROPIA de Leaguepedia (97.588 partidas 2020→hoy,
// kills/objetivos nativos, ids de Leaguepedia que casan con players y drafts), no el espejo de HuggingFace.
// --comps: escribe comps.json (dataset de investigación del draft, ~decenas de MB; nadie lo lee en runtime).
const SHIP_BASE = process.argv.includes('--base');
const WRITE_COMPS = process.argv.includes('--comps');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const wr = (f, o) => { fs.mkdirSync(OUTD, { recursive: true }); fs.writeFileSync(path.join(OUTD, f), JSON.stringify(o)); };
const majorPatch = (p) => { const m = String(p || '').match(/^(\d+)\.(\d+)/); return m ? `${m[1]}.${m[2]}` : null; };
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ROLE_CANON = { top: 'Top', jungle: 'Jungle', jgl: 'Jungle', mid: 'Mid', middle: 'Mid', bot: 'Bot', adc: 'Bot', bottom: 'Bot', support: 'Support', sup: 'Support' };

function main() {
  const G = rd('games.json'); const games = Object.values(G.rows);
  const gameIdx = new Map(games.map((g) => [g.id, g]));
  console.log(`[agg:lol] ${games.length} partidas`);

  // ── comps por partida (desde el scoreboard de jugadores: 5 campeones por lado) ─────────────────────────
  let P = { rows: {} };
  try { P = rd('players.json'); } catch { console.log('[agg:lol] sin players.json (se agrega luego)'); }
  const pRows = Object.values(P.rows || {});
  console.log(`[agg:lol] ${pRows.length} filas de jugador`);

  const comps = {};      // gameId -> {patch, blue:[5], red:[5], win:'blue'|'red', at}
  for (const r of pRows) {
    const g = gameIdx.get(r.g); if (!g || !r.ch) continue;
    const c = comps[r.g] = comps[r.g] || { patch: majorPatch(g.patch), at: g.at, blue: [], red: [], win: g.win === g.t1 ? 'blue' : 'red' };
    const sideBlue = String(r.side) === '1' || r.team === g.t1;
    (sideBlue ? c.blue : c.red).push(r.ch);
  }

  // ── stats de jugador por ROL + mastery ─────────────────────────────────────────────────────────────────
  const perPlayer = {};
  for (const r of pRows) {
    const g = gameIdx.get(r.g); if (!g) continue;
    const pid = slug(r.p); if (!pid) continue;
    const sideBlue = String(r.side) === '1' || r.team === g.t1;
    const teamKills = sideBlue ? g.k1 : g.k2;
    const pp = perPlayer[pid] = perPlayer[pid] || { id: pid, nick: r.p, rows: [] };
    pp.nick = r.p;
    pp.rows.push({ at: r.at || g.at, ch: r.ch, role: ROLE_CANON[String(r.role || '').toLowerCase()] || r.role || null,
      k: r.k, d: r.d, a: r.a, cs: r.cs, gold: r.gold, win: r.win,
      tk: teamKills != null ? teamKills : null, len: g.len || null, team: r.team || null, vs: sideBlue ? g.t2 : g.t1, side: sideBlue ? 'blue' : 'red' });
  }
  // ventana de recencia: últimos 365 días de la base (mastery y forma son features de recencia)
  const lastAt = games.reduce((m, g) => (g.at > m ? g.at : m), '');
  const cutoff = new Date(Date.parse(lastAt.replace(' ', 'T') + 'Z') - 365 * 864e5).toISOString().slice(0, 19).replace('T', ' ');

  const playerStats = {}; const mastery = {};
  const rolePop = {};   // por rol: arrays para normalizar (kp, kda, cspm, gpm)
  const half = 40;      // medio-vida en partidas del peso de recencia
  for (const pp of Object.values(perPlayer)) {
    const rows = pp.rows.filter((r) => r.at >= cutoff).sort((a, b) => (a.at < b.at ? -1 : 1));
    if (rows.length < 8) continue;
    const role = (() => { const c = {}; for (const r of rows) if (r.role) c[r.role] = (c[r.role] || 0) + 1;
      return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null; })();
    let k = 0, d = 0, a = 0, cs = 0, gold = 0, min = 0, w = 0, kpN = 0, kpS = 0, sideB = 0, wB = 0, nB = 0, wR = 0, nR = 0;
    for (const r of rows) {
      k += r.k || 0; d += r.d || 0; a += r.a || 0; cs += r.cs || 0; gold += r.gold || 0;
      min += (r.len || 32) ; w += r.win || 0;
      if (r.tk != null && r.tk > 0) { kpS += ((r.k || 0) + (r.a || 0)) / r.tk; kpN++; }
      if (r.side === 'blue') { nB++; wB += r.win || 0; } else { nR++; wR += r.win || 0; }
      const key = `${pp.id}|${r.ch}`;
      const m = mastery[key] = mastery[key] || { p: pp.id, ch: r.ch, n: 0, w: 0, rw: 0, last: null };
      m.n++; m.w += r.win || 0; m.last = r.at;
    }
    // peso reciente de mastery: recorrido inverso con medio-vida
    const byCh = {};
    rows.slice().reverse().forEach((r, i) => { const key = `${pp.id}|${r.ch}`; byCh[key] = (byCh[key] || 0) + Math.pow(0.5, i / half); });
    for (const [key, rw] of Object.entries(byCh)) if (mastery[key]) mastery[key].rw = +rw.toFixed(3);
    const team = rows[rows.length - 1].team || null;
    const st = {
      id: pp.id, nick: pp.nick, role, team, n: rows.length, wr: +(w / rows.length).toFixed(3),
      kda: +(((k + a) / Math.max(1, d))).toFixed(2),
      kp: kpN ? +(kpS / kpN).toFixed(3) : null,
      cspm: min ? +(cs / min).toFixed(2) : null,
      gpm: min ? +(gold / min).toFixed(0) : null,
      dpg: +(d / rows.length).toFixed(2),
      side_split: { blue_n: nB, blue_wr: nB ? +(wB / nB).toFixed(3) : null, red_n: nR, red_wr: nR ? +(wR / nR).toFixed(3) : null },
      champs: Object.values(mastery).filter((m) => m.p === pp.id).sort((x, y) => y.rw - x.rw).slice(0, 12)
        .map((m) => ({ ch: m.ch, n: m.n, w: m.w, rw: m.rw, last: m.last })),
      recent: rows.slice(-12).map((r) => ({ at: (r.at || '').slice(0, 10), ch: r.ch, vs: r.vs, k: r.k, d: r.d, a: r.a, win: r.win, side: r.side })),
    };
    playerStats[pp.id] = st;
    if (role) { const rp = rolePop[role] = rolePop[role] || []; rp.push(st); }
  }
  // rating GP normalizado POR ROL (z compuesta → escala 1.00 = media del rol, como el de CS2)
  const zOf = (arr, f) => { const xs = arr.map(f).filter((x) => x != null); const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length || 1)) || 1; return { m, sd }; };
  for (const [role, arr] of Object.entries(rolePop)) {
    const zKp = zOf(arr, (s) => s.kp), zKda = zOf(arr, (s) => Math.min(8, s.kda)), zCs = zOf(arr, (s) => s.cspm), zD = zOf(arr, (s) => s.dpg);
    for (const s of arr) {
      const z = 0.35 * ((s.kp != null ? s.kp : zKp.m) - zKp.m) / zKp.sd
        + 0.30 * (Math.min(8, s.kda) - zKda.m) / zKda.sd
        + 0.20 * ((s.cspm != null ? s.cspm : zCs.m) - zCs.m) / zCs.sd
        - 0.15 * (s.dpg - zD.m) / zD.sd;
      s.rating_gp = +(1 + 0.14 * z).toFixed(2);
    }
  }
  wr('player-stats.json', { at: new Date().toISOString(), rights_class: G.rights_class, window_days: 365,
    population: Object.keys(playerStats).length,
    formula: 'z por ROL = 0.35·kill participation + 0.30·KDA (tope 8) + 0.20·CS/min − 0.15·muertes/partida → rating 1.00 = media del rol, ±0.14 por z. Normalizar dentro del rol es LOL-0007: un support no compite con un mid en CS/min.',
    players: playerStats });
  console.log(`[agg:lol] player-stats: ${Object.keys(playerStats).length} jugadores cualificados (≥8 partidas en 365d)`);

  // ── posterior de campeón por parche mayor × rol + presencia ────────────────────────────────────────────
  const champRole = {};   // patch|role|ch -> {n,w} — el parche viene de la PARTIDA, no de la fila de jugador
  for (const r of pRows) {
    const g = gameIdx.get(r.g); if (!g || !r.ch) continue;
    const mp = majorPatch(g.patch); if (!mp) continue;
    const role = ROLE_CANON[String(r.role || '').toLowerCase()] || null; if (!role) continue;
    const key = `${mp}|${role}|${r.ch}`;
    const c = champRole[key] = champRole[key] || { patch: mp, role, ch: r.ch, n: 0, w: 0 };
    c.n++; c.w += r.win || 0;
  }
  // bans por parche (desde drafts si existen)
  let D = { rows: {} };
  try { D = rd('drafts.json'); } catch { console.log('[agg:lol] sin drafts.json'); }
  const bansByPatch = {};
  for (const d of Object.values(D.rows || {})) {
    const g = gameIdx.get(d.g); const mp = majorPatch(g && g.patch); if (!mp) continue;
    for (const ch of [].concat(d.b1 || [], d.b2 || [])) {
      const key = `${mp}|${ch}`;
      bansByPatch[key] = (bansByPatch[key] || 0) + 1;
    }
  }
  const gamesByPatch = {};
  for (const g of games) { const mp = majorPatch(g.patch); if (mp) gamesByPatch[mp] = (gamesByPatch[mp] || 0) + 1; }
  wr('champions.json', { at: new Date().toISOString(), rights_class: G.rights_class,
    shrink_k: 25,
    note: 'posterior por parche mayor × rol: wr encogida hacia 0.5 con K=25 picks (LOL-0183). La presencia junta pick+ban del parche (LOL-0187: el ban es información). Selección de pick-order NO controlada todavía (LOL-0186) y se declara.',
    games_by_patch: gamesByPatch,
    rows: Object.values(champRole),
    bans: Object.entries(bansByPatch).map(([k, n]) => { const [patch, ch] = k.split('|'); return { patch, ch, n }; }),
  });
  console.log(`[agg:lol] champions: ${Object.values(champRole).length} filas parche×rol×campeón · bans de ${Object.keys(D.rows || {}).length} drafts`);

  if (WRITE_COMPS) wr('comps.json', { at: new Date().toISOString(), rights_class: G.rights_class, rows: comps });
  else console.log(`[agg:lol] comps: ${Object.keys(comps).length} partidas con composición (no se escribe sin --comps)`);
  if (SHIP_BASE) {
    const zlib = require('zlib');
    fs.mkdirSync(OUTD, { recursive: true });
    for (const f of ['games.json', 'drafts.json']) {
      let raw; try { raw = fs.readFileSync(path.join(DIR, f)); } catch { console.log(`[agg:lol] sin ${f} en el crudo — no se embarca`); continue; }
      fs.writeFileSync(path.join(OUTD, f + '.gz'), zlib.gzipSync(raw, { level: 9 }));
      console.log(`[agg:lol] base embarcada: ${f}.gz (${(raw.length / 1e6).toFixed(1)} MB planos)`);
    }
  }
  wr('meta.json', { at: new Date().toISOString(), source: G.source || 'Leaguepedia (lol.fandom.com) Cargo API', license: 'CC BY-SA — atribución a Leaguepedia requerida',
    rights_class: G.rights_class, games: games.length, players_rows: pRows.length, drafts: Object.keys(D.rows || {}).length,
    players_window: { from: pRows.reduce((m, r) => (r.at && r.at < m ? r.at : m), '9999'), to: lastAt },
    window: { from: games[0] && games.reduce((m, g) => (g.at < m ? g.at : m), '9999'), to: lastAt } });
  console.log('[agg:lol] LISTO');
}

main();
