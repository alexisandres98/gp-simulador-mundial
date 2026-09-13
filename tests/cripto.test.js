// tests/cripto.test.js — LAS PRIMITIVAS QUE FIRMAN DINERO
//
// Esto no prueba que el código corra: prueba que el hash es EL hash y que la firma recupera LA dirección.
// Un fallo aquí no da excepción ni traza — da una firma perfectamente bien formada que la casa rechaza sin
// explicar por qué, o peor, que recupera la dirección de otro. Por eso cada caso lleva su valor esperado
// de una fuente pública, y por eso la prueba central es de ida y vuelta: firmar y volver a sacar quién
// firmó. Si eso cuadra, la casa va a ver lo mismo que vemos nosotros.
'use strict';
const assert = require('assert');
const { keccak256, keccak256Hex } = require('../lib/keccak');
const S = require('../lib/secp256k1');

let n = 0;
const t = (nombre, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + nombre + ': ' + e.message); process.exitCode = 1; } };

// ── KECCAK ──────────────────────────────────────────────────────────────────────────────────────────────
t('keccak256 contra vectores públicos', () => {
  const V = [
    ['', '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
    ['abc', '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
    ['testing', '0x5f16f4c7f149ac4f9510d9cf8cf384038ad348b3bcdc01915f95de12df9d1b02'],
    ['hello', '0x1c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36deac8'],
  ];
  for (const [m, esp] of V) assert.strictEqual(keccak256Hex(m), esp, JSON.stringify(m));
});
t('keccak256 NO es el sha3-256 de Node (si coincidieran, estaría mal)', () => {
  const sha3 = '0x' + require('crypto').createHash('sha3-256').update('').digest('hex');
  assert.notStrictEqual(keccak256Hex(''), sha3);
});
t('keccak256 cruza bien el límite de bloque de 136 bytes', () => {
  for (const L of [135, 136, 137, 271, 272, 273]) {
    assert.strictEqual(keccak256('a'.repeat(L)).length, 32, 'longitud ' + L);
  }
  // dos longitudes contiguas no pueden dar el mismo hash
  assert.notStrictEqual(keccak256Hex('a'.repeat(136)), keccak256Hex('a'.repeat(137)));
});

// ── DIRECCIÓN ───────────────────────────────────────────────────────────────────────────────────────────
// Las claves 1 y 2 son verificables por cualquiera (basta multiplicar el generador) y la cuenta 0 de
// Hardhat está en millones de repositorios. Tres confirmaciones independientes de la misma cadena:
// multiplicación escalar → keccak → últimos 20 bytes.
t('clave privada → dirección de Ethereum', () => {
  const PARES = [
    ['0x0000000000000000000000000000000000000000000000000000000000000001', '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf'],
    ['0x0000000000000000000000000000000000000000000000000000000000000002', '0x2b5ad5c4795c026514f8317c7a215e218dccd6cf'],
    ['0x0000000000000000000000000000000000000000000000000000000000000003', '0x6813eb9362372eef6200f3b1dbc3f819671cba69'],
    ['0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266'],
    ['0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'],
  ];
  for (const [pk, esp] of PARES) assert.strictEqual(S.direccionDe(pk), esp, pk.slice(0, 12));
});
t('una clave fuera de rango se rechaza en vez de firmar basura', () => {
  assert.throws(() => S.direccionDe('0x' + '0'.repeat(64)));
  assert.throws(() => S.direccionDe('0x' + 'f'.repeat(64)));   // > n
});

// ── FIRMA ───────────────────────────────────────────────────────────────────────────────────────────────
t('firmar y recuperar devuelve la MISMA dirección', () => {
  const claves = [
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    '0x0000000000000000000000000000000000000000000000000000000000000007',
  ];
  for (const pk of claves) {
    const dir = S.direccionDe(pk);
    // muchos mensajes: el bit de recuperación depende del punto R, así que hay que barrer los cuatro casos
    for (let i = 0; i < 40; i++) {
      const h = keccak256('mensaje numero ' + i);
      const f = S.firmar(h, pk);
      const rec = S.recuperar(h, f.r, f.s, f.rec);
      assert.strictEqual(rec, dir, `clave ${pk.slice(0, 10)} mensaje ${i}: recuperó ${rec}`);
    }
  }
});
t('la firma es determinista (RFC 6979): dos veces lo mismo da lo mismo', () => {
  const pk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const h = keccak256('siempre igual');
  assert.strictEqual(S.firmar(h, pk).hex, S.firmar(h, pk).hex);
});
t('mensajes distintos dan firmas distintas', () => {
  const pk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  assert.notStrictEqual(S.firmar(keccak256('a'), pk).hex, S.firmar(keccak256('b'), pk).hex);
});
t('`s` SIEMPRE en la mitad baja, que es lo único que Ethereum acepta', () => {
  const pk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  for (let i = 0; i < 60; i++) {
    const f = S.firmar(keccak256('m' + i), pk);
    assert.ok(f.s <= S.N / 2n, 's alta en el mensaje ' + i);
    assert.ok(f.v === 27 || f.v === 28, 'v fuera de 27/28: ' + f.v);
  }
});
t('la firma en hexadecimal tiene 65 bytes', () => {
  const f = S.firmar(keccak256('x'), '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  assert.strictEqual(f.hex.length, 2 + 130, f.hex);
  assert.ok(/^0x[0-9a-f]{130}$/.test(f.hex));
});
t('con el bit de recuperación cambiado NO sale nuestra dirección', () => {
  // esta es la prueba que caza el error clásico: normalizar `s` y olvidar invertir el bit
  const pk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const dir = S.direccionDe(pk);
  let distintas = 0;
  for (let i = 0; i < 20; i++) {
    const h = keccak256('z' + i);
    const f = S.firmar(h, pk);
    const mal = S.recuperar(h, f.r, f.s, f.rec ^ 1);
    if (mal !== dir) distintas++;
  }
  assert.strictEqual(distintas, 20, 'el bit de recuperación no está discriminando');
});
t('un hash que no tiene 32 bytes se rechaza', () => {
  assert.throws(() => S.firmar(Buffer.alloc(31), '0x' + '1'.repeat(64)));
});

console.log(`cripto: ${n} pruebas OK`);
