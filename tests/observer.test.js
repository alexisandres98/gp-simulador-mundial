// tests/observer.test.js — capa de observación (shadow): extracción de señales, evaluación y factor λ.
'use strict';
const { extract, playerMatches } = require('../observer/extract');
const { assessPlayers, suggestTeamFactor } = require('../observer/assess');
const { parseItems, teamQueries } = require('../observer/sources');
const { fitPlayers } = require('../prop-engine/players');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

const ROSTER = [{ pid: 'p1', name: 'Lamine Yamal' }, { pid: 'p2', name: 'Kylian Mbappé' }, { pid: 'p3', name: 'Erling Haaland' }];
const now = Date.now();
const item = (title, hoursAgo) => ({ title, description: '', source: 'Test', link: null, published_at: new Date(now - (hoursAgo || 1) * 3600e3).toISOString() });

console.log('== extract ==');
const s1 = extract(item('Lamine Yamal ruled out of the quarter final with illness'), { team: 'ESP', roster: ROSTER });
t('OUT detectado y mapeado a Yamal', s1.length === 1 && s1[0].category === 'OUT' && s1[0].pid === 'p1');
const s2 = extract(item('Mbappé a doubt for France after picking up a knock in training'), { team: 'FRA', roster: ROSTER });
t('DOUBT detectado (acentos normalizados)', s2.length === 1 && s2[0].category === 'DOUBT' && s2[0].pid === 'p2');
const s3 = extract(item('Haaland vuelve a entrenar con normalidad y llega al partido'), { team: 'NOR', roster: ROSTER });
t('BACK en español', s3.length === 1 && s3[0].category === 'BACK' && s3[0].pid === 'p3');
const s4 = extract(item('Three players down with fever ahead of the clash'), { team: 'ESP', roster: ROSTER });
t('señal a nivel equipo sin jugador (severidad reducida)', s4.length === 1 && s4[0].pid === null && s4[0].severity < 0.5);
t('titular sin keywords → sin señal', extract(item('Spain arrives in Dallas for the derby'), { team: 'ESP', roster: ROSTER }).length === 0);
t('playerMatches por apellido', playerMatches('Un golazo de Yamal en el entrenamiento', ROSTER).some(p => p.pid === 'p1'));
const s5 = extract(item('Cambio de planes: Yamal no sera sancionado y podra jugar los octavos'), { team: 'ESP', roster: ROSTER });
t('desenlace positivo gana sobre keyword negativa (no sera sancionado → BACK)', s5.length === 1 && s5[0].category === 'BACK');
const s6 = extract(item('Yamal declared fit after injury scare'), { team: 'ESP', roster: ROSTER });
t('declared fit tras susto → BACK', s6.length === 1 && s6[0].category === 'BACK');

console.log('== precisión (falsos positivos reales del 8-jul) ==');
t('"sancionado el penal" (contexto arbitral) NO es SUSPENDED',
  extract(item('La lupa sobre el penal que fallo Yamal: por que estuvo bien sancionado por el arbitro'), { team: 'ESP', roster: ROSTER })
    .every(s => s.category !== 'SUSPENDED'));
t('"sancionado con dos partidos" SÍ es SUSPENDED',
  extract(item('Yamal sancionado con dos partidos por la falta'), { team: 'ESP', roster: ROSTER })
    .some(s => s.category === 'SUSPENDED'));
t('"sin duda es uno de mis juegos favoritos" NO genera señal',
  extract(item('Yamal se rindio ante el rival: sin duda es uno de mis juegos favoritos'), { team: 'ESP', roster: ROSTER }).length === 0);
t('"knock Portugal out" (eliminación) NO es DOUBT',
  extract(item('Yamal strikes late to knock Portugal out of the World Cup'), { team: 'ESP', roster: ROSTER }).length === 0);
t('"golpe para el equipo" (metáfora) NO genera señal',
  extract(item('Golpe para España: el rival llega entonado'), { team: 'ESP', roster: ROSTER }).length === 0);
t('"golpe en el tobillo" SÍ es DOUBT',
  extract(item('Yamal recibio un golpe en el tobillo y es duda'), { team: 'ESP', roster: ROSTER }).some(s => s.category === 'DOUBT'));
