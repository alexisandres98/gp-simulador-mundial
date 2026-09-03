#!/usr/bin/env node
'use strict';
// Smoke de la INTERFAZ (3-sep): los bloques nuevos de tenis ("Qué mueve la probabilidad") y de Valorant
// (anclaje por mapa junto al veto + P(ronda) resuelta en rondas) se prueban SIN navegador y SIN arrancar
// server.js. `public/premium.js` es una IIFE cerrada que no exporta nada, así que aquí se extraen las
// funciones de render por su nombre del texto del archivo y se evalúan con los mismos helpers de formato
// (esc, esPct, esPct0, esSign, esPanel) y stubs mínimos para lo que toca el DOM. Además se compara la
// salida de `esVeto` / `esRounds` de esta rama con la de `origin/main` (o con una copia que se le pase) sobre
// una ficha SIN los campos nuevos: debe ser byte a byte idéntica.
//
//   node scripts/smoke/ui-smoke.js                 # compara contra `git show origin/main:public/premium.js`
//   node scripts/smoke/ui-smoke.js /ruta/base.js   # compara contra esa copia
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const NEW_SRC = fs.readFileSync(path.join(ROOT, 'public', 'premium.js'), 'utf8');
let BASE_SRC = null;
try {
  BASE_SRC = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8')
    : execSync('git show origin/main:public/premium.js', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
} catch (e) { console.log('[smoke] sin base para comparar (' + e.message.split('\n')[0] + '): se omite la comparación'); }

// ── extracción de funciones por nombre (sangría de 2 espacios, cierre en la línea "  }") ──────────────────
function grabFn(src, name) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith('  function ' + name + '('));
  if (start < 0) throw new Error('no encuentro function ' + name);
  for (let i = start + 1; i < lines.length; i++) if (lines[i] === '  }') return lines.slice(start, i + 1).join('\n');
  throw new Error('sin cierre para ' + name);
}
function grabVar(src, name) {
  const line = src.split('\n').find((l) => l.startsWith('  var ' + name + ' = '));
  if (!line) throw new Error('no encuentro var ' + name);
  return line;
}
function build(src, names) {
  const helpers = ['esc', 'esPct', 'esPct0', 'esSign'].map((n) => grabVar(src, n)).join('\n');
  const fns = ['esPanel', 'esHist'].concat(names).map((n) => grabFn(src, n)).join('\n');
  const stubs = {
    ic: (n) => '<i class="ic-' + n + '"></i>',
    illo: (n) => '<i class="illo-' + n + '"></i>',
    esT: (es) => es,
    t: (k) => k,
    S: { lang: 'es', es: { game: 'valorant' }, ten: { tour: 'atp' } },
    LANG: 'es',
    tenPct: (x) => (x == null ? '—' : Math.round(100 * x) + '%'),
  };
  const keys = Object.keys(stubs);
  const body = helpers + '\n' + fns + '\nreturn {' + names.map((n) => n + ': ' + n).join(', ') + '};';
  // eslint-disable-next-line no-new-func
  return new Function(...keys, body)(...keys.map((k) => stubs[k]));
}

const NEW = build(NEW_SRC, ['tenDistLabel', 'tenWhatPanel', 'esValDistLabel', 'esValAnchor', 'esVeto', 'esRounds']);
const BASE = BASE_SRC ? build(BASE_SRC, ['esVeto', 'esRounds']) : null;

// ── arnés ────────────────────────────────────────────────────────────────────────────────────────────────
let ok = 0, bad = 0;
const check = (cond, label, extra) => {
  if (cond) { ok++; console.log('  OK    ' + label); }
  else { bad++; console.log('  FALLO ' + label + (extra ? '\n        ' + extra : '')); }
};
const has = (html, s) => html.indexOf(s) >= 0;

