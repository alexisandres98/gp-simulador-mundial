// data-providers/esports/cloudbet.js — LA ÚNICA FUENTE VIVA DE ESPORTS QUE GP TIENE HOY (16-ago).
//
// POR QUÉ ESTA Y NO OTRA. El blueprint enumera FACEIT, Liquipedia, demos y GRID, y ninguna está disponible
// todavía: FACEIT necesita clave, Liquipedia necesita aprobación comercial, GRID cuesta $5.000/mes y el
// propio blueprint prohíbe montar el backend sobre scraping de HLTV. Se comprobó además que **The Odds API
// —que GP ya paga— no tiene NI UN deporte electrónico** (0 de 75). Cloudbet sí, ya está integrada para
// combate y la clave ya está en producción. Así que la capa de mercado de esports arranca aquí, y el resto
// de fuentes del blueprint entran cuando existan, detrás de esta misma interfaz.
//
// LO QUE HAY DE VERDAD, MEDIDO EL 16-ago (no lo que promete el catálogo):
//   counter-strike     12 eventos · 5 ligas  · ganador, mapa, hándicap de mapa, total de mapas
//   league-of-legends  37 eventos · 13 ligas · lo anterior + KILLS (total, por equipo, hándicap) y marcador
//   esport-valorant     5 eventos · 1 liga   · fixtures sí; mercados aún sin abrir en la franja mirada
//   dota-2              1 evento  · 1 liga   · fixtures sí; mercados aún sin abrir
// Esa asimetría no se disimula: cada juego publica lo que su mercado da, y la UI lo dice.
//
// ADAPTADOR REEMPLAZABLE, que es la regla de propiedad intelectual del blueprint: los identificadores de
// GP, el histórico y las definiciones de features son nuestros; el proveedor es intercambiable. Nada fuera
// de este archivo sabe que existe Cloudbet.
'use strict';

const BASE = 'https://sports-api.cloudbet.com/pub/v2/odds';

// Los cuatro títulos, con su clave en el proveedor y su gramática propia. `bo` es el formato por defecto
// cuando la competición no lo declara: en CS2 y Valorant el estándar de circuito es BO3; en LoL y Dota 2
// las ligas regulares suelen ir a BO3 también, pero los playoffs a BO5 y eso llega por el mercado.
// `prefix` es el que el proveedor antepone a cada clave de mercado y NO se deduce del nombre del deporte:
// Valorant se cataloga como `esport-valorant` pero prefija `esport_valorant.`, no `valorant.`. Comprobado
// contra la API el 16-ago; asumirlo costó que todos los mercados de Valorant salieran vacíos.
const GAMES = {
  cs2: { key: 'counter-strike', label: 'Counter-Strike 2', short: 'CS2', unit: 'mapa', bo: 3,
    prefix: 'counter_strike' },
  lol: { key: 'league-of-legends', label: 'League of Legends', short: 'LoL', unit: 'mapa', bo: 3,
    prefix: 'league_of_legends' },
  valorant: { key: 'esport-valorant', label: 'Valorant', short: 'VAL', unit: 'mapa', bo: 3,
    prefix: 'esport_valorant' },
  dota2: { key: 'dota-2', label: 'Dota 2', short: 'DOTA', unit: 'mapa', bo: 3,
    prefix: 'dota_2' },
};

async function cbFetch(url, key, { tries = 3, timeoutMs = 15000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'X-API-Key': key }, signal: AbortSignal.timeout(timeoutMs) });
      // 429 NO es "no hay datos": es ráfaga. La lección del cache vaciado de PFL, aplicada de entrada.
      if (r.status === 429) { await sleep(1600 * (i + 1)); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await sleep(900 * (i + 1)); }
  }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 1) AGENDA ------------------------------------------------------------------------------------------
