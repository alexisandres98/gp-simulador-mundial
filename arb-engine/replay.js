// arb-engine/replay.js — reproduce el motor con snapshots históricos SIN look-ahead (Sprint 3).
// Para cada momento t solo se usan snapshots disponibles hasta t (received_at <= t). No mira el futuro,
// no usa closing price futuro. Mide oportunidades, duración y desaparición. NO afirma ROI realizado.
'use strict';
const engine = require('./index');

// replaySequence(moments, opts) → métricas. moments: [{ t, candidate }] ya construidos con datos ≤ t.
// (La garantía de no-look-ahead la da la construcción: cada candidate solo contiene snapshots con
//  received_at <= t. replayFromHistory lo asegura al filtrar por tiempo.)
function replaySequence(moments, opts = {}) {
  const byKey = {}; let detected = 0;
  const classifications = {};
  for (const m of (moments || [])) {
    const ev = engine.evaluateCandidate(m.candidate, { now: Date.parse(m.t), params: opts.params });
    classifications[ev.classification] = (classifications[ev.classification] || 0) + 1;
    if (ev.classification === 'pure_arb' || ev.classification === 'execution_sensitive') {
      detected++;
      const k = ev.opportunityKey;
      byKey[k] = byKey[k] || { firstT: m.t, lastT: m.t, count: 0, maxNetRoi: '0' };
      byKey[k].lastT = m.t; byKey[k].count++;
      if (Number(ev.evaluation.netRoi) > Number(byKey[k].maxNetRoi)) byKey[k].maxNetRoi = ev.evaluation.netRoi;
    }
  }
  const lifetimes = Object.values(byKey).map(o => Date.parse(o.lastT) - Date.parse(o.firstT));
  const medLifetime = lifetimes.length ? lifetimes.sort((a, b) => a - b)[Math.floor(lifetimes.length / 2)] : 0;
  return {
    moments: (moments || []).length, opportunitiesDetected: detected, uniqueOpportunities: Object.keys(byKey).length,
    classifications, medianLifetimeMs: medLifetime,
    maxNetRoi: Object.values(byKey).reduce((mx, o) => Math.max(mx, Number(o.maxNetRoi)), 0),
    note: 'replay sin ejecución real: no afirma ROI realizado',
  };
}

// replayFromHistory(snapshotsByLeg, times, buildCandidate, opts) — asegura no-look-ahead filtrando por t.
function replayFromHistory(snapshotsByLeg, times, buildCandidate, opts = {}) {
  const moments = [];
  for (const t of times) {
    const tMs = Date.parse(t);
    // para cada pata, el snapshot más reciente con received_at <= t (NO futuro)
    const legSnaps = snapshotsByLeg.map(arr => arr.filter(s => Date.parse(s.receivedAt) <= tMs).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))[0]).filter(Boolean);
    if (legSnaps.length === snapshotsByLeg.length) moments.push({ t, candidate: buildCandidate(legSnaps) });
  }
  return replaySequence(moments, opts);
}

module.exports = { replaySequence, replayFromHistory };
