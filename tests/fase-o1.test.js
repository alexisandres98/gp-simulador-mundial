// tests/fase-o1.test.js — Fase O.1 (PURO): RSS/Atom parse, claims multilingües (FR/PT), cutover dry-run.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const ad = require(R + '/collector/adapters');
const cx = require(R + '/collector/claimExtractor');
const dry = require(R + '/shadow-ops/cutoverDryRun');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  console.log('\n§O.1 RSS/ATOM PARSE');
  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title>Croatia vs Ghana preview</title><link>https://x.com/a</link><pubDate>Sat, 27 Jun 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Star striker ruled out injured</p>]]></description></item>
    <item><title>Other news</title><link>https://x.com/b</link><pubDate>Sat, 27 Jun 2026 09:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const items = ad.parseFeed(rss);
  ok('parsea 2 items RSS', items.length === 2);
  ok('extrae title/link/pubDate', items[0].title.includes('Croatia') && items[0].link === 'https://x.com/a' && items[0].published_at);
  ok('sanitiza description (sin tags)', !/<p>/.test(items[0].summary) && /striker/.test(items[0].summary));
  const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Suspension confirmée</title><link href="https://y.com/c"/><updated>2026-06-27T08:00:00Z</updated><summary>Le joueur est suspendu</summary></entry></feed>`;
  const aitems = ad.parseFeed(atom);
  ok('parsea Atom entry con link href', aitems.length === 1 && aitems[0].link === 'https://y.com/c');

  console.log('\n§O.1 CLAIMS MULTILINGÜES');
  ok('EN injury', cx.extractClaims('Star striker ruled out injured').some(c => c.factor_code === 'PLAYER_CONFIRMED_OUT' && c.fact_or_inference === 'FACT'));
  ok('ES lesión', cx.extractClaims('El delantero está descartado por lesión').some(c => c.factor_code === 'PLAYER_CONFIRMED_OUT'));
  ok('FR suspension', cx.extractClaims('Le défenseur est suspendu pour le match').some(c => c.factor_code === 'PLAYER_SUSPENDED'));
  ok('PT fora do jogo', cx.extractClaims('O atacante está fora do jogo, cortado por lesão').some(c => c.factor_code === 'PLAYER_CONFIRMED_OUT'));
  ok('FR retorno a entrenamientos (INFERENCE)', cx.extractClaims('Le milieu est de retour à l\'entraînement').some(c => c.factor_code === 'PLAYER_RETURNED_TO_TRAINING'));
  ok('PT rumor → RUMOR', cx.extractClaims('Segundo a imprensa, o goleiro será titular, não confirmado').some(c => c.fact_or_inference === 'RUMOR'));
  ok('FR negación degrada', (() => { const c = cx.extractClaims('Le joueur n\'est pas absent et sera disponible').find(x => x.factor_code === 'PLAYER_CONFIRMED_OUT'); return !c || c.fact_or_inference !== 'FACT'; })());

  console.log('\n§O.1 CUTOVER DRY-RUN');
  const d = dry.dryRun();
  ok('contrato V2 completo (sin campos faltantes, suma 1)', d.contract.ok === true && d.contract.missing_fields.length === 0);
  ok('hardcodes V1 removidos (resolver intercambiable + oficial parametrizable)', d.hardcodes_removed === true);
  ok('rollback ready + cutover bloqueado', d.rollback_ready === true);
  ok('público OFF', d.public_off === true);
  ok('cero writes oficiales en el dry-run', d.writes_performed === 0 && d.picks_created === 0 && d.signals_created === 0);
  ok('veredicto DRY_RUN_OK', d.verdict === 'DRY_RUN_OK');

  console.log(`\n[fase-o1] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
