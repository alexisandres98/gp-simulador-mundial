// relay/cb-relay.js — RELAY DE APUESTAS EN REGIÓN PERMITIDA (1-sep)
//
// Por qué existe: Cloudbet habilitó la API de trading a la cuenta (email de Klaus, 1-sep) pero la familia
// REST `/pub/v3/bets/*` está GEO-CERCADA en el borde ("be mindful about the geo restriction", dixit Klaus).
// Mapa medido el 1-sep con sondas externas (GET sin llave: 403 HTML de Cloudflare = bloqueado; 401 JSON =
// pasó el cortafuegos y pide llave):
//   ❌ 403: EE.UU. (Oregón PDX, Ohio), Alemania, Países Bajos, Reino Unido, Singapur
//   ✅ 401: Brasil, Argentina, México, Chile, Colombia, Canadá (Toronto), Finlandia
// Es decir: LAS CINCO REGIONES DE RENDER están en países bloqueados — Frankfurt NO sirve (se comprobó
// ANTES de pagar el servicio). Y el bloqueo no es por IP de datacenter: las sondas que pasaron eran
// Oracle (BR/CL), Hetzner (FI) y EdgeUno (CO). Cuotas y cuenta no están geo-cercadas; colocar sí.
// Este proceso corre en un host de PAÍS PERMITIDO y hace UNA sola cosa: recibir una orden ya decidida y
// reenviarla a Cloudbet tal cual, con la llave que vive en SU entorno. Ninguna lógica de decisión vive
// aquí — el cerebro sigue en el servicio principal; esto es un brazo en otra geografía.
//
// Seguridad: todo endpoint (menos /health) exige `?key=` igual a GP_RELAY_KEY. El servicio principal es el
// único que conoce esa llave. Sin llave → 404 seco, como las sondas internas de la casa.
//
// Endpoints:
//   GET  /health            → ok (para el health check de Render)
//   GET  /diag?key=         → la misma batería de sondas del diag del ejecutor, desde ESTA región:
//                             cuenta, saldo, GET historial v3/v4 y POST de colocación DELIBERADAMENTE
//                             inválido (evento 0, stake 0 — no puede colocar nada). Devuelve status +
//                             huella de cortafuegos (cf_ray) por ruta.
//   POST /cb?key=&path=     → reenvío crudo: método, path (allowlist /pub/) y cuerpo se pasan tal cual a
//                             sports-api.cloudbet.com y la respuesta vuelve tal cual (status + cuerpo).
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
// TLS propio (1-sep): si GP_RELAY_TLS_DIR apunta a un dir con key.pem/cert.pem, el relay habla HTTPS.
// El certificado es autofirmado (no hay dominio sobre la IP): el cliente lo acepta sin verificar CA pero
// el tráfico va cifrado — las llaves no cruzan el Atlántico en claro. Mejora pendiente: fijar huella.
const TLSD = process.env.GP_RELAY_TLS_DIR || '';
const HOST = process.env.CLOUDBET_ACCOUNT_HOST || 'https://sports-api.cloudbet.com';
const AK = process.env.CLOUDBET_API_KEY || '';
const RK = process.env.GP_RELAY_KEY || '';

const j = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

async function cb(path, { method = 'GET', body = null, conLlave = true, full = false } = {}) {
  try {
    const h = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; GPSimulador/1.0)' };
    if (conLlave && AK) h['X-API-Key'] = AK;
    if (body) h['content-type'] = 'application/json';
    const r = await fetch(HOST + path, { method, headers: h, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    const cf = /Cloudflare|you have been blocked|Attention Required/i.test(t);
    const ray = (t.match(/Cloudflare Ray ID:\s*<\/strong>\s*<code[^>]*>([a-f0-9-]+)/i) || t.match(/Ray ID:\s*([a-f0-9-]{10,})/i) || [])[1] || (r.headers.get('cf-ray') || null);
    if (full) {
      // el modo COMPLETO es el del ejecutor: la respuesta de una apuesta no se trunca jamás —
      // parseada si es JSON y con el texto entero (acotado en 4000 por si acaso) al lado
      let j = null; try { j = t ? JSON.parse(t) : null; } catch { /* no era JSON */ }
      return { status: r.status, cortafuegos: cf, cf_ray: ray, json: j, text: cf ? '(HTML de Cloudflare)' : t.slice(0, 4000) };
    }
    return { status: r.status, cortafuegos: cf, cf_ray: ray, cuerpo: cf ? '(HTML de Cloudflare)' : t.replace(/\s+/g, ' ').slice(0, 220) };
  } catch (e) { return { error: String(e.message || e).slice(0, 80) }; }
}

const mkServer = (handler) => {
  if (TLSD) {
    try {
      return https.createServer({ key: fs.readFileSync(path.join(TLSD, 'key.pem')), cert: fs.readFileSync(path.join(TLSD, 'cert.pem')) }, handler);
    } catch (e) { console.error('[cb-relay] TLS pedido pero ilegible, caigo a HTTP:', e.message); }
  }
  return http.createServer(handler);
};
mkServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p === '/health') return j(res, 200, { ok: true, at: new Date().toISOString() });
  if (!RK || url.searchParams.get('key') !== RK) return j(res, 404, { error: 'No encontrado' });

  if (p === '/diag') {
    const cur = (process.env.GP_REAL_CURRENCY || 'USDT').toUpperCase();
    const out = { region: process.env.RENDER_REGION || 'desconocida', llave_len: AK.length, rutas: [] };
    out.rutas.push({ ruta: 'GET /pub/v1/account/currencies', ...(await cb('/pub/v1/account/currencies')) });
    out.rutas.push({ ruta: `GET /pub/v1/account/currencies/${cur}/balance`, ...(await cb(`/pub/v1/account/currencies/${cur}/balance`)) });
    out.rutas.push({ ruta: 'GET /pub/v3/bets/history?limit=3', ...(await cb('/pub/v3/bets/history?limit=3')) });
    out.rutas.push({ ruta: 'GET /pub/v4/bets/history?limit=3', ...(await cb('/pub/v4/bets/history?limit=3')) });
    // POST deliberadamente inválido: no puede colocar nada, pero separa "cortafuegos" (HTML 403) de
    // "el motor de apuestas está vivo" (400/422 con error de validación JSON)
    out.rutas.push({ ruta: 'POST /pub/v3/bets/place (inválido)', ...(await cb('/pub/v3/bets/place', { method: 'POST',
      body: { acceptPriceChange: 'NONE', currency: cur, eventId: '0', marketUrl: 'no.existe/under?total=0', price: '0', stake: '0', referenceId: 'diag-' + Date.now() } })) });
    return j(res, 200, out);
  }

  if (p === '/cb' && req.method === 'POST') {
    const path = String(url.searchParams.get('path') || '');
    if (!path.startsWith('/pub/')) return j(res, 400, { error: 'path fuera de /pub/' });
    const method = String(url.searchParams.get('method') || 'POST').toUpperCase();
    let raw = ''; req.on('data', (c) => { raw += c; if (raw.length > 65536) req.destroy(); });
    req.on('end', async () => {
      let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { return j(res, 400, { error: 'cuerpo no es JSON' }); }
      return j(res, 200, await cb(path, { method, body, full: true }));
    });
    return;
  }

  return j(res, 404, { error: 'No encontrado' });
}).listen(PORT, () => console.log(`[cb-relay] escuchando en :${PORT}${TLSD ? ' (TLS)' : ''} → ${HOST}`));
