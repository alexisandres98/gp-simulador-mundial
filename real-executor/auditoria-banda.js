#!/usr/bin/env node
'use strict';
// AUDITORÍA DEL VETO A LA BANDA EFICIENTE en el ejecutor real, con una casa de mentira.
//
// ORDEN DE ALEXIS (5-sep-2026): "Veta la banda eficiente del ejecutor real." El edge de tarjetas-under vive
// en ligas intermedias y blandas; en las eficientes el modelo no bate al precio (ROI +0,4 % en 47 de papel)
// y ahí estaba el 63 % del dinero real vivo. Aquí hay dinero real, así que cada camino que puede mover
// dinero se recorre a mano: la puerta de entrada, los reintentos de filas anteriores al veto y la
// recuperación. Y también lo que NO debe cambiar: intermedias, blandas y CS2 (sin liga) siguen igual.
//
//   node real-executor/auditoria-banda.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-banda-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.GP_REAL_ENABLED = '1';
process.env.GP_REAL_DRY = '0';
process.env.CLOUDBET_API_KEY = 'llave-de-mentira';
process.env.GP_REAL_NOTIONAL = '2000';
process.env.GP_REAL_STAKE_FLAT = '40';
delete process.env.GP_REAL_KICKOFF_MAX;
delete process.env.GP_REAL_BANDAS_VETADAS;

// la casa de mentira: acepta todo lo que le llegue. Si el veto falla, la apuesta SE COLOCA y se ve.
const CBPATH = require.resolve(path.join(__dirname, '..', 'market-scanner', 'venues', 'cloudbet.js'));
const colocadas = [];
let peticiones = 0;
require.cache[CBPATH] = { id: CBPATH, filename: CBPATH, loaded: true, exports: {
  balance: async () => 5000,
  cachedSoccer: () => ({ data: [{ id: 'cb1', h: 'Equipo A', a: 'Equipo B', ko: '2026-09-06T12:00:00Z' }] }),
  eventRaw: async () => { peticiones++; return { markets: { 'soccer.total_bookings': {} }, home: { name: 'Equipo A' }, away: { name: 'Equipo B' } }; },
  selectionFor: () => ({ marketUrl: 'soccer.total_bookings/under?total=4.5', price: 1.9, minStake: 0.1, maxStake: 500, status: 'SELECTION_ENABLED', side: 'BACK' }),
  placeBet: async (k, p) => { colocadas.push(p); return { ok: true, betStatus: 'ACCEPTED', body: { price: 1.9 }, status: 200 }; },
  betByReference: async () => null,
  gql: async () => ({ ok: true, data: { bet: null }, errors: null }),
  ESTADOS_LIQUIDADOS: new Set(['WIN', 'LOSS', 'PUSH']),
} };

const S = require('./store');
let ok = 0, ko = 0;
const t = (n, c, extra) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

const senal = (id, league, extra = {}) => ({
  id: 'sh_' + id, pick_id: 'cdp_' + id, segment: 'cards_under_v1', family: 'CARDS', side: 'under',
  book: 'cloudbet', line: 4.5, odds: 1.9, model_prob: 0.62, match: 'Equipo A vs Equipo B',
  league, kickoff_at: '2026-09-06T12:00:00Z', ...extra,
});
const idx = { ceid1: { cb_id: 'cb1' } };
const pick = { event: { canonical_event_id: 'ceid1' } };
// el motor de mentira: la misma tabla de bandas que el real usa como prior
const BANDA = { premier: 'eficiente', championship: 'eficiente', bundesliga: 'eficiente', brasileirao: 'intermedia', argentina: 'intermedia', ligamx: 'blanda' };
const bandaDe = (lg) => BANDA[lg] || 'blanda';

