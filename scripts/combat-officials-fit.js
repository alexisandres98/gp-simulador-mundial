// scripts/combat-officials-fit.js — ¿EL ÁRBITRO Y EL PESO MUEVEN LA DURACIÓN DE UNA PELEA? (20-ago)
//
// POR QUÉ. El simulador de rutas (`fightsim.js`) es lo único de combate con CLV positivo: +1,75 % en
// ROUNDS sobre 27 liquidadas, en Cloudbet, que además es ejecutable por API. El ganador pierde −6,35 %.
// Si hay algo que mejorar en combate, es la duración, no el ganador.
//
// Y hay dos variables que mueven la duración y que el mercado de rondas apenas incorpora: QUIÉN ARBITRA
// (un árbitro que para pronto acorta peleas; uno que deja seguir las alarga) y SI ALGUIEN NO DIO EL PESO
// (cortar mal el peso destruye el gas del tercer asalto). Las dos ya estaban cosechadas y sin usar:
// `officials-ufc.json` trae árbitro en 9.122 de 9.139 peleas y `weighins-ufc.json` marca 151 eventos con
// fallo de peso.
//
// LA TRAMPA QUE ESTE AJUSTE EVITA. Comparar la tasa de finalización de un árbitro contra la media global
// mide sobre todo A QUÉ PELEAS LO MANDAN: los pesados terminan antes que los moscas, las preliminares
// antes que las estelares, y el UFC de 1997 antes que el de 2025. Herb Dean tiene 1.328 peleas repartidas
// de una forma y Marc Goddard de otra. Así que el efecto se mide SIEMPRE contra lo ESPERADO de esa pelea
// —su división, sus asaltos programados y su época—, nunca contra la media de todas.
//
// Y NO SE PUBLICA SI NO SOBREVIVE FUERA DE MUESTRA. El ajuste se valida walk-forward: se fitea con lo
// anterior a cada año y se mide en el año siguiente. Si no mejora el Brier de "¿termina antes del límite?"
// contra el modelo sin árbitro, el archivo sale con `measured:false` y el simulador lo ignora.
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'combat');
const rd = (f) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { return null; } };
const wr = (f, o) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(o, null, 1));

const FINISH = new Set(['kotko', 'submission', 'tko---doctors-stoppage', 'tko']);
const NO_VALE = new Set(['no-contest', 'dq', 'draw', 'overturned']);
const K_ARB = 120;      // encogimiento del árbitro: con 120 peleas pesa la mitad de lo observado
const K_PESO = 40;
const MIN_ARB = 60;     // por debajo, el árbitro no publica efecto propio

const seg = (f) => {
  const m = String(f.end_clock || '0:00').match(/(\d+):(\d+)/);
  const s = m ? +m[1] * 60 + +m[2] : 0;
  return (Math.max(1, f.end_round || 1) - 1) * 300 + s;
};
const lustro = (d) => Math.floor(+String(d).slice(0, 4) / 5) * 5;
const estrato = (f) => `${f.weight || '?'}|${f.rounds_sched || 3}|${lustro(f.date)}`;

