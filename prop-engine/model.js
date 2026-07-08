// prop-engine/model.js — Fase PROPS P1 (córners + tarjetas). PURO: sin DB, sin red, sin flags.
// Diseño (research 4-jul): Binomial Negativa a nivel equipo con fuerzas multiplicativas for/against +
// shrinkage bayesiano (muestras chicas: 4-6 partidos por equipo en un Mundial), multiplicador de ÁRBITRO
// en tarjetas (shrunk + tope ±20%), y acople opcional al GAME STATE vía las λ de goles del modelo GP
// (equipo que ataca más → más córners; partido parejo → más tarjetas).
// "Tarjetas" = conteo simple amarillas + rojas (definición del mercado estándar "total cards").
// Los partidos AET/PEN del dataset se EXCLUYEN del ajuste (sus stats incluyen prórroga → no son 90' limpios).
'use strict';
const { nbPmf } = require('../goal-engine/negativeBinomial');

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const variance = a => { if (a.length < 2) return 0; const mu = mean(a); return a.reduce((s, x) => s + (x - mu) * (x - mu), 0) / (a.length - 1); };

// Dispersión NB por método de momentos: var = μ + μ²/r → r = μ²/(var−μ). var≤μ → sin sobredispersión (r grande ≈ Poisson).
function fitDispersion(samples, { min = 2, max = 400 } = {}) {
  const mu = mean(samples), va = variance(samples);
  if (!(va > mu) || mu <= 0) return max;
  return clamp((mu * mu) / (va - mu), min, max);
}

// ── Ajuste de liga + equipos + árbitros desde el dataset (data/props-history.json → matches) ────────────────
// PRIOR_MATCHES: peso del prior de liga en "partidos equivalentes" (shrinkage). REF_PRIOR: ídem para árbitros.
// TOTALS_DAMP: cuánta señal de equipos conserva el TOTAL del partido (0 = media de liga pura, 1 = suma de los
// equipos). Los córners/tarjetas de ambos lados están negativamente correlacionados (la posesión y las faltas
// se reparten) → a nivel TOTAL las fuerzas individuales aportan más ruido que señal. CALIBRADO POR LOO EN EL
// MUNDIAL 2026: el óptimo es 0 (total = media de liga; con damp>0 el Brier empeora monótonamente — con 4-6
// partidos por equipo no hay señal de equipo a nivel total). Árbitro y paridad NO se amortiguan (multiplican
// el total completo). Los mercados POR EQUIPO usan la señal completa (skill LOO +0.022 vs baseline).
// RE-TUNEAR con datos de clubes post-Mundial (30+ partidos por equipo → DAMP>0 probablemente gane).
// PHASE_PRIOR: peso (en partidos equivalentes) del shrinkage de los multiplicadores POR FASE. La media de
// liga NO es estática: la eliminatoria de este Mundial trae más córners (10.0 vs 8.7) y más tarjetas (3.07
// vs 2.61) que la fase de grupos, y el mercado lo cotiza. fit() APRENDE ese multiplicador de los propios
// datos (nada hardcodeado) con shrinkage a 1 por muestra chica. DISEÑO MULTI-COMPETICIÓN (post-Mundial):
// cada dataset/competición hace su propio fit y sus fases se etiquetan libres (m.phase: 'regular'|'playoff'|
// 'group'|'knockout'|...) → el mismo código escala a decenas de torneos simultáneos sin tocar nada.
const DEFAULTS = { PRIOR_MATCHES: 4, REF_PRIOR: 14, REF_CLAMP: 0.2, GAME_STATE_WEIGHT: 0.5, GS_CLAMP: 0.25, TOTALS_DAMP: 0, PHASE_PRIOR: 10 };

// Fase de un partido del dataset: etiqueta explícita m.phase, o derivada del nombre de ronda.
function phaseOf(m) { return m.phase || (/group|grupo|apertura|regular/i.test(m.round || '') ? 'group' : 'knockout'); }

