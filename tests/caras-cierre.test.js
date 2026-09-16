// tests/caras-cierre.test.js — LAS DOS CARAS DEL CIERRE (16-sep-2026)
//
// El replay del 15-sep dejó nueve motores de nueve sin veredicto por falta de la cara contraria del cierre.
// Al ir a arreglarlo resultó que en esports, tenis de mesa y dardos el dato YA estaba guardado y solo no se
// leía. Este test fija la lectura, y sobre todo fija los tres casos en los que **no** hay que leerla:
// distinta casa, distinto momento, y una Q imposible.
'use strict';
const CL = require('../implied-engine/closes');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

const AHORA = Date.parse('2026-09-16T12:00:00.000Z');
const fila = (o) => Object.assign({ family: 'RONDAS_HANDICAP', map: 1, team: null, at: AHORA }, o);

// ── 1. EL CASO NORMAL: hándicap, las dos caras con la línea volteada ─────────────────────────────────────
// Es el caso que más picks tiene en la casa. La cara contraria de `home −3,5` es `away +3,5`, NO `away −3,5`:
// emparejar por el valor absoluto de la línea coge la apuesta equivocada, que es el fallo A01 otra vez.
const mercado = [
  fila({ side: 'home', line: -3.5, odds: 1.90, book: 'pinnacle' }),
  fila({ side: 'away', line: 3.5, odds: 1.95, book: 'pinnacle' }),
  fila({ side: 'away', line: -3.5, odds: 3.40, book: 'pinnacle' }),   // otra apuesta, no la contraria
  fila({ side: 'away', line: 3.5, odds: 2.10, book: 'bovada' }),      // otra casa
];
const r1 = CL.carasDelCierre(mercado[0], mercado);
t('encuentra la cara contraria del hándicap', !!r1.contraria);
t('y es la de la línea VOLTEADA, no la del mismo signo', r1.cuota_contraria === 1.95,
  `cogió ${r1.cuota_contraria}`);
t('y es de la MISMA casa', r1.contraria && r1.contraria.book === 'pinnacle');
t('la Q sale mayor que 1 (la casa cobra algo)', r1.Q > 1, `Q ${r1.Q}`);
// Q = 1/1,90 + 1/1,95 = 1,039137 → margen por lado = 100·(Q−1)/2 = 1,957 %
t('y el margen por lado es el que se espera', Math.abs(r1.margen_lado_pct - 1.957) < 0.01, `${r1.margen_lado_pct} %`);

// ── 2. TOTALES: over/under con la MISMA línea ────────────────────────────────────────────────────────────
const tot = [
  fila({ family: 'RONDAS', side: 'over', line: 26.5, odds: 1.86, book: 'cloudbet' }),
  fila({ family: 'RONDAS', side: 'under', line: 26.5, odds: 1.94, book: 'cloudbet' }),
  fila({ family: 'RONDAS', side: 'under', line: 25.5, odds: 1.60, book: 'cloudbet' }),
];
const r2 = CL.carasDelCierre(tot[0], tot);
t('en totales la contraria es el under de la MISMA línea', r2.cuota_contraria === 1.94, `cogió ${r2.cuota_contraria}`);

// ── 3. LOS TRES CASOS EN LOS QUE NO HAY QUE LEERLA ───────────────────────────────────────────────────────

// 3a. solo hay cara contraria en OTRA casa: no vale, porque el margen sería el de un mercado que no existió
const soloOtraCasa = [
  fila({ side: 'home', line: -3.5, odds: 1.90, book: 'pinnacle' }),
  fila({ side: 'away', line: 3.5, odds: 1.95, book: 'bovada' }),
];
const r3 = CL.carasDelCierre(soloOtraCasa[0], soloOtraCasa);
t('con la contraria en otra casa NO devuelve pareja', r3.contraria === null);
t('y dice por qué', !!r3.motivo && /casa/i.test(r3.motivo), r3.motivo);

// 3b. la contraria existe en la misma casa pero de otra pasada, horas después
const otroMomento = [
  fila({ side: 'home', line: -3.5, odds: 1.90, book: 'pinnacle' }),
  fila({ side: 'away', line: 3.5, odds: 1.95, book: 'pinnacle', at: AHORA + 6 * 3600e3 }),
];
const r4 = CL.carasDelCierre(otroMomento[0], otroMomento);
t('con la contraria de otro momento NO devuelve pareja', r4.contraria === null);
t('y dice cuánto se separaban', !!r4.motivo && /s \(umbral|momentos distintos/i.test(r4.motivo), r4.motivo);

// 3c. LA Q IMPOSIBLE. Ninguna casa cotiza un arbitraje contra sí misma: si sale Q ≤ 1, el emparejado está
// mal, y darlo por bueno inflaría el EV justo en la dirección que nos conviene. Se rechaza.
const imposible = [
  fila({ family: 'RONDAS', side: 'over', line: 26.5, odds: 2.10, book: 'cloudbet' }),
  fila({ family: 'RONDAS', side: 'under', line: 26.5, odds: 2.10, book: 'cloudbet' }),
];
const r5 = CL.carasDelCierre(imposible[0], imposible);
t('una Q ≤ 1 se rechaza en vez de aceptarse como ganga', r5.contraria === null, `Q ${r5.Q}`);
t('y queda marcada como sospechosa', r5.sospechosa === true);
t('con el motivo explícito', /Q = .* ≤ 1/.test(r5.motivo || ''), r5.motivo);

// ── 4. NO INVENTA NADA CUANDO NO HAY NADA ────────────────────────────────────────────────────────────────
t('sin fila propia devuelve motivo, no excepción', CL.carasDelCierre(null, mercado).contraria === null);
t('con el mercado vacío tampoco revienta', CL.carasDelCierre(mercado[0], []).contraria === null);

// ── 5. LA PAREJA ES LA QUE SIRVE PARA `lib/ev.js` ────────────────────────────────────────────────────────
// La prueba de que esto vale para algo: con la pareja puesta, el EV de un ticket se calcula; sin ella, no.
const EV = require('../lib/ev');
const conPareja = EV.evDeTicket({ entrada: 2.00, cierre: r1.cuota, cierreContraria: r1.cuota_contraria });
const sinPareja = EV.evDeTicket({ entrada: 2.00, cierre: r1.cuota, cierreContraria: null });
t('con las dos caras, el EV se puede calcular', conPareja.ok === true, `EV ${conPareja.ev_pct} %`);
t('sin la contraria, el EV NO se calcula y lo dice', sinPareja.ok === false && /contraria/.test(sinPareja.motivo));

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
