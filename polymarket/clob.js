// polymarket/clob.js — CLIENTE DEL LIBRO DE ÓRDENES (13-sep-2026)
//
// La casa autentica en DOS niveles y confundirlos es el primer sitio donde se atasca una integración:
//
//   NIVEL 1 (la clave privada). Se firma un mensaje EIP-712 `ClobAuth` que dice "controlo esta wallet", y
//   se cambia por unas credenciales de trading. Ojo con su dominio: lleva nombre, versión y cadena, pero
//   NO lleva `verifyingContract` — si se le añade, el separador cambia y la casa no reconoce la firma.
//   Esto se hace UNA vez y las credenciales se guardan.
//
//   NIVEL 2 (las credenciales). Cada petición lleva una firma HMAC-SHA256 sobre
//        marca_de_tiempo + MÉTODO + ruta + cuerpo
//   con el secreto decodificado de base64, y el resultado en base64 SEGURO PARA URL y CON RELLENO. Tres
//   detalles que parecen tontos y rompen la autenticación: la ruta va SIN los parámetros de consulta, el
//   cuerpo va tal cual se envía (mismo texto, byte a byte) y el base64 es el de guiones, no el normal.
//
// LA FIRMA DE LA ORDEN NO ESTÁ AQUÍ: está en `orden.js`. El nivel 2 dice QUIÉN LLAMA; la firma EIP-712 de
// la orden dice QUIÉN AUTORIZA LA OPERACIÓN. Son cosas distintas y hacen falta las dos.
'use strict';

const crypto = require('crypto');
const { digest } = require('../lib/eip712');
const S = require('../lib/secp256k1');

const HOST = process.env.PM_CLOB_HOST || 'https://clob.polymarket.com';
const CHAIN_ID = 137;

// ── NIVEL 1 ─────────────────────────────────────────────────────────────────────────────────────────────
const TIPOS_AUTH = {
  ClobAuth: [
    { name: 'address', type: 'address' },
    { name: 'timestamp', type: 'string' },      // sí, CADENA: el timestamp va como texto en este mensaje
    { name: 'nonce', type: 'uint256' },
    { name: 'message', type: 'string' },
  ],
};
const MENSAJE_AUTH = 'This message attests that I control the given wallet';

function firmaL1({ clavePrivada, direccion, timestamp, nonce = 0 }) {
  const ts = String(timestamp != null ? timestamp : Math.floor(Date.now() / 1000));
  const td = {
    domain: { name: 'ClobAuthDomain', version: '1', chainId: CHAIN_ID },   // sin verifyingContract
    types: TIPOS_AUTH,
    primaryType: 'ClobAuth',
    message: { address: direccion, timestamp: ts, nonce: String(nonce), message: MENSAJE_AUTH },
  };
  const h = digest(td);
  const f = S.firmar(h, clavePrivada);
  const rec = S.recuperar(h, f.r, f.s, f.rec);
  if (!rec || rec.toLowerCase() !== String(direccion).toLowerCase()) {
    throw new Error(`la firma L1 recupera ${rec}, no ${direccion}`);
  }
  return { firma: f.hex, timestamp: ts, nonce: String(nonce) };
}

