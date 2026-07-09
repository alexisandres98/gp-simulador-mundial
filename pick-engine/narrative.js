// pick-engine/narrative.js — NARRATIVA MULTI-FACTOR por pick (PURO, sin I/O). Caja negra estricta.
// Convierte FACTORES estructurados (que el server ensambla desde style-engine, balón parado, observer,
// player-intel y el modelo) en 1-3 frases ES/EN que explican POR QUÉ existe la pick, al nivel de un analista:
// "Proyección elevada por 78 minutos esperados, más remates en sus últimos partidos, rival vulnerable por
// la vía aérea y rol en balón parado" — nunca "un modelo Monte Carlo dice X" ni fuentes.
// Regla de composición: máx 4 factores, ordenados por peso; sin probabilidades crudas del modelo en el texto
// (el público ve confianza, no model%). Sin rayitas.
'use strict';

const pct = x => Math.round(Number(x) * 100);

// Cada factor: { code, w (peso para ordenar), ...datos }. Texto por código y por idioma.
const T = {
  // ── Jugador ────────────────────────────────────────────────────────────────────────────────────────────
  PLAYER_MINUTES: {
    es: f => `${f.minutes} minutos esperados como titular`,
    en: f => `${f.minutes} expected minutes as a starter`,
  },
  PLAYER_CONFIRMED: {
    es: () => 'titularidad confirmada en la alineación oficial',
    en: () => 'starting role confirmed in the official lineup',
  },
  PLAYER_FORM: {
    es: f => f.elite ? 'producción de élite sostenida en el torneo' : 'produce por encima de lo típico de su posición',
    en: f => f.elite ? 'elite output sustained through the tournament' : 'output above the norm for his position',
  },
  PLAYER_FINISHING_HOT: {
    es: () => 'llega convirtiendo por encima de lo que genera (definición caliente)',
    en: () => 'converting above what he creates lately (hot finishing)',
  },
  PLAYER_SET_PIECE: {
    es: f => `ejecuta ${f.roles.join(' y ')} de su selección`,
    en: f => `takes his team's ${f.rolesEn.join(' and ')}`,
  },
  PLAYER_TEAM_ATTACK: {
    es: () => 'el volumen ofensivo proyectado de su equipo para este cruce está al alza',
    en: () => 'his team\'s projected attacking volume for this matchup is elevated',
  },
  PLAYER_ATTACK_SHARE: {
    es: f => `concentra cerca del ${f.share}% del peligro de su equipo`,
    en: f => `accounts for roughly ${f.share}% of his team's threat`,
  },
  RIVAL_DEFENSE_WEAK_AIR: {
    es: f => `${f.rival_es} concede una parte alta de su peligro por la vía aérea`,
    en: f => `${f.rival_en} concedes an outsized share of danger in the air`,
  },
  RIVAL_ABSENCE_DEF: {
    es: f => `la baja de ${f.name} debilita la defensa rival`,
    en: f => `${f.name}'s absence weakens the opposing defense`,
  },
  // ── Córners ────────────────────────────────────────────────────────────────────────────────────────────
  CORNER_THREAT: {
    es: f => `${f.team_es} genera el ${f.share}% de su peligro desde córners (top del torneo)`,
    en: f => `${f.team_en} generates ${f.share}% of its threat from corners (top of the tournament)`,
  },
  CORNER_CONCEDE: {
    es: f => `${f.team_es} concede por esa misma vía`,
    en: f => `${f.team_en} concedes through that same route`,
  },
  CORNER_VOLUME: {
    es: f => `promedian ${f.total} córners combinados por partido en el torneo`,
    en: f => `they average ${f.total} combined corners per match in the tournament`,
  },
  CORNER_LOW_VOLUME: {
    es: f => `los dos llegan con volúmenes bajos de córners (${f.total} combinados por partido)`,
    en: f => `both arrive with low corner volume (${f.total} combined per match)`,
  },
  // ── Tarjetas ───────────────────────────────────────────────────────────────────────────────────────────
  CARDS_TEAMS_HOT: {
    es: f => `entre ambos promedian ${f.total} tarjetas y ${f.fouls} faltas por partido`,
    en: f => `combined they average ${f.total} cards and ${f.fouls} fouls per match`,
  },
  CARDS_TEAMS_COLD: {
    es: f => `son dos equipos disciplinados (${f.total} tarjetas combinadas por partido)`,
    en: f => `both sides are disciplined (${f.total} combined cards per match)`,
  },
  PHASE_KO_CARDS: {
    es: () => 'la fase eliminatoria eleva la fricción respecto de la fase de grupos',
    en: () => 'knockout football runs hotter than the group stage',
  },
  PARITY: {
    es: () => 'el cruce se proyecta parejo, y los partidos cerrados suben la intensidad',
    en: () => 'the matchup projects tight, and close games raise the temperature',
  },
  // ── Goles ──────────────────────────────────────────────────────────────────────────────────────────────
  GOALS_VOLUME_BOTH: {
    es: f => `los dos generan volumen (${f.h} y ${f.a} xG por partido en el torneo)`,
    en: f => `both create volume (${f.h} and ${f.a} xG per match this tournament)`,
  },
  GOALS_ATTACK_VS_LEAKY: {
    es: f => `${f.team_es} genera ${f.xg} xG por partido contra una defensa que viene concediendo`,
    en: f => `${f.team_en} creates ${f.xg} xG per match against a defense that has been conceding`,
  },
  GOALS_DEFENSES_TIGHT: {
    es: () => 'las dos defensas llegan sólidas, el guion apunta a un partido de pocas concesiones',
    en: () => 'both defenses arrive solid, the script points to few concessions',
  },
  COUNTER_GAME: {
    es: f => `${f.team_es} lastima a la contra y el rival concede en transiciones`,
    en: f => `${f.team_en} hurts on the break and the opponent concedes in transitions`,
  },
  // ── Ganador / general ──────────────────────────────────────────────────────────────────────────────────
  MARKET_ANCHOR: {
    es: f => `el mercado lo tiene favorito con consenso de ${f.books} casas y el sistema respalda la dirección`,
    en: f => `the market makes them favorite across ${f.books} books and the system backs the direction`,
  },
  MODEL_AGREES_UP: {
    es: () => 'la lectura del sistema es incluso mejor que el precio',
    en: () => 'the system reads it even better than the price implies',
  },
  SOLID_DEFENSE_BASE: {
    es: f => `${f.team_es} casi no concede en el torneo (${f.xga} xG en contra por partido)`,
    en: f => `${f.team_en} concedes almost nothing this tournament (${f.xga} xG against per match)`,
  },
  PRICE_ABOVE_FAIR: {
    es: () => 'la mejor cuota disponible paga por encima de la probabilidad justa del consenso',
    en: () => 'the best available price pays above the consensus fair probability',
  },
  AVAIL_CAVEAT: {
    es: f => `ojo: ${f.name} aparece con señales de duda en la previa`,
    en: f => `watch: ${f.name} shows doubt signals in the buildup`,
  },
};

// Compone la narrativa: ordena por peso, toma hasta 4, arma 1-2 frases. Devuelve { es, en } o null.
function compose(factors) {
  const list = (factors || []).filter(f => f && T[f.code]).sort((a, b) => (b.w || 0) - (a.w || 0));
  if (!list.length) return null;
  const caveats = list.filter(f => f.code === 'AVAIL_CAVEAT');
  const main = list.filter(f => f.code !== 'AVAIL_CAVEAT').slice(0, 4);
  if (!main.length) return null;
  const render = lang => {
    const parts = main.map(f => T[f.code][lang](f));
    let s = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    if (parts.length > 1) s += (lang === 'es' ? '; ' : '; ') + parts.slice(1).join('; ');
    s += '.';
    if (caveats.length) s += ' ' + T.AVAIL_CAVEAT[lang](caveats[0]).charAt(0).toUpperCase() + T.AVAIL_CAVEAT[lang](caveats[0]).slice(1) + '.';
    return s;
  };
  return { es: render('es'), en: render('en') };
}

module.exports = { compose, _templates: T, pct };
