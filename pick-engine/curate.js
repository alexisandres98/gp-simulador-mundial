// pick-engine/curate.js — Capa de SELECCIÓN del producto de picks (visión "tipster mejorado", Mundial 2026).
// PURO: sin DB, sin red. Toma probabilidad del modelo (GP) + consenso de mercado (no-vig) por evento y produce
// las picks diarias curadas en TRES familias. NO busca edge contra el mercado en 1X2 (mercado del Mundial = eficiente):
// se ANCLA al mercado (sigue la dirección del consenso, regala la mejor cuota). En GOLES sí deja liderar al modelo
// (habilidad demostrada en backtest 3/3, incluso con divergencias de 12–22pp). Las métricas/registro NO se calculan
// aquí; esto solo SELECCIONA. La publicación (auto), el feed efímero y el track record viven en otra capa.
'use strict';

// ── Parámetros de selección (calibrables) ──────────────────────────────────
const CONFIG = {
  // Anclaje (market shrinkage): peso del modelo al mezclar con el mercado. blend = α·modelo + (1−α)·mercado.
  alpha1x2: 0.25,            // 1X2: el mercado domina (eficiente). El modelo solo aporta matiz + coherencia.
  alphaGoals: 0.55,          // Goles: el modelo lidera (mejor calibrado tras floor 0.65; backtest favorable).

  // Familia SÓLIDA (1X2 anclado al mercado).
  // Coherencia por DIRECCIÓN (no magnitud): como seguimos al favorito del MERCADO, solo exigimos que el modelo
  // coincida en que ese lado es más probable que el rival. Un modelo "menos extremo" que el mercado en un favorito
  // claro (ej: Argentina 74% modelo vs 84% mercado) NO es incoherencia — es la atenuación del 1X2. Solo se rechaza
  // si el modelo apunta al OTRO lado (ej: DR Congo: mercado local favorito, modelo cree que gana el visitante).
  solidMinConfidence: 0.45,    // no presentar volados como "sólida": confianza (blend) del favorito ≥ 45%.
  solidMinBooks: 3,            // profundidad mínima de mercado.
  solidMaxOdds: 3.2,           // un "favorito" no debería pagar > 3.2 (si paga más, no es favorito claro → no sólida).

  // Familia GOLES (modelo lidera; SIN cap de divergencia por decisión de producto).
  goalsMinEdgePp: 0.03,        // edge mínimo del modelo vs consenso (3pp).
  goalsMinBooks: 3,
  goalsRequireApprovedFamily: true, // solo familias aprobadas en calibración (TOTALS/TEAM_TOTALS/WINNING_MARGIN).

  // RÉGIMEN DUAL en GOLES (17-jul, regla de Alexis validada con el backtest del historial del Mundial:
  // ancla 67%/+19% ROI, acuerdo moderado 73%/+37%, "edge fuerte" >7pp 59%/+11%; Brier mercado 0.220 <
  // modelo 0.222 → en mercados eficientes el mercado es el mejor estimador). Camino ANCLA: en mercados
  // de goles PROFUNDOS/eficientes, la pick sigue el lean claro del consenso cuando el modelo CONFIRMA
  // (coherencia, no liderazgo) y la mejor cuota no está por debajo de la justa (line shopping honesto).
  // No depende del skill del modelo de goles → no exige familyApproved (el gate viaja igual en la pick
  // para el monitoreo). OFF por default = Mundial byte-idéntico.
  goalsAnchorEnabled: false,
  goalsAnchorMinBooks: 4,           // ancla solo con mercado profundo (la eficiencia es el requisito)
  goalsAnchorMinMarketProb: 0.55,   // solo lados con lean CLARO del consenso (no volados 50/50)
  goalsAnchorMaxDivergencePp: 0.05, // el modelo debe CONFIRMAR dentro de ±5pp (si discute fuerte, fuera)
  alphaGoalsAnchor: 0.25,           // confianza de la ancla: el mercado domina (mismo espíritu que alpha1x2)

  // Familia COMBO (pata 1X2 sólida + pata goles).
  combosEnabled: true,
  comboMinConfidence: 0.28,    // confianza combinada mínima (dos patas → más baja por naturaleza).

  // Familias PROPS de EQUIPO (córners/tarjetas; modelo NB calibrado con gates approved en backtest LOO).
  propsMinEdgePp: 0.04,        // mercados más blandos que goles → exigimos 1pp más de edge.
  propsMinBooks: 3,
  propsOddsMin: 1.35, propsOddsMax: 4.6, // fuera de ese rango la línea está lejos de la media → ruido de cola.
  propsRequireFairPrice: true, // REC 2 (backtest 9-jul): no publicar si la mejor cuota está POR DEBAJO de la
  // justa del consenso no-vig (1/marketProb). Evita "favoritos mal pagados" donde el edge lo crea el modelo
  // sobreproyectando, no un precio real. Validado: sube el ROI de props sin ahogar el volumen.
  // NOTA (9-jul): SIN piso de probabilidad. Una pick de 30% de acierto a buena cuota es +EV y es producto
  // válido (el negocio son las suscripciones → necesitamos volumen de picks). No sacrificamos picks por óptica.
  alphaProps: 0.6,             // confianza = blend modelo/consenso (el modelo lidera, como en goles).

  // Familia PROPS de JUGADOR — REDISEÑADA (8-jul, decisión de Alexis): mercado hiper-eficiente → NO cazar
  // edge. Misma filosofía que la familia SÓLIDA: el mercado manda y elegimos LA OPCIÓN MÁS PROBABLE del menú
  // que cotizan las casas (blend modelo/mercado con el mercado dominando + coherencia del modelo). El diseño
  // anterior (máximo edge vs break-even) seleccionaba sistemáticamente los errores del modelo: suplentes de
  // muestra chica con titularidad asumida (caso Doué). El edge queda solo informativo.
  alphaPlayer: 0.3,            // peso del modelo en el blend (el mercado domina, como alpha1x2)
  playerMinBooks: 5,           // <5 casas = mercado fino, el precio no es un consenso confiable
  playerOddsMin: 1.4, playerOddsMax: 4.0, // ventana de producto: ni chirolas ni loterías
  playerMinProb: 0.5,          // solo picks con ≥50% de probabilidad (blend): "apuesta ganadora", no lotería
  playerMaxModelDeficitPp: 0.15, // coherencia: si el modelo está >15pp DEBAJO del mercado, no publicar
  playerDoubtBlockMiss: 0.3,   // DUDA del observer con prob_miss ≥ 30% → no publicar (se resuelve con la alineación)
};

