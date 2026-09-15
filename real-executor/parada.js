// real-executor/parada.js — LAS LÍNEAS DE PARADA DEL DINERO REAL (13-sep-2026, reescrito el 15-sep)
//
// De dónde viene. Alexis preguntó lo único que de verdad importa cuando llevas semanas perdiendo: "¿qué
// tendría que pasar para que me digas saca el dinero?". Esa pregunta solo vale si se contesta ANTES, con
// números, y no el día que duele — porque ese día siempre hay una razón para esperar una semana más.
//
// La frontera se calculó, no se opinó. Monte Carlo de 60.000 corridas con los parámetros reales del libro
// (cuota media 1,81, break-even 55,2 %):
//
//     con ventaja REAL de +7pp        tras 100 apuestas: mediana +12,2 u, percentil 1 en −7,69 u
//     sin NINGUNA ventaja             tras 100 apuestas: mediana  −0,4 u, percentil 5 en −14,9 u
//
// Teniendo ventaja de verdad, caer por debajo de −7,69 unidades de stake en 100 apuestas pasa 1 vez de
// cada 100. Si estamos ahí, la explicación de "mala suerte con ventaja" deja de sostenerse.
//
// ══ LAS TRES CORRECCIONES DEL 15-SEP (auditoría externa, hallazgo A07) ═════════════════════════════════
//
// 1. EL SUELO ESTABA EN DÓLARES DE UN STAKE QUE YA NO ES EL ÚNICO. Se calculó con stake 30 y se guardó como
//    −231 USD. Con stake 40 ese mismo suelo son −5,775 unidades en vez de −7,69: se vuelve MÁS ESTRICTO, no
//    más laxo. Y con el canal de tenis de mesa a 5 USD no significaba nada. Ahora el suelo vive en UNIDADES
//    DE STAKE y cada canal lo convierte con el suyo. (Nuestro propio dossier decía que pasar de 30 a 40 lo
//    hacía más laxo: estaba al revés, y la auditoría lo corrigió.)
//
// 2. SOLO MIRABA TARJETAS. La línea 1 filtraba por "sin familia", que es como se guardan las filas de
//    tarjetas. Tenis de mesa tiene dinero real desde el 9-sep y CS2 puede encenderse: ninguno de los dos
//    tenía línea de parada. Ahora se evalúa POR CANAL, cada uno con su stake, su muestra y su suelo.
//
// 3. LAS LÍNEAS 2 Y 3 MEDÍAN PICKS, NO APUESTAS. El rodante de ventaja y el Brier pareado se calculaban
//    sobre las picks publicadas de la sombra, que incluyen las que nunca se colocaron. Lo que protege el
//    dinero tiene que medirse sobre el dinero: ahora se calculan sobre las filas COLOCADAS del libro real,
//    con la probabilidad de mercado deducida de la ventaja que la propia fila guardó.
//
// ══ Y AHORA SÍ BLOQUEA (decisión de Alexis del 15-sep) ═════════════════════════════════════════════════
// Hasta hoy este módulo medía y avisaba, por una razón buena: una alarma que además ejecuta es una alarma
// en la que ya no se confía. La auditoría señaló el otro lado: una condición de parada que no para no es un
// control, es una etiqueta. El acuerdo es bloquear SOLO ÓRDENES NUEVAS del canal afectado —las apuestas ya
// colocadas siguen su curso y se liquidan con normalidad— dejando el registro y el correo. `GP_PARADA_BLOQUEA=off`
// levanta el bloqueo sin desplegar, para que la decisión siga siendo de Alexis y no del código.
'use strict';

// El núcleo limpio: una apuesta por partido, liga no vetada. Desde el 13-sep es lo único que se coloca, así
// que el contador arranca ahí — mezclarlo con el histórico apilado sería juzgar la regla nueva por los
// errores de la vieja.
const DESDE = Date.parse(process.env.GP_PARADA_DESDE || '2026-09-13T00:00:00Z');

// Percentil 1 de una corrida CON ventaja, EN UNIDADES DE STAKE, por tamaño de muestra. Entre puntos se
// interpola. Salen del mismo Monte Carlo del 13-sep dividido por el stake de entonces (30).
const LINEA_UNIDADES = [[60, -7.50], [100, -7.69], [150, -7.00], [200, -2.70], [300, 6.67]];
function lineaDe(n, stake = 30) {
  if (!(stake > 0)) return null;
  if (n < LINEA_UNIDADES[0][0]) return null;              // muestra corta: todavía no se juzga
  let u = LINEA_UNIDADES[LINEA_UNIDADES.length - 1][1];
  for (let i = 1; i < LINEA_UNIDADES.length; i++) {
    if (n <= LINEA_UNIDADES[i][0]) {
      const [x0, y0] = LINEA_UNIDADES[i - 1], [x1, y1] = LINEA_UNIDADES[i];
      u = y0 + (y1 - y0) * ((n - x0) / (x1 - x0));
      break;
    }
  }
  return u * stake;
}

