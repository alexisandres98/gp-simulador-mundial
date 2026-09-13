// relay/pm-relay.js — EL BRAZO DE POLYMARKET, EN REGIÓN PERMITIDA (13-sep-2026)
//
// POR QUÉ EXISTE, MEDIDO Y NO SUPUESTO. Desde Render (Oregón) el CLOB de Polymarket contesta:
//     GET  /markets → 200 OK
//     POST /order   → 403 "Trading restricted in your region"
// O sea: LEER se puede y COLOCAR no. Eso es exactamente lo que nos pasó con Cloudbet en agosto, y por eso
// la sombra de Polymarket lleva desde el 1-sep leyendo libros sin un fallo y nadie se había dado cuenta de
// que no podría colocar ni una orden. Se comprobó con una sonda antes de escribir esta línea.
//
// La solución ya estaba montada: el mismo servidor de Helsinki que coloca en Cloudbet. Este archivo es su
// segundo brazo.
//
// EN QUÉ SE PARECE AL BRAZO DE CLOUDBET, Y EN QUÉ NO
//   · IGUAL: el secreto de la casa vive AQUÍ, no en el servidor principal. El servidor principal es
//     público, sirve la plataforma a casi mil usuarios y tiene muchísima más superficie de ataque. Este
//     proceso no sirve a nadie más que al ejecutor.
//   · IGUAL: no guarda nada. Ni la petición, ni la respuesta, ni la clave en disco.
//   · IGUAL: no decide. No mira el modelo, no elige mercado, no calcula tamaño.
//   · DISTINTO, Y HAY QUE DECIRLO: aquí no se reenvía un cuerpo tal cual, porque en Polymarket la orden va
//     FIRMADA con la clave privada, y la clave está aquí. Así que el brazo recibe la INTENCIÓN ECONÓMICA
//     («compra N acciones de este token a este precio») y hace el trabajo mecánico de convertirla en una
//     orden firmada. La decisión sigue estando arriba; lo que baja es aritmética y criptografía.
//
// EL TOPE DURO ES LA ÚLTIMA RED. `PM_MAX_USD` limita cuánto puede costar UNA orden, aquí abajo, después de
// todos los frenos del servidor principal. Si un fallo allá arriba pidiera comprar por mil dólares, este
// proceso lo rechaza. Un brazo que obedece cualquier cifra que le manden es un brazo que amplifica los
// errores del cerebro.
'use strict';

const O = require('../polymarket/orden');
const C = require('../polymarket/clob');
const S = require('../lib/secp256k1');

const PK = () => String(process.env.PM_PRIVATE_KEY || '').trim();
const MAKER = () => String(process.env.PM_MAKER_ADDRESS || '').trim();          // la wallet con los fondos
const TIPO_FIRMA = () => String(process.env.PM_SIG_TYPE || 'proxy').trim();     // proxy | safe | eoa | deposito
const MAX_USD = () => Number(process.env.PM_MAX_USD || 25);                     // tope por orden, en dólares

// Las credenciales de trading se derivan UNA vez de la clave y se guardan en memoria. Si la casa las
// rechaza (caducan, se revocan), se vuelven a derivar sin reiniciar nada.
let _creds = null, _credsAt = 0;
async function credenciales({ forzar = false } = {}) {
  if (_creds && !forzar && Date.now() - _credsAt < 6 * 3600e3) return { ok: true, credenciales: _creds, cacheado: true };
  const pk = PK(); if (!pk) return { ok: false, why: 'falta PM_PRIVATE_KEY' };
  const dir = S.direccionDe(pk);
  let r = await C.credenciales({ clavePrivada: pk, direccion: dir, crear: false });
  if (!r.ok) r = await C.credenciales({ clavePrivada: pk, direccion: dir, crear: true });   // primera vez
  if (!r.ok) return r;
  _creds = r.credenciales; _credsAt = Date.now();
  return { ok: true, credenciales: _creds, cacheado: false };
}

// ── DIAGNÓSTICO ─────────────────────────────────────────────────────────────────────────────────────────
// Lo que hay que saber ANTES de mandar dinero, todo desde esta región: ¿se puede colocar?, ¿la clave da la
// dirección que esperamos?, ¿la casa nos da credenciales? Nunca devuelve la clave ni el secreto.
async function diag() {
  const out = { at: new Date().toISOString() };
  const pk = PK();
  out.clave_presente = !!pk;
  if (pk) {
    try {
      const dir = S.direccionDe(pk);
      out.firmante = dir;
      out.maker_configurado = MAKER() || null;
      out.tipo_firma = TIPO_FIRMA();
      out.maker_igual_firmante = MAKER() ? MAKER().toLowerCase() === dir.toLowerCase() : null;
    } catch (e) { out.clave_error = e.message; }
  }
  out.tope_por_orden_usd = MAX_USD();
  // ¿lee?
  const lec = await C.pide('/markets');
  out.lectura = { status: lec.status, ok: lec.ok };
  // ¿coloca? POST vacío y sin firma: no puede colocar nada, y separa "bloqueado por región" de "vivo"
  const esc = await C.pide('/order', { metodo: 'POST', cuerpo: {} });
  out.trading = { status: esc.status, cuerpo: (esc.texto || '').slice(0, 200) };
  out.bloqueado_por_region = /restricted in your region|geoblock/i.test(esc.texto || '');
  out.veredicto = out.bloqueado_por_region
    ? 'ESTA REGIÓN TAMPOCO SIRVE: el trading sigue bloqueado. No se puede colocar desde aquí.'
    : 'la región permite colocar (el 403 de región no aparece)';
  // ¿credenciales?
  if (pk && !out.bloqueado_por_region) {
    const c = await credenciales();
    out.credenciales = c.ok ? { ok: true, api_key_cola: String(c.credenciales.apiKey).slice(-6), cacheado: !!c.cacheado }
      : { ok: false, status: c.status, why: c.why || (c.texto || '').slice(0, 160) };
  }
  return out;
}

