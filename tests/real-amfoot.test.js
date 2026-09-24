// tests/real-amfoot.test.js — EL CANAL REAL DE COLLEGE (24-sep-2026): la selección en el evento crudo de Cloudbet.
//
// El fixture es el evento 36420354 (Coastal Carolina v Liberty, 24-sep) tal cual lo devolvió la casa. Lo que
// se fija aquí es la CONVENCIÓN DEL SIGNO del hándicap (params `handicap=` es el del LOCAL, igual en las dos
// selecciones; nuestra línea son los puntos que DA el local, así que `handicap = −línea`), que el total casa
// la línea EXACTA, y que mitades y cuartos jamás entran aunque tengan la misma línea.
'use strict';
const path = require('path');
const fs = require('fs');
const RA = require('../real-executor/amfoot');

let fallos = 0;
const t = (nombre, ok) => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}`); };
const ev = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cb-ncaaf-event.json'), 'utf8'));

// ── TOTAL ────────────────────────────────────────────────────────────────────────────────────────────────
const o50 = RA.selectionAmfoot(ev, { familia: 'TOTAL', side: 'over', line: 50 });
t('total over 50 → marketUrl exacto y precio', o50 && o50.marketUrl === 'american_football.totals/over?total=50' && o50.price === 1.88);
const u48 = RA.selectionAmfoot(ev, { familia: 'TOTAL', side: 'under', line: 48 });
t('total under 48 → precio 2,17', u48 && u48.price === 2.17 && /period=ot&period=ft/.test(u48.submercado));
t('total 47,5 (línea que la casa no cotiza) → null, nunca la de al lado', RA.selectionAmfoot(ev, { familia: 'TOTAL', side: 'over', line: 47.5 }) === null);
t('total 26 existe SOLO en la primera mitad → null (otro mercado, otra apuesta)', RA.selectionAmfoot(ev, { familia: 'TOTAL', side: 'over', line: 26 }) === null);

// ── SPREAD: el signo ─────────────────────────────────────────────────────────────────────────────────────
// la casa cotiza handicap=2.5 (local +2,5) y handicap=-1.5 (local −1,5). En nuestra convención la línea es
// lo que DA el local: local +2,5 ⇒ línea −2,5; local −1,5 ⇒ línea 1,5.
const hM25 = RA.selectionAmfoot(ev, { familia: 'SPREAD', side: 'home', line: -2.5 });
t('spread home línea −2,5 → handicap=2.5 lado home a 1,90', hM25 && hM25.marketUrl === 'american_football.handicap/home?handicap=2.5' && hM25.price === 1.9);
const aM25 = RA.selectionAmfoot(ev, { familia: 'SPREAD', side: 'away', line: -2.5 });
t('spread away línea −2,5 → handicap=2.5 lado away a 1,88', aM25 && aM25.marketUrl === 'american_football.handicap/away?handicap=2.5' && aM25.price === 1.88);
const h15 = RA.selectionAmfoot(ev, { familia: 'SPREAD', side: 'home', line: 1.5 });
t('spread home línea 1,5 → handicap=-1.5 lado home a 2,15', h15 && h15.marketUrl === 'american_football.handicap/home?handicap=-1.5' && h15.price === 2.15);
t('spread línea 3,5 (no cotizada) → null', RA.selectionAmfoot(ev, { familia: 'SPREAD', side: 'home', line: 3.5 }) === null);
t('spread 0,5 existe SOLO en la primera mitad → null', RA.selectionAmfoot(ev, { familia: 'SPREAD', side: 'home', line: 0.5 }) === null);
t('un lado que no es del mercado → null', RA.selectionAmfoot(ev, { familia: 'SPREAD', side: 'over', line: 1.5 }) === null);
t('una familia desconocida → null', RA.selectionAmfoot(ev, { familia: 'MONEYLINE', side: 'home', line: 0 }) === null);

// ── EL EVENTO DE CADA PICK ───────────────────────────────────────────────────────────────────────────────
const evs = [{ id: '36420354', home: 'Coastal Carolina', away: 'Liberty', cutoff: '2026-09-24T23:30:00Z' }, { id: '1', home: 'Temple Owls', away: 'Army', cutoff: '2026-09-25T20:00:00Z' }];
const res = (n) => String(n || '').toLowerCase().replace(/ (owls|flames|chanticleers)$/, '');
t('casa por resolutor (nombres distintos, mismo equipo)', (RA.eventoDe(evs, { home_full: 'Coastal Carolina Chanticleers', away_full: 'Liberty Flames', kickoff: '2026-09-24T23:30:00Z' }, res) || {}).id === '36420354');
t('un partido a más de 12 h del cutoff no casa', RA.eventoDe(evs, { home_full: 'Coastal Carolina Chanticleers', away_full: 'Liberty Flames', kickoff: '2026-09-27T23:30:00Z' }, res) === null);
t('sin pareja → null', RA.eventoDe(evs, { home_full: 'Alabama', away_full: 'Georgia', kickoff: '2026-09-24T23:30:00Z' }, res) === null);

// ── CONFIGURACIÓN ────────────────────────────────────────────────────────────────────────────────────────
t('stake por defecto 10 y canal encendido por defecto', RA.STAKE() === 10 && RA.amfootOn() === true);
t('las dos familias tienen su clave de mercado', RA.MARKET_KEY.TOTAL === 'american_football.totals' && RA.MARKET_KEY.SPREAD === 'american_football.handicap');

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
