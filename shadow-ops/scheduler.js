// shadow-ops/scheduler.js — Fase N.1 (N.2). Orquestador SHADOW continuo, AISLADO y seguro. Se invoca desde el
// value tick SOLO si GP_V2_SHADOW_ENABLED=true. Nunca afecta el pipeline oficial (todo en try/catch). Cada job
// con lock anti-solape + telemetría (shadow_job_runs). El refresh con API (context/goal markets) va detrás de
// GP_V2_SHADOW_REFRESH_ENABLED (default OFF) para no consumir cuota sin control. La parte barata (settlement de
// eventos finalizados + telemetría) corre cada ciclo. resultResolver opcional: (canonicalEventId)→{homeGoals,awayGoals}|null.
'use strict';
const db = require('../database/client');
const repo = require('./repository');
const lc = require('./lifecycle');
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
function enabled() { return bool(process.env.GP_V2_SHADOW_ENABLED, false); }

// barrido de settlement: eventos con v2 snapshot, kickoff pasado, aún sin shadow settlement, con resultado disponible.
async function settlementSweep({ now = Date.now(), resultResolver = null } = {}) {
  if (!resultResolver) return { settled: 0, reason: 'no_result_resolver' };
  const evs = (await db.query(
    `SELECT DISTINCT v.canonical_event_id, ce.scheduled_start
       FROM v2_probability_snapshots v JOIN canonical_events ce ON ce.id=v.canonical_event_id
      WHERE ce.scheduled_start < now()
        AND v.canonical_event_id NOT IN (SELECT canonical_event_id FROM shadow_settlements WHERE subject_type='v2_1x2')
      LIMIT 50`)).rows;
  let settled = 0;
  for (const e of evs) {
    const res = await Promise.resolve(resultResolver(e.canonical_event_id)).catch(() => null);
    // solo liquidar mercados regulation con resultado FINAL y REGLAMENTARIO fiable (sin prórroga/penales).
    if (!res || res.final !== true || res.regulation !== true || typeof res.homeGoals !== 'number') continue;
    const v2 = (await db.query(`SELECT base_probability_vector, final_probability_vector FROM v2_probability_snapshots WHERE canonical_event_id=$1 ORDER BY created_at DESC LIMIT 1`, [e.canonical_event_id])).rows[0];
    const gvr = (await db.query(`SELECT market_id, market_family, gp_probability FROM goal_value_shadow WHERE canonical_event_id=$1`, [e.canonical_event_id])).rows;
    const r = lc.settleEvent({ canonicalEventId: e.canonical_event_id, v1Vector: v2 && v2.base_probability_vector, v2Snapshot: v2, goalValueRows: gvr, result: { homeGoals: res.homeGoals, awayGoals: res.awayGoals, observedAt: new Date(now).toISOString() } });
    for (const f of r.facts) await repo.recordMetricFact(f).catch(() => {});
    for (const s of r.settlements) await repo.recordSettlement(s).catch(() => {});
    settled++;
  }
  return { settled };
}

// tick principal (barato): lock + telemetría + settlement sweep. AISLADO. Devuelve resumen, nunca lanza.
async function tick({ now = Date.now(), resultResolver = null } = {}) {
  if (!enabled()) return { skipped: 'shadow_disabled' };
  let got = false, runId = null;
  try {
    got = await repo.acquireLock('shadow_loop', 4 * 60 * 1000);
    if (!got) return { skipped: 'locked' };
    runId = await repo.startRun('shadow_loop');
    const sweep = await settlementSweep({ now, resultResolver });
    await repo.finishRun(runId, { status: 'success', rows: sweep.settled || 0, metadata: sweep });
    return { ok: true, ...sweep };
  } catch (e) {
    if (runId) await repo.finishRun(runId, { status: 'failed', errorReason: e.message }).catch(() => {});
    return { error: e.message };
  } finally { if (got) await repo.releaseLock('shadow_loop').catch(() => {}); }
}

module.exports = { enabled, tick, settlementSweep };
