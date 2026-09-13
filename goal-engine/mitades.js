// goal-engine/mitades.js — LAS MITADES, YA MEDIDAS (13-sep-2026)
//
// POR QUÉ EXISTE. `futbol-derivadas.js` dejaba fuera los mercados por mitades con esta razón, escrita el
// 20-ago: «repartir el gol entre los dos tiempos es una suposición que GP no ha medido, y una familia sin
// estructura medida no se apuesta». La razón era buena. Lo que faltaba no era permiso, era la medición — y
// las mitades son el bloque MÁS GRANDE de inventario que la casa cotiza y nosotros no: de los 43 mercados
// que Cloudbet publica en un partido de fútbol, 14 son de primer o segundo tiempo.
//
// LA MEDICIÓN. football-data.co.uk, 33.364 partidos con marcador al descanso, 18 divisiones, temporadas
// 2021-22 a 2025-26. Tres hechos, y los tres son los que hacen que esto se pueda hacer sin inventar nada:
//
//   1. LA CUOTA DEL PRIMER TIEMPO ES 0,446 Y NO SE MUEVE. Goles 1T 1,199 · goles 2T 1,489 · total 2,688.
//      Entre las 18 divisiones, cuyo total va de 2,371 (España 2ª) a 3,176 (Alemania 1ª), la cuota va de
//      0,431 a 0,463 — y la correlación entre lo goleadora que es una liga y su cuota de 1T es 0,265 con
//      t = 1,1, o sea NINGUNA. Eso es lo que convierte el reparto en una CONSTANTE y no en un parámetro
//      más que ajustar: se multiplica la lambda del partido por 0,446 y se tiene la del primer tiempo.
//
//   2. LAS DOS MITADES SON CASI INDEPENDIENTES. Correlación 1T ↔ 2T = 0,05. Con 33 mil partidos ese 0,05
//      sale «significativo» (t = 9,2), y por eso el t no es el criterio aquí: 0,05 no mueve un precio. La
//      convolución de las dos mitades como independientes vale, y el error que comete se acota abajo.
//
//   3. LA VENTAJA LOCAL ES LA MISMA EN LAS DOS MITADES. Cuota del local 0,556 en el 1T, 0,552 en el 2T,
//      0,554 en el partido. No hace falta un segundo parámetro: el mismo reparto local/visita del partido
//      sirve para cada mitad. Si hubiera salido distinto habría que haber medido dos, y cada parámetro
//      extra es una oportunidad más de ajustar ruido.
//
// LA VALIDACIÓN, QUE ES LO QUE DE VERDAD DECIDE. Medir la estructura no basta: hay que comprobar que la
// probabilidad que sale de aquí acierta. Para cada uno de esos 33 mil partidos se resolvieron λ_local y
// λ_visita del CIERRE real de Pinnacle (1X2 sin vig para el reparto, over/under 2,5 sin vig para el ritmo),
// se derivó la mitad y se comparó contra lo que pasó, por tramos de probabilidad. Como vara de medir se
// usaron DOS familias que ya publicamos —gana el local y más de 2,5 goles—: su peor tramo se desvía 0,034 y
// 0,029, y ese es el suelo de ruido del método. Una familia nueva que se desvíe menos que eso no es peor
// que lo que ya servimos; una que se desvíe más, sí.
//
// EL LISTÓN POR FAMILIA. De ahí sale la regla que gobierna este módulo y que no existía antes: el error de
// calibración medido de cada familia ENTRA en su listón de ventaja. Una familia cuyo modelo se desvía 5pp
// no puede cobrar una ventaja de 3pp — esos 3pp están dentro de su propio error. Se anotan abajo y
// `futbol-derivadas` los suma a su listón base. Es la diferencia entre abrir catorce mercados y abrir
// catorce mercados sabiendo cuál de ellos puede mentir y cuánto.
//
// DIXON-COLES NO SE APLICA A LAS MITADES, Y ESO TAMBIÉN SE MIDIÓ. La corrección τ del motor (ρ = −0,13)
// se ajustó sobre PARTIDOS COMPLETOS. Aplicarla a media lambda era una suposición, así que se probaron las
// tres opciones (ρ = −0,13 · ρ = −0,065 · ρ = 0) sobre las mismas 33 mil mitades:
//
//                       ρ = −0,13        ρ = 0
//     1T empate      0,052 (−0,026)   0,027 (−0,001)
//     2T empate      0,036 (−0,036)   0,009 (−0,006)
//     1T gana local  0,043 (+0,011)   0,027 (−0,001)
//
// Con la corrección completa, el empate de mitad se sobrestima entre 2,6 y 3,6 puntos DE FORMA SISTEMÁTICA.
// Un sesgo con signo fijo es mucho peor que una desviación por tramo: fabrica ventaja falsa siempre del
// mismo lado, que es exactamente cómo se generan cientos de picks perdedoras en una sola familia. Sin
// corrección el sesgo cae a ±0,006 en los nueve casos. Hay razón física además de número: τ retoca las
// celdas 0-0, 1-0, 0-1 y 1-1, que en un partido entero son una parte de la masa y en media hora larga son
// casi toda. Así que las mitades van SIN corrección y el partido completo sigue con la del motor.
//
// LO QUE SIGUE FUERA, A PROPÓSITO: los mercados de MOMENTO del gol (en qué intervalo de 10 minutos cae) y
// los de ORDEN (quién marca el primero, el último córner). Esos sí necesitan estructura dentro de la mitad
// —una tasa que cambia con el minuto y con el marcador— y eso no está medido. La misma regla de siempre.
'use strict';

