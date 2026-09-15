// tt-engine/rules.js — LAS REGLAS EXACTAS DEL TENIS DE MESA (blueprint 9.0, bloque 12.1)
//
// Un game se juega a 11 con dos de diferencia; el servicio va en bloques de dos puntos y desde 10–10 cambia
// en cada punto; el primer servidor alterna de game en game; el game decisivo cambia de lado al primer
// cinco. De aquí salen tres verdades que el compilador respeta por construcción y que el mercado a veces
// no: un game no puede acabar 11–10, el total 21 no existe, y "más de 20,5 puntos" y "más de 21,5 puntos"
// en un game son EXACTAMENTE la misma apuesta (las dos equivalen a "hay deuce").
//
// También viven aquí la gramática de rondas y de niveles de competición (WTT/ITTF frente a ligas privadas
// de apuestas) y el estado de INTEGRIDAD que cada competición recibe antes de que el modelo la toque.
'use strict';

const RULESET = Object.freeze({
  points: 11,          // puntos para ganar un game
  win_by: 2,           // diferencia mínima
  serve_block: 2,      // puntos por turno de servicio antes del deuce
  deuce_from: 10,      // desde 10–10 el servicio alterna en cada punto
  deuce_alternate: 1,
  sides_change_each_game: true,
  decider_side_change_at: 5,   // en el game decisivo se cambia de lado cuando alguien llega a 5
  timeouts_per_match: 1,       // un tiempo muerto de un minuto por jugador y partido
  towel_every: 6,              // toalla cada seis puntos (no entra al modelo; documenta el ritmo)
});

const other = (s) => (s === 'a' ? 'b' : 'a');

// ¿quién sirve el punto n (0-based dentro del game) si el primer servidor del game es `first`?
// Antes del deuce: bloque floor(n/2) alterna desde el primer servidor. Desde 10–10 (n ≥ 20): cada punto.
function serverAt(n, first) {
  if (n >= 2 * RULESET.deuce_from) return (n - 2 * RULESET.deuce_from) % 2 === 0 ? first : other(first);
  return Math.floor(n / RULESET.serve_block) % 2 === 0 ? first : other(first);
}
// el game terminó?
function gameOver(i, j) { return (i >= RULESET.points || j >= RULESET.points) && Math.abs(i - j) >= RULESET.win_by; }
// un marcador de game es legal?  (11–10 no; 12–10 sí; 9–11 sí; 13–12 no)
function legalGameScore(i, j) {
  if (!gameOver(i, j)) return false;
  const hi = Math.max(i, j), lo = Math.min(i, j);
  if (hi === RULESET.points) return lo <= RULESET.points - RULESET.win_by;
  return hi - lo === RULESET.win_by; // más allá de 11 solo se cierra por dos exactos
}
// formato de partido: al mejor de N games
function bestOfFormat(bestOf) {
  const bo = [3, 5, 7].includes(+bestOf) ? +bestOf : 5;
  return { kind: 'games', best_of: bo, need: Math.ceil(bo / 2), max_games: bo, rules: RULESET };
}
// del marcador final en games se deduce el formato jugado (3 games ganados → BO5; 4 → BO7; 2 → BO3)
function bestOfFromScore(wg, lg) { const w = Math.max(+wg || 0, +lg || 0); return w >= 4 ? 7 : w === 3 ? 5 : w === 2 ? 3 : null; }

