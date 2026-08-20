// scripts/combat-calibra.js — ¿EL SIMULADOR DE RUTAS ACIERTA CUÁNTO DURA UNA PELEA? (20-ago)
//
// POR QUÉ ESTE Y NO OTRO. De todo lo que hay en la casa, la ÚNICA familia con CLV positivo y ejecutable por
// API es ROUNDS de combate: +1,75 % sobre 27 en Cloudbet. El banco de variables del script hermano ya dijo
// que ni el árbitro, ni la báscula, ni el parón, ni la edad añaden nada. Queda la otra mitad de la pregunta,
// que es más importante: la variable que SÍ manda —la tendencia de finalización del cruce— ya está dentro
// del modelo, así que lo que falta no es información nueva sino saber si el simulador la USA BIEN.
//
// Una probabilidad puede estar informada y mal calibrada a la vez. Si el simulador dice 55 % de finalización
// cuando la realidad es 60 %, cada under de rondas que emite nace con cinco puntos en contra y ninguna
// cantidad de variables nuevas lo arregla.
//
// CÓMO SE MIDE SIN HACERSE TRAMPAS. Para cada año se reconstruyen los perfiles SOLO con las peleas
// anteriores a ese año —`buildProfiles` acepta la ventana y el `now` del decaimiento— y se simula cada
// pelea del año con esos perfiles. Es la misma disciplina del resto de la casa: el modelo nunca ve el
// futuro, ni siquiera de refilón por la media de un rival.
//
// QUÉ DEVUELVE. Tres lecturas, y las tres importan por separado:
//   1. el sesgo global (predicho − real) sobre "¿termina antes del límite?";
//   2. la curva de calibración por decil de probabilidad — dónde exactamente se tuerce;
//   3. el sesgo POR TRAMO DE TENDENCIA del cruce, que es la pregunta de verdad: ¿reacciona de menos a los
//      cruces que terminan mucho y de más a los que no terminan nunca?
'use strict';

const fs = require('fs');
const path = require('path');
const PH = require('../combat-engine/phases');
const SY = require('../combat-engine/style');
const FS_ = require('../combat-engine/fightsim');

const DIR = path.join(__dirname, '..', 'data', 'combat');
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };

const FINISH = new Set(['kotko', 'submission', 'tko---doctors-stoppage', 'tko']);
const NO_VALE = new Set(['no-contest', 'dq', 'draw', 'overturned']);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

