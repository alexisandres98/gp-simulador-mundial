#!/usr/bin/env node
'use strict';
// AUDITORÍA DE LA LIQUIDACIÓN DE LAS APUESTAS MANUALES, con una casa de mentira.
//
// El fallo que corrige (5-sep-2026): una fila colocada a mano se liquidaba SOLO con el result_code de su
// pick. Cuando el motor re-emitía la señal, la pick quedaba SUPERSEDED y la fila se quedaba "esperando"
// para siempre — 27 apuestas de fútbol, 761 USDT, una semana abiertas con el partido acabado. Aquí hay
// dinero real, así que cada rama se recorre a mano: la que cierra, la que NO debe cerrar, y la que no
// puede heredar el resultado de otra posición.
//
//   node real-executor/auditoria-liquidar-manual.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-liq-manual-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.GP_REAL_ENABLED = '1';
process.env.GP_REAL_DRY = '0';
process.env.CLOUDBET_API_KEY = 'llave-de-mentira';
process.env.GP_REAL_NOTIONAL = '2000';

// la casa de mentira: no sabe nada de ninguna referencia (como con las manuales de verdad).
const CBPATH = require.resolve(path.join(__dirname, '..', 'market-scanner', 'venues', 'cloudbet.js'));
let preguntasALaCasa = 0;
require.cache[CBPATH] = { id: CBPATH, filename: CBPATH, loaded: true, exports: {
  balance: async () => 100,
  betByReference: async () => { preguntasALaCasa++; return null; },
  gql: async () => ({ ok: true, data: { bet: null }, errors: null }),
  ESTADOS_LIQUIDADOS: new Set(['WIN', 'LOSS', 'PUSH', 'HALF_WIN', 'HALF_LOSS', 'PARTIAL']),
} };

const S = require('./store');
let ok = 0, ko = 0;
const t = (n, c, extra) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

// filas manuales tal y como las deja anotarManual(): PLACED, via manual, con su shadow_id y su línea.
const manual = (n, extra = {}) => ({
  ref_id: 'ref-' + n, pick_id: 'cdp_' + n, shadow_id: 'sh_' + n, match: 'Equipo A vs Equipo B', league: 'premier',
  line: 4.5, side: 'under', kickoff_at: '2026-08-29T14:00:00Z', odds_sombra: 1.9, odds_real: 2.0, stake: 30,
  status: 'PLACED', via: 'manual', placed_at: '2026-08-29T12:00:00Z', ...extra,
});
const sombra = (n, extra = {}) => ({
  id: 'sh_' + n, pick_id: 'cdp_' + n, segment: 'cards_under_v1', family: 'CARDS', side: 'under', line: 4.5,
  status: 'SETTLED', result: 'WIN', settled_from: 'total_real_linea_propia', ...extra,
});

