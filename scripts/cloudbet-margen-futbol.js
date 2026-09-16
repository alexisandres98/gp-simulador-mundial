#!/usr/bin/env node
// scripts/cloudbet-margen-futbol.js — CUÁNTO COBRA CLOUDBET EN CADA MERCADO DE FÚTBOL (16-sep, A4)
//
// POR QUÉ. El censo del 13-sep abrió quince mercados nuevos en sombra y dejó fuera córners y tarjetas con
// motivo de MODELO (los córners van correlacionados −0,249 entre local y visita, las tarjetas +0,201, así que
// dos Poisson independientes no valen para ninguno). Pero antes de arreglar un modelo hay que saber si el
// mercado paga lo suficiente para que arreglarlo sirva de algo, y eso es el margen. Con el total de goles
// cobrando 0,69 % por lado —el mercado más barato y por eso el más eficiente— la pregunta de A4 es si los
// córners y las mitades cobran tanto que la ventaja que hiciera falta para ganarles sea inalcanzable.
//
// CÓMO. Se emparejan las DOS caras del mismo mercado con `lib/margen.js`, que es el mismo módulo con el que
// se mide Pinnacle y Bovada, para que los números sean comparables entre casas. Dos cuidados que cambian el
// resultado si se ignoran:
//
//  1. **El margen NO es uno por mercado: depende de la línea.** En un total, la línea equilibrada (la que
//     paga cerca de 1,90/1,90) lleva mucho menos sobre-redondeo que las líneas de los extremos, donde la
//     casa se protege. Promediar todas las líneas de un mercado da un número que no paga NADIE, porque al
//     mercado se entra por la línea que se quiere. Por eso se informa aparte la línea EQUILIBRADA — la que
//     tiene las dos caras más cerca de 50/50 — que es la que de verdad se juega.
//  2. **Los mercados de más de dos salidas no se miden igual.** El HT/FT tiene NUEVE resultados y el
//     marcador exacto decenas: ahí no hay «dos caras» que emparejar, el sobre-redondeo es la suma de todas
//     las probabilidades implícitas menos uno, y repartirlo «por lado» no significa nada. Se mide aparte y
//     se dice cuántas salidas tiene, porque un 12 % repartido entre nueve salidas y un 12 % entre dos son
//     cosas distintas.
//
// LO QUE SE RESTA DE VERDAD. `lib/margen.js` informa `margen_lado_pct = sobre_redondeo / 2` y esa es la
// convención con la que están medidos Pinnacle y Bovada, así que se respeta. Pero el coste exacto en
// esperanza de cruzar un mercado con sobre-redondeo R es R/(1+R), no R/2, y se informa también como
// `coste_ev_pct` — para R pequeños son casi iguales y para los mercados caros no.
//
// USO
//   node scripts/cloudbet-margen-futbol.js                     # baja partidos de las ligas grandes
//   node scripts/cloudbet-margen-futbol.js --dir /tmp/cbev     # lee eventos ya bajados (uno por archivo)
//   node scripts/cloudbet-margen-futbol.js --json              # salida JSON en vez de tabla
'use strict';
const fs = require('fs');
const path = require('path');
const MG = require('../lib/margen');

const HOST = process.env.CLOUDBET_API_HOST || 'https://sports-api.cloudbet.com';
const LIGAS = ['soccer-england-premier-league', 'soccer-italy-serie-a', 'soccer-germany-bundesliga',
  'soccer-spain-laliga', 'soccer-usa-major-league-soccer', 'soccer-france-ligue-1'];

// Las familias que A4 viene a contestar, más las de control. El control no es decorativo: sin el total de
// goles al lado, un 4 % en córners no se sabe si es caro o si es lo normal en esta casa.
const FAMILIAS = {
  'soccer.total_goals':                     { nombre: 'TOTAL_GOLES (control)', dos_caras: true },
  'soccer.asian_handicap':                  { nombre: 'HANDICAP_ASIATICO (control)', dos_caras: true },
  'soccer.total_corners':                   { nombre: 'TOTAL_CORNERS', dos_caras: true },
  'soccer.1st_half_total_corners':          { nombre: 'TOTAL_CORNERS_1T', dos_caras: true },
  'soccer.corner_handicap':                 { nombre: 'HANDICAP_CORNERS', dos_caras: true },
  'soccer.total_goals_period_first_half':   { nombre: 'TOTAL_GOLES_1T', dos_caras: true },
  'soccer.total_goals_period_second_half':  { nombre: 'TOTAL_GOLES_2T', dos_caras: true },
  'soccer.total_bookings':                  { nombre: 'TOTAL_TARJETAS', dos_caras: true },
  'soccer.total_booking_points':            { nombre: 'TOTAL_PUNTOS_TARJETA', dos_caras: true },
  'soccer.both_teams_to_score':             { nombre: 'AMBOS_MARCAN', dos_caras: true },
  'soccer.halftime_fulltime_result':        { nombre: 'HT/FT', dos_caras: false },
  'soccer.match_odds':                      { nombre: '1X2 (control)', dos_caras: false },
  'soccer.match_odds_period_second_half':   { nombre: '1X2_2T', dos_caras: false },
  'soccer.correct_score':                   { nombre: 'MARCADOR_EXACTO', dos_caras: false },
};

