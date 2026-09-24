// tests/polymarket-v2.test.js — LA REGLA pm_v2 DE LA SOMBRA DE POLYMARKET (24-sep-2026).
//
// Fija las tres reglas que Alexis ordenó aplicar (Shin en fútbol, listón neto de costes, perímetro de
// precio/hora/familia), que la v1 sigue siendo el control congelado (no ve lo `solo_v2`) y que los dos
// libros no se pisan el archivo.
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
process.env.GP_PROPFIRM_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pmv2-'));
const V2 = require('../propfirm/v2');
const PF = require('../propfirm/scan');
const PS = require('../propfirm/polyshadow');
const DEVIG = require('../lib/devig');

let fallos = 0;
const t = (nombre, ok) => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}`); };
const H = 3600e3;
const ahora = Date.parse('2026-09-24T12:00:00Z');
const base = { deporte: 'futbol', familia: 'FUT1X2', lado: 'No', resultado: 'home', consenso: 0.55, fee_rate: 0.03, fee_exp: 1 };

// ── 1. PERÍMETRO DE FAMILIAS ─────────────────────────────────────────────────────────────────────────────
t('fútbol No entra', V2.familiaOk(base));
t('fútbol Yes NO entra (−10,6 % en la v1)', !V2.familiaOk({ ...base, lado: 'Yes' }));
t('fútbol No sobre el empate NO entra (−24 %)', !V2.familiaOk({ ...base, resultado: 'draw' }));
t('CS2 mapa de tier 1-2 entra', V2.familiaOk({ deporte: 'cs2', familia: 'MAPA', nivel: 'tier1-2' }));
t('CS2 serie de tier 3 NO entra (−26 %)', !V2.familiaOk({ deporte: 'cs2', familia: 'SERIE', nivel: 'tier3' }));
t('CS2 hándicap de mapas NO entra (−47 %)', !V2.familiaOk({ deporte: 'cs2', familia: 'HANDICAP', nivel: 'tier1-2' }));
t('LoL NO entra (−14 %)', !V2.familiaOk({ deporte: 'lol', familia: 'SERIE', nivel: 'tier1-2' }));
t('tenis ML entra (deporte nuevo)', V2.familiaOk({ deporte: 'tenis', familia: 'ML' }));
t('Valorant y Dota 2 mapa/serie entran (deportes nuevos)', V2.familiaOk({ deporte: 'valorant', familia: 'MAPA' }) && V2.familiaOk({ deporte: 'dota2', familia: 'SERIE' }));
t('el nivel se lee del nombre del torneo', V2.nivelEsports('BLAST Premier Fall Final') === 'tier1-2' && V2.nivelEsports('CCT Europe Series #9') === 'tier3' && V2.nivelEsports('') === 'desconocido');

// ── 2. LISTÓN NETO Y BANDA DE PRECIO ─────────────────────────────────────────────────────────────────────
const ko = new Date(ahora + 1.5 * H).toISOString();
const e1 = V2.evaluar({ ...base, ko }, { ahora, precio: 0.48 });
t('consenso 0,55 a precio 0,48: neta ≈ 7 − com(0,75) − slip(1) ≈ 5,3 pp → entra', e1.ok && e1.edge_neto_pp > 5 && e1.edge_neto_pp < 5.6);
const e2 = V2.evaluar({ ...base, ko }, { ahora, precio: 0.52 });
t('a 0,52 la neta queda ≈ 1,25 pp: NO entra por edge', !e2.ok && e2.motivo === 'edge');
t('a 0,35 no entra por precio aunque la ventaja sea grande', V2.evaluar({ ...base, ko }, { ahora, precio: 0.35 }).motivo === 'precio');
t('a 0,72 no entra por precio', V2.evaluar({ ...base, consenso: 0.85, ko }, { ahora, precio: 0.72 }).motivo === 'precio');
t('con esFill el deslizamiento ya no se resta', V2.evaluar({ ...base, ko }, { ahora, precio: 0.48, esFill: true }).edge_neto_pp > e1.edge_neto_pp);
t('el consenso Shin manda cuando viaja en la señal', V2.evaluar({ ...base, consenso_shin: 0.50, ko }, { ahora, precio: 0.48 }).motivo === 'edge');

// ── 3. LA VENTANA DE 2 H ─────────────────────────────────────────────────────────────────────────────────
t('a 5 h del saque: temprano', V2.evaluar({ ...base, ko: new Date(ahora + 5 * H).toISOString() }, { ahora, precio: 0.48 }).motivo === 'temprano');
t('a 1,5 h: entra', V2.evaluar({ ...base, ko }, { ahora, precio: 0.48 }).ok);
t('ya empezado: empezado', V2.evaluar({ ...base, ko: new Date(ahora - H).toISOString() }, { ahora, precio: 0.48 }).motivo === 'empezado');
t('en el escaneo (exigirHora=false) lo temprano no se descarta', V2.evaluar({ ...base, ko: new Date(ahora + 5 * H).toISOString() }, { ahora, precio: 0.48, exigirHora: false }).ok);

// ── 4. SHIN CONTRA PROPORCIONAL: el longshot baja ────────────────────────────────────────────────────────
const casas = [{ home: 1.45, draw: 4.6, away: 7.0 }, { home: 1.47, draw: 4.5, away: 6.8 }, { home: 1.44, draw: 4.7, away: 7.2 }];
const sh = DEVIG.shinConsensus1x2(casas);
t('Shin da al visitante (longshot) MENOS probabilidad que el proporcional', sh.fair.away < sh.fair_prop.away);
t('…y al favorito más', sh.fair.home > sh.fair_prop.home);

// ── 5. LA v1 NO CAMBIA: `decidir` conserva su listón y marca lo que solo quiere la v2 ────────────────────
const d1 = PF.decidir({ ...base, ko }, { edgeV1: 5, precio: 0.48 });
t('edge bruto 5 pp: la v1 la crea y la v2 también → no es solo_v2', d1.crear && !d1.solo_v2 && d1.v2.elegible);
const d2 = PF.decidir({ ...base, ko }, { edgeV1: 3.5, precio: 0.48, consensoV2: 0.56 });
t('edge bruto 3,5 pp (bajo el 4 de la v1) pero neta v2 ≥ 3 con Shin: nace solo_v2', d2.crear && d2.solo_v2);
const d3 = PF.decidir({ ...base, lado: 'Yes', ko }, { edgeV1: 3.5, precio: 0.48 });
t('edge bruto 3,5 y fuera del perímetro v2: no nace', !d3.crear);
const d4 = PF.decidir({ ...base, ko }, { edgeV1: 14, precio: 0.30 });
t('edge bruto 14 (techo de cordura de la v1) y precio 0,30: no nace', !d4.crear);

// ── 6. DOS LIBROS, DOS ARCHIVOS ──────────────────────────────────────────────────────────────────────────
t('los libros tienen archivos distintos', PS.LIBROS.v1.fname !== PS.LIBROS.v2.fname);
PS.reset('v2');
t('el reset del v2 no toca al v1', !fs.existsSync(path.join(process.env.GP_PROPFIRM_DIR, PS.LIBROS.v1.fname)) && fs.existsSync(path.join(process.env.GP_PROPFIRM_DIR, PS.LIBROS.v2.fname)));
const ev2 = PS.estadoV2();
t('el estado v2 declara su regla y sus parámetros', ev2.regla === 'pm_v2' && ev2.reglas && ev2.reglas.horas_max_al_saque === 2 && ev2.reglas.edge_neto_min_pp === 3);
t('el export de posiciones sabe de qué libro es', PS.posiciones('v2').libro === 'v2' && PS.posiciones('v1').libro === 'v1');

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
