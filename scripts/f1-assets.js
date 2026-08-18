// scripts/f1-assets.js — LAS CARAS Y LAS MARCAS DE LA F1 (19-ago, reporte de Alexis: "no hay fotos de nada").
//
// Fuente: Wikipedia/Wikimedia Commons vía la REST API de resúmenes. Se elige por DERECHOS, no por comodidad:
// las imágenes de Commons son CC BY-SA (atribución, compartir igual) — la misma clase que ya usa la base de
// LoL —, mientras que las fotos del sitio oficial de F1 son propiedad de FOM y no se pueden auto-hospedar.
// El manifiesto guarda la URL de origen de cada archivo para poder rendir la atribución en pantalla.
//
// El cruce va por el título de Wikipedia que da Jolpica para cada piloto/escudería cuando existe, y por el
// nombre si no. Se auto-hospeda en public/logos/f1/ igual que los escudos de la CFL y de los esports: el
// producto no depende de un hotlink que puede caerse.
//
// USO: node scripts/f1-assets.js
'use strict';

const fs = require('fs');
const path = require('path');

const UA = 'GPSimulador/1.0 (codigo@gpsimulador.com) f1-asset-fetch';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = path.join(__dirname, '..', 'public', 'logos', 'f1');
const MANIFEST = path.join(__dirname, '..', 'data', 'f1', 'assets.json');

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function get(url, json = true) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (r.status === 429) { await sleep(20000); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return json ? await r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) { if (i === 3) return null; await sleep(2500 * (i + 1)); }
  }
  return null;
}

// el resumen REST trae la miniatura y, con ella, la ficha de Commons para la atribución
async function summary(title) {
  return get('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(String(title).replace(/ /g, '_')));
}

async function save(url, name) {
  if (!url) return null;
  // LA URL VA TAL CUAL (comprobado): Wikimedia solo sirve los anchos de miniatura que YA tiene generados,
  // así que reescribir "/330px-" a "/320px-" devuelve 400 y se perdían todas las fotos de piloto mientras
  // las de escudería colaban por casualidad. El resumen entrega ~330 px, que es de sobra; el reescalado
  // fino se hace en local después, no pidiéndole a la Wikipedia un tamaño que no existe.
  const u = url;
  const buf = await get(u, false);
  if (!buf || buf.length < 900) return null;
  const ext = /\.png/i.test(u) ? 'png' : /\.svg/i.test(u) ? 'svg' : 'jpg';
  fs.mkdirSync(OUT, { recursive: true });
  const f = `${name}.${ext}`;
  fs.writeFileSync(path.join(OUT, f), buf);
  return f;
}

(async () => {
  const F = require(path.join(__dirname, '..', 'f1-engine', 'store.js'));
  const dir = F.driversDirectory({}) || { rows: [] };
  const drivers = dir.rows || [];
  const prev = (() => { try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); } catch { return {}; } })();
  const D = prev.drivers || {}, C = prev.constructors || {};

  // DESAMBIGUACIÓN EXPLÍCITA: hay nombres que en Wikipedia los tiene otra persona —"George Russell" es un
  // actor y "Carlos Sainz" es el padre, el del Dakar—, así que para esos el título va a mano. Es una lista
  // corta y estable; el resto resuelve por nombre.
  const TITLE = {
    russell: 'George Russell (racing driver)',
    sainz: 'Carlos Sainz Jr.',
    bearman: 'Oliver Bearman',
    antonelli: 'Andrea Kimi Antonelli',
    hulkenberg: 'Nico Hülkenberg',
    perez: 'Sergio Pérez',
  };
  const TEAM_TITLE = {
    mercedes: 'Mercedes-Benz in Formula One',
    red_bull: 'Red Bull Racing',
    rb: 'Racing Bulls',
    alpine: 'Alpine F1 Team',
    haas: 'Haas F1 Team',
    sauber: 'Sauber Motorsport',
  };

  console.log(`[f1] pilotos a cubrir: ${drivers.length}`);
  let nd = 0;
  for (const d of drivers) {
    if (D[d.id] && D[d.id].photo) continue;
    // el nombre del piloto es el título de Wikipedia en la práctica totalidad de los casos
    let s = await summary(TITLE[d.id] || d.name);
    await sleep(400);
    if (!s || !s.thumbnail) { s = await summary(d.name + ' (racing driver)'); await sleep(400); }
    if (!s || !s.thumbnail) { console.log(`  (sin foto: ${d.name})`); continue; }
    const f = await save(s.thumbnail.source, 'driver-' + slug(d.id));
    if (f) {
      D[d.id] = { photo: f, source: s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page,
        desc: s.description || null, license: 'CC BY-SA (Wikimedia Commons)' };
      nd++;
    }
    await sleep(400);
  }

  // escuderías: el nombre corto de Jolpica no siempre es el título de Wikipedia, así que se prueban variantes
  const cons = [...new Map(drivers.map((d) => [d.cid, { id: d.cid, name: d.constructor }])).values()];
  console.log(`[f1] escuderías a cubrir: ${cons.length}`);
  let nc = 0;
  for (const c of cons) {
    if (C[c.id] && C[c.id].photo) continue;
    const tries = [TEAM_TITLE[c.id], c.name, c.name.replace(/ F1 Team$/, ''), c.name + ' (Formula One team)',
      c.name.replace(/ F1 Team$/, '') + ' Racing'].filter(Boolean);
    let done = false;
    for (const t of tries) {
      const s = await summary(t);
      await sleep(400);
      if (!s || !s.thumbnail) continue;
      const f = await save(s.thumbnail.source, 'team-' + slug(c.id));
      if (f) {
        C[c.id] = { photo: f, source: s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page,
          desc: s.description || null, license: 'CC BY-SA (Wikimedia Commons)' };
        nc++; done = true; break;
      }
    }
    if (!done) console.log(`  (sin marca: ${c.name})`);
  }

  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify({
    at: new Date().toISOString(),
    source: 'Wikipedia/Wikimedia Commons (REST summary) — imágenes CC BY-SA, atribución en pantalla',
    rights_class: 'attribution_sharealike',
    drivers: D, constructors: C,
  }));
  console.log(`[f1] LISTO: ${Object.keys(D).length} pilotos con foto (+${nd}) · ${Object.keys(C).length} escuderías (+${nc})`);
})().catch((e) => { console.error(e); process.exit(1); });
