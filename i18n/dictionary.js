// i18n/dictionary.js — Fase K.2. FUENTE ÚNICA de internacionalización ES/EN para superficies orientadas al
// cliente. El backend la usa para presentación; el frontend la consume vía GET /api/i18n. Los DATOS canónicos
// (outcome_code HOME/DRAW/AWAY, market_code, team IDs) NO se traducen: el idioma se resuelve aquí, en presentación.
'use strict';
const I18N_VERSION = 'i18n-1';
const LOCALES = ['es', 'en'];
const DEFAULT_LOCALE = 'es';

// claves → {es, en}. Interpolación con {arg}. Pluralización simple: clave.one / clave.other si hace falta.
const DICT = {
  es: {
    'selection.team_to_win': '{team} gana',
    'selection.draw': 'Empate',
    'market.match_result': 'Resultado del partido',
    'period.regulation': 'Tiempo reglamentario',
    'period.regulation_note': '90 minutos; no incluye prórroga ni penales.',
    'classification.strong': 'Oportunidad fuerte',
    'classification.lean': 'Inclinación leve',
    'classification.watch': 'En observación',
    'classification.pass': 'Sin valor',
    'price_state.AVAILABLE': 'Disponible',
    'price_state.ABOVE_MINIMUM': 'Disponible (sobre la cuota mínima)',
    'price_state.AT_MINIMUM': 'En la cuota mínima',
    'price_state.BELOW_MINIMUM': 'Por debajo de la cuota mínima',
    'price_state.STALE': 'Precio desactualizado',
    'price_state.SUSPENDED': 'Mercado suspendido',
    'price_state.UNAVAILABLE': 'No disponible',
    'price_state.EVENT_STARTED': 'El evento ya comenzó',
    'lifecycle.READY_FOR_REVIEW': 'Lista para revisión',
    'lifecycle.BLOCKED': 'Bloqueada',
    'lifecycle.PRICE_BELOW_MINIMUM': 'Cuota por debajo de la mínima',
    'lifecycle.STALE': 'Desactualizada',
    'lifecycle.EXPIRED': 'Expirada',
    'lifecycle.REJECTED': 'Rechazada',
    'lifecycle.CONVERTED_TO_PICK': 'Convertida a Pick',
    'blocker.BLOCKED_MISSING_ESPN_MAPPING': 'Falta el mapeo de resultado (ESPN)',
    'blocker.BLOCKED_MISSING_DEEP_LINK': 'Falta el enlace a la casa de apuestas',
    'blocker.BLOCKED_STALE_PRICE': 'Precio desactualizado',
    'blocker.BLOCKED_PRICE_BELOW_MINIMUM': 'Cuota por debajo de la mínima',
    'blocker.BLOCKED_EVENT_STARTED': 'El evento ya comenzó',
    'blocker.BLOCKED_INSUFFICIENT_GROUPS': 'Grupos verificados insuficientes',
    'blocker.BLOCKED_REGISTRY_UNHEALTHY': 'Registro no operativo',
    'blocker.BLOCKED_METRICS_UNHEALTHY': 'Métricas no operativas',
    'blocker.BLOCKED_KICKOFF_TOO_SOON': 'El partido empieza muy pronto',
    'blocker.BLOCKED_MISSING_CANONICAL': 'Falta el evento canónico',
    'risk.MODEL_DISAGREEMENT': 'El modelo de GP asigna una probabilidad superior al consenso del mercado.',
    'risk.LARGE_MARKET_DISAGREEMENT': 'Existe un desacuerdo importante entre el modelo de GP y el mercado.',
    'risk.PRICE_NEAR_MINIMUM': 'La cuota está cerca de la mínima aceptable.',
    'risk.MODEL_UNCERTAINTY': 'El modelo tiene incertidumbre apreciable en este partido.',
    'risk.LINEUP_INFORMATION_NOT_INCLUDED': 'El modelo no incorpora alineaciones ni lesiones de último momento.',
    'explanation.MODEL_DISAGREEMENT': 'El modelo de GP asigna una probabilidad superior al consenso del mercado.',
    'explanation.LARGE_MARKET_DISAGREEMENT': 'El modelo discrepa de forma marcada con el consenso del mercado.',
    'ui.opportunity': 'Oportunidad',
    'ui.current_odds': 'Cuota vigente',
    'ui.minimum_odds': 'Cuota mínima',
    'ui.sportsbook': 'Casa',
    'ui.market': 'Mercado',
    'ui.period': 'Periodo',
    'ui.price_status': 'Estado del precio',
    'ui.main_risk': 'Riesgo principal',
    'ui.approve_as_pick': 'Aprobar como Pick interna',
    'ui.reject': 'Rechazar',
    'ui.refresh': 'Refrescar',
    'ui.candidates': 'Candidatos a Pick GP',
    'ui.no_candidates': 'No apareció ninguna oportunidad que cumpliera los filtros actuales.',
    'ui.conversion_disabled': 'Conversión deshabilitada',
    'ui.not_ready': 'El candidato no está listo',
    'ui.disclaimer': 'Estimaciones de un modelo estadístico, no consejo financiero.',
    'ui.approve_warning': 'Esta acción creará una Pick oficial interna y una Signal inmutable en el Registro. No podrá borrarse en silencio. No publica ni envía alertas.',
    'confirm.reason': 'Motivo de la aprobación (obligatorio):',
    'confirm.review_note': 'Nota de revisión humana (obligatoria):',
    'confirm.type_id': 'Escribí el candidate_id exacto para confirmar:',
    'confirm.phrase': 'Escribí exactamente:\nCONFIRM {id}',
    'lang.label': 'Idioma',
  },
  en: {
    'selection.team_to_win': '{team} to win',
    'selection.draw': 'Draw',
    'market.match_result': 'Match result',
    'period.regulation': 'Regulation time',
    'period.regulation_note': '90 minutes; extra time and penalties are not included.',
    'classification.strong': 'Strong opportunity',
    'classification.lean': 'Slight lean',
    'classification.watch': 'Watching',
    'classification.pass': 'No value',
    'price_state.AVAILABLE': 'Available',
    'price_state.ABOVE_MINIMUM': 'Available (above minimum odds)',
    'price_state.AT_MINIMUM': 'At minimum odds',
    'price_state.BELOW_MINIMUM': 'Below minimum odds',
    'price_state.STALE': 'Stale price',
    'price_state.SUSPENDED': 'Market suspended',
    'price_state.UNAVAILABLE': 'Unavailable',
    'price_state.EVENT_STARTED': 'Event has started',
    'lifecycle.READY_FOR_REVIEW': 'Ready for review',
    'lifecycle.BLOCKED': 'Blocked',
    'lifecycle.PRICE_BELOW_MINIMUM': 'Odds below minimum',
    'lifecycle.STALE': 'Stale',
    'lifecycle.EXPIRED': 'Expired',
    'lifecycle.REJECTED': 'Rejected',
    'lifecycle.CONVERTED_TO_PICK': 'Converted to Pick',
    'blocker.BLOCKED_MISSING_ESPN_MAPPING': 'Missing result mapping (ESPN)',
    'blocker.BLOCKED_MISSING_DEEP_LINK': 'Missing sportsbook link',
    'blocker.BLOCKED_STALE_PRICE': 'Stale price',
    'blocker.BLOCKED_PRICE_BELOW_MINIMUM': 'Odds below minimum',
    'blocker.BLOCKED_EVENT_STARTED': 'Event has started',
    'blocker.BLOCKED_INSUFFICIENT_GROUPS': 'Insufficient verified groups',
    'blocker.BLOCKED_REGISTRY_UNHEALTHY': 'Registry not operational',
    'blocker.BLOCKED_METRICS_UNHEALTHY': 'Metrics not operational',
    'blocker.BLOCKED_KICKOFF_TOO_SOON': 'Kickoff too soon',
    'blocker.BLOCKED_MISSING_CANONICAL': 'Missing canonical event',
    'risk.MODEL_DISAGREEMENT': 'GP assigns a higher probability than the market consensus.',
    'risk.LARGE_MARKET_DISAGREEMENT': 'There is a significant disagreement between GP’s model and the market.',
    'risk.PRICE_NEAR_MINIMUM': 'The odds are close to the minimum acceptable price.',
    'risk.MODEL_UNCERTAINTY': 'The model has appreciable uncertainty for this match.',
    'risk.LINEUP_INFORMATION_NOT_INCLUDED': 'The model does not include last-minute lineups or injuries.',
    'explanation.MODEL_DISAGREEMENT': 'GP assigns a higher probability than the market consensus.',
    'explanation.LARGE_MARKET_DISAGREEMENT': 'The model disagrees sharply with the market consensus.',
    'ui.opportunity': 'Opportunity',
    'ui.current_odds': 'Current odds',
    'ui.minimum_odds': 'Minimum odds',
    'ui.sportsbook': 'Sportsbook',
    'ui.market': 'Market',
    'ui.period': 'Period',
    'ui.price_status': 'Price status',
    'ui.main_risk': 'Main risk',
    'ui.approve_as_pick': 'Approve as internal Pick',
    'ui.reject': 'Reject',
    'ui.refresh': 'Refresh',
    'ui.candidates': 'GP Pick candidates',
    'ui.no_candidates': 'No opportunity met the current filters.',
    'ui.conversion_disabled': 'Conversion disabled',
    'ui.not_ready': 'Candidate is not ready',
    'ui.disclaimer': 'Estimates from a statistical model, not financial advice.',
    'ui.approve_warning': 'This will create an official internal Pick and an immutable Signal in the Registry. It cannot be silently deleted. It does not publish or send alerts.',
    'confirm.reason': 'Approval reason (required):',
    'confirm.review_note': 'Human review note (required):',
    'confirm.type_id': 'Type the exact candidate_id to confirm:',
    'confirm.phrase': 'Type exactly:\nCONFIRM {id}',
    'lang.label': 'Language',
  },
};

