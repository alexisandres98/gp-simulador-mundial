// data-fabric/snapshots.js — CONGELADO POINT-IN-TIME POR PREDICCIÓN (16-ago).
// Módulo 5 del blueprint, y la pieza que hace auditable todo lo demás.
//
// QUÉ ES UN SNAPSHOT. La fotografía exacta de lo que el modelo tenía delante cuando dijo lo que dijo:
// qué partido, qué versión del modelo, qué supuestos de alineación, qué precio de mercado, qué frescura
// tenía cada dato y qué probabilidad salió. Se firma con un hash y no se toca nunca más.
//
// PARA QUÉ SIRVE DE VERDAD — tres preguntas que hoy no podríamos contestar:
//   1. "Esta pick perdió. ¿El modelo se equivocó o le faltaba el dato?" → mirar si la baja ya estaba en el
//      snapshot. Si no estaba, no fue un fallo de modelo: fue de cobertura, y se arregla en otro sitio.
//   2. "El backtest da mejor que la realidad." → comparar el snapshot con lo que el backtest reconstruye.
//      Si el backtest ve más de lo que veía el snapshot, hay fuga, y ahí está la prueba.
//   3. "¿Este número salió del modelo de julio o del de agosto?" → el snapshot lleva la versión.
//
// REPRODUCIBILIDAD (módulo 327): mismo snapshot + misma versión de modelo → misma predicción. El hash de
// entradas es lo que permite comprobarlo sin volver a correr nada.
'use strict';

const fs = require('fs');
const path = require('path');
const ST = require('./store');
const PR = require('./provenance');

const dir = () => path.join(ST.ROOT(), 'snapshots');
const ensure = () => { try { fs.mkdirSync(dir(), { recursive: true }); } catch { /* ya existe */ } };

// ---- VERSIÓN DEL MODELO ----------------------------------------------------------------------------------
// Se compone de lo que de verdad cambia una predicción: el artefacto de ajuste, el veredicto de validación
// y las capas encendidas. Dos predicciones con la misma versión DEBEN coincidir; si no coinciden, hay algo
// no determinista y es un bug.
function modelVersion(C) {
  const a = (C && C.fit_artifact) || {};
  const v = (C && C.validation) || {};
  const layers = (v.layers && Object.entries(v.layers).filter(([, x]) => x && x.on).map(([k]) => k).sort().join('+')) || 'ninguna';
  return {
    league: C && C.league,
    fit_at: a.at || null, fit_games: a.games_n || null,
    validation_at: v.at || null, validation_n: v.n || null,
    layers,
    blend_w: (C && C.blend && C.blend.w) != null ? C.blend.w : null,
    id: [C && C.league, (a.at || '').slice(0, 19), (v.at || '').slice(0, 19), layers].join('|'),
  };
}

// ---- CONGELAR ---------------------------------------------------------------------------------------------
// `inputs` es todo lo que entró; `output` es lo que salió. Nada de referencias a objetos vivos: se guarda
// el VALOR, porque una referencia a algo que luego cambia no es un congelado.
function freezePrediction({ C, game, inputs = {}, output = {}, purpose = 'game_view' }) {
  ensure();
  const mv = modelVersion(C);
  const now = new Date().toISOString();
  const snap = {
    at: now, purpose,
    game: { id: String(game.id), league: game.league || (C && C.league), date: game.date,
      home: String(game.home.id), away: String(game.away.id), neutral: !!game.neutral },
    model_version: mv,
    inputs: {
      // supuestos de alineación: quién dábamos por fuera y con qué probabilidad jugaba cada duda
      availability: inputs.availability || null,
      // el precio de mercado que se usó y CUÁNDO se observó (sin esto el CLV no es auditable)
      market: inputs.market || null,
      // frescura declarada de cada familia de dato en el momento de predecir
      freshness: inputs.freshness || null,
      sims: inputs.sims || null,
      injuries_seen: (inputs.injuries || []).map((t) => ({ team_id: t.team_id, items: (t.items || []).map((i) => ({ id: i.id, status: i.status })) })),
    },
    output: {
      p_home: output.p_home != null ? +Number(output.p_home).toFixed(4) : null,
      p_model: output.p_model != null ? +Number(output.p_model).toFixed(4) : null,
      margin: output.margin != null ? +Number(output.margin).toFixed(2) : null,
      total: output.total != null ? +Number(output.total).toFixed(2) : null,
      uncertainty_pp: output.uncertainty_pp != null ? +Number(output.uncertainty_pp).toFixed(2) : null,
      layers: output.layers || null,
    },
  };
  snap.input_hash = ST.sha({ g: snap.game, mv: mv.id, i: snap.inputs }).slice(0, 16);
  snap.id = [snap.game.league, snap.game.id, now.replace(/[:.]/g, '').slice(0, 15), snap.input_hash].join('_');
  const f = path.join(dir(), `${snap.game.league}-${String(game.id)}.jsonl`);
  fs.appendFileSync(f, JSON.stringify(snap) + '\n');
  return snap;
}

