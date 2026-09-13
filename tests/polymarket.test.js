// tests/polymarket.test.js — LA ORDEN, SU FIRMA Y LOS FRENOS DEL BRAZO
//
// Todo lo de aquí se comprueba SIN RED. Lo que se prueba no es que el código corra, sino las cuatro cosas
// que, si están mal, producen una orden bien formada y equivocada: los importes, la orientación de compra
// y venta, el contrato que valida la firma, y que la firma recupere a quien dice ser.
'use strict';
const assert = require('assert');
const O = require('../polymarket/orden');
const C = require('../polymarket/clob');
const S = require('../lib/secp256k1');

let n = 0;
const t = (nombre, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + nombre + ': ' + e.message); process.exitCode = 1; } };

const PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const SIGNER = S.direccionDe(PK);
const MAKER = '0x922eec3120000000000000000000000000000000';
const TOKEN = '71321045679252212594626385532706912750332728571942532289631379312455583992563';
const base = (x = {}) => O.construir({ tokenId: TOKEN, lado: 'BUY', precio: '0.52', tamano: '10', tick: '0.01',
  maker: MAKER, signer: SIGNER, tipoFirma: 'proxy', salt: 479249096354, timestamp: 1757800000000, ...x });

// ── IMPORTES ────────────────────────────────────────────────────────────────────────────────────────────
t('el ejemplo de la documentación sale exacto (10 acciones a 0,52)', () => {
  const i = O.importes({ precio: '0.52', tamano: '10', lado: 'BUY', tick: '0.01' });
  assert.strictEqual(i.makerAmount, '5200000');
  assert.strictEqual(i.takerAmount, '10000000');
});
t('vender invierte los importes, no los repite', () => {
  const c = O.importes({ precio: '0.52', tamano: '10', lado: 'BUY', tick: '0.01' });
  const v = O.importes({ precio: '0.52', tamano: '10', lado: 'SELL', tick: '0.01' });
  assert.strictEqual(v.makerAmount, c.takerAmount);
  assert.strictEqual(v.takerAmount, c.makerAmount);
});
t('sin deriva de coma flotante (0.52 × 100 no puede dar 52.000000000000014)', () => {
  const i = O.importes({ precio: '0.52', tamano: '100', lado: 'BUY', tick: '0.01' });
  assert.strictEqual(i.makerAmount, '52000000');
  assert.strictEqual(O.importes({ precio: '0.07', tamano: '3', lado: 'BUY', tick: '0.01' }).makerAmount, '210000');
  assert.strictEqual(O.importes({ precio: '0.29', tamano: '17', lado: 'BUY', tick: '0.01' }).makerAmount, '4930000');
});
t('el tamaño se trunca hacia abajo, nunca hacia arriba', () => {
  assert.strictEqual(O.importes({ precio: '0.5', tamano: '10.999', lado: 'BUY', tick: '0.01' }).tamano, '10.99');
});
t('un tick_size que la casa no publica se rechaza en vez de inventarse decimales', () => {
  assert.throws(() => O.importes({ precio: '0.5', tamano: '1', lado: 'BUY', tick: '0.7' }));
});
t('cada tick_size usa sus propios decimales', () => {
  assert.deepStrictEqual(O.decimalesDe('0.01'), [2, 2, 4]);
  assert.deepStrictEqual(O.decimalesDe('0.0001'), [4, 2, 6]);
  assert.deepStrictEqual(O.decimalesDe('0.1'), [1, 2, 3]);
});

