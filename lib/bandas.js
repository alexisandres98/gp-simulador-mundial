'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// BANDAS DE EFICIENCIA POR LIGA — la decisión pura, sin base ni red, para poder auditarla.
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Una liga vive en una de tres bandas según cuánto "sabe" su mercado (Brier del consenso sobre los eventos
// liquidados): 'eficiente' (< 0,230), 'intermedia', 'blanda' (> 0,260). La estrategia depende de la banda —
// en eficientes no se publica edge propio, en blandas no se ancla— y el ejecutor real no entra en la
// eficiente, así que un cambio de banda mueve picks y dinero.
//
// EL FALLO QUE ESTO CORRIGE (5-sep, orden de Alexis: "no esperes el domingo, arregla lo del margen"). La
// histéresis de 0,005 protegía SOLO la banda del prior: una liga con prior 'eficiente' aguantaba hasta
// 0,235 antes de caer, pero una con prior 'intermedia' que la medición había subido a 'eficiente' volvía a
// bajar en cuanto el Brier tocaba 0,2300. MLS estaba justo ahí (0,2292 acumulado): un mal fin de semana la
// devolvía a intermedia —abriendo cards-under y el dinero real— y el siguiente la sacaba otra vez. La banda
// no puede depender de dónde NACIÓ la liga, sino de dónde ESTÁ.
//
// Ahora el margen protege la banda ACTUAL, sea cual sea: para salir de una banda el Brier tiene que cruzar
// el umbral con 0,005 de margen. De intermedia a eficiente hace falta < 0,225; de eficiente a intermedia,
// > 0,235; de intermedia a blanda, > 0,265; de blanda a intermedia, < 0,255. Con eso ninguna liga oscila.
//
// La memoria de "dónde está" vive en db.leagueBand (server.js). La PRIMERA evaluación de una liga medida se
// siembra con la regla antigua, para que el despliegue no cambie ninguna banda de hoy: el cambio es de
// comportamiento futuro, no de estado presente.
const UMBRAL_EFICIENTE = 0.230;
const UMBRAL_BLANDA = 0.260;
const MARGEN = 0.005;
const N_MIN = 40;

// La regla ANTIGUA (26-jul → 5-sep). Se conserva solo para sembrar la memoria la primera vez.
function bandaLegacy(brier, prior) {
  return brier < UMBRAL_EFICIENTE ? 'eficiente'
    : brier > UMBRAL_BLANDA ? 'blanda'
    : brier < UMBRAL_EFICIENTE + MARGEN && prior === 'eficiente' ? 'eficiente'
    : brier > UMBRAL_BLANDA - MARGEN && prior === 'blanda' ? 'blanda'
    : 'intermedia';
}

// La regla NUEVA: el margen protege la banda actual.
function bandaConMargen(brier, actual, margen = MARGEN) {
  if (!Number.isFinite(brier)) return actual || 'intermedia';
  const a = actual || 'intermedia';
  if (a === 'eficiente') {
    // solo se cae de eficiente si el Brier se aleja del umbral por arriba con margen
    if (brier > UMBRAL_BLANDA + margen) return 'blanda';
    return brier > UMBRAL_EFICIENTE + margen ? 'intermedia' : 'eficiente';
  }
  if (a === 'blanda') {
    if (brier < UMBRAL_EFICIENTE - margen) return 'eficiente';
    return brier < UMBRAL_BLANDA - margen ? 'intermedia' : 'blanda';
  }
  // intermedia: hace falta cruzar CON margen hacia cualquiera de los dos lados
  if (brier < UMBRAL_EFICIENTE - margen) return 'eficiente';
  if (brier > UMBRAL_BLANDA + margen) return 'blanda';
  return 'intermedia';
}

// Un paso completo de evaluación. `memoria` es la ficha guardada de la liga ({ band, brier, n, at,
// cambios }) o null si nunca se evaluó con muestra. Devuelve la ficha nueva y si hubo cambio.
function evaluarBanda({ brier, n, prior, memoria }) {
  if (!(n >= N_MIN) || !Number.isFinite(brier)) {
    // sin muestra manda el prior; la memoria (si la hubiera de una época con muestra) no se toca
    return { band: prior, source: 'prior', cambio: false, memoria: memoria || null };
  }
  const actual = memoria && memoria.band ? memoria.band : null;
  const band = actual ? bandaConMargen(brier, actual) : bandaLegacy(brier, prior);
  const cambio = !!actual && band !== actual;
  const ficha = {
    band, brier: +brier.toFixed(4), n, at: new Date().toISOString(),
    prior, sembrada: actual ? (memoria.sembrada || false) : true,
    cambios: (memoria && Array.isArray(memoria.cambios) ? memoria.cambios : []).slice(-10),
  };
  if (cambio) ficha.cambios = ficha.cambios.concat([{ de: actual, a: band, brier: ficha.brier, n, at: ficha.at }]).slice(-10);
  return { band, source: 'measured', cambio, memoria: ficha };
}

module.exports = { UMBRAL_EFICIENTE, UMBRAL_BLANDA, MARGEN, N_MIN, bandaLegacy, bandaConMargen, evaluarBanda };
