// observer/extract.js — CAPA DE OBSERVACIÓN de jugadores (shadow). Extracción PURA de señales de
// disponibilidad desde titulares/snippets de noticias (beat reporters, Google News, ruedas de prensa).
// Es la alternativa LEGÍTIMA acordada el 4-jul al tracking de redes de familiares (rechazado): solo
// captura lo PUBLICADO. Sin red, sin DB: recibe texto + roster y devuelve señales tipadas.
//
// Categorías (de peor a mejor):
//   OUT        → descartado/lesionado confirmado ("ruled out", "baja", "se pierde el partido")
//   DOUBT      → duda/molestia/enfermedad ("doubt", "duda", "molestias", "enfermo", "fiebre", "indispuesto")
//   SUSPENDED  → sanción/acumulación ("suspended", "sancionado", "acumulación de amarillas")
//   REST_RISK  → rotación/descanso probable ("rested", "rotación", "al banco")
//   BACK       → vuelve/recuperado ("returns", "fit", "recuperado", "vuelve a entrenar")
//   CONFIRMED  → titular confirmado ("starting XI", "titular confirmado")
// Cada señal: { category, player (si matchea el roster), team, severity 0-1, keyword, title, source, published_at }.
'use strict';

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Diccionario bilingüe EN/ES. El orden importa: la PRIMERA categoría que matchea gana. BACK/CONFIRMED van
// PRIMERO porque sus frases suelen convivir con palabras negativas ("no será sancionado y podrá jugar",
// "declared fit after injury scare") y la dirección correcta es la del desenlace, no la del susto.
const RULES = [
  // VOCABULARIO MULTIIDIOMA (26-jul): pt/it/de/fr/nórdicos/pl/ru para las ligas blandas — la prensa local
  // publica horas antes que la global. MISMA regla de precisión del 8-jul: frases con contexto de fitness,
  // jamás palabras peladas. Todo normalizado sin diacríticos (norm() los pela); el cirílico pasa como está.
  { category: 'BACK', severity: 0, kws: ['returns to training', 'back in training', 'declared fit', 'passed fit', 'fit to play', 'cleared to play', 'available to face', 'available for', 'no sera sancionado', 'sin sancion', 'podra jugar', 'recovered', 'recuperado', 'vuelve a entrenar', 'se entreno con normalidad', 'esta para jugar', 'llega al partido', 'alta medica', 'queda habilitado',
    'volta a treinar', 'esta recuperado', 'liberado para jogar', 'wieder im training', 'ist wieder fit', 'de retour a l entrainement', 'apte pour', 'вернулся в строй', 'восстановился', 'torna ad allenarsi', 'recuperato per'] },
  { category: 'CONFIRMED', severity: 0, kws: ['starting xi', 'starting lineup confirmed', 'confirmed lineup', 'will start', 'titular confirmado', 'once confirmado', 'sera titular', 'de arranque'] },
  { category: 'OUT', severity: 0.9, kws: ['ruled out', 'out of the match', 'out for the', 'will miss', 'misses the', 'sidelined', 'out injured', 'baja confirmada', 'es baja', 'se pierde el', 'fuera del partido', 'descartado', 'no jugara', 'no estara ante', 'lesion lo deja fuera',
    'fora do jogo', 'e desfalque', 'desfalque confirmado', 'nao joga contra', 'vai desfalcar', 'cortado do time', 'ei pelaa', 'jaa sivuun', 'mister kampen', 'er ute med skade', 'ute i flere uker', 'missar matchen', 'spelar inte mot', 'borta i flera', 'misser kampen', 'er ude med', 'nie zagra', 'wypada z gry', 'pauzuje przez', 'не сыграет', 'пропустит матч', 'выбыл из-за', 'faellt aus', 'fehlt gegen', 'muss passen', 'forfait pour', 'declare forfait', 'absent contre', 'ne jouera pas', 'salta la partita', 'non ce la fa', 'indisponibile per'] },
  { category: 'SUSPENDED', severity: 0.95, kws: ['suspended', 'suspension', 'banned', 'accumulation of yellow', 'sancionado', 'suspendido', 'acumulacion de amarillas', 'por sancion',
    'esta suspenso', 'suspenso por', 'utestengt', 'avstangd', 'i karantaene', 'zawieszony', 'za kartki', 'дисквалифицирован', 'дисквалификация', 'gesperrt', 'suspendu pour', 'squalificato'] },
  // Precisión (8-jul, auditoría): keywords sueltas daban falsos positivos REALES en titulares del día —
  // 'duda' matcheaba "SIN DUDA es uno de mis juegos favoritos" (Kane), 'knock' matcheaba "knock Portugal
  // OUT" (eliminación, Merino), 'golpe' matcheaba "GOLPE para Inglaterra" (metáfora). Frases con contexto
  // de fitness, nunca la palabra pelada.
  { category: 'DOUBT', severity: 0.5, kws: ['in doubt', 'a doubt', 'doubt over', 'major doubt', 'fitness doubt', 'doubtful', 'fitness test', 'questionable', 'injury concern', 'a knock', 'knock in training', 'picked up a knock', 'strain', 'discomfort', 'illness', 'unwell', 'fever', 'gastro', 'en duda', 'es duda', 'duda para', 'duda ante', 'sigue en duda', 'mantiene en duda', 'entre algodones', 'molestias', 'sobrecarga', 'golpe en el', 'golpe en la', 'recibio un golpe', 'enfermo', 'fiebre', 'indispuesto', 'malestar', 'no completo el entrenamiento', 'entreno aparte', 'no se entreno',
    'e duvida', 'virou duvida', 'sente dores', 'nao treinou', 'ei harjoitellut', 'usikker til', 'er tvilsom', 'trente ikke', 'osaker till', 'tveksam till', 'tranade inte', 'tvivlsom til', 'traenede ikke', 'niepewny gry', 'nie trenowal', 'под вопросом', 'не тренировался', 'fraglich fur', 'einsatz fraglich', 'angeschlagen', 'trainierte nicht', 'incertain pour', 'touche a la cuisse', 'in dubbio per', 'non si e allenato'] },
  { category: 'REST_RISK', severity: 0.3, kws: ['rested', 'set to rotate', 'rotation', 'could be benched', 'start on the bench', 'rotacion', 'descanso para', 'iria al banco', 'seria suplente', 'dosificar'] },
];

