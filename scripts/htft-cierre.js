#!/usr/bin/env node
// scripts/htft-cierre.js — ¿EL PRECIO YA LLEVA DENTRO LA CONDICIONALIDAD DEL DESCANSO? (16-sep, C-2)
//
// ── LA PREGUNTA, Y POR QUÉ ES LA QUE MÁS VALE DEL SISTEMA ──────────────────────────────────────────────
// A22 midió sobre 27.816 partidos que las dos mitades NO son independientes: el equipo que va perdiendo al
// descanso marca **+0,117 goles más** de lo previsto y el que va ganando **−0,060 menos**. El rango, 0,177
// goles, es el **24 % de la λ de media parte**, y cinco de los seis estados pasan |t| ≥ 3. Es la única
// estructura del sistema que el mercado PODRÍA no estar pagando.
//
// Pero «podría» no es «no lo paga». Si Cloudbet ya cotiza el HT/FT con esa condicionalidad dentro, la
// ventaja no existe y C2 se cierra sin escribir una línea de modelo. Si lo cotiza como si las mitades
// fueran independientes, entonces la ventaja es real y grande, y C2 pasa a ser el candidato principal.
//
// ── CÓMO SE CONTESTA SIN NECESITAR NI UN RESULTADO ─────────────────────────────────────────────────────
// Ésta es la parte que hace la prueba decisiva y barata. La casa publica, del MISMO partido:
//
//   · el 1X2 de la primera parte      (`soccer.match_odds_period_first_half`)
//   · el 1X2 de la segunda parte      (`soccer.match_odds_period_second_half`)
//   · la conjunta HT/FT, nueve salidas (`soccer.halftime_fulltime_result`)
//
// Las dos primeras dan las MARGINALES de cada mitad **según la propia casa**. Con ellas se construye la
// conjunta que saldría si las mitades fueran independientes — `descansoFinal()` de `goal-engine/mitades.js`,
// el mismo código que usa el motor. Y esa conjunta se compara con la que la casa cotiza de verdad.
//
// No hacen falta resultados, ni muestra histórica, ni esperar a que liquide nada: **se le pregunta al
// precio contra sí mismo**. Y como las dos piezas salen del mismo partido y la misma casa, no hay
// confusión por composición: no se está comparando una media de partidos con otra media de otros partidos.
//
// ── CÓMO SE LEE EL RESULTADO ───────────────────────────────────────────────────────────────────────────
//   · si la conjunta cotizada ≈ la de mitades independientes  → la casa NO paga la condicionalidad
//   · si se desvía, y se desvía HACIA LAS REMONTADAS          → la casa SÍ la paga y C2 se cierra
//
// La segunda comprobación importa tanto como la primera: una desviación en cualquier dirección no vale,
// tiene que ir en la dirección que A22 midió. El equipo que va perdiendo marca más, así que las celdas de
// remontada (va perdiendo al descanso y acaba ganando o empatando) tienen que pesar MÁS de lo que dicen las
// mitades independientes. Una desviación al revés sería otra cosa, no esto.
//
// USO
//   node scripts/htft-cierre.js --dir /tmp/cbev          # sobre eventos ya bajados
//   node scripts/htft-cierre.js --json
'use strict';
const fs = require('fs');
const path = require('path');
const MIT = require('../goal-engine/mitades');
const INF = require('../lib/inferencia');

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r6 = (x) => (Number.isFinite(x) ? +x.toFixed(6) : null);

// ── PRECIOS SIN MARGEN ──────────────────────────────────────────────────────────────────────────────────
// Un 1X2 son tres salidas; el HT/FT, nueve. En los dos casos el sobre-redondeo se quita normalizando, que
// es lo correcto cuando se cotizan TODAS las salidas de una partición: la suma de las implícitas es 1 + R.
function sinMargen(sels, clave) {
  const p = {};
  let suma = 0;
  for (const s of (sels || [])) {
    if (s.status !== 'SELECTION_ENABLED' || s.side === 'LAY') continue;
    const o = Number(s.price);
    if (!(o > 1)) continue;
    const k = clave(s);
    if (!k) continue;
    p[k] = (p[k] || 0) + 1 / o;
    suma += 1 / o;
  }
  if (!(suma > 0.5)) return null;
  const out = {};
  for (const [k, v] of Object.entries(p)) out[k] = v / suma;
  return { p: out, overround_pct: +(100 * (suma - 1)).toFixed(2) };
}

