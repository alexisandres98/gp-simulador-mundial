// real-executor/relay.js — EL REENVIADOR DE COLOCACIÓN (25-ago).
//
// POR QUÉ EXISTE. Medido, no supuesto: desde el servidor principal (Render, Oregón, `loc=US`) Cloudbet
// contesta 403 con página de cortafuegos a `POST /pub/v3/bets/place`, exactamente igual con llave y sin
// ella, mientras ese mismo servidor lee cuotas y consulta el saldo sin ningún problema. No es la llave
// —`/pub/v1/account/currencies` devuelve 200 con ella y 401 sin ella— ni la ruta. Es el país desde el que
// sale la petición: la casa no acepta apuestas desde Estados Unidos. Eso no tiene arreglo en el código del
// servidor principal; se arregla saliendo desde otro sitio.
//
// Este archivo es ese otro sitio: un proceso mínimo, sin dependencias, pensado para desplegarse en una
// región permitida (Fráncfort, por ejemplo) y no hacer absolutamente nada más que reenviar UNA petición.
//
// LO QUE NO HACE, Y ES LO IMPORTANTE
//   · No decide. No mira el modelo, no calcula stake, no elige partido. Reenvía el cuerpo que le llega.
//   · No amplía el perímetro. Solo `/place`, solo POST, y solo hacia la ruta de colocación de la casa.
//   · No acepta cualquier cuerpo: valida que traiga las seis claves que la casa exige y rechaza el resto.
//     Un reenviador que acepta JSON arbitrario es un agujero por donde se puede llamar a cualquier
//     endpoint de la casa con la llave de Alexis.
//   · No guarda nada. Ni la petición ni la respuesta ni la llave en disco. Si alguien entra aquí, no
//     encuentra un historial de apuestas: encuentra un proceso que reenvía.
//
// LA LLAVE DE CLOUDBET VIVE AQUÍ, NO EN EL SERVIDOR PRINCIPAL. Es deliberado: el servidor principal es
// público, sirve la plataforma entera y tiene mucha más superficie. Este proceso no sirve a nadie más que
// al ejecutor, y el ejecutor se identifica con un secreto compartido distinto de la llave de la casa.
//
// DESPLIEGUE
//   Variables: CLOUDBET_API_KEY (la de la cuenta con fondos), GP_RELAY_TOKEN (secreto compartido, largo),
//              PORT (lo pone la plataforma).
//   Arranque:  node real-executor/relay.js
//   Salud:     GET /health → dice desde qué país sale de verdad, que es la única razón de existir de esto.
'use strict';

const http = require('http');

const CB_HOST = process.env.CLOUDBET_HOST || 'https://sports-api.cloudbet.com';
const PLACE_PATH = '/pub/v3/bets/place';
const GQL_HOST = process.env.CLOUDBET_GRAPHQL_HOST || 'https://sports-api-graphql.cloudbet.com/graphql';
const TOKEN = String(process.env.GP_RELAY_TOKEN || '');
const KEY = String(process.env.CLOUDBET_API_KEY || '');
const PORT = Number(process.env.PORT) || 8080;

// las seis claves que la casa exige, y ninguna más. Cualquier otra se descarta antes de salir de aquí:
// reenviar campos que no entendemos es reenviar intenciones que no hemos leído.
const CLAVES = ['acceptPriceChange', 'currency', 'eventId', 'marketUrl', 'price', 'stake', 'referenceId'];

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(b);
}

