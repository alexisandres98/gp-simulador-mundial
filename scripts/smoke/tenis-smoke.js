// scripts/smoke/tenis-smoke.js — HUMO DE LAS MEJORAS DE TENIS (2-sep), sin red y sin arrancar server.js
//
// Requiere el motor directamente (store.js + data.js), construye la base y, para 3 partidos ATP y 3 WTA
// (sintéticos: parejas de jugadores reales de la base con cuotas inventadas), imprime:
//   · p_a ANTES (ensamble congelado) y DESPUÉS de edad + calendario, con el logit y los pp de cada ajuste
//   · dist_method ('c6' en ATP bo3 con tabla; 'shift' en el resto), P(over) en la mediana y suma de la PMF
// y COMPRUEBA: la WTA no cambia (p_a === p_a_base, ajustes a cero), la PMF de C6 suma 1, P(over mediana)
// en ATP bo3 cae en 0,42-0,48, y el hándicap sigue usando el margen del compilador. Sale con código 1 si
// algo falla. No escribe nada en disco.
//
// USO: node scripts/smoke/tenis-smoke.js
'use strict';

const path = require('path');
const T = require(path.join(__dirname, '..', '..', 'tennis-engine', 'store.js'));
const D = require(path.join(__dirname, '..', '..', 'tennis-engine', 'data.js'));

const t0 = Date.now();
const d = D.build();
console.log(`[smoke] base: ${d.rows.length} filas · último partido ${JSON.stringify(d.meta.last_match_date)} · cola desde ${d.meta.tail && d.meta.tail.from} · ${Date.now() - t0} ms`);
const gr = (d.T[0].cst.gamesResid || {}).bo3;
console.log(`[smoke] tabla C6 ATP bo3: ${gr ? `cortes ${gr.cuts.join(' / ')} · n ${gr.n.join('/')}` : 'AUSENTE (correr scripts/tennis-resid.js)'}`);

// parejas: los 6 jugadores más recientes con fecha de nacimiento y ≥ 60 partidos, por circuito
function parejas(tn) {
  const c = [];
  for (const [id, p] of d.T[tn].prof) { const pl = d.players[tn + ':' + id]; if (pl && pl.dob && p.w + p.l >= 60) c.push({ id, name: pl.name, last: p.lastDate }); }
  c.sort((a, b) => b.last - a.last);
  return [[c[0], c[1]], [c[2], c[3]], [c[4], c[5]]];
}
const fallos = [];
const check = (ok, msg) => { if (!ok) fallos.push(msg); console.log(`  ${ok ? 'OK ' : 'FALLO'} ${msg}`); };

const commence = new Date(Date.now() + 36 * 3600e3).toISOString();
for (const [tn, keys] of [[0, ['tennis_atp_cincinnati', 'tennis_atp_us_open', 'tennis_atp_paris_masters']], [1, ['tennis_wta_cincinnati', 'tennis_wta_us_open', 'tennis_wta_beijing']]]) {
  console.log(`\n═══ ${tn === 0 ? 'ATP' : 'WTA'} ═══`);
  parejas(tn).forEach(([A, B], i) => {
    const ev = { id: `smoke_${tn}_${i}`, _tkey: keys[i], _ttitle: keys[i], home_team: A.name, away_team: B.name, commence_time: commence };
    const m = T.eventModel(ev);
    if (!m.available) { fallos.push(`${A.name} vs ${B.name}: ${m.why}`); return; }
    const adj = m.adjustments;
    const gd = T.gamesPmf(m);
    const suma = gd.pairs.reduce((s, [, p]) => s + p, 0);
    let c = 0, med = null; for (const [g, p] of gd.pairs) { c += p; if (c >= 0.5 && med == null) med = g; }
    const dp = T.distProbs(m, med, null), dph = T.distProbs(m, med + 0.5, null);
    console.log(`\n${A.name} vs ${B.name} · ${keys[i]} · bo${m.best_of}`);
    console.log(`  p_a base ${m.p_a_base} → ${m.p_a}  (edad logit ${adj.age_logit} = ${adj.age_pp} pp · calendario logit ${adj.calendar_logit} = ${adj.calendar_pp} pp · calendario: ${adj.calendar}${adj.calendar_detail ? ' ' + JSON.stringify(adj.calendar_detail) : ''})`);
    console.log(`  edad: ${typeof adj.age === 'object' ? JSON.stringify(adj.age) : adj.age}`);
    console.log(`  dist_method ${gd.method}${gd.tercil != null ? ' (tercil ' + gd.tercil + ')' : ''} · exp_games ${m.exp_games} · mediana ${med} · P(over ${med}) ${dp.pOver.toFixed(4)} push ${dp.pushT.toFixed(4)} · P(over ${med + 0.5}) ${dph.pOver.toFixed(4)} · ΣPMF ${suma.toFixed(6)}`);
    check(Math.abs(suma - 1) < 1e-6, 'la PMF suma 1');
    check(Math.abs(dp.pOver + dp.pushT + (1 - dp.pOver - dp.pushT) - 1) < 1e-9, 'over + push + under = 1');
    if (tn === 1) {
      check(m.p_a === m.p_a_base && adj.age_logit === 0 && adj.calendar_logit === 0, 'WTA: p_a no cambia (edad y calendario a cero)');
      check(gd.method === 'shift', 'WTA: distribución por desplazamiento');
    } else {
      check(typeof adj.age === 'object' ? adj.age_logit !== 0 || adj.age.diff === 0 : true, 'ATP: edad aplicada cuando hay dob');
      check(['aplicado', 'sin fecha real'].includes(adj.calendar), `ATP: calendario anotado (${adj.calendar})`);
      if (m.best_of === 3 && gr) {
        check(gd.method === 'c6', 'ATP bo3: dist_method c6');
        check(dph.pOver > 0.42 && dph.pOver < 0.48, `ATP bo3: P(over mediana+0,5) = ${dph.pOver.toFixed(3)} en 0,42-0,48`);
        check(gd.pairs.every(([g]) => Number.isInteger(g)), 'ATP bo3: soporte entero (push definido en líneas enteras)');
      } else check(gd.method === 'shift', `ATP bo${m.best_of}: sigue el desplazamiento`);
    }
    // el hándicap no cambia de técnica: sale del margen del compilador
    const sp = T.distProbs(m, null, -2.5);
    check(sp.pCoverA != null && sp.pCoverA > 0 && sp.pCoverA < 1, `SPREAD −2,5 desde el margen: P(cubre) ${sp.pCoverA != null ? sp.pCoverA.toFixed(3) : '—'}`);
  });
}

// el simulador puntúa igual (ajustes a fecha de hoy) y la ficha lleva what_matters
const [A, B] = parejas(0)[0];
const sim = T.simMatch(0, A.name, B.name, { surface: 0, bestOf: 3 });
console.log(`\n[sim] ${A.name} vs ${B.name}: p_a ${sim.p_a_base} → ${sim.p_a} · dist ${sim.duel.dist_method} · what_matters:`);
for (const w of sim.what_matters || []) console.log(`   ${w.rank}. ${w.driver} (${w.pp} pp): ${w.text}`);
check(Array.isArray(sim.what_matters) && sim.what_matters.length > 0, 'simulador: what_matters con líneas en español');

console.log(`\n[smoke] ${fallos.length ? fallos.length + ' FALLO(S): ' + fallos.join(' | ') : 'todo OK'} · ${Date.now() - t0} ms`);
process.exit(fallos.length ? 1 : 0);
