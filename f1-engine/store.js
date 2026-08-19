// f1-engine/store.js — EL RACE INTELLIGENCE TWIN SERVIDO (blueprint 7.0): command center, parrilla
// probabilística, Coche×Piloto, campeonato, fichas, what-if y model card de solo evidencia.
//
// Doctrina: modelo market-blind; The Odds API HOY no cubre F1 (comprobado 18-ago) → el módulo de
// mercado espera y LO DICE; el descubrimiento de claves corre igual y la sombra se enciende sola si
// el plan abre motorsport. Estados de información (bloque 05): PRE-QUALI ↔ POS-QUALI según Jolpica.
// Caja negra: evidencia (ventanas, métricas de holdout, muestras) sí; constantes y fórmulas jamás.
'use strict';

const fs = require('fs');
const path = require('path');
const R = require('./ratings.js');
const SIM = require('./sim.js');

const BASE = path.join(__dirname, '..', 'data', 'f1');
const DISK_DIR = fs.existsSync('/data') ? '/data/f1' : path.join(BASE, 'disk');
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const G = { data: null, at: 0, live: null, liveAt: 0, oddsKeys: null, oddsAt: 0 };

const ATTRIB = 'Datos de Jolpica-F1 (CC BY 4.0).';
const DOCTRINE = 'F1 corre como TERMINAL DE INTELIGENCIA: el gemelo de carrera está validado walk-forward (holdout 2025→) y su fuerza está ANTES de la clasificación —sin parrilla que mirar, gana claro a la tasa base en podio, en puntos y en el duelo entre compañeros—. Con la parrilla ya publicada la casilla predice mejor que el gemelo en todas las familias medidas, así que ahí no publica: es el mismo criterio que cierra el mercado de ganador. Sin cobertura de casas en el plan actual no hay lado mercado: cuando el proveedor abra motorsport, la sombra se enciende sola. Nada de esto es una pick.';

// colores REALES de constructor (el color es un hecho del deporte, no un asset): 2026 + recientes
const TEAM_COLOR = {
  mclaren: '#FF8000', red_bull: '#3671C6', ferrari: '#E8002D', mercedes: '#27F4D2',
  aston_martin: '#229971', alpine: '#0093CC', williams: '#64C4FF', rb: '#6692FF',
  sauber: '#52E252', audi: '#BB0A30', haas: '#B6BABD', cadillac: '#B8A360',
  alphatauri: '#5E8FAA', alfa: '#C92D4B', racing_point: '#F596C8', renault: '#FFF500',
  toro_rosso: '#469BFF', force_india: '#F596C8', lotus_f1: '#8B9B34', manor: '#F40000',
};

function rdD(f) { try { return JSON.parse(fs.readFileSync(path.join(DISK_DIR, f), 'utf8')); } catch { return null; } }
function wrD(f, obj) {
  try {
    fs.mkdirSync(DISK_DIR, { recursive: true });
    const tmp = path.join(DISK_DIR, '.' + f + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, path.join(DISK_DIR, f));
  } catch { }
}

// ── carga: base del repo + overlay del disco (las carreras que Jolpica publica después del deploy) ──────
function load() {
  if (G.data && Date.now() - G.at < 10 * 60e3) return G.data;
  const raw = JSON.parse(fs.readFileSync(path.join(BASE, 'races.json'), 'utf8'));
  const schedule = JSON.parse(fs.readFileSync(path.join(BASE, 'schedule.json'), 'utf8'));
  const priors = JSON.parse(fs.readFileSync(path.join(BASE, 'model-priors.json'), 'utf8'));
  const meta = JSON.parse(fs.readFileSync(path.join(BASE, 'meta.json'), 'utf8'));
  const ov = rdD('overlay.json') || { races: [] };
  const byKey = new Map(raw.races.map((r) => [r.season + '|' + r.round, r]));
  for (const r of ov.races || []) byKey.set(r.season + '|' + r.round, r); // el overlay pisa (corrige) la base
  const races = [...byKey.values()].sort((a, b) => (a.season - b.season) || (a.round - b.round));
  const done = races.filter((r) => Object.values(r.rows).some((x) => x.pos != null));
  // estado del modelo con las constantes CONGELADAS del fit
  const st = R.newState(priors.ratings);
  for (const race of done) R.update(st, race);
  G.data = { races, done, schedule, priors, meta, drivers: raw.drivers, constructors: raw.constructors, st, overlay_at: ov.at || null };
  G.at = Date.now();
  return G.data;
}