const OUTCOME = { home: 'home', draw: 'draw', away: 'away' };
const clamp01 = x => Math.max(0, Math.min(1, x));
const blend = (model, market, alpha) => clamp01(alpha * model + (1 - alpha) * market);
const pp = x => Math.round(x * 1000) / 10; // a puntos porcentuales con 1 decimal

// ── Familia SÓLIDA: sigue la dirección del mercado, exige coherencia del modelo, regala la mejor cuota ──────
// ev.selections: { home:{model,market,bestOdds,books}, draw:{...}, away:{...} }  (market = no-vig consensus)
function solidPick(ev, cfg) {
  const sel = ev.selections || {};
  // Favorito = mayor probabilidad de MERCADO entre LOCAL y VISITANTE (el empate no es una "sólida" en singles).
  const cands = [OUTCOME.home, OUTCOME.away].filter(k => sel[k] && typeof sel[k].market === 'number');
  if (!cands.length) return null;
  const fav = cands.sort((a, b) => sel[b].market - sel[a].market)[0];
  const opp = fav === OUTCOME.home ? OUTCOME.away : OUTCOME.home; // el rival directo (para coherencia de dirección)
  const s = sel[fav];
  const books = Number(s.books || 0);
  const odds = Number(s.bestOdds || 0);
  const model = Number(s.model), market = Number(s.market);
  const oppModel = sel[opp] ? Number(sel[opp].model) : 0;
  // Coherencia de DIRECCIÓN: el modelo debe ver al favorito al menos tan probable como su rival directo.
  const modelFightsMarket = model < oppModel;
  const divergence = Math.abs(model - market);
  const confidence = blend(model, market, cfg.alpha1x2);
  const blockers = [];
  if (books < cfg.solidMinBooks) blockers.push('FEW_BOOKS');
  if (!(odds > 1)) blockers.push('NO_ODDS');
  if (odds > cfg.solidMaxOdds) blockers.push('NOT_A_FAVORITE');           // si el "favorito" paga mucho, no es claro
  if (modelFightsMarket) blockers.push('MODEL_FIGHTS_MARKET');            // el modelo apunta al rival → incoherente
  if (confidence < cfg.solidMinConfidence) blockers.push('LOW_CONFIDENCE');
  const eligible = blockers.length === 0;
  return {
    family: 'SOLID', eventId: ev.eventId, home: ev.home, away: ev.away, kickoff: ev.kickoff,
    selection: fav,                          // 'home' | 'away'  (neutral; i18n en cliente)
    marketProb: market, modelProb: model, confidence,
    bestOdds: odds, bestBook: s.bestBook || null, books,
    divergencePp: pp(divergence), eligible, blockers,
  };
}

