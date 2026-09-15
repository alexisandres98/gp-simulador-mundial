// edge-board.js — EL TABLERO DE FAMILIAS (20-ago)
//
// POR QUÉ EXISTE. La casa lleva ocho deportes y cada uno mide su rendimiento en su propia pantalla, con su
// propio recorte y su propia forma. Eso sirve para operar un deporte y no sirve para la única pregunta que
// de verdad importa: ¿en qué familias hay ventaja, en cuáles no la hay, y cuánto falta para saberlo? Con
// ocho tableros separados esa pregunta se contesta de memoria, y de memoria se contesta mal — pasó con
// tarjetas, que se recordaba como "+19 %" cuando ya era "+4,8 % con CLV negativo".
//
// LA VARA ES UNA Y YA NO ES EL CLV (15-sep-2026, T1.6 de la auditoría externa). Durante tres semanas este
// tablero juzgó por CLV y llegó a estampar "CONFIRMADA" en familias cuya esperanza era negativa. El
// contraejemplo que lo tumbó: cierre 1,905/1,905 y entrada a 1,97 da un CLV de +3,43 %, la regla vieja lo
// aprobaba con +0,93 % y el retorno esperado de verdad es −1,50 %. Restar el margen por lado a la media del
// CLV mezcla unidades y no es el retorno esperado de nada.
//
// Ahora el veredicto lo escribe `lib/vara.js` y solo él: EV ticket a ticket contra la probabilidad SIN
// MARGEN del cierre del mismo contrato y la misma casa, agregado con incertidumbre por racimos de evento.
// El CLV sigue en la fila, pero como DIAGNÓSTICO DE MOVIMIENTO DE LÍNEA, nunca como veredicto. Y la
// etiqueta "CONFIRMADA" desaparece: ninguna familia vuelve a llevarla hasta que la vara nueva diga
// `invertible`.
//
// Y TRAE EL NÚMERO QUE SIEMPRE FALTA: cuántas picks más hacen falta. Con la media y la dispersión
// observadas, n* = (2·sd/media)² es la muestra a la que ese CLV llegaría a t=2. Convierte "no sabemos" en
// "faltan 340", que es una respuesta con la que se puede planificar.
//
// LA UNIDAD ES FAMILIA + LADO + BANDA, no la familia sola. Tarjetas under en mercado blando y tarjetas over
// en mercado eficiente son dos apuestas distintas con dos resultados opuestos, y sumarlas fue exactamente
// el error que escondió la familia estrella durante semanas.
'use strict';

// Las diez que Alexis puso en el objetivo, más córners, que entró después por méritos propios. La etiqueta
// viaja en la fila para poder leer el tablero por objetivo sin perder de vista lo que hay fuera de él.
const OBJETIVO = [
  { id: 'cs2_rondas', label: 'CS2 rondas + hándicap', match: (r) => r.deporte === 'cs2' && /RONDAS/.test(r.familia) },
  { id: 'cs2_props', label: 'CS2 props Underdog', match: (r) => r.deporte === 'cs2-props' },
  { id: 'f1_podio', label: 'F1 podio / top 10', match: (r) => r.deporte === 'f1' },
  { id: 'futbol_tarjetas', label: 'Fútbol tarjetas under', match: (r) => r.deporte === 'futbol' && r.familia === 'CARDS' && r.lado === 'under' },
  { id: 'college', label: 'College', match: (r) => r.deporte === 'ncaaf' },
  { id: 'nfl', label: 'NFL', match: (r) => r.deporte === 'nfl' },
  { id: 'tenis_totales', label: 'Tenis totales', match: (r) => r.deporte === 'tenis' && /TOTAL|JUEGOS/.test(r.familia) },
  { id: 'lol_kills', label: 'LoL kills', match: (r) => r.deporte === 'lol' && /KILLS/.test(r.familia) },
  { id: 'valorant_prorroga', label: 'Valorant prórroga', match: (r) => r.deporte === 'valorant' && r.familia === 'PRORROGA' },
  { id: 'futbol_corners', label: 'Fútbol córners over', match: (r) => r.deporte === 'futbol' && r.familia === 'CORNERS' && r.lado === 'over' },
];