(async () => {
  const L = S.load();
  L.bets = [
    manual('pick_ok'),                                    // la pick dice WIN: como siempre
    manual('superseded_win'),                             // pick SUPERSEDED, la sombra ganó
    manual('superseded_loss', { stake: 20, odds_real: 1.8 }), // pick SUPERSEDED, la sombra perdió
    manual('superseded_void'),                            // pick SUPERSEDED, la sombra anuló
    manual('sombra_abierta'),                             // pick SUPERSEDED, la sombra aún no cerró
    manual('otra_linea', { line: 3.5 }),                  // pick SUPERSEDED, la sombra cerró OTRA línea
    manual('otro_lado', { side: 'over' }),                // pick SUPERSEDED, la sombra cerró el OTRO lado
    manual('sin_sombra', { shadow_id: 'sh_que_no_existe' }), // pick SUPERSEDED, sin apuesta de papel
    manual('pendiente'),                                  // la pick sigue PENDING y la sombra abierta
    { ...manual('automatica'), via: 'relay-rest' },       // NO es manual: sigue preguntando a la casa
  ];
  S.save();
  const antes = { realizado: L.realizado || 0 };

  const resultados = {
    cdp_pick_ok: { result_code: 'WIN' },
    cdp_superseded_win: { result_code: 'SUPERSEDED' },
    cdp_superseded_loss: { result_code: 'SUPERSEDED' },
    cdp_superseded_void: { result_code: 'SUPERSEDED' },
    cdp_sombra_abierta: { result_code: 'SUPERSEDED' },
    cdp_otra_linea: { result_code: 'SUPERSEDED' },
    cdp_otro_lado: { result_code: 'SUPERSEDED' },
    cdp_sin_sombra: { result_code: 'SUPERSEDED' },
    cdp_pendiente: { result_code: 'PENDING' },
    cdp_automatica: { result_code: 'WIN' },
  };
  const bets = [
    sombra('pick_ok', { result: 'LOSS' }),                // si la pick habla, manda la pick (no la sombra)
    sombra('superseded_win'),
    sombra('superseded_loss', { result: 'LOSS' }),
    sombra('superseded_void', { result: 'VOID' }),
    sombra('sombra_abierta', { status: 'OPEN', result: null }),
    sombra('otra_linea', { line: 4.5 }),                  // la fila está a 3,5
    sombra('otro_lado', { side: 'under' }),               // la fila está al over
    sombra('pendiente', { status: 'OPEN', result: null }),
    sombra('automatica'),
  ];

  console.log('\n── una pasada de liquidación ──────────────────────────────────────');
  const r = await S.liquidar(resultados, { sombra: bets });
  t('liquida exactamente las cuatro que tienen veredicto', r.settled === 4, r);
  t('las otras seis siguen esperando', r.esperando === 6, r);
  t('a la casa solo se le preguntó por la automática', preguntasALaCasa === 1, preguntasALaCasa);

  const F = {}; for (const b of S.load().bets) F[b.pick_id] = b;

  console.log('\n── la pick sigue mandando cuando habla ────────────────────────────');
  t('pick WIN → WIN aunque la sombra diga LOSS', F.cdp_pick_ok.status === 'SETTLED' && F.cdp_pick_ok.resultado === 'WIN', F.cdp_pick_ok.resultado);
  t('y la fuente queda anotada como la pick', F.cdp_pick_ok.fuente_resultado === 'pick', F.cdp_pick_ok.fuente_resultado);
  t('pnl = stake × (cuota real − 1) = 30', F.cdp_pick_ok.pnl === 30, F.cdp_pick_ok.pnl);

  console.log('\n── pick SUPERSEDED: manda la sombra, misma línea y mismo lado ─────');
  t('WIN de la sombra cierra la fila en WIN', F.cdp_superseded_win.status === 'SETTLED' && F.cdp_superseded_win.resultado === 'WIN', F.cdp_superseded_win);
  t('con la cuota REAL a la que entró Alexis (30 × 1,0 = 30)', F.cdp_superseded_win.pnl === 30, F.cdp_superseded_win.pnl);
  t('la fuente dice que vino de la sombra', F.cdp_superseded_win.fuente_resultado === 'sombra_linea_propia', F.cdp_superseded_win.fuente_resultado);
  t('y sigue marcada como resultado propio, no verificado con la casa', F.cdp_superseded_win.verificacion === 'resultado_propio');
  t('LOSS de la sombra cierra en LOSS con −stake', F.cdp_superseded_loss.resultado === 'LOSS' && F.cdp_superseded_loss.pnl === -20, F.cdp_superseded_loss.pnl);
  t('VOID de la sombra cierra en VOID con pnl 0', F.cdp_superseded_void.resultado === 'VOID' && F.cdp_superseded_void.pnl === 0, F.cdp_superseded_void.pnl);

  console.log('\n── lo que NO debe cerrar ──────────────────────────────────────────');
  t('sombra todavía abierta → sigue PLACED', F.cdp_sombra_abierta.status === 'PLACED', F.cdp_sombra_abierta.status);
  t('la sombra cerró OTRA línea → no se hereda', F.cdp_otra_linea.status === 'PLACED', F.cdp_otra_linea.status);
  t('la sombra cerró el OTRO lado → no se hereda', F.cdp_otro_lado.status === 'PLACED', F.cdp_otro_lado.status);
  t('sin apuesta de papel → sigue esperando', F.cdp_sin_sombra.status === 'PLACED', F.cdp_sin_sombra.status);
  t('pick PENDING y sombra abierta → sigue esperando', F.cdp_pendiente.status === 'PLACED', F.cdp_pendiente.status);
  t('la automática no toca este camino: sigue PLACED porque la casa no contestó', F.cdp_automatica.status === 'PLACED' && !F.cdp_automatica.fuente_resultado);

  console.log('\n── el banco ───────────────────────────────────────────────────────');
  const L2 = S.load();
  t('realizado suma +30 +30 −20 +0 = +40', +(L2.realizado - antes.realizado).toFixed(2) === 40, L2.realizado);
  t('el nocional se mueve lo mismo', L2.nocional === 2040, L2.nocional);

  console.log('\n── segunda pasada: nada se liquida dos veces ──────────────────────');
  const r2 = await S.liquidar(resultados, { sombra: bets });
  t('0 liquidadas', r2.settled === 0, r2);
  t('el banco no se mueve', S.load().realizado === L2.realizado);

  console.log('\n── sin sombra (llamada vieja) todo sigue funcionando ──────────────');
  const r3 = await S.liquidar(resultados);
  t('la firma antigua no rompe y no cierra nada nuevo', r3.settled === 0 && r3.esperando === 6, r3);

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* da igual */ }
  console.log(`\n${ok} comprobaciones en verde, ${ko} en rojo.`);
  process.exit(ko ? 1 : 0);
})();
