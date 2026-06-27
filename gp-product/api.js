// gp-product/api.js — Fase Q §15. Dispatcher de /api/beta/*. TODAS las rutas pasan por betaGuard (en server.js)
// antes de llegar aquí, así que `user` siempre tiene acceso beta. Devuelve DTOs de cliente (códigos neutrales,
// timestamps ISO, sin secretos/HTML). Inyecta dependencias vía ctx para no duplicar lógica del server.
'use strict';

const dto = require('./dto');
const repo = require('./repository');
const flags = require('./flags');

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
  const out = {
    header: dto.matchHeader(ev, resolveTeamId),
    probability: dto.probabilityVector(evalsByOutcome),
    qualify: null,                                       // se rellena cuando haya semántica knockout en el snapshot
    analysis: dto.analysisFactors(observations, snapshot),
    risks: dto.riskCodes(evalRows, snapshot),
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

  return false; // no manejado
}

module.exports = { handle, pickLifecycle, buildMatch };