const N_MIN = 30;            // por debajo, ni se juzga
const N_CONFIRMA = 100;      // y para descartar hace falta al menos esto
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);

function sd(a) {
  if (!a || a.length < 2) return null;
  const m = a.reduce((x, y) => x + y, 0) / a.length;
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
}

// EL DIAGNÓSTICO DE MOVIMIENTO DE LÍNEA. Esto ya NO es el veredicto: es lo que se sabe del CLV y nada más.
// Los estados que devuelve describen cómo se mueve el libro entre nuestra entrada y el cierre, no si hay
// dinero. El veredicto lo pone `lib/vara.js` sobre el EV, y está en el campo `veredicto` de la fila.
function diagnosticoClv({ n, clv, clvSd, clvN }) {
  if (!n || n < N_MIN) return { estado: 'SIN_MUESTRA', t: null, n_para_t2: null,
    lectura: `${n || 0} liquidadas: por debajo de ${N_MIN} no se juzga, se acumula.` };
  if (clv == null || !clvN || clvN < N_MIN || clvSd == null || !(clvSd > 0)) {
    return { estado: 'SIN_CLV', t: null, n_para_t2: null,
      lectura: `hay ${n} liquidadas pero solo ${clvN || 0} con cierre guardado: sin CLV no hay vara.` };
  }
  // GUARDA CONTRA EL FALSO POSITIVO DEL ESTADÍSTICO. Si el libro casi no se mueve entre nuestra toma y el
  // cierre, la dispersión del CLV se hace diminuta y un CLV de +0,02 % sale con t=1,4 — que no dice
  // "ventaja", dice "no hay contra qué medir". Apareció de verdad en córners under de ligas intermedias.
  const SD_MIN = 0.5;   // puntos porcentuales
  if (clvSd < SD_MIN) {
    return { estado: 'SIN_MOVIMIENTO', t: null, n_para_t2: null,
      lectura: `el cierre se mueve ${r2(clvSd)} pp de media sobre ${clvN} picks: no hay movimiento contra el que medirse. Un CLV de ${r2(clv)} % aquí no es señal, es un libro quieto.` };
  }
  const t = clv / (clvSd / Math.sqrt(clvN));
  const nT2 = clv !== 0 ? Math.ceil((2 * clvSd / clv) ** 2) : null;
  let estado, lectura;
  // "CONFIRMADA" YA NO EXISTE (15-sep, decisión D2). Batir al cierre no es ganar dinero, y esa palabra en
  // esta columna hizo que se leyera como si lo fuera. Lo más que puede decir el CLV es que la línea se
  // mueve a nuestro favor, que es un hecho sobre el libro, no sobre nuestra cuenta.
  if (t >= 2 && clv > 0) { estado = 'LINEA_A_FAVOR'; lectura = `CLV ${r2(clv)} % con t=${r2(t)} sobre ${clvN}: la línea se mueve a nuestro favor y no por casualidad. Esto NO dice que haya dinero — eso lo dice el EV.`; }
  else if (t >= 1 && clv > 0) { estado = 'PROMETE'; lectura = `CLV ${r2(clv)} % con t=${r2(t)}: va en la dirección buena y le faltan ${nT2 && nT2 > clvN ? nT2 - clvN : 0} liquidadas para distinguirlo del ruido.`; }
  else if (t <= -2 && clvN >= N_CONFIRMA) { estado = 'LINEA_EN_CONTRA'; lectura = `CLV ${r2(clv)} % con t=${r2(t)} sobre ${clvN}: la línea se mueve en contra de forma medible. No es mala suerte.`; }
  else if (t <= -1) { estado = 'EN_CONTRA'; lectura = `CLV ${r2(clv)} % con t=${r2(t)}: va en contra; con más muestra esto se descarta.`; }
  else { estado = 'PLANA'; lectura = `CLV ${r2(clv)} % con t=${r2(t)}: indistinguible del mercado. Ni ventaja ni desventaja medible.`; }
  // solo tiene sentido enseñar "cuántas faltan" cuando faltan: una familia ya confirmada no necesita meta
  const faltan = nT2 && nT2 > clvN && nT2 < 1e6 ? nT2 : null;
  return { estado, t: r2(t), n_para_t2: faltan, faltan_liquidadas: faltan ? faltan - clvN : 0, lectura };
}

