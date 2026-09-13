// relay/pm-server.js — EL BRAZO DE POLYMARKET, EN SU PROPIA MÁQUINA (13-sep-2026)
//
// POR QUÉ UNA MÁQUINA APARTE Y NO LA DE CLOUDBET. El plan original era montar el segundo brazo dentro de
// `cb-relay.js`, en el servidor que ya coloca en Cloudbet. Alexis abrió un proyecto de Hetzner separado
// («GP simulador polymarket») con su propia llave, y eso resultó ser mejor de lo que era el plan:
//
//   · **Dos secretos que no se caen juntos.** Hoy la llave de Cloudbet vive en Helsinki. Meter ahí también
//     la clave privada de Polymarket sería juntar en un solo sitio la capacidad de apostar la cuenta de la
//     casa Y la de firmar transferencias de una cartera. Separados, quien entre en uno no se lleva el otro.
//   · **El camino que lleva dinero real no se toca.** El brazo de Cloudbet lleva colocando desde agosto.
//     Añadirle rutas, dependencias y reinicios por una función nueva es arriesgar lo que ya funciona para
//     estrenar lo que todavía no.
//   · **La llave del proyecto solo alcanza a esta máquina.** El token de Hetzner es por proyecto: el que
//     gobierna esta máquina no puede ni ver la de Cloudbet. Eso no es un inconveniente, es la propiedad
//     que hace que valga la pena.
//
// DÓNDE. Helsinki (`hel1`), Finlandia. No es una preferencia: Finlandia es de los pocos países que NO
// aparecen en la lista de jurisdicciones restringidas que publica la propia casa (ver `geo-polymarket.js`).
// Las cinco regiones de Render — Oregón, Ohio, Virginia, Fráncfort y Singapur — están todas bloqueadas.
//
// QUÉ HACE, QUE ES POCO A PROPÓSITO. Recibe la INTENCIÓN ECONÓMICA ya decidida arriba («compra N acciones
// de este token a este precio»), la convierte en una orden firmada y la manda. No decide, no guarda nada,
// no obedece cualquier cifra (`PM_MAX_USD` es el último freno) y no expone ninguna otra ruta.
//
// SEGURIDAD. Todo menos `/health` exige `?key=` igual a `GP_RELAY_KEY`; sin llave, 404 seco. TLS propio
// autofirmado si `GP_RELAY_TLS_DIR` tiene `key.pem`/`cert.pem` — no hay dominio sobre la IP, así que el
// cliente no verifica CA, pero el tráfico va cifrado: las órdenes no cruzan Europa en claro.
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PM = require('./pm-relay');
const GEO = require('./geo-polymarket');

const PORT = Number(process.env.PORT) || 8443;
const TLSD = process.env.GP_RELAY_TLS_DIR || '';
const RK = String(process.env.GP_RELAY_KEY || '');

const j = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

// Comparación en tiempo constante, igual que en el brazo de Cloudbet: una llave que se adivina midiendo
// cuánto tarda el rechazo no es una llave.
function mismaLlave(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function cuerpoJson(req, tope = 8192) {
  return new Promise((resolve, reject) => {
    let n = 0; const trozos = [];
    req.on('data', (c) => { n += c.length; if (n > tope) { reject(new Error('cuerpo_demasiado_grande')); req.destroy(); return; } trozos.push(c); });
    req.on('end', () => { try { resolve(trozos.length ? JSON.parse(Buffer.concat(trozos).toString('utf8')) : null); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// El país se mide UNA vez al arrancar y se deja a la vista. Si esta máquina acabara en un país restringido
// —porque la lista cambió o porque se recreó en otro sitio— hay que verlo en el primer vistazo, no cuando
// la casa empiece a rechazar órdenes sin explicar por qué.
let ARRANQUE = { at: new Date().toISOString(), geo: null };
GEO.donde().then((g) => {
  ARRANQUE.geo = g;
  console.log('[pm-relay] país:', g.pais, '| puede abrir:', g.puede_abrir, '|', g.por_que || g.error);
  if (g.puede_abrir === false) console.error('[pm-relay] ⚠️  ESTA MÁQUINA NO PUEDE ABRIR POSICIÓN EN POLYMARKET');
}).catch(() => {});

const manejar = async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const p = url.pathname;

  // Salud sin llave: es lo que mira el vigilante. No dice nada que no se pueda decir en abierto.
  if (p === '/health') {
    return j(res, 200, { ok: true, at: new Date().toISOString(), brazo: 'polymarket',
      pais: (ARRANQUE.geo && ARRANQUE.geo.pais) || null,
      puede_abrir: (ARRANQUE.geo && ARRANQUE.geo.puede_abrir) != null ? ARRANQUE.geo.puede_abrir : null,
      configurado: !!(process.env.PM_PRIVATE_KEY && process.env.PM_MAKER_ADDRESS) });
  }

  if (!RK || !mismaLlave(String(url.searchParams.get('key') || ''), RK)) return j(res, 404, { error: 'No encontrado' });

  try {
    if (p === '/pm/diag' || p === '/diag') return j(res, 200, { ...(await PM.diag()), arranque: ARRANQUE });
    if (p === '/pm/geo') return j(res, 200, await GEO.donde());

    if ((p === '/pm/order' || p === '/pm/ensayo') && req.method === 'POST') {
      let body; try { body = await cuerpoJson(req); } catch (e) { return j(res, 400, { error: 'cuerpo ilegible: ' + e.message }); }
      const fn = p === '/pm/ensayo' ? PM.ensayo : PM.colocar;
      return j(res, 200, await fn(body));
    }
    if (p === '/pm/estado') return j(res, 200, await PM.estadoOrden(String(url.searchParams.get('id') || '')));
    if (p === '/pm/tipofirma' && req.method === 'POST') {
      return j(res, 200, await PM.detectarTipoFirma({ tokenId: String(url.searchParams.get('token') || '') }));
    }
    if (p === '/pm/cancelar' && req.method === 'POST') return j(res, 200, await PM.cancelar(String(url.searchParams.get('id') || '')));
  } catch (e) { return j(res, 200, { ok: false, error: String((e && e.message) || e).slice(0, 200) }); }

  return j(res, 404, { error: 'No encontrado' });
};

let server;
if (TLSD) {
  try {
    server = https.createServer({ key: fs.readFileSync(path.join(TLSD, 'key.pem')), cert: fs.readFileSync(path.join(TLSD, 'cert.pem')) }, manejar);
  } catch (e) { console.error('[pm-relay] TLS pedido pero ilegible, caigo a HTTP:', e.message); }
}
if (!server) server = http.createServer(manejar);
server.listen(PORT, () => console.log('[pm-relay] escuchando en', PORT, '· TLS:', !!TLSD, '· clave:', !!process.env.PM_PRIVATE_KEY, '· llave de acceso:', !!RK));