// ── RONDAS ──────────────────────────────────────────────────────────────────────────────────────────────
// Normaliza "Men's Singles - Quarterfinal - Match 1", "8FNL", "GP16", "Round of 32", "Qualification Round 2"…
const ROUND_ORDER = ['Q', 'GRP', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'];
function normalizeRound(s) {
  const x = String(s || '').toLowerCase();
  if (!x) return null;
  if (/semi|sfnl|\bsf\b/.test(x)) return 'SF';
  if (/quarter|qfnl|\bqf\b/.test(x)) return 'QF';
  if (/round of 16|8fnl|\br16\b|\b1\/8\b/.test(x)) return 'R16';
  if (/round of 32|16fnl|\br32\b|\b1\/16\b/.test(x)) return 'R32';
  if (/round of 64|32fnl|\br64\b/.test(x)) return 'R64';
  if (/round of 128|64fnl|\br128\b/.test(x)) return 'R128';
  if (/\bfinal\b|\bfnl\b|gold medal/.test(x) && !/semi|quarter/.test(x)) return 'F';
  if (/group|\bgp\d|\bgrp|pool|stage 1|round robin/.test(x)) return 'GRP';
  if (/qualif|\brnd\d|\bq\d|preliminary|prelim|pre\.? ?round/.test(x)) return 'Q';
  if (/consolation|bronze|3rd place|third place/.test(x)) return 'OTR';
  if (/main draw/.test(x)) return 'MD';
  return 'OTR';
}
const ROUND_LABEL = { Q: 'Clasificación', GRP: 'Grupos', R128: 'Ronda de 128', R64: 'Ronda de 64', R32: 'Ronda de 32', R16: 'Octavos', QF: 'Cuartos', SF: 'Semifinal', F: 'Final', MD: 'Cuadro principal', OTR: 'Ronda' };

// ── NIVELES DE EVENTO (circuito WTT/ITTF) ────────────────────────────────────────────────────────────────
function tierOf(name) {
  const x = String(name || '').toLowerCase();
  if (/grand smash/.test(x)) return 'grand_smash';
  if (/wtt finals|wtt cup finals/.test(x)) return 'finals';
  if (/wtt champions/.test(x)) return 'champions';
  if (/star contender/.test(x)) return 'star_contender';
  if (/contender/.test(x)) return 'contender';
  if (/feeder/.test(x)) return 'feeder';
  if (/world (table tennis )?championships|world team|world singles/.test(x)) return 'worlds';
  if (/world cup/.test(x)) return 'world_cup';
  if (/olympic/.test(x)) return 'olympics';
  if (/youth|junior|cadet|\bu1[1-9]\b|\bu2[01]\b|under 19|under 21/.test(x)) return 'youth';
  if (/asian|european|africa|pan ?am|oceania|commonwealth|mediterranean|universiade|university/.test(x)) return 'continental';
  if (/challenge|open|tour/.test(x)) return 'ittf_tour';
  return 'other';
}
const TIER_LABEL = { grand_smash: 'Grand Smash', finals: 'WTT Finals', champions: 'WTT Champions', star_contender: 'WTT Star Contender', contender: 'WTT Contender', feeder: 'WTT Feeder', worlds: 'Mundial', world_cup: 'Copa del Mundo', olympics: 'Juegos Olímpicos', youth: 'Juvenil', continental: 'Continental', ittf_tour: 'ITTF Tour', other: 'Otro' };
// peso informativo de un partido para el rating: los eventos de élite pesan más que los juveniles
const TIER_WEIGHT = { grand_smash: 1.15, finals: 1.15, champions: 1.1, worlds: 1.15, olympics: 1.15, world_cup: 1.1, star_contender: 1.0, contender: 1.0, feeder: 0.9, continental: 0.95, ittf_tour: 0.9, youth: 0.6, other: 0.8 };

// ── INTEGRIDAD DE COMPETICIÓN (blueprint bloque 7) ───────────────────────────────────────────────────────
// VERIFIED_SCOPE: organizador oficial con resultados publicados (WTT, ITTF, olímpico, continental).
// WATCH: ligas nacionales con federación detrás pero sin fuente propia en la casa (T.League, Bundesliga…).
// RESTRICTED: ligas privadas creadas para el mercado de apuestas (Liga Pro, Setka Cup, TT Cup, TT Elite
//   Series…). Sin cuerpo oficial, sin resultado independiente y sin plantilla en la base: se ENSEÑAN con su
//   aviso y NUNCA se modelan ni se registran en la sombra.
// QUARANTINED / BLOCKED: una competición verificada que muestra anomalías (o una orden explícita) baja de
//   estado; se conserva la gramática aunque hoy nadie la ocupe.
const INTEGRITY = Object.freeze({ VERIFIED_SCOPE: 'VERIFIED_SCOPE', WATCH: 'WATCH', RESTRICTED: 'RESTRICTED', QUARANTINED: 'QUARANTINED', BLOCKED: 'BLOCKED' });
// 15-sep-2026 — POR QUÉ EL ORDEN IMPORTA (Fase 0 de la auditoría). Esta función tenía dos fallos que se
// sumaban y dejaban fuera del modelo competiciones oficiales enteras:
//   (a) `tt star` casaba dentro de "W·TT STAR· Contender", así que TODOS los WTT Star Contender del mundo
//       —una de las categorías principales del calendario— salían clasificados como liga privada de
//       apuestas desde que se escribió el motor. El 15-sep eran 15 partidos de Astana en Cloudbet.
//   (b) La lista de ligas privadas se evaluaba ANTES que la del organizador oficial, así que cualquier
//       evento de la WTT celebrado en Chequia, Kazajistán, Moscú o Polonia habría caído igual.
// El organizador oficial manda: si la competición dice WTT o ITTF, es verificada y no hay más que discutir.
// Después va la lista de circuitos privados, que ahora exige límites de palabra donde el texto es corto.
const OFICIAL_TT = /\b(wtt|ittf)\b/;
const PRIVADA_TT = /liga pro|setka|\btt cup\b|elite series|challenger series|masters series|win cup|star series|pro series|ttstar|\btt star\b|moscow|ukraine|belarus|armenia|kazakhstan open|russia|czech|poland tt|polish tt|hungary tt/;
function integrityOf(competition) {
  const x = String(competition || '').toLowerCase();
  if (!x) return INTEGRITY.RESTRICTED;
  if (OFICIAL_TT.test(x)) return INTEGRITY.VERIFIED_SCOPE;
  if (PRIVADA_TT.test(x)) return INTEGRITY.RESTRICTED;
  if (/world|olympic|grand smash|contender|feeder|champions|asian|european|pan ?am|africa|oceania|commonwealth|singles|doubles/.test(x)) return INTEGRITY.VERIFIED_SCOPE;
  if (/bundesliga|t\.? ?league|pro a|superliga|super league|liga nacional|division|champions league|europe cup|ettu/.test(x)) return INTEGRITY.WATCH;
  return INTEGRITY.RESTRICTED;
}
const INTEGRITY_LABEL = { VERIFIED_SCOPE: 'Verificada', WATCH: 'En observación', RESTRICTED: 'Restringida', QUARANTINED: 'En cuarentena', BLOCKED: 'Bloqueada' };
const INTEGRITY_NOTE = {
  VERIFIED_SCOPE: 'organizador oficial (WTT/ITTF) con resultado publicado: el modelo la compila y la sombra la registra.',
  WATCH: 'liga con federación detrás pero sin fuente propia de resultados en la casa: se enseña el mercado, el modelo no entra.',
  RESTRICTED: 'liga privada creada para el mercado de apuestas, sin cuerpo oficial ni resultado independiente: solo display con aviso; jamás modelo ni sombra.',
  QUARANTINED: 'competición verificada con anomalías en revisión: modelo apagado hasta resolver.',
  BLOCKED: 'competición excluida por decisión explícita.',
};

// ── PLANTILLAS DE FORMATO POR NIVEL Y RONDA (no certificadas: el match card oficial las certifica) ──────
// Lo que la casa sabe del circuito: WTT Champions, Grand Smash (cuadro) y Mundial al mejor de 7; Contender,
// Star Contender y Feeder al mejor de 5 con la final al mejor de 7 (Star Contender) — la base histórica
// corrige estas plantillas con las frecuencias reales por nivel×ronda (formats.json) cuando existen.
function templateBestOf(tier, round) {
  const r = round || 'OTR';
  switch (tier) {
    case 'grand_smash': return r === 'Q' ? 5 : 7;
    case 'champions': case 'finals': case 'worlds': case 'olympics': return 7;
    case 'world_cup': return r === 'GRP' ? 5 : 7;
    case 'star_contender': return r === 'F' ? 7 : 5;
    case 'contender': return r === 'F' ? 7 : 5;
    case 'feeder': return 5;
    case 'continental': return 7;
    default: return 5;
  }
}

// ── CLASES DE EQUIVALENCIA DE PAGO (T2.12, 15-sep-2026) ─────────────────────────────────────────────────
// El reglamento deja huecos en las escalas —un game no puede acabar 11–10, así que el total 21 NO EXISTE, y
// el margen mínimo de un game son 2 puntos— y donde hay un hueco, dos apuestas con nombres distintos pagan
// exactamente igual. El compilador ya lo sabía (`payoffEquivalences`) pero solo para ENSEÑARLO: el catálogo
// dedupe por `familia|lado|línea|game`, de modo que "más de 20,5", "más de 21,5" y "deuce sí" del mismo game
// son TRES candidatas distintas para el sistema y una sola apuesta para el bolsillo. Apilar la misma apuesta
// ya costó −17,63 % de ROI en tarjetas; aquí no ha pasado todavía porque Cloudbet no cotiza el deuce, pero
// el agujero está abierto y Bovada sí lo cotiza.
//
// La clave se construye desde el CONJUNTO ALCANZABLE, no desde una lista de casos: dos líneas son la misma
// apuesta cuando el primer resultado alcanzable que las cruza es el mismo.
// totales alcanzables de UN game: 11..20 (11–j con j ≤ 9) y, desde el deuce, solo pares ≥ 22. El 21 no está.
const TOTALES_GAME = (() => { const s = []; for (let j = 0; j <= RULESET.points - RULESET.win_by; j++) s.push(RULESET.points + j); for (let t = 2 * RULESET.deuce_from + 2; t <= 2 * RULESET.deuce_from + 200; t += 2) s.push(t); return s.sort((a, b) => a - b); })();
// márgenes alcanzables de UN game: 2..11. El 1 no está (hay que ganar por dos).
const MARGENES_GAME = (() => { const s = []; for (let m = RULESET.win_by; m <= RULESET.points; m++) s.push(m); return s; })();
// márgenes de games de un partido al mejor de N: need, need−1, …, 1. El 0 no está (no hay empate).
const margenesPartido = (bestOf) => { const need = Math.ceil((([3, 5, 7].includes(+bestOf) ? +bestOf : 5)) / 2); const s = []; for (let k = 0; k < need; k++) s.push(need - k); return s.sort((a, b) => a - b); };
// primer valor alcanzable ESTRICTAMENTE mayor que x (null si no hay: la selección es imposible)
const primeroSobre = (conj, x) => { for (const v of conj) if (v > x) return v; return null; };
// La clave usa SIEMPRE la frontera "primer alcanzable por encima de la línea", para los dos lados: over gana
// si el resultado llega a esa frontera y under gana si no llega, así que las dos caras comparten frontera y
// se distinguen solo por el lado. Así "más de 20,5", "más de 21,5" y "deuce sí" caen en la misma clave, y
// "menos de 20,5", "menos de 21,5" y "deuce no" en la contraria.
function equivalenceKey(fam, side, line, game, bestOf) {
  const g = game || 1;
  const L = Number(line);
  const lado = (s) => (s === 'over' || s === 'yes' || s === 'a' ? 'si' : 'no');
  switch (fam) {
    case 'GAME_DEUCE': return `g${g}|total>=${primeroSobre(TOTALES_GAME, 2 * RULESET.deuce_from)}|${lado(side)}`;
    case 'GAME_POINTS_TOTAL': {
      if (!Number.isFinite(L) || (side !== 'over' && side !== 'under')) return null;
      const v = primeroSobre(TOTALES_GAME, L);
      return v == null ? null : `g${g}|total>=${v}|${lado(side)}`;
    }
    // el margen mínimo de un game son 2 puntos: cualquier hándicap dentro de (−2, 2) es el ganador del game
    case 'GAME_ML': return side === 'a' || side === 'b' ? `g${g}|margen>=${MARGENES_GAME[0]}|${side}` : null;
    case 'GAME_POINTS_HCP': {
      if (!Number.isFinite(L) || (side !== 'a' && side !== 'b')) return null;
      const v = primeroSobre(MARGENES_GAME, -L);
      return v == null ? null : `g${g}|margen>=${v}|${side}`;
    }
    // el partido no puede acabar empatado a games: un hándicap de games dentro de (−1, 1) es el ganador
    case 'ML': return side === 'a' || side === 'b' ? `m|margen>=${margenesPartido(bestOf)[0]}|${side}` : null;
    case 'GAMES_HCP': {
      if (!Number.isFinite(L) || (side !== 'a' && side !== 'b')) return null;
      const v = primeroSobre(margenesPartido(bestOf), -L);
      return v == null ? null : `m|margen>=${v}|${side}`;
    }
    default: return null;   // totales de partido y marcador exacto no tienen huecos que los igualen
  }
}

module.exports = { RULESET, other, serverAt, gameOver, legalGameScore, bestOfFormat, bestOfFromScore, ROUND_ORDER, ROUND_LABEL, normalizeRound, tierOf, TIER_LABEL, TIER_WEIGHT, INTEGRITY, integrityOf, INTEGRITY_LABEL, INTEGRITY_NOTE, templateBestOf, equivalenceKey, TOTALES_GAME, MARGENES_GAME, margenesPartido };