// ── Familia GOLES: el modelo lidera. Una pick por mercado de goles que pase el gate (sin cap de divergencia) ──
// goalMarkets: [{ eventId, home, away, kickoff, marketId, family, side, line, modelProb, marketProb, edgePp, bestOdds, bestBook, books, familyApproved }]
function goalPicks(goalMarkets, cfg) {
  const out = [];
  for (const g of (goalMarkets || [])) {
    const books = Number(g.books || 0);
    const edge = Number(g.edgePp || 0);     // edge en fracción (0.03 = 3pp)
    const odds = Number(g.bestOdds || 0);
    const model = Number(g.modelProb), market = Number(g.marketProb);
    // ── camino EDGE (el del Mundial): el modelo lidera con divergencia mínima ──
    const edgeBlockers = [];
    if (cfg.goalsRequireApprovedFamily && !g.familyApproved) edgeBlockers.push('FAMILY_NOT_APPROVED');
    if (edge < cfg.goalsMinEdgePp) edgeBlockers.push('LOW_EDGE');
    if (books < cfg.goalsMinBooks) edgeBlockers.push('FEW_BOOKS');
    if (!(odds > 1)) edgeBlockers.push('NO_ODDS');
    // ── camino ANCLA (régimen dual): en mercados EFICIENTES el consenso manda; el modelo confirma ──
    let anchorBlockers = null;
    if (cfg.goalsAnchorEnabled) {
      anchorBlockers = [];
      const effRegime = g.efficiency && g.efficiency.regime;
      const deep = effRegime === 'efficient' || (effRegime == null && books >= cfg.goalsAnchorMinBooks);
      if (!deep) anchorBlockers.push('MARKET_NOT_EFFICIENT');
      if (!(market >= cfg.goalsAnchorMinMarketProb)) anchorBlockers.push('NO_CLEAR_LEAN');
      if (Math.abs(model - market) > cfg.goalsAnchorMaxDivergencePp) anchorBlockers.push('MODEL_DISAGREES');
      if (!(odds > 1)) anchorBlockers.push('NO_ODDS');
      // line shopping honesto: la mejor cuota no puede estar por debajo de la justa del consenso
      if (odds > 1 && market > 0 && market < 1 && odds < 1 / market) anchorBlockers.push('BELOW_CONSENSUS_PRICE');
    }
    const edgeOk = edgeBlockers.length === 0;
    const anchorOk = anchorBlockers != null && anchorBlockers.length === 0;
    // regime: 'edge' si el modelo lidera con las reglas del Mundial; 'anchor' si entra por el consenso.
    const regime = edgeOk ? 'edge' : anchorOk ? 'anchor' : null;
    const confidence = blend(model, market, regime === 'anchor' ? cfg.alphaGoalsAnchor : cfg.alphaGoals);
    out.push({
      family: 'GOALS', eventId: g.eventId, home: g.home, away: g.away, kickoff: g.kickoff,
      marketId: g.marketId, goalFamily: g.family, side: g.side, line: g.line,
      modelProb: model, marketProb: market, confidence,
      edgePp: pp(edge), bestOdds: odds, bestBook: g.bestBook || null, books,
      divergencePp: pp(Math.abs(model - market)),
      regime, efficiency: g.efficiency || null,
      eligible: regime != null,
      blockers: regime != null ? [] : (anchorBlockers != null ? [...new Set(edgeBlockers.concat(anchorBlockers))] : edgeBlockers),
    });
  }
  return out;
}

