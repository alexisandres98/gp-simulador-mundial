// tests/deposito.test.js — LA FIRMA DE LA DEPOSIT WALLET, COTEJADA CONTRA LA CASA
//
// POR QUÉ EXISTE. Toda cuenta de Polymarket creada desde el 4-may-2026 es una Deposit Wallet, así que este
// camino no es un caso raro: es EL camino. Y es el único trozo del sistema que no se puede comprobar
// mirándolo — una firma mal envuelta no se distingue de una bien envuelta salvo porque la casa la rechaza,
// y la casa no dice cuál de las tres piezas falló.
//
// Así que aquí se reimplementa a mano, siguiendo línea a línea el código de la propia casa
// (`@polymarket/client` 0.10.0: las funciones `ay`, `iy`, `Rt` y `Et`), lo que nuestro módulo calcula por su
// cuenta. Si los dos caminos dan lo mismo, nuestro envoltorio es el suyo. Si algún día dejan de coincidir,
// esta prueba dice en qué pieza exacta divergen en vez de dejar un "orden rechazada" a secas.
'use strict';
const O = require('../polymarket/orden');
const { keccak256 } = require('../lib/keccak');
const { separadorDominio, hashEstructura, codificaTipo } = require('../lib/eip712');

const h32 = (v) => Buffer.from(BigInt(v).toString(16).padStart(64, '0'), 'hex');
const addr32 = (a) => Buffer.from(a.replace(/^0x/, '').toLowerCase().padStart(64, '0'), 'hex');
const b32 = (x) => Buffer.from(x.replace(/^0x/, '').padEnd(64, '0'), 'hex');

const TIPO = O.TIPO_ORDEN_TEXTO;
const ORDER_TYPEHASH = keccak256(TIPO);
const DOMAIN_TYPEHASH = keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
const NOMBRE_HASH = keccak256('Polymarket CTF Exchange');

// ay(domain): keccak(abi.encode(bytes32,bytes32,bytes32,uint256,address))
const separadorCasa = (version, chainId, exchange) => keccak256(Buffer.concat([
  DOMAIN_TYPEHASH, NOMBRE_HASH, keccak256(version), h32(chainId), addr32(exchange)]));

// iy(order): keccak(abi.encode(typehash, salt, maker, signer, tokenId, makerAmount, takerAmount, side,
//                              signatureType, timestamp, metadata, builder))
const hashOrdenCasa = (m) => keccak256(Buffer.concat([
  ORDER_TYPEHASH, h32(m.salt), addr32(m.maker), addr32(m.signer), h32(m.tokenId),
  h32(m.makerAmount), h32(m.takerAmount), h32(m.side), h32(m.signatureType),
  h32(m.timestamp), b32(m.metadata), b32(m.builder)]));

const MAKER = '0x922eeC312Eeb050184e47b633098A8ABc898F805';
const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SIGNER = require('../lib/secp256k1').direccionDe(PK);
const TOKEN = '55115078421062885512539156303747803058407616201213034911037320915726138659123';

let fallos = 0;
const ok = (n, a, b) => { const v = a === b; if (!v) fallos++; console.log((v ? 'OK  ' : 'MAL ') + n + (v ? '' : `\n     mio  ${a}\n     casa ${b}`)); };

const orden = O.construir({ tokenId: TOKEN, lado: 'BUY', precio: '0.52', tamano: '10',
  tick: '0.01', maker: MAKER, signer: SIGNER, tipoFirma: 'deposito', salt: '12345', timestamp: '1700000000' });

console.log('--- 1. el signer declarado ---');
ok('en Deposit Wallet el signer es la propia wallet',
  orden.mensaje.signer.toLowerCase(), MAKER.toLowerCase());
ok('el signatureType es 3', String(orden.mensaje.signatureType), '3');

console.log('\n--- 2. las piezas del envoltorio ---');
ok('separador de dominio de la casa',
  '0x' + separadorDominio(orden.dominio).toString('hex'),
  '0x' + separadorCasa('2', 137, orden.dominio.verifyingContract).toString('hex'));
ok('hash de la orden (contentsHash)',
  '0x' + hashEstructura('Order', orden.mensaje, O.TIPOS_ORDEN).toString('hex'),
  '0x' + hashOrdenCasa(orden.mensaje).toString('hex'));
ok('el texto del tipo Order es idéntico al suyo', TIPO,
  'Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)');

console.log('\n--- 3. el tipo envuelto ---');
ok('encodeType de TypedDataSign', codificaTipo('TypedDataSign', O.TIPOS_ENVUELTOS),
  'TypedDataSign(Order contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)' + TIPO);

console.log('\n--- 4. la firma completa, byte a byte ---');
const f = O.firmar(orden, PK);
const cola = Buffer.concat([
  separadorCasa('2', 137, orden.dominio.verifyingContract),
  hashOrdenCasa(orden.mensaje),
  Buffer.from(TIPO, 'utf8'),
  Buffer.from(TIPO.length.toString(16).padStart(4, '0'), 'hex'),
]);
const mia = Buffer.from(f.firma.slice(2), 'hex');
ok('los primeros 65 bytes son la firma ECDSA', String(mia.length - cola.length), '65');
ok('la cola coincide con la de la casa',
  '0x' + mia.slice(65).toString('hex'), '0x' + cola.toString('hex'));
ok('la longitud del tipo va en los dos últimos bytes',
  mia.slice(-2).toString('hex'), TIPO.length.toString(16).padStart(4, '0'));
ok('la envoltura está marcada', String(f.envuelta), 'true');

console.log('\n--- 5. que NO se rompió lo anterior ---');
const prox = O.construir({ tokenId: TOKEN, lado: 'BUY', precio: '0.52', tamano: '10', tick: '0.01',
  maker: MAKER, signer: SIGNER, tipoFirma: 'proxy', salt: '12345', timestamp: '1700000000' });
ok('en Proxy el signer sigue siendo la clave', prox.mensaje.signer.toLowerCase(), SIGNER.toLowerCase());
const fp = O.firmar(prox, PK);
ok('en Proxy la firma sigue siendo de 65 bytes', String((fp.firma.length - 2) / 2), '65');
ok('en Proxy no hay envoltura', String(!!fp.envuelta), 'false');

console.log(fallos ? `\n${fallos} DIFERENCIAS` : '\nTODO COINCIDE con la implementación de la casa');
process.exit(fallos ? 1 : 0);