const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function sd(a) { if (a.length < 2) return null; const m = media(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }
// UNA MUESTRA SIN DISPERSIÓN NO TIENE ESTADÍSTICO (15-sep). Si todas las diferencias son iguales, la
// desviación típica es cero salvo por el error de coma flotante, y dividir por ella daba t de 10^15: una
// línea de parada saltaba por un artefacto aritmético. Sin dispersión no hay incertidumbre que estimar y
// el estadístico no existe: se devuelve null y el llamador lo trata como "todavía no se sabe".
function tDe(a) {
  const m = media(a), s = sd(a);
  if (m == null || s == null || !Number.isFinite(s)) return null;
  const escala = Math.max(Math.abs(m), 1e-12);
  if (s <= escala * 1e-9) return null;
  return m / (s / Math.sqrt(a.length));
}
const r2 = (x) => (x == null ? null : +Number(x).toFixed(2));
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };

// ── LOS CANALES CON DINERO, cada uno con su stake servido ───────────────────────────────────────────────
// La familia de tarjetas se guarda sin `familia` en el libro por razones históricas; los otros dos la traen.
function canales() {
  return [
    { id: 'cards', nombre: 'tarjetas under', esMia: (b) => !b.familia, stake: num('GP_REAL_STAKE_FLAT', 30) },
    { id: 'tt', nombre: 'tenis de mesa, total de puntos', esMia: (b) => b.familia === 'TT_POINTS', stake: num('GP_REAL_TT_STAKE', 5) },
    { id: 'cs2', nombre: 'CS2 rondas', esMia: (b) => b.familia === 'CS2', stake: num('GP_REAL_CS2_STAKE', 5) },
  ];
}
const liquidadas = (bets, c) => (bets || []).filter((b) => c.esMia(b) && b.status === 'SETTLED'
  && (b.resultado === 'WIN' || b.resultado === 'LOSS') && Date.parse(b.placed_at || b.at || 0) >= DESDE)
  .sort((a, b) => Date.parse(a.settled_at || a.placed_at || 0) - Date.parse(b.settled_at || b.placed_at || 0));

// ── LÍNEA 1: el canal deja de pagar ─────────────────────────────────────────────────────────────────────
function linea1(bets, c) {
  const g = liquidadas(bets, c);
  const pnl = g.reduce((a, b) => a + (b.pnl || 0), 0);
  const lim = lineaDe(g.length, c.stake);
  return { id: 'nucleo', canal: c.id, nombre: `El canal deja de pagar · ${c.nombre}`, n: g.length,
    valor: r2(pnl), limite: r2(lim), stake: c.stake,
    salta: lim != null && pnl < lim,
    lectura: lim == null
      ? `${g.length} apuestas desde el 13-sep; la línea empieza a aplicar en 60 (hoy se acumula, no se juzga)`
      : `${g.length} apuestas, acumulado ${r2(pnl)} USD contra un suelo de ${r2(lim)} (percentil 1 teniendo ventaja real, a stake ${c.stake})` };
}

// ── LÍNEA 2: la ventaja sobre el mercado se apaga ───────────────────────────────────────────────────────
// Rodante de 100 APUESTAS COLOCADAS contra la probabilidad del mercado. La fila del libro no guarda esa
// probabilidad, pero sí la ventaja con la que nació (`edge_pp` = modelo − mercado), así que el mercado se
// recupera restando. Salta con DOS lecturas seguidas en cero o por debajo, para que una semana mala no la
// dispare sola.
function linea2(bets, c, memoria) {
  const g = liquidadas(bets, c).filter((b) => b.model_prob > 0 && b.model_prob < 1 && Number.isFinite(b.edge_pp));
  const ex = g.map((b) => (b.resultado === 'WIN' ? 1 : 0) - (b.model_prob - b.edge_pp / 100));
  const ult = ex.slice(-100);
  const val = ult.length >= 60 ? media(ult) : null;
  const clave = 'linea2_previa_' + c.id;
  const prev = (memoria && memoria[clave] != null) ? memoria[clave] : null;
  return { id: 'mercado', canal: c.id, nombre: `La ventaja sobre el mercado se apaga · ${c.nombre}`,
    n: ult.length, valor: r2(val), limite: 0, previa: r2(prev), t: r2(tDe(ult)),
    salta: val != null && val <= 0 && prev != null && prev <= 0,
    lectura: val == null ? `solo ${ult.length} apuestas colocadas con ventaja anotada; hacen falta 60`
      : `últimas ${ult.length} colocadas: ${r2(val)} sobre el mercado (t ${r2(tDe(ult))})${prev != null ? `, lectura anterior ${r2(prev)}` : ''}`,
    _guardar: val, _clave: clave };
}

