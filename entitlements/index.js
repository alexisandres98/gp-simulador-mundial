// entitlements/index.js — Sprint 8B §52-54. Sistema de entitlements SEPARADO de billing. El producto
// pregunta "¿tiene entitlement para esta función?", nunca "¿pagó Stripe?". Durante el Mundial,
// WORLD_CUP_FREE_ACCESS_ENABLED otorga acceso amplio sin pago. INERTE sin ENTITLEMENTS_ENABLED →
// no restringe NADA (acceso libre como hoy). Billing forzado off (ver billing.js).
'use strict';
const db = require('../database/client');
const billing = require('./billing');

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const flags = () => ({
  enabled: bool(process.env.ENTITLEMENTS_ENABLED, false),
  worldCupFreeAccess: bool(process.env.WORLD_CUP_FREE_ACCESS_ENABLED, false),
});

// hasFeature(userRef, feature) → { allowed, source }. Regla clave: si entitlements está OFF, NO restringe
// (allowed=true) → el producto sigue gratis/abierto como hoy. Si está ON: override > grant(plan_features) >
// acceso gratis del Mundial > default false.
async function hasFeature(userRef, feature) {
  if (!flags().enabled) return { allowed: true, source: 'entitlements_disabled' }; // no restringe
  if (!db.isConfigured()) return { allowed: true, source: 'no_db' };
  // 1) override explícito (staff/pruebas)
  const ov = await db.query(`SELECT allowed FROM entitlement_overrides WHERE user_ref=$1 AND feature_code=$2 AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC LIMIT 1`, [userRef, feature]);
  if (ov.rows[0]) return { allowed: ov.rows[0].allowed, source: 'override' };
  // 2) grant activo → plan_features
  const grant = await db.query(
    `SELECT g.plan_code FROM user_access_grants g
       WHERE g.user_ref=$1 AND g.revoked_at IS NULL AND g.starts_at<=now() AND (g.expires_at IS NULL OR g.expires_at>now())
       ORDER BY g.created_at DESC`, [userRef]);
  for (const row of grant.rows) {
    const pf = await db.query(`SELECT 1 FROM plan_features WHERE plan_code=$1 AND feature_code=$2`, [row.plan_code, feature]);
    if (pf.rowCount) return { allowed: true, source: 'grant:' + row.plan_code };
    if (row.plan_code === 'world_cup_all_access' || row.plan_code === 'admin') return { allowed: true, source: 'grant:' + row.plan_code };
  }
  // 3) acceso gratis del Mundial (si está habilitado) → acceso amplio sin pago
  if (flags().worldCupFreeAccess) return { allowed: true, source: 'world_cup_free_access' };
  return { allowed: false, source: 'no_entitlement' };
}

// otorga un grant (admin). source obligatorio; no hardcodea fechas.
async function grant({ userRef, planCode, source, expiresAt = null, reason = null, createdBy = null }) {
  if (!db.isConfigured()) return { ok: false, error: 'no_db' };
  const r = await db.query(
    `INSERT INTO user_access_grants (user_ref, plan_code, source, expires_at, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [userRef, planCode, source, expiresAt, reason, createdBy]);
  return { ok: true, grant: r.rows[0] };
}
async function revoke(grantId) {
  if (!db.isConfigured()) return { ok: false, error: 'no_db' };
  const r = await db.query(`UPDATE user_access_grants SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING id`, [grantId]);
  return { ok: r.rowCount > 0 };
}

async function userEntitlements(userRef) {
  if (!db.isConfigured()) return { features: [], plans: [] };
  const grants = await db.query(`SELECT plan_code, source, expires_at FROM user_access_grants WHERE user_ref=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`, [userRef]);
  return { plans: grants.rows, world_cup_free_access: flags().worldCupFreeAccess, billing: billing.invariants() };
}

module.exports = { flags, hasFeature, grant, revoke, userEntitlements, billing };
