// combat-engine/style.js — ADN DE PELEA Y CRUCE DE ESTILOS (16-ago).
// Módulos 101-122 del blueprint de combate.
//
// LA FRASE QUE ORDENA ESTO: "'striker vs wrestler' es demasiado pobre". Y es verdad. Esa etiqueta mete en
// la misma caja a un presionador de volumen y a un francotirador de contra, que pierden y ganan contra
// cosas opuestas. Acá cada peleador es un VECTOR CONTINUO —distancia, ritmo, iniciativa, preferencia de
// fase, riesgo, mecanismo de finalización— y los arquetipos son solo la lectura humana de ese vector, con
// su confianza al lado.
//
// LA SEGUNDA IDEA, QUE ES DONDE ESTÁ EL DINERO: el blueprint dice que "la mayor parte del edge potencial
// debe emerger de interacciones". No "qué tan bueno es A", sino qué partes de A atacan debilidades
// VERIFICABLES de B, y con qué probabilidad la pelea llega a la fase donde eso importa. Un luchador
// excelente contra un rival con 85% de defensa de derribo no tiene ventaja de lucha: tiene un plan que no
// va a poder ejecutar.
//
// LA TERCERA: LA FRAGILIDAD DEL PRONÓSTICO (módulo 122). Si toda nuestra ventaja depende de que la pelea
// vaya al suelo y la probabilidad de que vaya al suelo es del 35%, eso hay que decirlo. Un favorito cuya
// ventaja vive en una sola fase es mucho más arriesgado que uno que gana en todas, aunque su probabilidad
// sea la misma.
//
// PURO: entran perfiles, salen vectores y cruces. Sin red, sin disco, sin db.
'use strict';

const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Percentil de un valor dentro de una distribución ya ordenada.
function pct(sorted, x) {
  if (!Number.isFinite(x) || !sorted.length) return null;
  let lo = 0; while (lo < sorted.length && sorted[lo] < x) lo++;
  return lo / sorted.length;
}
function distribution(profiles, pick) {
  const v = [];
  for (const p of profiles.values()) { const x = pick(p); if (Number.isFinite(x)) v.push(x); }
  return v.sort((a, b) => a - b);
}

// ---- 1) EL VECTOR DE ESTILO (módulos 101-110) -----------------------------------------------------------
// Ocho ejes, todos en percentil de la división para que se puedan comparar entre sí y dibujar juntos.
const AXES = [
  { key: 'volume', label: 'Volumen', pick: (p) => p.striking && p.striking.pace.sig_att_pm },
  { key: 'accuracy', label: 'Precisión', pick: (p) => p.striking && p.striking.accuracy.sig },
  { key: 'defense', label: 'Defensa', pick: (p) => p.striking && p.striking.defense.striking_defense },
  { key: 'power', label: 'Poder', pick: (p) => p.striking && p.striking.power.kd_per15 },
  { key: 'wrestling', label: 'Lucha', pick: (p) => p.grappling && p.grappling.takedown.landed_per15 },
  { key: 'td_defense', label: 'Defensa de derribo', pick: (p) => p.grappling && p.grappling.takedown.defense },
  { key: 'control', label: 'Control', pick: (p) => p.grappling && p.grappling.control.min_per15 },
  { key: 'submission', label: 'Sumisión', pick: (p) => p.grappling && p.grappling.submission.att_per15 },
];

function styleVectors(profiles) {
  const dists = {};
  for (const a of AXES) dists[a.key] = distribution(profiles, a.pick);
  const out = new Map();
  for (const [id, p] of profiles) {
    const v = {};
    for (const a of AXES) v[a.key] = r3(pct(dists[a.key], a.pick(p)));
    const s = p.striking, g = p.grappling;
    // ejes derivados que no son percentiles sino proporciones del propio peleador
    const range = s ? { distance: s.position.distance, clinch: s.position.clinch, ground: s.position.ground } : null;
    const target = s ? s.target : null;
    // 104 · apetito de riesgo: cuánto se juega en cada intercambio (derribos propios y ajenos por minuto)
    const risk = s ? r3(clamp01((s.volatility || 0) / 1.2)) : null;
    // 105 · iniciativa: quién fuerza. Intentos propios frente al total de intentos de la pelea.
    const initiative = s ? r3(clamp01(s.pace.sig_att_pm / Math.max(0.1, s.pace.sig_att_pm + (s.defense.absorbed_pm / Math.max(0.05, s.defense.opp_accuracy || 0.4))))) : null;
    // 107 · persistencia de fase: minutos de control por derribo, normalizado — mide si retiene lo que gana
    const persistence = g && g.control.per_takedown != null ? r3(clamp01(g.control.per_takedown / 4)) : null;
    // 108 · competencia de transición: capacidad de avanzar una vez arriba
    const transition = g ? r3(clamp01((g.advance.per_control_min || 0) / 0.6)) : null;
    // 110 · confianza del arquetipo: con 3 peleas no se etiqueta a nadie
    const n = (s && s.sample.fights) || (g && g.sample.fights) || 0;
    const mins = (s && s.sample.minutes) || 0;
    const confidence = r3(clamp01(Math.min(n / 10, mins / 60)));
    out.set(id, { id, axes: v, range, target, risk, initiative, persistence, transition, confidence,
      sample: { fights: n, minutes: mins },
      archetype: archetypeOf({ v, range, target, risk, initiative, s, g }, confidence) });
  }
  return out;
}

