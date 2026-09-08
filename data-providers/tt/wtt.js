// data-providers/tt/wtt.js — LA FUENTE OFICIAL DEL TENIS DE MESA: World Table Tennis (WTT) + puerta ITTF
//
// Todo lo que el sitio worldtabletennis.com consume, leído con sus propias claves públicas de cliente (van
// embebidas en su bundle; no hay contrato → ver data/tt/RIGHTS.md). Cuatro dominios, comprobados 8-sep-2026:
//   · CMS (`primary/api/cms/`): eventos con fechas y sedes (GetAllLiveOrActiveEvents), agenda por evento
//     (GetEventSchedule/{id}: unidades con código de documento, hora LOCAL, jugadores con IttfId, país,
//     cabeza de serie y fecha de nacimiento), retratos (GetAllPlayerProfilePics), ficha (PlayerCard/{id}).
//   · SCORE (`liveeventsapi/api/cms/`): resultado oficial con match card (GetOfficialResult_Minimal:
//     al mejor de N, puntos por game, tiempos muertos, duración, hora UTC).
//   · LIVE (`wtt-web-frontdoor-withoutcache…/`): ids de partidos en juego y su match card en vivo.
//   · ITTF (`wttcmsapigateway-new…/ttu/`): ranking semanal (1.500 por categoría) e HISTORIAL COMPLETO de
//     partidos por jugador con los puntos de cada game (2012 →) — la base del rating a nivel de punto.
// Los nombres oficiales van "FAMILIA Nombre" (WANG Chuqin) o al revés; la familia es el token en mayúsculas.
// En el sandbox de desarrollo `fetch` no atraviesa el proxy: con GP_FETCH_VIA_CURL=1 se usa curl.
'use strict';

