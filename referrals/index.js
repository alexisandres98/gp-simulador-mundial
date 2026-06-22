// referrals/index.js — Sprint 8A §47-49. Referrals básicos: código no predecible, click tracking,
// atribución (un registro NO se atribuye dos veces, sin self-referral), recompensas NO financieras (§48),
// detección de abuso para revisión admin (no bloquea solo). INERTE sin REFERRALS_ENABLED.
'use strict';
const crypto = require('crypto');
const db = require('../database/client');

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const flags = () => ({ enabled: bool(process.env.REFERRALS_ENABLED, false), rewards: bool(process.env.REFERRALS_ENABLED, false) && bool(process.env.REFERRAL_REWARDS_ENABLED, false) });

// recompensas permitidas (NO financieras §48)
const ALLOWED_REWARDS = new Set(['badge', 'early_access', 'waitlist_priority', 'cosmetic', 'beta_invite']);
const FORBIDDEN_REWARDS = new Set(['bet_balance', 'cashback', 'loss_commission', 'stake_payment', 'deposit_bonus']);

// código no secuencial/no predecible (base32 de bytes aleatorios). hashSeed inyectable para tests deterministas.
function genCode(seed = null) {
  const bytes = seed != null ? crypto.createHash('sha256').update(String(seed)).digest() : crypto.randomBytes(8);
  return bytes.toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toLowerCase();
}

async function ensureCode(userRef, seed = null) {
  if (!flags().enabled || !db.isConfigured()) return { code: null, skipped: 'inactive' };
  const ex = await db.query(`SELECT code FROM referral_codes WHERE user_ref=$1 AND active=true LIMIT 1`, [userRef]);
  if (ex.rows[0]) return { code: ex.rows[0].code };
  let code = genCode(seed || userRef + ':' + Date.now());
  // colisión improbable → reintenta una vez
  const clash = await db.query(`SELECT 1 FROM referral_codes WHERE code=$1`, [code]);
  if (clash.rowCount) code = genCode(code + ':2');
  await db.query(`INSERT INTO referral_codes (code, user_ref) VALUES ($1,$2) ON CONFLICT (code) DO NOTHING`, [code, userRef]);
  return { code };
}

async function track({ code, anonymousId = null, ipHash = null }) {
  if (!flags().enabled || !db.isConfigured()) return { tracked: false };
  const c = await db.query(`SELECT 1 FROM referral_codes WHERE code=$1 AND active=true`, [code]);
  if (!c.rowCount) return { tracked: false, reason: 'unknown_code' };
  await db.query(`INSERT INTO referral_clicks (code, anonymous_id, ip_hash) VALUES ($1,$2,$3)`, [code, anonymousId, ipHash]);
  return { tracked: true };
}

// attribute: cuando un referido se registra. Reglas: no self-referral, un solo registro por referido (§47).
async function attribute({ code, referredRef, touchType = 'first' }) {
  if (!flags().enabled || !db.isConfigured()) return { attributed: false, reason: 'inactive' };
  const c = await db.query(`SELECT user_ref FROM referral_codes WHERE code=$1 AND active=true`, [code]);
  if (!c.rowCount) return { attributed: false, reason: 'unknown_code' };
  const referrer = c.rows[0].user_ref;
  if (referrer === referredRef) return { attributed: false, reason: 'self_referral' };
  const r = await db.query(
    `INSERT INTO referral_attributions (code, referrer_ref, referred_ref, touch_type) VALUES ($1,$2,$3,$4)
     ON CONFLICT (referred_ref) DO NOTHING RETURNING *`,
    [code, referrer, referredRef, touchType]
  );
  if (!r.rows[0]) return { attributed: false, reason: 'already_attributed' };
  return { attributed: true, referrer, attribution: r.rows[0] };
}

async function grantReward({ userRef, rewardType, reason = null }) {
  if (!flags().rewards || !db.isConfigured()) return { granted: false, reason: 'inactive' };
  if (FORBIDDEN_REWARDS.has(rewardType)) return { granted: false, reason: 'forbidden_financial_reward' };
  if (!ALLOWED_REWARDS.has(rewardType)) return { granted: false, reason: 'unknown_reward' };
  const r = await db.query(`INSERT INTO referral_rewards (user_ref, reward_type, reason) VALUES ($1,$2,$3) RETURNING *`, [userRef, rewardType, reason]);
  return { granted: true, reward: r.rows[0] };
}

// señales de abuso para REVISIÓN admin (no bloquea solo §49): muchos clicks desde el mismo ip_hash, etc.
async function abuseSignals(code) {
  if (!db.isConfigured()) return { signals: [] };
  const r = await db.query(`SELECT ip_hash, count(*)::int n FROM referral_clicks WHERE code=$1 AND ip_hash IS NOT NULL GROUP BY ip_hash HAVING count(*) > 10`, [code]);
  return { signals: r.rows.map(x => ({ type: 'many_clicks_same_ip', ip_hash: x.ip_hash, count: x.n })) };
}

async function status(userRef) {
  if (!flags().enabled || !db.isConfigured()) return { enabled: false };
  const code = await db.query(`SELECT code FROM referral_codes WHERE user_ref=$1 AND active=true LIMIT 1`, [userRef]);
  const refs = await db.query(`SELECT count(*)::int n FROM referral_attributions WHERE referrer_ref=$1`, [userRef]);
  return { enabled: true, code: code.rows[0] && code.rows[0].code || null, referrals: refs.rows[0].n };
}

module.exports = { flags, genCode, ensureCode, track, attribute, grantReward, abuseSignals, status, ALLOWED_REWARDS, FORBIDDEN_REWARDS };
