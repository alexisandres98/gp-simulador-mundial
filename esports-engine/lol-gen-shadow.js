// esports-engine/lol-gen-shadow.js — LA SOMBRA DEL GENERADOR DE KILLS DE LoL (9-sep)
//
// El generador (`lol-gen.js`) NO toca la familia congelada `lol_kills_hcp_v1` ni el modelo que publica la casa.
// Aquí nace su propio registro sobre `implied-engine/sombra` (deporte `lol_gen`): para cada mapa cotizado por
// Pinnacle/Cloudbet en las cuatro familias de kills, el precio del generador contra el precio sin margen de la
// MISMA casa, con incertidumbre de nacimiento por tamaño de celda (edge ≥ 0,75 × unc), cierres por cubo de la
// misma casa (del archivo de cierres de esports) y liquidación con los kills oficiales de Leaguepedia por el
// mismo `settleOne` de la casa. Nada de esto es pick: es la muestra que dirá si un modelo de distribución por
// liga y parche bate al mercado donde el modelo de perfil perdía (c = −0,65 en la autopsia).
'use strict';

const fs = require('fs');
const path = require('path');
const ES = require('./store');
const C = require('./core');
const LD = require('./lol-data');
const G = require('./lol-gen');
const S = require('../implied-engine/sombra');
const RES = require('../data-providers/esports/results');

const SPORT = 'lol_gen';
const FAMS = ['KILLS', 'KILLS_EQUIPO', 'KILLS_HANDICAP', 'KILLS_DNB'];
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const devig2 = (oa, ob) => (oa > 1 && ob > 1 ? (1 / oa) / (1 / oa + 1 / ob) : null);

// liga de la base propia a partir de la competición que trae la casa. Primero exacto, luego alias (la casa dice
// "LCK Challengers League" y la base "LCK CL"; `LD.tempoFor` lo casaba con LCK, que corre a otro ritmo), luego
// el nombre conocido más largo contenido en la competición. Si nada casa, la liga es DESCONOCIDA para la base.
const normL = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/challengers league/g, 'cl').replace(/challengers/g, 'cl').replace(/[^a-z0-9]+/g, ' ').trim();
function leagueOf(competition, known = []) {
  const c = normL(competition);
  if (!c) return { league: 'default', known: false };
  const table = known.map((k) => ({ k, n: normL(k) })).filter((x) => x.n.length >= 3);
  const exact = table.find((x) => x.n === c); if (exact) return { league: exact.k, known: true };
  const contained = table.filter((x) => (' ' + c + ' ').includes(' ' + x.n + ' ') || (' ' + x.n + ' ').includes(' ' + c + ' ')).sort((a, b) => b.n.length - a.n.length);
  if (contained.length) return { league: contained[0].k, known: true };
  const t = LD.tempoFor(competition);
  if (t && t.league) return { league: t.league, known: true };
  return { league: String(competition || '').trim().split(/[\s:|-]/)[0] || 'default', known: false };
}

// P(A gana el mapa) anclada al mercado: MAPA si alguna casa lo cotiza, si no SERIE → mapa por bo
function pMapFrom(rows, bo) {
  const byBook = (fam) => { const m = new Map(); for (const r of rows) if (r.family === fam && r.odds > 1 && (r.side === 'home' || r.side === 'away')) { const k = r.book + '|' + (r.map || ''); const o = m.get(k) || {}; o[r.side] = r.odds; m.set(k, o); } return [...m.values()].map((o) => devig2(o.home, o.away)).filter(Number.isFinite); };
  const map = byBook('MAPA'); if (map.length) return { p: r4(median(map)), from: 'MAPA' };
  const ser = byBook('SERIE'); if (ser.length) return { p: C.seriesToMap(median(ser), bo || 3), from: 'SERIE→mapa' };
  return { p: 0.5, from: 'sin ancla' };
}