const LADO_1X2 = (s) => ({ home: 'HOME', draw: 'DRAW', away: 'AWAY' })[String(s.outcome || '').toLowerCase()] || null;
const LADO_HTFT = (s) => {
  const m = /^(home|draw|away)_(home|draw|away)$/.exec(String(s.outcome || '').toLowerCase());
  return m ? `HTFT_${m[1].toUpperCase()}_${m[2].toUpperCase()}` : null;
};
const submercado = (mk) => (mk && mk.submarkets ? Object.values(mk.submarkets)[0] : null);

// ── DE UN 1X2 A DOS LAMBDAS ─────────────────────────────────────────────────────────────────────────────
// Dos incógnitas (λ local, λ visitante) y dos restricciones independientes (P(gana local), P(empate); la
// tercera se deduce). Se resuelve por búsqueda en rejilla y refinamiento, que para dos parámetros en un
// rango tan pequeño es exacto de sobra y no arrastra las sorpresas de un solver.
//
// Ojo con el supuesto: esto SUPONE Poisson independiente DENTRO de la mitad. No es inocente, pero es
// exactamente el supuesto del motor, y esta prueba compara el precio contra EL MOTOR — si se usara otra
// familia de distribuciones, la diferencia medida ya no sería la que decide C2.
function lambdasDe1X2(pHome, pDraw, pAway) {
  if (![pHome, pDraw, pAway].every((x) => Number.isFinite(x) && x > 0 && x < 1)) return null;
  const err = (lh, la) => {
    const m = MIT.matrizMitad(lh, la, { n: 8 });
    let g = 0, d = 0;
    for (let h = 0; h < m.length; h++) for (let a = 0; a < m.length; a++) {
      if (h > a) g += m[h][a]; else if (h === a) d += m[h][a];
    }
    return (g - pHome) ** 2 + (d - pDraw) ** 2;
  };
  let mejor = null;
  for (let lh = 0.05; lh <= 3.0; lh += 0.05) for (let la = 0.05; la <= 3.0; la += 0.05) {
    const e = err(lh, la);
    if (mejor == null || e < mejor.e) mejor = { lh, la, e };
  }
  if (!mejor) return null;
  for (const paso of [0.01, 0.002]) {
    const { lh: h0, la: a0 } = mejor;
    for (let lh = Math.max(0.01, h0 - 5 * paso); lh <= h0 + 5 * paso; lh += paso) {
      for (let la = Math.max(0.01, a0 - 5 * paso); la <= a0 + 5 * paso; la += paso) {
        const e = err(lh, la);
        if (e < mejor.e) mejor = { lh, la, e };
      }
    }
  }
  // si el ajuste no reproduce las marginales, no se devuelve nada: un λ que no casa con el precio del que
  // sale convertiría toda la comparación en ruido
  return mejor.e < 1e-5 ? { lh: r4(mejor.lh), la: r4(mejor.la), error: r6(Math.sqrt(mejor.e)) } : null;
}

// ── LAS NUEVE CELDAS ────────────────────────────────────────────────────────────────────────────────────
const CELDAS = [];
for (const ht of ['HOME', 'DRAW', 'AWAY']) for (const ft of ['HOME', 'DRAW', 'AWAY']) CELDAS.push(`HTFT_${ht}_${ft}`);
// Las celdas donde A22 dice que tiene que haber MÁS masa si la casa paga la condicionalidad: el que va
// perdiendo al descanso marca más, así que remontar (perder al descanso y acabar ganando) y rescatar
// (perder al descanso y acabar empatando) pesan más de lo que dicen las mitades independientes.
const REMONTADA = new Set(['HTFT_AWAY_HOME', 'HTFT_HOME_AWAY', 'HTFT_AWAY_DRAW', 'HTFT_HOME_DRAW']);
// Y donde tiene que haber MENOS: el que va ganando marca menos, así que «se mantiene» pesa menos.
const MANTIENE = new Set(['HTFT_HOME_HOME', 'HTFT_AWAY_AWAY']);

