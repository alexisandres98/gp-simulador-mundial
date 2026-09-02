#!/usr/bin/env node
'use strict';
// scripts/clubs-closes-fd.js — de-vig proporcional vs Shin vs frecuencia REAL con los cierres de football-data.co.uk
//
// Medición, no datos para embarcar: descarga los CSV de temporada (2324, 2425, 2526) de 18 divisiones a un
// directorio de trabajo (default $SP/fd o --out), toma el cierre de Pinnacle (PSCH/PSCD/PSCA; si falta, PSH/PSD/
// PSA; si falta, AvgCH/AvgCD/AvgCA) y, por TRAMO DE CUOTA del resultado, compara la probabilidad implícita
// proporcional, la de Shin y la frecuencia observada (FTR). Cada partido aporta sus tres resultados.
//
// Uso: node scripts/clubs-closes-fd.js [--out <dir>] [--seasons 2324,2425,2526] [--no-download]
// Salida: tabla Markdown por stdout + <out>/fd-devig-summary.json. Sin red (bloqueo), usa lo que haya en <out>.

const fs = require('fs');
const path = require('path');
const { shinDevig } = require('../lib/devig');
const noVig = require('../value-engine/noVig');

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const OUT = arg('--out', process.env.FD_DIR || path.join(process.env.SP || '/tmp', 'fd'));
const SEASONS = String(arg('--seasons', '2324,2425,2526')).split(',').map((s) => s.trim()).filter(Boolean);
const DIVS = ['E0', 'E1', 'E2', 'E3', 'D1', 'D2', 'SP1', 'SP2', 'I1', 'I2', 'F1', 'F2', 'N1', 'P1', 'B1', 'T1', 'G1', 'SC0'];
const NO_DL = args.includes('--no-download');
fs.mkdirSync(OUT, { recursive: true });

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

// CSV sencillo con comillas (football-data no usa comas dentro de campos, pero por si acaso)
function parseCsv(txt) {
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim().length);
  const split = (l) => { const o = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; };
  const H = split(lines[0]);
  return lines.slice(1).map((l) => { const c = split(l); const o = {}; H.forEach((h, i) => { o[h] = c[i]; }); return o; });
}

const BUCKETS = [[1, 1.5, '≤1,50'], [1.5, 2, '1,50-2,00'], [2, 2.5, '2,00-2,50'], [2.5, 3.2, '2,50-3,20'], [3.2, 5, '3,20-5,00'], [5, 8, '5,00-8,00'], [8, 1e9, '>8,00']];
const bucketOf = (o) => BUCKETS.find(([lo, hi]) => o > lo && o <= hi);