function fit(matches, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts);
  const ft = matches.filter(m => !m.et && m.home.corners != null && m.away.corners != null);
  const perTeam = {};   // code → { n, cornersFor[], cornersAg[], cardsFor[], cardsDrawn[] }
  const perRef = {};    // referee → { n, cards[] }
  const perPhase = {};  // fase → { corners:[], cards:[] } (para multiplicadores aprendidos)
  const totCorners = [], totCards = [], teamCorners = [], teamCards = [];
  for (const m of ft) {
    const hc = m.home.corners, ac = m.away.corners;
    const hk = (m.home.yellows || 0) + (m.home.reds || 0), ak = (m.away.yellows || 0) + (m.away.reds || 0);
    totCorners.push(hc + ac); totCards.push(hk + ak);
    teamCorners.push(hc, ac); teamCards.push(hk, ak);
    const ph = perPhase[phaseOf(m)] || (perPhase[phaseOf(m)] = { corners: [], cards: [] });
    ph.corners.push(hc + ac); ph.cards.push(hk + ak);
    for (const [side, opp, c, k, oppK] of [['home', 'away', hc, hk, ak], ['away', 'home', ac, ak, hk]]) {
      const t = perTeam[m[side].code] || (perTeam[m[side].code] = { n: 0, cornersFor: [], cornersAg: [], cardsFor: [], cardsDrawn: [] });
      t.n++; t.cornersFor.push(c); t.cornersAg.push(m[opp].corners); t.cardsFor.push(k); t.cardsDrawn.push(oppK);
    }
    if (m.referee) { const r = perRef[m.referee] || (perRef[m.referee] = { n: 0, cards: [] }); r.n++; r.cards.push(hk + ak); }
  }
  const league = {
    teamCornersMean: mean(teamCorners),            // media de córners POR EQUIPO por partido
    teamCardsMean: mean(teamCards),
    totalCornersMean: mean(totCorners), totalCardsMean: mean(totCards),
    rCornersTotal: fitDispersion(totCorners),
    rCardsTotal: fitDispersion(totCards),
    rCornersTeam: fitDispersion(teamCorners),
    rCardsTeam: fitDispersion(teamCards),
    matches: ft.length,
    phaseMult: {},                                 // fase → multiplicador aprendido (shrunk a 1)
  };
  for (const ph in perPhase) {
    const s = perPhase[ph];
    const w = s.corners.length / (s.corners.length + cfg.PHASE_PRIOR);
    league.phaseMult[ph] = {
      corners: +(1 + w * (mean(s.corners) / (league.totalCornersMean || 1) - 1)).toFixed(4),
      cards: +(1 + w * (mean(s.cards) / (league.totalCardsMean || 1) - 1)).toFixed(4),
      n: s.corners.length,
    };
  }
  // Fuerzas por equipo con shrinkage al prior de liga: ratio = (k·μ_liga + Σx) / (k + n) / μ_liga
  const K = cfg.PRIOR_MATCHES;
  const teams = {};
  for (const code in perTeam) {
    const t = perTeam[code];
    const sh = (arr, mu) => ((K * mu + arr.reduce((x, y) => x + y, 0)) / (K + arr.length)) / (mu || 1);
    teams[code] = {
      n: t.n,
      cornersForRatio: sh(t.cornersFor, league.teamCornersMean),
      cornersAgainstRatio: sh(t.cornersAg, league.teamCornersMean),
      cardsForRatio: sh(t.cardsFor, league.teamCardsMean),
      cardsDrawnRatio: sh(t.cardsDrawn, league.teamCardsMean),
    };
  }
  // Multiplicador de árbitro (solo tarjetas): shrunk al total de liga y CLAMPEADO ±20% (research: efecto real
  // del árbitro ±20%; con ~2 partidos por árbitro en un Mundial, el shrinkage evita sobreajustar).
  const refs = {};
  for (const name in perRef) {
    const r = perRef[name];
    const shrunk = (cfg.REF_PRIOR * league.totalCardsMean + r.cards.reduce((x, y) => x + y, 0)) / (cfg.REF_PRIOR + r.n);
    refs[name] = { n: r.n, mult: clamp(shrunk / (league.totalCardsMean || 1), 1 - cfg.REF_CLAMP, 1 + cfg.REF_CLAMP) };
  }
  return { league, teams, refs, cfg };
}