// ── PASADA: tesis nuevas ────────────────────────────────────────────────────────────────────────────────
async function run({ ahora = Date.now(), withinMin = 720, cap = 12 } = {}) {
  const out = { sport: SPORT, eventos: 0, con_mercado: 0, tesis_evaluadas: 0, por_liga: {} };
  const data = LD.load();
  if (!data || !data.available) return { ...out, why: 'base propia de LoL no disponible' };
  const known = Object.keys(G.fitCached(data.games, data.at).leagues || {});
  // tesis vivas de una versión anterior del generador: fuera con motivo (no se mezclan muestras)
  { const st = S.rd(SPORT); let n = 0; for (const p of Object.values(st.picks || {})) if (p.status === 'ACTIVE' && (!p.meta || p.meta.model_version !== G.CONST.version)) { p.status = 'VOID'; p.result = 'VOID'; p.void_why = `generador ${(p.meta && p.meta.model_version) || 'sin versión'} sustituido por ${G.CONST.version}`; p.settled_at = new Date(ahora).toISOString(); n++; } if (n) { S.wr(SPORT, st); out.anuladas_version = n; } }
  const s = await ES.slate('lol', { days: 2 }).catch(() => null);
  const evs = ((s && s.events) || []).filter((e) => { if (!e.start_at) return false; const m = (Date.parse(e.start_at) - ahora) / 60000; return m > 5 && m < withinMin; })
    .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)).slice(0, cap);
  out.eventos = evs.length;
  const theses = [];
  for (const ev of evs) {
    const mk = await ES.market('lol', ev).catch(() => null);
    const rows = (mk && mk.markets) || [];
    const kills = rows.filter((r) => FAMS.includes(r.family) && r.odds > 1 && r.map >= 1);
    if (!kills.length) continue;
    out.con_mercado++;
    const bo = ES.boOf(mk, 3, ev);
    const lg = leagueOf(ev.competition, known); const league = lg.league;
    out.por_liga[league + (lg.known ? '' : ' (desconocida)')] = (out.por_liga[league + (lg.known ? '' : ' (desconocida)')] || 0) + 1;
    const anchor = pMapFrom(rows, bo);
    let gen = null;
    try { gen = G.analyze({ games: data.games, dataAt: data.at, league, pMapA: anchor.p, sims: 12000, unknownLeague: !lg.known }); } catch { gen = null; }
    if (!gen) continue;
    const home = ev.home && ev.home.name || ev.home, away = ev.away && ev.away.name || ev.away;
    for (const r of kills) {
      const other = r.side === 'over' ? 'under' : r.side === 'under' ? 'over' : r.side === 'home' ? 'away' : 'home';
      const comp = kills.find((x) => x.book === r.book && x.family === r.family && x.map === r.map && (x.team || null) === (r.team || null) && (x.line == null ? null : +x.line) === (r.line == null ? null : +r.line) && x.side === other);
      if (!comp) continue;   // sin el par de la misma casa no hay precio sin margen
      const pMkt = devig2(r.odds, comp.odds); if (pMkt == null) continue;
      const pGen = G.price(gen.sim, { family: r.family, side: r.side, line: r.line, team: r.team });
      if (!Number.isFinite(pGen)) continue;
      const edge = 100 * (pGen - pMkt);
      theses.push({
        key: `${ev.id}|${r.family}|${r.book}|${r.side}|${r.line == null ? 'x' : r.line}|${r.map}|${r.team || ''}`,
        ceid: ev.id, league, match: `${home} vs ${away}`, home, away, kickoff_at: ev.start_at,
        book: r.book, family: r.family, side: r.side, line: r.line != null ? +r.line : null, odds: r.odds,
        p_coherent: r4(pGen), p_market: r4(pMkt), edge_pp: r2(Math.abs(edge)), unc_pp: gen.unc_pp,
        n_books: new Set(kills.map((x) => x.book)).size,
        basis: `${gen.params.source} ${league}${gen.patch ? ' · parche ' + gen.patch : ''} (n_eff ${gen.params.n_eff}): ${gen.sim.mean_kills} ± ${gen.sim.sd_kills} kills, mapa ${r.map}, pMap ${anchor.p} (${anchor.from})`,
        meta: { model_version: G.CONST.version, league_known: lg.known, map: r.map, team: r.team || null, bo, p_map_a: anchor.p, anchor: anchor.from, mean_kills: gen.sim.mean_kills, sd_kills: gen.sim.sd_kills, handicap_mean: gen.sim.handicap_mean, source: gen.params.source, n_eff: gen.params.n_eff, patch: gen.patch, competition: ev.competition, edge_signed_pp: r2(edge) },
      });
    }
  }
  out.tesis_evaluadas = theses.length;
  // solo el lado que el generador ve barato: el otro lado del mismo par tiene la ventaja en negativo
  out.record = S.record(SPORT, theses.filter((t) => t.meta.edge_signed_pp > 0), { ahora });
  return out;
}

// ── CIERRES: del archivo de cierres de esports (misma casa, mejor, Pinnacle) ────────────────────────────
function closesFile() { try { return JSON.parse(fs.readFileSync(path.join(ES.DIR, 'closes-lol.json'), 'utf8')); } catch { return null; } }
async function closesOnly({ ahora = Date.now() } = {}) {
  const cl = closesFile(); if (!cl || !cl.closes) return { skipped: 'sin archivo de cierres' };
  const quoteFor = async (p) => {
    const c = cl.closes[p.ceid]; if (!c || !c.rows) return null;
    const m = p.meta || {};
    const same = c.rows.filter((r) => r.family === p.family && r.side === p.side && (r.map || null) === (m.map || null) && (r.team || null) === (m.team || null) && (r.line == null ? null : +r.line) === (p.line == null ? null : +p.line) && r.odds > 1);
    if (!same.length) return null;
    const own = same.find((r) => r.book === p.book), pin = same.find((r) => r.book === 'pinnacle');
    const newest = same.reduce((mx, r) => (String(r.at) > String(mx) ? r.at : mx), '');
    return { own: own ? own.odds : null, best: same.reduce((mx, r) => (r.odds > mx ? r.odds : mx), 0) || null, pinnacle: pin ? pin.odds : null, age_min: newest ? Math.round((ahora - Date.parse(newest)) / 60000) : null };
  };
  return S.closes(SPORT, quoteFor, { ahora });
}

