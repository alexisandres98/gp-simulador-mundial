// H1 — probabilidad de MAPA en Valorant, walk-forward estricto sobre data/esports/valorant/series.json.
// Predictores (todos point-in-time; se predice ANTES de actualizar con la serie):
//   wr_k      win-rate de mapas del equipo en los últimos 365 días, encogida hacia 0,5 con k mapas
//             (p_a = 0,5 + (sh_A − sh_B)/2 — la fórmula de valorant-data.vetoInput; producción k=8 por mapa)
//   elo_gp    Elo de SERIE con las constantes de priors.json (K=32, margen 1,7, óxido 1,5) → p_serie → p_mapa
//             invirtiendo simulateSeries (core.seriesToMap, tabla precalculada por bo)
//   elo_plain Elo de serie K=32 sin margen ni óxido → idem
//   elomap_K  Elo actualizado POR MAPA (cada mapa es un partido; K_map barrido en desarrollo), p = logística
//   blend_λ   logit p = logit(elomap) + λ·(logit(wr) − logit(elomap))   (¿aporta el win-rate algo al Elo?)
//   temp_a    logit p = a·logit(elomap)  (temperatura de calibración)
//   elo por NOMBRE de mapa (hipótesis c): SOLO si las filas traen `maps[]` con nombre — el series.json del repo
//             no los trae (ver datos_faltantes) y el script lo declara.
// Evaluación por MAPA: en una serie con s1-s2 mapas y predicción p para cada mapa, la suma de Brier/log-loss
// sobre los mapas no depende del orden: Brier = [s1·(1−p)² + s2·p²]/(s1+s2). Acierto = fracción de mapas cuyo
// ganador coincide con el lado p≥0,5.
// Ventanas: desarrollo = antes de (última fecha − 90 días); intacta = últimos 90 días, evaluada UNA vez.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = '/home/user/gp-simulador-mundial';
const OUT = path.join(__dirname);
const C = require(path.join(REPO, 'esports-engine/core.js'));

const raw = JSON.parse(fs.readFileSync(path.join(REPO, 'data/esports/valorant/series.json'), 'utf8'));
const all = Object.values(raw.rows)
  .filter((s) => s.t1 && s.t2 && s.at && s.s1 != null && s.s2 != null && (s.s1 + s.s2) > 0 && s.s1 !== s.s2)
  .sort((a, b) => (a.at + (a.time || '') < b.at + (b.time || '') ? -1 : 1));
const hasMapNames = all.some((s) => Array.isArray(s.maps) && s.maps.length);
console.log(`[h1] ${all.length} series ${all[0].at} → ${all[all.length - 1].at}; filas con nombre de mapa: ${hasMapNames ? 'SÍ' : 'NO (hipótesis c no evaluable)'}`);

// unidad: mapas. BO1 con marcador de rondas → 1 mapa.
const mapsOf = (s) => {
  const mx = Math.max(s.s1, s.s2);
  if (mx >= 13) return { ma: s.s1 > s.s2 ? 1 : 0, mb: s.s1 > s.s2 ? 0 : 1, bo: 1, bo1rounds: true };
  const bo = mx <= 1 ? 1 : (2 * mx - 1);
  return { ma: s.s1, mb: s.s2, bo: Math.min(bo, 5), bo1rounds: false };
};
const lastAt = all[all.length - 1].at;
const holdStart = new Date(Date.parse(lastAt + 'T12:00:00Z') - 90 * 864e5).toISOString().slice(0, 10);
console.log(`[h1] ventana intacta desde ${holdStart}`);
const MIN_N = 10;

// tabla p_serie → p_mapa (inversa de simulateSeries con momentum 0,06), por bo
const S2M = {};
for (const bo of [3, 5]) {
  S2M[bo] = [];
  for (let i = 0; i <= 100; i++) {
    const ps = Math.min(0.99, Math.max(0.01, i / 100));
    S2M[bo].push(C.seriesToMap(ps, bo));
  }
}
const s2m = (ps, bo) => {
  if (bo === 1) return ps;
  const t = S2M[bo] || S2M[3];
  const x = Math.min(99.999, Math.max(0, ps * 100));
  const i = Math.floor(x), f = x - i;
  return t[i] * (1 - f) + t[Math.min(100, i + 1)] * f;
};
const lg = (p) => Math.log(p / (1 - p));
const sg = (x) => 1 / (1 + Math.exp(-x));
const cl = (p) => Math.min(0.97, Math.max(0.03, p));

