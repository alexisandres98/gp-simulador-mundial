// tt-engine/data.js — LA MEMORIA DEL TENIS DE MESA: base propia, ratings y catálogo (blueprint 9.0, bloques 5-8)
//
// Carga el compacto (matches.json[.gz]: cada partido con los PUNTOS de cada game, 2003 → hoy) y reproduce
// TODO el historial en orden cronológico con las constantes congeladas de model-priors.json:
//   · Elo de PARTIDO (L0): quién le gana a quién, con K por experiencia y peso por nivel de evento;
//   · rating de PUNTO (L1): un logit θ por jugador tal que P(A gana un punto a B) = σ(θA − θB), actualizado
//     con los puntos reales de cada partido (verosimilitud de Bernoulli sobre el marcador de games). Es lo
//     que alimenta al compilador exacto: de θ sale la probabilidad de punto, del compilador todo lo demás.
//   · exposición (partidos y puntos) → incertidumbre honesta; jugador frío = poca muestra.
// Resolución (blueprint 5.2): L1 = marcador por game. El reparto saque/recepción (L2) NO está identificado
// con esta fuente: se aplica un prior de población (serveDelta) y se dice en pantalla. Nunca se inventa.
// La base vive en el disco persistente (la escribe scripts/tt-harvest.js) y cae al repo si no hay disco.
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./rules');
const C = require('./compiler');

const REPO_BASE = path.join(__dirname, '..', 'data', 'tt');
const DISK_BASE = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'tt');
const archivo = (n) => { for (const base of [DISK_BASE, REPO_BASE]) { try { const d = path.join(base, n); if (fs.existsSync(d)) return d; if (fs.existsSync(d + '.gz')) return d + '.gz'; } catch { /* sin disco */ } } return path.join(REPO_BASE, n); };
const leer = (p) => { const raw = fs.readFileSync(p); return JSON.parse(p.endsWith('.gz') ? require('zlib').gunzipSync(raw).toString('utf8') : raw.toString('utf8')); };
const readJsonMaybe = (p) => { try { return leer(p); } catch { return null; } };
const logit = (p) => Math.log(p / (1 - p));
const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const DEFAULT_PRIORS = {
  model_version: 'tt-l1-0',
  constants: {
    kScale: 1.0,        // Elo de partido: K = kScale · 200 / (n+5)^0.4
    pointEta: 0.04,     // paso del rating de punto por (puntos ganados − esperados)
    pointNorm: 0.5,     // el paso se divide por n^pointNorm (n = puntos del partido)
    pointScale: 0.8,    // contracción de la probabilidad de punto hacia 0,5 para el GANADOR (entra a la mezcla)
    pointScaleDist: 1.0, // dispersión de la probabilidad de punto para las DISTRIBUCIONES (games, puntos, marcador)
    serveDelta: 0.03,   // prior de población: a = p + δ (sirve A), b = p − δ (sirve B); L2 no identificado
    ensembleU: 0.5,     // peso del compilador frente al Elo en el logit del ganador
    youthWeight: 0.5,   // los partidos juveniles informan menos
    warmN: 8,           // por debajo de estos partidos el jugador es "frío"
  },
  holdout: null,
};

let D = null;
function reset() { D = null; C && C.compileMatch && null; }

function build() {
  if (D) return D;
  const m = readJsonMaybe(archivo('matches.json')) || { schema: [], tourneys: {}, rows: [] };
  const players = readJsonMaybe(archivo('players.json')) || {};
  const priors = readJsonMaybe(path.join(REPO_BASE, 'model-priors.json')) || DEFAULT_PRIORS;
  const formats = readJsonMaybe(archivo('formats.json')) || { by: {} };
  const meta = readJsonMaybe(archivo('meta.json')) || { last_match_date: null, years: null, sources: [] };
  const cst = { ...DEFAULT_PRIORS.constants, ...(priors.constants || {}) };
  const F = {}; (m.schema || []).forEach((k, i) => { F[k] = i; });
  const rows = (m.rows || []).slice().sort((a, b) => a[F.date] - b[F.date] || String(a[F.tid]).localeCompare(String(b[F.tid])));
  const T = replay(rows, F, m.tourneys || {}, cst, null);
  // MEMORIA (Render Starter, 512 MB): los ratings ya absorbieron TODO el historial; en memoria se conservan solo las filas
  // desde 2018 (h2h, liquidación, fichas). Las anteriores viven en el compacto y se reproducen en cada arranque.
  const keep = rows.filter((r) => r[F.date] >= 20180101);
  D = { F, schema: m.schema || [], tourneys: m.tourneys || {}, rows: keep, rows_total: rows.length, players, priors: { ...priors, constants: cst }, formats: formats.by || {}, meta, T };
  return D;
}

