// lib/encogimiento-sombra.js — LA DOBLE CORRIDA DEL ENCOGIMIENTO (16-sep, M1 · Fase B1)
//
// ── QUÉ ES Y POR QUÉ NO TOCA EL FEED ───────────────────────────────────────────────────────────────────
// M1 manda que la probabilidad encogida conviva 14 días con la cruda antes de que ninguna de las dos se
// declare ganadora. Aquí está esa convivencia, y está hecha de la única manera que no arriesga nada: **no
// se toca la creación de picks**. El feed sigue naciendo exactamente igual. Lo que hace este módulo es
// anotar, para cada pick que nace, **qué probabilidad habría publicado la versión encogida**, y guardarlo
// aparte. A los catorce días se comparan las dos sobre las MISMAS picks liquidadas.
//
// ── LA DECISIÓN QUE HACE QUE ESTO SEA UNA PRUEBA Y NO UN ADORNO ────────────────────────────────────────
// **El `c` se CONGELA el día que empieza la corrida.** No se reajusta cada pasada. Si se reajustara, cada
// pick se estaría evaluando con un `c` que ya vio datos posteriores a ella, y la comparación de los catorce
// días sería otra vez dentro de muestra — que es justo el error que `lib/encogimiento.js` existe para no
// cometer. Con el `c` congelado y fechado, todo lo que nazca después es prospectivo de verdad.
//
// La tabla congelada lleva su fecha, su `n` y su veredicto por familia. Cuando alguien quiera recongelar,
// que sea un acto explícito con su fecha, no un efecto secundario de una pasada.
//
// ── LO QUE MIDE AL FINAL ───────────────────────────────────────────────────────────────────────────────
// Log-loss de las dos versiones sobre las picks liquidadas nacidas DESPUÉS del congelado. Regla de
// puntuación propia: no se puede mejorar mintiendo. Y se informa aparte cuántas picks habría dejado de
// haber con la versión encogida, porque con `c = 0` la probabilidad publicada ES el precio y la ventaja
// contra el precio es cero por construcción — dato que importa para decidir, y que no se ve en el log-loss.
'use strict';

const path = require('path');
const EN = require('./encogimiento');
const JS = require('./jsonstore');

const DIR = (() => {
  const base = path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json'));
  return path.join(base, 'encogimiento');
})();
const FILE = 'sombra.json';
const VERSION = 'encogido_v1';

const vacio = () => ({ congelado: null, filas: {}, version: VERSION });
const rd = () => JS.readJson(DIR, FILE, 'encogimiento') || vacio();
const wr = (st) => JS.writeJson(DIR, FILE, st, 'encogimiento');

// ── CONGELAR ────────────────────────────────────────────────────────────────────────────────────────────
// `tabla` es { familia: { c, n, veredicto, ic } } tal y como lo devuelve la sonda agrupada por familia.
// Se guarda con la fecha. Recongelar es explícito y deja la anterior en `historial`, porque una cohorte
// que se evaluó con otro `c` no se puede mezclar con la siguiente.
function congelar(tabla, { motivo = 'inicio de la doble corrida de M1', ahora = Date.now() } = {}) {
  const st = rd();
  const limpia = {};
  for (const [fam, v] of Object.entries(tabla || {})) {
    if (!v || !Number.isFinite(v.c)) continue;
    limpia[fam] = { c: v.c, n: v.n ?? null, veredicto: v.veredicto || null,
      ic: v.ic_de_c && v.ic_de_c.ic ? v.ic_de_c.ic : (Array.isArray(v.ic) ? v.ic : null),
      no_distinguible_de_cero: !!v.c_no_distinguible_de_cero };
  }
  if (st.congelado) (st.historial ||= []).push(st.congelado);
  st.congelado = { at: new Date(ahora).toISOString(), motivo, familias: limpia,
    n_familias: Object.keys(limpia).length,
    n_con_c_positivo: Object.values(limpia).filter((x) => x.c > 0).length };
  wr(st);
  return st.congelado;
}

const cDe = (st, familia) => {
  const f = st.congelado && st.congelado.familias && st.congelado.familias[familia];
  return f && Number.isFinite(f.c) ? f.c : null;
};

