#!/usr/bin/env node
/**
 * BALONCESTO — VALIDACIÓN CON ABLACIONES (16-ago).
 *
 * LA PREGUNTA QUE IMPORTA: ¿cada capa nueva MEJORA de verdad, o solo añade complejidad? La única forma de
 * responderla es medir fuera de muestra y por partes. Este script corre una ventana expandida y, dentro de
 * cada bloque de test, evalúa cuatro configuraciones acumulativas:
 *
 *   1. BASE            — rating de equipo (ritmo × eficiencia ajustada por rival)
 *   2. + CONTEXTO      — descanso, back-to-back, 3-en-4, viaje y altitud, con signo y evidencia
 *   3. + PLANTILLA     — RAPM sobre tramos × minutos proyectados, con las ausencias de esa noche
 *   4. + MERCADO       — mezcla en log-odds con el cierre, con el peso ajustado fuera de muestra
 *
 * DISPONIBILIDAD RETROSPECTIVA: para los partidos históricos no hay parte de lesiones, así que se reconstruye
 * lo que ese parte habría dicho: un jugador de la rotación (≥8 minutos esperados) que registró 0 minutos
 * estaba fuera. Es lo mismo que el informe previo publica, salvo bajas de última hora.
 *
 * Uso: node scripts/hoops-validate.js --league=nba [--folds=3] [--sims=4000]
 */
'use strict';
const ST = require('../basketball-engine/store');
const R = require('../basketball-engine/ratings');
const S = require('../basketball-engine/simulate');
const PLY = require('../basketball-engine/players');
const MN = require('../basketball-engine/minutes');
const CX = require('../basketball-engine/context');
const MD = require('../basketball-engine/model');
const LU = require('../basketball-engine/lineups');
const ESPN = require('../data-providers/basketball/espn');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const LEAGUE = String(args.league || 'nba');
const FOLDS = +args.folds || 3;
const SIMS = +args.sims || 4000;
const L = ESPN.LEAGUES[LEAGUE] || {};

const imp = (x) => (x < 0 ? -x / (-x + 100) : 100 / (x + 100));
const brier = (rows, key) => { const r = rows.filter((x) => x[key] != null); return r.length ? r.reduce((s, x) => s + (x[key] - x.won) ** 2, 0) / r.length : null; };

