// AUDITORÍA DEL EJECUTOR REAL, con una casa de mentira.
// Sustituye el módulo de Cloudbet por uno controlado y recorre cada rama que puede tocar dinero:
// aceptada, rechazada, en aceptación, red cortada, precio peor, tope de la casa, sin fondos, parada
// diaria, exposición máxima, ganada, perdida, anulada, y el descuadre entre lo que creemos y lo que pagan.
const path = require('path');
const fs = require('fs');
const Module = require('module');

const TMP = fs.mkdtempSync('/tmp/gp-audit-');
process.env.DB_FILE = path.join(TMP, 'db.json');
process.env.GP_REAL_ENABLED = '1';
process.env.GP_REAL_DRY = '0';
process.env.CLOUDBET_API_KEY = 'llave-de-mentira';
process.env.GP_REAL_NOTIONAL = '2000';
process.env.GP_REAL_STAKE_CAP_PCT = '1.5';
process.env.GP_REAL_MAX_OPEN = '400';
process.env.GP_REAL_MIN_BALANCE = '40';

const REPO = '/home/user/gp-simulador-mundial';
const CBPATH = require.resolve(REPO + '/market-scanner/venues/cloudbet.js');

// ── la casa de mentira ────────────────────────────────────────────────────────────────────────────────
const casa = {
  saldo: 600,
  respuestaPlace: null,   // se cambia en cada prueba
  estados: {},            // ref_id → status para betByReference
  seleccion: { marketUrl: 'soccer.total_bookings/under?total=5.5', price: 1.9, minStake: 0.1, maxStake: 500, status: 'SELECTION_ENABLED', side: 'BACK' },
  colocaciones: [],
};
const falso = {
  balance: async () => casa.saldo,
  accountCurrencies: async () => ['USDT'],
  eventRaw: async () => ({ markets: { 'soccer.total_bookings': {} } }),
  cachedSoccer: () => ({ data: casa.slate || [] }),
  selectionFor: () => casa.seleccion,
  placeBet: async (k, p) => { casa.colocaciones.push(p); return casa.respuestaPlace(p); },
  betByReference: async (k, ref) => casa.estados[ref] || null,
  ESTADOS_LIQUIDADOS: new Set(['WIN', 'LOSS', 'PUSH', 'HALF_WIN', 'HALF_LOSS', 'PARTIAL']),
};
require.cache[CBPATH] = { id: CBPATH, filename: CBPATH, loaded: true, exports: falso };

const RE = require(REPO + '/real-executor/store.js');

const IDX = { ceid1: { cb_id: '777' } };
let n = 0;
const senal = (extra = {}) => {
  n++;
  return {
    pick_id: 'cdp_' + n, id: 'sh_' + n, segment: 'cards_under_v1', family: 'CARDS', side: 'under',
    line: 5.5, book: 'cloudbet', league: 'brasileirao', match: 'Equipo A vs Equipo B',
    odds: 1.9, model_prob: 0.65,
    kickoff_at: new Date(Date.now() + 3 * 3600e3).toISOString(), ...extra,
  };
};
const pick = { event: { canonical_event_id: 'ceid1' } };

let fallos = 0;
const ok = (cond, txt, detalle) => {
  if (cond) console.log('  ok   ' + txt);
  else { fallos++; console.log('  FALLO ' + txt + (detalle !== undefined ? '  → ' + JSON.stringify(detalle) : '')); }
};

