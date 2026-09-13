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
const GEO = require('./geo-polymarket');

const PK = () => String(process.env.PM_PRIVATE_KEY || '').trim();
const MAKER = () => String(process.env.PM_MAKER_ADDRESS || '').trim();          // la wallet con los fondos
// Por defecto `deposito`: toda cuenta de Polymarket creada desde el 4-may-2026 lo es, así que los tres
// tipos antiguos son la excepción, no la norma. El defecto era `proxy` de cuando creíamos lo contrario.
const TIPO_FIRMA = () => String(process.env.PM_SIG_TYPE || 'deposito').trim();  // deposito | proxy | safe | eoa
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
  // ¿coloca? POST vacío y sin firma: no puede colocar nada, y separa "bloqueado por región" de "vivo".
  // Comprobado: el cortafuegos geográfico salta ANTES que la autenticación, así que esta sonda no necesita
  // ni clave ni dinero y sirve para medir CUALQUIER servidor candidato.
  const esc = await C.pide('/order', { metodo: 'POST', cuerpo: {} });
  out.trading = { status: esc.status, cuerpo: (esc.texto || '').slice(0, 200) };
  out.bloqueado_por_region = /restricted in your region|geoblock/i.test(esc.texto || '');
  // Y el país con nombre y apellidos, más por qué está o no está permitido según la lista de la propia
  // casa. Sin esto, un `bloqueado_por_region: true` no dice si es cosa de la región o de un fallo de red.
  out.donde_estamos = await GEO.donde();
  out.veredicto = out.bloqueado_por_region
    ? `ESTA REGIÓN NO SIRVE (${out.donde_estamos.pais || '¿?'}): ${out.donde_estamos.por_que || 'el trading está bloqueado'}`
    : `la región permite colocar (${out.donde_estamos.pais || '¿?'}: ${out.donde_estamos.por_que || 'el 403 de región no aparece'})`;
  // ¿credenciales?
  if (pk && !out.bloqueado_por_region) {
    const c = await credenciales();
    out.credenciales = c.ok ? { ok: true, api_key_cola: String(c.credenciales.apiKey).slice(-6), cacheado: !!c.cacheado }
      : { ok: false, status: c.status, why: c.why || (c.texto || '').slice(0, 160) };
  }
  return out;
}

