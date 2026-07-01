// normalizer.js — convierte data cruda (API-Football / ESPN / manual) a las formas
// Normalized* que consume la UI. Funciones puras, sin red. Toleran campos ausentes.

// ---- estados ----
function normStatus(afShort) {
  // API-Football fixture.status.short
  const live = ['1H', '2H', 'ET', 'BT', 'P', 'LIVE'];
  const half = ['HT'];
  const final = ['FT', 'AET', 'PEN'];
  const post = ['PST'];
  const canc = ['CANC', 'ABD', 'AWD', 'WO'];
  if (half.includes(afShort)) return 'halftime';
  if (live.includes(afShort)) return 'live';
  if (final.includes(afShort)) return 'final';
  if (post.includes(afShort)) return 'postponed';
  if (canc.includes(afShort)) return 'cancelled';
  return 'scheduled';
}

function playerStatusFromReason(reason) {
  const s = String(reason || '').toLowerCase();
  if (/suspend|tarjeta|card|ban/.test(s)) return 'suspended';
  if (/doubt|questionable|duda|test/.test(s)) return 'doubt';
  if (/injur|lesi|knock|strain|hamstring|sprain|fract/.test(s)) return 'injured';
  if (reason) return 'injured';
  return 'unknown';
}

// ---- jugador ----
function normalizePlayer(raw = {}, extra = {}) {
  return {
    id: raw.id != null ? String(raw.id) : (extra.id != null ? String(extra.id) : undefined),
    name: raw.name || extra.name || 'Jugador',
    position: raw.position || extra.position || undefined,
    number: raw.number != null ? raw.number : (extra.number != null ? extra.number : undefined),
    age: raw.age != null ? raw.age : (extra.age != null ? extra.age : undefined),
    club: extra.club || undefined,
    nationality: extra.nationality || undefined,
    status: extra.status || 'available',
    note: extra.note || undefined,
  };
}

// ---- lesión / baja ----
function normalizeInjury(raw = {}, source = 'api') {
  if (source === 'manual') {
    return {
      player: raw.name || raw.player || 'Jugador',
      status: raw.status || playerStatusFromReason(raw.reason),
      reason: raw.reason || raw.note || '',
      source: 'manual',
    };
  }
  return {
    player: (raw.player && raw.player.name) || raw.name || 'Jugador',
    status: playerStatusFromReason(raw.player && raw.player.reason || raw.reason || raw.type),
    reason: (raw.player && raw.player.reason) || raw.reason || raw.type || '',
    source: 'api',
  };
}

// ---- alineación (un equipo) ----
function normalizeLineup(afLineup, confirmed = true) {
  if (!afLineup) return null;
  const mapP = p => normalizePlayer({
    id: p.player && p.player.id, name: p.player && p.player.name,
    number: p.player && p.player.number, position: p.player && p.player.pos,
  });
  return {
    confirmed,
    formation: afLineup.formation || null,
    coach: afLineup.coach && afLineup.coach.name || null,
    startXI: (afLineup.startXI || []).map(x => mapP(x)),
    substitutes: (afLineup.substitutes || []).map(x => mapP(x)),
  };
}

// alineación probable desde manual: { formation, lines:{GK:[],DEF:[],MID:[],FWD:[]} } o lista
function normalizeProjectedLineup(manual) {
  if (!manual) return null;
  const players = [];
  if (manual.lines) {
    for (const [pos, arr] of Object.entries(manual.lines)) {
      (arr || []).forEach(name => players.push(normalizePlayer({ name, position: pos })));
    }
  } else if (Array.isArray(manual.startXI)) {
    manual.startXI.forEach(p => players.push(normalizePlayer(typeof p === 'string' ? { name: p } : p)));
  }
  return { confirmed: false, formation: manual.formation || null, coach: manual.coach || null, startXI: players, substitutes: [] };
}

// ---- alineación desde ESPN (rosters del summary) — fallback cuando API-Football no está (cuota agotada/sin key).
// ESPN roster: { homeAway, formation:'4-2-3-1', roster:[{ starter, jersey, position:{abbreviation}, athlete:{id,displayName} }] }
function normalizeEspnLineup(espnRoster) {
  if (!espnRoster || !Array.isArray(espnRoster.roster) || !espnRoster.roster.length) return null;
  const mapP = (p) => normalizePlayer({
    id: p.athlete && p.athlete.id,
    name: p.athlete && (p.athlete.displayName || p.athlete.fullName || p.athlete.shortName),
    number: p.jersey != null ? p.jersey : (p.athlete && p.athlete.jersey),
    position: (p.position && (p.position.abbreviation || p.position.name)) || (p.athlete && p.athlete.position && (p.athlete.position.abbreviation || p.athlete.position.name)) || null,
  });
  const starters = espnRoster.roster.filter(x => x.starter);
  const subs = espnRoster.roster.filter(x => !x.starter);
  const formation = typeof espnRoster.formation === 'string' ? espnRoster.formation : (espnRoster.formation && (espnRoster.formation.name || espnRoster.formation.abbreviation)) || null;
  if (!starters.length) return null;
  return { confirmed: starters.length >= 11, formation, coach: null, startXI: starters.map(mapP), substitutes: subs.map(mapP) };
}

