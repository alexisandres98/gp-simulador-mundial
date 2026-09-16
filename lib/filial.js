// lib/filial.js — CUANDO EL NOMBRE SE PARECE PERO EL EQUIPO NO ES EL MISMO (16-sep-2026)
//
// LO QUE SE ENCONTRÓ. El liquidador de esports empareja la apuesta con el resultado por nombre, y cuando la
// clave exacta no casa admite un segundo intento más laxo: vale si un nombre normalizado CONTIENE al otro
// con al menos cinco letras. Ese intento existe por un motivo real y documentado —la casa escribe "Vivo
// Keyd Stars" donde la fuente escribe "Keyd Stars"— y ha rescatado 150 liquidaciones que si no se habrían
// perdido.
//
// El problema es que la regla de contención no distingue un patrocinador de una FILIAL:
//
//     "vivokeydstars".includes("keydstars")   → el mismo equipo con patrocinador delante  ✔
//     "spiritacademy".includes("spirit")      → Team Spirit y Spirit Academy, que NO lo son  ✘
//
// Auditado sobre el libro de CS2 a 16-sep, de las 150 liquidadas por emparejado laxo, **once
// enfrentamientos (≈65 tickets) cruzan esa frontera**: apuestas sobre "Spirit Academy" liquidadas con el
// resultado de Team Spirit, apuestas sobre "BESTIA" liquidadas con el de BESTIA Academy, y cinco casos de
// "Inner Circle" contra "Inner Circle Academy". Y no es simétrico ni obvio hacia qué lado está el error: la
// propia base ya deja escrito que Cloudbet listó la final de BLAST Porto como "Spirit Academy" cuando la
// realidad —y la fuente— decían "Spirit". A veces la casa se equivoca y el emparejado laxo ACIERTA.
//
// POR ESO ESTE MÓDULO NO DECIDE QUIÉN TIENE RAZÓN. No se puede: nuestros datos no contienen la información
// que haría falta. Lo que hace es lo único defendible — **detectar el cruce y marcarlo**, para que:
//   · el liquidador pueda negarse (o dejar constancia) en vez de resolver a ciegas;
//   · esos tickets sean CONTABLES y no se cuelen silenciosamente en el EV de la familia;
//   · un humano pueda mirar once enfrentamientos, que es una tarea de una tarde, en vez de mil quinientos.
//
// LA OTRA MITAD DEL PROBLEMA: LA FUSIÓN EN EL CATÁLOGO. Además del emparejado laxo, el resolutor de equipos
// puede devolver el MISMO id para dos equipos distintos. Medido sobre los 259 nombres del libro de CS2 hay
// exactamente uno: "Faze Up Next" → `gp:faze`, o sea la academia de FaZe resolviendo a FaZe Clan. Hoy no ha
// hecho daño (sus tres apuestas están sin resultado, ninguna liquidada), pero es una bomba con la mecha
// puesta: en cuanto FaZe Clan y Faze Up Next jueguen el mismo día, una se liquida con el resultado de la
// otra. `fusionesEnCatalogo()` lo encuentra sin tener que esperar a que pase.
//
// Sin dependencias.
'use strict';

// ── EL VOCABULARIO DE LAS FILIALES ──────────────────────────────────────────────────────────────────────
// Cada marca va con lo que de verdad significa, porque la lista se va a ampliar y quien la amplíe tiene que
// saber qué criterio está siguiendo: son sufijos que denotan un ROSTER DISTINTO bajo la misma marca, no
// adornos del mismo equipo. `esports` o `gaming` no entran aquí — esos sí son adorno.
const MARCAS = [
  { re: /\bacademy\b/i, que: 'equipo academia' },
  { re: /\bacademia\b/i, que: 'equipo academia' },
  { re: /\bprospects?\b/i, que: 'cantera' },
  { re: /\byoungsters?\b/i, que: 'cantera' },
  { re: /\bup\s*next\b/i, que: 'cantera (FaZe)' },
  { re: /\bnxt\b/i, que: 'cantera (MOUZ)' },
  { re: /\byouth\b/i, que: 'cantera' },
  { re: /\bjunior(s)?\b/i, que: 'cantera' },
  { re: /\bjr\b/i, que: 'cantera' },
  { re: /\breload\b/i, que: 'segundo roster' },
  { re: /\bforce\b/i, que: 'segundo roster (Falcons)' },
  { re: /\balters\b/i, que: 'segundo roster (Sangal)' },
  { re: /\b(fe|female)\b/i, que: 'equipo femenino' },
  { re: /\bb\s*team\b/i, que: 'equipo B' },
  { re: /\bii\b/i, que: 'segundo equipo' },
];

// Abreviaturas que la fuente usa para la MISMA filial. "Phantom AC" es Phantom Academy, no Phantom: si no
// se reconocieran, el módulo marcaría como cruce lo que es exactamente el mismo equipo escrito corto.
const ABREVIATURAS = [
  { re: /\bac\b/i, que: 'equipo academia (abreviado)' },
  { re: /\bacad\b/i, que: 'equipo academia (abreviado)' },
];