// ── LIQUIDACIÓN: kills oficiales de Leaguepedia, casados por nombre, con el `settleOne` de la casa ──────
function keyName(name, data) { const id = LD.resolveTeam(name, { data }); return id ? 'gp:' + id : String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); }
async function settle({ ahora = Date.now() } = {}) {
  const st = S.rd(SPORT);
  const pend = Object.values(st.picks || {}).filter((p) => p.status === 'ACTIVE' && p.kickoff_at && ahora - Date.parse(p.kickoff_at) > 2.5 * 3600e3);
  if (!pend.length) return { liquidadas: 0, pendientes: 0 };
  const oldest = Math.min(...pend.map((p) => Date.parse(p.kickoff_at)));
  const since = new Date(oldest - 864e5).toISOString().slice(0, 10);
  const rs = await RES.results('lol', { since, max: 4000 }).catch(() => null);
  const rows = (rs && rs.rows) || [];
  const data = LD.load();
  const idx = rows.map((r) => ({ r, ka: keyName(r.a, data), kb: keyName(r.b, data), t: Date.parse(r.at || 0) }));
  const verdictFor = (p) => {
    const kh = keyName(p.home, data), ka = keyName(p.away, data), t = Date.parse(p.kickoff_at);
    const cands = idx.filter((x) => Math.abs(x.t - t) <= 30 * 3600e3 && ((x.ka === kh && x.kb === ka) || (x.ka === ka && x.kb === kh)));
    if (cands.length !== 1) return null;
    let res = cands[0].r;
    if (cands[0].ka !== kh) {
      // orientación invertida: se giran maps_a/b, kills_a/b y winner (el bloque del 2-sep, copiado tal cual)
      res = { ...res, a: res.b, b: res.a, maps_a: res.maps_b, maps_b: res.maps_a,
        maps: (res.maps || []).map((mm) => ({ ...mm, kills_a: mm.kills_b, kills_b: mm.kills_a, score_a: mm.score_b, score_b: mm.score_a, winner: mm.winner === 'a' ? 'b' : mm.winner === 'b' ? 'a' : mm.winner })) };
    }
    const m = p.meta || {};
    const v = ES.settleOne({ family: p.family, line: p.line, side: p.side, map: m.map, team: m.team, bo: m.bo }, res);
    return v === 'WIN' || v === 'LOSS' || v === 'PUSH' ? v : null;
  };
  const r = S.settle(SPORT, verdictFor, { ahora, minAfterMin: 150 });
  return { ...r, pendientes: pend.length, fuente_filas: rows.length, fuente: rs && rs.source };
}

async function job({ ahora = Date.now() } = {}) {
  const out = {};
  out.run = await run({ ahora }).catch((e) => ({ error: e.message }));
  out.closes = await closesOnly({ ahora }).catch((e) => ({ error: e.message }));
  out.settle = await settle({ ahora }).catch((e) => ({ error: e.message }));
  return out;
}
function track() {
  const t = S.track(SPORT);
  // calibración del generador sobre lo liquidado: Brier de p_coherent contra el resultado (PUSH fuera)
  const done = (Object.values(S.rd(SPORT).picks || {})).filter((p) => p.status === 'SETTLED' && (p.result === 'WIN' || p.result === 'LOSS'));
  const br = done.map((p) => ((p.result === 'WIN' ? 1 : 0) - p.p_coherent) ** 2), brM = done.map((p) => ((p.result === 'WIN' ? 1 : 0) - p.p_market) ** 2);
  t.calibracion = { n: done.length, brier_generador: br.length ? r4(br.reduce((a, b) => a + b, 0) / br.length) : null, brier_mercado: brM.length ? r4(brM.reduce((a, b) => a + b, 0) / brM.length) : null };
  t.modelo = { version: G.CONST.version, doctrina: 'distribución de kills por liga y parche medida en la base propia (97.588 partidas), reparto del ganador y acople paliza→duración/ritmo; pMap anclada a mercado; NUNCA pick: sombra con incertidumbre de nacimiento.' };
  return t;
}

module.exports = { SPORT, run, closesOnly, settle, job, track, leagueOf, pMapFrom };
