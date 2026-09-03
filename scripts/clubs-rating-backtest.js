#!/usr/bin/env node
'use strict';
// scripts/clubs-rating-backtest.js — ¿QUÉ RATING BATE AL DE RESULTADOS? (3-sep-2026, BACKTESTS_FAMILIAS §3.6)
//
// Walk-forward por división y temporada con football-data.co.uk (resultados + cierre Pinnacle PSCH/PSCD/PSCA;
// la misma descarga que scripts/clubs-closes-fd.js, con 2122 y 2223 añadidas). Cada partido se predice con los
// ratings PRE-partido y el MISMO engine.matchProbs de producción (Elo→Poisson→Dixon-Coles→calibración);
// entre temporadas, regresión a la media (parámetro) y prior para los recién llegados.
//
// Variantes (clubs-engine/eloOdds.js comparte la matemática con el servidor y el smoke):
//   A  Elo de RESULTADOS con las constantes de producción (K=30, factor G por margen, localía por división).
//   B  Elo alimentado con CUOTAS (Wunderlich-Memmert): la observación es p_local + ½·p_empate del cierre sin
//      margen (Shin, lib/devig.js); K_odds elegido en desarrollo.
//   C  Híbrido: Δ = w·Δ_cuotas + (1−w)·Δ_resultado (w elegido en desarrollo).
//   D  A o B con prior de inicio de temporada = rating final anterior regresado a la media (alpha) y recién
//      llegados al promedio de los que se fueron (en vez de 1500).
//   SQ (opcional, --squad <json>) prior de plantilla para 2526: rating inicial = a + b·log(valor), (a,b) por
//      mínimos cuadrados contra el rating final de 2425 con los valores ACTUALES (sesgo de supervivencia
//      reconocido: los valores son los de hoy, no los de agosto de 2025).
//
// Métrica principal: log-loss y Brier (3 resultados) contra el resultado, por temporada, comparados con el
// cierre Pinnacle (Shin) y con A mediante diferencias PAREADAS por partido (t = media/SE) y bootstrap pareado.
// Secundaria: ROI de la regla `lead` de producción (0,5·modelo + 0,5·mercado, ventaja ≥ 2 pp, solo local/
// visita) bajo cada rating: se decide contra la cuota de Pinnacle previa (PSH/PSD/PSA, la "creación") y se
// liquida a la de cierre (PSC) — y también a la de creación, por comparar.
// Desarrollo = --dev (default 2122 calentamiento + 2223 + 2324); evaluación = --eval (default 2425 + 2526).
//
// Uso: node scripts/clubs-rating-backtest.js [--out <dir>] [--seasons 2122,2223,2324,2425,2526] [--dev 2122,2223,2324]
//        [--eval 2425,2526] [--no-download] [--pool division|country] [--squad <json>] [--md <file>] [--json <file>]
// Sin red usa lo que haya en <out>. Los CSV NO se embarcan en el repo.

const fs = require('fs');
const path = require('path');
const { shinDevig } = require('../lib/devig');
const { matchProbs } = require('../engine');
const EO = require('../clubs-engine/eloOdds');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const OUT = arg('--out', process.env.FD_DIR || path.join(process.env.SP || '/tmp', 'fd'));
const SEASONS = String(arg('--seasons', '2122,2223,2324,2425,2526')).split(',').map((s) => s.trim()).filter(Boolean);
const DEV = String(arg('--dev', '2122,2223,2324')).split(',').map((s) => s.trim()).filter(Boolean);
const EVAL = String(arg('--eval', '2425,2526')).split(',').map((s) => s.trim()).filter(Boolean);
const WARM = DEV[0]; // primera temporada de desarrollo: solo calienta ratings, no puntúa
const DIVS = ['E0', 'E1', 'E2', 'E3', 'D1', 'D2', 'SP1', 'SP2', 'I1', 'I2', 'F1', 'F2', 'N1', 'P1', 'B1', 'T1', 'G1', 'SC0'];
const NO_DL = args.includes('--no-download');
const POOL = arg('--pool', 'division');
const SQUAD_FILE = arg('--squad', null);
const MD_FILE = arg('--md', null);
const JSON_FILE = arg('--json', path.join(OUT, 'rating-backtest.json'));
const EARLY_ROUNDS = 8;
fs.mkdirSync(OUT, { recursive: true });