// Reproduce el historial. `until` (YYYYMMDD) corta la pasada para las evaluaciones point-in-time.
// `onPredict(row, pred)` recibe la predicción ANTES de actualizar (walk-forward puro).
function replay(rows, F, tourneys, cst, onPredict, { until = null } = {}) {
  const T = { cst, elo: new Map(), theta: new Map(), nMatch: new Map(), nPts: new Map(), prof: new Map(), lastDate: new Map() };
  const K = (n) => cst.kScale * 200 / Math.pow(n + 5, 0.4);
  const eta = (n) => cst.pointEta * (1 + 6 / (n + 3));
  const g = (mp, k, d) => (mp.has(k) ? mp.get(k) : d);
  for (const r of rows) {
    const date = r[F.date];
    if (until && date >= until) break;
    const A = r[F.wid], B = r[F.lid];
    if (!A || !B || A === B) continue;
    const tq = tourneys[r[F.tid]] || {};
    const w = (R.TIER_WEIGHT[tq.tier] || 0.8) * (tq.youth || tq.tier === 'youth' ? cst.youthWeight : 1);
    const eA = g(T.elo, A, 1500), eB = g(T.elo, B, 1500);
    const pElo = 1 / (1 + Math.pow(10, -(eA - eB) / 400));
    const thA = g(T.theta, A, 0), thB = g(T.theta, B, 0);
    const nA = g(T.nMatch, A, 0), nB = g(T.nMatch, B, 0);
    // puntos del partido (ganador primero)
    let pw = 0, pl = 0, games = [];
    if (r[F.games]) for (const gs of String(r[F.games]).split(',')) { const mm = gs.match(/^(\d+)-(\d+)$/); if (mm) { games.push([+mm[1], +mm[2]]); pw += +mm[1]; pl += +mm[2]; } }
    const n = pw + pl;
    if (onPredict) onPredict(r, { pElo, thA, thB, nA, nB, eA, eB, games, pw, pl, bo: r[F.bo] });
    // Elo de partido
    T.elo.set(A, eA + w * K(nA) * (1 - pElo)); T.elo.set(B, eB - w * K(nB) * (1 - pElo));
    // rating de punto (solo con marcador completo y sin retirada)
    if (n >= 11 && !r[F.ret]) {
      const pPt = sig(thA - thB);
      const grad = (pw - n * pPt) / Math.pow(n, cst.pointNorm);
      T.theta.set(A, thA + w * eta(nA) * grad); T.theta.set(B, thB - w * eta(nB) * grad);
      T.nPts.set(A, g(T.nPts, A, 0) + n); T.nPts.set(B, g(T.nPts, B, 0) + n);
    }
    T.nMatch.set(A, nA + 1); T.nMatch.set(B, nB + 1);
    T.lastDate.set(A, date); T.lastDate.set(B, date);
    // catálogo
    for (const [id, opp, won] of [[A, B, true], [B, A, false]]) {
      let p = T.prof.get(id);
      if (!p) { p = { w: 0, l: 0, gw: 0, gl: 0, pw: 0, pl: 0, deuce: 0, gamesN: 0, recent: [], firstDate: date, lastDate: date, tourneys: new Set(), titles: 0, byYear: {} }; T.prof.set(id, p); }
      if (won) p.w++; else p.l++;
      p.gw += won ? r[F.wg] : r[F.lg]; p.gl += won ? r[F.lg] : r[F.wg];
      p.pw += won ? pw : pl; p.pl += won ? pl : pw;
      for (const [x, y] of games) { p.gamesN++; if (x + y >= 22) p.deuce++; }
      p.lastDate = Math.max(p.lastDate, date);
      p.tourneys.add(r[F.tid]);
      if (won && r[F.round] === 'F') p.titles++;
      const y = Math.floor(date / 10000); const by = p.byYear[y] = p.byYear[y] || { w: 0, l: 0 }; if (won) by.w++; else by.l++;
      p.recent.push({ d: date, dated: r[F.dated], opp, won, score: won ? `${r[F.wg]}-${r[F.lg]}` : `${r[F.lg]}-${r[F.wg]}`, games: won ? games.map((x) => x.join('-')).join(' ') : games.map((x) => x[1] + '-' + x[0]).join(' '), t: tq.name || '', tier: tq.tier || null, round: r[F.round], tid: r[F.tid], bo: r[F.bo] });
      if (p.recent.length > 20) p.recent.shift();
    }
  }
  return T;
}

