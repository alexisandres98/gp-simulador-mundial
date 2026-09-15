#!/usr/bin/env node
// scripts/tt-challengers.js — LOS ASPIRANTES DEL TOTAL DE PUNTOS DE TENIS DE MESA (T2.11 y T2.13)
//
//   node scripts/tt-challengers.js [--solo=poblacion|duracion|challengers] [--desde=20240101]
//                                  [--eval-desde=20250101] [--json=<salida>] [--cache=<records.json>]
//
// POR QUÉ EXISTE. El compilador exacto de `tt-engine/compiler.js` nunca se comparó con nada: se validó
// contra sí mismo (constantes elegidas por log-loss del GANADOR) y contra una referencia naif de media
// constante. Un modelo que gana a nada no ha ganado nada — la misma frase que abrió `lib/conteos.js` para
// tarjetas. Aquí se le ponen delante tres aspirantes y dos controles obligatorios, sobre las MISMAS filas,
// con validación hacia adelante y los hiperparámetros elegidos DENTRO del entrenamiento.
//
// LO QUE SE MIDE, EN ORDEN:
//   1. POBLACIÓN (T2.13). Solo 30.644 de 192.460 filas tienen fecha exacta. Antes de validar nada hay que
//      saber si esa cuarta parte es una muestra o un recorte. NO se imputan fechas: imputar la fecha para
//      después validar por fecha destruye la propia validación.
//   2. DURACIÓN (T2.11). E[puntos] = Σ_k P(n_games = k) · E[puntos | n_games = k], con las dos mitades
//      medidas por separado. El holdout dice 71,885 puntos reales contra 71,232 del modelo: la pregunta es
//      si ese déficit está en el reparto de duraciones o en los puntos de cada game.
//   3. ASPIRANTES. TT0 (el compilador de producción, tal cual), TT1 (Elo recalibrado + empírico por
//      gap×formato), TT2 (saque/resto jerárquico — solo si es identificable), TT3 (forma persistente),
//      más dos controles: C1 empírico por formato a secas y C2 binomial negativa con la media del
//      compilador. C2 es el que contesta si la FORMA del compilador aporta algo sobre dos momentos.
//
// UNA ADVERTENCIA DE MÉTODO QUE VALE PARA TODO EL ARCHIVO. Aquí no se mide ventaja contra ningún precio:
// se mide quién describe mejor el total de puntos. Ganar esto es condición NECESARIA Y NO SUFICIENTE; el
// listón del dinero sigue siendo `lib/vara.js` y `lib/ev.js`.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const D = require('../tt-engine/data');
const C = require('../tt-engine/compiler');
const R = require('../tt-engine/rules');
const CT = require('../lib/conteos');
const INF = require('../lib/inferencia');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true]; }));
const SOLO = String(args.solo || 'todo');
const DESDE = +(args.desde || 20240101);          // primera fila que se RECOGE (necesita ratings ya calientes)
const EVAL_DESDE = +(args['eval-desde'] || 20250101); // primer bloque que se EVALÚA; lo anterior es entrenamiento
const KMAX = 240;                                  // total de puntos máximo representado (BO7 largo ≈ 160)
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r5 = (x) => (Number.isFinite(x) ? +x.toFixed(5) : null);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));
const suma = (a) => a.reduce((x, y) => x + y, 0);
const media = (a) => (a.length ? suma(a) / a.length : null);

// LAS LÍNEAS QUE CLOUDBET OFRECE DE VERDAD (no 2,5/3,5 de laboratorio). Salen del libro real de
// `real-executor/tt.js`: 69,5 · 73,5 · 74,5 · 75,5 en los partidos al mejor de 5 y 106,5 · 107,5 en los de 7.
// Calibrar en líneas que la casa no cotiza es medir una superficie que nadie paga.
const LINEAS = { 5: [69.5, 73.5, 74.5, 75.5], 7: [106.5, 107.5] };

// ══ 0. LA BASE ═════════════════════════════════════════════════════════════════════════════════════════
// OJO (hallazgo de esta sesión): `D.build()` recorta las filas en memoria a 2020→ para caber en los 512 MB
// de Render, y `scripts/tt-fit.js` reproduce ESE recorte, no el historial entero. Aquí se lee el compacto
// directo para que el replay sea el mismo que el de producción (que sí absorbe las 192.460 filas).
function cargaBase() {
  const p = ['matches.json', 'matches.json.gz'].map((n) => path.join(D.REPO_BASE, n)).find((f) => fs.existsSync(f));
  if (!p) throw new Error('no encuentro data/tt/matches.json[.gz]');
  const raw = fs.readFileSync(p);
  const m = JSON.parse(p.endsWith('.gz') ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8'));
  const F = {}; (m.schema || []).forEach((k, i) => { F[k] = i; });
  const rows = (m.rows || []).slice().sort((a, b) => a[F.date] - b[F.date] || String(a[F.tid]).localeCompare(String(b[F.tid])));
  const priors = JSON.parse(fs.readFileSync(path.join(D.REPO_BASE, 'model-priors.json'), 'utf8'));
  const players = JSON.parse(fs.readFileSync(path.join(D.REPO_BASE, 'players.json'), 'utf8'));
  return { F, rows, tourneys: m.tourneys || {}, cst: { ...D.DEFAULT_PRIORS.constants, ...(priors.constants || {}) }, priors, players };
}
const juegos = (s) => String(s || '').split(',').map((g) => { const m = g.match(/^(\d+)-(\d+)$/); return m ? [+m[1], +m[2]] : null; }).filter(Boolean);

// ══ 1. POBLACIÓN VÁLIDA (T2.13) ════════════════════════════════════════════════════════════════════════
// La pregunta no es "cuántas filas tienen fecha" sino "en qué se diferencian las que no la tienen". Si la
// ausencia de fecha fuera aleatoria, validar sobre las fechadas sería validar sobre una muestra. Si la
// ausencia sigue un patrón —y aquí lo sigue— entonces la validación temporal cubre una POBLACIÓN DISTINTA
// de la que entrenó los ratings, y eso hay que escribirlo, no taparlo con una imputación.
function poblacion(B) {
  const { F, rows, tourneys, players } = B;
  const tab = (clave) => {
    const t = new Map();
    for (const r of rows) {
      const k = clave(r); if (k === null || k === undefined) continue;
      const v = t.get(String(k)) || { n: 0, d: 0 }; v.n++; if (r[F.dated]) v.d++; t.set(String(k), v);
    }
    return [...t.entries()].sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => ({ clave: k, n: v.n, con_fecha: v.d, pct: r3(100 * v.d / v.n) }));
  };
  const n = rows.length, nd = rows.filter((r) => r[F.dated]).length;

  // experiencia acumulada del jugador EN EL MOMENTO del partido: el proxy honesto de "nivel"
  const cnt = new Map(); const g = (k) => cnt.get(k) || 0;
  const obs = { d: [], u: [] };            // observables por partido, para el bootstrap
  const exp = { d: [], u: [] };
  const rnk = { d: [], u: [] };
  const jug = { d: new Set(), u: new Set() };
  for (const r of rows) {
    const A = r[F.wid], B2 = r[F.lid];
    const k = r[F.dated] ? 'd' : 'u';
    exp[k].push((g(A) + g(B2)) / 2);
    for (const id of [A, B2]) { const p = players[id]; if (p && p.rank) rnk[k].push(p.rank); jug[k].add(id); }
    const gs = juegos(r[F.games]);
    if (gs.length && !r[F.ret]) {
      let pts = 0, deu = 0;
      for (const [x, y] of gs) { pts += x + y; if (x + y >= 22) deu++; }
      const tq = tourneys[r[F.tid]] || {};
      obs[k].push({ tid: r[F.tid], pts, ng: gs.length, deu, barrida: r[F.lg] === 0 ? 1 : 0, ppg: pts / gs.length, bo: r[F.bo],
        mayores: !(tq.youth || tq.tier === 'youth') });
    }
    cnt.set(A, g(A) + 1); cnt.set(B2, g(B2) + 1);
  }
  // los observables se comparan con bootstrap por TORNEO: dos partidos del mismo torneo comparten
  // jugadores, mesa, pelota y juez; contarlos como independientes estrecha el intervalo de mentira.
  const boot = (arr, val) => INF.bootstrapClusters(arr, { valor: val, cluster: (x) => x.tid, replicas: 1000, semilla: 42 });
  const comp = (val, etiqueta, filtro = null) => {
    const dd = filtro ? obs.d.filter(filtro) : obs.d, uu = filtro ? obs.u.filter(filtro) : obs.u;
    const a = boot(dd, val), b = boot(uu, val);
    return { que: etiqueta, con_fecha: { media: a.media, ic: a.ic, n: a.n_items, racimos: a.n_clusters },
      sin_fecha: { media: b.media, ic: b.ic, n: b.n_items, racimos: b.n_clusters },
      dif: r4(a.media - b.media), solapan: !(a.ic[1] < b.ic[0] || b.ic[1] < a.ic[0]) };
  };

  // la era de los 21 puntos (el reglamento cambió en septiembre de 2001): esas filas no son el mismo deporte
  let e21 = 0, e21d = 0;
  for (const r of rows) {
    const gs = juegos(r[F.games]); if (!gs.length) continue;
    const hi = gs.map(([x, y]) => Math.max(x, y));
    if (hi.some((h) => h >= 21 && h <= 25) && !hi.some((h) => h === 11)) { e21++; if (r[F.dated]) e21d++; }
  }

  return {
    total: n, con_fecha: nd, pct_con_fecha: r3(100 * nd / n),
    por_anio: tab((r) => Math.floor(r[F.date] / 10000)),
    por_nivel: tab((r) => (tourneys[r[F.tid]] || {}).tier),
    por_juvenil: tab((r) => ((tourneys[r[F.tid]] || {}).youth || (tourneys[r[F.tid]] || {}).tier === 'youth' ? 'juvenil' : 'mayores')),
    por_sexo: tab((r) => r[F.sub]),
    por_ronda: tab((r) => r[F.round]),
    por_formato: tab((r) => r[F.bo]),
    por_retirada: tab((r) => (r[F.ret] ? 'retirada' : 'completo')),
    jugadores: { con_fecha: jug.d.size, sin_fecha: jug.u.size, en_ambos: [...jug.d].filter((x) => jug.u.has(x)).length,
      solo_sin_fecha: [...jug.u].filter((x) => !jug.d.has(x)).length },
    experiencia_media: { con_fecha: r3(media(exp.d)), sin_fecha: r3(media(exp.u)) },
    ranking_medio: { con_fecha: r3(media(rnk.d)), sin_fecha: r3(media(rnk.u)),
      cobertura_pct: { con_fecha: r3(100 * rnk.d.length / (2 * obs.d.length || 1)), sin_fecha: r3(100 * rnk.u.length / (2 * obs.u.length || 1)) } },
    observables: [
      comp((x) => x.pts, 'puntos por partido'),
      comp((x) => x.ng, 'games por partido'),
      comp((x) => x.ppg, 'puntos por game'),
      comp((x) => x.deu / x.ng, 'tasa de deuce por game'),
      comp((x) => x.barrida, 'barridas (sin réplica)'),
      // la comparación de verdad exigente: el MISMO estrato. Si el deporte fuera otro, los puntos por game
      // de un BO5 de mayores tendrían que moverse; si no se mueven, lo que cambia es la MEZCLA, no el juego.
      comp((x) => x.ppg, 'pts/game · mayores BO5', (x) => x.mayores && x.bo === 5),
      comp((x) => x.pts, 'puntos · mayores BO5', (x) => x.mayores && x.bo === 5),
      comp((x) => x.deu / x.ng, 'deuce/game · mayores BO5', (x) => x.mayores && x.bo === 5),
      comp((x) => x.ppg, 'pts/game · juvenil BO5', (x) => !x.mayores && x.bo === 5),
    ],
    era_21_puntos: { filas: e21, con_fecha: e21d, pct: r4(100 * e21 / n) },
  };
}

