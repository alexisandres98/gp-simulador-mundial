// style-engine/profile.js — PERFIL TÁCTICO POR EQUIPO desde event data (PURO, sin I/O).
// Consume los shotmaps con situación de data/fotmob-events.json (remate a remate: de córner / jugada /
// balón parado / contragolpe / penal, coordenadas, xG, cabezazo) y opcionalmente el historial de props
// (córners/tarjetas/faltas/posesión por partido). Produce el perfil ofensivo Y defensivo de cada equipo
// + una lectura de MATCHUP entre dos perfiles con códigos narrativos (el cliente/narrativa los localiza).
// SHADOW para modelos: esto NO toca gates ni probabilidades (regla: backtest antes de cablear a modelos).
'use strict';

// Coordenadas FotMob: cancha normalizada con TODOS los remates atacando hacia x≈105 (mismo marco para
// todos los equipos) e y∈[0,68] a lo ancho. Los tercios de y dan el sector del remate en el marco de
// ataque; al estar TODO en el mismo marco, el histograma de remates PROPIOS de A es directamente
// comparable con el histograma de remates CONCEDIDOS por B (mismo eje).
const Y_MAX = 68;
const zoneOf = y => y == null ? null : (y < Y_MAX / 3 ? 'z1' : y < (2 * Y_MAX) / 3 ? 'center' : 'z3');
// Valores reales observados en el torneo: RegularPlay, FromCorner, FastBreak, SetPiece, ThrowInSetPiece,
// FreeKick, Penalty, IndividualPlay ('FreeKick' es el directo; 'DirectFreekick' queda por compatibilidad).
const SET_PIECE_SITS = ['FromCorner', 'SetPiece', 'ThrowInSetPiece', 'FreeKick', 'DirectFreekick'];

function emptyAgg() {
  return { matches: 0, shots: 0, xg: 0, goals: 0, sp_shots: 0, sp_xg: 0, corner_shots: 0, corner_xg: 0, fastbreak_shots: 0, fastbreak_xg: 0, header_shots: 0, inside_box: 0, zones: { z1: 0, center: 0, z3: 0 }, pens: 0 };
}
function addShot(agg, s) {
  if (s.event === 'Goal' && !s.own_goal) agg.goals++;
  // El penal NO describe estilo: gol sí cuenta, pero ni el remate ni su xG entran a los shares.
  if (s.situation === 'Penalty') { agg.pens++; return; }
  agg.shots++;
  const xg = Number(s.xg) || 0;
  agg.xg += xg;
  if (SET_PIECE_SITS.includes(s.situation)) { agg.sp_shots++; agg.sp_xg += xg; }
  if (s.situation === 'FromCorner') { agg.corner_shots++; agg.corner_xg += xg; }
  if (s.situation === 'FastBreak') { agg.fastbreak_shots++; agg.fastbreak_xg += xg; }
  if (s.shot_type === 'Header') agg.header_shots++;
  if (s.inside_box) agg.inside_box++;
  const z = zoneOf(s.y);
  if (z) agg.zones[z]++;
}

function finishAgg(a) {
  const per90 = v => a.matches ? +(v / a.matches).toFixed(2) : null;
  const share = (num, den) => den > 0 ? +(num / den).toFixed(3) : null;
  const zoneTot = a.zones.z1 + a.zones.center + a.zones.z3;
  return {
    matches: a.matches,
    shots_p90: per90(a.shots), xg_p90: per90(+a.xg.toFixed(3)), goals_p90: per90(a.goals),
    sp_share_xg: share(a.sp_xg, a.xg),            // qué parte del peligro nace de balón parado
    corner_share_xg: share(a.corner_xg, a.xg),    // ...específicamente de córners
    fastbreak_share_xg: share(a.fastbreak_xg, a.xg),
    header_share: share(a.header_shots, a.shots),
    inside_box_share: share(a.inside_box, a.shots),
    zones: zoneTot ? { z1: +(a.zones.z1 / zoneTot).toFixed(3), center: +(a.zones.center / zoneTot).toFixed(3), z3: +(a.zones.z3 / zoneTot).toFixed(3) } : null,
    pens: a.pens,
  };
}

