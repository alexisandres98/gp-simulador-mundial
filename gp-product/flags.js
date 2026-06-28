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
    // Fase Q.1 §21 — gates de la superficie flagship "Oportunidades" DENTRO de la plataforma principal
    // (public/app.js), no de /beta. Cada subtab consume los DTOs V2 (/api/beta/*) solo si su flag está ON
    // Y el usuario tiene acceso beta (admin/allowlist). Default false → la plataforma de ~509 usuarios queda
    // byte-idéntica; admin/QA ven el producto unificado antes de la apertura. No sustituyen autorización.
    betaAccess: bool(process.env.GP_BETA_ACCESS_ENABLED, false),               // acceso beta como NIVEL dentro de la plataforma
    oppPicks: bool(process.env.GP_OPPORTUNITIES_PICKS_ENABLED, false),         // subtab Picks GP (flagship)
    oppValue: bool(process.env.GP_OPPORTUNITIES_VALUE_ENABLED, false),         // subtab Value (flagship)
    oppArbitrage: bool(process.env.GP_OPPORTUNITIES_ARBITRAGE_ENABLED, false), // subtab Arbitraje (flagship)
    // Fase Q.1.1 §2/§4 — Partidos muestra la probabilidad GP Intelligence V2 oficial por partido real
    // (contexto point-in-time, freshness, incertidumbre, sin fallback silencioso a V1). Solo presentación+DTO;
    // NO cambia el modelo oficial del backend. Default false → Partidos queda idéntica para los ~509 usuarios.
    matchesV2Ui: bool(process.env.GP_MATCHES_V2_UI_ENABLED, false),
    // Capa visual premium (terminal de inteligencia) aislada en /x. Default false → la ruta no existe en prod.
    premiumUi: bool(process.env.GP_PREMIUM_UI_ENABLED, false),
    // Fixtures QA del cockpit premium (escenarios live/finalizado sintéticos). SOLO preview interno; default
    // false → premium-qa.js no se sirve ni se inyecta en prod (los usuarios nunca lo ven). NO toca la DB real.
    premiumQa: bool(process.env.GP_PREMIUM_QA_ENABLED, false),
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
    matchesV2: !!(beta && f.matchesV2Ui),        // Fase Q.1.1 §2: Partidos con prob V2 oficial (beta + flag)
    premium: !!(beta && f.premiumUi),            // capa visual premium /x (beta autorizado + flag)
    // Fase Q.1 §21 — superficie flagship "Oportunidades" en la plataforma principal. Cada subtab se cablea a
    // los DTOs V2 SOLO con acceso beta + su flag §21. Picks es el subtab por defecto. Arbitraje requiere
    // además el flag de UI de arbitraje ya existente. Con todo off → app.js queda byte-idéntica.
    opportunities: {
      enabled: !!(beta && (f.oppPicks || f.oppValue || f.oppArbitrage)), // ¿mostrar la superficie flagship?
      picks: !!(beta && f.oppPicks),
      value: !!(beta && f.oppValue),
      arbitrage: !!(beta && f.oppArbitrage && f.arbitrageUi),
    },
    // espejo informativo de los flags public_* (para que el cliente sepa si algo ya es público)
    publicPicks: f.publicPicks, publicValue: f.publicValue, publicHistory: f.publicHistory,
  };
}

module.exports = { flags, allowlist, betaAccess, resolveForUser };
