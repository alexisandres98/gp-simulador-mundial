// gp-product/flags.js — Fase Q. Flags + autorización de la EXPERIENCIA DE PRODUCTO beta (GP Intelligence V2).
// Modelo de visibilidad: la experiencia beta (Home/GP Intelligence/Picks/Value/Historial bajo /beta) es una
// superficie SEPARADA de la web pública en vivo. Con todos los flags apagados (default) NO existe ninguna ruta
// nueva visible: /beta y /api/beta/* responden 404, y la web de los ~509 usuarios queda byte-idéntica.
//
// REGLA DURA (§14): el flag NO sustituye autenticación/autorización. La beta exige SIEMPRE sesión válida +
// (admin O allowlist de QA). Un usuario sin sesión nunca accede, aunque GP_BETA_UI_ENABLED esté en true.
'use strict';

const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());

// Flags del §14 (todos default false → nada nuevo se expone).
function flags() {
  return {
    betaUi: bool(process.env.GP_BETA_UI_ENABLED, false),            // habilita la superficie beta /beta
    publicPicks: bool(process.env.GP_PUBLIC_PICKS_ENABLED, false),  // Picks visibles para TODO usuario logueado
    publicValue: bool(process.env.GP_PUBLIC_VALUE_ENABLED, false),  // Value público
    publicHistory: bool(process.env.GP_PUBLIC_HISTORY_ENABLED, false), // Historial público
    goalInsights: bool(process.env.GP_GOAL_INSIGHTS_UI_ENABLED, false), // sección Goal Insights (informativa)
    arbitrageUi: bool(process.env.GP_ARBITRAGE_UI_ENABLED, false),  // Arbitraje (off → "próximamente"/oculto)
  };
}

// Allowlist de QA: emails separados por coma en GP_BETA_ALLOWLIST. Case-insensitive. Vacío por defecto.
function allowlist() {
  return String(process.env.GP_BETA_ALLOWLIST || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// betaAccess — ¿este usuario puede ver la experiencia beta? Requiere flag ON + sesión + (admin o allowlist).
// El gate de autorización vive aquí y se reusa en el route guard del servidor (no confiar en el cliente).
function betaAccess({ email = null, isAdmin = false } = {}) {
  const f = flags();
  if (!f.betaUi) return false;        // beta apagada globalmente
  if (!email) return false;           // sin sesión → nunca (el flag NO es auth)
  if (isAdmin) return true;           // superadmin
  return allowlist().includes(String(email).toLowerCase()); // cuenta de QA autorizada
}

// resolveForUser — objeto de gating que getUser() expone al cliente. Con todo off → { beta:false, ... } y el
// cliente no monta nada. Las superficies internas (picks/value/history) las ve un beta autorizado aunque su
// flag "public" esté off; los flags public_* son para abrirlas a TODOS en una fase posterior (hoy off).
function resolveForUser({ email = null, isAdmin = false } = {}) {
  const f = flags();
  const beta = betaAccess({ email, isAdmin });
  return {
    beta,                                        // ¿ve la experiencia beta?
    picks: beta || f.publicPicks,                // superficie Picks visible para este usuario
    value: beta || f.publicValue,                // superficie Value visible
    history: beta || f.publicHistory,            // superficie Historial visible
    goalInsights: !!(beta && f.goalInsights),    // Goal Insights: solo dentro de beta y con su flag on
    arbitrage: !!(beta && f.arbitrageUi),        // Arbitraje: solo beta autorizado + flag (nunca público aquí)
    // espejo informativo de los flags public_* (para que el cliente sepa si algo ya es público)
    publicPicks: f.publicPicks, publicValue: f.publicValue, publicHistory: f.publicHistory,
  };
}

module.exports = { flags, allowlist, betaAccess, resolveForUser };
