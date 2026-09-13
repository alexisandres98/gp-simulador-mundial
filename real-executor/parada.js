// real-executor/parada.js — LAS CUATRO LÍNEAS DE PARADA DEL DINERO REAL (13-sep-2026)
//
// De dónde viene. Alexis preguntó lo único que de verdad importa cuando llevas semanas perdiendo: "¿qué
// tendría que pasar para que me digas saca el dinero?". Esa pregunta solo vale si se contesta ANTES, con
// números, y no el día que duele — porque ese día siempre hay una razón para esperar una semana más.
//
// La frontera se calculó, no se opinó. Monte Carlo de 60.000 corridas con los parámetros reales del libro
// (stake 30, cuota media 1,81, break-even 55,2 %):
//
//     con ventaja REAL de +7pp        tras 100 apuestas: mediana +367, percentil 1 en −231
//     sin NINGUNA ventaja             tras 100 apuestas: mediana  −13, percentil 5 en −448
//
// O sea: teniendo ventaja de verdad, caer por debajo de −231 en 100 apuestas pasa 1 vez de cada 100. Si
// estamos ahí, la explicación de "mala suerte con ventaja" deja de sostenerse y toca sacar el dinero.
//
// Las cuatro líneas son independientes y basta que salte UNA. Tres miden el edge desde ángulos distintos
// (resultado, precio de mercado, calibración) y la cuarta es de caja. La quinta —el plazo— no se puede
// automatizar porque depende de qué quiere Alexis hacer con su tiempo, y se le recuerda en el correo.
//
// IMPORTANTE: este módulo NO para nada por su cuenta. Mide y avisa. Apagar el ejecutor es una decisión de
// Alexis, y una alarma que además ejecuta es una alarma en la que ya no se puede confiar.
'use strict';

// El núcleo limpio: una apuesta por partido, liga no vetada. Desde el 13-sep es lo único que se coloca, así
// que el contador arranca ahí — mezclarlo con el histórico apilado sería juzgar la regla nueva por los
// errores de la vieja.
const DESDE = Date.parse(process.env.GP_PARADA_DESDE || '2026-09-13T00:00:00Z');

// percentil 1 de una corrida CON ventaja, por tamaño de muestra. Entre puntos se interpola.
const LINEA = [[60, -225], [100, -231], [150, -210], [200, -81], [300, 200]];
function lineaDe(n) {
  if (n < LINEA[0][0]) return null;                       // muestra corta: todavía no se juzga
  for (let i = 1; i < LINEA.length; i++) {
    if (n <= LINEA[i][0]) {
      const [x0, y0] = LINEA[i - 1], [x1, y1] = LINEA[i];
      return y0 + (y1 - y0) * ((n - x0) / (x1 - x0));
    }
  }
  return LINEA[LINEA.length - 1][1];
}

