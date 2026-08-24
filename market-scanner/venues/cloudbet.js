// market-scanner/venues/cloudbet.js — COLLECTOR de Cloudbet (crypto sportsbook con API pública oficial).
// Cloudbet Feed API (https://sports-api.cloudbet.com), auth header X-API-Key (key gratis del perfil). Es UNA
// CASA MÁS: normalizamos su fútbol a nuestro shape (1X2 + totals) y el sweep del server escribe las cuotas a
// sportsbook_goal_quote_current con sportsbook_code='cloudbet' y el MISMO canonical_event_id → value/arbitraje/
// picks/best-odds la ven sin tocar nada.
// FLUJO REAL (verificado 18-jul contra la API): (1) /pub/v2/odds/sports/soccer → competiciones; (2) por liga
// /pub/v2/odds/competitions/{key}?from&to → eventos-partido (el listado NO trae mercados); (3) por partido
// /pub/v2/odds/events/{id} → mercados. total_goals: params 'total=2.5' vive en CADA selection.
// PURO en red (sin DB). Fallback graceful TOTAL: sin key o ante cualquier fallo devuelve [] y NUNCA rompe.
'use strict';

const HOST = process.env.CLOUDBET_API_HOST || 'https://sports-api.cloudbet.com';
// Ligas que nos importan, por KEY EXACTO (los keys de las grandes son estables; Liga MX lleva hash → 'liga-mx').
// Matchear por key evita capturar homónimos ("Queensland Premier League 2"). Ampliable por env
// CLOUDBET_COMPETITIONS (regex extra, coma-separado).
const KEY_INCLUDE = [
  /^soccer-international(-fifa)?-world-cup$/, /^soccer-brazil-brasileiro-serie-a$/, /^soccer-usa-major-league-soccer$/,
  /liga-mx-apertura$/, /^soccer-mexico-.*liga-mx$/, /^soccer-south-korea-k-league-1$/, /^soccer-england-premier-league$/,
  /^soccer-spain-laliga$/, /^soccer-germany-bundesliga$/, /^soccer-italy-serie-a$/, /^soccer-france-ligue-1$/,
  /^soccer-argentina-(primera-division|liga-profesional)/, /^soccer-colombia-primera-a$/, /^soccer-japan-j1-league$/,
  /^soccer-china-super-league$/,
  // 20-ago: las ligas donde de verdad viven nuestras señales y que la lista no nombraba. Championship es la
  // ÚNICA de las nuestras donde Cloudbet cotiza tarjetas Y córners (comprobado partido a partido), y las
  // sudamericanas de copa son las que sí traen tarjetas. Estar fuera de esta lista no las excluía —entra
  // todo el fútbol real— pero las dejaba al final de la cola, que con un cupo de 200 es lo mismo.
  /^soccer-england-championship$/, /^soccer-brazil-brasileiro-serie-b$/,
  /^soccer-argentina-primera-nacional$/, /^soccer-denmark-superliga$/,
  /^soccer-international-clubs-copa-(libertadores|sudamericana)$/,
  /^soccer-portugal-primeira-liga$/, /^soccer-netherlands-eredivisie$/,
];
const LEAGUE_EXCLUDE = /u1[6789]|u2[0-3]|women|-srl|simulated|reserve|next-pro|regional|youth|amateur|esoccer|cyber/i;
// 14-ago (cobertura total + independencia de The Odds API): la lista blanca de 15 ligas era el cuello de
// botella — cubrimos 55 competiciones y Cloudbet es hoy la fuente PRINCIPAL de cuotas (1X2/goles/córners/
// tarjetas). Ahora entra TODO el fútbol real de su catálogo salvo lo excluido (femenino/juvenil/simulado);
// KEY_INCLUDE queda como PRIORIDAD (se procesan primero cuando el tope de eventos aprieta).
// CLOUDBET_STRICT_LEAGUES=true restaura el comportamiento viejo.
function wantedLeague(key) {
  if (!key || LEAGUE_EXCLUDE.test(key)) return false;
  if (KEY_INCLUDE.some(re => re.test(key))) return true;
  const extra = String(process.env.CLOUDBET_COMPETITIONS || '').trim();
  if (extra && extra.split(',').some(p => { try { return new RegExp(p.trim()).test(key); } catch { return false; } })) return true;
  return !/^(1|true|yes|on)$/i.test(String(process.env.CLOUDBET_STRICT_LEAGUES || '').trim());
}
const isPriority = (key) => KEY_INCLUDE.some(re => re.test(key));