// ── LA ORDEN ────────────────────────────────────────────────────────────────────────────────────────────
t('el dominio es el del Exchange, con su nombre y versión exactos', () => {
  const o = base();
  assert.strictEqual(o.dominio.name, 'Polymarket CTF Exchange');
  assert.strictEqual(o.dominio.version, '2');
  assert.strictEqual(o.dominio.chainId, 137);
  assert.strictEqual(o.dominio.verifyingContract, O.EXCHANGE.estandar);
});
t('un mercado de riesgo negativo firma contra el OTRO contrato', () => {
  assert.strictEqual(base({ riesgoNegativo: true }).dominio.verifyingContract, O.EXCHANGE.riesgo_negativo);
  assert.notStrictEqual(O.EXCHANGE.estandar, O.EXCHANGE.riesgo_negativo);
  // y por tanto el digest cambia: firmar contra el contrato equivocado es una orden inválida
  assert.notStrictEqual(O.digestDe(base()).toString('hex'), O.digestDe(base({ riesgoNegativo: true })).toString('hex'));
});
t('cada tipo de wallet lleva su número de firma', () => {
  assert.strictEqual(base({ tipoFirma: 'eoa' }).mensaje.signatureType, 0);
  assert.strictEqual(base({ tipoFirma: 'proxy' }).mensaje.signatureType, 1);
  assert.strictEqual(base({ tipoFirma: 'safe' }).mensaje.signatureType, 2);
  assert.strictEqual(base({ tipoFirma: 'deposito' }).mensaje.signatureType, 3);
});
t('BUY es 0 y SELL es 1 en el mensaje firmado, y texto en el cuerpo', () => {
  assert.strictEqual(base({ lado: 'BUY' }).mensaje.side, 0);
  assert.strictEqual(base({ lado: 'SELL' }).mensaje.side, 1);
  const o = base();
  assert.strictEqual(O.cuerpo(o, '0x00').order.side, 'BUY');
});
t('faltar maker o signer no deja construir una orden a medias', () => {
  assert.throws(() => O.construir({ tokenId: TOKEN, lado: 'BUY', precio: '0.5', tamano: '1', maker: MAKER }));
  assert.throws(() => O.construir({ tokenId: TOKEN, lado: 'BUY', precio: '0.5', tamano: '1', signer: SIGNER }));
});

// ── LA FIRMA ────────────────────────────────────────────────────────────────────────────────────────────
t('la firma recupera al firmante declarado', () => {
  const o = base();
  const f = O.firmar(o, PK);
  assert.strictEqual(f.recuperada, SIGNER);
  assert.ok(/^0x[0-9a-f]{130}$/.test(f.firma));
});
t('firmar con OTRA clave se detecta antes de enviar', () => {
  // el firmante declarado no coincide con quien firma: tiene que saltar aquí, no en el log de la casa
  const o = base({ signer: '0x1111111111111111111111111111111111111111' });
  assert.throws(() => O.firmar(o, PK), /recupera/);
});
t('cambiar cualquier campo cambia el digest', () => {
  const d0 = O.digestDe(base()).toString('hex');
  for (const cambio of [{ precio: '0.53' }, { tamano: '11' }, { lado: 'SELL' }, { salt: 1 },
    { timestamp: 1757800000001 }, { tipoFirma: 'safe' }, { maker: '0x' + '1'.repeat(40) }]) {
    assert.notStrictEqual(O.digestDe(base(cambio)).toString('hex'), d0, JSON.stringify(cambio));
  }
});
t('el cuerpo del POST lleva los nombres que espera la casa', () => {
  const o = base();
  const b = O.cuerpo(o, O.firmar(o, PK).firma);
  for (const k of ['salt', 'maker', 'signer', 'tokenId', 'makerAmount', 'takerAmount', 'side',
    'signatureType', 'timestamp', 'expiration', 'metadata', 'builder', 'signature']) {
    assert.ok(b.order[k] !== undefined, 'falta ' + k);
  }
  assert.strictEqual(typeof b.order.salt, 'number', 'el salt viaja como número');
  assert.strictEqual(b.orderType, 'GTC');
  assert.strictEqual(b.deferExec, false);
});

// ── AUTENTICACIÓN ───────────────────────────────────────────────────────────────────────────────────────
t('el dominio de autenticación NO lleva verifyingContract', () => {
  const l1 = C.firmaL1({ clavePrivada: PK, direccion: SIGNER, timestamp: 1757800000, nonce: 0 });
  assert.ok(/^0x[0-9a-f]{130}$/.test(l1.firma));   // si el dominio fuera otro, la comprobación interna habría saltado
});
t('la firma de petición es base64 seguro para URL y determinista', () => {
  const a = { secreto: Buffer.from('secreto').toString('base64'), timestamp: '1757800000', metodo: 'POST', ruta: '/order', cuerpo: '{"a":1}' };
  const s1 = C.firmaL2(a), s2 = C.firmaL2(a);
  assert.strictEqual(s1, s2);
  assert.ok(/^[A-Za-z0-9_-]+=*$/.test(s1), s1);
  assert.notStrictEqual(s1, C.firmaL2({ ...a, cuerpo: '{"a":2}' }), 'el cuerpo tiene que entrar en la firma');
  assert.notStrictEqual(s1, C.firmaL2({ ...a, ruta: '/orders' }), 'la ruta tiene que entrar en la firma');
  assert.notStrictEqual(s1, C.firmaL2({ ...a, metodo: 'GET' }), 'el método tiene que entrar en la firma');
});

