// scripts/esports-pandascore-harvest.js — LA BASE HISTÓRICA DE LOS TRES QUE NO LA TENÍAN (19-ago).
//
// QUÉ COSECHA Y POR QUÉ. Esports declara `rating: 0` en sus cuatro juegos desde que existe. CS2 salió de
// ahí con cosecha propia (48.678 mapas de bo3.gg); LoL, Valorant y Dota 2 llevan meses esperando a
// OpenDota, a Riot y a Liquipedia. PandaScore los cubre a los tres con una sola forma: quién ganó a quién,
// cuándo, en qué competición, con qué marcador de serie, y la DURACIÓN de cada mapa.
//
// Eso no es "más datos": es exactamente el mínimo que un rating necesita. Y la duración por mapa es, en
// Dota 2, la familia sobre la que su motor está construido y de la que no tenía ni una observación propia.
//
// LO QUE NO TRAE, y hay que tenerlo presente al usarlo: en el plan libre NO hay rondas de CS2, ni kills de
// LoL, ni qué mapa se jugó. Los endpoints de detalle devuelven 403. La liquidación de picks sigue viniendo
// de donde venía; esto es base histórica, no liquidador.
//
// EL LIMITADOR MANDA. 1.000 peticiones por hora, 100 filas por página. El barrido completo son ~470 páginas
// de LoL + 384 de Dota 2 + 180 de Valorant ≈ 1.034: dos ventanas de una hora. Así que esto es REANUDABLE
// por diseño — cursor por juego en disco, siempre hacia delante— y se detiene solo cuando la cabecera
// `x-rate-limit-remaining` baja del margen. Un barrido que muere a mitad y hay que reiniciar desde 2016
// nunca termina.
//
// DÓNDE ESCRIBE: disco persistente, al lado de db.json, con el mismo criterio que el resto de la casa. El
// directorio del repo se recrea en cada despliegue de Render — hoy mismo se ha visto lo que cuesta
// olvidarlo (las plantillas de College desaparecían con cada deploy).
//
// USO: node scripts/esports-pandascore-harvest.js [--game=lol|valorant|dota2|cs2|all] [--from=2016-01-01]
//                                                 [--budget=900] [--reset]
'use strict';

const fs = require('fs');
const path = require('path');
const PS = require('../data-providers/esports/pandascore');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const GAMES = arg('game', 'all') === 'all' ? ['lol', 'dota2', 'valorant', 'cs2'] : arg('game', 'all').split(',');
const FROM0 = arg('from', '2016-01-01') + 'T00:00:00Z';
// margen: se para con 60 peticiones en el bolsillo, para no dejar sin cuota a la sonda ni al barrido diario
const BUDGET = +arg('budget', 900);
const RESET = process.argv.includes('--reset');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DISKROOT = path.dirname(process.env.DB_FILE || '');
const DIR = (DISKROOT && fs.existsSync(DISKROOT)) ? path.join(DISKROOT, 'esports', 'pandascore')
  : (fs.existsSync('/data') ? '/data/esports/pandascore' : path.join(__dirname, '..', 'data', 'esports', 'pandascore'));

const file = (n) => path.join(DIR, n);
const rd = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const wr = (n, o) => {
  fs.mkdirSync(DIR, { recursive: true });
  const t = file(n) + '.tmp';
  fs.writeFileSync(t, JSON.stringify(o));
  fs.renameSync(t, file(n));
};

// ── EL ESTADO, QUE ES LO QUE HACE ESTO REANUDABLE ────────────────────────────────────────────────────────
// `cursor` es la fecha del último partido guardado. La siguiente pasada arranca ahí, no en 2016.
// `ids` evita duplicar cuando el cursor cae dentro de un empate de fechas (varios partidos al mismo minuto).
function loadGame(game) {
  if (RESET) return { game, cursor: FROM0, matches: [], ids: [] };
  const st = rd(`${game}.json`, null);
  if (!st || !Array.isArray(st.matches)) return { game, cursor: FROM0, matches: [], ids: [] };
  st.ids = st.ids || st.matches.map((m) => m.provider_id);
  return st;
}