(function main() {
  const liga = arg('liga', 'ufc');
  const SIMS = +arg('sims', 1500);
  const DESDE = +arg('desde', 2016);
  const HASTA = +arg('hasta', 2026);
  const F = rd(`fights-${liga}.json`);
  const S = rd(`espnstats-${liga}.json`) || rd(`afstats-${liga}.json`);
  if (!F || !S) { console.log('[calibra] faltan datos de', liga); process.exit(1); }
  const fights = (Array.isArray(F.fights) ? F.fights : Object.values(F.fights || {}))
    .filter((f) => f && f.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const stats = S.stats || S;

  // tendencia de finalización del cruce, PUNTO EN EL TIEMPO (idéntica al script hermano: es la variable que
  // el banco identificó como dominante y aquí se usa solo para PARTIR la muestra, no para predecir)
  const hist = new Map();
  const tendencia = new Map();     // comp_id → tramo
  const tramo = (v) => (v == null ? null : v < 0.15 ? 'muy bajo' : v < 0.30 ? 'bajo' : v < 0.45 ? 'medio' : v < 0.60 ? 'alto' : 'muy alto');
  for (const f of fights) {
    const h = (id) => hist.get(id) || { n: 0, favor: 0, contra: 0 };
    const h1 = h(f.f1 && f.f1.id), h2 = h(f.f2 && f.f2.id);
    const tasa = (x, c) => (x.n >= 3 ? x[c] / x.n : null);
    const partes = [tasa(h1, 'favor'), tasa(h2, 'favor'), tasa(h1, 'contra'), tasa(h2, 'contra')].filter((x) => x != null);
    tendencia.set(String(f.comp_id), partes.length >= 2 ? tramo(media(partes)) : null);
    if (f.completed && f.method && !NO_VALE.has(f.method.name)) {
      const fin = FINISH.has(f.method.name) ? 1 : 0;
      for (const [lado] of [[f.f1], [f.f2]]) {
        if (!lado || !lado.id) continue;
        const x = hist.get(lado.id) || { n: 0, favor: 0, contra: 0 };
        x.n++; if (fin) { if (lado.winner) x.favor++; else x.contra++; }
        hist.set(lado.id, x);
      }
    }
  }

  const filas = [];
  let sinPerfil = 0, sinSim = 0;
  for (let y = DESDE; y <= HASTA; y++) {
    const corte = Date.parse(`${y}-01-01T00:00Z`);
    const pasado = fights.filter((f) => Date.parse(f.date) < corte);
    const test = fights.filter((f) => String(f.date).slice(0, 4) === String(y)
      && f.completed && f.method && !NO_VALE.has(f.method.name) && f.end_round);
    if (pasado.length < 1500 || !test.length) continue;
    const B = PH.buildProfiles(pasado, stats, { now: corte });
    const vecs = SY.styleVectors(B.profiles);
    let n = 0;
    for (const f of test) {
      const pa = B.profiles.get(String(f.f1.id)), pb = B.profiles.get(String(f.f2.id));
      if (!pa || !pb) { sinPerfil++; continue; }
      const sa = vecs.get(String(f.f1.id)), sb = vecs.get(String(f.f2.id));
      let sim = null;
      try { sim = FS_.simulate(pa, pb, { rounds: f.rounds_sched || 3, n: SIMS, seed: 17, sa, sb }); } catch { sim = null; }
      if (!sim || !sim.distance) { sinSim++; continue; }
      filas.push({
        año: y, comp_id: String(f.comp_id),
        p_fin: sim.distance.finish_prob != null ? sim.distance.finish_prob : 1 - sim.distance.prob,
        real: FINISH.has(f.method.name) ? 1 : 0,
        tramo: tendencia.get(String(f.comp_id)) || 'sin dato',
        rounds: f.rounds_sched || 3,
      });
      n++;
    }
    console.log(`[calibra] ${y}: ${n} peleas simuladas (perfiles de ${B.profiles.size} peleadores sobre ${pasado.length} peleas previas)`);
  }
  if (!filas.length) { console.log('[calibra] sin filas'); process.exit(1); }

  const pred = media(filas.map((r) => r.p_fin)), real = media(filas.map((r) => r.real));
  const brier = media(filas.map((r) => (r.p_fin - r.real) ** 2));
  console.log('');
  console.log(`[calibra] ${filas.length} peleas · sin perfil ${sinPerfil} · sin simulación ${sinSim}`);
  console.log(`[calibra] SESGO GLOBAL: predicho ${(100 * pred).toFixed(1)} % · real ${(100 * real).toFixed(1)} % · sesgo ${(100 * (pred - real)).toFixed(2)} pp · Brier ${brier.toFixed(5)}`);

  // curva de calibración por decil de probabilidad predicha
  const orden = filas.slice().sort((a, b) => a.p_fin - b.p_fin);
  const D = 10, porDecil = [];
  for (let i = 0; i < D; i++) {
    const g = orden.slice(Math.floor(i * orden.length / D), Math.floor((i + 1) * orden.length / D));
    if (!g.length) continue;
    porDecil.push({ decil: i + 1, n: g.length, predicho: r3(media(g.map((x) => x.p_fin))), real: r3(media(g.map((x) => x.real))) });
  }
  console.log('');
  console.log('CURVA DE CALIBRACIÓN (por decil de probabilidad predicha)');
  for (const d of porDecil) console.log(`   decil ${String(d.decil).padStart(2)} n=${String(d.n).padStart(4)} predicho ${(100 * d.predicho).toFixed(1)} % · real ${(100 * d.real).toFixed(1)} % · sesgo ${((d.predicho - d.real) * 100).toFixed(1).padStart(6)} pp`);

  // LA PREGUNTA DE VERDAD: ¿reacciona de menos donde la tendencia manda?
  const TRAMOS = ['muy bajo', 'bajo', 'medio', 'alto', 'muy alto', 'sin dato'];
  const porTramo = [];
  console.log('');
  console.log('SESGO POR TRAMO DE TENDENCIA DEL CRUCE');
  for (const t of TRAMOS) {
    const g = filas.filter((r) => r.tramo === t);
    if (g.length < 40) continue;
    const p = media(g.map((x) => x.p_fin)), q = media(g.map((x) => x.real));
    // error estándar de la tasa real, para saber si el desvío cabe en el ruido
    const se = Math.sqrt(q * (1 - q) / g.length);
    const z = se > 0 ? (q - p) / se : null;
    porTramo.push({ tramo: t, n: g.length, predicho: r3(p), real: r3(q), sesgo_pp: r3(100 * (p - q)), z: r3(z) });
    console.log(`   ${t.padEnd(10)} n=${String(g.length).padStart(4)} predicho ${(100 * p).toFixed(1)} % · real ${(100 * q).toFixed(1)} % · sesgo ${(100 * (p - q)).toFixed(1).padStart(6)} pp · z=${z != null ? z.toFixed(2) : '-'}`);
  }

  // por asaltos programados: 3 y 5 no son la misma pelea
  console.log('');
  console.log('POR ASALTOS PROGRAMADOS');
  for (const rr of [3, 5]) {
    const g = filas.filter((r) => r.rounds === rr);
    if (g.length < 40) continue;
    console.log(`   ${rr} asaltos n=${String(g.length).padStart(4)} predicho ${(100 * media(g.map((x) => x.p_fin))).toFixed(1)} % · real ${(100 * media(g.map((x) => x.real))).toFixed(1)} %`);
  }

  const out = {
    at: new Date().toISOString(), liga, sims: SIMS, ventana: `${DESDE}-${HASTA}`,
    n: filas.length, predicho: r3(pred), real: r3(real), sesgo_pp: r3(100 * (pred - real)), brier: +brier.toFixed(5),
    por_decil: porDecil, por_tramo: porTramo,
    nota: 'Perfiles reconstruidos año a año SOLO con peleas anteriores (walk-forward nativo). El sesgo es predicho − real sobre "termina antes del límite": positivo = el simulador ve más finalizaciones de las que hay.',
  };
  fs.writeFileSync(path.join(DIR, `calibracion-rutas-${liga}.json`), JSON.stringify(out, null, 1));
  console.log('');
  console.log(`[calibra] escrito data/combat/calibracion-rutas-${liga}.json`);
})();