async function main() {
  const agg = {}; for (const b of BUCKETS) agg[b[2]] = { tramo: b[2], n: 0, prop: 0, shin: 0, obs: 0, brier_prop: 0, brier_shin: 0, ll_prop: 0, ll_shin: 0 };
  const files = [];
  let matches = 0, srcCount = { PSC: 0, PS: 0, AvgC: 0 }, zs = [];
  for (const s of SEASONS) for (const d of DIVS) {
    const r = await download(s, d);
    files.push({ season: s, div: d, ...r });
    if (!r.file) continue;
    for (const row of parseCsv(fs.readFileSync(r.file, 'utf8'))) {
      const ftr = row.FTR; if (!['H', 'D', 'A'].includes(ftr)) continue;
      let o = null, src = null;
      for (const [pre, tag] of [['PSC', 'PSC'], ['PS', 'PS'], ['AvgC', 'AvgC']]) {
        const h = Number(row[pre + 'H']), dd = Number(row[pre + 'D']), a = Number(row[pre + 'A']);
        if (h > 1 && dd > 1 && a > 1) { o = [h, dd, a]; src = tag; break; }
      }
      if (!o) continue;
      const sh = shinDevig(o); if (sh.status !== 'ok') continue;
      const pr = noVig.proportional(o.map((x) => 1 / x)); if (pr.status !== 'ok') continue;
      matches++; srcCount[src]++; if (sh.method === 'shin') zs.push(sh.z);
      ['H', 'D', 'A'].forEach((code, i) => {
        const b = bucketOf(o[i]); if (!b) return;
        const a = agg[b[2]]; const y = ftr === code ? 1 : 0;
        const pP = pr.probabilities[i], pS = sh.probabilities[i];
        a.n++; a.prop += pP; a.shin += pS; a.obs += y;
        a.brier_prop += (pP - y) ** 2; a.brier_shin += (pS - y) ** 2;
        a.ll_prop += -(y * Math.log(pP) + (1 - y) * Math.log(1 - pP)); a.ll_shin += -(y * Math.log(pS) + (1 - y) * Math.log(1 - pS));
      });
    }
  }
  const pct = (x) => (100 * x).toFixed(1).replace('.', ',') + ' %';
  const rows = Object.values(agg).filter((a) => a.n).map((a) => ({
    tramo: a.tramo, n: a.n, prop: a.prop / a.n, shin: a.shin / a.n, obs: a.obs / a.n,
    err_prop_pp: 100 * (a.prop - a.obs) / a.n, err_shin_pp: 100 * (a.shin - a.obs) / a.n,
    brier_prop: a.brier_prop / a.n, brier_shin: a.brier_shin / a.n, ll_prop: a.ll_prop / a.n, ll_shin: a.ll_shin / a.n,
  }));
  const tot = rows.reduce((t, r) => ({ n: t.n + r.n, bp: t.bp + r.brier_prop * r.n, bs: t.bs + r.brier_shin * r.n, lp: t.lp + r.ll_prop * r.n, ls: t.ls + r.ll_shin * r.n }), { n: 0, bp: 0, bs: 0, lp: 0, ls: 0 });
  const zMean = zs.length ? zs.reduce((a, b) => a + b, 0) / zs.length : null;
  const md = [];
  md.push(`Partidos: ${matches} (${SEASONS.join(', ')}; ${DIVS.length} divisiones; fuente del cierre: PSC ${srcCount.PSC}, PS ${srcCount.PS}, AvgC ${srcCount.AvgC}). z medio de Shin: ${zMean != null ? zMean.toFixed(4) : '—'}.`);
  md.push('');
  md.push('| Tramo de cuota | n resultados | Implícita proporcional | Implícita Shin | Frecuencia real | Error prop. (pp) | Error Shin (pp) | Brier prop. | Brier Shin |');
  md.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of rows) md.push(`| ${r.tramo} | ${r.n} | ${pct(r.prop)} | ${pct(r.shin)} | ${pct(r.obs)} | ${r.err_prop_pp >= 0 ? '+' : ''}${r.err_prop_pp.toFixed(2).replace('.', ',')} | ${r.err_shin_pp >= 0 ? '+' : ''}${r.err_shin_pp.toFixed(2).replace('.', ',')} | ${r.brier_prop.toFixed(4).replace('.', ',')} | ${r.brier_shin.toFixed(4).replace('.', ',')} |`);
  md.push(`| **Total** | ${tot.n} | | | | | | ${(tot.bp / tot.n).toFixed(4).replace('.', ',')} | ${(tot.bs / tot.n).toFixed(4).replace('.', ',')} |`);
  md.push('');
  md.push(`Log-loss medio por resultado: proporcional ${(tot.lp / tot.n).toFixed(5).replace('.', ',')} · Shin ${(tot.ls / tot.n).toFixed(5).replace('.', ',')}.`);
  const missing = files.filter((f) => !f.file);
  if (missing.length) md.push(`\nFicheros no disponibles (${missing.length}): ${missing.map((f) => `${f.season}/${f.div} (${f.error})`).join(', ')}.`);
  console.log(md.join('\n'));
  fs.writeFileSync(path.join(OUT, 'fd-devig-summary.json'), JSON.stringify({ generated_at: new Date().toISOString(), seasons: SEASONS, divs: DIVS, matches, src: srcCount, z_mean: zMean, rows, total: { n: tot.n, brier_prop: tot.bp / tot.n, brier_shin: tot.bs / tot.n, ll_prop: tot.lp / tot.n, ll_shin: tot.ls / tot.n }, files }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
