// tests/observer-narrate.test.js — capa de narrativa del contexto (por qué el sistema marcó a un jugador).
'use strict';
const { narratePlayer, reasonOf } = require('../observer/narrate');

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } }

console.log('== reasonOf (keyword → naturaleza) ==');
t('enfermedad', reasonOf('gastro') === 'ILLNESS' && reasonOf('illness') === 'ILLNESS' && reasonOf('fiebre') === 'ILLNESS');
t('golpe', reasonOf('a knock') === 'KNOCK' && reasonOf('molestias') === 'KNOCK');
t('sanción', reasonOf('suspended') === 'SUSPENSION' && reasonOf('acumulacion de amarillas') === 'SUSPENSION');
t('lesión', reasonOf('ruled out') === 'INJURY' && reasonOf('lesion') === 'INJURY');
t('duda genérica', reasonOf('fitness test') === 'FITNESS_DOUBT');
t('desconocido → null', reasonOf('random noise xyz') === null);

console.log('== narratePlayer ==');
const haaland = narratePlayer({ player: 'Erling Haaland', status: 'DOUBT', prob_miss: 0.45, corroborated: false, source_count: 1, evidence: [{ category: 'DOUBT', keyword: 'gastro' }] });
t('devuelve es + en + reason_code', haaland && haaland.es && haaland.en && haaland.reason_code === 'ILLNESS');
t('menciona la naturaleza (malestar/enfermedad)', /malestar|enfermedad/.test(haaland.es));
t('menciona el efecto en el modelo', /probabilidad de ser titular/.test(haaland.es));
t('fuente única → sin confirmar del todo', /sin confirmar/.test(haaland.es));
t('EN paralelo', /illness|stomach/.test(haaland.en) && /probability of starting/.test(haaland.en));

const multi = narratePlayer({ player: 'X', status: 'DOUBT', prob_miss: 0.45, corroborated: true, source_count: 3, evidence: [{ category: 'DOUBT', keyword: 'illness' }] });
t('multi-fuente → varias fuentes independientes', /varias fuentes/.test(multi.es));

const susp = narratePlayer({ player: 'Onana', status: 'SUSPENDED', prob_miss: 0.95, corroborated: true, source_count: 2, evidence: [{ category: 'SUSPENDED', keyword: 'suspended' }] });
t('OUT/SUSPENDED → fuera del once + ajuste de generación', /fuera del once/.test(susp.es) && /generacion|generación/.test(susp.es.normalize('NFC')));

t('NO revela fuente ni titular', !/BBC|ESPN|Marca|http|\.com/.test(haaland.es + multi.es + susp.es));
t('status OK → null (nada que narrar)', narratePlayer({ player: 'Y', status: 'OK', prob_miss: 0 }) === null);
t('lang es → solo es', (function () { var r = narratePlayer({ player: 'Z', status: 'DOUBT', prob_miss: 0.5, evidence: [{ category: 'DOUBT', keyword: 'gastro' }] }, { lang: 'es' }); return r.es && !r.en; })());

console.log(`\n[observer-narrate] ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
