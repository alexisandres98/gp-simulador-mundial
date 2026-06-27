// model-registry/repository.js — Fase M.8. Persistencia de la promoción/cutover de modelo (tablas M.2:
// model_promotion_policies + model_cutover_events, append-only el audit). INERTE: nada se invoca desde el
// pipeline. Una sola policy 'active' a la vez (al activar una, las demás activas pasan a 'superseded').
'use strict';
const db = require('../database/client');

async function proposePromotion(p, { client = db } = {}) {
  const r = await client.query(
    `INSERT INTO model_promotion_policies
       (effective_from, previous_official_model, new_official_model, model_version, calibration_version,
        context_policy_version, approved_by, reason, rollback_version, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'proposed') RETURNING *`,
    [p.effective_from || null, p.previous_official_model || 'V1', p.new_official_model || 'V2', p.model_version,
     p.calibration_version || null, p.context_policy_version || null, p.approved_by || null, p.reason || null,
     p.rollback_version || p.previous_official_model || 'V1']);
  const row = r.rows[0];
  await client.query(`INSERT INTO model_cutover_events (policy_id,event_type,from_model,to_model,actor_id,reason) VALUES ($1,'proposed',$2,$3,$4,$5)`,
    [row.policy_id, row.previous_official_model, row.new_official_model, p.approved_by || null, p.reason || null]);
  return row;
}

// transición de estado + evento de auditoría. 'activated' desactiva (supersede) cualquier otra policy activa.
async function transition(policyId, eventType, { actorId, reason, client = db } = {}) {
  const map = { approved: 'proposed', activated: 'approved', rolled_back: null };
  const cur = (await client.query(`SELECT * FROM model_promotion_policies WHERE policy_id=$1`, [policyId])).rows[0];
  if (!cur) return { ok: false, reason: 'not_found' };
  const newStatus = eventType === 'approved' ? 'proposed' /*sigue proposed hasta activar*/ : eventType === 'activated' ? 'active' : eventType === 'rolled_back' ? 'rolled_back' : cur.status;
  if (eventType === 'activated') {
    await client.query(`UPDATE model_promotion_policies SET status='superseded' WHERE status='active' AND policy_id<>$1`, [policyId]);
  }
  await client.query(`UPDATE model_promotion_policies SET status=$2, approved_by=COALESCE($3,approved_by),
       approved_at=CASE WHEN $4='activated' THEN now() ELSE approved_at END WHERE policy_id=$1`,
    [policyId, newStatus, actorId || null, eventType]);
  await client.query(`INSERT INTO model_cutover_events (policy_id,event_type,from_model,to_model,actor_id,reason) VALUES ($1,$2,$3,$4,$5,$6)`,
    [policyId, eventType, cur.previous_official_model, cur.new_official_model, actorId || null, reason || null]);
  const row = (await client.query(`SELECT * FROM model_promotion_policies WHERE policy_id=$1`, [policyId])).rows[0];
  return { ok: true, policy: row };
}

async function activePolicy({ client = db } = {}) {
  return (await client.query(`SELECT * FROM model_promotion_policies WHERE status='active' ORDER BY approved_at DESC LIMIT 1`)).rows[0] || null;
}
async function cutoverHistory(policyId, { client = db } = {}) {
  return (await client.query(`SELECT * FROM model_cutover_events WHERE policy_id=$1 ORDER BY created_at`, [policyId])).rows;
}

module.exports = { proposePromotion, transition, activePolicy, cutoverHistory };
