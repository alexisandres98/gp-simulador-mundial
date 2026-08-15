// basketball-engine/officials.js — ENTORNO DE FALTAS POR EQUIPO ARBITRAL (16-ago).
// Módulos 121-125 del blueprint.
//
// LA LÍNEA QUE NO SE CRUZA. El blueprint es explícito: "GP debe evitar narrativas de sesgo basadas en
// muestras pequeñas" y el diferencial local/visitante es "descriptivo y regularizado; nunca una acusación
// causal". Acá se mide UNA cosa —cuántas faltas y tiros libres se pitan por posesión con cada terna— y se
// mide con el listón alto, porque:
//   · un árbitro pita 20-40 partidos por temporada, no 200;
//   · las faltas dependen muchísimo más de QUIÉN JUEGA que de quién pita (un equipo que ataca el aro genera
//     faltas con cualquier terna), así que sin controlar por los equipos se mide el calendario del árbitro,
//     no al árbitro;
//   · y el efecto real, cuando existe, es pequeño: mueve el total un punto, no cinco.
//
// CÓMO SE MIDE BIEN. Igual que el contexto de calendario: sobre RESIDUOS. Para cada partido se calcula
// cuántos tiros libres "tocaban" dadas las dos plantillas (la media de los dos equipos en la temporada) y
// se mira cuánto se desvió lo que pitó esa terna. La media de esos residuos, encogida por número de
// partidos, es el efecto del árbitro. Si el intervalo cruza el cero, el efecto es cero y así se publica.
//
// Y EL GATE FINAL: este módulo NO entra al modelo hasta que demuestre mejora fuera de muestra, igual que
// las demás capas. El blueprint lo dice en el módulo 125: "peso pequeño por defecto y apagado automático
// si no aporta mejora estable".
'use strict';

const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const played = (g) => g && g.home && g.home.pts != null && (g.officials || []).length > 0;

// Clave de la terna: los nombres ordenados. Se analiza la TERNA y también cada árbitro por separado,
// porque las dos preguntas son distintas y la muestra por terna es siempre minúscula.
const crewKey = (offs) => (offs || []).slice().sort().join(' · ');

// ---- LÍNEA BASE POR EQUIPO -------------------------------------------------------------------------------
// Lo que cada equipo genera y concede, por 100 posesiones, en toda la temporada. Es contra esto que se mide
// la desviación de una terna.
function teamBaselines(games) {
  const acc = new Map();
  const bump = (id, k, v) => { const c = acc.get(id) || { fta: 0, fta_ag: 0, pf: 0, pf_ag: 0, poss: 0, n: 0 }; c[k] += v; acc.set(id, c); };
  for (const g of games) {
    if (!g || g.home.pts == null) continue;
    const poss = g.poss || 100;
    for (const [me, foe] of [[g.home, g.away], [g.away, g.home]]) {
      bump(String(me.id), 'fta', me.fta || 0); bump(String(me.id), 'fta_ag', foe.fta || 0);
      bump(String(me.id), 'pf', me.pf || 0); bump(String(me.id), 'pf_ag', foe.pf || 0);
      bump(String(me.id), 'poss', poss); bump(String(me.id), 'n', 1);
    }
  }
  const out = {};
  for (const [id, c] of acc) if (c.poss > 0) out[id] = {
    fta_per100: (100 * c.fta) / c.poss, fta_ag_per100: (100 * c.fta_ag) / c.poss,
    pf_per100: (100 * c.pf) / c.poss, pf_ag_per100: (100 * c.pf_ag) / c.poss, games: c.n,
  };
  return out;
}

