// scripts/dota-validate.js — ¿HAY RATING PROPIO DE DOTA 2, O SOLO HAY DATOS? (17-ago)
//
// La lección de CS2, aplicada ANTES y no después: un motor no se enchufa porque el dato exista, se enchufa
// cuando su validación walk-forward lo aguanta. Aquí no se lee ningún agregado calculado sobre todo el
// histórico — se recorren las partidas en orden cronológico estricto y cada una se predice con el estado
// ANTERIOR a jugarla. Eso es punto en el tiempo por construcción.
//
// LOS PREDICTORES, todos sobre exactamente las mismas partidas:
//   moneda        0,5 siempre                                  — el suelo absoluto
//   lado          la tasa histórica de Radiant, y nada más     — ¿basta con saber de qué lado juegas?
//   elo           Elo global por equipo, sin lado              — la fuerza, sola
//   elo+lado      Elo global + ventaja de Radiant medida       — el candidato a motor
// Si `elo+lado` no bate claramente a `lado`, no hay rating: hay una ventaja de mapa y un generador de ruido.
//
// LA VENTANA DE CALENTAMIENTO IMPORTA. Un equipo con dos partidas no tiene rating, tiene una anécdota. Se
// publican las métricas sobre TODAS las partidas y sobre las CUALIFICADAS (ambos equipos con ≥ MIN_N
// partidas previas), porque el número que se puede usar en producción es el segundo.
//
// LO QUE MIDIÓ LA PRIMERA PASADA (17-ago, 28.529 partidas con los dos equipos identificados, jul-2025 →
// ago-2026, 2.069 equipos). Escrito aquí para que nadie tenga que volver a correrlo para saber en qué
// punto está el cuarto juego:
//
//   CUALIFICADAS (≥8 partidas previas por equipo, n = 22.098, K = 12)
//     moneda      skill  0,00 %   AUC 0,500
//     lado        skill  0,06 %   AUC 0,496   ← saber que juegas de Radiant no predice casi nada
//     elo+lado    skill  1,92 %   AUC 0,574   ECE 0,017   acierto 55,3 %
//
//   Y la comparación que importa: CS2, con la misma clase de validación, da 7,28 % de skill y AUC 0,652.
//   El rating de Dota 2 tiene señal REAL pero vale una cuarta parte. Barrido de K: 8→1,86 · 12→1,92 ·
//   16→1,83 · 24→1,42 · 32→0,82 · 48→−0,64 (K alto sobreajusta y descalibra; el AUC apenas se mueve,
//   0,571-0,577, así que el techo no está en K sino en el dato).
//
//   POR QUÉ ES BAJO, hipótesis a comprobar antes de tocar el modelo: `/proMatches` mezcla circuito tier-1
//   con ligas regionales de tier-3, con suplentes y con bo1s; un Elo único trata igual una final de The
//   International y una eliminatoria de cuarta división. Lo siguiente que hay que probar es pesar por liga
//   (o filtrar por tier) y encoger el rating de los equipos con poca muestra — no subir K.
//
//   CONSECUENCIA OPERATIVA: con 1,9 % de skill esto NO habilita picks de Dota 2. Sirve para tener rating
//   propio (hoy `rating: 0` en la sonda interna) y para poder medir CLV el día que haya cuotas guardadas.
//
// USO
//   node scripts/dota-validate.js
//   node scripts/dota-validate.js --k=24 --min-n=8 --json=/tmp/dota-val.json
'use strict';

const fs = require('fs');
const path = require('path');

const DISK = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'esports', 'dota2', 'matches.json');
const REPO = path.join(__dirname, '..', 'data', 'esports', 'dota2', 'matches.json');
const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };

const K = +arg('k', 12);   // ajustado en el barrido del 17-ago (ver cabecera): 12 maximiza skill y deja ECE 0,017
const MIN_N = +arg('min-n', 8);
const OUT = arg('json', null);

