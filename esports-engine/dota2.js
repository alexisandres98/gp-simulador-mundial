// esports-engine/dota2.js — DOTA 2 (16-ago).
//
// EL PARECIDO CON LoL TAMBIÉN ES UNA TRAMPA. Los dos son MOBA, los dos tienen un solo mapa, draft, y se
// ganan tirando la estructura del rival. Pero el comportamiento estadístico es distinto en tres sitios que
// afectan directamente a los derivados, que es donde GP apuesta:
//
//   1. **LAS PARTIDAS SON MUCHO MÁS LARGAS Y CON MUCHÍSIMA MÁS COLA.** Una partida profesional de LoL se
//      mueve en 28-34 minutos con cola a 45; una de Dota vive en 32-42 y tiene una cola real que llega a los
//      70+. Esa cola no es una anécdota: es lo que hace que el mercado de duración de Dota sea distinto y
//      que un modelo lognormal con la sigma de LoL se quede corto de forma sistemática.
//   2. **NO HAY RENDICIÓN.** En LoL una partida perdida se cierra pronto. En Dota se juega hasta el final,
//      y eso alarga la cola por abajo tanto como el comeback la alarga por arriba.
//   3. **BUYBACK Y ROSHAN CONVIERTEN VENTAJAS EN REVERSIBLES.** La ventaja de oro no es monótona: el aegis
//      y el buyback permiten que un equipo que va perdiendo por 20k gane una pelea y cierre. Traducido a
//      modelo: la probabilidad condicional a "va ganando en el minuto 30" es MENOS extrema que en LoL, y
//      cualquier derivado que asuma monotonía se equivoca en la cola.
//
// ── LO QUE HOY NO SE PUEDE ────────────────────────────────────────────────────────────────────────────────
// Medido el 16-ago: un solo evento con fixtures y sin mercados abiertos en la franja mirada. Este motor está
// completo y a la espera de precio. Los datos de partida (OpenDota / Valve WebAPI) son públicos y son la
// primera integración que este juego debe recibir; hasta entonces las constantes son perfiles de circuito y
// están marcadas como tales, no como mediciones de GP.
'use strict';

const C = require('./core');

const GAME = {
  key: 'dota2', label: 'Dota 2', short: 'DOTA',
  unit: 'partida', unit_plural: 'partidas', default_bo: 3,
  families: ['SERIE', 'MAPA', 'HANDICAP', 'TOTAL_MAPAS', 'MARCADOR', 'KILLS'],
  edge_families: ['TOTAL_MAPAS', 'HANDICAP', 'KILLS'],
  native: ['Draft de 24 fases', 'Roshan y aegis', 'Buyback', 'Duración de cola larga'],
};