// ── Familia COMBO: pata 1X2 sólida elegible + mejor pata de goles elegible del MISMO evento ─────────────────
function comboPicks(solids, goals, cfg) {
  if (!cfg.combosEnabled) return [];
  const goalsByEvent = {};
  for (const g of goals) { if (!g.eligible) continue; (goalsByEvent[g.eventId] = goalsByEvent[g.eventId] || []).push(g); }
  const out = [];
  for (const s of solids) {
    if (!s.eligible) continue;
    const gs = (goalsByEvent[s.eventId] || []).slice().sort((a, b) => b.edgePp - a.edgePp);
    const g = gs[0];
    if (!g) continue;
    // Cuota combinada aproximada (patas tratadas como ~independientes para mostrar; el libro fija la real).
    const comboOdds = Math.round(s.bestOdds * g.bestOdds * 100) / 100;
    const confidence = clamp01(s.confidence * g.confidence);
    const blockers = [];
    if (confidence < cfg.comboMinConfidence) blockers.push('LOW_COMBINED_CONFIDENCE');
    out.push({
      family: 'COMBO', eventId: s.eventId, home: s.home, away: s.away, kickoff: s.kickoff,
      legs: [
        { type: '1X2', selection: s.selection, odds: s.bestOdds },
        { type: 'GOALS', marketId: g.marketId, side: g.side, line: g.line, odds: g.bestOdds },
      ],
      confidence, comboOdds, eligible: blockers.length === 0, blockers,
    });
  }
  return out;
}

// ── Familias PROPS de EQUIPO (córners/tarjetas): el modelo NB lidera contra el consenso no-vig ──────────────
// propMarkets: [{ eventId, home, away, kickoff, family('corners_total'|'cards_total'), marketId, side, line,
//                 modelProb, marketProb, edgePp (fracción), bestOdds, books, familyApproved }]
function propPicks(propMarkets, cfg) {
  const out = [];
  for (const g of (propMarkets || [])) {
    const books = Number(g.books || 0), edge = Number(g.edgePp || 0), odds = Number(g.bestOdds || 0);
    const blockers = [];
    // propsRequireApprovedFamily (default true = Mundial intacto): clubes lo apagan para MONITOREO —
    // el gate viaja en la pick (gate_status), mismo mecanismo que goalsRequireApprovedFamily.
    if (cfg.propsRequireApprovedFamily !== false && !g.familyApproved) blockers.push('FAMILY_NOT_APPROVED');
    if (edge < cfg.propsMinEdgePp) blockers.push('LOW_EDGE');
    if (books < cfg.propsMinBooks) blockers.push('FEW_BOOKS');
    if (!(odds > 1)) blockers.push('NO_ODDS');
    if (odds > 1 && (odds < cfg.propsOddsMin || odds > cfg.propsOddsMax)) blockers.push('ODDS_OUT_OF_RANGE');
    // REC 2: gate precio-vs-consenso. La cuota justa del lado = 1/marketProb (consenso no-vig). Si la mejor
    // cuota disponible es peor que la justa, estás pagando de más → no publicar (aunque el modelo vea edge).
    const mkt = Number(g.marketProb || 0);
    if (cfg.propsRequireFairPrice && odds > 1 && mkt > 0 && mkt < 1 && odds < 1 / mkt) blockers.push('BELOW_CONSENSUS_PRICE');
    out.push({
      family: g.family === 'cards_total' ? 'CARDS' : 'CORNERS',
      eventId: g.eventId, home: g.home, away: g.away, kickoff: g.kickoff,
      marketId: g.marketId, side: g.side, line: g.line,
      modelProb: Number(g.modelProb), marketProb: Number(g.marketProb),
      confidence: blend(Number(g.modelProb), Number(g.marketProb), cfg.alphaProps),
      edgePp: pp(edge), bestOdds: odds, bestBook: g.bestBook || null, books,
      eligible: blockers.length === 0, blockers,
    });
  }
  return out;
}

