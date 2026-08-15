// basketball-engine/model.js — EL INTEGRADOR (16-ago).
//
// Acá se junta todo: rating de equipo (fuerza histórica), RAPM + minutos proyectados (quién juega HOY),
// contexto de calendario (en qué estado llegan) y el mercado (lo que el modelo no puede ver). Un modelo
// serio no es un motor: es una PILA con responsabilidades separadas y un punto donde se componen.
//
// DECISIÓN CENTRAL — SE USA EL DELTA, NO EL ABSOLUTO. El rating de equipo está bien calibrado sobre cientos
// de partidos; el RAPM es más ruidoso pero sabe algo que el otro no: quién está en la cancha. Sumar los dos
// contaría dos veces la misma información. Lo que se hace es aplicar la DIFERENCIA entre el equipo de hoy y
// el equipo habitual: si juegan los de siempre el ajuste es cero y manda el rating; si falta el que juega 37
// minutos, entra exactamente lo que ese cambio vale. Es la forma de añadir señal sin romper la calibración.
//
// PURO: recibe el estado ya cargado, devuelve números. Sin red, sin disco, sin db.
'use strict';

const MN = require('./minutes');
const PLY = require('./players');
const CX = require('./context');
const S = require('./simulate');

// ---- AJUSTE POR DISPONIBILIDAD --------------------------------------------------------------------------
// Devuelve el cambio en puntos por 100 posesiones (ataque y defensa) respecto al equipo habitual.
// `override` permite forzar la disponibilidad sin tocar el parte real: es lo que usa el árbol de escenarios
// para preguntar "¿y si este jugador no juega?" sin inventar un parte de lesiones falso.
function availabilityDelta(C, teamId, { injuries = null, L = null, override = null } = {}) {
  if (!C || !C.rapm) return null;
  const prof = MN.rotationProfile(C.games, teamId, { lastN: 15 });
  if (!prof) return null;
  const baseline = MN.projectMinutes(prof, { L });                      // el equipo de siempre
  if (!baseline) return null;
  const { out, doubtful } = override ? { out: (override.out || []).map(String), doubtful: override.doubtful || {} }
    : injuries ? MN.injuriesToRoster(injuries, teamId) : { out: [], doubtful: {} };
  const tonight = MN.projectMinutes(prof, { out, doubtful, L });
  if (!tonight) return null;
  const a = PLY.teamFromMinutes(C.rapm, baseline.map);
  const b = PLY.teamFromMinutes(C.rapm, tonight.map);
  if (!a || !b) return null;
  return {
    off: +(b.off - a.off).toFixed(3),
    def: +(b.def - a.def).toFixed(3),
    net: +((b.off - b.def) - (a.off - a.def)).toFixed(3),
    coverage: b.coverage,
    out, doubtful,
    minutes: tonight, baseline_minutes: baseline,
    // quiénes cambian y cuánto: la explicación que hace auditable el ajuste
    changes: tonight.rows.filter((r) => Math.abs(r.delta) >= 2).slice(0, 6)
      .map((r) => ({ name: r.name, min: r.min, delta: r.delta, impact: (C.rapm.players[r.id] || {}).net || null })),
    missing: out.map((id) => {
      const p = C.rapm.players[id]; const row = prof.rows.find((x) => String(x.id) === String(id));
      return { id, name: row ? row.name : id, min: row ? row.exp : null, impact: p ? p.net : null };
    }).filter((x) => x.min),
  };
}

// ---- PROYECCIÓN COMPLETA DE UN PARTIDO ------------------------------------------------------------------
// Devuelve los ajustes listos para `simulate(..., { adj })` y el desglose de dónde viene cada punto.
function projectGame(C, game, { injuries = null, L = null, override = null } = {}) {
  const h = String(game.home.id), a = String(game.away.id);
  const parts = [];
  let adjHome = 0, adjAway = 0, adjPace = 0;
  // GATING POR VALIDACIÓN. Cada capa se aplica SOLO si mejoró de verdad fuera de muestra en esta liga
  // (data/basketball/validation-<liga>.json, escrito por scripts/hoops-validate.js). Una capa que no se
  // gana su sitio no se corre "por si acaso": añade varianza sin pagar nada. En NBA, medido sobre 772
  // partidos, la plantilla EMPEORA (−0.0224 vs −0.0204) y por eso hoy está apagada ahí — se encenderá sola
  // cuando más datos la hagan válida, que es exactamente para lo que sirve tener la estructura ya montada.
  const LY = (C && C.validation && C.validation.layers) || null;
  const useRoster = LY ? !!(LY.roster && LY.roster.on) : false;
  const useCtx = LY ? !!(LY.context && LY.context.on) : false;
  const useBlend = LY ? !!(LY.blend && LY.blend.on) : !!(C && C.blend && C.blend.ok && C.blend.w > 0);

  // 1) disponibilidad (RAPM × minutos)
  const dh = availabilityDelta(C, h, { injuries, L, override: override && override.home });
  const da = availabilityDelta(C, a, { injuries, L, override: override && override.away });
  if (dh) { if (useRoster) adjHome += dh.off - dh.def; if (Math.abs(dh.net) > 0.05) parts.push({ label: 'Plantilla local', pts100: dh.net, side: 'home', applied: useRoster }); }
  if (da) { if (useRoster) adjAway += da.off - da.def; if (Math.abs(da.net) > 0.05) parts.push({ label: 'Plantilla visitante', pts100: da.net, side: 'away', applied: useRoster }); }

  // 2) contexto de calendario, en PUNTOS DE MARGEN → se convierte a puntos por 100 para el simulador
  let ctx = null;
  if (C.ctx && C.sched) {
    const sh = C.sched.get(String(game.id) + '|' + h) || C.schedFor ? C.schedFor(game, 'home') : null;
    const sa = C.sched.get(String(game.id) + '|' + a) || C.schedFor ? C.schedFor(game, 'away') : null;
    if (sh && sa) {
      ctx = CX.contextAdjust(C.ctx, sh, sa);
      if (Math.abs(ctx.pts) > 0.01) {
        const poss = C.fit ? C.fit.lgPace : 100;
        const per100 = (ctx.pts * 100) / Math.max(poss, 1);
        if (useCtx) { adjHome += per100 / 2; adjAway -= per100 / 2; }
        parts.push({ label: 'Calendario y descanso', pts100: +per100.toFixed(3), side: 'home', detail: ctx.parts, applied: useCtx });
      }
    }
  }
  return {
    adj: { home: +adjHome.toFixed(3), away: +adjAway.toFixed(3), pace: adjPace },
    availability: { home: dh, away: da }, context: ctx, parts,
    layers: { roster: useRoster, context: useCtx, blend: useBlend },
    // el ajuste total en puntos de margen, que es como se lee
    margin_pts: +(((adjHome - adjAway) * (C.fit ? C.fit.lgPace : 100)) / 100).toFixed(2),
  };
}

