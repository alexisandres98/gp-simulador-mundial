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
// Fase Q.1: el flagship V2 movió las etiquetas literales de la UI al diccionario i18n (server-side, /api/i18n).
// Donde el copy visible vive ahora en el diccionario, verificamos el texto real allí; en app.js verificamos
// el cableado/gating. Así la cobertura de §8/§16/§17/§36 sigue intacta, adaptada al patrón nuevo.
const dict = fs.readFileSync(R + '/i18n/dictionary.js', 'utf8');
ok('app: renderRecord gatea por uiFlags.verifiedPerformance', /uiFlags && USER\.uiFlags\.verifiedPerformance\) return renderPerformance/.test(app));
ok('app: existe pantalla Rendimiento con segmentos', /function renderPerformance/.test(app) && /perfVerifiedHtml/.test(app) && /perfLegacyHtml/.test(app));
ok('app: marketScoreboardV2 sin afirmación de alpha', /function marketScoreboardV2/.test(app) && !/marketScoreboardV2[\s\S]{0,400}prueba objetiva/.test(app));
// §8: el share de rendimiento distingue VERIFICABLE de HISTÓRICO (legacy). app.js cablea sharePerf('verified'|'legacy')
// con textos diferenciados; las etiquetas de los botones viven en el diccionario (perf.share_verified|legacy).
ok('app: share etiquetado verificable/histórico (§8)', /function sharePerf/.test(app) && /Rendimiento VERIFICABLE/.test(app) && /Histórico \(legacy/.test(app) && /sharePerf\('verified'/.test(app) && /sharePerf\('legacy'/.test(app) && /'perf\.share_verified':\s*'[^']*verificable/i.test(dict) && /'perf\.share_legacy':\s*'[^']*histórico/i.test(dict));

// ---- app.js: Oportunidades con sub-tabs + limpieza de lenguaje (§9-15) ----
// Fase Q.1: el flagship V2 reemplazó el gate uiFlags.opportunityTabs por el acceso beta (USER.beta.opportunities.enabled),
// con cada sub-tab gateado individualmente por g.picks/g.value/g.arbitrage. Etiquetas vía oppT('nav.*') (diccionario).
ok('app: loadArb gatea por beta.opportunities.enabled (§9)', /USER\.beta && USER\.beta\.opportunities && USER\.beta\.opportunities\.enabled\) return loadOpportunities/.test(app));
ok('app: existen sub-tabs Picks GP|Value|Arbitraje', /function loadOpportunities/.test(app) && /\['picks', oppT\('nav\.picks'\), g\.picks\]/.test(app) && /\['value', oppT\('nav\.value'\), g\.value\]/.test(app) && /\['arb', oppT\('nav\.arbitrage'\), g\.arbitrage\]/.test(app) && /'nav\.value':\s*'Value'/.test(dict) && /'nav\.arbitrage':\s*'Arbitraje'/.test(dict));
ok('app: vista Arbitraje limpia (loadOppArb) sin Kelly/COMPRAR SÍ/MODEL EDGE', (() => { const m = app.match(/async function loadOppArb[\s\S]*?\n}\n/); const body = m ? m[0] : ''; return body && !/Kelly/.test(body) && !/COMPRAR S/.test(body) && !/MODEL EDGE/.test(body); })());
// §16: el chip "GP Intelligence V2 · Experimental" (scaffolding) fue reemplazado por el bloque GP Intelligence V2
// OFICIAL por partido, gateado por beta (USER.beta.matchesV2 && d.v2_requested). La honestidad ya no es un chip
// "Experimental" sino el estado EXPLÍCITO mpage.v2_unavailable cuando no hay V2 (sin fallback silencioso al modelo base).
ok('app: bloque GP Intelligence V2 gated sin fallback silencioso (§16)', /USER\.beta && USER\.beta\.matchesV2 && d\.v2_requested/.test(app) && /mpage\.gp_intelligence/.test(app) && /has_official_v2/.test(app) && /mpage\.v2_unavailable/.test(app) && /'mpage\.v2_unavailable_why':\s*'[^']*no se presenta como análisis con contexto actualizado/i.test(dict));
ok('app: loadValue/loadPicks aceptan contenedor destino', /async function loadValue\(rootSel\)/.test(app) && /async function loadPicks\(rootSel\)/.test(app));

// ---- app.js: navegación, metodología, acordeones GPI, estados operativos ----
ok('app: navegación gated (avatar/sheet por navigationCleanup)', /uiFlags && USER\.uiFlags\.navigationCleanup/.test(app) && /sheet-group/.test(app));
// §36: renderMethodology sigue existiendo; el copy de transparencia (definiciones sí, fuentes/IP no) se movió al
// diccionario en meth.footer/meth.subtitle. Verificamos el render del footer en app.js y el texto real en el diccionario.
ok('app: pantalla Metodología sin fuentes privadas (§36)', /function renderMethodology/.test(app) && /meth\.footer/.test(app) && /no publicamos las fuentes internas|no sobre propiedad intelectual/i.test(dict));
// §17: la lógica de acordeones gated (gpi-acc, gateada por uiFlags.gpIntelligenceLabels) sigue intacta en app.js;
// las etiquetas literales pasaron a claves i18n (sim.mc_acc, sim.tactical_acc), cuyo texto verificamos en el diccionario.
ok('app: acordeones GPI gated (§17)', /const acc = \(label, p\)[\s\S]{0,90}gpIntelligenceLabels/.test(app) && /gpi-acc/.test(app) && /sim\.mc_acc/.test(app) && /sim\.tactical_acc/.test(app) && /Ver simulaciones \(Monte Carlo\)/.test(dict) && /Ver lectura táctica/.test(dict));
ok('app: estados operativos diferenciados en Value (§21)', /uiFlags\.operationalStates && window\.UIState/.test(app) && /UIState\.notConfigured/.test(app));
ok('app: empty de Picks usa COPY.picksEmpty (§10, no es error)', /COPY\.picksEmpty/.test(app));
ok('app: Seguidos meta 2 líneas gated (§25)', /fc-meta2/.test(app) && /function fmtKickoffLocal/.test(app));
ok('app: badge LIVE refleja stale gated (§33-34)', /DATOS RETRASADOS/.test(app) && /function setLive\(on, stale\)/.test(app) && /setLive\(true, stale\)/.test(app));
ok('css: a11y focus-visible + safe-area + reduced-motion (§29-31)', (() => { const css = fs.readFileSync(R + '/public/style.css', 'utf8'); return /:focus-visible/.test(css) && /safe-area-inset-bottom/.test(css) && /prefers-reduced-motion/.test(css); })());

console.log(`\nui-flags + ui-kit: ${pass} ✓  ${fail} ✗`);
process.exit(fail ? 1 : 0);
