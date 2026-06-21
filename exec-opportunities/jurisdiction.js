// exec-opportunities/jurisdiction.js — Sprint 4 §20-21. Capa INFORMATIVA de disponibilidad por país. Puro.
// NO determina legalidad definitiva. Estados: available | restricted | unknown | requires_provider_verification.
// Reglas versionadas, con fuente y fecha de revisión cuando exista. Selector MANUAL de país en V1.
// No sugiere VPN. No infiere país solo por IP. No afirma "legal" de forma absoluta.
'use strict';

const JURISDICTION_VERSION = 'jurisdiction-seed-1';

// SEED informativo y CONSERVADOR. Ante la menor duda → requires_provider_verification (no afirmar).
// Estos registros son un punto de partida; las reglas reales viven en provider_jurisdiction_rules (DB)
// y deben mantenerse con fuente oficial y fecha de revisión. NADA aquí es asesoría legal.
const SEED_RULES = [
  // Polymarket: históricamente no disponible para usuarios de EE.UU. (informativo, verificar en la plataforma).
  { provider: 'polymarket', country_code: 'US', status: 'restricted', source_url: 'https://polymarket.com/tos', source_checked_at: '2026-06-21', notes: 'Informativo: verificar elegibilidad directamente con la plataforma.', version: JURISDICTION_VERSION },
  // Kalshi: plataforma regulada en EE.UU.; disponibilidad fuera de EE.UU. debe verificarse con la plataforma.
  { provider: 'kalshi', country_code: 'US', status: 'available', source_url: 'https://kalshi.com', source_checked_at: '2026-06-21', notes: 'Informativo: verificar elegibilidad directamente con la plataforma.', version: JURISDICTION_VERSION },
];

// lookup(rules, provider, country) → registro o null. country en ISO-3166 alpha-2 (mayúsculas).
function lookup(rules, provider, country) {
  if (!country) return null;
  const c = String(country).toUpperCase();
  const p = String(provider).toLowerCase();
  return (rules || []).find(r => String(r.provider).toLowerCase() === p && String(r.country_code).toUpperCase() === c) || null;
}

// statusFor(rule) → estado normalizado. Sin regla → 'requires_provider_verification' (no asumir acceso).
function statusFor(rule) {
  if (!rule) return 'requires_provider_verification';
  const s = String(rule.status || '').toLowerCase();
  if (['available', 'restricted', 'unknown', 'requires_provider_verification'].includes(s)) return s;
  return 'requires_provider_verification';
}

// evaluateJurisdiction({ providers, country, rules }) → resumen por proveedor + combinado para la oportunidad.
function evaluateJurisdiction({ providers = [], country = null, rules = SEED_RULES } = {}) {
  if (!country) {
    return {
      country: null,
      perProvider: providers.map(p => ({ provider: p, status: 'unknown', note: 'Selecciona tu país para estimar disponibilidad.' })),
      combined: 'unknown',
      message: 'Selecciona tu país para estimar la disponibilidad de las plataformas. La elegibilidad final depende de cada plataforma.',
      version: JURISDICTION_VERSION,
    };
  }

  const perProvider = providers.map(p => {
    const rule = lookup(rules, p, country);
    const status = statusFor(rule);
    return {
      provider: p,
      status,
      source_url: rule ? rule.source_url || null : null,
      source_checked_at: rule ? rule.source_checked_at || null : null,
      note: rule ? rule.notes || null : 'Sin información para tu país: verifica directamente con la plataforma.',
    };
  });

  // Combinado (sección 21).
  let combined, message;
  const statuses = perProvider.map(x => x.status);
  if (statuses.every(s => s === 'available')) {
    combined = 'available';
    message = 'Según la información disponible, ambas plataformas podrían estar disponibles en tu país. Verifica tu elegibilidad directamente con cada plataforma.';
  } else if (statuses.some(s => s === 'restricted')) {
    combined = 'restricted';
    message = 'Una de las plataformas puede no estar disponible en tu jurisdicción. La oportunidad podría no ser ejecutable para ti.';
  } else {
    combined = 'requires_provider_verification';
    message = 'Verifica tu elegibilidad directamente con la plataforma. No asumimos acceso.';
  }

  return { country: String(country).toUpperCase(), perProvider, combined, message, version: JURISDICTION_VERSION };
}

module.exports = { evaluateJurisdiction, lookup, statusFor, SEED_RULES, JURISDICTION_VERSION };
