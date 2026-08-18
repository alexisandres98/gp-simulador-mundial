// scripts/tennis-harvest.js — LA BASE HISTÓRICA PROPIA DE TENIS (18-ago, blueprint 6.0 Fase 1)
//
// Fuente: repos públicos de Jeff Sackmann (tennis_atp / tennis_wta), CC BY-NC-SA 4.0 — registro de
// derechos en data/tennis/RIGHTS.md: research_attribution_noncommercial. La base alimenta el rating
// interno, el catálogo admin-only y la sombra; NINGUNA pick pública nace de aquí.
//
// Corre en Render (el sandbox de desarrollo no llega a GitHub): descarga los CSV anuales de partidos
// ATP y WTA 2015→2026 + los catálogos de jugadores a GP_TEN_DIR (/data/tennis-raw, disco persistente),
// con escritura atómica y state.json como marcador de completitud. Idempotente: los archivos ya
// bajados con contenido no se rebajan salvo --force o que sean del año en curso (pueden crecer).
//
// USO
//   GP_TEN_DIR=/data/tennis-raw node scripts/tennis-harvest.js
//   node scripts/tennis-harvest.js --force        # rebaja todo
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = process.env.GP_TEN_DIR || (fs.existsSync('/data') ? '/data/tennis-raw' : path.join(__dirname, '..', 'data', 'tennis', 'raw'));
const FORCE = process.argv.includes('--force');
const YEARS = []; for (let y = 2015; y <= 2026; y++) YEARS.push(y);
const CUR_YEAR = new Date().getUTCFullYear();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Los repos originales de Sackmann (tennis_atp/tennis_wta) fueron RETIRADOS de GitHub (comprobado
// 18-ago-2026). La fuente es el espejo archivístico Aneeshers/tennis-sackmann-archive (misma licencia
// CC BY-NC-SA 4.0, instantánea de los commits upstream de jun-2026, carpetas atp/ y wta/).
const MIRROR = 'Aneeshers/tennis-sackmann-archive';
const FILES = [];
for (const tour of ['atp', 'wta']) {
  for (const y of YEARS) FILES.push({ dir: tour, file: `${tour}_matches_${y}.csv`, optional: y >= CUR_YEAR - 1 });
  FILES.push({ dir: tour, file: `${tour}_players.csv`, optional: false });
}

function wr(file, body) {
  const tmp = path.join(DIR, '.' + file + '.tmp');
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, path.join(DIR, file));
}

async function get(url) {
  // GitHub raw casi no limita, pero la paciencia estructural es doctrina: se espera, no se rinde.
  let last = null;
  for (let i = 0; i < 6; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(120000), headers: { 'user-agent': 'GP-Simulador/1.0 (codigo@gpsimulador.com)' } });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status === 403 || r.status >= 500) { last = new Error('HTTP ' + r.status); await sleep(i === 0 ? 30e3 : 120e3); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { last = e; await sleep(15e3 * (i + 1)); }
  }
  throw last || new Error('agotado');
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const got = [], missing = [];
  for (const f of FILES) {
    const dest = path.join(DIR, f.file);
    const yearMatch = f.file.match(/_(\d{4})\.csv$/);
    const isCurrent = yearMatch && +yearMatch[1] >= CUR_YEAR;
    if (!FORCE && !isCurrent && fs.existsSync(dest) && fs.statSync(dest).size > 500) { got.push(f.file); continue; }
    let body = await get(`https://raw.githubusercontent.com/${MIRROR}/main/${f.dir}/${f.file}`);
    if (body == null) body = await get(`https://raw.githubusercontent.com/${MIRROR}/master/${f.dir}/${f.file}`);
    if (body == null || body.length < 200) {
      if (!f.optional) throw new Error(`falta ${f.file} (no opcional)`); // sale ≠0 → la cadena reintenta
      console.log(`[tenis] ${f.file}: aún no existe en la fuente (opcional)`);
      missing.push(f.file);
      continue;
    }
    wr(f.file, body);
    got.push(f.file);
    console.log(`[tenis] ${f.file}: ${(body.length / 1e6).toFixed(1)} MB`);
    await sleep(1200);
  }
  wr('state.json', JSON.stringify({ complete: true, at: new Date().toISOString(), files: got.length, missing }, null, 1));
  console.log(`[tenis] LISTO: ${got.length} archivos en ${DIR}${missing.length ? ' · sin fuente aún: ' + missing.join(', ') : ''}`);
})().catch((e) => { console.error('[tenis] FALLO:', e.message); process.exit(1); });
