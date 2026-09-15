#!/usr/bin/env node
// scripts/replay-vara.js — T1.13 DE LA AUDITORÍA EXTERNA: EL REPLAY DE LOS MOTORES QUE NO PASABAN POR LA VARA.
//
// POR QUÉ FALTABA ESTO. `docs/METRICAS_RECALCULADAS_2026-09.md` recalculó con la vara nueva todas las
// familias cuyo archivo de cierres guarda las dos caras del mercado. Los demás motores se quedaron fuera, y
// no por pereza: sencillamente **no tenían forma de sacar su libro ticket a ticket**. `track()` devuelve
// agregados —n, ROI, CLV medio— y el EV contra el cierre no se puede calcular con agregados: es un cálculo
// ticket a ticket contra la cara contraria del MISMO contrato en la MISMA casa.
//
// Ocho de los trece motores estaban así. La ruta `?motor=` (15-sep) los abre, y este script los recorre.
//
// LO QUE ESTE SCRIPT VA A DECIR, Y CONVIENE SABERLO DE ANTEMANO: en casi todos va a salir
// `sin_cierre_valorable`. Eso NO es un fallo del script ni de la vara — es el hallazgo. Los motores guardan
// el cierre de SU lado (`close_odds`, `close_price`, `close`) y no el de la cara contraria, así que no se
// puede quitar el margen y no se puede saber si hay dinero. Un veredicto de "no se puede saber" con el
// motivo escrito vale más que un ROI con tres decimales que nadie sabe interpretar.
//
// Uso: node scripts/replay-vara.js --dir <carpeta con los json de ?motor=> [--md]
'use strict';

const fs = require('fs');
const path = require('path');
const V = require('../lib/vara');
const INF = require('../lib/inferencia');

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIR = arg('--dir', null);
const MD = argv.includes('--md');
if (!DIR) { console.error('Falta --dir <carpeta con los volcados de ?motor=>'); process.exit(1); }

// ── LOS ACCESORES, MOTOR POR MOTOR ───────────────────────────────────────────────────────────────────────
// Cada motor nombra sus campos a su manera y eso es historia, no diseño. Se traduce aquí, en un solo sitio,
// en vez de pedirle a la vara que adivine. `cierreContraria` es `null` en todos: ninguno lo guarda, y ese
// hueco es precisamente lo que el replay tiene que hacer visible.
const A = {
  odds: (p) => Number(p.odds || p.best_odds) || null,
  cierre: (p) => Number(p.close_odds || p.close_price || p.close || (p.close_series && p.close_series.last)) || null,
  cierreContraria: (p) => Number(p.close_odds_contraria || p.close_odds_opuesta) || null,
  clv: (p) => (Number.isFinite(p.clv_pct) ? p.clv_pct : (Number.isFinite(p.clv) ? p.clv : null)),
  gano: (p) => { const r = String(p.result_code || p.result || '').toUpperCase();
    return r === 'WIN' ? 1 : r === 'LOSS' ? 0 : null; },
  pModelo: (p) => (Number.isFinite(p.model_prob) ? p.model_prob : (Number.isFinite(p.p_gp) ? p.p_gp : null)),
  fecha: (p) => p.settled_at || p.created_at || p.born_at || null,
  evento: (p) => p.event_id || p.ceid || (p.event && (p.event.canonical_event_id || p.event.id)) || p.match || p.key,
  familia: (p) => p.family || p.familia || '?',
  liquidada: (p) => {
    const r = String(p.result_code || p.result || '').toUpperCase();
    return p.status === 'SETTLED' || r === 'WIN' || r === 'LOSS';
  },
};

function carga() {
  const out = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json'))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { continue; }
    out.push({ motor: (j.motor || f.replace(/\.json$/, '')), picks: j.picks || [] });
  }
  return out.sort((a, b) => b.picks.length - a.picks.length);
}

function juzga(picks) {
  const liq = picks.filter(A.liquidada);
  if (!liq.length) return null;
  const opts = { fecha: A.fecha, clv: A.clv, odds: A.odds, cierre: A.cierre, cierreContraria: A.cierreContraria,
    gano: A.gano, pModelo: A.pModelo, evento: A.evento };
  try { return { n_liq: liq.length, ...V.familia(liq, opts) }; } catch (e) { return { n_liq: liq.length, error: e.message }; }
}