// ---- 1) RITMO POR CIRCUITO -------------------------------------------------------------------------------
// Igual que en LoL el ritmo es regional, pero en Dota la variable dominante es el TIER del torneo: un Major
// se juega más cerrado que una liga regional. Perfiles declarados como supuesto, no como medición.
const TEMPO = {
  TI:       { kpm: 1.28, minutes: 38.5, label: 'The International — el más largo y más cerrado del año' },
  MAJOR:    { kpm: 1.34, minutes: 37.0, label: 'Major / torneo de tier 1' },
  DPC_EU:   { kpm: 1.42, minutes: 36.0, label: 'Europa Occidental — la región más agresiva' },
  DPC_CN:   { kpm: 1.24, minutes: 39.5, label: 'China — juego lento y de ventaja acumulada' },
  DPC_SEA:  { kpm: 1.56, minutes: 34.5, label: 'Sudeste asiático — caos y partidas cortas' },
  DPC_SA:   { kpm: 1.52, minutes: 35.0, label: 'Sudamérica — peleas desde el minuto uno' },
  DEFAULT:  { kpm: 1.38, minutes: 37.0, label: 'referencia global cuando el torneo no está perfilado' },
};
const TEMPO_NOTE = 'perfiles de ritmo por circuito declarados como SUPUESTO de arranque, no como medición propia. OpenDota es público y es la primera integración pendiente de este juego: en cuanto entre, cada fila se sustituye por la medida con encogimiento por muestra.';
function tempoOf(competition) {
  const s = String(competition || '').toUpperCase();
  if (/INTERNATIONAL|\bTI\b/.test(s)) return { ...TEMPO.TI, tier: 'TI', measured: false };
  if (/MAJOR|ESL|RIYADH|BLAST/.test(s)) return { ...TEMPO.MAJOR, tier: 'MAJOR', measured: false };
  if (/EU|EUROPE|WEU/.test(s)) return { ...TEMPO.DPC_EU, tier: 'EU', measured: false };
  if (/CHINA|\bCN\b/.test(s)) return { ...TEMPO.DPC_CN, tier: 'CN', measured: false };
  if (/SEA|ASIA/.test(s)) return { ...TEMPO.DPC_SEA, tier: 'SEA', measured: false };
  if (/SOUTH AMERICA|\bSA\b|BRAZIL|PERU/.test(s)) return { ...TEMPO.DPC_SA, tier: 'SA', measured: false };
  return { ...TEMPO.DEFAULT, tier: null, measured: false };
}
const PRIOR_GAMES = 25;
function calibrateTempo(base, observed) {
  if (!observed || !(observed.games > 0)) return { ...base, measured: false, games: 0 };
  const w = observed.games / (observed.games + PRIOR_GAMES);
  return {
    kpm: C.r3(base.kpm * (1 - w) + observed.kpm * w),
    minutes: C.r2(base.minutes * (1 - w) + observed.minutes * w),
    label: base.label, tier: base.tier, measured: w > 0.35, games: observed.games, weight_observed: C.r3(w),
  };
}

// ---- 2) DRAFT (el más largo de los cuatro juegos) -------------------------------------------------------
// 24 fases entre bans y picks sobre un pool de 120+ héroes. Es una diferencia cualitativa con LoL, no de
// grado: con ese pool, la profundidad de héroes de un equipo es un rasgo medible y la sorpresa de draft es
// una jugada estratégica real, no una anécdota. El lado (Radiant/Dire) también decide orden de draft.
const SIDE_EDGE = 0.021;  // Radiant gana ligeramente más en circuito profesional
const DRAFT_PHASES = [
  { key: 'ban1', label: 'Primera fase de bans', note: 'se quita lo que rompe el parche antes de mirar al rival' },
  { key: 'pick1', label: 'Primeros picks', note: 'los héroes flexibles: no revelar posición es media ventaja' },
  { key: 'ban2', label: 'Segunda fase de bans', note: 'aquí ya se banea a JUGADORES, no a héroes: la señature del rival' },
  { key: 'pick2', label: 'Picks intermedios', note: 'se cierran los emparejamientos de línea' },
  { key: 'ban3', label: 'Última fase de bans', note: 'la respuesta concreta a lo que ya está sobre la mesa' },
  { key: 'pick3', label: 'Últimos picks', note: 'el contra-pick: quien elige último gana el emparejamiento y pierde el tempo' },
];
function draftModel({ tempo }) {
  return {
    phases: DRAFT_PHASES,
    pool_note: 'más de 120 héroes: el draft de Dota es el más profundo de los cuatro juegos y por eso la profundidad de repertorio de un equipo es un rasgo con señal propia — el que no puede jugar cinco estilos se lee en el draft.',
    side: 'Radiant tiene ventaja estructural pequeña (mejor visión del río y del campamento); Dire tiene mejor acceso al Roshan tardío',
    tempo_link: `en este circuito se corre a ${tempo.kpm} kills por minuto de referencia (${tempo.label}), lo que empuja el draft hacia ${tempo.kpm >= 1.45 ? 'peleas desde la fase de líneas' : tempo.kpm <= 1.28 ? 'héroes de escalado y ventaja acumulada' : 'un equilibrio entre línea y escalado'}`,
    missing: 'las tasas de ban/pick por héroe y equipo salen de OpenDota, que es público y todavía no está integrado. No se inventan.',
  };
}
function sideModel(pBase) {
  if (pBase == null) return null;
  return {
    radiant_p: C.r4(C.clamp01(pBase + SIDE_EDGE)), dire_p: C.r4(C.clamp01(pBase - SIDE_EDGE)),
    edge_pp: C.r2(SIDE_EDGE * 200),
    note: 'Radiant conserva una ventaja pequeña y persistente en el circuito profesional. En una serie los lados se alternan y se compensa en parte, pero no del todo.',
  };
}

