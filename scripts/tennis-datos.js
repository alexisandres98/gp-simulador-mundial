#!/usr/bin/env node
// scripts/tennis-datos.js — T2.14 DEL PLAN DE LA AUDITORÍA: DE CUÁNDO ES CADA DATO Y CUÁNTO SE RECORTA
//
// ── QUÉ CONTESTA ────────────────────────────────────────────────────────────────────────────────────────
// La auditoría externa (A23) señaló cuatro huecos en los DATOS de tenis, no en el modelo. Este script los
// mide, uno a uno, sin arreglarlos por su cuenta:
//
//   1. `data_as_of` POR COMPONENTE. El motor servía una sola fecha de frescura y la interfaz la leía como
//      "la base está al día". No es una fecha: son cuatro, y las cuatro distintas.
//   2. LAS TASAS DE SAQUE Y RESTO ESTÁN CONGELADAS. La espina de Sackmann se cortó y la cola de ESPN trae
//      ganador, sets y juegos pero NI UN punto de saque. Aquí se mide la fecha exacta del último dato de
//      saque del circuito y de cada jugador.
//   3. LA SUPERFICIE SE INFIERE DE UNA EXPRESIÓN REGULAR SOBRE EL NOMBRE DE LA CLAVE, y lo que no casa
//      cae a "dura" en silencio. Se contrasta clave por clave contra lo que dice la base propia.
//   4. EL RECORTE [0,45 · 0,80] DE LA PROBABILIDAD DE PUNTO AL SAQUE. Cuando muerde, lo que entra al
//      compilador no es la estimación del modelo: es el borde. Nadie había contado con qué frecuencia pasa.
//
// Y de propina, la quinta que pide el plan: el TIEBREAK POR EDICIÓN. El compilador trata el set decisivo
// como un set normal con tiebreak en 6-6. Eso no siempre fue verdad y no es verdad en todos los torneos.
//
// ── CÓMO SE USA ─────────────────────────────────────────────────────────────────────────────────────────
//   node scripts/tennis-datos.js                       # las cinco mediciones
//   node scripts/tennis-datos.js --sports <archivo>    # + certificación de superficie contra las claves
//                                                      #   reales de The Odds API (/v4/sports?all=true)
//   node scripts/tennis-datos.js --write               # además escribe data/tennis/surfaces.json
//
// No toca producción, no pide red, no escribe nada salvo con --write.
'use strict';

const fs = require('fs');
const path = require('path');
const D = require('../tennis-engine/data.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const tiene = (n) => process.argv.includes(n);
const r2 = (x) => (Number.isFinite(x) ? +x.toFixed(2) : null);
const r4 = (x) => (Number.isFinite(x) ? +x.toFixed(4) : null);
const pct = (a, b) => (b ? r2(100 * a / b) : null);
const HOY = +new Date().toISOString().slice(0, 10).replace(/-/g, '');
const dias = (ymd) => { const s = String(ymd); if (s.length !== 8) return null;
  return Math.round((Date.now() - Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))) / 864e5); };

// ── 1. DE CUÁNDO ES CADA PIEZA ──────────────────────────────────────────────────────────────────────────
const base = D.leeBase();
const salida = { at: new Date().toISOString(), hoy: HOY };
salida.data_as_of = { ...base.data_as_of,
  dias_de_retraso: {
    partidos_atp: dias((base.data_as_of.partidos || {}).atp),
    partidos_wta: dias((base.data_as_of.partidos || {}).wta),
    espina_saque_resto: dias(base.data_as_of.espina_saque_resto),
  } };

// ── 2 y 4. UNA SOLA PASADA WALK-FORWARD: recorte del saque + frescura del saque ─────────────────────────
// El recorte se mide SOBRE LOS PARTIDOS QUE DE VERDAD SE JUGARON, con el estado previo a cada uno: es la
// misma pregunta que se le hace al modelo cuando puntúa un partido del tablero, ni una más fácil ni una
// más difícil. Contar sobre pares inventados daría otra cifra y no significaría nada.
const clamp = {};
for (const lbl of ['atp', 'wta']) clamp[lbl] = { n: 0, a_bajo: 0, a_alto: 0, b_bajo: 0, b_alto: 0, alguno: 0, los_dos: 0,
  recorte_pp: [], sin_saque: 0, min: Infinity, max: -Infinity, crudos: [] };
const DESDE = Number(arg('--desde', '20240101'));
D.recorre({ desde: DESDE, onMatch: (r, t) => {
  const F = base.F;
  const lbl = r[F.tour] === 0 ? 'atp' : 'wta';
  const c = clamp[lbl];
  const p = D.probsEn(t, r[F.wid], r[F.lid], r[F.surface]);
  c.n++;
  // un jugador sin muestra de saque devuelve dev = 0 y la tasa sale igual a la media del circuito: eso no
  // es "el modelo cree que saca como la media", es "no hay dato". Se cuenta aparte para no confundirlos.
  if (Math.abs(p.paSrvCrudo - t.tourSpw) < 1e-12 || Math.abs(p.pbSrvCrudo - t.tourSpw) < 1e-12) c.sin_saque++;
  if (p.clampA === 'bajo') c.a_bajo++; if (p.clampA === 'alto') c.a_alto++;
  if (p.clampB === 'bajo') c.b_bajo++; if (p.clampB === 'alto') c.b_alto++;
  if (p.clampA || p.clampB) c.alguno++;
  if (p.clampA && p.clampB) c.los_dos++;
  // el margen que le sobra al recorte: si el crudo nunca se acerca a los bordes, el recorte no es una
  // salvaguarda que a veces actúa, es código muerto — y eso también hay que saberlo.
  c.min = Math.min(c.min, p.paSrvCrudo, p.pbSrvCrudo); c.max = Math.max(c.max, p.paSrvCrudo, p.pbSrvCrudo);
  c.crudos.push(p.paSrvCrudo, p.pbSrvCrudo);
  for (const [cr, cl] of [[p.paSrvCrudo, p.clampA], [p.pbSrvCrudo, p.clampB]]) {
    if (!cl) continue;
    c.recorte_pp.push(100 * Math.abs(cr - (cl === 'bajo' ? D.CLAMP_SPW[0] : D.CLAMP_SPW[1])));
  }
} });
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[(s.length - 1) >> 1]; };
const mx = (a) => (a.length ? Math.max(...a) : null);
salida.recorte_saque = { rango: D.CLAMP_SPW, universo: `partidos reales de la base desde ${DESDE}`, por_tour: {} };
for (const lbl of ['atp', 'wta']) {
  const c = clamp[lbl];
  salida.recorte_saque.por_tour[lbl] = {
    partidos: c.n, lados: 2 * c.n,
    lados_recortados: c.a_bajo + c.a_alto + c.b_bajo + c.b_alto,
    lados_recortados_pct: pct(c.a_bajo + c.a_alto + c.b_bajo + c.b_alto, 2 * c.n),
    partidos_con_algun_recorte_pct: pct(c.alguno, c.n),
    partidos_con_los_dos_recortados_pct: pct(c.los_dos, c.n),
    por_borde: { bajo_0_45: c.a_bajo + c.b_bajo, alto_0_80: c.a_alto + c.b_alto },
    recorte_mediano_pp: r2(med(c.recorte_pp)), recorte_maximo_pp: r2(mx(c.recorte_pp)),
    partidos_con_un_lado_sin_muestra_de_saque_pct: pct(c.sin_saque, c.n),
    // cuánto le sobra al recorte por cada borde: la distancia del valor crudo más extremo a su tope
    crudo_min: r4(c.min), crudo_max: r4(c.max),
    holgura_pp: { al_borde_bajo: r2(100 * (c.min - D.CLAMP_SPW[0])), al_borde_alto: r2(100 * (D.CLAMP_SPW[1] - c.max)) },
    percentiles_crudo: (() => { const s = c.crudos.slice().sort((x, y) => x - y);
      const q = (p) => r4(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]);
      return { p01: q(0.001), p1: q(0.01), p50: q(0.5), p99: q(0.99), p999: q(0.999) }; })(),
  };
}

// frescura del saque por jugador, con el estado FINAL (que es el que sirve producción)
const fin = D.build();
salida.frescura_saque = {};
for (const tn of [0, 1]) {
  const t = fin.T[tn];
  const lbl = tn === 0 ? 'atp' : 'wta';
  const fechas = [...t.srvDate.values()].filter((x) => x > 20000000);
  // ACTIVO = jugó en los últimos 90 días DE LA BASE, no "tiene diez partidos en su vida". Con el criterio
  // laxo la mediana de antigüedad del saque salía en dos años porque contaba retirados de 2016.
  const finBase = (base.data_as_of.partidos || {})[lbl] || 0;
  const hace90 = (() => { const s = String(finBase); if (s.length !== 8) return 0;
    const ms = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) - 90 * 864e5;
    return +new Date(ms).toISOString().slice(0, 10).replace(/-/g, ''); })();
  const activos = [...t.prof.entries()].filter(([, p]) => p.w + p.l >= 10 && p.lastDate >= hace90);
  const conSaque = activos.filter(([id]) => t.srvDate.get(id) > 20000000);
  salida.frescura_saque[lbl] = {
    ultimo_partido_con_estadistica_de_saque_del_circuito: t.spwDate || null,
    dias_congelado: dias(t.spwDate),
    jugadores_con_alguna_estadistica_de_saque: fechas.length,
    jugadores_activos_en_catalogo: activos.length,
    criterio_activo: `≥10 partidos y último partido ≥ ${hace90} (90 días antes del final de la base)`,
    activos_sin_ninguna_estadistica_de_saque: activos.length - conSaque.length,
    mediana_dias_desde_su_ultimo_dato_de_saque: (() => { const d = conSaque.map(([id]) => dias(t.srvDate.get(id))).filter(Number.isFinite); return d.length ? med(d) : null; })(),
    activos_con_saque_anterior_a_la_espina_pct: pct(conSaque.filter(([id]) => t.srvDate.get(id) < (base.data_as_of.espina_saque_resto || 0)).length, conSaque.length),
    ultimo_partido_de_la_base: (base.data_as_of.partidos || {})[lbl] || null,
  };
}

// ── 3. SUPERFICIE: lo que dice la expresión regular contra lo que dice la base ───────────────────────────
// La regla de producción, copiada literal de tennis-engine/store.js para poder contrastarla sin importarla
// (importar el store arrastra `fetch`, disco y estado de servidor).
const SURF_BY_KEY = [
  [/french_open|monte_carlo|madrid|italian|barcelona|munich|hamburg|charleston|strasbourg|stuttgart/, 1],
  [/wimbledon|halle|queens|bad_homburg|german_open/, 2],
];
const surfOfKey = (k) => { for (const [re, s] of SURF_BY_KEY) if (re.test(k)) return s; return 0; };
const bo5Keys = /tennis_atp_(aus_open|french_open|wimbledon|us_open)/;
const NOM = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const ALIAS = {                      // los nombres que la base y el proveedor escriben distinto
  french_open: ['roland garros', 'french open'], aus_open_singles: ['australian open'], us_open: ['us open'],
  italian_open: ['rome', 'roma', 'italian open'], canadian_open: ['canada', 'montreal', 'toronto', 'canadian open'],
  queens_club_champ: ['queen s club', 'queens club', 'london'], german_open: ['berlin', 'german open'],
  china_open: ['beijing', 'china open'], qatar_open: ['doha', 'qatar open'], indian_wells: ['indian wells'],
  monte_carlo_masters: ['monte carlo'], paris_masters: ['paris masters'], shanghai_masters: ['shanghai'],
  cincinnati_open: ['cincinnati'], miami_open: ['miami'], madrid_open: ['madrid'], washington_open: ['washington'],
  stuttgart_open: ['stuttgart'], bad_homburg_open: ['bad homburg'], charleston_open: ['charleston'],
  monterrey_open: ['monterrey'], wuhan_open: ['wuhan'], guadalajara_open: ['guadalajara'], halle_open: ['halle'],
  hamburg_open: ['hamburg'], barcelona_open: ['barcelona'], munich: ['munich'], dubai: ['dubai'],
  strasbourg: ['strasbourg'], wimbledon: ['wimbledon'],
};
// de la base: superficie observada por (tour, nombre normalizado de torneo), con recuento y último año
const porNombre = new Map();
for (const r of base.rows) {
  const tnm = base.tourneys[r[base.F.tid]];
  if (!tnm) continue;
  const k = r[base.F.tour] + '|' + NOM(tnm.name);
  const o = porNombre.get(k) || { n: 0, surf: {}, bo: {}, ultimo: 0 };
  o.n++; o.surf[r[base.F.surface]] = (o.surf[r[base.F.surface]] || 0) + 1;
  o.bo[r[base.F.best_of]] = (o.bo[r[base.F.best_of]] || 0) + 1;
  o.ultimo = Math.max(o.ultimo, r[base.F.date]);
  porNombre.set(k, o);
}
let claves = [];
const fsp = arg('--sports', null);
if (fsp) { try { claves = JSON.parse(fs.readFileSync(fsp, 'utf8')).filter((s) => /^tennis_(atp|wta)_/.test(s.key)); } catch (e) { console.error('no pude leer --sports:', e.message); } }
const certif = [];
for (const s of claves) {
  const tn = s.key.startsWith('tennis_wta') ? 1 : 0;
  const sufijo = s.key.replace(/^tennis_(atp|wta)_/, '');
  const candidatos = (ALIAS[sufijo] || [sufijo.replace(/_/g, ' ')]);
  let hit = null;
  for (const c of candidatos) {
    for (const [k, o] of porNombre) {
      const [ktn, nombre] = k.split('|');
      if (+ktn !== tn) continue;
      if (nombre === c || nombre.includes(c) || c.includes(nombre)) { if (!hit || o.n > hit.o.n) hit = { nombre, o }; }
    }
    if (hit) break;
  }
  const inferida = surfOfKey(s.key);
  const dominante = hit ? +Object.entries(hit.o.surf).sort((a, b) => b[1] - a[1])[0][0] : null;
  const boDom = hit ? +Object.entries(hit.o.bo).sort((a, b) => b[1] - a[1])[0][0] : null;
  certif.push({
    key: s.key, activo: !!s.active, titulo: s.title,
    superficie_inferida: D.SURFACES[inferida], superficie_base: dominante == null ? null : D.SURFACES[dominante],
    casan: dominante == null ? null : dominante === inferida,
    certificable: !!hit, torneo_base: hit ? hit.nombre : null, partidos_base: hit ? hit.o.n : 0,
    ultimo_en_base: hit ? hit.o.ultimo : null,
    best_of_inferido: bo5Keys.test(s.key) ? 5 : 3, best_of_base: boDom,
    best_of_casan: boDom == null ? null : boDom === (bo5Keys.test(s.key) ? 5 : 3),
    // por defecto SIN evidencia: la regex no dice "dura", dice "no encontré nada"
    por_defecto: inferida === 0 && !SURF_BY_KEY.some(([re]) => re.test(s.key)),
  });
}
salida.superficie = {
  claves_evaluadas: certif.length,
  certificables_contra_la_base: certif.filter((x) => x.certificable).length,
  discrepancias_de_superficie: certif.filter((x) => x.casan === false),
  discrepancias_de_formato: certif.filter((x) => x.best_of_casan === false),
  cayeron_al_defecto_dura: certif.filter((x) => x.por_defecto).length,
  defecto_y_no_certificable: certif.filter((x) => x.por_defecto && !x.certificable).map((x) => x.key),
  detalle: certif,
};

// ── 5. TIEBREAK POR EDICIÓN ─────────────────────────────────────────────────────────────────────────────
// El compilador trata el set decisivo como uno normal (tiebreak en 6-6). Se comprueba EDICIÓN a EDICIÓN
// (torneo × año) mirando los marcadores del último set: si aparecen sets decisivos de 7-6 hay tiebreak; si
// aparecen por encima de 7 juegos ganados (8-6, 10-8, 13-12) hubo set a ventaja o tiebreak largo.
const EDICIONES = new Map();
for (const r of base.rows) {
  const sc = String(r[base.F.score] || '');
  const sets = sc.split(/\s+/).map((x) => x.replace(/\([^)]*\)/g, '')).filter((x) => /^\d+-\d+$/.test(x));
  if (!sets.length) continue;
  const ult = sets[sets.length - 1].split('-').map(Number);
  const need = Math.ceil((r[base.F.best_of] || 3) / 2);
  let wa = 0, wb = 0;
  for (const s2 of sets) { const [a, b] = s2.split('-').map(Number); if (a > b) wa++; else if (b > a) wb++; }
  if (Math.max(wa, wb) !== need) continue;               // marcador incompleto o retirada: no dice nada
  const tnm = base.tourneys[r[base.F.tid]];
  const k = (r[base.F.tour] === 0 ? 'atp' : 'wta') + '|' + NOM(tnm ? tnm.name : '?') + '|' + String(r[base.F.date]).slice(0, 4);
  const o = EDICIONES.get(k) || { n: 0, tb: 0, largos: 0, max: 0 };
  o.n++;
  const gmax = Math.max(ult[0], ult[1]);
  if (gmax === 7 && Math.min(ult[0], ult[1]) === 6) o.tb++;
  if (gmax > 7) { o.largos++; o.max = Math.max(o.max, gmax); }
  EDICIONES.set(k, o);
}
const conLargos = [...EDICIONES.entries()].filter(([, o]) => o.largos > 0 && o.n >= 20);
salida.tiebreak_por_edicion = {
  ediciones_con_al_menos_20_partidos: [...EDICIONES.values()].filter((o) => o.n >= 20).length,
  ediciones_con_sets_decisivos_sin_tiebreak: conLargos.length,
  partidos_afectados: conLargos.reduce((s, [, o]) => s + o.largos, 0),
  peor: conLargos.sort((a, b) => b[1].largos - a[1].largos).slice(0, 12)
    .map(([k, o]) => ({ edicion: k, partidos: o.n, decisivos_largos: o.largos, pct: pct(o.largos, o.n), juegos_max: o.max })),
  nota: 'el compilador cierra TODO set decisivo con tiebreak en 6-6. Donde estas ediciones dicen lo contrario, la cola de la distribución de juegos está mal por construcción, no por calibración.',
};

// ── SALIDA ──────────────────────────────────────────────────────────────────────────────────────────────
const dest = arg('--out', null);
const txt = JSON.stringify(salida, null, 1);
if (dest) { fs.writeFileSync(dest, txt); console.error('escrito', dest); }
else console.log(txt);

// --write: el catálogo de superficies certificado, para que producción deje de inferir en silencio
if (tiene('--write') && certif.length) {
  const cat = { generado: new Date().toISOString(),
    fuente: 'contraste de la clave de The Odds API contra la superficie observada en la base propia (Sackmann + cola ESPN)',
    nota: 'CERTIFICADA = la base propia tiene partidos de ese torneo y su superficie dominante. INFERIDA = solo la expresión regular del nombre. SUPUESTA = ni una cosa ni la otra: cae a dura por defecto y hay que decirlo en la ficha.',
    claves: Object.fromEntries(certif.map((x) => [x.key, {
      superficie: x.superficie_base || x.superficie_inferida,
      origen: x.certificable ? 'certificada' : (x.por_defecto ? 'supuesta' : 'inferida'),
      best_of: x.best_of_base || x.best_of_inferido,
      partidos_base: x.partidos_base, ultimo_en_base: x.ultimo_en_base, titulo: x.titulo,
    }])) };
  const f = path.join(__dirname, '..', 'data', 'tennis', 'surfaces.json');
  fs.writeFileSync(f, JSON.stringify(cat, null, 1));
  console.error('escrito', f, '·', certif.length, 'claves');
}
