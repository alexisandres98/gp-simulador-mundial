// tests/registry-admin-statemachine.test.js — Fase G.1. Capa PURA (sin DB): máquina de estados (§4),
// reason codes (§5-9), doble confirmación (§10), autorización por scope (§11), contrato downstream (§13).
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const sm = require(R + '/signal-registry/stateMachine');
const authz = require(R + '/signal-registry/authz');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const SID = '11111111-1111-1111-1111-111111111111';
// helper: solicitud bien-formada base (válida) que luego mutamos por test
const goodReq = (over = {}) => ({
  action: 'quarantine', fromState: 'ACTIVE', reasonCode: 'DATA_UNDER_REVIEW', reasonText: 'revisión de datos',
  confirmedSignalId: SID, signalId: SID, confirmationPhrase: `CONFIRM ${SID}`, ...over,
});

console.log('\n§4 MÁQUINA DE ESTADOS');
ok('1. ACTIVE → quarantine', sm.transition('ACTIVE', 'quarantine').ok && sm.transition('ACTIVE', 'quarantine').target === 'QUARANTINED');
ok('2. QUARANTINED → active (restore)', sm.transition('QUARANTINED', 'restore').ok && sm.transition('QUARANTINED', 'restore').target === 'ACTIVE');
ok('3. ACTIVE → retract', sm.transition('ACTIVE', 'retract').target === 'RETRACTED');
ok('4. ACTIVE → correct', sm.transition('ACTIVE', 'correct').target === 'CORRECTED');
ok('5. ACTIVE → data_error', sm.transition('ACTIVE', 'data_error').target === 'DATA_ERROR');
ok('6. ACTIVE → administrative_void', sm.transition('ACTIVE', 'administrative_void').target === 'ADMINISTRATIVE_VOID');
ok('7. transición inválida rechazada (RETRACTED → quarantine)', !sm.transition('RETRACTED', 'quarantine').ok);
ok('7b. restore solo desde QUARANTINED (ACTIVE → restore rechazado)', !sm.transition('ACTIVE', 'restore').ok);
ok('8. terminal no reactiva en silencio (RETRACTED sin salidas)', sm.TRANSITIONS.RETRACTED.length === 0 && sm.TRANSITIONS.CORRECTED.length === 0 && sm.TRANSITIONS.ADMINISTRATIVE_VOID.length === 0);
ok('8b. QUARANTINED → void / retract / correct / data_error permitidos', ['administrative_void', 'retract', 'correct', 'data_error'].every(a => sm.transition('QUARANTINED', a).ok));

console.log('\n§9 REASON CODES (void objetivo vs prohibido)');
ok('void PICK_LOST rechazado', !sm.validateReason('administrative_void', 'PICK_LOST').ok);
ok('void BAD_PERFORMANCE rechazado', !sm.validateReason('administrative_void', 'BAD_PERFORMANCE').ok);
ok('void MODEL_CHANGED_MIND rechazado', !sm.validateReason('administrative_void', 'MODEL_CHANGED_MIND').ok);
ok('void EVENT_MAPPING_ERROR aceptado', sm.validateReason('administrative_void', 'EVENT_MAPPING_ERROR').ok);
ok('quarantine reason fuera de catálogo rechazado', !sm.validateReason('quarantine', 'PICK_LOST').ok);
ok('retract reason válido aceptado', sm.validateReason('retract', 'LINEUP_CHANGE').ok);

console.log('\n§7 CORRECCIONES (material vs sensible)');
ok('corrección material (event) → material=true', sm.classifyCorrection({ event: { old: 'A', new: 'B' } }).material === true);
ok('corrección no-material (odds) → material=false pero sensible', sm.classifyCorrection({ odds: { old: 1, new: 2 } }).material === false && sm.classifyCorrection({ odds: {} }).sensitiveTouched.includes('odds'));
ok('material exige superadmin', sm.requiresSuperAdmin('correct', { material: true }) === true);

