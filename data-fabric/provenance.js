// data-fabric/provenance.js — PROCEDENCIA, CONFIANZA, CONFLICTOS Y AUSENCIAS (16-ago).
// Módulos 7, 8, 9, 10 y 11 del blueprint.
//
// LA IDEA QUE ORDENA ESTE ARCHIVO: un número sin su origen no es un dato, es un rumor. Cada métrica que
// publicamos tiene que poder contestar cuatro preguntas sin que nadie tenga que abrir el código:
//   ¿de dónde salió? ¿cuándo? ¿qué tan fiable es esa fuente para ESE campo? ¿alguien más dice otra cosa?
//
// LOS DOS ERRORES QUE ESTO EVITA, Y LOS DOS SON CAROS:
//
// 1. RESOLVER UN CONFLICTO EN SILENCIO. Dos fuentes dicen cosas distintas sobre los minutos de un jugador.
//    Si el código elige una y sigue, el sistema aprende de un dato que puede estar mal y nadie se entera
//    nunca. Acá el ganador se elige por jerarquía DECLARADA y el conflicto queda registrado.
//
// 2. CONVERTIR UNA AUSENCIA EN UNA SEÑAL. Es el error más silencioso de todos. ESPN no publica
//    points-off-turnovers en NBA ni WNBA; si eso se guarda como 0, el modelo aprende que hay equipos que no
//    anotan tras pérdida. Cinco estados distintos, y ninguno es intercambiable con otro:
//      · REAL_ZERO      — ocurrió y vale cero (0 triples anotados)
//      · NULL           — el campo existe y viene vacío
//      · NOT_OBSERVED   — la fuente no mide eso en esta liga
//      · NOT_APPLICABLE — no tiene sentido acá (prórroga en un partido sin prórroga)
//      · DELAYED        — llegará, todavía no está (box score a medio partido)
'use strict';

// ---- NIVELES DE CONFIANZA (módulo 10) --------------------------------------------------------------------
// El score no es decorativo: alimenta la incertidumbre del modelo y las compuertas de pick.
const TIER = {
  official: { score: 1.00, label: 'oficial', note: 'publicado por la liga' },
  licensed: { score: 0.92, label: 'licenciado', note: 'proveedor de pago con contrato' },
  verified: { score: 0.80, label: 'verificado', note: 'fuente pública contrastada contra otra' },
  derived: { score: 0.65, label: 'derivado', note: 'calculado por nosotros a partir de datos crudos' },
  inferred: { score: 0.40, label: 'inferido', note: 'reconstruido con supuestos declarados' },
};

// Catálogo de fuentes. Cambiar esto es cambiar la política de datos, y por eso está en un solo sitio.
const SOURCES = {
  espn: { tier: 'verified', label: 'ESPN', domains: ['schedule', 'box', 'pbp', 'injuries', 'officials'], sla_min: { pbp: 2, box: 15, injuries: 60, schedule: 720 } },
  nba_stats: { tier: 'official', label: 'stats.nba.com', domains: ['playtypes', 'tracking', 'pbp'], sla_min: { tracking: 1440, playtypes: 1440 } },
  odds_api: { tier: 'licensed', label: 'The Odds API', domains: ['odds'], sla_min: { odds: 15 } },
  manual: { tier: 'inferred', label: 'manual', domains: ['*'], sla_min: {} },
  gp: { tier: 'derived', label: 'GP', domains: ['*'], sla_min: {} },
};

// JERARQUÍA POR DOMINIO. No es "ESPN siempre gana": para cuotas manda el proveedor de cuotas, para tracking
// manda la NBA, para el parte de bajas manda quien lo publique más tarde con mejor tier. Declararlo por
// dominio es lo que evita discusiones cada vez que aparece un desacuerdo.
const HIERARCHY = {
  odds: ['odds_api', 'espn'],
  tracking: ['nba_stats'],
  playtypes: ['nba_stats'],
  officials: ['espn'],
  pbp: ['nba_stats', 'espn'],
  box: ['espn', 'nba_stats'],
  injuries: ['espn', 'manual'],
  schedule: ['espn', 'nba_stats'],
  default: ['espn', 'nba_stats', 'odds_api', 'manual', 'gp'],
};

const MISSING = { REAL_ZERO: 'real_zero', NULL: 'null', NOT_OBSERVED: 'not_observed', NOT_APPLICABLE: 'not_applicable', DELAYED: 'delayed' };

function sourceInfo(src) {
  const s = SOURCES[src] || { tier: 'inferred', label: src, domains: [], sla_min: {} };
  const t = TIER[s.tier];
  return { source: src, label: s.label, tier: s.tier, confidence: t.score, tier_label: t.label, tier_note: t.note };
}

// ---- SELLO DE PROCEDENCIA --------------------------------------------------------------------------------
// Se cuelga de cada valor que viaja al frontend cuando el panel quiere poder abrir el cajón de procedencia.
function stamp({ source, domain = 'default', observed_at = null, effective_at = null, transform = null, note = null }) {
  const si = sourceInfo(source);
  const now = new Date().toISOString();
  return {
    ...si, domain,
    effective_at: effective_at || observed_at || now,
    observed_at: observed_at || now,
    ingested_at: now,
    transform: transform || null,
    note,
  };
}