// ── LOS FRENOS DEL BRAZO ────────────────────────────────────────────────────────────────────────────────
t('el brazo rechaza lo que no entiende', () => {
  process.env.PM_PRIVATE_KEY = PK; process.env.PM_MAKER_ADDRESS = MAKER; process.env.PM_MAX_USD = '25';
  const PM = require('../relay/pm-relay');
  assert.strictEqual(PM.valida({ tokenId: '1', side: 'BUY', price: 0.5, size: 1 }), null);
  assert.match(PM.valida({ tokenId: '1', side: 'BUY', price: 0.5, size: 1, maker: '0xotro' }), /campo no permitido/);
  assert.match(PM.valida({ tokenId: '1', side: 'BUY', price: 1.5, size: 1 }), /entre 0 y 1/);
  assert.match(PM.valida({ tokenId: 'abc', side: 'BUY', price: 0.5, size: 1 }), /entero/);
  assert.match(PM.valida({ tokenId: '1', side: 'LAY', price: 0.5, size: 1 }), /BUY o SELL/);
});

// ── EL MAPA DE PAÍSES DE LA CASA ────────────────────────────────────────────────────────────────────────
// Este mapa decide DÓNDE puede vivir el brazo, así que un error aquí no se ve: se traduce en un servidor
// alquilado que no puede colocar. Las subdivisiones son la parte fácil de equivocar — la casa bloquea
// cuatro provincias de Canadá y tres regiones de Ucrania, no los países enteros.
t('el mapa de países distingue subdivisiones, no solo países', () => {
  const G = require('../relay/geo-polymarket');
  const abre = (c, r) => G.veredicto(c, r).puede_abrir;
  assert.strictEqual(abre('FI'), true, 'Finlandia no está en ninguna lista: por eso vale Helsinki');
  assert.strictEqual(abre('DE'), false, 'Alemania es solo-cerrar: Fráncfort NO sirve');
  assert.strictEqual(abre('SG'), false, 'Singapur es solo-cerrar: la otra región de Render tampoco');
  assert.strictEqual(abre('US', 'IA'), false);
  assert.strictEqual(abre('CA', 'ON'), false, 'Ontario sí está bloqueada');
  assert.strictEqual(abre('CA', 'MB'), true, 'Manitoba no: bloquear Canadá entero sería un error caro');
  assert.strictEqual(abre('UA', '43'), false, 'Crimea está sancionada');
  assert.strictEqual(abre('UA', '30'), true, 'Kiev no lo está');
  assert.strictEqual(abre('IE'), true, 'Irlanda solo está restringida en la web; la API no');
  assert.strictEqual(G.veredicto('IE').clase, 'solo_cerrar_web');
  assert.strictEqual(G.veredicto('IR').clase, 'ofac');
});

t('NINGUNA región de Render puede colocar en Polymarket', () => {
  const G = require('../relay/geo-polymarket');
  // Oregón, Ohio y Virginia son US; luego Fráncfort y Singapur. Medido además en vivo el 13-sep:
  // gp-relay-eu (Fráncfort) sale con loc=DE. Queda escrito para que nadie —yo el primero— vuelva a
  // pensar que el servicio que ya tenemos en Europa resuelve esto.
  for (const [pais, region] of [['US', 'OR'], ['US', 'OH'], ['US', 'VA'], ['DE', ''], ['SG', '']]) {
    assert.strictEqual(G.veredicto(pais, region).puede_abrir, false, `${pais}-${region} debería estar bloqueada`);
  }
});

console.log(`polymarket: ${n} pruebas OK`);
