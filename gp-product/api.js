// gp-product/api.js — Fase Q §15. Dispatcher de /api/beta/*. TODAS las rutas pasan por betaGuard (en server.js)
// antes de llegar aquí, así que `user` siempre tiene acceso beta. Devuelve DTOs de cliente (códigos neutrales,
// timestamps ISO, sin secretos/HTML). Inyecta dependencias vía ctx para no duplicar lógica del server.
'use strict';

const dto = require('./dto');
const repo = require('./repository');
const flags = require('./flags');
const confidence = require('./confidence');     // Corte 2.1 A.1: fuente única de confianza
const arbitrage = require('./arbitrage');           // Fase R.4: capa de producto de Arbitraje
const deepLinks = require('../exec-opportunities/deepLinks'); // deep links validados (HTTPS/allowlist/anti-redirect)

// Calcula un estado de precio/lifecycle honesto para una Pick desde su estado almacenado + el evento.
function pickLifecycle(p) {
  const now = Date.now();
  const kickoff = p.kickoff_at ? new Date(p.kickoff_at).getTime() : null;
  if (p.settled_at || p.result_outcome) {
    const r = String(p.result_outcome || '').toLowerCase();
    const result_code = r.includes('win') ? 'WIN' : r.includes('los') ? 'LOSS' : r.includes('void') ? 'VOID' : 'SETTLED';
    return { lifecycle_code: 'SETTLED', price_state_code: 'SETTLED', result_code };
  }
  if (p.event_status === 'finished') return { lifecycle_code: 'AWAITING_SETTLEMENT', price_state_code: 'EVENT_STARTED', result_code: 'PENDING' };
  if (kickoff && now >= kickoff) return { lifecycle_code: 'EVENT_STARTED', price_state_code: 'EVENT_STARTED', result_code: 'PENDING' };
  return { lifecycle_code: 'PUBLISHED', price_state_code: 'AVAILABLE', result_code: 'PENDING' };
}

// Ensambla el match detail completo (GP Intelligence). goalInsights solo si el usuario lo tiene habilitado.
async function buildMatch(ctx, eventId, user) {
  const { db, resolveTeamId } = ctx;
  const ev = await repo.eventById(db, eventId);
  if (!ev) return null;
  const evalsMap = await repo.latestEvalsForEvents(db, [eventId]);
  const evalsByOutcome = evalsMap.get(eventId) || {};
  const snapMap = await repo.latestSnapshots(db, [eventId]);
  const snapshot = snapMap.get(eventId) || null;
  const observations = await repo.observationsForEvent(db, eventId);
  const evalRows = Object.values(evalsByOutcome);
  const risks = dto.riskCodes(evalRows, snapshot);
  // Confianza canónica (A.1): un solo valor derivado del análisis controla TODA la presentación.
  const uncertaintyScore = evalRows.reduce((m, e) => Math.max(m, Number(e.uncertainty_score) || 0), 0);
  const confidence_code = confidence.computeConfidence({
    uncertaintyScore: evalRows.length ? uncertaintyScore : null,
    contextCompleteness: snapshot ? snapshot.context_completeness : null,
    dataFreshness: snapshot ? dto._helpers.freshnessCode(snapshot.data_freshness) : null,
    risks,
  });
  const out = {
    header: dto.matchHeader(ev, resolveTeamId),
    probability: dto.probabilityVector(evalsByOutcome),
    qualify: null,                                       // se rellena cuando haya semántica knockout en el snapshot
    analysis: dto.analysisFactors(observations, snapshot),
    risks,
    confidence_code,                                     // LOW | MEDIUM | HIGH (canónico, A.1)
    has_official_v2: evalRows.length > 0,
    updated_at: evalRows.length ? evalRows.map(e => e.created_at).sort().slice(-1)[0] : null,
  };
  if (user.beta && user.beta.goalInsights) {
    const g = await repo.goalSnapshot(db, eventId);
    out.goal_insights = dto.goalInsights(g);
  }
  return out;
}