// ── refresco del año en curso desde Jolpica (job cada 6 h): resultados + quali → overlay en disco ───────
async function refreshSeason() {
  const year = new Date().getUTCFullYear();
  const jget = async (p) => {
    const r = await fetch('https://api.jolpi.ca/ergast/f1/' + p, { signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'GP-Simulador/1.0 (codigo@gpsimulador.com)' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return (await r.json()).MRData;
  };
  const races = {};
  for (let offset = 0; ; offset += 100) {
    const d = await jget(`${year}/results.json?limit=100&offset=${offset}`);
    for (const rc of d.RaceTable.Races || []) {
      const k = rc.season + '|' + rc.round;
      const RY = races[k] = races[k] || { season: +rc.season, round: +rc.round, name: rc.raceName, cid: rc.Circuit.circuitId, circuit: rc.Circuit.circuitName, country: (rc.Circuit.Location || {}).country || null, date: rc.date, rows: {} };
      for (const x of rc.Results || []) {
        RY.rows[x.Driver.driverId] = { d: x.Driver.driverId, c: x.Constructor.constructorId, grid: +x.grid || null,
          pos: /^\d+$/.test(x.positionText) ? +x.position : null, txt: x.positionText, status: x.status || null, pts: +x.points || 0, laps: +x.laps || 0, q: null };
      }
    }
    if (offset + 100 >= +d.total) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  for (let offset = 0; ; offset += 100) {
    const d = await jget(`${year}/qualifying.json?limit=100&offset=${offset}`);
    for (const rc of d.RaceTable.Races || []) {
      const k = rc.season + '|' + rc.round;
      const RY = races[k] = races[k] || { season: +rc.season, round: +rc.round, name: rc.raceName, cid: rc.Circuit.circuitId, circuit: rc.Circuit.circuitName, country: (rc.Circuit.Location || {}).country || null, date: rc.date, rows: {} };
      for (const x of rc.QualifyingResults || []) {
        const row = RY.rows[x.Driver.driverId] = RY.rows[x.Driver.driverId] || { d: x.Driver.driverId, c: x.Constructor.constructorId, grid: null, pos: null, txt: null, status: null, pts: 0, laps: 0, q: null };
        row.q = +x.position || null;
      }
    }
    if (offset + 100 >= +d.total) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  wrD('overlay.json', { at: new Date().toISOString(), races: Object.values(races) });
  G.at = 0; // invalida el cache: la próxima lectura recompone el estado
  return { races: Object.keys(races).length };
}

// ── la próxima carrera y su ESTADO DE INFORMACIÓN ───────────────────────────────────────────────────────
function nextRace(d) {
  const today = new Date().toISOString().slice(0, 10);
  const sched = (d.schedule.races || []).slice().sort((a, b) => a.round - b.round);
  return sched.find((r) => r.date >= today) || sched[sched.length - 1] || null;
}

function currentField(d, next) {
  // el field vigente = alineaciones de la última carrera completada; si la ronda próxima ya tiene quali
  // (overlay), esa parrilla manda y el estado pasa a POS-QUALI
  const last = d.done[d.done.length - 1];
  const lineup = new Map();
  for (const r of Object.values(last.rows)) lineup.set(r.d, { d: r.d, c: r.c, grid: null, q: null });
  let state = 'PRE_QUALI';
  const upcoming = next && d.races.find((r) => r.season === next.season && r.round === next.round);
  if (upcoming) {
    const qRows = Object.values(upcoming.rows).filter((r) => r.q != null);
    if (qRows.length >= 10) {
      state = 'POST_QUALI';
      for (const r of qRows) lineup.set(r.d, { d: r.d, c: r.c, grid: r.grid || r.q, q: r.q });
    }
  }
  return { entries: [...lineup.values()], state };
}

function colorOf(cid) { return TEAM_COLOR[cid] || null; }

// ── CARAS Y MARCAS (19-ago) ─────────────────────────────────────────────────────────────────────────────
// El color de constructor es un HECHO del deporte y por eso vive en el código; la foto no lo es, así que
// viaja en un manifiesto con su procedencia y su licencia. Origen: Wikipedia/Commons (CC BY-SA), elegido
// por derechos y no por comodidad — las fotos del sitio oficial son de FOM y no se pueden auto-hospedar.
// La atribución se sirve junto a la ruta para poder rendirla en pantalla.
let AS = null;
function assets() {
  if (AS) return AS;
  try { AS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'f1', 'assets.json'), 'utf8')); }
  catch { AS = { drivers: {}, constructors: {} }; }
  return AS;
}
function photoOf(driverId) {
  const r = (assets().drivers || {})[driverId];
  return r && r.photo ? '/logos/f1/' + r.photo : null;
}
function badgeOf(cid) {
  const r = (assets().constructors || {})[cid];
  return r && r.photo ? '/logos/f1/' + r.photo : null;
}

// ── COMMAND CENTER: la parrilla probabilística de la próxima carrera ────────────────────────────────────
// EL CALENDARIO ENTERO (19-ago, pedido de Alexis: "no deberíamos solamente poder analizar la próxima
// carrera sino todas las siguientes"). Devuelve las rondas restantes con lo poco que se sabe de cada una
// —fecha, circuito, país, si tiene sprint— para que la pestaña pueda ofrecerlas y el gemelo corra sobre
// la que se elija. La clasificación solo existe para la inmediata, así que las demás se simulan en estado
// PRE-QUALI y se dice: es una lectura de coche y piloto, sin parrilla.
function calendar() {
  const d = load();
  const today = new Date().toISOString().slice(0, 10);
  const races = (d.schedule.races || []).slice().sort((a, b) => a.round - b.round);
  const next = nextRace(d);
  return {
    available: !!races.length, season: d.schedule.season,
    rows: races.map((r) => ({
      round: r.round, season: r.season || d.schedule.season, name: r.name, date: r.date, time: r.time || null,
      circuit: r.circuit, locality: r.locality, country: r.country, sprint: r.sprint || null,
      done: r.date < today, is_next: !!(next && r.round === next.round),
      days: Math.ceil((Date.parse(r.date + 'T12:00:00Z') - Date.now()) / 864e5),
    })),
    attribution: ATTRIB,
  };
}

// NÚCLEO COMPARTIDO (19-ago): el tablero y las llamadas necesitan EXACTAMENTE el mismo field y la misma
// configuración de simulación — si cada uno lo reconstruyera por su cuenta, un cambio en uno dejaría al
// otro hablando de otra carrera. Se extrae una vez y lo usan los dos.
function boardCore(round) {
  const d = load();
  // con ronda: esa carrera. Sin ronda: la próxima, como siempre.
  const next = round != null
    ? (d.schedule.races || []).find((r) => +r.round === +round) || nextRace(d)
    : nextRace(d);
  if (!next) return null;
  const isNext = !round || (nextRace(d) || {}).round === +round;
  const cf = currentField(d, next);
  // una ronda futura NO puede estar pos-clasificación aunque el overlay traiga la de la inmediata
  const state = isNext ? cf.state : 'PRE_QUALI';
  const field = R.fieldFor(d.st, cf.entries, { useGrid: state === 'POST_QUALI' });
  const simCfg = { ...d.priors.sim, gridW: state === 'POST_QUALI' ? d.priors.sim.gridW : 0, seed: next.season * 100 + next.round };
  return { d, next, state, field, simCfg, res: SIM.simulateRace(field, simCfg) };
}

function raceBoard(round) {
  const core = boardCore(round);
  if (!core) return { available: false, why: 'sin calendario' };
  const { d, next, state, field, simCfg, res } = core;
  const byId = new Map(res.map((x) => [x.id, x]));
  // ensamble de ganador con prior de casilla (solo pos-quali, el peso validado en dev)
  let winBlend = null;
  if (state === 'POST_QUALI') {
    const gp = d.priors.grid_prior || [];
    const raw = field.map((f) => {
      const sp = Math.max(1e-4, (byId.get(f.id) || {}).p_win || 1e-4);
      const pr = Math.max(1e-4, gp[f.grid && f.grid <= 30 ? f.grid : 30] || 0.01);
      return { id: f.id, v: Math.pow(sp, 1 - d.priors.blendU) * Math.pow(pr, d.priors.blendU) };
    });
    const z = raw.reduce((s, x) => s + x.v, 0);
    winBlend = new Map(raw.map((x) => [x.id, x.v / z]));
  }
  const rows = field.map((f) => {
    const s = byId.get(f.id) || {};
    const drv = d.drivers[f.id] || { name: f.id };
    return {
      id: f.id, code: drv.code || null, name: drv.name, country: drv.country || null,
      constructor: (d.constructors[f.cid] || {}).name || f.cid, cid: f.cid, color: colorOf(f.cid),
      photo: photoOf(f.id), badge: badgeOf(f.cid),
      grid: f.grid, p_win: r3(winBlend ? winBlend.get(f.id) : s.p_win), p_win_twin: r3(s.p_win),
      p_podium: r3(s.p_podium), p_top6: r3(s.p_top6), p_points: r3(s.p_points),
      exp_finish: r2(s.exp_finish), p_dnf: r3(s.p_dnf),
      car_idx: r2(100 + 20 * f.car_v), drv_idx: r2(100 + 20 * f.drv_v), car_n: f.car_n, drv_n: f.drv_n,
    };
  }).sort((a, b) => (b.p_win || 0) - (a.p_win || 0));
  return {
    available: true, race: { season: next.season, round: next.round, name: next.name, circuit: next.circuit, country: next.country, locality: next.locality, date: next.date, time: next.time, quali: next.quali, sprint: next.sprint },
    state, state_label: state === 'POST_QUALI' ? 'pos-clasificación (parrilla real)' : 'pre-clasificación (el gemelo estima la parrilla)',
    rows, attribution: ATTRIB, doctrine: DOCTRINE,
    last_completed: d.meta.last_completed, overlay_at: d.overlay_at,
    note: 'ganador = ensamble validado del gemelo con el prior de casilla cuando hay parrilla; podio, top-6, puntos, abandono y orden esperado salen de las MISMAS simulaciones del field completo. Índices coche/piloto: 100 = media del campo.',
  };
}


// ── GP TAKE (19-ago) ────────────────────────────────────────────────────────────────────────────────────
// Alexis: "en f1 tampoco veo panel de oportunidades ni lo veo generando pick". La respuesta honesta es que
// una pick necesita un precio y F1 no tiene mercado en ningún proveedor del plan (comprobado hoy otra vez:
// The Odds API no lista motorsport y Cloudbet publica la categoría con CERO eventos). Lo que sí puede
// hacerse —y es lo que de verdad vale— es publicar LLAMADAS del modelo, fechadas, con su probabilidad, y
// liquidarlas después para que exista un historial verificable. No son apuestas y así se dicen.
//
// QUÉ SE PUBLICA Y POR QUÉ. Al medir familia por familia contra un baseline honesto en el mismo holdout
// apareció lo importante: DESPUÉS de la clasificación, la casilla ya sabe todo lo que sabe el gemelo y
// algo más —podio 0,0674 contra 0,0619 de la casilla; puntos 0,1745 contra 0,1657; duelo 72,5 % contra
// 74,3 %; ganador 1,389 contra 1,058—. El gemelo PIERDE contra mirar la parrilla. ANTES de la clasificación
// no hay parrilla que mirar y ahí el gemelo gana claro: podio 0,0860 contra 0,1244 de la tasa base, puntos
// 0,1907 contra 0,2500, duelo 66,2 % contra 60,2 % de la forma del campeonato.
// Conclusión aplicada tal cual: LAS LLAMADAS SOLO SALEN EN PRE-CLASIFICACIÓN. Con parrilla en la mano la
// pantalla lo dice y no publica nada — publicar algo peor que mirar la casilla sería vender ruido.
// El abandono queda fuera en los dos estados: 0,1061 contra 0,1068 de la tasa base es un empate, y un
// empate no es una llamada.
const TAKE_MIN = { podium: 0.55, points_yes: 0.85, points_no: 0.15, duel_gap: 0.8 };

function takeEvidence(d) {
  const h = (d.priors && d.priors.holdout_prequali) || {};
  const b = h.baseline || {};
  return {
    podium: { metric: 'Brier', model: r3(h.podium_brier), baseline: r3(b.podium_brier), baseline_label: 'tasa base del campo', n: h.n || null },
    points: { metric: 'Brier', model: r3(h.points_brier), baseline: r3(b.points_brier), baseline_label: 'tasa base del campo', n: h.n || null },
    duel: { metric: 'acierto', model: r3(h.duel_acc), baseline: r3(h.duel_form_acc), baseline_label: 'quien va mejor en el campeonato', n: h.duel_n || null },
  };
}

// ── MERCADO REAL: KALSHI (19-ago) ───────────────────────────────────────────────────────────────────────
// F1 dejó de ser el deporte sin mercado. Kalshi cotiza `KXF1RACEPODIUM` y `KXF1TOP10` — justo las dos
// familias donde el gemelo bate al baseline ANTES de la clasificación. El podio tiene liquidez de verdad
// (horquillas de 1-4 puntos, 7.274 de interés abierto en el contrato de Verstappen); el top-10 está fino y
// la mayoría de sus contratos no pasan la guardia de horquilla, así que casi siempre se queda en llamada.
//
// Con precio, una llamada se convierte en PICK: hay una ventaja medible contra alguien que opina lo
// contrario. Sin precio utilizable, sigue siendo llamada. La misma pantalla enseña las dos y dice cuál es
// cuál — mezclarlas sería exactamente lo que llevamos toda la semana evitando.
const KAL = require('../data-providers/kalshi');
const G_MK = { at: 0, data: null };
const normName = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(jr|sr|de|van|von)\b/g, '').replace(/[^a-z]/g, '');

