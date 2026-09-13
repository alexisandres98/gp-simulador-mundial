// polymarket/orden.js — CONSTRUIR Y FIRMAR UNA ORDEN DEL CLOB (13-sep-2026)
//
// Traduce "compra 20 acciones de este token a 0,52" a la estructura EIP-712 exacta que el contrato del
// Exchange valida, y la firma. Todo lo de aquí sale de la documentación de la casa (docs.polymarket.com,
// /trading/place-orders), no de suposiciones: las direcciones de los contratos, los tipos del mensaje, el
// orden de los campos y —sobre todo— las reglas de redondeo, que son la parte que parece cosmética y no lo
// es. La casa RECHAZA una orden cuyo precio no encaje en el `tick_size` del mercado, y rechaza una cuyos
// importes no cuadren al céntimo con el precio por el tamaño.
//
// LOS IMPORTES, QUE ES DONDE ESTÁ EL DETALLE. Un mercado no cotiza "precio y tamaño": cotiza cuánto das y
// cuánto recibes, los dos en enteros de seis decimales.
//   · COMPRA: das dinero (makerAmount = precio × tamaño) y recibes acciones (takerAmount = tamaño).
//   · VENTA:  das acciones (makerAmount = tamaño) y recibes dinero (takerAmount = precio × tamaño).
// Invertirlos no da error de formato — da una orden que pide exactamente lo contrario de lo que querías.
//
// NO SE USA COMA FLOTANTE PARA EL DINERO. 0.52 * 100 en JavaScript da 52.00000000000001, y ese sobrante
// convertido a entero de seis decimales es un importe que no cuadra y una orden rechazada. Todo el cálculo
// va en enteros.
'use strict';

const { digest } = require('../lib/eip712');
const { keccak256 } = require('../lib/keccak');
const S = require('../lib/secp256k1');

// ── CONSTANTES DE LA CASA ───────────────────────────────────────────────────────────────────────────────
const CHAIN_ID = 137;                                        // Polygon
const EXCHANGE = {
  estandar: '0xE111180000d2663C0091e4f400237545B87B996B',
  riesgo_negativo: '0xe2222d279d744050d28e00520010520000310F59',
};
const DOMINIO_NOMBRE = 'Polymarket CTF Exchange';
const DOMINIO_VERSION = '2';
const CERO32 = '0x' + '0'.repeat(64);

// Los cuatro tipos de wallet y qué firma cada uno. `maker` es quien pone el dinero; `signer` quien firma.
// En una Deposit Wallet coinciden; en una Proxy o una Safe, NO — y ponerlos iguales invalida la firma.
const TIPO_FIRMA = { eoa: 0, proxy: 1, safe: 2, deposito: 3 };

// El tipo del mensaje, campo a campo y en ORDEN: cambiar el orden cambia el hash del tipo y con él la firma.
const TIPOS_ORDEN = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'metadata', type: 'bytes32' },
    { name: 'builder', type: 'bytes32' },
  ],
};

// ── REDONDEO, SEGÚN LA TABLA DE LA CASA ─────────────────────────────────────────────────────────────────
// tick → [decimales de precio, de tamaño, de importe]
const DECIMALES = {
  '0.1': [1, 2, 3], '0.01': [2, 2, 4], '0.005': [3, 2, 5],
  '0.0025': [4, 2, 6], '0.001': [3, 2, 5], '0.0001': [4, 2, 6],
};
function decimalesDe(tick) {
  const k = String(tick);
  if (DECIMALES[k]) return DECIMALES[k];
  const n = Number(tick);
  for (const [kk, v] of Object.entries(DECIMALES)) if (Math.abs(Number(kk) - n) < 1e-12) return v;
  throw new Error('tick_size desconocido: ' + tick);
}

// Aritmética decimal en enteros: un número se lleva como { v: BigInt, d: decimales }.
const ESCALA = (d) => 10n ** BigInt(d);
function aDecimal(x, d) {
  // se pasa por cadena a propósito: Number("0.0025") ya trae error de coma flotante dentro
  const s = typeof x === 'string' ? x : String(x);
  if (!/^-?\d*\.?\d*$/.test(s) || s === '' || s === '.') throw new Error('número inválido: ' + x);
  const neg = s.startsWith('-');
  const [ent, dec = ''] = s.replace('-', '').split('.');
  const rec = (dec + '0'.repeat(d)).slice(0, d);
  const v = BigInt(ent || '0') * ESCALA(d) + BigInt(rec || '0');
  return { v: neg ? -v : v, d };
}
const aTexto = ({ v, d }) => {
  const s = (v < 0n ? -v : v).toString().padStart(d + 1, '0');
  const ent = s.slice(0, s.length - d), dec = d ? '.' + s.slice(s.length - d) : '';
  return (v < 0n ? '-' : '') + ent + dec;
};
// cambiar de escala hacia ABAJO (trunca) o hacia ARRIBA
function reescala({ v, d }, nd, arriba = false) {
  if (nd === d) return { v, d: nd };
  if (nd > d) return { v: v * ESCALA(nd - d), d: nd };
  const f = ESCALA(d - nd);
  const q = v / f;
  return { v: (arriba && v % f !== 0n) ? q + 1n : q, d: nd };
}