const fila = (o) => {
  const d = diagnosticoClv(o);
  // `vara` dice de dónde sale el veredicto. Cuando el motor solo entrega agregados (n, CLV, sd) no hay
  // forma de calcular el EV ticket a ticket, y eso se DECLARA en vez de rellenarse con el diagnóstico de
  // CLV disfrazado de veredicto. Un hueco declarado se puede cerrar; uno tapado, no.
  return { deporte: o.deporte, familia: o.familia, lado: o.lado || null, banda: o.banda || null,
    rule_version: o.ruleVersion || null,
    n: o.n, hit_pct: o.hit != null ? r2(o.hit) : null, roi_pct: o.roi != null ? r2(o.roi) : null,
    clv_pct: o.clv != null ? r2(o.clv) : null, clv_sd: o.clvSd != null ? r2(o.clvSd) : null, clv_n: o.clvN || 0,
    vara: o.vara || (o.evVara ? 'ev_cierre' : 'solo_clv_agregado'),
    veredicto: o.evVara ? o.evVara.veredicto : 'sin_ev_en_el_tablero',
    razon: o.evVara ? o.evVara.razon : 'el motor solo publica agregados (n, CLV medio, desviación): sin los tickets no se puede calcular el EV contra el cierre. Falta exponer el libro de esta familia.',
    ev_pct: o.evVara && o.evVara.ev ? o.evVara.ev.ev_medio_pct : null,
    ev_t: o.evVara && o.evVara.ev ? o.evVara.ev.t : null,
    ev_n: o.evVara && o.evVara.ev ? o.evVara.ev.n : null,
    ev_n_eventos: o.evVara && o.evVara.ev ? (o.evVara.ev.n_clusters != null ? o.evVara.ev.n_clusters : null) : null,
    cierres_in_play: o.evVara ? (o.evVara.cierres_in_play || 0) : null,
    // el diagnóstico de línea viaja con su propio nombre para que nadie vuelva a leerlo como veredicto
    linea: { estado: d.estado, t: d.t, n_para_t2: d.n_para_t2, faltan_liquidadas: d.faltan_liquidadas, lectura: d.lectura },
    estado: d.estado, t: d.t, n_para_t2: d.n_para_t2, faltan_liquidadas: d.faltan_liquidadas, lectura: d.lectura,
    extra: o.extra || null };
};

// ── de un `by_family` de motor (nfl / college / cfl / tenis / esports) a filas ────────────────────────────
function deByFamily(deporte, byFamily) {
  const out = [];
  for (const [familia, f] of Object.entries(byFamily || {})) {
    out.push(fila({ deporte, familia, n: f.n, hit: f.hit_pct, roi: f.units != null && f.n ? 100 * f.units / f.n : null,
      clv: f.clv_avg_pct, clvSd: f.clv_sd, clvN: f.clv_n }));
  }
  return out;
}
// ── LO MISMO, PERO POR CASA ──────────────────────────────────────────────────────────────────────────────
// El promedio de una familia entre casas puede tener el signo contrario al de la casa donde de verdad se
// apostaría. Pasó: CS2 hándicap de rondas daba +2,44 % de media y era +3,53 % en la afilada y −3,13 % en la
// única conectable por API. Mientras la ejecución dependa de UNA casa, la fila que decide es la de esa casa.
function deByFamilyBook(deporte, byFB) {
  const out = [];
  for (const f of Object.values(byFB || {})) {
    out.push({ ...fila({ deporte, familia: f.family, n: f.n, hit: f.hit_pct,
      roi: f.units != null && f.n ? 100 * f.units / f.n : null,
      clv: f.clv_avg_pct, clvSd: f.clv_sd, clvN: f.clv_n }), casa: f.book });
  }
  return out;
}