function load() {
  for (const f of [DISK, REPO]) {
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j && j.matches) return { file: f, rows: Object.values(j.matches) }; } catch { /* siguiente */ }
  }
  console.error('No encuentro la base. Corre antes: node scripts/dota-harvest.js');
  process.exit(1);
}

// ---- métricas ------------------------------------------------------------------------------------------
function auc(pairs) {
  // pairs = [{p, y}] — AUC por rangos (maneja empates de probabilidad, que los hay y muchos)
  const pos = pairs.filter((x) => x.y === 1).length, neg = pairs.length - pos;
  if (!pos || !neg) return null;
  const sorted = pairs.slice().sort((a, b) => a.p - b.p);
  let i = 0, rankSum = 0;
  while (i < sorted.length) {
    let j = i; while (j + 1 < sorted.length && sorted[j + 1].p === sorted[i].p) j++;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) if (sorted[k].y === 1) rankSum += avgRank;
    i = j + 1;
  }
  return +((rankSum - pos * (pos + 1) / 2) / (pos * neg)).toFixed(4);
}
function ece(pairs, bins = 10) {
  let tot = 0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const inb = pairs.filter((x) => x.p >= lo && (b === bins - 1 ? x.p <= hi : x.p < hi));
    if (!inb.length) continue;
    const pm = inb.reduce((a, x) => a + x.p, 0) / inb.length;
    const ym = inb.reduce((a, x) => a + x.y, 0) / inb.length;
    tot += (inb.length / pairs.length) * Math.abs(pm - ym);
  }
  return +tot.toFixed(4);
}
function report(name, pairs) {
  if (!pairs.length) return { name, n: 0 };
  const brier = pairs.reduce((a, x) => a + (x.p - x.y) ** 2, 0) / pairs.length;
  const ll = pairs.reduce((a, x) => a - (x.y ? Math.log(Math.max(1e-9, x.p)) : Math.log(Math.max(1e-9, 1 - x.p))), 0) / pairs.length;
  const hit = pairs.filter((x) => (x.p >= 0.5 ? 1 : 0) === x.y).length / pairs.length;
  return { name, n: pairs.length, brier: +brier.toFixed(5), skill_pct: +(100 * (1 - brier / 0.25)).toFixed(2),
    auc: auc(pairs), ece: ece(pairs), logloss: +ll.toFixed(5), hit_pct: +(100 * hit).toFixed(2) };
}