// ── LA CONJUNTA CON LAS MITADES CONDICIONADAS ──────────────────────────────────────────────────────────
// Igual que `descansoFinal()`, pero la segunda parte se simula con las lambdas ESCALADAS según quién va
// ganando al descanso: el que va perdiendo multiplica por `mDetras`, el que va ganando por `mDelante`.
// Con mDetras = mDelante = 1 reproduce exactamente las mitades independientes.
function conjuntaCondicionada(m1, lh2, la2, mDetras, mDelante, { n = 8 } = {}) {
  const cache = new Map();
  const matriz = (fh, fa) => {
    const k = fh + '|' + fa;
    if (!cache.has(k)) cache.set(k, MIT.matrizMitad(lh2 * fh, la2 * fa, { n }));
    return cache.get(k);
  };
  const out = {};
  const L = Math.min(n, m1.length - 1);
  for (let h1 = 0; h1 <= L; h1++) for (let a1 = 0; a1 <= L; a1++) {
    const p1 = m1[h1][a1];
    if (p1 < 1e-10) continue;
    const ht = h1 > a1 ? 'HOME' : (h1 === a1 ? 'DRAW' : 'AWAY');
    // quien va por detrás acelera y quien va por delante afloja; con el empate no hay ni uno ni otro
    const fh = ht === 'HOME' ? mDelante : ht === 'AWAY' ? mDetras : 1;
    const fa = ht === 'AWAY' ? mDelante : ht === 'HOME' ? mDetras : 1;
    const m2 = matriz(fh, fa);
    for (let h2 = 0; h2 <= L; h2++) for (let a2 = 0; a2 <= L; a2++) {
      const p = p1 * m2[h2][a2];
      if (p < 1e-10) continue;
      const H = h1 + h2, A = a1 + a2;
      const ft = H > A ? 'HOME' : (H === A ? 'DRAW' : 'AWAY');
      const k = `HTFT_${ht}_${ft}`;
      out[k] = (out[k] || 0) + p;
    }
  }
  return out;
}

// ¿QUÉ MULTIPLICADORES TENDRÍA QUE ESTAR USANDO LA CASA para cotizar el HT/FT que cotiza? Se busca el par
// (mDetras, mDelante) que mejor reproduce su conjunta. Eso convierte una desviación en puntos porcentuales
// —que no se puede comparar con nada— en el MISMO lenguaje en que A22 midió el efecto, y entonces sí se
// puede preguntar lo único que decide C2: ¿la casa paga el efecto ENTERO o solo un trozo?
function multiplicadoresImplicitos(m1, lh2, la2, objetivo) {
  const err = (md, ml) => {
    const c = conjuntaCondicionada(m1, lh2, la2, md, ml);
    let s = 0;
    for (const k of CELDAS) s += ((c[k] || 0) - (objetivo[k] || 0)) ** 2;
    return s;
  };
  let mejor = null;
  for (let md = 0.80; md <= 1.60; md += 0.02) for (let ml = 0.60; ml <= 1.30; ml += 0.02) {
    const e = err(md, ml);
    if (mejor == null || e < mejor.e) mejor = { md, ml, e };
  }
  for (const paso of [0.005]) {
    const { md: d0, ml: l0 } = mejor;
    for (let md = d0 - 3 * paso; md <= d0 + 3 * paso; md += paso) {
      for (let ml = l0 - 3 * paso; ml <= l0 + 3 * paso; ml += paso) {
        const e = err(md, ml);
        if (e < mejor.e) mejor = { md, ml, e };
      }
    }
  }
  return { detras: r4(mejor.md), delante: r4(mejor.ml), rms_pp: r4(100 * Math.sqrt(mejor.e / 9)) };
}