async function f1Market({ ttlMs = 10 * 60e3 } = {}) {
  if (G_MK.data && Date.now() - G_MK.at < ttlMs) return G_MK.data;
  try {
    const m = await KAL.f1Markets();
    const byFam = {};
    for (const [fam, rows] of Object.entries(m.families || {})) {
      byFam[fam] = new Map(rows.filter((r) => r.usable).map((r) => [normName(r.driver_name), r]));
    }
    G_MK.data = { at: m.at, byFam, summary: m.summary, errors: m.errors };
    G_MK.at = Date.now();
  } catch (e) { G_MK.data = { at: new Date().toISOString(), byFam: {}, summary: null, errors: [e.message] }; G_MK.at = Date.now(); }
  return G_MK.data;
}

// listón declarado: 4 pp de ventaja y cuota utilizable. No se ajusta sobre el holdout — el holdout ya se
// gastó midiendo si el modelo sirve, y volver a tocarlo para elegir el umbral sería usar dos veces la
// única muestra que no se puede reutilizar.
const F1_MIN_EDGE_PP = 4;
// DOS GUARDIAS QUE NO SON OPCIONALES, y las dos salieron de mirar la primera tanda de picks reales:
//
//   · LIQUIDEZ. Salían picks contra contratos con 5 de interés abierto. Un precio que nadie sostiene no es
//     una opinión contraria: es un hueco en la pantalla. Por debajo de 200 no se cruza.
//   · LA COLA. El modelo daba 11,2 % de podio a un piloto que el libro paga a 1,5 %, y eso produce un EV
//     nominal del 460 %. No es ventaja: es que nuestra cola es más gorda que la suya justo donde tenemos
//     menos datos, que es el error clásico del favorito-longshot al revés. Se exige que la probabilidad
//     propia no pase de 2,5 veces la del mercado; por encima, la discrepancia se enseña como desacuerdo,
//     no como pick. Las probabilidades del modelo suman exactamente 3,000 en podio y 10,000 en puntos, así
//     que esto NO es un fallo de normalización: es desconfianza declarada en nuestra propia cola.
const F1_MIN_OI = 200;
const F1_MAX_RATIO = 2.5;

