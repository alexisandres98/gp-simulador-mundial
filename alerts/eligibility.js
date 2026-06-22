// alerts/eligibility.js — Sprint 8A §29,§35. Reglas de elegibilidad de alertas. PURO. Reglas duras:
//  - una Pick GP solo alerta si está PUBLICADA (no auto-publication, no draft).
//  - PASS/WATCH/LEAN NUNCA se envían como pick.
//  - respeta las preferencias del usuario (tipos suscritos, filtros).
'use strict';
const { isValidType, TYPES } = require('./definitions');

// canAlert(event, prefs) → { ok, reason }
//   event: { type, published, classification, edge, ev, entityType, entityId }
//   prefs: { types:[...], signal_filters:{ only_strong, only_picks, min_edge, min_ev, arb } }
function canAlert(event, prefs = {}) {
  if (!isValidType(event.type)) return { ok: false, reason: 'unknown_type' };
  // pick/strong/arb requieren estar publicados (§35)
  if (TYPES[event.type].requiresPublished && event.published === false) return { ok: false, reason: 'not_published' };
  // LEAN/WATCH/PASS nunca como pick
  if (event.type === 'new_pick_gp' && event.classification && event.classification !== 'strong') return { ok: false, reason: 'pick_requires_strong' };

  const f = prefs.signal_filters || {};
  const types = prefs.types || prefs.alert_types || null;
  if (Array.isArray(types) && types.length && !types.includes(event.type)) return { ok: false, reason: 'type_not_subscribed' };
  if (f.only_picks && event.type !== 'new_pick_gp') return { ok: false, reason: 'only_picks' };
  if (f.only_strong && event.classification && event.classification !== 'strong') return { ok: false, reason: 'only_strong' };
  if (f.min_edge != null && event.edge != null && event.edge < f.min_edge) return { ok: false, reason: 'below_min_edge' };
  if (f.min_ev != null && event.ev != null && event.ev < f.min_ev) return { ok: false, reason: 'below_min_ev' };
  if (f.arb === false && (event.type === 'new_executable_arb' || event.type === 'arb_expiring')) return { ok: false, reason: 'arb_muted' };

  return { ok: true };
}

module.exports = { canAlert };
