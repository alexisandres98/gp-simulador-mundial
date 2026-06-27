// goal-engine/settlement.js — Anexo M-G (G.4). Semántica + settlement de los mercados de goles.
// PURO. Todos los mercados de PRIMERA CAPA se liquidan por el marcador de TIEMPO REGLAMENTARIO (90'+añadido),
// SIN prórroga. Define metadata canónica (scope/period/line/side/push) y la función de liquidación. Líneas .5
// no tienen push; líneas enteras (capa futura) sí. NO se activa ningún mercado público (solo semántica/settle).
'use strict';

// metadata de cada market_id de primera capa.
function marketMeta(marketId) {
  const id = String(marketId || '');
  let m = id.match(/^TOTAL_GOALS_(OVER|UNDER)_(\d+)_(\d+)$/);
  if (m) return { market_id: id, scope: 'match_total', side: m[1].toLowerCase(), line: Number(`${m[2]}.${m[3]}`), period: 'REGULATION', push: false };
  if (id === 'BTTS_YES' || id === 'BTTS_NO') return { market_id: id, scope: 'btts', side: id === 'BTTS_YES' ? 'yes' : 'no', period: 'REGULATION', push: false };
  m = id.match(/^(HOME|AWAY)_TEAM_TOTAL_(OVER|UNDER)_(\d+)_(\d+)$/);
  if (m) return { market_id: id, scope: 'team_total', team: m[1].toLowerCase(), side: m[2].toLowerCase(), line: Number(`${m[3]}.${m[4]}`), period: 'REGULATION', push: false };
  return null;
}

// settle(marketId, { homeGoals, awayGoals }) → 'won'|'lost'|'push'|'void'|'unknown'. Solo marcador reglamentario.
function settle(marketId, score = {}) {
  const meta = marketMeta(marketId);
  if (!meta) return 'unknown';
  const h = score.homeGoals, a = score.awayGoals;
  if (typeof h !== 'number' || typeof a !== 'number') return 'void';
  const total = h + a;
  if (meta.scope === 'match_total') {
    if (Number.isInteger(meta.line) && total === meta.line) return 'push';
    const over = total > meta.line;
    return (meta.side === 'over') === over ? 'won' : 'lost';
  }
  if (meta.scope === 'btts') {
    const yes = h >= 1 && a >= 1;
    return (meta.side === 'yes') === yes ? 'won' : 'lost';
  }
  if (meta.scope === 'team_total') {
    const g = meta.team === 'home' ? h : a;
    if (Number.isInteger(meta.line) && g === meta.line) return 'push';
    const over = g > meta.line;
    return (meta.side === 'over') === over ? 'won' : 'lost';
  }
  return 'unknown';
}

module.exports = { marketMeta, settle };
