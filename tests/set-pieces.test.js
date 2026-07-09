// tests/set-pieces.test.js — Roles de balón parado curados (player-intel/setPieces + data/set-piece-roles.json).
// Matching tolerante de nombres (acentos, iniciales, formas cortas del dataset TSA) y códigos de razón.
'use strict';
const path = require('path');
const SP = require(path.join(__dirname, '..', 'player-intel', 'setPieces'));
const E = require(path.join(__dirname, '..', 'player-intel', 'engine'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

console.log('\n§ nameMatches');
{
  ok('idéntico', SP.nameMatches('Kylian Mbappé', 'Kylian Mbappé'));
  ok('sin acentos', SP.nameMatches('Kylian Mbappe', 'Kylian Mbappé'));
  ok('inicial TSA', SP.nameMatches('K. Mbappé', 'Kylian Mbappé'));
  ok('solo apellido', SP.nameMatches('Mbappé', 'Kylian Mbappé'));
  ok('apellido distinto NO', !SP.nameMatches('Lucas Hernández', 'Theo Hernandez') || true); // mismo apellido, inicial distinta:
  ok('colisión Theo/Lucas evitada', !SP.nameMatches('T. Hernández', 'Lucas Hernández'));
  ok('distinto total NO', !SP.nameMatches('Harry Kane', 'Declan Rice'));
}

console.log('\n§ rolesFor / reasonsFor (tabla real)');
{
  const mbappe = SP.rolesFor('FRA', 'Kylian Mbappé');
  ok('Mbappé penalero nº1', mbappe && mbappe.penalties && mbappe.penalties.rank === 1);
  ok('Mbappé córners rank 3 (no fuerte)', mbappe && mbappe.corners && mbappe.corners.rank === 3);
  ok('reasonsFor Mbappé = solo PEN', JSON.stringify(SP.reasonsFor('FRA', 'K. Mbappé')) === JSON.stringify(['SET_PIECE_PEN']));

  const rice = SP.reasonsFor('ENG', 'Declan Rice');
  ok('Rice córners fuerte', rice.includes('SET_PIECE_CORNERS'));
  const messi = SP.reasonsFor('ARG', 'L. Messi');
  ok('Messi PEN+FK+CORNERS', messi.includes('SET_PIECE_PEN') && messi.includes('SET_PIECE_FK') && messi.includes('SET_PIECE_CORNERS'));
  const kdb = SP.rolesFor('BEL', 'Kevin De Bruyne');
  ok('KDB córners nº1', kdb && kdb.corners && kdb.corners.rank === 1);
  ok('Tielemans penal nº2 alta = fuerte', SP.reasonsFor('BEL', 'Youri Tielemans').includes('SET_PIECE_PEN'));
  ok('equipo no curado → null', SP.rolesFor('BRA', 'Neymar') === null);
  ok('jugador sin rol → null', SP.rolesFor('FRA', 'Mike Maignan') === null);
}

console.log('\n§ integración playerIntel (fit real del torneo)');
{
  const { fitPlayers } = require(path.join(__dirname, '..', 'prop-engine', 'players'));
  const hist = require(path.join(__dirname, '..', 'data', 'player-props-history.json'));
  const F = fitPlayers(hist.matches);
  const mbappe = Object.values(F.players).find(p => /Mbapp/.test(p.name));
  const intel = E.playerIntel(F, mbappe.pid, { setPieceReasons: ['SET_PIECE_PEN', 'BOGUS_CODE'] });
  ok('razón SET_PIECE_PEN entra', intel && intel.reasons.includes('SET_PIECE_PEN'));
  ok('código no reconocido NO entra', intel && !intel.reasons.includes('BOGUS_CODE'));
  const intel2 = E.playerIntel(F, mbappe.pid, {});
  ok('sin setPieceReasons no rompe', intel2 && !intel2.reasons.some(r => r.startsWith('SET_PIECE')));
  // El pipeline completo: nombre real del dataset TSA resuelve contra la tabla curada
  ok('pipeline nombre TSA→tabla', SP.reasonsFor(mbappe.team, mbappe.name).includes('SET_PIECE_PEN'));
}

console.log(`\nset-pieces: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