let _cache = { at: 0, data: [] };
// tamaño de lote y pausa entre lotes: ajustables por env sin desplegar, porque el límite de tasa de una casa
// no es una constante del universo y se descubre midiendo
const LOTE = Number(process.env.CLOUDBET_BATCH) || 3;
const PAUSA = Number(process.env.CLOUDBET_PAUSE_MS) || 250;

async function cbGet(path, apiKey, timeoutMs) {
  const ctrl = AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined;
  const r = await fetch(`${HOST}${path}`, ctrl ? { headers: { 'X-API-Key': apiKey, accept: 'application/json' }, signal: ctrl } : { headers: { 'X-API-Key': apiKey, accept: 'application/json' } });
  if (!r.ok) throw new Error('http_' + r.status);
  return r.json();
}

// competiciones de fútbol que nos importan → [{ key, name }]
async function soccerCompetitions(apiKey, timeoutMs) {
  const j = await cbGet('/pub/v2/odds/sports/soccer', apiKey, timeoutMs);
  const out = [];
  for (const cat of (j.categories || [])) {
    for (const c of (cat.competitions || [])) {
      if ((c.eventCount || 0) > 0 && wantedLeague(c.key || '')) out.push({ key: c.key, name: c.name || '' });
    }
  }
  return out;
}

// PROFUNDIDAD (15-ago): Cloudbet publica `maxStake` por SELECCIÓN — el tope real que acepta a ese precio.
// Es el dato que faltaba para dimensionar: sin él una señal de $50 y una de $5.000 se veían iguales.
// Se devuelve junto al precio, no en lugar de él, para no tocar a ningún consumidor existente.
const bestSel = (sels, pred) => {
  let b = null;
  for (const s of (sels || [])) {
    if (!pred(s)) continue;
    const p = Number(s.price);
    if (p > 1 && (b == null || p > b.o)) b = { o: p, max: Number(s.maxStake) > 0 ? Number(s.maxStake) : null };
  }
  return b;
};
const bestPrice = (sels, pred) => { const b = bestSel(sels, pred); return b ? b.o : null; };

