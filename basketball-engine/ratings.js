// basketball-engine/ratings.js — EL MOTOR (15-ago). Ritmo × eficiencia, ajustado por rival.
//
// POR QUÉ NO ELO: en fútbol y combate el resultado es un evento raro (goles, victoria) y Elo funciona. En
// baloncesto cada partido son ~85 posesiones con ~105 puntos por 100: hay muchísima más información por
// partido, y tirarla para quedarse con "ganó/perdió" es un desperdicio. El estándar de la casa en este
// deporte es descomponer en RITMO (cuántas posesiones se juegan) y EFICIENCIA (cuántos puntos por posesión),
// y ajustar ambas por la calidad del rival. Un ataque que anota 110 contra la mejor defensa de la liga vale
// más que uno que anota 115 contra la peor, y el rating crudo no distingue.
//
// VENTAJA ADICIONAL, y es la que más importa para nuestro problema: una sola distribución de puntos por
// equipo alimenta GANADOR, HÁNDICAP y TOTAL a la vez. Tres familias de mercado con un modelo, y con mucho
// menos ruido por apuesta que un 1X2 de fútbol — que es exactamente lo que necesitamos para llegar a n
// suficiente antes de que se acabe la temporada.
//
// PURO: sin red, sin disco, sin db. Entra un array de partidos derivados (ver possessions.js), sale el
// rating. Determinista: los mismos partidos dan el mismo resultado.
'use strict';

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1)); };

