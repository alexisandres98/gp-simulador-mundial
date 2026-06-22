// canonical-graph/ruleNormalizer.js — normaliza las reglas del proveedor a semántica interna (Sprint 2).
// Conservador: si no puede determinar una condición material, la deja en null y la añade a ambiguousTerms
// (NO adivina). El título NO basta: se usan título + description/rules + convenciones por proveedor.

'use strict';
const RULE_NORMALIZER_VERSION = 'rule-normalizer-1';
const taxonomy = require('./taxonomy');

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const has = (t, re) => re.test(t);

// extractText(market, providerName) → texto combinado de título + reglas (lo que exponga el proveedor)
function extractText(market = {}) {
  const parts = [market.title, market.groupItemTitle, market.question, market.description,
    market.rules_primary, market.rules_secondary, market.rulesText, market.subtitle].filter(Boolean);
  return parts.join(' \n ');
}

// normalize(market, providerName) → { normalizedRules, rulesText, ambiguousTerms }
function normalize(market = {}, providerName = null) {
  const rulesText = extractText(market);
  const t = norm(rulesText).replace(/\s+/g, ' ').trim(); // colapsa espacios: el formato no cambia la semántica
  const ambiguous = [];

  // periodo / prórroga / penales
  let includesExtraTime = null, includesPenalties = null;
  if (has(t, /\b(after extra time|a\.?e\.?t\.?|including extra time|incl\.? extra time|extra time)\b/)) includesExtraTime = true;
  else if (has(t, /\b(90 minutes|regulation time|full[- ]?time only|excluding extra time|within 90)\b/)) includesExtraTime = false;
  if (has(t, /\b(no|without|excluding) penalt/)) includesPenalties = false;
  else if (has(t, /(penalt|shoot[- ]?out)/)) includesPenalties = true;
  else if (includesExtraTime === false) includesPenalties = false;

  // periodo de mitad (mercado distinto)
  let halfPeriod = null;
  if (has(t, /\b(first half|1st half)\b/)) halfPeriod = 'first_half';
  else if (has(t, /\b(second half|2nd half)\b/)) halfPeriod = 'second_half';

  // empate posible (maneja negación "no draw"/two-way → false; frases específicas → true; no bare "draw")
  let drawPossible = null;
  if (has(t, /\b(no draw|two[- ]way|moneyline|win or lose)\b/)) drawPossible = false;
  else if (has(t, /\b(1x2|three[- ]way|draw possible|including the draw|tie possible)\b/)) drawPossible = true;

  // clasificación / win vs qualify
  const qualificationMarket = has(t, /\b(qualif|to advance|advance to|progress|reach the (final|semi|quarter|next round))\b/) || null;

  // resolución / cancelación / postponement
  const resolutionSource = matchSource(t);
  const voidIfPostponed = has(t, /\bvoid if (postponed|not played)\b/) ? true : (has(t, /\b(remains open|stays open|rescheduled)\b/) ? false : null);
  const voidIfAbandoned = has(t, /\bvoid if (abandoned|suspended)\b/) ? true : null;

  // términos ambiguos detectados
  if (includesExtraTime === null) ambiguous.push('period_unspecified');
  if (drawPossible === null) ambiguous.push('draw_unspecified');
  if (!resolutionSource) ambiguous.push('resolution_source_unknown');
  if (!rulesText || rulesText.length < 8) ambiguous.push('rules_missing');

  const normalizedRules = {
    marketPeriod: null, // se rellena abajo desde taxonomy
    includesExtraTime, includesPenalties, drawPossible,
    qualificationMarket: qualificationMarket || false,
    settlementTrigger: qualificationMarket ? 'qualification' : (has(t, /\bwinner|to win\b/) ? 'match_result' : null),
    resolutionSource, resolutionDeadline: null,
    postponementPolicy: voidIfPostponed === true ? 'void_if_postponed' : voidIfPostponed === false ? 'remains_open' : null,
    abandonmentPolicy: voidIfAbandoned === true ? 'void_if_abandoned' : null,
    cancellationPolicy: null,
    voidConditions: [voidIfPostponed === true ? 'postponed' : null, voidIfAbandoned === true ? 'abandoned' : null].filter(Boolean),
    ambiguousTerms: ambiguous,
    provider: providerName,
  };
  normalizedRules.marketPeriod = halfPeriod || taxonomy.classifyPeriod(normalizedRules);
  return { normalizedRules, rulesText, ambiguousTerms: ambiguous };
}

function matchSource(t) {
  if (has(t, /\bfifa\b/) || has(t, /world cup/)) return 'fifa_official'; // el Mundial es competición FIFA → misma fuente en ambos proveedores
  if (has(t, /\bofficial (result|source)|governing body\b/)) return 'official';
  if (has(t, /\bespn\b/)) return 'espn';
  return null;
}

module.exports = { RULE_NORMALIZER_VERSION, normalize, extractText };
