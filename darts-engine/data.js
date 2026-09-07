// darts-engine/data.js — LA MEMORIA DE LOS DARDOS: base propia, ratings y catálogo (blueprint 8.0, bloques 5-11)
//
// Carga matches.json (partidos PDC/WDF con estadística de partido: media, 180s, dobles, checkout más alto) y
// reproduce TODO el historial en orden cronológico con las constantes congeladas de model-priors.json →
// Elo cronológico + vector de habilidad por jugador (media, 180 por leg, % de dobles) como EWMA por
// exposición con contracción hacia la población. Es nivel L1 del blueprint (estadísticas de partido): permite
// perfiles regularizados y kernels agregados; NO reconstruye rutas ni misses, y así se dice en pantalla.
//
// La base puede vivir en el disco persistente (la escribe el trabajo de cosecha) y cae al repo si no hay disco.
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_BASE = path.join(__dirname, '..', 'data', 'darts');
const DISK_BASE = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'darts');
// disco primero, repo después; y cada uno en claro o comprimido (.gz): los compactos grandes viajan en gz
const archivo = (n) => { for (const base of [DISK_BASE, REPO_BASE]) { try { const d = path.join(base, n); if (fs.existsSync(d)) return d; if (fs.existsSync(d + '.gz')) return d + '.gz'; } catch { /* sin disco */ } } return path.join(REPO_BASE, n); };
const leer = (p) => { const raw = fs.readFileSync(p); return JSON.parse(p.endsWith('.gz') ? require('zlib').gunzipSync(raw).toString('utf8') : raw.toString('utf8')); };
const logit = (p) => Math.log(p / (1 - p));
const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// constantes por defecto (se sobreescriben con model-priors.json cuando el fit las haya congelado)
const DEFAULT_PRIORS = {
  model_version: 'darts-l1-0',
  constants: {
    kScale: 1.0,          // Elo: K = kScale · 200 / (n+5)^0.4
    halfLifeMatches: 12,  // EWMA del vector de habilidad, en partidos
    shrinkK: 8,           // contracción hacia la población (partidos equivalentes)
    ensembleU: 0.5,       // peso del compilador frente al Elo en el logit del ganador
    popAvg: 88, popPer180: 0.28, popCo: 0.36,   // población de arranque (se re-estima en la pasada)
    formatK: 1.0,         // K del Elo por unidad de formato (legs cortos informan menos)
  },
  holdout: null,
};

let D = null;
function reset() { D = null; }

function readJsonMaybe(p) { try { return leer(p); } catch { return null; } }
// el compacto de Orakel (ventanas de habilidad), con la misma regla disco→repo y gz
function readOrakel() { return readJsonMaybe(archivo('orakel.json')) || { windows: {}, latest: null }; }

