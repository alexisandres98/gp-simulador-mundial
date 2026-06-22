// entitlements/billing.js — Sprint 8B §55,§56. Abstracción de billing con INVARIANTES forzados OFF.
// En Sprint 8 NADA cobra: no Stripe, no checkout, no portal, no paywall. Aunque el entorno se configure
// mal, estas funciones NO crean checkout/clientes/cobros; responden feature_disabled y avisan al admin.
'use strict';

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

// invariantes: SIEMPRE off en Sprint 8 (la activación real es una fase posterior con aprobación explícita).
function invariants() {
  return {
    billing_enabled: false,
    billing_provider: 'none',
    stripe_enabled: false,
    checkout_enabled: false,
    customer_portal_enabled: false,
    paywall_enabled: false,
    subscription_enforcement_enabled: false,
  };
}

// ¿el entorno está mal configurado intentando activar billing? → warning admin, NO se activa nada.
function misconfigurationWarnings() {
  const w = [];
  for (const k of ['BILLING_ENABLED', 'BILLING_STRIPE_ENABLED', 'CHECKOUT_ENABLED', 'CUSTOMER_PORTAL_ENABLED', 'PAYWALL_ENABLED', 'SUBSCRIPTION_ENFORCEMENT_ENABLED']) {
    if (bool(process.env[k], false)) w.push(`ignored_${k.toLowerCase()}_billing_forced_off_during_world_cup`);
  }
  if ((process.env.BILLING_PROVIDER || 'none') !== 'none') w.push('ignored_billing_provider_forced_none');
  return w;
}

// noopBillingProvider — implementación activa: NUNCA llama a Stripe, NUNCA cobra.
const noopBillingProvider = {
  name: 'noop',
  async createCustomer() { return { ok: false, disabled: true, reason: 'feature_disabled' }; },
  async createCheckoutSession() { return { ok: false, disabled: true, reason: 'feature_disabled' }; },
  async createPortalSession() { return { ok: false, disabled: true, reason: 'feature_disabled' }; },
  async handleWebhook() { return { ok: false, disabled: true, reason: 'feature_disabled' }; },
  async getSubscription() { return { ok: false, disabled: true, reason: 'feature_disabled' }; },
  async cancelSubscription() { return { ok: false, disabled: true, reason: 'feature_disabled' }; },
};

// el provider activo SIEMPRE es noop en Sprint 8 (no se resuelve a Stripe pase lo que pase en el env).
function activeProvider() { return noopBillingProvider; }

module.exports = { invariants, misconfigurationWarnings, noopBillingProvider, activeProvider };
