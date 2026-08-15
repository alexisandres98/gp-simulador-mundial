// data-providers/basketball/espn.js — COLECTOR DE BALONCESTO (15-ago). La fuente base del 4º deporte.
//
// POR QUÉ ESPN Y NO UN PROVEEDOR DE PAGO: es gratis, es pública y —lo decisivo— sirve PLAY-BY-PLAY completo
// (≈500 jugadas por partido) con coordenadas de tiro, 63 tipos de jugada y SUSTITUCIONES. Eso alcanza para
// reconstruir posesiones, quintetos, on/off, mapas de tiro, garbage time y clutch: la materia prima de todo
// el Game Intelligence Center. api-sports queda como capa de ENRIQUECIMIENTO (se enciende al subir su plan),
// nunca como dependencia dura — mismo patrón que API-Football con el fútbol.
//
// Cobertura verificada 15-ago: nba, wnba, ncaam y ncaaw responden; el scoreboard acepta RANGOS de fecha y
// devolvió 790 partidos en UNA sola llamada, así que una temporada entera se cosecha en 2-3 requests.
//
// PURO en red: no toca db, no escribe archivos, nunca lanza. Quien llama decide qué persistir.
'use strict';

// `path` es el segmento de ESPN; `pace` es una pista de ritmo esperado para el prior del motor (posesiones
// por 48'/40'). NCAA juega 40 minutos y dos mitades — el motor lo necesita para no comparar peras con manzanas.
// `ppg` = puntos por equipo y partido típicos de la liga. No es decoración: escala el umbral de garbage time
// (ver garbageStart) y sirve de prior de anotación al motor. Medidos, no supuestos — WNBA salió 85.1 sobre
// los 60 primeros partidos derivados de 2026.
const LEAGUES = {
  nba:   { path: 'basketball/nba',                       label: 'NBA',            minutes: 48, periods: 4, otMin: 5, ppg: 115 },
  wnba:  { path: 'basketball/wnba',                      label: 'WNBA',           minutes: 40, periods: 4, otMin: 5, ppg: 85 },
  ncaam: { path: 'basketball/mens-college-basketball',   label: 'NCAA masculino', minutes: 40, periods: 2, otMin: 5, ppg: 74 },
  ncaaw: { path: 'basketball/womens-college-basketball', label: 'NCAA femenino',  minutes: 40, periods: 2, otMin: 5, ppg: 67 },
};
const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues';

async function get(url, { timeoutMs = 25000, tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
      if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 900 * (i + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise(s => setTimeout(s, 700 * (i + 1))); }
  }
  return null;
}
const ymd = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '');

// ---- PARTIDOS (scoreboard) ------------------------------------------------------------------------------
// Un partido normalizado. `line` es el marcador por periodo, que el motor usa para detectar garbage time y
// para el modelo de prórroga sin tener que abrir el play-by-play.
function normGame(e, league) {
  const c = (e.competitions || [])[0]; if (!c) return null;
  const cs = c.competitors || [];
  const H = cs.find(x => x.homeAway === 'home') || cs[0], A = cs.find(x => x.homeAway === 'away') || cs[1];
  if (!H || !A) return null;
  const side = (x) => ({
    id: String((x.team || {}).id || ''), abbr: (x.team || {}).abbreviation || null,
    name: (x.team || {}).displayName || (x.team || {}).name || '', short: (x.team || {}).shortDisplayName || null,
    logo: (x.team || {}).logo || (((x.team || {}).logos || [])[0] || {}).href || null,
    color: (x.team || {}).color || null,
    score: x.score != null ? Number(x.score) : null,
    line: (x.linescores || []).map(l => Number(l.value) || 0),
    record: ((x.records || []).find(r => r.type === 'total') || {}).summary || null,
  });
  const st = (c.status || {}).type || {};
  return {
    id: String(e.id), league, date: e.date || c.date || null, name: e.name || '',
    season: (e.season || {}).year || null, season_type: (e.season || {}).type || null,
    neutral: !!c.neutralSite, venue: ((c.venue || {}).fullName) || null,
    status: st.state || null, completed: !!st.completed, detail: st.shortDetail || null,
    period: (c.status || {}).period || null, clock: (c.status || {}).displayClock || null,
    pbp: !!c.playByPlayAvailable,
    home: side(H), away: side(A),
  };
}