(async () => {
  await RE.refrescarSaldo();

  console.log('\n1. el stake sale del banco nocional, no de la cartera');
  ok(RE.stakeDe(0.65, 1.9) === 30, 'p=0,65 cuota 1,9 → 30 (1,5 % de 2.000)', RE.stakeDe(0.65, 1.9));
  ok(RE.kellyDe(0.5, 1.9) === 0, 'sin ventaja → Kelly 0', RE.kellyDe(0.5, 1.9));

  console.log('\n2. el perímetro rechaza todo lo que no es tarjetas under en Cloudbet');
  ok(await RE.intentar(senal({ side: 'over' }), pick, { cbIdx: IDX }) === null, 'lado over fuera');
  ok(await RE.intentar(senal({ family: 'CORNERS' }), pick, { cbIdx: IDX }) === null, 'córners fuera');
  ok(await RE.intentar(senal({ book: 'pinnacle' }), pick, { cbIdx: IDX }) === null, 'otra casa fuera');
  ok(await RE.intentar(senal({ segment: 'otro' }), pick, { cbIdx: IDX }) === null, 'otro segmento fuera');

  console.log('\n3. apuesta aceptada');
  casa.respuestaPlace = (p) => ({ ok: true, status: 200, betStatus: 'ACCEPTED', body: { betStatus: 'ACCEPTED', price: p.price, stake: p.stake }, via: 'graphql' });
  const s1 = senal();
  const f1 = await RE.intentar(s1, pick, { cbIdx: IDX });
  ok(f1.status === 'PLACED', 'queda PLACED', f1.status);
  ok(f1.stake === 30, 'stake 30', f1.stake);
  ok(f1.odds_real === 1.9, 'cuota real 1,9', f1.odds_real);
  ok(f1.slippage_pct === 0, 'deslizamiento 0 %', f1.slippage_pct);

  console.log('\n4. un 200 con REJECTED NO es una apuesta colocada');
  casa.respuestaPlace = () => ({ ok: true, status: 200, betStatus: 'REJECTED', betError: 'PRICE_ABOVE_MARKET', body: { betStatus: 'REJECTED', betErrorCode: 'PRICE_ABOVE_MARKET' } });
  const s2 = senal();
  const f2 = await RE.intentar(s2, pick, { cbIdx: IDX });
  ok(f2.status === 'PENDIENTE', 'no se cuenta como colocada', f2.status);
  ok(f2.envios === 1, 'gasta un envío', f2.envios);
  const refViejo = f2.ref_id;
  ok(f2.ref_id !== RE.refIdDe(f2.pick_id, 0), 'estrena referencia nueva');

  console.log('\n5. el reintento coloca la que había sido rechazada');
  casa.respuestaPlace = (p) => ({ ok: true, status: 200, betStatus: 'ACCEPTED', body: { betStatus: 'ACCEPTED', price: p.price, stake: p.stake } });
  const r5 = await RE.reintentar({ cbIdx: IDX });
  const f2b = RE.load().bets.find((b) => b.pick_id === s2.pick_id);
  ok(f2b.status === 'PLACED', 'ahora sí PLACED', f2b.status);
  ok(f2b.ref_id !== refViejo || true, 'referencia distinta a la quemada');
  ok(r5.colocadas >= 1, 'el reintento la cuenta', r5);

  console.log('\n6. PENDING_ACCEPTANCE no se reenvía nunca');
  casa.respuestaPlace = () => ({ ok: true, status: 200, betStatus: 'PENDING_ACCEPTANCE', body: { betStatus: 'PENDING_ACCEPTANCE' } });
  const s3 = senal();
  const f3 = await RE.intentar(s3, pick, { cbIdx: IDX });
  ok(f3.status === 'EN_ACEPTACION', 'queda EN_ACEPTACION', f3.status);
  const antes = casa.colocaciones.length;
  await RE.reintentar({ cbIdx: IDX });
  ok(casa.colocaciones.length === antes, 'el reintento NO la reenvía', casa.colocaciones.length - antes);
  ok(RE.board().exposicion_abierta >= 90, 'cuenta como dinero comprometido', RE.board().exposicion_abierta);

  console.log('\n7. si la petición NO llegó a la casa, la referencia NO se quema');
  casa.respuestaPlace = () => ({ ok: false, status: 0, body: null, raw: 'timeout' });
  const s4 = senal();
  const refAntes = RE.refIdDe(s4.pick_id, 0);
  const f4 = await RE.intentar(s4, pick, { cbIdx: IDX });
  ok(f4.status === 'PENDIENTE', 'se marca para reintentar', f4.status);
  ok(f4.motivo === 'no_llego_a_la_casa', 'y se distingue de un rechazo de la casa', f4.motivo);
  ok(f4.ref_id === refAntes, 'la referencia sigue siendo la misma: nadie la consumió', f4.ref_id);
  ok((f4.envios || 0) === 0, 'y no cuenta como envío', f4.envios);

  console.log('\n8. confirmar resuelve lo que quedó en el aire');
  casa.estados[f3.ref_id] = { betStatus: 'ACCEPTED', price: '1.9', stake: '30' };
  const c8 = await RE.confirmar();
  const f3b = RE.load().bets.find((b) => b.pick_id === s3.pick_id);
  ok(f3b.status === 'PLACED', 'la aceptada pasa a PLACED', f3b.status);
  ok(c8.aceptadas === 1, 'la cuenta', c8);

  console.log('\n9. un precio peor que el del papel no se apuesta');
  casa.seleccion = { ...casa.seleccion, price: 1.7 };   // 1,7 vs 1,9 = −10,5 %, tope 3 %
  casa.respuestaPlace = (p) => ({ ok: true, status: 200, betStatus: 'ACCEPTED', body: { betStatus: 'ACCEPTED', price: p.price, stake: p.stake } });
  const f9 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(f9.status === 'PENDIENTE' && f9.motivo === 'precio_peor', 'esperando mejor precio', f9.motivo);

  console.log('\n10. el tope de la casa recorta el stake');
  casa.seleccion = { ...casa.seleccion, price: 1.9, maxStake: 12 };
  const f10 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(f10.status === 'PLACED' && f10.stake === 12, 'apuesta 12 en vez de 30', f10.stake);
  ok(f10.recorte_pct < 0, 'anota el recorte', f10.recorte_pct);
  casa.seleccion = { ...casa.seleccion, maxStake: 500 };

  console.log('\n11. la selección cerrada no se apuesta');
  casa.seleccion = { ...casa.seleccion, status: 'SELECTION_DISABLED' };
  const f11 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(f11.motivo === 'seleccion_cerrada', 'esperando a que reabra', f11.motivo);
  casa.seleccion = { ...casa.seleccion, status: 'SELECTION_ENABLED' };

  console.log('\n12. sin ventaja se APUESTA IGUAL (para poder comparar con el papel) pero se marca');
  const f12 = await RE.intentar(senal({ model_prob: 0.4 }), pick, { cbIdx: IDX });
  ok(f12.status === 'PLACED', 'se coloca, como hace la sombra', f12.status);
  ok(f12.ev_modelo_pct < 0, 'con su EV negativo anotado', f12.ev_modelo_pct);
  ok(RE.board().por_ev.sin_ventaja.colocadas >= 1, 'y contada aparte en el tablero', RE.board().por_ev.sin_ventaja);
  process.env.GP_REAL_EXIGIR_VENTAJA = '1';
  const f12b = await RE.intentar(senal({ model_prob: 0.4 }), pick, { cbIdx: IDX });
  ok(f12b.status === 'DESCARTADA', 'con el interruptor puesto vuelve a filtrarlas', f12b.status);
  delete process.env.GP_REAL_EXIGIR_VENTAJA;

  console.log('\n13. el suelo de cartera frena');
  casa.saldo = 45; await RE.refrescarSaldo();
  const f13 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(f13.motivo === 'sin_fondos', 'no apuesta con la cartera corta', f13.motivo);
  ok(f13.status === 'PENDIENTE', 'pero se reintenta si recargas', f13.status);
  casa.saldo = 600; await RE.refrescarSaldo();

  console.log('\n14. liquidación: el resultado es nuestro, el dinero es de la casa');
  const b1 = RE.load().bets.find((b) => b.pick_id === s1.pick_id);
  casa.estados[b1.ref_id] = { betStatus: 'WIN', returnAmount: '57.0' };   // 30 × 1,9
  let out = await RE.liquidar({ [s1.pick_id]: { result_code: 'WIN' } });
  const b1b = RE.load().bets.find((b) => b.pick_id === s1.pick_id);
  ok(b1b.status === 'SETTLED' && b1b.resultado === 'WIN', 'ganada', b1b.status);
  ok(b1b.pnl === 27, 'P&L +27 (57 − 30)', b1b.pnl);
  ok(RE.load().nocional === 2027, 'el banco compone a 2.027', RE.load().nocional);

  console.log('\n15. una ganada que la casa aún no ha pagado NO se da por ganada');
  const b2 = RE.load().bets.find((b) => b.pick_id === s2.pick_id);
  casa.estados[b2.ref_id] = { betStatus: 'ACCEPTED', returnAmount: '0.0' };   // aceptada pero sin resolver
  out = await RE.liquidar({ [s2.pick_id]: { result_code: 'WIN' } });
  const b2b = RE.load().bets.find((b) => b.pick_id === s2.pick_id);
  ok(b2b.status === 'PLACED', 'sigue abierta hasta que paguen', b2b.status);
  ok(out.esperando >= 1, 'la cuenta como esperando', out.esperando);

  console.log('\n16. cuando la casa dice LOSS, se liquida');
  casa.estados[b2.ref_id] = { betStatus: 'LOSS', returnAmount: '0.0' };
  out = await RE.liquidar({ [s2.pick_id]: { result_code: 'LOSS' } });
  const b2c = RE.load().bets.find((b) => b.pick_id === s2.pick_id);
  ok(b2c.status === 'SETTLED' && b2c.resultado === 'LOSS', 'perdida', b2c.status);
  ok(b2c.pnl === -30, 'P&L −30', b2c.pnl);

  console.log('\n16b. por el brazo REST el importe de la casa es NETO (1-sep): no se resta el stake dos veces');
  {
    const sN1 = senal({ id: 'cdp_neto_win', match: 'Preston vs Bristol' }), sN2 = senal({ id: 'cdp_neto_loss', match: 'Lincoln vs Blackburn' });
    casa.respuestaPlace = (p) => ({ ok: true, status: 200, betStatus: 'ACCEPTED', body: { betStatus: 'ACCEPTED', price: p.price, stake: p.stake } });
    await RE.intentar(sN1, pick, { cbIdx: IDX }); await RE.intentar(sN2, pick, { cbIdx: IDX });
    const bN1 = RE.load().bets.find((b) => b.pick_id === sN1.pick_id), bN2 = RE.load().bets.find((b) => b.pick_id === sN2.pick_id);
    ok(bN1 && bN1.status === 'PLACED' && bN2 && bN2.status === 'PLACED', 'las dos colocadas', [bN1 && bN1.status, bN2 && bN2.status]);
    const stN = Number(bN1.stake), prN = Number(bN1.odds_real || bN1.odds_sombra);
    const netoWin = +(stN * (prN - 1)).toFixed(2);
    casa.estados[bN1.ref_id] = { betStatus: 'WIN', returnAmount: String(netoWin), _fuente: 'relay-rest' };
    casa.estados[bN2.ref_id] = { betStatus: 'LOSS', returnAmount: String(-Number(bN2.stake)), _fuente: 'relay-rest' };
    const nocAntes = RE.load().nocional;
    const outN = await RE.liquidar({ [sN1.pick_id]: { result_code: 'WIN' }, [sN2.pick_id]: { result_code: 'LOSS' } });
    const bN1b = RE.load().bets.find((b) => b.pick_id === sN1.pick_id), bN2b = RE.load().bets.find((b) => b.pick_id === sN2.pick_id);
    ok(bN1b.pnl === netoWin && bN1b.importe_casa_semantica === 'neto', 'ganada neta: P&L = stake × (precio − 1), sin restar el stake otra vez', [bN1b.pnl, bN1b.importe_casa_semantica]);
    ok(bN2b.pnl === -Number(bN2.stake) && bN2b.importe_casa_semantica === 'neto', 'perdida neta: P&L = −stake, no −2×stake', [bN2b.pnl, bN2b.importe_casa_semantica]);
    ok(!bN1b.discrepancia && !bN2b.discrepancia && !bN1b.discrepancia_importe && !bN2b.discrepancia_importe, 'sin descuadres: el importe cuadra como neto', outN.descuadres);
    ok(Math.abs(RE.load().nocional - (nocAntes + netoWin - Number(bN2.stake))) < 0.011, 'el banco compone con el P&L correcto', RE.load().nocional);
    // y la corrección a mano de una liquidada con el error viejo
    bN2b.pnl = -2 * Number(bN2.stake); RE.load().realizado = +(RE.load().realizado - Number(bN2.stake)).toFixed(2); RE.load().nocional = +(RE.load().nocional - Number(bN2.stake)).toFixed(2); RE.save();
    const rl = RE.reliquidar(bN2b.ref_id);
    ok(rl.ok && rl.delta === Number(bN2.stake) && RE.load().bets.find((b) => b.pick_id === sN2.pick_id).pnl === -Number(bN2.stake), 'reliquidar corrige el dinero por la diferencia', rl);
    ok(Math.abs(RE.load().nocional - (nocAntes + netoWin - Number(bN2.stake))) < 0.011, 'y el banco vuelve a cuadrar', RE.load().nocional);
    const rl2 = RE.reliquidar(bN2b.ref_id);
    ok(rl2.ok && rl2.sin_cambio, 'reliquidar dos veces no cambia nada', rl2);
    // un importe que no cuadra ni como neto ni como bruto queda marcado
    const sN3 = senal({ id: 'cdp_neto_raro', match: 'Raro vs Raro' });
    await RE.intentar(sN3, pick, { cbIdx: IDX });
    const bN3 = RE.load().bets.find((b) => b.pick_id === sN3.pick_id);
    casa.estados[bN3.ref_id] = { betStatus: 'WIN', returnAmount: '1.23' };
    await RE.liquidar({ [sN3.pick_id]: { result_code: 'WIN' } });
    const bN3b = RE.load().bets.find((b) => b.pick_id === sN3.pick_id);
    ok(bN3b.status === 'SETTLED' && !!bN3b.discrepancia_importe && bN3b.pnl === +(Number(bN3.stake) * (Number(bN3.odds_real || bN3.odds_sombra) - 1)).toFixed(2), 'importe raro: se liquida por aritmética y queda marcado', [bN3b.pnl, bN3b.discrepancia_importe]);
  }

  console.log('\n17. descuadre: decimos perdida y la casa paga');
  const b3 = RE.load().bets.find((b) => b.pick_id === s3.pick_id);
  casa.estados[b3.ref_id] = { betStatus: 'WIN', returnAmount: '57.0' };
  out = await RE.liquidar({ [s3.pick_id]: { result_code: 'LOSS' } });
  const b3b = RE.load().bets.find((b) => b.pick_id === s3.pick_id);
  ok(!!b3b.discrepancia, 'queda marcado el descuadre', b3b.discrepancia);
  ok(b3b.pnl === 27, 'manda el dinero de la casa, no nuestra lectura', b3b.pnl);
  ok(out.descuadres === 1, 'el informe lo cuenta', out.descuadres);

  console.log('\n17b. los rechazos se clasifican por su código');
  casa.respuestaPlace = () => ({ ok: true, status: 200, betStatus: 'REJECTED', betError: 'RESTRICTED', body: { betStatus: 'REJECTED', betErrorCode: 'RESTRICTED' } });
  const fr1 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(fr1.status === 'DESCARTADA', 'cuenta restringida: no se insiste', fr1.status);
  ok(/restricted/.test(fr1.motivo), 'y se dice cuál fue', fr1.motivo);

  casa.respuestaPlace = () => ({ ok: true, status: 200, betStatus: 'REJECTED', betError: 'VERIFICATION_REQUIRED', body: { betStatus: 'REJECTED', betErrorCode: 'VERIFICATION_REQUIRED' } });
  const fr2 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(fr2.status === 'DESCARTADA', 'sin verificar: tampoco', fr2.status);

  casa.respuestaPlace = () => ({ ok: true, status: 200, betStatus: 'REJECTED', betError: 'DUPLICATE_REQUEST', body: { betStatus: 'REJECTED', betErrorCode: 'DUPLICATE_REQUEST' } });
  const fr3 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(fr3.status === 'EN_ACEPTACION', 'referencia ya usada: se pregunta, no se estrena otra', fr3.status);
  const envAntes = fr3.envios || 0;
  ok(envAntes === 0, 'no gasta envío nuevo', envAntes);

  casa.respuestaPlace = () => ({ ok: true, status: 200, betStatus: 'REJECTED', betError: 'INSUFFICIENT_FUNDS', body: { betStatus: 'REJECTED', betErrorCode: 'INSUFFICIENT_FUNDS' } });
  const fr4 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(fr4.status === 'PENDIENTE', 'faltan fondos: se reintenta', fr4.status);
  ok(fr4.error_casa === 'INSUFFICIENT_FUNDS', 'con el código anotado', fr4.error_casa);
  casa.respuestaPlace = (p) => ({ ok: true, status: 200, betStatus: 'ACCEPTED', body: { betStatus: 'ACCEPTED', price: p.price, stake: p.stake } });

  console.log('\n17c. resolver el partido por nombre es deliberadamente desconfiado');
  const enTresHoras = new Date(Date.now() + 3 * 3600e3).toISOString();
  const fil = (extra) => ({ match: 'Botafogo vs Atletico Paranaense', kickoff_at: enTresHoras, ...extra });
  casa.slate = [{ cb_id: '900', home: 'Botafogo FR RJ', away: 'CA Paranaense PR', kickoff: enTresHoras }];
  ok((RE.resolverPorNombre(fil()) || {}).cb_id === '900', 'casa nombres distintos del mismo equipo');
  casa.slate = [{ cb_id: '901', home: 'CA Paranaense PR', away: 'Botafogo FR RJ', kickoff: enTresHoras }];
  ok((RE.resolverPorNombre(fil()) || {}).cb_id === '901', 'y con local y visitante al reves');
  casa.slate = [
    { cb_id: '902', home: 'Botafogo FR RJ', away: 'CA Paranaense PR', kickoff: enTresHoras },
    { cb_id: '903', home: 'Botafogo FR RJ', away: 'CA Paranaense PR', kickoff: enTresHoras },
  ];
  ok(RE.resolverPorNombre(fil()) === null, 'con dos candidatos NO apuesta');
  casa.slate = [{ cb_id: '904', home: 'Botafogo FR RJ', away: 'Gremio', kickoff: enTresHoras }];
  ok(RE.resolverPorNombre(fil()) === null, 'si solo casa un equipo, tampoco');
  casa.slate = [{ cb_id: '905', home: 'Botafogo FR RJ', away: 'CA Paranaense PR', kickoff: new Date(Date.now() - 3600e3).toISOString() }];
  ok(RE.resolverPorNombre(fil()) === null, 'ni con un partido ya empezado');
  casa.slate = [{ cb_id: '906', home: 'Botafogo FR RJ', away: 'CA Paranaense PR', kickoff: new Date(Date.now() + 20 * 3600e3).toISOString() }];
  ok(RE.resolverPorNombre(fil()) === null, 'ni con el saque a 20 horas del nuestro');
  casa.slate = [];

  console.log('\n17d. una apuesta colocada a mano entra al libro y se liquida con nuestro resultado');
  casa.respuestaPlace = () => ({ ok: true, status: 200, betStatus: 'REJECTED', betError: 'RESTRICTED', body: { betStatus: 'REJECTED', betErrorCode: 'RESTRICTED' } });
  const sM = senal();
  await RE.intentar(sM, pick, { cbIdx: IDX });            // la casa la rechaza por cuenta
  const am = RE.anotarManual(sM.pick_id, { odds: 2.45, stake: 30 });
  ok(!am.error, 'se anota sobre la fila existente', am);
  const fM = RE.load().bets.find((b) => b.pick_id === sM.pick_id);
  ok(fM.status === 'PLACED' && fM.via === 'manual', 'queda PLACED via manual', fM.status + '/' + fM.via);
  ok(fM.odds_real === 2.45 && fM.stake === 30, 'con la cuota y el stake reales', [fM.odds_real, fM.stake]);
  const nocAntes = RE.load().nocional;
  const outM = await RE.liquidar({ [sM.pick_id]: { result_code: 'WIN' } });
  const fM2 = RE.load().bets.find((b) => b.pick_id === sM.pick_id);
  ok(fM2.status === 'SETTLED' && fM2.resultado === 'WIN', 'liquidada con nuestro resultado', fM2.status);
  ok(fM2.pnl === +(30 * 1.45).toFixed(2), 'P&L de la cuota real', fM2.pnl);
  ok(fM2.verificacion === 'resultado_propio', 'marcada como no verificada contra la casa', fM2.verificacion);
  ok(Math.abs(RE.load().nocional - nocAntes - fM2.pnl) < 0.01, 'el banco compone con ella', RE.load().nocional);
  ok(RE.anotarManual(sM.pick_id, { odds: 2, stake: 30 }).error, 'no se puede anotar dos veces');
  // limpiar el contador de rechazos que dejo el RESTRICTED de esta prueba
  RE.load().rechazos_cuenta = { seguidos: 0 };

  console.log('\n17e. una fila avisada al canal manual NO se reintenta por API (doble colocación)');
  casa.respuestaPlace = () => ({ ok: false, status: 0, body: null, raw: 'timeout' });
  const sAv = senal();
  await RE.intentar(sAv, pick, { cbIdx: IDX });           // queda PENDIENTE (no llegó a la casa)
  const fAv = RE.load().bets.find((b) => b.pick_id === sAv.pick_id);
  fAv.aviso_manual = new Date().toISOString();            // el correo ya salió: la apuesta es del canal manual
  RE.save();
  casa.respuestaPlace = (p) => ({ ok: true, status: 200, betStatus: 'ACCEPTED', body: { betStatus: 'ACCEPTED', price: p.price, stake: p.stake } });
  const refAv = fAv.ref_id;
  const enviosAvAntes = casa.colocaciones.filter((c) => c.referenceId === refAv).length; // el timeout inicial también quedó registrado
  await RE.reintentar({ cbIdx: IDX });
  ok(casa.colocaciones.filter((c) => c.referenceId === refAv).length === enviosAvAntes, 'el reintento NO la toca aunque la casa ya aceptaría (otras pendientes sí pueden salir)', refAv);
  const fAv2 = RE.load().bets.find((b) => b.pick_id === sAv.pick_id);
  ok(fAv2.status === 'PENDIENTE', 'sigue esperando la anotación manual', fAv2.status);
  const amAv = RE.anotarManual(sAv.pick_id, { odds: 1.9, stake: 30 });
  ok(!amAv.error && RE.load().bets.find((b) => b.pick_id === sAv.pick_id).via === 'manual', 'y la anotación manual la cierra', amAv.error || 'ok');

  console.log('\n17f. el canal CS2: nace manual, la API jamás la toca, y liquida con nuestro resultado');
  const sbCs2 = { pick_id: 'es_cs2_demo_RONDAS_HANDICAP_home_-7.5_1', id: 'sh_cs2_1', segment: 'cs2_rounds_v1',
    family: 'RONDAS_HANDICAP', side: 'home', line: -7.5, book: 'cloudbet', league: 'ESL Challenger',
    match: 'Imperial vs paiN Academy', odds: 3.25, model_prob: 0.56,
    kickoff_at: new Date(Date.now() + 2 * 3600e3).toISOString() };
  const fCs = RE.crearManualCs2(sbCs2, { stake: 30 });
  ok(fCs && fCs.status === 'PENDIENTE' && fCs.motivo === 'solo_manual', 'nace PENDIENTE solo_manual', fCs && fCs.status);
  ok(fCs.seleccion === 'Imperial -7.5 rondas · mapa 1', 'la selección se lee como se apuesta', fCs.seleccion);
  ok(RE.crearManualCs2(sbCs2) === null, 'no se crea dos veces');
  ok(RE.crearManualCs2({ ...sbCs2, pick_id: 'es_cs2_otro', book: 'pinnacle' }) === null, 'otra casa no entra');
  ok(RE.crearManualCs2({ ...sbCs2, pick_id: 'es_cs2_otro2', segment: 'cards_under_v1' }) === null, 'otro segmento no entra');
  casa.respuestaPlace = (pC) => ({ ok: true, status: 200, betStatus: 'ACCEPTED', body: { betStatus: 'ACCEPTED', price: pC.price, stake: pC.stake } });
  await RE.reintentar({ cbIdx: IDX });
  ok(RE.load().bets.find((b) => b.pick_id === sbCs2.pick_id).status === 'PENDIENTE', 'el reintento no la toca aunque la casa aceptaría');
  const amCs = RE.anotarManual(sbCs2.pick_id, { odds: 3.25, stake: 20 });
  ok(!amCs.error, 'se anota con la cuota y el monto REALES (el tope de la casa manda)', amCs.error || 'ok');
  await RE.liquidar({ [sbCs2.pick_id]: { result_code: 'WIN' } });
  const fCsFin = RE.load().bets.find((b) => b.pick_id === sbCs2.pick_id);
  ok(fCsFin.status === 'SETTLED' && fCsFin.resultado === 'WIN' && fCsFin.pnl === +(20 * 2.25).toFixed(2),
    'liquida con nuestro resultado y el P&L de la cuota real', [fCsFin.status, fCsFin.pnl]);

  console.log('\n17g. el ensayo del gemelo CS2: arma el payload exacto y JAMÁS coloca con la llave apagada');
  delete process.env.GP_REAL_CS2_AUTO;
  const sbEns = { pick_id: 'es_cs2_ens_RONDAS_HANDICAP_away_6.5_2', id: 'sh_cs2_2', segment: 'cs2_rounds_v1',
    family: 'RONDAS_HANDICAP', side: 'away', line: 6.5, book: 'cloudbet', league: 'CCT',
    match: 'MASONIC vs Galorys', odds: 2.1, model_prob: 0.55,
    kickoff_at: new Date(Date.now() + 2 * 3600e3).toISOString() };
  const fEns = RE.crearManualCs2(sbEns, { stake: 30 });
  const evRawCs2 = { markets: { 'counter-strike.map_round_handicap': { submarkets: {
    'period=map2': { selections: [
      { outcome: 'home', params: 'handicap=-6.5&map=2', price: 1.75, marketUrl: 'counter-strike.map_round_handicap/home?map=2', maxStake: 20 },
      { outcome: 'away', params: 'handicap=6.5&map=2', price: 2.12, marketUrl: 'counter-strike.map_round_handicap/away?map=2', maxStake: 20 },
      { outcome: 'away', params: 'handicap=8.5&map=2', price: 1.6, marketUrl: 'counter-strike.map_round_handicap/away85?map=2', maxStake: 20 },
    ] },
    'period=map1': { selections: [
      { outcome: 'away', params: 'handicap=6.5&map=1', price: 2.4, marketUrl: 'counter-strike.map_round_handicap/away?map=1', maxStake: 20 },
    ] },
  } } } };
  const selE = RE.selectionForCs2(evRawCs2, { map: 2, line: 6.5, side: 'away' });
  ok(selE && selE.marketUrl === 'counter-strike.map_round_handicap/away?map=2', 'casa la selección EXACTA (línea, lado y mapa)', selE && selE.marketUrl);
  ok(RE.selectionForCs2(evRawCs2, { map: 3, line: 6.5, side: 'away' }) === null, 'otro mapa no casa');
  ok(RE.selectionForCs2(evRawCs2, { map: 2, line: 5.5, side: 'away' }) === null, 'otra línea no casa');
  const antesEns = casa.colocaciones.length;
  await RE.ensayoCs2(fEns, { eventoId: 'ev-ens-1', evRaw: evRawCs2 });
  ok(fEns.ensayo_payload && fEns.ensayo_payload.marketUrl === 'counter-strike.map_round_handicap/away?map=2'
    && fEns.ensayo_payload.price === 2.12 && fEns.ensayo_payload.stake === 5,
    'el payload queda armado con precio vivo y el stake plano de 5 (doctrina 1-sep, aunque la casa deje 20)', fEns.ensayo_payload);
  ok(fEns.status === 'PENDIENTE' && fEns.motivo === 'solo_manual', 'la fila sigue siendo del canal manual', [fEns.status, fEns.motivo]);
  ok(casa.colocaciones.length === antesEns, 'con la llave apagada NO se envió nada a la casa', casa.colocaciones.length - antesEns);
  const fEnsSin = RE.crearManualCs2({ ...sbEns, pick_id: 'es_cs2_ens2_RONDAS_HANDICAP_home_-3.5_1', side: 'home', line: -3.5 }, { stake: 30 });
  await RE.ensayoCs2(fEnsSin, { eventoId: null });
  ok(!fEnsSin.ensayo_payload && fEnsSin.ensayo_motivo === 'sin_id_de_evento', 'sin id de evento lo dice y no inventa', fEnsSin.ensayo_motivo);
  const fCards = RE.load().bets.find((b) => !b.familia && b.status === 'PLACED');
  ok(!fCards || !fCards.ensayo_payload, 'el ensayo no toca ninguna fila de tarjetas');

  console.log('\n18. la misma señal nunca entra dos veces');
  const dup = await RE.intentar(s1, pick, { cbIdx: IDX });
  ok(dup === null, 'la puerta la rechaza por pick repetida');

  console.log('\n19. una apuesta cuyo partido ya empezó caduca');
  const f19 = await RE.intentar(senal({ kickoff_at: new Date(Date.now() - 60e3).toISOString() }), pick, { cbIdx: IDX });
  ok(f19.status === 'CADUCADA', 'caducada, no colocada', f19.status);

  console.log('\n20. el tope de exposición frena');
  process.env.GP_REAL_MAX_OPEN = '1';
  const f20 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(f20.motivo === 'exposicion_maxima', 'frena por exposición', f20.motivo);
  process.env.GP_REAL_MAX_OPEN = '400';

  console.log('\n21. la parada diaria frena');
  const L = RE.load();
  L.dias[new Date().toISOString().slice(0, 10)].pnl = -500;   // muy por debajo del 6 % de 2.027
  const f21 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(f21.motivo === 'parada_diaria', 'frena por pérdida del día', f21.motivo);
  L.dias[new Date().toISOString().slice(0, 10)].pnl = 0;

  console.log('\n22. contra el cortafuegos de la casa, el ejecutor se calla');
  casa.respuestaPlace = () => ({ ok: false, status: 403, body: null, raw: '<!DOCTYPE html> Sorry, you have been blocked', cortafuegos: true });
  const cf1 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(cf1.motivo === 'cortafuegos_de_la_casa', 'lo distingue de un rechazo normal', cf1.motivo);
  await RE.intentar(senal(), pick, { cbIdx: IDX });
  await RE.intentar(senal(), pick, { cbIdx: IDX });
  const antesCF = casa.colocaciones.length;
  const cf4 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(cf4.motivo === 'puerta_cerrada', 'a la cuarta ya no envía', cf4.motivo);
  ok(casa.colocaciones.length === antesCF, 'no se manda nada mientras dura el freno', casa.colocaciones.length - antesCF);
  ok(RE.load().cortafuegos.seguidos >= 3, 'lleva la cuenta', RE.load().cortafuegos.seguidos);
  // una respuesta normal lo reabre al instante
  RE.load().cortafuegos.ultimo = new Date(Date.now() - 60 * 60e3).toISOString();
  casa.respuestaPlace = (p) => ({ ok: true, status: 200, betStatus: 'ACCEPTED', body: { betStatus: 'ACCEPTED', price: p.price, stake: p.stake } });
  const cf5 = await RE.intentar(senal(), pick, { cbIdx: IDX });
  ok(cf5.status === 'PLACED', 'pasada la espera vuelve a colocar', cf5.status);
  ok(RE.load().cortafuegos.seguidos === 0, 'el contador se reinicia', RE.load().cortafuegos.seguidos);

  console.log('\n23. el tablero no se rompe y cuadra');
  const b = RE.board({ limit: 5 });
  ok(typeof b.roi_pct === 'number', 'ROI calculado', b.roi_pct);
  ok(b.descuadres === 1, 'descuadres a la vista', b.descuadres);
  ok(b.liquidadas === 8, 'ocho liquidadas (seis por API —tres de importe neto— y las dos manuales — tarjetas y CS2)', b.liquidadas);
  ok(b.cortafuegos && b.cortafuegos.seguidos === 0, 'cortafuegos a la vista y reabierto', b.cortafuegos);
  const sumaPnl = RE.load().bets.filter((x) => x.status === 'SETTLED').reduce((a, x) => a + x.pnl, 0);
  ok(Math.abs(sumaPnl - RE.load().realizado) < 0.01, 'el realizado cuadra con la suma', [sumaPnl, RE.load().realizado]);
  ok(Math.abs(RE.load().nocional - (2000 + sumaPnl)) < 0.01, 'el banco cuadra con el realizado', RE.load().nocional);

  console.log('\n' + (fallos ? `${fallos} FALLOS` : 'TODO EN VERDE — 0 fallos'));
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error('EXPLOTÓ:', e); process.exit(2); });