const API = 'https://wtt-website-api-vm-frontdoor-hhaec5epbhdyfugz.a01.azurefd.net/primary/api/';
const SCORE = 'https://wtt-website-api-vm-frontdoor-hhaec5epbhdyfugz.a01.azurefd.net/liveeventsapi/api/';
const LIVE = 'https://wtt-web-frontdoor-withoutcache-cqakg0andqf5hchn.a01.azurefd.net/';
const ITTF = 'https://wttcmsapigateway-new.azure-api.net/ttu/';
const HEAD = {
  ApiKey: process.env.WTT_API_KEY || '2bf8b222-532c-4c60-8ebe-eb6fdfebe84a',
  secapimkey: process.env.WTT_SEC_KEY || 'S_WTT_882jjh7basdj91834783mds8j2jsd81',
  Referer: 'https://www.worldtabletennis.com/', Origin: 'https://www.worldtabletennis.com',
  accept: 'application/json', 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36 GP-Simulador/1.0',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIA_CURL = process.env.GP_FETCH_VIA_CURL === '1';

async function getJson(url, { timeoutMs = 25000, tries = 2, headers = HEAD } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      if (VIA_CURL) {
        const { execFile } = require('child_process');
        const args = ['-s', '-m', String(Math.ceil(timeoutMs / 1000)), '--compressed', '-w', '\n%{http_code}', url];
        for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
        const txt = await new Promise((res, rej) => execFile('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (e, out) => (e ? rej(e) : res(out))));
        const nl = txt.lastIndexOf('\n'); const code = +txt.slice(nl + 1); const body = txt.slice(0, nl);
        if (code === 429 || code >= 500) { await sleep(1500 * (i + 1)); continue; }
        if (code === 204 || code === 404) return null;
        if (code !== 200) return null;
        return body ? JSON.parse(body.replace(/^﻿/, '')) : null;
      }
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      if (r.status === 204 || r.status === 404) return null;
      if (!r.ok) return null;
      const txt = await r.text();
      return txt ? JSON.parse(txt.replace(/^﻿/, '')) : null;
    } catch { await sleep(800 * (i + 1)); }
  }
  return null;
}

// ── NOMBRES ─────────────────────────────────────────────────────────────────────────────────────────────
// "WANG Chuqin" / "Chuqin WANG" / "SZOCS Bernadette Cynthia" → { family: 'Wang', given: 'Chuqin', name: 'Chuqin Wang' }
const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-'])([a-zà-ÿ])/g, (m, a, b) => a + b.toUpperCase());
function parseName(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return { family: '', given: '', name: '' };
  const toks = s.split(' ');
  const fam = toks.filter((t) => t.length > 1 && t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t));
  const giv = toks.filter((t) => !fam.includes(t));
  if (!fam.length) { // sin mayúsculas: último token como familia
    const f = toks[toks.length - 1]; return { family: title(f), given: toks.slice(0, -1).join(' '), name: s };
  }
  const family = title(fam.join(' ')), given = giv.join(' ');
  return { family, given, name: (given ? given + ' ' : '') + family };
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// ── ZONA HORARIA DE LA SEDE (la agenda de la WTT viene en hora LOCAL sin desplazamiento) ─────────────────
// Base + regla de horario de verano por región. El match card oficial (hora local y UTC a la vez) certifica
// el desplazamiento exacto del evento en cuanto termina el primer partido; hasta entonces vale la tabla.
const TZ = { CHN: [480], MAC: [480], HKG: [480], TPE: [480], PHI: [480], SGP: [480], MAS: [480], MGL: [480], AUS: [600, 'au'], NZL: [720, 'nz'],
  JPN: [540], KOR: [540], PRK: [540], THA: [420], VIE: [420], IDN: [420], CAM: [420], LAO: [420], IND: [330], SRI: [330], NEP: [345], BAN: [360], KAZ: [300], UZB: [300], PAK: [300], KGZ: [360], TKM: [300], TJK: [300],
  QAT: [180], BRN: [180], KSA: [180], SAU: [180], KUW: [180], JOR: [180], IRQ: [180], TUR: [180], UAE: [240], OMA: [240], GEO: [240], ARM: [240], AZE: [240], IRI: [210], ISR: [120, 'eu'], CYP: [120, 'eu'], LBN: [120, 'eu'],
  EGY: [120, 'eg'], TUN: [60], ALG: [60], MAR: [60], NGR: [60], CMR: [60], RSA: [120], BOT: [120], MOZ: [120], ZAM: [120], ZIM: [120], KEN: [180], ETH: [180], UGA: [180], TAN: [180], SEN: [0], CIV: [0], GHA: [0], MRI: [240],
  BUL: [120, 'eu'], ROU: [120, 'eu'], GRE: [120, 'eu'], UKR: [120, 'eu'], FIN: [120, 'eu'], LTU: [120, 'eu'], LAT: [120, 'eu'], EST: [120, 'eu'], MDA: [120, 'eu'], BLR: [180], RUS: [180],
  GER: [60, 'eu'], FRA: [60, 'eu'], ESP: [60, 'eu'], ITA: [60, 'eu'], AUT: [60, 'eu'], CZE: [60, 'eu'], POL: [60, 'eu'], HUN: [60, 'eu'], SVK: [60, 'eu'], SLO: [60, 'eu'], CRO: [60, 'eu'], SRB: [60, 'eu'], BIH: [60, 'eu'], MKD: [60, 'eu'], ALB: [60, 'eu'], MNE: [60, 'eu'], KOS: [60, 'eu'],
  SWE: [60, 'eu'], NOR: [60, 'eu'], DEN: [60, 'eu'], NED: [60, 'eu'], BEL: [60, 'eu'], SUI: [60, 'eu'], LUX: [60, 'eu'], MLT: [60, 'eu'], LIE: [60, 'eu'], MON: [60, 'eu'], GBR: [0, 'eu'], POR: [0, 'eu'], IRL: [0, 'eu'], ISL: [0],
  USA: [-300, 'us'], CAN: [-300, 'us'], MEX: [-360], CUB: [-300, 'us'], DOM: [-240], PUR: [-240], PAN: [-300], CRC: [-360], GUA: [-360], ESA: [-360], HON: [-360], NCA: [-360], JAM: [-300], TTO: [-240],
  BRA: [-180], ARG: [-180], URU: [-180], CHI: [-240, 'cl'], PER: [-300], COL: [-300], ECU: [-300], VEN: [-240], BOL: [-240], PAR: [-240, 'py'] };
// ciudades de EE. UU. fuera del este
const US_CITY = [[/houston|dallas|austin|chicago|minneapolis|kansas|omaha|new orleans|memphis|nashville|milwaukee|san antonio|oklahoma/i, -360], [/denver|salt lake|phoenix|boise|albuquerque/i, -420], [/san francisco|los angeles|fremont|spokane|seattle|portland|las vegas|san jose|sacramento|san diego/i, -480], [/honolulu/i, -600]];
function dstOn(rule, t) {
  const y = t.getUTCFullYear();
  const nthSun = (m, n) => { const d = new Date(Date.UTC(y, m, 1)); const first = (7 - d.getUTCDay()) % 7 + 1; return Date.UTC(y, m, first + 7 * (n - 1)); };
  const lastSun = (m) => { const d = new Date(Date.UTC(y, m + 1, 0)); return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay()); };
  const x = t.getTime();
  switch (rule) {
    case 'eu': return x >= lastSun(2) + 3600e3 && x < lastSun(9) + 3600e3;
    case 'us': return x >= nthSun(2, 2) + 7 * 3600e3 && x < nthSun(10, 1) + 6 * 3600e3;
    case 'eg': return x >= lastSun(3) && x < lastSun(9);           // Egipto (desde 2023): último viernes de abril → último jueves de octubre ≈
    case 'cl': return !(x >= nthSun(3, 1) && x < nthSun(8, 1));  // Chile: verano salvo abril→septiembre
    case 'py': return !(x >= nthSun(2, 4) && x < nthSun(9, 1));
    case 'au': return !(x >= nthSun(3, 1) && x < nthSun(9, 1));  // Victoria/NSW: verano salvo abril→octubre
    case 'nz': return !(x >= nthSun(3, 1) && x < lastSun(8));
    default: return false;
  }
}
// desplazamiento en minutos de la sede en el instante t
function tzOffsetMin(countryCode, city, t) {
  const e = TZ[String(countryCode || '').toUpperCase()];
  if (!e) return null;
  let base = e[0];
  if (countryCode === 'USA' && city) { const hit = US_CITY.find(([re]) => re.test(city)); if (hit) base = hit[1]; }
  return base + (e[1] && dstOn(e[1], t || new Date()) ? 60 : 0);
}
// "2026-09-08T20:05:00" local + desplazamiento → ISO UTC
function localToUtc(localIso, offsetMin) {
  const m = String(localIso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m || offsetMin == null) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - offsetMin * 60e3).toISOString();
}
// "09/08/2026 17:05:00" (MM/DD/YYYY) → ISO
function usDate(s) { const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})/); return m ? new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6])).toISOString() : null; }

