// competition-registry/index.js — Sprint 8B §57,§58. Define la cobertura por competición y su estado por
// capa (data/model/canonical/value/pick/public). NO asume que tener cuotas = modelo validado. No publica
// Picks GP en una competición hasta que todos los estados lo permitan. INERTE sin POST_WORLD_CUP_COMPETITIONS_ENABLED.
'use strict';
const db = require('../database/client');
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const flags = () => ({ enabled: bool(process.env.POST_WORLD_CUP_COMPETITIONS_ENABLED, false) });

const STATUSES = ['unsupported', 'discovery', 'data_shadow', 'mapping_review', 'model_shadow', 'value_shadow', 'internal', 'public', 'paused'];

async function upsert(c = {}) {
  if (!db.isConfigured()) return { ok: false, error: 'no_db' };
  if (c.data_status && !STATUSES.includes(c.data_status)) return { ok: false, error: 'invalid_status' };
  const r = await db.query(
    `INSERT INTO competition_registry (sport, country, competition_code, display_name, provider_keys, season, start_at, end_at, data_status, model_status, canonical_status, value_status, pick_status, public_status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (sport, competition_code, season) DO UPDATE SET display_name=EXCLUDED.display_name, provider_keys=EXCLUDED.provider_keys,
       data_status=EXCLUDED.data_status, model_status=EXCLUDED.model_status, canonical_status=EXCLUDED.canonical_status,
       value_status=EXCLUDED.value_status, pick_status=EXCLUDED.pick_status, public_status=EXCLUDED.public_status, metadata=EXCLUDED.metadata
     RETURNING *`,
    [c.sport, c.country || null, c.competition_code, c.display_name, JSON.stringify(c.provider_keys || []), c.season || null, c.start_at || null, c.end_at || null,
     c.data_status || 'unsupported', c.model_status || 'unsupported', c.canonical_status || 'unsupported', c.value_status || 'unsupported', c.pick_status || 'unsupported', c.public_status || 'unsupported', JSON.stringify(c.metadata || {})]);
  return { ok: true, competition: r.rows[0] };
}

// ¿se pueden publicar Picks GP en esta competición? Solo si TODAS las capas están listas (§58).
function canPublishPicks(c) {
  if (!c) return { ok: false, reason: 'unknown' };
  const ready = c.data_status === 'public' || c.data_status === 'internal';
  const allReady = ['model_status', 'canonical_status', 'value_status'].every(k => c[k] === 'internal' || c[k] === 'public' || c[k] === 'value_shadow');
  if (c.pick_status !== 'public' && c.pick_status !== 'internal') return { ok: false, reason: 'pick_status_not_ready' };
  if (!ready || !allReady) return { ok: false, reason: 'layers_not_ready' };
  return { ok: true };
}

async function list() {
  if (!db.isConfigured()) return [];
  const r = await db.query(`SELECT * FROM competition_registry ORDER BY sport, display_name`);
  return r.rows;
}

module.exports = { flags, upsert, canPublishPicks, list, STATUSES };
