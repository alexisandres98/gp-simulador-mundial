// scripts/tennis-assets.js — LAS CARAS DEL TENIS (19-ago, reporte de Alexis: "tampoco hay fotos").
//
// Misma fuente y mismo criterio que la F1: Wikipedia/Wikimedia Commons (CC BY-SA), elegida por DERECHOS —
// las fotos de ATP/WTA/ITF son de sus federaciones y no se pueden auto-hospedar. El manifiesto guarda
// origen y licencia de cada archivo para poder rendir la atribución en pantalla.
//
// El cruce va por nombre. Dos cuidados propios del tenis: hay tocayos famosos fuera del deporte, así que se
// confirma que la ficha HABLE de tenis (la descripción de Wikipedia dice "tennis player"), y hay nombres
// con acentos y transliteraciones que solo resuelven con la variante correcta.
//
// USO: node scripts/tennis-assets.js [--limit=250] [--tour=atp|wta|all]
'use strict';

const fs = require('fs');
const path = require('path');

const arg = (k, d) => { const h = process.argv.find((a) => a.startsWith(`--${k}=`)); return h ? h.split('=')[1] : d; };
const LIMIT = +arg('limit', 250);
const TOUR = arg('tour', 'all');
const UA = 'GPSimulador/1.0 (codigo@gpsimulador.com) tennis-asset-fetch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, '..', 'public', 'logos', 'tennis');
const MANIFEST = path.join(__dirname, '..', 'data', 'tennis', 'assets.json');

async function get(url, json = true) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) });
      if (r.status === 404) return null;
      if (r.status === 429) { await sleep(20000); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return json ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 2) return null; await sleep(2000 * (i + 1)); }
  }
  return null;
}

const summary = (title) => get('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(String(title).replace(/ /g, '_')));

// LA FICHA TIENE QUE HABLAR DE TENIS: sin esto, "Jack Draper" o "Alex Michelsen" pueden resolver a un
// homónimo cualquiera y acabaríamos sirviendo la cara de otra persona con toda la confianza del mundo.
const isTennis = (s) => /tennis/i.test((s && (s.description || '')) + ' ' + (s && (s.extract || '')).slice(0, 320));

async function savePhoto(url, name) {
  if (!url) return null;
  // la URL va TAL CUAL: Wikimedia solo sirve los anchos de miniatura que ya tiene generados
  const buf = await get(url, false);
  if (!buf || buf.length < 900) return null;
  const ext = /\.png/i.test(url) ? 'png' : 'jpg';
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.${ext}`), buf);
  return `${name}.${ext}`;
}

(async () => {
  const T = require(path.join(__dirname, '..', 'tennis-engine', 'store.js'));
  const prev = (() => { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; } })();
  const P = prev.players || {};
  const tours = TOUR === 'atp' ? [0] : TOUR === 'wta' ? [1] : [0, 1];

  for (const tour of tours) {
    const label = tour ? 'WTA' : 'ATP';
    const rows = (T.playersDirectory(tour, { q: '', limit: LIMIT }).rows || [])
      .filter((r) => !r.inactive).slice(0, LIMIT);
    console.log(`[tenis:${label}] a cubrir: ${rows.length}`);
    let n = 0, miss = 0;
    for (const r of rows) {
      const key = tour + ':' + r.id;
      if (P[key] && P[key].photo) continue;
      let s = await summary(r.name);
      await sleep(320);
      if (!s || !isTennis(s)) { s = await summary(r.name + ' (tennis)'); await sleep(320); }
      if (!s || !s.thumbnail || !isTennis(s)) { miss++; continue; }
      const f = await savePhoto(s.thumbnail.source, `p-${tour}-${r.id}`);
      if (f) {
        P[key] = { photo: f, name: r.name, source: s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page,
          desc: s.description || null, license: 'CC BY-SA (Wikimedia Commons)' };
        n++;
      } else miss++;
      await sleep(320);
      if (n && n % 25 === 0) {
        fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
        fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(),
          source: 'Wikipedia/Wikimedia Commons (REST summary) — CC BY-SA, atribución en pantalla',
          rights_class: 'attribution_sharealike', players: P }));
        console.log(`[tenis:${label}] ${n} caras · ${miss} sin foto`);
      }
    }
    console.log(`[tenis:${label}] LISTO: +${n} caras · ${miss} sin foto`);
  }

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify({ at: new Date().toISOString(),
    source: 'Wikipedia/Wikimedia Commons (REST summary) — CC BY-SA, atribución en pantalla',
    rights_class: 'attribution_sharealike', players: P }));
  console.log(`[tenis] TOTAL: ${Object.keys(P).length} jugadores con cara`);
})().catch((e) => { console.error(e); process.exit(1); });