// ── descarga (misma lógica que clubs-closes-fd.js) ───────────────────────────────────────────────────────
async function download(season, div) {
  const file = path.join(OUT, `${season}-${div}.csv`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return { file, cached: true };
  if (NO_DL) return { file: null, error: 'no-download' };
  const url = `https://www.football-data.co.uk/mmz4281/${season}/${div}.csv`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return { file: null, error: `http ${r.status}` };
    const txt = await r.text();
    if (!/FTHG/.test(txt)) return { file: null, error: 'sin columnas' };
    fs.writeFileSync(file, txt);
    return { file, cached: false };
  } catch (e) { return { file: null, error: e.message }; }
}
function parseCsv(txt) {
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  const split = (l) => { const o = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; };
  const H = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => { const c = split(l); const o = {}; H.forEach((h, i) => { o[h] = c[i]; }); return o; });
}
function parseDate(d, t) {
  const m = /^(\d{2})\/(\d{2})\/(\d{2,4})$/.exec(String(d || '').trim()); if (!m) return NaN;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const tm = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
  return Date.UTC(y, Number(m[2]) - 1, Number(m[1]), tm ? Number(tm[1]) : 12, tm ? Number(tm[2]) : 0);
}
const odds3 = (row, pre) => { const o = [Number(row[pre + 'H']), Number(row[pre + 'D']), Number(row[pre + 'A'])]; return o.every((x) => x > 1) ? o : null; };
const fairOf = (o) => { if (!o) return null; const s = shinDevig(o); return s.status === 'ok' ? { home: s.probabilities[0], draw: s.probabilities[1], away: s.probabilities[2] } : null; };

// ── carga ─────────────────────────────────────────────────────────────────────────────────────────────────
async function loadMatches() {
  const all = [], files = [];
  for (const s of SEASONS) for (const d of DIVS) {
    const r = await download(s, d); files.push({ season: s, div: d, ...r });
    if (!r.file) continue;
    for (const row of parseCsv(fs.readFileSync(r.file, 'utf8'))) {
      if (!['H', 'D', 'A'].includes(row.FTR)) continue;
      const hg = Number(row.FTHG), ag = Number(row.FTAG); if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
      const ts = parseDate(row.Date, row.Time); if (!Number.isFinite(ts)) continue;
      let close = null, src = null;
      for (const pre of ['PSC', 'PS', 'AvgC']) { const o = odds3(row, pre); if (o) { close = o; src = pre; break; } }
      if (!close) continue;
      const open = odds3(row, 'PS') || null; // Pinnacle previo al cierre (viernes/martes) = "creación"
      all.push({ season: s, div: d, ts, home: row.HomeTeam.trim(), away: row.AwayTeam.trim(), hg, ag, ftr: row.FTR,
        close, closeSrc: src, fair: fairOf(close), open, fairOpen: open ? fairOf(open) : null });
    }
  }
  return { rows: all.filter((m) => m.fair), files };
}

// ── walk-forward ──────────────────────────────────────────────────────────────────────────────────────────
const poolOf = (m) => (POOL === 'country' ? m.div.replace(/\d+$/, '') : m.div);

// Localía por división: se resuelve iterativamente (como clubs-engine/ratings.fit) sobre las temporadas de
// desarrollo para que la esperanza media del local iguale a la observada (resultado para A/C, esperanza del
// mercado para B). Un solo parámetro por división, congelado antes de evaluar.
function fitHfa(rowsByPool, cfg) {
  const hfa = {};
  for (const [pool, rows] of Object.entries(rowsByPool)) {
    let h = 60;
    for (let it = 0; it < 6; it++) {
      const r = runPool(rows, { ...cfg, hfa: { [pool]: h }, devOnly: true });
      const gap = r.targetAvg - r.expAvg;
      if (Math.abs(gap) < 0.002) break;
      h = Math.max(0, Math.min(160, h + gap * 700));
    }
    hfa[pool] = Math.round(h);
  }
  return hfa;
}

