// data-providers/esports/pinnacle.js — LA CASA AFILADA (16-ago).
//
// POR QUÉ ESTA CASA Y NO OTRA CUALQUIERA. Hasta hoy esports tenía UNA sola fuente de precio (Cloudbet), y eso
// no es un detalle de cobertura: es lo que impedía que el producto funcionara. Sin una segunda casa no hay
// consenso, sin consenso no hay forma de saber si un precio está dormido o equivocado, y por eso `core.js`
// subía el listón 2,5 pp a toda pick — un impuesto permanente sobre un problema que se arregla trayendo otra
// casa. Pinnacle es además **la referencia de cierre del sector**: márgenes bajos, límites altos y sin
// limitación de cuentas ganadoras, así que su precio de cierre es el baremo con el que se mide el CLV. Si GP
// va a juzgarse por CLV —y así se juzga en los otros tres deportes— tiene que juzgarse contra este cierre.
//
// LO QUE PUBLICA DE VERDAD, MEDIDO EL 16-ago (no lo que promete el catálogo):
//   deporte 12 "E Sports" → 12 ligas vivas → CS2 (3 ligas), LoL (5), Valorant (3), Dota 2 (1)
//   un partido de CS2 al mejor de 3 trae 71 bloques de mercado:
//     periodo 0 (serie)  → ganador, hándicap de mapas ±1.5, total de mapas 2.5
//     periodo N (mapa N) → ganador del mapa, total de rondas (9 líneas), hándicap de rondas (11 líneas),
//                          total de rondas POR EQUIPO (6 líneas)
//   Eso es exactamente la superficie de familias derivadas donde esta casa decidió buscar señal.
//
// LO QUE **NO** DA, y conviene que quede escrito igual que se escribió para Cloudbet: **resultados no**. La
// API de invitado sirve el catálogo de apuesta, no el marcador. El histórico propio de CS2 sigue viniendo de
// `scripts/cs2-harvest.js`; esta casa aporta precio, no verdad.
//
// ADAPTADOR REEMPLAZABLE, la misma regla que el resto: nada fuera de este archivo sabe que existe Pinnacle.
// Se normaliza a la taxonomía de GP (SERIE / HANDICAP / TOTAL_MAPAS / MAPA / RONDAS / RONDAS_HANDICAP /
// RONDAS_EQUIPO) y se devuelve la misma forma de fila que devuelve Cloudbet.
'use strict';

const BASE = 'https://guest.api.arcadia.pinnacle.com/0.1';
const SPORT_ID = 12;                       // "E Sports"

// La clave de invitado es la que publica su propio cliente web: no es un secreto ni da acceso a nada más que
// al catálogo público. Se deja sobreescribible por entorno para el día que la roten sin tener que desplegar.
const GUEST_KEY = () => process.env.PINNACLE_GUEST_KEY || 'CmX2KcMrXuFmNg6YFbmTxE0y9CIrOi0R';

// El juego NO viene como campo: viene en el nombre de la liga ("CS2 - Esports World Cup"). Se reconoce por
// prefijo y lo que no casa se ignora en silencio en vez de colarse en el juego equivocado.
const LEAGUE_GAME = [
  [/^cs2\b|^counter[- ]?strike/i, 'cs2'],
  [/^league of legends\b|^lol\b/i, 'lol'],
  [/^valorant\b/i, 'valorant'],
  [/^dota ?2\b/i, 'dota2'],
];
const gameOfLeague = (name) => (LEAGUE_GAME.find(([re]) => re.test(String(name || '')))||[])[1] || null;