function build() {
  if (D) return D;
  const m = readJsonMaybe(archivo('matches.json')) || { schema: [], tourneys: {}, rows: [] };
  const players = readJsonMaybe(archivo('players.json')) || {};
  const priors = readJsonMaybe(path.join(REPO_BASE, 'model-priors.json')) || DEFAULT_PRIORS;
  const meta = readJsonMaybe(archivo('meta.json')) || { last_match_date: null, years: null, sources: [] };
  const cst = { ...DEFAULT_PRIORS.constants, ...(priors.constants || {}) };
  const F = {}; (m.schema || []).forEach((k, i) => { F[k] = i; });
  const rows = (m.rows || []).slice().sort((a, b) => a[F.date] - b[F.date] || (a[F.seq] || 0) - (b[F.seq] || 0));

  const T = {
    cst, elo: new Map(), nMatch: new Map(), prof: new Map(),
    // vector de habilidad: EWMA por exposición (legs) de media, 180/leg y dobles
    skill: new Map(), // id → { avgV, avgW, x180V, x180W, coHit, coAtt, hcMax, n }
    pop: { avgS: 0, avgN: 0, x180S: 0, legsN: 0, coH: 0, coA: 0 },
  };
  const K = (n) => cst.kScale * 200 / Math.pow(n + 5, 0.4);
  const alpha = Math.log(2) / cst.halfLifeMatches;
  const g = (mp, k, d) => (mp.has(k) ? mp.get(k) : d);

  for (const r of rows) {
    const date = r[F.date];
    const A = r[F.wid], B = r[F.lid];
    if (A == null || B == null || A === B) continue;
    const eA = g(T.elo, A, 1500), eB = g(T.elo, B, 1500);
    const pA = 1 / (1 + Math.pow(10, -(eA - eB) / 400));
    const nA = g(T.nMatch, A, 0), nB = g(T.nMatch, B, 0);
    // los formatos cortos informan menos: K escala con la raíz de los legs jugados relativa a 9
    const legs = (r[F.w_legs] || 0) + (r[F.l_legs] || 0);
    const fk = legs > 0 ? clamp(Math.sqrt(legs / 9), 0.6, 1.6) : 1;
    T.elo.set(A, eA + fk * cst.formatK * K(nA) * (1 - pA)); T.elo.set(B, eB - fk * cst.formatK * K(nB) * (1 - pA));
    T.nMatch.set(A, nA + 1); T.nMatch.set(B, nB + 1);

    for (const [id, opp, won, pre] of [[A, B, true, 'w_'], [B, A, false, 'l_']]) {
      // habilidad
      let s = T.skill.get(id);
      if (!s) { s = { avgV: 0, avgW: 0, x180V: 0, x180W: 0, coV: 0, coW: 0, hcMax: 0, n: 0, hc: [] }; T.skill.set(id, s); }
      const avg = r[F[pre + 'avg']], x180 = r[F[pre + 'x180']], coH = r[F[pre + 'co_hit']], coA = r[F[pre + 'co_att']], hc = r[F[pre + 'hc']];
      const myLegs = r[F[pre + 'legs']] || 0, oppLegs = r[F[pre === 'w_' ? 'l_legs' : 'w_legs']] || 0;
      const legsPlayed = myLegs + oppLegs;
      const decay = Math.exp(-alpha);
      s.avgV *= decay; s.avgW *= decay; s.x180V *= decay; s.x180W *= decay; s.coV *= decay; s.coW *= decay;
      if (avg > 40 && avg < 125) { s.avgV += avg * Math.max(1, legsPlayed); s.avgW += Math.max(1, legsPlayed); T.pop.avgS += avg; T.pop.avgN++; }
      if (x180 != null && legsPlayed > 0) { s.x180V += x180; s.x180W += legsPlayed; T.pop.x180S += x180; T.pop.legsN += legsPlayed; }
      if (coA > 0 && coH != null) { s.coV += coH; s.coW += coA; T.pop.coH += coH; T.pop.coA += coA; }
      if (hc > s.hcMax) s.hcMax = hc;
      if (hc >= 100) s.hc.push(hc);
      s.n++;
      // catálogo
      let p = T.prof.get(id);
      if (!p) { p = { w: 0, l: 0, recent: [], lastDate: 0, firstDate: date, tourneys: new Set(), bestAvg: 0, x180Total: 0, legsTotal: 0, legsWon: 0, legsLost: 0, titles: 0 }; T.prof.set(id, p); }
      if (won) p.w++; else p.l++;
      p.lastDate = Math.max(p.lastDate, date);
      if (avg > p.bestAvg && avg < 125) p.bestAvg = avg;
      if (x180 != null) p.x180Total += x180;
      p.legsTotal += legsPlayed; p.legsWon += myLegs; p.legsLost += oppLegs;
      const tn = (m.tourneys[r[F.tid]] || {});
      p.tourneys.add(r[F.tid]);
      if (won && /^F$/i.test(String(r[F.round] || ''))) p.titles++;
      p.recent.push({ d: date, opp, won, score: (won ? r[F.w_sets] != null && r[F.w_sets] !== '' ? r[F.w_sets] + '-' + r[F.l_sets] : myLegs + '-' + oppLegs : r[F.l_sets] != null && r[F.l_sets] !== '' ? r[F.l_sets] + '-' + r[F.w_sets] : myLegs + '-' + oppLegs), avg, x180, co: coA > 0 ? Math.round(100 * coH / coA) : null, hc, t: tn.name || '', round: r[F.round], tid: r[F.tid] });
      if (p.recent.length > 16) p.recent.shift();
    }
  }
  T.popAvg = T.pop.avgN >= 50 ? T.pop.avgS / T.pop.avgN : cst.popAvg;
  T.popPer180 = T.pop.legsN >= 500 ? T.pop.x180S / T.pop.legsN : cst.popPer180;
  T.popCo = T.pop.coA >= 500 ? T.pop.coH / T.pop.coA : cst.popCo;
  D = { F, schema: m.schema || [], tourneys: m.tourneys || {}, rows, players, priors: { ...priors, constants: cst }, meta, T };
  return D;
}