function f1PickFrom(mk, family, driverName, pModel) {
  const map = (mk && mk.byFam && mk.byFam[family]) || null;
  if (!map || pModel == null) return null;
  const row = map.get(normName(driverName));
  if (!row || row.p_mid == null || !(row.odds_yes > 1)) return null;
  const edgePp = 100 * (pModel - row.p_mid);
  const oi = row.open_interest || 0;
  const ratio = row.p_mid > 0 ? pModel / row.p_mid : Infinity;
  const bloqueo = oi < F1_MIN_OI ? 'sin liquidez: nadie sostiene ese precio'
    : ratio > F1_MAX_RATIO ? `desacuerdo de cola: el modelo dice ${ratio.toFixed(1)}× lo que paga el libro, y ahí desconfiamos de nuestra propia cola`
      : null;
  return {
    has_market: true, p_market: row.p_mid, odds: row.odds_yes, spread_pp: r2(100 * row.spread),
    open_interest: oi, ticker: row.ticker, book: 'kalshi', ratio: r2(ratio),
    edge_pp: r2(edgePp), is_pick: edgePp >= F1_MIN_EDGE_PP && !bloqueo, blocked: bloqueo,
    ev_pct: r2(100 * (pModel * (row.odds_yes - 1) - (1 - pModel))),
  };
}

