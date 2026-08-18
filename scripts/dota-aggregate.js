// scripts/dota-aggregate.js — DEL CRUDO DE OPENDOTA A LA BASE COMPACTA (18-ago, blueprint 5.0)
//
// Entradas (data/esports/dota2, de dota-harvest + dota-strategic-harvest):
//   matches.json, drafts.json, players-raw.json, patches.json, patch-names.json, heroes.json, notables.json
// Salidas compactas (SÍ se versionan): hero-meta.json, team-doctrine.json, player-stats.json, meta.json
//
// La POSICIÓN de un jugador (1-5) no viene en ningún campo: se INFIERE del rango de su GPM dentro de su
// equipo en cada partida (pos 1 = más oro). Es el proxy honesto de farm priority que Dota usa de facto, y
// el rating GP se normaliza DENTRO de esa posición: un hard support no compite con un carry en GPM (el
// mismo principio que el rol en LoL y la clase en Valorant).
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = process.env.GP_DOTA_DIR || path.join(__dirname, '..', 'data', 'esports', 'dota2');
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const wr = (f, o) => { fs.writeFileSync(path.join(DIR, f), JSON.stringify(o)); };

function main() {
  const M = rd('matches.json');
  if (!M || !M.matches) { console.error('[agg:dota] no hay matches.json'); process.exit(1); }
  const matches = Object.values(M.matches).filter((m) => m.r_id && m.d_id);
  const mIdx = new Map(matches.map((m) => [+m.id, m]));
  const lastAt = matches.reduce((x, m) => Math.max(x, m.at || 0), 0);
  const c365 = lastAt - 365 * 86400;
  console.log(`[agg:dota] ${matches.length} partidas con equipos identificados`);

  const D = rd('drafts.json'), P = rd('players-raw.json');
  const PT = rd('patches.json'), PN = rd('patch-names.json');
  const H = rd('heroes.json'), NB = rd('notables.json');
  const heroName = (h) => (H && H.rows && H.rows[h] && H.rows[h].name) || ('héroe ' + h);
  const heroRole = (h) => (H && H.rows && H.rows[h] && (H.rows[h].roles || [])[0]) || '—';
  const patchName = (pid) => {
    const arr = (PN && PN.rows) || [];
    const e = arr.find((x) => String(x.id) === String(pid));
    return e ? e.name : String(pid);
  };

  // ── hero-meta por parche (drafts + resultado del match) ────────────────────────────────────────────────
  if (D && Object.keys(D.rows || {}).length && PT) {
    const patchOf = (mid) => PT.rows[mid] != null ? PT.rows[mid] : null;
    const byPatch = {}; const matchesByPatch = {};
    const seenMatch = new Set();
    for (const r of Object.values(D.rows)) {
      const m = mIdx.get(r.m); if (!m) continue;
      const pid = patchOf(r.m); if (pid == null) continue;
      if (!seenMatch.has(`${pid}|${r.m}`)) { seenMatch.add(`${pid}|${r.m}`); matchesByPatch[pid] = (matchesByPatch[pid] || 0) + 1; }
      const key = `${pid}|${r.h}`;
      const e = byPatch[key] = byPatch[key] || { pid, h: r.h, picks: 0, wins: 0, bans: 0 };
      if (r.p) { e.picks++; const won = (r.t === 0) === !!m.r_win; if (won) e.wins++; }
      else e.bans++;
    }
    // el Explorer devuelve el NOMBRE del parche ('7.41') como string — se ordena numérico, se compara string
    const pids = Object.entries(matchesByPatch).filter(([, n]) => n >= 250).map(([pid]) => pid)
      .sort((a, b) => parseFloat(b) - parseFloat(a));
    const cur = pids[0], prev = pids[1];
    const K = 25;
    const rows = Object.values(byPatch).filter((e) => e.pid === cur && e.picks > 0).map((e) => {
      const pv = byPatch[`${prev}|${e.h}`];
      return { h: e.h, name: heroName(e.h), role: heroRole(e.h), n: e.picks,
        wr: +(e.wins / e.picks).toFixed(3), wr_shrunk: +((e.wins + 0.5 * K) / (e.picks + K)).toFixed(3),
        presence_pct: +(100 * (e.picks + e.bans) / matchesByPatch[cur]).toFixed(1), bans: e.bans,
        delta_wr: pv && pv.picks >= 10 ? +((e.wins / e.picks) - (pv.wins / pv.picks)).toFixed(3) : null };
    }).sort((a, b) => b.presence_pct - a.presence_pct);
    wr('hero-meta.json', { at: new Date().toISOString(), patch: String(cur), prev_patch: prev != null ? String(prev) : null,
      games_patch: matchesByPatch[cur], shrink_k: K, rows,
      note: `wr encogida hacia 0,5 con K=${K} picks; presencia = (picks + bans del héroe) / partidas del parche. El orden de pick (first phase vs last) no está controlado todavía y se declara.` });
    console.log(`[agg:dota] hero-meta: ${rows.length} héroes en el parche ${cur} (${matchesByPatch[cur]} partidas)`);
  } else console.log('[agg:dota] sin drafts/patches todavía — hero-meta se salta');

  // ── doctrina por equipo: pools de héroes con recencia (365d) ───────────────────────────────────────────
  if (D && Object.keys(D.rows || {}).length) {
    const byTeam = {};
    const picksByTeam = {};
    for (const r of Object.values(D.rows)) {
      if (!r.p) continue;
      const m = mIdx.get(r.m); if (!m || (m.at || 0) < c365) continue;
      const tid = r.t === 0 ? m.r_id : m.d_id; if (!tid) continue;
      (picksByTeam[tid] = picksByTeam[tid] || []).push({ at: m.at, h: r.h, won: (r.t === 0) === !!m.r_win });
    }
    const half = 60;   // medio-vida en PICKS del equipo (un equipo pro juega ~15 picks/semana)
    for (const [tid, arr] of Object.entries(picksByTeam)) {
      arr.sort((a, b) => a.at - b.at);
      const pool = {};
      arr.slice().reverse().forEach((x, i) => {
        const e = pool[x.h] = pool[x.h] || { h: x.h, name: heroName(x.h), n: 0, w: 0, rw: 0, last: 0 };
        e.n++; e.w += x.won ? 1 : 0; e.rw += Math.pow(0.5, i / half); e.last = Math.max(e.last, x.at);
      });
      byTeam[tid] = { picks: arr.length,
        pool: Object.values(pool).sort((a, b) => b.rw - a.rw).slice(0, 15).map((e) => ({ ...e, rw: +e.rw.toFixed(3) })) };
    }
    wr('team-doctrine.json', { at: new Date().toISOString(), window_days: 365, teams: byTeam,
      note: 'pools de héroes por equipo con recencia (medio-vida 60 picks) y rendimiento — la doctrina del draft en su V1; el modelo secuencial de draft llega con más capas.' });
    console.log(`[agg:dota] team-doctrine: ${Object.keys(byTeam).length} equipos`);
  }

  // ── player-stats: posición inferida por GPM y rating por posición ──────────────────────────────────────
  if (P && Object.keys(P.rows || {}).length) {
    const rowsP = Object.values(P.rows);
    // rango de GPM dentro del equipo en cada partida → posición 1-5
    const byMatchSide = {};
    for (const r of rowsP) (byMatchSide[`${r.m}|${r.radiant}`] = byMatchSide[`${r.m}|${r.radiant}`] || []).push(r);
    for (const arr of Object.values(byMatchSide)) {
      arr.sort((a, b) => b.gpm - a.gpm);
      arr.forEach((r, i) => { r._pos = i + 1; });
    }
    const perP = {};
    for (const r of rowsP) {
      const m = mIdx.get(r.m); if (!m || (m.at || 0) < c365) continue;
      const p = perP[r.acc] = perP[r.acc] || { acc: r.acc, rows: [] };
      p.rows.push({ ...r, at: m.at, won: (r.radiant === 1) === !!m.r_win,
        teamKills: r.radiant === 1 ? m.r_score : m.d_score,
        team_id: r.radiant === 1 ? m.r_id : m.d_id, vs: r.radiant === 1 ? m.d : m.r });
    }
    const stats = {}; const posPop = {};
    for (const p of Object.values(perP)) {
      if (p.rows.length < 8) continue;
      p.rows.sort((a, b) => a.at - b.at);
      const nb = NB && NB.rows ? NB.rows[p.acc] : null;
      let k = 0, d = 0, a = 0, gpm = 0, xpm = 0, kpS = 0, kpN = 0, w = 0, posS = 0;
      const pool = {}; const half = 40;
      p.rows.slice().reverse().forEach((r, i) => {
        const e = pool[r.h] = pool[r.h] || { h: r.h, name: heroName(r.h), n: 0, w: 0, rw: 0, last: 0 };
        e.n++; e.w += r.won ? 1 : 0; e.rw += Math.pow(0.5, i / half); e.last = Math.max(e.last, r.at);
      });
      for (const r of p.rows) {
        k += r.k; d += r.d; a += r.a; gpm += r.gpm; xpm += r.xpm; posS += r._pos || 3;
        if (r.teamKills > 0) { kpS += (r.k + r.a) / r.teamKills; kpN++; }
        w += r.won ? 1 : 0;
      }
      const n = p.rows.length;
      const lastTeam = p.rows[p.rows.length - 1].team_id;
      const st = {
        id: String(p.acc), nick: (nb && nb.nick) || ('#' + p.acc), team_id: lastTeam || (nb && nb.team_id) || null,
        n, pos: Math.max(1, Math.min(5, Math.round(posS / n))),
        wr: +(w / n).toFixed(3), kda: +(((k + a) / Math.max(1, d))).toFixed(2),
        kp: kpN ? +(kpS / kpN).toFixed(3) : null, gpm: +(gpm / n).toFixed(0), xpm: +(xpm / n).toFixed(0),
        dpm: +(d / n).toFixed(2),
        pool: Object.values(pool).sort((x, y) => y.rw - x.rw).slice(0, 10).map((e) => ({ ...e, rw: +e.rw.toFixed(3) })),
        recent: p.rows.slice(-10).reverse().map((r) => ({ at: new Date(r.at * 1000).toISOString().slice(0, 10),
          hero: heroName(r.h), vs: r.vs || null, k: r.k, d: r.d, a: r.a, win: r.won ? 1 : 0 })),
      };
      stats[st.id] = st;
      (posPop[st.pos] = posPop[st.pos] || []).push(st);
    }
    const zOf = (arr, f) => { const xs = arr.map(f).filter((x) => x != null); const m2 = xs.reduce((x, y) => x + y, 0) / (xs.length || 1);
      const sd = Math.sqrt(xs.reduce((x, y) => x + (y - m2) ** 2, 0) / (xs.length || 1)) || 1; return { m: m2, sd }; };
    for (const arr of Object.values(posPop)) {
      const zK = zOf(arr, (s) => s.kp), zD = zOf(arr, (s) => Math.min(8, s.kda)), zG = zOf(arr, (s) => s.gpm), zM = zOf(arr, (s) => s.dpm);
      for (const s of arr) {
        const z = 0.35 * ((s.kp != null ? s.kp : zK.m) - zK.m) / zK.sd + 0.30 * (Math.min(8, s.kda) - zD.m) / zD.sd
          + 0.20 * (s.gpm - zG.m) / zG.sd - 0.15 * (s.dpm - zM.m) / zM.sd;
        s.rating_gp = +(1 + 0.14 * z).toFixed(2);
      }
    }
    wr('player-stats.json', { at: new Date().toISOString(), window_days: 365, population: Object.keys(stats).length,
      formula: 'z por POSICIÓN (1-5, inferida del rango de GPM dentro del equipo) = 0.35·kill participation + 0.30·KDA (tope 8) + 0.20·GPM − 0.15·muertes/partida → rating 1.00 = media de la posición, ±0.14 por z. Un hard support no compite con un carry en oro.',
      players: stats });
    console.log(`[agg:dota] player-stats: ${Object.keys(stats).length} jugadores cualificados (≥8 partidas en 365d)`);
  } else console.log('[agg:dota] sin players-raw todavía — player-stats se salta');

  wr('meta.json', { at: new Date().toISOString(), source: 'OpenDota (research_only, RIGHTS.md)',
    matches: matches.length, drafts: D ? Object.keys(D.rows || {}).length : 0,
    player_rows: P ? Object.keys(P.rows || {}).length : 0 });
  console.log('[agg:dota] LISTO');
}

main();
