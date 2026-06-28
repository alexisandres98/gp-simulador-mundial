// tests/premium-i18n.test.js — Corte 4F. El diccionario local de /x (premium.js) debe tener paridad ES/EN
// y NO mezclar idiomas: claves clave deben diferir entre locales (si una quedó sin traducir, falla).
'use strict';
const path = require('path');
const fs = require('fs');
const R = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

const premium = fs.readFileSync(R + '/public/premium.js', 'utf8');
const m = premium.match(/var DICT = (\{[\s\S]*?\});\s*\n\s*var LANG/);
ok('DICT extraíble de premium.js', !!m);
let DICT = null;
try { DICT = eval('(' + m[1] + ')'); } catch (e) { ok('DICT evaluable', false, e.message); }

if (DICT && DICT.es && DICT.en) {
  const es = Object.keys(DICT.es).sort(), en = Object.keys(DICT.en).sort();
  console.log('\n== paridad de claves ==');
  const onlyEs = es.filter(k => !(k in DICT.en));
  const onlyEn = en.filter(k => !(k in DICT.es));
  ok('toda clave ES existe en EN', onlyEs.length === 0, onlyEs.join(','));
  ok('toda clave EN existe en ES', onlyEn.length === 0, onlyEn.join(','));

  console.log('\n== claves clave deben diferir entre locales (no quedaron sin traducir) ==');
  const mustDiffer = ['th_match', 'th_state', 'conf', 'mod_markets', 'mod_goals', 'mod_context', 'sim_go', 'sim_running',
    'g_today', 'g_tomorrow', 'm_search', 'm_stage_all', 'cta_view_match', 'gp_absent_sub', 'sim_price_na', 'sim_v_even',
    'st_finished', 'live_prob', 'mkt_sb', 'col_novig', 'fresh_data', 'fresh_price', 'goals_disc'];
  let differAll = true, same = [];
  mustDiffer.forEach(k => { if (DICT.es[k] != null && DICT.es[k] === DICT.en[k]) { differAll = false; same.push(k); } });
  ok('claves clave traducidas (ES≠EN)', differAll, 'iguales: ' + same.join(','));

  console.log('\n== anclas de traducción esperadas ==');
  ok('th_match ES=Partido / EN=Match', DICT.es.th_match === 'Partido' && DICT.en.th_match === 'Match');
  ok('conf ES=Confianza / EN=Confidence', DICT.es.conf === 'Confianza' && DICT.en.conf === 'Confidence');
  ok('sim_go ES=Simular cruce / EN=Simulate matchup', DICT.es.sim_go === 'Simular cruce' && DICT.en.sim_go === 'Simulate matchup');
  ok('gp_absent_sub localizado', /prepartido/.test(DICT.es.gp_absent_sub) && /pre-match/.test(DICT.en.gp_absent_sub));

  console.log('\n== sin frases del otro idioma en valores clave ==');
  // muestreo: ningún valor ES de estas claves contiene la versión EN, ni viceversa
  const sampleKeys = ['sim_price_na', 'goals_disc', 'gp_absent_final_sub', 'sim_thesis', 'sim_risk'];
  let clean = true, dirty = [];
  sampleKeys.forEach(k => { if (DICT.es[k] && DICT.en[k] && DICT.es[k] === DICT.en[k]) { clean = false; dirty.push(k); } });
  ok('frases largas traducidas (ES≠EN)', clean, dirty.join(','));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} premium-i18n: ${pass} pass / ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);
