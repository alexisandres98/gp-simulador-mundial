'use strict';
// clubs-engine/cups.js — ligas virtuales de COPA con prior por división (2-sep-2026).
//
// Antes (13-ago) clubsEnsureCups fusionaba POR REFERENCIA los pools de Elo de las ligas de origen sin
// recalibrar escalas: un equipo de 2ª que domina su liga (Elo 1650 en su pool, media 1500) se cruzaba con uno
// de 1ª de la zona baja (1450 en SU pool) y el modelo le daba favorito al de 2ª. La discrepancia
// modelo−mercado en copas era el doble que en liga (+22,0 pp cuando cruzan divisiones, n=47, vs +10,1 pp;
// docs/BACKTESTS_FAMILIAS_2026-09-02.md §3.2).
//
// Ahora cada copa recibe COPIAS de los ratings (la liga de origen no se muta) y a los equipos de nivel k se
// les resta GAP·(k−1) puntos de Elo. El nivel lo da el ORDEN de `from`: cada elemento es un nivel; un
// elemento que es una lista agrupa ligas del MISMO nivel (p.ej. las 1ª divisiones sudamericanas en
// Libertadores, o todas las ligas de la clasificación de Champions).
//
// GAP = GP_CUP_TIER_GAP_ELO (default 150) es un PRIOR DECLARADO, NO AJUSTADO: 150 Elo ≈ 70/30 a cancha neutral
// entre un equipo medio de 1ª y uno medio de 2ª, el orden de magnitud habitual de la brecha entre divisiones
// consecutivas en los sistemas Elo de clubes. Se mide con scripts/clubs-cups-gap.js antes de ajustar nada.
// Este módulo lo comparten server.js (clubsEnsureCups) y ese script para que ambos usen la MISMA regla.

const CLUB_CUPS = {
  libertadores: { name: 'Copa Libertadores', odds_key: 'soccer_conmebol_copa_libertadores', from: [['brasileirao', 'argentina', 'chile', 'colombia', 'paraguay'], 'brasilb'], hfa: 50 },
  sudamericana: { name: 'Copa Sudamericana', odds_key: 'soccer_conmebol_copa_sudamericana', from: [['brasileirao', 'argentina', 'chile', 'colombia', 'paraguay'], 'brasilb'], hfa: 50 },
  leaguescup:   { name: 'Leagues Cup', odds_key: 'soccer_concacaf_leagues_cup', from: [['mls', 'ligamx']], hfa: 45 },
  eflcup:       { name: 'EFL Cup', odds_key: 'soccer_england_efl_cup', from: ['premier', 'championship', 'league1', 'league2'], hfa: 55 },
  facup:        { name: 'FA Cup', odds_key: 'soccer_fa_cup', from: ['premier', 'championship', 'league1', 'league2'], hfa: 55 },
  dfbpokal:     { name: 'DFB-Pokal', odds_key: 'soccer_germany_dfb_pokal', from: ['bundesliga', 'bundesliga2', 'liga3'], hfa: 55 },
  copadelrey:   { name: 'Copa del Rey', odds_key: 'soccer_spain_copa_del_rey', from: ['laliga', 'laliga2'], hfa: 55 },
  coppaitalia:  { name: 'Coppa Italia', odds_key: 'soccer_italy_coppa_italia', from: ['seriea', 'serieb'], hfa: 55 },
  coupefrance:  { name: 'Coupe de France', odds_key: 'soccer_france_coupe_de_france', from: ['ligue1', 'ligue2'], hfa: 55 },
  uclq:         { name: 'Champions League · clasificación', odds_key: 'soccer_uefa_champs_league_qualification', from: [['premier', 'laliga', 'bundesliga', 'seriea', 'ligue1', 'eredivisie', 'portugal', 'belgica', 'turquia', 'grecia', 'escocia', 'austria', 'suiza', 'dinamarca', 'noruega', 'suecia', 'polonia', 'irlanda', 'finlandia']], hfa: 55 },
  saudi:        { name: 'Saudi Pro League', odds_key: 'soccer_saudi_arabia_pro_league', from: [], hfa: 60 },
  aleague:      { name: 'A-League', odds_key: 'soccer_australia_aleague', from: [], hfa: 60 },
};
// Placeholders que YA existían en ratings.json sin odds_key → se les cablea la clave del proveedor.
const CLUB_CUP_KEY_FIX = { champions: 'soccer_uefa_champs_league', europa: 'soccer_uefa_europa_league', uefa: 'soccer_uefa_europa_conference_league' };

function tierGap() {
  const g = Number(process.env.GP_CUP_TIER_GAP_ELO ?? 150);
  return Number.isFinite(g) && g >= 0 ? g : 150;
}

// tiersOf(cfg) → [[liga, nivel], ...] en el orden de `from` (nivel 1 = primer elemento).
function tiersOf(cfg) {
  const out = [];
  (cfg.from || []).forEach((el, i) => { for (const lg of (Array.isArray(el) ? el : [el])) out.push([lg, i + 1]); });
  return out;
}

// buildCupLeague(RT, key, cfg, gap) → liga virtual con COPIAS de los ratings y el prior por división aplicado.
//   rating copiado: { ...original, elo: elo − GAP·(k−1), tier: k, tier_offset: −GAP·(k−1), from_league }.
//   tier_offset lo usa clubElo/applyClubElo para sumar/restar el prior sobre el overlay dinámico (global por equipo).
function buildCupLeague(RT, key, cfg, gap) {
  const G = Number.isFinite(Number(gap)) ? Number(gap) : tierGap();
  const merged = {};
  for (const [src, k] of tiersOf(cfg)) {
    const L = RT.leagues[src]; if (!L || !L.ratings) continue;
    const off = G * (k - 1);
    for (const [tid, tr] of Object.entries(L.ratings)) {
      if (merged[tid]) continue; // el primer nivel en que aparece manda (copa doméstica: cada equipo está en una sola liga)
      merged[tid] = { ...tr, elo: (Number(tr.elo) || 1500) - off, tier: k, tier_offset: off ? -off : 0, from_league: src };
    }
  }
  return { key, name: cfg.name, odds_key: cfg.odds_key, hfa: cfg.hfa, ratings: merged, cup: true, tier_gap: G, backtest: { status: 'shadow' } };
}

module.exports = { CLUB_CUPS, CLUB_CUP_KEY_FIX, tierGap, tiersOf, buildCupLeague };
