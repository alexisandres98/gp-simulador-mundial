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

// ── Series de esports (bo3.gg) — CS2, Valorant, Dota 2 ─────────────────────────────────────────────────
// bo3 cubre 8 disciplinas con la MISMA forma (comprobado 31-ago: 1=csgo, 2=valorant, 3=lol, 4=dota2).
// `with=teams,games` trae el HISTORIAL DE MAPAS de la serie: cada mapa terminado viene con nombre,
// ganador y marcador de rondas. Del mapa EN CURSO bo3 solo publica el nombre y la hora de inicio (los
// campos de rondas llegan null hasta que termina — comprobado también contra /games/{id}), y en eventos
// menores tampoco gradúa los terminados; ese límite se declara tal cual en la UI en vez de inventar.
async function bo3SeriesLive(disciplineId, memoKey) {
  return memo(memoKey, 60e3, async () => {
    const r = await j(`https://api.bo3.gg/api/v1/matches?filter[matches.status][eq]=current&filter[matches.discipline_id][eq]=${disciplineId}&page[limit]=24&with=teams,games`);
    return ((r && r.results) || []).map((m) => {
      const n1 = norm(m.team1 && m.team1.name);
      const games = ((m.games || []).slice()).sort((x, y) => (x.number || 0) - (y.number || 0));
      const maps = [];
      for (const g of games) {
        if (g.status !== 'finished') continue;
        const w = norm(g.winner_clan_name);
        // orientación: el ganador del mapa se casa contra team1 por nombre; si no casa con ninguno de
        // los dos, el mapa se pinta sin marcador antes que con el marcador al revés
        const wIs1 = w && n1 && (w === n1 || n1.includes(w) || w.includes(n1));
        const wIs2 = w && !wIs1 && (() => { const n2 = norm(m.team2 && m.team2.name); return n2 && (w === n2 || n2.includes(w) || w.includes(n2)); })();
        maps.push({
          n: g.number || maps.length + 1, map: String(g.map_name || '').replace(/^de_/, ''),
          s1: wIs1 ? g.winner_clan_score : wIs2 ? g.loser_clan_score : null,
          s2: wIs2 ? g.winner_clan_score : wIs1 ? g.loser_clan_score : null,
        });
      }
      const cur = games.find((g) => g.status === 'current');
      return {
        a: (m.team1 && m.team1.name) || null, b: (m.team2 && m.team2.name) || null,
        s1: m.team1_score != null ? m.team1_score : 0, s2: m.team2_score != null ? m.team2_score : 0,
        bo: m.bo_type || null,
        map_s1: m.team1_last_game_score != null ? m.team1_last_game_score : null,
        map_s2: m.team2_last_game_score != null ? m.team2_last_game_score : null,
        maps,
        cur_map: cur ? { n: cur.number || maps.length + 1, map: String(cur.map_name || '').replace(/^de_/, ''), since: cur.begin_at || null } : null,
        detail: cur && cur.map_name ? `mapa ${cur.number || (m.team1_score || 0) + (m.team2_score || 0) + 1} · ${String(cur.map_name).replace(/^de_/, '')}` : `mapa ${(m.team1_score || 0) + (m.team2_score || 0) + 1}`,
      };
    }).filter((x) => x.a && x.b);
  });
}
const cs2Live = () => bo3SeriesLive(1, 'cs2');
const valorantLive = () => bo3SeriesLive(2, 'valorant');

