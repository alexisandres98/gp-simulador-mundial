// AUDITORÍA DEL RECONCILIADOR, con una casa de mentira. Aquí hay DINERO REAL detrás, así que cada rama que
// puede añadir o dejar de añadir una fila al libro se recorre a mano antes de tocar producción.
//
//   node real-executor/auditoria-reconciliar.js
//
// Sin red: se sustituye `fetch` por un reenviador falso que sirve el libro de la casa por páginas.
'use strict';
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync('/tmp/gp-recon-');
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.GP_REAL_RELAY_URL = 'https://reenviador-de-mentira';
process.env.GP_REAL_RELAY_TOKEN = 'secreto-de-mentira';
process.env.GP_REAL_ENABLED = '0';

// la casa de mentira TAMBIÉN para las lecturas por referencia: `preguntarPorReferencias` pide el módulo de
// Cloudbet en caliente, así que se precarga en la caché de require igual que hace auditoria.js.
const CBPATH = require.resolve(path.join(__dirname, '..', 'market-scanner', 'venues', 'cloudbet.js'));
let POR_REFERENCIA = {};          // ref → apuesta de la casa (o null si la casa dice que no la tiene)
let REFS_QUE_FALLAN = new Set();  // ref → la petición revienta (no sabemos nada)
require.cache[CBPATH] = { id: CBPATH, filename: CBPATH, loaded: true, exports: {
  // el reconciliador habla GraphQL en crudo a propósito: necesita distinguir "no la tengo" de "no pude"
  gql: async (k, q, vars) => {
    const ref = vars.ref;
    if (REFS_QUE_FALLAN.has(ref)) return { ok: false, data: null, errors: [{ message: 'Internal server error' }], raw: null };
    const b = Object.prototype.hasOwnProperty.call(POR_REFERENCIA, ref) ? POR_REFERENCIA[ref] : null;
    return { ok: true, status: 200, data: { bet: b }, errors: null, raw: null };
  },
  ESTADOS_LIQUIDADOS: new Set(['WIN', 'LOSS', 'PUSH', 'HALF_WIN', 'HALF_LOSS', 'PARTIAL']),
} };
process.env.CLOUDBET_API_KEY = 'llave-de-mentira';

const S = require('./store');
const R = require('./reconciliar');

let ok = 0, ko = 0;
const t = (n, c, extra) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

// ── la casa de mentira ──────────────────────────────────────────────────────────────────────────────────
let LIBRO_CASA = [];
let PAGINAS_SERVIDAS = 0;
global.fetch = async (url, opt) => {
  PAGINAS_SERVIDAS++;
  if (!String(url).endsWith('/historial')) throw new Error('el reconciliador solo puede llamar a /historial, llamó a ' + url);
  const auth = String((opt.headers || {}).authorization || '');
  if (auth !== 'Bearer secreto-de-mentira') throw new Error('sin secreto');
  const { offset, limit } = JSON.parse(opt.body);
  const lote = LIBRO_CASA.slice(offset, offset + limit);
  return { ok: true, json: async () => ({ ok: true, status: 200, gql: { data: { bets: lote, accountBalances: [{ currency: 'USDT', amount: '1234.5' }] } } }) };
};

const apuestaCasa = (pickId, envio, extra = {}) => ({
  referenceId: S.refIdDe(pickId, envio), sportsKey: 'soccer', eventId: '999',
  eventName: extra.eventName || 'Equipo A vs Equipo B',
  marketUrl: extra.marketUrl || 'soccer.total_bookings/under?total=4.5',
  currency: 'USDT', price: extra.price || 1.75, stake: extra.stake || 40,
  side: 'BACK', returnAmount: extra.returnAmount ?? null,
  betStatus: extra.betStatus || 'ACCEPTED', betErrorCode: null,
});