const dist = require('./distribution');

// ── LA CONSTANTE ────────────────────────────────────────────────────────────────────────────────────────
// Congelada con su procedencia. Si algún día se remide, se cambia aquí y se anota la fecha: una constante
// sin fecha ni muestra es una opinión con aspecto de número.
const CUOTA_1T = 0.446;
const MEDICION = {
  fuente: 'football-data.co.uk',
  partidos: 33364,
  divisiones: 18,
  temporadas: '2021-22 … 2025-26',
  medido_at: '2026-09-13',
  goles_1t: 1.199, goles_2t: 1.489, goles_total: 2.688,
  cuota_1t: CUOTA_1T,
  cuota_1t_rango_entre_ligas: [0.431, 0.463],
  corr_total_liga_vs_cuota: 0.265, t_de_esa_corr: 1.1,
  corr_1t_2t: 0.05,
  cuota_local_1t: 0.556, cuota_local_2t: 0.552, cuota_local_ft: 0.554,
};

// ── EL ERROR DE CALIBRACIÓN MEDIDO, POR FAMILIA ─────────────────────────────────────────────────────────
// Peor desviación por tramo de probabilidad contra 33.335 partidos con λ resuelta del cierre. El suelo de
// ruido del método son las dos familias de control que YA publicamos: 0,034 y 0,029.
// Cada número de abajo es el PEOR tramo de esa familia entre todos los casos que se midieron de ella; el
// detalle caso a caso está en la sonda. Nada aquí se estimó ni se heredó: lo que no se midió, no está.
const CONTROL = { gana_local: 0.034, mas_2_5: 0.029 };
const SUELO_METODO = 0.034;
const ERROR_CAL = {
  // mitades (sin corrección Dixon-Coles)
  h1_total: 0.058,          // manda 1T +1,5 ; (+0,5 → 0,028 · +2,5 → 0,022)
  h1_1x2: 0.036,            // manda 1T gana el visitante ; (local → 0,027 · empate → 0,027)
  h1_btts: 0.008,
  h1_team_total: 0.044,     // manda 1T visitante +0,5
  h1_double_chance: 0.036,
  h1_draw_no_bet: 0.025,    // medido SOLO sobre los partidos que resuelven (sin empate al descanso)
  h1_ah: 0.027,
  h2_total: 0.039,          // manda 2T +2,5 ; (+0,5 → 0,012 · +1,5 → 0,012)
  h2_1x2: 0.022,
  h2_team_total: 0.032,
  h2_ah: 0.022,
  htft: 0.047,              // manda la celda visitante-visitante: el modelo no ve las remontadas
  // familias del partido completo que el motor ya calculaba y no leíamos (matriz con Dixon-Coles)
  exact_score: 0.023,       // manda 1-0 ; (1-1 → 0,016 · 0-0 → 0,015 · 2-1 → 0,007)
  clean_sheet: 0.045,       // manda la portería a cero del VISITANTE
  win_to_nil: 0.034,
  // ya abierta en v1; se anota para que la tabla la juzgue con la misma vara que a las nuevas
  btts: 0.009,
};
// El listón de una familia: su propio error más el listón base. Una familia que se desvía 5pp no puede
// cobrar una ventaja de 3pp, porque esos 3pp caben enteros dentro de su error.
function listonDe(familia, base = 0.03) {
  const e = ERROR_CAL[familia];
  return e == null ? base + SUELO_METODO : +(base + e).toFixed(4);
}

