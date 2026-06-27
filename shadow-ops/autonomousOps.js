// shadow-ops/autonomousOps.js — Fase P.0. Operación AUTÓNOMA shadow: news + weather + V2 reeval + totals, con
// cadencia escalonada, lock anti-solape, quota guard y telemetría. AISLADO: cualquier error se ignora (nunca
// afecta V1/Registry/closing/settlement oficial). Se invoca desde el shadow_loop SOLO si GP_V2_SHADOW_ENABLED y,
// para la parte con APIs externas, GP_V2_SHADOW_REFRESH_ENABLED. NO crea nada oficial.
'use strict';
const https = require('https');
const crypto = require('crypto');
const db = require('../database/client');
const repo = require('./repository');
const { TEAMS } = require('../data/tournament');
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
function refreshEnabled() { return bool(process.env.GP_V2_SHADOW_REFRESH_ENABLED, false); }

const norm = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const aliasToId = {}; TEAMS.forEach(t => [t.en, t.name, ...(t.aliases || [])].forEach(a => aliasToId[norm(a)] = t.id));
const aliasOf = id => { const t = TEAMS.find(x => x.id === id); return t ? [t.en, t.name, ...(t.aliases || [])] : []; };

// cadencia: ¿le toca correr a este job? (último run success más viejo que intervalMs). Escalonado por kickoff afuera.
async function due(jobName, intervalMs) {
  const r = (await db.query(`SELECT started_at FROM shadow_job_runs WHERE job_name=$1 AND status='success' ORDER BY started_at DESC LIMIT 1`, [jobName])).rows[0];
  if (!r) return true;
  return (Date.now() - new Date(r.started_at).getTime()) >= intervalMs;
}
function getJSON(url) { return new Promise((res, rej) => { https.get(url, { timeout: 15000 }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res({ code: r.statusCode, headers: r.headers, body: JSON.parse(d) }); } catch (e) { rej(e); } }); }).on('error', rej).on('timeout', function () { this.destroy(); rej(new Error('timeout')); }); }); }

// upcoming events con v2 snapshot (prematch)
async function upcomingEvents(limit = 6) {
  return (await db.query(`SELECT id, home_participant h, away_participant a, scheduled_start k FROM canonical_events WHERE scheduled_start > now() AND id IN (SELECT canonical_event_id FROM v2_probability_snapshots) ORDER BY scheduled_start LIMIT $1`, [limit])).rows;
}

// JOB: news fetch (RSS) → documentos + claims + entity. Barato.
async function jobNews() {
  const adapters = require('../collector/adapters'); const cx = require('../collector/claimExtractor');
  const er = require('../collector/entityResolver'); const crepo = require('../collector/repository');
  const srcs = await crepo.enabledSources(); const news = srcs.filter(s => s.source_type === 'news');
  if (!news.length) return { sources_attempted: 0, documents_new: 0, claims_extracted: 0, reason: 'no_news_sources' };
  const evs = await upcomingEvents();
  const fixtures = evs.map(e => ({ id: e.id, home_aliases: aliasOf(aliasToId[norm(e.h)]), away_aliases: aliasOf(aliasToId[norm(e.a)]) }));
  let docs = 0, claims = 0, attempted = 0, ok = 0;
  const allow = [...new Set(news.map(s => s.domain).filter(Boolean))].concat(['bbci.co.uk', 'bbc.co.uk', 'espn.com']);
  for (const s of news) {
    attempted++;
    const feedUrl = s.source_key === 'bbc_football' ? 'https://feeds.bbci.co.uk/sport/football/rss.xml' : s.source_key === 'espn_soccer' ? 'https://www.espn.com/espn/rss/soccer/news' : null;
    if (!feedUrl) continue;
    const r = await adapters.fetchFeed(feedUrl, { allowlist: allow }).catch(() => ({ ok: false }));
    if (!r.ok) continue; ok++;
    const fr = await crepo.recordFetch({ source_id: s.source_id, http_status: r.status, etag: r.etag, content_hash: r.contentHash, fetch_status: 'ok' }).catch(() => null);
    for (const it of (r.items || []).slice(0, 25)) {
      const text = (it.title + ' ' + (it.summary || '')).slice(0, 4000);
      const nh = 'nh:' + crypto.createHash('sha256').update(norm(text)).digest('hex');
      const d = await crepo.recordDocument({ source_id: s.source_id, canonical_url: it.link, title: it.title, language: s.language, source_published_at: it.published_at, timestamp_quality: it.published_at ? 'SOURCE_PUBLISHED' : 'INGESTION_OBSERVED', normalized_content_hash: nh, content_excerpt: text.slice(0, 280), fetch_run_id: fr }).catch(() => ({ duplicate: true }));
      if (d.duplicate) continue; docs++;
      const ent = er.resolveEvent(text, fixtures);
      for (const c of cx.extractClaims(text, { tierClass: s.reliability_tier })) {
        await crepo.recordClaim({ document_id: d.row.document_id, factor_code: c.factor_code, subject_type: 'team', event_id: ent.selected_event_id, fact_or_inference: c.fact_or_inference, claim_text_hash: c.claim_text_hash, confidence: c.confidence, source_published_at: it.published_at, timestamp_quality: it.published_at ? 'SOURCE_PUBLISHED' : 'INGESTION_OBSERVED', materiality: ent.selected_event_id ? 'MATERIAL' : 'NON_MATERIAL', entity_match_confidence: ent.confidence, entity_match_method: ent.method, applied: false, applied_impact: 0, review_status: ent.review_required ? 'review_required' : 'auto' }).catch(() => {});
        claims++;
      }
    }
  }
  return { sources_attempted: attempted, sources_successful: ok, documents_new: docs, claims_extracted: claims };
}

