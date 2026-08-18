// f1-engine/ratings.js — COCHE × PILOTO (blueprint 7.0, bloque 07): la descomposición antes que el mercado.
//
// Estado latente en línea (walk-forward puro): por CONSTRUCTOR un pace de coche, por PILOTO un residual
// sobre su coche, y riesgos de abandono separados por coche (fiabilidad) y por piloto (incidentes).
// Las observaciones son z-scores de campo (clasificación y carrera), así el estado es comparable entre
// eras y tamaños de parrilla. Los cambios de REGLAMENTO (2022, 2026) descuentan el estado del coche con
// un factor MEDIDO en validación (F-0038: la historia se descuenta por distancia regulatoria, no solo
// por días) — el piloto conserva más: la mano viaja, el coche no.
'use strict';

const REG_BREAKS = { 2022: true, 2026: true };

function newState(C) {
  return {
    C,
    car: new Map(), drv: new Map(),          // id → {v, w}
    carDnf: new Map(), drvDnf: new Map(),    // id → {v, w} (tasa EW de abandono)
    lastSeason: null,
  };
}

const g = (m, k) => m.get(k) || { v: 0, w: 0 };
function ew(m, k, obs, alpha) {
  const o = m.get(k) || { v: 0, w: 0 };
  o.v = o.v * (1 - alpha) + obs; o.w = o.w * (1 - alpha) + 1;
  m.set(k, o);
}
function val(m, k, shrinkK) {
  const o = m.get(k); if (!o || !o.w) return { v: 0, n: 0 };
  const raw = o.v / o.w;
  return { v: shrinkK ? raw * (o.w / (o.w + shrinkK)) : raw, n: o.w };
}

// procesa UNA carrera terminada (rows: {d, c, grid, pos, q, status, txt})
function update(st, race) {
  const C = st.C;
  if (st.lastSeason != null && race.season !== st.lastSeason) {
    const keep = C.seasonKeep * (REG_BREAKS[race.season] ? C.regimeKeep : 1);
    const keepDrv = Math.min(1, keep + C.driverKeepBonus);
    for (const m of [st.car, st.carDnf]) for (const o of m.values()) o.w *= keep;
    for (const m of [st.drv, st.drvDnf]) for (const o of m.values()) o.w *= keepDrv;
    // el VALOR medio se conserva (v/w intacto): decae la CONFIANZA, y con regimeKeep decae más el coche
  }
  st.lastSeason = race.season;
  const rows = Object.values(race.rows);
  const classified = rows.filter((r) => r.pos != null);
  const m = classified.length;
  const zFin = (pos) => -((pos - (m + 1) / 2) / (((m - 1) / 2) || 1));
  const withQ = rows.filter((r) => r.q != null);
  const mq = withQ.length;
  const zQ = (q) => -((q - (mq + 1) / 2) / (((mq - 1) / 2) || 1));
  const obsBy = new Map();
  for (const r of rows) {
    const parts = [];
    if (r.pos != null) parts.push([1 - C.wq, zFin(r.pos)]);
    if (r.q != null) parts.push([C.wq, zQ(r.q)]);
    if (!parts.length) continue;
    const wsum = parts.reduce((s, p) => s + p[0], 0);
    obsBy.set(r.d, parts.reduce((s, p) => s + p[0] * p[1], 0) / wsum);
  }
  // coche primero (media de sus pilotos), piloto después (residual sobre el estado PREVIO del coche)
  const byCar = new Map();
  for (const r of rows) { if (obsBy.has(r.d)) (byCar.get(r.c) || byCar.set(r.c, []).get(r.c)).push(obsBy.get(r.d)); }
  const alphaC = Math.log(2) / C.hlCar, alphaD = Math.log(2) / C.hlDrv;
  const carPrev = new Map();
  for (const [cid, arr] of byCar) {
    carPrev.set(cid, val(st.car, cid).v);
    ew(st.car, cid, arr.reduce((s, x) => s + x, 0) / arr.length, alphaC);
  }
  for (const r of rows) {
    if (!obsBy.has(r.d)) continue;
    ew(st.drv, r.d, obsBy.get(r.d) - (carPrev.has(r.c) ? carPrev.get(r.c) : val(st.car, r.c).v), alphaD);
  }
  // abandonos: DNF = no clasificado y no DSQ/EX; alpha lento (la fiabilidad es de temporada)
  for (const r of rows) {
    const dnf = r.pos == null && !/^(D|E|W|F)$/.test(String(r.txt || '')) ? 1 : 0; // D=DSQ, E=excl, W=wd, F=fail-to-qualify
    ew(st.carDnf, r.c, dnf, Math.log(2) / C.hlDnf);
    ew(st.drvDnf, r.d, dnf, Math.log(2) / C.hlDnf);
  }
}

// el field de predicción para una carrera: perf = coche + piloto; dnf = base + coche + piloto (encogidos)
function fieldFor(st, entries, { useGrid = true } = {}) {
  const C = st.C;
  return entries.map((r) => {
    const car = val(st.car, r.c, C.shrinkCar), drv = val(st.drv, r.d, C.shrinkDrv);
    const cd = val(st.carDnf, r.c, C.shrinkDnf), dd = val(st.drvDnf, r.d, C.shrinkDnf);
    const dnf = Math.max(0.02, Math.min(0.45, C.dnfBase + 0.6 * cd.v + 0.4 * dd.v));
    return {
      id: r.d, cid: r.c, perf: car.v + drv.v, grid: useGrid ? (r.grid || r.q || null) : null, dnf,
      car_v: car.v, drv_v: drv.v, car_n: Math.round(car.n), drv_n: Math.round(drv.n),
    };
  });
}

const DEFAULTS = {
  hlCar: 10, hlDrv: 25, wq: 0.45, seasonKeep: 0.8, regimeKeep: 0.35, driverKeepBonus: 0.15,
  hlDnf: 30, shrinkCar: 2, shrinkDrv: 4, shrinkDnf: 8, dnfBase: 0.06,
};

module.exports = { newState, update, fieldFor, val, DEFAULTS, REG_BREAKS };