// evento individual (con mercados) → { home, away, kickoff, markets:{h2h, totals[]} } | null
function normalizeEvent(e) {
  const home = e.home && e.home.name, away = e.away && e.away.name;
  if (!home || !away || e.type !== 'EVENT_TYPE_EVENT') return null;
  const M = e.markets || {}, out = { home, away, kickoff: e.cutoffTime || null,
    // EL ID DE LA CASA, que hasta hoy se tiraba. Sin él se puede leer un precio pero no colocar una apuesta:
    // el id del evento es el primer campo que pide la API de colocación. Lo mismo con `marketUrl`, que la
    // casa publica en CADA selección — no hay que construirlo ni adivinar su formato, hay que no perderlo.
    cb_id: e.id || null,
    markets: { h2h: null, totals: [], dc: null, dnb: null, btts: null, ah: [], team_totals: [] } };
  const mo = M['soccer.match_odds'];
  if (mo && mo.submarkets) {
    const sm = mo.submarkets['period=ft'] || Object.values(mo.submarkets)[0] || {};
    const h = bestSel(sm.selections, s => s.outcome === 'home'), d = bestSel(sm.selections, s => s.outcome === 'draw'), a = bestSel(sm.selections, s => s.outcome === 'away');
    if (h && a && h.o > 1 && a.o > 1) out.markets.h2h = { home: h.o, draw: (d && d.o) || null, away: a.o,
      max: { home: h.max, draw: d ? d.max : null, away: a.max } };
  }
  // parser común de mercados over/under por línea (goles, córners, tarjetas — mismo shape de Cloudbet)
  const parseTotals = (mk) => {
    if (!mk || !mk.submarkets) return [];
    const sm = mk.submarkets['period=ft'] || Object.values(mk.submarkets)[0] || {};
    const byLine = {};
    for (const s of (sm.selections || [])) {
      const line = Number(String(s.params || '').match(/total=([\d.]+)/)?.[1]);
      const p = Number(s.price);
      if (!(line > 0) || !(p > 1)) continue;
      (byLine[line] = byLine[line] || {})[s.outcome] = { o: p, max: Number(s.maxStake) > 0 ? Number(s.maxStake) : null,
        url: s.marketUrl || null, min: Number(s.minStake) > 0 ? Number(s.minStake) : null, st: s.status || null };
    }
    const rows = [];
    for (const line of Object.keys(byLine)) {
      const o = byLine[line];
      if (o.over && o.under && o.over.o > 1 && o.under.o > 1)
        rows.push({ line: Number(line), over: o.over.o, under: o.under.o, max: { over: o.over.max, under: o.under.max },
          // las coordenadas de colocación, por lado. Viajan al lado del precio y no en lugar de él: ningún
          // consumidor existente las mira, y el ejecutor real no puede funcionar sin ellas.
          url: { over: o.over.url, under: o.under.url },
          min: { over: o.over.min, under: o.under.min },
          st: { over: o.over.st, under: o.under.st } });
    }
    return rows;
  };
  out.markets.totals = parseTotals(M['soccer.total_goals']);
  // 13-ago (ejecutor en la sombra a precio EJECUTABLE): córners y tarjetas de Cloudbet — son los mercados
  // donde vive el segmento en verificación (cards-under). Claves ausentes → arrays vacíos, cero ruido.
  out.markets.corners = parseTotals(M['soccer.total_corners']);
  out.markets.cards = parseTotals(M['soccer.total_bookings'] || M['soccer.total_cards']);

  // ── FAMILIAS QUE LA CASA YA COTIZABA Y NO LEÍAMOS (20-ago) ──────────────────────────────────────────────
  // Medido: en los partidos que el colector descartaba, Cloudbet cotizaba entre 14 y 25 mercados. Estos
  // cuatro son los que el motor de goles sabe valorar sin medir nada nuevo, porque salen de la misma matriz
  // de marcador. Los de MITADES quedan fuera a propósito: repartir el gol entre los dos tiempos es una
  // suposición que GP no ha medido, y una familia sin estructura medida no se apuesta.
  const selsDe = (mk, sub) => {
    const m = M[mk]; if (!m || !m.submarkets) return [];
    const s2 = sub ? m.submarkets[sub] : (m.submarkets['period=ft'] || Object.values(m.submarkets)[0]);
    return (s2 && s2.selections) || [];
  };
  // doble oportunidad: outcomes home_draw / home_away / draw_away
  {
    const sel = selsDe('soccer.double_chance');
    const g = (o) => bestSel(sel, (x) => x.outcome === o);
    const hd = g('home_draw'), ha = g('home_away'), da = g('draw_away');
    if (hd || ha || da) out.markets.dc = { home_draw: hd ? hd.o : null, home_away: ha ? ha.o : null, draw_away: da ? da.o : null,
      max: { home_draw: hd ? hd.max : null, home_away: ha ? ha.max : null, draw_away: da ? da.max : null } };
  }
  // empate no válido: outcomes home / away
  {
    const sel = selsDe('soccer.draw_no_bet');
    const h = bestSel(sel, (x) => x.outcome === 'home'), a = bestSel(sel, (x) => x.outcome === 'away');
    if (h && a) out.markets.dnb = { home: h.o, away: a.o, max: { home: h.max, away: a.max } };
  }
  // ambos marcan: outcomes yes / no
  {
    const sel = selsDe('soccer.both_teams_to_score');
    const y = bestSel(sel, (x) => x.outcome === 'yes'), n = bestSel(sel, (x) => x.outcome === 'no');
    if (y && n) out.markets.btts = { yes: y.o, no: n.o, max: { yes: y.max, no: n.max } };
  }
  // HÁNDICAP ASIÁTICO. La convención se COMPROBÓ contra la casa antes de escribir esto, porque de haberla
  // supuesto se habría invertido cada línea del visitante en silencio: `handicap=X` es la línea del LOCAL y
  // la selección visitante es su espejo (−X). Verificado en un partido con favorito visitante: con
  // handicap=-0.5 el local paga 2,70 y el visitante 1,32; con handicap=+0.5 se invierte a 1,45 y 2,30. Si la
  // línea fuera de cada selección, el visitante favorito con +0,5 tendría que pagar menos, no más.
  {
    const sel = selsDe('soccer.asian_handicap');
    const byLine = {};
    for (const x of sel) {
      const l = Number(String(x.params || '').match(/handicap=(-?[\d.]+)/)?.[1]);
      const p = Number(x.price);
      if (!Number.isFinite(l) || !(p > 1)) continue;
      const k = String(l);
      (byLine[k] = byLine[k] || {})[x.outcome] = { o: p, max: Number(x.maxStake) > 0 ? Number(x.maxStake) : null };
    }
    const rows = [];
    for (const [k, o] of Object.entries(byLine)) {
      if (!o.home || !o.away) continue;
      rows.push({ line: Number(k), home: o.home.o, away: o.away.o, max: { home: o.home.max, away: o.away.max } });
    }
    if (rows.length) out.markets.ah = rows;
  }
  // totales de equipo: submercados `period=ft&team=home|away`, params `team=…&total=…`
  {
    const rows = [];
    for (const equipo of ['home', 'away']) {
      const sel = selsDe('soccer.team_total_goals', 'period=ft&team=' + equipo);
      const byLine = {};
      for (const x of sel) {
        const l = Number(String(x.params || '').match(/total=([\d.]+)/)?.[1]);
        const p = Number(x.price);
        if (!(l > 0) || !(p > 1)) continue;
        (byLine[l] = byLine[l] || {})[x.outcome] = { o: p, max: Number(x.maxStake) > 0 ? Number(x.maxStake) : null };
      }
      for (const [l, o] of Object.entries(byLine)) {
        if (!o.over || !o.under) continue;
        rows.push({ team: equipo, line: Number(l), over: o.over.o, under: o.under.o, max: { over: o.over.max, under: o.under.max } });
      }
    }
    if (rows.length) out.markets.team_totals = rows;
  }

  const hayAlgo = out.markets.h2h || out.markets.totals.length || out.markets.corners.length || out.markets.cards.length
    || out.markets.dc || out.markets.dnb || out.markets.btts || (out.markets.ah || []).length || (out.markets.team_totals || []).length;
  return hayAlgo ? out : null;
}

