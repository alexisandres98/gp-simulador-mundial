// lib/secp256k1.js — FIRMA ECDSA DE ETHEREUM, SIN DEPENDENCIAS (13-sep-2026)
//
// POR QUÉ EXISTE. Para colocar una orden en Polymarket hay que firmar un mensaje EIP-712 con la clave de
// la wallet, y eso es ECDSA sobre secp256k1 con identificador de recuperación. Node trae ECDSA y trae la
// curva, pero NO da el identificador de recuperación (el byte `v`), que es justo lo que Ethereum necesita
// para reconstruir quién firmó. Sin `v` la firma tiene 64 bytes y la casa la rechaza; con el `v` mal, la
// casa recupera OTRA dirección y rechaza igual. Así que la curva se implementa entera aquí.
//
// LAS TRES COSAS QUE SE HACEN BIEN A PROPÓSITO, PORQUE SON LAS QUE MUERDEN:
//
//   1. `k` DETERMINISTA (RFC 6979). Un ECDSA con `k` aleatorio es correcto si el azar es bueno, y expone
//      la clave privada entera si se repite un `k` entre dos firmas. Con RFC 6979 el `k` sale de HMAC
//      sobre la clave y el mensaje: nunca se repite para mensajes distintos, y además la firma es
//      REPRODUCIBLE, que es lo que permite probarla contra vectores en vez de confiar en ella.
//
//   2. `s` BAJA. Para cada firma válida (r, s) existe otra igual de válida (r, n−s). Ethereum solo acepta
//      la mitad baja para que una firma no se pueda mutar y seguir siendo válida. Si `s` sale alta se
//      cambia por n−s Y SE INVIERTE el bit de recuperación — olvidar lo segundo es el error clásico: la
//      firma pasa la validación de forma pero recupera la dirección equivocada la mitad de las veces.
//
//   3. TIEMPO NO CONSTANTE, Y SE DICE. La multiplicación escalar de aquí es doble-y-suma sencilla, así que
//      su tiempo depende de los bits de la clave. En un servidor compartido con atacantes midiendo eso
//      sería un problema real; aquí la clave vive sola en un relay de Helsinki que no sirve a nadie más y
//      firma dos órdenes por hora. Se deja escrito para que nadie lo reutilice en otro sitio dando por
//      hecho que es seguro contra ataques de tiempo, porque no lo es.
'use strict';

const crypto = require('crypto');
const { keccak256 } = require('./keccak');

// La curva, de su especificación
const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

const mod = (a, m) => ((a % m) + m) % m;
// inverso modular por exponenciación: p es primo, así que a^(p−2) ≡ a⁻¹
function invMod(a, m) {
  a = mod(a, m);
  if (a === 0n) throw new Error('sin inverso de 0');
  let [g, x, r, y] = [a, 1n, m, 0n];
  while (r !== 0n) { const q = g / r; [g, x, r, y] = [r, y, g - q * r, x - q * y]; }
  return mod(x, m);
}

// Puntos en coordenadas afines. `null` es el punto en el infinito.
function suma(p1, p2) {
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1.x === p2.x) {
    if (mod(p1.y + p2.y, P) === 0n) return null;          // P + (−P) = ∞
    return duplica(p1);
  }
  const l = mod((p2.y - p1.y) * invMod(p2.x - p1.x, P), P);
  const x = mod(l * l - p1.x - p2.x, P);
  return { x, y: mod(l * (p1.x - x) - p1.y, P) };
}
function duplica(p) {
  if (!p || p.y === 0n) return null;
  const l = mod(3n * p.x * p.x * invMod(2n * p.y, P), P);   // a = 0 en secp256k1
  const x = mod(l * l - 2n * p.x, P);
  return { x, y: mod(l * (p.x - x) - p.y, P) };
}
function porEscalar(k, p = { x: Gx, y: Gy }) {
  k = mod(k, N);
  let r = null, base = p;
  while (k > 0n) {
    if (k & 1n) r = suma(r, base);
    base = duplica(base);
    k >>= 1n;
  }
  return r;
}

const hexABig = (h) => BigInt('0x' + String(h).replace(/^0x/i, ''));
const bigAHex = (b, bytes = 32) => b.toString(16).padStart(bytes * 2, '0');
const bufABig = (b) => (b.length ? BigInt('0x' + b.toString('hex')) : 0n);
const bigABuf = (b, bytes = 32) => Buffer.from(bigAHex(b, bytes), 'hex');

