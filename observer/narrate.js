// observer/narrate.js — CAPA DE NARRATIVA DEL CONTEXTO (8-jul). Convierte una evaluación del observer
// (status + keyword + corroboración) en una EXPLICACIÓN NARRADA bilingüe de lo que la inteligencia
// descubrió sobre un jugador, SIN revelar la fuente ni el titular (caja negra). Es la pieza que faltaba:
// la gente veía "DUDA" pero no sabía POR QUÉ; ahora lee "Haaland arrastra un cuadro de malestar estomacal
// reportado en la previa; el sistema lo detectó en varias fuentes y rebajó su probabilidad de ser titular".
// PURO: sin DB, sin red. Determinístico (mismo input → misma frase).
'use strict';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// keyword del extractor → naturaleza del hallazgo. El orden importa (primero el más específico).
const REASON_RULES = [
  { code: 'ILLNESS', kws: ['illness', 'unwell', 'fever', 'gastro', 'sick', 'enfermo', 'fiebre', 'indispuesto', 'malestar', 'gripe', 'virus'] },
  { code: 'KNOCK', kws: ['a knock', 'knock in training', 'picked up a knock', 'strain', 'discomfort', 'golpe en el', 'golpe en la', 'recibio un golpe', 'molestias', 'sobrecarga'] },
  { code: 'TRAINING', kws: ['no completo el entrenamiento', 'entreno aparte', 'no se entreno', 'trained apart', 'missed training'] },
  { code: 'SUSPENSION', kws: ['suspended', 'suspension', 'banned', 'accumulation of yellow', 'sancionado', 'suspendido', 'acumulacion de amarillas', 'por sancion'] },
  { code: 'INJURY', kws: ['ruled out', 'out of the match', 'will miss', 'misses the', 'sidelined', 'out injured', 'baja', 'es baja', 'se pierde el', 'descartado', 'no jugara', 'no estara', 'lesion'] },
  { code: 'ROTATION', kws: ['rested', 'set to rotate', 'rotation', 'could be benched', 'start on the bench', 'rotacion', 'descanso', 'iria al banco', 'seria suplente', 'dosificar'] },
  { code: 'FITNESS_DOUBT', kws: ['in doubt', 'a doubt', 'doubt over', 'major doubt', 'fitness doubt', 'doubtful', 'fitness test', 'questionable', 'injury concern', 'en duda', 'es duda', 'duda para', 'duda ante', 'sigue en duda', 'mantiene en duda', 'entre algodones'] },
  { code: 'RETURN', kws: ['returns to training', 'back in training', 'declared fit', 'passed fit', 'fit to play', 'cleared to play', 'recuperado', 'vuelve a entrenar', 'alta medica', 'queda habilitado', 'esta para jugar'] },
];

function reasonOf(keyword) {
  const k = norm(keyword);
  for (const r of REASON_RULES) if (r.kws.some(w => k.includes(norm(w)))) return r.code;
  return null;
}

// Frase de la NATURALEZA del hallazgo (sujeto = "{player}"). ES/EN.
const NATURE = {
  ILLNESS: { es: 'arrastra un cuadro de malestar o enfermedad reportado en la previa', en: 'is dealing with an illness or stomach bug reported ahead of the match' },
  KNOCK: { es: 'llega con un golpe o molestia física de los últimos entrenamientos', en: 'is carrying a knock or physical discomfort from recent training' },
  TRAINING: { es: 'no completó el trabajo normal con el grupo en la previa', en: 'did not complete normal training with the group' },
  SUSPENSION: { es: 'está señalado por sanción (acumulación de amonestaciones o expulsión)', en: 'is flagged for suspension (yellow-card accumulation or a red)' },
  INJURY: { es: 'aparece como baja por lesión para este partido', en: 'is reported out injured for this match' },
  ROTATION: { es: 'asoma como posible rotación o descanso', en: 'looks like a possible rotation or rest call' },
  FITNESS_DOUBT: { es: 'figura en duda por su estado físico', en: 'is listed as a fitness doubt' },
  RETURN: { es: 'apunta a volver tras un problema reciente', en: 'is on track to return after a recent issue' },
};

// prob_miss → cuán marcada es la señal (para el matiz "leve/serio").
function intensity(pm) { return pm >= 0.8 ? 'high' : pm >= 0.45 ? 'mid' : 'low'; }

// Narra UNA evaluación de jugador. a = { player, status, prob_miss, corroborated, source_count, evidence:[{keyword,category,body_check,published_at}] }.
// Devuelve { es, en } o null si no hay nada que narrar (status OK sin señal).
function narratePlayer(a, { lang = null, now = Date.now() } = {}) {
  if (!a || a.status === 'OK' || !(a.prob_miss > 0)) return null;
  // naturaleza: de la evidencia más severa vigente (misma categoría del status)
  const ev = (a.evidence || []).find(e => e.category === a.status) || (a.evidence || [])[0] || {};
  const reason = reasonOf(ev.keyword) || (a.status === 'SUSPENDED' ? 'SUSPENSION' : a.status === 'OUT' ? 'INJURY' : a.status === 'REST_RISK' ? 'ROTATION' : 'FITNESS_DOUBT');
  const nat = NATURE[reason] || NATURE.FITNESS_DOUBT;
  const player = a.player || (lang === 'en' ? 'The player' : 'El jugador');
  // corroboración (sin nombrar la fuente)
  const bodyOk = (a.evidence || []).some(e => e.body_check === 'confirmed');
  const multi = a.corroborated && (a.source_count || 0) >= 2;
  const corrEs = multi ? 'el sistema lo detectó en varias fuentes independientes' : bodyOk ? 'el sistema lo verificó leyendo la nota completa' : 'el sistema lo detectó en un reporte de la previa, aún sin confirmar del todo';
  const corrEn = multi ? 'the system picked it up across several independent sources' : bodyOk ? 'the system verified it by reading the full report' : 'the system picked it up in a single pre-match report, not yet fully confirmed';
  // efecto sobre el modelo
  const inten = intensity(a.prob_miss);
  const effEs = a.status === 'OUT' || a.status === 'SUSPENDED'
    ? 'Por eso lo dejó fuera del once proyectado y ajustó a la baja la generación esperada del equipo'
    : inten === 'high' ? 'Con esa señal rebajó con fuerza su probabilidad de ser titular' : inten === 'mid' ? 'Con esa señal recortó su probabilidad de ser titular' : 'Quedó marcado con una alerta leve sobre su titularidad';
  const effEn = a.status === 'OUT' || a.status === 'SUSPENDED'
    ? 'So it dropped him from the projected XI and adjusted the team\'s expected output downward'
    : inten === 'high' ? 'On that signal it sharply lowered his probability of starting' : inten === 'mid' ? 'On that signal it trimmed his probability of starting' : 'A mild flag was raised on his availability';
  const es = `${player} ${nat.es}. ${corrEs.charAt(0).toUpperCase() + corrEs.slice(1)}. ${effEs}.`;
  const en = `${player} ${nat.en}. ${corrEn.charAt(0).toUpperCase() + corrEn.slice(1)}. ${effEn}.`;
  return lang === 'es' ? { es } : lang === 'en' ? { en } : { es, en, reason_code: reason };
}

module.exports = { narratePlayer, reasonOf, NATURE };
