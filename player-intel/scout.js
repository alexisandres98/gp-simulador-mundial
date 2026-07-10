// player-intel/scout.js — LA CARD DE SCOUTING del jugador (PURO, sin I/O). Caja negra.
// Convierte el fit del torneo (tasas/90 con shrinkage) + event data (share aéreo) + balón parado curado en:
//   · EJES DE RADAR con percentil vs jugadores CONFIABLES de su misma posición (el radar se dibuja aparte)
//   · ARQUETIPO ganado (badge): solo si el jugador se lo ganó con números; sin etiquetas de relleno
//   · SCOUT READ: hasta 3 fortalezas + 1 limitación, narradas ES/EN sin revelar método ni fuentes
// El remate de mercado (su cuota vs la lectura GP) lo agrega la superficie que consume esto: acá solo scouting.
'use strict';

const pct = (arr, v) => {
  const s = arr.filter(x => x != null && isFinite(x));
  return s.length > 1 ? +(s.filter(x => x < v).length / (s.length - 1)).toFixed(2) : null;
};
const r2 = x => x != null ? +Number(x).toFixed(2) : null;

// Ejes del radar. aerial: { shots, headers } del event data (opcional). attackShare: 0-1 (opcional).
function buildAxes(fitres, pid, { aerial = null, attackShare = null } = {}) {
  const pl = fitres.players[pid];
  if (!pl) return null;
  const pool = Object.values(fitres.players).filter(x => x.pos === pl.pos && x.reliable);
  if (pool.length < 12) return null;
  const g90 = p => p.minutes > 0 ? (p.goals / p.minutes) * 90 : 0;
  const conv = p => g90(p) - p.xg90;                       // conversión: goles/90 sobre lo generado
  const acc = p => p.shots90 > 0.3 ? p.sot90 / p.shots90 : null; // puntería (con volumen mínimo)
  const axes = [
    { key: 'production', value: r2(pl.xg90), pct: pct(pool.map(x => x.xg90), pl.xg90) },
    { key: 'volume', value: r2(pl.shots90), pct: pct(pool.map(x => x.shots90), pl.shots90) },
    { key: 'accuracy', value: acc(pl) != null ? r2(acc(pl)) : null, pct: acc(pl) != null ? pct(pool.map(acc), acc(pl)) : null },
    { key: 'creation', value: r2(pl.xa90), pct: pct(pool.map(x => x.xa90), pl.xa90) },
    { key: 'finishing', value: r2(conv(pl)), pct: pct(pool.map(conv), conv(pl)) },
    { key: 'presence', value: pl.minutes, pct: pct(pool.map(x => x.minutes), pl.minutes) },
  ];
  if (aerial && aerial.shots >= 5) {
    axes.push({ key: 'aerial', value: +(aerial.headers / aerial.shots).toFixed(2), pct: Math.min(1, +(aerial.headers / aerial.shots / 0.5).toFixed(2)) });
  }
  if (attackShare != null && attackShare > 0) {
    axes.push({ key: 'attack_share', value: +Number(attackShare).toFixed(2), pct: Math.min(1, +(attackShare / 0.35).toFixed(2)) });
  }
  return axes.filter(a => a.pct != null);
}

// Arquetipo GANADO (primero que aplica manda; null si no se ganó ninguno — sin badges de relleno).
function archetype(fitres, pid, { axes = null, aerial = null, setPieceRoles = null } = {}) {
  const pl = fitres.players[pid];
  if (!pl || !pl.reliable) return null;
  const ax = axes || buildAxes(fitres, pid, { aerial });
  if (!ax) return null;
  const P = Object.fromEntries(ax.map(a => [a.key, a.pct]));
  const spStrong = x => x && (x.rank === 1 || (x.rank === 2 && x.confidence === 'alta'));
  const prod = ((P.production || 0) + (P.creation || 0)) / 2;
  if (prod >= 0.86 && (P.presence || 0) >= 0.5) return 'STAR';
  if ((P.finishing || 0) >= 0.85 && (P.production || 0) >= 0.6) return 'CLINICAL';
  if ((P.creation || 0) >= 0.86) return 'CREATOR';
  if (aerial && aerial.shots >= 6 && aerial.headers / aerial.shots >= 0.45) return 'AERIAL';
  if (setPieceRoles && (spStrong(setPieceRoles.penalties) || spStrong(setPieceRoles.freekicks) || spStrong(setPieceRoles.corners))) return 'SET_PIECE';
  if (pl.apps >= 3 && pl.starts / pl.apps <= 0.5 && (P.production || 0) >= 0.75 && pl.minutes >= 90) return 'SUPER_SUB';
  if ((P.presence || 0) >= 0.85 && pl.starts === pl.apps && pl.apps >= 4) return 'ENGINE';
  return null;
}