// ── una pasada walk-forward que produce, por serie, TODAS las probabilidades base ──────────────────────────
function pass({ K = 32, mb = 1.7, ib = 1.5, kMap = 16, kWr = [4, 8, 16, 32], winDays = 365 } = {}) {
  const elo = new Map(), eloP = new Map(), eloM = new Map(), games = new Map(), last = new Map();
  const wrHist = new Map();   // team → array de {t, w, n} (mapas)
  const get = (m, k, d) => (m.has(k) ? m.get(k) : d);
  const out = [];
  for (const s of all) {
    const { ma, mb: mbm, bo, bo1rounds } = mapsOf(s);
    const nA = get(games, s.t1, 0), nB = get(games, s.t2, 0);
    const t = Date.parse(s.at + 'T12:00:00Z');
    const rec = { id: s.id, at: s.at, t1: s.t1, t2: s.t2, s1: s.s1, s2: s.s2, ma, mb: mbm, bo, bo1rounds, event: s.event,
      qual: nA >= MIN_N && nB >= MIN_N, nA, nB, p: {} };
    // (b) Elo de serie → p_mapa
    const ra = get(elo, s.t1, 1500), rb = get(elo, s.t2, 1500);
    const pS = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    rec.p.elo_gp = cl(s2m(pS, bo)); rec.p_series_gp = pS;
    const ra2 = get(eloP, s.t1, 1500), rb2 = get(eloP, s.t2, 1500);
    const pS2 = 1 / (1 + Math.pow(10, (rb2 - ra2) / 400));
    rec.p.elo_plain = cl(s2m(pS2, bo));
    // (b2) Elo por mapa
    const ma1 = get(eloM, s.t1, 1500), mb1 = get(eloM, s.t2, 1500);
    const pM = 1 / (1 + Math.pow(10, (mb1 - ma1) / 400));
    rec.p.elomap = cl(pM);
    // (a) win-rate 365d encogido
    const wrOf = (team) => {
      const h = wrHist.get(team) || [];
      let w = 0, n = 0;
      for (let i = h.length - 1; i >= 0; i--) { if (t - h[i].t > winDays * 864e5) break; w += h[i].w; n += h[i].n; }
      return { w, n };
    };
    const A = wrOf(s.t1), B = wrOf(s.t2);
    rec.wrA = A; rec.wrB = B;
    for (const k of kWr) {
      const sh = (x) => (x.w + 0.5 * k) / (x.n + k);
      rec.p['wr_' + k] = cl(Math.max(0.05, Math.min(0.95, 0.5 + (sh(A) - sh(B)) / 2)));
    }
    out.push(rec);
    // ── actualización (después de predecir) ──
    const y = s.s1 > s.s2 ? 1 : 0;
    const idle = (team) => { const lp = last.get(team); return lp != null && (t - lp) > 60 * 864e5; };
    const margin = Math.abs(s.s1 - s.s2) / Math.max(1, s.s1 + s.s2);
    const scale = 1 + (mb - 1) * margin;
    elo.set(s.t1, ra + K * (idle(s.t1) ? ib : 1) * scale * (y - pS));
    elo.set(s.t2, rb - K * (idle(s.t2) ? ib : 1) * scale * (y - pS));
    eloP.set(s.t1, ra2 + K * (y - pS2)); eloP.set(s.t2, rb2 - K * (y - pS2));
    // por mapa: suma de (y_i − p) sobre los mapas = ma − (ma+mb)·p
    const dM = kMap * (ma - (ma + mbm) * pM);
    eloM.set(s.t1, ma1 + dM); eloM.set(s.t2, mb1 - dM);
    games.set(s.t1, nA + 1); games.set(s.t2, nB + 1);
    last.set(s.t1, t); last.set(s.t2, t);
    (wrHist.get(s.t1) || wrHist.set(s.t1, []).get(s.t1)).push({ t, w: ma, n: ma + mbm });
    (wrHist.get(s.t2) || wrHist.set(s.t2, []).get(s.t2)).push({ t, w: mbm, n: ma + mbm });
  }
  out.final = { eloM, elo, eloP, wrHist, games };
  return out;
}