// runPool(rows, cfg) → registros por partido (en el orden de rows). cfg: { update, kOdds, w, alpha, newcomer,
// hfa:{pool}, squad:{prior por equipo para SQ_SEASON}, squadBeta, devOnly }
function runPool(rows, cfg) {
  const R = {}, games = {}, seasonGames = {};
  let curSeason = null, expSum = 0, targetSum = 0, nT = 0;
  const out = [];
  const pool = poolOf(rows[0]);
  const hfa = (cfg.hfa && cfg.hfa[pool] != null) ? cfg.hfa[pool] : 60;
  const teamsBySeason = {};
  for (const m of rows) { (teamsBySeason[m.season] = teamsBySeason[m.season] || new Set()).add(m.home); teamsBySeason[m.season].add(m.away); }
  const seasonsSeen = [];
  for (const m of rows) {
    if (cfg.devOnly && !DEV.includes(m.season)) break;
    if (m.season !== curSeason) {
      // transición de temporada: regresión a la media + prior para los recién llegados
      const prev = curSeason; curSeason = m.season; seasonsSeen.push(m.season);
      for (const k of Object.keys(seasonGames)) seasonGames[k] = 0;
      if (prev) {
        const gone = [...teamsBySeason[prev]].filter((t) => !teamsBySeason[m.season].has(t));
        const goneMean = gone.length ? gone.reduce((s, t) => s + R[t], 0) / gone.length : EO.BASE_ELO;
        const reg = EO.regressSeason(R, cfg.alpha || 0);
        for (const t of Object.keys(reg)) R[t] = reg[t];
        for (const t of teamsBySeason[m.season]) if (R[t] == null) { R[t] = cfg.newcomer === 'departed' ? goneMean : EO.BASE_ELO; games[t] = 0; }
        // prior de plantilla (solo la temporada configurada): mezcla beta·prior_valor + (1−beta)·arrastre
        if (cfg.squad && cfg.squadSeason === m.season && cfg.squad[m.div]) {
          const pri = cfg.squad[m.div];
          for (const t of teamsBySeason[m.season]) if (pri[t] != null) R[t] = cfg.squadBeta * pri[t] + (1 - cfg.squadBeta) * R[t];
        }
      }
    }
    const h = m.home, a = m.away;
    if (R[h] == null) { R[h] = EO.BASE_ELO; games[h] = 0; }
    if (R[a] == null) { R[a] = EO.BASE_ELO; games[a] = 0; }
    seasonGames[h] = seasonGames[h] || 0; seasonGames[a] = seasonGames[a] || 0;
    const round = Math.min(seasonGames[h], seasonGames[a]) + 1;
    const pr = matchProbs(R[h] + hfa, R[a]);
    const y = m.ftr === 'H' ? 0 : m.ftr === 'D' ? 1 : 2;
    const pm = [pr.home, pr.draw, pr.away];
    const ll = -Math.log(Math.max(1e-9, pm[y]));
    const br = pm.reduce((s, p, i) => s + (p - (i === y ? 1 : 0)) ** 2, 0);
    // regla `lead`: blend 0,5 contra el mercado de creación (PS; si falta, el cierre), ventaja ≥ 2 pp, local/visita
    const mk = m.fairOpen || m.fair;
    let pick = null;
    for (const [i, side] of [[0, 'home'], [2, 'away']]) {
      const k = mk[side], blend = 0.5 * pm[i] + 0.5 * k, eg = blend - k;
      if (eg >= 0.02 && (!pick || eg > pick.eg)) pick = { i, side, eg };
    }
    let pnlClose = null, pnlOpen = null;
    if (pick) {
      const won = y === pick.i;
      pnlClose = won ? m.close[pick.i] - 1 : -1;
      const oo = m.open || m.close; pnlOpen = won ? oo[pick.i] - 1 : -1;
    }
    out.push({ ll, br, round, pnlClose, pnlOpen, pModel: pm, elos: [R[h], R[a]] });
    // objetivo de localía (solo temporadas de desarrollo)
    if (DEV.includes(m.season)) {
      const we = EO.winExpectancy(R[h], R[a], hfa);
      expSum += we; nT++;
      targetSum += (cfg.update === 'odds') ? EO.marketExpectancy(m.fair) : (m.hg > m.ag ? 1 : m.hg === m.ag ? 0.5 : 0);
    }
    // actualización POST-partido (walk-forward: el cierre del partido t solo entra tras t)
    const { delta } = EO.combinedDelta({ eH: R[h], eA: R[a], hfa, hg: m.hg, ag: m.ag, fair: m.fair, mode: cfg.update, w: cfg.w, kOdds: cfg.kOdds, kResult: EO.K_RESULT });
    R[h] += delta; R[a] -= delta;
    games[h]++; games[a]++; seasonGames[h]++; seasonGames[a]++;
  }
  return { records: out, expAvg: nT ? expSum / nT : 0.5, targetAvg: nT ? targetSum / nT : 0.5, ratings: R };
}