// LA RECETA, literal de la documentación:
//   1. el precio con como mucho `decimales de precio`
//   2. el tamaño hacia ABAJO a `decimales de tamaño`
//   3. el importe = precio × tamaño; si se pasa de `decimales de importe`, se redondea primero hacia
//      ARRIBA a decimales+4 y luego hacia ABAJO a decimales
function importes({ precio, tamano, lado, tick }) {
  const [dp, dt, di] = decimalesDe(tick);
  const p = reescala(aDecimal(precio, 10), dp);              // el precio NO se redondea hacia arriba
  const t = reescala(aDecimal(tamano, 10), dt);              // el tamaño SIEMPRE hacia abajo
  if (p.v <= 0n) throw new Error('precio no positivo');
  if (t.v <= 0n) throw new Error('tamaño no positivo');
  // producto exacto: los decimales se suman
  let imp = { v: p.v * t.v, d: dp + dt };
  if (imp.d > di) imp = reescala(reescala(imp, di + 4, true), di);
  const seis = (x) => reescala(x, 6).v.toString();
  const dinero = seis(imp), acciones = seis(t);
  return {
    precio: aTexto(p), tamano: aTexto(t), dinero_texto: aTexto(imp),
    makerAmount: lado === 'BUY' ? dinero : acciones,
    takerAmount: lado === 'BUY' ? acciones : dinero,
    decimales: { precio: dp, tamano: dt, importe: di },
  };
}

// ── CONSTRUIR LA ORDEN ──────────────────────────────────────────────────────────────────────────────────
function construir({
  tokenId, lado, precio, tamano, tick = '0.01', riesgoNegativo = false,
  maker, signer, tipoFirma = 'proxy', salt = null, timestamp = null, expiracion = '0', orderType = 'GTC',
} = {}) {
  const LADO = String(lado || '').toUpperCase();
  if (LADO !== 'BUY' && LADO !== 'SELL') throw new Error('lado debe ser BUY o SELL');
  if (!tokenId) throw new Error('falta tokenId');
  if (!maker || !signer) throw new Error('faltan maker o signer');
  const st = typeof tipoFirma === 'number' ? tipoFirma : TIPO_FIRMA[String(tipoFirma).toLowerCase()];
  if (st == null) throw new Error('tipo de firma desconocido: ' + tipoFirma);

  const imp = importes({ precio, tamano, lado: LADO, tick });
  // el `salt` viaja como NÚMERO en el JSON, así que se mantiene por debajo del entero seguro de JavaScript
  const sal = salt != null ? String(salt) : String(Math.floor(Math.random() * 9007199254740990) + 1);
  const ts = String(timestamp != null ? timestamp : Date.now());

  const mensaje = {
    salt: sal, maker, signer, tokenId: String(tokenId),
    makerAmount: imp.makerAmount, takerAmount: imp.takerAmount,
    side: LADO === 'BUY' ? 0 : 1, signatureType: st,
    timestamp: ts, metadata: CERO32, builder: CERO32,
  };
  const dominio = {
    name: DOMINIO_NOMBRE, version: DOMINIO_VERSION, chainId: CHAIN_ID,
    verifyingContract: riesgoNegativo ? EXCHANGE.riesgo_negativo : EXCHANGE.estandar,
  };
  return { mensaje, dominio, importes: imp, lado: LADO, expiracion: String(expiracion), orderType };
}

// El digest que se firma. Para Proxy, Safe y EOA es el de la propia orden; la Deposit Wallet además envuelve
// la firma para ERC-7739, y eso se hace aparte (`envuelveDeposito`).
const digestDe = (o) => digest({ domain: o.dominio, types: TIPOS_ORDEN, primaryType: 'Order', message: o.mensaje });

function firmar(o, clavePrivada) {
  const h = digestDe(o);
  const f = S.firmar(h, clavePrivada);
  // COMPROBACIÓN ANTES DE ENVIAR: la firma tiene que recuperar la dirección del firmante declarado. Si no,
  // la casa tampoco nos va a reconocer y la orden se rechazaría — mejor enterarse aquí que en el log.
  const recuperada = S.recuperar(h, f.r, f.s, f.rec);
  if (!recuperada || recuperada.toLowerCase() !== String(o.mensaje.signer).toLowerCase()) {
    throw new Error(`la firma recupera ${recuperada} y el firmante declarado es ${o.mensaje.signer}`);
  }
  return { firma: f.hex, digest: '0x' + h.toString('hex'), recuperada };
}

// El cuerpo que se manda a POST /order, con los nombres exactos de la casa.
function cuerpo(o, firma, { deferExec = false, owner = null } = {}) {
  const order = {
    salt: Number(o.mensaje.salt),                            // la casa lo serializa como número
    maker: o.mensaje.maker, signer: o.mensaje.signer, tokenId: o.mensaje.tokenId,
    makerAmount: o.mensaje.makerAmount, takerAmount: o.mensaje.takerAmount,
    side: o.lado, signatureType: o.mensaje.signatureType,
    timestamp: o.mensaje.timestamp, expiration: o.expiracion,
    metadata: o.mensaje.metadata, builder: o.mensaje.builder,
    signature: firma,
  };
  const b = { deferExec, order, orderType: o.orderType };
  if (owner) b.owner = owner;
  return b;
}

module.exports = { CHAIN_ID, EXCHANGE, TIPO_FIRMA, TIPOS_ORDEN, DECIMALES,
  decimalesDe, aDecimal, aTexto, reescala, importes, construir, digestDe, firmar, cuerpo };
