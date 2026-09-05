#!/usr/bin/env node
'use strict';
// AUDITORÍA DE LA VENTANA DE SAQUE del ejecutor real, con una casa de mentira.
//
// ORDEN DE ALEXIS (4-sep-2026): "No quiero que se coloque ninguna apuesta para partidos que sean después de
// las 8am hora UTC del lunes 7." Es un corte de EXPOSICIÓN, no de calidad: da igual lo buena que sea la
// señal. Aquí hay dinero real, así que cada camino que puede mover dinero se recorre a mano.
//
//   node real-executor/auditoria-ventana.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-ventana-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.GP_REAL_ENABLED = '1';
process.env.GP_REAL_DRY = '0';
process.env.CLOUDBET_API_KEY = 'llave-de-mentira';
process.env.GP_REAL_NOTIONAL = '2000';
process.env.GP_REAL_STAKE_FLAT = '40';
process.env.GP_REAL_KICKOFF_MAX = '2026-09-07T08:00:00Z';

// la casa de mentira: acepta todo lo que le llegue. Si el corte falla, la apuesta SE COLOCA y se ve.
const CBPATH = require.resolve(path.join(__dirname, '..', 'market-scanner', 'venues', 'cloudbet.js'));
const colocadas = [];
require.cache[CBPATH] = { id: CBPATH, filename: CBPATH, loaded: true, exports: {
  balance: async () => 5000,
  cachedSoccer: () => ({ data: [{ id: 'cb1', h: 'Equipo A', a: 'Equipo B', ko: '2026-09-06T12:00:00Z' }] }),
  eventRaw: async () => ({ markets: { 'soccer.total_bookings': {} }, home: { name: 'Equipo A' }, away: { name: 'Equipo B' } }),
  selectionFor: () => ({ marketUrl: 'soccer.total_bookings/under?total=4.5', price: 1.9, minStake: 0.1, maxStake: 500, status: 'SELECTION_ENABLED', side: 'BACK' }),
  placeBet: async (k, p) => { colocadas.push(p); return { ok: true, betStatus: 'ACCEPTED', body: { price: 1.9 }, status: 200 }; },
  betByReference: async () => null,
  gql: async () => ({ ok: true, data: { bet: null }, errors: null }),
  ESTADOS_LIQUIDADOS: new Set(['WIN', 'LOSS', 'PUSH']),
} };

const S = require('./store');
let ok = 0, ko = 0;
const t = (n, c, extra) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

// cada señal a una LÍNEA distinta: desde el 5-sep una posición (partido+línea+lado) solo admite una apuesta,
// y estas auditorías reutilizan el mismo partido de mentira para todas sus señales.
let nLinea = 0;
const senal = (id, kickoff, extra = {}) => ({
  id: 'sh_' + id, pick_id: 'cdp_' + id, segment: 'cards_under_v1', family: 'CARDS', side: 'under',
  book: 'cloudbet', line: 0.5 + (++nLinea), odds: 1.9, model_prob: 0.62, match: 'Equipo A vs Equipo B',
  league: 'seriea', kickoff_at: kickoff, ...extra,
});
const idx = { ceid1: { cb_id: 'cb1' } };
const pick = { event: { canonical_event_id: 'ceid1' } };

(async () => {
  console.log('\n── dentro de la ventana: se coloca ────────────────────────────────');
  const a = await S.intentar(senal('antes', '2026-09-06T12:00:00Z'), pick, { cbIdx: idx });
  t('un partido del domingo se coloca', a && a.status === 'PLACED' && colocadas.length === 1, a && a.status);

  const b = await S.intentar(senal('justo', '2026-09-07T07:59:00Z'), pick, { cbIdx: idx });
  t('un minuto ANTES del corte también', b && b.status === 'PLACED' && colocadas.length === 2, b && b.status);

  console.log('\n── fuera de la ventana: NO se coloca ──────────────────────────────');
  const c = await S.intentar(senal('justo_despues', '2026-09-07T08:01:00Z'), pick, { cbIdx: idx });
  t('un minuto DESPUÉS del corte se rechaza', c && c.motivo === 'fuera_de_ventana', c && c.motivo);
  t('y no llegó ni una petición a la casa', colocadas.length === 2, colocadas.length);
  t('la fila queda DESCARTADA, no reintentándose', c && c.status === 'DESCARTADA', c && c.status);
  t('el detalle dice el saque y el límite', c && /2026-09-07T08:01/.test(c.detalle || '') && /2026-09-07T08:00/.test(c.detalle || ''), c && c.detalle);

  const d = await S.intentar(senal('lunes_tarde', '2026-09-07T18:45:00Z'), pick, { cbIdx: idx });
  t('el partido del lunes por la tarde, igual', d && d.motivo === 'fuera_de_ventana' && colocadas.length === 2);

  console.log('\n── el borde exacto ───────────────────────────────────────────────');
  const e = await S.intentar(senal('exacto', '2026-09-07T08:00:00Z'), pick, { cbIdx: idx });
  t('las 08:00:00 clavadas SÍ entran (el corte es "después de")', e && e.status === 'PLACED', e && e.motivo);

  console.log('\n── sin saque conocido: no se apuesta a ciegas ─────────────────────');
  const f = await S.intentar(senal('sin_saque', null), pick, { cbIdx: idx });
  t('sin kickoff se rechaza', f && f.motivo === 'fuera_de_ventana', f && f.motivo);
  t('y lo dice sin disfrazarlo', f && /sin saque conocido/.test(f.detalle || ''), f && f.detalle);

  console.log('\n── los reintentos tampoco la cuelan ──────────────────────────────');
  const antes = colocadas.length;
  await S.reintentar({ cbIdx: idx });
  t('un barrido de reintentos no coloca nada fuera de ventana', colocadas.length === antes, colocadas.length);

  console.log('\n── el canal manual de CS2 ni siquiera crea la fila ────────────────');
  const cs2Fuera = S.crearManualCs2({ pick_id: 'es_cs2_x_1', id: 'sh_cs2', segment: 'cs2_rounds_v1', book: 'cloudbet',
    match: 'HOTU vs Eternal Fire', side: 'home', line: -2.5, odds: 2.1, kickoff_at: '2026-09-08T14:00:00Z' });
  t('una de CS2 del martes no nace', cs2Fuera === null);
  const cs2Dentro = S.crearManualCs2({ pick_id: 'es_cs2_y_1', id: 'sh_cs2b', segment: 'cs2_rounds_v1', book: 'cloudbet',
    match: 'B8 vs EYEBALLERS', side: 'home', line: -2.5, odds: 2.1, kickoff_at: '2026-09-06T14:00:00Z' });
  t('una del domingo sí', cs2Dentro && cs2Dentro.status === 'PENDIENTE');

  console.log('\n── sin la variable, todo vuelve a ser como antes ──────────────────');
  delete process.env.GP_REAL_KICKOFF_MAX;
  const g = await S.intentar(senal('sin_ventana', '2026-09-20T18:45:00Z'), pick, { cbIdx: idx });
  t('sin ventana configurada, un partido lejano se coloca', g && g.status === 'PLACED', g && g.motivo);
  t('levantar el corte es borrar la variable, no tocar código', S.board().config.ventana_saque === null);
  process.env.GP_REAL_KICKOFF_MAX = '2026-09-07T08:00:00Z';
  t('y con la variable puesta, el panel lo enseña', S.board().config.ventana_saque === '2026-09-07T08:00:00.000Z',
    S.board().config.ventana_saque);

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* da igual */ }
  console.log(`\n${ok} comprobaciones en verde, ${ko} en rojo.`);
  process.exit(ko ? 1 : 0);
})();