// ── NIVEL 2 ─────────────────────────────────────────────────────────────────────────────────────────────
// base64 seguro para URL CON relleno: '+'→'-', '/'→'_', y los '=' se quedan.
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
function firmaL2({ secreto, timestamp, metodo, ruta, cuerpo = '' }) {
  const clave = Buffer.from(String(secreto).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const mensaje = String(timestamp) + String(metodo).toUpperCase() + ruta + (cuerpo || '');
  return b64url(crypto.createHmac('sha256', clave).update(mensaje).digest());
}

function cabecerasL2({ credenciales, direccion, metodo, ruta, cuerpo = '', timestamp = null }) {
  const ts = String(timestamp != null ? timestamp : Math.floor(Date.now() / 1000));
  return {
    POLY_ADDRESS: direccion,
    POLY_API_KEY: credenciales.apiKey,
    POLY_PASSPHRASE: credenciales.passphrase,
    POLY_TIMESTAMP: ts,
    POLY_SIGNATURE: firmaL2({ secreto: credenciales.secret, timestamp: ts, metodo, ruta, cuerpo }),
  };
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────────────
// Nunca lanza por un error de la casa: devuelve { status, json, texto } para que quien llame decida. Un
// cliente que lanza ante un 400 obliga a envolver cada llamada en try/catch y ahí es donde se pierden los
// mensajes de error que explican por qué la casa rechazó una orden.
async function pide(ruta, { metodo = 'GET', cuerpo = null, cabeceras = {}, timeoutMs = 15000, query = '' } = {}) {
  const texto = cuerpo == null ? '' : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo));
  const h = { accept: 'application/json', ...cabeceras };
  if (texto) h['content-type'] = 'application/json';
  try {
    const r = await fetch(HOST + ruta + (query || ''), {
      method: metodo, headers: h, ...(texto ? { body: texto } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const t = await r.text().catch(() => '');
    let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* no era JSON */ }
    return { status: r.status, ok: r.ok, json: j, texto: t.slice(0, 1500) };
  } catch (e) { return { status: 0, ok: false, json: null, texto: '', error: String(e.message || e) }; }
}

// Obtener las credenciales de trading. `derive` devuelve las que ya existen; `create` las crea la primera vez.
async function credenciales({ clavePrivada, direccion, crear = false, nonce = 0 }) {
  const l1 = firmaL1({ clavePrivada, direccion, nonce });
  const ruta = crear ? '/auth/api-key' : '/auth/derive-api-key';
  const r = await pide(ruta, {
    metodo: crear ? 'POST' : 'GET',
    cabeceras: { POLY_ADDRESS: direccion, POLY_SIGNATURE: l1.firma, POLY_TIMESTAMP: l1.timestamp, POLY_NONCE: l1.nonce },
  });
  if (!r.ok || !r.json) return { ok: false, ...r };
  const c = r.json;
  const creds = { apiKey: c.apiKey || c.api_key, secret: c.secret, passphrase: c.passphrase };
  if (!creds.apiKey || !creds.secret || !creds.passphrase) return { ok: false, ...r, why: 'respuesta sin las tres credenciales' };
  return { ok: true, credenciales: creds };
}

// El libro de un token (público, sin autenticar). Es la misma lectura que ya hace la sombra.
const libro = (tokenId) => pide('/book', { query: '?token_id=' + encodeURIComponent(tokenId) });
// tick_size y si el mercado es de riesgo negativo: hacen falta ANTES de construir la orden
const tickSize = (tokenId) => pide('/tick-size', { query: '?token_id=' + encodeURIComponent(tokenId) });
const negRisk = (tokenId) => pide('/neg-risk', { query: '?token_id=' + encodeURIComponent(tokenId) });

// Colocar. `cuerpoOrden` viene ya construido y FIRMADO por `orden.js`.
async function colocar({ cuerpoOrden, credenciales: creds, direccion }) {
  const texto = JSON.stringify(cuerpoOrden);
  const cab = cabecerasL2({ credenciales: creds, direccion, metodo: 'POST', ruta: '/order', cuerpo: texto });
  return pide('/order', { metodo: 'POST', cuerpo: texto, cabeceras: cab, timeoutMs: 20000 });
}
async function estadoOrden({ id, credenciales: creds, direccion }) {
  const ruta = '/data/order/' + encodeURIComponent(id);
  return pide(ruta, { cabeceras: cabecerasL2({ credenciales: creds, direccion, metodo: 'GET', ruta }) });
}
async function cancelar({ id, credenciales: creds, direccion }) {
  const texto = JSON.stringify({ orderID: id });
  return pide('/order', { metodo: 'DELETE', cuerpo: texto,
    cabeceras: cabecerasL2({ credenciales: creds, direccion, metodo: 'DELETE', ruta: '/order', cuerpo: texto }) });
}

module.exports = { HOST, CHAIN_ID, TIPOS_AUTH, MENSAJE_AUTH,
  firmaL1, firmaL2, cabecerasL2, pide, credenciales, libro, tickSize, negRisk, colocar, estadoOrden, cancelar };
