// collector/repository.js — Fase O. Persistencia del collector (catálogo, fetch runs, documentos, claims, weather).
// INERTE salvo invocación. Append-only en claims/weather (idempotente). NO impacto sin pasar por factor policy.
'use strict';
const db = require('../database/client');

async function upsertSource(s, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO context_source_catalog (source_key,source_name,source_type,domain,country,language,reliability_tier,
        official_status,allowed_collection_method,terms_review_status,robots_review_status,polling_cadence_ms,
        rate_limit_per_hour,enabled,kill_switch)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (source_key) DO UPDATE SET source_name=EXCLUDED.source_name,reliability_tier=EXCLUDED.reliability_tier,
        official_status=EXCLUDED.official_status,allowed_collection_method=EXCLUDED.allowed_collection_method,
        terms_review_status=EXCLUDED.terms_review_status,robots_review_status=EXCLUDED.robots_review_status,
        enabled=EXCLUDED.enabled,kill_switch=EXCLUDED.kill_switch RETURNING *`,
    [s.source_key, s.source_name, s.source_type, s.domain || null, s.country || null, s.language || null,
     s.reliability_tier || 'TIER_4_UNVERIFIED', !!s.official_status, s.allowed_collection_method || 'rss',
     s.terms_review_status || 'pending', s.robots_review_status || 'pending', s.polling_cadence_ms || 3600000,
     s.rate_limit_per_hour || 30, s.enabled !== false ? !!s.enabled : false, !!s.kill_switch]);
  return r.rows[0];
}
async function enabledSources({ client = db } = {}) {
  return (await client.query(`SELECT * FROM context_source_catalog WHERE enabled=true AND kill_switch=false AND reliability_tier<>'BLOCKED' AND terms_review_status='approved'`)).rows;
}
async function recordFetch(f, { client = db } = {}) {
  return (await client.query(
    `INSERT INTO context_fetch_runs (source_id,response_at,http_status,etag,last_modified,content_type,content_hash,bytes,rate_limit_state,fetch_status,error_code)
     VALUES ($1,now(),$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING fetch_run_id`,
    [f.source_id || null, f.http_status ?? null, f.etag || null, f.last_modified || null, f.content_type || null,
     f.content_hash || null, f.bytes ?? null, f.rate_limit_state || null, f.fetch_status || 'ok', f.error_code || null])).rows[0].fetch_run_id;
}
async function recordDocument(d, { client = db } = {}) {
  const ins = await client.query(
    `INSERT INTO context_source_documents (source_id,canonical_url,title,language,source_published_at,provider_updated_at,
        timestamp_quality,raw_content_hash,normalized_content_hash,content_excerpt,fetch_run_id,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (normalized_content_hash) DO NOTHING RETURNING *`,
    [d.source_id || null, d.canonical_url || null, d.title || null, d.language || null, d.source_published_at || null,
     d.provider_updated_at || null, d.timestamp_quality || 'INGESTION_OBSERVED', d.raw_content_hash || null,
     d.normalized_content_hash, d.content_excerpt || null, d.fetch_run_id || null, d.status || 'parsed']);
  if (ins.rows[0]) return { row: ins.rows[0], duplicate: false };
  return { row: (await client.query(`SELECT * FROM context_source_documents WHERE normalized_content_hash=$1`, [d.normalized_content_hash])).rows[0], duplicate: true };
}
async function recordClaim(c, { client = db } = {}) {
  return (await client.query(
    `INSERT INTO context_claims (document_id,factor_code,subject_type,subject_id,event_id,team_id,player_id,
        fact_or_inference,claim_text_hash,confidence,valid_from,valid_until,source_published_at,timestamp_quality,
        extraction_method,extraction_model_version,materiality,propagation_class,entity_match_confidence,
        entity_match_method,applied,applied_impact,discard_reason,review_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING *`,
    [c.document_id || null, c.factor_code, c.subject_type || 'team', c.subject_id || null, c.event_id || null,
     c.team_id || null, c.player_id || null, c.fact_or_inference || 'UNKNOWN', c.claim_text_hash || null,
     c.confidence || 0, c.valid_from || null, c.valid_until || null, c.source_published_at || null,
     c.timestamp_quality || 'INGESTION_OBSERVED', c.extraction_method || 'rule_based', c.extraction_model_version || null,
     c.materiality || 'NON_MATERIAL', c.propagation_class || null, c.entity_match_confidence ?? null,
     c.entity_match_method || null, !!c.applied, c.applied_impact || 0, c.discard_reason || null, c.review_status || 'auto'])).rows[0];
}
async function recordWeather(w, { client = db } = {}) {
  const ins = await client.query(
    `INSERT INTO weather_snapshots (canonical_event_id,venue,latitude,longitude,kickoff_local,forecast_issued_at,
        horizon_hours,temperature_c,apparent_c,humidity_pct,precip_mm,wind_kmh,weather_factors,source,input_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT (input_hash) DO NOTHING RETURNING *`,
    [w.canonical_event_id || null, w.venue || null, w.latitude ?? null, w.longitude ?? null, w.kickoff_local || null,
     w.forecast_issued_at || null, w.horizon_hours ?? null, w.temperature_c ?? null, w.apparent_c ?? null,
     w.humidity_pct ?? null, w.precip_mm ?? null, w.wind_kmh ?? null, JSON.stringify(w.weather_factors || []),
     w.source || 'open-meteo', w.input_hash]);
  if (ins.rows[0]) return { row: ins.rows[0], idempotent: false };
  return { row: (await client.query(`SELECT * FROM weather_snapshots WHERE input_hash=$1`, [w.input_hash])).rows[0], idempotent: true };
}

module.exports = { upsertSource, enabledSources, recordFetch, recordDocument, recordClaim, recordWeather };
