// tests/q11-flagship.test.js — Fase Q.1.1 §9. Suite PURA (sin DB ni browser) del flagship y la integración V2:
//   · gating de flags §21 (Oportunidades) + GP_MATCHES_V2_UI_ENABLED (Partidos V2),
//   · paridad i18n ES/EN (0 keys faltantes) + ausencia de copy "V1/V2/challenger" en strings de cliente,
//   · neutralidad de los DTOs (model_label CURRENT/PREVIOUS, nunca "V1/V2"; sin secretos).
// Reproducible: `node tests/q11-flagship.test.js` (o `npm run test:q11`).
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };
const fresh = (m) => { delete require.cache[require.resolve(R + '/' + m)]; return require(R + '/' + m); };
const OPP_ENVS = ['GP_BETA_UI_ENABLED', 'GP_BETA_ALLOWLIST', 'GP_OPPORTUNITIES_PICKS_ENABLED', 'GP_OPPORTUNITIES_VALUE_ENABLED', 'GP_OPPORTUNITIES_ARBITRAGE_ENABLED', 'GP_ARBITRAGE_UI_ENABLED', 'GP_MATCHES_V2_UI_ENABLED'];
const clear = () => OPP_ENVS.forEach((k) => delete process.env[k]);

console.log('\n== §21/§4 gating Oportunidades flagship ==');
clear();
let F = fresh('gp-product/flags');
let admin = F.resolveForUser({ email: 'a@b.com', isAdmin: true });
ok('default (todo off) → opportunities.enabled false (flagship inerte)', admin.opportunities.enabled === false);
ok('default → matchesV2 false', admin.matchesV2 === false);
// flags §21 ON pero beta OFF → el flag NO sustituye acceso
process.env.GP_OPPORTUNITIES_PICKS_ENABLED = 'true'; process.env.GP_OPPORTUNITIES_VALUE_ENABLED = 'true'; process.env.GP_OPPORTUNITIES_ARBITRAGE_ENABLED = 'true'; process.env.GP_ARBITRAGE_UI_ENABLED = 'true'; process.env.GP_MATCHES_V2_UI_ENABLED = 'true';
F = fresh('gp-product/flags');
admin = F.resolveForUser({ email: 'a@b.com', isAdmin: true });
ok('beta OFF + OPP/matches ON → admin opportunities.enabled false (flag no es auth)', admin.opportunities.enabled === false);
ok('beta OFF + matches ON → admin.matchesV2 false', admin.matchesV2 === false);
// beta ON + flags ON → admin/QA ven; público no
process.env.GP_BETA_UI_ENABLED = 'true'; process.env.GP_BETA_ALLOWLIST = 'qa@gp.com';
F = fresh('gp-product/flags');
admin = F.resolveForUser({ email: 'a@b.com', isAdmin: true });
const qa = F.resolveForUser({ email: 'qa@gp.com', isAdmin: false });
const pub = F.resolveForUser({ email: 'u@x.com', isAdmin: false });
const anon = F.resolveForUser({ email: null, isAdmin: false });
ok('beta ON + ON → admin ve Oportunidades (picks/value/arb)', admin.opportunities.enabled && admin.opportunities.picks && admin.opportunities.value && admin.opportunities.arbitrage);
ok('beta ON + ON → admin.matchesV2 true', admin.matchesV2 === true);
ok('beta ON + ON → QA allowlist ve Oportunidades', qa.opportunities.enabled === true);
ok('beta ON + ON → PÚBLICO NO ve Oportunidades', pub.opportunities.enabled === false);
ok('beta ON + ON → público.matchesV2 false', pub.matchesV2 === false);
ok('anónimo nunca accede', anon.opportunities.enabled === false && anon.matchesV2 === false);
// Arbitraje exige además su UI flag
clear(); process.env.GP_BETA_UI_ENABLED = 'true'; process.env.GP_OPPORTUNITIES_ARBITRAGE_ENABLED = 'true';
F = fresh('gp-product/flags');
ok('arbitraje sin GP_ARBITRAGE_UI_ENABLED → off aunque OPP_ARBITRAGE on', F.resolveForUser({ email: 'a@b.com', isAdmin: true }).opportunities.arbitrage === false);

