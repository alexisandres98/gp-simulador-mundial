#!/usr/bin/env node
// h3.js — hándicap WNBA en el libro del monitor (hoops_picks_league_wnba.json): ¿por qué el CLV es −4,6 %?
//  · el libro NO guarda la línea de cierre, solo la cuota de cierre de la MISMA línea → CLV de precio.
//  · pero SÍ guarda una pick nueva cada vez que la línea se mueve (el id lleva la línea), así que la
//    trayectoria de líneas dentro de un partido+lado reconstruye el movimiento del mercado.
// uso: node h3.js
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', '..', 'research', 'hoops_picks_league_wnba.json'));
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const S = B.settled.filter((p) => p.result_code !== 'VOID');
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sdv = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const unit = (p) => (p.result_code === 'WIN' ? p.best_odds - 1 : p.result_code === 'LOSS' ? -1 : 0);
const agg = (list) => {
  if (!list.length) return { n: 0 };
  const u = list.map(unit); const mu = mean(u), se = sdv(u) / Math.sqrt(u.length);
  const w = list.filter((p) => p.result_code === 'WIN').length;
  const clv = list.filter((p) => p.clv_pct != null).map((p) => p.clv_pct);
  const uc = list.filter((p) => p.close_odds != null).map((p) => (p.result_code === 'WIN' ? p.close_odds - 1 : -1));
  return { n: list.length, wins: w, hit_pct: r2(100 * w / list.length), roi_best_pct: r2(100 * mu), roi_se_pp: r2(100 * se), t: se > 0 ? r2(mu / se) : null,
    clv_n: clv.length, clv_avg: r2(mean(clv)), clv_se: clv.length > 1 ? r2(sdv(clv) / Math.sqrt(clv.length)) : null, clv_t: clv.length > 1 && sdv(clv) > 0 ? r2(mean(clv) / (sdv(clv) / Math.sqrt(clv.length))) : null,
    clv_pos_pct: clv.length ? r2(100 * clv.filter((x) => x > 0).length / clv.length) : null,
    roi_close_pct: uc.length ? r2(100 * mean(uc)) : null, avg_raw_edge_pp: r2(100 * mean(list.map((p) => p.model_prob_raw - p.market_prob))), avg_blend_edge_pp: r2(mean(list.map((p) => p.edge_pp))) };
};
const out = {};
console.log(`libro: ${B.settled.length} liquidadas en la respuesta (el track dice ${B.track.total.n}: la API recorta) · ${S.length} sin VOID`);
out.families = {}; for (const f of ['SPREAD', 'TOTAL', 'MONEYLINE']) { out.families[f] = agg(S.filter((p) => p.family === f)); console.log(`  ${f}: ${JSON.stringify(out.families[f])}`); }

const SP = S.filter((p) => p.family === 'SPREAD').sort((a, b) => a.created_at.localeCompare(b.created_at));
// ── 1) signo del desacuerdo crudo vs signo del CLV ──
const withClv = SP.filter((p) => p.clv_pct != null);
const agree = withClv.filter((p) => Math.sign(p.model_prob_raw - p.market_prob) === Math.sign(p.clv_pct)).length;
out.sign = { n: withClv.length, raw_edge_and_clv_same_sign: agree, pct: r2(100 * agree / withClv.length), note: 'por construcción model_raw − market > 0 en todas; CLV<0 en la mayoría ⇒ el mercado se movió CONTRA el lado del modelo' };
console.log('\n1) signo(model_raw − market) vs signo(CLV):', JSON.stringify(out.sign));
// correlación tamaño del desacuerdo ↔ CLV
const xs = withClv.map((p) => 100 * (p.model_prob_raw - p.market_prob)), ys = withClv.map((p) => p.clv_pct);
const corr = (a, b) => { const ma = mean(a), mb = mean(b); return a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0) / Math.sqrt(a.reduce((s, x) => s + (x - ma) ** 2, 0) * b.reduce((s, x) => s + (x - mb) ** 2, 0)); };
out.corr_rawedge_clv = r2(corr(xs, ys)); console.log('   corr(desacuerdo crudo pp, CLV %) =', out.corr_rawedge_clv);

