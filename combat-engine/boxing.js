// combat-engine/boxing.js — EL MOTOR DE BOXEO PROPIO (16-ago).
// Secciones 14-18 del blueprint de combate.
//
// POR QUÉ EXISTE ESTE ARCHIVO. Hasta hoy boxeo pedía prestado el motor de MMA, y el préstamo no funciona
// por una razón concreta y no estética: el motor de MMA se alimenta de la estadística granular de ESPN
// (nueve celdas de golpeo, derribos, control, avances). **Para boxeo ese dataset no existe.** `intel.js`
// levantaba `espnstats-boxing.json`, no lo encontraba, y `fightIntel` devolvía `available:false`. O sea:
// boxeo no tenía capa profunda, tenía un hueco. Este archivo es el motor que sí se puede construir con lo
// que de verdad hay.
//
// ── LO QUE HAY, MEDIDO ANTES DE ESCRIBIR UNA LÍNEA (39.158 peleas, 29.839 desde 2010) ────────────────────
// Por pelea: asaltos pactados, asalto y reloj de final, método (KO / TKO / RTD / UD / SD / MD / PTS / TD),
// y quién ganó. Por peleador: alcance, altura, guardia, fecha de nacimiento, divisiones, récord.
// NO hay conteo de golpes. No hay CompuBox. No hay jab conectado por asalto. Cualquier "jab/power split"
// que diga salir de conteos de golpes en este producto sería inventado, y no lo va a ser.
//
// ── LAS TRES MEDICIONES QUE ORDENAN EL DISEÑO ────────────────────────────────────────────────────────────
//
// 1. QUE LA PELEA TERMINE ANTES DEL LÍMITE ES PREDECIBLE, Y BIEN. Prueba fuera de muestra, punto en el
//    tiempo (solo con peleas anteriores, los dos con ≥6 de historial, 4.177 pares): **AUC 0,665**, y la
//    calibración por decil es monótona de punta a punta — 25,7 % de finalización en el decil más bajo,
//    75,3 % en el más alto, sin un solo salto hacia atrás. Esto es el mercado de asaltos. Aquí hay señal.
//
// 2. EL CALENDARIO NO APORTA NADA UNA VEZ QUE SABÉS QUIÉNES PELEAN. AUC 0,497 usando solo los asaltos
//    pactados: exactamente una moneda. La tasa marginal de finalización de un combate a 12 (51,0 %) contra
//    uno a 6 (50,6 %) es casi idéntica porque los pactados a 12 se hacen entre gente durísima. Modelar la
//    duración por el calendario y no por los peleadores es el error clásico, y está medido que es un error.
//
// 3. EL "PODER" DISTINGUE EL CUÁNDO MUCHO MEJOR QUE EL CÓMO. Con qué acierto se anticipa que una
//    finalización sea KO seco y no TKO por acumulación: **AUC 0,549**, apenas por encima del azar. Con qué
//    acierto se anticipa que la finalización llegue temprano (≤R3): **AUC 0,601**, y la correlación entre el
//    asalto medio histórico del finalizador y el asalto real es 0,20. Conclusión que se respeta en todo el
//    archivo: el eje poder/desgaste se publica como un eje de TIEMPO —cuándo se rompe la pelea— y el
//    reparto KO/TKO/RTD se publica marcado como débil, porque lo es.
//
// ── LO QUE SE DESCARTÓ, Y POR QUÉ ────────────────────────────────────────────────────────────────────────
// LA GUARDIA (zurdo contra diestro) NO ENTRA AL MODELO. Es el cruce más citado del boxeo y hay dato de
// guardia para 1.296 de 1.406 peleadores del índice — pero el índice cubre solo a los conocidos: en las
// peleas desde 2018 **los dos peleadores tienen guardia conocida apenas el 19,5 % de las veces**. Una
// dimensión que falta en 4 de cada 5 cruces no puede ser una dimensión del cruce: se muestra como dato
// cuando está, y no toca la probabilidad nunca.
//
// ── CÓMO QUEDÓ, MEDIDO FUERA DE MUESTRA (2.768 peleas de 2017 en adelante, ventana móvil por bloques) ────
//   1. ¿SE ROMPE?     AUC 0,694 · Brier 0,221 contra 0,250 de la tasa base · predice 50,5 % y ocurre 51,1 %
//                     · calibración monótona por decil (24/22 → 82/81), un solo salto hacia atrás.
//   2. ¿CUÁNDO?       asalto medio 5,11 predicho contra 5,30 real · correlación 0,43 · "antes del 4º"
//                     38,6 % predicho contra 34,5 % real (AUC 0,685). Sesgo pequeño hacia lo temprano.
//   3. ¿CÓMO?         KO 16,3/17,1 · TKO 30,0/29,4 · retirada 4,2/4,7 · decisión 47,2/48,9 · empate
//                     2,25/1,77 · dividida o mayoritaria 15,1 % contra 17,8 % de las decisiones.
//   4. ¿QUIÉN GANA?   Brier 0,204 contra 0,250 de la moneda · 67,1 % de acierto · ECE 3,62 pp.
//
// ── UNA MEDICIÓN QUE CONTRADICE LO QUE ESPERÁBAMOS, Y SE DEJA ESCRITA ────────────────────────────────────
// En MMA el motor de fases resultó PEOR que una moneda para el ganador (Brier 0,276 contra 0,250) y ese fue
// el argumento para anclarlo. En BOXEO no pasa eso: este motor tiene habilidad real en el ganador (+0,046
// de Brier sobre la moneda, 67,1 % de acierto, y el archivo no tiene sesgo de lado — f1 gana el 49,3 %).
// Aun así **el ganador va anclado igual**, por dos razones que no son la del motor de MMA:
//   (a) el principio que gobierna el sistema entero está medido en dos deportes: el mercado de ganador es
//       donde se pierde dinero, tenga o no habilidad el modelo. Discriminar no es batir a un cierre;
//   (b) 3 de 8 tramos siguen descalibrados y el ECE es de 3,62 pp: distingue, pero sus números todavía no
//       están lo bastante bien puestos para poner precio.
// Si algún día hay histórico de cuotas de boxeo, esta es la primera hipótesis que merece una prueba real.
//
// ── EL RÉCORD TRUNCADO: LA CORRECCIÓN QUE SE PROBÓ, SE MIDIÓ Y SE TIRÓ (16-ago) ──────────────────────────
// EL HECHO. El histórico se construye recorriendo Wikipedia desde los campeones, así que hay dos clases de
// boxeador: 1.376 con página propia, cuyo récord está COMPLETO (mediana del 100 % de las peleas que declara
// su ficha), y 1.391 que solo aparecen como RIVALES de los anteriores, de los que únicamente tenemos sus
// peleas contra gente notable — o sea, sus peleas más duras. Es la MITAD EXACTA de los perfiles servidos.
//
// EL SESGO ES ENORME Y ESTÁ MEDIDO. Ensayo pareado sobre 740 boxeadores de récord completo a los que se les
// simuló la truncación (quedarse solo con sus peleas contra otros de ficha):
//     rotura propia por asalto      0,0945 → 0,0351   (−62,9 %, t = −37,0)
//     fragilidad propia por asalto  0,0158 → 0,0389   (+145,7 %, t = +17,6)
// Al journeyman lo veíamos solo perdiendo contra campeones y salía como un saco.
//
// Y AQUÍ ESTÁ EL GIRO, QUE ES POR LO QUE NO SE CORRIGE. Partiendo la validación fuera de muestra en dos:
//     los DOS con récord completo   n = 2.354 · AUC 0,685 · Brier 0,224 · desvío  0,0 pp
//     al menos uno TRUNCADO         n =   414 · AUC 0,744 · Brier 0,205 · desvío −4,6 pp
// **Los perfiles truncados predicen MEJOR, no peor.** Tiene sentido: que solo lo conozcamos por sus derrotas
// contra buenos es en sí mismo información — dice que es el lado B, y esas peleas se rompen antes (55,8 %
// contra 50,3 %). El sesgo de la tasa apunta en la dirección que acierta. El desvío de −4,6 pp con n = 414
// es 1,9 errores estándar: no se corrige un subconjunto de 414 peleas a 1,9 sigmas, que es justo la caza de
// subconjuntos que TODO_NEXT prohíbe.
//
// LO QUE SE INTENTÓ Y FALLÓ, escrito para que nadie lo vuelva a intentar sin medirlo:
//   1. AJUSTE POR CALIDAD DEL RIVAL (la descomposición ataque × defensa que sí funciona en baloncesto y en
//      MMA, iterada a punto fijo). Redujo el sesgo de rotura de −62,9 % a −11,4 %, pero **empeoró** el de
//      fragilidad (de −14,4 % que ya conseguía el encogimiento, a +66,5 %) y sobre todo **rompió el nivel**:
//      la simulación pasó a predecir 28,8 % de finalización donde ocurre el 50,3 %. Revertido.
//      Motivo de fondo: el problema no es la calidad del rival, es la SELECCIÓN de qué peleas vemos, y
//      ninguna reponderación por rival arregla una selección.
//   2. SUBIR EL ENCOGIMIENTO (`PRIOR_ROUNDS` de 34 a 60/90/130/190). Empeora en todos los escalones:
//      el sesgo medio absoluto sube de 29,5 % a 32,1 / 33,3 / 34,1 / 34,7 %. El 34 ya estaba cerca del óptimo.
//
// CONCLUSIÓN: no se toca nada. El único hueco real es el de los boxeadores con CERO peleas en el histórico
// (5 de los 6 de la cartelera del 15-ago), y eso no lo arregla ningún modelo: lo arregla más dato.
//
// ── LA ARQUITECTURA, EN UNA FRASE ────────────────────────────────────────────────────────────────────────
// El GANADOR lo ancla el modelo de habilidad (Elo), igual que en MMA. Este motor manda en lo que sabe:
// cuándo se rompe la pelea, por qué vía, y cómo quedan las tarjetas.
//
// PURO: entran peleas y salen perfiles y simulaciones. Sin red, sin disco, sin db.
'use strict';

