#!/usr/bin/env node
/**
 * BACKFILL DE PESAJES (#1, 29-jul) — el dato que ninguna de nuestras fuentes tenía.
 *
 * Ni ESPN ni api-sports publican el pesaje oficial por pelea. Wikipedia SÍ lo registra, y de forma
 * consistente, en la sección de cada evento:
 *   "At the weigh-ins, Ramon Taveras and Malcolm Gordon missed weight. Taveras weighed in at 139.75
 *    pounds, three and three quarters pounds over the bantamweight non-title fight limit."
 * De ahí salen: quién falló, con cuánto peso y cuánto por encima del límite.
 *
 * IMPORTANTE sobre los ceros: un evento sin menciones NO es data faltante — es que nadie falló el peso.
 * Eso hace que el dataset sea utilizable para backtest (ausencia = negativo, no = desconocido), siempre
 * que la página del evento exista. Se distingue `no_page` (desconocido) de `clean` (nadie falló).
 *
 * Uso:  node scripts/combat-weighins-backfill.js [--org=ufc] [--limit=N] [--sleep=ms]
 * Salida: data/combat/weighins-<org>.json
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const ORG = args.org || 'ufc';
const SLEEP = +args.sleep || 220;          // educado con Wikipedia
const LIMIT = args.limit ? +args.limit : Infinity;
const OUT = path.join(__dirname, '..', 'data', 'combat', `weighins-${ORG}.json`);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// "three and three quarters" → 3.75 (Wikipedia escribe las fracciones en letras)
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, quarter: 0.25, quarters: 0.25, halves: 0.5 };
function wordsToNum(s) {
  const t = norm(s).split(' ').filter(Boolean);
  let whole = 0, frac = 0, pendingFrac = null;
  for (let i = 0; i < t.length; i++) {
    const w = t[i];
    if (w === 'and') continue;
    if (WORD_NUM[w] == null) continue;
    if (w === 'half' || w === 'halves' || w === 'quarter' || w === 'quarters') {
      frac += (pendingFrac || 1) * WORD_NUM[w]; pendingFrac = null;
    } else {
      // "three quarters" → el 3 multiplica al quarter siguiente
      if (t[i + 1] && /quarter|half/.test(t[i + 1])) pendingFrac = WORD_NUM[w];
      else whole += WORD_NUM[w];
    }
  }
  const v = whole + frac;
  return v > 0 ? v : null;
}

// el regex del nombre puede arrastrar texto de la frase anterior ("...missed weight. Taveras"):
// se recorta todo lo que venga hasta una palabra-frontera típica de estas narrativas. Respeta "C.J. Vergara".
function cleanName(s) {
  return String(s || '').replace(/^.*\b(?:weight|weights|limit|fight|bout|ins?|weigh-ins?)\.?\s+/i, '').trim();
}
function cleanWiki(w) {
  return String(w || '')
    .replace(/<ref[^>]*\/>/g, ' ')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, ' ')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')   // [[Page|Texto]] → Texto
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\s+/g, ' ');
}

// extrae {name, lbs, over} de la narrativa de pesajes
function parseWeighIns(text) {
  const out = [];
  const t = cleanWiki(text);
  // (a) "X weighed in at 139.75 pounds, three and three quarters pounds over the ... limit"
  const re = /([A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+){0,3})\s+weighed in at\s+([\d.]+)\s*(?:pounds|lbs)[^.]{0,140}?([\w\s-]+?)\s*(?:pounds|lbs)?\s+over the/gi;
  let m;
  while ((m = re.exec(t))) {
    const over = /^[\d.]+$/.test(m[3].trim()) ? +m[3].trim() : wordsToNum(m[3]);
    out.push({ name: cleanName(m[1]), lbs: +m[2], over: over != null ? +over.toFixed(2) : null });
  }
  // (b) fallback: "X weighed in at N pounds" sin la cláusula "over the"
  const re2 = /([A-Z][A-Za-z'’.\-]+(?:\s+[A-Z][A-Za-z'’.\-]+){0,3})\s+weighed in at\s+([\d.]+)\s*(?:pounds|lbs)/gi;
  while ((m = re2.exec(t))) {
    const nm2 = cleanName(m[1]);
    if (out.some(x => norm(x.name) === norm(nm2))) continue;
    out.push({ name: nm2, lbs: +m[2], over: null });
  }
  // (c) nombres listados como "A and B missed weight" (por si no traen el detalle numérico)
  const re3 = /At the weigh-?ins?,?\s+([^.]{0,220}?)\s+missed weight/gi;
  while ((m = re3.exec(t))) {
    for (const nm of m[1].split(/,| and /).map(s => s.trim()).filter(Boolean)) {
      if (!/^[A-Z]/.test(nm) || nm.split(' ').length > 4) continue;
      if (out.some(x => norm(x.name) === norm(nm))) continue;
      out.push({ name: nm, lbs: null, over: null });
    }
  }
  return out;
}

// Wikipedia titula los eventos numerados SIN subtítulo ("UFC 329", no "UFC 329: McGregor vs. Holloway 2"),
// y los Fight Night por sus protagonistas, no por la ciudad que usa ESPN. Se prueban variantes y, si nada
// engancha, se resuelve por el buscador de Wikipedia (que es lo que hace un humano).
function titleCandidates(name, mainPair) {
  const c = [name];
  const num = name.match(/^(UFC\s+\d+)\b/i);
  if (num) c.push(num[1]);
  const fn = name.match(/^(UFC (?:Fight Night|on \w+)):/i);
  if (fn && mainPair) c.push(`UFC Fight Night: ${mainPair}`, `${fn[1]}: ${mainPair}`);
  if (mainPair) c.push(`UFC Fight Night: ${mainPair}`);
  return [...new Set(c)];
}
async function wikiSearch(q) {
  try {
    const u = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
      encodeURIComponent(q) + '&srlimit=1&format=json&formatversion=2';
    const r = await fetch(u, { headers: { 'User-Agent': 'GPSimulador/1.0 (sports research)' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const j = await r.json();
    const hit = ((j.query || {}).search || [])[0];
    return hit && /UFC|Fight Night/i.test(hit.title) ? hit.title : null;
  } catch { return null; }
}
// GOTCHA CARO (29-jul): sin backoff, Wikipedia throttlea las ráfagas y CADA fallo se clasificaba como
// "la página no existe" → 748 eventos descartados por error. Un 429/5xx NO es un 404: se reintenta.
// `missingtitle` es el ÚNICO veredicto real de inexistencia.
async function wikitext(title) {
  const u = 'https://en.wikipedia.org/w/api.php?action=parse&page=' + encodeURIComponent(title) +
    '&prop=wikitext&format=json&formatversion=2&redirects=1';
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'GPSimulador/1.0 (sports research; contact soporte@gpsimulador.com)' }, signal: AbortSignal.timeout(20000) });
      if (r.status === 429 || r.status >= 500) { await sleep(1200 * (i + 1)); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      if (j.error) return j.error.code === 'missingtitle' ? null : (await sleep(800 * (i + 1)), undefined);
      return (j.parse && j.parse.wikitext) || null;
    } catch { await sleep(900 * (i + 1)); }
  }
  return undefined; // undefined = no se pudo determinar (reintentar otro día); null = no existe
}

(async () => {
  const fightsFile = path.join(__dirname, '..', 'data', 'combat', `fights-${ORG}.json`);
  const F = JSON.parse(fs.readFileSync(fightsFile, 'utf8'));
  // eventos únicos (los que tienen peleas completadas)
  const events = {};
  for (const f of (F.fights || [])) {
    if (!f.completed || !f.event) continue;
    const e0 = events[f.event] = events[f.event] || { name: f.event, date: f.date, n: 0, mainPair: null };
    e0.n++;
    if (f.main && f.f1 && f.f2 && !e0.mainPair) {
      const last = (x) => String(x || '').trim().split(/\s+/).pop();
      e0.mainPair = `${last(f.f1.name)} vs. ${last(f.f2.name)}`;
    }
  }
  const list = Object.values(events).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, LIMIT);
  console.log(`${list.length} eventos de ${ORG} a resolver`);

  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { prev = { events: {} }; }
  prev.events = prev.events || {};

  let done = 0, withMiss = 0, clean = 0, noPage = 0, records = 0;
  for (const ev of list) {
    if (prev.events[ev.name] && prev.events[ev.name].status !== 'no_page') { done++; continue; } // idempotente
    let w = null, usedTitle = null;
    for (const cand of titleCandidates(ev.name, ev.mainPair)) {
      w = await wikitext(cand);
      await sleep(SLEEP);
      if (w) { usedTitle = cand; break; }
    }
    if (!w) { // último recurso: buscador
      const found = await wikiSearch(ev.name.replace(/:.*$/, '') + ' ' + (ev.mainPair || ''));
      await sleep(SLEEP);
      if (found) { w = await wikitext(found); usedTitle = found; await sleep(SLEEP); }
    }
    if (!w) { prev.events[ev.name] = { status: 'no_page', date: ev.date }; noPage++; done++; continue; }
    if (w === undefined) { done++; continue; } // throttled: se reintenta en la próxima corrida
    const rows = parseWeighIns(w);
    if (rows.length) { withMiss++; records += rows.length; } else clean++;
    prev.events[ev.name] = { status: rows.length ? 'miss' : 'clean', date: ev.date, title: usedTitle, rows };
    done++;
    if (done % 25 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(prev));
      console.log(`  ${done}/${list.length} · con fallo ${withMiss} · limpios ${clean} · sin página ${noPage} · registros ${records}`);
    }
  }
  prev.updated_at = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(prev));
  const all = Object.values(prev.events);
  console.log(`\nLISTO → ${OUT}`);
  console.log(`eventos: ${all.length} | con pesaje fallado: ${all.filter(e => e.status === 'miss').length} | limpios: ${all.filter(e => e.status === 'clean').length} | sin página: ${all.filter(e => e.status === 'no_page').length}`);
  console.log(`registros de pesaje: ${all.reduce((s, e) => s + ((e.rows || []).length), 0)}`);
})();