function cargar(liga) {
  const F = rd(`fights-${liga}.json`);
  const O = rd(`officials-${liga}.json`);
  const W = rd(`weighins-${liga}.json`);
  if (!F || !O) return null;
  const fights = Array.isArray(F.fights) ? F.fights : Object.values(F.fights || {});
  const of = O.officials || {};
  // fallo de peso: evento → conjunto de nombres normalizados que no dieron el peso
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/promotional newcomer/g, '').replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
  const fallo = new Map();
  for (const [ev, v] of Object.entries((W && W.events) || {})) {
    const s = new Set();
    for (const r of (v.rows || [])) if (r && r.name && Number(r.over) > 0) s.add(norm(r.name));
    if (s.size) fallo.set(norm(ev), s);
  }
  // RASGOS PUNTO-EN-EL-TIEMPO. Se recorre en orden de fecha y cada pelea se describe SOLO con lo que se
  // sabía antes de ella. Calcular el historial de finalizaciones de un peleador con su carrera entera y
  // luego "predecir" una pelea del medio es hacerse trampas al solitario: el resultado sale precioso dentro
  // de muestra y no vale nada fuera.
  const P = rd(`fighters-${liga}.json`) || {};
  const perfil = P.fighters || P;
  const edadEn = (id, fecha) => {
    const d = perfil[id] && perfil[id].dob; if (!d) return null;
    const a = (Date.parse(fecha) - Date.parse(d)) / (365.25 * 864e5);
    return a > 15 && a < 55 ? a : null;
  };
  const hist = new Map();   // id → { n, finFav, finContra, ultima }
  const estado = (id) => hist.get(id) || { n: 0, finFav: 0, finContra: 0, ultima: null };
  const orden = fights.slice().filter((f) => f.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const rows = [];
  for (const f of orden) {
    const usable = f.completed && f.method && f.end_round && f.end_clock && !NO_VALE.has(f.method.name);
    const h1 = estado(f.f1 && f.f1.id), h2 = estado(f.f2 && f.f2.id);
    if (usable) {
      const ref = (of[f.comp_id] || {}).ref || null;
      const ev = fallo.get(norm(f.event));
      const pesoMal = ev ? ((f.f1 && ev.has(norm(f.f1.name))) || (f.f2 && ev.has(norm(f.f2.name)))) : null;
      // tendencia de finalización del CRUCE: lo que cada uno provoca y lo que cada uno concede
      const tasa = (h, campo) => (h.n >= 3 ? h[campo] / h.n : null);
      const t1 = tasa(h1, 'finFav'), t2 = tasa(h2, 'finFav');
      const c1 = tasa(h1, 'finContra'), c2 = tasa(h2, 'finContra');
      const partes = [t1, t2, c1, c2].filter((x) => x != null);
      const tendencia = partes.length >= 2 ? partes.reduce((a, b) => a + b, 0) / partes.length : null;
      const paro = (u) => (u ? Math.round((Date.parse(f.date) - Date.parse(u)) / 864e5) : null);
      const p1 = paro(h1.ultima), p2 = paro(h2.ultima);
      const e1 = edadEn(f.f1 && f.f1.id, f.date), e2 = edadEn(f.f2 && f.f2.id, f.date);
      rows.push({
        fecha: String(f.date).slice(0, 10), estrato: estrato(f), ref,
        peso_mal: ev ? !!pesoMal : null,          // null = evento sin datos de báscula (no es "dio el peso")
        finish: FINISH.has(f.method.name) ? 1 : 0,
        dur: seg(f), limite: (f.rounds_sched || 3) * 300,
        tendencia, paro_max: (p1 != null && p2 != null) ? Math.max(p1, p2) : (p1 ?? p2),
        edad_media: (e1 != null && e2 != null) ? (e1 + e2) / 2 : (e1 ?? e2),
        exp_min: Math.min(h1.n, h2.n),
      });
    }
    // actualizar el historial DESPUÉS de haber descrito la pelea
    if (f.completed && f.method && !NO_VALE.has(f.method.name)) {
      const fin = FINISH.has(f.method.name) ? 1 : 0;
      for (const [lado, otro] of [[f.f1, f.f2], [f.f2, f.f1]]) {
        if (!lado || !lado.id) continue;
        const h = hist.get(lado.id) || { n: 0, finFav: 0, finContra: 0, ultima: null };
        h.n++;
        if (fin) { if (lado.winner) h.finFav++; else h.finContra++; }
        h.ultima = f.date;
        hist.set(lado.id, h);
      }
    }
  }
  return rows;
}

// tasa esperada por estrato, encogida a la global (los estratos finos tienen pocas peleas)
function baseline(rows) {
  const g = {}; let n = 0, fin = 0, dur = 0;
  for (const r of rows) {
    const e = g[r.estrato] = g[r.estrato] || { n: 0, fin: 0, dur: 0 };
    e.n++; e.fin += r.finish; e.dur += r.dur;
    n++; fin += r.finish; dur += r.dur;
  }
  const gFin = fin / n, gDur = dur / n, K = 40;
  const tabla = {};
  for (const [k, e] of Object.entries(g)) {
    tabla[k] = { n: e.n, p_fin: (e.fin + K * gFin) / (e.n + K), dur: (e.dur + K * gDur) / (e.n + K) };
  }
  return { tabla, gFin, gDur, n };
}
const espera = (B, est) => B.tabla[est] || { p_fin: B.gFin, dur: B.gDur };

