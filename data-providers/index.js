// index.js — ORQUESTADOR de la capa de datos de la Fase 4.
// La UI nunca llama providers ni APIs: el servidor llama estas dos funciones y entrega
// data ya normalizada. Prioridad: API-Football → ESPN → manual/cache. Nunca lanza.

const af = require('./apiFootballProvider');
const espn = require('./espnProvider');
const manual = require('./manualProvider');
const N = require('./normalizer');
const { generateGPTake } = require('./gpTake');

function newStatus() {
  return {
    apiFootball: af.configured() ? 'configurado' : 'sin key',
    usedApiFootball: false,
    usedEspnFallback: false,
    usedManualFallback: false,
    lastUpdated: new Date().toISOString(),
    notes: [],
  };
}

// Cuotas tradicionales: primer bookmaker con "Match Winner" → {book, home, draw, away}
function normalizeOdds(afOdds) {
  try {
    const entry = afOdds && afOdds[0];
    const bk = entry && entry.bookmakers && entry.bookmakers[0];
    const bet = bk && (bk.bets || []).find(b => /match winner|1x2|fulltime result/i.test(b.name));
    if (!bet) return [];
    const v = bet.values || [];
    const pick = lbl => { const x = v.find(o => new RegExp(lbl, 'i').test(o.value)); return x ? Number(x.odd) : null; };
    return [{ book: bk.name, home: pick('home|^1$'), draw: pick('draw|^x$'), away: pick('away|^2$') }];
  } catch { return []; }
}

// ---------- CONTEXTO DE PARTIDO ----------
// ctx: { homeCode, awayCode, homeName, awayName, isoDate, espnId, isFinal, isLive }
async function getMatchContext(ctx) {
  const status = newStatus();
  const result = {
    lineups: { home: null, away: null },
    events: [], statistics: null,
    recentForm: { home: null, away: null },
    injuries: [], news: [], odds: [],
    providerStatus: status,
  };
  const safe = async (fn, fb) => { try { return await fn(); } catch { return fb; } };

  let homeApiId = null, awayApiId = null, fixtureApiId = null;
  if (af.configured()) {
    [homeApiId, awayApiId] = await Promise.all([
      safe(() => af.resolveTeamId(ctx.homeCode, ctx.homeName), null),
      safe(() => af.resolveTeamId(ctx.awayCode, ctx.awayName), null),
    ]);
    if (homeApiId && awayApiId) {
      const fx = await safe(() => af.findFixture(homeApiId, awayApiId, ctx.isoDate), null);
      fixtureApiId = fx && fx.fixture ? fx.fixture.id : null;
    }
  }

  // ---- LINEUPS ----
  if (fixtureApiId) {
    const ls = await safe(() => af.getFixtureLineups(fixtureApiId), []);
    if (ls && ls.length) {
      for (const l of ls) {
        const side = l.team && l.team.id === homeApiId ? 'home' : l.team && l.team.id === awayApiId ? 'away' : null;
        if (side) { result.lineups[side] = N.normalizeLineup(l, true); status.usedApiFootball = true; }
      }
    }
  }
  // fallback: alineación probable manual
  for (const side of ['home', 'away']) {
    if (!result.lineups[side]) {
      const code = side === 'home' ? ctx.homeCode : ctx.awayCode;
      const proj = await safe(() => manual.getProjectedLineup(code), null);
      if (proj) { result.lineups[side] = N.normalizeProjectedLineup(proj); status.usedManualFallback = true; }
    }
  }

  // ---- EVENTS + STATS (solo si hay partido en vivo/finalizado) ----
  if (fixtureApiId && (ctx.isLive || ctx.isFinal)) {
    const [evs, st] = await Promise.all([
      safe(() => af.getFixtureEvents(fixtureApiId), []),
      safe(() => af.getFixtureStatistics(fixtureApiId), []),
    ]);
    if (evs && evs.length) {
      result.events = evs.map(N.normalizeEvent).map(e => ({
        ...e, side: e.teamApiId === String(homeApiId) ? 'home' : e.teamApiId === String(awayApiId) ? 'away' : null,
      }));
      status.usedApiFootball = true;
    }
    const stats = N.normalizeStatistics(st);
    if (stats) {
      result.statistics = { home: stats[String(homeApiId)] || null, away: stats[String(awayApiId)] || null };
      status.usedApiFootball = true;
    }
  }

  // ---- RECENT FORM ----
  for (const side of ['home', 'away']) {
    const apiId = side === 'home' ? homeApiId : awayApiId;
    const code = side === 'home' ? ctx.homeCode : ctx.awayCode;
    let form = null;
    if (apiId) {
      const fx = await safe(() => af.getTeamRecentResults(apiId, 5), []);
      form = N.normalizeTeamForm(fx, apiId, 5);
      if (form) status.usedApiFootball = true;
    }
    if (!form) {
      const m = await safe(() => manual.getTeamFormFallback(code), null);
      form = N.normalizeTeamFormManual(m);
      if (form) status.usedManualFallback = true;
    }
    result.recentForm[side] = form;
  }

  // ---- INJURIES (ambos equipos) ----
  for (const side of ['home', 'away']) {
    const apiId = side === 'home' ? homeApiId : awayApiId;
    const code = side === 'home' ? ctx.homeCode : ctx.awayCode;
    const teamName = side === 'home' ? ctx.homeName : ctx.awayName;
    let list = [];
    if (apiId) {
      const inj = await safe(() => af.getTeamInjuries(apiId), []);
      list = (inj || []).slice(0, 8).map(x => ({ ...N.normalizeInjury(x, 'api'), team: teamName, side }));
      if (list.length) status.usedApiFootball = true;
    }
    if (!list.length) {
      const m = await safe(() => manual.getManualInjuries(code), []);
      list = (m || []).map(x => ({ ...N.normalizeInjury(x, 'manual'), team: teamName, side }));
      if (list.length) status.usedManualFallback = true;
    }
    result.injuries.push(...list);
  }

  // ---- ODDS (API-Football, opcional) ----
  if (fixtureApiId) {
    const o = await safe(() => af.getFixtureOdds(fixtureApiId), []);
    result.odds = normalizeOdds(o);
    if (result.odds.length) status.usedApiFootball = true;
  }

  // ---- NEWS (ESPN, fallback) ----
  const articles = await safe(() => espn.getTeamNews(), []);
  if (articles && articles.length) {
    const names = [ctx.homeName, ctx.awayName].map(s => String(s || '').toLowerCase());
    const filtered = articles.filter(a => {
      const t = (a.headline || a.title || '').toLowerCase();
      return names.some(n => n && t.includes(n));
    });
    result.news = (filtered.length ? filtered : articles).slice(0, 4).map(N.normalizeNews);
    if (result.news.length) status.usedEspnFallback = true;
  }

  status._ids = { homeApiId, awayApiId, fixtureApiId };
  return result;
}

