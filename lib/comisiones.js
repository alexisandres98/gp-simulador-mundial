// lib/comisiones.js — LO QUE COBRA LA CASA POR CRUZAR, FILL A FILL (15-sep-2026, hallazgo A09)
//
// ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────────────────────────
// La sombra de Polymarket y el ejecutor real anotaban el P&L de cada posición como `shares − costo`: el
// pago íntegro del contrato menos lo que costaron las acciones. Eso es lo que se cobra en un mundo sin
// casa. Polymarket cobra al TAKER en cada cruce, y nuestra sombra cruza siempre —camina los asks del libro
// hasta llenar la orden—, así que todo lo que reportaba estaba inflado por una comisión que nunca restó.
//
// El error no es de decimales. La comisión de Polymarket es máxima justo donde más operamos (precio 0,50) y
// se paga sobre el NOCIONAL, no sobre el beneficio: a tasa 0,05 y precio 0,50 son 2,5 % de lo apostado, que
// es más que el ROI de la mitad de las familias del tablero. Una ventaja del 2 % contra una comisión del
// 2,5 % no es una ventaja pequeña: es una pérdida.
//
// ── LA FÓRMULA, LEÍDA DE LA CASA Y NO SUPUESTA ──────────────────────────────────────────────────────────
//     fee = C × tasa × (p × (1 − p)) ^ exponente          C = acciones, p = precio de la acción
// Verificada el 15-sep-2026 contra dos fuentes independientes (ver `docs/CONTRATOS_CASA.md`): la
// documentación pública y el propio objeto `feeSchedule` que gamma publica POR MERCADO, que hoy devuelve
// `{exponent: 1, rate: 0.03, takerOnly: true, rebateRate: 0.25}` en los binarios de partido de fútbol que
// usa la sombra. El exponente vive aquí porque la casa lo publica: si mañana deja de ser 1, la curva entera
// cambia de forma y no se arregla tocando la tasa.
//
// Tres consecuencias que hay que tener presentes al leer un número que salga de aquí:
//   1. SOLO EL TAKER PAGA (`takerOnly`). Nuestra sombra y nuestro ejecutor son takers siempre: la sombra
//      por construcción (camina asks) y el ejecutor porque coloca al límite del consenso menos un céntimo.
//      El día que se coloque para reposar en el libro, esto deja de aplicar y hay que medirlo aparte.
//   2. LA COMISIÓN SE PAGA AL ENTRAR, NO AL LIQUIDAR. La fórmula vale 0 en p=0 y p=1, así que el contrato
//      que vence no vuelve a cobrar. Por eso se resta una sola vez, en el fill.
//   3. LA TASA ES POR MERCADO, NO GLOBAL. Por eso `tasa` entra como argumento y el valor por defecto es
//      solo el último recurso: cuando el mercado publica la suya, manda la suya.
//
// ── POR QUÉ EL DEFECTO ES EL DOCUMENTADO Y NO EL MEDIDO ─────────────────────────────────────────────────
// Medimos 0,03 en los mercados de partido y la documentación dice 0,05 para la categoría Sports. Son
// números de la misma casa el mismo día y no coinciden, así que uno de los dos es el que aplica y no
// sabemos cuál aplicará mañana. Para una puerta que decide si sale dinero, el defecto es el PEOR de los dos
// creíbles: sobrestimar la comisión descarta alguna apuesta buena, subestimarla aprueba apuestas malas, y
// solo el segundo error cuesta dinero. `GP_PM_FEE_RATE` lo cambia sin tocar código.
'use strict';

// Tasas por categoría tal y como las publica la documentación (consulta del 15-sep-2026). Están aquí como
// REFERENCIA de lectura, no como tabla de decisión: el código no adivina la categoría de un mercado.
const TASAS_DOCUMENTADAS = Object.freeze({
  crypto: 0.07, sports: 0.05, economics: 0.05, culture: 0.05, weather: 0.05, other: 0.05,
  finance: 0.04, politics: 0.04, tech: 0.04, mentions: 0.04, geopolitics: 0,
});

const TASA_DEFECTO = 0.05;          // Sports documentado; ver el bloque de arriba
const EXPONENTE_DEFECTO = 1;        // lo que publica hoy `feeSchedule.exponent`
const MINIMA_COBRADA = 0.00001;     // "The smallest fee charged is 0.00001 USDC"
const DECIMALES = 5;                // "Fees are rounded to 5 decimal places"

function tasaPorDefecto() {
  const v = Number(process.env.GP_PM_FEE_RATE);
  return Number.isFinite(v) && v >= 0 ? v : TASA_DEFECTO;
}
function exponentePorDefecto() {
  const v = Number(process.env.GP_PM_FEE_EXP);
  return Number.isFinite(v) && v > 0 ? v : EXPONENTE_DEFECTO;
}

// La comisión de UNA acción al precio p. Es la unidad con la que se compara una ventaja: nuestra ventaja
// también se declara por acción (consenso − precio), así que restarlas entre sí sí tiene sentido.
function comisionPorShare(precio, tasa, exponente) {
  const p = Number(precio);
  if (!(p > 0 && p < 1)) return 0;                       // en 0 y en 1 la fórmula vale 0 por construcción
  const t = Number.isFinite(Number(tasa)) && Number(tasa) >= 0 ? Number(tasa) : tasaPorDefecto();
  const e = Number.isFinite(Number(exponente)) && Number(exponente) > 0 ? Number(exponente) : exponentePorDefecto();
  return t * Math.pow(p * (1 - p), e);
}

// La comisión de un FILL entero. Se redondea como la redondea la casa, y un importe positivo por debajo de
// su mínimo se sube al mínimo en vez de desaparecer: un cero falso es justo lo que este módulo viene a
// corregir, aunque aquí sean céntimas.
function comisionPolymarket({ shares, precio, tasa, exponente } = {}) {
  const c = Number(shares);
  if (!(c > 0)) return 0;
  const bruta = c * comisionPorShare(precio, tasa, exponente);
  if (!(bruta > 0)) return 0;
  const red = +bruta.toFixed(DECIMALES);
  return red > 0 ? red : MINIMA_COBRADA;
}

// EL LISTÓN, EN UNA LÍNEA: la ventaja declarada por acción menos lo que la casa cobra por esa acción. Una
// señal con ventaja bruta positiva pero menor que la comisión NO es una oportunidad; es una pérdida con
// buena pinta, y hasta hoy generaba orden.
function evNetoPorShare({ prob, precio, tasa, exponente } = {}) {
  const p = Number(prob), x = Number(precio);
  if (!(p >= 0 && p <= 1) || !(x > 0 && x < 1)) return null;
  return p - x - comisionPorShare(x, tasa, exponente);
}

// La tasa que publica el propio mercado, cuando la tenemos guardada. Acepta el objeto `feeSchedule` de
// gamma tal cual llega, para que nadie tenga que acordarse de los nombres de sus campos.
function deFeeSchedule(fs) {
  if (!fs || typeof fs !== 'object') return null;
  const t = Number(fs.rate), e = Number(fs.exponent);
  if (!Number.isFinite(t) || t < 0) return null;
  return { tasa: t, exponente: Number.isFinite(e) && e > 0 ? e : EXPONENTE_DEFECTO,
    solo_taker: fs.takerOnly !== false };
}

module.exports = { comisionPolymarket, comisionPorShare, evNetoPorShare, deFeeSchedule,
  tasaPorDefecto, exponentePorDefecto, TASAS_DOCUMENTADAS, TASA_DEFECTO, EXPONENTE_DEFECTO };