const sq = extract(item('¿Haaland no jugara contra Inglaterra? Reportan jugadores enfermos - tribuna'), { team: 'NOR', roster: ROSTER });
t('titular interrogativo degrada OUT → DOUBT', sq.length >= 1 && sq[0].category === 'DOUBT');

console.log('== assess ==');
const A1 = assessPlayers([...s1, ...s2], { now });
t('OUT con UNA sola fuente → severidad capeada a nivel DUDA (corroborated:false)', A1.p1 && A1.p1.status === 'OUT' && A1.p1.corroborated === false && A1.p1.prob_miss <= 0.45);
t('Mbappé DOUBT con prob_miss media', A1.p2 && A1.p2.status === 'DOUBT' && A1.p2.prob_miss > 0.2 && A1.p2.prob_miss < 0.6);
// corroboración: el mismo OUT desde DOS fuentes independientes recupera la severidad completa
const twoSrc = [
  ...extract({ title: 'Lamine Yamal ruled out of the quarter final', description: '', source: 'Marca', published_at: new Date(now - 3600e3).toISOString() }, { team: 'ESP', roster: ROSTER }),
  ...extract({ title: 'Yamal will miss the quarter final, coach confirms', description: '', source: 'BBC', published_at: new Date(now - 2 * 3600e3).toISOString() }, { team: 'ESP', roster: ROSTER }),
];
const A1b = assessPlayers(twoSrc, { now });
t('OUT con DOS fuentes independientes → corroborado y prob_miss alta', A1b.p1 && A1b.p1.status === 'OUT' && A1b.p1.corroborated === true && A1b.p1.prob_miss >= 0.7);
const A2 = assessPlayers([
  ...extract(item('Mbappé a doubt for France with a knock', 30), { team: 'FRA', roster: ROSTER }),
  ...extract(item('Mbappé declared fit to play and will start', 2), { team: 'FRA', roster: ROSTER }),
], { now });
t('BACK más reciente limpia la duda anterior', A2.p2 && A2.p2.status === 'OK' && A2.p2.prob_miss === 0);
const old = assessPlayers(extract(item('Mbappé a doubt for France', 200), { team: 'FRA', roster: ROSTER }), { now });
t('señal vieja (200h) decae a casi nada', !old.p2 || old.p2.prob_miss < 0.05 || old.p2.status === 'OK');

console.log('== suggestTeamFactor (con dataset real) ==');
try {
  const hist = require('../data/player-props-history.json');
  const F = fitPlayers(hist.matches);
  const mbappe = Object.values(F.players).find(p => /Mbapp/i.test(p.name) && p.team === 'FRA');
  const sig = extract(item('Kylian Mbappé ruled out of the quarter final'), { team: 'FRA', roster: [{ pid: mbappe.pid, name: mbappe.name }] });
  const asmts = assessPlayers(sig, { now });
  const sug = suggestTeamFactor(F, 'FRA', asmts);
  t('factor sugerido < 1 si Mbappé OUT', sug.factor < 1);
  t('detalle incluye a Mbappé con factor_if_out', sug.detail.some(d => d.pid === mbappe.pid && d.factor_if_out < 1));
  const none = suggestTeamFactor(F, 'FRA', {});
  t('sin señales → factor 1', none.factor === 1 && none.detail.length === 0);
} catch (e) { t('suggestTeamFactor con dataset real (' + e.message + ')', false); }

console.log('== sources (parser RSS, sin red) ==');
const xml = '<rss><channel><item><title>Spain star ruled out</title><link>http://x</link><pubDate>Mon, 06 Jul 2026 10:00:00 GMT</pubDate><source url="http://y">Marca</source><description><![CDATA[<a href="#">Spain star ruled out</a>&nbsp;full story]]></description></item></channel></rss>';
const parsed = parseItems(xml);
t('parser RSS extrae título/fuente/fecha', parsed.length === 1 && parsed[0].title === 'Spain star ruled out' && parsed[0].source === 'Marca' && parsed[0].published_at);
t('CDATA y tags limpiados en description', !/[<>]/.test(parsed[0].description));
t('teamQueries devuelve EN y ES', teamQueries('Spain', 'España').map(q => q.lang).join(',') === 'en,es');

console.log(`\n[observer] ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