// ── TENIS ────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[tenis] ficha ATP con edad + calendario aplicados, distribución C6');
const atp = {
  p_a: 0.371, p_a_base: 0.37, tour: 0,
  adjustments: {
    age_logit: 0.0047, age_pp: 0.11, age: { a: 27.6, b: 27.8, diff: -0.2 },
    calendar_logit: 0.0083, calendar_pp: 0.19, calendar: 'aplicado',
    calendar_detail: { days_a: 15, days_b: 3, n7_a: 0, n7_b: 2, base_lag_days: 0 }, dist_method: 'c6',
  },
  what_matters: [
    { rank: 1, driver: 'Edad', pp: 0.11, text: 'Frances Tiafoe tiene 0.2 años menos que Taylor Fritz: el Elo sobreestima a los veteranos y el ajuste mueve la probabilidad de Frances Tiafoe +0.11 pp.' },
    { rank: 2, driver: 'Calendario', pp: 0.19, text: 'Frances Tiafoe llega con 15 días sin jugar y 0 partidos en 7 días; Taylor Fritz con 3 y 2: +0.19 pp para Frances Tiafoe.' },
  ],
  duel: { dist_method: 'c6' },
};
const hAtp = NEW.tenWhatPanel(atp);
console.log('  ' + hAtp.slice(0, 160) + '…');
check(has(hAtp, 'Qué mueve la probabilidad'), 'título del bloque');
check(has(hAtp, 'base 37.0% → 37.1%'), 'cabecera: base → final con un decimal');
check(has(hAtp, '+0.11 pp') && has(hAtp, '+0.19 pp'), 'pp de edad y calendario (líneas y casillas)');
check(has(hAtp, '15 / 3 días sin jugar · 0 / 2 en 7 días'), 'detalle del calendario');
check(has(hAtp, '27.6 vs 27.8 años'), 'detalle de la edad');
check(has(hAtp, 'distribución empírica (ATP 3 sets)'), 'etiqueta c6');
check(has(hAtp, 'no consejo financiero'), 'disclaimer del producto');
check(!has(hAtp, 'GP Edge'), 'sin "GP Edge"');
check((hAtp.match(/class="gx-esw2"/g) || []).length === 2, 'dos líneas de what_matters');

console.log('\n[tenis] ficha ATP bo5 sin fecha real de calendario, distribución desplazada');
const atp2 = {
  p_a: 0.143, p_a_base: 0.159,
  adjustments: { age_logit: -0.1274, age_pp: -1.63, age: { a: 32.25, b: 26.07, diff: 6.18 }, calendar_logit: 0, calendar_pp: 0, calendar: 'sin fecha real', dist_method: 'shift' },
  what_matters: [
    { rank: 1, driver: 'Edad', pp: -1.63, text: 'x' },
    { rank: 2, driver: 'Calendario', pp: 0, text: 'Calendario: sin fecha real del último partido de ambos (la espina histórica fecha por torneo): no se aplica.' },
  ],
  duel: { dist_method: 'shift' },
};
const hAtp2 = NEW.tenWhatPanel(atp2);
check(has(hAtp2, '-1.63 pp') && has(hAtp2, 'gx-down'), 'edad negativa en rojo');
check(has(hAtp2, '>sin fecha real<'), 'casilla de calendario "sin fecha real"');
check(has(hAtp2, 'distribución desplazada'), 'etiqueta shift');

console.log('\n[tenis] ATP sin fecha de nacimiento, simulador (adjustments.dist_method, sin duel.dist_method)');
const atp3 = { p_a: 0.5, p_a_base: 0.5, adjustments: { age: 'sin fecha de nacimiento de b: no se aplica', calendar: 'sin fecha real', age_pp: null, calendar_pp: null, dist_method: 'c6' },
  what_matters: [{ rank: 1, driver: 'Edad', pp: 0, text: 'Edad: sin fecha de nacimiento de b: no se aplica.' }] };
const hAtp3 = NEW.tenWhatPanel(atp3);
check(has(hAtp3, '>no se aplica<') && has(hAtp3, 'sin fecha de nacimiento de b'), 'edad sin dob: casilla "no se aplica" con el motivo');
check(has(hAtp3, 'distribución empírica (ATP 3 sets)'), 'método leído de adjustments.dist_method');

console.log('\n[tenis] WTA (ajustes "no aplica") y ficha vieja sin campos: NO se pinta nada');
const wta = { p_a: 0.753, p_a_base: 0.753, tour: 1,
  adjustments: { age_logit: 0, age_pp: null, age: 'no aplica (WTA: el término empeora fuera de muestra)', calendar_logit: 0, calendar_pp: null, calendar: 'no aplica (WTA)', dist_method: 'shift' },
  what_matters: [{ rank: 1, driver: 'Edad', pp: 0, text: 'Edad: no aplica (WTA: el término empeora fuera de muestra).' }], duel: { dist_method: 'shift' } };
check(NEW.tenWhatPanel(wta) === '', 'WTA → cadena vacía');
check(NEW.tenWhatPanel({ p_a: 0.6, duel: { hold_a: 0.8 } }) === '', 'ficha sin adjustments/what_matters → cadena vacía');
check(NEW.tenWhatPanel(null) === '' && NEW.tenWhatPanel({}) === '', 'null / {} → cadena vacía');
check(NEW.tenDistLabel('otro') === null, 'método desconocido → sin etiqueta');
const inj = NEW.tenWhatPanel({ adjustments: { age: { a: 1, b: 2, diff: -1 }, age_pp: 1, calendar: 'sin fecha real' }, what_matters: [{ rank: 1, driver: '<b>x</b>', pp: 1, text: '"q"<' }] });
check(!has(inj, '<b>x</b>') && has(inj, '&lt;b&gt;x&lt;/b&gt;') && has(inj, '&quot;q&quot;&lt;'), 'texto escapado');

