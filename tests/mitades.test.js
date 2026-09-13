// tests/mitades.test.js — el modelo de mitades y su liquidación.
// Lo que se prueba aquí no es que el código corra: es que NO INVIERTA UN LADO. Un hándicap de mitad
// liquidado al revés paga como una pick ganadora cada vez que pierde, y desde fuera parece un modelo malo
// en vez de un signo cambiado. Por eso cada caso lleva el marcador escrito a mano y el resultado esperado.
'use strict';
const assert = require('assert');
const mi = require('../goal-engine/mitades');
const st = require('../goal-engine/settlement');

let n = 0;
const t = (nombre, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + nombre + ': ' + e.message); process.exitCode = 1; } };
const casi = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);

// ── el modelo ───────────────────────────────────────────────────────────────────────────────────────────
const rows = mi.mercados(1.49, 1.20);
const P = (id) => { const r = rows.find((x) => x.market_id === id); return r ? r.probability : null; };

t('las tres vías del 1X2 de cada mitad suman 1', () => {
  for (const pre of ['H1', 'H2']) {
    casi(P(`${pre}_1X2_HOME`) + P(`${pre}_1X2_DRAW`) + P(`${pre}_1X2_AWAY`), 1, 1e-5, pre + ' 1X2');
  }
});
t('la tabla descanso/final suma 1 y tiene las nueve celdas', () => {
  const c = rows.filter((r) => r.market_family === 'htft');
  assert.strictEqual(c.length, 9, 'celdas');
  casi(c.reduce((a, b) => a + b.probability, 0), 1, 1e-4, 'htft');
});
t('las dos caras de un hándicap asiático de mitad suman 1', () => {
  for (const [a, b] of [['H1_AH_HOME_M0_5', 'H1_AH_AWAY_P0_5'], ['H1_AH_HOME_P0', 'H1_AH_AWAY_P0'],
    ['H2_AH_HOME_M1_5', 'H2_AH_AWAY_P1_5'], ['H2_AH_HOME_P1', 'H2_AH_AWAY_M1']]) {
    casi(P(a) + P(b), 1, 1e-5, a + ' + ' + b);
  }
});
t('el empate no válido de mitad es condicional (suma 1, no descuenta el empate dos veces)', () => {
  casi(P('H1_DRAW_NO_BET_HOME') + P('H1_DRAW_NO_BET_AWAY'), 1, 1e-6, 'dnb 1T');
});
t('las tres dobles oportunidades de mitad suman 2', () => {
  casi(P('H1_DOUBLE_CHANCE_HOME_DRAW') + P('H1_DOUBLE_CHANCE_HOME_AWAY') + P('H1_DOUBLE_CHANCE_DRAW_AWAY'), 2, 1e-5, 'dc 1T');
});
t('el primer tiempo tiene MENOS goles que el segundo, como se midió', () => {
  assert.ok(P('H1_TOTAL_GOALS_OVER_0_5') < P('H2_TOTAL_GOALS_OVER_0_5'), '1T debe ser más cerrado que el 2T');
});
t('la cuota medida es la que está en el código y viaja con su muestra', () => {
  assert.strictEqual(mi.CUOTA_1T, 0.446);
  assert.strictEqual(mi.RHO_MITAD, 0);
  assert.ok(mi.MEDICION.partidos > 30000 && mi.MEDICION.divisiones === 18);
});
t('el listón de una familia incluye su propio error de calibración', () => {
  assert.ok(mi.listonDe('h1_total') > mi.listonDe('h1_btts'), 'la familia peor calibrada pide MÁS ventaja');
  assert.strictEqual(mi.listonDe('h1_btts', 0.03), +(0.03 + 0.008).toFixed(4));
  assert.strictEqual(mi.listonDe('familia_que_no_existe', 0.03), 0.03 + mi.SUELO_METODO);
});

// ── la liquidación ──────────────────────────────────────────────────────────────────────────────────────
// Partido inventado con marcador conocido: 1-0 al descanso, 2-3 al final. Segunda mitad: 1-3.
const SC = { homeGoals: 2, awayGoals: 3, h1Home: 1, h1Away: 0 };

