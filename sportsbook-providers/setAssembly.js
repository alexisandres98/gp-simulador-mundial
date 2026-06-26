// sportsbook-providers/setAssembly.js — Post-shadow Bloque H. Arma sets 1X2 SINCRONIZADOS por casa desde
// current state, exigiendo: mismo book/evento/mercado/periodo, los 3 outcomes presentes, provider_update
// coherente dentro de una ventana de skew, no suspended, no live, no stale. Cada exclusión lleva motivo.
// El consenso SOLO puede usar estos sets sincronizados.
'use strict';

function slotOf(row) {
  if (row.outcome_slot) return row.outcome_slot;
  if (row.metadata && row.metadata.outcome_slot) return row.metadata.outcome_slot;
  const parts = String(row.external_outcome_id || '').split(':');
  return parts[parts.length - 1];
}

// assembleSets(rows, opts) — rows = current state de UN evento (todas las casas/outcomes).
function assembleSets(rows, { now = null, maxSkewMs = 60000, maxAgeMs = 600000 } = {}) {
  const nowMs = now != null ? +new Date(now) : Date.now();
  const byBook = new Map();
  for (const r of rows) {
    const k = r.sportsbook_code;
    if (!byBook.has(k)) byBook.set(k, []);
    byBook.get(k).push(r);
  }
  const sets = [], rejected = [];
  for (const [book, brows] of byBook) {
    const slots = {}; let bad = null;
    for (const r of brows) {
      const slot = slotOf(r);
      if (!['home', 'draw', 'away'].includes(slot)) { bad = 'unknown_slot'; break; }
      if (r.is_live === true) { bad = 'live'; break; }
      if (r.quote_status === 'suspended') { bad = 'suspended'; break; }
      if (slots[slot]) { bad = 'duplicate_outcome'; break; }   // home/away invertido aparece como duplicado o lo capta el outlier
      slots[slot] = r;
    }
    if (bad) { rejected.push({ sportsbook: book, reason: bad }); continue; }
    if (!slots.home || !slots.draw || !slots.away) { rejected.push({ sportsbook: book, reason: !slots.draw ? 'missing_draw' : 'incomplete_1x2' }); continue; }
    const ups = ['home', 'draw', 'away'].map(s => +new Date(slots[s].provider_update)).filter(Number.isFinite);
    const skew = ups.length ? Math.max(...ups) - Math.min(...ups) : 0;
    if (skew > maxSkewMs) { rejected.push({ sportsbook: book, reason: 'excessive_skew', skew }); continue; }
    const maxUp = ups.length ? Math.max(...ups) : nowMs;
    if ((nowMs - maxUp) > maxAgeMs) { rejected.push({ sportsbook: book, reason: 'stale' }); continue; }
    const obs = ['home', 'draw', 'away'].map(s => +new Date(slots[s].observed_at)).filter(Number.isFinite);
    sets.push({
      sportsbook: book, independence_group: slots.home.independence_group || book, period: slots.home.period,
      quotes: { home: { odds: Number(slots.home.odds_decimal) }, draw: { odds: Number(slots.draw.odds_decimal) }, away: { odds: Number(slots.away.odds_decimal) } },
      provider_update: new Date(maxUp).toISOString(), observed_at: obs.length ? new Date(Math.max(...obs)).toISOString() : null, skew_ms: skew, fresh: true,
    });
  }
  return { sets, rejected };
}

module.exports = { assembleSets, slotOf };