// ── LO QUE SE COMPRUEBA ANTES DE ESCRIBIR LA CLAVE PRIVADA ──────────────────────────────────────────────
// Vive aquí, y no dentro del manejador de la ruta, para poder probarlo: es el único sitio del sistema por
// donde pasa la clave privada de la cartera, y una comprobación que nadie ha ejercitado no es una
// comprobación. Devuelve `{ok:false, why}` o `{ok:true, firmante}` — y NO escribe nada: quien llama decide.
//
// Comprueba la forma de las dos cosas Y que la clave derive una dirección, que es lo que de verdad pilla el
// error típico: una clave de otra cuenta tiene la forma perfecta. Por eso se devuelve el firmante, para
// poder compararlo con el que muestra Polymarket ANTES de mandar un céntimo.
function validaAlta({ clave, maker } = {}) {
  const k = String(clave || '').trim();
  const m = String(maker || '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(k)) return { ok: false, why: 'la clave no tiene la forma 0x + 64 hex. No se ha escrito nada.' };
  if (!/^0x[0-9a-fA-F]{40}$/.test(m)) return { ok: false, why: 'la dirección no tiene la forma 0x + 40 hex. No se ha escrito nada.' };
  let firmante;
  try { firmante = S.direccionDe(k); }
  catch (e) { return { ok: false, why: 'esa clave no deriva una dirección: ' + e.message }; }
  return { ok: true, clave: k, maker: m, firmante,
    firmante_igual_maker: firmante.toLowerCase() === m.toLowerCase() };
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

// ── LOS PARÁMETROS DEL MERCADO SE PREGUNTAN, NO SE SUPONEN (13-sep) ─────────────────────────────────────
// Fallo encontrado probando contra la cuenta real: el ejecutor mandaba solo (token, lado, precio, tamaño) y
// el brazo asumía `tick 0.01` y `riesgo negativo: no`. Las dos suposiciones son falsas a menudo — el primer
// mercado que probé era de RIESGO NEGATIVO (se firma contra OTRO contrato, así que la firma habría sido
// inválida) y hay mercados con tick 0.001 (un precio que no encaja en el tick lo rechaza la casa). Ninguna
// de las dos cosas da un error entendible: dan "orden rechazada" a secas.
//
// El libro del token trae los tres datos de una sola llamada: `tick_size`, `neg_risk` y `min_order_size`.
// Se consultan SIEMPRE antes de firmar, y lo que venga en la petición solo sirve de respaldo si la casa no
// contesta. Una llamada más por orden a cambio de no firmar a ciegas.
async function paramsDeMercado(tokenId, respaldo = {}) {
  const r = await C.libro(String(tokenId));
  const j = r && r.json;
  if (j && (j.tick_size || j.neg_risk != null)) {
    return { tick: String(j.tick_size || respaldo.tick || '0.01'),
      negRisk: j.neg_risk != null ? !!j.neg_risk : !!respaldo.negRisk,
      min_order_size: Number(j.min_order_size) || null, de: 'el libro de la casa' };
  }
  // respaldo: los recursos sueltos, por si el libro viniera vacío (mercado sin liquidez)
  const [t, n] = await Promise.all([C.tickSize(String(tokenId)), C.negRisk(String(tokenId))]);
  const tick = t && t.json && (t.json.minimum_tick_size || t.json.tick_size);
  const neg = n && n.json && n.json.neg_risk;
  if (tick != null || neg != null) {
    return { tick: String(tick || respaldo.tick || '0.01'),
      negRisk: neg != null ? !!neg : !!respaldo.negRisk, min_order_size: null, de: 'tick-size + neg-risk' };
  }
  return { tick: String(respaldo.tick || '0.01'), negRisk: !!respaldo.negRisk, min_order_size: null,
    de: 'NO se pudo consultar: se usa lo que vino en la petición' };
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

  const mk = await paramsDeMercado(b.tokenId, b);
  if (mk.min_order_size && Number(b.size) < mk.min_order_size) {
    return { ok: false, rechazado_por_el_brazo: `la casa exige un mínimo de ${mk.min_order_size} acciones y se pidieron ${b.size}`, mercado: mk };
  }
  let orden, firma;
  try {
    orden = O.construir({
      tokenId: String(b.tokenId), lado: String(b.side).toUpperCase(),
      precio: String(b.price), tamano: String(b.size),
      tick: mk.tick, riesgoNegativo: mk.negRisk,
      maker, signer, tipoFirma: TIPO_FIRMA(),
      expiracion: String(b.expiration || '0'), orderType: String(b.orderType || 'GTC'),
    });
    firma = O.firmar(orden, pk);          // esto ya comprueba que la firma recupera al firmante
  } catch (e) { return { ok: false, rechazado_por_el_brazo: 'no se pudo construir/firmar: ' + e.message, mercado: mk }; }

  const c = await credenciales();
  if (!c.ok) return { ok: false, rechazado_por_el_brazo: 'sin credenciales de trading', detalle: c.why || c.texto };

  // EL `owner` DEL CUERPO ES LA CLAVE DE API, NO UNA DIRECCIÓN (13-sep). Es un UUID, y la casa lo compara
  // con la clave con la que viene firmada la petición: si no coincide —o si falta— contesta «the order
  // owner has to be the owner of the API KEY». Omitirlo nos costó cuatro rondas de sondas buscando el
  // problema en la identidad de las direcciones, que era donde no estaba.
  const cuerpo = O.cuerpo(orden, firma.firma, { owner: c.credenciales.apiKey });
  const r = await C.colocar({ cuerpoOrden: cuerpo, credenciales: c.credenciales, direccion: signer });
  return {
    ok: r.ok, status: r.status, respuesta: r.json, texto: r.json ? undefined : (r.texto || '').slice(0, 400),
    // lo que se envió, para poder reconciliar después sin guardar nada aquí
    enviado: { tokenId: cuerpo.order.tokenId, side: cuerpo.order.side, makerAmount: cuerpo.order.makerAmount,
      takerAmount: cuerpo.order.takerAmount, precio: orden.importes.precio, tamano: orden.importes.tamano,
      coste_usd: orden.importes.dinero_texto, signatureType: cuerpo.order.signatureType,
      digest: firma.digest, ref: b.ref || null,
      // de dónde salieron el tick y el contrato: si una orden se rechaza, esto dice si fue por suponerlos
      mercado: { tick: mk.tick, riesgo_negativo: mk.negRisk, min_order_size: mk.min_order_size, dato_de: mk.de },
      contrato: orden.dominio.verifyingContract },
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
  const mk = await paramsDeMercado(b.tokenId, b);
  const orden = O.construir({ tokenId: String(b.tokenId), lado: String(b.side).toUpperCase(),
    precio: String(b.price), tamano: String(b.size), tick: mk.tick,
    riesgoNegativo: mk.negRisk, maker, signer, tipoFirma: TIPO_FIRMA(),
    expiracion: String(b.expiration || '0'), orderType: String(b.orderType || 'GTC') });
  const firma = O.firmar(orden, pk);
  return { ok: true, ensayo: true, dentro_del_tope: coste <= MAX_USD(), coste_usd: +coste.toFixed(4),
    mercado: mk, contrato: orden.dominio.verifyingContract,
    cumple_minimo: mk.min_order_size ? Number(b.size) >= mk.min_order_size : null,
    cuerpo: O.cuerpo(orden, firma.firma, { owner: (await credenciales()).credenciales?.apiKey || null }),
    digest: firma.digest, firmante: signer };
}

// ── ALTA DE UNA CUENTA: averiguar lo que no se puede saber preguntando ──────────────────────────────────
// El tipo de firma depende de cómo se creó la cuenta y equivocarse hace que la casa rechace TODAS las
// órdenes sin decir por qué. La documentación da la tabla pero no un endpoint para consultarlo, así que se
// AVERIGUA — y se averigua SIN GASTAR NADA, con el truco de la orden que no puede llenarse:
//
//   se manda una orden de compra a un precio absurdamente bajo (0,01) sobre un token real. Si la firma es
//   válida, la casa la ACEPTA y la deja descansando en el libro, donde nunca se va a cruzar porque nadie
//   vende a ese precio. Si la firma es del tipo equivocado, la casa la rechaza. En cuanto contesta, se
//   cancela. Coste: cero. Certeza: total, porque es la propia casa la que valida.
//
// Esto es mejor que deducir el tipo de la dirección: las direcciones proxy se derivan con constantes de
// contrato que cambiarían sin avisarnos, y una deducción equivocada se descubriría con dinero encima.
// EL ORDEN IMPORTA: `deposito` va primero desde el 13-sep porque toda cuenta creada a partir del
// 4-may-2026 es una Deposit Wallet. Probar los tres legados antes era gastar tres órdenes rechazadas para
// llegar al que casi siempre va a ser el bueno.
const TIPOS_A_PROBAR = ['deposito', 'proxy', 'safe', 'eoa'];

// EL TIPO QUE MIDE EL ALTA TIENE QUE SER EL QUE USA EL BRAZO, Y ESO HAY QUE COMPROBARLO (13-sep).
// Fallo encontrado en la prueba de punta a punta: la sonda dijo `deposito` —y era verdad— pero la máquina
// tenía `PM_SIG_TYPE=proxy` fijado, así que las órdenes de verdad se firmaban como Proxy y la casa las
// rechazaba una a una. El alta salía en verde. Medir una cosa y usar otra es la peor combinación posible:
// da confianza justo donde no la hay. Ahora el alta compara y lo dice.
function avisoDeTipo(detectado) {
  const puesto = TIPO_FIRMA();
  if (puesto === detectado) return { tipo_en_uso: puesto, coincide: true };
  return { tipo_en_uso: puesto, coincide: false,
    AVISO: `la casa dice que esta cuenta es «${detectado}» pero el brazo está firmando como «${puesto}». ` +
      `Mientras no coincidan, TODAS las órdenes serán rechazadas.`,
    siguiente_paso: detectado === 'deposito'
      ? 'quita PM_SIG_TYPE del entorno del brazo (el valor por defecto ya es «deposito») y reinicia'
      : `pon PM_SIG_TYPE=${detectado} en el entorno del brazo y reinicia` };
}
async function detectarTipoFirma({ tokenId, precio = '0.01', tamano = null } = {}) {
  const pk = PK(); if (!pk) return { ok: false, why: 'falta PM_PRIVATE_KEY' };
  const maker = MAKER(); if (!maker) return { ok: false, why: 'falta PM_MAKER_ADDRESS' };
  if (!/^\d+$/.test(String(tokenId || ''))) return { ok: false, why: 'hace falta un tokenId real de un mercado abierto' };
  const signer = S.direccionDe(pk);
  const c = await credenciales();
  if (!c.ok) return { ok: false, why: 'sin credenciales de trading', detalle: c.why || c.texto };

  // los parámetros reales del mercado: firmar la prueba contra el contrato equivocado haría fallar TODOS
  // los tipos y nos haría concluir que ninguno vale
  const mk = await paramsDeMercado(tokenId);
  // 5 acciones a 0,01 = 5 céntimos comprometidos, y a ese precio no se cruza nunca
  const size = String(tamano || mk.min_order_size || 5);
  const intentos = [];
  for (const tipo of TIPOS_A_PROBAR) {
    let r;
    try {
      const orden = O.construir({ tokenId: String(tokenId), lado: 'BUY', precio: String(precio), tamano: size,
        tick: mk.tick, riesgoNegativo: mk.negRisk, maker, signer, tipoFirma: tipo, orderType: 'GTC' });
      const firma = O.firmar(orden, pk);
      r = await C.colocar({ cuerpoOrden: O.cuerpo(orden, firma.firma, { owner: c.credenciales.apiKey }),
        credenciales: c.credenciales, direccion: signer });
    } catch (e) { intentos.push({ tipo, error: e.message }); continue; }
    const id = r.json && (r.json.orderID || r.json.orderId || r.json.id);
    const aceptada = !!(r.ok && r.json && r.json.success !== false && id);
    const mensaje = (r.json && (r.json.errorMsg || r.json.error)) || (r.json ? undefined : (r.texto || '').slice(0, 160));
    // «NO HAY SALDO» ES UN SÍ. Si la casa se queja del dinero es porque ya validó todo lo demás: la firma,
    // el tipo, la identidad y el cuerpo. Tratarlo como un fallo más haría que una cuenta bien configurada
    // pero sin fondear diera «ningún tipo de firma fue aceptado» — que es exactamente el diagnóstico que
    // manda a buscar el problema donde no está. Lo sabemos porque nos pasó: la cuenta de pruebas tenía
    // 0,0081 $ y el mensaje fue «balance: 8100, order amount: 50000».
    const porSaldo = /balance|allowance/i.test(String(mensaje || ''));
    intentos.push({ tipo, status: r.status, aceptada, firma_validada: aceptada || porSaldo, mensaje });
    if (!aceptada && porSaldo) {
      return { ok: true, tipo_firma: tipo, mercado: mk, orden_de_prueba: null, cancelada: null, intentos,
        nota: 'la firma es CORRECTA: la casa solo se queja del saldo, que es lo último que mira',
        falta: 'fondear la cuenta', ...avisoDeTipo(tipo) };
    }
    if (aceptada) {
      // ACEPTADA: este es el tipo. Se cancela inmediatamente — la orden nunca se iba a cruzar, pero dejarla
      // ahí sería dejar capital comprometido por una prueba.
      const cancel = await C.cancelar({ id, credenciales: c.credenciales, direccion: signer });
      return { ok: true, tipo_firma: tipo, mercado: mk, orden_de_prueba: id,
        cancelada: !!(cancel.ok), cancel_status: cancel.status, intentos, ...avisoDeTipo(tipo) };
    }
  }
  return { ok: false, why: 'ningún tipo de firma fue aceptado', intentos,
    pista: 'mira el mensaje de cada intento: «maker address not allowed» en todos significa que la cuenta es de un tipo que no estamos probando' };
}

const estadoOrden = async (id) => {
  const c = await credenciales(); if (!c.ok) return { ok: false, why: 'sin credenciales' };
  return C.estadoOrden({ id, credenciales: c.credenciales, direccion: S.direccionDe(PK()) });
};
// ── ¿A NOMBRE DE QUIÉN VAN LAS CREDENCIALES? (13-sep) ───────────────────────────────────────────────────
// Con la firma de Deposit Wallet ya correcta, la casa dejó de quejarse del `maker` y pasó a quejarse de
// otra cosa: «the order owner has to be the owner of the API KEY». O sea: la firma vale y el problema es
// de IDENTIDAD — las credenciales están a nombre de la clave (el dueño) y la orden va a nombre de la
// wallet.
//
// Hay dos direcciones y tres sitios donde puede ir cada una: el mensaje `ClobAuth` que se firma, la
// cabecera con la que se piden las credenciales, y la cabecera con la que se manda la orden. Adivinar cuál
// es cuál cuesta una tarde; preguntárselo a la casa cuesta ocho llamadas. Esto es lo segundo.
//
// Cada intento coloca una compra a 0,01 que no puede cruzarse —nadie vende a ese precio— y la cancela en
// cuanto la casa contesta. Lo que se lee no es si la orden entró, sino QUÉ dijo la casa: los mensajes
// distintos son el dato.
async function probarIdentidad({ tokenId, precio = '0.01' } = {}) {
  const pk = PK(); if (!pk) return { ok: false, why: 'falta PM_PRIVATE_KEY' };
  const maker = MAKER(); if (!maker) return { ok: false, why: 'falta PM_MAKER_ADDRESS' };
  if (!/^\d+$/.test(String(tokenId || ''))) return { ok: false, why: 'hace falta un tokenId real de un mercado abierto' };
  const duenyo = S.direccionDe(pk);
  const mk = await paramsDeMercado(tokenId);
  const size = String(mk.min_order_size || 5);

  const combos = [
    { nombre: 'auth=dueño · cabecera=dueño', authDir: duenyo, cabecera: duenyo },
    { nombre: 'auth=dueño · cabecera=wallet', authDir: duenyo, cabecera: maker },
    { nombre: 'auth=wallet · cabecera=wallet', authDir: maker, cabecera: maker },
    { nombre: 'auth=wallet · cabecera=dueño', authDir: maker, cabecera: duenyo },
  ];
  const salida = [];
  for (const c of combos) {
    const paso = { ...c };
    let creds;
    try {
      // `esperada: duenyo` siempre: firma la clave que tenemos, diga lo que diga el mensaje
      let r = await C.credenciales({ clavePrivada: pk, direccion: c.authDir, esperada: duenyo, crear: false });
      if (!r.ok) r = await C.credenciales({ clavePrivada: pk, direccion: c.authDir, esperada: duenyo, crear: true });
      paso.credenciales = r.ok ? { ok: true, cola: String(r.credenciales.apiKey).slice(-6) }
        : { ok: false, status: r.status, dice: (r.texto || '').slice(0, 140) };
      if (!r.ok) { salida.push(paso); continue; }
      creds = r.credenciales;
    } catch (e) { paso.credenciales = { ok: false, error: e.message }; salida.push(paso); continue; }

    try {
      const orden = O.construir({ tokenId: String(tokenId), lado: 'BUY', precio: String(precio), tamano: size,
        tick: mk.tick, riesgoNegativo: mk.negRisk, maker, signer: duenyo, tipoFirma: 'deposito', orderType: 'GTC' });
      const firma = O.firmar(orden, pk);
      const r2 = await C.colocar({ cuerpoOrden: O.cuerpo(orden, firma.firma, { owner: creds.apiKey }),
        credenciales: creds, direccion: c.cabecera });
      const id = r2.json && (r2.json.orderID || r2.json.orderId || r2.json.id);
      paso.orden = { status: r2.status, aceptada: !!(r2.ok && id),
        dice: (r2.json && (r2.json.error || r2.json.errorMsg)) || (r2.texto || '').slice(0, 160) };
      if (id) {
        const cancel = await C.cancelar({ id, credenciales: creds, direccion: c.cabecera });
        paso.orden.id = id; paso.orden.cancelada = !!cancel.ok;
      }
    } catch (e) { paso.orden = { error: e.message }; }
    salida.push(paso);
    if (paso.orden && paso.orden.aceptada) break;         // encontrado: no se gastan más
  }
  const bueno = salida.find((s) => s.orden && s.orden.aceptada);
  return { ok: !!bueno, mercado: mk, duenyo, wallet: maker, combinaciones: salida,
    veredicto: bueno ? `la que vale es: ${bueno.nombre}` : 'ninguna combinación fue aceptada — mira qué dijo la casa en cada una' };
}

const cancelar = async (id) => {
  const c = await credenciales(); if (!c.ok) return { ok: false, why: 'sin credenciales' };
  return C.cancelar({ id, credenciales: c.credenciales, direccion: S.direccionDe(PK()) });
};

module.exports = { diag, colocar, ensayo, estadoOrden, cancelar, credenciales, detectarTipoFirma, probarIdentidad, paramsDeMercado, valida, validaAlta, CLAVES };
