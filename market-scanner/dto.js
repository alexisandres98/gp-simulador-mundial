// market-scanner/dto.js — transforma el resultado del scan (scanner.scan) en el payload de /api/beta/arbitrage.
// NEUTRAL y localizable en cliente: devuelve ids/códigos/números, no prosa. El cliente (premium.js) pone etiquetas.
// Dos familias etiquetadas: PURE_ARB ("Arbitraje puro") y PRICE_LAG ("Precio atrasado"). Value (GP vs mercado) NO vive aquí.

'use strict';

// resolveTeamId(name) → team_id | null. Inyectado deso server (aliasToId+normName). Sin él, team_id = null (usa nombre).
function buildDto(scan, { resolveTeamId = () => null, now = Date.now(), maxItems = 60 } = {}) {
  if (!scan || scan.disabled) return { available: false, reason: 'disabled' };
  if (scan.unavailable) return { available: false, reason: scan.unavailable };

  const tid = (name) => { try { return resolveTeamId(name) || null; } catch { return null; } };
  const ev = (o) => ({
    event_id: o.event_id,
    home: o.home || null, away: o.away || null,
    home_team_id: tid(o.home), away_team_id: tid(o.away),
    kickoff: o.kickoff || null,
    market_family: o.market_family, period: o.period, line: o.line ?? null,
  });
  const freshness = (t) => (Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null); // segundos

  // ---- Arbitraje puro ----
  const arbitrage = (scan.arbitrage || []).slice(0, maxItems).map(a => ({
    ...ev(a),
    family: 'PURE_ARB',
    state_code: a.executable ? 'EXECUTABLE' : (a.stale ? 'STALE' : 'THEORETICAL_ONLY'),
    executable: !!a.executable,
    gross_roi: a.gross_roi, net_roi: a.net_roi,
    sum_inverse: a.sum_inverse,
    leg_time_skew_ms: a.leg_time_skew_ms,
    freshness_s: freshness(Math.max(...a.legs.map(l => l.observed_at).filter(Number.isFinite))),
    legs: a.legs.map(l => ({
      outcome: l.outcome, venue: l.venue, venue_label: l.venue_label,
      odds: l.odds, eff_odds: l.eff_odds, stake_pct: l.stake_pct,
      is_exchange: !!l.is_exchange, source_role: l.source_role || null,
      max_stake: l.max_stake ?? null,
    })),
  }));

  // ---- Precio atrasado (soft primero; sharps/exchanges como referencia informativa) ----
  const lagAll = scan.price_lag || [];
  const price_lag = lagAll.filter(l => l.is_soft).slice(0, maxItems).map(l => ({
    ...ev(l),
    family: 'PRICE_LAG',
    outcome: l.outcome,
    venue: l.venue, venue_label: l.venue_label,
    odds: l.odds, fair_odds: l.fair_odds, fair_prob: l.fair_prob,
    edge: l.edge, implied_prob: l.implied_prob,
    is_soft: true, source_role: l.source_role || null,
    consensus_groups: l.consensus_groups, dispersion: l.dispersion,
    freshness_s: freshness(l.observed_at), age_ms: l.age_ms,
    max_stake: l.max_stake ?? null,
  }));

  return {
    available: true,
    scanner_version: scan.scanner_version || null,
    scanned_at: scan.scanned_at || now,
    counts: {
      markets_scanned: scan.markets_scanned || 0,
      markets_with_consensus: scan.markets_with_consensus || 0,
      arb_total: scan.counts ? scan.counts.arb_total : 0,
      arb_executable: scan.counts ? scan.counts.arb_executable : 0,
      lag_total: scan.counts ? scan.counts.lag_total : 0,
      lag_soft: scan.counts ? scan.counts.lag_soft : 0,
      lag_reference: lagAll.filter(l => !l.is_soft).length,
    },
    arbitrage,
    price_lag,
  };
}

module.exports = { buildDto };
