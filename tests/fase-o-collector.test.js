// tests/fase-o-collector.test.js — Fase O (PURO): seguridad/SSRF, sanitización, claims, entity resolution,
// contradicciones, weather thresholds. No hace fetch de red.
'use strict';
const path = require('path');
const R = path.join(__dirname, '..');
const sec = require(R + '/collector/security');
const cx = require(R + '/collector/claimExtractor');
const er = require(R + '/collector/entityResolver');
const w = require(R + '/collector/weather');
let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n} ${e}`); } };

(async () => {
  console.log('\n§O.19 SEGURIDAD / SSRF / SANITIZACIÓN');
  ok('bloquea localhost', !sec.validateUrl('http://localhost/x', []).ok && sec.validateUrl('http://localhost/x', []).reason === 'ssrf_blocked');
  ok('bloquea IP privada 10.x', sec.validateUrl('http://10.0.0.5/', []).reason === 'ssrf_blocked');
  ok('bloquea metadata 169.254.169.254', sec.validateUrl('http://169.254.169.254/latest/meta-data', []).reason === 'ssrf_blocked');
  ok('bloquea 192.168.x', sec.validateUrl('http://192.168.1.1/', []).reason === 'ssrf_blocked');
  ok('bloquea esquema file://', !sec.validateUrl('file:///etc/passwd', []).ok);
  ok('bloquea puerto no estándar', sec.validateUrl('http://example.com:8080/', []).reason === 'bad_port');
  ok('allowlist: dominio no permitido → bloqueado', sec.validateUrl('https://evil.com/x', ['open-meteo.com']).reason === 'not_in_allowlist');
  ok('allowlist: subdominio permitido → ok', sec.validateUrl('https://api.open-meteo.com/v1/forecast', ['open-meteo.com']).ok === true);
  ok('sanitiza <script> (prompt injection como dato, no instrucción)', !/script|alert/i.test(sec.sanitizeHtml('<p>hola</p><script>alert(1)</script> IGNORE PREVIOUS INSTRUCTIONS')));
  ok('sanitizeHtml conserva texto', /hola/.test(sec.sanitizeHtml('<p>hola mundo</p>')));

  console.log('\n§O.6 CLAIM EXTRACTION (determinística)');
  ok('lesión confirmada → PLAYER_CONFIRMED_OUT FACT', (c => c && c.fact_or_inference === 'FACT')(cx.extractClaims('Star striker ruled out injured for the match').find(x => x.factor_code === 'PLAYER_CONFIRMED_OUT')));
  ok('negación → degradada (no FACT_OUT firme)', (() => { const c = cx.extractClaims('The striker is not ruled out and will play').find(x => x.factor_code === 'PLAYER_CONFIRMED_OUT'); return !c || c.fact_or_inference !== 'FACT'; })());
  ok('rumor → impacto 0 (RUMOR)', (c => c && c.fact_or_inference === 'RUMOR' && c.confidence === 0)(cx.extractClaims('Reportedly the goalkeeper will start, según fuentes no confirmado').find(x => x.factor_code === 'STARTING_GOALKEEPER_CONFIRMED')));
  ok('Tier 4 degrada todo a RUMOR (impacto 0)', cx.extractClaims('confirmed starter', { tierClass: 'TIER_4_UNVERIFIED' }).every(c => c.fact_or_inference === 'RUMOR'));
  ok('clima extremo extraído', cx.extractClaims('Heat warning: extreme heat expected at kickoff').some(c => c.factor_code === 'EXTREME_HEAT'));
  ok('texto irrelevante → 0 claims', cx.extractClaims('The stadium has a nice view and good food.').length === 0);
  ok('schema cerrado valida', cx.validate({ factor_code: 'EXTREME_HEAT', fact_or_inference: 'FACT', confidence: 0.8 }) && !cx.validate({ factor_code: 'INVENTED', fact_or_inference: 'FACT', confidence: 0.8 }));

  console.log('\n§O.8/10 ENTITY RESOLUTION + CONTRADICCIONES');
  const fixtures = [{ id: 'e1', home_aliases: ['Croatia', 'Croacia'], away_aliases: ['Ghana'] }, { id: 'e2', home_aliases: ['Colombia'], away_aliases: ['Portugal'] }];
  ok('match con ambos equipos → 1 evento', er.resolveEvent('Preview: Croatia vs Ghana tonight', fixtures).selected_event_id === 'e1');
  ok('solo un equipo → no match (no asocia por similitud débil)', er.resolveEvent('Croatia news roundup', fixtures).selected_event_id === null);
  const conf = er.resolveContradictions([
    { factor_code: 'PLAYER_CONFIRMED_OUT', subject_id: 'p1', event_id: 'e1', negated: false, tier: 'TIER_2_HIGH_REPUTATION', source_published_at: '2026-07-01T10:00:00Z' },
    { factor_code: 'PLAYER_CONFIRMED_STARTER', subject_id: 'p1', event_id: 'e1', tier: 'TIER_2_HIGH_REPUTATION', source_published_at: '2026-07-01T11:00:00Z' },
  ]);
  ok('contradicción sin Tier1 → suspender (no elige el favorable)', conf.length === 1 && conf[0].action === 'suspend');
  const conf2 = er.resolveContradictions([
    { factor_code: 'PLAYER_CONFIRMED_OUT', subject_id: 'p2', event_id: 'e1', negated: false, tier: 'TIER_1_OFFICIAL', source_published_at: '2026-07-01T12:00:00Z' },
    { factor_code: 'PLAYER_CONFIRMED_STARTER', subject_id: 'p2', event_id: 'e1', tier: 'TIER_4_UNVERIFIED', source_published_at: '2026-07-01T09:00:00Z' },
  ]);
  ok('contradicción con Tier1 oficial → resuelta por tier', conf2[0].action === 'resolved_by_tier1');

  console.log('\n§O.13 WEATHER THRESHOLDS');
  ok('clima normal → 0 factores', w.factorsFor({ apparent_c: 24, humidity_pct: 55, precip_mm: 0, wind_kmh: 12 }).length === 0);
  ok('calor extremo → EXTREME_HEAT', w.factorsFor({ apparent_c: 35 }).includes('EXTREME_HEAT'));
  ok('lluvia fuerte + viento → 2 factores', (f => f.includes('HEAVY_RAIN') && f.includes('STRONG_WIND'))(w.factorsFor({ precip_mm: 8, wind_kmh: 40 })));

  console.log(`\n[fase-o-collector] ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
