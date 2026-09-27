'use strict';
// tests/boletos.test.js — el resto en boletos hermanos cuando la casa capa el stake por boleto (27-sep-2026).
// Casa de mentira: acepta cualquier boleto de hasta 10,32 y contesta STAKE_ABOVE_MAX con tope 10,3152 por
// encima (lo que Cloudbet hizo en Pumas–San Luis). Libro temporal: DB_FILE apunta a un directorio vacío.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-boletos-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.GP_REAL_ENABLED = '1';
process.env.GP_REAL_DRY = '0';
process.env.CLOUDBET_API_KEY = 'llave-de-mentira';
process.env.GP_REAL_NOTIONAL = '2000';
process.env.GP_REAL_STAKE_FLAT = '30';
delete process.env.GP_REAL_KICKOFF_MAX;
delete process.env.GP_REAL_BANDAS_VETADAS;
delete process.env.GP_REAL_BOLETOS;
delete process.env.GP_REAL_BOLETOS_MAX;

const CBPATH = require.resolve(path.join(__dirname, '..', 'market-scanner', 'venues', 'cloudbet.js'));
const colocadas = [];
const TOPE = 10.31521381;
let aceptaHasta = Infinity;   // nº máximo de boletos que la casa admite en el escenario
require.cache[CBPATH] = { id: CBPATH, filename: CBPATH, loaded: true, exports: {
  balance: async () => 5000,
  cachedSoccer: () => ({ data: [] }),
  eventRaw: async (k, id) => ({ markets: { 'soccer.total_bookings': {} }, home: { name: 'Local ' + id }, away: { name: 'Visita ' + id } }),
  selectionFor: () => ({ marketUrl: 'soccer.total_bookings/under?total=3.5', price: 2.52, minStake: 0.1, maxStake: 173.76, status: 'SELECTION_ENABLED', side: 'BACK' }),
  placeBet: async (k, p) => {
    if (p.stake > TOPE + 0.01) return { ok: true, status: 200, betStatus: 'REJECTED', betError: 'STAKE_ABOVE_MAX', body: { status: 'STAKE_ABOVE_MAX', stake: String(TOPE), price: '2.52' } };
    if (colocadas.length >= aceptaHasta) return { ok: true, status: 200, betStatus: 'REJECTED', betError: 'MARKET_SUSPENDED', body: { status: 'MARKET_SUSPENDED' } };
    colocadas.push(p);
    return { ok: true, status: 200, betStatus: 'ACCEPTED', body: { status: 'ACCEPTED', price: '2.52', stake: String(p.stake) } };
  },
  betByReference: async () => null,
  gql: async () => ({ ok: true, data: { bet: null }, errors: null }),
  ESTADOS_LIQUIDADOS: new Set(['WIN', 'LOSS', 'PUSH']),
} };

const RE = require('../real-executor/store');
const ko = new Date(Date.now() + 2 * 3600e3).toISOString();
// un PARTIDO distinto por escenario: la doctrina de una posición por partido+lado no debe interferir
const senal = (id, over = {}) => ({ id: 'sh_' + id, pick_id: 'cdp_' + id, segment: RE.SEGMENTO, family: 'CARDS', side: 'under', book: 'cloudbet',
  line: 3.5, odds: 2.52, model_prob: 0.5, match: `Local ${id} vs Visita ${id}`, league: 'ligamx', kickoff_at: ko, ...over });
const pick = (id) => ({ event: { canonical_event_id: 'ce_' + id } });
const ctx = { cbIdx: { ce_a: { cb_id: 'cb_a' }, ce_b: { cb_id: 'cb_b' }, ce_c: { cb_id: 'cb_c' } }, slate: null, banda: 'intermedia' };

(async () => {
  await RE.refrescarSaldo();   // sin lectura de saldo el ejecutor no apuesta a ciegas
  // 1) tope 10,31 y pedido 30 → madre 10,31 + boletos 10,31 y 9,38 = 30,00
  const f = await RE.intentar(senal('a'), pick('a'), ctx);
  assert.strictEqual(f.status, 'PLACED', JSON.stringify({ motivo: f.motivo, detalle: f.detalle }));
  assert.strictEqual(f.stake, 10.31);
  assert.strictEqual(f.tope_pedido, 30);
  assert(Array.isArray(f.boletos) && f.boletos.length === 2, 'dos boletos hermanos: ' + JSON.stringify(f.boletos));
  assert.strictEqual(f.boletos[0].stake, 10.31);
  assert.strictEqual(f.boletos[1].stake, 9.38);
  assert.strictEqual(f.boletos_total, 30);
  assert.strictEqual(f.boletos_resto, 0);
  let L = RE.load();
  const hermanas = L.bets.filter((b) => b.boleto_de === 'cdp_a');
  assert.strictEqual(hermanas.length, 2);
  assert(hermanas.every((b) => b.status === 'PLACED' && b.pick_id === 'cdp_a'));
  const refs = new Set([f.ref_id, ...hermanas.map((b) => b.ref_id)]);
  assert.strictEqual(refs.size, 3, 'referencias distintas para madre y hermanas');
  assert.strictEqual(colocadas.length, 3, 'tres boletos aceptados por la casa');
  assert(colocadas.every((p) => p.marketUrl === 'soccer.total_bookings/under?total=3.5'));

  // 2) la casa deja de aceptar tras el segundo boleto → se para, y el resto queda escrito
  colocadas.length = 0; aceptaHasta = 2;
  const g = await RE.intentar(senal('b'), pick('b'), ctx);
  assert.strictEqual(g.status, 'PLACED', JSON.stringify({ motivo: g.motivo, detalle: g.detalle }));
  assert.strictEqual(g.boletos.length, 2, JSON.stringify(g.boletos));
  assert.strictEqual(g.boletos[0].stake, 10.31);
  assert.strictEqual(g.boletos[1].stake, 0);
  assert.strictEqual(g.boletos[1].status, 'PENDIENTE');
  assert.strictEqual(g.boletos_total, 20.62);
  assert.strictEqual(g.boletos_resto, 9.38);

  // 3) con el interruptor apagado no nace ningún hermano
  colocadas.length = 0; aceptaHasta = Infinity; process.env.GP_REAL_BOLETOS = '0';
  const h = await RE.intentar(senal('c'), pick('c'), ctx);
  assert.strictEqual(h.status, 'PLACED');
  assert.strictEqual(h.stake, 10.31);
  assert(!h.boletos || h.boletos.length === 0);
  assert.strictEqual(colocadas.length, 1);
  L = RE.load();
  assert.strictEqual(L.bets.filter((b) => b.boleto_de === 'cdp_c').length, 0);

  // 4) una posición por partido+lado sigue en pie: otra pick sobre la MISMA posición (partido a) se descarta
  process.env.GP_REAL_BOLETOS = '';
  const d = await RE.intentar(senal('d', { match: 'Local a vs Visita a', line: 4.5 }), pick('a'), ctx);
  assert.notStrictEqual(d.status, 'PLACED', 'la misma posición no se apuesta dos veces: ' + d.status + ' ' + d.motivo);
  console.log('boletos: todo correcto (' + RE.load().bets.length + ' filas en el libro temporal)');
})().catch((e) => { console.error(e); process.exit(1); });