async function takesFor(round) {
  const b = raceBoard(round);
  if (!b.available) return { available: false, why: b.why || 'sin calendario' };
  const core = boardCore(round);
  const d = load();
  const ev = takeEvidence(d);
  const base = { season: b.race.season, round: b.race.round, race: b.race.name, date: b.race.date };
  if (b.state === 'POST_QUALI') {
    return { available: false, state: b.state, race: b.race, evidence: ev,
      why: 'Con la parrilla ya publicada, la casilla de clasificación predice esta carrera mejor que el gemelo en todas las familias medidas. Cuando el modelo no aporta, no publica: el tablero de parrilla sigue ahí para leer la carrera.',
      takes: [] };
  }
  // REFERENCIA DE TEMPORADA: lo que este piloto viene haciendo. Sin mercado, esta es la única vara honesta
  // para decidir qué merece publicarse: "Stroll no puntúa" al 98 % no es una llamada, es el calendario.
  // Solo sale a la luz lo que se APARTA de esa referencia — y la referencia viaja con la llamada para que
  // el historial pueda puntuar al gemelo CONTRA ella y no contra el aire.
  const ref = seasonRates(d, base.season, base.round);
  const mk = await f1Market();
  const rows = b.rows || [];
  const out = [];
  const push = (family, subject_id, subject, side, p, refP, why, extra, driverName) => {
    // SI HAY PRECIO, ES PICK. El mercado solo existe para PODIO y PUNTOS y solo del lado "sí": una llamada
    // negativa ("no puntúa") no tiene contrato equivalente utilizable, así que se queda como llamada.
    const mkt = (side === 'si' && driverName) ? f1PickFrom(mk, family, driverName, p) : null;
    out.push({ key: `${base.season}|${base.round}|${family}|${subject_id}|${side}`,
      ...base, family, subject_id, subject, side, p: r3(p), ref: r3(refP),
      gap_pp: refP == null ? null : r2(100 * (p - refP)), why, ...(extra || {}),
      market: mkt, kind: mkt && mkt.is_pick ? 'pick' : 'llamada',
      at: new Date().toISOString() });
  };
  const MIN_GAP = 0.15;
  for (const r of rows) {
    const rr = ref[r.id] || {};
    // PODIO: o el gemelo lo pone arriba con convicción, o se aparta claramente de su temporada
    if (r.p_podium >= TAKE_MIN.podium || (rr.podium != null && r.p_podium - rr.podium >= MIN_GAP && r.p_podium >= 0.3)) {
      push('PODIO', r.id, r.name, 'si', r.p_podium, rr.podium,
        `${r.name} sube al podio en ${Math.round(100 * r.p_podium)} de cada 100 simulaciones` +
        (rr.podium != null ? `, cuando esta temporada lo hace en ${Math.round(100 * rr.podium)} de cada 100` : ' (sin temporada previa que comparar)') +
        `. Coche ${r.car_idx} y piloto ${r.drv_idx} sobre una media de campo de 100.`, { n_ref: rr.n || null }, r.name);
    }
    // PUNTOS: en los dos sentidos, pero SOLO si el gemelo se aparta de lo que el piloto viene haciendo
    if (rr.points != null && rr.n >= 3) {
      const gap = r.p_points - rr.points;
      // LA LLAMADA TIENE QUE APOSTAR POR SU LADO. Con solo el hueco contra la temporada salían cosas como
      // "Hamilton NO puntúa" con el gemelo dándole 76 % de puntuar —el hueco existía, pero el lado era el
      // contrario—. Un matiz sobre la confianza no es una llamada: el lado publicado debe ser, además, el
      // desenlace más probable según el propio modelo.
      if (gap >= MIN_GAP && r.p_points >= 0.5) {
        push('PUNTOS', r.id, r.name, 'si', r.p_points, rr.points,
          `${r.name} puntúa en ${Math.round(100 * r.p_points)} de cada 100 simulaciones, muy por encima del ${Math.round(100 * rr.points)} % con que lo viene haciendo: el gemelo ve el coche mejor de lo que dice su temporada.`, { n_ref: rr.n }, r.name);
      } else if (-gap >= MIN_GAP && r.p_points <= 0.5) {
        push('PUNTOS', r.id, r.name, 'no', 1 - r.p_points, 1 - rr.points,
          `${r.name} se queda fuera de los puntos: el gemelo solo lo mete entre los diez en ${Math.round(100 * r.p_points)} de cada 100, contra el ${Math.round(100 * rr.points)} % de su temporada.`, { n_ref: rr.n });
      }
    }
  }
  // DUELO ENTRE COMPAÑEROS: mismo coche, solo queda el piloto. La probabilidad sale del H2H sobre las
  // MISMAS simulaciones (correlación real del field), no de una media de holdout.
  const byTeam = new Map();
  for (const r of rows) { if (!byTeam.has(r.cid)) byTeam.set(r.cid, []); byTeam.get(r.cid).push(r); }
  for (const pair of byTeam.values()) {
    if (pair.length !== 2) continue;
    const [x, y] = pair.slice().sort((a, c) => (a.exp_finish || 99) - (c.exp_finish || 99));
    const p = core ? SIM.h2hProb(core.field, core.simCfg, x.id, y.id) : null;
    if (p == null || p < 0.62) continue;                    // sin convicción no hay llamada
    const px = (ref[x.id] || {}).pts || 0, py = (ref[y.id] || {}).pts || 0;
    const refSide = px === py ? null : (px > py ? 1 : 0);   // referencia: quien va mejor en el campeonato
    push('DUELO', x.id + '_vs_' + y.id, `${x.name} por delante de ${y.name}`, 'si', p, refSide == null ? null : (refSide ? 0.602 : 0.398),
      `Mismo coche, así que solo queda el piloto: ${x.name} termina por delante de ${y.name} en ${Math.round(100 * p)} de cada 100 simulaciones` +
      (refSide === 0 ? `, y va POR DETRÁS en el campeonato (${px} a ${py} puntos) — el gemelo contradice a la tabla.`
        : refSide === 1 ? `, coherente con el campeonato (${px} a ${py} puntos).`
          : `, y el campeonato no desempata (${px} a ${py} puntos): aquí la tabla no dice nada y solo habla el gemelo.`),
      { contra_referencia: refSide === 0 });
  }
  // ── CON PRECIO, EL CRITERIO ES OTRO (19-ago) ─────────────────────────────────────────────────────────
  // La regla de "apartarse 15 pp de lo que ese piloto viene haciendo" existía PORQUE no había mercado: era
  // detección de anomalías, no de ventaja, y así lo concedimos. Donde ahora hay precio utilizable, sobra:
  // se recorre el campo entero y se emite pick cuando la ventaja contra el libro llega al listón. Sin esto,
  // el mercado líquido de la casa —el podio— casi nunca se cruzaba, porque el podio rara vez se aparta de
  // la temporada de un piloto.
  const yaHay = new Set(out.map((x) => `${x.family}|${x.subject_id}|${x.side}`));
  for (const r of rows) {
    for (const [family, pModel] of [['PODIO', r.p_podium], ['PUNTOS', r.p_points]]) {
      if (pModel == null) continue;
      if (yaHay.has(`${family}|${r.id}|si`)) continue;
      const mkt = f1PickFrom(mk, family, r.name, pModel);
      if (!mkt || !mkt.is_pick) continue;
      const rr = ref[r.id] || {};
      out.push({ key: `${base.season}|${base.round}|${family}|${r.id}|si`, ...base,
        family, subject_id: r.id, subject: r.name, side: 'si', p: r3(pModel),
        ref: r3(family === 'PODIO' ? rr.podium : rr.points), n_ref: rr.n || null,
        gap_pp: null, market: mkt, kind: 'pick',
        why: `${r.name} ${family === 'PODIO' ? 'sube al podio' : 'puntúa'} en ${Math.round(100 * pModel)} de cada 100 simulaciones y el libro lo paga a ${Math.round(100 * mkt.p_market)} %: ${mkt.edge_pp} puntos de ventaja a cuota ${mkt.odds}, con horquilla de ${mkt.spread_pp} pp e interés abierto de ${Math.round(mkt.open_interest || 0)}.`,
        at: new Date().toISOString() });
    }
  }
  const rec = recordTakes(out);
  const nPick = out.filter((x) => x.kind === 'pick').length;
  return { available: true, state: b.state, race: b.race, takes: out, evidence: ev, stored: rec,
    market: { source: 'kalshi', at: mk.at, summary: mk.summary, errors: mk.errors, picks: nPick,
      note: nPick ? `${nPick} con precio utilizable en Kalshi: son picks, no llamadas` : 'sin precio utilizable ahora mismo: todo queda en llamadas' },
    // LA DOCTRINA DEPENDE DE SI HAY PRECIO, Y AHORA A VECES LO HAY (19-ago). La frase fija decía "F1 no
    // tiene mercado en ningún proveedor del plan" y se quedó escrita cuando era verdad. Desde que Kalshi
    // entró como segundo proveedor hay carreras con contratos utilizables y picks de verdad — y seguir
    // diciendo que no hay mercado mientras se sirven picks contra ese mercado es, sencillamente, mentir
    // en pantalla. Se dice lo que hay en cada carrera.
    doctrine: nPick
      ? `Con precio hay picks: ${nPick} de estas tesis se miden contra un contrato real de Kalshi —libro de órdenes visible, no cuota de casa— y llevan ventaja, cuota, horquilla e interés abierto. El resto son llamadas del modelo: quedan fechadas y se liquidan solas al acabar la carrera. Todo en sombra; el historial de abajo es el único juez.`
      : 'Llamadas del modelo, no apuestas: hoy ningún contrato de esta carrera tiene horquilla utilizable, así que no hay precio contra el que medir ventaja. Cada llamada queda fechada y se liquida sola cuando acaba la carrera — el historial de abajo es el único juez.' };
}

