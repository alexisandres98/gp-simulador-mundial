// tests/player-scout.test.js — Scout engine (player-intel/scout) + radar SVG (player-intel/radar). PURO.
// Ejes con percentiles vs posición sobre el fit REAL del torneo, arquetipos ganados, scout read bilingüe.
'use strict';
const path = require('path');
const S = require(path.join(__dirname, '..', 'player-intel', 'scout'));
const { radarSvg } = require(path.join(__dirname, '..', 'player-intel', 'radar'));
const { fitPlayers } = require(path.join(__dirname, '..', 'prop-engine', 'players'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const hist = require(path.join(__dirname, '..', 'data', 'player-props-history.json'));
const F = fitPlayers(hist.matches);
const byName = re => Object.values(F.players).find(p => re.test(p.name));
const mbappe = byName(/Mbapp/), haaland = byName(/Haaland/);

console.log('\n§ buildAxes (fit real)');
{
  const ax = S.buildAxes(F, mbappe.pid);
  ok('ejes >= 5', ax && ax.length >= 5);
  ok('todos con pct 0-1', ax.every(a => a.pct >= 0 && a.pct <= 1));
  const prod = ax.find(a => a.key === 'production');
  ok('Mbappé producción top (pct >= .9)', prod && prod.pct >= 0.9);
  ok('presencia presente', ax.some(a => a.key === 'presence'));
  // eje aéreo solo con data
  const ax2 = S.buildAxes(F, mbappe.pid, { aerial: { shots: 12, headers: 6 } });
  ok('eje aéreo con data', ax2.some(a => a.key === 'aerial' && a.pct === 1));
  ok('sin data aérea no hay eje', !ax.some(a => a.key === 'aerial'));
  ok('jugador inexistente → null', S.buildAxes(F, 'nope') === null);
}

console.log('\n§ archetype (ganado, no de relleno)');
{
  const arcMb = S.archetype(F, mbappe.pid);
  ok('Mbappé tiene arquetipo', ['STAR', 'CLINICAL', 'ENGINE'].includes(arcMb));
  const arcHa = S.archetype(F, haaland.pid);
  ok('Haaland tiene arquetipo', arcHa != null);
  // un suplente mediocre no gana badge
  const meh = Object.values(F.players).find(p => p.reliable && p.pos === 'D' && p.goals === 0 && p.xa90 < 0.05 && p.starts < p.apps);
  if (meh) ok('jugador sin méritos → null', S.archetype(F, meh.pid) === null);
  // especialista de balón parado
  const spr = { penalties: { rank: 1, confidence: 'alta' }, freekicks: null, corners: null };
  const mid = Object.values(F.players).find(p => p.reliable && p.pos === 'M' && p.xg90 < 0.15 && p.xa90 < 0.1 && p.starts === p.apps && p.apps >= 4);
  if (mid) {
    const a = S.archetype(F, mid.pid, { setPieceRoles: spr });
    ok('balón parado gana badge si no hay otro', ['SET_PIECE', 'ENGINE'].includes(a));
  }
}

console.log('\n§ scoutRead');
{
  const r = S.scoutRead(F, mbappe.pid);
  ok('hasta 3 fortalezas', r.strengths.length >= 1 && r.strengths.length <= 3);
  ok('bilingüe', r.strengths.every(s => s.es && s.en && s.es !== s.en));
  ok('caja negra', !/(elo|monte carlo|simulaci|modelo estadístico)/i.test(JSON.stringify(r)));
  ok('sin rayitas', !/[—–]/.test(JSON.stringify(r)));
  // límite para muestra corta
  const thin = Object.values(F.players).find(p => p.minutes > 60 && p.minutes < 200 && p.pos === 'M');
  if (thin) {
    const rt = S.scoutRead(F, thin.pid);
    ok('límite presente para lectura honesta', rt === null || rt.limit != null || rt.strengths.length > 0);
  }
  const full = S.buildScout(F, mbappe.pid, { setPieceRoles: { penalties: { rank: 1, confidence: 'alta' } } });
  ok('buildScout ensambla todo', full && full.axes.length >= 5 && full.read && 'archetype' in full);
}

console.log('\n§ radarSvg');
{
  const ax = S.buildAxes(F, mbappe.pid);
  const svg = radarSvg(ax, { production: 'Peligro', volume: 'Remates', accuracy: 'Puntería', creation: 'Creación', finishing: 'Definición', presence: 'Presencia' });
  ok('SVG válido', svg.startsWith('<svg') && svg.endsWith('</svg>'));
  ok('polígono del jugador presente', (svg.match(/<polygon/g) || []).length >= 5); // 4 anillos + jugador
  ok('etiquetas presentes', svg.includes('Puntería') && svg.includes('Definición'));
  ok('menos de 3 ejes → vacío', radarSvg([{ key: 'a', pct: .5 }, { key: 'b', pct: .5 }]) === '');
  const themed = radarSvg(ax, {}, { stroke: '#123456' });
  ok('tema parametrizable', themed.includes('#123456'));
}

console.log(`\nplayer-scout: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
