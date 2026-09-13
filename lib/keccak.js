// lib/keccak.js — KECCAK-256, EL DE ETHEREUM (13-sep-2026)
//
// POR QUÉ ESTÁ ESCRITO A MANO Y NO SE USA `crypto`. Node trae `sha3-256`, y NO es lo mismo: el SHA3 que
// estandarizó el NIST le añade los bits `01` al mensaje antes del relleno, y Keccak original no. Cambia un
// byte del relleno y cambia el hash entero. Ethereum se quedó con el Keccak ORIGINAL porque es anterior al
// estándar, así que `crypto.createHash('sha3-256')` devuelve un hash perfectamente válido... de otra
// función. Firmar con él daría firmas bien formadas que ninguna cadena acepta, y el error no se ve: no
// falla nada, simplemente la casa rechaza todas las órdenes sin decir por qué.
//
// POR QUÉ NO SE INSTALA UNA LIBRERÍA. La regla dura del proyecto es cero dependencias npm (hay una, `pg`,
// y nada más). Meter `ethers` o `keccak` aquí arrastraría cientos de paquetes transitivos al servicio que
// sirve la plataforma entera a ~966 usuarios. Esto son 90 líneas y se puede comprobar contra vectores
// públicos, que es exactamente lo que hace `tests/cripto.test.js`.
//
// La implementación es la esponja Keccak-f[1600] estándar: 24 rondas de θ, ρ, π, χ, ι sobre un estado de
// 25 palabras de 64 bits. Se usa BigInt para las palabras: es más lento que partirlas en dos mitades de 32
// bits, pero aquí se hashean decenas de bytes unas pocas veces por minuto, y la versión legible es la que
// se puede auditar. Optimizar criptografía que nadie puede leer es como se cuelan los fallos.
'use strict';

const MASCARA = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << n) | (x >> (64n - n))) & MASCARA;

// Constantes de ronda ι y desplazamientos ρ: son de la especificación, no se calculan al vuelo para que
// se puedan comparar de un vistazo contra el documento original.
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// ρ y π SE DERIVAN DE LA ESPECIFICACIÓN, NO SE COPIAN. Escribí las dos tablas de memoria y el hash no
// casaba con ningún vector público: había confundido la tabla de 24 posiciones del recorrido encadenado
// (la de las implementaciones en C) con una tabla por índice, que es otra cosa. Derivarlas de su
// definición cuesta diez líneas y elimina la clase entera de error — una constante mal copiada en
// criptografía no da error, da un hash perfectamente válido de otra función.
//
//   ρ: se recorre (x,y) empezando en (1,0) con (x,y) ← (y, (2x+3y) mod 5), y en el paso t el
//      desplazamiento es (t+1)(t+2)/2 mod 64. La palabra central (0,0) no rota.
//   π: A′[x,y] = A[(x+3y) mod 5, x]  (FIPS 202). Se implementa como RECOGIDA —cada destino dice de dónde
//      viene— en vez de como reparto, porque así no hay dos orígenes que puedan pisar el mismo destino.
const ROT = (() => {
  const r = new Array(25).fill(0n);
  let x = 1, y = 0;
  for (let t = 0; t < 24; t++) {
    r[x + 5 * y] = BigInt((((t + 1) * (t + 2)) / 2) % 64);
    [x, y] = [y, (2 * x + 3 * y) % 5];
  }
  return r;
})();
// DE_DONDE[destino] = origen, con índice = x + 5y
const DE_DONDE = (() => {
  const p = new Array(25);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) p[x + 5 * y] = ((x + 3 * y) % 5) + 5 * x;
  return p;
})();

function keccakF(A) {
  for (let ronda = 0; ronda < 24; ronda++) {
    // θ: cada columna se mezcla con las dos columnas vecinas
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= D;
    }
    // ρ y π: cada destino recoge su palabra de origen, ya rotada
    const B = new Array(25);
    for (let i = 0; i < 25; i++) { const o = DE_DONDE[i]; B[i] = rotl(A[o], ROT[o]); }
    // χ: la única parte no lineal
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) A[x + y] = B[x + y] ^ ((~B[((x + 1) % 5) + y] & MASCARA) & B[((x + 2) % 5) + y]);
    }
    // ι
    A[0] ^= RC[ronda];
  }
  return A;
}

// keccak256(Buffer|Uint8Array|string) → Buffer de 32 bytes.
// Tasa de absorción para 256 bits de salida: 1088 bits = 136 bytes. Relleno `0x01 … 0x80` — ESTE es el
// byte que lo diferencia de SHA3-256, que usa `0x06`.
function keccak256(entrada) {
  const msg = Buffer.isBuffer(entrada) ? entrada
    : (typeof entrada === 'string' ? Buffer.from(entrada, 'utf8') : Buffer.from(entrada));
  const TASA = 136;
  const relleno = TASA - (msg.length % TASA);
  const buf = Buffer.concat([msg, Buffer.alloc(relleno)]);
  buf[msg.length] |= 0x01;                       // Keccak original (SHA3 pondría 0x06 aquí)
  buf[buf.length - 1] |= 0x80;

  let A = new Array(25).fill(0n);
  for (let off = 0; off < buf.length; off += TASA) {
    for (let i = 0; i < TASA / 8; i++) A[i] ^= buf.readBigUInt64LE(off + i * 8);
    A = keccakF(A);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i], i * 8);
  return out;
}

const keccak256Hex = (x) => '0x' + keccak256(x).toString('hex');

module.exports = { keccak256, keccak256Hex };