// ── Proyección de un partido ────────────────────────────────────────────────────────────────────────────────
// fitres = salida de fit(). home/away = códigos de equipo. Opcionales:
//   lambdas {home, away}: λ de goles del modelo GP → acople al game state.
//   referee: nombre exacto del árbitro (dataset) → multiplicador de tarjetas.
//   closeness1x2 {home, draw, away}: probs 1X2 del modelo → partido parejo sube tarjetas (hasta ±10%).
function project(fitres, { home, away, lambdas = null, referee = null, closeness1x2 = null, phase = null } = {}) {
  const { league, teams, refs, cfg } = fitres;
  const T = code => teams[code] || { cornersForRatio: 1, cornersAgainstRatio: 1, cardsForRatio: 1, cardsDrawnRatio: 1, n: 0 };
  const th = T(home), ta = T(away);
  // Multiplicador de FASE aprendido del dataset (grupos vs eliminatoria; post-Mundial: regular vs playoff,
  // etc.). Sin fase o fase desconocida → 1 (compat total con calibraciones existentes).
  const pm = (phase && league.phaseMult && league.phaseMult[phase]) || null;
  const phCorners = pm ? pm.corners : 1, phCards = pm ? pm.cards : 1;

  // game state (córners): dominio esperado en ataque → más córners. Exponente 0.5, clamp ±25%.
  const LEAGUE_LAMBDA = 1.4;
  const gs = side => {
    if (!lambdas || !(lambdas[side] > 0)) return 1;
    return clamp(Math.pow(lambdas[side] / LEAGUE_LAMBDA, cfg.GAME_STATE_WEIGHT), 1 - cfg.GS_CLAMP, 1 + cfg.GS_CLAMP);
  };
  const muCornersHome = league.teamCornersMean * th.cornersForRatio * ta.cornersAgainstRatio * gs('home');
  const muCornersAway = league.teamCornersMean * ta.cornersForRatio * th.cornersAgainstRatio * gs('away');

  // tarjetas: fuerzas × árbitro × paridad del partido (parejo → +, desparejo → −; máx ±10%).
  const refMult = (referee && refs[referee]) ? refs[referee].mult : 1;
  let closeMult = 1;
  if (closeness1x2 && closeness1x2.home != null && closeness1x2.away != null) {
    const gap = Math.abs(Number(closeness1x2.home) - Number(closeness1x2.away)); // 0 = parejísimo, ~0.6 = paliza
    closeMult = clamp(1.06 - 0.25 * gap, 0.9, 1.1);
  }
  // Fuerza base de tarjetas por equipo (SIN árbitro/paridad): el damp del total aplica solo a esta parte;
  // árbitro y paridad son señal a nivel PARTIDO y multiplican el total completo (no se amortiguan).
  const baseCardsHome = league.teamCardsMean * th.cardsForRatio * ta.cardsDrawnRatio;
  const baseCardsAway = league.teamCardsMean * ta.cardsForRatio * th.cardsDrawnRatio;
  const muCardsHome = baseCardsHome * refMult * closeMult;
  const muCardsAway = baseCardsAway * refMult * closeMult;

  // Totales con la señal de EQUIPOS amortiguada hacia la media de liga (ver TOTALS_DAMP arriba).
  const dampTotal = (rawSum, leagueMean) => leagueMean * Math.pow(rawSum / (leagueMean || 1), cfg.TOTALS_DAMP);
  return {
    home, away, phase: phase || null,
    corners: {
      home: muCornersHome * phCorners, away: muCornersAway * phCorners,
      total: dampTotal(muCornersHome + muCornersAway, league.totalCornersMean) * phCorners,
      r_total: league.rCornersTotal, r_team: league.rCornersTeam, phase_mult: phCorners,
    },
    cards: {
      home: muCardsHome * phCards, away: muCardsAway * phCards,
      total: dampTotal(baseCardsHome + baseCardsAway, league.totalCardsMean) * refMult * closeMult * phCards,
      r_total: league.rCardsTotal, r_team: league.rCardsTeam, ref_mult: refMult, close_mult: closeMult, phase_mult: phCards,
    },
    sample: { home_n: th.n, away_n: ta.n, league_matches: league.matches },
  };
}

// P(X > line) para NB(mu, r), líneas .5 (sin push). Suma hasta floor(line).
function overProbNB(mu, r, line) {
  if (!(mu > 0)) return 0;
  let under = 0;
  for (let k = 0; k <= Math.floor(line); k++) under += nbPmf(mu, r, k);
  return clamp(1 - under, 0, 1);
}

module.exports = { fit, project, overProbNB, fitDispersion, phaseOf, DEFAULTS };
