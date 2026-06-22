// tests/ui-flags.test.js — Sprint 8.1 §41,§42,§44. Tests PUROS: resolución de flags UI, diccionario de copy
// (sin afirmación de alpha), componentes de estado, y que el código gatea la pantalla Rendimiento.
'use strict';
const path = require('path');
const fs = require('fs');
const R = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

// ---- ui-flags: resolución ----
function fresh() { delete require.cache[require.resolve(R + '/ui-flags')]; return require(R + '/ui-flags'); }
['UI_INTEGRATION_V2_ENABLED', 'UI_ADMIN_PREVIEW_ENABLED', 'UI_VERIFIED_PERFORMANCE_ENABLED', 'UI_OPPORTUNITY_TABS_ENABLED'].forEach(k => delete process.env[k]);
let uf = fresh();
let off = uf.resolveForUser(false);
ok('flags: todo off → todas las áreas false', Object.values(off).every(v => v === false));

process.env.UI_VERIFIED_PERFORMANCE_ENABLED = 'true'; // área on pero sin público ni preview
uf = fresh();
ok('flags: área on sin público/preview → sigue false', uf.resolveForUser(false).verifiedPerformance === false);

process.env.UI_INTEGRATION_V2_ENABLED = 'true'; // público on
uf = fresh();
ok('flags: público on + área on → true para todos', uf.resolveForUser(false).verifiedPerformance === true);
ok('flags: área OFF sigue false aunque público on', uf.resolveForUser(false).opportunityTabs === false);

delete process.env.UI_INTEGRATION_V2_ENABLED;
process.env.UI_ADMIN_PREVIEW_ENABLED = 'true'; // solo preview admin
uf = fresh();
ok('flags: admin preview → admin ve el área', uf.resolveForUser(true).verifiedPerformance === true);
ok('flags: admin preview → NO-admin no la ve', uf.resolveForUser(false).verifiedPerformance === false);
ok('flags: marca adminPreview cuando aplica', uf.resolveForUser(true).adminPreview === true);
['UI_VERIFIED_PERFORMANCE_ENABLED', 'UI_ADMIN_PREVIEW_ENABLED'].forEach(k => delete process.env[k]);

// ---- diccionario de copy (ui-kit) ----
const kit = require(R + '/public/ui-kit.js');
ok('copy: términos estables', kit.COPY.terms.pickGP === 'Pick GP' && kit.COPY.terms.valueSignal === 'Señal de Value');
ok('copy: empty de picks correcto (§10)', kit.COPY.picksEmpty === 'Hoy no hay Picks GP.');
ok('copy: empty verificable (§5)', /señales oficiales liquidadas/.test(kit.COPY.perf.verifiedEmpty));
ok('copy: aviso legacy (§5)', /sistema anterior/.test(kit.COPY.perf.legacyNotice) && /verificación criptográfica/.test(kit.COPY.perf.legacyNotice));
ok('copy: reemplazo de alpha (§6)', /información adicional frente al mercado/.test(kit.COPY.perf.alphaReplacement));
ok('copy: NO afirma alpha', !/prueba objetiva/i.test(JSON.stringify(kit.COPY)) && !/tenemos alpha real/i.test(JSON.stringify(kit.COPY)));
ok('copy: clasificación Value con texto, no solo color (§31)', kit.COPY.valueClass.strong.label === 'STRONG' && !!kit.COPY.valueClass.pass.help);

// ---- componentes de estado (§21) ----
ok('estados: featureDisabled devuelve op-state', /op-state/.test(kit.UIState.featureDisabled('x')) && /todavía no está disponible/i.test(kit.UIState.featureDisabled()));
ok('estados: staleData distinto de noData (§21 no usar el mismo vacío)', kit.UIState.staleData() !== kit.UIState.noData());
ok('estados: insufficientConsensus (§21)', /fuentes independientes/.test(kit.UIState.insufficientConsensus()));
ok('estados: error tiene kind error', /op-error/.test(kit.UIState.error()));