// ── VALORANT ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[valorant] serie con anclaje por mapa (forma del smoke de valorant.js)');
const ev = { home: { name: 'Fnatic' }, away: { name: 'Sentinels' } };
const mVal = {
  probability: { p: 0.6, temperature: 0.85, max_model: 0.25 },
  veto: {
    likely_maps: [{ map: 'haven', name: 'Haven', p_a: 0.58, bias: 0.51, note: 'terreno favorable' }, { map: 'sunset', name: 'Sunset', p_a: 0.44, bias: 0.5 }, { map: 'lotus', name: 'Lotus', p_a: 0.5, bias: 0.52 }],
    sequence: [{ who: 'a', kind: 'ban', name: 'Bind', p: 0.61 }, { who: 'b', kind: 'pick', name: 'Sunset', p: 0.4 }],
    decider: { name: 'Lotus' }, pool_version: 'medido/v3', note: 'árbol de veto simulado con fuerza medida',
  },
  veto_impact: { verdict: 'favorable', shift_pp: 2.1, baseline: 'serie sin veto 58%', market_p: 0.58 },
  map_anchoring: {
    shift_logit: 0.28, bracketed: true, p_map_market: 0.5811, p_map_market_from: 'implícita de la serie anclada',
    p_map_model_mean: 0.5067, model_vs_market_pp: -7.44,
    maps: [{ map: 'haven', p_a_model: 0.58, p_a: 0.6462 }, { map: 'sunset', p_a_model: 0.44, p_a: 0.5096 }, { map: 'lotus', p_a_model: 0.5, p_a: 0.5695 }],
    why: 'larga',
  },
  rounds: {
    map: 'haven', map_name: 'Haven', p_map_a: 0.6462, p_map_a_model: 0.58, p_round_solved: 0.5354, p_map_target: 0.6462, p_map_sim: 0.649, dist_method: 'bisect',
    mean_rounds: 21.04, overtime_p: 0.1139, p_round_defense: 0.53, p_round_attack: 0.47, map_bias: 0.51,
    totals: { over_20_5: 0.52, over_22_5: 0.31 }, loser_distribution: [{ loser_rounds: 8, p: 0.2 }, { loser_rounds: 10, p: 0.3 }, { loser_rounds: 11, p: 0.5 }], note: 'rondas del mapa 1',
  },
  rounds_by_map: { 1: { p_round_solved: 0.5354 }, 2: { p_round_solved: 0.503 }, 3: { p_round_solved: 0.5156 } },
};
const hVeto = NEW.esVeto(mVal, ev);
console.log('  ' + hVeto.slice(0, 120) + '…');
check(has(hVeto, 'Fnatic · GP') && has(hVeto, 'Fnatic · anclada'), 'columnas modelo / anclada con el nombre del equipo');
check(has(hVeto, '>58%<') && has(hVeto, '<b>65%</b>'), 'Haven: 58% del modelo → 65% anclada');
check(has(hVeto, '>+6.6<'), 'Δ pp de Haven (+6.6) en verde') && check(has(hVeto, 'gx-up">+6.6'), 'clase gx-up en el Δ positivo');
check(has(hVeto, '>44%<') && has(hVeto, '<b>51%</b>'), 'Sunset: 44% → 51%');
check(has(hVeto, '53.5%') && has(hVeto, '50.3%') && has(hVeto, '51.6%'), 'P(ronda) por mapa desde rounds_by_map');
check(has(hVeto, 'Nivel del mapa · mercado') && has(hVeto, '>58%</b>') && has(hVeto, 'implícita de la serie anclada'), 'nivel del mercado con su origen');
check(has(hVeto, 'Desplazamiento') && has(hVeto, '>+0.28<') && has(hVeto, 'resuelto por bisección'), 'shift_logit y bisección');
check(has(hVeto, '-7.44 pp frente al mercado'), 'media del modelo vs mercado');
check(has(hVeto, 'el modelo aporta la forma'), 'frase corta: nivel del mercado, forma del modelo');
check(has(hVeto, 'temperatura 0.85') && has(hVeto, 'peso máximo 25 %'), 'temperatura y peso máximo de la voz propia');
check(has(hVeto, 'terreno favorable'), 'la lectura del mapa sigue en la fila');
check(has(hVeto, 'ELIGE') && has(hVeto, 'DECISIVO') && has(hVeto, 'Impacto del veto'), 'secuencia e impacto intactos');
check(has(hVeto, 'gx-perf-scroll'), 'tabla dentro de contenedor con scroll horizontal (móvil ≥ 360 px)');
check(!has(hVeto, 'GP Edge'), 'sin "GP Edge"');