// ── LAS MATRICES DE CADA MITAD ──────────────────────────────────────────────────────────────────────────
// Poisson puro (ρ=0, ver arriba) con el MISMO `poissonPmf` del motor. Se reutiliza la función del motor a
// propósito: la única diferencia con `buildMatrix` es la τ que aquí no se aplica, y dejarlo explícito es
// mejor que una constante suelta que alguien cambie en un sitio y no en el otro.
const RHO_MITAD = 0;
function matrizMitad(lh, la, { n = 10 } = {}) {
  const PH = [], PA = [];
  for (let k = 0; k <= n; k++) { PH.push(dist.poissonPmf(lh, k)); PA.push(dist.poissonPmf(la, k)); }
  const M = []; let T = 0;
  for (let h = 0; h <= n; h++) { M[h] = []; for (let a = 0; a <= n; a++) { const p = PH[h] * PA[a]; M[h][a] = p; T += p; } }
  return T > 0 ? M.map((f) => f.map((p) => p / T)) : M;
}
function matrices(lh, la) {
  if (!(lh > 0) || !(la > 0)) return null;
  return {
    h1: matrizMitad(lh * CUOTA_1T, la * CUOTA_1T),
    h2: matrizMitad(lh * (1 - CUOTA_1T), la * (1 - CUOTA_1T)),
  };
}

const r6 = (x) => +Number(x).toFixed(6);
const pGana = (m) => { let s = 0; for (let h = 0; h < m.length; h++) for (let a = 0; a < h; a++) s += m[h][a]; return s; };
const pPierde = (m) => { let s = 0; for (let a = 0; a < m.length; a++) for (let h = 0; h < a; h++) s += m[h][a]; return s; };
const pIguala = (m) => { let s = 0; for (let h = 0; h < m.length; h++) s += m[h][h]; return s; };
const pOver = (m, L) => { let s = 0; for (let h = 0; h < m.length; h++) for (let a = 0; a < m.length; a++) if (h + a > L) s += m[h][a]; return s; };
const pEquipoOver = (m, lado, L) => { let s = 0;
  for (let h = 0; h < m.length; h++) for (let a = 0; a < m.length; a++) if ((lado === 'home' ? h : a) > L) s += m[h][a]; return s; };
const pAmbos = (m) => { let s = 0; for (let h = 1; h < m.length; h++) for (let a = 1; a < m.length; a++) s += m[h][a]; return s; };

