// cache.js — cache TTL en memoria + helper de "fetch con fallback".
// Protege la API (rate limits) y mantiene la UI viva aunque una fuente falle.
// Sin dependencias. Compatible con Node >= 18.

const store = new Map(); // key -> { value, exp }

// TTLs sugeridos por tipo de dato (ms). Centralizados para ajustarlos en un solo sitio.
const TTL = {
  fixtures: 8 * 60 * 1000,        // calendario
  liveFixture: 45 * 1000,         // partido en vivo
  matchFinal: 18 * 60 * 60 * 1000,// resumen de partido finalizado
  lineups: 8 * 60 * 1000,         // alineaciones pre/in
  events: 45 * 1000,              // eventos en vivo
  statistics: 45 * 1000,          // stats de partido
  squad: 24 * 60 * 60 * 1000,     // plantilla
  players: 24 * 60 * 60 * 1000,   // jugadores
  injuries: 40 * 60 * 1000,       // lesiones / sidelined
  odds: 4 * 60 * 1000,            // cuotas
  standings: 10 * 60 * 1000,      // tabla
  form: 16 * 60 * 60 * 1000,      // forma reciente / resultados
  h2h: 16 * 60 * 60 * 1000,       // head to head
  predictions: 30 * 60 * 1000,    // predicciones API
  teamMeta: 24 * 60 * 60 * 1000,  // metadata / ids descubiertos
  manual: 5 * 60 * 1000,          // archivos manuales (relectura ligera)
};

function get(key) {
  const e = store.get(key);
  if (!e) return undefined;
  if (e.exp && e.exp < Date.now()) { store.delete(key); return undefined; }
  return e.value;
}

function set(key, value, ttl) {
  store.set(key, { value, exp: ttl ? Date.now() + ttl : 0 });
  return value;
}

function has(key) { return get(key) !== undefined; }

// wrap(key, ttl, fn): devuelve cache si existe; si no, ejecuta fn(), cachea y devuelve.
// Si fn() lanza, devuelve el último valor cacheado (aunque esté vencido) o null — nunca rompe.
async function wrap(key, ttl, fn) {
  const hit = get(key);
  if (hit !== undefined) return hit;
  try {
    const value = await fn();
    if (value !== undefined && value !== null) return set(key, value, ttl);
    // valor vacío: cachea brevemente para no martillar la API, pero permite reintento pronto
    return set(key, value, Math.min(ttl, 30 * 1000));
  } catch (e) {
    const stale = store.get(key);
    if (stale) { console.warn(`[cache] ${key}: fallo, usando stale (${e.message})`); return stale.value; }
    console.warn(`[cache] ${key}: fallo sin stale (${e.message})`);
    return null;
  }
}

function clear() { store.clear(); }
function stats() { return { entries: store.size }; }

module.exports = { get, set, has, wrap, clear, stats, TTL };