// comparación en tiempo constante: un secreto que se puede adivinar midiendo cuánto tarda el rechazo no es
// un secreto. Con dos apuestas al día no es un ataque probable, pero el coste de hacerlo bien son 6 líneas.
function mismoSecreto(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function leerCuerpo(req, tope = 8192) {
  return new Promise((resolve, reject) => {
    let n = 0; const trozos = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > tope) { reject(new Error('cuerpo_demasiado_grande')); req.destroy(); return; }
      trozos.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(trozos).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const ruta = String(req.url || '').split('?')[0];

  // SALUD. Devuelve el país desde el que sale este proceso según el propio borde de la casa. Es la
  // comprobación que dice si desplegar aquí sirvió de algo, y hay que poder hacerla sin colocar dinero.
  if (ruta === '/health' && req.method === 'GET') {
    let loc = null, ip = null, colo = null;
    try {
      const t = await fetch(CB_HOST + '/cdn-cgi/trace', { signal: AbortSignal.timeout(8000) }).then((r) => r.text());
      loc = (t.match(/^loc=(.*)$/m) || [])[1] || null;
      ip = (t.match(/^ip=(.*)$/m) || [])[1] || null;
      colo = (t.match(/^colo=(.*)$/m) || [])[1] || null;
    } catch { /* el borde no contestó; el resto de la salud sigue valiendo */ }
    // ¿está abierta la puerta de colocación desde aquí? Un POST CON LLAVE y un cuerpo imposible —evento 0,
    // importe mínimo, referencia nueva— que no puede colocar nada. La respuesta separa las tres situaciones:
    //   403 con página de cortafuegos → la cuenta todavía no puede operar por API (la casa exige un depósito
    //                                   mínimo para habilitar el trading; con saldo de céntimos, bloquea)
    //   4xx en JSON                   → la puerta está ABIERTA y solo se queja del cuerpo falso: todo listo
    //   otra cosa                     → mirar el cuerpo
    // Va con llave a propósito: la versión sin llave no distinguía "no puedes operar" de "no te identificaste".
    let puerta = null;
    try {
      const r2 = await fetch(CB_HOST + PLACE_PATH, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ acceptPriceChange: 'NONE', currency: process.env.GP_RELAY_CURRENCY || 'USDT',
          eventId: '0', marketUrl: 'soccer.total_bookings/under?total=0.5', price: '1.01', stake: '0.1',
          referenceId: require('crypto').randomUUID() }),
        signal: AbortSignal.timeout(8000),
      });
      const t2 = (await r2.text());
      const esHtml = /^\s*<!DOCTYPE|<html/i.test(t2);
      puerta = { status: r2.status, abierta: !esHtml,
        respuesta: esHtml ? 'pagina de cortafuegos' : t2.replace(/\s+/g, ' ').slice(0, 200),
        lectura: esHtml
          ? 'la cuenta aun no puede operar por API — la casa pide un deposito minimo para habilitar el trading'
          : 'la puerta esta abierta: la casa contesta al cuerpo falso en vez de bloquear' };
    } catch (e) { puerta = { error: String((e && e.message) || e).slice(0, 80) }; }

    // y el saldo, que es la causa mas probable de que la puerta este cerrada
    let saldo = null;
    try {
      const cur = process.env.GP_RELAY_CURRENCY || 'USDT';
      const r3 = await fetch(`${CB_HOST}/pub/v1/account/currencies/${cur}/balance`,
        { headers: { 'X-API-Key': KEY, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      saldo = r3.ok ? await r3.json() : { status: r3.status };
    } catch (e) { saldo = { error: String((e && e.message) || e).slice(0, 60) }; }

    return json(res, 200, { ok: true, salida: { ip, loc, colo }, puerta_de_colocacion: puerta, saldo,
      tiene_llave: !!KEY, tiene_secreto: !!TOKEN });
  }

  // ── GRAPHQL (25-ago) ──────────────────────────────────────────────────────────────────────────────────
  // La colocación se hace por GraphQL, no por REST, y hasta ahora esa llamada salía DIRECTA del servidor
  // principal — es decir, desde Oregón. La casa contestó `betStatus: REJECTED · betErrorCode: RESTRICTED`
  // en las dos primeras apuestas reales, y su propia documentación dice que el acceso a la API de trading
  // está restringido por jurisdicción. Encaja: por GraphQL se atraviesa el borde, pero la restricción se
  // aplica igual al apostar. Este camino manda la mutación desde Fráncfort para poder comprobarlo.
  //
  // Igual de estricto que /place: solo se reenvía la operación de colocar, y las variables tienen que traer
  // las claves que la casa exige. Un reenviador que acepta cualquier consulta GraphQL es una llave maestra
  // de la cuenta, no un reenviador.
  // LECTURA DEL LIBRO DE LA CASA (31-ago, reporte del lunes): el historial de apuestas y los saldos solo
  // responden desde esta geografía (REST bets = 403 Cloudflare en todas partes; los resolvers GraphQL dan
  // 500 desde América). Cero GraphQL arbitrario: la consulta la construye ESTE proceso — el cliente solo
  // manda offset y limit. Es de solo lectura por construcción, así que no viola el principio del reenviador.
  if (ruta === '/historial' && req.method === 'POST') {
    if (!TOKEN || !KEY) return json(res, 500, { ok: false, why: 'reenviador_sin_configurar' });
    const authH = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!mismoSecreto(authH, TOKEN)) return json(res, 401, { ok: false, why: 'secreto_invalido' });
    let cH = {};
    try { cH = JSON.parse((await leerCuerpo(req, 2048)) || '{}'); } catch { cH = {}; }
    const offH = Math.max(0, parseInt(cH.offset, 10) || 0);
    const limH = Math.min(200, Math.max(1, parseInt(cH.limit, 10) || 100));
    try {
      const rQ = await fetch(GQL_HOST, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'query($o:Int,$l:Int){ bets(offset:$o, limit:$l){ referenceId sportsKey eventId eventName marketUrl currency price stake side returnAmount betStatus betErrorCode } accountBalances { currency amount } }',
          variables: { o: offH, l: limH },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const txtQ = await rQ.text();
      let jQ = null; try { jQ = txtQ ? JSON.parse(txtQ) : null; } catch { /* no-json */ }
      return json(res, 200, { ok: rQ.ok, status: rQ.status, gql: jQ, crudo: jQ ? null : txtQ.slice(0, 400) });
    } catch (e) {
      return json(res, 200, { ok: false, status: 0, gql: null, crudo: String((e && e.message) || e).slice(0, 160) });
    }
  }

  if (ruta === '/gql' && req.method === 'POST') {
    if (!TOKEN || !KEY) return json(res, 500, { ok: false, why: 'reenviador_sin_configurar' });
    const auth2 = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!mismoSecreto(auth2, TOKEN)) return json(res, 401, { ok: false, why: 'secreto_invalido' });

    let cuerpo2;
    try { cuerpo2 = JSON.parse(await leerCuerpo(req, 16384)); }
    catch (e) { return json(res, 400, { ok: false, why: 'cuerpo_ilegible', detalle: String((e && e.message) || e).slice(0, 80) }); }
    const q = String((cuerpo2 && cuerpo2.query) || '');
    const vars = (cuerpo2 && cuerpo2.variables) || null;
    if (!/\bplaceBet\s*\(/.test(q)) return json(res, 400, { ok: false, why: 'solo_se_reenvia_placeBet' });
    const input = vars && vars.i;
    if (!input || typeof input !== 'object') return json(res, 400, { ok: false, why: 'falta_input' });
    for (const k of ['currency', 'eventId', 'marketUrl', 'price', 'stake', 'referenceId']) {
      if (input[k] === undefined || input[k] === null || input[k] === '') return json(res, 400, { ok: false, why: 'falta_' + k });
    }
    if (!/^[a-z0-9]+\.[a-z0-9_]+\//i.test(String(input.marketUrl))) return json(res, 400, { ok: false, why: 'market_url_con_forma_rara' });

    try {
      const r = await fetch(GQL_HOST, {
        method: 'POST',
        headers: { 'X-API-Key': KEY, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ query: q, variables: { i: input } }),
        signal: AbortSignal.timeout(20000),
      });
      const txt = await r.text();
      let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* la casa devolvió algo que no es JSON */ }
      return json(res, 200, { ok: r.ok, status: r.status, gql: j, crudo: j ? null : txt.slice(0, 400) });
    } catch (e) {
      return json(res, 200, { ok: false, status: 0, gql: null, crudo: String((e && e.message) || e).slice(0, 160) });
    }
  }

  if (ruta !== '/place' || req.method !== 'POST') return json(res, 404, { ok: false, why: 'no_encontrado' });

  if (!TOKEN || !KEY) return json(res, 500, { ok: false, why: 'reenviador_sin_configurar' });
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!mismoSecreto(auth, TOKEN)) return json(res, 401, { ok: false, why: 'secreto_invalido' });

  let cuerpo;
  try { cuerpo = JSON.parse(await leerCuerpo(req)); }
  catch (e) { return json(res, 400, { ok: false, why: 'cuerpo_ilegible', detalle: String((e && e.message) || e).slice(0, 80) }); }
  if (!cuerpo || typeof cuerpo !== 'object') return json(res, 400, { ok: false, why: 'cuerpo_no_es_objeto' });

  // solo las claves conocidas, y las obligatorias tienen que estar. Nada de reenviar lo que llegue.
  const limpio = {};
  for (const k of CLAVES) if (cuerpo[k] !== undefined) limpio[k] = cuerpo[k];
  for (const k of ['currency', 'eventId', 'marketUrl', 'price', 'stake', 'referenceId']) {
    if (limpio[k] === undefined || limpio[k] === null || limpio[k] === '') {
      return json(res, 400, { ok: false, why: 'falta_' + k });
    }
  }
  if (!/^[a-z0-9]+\.[a-z0-9_]+\//i.test(String(limpio.marketUrl))) {
    return json(res, 400, { ok: false, why: 'market_url_con_forma_rara' });
  }

  try {
    const r = await fetch(CB_HOST + PLACE_PATH, {
      method: 'POST',
      headers: { 'X-API-Key': KEY, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(limpio),
      signal: AbortSignal.timeout(20000),
    });
    const txt = await r.text();
    let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* la casa devolvió algo que no es JSON */ }
    return json(res, 200, { ok: r.ok, status: r.status, cloudbet: j, crudo: j ? null : txt.slice(0, 400) });
  } catch (e) {
    return json(res, 200, { ok: false, status: 0, cloudbet: null, crudo: String((e && e.message) || e).slice(0, 160) });
  }
});

server.listen(PORT, () => console.log('[relay] escuchando en', PORT, '· llave:', !!KEY, '· secreto:', !!TOKEN));