// ── EVENTOS ─────────────────────────────────────────────────────────────────────────────────────────────
let evMemo = { at: 0, rows: [] };
function normEvent(e) {
  let subs = [];
  try { subs = JSON.parse(e.subEvents || '[]').map((s) => ({ id: s.subEventId, code: s.subEventCode, name: s.subEventName, gender: s.gender })); } catch { /* sin subeventos */ }
  return { id: String(e.eventId), name: String(e.eventName || '').trim(), tier_name: e.event_Tier_name || null, start: e.startDateTime ? String(e.startDateTime).slice(0, 10) : null, end: e.endDateTime ? String(e.endDateTime).slice(0, 10) : null,
    city: e.city || null, country: e.countryCode || null, country_name: e.countryName || null, venue: e.venueName || null, logo: e.logo || null, bg: e.backgroundImage || null, color: e.event_Color_Code || null, status: e.status || null, sub_events: subs, youth: /youth/i.test(String(e.event_Tier_name || '') + ' ' + String(e.eventName || '')) };
}
async function events({ force = false, ttlMs = 6 * 3600e3 } = {}) {
  if (!force && evMemo.rows.length && Date.now() - evMemo.at < ttlMs) return evMemo.rows;
  const j = await getJson(API + 'cms/GetAllLiveOrActiveEvents');
  const arr = Array.isArray(j) ? j : (j && j.Result) || null;
  if (!arr) return evMemo.rows;
  evMemo = { at: Date.now(), rows: arr.map(normEvent) };
  return evMemo.rows;
}
async function eventById(id) { const ev = await events(); return ev.find((e) => e.id === String(id)) || null; }

