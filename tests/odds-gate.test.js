// tests/odds-gate.test.js — la puerta única de The Odds API (19-sep). Sin red: `fetch` falso.
'use strict';
const assert = require('assert');
const G = require('../lib/odds-gate');

let ok = 0, fail = 0;
const t = (nombre, fn) => { try { fn(); ok++; console.log('  ✓ ' + nombre); } catch (e) { fail++; console.log('  ✗ ' + nombre + ' — ' + e.message); } };

const ODDS = 'https://api.the-odds-api.com/v4/sports/soccer_epl/odds?apiKey=k&regions=eu,us&markets=h2h,totals';
const CAT = 'https://api.the-odds-api.com/v4/sports/?apiKey=k';
const EVS = 'https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=k';

function fakeFetch(estado) {
  const llamadas = [];
  const f = async (url) => {
    llamadas.push(String(url));
    if (estado.modo === '401') return new Response(JSON.stringify({ error_code: 'DEACTIVATED_KEY' }), { status: 401, headers: { 'content-type': 'application/json' } });
    return new Response('[]', { status: 200, headers: { 'x-requests-remaining': String(estado.remaining), 'x-requests-used': '20', 'x-requests-last': '10' } });
  };
  return { f, llamadas };
}

function fresco(env) {
  G._reset();
  for (const k of ['SPORTSBOOK_DAILY_CREDITS', 'SPORTSBOOK_QUOTA_RESERVE', 'SPORTSBOOK_GATE']) delete process.env[k];
  Object.assign(process.env, env);
  global._oddsCredits = { remaining: null, at: 0 };
}

(async () => {
  console.log('odds-gate');

  t('esGratis: catálogo y pre-check sí; /odds, /scores y /events/{id}/odds no', () => {
    assert.strictEqual(G.esGratis(CAT), true);
    assert.strictEqual(G.esGratis(EVS), true);
    assert.strictEqual(G.esGratis(ODDS), false);
    assert.strictEqual(G.esGratis('https://api.the-odds-api.com/v4/sports/x/scores?apiKey=k'), false);
    assert.strictEqual(G.esGratis('https://api.the-odds-api.com/v4/sports/x/events/abc/odds?apiKey=k'), false);
  });
  t('costeEstimado = regiones × mercados', () => {
    assert.strictEqual(G.costeEstimado(ODDS), 4);
    assert.strictEqual(G.costeEstimado('https://api.the-odds-api.com/v4/sports/x/odds?apiKey=k&regions=us,us2,uk,eu,au&markets=h2h,spreads,totals'), 15);
  });

  // ── tope diario ──
  {
    fresco({ SPORTSBOOK_DAILY_CREDITS: '16', SPORTSBOOK_QUOTA_RESERVE: '0' });
    const st = { remaining: 480 }; const { f, llamadas } = fakeFetch(st);
    G.instalar({ fetchBase: f });
    const r0 = await globalThis.fetch('https://example.com/x');
    t('otro host pasa sin tocar', () => { assert.strictEqual(r0.status, 200); assert.strictEqual(llamadas.length, 1); });
    const r1 = await globalThis.fetch(CAT);
    t('el catálogo pasa y no gasta', () => { assert.strictEqual(r1.status, 200); assert.strictEqual(G.estado().gastado_hoy, 0); });
    const r2 = await globalThis.fetch(ODDS);
    t('la primera /odds pasa, anota el coste real de la cabecera y publica remaining en global._oddsCredits', () => {
      assert.strictEqual(r2.status, 200); assert.strictEqual(G.estado().gastado_hoy, 10); assert.strictEqual(global._oddsCredits.remaining, 480);
    });
    await globalThis.fetch(ODDS);
    const n = llamadas.length; const r4 = await globalThis.fetch(ODDS);
    t('con el tope cubierto la /odds se bloquea SIN salir a la red, con 429 y ok=false', () => {
      assert.strictEqual(r4.status, 429); assert.strictEqual(r4.ok, false); assert.strictEqual(r4.headers.get('x-odds-gate'), 'tope_diario'); assert.strictEqual(llamadas.length, n);
    });
    const j4 = await r4.json();
    t('el cuerpo del bloqueo es JSON con motivo', () => { assert.strictEqual(j4.error, 'odds_gate'); assert.strictEqual(j4.motivo, 'tope_diario'); });
    const r5 = await globalThis.fetch(EVS);
    t('el pre-check /events sigue pasando con el tope lleno', () => assert.strictEqual(r5.status, 200));
    t('estado() cuenta permitidas, bloqueadas y gratis', () => { const e = G.estado(); assert.strictEqual(e.permitidas_hoy, 2); assert.strictEqual(e.bloqueadas_hoy, 1); assert.strictEqual(e.gratis_hoy, 2); });
  }

  // ── reserva ──
  {
    fresco({ SPORTSBOOK_DAILY_CREDITS: '0', SPORTSBOOK_QUOTA_RESERVE: '500' });
    const { f } = fakeFetch({ remaining: 480 }); G.instalar({ fetchBase: f });
    await globalThis.fetch(ODDS); const r = await globalThis.fetch(ODDS);
    t('remaining 480 < reserva 500 → bloquea por reserva', () => { assert.strictEqual(r.status, 429); assert.strictEqual(r.headers.get('x-odds-gate'), 'reserva'); });
  }

  // ── clave muerta ──
  {
    fresco({ SPORTSBOOK_QUOTA_RESERVE: '0' });
    const st = { remaining: 480, modo: '401' }; const { f, llamadas } = fakeFetch(st); G.instalar({ fetchBase: f });
    const r1 = await globalThis.fetch(ODDS);
    t('un 401 DEACTIVATED_KEY llega al llamador tal cual', () => assert.strictEqual(r1.status, 401));
    const n = llamadas.length; const r2 = await globalThis.fetch(ODDS);
    t('la siguiente no sale a la red: clave muerta seis horas', () => { assert.strictEqual(r2.status, 429); assert.strictEqual(r2.headers.get('x-odds-gate'), 'clave_desactivada'); assert.strictEqual(llamadas.length, n); });
    t('estado() lo dice en la lectura', () => assert.ok(/DEACTIVATED_KEY/.test(G.estado().lectura)));
    const r3 = await globalThis.fetch(CAT);
    t('el catálogo gratis pasa aunque la clave esté marcada muerta (es lo que la resucita al reactivarla)', () => assert.strictEqual(r3.status, 401));
  }

  // ── apagada ──
  {
    fresco({ SPORTSBOOK_GATE: 'off', SPORTSBOOK_DAILY_CREDITS: '1' });
    const { f, llamadas } = fakeFetch({ remaining: 5 }); G.instalar({ fetchBase: f });
    await globalThis.fetch(ODDS); await globalThis.fetch(ODDS); await globalThis.fetch(ODDS);
    t('SPORTSBOOK_GATE=off deja pasar todo', () => assert.strictEqual(llamadas.length, 3));
  }

  console.log(`\n${ok} ok, ${fail} fallos`);
  process.exit(fail ? 1 : 0);
})();