// efecto de un grupo (árbitro, o "falló el peso") contra lo ESPERADO de sus propias peleas
function efectos(rows, clave, { K, minN }) {
  const B = baseline(rows);
  const g = {};
  for (const r of rows) {
    const k = clave(r); if (k == null) continue;
    const e = g[k] = g[k] || { n: 0, obs: 0, esp: 0, var: 0, dObs: 0, dEsp: 0 };
    const x = espera(B, r.estrato);
    e.n++; e.obs += r.finish; e.esp += x.p_fin; e.var += x.p_fin * (1 - x.p_fin);
    e.dObs += r.dur; e.dEsp += x.dur;
  }
  const out = {};
  for (const [k, e] of Object.entries(g)) {
    if (e.n < minN) continue;
    const w = e.n / (e.n + K);                       // encogimiento por muestra
    const rFin = e.esp > 0 ? e.obs / e.esp : 1;      // razón observada/esperada de finalización
    const rDur = e.dEsp > 0 ? e.dObs / e.dEsp : 1;
    out[k] = {
      n: e.n,
      finish_obs: +(e.obs / e.n).toFixed(4), finish_esp: +(e.esp / e.n).toFixed(4),
      factor_finish: +(1 + w * (rFin - 1)).toFixed(4),
      factor_duracion: +(1 + w * (rDur - 1)).toFixed(4),
      // el mismo estadístico que usa toda la casa: desvío contra lo esperado, en unidades de su propio ruido
      z: e.var > 0 ? +((e.obs - e.esp) / Math.sqrt(e.var)).toFixed(2) : null,
    };
  }
  return { out, baseline: { n: B.n, finish_global: +B.gFin.toFixed(4), duracion_global: +B.gDur.toFixed(1) } };
}

// ── VALIDACIÓN WALK-FORWARD ──────────────────────────────────────────────────────────────────────────────
// Se fitea con todo lo anterior al año y se predice el año. Brier de "¿termina antes del límite?" con y sin
// el término. Si no mejora, el ajuste no se publica: una mejora dentro de muestra no es una mejora.
function walkForward(rows, clave, opts, desde = 2015) {
  const años = [...new Set(rows.map((r) => +r.fecha.slice(0, 4)))].filter((y) => y >= desde).sort();
  let bSin = 0, bCon = 0, n = 0, mejores = 0;
  for (const y of años) {
    const pasado = rows.filter((r) => +r.fecha.slice(0, 4) < y);
    const test = rows.filter((r) => +r.fecha.slice(0, 4) === y);
    if (pasado.length < 800 || !test.length) continue;
    const B = baseline(pasado);
    const { out } = efectos(pasado, clave, opts);
    let sSin = 0, sCon = 0;
    for (const r of test) {
      const p0 = Math.min(0.98, Math.max(0.02, espera(B, r.estrato).p_fin));
      const k = clave(r);
      const f = (k != null && out[k]) ? out[k].factor_finish : 1;
      const p1 = Math.min(0.98, Math.max(0.02, p0 * f));
      sSin += (p0 - r.finish) ** 2; sCon += (p1 - r.finish) ** 2;
    }
    bSin += sSin; bCon += sCon; n += test.length;
    if (sCon < sSin) mejores++;
  }
  if (!n) return { n: 0, mejora: false };
  const brSin = bSin / n, brCon = bCon / n;
  return {
    n, años_evaluados: años.length, años_con_mejora: mejores,
    brier_sin: +brSin.toFixed(5), brier_con: +brCon.toFixed(5),
    mejora_pct: +(100 * (brSin - brCon) / brSin).toFixed(3),
    // el listón: tiene que mejorar en agregado Y en la mayoría de los años. Una mejora que viene de un solo
    // año es un año raro, no una señal.
    mejora: brCon < brSin && mejores > años.length / 2,
  };
}