// fetchCloudbetSoccer() → [ eventos normalizados con precios ]. Sin key → []. Cachea 60s. Nunca lanza.
// maxEvents acota el nº de requests por ciclo (1 por partido). Solo partidos dentro de la ventana horas.
async function fetchCloudbetSoccer({ apiKey = process.env.CLOUDBET_API_KEY, timeoutMs = 9000, ttlMs = 60000, now = Date.now(), windowH = 72, maxEvents = Number(process.env.CLOUDBET_MAX_EVENTS) || 200, stats = null } = {}) {
  if (!apiKey) return [];
  if (_cache.data.length && (now - _cache.at) < ttlMs) return _cache.data;
  const out = [];
  // DIAGNÓSTICO (20-ago). Los dos `catch` mudos de abajo estaban comiéndose el 90 % de la cosecha sin que
  // nadie lo supiera: se leían 19 partidos de más de 200 y desde fuera parecía que Cloudbet no cotizaba
  // nada. Un fallo silencioso en un colector es indistinguible de una casa que no cubre el mercado, y las
  // dos cosas llevan a decisiones opuestas. Ahora se cuentan y se devuelven si el llamante los pide.
  const S = stats || {};
  S.competiciones = 0; S.comp_fallidas = 0; S.ids = 0; S.detalle_ok = 0; S.detalle_fallido = 0;
  S.sin_mercados = 0; S.sin_precios = 0; S.sin_familia_util = 0; S.errores = S.errores || {};
  const anota = (e) => { const k = (e && e.message) || 'desconocido'; S.errores[k] = (S.errores[k] || 0) + 1; };
  try {
    const comps = await soccerCompetitions(apiKey, timeoutMs);
    S.competiciones = comps.length;
    // las prioritarias primero: si el tope de eventos aprieta, las grandes nunca se quedan fuera
    comps.sort((a, b) => (isPriority(b.key) ? 1 : 0) - (isPriority(a.key) ? 1 : 0));
    const fromS = Math.floor(now / 1000), toS = fromS + windowH * 3600;
    const ids = [];
    // se recogen TODOS los identificadores (el listado por competición es una petición barata) y el tope se
    // aplica DESPUÉS de ordenar por hora de inicio. Antes el tope cortaba durante la recogida, así que el
    // orden no era "los que empiezan antes" sino "los primeros de las ligas prioritarias": el presupuesto
    // se gastaba en partidos de dentro de tres días —sin precio— mientras los de esta tarde se quedaban fuera.
    const TECHO_IDS = Number(process.env.CLOUDBET_MAX_IDS) || 1500;
    for (const c of comps) {
      if (ids.length >= TECHO_IDS) break;
      try {
        const j = await cbGet(`/pub/v2/odds/competitions/${encodeURIComponent(c.key)}?limit=60&from=${fromS}&to=${toS}`, apiKey, timeoutMs);
        for (const e of (j.events || [])) {
          if (e.type === 'EVENT_TYPE_EVENT' && e.home && e.away && e.id) { ids.push({ id: e.id, comp: c.key, ko: e.cutoffTime || null }); if (ids.length >= TECHO_IDS) break; }
        }
      } catch (e) { S.comp_fallidas++; anota(e); }   // liga sin cobertura este ciclo — o límite de tasa
    }
    // LO QUE EMPIEZA ANTES, PRIMERO (20-ago). Cloudbet publica el ESQUELETO del mercado días antes con todas
    // las selecciones en SELECTION_DISABLED y precio 0: existe la línea, no existe el precio. Con la ventana
    // en 72-96 h el presupuesto de 200 partidos se lo comían esos esqueletos —181 de 200 en la medición— y
    // los partidos de HOY, que sí tienen precio, se quedaban fuera. No era que la casa no cotizara: era que
    // le preguntábamos demasiado pronto y gastábamos el cupo en preguntarlo.
    // PRIMERO LAS NUESTRAS, Y DENTRO DE ELLAS LAS QUE EMPIEZAN ANTES. Ordenar solo por hora dejaba el cupo
    // en manos del calendario mundial: la primera pasada se lo llevaron la tercera finlandesa y la cuarta
    // islandesa, ligas que no seguimos, mientras Brasil y Championship —donde sí tenemos modelo y equipos
    // resueltos— quedaban fuera. Un colector tiene que gastar su presupuesto donde su casa puede usarlo.
    ids.sort((a, b) => (isPriority(b.comp) ? 1 : 0) - (isPriority(a.comp) ? 1 : 0) || Date.parse(a.ko || 0) - Date.parse(b.ko || 0));
    S.ids_totales = ids.length;
    const cola = ids.slice(0, maxEvents);
    S.ids = cola.length;
    // detalle de cada partido en LOTES paralelos. El lote es de 3 y con pausa: con 6 a pelo Cloudbet
    // devolvía 429 en la mayoría y el colector se quedaba con las migajas, en silencio.
    for (let i = 0; i < cola.length; i += LOTE) {
      const batch = cola.slice(i, i + LOTE);
      const res = await Promise.all(batch.map(({ id, comp }) =>
        cbGet(`/pub/v2/odds/events/${id}`, apiKey, timeoutMs)
          .then(ev => {
            S.detalle_ok++;
            const n = normalizeEvent(ev);
            if (n) { n.competition = comp; return n; }
            // sin fila utilizable: ¿la casa no publica el mercado, o lo publica sin precio todavía?
            const mk = (ev && ev.markets) || {};
            const hayClaves = Object.keys(mk).length > 0;
            const algunPrecio = Object.values(mk).some((m) => Object.values((m && m.submarkets) || {})
              .some((sm) => ((sm && sm.selections) || []).some((x) => Number(x.price) > 1)));
            if (!hayClaves) S.sin_mercados++;
            else if (!algunPrecio) S.sin_precios++;
            else S.sin_familia_util++;
            return null;
          })
          .catch((e) => { S.detalle_fallido++; anota(e); return null; })));
      for (const n of res) if (n) out.push(n);
      if (i + LOTE < cola.length && PAUSA) await new Promise((r) => setTimeout(r, PAUSA));
    }
  } catch (e) { S.listado_error = e.message; return _cache.data; } // fallo en el listado de deportes → último bueno
  S.devueltos = out.length;
  if (out.length) _cache = { at: now, data: out };
  return out.length ? out : _cache.data;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// LA CUENTA: SALDO, COLOCACIÓN Y ESTADO DE UNA APUESTA (25-ago)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════
// Hasta hoy este archivo solo LEÍA. Estas tres funciones son las que tocan dinero de verdad, y por eso van
// aquí abajo, separadas y con sus propias reglas:
//
//   · NINGUNA decide nada. No miran el modelo, no calculan stake, no eligen partido. Reciben coordenadas
//     exactas y las ejecutan. Toda la política vive en `real-executor/`, que es donde se puede auditar.
//   · `referenceId` es la idempotencia. Cloudbet rechaza dos apuestas con la misma referencia, así que
//     derivarla del id de la pick hace IMPOSIBLE colocar la misma apuesta dos veces, pase lo que pase con
//     reintentos, despliegues o un contenedor que se reinicie a mitad.
//   · `acceptPriceChange: 'BETTER'` — si el precio se movió a peor entre que lo leímos y llegamos, la casa
//     rechaza en vez de ejecutar. Preferimos una apuesta perdida a una apuesta a un precio que no elegimos.
//   · El `marketUrl` NUNCA se construye a mano. La casa lo publica en cada selección; se copia tal cual.
//     Construirlo sería inventarse un formato y descubrir el error con dinero encima.

const ACC_HOST = process.env.CLOUDBET_ACCOUNT_HOST || 'https://sports-api.cloudbet.com';

async function cbFetch(path, apiKey, { method = 'GET', body = null, timeoutMs = 15000, host = ACC_HOST } = {}) {
  const opts = {
    method,
    headers: { 'X-API-Key': apiKey, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  if (AbortSignal.timeout) opts.signal = AbortSignal.timeout(timeoutMs);
  const r = await fetch(`${host}${path}`, opts);
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* la casa devolvió algo que no es JSON */ }
  return { ok: r.ok, status: r.status, body: j, raw: j ? null : txt.slice(0, 400) };
}

// saldo de la cuenta en una moneda. Devuelve null si la casa no contesta — y "null" NO significa cero:
// el ejecutor tiene que distinguir "no lo sé" de "está vacía", porque con cero se para y con null se
// deja que la casa rechace por fondos, que es una respuesta autoritativa y esta no.
// La ruta se descubrió probando, no leyendo: `/pub/v1/account/balance?currency=` da 404 y la buena es
// `/pub/v1/account/currencies/{moneda}/balance`, que devuelve {"amount":"3.99"}. Queda anotado porque la
// próxima persona que busque el saldo va a probar la primera y va a concluir que la llave no sirve.
async function balance(apiKey, currency = 'USDT') {
  if (!apiKey) return null;
  const r = await cbFetch(`/pub/v1/account/currencies/${encodeURIComponent(currency)}/balance`, apiKey).catch(() => null);
  if (!r || !r.ok || !r.body) return null;
  const a = Number(r.body.amount != null ? r.body.amount : r.body.balance);
  return Number.isFinite(a) ? a : null;
}

// las monedas abiertas en la cuenta. Es la comprobación de vida de la llave: contesta 200 con llave y 401
// sin ella, así que un 200 aquí demuestra que la llave vale antes de culpar a ninguna otra cosa.
async function accountCurrencies(apiKey) {
  if (!apiKey) return null;
  const r = await cbFetch('/pub/v1/account/currencies', apiKey).catch(() => null);
  return r && r.ok && r.body ? (r.body.currencies || null) : null;
}

// el evento en crudo, tal como lo publica la casa AHORA. El ejecutor lo relee justo antes de colocar: el
// precio que guardó el barrido puede tener veinte minutos, y veinte minutos son suficientes para que la
// línea ya no exista.
async function eventRaw(apiKey, cbEventId, timeoutMs = 12000) {
  if (!apiKey || !cbEventId) return null;
  const r = await cbFetch(`/pub/v2/odds/events/${encodeURIComponent(cbEventId)}`, apiKey, { timeoutMs, host: HOST }).catch(() => null);
  return r && r.ok ? r.body : null;
}

// la selección viva de un total (goles/córners/tarjetas) por clave de mercado, línea y lado. Devuelve las
// coordenadas EXACTAS de colocación o null. No tolera aproximaciones de línea a propósito: apostar 5,5
// cuando pediste 4,5 no es un redondeo, es otra apuesta.
function selectionFor(evRaw, marketKey, line, outcome) {
  const m = (evRaw && evRaw.markets && evRaw.markets[marketKey]) || null;
  if (!m || !m.submarkets) return null;
  for (const sm of Object.values(m.submarkets)) {
    for (const s of ((sm && sm.selections) || [])) {
      if (s.outcome !== outcome) continue;
      const l = Number(String(s.params || '').match(/total=(-?[\d.]+)/)?.[1]);
      if (!Number.isFinite(l) || Math.abs(l - Number(line)) > 1e-9) continue;
      return {
        marketUrl: s.marketUrl || null,
        price: Number(s.price) || 0,
        minStake: Number(s.minStake) > 0 ? Number(s.minStake) : null,
        maxStake: Number(s.maxStake) > 0 ? Number(s.maxStake) : null,
        status: s.status || null,
        side: s.side || 'BACK',
      };
    }
  }
  return null;
}

// COLOCAR. Devuelve siempre un objeto con `ok`, nunca lanza: una excepción aquí, en el peor momento, es una
// apuesta en estado desconocido. El cuerpo entero de la casa se devuelve tal cual para el libro mayor.
async function placeBet(apiKey, { currency, eventId, marketUrl, price, stake, referenceId, acceptPriceChange = 'BETTER' }) {
  if (!apiKey) return { ok: false, why: 'sin_api_key' };
  if (!eventId || !marketUrl || !(price > 1) || !(stake > 0) || !referenceId) return { ok: false, why: 'coordenadas_incompletas' };
  const body = {
    acceptPriceChange, currency,
    eventId: String(eventId),
    marketUrl,
    price: String(price),
    stake: String(stake),
    referenceId,
  };
  // ── EL DESVÍO, Y POR QUÉ EXISTE (25-ago) ────────────────────────────────────────────────────────────
  // Medido, no supuesto: desde el servidor de Render (Oregón, `loc=US`) la casa contesta 403 con página de
  // cortafuegos a `POST /pub/v3/bets/place`, IGUAL con llave y sin ella, mientras ese mismo servidor lee
  // cuotas y consulta el saldo sin problema. No es la llave —`/pub/v1/account/currencies` da 200 con ella y
  // 401 sin ella— ni la ruta: es el país desde el que sale la petición. La casa no acepta apuestas desde
  // Estados Unidos, y eso no se arregla con código sino saliendo desde otro sitio.
  //
  // `GP_REAL_RELAY_URL` apunta a un reenviador mínimo desplegado fuera de EE. UU. (real-executor/relay.js).
  // Si está puesto, la colocación viaja por ahí; si no, se intenta directo y el 403 se registra tal cual. Lo
  // que NO se hace es disimularlo: una apuesta que no se colocó no puede quedar anotada como colocada.
  const relay = String(process.env.GP_REAL_RELAY_URL || '').trim();
  if (relay) {
    try {
      const opt = {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.GP_REAL_RELAY_TOKEN || '') },
        body: JSON.stringify(body),
      };
      if (AbortSignal.timeout) opt.signal = AbortSignal.timeout(25000);
      const rr = await fetch(relay.replace(/\/$/, '') + '/place', opt);
      const txt = await rr.text();
      let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { /* el reenviador devolvió algo que no es JSON */ }
      return { ok: !!(rr.ok && j && j.ok), status: (j && j.status) || rr.status,
        body: (j && j.cloudbet) || j, raw: j ? null : txt.slice(0, 300), enviado: body, via: 'relay' };
    } catch (e) {
      return { ok: false, status: 0, body: null, raw: 'relay: ' + String((e && e.message) || e).slice(0, 160), enviado: body, via: 'relay' };
    }
  }
  const r = await cbFetch('/pub/v3/bets/place', apiKey, { method: 'POST', body, timeoutMs: 20000 })
    .catch((e) => ({ ok: false, status: 0, body: null, raw: String((e && e.message) || e).slice(0, 200) }));
  return { ok: !!r.ok, status: r.status, body: r.body, raw: r.raw, enviado: body, via: 'directo' };
}