// matches: data/fotmob-events.json .matches ; propsHist (opcional): data/props-history.json .matches
// (para córners/tarjetas/faltas/posesión por equipo). Devuelve { TEAM: { attack, defense, props? } }.
function fitStyles(matches, propsHist) {
  const acc = {};
  const get = code => acc[code] || (acc[code] = { attack: emptyAgg(), defense: emptyAgg() });
  for (const m of (matches || [])) {
    if (!m || !m.homeCode || !m.awayCode || !Array.isArray(m.shots)) continue;
    const H = get(m.homeCode), A = get(m.awayCode);
    H.attack.matches++; H.defense.matches++; A.attack.matches++; A.defense.matches++;
    for (const s of m.shots) {
      if (s.team === 'home') { addShot(H.attack, s); addShot(A.defense, s); }
      else if (s.team === 'away') { addShot(A.attack, s); addShot(H.defense, s); }
    }
  }
  const out = {};
  for (const [code, v] of Object.entries(acc)) out[code] = { attack: finishAgg(v.attack), defense: finishAgg(v.defense) };
  attachPercentiles(out);
  // Capa props (data ya pagada): córners/tarjetas/faltas/posesión por 90 desde el historial API-Football.
  if (propsHist && Array.isArray(propsHist)) {
    const pacc = {};
    const pget = c => pacc[c] || (pacc[c] = { m: 0, cf: 0, ca: 0, yf: 0, ff: 0, poss: 0 });
    for (const m of propsHist) {
      const h = m.home || {}, a = m.away || {};
      if (!h.code || !a.code) continue;
      const H = pget(h.code), A = pget(a.code);
      H.m++; A.m++;
      H.cf += h.corners || 0; H.ca += a.corners || 0; A.cf += a.corners || 0; A.ca += h.corners || 0;
      H.yf += (h.yellows || 0) + (h.reds || 0); A.yf += (a.yellows || 0) + (a.reds || 0);
      H.ff += h.fouls || 0; A.ff += a.fouls || 0;
      H.poss += h.possession || 0; A.poss += a.possession || 0;
    }
    for (const [code, v] of Object.entries(pacc)) {
      if (!out[code] || !v.m) continue;
      out[code].props = {
        corners_for_p90: +(v.cf / v.m).toFixed(2), corners_against_p90: +(v.ca / v.m).toFixed(2),
        cards_p90: +(v.yf / v.m).toFixed(2), fouls_p90: +(v.ff / v.m).toFixed(2),
        possession: +(v.poss / v.m).toFixed(1),
      };
    }
  }
  return out;
}

// ── Percentiles vs el torneo ────────────────────────────────────────────────────────────────────────────────
// Los umbrales absolutos no viajan entre torneos/ligas; el percentil sí. A cada perfil (equipos con muestra
// >=3) se le anexa attack_pct / defense_pct por métrica: 0.9 en attack.corner_share_xg = top 10% del torneo
// generando por córners; 0.9 en defense.corner_share_xg = top 10% CONCEDIENDO por esa vía.
const PCT_KEYS = ['sp_share_xg', 'corner_share_xg', 'fastbreak_share_xg', 'header_share', 'xg_p90', 'shots_p90'];
function attachPercentiles(profiles) {
  const pool = Object.values(profiles).filter(p => p.attack.matches >= 3);
  if (pool.length < 6) return;
  const rank = (arr, v) => { const s = arr.filter(x => x != null); return s.length > 1 ? +(s.filter(x => x < v).length / (s.length - 1)).toFixed(2) : null; };
  for (const side of ['attack', 'defense']) {
    const cols = {};
    for (const k of PCT_KEYS) cols[k] = pool.map(p => p[side][k]);
    for (const p of Object.values(profiles)) {
      if (p[side][`_pct`] === undefined) p[side]._pct = {};
      for (const k of PCT_KEYS) p[side]._pct[k] = p[side][k] != null ? rank(cols[k], p[side][k]) : null;
    }
  }
}