(async () => {
  console.log('\n── la puerta de entrada ───────────────────────────────────────────');
  const a = await S.intentar(senal('premier', 'premier'), pick, { cbIdx: idx, banda: bandaDe('premier') });
  t('una señal de Premier NO se coloca', a && a.status === 'DESCARTADA', a && a.status);
  t('con motivo banda_eficiente', a && a.motivo === 'banda_eficiente', a && a.motivo);
  t('y la banda anotada en la fila', a && a.banda === 'eficiente', a && a.banda);
  t('el detalle nombra la liga y la banda', a && /premier/.test(a.detalle || '') && /eficiente/.test(a.detalle || ''), a && a.detalle);
  t('no llegó NI UNA petición a la casa (ni el evento ni la apuesta)', peticiones === 0 && colocadas.length === 0, { peticiones, colocadas: colocadas.length });
  t('es DESCARTADA, no PENDIENTE: no se reintenta', a && a.status === 'DESCARTADA');

  const b = await S.intentar(senal('champ', 'championship'), pick, { cbIdx: idx, banda: bandaDe('championship') });
  t('Championship (eficiente medida) tampoco', b && b.motivo === 'banda_eficiente', b && b.motivo);

  console.log('\n── lo que sigue entrando ──────────────────────────────────────────');
  const c = await S.intentar(senal('brasil', 'brasileirao'), pick, { cbIdx: idx, banda: bandaDe('brasileirao') });
  t('Brasileirão (intermedia) se coloca', c && c.status === 'PLACED' && colocadas.length === 1, c && c.status);
  t('y la fila lleva su banda', c && c.banda === 'intermedia', c && c.banda);
  const d = await S.intentar(senal('mx', 'ligamx'), pick, { cbIdx: idx, banda: bandaDe('ligamx') });
  t('Liga MX (blanda) se coloca', d && d.status === 'PLACED' && colocadas.length === 2, d && d.status);
  const e = await S.intentar(senal('sin_banda', 'premier'), pick, { cbIdx: idx });
  t('sin banda conocida NO se veta (un llamador viejo o una fila sin liga no bloquea el dinero)', e && e.status === 'PLACED' && colocadas.length === 3, e && e.status);

  console.log('\n── las filas PENDIENTES de antes del veto ─────────────────────────');
  // una fila de Premier que nació antes del veto, sin banda, esperando saldo: la coge reintentar
  const L = S.load();
  L.bets.push({ ref_id: 'ref-vieja', envios: 0, pick_id: 'cdp_vieja', shadow_id: 'sh_vieja', match: 'Equipo A vs Equipo B',
    league: 'premier', line: 4.5, side: 'under', kickoff_at: '2026-09-06T12:00:00Z', odds_sombra: 1.9, model_prob: 0.62,
    ceid: 'ceid1', at: '2026-09-04T10:00:00Z', status: 'PENDIENTE', intentos: 3, motivo: 'sin_fondos' });
  L.bets.push({ ref_id: 'ref-vieja2', envios: 0, pick_id: 'cdp_vieja2', shadow_id: 'sh_vieja2', match: 'Equipo A vs Equipo B',
    league: 'argentina', line: 4.5, side: 'under', kickoff_at: '2026-09-06T12:00:00Z', odds_sombra: 1.9, model_prob: 0.62,
    ceid: 'ceid1', at: '2026-09-04T10:00:00Z', status: 'PENDIENTE', intentos: 3, motivo: 'sin_fondos' });
  S.save();
  const antes = colocadas.length;
  const r = await S.reintentar({ cbIdx: idx, bandaDe });
  const F = {}; for (const x of S.load().bets) F[x.pick_id] = x;
  t('la pendiente de Premier se DESCARTA al reintentar', F.cdp_vieja.status === 'DESCARTADA' && F.cdp_vieja.motivo === 'banda_eficiente', F.cdp_vieja);
  t('la pendiente de Argentina se coloca', F.cdp_vieja2.status === 'PLACED', F.cdp_vieja2.status);
  t('solo UNA apuesta más llegó a la casa', colocadas.length === antes + 1, colocadas.length - antes);
  t('el resumen del reintento cuenta una colocada', r.colocadas === 1, r);

  console.log('\n── CS2 no tiene liga y no se toca ─────────────────────────────────');
  const cs2 = S.crearManualCs2({ pick_id: 'es_cs2_y_1', id: 'sh_cs2b', segment: 'cs2_rounds_v1', book: 'cloudbet',
    match: 'B8 vs EYEBALLERS', side: 'home', line: -2.5, odds: 2.1, kickoff_at: '2026-09-06T14:00:00Z' });
  t('la fila manual de CS2 nace igual que antes', cs2 && cs2.status === 'PENDIENTE', cs2 && cs2.status);

  console.log('\n── el panel y la variable ─────────────────────────────────────────');
  t('el panel enseña la banda vetada', JSON.stringify(S.board().config.bandas_vetadas) === '["eficiente"]', S.board().config.bandas_vetadas);
  process.env.GP_REAL_BANDAS_VETADAS = '';
  const g = await S.intentar(senal('sin_veto', 'premier'), pick, { cbIdx: idx, banda: 'eficiente' });
  t('con la variable vacía el veto se levanta sin tocar código', g && g.status === 'PLACED', g && g.motivo);
  t('y el panel lo refleja', S.board().config.bandas_vetadas.length === 0);
  process.env.GP_REAL_BANDAS_VETADAS = 'eficiente,intermedia';
  const h = await S.intentar(senal('dos_bandas', 'brasileirao'), pick, { cbIdx: idx, banda: 'intermedia' });
  t('y se puede ampliar a más bandas si algún día hace falta', h && h.motivo === 'banda_eficiente', h && h.motivo);
  delete process.env.GP_REAL_BANDAS_VETADAS;

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* da igual */ }
  console.log(`\n${ok} comprobaciones en verde, ${ko} en rojo.`);
  process.exit(ko ? 1 : 0);
})();
