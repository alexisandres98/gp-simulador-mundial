#!/usr/bin/env node
/**
 * BOXEO — BACKFILL DESDE WIKIPEDIA (30-jul). El 3er deporte de combate.
 *
 * POR QUÉ WIKIPEDIA: no hay API de boxeo en ninguna de nuestras fuentes (ESPN solo tiene 'mma';
 * api-sports no tiene boxeo; BoxRec sirve un desafío anti-bot y NO se salta). Wikipedia sí, y de forma
 * perfectamente estructurada: cada boxeador tiene su tabla de récord profesional con resultado, rival
 * COMO ENLACE, método, round y tiempo de cierre, fecha y sede. Es el mismo shape que fights-ufc.json.
 *
 * ESTRATEGIA (orden de Alexis: "con las peleas importantes y peleadores relevantes es suficiente"):
 * siembra desde los campeones mundiales actuales y recorre el grafo siguiendo los enlaces de rivales.
 * Eso produce exactamente el núcleo que importa — el que además tiene mercado en Cloudbet. Los
 * journeymen sin página quedan como oponentes sin ficha, que es correcto: existen en el récord del
 * boxeador pero no tienen rating propio.
 *
 * Uso: node scripts/combat-boxing-backfill.js [--depth=2] [--max=900] [--sleep=ms]
 * Salida: data/combat/fights-boxing.json + fighters-boxing.json
 * Idempotente: relee lo ya bajado y solo pide lo que falta.
 */
const fs = require('fs');
const path = require('path');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const DEPTH = +args.depth || 2;
const MAX = +args.max || 900;
const SLEEP = +args.sleep || 160;
const FROM_YEAR = +args.from || 2018;   // solo boxeadores en activo reciente
const DIR = path.join(__dirname, '..', 'data', 'combat');
const OUT_F = path.join(DIR, 'fights-boxing.json');
const OUT_P = path.join(DIR, 'fighters-boxing.json');
const CACHE = path.join(DIR, '.boxing-cache.json');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\s*\(.*?\)\s*/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const slug = (s) => norm(s).replace(/ /g, '-');

// Un 429/5xx NO es "no existe" (lección cara del harvest de pesajes): se reintenta con backoff.
async function wiki(params) {
  const u = 'https://en.wikipedia.org/w/api.php?' + params + '&format=json&formatversion=2';
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'GPSimulador/1.0 (sports research; soporte@gpsimulador.com)' }, signal: AbortSignal.timeout(25000) });
      if (r.status === 429 || r.status >= 500) { await sleep(1300 * (i + 1)); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      if (j.error) return j.error.code === 'missingtitle' ? null : (await sleep(900 * (i + 1)), undefined);
      return j;
    } catch { await sleep(1000 * (i + 1)); }
  }
  return undefined;
}
const wikitext = async (title) => {
  const j = await wiki('action=parse&page=' + encodeURIComponent(title) + '&prop=wikitext&redirects=1');
  if (j === undefined) return undefined;
  return j && j.parse ? j.parse.wikitext : null;
};

const clean = (w) => String(w || '')
  .replace(/<ref[^>]*\/>/g, ' ').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<br\s*\/?>/gi, ' ');
