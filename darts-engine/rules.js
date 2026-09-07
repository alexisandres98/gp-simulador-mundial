// darts-engine/rules.js — EL REGLAMENTO DEL 501 COMO CÓDIGO (blueprint 8.0, bloques 4 y 14)
//
// Todo lo que aquí vive es determinista y comprobable: la geometría de la diana como ORDEN de números (no
// como coordenadas — no tenemos coordenadas y no vamos a fingirlas), el alfabeto de 63 resultados legales,
// la transición reglamentaria (bust con vuelta al inicio de la visita, salida exacta en doble, double-in del
// Grand Prix) y la enumeración de los checkouts alcanzables con 1, 2 y 3 dardos. Nada de listas manuales de
// "salidas altas": si el compilador dice que 159 no se cierra en tres dardos es porque lo enumeró.
'use strict';

// la diana en sentido horario empezando arriba (20). Los vecinos de un número son los que están a su lado.
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const POS = new Map(ORDER.map((n, i) => [n, i]));
function neighbours(n) {
  const i = POS.get(n);
  if (i == null) return [];
  return [ORDER[(i + 19) % 20], ORDER[(i + 1) % 20]];
}

// ── ALFABETO ─────────────────────────────────────────────────────────────────────────────────────────────
// 63 resultados de puntuación: S1..S20, D1..D20, T1..T20, SB (25), DB (50) y MISS (0). Un cero puede ser
// fallo fuera, rebote o dardo que no abre en double-in: el score es el mismo, el MECANISMO no, y por eso el
// motor de visita lleva la etiqueta aparte cuando hace falta.
function outcome(kind, n) {
  if (kind === 'MISS') return { kind, n: 0, score: 0, isDouble: false, key: 'MISS' };
  if (kind === 'SB') return { kind, n: 25, score: 25, isDouble: false, key: 'SB' };
  if (kind === 'DB') return { kind, n: 25, score: 50, isDouble: true, key: 'DB' };
  const mult = kind === 'S' ? 1 : kind === 'D' ? 2 : 3;
  return { kind, n, score: mult * n, isDouble: kind === 'D', key: kind + n };
}
const ALPHABET = (() => {
  const out = [];
  for (const k of ['S', 'D', 'T']) for (let n = 1; n <= 20; n++) out.push(outcome(k, n));
  out.push(outcome('SB'), outcome('DB'), outcome('MISS'));
  return out;
})();

// ── TRANSICIÓN REGLAMENTARIA ─────────────────────────────────────────────────────────────────────────────
// Devuelve el efecto de UN dardo sobre un marcador `r` (puntos restantes), con `opened` para double-in.
//   { type: 'FINISH' | 'BUST' | 'SCORE' | 'NOOPEN', r: nuevo marcador }
// El bust no se resuelve aquí (necesita el marcador de INICIO de la visita, que vive en el motor de
// visita); esta función solo lo detecta. Dejar 1 o llegar a 0 sin doble es bust; sobrepasar es bust.
function applyDart(r, y, { doubleIn = false, opened = true } = {}) {
  if (doubleIn && !opened) {
    if (!y.isDouble) return { type: 'NOOPEN', r, opened: false };
    // el doble de apertura SÍ puntúa
    return { type: 'SCORE', r: r - y.score, opened: true };
  }
  const left = r - y.score;
  if (left < 0 || left === 1) return { type: 'BUST', r, opened };
  if (left === 0) return y.isDouble ? { type: 'FINISH', r: 0, opened } : { type: 'BUST', r, opened };
  return { type: 'SCORE', r: left, opened };
}

// ── CHECKOUTS ALCANZABLES: POR ENUMERACIÓN, NO POR LISTA ─────────────────────────────────────────────────
// finishable[d] = Set de marcadores que se pueden cerrar con exactamente ≤ d dardos (1, 2 o 3), terminando
// en doble y sin pasar por 1. Sirve para comprobar soporte (159, 162, 163, 165, 166, 168, 169 no se
// cierran en tres; 170 = T20 T20 DB sí) y para la política del motor de visita.
const FINISHABLE = (() => {
  const doubles = ALPHABET.filter((y) => y.isDouble).map((y) => y.score); // 2..40 pares y 50
  const one = new Set(doubles);
  const scoring = ALPHABET.filter((y) => y.kind !== 'MISS').map((y) => y.score);
  const two = new Set(one);
  for (const s of scoring) for (const d of one) if (s + d <= 170) two.add(s + d);
  const three = new Set(two);
  for (const s of scoring) for (const t of two) if (s + t <= 170 && s + t !== 1) three.add(s + t);
  // un marcador intermedio nunca puede ser 1: la enumeración por sumas ya lo respeta porque los restos
  // parciales son el propio marcador menos un score, y 1 no está en `one` ni en `two`.
  for (const s of [...three]) if (s > 170) three.delete(s);
  return { 1: one, 2: two, 3: three };
})();
const NOT_FINISHABLE_3 = [];
for (let s = 2; s <= 170; s++) if (!FINISHABLE[3].has(s)) NOT_FINISHABLE_3.push(s); // 159 162 163 165 166 168 169 (+ 1 no cuenta)