// ── AJUSTE DE LA SEGUNDA PARTE DENTRO DE LA PROPIA CONJUNTA ────────────────────────────────────────────
// Dado el λ de primera parte, se busca el λ de segunda que mejor reproduce las NUEVE celdas. Con
// `condicional = false` la segunda parte es la misma pase lo que pase al descanso (mitades independientes);
// con `condicional = true` se le añaden los dos multiplicadores. La diferencia entre los dos residuos es,
// exactamente, cuánta dependencia entre mitades hace falta para explicar el precio.
function ajustaSegunda(m1, objetivo, { condicional = false } = {}) {
  // Búsqueda ESCALONADA, no una rejilla de cuatro dimensiones. La de cuatro (λ local × λ visitante ×
  // multiplicador de atrás × multiplicador de delante) son ~670.000 conjuntas por partido y no termina.
  // Escalonada: primero las dos lambdas suponiendo independencia, después los multiplicadores dejando que
  // las lambdas se muevan en un entorno pequeño. El óptimo es el mismo porque las lambdas las fija sobre
  // todo la masa total de goles y los multiplicadores solo la reparten entre estados.
  const dist = (lh, la, md, ml) => {
    const c = conjuntaCondicionada(m1, lh, la, md, ml, { n: 6 });
    let s = 0;
    for (const k of CELDAS) s += ((c[k] || 0) - (objetivo[k] || 0)) ** 2;
    return s;
  };
  let mejor = null;
  for (let lh = 0.15; lh <= 2.0; lh += 0.05) for (let la = 0.15; la <= 2.0; la += 0.05) {
    const e = dist(lh, la, 1, 1);
    if (mejor == null || e < mejor.e) mejor = { lh, la, md: 1, ml: 1, e };
  }
  if (!mejor) return null;
  if (condicional) {
    const base = { lh: mejor.lh, la: mejor.la };
    for (let md = 0.70; md <= 1.70; md += 0.025) for (let ml = 0.50; ml <= 1.40; ml += 0.025) {
      for (const dlh of [-0.1, -0.05, 0, 0.05, 0.1]) for (const dla of [-0.1, -0.05, 0, 0.05, 0.1]) {
        const lh = base.lh + dlh, la = base.la + dla;
        if (lh <= 0.02 || la <= 0.02) continue;
        const e = dist(lh, la, md, ml);
        if (e < mejor.e) mejor = { lh, la, md, ml, e };
      }
    }
  }
  const paso = 0.01;
  for (let lh = Math.max(0.02, mejor.lh - 3 * paso); lh <= mejor.lh + 3 * paso; lh += paso) {
    for (let la = Math.max(0.02, mejor.la - 3 * paso); la <= mejor.la + 3 * paso; la += paso) {
      const mds = condicional ? [mejor.md - 0.01, mejor.md, mejor.md + 0.01] : [1];
      const mls = condicional ? [mejor.ml - 0.01, mejor.ml, mejor.ml + 0.01] : [1];
      for (const md of mds) for (const ml of mls) {
        const e = dist(lh, la, md, ml);
        if (e < mejor.e) mejor = { lh, la, md, ml, e };
      }
    }
  }
  return { lh: r4(mejor.lh), la: r4(mejor.la), detras: r4(mejor.md), delante: r4(mejor.ml),
    rms_pp: r4(100 * Math.sqrt(mejor.e / 9)) };
}

