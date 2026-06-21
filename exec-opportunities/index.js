// exec-opportunities/index.js — Sprint 4. Fachada de la capa de producto. Gating por flags.
// Requerirla NO conecta nada (los repos abren pg de forma perezosa). Con flags apagados, todo inerte.
'use strict';

const cfg = require('./config');
const presentation = require('./presentation');
const jurisdiction = require('./jurisdiction');
const deepLinks = require('./deepLinks');
const calculatorService = require('./calculatorService');
const analytics = require('./analytics');
const publicationService = require('./publicationService');
const pubRepo = require('./repositories/publicationRepository');

// ---------- estado admin (sin secretos, no ejecuta evaluación) ----------
async function adminStatus() {
  const out = { flags: cfg.flags, publication: cfg.publication, layerVersion: cfg.LAYER_VERSION, counts: null, analytics: null };
  if (cfg.platform.db.configured) {
    try { out.counts = await pubRepo.counts(); } catch { /* noop */ }
    try { out.analytics = await require('./repositories/analyticsRepository').summary({ sinceHours: 24 }); } catch { /* noop */ }
  }
  return out;
}

// carga reglas de jurisdicción desde DB; si no hay, usa el SEED informativo.
async function loadJurisdictionRules() {
  if (!cfg.flags.geoFilterEnabled) return jurisdiction.SEED_RULES;
  try {
    const rows = await require('./repositories/jurisdictionRepository').all();
    return rows && rows.length ? rows : jurisdiction.SEED_RULES;
  } catch { return jurisdiction.SEED_RULES; }
}

// superpone jurisdicción + deep links (frescos, dependen de país/usuario) sobre un payload congelado.
async function overlay(payload, { country, rules } = {}) {
  if (!payload) return payload;
  const providers = (payload.legs || []).map(l => l.provider).filter(Boolean);
  // jurisdicción
  if (cfg.flags.geoFilterEnabled) {
    const j = jurisdiction.evaluateJurisdiction({ providers, country, rules });
    payload.jurisdiction = j;
    payload.jurisdiction_status = j.combined;
  }
  // deep links (solo si el flag está activo; si no, sin botones externos)
  if (cfg.flags.deepLinksEnabled) {
    payload.deep_links = (payload.legs || []).map(l => {
      const dl = deepLinks.buildDeepLink({ provider: l.provider, ...(l._deepLinkArgs || {}) });
      // si una plataforma está restringida para el país, no entregar su deep link como ejecutable
      const restricted = cfg.flags.geoFilterEnabled && payload.jurisdiction &&
        (payload.jurisdiction.perProvider.find(p => p.provider === l.provider) || {}).status === 'restricted';
      return { provider: l.provider, label: dl.label, url: restricted ? null : dl.url, verified: dl.verified, restricted: !!restricted, reason: restricted ? 'jurisdiction_restricted' : dl.reason };
    });
  } else {
    payload.deep_links = [];
  }
  return payload;
}

// revalidación "al leer" para la vista pública: solo expiración por reloj sobre el snapshot publicado.
// (La revalidación profunda contra la evaluación actual la hace el scheduler/endpoint admin con datos vivos.)
function clockState(pub, now) {
  if (pub.publication_status !== 'published') return { visible: false, displayStatus: 'EXPIRED' };
  if (pub.expires_at && new Date(pub.expires_at).getTime() <= now) return { visible: false, displayStatus: 'EXPIRED' };
  const valAge = pub.updated_at ? now - new Date(pub.updated_at).getTime() : Infinity;
  return { visible: true, displayStatus: valAge > cfg.publication.maxRevalidationAgeMs ? 'VERIFYING' : 'ACTIVE' };
}

// ---------- API pública ----------
async function listPublicOpportunities({ country = null, includeBeta = false, limit = 50, offset = 0 } = {}) {
  if (!cfg.flags.publicEnabled) return { items: [], enabled: false };
  const now = Date.now();
  const rules = await loadJurisdictionRules();
  const rows = await pubRepo.listPublic({ limit, offset, includeBeta });
  const items = [];
  for (const pub of rows) {
    const st = clockState(pub, now);
    if (!st.visible) continue; // no servir Pure Arb stale/expirado
    const payload = pub.public_payload || {};
    await overlay(payload, { country, rules });
    const card = presentation.buildCardPayload(payload);
    if (card) { card.display_status = st.displayStatus; items.push(card); }
  }
  return { items, enabled: true };
}

async function getPublicOpportunity(publicId, { country = null } = {}) {
  if (!cfg.flags.publicEnabled) return { error: 'not_enabled' };
  const pub = await pubRepo.findByPublicId(publicId);
  if (!pub) return { error: 'not_found' };
  const now = Date.now();
  const st = clockState(pub, now);
  const payload = pub.public_payload || {};
  const rules = await loadJurisdictionRules();
  await overlay(payload, { country, rules });
  payload.display_status = st.displayStatus;
  payload.visible = st.visible;
  return { payload, publication_status: pub.publication_status };
}

// ---------- calculadora pública (server-side) ----------
// legsSource(publicId) → { legs, strategy, evaluationId, validUntil, expired, legMeta } | null
// En este entorno (sin datos vivos) el resolver devuelve expired/unavailable; en tests se inyecta.
async function calculate(publicId, input = {}, legsSource = null) {
  if (!cfg.flags.calculatorEnabled) return { available: false, message: 'Calculadora no disponible.' };
  let source = { expired: true, evaluationId: null };
  if (typeof legsSource === 'function') { try { source = await legsSource(publicId) || source; } catch { /* noop */ } }
  const result = calculatorService.calculate(input, source);
  // analítica mínima (rango anónimo, nunca el monto exacto)
  try { await analytics.record('calculator_used', { public_id: publicId, calculator_range: analytics.bucketCapital(input.capital) }); } catch { /* noop */ }
  return result;
}

module.exports = {
  cfg,
  adminStatus,
  listPublicOpportunities,
  getPublicOpportunity,
  calculate,
  overlay,
  loadJurisdictionRules,
  // servicio de publicación (acciones admin) + submódulos para los endpoints/tests
  publication: publicationService,
  presentation, eligibility: require('./eligibility'), revalidation: require('./revalidation'),
  jurisdiction, deepLinks, analytics, breakpoints: require('./breakpoints'), calculatorService,
};