// ── HÁNDICAP ASIÁTICO DE MITAD ──────────────────────────────────────────────────────────────────────────
// Se reutiliza la mecánica del partido: la probabilidad JUSTA de una línea entera descuenta la devolución
// (es condicional a que no haya push), porque solo así se puede comparar con un precio que devuelve. Si se
// comparara la probabilidad cruda contra ese precio, toda línea entera parecería ventaja.
function margenDist(m) {
  const D = {};
  for (let h = 0; h < m.length; h++) for (let a = 0; a < m.length; a++) { const d = h - a; D[d] = (D[d] || 0) + m[h][a]; }
  return D;
}
// La distribución de una magnitud entera (el total de la mitad, o los goles de un equipo en ella).
function conteoDist(m, que /* 'total' | 'home' | 'away' */) {
  const D = {};
  for (let h = 0; h < m.length; h++) for (let a = 0; a < m.length; a++) {
    const v = que === 'total' ? h + a : (que === 'home' ? h : a);
    D[v] = (D[v] || 0) + m[h][a];
  }
  return D;
}
// La probabilidad JUSTA de un over/under. Misma disciplina que el hándicap: una línea entera DEVUELVE
// cuando el total la iguala, así que su probabilidad justa es condicional a que no haya devolución; una de
// cuarto es el promedio de sus dos medias. Comparar la probabilidad cruda de una entera contra un precio
// que devuelve haría parecer ventaja a todas las líneas enteras del catálogo.
function totalJusto(D, linea, lado /* 'over' | 'under' */) {
  if (Math.abs(linea * 2 - Math.round(linea * 2)) > 1e-9) {
    const lo = Math.floor(linea * 2) / 2, hi = lo + 0.5;
    return (totalJusto(D, lo, lado) + totalJusto(D, hi, lado)) / 2;
  }
  let over = 0, under = 0, push = 0;
  for (const [k, p] of Object.entries(D)) {
    const v = Number(k);
    if (v > linea + 1e-9) over += p; else if (v < linea - 1e-9) under += p; else push += p;
  }
  const den = 1 - push;
  const num = lado === 'over' ? over : under;
  return den > 1e-12 ? num / den : num;
}
function ahJusto(D, lado, linea) {
  let gana = 0, pierde = 0, push = 0;
  for (const [k, p] of Object.entries(D)) {
    const d = Number(k), m = (lado === 'home' ? d : -d) + linea;
    if (m > 1e-9) gana += p; else if (m < -1e-9) pierde += p; else push += p;
  }
  const q = Math.abs(linea * 2 - Math.round(linea * 2)) > 1e-9;   // cuarto de línea
  if (q) {
    const lo = Math.floor(linea * 2) / 2, hi = lo + 0.5;
    const a = ahJusto(D, lado, lo), b = ahJusto(D, lado, hi);
    return (a + b) / 2;
  }
  const den = 1 - push;
  return den > 1e-12 ? gana / den : gana;
}

// ── LAS LÍNEAS QUE LA CASA COTIZA DE VERDAD ─────────────────────────────────────────────────────────────
// Medido sobre 29 partidos de Cloudbet: en las mitades NO cotiza solo medias. Cotiza CUARTOS (total=1.25,
// handicap=0.25) y ENTERAS (total=1, handicap=0). Emitir solo las medias habría dejado fuera la mayoría del
// inventario y —peor— habría comparado una línea entera contra una probabilidad que no descuenta la
// devolución, lo que hace parecer ventaja a todas las enteras.
const cuartos = (de, a) => { const o = []; for (let l = de; l <= a + 1e-9; l += 0.25) o.push(+l.toFixed(2)); return o; };
const LINEAS_TOTAL_1T = cuartos(0.25, 3);
const LINEAS_TOTAL_2T = cuartos(0.25, 4);
// El alcance se fijó MIRANDO lo que cotiza la casa, no a ojo: con el catálogo cortado en 2 se quedaban sin
// valorar totales de equipo de 2,5 y 3,5 y hándicaps de 2,25 y 2,5 que Cloudbet sí publica. Un mercado
// cotizado que el modelo no sabe valorar no es un fallo visible — simplemente no aparece nunca.
const LINEAS_EQUIPO = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];
const LINEAS_AH = cuartos(-3, 3);
// SIEMPRE con parte decimal, igual que `lineId` del partido: el liquidador exige `1_0`, no `1`. Un id sin
// parte decimal no lo reconoce y la pick se queda colgada como 'unknown' sin que nadie se entere.
const tagLinea = (l) => { const s = String(l); return (s.includes('.') ? s : s + '.0').replace('.', '_'); };
const tagAh = (l) => { const a = String(Math.abs(l)); return (l < 0 ? 'M' : 'P') + (a.includes('.') ? a.replace('.', '_') : a); };