// ══ 2. RECOLECCIÓN WALK-FORWARD ════════════════════════════════════════════════════════════════════════
// Un solo replay cronológico con las constantes CONGELADAS de producción. Para cada fila evaluable de la
// ventana se guarda todo lo que hace falta para puntuar a cualquier aspirante DESPUÉS, sin volver a
// reproducir el historial. Todo lo que se guarda es point-in-time: la predicción se emite antes de que el
// resultado toque los ratings, incluidas las medias móviles de ritmo que usa TT3.
const MEDIAS_VIDA = [5, 10, 20, 40];   // vidas medias (en partidos) de la memoria de ritmo de TT3
function recolecta(B) {
  const { F, rows, tourneys, cst } = B;
  const recs = [];
  // ritmo: cuánto se desvía un jugador de los puntos por game que el compilador le predice. Una sola
  // desviación por PARTIDO (es una magnitud del duelo), que los dos jugadores heredan.
  const ritmo = new Map();    // id → { ewma: {hl: valor}, n }
  const getRitmo = (id) => ritmo.get(id) || { ewma: Object.fromEntries(MEDIAS_VIDA.map((h) => [h, 0])), n: 0 };
  const ultima = new Map();
  const dias = (a, b) => Math.round((Date.UTC(Math.floor(a / 10000), Math.floor(a / 100) % 100 - 1, a % 100) - Date.UTC(Math.floor(b / 10000), Math.floor(b / 100) % 100 - 1, b % 100)) / 864e5);

  D.replay(rows, F, tourneys, cst, (r, pr) => {
    const fecha = r[F.date];
    const A = r[F.wid], Bp = r[F.lid];
    const tq = tourneys[r[F.tid]] || {};
    const gs = pr.games;
    const evaluable = !r[F.ret] && (r[F.sub] === 'MS' || r[F.sub] === 'WS') && !(tq.youth || tq.tier === 'youth')
      && pr.nA >= cst.warmN && pr.nB >= cst.warmN && pr.bo && gs.length >= 3;
    let mm = null, pD = null;
    if (evaluable) {
      // TT0 exactamente como lo compila producción (`tt-engine/data.js:matchModel`, rama de distribuciones)
      const p0 = clamp(sig(pr.thA - pr.thB), 0.05, 0.95);
      pD = clamp(0.5 + (cst.pointScaleDist || cst.pointScale) * (p0 - 0.5), 0.05, 0.95);
      const a = +clamp(pD + cst.serveDelta, 0.02, 0.98).toFixed(3);
      const b = +clamp(pD - cst.serveDelta, 0.02, 0.98).toFixed(3);
      mm = C.compileMatch(a, b, { best_of: pr.bo });
      if (fecha >= DESDE) {
        const pts = pr.pw + pr.pl;
        const deu = gs.filter(([x, y]) => x + y >= 22).length;
        const rA = getRitmo(A), rB = getRitmo(Bp);
        recs.push({
          d: fecha, tid: r[F.tid], tier: tq.tier || 'other', ronda: r[F.round], sexo: r[F.sub], bo: pr.bo,
          fechada: !!r[F.dated], wid: A, lid: Bp,
          a, b, p_pt: r4(pD), p_elo: r4(pr.pElo),
          n_a: pr.nA, n_b: pr.nB,
          idle_a: ultima.has(A) ? dias(fecha, ultima.get(A)) : null,
          idle_b: ultima.has(Bp) ? dias(fecha, ultima.get(Bp)) : null,
          // el resultado
          pts, ng: gs.length, wg: r[F.wg], lg: r[F.lg], deu,
          juegos: gs.map(([x, y]) => [x, y]),
          // TT0 ya leído (para no recompilar en cada bloque)
          exp_pts: r4(mm.exp_points), exp_games: r4(mm.exp_games),
          p_deuce: r4(mm.per_game[0].p_deuce),
          p_barrida: r4(C.at(mm.score, `${mm.format.need}-0`) + C.at(mm.score, `0-${mm.format.need}`)),
          // memoria de ritmo ANTES de este partido, una por vida media
          ritmo: Object.fromEntries(MEDIAS_VIDA.map((h) => [h, r4((rA.ewma[h] * Math.min(1, rA.n / 5) + rB.ewma[h] * Math.min(1, rB.n / 5)) / 2)])),
          ritmo_n: Math.min(rA.n, rB.n),
        });
      }
    }
    // actualización de la memoria de ritmo: SIEMPRE después de emitir la predicción
    if (evaluable && mm) {
      const res = (pr.pw + pr.pl) / gs.length - mm.exp_points / mm.exp_games;
      for (const id of [A, Bp]) {
        const st = ritmo.get(id) || { ewma: Object.fromEntries(MEDIAS_VIDA.map((h) => [h, 0])), n: 0 };
        for (const h of MEDIAS_VIDA) { const w = 1 - Math.pow(0.5, 1 / h); st.ewma[h] = (1 - w) * st.ewma[h] + w * res; }
        st.n++; ritmo.set(id, st);
      }
    }
    ultima.set(A, fecha); ultima.set(Bp, fecha);
  });
  return recs;
}