function main() {
  const motores = carga();
  const filas = [];
  console.log('═══ REPLAY CON LA VARA NUEVA — LOS MOTORES QUE NO PASABAN POR ELLA ═══\n');

  for (const m of motores) {
    const liq = m.picks.filter(A.liquidada);
    const conCierre = liq.filter((p) => A.cierre(p) != null).length;
    const conContraria = liq.filter((p) => A.cierreContraria(p) != null).length;
    const v = juzga(m.picks);
    const fila = { motor: m.motor, total: m.picks.length, liquidadas: liq.length,
      con_cierre: conCierre, con_cara_contraria: conContraria,
      veredicto: v ? (v.veredicto || 'error') : 'sin_liquidadas',
      ev_pct: v && v.ev ? v.ev.ev_medio_pct : null,
      ev_n: v && v.ev ? v.ev.n : null,
      clv_recortado: v ? v.clv_recortado_pct : null,
      razon: v ? (v.razon || v.error || '') : 'ninguna pick liquidada todavía' };
    filas.push(fila);

    console.log(`── ${m.motor} ──`);
    console.log(`   picks ${fila.total} · liquidadas ${fila.liquidadas} · con cierre propio ${conCierre} (${liq.length ? (100 * conCierre / liq.length).toFixed(1) : 0} %) · con la CARA CONTRARIA ${conContraria}`);
    console.log(`   veredicto: ${fila.veredicto.toUpperCase()}`);
    if (fila.clv_recortado != null) console.log(`   movimiento de línea (CLV recortado, diagnóstico): ${fila.clv_recortado} %`);
    if (fila.ev_pct != null) console.log(`   EV al cierre: ${fila.ev_pct} % sobre ${fila.ev_n} tickets`);
    console.log(`   ${fila.razon.slice(0, 260)}`);
    // y el ROI con su intervalo por racimos de evento, que es lo único que sí se puede calcular siempre
    const conRes = liq.filter((p) => A.gano(p) != null && A.odds(p) > 1);
    if (conRes.length >= 20) {
      const ic = INF.roiIC(conRes, { beneficio: (p) => (A.gano(p) ? A.odds(p) - 1 : -1), stake: () => 1,
        cluster: A.evento, replicas: 2000, semilla: 20260915 });
      fila.roi_pct = ic.roi_pct; fila.roi_ic = ic.ic_pct; fila.n_eventos = ic.n_clusters;
      console.log(`   ROI a stake plano: ${ic.roi_pct} % IC [${ic.ic_pct[0]}, ${ic.ic_pct[1]}] sobre ${ic.n_clusters} eventos`);
    }
    console.log('');
  }

  // ── EL RESUMEN QUE IMPORTA ─────────────────────────────────────────────────────────────────────────────
  const porVeredicto = filas.reduce((a, f) => { a[f.veredicto] = (a[f.veredicto] || 0) + 1; return a; }, {});
  const sinContraria = filas.filter((f) => f.liquidadas > 0 && f.con_cara_contraria === 0);
  console.log('═══ RESUMEN ═══');
  console.log(`motores recorridos: ${filas.length} · picks: ${filas.reduce((a, f) => a + f.total, 0)} · liquidadas: ${filas.reduce((a, f) => a + f.liquidadas, 0)}`);
  console.log('veredictos:', JSON.stringify(porVeredicto));
  console.log(`\nMOTORES SIN LA CARA CONTRARIA DEL CIERRE: ${sinContraria.length} de ${filas.filter((f) => f.liquidadas > 0).length}`);
  console.log('  Guardan el cierre de SU lado y no el del contrario, así que no se puede quitar el margen');
  console.log('  y no se puede calcular el retorno esperado. No es un fallo de este replay: es el estado real');
  console.log('  del archivo, y es la MISMA causa que deja a tarjetas sin veredicto. Una sola tarea, no ocho.');
  console.log(`  Afectados: ${sinContraria.map((f) => f.motor).join(', ')}`);

  if (MD) {
    console.log('\n\n| motor | picks | liquidadas | con cierre | con cara contraria | veredicto | CLV recortado | ROI (IC por evento) |');
    console.log('|---|---:|---:|---:|---:|---|---:|---|');
    for (const f of filas) {
      console.log(`| \`${f.motor}\` | ${f.total} | ${f.liquidadas} | ${f.con_cierre} | ${f.con_cara_contraria} | \`${f.veredicto}\` | ` +
        `${f.clv_recortado == null ? '—' : f.clv_recortado + ' %'} | ${f.roi_pct == null ? '—' : `${f.roi_pct} % [${f.roi_ic[0]}, ${f.roi_ic[1]}]`} |`);
    }
  }
}

if (require.main === module) main();
module.exports = { A, juzga };