// nombres de equipo por stable team ID (CRO, GHA, …) desde data/tournament (name=ES, en=EN). Aditivo y reversible.
let TEAMS_I18N = {}, ALIAS_TO_ID = {};
try {
  const { TEAMS } = require('../data/tournament');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  for (const t of TEAMS) {
    TEAMS_I18N[t.id] = { es: t.name, en: t.en || t.name };
    [t.en, t.name, ...(t.aliases || [])].forEach(a => { if (a) ALIAS_TO_ID[norm(a)] = t.id; });
  }
} catch { /* sin data → fallback */ }

function normName(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
// resuelve nombre del proveedor (inglés crudo) → stable team ID. NUNCA inventa traducción.
function resolveTeamId(name) { return ALIAS_TO_ID[normName(name)] || null; }
// nombre localizado por team ID. Fallback: id → null. (el caller decide usar el nombre canónico del proveedor)
function teamName(teamId, locale = DEFAULT_LOCALE, fallbackName = null) {
  const e = TEAMS_I18N[teamId];
  if (e && e[locale]) return e[locale];
  if (e && e[DEFAULT_LOCALE]) return e[DEFAULT_LOCALE];
  return fallbackName || teamId || null;
}

// t(key, args, locale) → string localizado con interpolación {arg}. Fallback: locale → es → key.
function t(key, args = {}, locale = DEFAULT_LOCALE) {
  const table = DICT[LOCALES.includes(locale) ? locale : DEFAULT_LOCALE] || DICT[DEFAULT_LOCALE];
  let s = (table && table[key] != null) ? table[key] : (DICT[DEFAULT_LOCALE][key] != null ? DICT[DEFAULT_LOCALE][key] : key);
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (args[k] != null ? args[k] : m));
}