// ---- FRESCURA (módulo 8) ---------------------------------------------------------------------------------
// El SLA se declara por fuente y dominio. Un dato fuera de SLA no se borra: se marca, y las compuertas
// deciden. Un panel puede enseñar una cuota de hace una hora diciendo que tiene una hora; lo que no puede
// es recomendarla como si fuera de ahora.
function freshness(st, { now = null } = {}) {
  const t0 = now || Date.now();
  const obs = st && st.observed_at ? Date.parse(st.observed_at) : null;
  if (!obs) return { known: false };
  const ageMin = Math.max(0, (t0 - obs) / 60000);
  const sla = ((SOURCES[st.source] || {}).sla_min || {})[st.domain];
  return {
    known: true, age_min: +ageMin.toFixed(1), sla_min: sla || null,
    within_sla: sla ? ageMin <= sla : null,
    state: !sla ? 'sin_sla' : ageMin <= sla ? 'fresco' : ageMin <= sla * 3 ? 'tibio' : 'rancio',
  };
}

// ---- CONFLICTOS (módulo 9) -------------------------------------------------------------------------------
// `values`: [{ source, value, observed_at }]. Devuelve el ganador POR JERARQUÍA y el conflicto entero, para
// que quede registrado y se pueda revisar. Empate de jerarquía → gana el más reciente, y se dice.
function reconcile(values, { domain = 'default', equals = null } = {}) {
  const list = (values || []).filter((v) => v && v.value !== undefined && v.value !== null);
  if (!list.length) return { value: null, missing: MISSING.NULL, sources: [] };
  const eq = equals || ((a, b) => JSON.stringify(a) === JSON.stringify(b));
  const order = HIERARCHY[domain] || HIERARCHY.default;
  const rank = (s) => { const i = order.indexOf(s); return i < 0 ? order.length + 1 : i; };
  const sorted = list.slice().sort((a, b) => {
    const d = rank(a.source) - rank(b.source);
    if (d !== 0) return d;
    return (Date.parse(b.observed_at || 0) || 0) - (Date.parse(a.observed_at || 0) || 0);
  });
  const winner = sorted[0];
  const disagree = list.filter((v) => !eq(v.value, winner.value));
  return {
    value: winner.value,
    chosen: { source: winner.source, reason: rank(winner.source) < order.length ? 'jerarquía declarada para ' + domain : 'única fuente disponible' },
    conflict: disagree.length > 0,
    disagreements: disagree.map((v) => ({ source: v.source, value: v.value, observed_at: v.observed_at || null })),
    sources: list.map((v) => v.source),
    confidence: sourceInfo(winner.source).confidence * (disagree.length ? 0.85 : 1),   // discrepar rebaja la confianza
  };
}

// ---- REGISTRO DE AUSENCIAS (módulo 11) -------------------------------------------------------------------
// Clasifica un valor ausente. `policy` declara qué campos sabemos que una fuente NO publica: eso convierte
// un misterio ("¿por qué está vacío?") en un hecho documentado.
const NOT_OBSERVED_BY = {
  espn: ['pts_off_tov', 'second_chance_pts', 'play_type', 'tracking_drives', 'tracking_touches',
    'shot_defender_distance', 'shot_clock', 'contested'],
  nba_stats: [],
  odds_api: [],
};
function classify(field, value, { source = 'espn', gameCompleted = true, applicable = true } = {}) {
  if (!applicable) return { state: MISSING.NOT_APPLICABLE, publishable: false, note: 'no aplica a este contexto' };
  if ((NOT_OBSERVED_BY[source] || []).indexOf(field) >= 0) {
    return { state: MISSING.NOT_OBSERVED, publishable: false, note: `${(SOURCES[source] || {}).label || source} no publica este campo` };
  }
  if (value === 0) return { state: MISSING.REAL_ZERO, publishable: true, note: null };
  if (value === null || value === undefined) {
    return gameCompleted
      ? { state: MISSING.NULL, publishable: false, note: 'la fuente lo dejó vacío' }
      : { state: MISSING.DELAYED, publishable: false, note: 'el partido no ha terminado: el dato aún puede llegar' };
  }
  return { state: null, publishable: true, note: null };
}

// Auditoría de un objeto entero contra la política: devuelve qué campos faltan y por qué. Es lo que permite
// que un panel diga "esto no está porque la fuente no lo mide" en vez de dibujar un cero.
function auditMissing(obj, fields, opts = {}) {
  const out = [];
  for (const f of fields) {
    const c = classify(f, obj ? obj[f] : undefined, opts);
    if (c.state && c.state !== MISSING.REAL_ZERO) out.push({ field: f, ...c });
  }
  return out;
}

module.exports = { TIER, SOURCES, HIERARCHY, MISSING, NOT_OBSERVED_BY, sourceInfo, stamp, freshness, reconcile, classify, auditMissing };