// lo que cada piloto viene haciendo ESTA temporada hasta la ronda anterior (referencia, no predicción)
function seasonRates(d, season, round) {
  const out = {};
  for (const race of d.races) {
    if (race.season !== season || race.round >= round) continue;
    const rows = Object.values(race.rows || {});
    if (!rows.some((x) => x.pos != null)) continue;
    for (const r of rows) {
      const o = (out[r.d] = out[r.d] || { n: 0, pod: 0, pts10: 0, pts: 0 });
      o.n++; o.pts += r.pts || 0;
      if (r.pos != null && r.pos <= 3) o.pod++;
      if (r.pos != null && r.pos <= 10) o.pts10++;
    }
  }
  for (const id of Object.keys(out)) {
    const o = out[id];
    o.podium = o.n ? o.pod / o.n : null;
    o.points = o.n ? o.pts10 / o.n : null;
  }
  return out;
}

// ── memoria: se anotan al emitirse (dedup por clave) y se liquidan cuando la carrera termina ────────────
function recordTakes(list) {
  if (!list.length) return { added: 0 };
  const st = rdD('takes.json') || { rows: {}, at: null };
  let added = 0;
  for (const t of list) {
    if (st.rows[t.key]) continue;
    st.rows[t.key] = { ...t, result: null };
    added++;
  }
  if (added) { st.at = new Date().toISOString(); wrD('takes.json', st); }
  return { added, total: Object.keys(st.rows).length };
}

function settleTakes() {
  const st = rdD('takes.json');
  if (!st || !st.rows) return { settled: 0 };
  const d = load();
  const byKey = new Map(d.races.map((r) => [r.season + '|' + r.round, r]));
  let settled = 0;
  for (const k of Object.keys(st.rows)) {
    const t = st.rows[k];
    if (t.result) continue;
    const race = byKey.get(t.season + '|' + t.round);
    if (!race) continue;
    const rows = Object.values(race.rows || {});
    if (!rows.some((x) => x.pos != null)) continue;         // todavía no hay resultado
    const pos = (id) => { const r = rows.find((x) => x.d === id); return r && r.pos != null ? r.pos : null; };
    let hit = null;
    if (t.family === 'PODIO') { const p = pos(t.subject_id); hit = p != null && p <= 3; }
    else if (t.family === 'PUNTOS') { const p = pos(t.subject_id); const inPts = p != null && p <= 10; hit = t.side === 'si' ? inPts : !inPts; }
    else if (t.family === 'DUELO') {
      const [a, c] = String(t.subject_id).split('_vs_');
      const pa = pos(a), pc = pos(c);
      if (pa == null || pc == null) { t.result = 'VOID'; t.settled_at = new Date().toISOString(); settled++; continue; }
      hit = pa < pc;
    }
    if (hit == null) continue;
    t.result = hit ? 'ACIERTO' : 'FALLO';
    t.settled_at = new Date().toISOString();
    settled++;
  }
  if (settled) { st.at = new Date().toISOString(); wrD('takes.json', st); }
  return { settled, total: Object.keys(st.rows).length };
}

function takeTrack() {
  settleTakes();
  const st = rdD('takes.json') || { rows: {} };
  const all = Object.values(st.rows || {}).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const closed = all.filter((t) => t.result === 'ACIERTO' || t.result === 'FALLO');
  const byFam = {};
  for (const t of closed) {
    const f = (byFam[t.family] = byFam[t.family] || { n: 0, ok: 0, brier: 0 });
    f.n++; if (t.result === 'ACIERTO') f.ok++;
    f.brier += Math.pow((t.p || 0) - (t.result === 'ACIERTO' ? 1 : 0), 2);
  }
  const fams = Object.entries(byFam).map(([family, f]) => ({
    family, n: f.n, acierto: r3(f.ok / f.n), brier: r3(f.brier / f.n),
  })).sort((a, b) => b.n - a.n);
  const d = load();
  return {
    available: true, n_total: all.length, n_liquidadas: closed.length,
    abiertas: all.filter((t) => !t.result).length,
    void: all.filter((t) => t.result === 'VOID').length,
    families: fams, evidence: takeEvidence(d),
    rows: all.slice(0, 60),
    note: closed.length < 20
      ? 'Historial recién abierto: con menos de veinte llamadas liquidadas ningún porcentaje significa nada todavía. Se publica igual porque esconderlo hasta que luzca bien es exactamente lo que no hacemos.'
      : 'Cada llamada se anotó ANTES de la carrera y se liquidó con el resultado oficial. El Brier premia estar seguro y acertar, y castiga estar seguro y fallar.',
  };
}

// ── CAMPEONATO: puntos reales de la temporada + rating GP (Coche × Piloto) ──────────────────────────────
function standings() {
  const d = load();
  const year = (d.done[d.done.length - 1] || {}).season;
  const drv = new Map(), cons = new Map();
  for (const race of d.done) {
    if (race.season !== year) continue;
    for (const r of Object.values(race.rows)) {
      const a = drv.get(r.d) || { id: r.d, pts: 0, wins: 0, podiums: 0, cid: r.c };
      a.pts += r.pts || 0; if (r.pos === 1) a.wins++; if (r.pos != null && r.pos <= 3) a.podiums++;
      a.cid = r.c; drv.set(r.d, a);
      const c = cons.get(r.c) || { id: r.c, pts: 0, wins: 0 };
      c.pts += r.pts || 0; if (r.pos === 1) c.wins++; cons.set(r.c, c);
    }
  }
  const rowsD = [...drv.values()].sort((a, b) => b.pts - a.pts).map((a, i) => {
    const car = R.val(d.st.car, a.cid, d.priors.ratings.shrinkCar), dr = R.val(d.st.drv, a.id, d.priors.ratings.shrinkDrv);
    return { pos: i + 1, id: a.id, name: (d.drivers[a.id] || {}).name || a.id, code: (d.drivers[a.id] || {}).code,
      constructor: (d.constructors[a.cid] || {}).name || a.cid, cid: a.cid, color: colorOf(a.cid),
      photo: photoOf(a.id), badge: badgeOf(a.cid),
      pts: a.pts, wins: a.wins, podiums: a.podiums,
      car_idx: r2(100 + 20 * car.v), drv_idx: r2(100 + 20 * dr.v) };
  });
  const rowsC = [...cons.values()].sort((a, b) => b.pts - a.pts).map((c, i) => ({
    pos: i + 1, id: c.id, name: (d.constructors[c.id] || {}).name || c.id, color: colorOf(c.id), badge: badgeOf(c.id),
    pts: c.pts, wins: c.wins, car_idx: r2(100 + 20 * R.val(d.st.car, c.id, d.priors.ratings.shrinkCar).v),
  }));
  return { season: year, drivers: rowsD, constructors: rowsC, attribution: ATTRIB,
    note: 'puntos y victorias son OFICIALES de la temporada; los índices coche/piloto son el estado del gemelo (100 = media del campo), validados walk-forward. La composición interna es reservada.' };
}