(function main() {
  const liga = (process.argv.find((a) => a.startsWith('--liga=')) || '--liga=ufc').split('=')[1];
  const rows = cargar(liga);
  if (!rows) { console.log('[oficiales] sin datos de', liga); process.exit(1); }
  console.log(`[oficiales] ${liga}: ${rows.length} peleas utilizables`);
  console.log(`[oficiales] con árbitro: ${rows.filter((r) => r.ref).length} · con dato de báscula: ${rows.filter((r) => r.peso_mal !== null).length} · con fallo de peso: ${rows.filter((r) => r.peso_mal === true).length}`);

  const arb = efectos(rows, (r) => r.ref, { K: K_ARB, minN: MIN_ARB });
  const vArb = walkForward(rows, (r) => r.ref, { K: K_ARB, minN: MIN_ARB });
  console.log(`[oficiales] árbitros con efecto propio: ${Object.keys(arb.out).length}`);
  const top = Object.entries(arb.out).sort((a, b) => Math.abs(b[1].z) - Math.abs(a[1].z)).slice(0, 8);
  for (const [k, v] of top) console.log(`   ${k.padEnd(22)} n=${String(v.n).padEnd(5)} fin ${(100 * v.finish_obs).toFixed(1)}% vs ${(100 * v.finish_esp).toFixed(1)}% esperado · z=${v.z} · ×${v.factor_finish}`);
  console.log(`[oficiales] validación walk-forward: ${JSON.stringify(vArb)}`);

  // ── EL BANCO DE PRUEBAS ────────────────────────────────────────────────────────────────────────────────
  // Una vez montado el portón —efecto contra lo esperado del estrato, encogido, y validado walk-forward—
  // sale casi gratis pasar por él a los demás candidatos que mueven la duración. Es más honesto probar
  // cinco y publicar el que pase que probar uno y convencerse de que pasó.
  const cubo = (v, cortes) => { if (v == null) return null; for (let i = 0; i < cortes.length; i++) if (v < cortes[i]) return `<${cortes[i]}`; return `>=${cortes[cortes.length - 1]}`; };
  const CANDIDATOS = [
    { id: 'tendencia_de_finalizacion', clave: (r) => cubo(r.tendencia, [0.15, 0.3, 0.45, 0.6]), minN: 200, K: 200, desde: 2015 },
    { id: 'parón_desde_la_última', clave: (r) => cubo(r.paro_max, [180, 300, 450, 700]), minN: 200, K: 200, desde: 2015 },
    { id: 'edad_media_del_cruce', clave: (r) => cubo(r.edad_media, [27, 30, 33, 36]), minN: 200, K: 200, desde: 2015 },
    { id: 'experiencia_del_novato', clave: (r) => cubo(r.exp_min, [1, 3, 6, 10]), minN: 200, K: 200, desde: 2015 },
  ];
  const banco = {};
  console.log('[banco] candidatos que mueven la duración, por el mismo portón:');
  for (const c of CANDIDATOS) {
    const e = efectos(rows, c.clave, { K: c.K, minN: c.minN });
    const v = walkForward(rows, c.clave, { K: c.K, minN: c.minN }, c.desde);
    banco[c.id] = { measured: v.mejora, validacion: v, efectos: e.out };
    const grupos = Object.entries(e.out).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      .map(([k, x]) => `${k}:${(100 * x.finish_obs).toFixed(0)}%(esp ${(100 * x.finish_esp).toFixed(0)}%,n${x.n})`).join(' ');
    console.log(`   ${c.id.padEnd(28)} ${v.mejora ? 'PASA' : 'no pasa'} · brier ${v.brier_sin}→${v.brier_con} (${v.mejora_pct}%) · años con mejora ${v.años_con_mejora}/${v.años_evaluados}`);
    console.log(`      ${grupos}`);
  }

  // peso: solo dos grupos (falló / no falló) sobre los eventos CON datos de báscula
  const conPeso = rows.filter((r) => r.peso_mal !== null);
  const pes = efectos(conPeso, (r) => (r.peso_mal ? 'fallo' : 'limpio'), { K: K_PESO, minN: 30 });
  const vPes = walkForward(conPeso, (r) => (r.peso_mal ? 'fallo' : 'limpio'), { K: K_PESO, minN: 30 }, 2018);
  console.log(`[peso] ${JSON.stringify(pes.out)}`);
  console.log(`[peso] validación walk-forward: ${JSON.stringify(vPes)}`);

  wr(`officials-priors-${liga}.json`, {
    at: new Date().toISOString(), liga,
    baseline: arb.baseline,
    arbitros: { measured: vArb.mejora, validacion: vArb, k_encogimiento: K_ARB, min_peleas: MIN_ARB, efectos: arb.out },
    peso: { measured: vPes.mejora, validacion: vPes, k_encogimiento: K_PESO, efectos: pes.out },
    banco,
    nota: 'Los factores son razones observado/esperado ENCOGIDAS por muestra, y lo esperado sale del estrato de la propia pelea (división × asaltos programados × lustro) para no medir a qué peleas mandan al árbitro. `measured:false` = el ajuste no mejoró fuera de muestra y el simulador debe ignorarlo.',
  });
  console.log(`[oficiales] escrito data/combat/officials-priors-${liga}.json`);
})();