// ¿puede cerrarse `r` con `d` dardos?
const canFinish = (r, d) => r >= 2 && r <= 170 && !!(FINISHABLE[Math.min(3, Math.max(1, d))] || FINISHABLE[3]).has(r);

// ── FORMATOS ─────────────────────────────────────────────────────────────────────────────────────────────
// Un formato es una máquina, no un "best of": primero a N legs (o sets), con o sin dos de diferencia,
// tope de legs y muerte súbita, y sets con legs por set y regla del último set. Todo versionado: las
// plantillas de aquí son mapa de implementación; el paquete operativo de cada edición se carga aparte
// (data/darts/formats.json) y se etiqueta como certificado o no.
function legsFormat(bestOf, { twoClear = false, maxLegs = null } = {}) {
  const firstTo = Math.ceil(bestOf / 2);
  return { kind: 'legs', best_of: bestOf, first_to: firstTo, two_clear: !!twoClear, max_legs: maxLegs || (twoClear ? bestOf + 2 : bestOf), double_in: false };
}
function setsFormat(bestOfSets, legsPerSet = 5, { finalSetTwoClear = false, finalSetMaxLegs = null } = {}) {
  return { kind: 'sets', best_of_sets: bestOfSets, first_to_sets: Math.ceil(bestOfSets / 2), legs_per_set: legsPerSet, first_to_legs: Math.ceil(legsPerSet / 2),
    final_set_two_clear: !!finalSetTwoClear, final_set_max_legs: finalSetMaxLegs || (finalSetTwoClear ? legsPerSet + 6 : legsPerSet), double_in: false };
}

// Plantillas HISTÓRICAS (mapa de lectura, no configuración de una edición futura). Cada evento real debe
// traer su brief; si no lo trae, la UI lo dice ("formato de plantilla, no certificado").
const TEMPLATES = {
  'pdc-world-championship': { label: 'PDC World Championship', unit: 'sets', rounds: { R1: setsFormat(5), R2: setsFormat(5), R3: setsFormat(7), R4: setsFormat(7), QF: setsFormat(9), SF: setsFormat(11), F: setsFormat(13, 5, { finalSetTwoClear: true, finalSetMaxLegs: 11 }) }, default: setsFormat(7), certified: false },
  'premier-league': { label: 'Premier League Darts', unit: 'legs', default: legsFormat(11), certified: false },
  'world-matchplay': { label: 'World Matchplay', unit: 'legs', rounds: { R1: legsFormat(19, { twoClear: true, maxLegs: 25 }), R2: legsFormat(21, { twoClear: true, maxLegs: 27 }), QF: legsFormat(31, { twoClear: true, maxLegs: 37 }), SF: legsFormat(33, { twoClear: true, maxLegs: 39 }), F: legsFormat(35, { twoClear: true, maxLegs: 41 }) }, default: legsFormat(19, { twoClear: true, maxLegs: 25 }), certified: false },
  'world-grand-prix': { label: 'World Grand Prix', unit: 'sets', double_in: true, rounds: { R1: setsFormat(3), R2: setsFormat(5), QF: setsFormat(5), SF: setsFormat(9), F: setsFormat(11) }, default: setsFormat(3), certified: false },
  'uk-open': { label: 'UK Open', unit: 'legs', rounds: { R1: legsFormat(11), R2: legsFormat(11), R3: legsFormat(11), R4: legsFormat(19), R5: legsFormat(19), QF: legsFormat(19), SF: legsFormat(21), F: legsFormat(21) }, default: legsFormat(11), certified: false },
  'european-tour': { label: 'European Tour', unit: 'legs', rounds: { R1: legsFormat(11), R2: legsFormat(11), R3: legsFormat(11), QF: legsFormat(11), SF: legsFormat(13), F: legsFormat(15) }, default: legsFormat(11), certified: false },
  'players-championship': { label: 'Players Championship', unit: 'legs', rounds: { R1: legsFormat(11), R2: legsFormat(11), R3: legsFormat(11), R4: legsFormat(11), QF: legsFormat(11), SF: legsFormat(13), F: legsFormat(15) }, default: legsFormat(11), certified: false },
  'players-championship-finals': { label: 'Players Championship Finals', unit: 'legs', rounds: { R1: legsFormat(11), R2: legsFormat(11), R3: legsFormat(19), QF: legsFormat(19), SF: legsFormat(21), F: legsFormat(21) }, default: legsFormat(11), certified: false },
  'grand-slam': { label: 'Grand Slam of Darts', unit: 'legs', rounds: { GROUP: legsFormat(9), R2: legsFormat(19), QF: legsFormat(31), SF: legsFormat(31), F: legsFormat(31) }, default: legsFormat(9), certified: false },
  'european-championship': { label: 'European Championship', unit: 'legs', rounds: { R1: legsFormat(11), R2: legsFormat(19), QF: legsFormat(19), SF: legsFormat(21), F: legsFormat(21) }, default: legsFormat(11), certified: false },
  'world-series': { label: 'World Series of Darts', unit: 'legs', rounds: { R1: legsFormat(11), QF: legsFormat(11), SF: legsFormat(13), F: legsFormat(15) }, default: legsFormat(11), certified: false },
  'world-series-finals': { label: 'World Series of Darts Finals', unit: 'legs', rounds: { R1: legsFormat(11), R2: legsFormat(19), QF: legsFormat(19), SF: legsFormat(21), F: legsFormat(21) }, default: legsFormat(11), certified: false },
  'world-cup': { label: 'World Cup of Darts', unit: 'legs', default: legsFormat(7), certified: false },
  'development-tour': { label: 'Development Tour', unit: 'legs', default: legsFormat(7), certified: false },
  'challenge-tour': { label: 'Challenge Tour', unit: 'legs', default: legsFormat(7), certified: false },
  'wdf': { label: 'WDF', unit: 'sets', default: setsFormat(3), certified: false },
  'generic-legs': { label: 'Legs', unit: 'legs', default: legsFormat(11), certified: false },
};