// ── FICHAS ──────────────────────────────────────────────────────────────────────────────────────────────
function driversDirectory({ q = '' } = {}) {
  const d = load();
  const year = (d.done[d.done.length - 1] || {}).season;
  const seen = new Map();
  for (const race of d.done.slice(-40)) for (const r of Object.values(race.rows)) seen.set(r.d, { cid: r.c, last: race.season + '|' + race.round, season: race.season });
  const nq = String(q || '').toLowerCase();
  const rows = [];
  for (const [id, info] of seen) {
    const drv = d.drivers[id]; if (!drv) continue;
    if (nq && !(drv.name || '').toLowerCase().includes(nq)) continue;
    const dr = R.val(d.st.drv, id, d.priors.ratings.shrinkDrv);
    rows.push({ id, name: drv.name, code: drv.code, country: drv.country,
      constructor: (d.constructors[info.cid] || {}).name || info.cid, cid: info.cid, color: colorOf(info.cid),
      photo: photoOf(info.id || id), badge: badgeOf(info.cid),
      drv_idx: r2(100 + 20 * dr.v), n: Math.round(dr.n), active: info.season === year });
  }
  rows.sort((a, b) => (b.active - a.active) || (b.drv_idx - a.drv_idx));
  return { rows, attribution: ATTRIB };
}

function driverProfile(id) {
  const d = load();
  const drv = d.drivers[id];
  if (!drv) return { available: false, why: 'piloto fuera de la base' };
  const recent = [];
  let cid = null, ptsSeason = 0;
  const year = (d.done[d.done.length - 1] || {}).season;
  for (const race of d.done) {
    const r = race.rows[id]; if (!r) continue;
    cid = r.c;
    if (race.season === year) ptsSeason += r.pts || 0;
    recent.push({ season: race.season, round: race.round, name: race.name, date: race.date,
      grid: r.grid, pos: r.pos, txt: r.txt, status: r.status, pts: r.pts });
  }
  if (!recent.length) return { available: false, why: 'sin carreras en la base' };
  const dr = R.val(d.st.drv, id, d.priors.ratings.shrinkDrv);
  const car = cid ? R.val(d.st.car, cid, d.priors.ratings.shrinkCar) : { v: 0, n: 0 };
  const dnf = R.val(d.st.drvDnf, id, d.priors.ratings.shrinkDnf);
  const last20 = recent.slice(-20);
  const gains = last20.filter((x) => x.grid && x.pos).map((x) => x.grid - x.pos);
  return {
    available: true, id, name: drv.name, code: drv.code, country: drv.country, dob: drv.dob,
    constructor: cid ? (d.constructors[cid] || {}).name : null, cid, color: colorOf(cid),
    photo: photoOf(id), badge: badgeOf(cid),
    season: { year, pts: ptsSeason },
    drv_idx: r2(100 + 20 * dr.v), car_idx: r2(100 + 20 * car.v), sample: Math.round(dr.n),
    dnf_rate_pct: r2(100 * dnf.v),
    avg_gain: gains.length ? r2(gains.reduce((s, x) => s + x, 0) / gains.length) : null,
    recent: recent.slice(-14).reverse(),
    attribution: ATTRIB,
    index_note: 'índice de piloto = residual sobre su coche, ajustado por campo y validado fuera de muestra (100 = media). La composición interna es reservada.',
  };
}

// ── WHAT-IF: mover a un piloto de casilla y ver el mundo cambiar (common random numbers) ────────────────
function whatIf({ driver, grid }) {
  const d = load();
  const next = nextRace(d);
  const { entries, state } = currentField(d, next);
  const field = R.fieldFor(d.st, entries, { useGrid: true });
  // parrilla base: real si existe; si no, la implícita del gemelo (orden por perf)
  if (state !== 'POST_QUALI') {
    field.slice().sort((a, b) => b.perf - a.perf).forEach((f, i) => { f.grid = i + 1; });
  }
  const tgt = field.find((f) => f.id === driver || ((d.drivers[f.id] || {}).name || '').toLowerCase().includes(String(driver).toLowerCase()) || ((d.drivers[f.id] || {}).code || '').toLowerCase() === String(driver).toLowerCase());
  if (!tgt) return { available: false, why: `no encuentro a "${driver}" en el field vigente` };
  const seed = next.season * 100 + next.round;
  const simCfg = { ...d.priors.sim, seed };
  const base = SIM.simulateRace(field, simCfg);
  const gTo = Math.max(1, Math.min(field.length, +grid || 1));
  const occupant = field.find((f) => f.grid === gTo);
  const gFrom = tgt.grid;
  const field2 = field.map((f) => ({ ...f }));
  const t2 = field2.find((f) => f.id === tgt.id);
  t2.grid = gTo;
  if (occupant && occupant.id !== tgt.id) field2.find((f) => f.id === occupant.id).grid = gFrom;
  const alt = SIM.simulateRace(field2, simCfg); // MISMA semilla: common random numbers (F-0029)
  const pick = (arr, id) => arr.find((x) => x.id === id) || {};
  const nm = (id) => (d.drivers[id] || {}).name || id;
  return {
    available: true, race: next.name, state,
    driver: { id: tgt.id, name: nm(tgt.id), from: gFrom, to: gTo },
    swap_with: occupant && occupant.id !== tgt.id ? { id: occupant.id, name: nm(occupant.id) } : null,
    before: { p_win: r3(pick(base, tgt.id).p_win), p_podium: r3(pick(base, tgt.id).p_podium), exp_finish: r2(pick(base, tgt.id).exp_finish) },
    after: { p_win: r3(pick(alt, tgt.id).p_win), p_podium: r3(pick(alt, tgt.id).p_podium), exp_finish: r2(pick(alt, tgt.id).exp_finish) },
    note: 'contrafactual con common random numbers: la MISMA carrera simulada, solo cambia la casilla. Estimaciones de un modelo estadístico, no consejo financiero.',
  };
}

