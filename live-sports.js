// live-sports.js — EL VIVO DE LOS DEPORTES NUEVOS (31-ago, orden de Alexis: "quiero todo en vivo, como
// en fútbol: entrar a cualquier partido y ver el marcador, los puntos, qué está pasando").
//
// Un solo módulo con las fuentes en vivo de cada deporte y memoria corta por fuente (45s): las pantallas
// pueden refrescar cada 30s sin que ninguna fuente reciba más de ~1 llamada/min por proceso. TODO ES
// DISPLAY: nada de lo que sale de aquí toca una probabilidad del modelo — la doctrina de la capa de
// observación aplica entera.
//
// Fuentes (las mismas casas que ya sirven resultados a la plataforma, ninguna nueva):
//   CFL       cflscoreboard.cfl.ca (oficial, sin llave) — período activo, reloj, posesión
//   NCAAF/NFL ESPN site.api scoreboard — estado, cuarto, reloj, marcador (Render la alcanza; el sandbox no)
//   Tenis     ESPN site.api tennis atp/wta — sets por linescores, juego actual
//   CS2       bo3.gg /matches status=current — marcador de serie y del mapa en curso (mismo throttle y
//             respeto de robots que la cosecha: UNA llamada por minuto, jamás en paralelo)
//   LoL       lolesports getSchedule state=inProgress — mapas ganados de la serie en vivo
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MEMO = {};
async function memo(key, ttlMs, fn) {
  const h = MEMO[key];
  if (h && Date.now() - h.at < ttlMs) return h.v;
  if (h && h.inflight) return h.v !== undefined ? h.v : null; // nunca dos vuelos a la misma fuente
  const cur = MEMO[key] = { at: h ? h.at : 0, v: h ? h.v : undefined, inflight: true };
  try { cur.v = await fn(); cur.at = Date.now(); } catch { /* el vivo nunca rompe una pantalla */ }
  cur.inflight = false;
  return cur.v !== undefined ? cur.v : null;
}
async function j(url, headers = {}, timeoutMs = 15000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// ── CFL (oficial) ────────────────────────────────────────────────────────────────────────────────────────
// tournaments con status distinto de 'complete' y kickoff pasado = en juego. El feed trae activePeriod,
// clock y posesión — más rico que ESPN para esta liga (que además ya no la lista).
async function cflLive() {
  return memo('cfl', 45e3, async () => {
    const rounds = await j('https://cflscoreboard.cfl.ca/json/scoreboard/rounds.json');
    const out = [];
    for (const rd of rounds || []) {
      for (const t of rd.tournaments || []) {
        if (!t.homeSquad || !t.awaySquad) continue;
        const kt = Date.parse(t.date || 0);
        if (t.status === 'complete' || !isFinite(kt) || kt > Date.now() || Date.now() - kt > 5 * 3600e3) continue;
        out.push({
          home: t.homeSquad.name, away: t.awaySquad.name,
          hs: t.homeSquad.score != null ? +t.homeSquad.score : 0, as: t.awaySquad.score != null ? +t.awaySquad.score : 0,
          period: t.activePeriod || null, clock: t.clock || null,
          possession: t.possession && t.possession !== 'None' ? t.possession : null,
          detail: t.activePeriod ? `Q${t.activePeriod}${t.clock ? ' ' + t.clock : ''}` : 'EN VIVO',
        });
      }
    }
    return out;
  });
}

// ── ESPN scoreboard genérico (NCAAF, NFL) ───────────────────────────────────────────────────────────────
async function espnLive(pathLeague) {
  return memo('espn:' + pathLeague, 45e3, async () => {
    const sb = await j(`https://site.api.espn.com/apis/site/v2/sports/${pathLeague}/scoreboard`);
    const out = [];
    for (const ev of (sb && sb.events) || []) {
      const st = ev.status && ev.status.type;
      if (!st || st.state !== 'in') continue;
      const comp = (ev.competitions || [])[0] || {};
      const ch = (comp.competitors || []).find((x) => x.homeAway === 'home');
      const ca = (comp.competitors || []).find((x) => x.homeAway === 'away');
      if (!ch || !ca) continue;
      out.push({
        espn: String(ev.id),
        home: (ch.team && (ch.team.displayName || ch.team.shortDisplayName)) || '',
        away: (ca.team && (ca.team.displayName || ca.team.shortDisplayName)) || '',
        hs: +ch.score || 0, as: +ca.score || 0,
        period: (ev.status && ev.status.period) || null,
        clock: (ev.status && ev.status.displayClock) || null,
        detail: (st.shortDetail || st.detail || 'EN VIVO').replace(/^[A-Z]{3,4} - /, ''),
        possession: (comp.situation && comp.situation.possession) || null,
        lastPlay: (comp.situation && comp.situation.lastPlay && comp.situation.lastPlay.text) || null,
        down: (comp.situation && comp.situation.shortDownDistanceText) || null,
      });
    }
    return out;
  });
}
const ncaafLive = () => espnLive('football/college-football');
const nflLive = () => espnLive('football/nfl');

// ── Tenis (ESPN atp+wta) ────────────────────────────────────────────────────────────────────────────────
// El scoreboard de tenis agrupa por TORNEO: cada event trae `competitions` (o `groupings[].competitions`)
// y dentro los cruces con `competitors[].linescores` (un entry por set). Se leen las dos formas.
async function tennisLive() {
  return memo('tennis', 45e3, async () => {
    const out = [];
    for (const tour of ['atp', 'wta']) {
      const sb = await j(`https://site.api.espn.com/apis/site/v2/sports/tennis/${tour}/scoreboard`);
      for (const ev of (sb && sb.events) || []) {
        const comps = (ev.competitions || []).concat(...((ev.groupings || []).map((g) => g.competitions || [])));
        for (const c of comps) {
          const st = c.status && c.status.type;
          if (!st || st.state !== 'in') continue;
          const [p1, p2] = c.competitors || [];
          if (!p1 || !p2) continue;
          const nameOf = (p) => (p.athlete && (p.athlete.displayName || p.athlete.shortName)) || (p.team && p.team.displayName) || '';
          const setsOf = (p) => (p.linescores || []).map((l) => (l.value != null ? l.value : l.displayValue)).join(' ');
          out.push({
            tour, tournament: (ev.name || '').slice(0, 60),
            a: nameOf(p1), b: nameOf(p2),
            sets_a: setsOf(p1), sets_b: setsOf(p2),
            serve_a: !!p1.possession, serve_b: !!p2.possession,
            detail: st.shortDetail || st.detail || 'EN VIVO',
          });
        }
      }
    }
    return out;
  });
}

// ── CS2 (bo3.gg) ────────────────────────────────────────────────────────────────────────────────────────
async function cs2Live() {
  return memo('cs2', 60e3, async () => {
    const r = await j('https://api.bo3.gg/api/v1/matches?filter[matches.status][eq]=current&page[limit]=24&with=teams');
    return ((r && r.results) || []).map((m) => ({
      a: (m.team1 && m.team1.name) || null, b: (m.team2 && m.team2.name) || null,
      s1: m.team1_score != null ? m.team1_score : 0, s2: m.team2_score != null ? m.team2_score : 0,
      bo: m.bo_type || null,
      map_s1: m.team1_last_game_score != null ? m.team1_last_game_score : null,
      map_s2: m.team2_last_game_score != null ? m.team2_last_game_score : null,
      detail: `mapa ${(m.team1_score || 0) + (m.team2_score || 0) + 1}`,
    })).filter((x) => x.a && x.b);
  });
}

// ── LoL (lolesports) ────────────────────────────────────────────────────────────────────────────────────
const LOL_KEY = () => process.env.LOLESPORTS_API_KEY || '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';
async function lolLive() {
  return memo('lol', 60e3, async () => {
    const r = await j('https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=es-ES', { 'x-api-key': LOL_KEY() });
    const evs = ((r && r.data && r.data.schedule) || {}).events || [];
    const out = [];
    for (const e of evs) {
      if (e.state !== 'inProgress' || !e.match || !(e.match.teams || []).length) continue;
      const [t1, t2] = e.match.teams;
      out.push({
        a: t1.name, b: t2.name,
        s1: (t1.result && t1.result.gameWins) || 0, s2: (t2.result && t2.result.gameWins) || 0,
        bo: (e.match.strategy && e.match.strategy.count) || null,
        league: (e.league && e.league.name) || null,
        detail: `mapa ${(((t1.result && t1.result.gameWins) || 0) + ((t2.result && t2.result.gameWins) || 0)) + 1}`,
      });
    }
    return out;
  });
}

// busca un cruce por nombres normalizados en cualquier orden; matching laxo por inclusión para tolerar
// "RedBlacks" vs "Ottawa Redblacks" o "N. Djokovic" vs "Novak Djokovic"
function matchByNames(list, homeName, awayName, keys = ['home', 'away']) {
  const H = norm(homeName), A = norm(awayName);
  const hit = (x, y) => x && y && (x === y || x.includes(y) || y.includes(x) ||
    (y.split(' ').pop().length > 3 && x.includes(y.split(' ').pop())));
  for (const it of list || []) {
    const h = norm(it[keys[0]]), a = norm(it[keys[1]]);
    if ((hit(h, H) && hit(a, A))) return { ...it, swapped: false };
    if ((hit(h, A) && hit(a, H))) return { ...it, swapped: true };
  }
  return null;
}

module.exports = { cflLive, ncaafLive, nflLive, tennisLive, cs2Live, lolLive, matchByNames, norm };