// ---- EFECTO DE LA TERNA ----------------------------------------------------------------------------------
// Para cada partido: esperado = (lo que el local suele generar + lo que el visitante suele conceder) / 2,
// sumado por los dos lados. Observado = lo que pasó. El residuo es lo que hay que explicar.
function fitOfficials(games, { minGames = 8, prior = 20 } = {}) {
  const gs = games.filter(played);
  if (gs.length < 40) return { ok: false, n: gs.length, reason: 'muestra insuficiente: hacen falta al menos 40 partidos con terna registrada' };
  const base = teamBaselines(gs);
  const rows = [];
  for (const g of gs) {
    const h = String(g.home.id), a = String(g.away.id);
    if (!base[h] || !base[a]) continue;
    const poss = g.poss || 100;
    const expFta = ((base[h].fta_per100 + base[a].fta_ag_per100) / 2 + (base[a].fta_per100 + base[h].fta_ag_per100) / 2) * poss / 100;
    const expPf = ((base[h].pf_per100 + base[a].pf_ag_per100) / 2 + (base[a].pf_per100 + base[h].pf_ag_per100) / 2) * poss / 100;
    const obsFta = (g.home.fta || 0) + (g.away.fta || 0);
    const obsPf = (g.home.pf || 0) + (g.away.pf || 0);
    rows.push({ crew: crewKey(g.officials), offs: g.officials || [],
      d_fta: obsFta - expFta, d_pf: obsPf - expPf,
      // el diferencial local-visitante, SOLO descriptivo (módulo 122)
      d_home_edge: ((g.away.pf || 0) - (g.home.pf || 0)) - ((base[a].pf_per100 - base[h].pf_per100) * poss / 100),
      date: g.date, poss });
  }
  if (rows.length < 40) return { ok: false, n: rows.length, reason: 'pocos partidos con equipos de línea base conocida' };

  const sdOf = (arr, f) => { const m = arr.reduce((s, x) => s + f(x), 0) / arr.length; return Math.sqrt(arr.reduce((s, x) => s + (f(x) - m) ** 2, 0) / Math.max(1, arr.length - 1)); };
  const sdFta = sdOf(rows, (r) => r.d_fta), sdPf = sdOf(rows, (r) => r.d_pf);

  const group = (keyFn) => {
    const m = new Map();
    for (const r of rows) for (const k of [].concat(keyFn(r))) {
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()].filter(([, v]) => v.length >= minGames).map(([k, v]) => {
      const mean = (f) => v.reduce((s, x) => s + f(x), 0) / v.length;
      const mFta = mean((x) => x.d_fta), mPf = mean((x) => x.d_pf), mEdge = mean((x) => x.d_home_edge);
      // ENCOGIMIENTO: n/(n+prior). Con prior=20, un árbitro de 20 partidos entra a la mitad.
      const w = v.length / (v.length + prior);
      const seFta = sdFta / Math.sqrt(v.length), sePf = sdPf / Math.sqrt(v.length);
      return {
        key: k, games: v.length,
        fta_delta: r2(mFta), fta_delta_shrunk: r2(w * mFta), fta_se: r2(seFta), fta_t: r2(mFta / seFta),
        pf_delta: r2(mPf), pf_delta_shrunk: r2(w * mPf), pf_se: r2(sePf), pf_t: r2(mPf / sePf),
        home_edge_pf: r2(mEdge),
        shrink: r3(w),
        // el veredicto por elemento: solo se considera real lo que sobrevive a |t| >= 2
        real: Math.abs(mFta / seFta) >= 2 || Math.abs(mPf / sePf) >= 2,
      };
    }).sort((x, y) => Math.abs(y.fta_delta_shrunk) - Math.abs(x.fta_delta_shrunk));
  };

  const crews = group((r) => r.crew);
  const refs = group((r) => r.offs);
  // CONTROL DE PRUEBAS MÚLTIPLES (módulo 200). Probar 32 árbitros al 5% produce ~1,6 "significativos" por
  // puro azar. Contar los que pasan |t| >= 2 y llamarlos hallazgos es minería de ruido con formato de
  // ciencia. Benjamini-Hochberg controla la tasa de falsos descubrimientos: se ordenan los p-valores y solo
  // sobrevive lo que supera un listón que se endurece con el número de pruebas.
  const fdr = bhSurvivors(refs.map((r) => ({ key: r.key, t: r.fta_t })), 0.10);
  for (const r of refs) r.survives_fdr = fdr.survivors.indexOf(r.key) >= 0;
  const anyReal = refs.filter((x) => x.survives_fdr);

  return {
    ok: true, n: rows.length, games_with_officials: gs.length,
    sd_fta: r2(sdFta), sd_pf: r2(sdPf),
    crews: crews.slice(0, 15), referees: refs.slice(0, 25),
    n_referees: refs.length, n_significant: refs.filter((x) => x.real).length,
    n_survives_fdr: anyReal.length, fdr,
    // CONVERSIÓN A PUNTOS, que es lo único que le importa al modelo de totales: un tiro libre vale ~0,77
    // puntos en estas ligas. Un delta de +2 tiros libres es +1,5 puntos de total, no una revolución.
    points_per_fta: 0.77,
    verdict: anyReal.length === 0
      ? `ninguno de los ${refs.length} árbitros sobrevive al control de falsos descubrimientos (${refs.filter((x) => x.real).length} pasan |t|>=2, que es lo que produce el azar al hacer ${refs.length} pruebas). El entorno de faltas NO se usa en el modelo.`
      : `${anyReal.length} de ${refs.length} árbitros sobreviven al control de falsos descubrimientos; aun así la capa queda apagada hasta que valide fuera de muestra`,
    applies: false,      // GATE DURO: no entra al modelo hasta que scripts/hoops-validate.js lo respalde
    note: 'medido sobre residuos contra la línea base de los dos equipos; el diferencial local/visitante es descriptivo y no implica sesgo',
  };
}

