#!/usr/bin/env node
'use strict';
// AUDITORÍA CONTRA LA DOBLE COLOCACIÓN, con una casa de mentira que se comporta como la de verdad se comportó.
//
// LO QUE PASÓ (5-sep-2026): Parma–Monza under 4,5 y Roma–Atalanta under 4,5 aparecieron DOS veces en la
// casa, 40 USDT cada una. La primera respuesta de la casa no fue un JSON con REJECTED sino un "no ok" con
// código HTTP; el ejecutor lo leyó como rechazo, quemó la referencia, estrenó otra y reenvió. La casa había
// aceptado la primera. Orden de Alexis: "se puede apostar dos veces a un mismo partido pero no a la misma
// línea". Aquí hay dinero real, así que se recorren todos los caminos: el que antes duplicaba, el que debe
// seguir quemando (rechazo explícito), el que no debe quemar nunca (sin respuesta), la guardia de posición
// y la liberación de una fila en el aire cuya referencia la casa dice no tener.
//
//   node real-executor/auditoria-duplicados.js
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-dup-'));
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.GP_REAL_ENABLED = '1';
process.env.GP_REAL_DRY = '0';
process.env.CLOUDBET_API_KEY = 'llave-de-mentira';
process.env.GP_REAL_NOTIONAL = '2000';
process.env.GP_REAL_STAKE_FLAT = '40';
delete process.env.GP_REAL_KICKOFF_MAX;
delete process.env.GP_REAL_BANDAS_VETADAS;

// LA CASA DE MENTIRA. Guarda cada apuesta que le llega por referencia — como la de verdad — y contesta según
// un guion por referencia: 'aceptar', 'rechazar', 'ruido' (acepta por dentro pero contesta basura HTTP 502),
// 'silencio' (no contesta: status 0). Así se puede comprobar cuántas apuestas terminan DENTRO de la casa,
// que es lo único que importa.
const casa = { apuestas: new Map(), guion: {}, preguntas: 0, envios: 0 };
const CBPATH = require.resolve(path.join(__dirname, '..', 'market-scanner', 'venues', 'cloudbet.js'));
require.cache[CBPATH] = { id: CBPATH, filename: CBPATH, loaded: true, exports: {
  balance: async () => 5000,
  cachedSoccer: () => ({ data: [] }),
  eventRaw: async () => ({ markets: { 'soccer.total_bookings': {} }, home: { name: 'A' }, away: { name: 'B' } }),
  selectionFor: (ev, mk, line) => ({ marketUrl: `soccer.total_bookings/under?total=${line}`, price: 1.9, minStake: 0.1, maxStake: 500, status: 'SELECTION_ENABLED', side: 'BACK' }),
  placeBet: async (k, p) => {
    casa.envios++;
    const modo = casa.guion[p.referenceId] || 'aceptar';
    if (casa.apuestas.has(p.referenceId)) return { ok: true, status: 200, body: { betStatus: 'REJECTED', betErrorCode: 'DUPLICATE_REQUEST' }, betStatus: 'REJECTED', betError: 'DUPLICATE_REQUEST', via: 'relay-rest' };
    if (modo === 'rechazar') return { ok: true, status: 200, body: { betStatus: 'REJECTED', betErrorCode: 'PRICE_ABOVE_MARKET' }, betStatus: 'REJECTED', betError: 'PRICE_ABOVE_MARKET', via: 'relay-rest' };
    if (modo === 'silencio') return { ok: false, status: 0, body: null, raw: 'timeout_del_brazo', betStatus: null, betError: null, via: 'relay-rest' };
    // aceptar y ruido: la apuesta ENTRA en la casa
    casa.apuestas.set(p.referenceId, { referenceId: p.referenceId, betStatus: 'ACCEPTED', price: String(p.price), stake: String(p.stake), marketUrl: p.marketUrl, eventId: String(p.eventId) });
    if (modo === 'ruido') return { ok: false, status: 502, body: null, raw: '<html>Bad Gateway</html>', betStatus: null, betError: null, via: 'relay-rest' };
    return { ok: true, status: 200, body: { betStatus: 'ACCEPTED', price: String(p.price), stake: String(p.stake) }, betStatus: 'ACCEPTED', betError: null, via: 'relay-rest' };
  },
  betByReference: async (k, ref) => { casa.preguntas++; return casa.apuestas.get(ref) || null; },
  // la lectura fina (GraphQL) que usa leerApuesta: data.bet null sin errores = "no la tengo"
  gql: async (k, q, vars) => ({ ok: true, status: 200, data: { bet: casa.apuestas.get(vars.ref) || null }, errors: null }),
  ESTADOS_LIQUIDADOS: new Set(['WIN', 'LOSS', 'PUSH', 'HALF_WIN', 'HALF_LOSS', 'PARTIAL']),
} };