// ---- validación ----------------------------------------------------------------------------------------
function main() {
  const { file, rows } = load();
  const all = rows.filter((m) => m.r_id && m.d_id && m.at && typeof m.r_win === 'boolean')
    .sort((a, b) => a.at - b.at);
  console.log(`[val] base ${file}`);
  console.log(`[val] ${all.length} partidas con los dos equipos identificados, de ${rows.length} bajadas`);

  // la ventaja de lado se estima ONLINE (con lo visto hasta ahora), nunca con el total: usarlo sería
  // meter el futuro por la puerta de atrás en el predictor más tonto de los cuatro.
  let seenN = 0, seenR = 0;
  const elo = new Map();          // team_id → rating
  const games = new Map();        // team_id → partidas vistas
  const get = (id) => (elo.has(id) ? elo.get(id) : 1500);
  const P = { moneda: [], lado: [], elo: [], elo_lado: [] };
  const Q = { moneda: [], lado: [], elo: [], elo_lado: [] };
  // ventaja de Radiant en puntos de Elo, ajustada online por descenso simple sobre el error
  let sideElo = 0;

  for (const m of all) {
    const y = m.r_win ? 1 : 0;
    const ra = get(m.r_id), rb = get(m.d_id);
    const nA = games.get(m.r_id) || 0, nB = games.get(m.d_id) || 0;
    const pSide = seenN >= 50 ? seenR / seenN : 0.5;
    const pElo = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const pEloSide = 1 / (1 + Math.pow(10, (rb - ra - sideElo) / 400));
    const push = (bag) => {
      bag.moneda.push({ p: 0.5, y });
      bag.lado.push({ p: pSide, y });
      bag.elo.push({ p: pElo, y });
      bag.elo_lado.push({ p: pEloSide, y });
    };
    push(P);
    if (nA >= MIN_N && nB >= MIN_N) push(Q);

    // actualización (después de predecir, siempre)
    const upd = K * (y - pEloSide);
    elo.set(m.r_id, ra + upd);
    elo.set(m.d_id, rb - upd);
    games.set(m.r_id, nA + 1); games.set(m.d_id, nB + 1);
    sideElo += 2 * (y - pEloSide);         // paso chico: la ventaja de lado se mueve despacio
    seenN++; seenR += y;
  }

  const out = {
    at: new Date().toISOString(), file, k: K, min_n: MIN_N,
    matches: all.length, teams: elo.size,
    side_advantage_elo: +sideElo.toFixed(1),
    radiant_wr_pct: +(100 * seenR / seenN).toFixed(2),
    todas: Object.keys(P).map((k) => report(k, P[k])),
    cualificadas: Object.keys(Q).map((k) => report(k, Q[k])),
  };

  const tbl = (rowsx) => {
    console.log('  predictor    n        Brier     skill%    AUC      ECE      acierto%');
    for (const r of rowsx) {
      if (!r.n) { console.log(`  ${r.name.padEnd(12)} —`); continue; }
      console.log(`  ${r.name.padEnd(12)} ${String(r.n).padEnd(8)} ${String(r.brier).padEnd(9)} ${String(r.skill_pct).padEnd(9)} ${String(r.auc).padEnd(8)} ${String(r.ece).padEnd(8)} ${r.hit_pct}`);
    }
  };
  console.log(`\n[val] equipos con rating: ${elo.size} · ventaja de Radiant medida: ${out.side_advantage_elo} pts de Elo (tasa ${out.radiant_wr_pct}%)`);
  console.log(`\nTODAS las partidas (incluye equipos sin historial):`); tbl(out.todas);
  console.log(`\nCUALIFICADAS (ambos equipos con ≥ ${MIN_N} partidas previas):`); tbl(out.cualificadas);

  const q = Object.fromEntries(out.cualificadas.map((r) => [r.name, r]));
  const gain = (q.elo_lado && q.lado) ? (q.elo_lado.skill_pct - q.lado.skill_pct) : null;
  console.log(`\n[veredicto] el rating aporta ${gain == null ? '—' : gain.toFixed(2) + ' puntos de skill'} sobre saber solo de qué lado se juega.`);
  console.log('[veredicto] recordatorio de la casa: skill de Brier NO es rentabilidad. Sin histórico de cuotas de Dota 2 esto dice que el modelo predice, no que gane dinero.');

  if (OUT) { fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(`[val] JSON → ${OUT}`); }

  // priors para el catálogo (18-ago, blueprint 5.0): las constantes validadas y el resumen quedan JUNTO a
  // la base, igual que en LoL y Valorant — dota2-data.js las lee para derivar el Elo en el load.
  const priors = {
    at: out.at, model_version: 'dota-elo-side-1',
    source: 'base propia (OpenDota, research_only — RIGHTS.md)',
    constants: { K, min_n: MIN_N, side_step: 2 },
    side_advantage_elo: out.side_advantage_elo, radiant_wr_pct: out.radiant_wr_pct,
    matches: out.matches, teams: out.teams,
    validation: { cualificadas: out.cualificadas,
      note: 'walk-forward estricto; skill de Brier NO es rentabilidad — la probabilidad publicada sigue anclada a mercado y el peso propio (modesto: ~1,9 % de skill medido el 17-ago) sube solo con la muestra.' },
  };
  fs.writeFileSync(path.join(path.dirname(file), 'priors.json'), JSON.stringify(priors, null, 1));
  console.log('[val] priors.json escrito junto a la base');
}

main();
