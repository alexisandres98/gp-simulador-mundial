// collector/claimExtractor.js — Fase O §6/§7. Extracción de claims DETERMINÍSTICA (rule-based, sin LLM →
// sin vector de prompt-injection). El texto externo es DATO no confiable. Detecta negaciones, clasifica
// FACT/INFERENCE/RUMOR y valida contra un schema cerrado. La fuente/extracción NUNCA define el impacto (eso es
// la factor policy aguas abajo). Salida que no valida → impact 0 + review_required.
'use strict';
const crypto = require('crypto');

// MULTILINGÜE (ES/EN/FR/PT). Patrones determinísticos por factor.
const FACTOR_PATTERNS = [
  { factor: 'PLAYER_CONFIRMED_OUT', cls: 'FACT', re: /\b(ruled out|out (injured|of the squad)|will miss|baja confirmada|descartad[oa]|fuera del partido|no jugará|forfait|absent|blessé et indisponible|écarté|desfalca|fora do jogo|cortad[oa]|lesionad[oa] e fora)\b/i },
  { factor: 'PLAYER_SUSPENDED', cls: 'FACT', re: /\b(suspend(ed|ido|u)|ban(ned)?|sanción|sanção|tarjeta roja acumulada|suspens[oã]|carton rouge)\b/i },
  { factor: 'PLAYER_DOUBTFUL', cls: 'INFERENCE', re: /\b(doubtful|in doubt|may miss|en duda|duda|podría perderse|incertain|en balance|dúvida|pode (desfalcar|faltar))\b/i },
  { factor: 'PLAYER_RETURNED_TO_TRAINING', cls: 'INFERENCE', re: /\b(returned to training|back in training|volvió a entrenar|regres[oó] a los entrenamientos|de retour à l.entraînement|voltou aos treinos|retornou)\b/i },
  { factor: 'PLAYER_CONFIRMED_STARTER', cls: 'FACT', re: /\b(confirmed (in the )?starting|will start|titular confirmad[oa]|sale de inicio|titulaire confirmé|sera titulaire|titular confirmad[oa]|começa jogando)\b/i },
  { factor: 'STARTING_GOALKEEPER_CONFIRMED', cls: 'FACT', re: /\b(goalkeeper.*(will start|confirmed)|arquero.*(titular|confirmad)|portero.*(titular|confirmad)|gardien.*(titulaire|confirmé)|goleiro.*(titular|confirmad))\b/i },
  { factor: 'FORMATION_CHANGE_EXPECTED', cls: 'INFERENCE', re: /\b(change.*formation|switch to a? ?\d-\d|cambio de (esquema|formación)|pasar(á|a) a un \d-\d|changement de système|mudança de esquema)\b/i },
  { factor: 'COACH_ROTATION_CONFIRMED', cls: 'INFERENCE', re: /\b(rotat(e|ion)|rest(ing)? key players|rotación|rotará|dará descanso|turnover|fará rodízio|poupar(á)?|repos pour)\b/i },
  { factor: 'EXTREME_HEAT', cls: 'FACT', re: /\b(heat (warning|wave)|extreme heat|ola de calor|calor extremo|canicule|vague de chaleur|onda de calor)\b/i },
  { factor: 'HEAVY_RAIN', cls: 'FACT', re: /\b(heavy rain|downpour|lluvia (intensa|fuerte)|tormenta|fortes pluies|pluie battante|chuva forte)\b/i },
  { factor: 'STRONG_WIND', cls: 'FACT', re: /\b(strong wind|gale|viento (fuerte|intenso)|vent fort|vento forte)\b/i },
  { factor: 'TEAM_MUST_WIN', cls: 'INFERENCE', re: /\b(must(-| )win|need(s)? (a|the) win|obligad[oa] a ganar|debe ganar|doit gagner|obrigad[oa] a vencer|precisa vencer)\b/i },
  { factor: 'COACH_STATEMENT_CONFIDENCE', cls: 'INFERENCE', re: /\b(confident|optimistic|confiad[oa]|optimista|confiant|optimiste|confiante)\b/i },
];
// negaciones que invierten un FACT_OUT → no aplica (o lo degrada). Multilingüe.
const NEGATION_RE = /\b(not ruled out|no(t)? (injured|suspended|out)|will play|available|disponible|sí jugará|no es baja|descartad[oa] la baja|recuperad[oa]|sera disponible|apte|de retour|disponível|recuperad[oa] e apto|vai jogar)\b/i;
const RUMOR_RE = /\b(rumou?r|reportedly|allegedly|se rumorea|según fuentes|trascend(ió|e)|no confirmad[oa]|selon (les )?médias|rumeur|segundo a imprensa|n[ãa]o confirmad[oa]|boato)\b/i;

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
