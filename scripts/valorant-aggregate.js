// scripts/valorant-aggregate.js — DEL CRUDO DE vlr.gg A LA BASE COMPACTA (18-ago, blueprint 4.0)
//
// Entradas (del harvest, en GP_VAL_DIR o data/esports/valorant):
//   series.json       — índice completo (SIEMPRE necesario; es liviano y se versiona tal cual)
//   maps.json         — detalle por serie: mapas, marcadores, mitades ataque/defensa (opcional)
//   players-raw.json  — scoreboard por jugador y mapa: agente, ACS, K/D/A, KAST, ADR, FK/FD (opcional)
// Salidas compactas (SÍ se versionan): map-stats.json, agents.json, player-stats.json, comps.json, meta.json
//
// El Elo de equipos NO se precalcula aquí: valorant-data.js lo deriva en el load desde series.json con
// las constantes validadas (mismo patrón que lol-data). Aquí viven los agregados PESADOS.
//
// Sin parche en la fuente (vlr no lo publica en la página de partido de forma fiable), el meta de agentes
// se mide por VENTANAS DE 90 DÍAS (actual vs anterior) y se declara así — nada de fingir cortes de parche.
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = process.env.GP_VAL_DIR || (fs.existsSync('/data') ? '/data/val-raw' : path.join(__dirname, '..', 'data', 'esports', 'valorant'));
const OUT = path.join(__dirname, '..', 'data', 'esports', 'valorant');
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const wr = (f, o) => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, f), JSON.stringify(o)); };

// clase de agente (taxonomía estable del juego; V-0017 pide flex first-class — la clase del JUGADOR sale
// de su distribución real de agentes, no de una etiqueta fija)
const AGENT_CLASS = {
  jett: 'duelist', raze: 'duelist', reyna: 'duelist', phoenix: 'duelist', neon: 'duelist', yoru: 'duelist', iso: 'duelist', waylay: 'duelist',
  sova: 'initiator', breach: 'initiator', skye: 'initiator', kayo: 'initiator', fade: 'initiator', gekko: 'initiator', tejo: 'initiator',
  omen: 'controller', brimstone: 'controller', viper: 'controller', astra: 'controller', harbor: 'controller', clove: 'controller',
  killjoy: 'sentinel', cypher: 'sentinel', sage: 'sentinel', chamber: 'sentinel', deadlock: 'sentinel', vyse: 'sentinel', veto: 'sentinel',
};

