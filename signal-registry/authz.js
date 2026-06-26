// signal-registry/authz.js — Fase G.1 §11. Autorización de acciones administrativas por scope/rol.
// CAPA PURA: sin DB. No asume que cualquier usuario autenticado es admin. Distingue 401 (no auth) de 403
// (auth sin permiso). El servidor construye el `actor` desde el usuario; los tests lo construyen directo.
'use strict';

// ---------- scopes (§11) ----------
const SCOPES = ['registry:read', 'registry:pause', 'signal:quarantine', 'signal:retract',
  'signal:correct', 'signal:void', 'signal:data_error', 'signal:restore', 'audit:read'];

// scope requerido por acción por señal
const ACTION_SCOPE = {
  quarantine: 'signal:quarantine',
  restore: 'signal:restore',
  retract: 'signal:retract',
  correct: 'signal:correct',
  data_error: 'signal:data_error',
  administrative_void: 'signal:void',
};

// roles → scopes. viewer: solo lectura; operator: todas las acciones por señal + pausa; superadmin: + acciones materiales.
const ROLE_SCOPES = {
  viewer: ['registry:read', 'audit:read'],
  operator: ['registry:read', 'audit:read', 'registry:pause', 'signal:quarantine', 'signal:restore',
    'signal:retract', 'signal:correct', 'signal:data_error', 'signal:void'],
  superadmin: SCOPES.slice(),
};

// buildActor({ authenticated, isAdmin, isSuperAdmin, role, scopes }) → actor normalizado con Set de scopes.
// - authenticated false → no autenticado (→401).
// - isAdmin false → usuario normal (→403).
// - role/isSuperAdmin derivan el set de scopes salvo que se pasen scopes explícitos (tests).
function buildActor({ authenticated = false, isAdmin = false, isSuperAdmin = false, role = null, scopes = null, email = null } = {}) {
  let set;
  if (Array.isArray(scopes)) set = new Set(scopes);
  else if (role && ROLE_SCOPES[role]) set = new Set(ROLE_SCOPES[role]);
  else if (isAdmin) set = new Set(isSuperAdmin ? ROLE_SCOPES.superadmin : ROLE_SCOPES.operator);
  else set = new Set();
  return { authenticated: !!authenticated, isAdmin: !!isAdmin, isSuperAdmin: !!isSuperAdmin, email: email || null, scopes: set };
}

function hasScope(actor, scope) { return !!actor && actor.scopes instanceof Set && actor.scopes.has(scope); }

// authorize(actor, scope) → { ok, status, error }. 401 sin auth, 403 sin admin, 403 sin scope.
function authorize(actor, scope) {
  if (!actor || !actor.authenticated) return { ok: false, status: 401, error: 'unauthenticated' };
  if (!actor.isAdmin) return { ok: false, status: 403, error: 'forbidden_not_admin' };
  if (scope && !hasScope(actor, scope)) return { ok: false, status: 403, error: 'forbidden_missing_scope' };
  return { ok: true, status: 200 };
}

// authorizeAction(actor, action, { material, postEvent }) → para las 6 acciones por señal.
// Las acciones materiales (corrección de campos materiales) y el void post-evento exigen superadmin.
function authorizeAction(actor, action, { material = false, postEvent = false } = {}) {
  const scope = ACTION_SCOPE[action];
  if (!scope) return { ok: false, status: 400, error: 'unknown_action' };
  const base = authorize(actor, scope);
  if (!base.ok) return base;
  const needsSuper = (action === 'correct' && material) || (action === 'administrative_void' && postEvent);
  if (needsSuper && !actor.isSuperAdmin) return { ok: false, status: 403, error: 'forbidden_superadmin_required' };
  return { ok: true, status: 200 };
}

module.exports = { SCOPES, ACTION_SCOPE, ROLE_SCOPES, buildActor, hasScope, authorize, authorizeAction };
