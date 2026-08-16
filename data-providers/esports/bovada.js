// data-providers/esports/bovada.js — LA CASA ANCHA (16-ago).
//
// LA TERCERA CASA, Y LA QUE MÁS SUPERFICIE TRAE. Se probaron veintiséis proveedores el 16-ago (el registro
// está al final de este archivo). Casi todos cierran la puerta: Cloudflare (Thunderpick, Stake, Duelbits,
// Oddspedia), bloqueo geográfico (GG.BET), 403 de portal (DraftKings, bet365, Betcris) o simplemente no
// publican esports (Kalshi: cero eventos; The Odds API: cero deportes electrónicos de setenta y cinco).
// Rivalry responde 200 y devuelve el array VACÍO — se deja escrito para que nadie la vuelva a intentar.
//
// Bovada sí, y con diferencia: **78 bloques de mercado en un partido de CS2 al mejor de 3**, y no son los
// mismos que trae Pinnacle. Ahí está su valor: Pinnacle es el precio afilado; Bovada es la anchura.
//
//   familias que aporta (medido, no prometido)
//   ─────────────────────────────────────────────────────────────────────────────────────────
//   serie      ganador · hándicap de mapas (principal y alternativo) · total de mapas · marcador exacto
//   por mapa   ganador · total de rondas · hándicap de rondas
//   kills      total de kills del mapa (3 líneas) · hándicap asiático de kills (3 líneas)
//   props      prórroga del mapa · par/impar de rondas   ← familias que NINGUNA otra casa de GP cotiza
//
// La prórroga es la que más importa de esa lista, y no por casualidad: es la familia donde el motor de CS2
// tiene una medición propia que el precio no tiene —la tasa real de prórroga POR MAPA, sacada de 48.678
// mapas del histórico de GP (Overpass 8,2 % · Cache 13,9 %)— mientras la casa cotiza un número plano.
//
// LO QUE **NO** DA: resultados. Ninguna de las tres casas los da. El histórico propio sigue viniendo de
// `scripts/cs2-harvest.js`; las casas aportan precio, no verdad.
//
// ADAPTADOR REEMPLAZABLE, misma regla que las otras dos: nada fuera de este archivo sabe que existe Bovada.
'use strict';

const BASE = 'https://www.bovada.lv/services/sports/event/coupon/events/A/description';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// El juego se lee del PATH del evento, que es donde Bovada lo pone. No hay campo de deporte por evento.
const GAME_PATH = { cs2: 'counter-strike-2', lol: 'league-of-legends', valorant: 'valorant', dota2: 'dota-2' };

