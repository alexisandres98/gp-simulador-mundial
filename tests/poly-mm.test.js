'use strict';
// tests/poly-mm.test.js — market making en sombra sobre Polymarket (7-oct-2026).
// Venue de mentira: `fetch` se sustituye por un despachador que sirve los cruces del data-api, la configuración
// de recompensas del CLOB y la resolución de gamma. Directorio temporal para los ficheros de la prop firm.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-polymm-'));
process.env.GP_PROPFIRM_DIR = TMP;
delete process.env.GP_POLYMM_SPREAD_PP; delete process.env.GP_POLYMM_SIZE; delete process.env.GP_POLYMM_INV_MAX;

const COND = '0xabc', MID = '777';
let trades = [];
let gammaCerrado = null;
let libro = { bb: 0.47, ba: 0.53 };   // el mejor bid y ask del CLOB para el token del outcome 0
global.fetch = async (url) => {
  const u = String(url);
  const body = u.includes('data-api.polymarket.com/trades') ? trades.slice().reverse()
    : u.includes('clob.polymarket.com/book') ? { bids: [{ price: String(libro.bb), size: '100' }, { price: '0.40', size: '500' }], asks: [{ price: '0.60', size: '500' }, { price: String(libro.ba), size: '100' }] }
    : u.includes('clob.polymarket.com/markets/') ? { rewards: { rates: [{ asset_address: '0x', rewards_daily_rate: 12 }], min_size: 50, max_spread: 3.5 }, maker_base_fee: 0, taker_base_fee: 1000 }
    : u.includes('gamma-api.polymarket.com/markets/') ? gammaCerrado
    : null;
  return { ok: body != null, json: async () => body };
};

const COT = require('../propfirm/cotizables');
const MM = require('../propfirm/mm');

const T0 = Math.floor(Date.now() / 1000) * 1000;   // reloj simulado pegado al real: la frescura del consenso se mide contra el reloj de pared
const KO = new Date(T0 + 5 * 3600e3).toISOString();
const mercado = (shin0) => ({ id: MID, conditionId: COND, slug: 'x-vs-y', question: 'Will X win on 2026-10-07?',
  outcomes: '["Yes","No"]', outcomePrices: '["0.5","0.5"]', clobTokenIds: '["t0","t1"]', liquidityNum: 5000,
  feeSchedule: { exponent: 1, rate: 0.03, takerOnly: true, rebateRate: 0.25 }, rewardsMinSize: 50, rewardsMaxSpread: 3.5, orderPriceMinTickSize: 0.01, orderMinSize: 5 });
const tr = (seg, idx, side, price, size) => ({ conditionId: COND, outcomeIndex: idx, side, price, size, timestamp: Math.floor((T0 + seg * 1000) / 1000) });