// ── el libro nuestro de partida ─────────────────────────────────────────────────────────────────────────
const L = S.load();
L.bets = [
  // (a) una que está bien en los dos libros
  { ref_id: S.refIdDe('cdp_igual', 0), envios: 0, pick_id: 'cdp_igual', match: 'Igual A vs Igual B',
    status: 'PLACED', stake: 40, odds_real: 1.75, odds_sombra: 1.8, placed_at: '2026-09-04T08:00:00.000Z' },
  // (b) una con el importe distinto al de la casa
  { ref_id: S.refIdDe('cdp_descuadre', 0), envios: 0, pick_id: 'cdp_descuadre', match: 'Desc A vs Desc B',
    status: 'PLACED', stake: 29, odds_real: 1.60, odds_sombra: 1.6, placed_at: '2026-09-04T08:05:00.000Z' },
  // (c) la damos por colocada y la casa no la tiene: FANTASMA
  { ref_id: S.refIdDe('cdp_fantasma', 0), envios: 0, pick_id: 'cdp_fantasma', match: 'Fant A vs Fant B',
    status: 'PLACED', stake: 40, odds_real: 2.0, odds_sombra: 2.0, placed_at: '2026-09-04T08:10:00.000Z' },
  // (d) colocada a mano por la web: la casa no la devuelve con nuestra referencia y NO debe ser fantasma
  { ref_id: S.refIdDe('cdp_manual', 0), envios: 0, pick_id: 'cdp_manual', match: 'Man A vs Man B',
    status: 'PLACED', via: 'manual', stake: 5, odds_real: 2.4, odds_sombra: 2.4 },
  // (e) colocada tras dos rechazos: la casa la tiene bajo la referencia del envío 2, no la del 0
  { ref_id: S.refIdDe('cdp_reenviada', 2), envios: 2, pick_id: 'cdp_reenviada', match: 'Reen A vs Reen B',
    status: 'PLACED', stake: 40, odds_real: 1.9, odds_sombra: 1.9 },
];
S.save();

const sombra = [
  { pick_id: 'cdp_perdida1', id: 'sh_p1', match: 'Perdida1 A vs Perdida1 B', league: 'premier', line: 4.5, odds: 1.80, model_prob: 0.66, kickoff_at: '2026-09-04T19:00:00Z' },
  { pick_id: 'cdp_perdida2', id: 'sh_p2', match: 'Perdida2 A vs Perdida2 B', league: 'seriea', line: 5.5, odds: 1.55, model_prob: 0.70, kickoff_at: '2026-09-04T23:30:00Z' },
  { pick_id: 'cdp_igual', id: 'sh_ig', match: 'Igual A vs Igual B', league: 'liga', line: 4.5, odds: 1.8, model_prob: 0.6, kickoff_at: '2026-09-04T19:00:00Z' },
];
const pickIds = [...sombra.map((s) => s.pick_id), 'cdp_descuadre', 'cdp_fantasma', 'cdp_manual', 'cdp_reenviada'];

LIBRO_CASA = [
  apuestaCasa('cdp_igual', 0),
  apuestaCasa('cdp_descuadre', 0, { stake: 40 }),                     // la casa cobró 40, el libro dice 29
  apuestaCasa('cdp_reenviada', 2, { price: 1.9 }),                    // bajo la referencia del envío 2
  apuestaCasa('cdp_perdida1', 0, { stake: 40, price: 1.72, eventName: 'Perdida1 A vs Perdida1 B' }),
  apuestaCasa('cdp_perdida2', 0, { stake: 40, price: 1.51, betStatus: 'WIN', returnAmount: 20.4,
    marketUrl: 'soccer.total_bookings/under?total=5.5', eventName: 'Perdida2 A vs Perdida2 B' }),
  { referenceId: '11111111-1111-4111-8111-111111111111', eventName: 'Apuesta a mano de Alexis',
    marketUrl: 'soccer.match_odds/home', currency: 'USDT', price: 2.1, stake: 10, betStatus: 'ACCEPTED' },
];