// ── Dota 2: serie de bo3 + kills/oro del mapa en curso de OpenDota ──────────────────────────────────────
// OpenDota /api/live (sin llave) lista las partidas espectadas AHORA con radiant_score (kills),
// radiant_lead (ventaja de oro) y game_time; las de equipos PRO llevan team_name_radiant/dire. Se casa
// contra la serie de bo3 por nombres — sin cruce, la serie se pinta sin detalle, jamás con el ajeno.
async function dota2Live() {
  return memo('dota2', 60e3, async () => {
    const series = (await bo3SeriesLive(4, 'dota2:bo3')) || [];
    const od = await j('https://api.opendota.com/api/live');
    const pro = (od || []).filter((x) => x.team_name_radiant && x.team_name_dire);
    for (const s of series) {
      const hit = matchByNames(pro, s.a, s.b, ['team_name_radiant', 'team_name_dire']);
      if (!hit) continue;
      const rad = { k: hit.radiant_score != null ? hit.radiant_score : null };
      const dire = { k: hit.dire_score != null ? hit.dire_score : null };
      s.game = {
        n: (s.s1 || 0) + (s.s2 || 0) + 1,
        a: hit.swapped ? dire : rad, b: hit.swapped ? rad : dire,
        gold_lead: hit.radiant_lead != null ? (hit.swapped ? -hit.radiant_lead : hit.radiant_lead) : null,
        min: hit.game_time != null ? Math.floor(hit.game_time / 60) : null,
      };
    }
    return series;
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
        a: t1.name, b: t2.name, mid: e.match.id || null,
        s1: (t1.result && t1.result.gameWins) || 0, s2: (t2.result && t2.result.gameWins) || 0,
        bo: (e.match.strategy && e.match.strategy.count) || null,
        league: (e.league && e.league.name) || null,
        detail: `mapa ${(((t1.result && t1.result.gameWins) || 0) + ((t2.result && t2.result.gameWins) || 0)) + 1}`,
      });
    }
    // EL DETALLE DEL MAPA EN CURSO (31-ago, "quiero el número de muertes"): getEventDetails da los games
    // de la serie y su estado; feed.lolesports livestats/window da frames con kills, oro, torres,
    // dragones y barones por lado. OJO con startingTime: sin él el feed devuelve los PRIMEROS frames del
    // juego (parece vivo y es el minuto 0 — mordió en el primer intento); el parámetro tiene que ser
    // múltiplo de 10s y el final de la ventana ≥120s en el pasado, o responde 400. now−150s cumple ambas.
    // Máximo 3 series por pasada para no castigar la fuente; todo dentro del mismo memo de 60s.
    for (const m of out.slice(0, 3)) {
      if (!m.mid) continue;
      try {
        const det = await j(`https://esports-api.lolesports.com/persisted/gw/getEventDetails?hl=es-ES&id=${m.mid}`, { 'x-api-key': LOL_KEY() });
        const match = det && det.data && det.data.event && det.data.event.match;
        const g = ((match && match.games) || []).find((x) => x.state === 'inProgress');
        if (!g || !g.id) continue;
        const tW = new Date(Math.floor((Date.now() - 150e3) / 10e3) * 10e3).toISOString();
        const w = await j(`https://feed.lolesports.com/livestats/v1/window/${g.id}?startingTime=${tW}`);
        const fr = w && Array.isArray(w.frames) && w.frames.length ? w.frames[w.frames.length - 1] : null;
        if (!fr || !fr.blueTeam || !fr.redTeam) continue;
        // orientación azul/rojo → a/b por el id de equipo del metadata; sin cruce se asume azul = a
        const bluId = w.gameMetadata && w.gameMetadata.blueTeamMetadata && String(w.gameMetadata.blueTeamMetadata.esportsTeamId || '');
        const ids = ((match && match.teams) || []).map((t) => String(t.id || ''));
        const blueIsA = !bluId || !ids[0] ? true : bluId === ids[0];
        const side = (t) => ({ k: t.totalKills != null ? t.totalKills : null, g: t.totalGold != null ? Math.round(t.totalGold / 100) / 10 : null,
          t: t.towers != null ? t.towers : null, d: Array.isArray(t.dragons) ? t.dragons.length : null, b: t.barons != null ? t.barons : null });
        m.game = { n: g.number || (m.s1 + m.s2 + 1), state: fr.gameState || null,
          a: side(blueIsA ? fr.blueTeam : fr.redTeam), b: side(blueIsA ? fr.redTeam : fr.blueTeam) };
        // POR JUGADOR: livestats/details da KDA y CS de los 10 (participantes 1-5 azul, 6-10 rojo);
        // los nombres viven en el gameMetadata de window. El endpoint responde 204 entre mapas — es
        // un extra sobre el extra y nunca bloquea lo demás.
        try {
          const dw = await j(`https://feed.lolesports.com/livestats/v1/details/${g.id}?startingTime=${tW}`);
          const dfr = dw && Array.isArray(dw.frames) && dw.frames.length ? dw.frames[dw.frames.length - 1] : null;
          const meta = [
            ...(((w.gameMetadata || {}).blueTeamMetadata || {}).participantMetadata || []),
            ...(((w.gameMetadata || {}).redTeamMetadata || {}).participantMetadata || []),
          ];
          if (dfr && Array.isArray(dfr.participants) && meta.length) {
            const nameOf = {};
            for (const pm of meta) nameOf[pm.participantId] = pm.summonerName || pm.championId || '';
            const rows = dfr.participants.map((p) => ({
              n: nameOf[p.participantId] || `#${p.participantId}`,
              blue: p.participantId <= 5,
              k: p.kills || 0, d: p.deaths || 0, a: p.assists || 0, cs: p.creepScore != null ? p.creepScore : null,
            }));
            const top = (isBlue) => rows.filter((x) => x.blue === isBlue).sort((x, y) => y.k - x.k)[0] || null;
            m.game.top_a = top(blueIsA), m.game.top_b = top(!blueIsA);
          }
        } catch { /* sin detalle por jugador no pasa nada */ }
      } catch { /* el detalle es un extra: la serie se pinta igual sin él */ }
    }
    return out;
  });
}

