// tests/market-scanner.test.js — núcleo puro del scanner multi-venue (consenso, arbitraje puro, precio atrasado).
'use strict';
const assert = require('assert');
const S = require('../market-scanner/scanner');
const { params } = require('../market-scanner/config');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message); } }

const now = 1_800_000_000_000;
const q = (venue, group, outcome, odds, extra = {}) => ({ venue, venue_label: venue, independence_group: group, source_role: 'market_consensus', outcome, odds_decimal: odds, observed_at: now - 60_000, ...extra });

// 8 grupos independientes, 1X2 alineado ~ (0.50 home / 0.27 draw / 0.23 away), con vig típico.
function alignedMarket() {
  const groups = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'];
  const quotes = [];
  for (const g of groups) {
    quotes.push(q('bk_' + g, g, 'home', 1.90));
    quotes.push(q('bk_' + g, g, 'draw', 3.60));
    quotes.push(q('bk_' + g, g, 'away', 3.80));
  }
  return { event_id: 'E1', market_family: '1x2', period: 'regulation', universe: ['home', 'draw', 'away'], quotes };
}

console.log('market-scanner');

test('consenso: mercado alineado devuelve prob justa Σ=1 y baja dispersión', () => {
  const m = alignedMarket();
  const c = S.consensus(m, m.quotes, { minGroups: params.minIndependentGroups });
  assert.strictEqual(c.status, 'ok', 'status ok');
  const sum = c.fair.home + c.fair.draw + c.fair.away;
  assert.ok(Math.abs(sum - 1) < 1e-6, 'Σ prob justa = 1, fue ' + sum);
  assert.ok(c.fair.home > 0.49 && c.fair.home < 0.53, 'home ~0.51, fue ' + c.fair.home);
  assert.ok(c.dispersion < 0.001, 'dispersión ~0 en mercado idéntico, fue ' + c.dispersion);
  assert.ok(c.overround > 0.03, 'overround positivo (vig), fue ' + c.overround);
});

test('consenso: insuficientes grupos → insufficient', () => {
  const m = alignedMarket();
  const few = m.quotes.filter(x => ['g1', 'g2'].includes(x.independence_group));
  const c = S.consensus(m, few, { minGroups: 4 });
  assert.strictEqual(c.status, 'insufficient');
  assert.strictEqual(c.groups, 2);
});

test('arbitraje: mercado alineado NO produce surebet', () => {
  const m = alignedMarket();
  const r = S.scanMarket(m, params, now);
  assert.strictEqual(r.arb, null, 'sin arb en mercado alineado');
});

test('arbitraje: 2-vías con una casa rezagada SÍ produce surebet ejecutable', () => {
  // Over/Under: consenso ~ over 1.90 / under 1.90 (Σ implícita 1.05). Una casa cuelga under a 2.20 (rezagó).
  const groups = ['g1', 'g2', 'g3', 'g4', 'g5'];
  const quotes = [];
  for (const g of groups) { quotes.push(q('bk_' + g, g, 'over', 1.90)); quotes.push(q('bk_' + g, g, 'under', 1.90)); }
  // casa laggy: over normal, under muy alto → best over 2.05 (otra casa) + under 2.20 → 1/2.05+1/2.20 = 0.4878+0.4545 = 0.9423 < 1
  quotes.push(q('lag_book', 'gLag', 'under', 2.20));
  quotes.push(q('sharp_book', 'gSharp', 'over', 2.05));
  const m = { event_id: 'E2', market_family: 'match_total', period: 'regulation', line: 2.5, universe: ['over', 'under'], quotes };
  const a = S.detectArb(m, m.quotes, params);
  assert.ok(a, 'debe detectar arb');
  assert.strictEqual(a.family, 'PURE_ARB');
  assert.ok(a.gross_roi > 0.05, 'ROI bruto >5%, fue ' + a.gross_roi);
  assert.ok(a.executable, 'debe ser ejecutable');
  assert.strictEqual(a.legs.length, 2);
  const totalStake = a.legs.reduce((s, l) => s + l.stake_pct, 0);
  assert.ok(Math.abs(totalStake - 100) < 0.1, 'stakes suman ~100, fue ' + totalStake);
});