// JOB: weather exacto para eventos con venue resuelto. Open-Meteo (sin key).
async function jobWeather() {
  const weather = require('../collector/weather'); const crepo = require('../collector/repository');
  const rows = (await db.query(`SELECT e.canonical_event_id, ce.scheduled_start k, v.venue_id, v.canonical_name, v.latitude, v.longitude
     FROM event_venue_resolution e JOIN canonical_venues v ON v.venue_id=e.venue_id JOIN canonical_events ce ON ce.id=e.canonical_event_id
     WHERE e.status='resolved' AND ce.scheduled_start > now() LIMIT 8`)).rows;
  let wx = 0;
  for (const r of rows) {
    const f = await weather.fetchForecast({ lat: Number(r.latitude), lon: Number(r.longitude), kickoffIso: r.k.toISOString() }).catch(() => ({ ok: false }));
    if (!f.ok) continue; const s = f.snapshot;
    await crepo.recordWeather({ canonical_event_id: r.canonical_event_id, venue: r.canonical_name, latitude: Number(r.latitude), longitude: Number(r.longitude), kickoff_local: r.k.toISOString(), forecast_issued_at: s.forecast_issued_at, horizon_hours: s.horizon_hours, temperature_c: s.temperature_c, apparent_c: s.apparent_c, humidity_pct: s.humidity_pct, precip_mm: s.precip_mm, wind_kmh: s.wind_kmh, weather_factors: s.weather_factors, source: 'open-meteo', input_hash: s.input_hash + ':exact', venue_id: r.venue_id, venue_exact: true }).catch(() => {});
    wx++;
  }
  return { weather_snapshots: wx };
}

// JOB: totals refresh (The Odds API) con quota guard. Cadencia escalonada por kickoff afuera.
async function jobTotals() {
  const KEY = process.env.SPORTSBOOK_PROVIDER_API_KEY; if (!KEY) return { reason: 'no_key' };
  const reserve = num(process.env.SPORTSBOOK_QUOTA_RESERVE, 2000);
  const grepo = require('../goal-engine/repository');
  const r = await getJSON(`https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds?regions=eu,uk&markets=totals&oddsFormat=decimal&dateFormat=iso&apiKey=${KEY}`).catch(() => null);
  if (!r || r.code !== 200) return { reason: 'fetch_failed', status: r && r.code };
  const before = num(r.headers['x-requests-remaining'], null), used = num(r.headers['x-requests-last'], null);
  if (before != null && before < reserve) return { reason: 'quota_reserve', credits_before: before };
  const cevs = (await db.query(`SELECT id, home_participant h, away_participant a FROM canonical_events WHERE scheduled_start > now()`)).rows;
  const idx = {}; for (const c of cevs) idx[norm(c.h) + '|' + norm(c.a)] = c.id;
  let ingested = 0, events = 0;
  for (const e of r.body) {
    const cid = idx[norm(e.home_team) + '|' + norm(e.away_team)]; if (!cid) continue; events++;
    for (const bk of e.bookmakers || []) for (const m of bk.markets || []) { if (m.key !== 'totals') continue; for (const o of m.outcomes || []) { const side = (o.name || '').toLowerCase(); await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: bk.key, external_event_id: e.id, canonical_event_id: cid, market_family: 'match_total', line: o.point, side, market_id: `TOTAL_GOALS_${side.toUpperCase()}_${String(o.point).replace('.', '_')}`, odds_decimal: o.price, implied_probability: 1 / o.price, quote_status: 'open', provider_update: bk.last_update }).catch(() => {}); ingested++; } }
  }
  return { credits_before: before, credits_used: used, events_received: r.body.length, events_matched: events, quotes_ingested: ingested };
}

// orquestador: corre los jobs DUE con lock + telemetría. Cadencia conservadora. Devuelve resumen.
async function tick({ now = Date.now() } = {}) {
  if (!refreshEnabled()) return { skipped: 'refresh_disabled' };
  const jobs = [
    { name: 'news_fetch', interval: 30 * 60 * 1000, fn: jobNews },
    { name: 'weather_refresh', interval: 60 * 60 * 1000, fn: jobWeather },
    { name: 'goal_market_totals', interval: 30 * 60 * 1000, fn: jobTotals },
  ];
  const out = {};
  for (const j of jobs) {
    try {
      if (!(await due(j.name, j.interval))) { out[j.name] = 'not_due'; continue; }
      if (!(await repo.acquireLock(j.name, 5 * 60 * 1000))) { out[j.name] = 'locked'; continue; }
      const rid = await repo.startRun(j.name);
      let r; try { r = await j.fn(); await repo.finishRun(rid, { status: 'success', rows: r.documents_new || r.weather_snapshots || r.quotes_ingested || 0, metadata: r }); }
      catch (e) { r = { error: e.message }; await repo.finishRun(rid, { status: 'failed', errorReason: e.message }); }
      finally { await repo.releaseLock(j.name).catch(() => {}); }
      out[j.name] = r;
    } catch (e) { out[j.name] = { error: e.message }; }
  }
  return out;
}

module.exports = { refreshEnabled, due, jobNews, jobWeather, jobTotals, tick };
