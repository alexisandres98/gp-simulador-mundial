// arb-engine/decimal.js — aritmética decimal exacta con BigInt escalado (Sprint 3).
// NUNCA binary float para dinero/precios/tamaños. Escala fija de 8 decimales. Redondeo explícito.
// Representación interna: BigInt = valor × 1e8. La capa de persistencia guarda strings NUMERIC.

'use strict';
const SCALE = 8;
const F = 10n ** BigInt(SCALE); // factor 1e8

// fromStr(s) → BigInt escalado. Acepta string o number (number solo para constantes simples).
function fromStr(s) {
  if (typeof s === 'bigint') return s;
  let str = String(s).trim();
  if (str === '' || str === 'null' || str === 'undefined') return 0n;
  let neg = false;
  if (str[0] === '-') { neg = true; str = str.slice(1); }
  const [intp, fracRaw = ''] = str.split('.');
  const frac = (fracRaw + '0'.repeat(SCALE)).slice(0, SCALE);
  // redondeo del dígito SCALE+1 (half-up) si lo hubiera
  let v = BigInt(intp || '0') * F + BigInt(frac || '0');
  if (fracRaw.length > SCALE && Number(fracRaw[SCALE]) >= 5) v += 1n;
  return neg ? -v : v;
}

// toStr(v, places?) → string decimal. places = decimales a mostrar (default 8, recortando ceros).
function toStr(v, places) {
  const neg = v < 0n; let x = neg ? -v : v;
  let intp = x / F, frac = (x % F).toString().padStart(SCALE, '0');
  if (places != null) {
    // redondeo half-up al número de decimales pedido
    if (places < SCALE) {
      const cut = SCALE - places;
      const factor = 10n ** BigInt(cut);
      let rounded = (x + factor / 2n) / factor; // half-up
      x = rounded * factor;
      intp = x / F; frac = (x % F).toString().padStart(SCALE, '0');
    }
    frac = frac.slice(0, places);
  } else {
    frac = frac.replace(/0+$/, '');
  }
  const s = frac ? `${intp}.${frac}` : `${intp}`;
  return neg && x !== 0n ? '-' + s : s;
}

const add = (a, b) => a + b;
const sub = (a, b) => a - b;
// mul: (a×F)(b×F)=ab×F² → /F con redondeo half-up
function mul(a, b) { const p = a * b; const r = (p + (p < 0n ? -F : F) / 2n) / F; return r; }
// div: (a×F)/(b) escalado → (a×F)/b con redondeo
function div(a, b) { if (b === 0n) throw new Error('div by zero'); const n = a * F; const r = (n + (n < 0n ? -b : b) / 2n) / b; return r; }
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const max = (a, b) => (a > b ? a : b);
const min = (a, b) => (a < b ? a : b);
const isNeg = a => a < 0n;
const isPos = a => a > 0n;
const ZERO = 0n, ONE = F;

module.exports = { SCALE, F, fromStr, toStr, add, sub, mul, div, cmp, max, min, isNeg, isPos, ZERO, ONE };
