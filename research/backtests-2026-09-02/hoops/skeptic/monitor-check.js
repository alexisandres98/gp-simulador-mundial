#!/usr/bin/env node
// monitor-check.js — verificación independiente del libro del monitor WNBA (hoops_picks_league_wnba.json)
'use strict';
const path = require('path');
const B = require(path.join(__dirname, '..', '..', '..', 'research', 'hoops_picks_league_wnba.json'));
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sdv = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const S = B.settled.filter((p) => p.result_code !== 'VOID');
console.log('settled', B.settled.length, 'sin VOID', S.length, 'códigos', JSON.stringify(B.settled.reduce((a, p) => (a[p.result_code] = (a[p.result_code] || 0) + 1, a), {})));
// 1) aritmética de unidades: ¿units del libro == best_odds−1 / −1?
let mism = 0; for (const p of S) { const u = p.result_code === 'WIN' ? p.best_odds - 1 : -1; if (Math.abs(u - p.units) > 0.011) { mism++; if (mism < 5) console.log('  units mismatch', p.id, p.units, u); } }
console.log('units mismatches vs best_odds:', mism);
// 2) ¿hay PUSH posibles? líneas enteras
const intLines = S.filter((p) => p.family !== 'MONEYLINE' && Number.isInteger(p.line)); console.log('picks con línea entera (posible push):', intLines.length, intLines.map((p) => p.id).slice(0, 5));
// 3) fechas
const cr = S.map((p) => p.created_at).sort(); console.log('created_at rango', cr[0], cr[cr.length - 1]);
const ko = S.map((p) => p.event.kickoff_at).sort(); console.log('kickoff rango', ko[0], ko[ko.length - 1]);
// 4) TOTAL: overs en x3,5–x4,5 → cuántos partidos distintos
const TT = S.filter((p) => p.family === 'TOTAL');
const resid = (x) => ((x % 5) + 5) % 5;
const bug = TT.filter((p) => p.side === 'over' && resid(p.line) >= 3.5 && resid(p.line) <= 4.5);
const games = (l) => new Set(l.map((p) => p.game_id));
console.log(`TOTAL n=${TT.length} en ${games(TT).size} partidos · overs-bug n=${bug.length} en ${games(bug).size} partidos · resto n=${TT.length - bug.length} en ${games(TT.filter((p) => !bug.includes(p))).size}`);
// resultado por PARTIDO (una tesis = partido+lado), no por pick
const byThesis = {}; for (const p of TT) (byThesis[p.game_id + '|' + p.side] = byThesis[p.game_id + '|' + p.side] || []).push(p);
const th = Object.values(byThesis).map((l) => ({ side: l[0].side, line0: l[0].line, lines: [...new Set(l.map((p) => p.line))].join(','), n: l.length, res: l[0].result_code, bug: l.some((p) => bug.includes(p)) }));
console.table(th);
const thBug = th.filter((t) => t.bug), thRest = th.filter((t) => !t.bug);
console.log(`tesis bug: ${thBug.length}, ganadas ${thBug.filter((t) => t.res === 'WIN').length} · tesis resto: ${thRest.length}, ganadas ${thRest.filter((t) => t.res === 'WIN').length}`);
// 4b) TODOS los totales del monitor: over vs under, y residuo
console.log('TOTAL por lado:', JSON.stringify(TT.reduce((a, p) => (a[p.side] = (a[p.side] || 0) + 1, a), {})), 'por residuo:', JSON.stringify(TT.reduce((a, p) => (a[resid(p.line)] = (a[resid(p.line)] || 0) + 1, a), {})));
// 5) SPREAD: clusters y muestra efectiva; ROI por tesis (primera pick) y ponderado
const SP = S.filter((p) => p.family === 'SPREAD').sort((a, b) => a.created_at.localeCompare(b.created_at));
const cl = {}; for (const p of SP) (cl[p.game_id + '|' + p.side] = cl[p.game_id + '|' + p.side] || []).push(p);
const clusters = Object.values(cl);
console.log(`SPREAD n=${SP.length} · tesis ${clusters.length} · partidos ${games(SP).size}`);
const unit = (p) => (p.result_code === 'WIN' ? p.best_odds - 1 : -1);
const agg = (l, lab) => { const u = l.map(unit); const clv = l.filter((p) => p.clv_pct != null).map((p) => p.clv_pct); console.log(`  ${lab}: n=${l.length} hit=${r2(100 * l.filter((p) => p.result_code === 'WIN').length / l.length)} roi=${r2(100 * mean(u))}±${r2(100 * sdv(u) / Math.sqrt(u.length))} clv n=${clv.length} avg=${r2(mean(clv))}±${r2(sdv(clv) / Math.sqrt(clv.length || 1))}`); };
agg(SP, 'todas');
agg(clusters.map((l) => l[0]), 'primera de cada tesis');
agg(clusters.map((l) => l[l.length - 1]), 'última de cada tesis');
// CLV por tesis (media dentro de la tesis) → t sobre tesis
const clvT = clusters.map((l) => { const c = l.filter((p) => p.clv_pct != null).map((p) => p.clv_pct); return c.length ? mean(c) : null; }).filter((x) => x != null);
console.log(`  CLV medio por tesis: n=${clvT.length} avg=${r2(mean(clvT))} se=${r2(sdv(clvT) / Math.sqrt(clvT.length))} t=${r2(mean(clvT) / (sdv(clvT) / Math.sqrt(clvT.length)))} negativos=${clvT.filter((x) => x < 0).length}`);
// 6) ¿el CLV es de la MISMA línea? comparar close_odds/best_odds
const wc = SP.filter((p) => p.close_odds != null);
console.log('  con close_odds', wc.length, 'ejemplo', wc.slice(0, 3).map((p) => `${p.line}@${p.best_odds}→close ${p.close_odds} clv ${p.clv_pct}`).join(' | '));
// 7) tope de |línea| — sensibilidad del split y del tope
const absL = (p) => Math.abs(p.line);
for (const cap of [4.5, 6.5, 8.5, 10.5, 12.5]) { const l = SP.filter((p) => absL(p) <= cap); const t = clusters.filter((c) => absL(c[0]) <= cap); console.log(`  |línea|≤${cap}: picks n=${l.length} hit=${r2(100 * l.filter((p) => p.result_code === 'WIN').length / l.length)} roi=${r2(100 * mean(l.map(unit)))} · tesis n=${t.length} ganadas=${t.filter((c) => c[0].result_code === 'WIN').length}`); }
// 8) picks por partido: ¿cuántas del mismo partido en ambos lados?
const bothSides = Object.values(SP.reduce((a, p) => ((a[p.game_id] = a[p.game_id] || new Set()).add(p.side), a), {})).filter((s) => s.size > 1).length;
console.log('  partidos con picks a AMBOS lados del hándicap:', bothSides);
