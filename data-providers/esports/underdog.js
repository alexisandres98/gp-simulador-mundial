// data-providers/esports/underdog.js — LÍNEAS DE PROPS DE JUGADOR EN LIBRO BLANDO (17-ago).
//
// POR QUÉ EXISTE. El análisis de LCS Larry (17-ago) confirmó dónde vive el flanco blando del mercado de
// esports: los libros estilo DFS publican props de jugador (kills en mapas 1-2) y mueven la línea tarde.
// Es exactamente la familia de ventaja que GP ya validó en otros deportes — precio contra precio, casa
// lenta contra dato propio — y CS2 es el único juego donde GP tiene scoreboard PROPIO por jugador
// (data/esports/cs2/player-map-stats.json, ventana 180 días) para proyectar la stat con base medida.
//
// QUÉ TRAE. Underdog publica su pizarra completa en un solo endpoint público, con LA DIFERENCIA que lo
// hace utilizable: cada opción trae `american_price` — precio real por pierna, no solo el multiplicador
// del boleto pick'em. Con precio por pierna hay listón de equilibrio (1/decimal) y por tanto ventaja
// medible. PrizePicks se probó el mismo día y bloquea con captcha (DataDome): queda fuera.
//
// REGLA DE LA CASA, igual que bo3/cloudbet: este archivo es lo ÚNICO que sabe que Underdog existe. La
// taxonomía de salida es de GP (juego, jugador, stat, línea, lados con precio decimal). Cambiar de libro
// blando es reescribir este adaptador, no el motor.
'use strict';

const URL_LINES = 'https://api.underdogfantasy.com/beta/v5/over_under_lines';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// Solo los títulos que GP entiende. FIFA/NFL/etc. de este mismo payload se ignoran a propósito: cada
// deporte de la casa tiene su propia puerta de datos.
const SPORT_TO_GAME = { CS: 'cs2', LOL: 'lol', VAL: 'valorant' };

function americanToDec(am) {
  const n = Number(String(am || '').replace('+', ''));
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

async function fetchLines({ timeoutMs = 20000, tries = 3 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(URL_LINES, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 429 || r.status >= 500) { await new Promise((x) => setTimeout(x, 1500 * (i + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise((x) => setTimeout(x, 900 * (i + 1))); }
  }
  return null;
}

// Pizarra normalizada de props de esports. Devuelve SIEMPRE la misma forma aunque el libro no responda:
// la capa de arriba tiene que poder decir "libro sin señal" sin reventar.
async function propLines() {
  const j = await fetchLines();
  if (!j || !Array.isArray(j.over_under_lines)) {
    return { available: false, book: 'underdog', rows: [], at: new Date().toISOString() };
  }
  const apps = new Map((j.appearances || []).map((a) => [a.id, a]));
  const players = new Map((j.players || []).map((p) => [p.id, p]));
  const games = new Map((j.games || []).map((g) => [g.id, g]));
  const rows = [];
  for (const l of j.over_under_lines) {
    const ou = l.over_under || {};
    const ast = ou.appearance_stat || {};
    const app = apps.get(ast.appearance_id || '');
    if (!app) continue;
    const pl = players.get(app.player_id || '');
    const game = pl && SPORT_TO_GAME[pl.sport_id];
    if (!game) continue;
    const g = games.get(app.match_id) || null;
    const sides = [];
    for (const o of l.options || []) {
      const side = o.choice === 'higher' ? 'over' : o.choice === 'lower' ? 'under' : null;
      if (!side) continue;
      sides.push({ side, price_dec: americanToDec(o.american_price), american: o.american_price || null });
    }
    if (!sides.length) continue;
    // El nick competitivo viaja en last_name (first_name suele venir vacío en esports).
    const nick = [pl.first_name, pl.last_name].filter(Boolean).join(' ').trim();
    rows.push({
      book: 'underdog', game,
      player_nick: nick,
      stat: ast.stat || null, stat_label: ast.display_stat || null,
      line: Number(l.stat_value),
      line_type: l.line_type || null,     // 'balanced' = línea principal; el resto son alternativas
      sides,
      match: g ? {
        id: String(g.id), title: g.full_team_names_title || g.title || null,
        short: g.abbreviated_title || null, start_at: g.scheduled_at || null, status: g.status || null,
      } : null,
    });
  }
  return { available: true, book: 'underdog', rows, at: new Date().toISOString() };
}

module.exports = { propLines, americanToDec };
