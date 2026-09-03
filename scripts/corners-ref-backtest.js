#!/usr/bin/env node
'use strict';
// scripts/corners-ref-backtest.js — ¿el ÁRBITRO añade información al TOTAL de córners? (3-sep-2026)
//
// Datos: football-data.co.uk (columnas HC/AC = córners local/visitante, Referee). Solo las divisiones que
// traen árbitro: E0-E3 (Inglaterra) y SC0 (Escocia). SP1/D1/I1/F1 traen córners pero NO árbitro → quedan fuera.
// Temporadas 2122-2627 (la 2627 son las primeras jornadas).
//
// Tres modelos del TOTAL de córners, walk-forward por FECHA (cada partido se predice solo con partidos de
// fechas anteriores; una fecha ≈ una jornada):
//   M0  base        = media de la liga (lo que hace producción con TOTALS_DAMP=0)
//   M1  +equipos    = media de liga × cociente a favor/en contra por equipo con encogimiento (K_team), total
//                     amortiguado con exponente DAMP (mismo diseño que prop-engine/model.js)
//   M2  +árbitro    = M1 × multiplicador del árbitro (clubs-engine/referees.js: efecto aleatorio con
//                     encogimiento empírico-Bayes sobre los cocientes total/esperado de SUS partidos previos)
// Distribución: Binomial Negativa con dispersión r ajustada en DESARROLLO (2122+2223) por máxima verosimilitud
// sobre las predicciones walk-forward. K_team, DAMP y K_ref también se eligen en desarrollo; el veredicto se
// lee en TEST (2324-2627). Métricas: MAE, CRPS, log-score, Brier de P(over) en líneas sintéticas (mediana de
// liga ±0,5/±1,5). Comparaciones pareadas (t iid + bootstrap pareado por partido), por liga y global.
// Pregunta extra: varianza entre partidos explicada por el árbitro una vez controlados los equipos (ANOVA de
// efectos aleatorios sobre los residuos + permutación + fiabilidad mitad/mitad).
//
// Uso: node scripts/corners-ref-backtest.js [--fd <dir>] [--out <dir>] [--no-download] [--boot 2000]
// Salida: Markdown por stdout + <out>/corners-ref-summary.json. Sin red usa lo que haya en <fd>.

const fs = require('fs');
const path = require('path');
const { nbPmf } = require('../goal-engine/negativeBinomial');
const REF = require('../clubs-engine/referees');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const FD = arg('--fd', process.env.FD_DIR || path.join(process.env.SP || '/tmp', 'fd'));
const OUT = arg('--out', FD);
const NO_DL = args.includes('--no-download');
const NBOOT = Number(arg('--boot', 2000));
const SEASONS = String(arg('--seasons', '2122,2223,2324,2425,2526,2627')).split(',').map((s) => s.trim()).filter(Boolean);
const DIVS = String(arg('--divs', 'E0,E1,E2,E3,SC0')).split(',').map((s) => s.trim()).filter(Boolean);
const DEV_SEASONS = new Set(String(arg('--dev', '2122,2223')).split(','));
const MIN_LEAGUE_N = 60;   // partidos previos de la liga necesarios para evaluar (calentamiento)
const TEAM_WINDOW = 46;    // últimos partidos del equipo que cuentan (≈ una temporada)
const KMAX = 60;           // soporte de la NB para CRPS/Brier
fs.mkdirSync(OUT, { recursive: true });

// ── descarga + parseo ────────────────────────────────────────────────────────────────────────────────────
async function download(season, div) {
  const file = path.join(FD, `${season}-${div}.csv`);
  if (fs.existsSync(file) && fs.statSync(file).size > 500) return file;
  if (NO_DL) return null;
  try {
    const r = await fetch(`https://www.football-data.co.uk/mmz4281/${season}/${div}.csv`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const txt = await r.text();
    if (!/FTHG/.test(txt)) return null;
    fs.writeFileSync(file, txt);
    return file;
  } catch { return null; }
}
function parseCsv(txt) {
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  const split = (l) => { const o = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; };
  const H = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => { const c = split(l); const o = {}; H.forEach((h, i) => { o[h] = (c[i] || '').trim(); }); return o; });
}
function parseDate(s) { // dd/mm/yy o dd/mm/yyyy
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/); if (!m) return null;
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return `${y}-${m[2]}-${m[1]}`;
}