(async () => {
  const C = ST.load(LEAGUE, { force: true });
  if (!C || !C.fit) { console.error('sin dataset para', LEAGUE); process.exit(1); }
  const all = C.games.filter((g) => g.home.pts != null && g.away.pts != null)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const validTeams = Object.keys(C.teams || {});
  console.log(`[${LEAGUE}] ${all.length} partidos · ${FOLDS} bloques · ${SIMS} simulaciones por partido`);
  console.log(`cobertura de tramos: ${(100 * (C.stint_coverage || 0)).toFixed(1)}%`);

  const rows = [];
  const first = Math.floor(all.length * 0.4);
  for (let f = 0; f < FOLDS; f++) {
    const cut = first + Math.floor(((all.length - first) * f) / FOLDS);
    const nextCut = first + Math.floor(((all.length - first) * (f + 1)) / FOLDS);
    const train = all.slice(0, cut), test = all.slice(cut, nextCut);
    if (train.length < 60 || !test.length) continue;

    // — todo se REAJUSTA solo con el pasado del bloque: ratings, RAPM, contexto y peso de mezcla —
    const fit = R.fitRatings(train, { validTeams: validTeams.length ? validTeams : null });
    if (!fit) continue;
    const trainStints = train.filter((g) => g.stints && g.stints.length).map((g) => ({ ...g, stints: LU.unpackStints(g.stints) }));
    const rapm = trainStints.length >= 40 ? PLY.fitRAPM(trainStints, { halfLifeDays: 240, dropGarbage: true }) : null;
    const sched = CX.scheduleState(all);
    const expM = (g) => {
      if (!fit.off[g.home.id] || !fit.off[g.away.id]) return null;
      const poss = fit.lgPace + (fit.pace[g.home.id] || 0) + (fit.pace[g.away.id] || 0);
      return (((fit.off[g.home.id] - fit.def[g.away.id]) - (fit.off[g.away.id] - fit.def[g.home.id])) + fit.hca) * poss / 100;
    };
    const ctx = CX.fitContext(train, sched, expM);
    // PESO DE MEZCLA CON VALIDACIÓN ANIDADA. Ajustarlo sobre los mismos partidos con los que se ajustó el
    // rating da w = 1 ("usa solo el modelo") por construcción: el rating ya vio esos resultados y ahí parece
    // mejor que el mercado. Se parte el entrenamiento en dos, se ajusta el rating con la primera mitad y el
    // peso se estima sobre la segunda, que el rating no vio. Es la misma trampa in-sample de antes, un nivel
    // más adentro — y es donde mueren la mayoría de los modelos que "baten al mercado".
    const inner = Math.floor(train.length * 0.7);
    const fitInner = R.fitRatings(train.slice(0, inner), { validTeams: validTeams.length ? validTeams : null });
    const bRows = [];
    if (fitInner) {
      for (const g of train.slice(inner)) {
        const o = (g.odds || [])[0]; if (!o || o.hml == null || o.aml == null) continue;
        if (!fitInner.off[g.home.id] || !fitInner.off[g.away.id]) continue;
        const sim = S.simulate(fitInner, g.home.id, g.away.id, { n: 1500, seed: 7, neutral: !!g.neutral });
        if (!sim) continue;
        const ih = imp(o.hml), ia = imp(o.aml);
        bRows.push({ p_model: sim.win.home, p_market: ih / (ih + ia), won: g.home.pts > g.away.pts ? 1 : 0 });
      }
    }
    const blendFit = MD.fitBlend(bRows);

    const Ctrain = { games: train, fit, rapm, teams: C.teams };
    for (const g of test) {
      if (!fit.off[g.home.id] || !fit.off[g.away.id]) continue;
      const won = g.home.pts > g.away.pts ? 1 : 0;
      const o = (g.odds || [])[0];
      const pMkt = o && o.hml != null && o.aml != null ? (() => { const ih = imp(o.hml), ia = imp(o.aml); return ih / (ih + ia); })() : null;

      // 1) BASE
      const s1 = S.simulate(fit, g.home.id, g.away.id, { n: SIMS, seed: 21, neutral: !!g.neutral, regMin: L.minutes, otMin: L.otMin });
      if (!s1) continue;

      // 2) + CONTEXTO
      const sh = sched.get(String(g.id) + '|' + String(g.home.id)), sa = sched.get(String(g.id) + '|' + String(g.away.id));
      const cadj = (sh && sa) ? CX.contextAdjust(ctx, sh, sa) : { pts: 0 };
      const per100 = (cadj.pts * 100) / Math.max(fit.lgPace, 1);
      const s2 = S.simulate(fit, g.home.id, g.away.id, { n: SIMS, seed: 21, neutral: !!g.neutral, regMin: L.minutes, otMin: L.otMin,
        adj: { home: per100 / 2, away: -per100 / 2 } });

      // 3) + PLANTILLA (disponibilidad reconstruida de ese partido)
      let adjH = per100 / 2, adjA = -per100 / 2;
      if (rapm) {
        for (const side of ['home', 'away']) {
          const tid = String(g[side].id);
          const prof = MN.rotationProfile(train, tid, { lastN: 15 });
          if (!prof) continue;
          const played = new Set((g.players || []).filter((p) => String(p.t) === tid && p.min > 0).map((p) => String(p.id)));
          const out = prof.rows.filter((r) => r.exp >= 8 && !played.has(String(r.id))).map((r) => String(r.id));
          const base = MN.projectMinutes(prof, { L });
          const tonight = MN.projectMinutes(prof, { out, L });
          if (!base || !tonight) continue;
          const a = PLY.teamFromMinutes(rapm, base.map), b = PLY.teamFromMinutes(rapm, tonight.map);
          if (!a || !b) continue;
          const d = (b.off - b.def) - (a.off - a.def);
          if (side === 'home') adjH += d; else adjA += d;
        }
      }
      const s3 = S.simulate(fit, g.home.id, g.away.id, { n: SIMS, seed: 21, neutral: !!g.neutral, regMin: L.minutes, otMin: L.otMin,
        adj: { home: adjH, away: adjA } });

      // 4) + MERCADO
      const p4 = pMkt != null && blendFit.ok ? MD.blend(s3.win.home, pMkt, blendFit.w) : null;

      rows.push({ won, market: pMkt, base: s1.win.home, ctx: s2 ? s2.win.home : null, roster: s3 ? s3.win.home : null, blended: p4,
        margin: g.home.pts - g.away.pts, m_base: s1.margin, m_roster: s3 ? s3.margin : null, fold: f + 1, w: blendFit.w });
    }
    console.log(`  bloque ${f + 1}: entrena ${train.length} · evalúa ${test.length} · RAPM ${rapm ? rapm.n_players + ' jugadores λ=' + rapm.lambda : 'n/d'} · peso de mezcla w=${blendFit.ok ? blendFit.w : 'n/d'}`);
  }

  const withMkt = rows.filter((r) => r.market != null);
  const fmt = (x) => (x == null ? '—' : x.toFixed(5));
  const bM = brier(withMkt, 'market');
  console.log('\n═══ RESULTADO FUERA DE MUESTRA ═══');
  console.log(`partidos evaluados: ${rows.length} · con cierre de mercado: ${withMkt.length}`);
  console.log(`Brier del CIERRE:            ${fmt(bM)}`);
  const mae = (k) => { const r = rows.filter((x) => x[k] != null); return r.length ? (r.reduce((s, x) => s + Math.abs(x.margin - x[k]), 0) / r.length).toFixed(2) : '—'; };
  // COMPARACIÓN A PARES. El skill de cada configuración se mide contra el mercado EN LOS MISMOS PARTIDOS.
  // La mezcla no existe en el primer bloque (no hay historial para estimar el peso), así que compararla
  // contra un Brier de mercado calculado sobre todos los partidos la haría parecer mejor de lo que es.
  for (const [key, label] of [['base', '1. BASE (rating de equipo)'], ['ctx', '2. + contexto de calendario'], ['roster', '3. + plantilla (RAPM×minutos)'], ['blended', '4. + mezcla con el mercado']]) {
    const sub = withMkt.filter((x) => x[key] != null);
    const b = brier(sub, key), bmSub = brier(sub, 'market');
    const skill = b != null && bmSub != null ? bmSub - b : null;
    const acc = sub.length ? (100 * sub.filter((x) => (x[key] >= 0.5) === !!x.won).length / sub.length).toFixed(1) : '—';
    console.log(`${label.padEnd(32)} n=${String(sub.length).padStart(4)} · Brier ${fmt(b)} (mercado ${fmt(bmSub)}) · skill ${skill == null ? '—' : (skill >= 0 ? '+' : '') + skill.toFixed(5)} · acierto ${acc}%`);
  }
  console.log(`MAE de margen: base ${mae('m_base')} → con plantilla ${mae('m_roster')}`);

  // ── PERSISTIR EL VEREDICTO ─────────────────────────────────────────────────────────────────────────
  // El modelo lee este archivo y ENCIENDE solo las capas que se ganaron su sitio. Una capa que no mejora
  // no se corre "por si acaso": añade varianza y complejidad sin pagar nada. Es la disciplina que separa
  // una pila de módulos de un modelo.
  const layers = {};
  const skillOf = (key) => { const sub = withMkt.filter((x) => x[key] != null); const b = brier(sub, key), m = brier(sub, 'market'); return b != null && m != null ? +(m - b).toFixed(5) : null; };
  const sBase = skillOf('base'), sCtx = skillOf('ctx'), sRos = skillOf('roster');
  layers.context = { delta: sCtx != null && sBase != null ? +(sCtx - sBase).toFixed(5) : null, on: sCtx != null && sBase != null && sCtx > sBase };
  layers.roster = { delta: sRos != null && sCtx != null ? +(sRos - sCtx).toFixed(5) : null, on: sRos != null && sCtx != null && sRos > sCtx };
  const wAvg = rows.filter((r) => r.w != null).map((r) => r.w);
  layers.blend = { w: wAvg.length ? +(wAvg.reduce((a, b) => a + b, 0) / wAvg.length).toFixed(3) : null, on: !!(wAvg.length && wAvg.some((w) => w < 1)) };
  const outObj = {
    league: LEAGUE, at: new Date().toISOString(), n: rows.length, n_market: withMkt.length, folds: FOLDS, sims: SIMS,
    brier_market: bM != null ? +bM.toFixed(5) : null,
    skill: { base: sBase, context: sCtx, roster: sRos, blended: skillOf('blended') },
    layers,
    note: 'Generado por scripts/hoops-validate.js. El motor lee `layers` y solo aplica las capas con on=true.',
  };
  try {
    const fs = require('fs'), path = require('path');
    const dir = path.join(__dirname, '..', 'data', 'basketball');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `validation-${LEAGUE}.json`), JSON.stringify(outObj, null, 2));
    console.log(`\nveredicto guardado en data/basketball/validation-${LEAGUE}.json`);
    console.log('capas encendidas:', Object.entries(layers).filter(([, v]) => v.on).map(([k]) => k).join(', ') || '(ninguna, solo la base)');
  } catch (e) { console.error('no se pudo guardar el veredicto:', e.message); }
  // error estándar del skill de la mejor configuración
  const best = withMkt.filter((r) => r.blended != null);
  if (best.length > 10) {
    const d = best.map((r) => ((r.market - r.won) ** 2) - ((r.blended - r.won) ** 2));
    const mu = d.reduce((s, x) => s + x, 0) / d.length;
    const va = d.reduce((s, x) => s + (x - mu) ** 2, 0) / (d.length - 1);
    const se = Math.sqrt(va / d.length);
    console.log(`\nSKILL FINAL vs cierre: ${(mu >= 0 ? '+' : '') + mu.toFixed(5)} ± ${se.toFixed(5)} (t = ${(mu / se).toFixed(2)}, n = ${best.length})`);
    console.log(mu > 0 && Math.abs(mu / se) >= 2 ? '→ BATE AL CIERRE de forma estadísticamente distinguible.'
      : mu > 0 ? '→ por delante del cierre, pero dentro del ruido.'
        : '→ todavía por detrás del cierre.');
  }
})();