// ── 2) por tamaño de línea y por lado ──
const absLine = (p) => Math.abs(p.line);
const bandsL = [[0, 4], [4, 8], [8, 12], [12, 30]];
out.by_abs_line = bandsL.map(([lo, hi]) => ({ band: `|línea| ${lo}-${hi}`, ...agg(SP.filter((p) => absLine(p) >= lo && absLine(p) < hi)) }));
console.log('\n2) por |línea|:'); for (const b of out.by_abs_line) console.log('  ', JSON.stringify(b));
out.by_side = {}; for (const s of ['home', 'away']) { out.by_side[s] = agg(SP.filter((p) => p.side === s)); console.log(`   lado ${s}: ${JSON.stringify(out.by_side[s])}`); }
// favorito vs perdedor: side home con line<0 ⇒ favorito local; side away con line>0 ⇒ favorito visitante
const isFav = (p) => (p.side === 'home' && p.line < 0) || (p.side === 'away' && p.line > 0);
out.by_fav = { favorito: agg(SP.filter(isFav)), perdedor: agg(SP.filter((p) => !isFav(p))) };
console.log(`   FAVORITO: ${JSON.stringify(out.by_fav.favorito)}\n   PERDEDOR (dog): ${JSON.stringify(out.by_fav.perdedor)}`);
// por casas cotizando
out.by_books = [[0, 4], [4, 7], [7, 99]].map(([lo, hi]) => ({ band: `casas ${lo}-${hi}`, ...agg(SP.filter((p) => p.books >= lo && p.books < hi)) }));
console.log('   por casas:', out.by_books.map((b) => `${b.band}: n=${b.n} clv=${b.clv_avg} roi=${b.roi_best_pct}`).join(' | '));
// por antelación (horas al saque)
const hrs = (p) => (Date.parse(p.event.kickoff_at) - Date.parse(p.created_at)) / 36e5;
out.by_lead = [[-1, 3], [3, 12], [12, 30], [30, 999]].map(([lo, hi]) => ({ band: `antelación ${lo}-${hi} h`, ...agg(SP.filter((p) => hrs(p) >= lo && hrs(p) < hi)) }));
console.log('   por antelación:', out.by_lead.map((b) => `${b.band}: n=${b.n} hit=${b.hit_pct} clv=${b.clv_avg} roi=${b.roi_best_pct}`).join(' | '));

// ── 3) trayectoria de la línea dentro del partido+lado ──
// "favorabilidad" de la línea para el lado elegido: para home = line (más puntos a favor, mejor); para away = −line
const favLine = (p) => (p.side === 'home' ? p.line : -p.line);
const clusters = {};
for (const p of SP) (clusters[p.game_id + '|' + p.side] = clusters[p.game_id + '|' + p.side] || []).push(p);
const cl = Object.values(clusters).map((l) => l.sort((a, b) => a.created_at.localeCompare(b.created_at)));
const multi = cl.filter((l) => l.length >= 2);
let against = 0, favor = 0, flat = 0; const rowsMove = [];
for (const l of multi) {
  const d = favLine(l[l.length - 1]) - favLine(l[0]);          // >0: la línea se movió A FAVOR del lado (más puntos)
  const dRaw = l[l.length - 1].model_prob_raw - l[0].model_prob_raw;
  if (Math.abs(d) < 1e-9) flat++; else if (d > 0) against++; else favor++;
  rowsMove.push({ side: l[0].side, first: l[0].line, last: l[l.length - 1].line, n: l.length, line_move_for_side: d, raw_prob_change: r2(dRaw), result: l[0].result_code, clv_avg: r2(mean(l.filter((p) => p.clv_pct != null).map((p) => p.clv_pct))) });
}
out.clusters = { n_picks: SP.length, n_clusters: cl.length, n_multi: multi.length, line_moved_against_side: against, line_moved_toward_side: favor, flat,
  note: '"contra" = el mercado dio MÁS puntos a nuestro lado después (nuestro lado se abarató: el dinero fue al otro). "hacia" = nos quitó puntos (el dinero vino a nuestro lado).' };