// ---- ENCOGIMIENTO AL MERCADO ----------------------------------------------------------------------------
// El punto 5. Un modelo que NO bate al cierre no debería publicar su probabilidad cruda: el mercado sabe
// cosas que el modelo no ve (una noticia de última hora, un descanso no anunciado, el propio dinero
// informado). La combinación óptima no es una opinión — es el peso w que minimiza el Brier fuera de muestra,
// y se calcula sobre nuestro propio histórico. Si el modelo no aporta nada, w sale ~0 y el sistema lo dice.
function fitBlend(rows, { grid = 21 } = {}) {
  // rows: [{ p_model, p_market, won }]
  const usable = rows.filter((r) => r.p_model != null && r.p_market != null && r.won != null);
  if (usable.length < 50) return { w: 0, n: usable.length, ok: false, reason: 'muestra insuficiente' };
  const curve = [];
  let best = null;
  for (let i = 0; i < grid; i++) {
    const w = i / (grid - 1);
    let br = 0;
    for (const r of usable) {
      // se mezcla en LOG-ODDS, no en probabilidad: es la forma correcta de combinar dos creencias y evita
      // que la mezcla se aplaste hacia 0.5 cuando las dos fuentes están de acuerdo en un extremo.
      const lo = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
      const z = w * lo(r.p_model) + (1 - w) * lo(r.p_market);
      const p = 1 / (1 + Math.exp(-z));
      br += (p - r.won) ** 2;
    }
    br /= usable.length;
    curve.push({ w: +w.toFixed(2), brier: +br.toFixed(5) });
    if (!best || br < best.brier) best = { w, brier: br };
  }
  const mkt = usable.reduce((s, r) => s + (r.p_market - r.won) ** 2, 0) / usable.length;
  const mdl = usable.reduce((s, r) => s + (r.p_model - r.won) ** 2, 0) / usable.length;
  return {
    w: +best.w.toFixed(2), brier: +best.brier.toFixed(5),
    brier_market: +mkt.toFixed(5), brier_model: +mdl.toFixed(5),
    gain_vs_market: +(mkt - best.brier).toFixed(5),
    n: usable.length, curve, ok: true,
  };
}
function blend(pModel, pMarket, w) {
  if (pMarket == null || w == null) return pModel;
  const lo = (p) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)); };
  const z = w * lo(pModel) + (1 - w) * lo(pMarket);
  return 1 / (1 + Math.exp(-z));
}

// ---- SIMULACIÓN CON TODA LA PILA ------------------------------------------------------------------------
function simulateGame(C, game, { injuries = null, L = null, sims = 20000, seed = 13, market = null, override = null } = {}) {
  if (!C || !C.fit) return null;
  const pr = projectGame(C, game, { injuries, L, override });
  const sim = S.simulate(C.fit, String(game.home.id), String(game.away.id), {
    n: sims, seed, neutral: !!game.neutral, adj: pr.adj,
    regMin: (L && L.minutes) || 48, otMin: (L && L.otMin) || 5,
  });
  if (!sim) return null;
  const out = { ...sim, projection_parts: pr.parts, availability: pr.availability, context: pr.context, adj: pr.adj, adj_margin_pts: pr.margin_pts, layers: pr.layers };
  // el punto 5 aplicado: si hay precio de mercado y un peso ajustado, la probabilidad publicada es la mezcla
  if (market != null && C.blend && C.blend.ok && pr.layers.blend) {
    out.win_model = { ...sim.win };
    const p = blend(sim.win.home, market, C.blend.w);
    out.win = { home: +p.toFixed(4), away: +(1 - p).toFixed(4) };
    // EL INTERVALO VIAJA CON LA PROBABILIDAD. El intervalo que sale del simulador describe el error de
    // muestreo de la probabilidad DEL MODELO; si lo que se publica es la mezcla y el intervalo se queda
    // como estaba, el panel muestra un número fuera de su propio intervalo. Se transforman los extremos con
    // la misma mezcla, que es exactamente el intervalo que le corresponde a lo publicado.
    if (sim.win_ci) {
      out.win_ci_model = { ...sim.win_ci };
      out.win_ci = { lo: +blend(sim.win_ci.lo, market, C.blend.w).toFixed(4), hi: +blend(sim.win_ci.hi, market, C.blend.w).toFixed(4) };
    }
    out.blend = { w: C.blend.w, p_model: +sim.win.home.toFixed(4), p_market: +market.toFixed(4) };
  }
  return out;
}

module.exports = { availabilityDelta, projectGame, fitBlend, blend, simulateGame };
