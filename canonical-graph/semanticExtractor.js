// canonical-graph/semanticExtractor.js — construye un DESCRIPTOR semántico desde un mercado de proveedor.
// Combina participantes (alias determinístico), reglas normalizadas + fingerprint, y taxonomía.
// No adivina: si falta participante o reglas materiales, marca criticalDataMissing/ambiguous.

'use strict';
const taxonomy = require('./taxonomy');
const aliases = require('./participantAliases');
const ruleNormalizer = require('./ruleNormalizer');
const ruleFingerprint = require('./ruleFingerprint');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function normStatus(m) {
  if (m.status) { const s = String(m.status).toLowerCase(); if (['settled', 'finalized'].includes(s)) return 'settled'; if (s === 'closed') return 'closed'; if (['active', 'open'].includes(s)) return 'open'; if (['cancelled', 'canceled'].includes(s)) return 'cancelled'; }
  if (m.archived) return 'closed'; if (m.closed === true) return 'settled'; if (m.active === false) return 'closed';
  if (m.active === true || m.acceptingOrders === true) return 'open';
  return null;
}
function detectCategory(t) {
  if (/\b(women|female|femenin|womens)\b/.test(t)) return 'women';
  if (/\bu-?20|under-?20|sub-?20\b/.test(t)) return 'youth_u20';
  if (/\bu-?17|under-?17\b/.test(t)) return 'youth_u17';
  return 'men_senior';
}

// extractParticipants(title, opts) → [{code, canonicalName}]  (dedup; sin fuzzy)
// Escaneo de n-gramas (3→1) sobre todo el texto: encuentra los equipos aunque haya palabras extra
// ("to win", "first half"...). Solo resuelve por alias EXACTO (no fuzzy), así que el ruido no matchea.
function extractParticipants(title, opts = {}) {
  const found = new Map();
  const words = norm(title).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const covered = new Array(words.length).fill(false);
  for (let n = 3; n >= 1; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      if (covered.slice(i, i + n).some(Boolean)) continue; // no solapar (prioriza n-gramas largos)
      const r = aliases.resolve(words.slice(i, i + n).join(' '), opts);
      if (r) { found.set(r.code, { code: r.code, canonicalName: r.canonicalName }); for (let k = i; k < i + n; k++) covered[k] = true; }
    }
  }
  return [...found.values()];
}

// extractDescriptor(market, providerName) → descriptor
function extractDescriptor(market = {}, providerName = null, opts = {}) {
  const title = market.title || market.groupItemTitle || market.question || market.yes_sub_title || '';
  const t = norm(title + ' ' + (market.description || market.rules_primary || ''));
  const { normalizedRules, ambiguousTerms } = ruleNormalizer.normalize(market, providerName);
  // clasificar con el TEXTO COMPLETO (título corto como "Brazil" no basta; usa question/description/reglas)
  const classifyText = [title, market.question, market.description, market.rules_primary, market.rules_secondary].filter(Boolean).join(' ');
  const family = taxonomy.classifyMarketFamily(classifyText, normalizedRules);
  // periodo: en torneo es 'tournament' (no aplica el periodo de partido); en partido, según reglas.
  let period = normalizedRules.marketPeriod;
  if (family === 'tournament_winner') period = 'tournament';
  const scope = taxonomy.scopeForFamily(family);
  const eventType = taxonomy.eventTypeForFamily(family);
  // participantes desde el texto que nombra equipos (título + pregunta + subtítulo), no solo el título corto
  const participantText = [title, market.question, market.yes_sub_title, market.subtitle].filter(Boolean).join(' vs ');
  const participants = extractParticipants(participantText, opts);
  const category = detectCategory(t);
  const competition = /world cup/.test(t) || opts.competition ? (opts.competition || 'world_cup') : 'world_cup';
  const season = opts.season || '2026';
  const fingerprint = ruleFingerprint.fingerprint(normalizedRules);

  // datos faltantes a nivel EVENTO (identidad: participantes) vs MERCADO (reglas), separados.
  const needParticipants = (scope === 'match') ? 2 : 1;
  const eventDataMissing = participants.length < needParticipants;
  const marketDataMissing = ambiguousTerms.includes('rules_missing');
  const criticalDataMissing = eventDataMissing || marketDataMissing; // back-compat

  return {
    provider: providerName,
    marketStatus: normStatus(market),
    externalMarketId: market.conditionId || market.id || market.ticker || market.slug || null,
    externalEventId: market.event_ticker || market.eventSlug || market.externalEventId || null,
    title, sport: 'football', competition, season, category,
    eventType, scope, stage: opts.stage || null,
    family, period,
    participants,
    outcomeParticipant: (scope !== 'match' && participants[0]) ? participants[0] : null,
    scheduledStart: scope === 'match' ? (market.close_time || market.startTime || opts.scheduledStart || null) : null,
    normalizedRules, rulesFingerprint: fingerprint, ambiguousTerms,
    eventDataMissing, marketDataMissing, criticalDataMissing,
  };
}

module.exports = { extractDescriptor, extractParticipants, detectCategory };