// ── AGENDA DE UN EVENTO ─────────────────────────────────────────────────────────────────────────────────
const subOfCode = (code) => { const m = String(code || '').match(/^TTE([MWX])(SINGLES|DOUBLES|TEAM)/); if (!m) return null; return (m[1] === 'X' ? 'X' : m[1]) + (m[2] === 'SINGLES' ? 'S' : m[2] === 'DOUBLES' ? 'D' : 'T'); };
const schMemo = new Map();
async function schedule(eventId, { ttlMs = 150e3, force = false } = {}) {
  const k = String(eventId);
  const c = schMemo.get(k);
  if (c && !force && Date.now() - c.at < ttlMs) return c.rows;
  const j = await getJson(API + 'cms/GetEventSchedule/' + encodeURIComponent(k));
  const blocks = Array.isArray(j) ? j : [];
  const rows = [];
  for (const b of blocks) for (const u of ((b.Competition || {}).Unit || [])) {
    const code = String(u.Code || '').trim();
    const starts = ((u.StartList || {}).Start || []).slice().sort((x, y) => (x.StartOrder || 0) - (y.StartOrder || 0));
    const side = (st) => {
      const c2 = (st && st.Competitor) || {}; const ath = (((c2.Composition || {}).Athlete) || [])[0] || {}; const d = ath.Description || {};
      const nm = parseName((c2.Description || {}).TeamName || (d.FamilyName ? d.FamilyName + ' ' + (d.GivenName || '') : ''));
      return { id: String(c2.Code || (c2.Description || {}).IfId || ath.Code || '') || null, name: nm.name, family: nm.family, given: nm.given, country: c2.Organization || d.Organization || null, seed: c2.Seed != null ? +c2.Seed : null, qualifier: !!c2.Qualifier, dob: d.BirthDate ? String(d.BirthDate).slice(0, 10) : null, gender: d.Gender || null, type: c2.Type || null, team: (c2.Description || {}).TeamName || null };
    };
    rows.push({ event_id: k, code, id: `${k}:${code}`, sub: subOfCode(code), sub_name: u.SubEvent || null, category: u.EventCategory || null, round_code: u.Round || null, draw: u.Draw || null,
      label: (((u.ItemDescription || [])[0] || {}).Value) || (((u.ItemName || [])[0] || {}).Value) || null, table: u.Location || null, table_name: ((u.VenueDescription || {}).LocationName) || null, venue: ((u.VenueDescription || {}).VenueName) || null,
      status: u.ScheduleStatus || null, start_local: u.StartDate || null, end_local: u.EndDate || null, actual_start: u.ActualStartDate || null, actual_end: u.ActualEndDate || null,
      a: side(starts[0]), b: side(starts[1]), n_players: starts.length });
  }
  schMemo.set(k, { at: Date.now(), rows });
  return rows;
}