// ── H2H de duelo (de las mismas simulaciones del field) ─────────────────────────────────────────────────
function duel(a, b) {
  const d = load();
  const next = nextRace(d);
  const { entries, state } = currentField(d, next);
  const field = R.fieldFor(d.st, entries, { useGrid: state === 'POST_QUALI' });
  const find = (q) => {
    const nq = String(q).toLowerCase();
    const f = field.find((x) => x.id === q || ((d.drivers[x.id] || {}).name || '').toLowerCase().includes(nq) || ((d.drivers[x.id] || {}).code || '').toLowerCase() === nq);
    return f && f.id;
  };
  const ia = find(a), ib = find(b);
  if (!ia || !ib) return { available: false, why: `no encuentro a "${!ia ? a : b}" en el field vigente` };
  const p = SIM.h2hProb(field, { ...d.priors.sim, gridW: state === 'POST_QUALI' ? d.priors.sim.gridW : 0, seed: next.season * 100 + next.round }, ia, ib);
  return { available: true, race: next.name, state, a: { id: ia, name: (d.drivers[ia] || {}).name }, b: { id: ib, name: (d.drivers[ib] || {}).name }, p_a_beats_b: r3(p) };
}

// ── mercado en espera + sonda ───────────────────────────────────────────────────────────────────────────
async function oddsKeysCheck() {
  const key = process.env.SPORTSBOOK_PROVIDER_API_KEY || '';
  if (!key) return { covered: false, keys: [] };
  if (G.oddsKeys && Date.now() - G.oddsAt < 24 * 3600e3) return G.oddsKeys;
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${key}&all=true`, { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const keys = Array.isArray(j) ? j.filter((s) => /motor|formula|f1/i.test(s.group + ' ' + s.key + ' ' + s.title)).map((s) => ({ key: s.key, title: s.title, active: s.active })) : [];
    G.oddsKeys = { covered: keys.some((k) => k.active), keys, checked_at: new Date().toISOString() };
    G.oddsAt = Date.now();
    return G.oddsKeys;
  } catch { return G.oddsKeys || { covered: false, keys: [] }; }
}

// VIGILANCIA DE COBERTURA para la pantalla de Oportunidades (19-ago). `oddsKeysCheck` mira el proveedor
// principal; esto añade el secundario y devuelve un parte legible por libro, para que la pantalla pueda
// decir QUÉ se miró y CUÁNDO en vez de un vacío sin explicación.
async function coverage() {
  const books = [];
  const main = await oddsKeysCheck().catch(() => null);
  books.push({
    book: 'The Odds API', ok: !!(main && main.covered),
    note: !main ? 'sin clave configurada' : main.covered
      ? `${main.keys.filter((k) => k.active).length} mercado(s) de motorsport activos`
      : 'no lista motorsport en el plan actual',
  });
  // Cloudbet publica la categoría formula-1 pero con cero eventos: se comprueba en vivo, no se asume
  const cb = process.env.CLOUDBET_API_KEY || '';
  let cbOk = false, cbNote = 'sin clave configurada';
  if (cb) {
    try {
      const r = await fetch('https://sports-api.cloudbet.com/pub/v2/odds/sports/formula-1?limit=5',
        { headers: { 'X-API-Key': cb }, signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      const n = ((j && j.categories) || []).reduce((a, c) => a + ((c.competitions || []).length), 0);
      cbOk = n > 0;
      cbNote = n > 0 ? `${n} competición(es) abiertas` : 'categoría publicada, cero eventos';
    } catch (e) { cbNote = 'no respondió'; }
  }
  books.push({ book: 'Cloudbet', ok: cbOk, note: cbNote });
  return { at: new Date().toISOString(), covered: books.some((b) => b.ok), books };
}

function modelCard() {
  const d = load();
  const P = d.priors;
  return {
    name: 'Race Intelligence Twin — F1', version: P.model_version,
    family: 'modelo propio de GP — composición reservada', doctrine: DOCTRINE,
    base: { races: d.done.length, window: d.meta.window, drivers: Object.keys(d.drivers).length, last_completed: d.meta.last_completed, source: 'Jolpica-F1 (CC BY 4.0)' },
    validation: {
      protocol: 'walk-forward estricto: constantes en desarrollo 2014-2024 (el cambio reglamentario de 2022 midió cuánta historia de coche sobrevive a un cambio de reglas — eso hereda 2026), holdout 2025→ evaluado UNA vez, dos estados de información',
      holdout_postquali: P.holdout_postquali, holdout_prequali: P.holdout_prequali,
      reading: 'DÓNDE SIRVE Y DÓNDE NO, medido familia por familia contra un baseline honesto en el mismo holdout (19-ago). ANTES de la clasificación el gemelo gana claro: Brier de podio 0,086 contra 0,124 de la tasa base del campo, puntos 0,191 contra 0,250, duelo entre compañeros 66,2 % contra 60,2 % de "quien va mejor en el campeonato". DESPUÉS de la clasificación pierde contra mirar la parrilla en TODAS las familias: podio 0,067 contra 0,062, puntos 0,175 contra 0,166, duelo 72,5 % contra 74,3 %, ganador 1,389 (ensamble 1,150) contra 1,058. La casilla ya contiene lo que el gemelo sabe y algo más. Aplicado tal cual: las llamadas de GP solo se publican en PRE-clasificación; con parrilla en la mano el modelo no publica nada. El abandono queda fuera en los dos estados (0,1061 contra 0,1068 de la tasa base es un empate, y un empate no es una llamada).',
    },
    market: { covered: false, note: 'The Odds API sin cobertura F1 en el plan actual (comprobado 18-ago-2026); el descubrimiento corre a diario y la sombra se enciende sola si abre.' },
    disclaimer: 'estimaciones de un modelo estadístico, no consejo financiero.',
  };
}

async function modelSnapshot() {
  const d = load();
  return {
    base: { races: d.done.length, last: d.meta.last_completed, overlay_at: d.overlay_at },
    next: nextRace(d), state: currentField(d, nextRace(d)).state,
    priors: d.priors.model_version, odds: await oddsKeysCheck(), disk: DISK_DIR,
  };
}

module.exports = { coverage, calendar, load, refreshSeason, raceBoard, standings, driversDirectory, driverProfile, whatIf, duel, modelCard, modelSnapshot, oddsKeysCheck, takesFor, settleTakes, takeTrack, f1Market, f1PickFrom, DISK_DIR, DOCTRINE };