// ---- app.js: gating de la pantalla Rendimiento (§5) ----
const app = fs.readFileSync(R + '/public/app.js', 'utf8');
ok('app: renderRecord gatea por uiFlags.verifiedPerformance', /uiFlags && USER\.uiFlags\.verifiedPerformance\) return renderPerformance/.test(app));
ok('app: existe pantalla Rendimiento con segmentos', /function renderPerformance/.test(app) && /perfVerifiedHtml/.test(app) && /perfLegacyHtml/.test(app));
ok('app: marketScoreboardV2 sin afirmación de alpha', /function marketScoreboardV2/.test(app) && !/marketScoreboardV2[\s\S]{0,400}prueba objetiva/.test(app));
ok('app: share etiquetado verificable/histórico (§8)', /Compartir rendimiento verificable/.test(app) && /Compartir histórico/.test(app));

// ---- app.js: Oportunidades con sub-tabs + limpieza de lenguaje (§9-15) ----
ok('app: loadArb gatea por uiFlags.opportunityTabs', /uiFlags && USER\.uiFlags\.opportunityTabs\) return loadOpportunities/.test(app));
ok('app: existen sub-tabs Picks GP|Value|Arbitraje', /function loadOpportunities/.test(app) && /\['picks', 'Picks GP'\]/.test(app) && /\['value', 'Value'\]/.test(app) && /\['arb', 'Arbitraje'\]/.test(app));
ok('app: vista Arbitraje limpia (loadOppArb) sin Kelly/COMPRAR SÍ/MODEL EDGE', (() => { const m = app.match(/async function loadOppArb[\s\S]*?\n}\n/); const body = m ? m[0] : ''; return body && !/Kelly/.test(body) && !/COMPRAR S/.test(body) && !/MODEL EDGE/.test(body); })());
ok('app: chip etiqueta V2 gated (§16)', /uiFlags\.gpIntelligenceLabels[\s\S]{0,120}GP Intelligence V2 · Experimental/.test(app));
ok('app: loadValue/loadPicks aceptan contenedor destino', /async function loadValue\(rootSel\)/.test(app) && /async function loadPicks\(rootSel\)/.test(app));

// ---- app.js: navegación, metodología, acordeones GPI, estados operativos ----
ok('app: navegación gated (avatar/sheet por navigationCleanup)', /uiFlags && USER\.uiFlags\.navigationCleanup/.test(app) && /sheet-group/.test(app));
ok('app: pantalla Metodología sin fuentes privadas (§36)', /function renderMethodology/.test(app) && /no publicamos las fuentes internas|no sobre propiedad intelectual/i.test(app));
ok('app: acordeones GPI gated (§17)', /const acc = \(label, p\)[\s\S]{0,90}gpIntelligenceLabels/.test(app) && /gpi-acc/.test(app) && /Ver simulaciones \(Monte Carlo\)/.test(app) && /Ver lectura táctica/.test(app));
ok('app: estados operativos diferenciados en Value (§21)', /uiFlags\.operationalStates && window\.UIState/.test(app) && /UIState\.notConfigured/.test(app));
ok('app: empty de Picks usa COPY.picksEmpty (§10, no es error)', /COPY\.picksEmpty/.test(app));
ok('app: Seguidos meta 2 líneas gated (§25)', /fc-meta2/.test(app) && /function fmtKickoffLocal/.test(app));
ok('app: badge LIVE refleja stale gated (§33-34)', /DATOS RETRASADOS/.test(app) && /function setLive\(on, stale\)/.test(app) && /setLive\(true, stale\)/.test(app));
ok('css: a11y focus-visible + safe-area + reduced-motion (§29-31)', (() => { const css = fs.readFileSync(R + '/public/style.css', 'utf8'); return /:focus-visible/.test(css) && /safe-area-inset-bottom/.test(css) && /prefers-reduced-motion/.test(css); })());

console.log(`\nui-flags + ui-kit: ${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
