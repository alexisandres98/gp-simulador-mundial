// clubs-engine/goalsModel.js — F3.1: MODELO DE GOLES POR LIGA (ataque/defensa Dixon-Coles).
// El goal engine base deriva los λ SOLO del Elo → predice ~51% over en TODAS las ligas (un equipo fuerte marca
// más pero concede menos → el TOTAL queda ~constante), lo que está mal: el over real va de 34% (argentina) a
// 64% (csl/bundesliga). Este modelo fitea fuerza de ATAQUE y DEFENSA por equipo desde los goles reales del
// historial de la liga → los λ discriminan el nivel de goles por liga y por cruce. Con SHRINKAGE hacia la media
// (tau pseudo-partidos) para no sobreajustar equipos con pocos partidos.
//
// IMPORTANTE (backtest walk-forward, 9 ligas): esto ARREGLA la calibración de NIVEL (cal_err O/U 2.5 baja de
// ~0.13 a ~0.03) pero el SKILL de discriminación a nivel partido sigue ~0 (el total de goles es Poisson-ruidoso
// y el mercado de totales es eficiente — límite fundamental). Sirve para proyecciones REALISTAS del cockpit, NO
// habilita picks de goles por sí solo (esas siguen bloqueadas por el gate de skill).
'use strict';

const TAU = 20;       // shrinkage: pseudo-partidos hacia λ neutral (equipo promedio). Más alto = más regularizado.
const ITERS = 60;     // iteraciones del ajuste proporcional iterativo (converge < 40).
const CLAMP = [0.25, 2.8]; // topes de los multiplicadores de ataque/defensa (evita explosiones con pocos datos).

// matches: [{ home:{id,goals}, away:{id,goals} }, ...]. Devuelve { muH, muA, atk, def } o null si hay pocos datos.
function fitLeagueGoals(matches, { tau = TAU, iters = ITERS } = {}) {
  const rows = (matches || []).filter(m => m && m.home && m.away && Number.isFinite(Number(m.home.goals)) && Number.isFinite(Number(m.away.goals)));
  if (rows.length < 20) return null;
  let muH = 0, muA = 0;
  for (const m of rows) { muH += Number(m.home.goals); muA += Number(m.away.goals); }
  muH /= rows.length; muA /= rows.length;
  const atk = {}, def = {}, played = {}, teams = new Set();
  for (const m of rows) { teams.add(String(m.home.id)); teams.add(String(m.away.id)); }
  for (const t of teams) { atk[t] = 1; def[t] = 1; played[t] = 0; }
  for (const m of rows) { played[String(m.home.id)]++; played[String(m.away.id)]++; }
  const cl = x => Math.max(CLAMP[0], Math.min(CLAMP[1], x));
  for (let it = 0; it < iters; it++) {
    const gsFor = {}, expFor = {}, gaAg = {}, expAg = {};
    for (const t of teams) { gsFor[t] = 0; expFor[t] = 0; gaAg[t] = 0; expAg[t] = 0; }
    for (const m of rows) {
      const h = String(m.home.id), a = String(m.away.id);
      gsFor[h] += Number(m.home.goals); expFor[h] += muH * def[a];
      gsFor[a] += Number(m.away.goals); expFor[a] += muA * def[h];
      gaAg[a] += Number(m.home.goals); expAg[a] += muH * atk[h];
      gaAg[h] += Number(m.away.goals); expAg[h] += muA * atk[a];
    }
    // shrinkage hacia 1.0: mezcla las cuentas observadas con `tau` partidos "promedio" (exp por partido)
    for (const t of teams) {
      const eF = expFor[t], eA = expAg[t], perF = eF / Math.max(1, played[t]), perA = eA / Math.max(1, played[t]);
      if (eF > 0) atk[t] = cl((gsFor[t] + tau * perF) / (eF + tau * perF));
      if (eA > 0) def[t] = cl((gaAg[t] + tau * perA) / (eA + tau * perA));
    }
  }
  return { muH, muA, atk, def };
}

// λ del cruce desde el fit. Equipo desconocido → multiplicadores neutrales (1). hfaScale opcional (>1 sube local).
function goalLambdas(fit, homeId, awayId, { hfaScale = 1 } = {}) {
  if (!fit) return null;
  const h = String(homeId), a = String(awayId);
  const A = fit.atk[h] != null ? fit.atk[h] : 1, Dh = fit.def[h] != null ? fit.def[h] : 1;
  const Aa = fit.atk[a] != null ? fit.atk[a] : 1, Da = fit.def[a] != null ? fit.def[a] : 1;
  const lh = fit.muH * A * Da * hfaScale;
  const la = fit.muA * Aa * Dh;
  return [Math.max(0.15, lh), Math.max(0.15, la)];
}

module.exports = { fitLeagueGoals, goalLambdas, TAU };