// ---- 3) DURACIÓN DE COLA LARGA (la diferencia técnica con LoL) ------------------------------------------
// Lognormal con sigma mayor y suelo más alto. Y una corrección que LoL no lleva: el desequilibrio acorta
// MENOS que en LoL, porque en Dota no hay rendición y una partida perdida se sigue jugando.
function durationModel(pMap, tempo, { sims = 20000, seed = 61 } = {}) {
  const gap = Math.abs(pMap - 0.5) * 2;
  const mu = Math.log(tempo.minutes * (1 - 0.09 * gap));   // 9 %, frente al 16 % de LoL: aquí no hay rendición
  const sigma = 0.26 + 0.05 * (1 - gap);                   // cola más gorda que LoL (0.20)
  const rnd = C.rng(seed);
  const arr = [];
  for (let i = 0; i < sims; i++) {
    const u1 = Math.max(1e-9, rnd()), u2 = rnd();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    arr.push(C.clamp(Math.exp(mu + sigma * z), 20, 85));
  }
  arr.sort((a, b) => a - b);
  const q = (p) => C.r2(arr[Math.min(arr.length - 1, Math.floor(p * arr.length))]);
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const totals = {};
  for (const line of [32.5, 35.5, 38.5, 41.5, 44.5]) {
    totals['over_' + String(line).replace('.', '_')] = C.r4(arr.filter((x) => x > line).length / arr.length);
  }
  return {
    mean_min: C.r2(mean), p10: q(0.10), p50: q(0.50), p90: q(0.90), p99: q(0.99),
    totals,
    tempo_used: { tier: tempo.tier, kpm: tempo.kpm, base_min: tempo.minutes, measured: !!tempo.measured },
    note: 'la cola de Dota es real y no ruido: sin rendición, una partida perdida se sigue jugando, y buyback y aegis devuelven partidas que en LoL ya estarían cerradas. Un modelo con la sigma de LoL se queda corto justo donde vive el mercado de duración.',
    sims,
  };
}

// ---- 4) ROSHAN Y BUYBACK: LA NO-MONOTONÍA ---------------------------------------------------------------
// Esto es lo que en el resto de deportes de GP sería "el partido no está cerrado hasta que lo está", pero
// aquí con mecánica concreta detrás. Se publica como probabilidad de reversión condicionada a la ventaja,
// porque es lo que un derivado necesita saber y lo que un modelo monótono no da.
function comebackModel(pMap, duration) {
  const m = duration.mean_min;
  const roshans = C.r2(Math.max(0, (m - 15) / 11));   // primero ~min 15-18, luego cada ~11 min con aegis
  // La reversibilidad decae con el tiempo pero nunca llega a cero mientras haya buyback y aegis en juego.
  const rows = [10, 20, 30, 40].map((t) => ({
    minute: t,
    reversal_p: C.r3(C.clamp(0.42 * Math.exp(-t / 34) + 0.06, 0.05, 0.45)),
    note: t <= 20 ? 'ventaja temprana: casi no cierra nada por sí sola'
      : t <= 30 ? 'con aegis en juego, una sola pelea perdida devuelve la partida'
      : 'con buybacks gastados, aquí sí la ventaja empieza a ser definitiva',
  }));
  return {
    roshan_expected: roshans,
    reversal_curve: rows,
    aegis: 'el aegis convierte una pelea perdida en una pelea empatada: es la razón mecánica de que la ventaja de oro en Dota no sea monótona',
    buyback: 'mientras el equipo que va perdiendo conserva buybacks, ningún push es definitivo; cuando los gasta, el siguiente error cierra la partida',
    note: 'curva de reversión declarada como estructura del juego, no medida sobre partidas de GP. Es exactamente la clase de cifra que hay que recalibrar con OpenDota antes de apoyar una pick en ella.',
  };
}

