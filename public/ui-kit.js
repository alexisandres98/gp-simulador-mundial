// public/ui-kit.js — Sprint 8.1 §21,§32. Diccionario central de términos + componentes de estado operativo.
// PURO Y DECLARATIVO: solo define globals (window.COPY, window.UIState). Sin DOM, sin efectos, sin auto-run.
// app.js los usa SOLO cuando los flags UI_* están activos → con flags off, la UI queda idéntica.
(function () {
  'use strict';

  // ---------- diccionario de términos estables (§32) ----------
  var COPY = {
    terms: {
      pickGP: 'Pick GP',
      valueSignal: 'Señal de Value',
      arbitrage: 'Arbitraje',
      trackVerified: 'Track record verificable',
      trackLegacy: 'Histórico legacy',
      gpiV2: 'GP Intelligence V2',
      modelV1: 'Modelo oficial V1',
      observedOdds: 'Cuota observada',
      minOdds: 'Cuota mínima',
      maxPrice: 'Precio máximo',
      adjustedEdge: 'Edge ajustado',
      theoreticalReturn: 'Retorno teórico',
      experimental: 'Experimental',
      prematch: 'PREPARTIDO',
      live: 'EN VIVO',
      liveInformational: 'ANÁLISIS INFORMATIVO',
    },
    // clasificación Value (texto + clase de color; NUNCA solo color, §31)
    valueClass: {
      pass: { label: 'PASS', cls: 'vc-pass', help: 'No hay suficiente value.' },
      watch: { label: 'WATCH', cls: 'vc-watch', help: 'Existe una diferencia, pero aún no alcanza el estándar.' },
      lean: { label: 'LEAN', cls: 'vc-lean', help: 'Señal moderada; no es una Pick GP.' },
      strong: { label: 'STRONG', cls: 'vc-strong', help: 'Supera los filtros del Value Engine y puede convertirse en candidata.' },
    },
    // performance / alpha (§6) — sustituye el copy prohibido "prueba objetiva de alpha real"
    perf: {
      title: 'Rendimiento del modelo',
      verifiedTab: 'Verificable',
      legacyTab: 'Histórico',
      legacyNotice: 'Estos resultados corresponden al sistema anterior. Se conservan por transparencia, pero no tienen las mismas garantías de timestamp, inputs congelados y verificación criptográfica del registro actual.',
      verifiedEmpty: 'Todavía no existen suficientes señales oficiales liquidadas desde el inicio del registro verificable.',
      alphaReplacement: 'Esta comparación evalúa si el modelo aporta información adicional frente al mercado. La evidencia requiere una muestra suficiente y resultados fuera de muestra.',
      noEdgeYet: 'Todavía no existe evidencia suficiente de ventaja predictiva frente al mercado.',
      marketBeatsModel: 'En esta muestra, el mercado supera al modelo.',
      accuracyCaveat: 'La tasa de acierto no mide por sí sola la calidad de una predicción probabilística.',
      lowerIsBetter: 'más bajo es mejor',
    },
    // empty states de oportunidades/picks
    picksEmpty: 'Hoy no hay Picks GP.',
    picksEmptyWhy: 'Ninguna señal supera actualmente todos los criterios de edge, precio, calidad de datos, incertidumbre y revisión.',
  };

  // ---------- componentes de estado operativo reutilizables (§21) ----------
  // cada uno devuelve HTML string. NO usan el mismo vacío para todo (§21). Texto + icono, no solo color.
  function box(icon, title, body, kind) {
    return '<div class="op-state op-' + (kind || 'info') + '" role="status">' +
      '<div class="op-state-ic" aria-hidden="true">' + icon + '</div>' +
      '<div class="op-state-tx"><div class="op-state-t">' + title + '</div>' +
      (body ? '<div class="op-state-b">' + body + '</div>' : '') + '</div></div>';
  }
  var UIState = {
    featureDisabled: function (msg) { return box('🚧', 'Esta función todavía no está disponible.', msg || '', 'disabled'); },
    notConfigured: function (msg) { return box('⚙️', 'Configuración pendiente', msg || 'Las cuotas de sportsbooks todavía no están configuradas.', 'disabled'); },
    noData: function (msg) { return box('—', 'Sin datos', msg || 'No hay datos disponibles en este momento.', 'info'); },
    emptyResult: function (msg) { return box('○', 'Sin resultados', msg || 'No hay señales que superen los criterios actuales.', 'info'); },
    staleData: function (msg) { return box('⏱', 'Datos retrasados', msg || 'Los datos de mercado están temporalmente retrasados. Las nuevas señales están pausadas.', 'warn'); },
    partialData: function (msg) { return box('◐', 'Datos parciales', msg || 'Algunas fuentes no están disponibles; los resultados pueden estar incompletos.', 'warn'); },
    error: function (msg) { return box('!', 'No se pudo cargar', msg || 'Ocurrió un problema al cargar esta sección. Intenta de nuevo.', 'error'); },
    maintenance: function (msg) { return box('🔧', 'En mantenimiento', msg || 'Esta sección está temporalmente en mantenimiento.', 'warn'); },
    permissionDenied: function (msg) { return box('🔒', 'Acceso restringido', msg || 'No tienes permiso para ver esta sección.', 'error'); },
    insufficientConsensus: function () { return box('◌', 'Consenso insuficiente', 'No existen suficientes fuentes independientes para calcular un consenso.', 'warn'); },
  };

  var root = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined') ? globalThis : this;
  root.COPY = COPY;
  root.UIState = UIState;
  if (typeof module !== 'undefined' && module.exports) module.exports = { COPY: COPY, UIState: UIState };
})();
