// tests/observer-reconcile.test.js — Reconciliación observer ↔ realidad (caso Olise, 10-jul).
// La señal sintética CONFIRMED que inyecta el server (alineación oficial / minutos jugados) debe limpiar
// al instante cualquier duda/baja previa vía assessPlayers (la señal más reciente BACK/CONFIRMED gana).
'use strict';
const path = require('path');
const { assessPlayers } = require(path.join(__dirname, '..', 'observer', 'assess'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const h = hrs => new Date(Date.now() - hrs * 3600e3).toISOString();
const sig = (category, at, over) => ({ category, severity: .5, player: 'Michael Olise', pid: 'pl_x', team: 'FRA', keyword: 'kw', title: 't', source: 'news', published_at: at, ...over });

console.log('\n§ resolución por alineación oficial');
{
  const signals = [sig('OUT', h(20), { source: 'diario1' }), sig('DOUBT', h(18), { source: 'diario2' })];
  const before = assessPlayers(signals)['pl_x'];
  ok('antes: en riesgo', before && before.prob_miss > 0);
  signals.push(sig('CONFIRMED', h(0), { source: 'alineacion_oficial', title: 'Titular en la alineación oficial' }));
  const after = assessPlayers(signals)['pl_x'];
  ok('después: OK con prob_miss 0', after && after.status === 'OK' && after.prob_miss === 0);
}

console.log('\n§ resolución por minutos jugados (post-partido, suplente que entró)');
{
  const signals = [sig('DOUBT', h(30))];
  signals.push(sig('CONFIRMED', h(0), { source: 'jugo_minutos', title: 'Jugó 27 minutos' }));
  const a = assessPlayers(signals)['pl_x'];
  ok('duda resuelta', a && a.status === 'OK' && a.prob_miss === 0);
}

console.log('\n§ la resolución NO borra dudas nuevas posteriores');
{
  // si DESPUÉS de la alineación aparece una noticia nueva (p.ej. se lesionó EN el partido), esa gana
  const signals = [
    sig('DOUBT', h(30)),
    sig('CONFIRMED', h(5), { source: 'alineacion_oficial' }),
    sig('OUT', h(1), { source: 'diario1' }), sig('OUT', h(1), { source: 'diario2' }),
  ];
  const a = assessPlayers(signals)['pl_x'];
  ok('la señal más nueva manda', a && a.status === 'OUT' && a.prob_miss > 0.5);
}

console.log(`\nobserver-reconcile: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