// ── DESCANSO / FINAL ────────────────────────────────────────────────────────────────────────────────────
// La convolución de las dos mitades como independientes. Medida contra los 33 mil partidos, la peor celda
// (visitante ganando al descanso y al final) se desvía 2,0pp y las demás menos de 0,8pp. El error tiene
// signo conocido: el modelo se queda corto en las remontadas, porque asumir mitades independientes ignora
// que ir perdiendo cambia cómo se juega la segunda parte. Se declara aquí y viaja en el listón.
function descansoFinal(m1, m2, { tope = 7 } = {}) {
  const out = {}; const L = Math.min(tope, m1.length - 1, m2.length - 1);
  for (let h1 = 0; h1 <= L; h1++) for (let a1 = 0; a1 <= L; a1++) {
    const p1 = m1[h1][a1]; if (p1 < 1e-10) continue;
    const ht = h1 > a1 ? 'HOME' : (h1 === a1 ? 'DRAW' : 'AWAY');
    for (let h2 = 0; h2 <= L; h2++) for (let a2 = 0; a2 <= L; a2++) {
      const p = p1 * m2[h2][a2]; if (p < 1e-10) continue;
      const H = h1 + h2, A = a1 + a2;
      const ft = H > A ? 'HOME' : (H === A ? 'DRAW' : 'AWAY');
      const k = `HTFT_${ht}_${ft}`;
      out[k] = (out[k] || 0) + p;
    }
  }
  return out;
}

// ── LA SALIDA ───────────────────────────────────────────────────────────────────────────────────────────
// Mismo shape que `extendedMarkets` del partido completo: { market_id, market_family, probability, line, side }.
// Así `futbol-derivadas` no necesita saber que estas filas vienen de otro sitio.
function mercados(lh, la) {
  const M = matrices(lh, la);
  if (!M) return [];
  const out = [];
  const push = (market_id, market_family, probability, extra) =>
    out.push({ market_id, market_family, probability: r6(probability), ...(extra || {}) });

  for (const [pre, m, lineas] of [['H1', M.h1, LINEAS_TOTAL_1T], ['H2', M.h2, LINEAS_TOTAL_2T]]) {
    const fam = pre.toLowerCase();
    const T = conteoDist(m, 'total');
    for (const l of lineas) {
      push(`${pre}_TOTAL_GOALS_OVER_${tagLinea(l)}`, `${fam}_total`, totalJusto(T, l, 'over'), { line: l, side: 'over' });
      push(`${pre}_TOTAL_GOALS_UNDER_${tagLinea(l)}`, `${fam}_total`, totalJusto(T, l, 'under'), { line: l, side: 'under' });
    }
    push(`${pre}_1X2_HOME`, `${fam}_1x2`, pGana(m), { line: 0, side: 'home' });
    push(`${pre}_1X2_DRAW`, `${fam}_1x2`, pIguala(m), { line: 0, side: 'draw' });
    push(`${pre}_1X2_AWAY`, `${fam}_1x2`, pPierde(m), { line: 0, side: 'away' });
    for (const equipo of ['home', 'away']) {
      const E = conteoDist(m, equipo);
      for (const l of LINEAS_EQUIPO) {
        push(`${pre}_${equipo.toUpperCase()}_TEAM_TOTAL_OVER_${tagLinea(l)}`, `${fam}_team_total`, totalJusto(E, l, 'over'), { line: l, side: 'over', team_scope: equipo });
        push(`${pre}_${equipo.toUpperCase()}_TEAM_TOTAL_UNDER_${tagLinea(l)}`, `${fam}_team_total`, totalJusto(E, l, 'under'), { line: l, side: 'under', team_scope: equipo });
      }
    }
    const D = margenDist(m);
    for (const l of LINEAS_AH) for (const lado of ['home', 'away']) {
      const li = lado === 'home' ? l : -l;
      push(`${pre}_AH_${lado.toUpperCase()}_${tagAh(li)}`, `${fam}_ah`, ahJusto(D, lado, li), { line: li, side: lado });
    }
  }
  // las que solo cotizan en el primer tiempo
  const g = pGana(M.h1), e = pIguala(M.h1), p = pPierde(M.h1);
  push('H1_DOUBLE_CHANCE_HOME_DRAW', 'h1_double_chance', g + e, { line: 0, side: 'home_draw' });
  push('H1_DOUBLE_CHANCE_HOME_AWAY', 'h1_double_chance', g + p, { line: 0, side: 'home_away' });
  push('H1_DOUBLE_CHANCE_DRAW_AWAY', 'h1_double_chance', e + p, { line: 0, side: 'draw_away' });
  const den = g + p;
  push('H1_DRAW_NO_BET_HOME', 'h1_draw_no_bet', den > 1e-12 ? g / den : g, { line: 0, side: 'home' });
  push('H1_DRAW_NO_BET_AWAY', 'h1_draw_no_bet', den > 1e-12 ? p / den : p, { line: 0, side: 'away' });
  const amb = pAmbos(M.h1);
  push('H1_BTTS_YES', 'h1_btts', amb, { line: 0, side: 'yes' });
  push('H1_BTTS_NO', 'h1_btts', 1 - amb, { line: 0, side: 'no' });
  for (const [k, v] of Object.entries(descansoFinal(M.h1, M.h2))) push(k, 'htft', v, { line: 0, side: k.slice(5).toLowerCase() });
  return out;
}

