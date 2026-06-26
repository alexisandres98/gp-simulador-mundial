// signal-registry/stateMachine.js — Fase G.1. Máquina de estados administrativa POR SEÑAL (§4) + reason codes
// por acción (§5-9) + doble confirmación (§10) + clasificación de correcciones (§7) + contrato downstream (§13).
// CAPA PURA: sin DB, sin I/O. Validación explícita — NUNCA strings libres sin chequear. NO altera la señal original.
'use strict';

// ---------- estados (§4) ----------
const STATES = ['ACTIVE', 'QUARANTINED', 'RETRACTED', 'CORRECTED', 'ADMINISTRATIVE_VOID', 'DATA_ERROR'];
const INITIAL_STATE = 'ACTIVE';

// Transiciones INICIALES permitidas (§4). Estados terminales no vuelven silenciosamente a ACTIVE:
// cualquier restauración excepcional futura exige una acción explícita nueva y auditada.
const TRANSITIONS = {
  ACTIVE: ['QUARANTINED', 'RETRACTED', 'CORRECTED', 'DATA_ERROR', 'ADMINISTRATIVE_VOID'],
  QUARANTINED: ['ACTIVE', 'RETRACTED', 'CORRECTED', 'DATA_ERROR', 'ADMINISTRATIVE_VOID'],
  RETRACTED: [],            // terminal
  CORRECTED: [],            // terminal
  ADMINISTRATIVE_VOID: [],  // terminal
  DATA_ERROR: [],           // terminal en el set inicial (resolución posterior = acción explícita nueva)
};
const TERMINAL_STATES = STATES.filter(s => s !== 'ACTIVE' && TRANSITIONS[s].length === 0);

// ---------- acciones → estado destino ----------
const ACTIONS = {
  quarantine:          { target: 'QUARANTINED',          visibility: 'hidden',  critical: false },
  restore:             { target: 'ACTIVE',               visibility: 'visible', critical: false, fromOnly: ['QUARANTINED'] },
  retract:             { target: 'RETRACTED',            visibility: 'visible', critical: true },
  correct:             { target: 'CORRECTED',            visibility: 'visible', critical: true },
  data_error:          { target: 'DATA_ERROR',           visibility: 'hidden',  critical: false },
  administrative_void: { target: 'ADMINISTRATIVE_VOID',  visibility: 'visible', critical: true },
};
const ACTION_NAMES = Object.keys(ACTIONS);
const CRITICAL_ACTIONS = ACTION_NAMES.filter(a => ACTIONS[a].critical);

// ---------- reason codes por acción (§5-9) ----------
const REASON_CODES = {
  quarantine: ['DATA_UNDER_REVIEW', 'MAPPING_UNDER_REVIEW', 'PROVIDER_ANOMALY', 'PRICE_ANOMALY', 'DUPLICATE_SUSPECTED', 'SECURITY_REVIEW', 'OTHER'],
  retract: ['PRE_KICKOFF_INFORMATION_CHANGE', 'LINEUP_CHANGE', 'EVENT_RULE_CHANGE', 'MARKET_NO_LONGER_EQUIVALENT', 'MAPPING_ERROR', 'DATA_PROVIDER_ERROR', 'OPERATIONAL_ERROR', 'OTHER'],
  data_error: ['INVERTED_OUTCOME', 'EVENT_MAPPING_INCORRECT', 'MARKET_MISMATCH', 'PROVIDER_QUOTE_CORRUPT', 'TIMESTAMP_INCORRECT', 'WRONG_SPORTSBOOK', 'TECHNICAL_DUPLICATE', 'INGESTION_FAILURE', 'OTHER'],
  // restore y correct no usan un catálogo cerrado de reason_code (el motivo va en reason_text); restore además exige quarantine_ref.
  restore: null,
  correct: null,
};
// administrative_void (§9): catálogo objetivo cerrado + lista explícitamente PROHIBIDA (nunca convertir pérdida en void).
const VOID_ALLOWED = ['EVENT_MAPPING_ERROR', 'OUTCOME_MAPPING_ERROR', 'WRONG_MARKET', 'WRONG_PERIOD', 'DUPLICATE_SIGNAL', 'PROVIDER_DATA_CORRUPTION', 'TECHNICAL_PUBLICATION_ERROR', 'EVENT_CANCELLED_OR_INVALID'];
const VOID_FORBIDDEN = ['PICK_LOST', 'BAD_PERFORMANCE', 'ADMIN_DISCRETION', 'MODEL_CHANGED_MIND', 'PRICE_MOVED_AFTER_PUBLICATION'];