// ---------- CONTEXTO DE EQUIPO ----------
// ctx: { code, name }
async function getTeamContext(ctx) {
  const status = newStatus();
  const result = {
    squad: [], keyPlayers: [], injuries: [], sidelined: [],
    projectedLineup: null, recentForm: null, results: [], schedule: [],
    news: [], notes: null, tactical: null,
    providerStatus: status,
  };
  const safe = async (fn, fb) => { try { return await fn(); } catch { return fb; } };

  let apiId = null;
  if (af.configured()) apiId = await safe(() => af.resolveTeamId(ctx.code, ctx.name), null);

  // ---- SQUAD ----
  if (apiId) {
    const sq = await safe(() => af.getTeamSquad(apiId), []);
    if (sq && sq.length) {
      result.squad = sq.map(p => N.normalizePlayer({
        id: p.id, name: p.name, number: p.number, age: p.age, position: p.position,
      }));
      status.usedApiFootball = true;
    }
  }

  // ---- KEY PLAYERS (manual primero: son editoriales) ----
  const kp = await safe(() => manual.getKeyPlayers(ctx.code), []);
  if (kp && kp.length) {
    result.keyPlayers = kp.map(p => N.normalizePlayer(
      { name: p.name, number: p.number, position: p.position, age: p.age },
      { club: p.club, status: p.status, note: p.note }
    ));
    status.usedManualFallback = true;
  } else if (result.squad.length) {
    result.keyPlayers = result.squad.slice(0, 5);
  }

  // ---- INJURIES / SIDELINED ----
  if (apiId) {
    const [inj, side] = await Promise.all([
      safe(() => af.getTeamInjuries(apiId), []),
      safe(() => af.getTeamSidelined(apiId), []),
    ]);
    result.injuries = (inj || []).slice(0, 12).map(x => ({ ...N.normalizeInjury(x, 'api'), team: ctx.name }));
    result.sidelined = (side || []).slice(0, 12).map(x => N.normalizeInjury(x, 'api'));
    if (result.injuries.length || result.sidelined.length) status.usedApiFootball = true;
  }
  if (!result.injuries.length) {
    const m = await safe(() => manual.getManualInjuries(ctx.code), []);
    result.injuries = (m || []).map(x => ({ ...N.normalizeInjury(x, 'manual'), team: ctx.name }));
    if (result.injuries.length) status.usedManualFallback = true;
  }

  // ---- PROJECTED LINEUP (manual) ----
  const proj = await safe(() => manual.getProjectedLineup(ctx.code), null);
  if (proj) { result.projectedLineup = N.normalizeProjectedLineup(proj); status.usedManualFallback = true; }

  // ---- FORM / RESULTS / SCHEDULE ----
  if (apiId) {
    const [recent, next] = await Promise.all([
      safe(() => af.getTeamRecentResults(apiId, 8), []),
      safe(() => af.getTeamFixtures(apiId, 0, 3), []),
    ]);
    const form = N.normalizeTeamForm(recent, apiId, 5);
    if (form) { result.recentForm = form; status.usedApiFootball = true; }
    result.results = (recent || []).map(f => N.normalizeMatchBasic(f, apiId)).filter(Boolean).slice(0, 8);
    result.schedule = (next || []).map(f => N.normalizeMatchBasic(f, apiId)).filter(Boolean);
  }
  if (!result.recentForm) {
    const m = await safe(() => manual.getTeamFormFallback(ctx.code), null);
    const form = N.normalizeTeamFormManual(m);
    if (form) { result.recentForm = form; status.usedManualFallback = true; }
  }

  // ---- NOTES / TACTICAL (manual editorial) ----
  result.notes = await safe(() => manual.getTeamNotes(ctx.code), null);
  result.tactical = await safe(() => manual.getTacticalNotes(ctx.code), null);
  if (result.notes || result.tactical) status.usedManualFallback = true;

  // ---- NEWS (ESPN) ----
  const articles = await safe(() => espn.getTeamNews(), []);
  if (articles && articles.length) {
    const n = String(ctx.name || '').toLowerCase();
    const filtered = articles.filter(a => (a.headline || a.title || '').toLowerCase().includes(n));
    result.news = (filtered.length ? filtered : articles).slice(0, 5).map(N.normalizeNews);
    if (result.news.length) status.usedEspnFallback = true;
  }

  status._ids = { apiId };
  return result;
}

module.exports = { getMatchContext, getTeamContext, generateGPTake, providerConfigured: af.configured };