async function bvFetch(url, { tries = 3, timeoutMs = 15000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json, text/plain, */*' },
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
// El listado del cupón es SUPERFICIAL a propósito por parte de la casa: trae los tres mercados principales y
// nada más. La profundidad (los 78 bloques) solo aparece pidiendo el evento por su propio enlace, y por eso
// `markets()` hace una segunda petición en vez de reutilizar esta. Cambiarlo por "una sola llamada" cuesta el
// 96 % de los mercados.
async function fixtures(game, { days = 7 } = {}) {
  const p = GAME_PATH[game];
  if (!p) return { game, events: [], competitions: [], available: false };
  const j = await bvFetch(`${BASE}/esports/${p}?marketFilterId=def&preMatchOnly=true&lang=en`);
  if (!Array.isArray(j)) return { game, events: [], competitions: [], available: false };
  const events = [], comps = new Map(), seen = new Set();
  const horizon = Date.now() + days * 864e5;
  for (const g of j) {
    for (const e of g.events || []) {
      if (!e.link || seen.has(e.id)) continue;
      seen.add(e.id);
      const t = Number(e.startTime) || Date.parse(e.startTime || 0);
      if (!t || t > horizon) continue;
      const home = (e.competitors || []).find((c) => c.home) || (e.competitors || [])[0];
      const away = (e.competitors || []).find((c) => !c.home) || (e.competitors || [])[1];
      // la competición vive en el enlace: /esports/counter-strike-2/<liga>[/<fase>]/<partido>
      const seg = String(e.link).split('/').filter(Boolean);
      const league = seg.slice(2, -1).join(' / ') || null;
      if (league) comps.set(league, { key: league, name: pretty(league) });
      events.push({
        id: `${game}:bov:${e.id}`,
        provider_id: String(e.id),
        // el enlace ES la clave de acceso al detalle, así que viaja con el evento
        provider_ref: e.link,
        game,
        competition: league ? pretty(league) : null,
        competition_key: league,
        start_at: new Date(t).toISOString(),
        status: e.type || null,
        bo: null,
        home: { id: null, name: (home && home.name) || '—', abbr: (home && home.shortName) || null, country: null },
        away: { id: null, name: (away && away.name) || '—', abbr: (away && away.shortName) || null, country: null },
        name: e.description || null,
      });
    }
  }
  events.sort((a, b) => Date.parse(a.start_at || 0) - Date.parse(b.start_at || 0));
  return { game, events, competitions: [...comps.values()], available: true, at: new Date().toISOString() };
}
const pretty = (s) => String(s).replace(/[-/]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\b\w/g, (c) => c.toUpperCase());

// ---- 2) MERCADOS ----------------------------------------------------------------------------------------
// LA CLAVE DEL MERCADO NO BASTA PARA SABER QUÉ ES. `2W-HCAP` aparece a la vez como hándicap de mapas, como
// hándicap de rondas y como hándicap de KILLS: lo que las distingue es el grupo (`Game Lines` contra
// `Kill Props`) y el periodo (`Game` contra `Map 1`). Mapear por la clave sola —que es el atajo obvio— mete
// un hándicap de kills de ±11.5 dentro de la familia de hándicap de mapas, y el motor lo valora como si fuera
// una serie. Se mapea por la TERNA (grupo, descripción, periodo) y lo que no casa se ignora en silencio.
function familyOf(group, desc, isSeries) {
  const d = String(desc || '').toLowerCase();
  const g = String(group || '').toLowerCase();

  if (g === 'kill props') {
    if (/asian handicap kills/.test(d)) return ['KILLS_HANDICAP', 'Hándicap de kills'];
    if (/kills/.test(d)) return ['KILLS', 'Total de kills del mapa'];
    return null;
  }
  if (g === 'map props') {
    if (/overtime/.test(d)) return ['PRORROGA', '¿Habrá prórroga?'];
    if (/odd\/even/.test(d)) return ['PAR_IMPAR', 'Rondas par/impar'];
    return null;                                     // pistolas, ronda 1, bombas: el motor no las modela
  }
  if (g === 'match props') {
    if (/^correct score$/.test(d)) return ['MARCADOR', 'Marcador exacto'];
    return null;
  }
  if (g === 'game lines' || g === 'alternative') {
    if (/moneyline/.test(d)) return isSeries ? ['SERIE', 'Ganador de la serie'] : ['MAPA', 'Ganador del mapa'];
    if (/spread/.test(d)) return isSeries ? ['HANDICAP', 'Hándicap de mapas'] : ['RONDAS_HANDICAP', 'Hándicap de rondas'];
    if (/^total$/.test(d)) return isSeries ? ['TOTAL_MAPAS', 'Total de mapas'] : ['RONDAS', 'Total de rondas del mapa'];
    return null;
  }
  return null;
}

// "Map 1" → 1 · "Game" → null. El periodo principal (`main`) es la serie.
function mapOf(period) {
  if (!period) return null;
  if (period.main || /^game$/i.test(period.description || '')) return null;
  const m = String(period.description || period.abbreviation || '').match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

// El lado. `type` es la respuesta corta y fiable —H/A para local/visitante, O/U para más/menos— y la
// descripción es el respaldo cuando el tipo no lo dice (prórroga sí/no, par/impar, marcador exacto).
// EL `type` NO SE MIRA PRIMERO, y esto costó un error de verdad: en el marcador exacto Bovada etiqueta las
// CUATRO selecciones con `type` H o A —"2-0" y "2-1" son las dos H— así que leer el tipo antes que la
// descripción colapsaba los cuatro marcadores en dos lados llamados `home` y `away`. El ancla de marcador de
// `core.js` se quedaba entonces sin marcadores que sumar y el consenso salía con un margen de −43 %, que es la
// pinta que tiene un mercado mal leído. Las familias cuya identidad vive en el TEXTO se resuelven por texto;
// el `type` solo decide donde de verdad significa local/visitante/más/menos.
function sideOf(o, family) {
  // se le quita el sufijo " - Map N" que Bovada le cuelga a cada descripción
  const d = String(o.description || '').replace(/\s*-\s*Map\s*\d+\s*$/i, '').trim().toLowerCase();
  if (family === 'MARCADOR') { const m = d.match(/^(\d+)\s*-\s*(\d+)$/); return m ? `${m[1]}:${m[2]}` : null; }
  if (family === 'PRORROGA') return /^yes$/.test(d) ? 'yes' : /^no$/.test(d) ? 'no' : null;
  if (family === 'PAR_IMPAR') return /^odd$/.test(d) ? 'odd' : /^even$/.test(d) ? 'even' : null;
  const t = String(o.type || '').toUpperCase();
  if (t === 'H') return 'home';
  if (t === 'A') return 'away';
  if (t === 'O') return 'over';
  if (t === 'U') return 'under';
  if (/^over$/.test(d)) return 'over';
  if (/^under$/.test(d)) return 'under';
  return null;
}

// LAS FAMILIAS DE DOS LADOS LLEVAN LA LÍNEA DEL LOCAL, con su signo, en las DOS filas. Es la convención de
// todo el motor y la razón está documentada al detalle en `store.js`: leer cada fila con su propio signo fue
// lo que en su día fabricó una ventaja de 41 pp que no existía. Bovada publica la línea por selección
// —local +1.5 / visitante −1.5— así que la del visitante se le da la vuelta antes de guardarla.
const SIDED = new Set(['HANDICAP', 'RONDAS_HANDICAP', 'KILLS_HANDICAP']);

async function markets(providerRef, game) {
  if (!providerRef) return null;
  const j = await bvFetch(`${BASE}${providerRef}?lang=en`);
  const ev = j && j[0] && j[0].events && j[0].events[0];
  if (!ev) return null;
  return parseEvent(ev, game);
}

// La traducción vive aparte de la red A PROPÓSITO: las familias que más importan de esta casa —prórroga,
// par/impar, kills y marcador exacto— solo abren en los partidos grandes y en las horas previas, así que
// esperar a que estén vivas para comprobar si se leen bien es esperar a producción. Con el parseo separado se
// verifica contra las respuestas reales capturadas, que es como se cazó el fallo del marcador exacto.
function parseEvent(ev, game) {
  const out = [];
  let disabled = 0, ignored = 0;
  for (const dg of ev.displayGroups || []) {
    // props de jugador: GP no modela rendimiento individual en CS2 y no va a inventarlo. Fuera, y contado.
    if (/player props/i.test(dg.description || '')) { ignored += (dg.markets || []).length; continue; }
    for (const m of dg.markets || []) {
      const map = mapOf(m.period);
      const fam = familyOf(dg.description, m.description, map == null);
      if (!fam) { ignored++; continue; }
      for (const o of m.outcomes || []) {
        if (String(o.status || 'O') !== 'O') { disabled++; continue; }
        const odds = Number(o.price && o.price.decimal);
        if (!(odds > 1)) { disabled++; continue; }
        const side = sideOf(o, fam[0]);
        if (!side) { ignored++; continue; }
        const rawH = o.price && o.price.handicap;
        let line = rawH == null || rawH === '' ? null : Number(rawH);
        if (!Number.isFinite(line)) line = null;
        if (line != null && SIDED.has(fam[0]) && side === 'away') line = -line;   // se normaliza al local
        out.push({
          family: fam[0], family_label: fam[1],
          market_key: `${dg.description}|${m.description}`,
          period: map == null ? 'serie' : `map_${map}`,
          map,
          // Bovada no cotiza total de rondas POR EQUIPO, así que aquí `team` es siempre nulo; se deja el
          // campo para que la fila tenga la misma forma que la de las otras dos casas.
          team: null,
          line,
          side,
          params: m.marketTypeId || null,
          odds,
          max_stake: null,
          prob_implied: +(1 / odds).toFixed(6),
          alternate: /alternative/i.test(dg.description || ''),
          book: 'bovada',
        });
      }
    }
  }
  return {
    provider_id: String(ev.id), game, markets: out,
    disabled_selections: disabled, ignored_selections: ignored,
    book: 'bovada', at: new Date().toISOString(),
  };
}

// ---- 3) EL REGISTRO DE LA BÚSQUEDA ----------------------------------------------------------------------
// Se deja escrito lo que se probó y cómo respondió, con fecha, porque la alternativa es que dentro de tres
// meses alguien repita la misma tarde de sondas. Estado el 16-ago-2026:
const BOOKS_PROBED = {
  usable: ['Cloudbet (clave propia)', 'Pinnacle (API de invitado)', 'Bovada (API de cupón pública)'],
  empty: ['Rivalry — responde 200 y devuelve `data: []`; su API pública no publica partidos'],
  blocked_cloudflare: ['Thunderpick', 'Stake', 'Duelbits', 'Oddspedia', 'CSGOEmpire', 'Coolbet', 'Sportsbet.io'],
  blocked_portal: ['DraftKings (403)', 'bet365 (403)', 'Betcris (403)', 'GG.BET (bloqueo geográfico)'],
  needs_key: ['PandaScore (403)', 'Abios (401)', 'BetsAPI (401)'],
  no_esports: ['Kalshi (0 eventos de esports en 200 abiertos)', 'The Odds API (0 deportes electrónicos de 75)'],
  partial: ['Polymarket — cotiza FUTUROS del torneo (ganador del EWC, MVP, grupos), no partidos sueltos: no encaja en la taxonomía por partido de GP'],
  at: '2026-08-16',
};

const RESULTS_UNAVAILABLE = {
  available: false,
  why: 'el cupón de Bovada sirve el catálogo de apuesta: un partido terminado sale del listado y no hay endpoint de liquidación público. Comprobado el 16-ago.',
};

module.exports = {
  BOOK: { key: 'bovada', name: 'Bovada', sharp: false, odds_format: 'decimal',
    note: 'la casa más ancha de las tres: aporta prórroga del mapa, par/impar y kills, familias que ninguna otra de las de GP cotiza.' },
  fixtures, markets, parseEvent, familyOf, sideOf, mapOf, BOOKS_PROBED, RESULTS_UNAVAILABLE, GAME_PATH,
};