// ---------- correcciones (§7) ----------
// Campos sensibles que NO se editan en la fila original (se registran como corrección con vista efectiva).
const SENSITIVE_FIELDS = ['event', 'selection', 'market', 'period', 'odds', 'minimum_odds', 'sportsbook', 'published_at'];
// Campos MATERIALES → corrección material: superadmin + confirmación reforzada + quarantine automática a considerar.
const MATERIAL_FIELDS = ['event', 'selection', 'market', 'period', 'published_at'];

// ---------- helpers de validación ----------
function isState(s) { return STATES.includes(s); }
function isAction(a) { return ACTION_NAMES.includes(a); }

// transition(fromState, action) → { ok, target, error }
function transition(fromState, action) {
  if (!isAction(action)) return { ok: false, error: 'unknown_action' };
  const from = fromState || INITIAL_STATE;
  if (!isState(from)) return { ok: false, error: 'unknown_from_state' };
  const def = ACTIONS[action];
  if (def.fromOnly && !def.fromOnly.includes(from)) return { ok: false, error: 'invalid_transition' };
  if (!(TRANSITIONS[from] || []).includes(def.target)) return { ok: false, error: 'invalid_transition' };
  return { ok: true, target: def.target, visibility: def.visibility };
}

// validateReason(action, reasonCode) → { ok, error }
function validateReason(action, reasonCode) {
  if (action === 'administrative_void') {
    if (VOID_FORBIDDEN.includes(reasonCode)) return { ok: false, error: 'void_reason_forbidden' };
    if (!VOID_ALLOWED.includes(reasonCode)) return { ok: false, error: 'void_reason_invalid' };
    return { ok: true };
  }
  const allowed = REASON_CODES[action];
  if (allowed === null || allowed === undefined) return { ok: true }; // restore/correct: motivo libre obligatorio (reason_text)
  if (!allowed.includes(reasonCode)) return { ok: false, error: 'reason_code_invalid' };
  return { ok: true };
}

// classifyCorrection(correctedFields) → { material, sensitiveTouched, fields }
// correctedFields: objeto { campo: { old, new } } (o lista de nombres de campo).
function classifyCorrection(correctedFields) {
  const names = Array.isArray(correctedFields) ? correctedFields : Object.keys(correctedFields || {});
  const material = names.some(f => MATERIAL_FIELDS.includes(f));
  const sensitiveTouched = names.filter(f => SENSITIVE_FIELDS.includes(f));
  return { material, sensitiveTouched, fields: names };
}

// confirmationRequired(action, { material, postEvent }) → { reinforced, phrase|null }
// Toda acción crítica (retract/correct/void) y toda corrección material o void post-evento exige escribir
// exactamente "CONFIRM <SIGNAL_ID>". El resto exige tipear el signal ID manualmente.
function confirmationRequired(action, { material = false, postEvent = false } = {}) {
  const reinforced = !!ACTIONS[action]?.critical || material || postEvent;
  return { reinforced };
}
function expectedPhrase(signalId) { return `CONFIRM ${signalId}`; }

// requiresSuperAdmin(action, { material, postEvent }) — corrección material o void post-evento exigen superadmin (§7,§9).
function requiresSuperAdmin(action, { material = false, postEvent = false } = {}) {
  if (action === 'correct' && material) return true;
  if (action === 'administrative_void' && postEvent) return true;
  return false;
}

