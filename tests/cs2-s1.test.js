// tests/cs2-s1.test.js — LA PRUEBA DE IDA Y VUELTA MAPA↔RONDA↔SERIE (T2.7, 15-sep-2026)
//
// La puerta que pide el §7.1 de la auditoría externa: «round-trip mapa↔ronda↔serie correcto; cero
// violaciones de soporte; validación de PMF». Tolerancia exigida por el plan: 0,002.
//
// POR QUÉ ESTE TEST Y NO OTRO. El fallo A16 no es un error de cálculo que se vea leyendo: es una conversión
// entre escalas que nadie comprobó. El motor congelado convierte p_map en p_round con una constante
// (`0,5 + (p_map − 0,5)·0,42`) y NUNCA se preguntó si, metida en su propia simulación de mapa, esa p_round
// devolvía el p_map del que salió. No lo devuelve: se desvía hasta 12 puntos. Este test hace justo esa
// pregunta, en las dos direcciones y en los tres niveles, y la deja escrita para que no se pueda volver a
// romper en silencio.
'use strict';
const S = require('../esports-engine/cs2-s1');
const CS2 = require('../esports-engine/cs2');

const TOL = 0.002;          // la tolerancia que fija el plan de trabajo
let fallos = 0;
const cerca = (nombre, real, esperado, tol = TOL) => {
  const ok = Number.isFinite(real) && Math.abs(real - esperado) <= tol;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};
