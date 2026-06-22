// tests/commercial-db.test.js — Sprint 8A§40-49 + 8B§50-58 contra PostgreSQL real. Migraciones 019+020,
// analítica (record/overview/funnel), referrals (atribución/abuso/recompensas), entitlements (grant/feature/
// override/revoke + acceso gratis Mundial), waitlist, competition registry. Billing NUNCA cobra.
'use strict';
process.env.DB_SSL = process.env.DB_SSL || 'false';
process.env.PRODUCT_ANALYTICS_ENABLED = 'true';
process.env.PRODUCT_ANALYTICS_WRITE_ENABLED = 'true';
process.env.REFERRALS_ENABLED = 'true';
process.env.REFERRAL_REWARDS_ENABLED = 'true';
process.env.ENTITLEMENTS_ENABLED = 'true';
process.env.PRO_WAITLIST_ENABLED = 'true';
process.env.POST_WORLD_CUP_COMPETITIONS_ENABLED = 'true';

const path = require('path');
const R = path.join(__dirname, '..');
const { boot } = require('./_pg-harness');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  const h = await boot();
  const db = require(R + '/database/client');
  const migrate = require(R + '/database/migrate');
  const analytics = require(R + '/analytics');
  const referrals = require(R + '/referrals');
  const entitlements = require(R + '/entitlements');
  const waitlist = require(R + '/entitlements/waitlist');
  const compReg = require(R + '/competition-registry');

  try {
    await migrate.up();
    const t = await db.query(`SELECT to_regclass('product_events') a, to_regclass('referral_codes') b, to_regclass('plans') c, to_regclass('pro_waitlist') d, to_regclass('competition_registry') e`);
    ok('migraciones 019+020: tablas creadas', t.rows[0].a && t.rows[0].b && t.rows[0].c && t.rows[0].d && t.rows[0].e);

    // analytics
    await analytics.record({ event_name: 'account_created', user_ref: 'u1' });
    await analytics.record({ event_name: 'simulation_run', user_ref: 'u1' });
    await analytics.record({ event_name: 'simulation_run', user_ref: 'u2' });
    const bad = await analytics.record({ event_name: 'hack', user_ref: 'u1' });
    ok('analytics: evento desconocido no se persiste', bad.recorded === false && bad.error === 'unknown_event');
    const ov = await analytics.overview({ days: 7 });
    ok('analytics: overview cuenta eventos + usuarios únicos', ov.events.find(e => e.event_name === 'simulation_run').users === 2);
    const fn = await analytics.funnel({ steps: ['account_created', 'simulation_run'], days: 30 });
    ok('analytics: funnel por paso', fn.steps[0].users === 1 && fn.steps[1].users === 2);

    // referrals
    const code = (await referrals.ensureCode('refUser', 'seed1')).code;
    ok('referrals: ensureCode genera código', !!code && code.length <= 8);
    ok('referrals: ensureCode idempotente', (await referrals.ensureCode('refUser')).code === code);
    await referrals.track({ code, anonymousId: 'anon1', ipHash: 'ip1' });
    const a1 = await referrals.attribute({ code, referredRef: 'newUser' });
    ok('referrals: atribución válida', a1.attributed === true && a1.referrer === 'refUser');
    const a2 = await referrals.attribute({ code, referredRef: 'newUser' });
    ok('referrals: doble atribución del mismo registro rechazada', a2.attributed === false && a2.reason === 'already_attributed');
    const self = await referrals.attribute({ code, referredRef: 'refUser' });
    ok('referrals: self-referral rechazado', self.attributed === false && self.reason === 'self_referral');
    const rew = await referrals.grantReward({ userRef: 'refUser', rewardType: 'badge' });
    ok('referrals: recompensa no financiera otorgada', rew.granted === true);
    const badRew = await referrals.grantReward({ userRef: 'refUser', rewardType: 'cashback' });
    ok('referrals: recompensa financiera rechazada', badRew.granted === false && badRew.reason === 'forbidden_financial_reward');

    // entitlements
    await db.query(`INSERT INTO plans (code, display_name, is_draft) VALUES ('pro','Pro',true) ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO features (code, display_name) VALUES ('picks_gp','Picks GP') ON CONFLICT DO NOTHING`);
    await db.query(`INSERT INTO plan_features (plan_code, feature_code) VALUES ('pro','picks_gp') ON CONFLICT DO NOTHING`);
    const noAccess = await entitlements.hasFeature('uX', 'picks_gp');
    ok('entitlements: sin grant ni acceso Mundial → denegado', noAccess.allowed === false);
    const g = await entitlements.grant({ userRef: 'uX', planCode: 'pro', source: 'beta', createdBy: 'admin' });
    ok('entitlements: grant pro habilita la feature', (await entitlements.hasFeature('uX', 'picks_gp')).allowed === true);
    await db.query(`INSERT INTO entitlement_overrides (user_ref, feature_code, allowed, reason) VALUES ('uX','picks_gp',false,'test')`);
    ok('entitlements: override niega por encima del grant', (await entitlements.hasFeature('uX', 'picks_gp')).allowed === false);
    await entitlements.revoke(g.grant.id);
    ok('entitlements: revoke quita el grant', (await entitlements.userEntitlements('uX')).plans.length === 0);
    // acceso gratis del Mundial
    process.env.WORLD_CUP_FREE_ACCESS_ENABLED = 'true';
    ok('entitlements: acceso gratis del Mundial habilita sin pago', (await entitlements.hasFeature('uFree', 'arbitrage')).source === 'world_cup_free_access');
    delete process.env.WORLD_CUP_FREE_ACCESS_ENABLED;

    // waitlist (sin pago)
    const w = await waitlist.join('uW', { primary_use_case: 'picks', email: 'a@b.com', contact_consent: true });
    ok('waitlist: join sin tarjeta', w.ok === true && w.entry.status === 'joined');
    ok('waitlist: get devuelve la entrada', (await waitlist.get('uW')).primary_use_case === 'picks');

    // competition registry
    const c = await compReg.upsert({ sport: 'soccer', competition_code: 'epl', display_name: 'Premier League', season: '2026-27', data_status: 'data_shadow' });
    ok('compReg: upsert competición en shadow', c.ok === true && c.competition.data_status === 'data_shadow');
    ok('compReg: no publica picks en shadow', compReg.canPublishPicks(c.competition).ok === false);
    ok('compReg: list incluye la competición', (await compReg.list()).some(x => x.competition_code === 'epl'));
  } catch (e) { fail++; console.log('  ✗ excepción', e && e.stack || e); }
  finally { try { await db.close(); } catch {} await h.stop(); }
  console.log(`\ncommercial-db: ${pass} ✓  ${fail} ✗`);
  process.exit(fail ? 1 : 0);
})();
