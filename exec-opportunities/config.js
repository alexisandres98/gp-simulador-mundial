// exec-opportunities/config.js — Sprint 4. Flags y umbrales de la capa de producto (oportunidades ejecutables).
// REGLA CRÍTICA: la capa de UI NO puede eludir ARB_ENGINE_ALLOW_AUTO_PUBLICATION=false.
//   No existe ningún camino que publique automáticamente por clasificación. Toda publicación es por
//   aprobación humana (manual). Los defaults de publicación son MÁS estrictos que los de detección del motor.
'use strict';

const platform = require('../database/config');
const arbCfg = require('../arb-engine/config');

const LAYER_VERSION = 'exec-ui-1';
const RISK_DISCLOSURE_VERSION = 'risk-1';
const PAYLOAD_VERSION = 'payload-1';

const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const bool = (v, d = false) => (v === undefined || v === '') ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const decStr = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? String(v).trim() : d; };

function resolveFlags() {
  const uiEnabled = bool(process.env.EXEC_OPPORTUNITIES_UI_ENABLED, false);
  const adminPreviewReq = bool(process.env.EXEC_OPPORTUNITIES_ADMIN_PREVIEW_ENABLED, false);
  const publicReq = bool(process.env.EXEC_OPPORTUNITIES_PUBLIC_ENABLED, false);
  const manualPubReq = bool(process.env.EXEC_OPPORTUNITIES_MANUAL_PUBLICATION_ENABLED, false);
  const calcReq = bool(process.env.EXEC_OPPORTUNITIES_CALCULATOR_ENABLED, false);
  const deepLinksReq = bool(process.env.EXEC_OPPORTUNITIES_DEEP_LINKS_ENABLED, false);
  const geoReq = bool(process.env.EXEC_OPPORTUNITIES_GEO_FILTER_ENABLED, false);

  return {
    // Capa apagada por completo: la app sigue idéntica, no aparecen rutas nuevas.
    uiEnabled,
    // Admin preview requiere la UI encendida.
    adminPreviewEnabled: uiEnabled && adminPreviewReq,
    // Público requiere la UI encendida (y aun así solo muestra publicaciones aprobadas y vigentes).
    publicEnabled: uiEnabled && publicReq,
    // Publicación manual: un admin puede aprobar/retirar. NUNCA automático.
    manualPublicationEnabled: manualPubReq,
    // Calculadora server-side.
    calculatorEnabled: calcReq,
    // Deep links a las plataformas externas.
    deepLinksEnabled: deepLinksReq,
    // Filtro/selector de jurisdicción.
    geoFilterEnabled: geoReq,
    // INVARIANTE: la auto-publicación está bloqueada SIEMPRE (heredado del motor de arbitraje, Sprint 3).
    // Aunque alguien ponga ARB_ENGINE_ALLOW_AUTO_PUBLICATION=true, esta capa lo ignora.
    autoPublicationBlocked: true,
    autoPublicationRequestedButBlocked: !!arbCfg.flags.autoPublicationRequestedButBlocked,
  };
}

// Umbrales de PUBLICACIÓN. Conservadores y, por diseño, MÁS estrictos que los del motor.
// El motor detecta con minNetRoi=0.005 y minExecutableCapital=25; la publicación exige más.
const publication = {
  // Edad máxima de la evaluación referenciada para considerarla publicable.
  maxEvaluationAgeMs: int(process.env.EXEC_PUBLIC_MAX_EVALUATION_AGE_MS, 120000),      // 2 min
  // Edad máxima desde la última revalidación para mostrarla como activa en la vista pública.
  maxRevalidationAgeMs: int(process.env.EXEC_PUBLIC_MAX_REVALIDATION_AGE_MS, 30000),   // 30 s
  // ROI neto mínimo para publicar (más alto que el del motor: 0.005).
  minNetRoi: decStr(process.env.EXEC_PUBLIC_MIN_NET_ROI, '0.01'),                      // 1%
  // Capital ejecutable mínimo para publicar (más alto que el del motor: 25).
  minExecutableCapital: decStr(process.env.EXEC_PUBLIC_MIN_EXECUTABLE_CAPITAL, '50'),  // $50
  // ¿Se permite publicar execution_sensitive? Por defecto NO. Si se permite, va etiquetada y con warning.
  allowExecutionSensitive: bool(process.env.EXEC_PUBLIC_ALLOW_EXECUTION_SENSITIVE, false),
  // TTL de caché de la API pública. DEBE ser menor que la ventana de validez (maxRevalidationAgeMs).
  cacheTtlMs: int(process.env.EXEC_PUBLIC_CACHE_TTL_MS, 5000),                         // 5 s
};

// La calculadora nunca permite reducir el buffer de ejecución por debajo del mínimo seguro.
const calculator = {
  minExecutionBufferBps: int(process.env.EXEC_PUBLIC_MIN_EXECUTION_BUFFER_BPS, arbCfg.params.executionBufferBps),
  maxCapital: decStr(process.env.EXEC_PUBLIC_CALC_MAX_CAPITAL, '1000000'),             // tope de seguridad del input
  referenceSizes: arbCfg.params.referenceSizes,                                       // curva de tamaño
  rateLimitPerMin: int(process.env.EXEC_PUBLIC_CALC_RATE_LIMIT, 30),
};

// Estados del ciclo de vida de una publicación (sección 7 del spec).
const PUBLICATION_STATUS = ['draft', 'approved', 'published', 'paused', 'expired', 'withdrawn', 'rejected'];
// Visibilidad de una publicación.
const VISIBILITY = ['internal', 'beta', 'public'];

// Clasificaciones que PUEDEN publicarse (las demás nunca: conditional/price_discrepancy/rejected/...).
const PUBLISHABLE_CLASSIFICATIONS = ['pure_arb', 'execution_sensitive'];

module.exports = {
  platform,
  arbParams: arbCfg.params,
  flags: resolveFlags(),
  publication,
  calculator,
  PUBLICATION_STATUS,
  VISIBILITY,
  PUBLISHABLE_CLASSIFICATIONS,
  LAYER_VERSION,
  RISK_DISCLOSURE_VERSION,
  PAYLOAD_VERSION,
  // recomputar flags (para tests que cambian env en runtime)
  resolveFlags,
};