// ---- 2) ARQUETIPOS INTERPRETABLES ------------------------------------------------------------------------
// Reglas legibles sobre el vector. No es machine learning: es vocabulario. Y siempre con la confianza al
// lado, porque una etiqueta sin muestra es una opinión disfrazada de dato.
function archetypeOf({ v, range, target, risk, initiative, s, g }, confidence) {
  const tags = [];
  const hi = (k, t = 0.7) => (v[k] != null && v[k] >= t);
  const lo = (k, t = 0.3) => (v[k] != null && v[k] <= t);
  // familia de golpeo (101)
  if (hi('volume', 0.75) && initiative >= 0.55) tags.push('presionador de volumen');
  else if (lo('volume', 0.35) && hi('accuracy', 0.6)) tags.push('francotirador');
  else if (hi('defense', 0.7) && lo('volume', 0.45)) tags.push('contragolpeador');
  else if (hi('volume', 0.6)) tags.push('golpeador activo');
  if (range && range.clinch >= 0.18) tags.push('peleador de clinch');
  if (target && target.leg >= 0.22) tags.push('juego de piernas');
  if (target && target.body >= 0.2) tags.push('inversión al cuerpo');
  // familia de lucha (102-103)
  if (hi('wrestling', 0.75) && hi('control', 0.7)) tags.push('luchador de control');
  else if (hi('wrestling', 0.7)) tags.push('luchador ofensivo');
  if (hi('td_defense', 0.75) && lo('wrestling', 0.4)) tags.push('anti-lucha');
  if (hi('submission', 0.75)) tags.push('cazador de sumisiones');
  if (g && g.advance.to_back >= 0.25 && g.advance.per15 > 0.2) tags.push('cazador de espalda');
  if (hi('power', 0.8)) tags.push('poder de una mano');
  if (risk != null && risk >= 0.6) tags.push('alto riesgo');
  if (!tags.length) tags.push('perfil equilibrado');
  return { tags: tags.slice(0, 4), confidence,
    note: confidence < 0.45 ? 'muestra corta: la etiqueta es orientativa' : null };
}