const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function sd(a) { if (a.length < 2) return null; const m = media(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }
function tDe(a) { const m = media(a), s = sd(a); return (m != null && s) ? m / (s / Math.sqrt(a.length)) : null; }
const r2 = (x) => (x == null ? null : +Number(x).toFixed(2));

// ── LÍNEA 1: el núcleo limpio deja de pagar ────────────────────────────────────────────────────────────
function linea1(bets) {
  const g = bets.filter((b) => !b.familia && b.status === 'SETTLED'
    && (b.resultado === 'WIN' || b.resultado === 'LOSS')
    && Date.parse(b.placed_at || b.at || 0) >= DESDE);
  const pnl = g.reduce((a, b) => a + (b.pnl || 0), 0);
  const lim = lineaDe(g.length);
  return { id: 'nucleo', nombre: 'El núcleo limpio deja de pagar', n: g.length, valor: r2(pnl), limite: r2(lim),
    salta: lim != null && pnl < lim,
    lectura: lim == null
      ? `${g.length} apuestas desde el 13-sep; la línea empieza a aplicar en 60 (hoy se acumula, no se juzga)`
      : `${g.length} apuestas, acumulado ${r2(pnl)} USD contra un suelo de ${r2(lim)} (percentil 1 teniendo ventaja real)` };
}

// ── LÍNEA 2: la ventaja sobre el mercado se apaga ──────────────────────────────────────────────────────
// El rodante de 100 picks del motor contra `market_prob` (la probabilidad del mercado ya sin margen). Es la
// medida más directa de "¿sabemos algo que el mercado no sepa?". Salta con DOS lecturas seguidas en cero o
// por debajo, para que una semana mala no la dispare.
function linea2(picks, memoria) {
  const g = (picks || []).filter((p) => p.family === 'CARDS' && p.side === 'under'
    && (p.result_code === 'WIN' || p.result_code === 'LOSS') && p.market_prob > 0)
    .sort((a, b) => Date.parse(a.settled_at || a.created_at || 0) - Date.parse(b.settled_at || b.created_at || 0));
  const ex = g.map((p) => (p.result_code === 'WIN' ? 1 : 0) - p.market_prob);
  const ult = ex.slice(-100);
  const val = ult.length >= 60 ? media(ult) : null;
  const prev = (memoria && memoria.linea2_previa != null) ? memoria.linea2_previa : null;
  return { id: 'mercado', nombre: 'La ventaja sobre el mercado se apaga', n: ult.length, valor: r2(val),
    limite: 0, previa: r2(prev), t: r2(tDe(ult)),
    salta: val != null && val <= 0 && prev != null && prev <= 0,
    lectura: val == null ? `solo ${ult.length} picks con precio de mercado; hacen falta 60`
      : `últimas ${ult.length}: ${r2(val)} sobre el mercado (t ${r2(tDe(ult))})${prev != null ? `, lectura anterior ${r2(prev)}` : ''}`,
    _guardar: val };
}

// ── LÍNEA 3: el precio le gana al modelo ───────────────────────────────────────────────────────────────
// Brier pareado: ¿acierta más nuestra probabilidad o la que implica el precio? Si el precio gana de forma
// significativa, el mercado sabe más que nosotros sobre nuestras propias picks y no hay nada que discutir.
function linea3(picks) {
  const g = (picks || []).filter((p) => p.family === 'CARDS' && p.side === 'under'
    && (p.result_code === 'WIN' || p.result_code === 'LOSS') && p.best_odds > 1 && p.model_prob > 0 && p.model_prob < 1);
  const d = g.map((p) => { const y = p.result_code === 'WIN' ? 1 : 0; return (1 / p.best_odds - y) ** 2 - (p.model_prob - y) ** 2; });
  const t = d.length >= 100 ? tDe(d) : null;
  return { id: 'calibracion', nombre: 'El precio le gana al modelo', n: d.length, valor: r2(t), limite: -2,
    salta: t != null && t <= -2,
    lectura: t == null ? `${d.length} liquidadas con probabilidad de modelo; hacen falta 100`
      : `t ${r2(t)} en el test directo (positivo = el modelo acierta más que el precio)` };
}

// ── LÍNEA 4: la caja ───────────────────────────────────────────────────────────────────────────────────
function linea4(saldo) {
  const s = saldo && saldo.amount != null ? Number(saldo.amount) : null;
  const lim = Number(process.env.GP_PARADA_SALDO || 100);
  return { id: 'caja', nombre: 'El saldo baja del suelo', n: null, valor: r2(s), limite: lim,
    salta: s != null && s < lim,
    lectura: s == null ? 'sin lectura de saldo' : `${r2(s)} USDT contra un suelo de ${lim}` };
}

// El informe completo. `memoria` es un objeto persistido por el llamador (para la lectura anterior de la
// línea 2 y para no repetir el correo); se devuelve mutado con lo que hay que guardar.
function evaluar({ bets = [], picks = [], saldo = null, memoria = {} } = {}) {
  const l2 = linea2(picks, memoria);
  const lineas = [linea1(bets), l2, linea3(picks), linea4(saldo)];
  const saltan = lineas.filter((x) => x.salta);
  const estado = saltan.length ? 'FUERA' : (lineas.some((x) => x.valor != null && x.limite != null && cerca(x)) ? 'VIGILAR' : 'VERDE');
  memoria.linea2_previa = l2._guardar;
  delete l2._guardar;
  return {
    at: new Date().toISOString(), estado, desde: new Date(DESDE).toISOString(),
    saltan: saltan.map((x) => x.id), lineas,
    plazo: { nombre: 'El plazo', limite: '2026-10-15',
      lectura: 'si el núcleo limpio no llega a 100 liquidadas para el 15-oct, el problema no es perder: es que no se puede aprender lo bastante rápido para que esto valga el tiempo. Esa lectura la hace Alexis, no el código.' },
    nota: 'este módulo mide y avisa; NO apaga nada. Apagar el ejecutor es una decisión de Alexis.',
  };
}
// "cerca" = a menos de un 25 % del límite, para pintar VIGILAR antes de que salte
function cerca(x) {
  if (x.limite == null || x.valor == null) return false;
  if (x.id === 'nucleo') return x.n >= 60 && x.valor < x.limite * 0.75;
  if (x.id === 'mercado') return x.n >= 60 && x.valor <= 0.02;
  if (x.id === 'calibracion') return x.n >= 100 && x.valor <= -1.5;
  if (x.id === 'caja') return x.valor < x.limite * 1.5;
  return false;
}

module.exports = { evaluar, linea1, linea2, linea3, linea4, lineaDe, DESDE };