// Partidos en una ventana. `from`/`to` son Date o 'YYYYMMDD'. Sin `to` pide un solo día.
async function games(league, { from, to, limit = 1000 } = {}) {
  const L = LEAGUES[league]; if (!L) return [];
  const f = typeof from === 'string' ? from : ymd(from || Date.now());
  const range = to ? `${f}-${typeof to === 'string' ? to : ymd(to)}` : f;
  const j = await get(`${SITE}/${L.path}/scoreboard?dates=${range}&limit=${limit}`);
  return ((j && j.events) || []).map(e => normGame(e, league)).filter(Boolean);
}

// ---- DETALLE DE UN PARTIDO (summary: box score + play-by-play + lesiones + cuotas) -----------------------
// Devuelve el crudo ÚTIL ya recortado. El parseo a posesiones/quintetos vive en basketball-engine/possessions,
// que es donde tiene sentido razonar sobre el juego; acá solo se normaliza la forma.
async function summary(league, eventId) {
  const L = LEAGUES[league]; if (!L) return null;
  const j = await get(`${SITE}/${L.path}/summary?event=${encodeURIComponent(eventId)}`);
  if (!j) return null;
  const bs = j.boxscore || {};
  // stats de equipo: ESPN los da como [{label, displayValue}] — se aplanan a un objeto legible
  const teamStats = (bs.teams || []).map(t => {
    const o = { team_id: String((t.team || {}).id || ''), abbr: (t.team || {}).abbreviation || null, home: t.homeAway === 'home' };
    for (const s of (t.statistics || [])) o[String(s.name || s.label || '').trim()] = s.displayValue != null ? s.displayValue : s.value;
    return o;
  });
  // líneas de jugador: labels vienen aparte del array de valores, así que se zipean a objeto
  const players = [];
  for (const grp of (bs.players || [])) {
    const teamId = String(((grp.team || {}).id) || '');
    for (const blk of (grp.statistics || [])) {
      const labels = blk.labels || [];
      for (const a of (blk.athletes || [])) {
        const row = { team_id: teamId, id: String((a.athlete || {}).id || ''), name: (a.athlete || {}).displayName || '',
          short: (a.athlete || {}).shortName || null, pos: ((a.athlete || {}).position || {}).abbreviation || null,
          headshot: ((a.athlete || {}).headshot || {}).href || null, starter: !!a.starter, dnp: !!a.didNotPlay };
        (a.stats || []).forEach((v, i) => { if (labels[i]) row[labels[i]] = v; });
        players.push(row);
      }
    }
  }
  return {
    id: String(eventId), league,
    team_stats: teamStats, players,
    plays: (j.plays || []).map(p => ({
      id: String(p.id || ''), seq: Number(p.sequenceNumber) || null,
      type: (p.type || {}).text || null, type_id: (p.type || {}).id || null, text: p.text || null,
      period: (p.period || {}).number || null, clock: (p.clock || {}).displayValue || null,
      home_score: Number(p.homeScore) || 0, away_score: Number(p.awayScore) || 0,
      team_id: p.team ? String(p.team.id) : null,
      athletes: (p.participants || []).map(x => String((x.athlete || {}).id || '')).filter(Boolean),
      shooting: !!p.shootingPlay, scoring: !!p.scoringPlay, points: Number(p.scoreValue) || 0,
      attempted: Number(p.pointsAttempted) || null,
      x: p.coordinate ? Number(p.coordinate.x) : null, y: p.coordinate ? Number(p.coordinate.y) : null,
    })),
    injuries: (j.injuries || []).map(t => ({
      team_id: String((t.team || {}).id || ''),
      items: (t.injuries || []).map(i => ({
        athlete_id: String((i.athlete || {}).id || ''), name: (i.athlete || {}).displayName || '',
        status: i.status || null, type: ((i.type || {}).description) || null, detail: (i.details || {}).detail || null,
      })),
    })),
    odds: (j.pickcenter || []).map(o => ({ book: (o.provider || {}).name || null, spread: o.spread ?? null, over_under: o.overUnder ?? null,
      home_ml: (o.homeTeamOdds || {}).moneyLine ?? null, away_ml: (o.awayTeamOdds || {}).moneyLine ?? null })),
    espn_winprob: (j.winprobability || []).length ? { last: (j.winprobability || []).slice(-1)[0] } : null,
  };
}