// roster: [{ pid, name }] — matcheo por nombre completo o apellido (con límites de palabra).
// El contexto es POR EQUIPO (la query de noticias ya es del equipo) → el apellido alcanza.
function playerMatches(text, roster) {
  const t = ' ' + norm(text).replace(/[^a-z0-9]+/g, ' ') + ' ';
  const hits = [];
  for (const p of roster || []) {
    const full = norm(p.name).replace(/[^a-z0-9]+/g, ' ').trim();
    const last = full.split(' ').pop();
    if (!last || last.length < 3) continue;
    if (t.includes(' ' + full + ' ') || t.includes(' ' + last + ' ')) hits.push(p);
  }
  return hits;
}

// Extrae señales de UN item de noticia para UN equipo.
function extract(item, { team, roster } = {}) {
  const text = norm((item.title || '') + ' ' + (item.description || ''));
  const signals = [];
  // Titular INTERROGATIVO = especulación ("¿Haaland no jugará?"), no confirmación → OUT/SUSPENDED degradan a DOUBT.
  const interrogative = /^\s*¿/.test(String(item.title || '')) || /\?\s*$/.test(String(item.title || '').replace(/\s*-\s*[^-]*$/, ''));
  for (const rule of RULES) {
    const kw = rule.kws.find(k => text.includes(norm(k)));
    if (!kw) continue;
    // Guard de contexto ARBITRAL (8-jul): "por qué estuvo bien SANCIONADO el penal" marcaba SUSPENDED a
    // Messi. Si la sanción convive con lenguaje de jugada/árbitro y NO hay lenguaje de castigo por partidos,
    // no es una suspensión de jugador → probar la siguiente regla.
    if (rule.category === 'SUSPENDED' && /\b(penal|penalti|var|arbitr|falta|jugada)\b/.test(text)
      && !/partidos? de (sancion|suspension)|sancionado (con|por) (un|dos|tres|\d)|acumulacion de amarillas|banned for|se pierde/.test(text)) continue;
    let category = rule.category, severity = rule.severity;
    if (interrogative && (category === 'OUT' || category === 'SUSPENDED')) { category = 'DOUBT'; severity = 0.5; }
    const players = playerMatches((item.title || '') + ' ' + (item.description || ''), roster);
    if (players.length) {
      for (const p of players) signals.push({ category, severity, player: p.name, pid: p.pid, team, keyword: kw, title: item.title || '', source: item.source || null, link: item.link || null, published_at: item.published_at || null });
    } else {
      // señal a nivel EQUIPO (sin jugador identificado) — útil igual ("tres jugadores con gripe")
      signals.push({ category, severity: severity * 0.5, player: null, pid: null, team, keyword: kw, title: item.title || '', source: item.source || null, link: item.link || null, published_at: item.published_at || null });
    }
    break; // primera categoría que matchea gana (evita OUT+DOUBT del mismo titular)
  }
  return signals;
}

module.exports = { extract, playerMatches, RULES };
