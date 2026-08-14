// combat-engine/boxing-results.js — RESULTADOS DE BOXEO EN CALIENTE (14-ago).
//
// POR QUÉ EXISTE: el panel "Finalizados" de boxeo estaba SIEMPRE vacío. UFC/MMA liquidan y muestran
// resultados con el scoreboard de ESPN; ESPN NO tiene boxeo (verificado otra vez hoy: sport 'boxing' →
// 400 "Invalid sport"), y la otra vía —el endpoint /scores de The Odds API— depende de créditos que hoy
// están agotados. Resultado: peleas que ya ocurrieron nunca aparecían como disputadas.
//
// FUENTE: Wikipedia, la MISMA que ya alimenta todo el dataset histórico de boxeo
// (scripts/combat-boxing-backfill.js). La tabla de "Professional record" de cada boxeador trae resultado,
// rival, método, round y fecha, y se actualiza en horas tras una pelea relevante (verificado: el KO de
// Sirenko a Wallin del 26-jul ya estaba en la tabla). Este módulo es la versión EN VIVO y acotada de ese
// parser: en vez de recorrer el grafo entero, resuelve UNA pelea concreta (dos nombres + una fecha).
//
// PURO en red y en disco: no toca db, no escribe archivos, no lanza. El server decide a quién preguntar,
// cada cuánto y dónde persiste (ver boxingResultsSync en server.js).
'use strict';

const UA = 'GPSimulador/1.0 (sports research; soporte@gpsimulador.com)';

// Un 429/5xx NO es "no existe" (misma lección del harvest): se reintenta con backoff corto.
async function wiki(params, { timeoutMs = 20000, tries = 3 } = {}) {
  const u = 'https://en.wikipedia.org/w/api.php?' + params + '&format=json&formatversion=2';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1200 * (i + 1))); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      if (j.error) return j.error.code === 'missingtitle' ? null : undefined;
      return j;
    } catch { await new Promise(s => setTimeout(s, 900 * (i + 1))); }
  }
  return undefined; // undefined = fallo transitorio (reintentar luego) · null = no existe
}

// wikitext de una página | null (no existe) | undefined (fallo de red)
async function wikitext(title) {
  const j = await wiki('action=parse&page=' + encodeURIComponent(title) + '&prop=wikitext&redirects=1');
  if (j === undefined) return undefined;
  return j && j.parse ? j.parse.wikitext : null;
}

// Busca la página del boxeador por nombre. Devuelve el título o null. Se usa SOLO para peleadores que no
// están en nuestro índice (las carteleras traen prospectos y boxeo femenino que el harvest no cubrió).
async function searchTitle(name) {
  const j = await wiki('action=query&list=search&srlimit=5&srsearch=' + encodeURIComponent(String(name) + ' boxer'));
  const hits = (j && j.query && j.query.search) || [];
  if (!hits.length) return null;
  const t = toks(name);
  // el candidato tiene que compartir apellido con lo que buscamos (evita traernos "boxing" genéricos)
  const good = hits.find(h => nameMatch(h.title, name)) || null;
  return good ? good.title : (t.length && hits[0] && nameMatch(hits[0].title, name) ? hits[0].title : null);
}

// ---- normalización y match de nombres (MISMA regla que combatPairMatch: ≥2 tokens o apellido exacto) ----
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s) => norm(s).split(' ').filter(Boolean);
const SUFFIX = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);
function nameMatch(a, b) {
  const x = toks(a).filter(t => !SUFFIX.has(t)), y = toks(b).filter(t => !SUFFIX.has(t));
  if (!x.length || !y.length) return false;
  const B = new Set(y); let n = 0; for (const t of new Set(x)) if (B.has(t)) n++;
  return n >= 2 || x[x.length - 1] === y[y.length - 1];
}

// ---- parser de la tabla "Professional record" (mismo del backfill, recortado a lo que se usa) ----
const clean = (w) => String(w || '')
  .replace(/<ref[^>]*\/>/g, ' ').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<br\s*\/?>/gi, ' ');
