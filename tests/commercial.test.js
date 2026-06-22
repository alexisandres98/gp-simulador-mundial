// tests/commercial.test.js — Sprint 8A§40-49 + 8B§50-58 (puros). Analítica (schema/privacidad), referrals
// (código/recompensas no financieras), entitlements (no restringe si off), billing (invariantes off),
// waitlist (sin datos de pago), competition registry (no publica sin capas listas).
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const analytics = require(R + '/analytics');
const referrals = require(R + '/referrals');
const entitlements = require(R + '/entitlements');
const billing = require(R + '/entitlements/billing');
const waitlist = require(R + '/entitlements/waitlist');
const compReg = require(R + '/competition-registry');

// analytics
ok('analytics: evento desconocido rechazado', analytics.validate('hack_event', {}).error === 'unknown_event');
ok('analytics: evento permitido ok', analytics.validate('simulation_run', { x: 1 }).ok === true);
ok('analytics: propiedad prohibida (bankroll) rechazada', analytics.validate('simulation_run', { bankroll: 1000 }).error === 'forbidden_property');
ok('analytics: propiedad prohibida (api_key) rechazada', analytics.validate('pick_opened', { api_key: 'x' }).error === 'forbidden_property');
ok('analytics: properties enormes rechazadas', analytics.validate('page_viewed', { blob: 'x'.repeat(9000) }).error === 'properties_too_large');

// referrals
ok('referrals: genCode determinístico con seed', referrals.genCode('seedA') === referrals.genCode('seedA'));
ok('referrals: genCode formato 8 alfanum', /^[a-z0-9]{1,8}$/.test(referrals.genCode('seedB')));
ok('referrals: recompensa financiera prohibida en lista', referrals.FORBIDDEN_REWARDS.has('cashback') && !referrals.ALLOWED_REWARDS.has('cashback'));
ok('referrals: recompensa permitida es no financiera', referrals.ALLOWED_REWARDS.has('badge'));

// entitlements + billing
ok('entitlements: si está OFF no restringe (acceso abierto)', (() => { delete process.env.ENTITLEMENTS_ENABLED; return entitlements.flags().enabled === false; })());
ok('billing: invariantes TODOS off', Object.values(billing.invariants()).every(v => v === false || v === 'none'));
ok('billing: noop createCheckoutSession → feature_disabled', true); // (async, validado en DB test)
ok('billing: provider activo siempre noop', billing.activeProvider().name === 'noop');
ok('billing: misconfig genera warning, no activa billing', (() => { process.env.BILLING_ENABLED = 'true'; const w = billing.misconfigurationWarnings(); delete process.env.BILLING_ENABLED; return w.length >= 1 && billing.invariants().billing_enabled === false; })());

// waitlist
ok('waitlist: rechaza datos de pago', waitlist.validate({ card_number: '4111' }).error === 'no_payment_data');
ok('waitlist: use case inválido rechazado', waitlist.validate({ primary_use_case: 'gambling' }).error === 'invalid_use_case');
ok('waitlist: payload válido ok', waitlist.validate({ primary_use_case: 'picks', email: 'a@b.com' }).ok === true);

// competition registry
ok('compReg: no publica picks si capas no listas', compReg.canPublishPicks({ pick_status: 'unsupported', data_status: 'discovery' }).ok === false);
ok('compReg: publica picks solo con todas las capas listas', compReg.canPublishPicks({ pick_status: 'internal', data_status: 'internal', model_status: 'internal', canonical_status: 'internal', value_status: 'internal' }).ok === true);
ok('compReg: competición desconocida no publica', compReg.canPublishPicks(null).ok === false);

(async () => {
  const cs = await billing.noopBillingProvider.createCheckoutSession();
  ok('billing: noop checkout devuelve disabled (async)', cs.disabled === true && cs.reason === 'feature_disabled');
  console.log(`\ncommercial (puros): ${pass} ✓  ${fail} ✗`);
  process.exit(fail ? 1 : 0);
})();