// modelo de display NEUTRAL para una selección 1X2 (no es una frase: es key + args + código).
function selectionDisplayModel(outcomeCode, homeTeamId, awayTeamId) {
  const oc = String(outcomeCode || '').toUpperCase();
  if (oc === 'DRAW') return { display_key: 'selection.draw', display_args: {}, outcome_code: 'DRAW', i18n_version: I18N_VERSION };
  const teamId = oc === 'AWAY' ? awayTeamId : homeTeamId;
  return { display_key: 'selection.team_to_win', display_args: { team_id: teamId }, outcome_code: oc || 'HOME', i18n_version: I18N_VERSION };
}

// renderiza un display model a texto localizado (resuelve team_id → nombre localizado).
function renderSelection(model, locale = DEFAULT_LOCALE, fallbackTeamName = null) {
  if (!model || !model.display_key) return '';
  const args = { ...(model.display_args || {}) };
  if (args.team_id) args.team = teamName(args.team_id, locale, fallbackTeamName);
  return t(model.display_key, args, locale);
}

// payload completo para el cliente (ambos idiomas resueltos), sin perder el modelo neutral.
function localizeAll(model, fallbackTeamName = null) {
  return { ...model, es: renderSelection(model, 'es', fallbackTeamName), en: renderSelection(model, 'en', fallbackTeamName) };
}

module.exports = { I18N_VERSION, LOCALES, DEFAULT_LOCALE, DICT, TEAMS_I18N, t, teamName, resolveTeamId, selectionDisplayModel, renderSelection, localizeAll, normName };