async function pinFetch(pathname, { tries = 3, timeoutMs = 15000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(BASE + pathname, {
        headers: {
          'x-api-key': GUEST_KEY(),
          accept: 'application/json',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 429) { await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(800 * (i + 1)); }
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1) AGENDA ------------------------------------------------------------------------------------------
// Se va por LIGA y no por deporte. `/sports/12/matchups` devuelve un recorte del catálogo y en la medición del
// 16-ago dejaba fuera partidos que sí estaban en su liga; recorrer las ligas cuesta una petición más y trae el
// catálogo completo. Los hijos (`parentId`) son mercados especiales, no partidos: se descartan aquí y no en la
// capa de arriba, que es donde se colarían como si fueran enfrentamientos reales.
async function fixtures(game, { days = 7 } = {}) {
  const leagues = await pinFetch(`/sports/${SPORT_ID}/leagues?all=false`);
  if (!Array.isArray(leagues)) return { game, events: [], competitions: [], available: false };
  const mine = leagues.filter((l) => gameOfLeague(l.name) === game);
  const events = [], comps = [], seen = new Set();
  const horizon = Date.now() + days * 864e5;
  for (const l of mine) {
    const rows = await pinFetch(`/leagues/${l.id}/matchups`);
    if (!Array.isArray(rows)) continue;
    comps.push({ key: String(l.id), name: l.name });
    for (const m of rows) {
      if (m.parentId || m.type !== 'matchup' || !m.participants || m.participants.length < 2) continue;
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const t = Date.parse(m.startTime || 0);
      if (!t || t > horizon) continue;
      events.push(normEvent(m, l, game));
    }
    await sleep(150);
  }
  events.sort((a, b) => Date.parse(a.start_at || 0) - Date.parse(b.start_at || 0));
  return { game, events, competitions: comps, available: true, at: new Date().toISOString() };
}

function normEvent(m, league, game) {
  const home = (m.participants || []).find((p) => p.alignment === 'home') || m.participants[0];
  const away = (m.participants || []).find((p) => p.alignment === 'away') || m.participants[1];
  return {
    id: `${game}:pin:${m.id}`,
    provider_id: String(m.id),
    game,
    competition: league.name || null,
    competition_key: String(league.id),
    start_at: m.startTime || null,
    status: m.status || null,
    // `bestOfX` viene declarado por la casa: es MEJOR que deducirlo de las líneas, que es lo que hay que
    // hacer con Cloudbet porque no lo declara. Cuando existe, manda.
    bo: Number.isFinite(m.bestOfX) && m.bestOfX > 0 ? m.bestOfX : null,
    home: { id: null, name: (home && home.name) || '—', abbr: null, country: null },
    away: { id: null, name: (away && away.name) || '—', abbr: null, country: null },
    name: `${(home && home.name) || '?'} vs ${(away && away.name) || '?'}`,
  };
}

// ---- 2) MERCADOS ----------------------------------------------------------------------------------------
// LA CONVERSIÓN QUE HAY QUE HACER BIEN O NADA DE LO DEMÁS VALE: Pinnacle publica en AMERICANO y todo el motor
// de GP razona en DECIMAL. −172 no es 1,72: es 1 + 100/172 = 1,5814. Confundirlas no da un error pequeño, da
// una ventaja inventada del orden de 10 pp en cada favorito.
const amToDec = (a) => {
  const n = Number(a);
  if (!Number.isFinite(n) || n === 0) return null;
  return +(n > 0 ? 1 + n / 100 : 1 + 100 / -n).toFixed(4);
};

// El periodo es la unidad: 0 es la SERIE, 1..N son los MAPAS. Con eso, la misma clave de mercado significa
// dos familias distintas según dónde esté — `ou` en periodo 0 es "total de mapas" y en periodo 1 es "total de
// rondas del mapa 1". Mapearlo sin mirar el periodo es el error obvio y caro.
function familyOf(type, period) {
  const serie = period === 0;
  if (type === 'moneyline') return serie ? ['SERIE', 'Ganador de la serie'] : ['MAPA', 'Ganador del mapa'];
  if (type === 'spread') return serie ? ['HANDICAP', 'Hándicap de mapas'] : ['RONDAS_HANDICAP', 'Hándicap de rondas'];
  if (type === 'total') return serie ? ['TOTAL_MAPAS', 'Total de mapas'] : ['RONDAS', 'Total de rondas del mapa'];
  if (type === 'team_total') return serie ? null : ['RONDAS_EQUIPO', 'Rondas del equipo'];
  return null;
}

async function markets(providerId, game) {
  if (!providerId) return null;
  const rows = await pinFetch(`/matchups/${providerId}/markets/related/straight`);
  if (!Array.isArray(rows)) return null;
  const wantId = String(providerId);
  const out = [];
  let disabled = 0, skippedSpecials = 0;
  for (const m of rows) {
    // LOS BLOQUES DE MERCADO ESPECIAL VIENEN MEZCLADOS EN LA MISMA RESPUESTA y traen `matchupId` de un hijo,
    // designaciones vacías y hasta veintidós precios en un solo bloque (un "jugador con más kills"). Colarlos
    // como si fueran el ganador del mapa 2 fabricaba precios absurdos: se filtran por el id del padre.
    if (String(m.matchupId) !== wantId) { skippedSpecials++; continue; }
    const fam = familyOf(m.type, m.period);
    if (!fam) continue;
    const prices = (m.prices || []).filter((p) => p && p.designation);
    if (!prices.length) { skippedSpecials++; continue; }
    if (String(m.status || 'open') !== 'open') { disabled += prices.length; continue; }

    // LA LÍNEA ES SIEMPRE LA DEL LOCAL, que es la convención con la que razona todo el motor (ver la nota
    // larga del hándicap en store.js). Pinnacle publica la línea por selección con el signo de esa selección:
    // home(−1.5) / away(+1.5). Se toma la del LOCAL y las dos filas salen con ese mismo valor; leer cada fila
    // con su propio signo es exactamente el error que en su día fabricó una ventaja de 41 pp.
    const homeP = prices.find((p) => p.designation === 'home');
    const isSideMarket = m.type === 'spread';
    const lineHome = homeP && homeP.points != null ? Number(homeP.points) : null;

    for (const p of prices) {
      const odds = amToDec(p.price);
      if (!(odds > 1)) { disabled++; continue; }
      const line = isSideMarket
        ? lineHome
        : (p.points != null ? Number(p.points) : null);
      out.push({
        family: fam[0], family_label: fam[1], market_key: m.key || `${m.type}:p${m.period}`,
        period: m.period === 0 ? 'serie' : `map_${m.period}`,
        map: m.period === 0 ? null : m.period,
        // en un total de equipo el lado es over/under y QUIÉN es el equipo va en `side` del bloque, no en la
        // designación — la misma separación que ya usa el resto del motor
        team: m.side === 'home' || m.side === 'away' ? m.side : null,
        line: Number.isFinite(line) ? line : null,
        side: String(p.designation).toLowerCase(),
        params: m.key || null,
        odds,
        max_stake: (m.limits || []).reduce((mx, l) => Math.max(mx, Number(l.amount) || 0), 0) || null,
        prob_implied: +(1 / odds).toFixed(6),
        alternate: !!m.isAlternate,
        book: 'pinnacle',
      });
    }
  }
  return {
    provider_id: wantId, game, markets: out,
    disabled_selections: disabled, specials_skipped: skippedSpecials,
    book: 'pinnacle', at: new Date().toISOString(),
  };
}

// ---- 3) RESULTADOS: TAMPOCO AQUÍ -------------------------------------------------------------------------
// La API de invitado sirve el catálogo de apuesta. El estado de un partido terminado deja de listarse y no hay
// endpoint de liquidación público. Se declara explícito, igual que con Cloudbet, para que nadie vuelva a
// gastar una tarde comprobándolo.
const RESULTS_UNAVAILABLE = {
  available: false,
  why: 'la API de invitado de Pinnacle sirve el catálogo de apuesta, no marcadores: un partido terminado desaparece del listado y no hay endpoint de liquidación público. Comprobado el 16-ago.',
};

module.exports = {
  BOOK: { key: 'pinnacle', name: 'Pinnacle', sharp: true, odds_format: 'americano→decimal',
    note: 'referencia de cierre del sector: márgenes bajos, límites altos y sin limitación de cuentas ganadoras. Es el precio contra el que se mide el CLV.' },
  fixtures, markets, RESULTS_UNAVAILABLE, gameOfLeague, amToDec, SPORT_ID,
};