// ---- 5) KILLS ---------------------------------------------------------------------------------------------
// Dota tiene mucho más kill por minuto que LoL (1,3-1,5 frente a 0,6-1,0) y el total es un mercado que en
// algunas casas sí abre. Misma cadena que en LoL —ritmo × duración— pero con dos diferencias: la cola de
// duración pesa mucho más en el total, y el desequilibrio calienta menos el ritmo (sin rendición, la parte
// final de una paliza es de limpieza lenta, no de masacre).
function killsModel(pMap, tempo, duration, { sims = 20000, seed = 67 } = {}) {
  const gap = Math.abs(pMap - 0.5) * 2;
  const kpm = tempo.kpm * (1 + 0.07 * gap);
  const rnd = C.rng(seed);
  const shBase = C.clamp(0.5 + (pMap - 0.5) * 0.66, 0.26, 0.74);
  const tot = [], ka = [], kb = [], marg = [];
  for (let i = 0; i < sims; i++) {
    const u1 = Math.max(1e-9, rnd()), u2 = rnd();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const mins = C.clamp(Math.exp(Math.log(duration.mean_min) + 0.27 * z), 20, 85);
    const lam = kpm * mins * (0.88 + 0.26 * rnd());
    const u3 = Math.max(1e-9, rnd()), u4 = rnd();
    const z2 = Math.sqrt(-2 * Math.log(u3)) * Math.cos(2 * Math.PI * u4);
    const k = Math.max(0, Math.round(lam + Math.sqrt(lam) * z2));
    tot.push(k);
    // el reparto en Dota es MENOS estable que en LoL: con aegis y buyback una sola pelea cambia el saldo
    const u5 = Math.max(1e-9, rnd()), u6 = rnd();
    const zs = Math.sqrt(-2 * Math.log(u5)) * Math.cos(2 * Math.PI * u6);
    const sh = C.clamp(shBase + 0.10 * zs, 0.14, 0.86);
    const a = Math.round(k * sh);
    ka.push(a); kb.push(k - a); marg.push(a - (k - a));
  }
  const srt = tot.slice().sort((a, b) => a - b);
  const mean = tot.reduce((a, b) => a + b, 0) / tot.length;
  const totals = {};
  for (const line of [42.5, 46.5, 50.5, 54.5, 58.5]) {
    totals['over_' + String(line).replace('.', '_')] = C.r4(srt.filter((x) => x > line).length / srt.length);
  }
  const q = (p) => srt[Math.min(srt.length - 1, Math.floor(p * srt.length))];
  return {
    mean_kills: C.r2(mean), p10: q(0.10), p50: q(0.50), p90: q(0.90),
    kpm_used: C.r3(kpm), share_a: C.r3(ka.reduce((a, b) => a + b, 0) / Math.max(1, tot.reduce((a, b) => a + b, 0))),
    team_a_mean: C.r2(ka.reduce((a, b) => a + b, 0) / ka.length),
    team_b_mean: C.r2(kb.reduce((a, b) => a + b, 0) / kb.length),
    totals,
    dist: { total: C.histOf(tot), home: C.histOf(ka), away: C.histOf(kb), margin: C.histOf(marg) },
    chain: [
      { step: 'ritmo del circuito', value: `${tempo.kpm} kills/min`, from: tempo.measured ? 'histórico propio' : 'perfil de circuito' },
      { step: 'ajuste por desequilibrio', value: `×${C.r3(1 + 0.07 * gap)}`, from: 'menor que en LoL: sin rendición, el final de una paliza es lento' },
      { step: 'duración esperada', value: `${duration.mean_min} min`, from: 'modelo de duración de cola larga' },
      { step: 'total esperado', value: `${C.r2(mean)} kills`, from: 'simulación' },
    ],
    note: 'en Dota el total de kills lo domina la DURACIÓN, no el desequilibrio: por eso la cola gorda del modelo de duración se nota más aquí que en cualquier otro derivado del juego.',
    sims,
  };
}