t('totales de cada mitad contra el marcador real', () => {
  assert.strictEqual(st.settle('H1_TOTAL_GOALS_OVER_0_5', SC), 'won');    // 1T tuvo 1 gol
  assert.strictEqual(st.settle('H1_TOTAL_GOALS_OVER_1_5', SC), 'lost');
  assert.strictEqual(st.settle('H1_TOTAL_GOALS_UNDER_1_5', SC), 'won');
  assert.strictEqual(st.settle('H2_TOTAL_GOALS_OVER_2_5', SC), 'won');    // 2T tuvo 4 goles
  assert.strictEqual(st.settle('H2_TOTAL_GOALS_UNDER_3_5', SC), 'lost');
});
t('el 1X2 de cada mitad se resuelve con SU mitad, no con el final', () => {
  assert.strictEqual(st.settle('H1_1X2_HOME', SC), 'won');    // 1-0 al descanso
  assert.strictEqual(st.settle('H1_1X2_AWAY', SC), 'lost');
  assert.strictEqual(st.settle('H2_1X2_AWAY', SC), 'won');    // 1-3 en la segunda
  assert.strictEqual(st.settle('H2_1X2_HOME', SC), 'lost');
});
t('el hándicap de mitad no invierte el lado', () => {
  assert.strictEqual(st.settle('H1_AH_HOME_M0_5', SC), 'won');   // local −0,5 con 1-0: gana
  assert.strictEqual(st.settle('H1_AH_AWAY_P0_5', SC), 'lost');
  assert.strictEqual(st.settle('H2_AH_AWAY_M1_5', SC), 'won');   // visita −1,5 con 1-3: gana por 2
  assert.strictEqual(st.settle('H2_AH_HOME_P1_5', SC), 'lost');
});
t('la línea entera de mitad devuelve cuando iguala', () => {
  const empate1t = { homeGoals: 2, awayGoals: 2, h1Home: 1, h1Away: 1 };
  assert.strictEqual(st.settle('H1_AH_HOME_P0', empate1t), 'push');
  assert.strictEqual(st.settle('H1_DRAW_NO_BET_HOME', empate1t), 'push');
});
t('totales de equipo y ambos marcan, por mitad', () => {
  assert.strictEqual(st.settle('H1_HOME_TEAM_TOTAL_OVER_0_5', SC), 'won');
  assert.strictEqual(st.settle('H1_AWAY_TEAM_TOTAL_OVER_0_5', SC), 'lost');
  assert.strictEqual(st.settle('H1_BTTS_YES', SC), 'lost');     // en el 1T solo marcó el local
  assert.strictEqual(st.settle('H2_BTTS_YES', SC), 'won');      // 1-3: marcaron los dos
});
t('descanso/final lee las dos fotos', () => {
  assert.strictEqual(st.settle('HTFT_HOME_AWAY', SC), 'won');   // ganaba el local, ganó el visitante
  assert.strictEqual(st.settle('HTFT_HOME_HOME', SC), 'lost');
  assert.strictEqual(st.settle('HTFT_DRAW_AWAY', SC), 'lost');
});
t('SIN marcador al descanso no se liquida: se anula', () => {
  const soloFinal = { homeGoals: 2, awayGoals: 3 };
  for (const id of ['H1_1X2_HOME', 'H2_TOTAL_GOALS_OVER_1_5', 'HTFT_HOME_AWAY', 'H1_AH_HOME_M0_5']) {
    assert.strictEqual(st.settle(id, soloFinal), 'void', id + ' debe anularse sin descanso');
  }
});
t('un descanso incoherente con el final se anula en vez de mentir', () => {
  const imposible = { homeGoals: 1, awayGoals: 1, h1Home: 3, h1Away: 0 };
  assert.strictEqual(st.settle('H1_1X2_HOME', imposible), 'void');
});
t('las familias del partido completo siguen liquidando igual que antes', () => {
  assert.strictEqual(st.settle('TOTAL_GOALS_OVER_2_5', SC), 'won');
  assert.strictEqual(st.settle('BTTS_YES', SC), 'won');
  assert.strictEqual(st.settle('AH_HOME_M0_5', SC), 'lost');
  assert.strictEqual(st.settle('DRAW_NO_BET_AWAY', SC), 'won');
  assert.strictEqual(st.settle('AWAY_CLEAN_SHEET', SC), 'lost');
  assert.strictEqual(st.settle('EXACT_SCORE_2_3', SC), 'won');
});
// ── EL GIRO ─────────────────────────────────────────────────────────────────────────────────────────────
// La prueba que de verdad importa: cuando el local de la casa es NUESTRO visitante, el precio tiene que
// seguir pegado al MISMO equipo físico. Se comprueba con el caso documentado del hándicap del partido, que
// en su día se verificó contra la casa: con handicap=−0,5 el local paga 2,70 y el visitante 1,32.
t('girar un hándicap reetiqueta el lado y NO mueve la línea', () => {
  // fila tal y como la emite el lector: la línea ya va referida a la selección
  const suLocal = { fam: 'h1_ah', side: 'home', line: -0.5, odds: 2.70 };
  const suVisita = { fam: 'h1_ah', side: 'away', line: 0.5, odds: 1.32 };
  // si su local es nuestro visitante, el equipo que paga 2,70 con −0,5 es NUESTRO visitante
  const a = mi.gira(suLocal, true), b = mi.gira(suVisita, true);
  assert.strictEqual(a.side, 'away'); assert.strictEqual(a.line, -0.5); assert.strictEqual(a.odds, 2.70);
  assert.strictEqual(b.side, 'home'); assert.strictEqual(b.line, 0.5); assert.strictEqual(b.odds, 1.32);
  // y las dos caras que salen siguen siendo espejo la una de la otra
  assert.strictEqual(a.line, -b.line);
});
t('girar dos veces devuelve la fila original en todas las familias', () => {
  const casos = [
    { fam: 'h1_1x2', side: 'home', line: 0 }, { fam: 'h2_1x2', side: 'draw', line: 0 },
    { fam: 'h1_ah', side: 'away', line: 1.25 }, { fam: 'h2_ah', side: 'home', line: -1.75 },
    { fam: 'h1_total', side: 'over', line: 1.25 }, { fam: 'h1_btts', side: 'yes', line: 0 },
    { fam: 'h1_double_chance', side: 'home_draw', line: 0 }, { fam: 'h1_double_chance', side: 'home_away', line: 0 },
    { fam: 'h1_draw_no_bet', side: 'away', line: 0 }, { fam: 'htft', side: 'home_away', line: 0 },
    { fam: 'exact_score', side: '2:1', line: 0 }, { fam: 'clean_sheet', side: 'yes', team: 'home', line: 0 },
    { fam: 'win_to_nil', side: 'yes', team: 'away', line: 0 }, { fam: 'h1_team_total', side: 'over', line: 0.5, team: 'home' },
  ];
  for (const c of casos) {
    assert.deepStrictEqual(mi.gira(mi.gira(c, true), true), c, 'ida y vuelta de ' + c.fam + '/' + c.side);
    assert.deepStrictEqual(mi.gira(c, false), c, 'sin giro no se toca: ' + c.fam);
  }
});
t('girar cambia de equipo lo que nombra a un equipo, y nada más', () => {
  assert.strictEqual(mi.gira({ fam: 'h1_1x2', side: 'home' }, true).side, 'away');
  assert.strictEqual(mi.gira({ fam: 'h1_1x2', side: 'draw' }, true).side, 'draw');
  assert.strictEqual(mi.gira({ fam: 'h1_total', side: 'over', line: 1.5 }, true).side, 'over');
  assert.strictEqual(mi.gira({ fam: 'h1_btts', side: 'yes' }, true).side, 'yes');
  assert.strictEqual(mi.gira({ fam: 'htft', side: 'home_draw' }, true).side, 'away_draw');
  assert.strictEqual(mi.gira({ fam: 'exact_score', side: '3:0' }, true).side, '0:3');
  assert.strictEqual(mi.gira({ fam: 'clean_sheet', side: 'yes', team: 'away' }, true).team, 'home');
});
t('idDe reconstruye TODOS los ids que emite el modelo', () => {
  let mal = 0;
  for (const r of rows) if (mi.idDe(r.market_family, { side: r.side, line: r.line, team: r.team_scope }) !== r.market_id) mal++;
  assert.strictEqual(mal, 0, mal + ' ids no se reconstruyen');
});
t('el liquidador reconoce TODOS los ids que emite el modelo', () => {
  const malos = rows.filter((r) => !st.marketMeta(r.market_id)).map((r) => r.market_id);
  assert.strictEqual(malos.length, 0, 'sin liquidar: ' + malos.slice(0, 5).join(', '));
});
t('las líneas enteras y de cuarto salen con parte decimal en el id', () => {
  assert.ok(rows.some((r) => r.market_id === 'H1_TOTAL_GOALS_OVER_1_0'), 'falta la entera 1_0');
  assert.ok(rows.some((r) => r.market_id === 'H1_TOTAL_GOALS_OVER_1_25'), 'falta el cuarto 1_25');
  assert.ok(st.marketMeta('H1_TOTAL_GOALS_OVER_1_0'), 'la entera debe liquidarse');
});
t('las dos caras de un total suman 1 en media, entera y cuarto', () => {
  for (const l of ['0_5', '1_0', '1_25']) {
    casi(P('H1_TOTAL_GOALS_OVER_' + l) + P('H1_TOTAL_GOALS_UNDER_' + l), 1, 1e-6, 'total ' + l);
  }
});
t('la línea entera es condicional: no la infla la devolución', () => {
  // con un total entero, over + under conditional = 1 aunque haya masa en el empate exacto
  const sobre = P('H1_TOTAL_GOALS_OVER_1_0'), bajo = P('H1_TOTAL_GOALS_UNDER_1_0');
  assert.ok(sobre > 0 && bajo > 0 && Math.abs(sobre + bajo - 1) < 1e-6);
  // y tiene que caer ENTRE las dos medias que la rodean
  assert.ok(sobre < P('H1_TOTAL_GOALS_OVER_0_5') && sobre > P('H1_TOTAL_GOALS_OVER_1_5'), 'la entera debe quedar entre sus dos medias');
});

t('un market_id inventado no se liquida como ganado', () => {
  assert.strictEqual(st.settle('H1_MERCADO_QUE_NO_EXISTE', SC), 'unknown');
  assert.strictEqual(st.settle('H3_1X2_HOME', SC), 'unknown');
});

console.log(`mitades: ${n} pruebas OK`);
