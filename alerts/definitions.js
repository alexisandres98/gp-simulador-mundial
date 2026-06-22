// alerts/definitions.js — Sprint 8A §29. Tipos de alerta permitidos + severidad. PURO. El frontend NO crea
// alerts: solo el server genera estos tipos. PASS/WATCH/LEAN NUNCA se envían como Pick (§29).
'use strict';

const TYPES = {
  new_pick_gp:           { severity: 'important', requiresPublished: true },
  pick_price_moved:      { severity: 'important', requiresPublished: true },
  pick_closed:           { severity: 'info', requiresPublished: true },
  pick_settled:          { severity: 'info', requiresPublished: true },
  new_strong_signal:     { severity: 'info', requiresPublished: true },
  new_executable_arb:    { severity: 'important', requiresPublished: true },
  arb_expiring:          { severity: 'info', requiresPublished: true },
  followed_match_update: { severity: 'info', requiresPublished: false },
};

function isValidType(t) { return Object.prototype.hasOwnProperty.call(TYPES, t); }
function severityOf(t) { return (TYPES[t] && TYPES[t].severity) || 'info'; }

module.exports = { TYPES, isValidType, severityOf };
