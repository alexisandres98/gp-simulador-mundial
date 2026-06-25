// sportsbook-providers/source-catalog-seed.js — Post-shadow Bloque F. Semilla del catálogo de fuentes.
// REGLA: NO inventar relaciones. Solo se marca 'verified' una agrupación de operador cuando la propiedad es
// PÚBLICAMENTE documentada (evidence = hecho público, NO secreto estratégico). Todo lo demás → 'unverified'
// (cada casa su propio grupo, NO cuenta como voto independiente pleno para STRONG hasta verificar).
// 'duplicate_skin' = skin del mismo operador que otra casa ya presente (no suma independencia).
// El DTO público solo expone el número de grupos independientes válidos; internal_notes NUNCA se expone.
'use strict';

// independence_group: operadores que NO son independientes entre sus marcas. Propiedad pública/documentada.
const VERIFIED = [
  // Flutter Entertainment (propiedad pública)
  { code: 'betfair',     name: 'Betfair',      operator: 'flutter',  group: 'flutter',  region: 'eu' },
  { code: 'betfair_ex_eu', name: 'Betfair Exchange EU', operator: 'flutter', group: 'flutter', region: 'eu', dup: true },
  { code: 'paddypower',  name: 'Paddy Power',  operator: 'flutter',  group: 'flutter',  region: 'uk', dup: true },
  { code: 'sportsbet',   name: 'Sportsbet',    operator: 'flutter',  group: 'flutter',  region: 'au', dup: true },
  // Entain (propiedad pública)
  { code: 'ladbrokes',   name: 'Ladbrokes',    operator: 'entain',   group: 'entain',   region: 'uk' },
  { code: 'coral',       name: 'Coral',        operator: 'entain',   group: 'entain',   region: 'uk', dup: true },
  { code: 'bwin',        name: 'bwin',         operator: 'entain',   group: 'entain',   region: 'eu', dup: true },
  { code: 'sportingbet', name: 'Sportingbet',  operator: 'entain',   group: 'entain',   region: 'eu', dup: true },
  { code: 'ladbrokes_au', name: 'Ladbrokes AU', operator: 'entain',  group: 'entain',   region: 'au', dup: true },
  { code: 'neds',        name: 'Neds',         operator: 'entain',   group: 'entain',   region: 'au', dup: true },
  // Kindred Group (propiedad pública)
  { code: 'unibet',      name: 'Unibet',       operator: 'kindred',  group: 'kindred',  region: 'eu' },
  { code: 'unibet_uk',   name: 'Unibet UK',    operator: 'kindred',  group: 'kindred',  region: 'uk', dup: true },
  { code: 'unibet_eu',   name: 'Unibet EU',    operator: 'kindred',  group: 'kindred',  region: 'eu', dup: true },
  { code: '32red',       name: '32Red',        operator: 'kindred',  group: 'kindred',  region: 'uk', dup: true },
  // Betsson (propiedad pública)
  { code: 'betsson',     name: 'Betsson',      operator: 'betsson',  group: 'betsson',  region: 'eu' },
  { code: 'betsafe',     name: 'Betsafe',      operator: 'betsson',  group: 'betsson',  region: 'eu', dup: true },
  { code: 'nordicbet',   name: 'NordicBet',    operator: 'betsson',  group: 'betsson',  region: 'eu', dup: true },
  // 888/evoke (propiedad pública)
  { code: 'williamhill', name: 'William Hill', operator: 'evoke_888', group: 'evoke_888', region: 'uk' },
  { code: 'williamhill_us', name: 'William Hill US', operator: 'evoke_888', group: 'evoke_888', region: 'us', dup: true },
  { code: '888sport',    name: '888sport',     operator: 'evoke_888', group: 'evoke_888', region: 'uk', dup: true },
  // Independientes verificados (operador único, sin skins hermanas conocidas en el feed)
  { code: 'pinnacle',    name: 'Pinnacle',     operator: 'pinnacle', group: 'pinnacle', region: 'eu', role: 'sharp_reference' },
  { code: 'bet365',      name: 'bet365',       operator: 'bet365',   group: 'bet365',   region: 'uk' },
  { code: 'draftkings',  name: 'DraftKings',   operator: 'draftkings', group: 'draftkings', region: 'us' },
  { code: 'betmgm',      name: 'BetMGM',       operator: 'mgm',      group: 'mgm',      region: 'us' },
  { code: 'fanduel',     name: 'FanDuel',      operator: 'flutter',  group: 'flutter',  region: 'us', dup: true },
];

// Cada entrada: verification_status verified; las marcadas dup:true = duplicate_skin (no suman independencia).
function seedRows(dataProvider = 'the_odds_api') {
  return VERIFIED.map(b => ({
    data_provider: dataProvider, sportsbook_code: b.code, sportsbook_name: b.name,
    operator_group: b.operator, independence_group: b.group, source_role: b.role || 'market_consensus',
    region: b.region, jurisdiction: b.region,
    verification_status: b.dup ? 'duplicate_skin' : 'verified',
    evidence: { ownership: 'public', operator: b.operator },  // hecho público, no secreto
  }));
}

module.exports = { seedRows, VERIFIED };