// ── Familia PROPS de JUGADOR (anytime scorer / remates): ANCLADA AL MERCADO, probabilidad primero ───────────
// El mercado es hiper-eficiente → entre las opciones que cotizan las casas se elige la MÁS PROBABLE (blend
// modelo/mercado, mercado dominando), no la de mayor brecha. El modelo aporta matiz y un check de coherencia
// (si contradice fuerte al precio, no se publica). Nota: impliedMedian trae el vig de la casa (mercados
// one-sided no se pueden des-vigear bien) → el blend sobreestima ~3-5pp parejo entre jugadores; para RANKEAR
// y para el piso de probabilidad es consistente. edgePp (vs break-even) queda solo informativo.
// playerMarkets: [{ eventId, home, away, kickoff, family('player_goal'|'player_shots'|'player_sot'), marketId,
//                   player, pid, side, line, modelProb, impliedMedian, bestOdds, books, availabilityRisk,
//                   isStarter (true/false/null = proyección de once; false bloquea) }]
function playerPicks(playerMarkets, cfg) {
  const out = [];
  for (const g of (playerMarkets || [])) {
    const books = Number(g.books || 0), odds = Number(g.bestOdds || 0);
    const be = odds > 1 ? 1 / odds : 1;
    const model = Number(g.modelProb);
    const market = g.impliedMedian != null ? Number(g.impliedMedian) : null;
    const prob = market != null ? blend(model, market, cfg.alphaPlayer) : model;
    const blockers = [];
    if (books < cfg.playerMinBooks) blockers.push('FEW_BOOKS');
    if (!(odds > 1)) blockers.push('NO_ODDS');
    if (odds > 1 && (odds < cfg.playerOddsMin || odds > cfg.playerOddsMax)) blockers.push('ODDS_OUT_OF_RANGE');
    if (g.isStarter === false) blockers.push('NOT_PROJECTED_STARTER'); // el bug Doué: suplente proyectado como titular
    if (g.availabilityRisk === 'OUT' || g.availabilityRisk === 'SUSPENDED') blockers.push('AVAILABILITY'); // capa de observación
    if (g.availabilityRisk === 'DOUBT' && Number(g.availabilityMiss || 0) >= cfg.playerDoubtBlockMiss) blockers.push('AVAILABILITY_DOUBT'); // duda sustancial → esperar alineación
    if (prob < cfg.playerMinProb) blockers.push('LOW_PROBABILITY');
    if (market != null && model < market - cfg.playerMaxModelDeficitPp) blockers.push('MODEL_FIGHTS_MARKET');
    out.push({
      family: 'PLAYER',
      eventId: g.eventId, home: g.home, away: g.away, kickoff: g.kickoff,
      marketId: g.marketId, playerFamily: g.family, player: g.player, pid: g.pid, side: g.side || null, line: g.line != null ? g.line : null,
      modelProb: model, marketProb: market,
      confidence: prob,
      edgePp: pp(model - be), bestOdds: odds, bestBook: g.bestBook || null, books,
      availabilityRisk: g.availabilityRisk || null, availabilityMiss: Number(g.availabilityMiss || 0) || 0,
      isStarter: g.isStarter != null ? g.isStarter : null,
      eligible: blockers.length === 0, blockers,
    });
  }
  return out;
}

// ── Orquestador: produce las familias. Devuelve TODAS (con eligible/blockers) para que la capa de publicación
//    aplique la política elegida ("publicar todo lo que pase el gate"). ───────────────────────────────────────
function curate({ events = [], goalMarkets = [], propMarkets = [], playerMarkets = [], config = {} } = {}) {
  const cfg = Object.assign({}, CONFIG, config);
  const solids = events.map(ev => solidPick(ev, cfg)).filter(Boolean);
  const goals = goalPicks(goalMarkets, cfg);
  const combos = comboPicks(solids, goals, cfg);
  const props = propPicks(propMarkets, cfg);
  const player = playerPicks(playerMarkets, cfg);
  const eligible = {
    solid: solids.filter(p => p.eligible),
    goals: goals.filter(p => p.eligible),
    combo: combos.filter(p => p.eligible),
    props: props.filter(p => p.eligible),
    player: player.filter(p => p.eligible),
  };
  return {
    config: cfg,
    all: { solid: solids, goals, combo: combos, props, player },
    eligible,
    counts: { solid: eligible.solid.length, goals: eligible.goals.length, combo: eligible.combo.length, props: eligible.props.length, player: eligible.player.length },
  };
}

module.exports = { curate, solidPick, goalPicks, comboPicks, propPicks, playerPicks, blend, CONFIG };
