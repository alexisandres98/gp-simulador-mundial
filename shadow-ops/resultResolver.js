// shadow-ops/resultResolver.js — Fase O §16. Resuelve el resultado REGLAMENTARIO de un canonical_event vía ESPN
// (fixture mapeado en signal_event_fixture_mappings). Para mercados regulation usa el marcador de 90'+añadido,
// SIN prórroga ni penales. En knockout con ET/penales devuelve el regulation score si ESPN lo separa, o marca
// unresolved-for-regulation. Idempotente (lo usa el shadow_loop). Fetch endurecido (allowlist ESPN).
'use strict';
const db = require('../database/client');
const sec = require('../collector/security');
const ALLOW = ['espn.com', 'api.espn.com', 'site.api.espn.com'];

// resolve(canonicalEventId) → { homeGoals, awayGoals, status, regulation, final } | null
async function resolve(canonicalEventId) {
  const m = (await db.query(`SELECT espn_id, fixture_id FROM signal_event_fixture_mappings WHERE canonical_event_id=$1 AND review_status='approved' LIMIT 1`, [canonicalEventId])).rows[0];
  const espnId = m && (m.espn_id || m.fixture_id);
  if (!espnId) return null;
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary?event=${encodeURIComponent(espnId)}`;
  const r = await sec.safeFetch(url, { allowlist: ALLOW });
  if (!r.ok || !r.body) return null;
  let j; try { j = JSON.parse(r.body); } catch { return null; }
  const comp = (((j.header || {}).competitions || [])[0]) || ((j.competitions || [])[0]);
  if (!comp) return null;
  const st = (comp.status || {}).type || {};
  const state = st.state;                                  // pre | in | post
  if (state !== 'post' || st.completed !== true) return { status: state || 'unknown', final: false };
  const comps = comp.competitors || [];
  const home = comps.find(c => c.homeAway === 'home'), away = comps.find(c => c.homeAway === 'away');
  if (!home || !away) return { status: 'post', final: false };
  // marcador reglamentario: ESPN expone score final; si hubo prórroga/penales, no es regulation puro.
  const hg = Number(home.score), ag = Number(away.score);
  if (!Number.isFinite(hg) || !Number.isFinite(ag)) return { status: 'post', final: false };
  // detección de ET/penales por descripción del status (conservador): si la detail menciona penales/ET → regulation no fiable
  const detail = (st.detail || st.description || '').toLowerCase();
  const wentExtra = /penal|shootout|extra time|aet|ft-pens|a\.e\.t/.test(detail);
  if (wentExtra) return { status: 'post', final: true, regulation: false, homeGoals: hg, awayGoals: ag, note: 'extra_time_or_penalties_regulation_unreliable' };
  return { status: 'post', final: true, regulation: true, homeGoals: hg, awayGoals: ag };
}

module.exports = { resolve, ALLOW };
