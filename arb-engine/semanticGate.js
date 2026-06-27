// arb-engine/semanticGate.js — Fase R.1. GATE SEMÁNTICO de seguridad. Una oportunidad NO puede llamarse
// arbitraje solo porque dos precios parezcan cubrir resultados opuestos (§2). Antes de permitir que un
// candidato sea EXECUTABLE, este gate prueba sobre la IDENTIDAD NEUTRAL de cada leg (§5) que:
//   1. todas las legs son del MISMO evento canónico;
//   2. misma market_family + period + line (totals);
//   3. reglas de settlement IDÉNTICAS y NO AMBIGUAS (includes_extra_time/penalties/draw_possible, void,
//      postponement, settlement_source) — cualquier null/'?' o diferencia → bloquea;
//   4. moneda compatible;
//   5. los outcomes cubren EXHAUSTIVAMENTE y SIN solapamiento el espacio del mercado (partición completa).
// Ante CUALQUIER duda semántica → BLOCKED_SEMANTIC_MISMATCH (con sub-razón para diagnóstico). Nunca "asume".
// Es PURO (sin IO). El adapter legIdentity() mapea la leg cruda del motor a esta identidad.
'use strict';

const POLICY_VERSION = 'arbitrage-semantic-1';

// Universo de outcomes atómicos por familia. La unión de las legs debe igualar exactamente el universo.
const UNIVERSE = {
  MATCH_RESULT: ['HOME', 'DRAW', 'AWAY'],     // 1X2 regulation (3-way)
  MATCH_RESULT_2WAY: ['HOME', 'AWAY'],        // draw-no-bet / two-way (sin empate)
  QUALIFY: ['TEAM_A', 'TEAM_B'],              // clasificación knockout (mutuamente excluyente exhaustiva)
  TOTAL_GOALS: ['OVER', 'UNDER'],             // over/under de UNA línea
  BTTS: ['YES', 'NO'],
  BINARY: ['YES', 'NO'],                      // proposición binaria genérica (prediction market)
  TOURNAMENT_WINNER: ['YES', 'NO'],           // "T gana el torneo" YES/NO por equipo
};

// Familias de período que NUNCA deben mezclarse (regulation 90' vs clasifica con prórroga/penales).
const PERIODS = new Set(['REGULATION', 'INCLUDING_ET_PENALTIES', 'FIRST_HALF', 'SECOND_HALF', 'FULL_TIME']);

function val(v) { return (v === null || v === undefined || v === '?' || v === '') ? null : v; }

// legIdentity — adapter: construye la identidad neutral desde una leg del motor + metadata del mercado.
// Campos desconocidos quedan null → el gate los trata como AMBIGUOUS (bloquea, default seguro).
function legIdentity(leg = {}, marketMeta = {}) {
  const rules = leg.rules || marketMeta.rules || {};
  return {
    canonical_event_id: leg.canonical_event_id || marketMeta.canonical_event_id || null,
    market_family: val(leg.market_family || marketMeta.market_family),
    period: val(leg.period || marketMeta.period || rules.marketPeriod),
    line: leg.line != null ? Number(leg.line) : (marketMeta.line != null ? Number(marketMeta.line) : null),
    outcome_code: val(leg.outcome_code || leg.side && String(leg.side).toUpperCase()),
    proposition_id: val(leg.proposition_id || leg.canonical_outcome_id || marketMeta.proposition_id),
    side: val(leg.side && String(leg.side).toUpperCase()),
    includes_extra_time: typeof rules.includesExtraTime === 'boolean' ? rules.includesExtraTime : (typeof leg.includes_extra_time === 'boolean' ? leg.includes_extra_time : null),
    includes_penalties: typeof rules.includesPenalties === 'boolean' ? rules.includesPenalties : (typeof leg.includes_penalties === 'boolean' ? leg.includes_penalties : null),
    draw_possible: typeof rules.drawPossible === 'boolean' ? rules.drawPossible : (typeof leg.draw_possible === 'boolean' ? leg.draw_possible : null),
    void_policy: val(leg.void_policy || rules.voidPolicy),
    postponement_policy: val(leg.postponement_policy || rules.postponementPolicy),
    settlement_source: val(leg.settlement_source || rules.resolutionSource),
    currency: val(leg.currency) || 'USD',
    rules_fingerprint: val(leg.rulesFingerprint || leg.rules_fingerprint),
  };
}