// ── métricas por mapa ─────────────────────────────────────────────────────────────────────────────────────
function metrics(recs, pf) {
  let n = 0, br = 0, ll = 0, hit = 0;
  const bins = {};
  const edges = [0, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 1.0001];
  for (const r of recs) {
    const p = cl(pf(r)); const m = r.ma + r.mb;
    n += m;
    br += r.ma * (1 - p) ** 2 + r.mb * p ** 2;
    ll += -(r.ma * Math.log(p) + r.mb * Math.log(1 - p));
    hit += p >= 0.5 ? r.ma : r.mb;
    let b = 0; while (p >= edges[b + 1]) b++;
    const key = edges[b].toFixed(2) + '-' + Math.min(1, edges[b + 1]).toFixed(2);
    const B = bins[key] = bins[key] || { n: 0, sp: 0, y: 0 };
    B.n += m; B.sp += p * m; B.y += r.ma;
  }
  let ece = 0;
  const cal = Object.entries(bins).sort().map(([k, b]) => {
    ece += (b.n / n) * Math.abs(b.sp / b.n - b.y / b.n);
    return { tramo: k, n_mapas: b.n, p_medio: +(b.sp / b.n).toFixed(3), observado: +(b.y / b.n).toFixed(3) };
  });
  return { n_mapas: n, n_series: recs.length, brier: +(br / n).toFixed(5), logloss: +(ll / n).toFixed(5),
    acierto_pct: +(100 * hit / n).toFixed(2), ece: +ece.toFixed(4), calibracion: cal };
}
// bootstrap por serie (cluster) de la diferencia de Brier entre dos predictores
function bootDiff(recs, pfA, pfB, reps = 1000, seed = 7) {
  const rnd = C.rng(seed);
  const per = recs.map((r) => {
    const a = cl(pfA(r)), b = cl(pfB(r)); const m = r.ma + r.mb;
    return { da: r.ma * (1 - a) ** 2 + r.mb * a ** 2, db: r.ma * (1 - b) ** 2 + r.mb * b ** 2, m };
  });
  const tot = per.reduce((s, x) => s + x.m, 0);
  const point = per.reduce((s, x) => s + x.da - x.db, 0) / tot;
  const ds = [];
  for (let r = 0; r < reps; r++) {
    let d = 0, m = 0;
    for (let i = 0; i < per.length; i++) { const x = per[(rnd() * per.length) | 0]; d += x.da - x.db; m += x.m; }
    ds.push(d / m);
  }
  ds.sort((a, b) => a - b);
  const mean = ds.reduce((a, b) => a + b, 0) / reps;
  const sd = Math.sqrt(ds.reduce((a, b) => a + (b - mean) ** 2, 0) / (reps - 1));
  return { diff_brier: +point.toFixed(5), se: +sd.toFixed(5), ci95: [+ds[Math.floor(0.025 * reps)].toFixed(5), +ds[Math.floor(0.975 * reps)].toFixed(5)], z: +(point / sd).toFixed(2) };
}

// ── desarrollo: barrido de constantes libres ─────────────────────────────────────────────────────────────
const base = pass({ kMap: 16 });
const dev = base.filter((r) => r.qual && r.at < holdStart);
const hold = base.filter((r) => r.qual && r.at >= holdStart);
const isVct = (r) => /champions tour|vct|masters|champions/i.test(String(r.event || ''));
console.log(`[h1] desarrollo: ${dev.length} series cualificadas; intacta: ${hold.length} series (${hold.filter(isVct).length} VCT)`);