function main() {
  const S = rd('series.json');
  if (!S || !Object.keys(S.rows || {}).length) { console.error('[agg:val] no hay series.json — corre el harvest primero'); process.exit(1); }
  const series = Object.values(S.rows).filter((s) => s.at && s.t1 && s.t2);
  const lastAt = series.reduce((m, s) => (s.at > m ? s.at : m), '');
  const dayMs = 864e5;
  const cut = (days) => new Date(Date.parse(lastAt + 'T12:00:00Z') - days * dayMs).toISOString().slice(0, 10);
  const c90 = cut(90), c180 = cut(180), c365 = cut(365);
  console.log(`[agg:val] ${series.length} series (${series.reduce((m, s) => (s.at < m ? s.at : m), '9')} → ${lastAt})`);

  const M = rd('maps.json'), P = rd('players-raw.json');
  const sIdx = new Map(series.map((s) => [s.id, s]));

  // ── map-stats: el circuito por mapa (ritmo, prórrogas, lado atacante) + fuerza por equipo y mapa ───────
  let mapStats = null;
  if (M && Object.keys(M.rows || {}).length) {
    const per = {}; const teamMap = {};
    for (const [sid, det] of Object.entries(M.rows)) {
      const s = sIdx.get(sid); if (!s) continue;
      for (const g of det.maps || []) {
        const total = (g.s1 || 0) + (g.s2 || 0); if (total < 13) continue;
        const m = per[g.map] = per[g.map] || { n: 0, recent_n: 0, rounds: 0, ot: 0, atk_rounds: 0, all_rounds: 0 };
        m.n++; if (det.at >= c180) m.recent_n++;
        m.rounds += total; if (total > 25) m.ot++;
        // mitades: [t1 primera mitad (lado X), t1 segunda, t2 primera, t2 segunda] — el lado 't' es ataque
        for (const h of g.halves || []) { if (h.side === 't') m.atk_rounds += h.r; if (h.side !== 'ot') m.all_rounds += h.r; }
        for (const [team, won, sc] of [[s.t1, g.s1 > g.s2, g.s1], [s.t2, g.s2 > g.s1, g.s2]]) {
          if (det.at < c365) continue;
          const tm = teamMap[team] = teamMap[team] || {};
          const e = tm[g.map] = tm[g.map] || { n: 0, w: 0, rounds_w: 0, rounds_t: 0 };
          e.n++; e.w += won ? 1 : 0; e.rounds_w += sc; e.rounds_t += total;
        }
      }
    }
    const rows = Object.entries(per).filter(([, m]) => m.n >= 25).map(([map, m]) => ({
      map, n: m.n, recent_n: m.recent_n,
      mean_rounds: +(m.rounds / m.n).toFixed(2), overtime_p: +(m.ot / m.n).toFixed(3),
      atk_round_share: m.all_rounds ? +(m.atk_rounds / m.all_rounds).toFixed(3) : null,
      in_rotation: m.recent_n >= 12,
    })).sort((a, b) => b.recent_n - a.recent_n);
    mapStats = { at: new Date().toISOString(), window_days: { circuit: 180, teams: 365 }, rows, teams: teamMap,
      note: 'atk_round_share: cuota de rondas ganadas ATACANDO en el mapa — el sesgo de lado de Valorant, medido, no asumido.' };
    wr('map-stats.json', mapStats);
    console.log(`[agg:val] map-stats: ${rows.length} mapas con muestra · ${Object.keys(teamMap).length} equipos con historial por mapa`);
  } else console.log('[agg:val] sin maps.json todavía — map-stats se salta (el detalle sigue cosechándose)');

  // ── agents + player-stats + comps (necesitan el scoreboard) ────────────────────────────────────────────
  if (P && Object.keys(P.rows || {}).length) {
    const rowsP = Object.values(P.rows).filter((r) => r.at && r.agent);
    // resultado del mapa por (sid,gid) para saber si el jugador ganó
    const winOf = new Map();
    if (M) for (const [sid, det] of Object.entries(M.rows)) for (const g of det.maps || []) winOf.set(`${sid}|${g.gid}`, g.s1 > g.s2 ? 1 : 2);
    // meta de agentes por ventana de 90 días
    const agg = { cur: {}, prev: {} };
    let curMaps = new Set(), prevMaps = new Set();
    for (const r of rowsP) {
      const w = r.at >= c90 ? 'cur' : r.at >= c180 ? 'prev' : null; if (!w) continue;
      (w === 'cur' ? curMaps : prevMaps).add(`${r.sid}|${r.gid}`);
      const a = agg[w][r.agent] = agg[w][r.agent] || { n: 0, w: 0 };
      a.n++;
      const winner = winOf.get(`${r.sid}|${r.gid}`);
      if (winner) a.w += (winner === r.team ? 1 : 0);
    }
    const nCur = curMaps.size || 1;
    const K = 25;
    const agents = Object.entries(agg.cur).map(([ag, a]) => {
      const pv = agg.prev[ag];
      return { agent: ag, class: AGENT_CLASS[ag] || null, n: a.n,
        presence_pct: +(100 * a.n / (nCur * 10)).toFixed(1),   // 10 huecos por mapa
        wr: a.n ? +(a.w / a.n).toFixed(3) : null,
        wr_shrunk: +((a.w + 0.5 * K) / (a.n + K)).toFixed(3),
        delta_wr: pv && pv.n >= 10 && a.n ? +((a.w / a.n) - (pv.w / pv.n)).toFixed(3) : null };
    }).sort((a, b) => b.presence_pct - a.presence_pct);
    wr('agents.json', { at: new Date().toISOString(), window: { cur_from: c90, prev_from: c180 }, maps_cur: curMaps.size, shrink_k: K, rows: agents,
      note: `meta por VENTANA de 90 días (vlr no publica el parche por partido): presencia = picks del agente / (mapas de la ventana × 10 huecos); wr encogida hacia 0,5 con K=${K}; delta contra la ventana anterior.` });
    console.log(`[agg:val] agents: ${agents.length} agentes en la ventana (${curMaps.size} mapas)`);

    // player-stats (365d, ≥8 mapas) — rating GP normalizado por CLASE de agente dominante
    const perP = {};
    for (const r of rowsP) {
      if (r.at < c365) continue;
      const p = perP[r.pid] = perP[r.pid] || { pid: r.pid, nick: r.nick, tag: r.tag, rows: [] };
      p.nick = r.nick; p.tag = r.tag; p.rows.push(r);
    }
    const stats = {}; const classPop = {};
    for (const p of Object.values(perP)) {
      if (p.rows.length < 8) continue;
      const cls = (() => { const c = {}; for (const r of p.rows) { const k = AGENT_CLASS[r.agent] || 'flex'; c[k] = (c[k] || 0) + 1; }
        return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; })();
      const flexPct = (() => { const ags = new Set(p.rows.map((r) => AGENT_CLASS[r.agent] || 'x')); return ags.size; })();
      let acs = 0, adr = 0, kast = 0, k = 0, d = 0, a = 0, fk = 0, fd = 0, w = 0, nW = 0;
      const pool = {};
      const half = 40;
      p.rows.sort((x, y) => (x.at < y.at ? -1 : 1));
      p.rows.slice().reverse().forEach((r, i) => {
        const key = r.agent; const m = pool[key] = pool[key] || { agent: key, n: 0, w: 0, rw: 0, last: null };
        m.n++; m.rw += Math.pow(0.5, i / half); if (!m.last || r.at > m.last) m.last = r.at;
      });
      for (const r of p.rows) {
        acs += r.acs || 0; adr += r.adr || 0; kast += r.kast || 0; k += r.k || 0; d += r.d || 0; a += r.a || 0; fk += r.fk || 0; fd += r.fd || 0;
        const winner = winOf.get(`${r.sid}|${r.gid}`);
        if (winner) { nW++; w += winner === r.team ? 1 : 0; }
        const key = r.agent; if (pool[key]) { const winB = winner ? (winner === r.team ? 1 : 0) : 0; pool[key].w += winB; }
      }
      const n = p.rows.length;
      // afiliación por la fila MÁS RECIENTE: el nombre completo del equipo sale de la serie, no del tag
      const lastRow = p.rows[p.rows.length - 1];
      const lastS = sIdx.get(lastRow.sid);
      const teamFull = lastS ? (lastRow.team === 1 ? lastS.t1 : lastS.t2) : null;
      const st = { id: p.pid, nick: p.nick, team_tag: p.tag, team: teamFull, n, class: cls, classes_played: flexPct,
        wr: nW ? +(w / nW).toFixed(3) : null,
        acs: +(acs / n).toFixed(0), adr: +(adr / n).toFixed(0), kast: +(kast / n).toFixed(1),
        kda: +(((k + a) / Math.max(1, d))).toFixed(2), dpm: +(d / n).toFixed(2),
        fk_fd: +((fk - fd) / n).toFixed(2),
        pool: Object.values(pool).sort((x, y) => y.rw - x.rw).slice(0, 8).map((m) => ({ ...m, rw: +m.rw.toFixed(3) })),
        recent: p.rows.slice(-10).reverse().map((r) => ({ at: r.at, agent: r.agent, acs: r.acs, k: r.k, d: r.d, a: r.a,
          win: winOf.get(`${r.sid}|${r.gid}`) ? (winOf.get(`${r.sid}|${r.gid}`) === r.team ? 1 : 0) : null })),
      };
      stats[p.pid] = st;
      (classPop[cls] = classPop[cls] || []).push(st);
    }
    const zOf = (arr, f) => { const xs = arr.map(f).filter((x) => x != null); const m = xs.reduce((x, y) => x + y, 0) / (xs.length || 1);
      const sd = Math.sqrt(xs.reduce((x, y) => x + (y - m) ** 2, 0) / (xs.length || 1)) || 1; return { m, sd }; };
    for (const arr of Object.values(classPop)) {
      const zA = zOf(arr, (s) => s.acs), zD = zOf(arr, (s) => s.adr), zK = zOf(arr, (s) => s.kast), zF = zOf(arr, (s) => s.fk_fd), zM = zOf(arr, (s) => s.dpm);
      for (const s of arr) {
        const z = 0.30 * (s.acs - zA.m) / zA.sd + 0.20 * (s.adr - zD.m) / zD.sd + 0.20 * (s.kast - zK.m) / zK.sd
          + 0.15 * (s.fk_fd - zF.m) / zF.sd - 0.15 * (s.dpm - zM.m) / zM.sd;
        s.rating_gp = +(1 + 0.14 * z).toFixed(2);
      }
    }
    wr('player-stats.json', { at: new Date().toISOString(), window_days: 365, population: Object.keys(stats).length,
      formula: 'z por CLASE de agente = 0.30·ACS + 0.20·ADR + 0.20·KAST + 0.15·(FK−FD por mapa) − 0.15·muertes por mapa → rating 1.00 = media de la clase, ±0.14 por z. Normalizar dentro de la clase es el V-0108 del blueprint: un centinela no compite con un duelista en ACS.',
      players: stats });
    console.log(`[agg:val] player-stats: ${Object.keys(stats).length} jugadores cualificados (≥8 mapas en 365d)`);

    // comps: composiciones por equipo y mapa (familiaridad — V-0134/0135)
    const comps = {};
    const mapOf = new Map();
    if (M) for (const [sid, det] of Object.entries(M.rows)) for (const g of det.maps || []) mapOf.set(`${sid}|${g.gid}`, g.map);
    const byTeamMap = {};
    for (const r of rowsP) {
      if (r.at < c365) continue;
      const s = sIdx.get(r.sid); if (!s) continue;
      const team = r.team === 1 ? s.t1 : s.t2;
      const key = `${r.sid}|${r.gid}|${team}`;
      (byTeamMap[key] = byTeamMap[key] || { team, map: mapOf.get(`${r.sid}|${r.gid}`) || null, at: r.at, agents: [] }).agents.push(r.agent);
    }
    for (const e of Object.values(byTeamMap)) {
      if (e.agents.length !== 5 || !e.map) continue;
      const comp = e.agents.slice().sort().join('+');
      const t = comps[e.team] = comps[e.team] || {};
      const m = t[e.map] = t[e.map] || {};
      const c = m[comp] = m[comp] || { n: 0, last: null };
      c.n++; if (!c.last || e.at > c.last) c.last = e.at;
    }
    wr('comps.json', { at: new Date().toISOString(), window_days: 365, teams: comps,
      note: 'composiciones por equipo y mapa con recuento y última vez — la familiaridad del V-0135; sinergias y counters llegan con más muestra.' });
    console.log(`[agg:val] comps: ${Object.keys(comps).length} equipos con composiciones`);
  } else console.log('[agg:val] sin players-raw.json todavía — agents/player-stats/comps se saltan');

  wr('meta.json', { at: new Date().toISOString(), source: 'vlr.gg (research_only, RIGHTS.md)', series: series.length,
    detail_series: M ? Object.keys(M.rows || {}).length : 0, player_rows: P ? Object.keys(P.rows || {}).length : 0,
    last_at: lastAt });
  console.log('[agg:val] LISTO');
}

main();
