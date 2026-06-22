// tests/sportsbook-provider.test.js — Sprint 8A §93,§94. Tests PUROS del proveedor de sportsbooks (sin DB,
// sin red, sin key real): normalización + validación 1X2, quota/circuit breaker, adapter con httpGet
// inyectado, redacción de la API key.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  process.env.SPORTSBOOK_PROVIDER_ENABLED = 'true';
  const cfg = require(R + '/sportsbook-providers/config');
  const normalizer = require(R + '/sportsbook-providers/normalizer');
  const quotaGuard = require(R + '/sportsbook-providers/quotaGuard');
  const { createProvider, redactKey } = require(R + '/sportsbook-providers/theOddsApiProvider');

  const now = Date.now();
  const future = new Date(now + 3 * 3600 * 1000).toISOString();   // kickoff en 3h
  const fresh = new Date(now - 30 * 1000).toISOString();
  const stale = new Date(now - 60 * 60 * 1000).toISOString();
  const mk = (book, outs, lu = fresh) => ({ key: book, title: book, last_update: lu, markets: [{ key: 'h2h', last_update: lu, outcomes: outs }] });
  const trip = (h, d, a) => [{ name: 'Argentina', price: h }, { name: 'Draw', price: d }, { name: 'Austria', price: a }];
  const baseEvent = (books) => ({ id: 'evt1', sport_key: 'soccer_fifa_world_cup', commence_time: future, home_team: 'Argentina', away_team: 'Austria', bookmakers: books });

  // ---- normalizer / 1X2 (§94) ----
  ok('normalizer: clasifica outcomes home/draw/away', normalizer.classifyOutcome('Draw') === 'draw' && normalizer.classifyOutcome('Argentina', 'Argentina', 'Austria') === 'home');
  ok('normalizer: implied prob = 1/odds', normalizer.impliedProb(2.0) === 0.5);
  const okSet = normalizer.buildSetsForEvent(baseEvent([mk('pinnacle', trip(1.5, 4.0, 7.0))]), { now });
  ok('1X2: set completo válido', okSet.sets.length === 1 && okSet.rejected.length === 0 && okSet.sets[0].outcomes.draw.odds_decimal === 4.0);
  const noDraw = normalizer.buildSetsForEvent(baseEvent([mk('x', [{ name: 'Argentina', price: 1.5 }, { name: 'Austria', price: 7.0 }])]), { now });
  ok('1X2: draw ausente → rechazado', noDraw.sets.length === 0 && noDraw.rejected[0].reason === 'incomplete_1x2');
  const dup = normalizer.buildSetsForEvent(baseEvent([mk('x', [{ name: 'Argentina', price: 1.5 }, { name: 'Argentina', price: 1.6 }, { name: 'Draw', price: 4 }])]), { now });
  ok('1X2: outcome duplicado → rechazado', dup.sets.length === 0);
  const unknown = normalizer.buildSetsForEvent(baseEvent([mk('x', trip(1.5, 4, 7).concat([{ name: 'Brasil', price: 2 }]))]), { now });
  ok('1X2: outcome desconocido → rechazado', unknown.sets.length === 0);
  const staleSet = normalizer.buildSetsForEvent(baseEvent([mk('x', trip(1.5, 4, 7), stale)]), { now });
  ok('1X2: cuota stale → rechazada', staleSet.sets.length === 0 && staleSet.rejected[0].reason === 'quote_stale');
  const started = normalizer.buildSetsForEvent({ ...baseEvent([mk('x', trip(1.5, 4, 7))]), commence_time: new Date(now - 1000).toISOString() }, { now });
  ok('1X2: evento ya empezado → rechazado', started.sets.length === 0 && started.rejected[0].reason === 'event_started_or_imminent');
  const noKick = normalizer.buildSetsForEvent({ ...baseEvent([mk('x', trip(1.5, 4, 7))]), commence_time: null }, { now });
  ok('1X2: kickoff incierto → rechazado', noKick.rejected[0].reason === 'kickoff_unknown');

  // ---- independence groups (§11) ----
  const catalog = { betA: { operator_group: 'opX', independence_group: 'gX', sportsbook_name: 'Bet A' }, betB: { operator_group: 'opX', independence_group: 'gX' } };
  const r1 = normalizer.resolveSource('betA', catalog), r2 = normalizer.resolveSource('betB', catalog), r3 = normalizer.resolveSource('solo', catalog);
  ok('independence: skins del mismo operador comparten grupo', r1.independence_group === 'gX' && r2.independence_group === 'gX');
  ok('independence: casa sin catálogo es su propio grupo (no asume independencia)', r3.independence_group === 'solo');

  // ---- setsToQuoteRows ----
  const rows = normalizer.setsToQuoteRows(okSet.sets, 'run-1');
  ok('quoteRows: 3 filas por set (home/draw/away)', rows.length === 3 && rows.every(r => r.market_family === '1x2' && r.ingestion_run_id === 'run-1'));
  ok('quoteRows: implied prob poblada y normalizer_version', rows[0].implied_probability > 0 && rows[0].normalizer_version === cfg.NORMALIZER_VERSION);

  // ---- quotaGuard / circuit (§8,§23) ----
  ok('quota: crítica si remaining bajo reserva', quotaGuard.quotaCritical(5, 95) === true && quotaGuard.quotaCritical(80, 20) === false);
  ok('quota: remaining desconocido no bloquea', quotaGuard.quotaCritical(null, null) === false);
  ok('circuit: auth abre de inmediato', quotaGuard.nextCircuit({ circuit_state: 'closed', consecutive_failures: 0 }, { ok: false, errorCode: 'auth' }).circuit_state === 'open');
  ok('circuit: éxito cierra', quotaGuard.nextCircuit({ circuit_state: 'open', consecutive_failures: 5 }, { ok: true }).circuit_state === 'closed');
  let st = { circuit_state: 'closed', consecutive_failures: 0 };
  for (let i = 0; i < 3; i++) st = quotaGuard.nextCircuit(st, { ok: false, errorCode: 'server_error' });
  ok('circuit: 3 fallos 5xx abren', st.circuit_state === 'open');
  ok('circuit: open dentro de ventana no permite llamar', quotaGuard.canCall({ circuit_state: 'open', circuit_opened_at: new Date(now).toISOString() }, now).allowed === false);
  ok('circuit: open vencido → half_open permite sondeo', quotaGuard.canCall({ circuit_state: 'open', circuit_opened_at: new Date(now - 10 * 60 * 1000).toISOString() }, now).circuit === 'half_open');
  ok('quota: estado derivado down si circuito abierto', quotaGuard.deriveProviderStatus({ circuitState: 'open' }) === 'down');

  // ---- adapter: httpGet inyectado, sin red, sin key real ----
  process.env.SPORTSBOOK_PROVIDER_API_KEY = 'test-key-123';
  const fakeSports = [{ key: 'soccer_fifa_world_cup', group: 'Soccer', title: 'FIFA World Cup', active: true, has_outrights: false }, { key: 'basketball_nba', group: 'Basketball', title: 'NBA', active: true }];
  const calls = [];
  const httpGet = async (url) => {
    calls.push(url);
    if (/\/v4\/sports\?/.test(url)) return { status: 200, headers: {}, json: fakeSports };
    if (/\/odds\?/.test(url)) return { status: 200, headers: { 'x-requests-remaining': '480', 'x-requests-used': '20', 'x-requests-last': '2' }, json: [baseEvent([mk('pinnacle', trip(1.5, 4, 7))])] };
    return { status: 200, headers: {}, json: [] };
  };
  const prov = createProvider({ httpGet });
  const comps = await prov.discoverCompetitions();
  ok('adapter: discoverCompetitions filtra Mundial (Soccer + "world cup")', comps.length === 1 && comps[0].key === 'soccer_fifa_world_cup');
  const q = await prov.fetchQuotes('soccer_fifa_world_cup', {});
  ok('adapter: fetchQuotes devuelve eventos + cuota de headers', q.events.length === 1 && q.quota.remaining === 480 && q.quota.lastCost === 2);
  ok('adapter: la API key viaja en la URL pero se puede redactar', /apiKey=test-key-123/.test(calls[0]) && !/test-key-123/.test(redactKey(calls[0])));

  // not_configured sin key
  delete process.env.SPORTSBOOK_PROVIDER_API_KEY;
  const provNoKey = createProvider({ httpGet });
  let threw = null; try { await provNoKey.fetchQuotes('x', {}); } catch (e) { threw = e; }
  ok('adapter: sin key → not_configured (no llama)', threw && threw.code === 'not_configured');
  const h = await provNoKey.health();
  ok('adapter: health sin key → unavailable', h.status === 'unavailable');

  // error HTTP clasificado + redacción en mensajes
  process.env.SPORTSBOOK_PROVIDER_API_KEY = 'secret999';
  const errProv = createProvider({ httpGet: async () => ({ status: 401, headers: {}, json: { message: 'Unauthorized' } }) });
  let e401 = null; try { await errProv.fetchQuotes('x', {}); } catch (e) { e401 = e; }
  ok('adapter: 401 → code auth', e401 && e401.code === 'auth');
  ok('adapter: redactKey limpia apiKey de cualquier texto', !/secret999/.test(redactKey('GET https://h/v4/odds?apiKey=secret999&x=1')));

  delete process.env.SPORTSBOOK_PROVIDER_API_KEY;
  console.log(`\nsportsbook-provider (puros): ${pass} ✓  ${fail} ✗`);
  process.exit(fail ? 1 : 0);
})();