const devTable = {};
for (const k of [4, 8, 16, 32]) devTable['wr_' + k] = metrics(dev, (r) => r.p['wr_' + k]);
devTable.elo_gp = metrics(dev, (r) => r.p.elo_gp);
devTable.elo_plain = metrics(dev, (r) => r.p.elo_plain);
// K_map barrido: pasadas separadas
const kmapRuns = {};
for (const kMap of [8, 12, 16, 24, 32, 40]) {
  const run = kMap === 16 ? base : pass({ kMap });
  kmapRuns[kMap] = run;
  devTable['elomap_' + kMap] = metrics(run.filter((r) => r.qual && r.at < holdStart), (r) => r.p.elomap);
}
const bestKmap = Object.entries(devTable).filter(([k]) => k.startsWith('elomap_')).sort((a, b) => a[1].brier - b[1].brier)[0];
const KM = +bestKmap[0].split('_')[1];
const runKM = kmapRuns[KM];
const devKM = runKM.filter((r) => r.qual && r.at < holdStart);
const holdKM = runKM.filter((r) => r.qual && r.at >= holdStart);
// blend λ (con wr_8, el de producción) y temperatura a — elegidos en desarrollo
for (const lam of [0, 0.25, 0.5, 0.75, 1]) devTable['blend_' + lam] = metrics(devKM, (r) => sg(lg(r.p.elomap) + lam * (lg(r.p.wr_8) - lg(r.p.elomap))));
for (const a of [0.7, 0.85, 1, 1.15, 1.3]) devTable['temp_' + a] = metrics(devKM, (r) => sg(a * lg(r.p.elomap)));
const bestLam = +Object.entries(devTable).filter(([k]) => k.startsWith('blend_')).sort((a, b) => a[1].brier - b[1].brier)[0][0].split('_')[1];
const bestTemp = +Object.entries(devTable).filter(([k]) => k.startsWith('temp_')).sort((a, b) => a[1].brier - b[1].brier)[0][0].split('_')[1];
const bestWr = Object.entries(devTable).filter(([k]) => k.startsWith('wr_')).sort((a, b) => a[1].brier - b[1].brier)[0][0];
console.log(`[h1] desarrollo → mejor K_map=${KM}, mejor λ=${bestLam}, mejor temperatura=${bestTemp}, mejor wr=${bestWr}`);
console.log('  predictor        n_mapas  Brier    logloss  acierto  ECE');
for (const [k, m] of Object.entries(devTable)) console.log(`  ${k.padEnd(16)} ${String(m.n_mapas).padEnd(8)} ${String(m.brier).padEnd(8)} ${String(m.logloss).padEnd(8)} ${String(m.acierto_pct).padEnd(8)} ${m.ece}`);

// ── ventana intacta, UNA vez, con lo elegido en desarrollo ───────────────────────────────────────────────
const preds = {
  moneda: (r) => 0.5,
  wr_8_prod: (r) => r.p.wr_8,
  [bestWr + '_dev']: (r) => r.p[bestWr],
  elo_gp: (r) => r.p.elo_gp,
  elo_plain: (r) => r.p.elo_plain,
  ['elomap_' + KM]: (r) => r.p.elomap,
  ['blend_' + bestLam]: (r) => sg(lg(r.p.elomap) + bestLam * (lg(r.p.wr_8) - lg(r.p.elomap))),
  ['temp_' + bestTemp]: (r) => sg(bestTemp * lg(r.p.elomap)),
};
const holdTable = {}, holdVct = {}, boots = {};
for (const [k, pf] of Object.entries(preds)) {
  holdTable[k] = metrics(holdKM, pf);
  holdVct[k] = metrics(holdKM.filter(isVct), pf);
  if (k !== 'wr_8_prod') boots[k + '_vs_wr8'] = bootDiff(holdKM, pf, (r) => r.p.wr_8);
}
console.log(`\n[h1] VENTANA INTACTA (≥${holdStart}, ${holdKM.length} series, ${holdTable.moneda.n_mapas} mapas)`);
console.log('  predictor        n_mapas  Brier    logloss  acierto  ECE     ΔBrier vs wr_8 (SE) z');
for (const [k, m] of Object.entries(holdTable)) {
  const b = boots[k + '_vs_wr8'];
  console.log(`  ${k.padEnd(16)} ${String(m.n_mapas).padEnd(8)} ${String(m.brier).padEnd(8)} ${String(m.logloss).padEnd(8)} ${String(m.acierto_pct).padEnd(8)} ${String(m.ece).padEnd(7)} ${b ? `${b.diff_brier} (${b.se}) z=${b.z}` : '—'}`);
}
console.log(`\n[h1] intacta SOLO eventos VCT/Champions (${holdVct.moneda.n_series} series, ${holdVct.moneda.n_mapas} mapas)`);
for (const [k, m] of Object.entries(holdVct)) console.log(`  ${k.padEnd(16)} ${String(m.n_mapas).padEnd(8)} ${String(m.brier).padEnd(8)} ${String(m.logloss).padEnd(8)} ${String(m.acierto_pct).padEnd(8)} ${m.ece}`);
console.log('\n[h1] calibración intacta wr_8 (producción):'); console.table(holdTable.wr_8_prod.calibracion);
console.log(`[h1] calibración intacta elomap_${KM}:`); console.table(holdTable['elomap_' + KM].calibracion);

