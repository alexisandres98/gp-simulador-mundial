// canonical-graph/fixtures/golden.js — golden dataset validado manualmente (Sprint 2).
// ≥10 matched, ≥10 conditional, ≥10 rejected, ≥10 needs_review. Datos sanitizados (sin tokens).
// Cada caso: { id, category, a:{market,provider}, b:{market,provider}, expect:{event?, market?, outcome?} }.
'use strict';

// ---- builders ----
const pmChamp = (team, x = {}) => ({ provider: 'polymarket', market: { conditionId: '0xPM_' + team, groupItemTitle: team, question: `Will ${team} win the World Cup?`, description: x.desc || `Resolves YES if ${team} wins the FIFA World Cup 2026 (tournament winner).`, active: true, closed: false, acceptingOrders: true, ...x.extra } });
const ksChamp = (team, x = {}) => ({ provider: 'kalshi', market: { ticker: 'KX_' + team, event_ticker: 'KXMENWORLDCUP-26', title: `${team} to win the World Cup`, yes_sub_title: team, rules_primary: x.rules || `Market resolves Yes if ${team} wins the FIFA World Cup 2026 tournament.`, status: 'active', ...x.extra } });
// match market: title con ambos equipos + reglas que fijan periodo/empate/penales
const pmMatch = (a, b, x = {}) => ({ provider: 'polymarket', market: { conditionId: '0xPMM_' + a + b + (x.tag || ''), groupItemTitle: `${a}`, question: `${a} vs ${b} — ${x.q || 'match winner'}`, description: x.desc || '', close_time: x.start || '2026-06-21T16:00:00Z', active: true, ...x.extra } });
const ksMatch = (a, b, x = {}) => ({ provider: 'kalshi', market: { ticker: 'KXM_' + a + b + (x.tag || ''), event_ticker: 'KXWC-MATCH', title: `${a} vs ${b} ${x.q || 'match winner'}`, yes_sub_title: a, rules_primary: x.rules || '', close_time: x.start || '2026-06-21T16:00:00Z', status: 'active', ...x.extra } });

const TEAMS10 = ['Brazil', 'Argentina', 'Spain', 'France', 'England', 'Netherlands', 'Germany', 'Portugal', 'Uruguay', 'Mexico'];

const cases = [];

// ---- 10 MATCHED: champion del mismo equipo, ambos proveedores, mismas reglas ----
for (const t of TEAMS10) cases.push({ id: 'M_champ_' + t, category: 'matched', a: pmChamp(t), b: ksChamp(t), expect: { event: 'matched', market: 'matched', outcome: 'matched' } });

// ---- 10 CONDITIONAL: mismo evento, diferencia MATERIAL (solo conflicto differencing) ----
// Reglas 2-way (sin empate) para aislar el conflicto a periodo/penales/qualify/postponement.
const ET2 = 'Winner of the match including extra time. Two-way moneyline, no draw.';
const REG2 = 'Winner of the match within 90 minutes regulation. Two-way, no draw.';
const PEN = 'Winner of the match including extra time and penalties. Two-way, no draw.';
const ETNOPEN = 'Winner of the match including extra time. No penalties. Two-way, no draw.';
const mkPeriod = (a, b) => ({ id: 'C_period_' + a + b, category: 'conditional', a: pmMatch(a, b, { q: 'to win the match', desc: ET2 }), b: ksMatch(a, b, { q: 'to win the match', rules: REG2 }), expect: { event: 'matched', market: 'conditional' } });
const mkPen = (a, b) => ({ id: 'C_pen_' + a + b, category: 'conditional', a: pmMatch(a, b, { q: 'to win the match', desc: PEN }), b: ksMatch(a, b, { q: 'to win the match', rules: ETNOPEN }), expect: { market: 'conditional' } });
const mkQualify = (a, b) => ({ id: 'C_qualify_' + a + b, category: 'conditional', a: pmMatch(a, b, { q: 'to win the match', desc: ET2 }), b: ksMatch(a, b, { q: 'to qualify', rules: 'Resolves Yes if ' + a + ' advances to the next round (qualification).' }), expect: { market: 'conditional' } });
const mkPostpone = (a, b) => ({ id: 'C_postpone_' + a + b, category: 'conditional', a: pmMatch(a, b, { q: 'to win the match', desc: ET2 + ' Void if postponed.' }), b: ksMatch(a, b, { q: 'to win the match', rules: ET2 + ' Market remains open if rescheduled.' }), expect: { market: 'conditional' } });
cases.push(mkPeriod('Brazil', 'Argentina'), mkPeriod('Spain', 'France'), mkPeriod('Mexico', 'Brazil'));
cases.push(mkPen('England', 'Netherlands'), mkPen('Portugal', 'Uruguay'));
cases.push(mkQualify('Germany', 'Portugal'), mkQualify('Netherlands', 'Germany'));
cases.push(mkPostpone('Uruguay', 'Mexico'));
cases.push(mkPeriod('France', 'England'), mkPen('Brazil', 'Spain'));

