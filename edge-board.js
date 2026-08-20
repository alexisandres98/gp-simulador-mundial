// edge-board.js — EL TABLERO DE FAMILIAS (20-ago)
//
// POR QUÉ EXISTE. La casa lleva ocho deportes y cada uno mide su rendimiento en su propia pantalla, con su
// propio recorte y su propia forma. Eso sirve para operar un deporte y no sirve para la única pregunta que
// de verdad importa: ¿en qué familias hay ventaja, en cuáles no la hay, y cuánto falta para saberlo? Con
// ocho tableros separados esa pregunta se contesta de memoria, y de memoria se contesta mal — pasó con
// tarjetas, que se recordaba como "+19 %" cuando ya era "+4,8 % con CLV negativo".
//
// LA VARA ES UNA Y ES EL CLV. El ROI a estas muestras es varianza con decimales. Aquí cada familia trae su
// CLV medio, su dispersión y el estadístico t = media / (sd/√n), que es lo que separa "va ganando" de "va
// ganando por casualidad". Cuando una familia no tiene mercado contra el que medirse (F1), se dice y se
// juzga por Brier, no se le inventa un CLV.
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

// EL VEREDICTO, ESCRITO UNA VEZ. Que sea el mismo para las ocho disciplinas es la mitad del valor de esto:
// una familia de tenis y una de CS2 se comparan porque se juzgan igual, no porque se parezcan.
function veredicto({ n, clv, clvSd, clvN }) {
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
  if (t >= 2 && clv > 0) { estado = 'CONFIRMADA'; lectura = `CLV ${r2(clv)} % con t=${r2(t)} sobre ${clvN}: bate al cierre y no por casualidad.`; }
  else if (t >= 1 && clv > 0) { estado = 'PROMETE'; lectura = `CLV ${r2(clv)} % con t=${r2(t)}: va en la dirección buena y le faltan ${nT2 && nT2 > clvN ? nT2 - clvN : 0} liquidadas para confirmarlo.`; }
  else if (t <= -2 && clvN >= N_CONFIRMA) { estado = 'DESCARTAR'; lectura = `CLV ${r2(clv)} % con t=${r2(t)} sobre ${clvN}: pierde contra el cierre de forma medible. No es mala suerte.`; }
  else if (t <= -1) { estado = 'EN_CONTRA'; lectura = `CLV ${r2(clv)} % con t=${r2(t)}: va en contra; con más muestra esto se descarta.`; }
  else { estado = 'PLANA'; lectura = `CLV ${r2(clv)} % con t=${r2(t)}: indistinguible del mercado. Ni ventaja ni desventaja medible.`; }
  // solo tiene sentido enseñar "cuántas faltan" cuando faltan: una familia ya confirmada no necesita meta
  const faltan = nT2 && nT2 > clvN && nT2 < 1e6 ? nT2 : null;
  return { estado, t: r2(t), n_para_t2: faltan, faltan_liquidadas: faltan ? faltan - clvN : 0, lectura };
}

const fila = (o) => {
  const v = veredicto(o);
  return { deporte: o.deporte, familia: o.familia, lado: o.lado || null, banda: o.banda || null,
    n: o.n, hit_pct: o.hit != null ? r2(o.hit) : null, roi_pct: o.roi != null ? r2(o.roi) : null,
    clv_pct: o.clv != null ? r2(o.clv) : null, clv_sd: o.clvSd != null ? r2(o.clvSd) : null, clv_n: o.clvN || 0,
    vara: o.vara || 'clv', extra: o.extra || null, ...v };
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

// ── fútbol y los dos deportes que viven en db: se agrupan AQUÍ por familia+lado+banda ─────────────────────
function dePicks(deporte, picks, { clvDe, ladoDe, bandaDe, oddsDe }) {
  const g = new Map();
  for (const p of picks) {
    const k = [p.family || '?', (ladoDe ? ladoDe(p) : null) || '', (bandaDe ? bandaDe(p) : null) || ''].join('|');
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(p);
  }
  const out = [];
  for (const [k, list] of g) {
    const [familia, lado, banda] = k.split('|');
    const w = list.filter((p) => p.result_code === 'WIN').length;
    const stake = list.length;
    const ret = list.reduce((s, p) => s + (p.result_code === 'WIN' ? Number(oddsDe ? oddsDe(p) : p.best_odds || 0) : 0), 0);
    const clvs = list.map((p) => clvDe(p)).filter((x) => Number.isFinite(x));
    out.push(fila({ deporte, familia, lado: lado || null, banda: banda || null, n: list.length,
      hit: list.length ? 100 * w / list.length : null,
      roi: stake ? 100 * (ret - stake) / stake : null,
      clv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null,
      clvSd: sd(clvs), clvN: clvs.length }));
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
  const candidatas = filas.filter((r) => !r.objetivo && (r.estado === 'CONFIRMADA' || r.estado === 'PROMETE'))
    .sort((a, b) => (b.t || 0) - (a.t || 0));
  const descartables = filas.filter((r) => r.estado === 'DESCARTAR');

  const resumen = filas.reduce((a, r) => { a[r.estado] = (a[r.estado] || 0) + 1; return a; }, {});
  return {
    at: new Date().toISOString(),
    doctrina: 'La vara es el CLV, no el ROI. Una familia entra al objetivo cuando su CLV bate al cierre con t≥2 sobre muestra propia; sale cuando pierde con t≤−2 y al menos 100 liquidadas. Entre medias se acumula, no se decide. `n_para_t2` es cuántas liquidadas con CLV harían falta para confirmar el CLV que hoy se observa.',
    listones: { n_min: N_MIN, n_para_descartar: N_CONFIRMA, t_confirma: 2, t_descarta: -2 },
    resumen, objetivo, candidatas, descartables, filas, errores,
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

module.exports = { build, veredicto, OBJETIVO };