async function harvest(game, budget) {
  const st = loadGame(game);
  const seen = new Set(st.ids);
  let gastadas = 0, nuevas = 0, restante = null;
  console.log(`[ps:${game}] arranco en ${st.cursor} · ya tengo ${st.matches.length} partidos`);

  while (gastadas < budget) {
    let r;
    try {
      r = await PS.finishedMatches(game, { from: st.cursor, perPage: 100, page: 1 });
    } catch (e) {
      console.log(`[ps:${game}] fallo: ${e.message}`);
      break;
    }
    gastadas++;
    restante = r.remaining;
    if (!r.raw) { console.log(`[ps:${game}] la fuente no devuelve más desde ${st.cursor}: al día`); st.complete = true; break; }

    let avance = null, añadidas = 0;
    for (const m of r.rows) {
      if (!m.at) continue;                       // sin fecha no sirve ni para el cursor ni para un rating
      if (!seen.has(m.provider_id)) { seen.add(m.provider_id); st.matches.push(m); añadidas++; nuevas++; }
      if (!avance || m.at > avance) avance = m.at;
    }

    // ANTIBUCLE: si la página entera cae dentro del cursor y no aporta nada nuevo, hay que empujar la fecha
    // a mano o se pide la misma página para siempre. Un segundo basta: las fechas vienen al segundo.
    if (!añadidas && (!avance || avance <= st.cursor)) {
      st.cursor = new Date(Date.parse(st.cursor) + 1000).toISOString();
    } else {
      st.cursor = avance;
    }

    if (gastadas % 10 === 0 || añadidas === 0) {
      wr(`${game}.json`, { ...st, ids: [...seen], at: new Date().toISOString() });
      console.log(`[ps:${game}] ${st.matches.length} partidos · cursor ${st.cursor.slice(0, 10)} · ${gastadas} peticiones · cuota ${restante}`);
    }
    // el limitador es por HORA: si queda poco, se para limpio y se guarda. Reanudar es gratis.
    if (restante != null && restante < 60) { console.log(`[ps:${game}] cuota casi agotada (${restante}): paro y guardo`); break; }
    await sleep(250);
  }

  st.ids = [...seen];
  st.at = new Date().toISOString();
  wr(`${game}.json`, st);
  const conDur = st.matches.reduce((n, m) => n + m.maps.filter((x) => x.minutes != null).length, 0);
  const mapas = st.matches.reduce((n, m) => n + m.maps.length, 0);
  console.log(`[ps:${game}] LISTO · ${st.matches.length} partidos (${nuevas} nuevos) · ${mapas} mapas · ${conDur} con duración · cursor ${st.cursor} · ${gastadas} peticiones`);
  return { game, total: st.matches.length, nuevas, mapas, con_duracion: conDur, cursor: st.cursor, gastadas, restante, complete: !!st.complete };
}

(async () => {
  if (!PS.enabled()) { console.error('[ps] sin PANDASCORE_TOKEN: no hay nada que cosechar'); process.exit(1); }
  console.log('[ps] destino:', DIR);
  const resumen = [];
  let presupuesto = BUDGET;
  for (const g of GAMES) {
    if (presupuesto <= 0) { console.log('[ps] sin presupuesto para', g, '— queda para la siguiente pasada'); break; }
    const r = await harvest(g, presupuesto);
    presupuesto -= r.gastadas;
    resumen.push(r);
    if (r.restante != null && r.restante < 60) break;
  }
  wr('state.json', { at: new Date().toISOString(), resumen });
  console.log('[ps] resumen:', JSON.stringify(resumen));
})().catch((e) => { console.error('[ps] FALLO:', e.message); process.exit(1); });
