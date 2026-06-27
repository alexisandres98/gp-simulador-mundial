// collector/claimExtractor.js — Fase O §6/§7. Extracción de claims DETERMINÍSTICA (rule-based, sin LLM →
// sin vector de prompt-injection). El texto externo es DATO no confiable. Detecta negaciones, clasifica
// FACT/INFERENCE/RUMOR y valida contra un schema cerrado. La fuente/extracción NUNCA define el impacto (eso es
// la factor policy aguas abajo). Salida que no valida → impact 0 + review_required.
'use strict';
const crypto = require('crypto');

const FACTOR_PATTERNS = [
  { factor: 'PLAYER_CONFIRMED_OUT', cls: 'FACT', re: /\b(ruled out|out (injured|of the squad)|will miss|baja confirmada|descartad[oa]|fuera del partido|no jugará)\b/i },
  { factor: 'PLAYER_SUSPENDED', cls: 'FACT', re: /\b(suspend(ed|ido)|ban(ned)?|sanción|tarjeta roja acumulada)\b/i },
  { factor: 'PLAYER_DOUBTFUL', cls: 'INFERENCE', re: /\b(doubtful|in doubt|may miss|en duda|duda|podría perderse)\b/i },
  { factor: 'PLAYER_RETURNED_TO_TRAINING', cls: 'INFERENCE', re: /\b(returned to training|back in training|volvió a entrenar|regres[oó] a los entrenamientos)\b/i },
  { factor: 'PLAYER_CONFIRMED_STARTER', cls: 'FACT', re: /\b(confirmed (in the )?starting|will start|titular confirmad[oa]|sale de inicio)\b/i },
  { factor: 'STARTING_GOALKEEPER_CONFIRMED', cls: 'FACT', re: /\b(goalkeeper.*(will start|confirmed)|arquero.*(titular|confirmad)|portero.*(titular|confirmad))\b/i },
  { factor: 'FORMATION_CHANGE_EXPECTED', cls: 'INFERENCE', re: /\b(change.*formation|switch to a? ?\d-\d|cambio de (esquema|formación)|pasar(á|a) a un \d-\d)\b/i },
  { factor: 'COACH_ROTATION_CONFIRMED', cls: 'INFERENCE', re: /\b(rotat(e|ion)|rest(ing)? key players|rotación|rotará|dará descanso)\b/i },
  { factor: 'EXTREME_HEAT', cls: 'FACT', re: /\b(heat (warning|wave)|extreme heat|ola de calor|calor extremo)\b/i },
  { factor: 'HEAVY_RAIN', cls: 'FACT', re: /\b(heavy rain|downpour|lluvia (intensa|fuerte)|tormenta)\b/i },
  { factor: 'STRONG_WIND', cls: 'FACT', re: /\b(strong wind|gale|viento (fuerte|intenso))\b/i },
  { factor: 'TEAM_MUST_WIN', cls: 'INFERENCE', re: /\b(must(-| )win|need(s)? (a|the) win|obligad[oa] a ganar|debe ganar)\b/i },
  { factor: 'COACH_STATEMENT_CONFIDENCE', cls: 'INFERENCE', re: /\b(confident|optimistic|confiad[oa]|optimista)\b/i },
];
// negaciones que invierten un FACT_OUT → no aplica (o lo degrada).
const NEGATION_RE = /\b(not ruled out|no(t)? (injured|suspended|out)|will play|available|disponible|sí jugará|no es baja|descartad[oa] la baja|recuperad[oa])\b/i;
const RUMOR_RE = /\b(rumou?r|reportedly|allegedly|se rumorea|según fuentes|trascend(ió|e)|no confirmad[oa])\b/i;

// extractClaims(text, ctx) → [{factor_code, fact_or_inference, confidence, claim_text_hash, negated, valid}]
function extractClaims(rawText, { tierClass = null } = {}) {
  const text = String(rawText || '').slice(0, 20000);
  if (!text) return [];
  const isRumor = RUMOR_RE.test(text);
  const claims = [];
  for (const p of FACTOR_PATTERNS) {
    if (!p.re.test(text)) continue;
    const negated = NEGATION_RE.test(text);
    let cls = p.cls;
    if (isRumor) cls = 'RUMOR';                    // rumor → impacto 0 aguas abajo
    if (negated && (p.factor === 'PLAYER_CONFIRMED_OUT' || p.factor === 'PLAYER_SUSPENDED')) cls = 'INFERENCE'; // contradicción interna → degradar
    // tier de la fuente puede degradar (Tier 3 normalmente INFERENCE; Tier 4 → impacto 0/review)
    if (tierClass === 'TIER_3_APPROVED_SPECIALIST' && cls === 'FACT') cls = 'INFERENCE';
    if (tierClass === 'TIER_4_UNVERIFIED') cls = 'RUMOR';
    const confidence = cls === 'FACT' ? 0.85 : cls === 'INFERENCE' ? 0.5 : 0;
    claims.push({
      factor_code: p.factor, fact_or_inference: cls, confidence, negated,
      claim_text_hash: 'sha256:' + crypto.createHash('sha256').update(p.factor + '|' + text.slice(0, 500)).digest('hex'),
      extraction_method: 'rule_based', extraction_model_version: 'claim-rules-1',
      valid: validate({ factor_code: p.factor, fact_or_inference: cls, confidence }),
    });
  }
  return claims;
}

// schema cerrado: factor_code conocido + clase válida + confidence en [0,1].
const KNOWN = new Set(FACTOR_PATTERNS.map(p => p.factor));
function validate(c) {
  return !!(c && KNOWN.has(c.factor_code) && ['FACT', 'INFERENCE', 'RUMOR', 'UNKNOWN'].includes(c.fact_or_inference) && c.confidence >= 0 && c.confidence <= 1);
}

module.exports = { FACTOR_PATTERNS, extractClaims, validate, KNOWN };
