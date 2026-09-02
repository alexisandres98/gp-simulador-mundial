// H4 — retiros: (a) fracción de retiros por superficie/ronda/best_of/nivel/circuito en la base;
// (b) término de riesgo de retiro por jugador (edad, ranking, historial de retiros, carga) — regresión
// logística ajustada en dev (2018→2024), evaluada fuera de muestra en la espina del holdout (2025→2026-05-25).
'use strict';
const P = require('./pass.js'); const fs = require('fs');
const DEV0 = 20180101, DEV1 = 20250101, SPINE_END = 20260526;
const r3 = (x) => Math.round(x * 1e3) / 1e3, r4 = (x) => Math.round(x * 1e4) / 1e4;
const OUT = {};
// (a) descriptivo sobre la base completa (espina; la cola ESPN no marca retiros de forma fiable)
const F = P.F, rows = P.rows.filter((r) => r[F.date] < SPINE_END);
const frac = (fn) => { const o = {}; for (const r of rows) { const k = fn(r); o[k] = o[k] || { n: 0, ret: 0 }; o[k].n++; o[k].ret += r[F.ret] ? 1 : 0; } return Object.fromEntries(Object.entries(o).sort().map(([k, v]) => [k, { n: v.n, ret_pct: r3(100 * v.ret / v.n) }])); };
OUT.desc = { tour: frac((r) => (r[F.tour] === 0 ? 'atp' : 'wta')), surface: frac((r) => ['dura', 'arcilla', 'hierba', 'moqueta'][r[F.surface]] || 'desc'), best_of: frac((r) => 'bo' + r[F.best_of]), round: frac((r) => 'r' + r[F.round]), level: frac((r) => r[F.level]), tail_flag: { n_tail: P.rows.filter((r) => r[F.date] >= SPINE_END).length, ret_tail: P.rows.filter((r) => r[F.date] >= SPINE_END && r[F.ret]).length } };
OUT.desc.tour_bo = frac((r) => (r[F.tour] === 0 ? 'atp' : 'wta') + '_bo' + r[F.best_of]);
// juegos jugados en partidos con retiro (impacto en TOTAL): distribución de juegos completados
const rg = rows.filter((r) => r[F.ret]).map((r) => r[F.games_w] + r[F.games_l]); rg.sort((a, b) => a - b);
OUT.desc.games_when_ret = { n: rg.length, mean: r3(rg.reduce((a, b) => a + b, 0) / rg.length), p25: rg[Math.floor(rg.length * 0.25)], median: rg[Math.floor(rg.length * 0.5)], p75: rg[Math.floor(rg.length * 0.75)] };
console.log('(a) descriptivo:', JSON.stringify(OUT.desc, null, 0));