// La cobertura atómica de una leg dentro del universo del mercado. Para binarios, la "proposición" debe ser la
// MISMA en todas las legs (YES y NO sobre el MISMO sujeto); si difieren los sujetos, no hay partición.
function coveredOutcome(idn, family) {
  const u = UNIVERSE[family];
  if (!u) return null;
  let code = idn.outcome_code;
  if (family === 'TOTAL_GOALS') { if (code === 'OVER' || code === 'UNDER') return code; return null; }
  if (u.length === 2 && (u[0] === 'YES' || u[0] === 'HOME' || u[0] === 'TEAM_A')) {
    // binarios/2-way: YES/NO o HOME/AWAY o TEAM_A/TEAM_B
    if (u.includes(code)) return code;
    if (code === 'NO') return 'NO'; if (code === 'YES') return 'YES';
    return null;
  }
  return u.includes(code) ? code : null;
}

// checkSemantics(legs, opts) → { ok, reason, sub_reason, blockers:[{code,evidence}], evidence }
// legs: identidades neutrales (ya pasadas por legIdentity). opts.policy: requisitos de la policy.
function checkSemantics(legs, opts = {}) {
  const policy = Object.assign({
    requireSameSettlementSource: true,    // settlement_source debe coincidir (objetivo: 1X2 FIFA oficial)
    allowedCurrencies: ['USD'],
    requireNonAmbiguousRules: true,       // includes_et/penalties/draw deben ser explícitos
  }, opts.policy || {});
  const blockers = [];
  // fatal=true → incompatibilidad PROBADA (datos presentes y discordantes / partición rota): el motor la usa
  // para degradar de ejecutable a rejected. fatal=false → AMBIGÜEDAD (datos faltantes): no prueba que sea
  // seguro, pero tampoco un mismatch; la capa de producto exige ok=true (sin ambigüedad) para mostrar ejecutable.
  const push = (code, evidence, fatal) => blockers.push({ code, evidence, fatal: !!fatal });
  const distinctNonNull = (vals) => new Set(vals.filter(v => v !== null && v !== undefined)).size;

  if (!Array.isArray(legs) || legs.length < 2) {
    return result([{ code: 'INSUFFICIENT_LEGS', evidence: { count: legs ? legs.length : 0 }, fatal: true }]);
  }
  const ids = legs.map((l, i) => Object.assign({ _i: i }, l));

  // 1. mismo evento canónico (fatal solo si hay ≥2 eventos NO nulos distintos)
  const evVals = ids.map(l => l.canonical_event_id);
  if (distinctNonNull(evVals) > 1 || ids.some(l => !l.canonical_event_id)) push('EVENT_MISMATCH', { events: [...new Set(evVals)] }, distinctNonNull(evVals) > 1);

  // 2. misma familia (fatal si ≥2 familias no nulas)
  const famVals = ids.map(l => l.market_family);
  if (distinctNonNull(famVals) > 1 || ids.some(l => !l.market_family)) push('FAMILY_MISMATCH', { families: [...new Set(famVals)] }, distinctNonNull(famVals) > 1);
  const family = ids[0].market_family;

  // 3. mismo período (nunca regulation con clasifica/ET) — fatal si ≥2 períodos no nulos distintos
  const perVals = ids.map(l => l.period);
  if (distinctNonNull(perVals) > 1 || ids.some(l => !l.period)) push('PERIOD_MISMATCH', { periods: [...new Set(perVals)] }, distinctNonNull(perVals) > 1);
  if (ids.some(l => l.period && !PERIODS.has(l.period))) push('PERIOD_UNKNOWN', { periods: [...new Set(perVals)] }, false);

  // 4. misma línea en totals (2.5 vs 2.25 → fatal)
  if (family === 'TOTAL_GOALS') {
    const lineVals = ids.map(l => l.line);
    if (distinctNonNull(lineVals) > 1) push('LINE_MISMATCH', { lines: [...new Set(lineVals)] }, true);
    else if (ids.some(l => l.line == null || Number.isNaN(l.line))) push('LINE_MISMATCH', { lines: [...new Set(lineVals)] }, false);
  }

  // 5. rule fingerprint: si ≥2 legs lo traen, TODAS deben coincidir (el motor tomaba legs[0] sin comparar —
  //    bug del audit R.0). Fingerprint distinto = exposición/settlement distinto → FATAL.
  const fpVals = ids.map(l => l.rules_fingerprint);
  if (distinctNonNull(fpVals) > 1) push('RULES_FINGERPRINT_MISMATCH', { fingerprints: fpVals }, true);

  // 5b. reglas de settlement: idénticas y no ambiguas. Diferencia explícita → FATAL; null → ambiguo (no fatal).
  for (const field of ['includes_extra_time', 'includes_penalties', 'draw_possible']) {
    const vals = ids.map(l => l[field]);
    if (distinctNonNull(vals) > 1) push('SETTLEMENT_RULES_MISMATCH', { field, values: vals }, true);
    else if (policy.requireNonAmbiguousRules && vals.some(v => v === null)) push('AMBIGUOUS_RULES', { field, values: vals }, false);
  }
  // void / postponement: discordancia explícita → FATAL
  for (const field of ['void_policy', 'postponement_policy']) {
    if (distinctNonNull(ids.map(l => l[field])) > 1) push(field === 'void_policy' ? 'VOID_POLICY_MISMATCH' : 'POSTPONEMENT_MISMATCH', { field, values: ids.map(l => l[field]) }, true);
  }
  // settlement_source: ≥2 fuentes no nulas distintas → FATAL; faltante → ambiguo
  if (policy.requireSameSettlementSource) {
    const srcVals = ids.map(l => l.settlement_source);
    if (distinctNonNull(srcVals) > 1) push('SETTLEMENT_SOURCE_INCOMPATIBLE', { sources: [...new Set(srcVals)] }, true);
    else if (ids.some(l => !l.settlement_source)) push('SETTLEMENT_SOURCE_INCOMPATIBLE', { sources: [...new Set(srcVals)] }, false);
  }

  // 6. moneda (discordancia o fuera de la allowlist → FATAL)
  if (distinctNonNull(ids.map(l => l.currency)) > 1 || ids.some(l => l.currency && !policy.allowedCurrencies.includes(l.currency))) {
    push('CURRENCY_MISMATCH', { currencies: ids.map(l => l.currency) }, true);
  }

  // 7. cobertura exhaustiva y sin solapamiento
  const universe = UNIVERSE[family];
  if (!universe) {
    push('UNSUPPORTED_FAMILY', { family }, !!family); // familia presente pero no soportada → fatal
  } else {
    const covered = ids.map(l => coveredOutcome(l, family));
    if (covered.some(c => c === null)) {
      // outcome presente pero fuera del universo → fatal; outcome ausente → ambiguo
      const present = ids.some(l => l.outcome_code);
      push('OUTCOME_NOT_IN_UNIVERSE', { family, outcomes: ids.map(l => l.outcome_code) }, present && covered.some((c, i) => c === null && ids[i].outcome_code));
    } else {
      // proposición (sujeto): a nivel MOTOR los candidatos ya están agrupados por canonical_market_id (mismo
      // mercado garantizado), así que esto es NO-FATAL (señal blanda, ok=false para la capa de producto). El
      // guard real de "mismo evento" es EVENT_MISMATCH + la cobertura exhaustiva de outcomes.
      if (universe.length === 2 && (family === 'BINARY' || family === 'TOURNAMENT_WINNER' || family === 'BTTS')) {
        const propVals = ids.map(l => l.proposition_id);
        if (distinctNonNull(propVals) > 1 || ids.some(l => !l.proposition_id)) push('PROPOSITION_MISMATCH', { propositions: [...new Set(propVals)] }, false);
      }
      const set = new Set(covered);
      if (set.size !== covered.length) push('OVERLAPPING_OUTCOMES', { covered }, true);
      else if (set.size !== universe.length || !universe.every(o => set.has(o))) push('NON_EXHAUSTIVE_OUTCOMES', { universe, covered }, true);
    }
  }

  return result(blockers);
}

function result(blockers) {
  const ok = blockers.length === 0;
  const fatal = blockers.some(b => b.fatal);
  // sub_reason prioriza el primer blocker FATAL (mismatch probado); si no hay, el primero (ambigüedad).
  const firstFatal = blockers.find(b => b.fatal);
  return {
    ok,
    fatal,                                             // ≥1 incompatibilidad PROBADA → el motor degrada a rejected
    policy_version: POLICY_VERSION,
    reason: ok ? null : 'BLOCKED_SEMANTIC_MISMATCH',   // umbral único §2; el detalle va en blockers
    sub_reason: ok ? null : (firstFatal ? firstFatal.code : blockers[0].code),
    blockers,
  };
}

module.exports = { checkSemantics, legIdentity, UNIVERSE, POLICY_VERSION };
