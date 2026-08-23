// data-providers/oddspapi.js — 348 CASAS, Y LAS QUE FALTABAN (19-ago).
//
// QUÉ RESUELVE, medido hoy contra la cuenta real y no prometido:
//
//   · DOTA 2, que era el agujero declarado del cuarto deporte. Tenía 3 casas, CERO cierres guardados y
//     CERO picks desde que existe. Aquí, el primer partido que se miró —Iron Wing vs Team Spirit en The
//     International— trae 95 CASAS y 26 mercados en UNA sola llamada: ganador, total de mapas con siete
//     líneas, hándicap de mapas con quince, y ganador de cada mapa. Las familias que su motor ya sabe
//     valorar.
//     Sobre el arbitraje conviene no exagerar, porque la primera lectura sí exageró: al mejor precio de
//     cada lado el ganador sumaba 99,51 % y el ganador del mapa 1 un 99,0 %. Son negativos de verdad, pero
//     de medio punto y con las dos patas en Kalshi, Polymarket y un casino cripto — es decir, dentro de lo
//     que se come la comisión de un exchange. Lo que este proveedor cambia no es "hay dinero gratis", es
//     que un mercado que tenía TRES casas pasa a tener noventa y cinco, y con eso el mejor precio deja de
//     ser una lotería.
//
//   · TENIS, que es donde vive el "mercado ineficiente" del que llevamos semanas hablando. The Odds API
//     publica por torneo y en la práctica nos daba DOS (Cincinnati ATP y WTA). Aquí, en tres días: 459
//     partidos, 240 con cuotas, en 43 torneos distintos — Challengers de Quebec, Cancún y Kingston, ITF,
//     UTR. Ahí es donde una casa blanda se equivoca; en Cincinnati no.
//
//   · LOS CUATRO ESPORTS como deportes de primera (Dota 16, CS 17, LoL 18, Valorant 61), más MMA y boxeo.
//
// LO QUE NO TRAE: motorsport. No existe en las 69 categorías, así que F1 sigue dependiendo de Kalshi —que
// por cierto aparece AQUÍ DENTRO como una casa más, así que este proveedor también es una segunda lectura
// del mismo libro.
//
// ── LA ECONOMÍA, QUE AQUÍ MANDA MÁS QUE EN NINGÚN OTRO PROVEEDOR ────────────────────────────────────────
// El plan de prueba son 250 PETICIONES EN TOTAL, no por hora ni por día. Y se cobra por LLAMADA, no por
// tamaño: una respuesta con 95 casas y 462 KB cuesta exactamente lo mismo que una vacía. Eso invierte por
// completo la forma de pedir respecto a The Odds API:
//   · Se pide ANCHO y pocas veces. `/odds` con muchas casas de golpe, nunca una casa por llamada.
//   · Los 4xx TAMBIÉN cuentan (lo dice su documentación y se comprobó: dos parámetros mal gastaron dos
//     créditos). Así que los parámetros se validan aquí antes de salir a la red.
//   · `/historical-odds` es GRATIS Y NO SE CUENTA NUNCA. Devuelve la serie completa de precios con su
//     marca de tiempo y su límite — es decir, el CIERRE, que es la vara de esta casa. Para todo lo que sea
//     reconstruir CLV, este es el camino y no cuesta un solo crédito.
//   · `/account` no se cuenta y nunca se bloquea: se usa como contador antes de gastar.
//
// Por eso este módulo lleva un PRESUPUESTO DURO. Sin él, un barrido descuidado se come la prueba entera en
// dos minutos y nos deja sin saber si el proveedor sirve.
//
// PURO salvo la red: sin disco, sin db.
'use strict';

const BASE = 'https://api.oddspapi.io/v4';
const UA = 'GPSimulador/1.0 (codigo@gpsimulador.com)';

const key = () => String(process.env.ODDSPAPI_KEY || '').trim();
const enabled = () => !!key();

// PRESUPUESTO: tope de peticiones de pago que este proceso puede gastar. Por defecto MUY bajo, porque el
// plan de prueba es de 250 en total y agotarlo sin querer no tiene vuelta atrás.
const budget = () => Math.max(0, +(process.env.ODDSPAPI_BUDGET || 40));
const G = { spent: 0, lastAccount: null, lastAccountAt: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.set(k, String(v));
  u.set('apiKey', key());
  return u.toString();
}