// ---- 10 REJECTED ----
cases.push({ id: 'R_tourn_vs_match', category: 'rejected', a: pmChamp('Spain'), b: ksMatch('Spain', 'France', { q: 'to win the match', rules: REG2 }), expect: { event: 'rejected' } });
cases.push({ id: 'R_diff_match', category: 'rejected', a: pmMatch('Brazil', 'Argentina'), b: ksMatch('Brazil', 'Germany'), expect: { event: 'rejected' } });
cases.push({ id: 'R_women_vs_men', category: 'rejected', a: pmChamp('Brazil'), b: ksChamp('Brazil', { extra: { title: 'Brazil to win the Women\'s World Cup', yes_sub_title: 'Brazil women' }, rules: 'Yes if Brazil wins the FIFA Women\'s World Cup.' }), expect: { event: 'rejected' } });
cases.push({ id: 'R_u20_vs_senior', category: 'rejected', a: pmChamp('Argentina'), b: ksChamp('Argentina', { extra: { title: 'Argentina to win the U-20 World Cup' }, rules: 'Yes if Argentina wins the FIFA U-20 World Cup.' }), expect: { event: 'rejected' } });
cases.push({ id: 'R_first_half', category: 'rejected', a: pmMatch('France', 'England', { q: 'to win the match', desc: REG2 }), b: ksMatch('France', 'England', { q: 'to win the first half', rules: 'Winner of the first half only.', extra: {} }), expect: { market: 'rejected' } });
cases.push({ id: 'R_draw_included', category: 'rejected', a: pmMatch('Germany', 'Portugal', { q: 'match result 1x2', desc: '1X2: home, draw or away. Draw possible.' }), b: ksMatch('Germany', 'Portugal', { q: 'to win the match', rules: 'Two-way moneyline, no draw. Winner including extra time.' }), expect: { market: 'rejected' } });
cases.push({ id: 'R_diff_competition', category: 'rejected', a: pmChamp('Brazil'), b: ksChamp('Brazil', { extra: { title: 'Brazil to win Copa America', event_ticker: 'KXCOPA' }, rules: 'Yes if Brazil wins Copa America 2026.' }), expect: { event: 'rejected' } });
cases.push({ id: 'R_date_far', category: 'rejected', a: pmMatch('Uruguay', 'Mexico', { start: '2026-06-21T16:00:00Z' }), b: ksMatch('Uruguay', 'Mexico', { start: '2026-06-25T16:00:00Z' }), expect: { event: 'rejected' } });
cases.push({ id: 'R_outcome_wrong_team', category: 'rejected', a: pmChamp('Brazil'), b: ksChamp('Argentina'), expect: { event: 'matched', market: 'matched', outcome: 'rejected' } });
cases.push({ id: 'R_status_cancelled', category: 'rejected', a: pmChamp('France'), b: ksChamp('France', { extra: { status: 'settled' } }), expect: { market: 'rejected' } });

// ---- 10 NEEDS_REVIEW (ambiguo / datos faltantes) ----
cases.push({ id: 'NR_no_rules', category: 'needs_review', a: pmMatch('Brazil', 'Argentina', { desc: '' }), b: ksMatch('Brazil', 'Argentina', { rules: '' }), expect: { market: 'needs_review' } });
cases.push({ id: 'NR_unknown_alias', category: 'needs_review', a: { provider: 'polymarket', market: { conditionId: '0xUNK', groupItemTitle: 'Wakanda', question: 'Will Wakanda win the World Cup?', description: 'tournament winner', active: true } }, b: ksChamp('Brazil'), expect: { event: 'needs_review' } });
cases.push({ id: 'NR_no_timestamp_match', category: 'needs_review', a: pmMatch('Spain', 'France', { start: null, desc: '' }), b: ksMatch('Spain', 'France', { start: null, rules: '' }), expect: { market: 'needs_review' } });
cases.push({ id: 'NR_one_participant_match', category: 'needs_review', a: { provider: 'polymarket', market: { conditionId: '0xONE', groupItemTitle: 'Brazil', question: 'Brazil to win', description: '', close_time: '2026-06-21T16:00:00Z', active: true } }, b: ksMatch('Brazil', 'Argentina', { rules: '' }), expect: { market: 'needs_review' } });
cases.push({ id: 'NR_one_participant_3', category: 'needs_review', a: { provider: 'polymarket', market: { conditionId: '0xONE3', groupItemTitle: 'England', question: 'England to win', description: '', close_time: '2026-06-22T16:00:00Z', active: true } }, b: ksMatch('England', 'Netherlands', { rules: '', start: '2026-06-22T16:00:00Z' }), expect: { market: 'needs_review' } });
cases.push({ id: 'NR_no_rules_2', category: 'needs_review', a: pmMatch('England', 'Netherlands', { desc: '' }), b: ksMatch('England', 'Netherlands', { rules: '' }), expect: { market: 'needs_review' } });
cases.push({ id: 'NR_no_rules_3', category: 'needs_review', a: pmMatch('Germany', 'Portugal', { desc: '' }), b: ksMatch('Germany', 'Portugal', { rules: '' }), expect: { market: 'needs_review' } });
cases.push({ id: 'NR_no_rules_4', category: 'needs_review', a: pmMatch('Uruguay', 'Mexico', { desc: '' }), b: ksMatch('Uruguay', 'Mexico', { rules: '' }), expect: { market: 'needs_review' } });
cases.push({ id: 'NR_one_participant_2', category: 'needs_review', a: { provider: 'polymarket', market: { conditionId: '0xONE2', groupItemTitle: 'Spain', question: 'Spain to win', description: '', close_time: '2026-06-21T16:00:00Z', active: true } }, b: ksMatch('Spain', 'France', { rules: '' }), expect: { market: 'needs_review' } });
cases.push({ id: 'NR_no_rules_5', category: 'needs_review', a: pmMatch('Portugal', 'Uruguay', { desc: '' }), b: ksMatch('Portugal', 'Uruguay', { rules: '' }), expect: { market: 'needs_review' } });

module.exports = { cases, pmChamp, ksChamp, pmMatch, ksMatch };
