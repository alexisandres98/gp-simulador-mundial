// data-providers/darts/pdc.js — LA API PÚBLICA DE LA PDC (torneos, fixtures, participantes, rankings)
//
// pdc.tv sirve su web desde una API JSON abierta (sin clave) en *.darts.web.gc.pdcservices.co.uk/v2/. Es la
// fuente OFICIAL de calendario, formato POR RONDA (sets, legs por set, dos legs de diferencia), resultados
// con legs y participantes con país/fecha de nacimiento/foto. NO publica estadística de partido (medias,
// 180s): eso viene de otra fuente (orakel.js). Derechos: dato público del organizador sin licencia escrita
// → display con atribución y uso interno de investigación; admin-only mientras no haya acuerdo (RIGHTS.md).
//
// Comprobado el 6-sep-2026 desde el sandbox: tournaments (224 en 2026), fixtures (24k en 2026, 293k total,
// filtrables solo por seasonID), participants (18.467), rankings (2YEAR = Order of Merit).
'use strict';

const HOST = (svc) => `https://${svc}.darts.web.gc.pdcservices.co.uk/v2/`;
const UA = 'curl/8.5.0';

async function getJson(url, { timeoutMs = 25000, retries = 2 } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 || r.status >= 500) { last = new Error(`HTTP ${r.status}`); await sleep(1500 * (i + 1)); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { last = e; await sleep(800 * (i + 1)); }
  }
  throw last || new Error('pdc: sin respuesta');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const attrs = (x) => (x && x.attributes ? { id: x.id, ...x.attributes } : x);

// ── TORNEOS DE UNA TEMPORADA (lista, sin stages) ─────────────────────────────────────────────────────────
async function tournaments(seasonID, { pageSize = 100, maxPages = 5 } = {}) {
  const out = [];
  for (let p = 1; p <= maxPages; p++) {
    const j = await getJson(`${HOST('tournaments')}?page.size=${pageSize}&seasonID=${seasonID}&page.number=${p}`);
    const rows = (j.data || []).map(attrs);
    out.push(...rows);
    if (!j.links || !j.links.next || rows.length < pageSize) break;
  }
  return out;
}
// ── DETALLE DE UN TORNEO: stages con FORMATO y sus fixtures (resultados incluidos) ───────────────────────
async function tournament(id) {
  const j = await getJson(`${HOST('tournaments')}${encodeURIComponent(id)}`);
  return attrs(j.data || j);
}
// ── FIXTURES DE UNA TEMPORADA (paginado, los más recientes primero) ──────────────────────────────────────
async function fixtures(seasonID, { pageSize = 100, page = 1 } = {}) {
  const j = await getJson(`${HOST('fixtures')}?page.size=${pageSize}&seasonID=${seasonID}&page.number=${page}`);
  return { rows: (j.data || []).map(attrs), total: (j.meta || {}).totalCount || 0, next: !!(j.links && j.links.next) };
}
// ── PARTICIPANTE ─────────────────────────────────────────────────────────────────────────────────────────
async function participant(id) {
  const j = await getJson(`${HOST('participants')}${encodeURIComponent(id)}`);
  return attrs(j.data || j);
}
// ── RANKINGS (2YEAR = Order of Merit; 1YEAR = ProTour; ET2026, PC2026, WSoD2026, Women2026…) ────────────
async function ranking(key = '2YEAR') {
  const j = await getJson(`${HOST('rankings')}${encodeURIComponent(key)}`);
  return attrs(j.data || j);
}
async function rankings() {
  const j = await getJson(`${HOST('rankings')}`);
  return (j.data || []).map(attrs);
}

// las imágenes del CDN de la PDC (logos de torneo, retratos de participante)
const IMG = (file) => (file ? `https://images.gc.pdcservices.co.uk/${file}` : null);

// normaliza un fixture del detalle de torneo o del listado a la forma de la casa
function normFixture(f, tour, stage) {
  const p1 = f.participant1 || {}, p2 = f.participant2 || {};
  const name = (p) => [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || null;
  const t = f.startTime ? String(f.startTime).slice(0, 8) : null;
  const startAt = f.startDate ? `${f.startDate}T${t || '12:00:00'}Z` : null;
  return {
    id: String(f.fixtureID || f.id),
    tournament_id: String((tour && (tour.tournamentID || tour.id)) || f.tournamentID || ''),
    tournament: (tour && tour.name) || (f.tournament && f.tournament.name) || null,
    stage: (stage && stage.stage && stage.stage.name) || (f.stage && f.stage.name) || null,
    format: stage ? { sets: stage.numberOfSets, legs_per_set: stage.numberOfLegsPerSet, two_clear: !!stage.twoClearLegsToWin } : null,
    status: f.status, start_at: startAt, board: f.dartBoardName || null,
    a: { id: p1.participantID ? String(p1.participantID) : null, name: name(p1), country: p1.countryCode || null },
    b: { id: p2.participantID ? String(p2.participantID) : null, name: name(p2), country: p2.countryCode || null },
    score_a: f.participant1Score, score_b: f.participant2Score,
    winner_id: f.winnerParticipantID ? String(f.winnerParticipantID) : null,
    sportradar_id: f.sportRadarID || null,
    televised: !!(tour && tour.isTelevised), ranked: !!(tour && tour.isRanked),
    type_id: (tour && tour.tournamentTypeID) || null, category_id: (tour && tour.tournamentCategoryID) || null,
  };
}

// CATEGORÍAS (IDs observados en 2026): 2 = televisado/major (WSoD Finals), 4 = Europeo/ProTour de escenario,
// 5 = Q-School/Challenge/Development, 6 = otros. El nombre de tipo viene en el listado de fixtures
// (`type.name`, `category.name`); aquí se conserva el ID y se etiqueta en la construcción de la base.
const CATEGORY_LABEL = { 2: 'major', 3: 'premier', 4: 'protour', 5: 'secondary', 6: 'other' };

module.exports = { HOST, tournaments, tournament, fixtures, participant, ranking, rankings, normFixture, IMG, CATEGORY_LABEL, getJson };
