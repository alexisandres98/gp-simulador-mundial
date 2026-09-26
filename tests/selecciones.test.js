// tests/selecciones.test.js — SELECCIONES como ligas virtuales del motor de clubes (26-sep-2026).
//
// Lo que se fija: (1) las tres competiciones copian el pool `selecciones` en un solo nivel (offset 0) y
// llevan la marca para el feed; (2) las claves cumplen la forma [a-z0-9]+ que exige la UI en club_eid;
// (3) el pool queda oculto y sin fuentes propias (no se barre, no se siembra, no se puntúa); (4) el dinero
// real veta las tres ligas por defecto y la env lo cambia; (5) los alias de nombres normalizan lo que
// escriben The Odds API, Cloudbet y ESPN al nombre de API-Football del pool.
'use strict';
const path = require('path');
const fs = require('fs');
const { CLUB_CUPS, buildCupLeague } = require('../clubs-engine/cups');

let fallos = 0;
const t = (nombre, ok) => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}`); };

const RT = { leagues: { selecciones: { key: 'selecciones', pool: true, hidden: true, odds_key: null, ratings: {
  tm_af9: { elo: 1849, name: 'Spain', games: 34 }, tm_af10: { elo: 1720, name: 'England', games: 30 }, tm_af770: { elo: 1500, name: 'Czechia', games: 12 } } } } };

// ── 1. las tres ligas virtuales ───────────────────────────────────────────────────────────────────────────
for (const key of ['uefanl', 'concacafnl', 'amistososel']) {
  const cfg = CLUB_CUPS[key];
  t(`${key} está en CLUB_CUPS y copia solo el pool`, !!cfg && cfg.from.length === 1 && cfg.from[0][0] === 'selecciones' && cfg.selecciones === true);
  const L = buildCupLeague(RT, key, cfg, 150);
  t(`${key}: ratings copiados sin offset (Spain 1849, Czechia 1500)`, L.ratings.tm_af9.elo === 1849 && L.ratings.tm_af9.tier_offset === 0 && L.ratings.tm_af770.elo === 1500);
  t(`${key}: marca de selecciones, país Internacional, puerta en sombra si el pool no trae backtest`, L.selecciones === true && L.country === 'Internacional' && L.backtest.status === 'shadow' && L.goals_backtest.status === 'shadow');
  t(`${key}: clave válida para club_eid`, /^[a-z0-9]+$/.test(key));
}
t('uefanl tiene clave en The Odds API y las otras dos no (entran por Cloudbet)', CLUB_CUPS.uefanl.odds_key === 'soccer_uefa_nations_league' && CLUB_CUPS.concacafnl.odds_key === null && CLUB_CUPS.amistososel.odds_key === null);
t('hfa por competición: Nations League 40 (medido), amistosos 60', CLUB_CUPS.uefanl.hfa === 40 && CLUB_CUPS.amistososel.hfa === 60);
t('el pool no se convierte en liga virtual (no está en CLUB_CUPS)', !CLUB_CUPS.selecciones);

// ── 2. el pool en ratings.json (cuando ya se escribió) ───────────────────────────────────────────────────
try {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'clubs', 'ratings.json'), 'utf8'));
  const P = real.leagues.selecciones;
  if (P) {
    t('pool: oculto, sin odds_key, sin comp, con ratings tm_af', P.pool === true && P.hidden === true && P.odds_key == null && P.comp == null && Object.keys(P.ratings).every((k) => /^tm_af\d+$/.test(k)));
    t('pool: al menos 150 selecciones absolutas y ninguna juvenil', Object.keys(P.ratings).length >= 150 && !Object.values(P.ratings).some((r) => /\bU\d{2}\b|U-\d{2}/.test(r.name)));
    t('pool: España entre las cinco primeras', Object.values(P.ratings).sort((a, b) => b.elo - a.elo).slice(0, 5).some((r) => r.name === 'Spain'));
    t('pool: no cambió _meta.fitted_at (o borraría los overlays de todas las ligas)', real._meta.fitted_at === '2026-08-08T15:10:10.961Z');
  } else console.log('info  el pool todavía no está escrito en ratings.json (correr scripts/selecciones-fit.js --write)');
} catch (e) { console.log('info  sin ratings.json legible:', e.message); }

// ── 3. el veto del dinero real por liga ──────────────────────────────────────────────────────────────────
const RE = require('../real-executor/store');
delete process.env.GP_REAL_LIGAS_VETADAS;
t('veto por defecto: uefanl, concacafnl, amistososel', RE.ligaVetada('uefanl') && RE.ligaVetada('concacafnl') && RE.ligaVetada('amistososel'));
t('ligamx y brasileirao no están vetadas por liga', !RE.ligaVetada('ligamx') && !RE.ligaVetada('brasileirao') && !RE.ligaVetada(null));
process.env.GP_REAL_LIGAS_VETADAS = 'uefanl';
t('la env reduce el veto a lo que diga', RE.ligaVetada('uefanl') && !RE.ligaVetada('amistososel'));
process.env.GP_REAL_LIGAS_VETADAS = '';
t('env vacía = sin veto por liga', !RE.ligaVetada('uefanl'));
delete process.env.GP_REAL_LIGAS_VETADAS;

// ── 4. alias de nombres (el normalizador vive en server.js; se replica aquí la parte que importa) ──────────
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const bloque = src.slice(src.indexOf('const CLUB_ALIAS = {'), src.indexOf('function clubNorm('));
for (const [feed, af] of [['czech republic', 'czechia'], ['north macedonia', 'fyr macedonia'], ['turkey', 'turkiye'], ['republic of korea', 'south korea'], ['united states', 'usa'], ['republic of ireland', 'rep of ireland'], ['cote d ivoire', 'ivory coast']]) {
  t(`alias '${feed}' → '${af}'`, new RegExp(`'${feed}': '${af}'`).test(bloque));
}
t('LEAGUE_EFF_PRIOR fija banda a las tres (no cae en blanda)', /uefanl: 'eficiente', concacafnl: 'intermedia', amistososel: 'intermedia'/.test(src));
t('CLUB_AF_LEAGUE y CLUB_ESPN tienen las tres', /uefanl: 5, concacafnl: 536, amistososel: 10/.test(src) && /uefanl: 'uefa\.nations', concacafnl: 'concacaf\.nations\.league', amistososel: 'fifa\.friendly'/.test(src));

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