// ── ANOTAR UNA PICK ─────────────────────────────────────────────────────────────────────────────────────
// Devuelve lo que la versión encogida habría publicado, o un motivo por el que no se pudo. Idempotente:
// una pick ya anotada no se vuelve a tocar, para que la cohorte no cambie bajo los pies.
function anota(st, { id, familia, p_gp, odds, odds_contraria, nacida_at }) {
  if (!id || st.filas[id]) return null;
  const c = cDe(st, familia);
  const m = EN.pMercado({ odds, odds_contraria });
  const fila = { familia, at: new Date().toISOString(), nacida_at: nacida_at || null,
    p_gp: Number.isFinite(p_gp) ? +p_gp.toFixed(6) : null,
    p_mercado: m ? +m.p.toFixed(6) : null, fuente_precio: m ? m.fuente : null, c };
  if (!Number.isFinite(p_gp)) fila.motivo = 'sin probabilidad del modelo';
  else if (!m) fila.motivo = 'sin precio sin margen: no se puede encoger hacia nada';
  else if (c == null) fila.motivo = 'familia sin c congelado';
  else {
    fila.p_encogida = +EN.encoger(p_gp, m.p, c).toFixed(6);
    // con c = 0 la encogida ES el precio, así que su ventaja contra el precio es cero POR CONSTRUCCIÓN:
    // esa pick no habría nacido en la versión encogida. Se marca para poder contarlas.
    fila.ventaja_pp = +(100 * (fila.p_encogida - m.p)).toFixed(4);
    fila.habria_nacido = Math.abs(fila.ventaja_pp) > 1e-9;
  }
  st.filas[id] = fila;
  return fila;
}

// ── LIQUIDAR ────────────────────────────────────────────────────────────────────────────────────────────
function liquida(st, id, gano) {
  const f = st.filas[id];
  if (!f || f.y != null) return false;
  if (gano !== 0 && gano !== 1) return false;
  f.y = gano;
  f.liquidada_at = new Date().toISOString();
  return true;
}

// ── EL VEREDICTO DE LOS CATORCE DÍAS ────────────────────────────────────────────────────────────────────
function track(st = rd()) {
  const cong = st.congelado;
  if (!cong) return { activo: false, razon: 'la doble corrida no se ha congelado todavía.' };
  const desde = Date.parse(cong.at);
  const todas = Object.entries(st.filas || {}).map(([id, f]) => ({ id, ...f }));
  // solo lo nacido DESPUÉS del congelado: lo anterior ya lo vio el ajuste y no es prospectivo
  const cohorte = todas.filter((f) => Date.parse(f.at) >= desde && f.y != null
    && Number.isFinite(f.p_gp) && Number.isFinite(f.p_encogida));
  const porFam = {};
  for (const f of cohorte) (porFam[f.familia] ||= []).push(f);
  const filas = [];
  for (const [fam, v] of Object.entries(porFam)) {
    const llCrudo = EN.logLoss(v.map((x) => x.p_gp), v.map((x) => x.y));
    const llEnc = EN.logLoss(v.map((x) => x.p_encogida), v.map((x) => x.y));
    const llPre = EN.logLoss(v.map((x) => x.p_mercado), v.map((x) => x.y));
    filas.push({ familia: fam, n: v.length, c: v[0].c,
      logloss_crudo: llCrudo == null ? null : +llCrudo.toFixed(6),
      logloss_encogido: llEnc == null ? null : +llEnc.toFixed(6),
      logloss_precio: llPre == null ? null : +llPre.toFixed(6),
      gana_el_encogido: (llCrudo != null && llEnc != null) ? +(llCrudo - llEnc).toFixed(6) : null,
      habrian_nacido: v.filter((x) => x.habria_nacido).length });
  }
  filas.sort((a, b) => b.n - a.n);
  const dias = (Date.now() - desde) / 86400e3;
  const anotadas = todas.filter((f) => Date.parse(f.at) >= desde).length;
  const nacerian = todas.filter((f) => Date.parse(f.at) >= desde && f.habria_nacido).length;
  return { activo: true, congelado_at: cong.at, dias_corridos: +dias.toFixed(2),
    listo: dias >= 14,
    familias_congeladas: cong.n_familias, con_c_positivo: cong.n_con_c_positivo,
    anotadas_desde_el_congelado: anotadas, liquidadas_de_la_cohorte: cohorte.length,
    picks_que_habrian_nacido_con_la_encogida: nacerian,
    // el dato que no se ve en el log-loss y que decide de verdad
    nota_picks: nacerian === 0 && anotadas > 0
      ? `NINGUNA de las ${anotadas} picks anotadas habría nacido con la versión encogida: con c = 0 la probabilidad publicada ES el precio, así que la ventaja contra el precio es cero por construcción. Cambiar a la encogida no reduce el número de picks, lo lleva a cero.`
      : `${nacerian} de ${anotadas} picks habrían nacido con la versión encogida.`,
    tabla: filas,
    no_cambia_el_feed: 'Esta corrida NO toca la creación de picks. El feed publica igual que antes; aquí solo se anota qué habría publicado la otra versión.' };
}

module.exports = { DIR, FILE, VERSION, rd, wr, congelar, anota, liquida, track, cDe };