function runAll(rowsByPool, cfg) {
  const rec = [];
  const finalRatings = {};
  for (const [pool, rows] of Object.entries(rowsByPool)) {
    const r = runPool(rows, cfg);
    rec.push(...r.records.map((x, i) => ({ ...x, idx: rows[i].idx })));
    finalRatings[pool] = r.ratings;
  }
  rec.sort((a, b) => a.idx - b.idx);
  return { records: rec, finalRatings };
}

// ── estadística ───────────────────────────────────────────────────────────────────────────────────────────
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN;
const sd = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
function pairedStats(diff, B = 2000, seed = 7) {
  const n = diff.length; if (!n) return { n: 0 };
  const m = mean(diff), s = sd(diff), se = s / Math.sqrt(n);
  // bootstrap pareado (mulberry32 determinista)
  let st = seed >>> 0; const rnd = () => { st |= 0; st = (st + 0x6D2B79F5) | 0; let t = Math.imul(st ^ (st >>> 15), 1 | st); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const boots = [];
  for (let b = 0; b < B; b++) { let s2 = 0; for (let i = 0; i < n; i++) s2 += diff[(rnd() * n) | 0]; boots.push(s2 / n); }
  boots.sort((x, y) => x - y);
  return { n, mean: m, se, t: se > 0 ? m / se : 0, ci_lo: boots[Math.floor(0.025 * B)], ci_hi: boots[Math.floor(0.975 * B)] };
}
function roiStats(pnls) {
  const a = pnls.filter((x) => x != null); if (!a.length) return { n: 0 };
  const m = mean(a), s = sd(a) || 0, se = a.length > 1 ? s / Math.sqrt(a.length) : NaN;
  return { n: a.length, roi: m, se, t: se > 0 ? m / se : 0, units: a.reduce((x, y) => x + y, 0) };
}

const f4 = (x) => (Number.isFinite(x) ? x.toFixed(4) : '—').replace('.', ',');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—').replace('.', ',');
const pct = (x) => (Number.isFinite(x) ? (100 * x).toFixed(1) + ' %' : '—').replace('.', ',');
const sgn = (x) => (x > 0 ? '+' : '') + f4(x);

// ── main ──────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const { rows, files } = await loadMatches();
  rows.sort((a, b) => a.ts - b.ts || a.div.localeCompare(b.div) || a.home.localeCompare(b.home));
  rows.forEach((m, i) => { m.idx = i; });
  const rowsByPool = {};
  for (const m of rows) (rowsByPool[poolOf(m)] = rowsByPool[poolOf(m)] || []).push(m);
  const seasonsScored = SEASONS.filter((s) => s !== WARM);
  const devScored = DEV.filter((s) => s !== WARM);
  console.error(`partidos ${rows.length} · pools ${Object.keys(rowsByPool).length} · temporadas ${SEASONS.join(',')} (calienta ${WARM}; dev ${devScored.join(',')}; eval ${EVAL.join(',')})`);

  // referencia: cierre (Shin) y creación (Shin de PS)
  const yOf = (m) => (m.ftr === 'H' ? 0 : m.ftr === 'D' ? 1 : 2);
  const llClose = rows.map((m) => -Math.log([m.fair.home, m.fair.draw, m.fair.away][yOf(m)]));
  const brClose = rows.map((m) => [m.fair.home, m.fair.draw, m.fair.away].reduce((s, p, i) => s + (p - (i === yOf(m) ? 1 : 0)) ** 2, 0));
  // TECHO del transform rating→probabilidad: el rating implícito del PROPIO cierre (diferencia de Elo que
  // reproduce p_local+½·p_empate) pasado por matchProbs. Un rating no puede hacerlo mejor que esto con este
  // transform; la distancia techo→cierre es lo que pierde matchProbs (Poisson+DC+calibración), no el rating.
  const ceil = rows.map((m) => { const pr = matchProbs(EO.BASE_ELO + EO.ratingDiffFromExpectancy(EO.marketExpectancy(m.fair)), EO.BASE_ELO); return [pr.home, pr.draw, pr.away]; });
  const llCeil = rows.map((m, i) => -Math.log(ceil[i][yOf(m)]));
  const brCeil = rows.map((m, i) => ceil[i].reduce((s, p, j) => s + (p - (j === yOf(m) ? 1 : 0)) ** 2, 0));
  const inSeason = (set) => rows.map((m, i) => (set.includes(m.season) ? i : -1)).filter((i) => i >= 0);

  // localía por división (dev) para cada familia de actualización
  const hfaRes = fitHfa(rowsByPool, { update: 'results' });
  const hfaOdds = fitHfa(rowsByPool, { update: 'odds', kOdds: EO.K_ODDS });
  console.error('hfa (resultados):', JSON.stringify(hfaRes));
  console.error('hfa (cuotas):', JSON.stringify(hfaOdds));

  const variants = {}; // nombre → { cfg, records }
  const add = (name, cfg) => { variants[name] = { cfg, ...runAll(rowsByPool, cfg) }; return variants[name]; };
  const devLL = (v) => mean(inSeason(devScored).map((i) => v.records[i].ll));

  // A: producción
  add('A', { update: 'results', alpha: 0, newcomer: '1500', hfa: hfaRes });
  // B: cuotas — K en desarrollo
  // Con la logística de Elo un paso de K cierra ≈ K·ln(10)/400·E(1−E) ≈ K·0,00144 de la brecha por equipo (0,36
  // con K=250; los dos equipos suman 0,72): K≈350 cierra la brecha entera en un partido, más allá sobrepasa.
  const kGrid = [30, 60, 120, 180, 250, 300, 350, 400, 500];
  const tuneB = kGrid.map((k) => ({ k, ll: devLL(add(`B_k${k}`, { update: 'odds', kOdds: k, alpha: 0, newcomer: '1500', hfa: hfaOdds })) }));
  // regla declarada: entre 250 y 300 el log-loss es una meseta (difieren en la 5ª cifra) → el K MENOR dentro de
  // 0,0001 del mínimo (parsimonia: menos sobrepaso cuando el mercado se mueve mucho entre partidos)
  const minB = Math.min(...tuneB.map((x) => x.ll));
  const bestK = tuneB.filter((x) => x.ll <= minB + 1e-4).sort((a, b) => a.k - b.k)[0].k;
  add('B', variants[`B_k${bestK}`].cfg);
  // C: híbrido — w en desarrollo (K de B)
  const wGrid = [0.25, 0.5, 0.75, 0.9];
  const tuneC = wGrid.map((w) => ({ w, ll: devLL(add(`C_w${w}`, { update: 'hybrid', kOdds: bestK, w, alpha: 0, newcomer: '1500', hfa: hfaRes })) }));
  const bestW = tuneC.reduce((b, x) => (x.ll < b.ll ? x : b)).w;
  add('C', variants[`C_w${bestW}`].cfg);
  // D: regresión + recién llegados, sobre A y sobre B
  const aGrid = [0, 0.1, 0.2, 0.3, 0.5];
  const tuneDA = aGrid.map((al) => ({ al, ll: devLL(add(`DA_a${al}`, { update: 'results', alpha: al, newcomer: 'departed', hfa: hfaRes })) }));
  const bestAlA = tuneDA.reduce((b, x) => (x.ll < b.ll ? x : b)).al;
  add('D_A', variants[`DA_a${bestAlA}`].cfg);
  const tuneDB = aGrid.map((al) => ({ al, ll: devLL(add(`DB_a${al}`, { update: 'odds', kOdds: bestK, alpha: al, newcomer: 'departed', hfa: hfaOdds })) }));
  const bestAlB = tuneDB.reduce((b, x) => (x.ll < b.ll ? x : b)).al;
  add('D_B', variants[`DB_a${bestAlB}`].cfg);
  add('D_C', { update: 'hybrid', kOdds: bestK, w: bestW, alpha: bestAlA, newcomer: 'departed', hfa: hfaRes });

  // SQ: prior de plantilla (si hay valores)
  let squadNote = null;
  if (SQUAD_FILE && fs.existsSync(SQUAD_FILE)) {
    const sq = JSON.parse(fs.readFileSync(SQUAD_FILE, 'utf8'));
    const SQ_SEASON = EVAL[EVAL.length - 1];
    const prevSeason = SEASONS[SEASONS.indexOf(SQ_SEASON) - 1];
    // rating de referencia: final de la temporada previa (A) → (a,b) por división por mínimos cuadrados
    const refRun = runAll(Object.fromEntries(Object.entries(rowsByPool).map(([p, rs]) => [p, rs.filter((m) => SEASONS.indexOf(m.season) <= SEASONS.indexOf(prevSeason))])), variants.A.cfg);
    const prior = {}; let nFit = 0, nTeams = 0; const fits = {};
    for (const div of DIVS) {
      const vals = (sq.values && sq.values[div]) || {};
      const pool = POOL === 'country' ? div.replace(/\d+$/, '') : div;
      const Rf = refRun.finalRatings[pool] || {};
      const xs = [], ys = [];
      for (const [team, v] of Object.entries(vals)) { if (v > 0 && Rf[team] != null) { xs.push(Math.log(v)); ys.push(Rf[team]); } }
      nTeams += Object.keys(vals).length;
      if (xs.length < 6) continue;
      const mx = mean(xs), my = mean(ys);
      const b = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
      const a = my - b * mx;
      const r = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0) * ys.reduce((s, y) => s + (y - my) ** 2, 0));
      fits[div] = { n: xs.length, a: +a.toFixed(1), b: +b.toFixed(1), r: +r.toFixed(3) };
      prior[div] = {}; for (const [team, v] of Object.entries(vals)) if (v > 0) { prior[div][team] = a + b * Math.log(v); nFit++; }
    }
    squadNote = { file: SQUAD_FILE, season: SQ_SEASON, fitted_against: prevSeason, teams_with_value: nTeams, teams_with_prior: nFit, fits };
    for (const beta of [0.5, 1]) {
      add(`SQ_A_b${beta}`, { ...variants.D_A.cfg, squad: prior, squadSeason: SQ_SEASON, squadBeta: beta });
      add(`SQ_B_b${beta}`, { ...variants.D_B.cfg, squad: prior, squadSeason: SQ_SEASON, squadBeta: beta });
    }
  } else if (SQUAD_FILE) squadNote = { file: SQUAD_FILE, missing: true };

  // ── tablas ──
  const md = [];
  const finals = ['A', 'B', 'C', 'D_A', 'D_B', 'D_C'].concat(Object.keys(variants).filter((k) => k.startsWith('SQ_')));
  const label = { A: 'A · Elo resultados (producción)', B: `B · Elo cuotas (K=${bestK})`, C: `C · híbrido (w=${bestW}, K=${bestK})`, D_A: `D_A · A + regresión α=${bestAlA} + llegados=media salidos`, D_B: `D_B · B + regresión α=${bestAlB} + llegados=media salidos`, D_C: `D_C · C + regresión α=${bestAlA} + llegados=media salidos` };
  for (const k of finals) if (!label[k]) label[k] = `${k} · prior de plantilla (β=${k.split('_b')[1]}) sobre ${k.includes('_A_') ? 'D_A' : 'D_B'}`;
  const src = {}; for (const m of rows) src[m.closeSrc] = (src[m.closeSrc] || 0) + 1;
  md.push(`Partidos: ${rows.length} (${SEASONS.join(', ')}; ${DIVS.length} divisiones; cierre Pinnacle PSC ${src.PSC || 0}, PS ${src.PS || 0}, media AvgC ${src.AvgC || 0}; con cuota previa PS: ${rows.filter((m) => m.open).length}). Pool: ${POOL}. Calentamiento: ${WARM}; desarrollo: ${devScored.join(', ')}; evaluación: ${EVAL.join(', ')}.`);
  md.push('');
  md.push(`Localía por división ajustada en desarrollo — resultados: ${Object.entries(hfaRes).map(([d, h]) => `${d} ${h}`).join(', ')}.`);
  md.push(`Localía por división ajustada en desarrollo — cuotas: ${Object.entries(hfaOdds).map(([d, h]) => `${d} ${h}`).join(', ')}.`);
  md.push('');
  md.push('### Desarrollo de parámetros (log-loss medio en ' + devScored.join('+') + ')');
  md.push('');
  md.push('| Variante | Parámetro | Log-loss dev |'); md.push('|---|---|---:|');
  for (const x of tuneB) md.push(`| B | K_odds=${x.k} | ${f4(x.ll)}${x.k === bestK ? ' ←' : ''} |`);
  for (const x of tuneC) md.push(`| C | w=${x.w} (K=${bestK}) | ${f4(x.ll)}${x.w === bestW ? ' ←' : ''} |`);
  for (const x of tuneDA) md.push(`| D_A | α=${x.al} | ${f4(x.ll)}${x.al === bestAlA ? ' ←' : ''} |`);
  for (const x of tuneDB) md.push(`| D_B | α=${x.al} (K=${bestK}) | ${f4(x.ll)}${x.al === bestAlB ? ' ←' : ''} |`);
  md.push(`| — | A (referencia) | ${f4(devLL(variants.A))} |`);
  md.push(`| — | Cierre Pinnacle (Shin) | ${f4(mean(inSeason(devScored).map((i) => llClose[i])))} |`);
  md.push('');

  const summary = { generated_at: new Date().toISOString(), seasons: SEASONS, dev: DEV, eval: EVAL, pool: POOL, n: rows.length, hfa: { results: hfaRes, odds: hfaOdds }, tuning: { B: tuneB, C: tuneC, D_A: tuneDA, D_B: tuneDB, bestK, bestW, bestAlA, bestAlB }, squad: squadNote, by_season: {}, early: {}, roi: {} };
  const perSeasonBlock = (title, idxOf) => {
    md.push(`### ${title}`); md.push('');
    md.push('| Temporada | n | Variante | Log-loss | Brier | Δ log-loss vs A (t) [IC 95 %] | Δ log-loss vs cierre (t) | Δ Brier vs A (t) |');
    md.push('|---|---:|---|---:|---:|---:|---:|---:|');
    for (const s of seasonsScored) {
      const idx = idxOf(s); if (!idx.length) continue;
      const tag = EVAL.includes(s) ? `**${s}** (eval)` : `${s} (dev)`;
      md.push(`| ${tag} | ${idx.length} | Cierre Pinnacle (Shin) | ${f4(mean(idx.map((i) => llClose[i])))} | ${f4(mean(idx.map((i) => brClose[i])))} | — | — | — |`);
      const dCe = pairedStats(idx.map((i) => llCeil[i] - llClose[i]), 400);
      summary.by_season[`${title}|${s}|techo`] = { n: idx.length, logloss: mean(idx.map((i) => llCeil[i])), brier: mean(idx.map((i) => brCeil[i])), vsClose: dCe };
      md.push(`| ${tag} | ${idx.length} | Techo del transform (rating implícito del propio cierre → matchProbs) | ${f4(mean(idx.map((i) => llCeil[i])))} | ${f4(mean(idx.map((i) => brCeil[i])))} | — | ${sgn(dCe.mean)} (t ${f2(dCe.t)}) | — |`);
      for (const k of finals) {
        const v = variants[k];
        const ll = idx.map((i) => v.records[i].ll), br = idx.map((i) => v.records[i].br);
        const dA = pairedStats(idx.map((i) => v.records[i].ll - variants.A.records[i].ll));
        const dC = pairedStats(idx.map((i) => v.records[i].ll - llClose[i]), 400);
        const dB = pairedStats(idx.map((i) => v.records[i].br - variants.A.records[i].br), 400);
        summary.by_season[`${title}|${s}|${k}`] = { n: idx.length, logloss: mean(ll), brier: mean(br), vsA: dA, vsClose: dC, brierVsA: dB, logloss_close: mean(idx.map((i) => llClose[i])) };
        md.push(`| ${tag} | ${idx.length} | ${label[k]} | ${f4(mean(ll))} | ${f4(mean(br))} | ${k === 'A' ? '—' : `${sgn(dA.mean)} (t ${f2(dA.t)}) [${sgn(dA.ci_lo)}, ${sgn(dA.ci_hi)}]`} | ${sgn(dC.mean)} (t ${f2(dC.t)}) | ${k === 'A' ? '—' : `${sgn(dB.mean)} (t ${f2(dB.t)})`} |`);
      }
    }
    md.push('');
  };
  perSeasonBlock('Métrica principal — todas las jornadas', (s) => inSeason([s]));
  perSeasonBlock(`Primeras ${EARLY_ROUNDS} jornadas (arranque de temporada)`, (s) => inSeason([s]).filter((i) => variants.A.records[i].round <= EARLY_ROUNDS));

  md.push('### ROI de la regla `lead` (0,5·modelo + 0,5·mercado de creación, ventaja ≥ 2 pp, local/visita)');
  md.push('');
  md.push('| Temporada | Variante | n picks | ROI a cierre (PSC) | SE | t | ROI a creación (PS) | Unidades a cierre |');
  md.push('|---|---|---:|---:|---:|---:|---:|---:|');
  for (const s of seasonsScored) {
    const idx = inSeason([s]); if (!idx.length) continue;
    const tag = EVAL.includes(s) ? `**${s}** (eval)` : `${s} (dev)`;
    for (const k of finals) {
      const v = variants[k];
      const rc = roiStats(idx.map((i) => v.records[i].pnlClose)), ro = roiStats(idx.map((i) => v.records[i].pnlOpen));
      summary.roi[`${s}|${k}`] = { close: rc, open: ro };
      md.push(`| ${tag} | ${label[k]} | ${rc.n} | ${pct(rc.roi)} | ${pct(rc.se)} | ${f2(rc.t)} | ${pct(ro.roi)} | ${f2(rc.units)} |`);
    }
  }
  md.push('');
  if (squadNote) md.push(`Prior de plantilla: ${JSON.stringify(squadNote)}`);
  const missing = files.filter((f) => !f.file);
  if (missing.length) md.push(`\nFicheros no disponibles (${missing.length}): ${missing.map((f) => `${f.season}/${f.div} (${f.error})`).join(', ')}.`);
  const text = md.join('\n');
  console.log(text);
  if (MD_FILE) fs.writeFileSync(MD_FILE, text + '\n');
  fs.writeFileSync(JSON_FILE, JSON.stringify(summary, null, 1));
  console.error(`→ ${JSON_FILE}${MD_FILE ? ' · ' + MD_FILE : ''}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
