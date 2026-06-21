// arb-engine/snapshotSelector.js — selecciona el snapshot más reciente VÁLIDO de una pata (Sprint 3).
// No basta con la última fila: verifica market_status, edad, frescura, book disponible y versiones.
'use strict';
const { checkSnapshotAge } = require('./eligibility');

// selectLatestValid(snapshots, { now, params }) → { snapshot, reason? }
// snapshots: lista ordenable por received_at desc; cada uno con { marketStatus, receivedAt, freshness,
//   asks, normalizerVersion, mappingVersion, rulesFingerprint, isLive }.
function selectLatestValid(snapshots, { now = Date.now(), params = {} } = {}) {
  const sorted = (snapshots || []).slice().sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
  for (const s of sorted) {
    if (s.marketStatus && s.marketStatus !== 'open') continue;
    if (!s.asks || !s.asks.length) continue;
    if (!s.normalizerVersion || !s.rulesFingerprint) continue;
    const age = checkSnapshotAge({ snapshotReceivedAt: s.receivedAt, isLive: s.isLive }, now, params);
    if (!age.ok) continue;
    if (s.freshness === 'stale' || s.freshness === 'unknown') continue;
    return { snapshot: s, reason: null };
  }
  return { snapshot: null, reason: sorted.length ? 'no_valid_snapshot' : 'no_snapshots' };
}

module.exports = { selectLatestValid };
