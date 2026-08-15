#!/usr/bin/env node
/**
 * BALONCESTO — BACKTEST FUERA DE MUESTRA (15-ago). El gate de la casa: sin pasarlo, no se publica nada.
 *
 * MÉTODO (walk-forward, el único honesto): se recorre la temporada en orden y cada partido se predice con un
 * rating ajustado SOLO con los partidos anteriores. Nada de fitear con la temporada entera y luego "predecir"
 * lo que el modelo ya vio — eso mide memoria, no habilidad.
 *
 * QUÉ SE MIDE:
 *   · Brier del ganador y acierto — contra la base de "siempre el local", que es el rival trivial.
 *   · Calibración por tramos: cuando decimos 70%, ¿gana el 70%?
 *   · MAE de margen y total — lo que de verdad importa para hándicap y over/under.
 *   · Cobertura de los intervalos: si el 50% central del margen simulado contiene el resultado ~50% de las
 *     veces, las barras de error son honestas; si no, el simulador miente sobre su propia incertidumbre.
 *
 * Uso: node scripts/hoops-backtest.js --league=wnba --season=2026 [--min=40] [--sims=4000]
 */
'use strict';
const path = require('path');
const R = require(path.join(__dirname, '..', 'basketball-engine', 'ratings'));
const S = require(path.join(__dirname, '..', 'basketball-engine', 'simulate'));

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const LEAGUE = String(args.league || 'wnba'), SEASON = +args.season || 2026;
const MIN = +args.min || 40;          // partidos de arranque antes de empezar a evaluar
const SIMS = +args.sims || 4000;
const REFIT = +args.refit || 5;       // cada cuántos partidos se re-ajusta (coste vs frescura)

const DIR = path.join(__dirname, '..', 'data', 'basketball');
const store = require(path.join(DIR, `games-${LEAGUE}-${SEASON}.json`));
let teams = null; try { teams = require(path.join(DIR, `teams-${LEAGUE}.json`)).teams.map(t => t.id); } catch { }

const G = Object.values(store.games)
  .filter(g => g.home && g.away && g.home.ff && g.home.ff.ortg != null && g.poss > 0)
  .sort((a, b) => String(a.date).localeCompare(String(b.date)));
console.log(`[backtest ${LEAGUE} ${SEASON}] ${G.length} partidos · arranque ${MIN} · ${SIMS} sims/partido`);

const rows = [];
let fit = null;
for (let i = MIN; i < G.length; i++) {
  const g = G[i];
  if (!fit || (i - MIN) % REFIT === 0) {
    fit = R.fitRatings(G.slice(0, i), { validTeams: teams, now: Date.parse(g.date) });
  }
  if (!fit || !(fit.n[g.home.id] >= 5 && fit.n[g.away.id] >= 5)) continue;   // sin muestra, no se opina
  const sim = S.simulate(fit, g.home.id, g.away.id, { n: SIMS, neutral: !!g.neutral, seed: i });
  if (!sim) continue;
  const actMargin = g.home.pts - g.away.pts, actTotal = g.home.pts + g.away.pts;
  // MERCADO: spread y total de cierre que ESPN trae del propio partido. El spread está expresado desde el
  // local (−5.5 = local favorito por 5.5), así que el margen que implica es −spread. La probabilidad
  // implícita del moneyline se des-vig a dos vías para que la comparación de Brier sea justa.
  const mk = (g.odds || [])[0] || null;
  const ml = (o) => (o == null ? null : (o < 0 ? -o / (-o + 100) : 100 / (o + 100)));
  let mp = null;
  if (mk && mk.hml != null && mk.aml != null) { const a = ml(mk.hml), b = ml(mk.aml); if (a && b) mp = a / (a + b); }
  rows.push({
    p: sim.win.home, won: actMargin > 0 ? 1 : 0,
    predM: sim.margin, actM: actMargin, predT: sim.total, actT: actTotal,
    mktP: mp, mktM: mk && mk.sp != null ? -mk.sp : null, mktT: mk ? mk.ou : null,
    inIQR: actMargin >= sim.margin_q.p25 && actMargin <= sim.margin_q.p75,
    in90: actMargin >= sim.margin_q.p05 && actMargin <= sim.margin_q.p95,
    inIQRt: actTotal >= sim.total_q.p25 && actTotal <= sim.total_q.p75,
  });
}

const n = rows.length;
const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / n;
const brier = mean(r => (r.p - r.won) ** 2);
const acc = mean(r => ((r.p >= 0.5) === !!r.won) ? 1 : 0);
const baseRate = mean(r => r.won);
const brierBase = mean(r => (baseRate - r.won) ** 2);        // rival trivial: la tasa base de local
const brierHome = mean(r => (1 - r.won) ** 2);               // rival trivial 2: "siempre gana el local"
const maeM = mean(r => Math.abs(r.predM - r.actM)), maeT = mean(r => Math.abs(r.predT - r.actT));
const biasM = mean(r => r.predM - r.actM), biasT = mean(r => r.predT - r.actT);