// ── EL VOCABULARIO, EN UN SOLO SITIO ────────────────────────────────────────────────────────────────────
// `idDe` traduce (familia, lado, línea, equipo) al market_id canónico, y `gira` cambia una fila de lado
// cuando el local de la casa es nuestro visitante. Las dos viven aquí y no en el barrido a propósito: si el
// id se construye en un sitio y se gira en otro, tarde o temprano uno de los dos se queda atrás. Y girar
// mal no se nota — una pick invertida paga como ganadora justo cuando pierde.
function idDe(fam, { side, line, team } = {}) {
  const L = (x) => tagLinea(Number(x));
  switch (fam) {
    case 'h1_total': case 'h2_total':
      return `${fam.slice(0, 2).toUpperCase()}_TOTAL_GOALS_${String(side).toUpperCase()}_${L(line)}`;
    case 'h1_1x2': case 'h2_1x2':
      return `${fam.slice(0, 2).toUpperCase()}_1X2_${String(side).toUpperCase()}`;
    case 'h1_ah': case 'h2_ah':
      return `${fam.slice(0, 2).toUpperCase()}_AH_${String(side).toUpperCase()}_${tagAh(Number(line))}`;
    case 'h1_team_total': case 'h2_team_total':
      return `${fam.slice(0, 2).toUpperCase()}_${String(team).toUpperCase()}_TEAM_TOTAL_${String(side).toUpperCase()}_${L(line)}`;
    case 'h1_btts': return `H1_BTTS_${String(side).toUpperCase()}`;
    case 'h1_double_chance': return `H1_DOUBLE_CHANCE_${String(side).toUpperCase()}`;
    case 'h1_draw_no_bet': return `H1_DRAW_NO_BET_${String(side).toUpperCase()}`;
    case 'htft': return `HTFT_${String(side).toUpperCase()}`;
    // las tres del partido completo que el motor ya calculaba y no leíamos
    case 'exact_score': { const m = String(side).match(/^(\d+):(\d+)$/); return m ? `EXACT_SCORE_${m[1]}_${m[2]}` : null; }
    case 'clean_sheet': return `${String(team).toUpperCase()}_CLEAN_SHEET${side === 'no' ? '_NO' : ''}`;
    case 'win_to_nil': return `${String(team).toUpperCase()}_WIN_TO_NIL${side === 'no' ? '_NO' : ''}`;
    default: return null;
  }
}
const OTRO_LADO = { home: 'away', away: 'home', draw: 'draw' };
function gira(f, swapped) {
  if (!swapped) return f;
  const o = { ...f };
  switch (f.fam) {
    case 'h1_total': case 'h2_total': case 'h1_btts':
      return o;                                                  // simétricos: el lado no significa equipo
    case 'h1_1x2': case 'h2_1x2': case 'h1_draw_no_bet':
      o.side = OTRO_LADO[f.side] || f.side; return o;
    case 'h1_ah': case 'h2_ah':
      // La línea de la fila YA viene referida a la selección (el lector convierte el `handicap=X` de la
      // casa, que es el del local de ELLOS, a la línea propia de cada lado). Girar es reetiquetar: el mismo
      // equipo con el mismo hándicap pasa de llamarse "su local" a llamarse "nuestro visitante". La línea
      // NO cambia de signo. Cambiársela además de girar el lado la desplaza dos veces y anota un mercado
      // que no existe — y como sigue siendo una línea válida, nadie lo ve hasta que liquida al revés.
      o.side = OTRO_LADO[f.side] || f.side; return o;
    case 'h1_team_total': case 'h2_team_total': case 'clean_sheet': case 'win_to_nil':
      o.team = OTRO_LADO[f.team] || f.team; return o;
    case 'h1_double_chance': {
      // "local o empate" de ellos es nuestro "empate o visitante"; "local o visitante" no cambia
      o.side = { home_draw: 'draw_away', draw_away: 'home_draw', home_away: 'home_away' }[f.side] || f.side;
      return o;
    }
    case 'htft': {
      const [a, b] = String(f.side).split('_');
      o.side = (OTRO_LADO[a] || a) + '_' + (OTRO_LADO[b] || b); return o;
    }
    case 'exact_score': {
      const m = String(f.side).match(/^(\d+):(\d+)$/);
      if (m) o.side = m[2] + ':' + m[1];                         // 2:1 visto del otro lado es 1:2
      return o;
    }
    default: return o;
  }
}
// ── LAS DEL PARTIDO COMPLETO QUE FALTABAN ───────────────────────────────────────────────────────────────
// El motor ya calcula `HOME_CLEAN_SHEET`, `HOME_WIN_TO_NIL` y los marcadores exactos, pero NO el lado
// contrario de los dos primeros, y sin él no hay par con el que quitarle el margen al precio de la casa.
// Eso no es un detalle cosmético: sin par, la probabilidad del mercado se saca de la cuota cruda, que lleva
// el margen entero dentro — sale más baja de lo que es, nuestra ventaja sale más alta de lo que es, y la
// familia genera picks que parecen buenas justo porque no se midió contra qué. El complemento es 1 − p y
// cuesta cuatro líneas; el error que evita cuesta una muestra entera.
function mercadosFt(matrix) {
  const mk = require('./markets');
  const out = [];
  for (const r of mk.exactScores(matrix)) if (/^EXACT_SCORE_\d+_\d+$/.test(r.market_id)) out.push({ market_id: r.market_id, market_family: 'exact_score', probability: r.probability, line: 0, side: `${r.h}:${r.a}` });
  const combos = mk.comboMarkets(matrix);
  const p = (id) => { const r = combos.find((x) => x.market_id === id); return r ? r.probability : null; };
  for (const id of ['HOME_CLEAN_SHEET', 'AWAY_CLEAN_SHEET', 'HOME_WIN_TO_NIL', 'AWAY_WIN_TO_NIL']) {
    const v = p(id); if (v == null) continue;
    const team = id.startsWith('HOME') ? 'home' : 'away';
    const fam = id.includes('CLEAN_SHEET') ? 'clean_sheet' : 'win_to_nil';
    out.push({ market_id: id, market_family: fam, probability: v, line: 0, side: 'yes', team_scope: team });
    out.push({ market_id: id + '_NO', market_family: fam, probability: r6(1 - v), line: 0, side: 'no', team_scope: team });
  }
  return out;
}
// todas las filas nuevas de un partido: mitades + las del partido completo que no leíamos.
function todas(lh, la) {
  const M = matrices(lh, la);
  return M ? mercados(lh, la).concat(mercadosFt(dist.buildMatrix(lh, la).matrix)) : [];
}

module.exports = { CUOTA_1T, RHO_MITAD, MEDICION, ERROR_CAL, CONTROL, SUELO_METODO, listonDe,
  matrices, matrizMitad, mercados, mercadosFt, todas, descansoFinal, margenDist, conteoDist, ahJusto, totalJusto,
  idDe, gira, tagLinea, tagAh, FAMILIAS: Object.keys(ERROR_CAL) };