// `ex-` delante no cambia el roster, cambia la marca: "ex-Sashi Academy" sigue siendo la academia. Se quita
// antes de mirar nada para que no ensucie ni la comparación ni la marca.
const limpia = (n) => String(n || '').replace(/^\s*ex[-–\s]+/i, '').trim();

const plano = (n) => limpia(n).toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// ¿Este nombre lleva marca de filial? Devuelve QUÉ marca, no solo true — el informe lo lee una persona.
function marcaDe(nombre) {
  const n = limpia(nombre);
  for (const m of MARCAS) if (m.re.test(n)) return m.que;
  for (const a of ABREVIATURAS) if (a.re.test(n)) return a.que;
  return null;
}
const esFilial = (nombre) => marcaDe(nombre) != null;

// ── LA PREGUNTA QUE IMPORTA ─────────────────────────────────────────────────────────────────────────────
// ¿Emparejar estos dos nombres cruza la frontera entre un equipo y su filial?
//
// Sí exactamente cuando uno lleva marca y el otro no **y además los dos hablan de la misma marca base** —
// o sea, el tronco de uno contiene al del otro. Sin esa segunda condición se marcaría como cruce cualquier
// pareja en la que uno de los dos fuera una academia, y "Spirit Academy" contra "G2" no es un cruce: es un
// emparejado que sencillamente no casa y que ya se rechaza por otro camino.
function cruza(a, b) {
  const ma = marcaDe(a), mb = marcaDe(b);
  if ((ma == null) === (mb == null)) return null;        // los dos con marca o los dos sin ella: no hay cruce
  const pa = plano(a), pb = plano(b);
  if (!pa || !pb) return null;
  // el tronco es el nombre sin su marca: "spiritacademy" → "spirit"
  const tronco = (n) => {
    let t = limpia(n);
    for (const m of [...MARCAS, ...ABREVIATURAS]) t = t.replace(m.re, ' ');
    return plano(t);
  };
  const ta = tronco(a), tb = tronco(b);
  const mismaMarca = (ta && tb && (ta === tb || ta.includes(tb) || tb.includes(ta)))
    || pa.includes(pb) || pb.includes(pa);
  if (!mismaMarca) return null;
  const conMarca = ma ? a : b, sinMarca = ma ? b : a;
  return {
    cruza: true,
    filial: limpia(conMarca), principal: limpia(sinMarca), marca: ma || mb,
    aviso: `"${limpia(conMarca)}" es ${ma || mb} y "${limpia(sinMarca)}" es el equipo principal: `
      + 'son rosters distintos. El emparejado por contención no puede distinguirlos, así que o la casa '
      + 'escribió mal el nombre o se está liquidando con el partido del otro equipo.',
  };
}

// ── EL EMPAREJADO COMPLETO, LOS DOS LADOS A LA VEZ ──────────────────────────────────────────────────────
// Devuelve null cuando no hay ningún cruce (el caso normal) y el detalle cuando lo hay. Se le pasan los
// cuatro nombres —los dos de la apuesta y los dos de la fuente, YA ORIENTADOS— porque un cruce en
// cualquiera de los dos lados contamina la liquidación entera.
function cruceEnPar({ pickA, pickB, fuenteA, fuenteB }) {
  const lados = [cruza(pickA, fuenteA), cruza(pickB, fuenteB)].filter(Boolean);
  if (!lados.length) return null;
  return {
    cruza: true, lados,
    resumen: lados.map((x) => `${x.filial} ↔ ${x.principal}`).join(' · '),
    // la etiqueta que viaja en la pick: distinta de 'aproximado' a propósito, para poder contarlas aparte
    etiqueta: 'aproximado_filial',
  };
}

// ── LAS FUSIONES DEL CATÁLOGO ───────────────────────────────────────────────────────────────────────────
// Dos nombres que son equipos distintos y resuelven al mismo id. Esto no se detecta liquidando: se detecta
// mirando el catálogo, y conviene mirarlo ANTES de que los dos equipos coincidan en la agenda.
//   `nombres`  — los que aparecen en el libro o en la agenda
//   `resolver` — (nombre) => id canónico o null
function fusionesEnCatalogo(nombres, resolver) {
  const porId = new Map();
  for (const n of new Set(nombres || [])) {
    let id = null;
    try { id = resolver ? resolver(n) : null; } catch { id = null; }
    const k = id ? 'gp:' + id : plano(n);
    if (!porId.has(k)) porId.set(k, []);
    porId.get(k).push(n);
  }
  const fusiones = [];
  for (const [id, ns] of porId) {
    if (ns.length < 2) continue;
    const conMarca = ns.filter(esFilial), sinMarca = ns.filter((x) => !esFilial(x));
    if (!conMarca.length || !sinMarca.length) continue;   // variantes de mayúsculas: no es una fusión
    fusiones.push({
      id, nombres: ns, filiales: conMarca, principales: sinMarca,
      aviso: `el catálogo devuelve "${id}" tanto para ${JSON.stringify(conMarca)} como para ${JSON.stringify(sinMarca)}: `
        + 'son rosters distintos con el mismo id. En cuanto jueguen el mismo día, una se liquidará con el resultado de la otra.',
    });
  }
  return fusiones;
}

module.exports = { marcaDe, esFilial, cruza, cruceEnPar, fusionesEnCatalogo, MARCAS, ABREVIATURAS };
