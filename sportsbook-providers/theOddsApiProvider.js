// sportsbook-providers/theOddsApiProvider.js — Sprint 8A §6. Adapter de The Odds API (doc oficial v4).
// Contrato provider-agnostic (extiende el de Sprint 7): discoverSports/discoverCompetitions/discoverEvents/
// fetchMarkets/fetchQuotes/normalizeEvent/normalizeMarket/normalizeQuote/quotaStatus/health.
// SEGURIDAD: la API key SOLO viaja en el query string hacia el host oficial; se REDACTA de todo error/log.
// No fabrica endpoints (basado en la doc oficial). `httpGet` es inyectable para tests (sin red, sin key).
'use strict';
const cfg = require('./config');

// endpoints oficiales v4
const PATHS = {
  sports: () => `/v4/sports`,
  events: (sport) => `/v4/sports/${encodeURIComponent(sport)}/events`,
  odds: (sport) => `/v4/sports/${encodeURIComponent(sport)}/odds`,
};

function redactKey(s) { return String(s || '').replace(/apiKey=[^&\s]+/gi, 'apiKey=***'); }

// httpGet por defecto: fetch nativo (Node ≥18). Devuelve { status, headers, json }. Nunca lanza con la URL+key.
async function defaultHttpGet(url, { timeoutMs }) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
    const headers = {}; for (const k of ['x-requests-remaining', 'x-requests-used', 'x-requests-last']) headers[k] = r.headers.get(k);
    let json = null; try { json = await r.json(); } catch { /* puede no ser json en error */ }
    return { status: r.status, headers, json };
  } catch (e) {
    const err = new Error(redactKey(e && e.message) || 'request_failed');
    err.code = (e && e.name === 'AbortError') ? 'timeout' : 'network';
    throw err;
  } finally { clearTimeout(t); }
}

function createProvider({ httpGet = defaultHttpGet } = {}) {
  const P = cfg.params;
  const name = P.providerName;

  function buildUrl(path, query = {}) {
    const key = cfg.apiKey();
    const qs = new URLSearchParams({ apiKey: key || '', ...query }).toString();
    return `${P.apiHost}${path}?${qs}`;
  }

  // clasifica el status HTTP en un error con código estable (para retries/circuit)
  function httpError(status, body) {
    const code = status === 401 ? 'auth' : status === 429 ? 'quota_exhausted' : status >= 500 ? 'server_error' : status >= 400 ? 'bad_request' : 'error';
    const e = new Error(`${code} (${status})`); e.code = code; e.httpStatus = status; e.safeBody = typeof body === 'object' ? (body && body.message) : null;
    return e;
  }

  async function call(path, query) {
    if (!cfg.apiKey()) { const e = new Error('not_configured'); e.code = 'not_configured'; throw e; }
    const r = await httpGet(buildUrl(path, query), { timeoutMs: P.requestTimeoutMs });
    const quota = {
      remaining: r.headers && r.headers['x-requests-remaining'] != null ? parseInt(r.headers['x-requests-remaining'], 10) : null,
      used: r.headers && r.headers['x-requests-used'] != null ? parseInt(r.headers['x-requests-used'], 10) : null,
      lastCost: r.headers && r.headers['x-requests-last'] != null ? parseInt(r.headers['x-requests-last'], 10) : null,
    };
    if (r.status && r.status >= 400) throw Object.assign(httpError(r.status, r.json), { quota });
    return { data: r.json, quota };
  }

  // ---- descubrimiento ----
  async function discoverSports() { const { data } = await call(PATHS.sports(), {}); return Array.isArray(data) ? data : []; }
  // competiciones = deportes activos del grupo objetivo que matchean el filtro (p.ej. "world cup"). Descubierto, no hardcodeado.
  async function discoverCompetitions() {
    const sports = await discoverSports();
    const f = (P.sportFilter || '').toLowerCase(), g = (P.sportGroup || '').toLowerCase();
    return sports.filter(s => s && s.active && (!g || String(s.group || '').toLowerCase() === g) &&
      (!f || `${s.title} ${s.description} ${s.key}`.toLowerCase().includes(f)));
  }
  async function discoverEvents(sportKey) { const { data } = await call(PATHS.events(sportKey), { dateFormat: 'iso' }); return Array.isArray(data) ? data : []; }
  // fetchMarkets es informativo aquí: la integración inicial es solo h2h
  async function fetchMarkets() { return [{ key: 'h2h', period: 'regulation' }]; }

  // ---- cuotas h2h ---- → devuelve { events, quota }
  async function fetchQuotes(sportKey, { regions = P.regions, markets = P.markets } = {}) {
    const { data, quota } = await call(PATHS.odds(sportKey), { regions, markets, oddsFormat: P.oddsFormat, dateFormat: 'iso' });
    return { events: Array.isArray(data) ? data : [], quota };
  }

  // ---- normalización (la validación 1X2 vive en normalizer.js) ----
  function normalizeEvent(e) {
    if (!e || !e.id) return null;
    return { external_event_id: e.id, sport_key: e.sport_key, sport_title: e.sport_title, commence_time: e.commence_time, home_team: e.home_team, away_team: e.away_team };
  }
  function normalizeMarket(m) { return m && m.key === 'h2h' ? { market_family: '1x2', period: 'regulation', key: m.key } : null; }
  // una "quote" cruda por (book, outcome). El normalizer arma el set 1X2 y valida.
  function normalizeQuote(raw) { return raw || null; }

  async function quotaStatus() {
    // estado liviano sin gastar cuota: /sports no cuenta. Si no hay key, unavailable.
    if (!cfg.apiKey()) return { status: 'unavailable', reason: 'no_key' };
    try { const { quota } = await call(PATHS.sports(), {}); return { status: 'ok', quota }; }
    catch (e) { return { status: 'error', code: e.code || 'error' }; }
  }

  async function health() {
    if (!cfg.flags.enabled) return { status: 'disabled' };
    if (!cfg.apiKey()) return { status: 'unavailable', reason: 'no_authorized_sportsbook_provider_key' };
    try { await call(PATHS.sports(), {}); return { status: 'ok', provider: name }; }
    catch (e) { return { status: 'error', code: e.code || 'error', provider: name }; }
  }

  return {
    name, discoverSports, discoverCompetitions, discoverEvents, fetchMarkets, fetchQuotes,
    normalizeEvent, normalizeMarket, normalizeQuote, quotaStatus, health, _redactKey: redactKey,
  };
}

module.exports = { createProvider, defaultHttpGet, redactKey, PATHS };
