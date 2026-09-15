// lib/fuente.js — EL ESTADO DE UNA FUENTE, CON LA SEMÁNTICA CORREGIDA (15-sep)
//
// POR QUÉ EXISTE (auditoría externa, T1.14). Hasta hoy los proveedores devolvían `available: true` en cuanto
// la llamada no reventaba, aunque trajera CERO filas. Consecuencia medida el 15-sep: Pinnacle contesta
// HTTP 200 con `[]` en tenis de mesa (deporte 32) y en dardos (deporte 10), y las sondas publicaban
// `pinnacle: true` — una fuente muerta pintada de viva. Eso no es un detalle de presentación: es lo que hace
// que nadie mire un canal que lleva días sin traer un solo precio.
//
// LA REGLA: `available` solo es true si la llamada RESPONDIÓ **Y** trajo al menos una fila utilizable.
// Y cuando no lo es, hay que decir POR QUÉ, porque las tres causas se arreglan de formas distintas:
//   · `no_configurada` — falta la credencial (Cloudbet sin CLOUDBET_API_KEY). No es un fallo: es un hueco.
//   · `error_red`      — la llamada no respondió, respondió mal o el proveedor devolvió algo que no se puede
//                        leer. Se reintenta, se mira el código HTTP.
//   · `sin_eventos`    — la llamada respondió bien y el proveedor NO PUBLICA NADA. No hay nada que arreglar
//                        en el código; o el deporte está fuera de temporada o esa casa lo dejó de cubrir.
//   · `viva`           — respondió y trajo filas.
// La diferencia entre `error_red` y `sin_eventos` es la que costó la confusión: las dos dan cero filas y solo
// una es un problema nuestro.
'use strict';

const ESTADOS = { VIVA: 'viva', SIN_EVENTOS: 'sin_eventos', ERROR_RED: 'error_red', NO_CONFIGURADA: 'no_configurada' };

// `respondio` es lo que sabe el que llamó: ¿la petición trajo una estructura leíble? `filas` es lo que de
// verdad se pudo usar (eventos, mercados, outrights… lo que esa fuente produce).
function estado({ respondio = false, filas = 0, configurada = true } = {}) {
  if (!configurada) return ESTADOS.NO_CONFIGURADA;
  if (!respondio) return ESTADOS.ERROR_RED;
  return (+filas > 0) ? ESTADOS.VIVA : ESTADOS.SIN_EVENTOS;
}

// Sella un objeto de respuesta de proveedor con `estado`, `available` y `filas`. Se devuelve el MISMO objeto
// para poder escribir `return marcar({ book: 'pinnacle', events }, { respondio: true, filas: events.length })`.
function marcar(obj, opts) {
  const e = estado(opts);
  obj.estado = e;
  obj.available = e === ESTADOS.VIVA;
  obj.filas = +(opts && opts.filas) || 0;
  obj.at = new Date().toISOString();
  return obj;
}

// Para las fuentes que no declaran estado (adaptadores viejos o de terceros): se deduce de lo que trajeron.
// Si el objeto es null/undefined la llamada no respondió; si trae `available: false` explícito, se respeta.
function deducir(r, filas) {
  if (!r) return ESTADOS.ERROR_RED;
  if (r.estado) return r.estado;
  const n = filas != null ? filas : (Array.isArray(r.events) ? r.events.length : 0);
  if (r.available === false) return n > 0 ? ESTADOS.VIVA : ESTADOS.ERROR_RED;
  return n > 0 ? ESTADOS.VIVA : ESTADOS.SIN_EVENTOS;
}

// Frase corta para la sonda: qué significa cada estado sin tener que ir al código.
const POR_QUE = {
  viva: 'respondió y trajo filas',
  sin_eventos: 'respondió bien pero el proveedor no publica nada ahora mismo',
  error_red: 'la llamada no respondió o devolvió algo ilegible',
  no_configurada: 'falta la credencial de esta fuente',
};

module.exports = { ESTADOS, estado, marcar, deducir, POR_QUE };