// [[Page|Texto]] → Texto ; [[Page]] → Page
const delink = (s) => String(s || '').replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/\[\[([^\]]*)\]\]/g, '$1');
// primer enlace real de una celda (el rival)
const firstLink = (s) => { const m = String(s || '').match(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/); return m ? m[1].trim() : null; };
const strip = (s) => delink(String(s || ''))
  .replace(/\{\{small\|([^}]*)\}\}/gi, '$1').replace(/\{\{[^{}]*\}\}/g, ' ')
  .replace(/style\s*=\s*"[^"]*"/gi, ' ').replace(/align\s*=\s*"[^"]*"/gi, ' ')
  // algunas filas traen los atributos SIN comillas ("align=left") y se colaban al nombre del rival
  .replace(/\b(?:align|style|colspan|rowspan|width|bgcolor)\s*=\s*[^\s|]+/gi, ' ')
  .replace(/'''?/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// UNA SOLA SALIDA, y validada. La versión anterior validaba solo la 3ª rama y "36 April 2009" se coló por la
// 1ª → 30,413 de 38,066 probs en NaN. Con tres returns sueltos era cuestión de tiempo; ahora es imposible
// devolver una fecha sin pasar por realDate.
function parseDate(s) {
  const t = strip(s);
  const ymd = (y, mo, d) => (mo ? `${y}-${String(mo).padStart(2, '0')}-${String(+d).padStart(2, '0')}` : null);
  let m, iso = null;
  if ((m = t.match(/(\d{1,2})\s+([A-Za-z]{3,9}),?\s+(\d{4})/))) iso = ymd(m[3], MONTHS[m[2].slice(0, 3).toLowerCase()], m[1]);
  else if ((m = t.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/))) iso = ymd(m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], m[2]);
  else if ((m = t.match(/(\d{4})-(\d{2})-(\d{2})/))) iso = m[0];
  return realDate(iso);
}
// Una fecha que no ROUND-TRIPEA no es fecha. Wikipedia trae días imposibles ("32 January 2024") además de
// los años typo (2914/2924) que ya filtrábamos. UNA sola envenena el Elo entero: la fecha inválida entra a
// LAST/FIRST del boxeador y desde ahí TODAS sus probs salen NaN — en la 1ª corrida fueron 9,652 de 18,981.
function realDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + 'T00:00:00Z');
  return isFinite(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
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

// ---- parsea la tabla de récord profesional de una página ----
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
    let result = /win/.test(res) ? 'win' : /loss/.test(res) ? 'loss' : /draw/.test(res) ? 'draw' : /nc|no contest/.test(res) ? 'nc' : null;
    if (!result) continue;
    const oppTitle = firstLink(cells[3]);
    const oppName = strip(cells[3]);
    if (!oppName || oppName.length < 3) continue;
    const method = METHOD(cells[4]);
    const rd = parseRound(cells[5]);
    const date = parseDate(cells[6] || '') || parseDate(cells[7] || '');
    if (!date) continue;
    const yr = +date.slice(0, 4);
    if (yr < 1900 || yr > new Date().getFullYear() + 2) continue;   // typos de Wikipedia (vistos: 2914, 2924)
    // Una fila del récord es una pelea YA DISPUTADA: si la fecha cae en el futuro es un typo (visto:
    // Vayson-Paradero "2027-05-16" con resultado). Se descarta en vez de entrar como completed.
    if (Date.parse(date + 'T00:00:00Z') > Date.now() + 2 * 864e5) continue;
    out.push({ result, oppTitle, oppName, method, rd, date, location: strip(cells[7] || '').slice(0, 90) });
  }
  return out;
}

// ---- ficha del boxeador (infobox + foto) ----
// OJO (31-jul): el valor de un campo del infobox puede contener '|' (wikilinks y plantillas), así que
// cortar en el primer pipe devuelve basura — así salía stance="[[Southpaw stance". Se lee hasta el
// siguiente "\n|" de PRIMER nivel, contando llaves/corchetes.
const inboxRaw = (w, k) => {
  const t = clean(w);
  const re = new RegExp('\\n\\s*\\|\\s*' + k + '\\s*=\\s*', 'i');
  const m = t.match(re); if (!m) return null;
  let i = m.index + m[0].length, depth = 0, out = '';
  while (i < t.length && out.length < 400) {
    const c = t[i], c2 = t.slice(i, i + 2);
    if (c2 === '{{' || c2 === '[[') { depth++; out += c2; i += 2; continue; }
    if (c2 === '}}' || c2 === ']]') { depth--; out += c2; i += 2; continue; }
    if (depth <= 0 && (c === '|' || (c === '\n' && /^\s*[|}]/.test(t.slice(i + 1, i + 4))))) break;
    out += c; i++;
  }
  return out.trim() || null;
};
// Texto legible de un valor de infobox: resuelve [[destino|etiqueta]] → etiqueta y limpia plantillas.
const inbox = (w, k) => {
  const raw = inboxRaw(w, k); if (raw == null) return null;
  const s = raw.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, ' ').replace(/<ref[^>]*\/>/g, ' ').replace(/<ref[\s\S]*?<\/ref>/g, ' ');
  return strip(s).replace(/\s+/g, ' ').slice(0, 90) || null;
};
// FECHA DE NACIMIENTO — antes estaba HARDCODEADA a null y nunca se intentó. Es la feature más valiosa que
// existe (en UFC la edad subió el skill 0.0109→0.0166, +52%). Wikipedia la da como plantilla:
// {{birth date and age|df=y|1987|1|17}} — hay que saltarse los parámetros con nombre (df=y, mf=y).
const dobOf = (w) => {
  const raw = inboxRaw(w, 'birth_date') || inboxRaw(w, 'birth date') || '';
  const tpl = String(raw).match(/\{\{\s*birth[ _]date[^}]*\}\}/i);
  const src = tpl ? tpl[0] : String(raw);
  const nums = (src.match(/\|\s*(\d{1,4})\s*(?=[|}])/g) || []).map(x => +x.replace(/[|\s]/g, ''));
  const y = nums.find(n => n >= 1900 && n <= 2015);
  if (y == null) { const iso = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/); return iso ? realDate(iso[0]) : null; }
  const rest = nums.slice(nums.indexOf(y) + 1);
  const mo = rest[0], da = rest[1];
  if (!(mo >= 1 && mo <= 12 && da >= 1 && da <= 31)) return null;
  return realDate(`${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`);
};
// DIVISIONES del boxeador (el infobox las lista con plantilla plainlist). Sirven para dar `weight` a la
// pelea: sin división, methodModel mete TODO en un solo cubo '?' y su base pierde poder.
const divsOf = (w) => {
  const raw = inboxRaw(w, 'weight') || '';
  const out = [...new Set((raw.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g) || [])
    .map(x => x.replace(/\[\[|\]\]/g, '').split('|').pop().trim())
    .concat(String(raw).replace(/\[\[[^\]]*\]\]/g, ' ').match(/[A-Z][a-z]+weight/g) || []))];
  return out.filter(d => /weight/i.test(d)).slice(0, 4);
};
async function photo(title) {
  const j = await wiki('action=query&titles=' + encodeURIComponent(title) + '&prop=pageimages&piprop=thumbnail&pithumbsize=400&redirects=1');
  const p = j && j.query && (j.query.pages || [])[0];
  return (p && p.thumbnail && p.thumbnail.source) || null;
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  let cache = {}; try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { cache = { pages: {} }; }
  cache.pages = cache.pages || {};

  // ---- semillas: campeones mundiales actuales ----
  console.log('sembrando desde los campeones mundiales actuales…');
  const seedW = await wikitext('List of current world boxing champions');
  const seeds = [...new Set((String(seedW || '').match(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g) || [])
    .map(x => x.replace(/\[\[|\]\]/g, '').split('|')[0].trim())
    .filter(t => t && !/^(File|Image|Category|List|WBA|WBC|IBF|WBO|The Ring)\b/i.test(t) && t.split(' ').length <= 4))];
  console.log(`  ${seeds.length} candidatos de la lista`);

  const queue = seeds.map(t => ({ title: t, d: 0 }));
  const seen = new Set(), fighters = {}, fightMap = {};
  let pages = 0, boxers = 0, skipped = 0;

  while (queue.length && pages < MAX) {
    const { title, d } = queue.shift();
    const key = norm(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    let w = cache.pages[title];
    if (w === undefined) {
      w = await wikitext(title);
      await sleep(SLEEP);
      if (w === undefined) continue;              // throttled → otro día
      cache.pages[title] = w || null;
    }
    pages++;
    if (!w) continue;
    const rec = parseRecord(w);
    if (!rec.length) continue;                    // no es un boxeador (o sin tabla) → fuera
    // RELEVANCIA (orden de Alexis: peleas importantes y peleadores relevantes). La lista de campeones
    // enlaza también a figuras históricas; sin este filtro el grafo se va a 1879. Se exige actividad
    // reciente: si su última pelea es anterior a FROM_YEAR, no entra ni él ni sus rivales.
    const lastDate = rec.reduce((m, r) => (r.date > m ? r.date : m), '');
    if (!lastDate || +lastDate.slice(0, 4) < FROM_YEAR) { skipped++; continue; }
    boxers++;

    const id = slug(title);
    if (!fighters[id]) {
      fighters[id] = {
        id, name: title.replace(/\s*\(.*?\)\s*$/, ''), wiki: title,
        reach_in: inbox(w, 'reach'), height_in: inbox(w, 'height'), stance: inbox(w, 'stance'),
        country: inbox(w, 'nationality') || inbox(w, 'birth_place'), dob: dobOf(w), divisions: divsOf(w),
        headshot: await photo(title), record_txt: { total: inbox(w, 'total'), wins: inbox(w, 'wins'), losses: inbox(w, 'losses'), ko: inbox(w, 'ko') },
      };
      await sleep(SLEEP);
    }

    for (const r of rec) {
      const oppId = r.oppTitle ? slug(r.oppTitle) : slug(r.oppName);
      const pair = [id, oppId].sort();
      const fid = `${pair[0]}__${pair[1]}__${r.date}`;
      if (fightMap[fid]) continue;
      const meWon = r.result === 'win', oppWon = r.result === 'loss';
      const completed = ['win', 'loss', 'draw'].includes(r.result);
      // ORDEN CANÓNICO f1/f2 (31-jul, BUG SERIO): antes f1 era SIEMPRE el dueño de la página que estábamos
      // crawleando, y como solo tienen página los boxeadores relevantes, f1 ganaba el 88.8% de las peleas.
      // El modelo es antisimétrico SIN intercepto a propósito (para ser inmune al orden), así que no puede
      // expresar ese 88.8% — y toda la miscalibración salía de ahí: predecía 25% donde pasaba 42%, 35% donde
      // pasaba 52%, con el sesgo en la MISMA dirección en los 10 buckets. Ordenando por slug, el lado f1 deja
      // de llevar información sobre a quién crawleamos (UFC/MMA están en 57-59% por el orden de ESPN).
      const me = { id, name: fighters[id].name, winner: meWon };
      const opp = { id: oppId, name: r.oppName.replace(/\s*\(.*?\)\s*$/, ''), winner: oppWon };
      const meFirst = id === pair[0];
      fightMap[fid] = {
        comp_id: fid, event_id: null, event: r.location || 'Boxing', date: r.date + 'T00:00Z',
        weight: null, rounds_sched: r.rd.sched || 12,
        f1: meFirst ? me : opp,
        f2: meFirst ? opp : me,
        end_round: r.rd.end, end_clock: r.rd.clock || (r.method && r.method.name === 'decision' ? '3:00' : null),
        completed, method: r.method, lg: 'boxing',
      };
      // el rival entra a la cola si tiene página propia
      if (r.oppTitle && d < DEPTH && !seen.has(norm(r.oppTitle))) queue.push({ title: r.oppTitle, d: d + 1 });
    }

    if (pages % 25 === 0) {
      fs.writeFileSync(CACHE, JSON.stringify(cache));
      console.log(`  ${pages} páginas · ${boxers} relevantes · ${skipped} descartados por antigüedad · ${Object.keys(fightMap).length} peleas · cola ${queue.length}`);
    }
  }

  // DIVISIÓN DE LA PELEA (31-jul): el récord de Wikipedia no la trae por fila, pero el infobox sí lista las
  // divisiones de cada boxeador. Si los dos comparten exactamente UNA, esa es la pelea; si no, se deja null
  // (mejor un '?' honesto que inventar la categoría). Sin esto methodModel mete las 19k peleas en un solo
  // cubo y su base pierde todo el poder de estratificación.
  let withDiv = 0;
  for (const f of Object.values(fightMap)) {
    const d1 = (fighters[f.f1.id] || {}).divisions || [], d2 = (fighters[f.f2.id] || {}).divisions || [];
    const shared = d1.filter(x => d2.includes(x));
    const pick = shared.length === 1 ? shared[0] : (d1.length === 1 && !d2.length ? d1[0] : (d2.length === 1 && !d1.length ? d2[0] : null));
    if (pick) { f.weight = pick; withDiv++; }
  }
  console.log(`  división asignada a ${withDiv}/${Object.keys(fightMap).length} peleas`);

  const fights = Object.values(fightMap).sort((a, b) => new Date(a.date) - new Date(b.date));
  fs.writeFileSync(CACHE, JSON.stringify(cache));
  fs.writeFileSync(OUT_F, JSON.stringify({ fights, events: {}, source: 'wikipedia', updated_at: new Date().toISOString() }));
  fs.writeFileSync(OUT_P, JSON.stringify(fighters));
  const withPhoto = Object.values(fighters).filter(f => f.headshot).length;
  console.log(`\nLISTO`);
  console.log(`  páginas leídas: ${pages} · boxeadores con ficha: ${Object.keys(fighters).length} (${withPhoto} con foto) · ${skipped} descartados por antigüedad (< ${FROM_YEAR})`);
  console.log(`  peleas únicas: ${fights.length}`);
  console.log(`  rango: ${fights[0] ? fights[0].date.slice(0, 10) : '—'} → ${fights.length ? fights[fights.length - 1].date.slice(0, 10) : '—'}`);
})();