// ---- 6) LO QUE IMPORTA -----------------------------------------------------------------------------------
function whatMatters({ anchored, tempo, duration, kills, comeback, unc, bo }) {
  const out = [];
  if (duration) out.push({ rank: 1, pp: null, driver: 'duración',
    text: `Duración esperada ${duration.mean_min} min, con el 80 % entre ${duration.p10} y ${duration.p90} y una cola real hasta ${duration.p99}. Esa cola es la firma de Dota y es lo que separa este modelo del de LoL.` });
  out.push({ rank: 2, pp: null, driver: 'ritmo',
    text: `${tempo.label}: ${tempo.kpm} kills por minuto de referencia${tempo.measured ? ' (medido)' : ' (perfil de circuito, sin muestra propia todavía)'}.` });
  if (kills) out.push({ rank: 3, pp: null, driver: 'kills',
    text: `Total esperado ${kills.mean_kills} kills. Aquí lo que manda es la duración, no quién es mejor.` });
  if (comeback) out.push({ rank: 4, pp: null, driver: 'reversión',
    text: `Con aegis y buyback en juego, una ventaja en el minuto 30 todavía se revierte un ${Math.round(100 * comeback.reversal_curve[2].reversal_p)}% de las veces. Cualquier derivado que asuma que la ventaja es definitiva se equivoca en la cola.` });
  if (unc) out.push({ rank: 5, pp: unc.epistemic_pp, driver: 'incertidumbre',
    text: `Lo que GP no sabe vale ±${unc.epistemic_pp} pp. OpenDota es público y es la primera integración pendiente: hasta que entre, el ritmo y la duración son supuestos de circuito.` });
  return out.slice(0, 5);
}

// ---- 7) FACHADA ------------------------------------------------------------------------------------------
function analyze({ market, ratings, bo = 3, sample = 0, competition = null, observedTempo = null }) {
  const bookRows = (market && market.markets) || [];
  // El ancla NO es solo la familia `SERIE`: la mayoría de partidos con mercado abierto no la cotizan y sí
  // cotizan marcador, hándicap o ganador de mapa. `marketAnchor` recorre esas fuentes en orden y dice de
  // cuál salió — ver la nota larga en core.js.
  const anchor = C.marketAnchor(bookRows, bo);
  const cons = anchor ? anchor.market : null;
  const marketP = anchor ? anchor.p : null;

  const modelP = ratings && ratings.elo_a != null && ratings.elo_b != null
    ? C.eloProbability(ratings.elo_a, ratings.elo_b) : null;
  const anchored = C.anchoredProbability(marketP, modelP, { n: sample });
  const pSeries = anchored ? anchored.p : null;
  const pMap = pSeries != null ? C.seriesToMap(pSeries, bo) : null;

  const tempo = calibrateTempo(tempoOf(competition), observedTempo);
  const duration = pMap != null ? durationModel(pMap, tempo) : null;
  const kills = (pMap != null && duration) ? killsModel(pMap, tempo, duration) : null;
  const comeback = (pMap != null && duration) ? comebackModel(pMap, duration) : null;

  const unc = C.uncertainty({
    p: pSeries != null ? pSeries : 0.5, sampleMatches: sample,
    marketBooks: cons ? cons.books : 0,
    missing: [].concat(tempo.measured ? [] : ['ritmo medido del circuito'], ['histórico de draft', 'datos de partida (OpenDota)']),
  });

  const sim = pMap != null ? C.simulateSeries(pMap, bo) : null;

  return {
    game: 'dota2', bo, competition,
    probability: anchored, market: cons, market_anchor: anchor ? { from: anchor.from, family: anchor.family, direct: anchor.direct, p_map: anchor.p_map != null ? anchor.p_map : null } : null, simulation: sim,
    side: sideModel(pMap), draft: draftModel({ tempo }),
    tempo: { ...tempo, note: TEMPO_NOTE },
    duration, kills, comeback,
    uncertainty: unc,
    what_matters: whatMatters({ anchored, tempo, duration, kills, comeback, unc, bo }),
    native: GAME.native, edge_families: GAME.edge_families,
  };
}

module.exports = { GAME, TEMPO, TEMPO_NOTE, tempoOf, calibrateTempo, sideModel, draftModel, durationModel, comebackModel, killsModel, whatMatters, analyze };