const hRounds = NEW.esRounds(mVal, ev);
check(has(hRounds, 'P(ronda) resuelta') && has(hRounds, '53.5%'), 'rondas: p_round_solved');
check(has(hRounds, '>bisección<'), 'rondas: dist_method traducido');
check(has(hRounds, 'Mapa anclado') && has(hRounds, '>65%</b>') && has(hRounds, 'modelo sin anclar 58%'), 'rondas: mapa anclado vs modelo');
check(has(hRounds, 'la simulación reproduce 65%'), 'rondas: p_map_sim');
check(has(hRounds, 'Defendiendo') && has(hRounds, 'Rondas del perdedor') && has(hRounds, '20.5'), 'rondas: asimetría, histograma y líneas intactos');

console.log('\n[valorant] con mercado directo (ganador del mapa 1) y bisección fuera de rango');
const hVeto2 = NEW.esVeto(Object.assign({}, mVal, { map_anchoring: Object.assign({}, mVal.map_anchoring, { bracketed: false, p_map_market: 0.6818, p_map_market_from: 'mercado directo (ganador del mapa 1)', shift_logit: 0 }) }), ev);
check(has(hVeto2, 'mercado directo (ganador del mapa 1)') && has(hVeto2, 'fuera de rango: sin desplazar'), 'origen directo y aviso de bisección sin corchete');

console.log('\n[valorant] map_anchoring null → nada nuevo; ficha vieja sin campos → idéntica a origin/main');
const mNull = Object.assign({}, mVal, { map_anchoring: null, rounds: Object.assign({}, mVal.rounds) });
const mOld = { veto: mVal.veto, veto_impact: mVal.veto_impact, rounds: { mean_rounds: 21.04, overtime_p: 0.1139, p_round_defense: 0.53, p_round_attack: 0.47, map_bias: 0.51, totals: { over_20_5: 0.52 }, loser_distribution: mVal.rounds.loser_distribution, note: 'n' } };
check(!has(NEW.esVeto(mNull, ev), 'anclada') && !has(NEW.esRounds(mNull, ev), 'P(ronda) resuelta'), 'map_anchoring null: sin columnas ni casillas nuevas');
check(has(NEW.esVeto(mNull, ev), '<th>Lectura</th>'), 'map_anchoring null: tabla de siempre');
check(!has(NEW.esVeto(mOld, ev), 'anclada') && !has(NEW.esRounds(mOld, ev), 'bisección'), 'ficha vieja: nada nuevo');
check(has(NEW.esVeto({ veto: null }, ev), 'Sin fuerza por mapa todavía'), 'sin veto: el vacío de siempre');
check(NEW.esRounds({ rounds: null }, ev) === null, 'sin rondas: null como antes');
if (BASE) {
  check(NEW.esVeto(mNull, ev) === BASE.esVeto(mNull, ev), 'esVeto(map_anchoring null) === origin/main');
  check(NEW.esRounds(mNull, ev) === BASE.esRounds(mNull, ev), 'esRounds(map_anchoring null) === origin/main');
  check(NEW.esVeto(mOld, ev) === BASE.esVeto(mOld, ev), 'esVeto(ficha vieja) === origin/main');
  check(NEW.esRounds(mOld, ev) === BASE.esRounds(mOld, ev), 'esRounds(ficha vieja) === origin/main');
  check(NEW.esVeto({ veto: null }, ev) === BASE.esVeto({ veto: null }, ev), 'esVeto(sin veto) === origin/main');
}

// ── la composición de la ficha de tenis y del simulador ────────────────────────────────────────────────
console.log('\n[cableado] el bloque de tenis va en la lente "partido" y en el simulador; el veto/rondas de Valorant en partida y simulador');
check(has(NEW_SRC, "tenDuelPanel(d) + tenWhatPanel(d) + tenPathPanel(d)"), 'renderTenMatch: tenWhatPanel entre el duelo y el camino');
check(has(NEW_SRC, 'res = head + tenWhatPanel(r) + setRows'), 'renderTenSim: tenWhatPanel tras la cabecera');
check(has(NEW_SRC, 'esVeto(m2, fake.event), esRounds(m2, fake.event)'), 'simulador de Valorant sigue usando esVeto/esRounds (heredan el bloque)');

console.log('\n[smoke] ' + ok + ' OK, ' + bad + ' fallos');
process.exit(bad ? 1 : 0);
