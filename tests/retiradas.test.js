// tests/retiradas.test.js — LAS FAMILIAS RETIRADAS (T1.9, 15-sep-2026)
//
// Lo que este test fija no es una lista: es la regla de que RETIRAR NO ES APAGAR, y sobre todo que la casa
// forma parte de la identidad de una familia. CS2 hándicap de rondas pierde en Bovada y en Pinnacle y NO
// está cerrada en Cloudbet; si `retirada()` ignorara la casa, la que se retiraría sería la única de las
// tres que todavía puede valer algo.
'use strict';
const R = require('../lib/retiradas');

let fallos = 0;
const t = (nombre, ok) => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}`); };

// ── 1. LA CASA FORMA PARTE DE LA IDENTIDAD ───────────────────────────────────────────────────────────────
t('cs2 RONDAS_HANDICAP está retirada en bovada', !!R.retirada('cs2', 'RONDAS_HANDICAP', 'bovada'));
t('cs2 RONDAS_HANDICAP NO está retirada en pinnacle (revertida el 21-sep: el cierre no aporta en esa familia)', R.retirada('cs2', 'RONDAS_HANDICAP', 'pinnacle') === null);
t('cs2 RONDAS_HANDICAP sigue retirada en bovada', !!R.retirada('cs2', 'RONDAS_HANDICAP', 'bovada'));
t('cs2 RONDAS_HANDICAP NO está retirada en cloudbet', R.retirada('cs2', 'RONDAS_HANDICAP', 'cloudbet') === null);
t('sin casa no se retira nada (una familia no es mala en abstracto)', R.retirada('cs2', 'RONDAS_HANDICAP') === null);
t('una familia que no está en la lista no se retira', R.retirada('cs2', 'TOTAL_MAPAS', 'pinnacle') === null);
t('un deporte que no está en la lista no se retira', R.retirada('tenis', 'RONDAS_HANDICAP', 'pinnacle') === null);

// ── 2. LA ETIQUETA ES `control`, NO "apagada" ────────────────────────────────────────────────────────────
const r = R.retirada('lol', 'KILLS_HANDICAP', 'cloudbet');
t('la retirada trae etiqueta control', r && r.etiqueta === 'control');
t('y trae el motivo medido, no una opinión', r && r.motivo === 'veredicto_cerrar' && r.t < 0 && r.n > 0);
t('y la lectura dice el EV, el t y la muestra', r && /EV /.test(r.lectura) && /t /.test(r.lectura) && /tickets/.test(r.lectura));

// ── 3. VERSIONES RETIRADAS POR CONSTRUCCIÓN ──────────────────────────────────────────────────────────────
t('derivadas_v1 está retirada', !!R.versionRetirada('derivadas_v1'));
t('derivadas_v2 NO está retirada', R.versionRetirada('derivadas_v2') === null);
t('el ganador bruto de combate está retirado', !!R.versionRetirada('ufc_ganador_bruto'));
t('el EV agregado del Boleto GP está retirado', !!R.versionRetirada('boleto_gp_ev_agregado'));
t('una versión inventada no está retirada', R.versionRetirada('cualquier_cosa_v9') === null);
t('el motivo por construcción se distingue del veredicto', R.versionRetirada('derivadas_v1').motivo === 'construccion');

// ── 4. NINGUNA `no_invertible` SE CUELA ──────────────────────────────────────────────────────────────────
// `cs2 RONDAS_HANDICAP cloudbet` quedó en `no_invertible`, no en `cerrar`. No invertible es razón para no
// meter dinero; no es razón para dejar de publicar la lectura. Si algún día entra aquí, este test cae.
t('no_invertible no entra en la lista de retiradas',
  !R.POR_VEREDICTO.some((x) => x.deporte === 'cs2' && x.familia === 'RONDAS_HANDICAP' && x.casa === 'cloudbet'));
t('todas las retiradas por veredicto tienen EV negativo y t ≤ −2',
  R.POR_VEREDICTO.every((x) => x.ev < 0 && x.t <= -2 && x.n >= 100));

// ── 5. EL FEED SIN VEREDICTO (21-sep, orden de Alexis) ───────────────────────────────────────────────────
// Con el interruptor puesto la retirada NO desaparece —la lectura medida sigue viajando— pero trae
// `publica: true` y la pick sale. Apagado, todo vuelve a la doctrina del 15-sep.
const envAntes = process.env.GP_FEED_SIN_VEREDICTO;
process.env.GP_FEED_SIN_VEREDICTO = '1';
const rp = R.retirada('cs2', 'RONDAS', 'bovada');
t('con el feed sin veredicto la retirada sigue existiendo', !!rp && rp.motivo === 'veredicto_cerrar');
t('…y trae publica: true', rp && rp.publica === true);
t('…con la lectura medida intacta', rp && /t -23.34/.test(rp.lectura));
t('el ganador bruto de combate se publica con el interruptor', R.versionRetirada('ufc_ganador_bruto').publica === true);
t('derivadas_v1 NO se publica ni con el interruptor (es un error de cálculo, no una familia sin veredicto)', !R.versionRetirada('derivadas_v1').publica);
t('el EV agregado del Boleto GP tampoco', !R.versionRetirada('boleto_gp_ev_agregado').publica);
process.env.GP_FEED_SIN_VEREDICTO = '0';
t('apagado, la retirada no trae publica', !R.retirada('cs2', 'RONDAS', 'bovada').publica);
t('apagado, el ganador bruto de combate no se publica', !R.versionRetirada('ufc_ganador_bruto').publica);
delete process.env.GP_FEED_SIN_VEREDICTO;
t('sin la env el feed publica (por defecto encendido, como lo ordenó Alexis)', R.retirada('cs2', 'RONDAS', 'bovada').publica === true);
if (envAntes != null) process.env.GP_FEED_SIN_VEREDICTO = envAntes;

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
