// tests/pick-narrative.test.js — Narrativa multi-factor (pick-engine/narrative). PURO.
// Composición por peso, tope de 4 factores, caveat al final, bilingüe, caja negra (sin mención de método).
'use strict';
const path = require('path');
const N = require(path.join(__dirname, '..', 'pick-engine', 'narrative'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

console.log('\n§ compose');
{
  const f = [
    { code: 'PLAYER_MINUTES', w: 2.5, minutes: 78 },
    { code: 'PLAYER_FORM', w: 2.2, elite: false },
    { code: 'PLAYER_SET_PIECE', w: 2, roles: ['los penales'], rolesEn: ['penalties'] },
    { code: 'RIVAL_DEFENSE_WEAK_AIR', w: 1.6, rival_es: 'Marruecos', rival_en: 'Morocco' },
  ];
  const r = N.compose(f);
  ok('bilingüe', r && r.es && r.en && r.es !== r.en);
  ok('ES arranca con minutos (mayor peso)', r.es.startsWith('78 minutos'));
  ok('incluye balón parado', r.es.includes('penales') && r.en.includes('penalties'));
  ok('incluye rival por idioma', r.es.includes('Marruecos') && r.en.includes('Morocco'));
  ok('termina en punto', r.es.endsWith('.') && r.en.endsWith('.'));
  ok('caja negra: sin métodos', !/monte carlo|elo|modelo estadístico|simulaci/i.test(r.es + r.en));
  ok('sin rayitas', !/[—–]/.test(r.es + r.en));
}
{
  const many = [
    { code: 'GOALS_VOLUME_BOTH', w: 3, h: 2.1, a: 1.8 },
    { code: 'GOALS_ATTACK_VS_LEAKY', w: 2.5, team_es: 'Francia', team_en: 'France', xg: 2.1 },
    { code: 'COUNTER_GAME', w: 2, team_es: 'Suiza', team_en: 'Switzerland' },
    { code: 'PRICE_ABOVE_FAIR', w: 1.5 },
    { code: 'PHASE_KO_CARDS', w: 1.2 },
    { code: 'PARITY', w: 1.1 },
  ];
  const r = N.compose(many);
  ok('tope de 4 factores', (r.es.match(/;/g) || []).length <= 3);
}
{
  const withCaveat = [
    { code: 'PLAYER_MINUTES', w: 2.5, minutes: 80 },
    { code: 'AVAIL_CAVEAT', w: 0, name: 'Ousmane Dembélé' },
  ];
  const r = N.compose(withCaveat);
  ok('caveat en frase aparte al final', /\. Ojo: Ousmane Dembélé/.test(r.es) && /\. Watch: Ousmane Dembélé/.test(r.en));
}
{
  ok('vacío → null', N.compose([]) === null);
  ok('solo caveat → null', N.compose([{ code: 'AVAIL_CAVEAT', w: 0, name: 'X' }]) === null);
  ok('código desconocido se ignora', N.compose([{ code: 'NOPE', w: 9 }]) === null);
}

console.log(`\npick-narrative: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
