// freshness/degradation.js — Sprint 8A §22. Política de DEGRADACIÓN SEGURA. PURA. Dado el estado de las
// fuentes, decide qué se permite. Reglas duras: no usar stale como fresh; no convertir LEAN en STRONG; no
// crear Picks GP con datos degradados; no borrar señales previas; el simulador SIEMPRE sigue disponible.
'use strict';

// decide(sources) → { simulator, valueEngine, picksGp, arb, warnings }
//   sources: { sportsbooks, predictionMarkets, signalRegistry, closing } cada uno 'fresh'|'aging'|'stale'|'unknown'|'down'
function decide(sources = {}) {
  const s = (k) => sources[k] || 'unknown';
  const usable = (v) => v === 'fresh' || v === 'aging';
  const warnings = [];

  // el simulador es independiente: nunca se cae por fuentes externas
  const simulator = 'available';

  // Value Engine: requiere consenso fresco de sportsbooks. Sin ellos → bloqueado (no produce señales falsas).
  let valueEngine = 'ok';
  if (!usable(s('sportsbooks')) || s('sportsbooks') === 'down') { valueEngine = 'blocked'; warnings.push('value_blocked_no_fresh_sportsbook_consensus'); }
  else if (s('sportsbooks') === 'aging') warnings.push('sportsbook_quotes_aging');

  // prediction markets degradados → aumenta incertidumbre; puede seguir si la política lo permite
  if (!usable(s('predictionMarkets'))) warnings.push('prediction_markets_degraded_uncertainty_up');

  // Picks GP: NO se crean si el Value Engine está bloqueado o el registro no está disponible
  let picksGp = 'ok';
  if (valueEngine === 'blocked' || s('signalRegistry') === 'down') { picksGp = 'no_new_picks'; warnings.push('no_new_picks_gp'); }

  // arbitraje: independiente del Value Engine; degrada con prediction markets pero no crea picks
  const arb = usable(s('predictionMarkets')) ? 'ok' : 'degraded';

  // closing caído → settlement puede avanzar; CLV queda unavailable (no look-ahead)
  if (s('closing') === 'down' || s('closing') === 'stale') warnings.push('closing_unavailable_clv_pending');

  return { simulator, valueEngine, picksGp, arb, warnings };
}

// invariante explícito: degradar NUNCA sube el grado de una señal (LEAN no pasa a STRONG por falta de datos).
function neverUpgradeOnDegradation(classification, degraded) {
  if (!degraded) return classification;
  return classification === 'strong' ? 'lean' : classification; // si dudamos, bajamos, nunca subimos
}

module.exports = { decide, neverUpgradeOnDegradation };