// ── Matchup: lectura cruzada de dos perfiles → códigos narrativos con evidencia ────────────────────────────
// Cada hallazgo: { code, side: 'home'|'away', strength }. Regla percentil (auto-calibrante): mi ataque en el
// top del torneo por esa vía (>=p70) Y el rival concediendo en el top por la misma vía (>=p70). Fallback a
// umbrales absolutos cuando no hay percentiles (perfiles sintéticos/pools chicos). Texto = capa narrativa.
const PCT_HI = 0.7;
function matchupFindings(home, away) {
  const out = [];
  const pair = [['home', home, away], ['away', away, home]];
  for (const [side, me, rival] of pair) {
    if (!me || !rival || !me.attack || !rival.defense) continue;
    const A = me.attack, D = rival.defense;
    if (A.matches < 3 || D.matches < 3) continue;
    const ap = A._pct || null, dp = D._pct || null;
    const hi = (p, k, absV, absT) => p ? (p[k] != null && p[k] >= PCT_HI) : (absV != null && absV >= absT);
    // Peligro de córner/balón parado contra un rival que concede por esa vía
    if (hi(ap, 'corner_share_xg', A.corner_share_xg, 0.18) && hi(dp, 'corner_share_xg', D.corner_share_xg, 0.18))
      out.push({ code: 'CORNER_EDGE', side, strength: +(A.corner_share_xg + D.corner_share_xg).toFixed(2) });
    else if (hi(ap, 'sp_share_xg', A.sp_share_xg, 0.28) && hi(dp, 'sp_share_xg', D.sp_share_xg, 0.25))
      out.push({ code: 'SET_PIECE_EDGE', side, strength: +(A.sp_share_xg + D.sp_share_xg).toFixed(2) });
    // Amenaza aérea vs rival que concede cabezazos
    if (hi(ap, 'header_share', A.header_share, 0.22) && hi(dp, 'header_share', D.header_share, 0.22))
      out.push({ code: 'AERIAL_EDGE', side, strength: +(A.header_share + D.header_share).toFixed(2) });
    // Contragolpe vs equipo que concede a la contra
    if (hi(ap, 'fastbreak_share_xg', A.fastbreak_share_xg, 0.14) && hi(dp, 'fastbreak_share_xg', D.fastbreak_share_xg, 0.12))
      out.push({ code: 'COUNTER_EDGE', side, strength: +(A.fastbreak_share_xg + D.fastbreak_share_xg).toFixed(2) });
    // Sector favorito de ataque coincide con el sector donde el rival más concede (mismo marco normalizado)
    if (A.zones && D.zones) {
      for (const z of ['z1', 'z3']) {
        if (A.zones[z] >= 0.40 && D.zones[z] >= 0.40) out.push({ code: 'ZONE_OVERLAP', side, zone: z, strength: +(A.zones[z] + D.zones[z]).toFixed(2) });
      }
    }
    // Volumen: genera mucho contra defensa que concede mucho
    if (hi(ap, 'xg_p90', A.xg_p90, 1.6) && hi(dp, 'xg_p90', D.xg_p90, 1.5))
      out.push({ code: 'VOLUME_EDGE', side, strength: +((A.xg_p90 || 0) + (D.xg_p90 || 0)).toFixed(2) });
  }
  return out.sort((a, b) => b.strength - a.strength);
}

// Rasgos individuales de un equipo (para narrativa/perfil, sin cruzar con rival): top/fondo del torneo.
function teamTraits(profile) {
  if (!profile || !profile.attack || !profile.attack._pct) return [];
  const out = [];
  const ap = profile.attack._pct, dp = profile.defense._pct || {};
  if (ap.corner_share_xg >= 0.8) out.push('TRAIT_CORNER_THREAT');
  if (ap.sp_share_xg >= 0.8) out.push('TRAIT_SP_THREAT');
  if (ap.header_share >= 0.8) out.push('TRAIT_AERIAL_THREAT');
  if (ap.fastbreak_share_xg >= 0.8) out.push('TRAIT_COUNTER_THREAT');
  if (ap.xg_p90 >= 0.8) out.push('TRAIT_HIGH_VOLUME');
  if (dp.xg_p90 != null && dp.xg_p90 <= 0.2) out.push('TRAIT_SOLID_DEFENSE');
  if (dp.corner_share_xg >= 0.8) out.push('TRAIT_CORNER_VULNERABLE');
  if (dp.sp_share_xg >= 0.8) out.push('TRAIT_SP_VULNERABLE');
  if (dp.header_share >= 0.8) out.push('TRAIT_AERIAL_VULNERABLE');
  return out;
}

module.exports = { fitStyles, matchupFindings, teamTraits, attachPercentiles, zoneOf, SET_PIECE_SITS };