const result = { at: new Date().toISOString(), series: all.length, hold_start: holdStart, min_n: MIN_N,
  map_names_available: hasMapNames,
  hipotesis_c: hasMapNames ? 'evaluable' : 'NO EVALUABLE: series.json del repo no trae nombre de mapa por partida (solo s1/s2 de serie; los BO1 traen rondas). El detalle cosechado vive en /data/val-raw (Render), no en el repo.',
  desarrollo: { n_series: dev.length, tabla: devTable, elegido: { k_map: KM, lambda: bestLam, temperatura: bestTemp, wr: bestWr } },
  intacta: { n_series: holdKM.length, tabla: holdTable, vct: holdVct, bootstrap_vs_wr8: boots } };
fs.writeFileSync(path.join(OUT, 'h1_result.json'), JSON.stringify(result, null, 1));
// predicciones por serie para H2/H4 (predictor ganador = el de mejor Brier en desarrollo entre los candidatos finales)
const devFinal = Object.fromEntries(Object.entries(preds).filter(([k]) => k !== 'moneda').map(([k, pf]) => [k, metrics(devKM, pf).brier]));
const winner = Object.entries(devFinal).sort((a, b) => a[1] - b[1])[0][0];
console.log(`[h1] predictor ganador EN DESARROLLO (el que usa H2/H4): ${winner}`);
const rowsOut = runKM.map((r) => ({ id: r.id, at: r.at, t1: r.t1, t2: r.t2, s1: r.s1, s2: r.s2, bo: r.bo, bo1rounds: r.bo1rounds, qual: r.qual, event: r.event,
  p_win: +preds[winner](r).toFixed(4), p_wr8: +r.p.wr_8.toFixed(4), p_elomap: +r.p.elomap.toFixed(4), p_elo_gp: +r.p.elo_gp.toFixed(4) }));
fs.writeFileSync(path.join(OUT, 'h1_preds.json'), JSON.stringify({ winner, k_map: KM, lambda: bestLam, temperatura: bestTemp, rows: rowsOut }));
// rating final (point-in-time para las picks: empiezan el 18-ago y la última serie es del 17-ago)
{
  const F = runKM.final; const tEnd = Date.parse(lastAt + 'T12:00:00Z');
  const teams = {};
  for (const [team, e] of F.eloM) {
    const h = F.wrHist.get(team) || []; let w = 0, n = 0;
    for (let i = h.length - 1; i >= 0; i--) { if (tEnd - h[i].t > 365 * 864e5) break; w += h[i].w; n += h[i].n; }
    teams[team] = { elo_map: +e.toFixed(1), elo_series_gp: +(F.elo.get(team) || 1500).toFixed(1), wr365_w: w, wr365_n: n, series: F.games.get(team) || 0 };
  }
  fs.writeFileSync(path.join(OUT, 'h1_final_ratings.json'), JSON.stringify({ at: lastAt, k_map: KM, lambda: bestLam, temperatura: bestTemp, winner, teams }));
}
console.log('[h1] escrito h1_result.json y h1_preds.json');