async function handle(req, res, p, user, ctx) {
  const { db, json } = ctx;
  const url = new URL(req.url, 'http://x');

  // GET /api/beta/bootstrap — estado mínimo para arrancar el cliente (gating + flags + hora servidor).
  if (p === '/api/beta/bootstrap' && req.method === 'GET') {
    return json(res, 200, {
      server_time: new Date().toISOString(),
      gating: user.beta,
      flags: flags.flags(),
      official_model: 'GP_INTELLIGENCE',                 // nunca "v1/v2" al cliente
      user: { email: user.email, is_admin: !!user.isAdmin, lang: user.lang || null },
    });
  }

  // GET /api/beta/dashboard — próximos partidos + resumen GP + picks recientes + value.
  if (p === '/api/beta/dashboard' && req.method === 'GET') {
    const events = await repo.upcomingEvents(db, { limit: 12 });
    const ids = events.map(e => e.id);
    const evalsMap = await repo.latestEvalsForEvents(db, ids);
    const snapMap = await repo.latestSnapshots(db, ids);
    const upcoming = events.map((e) => {
      const evalsByOutcome = evalsMap.get(e.id) || {};
      const snapshot = snapMap.get(e.id) || null;
      const prob = dto.probabilityVector(evalsByOutcome);
      return {
        header: dto.matchHeader(e, ctx.resolveTeamId),
        probability: prob,
        context_state_code: snapshot ? String(snapshot.context_state || '').toUpperCase() : 'BASE_ONLY',
        has_value: Object.values(evalsByOutcome).some(v => ['lean', 'strong'].includes(v.classification)),
      };
    });
    // value accionable (STRONG/LEAN elegible) y picks recientes
    const valueRows = await repo.valueEvaluations(db, { limit: 60 });
    const value = valueRows
      .map(r => dto.valueCard(r, { resolveTeamId: ctx.resolveTeamId }))
      .filter(v => ['STRONG', 'LEAN'].includes(v.classification_code))
      .slice(0, 8);
    const pickRows = await repo.picks(db);
    const recentPicks = pickRows.map(pr => ({ ...dto.pickDto(pr), ...pickLifecycle(pr) })).slice(0, 6);
    return json(res, 200, { upcoming, value, recent_picks: recentPicks, generated_at: new Date().toISOString() });
  }

  // GET /api/beta/match/:eventId — GP Intelligence.
  if (p.startsWith('/api/beta/match/') && req.method === 'GET') {
    const eventId = decodeURIComponent(p.split('/')[4] || '');
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) return json(res, 400, { error: 'event_id inválido' });
    const m = await buildMatch(ctx, eventId, user);
    if (!m) return json(res, 404, { error: 'Evento no encontrado' });
    return json(res, 200, m);
  }

  // GET /api/beta/matches — TODOS los eventos canónicos con GP 1X2 + resumen de value (para Partidos premium).
  // Devuelve team_ids estables para cruzar con el calendario de /api/state. Reusa los mismos DTOs neutrales.
  if (p === '/api/beta/matches' && req.method === 'GET') {
    const rows = await repo.valueEvaluations(db, { limit: 500 });
    const rank = { STRONG: 3, LEAN: 2, WATCH: 1, PASS: 0 };
    const byEvent = new Map();
    for (const raw of rows) {
      const card = dto.valueCard(raw, { resolveTeamId: ctx.resolveTeamId });
      if (['HOME', 'DRAW', 'AWAY'].indexOf(card.outcome_code) < 0) continue; // solo 1X2
      if (!byEvent.has(card.event_id)) byEvent.set(card.event_id, {
        event_id: card.event_id,
        home_team_id: ctx.resolveTeamId ? ctx.resolveTeamId(raw.home_participant) : null,
        away_team_id: ctx.resolveTeamId ? ctx.resolveTeamId(raw.away_participant) : null,
        kickoff_at: dto._helpers.iso(raw.scheduled_start),
        stage_code: raw.stage ? String(raw.stage).toUpperCase() : null,
        status_code: String(raw.status || 'scheduled').toUpperCase(),
        gp: {}, market: {}, value: null,
      });
      const e = byEvent.get(card.event_id);
      e.gp[card.outcome_code] = card.gp_probability;
      e.market[card.outcome_code] = card.market_probability;
      const belowMin = card.best_odds != null && card.minimum_odds != null && card.best_odds < card.minimum_odds;
      const better = !e.value || rank[card.classification_code] > rank[e.value.signal] ||
        (rank[card.classification_code] === rank[e.value.signal] && (card.adjusted_edge_pp || -9) > (e.value.edge_pp == null ? -9 : e.value.edge_pp));
      if (better) e.value = { signal: card.classification_code, outcome_code: card.outcome_code, edge_pp: card.adjusted_edge_pp, best_odds: card.best_odds, minimum_odds: card.minimum_odds, best_sportsbook: card.best_sportsbook, below_min: belowMin, actionable: !!(card.actionable && !belowMin) };
    }
    return json(res, 200, { items: Array.from(byEvent.values()), count: byEvent.size, generated_at: new Date().toISOString() });
  }

  // GET /api/beta/value — lista con filtros (?class=STRONG|LEAN|WATCH|ALL & ?team= & ?book=).
  if (p === '/api/beta/value' && req.method === 'GET') {
    const cls = (url.searchParams.get('class') || 'ACTIONABLE').toUpperCase();
    const team = url.searchParams.get('team');
    const book = url.searchParams.get('book');
    const rows = await repo.valueEvaluations(db, { limit: 200 });
    let cards = rows.map(r => dto.valueCard(r, { resolveTeamId: ctx.resolveTeamId }));
    // PASS se omite de la vista principal (§9); ACTIONABLE = STRONG|LEAN.
    if (cls === 'ACTIONABLE') cards = cards.filter(c => ['STRONG', 'LEAN'].includes(c.classification_code));
    else if (cls !== 'ALL') cards = cards.filter(c => c.classification_code === cls);
    else cards = cards.filter(c => c.classification_code !== 'PASS'); // ALL = todas menos PASS (analítica aparte)
    if (team) cards = cards.filter(c => c.team_ref && c.event_id); // team filtra en cliente por team_id del header
    if (book) cards = cards.filter(c => (c.best_sportsbook || '').toLowerCase().includes(book.toLowerCase()));
    cards.sort((a, b) => (b.adjusted_edge_pp || 0) - (a.adjusted_edge_pp || 0));
    return json(res, 200, { items: cards, count: cards.length, filter: { class: cls, team, book } });
  }

  // GET /api/beta/picks — lista de Picks.
  if (p === '/api/beta/picks' && req.method === 'GET') {
    const rows = await repo.picks(db);
    const items = rows.map(pr => ({ ...dto.pickDto(pr), ...pickLifecycle(pr) }));
    return json(res, 200, { items, count: items.length });
  }

  // GET /api/beta/picks/:id — detalle de Pick.
  if (p.startsWith('/api/beta/picks/') && req.method === 'GET') {
    const pickId = decodeURIComponent(p.split('/')[4] || '');
    if (!/^[0-9a-f-]{36}$/i.test(pickId)) return json(res, 400, { error: 'pick_id inválido' });
    const pr = await repo.pickById(db, pickId);
    if (!pr) return json(res, 404, { error: 'Pick no encontrada' });
    return json(res, 200, { ...dto.pickDto(pr), ...pickLifecycle(pr) });
  }

  // GET /api/beta/history — historial + métricas con gate de muestra insuficiente.
  if (p === '/api/beta/history' && req.method === 'GET') {
    const summary = await repo.historySummary(db);
    const pickRows = await repo.picks(db);
    const picks = pickRows.map(pr => ({ ...dto.pickDto(pr), ...pickLifecycle(pr) }));
    const settledCount = summary.settled.reduce((a, r) => a + Number(r.n), 0);
    const wins = summary.settled.filter(r => /win/i.test(r.result_outcome || '')).reduce((a, r) => a + Number(r.n), 0);
    const losses = summary.settled.filter(r => /los/i.test(r.result_outcome || '')).reduce((a, r) => a + Number(r.n), 0);
    const voids = summary.settled.filter(r => /void/i.test(r.result_outcome || '')).reduce((a, r) => a + Number(r.n), 0);
    return json(res, 200, {
      // separación visual histórico (modelo anterior) vs GP actual — sin elección de modelo
      timeline_note_code: 'MODEL_EVOLVED',
      picks_total: picks.length,
      settled: settledCount, wins, losses, voids,
      win_rate: settledCount > 0 ? Number((wins / settledCount).toFixed(4)) : null,
      sample_status_code: settledCount < 10 ? 'INSUFFICIENT_SAMPLE' : 'OK', // no afirmar rentabilidad con muestra chica
      picks,
      shadow_baseline: summary.shadow_facts.map(f => ({
        model_label_code: f.model_label === 'V1' || f.model_label === 'PREVIOUS' ? 'PREVIOUS' : 'CURRENT',
        n: Number(f.n), brier: f.brier != null ? Number(Number(f.brier).toFixed(4)) : null,
        log_loss: f.ll != null ? Number(Number(f.ll).toFixed(4)) : null,
      })),
    });
  }

  // GET /api/beta/arbitrage — lista de oportunidades (con estado §12). Gateado por GP_ARBITRAGE_UI_ENABLED.
  if (p === '/api/beta/arbitrage' && req.method === 'GET') {
    if (!user.beta || !user.beta.arbitrage) return json(res, 404, { error: 'No encontrado' });
    const rows = await arbitrage.list(db, { limit: 60 });
    const legsMap = await arbitrage.legsForMany(db, rows.map(r => r.eval_id)); // anti-N+1
    const items = rows.map(row => arbitrage.cardDto(row, legsMap.get(row.eval_id) || [], ctx.resolveTeamId));
    const executable = items.filter(i => i.executable);
    return json(res, 200, { items, count: items.length, executable_count: executable.length, generated_at: new Date().toISOString() });
  }

  // GET /api/beta/arbitrage/:id — detalle (legs + economía + settlement compat + deep links validados).
  if (p.startsWith('/api/beta/arbitrage/') && req.method === 'GET') {
    if (!user.beta || !user.beta.arbitrage) return json(res, 404, { error: 'No encontrado' });
    const id = decodeURIComponent(p.split('/')[4] || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: 'id inválido' });
    const rows = await arbitrage.list(db, { limit: 200 });
    const row = rows.find(r => r.id === id);
    if (!row) return json(res, 404, { error: 'Oportunidad no encontrada' });
    const legs = await arbitrage.legsFor(db, row.eval_id);
    const detail = arbitrage.detailDto(row, legs, ctx.resolveTeamId);
    // resolver deep links validados por leg (HTTPS/allowlist/anti-redirect); si no hay exacto → FALLBACK_PROVIDER_HOME
    detail.legs.forEach((l) => {
      try {
        const v = (l.venue || '').toLowerCase();
        const venueCode = v.includes('kalshi') ? 'kalshi' : v.includes('poly') ? 'polymarket' : null;
        const dl = venueCode ? deepLinks.buildDeepLink({ provider: venueCode }) : null;
        if (dl && dl.url) { l.deep_link = dl.url; l.deep_link_status = dl.verified ? 'EXACT' : 'FALLBACK_PROVIDER_HOME'; }
        else { l.deep_link = null; l.deep_link_status = 'UNAVAILABLE'; }
      } catch { l.deep_link = null; l.deep_link_status = 'UNAVAILABLE'; }
    });
    return json(res, 200, detail);
  }

  return false; // no manejado
}

module.exports = { handle, pickLifecycle, buildMatch };