// `billable` distingue lo que gasta de lo que no. `/historical-odds` y `/account` son gratis: no tocan el
// contador ni el presupuesto.
async function call(path, params, { billable = true, timeout = 45000, tries = 2 } = {}) {
  if (!enabled()) throw new Error('sin ODDSPAPI_KEY');
  if (billable && G.spent >= budget()) throw new Error(`presupuesto agotado (${G.spent}/${budget()} peticiones de pago en este proceso)`);
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${BASE}${path}?${qs(params)}`, {
        headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(timeout),
      });
      // 429 por LIMITADOR DE RITMO (no por cuota): se comprobó pidiendo cuatro deportes seguidos. Se espera
      // y se reintenta; no cuenta como crédito porque no llega al endpoint.
      if (r.status === 429) { last = new Error('429 ritmo'); await sleep(6000 * (i + 1)); continue; }
      const body = await r.json().catch(() => null);
      // OJO: los 4xx SÍ gastan crédito. Se contabilizan igual que un 200, o el contador miente.
      if (billable) G.spent++;
      if (!r.ok) throw new Error((body && body.error && body.error.message) || ('HTTP ' + r.status));
      return body;
    } catch (e) {
      last = e;
      if (/presupuesto|sin ODDSPAPI_KEY/.test(e.message)) throw e;
      if (i === tries - 1) break;
      await sleep(1500);
    }
  }
  throw last || new Error('agotado');
}

// ── CUENTA (gratis, nunca bloqueada) ────────────────────────────────────────────────────────────────────
async function account({ ttlMs = 60e3 } = {}) {
  if (G.lastAccount && Date.now() - G.lastAccountAt < ttlMs) return G.lastAccount;
  const j = await call('/account', {}, { billable: false });
  const s = (j.subscriptions || []).find((x) => x.is_active) || (j.subscriptions || [])[0] || {};
  const out = {
    plan: s.plan || null, limite: s.request_limit ?? null, usados: s.request_count ?? null,
    restantes: (s.request_limit != null && s.request_count != null) ? s.request_limit - s.request_count : null,
    casas: Object.keys(s.bookmakers || {}).length,
    deportes: (s.sport_ids || []).length,
    websocket: !!s.websocket_access,
    gastado_en_este_proceso: G.spent, presupuesto: budget(),
  };
  G.lastAccount = out; G.lastAccountAt = Date.now();
  return out;
}

// ── CATÁLOGOS (1 crédito cada uno; cachear fuerte, cambian de mes en mes) ────────────────────────────────
const CAT = {};
async function sports({ ttlMs = 24 * 3600e3 } = {}) {
  if (CAT.sports && Date.now() - CAT.sportsAt < ttlMs) return CAT.sports;
  const j = await call('/sports', {});
  CAT.sports = j; CAT.sportsAt = Date.now();
  return j;
}
async function tournaments(sportId, { ttlMs = 6 * 3600e3 } = {}) {
  const k = 'tour' + sportId;
  if (CAT[k] && Date.now() - CAT[k + 'At'] < ttlMs) return CAT[k];
  const j = await call('/tournaments', { sportId });
  CAT[k] = j; CAT[k + 'At'] = Date.now();
  return j;
}

// NUESTROS DEPORTES → LOS SUYOS. Solo se declaran los que esta casa ya modela; el resto existe pero no nos
// sirve de nada tenerlo escrito aquí.
const SPORT = {
  futbol: 10, baloncesto: 11, tenis: 12, beisbol: 13, nfl: 14, hockey: 15,
  dota2: 16, cs2: 17, lol: 18, valorant: 61, mma: 20, boxeo: 21,
};

// ── PARTIDOS ────────────────────────────────────────────────────────────────────────────────────────────
// `from`/`to` son OBLIGATORIOS con sportId suelto y no pueden distar más de 10 días. Se valida aquí: un
// 400 cuesta lo mismo que un 200 y no trae nada.
async function fixtures(sport, { fromISO = null, toISO = null, days = 3 } = {}) {
  const sportId = typeof sport === 'number' ? sport : SPORT[sport];
  if (!sportId) throw new Error('deporte desconocido: ' + sport);
  const from = fromISO || new Date().toISOString();
  const to = toISO || new Date(Date.parse(from) + Math.min(9, days) * 864e5).toISOString();
  if (Date.parse(to) - Date.parse(from) > 10 * 864e5) throw new Error('la ventana no puede pasar de 10 días');
  const j = await call('/fixtures', { sportId, from, to });
  return (Array.isArray(j) ? j : []).map((f) => ({
    id: f.fixtureId, sport_id: f.sportId, tournament_id: f.tournamentId,
    tournament: f.tournamentName || null, category: f.categoryName || null,
    a: f.participant1Name || null, b: f.participant2Name || null,
    a_abbr: f.participant1Abbr || null, b_abbr: f.participant2Abbr || null,
    start: f.startTime || null, has_odds: !!f.hasOdds, status: f.statusName || null,
  }));
}

// ── CUOTAS DE UN PARTIDO, CON TODAS LAS CASAS DE GOLPE ───────────────────────────────────────────────────
// UNA llamada, N casas: es la única forma sensata de gastar aquí. `odds-by-tournaments` exige UNA casa por
// llamada, así que para comparar precios sale carísimo y no se usa.
function flattenOdds(j) {
  const out = { fixture_id: j.fixtureId, a: j.participant1Name, b: j.participant2Name,
    tournament: j.tournamentName, start: j.startTime, books: {}, markets: {} };
  for (const [book, bv] of Object.entries(j.bookmakerOdds || {})) {
    if (bv.bookmakerIsActive === false) continue;
    out.books[book] = { url: bv.fixturePath || null, suspended: !!bv.suspended };
    for (const [mid, m] of Object.entries(bv.markets || {})) {
      for (const [oid, o] of Object.entries(m.outcomes || {})) {
        for (const p of Object.values(o.players || {})) {
          if (!p || !p.active || !(p.price > 1)) continue;
          const slot = (out.markets[mid] = out.markets[mid] || {});
          const side = (slot[oid] = slot[oid] || []);
          side.push({ book, price: p.price, limit: p.limit ?? null,
            player: p.playerName || null, at: p.changedAt || null });
        }
      }
    }
  }
  for (const m of Object.values(out.markets)) for (const s of Object.values(m)) s.sort((x, y) => y.price - x.price);
  return out;
}

async function odds(fixtureId, { books = null, format = 'decimal', verbosity = 3 } = {}) {
  if (!fixtureId) throw new Error('falta fixtureId');
  const j = await call('/odds', { fixtureId, bookmakers: books ? books.join(',') : null,
    oddsFormat: format, verbosity });
  return flattenOdds(j);
}

// ── EL HISTÓRICO, QUE ES GRATIS ─────────────────────────────────────────────────────────────────────────
// Devuelve la SERIE COMPLETA de precios de cada salida, con marca de tiempo y límite. El último punto antes
// del inicio ES el cierre, que es contra lo que esta casa mide todo. No cuenta para la cuota: nunca.
// Por eso, siempre que la pregunta sea "¿a cuánto cerró?", se viene aquí y no a `/odds`.
async function historicalOdds(fixtureId, { books = null } = {}) {
  if (!fixtureId) throw new Error('falta fixtureId');
  const j = await call('/historical-odds', { fixtureId, bookmakers: books ? books.join(',') : null },
    { billable: false });
  const out = { fixture_id: j.fixtureId, series: {} };
  for (const [book, bv] of Object.entries(j.bookmakers || {})) {
    for (const [mid, m] of Object.entries(bv.markets || {})) {
      for (const [oid, o] of Object.entries(m.outcomes || {})) {
        for (const pts of Object.values(o.players || {})) {
          if (!Array.isArray(pts) || !pts.length) continue;
          const k = `${mid}|${oid}`;
          (out.series[k] = out.series[k] || {})[book] = pts
            .filter((x) => x && x.price > 1)
            .map((x) => ({ at: x.createdAt, price: x.price, limit: x.limit ?? null, active: x.active !== false }));
        }
      }
    }
  }
  return out;
}

// EL CIERRE: el último precio ACTIVO antes del inicio del partido. Si no hay hora de inicio, el último de
// la serie. Se calcula aquí y no en cada motor, para que "cierre" signifique lo mismo en toda la casa.
function closingFrom(serie, startISO) {
  const t = startISO ? Date.parse(startISO) : Infinity;
  const out = {};
  for (const [k, byBook] of Object.entries(serie.series || {})) {
    for (const [book, pts] of Object.entries(byBook)) {
      const prev = pts.filter((x) => x.active && Date.parse(x.at) <= t);
      const last = prev.length ? prev[prev.length - 1] : null;
      if (last) (out[k] = out[k] || {})[book] = { price: last.price, at: last.at, limit: last.limit };
    }
  }
  return out;
}

// ── LOS MERCADOS QUE ESTA CASA SABE VALORAR ─────────────────────────────────────────────────────────────
// El catálogo completo son 32.815 filas y 9 MB POR DEPORTE: pedirlo en caliente sería absurdo. Estos son
// los identificadores comprobados sobre partidos reales de esports; lo demás se ignora sin ruido.
const MARKET = {
  16: { 161: 'SERIE', 163: 'TOTAL_MAPAS', 165: 'TOTAL_MAPAS', 167: 'TOTAL_MAPAS', 169: 'TOTAL_MAPAS',
    1611: 'TOTAL_MAPAS', 1613: 'TOTAL_MAPAS', 1615: 'TOTAL_MAPAS',
    1617: 'HANDICAP', 1619: 'HANDICAP', 1621: 'HANDICAP', 1623: 'HANDICAP', 1625: 'HANDICAP',
    1627: 'HANDICAP', 1629: 'HANDICAP', 1631: 'HANDICAP', 1633: 'HANDICAP', 1635: 'HANDICAP',
    1637: 'HANDICAP', 1639: 'HANDICAP', 1641: 'HANDICAP', 1643: 'HANDICAP', 1645: 'HANDICAP',
    1647: 'MAPA_1', 1649: 'MAPA_2', 1651: 'MAPA_3' },
};
const familyOf = (sportId, marketId) => (MARKET[sportId] || {})[marketId] || null;

// ── ARBITRAJE Y MEJOR PRECIO, sobre lo ya descargado (no cuesta nada) ───────────────────────────────────
// Dos salidas, dos casas distintas, implícitas por debajo de 1. Se devuelve SIEMPRE el margen, también
// cuando no hay arbitraje: saber que un mercado paga el 104 % es información aunque no se pueda ejecutar.
// DOS SALIDAS NO SIGNIFICAN DOS CARAS, y esto casi se publica mal. La primera versión daba por hecho que un
// mercado con dos identificadores de salida era un mercado de dos caras, y sobre el primer partido de Dota
// eso produjo "arbitrajes" del −45 % y del −47 %. No eran arbitrajes: en el mercado 1625 las dos salidas
// suman el 58 % de probabilidad implícita y en el 1637 suman el 155 %. Dos caras complementarias SIEMPRE
// suman algo por encima de 1 (el margen de la casa); un 58 % dice que esas salidas no reparten el espacio
// entre las dos — falta una tercera, o el proveedor las agrupa de otra forma.
//
// Un arbitraje falso del 45 % no es un error pequeño: es exactamente la clase de número que destruye la
// credibilidad de una plataforma el día que alguien lo intenta ejecutar. Así que ahora la estructura se
// COMPRUEBA antes de opinar: si la suma de implícitas al mejor precio cae fuera de una banda razonable, no
// se dice "arbitraje", se dice "no entiendo este mercado" — que es lo que de verdad pasa.
//
// La banda: por debajo de 0,95 ningún mercado real de dos caras puede estar (sería un 5 % de arbitraje al
// mejor precio de 89 casas, y eso no existe); por encima de 1,35 tampoco (un 35 % de margen no es una casa
// cobrando, es otra cosa). Entre 0,95 y 1 sí puede haber arbitraje de verdad y ahí se dice.
const SUMA_MIN = 0.95, SUMA_MAX = 1.35;

function twoWayEdge(market) {
  const sides = Object.keys(market || {});
  if (sides.length !== 2) return null;
  const [s1, s2] = sides.map((k) => market[k][0]).filter(Boolean);
  if (!s1 || !s2) return null;
  const sum = 1 / s1.price + 1 / s2.price;
  const coherente = sum >= SUMA_MIN && sum <= SUMA_MAX;
  return {
    mejor: { [sides[0]]: s1, [sides[1]]: s2 },
    implicita_pct: +(100 * sum).toFixed(2),
    margen_pct: +(100 * (sum - 1)).toFixed(2),
    // SOLO se declara arbitraje sobre una estructura que se entiende
    arbitraje: coherente && sum < 1,
    estructura_ok: coherente,
    aviso: coherente ? null
      : `las dos salidas suman ${(100 * sum).toFixed(0)} % de implícita: no son las dos caras de un mismo mercado, así que ni el margen ni un arbitraje significan nada aquí`,
    // el consenso sin margen solo tiene sentido si la estructura reparte el espacio
    p_justa: coherente ? { [sides[0]]: +((1 / s1.price) / sum).toFixed(4), [sides[1]]: +((1 / s2.price) / sum).toFixed(4) } : null,
  };
}

// ── SONDA ───────────────────────────────────────────────────────────────────────────────────────────────
// Gasta como mucho UNA petición de pago por deporte pedido, y por defecto NINGUNA: la cuenta es gratis.
// SONDA DE PROFUNDIDAD (23-ago) — la que decide si se paga y por QUÉ casa.
// `probe` cuenta partidos, que responde "¿hay mercado?". Esto responde las tres preguntas que de verdad
// mandan en una tarifa que cobra POR CASA: qué casas cotizan, qué familias cotizan, y cuántas líneas
// alternativas hay por familia. Sin líneas alternativas el feed no vale nada para nosotros: 85 de nuestros
// 89 fallos de CLV en CS2 son literalmente "el cierre no lleva esa línea".
// Cuesta 2 créditos por deporte (partidos + cuotas). El histórico va de regalo y se mira igual, porque
// confirma lo único que importa de verdad: que se puede reconstruir un cierre.
async function depth({ deportes = [], dias = 3 } = {}) {
  const out = { at: new Date().toISOString(), cuenta: null, deportes: {}, errores: [] };
  try { out.cuenta = await account(); } catch (e) { out.errores.push('cuenta: ' + e.message); return out; }
  for (const d of deportes) {
    const sportId = SPORT[d];
    try {
      const fx = await fixtures(d, { days: dias });
      const con = fx.filter((x) => x.has_odds);
      const reg = { partidos: fx.length, con_cuotas: con.length,
        torneos: new Set(con.map((x) => x.tournament)).size };
      if (!con.length) { reg.nota = 'ningún partido con cuotas en la ventana'; out.deportes[d] = reg; continue; }
      // se mira el PRIMERO con cuotas: una llamada trae todas las casas y todos los mercados de ese partido
      const el = con[0];
      reg.mirado = `${el.a} vs ${el.b} · ${el.tournament} · ${el.start}`;
      const o = await odds(el.id);
      const casas = Object.keys(o.books).sort();
      reg.casas = casas.length;
      reg.casas_lista = casas;
      // ¿están las tres que ya usamos?
      const busca = (re) => casas.filter((c) => re.test(c));
      reg.nuestras = { pinnacle: busca(/pinnacle/i), bovada: busca(/bovada/i), cloudbet: busca(/cloudbet/i),
        kalshi: busca(/kalshi/i), polymarket: busca(/polymarket/i) };
      // familias y LÍNEAS ALTERNATIVAS: cuántos identificadores de mercado distintos caen en cada familia
      const fam = {};
      for (const mid of Object.keys(o.markets)) {
        const f = familyOf(sportId, +mid) || ('SIN_MAPEAR:' + mid);
        const g = (fam[f] = fam[f] || { lineas: 0, mercados: [], casas: new Set() });
        g.lineas++; g.mercados.push(+mid);
        for (const lado of Object.values(o.markets[mid])) for (const q of lado) g.casas.add(q.book);
      }
      reg.familias = Object.fromEntries(Object.entries(fam).map(([k, v]) =>
        [k, { lineas_alternativas: v.lineas, casas_que_la_cotizan: v.casas.size }]));
      reg.mercados_totales = Object.keys(o.markets).length;
      // el histórico NO cuesta: se comprueba que existe serie y que hay cierre reconstruible
      try {
        const h = await historicalOdds(el.id);
        const cl = closingFrom(h, el.start);
        reg.historico = { series: Object.keys(h.series).length, con_cierre: Object.keys(cl).length,
          gratis: true };
      } catch (e) { reg.historico = { error: e.message }; }
      out.deportes[d] = reg;
    } catch (e) { out.errores.push(`${d}: ${e.message}`); }
  }
  out.gastado_en_esta_sonda = G.spent;
  return out;
}

async function probe({ deportes = [], dias = 3 } = {}) {
  const out = { enabled: enabled(), at: new Date().toISOString(), cuenta: null, deportes: {}, errores: [] };
  if (!enabled()) { out.why = 'sin ODDSPAPI_KEY en el entorno'; return out; }
  try { out.cuenta = await account(); } catch (e) { out.errores.push('cuenta: ' + e.message); return out; }
  for (const d of deportes) {
    try {
      const fx = await fixtures(d, { days: dias });
      const con = fx.filter((x) => x.has_odds);
      out.deportes[d] = { partidos: fx.length, con_cuotas: con.length,
        torneos: new Set(con.map((x) => x.tournament)).size,
        ejemplo: con[0] ? `${con[0].a} vs ${con[0].b} · ${con[0].tournament}` : null };
    } catch (e) { out.errores.push(`${d}: ${e.message}`); }
  }
  out.gastado_en_esta_sonda = G.spent;
  return out;
}

module.exports = { enabled, account, sports, tournaments, fixtures, odds, historicalOdds,
  closingFrom, twoWayEdge, familyOf, flattenOdds, probe, depth, SPORT, MARKET, budget,
  gastado: () => G.spent };
