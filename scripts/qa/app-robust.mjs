// QA de carga resiliente de la UI pública (1-sep, la misma sombra de `fetch` que premium.js). Uso:
// servidor local en :3111. ESM ignora NODE_PATH: copiar el script a un directorio con
// `node_modules -> $(npm root -g)` (symlink) y correrlo desde ahí: `node app-robust.mjs`.
// Intercepta /api/state: 2×502 → la app arranca igual (STATE cargado, sin error de página);
// 502 siempre → tras los 4 reintentos el nativo devuelve la respuesta y la app se comporta como antes.
import { chromium } from 'playwright';
const base = process.env.QA_BASE || 'http://localhost:3111';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 420, height: 860 } });
const p = await ctx.newPage();
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERR ' + e.message));

let mode = 'fail2', n = 0;
const t0 = Date.now();
const hits = [];
await p.route('**/api/state*', async (route) => {
  n++; hits.push(Math.round((Date.now() - t0) / 100) / 10);
  if (mode === 'always' || (mode === 'fail2' && n <= 2)) return route.fulfill({ status: 502, body: 'bad gateway' });
  return route.continue();
});

// T1: dos 502 seguidos y luego OK → STATE cargado, cero errores de página
await p.goto(base + '/');
await p.waitForTimeout(7000);
let st = await p.evaluate(() => { try { return !!(STATE && (STATE.teams || STATE.groups || Object.keys(STATE).length)); } catch (e) { return false; } });
console.log('T1 intentos=', n, 'tiempos(s)=', hits.join(','), 'STATE=', st, 'pageerr=', errs.filter((e) => /^PAGEERR/.test(e)).length);
await p.screenshot({ path: 'app-t1.png' });

// T2: 502 siempre → 5 intentos (1 + 4 reintentos) en ~11 s y la app no se rompe de otra forma
mode = 'always'; n = 0; hits.length = 0;
const t1 = Date.now();
await p.goto(base + '/');
await p.waitForTimeout(14000);
console.log('T2 intentos=', n, 'tiempos(s)=', hits.map((h) => h).join(','), 'ms totales=', Date.now() - t1);
await p.screenshot({ path: 'app-t2.png' });

// T3: un POST no se reintenta (no idempotente): /api/auth/request con 502 → un solo intento
let np = 0;
await p.route('**/api/auth/request', async (route) => { np++; return route.fulfill({ status: 502, body: 'bad gateway' }); });
await p.evaluate(() => fetch('/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.status).catch(() => 'err'));
await p.waitForTimeout(3000);
console.log('T3 POST intentos=', np);

// el único error de página admisible es el de T2: con 502 permanente loadState() sigue lanzando, como antes
const nonRes = errs.filter((e) => !/^Failed to load resource/.test(e) && !/bad gateway/.test(e));
console.log('console errors:', errs.length, 'non-resource:', nonRes);
await b.close();
process.exit(nonRes.length ? 1 : 0);