// ---- FIT ------------------------------------------------------------------------------------------------
// Modelo aditivo, resuelto por iteración amortiguada (el mismo esquema de KenPom, sin su tabla de ajustes):
//   ORtg(i vs j, casa) = lgORtg + off_i + def_j + hca/2
//   ORtg(j vs i, fuera) = lgORtg + off_j + def_i − hca/2
//   POSES(i vs j)       = lgPace + pace_i + pace_j
// off>0 = mejor ataque · def>0 = PEOR defensa (concede más) · pace>0 = juega más rápido.
//
// Tres decisiones que no son cosméticas:
//  (a) DECAIMIENTO por antigüedad (media vida configurable). Un equipo de marzo no es el de octubre.
//  (b) ENCOGIMIENTO bayesiano hacia la media de liga por muestra: con 3 partidos jugados nadie es el mejor
//      ataque de la liga, es ruido. n/(n+k) con k≈6 partidos de prior.
//  (c) Se excluyen los partidos sin four factors utilizables en vez de imputarlos.
function fitRatings(games, { halfLifeDays = 45, iters = 60, priorGames = 6, now = null, minGames = 5, validTeams = null } = {}) {
  let G = (games || []).filter(g => g && g.home && g.away && g.home.ff && g.away.ff
    && g.home.ff.ortg != null && g.away.ff.ortg != null && g.poss > 0);
  if (!G.length) return null;
  // EQUIPOS FANTASMA (15-ago): el scoreboard de la WNBA mezcla en la temporada los combinados del All-Star y
  // amistosos internacionales — aparecían como "equipos" con 1-3 partidos y se colaban al ranking en el 8º
  // puesto con muestra de un partido. Se caen por dos vías: no estar en el catálogo oficial de la liga, o no
  // llegar al mínimo de partidos. Y se caen TAMBIÉN sus partidos: si el rival no es real, el dato no informa.
  const valid = validTeams ? new Set(validTeams.map(String)) : null;
  for (let pass = 0; pass < 3; pass++) {
    const cnt = {};
    for (const g of G) { cnt[g.home.id] = (cnt[g.home.id] || 0) + 1; cnt[g.away.id] = (cnt[g.away.id] || 0) + 1; }
    const ok = (id) => (!valid || valid.has(String(id))) && (cnt[id] || 0) >= minGames;
    const before = G.length;
    G = G.filter(g => ok(g.home.id) && ok(g.away.id));
    if (G.length === before) break;
  }
  if (!G.length) return null;
  const t1 = now != null ? now : Math.max(...G.map(g => Date.parse(g.date || 0) || 0));
  const wOf = (g) => {
    const t = Date.parse(g.date || 0) || t1;
    const days = Math.max(0, (t1 - t) / 86400e3);
    return Math.pow(0.5, days / halfLifeDays);
  };

  const teams = new Set(); for (const g of G) { teams.add(g.home.id); teams.add(g.away.id); }
  const ids = [...teams];
  const off = {}, def = {}, pace = {};
  for (const id of ids) { off[id] = 0; def[id] = 0; pace[id] = 0; }

  // medias de liga ponderadas
  const W = G.map(wOf), sw = W.reduce((s, x) => s + x, 0) || 1;
  const lgORtg = G.reduce((s, g, i) => s + W[i] * (g.home.ff.ortg + g.away.ff.ortg) / 2, 0) / sw;
  const lgPace = G.reduce((s, g, i) => s + W[i] * g.poss, 0) / sw;
  // ventaja de campo, en puntos por 100 posesiones (se estima del margen medio ponderado, no se asume)
  let hca = G.reduce((s, g, i) => s + W[i] * (g.home.ff.ortg - g.away.ff.ortg), 0) / sw;

  // partidos por equipo (para el encogimiento)
  const n = {}; for (const id of ids) n[id] = 0;
  for (const g of G) { n[g.home.id]++; n[g.away.id]++; }
  const shrink = (id) => n[id] / (n[id] + priorGames);

  for (let it = 0; it < iters; it++) {
    const noff = {}, ndef = {}, npace = {}, wsum = {};
    for (const id of ids) { noff[id] = 0; ndef[id] = 0; npace[id] = 0; wsum[id] = 0; }
    for (let i = 0; i < G.length; i++) {
      const g = G[i], w = W[i], h = g.home.id, a = g.away.id;
      // ataque: lo observado menos lo que explica la defensa rival y la cancha
      noff[h] += w * (g.home.ff.ortg - lgORtg - def[a] - hca / 2);
      noff[a] += w * (g.away.ff.ortg - lgORtg - def[h] + hca / 2);
      // defensa: lo que concedió, menos lo que explica el ataque rival y la cancha
      ndef[h] += w * (g.away.ff.ortg - lgORtg - off[a] + hca / 2);
      ndef[a] += w * (g.home.ff.ortg - lgORtg - off[h] - hca / 2);
      // ritmo: aditivo entre los dos
      npace[h] += w * (g.poss - lgPace - pace[a]);
      npace[a] += w * (g.poss - lgPace - pace[h]);
      wsum[h] += w; wsum[a] += w;
    }
    for (const id of ids) {
      const d = wsum[id] || 1, k = shrink(id);
      // amortiguado al 50%: sin esto el sistema oscila entre ataque y defensa sin converger
      off[id] = off[id] * 0.5 + 0.5 * (noff[id] / d) * k;
      def[id] = def[id] * 0.5 + 0.5 * (ndef[id] / d) * k;
      pace[id] = pace[id] * 0.5 + 0.5 * (npace[id] / d) * k;
    }
    // recentrado: el modelo es aditivo y sin esto off y def derivan juntos sin cambiar ninguna predicción
    const mo = mean(ids.map(x => off[x])), md = mean(ids.map(x => def[x])), mp = mean(ids.map(x => pace[x]));
    for (const id of ids) { off[id] -= mo; def[id] -= md; pace[id] -= mp / 2; }
  }

  // ---- RESIDUOS: de acá salen las barras de error, no de una constante inventada -------------------------
  // Se descompone la varianza en tres piezas porque cada una mueve una cosa distinta:
  //   · sdPoss  → ancho del TOTAL
  //   · sdEnv   → shock de eficiencia COMPARTIDO (partidos sueltos donde anotan los dos). Es lo que explica
  //               la correlación positiva entre los puntos de ambos equipos (0.391 medido en WNBA): sin este
  //               término el simulador produce totales demasiado estrechos.
  //   · sdInd   → ruido propio de cada equipo → ancho del MARGEN
  const resPoss = [], resPPP = [];
  const pred = (g) => ({
    poss: lgPace + pace[g.home.id] + pace[g.away.id],
    h: lgORtg + off[g.home.id] + def[g.away.id] + hca / 2,
    a: lgORtg + off[g.away.id] + def[g.home.id] - hca / 2,
  });
  const pairs = [];
  for (const g of G) {
    const p = pred(g);
    resPoss.push(g.poss - p.poss);
    const eh = (g.home.ff.ortg - p.h) / 100, ea = (g.away.ff.ortg - p.a) / 100;   // en PPP
    resPPP.push(eh, ea); pairs.push([eh, ea]);
  }
  const sdPoss = sd(resPoss), sdTot = sd(resPPP);
  // covarianza entre los residuos de los dos lados del MISMO partido = el shock compartido
  const mh = mean(pairs.map(p => p[0])), ma = mean(pairs.map(p => p[1]));
  const cov = pairs.reduce((s, p) => s + (p[0] - mh) * (p[1] - ma), 0) / (pairs.length - 1 || 1);
  const sdEnv = Math.sqrt(Math.max(0, cov));
  const sdInd = Math.sqrt(Math.max(1e-6, sdTot * sdTot - sdEnv * sdEnv));

  return {
    league: G[0].league, at: new Date().toISOString(), games: G.length, teams: ids.length,
    lgORtg: +lgORtg.toFixed(3), lgPace: +lgPace.toFixed(3), hca: +hca.toFixed(3),
    off, def, pace, n,
    sd: { poss: +sdPoss.toFixed(3), ppp_env: +sdEnv.toFixed(4), ppp_ind: +sdInd.toFixed(4), ppp_tot: +sdTot.toFixed(4) },
    span: { from: G.reduce((m, g) => g.date < m ? g.date : m, G[0].date), to: G.reduce((m, g) => g.date > m ? g.date : m, G[0].date) },
  };
}