// ---------- contrato downstream (§13) — SOLO definición; no activa ningún scheduler ----------
const DOWNSTREAM_POLICY = {
  ACTIVE:              { public: true,  alerts: true,  promotion: true,  closing: 'normal',          settlement: 'normal',        metrics: 'included' },
  QUARANTINED:         { public: false, alerts: false, promotion: false, closing: 'per_policy',       settlement: 'per_policy',     metrics: 'excluded_provisional' },
  RETRACTED:           { public: true,  alerts: false, promotion: false, closing: 'factual_if_due',   settlement: 'factual_if_due', metrics: 'marked_retracted' },
  CORRECTED:           { public: true,  alerts: false, promotion: false, closing: 'normal',           settlement: 'normal',         metrics: 'uses_corrected_version' },
  ADMINISTRATIVE_VOID: { public: true,  alerts: false, promotion: false, closing: 'admin_void',       settlement: 'administrative', metrics: 'excluded_per_policy' },
  DATA_ERROR:          { public: false, alerts: false, promotion: false, closing: 'hold',             settlement: 'hold',           metrics: 'marked_needs_resolution' },
};
function downstreamPolicy(status) { return DOWNSTREAM_POLICY[status] || null; }

// ---------- validación integral de una solicitud de acción (la usa el servicio) ----------
// req: { action, fromState, reasonCode, reasonText, confirmedSignalId, signalId, confirmationPhrase,
//        correctedFields, postEvent, quarantineRef, isSuperAdmin }
// Devuelve { ok, errors[], target, visibility, material, reinforced, needsSuperAdmin }.
function validate(req = {}) {
  const errors = [];
  const { action, fromState, reasonCode, reasonText, confirmedSignalId, signalId,
    confirmationPhrase, correctedFields, postEvent = false, quarantineRef, isSuperAdmin = false } = req;

  if (!isAction(action)) return { ok: false, errors: ['unknown_action'] };

  // 1) transición de estado válida
  const t = transition(fromState, action);
  if (!t.ok) errors.push(t.error);

  // 2) reason code válido por acción
  const rc = validateReason(action, reasonCode);
  if (!rc.ok) errors.push(rc.error);

  // 3) explicación obligatoria SIEMPRE
  if (!reasonText || !String(reasonText).trim()) errors.push('explanation_required');

  // 4) signal ID tipeado manualmente debe coincidir con el de la ruta
  if (!confirmedSignalId || String(confirmedSignalId) !== String(signalId)) errors.push('signal_id_mismatch');

  // 5) restore exige referencia a la quarantine
  if (action === 'restore' && !quarantineRef) errors.push('quarantine_ref_required');

  // 6) correcciones: clasificar material/sensible
  const corr = action === 'correct' ? classifyCorrection(correctedFields) : { material: false, sensitiveTouched: [], fields: [] };
  if (action === 'correct' && corr.fields.length === 0) errors.push('corrected_fields_required');

  // 7) confirmación reforzada (acciones críticas, corrección material, void post-evento)
  const { reinforced } = confirmationRequired(action, { material: corr.material, postEvent });
  if (reinforced) {
    if (!confirmationPhrase || String(confirmationPhrase) !== expectedPhrase(signalId)) errors.push('reinforced_confirmation_required');
  }

  // 8) superadmin para corrección material o void post-evento
  const needsSuperAdmin = requiresSuperAdmin(action, { material: corr.material, postEvent });
  if (needsSuperAdmin && !isSuperAdmin) errors.push('superadmin_required');

  return {
    ok: errors.length === 0,
    errors,
    target: t.target || null,
    visibility: t.visibility || null,
    material: corr.material,
    sensitiveTouched: corr.sensitiveTouched,
    reinforced,
    needsSuperAdmin,
    postEvent: !!postEvent,
  };
}

module.exports = {
  STATES, INITIAL_STATE, TRANSITIONS, TERMINAL_STATES, ACTIONS, ACTION_NAMES, CRITICAL_ACTIONS,
  REASON_CODES, VOID_ALLOWED, VOID_FORBIDDEN, SENSITIVE_FIELDS, MATERIAL_FIELDS, DOWNSTREAM_POLICY,
  isState, isAction, transition, validateReason, classifyCorrection, confirmationRequired,
  expectedPhrase, requiresSuperAdmin, downstreamPolicy, validate,
};