console.log('\n== §16 i18n paridad ES/EN + sin V1/V2 en cliente ==');
const dict = fresh('i18n/dictionary');
const esK = Object.keys(dict.DICT.es), enK = Object.keys(dict.DICT.en);
const gap = esK.filter((k) => !(k in dict.DICT.en)).concat(enK.filter((k) => !(k in dict.DICT.es)));
ok('paridad perfecta ES/EN (0 keys faltantes)', gap.length === 0, JSON.stringify(gap.slice(0, 8)));
ok('versión i18n >= i18n-6', /^i18n-(\d+)$/.test(dict.I18N_VERSION) && Number(dict.I18N_VERSION.split('-')[1]) >= 6, dict.I18N_VERSION);
const badCopy = [];
for (const loc of ['es', 'en']) for (const [k, v] of Object.entries(dict.DICT[loc])) {
  if (typeof v !== 'string') continue;
  if (/\bV1\b|\bV2\b|challenger|GP Intelligence V2|modelo base vs|control →/i.test(v)) badCopy.push(`${loc}:${k}`);
}
ok('ningún string de cliente menciona V1/V2/challenger', badCopy.length === 0, badCopy.slice(0, 6).join(', '));
ok('sim.label_gpi = nota hipotética §3 (ES)', /hipotética/i.test(dict.DICT.es['sim.label_gpi']));
ok('sim.label_gpi = hypothetical note §3 (EN)', /hypothetical/i.test(dict.DICT.en['sim.label_gpi']));
ok('keys clave de Partidos V2 presentes', ['mpage.gp_intelligence', 'mpage.v2_unavailable', 'match.context_completeness'].every((k) => dict.DICT.es[k] && dict.DICT.en[k]));
ok('keys del flagship presentes', ['opp.title', 'pick.badge', 'pick.previous_tag', 'value.view_analysis'].every((k) => dict.DICT.es[k] && dict.DICT.en[k]));

console.log('\n== §6/§12 neutralidad de DTOs (sin "V1/V2") ==');
const dto = fresh('gp-product/dto');
const pV2 = dto.pickDto({ pick_id: 'p1', canonical_event_id: 'e1', outcome_code: 'HOME', official_model: 'V2', published_odds: 2, minimum_odds: 1.8 });
const pV1 = dto.pickDto({ pick_id: 'p2', canonical_event_id: 'e2', outcome_code: 'AWAY', official_model: 'V1', published_odds: 3 });
ok('pick oficial V2 → model_label_code CURRENT (nunca "V2")', pV2.model_label_code === 'CURRENT');
ok('pick histórica V1 → model_label_code PREVIOUS (nunca "V1")', pV1.model_label_code === 'PREVIOUS');
ok('pickDto no expone official_model crudo', !('official_model' in pV2));
ok('pickDto outcome_code neutral', pV2.outcome_code === 'HOME' && pV1.outcome_code === 'AWAY');
const vc = dto.valueCard({ id: 'v1', canonical_event_id: 'e1', selection: 'home', classification: 'strong', best_decimal_odds: 2.1, best_sportsbook_name: 'BookX' });
ok('valueCard classification_code en mayúsculas neutral', vc.classification_code === 'STRONG');
ok('valueCard no expone secretos/source identities', !('source_name' in vc) && !('independence_sources' in vc));
const pj = JSON.stringify(pV2) + JSON.stringify(vc);
ok('DTOs no contienen "V1"/"V2" en el payload', !/\bV1\b|\bV2\b/.test(pj));

console.log('\n== §2 resolver inverso (firma, sin DB) ==');
const rr = fresh('signal-registry/resultResolver');
ok('resolveCanonicalByFixture exportada', typeof rr.resolveCanonicalByFixture === 'function');
ok('resolveCanonicalByTeams exportada', typeof rr.resolveCanonicalByTeams === 'function');
(async () => {
  ok('resolveCanonicalByFixture(null) → null sin tocar DB', (await rr.resolveCanonicalByFixture(null)) === null);
  ok('resolveCanonicalByTeams sin códigos → null', (await rr.resolveCanonicalByTeams(null, null, null, () => null)) === null);

  console.log(`\n${fail === 0 ? '✅' : '❌'} q11-flagship: ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