function unPartido(ev) {
  const M = ev.markets || {};
  const jt = sinMargen((submercado(M['soccer.halftime_fulltime_result']) || {}).selections, LADO_HTFT);
  if (!jt) return { ok: false, motivo: 'sin HT/FT' };
  if (Object.keys(jt.p).length !== 9) return { ok: false, motivo: `el HT/FT trae ${Object.keys(jt.p).length} salidas, no 9` };

  // ── TODO SALE DE LA MISMA CONJUNTA, Y ESO ES EL ARREGLO ───────────────────────────────────────────────
  // La primera versión de esta prueba construía la referencia con el 1X2 de PRIMERA PARTE, otro mercado.
  // Y al comprobarlo resultó que la casa **no cuadra consigo misma**: la marginal del descanso que sale de
  // su HT/FT se separa de su propio 1X2 de 1ª parte una mediana de 0,92 pp y hasta 5,28. El efecto que se
  // quería medir vale entre 0,17 y 1,55 pp por celda — o sea, del MISMO tamaño que la incoherencia. Así no
  // se puede distinguir «la casa cotiza las mitades como dependientes» de «la casa tiene dos mercados que
  // no se hablan», y un número que no distingue esas dos cosas no decide nada.
  // Arreglo: la marginal del descanso se toma de la PROPIA conjunta. Así cuadra por construcción y lo único
  // que queda por explicar es la forma de las tres condicionales, que es justo la pregunta.
  const margHt = { HOME: 0, DRAW: 0, AWAY: 0 }, margFt = { HOME: 0, DRAW: 0, AWAY: 0 };
  for (const k of CELDAS) {
    const [, ht, ft] = k.split('_');
    margHt[ht] += jt.p[k]; margFt[ft] += jt.p[k];
  }
  const L1 = lambdasDe1X2(margHt.HOME, margHt.DRAW, margHt.AWAY);
  if (!L1) return { ok: false, motivo: 'las lambdas no reproducen la marginal del descanso de la propia conjunta' };
  const m1 = MIT.matrizMitad(L1.lh, L1.la, { n: 8 });

  const indep = ajustaSegunda(m1, jt.p, { condicional: false });
  const cond = ajustaSegunda(m1, jt.p, { condicional: true });
  if (!indep || !cond) return { ok: false, motivo: 'no se pudo ajustar la segunda parte' };

  // la incoherencia entre mercados se sigue midiendo, pero ya solo como AVISO: no entra en el veredicto
  const h1 = sinMargen((submercado(M['soccer.match_odds_period_first_half']) || {}).selections, LADO_1X2);
  const ft1x2 = sinMargen((submercado(M['soccer.match_odds']) || {}).selections, LADO_1X2);
  const desv = (a, b) => (a && b ? Math.max(...['HOME', 'DRAW', 'AWAY'].map((x) => Math.abs(a[x] - b[x]))) : null);
  const coherencia = {
    ht_contra_1x2_1t_pp: h1 ? r4(100 * desv(margHt, h1.p)) : null,
    ft_contra_1x2_partido_pp: ft1x2 ? r4(100 * desv(margFt, ft1x2.p)) : null,
  };

  const celdas = {};
  const cIndep = conjuntaCondicionada(m1, indep.lh, indep.la, 1, 1, { n: 6 });
  for (const k of CELDAS) {
    celdas[k] = { mercado: r6(jt.p[k]), independiente: r6(cIndep[k] || 0),
      diferencia_pp: r4(100 * (jt.p[k] - (cIndep[k] || 0))) };
  }
  const lam2 = (cond.lh + cond.la) / 2;
  return { ok: true, id: ev.id, partido: `${(ev.home || {}).name} vs ${(ev.away || {}).name}`,
    lambdas: { h1: L1, h2_indep: { lh: indep.lh, la: indep.la }, h2_cond: { lh: cond.lh, la: cond.la } },
    multiplicadores: { detras: cond.detras, delante: cond.delante, rms_pp: cond.rms_pp },
    // cuánto mejora el ajuste al permitir que las mitades dependan: si no mejora, no hay dependencia
    rms_independiente_pp: indep.rms_pp, rms_condicional_pp: cond.rms_pp,
    gana_la_dependencia_pp: r4(indep.rms_pp - cond.rms_pp),
    efecto_goles: { detras: r4((cond.detras - 1) * lam2), delante: r4((cond.delante - 1) * lam2),
      lambda_media_mitad: r4(lam2) },
    overround: { htft: jt.overround_pct },
    coherencia, celdas };
}