// ── COLOCAR ─────────────────────────────────────────────────────────────────────────────────────────────
// Validación campo a campo. Lo que no se entiende, no sale de aquí: un brazo que acepta cualquier JSON es
// un agujero por el que se puede pedir cualquier cosa con la clave de Alexis.
const CLAVES = ['tokenId', 'side', 'price', 'size', 'tick', 'negRisk', 'orderType', 'expiration', 'ref'];
function valida(b) {
  if (!b || typeof b !== 'object') return 'cuerpo ausente';
  for (const k of Object.keys(b)) if (!CLAVES.includes(k)) return 'campo no permitido: ' + k;
  if (!/^\d+$/.test(String(b.tokenId || ''))) return 'tokenId debe ser un entero en texto';
  const lado = String(b.side || '').toUpperCase();
  if (lado !== 'BUY' && lado !== 'SELL') return 'side debe ser BUY o SELL';
  const p = Number(b.price), s = Number(b.size);
  if (!(p > 0 && p < 1)) return 'price debe estar entre 0 y 1 (es un precio de share)';
  if (!(s > 0)) return 'size debe ser positivo';
  if (b.orderType && !['GTC', 'GTD', 'FOK', 'FAK'].includes(String(b.orderType))) return 'orderType desconocido';
  return null;
}

async function colocar(b) {
  const mal = valida(b);
  if (mal) return { ok: false, rechazado_por_el_brazo: mal };
  const pk = PK(); if (!pk) return { ok: false, rechazado_por_el_brazo: 'falta PM_PRIVATE_KEY' };
  const maker = MAKER(); if (!maker) return { ok: false, rechazado_por_el_brazo: 'falta PM_MAKER_ADDRESS' };
  const signer = S.direccionDe(pk);

  // EL TOPE, antes de firmar nada
  const coste = Number(b.price) * Number(b.size);
  if (!(coste <= MAX_USD())) {
    return { ok: false, rechazado_por_el_brazo: `la orden cuesta ${coste.toFixed(2)} y el tope de este brazo es ${MAX_USD()}` };
  }

  let orden, firma;
  try {
    orden = O.construir({
      tokenId: String(b.tokenId), lado: String(b.side).toUpperCase(),
      precio: String(b.price), tamano: String(b.size),
      tick: String(b.tick || '0.01'), riesgoNegativo: !!b.negRisk,
      maker, signer, tipoFirma: TIPO_FIRMA(),
      expiracion: String(b.expiration || '0'), orderType: String(b.orderType || 'GTC'),
    });
    firma = O.firmar(orden, pk);          // esto ya comprueba que la firma recupera al firmante
  } catch (e) { return { ok: false, rechazado_por_el_brazo: 'no se pudo construir/firmar: ' + e.message }; }

  const c = await credenciales();
  if (!c.ok) return { ok: false, rechazado_por_el_brazo: 'sin credenciales de trading', detalle: c.why || c.texto };

  const cuerpo = O.cuerpo(orden, firma.firma);
  const r = await C.colocar({ cuerpoOrden: cuerpo, credenciales: c.credenciales, direccion: signer });
  return {
    ok: r.ok, status: r.status, respuesta: r.json, texto: r.json ? undefined : (r.texto || '').slice(0, 400),
    // lo que se envió, para poder reconciliar después sin guardar nada aquí
    enviado: { tokenId: cuerpo.order.tokenId, side: cuerpo.order.side, makerAmount: cuerpo.order.makerAmount,
      takerAmount: cuerpo.order.takerAmount, precio: orden.importes.precio, tamano: orden.importes.tamano,
      coste_usd: orden.importes.dinero_texto, signatureType: cuerpo.order.signatureType,
      digest: firma.digest, ref: b.ref || null },
  };
}

// Ensayo: construye y FIRMA la orden pero no la manda. Sirve para ver exactamente qué se enviaría.
async function ensayo(b) {
  const mal = valida(b);
  if (mal) return { ok: false, rechazado_por_el_brazo: mal };
  const pk = PK(); if (!pk) return { ok: false, rechazado_por_el_brazo: 'falta PM_PRIVATE_KEY' };
  const maker = MAKER() || '0x' + '0'.repeat(40);
  const signer = S.direccionDe(pk);
  const coste = Number(b.price) * Number(b.size);
  const orden = O.construir({ tokenId: String(b.tokenId), lado: String(b.side).toUpperCase(),
    precio: String(b.price), tamano: String(b.size), tick: String(b.tick || '0.01'),
    riesgoNegativo: !!b.negRisk, maker, signer, tipoFirma: TIPO_FIRMA(),
    expiracion: String(b.expiration || '0'), orderType: String(b.orderType || 'GTC') });
  const firma = O.firmar(orden, pk);
  return { ok: true, ensayo: true, dentro_del_tope: coste <= MAX_USD(), coste_usd: +coste.toFixed(4),
    cuerpo: O.cuerpo(orden, firma.firma), digest: firma.digest, firmante: signer };
}

const estadoOrden = async (id) => {
  const c = await credenciales(); if (!c.ok) return { ok: false, why: 'sin credenciales' };
  return C.estadoOrden({ id, credenciales: c.credenciales, direccion: S.direccionDe(PK()) });
};
const cancelar = async (id) => {
  const c = await credenciales(); if (!c.ok) return { ok: false, why: 'sin credenciales' };
  return C.cancelar({ id, credenciales: c.credenciales, direccion: S.direccionDe(PK()) });
};

module.exports = { diag, colocar, ensayo, estadoOrden, cancelar, credenciales, valida, CLAVES };