// ---- evento de partido ----
function normalizeEvent(af = {}) {
  const type = (af.type || '').toLowerCase();
  let kind = 'other';
  if (type === 'goal') kind = 'goal';
  else if (type === 'card') kind = (af.detail || '').toLowerCase().includes('red') ? 'red' : 'yellow';
  else if (type === 'subst') kind = 'subst';
  else if (type === 'var') kind = 'var';
  return {
    minute: af.time ? (af.time.elapsed || 0) + (af.time.extra ? af.time.extra : 0) : null,
    type: kind,
    teamApiId: af.team && af.team.id != null ? String(af.team.id) : null,
    teamName: af.team && af.team.name || null,
    player: af.player && af.player.name || null,
    assist: af.assist && af.assist.name || null,
    detail: af.detail || af.comments || '',
  };
}

// ---- estadísticas de partido (array por equipo de API-Football) ----
const STAT_MAP = {
  'Ball Possession': 'possession',
  'Total Shots': 'shots',
  'Shots on Goal': 'shotsOnTarget',
  'Corner Kicks': 'corners',
  'Fouls': 'fouls',
  'Offsides': 'offsides',
  'Yellow Cards': 'yellowCards',
  'Red Cards': 'redCards',
  'expected_goals': 'xg',
  'Goalkeeper Saves': 'saves',
  'Passes %': 'passAccuracy',
};
function normalizeStatistics(afStatsArr) {
  // afStatsArr: [{ team:{id,name}, statistics:[{type,value}] }, ...]
  if (!Array.isArray(afStatsArr) || !afStatsArr.length) return null;
  const out = {};
  for (const teamBlock of afStatsArr) {
    const tid = teamBlock.team && String(teamBlock.team.id);
    const m = {};
    for (const s of teamBlock.statistics || []) {
      const key = STAT_MAP[s.type];
      if (key) m[key] = s.value;
    }
    if (tid) out[tid] = m;
  }
  return out;
}

// ---- forma reciente desde fixtures de API-Football ----
function normalizeTeamForm(afFixtures, teamApiId, n = 5) {
  if (!Array.isArray(afFixtures) || !afFixtures.length) return null;
  const tid = Number(teamApiId);
  const done = afFixtures
    .filter(f => f.fixture && ['FT', 'AET', 'PEN'].includes(f.fixture.status.short))
    .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date))
    .slice(0, n);
  if (!done.length) return null;
  let gf = 0, ga = 0, cs = 0;
  const results = [], last = [];
  for (const f of done) {
    const isHome = f.teams.home.id === tid;
    const my = isHome ? f.goals.home : f.goals.away;
    const opp = isHome ? f.goals.away : f.goals.home;
    const oppTeam = isHome ? f.teams.away : f.teams.home;
    gf += my || 0; ga += opp || 0;
    if ((opp || 0) === 0) cs++;
    const res = my > opp ? 'W' : my < opp ? 'L' : 'D';
    results.push(res);
    last.push({ opponent: oppTeam && oppTeam.name, score: `${my}-${opp}`, result: res, home: isHome, date: f.fixture.date });
  }
  const pts = results.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0);
  return {
    results, points: pts, played: results.length,
    goalsFor: gf, goalsAgainst: ga, cleanSheets: cs,
    avgFor: +(gf / results.length).toFixed(2), avgAgainst: +(ga / results.length).toFixed(2),
    streak: streakOf(results), last,
  };
}
function streakOf(results) {
  if (!results.length) return '';
  const r0 = results[0]; let c = 0;
  for (const r of results) { if (r === r0) c++; else break; }
  return `${c}${r0}`;
}

// forma reciente desde manual fallback (ya casi normalizada)
function normalizeTeamFormManual(manual) {
  if (!manual) return null;
  const results = manual.results || [];
  return {
    results,
    points: manual.points != null ? manual.points : results.reduce((s, r) => s + (r === 'W' ? 3 : r === 'D' ? 1 : 0), 0),
    played: results.length,
    goalsFor: manual.goalsFor || 0, goalsAgainst: manual.goalsAgainst || 0,
    cleanSheets: manual.cleanSheets || 0,
    avgFor: manual.avgFor || 0, avgAgainst: manual.avgAgainst || 0,
    streak: manual.streak || (results.length ? streakOf(results) : ''),
    last: manual.last || [],
  };
}

// ---- partido básico (para schedule/results) ----
function normalizeMatchBasic(af = {}, teamApiId) {
  if (!af.fixture) return null;
  const tid = Number(teamApiId);
  const isHome = af.teams && af.teams.home.id === tid;
  return {
    apiId: String(af.fixture.id),
    date: af.fixture.date,
    status: normStatus(af.fixture.status.short),
    homeName: af.teams && af.teams.home.name,
    awayName: af.teams && af.teams.away.name,
    homeGoals: af.goals ? af.goals.home : null,
    awayGoals: af.goals ? af.goals.away : null,
    opponent: af.teams ? (isHome ? af.teams.away.name : af.teams.home.name) : null,
    home: isHome,
    venue: af.fixture.venue && af.fixture.venue.name || null,
  };
}

// ---- noticia (ESPN article) ----
function normalizeNews(article = {}) {
  return {
    title: article.headline || article.title || '',
    summary: article.description || '',
    published: article.published || article.lastModified || null,
    source: 'ESPN',
    url: (article.links && article.links.web && article.links.web.href) || null,
  };
}

module.exports = {
  normStatus, playerStatusFromReason,
  normalizePlayer, normalizeInjury, normalizeLineup, normalizeProjectedLineup, normalizeEspnLineup,
  normalizeEvent, normalizeStatistics, normalizeTeamForm, normalizeTeamFormManual,
  normalizeMatchBasic, normalizeNews,
};