test('precio atrasado: casa soft con cuota generosa se detecta con edge', () => {
  const m = alignedMarket();
  // casa soft rezagada: home a 2.20 (consenso justo ~0.51 → edge = 2.20*0.51-1 ≈ +12%)
  m.quotes.push(q('soft_lag', 'gSoft', 'home', 2.20));
  m.quotes.push(q('soft_lag', 'gSoft', 'draw', 3.60));
  m.quotes.push(q('soft_lag', 'gSoft', 'away', 3.80));
  const r = S.detectLag(m, m.quotes, params, now);
  const opp = r.opportunities.find(o => o.venue === 'soft_lag' && o.outcome === 'home');
  assert.ok(opp, 'debe detectar el lag de soft_lag home');
  assert.ok(opp.edge > 0.08, 'edge >8%, fue ' + opp.edge);
  assert.ok(opp.is_soft, 'marcada como soft');
  assert.ok(opp.fair_prob > 0.49 && opp.fair_prob < 0.53, 'fair_prob del consenso LOO');
});

test('precio atrasado: NO reporta cuando el edge viene del propio grupo (LOO)', () => {
  // si TODAS las casas cuelgan lo mismo, el LOO no debe inventar edge.
  const m = alignedMarket();
  const r = S.detectLag(m, m.quotes, params, now);
  assert.strictEqual(r.opportunities.length, 0, 'sin lag en mercado uniforme');
});

test('precio atrasado: descarta longshots (piso de prob justa)', () => {
  // universo con un outcome muy improbable; una casa cuelga ese longshot generoso → NO debe reportarse.
  const groups = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
  const quotes = [];
  for (const g of groups) { quotes.push(q('bk_' + g, g, 'home', 1.20)); quotes.push(q('bk_' + g, g, 'draw', 7.0)); quotes.push(q('bk_' + g, g, 'away', 15.0)); }
  quotes.push(q('soft_ls', 'gLs', 'away', 22.0)); // longshot fair~5%, edge alto pero ruido
  quotes.push(q('soft_ls', 'gLs', 'home', 1.20)); quotes.push(q('soft_ls', 'gLs', 'draw', 7.0));
  const m = { event_id: 'E3', market_family: '1x2', period: 'regulation', universe: ['home', 'draw', 'away'], quotes };
  const r = S.detectLag(m, m.quotes, params, now);
  assert.ok(!r.opportunities.some(o => o.outcome === 'away' && o.venue === 'soft_ls'), 'no debe reportar el longshot away');
});

test('lag/arb: llevan nombres de equipo para display', () => {
  const m = alignedMarket(); m.home = 'Brazil'; m.away = 'Norway';
  m.quotes.push(q('soft_lag', 'gSoft', 'draw', 4.2)); // draw generoso, fair ~3.6
  m.quotes.push(q('soft_lag', 'gSoft', 'home', 1.90)); m.quotes.push(q('soft_lag', 'gSoft', 'away', 3.80));
  const r = S.detectLag(m, m.quotes, params, now);
  if (r.opportunities.length) { assert.strictEqual(r.opportunities[0].home, 'Brazil'); assert.strictEqual(r.opportunities[0].away, 'Norway'); }
});

test('scan: agrega contadores correctamente', () => {
  const aligned = alignedMarket();
  const out = S.scan([aligned], { params, now });
  assert.strictEqual(out.markets_scanned, 1);
  assert.strictEqual(out.markets_with_consensus, 1);
  assert.strictEqual(out.counts.arb_total, 0);
});

test('exchange: comisión se descuenta en la cuota efectiva del arb', () => {
  const eff = S.netOdds({ is_exchange: true, odds_decimal: 3.0 }, 0.02);
  assert.ok(Math.abs(eff - (1 + 2 * 0.98)) < 1e-9, 'neteo de comisión 2%: 3.0→2.96, fue ' + eff);
  const same = S.netOdds({ is_exchange: false, odds_decimal: 3.0 }, 0.02);
  assert.strictEqual(same, 3.0, 'casa normal sin cambio');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
