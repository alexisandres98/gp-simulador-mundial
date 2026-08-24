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
    // y una prueba REAL de si la ruta de colocación está abierta desde aquí: un POST sin llave y con un
    // cuerpo imposible. No puede colocar nada. Si vuelve 401, la puerta está abierta y solo falta la llave;
    // si vuelve 403, este sitio tampoco sirve y hay que desplegar en otra región.
    let puerta = null;
    try {
      const r2 = await fetch(CB_HOST + PLACE_PATH, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currency: 'USDT', eventId: '0', marketUrl: 'no.existe/under?total=0', price: '0', stake: '0' }),
        signal: AbortSignal.timeout(8000),
      });
      puerta = { status: r2.status, abierta: r2.status !== 403 };
    } catch (e) { puerta = { error: String((e && e.message) || e).slice(0, 80) }; }
    return json(res, 200, { ok: true, salida: { ip, loc, colo }, puerta_de_colocacion: puerta,
      tiene_llave: !!KEY, tiene_secreto: !!TOKEN });
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