// Todos los congelados de un partido, en orden: la película de cómo evolucionó nuestra creencia y por qué.
function forGame(league, gameId) {
  const f = path.join(dir(), `${league}-${String(gameId)}.jsonl`);
  try {
    return fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim())
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// LA PELÍCULA. Convierte la lista de congelados en una línea temporal con lo que cambió entre uno y otro:
// esto es lo que alimenta el panel "GP contra el mercado en el tiempo" con ANOTACIONES reales (módulo 268)
// en vez de una curva sin explicación.
function timeline(league, gameId) {
  const snaps = forGame(league, gameId);
  const out = [];
  let prev = null;
  for (const s of snaps) {
    const ev = { at: s.at, p_home: s.output.p_home, p_model: s.output.p_model, market: s.inputs.market && s.inputs.market.p, changes: [] };
    if (prev) {
      const dp = (s.output.p_home != null && prev.output.p_home != null) ? s.output.p_home - prev.output.p_home : null;
      if (dp != null && Math.abs(dp) >= 0.005) ev.changes.push({ type: 'probabilidad', delta_pp: +(100 * dp).toFixed(2) });
      const before = new Set(flatInj(prev)), after = new Set(flatInj(s));
      for (const k of after) if (!before.has(k)) ev.changes.push({ type: 'parte', detail: 'nuevo: ' + k });
      for (const k of before) if (!after.has(k)) ev.changes.push({ type: 'parte', detail: 'resuelto: ' + k });
      if (prev.model_version.id !== s.model_version.id) ev.changes.push({ type: 'modelo', detail: 'versión nueva' });
      const pm = prev.inputs.market && prev.inputs.market.p, cm = s.inputs.market && s.inputs.market.p;
      if (pm != null && cm != null && Math.abs(cm - pm) >= 0.005) ev.changes.push({ type: 'mercado', delta_pp: +(100 * (cm - pm)).toFixed(2) });
    }
    out.push(ev);
    prev = s;
  }
  return out;
}
const flatInj = (s) => (s.inputs.injuries_seen || []).flatMap((t) => (t.items || []).map((i) => i.id + ':' + i.status));

// ---- AUDITORÍA DE FUGA (módulo 213) ----------------------------------------------------------------------
// Compara lo que el backtest está a punto de usar contra lo que el snapshot dice que sabíamos. Si el
// backtest ve algo que el snapshot no tenía, es fuga y se nombra.
function leakAudit({ snapshot, backtestInputs }) {
  const issues = [];
  const knew = new Set(flatInj(snapshot));
  for (const t of (backtestInputs.injuries || [])) for (const i of (t.items || [])) {
    const k = i.id + ':' + i.status;
    if (!knew.has(k)) issues.push({ type: 'fuga_parte', detail: `el backtest usa "${k}" que no estaba en el congelado`, at: snapshot.at });
  }
  if (backtestInputs.market && snapshot.inputs.market && backtestInputs.market.observed_at
    && Date.parse(backtestInputs.market.observed_at) > Date.parse(snapshot.at)) {
    issues.push({ type: 'fuga_precio', detail: 'el precio del backtest se observó después del congelado' });
  }
  return { clean: issues.length === 0, issues };
}

// ---- FRESCURA DEL CONJUNTO -------------------------------------------------------------------------------
// Un resumen legible de en qué estado llegaban los datos al momento de predecir. Es lo que el panel enseña
// en el cajón de procedencia y lo que las compuertas leen para bloquear por dato incompleto.
function freshnessReport(stamps) {
  const rows = (stamps || []).map((st) => ({ domain: st.domain, source: st.label || st.source, ...PR.freshness(st) }));
  const worst = rows.filter((r) => r.state === 'rancio').length;
  return { rows, stale: worst, ok: worst === 0,
    note: worst ? `${worst} familia(s) de dato fuera de SLA` : 'todas las familias dentro de su SLA' };
}

module.exports = { modelVersion, freezePrediction, forGame, timeline, leakAudit, freshnessReport };