// el vector de habilidad CONTRAÍDO (lo que entra al kernel): media, 180/leg, % de dobles, y su exposición
function skillVector(id) {
  const d = build(); const T = d.T; const cst = T.cst;
  const s = T.skill.get(+id) || T.skill.get(String(id));
  const shr = (v, w, pop, k) => (w > 0 ? (v + pop * k) / (w + k) : pop);
  if (!s) return { avg: T.popAvg, per180: T.popPer180, checkoutPct: T.popCo, n: 0, exposure: 0, cold: true };
  // la exposición de la media va en legs; la de los 180s también; la de dobles en intentos
  const kLegs = cst.shrinkK * 9; // ~ shrinkK partidos de 9 legs
  return {
    avg: shr(s.avgV, s.avgW, T.popAvg, kLegs),
    per180: shr(s.x180V, s.x180W, T.popPer180, kLegs),
    checkoutPct: shr(s.coV, s.coW, T.popCo, cst.shrinkK * 20),
    n: s.n, exposure: Math.round(s.avgW), cold: s.n < 5,
    hc_max: s.hcMax || null,
    raw: { avg: s.avgW > 0 ? s.avgV / s.avgW : null, per180: s.x180W > 0 ? s.x180V / s.x180W : null, checkoutPct: s.coW > 0 ? s.coV / s.coW : null },
  };
}

function eloOf(id) { const d = build(); return d.T.elo.has(+id) ? d.T.elo.get(+id) : (d.T.elo.has(String(id)) ? d.T.elo.get(String(id)) : 1500); }
function eloProb(idA, idB) { return 1 / (1 + Math.pow(10, -(eloOf(idA) - eloOf(idB)) / 400)); }

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// resuelve "Luke Humphries" / "humphries" / "L. Humphries" → jugador de la base
function resolvePlayer(name) {
  const d = build();
  const q = norm(name);
  if (!q) return null;
  const qParts = q.split(' ');
  const qLast = qParts[qParts.length - 1];
  let best = null, bestScore = 0;
  for (const [id, p] of Object.entries(d.players)) {
    const n = norm(p.name);
    if (n === q) return { id, ...p };
    const aliases = (p.aliases || []).map(norm);
    if (aliases.includes(q)) return { id, ...p };
    const nParts = n.split(' ');
    const nLast = nParts[nParts.length - 1];
    let sc = 0;
    if (nLast === qLast) sc = 2;                       // mismo apellido
    if (sc && qParts.length > 1 && nParts[0] && nParts[0][0] === qParts[0][0]) sc += 1; // misma inicial
    if (n.includes(q) || q.includes(n)) sc += 1.5;
    if (sc > bestScore) {
      const prof = d.T.prof.get(+id) || d.T.prof.get(id);
      const hist = prof ? prof.w + prof.l : 0;
      best = { id, ...p, _hist: hist, _sc: sc }; bestScore = sc;
    } else if (sc && sc === bestScore && best) {
      const prof = d.T.prof.get(+id) || d.T.prof.get(id);
      const hist = prof ? prof.w + prof.l : 0;
      if (hist > (best._hist || 0)) best = { id, ...p, _hist: hist, _sc: sc };
    }
  }
  return bestScore >= 2 ? best : null;
}
function playerOf(id) { const d = build(); return d.players[id] || d.players[String(id)] || null; }

module.exports = { reset, build, skillVector, eloOf, eloProb, resolvePlayer, playerOf, norm, REPO_BASE, DISK_BASE, DEFAULT_PRIORS, readOrakel, archivo };