// Scout read: hasta 3 fortalezas (mejores percentiles primero) + 1 limitación (la más notoria). ES/EN.
const STRENGTHS = [
  { key: 'finishing', min: 0.8, es: 'Definición de élite: convierte por encima de lo que genera', en: 'Elite finishing: converts above what he creates' },
  { key: 'production', min: 0.8, es: 'Amenaza constante en el área: su generación de peligro está en el top de su posición', en: 'Constant box threat: his danger output sits at the top of his position' },
  { key: 'creation', min: 0.8, es: 'Creador: fabrica ocasiones para sus compañeros al nivel de los mejores de su puesto', en: 'Creator: manufactures chances for teammates at the level of the best in his role' },
  { key: 'volume', min: 0.8, es: 'Volumen de remate sobresaliente: busca el arco todo el partido', en: 'Standout shot volume: hunts the goal all match long' },
  { key: 'accuracy', min: 0.8, es: 'Puntería: una parte alta de sus remates termina entre los tres palos', en: 'Accuracy: a high share of his shots ends up on target' },
  { key: 'aerial', min: 0.9, es: 'Peligro aéreo real: buena parte de su amenaza nace de cabeza', en: 'Real aerial threat: a large share of his danger comes from headers' },
  { key: 'presence', min: 0.85, es: 'Fijo para su técnico: minutos de titular indiscutido en el torneo', en: 'A lock for his coach: undisputed starter minutes through the tournament' },
  { key: 'attack_share', min: 0.85, es: 'Concentra una parte enorme del peligro de su selección', en: 'Concentrates a huge share of his team\'s threat' },
];
const LIMITS = [
  { key: 'finishing', max: 0.18, needs: { production: 0.4 }, es: 'Definición fría: viene convirtiendo por debajo de lo que genera', en: 'Cold finishing: converting below what he creates' },
  { key: 'creation', max: 0.22, notPos: 'D', es: 'Aporte creador limitado: genera pocas ocasiones para otros', en: 'Limited creative output: generates few chances for others' },
  { key: 'production', max: 0.22, pos: 'F', es: 'Producción de área por debajo de lo típico de un delantero', en: 'Box output below what is typical for a forward' },
  { key: 'volume', max: 0.22, notPos: 'D', es: 'Poco volumen de remate: depende de pocas ocasiones', en: 'Low shot volume: depends on few chances' },
];
function scoutRead(fitres, pid, { axes = null, aerial = null, setPieceRoles = null } = {}) {
  const pl = fitres.players[pid];
  if (!pl) return null;
  const ax = axes || buildAxes(fitres, pid, { aerial });
  if (!ax) return null;
  const P = Object.fromEntries(ax.map(a => [a.key, a.pct]));
  const strengths = STRENGTHS
    .filter(s => (P[s.key] || 0) >= s.min)
    .sort((a, b) => (P[b.key] || 0) - (P[a.key] || 0))
    .slice(0, 3)
    .map(s => ({ es: s.es, en: s.en }));
  // balón parado como fortaleza extra si hay hueco (dato duro del torneo, siempre relevante)
  const spStrong = x => x && (x.rank === 1 || (x.rank === 2 && x.confidence === 'alta'));
  if (strengths.length < 3 && setPieceRoles && (spStrong(setPieceRoles.penalties) || spStrong(setPieceRoles.freekicks) || spStrong(setPieceRoles.corners))) {
    strengths.push({ es: 'Ejecutor de balón parado de su selección', en: 'Set piece taker for his national team' });
  }
  let limit = null;
  for (const l of LIMITS) {
    if (l.pos && pl.pos !== l.pos) continue;
    if (l.notPos && pl.pos === l.notPos) continue;
    if (l.needs && Object.entries(l.needs).some(([k, v]) => (P[k] || 0) < v)) continue;
    if ((P[l.key] != null) && P[l.key] <= l.max) { limit = { es: l.es, en: l.en }; break; }
  }
  if (!limit && pl.minutes < 270) limit = { es: 'Muestra corta en el torneo: lectura con cautela', en: 'Short tournament sample: read with caution' };
  return { strengths, limit };
}

// Ensamble completo para las superficies (perfil, SEO, destacados).
function buildScout(fitres, pid, opts = {}) {
  const axes = buildAxes(fitres, pid, opts);
  if (!axes) return null;
  return {
    axes,
    archetype: archetype(fitres, pid, { ...opts, axes }),
    read: scoutRead(fitres, pid, { ...opts, axes }),
  };
}

module.exports = { buildAxes, archetype, scoutRead, buildScout };