(async () => {
  // 0) la caja de un mercado: comprar, "vender" (= comprar el otro lado) y fundir pares
  const m0 = { s0: 0, s1: 0, caja: 0, inv0: 0 };
  MM.aplicaFill(m0, 'compra', 50, 0.48); MM.aplicaFill(m0, 'venta', 20, 0.52);
  assert.strictEqual(m0.s0, 30); assert.strictEqual(m0.s1, 0); assert.strictEqual(m0.inv0, 30);
  assert.strictEqual(m0.caja, +(-50 * 0.48 - 20 * 0.48 + 20).toFixed(4));

  // 1) nace el mercado con su cotización a ±2 pp del justo (Shin 0,50): bid 0,48 · ask 0,52 · 50 por lado
  assert.strictEqual(COT.anota({ m: mercado(), deporte: 'futbol', familia: 'FUT1X2', evento: 'X vs Y', ko: KO, consenso0: 0.51, shin0: 0.5, books: 12 }), true);
  COT.guardar();
  let o = await MM.barrer({ ahora: T0 });
  assert.strictEqual(o.nuevos, 1, JSON.stringify(o));
  let L = MM.libro(); let m = L.mercados[0];
  assert.strictEqual(m.cotizacion.bid, 0.48); assert.strictEqual(m.cotizacion.ask, 0.52); assert.strictEqual(m.cotizacion.size, 50);
  assert.strictEqual(m.rewards.tasa_diaria, 12);

  // 2) cruces reales en el intervalo: un taker vende YES a 0,47 (30) → nos llena entero; otro compra NO a 0,53
  //    (= vende YES a 0,47, 20) → completa el bid; otro compra YES EXACTAMENTE a 0,52 (40) → la mitad, 20
  trades = [tr(120, 0, 'SELL', 0.47, 30), tr(150, 1, 'BUY', 0.53, 20), tr(200, 0, 'BUY', 0.52, 40)];
  o = await MM.barrer({ ahora: T0 + 5 * 60e3 });
  assert.strictEqual(o.compras, 2, JSON.stringify(o)); assert.strictEqual(o.ventas, 1);
  m = MM.libro().mercados[0];
  assert.strictEqual(m.q_compras, 50); assert.strictEqual(m.q_ventas, 20);
  assert.strictEqual(m.s0, 30); assert.strictEqual(m.s1, 0); assert.strictEqual(m.inv0, 30);
  assert.strictEqual(m.caja, +(-50 * 0.48 - 20 * 0.48 + 20).toFixed(4));
  assert.strictEqual(m.horquilla_usd, +(50 * 0.02 + 20 * 0.02).toFixed(4));
  assert(m.rebate_potencial > 0 && m.rebate_potencial < 1, 'rebate potencial ' + m.rebate_potencial);
  assert.strictEqual(m.minutos_cotizados, 5); assert.strictEqual(m.minutos_elegibles, 5, 'dentro del perímetro de recompensas (±2 ≤ 3,5; 50 ≥ 50)');
  // los mismos cruces no se vuelven a llenar en la pasada siguiente
  o = await MM.barrer({ ahora: T0 + 10 * 60e3 });
  assert.strictEqual(o.fills, 0, 'sin cruces nuevos no hay fills: ' + JSON.stringify(o));

  // 3) el consenso se mueve a 0,55: markout a 30 min de cada fill, y la cotización nueva lleva el sesgo del inventario
  COT.anota({ m: mercado(), deporte: 'futbol', familia: 'FUT1X2', evento: 'X vs Y', ko: KO, consenso0: 0.56, shin0: 0.55, books: 12 }); COT.guardar();
  trades = []; libro = { bb: 0.54, ba: 0.56 };   // el libro acompaña al consenso: justo mezclado 0,55
  o = await MM.barrer({ ahora: T0 + 40 * 60e3 });
  m = MM.libro().mercados[0];
  assert.strictEqual(m.markout_n, 3);
  assert.strictEqual(m.markout_usd, +(0.07 * 30 + 0.07 * 20 - 0.03 * 20).toFixed(4));
  assert.strictEqual(m.cotizacion.bid, 0.52, 'bid con sesgo: floor(0,55−0,02−0,003)'); assert.strictEqual(m.cotizacion.ask, 0.57, 'ask con sesgo: ceil(0,55+0,02−0,003)');

  // 4) a 10 min del saque se retira; a los 30 min del saque gamma resuelve YES → P&L = caja + s0
  o = await MM.barrer({ ahora: Date.parse(KO) - 10 * 60e3 });
  assert.strictEqual(o.retirados, 1, JSON.stringify(o));
  gammaCerrado = { id: MID, closed: true, outcomePrices: '["1","0"]' };
  let l = await MM.liquidar({ ahora: Date.parse(KO) + 20 * 60e3 });
  assert.strictEqual(l.esperando, 1, 'antes de 30 min no se mira');
  l = await MM.liquidar({ ahora: Date.parse(KO) + 40 * 60e3 });
  assert.strictEqual(l.resueltos, 1, JSON.stringify(l));
  L = MM.libro();
  assert.strictEqual(L.cerrados.length, 1);
  assert.strictEqual(L.cerrados[0].pnl, +(-50 * 0.48 - 20 * 0.48 + 20 + 30).toFixed(2));
  assert.strictEqual(L.cerrados[0].tope_recompensa_usd, +(12 * L.cerrados[0].minutos_elegibles / 1440).toFixed(2));
  assert.strictEqual(L.efectivo, +(2000 + L.cerrados[0].pnl).toFixed(2));
  const E = MM.estado();
  assert.strictEqual(E.cerrados.mercados, 1); assert.strictEqual(E.por_deporte[0].k, 'futbol');

  // 5) tope de inventario y colateral: cargado al tope por el lado largo, el bid se apaga; sin caja, nada
  const cfg = MM.CFG();
  const mInv = { inv0: cfg.inv_max, tick: 0.01 };
  const q = MM.cotiza(mInv, 0.5, 2000, cfg);
  assert.strictEqual(q.bid, null); assert(q.ask != null);
  assert.strictEqual(MM.cotiza({ inv0: 0, tick: 0.01 }, 0.5, 1, cfg), null, 'sin colateral no se cotiza ningún lado');
  assert.strictEqual(MM.cotiza({ inv0: 0, tick: 0.01 }, 0.05, 2000, cfg).bid, null, 'fuera de la banda de precio por abajo');

  // 6) nunca se cruza el libro, y el justo mezcla consenso y libro (o se pausa si discrepan de más)
  const qx = MM.cotiza({ inv0: 0, tick: 0.01 }, 0.527, 2000, cfg, Date.now(), { bb: 0.56, ba: 0.57 });
  assert.strictEqual(qx.bid, 0.5, 'bid natural 0,50 ≤ mejor ask − tick'); assert.strictEqual(qx.ask, 0.57, 'ask natural 0,55 recortado a mejor bid + tick');
  const qy = MM.cotiza({ inv0: 0, tick: 0.01 }, 0.6, 2000, cfg, Date.now(), { bb: 0.50, ba: 0.52 });
  assert.strictEqual(qy.bid, 0.51, 'bid natural 0,58 recortado a mejor ask − tick'); assert.strictEqual(qy.ask, 0.62);
  assert.deepStrictEqual(MM.justoDe(0.5, { bb: 0.47, ba: 0.53, mid: 0.5 }, cfg), { justo: 0.5, discrepancia_pp: 0 });
  assert.strictEqual(MM.justoDe(0.52, { bb: 0.55, ba: 0.57, mid: 0.56 }, cfg).justo, 0.54, 'mezcla a partes iguales');
  assert.strictEqual(MM.justoDe(0.40, { bb: 0.55, ba: 0.57, mid: 0.56 }, cfg).justo, null, 'discrepancia de 16 pp: no se cotiza');
  assert.strictEqual(MM.justoDe(0.40, null, cfg).justo, 0.40, 'sin libro, el consenso manda');
  // 7) un Shin ausente se guarda como null, no como 0 (el fallo del 7-oct dejó tenis y esports fuera por 'precio')
  const m2 = { ...mercado(), id: '778', conditionId: '0xdef' };
  assert.strictEqual(COT.anota({ m: m2, deporte: 'tenis', familia: 'ML', evento: 'A vs B', ko: KO, consenso0: 0.656, shin0: undefined, books: 5 }), true);
  const c2 = COT.todos().find((c) => c.cond === '0xdef');
  assert.strictEqual(c2.shin0, null); assert.strictEqual(c2.consenso0, 0.656);
  assert.strictEqual(MM.porQueNo(c2, cfg, T0), null, 'elegible con el consenso del escáner: ' + MM.porQueNo(c2, cfg, T0));
  console.log('poly-mm: todo correcto (' + TMP + ')');
})().catch((e) => { console.error(e); process.exit(1); });
