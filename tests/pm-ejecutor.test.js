// tests/pm-ejecutor.test.js — LOS FRENOS DEL EJECUTOR DE POLYMARKET
//
// Sin red y sin clave: el barrido recibe inyectada la función que coloca, así que aquí se prueba lo único
// que de verdad decide el ejecutor — a qué señales dice que sí, con cuánto, y cuándo se planta. Cada caso
// de abajo corresponde a un error que ya nos costó dinero en Cloudbet, y esa es la razón de que existan.
'use strict';
const assert = require('assert');
const fs = require('fs');

process.env.GP_PM_DIR = fs.mkdtempSync('/tmp/pm-test-');
process.env.GP_PM_BANCO = '200';
process.env.GP_PM_STAKE = '5';
process.env.GP_PM_ENABLED = '1';
process.env.GP_PM_FAMILIAS = 'futbol:no';
process.env.GP_PM_MAX_EXPOSICION = '100';
process.env.GP_PM_MIN_SHARES = '5';
const EJ = require('../polymarket/ejecutor');

let n = 0;
const t = async (nombre, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + nombre + ': ' + e.message); process.exitCode = 1; } };

const ko = () => new Date(Date.now() + 6 * 3600e3).toISOString();
const senal = (id, ev, lado, precio, extra = {}) => [id, { id, estado: 'ABIERTA', deporte: 'futbol', lado,
  evento: ev, mercado: 'Will X win on 2026-09-14?', precio_pm: precio, limite: precio, ko: ko(),
  token: '123456789', outcome_idx: 1, pm_mid: '999', consenso: 0.6, edge_pp: 4, ...extra }];
const limpia = () => EJ.reset();
const colocador = (registro) => async (o) => { registro.push(o); return { ok: true, status: 200, respuesta: { orderID: 'ord-' + registro.length, success: true } }; };

