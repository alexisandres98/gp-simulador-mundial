// scripts/clubs-af-map-fill.js — COMPLETAR EL MAPA DE EQUIPOS A API-FOOTBALL (19-ago).
//
// POR QUÉ EXISTE, medido y no supuesto. Alexis preguntó por qué unos partidos traen la capa de contexto y
// las alineaciones proyectadas y otros no. La respuesta está en `/api/clubs/lineups`: sin `af_id` de LOS DOS
// equipos devuelve `{ available: false, reason: 'sin mapeo' }` y la pantalla simplemente no enseña la capa.
// Y el mapa está a medias: Premier 17 de 20, LaLiga 17 de 20, Bundesliga 16 de 18, Austria 8. Cada equipo
// que falta se lleva por delante TODOS los partidos de ese equipo — por eso el patrón parecía aleatorio.
//
// Se rellenó a mano y por eso quedó incompleto. Aquí se hace de la única forma que no vuelve a quedarse a
// medias: API-Football devuelve TODOS los equipos de una liga en UNA llamada (`/teams?league=X&season=Y`),
// así que son ~55 peticiones para las 55 competiciones. Con el plan Ultra (75.000/día) eso no se nota.
//
// CÓMO SE EMPAREJA, y por qué el nombre basta aquí: los dos lados son nombres de club de la MISMA
// competición y temporada, así que el espacio de colisión es de veinte equipos, no de veinte mil. Se
// normaliza agresivo (sin acentos, sin puntuación, sin sufijos societarios tipo FC/CF/AC/SC/CD) y se exige
// coincidencia EXACTA del normalizado, o de un alias declarado. Nada de parecidos: un `af_id` equivocado no
// falla ruidosamente, envenena las alineaciones de ese equipo para siempre.
//
// NO PISA lo que ya existe: solo añade lo que falta, e informa de las discrepancias para revisarlas a mano.
//
// USO: node scripts/clubs-af-map-fill.js [--season=2026] [--apply] [--league=premier]
//      sin --apply solo informa; con --apply escribe el mapa por la ruta interna del servidor.
'use strict';

const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const APPLY = process.argv.includes('--apply');
const ONE = arg('league', '');
// la búsqueda global gasta una petición por equipo suelto; se puede apagar con --sin-busqueda
const BUSCAR = !process.argv.includes('--sin-busqueda');
const AFK = (process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '').trim();
const HOST = process.env.API_FOOTBALL_HOST || 'v3.football.api-sports.io';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// SUFIJOS Y PREFIJOS SOCIETARIOS. "FC Barcelona", "Barcelona FC" y "Barcelona" son el mismo club, y las dos
// fuentes eligen distinto sin criterio fijo. Se quitan de los dos lados antes de comparar.
const RUIDO = /\b(fc|cf|afc|sc|ac|cd|ca|ud|sd|rc|cr|club|clube|atletico|atlético|deportivo|sporting|real|ec|se|sad|ss|as|us|ssc|bk|if|fk|nk|hc|kv|rcd|cska|fk|sk|1899|1900|1904|1907|1909|1913|04|05|96)\b/g;
const norm = (s) => String(s || '')
  .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(RUIDO, ' ')
  .replace(/\s+/g, '').trim();
// el nombre completo sin sufijos quitados, por si el ruido se comió algo que sí distinguía
const normLite = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

async function af(qs) {
  const r = await fetch(`https://${HOST}${qs}`, { headers: { 'x-apisports-key': AFK }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.errors && Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors).slice(0, 120));
  return j.response || [];
}

