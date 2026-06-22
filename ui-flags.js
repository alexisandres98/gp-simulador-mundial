// ui-flags.js — Sprint 8.1 §37. Flags de integración de UI. Modelo: cada área está activa para un usuario
// si su flag está ON y además (público ON o el usuario es admin con preview ON). Con TODO apagado, la UI
// queda byte-idéntica (los flags resuelven a false y app.js los ignora). No toca lógica de modelo/datos.
'use strict';

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

// áreas de UI controladas por flags (§37)
const AREAS = {
  opportunityTabs: 'UI_OPPORTUNITY_TABS_ENABLED',     // Oportunidades → Picks GP | Value | Arbitraje
  verifiedPerformance: 'UI_VERIFIED_PERFORMANCE_ENABLED', // Rendimiento: legacy vs verificable + copy alpha
  gpIntelligenceLabels: 'UI_GP_INTELLIGENCE_LABELS_ENABLED', // etiqueta V2/Experimental + acordeones
  operationalStates: 'UI_OPERATIONAL_STATES_ENABLED', // estados operativos reutilizables
  navigationCleanup: 'UI_NAVIGATION_CLEANUP_ENABLED', // Más/avatar/Transparencia
  alertDefaultsV2: 'UI_ALERT_DEFAULTS_V2_ENABLED',    // defaults conservadores (solo usuarios nuevos)
};

function flags() {
  return {
    // master público: expone la nueva UI a TODOS los usuarios logueados
    publicEnabled: bool(process.env.UI_INTEGRATION_V2_ENABLED, false),
    // preview: expone la nueva UI SOLO a admins (sin afectar al público)
    adminPreview: bool(process.env.UI_ADMIN_PREVIEW_ENABLED, false),
    areas: Object.fromEntries(Object.entries(AREAS).map(([k, env]) => [k, bool(process.env[env], false)])),
  };
}

// resolveForUser(isAdmin) → { opportunityTabs:bool, verifiedPerformance:bool, ... }. Con todo off → todo false.
function resolveForUser(isAdmin = false) {
  const f = flags();
  const visible = f.publicEnabled || (isAdmin && f.adminPreview);
  const out = {};
  for (const area of Object.keys(AREAS)) out[area] = !!(f.areas[area] && visible);
  // bandera informativa: ¿este usuario está viendo la nueva UI en modo preview de admin?
  out.adminPreview = !!(isAdmin && f.adminPreview && !f.publicEnabled);
  return out;
}

module.exports = { flags, resolveForUser, AREAS };
