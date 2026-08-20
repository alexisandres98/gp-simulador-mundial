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
  const M = e.markets || {}, out = { home, away, kickoff: e.cutoffTime || null, markets: { h2h: null, totals: [] } };
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
      (byLine[line] = byLine[line] || {})[s.outcome] = { o: p, max: Number(s.maxStake) > 0 ? Number(s.maxStake) : null };
    }
    const rows = [];
    for (const line of Object.keys(byLine)) {
      const o = byLine[line];
      if (o.over && o.under && o.over.o > 1 && o.under.o > 1)
        rows.push({ line: Number(line), over: o.over.o, under: o.under.o, max: { over: o.over.max, under: o.under.max } });
    }
    return rows;
  };
  out.markets.totals = parseTotals(M['soccer.total_goals']);
  // 13-ago (ejecutor en la sombra a precio EJECUTABLE): córners y tarjetas de Cloudbet — son los mercados
  // donde vive el segmento en verificación (cards-under). Claves ausentes → arrays vacíos, cero ruido.
  out.markets.corners = parseTotals(M['soccer.total_corners']);
  out.markets.cards = parseTotals(M['soccer.total_bookings'] || M['soccer.total_cards']);
  return (out.markets.h2h || out.markets.totals.length || out.markets.corners.length || out.markets.cards.length) ? out : null;
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
    for (const c of comps) {
      if (ids.length >= maxEvents) break;
      try {
        const j = await cbGet(`/pub/v2/odds/competitions/${encodeURIComponent(c.key)}?limit=60&from=${fromS}&to=${toS}`, apiKey, timeoutMs);
        for (const e of (j.events || [])) {
          if (e.type === 'EVENT_TYPE_EVENT' && e.home && e.away && e.id) { ids.push({ id: e.id, comp: c.key, ko: e.cutoffTime || null }); if (ids.length >= maxEvents) break; }
        }
      } catch (e) { S.comp_fallidas++; anota(e); }   // liga sin cobertura este ciclo — o límite de tasa
    }
    // LO QUE EMPIEZA ANTES, PRIMERO (20-ago). Cloudbet publica el ESQUELETO del mercado días antes con todas
    // las selecciones en SELECTION_DISABLED y precio 0: existe la línea, no existe el precio. Con la ventana
    // en 72-96 h el presupuesto de 200 partidos se lo comían esos esqueletos —181 de 200 en la medición— y
    // los partidos de HOY, que sí tienen precio, se quedaban fuera. No era que la casa no cotizara: era que
    // le preguntábamos demasiado pronto y gastábamos el cupo en preguntarlo.
    ids.sort((a, b) => Date.parse(a.ko || 0) - Date.parse(b.ko || 0));
    S.ids = ids.length;
    // detalle de cada partido en LOTES paralelos. El lote es de 3 y con pausa: con 6 a pelo Cloudbet
    // devolvía 429 en la mayoría y el colector se quedaba con las migajas, en silencio.
    for (let i = 0; i < ids.length; i += LOTE) {
      const batch = ids.slice(i, i + LOTE);
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
      if (i + LOTE < ids.length && PAUSA) await new Promise((r) => setTimeout(r, PAUSA));
    }
  } catch (e) { S.listado_error = e.message; return _cache.data; } // fallo en el listado de deportes → último bueno
  S.devueltos = out.length;
  if (out.length) _cache = { at: now, data: out };
  return out.length ? out : _cache.data;
}

module.exports = { fetchCloudbetSoccer, normalizeEvent, soccerCompetitions, HOST };
