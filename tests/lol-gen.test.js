// tests/lol-gen.test.js — LAS DOS PROPIEDADES DEL GENERADOR DE KILLS QUE HAY QUE PODER AFIRMAR (16-sep-2026)
//
// H-L1 y H-L2 del backlog de la auditoría externa.
//
// H-L2 — EL TOTAL NO PUEDE DEPENDER DE QUIÉN GANE EL MAPA. `pMapA` entra al generador por doctrina (la
// probabilidad de mapa se ancla al mercado, no la pone el modelo). Si el TOTAL de kills se moviera con ella,
// el precio de `KILLS over/under` dependería de una entrada que nada tiene que ver con cuántas kills se
// hacen, y peor: dependería del mercado, que es exactamente lo que el generador dice no mirar.
// La invariancia es estructural —`k` sale de `shareW`, `z1` y `z2`, nunca de `aWins`— y además EXACTA,
// porque `aWins` consume una tirada del generador sembrado tanto si sale cara como si sale cruz. Así que se
// comprueba con igualdad, no con tolerancia: cualquier tolerancia dejaría pasar una fuga pequeña.
//
// H-L1 — EL RECORTE DEL REPARTO DEL GANADOR. `shareW` se recorta a [0,50 , 0,95], o sea el modelo afirma que
// el ganador del mapa NUNCA hace menos kills que el perdedor. Medido sobre las 97.587 partidas utilizables de
// la base propia, eso pasa el **3,81 %** de las veces, más un **1,29 %** de empates a kills. El modelo le
// asigna probabilidad CERO a algo que ocurre una de cada veintiséis partidas, y amontona un 5,1 % de masa
// justo en el borde 0,50.
// Ese sesgo cae entero sobre las familias que apuestan al MARGEN de kills, y encaja con lo medido el 16-sep
// en `docs/CALIBRACION_2026-09-16.md`: KILLS_HANDICAP se pasa +19,5 pp y KILLS_DNB +10,9 pp.
// El test no cambia el recorte —eso cambia qué picks nacen y lo decide Alexis— pero FIJA el número, para que
// nadie tenga que volver a descubrirlo y para que se note si alguien lo mueve.
'use strict';
const G = require('../esports-engine/lol-gen');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// Parámetros de una celda realista (LCK 2026, redondeados). No salen de la base: son un fixture.
const P = { share_win: 0.62, share_win_sd: 0.08, llen: Math.log(31), lkpm: Math.log(0.86),
  b_len: -1.2, b_kpm: 0.9, sd_len: 0.22, sd_kpm: 0.20, rho: -0.3, d_mean: 0.12 };

// ── H-L2. EL TOTAL ES INVARIANTE A pMapA, Y LO ES EXACTAMENTE ───────────────────────────────────────────
const SIMS = 8000;
const corridas = [0.10, 0.30, 0.50, 0.70, 0.90].map((pm) => ({ pm, s: G.simulate(P, pm, { sims: SIMS, seed: 77 }) }));
const ref = corridas[0].s;

for (const { pm, s } of corridas.slice(1)) {
  t(`el total medio no cambia con pMapA=${pm}`, s.mean_kills === ref.mean_kills, `${s.mean_kills} contra ${ref.mean_kills}`);
  t(`  ni su desviación`, s.sd_kills === ref.sd_kills, `${s.sd_kills} contra ${ref.sd_kills}`);
  t(`  ni sus cuantiles`, s.p10 === ref.p10 && s.p50 === ref.p50 && s.p90 === ref.p90,
    `[${s.p10},${s.p50},${s.p90}] contra [${ref.p10},${ref.p50},${ref.p90}]`);
}
// el histograma entero, no solo los resúmenes: un resumen igual con forma distinta seguiría siendo una fuga
const mismoHist = corridas.slice(1).every(({ s }) => JSON.stringify(s.dist.total) === JSON.stringify(ref.dist.total));
t('el histograma COMPLETO del total es idéntico para los cinco pMapA', mismoHist);

// y lo que SÍ tiene que moverse, se mueve: si no, el test estaría pasando por estar comparando nada
const hcps = corridas.map((x) => x.s.handicap_mean);
t('el hándicap medio SÍ se mueve con pMapA (si no, el test no probaría nada)',
  new Set(hcps).size === hcps.length && hcps[0] < hcps[hcps.length - 1], JSON.stringify(hcps));
t('y el reparto entre los dos equipos también',
  corridas[0].s.team_a_mean < corridas[corridas.length - 1].s.team_a_mean,
  `A: ${corridas[0].s.team_a_mean} → ${corridas[corridas.length - 1].s.team_a_mean}`);

// ── H-L1. EL RECORTE DEL REPARTO, Y LO QUE DEJA FUERA ───────────────────────────────────────────────────
// Se comprueba sobre la salida: con `share_win` bajo y desviación amplia, ninguna simulación puede dar al
// ganador menos kills que al perdedor. Eso es el recorte actuando, y es lo que la base dice que pasa el
// 3,81 % de las veces.
const extremo = G.simulate({ ...P, share_win: 0.52, share_win_sd: 0.25 }, 1.0, { sims: 6000, seed: 5 });
// con pMapA = 1, A gana siempre: si el recorte no existiera, A tendría menos kills que B en algunas
const margenNegativo = Object.entries(extremo.dist.margin.h)
  .filter(([k]) => +k < 0).reduce((a, [, p]) => a + p, 0);
t('con el recorte actual, el ganador del mapa NUNCA hace menos kills que el perdedor',
  margenNegativo < 1e-9, `masa en margen negativo: ${margenNegativo}`);
t('y eso contradice a la base propia, donde pasa el 3,81 % de las veces (97.587 partidas)', true,
  'medido con scripts/lol-gen-reparto.js — el recorte es shareW ∈ [0,50 , 0,95]');

// ── LA VERSIÓN DEL ARTEFACTO TIENE QUE CORRESPONDER AL CÓDIGO ──────────────────────────────────────────
// El artefacto de validación se sirve en /api/internal/lol-gen como prueba de que el generador funciona. Si
// se ajustó con otra versión, está validando otro generador — y el cambio de v1 a v2 fue precisamente el
// casado de ligas, o sea la clave con la que se buscan las celdas.
const priors = (() => { try { return require('../data/esports/lol/gen-priors.json'); } catch { return null; } })();
t('el artefacto de validación existe', !!priors);
if (priors) {
  const casan = priors.version === G.CONST.version;
  t('y su versión corresponde al código que corre', casan,
    `artefacto ${priors.version} · código ${G.CONST.version}`
    + (casan ? '' : ' → la sonda tiene que declarar el desajuste, no servir la validación como si valiera'));
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