const LADO = { over: 'over', under: 'under', home: 'home', away: 'away', yes: 'yes', no: 'no' };
const lineaDe = (params) => {
  const m = /(?:total|handicap)=(-?[\d.]+)/.exec(String(params || ''));
  return m ? Number(m[1]) : null;
};

// ── lectura ─────────────────────────────────────────────────────────────────────────────────────────────
async function cbGet(p, key) {
  const r = await fetch(HOST + p, { headers: { 'X-API-Key': key, accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${p}`);
  return r.json();
}
async function bajarEventos(key, porLiga = 8) {
  const out = [];
  for (const lg of LIGAS) {
    let j = null;
    try { j = await cbGet(`/pub/v2/odds/competitions/${encodeURIComponent(lg)}?limit=60`, key); } catch (e) { console.error('  ' + lg + ': ' + e.message); continue; }
    const ev = (j.events || []).filter((e) => e.type === 'EVENT_TYPE_EVENT' && e.home && e.away && e.status === 'TRADING').slice(0, porLiga);
    for (const e of ev) {
      try { out.push(await cbGet(`/pub/v2/odds/events/${e.id}`, key)); } catch { /* un partido que no baja no rompe la medida */ }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  return out;
}
function leerDir(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch { /* archivo roto */ }
  }
  return out;
}

// ── medida ──────────────────────────────────────────────────────────────────────────────────────────────
// Un mercado de dos caras se aplana a filas que `lib/margen.js` entiende. Un mercado de N salidas no se
// aplana: se suma entero, porque no hay pareja que hacer.
function medir(eventos) {
  const filas = [];                       // para lib/margen.js (dos caras)
  const nCaras = {};                      // familias de N salidas
  const porLinea = {};                    // familia → línea → [sobre_redondeo]
  const eq = {};                          // familia → [sobre_redondeo de la línea equilibrada del partido]
  for (const ev of eventos) {
    const M = ev.markets || {};
    for (const [clave, meta] of Object.entries(FAMILIAS)) {
      const mk = M[clave];
      if (!mk || !mk.submarkets) continue;
      for (const sub of Object.values(mk.submarkets)) {
        const sels = (sub.selections || []).filter((s) => s.status === 'SELECTION_ENABLED' && Number(s.price) > 1 && s.side !== 'LAY');
        if (!sels.length) continue;
        if (!meta.dos_caras) {
          const suma = sels.reduce((a, s) => a + 1 / Number(s.price), 0);
          const over = suma - 1;
          if (over > -0.02 && over < 1.5) (nCaras[meta.nombre] = nCaras[meta.nombre] || { over: [], salidas: [] }).over.push(100 * over)
            && nCaras[meta.nombre].salidas.push(sels.length);
          continue;
        }
        // dos caras: se agrupa por línea y se emparejan los lados opuestos
        const porLin = {};
        for (const s of sels) {
          const lado = LADO[String(s.outcome || '').toLowerCase()];
          if (!lado) continue;
          const ln = lineaDe(s.params);
          const k = ln == null ? '-' : String(Math.abs(ln));
          (porLin[k] = porLin[k] || {})[lado] = Number(s.price);
        }
        let mejor = null;                 // la línea EQUILIBRADA de este partido en esta familia
        for (const [k, m] of Object.entries(porLin)) {
          const pares = [['over', 'under'], ['home', 'away'], ['yes', 'no']];
          for (const [a, b] of pares) {
            if (!(m[a] > 1 && m[b] > 1)) continue;
            const over = 1 / m[a] + 1 / m[b] - 1;
            if (!(over > -0.02 && over < 0.6)) continue;
            // EL PARTIDO VIAJA EN LA CLAVE, Y NO ES UN DETALLE. `claveMercado` de lib/margen.js indexa por
            // casa+familia+mapa+periodo+línea, sin nada que distinga un partido de otro, y de las caras
            // repetidas se queda con la de MEJOR cuota. Sin el identificador del partido, los 48 partidos
            // con la misma línea colapsan en un solo mercado y se empareja el over de uno con el under de
            // otro: sale un sobre-redondeo de 0,96 % en el total de goles cuando cada partido por separado
            // cobra 5,7-7,9 %. Es decir, un arbitraje imaginario entre partidos distintos, con la cara de
            // una medición. Se mete el id del evento en `map`, que es el hueco que el módulo reserva para
            // «en qué contienda».
            const ev_id = ev.id != null ? ev.id : `${ev.home && ev.home.name}-${ev.away && ev.away.name}`;
            filas.push({ book: 'cloudbet', family: meta.nombre, map: ev_id, line: k === '-' ? null : Number(k), side: a, odds: m[a] });
            filas.push({ book: 'cloudbet', family: meta.nombre, map: ev_id, line: k === '-' ? null : Number(k), side: b, odds: m[b] });
            ((porLinea[meta.nombre] = porLinea[meta.nombre] || {})[k] = porLinea[meta.nombre][k] || []).push(100 * over);
            // «equilibrada» = la de las dos caras más parecidas, que es la que se juega de verdad
            const desvio = Math.abs((1 / m[a]) / (1 / m[a] + 1 / m[b]) - 0.5);
            if (mejor == null || desvio < mejor.desvio) mejor = { desvio, over: 100 * over };
          }
        }
        if (mejor) (eq[meta.nombre] = eq[meta.nombre] || []).push(mejor.over);
      }
    }
  }
  return { filas, nCaras, porLinea, eq };
}

function informe(eventos) {
  const { filas, nCaras, porLinea, eq } = medir(eventos);
  const res = MG.resumen(filas, { porCasa: false });
  const out = { at: new Date().toISOString(), partidos: eventos.length, familias: {} };
  for (const [fam, v] of Object.entries(res)) {
    const R = v.over_mediana_pct / 100;
    out.familias[fam] = {
      salidas: 2, n_lineas: v.n / 2,
      over_mediana_pct: v.over_mediana_pct,
      margen_lado_pct: v.margen_lado_pct,
      coste_ev_pct: +(100 * (R / (1 + R))).toFixed(2),
      equilibrada_mediana_pct: eq[fam] ? +MG.mediana(eq[fam]).toFixed(2) : null,
      equilibrada_margen_lado_pct: eq[fam] ? +(MG.mediana(eq[fam]) / 2).toFixed(2) : null,
      por_linea: Object.fromEntries(Object.entries(porLinea[fam] || {})
        .map(([k, a]) => [k, { n: a.length, over_mediana_pct: +MG.mediana(a).toFixed(2) }])
        .sort((a, b) => Number(a[0]) - Number(b[0]))),
    };
  }
  for (const [fam, v] of Object.entries(nCaras)) {
    const med = MG.mediana(v.over), R = med / 100;
    out.familias[fam] = { salidas: Math.round(MG.mediana(v.salidas)), n: v.over.length,
      over_mediana_pct: +med.toFixed(2), margen_lado_pct: null,
      coste_ev_pct: +(100 * (R / (1 + R))).toFixed(2),
      nota: 'más de dos salidas: el sobre-redondeo NO se reparte «por lado»' };
  }
  return out;
}

(async () => {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const dir = arg('--dir');
  let eventos = [];
  if (dir) eventos = leerDir(dir);
  else {
    const key = process.env.CLOUDBET_API_KEY || process.env.CLOUDBET_KEY || '';
    if (!key) { console.error('falta CLOUDBET_API_KEY (o usa --dir con eventos ya bajados)'); process.exit(2); }
    console.error('bajando partidos de', LIGAS.length, 'ligas…');
    eventos = await bajarEventos(key);
  }
  if (!eventos.length) { console.error('sin eventos que medir'); process.exit(2); }
  const inf = informe(eventos);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(inf, null, 2)); return; }
  console.log(`\nCLOUDBET · FÚTBOL · ${inf.partidos} partidos · ${inf.at.slice(0, 10)}\n`);
  console.log('familia'.padEnd(30) + 'sal'.padStart(4) + 'sobre%'.padStart(9) + 'lado%'.padStart(8)
    + 'EV%'.padStart(8) + 'equil%'.padStart(9) + 'eq/lado%'.padStart(10));
  const orden = Object.entries(inf.familias).sort((a, b) => (a[1].over_mediana_pct || 0) - (b[1].over_mediana_pct || 0));
  for (const [fam, v] of orden) {
    console.log(fam.padEnd(30) + String(v.salidas).padStart(4)
      + String(v.over_mediana_pct).padStart(9) + String(v.margen_lado_pct == null ? '—' : v.margen_lado_pct).padStart(8)
      + String(v.coste_ev_pct).padStart(8) + String(v.equilibrada_mediana_pct == null ? '—' : v.equilibrada_mediana_pct).padStart(9)
      + String(v.equilibrada_margen_lado_pct == null ? '—' : v.equilibrada_margen_lado_pct).padStart(10));
  }
  console.log('\nsobre% = sobre-redondeo mediano de todas las líneas · lado% = la mitad (convención de lib/margen.js)');
  console.log('EV% = lo que cuesta de verdad cruzar el mercado, R/(1+R) · equil% = solo la línea equilibrada de cada partido\n');
})();