function informe(eventos) {
  const buenos = [], malos = {};
  for (const ev of eventos) {
    const r = unPartido(ev);
    if (r.ok) buenos.push(r); else malos[r.motivo] = (malos[r.motivo] || 0) + 1;
  }
  if (!buenos.length) return { error: 'ningún partido utilizable', descartes: malos };
  const porCelda = {};
  for (const k of CELDAS) {
    const dif = buenos.map((b) => ({ v: b.celdas[k].diferencia_pp, ev: b.id }));
    const bo = INF.bootstrapClusters(dif, { valor: (x) => x.v, cluster: (x) => x.ev, replicas: 2000 });
    const t = bo && bo.se > 0 ? bo.media / bo.se : null;
    porCelda[k] = { media_pp: r4(bo ? bo.media : null), ic: bo ? [r4(bo.ic[0]), r4(bo.ic[1])] : null,
      t: r4(t), p: INF.pDeT(t, Math.max(0, buenos.length - 1)),
      mercado_medio: r4(100 * buenos.reduce((s, b) => s + b.celdas[k].mercado, 0) / buenos.length),
      independiente_medio: r4(100 * buenos.reduce((s, b) => s + b.celdas[k].independiente, 0) / buenos.length) };
  }
  const ps = CELDAS.map((k) => porCelda[k].p).filter((x) => Number.isFinite(x));
  const rech = ps.length ? new Set(INF.bh(ps, 0.10).rechazadas) : new Set();
  CELDAS.forEach((k, i) => { porCelda[k].significativa_bh = rech.has(i); });

  // El resumen que decide: ¿se mueve, y se mueve hacia donde A22 dice?
  const sumaRem = CELDAS.filter((k) => REMONTADA.has(k)).reduce((s, k) => s + porCelda[k].media_pp, 0);
  const sumaMan = CELDAS.filter((k) => MANTIENE.has(k)).reduce((s, k) => s + porCelda[k].media_pp, 0);
  const mueve = CELDAS.filter((k) => porCelda[k].significativa_bh);
  const direccionOk = sumaRem > 0 && sumaMan < 0;
  const desviacionMax = Math.max(...CELDAS.map((k) => Math.abs(porCelda[k].media_pp)));

  // ¿CUÁNTO GANA PERMITIR QUE LAS MITADES DEPENDAN? Si el ajuste independiente ya reproduce la conjunta
  // dentro del ruido de redondeo de la casa, no hay dependencia que encontrar. Si mejora mucho al permitir
  // los multiplicadores, la casa está cotizando dependencia y hay que ver de qué tamaño.
  const rmsI = buenos.map((b) => ({ v: b.rms_independiente_pp, ev: b.id }));
  const rmsC = buenos.map((b) => ({ v: b.rms_condicional_pp, ev: b.id }));
  const gana = buenos.map((b) => ({ v: b.gana_la_dependencia_pp, ev: b.id }));
  const bt = (a) => { const o = INF.bootstrapClusters(a, { valor: (x) => x.v, cluster: (x) => x.ev, replicas: 2000 }); return o ? { media: r4(o.media), ic: [r4(o.ic[0]), r4(o.ic[1])] } : null; };
  const residuo = { independiente: bt(rmsI), condicional: bt(rmsC), gana_la_dependencia: bt(gana) };

  let veredicto, razon;
  if (!mueve.length) {
    veredicto = 'el_precio_NO_lleva_la_condicionalidad';
    razon = `ninguna de las nueve celdas se desvía de las mitades independientes pasando Benjamini-Hochberg. `
      + `La desviación mayor es de ${r4(desviacionMax)} pp. La casa cotiza el HT/FT como si las dos mitades fueran `
      + `independientes, así que la estructura que midió A22 NO está en el precio.`;
  } else if (direccionOk) {
    veredicto = 'el_precio_SI_lleva_la_condicionalidad';
    razon = `${mueve.length} celdas se desvían pasando BH y el conjunto va en la dirección de A22: las remontadas `
      + `suman ${r4(sumaRem)} pp de MÁS y los «se mantiene» ${r4(sumaMan)} pp de MENOS. La casa ya paga la `
      + `condicionalidad del descanso.`;
  } else {
    veredicto = 'se_mueve_pero_no_hacia_alli';
    razon = `${mueve.length} celdas se desvían pasando BH, pero NO en la dirección que midió A22 (remontadas `
      + `${r4(sumaRem)} pp, mantiene ${r4(sumaMan)} pp). La casa cotiza algo distinto de las mitades `
      + `independientes, pero no es esta estructura: hay que mirar qué es antes de construir nada encima.`;
  }
  // ── LA COMPARACIÓN QUE DECIDE C2 ──────────────────────────────────────────────────────────────────────
  // A22 midió el efecto en goles de media parte: el que va por detrás marca **+0,117** y el que va por
  // delante **−0,060**. Aquí se mide lo mismo, pero leído DEL PRECIO. Si la casa paga el efecto entero, no
  // queda ventaja. Si paga la mitad, queda la mitad — y eso es lo que hay que saber antes de construir nada.
  // la coherencia agregada: si la casa no cuadra consigo misma, lo que sigue no mide lo que dice medir
  const coh = (() => {
    const ht = buenos.map((b) => b.coherencia.ht_contra_1x2_1t_pp).filter(Number.isFinite);
    const ft = buenos.map((b) => b.coherencia.ft_contra_1x2_partido_pp).filter(Number.isFinite);
    const med = (a) => (a.length ? r4(a.slice().sort((x, y) => x - y)[a.length >> 1]) : null);
    const max = (a) => (a.length ? r4(Math.max(...a)) : null);
    const htMed = med(ht), ftMed = med(ft);
    return { ht_contra_1x2_1t: { mediana_pp: htMed, peor_pp: max(ht), n: ht.length },
      ft_contra_1x2_partido: { mediana_pp: ftMed, peor_pp: max(ft), n: ft.length },
      veredicto: (htMed != null && htMed < 0.5) ? 'la casa cuadra consigo misma' : 'OJO: el HT/FT no cuadra con el 1X2 de 1a parte de la propia casa, asi que la diferencia medida puede ser incoherencia entre mercados y no dependencia entre mitades' };
  })();
  const A22 = { detras: 0.117, delante: -0.060 };
  const efec = (que) => {
    const v = buenos.map((b) => ({ v: b.efecto_goles[que], ev: b.id }));
    const bo = INF.bootstrapClusters(v, { valor: (x) => x.v, cluster: (x) => x.ev, replicas: 2000 });
    return bo ? { media: r4(bo.media), ic: [r4(bo.ic[0]), r4(bo.ic[1])] } : null;
  };
  const eD = efec('detras'), eL = efec('delante');
  const cubre = (e, ref) => (e && Array.isArray(e.ic) ? e.ic[0] <= ref && ref <= e.ic[1] : null);
  const cuota = (e, ref) => (e && Number.isFinite(e.media) && ref !== 0 ? r4(e.media / ref) : null);
  const contraA22 = {
    a22: A22,
    precio: { detras: eD, delante: eL },
    // qué fracción del efecto de A22 está ya metida en el precio
    fraccion_pagada: { detras: cuota(eD, A22.detras), delante: cuota(eL, A22.delante) },
    ic_cubre_a22: { detras: cubre(eD, A22.detras), delante: cubre(eL, A22.delante) },
    multiplicadores_medios: { detras: r4(buenos.reduce((s, b) => s + b.multiplicadores.detras, 0) / buenos.length),
      delante: r4(buenos.reduce((s, b) => s + b.multiplicadores.delante, 0) / buenos.length) },
    ajuste_rms_pp: r4(buenos.reduce((s, b) => s + b.multiplicadores.rms_pp, 0) / buenos.length),
  };
  return { at: new Date().toISOString(), partidos: buenos.length, descartes: malos,
    veredicto, razon, contra_a22: contraA22, coherencia: coh, residuo,
    direccion: { remontadas_pp: r4(sumaRem), mantiene_pp: r4(sumaMan), celdas_que_se_mueven: mueve },
    por_celda: porCelda,
    overround_medio: { htft: r4(buenos.reduce((s, b) => s + b.overround.htft, 0) / buenos.length),
      h1: r4(buenos.reduce((s, b) => s + b.overround.h1, 0) / buenos.length),
      h2: r4(buenos.reduce((s, b) => s + b.overround.h2, 0) / buenos.length) },
    supuesto: 'las lambdas se ajustan a las marginales que publica la casa suponiendo Poisson independiente DENTRO de cada mitad, que es exactamente el supuesto del motor. La prueba compara el precio contra el motor, no contra la verdad.',
    ejemplos: buenos.slice(0, 3).map((b) => ({ partido: b.partido, lambdas: b.lambdas,
      celdas: Object.fromEntries(Object.entries(b.celdas).map(([k, v]) => [k, v.diferencia_pp])) })) };
}

