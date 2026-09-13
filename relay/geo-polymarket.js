// relay/geo-polymarket.js — DÓNDE DEJA COLOCAR POLYMARKET, SEGÚN POLYMARKET (13-sep-2026)
//
// POR QUÉ EXISTE. Hasta hoy el único mapa de países que teníamos era el de **Cloudbet**, medido en agosto a
// base de probar servidores. `DESPLIEGUE-PM.md` decía, con razón, que ese mapa no sirve para esta casa y
// que habría que volver a medirlo. No hace falta medirlo: la casa lo publica.
// Fuente: https://docs.polymarket.com/developers/CLOB/geoblock — leída el 13-sep-2026.
//
// LO QUE CAMBIA LA DECISIÓN, Y NO ES UN DETALLE:
//   · **Finlandia NO está en ninguna lista.** El servidor de Helsinki no fue una suposición afortunada: es
//     de los pocos sitios desde donde se puede abrir posición.
//   · **Alemania SÍ está** (solo-cerrar), y también Estados Unidos, Reino Unido, Francia, Italia, Bélgica,
//     Polonia, Eslovaquia, Singapur, Brasil, Australia y cuatro provincias de Canadá.
//   · Render tiene exactamente cinco regiones: Oregón, Ohio, Virginia, **Fráncfort** y **Singapur**. Las
//     cinco están bloqueadas. **Ninguna región de Render puede colocar en Polymarket**, así que el
//     servicio `gp-relay-eu` que ya tenemos en Fráncfort NO sirve para esto por mucho que lo controlemos
//     entero con la llave de Render. Comprobado contra la lista antes de intentarlo, no después.
//
// CÓMO SE COMPRUEBA EN VIVO, GRATIS Y SIN CLAVE. Dos sondas independientes:
//   1. `GET https://polymarket.com/api/geoblock` → {blocked, ip, country, region}. Dice el país.
//   2. `POST /order` SIN credenciales → el 403 de región salta ANTES que la autenticación (comprobado), así
//      que un cuerpo vacío basta para saber si la puerta está abierta. Cero riesgo, cero dinero.
// La segunda es la que manda: es la puerta por la que van a pasar las órdenes de verdad.
'use strict';

// Bloqueo total: ni abrir ni cerrar, en web y en API.
const OFAC = new Set(['IR', 'SY', 'CU', 'KP', 'UA-43', 'UA-14', 'UA-09']);

// Solo-cerrar en web Y EN API: se pueden cerrar posiciones, no abrir ninguna. Para nosotros es igual de
// inservible que un bloqueo total — el ejecutor abre.
const SOLO_CERRAR_API = new Set(['AU', 'BY', 'BE', 'BI', 'BR', 'CA-BC', 'CA-ON', 'CA-AB', 'CA-QC', 'CF',
  'CD', 'ET', 'FR', 'DE', 'IQ', 'IT', 'LB', 'LY', 'MM', 'NZ', 'NI', 'KP', 'PL', 'RU', 'SG', 'SO', 'SK',
  'SS', 'SD', 'TW', 'TH', 'GB', 'US', 'UM', 'VE', 'YE', 'ZW']);

// Solo-cerrar en la WEB, pero la API no está restringida. Sirven para el brazo.
const SOLO_WEB = new Set(['IE', 'JP', 'MT', 'NL']);

const FUENTE = 'docs.polymarket.com/developers/CLOB/geoblock · leída 13-sep-2026';

// país + región (ISO 3166-2 cuando la casa distingue subdivisiones, como las provincias de Canadá)
function codigos(country, region) {
  const c = String(country || '').toUpperCase();
  const r = String(region || '').toUpperCase();
  return r ? [c + '-' + r, c] : [c];
}

// El veredicto que importa es uno solo: ¿puede este sitio ABRIR posición?
function veredicto(country, region) {
  const cs = codigos(country, region);
  if (cs.some((c) => OFAC.has(c))) {
    return { puede_abrir: false, clase: 'ofac', por_que: 'jurisdicción sancionada: ni abrir ni cerrar' };
  }
  if (cs.some((c) => SOLO_CERRAR_API.has(c))) {
    return { puede_abrir: false, clase: 'solo_cerrar_api',
      por_que: 'restringida por regulación: la API deja cerrar posiciones, no abrir. El ejecutor abre, así que no sirve' };
  }
  if (cs.some((c) => SOLO_WEB.has(c))) {
    return { puede_abrir: true, clase: 'solo_cerrar_web',
      por_que: 'restringida solo en la web de la casa; la API no lo está. Sirve para el brazo' };
  }
  if (!cs[cs.length - 1]) return { puede_abrir: null, clase: 'desconocido', por_que: 'no se pudo averiguar el país' };
  return { puede_abrir: true, clase: 'permitida', por_que: 'no aparece en ninguna de las tres listas de la casa' };
}

// La sonda de país, que no necesita clave ni dinero.
async function donde({ timeoutMs = 12000 } = {}) {
  try {
    const r = await fetch('https://polymarket.com/api/geoblock', { signal: AbortSignal.timeout(timeoutMs) });
    const j = await r.json();
    return { ok: true, ip: j.ip || null, pais: j.country || null, region: j.region || null,
      bloqueado_dice_la_casa: !!j.blocked, ...veredicto(j.country, j.region), fuente_lista: FUENTE };
  } catch (e) { return { ok: false, error: String((e && e.message) || e).slice(0, 120), fuente_lista: FUENTE }; }
}

module.exports = { donde, veredicto, OFAC, SOLO_CERRAR_API, SOLO_WEB, FUENTE };
