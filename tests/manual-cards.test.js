'use strict';
// tests/manual-cards.test.js — la segunda casa a mano para tarjetas under (27-sep-2026).
// Corre sobre un libro temporal: `DB_FILE` apunta a un directorio vacío, así que no toca ningún libro real.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-manual-cards-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.GP_REAL_ENABLED = 'true';
process.env.GP_REAL_STAKE_FLAT = '30';
delete process.env.GP_REAL_CARDS_PINNACLE;
delete process.env.GP_REAL_VENTANA_HORAS;

const RE = require('../real-executor/store');

const ko = new Date(Date.now() + 2 * 3600e3).toISOString();
const pick = (over = {}) => ({
  pick_id: 'cdp_test_' + Math.random().toString(36).slice(2, 8), family: 'CARDS', side: 'under', line: 4.5,
  league: 'brasilb', model_prob: 0.62,
  event: { home: 'Criciúma', away: 'Avaí', kickoff_at: ko, canonical_event_id: 'ce_1' },
  ...over,
});

// 1) nace con el perímetro y los campos del canal manual
const p1 = pick();
const f1 = RE.crearManualCards(p1, { odds: 1.95, book: 'pinnacle', banda: 'intermedia' });
assert(f1, 'la fila manual debería nacer');
assert.strictEqual(f1.canal, 'manual');
assert.strictEqual(f1.casa, 'pinnacle');
assert.strictEqual(f1.status, 'PENDIENTE');
assert.strictEqual(f1.motivo, 'solo_manual');
assert.strictEqual(f1.stake, 30);
assert.strictEqual(f1.side, 'under');
assert.strictEqual(f1.match, 'Criciúma vs Avaí');

// 2) la misma pick no nace dos veces; la misma posición (otra línea, mismo partido y lado) tampoco
assert.strictEqual(RE.crearManualCards(p1, { odds: 1.95 }), null, 'misma pick, no debería nacer');
assert.strictEqual(RE.crearManualCards(pick({ line: 5.5 }), { odds: 1.40, banda: 'intermedia' }), null, 'misma posición, no debería nacer');

// 3) perímetro: banda eficiente y liga vetada no entran; over no entra; cuota inválida no entra
assert.strictEqual(RE.crearManualCards(pick({ event: { home: 'A', away: 'B', kickoff_at: ko } }), { odds: 1.9, banda: 'eficiente' }), null, 'banda eficiente');
assert.strictEqual(RE.crearManualCards(pick({ league: 'uefanl', event: { home: 'C', away: 'D', kickoff_at: ko } }), { odds: 1.9, banda: 'intermedia' }), null, 'liga vetada');
assert.strictEqual(RE.crearManualCards(pick({ side: 'over', event: { home: 'E', away: 'F', kickoff_at: ko } }), { odds: 1.9 }), null, 'over');
assert.strictEqual(RE.crearManualCards(pick({ event: { home: 'G', away: 'H', kickoff_at: ko } }), { odds: 1.0 }), null, 'cuota inválida');

(async () => {
  // 4) colocar() jamás envía una fila manual por la API (reintentar la deja tal cual)
  const antes = JSON.stringify(f1);
  const fila4 = await RE.colocar(f1, { cbIdx: {}, slate: null });
  assert.strictEqual(fila4.status, 'PENDIENTE');
  assert.strictEqual(fila4.intentos, 0, 'no debería contar intentos');
  assert.strictEqual(JSON.stringify(fila4), antes, 'la fila manual no se toca');

  // 5) con el aviso enviado, el automático se aparta de esa posición (descartada con motivo)
  f1.aviso_manual = new Date().toISOString(); RE.save();
  const sb = { id: 'sh_x', pick_id: 'cdp_auto_1', segment: RE.SEGMENTO, family: 'CARDS', side: 'under', book: 'cloudbet', line: 4.5,
    match: 'Criciúma vs Avaí', league: 'brasilb', kickoff_at: ko, odds: 1.92, model_prob: 0.6 };
  const fila5 = await RE.intentar(sb, { event: { canonical_event_id: 'ce_1' } }, { cbIdx: {}, slate: null, banda: 'intermedia' });
  assert(fila5, 'el auto debería dejar rastro');
  assert.strictEqual(fila5.status, 'DESCARTADA');
  assert.strictEqual(fila5.motivo, 'posicion_en_canal_manual');

  // 6) el interruptor apaga el canal
  process.env.GP_REAL_CARDS_PINNACLE = '0';
  assert.strictEqual(RE.crearManualCards(pick({ event: { home: 'I', away: 'J', kickoff_at: ko } }), { odds: 1.9 }), null, 'apagado');
  console.log('manual-cards: todo correcto (' + RE.load().bets.length + ' filas en el libro temporal)');
})().catch((e) => { console.error(e); process.exit(1); });