// ── LÍNEA 3: el precio le gana al modelo ────────────────────────────────────────────────────────────────
// Brier pareado sobre las apuestas COLOCADAS: ¿acierta más nuestra probabilidad o la que implica el precio
// que de verdad nos dieron? Si el precio gana de forma significativa, el mercado sabe más que nosotros
// sobre nuestras propias apuestas y no hay nada que discutir.
function linea3(bets, c) {
  const g = liquidadas(bets, c).filter((b) => (b.odds_real || b.odds_sombra) > 1 && b.model_prob > 0 && b.model_prob < 1);
  const d = g.map((b) => { const o = b.odds_real || b.odds_sombra; const y = b.resultado === 'WIN' ? 1 : 0;
    return (1 / o - y) ** 2 - (b.model_prob - y) ** 2; });
  const t = d.length >= 100 ? tDe(d) : null;
  return { id: 'calibracion', canal: c.id, nombre: `El precio le gana al modelo · ${c.nombre}`, n: d.length,
    valor: r2(t), limite: -2, salta: t != null && t <= -2,
    lectura: t == null ? `${d.length} colocadas y liquidadas con probabilidad de modelo; hacen falta 100`
      : `t ${r2(t)} en el test directo (positivo = el modelo acierta más que el precio)` };
}

// ── LÍNEA 4: la caja ────────────────────────────────────────────────────────────────────────────────────
// Es de cartera, no de canal: el saldo es uno solo y si baja del suelo se para todo.
function linea4(saldo) {
  const s = saldo && saldo.amount != null ? Number(saldo.amount) : null;
  const lim = Number(process.env.GP_PARADA_SALDO || 100);
  return { id: 'caja', canal: null, nombre: 'El saldo baja del suelo', n: null, valor: r2(s), limite: lim,
    salta: s != null && s < lim,
    lectura: s == null ? 'sin lectura de saldo' : `${r2(s)} USDT contra un suelo de ${lim}` };
}

// ── EL BLOQUEO ──────────────────────────────────────────────────────────────────────────────────────────
// El llamador persiste el resultado de `evaluar` en el libro (`L.parada`). `frenos()` pregunta aquí antes de
// dejar salir una orden nueva. Se bloquea el canal que saltó, y la caja bloquea todos.
function bloqueaOn() { return !/^(0|false|no|off)$/i.test(String(process.env.GP_PARADA_BLOQUEA == null ? 'on' : process.env.GP_PARADA_BLOQUEA).trim()); }
const CANAL_DE_FAMILIA = { CARDS: 'cards', TT_POINTS: 'tt', CS2: 'cs2' };
function bloqueo(estadoGuardado, familia) {
  if (!bloqueaOn() || !estadoGuardado || !Array.isArray(estadoGuardado.lineas)) return null;
  const canal = CANAL_DE_FAMILIA[String(familia || '').toUpperCase()] || null;
  const saltadas = estadoGuardado.lineas.filter((x) => x.salta && (x.canal == null || x.canal === canal));
  if (!saltadas.length) return null;
  const l = saltadas[0];
  return { linea: l.id, canal: l.canal, detalle: `${l.nombre}: ${l.lectura}. Se paran las ÓRDENES NUEVAS de este canal; lo colocado sigue su curso. GP_PARADA_BLOQUEA=off lo levanta.` };
}

// El informe completo. `memoria` es un objeto persistido por el llamador (para la lectura anterior de la
// línea 2 y para no repetir el correo); se devuelve mutado con lo que hay que guardar.
function evaluar({ bets = [], picks = [], saldo = null, memoria = {} } = {}) {
  const lineas = [];
  for (const c of canales()) {
    const l2 = linea2(bets, c, memoria);
    memoria[l2._clave] = l2._guardar;
    delete l2._guardar; delete l2._clave;
    lineas.push(linea1(bets, c), l2, linea3(bets, c));
  }
  lineas.push(linea4(saldo));
  const saltan = lineas.filter((x) => x.salta);
  const estado = saltan.length ? 'FUERA' : (lineas.some((x) => cerca(x)) ? 'VIGILAR' : 'VERDE');
  return {
    at: new Date().toISOString(), estado, desde: new Date(DESDE).toISOString(),
    saltan: saltan.map((x) => x.canal ? `${x.id}:${x.canal}` : x.id), lineas,
    canales: canales().map((c) => ({ id: c.id, nombre: c.nombre, stake: c.stake })),
    bloquea: bloqueaOn(),
    plazo: { nombre: 'El plazo', limite: '2026-10-15',
      lectura: 'si el núcleo limpio no llega a 100 liquidadas para el 15-oct, el problema no es perder: es que no se puede aprender lo bastante rápido para que esto valga el tiempo. Esa lectura la hace Alexis, no el código.' },
    nota: bloqueaOn()
      ? 'una línea que salta PARA LAS ÓRDENES NUEVAS de su canal (la caja las para todas) y manda un correo; lo ya colocado sigue su curso. Apagar del todo sigue siendo decisión de Alexis.'
      : 'GP_PARADA_BLOQUEA=off: este módulo mide y avisa, pero NO está parando nada.',
    aviso_muestra: '100 apuestas son un control operativo de riesgo, no una certificación estadística: a cuota 1,91 el intervalo del ROI con 100 apuestas mide casi 19 puntos de ancho. La evidencia se decide con lib/vara.js, no aquí.',
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

module.exports = { evaluar, linea1, linea2, linea3, linea4, lineaDe, bloqueo, bloqueaOn, canales, DESDE };