if (require.main === module) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const dir = arg('--dir');
  if (!dir) { console.error('uso: node scripts/htft-cierre.js --dir <carpeta con eventos de cloudbet en json>'); process.exit(2); }
  const eventos = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { eventos.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* archivo roto */ }
  }
  const inf = informe(eventos);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(inf, null, 2)); process.exit(0); }
  if (inf.error) { console.error(inf.error, JSON.stringify(inf.descartes)); process.exit(1); }
  console.log(`\n¿EL CIERRE LLEVA LA CONDICIONALIDAD DEL DESCANSO? · ${inf.partidos} partidos · ${inf.at.slice(0, 10)}\n`);
  console.log('celda'.padEnd(20) + 'mercado%'.padStart(10) + 'indep%'.padStart(9) + 'dif pp'.padStart(9) + 't'.padStart(8) + '  BH');
  for (const k of CELDAS) {
    const c = inf.por_celda[k];
    console.log(k.padEnd(20) + String(c.mercado_medio).padStart(10) + String(c.independiente_medio).padStart(9)
      + String(c.media_pp).padStart(9) + String(c.t).padStart(8) + '  ' + (c.significativa_bh ? 'SÍ' : '·'));
  }
  console.log(`\nremontadas ${inf.direccion.remontadas_pp} pp · mantiene ${inf.direccion.mantiene_pp} pp`);
  const C = inf.contra_a22;
  console.log('\n── EL EFECTO EN GOLES DE MEDIA PARTE: LO QUE MIDIÓ A22 CONTRA LO QUE PAGA EL PRECIO ──');
  console.log('              A22      precio        IC del precio            fracción pagada');
  console.log(`va por detrás  +${C.a22.detras}   ${String(C.precio.detras && C.precio.detras.media).padStart(8)}   `
    + `${JSON.stringify(C.precio.detras && C.precio.detras.ic).padEnd(22)} ${C.fraccion_pagada.detras}`);
  console.log(`va por delante ${C.a22.delante}   ${String(C.precio.delante && C.precio.delante.media).padStart(8)}   `
    + `${JSON.stringify(C.precio.delante && C.precio.delante.ic).padEnd(22)} ${C.fraccion_pagada.delante}`);
  console.log(`multiplicadores medios: detrás ×${C.multiplicadores_medios.detras} · delante ×${C.multiplicadores_medios.delante}`
    + ` · ajuste rms ${C.ajuste_rms_pp} pp`);
  console.log(`\nVEREDICTO: ${inf.veredicto}\n${inf.razon}\n`);
  console.log(`descartes: ${JSON.stringify(inf.descartes)}`);
}

module.exports = { unPartido, informe, lambdasDe1X2, sinMargen, CELDAS, REMONTADA, MANTIENE };