// ── fútbol y los dos deportes que viven en db: se agrupan AQUÍ por familia+lado+banda ─────────────────────
// UNA COHORTE POR `rule_version` (15-sep, A31). Mezclar dos versiones de una regla en una fila es contar
// dos experimentos como uno: la versión vieja arrastra a la nueva o la nueva rescata a la vieja, y en
// ninguno de los dos casos la fila mide lo que dice medir. Las picks sin versión se agrupan en `sin_version`
// —es el histórico anterior al campo— y se dice cuántas son, en vez de repartirlas a ojo.
const versionDe = (p) => p.rule_version || p.regla || p.ruleVersion || 'sin_version';

function dePicks(deporte, picks, { clvDe, ladoDe, bandaDe, oddsDe, casaDe = null, porVersion = true }) {
  const g = new Map();
  for (const p of picks) {
    const k = [p.family || '?', (ladoDe ? ladoDe(p) : null) || '', (bandaDe ? bandaDe(p) : null) || '',
      casaDe ? (casaDe(p) || 'sin_casa') : '', porVersion ? versionDe(p) : ''].join('|');
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(p);
  }
  const out = [];
  for (const [k, list] of g) {
    const [familia, lado, banda, casa, version] = k.split('|');
    const w = list.filter((p) => p.result_code === 'WIN').length;
    const stake = list.length;
    const ret = list.reduce((s, p) => s + (p.result_code === 'WIN' ? Number(oddsDe ? oddsDe(p) : p.best_odds || 0) : 0), 0);
    const clvs = list.map((p) => clvDe(p)).filter((x) => Number.isFinite(x));
    // EL VEREDICTO SALE DE LA VARA, NO DE AQUÍ. Aquí hay tickets de verdad, así que `lib/vara.js` puede
    // hacer su trabajo: EV contra el cierre cuando hay las dos caras, y la prueba directa modelo-contra-
    // precio cuando no las hay. Si la vara falla por lo que sea, la fila sigue saliendo con el diagnóstico
    // de CLV y `vara: 'solo_clv_agregado'` — el tablero nunca se cae por una familia.
    let evVara = null;
    try {
      const V = require('./lib/vara');
      evVara = V.familia(list, {
        fecha: (p) => p.settled_at || p.created_at || p.at || null,
        clv: (p) => clvDe(p),
        odds: (p) => Number(oddsDe ? oddsDe(p) : p.best_odds) || null,
        cierre: (p) => Number(p.close_odds || (p.closes && p.closes.last && p.closes.last.own)) || null,
        cierreContraria: (p) => Number(p.close_odds_contraria || p.close_odds_opuesta) || null,
        gano: (p) => (p.result_code === 'WIN' ? 1 : p.result_code === 'LOSS' ? 0 : null),
        pModelo: (p) => (Number.isFinite(p.model_prob) ? p.model_prob : null),
        evento: (p) => (p.event && (p.event.canonical_event_id || p.event.id)) || p.ceid || p.event_id || p.pick_id,
      });
    } catch { evVara = null; }
    const f2 = fila({ deporte, familia, lado: lado || null, banda: banda || null,
      ruleVersion: porVersion ? (version || null) : null, evVara,
      n: list.length,
      hit: list.length ? 100 * w / list.length : null,
      roi: stake ? 100 * (ret - stake) / stake : null,
      clv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null,
      clvSd: sd(clvs), clvN: clvs.length });
    if (casaDe) f2.casa = casa || null;
    out.push(f2);
  }
  return out;
}