console.log('\n§10 DOBLE CONFIRMACIÓN + VALIDACIÓN INTEGRAL');
ok('crítica sin frase reforzada → error', sm.validate(goodReq({ action: 'retract', reasonCode: 'LINEUP_CHANGE', confirmationPhrase: 'CONFIRM wrong' })).errors.includes('reinforced_confirmation_required'));
ok('signal id tipeado mal → error', sm.validate(goodReq({ confirmedSignalId: 'otro' })).errors.includes('signal_id_mismatch'));
ok('explicación vacía → error', sm.validate(goodReq({ reasonText: '   ' })).errors.includes('explanation_required'));
ok('quarantine bien formada → ok', sm.validate(goodReq()).ok);
ok('retract reforzada bien formada → ok', sm.validate(goodReq({ action: 'retract', reasonCode: 'OPERATIONAL_ERROR' })).ok);
ok('restore sin quarantine_ref → error', sm.validate(goodReq({ action: 'restore', fromState: 'QUARANTINED', reasonCode: null })).errors.includes('quarantine_ref_required'));
ok('correct sin campos → error', sm.validate(goodReq({ action: 'correct', correctedFields: {} })).errors.includes('corrected_fields_required'));
ok('correct material sin superadmin → error', sm.validate(goodReq({ action: 'correct', correctedFields: { event: { old: 'A', new: 'B' } }, isSuperAdmin: false })).errors.includes('superadmin_required'));
ok('void post-evento sin superadmin → error', sm.validate(goodReq({ action: 'administrative_void', reasonCode: 'EVENT_CANCELLED_OR_INVALID', postEvent: true, isSuperAdmin: false })).errors.includes('superadmin_required'));
ok('void post-evento con superadmin → ok', sm.validate(goodReq({ action: 'administrative_void', reasonCode: 'EVENT_CANCELLED_OR_INVALID', postEvent: true, isSuperAdmin: true })).ok);
ok('void con razón prohibida → error (aunque todo lo demás esté bien)', sm.validate(goodReq({ action: 'administrative_void', reasonCode: 'PICK_LOST' })).errors.includes('void_reason_forbidden'));

console.log('\n§11 AUTORIZACIÓN POR SCOPE');
const anon = authz.buildActor({ authenticated: false });
const normal = authz.buildActor({ authenticated: true, isAdmin: false });
const viewer = authz.buildActor({ authenticated: true, isAdmin: true, role: 'viewer' });
const operator = authz.buildActor({ authenticated: true, isAdmin: true, role: 'operator' });
const superA = authz.buildActor({ authenticated: true, isAdmin: true, isSuperAdmin: true });
ok('1. no autenticado → 401', authz.authorizeAction(anon, 'quarantine').status === 401);
ok('2. usuario normal → 403', authz.authorizeAction(normal, 'quarantine').status === 403);
ok('3. admin sin scope (viewer) → 403', authz.authorizeAction(viewer, 'quarantine').status === 403);
ok('4. admin operador autorizado → ok', authz.authorizeAction(operator, 'quarantine').ok);
ok('5. void post-evento exige superadmin (operator → 403)', authz.authorizeAction(operator, 'administrative_void', { postEvent: true }).status === 403);
ok('5b. void post-evento con superadmin → ok', authz.authorizeAction(superA, 'administrative_void', { postEvent: true }).ok);
ok('6. corrección material exige superadmin (operator → 403)', authz.authorizeAction(operator, 'correct', { material: true }).status === 403);
ok('7. read scope: viewer puede leer audit', authz.authorize(viewer, 'audit:read').ok && !authz.authorize(normal, 'audit:read').ok);

console.log('\n§13 CONTRATO DOWNSTREAM');
ok('QUARANTINED no público / no alerts', sm.downstreamPolicy('QUARANTINED').public === false && sm.downstreamPolicy('QUARANTINED').alerts === false);
ok('RETRACTED visible pero sin alerts', sm.downstreamPolicy('RETRACTED').public === true && sm.downstreamPolicy('RETRACTED').alerts === false);
ok('CORRECTED usa versión corregida', sm.downstreamPolicy('CORRECTED').metrics === 'uses_corrected_version');
ok('ADMINISTRATIVE_VOID settlement administrativo', sm.downstreamPolicy('ADMINISTRATIVE_VOID').settlement === 'administrative');

console.log(`\n=== RESULTADO ===\nPASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);