// un formato del catálogo por clave de torneo (texto libre de la fuente) y ronda
function formatFor(tournamentName, round) {
  const t = String(tournamentName || '').toLowerCase();
  let key = 'generic-legs';
  if (/world championship|worlds|ally pally|alexandra/.test(t) && !/wdf|bdo|youth|women/.test(t)) key = 'pdc-world-championship';
  else if (/premier league/.test(t)) key = 'premier-league';
  else if (/matchplay/.test(t)) key = 'world-matchplay';
  else if (/grand prix/.test(t)) key = 'world-grand-prix';
  else if (/uk open/.test(t)) key = 'uk-open';
  else if (/european championship/.test(t)) key = 'european-championship';
  else if (/european (tour|darts)|darts (trophy|open|grand prix|masters)|international darts open|german darts|austrian|belgian|dutch darts|czech darts|hungarian|swiss|baltic|flanders|poland|polish/.test(t)) key = 'european-tour';
  else if (/players championship finals/.test(t)) key = 'players-championship-finals';
  else if (/players championship/.test(t)) key = 'players-championship';
  else if (/grand slam/.test(t)) key = 'grand-slam';
  else if (/world series.*final/.test(t)) key = 'world-series-finals';
  else if (/world series|nordic darts masters|bahrain|dutch darts masters|poland darts masters|us darts masters|new zealand|australian darts masters/.test(t)) key = 'world-series';
  else if (/world cup/.test(t)) key = 'world-cup';
  else if (/development tour/.test(t)) key = 'development-tour';
  else if (/challenge tour/.test(t)) key = 'challenge-tour';
  else if (/wdf|bdo/.test(t)) key = 'wdf';
  const tpl = TEMPLATES[key];
  const rk = normalizeRound(round);
  const fmt = (tpl.rounds && rk && tpl.rounds[rk]) || tpl.default;
  return { key, label: tpl.label, round: rk || null, format: { ...fmt, double_in: !!tpl.double_in }, certified: !!tpl.certified, source: 'plantilla histórica (no certificada para esta edición)' };
}
function normalizeRound(r) {
  const s = String(r || '').toLowerCase();
  if (!s) return null;
  if (/final/.test(s) && !/semi|quarter|1\/|round/.test(s)) return 'F';
  if (/semi|1\/2/.test(s)) return 'SF';
  if (/quarter|1\/4/.test(s)) return 'QF';
  if (/group/.test(s)) return 'GROUP';
  const m = s.match(/(?:round|r)\s*(?:of\s*)?(\d+)/);
  if (m) {
    const n = +m[1];
    if (n >= 64) return 'R1';
    if (n === 32) return 'R2';
    if (n === 16) return 'R3';
    if (n === 8) return 'QF';
    if (n <= 6) return 'R' + n;
  }
  if (/1\/8|last 16/.test(s)) return 'R3';
  if (/1\/16|last 32/.test(s)) return 'R2';
  if (/1\/32|last 64/.test(s)) return 'R1';
  return null;
}

module.exports = { ORDER, neighbours, outcome, ALPHABET, applyDart, FINISHABLE, NOT_FINISHABLE_3, canFinish, legsFormat, setsFormat, TEMPLATES, formatFor, normalizeRound };
