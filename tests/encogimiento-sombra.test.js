// tests/encogimiento-sombra.test.js — LA DOBLE CORRIDA NO PUEDE HACER TRAMPA (16-sep, M1 · B1)
//
// Una doble corrida en la que el parámetro se reajusta sobre la marcha no es una prueba prospectiva: cada
// pick acabaría evaluada con un `c` que ya vio datos posteriores a ella. Lo que se fija aquí es que el `c`
// se congele, que la cohorte no cambie bajo los pies, y que el módulo diga en voz alta el dato que de
// verdad decide — cuántas picks habrían nacido con la versión encogida.
'use strict';
const path = require('path');
const fs = require('fs');

// almacén temporal: no se toca el de producción
const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'enc-sombra-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
const SB = require('../lib/encogimiento-sombra');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

// ── 1. SIN CONGELAR NO HAY CORRIDA ──────────────────────────────────────────────────────────────────────
t('sin congelar, el track lo dice y no inventa nada', SB.track().activo === false, JSON.stringify(SB.track()).slice(0, 80));

// ── 2. CONGELAR FIJA EL c CON SU FECHA ──────────────────────────────────────────────────────────────────
const cong = SB.congelar({
  'cs2 · RONDAS': { c: 0.15, n: 488, veredicto: 'el_modelo_aporta', c_no_distinguible_de_cero: true, ic_de_c: { ic: [0, 0.65] } },
  'lol · KILLS_HANDICAP': { c: 0, n: 451, veredicto: 'el_modelo_no_aporta' },
});
t('el congelado guarda las familias con su c', cong.n_familias === 2 && cong.familias['cs2 · RONDAS'].c === 0.15);
t('y cuenta cuántas tienen c positivo', cong.n_con_c_positivo === 1, String(cong.n_con_c_positivo));
t('y se queda con el aviso de que ese c no está medido',
  cong.familias['cs2 · RONDAS'].no_distinguible_de_cero === true);
t('y lleva fecha', /^\d{4}-\d{2}-\d{2}T/.test(cong.at), cong.at);

// ── 3. ANOTAR NO CAMBIA UNA PICK YA ANOTADA ─────────────────────────────────────────────────────────────
// Si la cohorte pudiera reescribirse, la comparación de los 14 días se haría sobre un conjunto que ya no es
// el que se fijó, y eso es indistinguible de elegir los datos a posteriori.
const st = SB.rd();
const a1 = SB.anota(st, { id: 'p1', familia: 'cs2 · RONDAS', p_gp: 0.62, odds: 1.90, odds_contraria: 1.90 });
t('una pick con precio y modelo se anota', a1 && Number.isFinite(a1.p_encogida), JSON.stringify(a1));
t('la encogida cae ENTRE el precio y el modelo', a1.p_encogida > 0.5 && a1.p_encogida < 0.62,
  `precio 0.5 · encogida ${a1.p_encogida} · modelo 0.62`);
const a2 = SB.anota(st, { id: 'p1', familia: 'cs2 · RONDAS', p_gp: 0.99, odds: 1.90, odds_contraria: 1.90 });
t('anotarla otra vez NO la cambia', a2 === null && st.filas.p1.p_gp === 0.62, JSON.stringify(st.filas.p1));

// ── 4. CON c = 0 LA PICK NO HABRÍA NACIDO, Y SE DICE ────────────────────────────────────────────────────
// Es el dato que no se ve en el log-loss y que decide de verdad: con c = 0 la probabilidad publicada ES el
// precio, así que la ventaja contra el precio es cero POR CONSTRUCCIÓN y no nace ninguna pick.
const a3 = SB.anota(st, { id: 'p2', familia: 'lol · KILLS_HANDICAP', p_gp: 0.70, odds: 1.90, odds_contraria: 1.90 });
t('con c = 0 la encogida es exactamente el precio', Math.abs(a3.p_encogida - 0.5) < 1e-9, String(a3.p_encogida));
t('y se marca que NO habría nacido', a3.habria_nacido === false, JSON.stringify(a3));

// ── 5. SIN PRECIO SIN MARGEN NO SE INVENTA NADA ─────────────────────────────────────────────────────────
const a4 = SB.anota(st, { id: 'p3', familia: 'cs2 · RONDAS', p_gp: 0.6, odds: 1.90 });  // sin contraria
t('sin la cara contraria no se encoge y se dice el motivo',
  a4 && a4.p_encogida == null && /precio sin margen/.test(a4.motivo), JSON.stringify(a4));
const a5 = SB.anota(st, { id: 'p4', familia: 'motor · DESCONOCIDA', p_gp: 0.6, odds: 1.9, odds_contraria: 1.9 });
t('una familia sin c congelado se anota con su motivo', a5 && /sin c congelado/.test(a5.motivo), JSON.stringify(a5));

// ── 6. EL TRACK SOLO CUENTA LO NACIDO DESPUÉS DEL CONGELADO ─────────────────────────────────────────────
SB.liquida(st, 'p1', 1);
SB.liquida(st, 'p2', 0);
SB.wr(st);
const tr = SB.track();
t('la corrida está activa y fechada', tr.activo === true && tr.congelado_at === cong.at);
t('cuenta las liquidadas de la cohorte', tr.liquidadas_de_la_cohorte === 2, String(tr.liquidadas_de_la_cohorte));
t('y compara las dos versiones por familia', Array.isArray(tr.tabla) && tr.tabla.length === 2,
  JSON.stringify(tr.tabla.map((x) => x.familia)));
t('la tabla trae el log-loss de las tres: crudo, encogido y precio',
  tr.tabla.every((f) => Number.isFinite(f.logloss_crudo) && Number.isFinite(f.logloss_encogido) && Number.isFinite(f.logloss_precio)));

// ── 7. EL DATO QUE DECIDE, ESCRITO ──────────────────────────────────────────────────────────────────────
t('dice cuántas picks habrían nacido con la encogida', Number.isFinite(tr.picks_que_habrian_nacido_con_la_encogida),
  String(tr.picks_que_habrian_nacido_con_la_encogida));
t('y no se declara listo antes de los 14 días', tr.listo === false, `${tr.dias_corridos} días`);
t('y deja escrito que no toca el feed', /NO toca la creación de picks/.test(String(tr.no_cambia_el_feed)));

// ── 8. RECONGELAR ES EXPLÍCITO Y GUARDA LO ANTERIOR ─────────────────────────────────────────────────────
const cong2 = SB.congelar({ 'cs2 · RONDAS': { c: 0.5, n: 500, veredicto: 'el_modelo_aporta' } }, { motivo: 'prueba' });
const st2 = SB.rd();
t('recongelar deja la tabla anterior en el historial', Array.isArray(st2.historial) && st2.historial.length === 1
  && st2.historial[0].at === cong.at);
t('y el c nuevo manda', SB.cDe(st2, 'cs2 · RONDAS') === 0.5);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