// ── LECTURAS ────────────────────────────────────────────────────────────────────────────────────────────
const idk = (id) => String(id);
function eloOf(id) { const d = build(); return d.T.elo.has(idk(id)) ? d.T.elo.get(idk(id)) : 1500; }
function thetaOf(id) { const d = build(); return d.T.theta.has(idk(id)) ? d.T.theta.get(idk(id)) : 0; }
function eloProb(idA, idB) { return 1 / (1 + Math.pow(10, -(eloOf(idA) - eloOf(idB)) / 400)); }
function pointProb(idA, idB, { dist = false } = {}) { const d = build(); const s = dist ? (d.T.cst.pointScaleDist || d.T.cst.pointScale) : d.T.cst.pointScale; return 0.5 + s * (sig(thetaOf(idA) - thetaOf(idB)) - 0.5); }
// el vector de habilidad de un jugador, con su exposición
function skillOf(id) {
  const d = build(); const T = d.T; const k = idk(id);
  const n = T.nMatch.get(k) || 0, pts = T.nPts.get(k) || 0, prof = T.prof.get(k);
  const last = T.lastDate.get(k) || null;
  const today = +new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const daysIdle = last ? Math.round((Date.UTC(Math.floor(today / 10000), Math.floor(today / 100) % 100 - 1, today % 100) - Date.UTC(Math.floor(last / 10000), Math.floor(last / 100) % 100 - 1, last % 100)) / 864e5) : null;
  return { id: k, elo: Math.round(T.elo.get(k) || 1500), theta: +(T.theta.get(k) || 0).toFixed(4), point_share: +sig(T.theta.get(k) || 0).toFixed(4), n_matches: n, n_points: pts, cold: n < T.cst.warmN, last_date: last, days_idle: daysIdle, stale: daysIdle != null && daysIdle > 240,
    deuce_rate: prof && prof.gamesN ? +(prof.deuce / prof.gamesN).toFixed(3) : null, point_pct: prof && prof.pw + prof.pl ? +(prof.pw / (prof.pw + prof.pl)).toFixed(3) : null, level: n ? 'L1' : 'L0' };
}
// incertidumbre de la probabilidad del duelo en puntos porcentuales (exposición de los dos)
function uncertaintyPp(idA, idB) {
  const d = build(); const nA = d.T.nMatch.get(idk(idA)) || 0, nB = d.T.nMatch.get(idk(idB)) || 0;
  return +(100 * 0.28 * Math.sqrt(1 / (nA + 2) + 1 / (nB + 2))).toFixed(1);
}
// el modelo de un duelo: Elo → punto → compilador → mezcla. `first` = quién sirve el primer game (null = mezcla)
function matchModel(idA, idB, { best_of = 5, first = null } = {}) {
  const d = build(); const cst = d.T.cst;
  const pE = clamp(eloProb(idA, idB), 1e-4, 1 - 1e-4);
  // dos escalas (blueprint 12.3): la del ganador entra a la mezcla; la de las distribuciones compila todo lo demás
  const r3 = (x) => +x.toFixed(3);
  const pPt = clamp(pointProb(idA, idB), 0.05, 0.95), pPtD = clamp(pointProb(idA, idB, { dist: true }), 0.05, 0.95);
  const a = r3(clamp(pPt + cst.serveDelta, 0.02, 0.98)), b = r3(clamp(pPt - cst.serveDelta, 0.02, 0.98));
  const aD = r3(clamp(pPtD + cst.serveDelta, 0.02, 0.98)), bD = r3(clamp(pPtD - cst.serveDelta, 0.02, 0.98));
  const pC = clamp(C.compileMatch(a, b, { best_of, first }).p_a, 1e-4, 1 - 1e-4);
  const mm = C.compileMatch(aD, bD, { best_of, first });
  const p = sig((1 - cst.ensembleU) * logit(pE) + cst.ensembleU * logit(pC));
  return { p_a: +p.toFixed(4), p_a_elo: +pE.toFixed(4), p_a_compiled: +pC.toFixed(4), p_a_dist: +mm.p_a.toFixed(4), p_point: +pPt.toFixed(4), p_point_dist: +pPtD.toFixed(4), a: aD, b: bD, serve_delta: cst.serveDelta, match: mm, unc_pp: uncertaintyPp(idA, idB), skills: { a: skillOf(idA), b: skillOf(idB) }, model_version: d.priors.model_version, resolution: 'L1', best_of, first: first || 'unknown' };
}
// formato empírico por nivel × ronda (formats.json) con plantilla de respaldo
function formatFor(tier, round) {
  const d = build();
  const by = d.formats[`${tier}|${round || 'OTR'}`] || d.formats[`${tier}|OTR`] || null;
  if (by) {
    const tot = Object.values(by).reduce((s, x) => s + x, 0);
    const best = Object.entries(by).sort((x, y) => y[1] - x[1])[0];
    if (tot >= 8) return { best_of: +best[0], share: +(best[1] / tot).toFixed(2), n: tot, source: `histórico ${R.TIER_LABEL[tier] || tier} · ${R.ROUND_LABEL[round] || round || 'ronda'} (${best[1]}/${tot} al mejor de ${best[0]})`, certified: false };
  }
  return { best_of: R.templateBestOf(tier, round), share: null, n: 0, source: 'plantilla del circuito (sin histórico suficiente)', certified: false };
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// resuelve "Wang Chuqin" / "Chuqin Wang" / "WANG Chuqin" / "Wang C." → jugador de la base
function resolvePlayer(name, { gender = null } = {}) {
  const d = build();
  const q = norm(name); if (!q) return null;
  const qt = q.split(' ').filter(Boolean);
  let best = null, bestScore = 0;
  for (const [id, p] of Object.entries(d.players)) {
    if (gender && p.gender && p.gender !== gender) continue;
    const fam = norm(p.family), giv = norm(p.given), full = norm(p.name);
    if (!fam) continue;
    let sc = 0;
    if (full === q || norm(`${p.family} ${p.given}`) === q) sc = 10;
    else {
      const famT = fam.split(' '), givT = giv.split(' ').filter(Boolean);
      const famHit = famT.every((t) => qt.includes(t));
      if (!famHit) continue;
      sc = 3;
      const rest = qt.filter((t) => !famT.includes(t));
      if (givT.length && rest.length) {
        if (rest.every((t) => givT.includes(t))) sc += 4;            // nombre completo
        else if (givT.some((t) => rest.some((x) => x === t))) sc += 3; // algún nombre
        else if (rest.some((x) => x.length <= 2 && givT.some((t) => t[0] === x[0]))) sc += 1.5; // inicial
        else continue; // nombre distinto con la misma familia: otro jugador
      } else if (!rest.length && givT.length) sc += 0.5; // solo apellido
    }
    const n = (d.T.nMatch.get(id) || 0) + (p.rank ? 1000 - Math.min(999, p.rank) : 0) / 1000;
    if (sc > bestScore || (sc === bestScore && best && n > best._n)) { best = { id, ...p, _n: n, _sc: sc }; bestScore = sc; }
  }
  return bestScore >= 3.5 ? best : (bestScore >= 3 && best && best.rank ? best : null);
}
function playerOf(id) { const d = build(); return d.players[idk(id)] || null; }
function h2h(idA, idB) {
  const d = build(); const F = d.F;
  const rows = []; let wA = 0, wB = 0, gA = 0, gB = 0;
  for (const r of d.rows) {
    const w = r[F.wid], l = r[F.lid];
    if (!((w === idk(idA) && l === idk(idB)) || (w === idk(idB) && l === idk(idA)))) continue;
    const aWon = w === idk(idA); if (aWon) wA++; else wB++;
    gA += aWon ? r[F.wg] : r[F.lg]; gB += aWon ? r[F.lg] : r[F.wg];
    rows.push({ date: r[F.date], dated: !!r[F.dated], winner: aWon ? 'a' : 'b', score: aWon ? `${r[F.wg]}-${r[F.lg]}` : `${r[F.lg]}-${r[F.wg]}`, games: aWon ? String(r[F.games]).split(',').join(' ') : String(r[F.games]).split(',').map((g) => g.split('-').reverse().join('-')).join(' '), tourney: (d.tourneys[r[F.tid]] || {}).name, tier: (d.tourneys[r[F.tid]] || {}).tier, round: r[F.round], bo: r[F.bo] });
  }
  return { w_a: wA, w_b: wB, games_a: gA, games_b: gB, rows: rows.slice(-12).reverse() };
}

module.exports = { reset, build, replay, skillOf, eloOf, thetaOf, eloProb, pointProb, uncertaintyPp, matchModel, formatFor, resolvePlayer, playerOf, h2h, norm, REPO_BASE, DISK_BASE, DEFAULT_PRIORS, archivo, sig, logit };