(async () => {
  await t('NO apila: dos señales del mismo partido y familia dejan UNA', async () => {
    limpia();
    const puestas = [];
    const r = await EJ.barrer({
      senales: Object.fromEntries([senal('a', 'Alfa vs Beta', 'No', 0.5), senal('b', 'Alfa vs Beta', 'No', 0.52),
        senal('c', 'Alfa vs Beta', 'No', 0.55), senal('d', 'Gamma vs Delta', 'No', 0.4)]),
      colocarFn: colocador(puestas),
    });
    assert.strictEqual(r.colocadas, 2, 'debían entrar 2 (una por partido)');
    assert.strictEqual(r.apiladas, 2, 'dos tenían que caer por apilamiento');
  });

  await t('solo entran las familias de la lista', async () => {
    limpia();
    const puestas = [];
    const r = await EJ.barrer({
      senales: Object.fromEntries([senal('a', 'A vs B', 'No', 0.5), senal('b', 'C vs D', 'Yes', 0.5),
        senal('c', 'E vs F', 'home', 0.5, { deporte: 'cs2' })]),
      colocarFn: colocador(puestas),
    });
    assert.strictEqual(r.colocadas, 1);
    assert.strictEqual(r.fuera_de_familia, 2);
  });

  await t('el tamaño sale del stake configurado, no de una fórmula escondida', async () => {
    limpia();
    const puestas = [];
    await EJ.barrer({ senales: Object.fromEntries([senal('a', 'A vs B', 'No', 0.5)]), colocarFn: colocador(puestas) });
    assert.strictEqual(puestas[0].size, 10, '5 dólares a 0,50 son 10 acciones');
    assert.strictEqual(puestas[0].price, 0.5);
    assert.strictEqual(puestas[0].side, 'BUY');
  });

  await t('si no se llega al mínimo de acciones de la casa, no se coloca', async () => {
    // HALLAZGO al escribir esta prueba: con stake de 5 dólares el mínimo de la casa NO PUEDE morder nunca,
    // porque un precio de share siempre es menor que 1 y por tanto 5/precio siempre da 5 acciones o más.
    // La rama solo se alcanza con un stake más pequeño. Queda escrito porque es justo el tipo de dato que
    // hace falta si algún día se baja el stake: por debajo de 5 dólares empieza a haber señales que la
    // casa rechazaría por tamaño, y eso es capacidad perdida que hay que contar, no un fallo.
    limpia();
    const guarda = process.env.GP_PM_STAKE;
    process.env.GP_PM_STAKE = '3';                      // 3 / 0,99 = 3 acciones, por debajo del mínimo de 5
    const puestas = [];
    const r = await EJ.barrer({ senales: Object.fromEntries([senal('a', 'A vs B', 'No', 0.99)]), colocarFn: colocador(puestas) });
    process.env.GP_PM_STAKE = guarda;
    assert.strictEqual(r.colocadas, 0);
    assert.ok(String(JSON.stringify(r.detalle)).includes('mínimo'), JSON.stringify(r.detalle));
  });
  await t('con stake de 5 dólares el mínimo de la casa nunca bloquea', async () => {
    limpia();
    const puestas = [];
    const r = await EJ.barrer({ senales: Object.fromEntries([senal('a', 'A vs B', 'No', 0.99)]), colocarFn: colocador(puestas) });
    assert.strictEqual(r.colocadas, 1, 'a 0,99 con 5 dólares salen 5 acciones, que es el mínimo justo');
    assert.strictEqual(puestas[0].size, 5);
  });

  await t('el tope de exposición corta antes de vaciar el banco', async () => {
    limpia();
    const puestas = [];
    const muchas = Object.fromEntries(Array.from({ length: 40 }, (_, i) => senal('s' + i, 'Ev' + i + ' vs X', 'No', 0.5)));
    const r = await EJ.barrer({ senales: muchas, colocarFn: colocador(puestas) });
    const gastado = puestas.reduce((a, o) => a + o.size * o.price, 0);
    assert.ok(gastado <= 100 + 1e-9, 'se pasó del tope: ' + gastado);
    assert.ok(r.por_tope > 0, 'el contador de tope no se movió');
  });

  await t('una segunda pasada no duplica lo ya colocado', async () => {
    limpia();
    const s = Object.fromEntries([senal('a', 'A vs B', 'No', 0.5), senal('b', 'C vs D', 'No', 0.4)]);
    const p1 = []; await EJ.barrer({ senales: s, colocarFn: colocador(p1) });
    const p2 = []; const r2 = await EJ.barrer({ senales: s, colocarFn: colocador(p2) });
    assert.strictEqual(p2.length, 0, 'no debía colocar nada la segunda vez');
    assert.strictEqual(r2.ya_estaban, 2);
  });

  await t('una señal cuyo partido ya empezó no se toca', async () => {
    limpia();
    const puestas = [];
    const vieja = senal('a', 'A vs B', 'No', 0.5); vieja[1].ko = new Date(Date.now() - 3600e3).toISOString();
    const r = await EJ.barrer({ senales: Object.fromEntries([vieja]), colocarFn: colocador(puestas) });
    assert.strictEqual(r.revisadas, 0);
    assert.strictEqual(puestas.length, 0);
  });

  await t('en SECO no se coloca nada ni se anota posición', async () => {
    limpia();
    const puestas = [];
    const r = await EJ.barrer({ senales: Object.fromEntries([senal('a', 'A vs B', 'No', 0.5)]),
      colocarFn: colocador(puestas), forzarSeco: true });
    assert.strictEqual(puestas.length, 0, 'en seco no se llama al brazo');
    assert.strictEqual(r.seco, true);
    assert.strictEqual(EJ.estado().abiertas, 0, 'en seco no se anota posición');
    assert.ok(r.detalle.some((d) => d.seco), 'pero sí se dice qué se habría hecho');
  });

  await t('una orden rechazada por la casa no descuenta dinero', async () => {
    limpia();
    const antes = EJ.estado().efectivo;
    await EJ.barrer({ senales: Object.fromEntries([senal('a', 'A vs B', 'No', 0.5)]),
      colocarFn: async () => ({ ok: false, status: 400, rechazado_por_el_brazo: 'no cuela' }) });
    const e = EJ.estado();
    assert.strictEqual(e.efectivo, antes, 'el efectivo no puede bajar por una orden rechazada');
    assert.strictEqual(e.rechazadas, 1);
    assert.strictEqual(e.abiertas, 0);
  });

  await t('guarda el fill simulado al lado del real, que es el dato del experimento', async () => {
    limpia();
    await EJ.barrer({ senales: Object.fromEntries([senal('a', 'A vs B', 'No', 0.5)]),
      colocarFn: colocador([]), simularFn: async () => ({ shares: 10, costo: 4.8, precio_medio: 0.48 }) });
    const e = EJ.estado();
    assert.strictEqual(e.ejecucion.n, 1);
    // pagamos 0,50 y la sombra decía 0,48 → el real sale 2 pp peor
    assert.ok(Math.abs(e.ejecucion.deslizamiento_real_vs_simulado_pp - 2) < 0.01, JSON.stringify(e.ejecucion));
    assert.ok(/PEOR/.test(e.ejecucion.lectura));
  });

  await t('la política se lee de las variables, sin números escondidos', () => {
    const c = EJ.CFG();
    assert.strictEqual(c.banco, 200);
    assert.strictEqual(c.stake, 5);
    assert.strictEqual(EJ.topeExposicion(c), 100);
    assert.deepStrictEqual(c.familias, ['futbol:no']);
  });

  await t('sin tope explícito, la exposición máxima es la mitad del banco', () => {
    const guarda = process.env.GP_PM_MAX_EXPOSICION;
    delete process.env.GP_PM_MAX_EXPOSICION;
    assert.strictEqual(EJ.topeExposicion(EJ.CFG()), 100);
    process.env.GP_PM_MAX_EXPOSICION = guarda;
  });

  // ── EL ALTA: LA PUERTA DE SALIDA A DINERO REAL ────────────────────────────────────────────────────────
  // Estas pruebas existen por un fallo real: la ruta leía el diagnóstico un nivel por encima de donde
  // están los campos, así que los tres primeros escalones salían en ROJO con el brazo perfectamente sano
  // — y un alta que dice que no cuando todo está bien es peor que una que se rompe, porque manda a buscar
  // el problema donde no está. Salió probando el alta entera con la cuenta de pruebas.
  const diagBueno = {
    clave_presente: true, bloqueado_por_region: false,
    firmante: '0x0bcaaf8130f073e72ea525ddd0c3af588add95aa',
    maker_configurado: '0x922eeC312Eeb050184e47b633098A8ABc898F805',
    maker_igual_firmante: false,
    donde_estamos: { pais: 'FI', puede_abrir: true },
    lectura: { status: 200, ok: true }, trading: { status: 401 },
    credenciales: { ok: true, api_key_cola: 'ef05cd' },
  };

  await t('con todo en orden, los cinco escalones pasan', () => {
    const r = EJ.pasosAlta({ diag: diagBueno, tipoFirma: { ok: true, tipo_firma: 'proxy', cancelada: true } });
    assert.strictEqual(r.alta_completa, true, JSON.stringify(r.paso.filter((p) => !p.ok)));
    assert.strictEqual(r.paso.length, 5);
    assert.strictEqual(r.paso[3].tipo_firma, 'proxy');
    // encendido está en 1 en estas pruebas, así que el veredicto tiene que ser el de "colocará"
    assert.match(r.veredicto, /LISTO Y ENCENDIDO/);
  });

  await t('un diagnóstico vacío NO puede dar el alta por buena', () => {
    for (const d of [undefined, null, {}, { clave_presente: true }, { bloqueado_por_region: false }]) {
      const r = EJ.pasosAlta({ diag: d, tipoFirma: { ok: true, tipo_firma: 'proxy' } });
      assert.strictEqual(r.alta_completa, false, 'no debería pasar con: ' + JSON.stringify(d));
    }
  });

  await t('cada escalón cae por su propio motivo, y solo por el suyo', () => {
    const casos = [
      [{ ...diagBueno, clave_presente: false }, 1],
      [{ ...diagBueno, bloqueado_por_region: true }, 1],
      [{ ...diagBueno, firmante: null }, 2],
      [{ ...diagBueno, credenciales: { ok: false, status: 401 } }, 3],
    ];
    for (const [d, n] of casos) {
      const r = EJ.pasosAlta({ diag: d, tipoFirma: { ok: true, tipo_firma: 'proxy' } });
      const malos = r.paso.filter((p) => !p.ok).map((p) => p.n);
      assert.ok(malos.includes(n), `el escalón ${n} debía caer; cayeron ${JSON.stringify(malos)}`);
      // y el 4 no se intenta si los tres primeros no están: preguntar el tipo de firma manda una orden
      if (n <= 3) assert.ok(!r.paso.some((p) => p.n === 4 && p.ok), 'no se intenta el 4 sin los tres primeros');
    }
  });

  await t('sin token, el escalón 4 dice qué falta en vez de fallar en silencio', () => {
    const r = EJ.pasosAlta({ diag: diagBueno });
    const p4 = r.paso.find((p) => p.n === 4);
    assert.strictEqual(p4.ok, false);
    assert.match(p4.falta, /token_id/);
  });

  await t('si el brazo no contesta JSON, el alta dice POR QUÉ y no se lo calla', () => {
    const r = EJ.pasosAlta({ diag: {}, transporteDiag: { status: 502, texto: 'Bad Gateway' } });
    assert.strictEqual(r.alta_completa, false);
    assert.strictEqual(r.paso[0].detalle.transporte.status, 502);
  });

  await t('el tipo de firma que devuelve la casa se propaga tal cual, sin inventar', () => {
    const r = EJ.pasosAlta({ diag: diagBueno, tipoFirma: { ok: false, why: 'ningún tipo de firma valió', intentos: [{ tipo: 'proxy' }, { tipo: 'safe' }] } });
    const p4 = r.paso.find((p) => p.n === 4);
    assert.strictEqual(p4.ok, false);
    assert.strictEqual(p4.why, 'ningún tipo de firma valió');
    assert.strictEqual(p4.intentos.length, 2);
    assert.strictEqual(r.alta_completa, false);
  });

  fs.rmSync(process.env.GP_PM_DIR, { recursive: true, force: true });
  console.log(`pm-ejecutor: ${n} pruebas OK`);
})();