// ── ¿CUÁNTO DEPENDE EL RESULTADO DEL ORDEN INVENTADO? (T2.13) ──────────────────────────────────────────
// Consecuencia directa de la cosecha: las 161.816 filas sin fecha exacta entran al replay con la fecha
// 1 de julio de su año, así que DENTRO de cada año el orden cronológico es el del identificador de torneo,
// que es arbitrario. Como los ratings se construyen en ese orden, la pregunta legítima es cuánto se mueven
// las predicciones de la ventana de evaluación si ese orden arbitrario fuera otro. Se mide barajando el
// bloque sin fecha dentro de cada año y repitiendo el replay; lo fechado no se toca nunca.
function ordenSensible(B, { repeticiones = 4 } = {}) {
  const { F, rows } = B;
  const base = recolecta(B);
  const resumen = (recs) => ({
    n: recs.length,
    exp_pts: r4(media(recs.map((r) => r.exp_pts))),
    exp_games: r4(media(recs.map((r) => r.exp_games))),
    logloss_elo: r5(-media(recs.map((r) => Math.log(clamp(r.p_elo, 1e-6, 1 - 1e-6))))),
    mae_pts: r4(media(recs.map((r) => Math.abs(r.exp_pts - r.pts)))),
  });
  const out = [resumen(base)];
  for (let s = 0; s < repeticiones; s++) {
    const rnd = INF.generador(1000 + s);
    const porAnio = new Map();
    rows.forEach((r, i) => { if (r[F.dated]) return; const y = Math.floor(r[F.date] / 10000); if (!porAnio.has(y)) porAnio.set(y, []); porAnio.get(y).push(i); });
    const nuevas = rows.slice();
    for (const idxs of porAnio.values()) {
      const perm = idxs.slice();
      for (let i = perm.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
      idxs.forEach((dst, k) => { nuevas[dst] = rows[perm[k]]; });
    }
    out.push(resumen(recolecta({ ...B, rows: nuevas })));
  }
  const campo = (k) => { const v = out.map((x) => x[k]); return { base: v[0], min: r5(Math.min(...v.slice(1))), max: r5(Math.max(...v.slice(1))), rango: r5(Math.max(...v.slice(1)) - Math.min(...v.slice(1))) }; };
  return { repeticiones, corridas: out, exp_pts: campo('exp_pts'), exp_games: campo('exp_games'), logloss_elo: campo('logloss_elo'), mae_pts: campo('mae_pts') };
}

// ══ 3. DESCOMPOSICIÓN DE LA DURACIÓN (T2.11) ═══════════════════════════════════════════════════════════
// E[puntos] = Σ_k P(n_games = k) · E[puntos | n_games = k]. Las dos mitades se miden por separado porque
// se equivocan por motivos distintos: la primera es el reparto de duraciones (¿cuántos games dura?), la
// segunda es el game (¿cuánto dura un game?). Sumar las dos y mirar solo el total esconde que una puede
// estar compensando a la otra — que es exactamente lo que pasa aquí.
function duracion(recs) {
  const cache = new Map();
  const pmfGames = (rec) => {
    const k = `${rec.a}|${rec.b}|${rec.bo}`;
    let v = cache.get(k);
    if (!v) { const mm = C.compileMatch(rec.a, rec.b, { best_of: rec.bo }); v = { games: mm.games_total, cond: ptsCondicional(mm) }; cache.set(k, v); }
    return v;
  };
  // E[puntos | n_games = k] DEL MODELO, exacto y no aproximado. El compilador publica la pmf de puntos ya
  // agregada sobre todos los marcadores, así que la conditional hay que recomponerla: dentro de un game,
  // los puntos esperados dependen de QUIÉN lo gana (el favorito cierra sus games más cortos), y un partido
  // de k games con marcador (ga, gb) es ga games ganados por A y gb por B.
  //   E[puntos | marcador] = ga·E[t | gana A] + gb·E[t | gana B]
  // que es exacta porque, condicionado al ganador de cada game, los games son independientes.
  function ptsCondicional(mm) {
    const espera = (g) => { let pa = 0, ta = 0, pb = 0, tb = 0; for (const o of g.outcomes) { if (o.w === 'a') { pa += o.p; ta += o.t * o.p; } else { pb += o.p; tb += o.t * o.p; } } return { eA: pa > 0 ? ta / pa : 0, eB: pb > 0 ? tb / pb : 0 }; };
    const a = espera(mm.game_a), b = espera(mm.game_b);
    const eA = (a.eA + b.eA) / 2, eB = (a.eB + b.eB) / 2;   // el primer servidor se desconoce: mezcla 50/50
    const out = {};
    for (const [sc, p] of mm.score) {
      const [ga, gb] = String(sc).split('-').map(Number);
      const k = ga + gb;
      const o = out[k] || (out[k] = { p: 0, pe: 0 });
      o.p += p; o.pe += p * (ga * eA + gb * eB);
    }
    for (const k of Object.keys(out)) out[k].e = out[k].p > 0 ? out[k].pe / out[k].p : null;
    return out;
  }
  const bloque = (filas, etiqueta) => {
    if (!filas.length) return null;
    const n = filas.length;
    // reparto de duraciones, real y del modelo
    const ks = {}; const kmod = {};
    let ptsReal = 0, ptsMod = 0;
    for (const r of filas) {
      ptsReal += r.pts; ptsMod += r.exp_pts;
      ks[r.ng] = ks[r.ng] || { n: 0, pts: 0 };
      ks[r.ng].n++; ks[r.ng].pts += r.pts;
      const v = pmfGames(r);
      for (const [k, p] of v.games) { const o = kmod[k] || (kmod[k] = { p: 0, pe: 0 }); o.p += p; o.pe += p * ((v.cond[k] || {}).e || 0); }
    }
    const filasK = Object.keys(ks).map(Number).sort((a, b) => a - b).map((k) => ({
      n_games: k, p_real: r4(ks[k].n / n), p_modelo: r4(((kmod[k] || {}).p || 0) / n),
      pts_real: r3(ks[k].pts / ks[k].n),
      pts_modelo: r3((kmod[k] || {}).p > 0 ? kmod[k].pe / kmod[k].p : null),
      n: ks[k].n,
    }));
    // las dos mitades del error: reparto de duraciones a puntos-por-game REALES, y puntos-por-game a
    // reparto REAL. La suma de las dos no es exactamente el error total (hay un término cruzado) y se
    // reporta también, porque esconderlo sería el mismo pecado que sumó causas solapadas en la autopsia.
    const ppgReal = suma(filas.map((r) => r.pts)) / suma(filas.map((r) => r.ng));
    const ppgMod = suma(filas.map((r) => r.exp_pts)) / suma(filas.map((r) => r.exp_games));
    const kReal = suma(filas.map((r) => r.ng)) / n;
    const kMod = suma(filas.map((r) => r.exp_games)) / n;
    // el intervalo del sesgo del total, por racimos de TORNEO (dos partidos del mismo torneo comparten
    // jugadores, mesa y pelota: contarlos como independientes estrecha el intervalo de mentira)
    const bs = INF.bootstrapClusters(filas, { valor: (r) => r.exp_pts - r.pts, cluster: (r) => r.tid, replicas: 1000, semilla: 42 });
    return {
      que: etiqueta, n,
      puntos: { real: r3(ptsReal / n), modelo: r3(ptsMod / n), dif: r3((ptsMod - ptsReal) / n), ic_dif: bs.ic, t: bs.t, racimos: bs.n_clusters },
      games: { real: r3(kReal), modelo: r3(kMod), dif: r3(kMod - kReal) },
      puntos_por_game: { real: r3(ppgReal), modelo: r3(ppgMod), dif: r3(ppgMod - ppgReal) },
      // descomposición: Δ ≈ (k_mod − k_real)·ppg_real + k_real·(ppg_mod − ppg_real) + cruzado
      aporte_duracion: r3((kMod - kReal) * ppgReal),
      aporte_game: r3(kReal * (ppgMod - ppgReal)),
      cruzado: r3((kMod - kReal) * (ppgMod - ppgReal)),
      deuce: { real: r4(suma(filas.map((r) => r.deu)) / suma(filas.map((r) => r.ng))), modelo: r4(suma(filas.map((r) => r.p_deuce * r.ng)) / suma(filas.map((r) => r.ng))) },
      barrida: { real: r4(filas.filter((r) => r.lg === 0).length / n), modelo: r4(media(filas.map((r) => r.p_barrida))) },
      por_n_games: filasK,
    };
  };
  const gap = (r) => Math.abs(r.p_elo - 0.5);
  const cortes = [0.05, 0.15, 0.3];
  const cubo = (r) => { const g = gap(r); return g < cortes[0] ? 'parejo (<0,05)' : g < cortes[1] ? 'leve (0,05-0,15)' : g < cortes[2] ? 'claro (0,15-0,30)' : 'aplastante (>0,30)'; };
  const antig = (r) => { const i = Math.max(r.idle_a || 0, r.idle_b || 0); return i <= 30 ? 'fresco (≤30 d)' : i <= 90 ? 'medio (31-90 d)' : i <= 240 ? 'viejo (91-240 d)' : 'rancio (>240 d)'; };
  const grupos = (fn) => { const m = new Map(); for (const r of recs) { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const listaDe = (fn) => [...grupos(fn).entries()].sort((a, b) => b[1].length - a[1].length).map(([k, v]) => bloque(v, String(k))).filter(Boolean);
  return {
    global: bloque(recs, 'todo'),
    por_formato: listaDe((r) => `BO${r.bo}`),
    por_gap: listaDe(cubo),
    por_competicion: listaDe((r) => R.TIER_LABEL[r.tier] || r.tier).slice(0, 10),
    por_antiguedad: listaDe(antig),
    por_sexo: listaDe((r) => r.sexo),
  };
}

// ══ 4. LOS ASPIRANTES ══════════════════════════════════════════════════════════════════════════════════
// Todos devuelven una pmf del TOTAL DE PUNTOS del partido, como array de longitud KMAX+1 donde la última
// casilla acumula la cola. Se puntúan con `lib/conteos.js` (log-score y CRPS) y en las líneas de Cloudbet.
const pmfDePares = (pares, kmax = KMAX) => {
  const p = new Array(kmax + 1).fill(0);
  for (const [k, q] of pares) { const i = Math.max(0, Math.min(kmax, Math.round(k))); p[i] += q; }
  return CT.normaliza(p);
};
// inclinación exponencial a una media objetivo: q(k) ∝ p(k)·e^{θk}. Es la forma canónica de mover la media
// de una distribución sin deformar su forma más de lo imprescindible (la misma que usa lib/conteos.js).
const MEMO_INC = new Map();
function inclina(p, objetivo, clave = null) {
  if (clave) { const h = MEMO_INC.get(clave); if (h) return h; }
  // Newton sobre θ: m(θ) = E_q[k] y m'(θ) = Var_q[k]. Cuatro pasos bastan y son treinta veces más baratos
  // que la bisección de 80 iteraciones — con 1,2 millones de llamadas eso es la diferencia entre correr y no.
  let th = 0;
  for (let it = 0; it < 12; it++) {
    let s = 0, m1 = 0, m2 = 0;
    for (let k = 0; k < p.length; k++) { if (!(p[k] > 0)) continue; const v = p[k] * Math.exp(th * (k - 80)); s += v; m1 += k * v; m2 += k * k * v; }
    if (!(s > 0)) break;
    const m = m1 / s, va = Math.max(1e-6, m2 / s - m * m);
    const paso = (objetivo - m) / va;
    th += Math.max(-0.5, Math.min(0.5, paso));
    if (Math.abs(paso) < 1e-6) break;
  }
  const out = CT.normaliza(p.map((x, k) => x * Math.exp(th * (k - 80))));
  if (clave) { if (MEMO_INC.size > 200000) MEMO_INC.clear(); MEMO_INC.set(clave, out); }
  return out;
}

// suavizado por núcleo gaussiano sobre la rejilla de totales: con ~1.000 partidos repartidos en 70 totales
// distintos el histograma crudo es ruido, y el ruido de un histograma se paga entero en el log-score.
function suaviza(h, bw) {
  if (!(bw > 0)) return h;
  const n = h.length, out = new Array(n).fill(0);
  const rad = Math.ceil(3 * bw);
  const w = []; for (let d = -rad; d <= rad; d++) w.push(Math.exp(-0.5 * (d / bw) ** 2));
  const sw = suma(w);
  for (let k = 0; k < n; k++) { if (!(h[k] > 0)) continue; for (let d = -rad; d <= rad; d++) { const j = k + d; if (j >= 0 && j < n) out[j] += h[k] * w[d + rad] / sw; } }
  return out;
}
const histo = (vals, kmax = KMAX) => { const h = new Array(kmax + 1).fill(0); for (const v of vals) h[Math.max(0, Math.min(kmax, Math.round(v)))]++; return h; };

// ── TT0: el compilador de producción, tal cual sale hoy ─────────────────────────────────────────────────
const cacheTT0 = new Map();
function tt0(rec) {
  const k = `${rec.a}|${rec.b}|${rec.bo}`;
  let v = cacheTT0.get(k);
  if (!v) { v = pmfDePares(C.compileMatch(rec.a, rec.b, { best_of: rec.bo }).points_total); cacheTT0.set(k, v); }
  return v;
}

// ── Recalibración del Elo (componente de TT1) ──────────────────────────────────────────────────────────
// Regresión logística de una variable sobre logit(p_elo). β1 = 1 y β0 = 0 significa que el Elo ya está
// calibrado; β1 < 1 significa que es demasiado confiado. Se ajusta por Newton, que con una sola variable
// converge en cuatro iteraciones y no necesita biblioteca.
function recalibra(filas) {
  let b0 = 0, b1 = 1;
  const x = filas.map((r) => logit(clamp(r.p_elo, 1e-4, 1 - 1e-4)));
  const y = filas.map(() => 1);      // en los records el ganador es siempre "A": y ≡ 1 no informa…
  // …así que se usa la orientación determinista de tt-fit.js (paridad de los ids) para dar los dos signos
  for (let i = 0; i < filas.length; i++) {
    const flip = (parseInt(String(filas[i].wid).slice(-2), 10) + parseInt(String(filas[i].lid).slice(-2), 10)) % 2 === 1;
    if (flip) { x[i] = -x[i]; y[i] = 0; }
  }
  for (let it = 0; it < 25; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (let i = 0; i < x.length; i++) {
      const p = sig(b0 + b1 * x[i]), e = y[i] - p, w = p * (1 - p);
      g0 += e; g1 += e * x[i]; h00 += w; h01 += w * x[i]; h11 += w * x[i] * x[i];
    }
    const det = h00 * h11 - h01 * h01; if (!(Math.abs(det) > 1e-9)) break;
    const d0 = (h11 * g0 - h01 * g1) / det, d1 = (h00 * g1 - h01 * g0) / det;
    b0 += d0; b1 += d1;
    if (Math.abs(d0) + Math.abs(d1) < 1e-8) break;
  }
  return { b0: r4(b0), b1: r4(b1) };
}

// ── TT1: Elo recalibrado + distribución empírica de puntos por gap × formato ───────────────────────────
// El aspirante no paramétrico. Si le gana al compilador, es que la mecánica exacta del punto no aporta
// nada que no esté ya en "dos jugadores así de desiguales, en este formato, suelen jugar tantos puntos".
function ajustaTT1(train, hp) {
  const { nb: nBuckets, alfa, bw } = hp;
  const cal = recalibra(train);
  const favor = (r) => Math.abs(sig(cal.b0 + cal.b1 * logit(clamp(r.p_elo, 1e-4, 1 - 1e-4))) - 0.5);
  const porBo = new Map();
  for (const r of train) { if (!porBo.has(r.bo)) porBo.set(r.bo, []); porBo.get(r.bo).push(r); }
  const modelo = new Map();
  for (const [bo, filas] of porBo) {
    const f = filas.map(favor).sort((a, b) => a - b);
    const cortes = []; for (let i = 1; i < nBuckets; i++) cortes.push(f[Math.floor(i * f.length / nBuckets)]);
    const pooled = CT.normaliza(suaviza(histo(filas.map((r) => r.pts)), bw));
    const cubos = [];
    for (let b = 0; b < nBuckets; b++) {
      const sel = filas.filter((r) => { const v = favor(r); const lo = b === 0 ? -1 : cortes[b - 1]; const hi = b === nBuckets - 1 ? 2 : cortes[b]; return v >= lo && v < hi; });
      const n = sel.length;
      const h = n ? CT.normaliza(suaviza(histo(sel.map((r) => r.pts)), bw)) : pooled;
      const w = n / (n + alfa);
      cubos.push({ n, pmf: CT.normaliza(h.map((x, k) => w * x + (1 - w) * pooled[k])) });
    }
    modelo.set(bo, { cortes, cubos, pooled });
  }
  return { cal, modelo, favor, nBuckets,
    pmf(rec) {
      const m = this.modelo.get(rec.bo); if (!m) return null;
      const v = this.favor(rec);
      let b = 0; while (b < m.cortes.length && v >= m.cortes[b]) b++;
      return m.cubos[b].pmf;
    } };
}

// ── TT3: forma persistente (ritmo de jugador) ──────────────────────────────────────────────────────────
// La hipótesis: hay jugadores que alargan los games más de lo que su rating de punto predice, y esa
// desviación persiste. Si persiste, la media del compilador se corrige con ella; si no persiste, el propio
// entrenamiento elige λ = 0 y TT3 colapsa en TT0 — que es la forma limpia de que un aspirante se retire
// solo, la misma que usó `damp` en el estudio de tarjetas.
function ajustaTT3(train, hp) {
  const { hl, lam } = hp;
  return { hl, lam, pmf(rec) { const base = tt0(rec); if (!(this.lam > 0)) return base; const aj = this.lam * (rec.ritmo[this.hl] || 0) * (rec.exp_games || 4); const obj = clamp(rec.exp_pts + aj, 20, 200); return inclina(base, obj, `${rec.a}|${rec.b}|${rec.bo}|${Math.round(obj * 4)}`); } };
}

// ── Controles obligatorios ─────────────────────────────────────────────────────────────────────────────
// C1: la distribución empírica del formato, sin mirar quién juega. Es el "no sé nada" de este deporte.
function ajustaC1(train, hp) {
  const porBo = new Map();
  for (const r of train) { if (!porBo.has(r.bo)) porBo.set(r.bo, []); porBo.get(r.bo).push(r); }
  const m = new Map();
  for (const [bo, filas] of porBo) m.set(bo, CT.normaliza(suaviza(histo(filas.map((r) => r.pts)), hp.bw)));
  return { pmf(rec) { return m.get(rec.bo) || null; } };
}
// C2: binomial negativa con la MEDIA del compilador y la dispersión estimada en el entrenamiento por
// formato. Aísla una sola pregunta: ¿aporta algo la FORMA que sale de simular el punto, o basta con la
// media del compilador y dos momentos? Si C2 empata con TT0, la mecánica exacta no está pagando.
function ajustaC2(train, hp) {
  const porBo = new Map();
  for (const r of train) { if (!porBo.has(r.bo)) porBo.set(r.bo, []); porBo.get(r.bo).push(r); }
  const disp = new Map();
  for (const [bo, filas] of porBo) {
    // la dispersión se mide sobre el RESIDUO contra la media del compilador, no sobre el total crudo:
    // el total crudo mezcla la varianza entre partidos con la de dentro del partido, y solo la segunda
    // es la que una ley de conteo tiene que representar.
    const res = filas.map((r) => r.pts - r.exp_pts);
    const mo = CT.momentos(res);
    const muMedia = media(filas.map((r) => r.exp_pts));
    disp.set(bo, CT.rDeMomentos(muMedia, mo.varianza + muMedia, { min: 1, max: 4000 }));
  }
  return { pmf(rec) { return CT.nb(rec.exp_pts, disp.get(rec.bo) || 200, KMAX); } };
}

const ASPIRANTES = {
  TT1: { etiqueta: 'TT1 · Elo recalibrado + empírico por gap×formato', ajusta: ajustaTT1,
    rejilla: (() => { const g = []; for (const nb of [3, 5, 8]) for (const alfa of [20, 60, 150]) for (const bw of [0.5, 0.75, 1, 1.5, 3, 5]) g.push({ nb, alfa, bw }); return g; })() },
  TT3: { etiqueta: 'TT3 · forma persistente (ritmo de jugador)', ajusta: ajustaTT3,
    rejilla: (() => { const g = []; for (const hl of MEDIAS_VIDA) for (const lam of [0, 0.5, 1, 1.5, 2]) g.push({ hl, lam }); return g; })() },
  C1: { etiqueta: 'C1 · empírico por formato (control: no sé quién juega)', ajusta: ajustaC1, rejilla: [{ bw: 0.5 }, { bw: 0.75 }, { bw: 1 }, { bw: 1.5 }, { bw: 3 }, { bw: 5 }] },
  C2: { etiqueta: 'C2 · binomial negativa con la media del compilador', ajusta: ajustaC2, rejilla: [{}] },
};

// ══ 5. PROTOCOLO: VALIDACIÓN HACIA ADELANTE CON HIPERPARÁMETROS DENTRO DEL ENTRENAMIENTO ════════════════
const mesDe = (d) => Math.floor(d / 100);
function bloquesMensuales(recs, desde) {
  const ms = [...new Set(recs.filter((r) => r.d >= desde).map((r) => mesDe(r.d)))].sort((a, b) => a - b);
  return ms.map((m) => ({ mes: m, filas: recs.filter((r) => mesDe(r.d) === m) })).filter((b) => b.filas.length >= 30);
}
function puntua(pmf, rec) { return { log: CT.logScore(pmf, rec.pts), crps: CT.crps(pmf, rec.pts) }; }

function challengers(recs) {
  const bloques = bloquesMensuales(recs, EVAL_DESDE);
  const salida = { n_bloques: bloques.length, meses: bloques.map((b) => b.mes), elegidos: {}, filas: [] };
  const acc = { TT0: [] };
  for (const k of Object.keys(ASPIRANTES)) { acc[k] = []; salida.elegidos[k] = []; }

  for (const bl of bloques) {
    const train = recs.filter((r) => r.d < bl.mes * 100);
    if (train.length < 500) continue;
    // validación INTERNA: el último 20 % del entrenamiento por fecha. El bloque que se evalúa no se toca.
    const corte = train[Math.floor(train.length * 0.8)].d;
    const trIn = train.filter((r) => r.d < corte), vaIn = train.filter((r) => r.d >= corte);
    for (const [id, A] of Object.entries(ASPIRANTES)) {
      let mejor = null;
      for (const hp of A.rejilla) {
        const mod = A.ajusta(trIn, hp);
        let s = 0, n = 0;
        for (const r of vaIn) { const p = mod.pmf(r); if (!p) continue; s += CT.logScore(p, r.pts); n++; }
        if (n && (!mejor || s / n < mejor.score)) mejor = { hp, score: s / n };
      }
      if (!mejor) continue;
      salida.elegidos[id].push({ mes: bl.mes, ...mejor.hp });
      const mod = A.ajusta(train, mejor.hp);      // reajuste final con TODO el entrenamiento
      for (const r of bl.filas) { const p = mod.pmf(r); if (!p) continue; acc[id].push({ r, ...puntua(p, r), pmf: p }); }
    }
    for (const r of bl.filas) acc.TT0.push({ r, ...puntua(tt0(r), r), pmf: tt0(r) });
  }
  return { bloques: salida, acc };
}

// ── comparación pareada, con el racimo que de verdad corresponde ────────────────────────────────────────
// El racimo primario es el TORNEO: dos partidos del mismo torneo comparten jugadores, mesa y condiciones.
// Se reporta también el racimo de PARTIDO, que en el total de puntos es una fila y por tanto reproduce el
// bootstrap ordinario; la diferencia entre los dos intervalos ES el efecto de la correlación.
function compara(acc, id) {
  const base = new Map(acc.TT0.map((x) => [`${x.r.d}|${x.r.wid}|${x.r.lid}`, x]));
  const pares = [];
  for (const x of acc[id]) {
    const b = base.get(`${x.r.d}|${x.r.wid}|${x.r.lid}`); if (!b) continue;
    pares.push({ tid: x.r.tid, dlog: x.log - b.log, dcrps: x.crps - b.crps, log: x.log, crps: x.crps, log0: b.log, crps0: b.crps });
  }
  const bLog = INF.bootstrapClusters(pares, { valor: (x) => x.dlog, cluster: (x) => x.tid, replicas: 2000, semilla: 42 });
  const bCrps = INF.bootstrapClusters(pares, { valor: (x) => x.dcrps, cluster: (x) => x.tid, replicas: 2000, semilla: 42 });
  const bLogP = INF.bootstrapClusters(pares, { valor: (x) => x.dlog, cluster: (x, i) => i, replicas: 2000, semilla: 42 });
  return { id, n: pares.length, n_torneos: bLog.n_clusters,
    log_score: r5(media(pares.map((x) => x.log))), log_score_tt0: r5(media(pares.map((x) => x.log0))),
    crps: r5(media(pares.map((x) => x.crps))), crps_tt0: r5(media(pares.map((x) => x.crps0))),
    d_log: r5(bLog.media), ic_log: bLog.ic, t_log: bLog.t,
    p_log: INF.pDeT(bLog.t, bLog.n_clusters - 1),
    d_crps: r5(bCrps.media), ic_crps: bCrps.ic, t_crps: bCrps.t,
    t_log_racimo_partido: bLogP.t, se_ratio: r3(bLog.se / (bLogP.se || 1)) };
}

// ── ¿ESTÁ EL MODELO DEMASIADO SEGURO? (el puente con T2.10) ────────────────────────────────────────────
// Un log-score malo con un CRPS bueno tiene una sola explicación posible: la media está bien puesta y la
// ANCHURA no. Se compara la varianza que el propio modelo declara con la que de verdad tienen los
// residuos. Si la declarada es menor, el modelo está demasiado seguro — y en TT0 la causa candidata está
// escrita en el código: compila con UNA (a, b) puntual y no propaga la incertidumbre del rating, que es
// exactamente el agujero que T2.10 viene a tapar.
function dispersion(acc, id) {
  const filas = acc[id].map((x) => {
    let m = 0, m2 = 0;
    for (let k = 0; k < x.pmf.length; k++) { m += k * x.pmf[k]; m2 += k * k * x.pmf[k]; }
    const v = Math.max(1e-9, m2 - m * m);
    return { tid: x.r.tid, var_modelo: v, err2: (x.r.pts - m) ** 2, z2: ((x.r.pts - m) ** 2) / v };
  });
  const b = INF.bootstrapClusters(filas, { valor: (x) => x.z2, cluster: (x) => x.tid, replicas: 1000, semilla: 42 });
  return { id, n: filas.length,
    sd_modelo: r3(Math.sqrt(media(filas.map((x) => x.var_modelo)))),
    sd_real: r3(Math.sqrt(media(filas.map((x) => x.err2)))),
    z2_medio: r4(b.media), ic_z2: b.ic,
    lectura: b.ic[0] > 1 ? 'DEMASIADO SEGURO: la varianza real supera a la declarada' : b.ic[1] < 1 ? 'demasiado ancho' : 'anchura compatible' };
}

// ── calibración en las líneas que la casa ofrece de verdad ──────────────────────────────────────────────
function calibracion(acc, id) {
  const out = [];
  for (const bo of [5, 7]) for (const L of LINEAS[bo]) {
    const filas = acc[id].filter((x) => x.r.bo === bo).map((x) => ({ tid: x.r.tid, p: CT.pOver(x.pmf, L), y: x.r.pts > L ? 1 : 0 }));
    if (filas.length < 40) continue;
    const b = INF.bootstrapClusters(filas, { valor: (x) => x.p - x.y, cluster: (x) => x.tid, replicas: 1000, semilla: 42 });
    out.push({ bo, linea: L, n: filas.length,
      p_media: r4(media(filas.map((x) => x.p))), real: r4(media(filas.map((x) => x.y))),
      sesgo_pp: r3(100 * b.media), ic_pp: b.ic.map((v) => r3(100 * v)),
      brier: r4(media(filas.map((x) => (x.p - x.y) ** 2))) });
  }
  return out;
}

// ══ 5bis. LA INCERTIDUMBRE PROPIA DE LOS TOTALES (T2.10) ═══════════════════════════════════════════════
// EL DEFECTO. `tt-engine/data.js:143` calcula UNA incertidumbre —la del GANADOR, 100·0,28·√(1/(nA+2)+1/(nB+2))—
// y `tt-engine/store.js:352` la usa como listón de ruido para TODAS las familias, incluida POINTS_TOTAL, que
// es la única con dinero real. No son la misma cantidad y ni siquiera tienen la misma escala: la del ganador
// mide cuánto se mueve P(gana A) cuando el rating se mueve; la de un total mide cuánto se mueve P(más de L),
// que es una derivada distinta y que en las líneas centrales es MUCHO más pequeña (la línea está cerca del
// máximo de la densidad, donde P(over) apenas se mueve con el rating).
//
// LA PROPAGACIÓN. Si σ_p es la desviación del rating expresada en probabilidad de PUNTO, el método delta da
//     Var(total) = Var_compilador(total | p) + (∂E[total]/∂p)² · σ_p²
//     unc(familia) = |∂P(selección)/∂p| · σ_p
// Las dos derivadas se calculan recompilando en p ± h, que es lo que el compilador ya sabe hacer.
//
// CÓMO SE MIDE σ_p, SIN SUPONERLO. El exceso de dispersión del apartado anterior (la varianza real supera a
// la declarada) se regresa sobre (∂E/∂p · √(1/(nA+2)+1/(nB+2)))² por el origen. El coeficiente que sale ES
// σ_p. Atribuye TODO el exceso al rating, que es la lectura conservadora para una puerta: si parte del exceso
// fuera mala especificación, el listón sigue siendo del tamaño correcto aunque la etiqueta esté mal puesta.
const cacheDer = new Map();
function derivadas(rec, h = 0.02) {
  const k = `${rec.a}|${rec.b}|${rec.bo}|${h}`;
  let v = cacheDer.get(k);
  if (v) return v;
  const d = rec.a - rec.b;                         // 2·serveDelta, se conserva al mover p
  const mk = (p) => C.compileMatch(+clamp(p + d / 2, 0.02, 0.98).toFixed(3), +clamp(p - d / 2, 0.02, 0.98).toFixed(3), { best_of: rec.bo });
  const pc = (rec.a + rec.b) / 2;
  const mUp = mk(pc + h), mDn = mk(pc - h), m0 = C.compileMatch(rec.a, rec.b, { best_of: rec.bo });
  const pmf = pmfDePares(m0.points_total);
  let mu = 0, m2 = 0; for (let i = 0; i < pmf.length; i++) { mu += i * pmf[i]; m2 += i * i * pmf[i]; }
  v = { mu, varc: Math.max(1e-9, m2 - mu * mu), dE: (mUp.exp_points - mDn.exp_points) / (2 * h),
    dOver: {}, dGana: (mUp.p_a - mDn.p_a) / (2 * h) };
  for (const L of LINEAS[rec.bo] || []) v.dOver[L] = (C.over(mUp.points_total, L) - C.over(mDn.points_total, L)) / (2 * h);
  if (cacheDer.size > 20000) cacheDer.clear();
  cacheDer.set(k, v);
  return v;
}
function incertidumbreTotales(recs) {
  const filas = recs.map((r) => {
    const d = derivadas(r);
    const s = Math.sqrt(1 / (r.n_a + 2) + 1 / (r.n_b + 2));      // la misma exposición que usa data.js
    return { tid: r.tid, r, s, ...d, y: (r.pts - d.mu) ** 2 - d.varc, x: (d.dE * s) ** 2 };
  });
  // REGRESIÓN CON ORDENADA EN EL ORIGEN, y la ordenada IMPORTA. Si todo el exceso de dispersión fuera
  // incertidumbre del rating, tendría que crecer con la exposición: los partidos de jugadores con pocos
  // datos deberían fallar más. Un ajuste POR EL ORIGEN obliga a que así sea y reparte a la fuerza entre los
  // dos, inflando el listón de los jugadores curtidos. Con ordenada:
  //     (error)² − Var_compilador  =  α  +  c²·(∂E/∂p · s)²
  // α es lo que le falta de ancho a TODO el mundo —mala especificación del compilador, no incertidumbre— y
  // c² es la parte que de verdad depende de cuántos datos hay detrás de cada jugador. Son cosas distintas y
  // se arreglan en sitios distintos: α en el compilador, c en la puerta de ruido.
  const n = filas.length;
  const mx = media(filas.map((f) => f.x)), my = media(filas.map((f) => f.y));
  const sxy = suma(filas.map((f) => (f.x - mx) * (f.y - my))), sxx = suma(filas.map((f) => (f.x - mx) ** 2));
  const beta = sxx > 0 ? sxy / sxx : 0;
  const alfa = my - beta * mx;
  const c = beta > 0 ? Math.sqrt(beta) : 0;
  // intervalo de c por bootstrap de racimos de torneo, rehaciendo la regresión entera en cada réplica
  const icC = (() => {
    const grupos = [...new Map(filas.map((f, i) => [f.tid, i])).keys()];
    const porT = new Map(); for (const f of filas) { if (!porT.has(f.tid)) porT.set(f.tid, []); porT.get(f.tid).push(f); }
    const gs = [...porT.values()];
    const rnd = INF.generador(42); const reps = [];
    for (let r = 0; r < 500; r++) {
      const m = []; for (let k = 0; k < gs.length; k++) m.push(...gs[Math.floor(rnd() * gs.length) % gs.length]);
      const ax = media(m.map((f) => f.x)), ay = media(m.map((f) => f.y));
      const sxy2 = suma(m.map((f) => (f.x - ax) * (f.y - ay))), sxx2 = suma(m.map((f) => (f.x - ax) ** 2));
      const b2 = sxx2 > 0 ? sxy2 / sxx2 : 0;
      reps.push(b2 > 0 ? Math.sqrt(b2) : 0);
    }
    reps.sort((a, b) => a - b);
    return [r4(INF.percentil(reps, 0.025)), r4(INF.percentil(reps, 0.975))];
  })();
  // ¿cierra el agujero? z² antes, con solo el rating, y con rating + α
  const z2 = (f, modo) => { const extra = modo === 'rating' ? (f.dE * f.s * c) ** 2 : modo === 'ambos' ? (f.dE * f.s * c) ** 2 + Math.max(0, alfa) : 0; return (f.y + f.varc) / (f.varc + extra); };
  const cuartiles = (() => {
    const ord = filas.slice().sort((a, b) => a.s - b.s);
    const q = []; for (let i = 0; i < 4; i++) q.push(ord.slice(Math.floor(i * ord.length / 4), Math.floor((i + 1) * ord.length / 4)));
    return q.map((g, i) => ({ cuartil: i + 1, s_medio: r4(media(g.map((f) => f.s))),
      n_medio: r3(media(g.map((f) => (f.r.n_a + f.r.n_b) / 2))),
      z2_antes: r4(media(g.map((f) => z2(f, 'no')))), z2_rating: r4(media(g.map((f) => z2(f, 'rating')))), z2_ambos: r4(media(g.map((f) => z2(f, 'ambos')))) }));
  })();
  // el listón, tesis a tesis: el de hoy (ganador) contra el propio de cada familia
  const porLinea = {};
  for (const bo of [5, 7]) for (const L of (LINEAS[bo] || [])) {
    const sel = filas.filter((f) => f.r.bo === bo);
    if (sel.length < 40) continue;
    const uW = sel.map((f) => 100 * 0.28 * f.s);                              // el de hoy: unc del GANADOR
    const uT = sel.map((f) => 100 * Math.abs(f.dOver[L]) * c * f.s);          // el propio del total
    const mediana = (a) => { const o = a.slice().sort((x, y) => x - y); return o[Math.floor(o.length / 2)]; };
    porLinea[`BO${bo}|${L}`] = { n: sel.length,
      unc_ganador_pp: { media: r3(media(uW)), mediana: r3(mediana(uW)) },
      unc_total_pp: { media: r3(media(uT)), mediana: r3(mediana(uT)) },
      raton: r3(media(uT) / media(uW)),
      // la puerta muerde cuando 0,75·unc supera el mínimo de ventaja de la casa (3 pp)
      muerde_ganador_pct: r3(100 * uW.filter((u) => 0.75 * u > 3).length / sel.length),
      muerde_total_pct: r3(100 * uT.filter((u) => 0.75 * u > 3).length / sel.length),
      // tesis que NACEN con cada listón, para varias ventajas declaradas
      nacen: [3, 4, 5, 6].map((e) => ({ edge_pp: e,
        con_ganador: uW.filter((u) => e >= 3 && e >= 0.75 * u).length,
        con_total: uT.filter((u) => e >= 3 && e >= 0.75 * u).length })),
    };
  }
  // el ganador también tiene su propia versión propagada: sirve de control de que el método no está roto
  const uMlProp = filas.map((f) => 100 * Math.abs(f.dGana) * c * f.s);
  const uMlHoy = filas.map((f) => 100 * 0.28 * f.s);
  return { c_sigma_punto: r4(c), ic_c: icC, n: filas.length,
    alfa_varianza_constante: r3(alfa), alfa_sd_pts: r3(alfa > 0 ? Math.sqrt(alfa) : 0),
    sd_extra_media_pts: r3(Math.sqrt(media(filas.map((f) => (f.dE * f.s * c) ** 2)))),
    z2_global: { antes: r4(media(filas.map((f) => z2(f, 'no')))), solo_rating: r4(media(filas.map((f) => z2(f, 'rating')))), rating_y_alfa: r4(media(filas.map((f) => z2(f, 'ambos')))) },
    por_cuartil_de_exposicion: cuartiles,
    ganador: { unc_hoy_pp: r3(media(uMlHoy)), unc_propagada_pp: r3(media(uMlProp)) },
    por_linea: porLinea };
}

// ══ 6. TT2 — ¿ES IDENTIFICABLE EL SAQUE/RESTO? (T2.11) ═════════════════════════════════════════════════
// El blueprint congeló δ = 0,03 como PRIOR DE POBLACIÓN y escribió que L2 no está identificado con esta
// fuente. Eso hasta hoy era una afirmación sin número. Aquí se le pone uno: perfil de verosimilitud de δ
// sobre los marcadores de game reales, con la probabilidad de punto fijada por θ. Si el δ de POBLACIÓN, con
// decenas de miles de games, ya sale con un error estándar del tamaño del propio δ, un δ POR JUGADOR con
// unos cientos de games es aritméticamente imposible y TT2 no se construye. No se fuerza: se dice.
// UNA SIMETRÍA QUE DECIDE EL ASUNTO ANTES DE MIRAR NINGÚN NÚMERO. Con el primer servidor DESCONOCIDO —que
// es el caso en todo partido antes del sorteo, y la fuente nunca lo publica— la verosimilitud mezcla 50/50
// los dos servidores iniciales. Cambiar δ por −δ es intercambiar a y b, y eso es exactamente lo mismo que
// intercambiar el primer servidor: la mezcla es INVARIANTE. O sea que el signo de δ no está identificado ni
// con infinitos datos, y δ = 0 es siempre un punto crítico. Solo |δ| puede estimarse, y solo por su efecto
// de segundo orden sobre la forma del game.
function identificabilidadSaque(recs, { grid = [0, 0.01, 0.02, 0.03, 0.045, 0.06, 0.08, 0.1, 0.12] } = {}) {
  const cache = new Map();
  const tabla = (a, b, first) => {
    const k = `${a}|${b}|${first}`;
    let m = cache.get(k);
    if (!m) { m = new Map(); for (const o of C.compileGame(a, b, first).outcomes) { const kk = `${o.w}|${o.t}`; m.set(kk, (m.get(kk) || 0) + o.p); } cache.set(k, m); }
    return m;
  };
  const perfil = [];
  for (const delta of grid) {
    let ll = 0, nG = 0;
    for (const rec of recs) {
      const a = +clamp(rec.p_pt + delta, 0.02, 0.98).toFixed(3);
      const b = +clamp(rec.p_pt - delta, 0.02, 0.98).toFixed(3);
      const tA = tabla(a, b, 'a'), tB = tabla(a, b, 'b');
      for (const [x, y] of rec.juegos) {
        // el primer servidor del partido se desconoce antes del sorteo → mezcla 50/50 en CADA game
        const w = x > y ? 'a' : 'b', t = x + y;
        const p = 0.5 * (tA.get(`${w}|${t}`) || 0) + 0.5 * (tB.get(`${w}|${t}`) || 0);
        ll += Math.log(Math.max(1e-12, p)); nG++;
      }
    }
    perfil.push({ delta, log_verosimilitud: r3(ll), n_games: nG, ll_por_game: r5(ll / nG) });
  }
  // curvatura alrededor del máximo → error estándar (la verosimilitud perfilada es ≈ parabólica en δ̂)
  const mejor = perfil.reduce((a, b) => (b.log_verosimilitud > a.log_verosimilitud ? b : a));
  const i = perfil.indexOf(mejor);
  let se = null, curv = null;
  if (mejor.delta === 0 && perfil.length > 1) {
    // por la simetría, ll(−h) = ll(h): la segunda derivada en cero es 2·(ll(h) − ll(0))/h²
    const h = perfil[1].delta;
    curv = 2 * (perfil[1].log_verosimilitud - mejor.log_verosimilitud) / (h * h);
    if (curv < 0) se = Math.sqrt(-1 / curv);
  } else if (i > 0 && i < perfil.length - 1) {
    const h1 = mejor.delta - perfil[i - 1].delta, h2 = perfil[i + 1].delta - mejor.delta;
    const d2 = 2 * ((perfil[i - 1].log_verosimilitud - mejor.log_verosimilitud) / (h1 * (h1 + h2)) + (perfil[i + 1].log_verosimilitud - mejor.log_verosimilitud) / (h2 * (h1 + h2)));
    curv = d2;
    if (d2 < 0) se = Math.sqrt(-1 / d2);
  }
  // ¿rechaza la muestra el δ congelado del blueprint? Razón de verosimilitudes contra δ = 0,03.
  const en003 = perfil.find((x) => x.delta === 0.03);
  const lr = en003 ? 2 * (mejor.log_verosimilitud - en003.log_verosimilitud) : null;
  const gamesTot = mejor.n_games;
  return { grid, perfil, delta_mv: mejor.delta, se_poblacion: se != null ? r5(se) : null, curvatura: curv != null ? r3(curv) : null,
    simetria: 'll(−δ) = ll(δ) con el primer servidor desconocido: solo |δ| es estimable',
    razon_verosimilitud_vs_003: lr != null ? r3(lr) : null,
    n_games: gamesTot,
    // el error estándar escala con 1/√n: de la población a un jugador con `g` games
    se_por_jugador: se != null ? [100, 300, 1000, 3000].map((g) => ({ games: g, se: r4(se * Math.sqrt(gamesTot / g)) })) : null,
    delta_congelado: 0.03 };
}

// ══ 7. EJECUCIÓN ═══════════════════════════════════════════════════════════════════════════════════════
(function main() {
  const t0 = Date.now();
  const B = cargaBase();
  const out = { at: new Date().toISOString(), base: { filas: B.rows.length, con_fecha: B.rows.filter((r) => r[B.F.dated]).length }, constantes: B.cst, desde: DESDE, eval_desde: EVAL_DESDE };
  console.log(`base ${B.rows.length} filas · constantes congeladas ${JSON.stringify(B.cst)}`);

  if (SOLO === 'todo' || SOLO === 'poblacion') {
    console.log('\n══ POBLACIÓN VÁLIDA (T2.13) ═══════════════════════════════════════════');
    out.poblacion = poblacion(B);
    const P = out.poblacion;
    console.log(`filas ${P.total} · con fecha exacta ${P.con_fecha} (${P.pct_con_fecha} %)`);
    console.log('por año:'); for (const f of P.por_anio.slice().sort((a, b) => +a.clave - +b.clave)) if (f.n > 50) console.log(`  ${f.clave}  n ${String(f.n).padStart(6)}  con fecha ${String(f.con_fecha).padStart(6)}  ${f.pct} %`);
    for (const [k, lab] of [['por_nivel', 'NIVEL'], ['por_juvenil', 'JUVENIL'], ['por_sexo', 'SEXO'], ['por_formato', 'FORMATO'], ['por_retirada', 'RETIRADA']]) {
      console.log(`\n${lab}:`); for (const f of P[k].slice(0, 14)) console.log(`  ${String(f.clave).padEnd(16)} n ${String(f.n).padStart(6)}  con fecha ${String(f.con_fecha).padStart(6)}  ${f.pct} %`);
    }
    console.log('\njugadores:', JSON.stringify(P.jugadores));
    console.log('experiencia media al jugar:', JSON.stringify(P.experiencia_media), '· ranking medio:', JSON.stringify(P.ranking_medio));
    console.log('era de los 21 puntos:', JSON.stringify(P.era_21_puntos));
    console.log('\nOBSERVABLES (bootstrap por torneo, 1.000 réplicas):');
    for (const o of P.observables) console.log(`  ${o.que.padEnd(26)} con fecha ${o.con_fecha.media} ${JSON.stringify(o.con_fecha.ic)} · sin fecha ${o.sin_fecha.media} ${JSON.stringify(o.sin_fecha.ic)} · dif ${o.dif} · solapan ${o.solapan}`);
    if (!args['sin-orden']) {
      console.log('\nSENSIBILIDAD AL ORDEN INVENTADO (baraja el bloque sin fecha dentro de cada año):');
      out.orden = ordenSensible(B);
      for (const k of ['exp_pts', 'exp_games', 'logloss_elo', 'mae_pts']) console.log(`  ${k.padEnd(12)} base ${out.orden[k].base} · barajado [${out.orden[k].min}, ${out.orden[k].max}] · rango ${out.orden[k].rango}`);
    }
  }

  if (SOLO === 'poblacion') return fin(out, t0);

  console.log('\n══ RECOLECCIÓN WALK-FORWARD ═══════════════════════════════════════════');
  const recs = recolecta(B);
  console.log(`${recs.length} partidos evaluables desde ${DESDE} (${recs.filter((r) => r.d >= EVAL_DESDE).length} en la ventana de evaluación)`);
  out.recogidos = recs.length;

  if (SOLO === 'todo' || SOLO === 'duracion') {
    console.log('\n══ DESCOMPOSICIÓN DE LA DURACIÓN (T2.11) ══════════════════════════════');
    out.duracion = duracion(recs);
    const pr = (b) => console.log(`  ${String(b.que).padEnd(24)} n ${String(b.n).padStart(5)} · puntos ${b.puntos.real} vs ${b.puntos.modelo} (${b.puntos.dif >= 0 ? '+' : ''}${b.puntos.dif} IC ${JSON.stringify(b.puntos.ic_dif)} t ${b.puntos.t}) · games ${b.games.real} vs ${b.games.modelo} (${b.games.dif >= 0 ? '+' : ''}${b.games.dif}) · pts/game ${b.puntos_por_game.real} vs ${b.puntos_por_game.modelo} (${b.puntos_por_game.dif >= 0 ? '+' : ''}${b.puntos_por_game.dif}) · duración ${b.aporte_duracion} + game ${b.aporte_game} + cruzado ${b.cruzado} · racimos ${b.puntos.racimos} · deuce ${b.deuce.real}/${b.deuce.modelo} · barrida ${b.barrida.real}/${b.barrida.modelo}`);
    pr(out.duracion.global);
    for (const k of ['por_formato', 'por_gap', 'por_competicion', 'por_antiguedad', 'por_sexo']) { console.log(`\n${k}:`); for (const b of out.duracion[k]) pr(b); }
    console.log('\nreparto de duraciones (global):');
    for (const f of out.duracion.global.por_n_games) console.log(`  n_games ${f.n_games}: real ${f.p_real} · modelo ${f.p_modelo} · puntos real ${f.pts_real} vs modelo ${f.pts_modelo} (n ${f.n})`);
  }

  if (SOLO === 'todo' || SOLO === 'challengers') {
    console.log('\n══ TT2 — ¿SE PUEDE ESTIMAR EL SAQUE/RESTO? ════════════════════════════');
    out.tt2 = identificabilidadSaque(recs);
    for (const f of out.tt2.perfil) console.log(`  δ ${String(f.delta).padEnd(6)} ll/game ${f.ll_por_game}  (${f.log_verosimilitud})`);
    console.log(`  δ̂ ${out.tt2.delta_mv} · se(población) ${out.tt2.se_poblacion} · ${out.tt2.n_games} games`);
    if (out.tt2.se_por_jugador) for (const s of out.tt2.se_por_jugador) console.log(`  un jugador con ${s.games} games: se(δ) ≈ ${s.se}`);

    console.log('\n══ ASPIRANTES (validación hacia adelante) ═════════════════════════════');
    const { bloques, acc } = challengers(recs);
    out.bloques = bloques.n_bloques; out.meses = bloques.meses; out.elegidos = bloques.elegidos;
    console.log(`${bloques.n_bloques} bloques mensuales · ${acc.TT0.length} partidos evaluados`);
    out.comparaciones = [];
    for (const id of Object.keys(ASPIRANTES)) {
      const c = compara(acc, id);
      c.etiqueta = ASPIRANTES[id].etiqueta;
      out.comparaciones.push(c);
      console.log(`  ${id.padEnd(4)} n ${c.n} (${c.n_torneos} torneos) · log ${c.log_score} vs ${c.log_score_tt0} · Δ ${c.d_log} IC ${JSON.stringify(c.ic_log)} t ${c.t_log} p ${c.p_log} · CRPS ${c.crps} vs ${c.crps_tt0} Δ ${c.d_crps} t ${c.t_crps} · se(torneo)/se(partido) ${c.se_ratio}`);
    }
    // Benjamini-Hochberg sobre TODAS las comparaciones declaradas de esta fase
    const ps = out.comparaciones.map((c) => c.p_log).filter((p) => p != null);
    out.bh = INF.bh(ps, 0.10);
    console.log(`  BH al 10 % sobre ${ps.length} comparaciones: umbral ${out.bh.umbral}, rechazadas ${JSON.stringify(out.bh.rechazadas)}`);

    console.log('\n══ INCERTIDUMBRE PROPIA DE LOS TOTALES (T2.10) ════════════════════════');
    out.t210 = incertidumbreTotales(recs.filter((r) => r.d >= EVAL_DESDE));
    const U = out.t210;
    console.log(`  σ del rating en probabilidad de punto: c = ${U.c_sigma_punto} IC ${JSON.stringify(U.ic_c)} (n ${U.n})`);
    console.log(`  anchura que le falta a TODOS (mala especificación): α = ${U.alfa_varianza_constante} puntos² (${U.alfa_sd_pts} puntos de desviación)`);
    console.log(`  desviación extra que aporta el rating: ${U.sd_extra_media_pts} puntos · z² ${U.z2_global.antes} → ${U.z2_global.solo_rating} (solo rating) → ${U.z2_global.rating_y_alfa} (rating + α)`);
    for (const q of U.por_cuartil_de_exposicion) console.log(`    cuartil ${q.cuartil} (n medio ${q.n_medio}, s ${q.s_medio}): z² ${q.z2_antes} → ${q.z2_rating} → ${q.z2_ambos}`);
    console.log(`  ganador: unc de hoy ${U.ganador.unc_hoy_pp} pp · propagada ${U.ganador.unc_propagada_pp} pp`);
    for (const [k, v] of Object.entries(U.por_linea)) console.log(`  ${k.padEnd(12)} unc ganador ${v.unc_ganador_pp.media} pp · unc del total ${v.unc_total_pp.media} pp (×${v.raton}) · muerde ${v.muerde_ganador_pct} % → ${v.muerde_total_pct} % · nacen a 3 pp ${v.nacen[0].con_ganador}→${v.nacen[0].con_total}, a 4 pp ${v.nacen[1].con_ganador}→${v.nacen[1].con_total} (de ${v.n})`);

    console.log('\n══ ANCHURA DECLARADA FRENTE A LA REAL ═════════════════════════════════');
    out.dispersion = ['TT0', ...Object.keys(ASPIRANTES)].map((id) => dispersion(acc, id));
    for (const d of out.dispersion) console.log(`  ${d.id.padEnd(4)} sd modelo ${d.sd_modelo} · sd real ${d.sd_real} · z² medio ${d.z2_medio} IC ${JSON.stringify(d.ic_z2)} → ${d.lectura}`);

    console.log('\n══ CALIBRACIÓN EN LAS LÍNEAS DE CLOUDBET ══════════════════════════════');
    out.calibracion = {};
    for (const id of ['TT0', ...Object.keys(ASPIRANTES)]) {
      out.calibracion[id] = calibracion(acc, id);
      for (const c of out.calibracion[id]) console.log(`  ${id.padEnd(4)} BO${c.bo} over ${c.linea}: modelo ${c.p_media} · real ${c.real} · sesgo ${c.sesgo_pp} pp IC ${JSON.stringify(c.ic_pp)} · Brier ${c.brier} (n ${c.n})`);
    }
  }
  fin(out, t0);
})();

function fin(out, t0) {
  out.ms = Date.now() - t0;
  if (args.json) { fs.writeFileSync(String(args.json), JSON.stringify(out, null, 1)); console.log('\nescrito →', args.json); }
  console.log(`\nlisto en ${Math.round(out.ms / 1000)} s`);
}