// ── utilidades estadísticas ──────────────────────────────────────────────────────────────────────────────
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const variance = (a) => { if (a.length < 2) return 0; const m = mean(a); return a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1); };
const sd = (a) => Math.sqrt(variance(a));
const median = (a) => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const fmt = (x, d = 3) => (x == null || !isFinite(x) ? '—' : x.toFixed(d).replace('.', ','));
const fmtS = (x, d = 3) => (x == null || !isFinite(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(d).replace('.', ','));
// generador determinista (bootstrap reproducible)
let seed = 20260903; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
function pairedTest(diff) { // diff = métrica_A − métrica_B por partido; negativo = A mejor
  const n = diff.length; if (n < 3) return { n, mean: null, se: null, t: null, lo: null, hi: null, p_boot: null };
  const m = mean(diff), se = sd(diff) / Math.sqrt(n);
  const boots = [];
  for (let b = 0; b < NBOOT; b++) { let s = 0; for (let i = 0; i < n; i++) s += diff[(rnd() * n) | 0]; boots.push(s / n); }
  boots.sort((a, b) => a - b);
  const lo = boots[Math.floor(0.025 * NBOOT)], hi = boots[Math.floor(0.975 * NBOOT)];
  const pBoot = 2 * Math.min(boots.filter((x) => x >= 0).length, boots.filter((x) => x <= 0).length) / NBOOT;
  return { n, mean: m, se, t: se > 0 ? m / se : null, lo, hi, p_boot: Math.min(1, pBoot) };
}
// NB: CRPS discreto, log-score y P(over) en una línea
function nbCdfTable(mu, r) { const c = []; let acc = 0; for (let k = 0; k <= KMAX; k++) { acc += nbPmf(mu, r, k); c.push(Math.min(1, acc)); } return c; }
function crpsFromCdf(cdf, y) { let s = 0; for (let k = 0; k <= KMAX; k++) { const F = cdf[k], H = k >= y ? 1 : 0; s += (F - H) * (F - H); } return s; }
function overFromCdf(cdf, line) { const f = Math.floor(line); return Math.max(0, Math.min(1, 1 - (f >= 0 ? cdf[Math.min(f, KMAX)] : 0))); }
function fitR(preds) { // preds [{mu,y}] → r por máxima verosimilitud NB (grid log)
  let best = { r: 400, ll: -Infinity };
  for (let e = Math.log(2); e <= Math.log(400) + 1e-9; e += 0.05) {
    const r = Math.exp(e); let ll = 0;
    for (const p of preds) ll += Math.log(Math.max(1e-12, nbPmf(p.mu, r, p.y)));
    if (ll > best.ll) best = { r, ll };
  }
  return best.r;
}

// ── modelo walk-forward ─────────────────────────────────────────────────────────────────────────────────
// Corre los tres modelos sobre todos los partidos con parámetros dados. Devuelve las predicciones por partido.
function runModels(matches, P) {
  const { K_TEAM, DAMP, K_REF, REF_BASE } = P; // REF_BASE: 'team' (cociente vs M1) | 'league' (vs media de liga)
  const league = {};   // div → { rows:[{season,total,hc,ac}] }
  const teams = {};    // nombre → [{cf, ca, muSide, muSideOpp}] (últimos TEAM_WINDOW)
  const refIdx = REF.emptyIndex(); // índice del árbitro (clubs-engine/referees.js) sobre la base elegida
  const preds = [];
  // agrupar por fecha dentro del orden global (todas las divisiones a la vez; el árbitro cruza divisiones)
  let i = 0;
  while (i < matches.length) {
    let j = i; while (j < matches.length && matches[j].date === matches[i].date) j++;
    const batch = matches.slice(i, j);
    const upd = [];
    for (const m of batch) {
      const Lg = league[m.div] || (league[m.div] = { rows: [] });
      // media de liga = temporada actual + anterior (ventana móvil de dos temporadas)
      const prevSeason = SEASONS[SEASONS.indexOf(m.season) - 1];
      const win = Lg.rows.filter((r) => r.season === m.season || r.season === prevSeason);
      const nL = win.length;
      const muL = nL ? mean(win.map((r) => r.total)) : null;
      const muH = nL ? mean(win.map((r) => r.hc)) : null, muA = nL ? mean(win.map((r) => r.ac)) : null;
      let rec = null;
      if (nL >= MIN_LEAGUE_N) {
        const ratio = (arr, key) => { const s = arr.reduce((a, x) => a + x[key], 0); return (K_TEAM + s) / (K_TEAM + arr.length); };
        const th = (teams[m.home] || []).slice(-TEAM_WINDOW), ta = (teams[m.away] || []).slice(-TEAM_WINDOW);
        const forH = ratio(th, 'rf'), agH = ratio(th, 'ra'), forA = ratio(ta, 'rf'), agA = ratio(ta, 'ra');
        const rawTot = muH * forH * agA + muA * forA * agH;
        const mu1 = muL * Math.pow(rawTot / muL, DAMP);
        const eff = REF.effectFor(refIdx, m.ref, { REF_PRIOR: K_REF, REF_CLAMP: 0, MIN_N: 1 });
        const mu2 = mu1 * eff.mult;
        rec = { div: m.div, season: m.season, date: m.date, ref: m.ref, y: m.total, muL, mu0: muL, mu1, mu2, ref_n: eff.n, ref_mult: eff.mult, medL: median(win.map((r) => r.total)), nTeamH: th.length, nTeamA: ta.length };
        preds.push(rec);
      }
      upd.push({ m, muL, muH, muA, base: rec ? (REF_BASE === 'team' ? rec.mu1 : rec.muL) : muL });
    }
    // actualizar el estado DESPUÉS de predecir toda la fecha (nada del mismo día entra)
    for (const u of upd) {
      const { m } = u;
      league[m.div].rows.push({ season: m.season, total: m.total, hc: m.hc, ac: m.ac });
      if (u.muH > 0 && u.muA > 0) {
        (teams[m.home] = teams[m.home] || []).push({ rf: m.hc / u.muH, ra: m.ac / u.muA });
        (teams[m.away] = teams[m.away] || []).push({ rf: m.ac / u.muA, ra: m.hc / u.muH });
      }
      if (m.ref && u.base > 0) REF.addMatch(refIdx, { referee: m.ref, total: m.total, leagueMean: u.base, league: m.div, date: m.date });
    }
    i = j;
  }
  return { preds, refIdx };
}

// Evalúa un conjunto de predicciones con dispersiones dadas → métricas por partido
function score(preds, R) {
  const out = [];
  for (const p of preds) {
    const lines = [p.medL - 1.5, p.medL - 0.5, p.medL + 0.5, p.medL + 1.5].map((l) => Math.round(l * 2) / 2).filter((l) => Math.abs(l % 1) === 0.5);
    const row = { div: p.div, season: p.season, date: p.date, ref: p.ref, y: p.y, lines };
    for (const k of ['0', '1', '2']) {
      const mu = p['mu' + k], cdf = nbCdfTable(mu, R[k]);
      row['mae' + k] = Math.abs(p.y - mu);
      row['crps' + k] = crpsFromCdf(cdf, p.y);
      row['ls' + k] = -Math.log(Math.max(1e-12, nbPmf(mu, R[k], p.y)));
      row['brier' + k] = lines.map((l) => { const po = overFromCdf(cdf, l); const o = p.y > l ? 1 : 0; return (po - o) * (po - o); });
      row['brierAvg' + k] = mean(row['brier' + k]);
    }
    out.push(row);
  }
  return out;
}
const avg = (rows, key) => mean(rows.map((r) => r[key]));

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const md = [];
  const all = []; const files = [];
  for (const s of SEASONS) for (const d of DIVS) {
    const f = await download(s, d);
    files.push({ season: s, div: d, ok: !!f });
    if (!f) continue;
    for (const row of parseCsv(fs.readFileSync(f, 'utf8'))) {
      const hc = Number(row.HC), ac = Number(row.AC), date = parseDate(row.Date);
      if (!row.HomeTeam || !row.AwayTeam || !date || !isFinite(hc) || !isFinite(ac) || row.HC === '' || row.AC === '') continue;
      all.push({ div: d, season: s, date, home: row.HomeTeam, away: row.AwayTeam, hc, ac, total: hc + ac, ref: REF.normalizeName(row.Referee) ? String(row.Referee).trim() : null });
    }
  }
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.div < b.div ? -1 : 1));
  const withRef = all.filter((m) => m.ref).length;
  md.push(`# Backtest — el árbitro en el total de córners`);
  md.push('');
  md.push(`Partidos cargados: ${all.length} (${DIVS.join(', ')}; temporadas ${SEASONS.join(', ')}); con árbitro: ${withRef} (${(100 * withRef / all.length).toFixed(1)} %). Ficheros ausentes: ${files.filter((f) => !f.ok).map((f) => f.season + '/' + f.div).join(', ') || 'ninguno'}.`);
  md.push(`Desarrollo (elección de K_team, DAMP, K_ref y r): ${[...DEV_SEASONS].join(', ')}. Test: ${SEASONS.filter((s) => !DEV_SEASONS.has(s)).join(', ')}. Walk-forward por fecha; media de liga = temporada en curso + anterior; calentamiento ${MIN_LEAGUE_N} partidos de liga.`);
  md.push('');
  // descriptivos por liga
  md.push('## 1. Descriptivos');
  md.push('');
  md.push('| Liga | n | media total | var/media | mediana | árbitros distintos | partidos/árbitro (mediana) |');
  md.push('|---|---:|---:|---:|---:|---:|---:|');
  const refsByDiv = {};
  for (const d of DIVS) {
    const rows = all.filter((m) => m.div === d); if (!rows.length) continue;
    const tots = rows.map((m) => m.total); const per = {};
    rows.forEach((m) => { if (m.ref) per[REF.normalizeName(m.ref)] = (per[REF.normalizeName(m.ref)] || 0) + 1; });
    refsByDiv[d] = per;
    md.push(`| ${d} | ${rows.length} | ${fmt(mean(tots), 2)} | ${fmt(variance(tots) / mean(tots), 2)} | ${median(tots)} | ${Object.keys(per).length} | ${median(Object.values(per))} |`);
  }
  md.push('');

  // ── desarrollo: grid de K_team × DAMP (M1) ──
  const isDev = (p) => DEV_SEASONS.has(p.season), isTest = (p) => !DEV_SEASONS.has(p.season);
  md.push('## 2. Desarrollo (2122-2223): elección de parámetros');
  md.push('');
  md.push('### 2.1 Equipos: K_team × DAMP (CRPS del M1 en desarrollo, r ajustado a cada configuración)');
  md.push('');
  md.push('| K_team | DAMP | r₁ | MAE M1 | CRPS M1 | CRPS M0 | Δ CRPS (M1−M0) | t |');
  md.push('|---:|---:|---:|---:|---:|---:|---:|---:|');
  let bestTeam = null;
  for (const K_TEAM of [4, 10, 20, 40]) for (const DAMP of [0.5, 0.75, 1]) {
    const { preds } = runModels(all, { K_TEAM, DAMP, K_REF: 1e9, REF_BASE: 'team' });
    const dev = preds.filter(isDev);
    const r0 = fitR(dev.map((p) => ({ mu: p.mu0, y: p.y }))), r1 = fitR(dev.map((p) => ({ mu: p.mu1, y: p.y })));
    const sc = score(dev, { 0: r0, 1: r1, 2: r1 });
    const t = pairedTest(sc.map((r) => r.crps1 - r.crps0));
    md.push(`| ${K_TEAM} | ${DAMP} | ${fmt(r1, 1)} | ${fmt(avg(sc, 'mae1'))} | ${fmt(avg(sc, 'crps1'), 4)} | ${fmt(avg(sc, 'crps0'), 4)} | ${fmtS(t.mean, 4)} | ${fmt(t.t, 2)} |`);
    if (!bestTeam || avg(sc, 'crps1') < bestTeam.crps) bestTeam = { K_TEAM, DAMP, crps: avg(sc, 'crps1'), r0, r1 };
  }
  md.push('');
  md.push(`Elegido: K_team = ${bestTeam.K_TEAM}, DAMP = ${bestTeam.DAMP}.`);
  md.push('');

  // ── desarrollo: K_ref (empírico-Bayes + grid) ──
  const base = runModels(all, { K_TEAM: bestTeam.K_TEAM, DAMP: bestTeam.DAMP, K_REF: 1e9, REF_BASE: 'team' });
  const devP = base.preds.filter(isDev);
  // EB por método de momentos sobre los cocientes y_i/mu1_i (residuos multiplicativos) en desarrollo
  function ebEstimate(preds, key) {
    const per = {};
    preds.forEach((p) => { if (p.ref) (per[REF.normalizeName(p.ref)] = per[REF.normalizeName(p.ref)] || []).push(p.y / p[key]); });
    const groups = Object.values(per).filter((g) => g.length >= 3);
    const N = groups.reduce((a, g) => a + g.length, 0), G = groups.length;
    const grand = mean(groups.flat());
    const ssw = groups.reduce((a, g) => a + g.reduce((s, x) => s + (x - mean(g)) ** 2, 0), 0);
    const sigma2 = ssw / (N - G);
    const ssb = groups.reduce((a, g) => a + g.length * (mean(g) - grand) ** 2, 0);
    const msb = ssb / (G - 1);
    const n0 = (N - groups.reduce((a, g) => a + g.length * g.length, 0) / N) / (G - 1);
    const tau2 = Math.max(0, (msb - sigma2) / n0);
    return { G, N, sigma2, tau2, tau: Math.sqrt(tau2), K: tau2 > 0 ? sigma2 / tau2 : Infinity, F: msb / sigma2, n0 };
  }
  const ebDev = ebEstimate(devP, 'mu1');
  md.push('### 2.2 Árbitro: prior K_ref');
  md.push('');
  md.push(`Empírico-Bayes (método de momentos, ANOVA de un factor sobre y/μ₁ en desarrollo; árbitros con ≥3 partidos): G = ${ebDev.G} árbitros, N = ${ebDev.N}; σ²_dentro = ${fmt(ebDev.sigma2, 4)}, τ²_entre = ${fmt(ebDev.tau2, 5)} (τ = ${fmt(ebDev.tau, 4)} ≈ ${fmt(ebDev.tau * 10, 2)} córners sobre un total de 10), F = ${fmt(ebDev.F, 2)} → **K_ref(EB) = ${isFinite(ebDev.K) ? fmt(ebDev.K, 1) : '∞'}**.`);
  md.push('');
  md.push('| K_ref | base del cociente | CRPS M2 | Δ CRPS (M2−M1) | t | MAE M2 | Brier M2 | Δ Brier (M2−M1) |');
  md.push('|---:|---|---:|---:|---:|---:|---:|---:|');
  let bestRef = null;
  const kGrid = [5, 10, 20, 40, 80, 160].concat(isFinite(ebDev.K) ? [Math.round(ebDev.K)] : []).sort((a, b) => a - b);
  for (const REF_BASE of ['team', 'league']) for (const K_REF of kGrid) {
    const { preds } = runModels(all, { K_TEAM: bestTeam.K_TEAM, DAMP: bestTeam.DAMP, K_REF, REF_BASE });
    const dev = preds.filter(isDev);
    const r2 = fitR(dev.map((p) => ({ mu: p.mu2, y: p.y })));
    const sc = score(dev, { 0: bestTeam.r0, 1: bestTeam.r1, 2: r2 });
    const t = pairedTest(sc.map((r) => r.crps2 - r.crps1)), tb = pairedTest(sc.map((r) => r.brierAvg2 - r.brierAvg1));
    md.push(`| ${K_REF} | ${REF_BASE} | ${fmt(avg(sc, 'crps2'), 4)} | ${fmtS(t.mean, 4)} | ${fmt(t.t, 2)} | ${fmt(avg(sc, 'mae2'))} | ${fmt(avg(sc, 'brierAvg2'), 4)} | ${fmtS(tb.mean, 5)} |`);
    if (!bestRef || avg(sc, 'crps2') < bestRef.crps) bestRef = { K_REF, REF_BASE, crps: avg(sc, 'crps2'), r2 };
  }
  md.push('');
  const K_FINAL = isFinite(ebDev.K) ? Math.round(ebDev.K) : bestRef.K_REF;
  md.push(`Elegido para test: K_ref = ${K_FINAL} (el EB; el mejor del grid fue ${bestRef.K_REF}/${bestRef.REF_BASE}), base = ${bestRef.REF_BASE}. r fijados en desarrollo: r₀ = ${fmt(bestTeam.r0, 1)}, r₁ = ${fmt(bestTeam.r1, 1)}, r₂ = ${fmt(bestRef.r2, 1)}.`);
  md.push('');

  // ── TEST ──
  const finalRun = runModels(all, { K_TEAM: bestTeam.K_TEAM, DAMP: bestTeam.DAMP, K_REF: K_FINAL, REF_BASE: bestRef.REF_BASE });
  const R = { 0: bestTeam.r0, 1: bestTeam.r1, 2: bestRef.r2 };
  const testP = finalRun.preds.filter(isTest);
  const scT = score(testP, R);
  const summary = { generated_at: new Date().toISOString(), seasons: SEASONS, divs: DIVS, matches: all.length, with_ref: withRef, params: { K_TEAM: bestTeam.K_TEAM, DAMP: bestTeam.DAMP, K_REF: K_FINAL, REF_BASE: bestRef.REF_BASE, r: R }, eb_dev: ebDev, test: {}, dev: {} };
  function block(title, rows, tag) {
    md.push(`### ${title}`);
    md.push('');
    md.push('| Liga | n | MAE M0 | MAE M1 | MAE M2 | CRPS M0 | CRPS M1 | CRPS M2 | log-score M0 | M1 | M2 | Brier M0 | M1 | M2 |');
    md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    const groups = [...DIVS.map((d) => [d, rows.filter((r) => r.div === d)]), ['**Global**', rows]];
    const res = {};
    for (const [name, rs] of groups) {
      if (!rs.length) continue;
      md.push(`| ${name} | ${rs.length} | ${fmt(avg(rs, 'mae0'))} | ${fmt(avg(rs, 'mae1'))} | ${fmt(avg(rs, 'mae2'))} | ${fmt(avg(rs, 'crps0'), 4)} | ${fmt(avg(rs, 'crps1'), 4)} | ${fmt(avg(rs, 'crps2'), 4)} | ${fmt(avg(rs, 'ls0'), 4)} | ${fmt(avg(rs, 'ls1'), 4)} | ${fmt(avg(rs, 'ls2'), 4)} | ${fmt(avg(rs, 'brierAvg0'), 4)} | ${fmt(avg(rs, 'brierAvg1'), 4)} | ${fmt(avg(rs, 'brierAvg2'), 4)} |`);
      res[name.replace(/\*/g, '')] = { n: rs.length, mae: [avg(rs, 'mae0'), avg(rs, 'mae1'), avg(rs, 'mae2')], crps: [avg(rs, 'crps0'), avg(rs, 'crps1'), avg(rs, 'crps2')], ls: [avg(rs, 'ls0'), avg(rs, 'ls1'), avg(rs, 'ls2')], brier: [avg(rs, 'brierAvg0'), avg(rs, 'brierAvg1'), avg(rs, 'brierAvg2')] };
    }
    md.push('');
    md.push('Comparaciones pareadas (Δ = A − B por partido; negativo = A mejor; IC 95 % bootstrap pareado, ' + NBOOT + ' remuestreos; t iid):');
    md.push('');
    md.push('| Liga | Par | n | Δ MAE | t | Δ CRPS | IC 95 % | t | p_boot | Δ Brier | t | Δ log-score | t |');
    md.push('|---|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|');
    const pairs = [['M1−M0', '1', '0'], ['M2−M1', '2', '1'], ['M2−M0', '2', '0']];
    for (const [name, rs] of groups) {
      if (!rs.length) continue;
      res[name.replace(/\*/g, '')].pairs = {};
      for (const [lbl, a, b] of pairs) {
        const tm = pairedTest(rs.map((r) => r['mae' + a] - r['mae' + b]));
        const tc = pairedTest(rs.map((r) => r['crps' + a] - r['crps' + b]));
        const tb = pairedTest(rs.map((r) => r['brierAvg' + a] - r['brierAvg' + b]));
        const tl = pairedTest(rs.map((r) => r['ls' + a] - r['ls' + b]));
        md.push(`| ${name} | ${lbl} | ${rs.length} | ${fmtS(tm.mean, 4)} | ${fmt(tm.t, 2)} | ${fmtS(tc.mean, 4)} | [${fmtS(tc.lo, 4)}, ${fmtS(tc.hi, 4)}] | ${fmt(tc.t, 2)} | ${fmt(tc.p_boot, 3)} | ${fmtS(tb.mean, 5)} | ${fmt(tb.t, 2)} | ${fmtS(tl.mean, 4)} | ${fmt(tl.t, 2)} |`);
        res[name.replace(/\*/g, '')].pairs[lbl] = { mae: tm, crps: tc, brier: tb, ls: tl };
      }
    }
    md.push('');
    summary[tag] = res;
  }
  md.push('## 3. TEST (2324-2627) — fuera de muestra');
  md.push('');
  block('3.1 Métricas por liga y global', scT, 'test');
  // Brier por línea (global test)
  md.push('### 3.2 Brier de P(over) por línea sintética (test, global)');
  md.push('');
  md.push('| Línea | n | Brier M0 | Brier M1 | Brier M2 | Δ M2−M1 | t | Δ M1−M0 | t | frecuencia over |');
  md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  summary.test_lines = [];
  for (let li = 0; li < 4; li++) {
    const lbl = ['mediana − 1,5', 'mediana − 0,5', 'mediana + 0,5', 'mediana + 1,5'][li];
    const rs = scT.filter((r) => r.brier0.length === 4);
    const t21 = pairedTest(rs.map((r) => r.brier2[li] - r.brier1[li])), t10 = pairedTest(rs.map((r) => r.brier1[li] - r.brier0[li]));
    const over = mean(rs.map((r) => (r.y > r.lines[li] ? 1 : 0)));
    md.push(`| ${lbl} | ${rs.length} | ${fmt(mean(rs.map((r) => r.brier0[li])), 4)} | ${fmt(mean(rs.map((r) => r.brier1[li])), 4)} | ${fmt(mean(rs.map((r) => r.brier2[li])), 4)} | ${fmtS(t21.mean, 5)} | ${fmt(t21.t, 2)} | ${fmtS(t10.mean, 5)} | ${fmt(t10.t, 2)} | ${fmt(over, 3)} |`);
    summary.test_lines.push({ line: lbl, n: rs.length, b0: mean(rs.map((r) => r.brier0[li])), b1: mean(rs.map((r) => r.brier1[li])), b2: mean(rs.map((r) => r.brier2[li])), d21: t21, d10: t10, over });
  }
  md.push('');
  // por temporada (test) y por nº de partidos previos del árbitro
  md.push('### 3.3 Por temporada (test): Δ CRPS M2−M1');
  md.push('');
  md.push('| Temporada | n | CRPS M1 | CRPS M2 | Δ | t |');
  md.push('|---|---:|---:|---:|---:|---:|');
  summary.test_seasons = [];
  for (const s of SEASONS.filter((x) => !DEV_SEASONS.has(x))) {
    const rs = scT.filter((r) => r.season === s); if (!rs.length) continue;
    const t = pairedTest(rs.map((r) => r.crps2 - r.crps1));
    md.push(`| ${s} | ${rs.length} | ${fmt(avg(rs, 'crps1'), 4)} | ${fmt(avg(rs, 'crps2'), 4)} | ${fmtS(t.mean, 4)} | ${fmt(t.t, 2)} |`);
    summary.test_seasons.push({ season: s, n: rs.length, crps1: avg(rs, 'crps1'), crps2: avg(rs, 'crps2'), d: t });
  }
  md.push('');
  md.push('### 3.4 Por historial del árbitro (test): ¿ayuda más cuando se le conoce?');
  md.push('');
  md.push('| Partidos previos del árbitro | n | multiplicador medio | rango | Δ CRPS M2−M1 | t | Δ Brier | t |');
  md.push('|---|---:|---:|---|---:|---:|---:|---:|');
  const byN = [[0, 0, 'sin historial (0)'], [1, 19, '1-19'], [20, 49, '20-49'], [50, 99, '50-99'], [100, 1e9, '≥100']];
  summary.test_refn = [];
  for (const [lo, hi, lbl] of byN) {
    const idx = testP.map((p, k) => (p.ref_n >= lo && p.ref_n <= hi ? k : -1)).filter((k) => k >= 0);
    if (!idx.length) continue;
    const rs = idx.map((k) => scT[k]); const mults = idx.map((k) => testP[k].ref_mult);
    const t = pairedTest(rs.map((r) => r.crps2 - r.crps1)), tb = pairedTest(rs.map((r) => r.brierAvg2 - r.brierAvg1));
    md.push(`| ${lbl} | ${rs.length} | ${fmt(mean(mults), 4)} | ${fmt(Math.min(...mults), 3)}-${fmt(Math.max(...mults), 3)} | ${fmtS(t.mean, 4)} | ${fmt(t.t, 2)} | ${fmtS(tb.mean, 5)} | ${fmt(tb.t, 2)} |`);
    summary.test_refn.push({ bucket: lbl, n: rs.length, mult_mean: mean(mults), d_crps: t, d_brier: tb });
  }
  md.push('');
  // extremos: partidos donde el árbitro mueve ≥3 % la proyección
  md.push('### 3.5 Cuando el árbitro mueve la proyección (test): |mult − 1| ≥ 3 %');
  md.push('');
  md.push('| Grupo | n | media real | μ₁ media | μ₂ media | MAE M1 | MAE M2 | Δ CRPS | t |');
  md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  summary.test_moves = [];
  for (const [lbl, f] of [['árbitro "de pocos córners" (mult ≤ 0,97)', (p) => p.ref_mult <= 0.97], ['árbitro "de muchos córners" (mult ≥ 1,03)', (p) => p.ref_mult >= 1.03], ['resto', (p) => p.ref_mult > 0.97 && p.ref_mult < 1.03]]) {
    const idx = testP.map((p, k) => (f(p) ? k : -1)).filter((k) => k >= 0); if (!idx.length) continue;
    const rs = idx.map((k) => scT[k]), ps = idx.map((k) => testP[k]);
    const t = pairedTest(rs.map((r) => r.crps2 - r.crps1));
    md.push(`| ${lbl} | ${rs.length} | ${fmt(mean(ps.map((p) => p.y)), 2)} | ${fmt(mean(ps.map((p) => p.mu1)), 2)} | ${fmt(mean(ps.map((p) => p.mu2)), 2)} | ${fmt(avg(rs, 'mae1'))} | ${fmt(avg(rs, 'mae2'))} | ${fmtS(t.mean, 4)} | ${fmt(t.t, 2)} |`);
    summary.test_moves.push({ group: lbl, n: rs.length, y: mean(ps.map((p) => p.y)), mu1: mean(ps.map((p) => p.mu1)), mu2: mean(ps.map((p) => p.mu2)), d_crps: t });
  }
  md.push('');

  // ── K alternativos en test: qué pasaría si se enchufara el prior de las tarjetas (14) u otros ──
  md.push('### 3.6 Priors alternativos en TEST (qué costaría un K más agresivo; r₂ ajustado en desarrollo a cada K)');
  md.push('');
  md.push('| K_ref | CRPS M2 | Δ CRPS (M2−M1) | IC 95 % | t | Δ Brier | t | Δ MAE | t | multiplicador: p10 / p90 |');
  md.push('|---:|---:|---:|---|---:|---:|---:|---:|---:|---|');
  summary.test_alt_k = [];
  for (const K_REF of [14, 40, 100, 400, K_FINAL].filter((k, i, a) => a.indexOf(k) === i).sort((a, b) => a - b)) {
    const { preds } = runModels(all, { K_TEAM: bestTeam.K_TEAM, DAMP: bestTeam.DAMP, K_REF, REF_BASE: bestRef.REF_BASE });
    const r2 = fitR(preds.filter(isDev).map((p) => ({ mu: p.mu2, y: p.y })));
    const tp = preds.filter(isTest), sc = score(tp, { 0: R[0], 1: R[1], 2: r2 });
    const t = pairedTest(sc.map((r) => r.crps2 - r.crps1)), tb = pairedTest(sc.map((r) => r.brierAvg2 - r.brierAvg1)), tm = pairedTest(sc.map((r) => r.mae2 - r.mae1));
    const ms = tp.map((p) => p.ref_mult).sort((a, b) => a - b);
    md.push(`| ${K_REF} | ${fmt(avg(sc, 'crps2'), 4)} | ${fmtS(t.mean, 4)} | [${fmtS(t.lo, 4)}, ${fmtS(t.hi, 4)}] | ${fmt(t.t, 2)} | ${fmtS(tb.mean, 5)} | ${fmt(tb.t, 2)} | ${fmtS(tm.mean, 4)} | ${fmt(tm.t, 2)} | ${fmt(ms[Math.floor(0.1 * ms.length)], 3)} / ${fmt(ms[Math.floor(0.9 * ms.length)], 3)} |`);
    summary.test_alt_k.push({ K_REF, r2, crps2: avg(sc, 'crps2'), d_crps: t, d_brier: tb, d_mae: tm, mult_p10: ms[Math.floor(0.1 * ms.length)], mult_p90: ms[Math.floor(0.9 * ms.length)] });
  }
  md.push('');

  // ── desarrollo (referencia) ──
  md.push('## 4. Desarrollo (2122-2223) — referencia, parámetros ajustados aquí');
  md.push('');
  block('4.1 Métricas por liga y global (en muestra para r y K)', score(finalRun.preds.filter(isDev), R), 'dev');

  // ── varianza explicada por el árbitro ──
  md.push('## 5. ¿Cuánta varianza entre partidos explica el árbitro una vez controlados los equipos?');
  md.push('');
  const allP = finalRun.preds;
  function varianceBlock(preds, lbl) {
    const resid = preds.filter((p) => p.ref).map((p) => ({ ref: REF.normalizeName(p.ref), e: p.y - p.mu1, y: p.y, mu1: p.mu1 }));
    const per = {}; resid.forEach((r) => (per[r.ref] = per[r.ref] || []).push(r.e));
    const groups = Object.values(per).filter((g) => g.length >= 5);
    const stat = (gs) => {
      const N = gs.reduce((a, g) => a + g.length, 0), G = gs.length, grand = mean(gs.flat());
      const ssw = gs.reduce((a, g) => a + g.reduce((s, x) => s + (x - mean(g)) ** 2, 0), 0), sigma2 = ssw / (N - G);
      const msb = gs.reduce((a, g) => a + g.length * (mean(g) - grand) ** 2, 0) / (G - 1);
      const n0 = (N - gs.reduce((a, g) => a + g.length * g.length, 0) / N) / (G - 1);
      return { N, G, sigma2, msb, F: msb / sigma2, tau2: Math.max(0, (msb - sigma2) / n0) };
    };
    const obs = stat(groups);
    // permutación: barajar las etiquetas de árbitro (mismos tamaños de grupo) 1000 veces
    const pool = groups.flat(); let ge = 0; const NP = 1000;
    for (let b = 0; b < NP; b++) {
      for (let i = pool.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
      let k = 0; const gs = groups.map((g) => pool.slice(k, (k += g.length)));
      if (stat(gs).F >= obs.F) ge++;
    }
    const varY = variance(resid.map((r) => r.y)), varE = variance(resid.map((r) => r.e)), varMu = variance(resid.map((r) => r.mu1));
    // fiabilidad mitad/mitad: media de residuos en partidos pares vs impares por árbitro (≥20)
    const halves = Object.values(per).filter((g) => g.length >= 20).map((g) => [mean(g.filter((_, i) => i % 2 === 0)), mean(g.filter((_, i) => i % 2 === 1))]);
    let rho = null;
    if (halves.length >= 5) { const a = halves.map((h) => h[0]), b = halves.map((h) => h[1]); const ma = mean(a), mb = mean(b); const cov = mean(a.map((x, i) => (x - ma) * (b[i] - mb))); rho = cov / (sd(a) * sd(b) * (a.length - 1) / a.length); }
    md.push(`**${lbl}** (n = ${resid.length} partidos con árbitro; residuo e = total − μ₁): var(total) = ${fmt(varY, 2)}, var(μ₁) = ${fmt(varMu, 3)} (equipos explican ${fmt(100 * (1 - varE / varY), 1)} % de la varianza), var(e) = ${fmt(varE, 2)}. ANOVA de efectos aleatorios por árbitro (≥5 partidos; G = ${obs.G}): σ²_dentro = ${fmt(obs.sigma2, 2)}, τ²_árbitro = ${fmt(obs.tau2, 3)} (τ = ${fmt(Math.sqrt(obs.tau2), 2)} córners), **ICC = τ²/var(e) = ${fmt(100 * obs.tau2 / varE, 2)} %** (= ${fmt(100 * obs.tau2 / varY, 2)} % de la varianza total), F = ${fmt(obs.F, 2)}, p (permutación, ${NP}) = ${fmt(ge / NP, 3)}. Fiabilidad mitad/mitad del efecto (árbitros con ≥20 partidos, n = ${halves.length}): ρ = ${fmt(rho, 3)}.`);
    md.push('');
    return { n: resid.length, var_y: varY, var_mu1: varMu, var_e: varE, team_share: 1 - varE / varY, anova: obs, icc_resid: obs.tau2 / varE, share_total: obs.tau2 / varY, p_perm: ge / NP, split_half_rho: rho, split_half_n: halves.length };
  }
  summary.variance = { all: varianceBlock(allP, 'Todas las temporadas'), test: varianceBlock(testP, 'Solo test') };
  // árbitros con más efecto (todo el periodo, índice final)
  md.push('### 5.1 Árbitros con más partidos (índice al final del periodo; multiplicador con K = ' + K_FINAL + ')');
  md.push('');
  md.push('| Árbitro | n | media total | cociente medio (total/μ) | multiplicador encogido |');
  md.push('|---|---:|---:|---:|---:|');
  const refs = Object.values(finalRun.refIdx.refs).sort((a, b) => b.n - a.n);
  const top = refs.slice(0, 12).concat(refs.filter((r) => r.n >= 30).sort((a, b) => Math.abs(b.sum_ratio / b.n - 1) - Math.abs(a.sum_ratio / a.n - 1)).slice(0, 8));
  const seen = new Set();
  for (const r of top) { if (seen.has(r.name)) continue; seen.add(r.name); md.push(`| ${r.name} | ${r.n} | ${fmt(r.sum_total / r.n, 2)} | ${fmt(r.sum_ratio / r.n, 3)} | ${fmt(REF.shrunkMult(r.sum_ratio, r.n, K_FINAL), 3)} |`); }
  md.push('');
  const mults = refs.filter((r) => r.n >= 30).map((r) => REF.shrunkMult(r.sum_ratio, r.n, K_FINAL));
  md.push(`Distribución del multiplicador encogido entre árbitros con ≥30 partidos (n = ${mults.length}): mín ${fmt(Math.min(...mults), 3)}, p10 ${fmt(mults.slice().sort((a, b) => a - b)[Math.floor(0.1 * mults.length)], 3)}, mediana ${fmt(median(mults), 3)}, p90 ${fmt(mults.slice().sort((a, b) => a - b)[Math.floor(0.9 * mults.length)], 3)}, máx ${fmt(Math.max(...mults), 3)}.`);
  md.push('');
  summary.mult_dist = { n: mults.length, min: Math.min(...mults), median: median(mults), max: Math.max(...mults) };

  console.log(md.join('\n'));
  fs.writeFileSync(path.join(OUT, 'corners-ref-summary.json'), JSON.stringify(summary, null, 1));
  fs.writeFileSync(path.join(OUT, 'corners-ref-tables.md'), md.join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });
