// lib/margen.js — EL MARGEN DE LA CASA, MEDIDO (11-sep)
//
// De dónde viene. Llevamos semanas decidiendo con el CLV: "nuestro precio contra el cierre de la misma casa".
// El problema es que el cierre LLEVA EL MARGEN DENTRO. Si Pinnacle cobra un 2,4 % en hándicap de rondas,
// su cierre ya está un 1,2 % por lado peor que el precio justo — así que ganarle un 0,5 % al cierre NO
// significa estar por encima del precio justo, significa estar 0,7 % por debajo. Durante todo agosto eso
// daba igual porque el CLV iba por el 2 %; ahora que va por el 0,5 % es exactamente la diferencia entre
// una familia invertible y una que no lo es, y no lo estábamos midiendo.
//
// Qué hace. Empareja las dos caras del mismo mercado en un archivo de cierres y saca el sobre-redondeo:
//
//     sobre_redondeo = 1/cuota_A + 1/cuota_B − 1
//
// Con cuotas 1.90/1.90 sale 5,26 %: la casa cobra eso por cruzar el mercado. Repartido entre los dos lados,
// cada lado paga la mitad. El CLV NETO de una familia es su CLV menos esa mitad — y esa es la cifra que de
// verdad dice si hay dinero, no el CLV a secas.
//
// Qué NO hace. No inventa. Si un mercado solo tiene una cara guardada, no hay margen que medir y se dice
// `null` en vez de rellenar con el margen de otro mercado. Un margen supuesto es peor que ninguno: haría
// pasar por invertible algo que no lo es, que es justo el error que este módulo existe para impedir.
'use strict';

// Los motores nombran los lados con vocabularios distintos (home/away, over/under, a/b, yes/no). El
// emparejado necesita saber cuál es la cara contraria de cada uno.
const OPUESTO = { home: 'away', away: 'home', over: 'under', under: 'over', a: 'b', b: 'a', yes: 'no', no: 'yes', si: 'no' };
function opuesto(lado) { return OPUESTO[String(lado || '').toLowerCase()] || null; }

// DOS FILAS SON LA MISMA APUESTA VISTA DESDE LOS DOS LADOS cuando coinciden **EL PARTIDO**, la casa, la
// familia, el mapa/periodo y la línea. Ojo con la línea: en un hándicap la cara contraria lleva la línea
// CAMBIADA DE SIGNO (+2.5 / −2.5), mientras que en un total las dos caras comparten la misma línea
// (over 25.5 / under 25.5). Confundirlos empareja mercados distintos y saca márgenes fantasma.
//
// ── POR QUÉ EL PARTIDO ESTÁ EN LA CLAVE (16-sep, A4) ───────────────────────────────────────────────────
// Hasta hoy NO estaba, y el módulo llevaba desde el 11-sep informando márgenes que no cobra nadie. La clave
// era casa+familia+mapa+línea, sin nada que distinguiera un partido de otro, así que TODAS las filas de
// TODOS los partidos con la misma línea caían en el mismo cubo — y como de las caras repetidas se queda la
// de MEJOR cuota, se emparejaba el over del partido A con el under del partido B. Eso no es el margen de un
// mercado: es un arbitraje imaginario entre partidos distintos.
//
// Cómo se vio: `cs2 · bovada · KILLS` salía con margen **exactamente 0 %** sobre 46 «mercados». Ninguna
// casa cobra cero. Y el total de goles de fútbol salía 0,69 %/lado cuando Cloudbet, medido partido a
// partido sobre su libro en vivo el 16-sep, cobra 3,09 %/lado (`scripts/cloudbet-margen-futbol.js`). Los
// «márgenes» de la doctrina estaban entre cuatro y cinco veces por debajo de lo real, y como el margen se
// RESTA del CLV, todas las familias salían mejor de lo que son.
//
// Y por eso una fila SIN identificador de partido ya no se empareja: se cuenta aparte. Un margen medido
// entre partidos distintos tiene la misma cara que uno bueno, y ésa es justo la clase de número que este
// módulo existe para no producir.
const HCP = /(HANDICAP|HCP|SPREAD)/i;
function eventoDe(r) {
  const v = r.event_id != null ? r.event_id : (r.evento != null ? r.evento : (r.match_id != null ? r.match_id
    : (r.series_id != null ? r.series_id : (r.game_id != null ? r.game_id : (r.fixture_id != null ? r.fixture_id
      : (r.ceid != null ? r.ceid : (r.cb_event_id != null ? r.cb_event_id : (r.partido_id != null ? r.partido_id : null))))))));
  return v == null || v === '' ? null : String(v);
}
function claveMercado(r) {
  const fam = String(r.family || r.familia || '');
  const lado = String(r.side || r.lado || '').toLowerCase();
  const ev = eventoDe(r);
  const base = [ev == null ? '(sin evento)' : ev, r.book || r.casa || '?', fam,
    r.map != null ? r.map : (r.game != null ? r.game : ''), r.period || ''].join('|');
  if (r.line == null) return base + '|-';
  // el hándicap se indexa por el valor ABSOLUTO de la línea para que +2.5 y −2.5 caigan en la misma clave
  if (HCP.test(fam)) return base + '|' + Math.abs(Number(r.line));
  // en los totales, over y under comparten línea tal cual
  return base + '|' + Number(r.line) + (['over', 'under'].includes(lado) ? '' : '');
}

// Empareja filas y devuelve un par por mercado con su sobre-redondeo. Cuando una cara aparece varias veces
// (varias lecturas), se queda la de MEJOR cuota: es la que un apostante habría podido tomar, y usar una peor
// inflaría artificialmente el margen que luego restamos.
function pares(rows, { contador = null } = {}) {
  const idx = new Map();
  for (const r of rows || []) {
    const lado = String(r.side || r.lado || '').toLowerCase();
    const o = Number(r.odds != null ? r.odds : r.cuota);
    if (!opuesto(lado) || !(o > 1)) continue;
    // sin partido no hay mercado que emparejar: se cuenta y se deja fuera
    if (eventoDe(r) == null) { if (contador) contador.sin_evento++; continue; }
    if (contador) contador.con_evento++;
    const k = claveMercado(r);
    const m = idx.get(k) || {};
    if (!m[lado] || o > m[lado].odds) m[lado] = { odds: o, row: r };
    idx.set(k, m);
  }
  const out = [];
  for (const [k, m] of idx) {
    // cada par se emite UNA vez: de las dos caras se toma siempre la alfabéticamente menor como cabeza
    // (away antes que home, over antes que under). Antes esto era un `if (par > b) continue` y descartaba
    // el par entero cuando la primera cara vista era la mayor — o sea todos los home/away, que son justo
    // los hándicaps. El margen de esa familia salía vacío y el veredicto decía "sin margen medido".
    const cabeza = Object.keys(m).filter((l) => m[opuesto(l)]).sort()[0];
    if (!cabeza) continue;
    const b = opuesto(cabeza);
    const oA = m[cabeza].odds, oB = m[b].odds;
    const over = 1 / oA + 1 / oB - 1;
    // filtro de cordura: un sobre-redondeo negativo es arbitraje puro y uno del 60 % es basura de captura.
    // Los dos existen en los archivos y los dos destrozan una mediana si se dejan pasar.
    if (!(over > -0.02 && over < 0.6)) continue;
    const r0 = m[cabeza].row;
    out.push({ clave: k, book: r0.book || r0.casa || '?', family: r0.family || r0.familia || '?',
      lado_a: cabeza, lado_b: b, odds_a: oA, odds_b: oB, over_pct: +(100 * over).toFixed(3) });
  }
  return out;
}

const mediana = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); const h = b.length >> 1; return b.length % 2 ? b[h] : (b[h - 1] + b[h]) / 2; };
const media = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// EL MARGEN POR LADO ES LA MITAD DEL SOBRE-REDONDEO, y se expresa en % DE CUOTA para poder restarlo del CLV
// sin cambiar de unidad (el CLV también es % de cuota). Se usa la MEDIANA, no la media: los archivos tienen
// capturas sueltas con una cara vieja que disparan el sobre-redondeo, y una media se las come enteras.
function resumen(rows, { porCasa = true } = {}) {
  const cont = { sin_evento: 0, con_evento: 0 };
  const ps = pares(rows, { contador: cont });
  const o = {};
  for (const p of ps) {
    const k = porCasa ? `${p.book} · ${p.family}` : p.family;
    (o[k] = o[k] || { book: p.book, family: p.family, over: [] }).over.push(p.over_pct);
  }
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const med = mediana(v.over);
    out[k] = { book: v.book, family: v.family, n: v.over.length,
      over_mediana_pct: med == null ? null : +med.toFixed(2),
      over_media_pct: +media(v.over).toFixed(2),
      // lo que paga UNA apuesta: la mitad del sobre-redondeo
      margen_lado_pct: med == null ? null : +(med / 2).toFixed(2),
      // y lo que cuesta DE VERDAD cruzar el mercado en esperanza: R/(1+R), no R/2. Para márgenes pequeños
      // las dos cifras casi coinciden; para los caros no, y el HT/FT de Cloudbet (21,9 %) es el ejemplo.
      coste_ev_pct: med == null ? null : +(100 * ((med / 100) / (1 + med / 100))).toFixed(2) };
  }
  // el recuento de filas sin partido viaja con el resultado: si es alto, el margen está medido sobre una
  // parte pequeña del archivo y eso hay que saberlo antes de restarlo de nada
  Object.defineProperty(out, '_filas', { value: { ...cont }, enumerable: false });
  return out;
}

module.exports = { opuesto, eventoDe, claveMercado, pares, resumen, mediana, media };
