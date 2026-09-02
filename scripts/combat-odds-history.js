#!/usr/bin/env node
/**
 * CUOTAS HISTÓRICAS DE UFC (2-sep, backtests §7.4 punto 5: "el dato que más cambia el juego").
 *
 * Cruza un dataset público con cuotas de cierre (ufc-master.csv, el "Ultimate UFC Dataset" de Kaggle; espejo
 * público en GitHub del propio autor) con NUESTRO histórico data/combat/fights-ufc.json por nombres
 * normalizados + fecha ±1 día, y con eso mide lo que nunca pudimos medir con 48 picks:
 *   · cobertura del cruce por año,
 *   · Brier/log-loss de la implícita de cierre (de-vig 2-way) — el listón real,
 *   · Brier/log-loss del modelo ACTUAL (Elo + rasgos, walk-forward EXACTO al de scripts/combat-backtest-v2.js:
 *     mismo warm-up, mismo SGD, mismas stats finas) sobre las MISMAS peleas,
 *   · el peso w de la mezcla lineal (1−w)·modelo + w·cierre que minimiza el log-loss, por año y global,
 *   · y, como bono, la regla preregistrada (docs/PREREGISTRO_COMBATE_FAVORITO.md) simulada al cierre.
 * Guarda el cruce compacto en data/combat/odds-history.json.gz (solo si pesa < 2 MB).
 *
 * Uso: node scripts/combat-odds-history.js [--csv=/ruta/ufc-master.csv] [--warm=0.35] [--no-save]
 * Sin --csv, descarga el CSV a un caché temporal (raw.githubusercontent.com). Sin red, sin server, sin db.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const CE = require('../combat-engine/ratings');

const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const WARM = Number(args.warm || 0.35);
const FEAT_LR = 0.01;
const ROOT = path.join(__dirname, '..');
const OUT_GZ = path.join(ROOT, 'data', 'combat', 'odds-history.json.gz');
const CSV_URLS = [
  'https://raw.githubusercontent.com/shortlikeafox/ultimate_ufc_dataset/main/data/ultimate_ufc_dataset/ufc-master.csv',
];

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const cm = (c) => { const m = String(c || '').match(/(\d+):(\d+)/); return m ? (+m[1] + +m[2] / 60) : 0; };
const sigm = (z) => 1 / (1 + Math.exp(-z));
const logit = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
const ll = (p, y) => -(y * Math.log(clamp(p)) + (1 - y) * Math.log(1 - clamp(p)));
const amToDec = (a) => { const x = Number(a); if (!isFinite(x) || x === 0) return null; return x > 0 ? 1 + x / 100 : 1 + 100 / (-x); };
const dayKey = (d) => String(d).slice(0, 10);
const shiftDay = (k, dd) => new Date(Date.parse(k) + dd * 864e5).toISOString().slice(0, 10);

// ---- CSV (comillas con comas dentro) ----
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}
async function loadCsv() {
  let file = args.csv;
  if (!file) {
    file = path.join(os.tmpdir(), 'gp-ufc-master.csv');
    if (!fs.existsSync(file)) {
      let ok = false;
      for (const u of CSV_URLS) {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(60000) });
          if (!r.ok) { console.error('descarga', u, 'HTTP', r.status); continue; }
          fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); ok = true; console.log('descargado', u, '→', file); break;
        } catch (e) { console.error('descarga', u, e.message); }
      }
      if (!ok) { console.error('sin CSV: pasa --csv=/ruta/ufc-master.csv'); process.exit(2); }
    }
  }
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const hdr = parseCsvLine(lines[0]);
  const ix = (n) => hdr.indexOf(n);
  const I = { red: ix('RedFighter'), blue: ix('BlueFighter'), ro: ix('RedOdds'), bo: ix('BlueOdds'), date: ix('Date'), win: ix('Winner'), wc: ix('WeightClass'), rounds: ix('NumberOfRounds') };
  // esquemas alternos del mismo dataset (versiones viejas: R_fighter/B_fighter/R_odds/B_odds)
  if (I.red < 0) I.red = ix('R_fighter'); if (I.blue < 0) I.blue = ix('B_fighter'); if (I.ro < 0) I.ro = ix('R_odds'); if (I.bo < 0) I.bo = ix('B_odds'); if (I.date < 0) I.date = ix('date');
  if (I.red < 0 || I.blue < 0 || I.ro < 0 || I.bo < 0 || I.date < 0) { console.error('columnas no reconocidas:', hdr.slice(0, 12)); process.exit(2); }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const ro = amToDec(c[I.ro]), bo = amToDec(c[I.bo]);
    rows.push({ red: c[I.red], blue: c[I.blue], red_odds: ro, blue_odds: bo, date: c[I.date], winner: c[I.win] || null, wc: c[I.wc] || null, rounds: c[I.rounds] ? +c[I.rounds] : null });
  }
  return { rows, file };
}

// ---- nuestro histórico + join fino (copia de combat-backtest-v2: mismo modelo en producción) ----
function loadOurs() {
  const F = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'combat', 'fights-ufc.json'), 'utf8'));
  let fighters = {}; try { fighters = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'combat', 'fighters-ufc.json'), 'utf8')); } catch { }
  const fights = (F.fights || []).filter(f => f.completed && f.f1.id && f.f2.id && (f.f1.winner || f.f2.winner)).sort((a, b) => new Date(a.date) - new Date(b.date));
  return { fights, fighters };
}
function fineJoin(fights) {
  let raw; try { raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'combat', 'afstats-mma.json'), 'utf8')); } catch { return { perFight: {}, joined: 0 }; }
  const full = {}, last = {}, dupLast = {};
  for (const f of fights) for (const side of ['f1', 'f2']) {
    const n = norm(f[side].name); if (!n) continue;
    if (!full[n]) full[n] = f[side].id;
    const ln = n.split(' ').pop();
    if (ln && ln.length >= 3) { if (last[ln] && last[ln] !== f[side].id) { dupLast[ln] = 1; delete last[ln]; } else if (!dupLast[ln]) last[ln] = f[side].id; }
  }
  const byName = (nm) => { const n = norm(nm); return full[n] || last[n.split(' ').pop()] || null; };
  const byDay = {};
  for (const f of fights) { const d0 = dayKey(f.date); for (const dd of [-1, 0, 1]) { const k = shiftDay(d0, dd); (byDay[k] = byDay[k] || []).push(f); } }
  const perFight = {}; let joined = 0;
  for (const af of (raw.fights || [])) {
    const rows = raw.stats[af.id]; if (!rows || !rows.length) continue;
    const h = byName((af.f1 || {}).name), a = byName((af.f2 || {}).name);
    if (!h || !a) continue;
    const ours = (byDay[af.date] || []).find(f => (f.f1.id === h && f.f2.id === a) || (f.f1.id === a && f.f2.id === h));
    if (!ours) continue;
    joined++;
    const minutes = ((ours.end_round || 3) - 1) * 5 + cm(ours.end_clock);
    const afToOur = {}; afToOur[(af.f1 || {}).id] = h; afToOur[(af.f2 || {}).id] = a;
    const pf = perFight[ours.comp_id] = {};
    for (const row of rows) {
      const ourId = afToOur[(row.fighter || {}).id]; if (!ourId) continue;
      const st = row.strikes || {}; const tot = st.total || {};
      pf[ourId] = { min: minutes, str: (tot.head || 0) + (tot.body || 0) + (tot.legs || 0), td_att: (st.takedowns || {}).attempt || 0, td: (st.takedowns || {}).landed || 0, ctrl: cm(st.control_time), kd: st.knockdowns || 0 };
    }
  }
  return { perFight, joined };
}

// ---- cruce por nombres normalizados + fecha ±1 día ----
// Un nombre "casa" con el nuestro si coincide completo, o si coincide el apellido y la inicial del nombre
// (Kaggle escribe "Alexander Volkanovski" y ESPN también, pero hay "Dan" vs "Daniel", "Jr." sueltos, etc.).
function nameMatch(q, t) {
  const a = norm(q).split(' ').filter(Boolean), b = norm(t).split(' ').filter(Boolean);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 3;
  const la = a[a.length - 1], lb = b[b.length - 1];
  if (la === lb && a[0][0] === b[0][0]) return 2;
  // "Jr", "Jr." y similares al final: comparar sin sufijo
  const strip = (x) => x.filter(w => !/^(jr|sr|ii|iii)$/.test(w));
  const a2 = strip(a), b2 = strip(b);
  if (a2.length && b2.length && a2.join(' ') === b2.join(' ')) return 3;
  return 0;
}
function crossJoin(rows, fights) {
  const byDay = {};
  for (const f of fights) { const d0 = dayKey(f.date); for (const dd of [-1, 0, 1]) { const k = shiftDay(d0, dd); (byDay[k] = byDay[k] || []).push(f); } }
  const matched = new Map(); // comp_id → fila del CSV con orientación
  const stats = { csv_rows: rows.length, csv_with_odds: 0, matched: 0, ambiguous: 0, unmatched: 0, winner_agree: 0, winner_disagree: 0, by_year: {} };
  for (const r of rows) {
    const y = String(r.date).slice(0, 4);
    const by = stats.by_year[y] = stats.by_year[y] || { csv: 0, csv_odds: 0, matched: 0 };
    by.csv++;
    if (!(r.red_odds > 1 && r.blue_odds > 1)) continue;
    stats.csv_with_odds++; by.csv_odds++;
    const cands = [];
    for (const f of (byDay[dayKey(r.date)] || [])) {
      const s = nameMatch(r.red, f.f1.name) + nameMatch(r.blue, f.f2.name);
      const x = nameMatch(r.red, f.f2.name) + nameMatch(r.blue, f.f1.name);
      const st = nameMatch(r.red, f.f1.name) > 0 && nameMatch(r.blue, f.f2.name) > 0 ? s : 0;
      const fl = nameMatch(r.red, f.f2.name) > 0 && nameMatch(r.blue, f.f1.name) > 0 ? x : 0;
      if (st || fl) cands.push({ f, score: Math.max(st, fl), redIsF1: st >= fl });
    }
    if (!cands.length) { stats.unmatched++; continue; }
    cands.sort((a, b) => b.score - a.score);
    if (cands.length > 1 && cands[0].score === cands[1].score) { stats.ambiguous++; continue; }
    const c = cands[0];
    if (matched.has(c.f.comp_id)) { stats.ambiguous++; continue; } // dos filas del CSV para la misma pelea → nada
    const f1_odds = c.redIsF1 ? r.red_odds : r.blue_odds, f2_odds = c.redIsF1 ? r.blue_odds : r.red_odds;
    const i1 = 1 / f1_odds, i2 = 1 / f2_odds;
    const fair_f1 = i1 / (i1 + i2);
    const csvWinF1 = r.winner === 'Red' ? c.redIsF1 : r.winner === 'Blue' ? !c.redIsF1 : null;
    if (csvWinF1 != null) { if (csvWinF1 === !!c.f.f1.winner) stats.winner_agree++; else stats.winner_disagree++; }
    matched.set(c.f.comp_id, { comp_id: c.f.comp_id, date: c.f.date, f1_id: c.f.f1.id, f2_id: c.f.f2.id, f1_odds: +f1_odds.toFixed(3), f2_odds: +f2_odds.toFixed(3), fair_f1: +fair_f1.toFixed(4), csv_date: r.date, csv_winner_f1: csvWinF1 });
    stats.matched++; by.matched++;
  }
  return { matched, stats };
}

// ---- walk-forward del modelo ACTUAL (idéntico a combat-backtest-v2: variante ACTUAL) ----
function walkForward(fights, fighters, perFight, matched) {
  const warm = Math.floor(fights.length * WARM);
  const model = CE.newModel(null, {});
  const W = CE.newW();
  const rows = [];
  fights.forEach((f, i) => {
    const y = f.f1.winner ? 1 : 0;
    const ctx = { sched: f.rounds_sched || 3 };
    const pElo = CE.fightProb(model, f.f1.id, f.f2.id, f.date).p1;
    const fd = CE.featDiff(model, fighters, f.f1.id, f.f2.id, f.date, ctx);
    let z = W.elo * logit(pElo); for (const k of CE.ALL_FEATS) z += W[k] * fd[k];
    const pModel = sigm(z);
    const m = matched.get(f.comp_id);
    // TODAS las cruzadas van al archivo compacto; las del warm-up llevan `in_warm` y NO se evalúan
    if (m) rows.push({ ...m, y, in_warm: i < warm, p_elo: +pElo.toFixed(4), p_model: +pModel.toFixed(4), n1: model.N[f.f1.id] || 0, n2: model.N[f.f2.id] || 0 });
    const g = pModel - y;
    W.elo -= FEAT_LR * g * logit(pElo); for (const k of CE.ALL_FEATS) W[k] -= FEAT_LR * g * fd[k];
    CE.eloStep(model, f, perFight[f.comp_id] || null);
  });
  return { rows, warm, warmDate: fights[warm] ? dayKey(fights[warm].date) : null };
}

const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const sd = (a) => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) : null; };
function score(rows, f) {
  const b = rows.map(r => (f(r) - r.y) ** 2), l = rows.map(r => ll(f(r), r.y));
  const acc = rows.filter(r => (f(r) >= 0.5) === (r.y === 1)).length;
  return { n: rows.length, brier: +mean(b).toFixed(4), logloss: +mean(l).toFixed(4), acc: +(acc / rows.length).toFixed(4) };
}
function pairedBrier(rows, fA, fB) { // A − B por pelea (negativo = A mejor)
  const d = rows.map(r => (fA(r) - r.y) ** 2 - (fB(r) - r.y) ** 2);
  const m = mean(d), s = sd(d), se = s != null ? s / Math.sqrt(d.length) : null;
  return { n: d.length, dBrier: +m.toFixed(5), se: se != null ? +se.toFixed(5) : null, t: se ? +(m / se).toFixed(2) : null };
}
function bestW(rows) { // mezcla LINEAL (1−w)·modelo + w·cierre, la misma forma que usa el monitor (w=0,5 hoy)
  let best = null; const grid = [];
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const l = mean(rows.map(r => ll((1 - w) * r.p_model + w * r.fair_f1, r.y)));
    grid.push({ w: +w.toFixed(2), logloss: +l.toFixed(5) });
    if (!best || l < best.logloss) best = { w: +w.toFixed(2), logloss: +l.toFixed(5) };
  }
  return { best, grid };
}
// regla preregistrada simulada AL CIERRE: lado = mayor ventaja post-blend (0,5), umbral 2 pp, cuota < 3
function preregAtClose(rows) {
  const picks = [];
  for (const r of rows) {
    let best = null;
    for (const side of ['f1', 'f2']) {
      const m = side === 'f1' ? r.p_model : 1 - r.p_model, k = side === 'f1' ? r.fair_f1 : 1 - r.fair_f1;
      const odds = side === 'f1' ? r.f1_odds : r.f2_odds;
      if (!(odds > 1) || odds >= 3) continue;
      const eg = ((0.5 * m + 0.5 * k) - k) * 100;
      if (eg >= 2 && (!best || eg > best.eg)) best = { side, m, k, odds, eg, won: (side === 'f1') === (r.y === 1) };
    }
    if (best) picks.push({ ...best, year: String(r.date).slice(0, 4) });
  }
  const summ = (list) => { const u = list.map(p => p.won ? p.odds - 1 : -1); const s = sd(u); return { n: list.length, hit: list.length ? +(100 * list.filter(p => p.won).length / list.length).toFixed(1) : null, roi_pct: list.length ? +(100 * mean(u)).toFixed(1) : null, roi_se: s != null ? +(100 * s / Math.sqrt(list.length)).toFixed(1) : null, avg_odds: list.length ? +mean(list.map(p => p.odds)).toFixed(2) : null, implied_model: list.length ? +(100 * mean(list.map(p => p.m))).toFixed(1) : null, implied_close: list.length ? +(100 * mean(list.map(p => p.k))).toFixed(1) : null }; };
  return {
    todas: summ(picks),
    prereg_fav45: summ(picks.filter(p => p.k >= 0.45)),
    perro_k_lt45: summ(picks.filter(p => p.k < 0.45)),
    favorito_k_ge50: summ(picks.filter(p => p.k >= 0.5)),
    por_ventaja: { '2-4pp': summ(picks.filter(p => p.eg < 4)), '4-6pp': summ(picks.filter(p => p.eg >= 4 && p.eg < 6)), '>=6pp': summ(picks.filter(p => p.eg >= 6)) },
  };
}

(async () => {
  const { rows: csv, file } = await loadCsv();
  const { fights, fighters } = loadOurs();
  const { perFight, joined } = fineJoin(fights);
  const { matched, stats } = crossJoin(csv, fights);
  // cobertura sobre NUESTRAS peleas por año (dentro del rango del CSV)
  const ours_by_year = {}; for (const f of fights) { const y = dayKey(f.date).slice(0, 4); ours_by_year[y] = (ours_by_year[y] || 0) + 1; }
  const years = Object.keys(stats.by_year).sort();
  console.log(`CSV: ${file} · filas ${stats.csv_rows} · con cuotas ${stats.csv_with_odds} · cruzadas ${stats.matched} · ambiguas ${stats.ambiguous} · sin cruce ${stats.unmatched}`);
  console.log(`ganador CSV vs nuestro: coinciden ${stats.winner_agree} · discrepan ${stats.winner_disagree}`);
  console.log('cobertura por año (csv_con_cuotas → cruzadas / nuestras):');
  for (const y of years) { const b = stats.by_year[y]; console.log(`  ${y}  ${String(b.csv_odds).padStart(4)} → ${String(b.matched).padStart(4)} / ${String(ours_by_year[y] || 0).padStart(4)}  (${(100 * b.matched / Math.max(1, b.csv_odds)).toFixed(0)} % del CSV, ${(100 * b.matched / Math.max(1, ours_by_year[y] || 0)).toFixed(0) } % de las nuestras)`); }

  const { rows: allRows, warm, warmDate } = walkForward(fights, fighters, perFight, matched);
  const rows = allRows.filter(r => !r.in_warm); // evaluación: solo fuera de muestra
  console.log(`\nwalk-forward: ${fights.length} peleas · warm ${warm} (hasta ${warmDate}) · fine join ${joined} · cruzadas ${allRows.length} · evaluadas fuera de muestra: ${rows.length}`);
  const res = {
    generado: new Date().toISOString(), csv_rows: stats.csv_rows, cruzadas: stats.matched, evaluadas: rows.length, warm_hasta: warmDate,
    cobertura_por_año: Object.fromEntries(years.map(y => [y, { csv_odds: stats.by_year[y].csv_odds, cruzadas: stats.by_year[y].matched, nuestras: ours_by_year[y] || 0 }])),
    ganador_coincide: stats.winner_agree, ganador_discrepa: stats.winner_disagree,
    global: {
      cierre: score(rows, r => r.fair_f1), elo_puro: score(rows, r => r.p_elo), modelo_actual: score(rows, r => r.p_model),
      blend_05: score(rows, r => 0.5 * r.p_model + 0.5 * r.fair_f1),
      pareado_modelo_vs_cierre: pairedBrier(rows, r => r.p_model, r => r.fair_f1),
      pareado_blend05_vs_cierre: pairedBrier(rows, r => 0.5 * r.p_model + 0.5 * r.fair_f1, r => r.fair_f1),
      pareado_modelo_vs_elo: pairedBrier(rows, r => r.p_model, r => r.p_elo),
      w_optimo: bestW(rows),
    },
    por_año: {},
    prereg_al_cierre: preregAtClose(rows),
  };
  console.log('\nGLOBAL (peleas con cuota, fuera de muestra):');
  for (const k of ['cierre', 'elo_puro', 'modelo_actual', 'blend_05']) console.log(`  ${k.padEnd(14)}`, JSON.stringify(res.global[k]));
  console.log('  modelo − cierre (Brier pareado):', JSON.stringify(res.global.pareado_modelo_vs_cierre));
  console.log('  blend0,5 − cierre (Brier pareado):', JSON.stringify(res.global.pareado_blend05_vs_cierre));
  console.log('  modelo − Elo puro (Brier pareado):', JSON.stringify(res.global.pareado_modelo_vs_elo));
  console.log('  w* lineal (log-loss):', JSON.stringify(res.global.w_optimo.best), '· grid:', res.global.w_optimo.grid.map(g => `${g.w}:${g.logloss}`).join(' '));
  console.log('\nPOR AÑO:  n · Brier cierre · Brier modelo · Brier blend0,5 · w* (log-loss)');
  for (const y of years) {
    const ry = rows.filter(r => dayKey(r.date).slice(0, 4) === y);
    if (ry.length < 30) continue;
    const c = score(ry, r => r.fair_f1), m = score(ry, r => r.p_model), b = score(ry, r => 0.5 * r.p_model + 0.5 * r.fair_f1), w = bestW(ry).best;
    res.por_año[y] = { n: ry.length, cierre: c, modelo: m, blend_05: b, w_optimo: w };
    console.log(`  ${y}  ${String(ry.length).padStart(4)}   ${c.brier}      ${m.brier}      ${b.brier}       w=${w.w} (${w.logloss})`);
  }
  console.log('\nREGLA PREREGISTRADA SIMULADA AL CIERRE (lado de mayor ventaja post-blend, ≥2 pp, cuota <3):');
  for (const [k, v] of Object.entries(res.prereg_al_cierre)) console.log(`  ${k.padEnd(18)}`, JSON.stringify(v));

  // salida compacta
  // c=comp_id, d=día, a/b=ids f1/f2, oa/ob=cuota decimal de cierre, k=fair f1 de-vig, y=ganó f1,
  // pe/pm=Elo puro / modelo ACTUAL walk-forward en ese momento, w=1 si la pelea cayó en el warm-up (no evaluar)
  const compact = { fuente: 'ufc-master.csv (Ultimate UFC Dataset, Kaggle; espejo GitHub shortlikeafox/ultimate_ufc_dataset)', generado: res.generado, cuotas: 'decimal, cierre según el dataset; k = fair f1 de-vig 2-way', warm_hasta: warmDate, n: allRows.length, n_fuera_de_muestra: rows.length,
    peleas: allRows.map(r => ({ c: r.comp_id, d: dayKey(r.date), a: r.f1_id, b: r.f2_id, oa: r.f1_odds, ob: r.f2_odds, k: r.fair_f1, y: r.y, pe: r.p_elo, pm: r.p_model, ...(r.in_warm ? { w: 1 } : {}) })) };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(compact)), { level: 9 });
  console.log(`\ncruce compacto: ${allRows.length} peleas (${rows.length} fuera de muestra) · ${(gz.length / 1024).toFixed(0)} KB gzip`);
  if (args['no-save']) console.log('(--no-save: no se escribe)');
  else if (gz.length < 2 * 1024 * 1024) { fs.writeFileSync(OUT_GZ, gz); console.log('escrito', path.relative(ROOT, OUT_GZ)); }
  else console.log('NO se escribe: supera 2 MB');
  fs.writeFileSync(path.join(os.tmpdir(), 'gp-combat-odds-history-result.json'), JSON.stringify(res, null, 1));
  console.log('resumen JSON:', path.join(os.tmpdir(), 'gp-combat-odds-history-result.json'));
})().catch(e => { console.error(e); process.exit(1); });