console.log('\n3) clusters partido+lado:', JSON.stringify(out.clusters));
console.table(rowsMove);
// el modelo dobla la apuesta cuando la línea se mueve contra: correlación entre movimiento y cambio de la p cruda
const mv = rowsMove.filter((r) => r.line_move_for_side !== 0);
out.doubling = { n: mv.length, corr_linemove_rawprob: r2(corr(mv.map((r) => r.line_move_for_side), mv.map((r) => r.raw_prob_change))), avg_raw_change_when_against: r2(mean(mv.filter((r) => r.line_move_for_side > 0).map((r) => r.raw_prob_change))) };
console.log('   el modelo sube su p cruda cuando el mercado le da más puntos:', JSON.stringify(out.doubling));

// ── 4) reglas candidatas con split temporal (mitad por created_at) ──
const cut = SP[Math.floor(SP.length / 2)].created_at;
const dev = SP.filter((p) => p.created_at < cut), tst = SP.filter((p) => p.created_at >= cut);
console.log(`\n4) reglas · desarrollo n=${dev.length} (< ${cut.slice(0, 16)}) · evaluación n=${tst.length}`);
// regla A: solo la PRIMERA pick del cluster (no re-picar cuando la línea ya se movió)
const firstOf = new Set(cl.map((l) => l[0].id));
const ruleA = (p) => firstOf.has(p.id);
// regla B: la línea no se ha movido contra (no existe pick anterior en el cluster con línea menos favorable, es decir, no nos han dado puntos desde entonces)
const ruleB = (p) => { const l = clusters[p.game_id + '|' + p.side]; return !l.some((q) => q.created_at < p.created_at && favLine(q) < favLine(p)); };
// regla C: tope |línea| ≤ cap — cap elegido en desarrollo
const capGrid = [4.5, 6.5, 8.5, 10.5];
let bestCap = null;
for (const cap of capGrid) { const a = agg(dev.filter((p) => absLine(p) <= cap)); if (a.n >= 15 && (!bestCap || a.clv_avg > bestCap.a.clv_avg)) bestCap = { cap, a }; }
// regla D: solo favoritos / solo perdedores — elegido en desarrollo por CLV
const favDev = agg(dev.filter(isFav)), dogDev = agg(dev.filter((p) => !isFav(p)));
const pickFav = favDev.clv_avg > dogDev.clv_avg;
const rules = { base: () => true, A_primera_del_cluster: ruleA, B_linea_no_movida_contra: ruleB };
if (bestCap) rules[`C_abs_linea_le_${bestCap.cap}`] = (p) => absLine(p) <= bestCap.cap;
rules[pickFav ? 'D_solo_favoritos' : 'D_solo_perdedores'] = pickFav ? isFav : (p) => !isFav(p);
rules.E_B_y_C = (p) => ruleB(p) && (bestCap ? absLine(p) <= bestCap.cap : true);
out.rules = {};
for (const [name, f] of Object.entries(rules)) { out.rules[name] = { dev: agg(dev.filter(f)), test: agg(tst.filter(f)) }; console.log(`   ${name.padEnd(28)} DEV ${JSON.stringify(out.rules[name].dev)}\n   ${''.padEnd(28)} TEST ${JSON.stringify(out.rules[name].test)}`); }
out.cap_dev_grid = capGrid.map((cap) => ({ cap, ...agg(dev.filter((p) => absLine(p) <= cap)) }));
console.log('   barrido de tope |línea| en desarrollo:', out.cap_dev_grid.map((x) => `≤${x.cap}: n=${x.n} clv=${x.clv_avg} roi=${x.roi_best_pct}`).join(' | '));

// ── 5) TOTAL: overs en líneas x3,5/x4/x4,5 (bug) vs resto ──
const TT = S.filter((p) => p.family === 'TOTAL');
const resid = (x) => ((x % 5) + 5) % 5;
const bugOver = TT.filter((p) => p.side === 'over' && resid(p.line) >= 3.5 && resid(p.line) <= 4.5);
out.total_bug = { overs_bug_lines: agg(bugOver), resto: agg(TT.filter((p) => !bugOver.includes(p))) };
console.log('\n5) TOTAL monitor · overs en x3,5–x4,5 (bug):', JSON.stringify(out.total_bug.overs_bug_lines), '\n   resto:', JSON.stringify(out.total_bug.resto));
out.moneyline = agg(S.filter((p) => p.family === 'MONEYLINE'));
require('fs').writeFileSync(path.join(__dirname, 'out', 'h3.json'), JSON.stringify(out, null, 1));