const delink = (s) => String(s || '').replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1');
const strip = (s) => delink(String(s || ''))
  .replace(/\{\{small\|([^}]*)\}\}/gi, '$1').replace(/\{\{[^{}]*\}\}/g, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/style\s*=\s*"[^"]*"/gi, ' ').replace(/align\s*=\s*"[^"]*"/gi, ' ')
  .replace(/\b(?:align|style|colspan|rowspan|width|bgcolor)\s*=\s*[^\s|]+/gi, ' ')
  .replace(/'''?/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// Una fecha que no ROUND-TRIPEA no es fecha (Wikipedia trae "32 January" y años typo).
function realDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  return isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}
function parseDate(s) {
  const t = strip(s);
  const ymd = (y, mo, d) => (mo ? `${y}-${String(mo).padStart(2, '0')}-${String(+d).padStart(2, '0')}` : null);
  let m, iso = null;
  if ((m = t.match(/(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})/))) iso = ymd(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  else if ((m = t.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/))) iso = ymd(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  else if ((m = t.match(/(\d{4})-(\d{2})-(\d{2})/))) iso = m[0];
  return realDate(iso);
}
// "8 (12), 0:45" → {end:8, sched:12, clock:'0:45'} ; "12" → fue a las tarjetas
function parseRound(s) {
  const t = strip(s);
  const m = t.match(/(\d+)\s*\((\d+)\)(?:\s*,\s*(\d+:\d+))?/);
  if (m) return { end: +m[1], sched: +m[2], clock: m[3] || null };
  const n = t.match(/^(\d+)\s*$/);
  if (n) return { end: +n[1], sched: +n[1], clock: null };
  return { end: null, sched: null, clock: null };
}
const METHOD = (raw) => {
  const t = strip(raw).toUpperCase();
  if (/^UD|^SD|^MD|^PTS|DECISION/.test(t)) return { name: 'decision', display: t.split(' ')[0] || 'Decision' };
  if (/^TKO|RTD|^TD\b/.test(t)) return { name: 'tko', display: t.split(' ')[0] };
  if (/^KO/.test(t)) return { name: 'ko', display: 'KO' };
  if (/^DQ/.test(t)) return { name: 'dq', display: 'DQ' };
  if (/^NC|NO CONTEST/.test(t)) return { name: 'nc', display: 'NC' };
  return null;
};
function parseRecord(w) {
  const txt = clean(w);
  const i = txt.search(/==+\s*Professional (boxing )?record\s*==+/i);
  if (i < 0) return [];
  const seg = txt.slice(i, i + 120000);
  const out = [];
  for (const row of seg.split(/\n\|-/).slice(1)) {
    const body = row.split(/\n\|\}/)[0];
    const cells = body.split(/\n\|/).slice(1).map(c => c.replace(/^\|/, ''));
    if (cells.length < 6) continue;
    const res = strip(cells[1]).toLowerCase();
    const result = /win/.test(res) ? 'win' : /loss/.test(res) ? 'loss' : /draw/.test(res) ? 'draw' : /nc|no contest/.test(res) ? 'nc' : null;
    if (!result) continue;
    const oppName = strip(cells[3]);
    if (!oppName || oppName.length < 3) continue;
    const date = parseDate(cells[6] || '') || parseDate(cells[7] || '');
    if (!date) continue;
    out.push({ result, oppName, method: METHOD(cells[4]), rd: parseRound(cells[5]), date, location: strip(cells[7] || '').slice(0, 90) });
  }
  return out;
}

// resolveBout({ a:{name,wiki}, b:{name,wiki}, date }) → resultado desde la PERSPECTIVA de `a`:
//   { outcome:'a'|'b'|'draw'|'nc', method, end_round, sched_rounds, end_clock, date, location, src }
//   null      = las páginas existen y la pelea NO está (todavía) en el récord → reintentar más tarde
//   undefined = fallo de red / páginas irresolubles → reintentar más tarde (no es información)
// Se consulta la página de `a` y, si ahí no aparece, la de `b` (invirtiendo el resultado). Tolerancia de
// ±3 días: la fecha del feed de cuotas es la del horario local del evento y puede cruzar la medianoche UTC.
async function resolveBout({ a, b, date, tolDays = 3, resolveTitle = null }) {
  const day = String(date || '').slice(0, 10);
  const t0 = Date.parse(day + 'T00:00:00Z');
  if (!isFinite(t0)) return undefined;
  let hardFail = false, sawPage = false;
  const sideOf = async (me, other, flip) => {
    let title = me.wiki || null;
    if (!title && resolveTitle) { try { title = await resolveTitle(me.name); } catch { title = null; } }
    if (!title) return null;
    const w = await wikitext(title);
    if (w === undefined) { hardFail = true; return null; }
    if (!w) return null;
    sawPage = true;
    const rows = parseRecord(w).filter(r => Math.abs(Date.parse(r.date + 'T00:00:00Z') - t0) <= tolDays * 864e5 && nameMatch(r.oppName, other.name));
    if (rows.length !== 1) return null; // 0 = aún no publicada · >1 = ambiguo (nunca se inventa)
    const r = rows[0];
    const outcome = r.result === 'win' ? (flip ? 'b' : 'a') : r.result === 'loss' ? (flip ? 'a' : 'b') : r.result === 'draw' ? 'draw' : 'nc';
    return {
      outcome, method: r.method || null, end_round: r.rd.end || null, sched_rounds: r.rd.sched || null,
      end_clock: r.rd.clock || null, date: r.date, location: r.location || null, src: 'wikipedia:' + title,
    };
  };
  const fromA = await sideOf(a, b, false);
  if (fromA) return fromA;
  const fromB = await sideOf(b, a, true);
  if (fromB) return fromB;
  return (hardFail || !sawPage) ? undefined : null;
}

module.exports = { resolveBout, parseRecord, wikitext, searchTitle, nameMatch, normName: norm };