// ---- 3) EL CRUCE (módulos 111-122) -----------------------------------------------------------------------
// Cada dimensión enfrenta el ATAQUE de uno contra la DEFENSA del otro, no ataque contra ataque. Es la
// diferencia entre "los dos luchan bien" y "el que lucha se estrella contra el que defiende".
function matchup(pa, pb, sa, sb, { league = null } = {}) {
  if (!pa || !pb) return null;
  const A = pa.striking, B = pb.striking, Ag = pa.grappling, Bg = pb.grappling;
  const dims = [];
  const push = (key, label, edge, detail, phase) => {
    if (!Number.isFinite(edge)) return;
    dims.push({ key, label, edge: r3(Math.max(-1, Math.min(1, edge))), favors: edge > 0 ? 'a' : 'b', detail, phase });
  };

  // 111 · control de distancia: volumen y precisión de uno contra la defensa del otro
  if (A && B) {
    const aVsB = (A.pace.sig_landed_pm || 0) * (1 - (B.defense.striking_defense || 0.5)) * 2;
    const bVsA = (B.pace.sig_landed_pm || 0) * (1 - (A.defense.striking_defense || 0.5)) * 2;
    push('range', 'Intercambio a distancia', norm(aVsB, bVsA),
      `${r2(A.pace.sig_landed_pm)}/min contra defensa ${pctTxt(B.defense.striking_defense)} · ${r2(B.pace.sig_landed_pm)}/min contra ${pctTxt(A.defense.striking_defense)}`, 'pie');
    // 112 · pocket: poder contra durabilidad
    const aPow = (A.power.kd_per15 || 0) * (1 + (B.durability.kd_absorbed_per15 || 0));
    const bPow = (B.power.kd_per15 || 0) * (1 + (A.durability.kd_absorbed_per15 || 0));
    push('power', 'Poder contra mentón', norm(aPow, bPow),
      `${r2(A.power.kd_per15)} derribos/15 contra un rival que recibe ${r2(B.durability.kd_absorbed_per15)}`, 'pie');
    // 113 · clinch
    push('clinch', 'Clinch', norm(A.position.clinch || 0, B.position.clinch || 0),
      `${pctTxt(A.position.clinch)} del golpeo de A contra ${pctTxt(B.position.clinch)} de B`, 'clinch');
  }
  // 114 · derribo: perfil de finalización del atacante contra defensa del defensor
  if (Ag && Bg) {
    const aTd = (Ag.takedown.att_per15 || 0) * (Ag.takedown.accuracy || 0) * (1 - (Bg.takedown.defense || 0.5)) * 4;
    const bTd = (Bg.takedown.att_per15 || 0) * (Bg.takedown.accuracy || 0) * (1 - (Ag.takedown.defense || 0.5)) * 4;
    push('takedown', 'Derribo', norm(aTd, bTd),
      `${r2(Ag.takedown.att_per15)} intentos/15 al ${pctTxt(Ag.takedown.accuracy)} contra defensa ${pctTxt(Bg.takedown.defense)}`, 'lucha');
    // 115 · arriba/abajo
    push('control', 'Control en el suelo', norm(Ag.control.net_per15 || 0, Bg.control.net_per15 || 0),
      `${r2(Ag.control.min_per15)} min de control/15 contra ${r2(Bg.control.min_per15)}`, 'suelo');
    // 83 · amenaza de sumisión contra defensa
    const aSub = (Ag.submission.att_per_control_min || 0) * (1 + (Bg.submission.lost_by_sub_rate || 0) * 3);
    const bSub = (Bg.submission.att_per_control_min || 0) * (1 + (Ag.submission.lost_by_sub_rate || 0) * 3);
    push('submission', 'Amenaza de sumisión', norm(aSub, bSub),
      `${r2(Ag.submission.att_per_control_min)} intentos por minuto de control`, 'suelo');
  }

  // ---- 121 · CAMINO DE MENOR RESISTENCIA ----------------------------------------------------------------
  // Para cada peleador, dónde está su mejor ventaja y con qué probabilidad la pelea llega a esa fase.
  const phaseProb = phaseMass(pa, pb);
  const routeFor = (side) => {
    const mine = dims.filter((d) => (side === 'a' ? d.edge > 0 : d.edge < 0))
      .map((d) => ({ ...d, mag: Math.abs(d.edge), reach: phaseProb[d.phase] || 0.5 }))
      .sort((x, y) => (y.mag * y.reach) - (x.mag * x.reach));
    if (!mine.length) return null;
    const top = mine[0];
    return { via: top.label, phase: top.phase, edge: r3(top.mag), phase_prob: r3(top.reach),
      expected_value: r3(top.mag * top.reach),
      note: rareForPhase(top.phase, top.reach)
        ? 'su mejor ventaja vive en una fase que en esta pelea pesa poco'
        : null };
  };

  // ---- 122 · FRAGILIDAD DEL PRONÓSTICO ------------------------------------------------------------------
  // Cuánto depende la conclusión de una sola fase. Si la ventaja total se concentra en una dimensión cuya
  // fase es improbable, el pronóstico es frágil aunque la probabilidad final parezca cómoda.
  const total = dims.reduce((s, d) => s + Math.abs(d.edge) * (phaseProb[d.phase] || 0.5), 0);
  const top1 = dims.map((d) => Math.abs(d.edge) * (phaseProb[d.phase] || 0.5)).sort((a, b) => b - a)[0] || 0;
  const concentration = total > 0 ? top1 / total : null;
  const net = dims.reduce((s, d) => s + d.edge * (phaseProb[d.phase] || 0.5), 0);

  return {
    dims, phase_prob: phaseProb,
    net_edge: r3(net),
    routes: { a: routeFor('a'), b: routeFor('b') },
    fragility: {
      concentration: r3(concentration),
      level: concentration == null ? null : concentration > 0.55 ? 'alta' : concentration > 0.38 ? 'media' : 'baja',
      note: concentration > 0.55 ? 'casi toda la ventaja sale de una sola dimensión: si la pelea no va por ahí, el pronóstico se cae'
        : 'la ventaja está repartida en varias dimensiones, así que no depende de un solo escenario',
    },
    // el resumen en una línea, que es lo que lee el 90% de la gente
    summary: summarize(dims, phaseProb, sa, sb),
  };
}

