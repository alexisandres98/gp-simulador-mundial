// tennis-engine/data.js — LA MEMORIA DEL TENIS: base propia, ratings y catálogo (blueprint 6.0 F2-F5)
//
// Carga matches.json (61k partidos ATP+WTA 2015→) y reproduce TODO el historial con las constantes
// congeladas de model-priors.json → Elo general + Elo por superficie + saque/resto opponent-adjusted
// por jugador, exactamente el mismo estado que validó el walk-forward. El catálogo (fichas, forma,
// cortes por superficie) sale de la misma pasada. Atribución: base derivada del proyecto de Jeff
// Sackmann (CC BY-NC-SA 4.0) — admin-only, sin uso comercial (data/tennis/RIGHTS.md).
'use strict';

const fs = require('fs');
const path = require('path');

// LA BASE PUEDE VIVIR EN EL DISCO PERSISTENTE, y desde el 20-ago tiene que poder. Motivo: los repos de
// Jeff Sackmann fueron retirados de GitHub, así que la base ya no se refresca sola desde la fuente — se le
// pega una cola diaria derivada del marcador público de ESPN. Esa cola la escribe un trabajo del servidor,
// y lo que un trabajo escribe en el repo se pierde en el siguiente despliegue. Así que se mira primero el
// disco (mismo patrón que los datos de clubes) y se cae al repo cuando no hay disco: en local, en un
// despliegue nuevo antes del primer refresco, y en cualquier entorno sin volumen.
const REPO_BASE = path.join(__dirname, '..', 'data', 'tennis');
const DISK_BASE = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'tennis');
const archivo = (n) => { try { const d = path.join(DISK_BASE, n); if (fs.existsSync(d)) return d; } catch { /* sin disco */ } return path.join(REPO_BASE, n); };
const BASE = REPO_BASE;   // se conserva por compatibilidad con quien lo importe
const logit = (p) => Math.log(p / (1 - p));
const sig = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SURFACES = ['dura', 'arcilla', 'hierba', 'moqueta'];

let D = null; // estado construido una vez por proceso
// Se reconstruye SOLO cuando la cola escribe: reproducir 63.000 partidos cuesta, y hacerlo por si acaso en
// cada petición sería peor que la base vieja.
function reset() { D = null; }

// ── EL ESTADO INICIAL Y LA REGLA DE ACTUALIZACIÓN, ESCRITAS UNA SOLA VEZ (15-sep, T2.14) ────────────────
// Antes el bucle de actualización vivía DENTRO de `build()` y no había forma de preguntarle al modelo
// "¿qué sabías ANTES de este partido?" sin copiar cuarenta líneas a un script. Una copia es una copia que
// se desincroniza: el día que alguien toque la vida media aquí, el challenger seguiría validando el modelo
// viejo y nadie se enteraría. Así que la regla se extrae a `aplicaFila` y la usan las DOS puertas —
// `build()` (estado final, producción) y `recorre()` (walk-forward, investigación)—. `tests/tennis-replay.test.js`
// comprueba que las dos llegan al mismo Elo: si alguien rompe la equivalencia, el test lo dice.
function estadoInicial(priors) {
  const T = [{}, {}]; // por tour: estado del modelo + catálogo
  for (const tn of [0, 1]) {
    const lbl = tn === 0 ? 'atp' : 'wta';
    const cst = (priors.tours[lbl] || {}).constants || { kScale: 0.8, surfW: 0.3, halfLife: 30, shrinkK: 15, ensembleU: 0.3, shock: 0.07, tourSpwStart: tn === 0 ? 0.63 : 0.57, gamesCal: { bo3: [0, 1], bo5: [0, 1] } };
    T[tn] = {
      cst, elo: new Map(), eloSurf: [new Map(), new Map(), new Map(), new Map()], nMatch: new Map(),
      srv: new Map(), ret: new Map(), tourSpw: cst.tourSpwStart || (tn === 0 ? 0.63 : 0.57), tourN: 50,
      prof: new Map(), // id → perfil de catálogo
      // ÚLTIMA VEZ QUE ESTE JUGADOR APORTÓ ESTADÍSTICA DE SAQUE (15-sep, T2.14). No es lo mismo que
      // `lastDate`: la cola de ESPN trae ganador, sets y juegos, pero NI UN punto de saque. Desde que la
      // espina de Sackmann se cortó (25-may-2026) los índices de saque y resto de TODOS los jugadores
      // están congelados, y el motor los servía sin decir de cuándo eran. Aquí queda la fecha, por jugador.
      srvDate: new Map(),
    };
  }
  return T;
}

