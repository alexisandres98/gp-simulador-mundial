// tests/style-engine.test.js — Perfil táctico por equipo desde event data (style-engine/profile). PURO.
// fitStyles (agregación ataque/defensa por situación/zona) y matchupFindings (códigos narrativos).
'use strict';
const path = require('path');
const SE = require(path.join(__dirname, '..', 'style-engine', 'profile'));
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const shot = (team, over) => ({ team, situation: 'RegularPlay', event: 'Miss', xg: 0.1, y: 34, inside_box: true, shot_type: 'RightFoot', ...over });

console.log('\n§ fitStyles');
{
  const matches = [
    { homeCode: 'AAA', awayCode: 'BBB', shots: [
      shot('home', { situation: 'FromCorner', xg: 0.3, shot_type: 'Header', event: 'Goal' }),
      shot('home', { xg: 0.2 }),
      shot('away', { situation: 'FastBreak', xg: 0.4 }),
      shot('away', { situation: 'Penalty', xg: 0.79 }),
    ] },
    { homeCode: 'BBB', awayCode: 'AAA', shots: [ shot('home', { xg: 0.15 }), shot('away', { situation: 'FromCorner', xg: 0.25 }) ] },
  ];
  const S = SE.fitStyles(matches);
  ok('AAA 2 partidos', S.AAA.attack.matches === 2);
  ok('AAA 3 remates de ataque', S.AAA.attack.shots_p90 === 1.5);
  // córners de AAA: 0.3 + 0.25 de 0.9 xG total (penal excluido de estilo pero no del xg total... el xg del
  // penal es de BBB) → AAA xg = 0.3+0.2+0.25 = 0.75; corner_xg = 0.55
  ok('AAA corner_share', Math.abs(S.AAA.attack.corner_share_xg - 0.55 / 0.75) < 0.01);
  ok('AAA header_share', Math.abs(S.AAA.attack.header_share - 1 / 3) < 0.01);
  ok('BBB defensa recibe los remates de AAA', S.BBB.defense.shots_p90 === 1.5);
  ok('penal contado aparte (no estilo)', S.BBB.attack.pens === 1);
  ok('fastbreak share de BBB', S.BBB.attack.fastbreak_share_xg != null && S.BBB.attack.fastbreak_share_xg > 0.5);
  ok('gol contado', S.AAA.attack.goals_p90 === 0.5);
  // props layer
  const props = [{ home: { code: 'AAA', corners: 8, yellows: 2, reds: 0, fouls: 10, possession: 60 }, away: { code: 'BBB', corners: 2, yellows: 3, reds: 1, fouls: 15, possession: 40 } }];
  const S2 = SE.fitStyles(matches, props);
  ok('props córners a favor', S2.AAA.props.corners_for_p90 === 8);
  ok('props tarjetas', S2.BBB.props.cards_p90 === 4);
}

console.log('\n§ matchupFindings');
{
  const mk = (attack, defense) => ({ attack: { matches: 5, ...attack }, defense: { matches: 5, ...defense } });
  const base = { corner_share_xg: 0.05, sp_share_xg: 0.1, header_share: 0.1, fastbreak_share_xg: 0.05, xg_p90: 1.0, zones: { z1: 0.33, center: 0.34, z3: 0.33 } };
  // home ataca fuerte por córners y el rival concede por córners
  const H = mk({ ...base, corner_share_xg: 0.25 }, { ...base });
  const A = mk({ ...base }, { ...base, corner_share_xg: 0.22 });
  const f = SE.matchupFindings(H, A);
  ok('CORNER_EDGE detectado para home', f.some(x => x.code === 'CORNER_EDGE' && x.side === 'home'));
  ok('sin hallazgos espurios para away', !f.some(x => x.side === 'away'));
  // overlap de zona
  const H2 = mk({ ...base, zones: { z1: 0.45, center: 0.35, z3: 0.20 } }, { ...base });
  const A2 = mk({ ...base }, { ...base, zones: { z1: 0.44, center: 0.36, z3: 0.20 } });
  ok('ZONE_OVERLAP', SE.matchupFindings(H2, A2).some(x => x.code === 'ZONE_OVERLAP' && x.zone === 'z1'));
  // muestra corta no narra
  const H3 = mk({ ...base, corner_share_xg: 0.9 }, base); H3.attack.matches = 2;
  ok('muestra <3 partidos no narra', SE.matchupFindings(H3, A).length === 0);
  ok('perfiles null no rompen', Array.isArray(SE.matchupFindings(null, null)));
}

console.log('\n§ smoke con data real del torneo (si existe)');
try {
  const real = require(path.join(__dirname, '..', 'data', 'fotmob-events.json'));
  const props = require(path.join(__dirname, '..', 'data', 'props-history.json'));
  const S = SE.fitStyles(real.matches, props.matches);
  const teams = Object.keys(S);
  ok('perfiles de equipos reales', teams.length >= 8);
  const withXg = teams.filter(c => S[c].attack.xg_p90 != null);
  ok('xg_p90 poblado', withXg.length === teams.length);
  const fra = S.FRA;
  if (fra) ok('FRA con props layer', !!fra.props && fra.props.corners_for_p90 > 0);
  console.log('  · equipos:', teams.length, '| ejemplo FRA attack:', JSON.stringify(fra && fra.attack).slice(0, 180));
} catch (e) { console.log('  (sin data real todavía: ' + e.message.slice(0, 60) + ')'); }

console.log(`\nstyle-engine: ${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