// ---- AJUSTE PARA UN PARTIDO CONCRETO ---------------------------------------------------------------------
// Devuelve el efecto esperado de la terna anunciada, en tiros libres y en puntos de total. Solo devuelve
// algo distinto de cero si `applies` está encendido, que hoy no lo está.
function officialsAdjust(fit, officials) {
  if (!fit || !fit.ok || !officials || !officials.length) return null;
  const byName = new Map((fit.referees || []).map((r) => [r.key, r]));
  const hits = officials.map((n) => byName.get(n)).filter(Boolean);
  if (!hits.length) return { known: false, note: 'terna sin historial suficiente en nuestra muestra' };
  const fta = hits.reduce((s, r) => s + (r.fta_delta_shrunk || 0), 0) / hits.length;
  return {
    known: true, referees: hits.map((r) => ({ name: r.key, games: r.games, fta_delta: r.fta_delta_shrunk, t: r.fta_t, real: r.real })),
    fta_delta: r2(fta), total_pts_delta: r2(fta * (fit.points_per_fta || 0.77)),
    applied: !!fit.applies,
    note: fit.applies ? null : 'medido, no aplicado: la capa no ha validado fuera de muestra',
  };
}

// ---- BENJAMINI-HOCHBERG ---------------------------------------------------------------------------------
// Convierte t en p (normal de dos colas, suficiente con estas muestras), ordena, y acepta hasta el mayor i
// tal que p(i) <= (i/m)·q. Es el estándar mínimo cuando se prueban decenas de hipótesis a la vez.
function normSf(z) {                                  // 1 - Φ(|z|), Abramowitz-Stegun
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 - y);
}
function bhSurvivors(tests, q = 0.10) {
  const rows = tests.filter((x) => Number.isFinite(x.t)).map((x) => ({ key: x.key, p: 2 * normSf(x.t) }))
    .sort((a, b) => a.p - b.p);
  const m = rows.length;
  let kMax = -1;
  rows.forEach((r, i) => { r.threshold = ((i + 1) / m) * q; if (r.p <= r.threshold) kMax = i; });
  return {
    q, tests: m, survivors: kMax >= 0 ? rows.slice(0, kMax + 1).map((r) => r.key) : [],
    smallest_p: rows.length ? +rows[0].p.toFixed(4) : null,
    threshold_at_1: m ? +((1 / m) * q).toFixed(4) : null,
    note: 'Benjamini-Hochberg: controla la fracción esperada de falsos hallazgos entre los aceptados',
  };
}

module.exports = { crewKey, teamBaselines, fitOfficials, officialsAdjust, bhSurvivors };