// Los próximos `days` días de un juego. Cloudbet cataloga por SU día UTC, así que se pide día a día y se
// deduplica por id — el mismo patrón que ya funciona en combate.
async function fixtures(game, { days = 7, key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  const G = GAMES[game];
  if (!G || !key) return { game, events: [], competitions: [], available: !!key };
  const seen = new Set(), events = [], comps = new Map();
  const t0 = Date.now();
  for (let k = 0; k < days; k++) {
    const d = new Date(t0 + k * 864e5).toISOString().slice(0, 10);
    const j = await cbFetch(`${BASE}/fixtures?sport=${G.key}&date=${d}`, key);
    for (const c of (j && j.competitions) || []) {
      for (const e of c.events || []) {
        if (!e.home || !e.away || seen.has(e.id)) continue;
        seen.add(e.id);
        const ne = normEvent(e, c, game);
        // Se deduplica también por id de GP: el proveedor lista a veces el mismo enfrentamiento dos veces
        // (una entrada por competición o un duplicado suyo), y en la pizarra eso se leía como dos partidos.
        if (seen.has(ne.id)) continue;
        seen.add(ne.id);
        comps.set(c.key || c.name, { key: c.key || c.name, name: c.name });
        events.push(ne);
      }
    }
    await sleep(220);
  }
  events.sort((a, b) => Date.parse(a.start_at || 0) - Date.parse(b.start_at || 0));
  return { game, events, competitions: [...comps.values()], available: true, at: new Date().toISOString() };
}

// Identidad de GP, no la del proveedor. El id propio es estable aunque Cloudbet renumere: se compone del
// juego y de las claves de los dos equipos, que son slugs y no enteros volátiles.
function normEvent(e, c, game) {
  const hk = slug((e.home || {}).key || (e.home || {}).name);
  const ak = slug((e.away || {}).key || (e.away || {}).name);
  return {
    id: `${game}:${hk}__${ak}__${String(e.cutoffTime || '').slice(0, 10)}`,
    provider_id: String(e.id),
    game,
    competition: c.name || null,
    competition_key: c.key || null,
    start_at: e.cutoffTime || null,
    status: e.status || null,
    home: team(e.home), away: team(e.away),
    name: e.name || null,
  };
}
const team = (t) => ({
  id: slug((t || {}).key || (t || {}).name),
  name: (t || {}).name || '—',
  abbr: (t || {}).abbreviation || null,
  country: (t || {}).nationality || null,
});
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---- 2) MERCADOS DE UN EVENTO ---------------------------------------------------------------------------
// Se normaliza a la taxonomía de GP, no a la del proveedor: familia, línea, lado y precio. Cada juego
// declara qué familias entiende; lo que no está declarado se ignora en silencio en vez de inventarle
// significado a una clave desconocida.
const FAMILIES = {
  winner: { fam: 'SERIE', label: 'Ganador de la serie' },
  map_winner: { fam: 'MAPA', label: 'Ganador del mapa' },
  map_winner_v2: { fam: 'MAPA', label: 'Ganador del mapa' },
  map_handicap: { fam: 'HANDICAP', label: 'Hándicap de mapas' },
  handicap: { fam: 'HANDICAP', label: 'Hándicap de mapas' },          // Valorant lo llama así, sin prefijo `map_`
  total_maps: { fam: 'TOTAL_MAPAS', label: 'Total de mapas' },
  totals: { fam: 'TOTAL_MAPAS', label: 'Total de mapas' },            // ídem
  correct_score_in_maps: { fam: 'MARCADOR', label: 'Marcador exacto' },
  map_total_kills: { fam: 'KILLS', label: 'Total de kills del mapa' },
  map_team_total_kills: { fam: 'KILLS_EQUIPO', label: 'Kills del equipo' },
  map_kill_handicap: { fam: 'KILLS_HANDICAP', label: 'Hándicap de kills' },
  map_kill_draw_no_bet: { fam: 'KILLS_DNB', label: 'Kills sin empate' },
  total_rounds: { fam: 'RONDAS', label: 'Total de rondas' },
  map_total_rounds: { fam: 'RONDAS', label: 'Total de rondas del mapa' },
  map_team_total: { fam: 'RONDAS_EQUIPO', label: 'Rondas del equipo' },
  map_round_handicap: { fam: 'RONDAS_HANDICAP', label: 'Hándicap de rondas' },
  map_will_there_be_overtime: { fam: 'PRORROGA', label: '¿Habrá prórroga?' },
  map_odd_even_rounds: { fam: 'PAR_IMPAR', label: 'Rondas par/impar' },
};

// La clave llega como "<prefijo>.<familia>[.vN]" y a veces sin prefijo. Se prueban los candidatos en orden
// en vez de asumir una forma: asumirla es justo lo que dejó Valorant a cero.
function bareKey(mk, prefix) {
  const cands = [];
  const push = (s) => { if (s && !cands.includes(s)) cands.push(s); };
  push(mk);
  if (prefix && mk.startsWith(prefix + '.')) push(mk.slice(prefix.length + 1));
  const dot = mk.indexOf('.');
  if (dot > 0) push(mk.slice(dot + 1));
  for (const c of cands.slice()) push(c.replace(/\.v\d+$/, ''));
  for (const c of cands) if (FAMILIES[c]) return { bare: c, meta: FAMILIES[c] };
  return null;
}