console.log(`\nEVALUADOS: ${n} partidos`);
console.log(`  Brier modelo      ${brier.toFixed(5)}`);
console.log(`  Brier tasa base   ${brierBase.toFixed(5)}   (skill ${(1 - brier / brierBase >= 0 ? '+' : '')}${(100 * (1 - brier / brierBase)).toFixed(2)}%)`);
console.log(`  Brier "gana local" ${brierHome.toFixed(5)}`);
console.log(`  Acierto           ${(100 * acc).toFixed(1)}%   (locales ganan el ${(100 * baseRate).toFixed(1)}%)`);
console.log(`  MAE margen        ${maeM.toFixed(2)} pts   (sesgo ${biasM >= 0 ? '+' : ''}${biasM.toFixed(2)})`);
console.log(`  MAE total         ${maeT.toFixed(2)} pts   (sesgo ${biasT >= 0 ? '+' : ''}${biasT.toFixed(2)})`);
console.log(`\nCOBERTURA DE INTERVALOS (si el simulador es honesto, deberían dar ~50% y ~90%):`);
console.log(`  margen dentro del 50% central  ${(100 * mean(r => r.inIQR ? 1 : 0)).toFixed(1)}%`);
console.log(`  margen dentro del 90% central  ${(100 * mean(r => r.in90 ? 1 : 0)).toFixed(1)}%`);
console.log(`  total  dentro del 50% central  ${(100 * mean(r => r.inIQRt ? 1 : 0)).toFixed(1)}%`);

// ---- EL GATE DE VERDAD: contra el MERCADO, no contra la tasa base --------------------------------------
const wm = rows.filter(r => r.mktP != null);
if (wm.length >= 20) {
  const bm = (f) => wm.reduce((s, r) => s + f(r), 0) / wm.length;
  const bMod = bm(r => (r.p - r.won) ** 2), bMkt = bm(r => (r.mktP - r.won) ** 2);
  console.log(`\nCONTRA EL MERCADO (cierre DraftKings, n=${wm.length}) — ÉSTE es el gate:`);
  console.log(`  Brier modelo   ${bMod.toFixed(5)}`);
  console.log(`  Brier mercado  ${bMkt.toFixed(5)}`);
  console.log(`  SKILL          ${(bMkt - bMod >= 0 ? '+' : '')}${(bMkt - bMod).toFixed(5)}   ${bMkt - bMod > 0 ? '← el modelo gana' : '← el mercado gana'}`);
  const wms = wm.filter(r => r.mktM != null);
  if (wms.length) {
    const maeMod = wms.reduce((s, r) => s + Math.abs(r.predM - r.actM), 0) / wms.length;
    const maeMkt = wms.reduce((s, r) => s + Math.abs(r.mktM - r.actM), 0) / wms.length;
    console.log(`  MAE margen     modelo ${maeMod.toFixed(2)} vs mercado ${maeMkt.toFixed(2)}`);
  }
  const wmt = wm.filter(r => r.mktT != null);
  if (wmt.length) {
    const maeMod = wmt.reduce((s, r) => s + Math.abs(r.predT - r.actT), 0) / wmt.length;
    const maeMkt = wmt.reduce((s, r) => s + Math.abs(r.mktT - r.actT), 0) / wmt.length;
    console.log(`  MAE total      modelo ${maeMod.toFixed(2)} vs mercado ${maeMkt.toFixed(2)}`);
    // ¿ganaríamos apostando el lado que el modelo prefiere contra la línea del mercado?
    let w = 0, l = 0;
    for (const r of wmt) { const over = r.predT > r.mktT; const hit = (r.actT > r.mktT) === over; if (r.actT === r.mktT) continue; hit ? w++ : l++; }
    console.log(`  Total vs línea: ${w}-${l} (${(100 * w / (w + l)).toFixed(1)}%) — se necesita >52.4% para cubrir el vig`);
    let ws = 0, ls = 0;
    for (const r of wms) { const homeSide = r.predM > r.mktM; const hit = (r.actM > r.mktM) === homeSide; if (r.actM === r.mktM) continue; hit ? ws++ : ls++; }
    console.log(`  Hándicap vs línea: ${ws}-${ls} (${(100 * ws / (ws + ls)).toFixed(1)}%)`);
  }
}

console.log(`\nCALIBRACIÓN (probabilidad dicha vs victorias reales):`);
const buckets = [[0, .35], [.35, .45], [.45, .55], [.55, .65], [.65, .75], [.75, 1]];
for (const [lo, hi] of buckets) {
  const b = rows.filter(r => r.p >= lo && r.p < hi);
  if (b.length < 5) continue;
  const pred = 100 * b.reduce((s, r) => s + r.p, 0) / b.length;
  const obs = 100 * b.reduce((s, r) => s + r.won, 0) / b.length;
  console.log(`  ${(100 * lo).toFixed(0)}-${(100 * hi).toFixed(0)}%  n=${String(b.length).padStart(3)}  dicho ${pred.toFixed(1)}%  real ${obs.toFixed(1)}%  desvío ${(obs - pred >= 0 ? '+' : '')}${(obs - pred).toFixed(1)}pp`);
}
