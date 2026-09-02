// scripts/cfl-headshots-resize.js — DE PNG DE 420 px A JPG DE 240 px, CON EL CHROMIUM DEL SANDBOX (2-sep).
//
// Los headshots del CMS nuevo de la CFL (content.cfl.ca) pesan ~150 KB en PNG: 360 caras serían 54 MB en el
// repo. El criterio de la casa es 240 px JPG (~12 KB, como las 258 de la primera cosecha). No hay ImageMagick
// ni sharp en el sandbox (Node sin dependencias), pero sí Chromium + Playwright: un canvas hace el trabajo.
// Reescribe `photo` en roster-cfl.json de .png a .jpg y borra el PNG. Idempotente: sin PNGs, no hace nada.
//
// USO (solo en desarrollo, nunca en Render):
//   NODE_PATH=$(npm root -g) CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node scripts/cfl-headshots-resize.js
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'logos', 'amfoot', 'cfl');
const ROSTER = path.join(__dirname, '..', 'data', 'amfoot', 'roster-cfl.json');
const W = 240, Q = 0.82;

(async () => {
  const pngs = fs.readdirSync(DIR).filter((f) => /\.png$/i.test(f));
  if (!pngs.length) { console.log('[cfl-resize] sin PNGs — nada que hacer'); return; }
  const { chromium } = require('playwright');
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const p = await b.newPage();
  await p.setContent('<canvas id="c"></canvas>');
  let ok = 0, bad = 0;
  for (const f of pngs) {
    const src = fs.readFileSync(path.join(DIR, f));
    const dataUrl = 'data:image/png;base64,' + src.toString('base64');
    const out = await p.evaluate(async ([du, w, q]) => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = du; });
      const h = Math.round(img.naturalHeight * (w / img.naturalWidth));
      const c = document.getElementById('c'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);   // el PNG trae transparencia; el JPG no la tiene
      ctx.drawImage(img, 0, 0, w, h);
      return c.toDataURL('image/jpeg', q);
    }, [dataUrl, W, Q]).catch(() => null);
    if (!out) { bad++; continue; }
    const jpg = Buffer.from(out.split(',')[1], 'base64');
    if (jpg.length < 800) { bad++; continue; }
    fs.writeFileSync(path.join(DIR, f.replace(/\.png$/i, '.jpg')), jpg);
    fs.unlinkSync(path.join(DIR, f));
    ok++;
  }
  await b.close();
  // el roster apunta a la cara por nombre de archivo: .png → .jpg donde el JPG existe
  const R = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
  let fixed = 0;
  for (const pl of Object.values(R.players || {})) {
    if (pl.photo && /\.png$/i.test(pl.photo) && fs.existsSync(path.join(DIR, pl.photo.replace(/\.png$/i, '.jpg')))) { pl.photo = pl.photo.replace(/\.png$/i, '.jpg'); fixed++; }
  }
  fs.writeFileSync(ROSTER, JSON.stringify(R));
  console.log(`[cfl-resize] ${ok} caras a ${W}px JPG · ${bad} fallidas · ${fixed} rutas corregidas en roster-cfl.json`);
})();