const K_ELO = (cst, n) => cst.kScale * 250 / Math.pow(n + 5, 0.4);
const gDef = (m, k, d) => (m.has(k) ? m.get(k) : d);
const devOf = (t, m, id) => { const o = m.get(id); return o && o.w >= 3 ? (o.v / o.w) * (o.w / (o.w + t.cst.shrinkK)) : 0; };

// Aplica UNA fila al estado. `antes(r, t)` se llama con el estado PREVIO al partido: ése es el único
// momento en el que una validación temporal puede preguntar sin contaminarse con el resultado.
function aplicaFila(T, F, tourneys, r, antes) {
  const t = T[r[F.tour]]; const cst = t.cst;
  if (antes) antes(r, t);
  const date = r[F.date], surf = r[F.surface];
  const A = r[F.wid], B = r[F.lid];
  const eA = gDef(t.elo, A, 1500), eB = gDef(t.elo, B, 1500);
  const sT = surf >= 0 ? t.eloSurf[surf] : null;
  const sA = sT ? gDef(sT, A, 1500) : 1500, sB = sT ? gDef(sT, B, 1500) : 1500;
  const pGen = 1 / (1 + Math.pow(10, -(eA - eB) / 400));
  const pSurf = 1 / (1 + Math.pow(10, -(sA - sB) / 400));
  const nA = gDef(t.nMatch, A, 0), nB = gDef(t.nMatch, B, 0);
  t.elo.set(A, eA + K_ELO(cst, nA) * (1 - pGen)); t.elo.set(B, eB - K_ELO(cst, nB) * (1 - pGen));
  if (sT) { sT.set(A, sA + K_ELO(cst, nA) * (1 - pSurf)); sT.set(B, sB - K_ELO(cst, nB) * (1 - pSurf)); }
  t.nMatch.set(A, nA + 1); t.nMatch.set(B, nB + 1);

  const alpha = Math.log(2) / cst.halfLife;
  const upd = (m, id, val) => { const o = m.get(id) || { v: 0, w: 0 }; o.v = o.v * (1 - alpha) + val; o.w = o.w * (1 - alpha) + 1; m.set(id, o); };
  const wsv = r[F.w_svpt], lsv = r[F.l_svpt];
  let wSpw = null, lSpw = null;
  if (wsv > 30 && lsv > 30) {
    wSpw = (r[F.w_1stWon] + r[F.w_2ndWon]) / wsv;
    lSpw = (r[F.l_1stWon] + r[F.l_2ndWon]) / lsv;
    t.tourSpw = (t.tourSpw * t.tourN + wSpw + lSpw) / (t.tourN + 2); t.tourN = Math.min(t.tourN + 2, 4000);
    upd(t.srv, A, wSpw - t.tourSpw + devOf(t, t.ret, B)); upd(t.srv, B, lSpw - t.tourSpw + devOf(t, t.ret, A));
    upd(t.ret, A, t.tourSpw + devOf(t, t.srv, B) - lSpw); upd(t.ret, B, t.tourSpw + devOf(t, t.srv, A) - wSpw);
    t.srvDate.set(A, date); t.srvDate.set(B, date);
    t.spwDate = date;                     // la última fecha con estadística de saque de TODO el circuito
  }

  // catálogo (misma pasada): forma, superficie, saque de carrera, últimos partidos
  for (const [id, opp, won] of [[A, B, true], [B, A, false]]) {
    let p = t.prof.get(id);
    if (!p) { p = { w: 0, l: 0, surf: [[0, 0], [0, 0], [0, 0], [0, 0]], recent: [], lastDate: 0, rank: null, ace: 0, df: 0, sv: 0, in1: 0, spwS: 0, spwN: 0, bpS: 0, bpF: 0 }; t.prof.set(id, p); }
    if (won) p.w++; else p.l++;
    if (surf >= 0) p.surf[surf][won ? 0 : 1]++;
    p.lastDate = Math.max(p.lastDate, date);
    const rk = won ? r[F.w_rank] : r[F.l_rank];
    if (rk > 0) p.rank = rk;
    const pre = won ? 'w_' : 'l_';
    if (r[F[pre + 'svpt']] > 30) {
      p.ace += r[F[pre + 'ace']]; p.df += r[F[pre + 'df']]; p.sv += r[F[pre + 'svpt']]; p.in1 += r[F[pre + '1stIn']];
      p.bpS += Math.max(0, r[F[pre + 'bpSaved']]); p.bpF += Math.max(0, r[F[pre + 'bpFaced']]);
      p.spwS += won ? wSpw : lSpw; p.spwN++;
    }
    p.recent.push({ d: date, opp, won, score: r[F.score], surf, t: tourneys[r[F.tid]] ? tourneys[r[F.tid]].name : '', round: r[F.round], ret: r[F.ret] });
    if (p.recent.length > 14) p.recent.shift();
  }
}