// ---- ¿ES RARA ESTA FASE EN ESTA PELEA? (corregido 16-ago) -----------------------------------------------
// EL FALLO QUE ESTO ARREGLA. La nota de la ruta usaba un umbral ÚNICO de 0,40 para las cuatro fases, y las
// cuatro viven en escalas completamente distintas. Medido sobre 1.199 cruces reales de la UFC:
//
//   fase     p25     mediana        con el umbral viejo, la nota saltaba en…
//   pie     0,164     0,414         48,9 % de los cruces
//   clinch  0,075     0,103         **100 %** — SIEMPRE
//   lucha   0,237     0,386         —
//   suelo   0,276     0,469         41,1 %
//
// O sea: cualquier ruta que fuera por el clinch se publicaba SIEMPRE con el aviso "la pelea probablemente
// no llegue ahí", que sobre una fase cuya mediana es el 10 % de la pelea no es un aviso, es una constante.
// Y con el suelo al 22 % le salía a Makhachev, que es quien lleva las peleas al suelo. Un aviso que no
// puede no salir no informa: entrena al ojo a ignorar el panel entero.
//
// La corrección es comparar cada fase CONTRA SU PROPIA distribución. El corte es el percentil 25 medido
// arriba: la nota salta cuando esta pelea está en el cuarto más bajo de esa fase, que es lo que "pesa poco"
// significa de verdad. El texto también cambia: "pesa poco en esta pelea" es lo que el número dice; "la
// pelea no llega ahí" era falso para el clinch y para el suelo, por los que toda pelea de MMA pasa.
const PHASE_P25 = { pie: 0.164, clinch: 0.075, lucha: 0.237, suelo: 0.276 };
function rareForPhase(phase, reach) {
  const ref = PHASE_P25[phase];
  if (!Number.isFinite(ref) || !Number.isFinite(reach)) return false;
  return reach < ref;
}

// Dónde va a vivir la pelea. Sale del apetito de lucha de uno contra la defensa del otro, y del reparto de
// golpeo por posición de los dos. No es una constante: dos strikers puros producen 90% de pie.
function phaseMass(pa, pb) {
  const Ag = pa.grappling, Bg = pb.grappling, A = pa.striking, B = pb.striking;
  if (!Ag || !Bg || !A || !B) return { pie: 0.75, clinch: 0.1, lucha: 0.1, suelo: 0.05 };
  // LOS INTENTOS NO BASTAN, Y ESTE ERROR SE VIO EN PRODUCCIÓN. Quien ya domina en el suelo deja de
  // *intentar* derribos —está controlando— así que su tasa de intentos por 15 minutos SUBESTIMA cuánto
  // lleva la pelea al suelo. Con solo intentos, Makhachev salía con un 21% de suelo y una probabilidad de
  // 56% contra el 75% del mercado. El tiempo de control es la evidencia directa de dónde acaba la pelea,
  // así que entra a la par: se toma lo mayor de las dos señales, no su media.
  const aGround = Math.max(
    (Ag.takedown.att_per15 || 0) * (1 - (Bg.takedown.defense || 0.5)),
    ((Ag.control.min_per15 || 0) / 15) * 5 * (1 - (Bg.takedown.defense || 0.5)) * 2,
  );
  const bGround = Math.max(
    (Bg.takedown.att_per15 || 0) * (1 - (Ag.takedown.defense || 0.5)),
    ((Bg.control.min_per15 || 0) / 15) * 5 * (1 - (Ag.takedown.defense || 0.5)) * 2,
  );
  const groundPush = aGround + bGround;                     // presión de suelo esperada por 15 min
  const suelo = clamp01(groundPush / 5);
  const clinch = clamp01(((A.position.clinch || 0) + (B.position.clinch || 0)) / 2 * 1.6);
  const lucha = clamp01(suelo * 0.7 + clinch * 0.3);
  const pie = clamp01(1 - suelo - clinch * 0.5);
  const s = pie + clinch + suelo || 1;
  return { pie: r3(pie / s), clinch: r3(clinch / s), lucha: r3(lucha), suelo: r3(suelo / s) };
}

function summarize(dims, phase, sa, sb) {
  const sorted = dims.slice().sort((x, y) => Math.abs(y.edge) * (phase[y.phase] || 0.5) - Math.abs(x.edge) * (phase[x.phase] || 0.5));
  const top = sorted[0];
  if (!top) return null;
  const who = top.edge > 0 ? 'A' : 'B';
  const arqA = sa && sa.archetype ? sa.archetype.tags[0] : null;
  const arqB = sb && sb.archetype ? sb.archetype.tags[0] : null;
  return {
    headline: `${top.label}: ventaja para ${who}`,
    where: `la pelea vive un ${Math.round(100 * (phase.pie || 0))}% de pie y un ${Math.round(100 * (phase.suelo || 0))}% en el suelo`,
    styles: arqA && arqB ? `${arqA} contra ${arqB}` : null,
  };
}

const norm = (a, b) => { const s = Math.abs(a) + Math.abs(b); return s > 0 ? (a - b) / s : 0; };
const pctTxt = (x) => (Number.isFinite(x) ? Math.round(100 * x) + '%' : '—');

module.exports = { AXES, PHASE_P25, styleVectors, archetypeOf, matchup, phaseMass, rareForPhase, distribution, pct };