const igual = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${esperado}, real ${real}`);
};
const cierto = (nombre, cond, detalle = '') => {
  if (!cond) fallos++;
  console.log(`${cond ? 'ok  ' : 'FALLA'}  ${nombre}${detalle ? ' — ' + detalle : ''}`);
};

// ══ 1. LA PMF DE UN MAPA SUMA 1 Y NO TIENE SOPORTE IMPOSIBLE ═══════════════════════════════════════════
console.log('\n── 1. validación de PMF y de soporte ──');
for (const pr of [0.32, 0.42, 0.5, 0.58, 0.68]) {
  const d = S.distribucionMapa(S.pRound(pr));
  cerca(`masa total con p_round ${pr}`, d.masa_total, 1, 1e-9);
  // soporte: nadie gana con menos de 13 rondas salvo en prórroga, y nadie pasa de 13 sin haber ido a OT
  let malos = 0, negativos = 0;
  for (const [k, p] of d.marcadores) {
    const [a, b] = k.split('-').map(Number);
    if (p < 0) negativos++;
    const ganador = Math.max(a, b), perdedor = Math.min(a, b);
    // en regulación el ganador llega a 13 exactos; en prórroga sube de 4 en 4 como mucho por bloque
    if (ganador < 13) malos++;
    if (ganador === 13 && perdedor > 12) malos++;
    if (a + b > 24 && perdedor < 12) malos++;        // solo se va a prórroga desde 12-12
  }
  igual(`sin marcadores imposibles con p_round ${pr}`, malos, 0);
  igual(`sin masas negativas con p_round ${pr}`, negativos, 0);
}

// La moneda justa tiene que dar exactamente medio mapa y la media de rondas que la casa ya tenía anotada.
const justo = S.distribucionMapa(S.pRound(0.5));
cerca('con p_round 0,5 el mapa es medio mapa', justo.p_map.p, 0.5, 1e-9);
cierto('la media de rondas de la moneda queda en el 22,06 que la casa ya usaba',
  Math.abs(justo.media_rondas - 22.06) < 0.02, `real ${justo.media_rondas.toFixed(3)}`);

// ══ 2. IDA Y VUELTA RONDA → MAPA → RONDA ═══════════════════════════════════════════════════════════════
console.log('\n── 2. ida y vuelta ronda → mapa → ronda ──');
for (const pr of [0.36, 0.44, 0.50, 0.56, 0.64]) {
  const pm = S.pMapDesdePRound(S.pRound(pr));
  const vuelta = S.pRoundDesdePMap(pm);
  cerca(`p_round ${pr} vuelve a sí misma`, vuelta.p, pr);
}

// ══ 3. IDA Y VUELTA MAPA → RONDA → MAPA (LA QUE EL MOTOR CONGELADO FALLA) ══════════════════════════════
console.log('\n── 3. ida y vuelta mapa → ronda → mapa ──');
for (const pm of [0.25, 0.35, 0.45, 0.5, 0.55, 0.65, 0.75, 0.85]) {
  const pr = S.pRoundDesdePMap(S.pMap(pm));
  const vuelta = S.pMapDesdePRound(pr);
  cerca(`p_map ${pm} vuelve a sí misma`, vuelta.p, pm);
}

// Y el contraste que motiva todo: la constante del motor congelado NO cierra el círculo. Esto no es un
// fallo del test, es el hallazgo — si algún día `cs2.js` se arregla, esta comprobación habrá que darle la
// vuelta, y que haya que tocarla es precisamente la señal de que se arregló.
console.log('\n── 3 bis. el motor congelado no cierra el círculo (A16) ──');
const clampRound = (p) => Math.max(0.32, Math.min(0.68, 0.5 + (p - 0.5) * 0.42));
let peor = 0;
for (const pm of [0.35, 0.45, 0.55, 0.65, 0.75]) {
  const obtenido = S.pMapDesdePRound(S.pRound(clampRound(pm))).p;
  peor = Math.max(peor, Math.abs(obtenido - pm));
}
cierto('la conversión de cs2.js se desvía más de 3 pp en el rango que se cotiza',
  peor > 0.03, `peor desviación ${(100 * peor).toFixed(2)} pp`);
cierto('y S1 la corrige por debajo de la tolerancia',
  Math.abs(S.pMapDesdePRound(S.pRoundDesdePMap(S.pMap(0.65))).p - 0.65) <= TOL);

// ══ 4. LA SERIE: EXACTA, Y COHERENTE CON SU PROPIO INVERSO ═════════════════════════════════════════════
console.log('\n── 4. serie ──');
// con todos los mapas al 50 % la serie es medio a medio, en BO1, BO3 y BO5
for (const bo of [1, 3, 5]) {
  const ps = [0.5, 0.5, 0.5, 0.5, 0.5].slice(0, bo).map(S.pMap);
  cerca(`BO${bo} con mapas al 50 % da serie al 50 %`, S.serie(ps, bo).p_series.p, 0.5, 1e-12);
}
// BO1: la serie ES el mapa
cerca('en BO1 la serie es el mapa', S.serie([S.pMap(0.63)], 1).p_series.p, 0.63, 1e-12);
// BO3 con mapas iguales y sin momentum: fórmula cerrada p²(3−2p)
for (const p of [0.4, 0.55, 0.7]) {
  cerca(`BO3 con p=${p} coincide con p²(3−2p)`, S.serie([p, p, p].map(S.pMap), 3).p_series.p,
    p * p * (3 - 2 * p), 1e-12);
}
// los marcadores suman 1 y ninguno es imposible
const s3 = S.serie([0.6, 0.55, 0.5].map(S.pMap), 3);
cerca('los marcadores de la serie suman 1', s3.scores.reduce((a, x) => a + x.p, 0), 1, 1e-12);
igual('ningún marcador de BO3 pasa de 2 mapas ganados', s3.scores.filter((x) => {
  const [a, b] = x.score.split('-').map(Number); return Math.max(a, b) !== 2;
}).length, 0);
// la inversa devuelve el objetivo
const inv = S.pMapsDesdePSeries(S.pSeries(0.72), [0.6, 0.55, 0.5].map(S.pMap), 3);
igual('la inversa de la serie es alcanzable', inv.alcanzable, true);
cerca('y reproduce el objetivo', inv.obtenido, 0.72, 1e-6);

// ══ 5. EL CÍRCULO COMPLETO: SERIE → MAPAS → RONDAS → MAPAS → SERIE ═════════════════════════════════════
console.log('\n── 5. el círculo completo (la aceptación de T2.7) ──');
const fuerza = { a: { mirage: 0.62, inferno: 0.55, nuke: 0.48, ancient: 0.51, dust2: 0.58, anubis: 0.44, train: 0.53 }, b: {} };
for (const k of Object.keys(fuerza.a)) fuerza.b[k] = 1 - fuerza.a[k];
for (const objetivo of [0.35, 0.50, 0.62, 0.78]) {
  const r = S.analiza({ pSeriesAnclada: objetivo, mapStrength: fuerza, bo: 3 });
  cerca(`serie ${objetivo}: el círculo se cierra`, r.p_series_recompilada.p, objetivo);
  for (const m of r.por_mapa) {
    cerca(`  mapa ${m.orden} (${m.mapa}): ronda→mapa vuelve al p_map`, m.ida_y_vuelta_pp / 100, 0);
  }
}

// ══ 6. EL VETO: DISTRIBUCIÓN, NO RAMA ══════════════════════════════════════════════════════════════════
console.log('\n── 6. veto ──');
const d3 = S.vetoDistribucion(fuerza, { bo: 3 });
igual('un BO3 sobre pool de 7 tiene 5.040 ramas factibles', d3.ramas_n, 5040);
cerca('las ramas suman 1', d3.ramas_completas.reduce((a, r) => a + r.p, 0), 1, 1e-9);
igual('cada rama deja 3 mapas jugados', d3.ramas_completas.filter((r) => r.jugados.length !== 3).length, 0);
igual('ninguna rama repite mapa', d3.ramas_completas.filter((r) => new Set(r.jugados).size !== 3).length, 0);
cierto('la rama más probable NO se lleva el mercado (por eso la codiciosa engaña)',
  d3.ramas[0].p < 0.05, `rama más probable ${(100 * d3.ramas[0].p).toFixed(2)} %`);
// la marginal de "se juega" suma 3 mapas repartidos entre los 7 del pool
cerca('la masa de mapas jugados suma 3', Object.values(d3.p_jugado).reduce((a, b) => a + b, 0), 3, 1e-9);

// condicionamiento exacto: los dos primeros bans publicados desaparecen del reparto
const cond = S.vetoCondicionado(fuerza, [{ map: 'mirage' }, { map: 'dust2' }], { bo: 3 });
igual('condicionar a dos bans deja 5·4·3·2 = 120 ramas', cond.ramas_n, 120);
cerca('las ramas condicionadas vuelven a sumar 1', cond.ramas_completas.reduce((a, r) => a + r.p, 0), 1, 1e-9);
igual('un mapa baneado no se juega nunca', (cond.p_jugado.mirage || 0) + (cond.p_jugado.dust2 || 0), 0);
igual('condicionar a un pick lo fuerza a jugarse',
  +(S.vetoCondicionado(fuerza, [null, null, { map: 'nuke' }], { bo: 3 }).p_jugado.nuke || 0).toFixed(9), 1);

// la serie sobre el veto promedia RAMAS compiladas, no p_map
const sv = S.serieSobreVeto(d3, fuerza, 3);
cierto('la serie sobre el veto existe y está en (0,1)', sv.p_series.p > 0 && sv.p_series.p < 1,
  `p_series ${sv.p_series.p.toFixed(4)}`);

// ══ 7. LOS TIPOS NO SE MEZCLAN ═════════════════════════════════════════════════════════════════════════
console.log('\n── 7. tipado ──');
let lanzo = false;
try { S.pRoundDesdePMap(S.pRound(0.55)); } catch { lanzo = true; }
igual('pasar un p_round donde se espera un p_map lanza', lanzo, true);
lanzo = false;
try { S.serie([S.pRound(0.55), S.pRound(0.55)], 3); } catch { lanzo = true; }
igual('compilar una serie con p_round lanza', lanzo, true);

// ══ 8. MOMENTUM APAGADO POR DEFECTO ════════════════════════════════════════════════════════════════════
console.log('\n── 8. momentum ──');
igual('el challenger nace con el momentum a cero', S.MOMENTUM, 0);
igual('y la serie lo declara', S.serie([0.6, 0.6, 0.6].map(S.pMap), 3).momentum, 0);
cierto('encenderlo cambia el reparto de marcadores (por eso no se hereda sin medir)',
  Math.abs(S.serie([0.6, 0.6, 0.6].map(S.pMap), 3, { momentum: 0.06 }).scores.find((x) => x.score === '2-0').p
    - S.serie([0.6, 0.6, 0.6].map(S.pMap), 3).scores.find((x) => x.score === '2-0').p) > 0.01);

// ══ 9. QUE LA MECÁNICA DE RONDA ES LA MISMA QUE LA CONGELADA ═══════════════════════════════════════════
// La DP tiene que reproducir el Monte Carlo de `cs2.mapRounds` dentro del error de muestreo. Si no lo
// hiciera, la comparación del §8 mediría dos modelos de ronda distintos y no la reparación de la conversión.
console.log('\n── 9. la DP reproduce el Monte Carlo del motor congelado ──');
for (const pr of [0.45, 0.5, 0.58]) {
  const mc = CS2.mapRounds(pr, { eco: S.ECO_DRAG, sims: 60000, seed: 4127 });
  const dp = S.distribucionMapa(S.pRound(pr), { eco: S.ECO_DRAG });
  cerca(`media de rondas con p_round ${pr}`, dp.media_rondas, mc.mean_rounds, 0.06);
  cerca(`tasa de prórroga con p_round ${pr}`, dp.prorroga_p, mc.overtime_p, 0.01);
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
