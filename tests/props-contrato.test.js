// tests/props-contrato.test.js — EL CONTRATO DE UNDERDOG Y EL DEDUPE DE TESIS (T2.9 / A18, 15-sep-2026)
//
// Lo que fija este test es el hallazgo, no el número: **la pierna suelta al `american_price` no existe**.
// Underdog es un pick'em con entrada mínima de dos piernas y multiplicador de boleto, así que el listón de
// equilibrio es el del TICKET (`p* = (1/M)^(1/N)`), no `1/price_dec`. Durante casi un mes la sombra de props
// midió su ventaja contra un precio que nadie puede comprar.
//
// Y fija la otra mitad, que es la que evita que el número vuelva a mentir en la otra dirección: el dedupe.
// La clave era `día|jugador|stat|lado` y fundía dos series del mismo día en una sola tesis. Ahora es
// `serie canónica|jugador|stat|lado|política`, con la serie normalizada por `lib/contrato.js` para que el
// orden en que el proveedor liste a los dos equipos no cambie la identidad de la apuesta.
'use strict';
const P = require('../esports-engine/props');

let fallos = 0;
const cerca = (nombre, real, esperado, tol = 1e-4) => {
  const ok = Number.isFinite(real) && Math.abs(real - esperado) <= tol;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};
const igual = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};

// ══ 1. EL LISTÓN DEL BOLETO NO ES EL DE LA PIERNA ══════════════════════════════════════════════════════
console.log('\n── 1. el listón del boleto ──');
const barPierna = 1 / (1 + 100 / 112);                       // −112 → 1,8929 → 52,83 %
cerca('la pierna teórica a −112 pide 52,83 %', barPierna, 0.5283, 5e-4);
cerca('2 piernas a 3× piden 57,74 % por pierna', P.listonTicket(2, 'A').liston, 0.5774, 5e-4);
cerca('2 piernas a 3,5× piden 53,45 % por pierna', P.listonTicket(2, 'B').liston, 0.5345, 5e-4);
cerca('3 piernas a 6× piden 55,03 %', P.listonTicket(3, 'A').liston, 0.5503, 5e-4);
cerca('4 piernas a 10× piden 56,23 %', P.listonTicket(4, 'A').liston, 0.5623, 5e-4);
cerca('5 piernas a 20× piden 54,93 %', P.listonTicket(5, 'A').liston, 0.5493, 5e-4);
igual('el listón del boleto más barato sigue por encima del de la pierna',
  P.listonTicket(2, 'B').liston > barPierna, true);
igual('una combinación que la tabla no publica devuelve null y NO se interpola', P.listonTicket(7, 'A'), null);
igual('el contrato se declara sin verificar', P.CONTRATO_UNDERDOG.verificado, false);
igual('y dice por qué', typeof P.CONTRATO_UNDERDOG.por_que_no === 'string' && /403|426/.test(P.CONTRATO_UNDERDOG.por_que_no), true);

// ══ 2. EL CONTRAEJEMPLO DE LA AUDITORÍA ════════════════════════════════════════════════════════════════
// §7.2: «entrada 2 piernas a 3× con p = 0,539 → ROI −12,844 %». Se reproduce exacto.
console.log('\n── 2. el contraejemplo de la auditoría ──');
const e = P.evTicket([0.539, 0.539], { n: 2, tabla: 'A' });
cerca('2 piernas a 3× con p = 0,539 dan −12,844 %', 100 * e.ev, -12.844, 0.01);
igual('y el supuesto de independencia se declara', /independientes/.test(e.supuesto), true);

// El signo depende de la tabla, que es EL hueco del expediente.
console.log('\n── 2 bis. el signo depende del multiplicador que no hemos podido verificar ──');
const hit = 0.5394;                                          // acierto observado de props_cs2_v2 (178/330)
const evA = P.evTicket([hit, hit], { n: 2, tabla: 'A' });
const evB = P.evTicket([hit, hit], { n: 2, tabla: 'B' });
cerca('con la tabla A el boleto de dos piernas pierde', 100 * evA.ev, -12.71, 0.02);
cerca('con la tabla B gana, y por poco', 100 * evB.ev, 1.83, 0.02);
igual('las dos tablas dan signos OPUESTOS con la misma muestra', evA.ev < 0 && evB.ev > 0, true);

// Y con todas las piernas de un boleto largo el EV empeora, que es lo contrario de lo que sugiere el
// multiplicador grande: multiplicar por veinte no compensa elevar a la quinta.
for (const n of [2, 3, 4, 5]) {
  const x = P.evTicket(new Array(n).fill(hit), { n, tabla: 'A' });
  igual(`con la tabla A el boleto de ${n} piernas tiene esperanza negativa`, x.ev < 0, true);
}

// ══ 3. EL INTERRUPTOR NO CAMBIA NADA POR SU CUENTA ═════════════════════════════════════════════════════
console.log('\n── 3. el interruptor ──');
igual('GP_PROPS_EV_TICKET nace apagado: la regla congelada sigue mandando',
  P.EV_TICKET_ON, String(process.env.GP_PROPS_EV_TICKET || '') === '1');
igual('la tabla por defecto es la conservadora', P.CONTRATO_UNDERDOG.tabla_por_defecto, 'A');

// ══ 4. EL DEDUPE POR SERIE CANÓNICA ════════════════════════════════════════════════════════════════════
console.log('\n── 4. dedupe serie canónica | jugador | stat | lado | política ──');
const fila = (titulo, side, line, slug = 'rez', at = '2026-09-20T10:00:00Z', id = 'm1') => ({
  match: { title: titulo, start_at: at, id }, slug, stat: 'kills_on_maps_1_2',
  best: { side }, book: 'underdog', line,
});
const k = (...a) => P.claveTesis(fila(...a));
igual('el orden de los equipos no cambia la identidad de la tesis',
  k('MOUZ vs Natus Vincere', 'over', 27.5), k('Natus Vincere vs MOUZ', 'over', 27.5));
igual('tres líneas del mismo over son UNA tesis, no tres',
  k('MOUZ vs NAVI', 'over', 27.5), k('MOUZ vs NAVI', 'over', 34.5));
igual('over y under no son la misma tesis',
  k('MOUZ vs NAVI', 'over', 27.5) !== k('MOUZ vs NAVI', 'under', 27.5), true);
igual('dos series distintas del mismo jugador son dos tesis',
  k('MOUZ vs NAVI', 'over', 27.5) !== k('MOUZ vs Vitality', 'over', 27.5), true);
igual('dos jugadores distintos son dos tesis',
  k('MOUZ vs NAVI', 'over', 27.5, 'rez') !== k('MOUZ vs NAVI', 'over', 27.5, 'torzsi'), true);
igual('la política va en la clave', /mapas_1_2\|props_cs2_v/.test(k('MOUZ vs NAVI', 'over', 27.5)), true);
igual('sin los dos nombres del cruce se cae al id del libro y se marca',
  /^sin_participantes\|/.test(P.claveTesis(fila('partido raro', 'over', 27.5))), true);

// LA TRAMPA QUE ESTO EVITA. Antes la clave era `día|jugador|stat|lado`: dos series del mismo jugador el
// MISMO día se fundían en una sola tesis y la segunda desaparecía sin contarse.
const mismoDia1 = k('MOUZ vs NAVI', 'over', 27.5, 'rez', '2026-09-20T10:00:00Z', 'm1');
const mismoDia2 = k('MOUZ vs Vitality', 'over', 27.5, 'rez', '2026-09-20T18:00:00Z', 'm2');
igual('dos series del mismo jugador el mismo día ya no se funden', mismoDia1 !== mismoDia2, true);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