// ── Polymarket EN VIVO (31-ago, idea de Alexis: "esa data en vivo la puedes encontrar en Polymarket") ──
// `gamma /events?closed=false&live=true` devuelve TODOS los eventos deportivos en juego en una llamada:
// marcador (`score`), período (`period`: 2H/Q3/1/3/SUS), minuto (`elapsed`), tags del deporte y los
// mercados con su precio EN VIVO — la probabilidad implícita del dinero real, latiendo punto a punto.
// Cloudbet quedó descartado para esto: su feed público responde los mercados en vivo SUSPENDIDOS
// (price 0 en los 10 tenis + 2 LoL vivos probados); Kalshi da precios pero no marcadores. DISPLAY puro.
// Dos formas de mercado (comprobadas): esports = un mercado "Match Winner" con los equipos como
// outcomes; fútbol = trío Yes/No por equipo + "Draw (...)". Se leen las dos.
async function pmLive() {
  return memo('pm', 45e3, async () => {
    const evs = await j('https://gamma-api.polymarket.com/events?closed=false&live=true&limit=100');
    if (!Array.isArray(evs)) return [];
    const byGame = new Map(); // dedup: el evento base y sus derivados ("... - Exact Score") comparten gameId
    for (const e of evs) {
      const title = String(e.title || '');
      // "LoL: A vs B (BO3) - Liga" / "Dota 2: A vs B" / "Aston Villa FC vs. Arsenal FC" → equipos.
      // El prefijo del juego puede llevar espacio ("Dota 2:"); solo se recorta si lo que queda aún
      // contiene el "vs", para no comerse un nombre real con dos puntos.
      let clean = title;
      const pref = clean.match(/^([A-Za-z0-9 ]{2,16}):\s*(.+)$/); // "US Open WTA:" mide 11
      if (pref && /\svs\.?\s/i.test(pref[2])) clean = pref[2];
      clean = clean.replace(/\s*\((?:BO\d|Bo\d)\)\s*/i, ' ').split(' - ')[0];
      const parts = clean.split(/\s+vs\.?\s+/i);
      if (parts.length !== 2) continue;
      const A = parts[0].trim(), B = parts[1].trim();
      if (!A || !B) continue;
      const tags = (e.tags || []).map((t) => t.slug || '').filter(Boolean);
      const pj = (m, k) => { try { return JSON.parse(m[k] || '[]'); } catch { return []; } };
      let p_a = null, p_b = null, p_draw = null;
      for (const m of e.markets || []) {
        if (m.closed === true && m.active !== true) continue;
        const os = pj(m, 'outcomes'), ps = pj(m, 'outcomePrices').map(Number);
        if (os.length !== 2 || ps.length !== 2) continue;
        const grp = String(m.groupItemTitle || '');
        // mercado de ganador: o viene rotulado ("Match Winner"/"Moneyline", esports), o viene SIN grupo
        // con los dos nombres como outcomes (tenis, comprobado en vivo) — se acepta solo si algún outcome
        // casa con los nombres del título, para no confundirlo con un Over/Under
        const named = os.length === 2 && !/^(yes|no|over|under|odd|even)$/i.test(os[0]) &&
          [os[0], os[1]].some((o) => { const on = norm(o); return on === norm(A) || on === norm(B) || norm(A).includes(on) || norm(B).includes(on) || on.includes(norm(A)) || on.includes(norm(B)); });
        if ((/^(match winner|moneyline)$/i.test(grp) || (named && !grp)) && !/^(yes|no)$/i.test(os[0])) {
          // los outcomes son los equipos; orientación contra el título
          const o0 = norm(os[0]);
          const aFirst = o0 === norm(A) || o0.includes(norm(A)) || norm(A).includes(o0);
          if (p_a == null) { p_a = aFirst ? ps[0] : ps[1]; p_b = aFirst ? ps[1] : ps[0]; }
        } else if (/^yes$/i.test(os[0])) {
          const g = norm(grp);
          if (g && g === norm(A)) p_a = ps[0];
          else if (g && g === norm(B)) p_b = ps[0];
          else if (/^draw\b/i.test(grp)) p_draw = ps[0];
        }
      }
      const row = {
        a: A, b: B, tags, title,
        p_a, p_b, p_draw,
        score: String(e.score || '') || null, period: e.period || null,
        elapsed: e.elapsed != null && e.elapsed !== '' ? +e.elapsed : null,
      };
      const gk = e.gameId || title.split(' - ')[0];
      const prev = byGame.get(gk);
      // el evento con probabilidad extraída manda sobre sus derivados
      if (!prev || (prev.p_a == null && row.p_a != null)) byGame.set(gk, row);
    }
    return [...byGame.values()];
  });
}
// filtra filas de pmLive por deporte (los tags observados: soccer, tennis, nfl, cfb, mlb, nba, esports,
// league-of-legends, counter-strike-2, valorant, dota-2...). Sin tag que case, no se cruza: un cruce
// laxo entre deportes distintos es peor que ningún cruce.
function pmRowsFor(rows, slugs) {
  return (rows || []).filter((r) => r.tags.some((t) => slugs.includes(t)));
}