// ---- PROYECCIÓN DE UN PARTIDO ---------------------------------------------------------------------------
// Devuelve las medias esperadas. `neutral` quita la ventaja de campo (torneos, NCAA en sede neutral).
function project(R, homeId, awayId, { neutral = false } = {}) {
  if (!R) return null;
  const o = (id) => (R.off[id] || 0), d = (id) => (R.def[id] || 0), p = (id) => (R.pace[id] || 0);
  const hca = neutral ? 0 : R.hca;
  const poss = R.lgPace + p(homeId) + p(awayId);
  const hOrtg = R.lgORtg + o(homeId) + d(awayId) + hca / 2;
  const aOrtg = R.lgORtg + o(awayId) + d(homeId) - hca / 2;
  return {
    poss: +poss.toFixed(2),
    home_ortg: +hOrtg.toFixed(2), away_ortg: +aOrtg.toFixed(2),
    home_pts: +(poss * hOrtg / 100).toFixed(2), away_pts: +(poss * aOrtg / 100).toFixed(2),
    margin: +(poss * (hOrtg - aOrtg) / 100).toFixed(2), total: +(poss * (hOrtg + aOrtg) / 100).toFixed(2),
    known: { home: (R.n[homeId] || 0), away: (R.n[awayId] || 0) },
  };
}

// ---- DESCOMPOSICIÓN: POR QUÉ el modelo cree lo que cree --------------------------------------------------
// Convierte el rating en puntos de margen atribuidos a cada causa. La suma da el margen proyectado, así que
// el usuario puede auditar la cuenta entera — que es la diferencia entre una predicción y una explicación.
function decompose(R, homeId, awayId, { neutral = false } = {}) {
  if (!R) return null;
  const pr = project(R, homeId, awayId, { neutral });
  const k = pr.poss / 100;
  const parts = [
    { key: 'off_home', label: 'Ataque local', pp: +((R.off[homeId] || 0) * k).toFixed(2) },
    { key: 'def_away', label: 'Defensa visitante', pp: +((R.def[awayId] || 0) * k).toFixed(2) },
    { key: 'off_away', label: 'Ataque visitante', pp: +(-(R.off[awayId] || 0) * k).toFixed(2) },
    { key: 'def_home', label: 'Defensa local', pp: +(-(R.def[homeId] || 0) * k).toFixed(2) },
    { key: 'hca', label: 'Ventaja de cancha', pp: +((neutral ? 0 : R.hca) * k).toFixed(2) },
  ].sort((a, b) => Math.abs(b.pp) - Math.abs(a.pp));
  return { margin: pr.margin, parts, poss: pr.poss };
}

module.exports = { fitRatings, project, decompose, mean, sd };