// el estado de una apuesta por su referencia. Es la fuente AUTORITATIVA de si ganó, perdió o se anuló:
// nuestra propia liquidación sirve para el modelo, pero el dinero lo dice la casa.
// ES POST, NO GET (comprobado contra la documentación oficial de la casa el 25-ago). La primera versión
// preguntaba con GET, que no existe: ninguna apuesta se habría liquidado nunca, el banco no habría
// compuesto y la exposición abierta habría crecido hasta bloquear el ejecutor por su propio tope. Es el
// tipo de fallo que no da error visible — solo un registro que se queda quieto.
//
// La respuesta trae `status` (ACCEPTED / PENDING_ACCEPTANCE / REJECTED), `returnAmount`, `stake`, `price`
// y `error`. OJO: `status` dice si la apuesta fue ACEPTADA, NO si ganó. Una apuesta perdida y una todavía
// sin resolver son las dos ACCEPTED con returnAmount "0.0" — de ahí no se puede sacar el resultado, y
// quien lo intente se inventará ganancias o pérdidas. El resultado sale de nuestra propia liquidación; de
// aquí sale el DINERO.
async function betByReference(apiKey, referenceId) {
  if (!apiKey || !referenceId) return null;
  const r = await cbFetch(`/pub/v3/bets/${encodeURIComponent(referenceId)}/status`, apiKey,
    { method: 'POST', body: {} }).catch(() => null);
  return r && r.ok ? r.body : null;
}

// LO QUE HAY EN LA CACHÉ, SIN SALIR A BUSCAR NADA. `fetchCloudbetSoccer` con la caché vencida se lanza a
// una cosecha entera —cientos de peticiones de detalle— y eso, llamado desde el barrido del ejecutor, lo
// convierte en un trabajo de minutos: la primera vez que se intentó, la petición murió con un 502. Para
// averiguar el id de un partido no hace falta nada fresco: los ids no cambian. Así que se lee lo último que
// el colector dejó, con su edad al lado para que quien lo use pueda decidir si le sirve.
function cachedSoccer() {
  return { at: _cache.at, edad_min: _cache.at ? Math.round((Date.now() - _cache.at) / 60000) : null, data: _cache.data || [] };
}

module.exports = { fetchCloudbetSoccer, cachedSoccer, normalizeEvent, soccerCompetitions, HOST,
  balance, accountCurrencies, eventRaw, selectionFor, placeBet, betByReference };

