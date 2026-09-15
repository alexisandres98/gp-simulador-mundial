// prop-engine/conteo.js — CÓMO SE CUENTA UNA TARJETA (15-sep-2026, T2.1 de la auditoría externa).
//
// Hasta hoy el repo contaba tarjetas en TRES sitios con la misma fórmula implícita —`amarillas + rojas`—
// y nadie había comprobado que fuera la fórmula de la casa. No lo es.
//
// REGLAMENTO DE CLOUDBET, «Booking Markets», copiado literal (fecha de consulta 15-sep-2026; la ficha con
// la URL y la cita completa está en `docs/CONTRATOS_CASA.md`):
//
//   «Yellow card counts as 1 card and red or yellow-red card as 2. The 2nd yellow for one player which
//    leads to a yellow red card is not considered. As a consequence one player cannot cause more than 3
//    cards. Settlement will be made according to all available evidence of cards shown during the regular
//    90 minutes play. Cards shown after the match are not considered. Cards for non-players (already
//    substituted players, managers, players on bench) are not considered.»
//
// O sea: UNA ROJA VALE DOS. Nosotros la contábamos como una. Con 0,1994 rojas por partido sobre 10.436
// partidos de clubes, eso desplaza la media del conteo de 4,4318 a 4,6312 y le quita a la probabilidad de
// under entre 2,24 y 3,35 puntos porcentuales según la línea (`scripts/cards-contrato.js`). En la única
// familia donde hay dinero real, y siempre en la dirección que nos favorece sobre el papel.
//
// LA COMPROBACIÓN EMPÍRICA. De las 113 apuestas de tarjetas que liquidó LA CASA en el libro real, 74 se
// pudieron cruzar con las estadísticas del partido y DOS distinguen entre los dos conteos. Las dos le dan
// la razón al reglamento:
//   · Stoke City–Charlton, under 4,5: 3 amarillas + 1 roja. Nuestro conteo 4 → ganada. Cloudbet: perdida.
//   · Palmeiras–São Paulo, under 6,5: 5 amarillas + 1 roja. Nuestro conteo 6 → ganada. Cloudbet: perdida.
// Dos casos no miden nada por sí solos; lo que miden es que el reglamento se aplica, que es lo que hacía
// falta saber.
//
// LO QUE SIGUE SIN RESOLVERSE, Y HAY QUE DECIRLO. Los agregados de API-Football no distinguen la roja
// directa de la doble amarilla, y en los 12 expulsados del Mundial que sí tienen detalle por jugador el
// feed marca `rc=1, yc=0` SIEMPRE. Si ese es también el criterio de API-Football, entonces para una doble
// amarilla la casa cuenta 3 (la primera amarilla 1 + la amarilla-roja 2) y `amarillas + 2·rojas` cuenta 2:
// nos seguiríamos quedando cortos en uno. La corrección exacta necesita el detalle de eventos
// (API-Football `fixtures/events` distingue «Second Yellow card» de «Red Card»); hasta tenerlo,
// `amarillas + 2·rojas` es un suelo, no la verdad, y el sesgo restante va en nuestra contra.
'use strict';

// Conteo de la casa a partir de los agregados por equipo. `amarillas` y `rojas` son los conteos crudos.
// Es un SUELO del conteo real cuando alguna roja viene de doble amarilla (ver la nota de arriba).
function conteoCasa(amarillas, rojas) {
  return (Number(amarillas) || 0) + 2 * (Number(rojas) || 0);
}

// El conteo histórico del repo, que se conserva para poder comparar tracks viejos y nuevos sin reescribir
// el pasado. NO usar para decidir nada nuevo.
function conteoAntiguo(amarillas, rojas) {
  return (Number(amarillas) || 0) + (Number(rojas) || 0);
}

// Un partido entero desde la forma que traen los datasets (`{ home: {yellows, reds}, away: {...} }`).
function deMatch(m, { casa = true } = {}) {
  if (!m || !m.home || !m.away) return null;
  const am = (Number(m.home.yellows) || 0) + (Number(m.away.yellows) || 0);
  const ro = (Number(m.home.reds) || 0) + (Number(m.away.reds) || 0);
  return casa ? conteoCasa(am, ro) : conteoAntiguo(am, ro);
}

// EL INTERRUPTOR. El liquidador usa el conteo de la casa SIEMPRE: nuestra liquidación tiene que coincidir
// con la que paga el dinero, y eso no cambia ninguna pick — solo deja de mentir el track.
//
// El MODELO es otra cosa: cambiarle el conteo cambia qué picks nacen, y cambiar la regla a mitad de
// ventana destruye la muestra (la disciplina que ya costó una autopsia en agosto). Por eso el modelo sigue
// con el conteo antiguo hasta que `cards_under_v2` esté preregistrada, y se enciende con
// GP_CARDS_CONTEO_CASA=1.
const modeloUsaConteoCasa = () => /^(1|true|on|yes)$/i.test(String(process.env.GP_CARDS_CONTEO_CASA || ''));

module.exports = { conteoCasa, conteoAntiguo, deMatch, modeloUsaConteoCasa };