// Lee los cuatro archivos de la base. Se aparta de `build()` para que el walk-forward pueda releerlos sin
// tocar la caché del proceso (el servidor está sirviendo con `D` y una validación no puede pisarlo).
function leeBase() {
  const { schema, tourneys, rows } = JSON.parse(fs.readFileSync(archivo('matches.json'), 'utf8'));
  const players = JSON.parse(fs.readFileSync(archivo('players.json'), 'utf8'));
  // los priors NO vienen del disco: son constantes congeladas del walk-forward y viajan con el código.
  const priors = JSON.parse(fs.readFileSync(path.join(REPO_BASE, 'model-priors.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(archivo('meta.json'), 'utf8'));
  const F = {}; schema.forEach((k, i) => { F[k] = i; });
  return { schema, tourneys, rows, players, priors, meta, F,
    // DE CUÁNDO ES CADA PIEZA (15-sep, T2.14 — A23 de la auditoría). Hasta hoy el motor servía un
    // `freshness` único y la interfaz lo leía como "la base está al día". No es una fecha: son CUATRO, y
    // las cuatro distintas. Servirlas juntas es la diferencia entre decir la verdad y decirla a medias.
    data_as_of: {
      partidos: (meta && meta.last_match_date) || null,
      espina_saque_resto: (meta && meta.tail && meta.tail.spine_until) || null,
      cola_marcador: (meta && meta.tail) ? { desde: meta.tail.from, hasta: meta.tail.to, filas: meta.tail.rows } : null,
      base_construida: (meta && meta.built_at) || null,
      constantes: (priors && priors.built_at) || null,
      constantes_desarrollo_hasta: (priors && priors.dev_end) || null,
      archivo: { matches: archivo('matches.json'), disco: archivo('matches.json') !== path.join(REPO_BASE, 'matches.json') },
    } };
}

function build() {
  if (D) return D;
  // matches/players/meta pueden venir del disco (los refresca la cola); los priors NO.
  const base = leeBase();
  const T = estadoInicial(base.priors);
  for (const r of base.rows) aplicaFila(T, base.F, base.tourneys, r, null);
  D = { ...base, T };
  return D;
}

// ── WALK-FORWARD: el estado tal y como era ANTES de cada partido (15-sep) ────────────────────────────────
// `onMatch(r, t, ctx)` recibe la fila y el estado PREVIO. Filtra por fecha con `desde`/`hasta` (ymd). No
// toca la caché del proceso: construye su propio estado desde cero, así que se puede correr dentro del
// servidor sin envenenar lo que se está sirviendo. Coste: una pasada por las 63.000 filas.
function recorre({ desde = 0, hasta = 99999999, onMatch } = {}) {
  const base = leeBase();
  const T = estadoInicial(base.priors);
  const ctx = { F: base.F, tourneys: base.tourneys, priors: base.priors, meta: base.meta,
    players: base.players, data_as_of: base.data_as_of, T };
  let vistos = 0;
  for (const r of base.rows) {
    aplicaFila(T, base.F, base.tourneys, r, (rr, t) => {
      const d = rr[base.F.date];
      if (d < desde || d > hasta || !onMatch) return;
      vistos++;
      onMatch(rr, t, ctx);
    });
  }
  return { ...ctx, evaluados: vistos, filas: base.rows.length };
}

// ── LAS TASAS DE SAQUE, CON SU RECORTE DECLARADO ────────────────────────────────────────────────────────
// `probsEn` trabaja sobre UN estado (el final en producción, el previo al partido en la validación) para
// que las dos vías usen exactamente la misma fórmula.
//
// EL RECORTE A [0,45 · 0,80] NO ERA GRATIS Y NADIE LO MEDÍA (15-sep, T2.14). Cuando muerde, la probabilidad
// de punto al saque que entra al compilador NO es la que el modelo estimó: es el borde. Todo lo que sale de
// ahí —ganador, juegos, hándicap, tiebreak— es el del borde, y aun así la ficha lo presentaba como la
// lectura del par. Ahora cada llamada dice si mordió y por qué lado; `scripts/tennis-datos.js` cuenta con
// qué frecuencia pasa sobre la base entera.
const CLAMP_SPW = [0.45, 0.80];
function probsEn(t, idA, idB, surf) {
  const cst = t.cst;
  const g2 = (m, k) => (m.has(k) ? m.get(k) : 1500);
  const pGen = 1 / (1 + Math.pow(10, -(g2(t.elo, idA) - g2(t.elo, idB)) / 400));
  const sT = surf >= 0 && surf <= 3 ? t.eloSurf[surf] : null;
  const pSurf = sT ? 1 / (1 + Math.pow(10, -(g2(sT, idA) - g2(sT, idB)) / 400)) : pGen;
  const pMix = sig((1 - cst.surfW) * logit(clamp(pGen, 0.01, 0.99)) + cst.surfW * logit(clamp(pSurf, 0.01, 0.99)));
  const dev = (m, id) => { const o = m.get(id); return o && o.w >= 3 ? (o.v / o.w) * (o.w / (o.w + cst.shrinkK)) : 0; };
  const crudoA = t.tourSpw + dev(t.srv, idA) - dev(t.ret, idB);
  const crudoB = t.tourSpw + dev(t.srv, idB) - dev(t.ret, idA);
  const lado = (x) => (x < CLAMP_SPW[0] ? 'bajo' : x > CLAMP_SPW[1] ? 'alto' : null);
  return { pMix, pGen, pSurf,
    paSrv: clamp(crudoA, CLAMP_SPW[0], CLAMP_SPW[1]), pbSrv: clamp(crudoB, CLAMP_SPW[0], CLAMP_SPW[1]),
    paSrvCrudo: crudoA, pbSrvCrudo: crudoB, clampA: lado(crudoA), clampB: lado(crudoB),
    // la fecha del último dato de saque de cada uno: si es de mayo, la tasa es de mayo y hay que decirlo
    srvDateA: t.srvDate ? (t.srvDate.get(idA) || null) : null,
    srvDateB: t.srvDate ? (t.srvDate.get(idB) || null) : null };
}

// probabilidad del ensamble (misma fórmula congelada que validó el holdout)
function matchProb(tn, idA, idB, surf) {
  return probsEn(build().T[tn], idA, idB, surf);
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// resuelve "Andrey Rublev" / "rublev" → id del tour (los nombres de cuotas y ESPN vienen completos)
function resolvePlayer(tn, name) {
  const d = build();
  const q = norm(name);
  if (!q) return null;
  let best = null;
  for (const [key, p] of Object.entries(d.players)) {
    const [ktn, id] = key.split(':');
    if (+ktn !== tn) continue;
    const n = norm(p.name);
    if (n === q) return { id: +id, ...p };
    if (!best && (n.endsWith(' ' + q) || n.startsWith(q + ' ') || n.includes(q))) {
      const prof = d.T[tn].prof.get(+id);
      best = { id: +id, ...p, _hist: prof ? prof.w + prof.l : 0 };
    } else if (best && (n.endsWith(' ' + q) || n.includes(q))) {
      const prof = d.T[tn].prof.get(+id);
      const h = prof ? prof.w + prof.l : 0;
      if (h > (best._hist || 0)) best = { id: +id, ...p, _hist: h };
    }
  }
  return best;
}

function playerOf(tn, id) { const d = build(); return d.players[tn + ':' + id] || null; }

module.exports = { reset, build, matchProb, resolvePlayer, playerOf, norm, BASE, SURFACES,
  // (15-sep, T2.14) el walk-forward y las piezas que lo componen, expuestas para los scripts y los tests
  recorre, leeBase, estadoInicial, aplicaFila, probsEn, CLAMP_SPW };