// ── CLAVE PÚBLICA Y DIRECCIÓN ───────────────────────────────────────────────────────────────────────────
// La dirección de Ethereum son los 20 últimos bytes del keccak de la pública SIN el byte 0x04 de prefijo.
// Olvidar quitar ese byte da una dirección plausible y equivocada, y es la prueba que más rápido lo caza.
function publicaDe(priv) {
  const d = typeof priv === 'bigint' ? priv : hexABig(priv);
  if (!(d > 0n && d < N)) throw new Error('clave privada fuera de rango');
  const Q = porEscalar(d);
  return { x: Q.x, y: Q.y };
}
function direccionDe(priv) {
  const Q = publicaDe(priv);
  const sinPrefijo = Buffer.concat([bigABuf(Q.x), bigABuf(Q.y)]);   // 64 bytes, sin el 0x04
  return '0x' + keccak256(sinPrefijo).slice(12).toString('hex');
}

// ── RFC 6979: el `k` determinista ───────────────────────────────────────────────────────────────────────
function kDeterminista(priv, h1) {
  const x = bigABuf(priv);
  let V = Buffer.alloc(32, 0x01);
  let K = Buffer.alloc(32, 0x00);
  const hmac = (clave, ...partes) => { const m = crypto.createHmac('sha256', clave); for (const p of partes) m.update(p); return m.digest(); };
  K = hmac(K, V, Buffer.from([0x00]), x, h1);
  V = hmac(K, V);
  K = hmac(K, V, Buffer.from([0x01]), x, h1);
  V = hmac(K, V);
  for (;;) {
    V = hmac(K, V);
    const k = bufABig(V);
    if (k > 0n && k < N) return k;
    K = hmac(K, V, Buffer.from([0x00]));
    V = hmac(K, V);
  }
}

// ── FIRMAR ──────────────────────────────────────────────────────────────────────────────────────────────
// Entra un HASH de 32 bytes (ya calculado: aquí NO se vuelve a hashear nada) y sale { r, s, v } con v en
// 27/28, que es la convención que espera Ethereum, más la firma en 65 bytes lista para enviar.
function firmar(hash32, priv) {
  const h = Buffer.isBuffer(hash32) ? hash32 : Buffer.from(String(hash32).replace(/^0x/i, ''), 'hex');
  if (h.length !== 32) throw new Error('el hash debe tener 32 bytes');
  const d = typeof priv === 'bigint' ? priv : hexABig(priv);
  if (!(d > 0n && d < N)) throw new Error('clave privada fuera de rango');
  const z = bufABig(h) % N;

  let k = kDeterminista(d, h);
  for (let intento = 0; intento < 64; intento++) {
    const R = porEscalar(k);
    const r = mod(R.x, N);
    if (r !== 0n) {
      let s = mod(invMod(k, N) * (z + r * d), N);
      if (s !== 0n) {
        // el bit de recuperación ANTES de normalizar: paridad de R.y, más 2 si R.x dio la vuelta a n
        let rec = (R.y & 1n ? 1 : 0) | (R.x >= N ? 2 : 0);
        if (s > N / 2n) { s = N - s; rec ^= 1; }            // `s` baja: invertir el bit es obligatorio
        return {
          r, s, v: 27 + rec, rec,
          hex: '0x' + bigAHex(r) + bigAHex(s) + (27 + rec).toString(16).padStart(2, '0'),
        };
      }
    }
    k = mod(k + 1n, N);                                     // prácticamente inalcanzable
  }
  throw new Error('no se pudo firmar');
}

// ── RECUPERAR ───────────────────────────────────────────────────────────────────────────────────────────
// De (hash, r, s, rec) sale la dirección que firmó. No hace falta para colocar, pero es LA prueba de que
// la firma es la correcta: si la dirección recuperada no es la nuestra, la casa tampoco nos va a reconocer.
// Se usa en el test y en el arranque del ejecutor, antes de enviar nada.
function recuperar(hash32, r, s, rec) {
  const h = Buffer.isBuffer(hash32) ? hash32 : Buffer.from(String(hash32).replace(/^0x/i, ''), 'hex');
  const z = bufABig(h) % N;
  const x = r + (rec >= 2 ? N : 0n);
  if (x >= P) return null;
  // y² = x³ + 7  →  y = (x³+7)^((p+1)/4) mod p
  const y2 = mod(x * x % P * x + 7n, P);
  let y = modPow(y2, (P + 1n) / 4n, P);
  if (mod(y, 2n) !== BigInt(rec & 1)) y = mod(P - y, P);
  if (mod(y * y, P) !== y2) return null;                    // r no estaba en la curva
  const R = { x, y };
  const rInv = invMod(r, N);
  // Q = r⁻¹ (sR − zG)
  const Q = suma(porEscalar(mod(s * rInv, N), R), porEscalar(mod(N - mod(z * rInv, N), N)));
  if (!Q) return null;
  const sinPrefijo = Buffer.concat([bigABuf(Q.x), bigABuf(Q.y)]);
  return '0x' + keccak256(sinPrefijo).slice(12).toString('hex');
}
function modPow(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }

module.exports = { P, N, publicaDe, direccionDe, firmar, recuperar, porEscalar, suma, duplica, invMod, kDeterminista,
  _util: { hexABig, bigAHex, bufABig, bigABuf } };