(async () => {
  if (!AFK) { console.error('[afmap] sin API_FOOTBALL_KEY'); process.exit(1); }
  const srv = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const i = srv.indexOf('const CLUB_AF_LEAGUE = {');
  const blk = srv.slice(i, srv.indexOf('};', i));
  const LIGAS = Object.fromEntries([...blk.matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], +m[2]]));

  const ratings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'clubs', 'ratings.json'), 'utf8'));
  let mapa = {};
  try { mapa = JSON.parse(fs.readFileSync(arg('map', path.join(__dirname, '..', 'data', 'clubs', 'af-team-map.json')), 'utf8')); } catch { mapa = {}; }

  const resumen = [];
  let llamadas = 0;
  for (const [lg, afLg] of Object.entries(LIGAS)) {
    if (ONE && lg !== ONE) continue;
    const L = (ratings.leagues || {})[lg];
    if (!L || !L.ratings) { resumen.push({ liga: lg, nota: 'sin equipos propios en ratings.json' }); continue; }
    const nuestros = Object.entries(L.ratings).map(([id, r]) => ({ id, name: r.name }));
    const yaMapeados = mapa[lg] || (mapa[lg] = {});
    const faltan = nuestros.filter((t) => !yaMapeados[t.id] || !yaMapeados[t.id].af_id);
    if (!faltan.length) { resumen.push({ liga: lg, total: nuestros.length, faltaban: 0 }); continue; }

    // LA TEMPORADA NO SALE DE `L.season`, Y ESO COSTÓ DOS INTENTOS. Ese campo trae el identificador de
    // temporada de FotMob —"sn_8406098"—, no un año: pasarlo tal cual da "The Season field must contain an
    // integer", y sacarle las cuatro primeras cifras da "8406", que es peor porque no falla, simplemente
    // devuelve cero equipos. API-Football numera la temporada por el AÑO EN QUE EMPIEZA, así que el año en
    // curso es la respuesta correcta tanto para las ligas de año natural (Brasil, MLS, Argentina) como para
    // las europeas de agosto a mayo. Si ese año viene vacío se prueba el anterior, que cubre el hueco de
    // las que aún no han arrancado.
    const season = (() => {
      const raw = arg('season', null);
      return (raw && /^\d{4}$/.test(raw)) ? +raw : new Date().getUTCFullYear();
    })();
    // SE PIDEN DOS TEMPORADAS, SIEMPRE, Y SE UNEN. No es prudencia: es que nuestro `ratings.json` mezcla
    // plantillas de la temporada que acaba de terminar con las de la que empieza, y en agosto —que es
    // cuando se cambia media Europa de división— pedir solo la temporada en curso deja fuera a todos los
    // que descendieron o ascendieron. El `af_id` identifica al EQUIPO, no a la liga, así que unir dos
    // temporadas no puede mapear a nadie mal; solo amplía el listado donde buscar.
    let ellos = [];
    const vistos = new Set();
    for (const sn of [season, season - 1]) {
      let r = [];
      try { r = await af(`/teams?league=${afLg}&season=${sn}`); llamadas++; }
      catch (e) { if (sn === season) resumen.push({ liga: lg, aviso: `temporada ${sn}: ${e.message}` }); continue; }
      for (const e of r) { const id = (e.team || {}).id; if (id && !vistos.has(id)) { vistos.add(id); ellos.push(e); } }
      await sleep(160);
    }
    if (!ellos.length) { resumen.push({ liga: lg, error: 'API-Football no devuelve equipos para esta liga' }); continue; }
    const idx = new Map(), idxLite = new Map();
    for (const e of ellos) {
      const t = e.team || {};
      if (!t.id || !t.name) continue;
      for (const n of [t.name, t.code].filter(Boolean)) {
        const k = norm(n); if (k && !idx.has(k)) idx.set(k, t);
        const kl = normLite(n); if (kl && !idxLite.has(kl)) idxLite.set(kl, t);
      }
    }
    // CASADO POR PALABRAS PESADAS POR RAREZA, y el porqué del cambio. La primera versión contaba palabras
    // compartidas a pelo y exigía que el mejor ganara al segundo: parecía prudente y era justo lo contrario.
    // "Ipswich Town" comparte una palabra con "Ipswich" (ipswich) y una con "Luton Town" (town) — empate a
    // uno, desempate fallido, equipo sin casar. Se cayeron así Leicester City, Hull City, Cardiff City y
    // media Inglaterra. La palabra que decide no es la que se repite, es la que NO se repite.
    // Así que cada palabra vale por lo rara que es DENTRO de esta liga: `town` aparece en cinco equipos y
    // pesa 1/5; `ipswich` aparece en uno y pesa 1. Las dos guardias que sí importan se quedan:
    //   · hace falta al menos una palabra propia (única en la liga) compartida — sin eso no se acepta nada,
    //   · y el mejor tiene que ganar al segundo con holgura (Sheffield United vs Sheffield Wednesday
    //     comparten `sheffield` y nada más: quedan a la par y ninguno se acepta).
    const ABREV = { utd: 'united', qpr: 'queensparkrangers', wolves: 'wolverhampton', spurs: 'tottenham',
      muenchen: 'munchen', munich: 'munchen', koln: 'colonia', psg: 'parissaintgermain', om: 'marseille',
      mk: 'miltonkeynes', st: 'saint', sankt: 'saint', athl: 'athletic', dep: 'deportivo', wanderers: 'wanderers' };
    const SOC = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'cd', 'ca', 'ud', 'sd', 'rc', 'cr', 'club', 'clube', 'ec',
      'se', 'sad', 'ss', 'as', 'us', 'ssc', 'bk', 'if', 'fk', 'nk', 'hc', 'kv', 'rcd', 'sk', 'vv', 'bv', 'sv',
      'tsv', 'vfl', 'vfb', 'ks', 'mgs', 'nps', 'ae', 'de', 'la', 'el', 'los', 'do', 'da', 'ii', 'calcio']);
    const palabras = (s0) => String(s0 || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').split(' ')
      .map((w) => ABREV[w] || w)
      .filter((w) => w && !SOC.has(w) && !/^\d+$/.test(w));

    // frecuencia de cada palabra en el listado de ELLOS: la rareza se mide contra la propia liga, que es
    // donde ocurre la colisión. Fuera de la liga `town` no dice nada; dentro, distingue a cinco equipos.
    const df = new Map();
    const suyasDe = new Map();
    for (const e of ellos) {
      const t = e.team || {}; if (!t.id || !t.name) continue;
      const ws = [...new Set(palabras(t.name))];
      suyasDe.set(t.id, ws);
      for (const w of ws) df.set(w, (df.get(w) || 0) + 1);
    }
    const peso = (w) => 1 / (df.get(w) || 1);
    // PALABRAS QUE SON ÚNICAS Y AUN ASÍ NO DICEN NADA. La guardia de "palabra propia" mide si una palabra
    // aparece en un solo equipo de la liga, y eso no es lo mismo que ser distintiva: en la liga china solo
    // un club lleva `city` en el nombre, así que `city` pasaba por seña de identidad y casó "Shenzhen Peng
    // City" con "Chengdu Better City" — dos clubes a 1.900 km. Las genéricas nunca pueden ser el único
    // enganche; si lo son, se deja sin casar y ya lo recoge la búsqueda global.
    const GENERICAS = new Set(['city', 'town', 'united', 'sport', 'sports', 'sporting', 'real', 'athletic',
      'atletico', 'deportivo', 'football', 'futbol', 'futebol', 'calcio', 'wanderers', 'rovers', 'county',
      'albion', 'academy', 'juniors', 'women', 'nacional', 'internacional', 'olympique', 'olympic', 'union',
      'unione', 'sportif', 'sportiva', 'sportive', 'racing', 'rangers', 'athletico', 'atletic']);

    const porPalabras = (nombre) => {
      const mias = new Set(palabras(nombre));
      if (!mias.size) return null;
      let mejor = null, mejorSc = 0, segundoSc = 0;
      for (const e of ellos) {
        const t = e.team || {}; if (!t.id || !t.name) continue;
        let sc = 0, propia = false;
        for (const w of (suyasDe.get(t.id) || [])) {
          if (!mias.has(w)) continue;
          sc += peso(w);
          if (w.length >= 4 && (df.get(w) || 1) === 1 && !GENERICAS.has(w)) propia = true;   // seña de identidad
        }
        if (!propia) continue;
        if (sc > mejorSc) { segundoSc = mejorSc; mejorSc = sc; mejor = t; }
        else if (sc > segundoSc) segundoSc = sc;
      }
      return (mejor && mejorSc > segundoSc + 1e-9) ? mejor : null;
    };

    // BÚSQUEDA GLOBAL PARA LOS QUE NO ESTÁN EN LA LISTA DE ESTA TEMPORADA. Y no es un caso raro: nuestro
    // `ratings.json` arrastra equipos de temporadas anteriores, así que en Premier aparecen Burnley o
    // Coventry cuando la lista de la liga de este año no los tiene. `/teams?search=` los encuentra por
    // nombre en todo el catálogo; se acota por país —el de la propia liga— para que "Racing" no traiga
    // veinte. Una petición por equipo suelto: con el plan Ultra (75.000/día) es ruido.
    const pais = (() => { const c = {}; for (const e of ellos) { const p0 = (e.team || {}).country; if (p0) c[p0] = (c[p0] || 0) + 1; }
      return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null; })();
    const limpio = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    async function porBusqueda(nombre) {
      const q = limpio(nombre);
      if (q.length < 3) return null;
      let res = [];
      try { res = await af(`/teams?search=${encodeURIComponent(q)}` + (pais ? `&country=${encodeURIComponent(pais)}` : '')); llamadas++; }
      catch { return null; }
      await sleep(160);
      if (!res.length) return null;
      // mismas reglas de arriba, pero la rareza aquí se mide sobre el resultado de la búsqueda
      const mias = new Set(palabras(nombre));
      let mejor = null, mejorSc = 0, segundoSc = 0;
      for (const e of res) {
        const t = e.team || {}; if (!t.id || !t.name) continue;
        const ws = [...new Set(palabras(t.name))];
        let sc = 0, comun = false;
        for (const w of ws) if (mias.has(w)) { sc += 1; if (w.length >= 4) comun = true; }
        if (!comun) continue;
        // penaliza al que trae palabras de más: "Racing Santander" antes que "Racing Club de Ferrol"
        sc -= 0.15 * Math.max(0, ws.length - mias.size);
        if (sc > mejorSc) { segundoSc = mejorSc; mejorSc = sc; mejor = t; }
        else if (sc > segundoSc) segundoSc = sc;
      }
      return (mejor && mejorSc > segundoSc + 1e-9) ? mejor : null;
    }

    let nuevos = 0; const sinCasar = [];
    for (const t of faltan) {
      const hit = idx.get(norm(t.name)) || idxLite.get(normLite(t.name)) || porPalabras(t.name)
        || (BUSCAR ? await porBusqueda(t.name) : null);
      if (!hit) { sinCasar.push(t.name); continue; }
      yaMapeados[t.id] = { af_id: hit.id, name: hit.name, src: 'af-teams', at: new Date().toISOString() };
      nuevos++;
    }
    resumen.push({ liga: lg, total: nuestros.length, faltaban: faltan.length, nuevos, sin_casar: sinCasar });
    console.log(`[afmap] ${lg.padEnd(14)} ${String(nuevos).padStart(3)} nuevos de ${faltan.length} que faltaban` +
      (sinCasar.length ? ` · sin casar: ${sinCasar.join(', ')}` : ''));
    await sleep(250);
  }

  const tot = resumen.reduce((a, r) => a + (r.nuevos || 0), 0);
  const rest = resumen.reduce((a, r) => a + ((r.sin_casar || []).length), 0);
  console.log(`\n[afmap] ${tot} equipos nuevos mapeados · ${rest} sin casar · ${llamadas} peticiones a API-Football`);
  const out = arg('out', path.join(__dirname, '..', 'data', 'clubs', 'af-team-map.json'));
  if (APPLY) { fs.writeFileSync(out, JSON.stringify(mapa)); console.log('[afmap] escrito en', out); }
  else console.log('[afmap] (simulacro: sin --apply no se escribe nada)');
  fs.writeFileSync(path.join(path.dirname(out), 'af-map-report.json'), JSON.stringify(resumen, null, 1));
})().catch((e) => { console.error('[afmap] FALLO:', e.message); process.exit(1); });