const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const r3 = (x) => (Number.isFinite(x) ? +x.toFixed(3) : null);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const div = (a, b) => (b > 0 ? a / b : null);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const ROUND_MIN = 3;                                  // el asalto de boxeo son 3 minutos, no 5

// El método tal como lo publica la fuente, traducido a las cinco familias que de verdad se cotizan.
// RTD (retirado en el banquillo) es una familia PROPIA y no un TKO: es la firma del trabajo al cuerpo y del
// desgaste, ocurre SIEMPRE entre asaltos y nunca a mitad de uno. El motor de MMA no tiene dónde ponerla.
function methodOf(f) {
  const d = String((f.method || {}).display || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (d === 'KO') return 'ko';
  if (d === 'TKO') return 'tko';
  if (d === 'RTD') return 'rtd';
  if (d === 'UD' || d === 'PTS' || d === 'DECISION') return 'ud';
  if (d === 'SD') return 'sd';
  if (d === 'MD') return 'md';
  if (d === 'TD') return 'td';
  if (d === 'DQ' || d === 'NC') return 'nc';
  return null;                                        // método desconocido: no cuenta para nada del método
}
const STOPPAGES = new Set(['ko', 'tko', 'rtd']);
const DECISIONS = new Set(['ud', 'sd', 'md', 'td']);

// Asaltos completados por un peleador en una pelea. El reloj de la fuente es tiempo TRANSCURRIDO del
// asalto final, así que un KO a 1:05 del segundo asalto son 1 asalto entero más un tercio.
function roundsBoxed(f) {
  const sched = Number(f.rounds_sched) || 4;
  const end = Math.min(Number(f.end_round) || sched, sched);
  const cl = String(f.end_clock || '').match(/^(\d+):(\d+)/);
  const frac = cl ? Math.min(1, (+cl[1] + (+cl[2]) / 60) / ROUND_MIN) : 1;
  return Math.max(0.2, (end - 1) + frac);
}

// ---- 1) PERFILES (sección 14) ---------------------------------------------------------------------------
// Un recorrido por el histórico, con decaimiento temporal. Todo se acumula en dos mitades —lo que hizo y lo
// que le hicieron— porque sin la segunda no hay mentón, no hay fragilidad y no hay defensa que medir.
function buildProfiles(fights, { now = null, halfLifeDays = 1100, minDate = '2005', index = null } = {}) {
  const t0 = now || Date.now();
  const A = new Map();
  const blank = () => ({
    n: 0, w: 0, wsum: 0, rounds: 0, deepRounds: 0, sched: 0, lastAt: 0, firstAt: 0,
    stopFor: 0, stopAg: 0, koFor: 0, tkoFor: 0, rtdFor: 0, koAg: 0, tkoAg: 0, rtdAg: 0,
    stopRoundSum: 0, stopRoundN: 0, earlyFor: 0, lateFor: 0,
    decWin: 0, decLoss: 0, udWin: 0, closeDec: 0, drawN: 0, dist: 0,
    opps: [],
  });
  const get = (id) => { if (!A.has(id)) A.set(id, blank()); return A.get(id); };
  // la forma empírica del peligro por asalto, por distancia pactada: se mide, no se supone
  const shape = {};

  for (const f of fights) {
    if (!f || !f.completed || !f.f1 || !f.f2) continue;
    if (minDate && String(f.date || '') < minDate) continue;
    const m = methodOf(f);
    if (!m || m === 'nc') continue;                    // sin método utilizable no entra a ningún perfil
    const sched = Number(f.rounds_sched) || 0;
    if (!(sched >= 4)) continue;
    const when = Date.parse(f.date || 0) || 0;
    const rb = roundsBoxed(f);
    const endR = Math.min(Number(f.end_round) || sched, sched);
    const stop = STOPPAGES.has(m);
    const went = endR >= sched && !stop;
    const drew = !f.f1.winner && !f.f2.winner;
    // DECAIMIENTO: la vida media larga (3 años) es a propósito. Un boxeador pelea 2-3 veces al año contra
    // las 3-4 de un peleador de MMA activo, así que la misma vida media dejaría a casi todos sin muestra.
    const w = Math.pow(0.5, Math.max(0, (t0 - when) / 864e5) / halfLifeDays);

    // FORMA DEL PELIGRO POR ASALTO — se acumula por distancia pactada. Cada pelea aporta un "expuesto" a
    // cada asalto que llegó a disputar y un "evento" al asalto donde se rompió.
    const S = shape[sched] || (shape[sched] = { exposed: new Array(sched).fill(0), events: new Array(sched).fill(0), n: 0 });
    S.n++;
    for (let r = 1; r <= endR; r++) S.exposed[r - 1]++;
    if (stop) S.events[endR - 1]++;

    for (const [me, foe] of [[f.f1, f.f2], [f.f2, f.f1]]) {
      const c = get(String(me.id));
      c.n++; c.wsum += w; c.rounds += w * rb; c.sched += w * sched;
      c.deepRounds += w * Math.max(0, Math.min(rb, sched) - 7);   // asaltos disputados del 8º en adelante
      if (when > c.lastAt) c.lastAt = when;
      if (!c.firstAt || when < c.firstAt) c.firstAt = when;
      if (me.winner) c.w += w;
      if (went) c.dist += w;
      if (drew) c.drawN += w;
      if (stop) {
        if (me.winner) {
          c.stopFor += w; c.stopRoundSum += w * endR; c.stopRoundN += w;
          if (m === 'ko') c.koFor += w; else if (m === 'tko') c.tkoFor += w; else c.rtdFor += w;
          if (endR <= 3) c.earlyFor += w; else if (endR >= 7) c.lateFor += w;
        } else if (foe.winner) {
          c.stopAg += w;
          if (m === 'ko') c.koAg += w; else if (m === 'tko') c.tkoAg += w; else c.rtdAg += w;
        }
      } else if (DECISIONS.has(m)) {
        if (me.winner) { c.decWin += w; if (m === 'ud') c.udWin += w; else c.closeDec += w; }
        else if (foe.winner) c.decLoss += w;
        else c.closeDec += w;                          // empate dividido/mayoritario: tarjeta apretada igual
      }
      c.opps.push({ id: String(foe.id), w, sched });
    }
  }

  // la forma se normaliza a media 1 por distancia; el último asalto siempre cae y eso queda en el dato
  const hazardShape = {};
  for (const [sched, S] of Object.entries(shape)) {
    if (S.n < 200) continue;                           // con menos no es una forma, es ruido
    const h = S.exposed.map((e, i) => (e > 0 ? S.events[i] / e : 0));
    const mean = h.reduce((s, x) => s + x, 0) / h.length || 1;
    hazardShape[sched] = h.map((x) => r3(x / mean));
  }

  // EL PELIGRO DE LA LIGA, DE LOS TOTALES Y NO DE UNA MEDIA DE TASAS. Es el ancla de todo el simulador:
  // sin él los multiplicadores se apilan y sale cualquier cosa (la primera versión daba 99,6 % de
  // finalización en un cruce que la realidad pone cerca del 50 %). Medido sobre el propio dataset:
  // 18.204 finalizaciones en 172.765 asaltos → 0,1054 por asalto y pelea, 0,0527 por lado y asalto.
  let tRounds = 0, tFor = 0, tAg = 0;
  for (const c of A.values()) { tRounds += c.rounds; tFor += c.stopFor; tAg += c.stopAg; }
  const league = {
    hazard_side: r4(div(tFor, tRounds)),
    conceded_side: r4(div(tAg, tRounds)),
    rounds: Math.round(tRounds), stoppages: Math.round(tFor),
  };

  const profiles = new Map();
  for (const [id, c] of A) {
    const p = profileOf(id, c, t0, index, league);
    if (p) profiles.set(id, p);
  }
  Object.assign(league, leagueMeans(profiles));
  return { profiles, league, hazardShape, n: profiles.size };
}

// ENCOGIMIENTO EMPÍRICO-BAYESIANO, en asaltos. Un invicto con 30 asaltos y cero derrotas por KO no tiene
// un mentón infinito: tiene poca muestra. Sin esto, Usyk entraba al simulador con fragilidad exactamente
// cero y el cruce se volvía degenerado. PRIOR_ROUNDS es la fuerza del prior medida en asaltos de pelea.
const PRIOR_ROUNDS = 34;
const shrunk = (events, rounds, lg) => r4((events + PRIOR_ROUNDS * (lg || 0.05)) / (rounds + PRIOR_ROUNDS));

function profileOf(id, c, t0, index, league) {
  if (!(c.n >= 3) || !(c.rounds > 2)) return null;
  const meta = (index && index[id]) || {};
  const age = meta.dob ? (t0 - Date.parse(meta.dob)) / 864e5 / 365.25 : null;
  const yrs = c.firstAt ? Math.max(0.5, (c.lastAt - c.firstAt) / 864e5 / 365.25) : null;
  const stopRnd = div(c.stopRoundSum, c.stopRoundN);
  const lgOff = (league && league.hazard_side) || 0.0527;
  const lgDef = (league && league.conceded_side) || 0.0527;
  return {
    id,
    // 14a · OFENSIVA DE ROTURA. La tasa por ASALTO, no por pelea: quien acaba en el 2º de peleas a 12 y
    // quien acaba en el 10º no tienen el mismo peligro aunque los dos "finalicen el 60 %".
    offense: {
      stop_rate: r3(div(c.stopFor, c.wsum)),
      stop_per_round: r4(div(c.stopFor, c.rounds)),
      // la que USA el simulador: la de arriba es la observada, esta es la creíble
      stop_per_round_adj: shrunk(c.stopFor, c.rounds, lgOff),
      ko_share: r3(div(c.koFor, c.stopFor)),           // KO seco dentro de sus finalizaciones (señal DÉBIL)
      tko_share: r3(div(c.tkoFor, c.stopFor)),
      rtd_share: r3(div(c.rtdFor, c.stopFor)),         // la firma del trabajo al cuerpo y el desgaste
      early_share: r3(div(c.earlyFor, c.stopFor)),     // cuánto de su rotura llega en los tres primeros
      late_share: r3(div(c.lateFor, c.stopFor)),
      mean_stop_round: r2(stopRnd),
    },
    // 14b · RESISTENCIA. El mentón como tasa por asalto expuesto, que es lo que un simulador puede usar.
    defense: {
      stopped_rate: r3(div(c.stopAg, c.wsum)),
      stopped_per_round: r4(div(c.stopAg, c.rounds)),
      stopped_per_round_adj: shrunk(c.stopAg, c.rounds, lgDef),
      ko_against_share: r3(div(c.koAg, c.stopAg)),
      rtd_against_share: r3(div(c.rtdAg, c.stopAg)),
      // el mentón se lee sobre la tasa ENCOGIDA: 1 = nadie lo ha tocado nunca con muestra que lo respalde
      chin: r3(clamp01(1 - shrunk(c.stopAg, c.rounds, lgDef) / (lgDef * 2.2))),
    },
    // 14c · LA VÍA DE LOS PUNTOS. Un boxeador que gana por decisión unánime domina tarjetas; uno que las
    // gana divididas vive en el filo. Los dos "ganan por decisión" y no son lo mismo.
    cards: {
      distance_rate: r3(div(c.dist, c.wsum)),
      dec_win_rate: r3(div(c.decWin, c.wsum)),
      ud_share: r3(div(c.udWin, c.decWin)),
      close_rate: r3(div(c.closeDec, c.decWin + c.decLoss + c.closeDec)),
      draw_rate: r3(div(c.drawN, c.wsum)),
    },
    // 14d · AGUAS PROFUNDAS. Asaltos disputados del 8º en adelante: la única forma honesta de decir si
    // alguien ha estado ahí. Un invicto de 18-0 con 60 asaltos en total no ha visto el asalto 11 nunca.
    depth: {
      rounds: r2(c.rounds),
      rounds_per_fight: r2(div(c.rounds, c.wsum)),
      deep_rounds: r2(c.deepRounds),
      deep_share: r3(div(c.deepRounds, c.rounds)),
      mean_sched: r2(div(c.sched, c.wsum)),
    },
    // 14e · CONTEXTO. La actividad y el parón son de las pocas señales de boxeo que están medidas fuera
    // de este producto; entran como contexto del cruce, no como palanca oculta.
    context: {
      age: r2(age), fights_per_year: r2(yrs ? c.n / yrs : null),
      layoff_days: c.lastAt ? Math.round((t0 - c.lastAt) / 864e5) : null,
      reach_in: numFrom(meta.reach_in), height_in: numFrom(meta.height_in),
      stance: normStance(meta.stance),
    },
    win_rate: r3(div(c.w, c.wsum)),
    sample: { fights: c.n, weight: r2(c.wsum), rounds: r2(c.rounds), last_at: c.lastAt || null },
  };
}

// El índice de peleadores trae "193cm" o "6'1\"" según de dónde lo sacó Wikipedia. Una sola función y en
// pulgadas, que es la unidad del resto del cockpit.
// El índice trae la medida en cinco formatos distintos según de dónde la copió Wikipedia: "189cm",
// "1.90 m", "6 ft 3 in", "5 ft 11+1/2 in", "74+1/2 in". La primera versión de esta función devolvía 5
// pulgadas de altura para "5 ft 5 in" —se quedaba con el primer número— y una barra de alcance con eso
// dentro es peor que no dibujar la barra. Todo sale en PULGADAS, que es la unidad del resto del cockpit.
function numFrom(s) {
  if (s == null) return null;
  const t = String(s).replace(/\+(\d+)\/(\d+)/g, (m, a, b) => '.' + Math.round(100 * (+a) / (+b)));
  const cm = t.match(/([\d.]+)\s*cm/i);
  if (cm) return r2(+cm[1] / 2.54);
  const m = t.match(/([\d.]+)\s*m\b/i);
  if (m && +m[1] < 3) return r2(+m[1] * 100 / 2.54);
  const ft = t.match(/([\d.]+)\s*(?:ft|['′])\s*([\d.]+)?/i);
  if (ft) return r2((+ft[1]) * 12 + (+(ft[2] || 0)));
  const n = t.match(/([\d.]+)/);
  return n ? r2(+n[1]) : null;
}
// El índice trae basura pegada del scrape ("orthodox}} muamer hukić (born…"): se toma la primera palabra.
function normStance(s) {
  if (!s) return null;
  const t = String(s).toLowerCase().trim();
  if (t.startsWith('southpaw')) return 'zurdo';
  if (t.startsWith('orthodox')) return 'diestro';
  if (t.startsWith('switch')) return 'ambidiestro';
  return null;
}

function leagueMeans(profiles) {
  const pick = (fn) => {
    const v = [...profiles.values()].map(fn).filter(Number.isFinite);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  return {
    stop_per_round: r4(pick((p) => p.offense.stop_per_round)),
    stopped_per_round: r4(pick((p) => p.defense.stopped_per_round)),
    distance_rate: r3(pick((p) => p.cards.distance_rate)),
    rounds_per_fight: r2(pick((p) => p.depth.rounds_per_fight)),
    n: profiles.size,
  };
}

// ---- 2) EL ADN DE BOXEO (sección 15) --------------------------------------------------------------------
// Ocho ejes en PERCENTIL del propio conjunto, para que se puedan dibujar en el mismo eje y compararse. Son
// los ejes que el boxeo tiene, no los que tendría con CompuBox: dos vías de ganar (puntos y rotura), dos de
// no perder (mentón y fondo), dos de tiempo (arranque y desgaste) y dos de contexto (actividad y nivel).
const AXES = [
  { key: 'points', label: 'Boxeo a los puntos', pick: (p) => p.cards.dec_win_rate },
  { key: 'power', label: 'Rotura', pick: (p) => p.offense.stop_per_round },
  { key: 'chin', label: 'Mentón', pick: (p) => p.defense.chin },
  { key: 'deep', label: 'Aguas profundas', pick: (p) => p.depth.deep_share },
  { key: 'early', label: 'Arranque', pick: (p) => p.offense.early_share },
  { key: 'attrition', label: 'Desgaste', pick: (p) => (p.offense.late_share || 0) + (p.offense.rtd_share || 0) },
  { key: 'activity', label: 'Actividad', pick: (p) => p.context.fights_per_year },
  { key: 'level', label: 'Nivel de cartelera', pick: (p) => p.depth.mean_sched },
];

function pctOf(sorted, x) {
  if (!Number.isFinite(x) || !sorted.length) return null;
  let lo = 0; while (lo < sorted.length && sorted[lo] < x) lo++;
  return lo / sorted.length;
}

function styleVectors(profiles) {
  const dists = {};
  for (const a of AXES) {
    const v = [];
    for (const p of profiles.values()) { const x = a.pick(p); if (Number.isFinite(x)) v.push(x); }
    dists[a.key] = v.sort((x, y) => x - y);
  }
  const out = new Map();
  for (const [id, p] of profiles) {
    const axes = {};
    for (const a of AXES) axes[a.key] = r3(pctOf(dists[a.key], a.pick(p)));
    // 15b · EL EJE JAB / PODER. Se publica como lo que la medición respalda: un eje de CUÁNDO se resuelve
    // la pelea, no un conteo de golpes. 0 = todo se decide en las tarjetas, 1 = todo se decide rompiendo.
    const viaStop = p.offense.stop_rate || 0, viaCards = p.cards.dec_win_rate || 0;
    const split = (viaStop + viaCards) > 0 ? viaStop / (viaStop + viaCards) : 0.5;
    // 15c · INICIATIVA. Quién fuerza: el que rompe y el que no se deja llevar a la distancia. Sale de la
    // mezcla de sus propias peleas, así que es una tendencia observada, no una etiqueta.
    const initiative = r3(clamp01(0.5 + 0.5 * ((p.offense.stop_rate || 0) - (p.cards.distance_rate || 0))));
    const n = p.sample.fights, rds = p.sample.rounds;
    const confidence = r3(clamp01(Math.min(n / 12, rds / 70)));
    out.set(id, {
      id, axes, initiative, confidence,
      power_split: { power: r3(split), points: r3(1 - split),
        source: 'inferido de cómo se resuelven sus peleas — en boxeo no hay conteo de golpes en el dato, y no se finge que lo haya' },
      timing: { early: p.offense.early_share, late: p.offense.late_share, mean_round: p.offense.mean_stop_round },
      sample: { fights: n, rounds: rds },
      archetype: archetypeOf(p, axes, split, confidence),
    });
  }
  return out;
}

// Vocabulario, no aprendizaje automático. Y siempre con la confianza al lado: una etiqueta sin muestra es
// una opinión disfrazada de dato.
function archetypeOf(p, v, split, confidence) {
  const tags = [];
  const hi = (k, t = 0.7) => (v[k] != null && v[k] >= t);
  const lo = (k, t = 0.3) => (v[k] != null && v[k] <= t);
  if (split >= 0.62 && hi('early', 0.6)) tags.push('pegador de arranque');
  else if (split >= 0.62) tags.push('pegador');
  else if (split <= 0.32 && hi('points', 0.6)) tags.push('boxeador de tarjeta');
  else if (split <= 0.4) tags.push('boxeador a los puntos');
  if (hi('attrition', 0.7)) tags.push('rompe por desgaste');
  if ((p.offense.rtd_share || 0) >= 0.25 && (p.offense.stop_rate || 0) >= 0.25) tags.push('trabajo al cuerpo');
  if (hi('chin', 0.75) && hi('deep', 0.6)) tags.push('fondo de campeonato');
  else if (lo('chin', 0.25)) tags.push('mentón vulnerable');
  if (lo('deep', 0.2)) tags.push('sin asaltos profundos');
  if ((p.cards.close_rate || 0) >= 0.4) tags.push('vive en tarjetas apretadas');
  if (hi('activity', 0.75)) tags.push('muy activo');
  if (!tags.length) tags.push('perfil equilibrado');
  return { tags: tags.slice(0, 4), confidence,
    note: confidence < 0.45 ? 'muestra corta: la etiqueta es orientativa' : null };
}

// ---- 3) EL CRUCE (sección 16) ---------------------------------------------------------------------------
// Cada dimensión enfrenta el ATAQUE de uno contra la DEFENSA del otro. Y sobre todo: cada dimensión vive en
// una FASE DE LA PELEA —temprano, medio, profundo— y la probabilidad de que la pelea llegue a esa fase
// pondera la ventaja. Un especialista del asalto 11 contra alguien que se rompe en el 3º tiene una ventaja
// que probablemente no llegue a cobrar, y eso hay que decirlo.
const PHASES = [
  { key: 'temprano', label: 'Asaltos 1-3' },
  { key: 'medio', label: 'Asaltos 4-7' },
  { key: 'profundo', label: 'Asaltos 8-12' },
];

function matchup(pa, pb, va, vb, { rounds = 12 } = {}) {
  if (!pa || !pb) return null;
  const dims = [];
  const push = (key, label, edge, detail, phase) => {
    if (!Number.isFinite(edge)) return;
    dims.push({ key, label, edge: r3(Math.max(-1, Math.min(1, edge))), favors: edge > 0 ? 'a' : 'b', detail, phase });
  };
  const norm = (a, b) => { const s = Math.abs(a) + Math.abs(b); return s > 0 ? (a - b) / s : 0; };
  const pc = (x) => (Number.isFinite(x) ? Math.round(100 * x) + '%' : '—');
  const n1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
  // "cada cuántos asaltos", con techo: por encima de 40 asaltos la cifra deja de significar nada
  const everyN = (rate) => (Number.isFinite(rate) && rate > 0.025 ? (1 / rate).toFixed(1) : '40+');

  // 16a · PODER CONTRA MENTÓN. La dimensión central del boxeo, y la única que puede acabar la noche de
  // golpe. Peligro propio por asalto contra fragilidad ajena por asalto.
  const powA = (pa.offense.stop_per_round_adj || 0) * (1 + 14 * (pb.defense.stopped_per_round_adj || 0));
  const powB = (pb.offense.stop_per_round_adj || 0) * (1 + 14 * (pa.defense.stopped_per_round_adj || 0));
  // EL DETALLE USA LA TASA ENCOGIDA, NO LA OBSERVADA. Con la observada, un invicto al que nunca han parado
  // producía la frase "un mentón que cede cada 10000 asaltos", que es un infinito disfrazado de dato.
  push('power', 'Poder contra mentón', norm(powA, powB),
    `rompe cada ${everyN(pa.offense.stop_per_round_adj)} asaltos contra un mentón que cede cada ${everyN(pb.defense.stopped_per_round_adj)}`, 'temprano');

  // 16b · LA VÍA DE LOS PUNTOS. Dominio de tarjeta contra dominio de tarjeta, penalizado por vivir en
  // decisiones apretadas: ganar tres divididas seguidas no es dominar, es sobrevivir.
  const cardA = (pa.cards.dec_win_rate || 0) * (0.6 + 0.4 * (pa.cards.ud_share || 0.5)) * (1 - 0.4 * (pa.cards.close_rate || 0));
  const cardB = (pb.cards.dec_win_rate || 0) * (0.6 + 0.4 * (pb.cards.ud_share || 0.5)) * (1 - 0.4 * (pb.cards.close_rate || 0));
  // el detalle da la tasa Y su composición: "gana por decisión el 28 % (100 % unánimes)" dice algo; "100 %
  // de sus decisiones son unánimes" sobre dos decisiones no dice nada y era lo que salía antes
  push('cards', 'Dominio de tarjeta', norm(cardA, cardB),
    `gana por decisión el ${pc(pa.cards.dec_win_rate)} de sus peleas (${pc(pa.cards.ud_share)} unánimes) contra ${pc(pb.cards.dec_win_rate)} (${pc(pb.cards.ud_share)})`, 'medio');

  // 16c · AGUAS PROFUNDAS. Quién ha estado del asalto 8 en adelante y con qué mentón llega ahí.
  const deepA = (pa.depth.deep_share || 0) * (0.5 + 0.5 * (pa.defense.chin || 0.5));
  const deepB = (pb.depth.deep_share || 0) * (0.5 + 0.5 * (pb.defense.chin || 0.5));
  push('deep', 'Aguas profundas', norm(deepA, deepB),
    `${n1(pa.depth.deep_rounds)} asaltos disputados del 8º en adelante contra ${n1(pb.depth.deep_rounds)}`, 'profundo');

  // 16d · DESGASTE. Quién rompe tarde y quién se retira en el banquillo. La RTD del rival pesa: retirarse
  // es la evidencia más directa de que el cuerpo cedió antes que la cabeza.
  const attA = ((pa.offense.late_share || 0) + (pa.offense.rtd_share || 0)) * (pa.offense.stop_rate || 0) * (1 + (pb.defense.rtd_against_share || 0));
  const attB = ((pb.offense.late_share || 0) + (pb.offense.rtd_share || 0)) * (pb.offense.stop_rate || 0) * (1 + (pa.defense.rtd_against_share || 0));
  push('attrition', 'Desgaste', norm(attA, attB),
    `${pc(pa.offense.late_share)} de sus roturas llegan del 7º en adelante contra ${pc(pb.offense.late_share)}`, 'profundo');

  // 16e · INICIATIVA. Quién fuerza el ritmo y niega la pelea que el otro quiere.
  push('initiative', 'Iniciativa', norm((va && va.initiative) || 0.5, (vb && vb.initiative) || 0.5),
    'quién impone dónde y a qué ritmo se pelea', 'temprano');

  // 16f · FÍSICO. Solo si los dos tienen medida en el índice. Sin dato no hay fila: una barra a cero es
  // una mentira más cara que un hueco.
  const ra = pa.context.reach_in, rb = pb.context.reach_in;
  if (Number.isFinite(ra) && Number.isFinite(rb) && Math.abs(ra - rb) > 0.4) {
    // TOPE DURO A ±0,5. El alcance es un factor secundario y sin validación propia en nuestro dataset; con
    // el divisor original (÷8) cinco pulgadas ya producían una ventaja de 0,6 y esta fila se comía el cruce.
    // Puede inclinar la lectura, no decidirla.
    push('physical', 'Alcance', Math.max(-0.5, Math.min(0.5, (ra - rb) / 12)),
      `${r2(ra)}" contra ${r2(rb)}"`, 'medio');
  }

  // 16g · DÓNDE VA A VIVIR LA PELEA. La masa de probabilidad por tramo de asaltos, que es lo que pondera
  // todas las ventajas de arriba. Sale del peligro de rotura de los dos contra el mentón del otro.
  const phase_prob = phaseMass(pa, pb, rounds);

  const reach = (d) => phase_prob[d.phase] || 0.33;
  const routeFor = (side) => {
    const mine = dims.filter((d) => (side === 'a' ? d.edge > 0 : d.edge < 0))
      .map((d) => ({ ...d, mag: Math.abs(d.edge), r: reach(d) }))
      .sort((x, y) => (y.mag * y.r) - (x.mag * x.r));
    if (!mine.length) return null;
    const top = mine[0];
    // `phase_prob` es dónde la pelea se DECIDE, no dónde pasa: por los asaltos 1-3 se pasa siempre. El aviso
    // solo tiene sentido cuando la ventaja vive en el tramo profundo de una pelea que rara vez llega ahí.
    return { via: top.label, phase: top.phase, edge: r3(top.mag), phase_prob: r3(top.r),
      expected_value: r3(top.mag * top.r),
      note: (top.phase === 'profundo' && top.r < 0.28)
        ? 'su mejor ventaja vive del 8º asalto en adelante, y esta pelea rara vez llega hasta ahí'
        : (top.r < 0.18 ? 'su mejor ventaja está donde esta pelea casi nunca se decide' : null) };
  };
  const total = dims.reduce((s, d) => s + Math.abs(d.edge) * reach(d), 0);
  const top1 = dims.map((d) => Math.abs(d.edge) * reach(d)).sort((a, b) => b - a)[0] || 0;
  const concentration = total > 0 ? top1 / total : null;

  return {
    dims, phase_prob, phases: PHASES,
    net_edge: r3(dims.reduce((s, d) => s + d.edge * reach(d), 0)),
    routes: { a: routeFor('a'), b: routeFor('b') },
    fragility: {
      concentration: r3(concentration),
      level: concentration == null ? null : concentration > 0.55 ? 'alta' : concentration > 0.38 ? 'media' : 'baja',
      note: concentration == null ? null : concentration > 0.55
        ? 'casi toda la ventaja sale de una sola dimensión: si la pelea no va por ahí, el pronóstico se cae'
        : concentration > 0.38
          ? 'una dimensión pesa bastante más que el resto: el pronóstico aguanta, pero depende de que esa se cumpla'
          : 'la ventaja está repartida en varias dimensiones, así que no depende de un solo escenario',
    },
    summary: summarize(dims, phase_prob, va, vb),
  };
}

// Dónde vive la pelea, en tramos de asaltos. NO sale del calendario —está medido que el calendario solo no
// distingue nada (AUC 0,497)— sino del peligro que los dos generan contra el mentón que los dos tienen.
function phaseMass(pa, pb, rounds) {
  const hz = (p, q) => (p.offense.stop_per_round_adj || 0.05) * 0.5 + (q.defense.stopped_per_round_adj || 0.05) * 0.5;
  const lam = Math.max(0.004, hz(pa, pb) + hz(pb, pa));   // peligro conjunto por asalto
  const surv = (r) => Math.exp(-lam * r);
  const n = Math.max(4, Math.min(12, rounds));
  const early = 1 - surv(Math.min(3, n));
  const mid = surv(Math.min(3, n)) - surv(Math.min(7, n));
  const deep = surv(Math.min(7, n));
  const s = early + mid + deep || 1;
  return { temprano: r3(early / s), medio: r3(mid / s), profundo: r3(deep / s), hazard_per_round: r4(lam) };
}

function summarize(dims, phase, va, vb) {
  const sorted = dims.slice().sort((x, y) =>
    Math.abs(y.edge) * (phase[y.phase] || 0.33) - Math.abs(x.edge) * (phase[x.phase] || 0.33));
  const top = sorted[0];
  if (!top) return null;
  const arqA = va && va.archetype ? va.archetype.tags[0] : null;
  const arqB = vb && vb.archetype ? vb.archetype.tags[0] : null;
  return {
    headline: `${top.label}: ventaja para ${top.edge > 0 ? 'A' : 'B'}`,
    where: `la pelea se decide un ${Math.round(100 * (phase.temprano || 0))}% en los tres primeros asaltos y un ${Math.round(100 * (phase.profundo || 0))}% del 8º en adelante`,
    styles: arqA && arqB ? `${arqA} contra ${arqB}` : null,
  };
}

// ---- 4) EL SIMULADOR DE BOXEO (secciones 17-18) ---------------------------------------------------------
// Aquí está lo que el motor de MMA no puede expresar y por lo que este archivo existe:
//
//   · LA TARJETA DE 10 PUNTOS ES EL ESQUELETO, NO UN POST-PROCESO. Cada asalto reparte 10-9, 10-8 con un
//     derribo, 10-7 con dos. Las tarjetas se acumulan de verdad y el resultado sale de sumarlas, así que el
//     empate y la decisión dividida EMERGEN de la aritmética en vez de venir de una tabla.
//
//   · EL DERRIBO ES UN EVENTO QUE REESCRIBE EL ASALTO (sección 18). No es "un poquito más de probabilidad
//     de KO": cae, y en ese instante (a) el asalto pasa a 10-8 aunque lo fuera perdiendo, (b) el peligro de
//     que la pelea se acabe en lo que resta de ese asalto se multiplica, y (c) el daño acumulado sube y se
//     paga en los asaltos siguientes. Un peleador puede perder 9 asaltos y ganar la pelea con dos derribos.
//
//   · LA RETIRADA EN EL BANQUILLO (RTD) ES SU PROPIA FAMILIA y solo puede ocurrir ENTRE asaltos, del 3º en
//     adelante, y crece con el daño acumulado. Es la firma del trabajo al cuerpo. En MMA no existe.
//
//   · LA INICIATIVA SE DECIDE ASALTO A ASALTO y se arrastra: quien gana el asalto tiende a imponer el
//     siguiente. Es lo que produce rachas de asaltos y no una moneda independiente doce veces.
//
// Determinista con semilla, igual que el simulador de MMA.
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

// Peligros por asalto, ya cruzados. El derribo va aparte de la finalización porque son cosas distintas: se
// puede caer y ganar, y de hecho pasa.
// LA FORMA MULTIPLICATIVA ATAQUE × DEFENSA, no la media de las dos tasas. Es la misma descomposición que ya
// está validada en baloncesto y en el motor de fases de MMA: el peligro que A genera contra B es el peligro
// de la liga, escalado por cuánto rompe A por encima de la media y por cuánto se rompe B por encima de la
// media. Con dos peleadores del montón devuelve exactamente el peligro de la liga — que es la propiedad que
// la media de tasas NO tiene y por la que la primera versión daba 99,6 % de finalización.
//
// KAPPA_FIN es la constante de escala del simulador, y no se elige a ojo: se ajusta contra la tasa REAL de
// finalización fuera de muestra y se deja escrita con su medición (`scripts/boxing-validate.js`, 2.768
// peleas de 2017 en adelante con ventana móvil). Con 0,50 el motor predice 50,5 % de finalización contra
// un 51,1 % real — medio punto de diferencia. La primera versión, con los multiplicadores apilados y sin
// esta escala, predecía 69,7 % contra el mismo 51 %: por eso la constante existe y por eso está medida.
const KAPPA_FIN = 0.50;
// LOS DERRIBOS NO ESTÁN EN EL DATO. Ninguna fuente de boxeo que tengamos cuenta caídas. La razón
// derribo/finalización es por tanto un SUPUESTO declarado, no una medición, y va marcado como tal en la
// salida. Su papel es mecánico —hacer que el 10-8 exista y que una pelea se dé vuelta sin KO— y su nivel
// se eligió para que la proporción de peleas con al menos un derribo caiga en la banda que el boxeo
// profesional muestra públicamente (~35-45 %).
const KD_RATIO = 1.15;

function hazards(pa, pb, mu, league) {
  const lgOff = (league && league.hazard_side) || 0.0527;
  const lgDef = (league && league.conceded_side) || 0.0527;
  const fin = (p, q) => {
    const off = p.offense.stop_per_round_adj != null ? p.offense.stop_per_round_adj : lgOff;
    const def = q.defense.stopped_per_round_adj != null ? q.defense.stopped_per_round_adj : lgDef;
    return Math.max(0.002, KAPPA_FIN * off * (def / lgDef));
  };
  const fa = fin(pa, pb), fb = fin(pb, pa);
  return {
    kd_a: fa * KD_RATIO, kd_b: fb * KD_RATIO,
    fin_a: fa, fin_b: fb,
    league_hazard: r4(lgOff),
    kd_assumption: 'la razón derribo/finalización es un supuesto declarado: no existe conteo de caídas en el dato de boxeo del que dispone GP',
    // reparto de la vía dentro de las finalizaciones de cada uno (señal DÉBIL, medida en AUC 0,549)
    via_a: viaSplit(pa), via_b: viaSplit(pb),
    // cuándo rompen: sesgo temprano/tardío propio, que es la señal que SÍ resistió (AUC 0,601)
    tempo_a: r3((pa.offense.early_share || 0.4) - (pa.offense.late_share || 0.3)),
    tempo_b: r3((pb.offense.early_share || 0.4) - (pb.offense.late_share || 0.3)),
  };
}
function viaSplit(p) {
  const ko = p.offense.ko_share, tko = p.offense.tko_share, rtd = p.offense.rtd_share;
  // sin muestra propia se cae a la mezcla de la liga (medida: KO 32 % · TKO 62 % · RTD 6 % de las roturas)
  if (!Number.isFinite(ko) || !Number.isFinite(tko)) return { ko: 0.32, tko: 0.62, rtd: 0.06 };
  const s = (ko || 0) + (tko || 0) + (rtd || 0) || 1;
  // encogimiento fuerte hacia la liga: la vía es la parte DÉBIL del modelo y no se le deja mandar
  const w = Math.min(0.55, (p.sample.fights || 0) / 30);
  return {
    ko: r3(w * (ko / s) + (1 - w) * 0.32),
    tko: r3(w * (tko / s) + (1 - w) * 0.62),
    rtd: r3(w * ((rtd || 0) / s) + (1 - w) * 0.06),
  };
}

function simulate(pa, pb, {
  rounds = 12, n = 20000, seed = 17, mu = null, va = null, vb = null, priorA = null,
  hazardShape = null, league = null,
} = {}) {
  const M = mu || matchup(pa, pb, va, vb, { rounds });
  if (!M) return null;
  const H = hazards(pa, pb, M, league);
  const shape = (hazardShape && (hazardShape[rounds] || hazardShape[String(rounds)])) || null;
  const base = { rounds, shape };
  // MISMO ANCLAJE QUE EN MMA, Y POR LA MISMA RAZÓN MEDIDA: el ganador lo fija el modelo de habilidad; este
  // motor manda en cuándo se rompe la pelea, por qué vía y cómo quedan las tarjetas.
  const tilt = (priorA != null && priorA > 0.02 && priorA < 0.98) ? solveTilt(pa, pb, M, H, priorA, base) : 0;
  const out = core(pa, pb, M, H, { ...base, n, seed, tilt });
  out.anchor = priorA != null
    ? { prior_a: r4(priorA), tilt: r2(tilt), source: 'modelo de habilidad (Elo)',
      note: 'el ganador viene del modelo de habilidad; el asalto, la vía y las tarjetas salen del motor de boxeo' }
    : { prior_a: null, tilt: 0, source: null,
      note: 'SIN anclar: este motor no tiene término de habilidad latente, así que su ganador no es de fiar por sí solo' };
  out.matchup = M;
  out.uncertainty = uncertainty(out, pa, pb, M);
  return out;
}

function solveTilt(pa, pb, M, H, target, opts) {
  let lo = -3, hi = 3;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const p = core(pa, pb, M, H, { ...opts, n: 1200, seed: 991, tilt: mid }).win.a;
    if (p < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function core(pa, pb, M, H, { rounds = 12, n = 20000, seed = 17, tilt = 0, shape = null } = {}) {
  const rnd = rng(seed);
  const res = {
    a_ko: 0, a_tko: 0, a_rtd: 0, a_ud: 0, a_sd: 0, a_md: 0,
    b_ko: 0, b_tko: 0, b_rtd: 0, b_ud: 0, b_sd: 0, b_md: 0,
    draw: 0, draw_split: 0, dist: 0,
    byRound: Array.from({ length: rounds }, () => ({ a: 0, b: 0 })),
    roundWinsA: new Array(rounds).fill(0), roundsBoxed: [],
    kdA: 0, kdB: 0, kdAny: 0, cardsA: [], cardsB: [], swing: 0,
  };
  // la ventaja estructural del cruce, ya ponderada por dónde vive la pelea
  const structural = M.dims.reduce((s, d) => s + d.edge * (M.phase_prob[d.phase] || 0.33), 0) /
    Math.max(1, M.dims.length) * 3.2;
  const shapeAt = (r) => (shape && shape[r - 1] != null ? shape[r - 1] : 1);

  for (let i = 0; i < n; i++) {
    let dmgA = 0, dmgB = 0, fatA = 0, fatB = 0, momentum = 0, ended = null, endR = 0, endFrac = 1;
    const cards = [0, 0, 0];
    let ptsA = 0, ptsB = 0;                            // la tarjeta literal del primer juez, en puntos
    let kdA = 0, kdB = 0, behindWon = false, aheadOnCards = 0;
    const nightA = gauss(rnd) * 0.18, nightB = gauss(rnd) * 0.18;

    for (let r = 1; r <= rounds && !ended; r++) {
      // FATIGA. Afecta a QUIÉN GANA EL ASALTO, no al nivel del peligro: el perfil temporal del peligro ya
      // viene de `shape`, que es la forma EMPÍRICA medida en el propio dataset (por eso las peleas a 12
      // arrancan flojas y las de 10 arrancan cargadas). Meter además una rampa de fatiga en el peligro es
      // contarlo dos veces, y esa fue exactamente la avería de la primera versión.
      fatA += 0.05 + 0.07 * Math.max(0, r - 4) / 8;
      fatB += 0.05 + 0.07 * Math.max(0, r - 4) / 8;
      const sh = shapeAt(r);
      const tA = Math.exp(tilt * 0.5), tB = Math.exp(-tilt * 0.5);
      // el sesgo temprano/tardío de cada uno inclina SU peligro en el tiempo casi sin mover su total
      const tempo = (t) => 1 + t * (r <= 3 ? 0.45 : r >= 8 ? -0.45 : 0);
      // el daño acumulado sí sube el peligro, pero acotado: es dependencia de trayectoria, no una rampa
      const wear = (d) => 1 + Math.min(0.9, d * 0.9);

      // ── DERRIBOS ────────────────────────────────────────────────────────────────────────────────────
      const kdRateA = H.kd_a * tA * sh * tempo(H.tempo_a) * wear(dmgB) * Math.exp(nightA);
      const kdRateB = H.kd_b * tB * sh * tempo(H.tempo_b) * wear(dmgA) * Math.exp(nightB);
      let downA = 0, downB = 0;                          // derribos que MARCA cada uno en este asalto
      if (rnd() < 1 - Math.exp(-kdRateA)) { downA = 1 + (rnd() < 0.18 ? 1 : 0); }
      if (rnd() < 1 - Math.exp(-kdRateB)) { downB = 1 + (rnd() < 0.18 ? 1 : 0); }
      kdA += downA; kdB += downB;
      dmgB += downA * 0.22; dmgA += downB * 0.22;

      // ── ¿SE ACABA AQUÍ? ────────────────────────────────────────────────────────────────────────────
      // El derribo multiplica el peligro DENTRO de este asalto: es el momento en que el árbitro mira, la
      // esquina se levanta y el que está tocado casi nunca sobrevive tres minutos más. Que el peligro esté
      // condicionado al derribo —y no sumado aparte— es lo que hace que "cayó y lo remataron" y "cayó y
      // aguantó hasta la campana" sean dos ramas de la MISMA simulación.
      const finA = H.fin_a * tA * sh * tempo(H.tempo_a) * wear(dmgB) * (1 + 3.2 * downA) * Math.exp(nightA);
      const finB = H.fin_b * tB * sh * tempo(H.tempo_b) * wear(dmgA) * (1 + 3.2 * downB) * Math.exp(nightB);
      const tot = finA + finB;
      if (rnd() < 1 - Math.exp(-tot)) {
        const aWins = rnd() * tot < finA;
        const via = pickVia(aWins ? H.via_a : H.via_b, rnd, downA + downB > 0);
        endR = r; endFrac = rnd();
        // si el que cae iba ganando las tarjetas, esto fue una remontada: se cuenta para el panel
        aheadOnCards = cards.reduce((s, c) => s + c, 0);
        if (aWins) { ended = 'a'; res['a_' + via]++; res.byRound[r - 1].a++; if (aheadOnCards < 0) behindWon = true; }
        else { ended = 'b'; res['b_' + via]++; res.byRound[r - 1].b++; if (aheadOnCards > 0) behindWon = true; }
        break;
      }

      // ── LA TARJETA DE 10 PUNTOS ────────────────────────────────────────────────────────────────────
      // El asalto lo gana quien impone, y el derribo lo REESCRIBE: con un derribo el asalto es 10-8 aunque
      // se fuera perdiendo, y con dos es 10-7. Es la regla que hace que una pelea se dé vuelta sin KO.
      const edge = structural + momentum * 0.25 + (nightA - nightB) + tilt
        + (fatB - fatA) * 0.9 + (dmgB - dmgA) * 0.5;
      const shared = gauss(rnd) * 0.75;
      let judgesA = 0;
      for (let j = 0; j < 3; j++) {
        const seen = edge + shared + gauss(rnd) * 0.58;
        let pts;
        if (downA > downB) pts = (downA - downB) >= 2 ? 3 : 2;          // 10-7 / 10-8 para A
        else if (downB > downA) pts = (downB - downA) >= 2 ? -3 : -2;
        else pts = seen > 0 ? 1 : -1;                                    // 10-9 al que impuso
        cards[j] += pts;
        if (j === 0) {
          if (pts > 0) { judgesA = 1; ptsA += 10; ptsB += 10 - pts; }
          else { ptsA += 10 + pts; ptsB += 10; }
        }
      }
      res.roundWinsA[r - 1] += judgesA;
      momentum = 0.6 * momentum + (edge > 0 ? 0.4 : -0.4);              // la inercia del que va imponiendo
      if (edge > 0) dmgB += 0.05 + Math.min(0.12, Math.abs(edge) * 0.05);
      else dmgA += 0.05 + Math.min(0.12, Math.abs(edge) * 0.05);

      // ── LA ESQUINA TIRA LA TOALLA (RTD) ────────────────────────────────────────────────────────────
      // Solo entre asaltos y del 3º en adelante, y solo con daño real encima. Es la vía del trabajo al
      // cuerpo, y en el dato de boxeo es el 4,5 % de los combates a 12.
      if (r >= 3 && r < rounds) {
        const rtdA = 0.019 * (H.via_b.rtd / 0.06) * Math.max(0, dmgA - 0.30) * (1 + fatA);
        const rtdB = 0.019 * (H.via_a.rtd / 0.06) * Math.max(0, dmgB - 0.30) * (1 + fatB);
        if (rnd() < rtdB) { ended = 'a'; res.a_rtd++; res.byRound[r - 1].a++; endR = r; endFrac = 1; break; }
        if (rnd() < rtdA) { ended = 'b'; res.b_rtd++; res.byRound[r - 1].b++; endR = r; endFrac = 1; break; }
      }
    }

    res.kdA += kdA; res.kdB += kdB; if (kdA + kdB > 0) res.kdAny++;
    if (behindWon) res.swing++;

    if (!ended) {
      res.dist++; endR = rounds; endFrac = 1;
      // LAS TARJETAS SE SUMAN DE VERDAD. Unánime, dividida, mayoritaria y empate salen de la aritmética.
      const forA = cards.filter((c) => c > 0).length;
      const forB = cards.filter((c) => c < 0).length;
      const lvl = cards.filter((c) => c === 0).length;
      if (forA === 3) { res.a_ud++; }
      else if (forA === 2 && forB === 1) { res.a_sd++; }
      else if (forA === 2 && lvl === 1) { res.a_md++; }
      else if (forB === 3) { res.b_ud++; }
      else if (forB === 2 && forA === 1) { res.b_sd++; }
      else if (forB === 2 && lvl === 1) { res.b_md++; }
      else { res.draw++; if (forA === 1 && forB === 1) res.draw_split++; }
      // LA TARJETA LITERAL. Se guarda la del primer juez en puntos (116-112 y no "gana A"), porque es la
      // forma en que un aficionado de boxeo piensa una pelea que va a los papeles.
      res.cardsA.push(ptsA); res.cardsB.push(ptsB);
    }
    res.roundsBoxed.push(endR - 1 + endFrac);
  }

  const p = (x) => r4(x / n);
  const aWin = res.a_ko + res.a_tko + res.a_rtd + res.a_ud + res.a_sd + res.a_md;
  const bWin = res.b_ko + res.b_tko + res.b_rtd + res.b_ud + res.b_sd + res.b_md;
  const times = res.roundsBoxed.slice().sort((x, y) => x - y);
  const q = (fq) => (times.length ? r2(times[Math.floor(fq * (times.length - 1))]) : null);
  const overs = {};
  for (let k = 1; k < rounds; k++) overs['over_' + k + '_5'] = p(times.filter((t) => t > k + 0.5).length);

  return {
    win: { a: p(aWin), b: p(bWin), draw: p(res.draw) },
    // el vector de método en el idioma del boxeo: KO seco, TKO por acumulación, retirada y decisión
    method: {
      a_ko: p(res.a_ko), a_tko: p(res.a_tko), a_rtd: p(res.a_rtd), a_dec: p(res.a_ud + res.a_sd + res.a_md),
      b_ko: p(res.b_ko), b_tko: p(res.b_tko), b_rtd: p(res.b_rtd), b_dec: p(res.b_ud + res.b_sd + res.b_md),
      draw: p(res.draw),
      stoppage: p(res.a_ko + res.a_tko + res.a_rtd + res.b_ko + res.b_tko + res.b_rtd),
      via_note: 'el reparto KO / TKO / retirada está medido DÉBIL (AUC 0,549 fuera de muestra) y va encogido a la mezcla de la liga. Lo que sí resiste es cuándo se rompe la pelea.',
    },
    distance: { prob: p(res.dist), finish_prob: p(n - res.dist) },
    round_of_finish: res.byRound.map((r, i) => ({
      round: i + 1, a: p(r.a), b: p(r.b), any: p(r.a + r.b),
    })),
    // los mercados de totales de asaltos, que es donde la medición dice que hay señal
    time: { mean_rounds: r2(times.reduce((s, x) => s + x, 0) / Math.max(1, times.length)),
      p25: q(0.25), median: q(0.5), p75: q(0.75), ...overs },
    decision: {
      ud_a: p(res.a_ud), sd_a: p(res.a_sd), md_a: p(res.a_md),
      ud_b: p(res.b_ud), sd_b: p(res.b_sd), md_b: p(res.b_md),
      draw: p(res.draw), draw_split: p(res.draw_split),
      split_or_majority: p(res.a_sd + res.a_md + res.b_sd + res.b_md),
      // qué parte de las decisiones son apretadas — el mercado de "decisión dividida" se cotiza
      close_share: r3(div(res.a_sd + res.a_md + res.b_sd + res.b_md + res.draw, res.dist)),
      // la tarjeta típica si esto va a los papeles, en el idioma en que se lee una tarjeta
      card: res.cardsA.length ? (function () {
        const ma = res.cardsA.reduce((s, x) => s + x, 0) / res.cardsA.length;
        const mb = res.cardsB.reduce((s, x) => s + x, 0) / res.cardsB.length;
        const wide = res.cardsA.map((x, i) => Math.abs(x - res.cardsB[i]));
        return { a: r2(ma), b: r2(mb), typical: `${Math.round(Math.max(ma, mb))}-${Math.round(Math.min(ma, mb))}`,
          margin: r2(wide.reduce((s, x) => s + x, 0) / wide.length),
          within_2: r3(wide.filter((x) => x <= 2).length / wide.length) };
      })() : null,
    },
    rounds: res.roundWinsA.map((w, i) => ({ round: i + 1, p_a: p(w),
      close: Math.abs(w / n - 0.5) < 0.08 })),
    // 18 · el derribo como evento propio, que es un mercado por sí mismo y la palanca de las remontadas
    knockdowns: {
      mean_a: r2(res.kdA / n), mean_b: r2(res.kdB / n),
      any: p(res.kdAny),
      swing: p(res.swing),
      swing_note: 'peleas que gana quien iba perdiendo en las tarjetas: es lo que el derribo le hace a una pelea y lo que un modelo sin derribos no puede producir',
    },
    sims: n, rounds_sched: rounds,
    hazards: { kd_a_per_round: r4(H.kd_a), kd_b_per_round: r4(H.kd_b),
      fin_a_per_round: r4(H.fin_a), fin_b_per_round: r4(H.fin_b) },
  };
}

// Elige la vía dentro de una finalización. Con derribo en el asalto, el KO seco pesa más; sin derribo, casi
// todo es acumulación. La retirada no puede salir de aquí: solo ocurre entre asaltos.
function pickVia(via, rnd, hadKd) {
  const ko = (via.ko || 0.32) * (hadKd ? 2.0 : 0.86);
  const tko = (via.tko || 0.62);
  const u = rnd() * (ko + tko);
  return u < ko ? 'ko' : 'tko';
}

function uncertainty(out, pa, pb, M) {
  const p = out.win.a;
  const aleatoric = Math.sqrt(p * (1 - p)) * 100;
  const nA = pa.sample.fights || 0, nB = pb.sample.fights || 0;
  const sampleTerm = 15 / Math.sqrt(Math.max(1, Math.min(nA, nB)));
  const fragTerm = ((M.fragility && M.fragility.concentration) || 0.4) * 12;
  // penalización propia del boxeo: si ninguno ha visto aguas profundas, el tramo largo es una extrapolación
  const deepTerm = (1 - Math.max(pa.depth.deep_share || 0, pb.depth.deep_share || 0)) * 8;
  const epistemic = Math.sqrt(sampleTerm ** 2 + fragTerm ** 2 + deepTerm ** 2);
  return {
    aleatoric_pp: r2(aleatoric), epistemic_pp: r2(epistemic),
    total_pp: r2(Math.sqrt(aleatoric ** 2 + epistemic ** 2)),
    drivers: [
      { source: 'muestra de los dos boxeadores', pp: r2(sampleTerm), detail: `${nA} y ${nB} peleas con método conocido` },
      { source: 'concentración de la ventaja en un tramo', pp: r2(fragTerm), detail: M.fragility && M.fragility.level },
      { source: 'asaltos profundos sin recorrer', pp: r2(deepTerm), detail: `${Math.round(100 * Math.max(pa.depth.deep_share || 0, pb.depth.deep_share || 0))}% de sus asaltos son del 8º en adelante` },
    ],
    note: epistemic > aleatoric * 0.5
      ? 'una parte grande de la incertidumbre es ignorancia nuestra, no azar del combate'
      : 'la incertidumbre es sobre todo el propio combate, que no baja con más datos',
  };
}

module.exports = {
  AXES, PHASES, ROUND_MIN, methodOf, roundsBoxed,
  buildProfiles, styleVectors, archetypeOf, matchup, phaseMass, hazards, simulate, core, solveTilt, uncertainty,
};