// ── ESPN summary (NFL / College): las últimas jugadas y el marcador por cuartos ─────────────────────────
// El scoreboard solo trae LA última jugada; el summary del evento trae el drive en curso con todas. Se
// leen las dos formas conocidas (drives.current.plays en vivo, scoringPlays siempre) a la defensiva.
async function espnSummary(pathLeague, espnId) {
  if (!espnId) return null;
  return memo(`sum:${pathLeague}:${espnId}`, 30e3, async () => {
    const s = await j(`https://site.api.espn.com/apis/site/v2/sports/${pathLeague}/summary?event=${espnId}`);
    if (!s) return null;
    const comp = (((s.header || {}).competitions) || [])[0] || {};
    const lsOf = (ha) => {
      const c = (comp.competitors || []).find((x) => x.homeAway === ha);
      return c ? (c.linescores || []).map((l) => (l.displayValue != null ? +l.displayValue : +l.value || 0)) : [];
    };
    const playRow = (pl) => ({
      t: String(pl.text || '').slice(0, 180) || null,
      clock: (pl.clock && pl.clock.displayValue) || null,
      q: (pl.period && pl.period.number) || null,
      score: pl.awayScore != null && pl.homeScore != null ? `${pl.awayScore}-${pl.homeScore}` : null,
    });
    let plays = [];
    const cur = s.drives && s.drives.current;
    if (cur && Array.isArray(cur.plays)) plays = cur.plays.slice(-6).reverse().map(playRow).filter((x) => x.t);
    const scoring = (s.scoringPlays || []).slice(-4).reverse().map((sp) => ({
      ...playRow(sp), team: (sp.team && (sp.team.abbreviation || sp.team.displayName)) || null,
    })).filter((x) => x.t);
    const drive = cur ? { desc: String(cur.description || '').slice(0, 80) || null,
      team: (cur.team && (cur.team.abbreviation || cur.team.displayName)) || null } : null;
    return { ls_home: lsOf('home'), ls_away: lsOf('away'), plays, scoring, drive };
  });
}

