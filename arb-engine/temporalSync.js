// arb-engine/temporalSync.js — Fase R.2 §9. Contemporaneidad de las legs. Una combinación de precios que NUNCA
// coexistió no puede presentarse como activa. Computa y PERSISTE la evidencia temporal (oldest/newest/max_age/
// cross_leg_spread) y emite un verdicto versionado: cada leg fresh + spread entre legs dentro de un límite
// estricto + ninguna suspendida + evento no iniciado. Para legs DERIVADAS (Kalshi YES-ask = 1−NO-bid), el
// snapshot fuente es el del libro complementario → su antigüedad/spread se evalúan igual (anti-derived-stale).
// PURO (sin IO).
'use strict';

const POLICY_VERSION = 'arbitrage-temporal-1';
const ms = (t) => { if (!t) return null; const v = new Date(t).getTime(); return Number.isFinite(v) ? v : null; };

// evaluate(legs, opts) → evidencia + verdicto. legs: [{ snapshotReceivedAt, isLive, marketStatus, suspended,
//   eventStarted, eventStartAt, priceSource }]. opts: { now, params:{ maxSnapshotAgePrematchMs,
//   maxSnapshotAgeLiveMs, maxLegTimeSkewMs }, futureToleranceMs }
function evaluate(legs = [], opts = {}) {
  const now = opts.now || Date.now();
  const p = opts.params || {};
  const maxSpread = p.maxLegTimeSkewMs != null ? p.maxLegTimeSkewMs : 3000;
  const maxAgePrematch = p.maxSnapshotAgePrematchMs != null ? p.maxSnapshotAgePrematchMs : 120000;
  const maxAgeLive = p.maxSnapshotAgeLiveMs != null ? p.maxSnapshotAgeLiveMs : 15000;
  const futureTol = opts.futureToleranceMs != null ? opts.futureToleranceMs : 60000;
  const reasons = [];

  const stamps = legs.map(l => ms(l.snapshotReceivedAt));
  if (!legs.length || stamps.some(t => t === null)) {
    return verdict(false, ['MISSING_TIMESTAMP'], { leg_count: legs.length });
  }
  const oldest = Math.min(...stamps);
  const newest = Math.max(...stamps);
  const crossSpread = newest - oldest;
  const maxLegAge = now - oldest;

  // futuro (reloj desincronizado / dato inválido)
  if (stamps.some(t => t > now + futureTol)) reasons.push('FUTURE_SNAPSHOT');
  // cada leg fresh según su naturaleza (live vs prematch)
  let anyStale = false, anyDerivedStale = false;
  legs.forEach((l, i) => {
    const age = now - stamps[i];
    const maxAge = l.isLive ? maxAgeLive : maxAgePrematch;
    if (age > maxAge) { anyStale = true; if (l.priceSource === 'derived_from_complement_bid') anyDerivedStale = true; }
  });
  if (anyStale) reasons.push('LEG_STALE');
  if (anyDerivedStale) reasons.push('DERIVED_LEG_STALE');         // §8: YES-ask derivado de un NO-bid viejo
  // spread entre legs (nunca coexistieron si excede el límite)
  if (crossSpread > maxSpread) reasons.push('CROSS_LEG_SPREAD_EXCEEDED');
  // suspensión / mercado no abierto
  if (legs.some(l => l.suspended || (l.marketStatus && l.marketStatus !== 'open'))) reasons.push('LEG_SUSPENDED');
  // evento ya iniciado → no es arbitraje prematch
  if (legs.some(l => l.eventStarted || (l.eventStartAt && ms(l.eventStartAt) != null && ms(l.eventStartAt) <= now))) reasons.push('EVENT_STARTED');

  return verdict(reasons.length === 0, reasons, {
    oldest_leg_at: new Date(oldest).toISOString(),
    newest_leg_at: new Date(newest).toISOString(),
    cross_leg_time_spread_ms: crossSpread,
    max_leg_age_ms: maxLegAge,
    leg_count: legs.length,
  });
}

function verdict(ok, reasons, evidence) {
  return { ok, policy_version: POLICY_VERSION, reasons, evidence };
}

module.exports = { evaluate, POLICY_VERSION };
