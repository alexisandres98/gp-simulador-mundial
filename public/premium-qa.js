/* premium-qa.js — Corte 2.1 A.8. Fixtures DETERMINÍSTICOS para QA del cockpit (Live / finalizado) en preview
   interno. Se sirve y se inyecta SOLO cuando GP_PREMIUM_QA_ENABLED=true en el server (en prod el flag está
   apagado → este archivo da 404 y no se carga). NUNCA toca la DB real ni se mezcla con datos de producción;
   son objetos sintéticos con la MISMA forma que /api/beta/match y /api/match. Navegá a #match/qa-live o
   #match/qa-finished para renderizarlos. window.__GP_QA.get(eid) → { beta, fx }. */
(function () {
  'use strict';
  var ISO = function (msAgo) { return new Date(Date.now() - (msAgo || 0)).toISOString(); };
  var xi = function (names) { return names.map(function (n, i) { return { id: 'q' + i, name: n, position: ['GK', 'DEF', 'MID', 'FWD'][Math.min(3, Math.floor(i / 3))], number: i + 1, status: 'available' }; }); };

  function betaBase(over) {
    var b = {
      header: { event_id: over.event_id, home: { team_id: 'BRA', name_fallback: 'Brasil' }, away: { team_id: 'ARG', name_fallback: 'Argentina' }, competition_code: 'FIFA_WORLD_CUP_2026', stage_code: 'SF', kickoff_at: over.kickoff_at, venue: 'MetLife Stadium', status_code: over.status_code },
      probability: { market_code: '1X2', period_code: 'REGULATION', period_note_code: 'REGULATION_90', outcomes: [
        { outcome_code: 'HOME', team_ref: 'home', gp_probability: 0.42, market_probability: 0.40 },
        { outcome_code: 'DRAW', team_ref: null, gp_probability: 0.27, market_probability: 0.28 },
        { outcome_code: 'AWAY', team_ref: 'away', gp_probability: 0.31, market_probability: 0.32 }
      ], sums_to_one: true, sum: 1 },
      qualify: null,
      analysis: { context_state_code: 'FULL_CONTEXT', base_vector: { HOME: 0.40, DRAW: 0.28, AWAY: 0.32 }, final_vector: { HOME: 0.42, DRAW: 0.27, AWAY: 0.31 }, context_adjustments: { HOME: 0.02, DRAW: -0.01, AWAY: -0.01 }, context_moved_line: true,
        applied_factors: [{ factor_code: 'FORM', category_code: 'PERFORMANCE', subject_team_id: 'BRA', direction_code: 'HOME', applied_impact: 8.2, evidence_class: 'FACT', confidence: 0.8, timestamp_quality_code: 'SOURCE_PUBLISHED' }, { factor_code: 'AVAILABILITY', category_code: 'SQUAD', subject_team_id: 'ARG', direction_code: 'AWAY', applied_impact: -4.1, evidence_class: 'FACT', confidence: 0.7, timestamp_quality_code: 'SOURCE_PUBLISHED' }],
        evaluated_factors: [{ factor_code: 'FORM' }, { factor_code: 'AVAILABILITY' }, { factor_code: 'SOLIDITY' }, { factor_code: 'REST' }], factor_count: 6, source_count: 3, data_freshness_code: 'FRESH', context_completeness: 0.85 },
      risks: ['MODEL_DISAGREEMENT', 'EARLY_TRACK_RECORD'],
      confidence_code: 'MEDIUM',
      has_official_v2: true,
      updated_at: over.updated_at,
      goal_insights: { informational: true, expected_goals: { HOME: 1.6, AWAY: 1.2, TOTAL: 2.8 }, over_under: { '1.5': { over: 0.78, under: 0.22 }, '2.5': { over: 0.54, under: 0.46 }, '3.5': { over: 0.31, under: 0.69 } }, btts: { yes: 0.58, no: 0.42 }, top_scores: [{ score: '2-1', probability: 0.12 }, { score: '1-1', probability: 0.11 }, { score: '2-0', probability: 0.08 }, { score: '1-0', probability: 0.07 }] }
    };
    b.header.event_id = over.event_id;
    return b;
  }

  function fxBase(over) {
    return {
      id: 'QA', status: over.status, minute: over.minute, score: over.score,
      modelProbabilities: over.modelProbabilities,
      marketPrices: [
        { venue: 'Polymarket', side: 'home', price: 0.44, bid: 0.43, ask: 0.45, volume: 820000, url: '#' },
        { venue: 'Polymarket', side: 'draw', price: 0.28, bid: 0.27, ask: 0.29, volume: 310000, url: '#' },
        { venue: 'Polymarket', side: 'away', price: 0.28, bid: 0.27, ask: 0.29, volume: 295000, url: '#' }
      ],
      odds: [{ book: 'Bet365', home: 2.10, draw: 3.40, away: 3.30 }],
      events: over.events,
      statistics: over.statistics,
      lineups: { home: { confirmed: true, formation: '4-3-3', coach: 'Dorival Júnior', startXI: xi(['Alisson', 'Danilo', 'Marquinhos', 'G. Magalhães', 'Wendell', 'Bruno G.', 'Lucas Paquetá', 'Rodrygo', 'Raphinha', 'Vinícius Jr.', 'Endrick']) }, away: { confirmed: true, formation: '4-4-2', coach: 'Lionel Scaloni', startXI: xi(['E. Martínez', 'Molina', 'Otamendi', 'Romero', 'Tagliafico', 'De Paul', 'Mac Allister', 'Enzo F.', 'Di María', 'L. Martínez', 'J. Álvarez']) } },
      injuries: [{ player: 'Neymar', side: 'home', status: 'injured', reason: 'Rodilla' }],
      recentForm: { home: { played: 5, results: ['W', 'W', 'D', 'W', 'L'], goalsFor: 12, goalsAgainst: 5, streak: '1L', last: [] }, away: { played: 5, results: ['W', 'D', 'W', 'W', 'D'], goalsFor: 9, goalsAgainst: 4, streak: '1D', last: [] } },
      news: [],
      providerStatus: { usedApiFootball: true, usedEspnFallback: false, usedManualFallback: false, lastUpdated: over.updatedAt },
      updatedAt: over.updatedAt
    };
  }

  var SCENARIOS = {
    'qa-live': function () {
      return {
        beta: betaBase({ event_id: 'qa-live', kickoff_at: ISO(67 * 60000), status_code: 'LIVE', updated_at: ISO(90000) }),
        fx: fxBase({ status: 'live', minute: 67, score: { home: 1, away: 1 }, updatedAt: ISO(40000),
          modelProbabilities: { homeWin: 0.47, draw: 0.27, awayWin: 0.26, xgHome: 1.6, xgAway: 1.2, likelyScore: '2-1', live: true },
          events: [ { minute: 23, type: 'goal', teamName: 'Brasil', player: 'Rodrygo', side: 'home' }, { minute: 41, type: 'yellow', teamName: 'Argentina', player: 'De Paul', side: 'away' }, { minute: 58, type: 'goal', teamName: 'Argentina', player: 'J. Álvarez', side: 'away' }, { minute: 62, type: 'subst', teamName: 'Brasil', player: 'Endrick', side: 'home' } ],
          statistics: { home: { possession: 54, shots: 11, shotsOnTarget: 4, corners: 6, fouls: 9, xg: 1.6 }, away: { possession: 46, shots: 8, shotsOnTarget: 3, corners: 3, fouls: 12, xg: 1.2 } } })
      };
    },
    'qa-finished': function () {
      return {
        beta: betaBase({ event_id: 'qa-finished', kickoff_at: ISO(140 * 60000), status_code: 'FINISHED', updated_at: ISO(140 * 60000) }),
        fx: fxBase({ status: 'final', minute: 90, score: { home: 2, away: 1 }, updatedAt: ISO(20 * 60000),
          modelProbabilities: { homeWin: 0.42, draw: 0.27, awayWin: 0.31, xgHome: 1.6, xgAway: 1.2, likelyScore: '2-1', live: false },
          events: [ { minute: 23, type: 'goal', teamName: 'Brasil', player: 'Rodrygo', side: 'home' }, { minute: 58, type: 'goal', teamName: 'Argentina', player: 'J. Álvarez', side: 'away' }, { minute: 84, type: 'goal', teamName: 'Brasil', player: 'Vinícius Jr.', side: 'home' } ],
          statistics: { home: { possession: 53, shots: 15, shotsOnTarget: 6, corners: 8, fouls: 11, xg: 2.1 }, away: { possession: 47, shots: 9, shotsOnTarget: 3, corners: 4, fouls: 13, xg: 1.0 } } })
      };
    }
  };

  window.__GP_QA = {
    get: function (eid) { var f = SCENARIOS[eid]; return f ? f() : null; },
    scenarios: Object.keys(SCENARIOS)
  };
})();