// ── F1 (ESPN racing): sesión en curso + cabeza de carrera ───────────────────────────────────────────────
// Escrito a la defensiva contra la forma conocida del scoreboard de racing (el sandbox no alcanza ESPN;
// se verifica desde producción con la sonda interna el próximo fin de semana de carrera).
async function f1Live() {
  return memo('f1', 60e3, async () => {
    const sb = await j('https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard');
    for (const ev of (sb && sb.events) || []) {
      for (const c of ev.competitions || []) {
        const st = c.status && c.status.type;
        if (!st || st.state !== 'in') continue;
        const rows = (c.competitors || []).slice()
          .sort((x, y) => (+x.order || 99) - (+y.order || 99)).slice(0, 10)
          .map((x) => ({
            pos: +x.order || null,
            name: (x.athlete && (x.athlete.shortName || x.athlete.displayName)) || (x.team && x.team.displayName) || '',
            laps: x.laps != null ? +x.laps : null,
            winner: !!x.winner,
          })).filter((x) => x.name);
        return {
          gp: ev.shortName || ev.name || 'GP', session: (c.type && (c.type.text || c.type.abbreviation)) || '',
          detail: st.shortDetail || st.detail || 'EN VIVO', lap: (c.status && c.status.period) || null,
          leaders: rows,
        };
      }
    }
    return null;
  });
}

// busca un cruce por nombres normalizados en cualquier orden. DOS pasADAS: exacta primero; laxa por
// inclusión ("RedBlacks" vs "Ottawa Redblacks", "N. Djokovic" vs "Novak Djokovic") solo si el candidato
// es ÚNICO — con dos candidatos laxos (Vitality vs "Fut eSports" Y vs "FUT Academy", visto en producción
// el primer minuto) se devuelve nada: sin cruce no hay vivo, jamás un vivo equivocado.
function matchByNames(list, homeName, awayName, keys = ['home', 'away']) {
  const H = norm(homeName), A = norm(awayName);
  if (!H || !A) return null;
  const lax = (x, y) => {
    if (!x || !y) return false;
    if (x === y || x.includes(y) || y.includes(x)) return true;
    // compacto (sin espacios): "intz e sports" ≡ "intz esports" — visto con Polymarket, que escribe
    // los nombres con guiones que norm() vuelve espacios
    const xc = x.replace(/ /g, ''), yc = y.replace(/ /g, '');
    if (xc === yc || xc.includes(yc) || yc.includes(xc)) return true;
    return y.split(' ').pop().length > 3 && x.includes(y.split(' ').pop());
  };
  for (const it of list || []) {
    const h = norm(it[keys[0]]), a = norm(it[keys[1]]);
    if (h === H && a === A) return { ...it, swapped: false };
    if (h === A && a === H) return { ...it, swapped: true };
  }
  const cands = [];
  for (const it of list || []) {
    const h = norm(it[keys[0]]), a = norm(it[keys[1]]);
    if (lax(h, H) && lax(a, A)) cands.push({ ...it, swapped: false });
    else if (lax(h, A) && lax(a, H)) cands.push({ ...it, swapped: true });
  }
  return cands.length === 1 ? cands[0] : null;
}

module.exports = { cflLive, ncaafLive, nflLive, tennisLive, cs2Live, valorantLive, dota2Live, lolLive, pmLive, pmRowsFor, espnSummary, f1Live, matchByNames, norm };
