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
  { category: 'BACK', severity: 0, kws: ['returns to training', 'back in training', 'declared fit', 'passed fit', 'fit to play', 'cleared to play', 'available to face', 'available for', 'no sera sancionado', 'sin sancion', 'podra jugar', 'recovered', 'recuperado', 'vuelve a entrenar', 'se entreno con normalidad', 'esta para jugar', 'llega al partido', 'alta medica', 'queda habilitado'] },
  { category: 'CONFIRMED', severity: 0, kws: ['starting xi', 'starting lineup confirmed', 'confirmed lineup', 'will start', 'titular confirmado', 'once confirmado', 'sera titular', 'de arranque'] },
  { category: 'OUT', severity: 0.9, kws: ['ruled out', 'out of the match', 'out for the', 'will miss', 'misses the', 'sidelined', 'out injured', 'baja confirmada', 'es baja', 'se pierde el', 'fuera del partido', 'descartado', 'no jugara', 'no estara ante', 'lesion lo deja fuera'] },
  { category: 'SUSPENDED', severity: 0.95, kws: ['suspended', 'suspension', 'banned', 'accumulation of yellow', 'sancionado', 'suspendido', 'acumulacion de amarillas', 'por sancion'] },
  { category: 'DOUBT', severity: 0.5, kws: ['doubt', 'doubtful', 'fitness test', 'questionable', 'injury concern', 'knock', 'strain', 'discomfort', 'illness', 'unwell', 'fever', 'sick', 'gastro', 'duda', 'entre algodones', 'molestias', 'sobrecarga', 'golpe', 'enfermo', 'fiebre', 'indispuesto', 'malestar', 'no completo el entrenamiento', 'entreno aparte', 'no se entreno'] },
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
  for (const rule of RULES) {
    const kw = rule.kws.find(k => text.includes(norm(k)));
    if (!kw) continue;
    const players = playerMatches((item.title || '') + ' ' + (item.description || ''), roster);
    if (players.length) {
      for (const p of players) signals.push({ category: rule.category, severity: rule.severity, player: p.name, pid: p.pid, team, keyword: kw, title: item.title || '', source: item.source || null, link: item.link || null, published_at: item.published_at || null });
    } else {
      // señal a nivel EQUIPO (sin jugador identificado) — útil igual ("tres jugadores con gripe")
      signals.push({ category: rule.category, severity: rule.severity * 0.5, player: null, pid: null, team, keyword: kw, title: item.title || '', source: item.source || null, link: item.link || null, published_at: item.published_at || null });
    }
    break; // primera categoría que matchea gana (evita OUT+DOUBT del mismo titular)
  }
  return signals;
}

module.exports = { extract, playerMatches, RULES };
