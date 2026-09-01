// QA de carga resiliente de la capa premium (1-sep). Uso: servidor local en :3111 con sesión QA;
// QA_TOKEN_FILE=<archivo con wc_token> NODE_PATH=$(npm root -g) node scripts/qa/premium-robust.mjs
// Intercepta /api/teamdetail: 2×502→carga transparente; 502 siempre→panel Reintentar; click→carga.
import { chromium } from 'playwright';
import fs from 'fs';
const tok = fs.readFileSync(process.env.QA_TOKEN_FILE || 'qa-token.txt', 'utf8').trim();
const base = 'http://localhost:3111';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 420, height: 860 } });
await ctx.addInitScript((t) => { localStorage.setItem('wc_token', t); }, tok);
const p = await ctx.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('PAGEERR ' + e.message));

let mode = 'fail2', n = 0;
await p.route('**/api/teamdetail/**', async (route) => {
  n++;
  if (mode === 'always' || (mode === 'fail2' && n <= 2)) return route.fulfill({ status: 502, body: 'bad gateway' });
  return route.continue();
});

// Test 1: two 502s then OK -> team renders, no error panel
await p.goto(base + '/x');
await p.waitForTimeout(2500);
await p.evaluate(() => { location.hash = '#team/ESP'; });
await p.waitForTimeout(6000);
let hasFail = await p.$('[data-gxfail]');
let txt = await p.evaluate(() => document.body.innerText.slice(0, 400));
console.log('T1 attempts=', n, 'failPanel=', !!hasFail, '\n', txt.replace(/\n+/g, ' | ').slice(0, 300));
await p.screenshot({ path: 'rob-t1.png' });

// Test 2: always fail -> Reintentar panel
mode = 'always'; n = 0;
await p.goto(base + '/x#team/ARG');
await p.waitForTimeout(14000);
hasFail = await p.$('[data-gxfail]');
const retryBtn = await p.$('.gx-retry');
console.log('T2 attempts=', n, 'failPanel=', !!hasFail, 'retryBtn=', !!retryBtn);
await p.screenshot({ path: 'rob-t2.png' });

// Test 3: click Reintentar with route restored -> renders
mode = 'ok'; n = 0;
if (retryBtn) await retryBtn.click();
await p.waitForTimeout(4000);
hasFail = await p.$('[data-gxfail]');
txt = await p.evaluate(() => document.body.innerText.slice(0, 300));
console.log('T3 attempts=', n, 'failPanel=', !!hasFail, '\n', txt.replace(/\n+/g, ' | ').slice(0, 200));
await p.screenshot({ path: 'rob-t3.png' });

console.log('console errors:', errs.length, 'non-resource:', errs.filter(e => !/^Failed to load resource/.test(e)));
await b.close();