// ---- EQUIPOS Y JUGADORES --------------------------------------------------------------------------------
async function teams(league) {
  const L = LEAGUES[league]; if (!L) return [];
  const j = await get(`${SITE}/${L.path}/teams?limit=500`);
  const grp = (((j || {}).sports || [])[0] || {}).leagues || [];
  const out = [];
  for (const lg of grp) for (const t of (lg.teams || [])) {
    const x = t.team || {};
    out.push({ id: String(x.id), league, abbr: x.abbreviation || null, name: x.displayName || '', short: x.shortDisplayName || null,
      location: x.location || null, color: x.color || null, alt_color: x.alternateColor || null,
      logo: x.logos && x.logos[0] ? x.logos[0].href : null });
  }
  return out;
}
async function roster(league, teamId) {
  const L = LEAGUES[league]; if (!L) return [];
  const j = await get(`${SITE}/${L.path}/teams/${encodeURIComponent(teamId)}/roster`);
  // ESPN devuelve `athletes` de DOS formas según la liga: plano (NBA/WNBA) o agrupado por posición
  // ({position, items:[...]}, típico de NCAA). Se aceptan ambas o la plantilla sale vacía sin avisar.
  const out = [];
  const groups = ((j || {}).athletes || []);
  const flat = [];
  for (const g of groups) {
    if (Array.isArray(g)) flat.push(...g);
    else if (g && Array.isArray(g.items)) flat.push(...g.items);
    else if (g && g.id) flat.push(g);
  }
  {
    for (const a of flat) out.push({
      id: String(a.id), team_id: String(teamId), league, name: a.displayName || a.fullName || '',
      short: a.shortName || null, jersey: a.jersey || null,
      pos: (a.position || {}).abbreviation || null, pos_name: (a.position || {}).displayName || null,
      height: a.displayHeight || null, height_in: a.height || null, weight: a.weight || null,
      age: a.age || null, dob: a.dateOfBirth ? String(a.dateOfBirth).slice(0, 10) : null,
      exp: a.experience ? a.experience.years : null,
      college: (a.college || {}).name || null,
      headshot: (a.headshot || {}).href || null,
      status: (a.status || {}).name || null,
      // la ficha ya trae el parte médico: se guarda acá y evita una llamada por jugador
      injury: ((a.injuries || [])[0] || {}).status || null,
    });
  }
  return out;
}
// calendario de una temporada completa por trozos de ~4 meses (el scoreboard aguanta rangos largos: 790
// partidos en una llamada el 15-ago, así que una temporada entera son 2-3 requests)
async function season(league, year, { chunks = null } = {}) {
  const L = LEAGUES[league]; if (!L) return [];
  // OJO (verificado 15-ago): el scoreboard TOPA EN 100 eventos por llamada aunque se pida limit=1000 —
  // pedir rangos largos devuelve una temporada truncada EN SILENCIO. Se trocea por quincenas, que con
  // ~15 partidos/día de NBA entra holgado, y se deduplica por id.
  const months = league === 'wnba' ? [[year, 4], [year, 5], [year, 6], [year, 7], [year, 8], [year, 9], [year, 10]]
    : [[year - 1, 10], [year - 1, 11], [year - 1, 12], [year, 1], [year, 2], [year, 3], [year, 4], [year, 5], [year, 6]];
  const pad = (n) => String(n).padStart(2, '0');
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const spans = chunks || months.flatMap(([y, m]) => [
    [`${y}${pad(m)}01`, `${y}${pad(m)}15`],
    [`${y}${pad(m)}16`, `${y}${pad(m)}${lastDay(y, m)}`],
  ]);
  const seen = new Set(), out = [];
  for (const [a, b] of spans) {
    const batch = await games(league, { from: a, to: b, limit: 100 });
    if (batch.length >= 100) console.warn('[hoops-espn] tramo TOPADO en 100:', league, a, b, '— achicar la ventana');
    for (const g of batch) if (!seen.has(g.id)) { seen.add(g.id); out.push(g); }
    await new Promise(s => setTimeout(s, 180));
  }
  return out.sort((x, y) => String(x.date).localeCompare(String(y.date)));
}

module.exports = { LEAGUES, games, summary, teams, roster, season, normGame, SITE, CORE };