const S = require('./store');
let ok = 0, ko = 0;
const t = (n, c, extra) => { if (c) { ok++; console.log('  ✓ ' + n); } else { ko++; console.log('  ✗ ' + n + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

const senal = (id, extra = {}) => ({
  id: 'sh_' + id, pick_id: 'cdp_' + id, segment: 'cards_under_v1', family: 'CARDS', side: 'under',
  book: 'cloudbet', line: 4.5, odds: 1.9, model_prob: 0.62, match: 'Parma vs Monza',
  league: 'brasileirao', kickoff_at: '2026-09-06T13:00:00Z', ...extra,
});
const idx = { ceid1: { cb_id: 'cb1' }, ceid2: { cb_id: 'cb2' } };
const pick1 = { event: { canonical_event_id: 'ceid1' } };
const enLaCasa = (match, line) => [...casa.apuestas.values()].filter((b) => b.marketUrl.endsWith('total=' + line)).length;

(async () => {
  console.log('\n── el caso real: la casa acepta pero contesta basura ─────────────');
  casa.guion[S.refIdDe('cdp_parma', 0)] = 'ruido';
  const a = await S.intentar(senal('parma'), pick1, { cbIdx: idx });
  t('la fila NO se da por rechazada: queda EN_ACEPTACION', a && a.status === 'EN_ACEPTACION', a && { status: a.status, motivo: a.motivo });
  t('con motivo respuesta_no_reconocida', a && a.motivo === 'respuesta_no_reconocida', a && a.motivo);
  t('la referencia NO se quema (sigue el envío 0)', a && a.envios === 0 && a.ref_id === S.refIdDe('cdp_parma', 0), a && a.envios);
  t('la casa tiene UNA apuesta', casa.apuestas.size === 1, casa.apuestas.size);
  await S.reintentar({ cbIdx: idx });
  t('un barrido de reintentos no la toca (EN_ACEPTACION no se reenvía)', casa.envios === 1 && casa.apuestas.size === 1, { envios: casa.envios });
  const c1 = await S.confirmar();
  const F = () => { const o = {}; for (const b of S.load().bets) o[b.pick_id] = b; return o; };
  t('confirmar la encuentra en la casa y la pasa a PLACED', F().cdp_parma.status === 'PLACED' && c1.aceptadas === 1, c1);
  t('con el precio que la casa aceptó', F().cdp_parma.odds_real === 1.9, F().cdp_parma.odds_real);
  t('y la casa sigue teniendo UNA sola apuesta: no hubo doble colocación', casa.apuestas.size === 1, casa.apuestas.size);

  console.log('\n── el rechazo explícito sigue quemando la referencia ─────────────');
  casa.guion[S.refIdDe('cdp_roma', 0)] = 'rechazar';
  const b = await S.intentar(senal('roma', { match: 'Roma vs Atalanta', kickoff_at: '2026-09-05T18:45:00Z' }), { event: { canonical_event_id: 'ceid2' } }, { cbIdx: idx });
  t('REJECTED con cuerpo → PENDIENTE y referencia nueva (envío 1)', b && b.status === 'PENDIENTE' && b.envios === 1 && b.motivo === 'rechazada_por_la_casa', b && { status: b.status, envios: b.envios });
  t('la casa no tiene nada de Roma', enLaCasa('Roma', 4.5) === 1 /* solo la de Parma comparte línea */ && casa.apuestas.size === 1);
  const antesEnv = casa.envios;
  await S.reintentar({ cbIdx: idx });
  t('el reintento sale con la referencia nueva y la casa la acepta', F().cdp_roma.status === 'PLACED' && casa.envios === antesEnv + 1 && casa.apuestas.size === 2, { status: F().cdp_roma.status, envios: casa.envios });

  console.log('\n── sin respuesta (status 0) no se quema nada ─────────────────────');
  casa.guion[S.refIdDe('cdp_silencio', 0)] = 'silencio';
  const s = await S.intentar(senal('silencio', { match: 'Lazio vs Udinese', kickoff_at: '2026-09-07T18:45:00Z' }), { event: { canonical_event_id: 'ceid3' } }, { cbIdx: { ceid3: { cb_id: 'cb3' } } });
  t('PENDIENTE, misma referencia, motivo no_llego_a_la_casa', s && s.status === 'PENDIENTE' && s.envios === 0 && s.motivo === 'no_llego_a_la_casa', s && { status: s.status, envios: s.envios, motivo: s.motivo });

  console.log('\n── una posición, una apuesta ─────────────────────────────────────');
  // la señal se re-emite con OTRO pick_id, misma línea, mismo partido (Parma–Monza under 4,5 ya PLACED)
  const d = await S.intentar(senal('parma_bis'), pick1, { cbIdx: idx });
  t('otra pick a la MISMA línea del mismo partido se DESCARTA', d && d.status === 'DESCARTADA' && d.motivo === 'linea_ya_apostada', d && { status: d.status, motivo: d.motivo });
  t('el detalle dice quién ocupa la posición', d && /cdp_parma/.test(d.detalle || ''), d && d.detalle);
  t('y la casa no recibió nada', casa.apuestas.size === 2, casa.apuestas.size);
  const e = await S.intentar(senal('parma_35', { line: 3.5 }), pick1, { cbIdx: idx });
  t('pero otra LÍNEA del mismo partido (under 3,5) sí se coloca', e && e.status === 'PLACED' && casa.apuestas.size === 3, e && e.status);
  // mismo partido reconocido por nombre+saque aunque no haya ceid ni id de la casa aún
  const f = await S.intentar(senal('parma_ter', { line: 3.5 }), { event: {} }, { cbIdx: idx, slate: { ev: [{ id: 'cb1', h: 'Parma', a: 'Monza', ko: '2026-09-06T13:00:00Z' }] } });
  t('sin ids, el partido se reconoce por nombre y saque y también se descarta', f && f.motivo === 'linea_ya_apostada', f && f.motivo);
  // una PENDIENTE no ocupa posición: solo cuenta el dinero puesto
  const g = await S.intentar(senal('lazio_bis', { match: 'Lazio vs Udinese', kickoff_at: '2026-09-07T18:45:00Z' }), { event: { canonical_event_id: 'ceid3' } }, { cbIdx: { ceid3: { cb_id: 'cb3' } } });
  t('una fila PENDIENTE (sin dinero) NO bloquea la posición', g && g.status === 'PLACED', g && { status: g.status, motivo: g.motivo });

  console.log('\n── en el aire y la casa dice que no la tiene: se libera con la MISMA referencia ──');
  const L = S.load();
  L.bets.push({ ref_id: S.refIdDe('cdp_aire', 0), envios: 0, pick_id: 'cdp_aire', shadow_id: 'sh_aire', match: 'Genoa vs Torino',
    league: 'brasileirao', line: 4.5, side: 'under', kickoff_at: '2026-09-07T16:00:00Z', ceid: 'ceid9', odds_sombra: 1.9, model_prob: 0.62,
    at: new Date().toISOString(), status: 'EN_ACEPTACION', motivo: 'respuesta_no_reconocida', intentos: 1, stake: 40, stake_comprometido: 40 });
  S.save();
  let r;
  for (let i = 0; i < 2; i++) r = await S.confirmar();
  t('dos "no la tengo" seguidos: sigue en el aire', F().cdp_aire.status === 'EN_ACEPTACION' && F().cdp_aire.confirmaciones_sin_rastro === 2, F().cdp_aire.confirmaciones_sin_rastro);
  r = await S.confirmar();
  t('al tercero se libera a PENDIENTE', F().cdp_aire.status === 'PENDIENTE' && r.liberadas === 1, { status: F().cdp_aire.status, r });
  t('con la MISMA referencia (envío 0): si llegó, la casa dirá DUPLICATE_REQUEST', F().cdp_aire.envios === 0 && F().cdp_aire.ref_id === S.refIdDe('cdp_aire', 0));
  t('y sin dinero comprometido', F().cdp_aire.stake_comprometido === undefined);

  console.log('\n── el reconciliador ve la duplicada ──────────────────────────────');
  // simular lo que pasó de verdad: dos referencias de la misma fila aceptadas en la casa
  const Rc = require('./reconciliar');
  const L2 = S.load();
  const fRoma = L2.bets.find((x) => x.pick_id === 'cdp_roma');
  casa.apuestas.set(S.refIdDe('cdp_roma', 0), { referenceId: S.refIdDe('cdp_roma', 0), betStatus: 'ACCEPTED', price: '1.39', stake: '40.0', marketUrl: 'soccer.total_bookings/under?total=4.5', eventId: 'cb2' });
  const cmp = await Rc.compararPorReferencia({ sombra: [], dias: 30, esperar: false, pausaMs: 0 });
  t('la comparación devuelve UNA duplicada, la de Roma', cmp.ok && cmp.duplicadas.length === 1 && cmp.duplicadas[0].pick_id === 'cdp_roma', cmp.duplicadas);
  t('con la referencia de más y su precio', cmp.duplicadas[0].de_mas.length === 1 && cmp.duplicadas[0].de_mas[0].precio === 1.39, cmp.duplicadas[0].de_mas);
  t('y por eso NO cuadra', cmp.cuadra === false, cmp.cuadra);
  const rep = await Rc.reparar({ sombra: [], dias: 30, aplicar: true, esperar: false, pausaMs: 0 });
  t('reparar inserta la apuesta de más como fila propia', rep.insertadas === 1, rep);
  const dup = S.load().bets.find((x) => x.duplicada_de === 'cdp_roma');
  t('marcada duplicada_de, misma línea, precio y stake de la casa', dup && dup.line === 4.5 && dup.odds_real === 1.39 && dup.stake === 40 && dup.status === 'PLACED', dup && { line: dup.line, odds_real: dup.odds_real, stake: dup.stake });
  t('el libro suma ahora las DOS apuestas de Roma en la exposición', S.board().exposicion_abierta >= 80 + 40 * 3, S.board().exposicion_abierta);
  const rep2 = await Rc.reparar({ sombra: [], dias: 30, aplicar: true, esperar: false, pausaMs: 0 });
  t('una segunda reparación no la inserta dos veces', rep2.insertadas === 0, rep2.insertadas);
  t('la fila de Roma tiene ahora OCUPADA la posición: una tercera pick a under 4,5 se descarta',
    (await S.intentar(senal('roma_bis', { match: 'Roma vs Atalanta', kickoff_at: '2026-09-05T18:45:00Z' }), { event: { canonical_event_id: 'ceid2' } }, { cbIdx: idx })).motivo === 'linea_ya_apostada');

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* da igual */ }
  console.log(`\n${ok} comprobaciones en verde, ${ko} en rojo.`);
  process.exit(ko ? 1 : 0);
})();