function build({ db, pickClvNum, hoopsTrack, combatTrack } = {}) {
  const filas = [];
  const errores = [];
  const intenta = (que, fn) => { try { const r = fn(); if (r) filas.push(...r); } catch (e) { errores.push(`${que}: ${e.message}`); } };

  // FÚTBOL — la familia estrella vive aquí y su unidad es familia+lado+banda.
  // Las dos listas: `dailyPicks` es la del Mundial y `clubDailyPicks` la de clubes, que es donde viven las
  // tarjetas y los córners. Leer solo la primera daba n=6 en la familia estrella y n=3 en córners.
  intenta('futbol', () => {
    if (!db) return null;
    const todas = [].concat(Array.isArray(db.dailyPicks) ? db.dailyPicks : [], Array.isArray(db.clubDailyPicks) ? db.clubDailyPicks : []);
    if (!todas.length) return null;
    const done = todas.filter((p) => p.status === 'SETTLED' && (p.result_code === 'WIN' || p.result_code === 'LOSS'));
    return dePicks('futbol', done, {
      clvDe: (p) => (pickClvNum ? pickClvNum(p) : (typeof p.clv === 'number' ? p.clv : null)),
      ladoDe: (p) => p.side || (p.selection_code && /UNDER/i.test(p.selection_code) ? 'under' : p.selection_code && /OVER/i.test(p.selection_code) ? 'over' : null),
      bandaDe: (p) => p.league_band || null,
    });
  });

  // BALONCESTO y COMBATE — sus tracks ya agrupan por familia
  intenta('baloncesto', () => (hoopsTrack ? deByFamily('baloncesto', normalizaHoops(hoopsTrack().by_family)) : null));
  intenta('combate', () => {
    if (!db || !Array.isArray(db.combatPicks)) return null;
    const done = db.combatPicks.filter((p) => p.status === 'SETTLED' && (p.result_code === 'WIN' || p.result_code === 'LOSS'));
    return dePicks('combate', done, { clvDe: (p) => (Number.isFinite(p.clv_pct) ? p.clv_pct : null), bandaDe: (p) => p.league_band || null });
  });

  // ESPORTS — cuatro juegos, un motor por juego
  intenta('esports', () => {
    const ES = require('./esports-engine/store');
    const out = [];
    for (const g of ES.GAME_ORDER) {
      const t = ES.track(g, { limit: 1 });
      out.push(...deByFamily(g, t.by_family));
    }
    return out;
  });
  intenta('cs2-props', () => {
    const PR = require('./esports-engine/props');
    const t = PR.track();
    const out = [];
    for (const [rule, p] of Object.entries(t.by_rule || {})) {
      // en un libro DFS el CLV que informa es el de LÍNEA; se usa ese y se dice
      out.push(fila({ deporte: 'cs2-props', familia: rule, n: p.n, hit: p.hit != null ? 100 * p.hit : null,
        roi: p.roi != null ? 100 * p.roi : null,
        clv: p.avg_clv_line != null ? 100 * p.avg_clv_line : null,
        clvSd: p.sd_clv_line != null ? 100 * p.sd_clv_line : null, clvN: p.clv_line_n || 0,
        extra: 'CLV de línea (libro DFS: el precio casi no se mueve)' }));
    }
    return out;
  });

  // FÚTBOL, FAMILIAS DERIVADAS — la sombra nueva del 20-ago, con su propia vara y su propio almacén
  intenta('futbol-derivadas', () => deByFamily('futbol-deriv', require('./futbol-derivadas').track().by_family));

  // FÚTBOL AMERICANO — NFL y las dos ligas de amfoot
  intenta('nfl', () => deByFamily('nfl', require('./nfl-engine/store').track().by_family));
  intenta('amfoot', () => {
    const AF = require('./amfoot-engine/store');
    const out = [];
    for (const lg of Object.keys(AF.LEAGUES)) out.push(...deByFamily(lg, AF.track(lg).by_family));
    return out;
  });

  // TENIS
  intenta('tenis', () => deByFamily('tenis', require('./tennis-engine/store').track().by_family));

  // F1 — no tiene mercado contra el que medirse: se juzga por Brier y se DICE, no se le inventa un CLV
  intenta('f1', () => {
    const F1 = require('./f1-engine/store');
    const tr = F1.takeTrack();
    return (tr.families || []).map((f) => fila({ deporte: 'f1', familia: f.family, n: f.n,
      hit: f.acierto != null ? 100 * f.acierto : null, roi: null, clv: null, clvSd: null, clvN: 0,
      vara: 'brier', extra: `Brier ${f.brier} · sin cobertura de mercado: no hay cierre contra el que medir CLV` }));
  });

  for (const r of filas) {
    const o = OBJETIVO.find((x) => x.match(r));
    r.objetivo = o ? o.id : null;
    r.objetivo_label = o ? o.label : null;
  }
  filas.sort((a, b) => (b.clv_n || 0) - (a.clv_n || 0) || (b.n || 0) - (a.n || 0));

  // el objetivo, familia a familia, con las que ni siquiera aparecen marcadas como tales
  const objetivo = OBJETIVO.map((o) => {
    const rs = filas.filter((r) => r.objetivo === o.id);
    if (!rs.length) return { id: o.id, label: o.label, estado: 'SIN_PICKS', lectura: 'no hay ni una liquidada de esta familia todavía.' };
    const mejor = rs.slice().sort((a, b) => (b.clv_n || 0) - (a.clv_n || 0))[0];
    return { id: o.id, label: o.label, filas: rs.length, n: rs.reduce((s, r) => s + (r.n || 0), 0),
      estado: mejor.estado, clv_pct: mejor.clv_pct, t: mejor.t, clv_n: mejor.clv_n,
      n_para_t2: mejor.n_para_t2, lectura: mejor.lectura };
  });

  // CANDIDATAS: lo que está FUERA del objetivo y ya mide bien. Es la mitad del trabajo — el top 10 no es
  // una lista cerrada, es la lista de hoy.
  // Candidata = la vara nueva la ve positiva, aunque todavía no llegue a t. Se ordena por EV, no por t del
  // CLV: el t del CLV mide movimiento de línea y ordenar por él fue exactamente cómo llegaron arriba
  // familias con esperanza negativa.
  const candidatas = filas.filter((r) => !r.objetivo && (r.veredicto === 'invertible' || r.veredicto === 'invertible_por_acierto' || r.veredicto === 'en_observacion'))
    .sort((a, b) => (b.ev_pct || 0) - (a.ev_pct || 0));
  const descartables = filas.filter((r) => r.veredicto === 'cerrar');
  const invertibles = filas.filter((r) => r.veredicto === 'invertible' || r.veredicto === 'invertible_por_acierto');

  // ── EL MISMO TABLERO, POR CASA ─────────────────────────────────────────────────────────────────────────
  // Solo importa la casa donde SE PUEDE ejecutar. Se marca cuál es conectable por API para que la lectura no
  // dependa de recordarlo: una familia con CLV positivo en una casa sin API es información, no es negocio.
  const CONECTABLES = new Set(['cloudbet', 'polymarket', 'kalshi', 'myriad']);
  const porCasa = [];
  const conCasa = (que, fn) => { try { const r = fn(); if (r) porCasa.push(...r); } catch (e) { errores.push(`casa:${que}: ${e.message}`); } };
  conCasa('esports', () => {
    const ES = require('./esports-engine/store');
    const out = [];
    for (const g of ES.GAME_ORDER) out.push(...deByFamilyBook(g, ES.track(g, { limit: 1 }).by_family_book));
    return out;
  });
  conCasa('nfl', () => deByFamilyBook('nfl', require('./nfl-engine/store').track().by_family_book));
  conCasa('amfoot', () => {
    const AF = require('./amfoot-engine/store');
    const out = [];
    for (const lg of Object.keys(AF.LEAGUES)) out.push(...deByFamilyBook(lg, AF.track(lg).by_family_book));
    return out;
  });
  conCasa('tenis', () => deByFamilyBook('tenis', require('./tennis-engine/store').track().by_family_book));
  conCasa('futbol', () => {
    if (!db) return null;
    const todas = [].concat(Array.isArray(db.dailyPicks) ? db.dailyPicks : [], Array.isArray(db.clubDailyPicks) ? db.clubDailyPicks : []);
    const done = todas.filter((p) => p.status === 'SETTLED' && (p.result_code === 'WIN' || p.result_code === 'LOSS'));
    return dePicks('futbol', done, {
      clvDe: (p) => (pickClvNum ? pickClvNum(p) : null),
      ladoDe: (p) => p.side || null,
      casaDe: (p) => p.best_book || p.book || null,
    });
  });
  conCasa('combate', () => {
    if (!db || !Array.isArray(db.combatPicks)) return null;
    const done = db.combatPicks.filter((p) => p.status === 'SETTLED' && (p.result_code === 'WIN' || p.result_code === 'LOSS'));
    return dePicks('combate', done, { clvDe: (p) => (Number.isFinite(p.clv_pct) ? p.clv_pct : null), casaDe: (p) => p.best_book || p.book || null });
  });
  conCasa('baloncesto', () => {
    if (!db || !Array.isArray(db.hoopsPicks)) return null;
    const done = db.hoopsPicks.filter((p) => p.status === 'SETTLED' && (p.result_code === 'WIN' || p.result_code === 'LOSS'));
    return dePicks('baloncesto', done, { clvDe: (p) => (Number.isFinite(p.clv_pct) ? p.clv_pct : null), casaDe: (p) => p.best_book || p.book || null });
  });
  for (const r of porCasa) r.conectable = CONECTABLES.has(String(r.casa || '').toLowerCase());
  porCasa.sort((a, b) => (b.clv_n || 0) - (a.clv_n || 0));
  // LO EJECUTABLE Y BUENO: lo único que puede convertirse en dinero sin abrir una cuenta nueva. El filtro
  // pasa a ser el EV, no el CLV (15-sep): una casa con CLV positivo y EV negativo es precisamente la
  // trampa que la auditoría encontró, y esta lista la estaba poniendo arriba del todo.
  const ejecutable_con_ventaja = porCasa.filter((r) => r.conectable && (r.ev_pct || 0) > 0 && (r.ev_n || 0) >= 10)
    .sort((a, b) => (b.ev_pct || 0) - (a.ev_pct || 0));
  // Y EL COSTE DE NO PODER EJECUTAR: familias con ventaja medida en casas sin API
  const ventaja_inalcanzable = porCasa.filter((r) => !r.conectable && (r.ev_pct || 0) > 0 && (r.ev_n || 0) >= 10)
    .sort((a, b) => (b.ev_pct || 0) - (a.ev_pct || 0));
  // La lista vieja se conserva con su nombre propio: sigue siendo información útil (dónde se mueve la
  // línea a nuestro favor) mientras no se confunda con dónde hay dinero.
  const linea_a_favor_ejecutable = porCasa.filter((r) => r.conectable && (r.clv_pct || 0) > 0 && (r.clv_n || 0) >= 10)
    .sort((a, b) => (b.t || 0) - (a.t || 0));

  const resumen = filas.reduce((a, r) => { a[r.veredicto] = (a[r.veredicto] || 0) + 1; return a; }, {});
  const resumen_linea = filas.reduce((a, r) => { a[r.estado] = (a[r.estado] || 0) + 1; return a; }, {});

  // CONCILIACIÓN (A31). La auditoría encontró 96 filas declaradas contra 98 sumadas por estado y nadie se
  // dio cuenta porque los dos números vivían en sitios distintos. Ahora se calculan aquí, juntos, y si no
  // cuadran el propio tablero lo dice — un tablero que no sabe contar sus propias filas no puede juzgar
  // nada más.
  const sumaVeredictos = Object.values(resumen).reduce((a, b) => a + b, 0);
  const sumaLinea = Object.values(resumen_linea).reduce((a, b) => a + b, 0);
  const conciliacion = {
    filas_declaradas: filas.length,
    suma_por_veredicto: sumaVeredictos,
    suma_por_estado_de_linea: sumaLinea,
    cuadra: filas.length === sumaVeredictos && filas.length === sumaLinea,
    sin_rule_version: filas.filter((r) => r.rule_version === 'sin_version').length,
    por_casa_declaradas: porCasa.length,
  };
  if (!conciliacion.cuadra) {
    errores.push(`conciliación: ${filas.length} filas declaradas, ${sumaVeredictos} sumadas por veredicto, ${sumaLinea} por estado de línea`);
  }

  // COMPARACIONES MÚLTIPLES (§2.3). Se están juzgando decenas de familias a la vez; con umbral individual
  // del 5 % una o dos salen "buenas" por azar. El umbral corregido viaja AL LADO del veredicto individual
  // para que se lea en el mismo golpe de vista, no en una nota al pie.
  let bh = null;
  try {
    const INF = require('./lib/inferencia');
    const conT = filas.filter((r) => Number.isFinite(r.ev_t) && r.ev_n >= N_MIN);
    if (conT.length) {
      const ps = conT.map((r) => INF.pDeT(r.ev_t, Math.max(1, (r.ev_n_eventos || r.ev_n) - 1)));
      const res = INF.bh(ps, 0.10);
      bh = { familias_comparadas: conT.length, q: 0.10, umbral_p: res.umbral,
        sobreviven: res.umbral == null ? [] : conT.filter((r, i) => ps[i] <= res.umbral).map((r) => `${r.deporte}|${r.familia}${r.lado ? '|' + r.lado : ''}`),
        nota: 'Benjamini–Hochberg es ciego al signo: aquí "sobrevive" significa que la diferencia con cero no es ruido, y puede ser a favor o en contra. El signo está en `ev_pct`.' };
    } else {
      bh = { familias_comparadas: 0, q: 0.10, umbral_p: null,
        nota: `ninguna familia llega a ${N_MIN} tickets con EV calculable: no hay nada que corregir todavía.` };
    }
  } catch (e) { errores.push(`bh: ${e.message}`); }

  return {
    at: new Date().toISOString(),
    doctrina: 'La vara es el EV contra la probabilidad SIN MARGEN del cierre del mismo contrato y la misma casa, con incertidumbre por racimos de evento (lib/vara.js). El CLV es diagnóstico de movimiento de línea y NUNCA veredicto: batir al cierre no es ganar dinero. El ROI a estas muestras es varianza con decimales. Una familia solo es invertible con EV positivo, t≥2 sobre eventos y muestra suficiente; se cierra con t≤−2. Entre medias se acumula, no se decide.',
    cambio_15_sep: 'Desaparece la etiqueta CONFIRMADA. Los estados de la columna de línea (LINEA_A_FAVOR / LINEA_EN_CONTRA) describen el libro, no la cuenta. El veredicto está en `veredicto` y lo escribe la vara.',
    listones: { n_min: N_MIN, n_para_descartar: N_CONFIRMA, t_confirma: 2, t_descarta: -2 },
    resumen, resumen_linea, conciliacion, bh,
    objetivo, candidatas, descartables, invertibles, filas,
    por_casa: porCasa, ejecutable_con_ventaja, ventaja_inalcanzable, linea_a_favor_ejecutable,
    casas_conectables: [...CONECTABLES],
    errores,
  };
}

// el track de baloncesto llama a sus campos distinto (clv_avg / clv_n / clv_sd)
function normalizaHoops(byFam) {
  const out = {};
  for (const [k, v] of Object.entries(byFam || {})) {
    out[k] = { n: v.n, hit_pct: v.hit, units: v.units, clv_avg_pct: v.clv_avg, clv_n: v.clv_n, clv_sd: v.clv_sd };
  }
  return out;
}

module.exports = { build, diagnosticoClv, OBJETIVO };