(async () => {
  console.log('\n── 1. COMPARAR (solo mira) ─────────────────────────────────────────');
  const c = await R.comparar({ pickIds, sombra });
  t('lee el libro de la casa entero', c.ok && c.casa.apuestas === 6 && c.casa.completo, c.casa);
  t('encuentra las 2 huérfanas', c.huerfanas.length === 2, c.huerfanas.map((h) => h.pick_id));
  t('las atribuye a su pick', c.huerfanas.map((h) => h.pick_id).sort().join() === 'cdp_perdida1,cdp_perdida2');
  t('detecta el descuadre de importe, y solo ese', c.descuadres.length === 1
    && c.descuadres[0].pick_id === 'cdp_descuadre'
    && c.descuadres[0].stake.casa === 40 && c.descuadres[0].stake.libro === 29, c.descuadres);
  t('el descuadre trae también la diferencia de precio', c.descuadres[0].precio
    && c.descuadres[0].precio.casa === 1.75 && c.descuadres[0].precio.libro === 1.6, c.descuadres[0].precio);
  t('una fila que coincide en todo NO sale como descuadre', !c.descuadres.some((d) => d.pick_id === 'cdp_igual' || d.pick_id === 'cdp_reenviada'));
  t('detecta el fantasma', c.fantasmas.length === 1 && c.fantasmas[0].pick_id === 'cdp_fantasma', c.fantasmas.map((f) => f.pick_id));
  t('NO marca como fantasma la colocada a mano', !c.fantasmas.some((f) => f.pick_id === 'cdp_manual'));
  t('reconoce la colocada con referencia de reenvío', !c.huerfanas.some((h) => h.pick_id === 'cdp_reenviada')
    && !c.fantasmas.some((f) => f.pick_id === 'cdp_reenviada'));
  t('aparta la apuesta ajena como desconocida', c.desconocidas.length === 1 && /a mano/.test(c.desconocidas[0].evento), c.desconocidas);
  t('dice que NO cuadra', c.cuadra === false);
  t('comparar no toca el libro', S.load().bets.length === 5);

  console.log('\n── 2. REPARAR en seco ──────────────────────────────────────────────');
  const seco = await R.reparar({ pickIds, sombra, aplicar: false, modo: 'listado' });
  t('anuncia 2 inserciones', seco.aplicado === false && seco.insertaria === 2, seco.insertaria);
  t('en seco no escribe nada', S.load().bets.length === 5);

  console.log('\n── 3. REPARAR de verdad ────────────────────────────────────────────');
  const ap = await R.reparar({ pickIds, sombra, aplicar: true, modo: 'listado' });
  const L2 = S.load();
  t('inserta 2 filas', ap.insertadas === 2 && L2.bets.length === 7, { ins: ap.insertadas, n: L2.bets.length });
  const p1 = L2.bets.find((b) => b.pick_id === 'cdp_perdida1');
  t('la fila entra como PLACED', p1 && p1.status === 'PLACED', p1 && p1.status);
  t('con el stake y la cuota DE LA CASA', p1 && p1.stake === 40 && p1.odds_real === 1.72, p1 && [p1.stake, p1.odds_real]);
  t('con la referencia correcta', p1 && p1.ref_id === S.refIdDe('cdp_perdida1', 0));
  t('marcada como reconciliada', p1 && p1.origen === 'reconciliacion' && !!p1.reconciliado_at);
  t('enriquecida desde el sombra (liga, saque, prob)', p1 && p1.league === 'premier' && p1.kickoff_at === '2026-09-04T19:00:00Z' && p1.model_prob === 0.66);
  t('calcula el deslizamiento contra la cuota del sombra', p1 && p1.slippage_pct === -4.44, p1 && p1.slippage_pct);
  const p2 = L2.bets.find((b) => b.pick_id === 'cdp_perdida2');
  t('la línea sale de la url del mercado', p2 && p2.line === 5.5, p2 && p2.line);
  t('una ya resuelta en la casa también entra como PLACED', p2 && p2.status === 'PLACED' && p2.estado_casa_al_reconciliar === 'WIN');
  t('NO inventa la hora de colocación', p1 && p1.placed_at === null);
  t('el importe cuenta para la parada diaria', (L2.dias[new Date().toISOString().slice(0, 10)] || {}).apostado === 80,
    L2.dias[new Date().toISOString().slice(0, 10)]);
  t('la desconocida NO se inserta', !L2.bets.some((b) => b.ref_id === '11111111-1111-4111-8111-111111111111'));
  t('el fantasma NO se borra', L2.bets.some((b) => b.pick_id === 'cdp_fantasma'));
  t('el descuadre NO se toca', L2.bets.find((b) => b.pick_id === 'cdp_descuadre').stake === 29);

  console.log('\n── 4. IDEMPOTENCIA (lo que impide duplicar dinero) ─────────────────');
  const otra = await R.reparar({ pickIds, sombra, aplicar: true, modo: 'listado' });
  t('la segunda pasada no inserta nada', otra.insertadas === 0, otra.insertadas);
  t('el libro sigue con 7 filas', S.load().bets.length === 7);
  t('y ahora dice que cuadra salvo fantasma/descuadre', otra.huerfanas.length === 0);
  const tercera = await R.reparar({ pickIds, sombra, aplicar: true, modo: 'listado' });
  t('la tercera tampoco', tercera.insertadas === 0 && S.load().bets.length === 7);

  console.log('\n── 5. EL LIBRO DE LA CASA A MEDIAS ─────────────────────────────────');
  // si solo se pudo leer una página, un "fantasma" puede ser una página que falta: hay que decirlo
  const parcial = await R.comparar({ pickIds, sombra, limit: 2, maxPaginas: 1 });
  t('avisa de que la lectura fue parcial', parcial.casa.completo === false && !!parcial.aviso_fantasmas, parcial.aviso_fantasmas);

  console.log('\n── 6. SIN REENVIADOR ───────────────────────────────────────────────');
  const url0 = process.env.GP_REAL_RELAY_URL; process.env.GP_REAL_RELAY_URL = '';
  const sin = await R.comparar({ pickIds, sombra });
  t('no revienta y lo dice', sin.ok === false && sin.why === 'reenviador_sin_configurar', sin.why);
  process.env.GP_REAL_RELAY_URL = url0;

  console.log('\n── 7. LA CASA NO CONTESTA ──────────────────────────────────────────');
  const f0 = global.fetch; global.fetch = async () => { throw new Error('ETIMEDOUT'); };
  const caido = await R.reparar({ pickIds, sombra, aplicar: true, modo: 'listado' });
  global.fetch = f0;
  t('no inserta nada si no pudo leer la casa', caido.ok === false, caido.why);
  t('y el libro queda intacto', S.load().bets.length === 7);

  console.log('\n── 8. LA CASA CONTESTA 200 PERO CON ERROR (el fallo del 4-sep) ─────');
  // Cloudbet devuelve HTTP 200 con errors:[INTERNAL_SERVER_ERROR] y data:{bets:null}. La primera versión de
  // esto lo convertía en "la casa no tiene ninguna apuesta" y marcaba 47 filas nuestras como fantasmas.
  const fOK = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ ok: true, status: 200,
    gql: { errors: [{ message: 'Internal server error' }], data: { bets: null, accountBalances: null } } }) });
  const conError = await R.comparar({ pickIds, sombra });
  t('un error de la casa NO es un libro vacío', conError.ok === false, conError.why);
  t('y no produce ni un fantasma', !conError.fantasmas, Object.keys(conError));
  const repError = await R.reparar({ pickIds, sombra, aplicar: true, modo: 'listado' });
  t('con error de la casa no se toca el libro', repError.ok === false && S.load().bets.length === 7);

  // y el caso hermano: data.bets es null sin errors
  global.fetch = async () => ({ ok: true, json: async () => ({ ok: true, status: 200, gql: { data: { bets: null } } }) });
  const nulo = await R.comparar({ pickIds, sombra });
  t('un `bets` que no es lista tampoco es libro vacío', nulo.ok === false, nulo.why);

  // y el caso más traicionero: la casa devuelve [] de verdad mientras nosotros tenemos colocadas
  global.fetch = async () => ({ ok: true, json: async () => ({ ok: true, status: 200, gql: { data: { bets: [], accountBalances: [] } } }) });
  const vacio = await R.comparar({ pickIds, sombra });
  t('libro vacío con colocadas nuestras se asume lectura fallida', vacio.ok === false, vacio.why);
  global.fetch = fOK;

  console.log('\n── 9. MODO POR REFERENCIA (el que la casa sí contesta) ─────────────');
  // el libro tiene ahora 7 filas; se le pregunta a la casa por cada referencia
  POR_REFERENCIA = {};
  for (const b of S.load().bets) {
    if (b.pick_id === 'cdp_fantasma') continue;                       // la casa NO la tiene
    POR_REFERENCIA[b.ref_id] = { referenceId: b.ref_id, price: b.odds_real, stake: b.stake, betStatus: 'ACCEPTED' };
  }
  // una pick reciente que NO está en nuestro libro y que la casa SÍ tiene: huérfana
  const refHuerfana = S.refIdDe('cdp_nueva_perdida', 0);
  POR_REFERENCIA[refHuerfana] = { referenceId: refHuerfana, eventName: 'Nueva A vs Nueva B',
    marketUrl: 'soccer.total_bookings/under?total=3.5', price: 1.66, stake: 40, betStatus: 'ACCEPTED', currency: 'USDT' };
  const sombra2 = [...sombra, { pick_id: 'cdp_nueva_perdida', id: 'sh_new', match: 'Nueva A vs Nueva B',
    league: 'ligue1', line: 3.5, odds: 1.7, model_prob: 0.64, kickoff_at: new Date().toISOString() }];
  const porRef = await R.compararPorReferencia({ pickIds: [...pickIds, 'cdp_nueva_perdida'], sombra: sombra2, pausaMs: 0 });
  t('el modo por referencia funciona sin listado', porRef.ok === true && porRef.modo === 'referencias');
  t('encuentra la huérfana preguntando una a una', porRef.huerfanas.length === 1
    && porRef.huerfanas[0].pick_id === 'cdp_nueva_perdida', porRef.huerfanas.map((h) => h.pick_id));
  t('marca fantasma solo la que la casa niega', porRef.fantasmas.length === 1
    && porRef.fantasmas[0].pick_id === 'cdp_fantasma', porRef.fantasmas.map((f) => f.pick_id));
  t('avisa de que no puede ver apuestas ajenas', !!porRef.nota_desconocidas);

  console.log('\n── 10. UNA REFERENCIA QUE NO CONTESTA NO ES UN FANTASMA ────────────');
  REFS_QUE_FALLAN = new Set(S.load().bets.filter((b) => b.pick_id === 'cdp_igual').map((b) => b.ref_id));
  for (const b of S.load().bets) if (b.pick_id === 'cdp_igual') { for (let e = 0; e <= 2; e++) REFS_QUE_FALLAN.add(S.refIdDe('cdp_igual', e)); }
  const conFallo = await R.compararPorReferencia({ pickIds, sombra, pausaMs: 0 });
  t('la que no contestó NO sale como fantasma', !conFallo.fantasmas.some((f) => f.pick_id === 'cdp_igual'), conFallo.fantasmas.map((f) => f.pick_id));
  t('sale como sin_respuesta y se avisa', conFallo.sin_respuesta.some((x) => x.pick_id === 'cdp_igual') && !!conFallo.aviso_fantasmas);
  REFS_QUE_FALLAN = new Set();

  console.log('\n── 11. REPARAR EN MODO REFERENCIA ──────────────────────────────────');
  const antes = S.load().bets.length;
  const rep = await R.reparar({ pickIds: [...pickIds, 'cdp_nueva_perdida'], sombra: sombra2, aplicar: true });
  t('inserta la huérfana encontrada por referencia', rep.insertadas === 1 && S.load().bets.length === antes + 1, rep.insertadas);
  const nueva = S.load().bets.find((b) => b.pick_id === 'cdp_nueva_perdida');
  t('con los datos de la casa', nueva && nueva.stake === 40 && nueva.odds_real === 1.66 && nueva.line === 3.5);
  const rep2 = await R.reparar({ pickIds: [...pickIds, 'cdp_nueva_perdida'], sombra: sombra2, aplicar: true });
  t('y sigue siendo idempotente', rep2.insertadas === 0 && S.load().bets.length === antes + 1);

  console.log('\n── 12. LOS TRES DESENLACES DE UNA LECTURA (el contrato que faltaba) ─');
  // esto es lo que confundía `betByReference`: devolvía null para "no la tengo" Y para "no pude preguntar".
  POR_REFERENCIA = { 'ref-existe': { referenceId: 'ref-existe', stake: 40, price: 1.7, betStatus: 'ACCEPTED' } };
  REFS_QUE_FALLAN = new Set(['ref-falla']);
  const e1 = await R.leerApuesta('k', 'ref-existe');
  const e2 = await R.leerApuesta('k', 'ref-no-esta');
  const e3 = await R.leerApuesta('k', 'ref-falla', { reintentos: 0 });
  t('existe → estado "existe" con la apuesta', e1.estado === 'existe' && e1.bet.stake === 40, e1);
  t('la casa dice que no la tiene → "no_existe"', e2.estado === 'no_existe', e2);
  t('la casa falla → "sin_respuesta", NUNCA "no_existe"', e3.estado === 'sin_respuesta' && !!e3.why, e3);
  REFS_QUE_FALLAN = new Set();

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* da igual */ }
  console.log(`\n${ok} comprobaciones en verde, ${ko} en rojo.`);
  process.exit(ko ? 1 : 0);
})();
