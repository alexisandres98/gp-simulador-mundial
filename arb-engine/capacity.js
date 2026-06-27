// arb-engine/capacity.js — Fase R.2 §7/§11. Honestidad de capacidad. Una cuota visible NO acepta cualquier
// tamaño. Clasifica la capacidad ejecutable de cada leg y de la oportunidad SIN inventar capacidad:
//   CONFIRMED   → hay profundidad de order-book (size por nivel) o max_stake conocido;
//   UNKNOWN     → no hay profundidad y max_stake='unknown' (p.ej. sportsbook single-price) → no se asume;
//   CONSERVATIVE→ mezcla (alguna leg sin confirmar → la oportunidad se limita a lo confirmado).
// La capacidad de la oportunidad la limita la leg más débil. Si alguna leg es UNKNOWN → la oportunidad NO es
// "ejecutable garantizada" (R.3 la clasifica THEORETICAL_ONLY / PARTIAL_EXECUTION_RISK). PURO (sin IO).
'use strict';

function legCapacity(leg = {}) {
  const depth = (leg.asks || []).reduce((a, l) => a + (parseFloat(l.size) > 0 ? parseFloat(l.size) : 0), 0);
  const maxStakeStatus = leg.maxStakeStatus || leg.stake_limit_status || (leg.maxStake != null ? 'known' : null);
  const maxStake = leg.maxStake != null ? Number(leg.maxStake) : null;
  if (depth > 0) return { status: 'CONFIRMED', confirmed_size: depth, source: 'order_book_depth' };
  if (maxStake != null && maxStake > 0) return { status: 'CONFIRMED', confirmed_size: maxStake, source: 'max_stake' };
  if (maxStakeStatus === 'unknown' || maxStakeStatus == null) return { status: 'UNKNOWN', confirmed_size: 0, source: 'no_depth_no_limit' };
  return { status: 'UNKNOWN', confirmed_size: 0, source: 'unspecified' };
}

// assess(legs) → { capacity_status, confirmed_executable_size, limiting_leg_index, per_leg:[...], notes:[] }
function assess(legs = []) {
  const per = legs.map((l, i) => Object.assign({ leg_index: i, provider: l.provider, side: l.side }, legCapacity(l)));
  const notes = [];
  const anyUnknown = per.some(p => p.status === 'UNKNOWN');
  const allConfirmed = per.every(p => p.status === 'CONFIRMED');
  // tamaño limitado por la leg más débil CONFIRMADA; si hay UNKNOWN, el confirmado de esa leg es 0.
  let limitingIdx = 0, minSize = Infinity;
  per.forEach((p, i) => { if (p.confirmed_size < minSize) { minSize = p.confirmed_size; limitingIdx = i; } });
  if (!Number.isFinite(minSize)) minSize = 0;

  let capacity_status;
  if (allConfirmed) capacity_status = 'CONFIRMED';
  else if (anyUnknown && per.every(p => p.status === 'UNKNOWN')) { capacity_status = 'UNKNOWN'; notes.push('NO_LEG_CAPACITY_CONFIRMED'); }
  else { capacity_status = 'CONSERVATIVE'; notes.push('SOME_LEG_CAPACITY_UNKNOWN'); }
  if (anyUnknown) notes.push('UNKNOWN_CAPACITY_NOT_INVENTED');

  return {
    capacity_status,
    confirmed_executable_size: minSize,
    limiting_leg_index: limitingIdx,
    per_leg: per,
    notes,
  };
}

module.exports = { assess, legCapacity };