// ── RESULTADO OFICIAL / MATCH CARD ──────────────────────────────────────────────────────────────────────
function normCard(mc, { live = false } = {}) {
  if (!mc) return null;
  const comps = mc.competitiors || mc.competitors || [];
  const H = comps.find((c) => c.competitorType === 'H') || comps[0] || {}, A = comps.find((c) => c.competitorType === 'A') || comps[1] || {};
  const games = String(mc.resultsGameScores || mc.gameScores || '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const m = s.match(/^(\d+)\s*-\s*(\d+)$/); return m ? [+m[1], +m[2]] : null; }).filter(Boolean);
  const played = games.filter(([h, a], i) => h + a > 0 && !(live && i === games.length - 1 && false));
  const ov = String(mc.resultOverallScores || mc.overallScores || '').match(/^(\d+)\s*-\s*(\d+)$/);
  const cfg = mc.matchConfig || {};
  const dur = String(((mc.matchDateTime || {}).duration) || '').match(/^(\d+):(\d+):(\d+)$/);
  const st = String(mc.resultStatus || mc.fullResults || '').toUpperCase();
  const status = st === 'OFFICIAL' || st === 'UNOFFICIAL' ? 'final' : live || st === 'RUNNING' || st === 'LIVE' ? 'live' : 'unknown';
  const server = (mc.action || {}).serverPlayer ? String(mc.action.serverPlayer) : null;
  return {
    status, best_of: cfg.bestOfXGames != null ? +cfg.bestOfXGames : null, points_per_game: cfg.maxPointsPerGame != null ? +cfg.maxPointsPerGame : 11,
    h: { id: String(H.competitiorId || H.competitorId || ''), name: parseName(H.competitiorName || H.competitorName).name, org: H.competitiorOrg || H.competitorOrg || null, timeouts: +H.compTimeout || 0, cards: { y: +H.compCardY || 0, yr1: +H.compCardYR1 || 0, yr2: +H.compCardYR2 || 0 } },
    a: { id: String(A.competitiorId || A.competitorId || ''), name: parseName(A.competitiorName || A.competitorName).name, org: A.competitiorOrg || A.competitorOrg || null, timeouts: +A.compTimeout || 0, cards: { y: +A.compCardY || 0, yr1: +A.compCardYR1 || 0, yr2: +A.compCardYR2 || 0 } },
    games: played, score_h: ov ? +ov[1] : played.filter(([h, a]) => h > a && (h >= 11 && h - a >= 2)).length, score_a: ov ? +ov[2] : played.filter(([h, a]) => a > h && (a >= 11 && a - h >= 2)).length,
    current_game: mc.currentGameNumber != null ? +mc.currentGameNumber : null, server_id: server, server_side: server ? (server === String(H.competitiorId || H.competitorId) ? 'h' : server === String(A.competitiorId || A.competitorId) ? 'a' : null) : null,
    duration_min: dur ? +dur[1] * 60 + +dur[2] + +dur[3] / 60 : null, start_utc: usDate((mc.matchDateTime || {}).startDateUTC), start_local: (mc.matchDateTime || {}).startDateLocal || null,
    table: mc.tableName || mc.tableNumber || null, venue: mc.venueName || null, seq: mc.playByPlaySequenceNumber != null ? +mc.playByPlaySequenceNumber : null,
  };
}
async function officialResult(eventId, code) {
  const j = await getJson(`${SCORE}cms/GetOfficialResult_Minimal?EventId=${encodeURIComponent(eventId)}&DocumentCode=${encodeURIComponent(code)}&include_match_card=true`);
  const row = Array.isArray(j) ? j[0] : j && j.match_card ? j : null;
  if (!row) return null;
  const out = normCard(row.match_card || row);
  if (out) { out.document_code = row.documentCode || code; out.event_id = String(row.eventId || eventId); out.full_results = row.fullResults || null; }
  return out;
}
// partidos en juego ahora en un evento: [{eventId, documentCode, subEventType}]
async function liveIds(eventId) {
  const q = new Date(1e4 * Math.floor(Date.now() / 1e4)).toJSON();
  const j = await getJson(`${LIVE}websitestaticapifiles/running-events/${encodeURIComponent(eventId)}/${encodeURIComponent(eventId)}_livematchids.json?q=${q}`, { headers: { accept: 'application/json', 'user-agent': HEAD['user-agent'] } });
  return (Array.isArray(j) ? j : []).map((x) => ({ event_id: String(x.e || x.eventId || eventId), code: x.d || x.documentCode, sub: x.s || x.subEventType || null }));
}
async function liveCard(eventId, code) {
  const q = new Date(5e3 * Math.floor(Date.now() / 5e3)).toJSON();
  const j = await getJson(`${LIVE}matchdata/${encodeURIComponent(eventId)}/${encodeURIComponent(code)}.json?q=${q}`, { headers: { accept: 'application/json', 'user-agent': HEAD['user-agent'] }, timeoutMs: 8000, tries: 1 });
  if (!j) return null;
  const mc = j.match_card || j;
  const out = normCard(mc, { live: true });
  if (out) { out.document_code = code; out.event_id = String(eventId); out.raw_points = mc.competitiors ? mc.competitiors.map((c) => c.scores) : null; }
  return out;
}

// ── RETRATOS · RANKING · HISTORIAL · FICHA ───────────────────────────────────────────────────────────────
let phMemo = { at: 0, map: null };
async function photos({ force = false } = {}) {
  if (!force && phMemo.map && Date.now() - phMemo.at < 24 * 3600e3) return phMemo.map;
  const j = await getJson(API + 'cms/GetAllPlayerProfilePics');
  const arr = Array.isArray(j) ? j : (j && j.Result) || [];
  if (!arr.length) return phMemo.map || new Map();
  const map = new Map(); for (const p of arr) if (p.ittfid != null && p.headShot) map.set(String(p.ittfid), String(p.headShot));
  phMemo = { at: Date.now(), map };
  return map;
}
async function rankings(sub = 'MS', { topN = 1500 } = {}) {
  const j = await getJson(`${ITTF}internalttu/RankingsCurrentWeek/CurrentWeek/GetRankingIndividuals?TopN=${topN}&CategoryCode=SEN&SubEventCode=${sub}`);
  const arr = (j && j.Result) || (Array.isArray(j) ? j : []);
  return arr.map((r) => ({ id: String(r.IttfId), ...parseName(r.PlayerName), country: r.CountryCode || null, country_name: r.CountryName || null, sub, gender: sub === 'WS' ? 'W' : 'M', rank: +r.RankingPosition || +r.CurrentRank || null, prev_rank: r.PreviousRank != null ? +r.PreviousRank : null, points: r.RankingPointsYTD != null ? +r.RankingPointsYTD : null, week: r.RankingWeek || null, year: r.RankingYear || null, published: r.PublishDate || null }));
}
async function history(ittfId) {
  const j = await getJson(`${ITTF}Matches/GetRankingHistoryMatchesIndividuals?IttfId=${encodeURIComponent(ittfId)}&CategoryCode=SEN`, { timeoutMs: 90000 });
  return (j && j.Result) || (Array.isArray(j) ? j : null);
}
async function playerCard(ittfId) {
  const j = await getJson(API + 'cms/PlayerCard/' + encodeURIComponent(ittfId));
  const r = Array.isArray(j) ? j[0] : j;
  if (!r) return null;
  return { id: String(ittfId), hand: r.playingHand || r.hand || r.PlayingHand || null, grip: r.grip || r.Grip || r.gripStyle || null, style: r.playingStyle || r.style || r.PlayingStyle || null, dob: r.dob || r.birthDate || r.DateOfBirth || null, raw_keys: Object.keys(r).slice(0, 40) };
}

module.exports = { API, SCORE, LIVE, ITTF, HEAD, getJson, parseName, norm, title, tzOffsetMin, localToUtc, usDate, events, eventById, schedule, subOfCode, officialResult, normCard, liveIds, liveCard, photos, rankings, history, playerCard };