for (const tour of [0, 1]) {
  const lbl = tour === 0 ? 'atp' : 'wta';
  const all = JSON.parse(fs.readFileSync(__dirname + `/preds_${lbl}.json`, 'utf8')).filter((p) => p.date < SPINE_END);
  // dataset por jugador-partido: y = este jugador se retiró
  const meanAge = 26, meanLogRank = 4.3;
  const rowsOf = (arr) => { const X = [], y = [], meta = []; for (const p of arr) for (const [f, yy] of [[p.fX, p.retX], [p.fY, p.retY]]) { const age = f.age != null ? f.age : meanAge; const lr = f.rank ? Math.log(f.rank) : meanLogRank; X.push([1, (age - 26) / 5, ((age - 26) / 5) ** 2, lr - 4.3, f.rank ? 0 : 1, Math.log1p(100 * f.retRate), f.lastRet, f.n7, Math.log1p(Math.min(30, f.rest)), f.prevMin > 0 ? f.prevMin / 60 : 1.8, f.prevMin > 0 ? 0 : 1, p.bo === 5 ? 1 : 0, p.surf === 1 ? 1 : 0, p.surf === 2 ? 1 : 0]); y.push(yy); meta.push({ date: p.date, tid: p.tid }); } return { X, y, meta }; };
  const NAMES = ['const', 'edad', 'edad2', 'logRank', 'rankMiss', 'log1p_retRate100', 'lastRet', 'n7', 'restL', 'prevMinH', 'prevMiss', 'bo5', 'arcilla', 'hierba'];
  const dev = all.filter((p) => p.date >= DEV0 && p.date < DEV1), ho = all.filter((p) => p.date >= DEV1);
  const D = rowsOf(dev), H = rowsOf(ho);
  const fit = P.logreg(D.X, D.y, 1e-3);
  const coef = Object.fromEntries(NAMES.map((k, j) => [k, { b: r4(fit.b[j]), se: r4(fit.se[j]), t: r3(fit.b[j] / fit.se[j]) }]));
  const pH = H.X.map((row) => P.sig(row.reduce((s, v, j) => s + v * fit.b[j], 0)));
  const base = D.y.reduce((a, b) => a + b, 0) / D.y.length;
  const llOf = (ps) => H.y.reduce((s, yy, i) => { const pc = P.clamp(ps[i], 1e-6, 1 - 1e-6); return s + (yy ? -Math.log(pc) : -Math.log(1 - pc)); }, 0) / H.y.length;
  const m = P.metrics(H.y.map((yy, i) => ({ p: pH[i], y: yy })));
  const llBase = llOf(H.y.map(() => base));
  // solo edad+ranking (sin historial) y solo historial, para atribuir
  const sub = (idx) => { const Xd = D.X.map((r) => idx.map((j) => r[j])), Xh = H.X.map((r) => idx.map((j) => r[j])); const f = P.logreg(Xd, D.y, 1e-3); const ps = Xh.map((row) => P.sig(row.reduce((s, v, j) => s + v * f.b[j], 0))); return { auc: r4(P.metrics(H.y.map((yy, i) => ({ p: ps[i], y: yy }))).auc), logloss: r4(llOf(ps)) }; };
  const onlyAgeRank = sub([0, 1, 2, 3, 4]), onlyHist = sub([0, 5, 6]), onlyLoad = sub([0, 7, 8, 9, 10]), ctx = sub([0, 11, 12, 13]);
  // deciles de riesgo en holdout
  const order = pH.map((p, i) => i).sort((a, b) => pH[a] - pH[b]); const dec = []; const n = order.length;
  for (let d = 0; d < 10; d++) { const idx = order.slice(Math.floor(d * n / 10), Math.floor((d + 1) * n / 10)); dec.push({ dec: d + 1, n: idx.length, p_pred: r4(idx.reduce((s, i) => s + pH[i], 0) / idx.length), ret_real: r4(idx.reduce((s, i) => s + H.y[i], 0) / idx.length) }); }
  // a nivel de partido: P(alguien se retira) = 1 − (1−pX)(1−pY)
  const pm = []; for (let i = 0; i < pH.length; i += 2) pm.push({ p: 1 - (1 - pH[i]) * (1 - pH[i + 1]), y: H.y[i] || H.y[i + 1] ? 1 : 0 });
  const mm = P.metrics(pm); const baseM = 1 - (1 - base) ** 2; const llBaseM = pm.reduce((s, r) => s + (r.y ? -Math.log(baseM) : -Math.log(1 - baseM)), 0) / pm.length;
  const res = { n_dev_playerrows: D.X.length, n_ho_playerrows: H.X.length, base_rate_dev: r4(base), ho_rate: r4(H.y.reduce((a, b) => a + b, 0) / H.y.length), coef, holdout: { auc: r4(m.auc), logloss: r4(m.logloss), logloss_base_rate: r4(llBase), skill_vs_base_pct: r3(100 * (1 - m.logloss / llBase)) }, ablation: { edad_ranking: onlyAgeRank, historial_retiros: onlyHist, carga: onlyLoad, contexto_bo_surf: ctx }, deciles: dec, match_level: { n: pm.length, auc: r4(mm.auc), logloss: r4(mm.logloss), logloss_base: r4(llBaseM), skill_pct: r3(100 * (1 - mm.logloss / llBaseM)), top_decile_rate: r4((() => { const o = pm.map((r, i) => i).sort((a, b) => pm[b].p - pm[a].p).slice(0, Math.floor(pm.length / 10)); return o.reduce((s, i) => s + pm[i].y, 0) / o.length; })()) } };
  OUT[lbl] = res;
  console.log(`\n══════ ${lbl.toUpperCase()} ══════ filas jugador dev ${D.X.length} · holdout ${H.X.length} · tasa base ${(100 * base).toFixed(2)}% · holdout ${(100 * res.ho_rate).toFixed(2)}%`);
  console.log('  coef:', NAMES.map((k, j) => `${k}=${fit.b[j].toFixed(3)}(t ${(fit.b[j] / fit.se[j]).toFixed(1)})`).join(' '));
  console.log(`  holdout jugador: AUC ${m.auc.toFixed(4)} · LL ${m.logloss.toFixed(5)} vs tasa base ${llBase.toFixed(5)} → skill ${res.holdout.skill_vs_base_pct}%`);
  console.log('  ablación:', JSON.stringify(res.ablation));
  console.log('  deciles:', JSON.stringify(dec));
  console.log('  partido:', JSON.stringify(res.match_level));
}
// (c) libro: picks TOTAL/ML anulados por retiro
const book = JSON.parse(fs.readFileSync('/tmp/claude-0/-home-user-gp-simulador-mundial/be6747bd-41b1-5761-8bf4-37a3efc202e9/scratchpad/research/tennis_full2.json', 'utf8'));
const vo = (book.recent || []).filter((p) => p.result === 'VOID'); OUT.book_void = { voided_total: book.voided, en_recent: vo.length, por_familia: vo.reduce((o, p) => { o[p.family] = (o[p.family] || 0) + 1; return o; }, {}) };
console.log('\n(c) libro:', JSON.stringify(OUT.book_void));
fs.writeFileSync(__dirname + '/h4_out.json', JSON.stringify(OUT, null, 1));