async function markets(providerId, game, { key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  if (!key || !providerId) return null;
  const j = await cbFetch(`${BASE}/events/${providerId}`, key);
  if (!j) return null;
  const G = GAMES[game] || {};
  const out = [];
  let disabled = 0;
  for (const [mk, m] of Object.entries(j.markets || {})) {
    const hit = bareKey(mk, G.prefix);
    if (!hit) continue;
    const { bare, meta } = hit;
    for (const [subKey, sub] of Object.entries(m.submarkets || {})) {
      const subP = parseParams(subKey);
      for (const sel of sub.selections || []) {
        if (!(sel.price > 1) || String(sel.status || 'SELECTION_ENABLED') !== 'SELECTION_ENABLED') { disabled++; continue; }
        // LA LÍNEA VIVE EN `sel.params`, NO EN LA CLAVE DEL SUBMERCADO. Comprobado el 16-ago: la clave trae
        // `period=default&period=map1kills&map=1` y el total/hándicap solo aparece en la selección. Leer solo
        // la clave dejaba todas las líneas en null y con eso ninguna familia derivada se podía valorar.
        const p = { ...subP, ...parseParams(sel.params) };
        const rawLine = p.handicap != null ? p.handicap : (p.total != null ? p.total : null);
        // OJO con el atajo: `Number(null)` es 0 y `Number.isFinite(0)` es true, asi que validar el numero
        // sin comprobar antes el nulo convertia "este mercado no tiene linea" en "la linea es 0" — y un
        // ganador de mapa aparecia como si cotizara la linea 0.
        const line = rawLine == null || rawLine === '' ? null : (Number.isFinite(Number(rawLine)) ? Number(rawLine) : null);
        out.push({
          family: meta.fam, family_label: meta.label, market_key: bare,
          period: p.period || null,
          map: p.map != null ? p.map : null,
          team: p.team != null ? String(p.team) : null,
          line,
          side: normSide(sel.outcome),
          params: sel.params || null,
          odds: +sel.price,
          max_stake: sel.maxStake != null ? +sel.maxStake : null,
          prob_implied: +(1 / sel.price).toFixed(6),
        });
      }
    }
  }
  return {
    provider_id: String(providerId), game, markets: out,
    // Un mercado cerrado NO es un mercado inexistente, y la UI tiene que poder distinguirlo: fuera de la
    // ventana de negociación el proveedor devuelve la estructura completa con precio 0 y SELECTION_DISABLED.
    disabled_selections: disabled,
    at: new Date().toISOString(),
  };
}

// El proveedor no es consistente con el nombre del resultado: `home`, `over`, pero también `score=2:0` o
// `outcome=2:1` en el marcador exacto. Se normaliza a lo que viene después del '=' cuando lo hay.
function normSide(outcome) {
  const s = String(outcome || '').toLowerCase();
  if (!s) return null;
  const eq = s.indexOf('=');
  return (eq >= 0 ? s.slice(eq + 1) : s) || null;
}

// "period=map_1&handicap=-1.5" → { period:'map_1', handicap:-1.5 }
function parseParams(s) {
  const o = {};
  for (const part of String(s || '').split('&')) {
    const [k, v] = part.split('=');
    if (!k) continue;
    const n = Number(v);
    o[k] = Number.isFinite(n) && v !== '' ? n : v;
  }
  return o;
}

// ---- 3) RESULTADOS: LO QUE ESTA FUENTE **NO** DA -------------------------------------------------------
// COMPROBADO CONTRA LA API EL 16-ago, y conviene que quede escrito para que nadie lo vuelva a intentar:
//   · `fixtures?date=<ayer>` devuelve CERO eventos — el catálogo solo mira hacia delante.
//   · un evento ya terminado (`status: "RESULTED"`, con `resultedTime` puesto) llega con `settlement: {}`
//     y con CERO mercados. No hay marcador por ningún lado.
//   · `/odds/results` y `/odds/events/settled` no existen (404).
// Conclusión sin rodeos: **GP no puede construir rating propio de esports con esta fuente.** El diseño ya
// lo aguanta —la probabilidad está anclada al mercado y el peso propio arranca en cero— pero hay que decirlo
// en la interfaz en vez de enseñar un rating vacío como si fuera a llenarse solo. Se llenará cuando entre
// una fuente de histórico (OpenDota y la API de Riot son públicas; Liquipedia y FACEIT necesitan permiso).
//
// Lo que sí se puede guardar desde hoy, y es lo que hace `eventState`: saber cuándo un evento cerró. Con eso
// el cierre de mercado queda fechado y el día que haya resultados, el histórico de precios ya está.
async function eventState(providerId, { key = process.env.CLOUDBET_API_KEY || '' } = {}) {
  if (!key || !providerId) return null;
  const j = await cbFetch(`${BASE}/events/${providerId}`, key);
  if (!j) return null;
  return {
    provider_id: String(providerId),
    status: j.status || null,
    resulted_at: j.resultedTime || null,
    finished: /RESULTED|SETTLED|CLOSED/i.test(String(j.status || '')),
    score: null,                       // el proveedor no lo publica; se deja explícito, no ausente
    score_available: false,
  };
}

const RESULTS_UNAVAILABLE = {
  available: false,
  why: 'Cloudbet no publica marcadores: un evento terminado devuelve settlement vacío y sin mercados, y el catálogo de fixtures solo mira hacia delante. Comprobado el 16-ago.',
  next: ['OpenDota (público) para Dota 2', 'API de Riot / Leaguepedia para LoL', 'FACEIT o Liquipedia (requieren permiso) para CS2 y Valorant'],
};
async function results() { return { ...RESULTS_UNAVAILABLE, rows: [] }; }

module.exports = { GAMES, FAMILIES, fixtures, markets, results, eventState, RESULTS_UNAVAILABLE, slug };
