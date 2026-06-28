/* premium.js — GP Intelligence · capa premium (terminal de inteligencia deportiva). Aislada en /x detrás de
   GP_PREMIUM_UI_ENABLED. Reusa los endpoints existentes (/api/beta/*, /api/i18n). Copy ES/EN local (no toca el
   diccionario compartido). No modifica datos, modelo, auth ni la UI actual. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var token = function () { try { return localStorage.getItem('wc_token') || ''; } catch (e) { return ''; } };
  var hdrs = function () { return token() ? { Authorization: 'Bearer ' + token() } : {}; };

  // ---------- i18n local ----------
  var DICT = {
    es: {
      nav_opps: 'Oportunidades', nav_matches: 'Partidos', nav_teams: 'Equipos', nav_sim: 'Simulador', nav_follow: 'Seguidos',
      nav_alerts: 'Alertas', nav_perf: 'Rendimiento', nav_groups: 'Grupos', nav_bracket: 'Bracket', nav_evo: 'Evolución',
      nav_registry: 'Registro', nav_method: 'Metodología', nav_admin: 'Admin', more: 'Más',
      search: 'Buscar equipos, partidos, mercados…', matches: 'partidos', live: 'en vivo', signals: 'señales hoy',
      title: 'Oportunidades', all: 'Todos', live_f: 'En vivo', upcoming_f: 'Próximos', picks: 'Picks GP', value: 'Value', arb: 'Arbitraje',
      updated: 'Actualizado hace {t}', board: 'Board de oportunidades',
      best_pick: 'Mejor pick GP', best_value: 'Mejor value', top_gap: 'Mayor desacuerdo GP–mercado', gap_tooltip: 'Una diferencia entre GP y el mercado no implica por sí sola una oportunidad ejecutable.', arb_verified: 'Arbitraje verificado',
      edge_adj: 'Edge ajustado', no_arb: 'Sin arbitraje ejecutable', no_arb_sub: 'GP sigue comparando precios y reglas', none: 'Sin datos aún',
      th_time: 'Hora', th_match: 'Partido', th_state: 'Estado', th_gp: 'Probabilidad GP', th_market: 'Mercado', th_price: 'Mejor precio', th_edge: 'Edge aj.', th_signal: 'Señal',
      st_live: 'EN VIVO', st_today: 'HOY', st_tom: 'MAÑANA', st_ft: 'Finalizado', st_upcoming: 'Próximo', st_finished: 'Finalizados', vs: 'vs',
      cockpit: 'Cockpit del partido', prob_gp: 'Probabilidad GP', score_prob: 'Marcador prob.',
      tab_summary: 'Resumen', tab_markets: 'Mercados', tab_context: 'Contexto', tab_stats: 'Estadísticas', tab_events: 'Eventos',
      memo: 'Decision memo', conf: 'Confianza', conf_hi: 'Alta', conf_mid: 'Media', conf_lo: 'Baja',
      verdict: 'Veredicto', thesis: 'Tesis', price: 'Precio', risk: 'Riesgo', invalidation: 'Invalidación',
      best_avail: 'Mejor precio disponible', view_pick: 'Ver pick GP', open_analysis: 'Análisis completo',
      vp1_t: 'Inteligencia explicable', vp1_s: 'No solo damos el número. Explicamos por qué y cómo cambia.',
      vp2_t: 'Precios reales', vp2_s: 'Múltiples casas, exchanges y mercados en un solo lugar.',
      vp3_t: 'Oportunidades reales', vp3_s: 'Picks, value y arbitraje verificados con edge ajustado.',
      vp4_t: 'Decisiones con confianza', vp4_s: 'Cada recomendación incluye riesgo, invalidación y registro.',
      memo_fav: '{team} es favorito y GP le asigna una probabilidad superior al mercado.',
      memo_even: 'Cruce parejo: GP y el mercado están alineados, sin un favorito neto claro.',
      memo_thesis_ctx: 'La diferencia se apoya en el contexto aplicado: {factors}.',
      memo_thesis_edge: 'GP ve valor por la brecha entre su probabilidad y el precio implícito del mercado.',
      memo_price: 'Hay value únicamente por encima de {odds}{book}.',
      memo_price_none: 'Sin un precio que supere el umbral de value ahora mismo.',
      memo_risk_default: 'Hay dudas de disponibilidad y un desacuerdo apreciable con el mercado.',
      memo_inval: 'Revisar si cambian las alineaciones o la cuota cae por debajo del mínimo.',
      loading: 'Cargando…', no_match: 'Elegí un partido del board para ver su cockpit.',
      reg90: '90 min · sin prórroga ni penales', updated_short: 'Actualizado',
      sig_strong: 'STRONG', sig_lean: 'LEAN', sig_watch: 'WATCH', sig_pass: 'PASS',
      comp: 'Copa Mundial de la FIFA 2026', none_active_pick: 'No hay Picks GP activas en este momento.',
      below_min: 'El precio actual está por debajo de la cuota mínima requerida.', below_min_short: 'Bajo mínimo', min_odds: 'Cuota mínima', cur_price: 'Mejor precio',
      cta_pick: 'Ver pick GP', cta_value: 'Ver oportunidad', cta_analysis: 'Ver análisis completo', cta_analyze: 'Analizar partido', cta_view_match: 'Ver partido', cta_arb: 'Ver arbitraje', cta_state: 'Ver estado',
      unc_copy: 'Las estimaciones internas no convergen del todo en este partido.',
      thesis_price_only: 'La diferencia proviene sobre todo del precio: el contexto disponible no aporta evidencia suficiente para sostener una lectura más fuerte.',
      thesis_ctx2: 'GP apoya su lectura en {factors}.',
      e_na: 'Datos no disponibles', e_nomarket: 'Mercado no cargado', e_lineups: 'Alineación pendiente', e_partial: 'Contexto parcial', e_noprice: 'Precio no verificable', e_gp_na: 'GP Intelligence no disponible', e_stale: 'Datos desactualizados',
      trust_data: 'Datos', trust_market: 'Mercado', trust_lineup: 'Alineación', trust_context: 'Contexto', t_sources: '{n} fuentes', t_pending: 'Pendiente', t_confirmed: 'Confirmada', t_broad: 'Amplio', t_partial: 'Parcial', t_base: 'Base', lus_probable: 'Probable', lus_unavailable: 'No disponible', lus_stale: 'Desactualizada',
      // ---- Corte 2: Match Cockpit profundo ----
      back: 'Oportunidades', open_cockpit: 'Abrir cockpit completo', refresh: 'Actualizar',
      fresh_data: 'Datos recientes', aging_data: 'Datos envejecidos', stale_data: 'Datos desactualizados',
      fresh_price: 'Precio reciente', aging_price: 'Precio envejecido', stale_price: 'Precio desactualizado',
      mod_memo: 'Decision memo', mod_prob: 'Probabilidad GP', mod_markets: 'Mercados', mod_context: 'Contexto', mod_goals: 'Proyección de goles', mod_live: 'En vivo',
      hero_gp: 'Probabilidad GP', hero_mkt: 'Mercado', hero_best: 'Mejor precio', hero_xg: 'xG esperado', hero_score: 'Marcador probable', period_90: '90 min · sin prórroga ni penales',
      ev_basis: 'Base de la evidencia',
      ev_pick: 'Pick GP publicada con seguimiento', ev_value: 'Value accionable sobre el precio actual', ev_analysis: 'Análisis GP del partido', ev_price_only: 'Lectura basada en el precio', ev_none: 'Sin evidencia accionable todavía',
      prob_base: 'Probabilidad base', prob_ctx: 'Ajuste de contexto', prob_final: 'Probabilidad GP',
      prob_explain: 'Partimos de la probabilidad base del modelo y aplicamos el contexto verificado para llegar a la Probabilidad GP.',
      prob_no_ctx: 'El contexto no movió la línea de forma material: la Probabilidad GP coincide con la base.',
      prob_base_only: 'Sin capa de contexto aplicada todavía. Se muestra la probabilidad base del modelo.',
      drivers: 'Factores que movieron la línea', evaluated: 'Factores evaluados', impact: 'Impacto', confidence: 'Confianza', evidence: 'Evidencia', freshness: 'Frescura',
      evaluated_note: 'Estos factores se evaluaron; su efecto está reflejado en el ajuste neto de contexto, no como un impacto aislado por factor.',
      ev_fact: 'Dato', ev_inference: 'Inferencia',
      tl_title: 'Línea de tiempo', tl_now: 'Estado actual', tl_base_gp: 'Base → Probabilidad GP',
      tl_empty: 'Aún no hay snapshots previos registrados para este partido. Los cambios de probabilidad, precio, noticias y alineaciones se registrarán a partir de ahora.',
      mkt_sb: 'Casas de apuestas', mkt_sb_best: 'Mejor precio por casa', mkt_ex: 'Exchange', mkt_pm: 'Prediction markets',
      col_provider: 'Fuente', col_outcome: 'Resultado', col_odds: 'Cuota', col_implied: 'Implícita', col_novig: 'Sin margen', col_move: 'Movimiento', col_liq: 'Liquidez', col_fresh: 'Frescura', na_short: 'No disponible', move_na: 'No registrado',
      mkt_none: 'Sin mercados cargados para este partido todavía.', move_untracked: 'El movimiento de precio aún no se registra para estas fuentes.', novig_na: 'Requiere el set completo de resultados.',
      ctx_none: 'Sin contexto verificado disponible para este partido todavía.', ctx_form: 'Forma reciente', ctx_inj: 'Bajas y disponibilidad', ctx_lineups: 'Alineaciones',
      ctx_form_line: '{team} llega con {rec} en sus últimos {n} ({gf} a favor, {ga} en contra).', ctx_inj_line: '{team}: {players}.', no_inj: 'sin bajas reportadas',
      goals_tag: 'En validación', goals_disc: 'Proyección estadística del modelo, en validación. No es una Pick ni un Value; sin recomendación de apuesta.',
      g_xg: 'xG esperado', g_total: 'Total esperado', g_ou: 'Más / Menos', g_btts: 'Ambos anotan', g_scores: 'Marcadores más probables', g_over: 'Más', g_under: 'Menos', g_yes: 'Sí', g_no: 'No', goals_none: 'Sin proyección de goles disponible.',
      live_min: 'Minuto', live_events: 'Eventos', live_stats: 'Estadísticas', live_prob: 'Probabilidad en vivo (modelo)', live_none: 'No hay datos en vivo verificados para este partido.',
      live_stale: 'Datos en vivo posiblemente desactualizados; pueden no reflejar el estado actual.',
      st_possession: 'Posesión', st_shots: 'Remates', st_sot: 'Al arco', st_corners: 'Córners', st_fouls: 'Faltas', st_xg: 'xG',
      evk_goal: 'Gol', evk_yellow: 'Amarilla', evk_red: 'Roja', evk_subst: 'Cambio', evk_var: 'VAR', evk_other: 'Evento',
      lineup_conf: 'Confirmada', lineup_proj: 'Proyectada', formation: 'Formación', news_title: 'Noticias', match_loading: 'Cargando partido…', match_404: 'No se pudo cargar el análisis de este partido.',
      // ---- Corte 3: Partidos + Simulador ----
      g_today: 'Hoy', g_tomorrow: 'Mañana', m_stage_all: 'Todas las fases', m_search: 'Buscar equipo…', m_empty: 'No hay partidos para este filtro.',
      gp_absent: 'Sin evaluación GP prepartido', gp_absent_sub: 'No se registró una evaluación GP prepartido para este encuentro.',
      gp_absent_final: 'Sin evaluación GP prepartido', gp_absent_final_sub: 'No se registró una evaluación GP prepartido para este encuentro. Se muestran el resultado y los datos del partido.',
      sim_pick: 'Elegí un equipo', sim_swap: 'Intercambiar', sim_go: 'Simular cruce', sim_running: 'Simulando…', sim_hypo: 'Simulación hipotética con el contexto disponible actualmente.',
      sim_empty: 'Elegí dos equipos para simular un cruce.', sim_empty_sub: 'GP cruza ambos con su contexto actual.', sim_err: 'No se pudo simular el cruce.',
      sim_thesis_na: 'Sin lectura disponible para este cruce.', sim_risk_na: 'Sin factores de cambio destacados.', sim_verdict_na: 'Cruce sin favorito neto claro.',
      sim_v_even: 'Cruce parejo, sin favorito neto.', sim_v_clear: '{team} es favorito claro.', sim_v_slight: '{team} es ligero favorito.',
      sim_thesis: 'GP da {fav} {favp}, {dog} {dogp} y empate {drawp}.', sim_thesis_factor: 'Pesan {factors}.', sim_risk: 'Una baja de última hora o un cambio de alineación pueden estrechar el margen.',
      sim_price_na: 'No se evalúa precio porque este cruce no corresponde a un mercado programado.', sim_hypo_tag: 'Hipotético', sim_runs: 'simulaciones',
      sim_montecarlo: 'Simulaciones Monte Carlo', sim_avg_goals: 'Goles promedio', sim_totals: 'Distribución de goles',
      sim_goals_disc: 'Proyección de goles en validación. Disponible para análisis; no genera Picks GP ni Value.',
      // ---- Corte 4H: superficies de torneo ----
      group: 'Grupo',
      tm_champion: 'Campeón', tm_final: 'Final', tm_semi: 'Semis', tm_qf: 'Cuartos', tm_advance: 'Avanza',
      tm_sim_note: 'Probabilidades de la simulación Monte Carlo del torneo con el contexto disponible.',
      tm_next: 'Próximo partido', tm_recent_matches: 'Partidos recientes', tm_vs_home: 'vs (local)', tm_vs_away: 'vs (visita)',
      grp_goals: 'GF:GC', grp_advance: 'Avanza', grp_advance_note: 'Avanza = probabilidad de pasar de fase (1º o 2º).',
      bk_tbd: 'Por definir', bk_reg90: '90 min', bk_note: 'Probabilidad 1X2 a 90 min (no es probabilidad de avanzar).',
      evo_insufficient: 'Evolución no disponible todavía', evo_insufficient_sub: 'Aún no hay suficientes snapshots reales ({n}). La evolución se registra a medida que el torneo avanza.',
      evo_champion: 'Probabilidad de campeón', evo_snapshots: 'snapshots', evo_trend: 'Tendencia', evo_now: 'Ahora', evo_note: 'Solo snapshots reales registrados; sin histórico fabricado.',
      reg_picks: 'Picks', reg_settled: 'Liquidadas', reg_winrate: 'Aciertos', reg_sample: 'Muestra', reg_insufficient: 'Insuficiente', reg_history: 'Historial de Picks',
      reg_odds: 'Cuota', reg_result: 'Resultado', reg_era: 'Modelo', reg_era_current: 'GP Intelligence', reg_era_previous: 'Etapa anterior', reg_empty: 'Aún no hay Picks registradas.',
      reg_insufficient_note: 'Muestra insuficiente para afirmar rentabilidad; el registro crece con cada Pick liquidada.',
      lc_pub: 'Publicada', lc_started: 'En juego', lc_await: 'Esperando liquidación', lc_settled: 'Liquidada',
      rc_win: 'Acierto', rc_loss: 'Fallo', rc_void: 'Anulada', rc_pending: 'Pendiente', rc_settled: 'Liquidada',
      me_gp_t: 'GP Intelligence', me_gp_b: 'Partimos de una probabilidad inicial estadística y aplicamos el contexto verificado para llegar a la Probabilidad GP final. No usamos nombres de versiones internas: lo que ves es la lectura GP vigente.',
      me_base_t: 'Base estadística', me_base_b: 'Ratings Elo por selección, modelo de goles de Poisson/Dixon-Coles y simulación Monte Carlo del torneo (miles de corridas) para estimar resultados y caminos.',
      me_ctx_t: 'Contexto', me_ctx_b: 'Forma reciente, disponibilidad del plantel, calidad, solidez y condiciones se evalúan y ajustan la probabilidad inicial. El efecto se refleja como ajuste neto, con su evidencia y frescura.',
      me_market_t: 'Mercado', me_market_b: 'Comparamos la Probabilidad GP contra casas, exchanges y prediction markets, mostrando precio implícito, sin margen y mejor precio cuando es posible.',
      me_unc_t: 'Incertidumbre', me_unc_b: 'Cada lectura incluye su nivel de confianza y los riesgos relevantes. La confianza es un único valor; nunca afirmamos un nivel y lo contradecimos en el texto.',
      me_picks_t: 'Picks y Value', me_picks_b: 'Las Picks se publican manualmente; el Value surge de las evaluaciones cuando hay ventaja sobre el precio. Nada se auto-publica.',
      me_goals_t: 'Proyección de goles', me_goals_b: 'La proyección de goles está en validación: es informativa y no genera Picks ni Value.',
      me_limits_t: 'Limitaciones', me_limits_b: 'No es consejo financiero, sino estimaciones de un modelo estadístico. La cobertura de contexto y mercado depende de la disponibilidad de datos por partido.',
      adm_observatory: 'Observatory de cobertura', adm_canonical: 'Eventos canónicos', adm_with_eval: 'Con evaluación GP', adm_upcoming_eval: 'Próximos evaluados', adm_pending: 'Próximos pendientes',
      adm_ctx_dist: 'Distribución de contexto', adm_snap_fresh: 'Frescura de snapshots', adm_forbidden: 'Solo administradores.',
    },
    en: {
      nav_opps: 'Opportunities', nav_matches: 'Matches', nav_teams: 'Teams', nav_sim: 'Simulator', nav_follow: 'Following',
      nav_alerts: 'Alerts', nav_perf: 'Performance', nav_groups: 'Groups', nav_bracket: 'Bracket', nav_evo: 'Evolution',
      nav_registry: 'Registry', nav_method: 'Methodology', nav_admin: 'Admin', more: 'More',
      search: 'Search teams, matches, markets…', matches: 'matches', live: 'live', signals: 'signals today',
      title: 'Opportunities', all: 'All', live_f: 'Live', upcoming_f: 'Upcoming', picks: 'GP Picks', value: 'Value', arb: 'Arbitrage',
      updated: 'Updated {t} ago', board: 'Opportunities board',
      best_pick: 'Top GP pick', best_value: 'Top value', top_gap: 'Largest GP–market disagreement', gap_tooltip: 'A difference between GP and the market does not by itself imply an executable opportunity.', arb_verified: 'Verified arbitrage',
      edge_adj: 'Adjusted edge', no_arb: 'No executable arbitrage', no_arb_sub: 'GP keeps comparing prices and rules', none: 'No data yet',
      th_time: 'Time', th_match: 'Match', th_state: 'State', th_gp: 'GP probability', th_market: 'Market', th_price: 'Best price', th_edge: 'Adj. edge', th_signal: 'Signal',
      st_live: 'LIVE', st_today: 'TODAY', st_tom: 'TOMORROW', st_ft: 'Full time', st_upcoming: 'Upcoming', st_finished: 'Finished', vs: 'vs',
      cockpit: 'Match cockpit', prob_gp: 'GP probability', score_prob: 'Likely score',
      tab_summary: 'Summary', tab_markets: 'Markets', tab_context: 'Context', tab_stats: 'Stats', tab_events: 'Events',
      memo: 'Decision memo', conf: 'Confidence', conf_hi: 'High', conf_mid: 'Medium', conf_lo: 'Low',
      verdict: 'Verdict', thesis: 'Thesis', price: 'Price', risk: 'Risk', invalidation: 'Invalidation',
      best_avail: 'Best available price', view_pick: 'View GP pick', open_analysis: 'Full analysis',
      vp1_t: 'Explainable intelligence', vp1_s: 'We don’t just give the number. We explain why and how it changes.',
      vp2_t: 'Real prices', vp2_s: 'Multiple books, exchanges and markets in one place.',
      vp3_t: 'Real opportunities', vp3_s: 'Picks, value and arbitrage verified with adjusted edge.',
      vp4_t: 'Confident decisions', vp4_s: 'Every recommendation includes risk, invalidation and record.',
      memo_fav: '{team} is the favorite and GP assigns a higher probability than the market.',
      memo_even: 'Even matchup: GP and the market are aligned, no clear favorite.',
      memo_thesis_ctx: 'The gap is supported by the applied context: {factors}.',
      memo_thesis_edge: 'GP sees value in the gap between its probability and the market’s implied price.',
      memo_price: 'Value only above {odds}{book}.',
      memo_price_none: 'No price clears the value threshold right now.',
      memo_risk_default: 'There are availability doubts and a notable disagreement with the market.',
      memo_inval: 'Watch for lineup changes or the price dropping below the minimum.',
      loading: 'Loading…', no_match: 'Pick a match from the board to see its cockpit.',
      reg90: '90 min · no extra time or penalties', updated_short: 'Updated',
      sig_strong: 'STRONG', sig_lean: 'LEAN', sig_watch: 'WATCH', sig_pass: 'PASS',
      comp: 'FIFA World Cup 2026', none_active_pick: 'No active GP Picks right now.',
      below_min: 'The current price is below the required minimum odds.', below_min_short: 'Below min', min_odds: 'Minimum odds', cur_price: 'Best price',
      cta_pick: 'View GP pick', cta_value: 'View opportunity', cta_analysis: 'View full analysis', cta_analyze: 'Analyze match', cta_view_match: 'View match', cta_arb: 'View arbitrage', cta_state: 'View status',
      unc_copy: 'Internal estimates don’t fully converge for this match.',
      thesis_price_only: 'The gap comes mainly from price: the available context doesn’t provide enough evidence to support a stronger read.',
      thesis_ctx2: 'GP backs its read on {factors}.',
      e_na: 'Data unavailable', e_nomarket: 'Market not loaded', e_lineups: 'Lineup pending', e_partial: 'Partial context', e_noprice: 'Price not verifiable', e_gp_na: 'GP Intelligence unavailable', e_stale: 'Stale data',
      trust_data: 'Data', trust_market: 'Market', trust_lineup: 'Lineup', trust_context: 'Context', t_sources: '{n} sources', t_pending: 'Pending', t_confirmed: 'Confirmed', t_broad: 'Broad', t_partial: 'Partial', t_base: 'Base', lus_probable: 'Probable', lus_unavailable: 'Unavailable', lus_stale: 'Stale',
      // ---- Corte 2: Deep Match Cockpit ----
      back: 'Opportunities', open_cockpit: 'Open full cockpit', refresh: 'Refresh',
      fresh_data: 'Recent data', aging_data: 'Aging data', stale_data: 'Stale data',
      fresh_price: 'Recent price', aging_price: 'Aging price', stale_price: 'Stale price',
      mod_memo: 'Decision memo', mod_prob: 'GP probability', mod_markets: 'Markets', mod_context: 'Context', mod_goals: 'Goal projection', mod_live: 'Live',
      hero_gp: 'GP probability', hero_mkt: 'Market', hero_best: 'Best price', hero_xg: 'Expected xG', hero_score: 'Likely score', period_90: '90 min · no extra time or penalties',
      ev_basis: 'Evidence basis',
      ev_pick: 'Published GP Pick with tracking', ev_value: 'Actionable value over the current price', ev_analysis: 'GP match analysis', ev_price_only: 'Price-based read', ev_none: 'No actionable evidence yet',
      prob_base: 'Base probability', prob_ctx: 'Context adjustment', prob_final: 'GP probability',
      prob_explain: 'We start from the model’s base probability and apply verified context to reach the GP probability.',
      prob_no_ctx: 'Context didn’t move the line materially: GP probability matches the base.',
      prob_base_only: 'No context layer applied yet. Showing the model’s base probability.',
      drivers: 'Factors that moved the line', evaluated: 'Evaluated factors', impact: 'Impact', confidence: 'Confidence', evidence: 'Evidence', freshness: 'Freshness',
      evaluated_note: 'These factors were evaluated; their effect is reflected in the net context adjustment, not as an isolated per-factor impact.',
      ev_fact: 'Fact', ev_inference: 'Inference',
      tl_title: 'Timeline', tl_now: 'Current state', tl_base_gp: 'Base → GP probability',
      tl_empty: 'No prior snapshots recorded for this match yet. Probability, price, news and lineup changes will be tracked from now on.',
      mkt_sb: 'Sportsbooks', mkt_sb_best: 'Best price per book', mkt_ex: 'Exchange', mkt_pm: 'Prediction markets',
      col_provider: 'Source', col_outcome: 'Outcome', col_odds: 'Odds', col_implied: 'Implied', col_novig: 'No-vig', col_move: 'Movement', col_liq: 'Liquidity', col_fresh: 'Freshness', na_short: 'Unavailable', move_na: 'Not tracked',
      mkt_none: 'No markets loaded for this match yet.', move_untracked: 'Price movement isn’t tracked for these sources yet.', novig_na: 'Requires the full outcome set.',
      ctx_none: 'No verified context available for this match yet.', ctx_form: 'Recent form', ctx_inj: 'Absences & availability', ctx_lineups: 'Lineups',
      ctx_form_line: '{team} arrives with {rec} in its last {n} ({gf} for, {ga} against).', ctx_inj_line: '{team}: {players}.', no_inj: 'no reported absences',
      goals_tag: 'In validation', goals_disc: 'Statistical model projection, in validation. Not a Pick or Value; no betting recommendation.',
      g_xg: 'Expected xG', g_total: 'Expected total', g_ou: 'Over / Under', g_btts: 'Both teams score', g_scores: 'Most likely scores', g_over: 'Over', g_under: 'Under', g_yes: 'Yes', g_no: 'No', goals_none: 'No goal projection available.',
      live_min: 'Minute', live_events: 'Events', live_stats: 'Stats', live_prob: 'Live probability (model)', live_none: 'No verified live data for this match.',
      live_stale: 'Live data may be stale; it might not reflect the current state.',
      st_possession: 'Possession', st_shots: 'Shots', st_sot: 'On target', st_corners: 'Corners', st_fouls: 'Fouls', st_xg: 'xG',
      evk_goal: 'Goal', evk_yellow: 'Yellow', evk_red: 'Red', evk_subst: 'Sub', evk_var: 'VAR', evk_other: 'Event',
      lineup_conf: 'Confirmed', lineup_proj: 'Projected', formation: 'Formation', news_title: 'News', match_loading: 'Loading match…', match_404: 'Couldn’t load this match analysis.',
      // ---- Corte 3: Matches + Simulator ----
      g_today: 'Today', g_tomorrow: 'Tomorrow', m_stage_all: 'All stages', m_search: 'Search team…', m_empty: 'No matches for this filter.',
      gp_absent: 'No pre-match GP evaluation', gp_absent_sub: 'No pre-match GP evaluation was recorded for this match.',
      gp_absent_final: 'No pre-match GP evaluation', gp_absent_final_sub: 'No pre-match GP evaluation was recorded for this match. Result and match data are shown.',
      sim_pick: 'Pick a team', sim_swap: 'Swap', sim_go: 'Simulate matchup', sim_running: 'Simulating…', sim_hypo: 'Hypothetical simulation using the context currently available.',
      sim_empty: 'Pick two teams to simulate a matchup.', sim_empty_sub: 'GP crosses both with their current context.', sim_err: 'Couldn’t simulate the matchup.',
      sim_thesis_na: 'No read available for this matchup.', sim_risk_na: 'No notable change factors.', sim_verdict_na: 'Matchup with no clear favorite.',
      sim_v_even: 'Even matchup, no clear favorite.', sim_v_clear: '{team} is a clear favorite.', sim_v_slight: '{team} is a slight favorite.',
      sim_thesis: 'GP gives {fav} {favp}, {dog} {dogp} and a draw {drawp}.', sim_thesis_factor: 'Key factors: {factors}.', sim_risk: 'A last-minute absence or lineup change could narrow the margin.',
      sim_price_na: 'Price is not evaluated because this hypothetical matchup does not correspond to a scheduled market.', sim_hypo_tag: 'Hypothetical', sim_runs: 'simulations',
      sim_montecarlo: 'Monte Carlo simulations', sim_avg_goals: 'Avg goals', sim_totals: 'Goal distribution',
      sim_goals_disc: 'Goal projection in validation. Available for analysis; does not generate GP Picks or Value.',
      // ---- Corte 4H: tournament surfaces ----
      group: 'Group',
      tm_champion: 'Champion', tm_final: 'Final', tm_semi: 'Semis', tm_qf: 'Quarters', tm_advance: 'Advance',
      tm_sim_note: 'Probabilities from the tournament Monte Carlo simulation with the available context.',
      tm_next: 'Next match', tm_recent_matches: 'Recent matches', tm_vs_home: 'vs (home)', tm_vs_away: 'vs (away)',
      grp_goals: 'GF:GA', grp_advance: 'Advance', grp_advance_note: 'Advance = probability of progressing (1st or 2nd).',
      bk_tbd: 'TBD', bk_reg90: '90 min', bk_note: '1X2 probability at 90 min (not the probability of advancing).',
      evo_insufficient: 'Evolution not available yet', evo_insufficient_sub: 'Not enough real snapshots yet ({n}). Evolution is recorded as the tournament progresses.',
      evo_champion: 'Champion probability', evo_snapshots: 'snapshots', evo_trend: 'Trend', evo_now: 'Now', evo_note: 'Only real recorded snapshots; no fabricated history.',
      reg_picks: 'Picks', reg_settled: 'Settled', reg_winrate: 'Win rate', reg_sample: 'Sample', reg_insufficient: 'Insufficient', reg_history: 'Picks history',
      reg_odds: 'Odds', reg_result: 'Result', reg_era: 'Model', reg_era_current: 'GP Intelligence', reg_era_previous: 'Previous stage', reg_empty: 'No Picks recorded yet.',
      reg_insufficient_note: 'Insufficient sample to claim profitability; the record grows with each settled Pick.',
      lc_pub: 'Published', lc_started: 'In play', lc_await: 'Awaiting settlement', lc_settled: 'Settled',
      rc_win: 'Win', rc_loss: 'Loss', rc_void: 'Void', rc_pending: 'Pending', rc_settled: 'Settled',
      me_gp_t: 'GP Intelligence', me_gp_b: 'We start from a statistical initial probability and apply verified context to reach the final GP probability. We don’t expose internal version names: what you see is the current GP read.',
      me_base_t: 'Statistical base', me_base_b: 'Per-team Elo ratings, a Poisson/Dixon-Coles goals model and a tournament Monte Carlo simulation (thousands of runs) to estimate results and paths.',
      me_ctx_t: 'Context', me_ctx_b: 'Recent form, squad availability, quality, solidity and conditions are evaluated and adjust the initial probability. The effect is shown as a net adjustment, with its evidence and freshness.',
      me_market_t: 'Market', me_market_b: 'We compare the GP probability against books, exchanges and prediction markets, showing implied price, no-vig and best price when possible.',
      me_unc_t: 'Uncertainty', me_unc_b: 'Every read includes its confidence level and the relevant risks. Confidence is a single value; we never claim a level and contradict it in the text.',
      me_picks_t: 'Picks and Value', me_picks_b: 'Picks are published manually; Value arises from evaluations when there’s an edge over the price. Nothing is auto-published.',
      me_goals_t: 'Goal projection', me_goals_b: 'The goal projection is in validation: informational only and does not generate Picks or Value.',
      me_limits_t: 'Limitations', me_limits_b: 'Not financial advice, but statistical model estimates. Context and market coverage depend on per-match data availability.',
      adm_observatory: 'Coverage observatory', adm_canonical: 'Canonical events', adm_with_eval: 'With GP evaluation', adm_upcoming_eval: 'Upcoming evaluated', adm_pending: 'Upcoming pending',
      adm_ctx_dist: 'Context distribution', adm_snap_fresh: 'Snapshot freshness', adm_forbidden: 'Admins only.',
    }
  };
  var LANG = 'es', TEAMS = {};
  var t = function (k, a) { var s = (DICT[LANG] && DICT[LANG][k]) || (DICT.es[k] != null ? DICT.es[k] : k); return String(s).replace(/\{(\w+)\}/g, function (m, x) { return a && a[x] != null ? a[x] : m; }); };
  var teamName = function (id, fb) { var e = TEAMS[id]; return (e && e[LANG]) || (e && e.es) || fb || id || ''; };

  // ---------- format ----------
  var pct = function (v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; };
  var pct0 = function (v) { return v == null ? '—' : Math.round(v * 100) + '%'; };
  var pp = function (v) { return v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + ' pp'; };
  var odd = function (v) { return v == null ? '—' : Number(v).toFixed(2); };
  var FLAGS = {};
  var flag = function (id) { return FLAGS[id] || ''; };
  var fmtTime = function (iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleTimeString(LANG === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };

  // ---------- state ----------
  var S = { dash: null, value: null, sel: null, match: null, sub: 'picks', filt: 'all', mc: {}, view: 'board', matchId: null, fixtures: [], mfix: {},
    cal: [], stTeams: [], canon: [], canonByKey: {}, mFilt: 'all', mStage: 'all', mQuery: '', sim: { a: null, b: null, data: null, loading: false },
    groups: [], standings: {}, knockoutRaw: [], history: [], teamId: null, tcache: {}, hist: null, registry: null, tQuery: '', obs: undefined };

  // ---------- icons ----------
  var ic = function (n) { return '<i class="ti ti-' + n + '" aria-hidden="true"></i>'; };
  var NAV = [
    ['opps', 'target-arrow', 'nav_opps'], ['matches', 'ball-football', 'nav_matches'], ['teams', 'shield', 'nav_teams'],
    ['sim', 'arrows-shuffle', 'nav_sim'], ['follow', 'star', 'nav_follow'], ['alerts', 'bell', 'nav_alerts'], ['perf', 'chart-line', 'nav_perf']
  ];
  var NAV2 = [['groups', 'layout-grid', 'nav_groups'], ['bracket', 'tournament', 'nav_bracket'], ['evo', 'trending-up', 'nav_evo'], ['registry', 'file-check', 'nav_registry'], ['method', 'book', 'nav_method'], ['admin', 'settings', 'nav_admin']];

  function viewNav(v) { return v === 'team' ? 'teams' : (['matches', 'teams', 'sim', 'groups', 'bracket', 'evo', 'registry', 'method', 'admin'].indexOf(v) >= 0 ? v : 'opps'); }
  function shell() {
    var cur = viewNav(S.view), live = ['opps', 'matches', 'teams', 'sim', 'groups', 'bracket', 'evo', 'registry', 'method', 'admin']; // vistas implementadas (clickeables)
    var navHtml = NAV.map(function (n) { var clk = live.indexOf(n[0]) >= 0; return '<div class="gx-nav' + (n[0] === cur ? ' on' : '') + '"' + (clk ? ' data-nav="' + n[0] + '"' : '') + '>' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></div>'; }).join('');
    var nav2 = NAV2.map(function (n) { var clk = live.indexOf(n[0]) >= 0; return '<div class="gx-nav' + (n[0] === cur ? ' on' : '') + '"' + (clk ? ' data-nav="' + n[0] + '"' : '') + '>' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></div>'; }).join('');
    var bnav = [['opps', 'target-arrow', 'nav_opps'], ['matches', 'ball-football', 'nav_matches'], ['sim', 'arrows-shuffle', 'nav_sim'], ['teams', 'shield', 'nav_teams'], ['follow', 'dots', 'more']]
      .map(function (n) { var clk = live.indexOf(n[0]) >= 0; return '<a class="' + (n[0] === cur ? 'on' : '') + '"' + (clk ? ' data-nav="' + n[0] + '"' : '') + '>' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></a>'; }).join('');
    $('#gx-root').innerHTML =
      '<div class="gx">' +
      '<aside class="gx-side">' +
      '<div class="gx-brand"><div class="gx-logo">GP</div><div><b>GP Intelligence</b><span>Sports intelligence</span></div></div>' +
      '<div class="gx-navgroup">' + navHtml + '</div>' +
      '<div class="gx-navgroup"><div class="gx-label">' + esc(t('more')) + '</div>' + nav2 + '</div>' +
      '<div class="gx-side-foot"><div class="gx-avatar">A</div><div style="font-size:12px"><b style="font-weight:600">Alexis</b><div class="gx-dim" style="font-size:10.5px">Superadmin</div></div></div>' +
      '</aside>' +
      '<div class="gx-body">' +
      '<header class="gx-top">' +
      '<div class="gx-top-brand"><div class="gx-logo">GP</div><b>GP Intelligence</b></div>' +
      '<div class="gx-search">' + ic('search') + '<span>' + esc(t('search')) + '</span></div>' +
      '<div class="gx-pulse" id="gx-pulse"></div>' +
      '<div class="gx-spacer"></div>' +
      '<div class="gx-langs" id="gx-langs"><button data-l="es" class="' + (LANG === 'es' ? 'on' : '') + '">ES</button><button data-l="en" class="' + (LANG === 'en' ? 'on' : '') + '">EN</button></div>' +
      '<div class="gx-iconbtn">' + ic('bell') + '<span class="gx-dot"></span></div>' +
      '</header>' +
      '<div class="gx-main">' +
      '<div class="gx-content">' +
      '<div class="gx-ohead">' +
      '<h1>' + esc(t('title')) + '</h1>' +
      '<div class="gx-seg" id="gx-filt"><button data-f="all" class="on">' + esc(t('all')) + '</button><button data-f="live">' + esc(t('live_f')) + '</button><button data-f="up">' + esc(t('upcoming_f')) + '</button></div>' +
      '<div style="display:flex;gap:8px"><span class="gx-prodchip on" id="gx-pc-picks">' + esc(t('picks')) + '</span><span class="gx-prodchip" id="gx-pc-value">' + esc(t('value')) + '</span><span class="gx-prodchip" id="gx-pc-arb">' + esc(t('arb')) + '</span></div>' +
      '<div class="gx-spacer"></div><div class="gx-dim" style="font-size:11.5px;display:flex;align-items:center;gap:6px">' + ic('refresh') + '<span id="gx-upd"></span></div>' +
      '</div>' +
      '<div class="gx-kpis" id="gx-kpis"></div>' +
      '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('board')) + '</span><span class="gx-ph-extra" id="gx-board-count"></span></div><div id="gx-board"></div></div>' +
      '</div>' +
      '<aside class="gx-cockpit" id="gx-cockpit"></aside>' +
      '</div>' +
      '<div class="gx-vp" id="gx-vp"></div>' +
      '<div class="gx-matchview" id="gx-matchview" hidden></div>' +
      '</div></div>' +
      '<nav class="gx-bnav">' + bnav + '</nav>';
    valueProps();
    $('#gx-langs').addEventListener('click', function (e) { var b = e.target.closest('[data-l]'); if (b) setLang(b.dataset.l); });
  }

  function valueProps() {
    var vp = [['bulb', 'vp1_t', 'vp1_s'], ['businessplan', 'vp2_t', 'vp2_s'], ['target-arrow', 'vp3_t', 'vp3_s'], ['shield-check', 'vp4_t', 'vp4_s']];
    $('#gx-vp').innerHTML = vp.map(function (v) { return '<div class="gx-vp-i">' + ic(v[0]) + '<div><b>' + esc(t(v[1])) + '</b><span>' + esc(t(v[2])) + '</span></div></div>'; }).join('');
  }

  // ---------- data ----------
  function gExpandValue(valItems) {
    var byEvent = {};
    (valItems || []).forEach(function (v) { (byEvent[v.event_id] = byEvent[v.event_id] || []).push(v); });
    return byEvent;
  }
  function eventRow(u, valByEvent) {
    var h = u.header, pv = u.probability || {}, oc = {};
    (pv.outcomes || []).forEach(function (o) { oc[o.outcome_code] = o; });
    var vals = valByEvent[h.event_id] || [];
    var bySel = {}; vals.forEach(function (v) { bySel[v.outcome_code] = v; });
    var bestEdge = null, signal = null, rank = { STRONG: 3, LEAN: 2, WATCH: 1, PASS: 0 }, topVal = null;
    vals.forEach(function (v) { if (bestEdge == null || (v.adjusted_edge_pp || -9) > bestEdge) { bestEdge = v.adjusted_edge_pp; topVal = v; } if (signal == null || rank[v.classification_code] > rank[signal]) signal = v.classification_code; });
    // estado por-fila (polish Corte 1.1): below-minimum + frescura del precio
    var belowMin = !!(topVal && topVal.best_odds != null && topVal.minimum_odds != null && topVal.best_odds < topVal.minimum_odds);
    var freshAt = null; vals.forEach(function (v) { if (v.price_observed_at && (!freshAt || v.price_observed_at > freshAt)) freshAt = v.price_observed_at; });
    var fresh = freshAt ? ageFresh(freshAt) : null;
    return { h: h, gp: function (c) { return oc[c] ? oc[c].gp_probability : null; }, mk: function (c) { return oc[c] ? oc[c].market_probability : null; }, best: function (c) { return bySel[c] ? bySel[c].best_odds : null; }, edge: bestEdge, signal: signal, live: (h.status_code === 'LIVE'), kickoff: h.kickoff_at, belowMin: belowMin, fresh: fresh };
  }

  function load(attempt) {
    attempt = attempt || 0;
    if (attempt === 0) { var b = $('#gx-board'); if (b) b.innerHTML = '<div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div>'; }
    Promise.all([
      fetch('/api/beta/dashboard', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('/api/beta/value?class=ALL', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      // server frío: el primer /api/beta/dashboard puede tardar/fallar → reintenta antes de mostrar vacío.
      if (!res[0] && attempt < 4) { setTimeout(function () { load(attempt + 1); }, 900 + attempt * 600); return; }
      S.dash = res[0]; S.value = (res[1] && res[1].items) || [];
      render();
    });
  }

  function render() {
    var d = S.dash || {}, up = d.upcoming || [], valBy = gExpandValue(S.value);
    var rows = up.map(function (u) { return eventRow(u, valBy); });
    // pulse + updated
    var liveN = rows.filter(function (r) { return r.live; }).length;
    var sigN = (S.value || []).filter(function (v) { return ['STRONG', 'LEAN', 'WATCH'].indexOf(v.classification_code) >= 0; }).length;
    $('#gx-pulse').innerHTML = pulseItem(rows.length, t('matches')) + pulseItem(liveN, t('live'), liveN > 0) + pulseItem(sigN, t('signals'));
    $('#gx-upd').textContent = t('updated_short') + ' · ' + (d.generated_at ? fmtTime(d.generated_at) : '—');
    kpis(d, rows);
    board(rows);
    if (!S.sel && rows.length) S.sel = rows[0].h.event_id;
    cockpit(rows);
  }
  function pulseItem(n, label, live) { return '<div class="gx-pulse-i"><b' + (live ? ' style="color:var(--gx-live)"' : '') + '>' + n + '</b>' + (live ? '<span style="color:var(--gx-live)">' + esc(label) + '</span>' : esc(label)) + '</div>'; }

  function kpis(d, rows) {
    var pick = (d.recent_picks || []).filter(function (p) { return p.lifecycle_code === 'PUBLISHED'; })[0]; // SOLO activa
    var val = (d.value || [])[0];
    var gap = rows.map(function (r) { var g = ['HOME', 'DRAW', 'AWAY'].map(function (c) { return { c: c, gp: r.gp(c), mk: r.mk(c) }; }).filter(function (x) { return x.gp != null && x.mk != null; }).sort(function (a, b) { return Math.abs(b.gp - b.mk) - Math.abs(a.gp - a.mk); })[0]; return g ? { r: r, g: g } : null; }).filter(Boolean).sort(function (a, b) { return Math.abs(b.g.gp - b.g.mk) - Math.abs(a.g.gp - a.g.mk); })[0];
    var cards = [];
    cards.push(kpiCard(t('best_pick'), 'target-arrow', pick ? kpiPick(pick) : '<div class="gx-kpi-sel gx-dim">' + esc(t('none_active_pick')) + '</div>'));
    cards.push(kpiCard(t('best_value'), 'trending-up', val ? kpiVal(val) : kpiEmpty()));
    cards.push(kpiCard(t('top_gap'), 'arrows-diff', gap ? kpiGap(gap) : kpiEmpty(), t('gap_tooltip')));
    cards.push(kpiCard(t('arb_verified'), 'shield-check', '<div class="gx-kpi-main"><div><div class="gx-kpi-sel gx-dim">' + esc(t('no_arb')) + '</div><div class="gx-kpi-sub">' + esc(t('no_arb_sub')) + '</div></div></div>'));
    $('#gx-kpis').innerHTML = cards.join('');
  }
  function kpiCard(label, icon, body, tip) { return '<div class="gx-panel gx-kpi"' + (tip ? ' title="' + esc(tip) + '"' : '') + '><div class="gx-label">' + ic(icon) + esc(label) + (tip ? ' <i class="ti ti-info-circle gx-kpi-info" aria-hidden="true"></i>' : '') + '</div>' + body + '</div>'; }
  function kpiEmpty() { return '<div class="gx-kpi-sel gx-dim">' + esc(t('none')) + '</div>'; }
  function pickSel(p) { if (p.selection_display_key) { return p.outcome_code === 'DRAW' ? t('memo_even') : teamName(p.home_team_id) + ' / ' + teamName(p.away_team_id); } return p.outcome_code || ''; }
  function kpiPick(p) {
    var name = p.outcome_code === 'DRAW' ? '' : (p.outcome_code === 'AWAY' ? teamName(p.away_team_id) : teamName(p.home_team_id));
    return '<div class="gx-kpi-main"><span class="gx-kpi-flag">' + (p.outcome_code === 'AWAY' ? flag(p.away_team_id) : flag(p.home_team_id)) + '</span><div><div class="gx-kpi-sel">' + esc(name) + '</div><div class="gx-kpi-sub">' + esc(teamName(p.home_team_id) + ' ' + t('vs') + ' ' + teamName(p.away_team_id)) + '</div></div></div>' +
      '<div class="gx-kpi-foot"><span class="gx-mono">' + odd(p.published_odds) + '</span><span class="gx-pp gx-pos">' + pp(p.adjusted_edge_pp) + '</span></div>';
  }
  function kpiVal(v) {
    var name = v.outcome_code === 'DRAW' ? '' : (v.team_ref === 'away' ? '' : '');
    return '<div class="gx-kpi-main"><div><div class="gx-kpi-sel">' + esc(v.outcome_code) + '</div><div class="gx-kpi-sub">' + esc((v.best_sportsbook || '')) + '</div></div></div>' +
      '<div class="gx-kpi-foot"><span class="gx-mono">' + odd(v.best_odds) + '</span><span class="gx-pp gx-pos">' + pp(v.adjusted_edge_pp) + '</span></div>';
  }
  function kpiGap(x) {
    var r = x.r, g = x.g, name = g.c === 'DRAW' ? (LANG === 'en' ? 'Draw' : 'Empate') : teamName(g.c === 'AWAY' ? r.h.away.team_id : r.h.home.team_id);
    return '<div class="gx-kpi-main"><div><div class="gx-kpi-sel">' + esc(name) + '</div><div class="gx-kpi-sub">' + esc(teamName(r.h.home.team_id) + ' ' + t('vs') + ' ' + teamName(r.h.away.team_id)) + '</div></div></div>' +
      '<div class="gx-kpi-foot"><span class="gx-mono">GP ' + pct0(g.gp) + ' · ' + pct0(g.mk) + '</span><span class="gx-pp gx-blue">' + pp(g.gp - g.mk) + '</span></div>';
  }

  function sigBadge(s) { if (!s || s === 'PASS') return s ? '<span class="gx-badge gx-b-pass">' + esc(t('sig_pass')) + '</span>' : ''; var m = { STRONG: ['gx-b-strong', 'sig_strong'], LEAN: ['gx-b-lean', 'sig_lean'], WATCH: ['gx-b-watch', 'sig_watch'] }[s]; return m ? '<span class="gx-badge ' + m[0] + '">' + esc(t(m[1])) + '</span>' : ''; }
  function stateCell(r) {
    var base;
    if (r.live) base = '<span class="gx-live-pill">' + esc(t('st_live')) + '</span>';
    else { var d = r.kickoff ? new Date(r.kickoff) : null, now = new Date(); var lbl = t('st_today'); if (d) { var diff = (d - now) / 864e5; if (diff > 1) lbl = t('st_tom'); } base = '<span class="gx-dim" style="font-size:11px;font-weight:600">' + esc(lbl) + '</span>'; }
    var extra = (r.belowMin ? '<span class="gx-belowmin" title="' + esc(t('below_min')) + '">' + ic('arrow-down') + esc(t('below_min_short')) + '</span>' : '') + (r.fresh ? freshChip(r.fresh, 'price') : '');
    return extra ? '<span class="gx-rowflags"><span style="display:flex;flex-direction:column;gap:3px;align-items:flex-start">' + base + extra + '</span></span>' : base;
  }
  function board(rows) {
    if (S.filt === 'live') rows = rows.filter(function (r) { return r.live; });
    $('#gx-board-count').textContent = rows.length + ' ' + t('matches') + ' · ' + t('th_gp');
    var bd = $('#gx-board');
    if (!rows.length) { bd.innerHTML = '<div class="gx-empty">' + ic('chart-dots') + '<b>' + esc(t('e_na')) + '</b></div>'; return; }
    // tabla (desktop) y cards (móvil) ambas en el DOM; CSS muestra la que corresponde por viewport (confiable).
    bd.innerHTML = '<div class="gx-bd-desk">' + boardTable(rows) + '</div><div class="gx-bd-mob">' + boardCards(rows) + '</div>';
    // desktop: clic en fila selecciona + previsualiza en el cockpit lateral (con botón "abrir cockpit completo")
    [].forEach.call(bd.querySelectorAll('.gx-row[data-id]'), function (el) {
      el.addEventListener('click', function () { S.sel = el.dataset.id; var rs = (S.dash.upcoming || []).map(function (u) { return eventRow(u, gExpandValue(S.value)); }); board(rs); cockpit(rs); var ck = $('#gx-cockpit'); if (window.innerWidth <= 1180 && ck) ck.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    });
    // móvil: la card abre directamente el cockpit profundo (canónico)
    [].forEach.call(bd.querySelectorAll('.gx-mcard[data-id]'), function (el) {
      el.addEventListener('click', function () { openMatch(el.dataset.id); });
    });
  }
  function boardTable(rows) {
    return '<table class="gx-table"><thead><tr>' +
      '<th class="l">' + esc(t('th_time')) + '</th><th class="l">' + esc(t('th_match')) + '</th><th class="l">' + esc(t('th_state')) + '</th>' +
      '<th class="grp">' + esc(t('th_gp')) + '</th><th class="grp">' + esc(t('th_market')) + '</th><th class="grp">' + esc(t('th_price')) + '</th>' +
      '<th>' + esc(t('th_edge')) + '</th><th>' + esc(t('th_signal')) + '</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var hi = bestCode(r);
        return '<tr class="gx-row' + (r.h.event_id === S.sel ? ' on' : '') + '" data-id="' + esc(r.h.event_id) + '">' +
          '<td class="gx-time">' + esc(fmtTime(r.kickoff)) + '</td>' +
          '<td class="l"><div class="gx-cell-team"><span class="fl">' + flag(r.h.home.team_id) + '</span><div class="gx-teamnames"><b>' + esc(teamName(r.h.home.team_id, r.h.home.name_fallback)) + '</b><span>' + esc(teamName(r.h.away.team_id, r.h.away.name_fallback)) + '</span></div><span class="fl">' + flag(r.h.away.team_id) + '</span></div></td>' +
          '<td class="l">' + stateCell(r) + '</td>' +
          '<td>' + triCell(function (c) { return pct0(r.gp(c)); }, 'gx-gp', maxCode(r.gp)) + '</td>' +
          '<td>' + triCell(function (c) { return pct0(r.mk(c)); }, '', null) + '</td>' +
          '<td>' + triCell(function (c) { return odd(r.best(c)); }, 'gx-best', hi) + '</td>' +
          '<td class="gx-edge ' + (r.edge > 0 ? 'gx-pos' : 'gx-dim') + '">' + (r.edge != null ? pp(r.edge) : '—') + '</td>' +
          '<td class="l">' + (sigBadge(r.signal) || '<span class="gx-dim">—</span>') + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
  }
  function boardCards(rows) {
    var triM = function (fn, cls, hi) { return '<span class="gx-tri ' + cls + '">' + ['HOME', 'DRAW', 'AWAY'].map(function (c) { return '<span' + (hi === c ? ' class="hi"' : '') + '>' + fn(c) + '</span>'; }).join('') + '</span>'; };
    return rows.map(function (r) {
      var hi = bestCode(r);
      return '<div class="gx-mcard' + (r.h.event_id === S.sel ? ' on' : '') + '" data-id="' + esc(r.h.event_id) + '">' +
        '<div class="gx-mcard-top"><span class="gx-time">' + esc(fmtTime(r.kickoff)) + '</span>' + stateCell(r) + '<span class="gx-spacer"></span>' + (sigBadge(r.signal) || '') + '</div>' +
        '<div class="gx-cell-team" style="margin:6px 0"><span class="fl">' + flag(r.h.home.team_id) + '</span><div class="gx-teamnames"><b>' + esc(teamName(r.h.home.team_id, r.h.home.name_fallback)) + '</b><span>' + esc(teamName(r.h.away.team_id, r.h.away.name_fallback)) + '</span></div><span class="fl">' + flag(r.h.away.team_id) + '</span></div>' +
        '<div class="gx-mcard-rows">' +
        '<div><span class="gx-label">' + esc(t('th_gp')) + '</span>' + triM(function (c) { return pct0(r.gp(c)); }, 'gx-gp', maxCode(r.gp)) + '</div>' +
        '<div><span class="gx-label">' + esc(t('th_market')) + '</span>' + triM(function (c) { return pct0(r.mk(c)); }, '', null) + '</div>' +
        '<div><span class="gx-label">' + esc(t('th_price')) + '</span>' + triM(function (c) { return odd(r.best(c)); }, 'gx-best', hi) + '</div>' +
        '</div>' +
        '<div class="gx-mcard-foot"><span class="gx-edge ' + (r.edge > 0 ? 'gx-pos' : 'gx-dim') + '">' + esc(t('th_edge')) + ' ' + (r.edge != null ? pp(r.edge) : '—') + '</span><span class="gx-mcard-cta">' + esc(t('cta_analysis')) + ' →</span></div>' +
        '</div>';
    }).join('');
  }
  function triCell(fn, cls, hi) { return '<span class="gx-tri ' + cls + '">' + ['HOME', 'DRAW', 'AWAY'].map(function (c) { return '<span' + (hi === c ? ' class="hi"' : '') + '>' + fn(c) + '</span>'; }).join('') + '</span>'; }
  function maxCode(fn) { var best = null, bv = -1; ['HOME', 'DRAW', 'AWAY'].forEach(function (c) { var v = fn(c); if (v != null && v > bv) { bv = v; best = c; } }); return best; }
  function bestCode(r) { var best = null, bv = -1; ['HOME', 'DRAW', 'AWAY'].forEach(function (c) { var v = r.best(c); if (v != null && v > bv) { bv = v; best = c; } }); return best; }
  function isMax() { return null; }

  // ---------- cockpit ----------
  function cockpit(rows) {
    var el = $('#gx-cockpit'); if (!el) return;
    var r = rows.filter(function (x) { return x.h.event_id === S.sel; })[0] || rows[0];
    if (!r) { el.innerHTML = '<div class="gx-panel"><div class="gx-empty">' + ic('device-desktop-analytics') + '<b>' + esc(t('cockpit')) + '</b>' + esc(t('no_match')) + '</div></div>'; return; }
    var h = r.h, gpH = r.gp('HOME') || 0, gpD = r.gp('DRAW') || 0, gpA = r.gp('AWAY') || 0;
    var memo = buildMemo(r);
    var conf = memo.conf;
    el.innerHTML =
      '<div class="gx-panel gx-ck-score">' +
      '<div class="gx-ck-head"><span class="gx-label">' + esc(t('cockpit')) + '</span>' + (r.live ? '<span class="gx-live-pill">' + esc(t('st_live')) + '</span>' : '<span class="gx-dim" style="font-size:11px">' + esc(fmtTime(r.kickoff)) + '</span>') + '</div>' +
      '<div class="gx-ck-comp" style="text-align:center;margin-bottom:10px">' + esc(t('comp')) + '</div>' +
      '<div class="gx-ck-teams"><div class="gx-ck-side"><span class="fl">' + flag(h.home.team_id) + '</span><b>' + esc(teamName(h.home.team_id, h.home.name_fallback)) + '</b></div>' +
      '<div class="gx-ck-mid"><div class="gx-ck-num">' + (r.live ? '0 - 1' : t('vs')) + '</div>' + (r.live ? '<div class="gx-ck-clock">45\'</div>' : '') + '</div>' +
      '<div class="gx-ck-side"><span class="fl">' + flag(h.away.team_id) + '</span><b>' + esc(teamName(h.away.team_id, h.away.name_fallback)) + '</b></div></div>' +
      '<div class="gx-pbar"><i class="h" style="width:' + (gpH * 100) + '%"></i><i class="d" style="width:' + (gpD * 100) + '%"></i><i class="a" style="width:' + (gpA * 100) + '%"></i></div>' +
      '<div class="gx-plabels"><span>' + esc(teamName(h.home.team_id)) + ' <b>' + pct0(gpH) + '</b></span><span>X <b>' + pct0(gpD) + '</b></span><span>' + esc(teamName(h.away.team_id)) + ' <b>' + pct0(gpA) + '</b></span></div>' +
      '<div class="gx-ck-stats">' +
      ckStat(t('prob_gp'), pct0(Math.max(gpH, gpA)) ) +
      ckStat('xG', '—') +
      ckStat(t('score_prob'), '—') +
      '</div>' +
      '<div class="gx-tabs" style="margin-top:14px"><button class="on">' + esc(t('tab_summary')) + '</button><button>' + esc(t('tab_markets')) + '</button><button>' + esc(t('tab_context')) + '</button><button>' + esc(t('tab_stats')) + '</button><button>' + esc(t('tab_events')) + '</button></div>' +
      '</div>' +
      '<div class="gx-panel gx-memo">' +
      '<div class="gx-memo-head"><span class="gx-memo-title">' + ic('clipboard-text') + esc(t('memo')) + '</span><span class="gx-conf ' + conf.cls + '">' + ic('point') + esc(t('conf') + ': ' + conf.label) + '</span></div>' +
      '<div class="gx-memo-grid">' +
      memoItem('verdict', memo.verdict) + memoItem('price', memo.price) + memoItem('thesis', memo.thesis) + memoItem('risk', memo.risk, 'risk') + memoItem('invalidation', memo.inval, 'warn') +
      '</div>' +
      dataTrust(r, memo.ma) +
      '<div class="gx-memo-cta"><span class="gx-bestprice">' + esc(t('best_avail')) + ' <b>' + (memo.bestOdds != null ? odd(memo.bestOdds) : esc(t('e_noprice'))) + '</b>' + (memo.book ? ' · ' + esc(memo.book) : '') + '</span>' +
      '<button class="gx-btn" data-openmatch="' + esc(h.event_id) + '">' + esc(t('open_cockpit')) + ' ' + ic('arrow-right') + '</button></div>' +
      '</div>';
    // enriquece la tesis/riesgo/trust con el análisis real del partido (una vez por evento)
    if (h.event_id && !S.mc[h.event_id]) {
      fetch('/api/beta/match/' + encodeURIComponent(h.event_id), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) {
        S.mc[h.event_id] = m || { _empty: true };
        if (S.sel === h.event_id) { var rs = (S.dash.upcoming || []).map(function (u) { return eventRow(u, gExpandValue(S.value)); }); cockpit(rs); }
      });
    }
  }
  // Data Trust: frescura / fuentes / alineación / contexto (desde el análisis real; honesto si falta)
  // A.5: estado de alineación con trazabilidad. CONFIRMED solo con evidencia verificable real (fx con lista
  // confirmada). Sin fx (cockpit compacto) NUNCA afirma CONFIRMED: a lo sumo PROBABLE, o pendiente si hay riesgo.
  function lineupState(ma, fx) {
    if (fx && fx.lineups && (fx.lineups.home || fx.lineups.away)) {
      var lu = fx.lineups;
      var confirmed = (lu.home && lu.home.confirmed) || (lu.away && lu.away.confirmed);
      var hasList = (lu.home && lu.home.startXI && lu.home.startXI.length) || (lu.away && lu.away.startXI && lu.away.startXI.length);
      var stale = ageFresh(fx.providerStatus && fx.providerStatus.lastUpdated) === 'STALE';
      var at = fx.providerStatus && fx.providerStatus.lastUpdated;
      var src = lineupSource(fx);
      if (confirmed && hasList) return { code: 'CONFIRMED', src: src, at: at, stale: stale };
      if (hasList) return { code: 'PROBABLE', src: src, at: at, stale: stale };
      return { code: 'UNAVAILABLE' };
    }
    if (ma) { var risk = ma.risks && ma.risks.indexOf('LINEUP_NOT_CONFIRMED') >= 0; return { code: risk ? 'UNAVAILABLE' : 'PROBABLE' }; }
    return { code: null };
  }
  function lineupSource(fx) { var ps = fx && fx.providerStatus; if (!ps) return null; if (ps.usedApiFootball) return 'API-Football'; if (ps.usedEspnFallback) return 'ESPN'; if (ps.usedManualFallback) return LANG === 'en' ? 'Manual' : 'Manual'; return null; }
  function luLabel(code) { return code === 'CONFIRMED' ? t('t_confirmed') : code === 'PROBABLE' ? t('lus_probable') : code === 'STALE' ? t('lus_stale') : code === 'UNAVAILABLE' ? t('lus_unavailable') : '…'; }
  function dataTrust(r, ma, fx) {
    var fresh = ma && ma.analysis ? ma.analysis.data_freshness_code : null;
    var cs = ma && ma.analysis ? ma.analysis.context_state_code : null;
    var ls = lineupState(ma, fx);
    var freshLbl = fresh ? t(fresh === 'FRESH' ? 'fresh_data' : fresh === 'AGING' ? 'aging_data' : 'stale_data') : (ma ? t('e_na') : '…');
    var luTip = (ls.src || ls.at) ? [ls.src, ls.at ? (t('updated_short') + ' ' + fmtDateTime(ls.at)) : ''].filter(Boolean).join(' · ') : '';
    var rows = [
      [t('trust_data'), freshLbl, ''],
      [t('trust_context'), cs === 'FULL_CONTEXT' ? t('t_broad') : cs === 'PARTIAL_CONTEXT' ? t('t_partial') : cs === 'BASE_ONLY' ? t('t_base') : (ma ? t('e_partial') : '…'), ''],
      [t('trust_lineup'), ls.stale ? t('lus_stale') : luLabel(ls.code), luTip]
    ];
    return '<div class="gx-trust">' + rows.map(function (x) { return '<div class="gx-trust-i"' + (x[2] ? ' title="' + esc(x[2]) + '"' : '') + '><span class="gx-label">' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>';
  }
  function ckStat(label, v) { return '<div class="gx-ck-stat"><div class="gx-label">' + esc(label) + '</div><div class="v">' + v + '</div></div>'; }
  function memoItem(key, val, cls) { return '<div class="gx-memo-item ' + (cls || '') + '"><div class="gx-label">' + esc(t(key)) + '</div><p>' + val + '</p></div>'; }

  var FACT = { es: { FORM: 'forma reciente', STREAK: 'racha', SOLIDITY: 'solidez defensiva', SQUAD_QUALITY: 'calidad de plantilla', AVAILABILITY: 'disponibilidad del plantel', REST: 'descanso', GOALKEEPER: 'el arquero', TACTICS: 'la lectura táctica', VENUE: 'el escenario', WEATHER: 'el clima', LINEUP: 'la alineación', HIGH_HUMIDITY: 'humedad alta', HEAT: 'calor', HIGH_HEAT: 'calor extremo', ALTITUDE: 'altitud', COLD: 'frío', RAIN: 'lluvia', WIND: 'viento', TRAVEL: 'viaje', CONGESTION: 'congestión de partidos', MOTIVATION: 'motivación', HOME_ADVANTAGE: 'localía' }, en: { FORM: 'recent form', STREAK: 'streak', SOLIDITY: 'defensive solidity', SQUAD_QUALITY: 'squad quality', AVAILABILITY: 'squad availability', REST: 'rest', GOALKEEPER: 'the goalkeeper', TACTICS: 'the tactical read', VENUE: 'the venue', WEATHER: 'the weather', LINEUP: 'the lineup', HIGH_HUMIDITY: 'high humidity', HEAT: 'heat', HIGH_HEAT: 'extreme heat', ALTITUDE: 'altitude', COLD: 'cold', RAIN: 'rain', WIND: 'wind', TRAVEL: 'travel', CONGESTION: 'fixture congestion', MOTIVATION: 'motivation', HOME_ADVANTAGE: 'home advantage' } };
  function factLabel(c) { return (FACT[LANG] && FACT[LANG][c]) || (FACT.es[c]) || String(c || '').toLowerCase(); }
  // 4F: resultados de forma localizados — en ES nunca mostrar W/D/L (usar V/E/D).
  function formStr(arr) { var m = LANG === 'en' ? { W: 'W', D: 'D', L: 'L' } : { W: 'V', D: 'E', L: 'D' }; return (arr || []).map(function (x) { return m[x] || x; }).join('-'); }
  // A.1: mapea el confidence_code canónico del DTO → {cls,label}. Sin valor cargado → neutro "—" (NO inventa nivel).
  function confInfo(code) {
    if (code === 'HIGH') return { code: 'HIGH', cls: 'hi', label: t('conf_hi') };
    if (code === 'LOW') return { code: 'LOW', cls: 'lo', label: t('conf_lo') };
    if (code === 'MEDIUM') return { code: 'MEDIUM', cls: 'mid', label: t('conf_mid') };
    return { code: null, cls: 'mid', label: '—' };
  }
  // editorialización: sintetiza el memo desde el DTO + análisis del partido (sin inventar; honesto si falta evidencia)
  function buildMemo(r) {
    var gp = { HOME: r.gp('HOME'), DRAW: r.gp('DRAW'), AWAY: r.gp('AWAY') }, mk = { HOME: r.mk('HOME'), DRAW: r.mk('DRAW'), AWAY: r.mk('AWAY') };
    var topC = maxCode(function (c) { return gp[c]; }) || 'HOME';
    var team = topC === 'DRAW' ? '' : teamName(topC === 'AWAY' ? r.h.away.team_id : r.h.home.team_id);
    var gpv = gp[topC], mkv = mk[topC], gap = (gpv != null && mkv != null) ? gpv - mkv : null;
    var even = gap == null || Math.abs(gap) < 0.04;
    var vals = (S.value || []).filter(function (v) { return v.event_id === r.h.event_id; });
    var best = vals.filter(function (v) { return v.outcome_code === topC; })[0] || vals.sort(function (a, b) { return (b.adjusted_edge_pp || -9) - (a.adjusted_edge_pp || -9); })[0];
    var pubPick = (S.dash && S.dash.recent_picks || []).filter(function (p) { return p.event_id === r.h.event_id && p.lifecycle_code === 'PUBLISHED'; })[0];
    var ma = S.mc[r.h.event_id]; // match detail (analysis/risks) si ya se cargó
    var belowMin = best && best.best_odds != null && best.minimum_odds != null && best.best_odds < best.minimum_odds;
    var actionable = !!(best && best.actionable && !belowMin);
    var verdict = even ? t('memo_even') : t('memo_fav', { team: '<b>' + esc(team) + '</b>' });
    // tesis: factores reales del análisis si existen; si no, price-only honesto
    var thesis = t('thesis_price_only');
    if (ma && ma.analysis) {
      var af = (ma.analysis.applied_factors || []).slice(0, 3).map(function (f) { return factLabel(f.factor_code); });
      if (!af.length) af = (ma.analysis.evaluated_factors || []).slice(0, 3).map(function (f) { return factLabel(f.factor_code); });
      if (af.length && ma.analysis.context_moved_line) thesis = t('thesis_ctx2', { factors: af.join(', ') });
    }
    var price = belowMin ? ('<b>' + odd(best.best_odds) + '</b> · ' + esc(t('below_min'))) : (best && best.best_odds ? t('memo_price', { odds: '<b>' + odd(best.minimum_odds || best.best_odds) + '</b>', book: best.best_sportsbook ? ' (' + esc(best.best_sportsbook) + ')' : '' }) : t('memo_price_none'));
    var riskCode = (ma && ma.risks && ma.risks[0]) || (best && best.risk_codes && best.risk_codes[0]);
    var risk = riskCode ? riskText(riskCode) : t('memo_risk_default');
    var inval = t('memo_inval');
    var edge = best ? best.adjusted_edge_pp : null;
    var conf = confInfo(ma && ma.confidence_code);  // A.1: un SOLO valor canónico del DTO controla el badge
    var cta = pubPick ? t('cta_pick') : actionable ? t('cta_value') : best ? t('cta_analysis') : t('cta_analyze');
    return { verdict: verdict, thesis: thesis, price: price, risk: risk, inval: inval, conf: conf, bestOdds: best ? best.best_odds : null, book: best ? best.best_sportsbook : '', cta: cta, ma: ma };
  }
  // copy de riesgo: enuncia el HECHO; NUNCA afirma un nivel de confianza (eso lo controla SOLO el badge, A.1)
  var RISK = { es: { MODEL_DISAGREEMENT: 'Las estimaciones internas no convergen del todo.', LARGE_MARKET_DISAGREEMENT: 'GP y el mercado difieren mucho: mayor potencial pero también mayor riesgo.', MODEL_UNCERTAINTY: 'La incertidumbre de la estimación es elevada para este partido.', LINEUP_NOT_CONFIRMED: 'Las alineaciones aún no están confirmadas.', CONTEXT_INCOMPLETE: 'El contexto disponible es incompleto para este partido.', EARLY_TRACK_RECORD: 'El registro verificable todavía es corto.', LOWER_QUALITY_TIMESTAMP: 'Los datos tienen menor frescura.' }, en: { MODEL_DISAGREEMENT: 'Internal estimates don’t fully converge.', LARGE_MARKET_DISAGREEMENT: 'GP and the market differ widely: higher upside but also higher risk.', MODEL_UNCERTAINTY: 'Estimate uncertainty is elevated for this match.', LINEUP_NOT_CONFIRMED: 'Lineups are not yet confirmed.', CONTEXT_INCOMPLETE: 'The available context is incomplete for this match.', EARLY_TRACK_RECORD: 'The verifiable track record is still short.', LOWER_QUALITY_TIMESTAMP: 'Data has lower freshness.' } };
  function riskText(c) { return (RISK[LANG] && RISK[LANG][c]) || (RISK.es[c]) || c; }

  // ================= deep match cockpit (Corte 2) =================
  function setHash(h) { try { if ((location.hash || '').replace(/^#/, '') !== h) location.hash = h; } catch (e) {} }
  function onHash() {
    var h = ''; try { h = (location.hash || '').replace(/^#/, ''); } catch (e) {}
    var m = h.match(/^match\/([0-9a-f-]{36}|qa-[a-z0-9-]+|fx-[A-Za-z0-9]+)$/i);
    if (m) { if (!(S.view === 'match' && S.matchId === m[1])) openMatch(m[1], true); return; }
    var tm = h.match(/^team\/([A-Za-z]{2,4})$/i);
    if (tm) { var tid = tm[1].toUpperCase(); if (!(S.view === 'team' && S.teamId === tid)) openTeam(tid, true); return; }
    var v = h.match(/^(matches|teams|sim|groups|bracket|evo|registry|method|admin)/);
    if (v) { showView(v[1]); return; }
    showView('board');
  }
  var NAV_HASH = { opps: '', matches: 'matches', teams: 'teams', sim: 'sim', groups: 'groups', bracket: 'bracket', evo: 'evo', registry: 'registry', method: 'method', admin: 'admin' };
  function navTo(nav) { setHash(NAV_HASH[nav] != null ? NAV_HASH[nav] : ''); }
  function openTeam(id, fromHash) { if (!id) return; if (!fromHash) { S.returnTo = (S.view === 'teams' ? 'teams' : ''); setHash('team/' + id); } S.view = 'team'; S.teamId = id; applyView(); syncNavActive(); try { window.scrollTo(0, 0); } catch (e) {} renderTeam(); }
  function syncNavActive() {
    var cur = viewNav(S.view);
    [].forEach.call(document.querySelectorAll('.gx-nav[data-nav], .gx-bnav a[data-nav]'), function (el) { el.classList.toggle('on', el.getAttribute('data-nav') === cur); });
  }
  function applyView() {
    var mv = $('#gx-matchview'), main = $('.gx-main'), vp = $('#gx-vp');
    if (!mv) return;
    var takeover = S.view !== 'board';
    if (takeover) { mv.hidden = false; if (main) main.style.display = 'none'; if (vp) vp.style.display = 'none'; }
    else { mv.hidden = true; mv.innerHTML = ''; if (main) main.style.display = ''; if (vp) vp.style.display = ''; }
  }
  function showView(v) {
    var changed = S.view !== v;
    S.view = v; if (v !== 'match') S.matchId = null;
    applyView(); syncNavActive();
    if (changed) try { window.scrollTo(0, 0); } catch (e) {}
    if (v === 'matches') renderMatches();
    else if (v === 'sim') renderSim();
    else if (v === 'teams') renderTeams();
    else if (v === 'groups') renderGroups();
    else if (v === 'bracket') renderBracket();
    else if (v === 'evo') renderEvo();
    else if (v === 'registry') renderRegistry();
    else if (v === 'method') renderMethod();
    else if (v === 'admin') renderAdmin();
  }
  function openMatch(eventId, fromHash) {
    if (!eventId) return;
    if (!fromHash) S.returnTo = (S.view === 'matches' ? 'matches' : S.view === 'sim' ? 'sim' : '');
    S.view = 'match'; S.matchId = eventId;
    if (!fromHash) setHash('match/' + eventId);
    applyView(); syncNavActive(); try { window.scrollTo(0, 0); } catch (e) {}
    renderMatch();
  }
  function closeMatch(fromHash) { if (!fromHash) setHash(S.returnTo || ''); else showView('board'); }
  function loadCanon() {
    fetch('/api/beta/matches', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
      S.canon = (j && j.items) || [];
      S.canonByKey = {};
      S.canon.forEach(function (c) { if (c.home_team_id && c.away_team_id) S.canonByKey[canonKey(c.home_team_id, c.away_team_id, (c.kickoff_at || '').slice(0, 10))] = c; });
      if (S.view === 'matches') renderMatches();
    });
  }
  function canonKey(h, a, d) { return h + '|' + a + '|' + (d || ''); }
  function fixtureIdFor(header) {
    if (!header) return null;
    var hid = header.home && header.home.team_id, aid = header.away && header.away.team_id, d = (header.kickoff_at || '').slice(0, 10);
    var byTeams = S.fixtures.filter(function (f) { return f.home === hid && f.away === aid; });
    if (!byTeams.length) return null;
    return (byTeams.filter(function (f) { return f.date === d; })[0] || byTeams[0]).id;
  }
  function rowFromBeta(beta) {
    var oc = {}; ((beta.probability && beta.probability.outcomes) || []).forEach(function (o) { oc[o.outcome_code] = o; });
    var vals = (S.value || []).filter(function (v) { return v.event_id === beta.header.event_id; });
    var bySel = {}; vals.forEach(function (v) { bySel[v.outcome_code] = v; });
    var bestEdge = null, signal = null, rank = { STRONG: 3, LEAN: 2, WATCH: 1, PASS: 0 };
    vals.forEach(function (v) { if (bestEdge == null || (v.adjusted_edge_pp || -9) > bestEdge) bestEdge = v.adjusted_edge_pp; if (signal == null || rank[v.classification_code] > rank[signal]) signal = v.classification_code; });
    return { h: beta.header, gp: function (c) { return oc[c] ? oc[c].gp_probability : null; }, mk: function (c) { return oc[c] ? oc[c].market_probability : null; }, best: function (c) { return bySel[c] ? bySel[c].best_odds : null; }, edge: bestEdge, signal: signal, live: beta.header.status_code === 'LIVE', kickoff: beta.header.kickoff_at };
  }
  function stageLabel(c) { if (!c) return ''; var m = { GROUP: LANG === 'en' ? 'Group stage' : 'Fase de grupos', KNOCKOUT: LANG === 'en' ? 'Knockout' : 'Eliminatorias', R32: LANG === 'en' ? 'Round of 32' : '16avos', R16: LANG === 'en' ? 'Round of 16' : 'Octavos', QF: LANG === 'en' ? 'Quarter-finals' : 'Cuartos', SF: LANG === 'en' ? 'Semi-finals' : 'Semifinal', FINAL: 'Final' }; return m[c] || c; }
  function ocName(h, c) { return c === 'DRAW' ? (LANG === 'en' ? 'Draw' : 'Empate') : teamName(c === 'AWAY' ? h.away.team_id : h.home.team_id, c === 'AWAY' ? h.away.name_fallback : h.home.name_fallback); }
  function ageFresh(iso) { if (!iso) return null; var ms = Date.now() - new Date(iso).getTime(); if (isNaN(ms)) return null; var h = ms / 3.6e6; return h <= 2 ? 'FRESH' : h <= 12 ? 'AGING' : 'STALE'; }
  // kind: 'data' (frescura de datos) | 'price' (frescura del precio) → etiqueta acorde a lo que se califica (A.6)
  function freshChip(code, kind) { if (!code) return ''; kind = kind === 'price' ? 'price' : 'data'; var k = { FRESH: ['fresh_' + kind, 'gx-fresh'], AGING: ['aging_' + kind, 'gx-aging'], STALE: ['stale_' + kind, 'gx-stale'] }[code]; return k ? '<span class="gx-freshchip ' + k[1] + '">' + esc(t(k[0])) + '</span>' : ''; }
  // no-vig SOLO con el set completo de resultados (1X2 → HOME+DRAW+AWAY); set parcial → null (no se inventa).
  function normVec(map) { var present = ['HOME', 'DRAW', 'AWAY'].filter(function (c) { return map[c] > 0; }); if (present.length < 3) return null; var sum = present.reduce(function (a, c) { return a + map[c]; }, 0); if (sum <= 0) return null; var o = {}; ['HOME', 'DRAW', 'AWAY'].forEach(function (c) { o[c] = map[c] > 0 ? map[c] / sum : null; }); return o; }

  function mvShell(body) {
    return '<div class="gx-mv">' +
      '<div class="gx-mv-bar"><button class="gx-mv-back">' + ic('arrow-left') + '<span>' + esc(t('back')) + '</span></button></div>' +
      body + '</div>';
  }
  function mvLoading() { return '<div class="gx-panel"><div class="gx-empty">' + ic('loader-2') + esc(t('match_loading')) + '</div></div>'; }
  function bindBack() { var b = $('.gx-mv-back'); if (b) b.addEventListener('click', function () { closeMatch(); }); }
  // A.7: barra de navegación de secciones (sticky desktop+móvil). Click → scroll con offset; scroll-spy marca activa.
  function mvNav(sections) { return '<nav class="gx-mv-nav" id="gx-mv-nav">' + sections.map(function (s, i) { return '<a data-sec="sec-' + s.id + '"' + (i === 0 ? ' class="on"' : '') + '>' + esc(t(s.key)) + '</a>'; }).join('') + '</nav>'; }
  function bindMvNav() {
    var nav = $('#gx-mv-nav'); if (!nav) return;
    var links = [].slice.call(nav.querySelectorAll('a'));
    var setActive = function (id) { links.forEach(function (x) { x.classList.toggle('on', x.dataset.sec === id); var on = x.dataset.sec === id; if (on) x.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }); };
    links.forEach(function (a) { a.addEventListener('click', function () { var el = document.getElementById(a.dataset.sec); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110, behavior: 'smooth' }); setActive(a.dataset.sec); }); });
    if (S._mvObs) { try { S._mvObs.disconnect(); } catch (e) {} }
    if ('IntersectionObserver' in window) {
      var obs = new IntersectionObserver(function (ents) { ents.forEach(function (e) { if (e.isIntersecting) setActive(e.target.id); }); }, { rootMargin: '-118px 0px -62% 0px', threshold: 0 });
      [].forEach.call(document.querySelectorAll('.gx-sec'), function (s) { obs.observe(s); });
      S._mvObs = obs;
    }
  }

  function renderMatch() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var eid = S.matchId;
    // A.8 QA: escenarios determinísticos SOLO en preview interno (premium-qa.js se carga únicamente con el
    // flag QA on en el server; en prod no existe → window.__GP_QA es undefined). NUNCA mezcla DB real.
    var qa = (/^qa-/.test(eid) && window.__GP_QA) ? window.__GP_QA.get(eid, LANG) : null;
    if (qa) S.mc[eid] = qa.beta;   // QA: el memo/dataTrust leen S.mc; sembrarlo para que el análisis sea consistente
    var fixtureOnly = /^fx-/.test(eid);   // 4C#8: partido sin evaluación canónica → cockpit desde /api/match
    var fx, beta, gpAbsent = false;
    if (fixtureOnly) {
      var fxid = eid.slice(3);
      if (S.mfix[fxid] === undefined) {
        S.mfix[fxid] = null; mv.innerHTML = mvShell(mvLoading()); bindBack();
        fetch('/api/match/' + encodeURIComponent(fxid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.mfix[fxid] = m || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
        return;
      }
      fx = (S.mfix[fxid] && !S.mfix[fxid]._empty) ? S.mfix[fxid] : null;
      if (!fx) { mv.innerHTML = mvShell('<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('match_404')) + '</b></div></div>'); bindBack(); return; }
      beta = fixtureBeta(fx, eid); gpAbsent = true;
    } else {
      beta = qa ? qa.beta : S.mc[eid];
      if (!qa && beta === undefined) {
        mv.innerHTML = mvShell(mvLoading()); bindBack();
        fetch('/api/beta/match/' + encodeURIComponent(eid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.mc[eid] = m || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
        return;
      }
      if (!beta || beta._empty || !beta.header) { mv.innerHTML = mvShell('<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('match_404')) + '</b></div></div>'); bindBack(); return; }
      if (qa) { fx = qa.fx || null; }
      else {
        var fid = fixtureIdFor(beta.header);
        if (fid != null && S.mfix[fid] === undefined) {
          S.mfix[fid] = null;
          fetch('/api/match/' + encodeURIComponent(fid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.mfix[fid] = m || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
        }
        fx = (fid != null && S.mfix[fid] && !S.mfix[fid]._empty) ? S.mfix[fid] : null;
      }
    }
    var header = beta.header;
    var r = rowFromBeta(beta);
    var live = header.status_code === 'LIVE' || (fx && fx.status === 'live');
    // A.7: navegación interna de secciones (sticky). Las secciones presentes definen el menú.
    var sections = [{ id: 'resumen', key: 'tab_summary' }, { id: 'prob', key: 'mod_prob' }, { id: 'mercados', key: 'mod_markets' }, { id: 'contexto', key: 'mod_context' }];
    if (!gpAbsent) sections.push({ id: 'goles', key: 'mod_goals' });
    if (live) sections.push({ id: 'live', key: 'mod_live' });
    var sec = function (id, html) { return '<div class="gx-sec" id="sec-' + id + '">' + html + '</div>'; };
    mv.innerHTML = mvShell(
      mvHero(beta, fx, r, live) +
      mvNav(sections) +
      '<div class="gx-mv-grid">' +
      '<div class="gx-mv-col">' + sec('resumen', gpAbsent ? mvGpAbsent(beta, fx) : mvMemo(beta, r, fx)) + sec('prob', gpAbsent ? mvProbAbsent() : mvProb(beta)) + sec('contexto', mvContext(beta, fx)) + '</div>' +
      '<div class="gx-mv-col">' + (live ? sec('live', mvLive(fx)) : '') + sec('mercados', mvMarkets(beta, fx, r)) + (gpAbsent ? '' : sec('goles', mvGoals(beta))) + '</div>' +
      '</div>'
    );
    bindBack(); bindMvNav();
  }
  // 4C#8: construye un "beta" sintético desde el fixture (/api/match) para partidos sin evaluación canónica.
  // GP probability/analysis/goal_insights quedan vacíos → el cockpit muestra estados honestos de ausencia.
  function fixtureBeta(fx, eid) {
    var st = fx.status === 'live' ? 'LIVE' : fx.status === 'final' ? 'FINISHED' : 'SCHEDULED';
    return {
      header: { event_id: eid, home: { team_id: fx.homeTeam && fx.homeTeam.id, name_fallback: fx.homeTeam && fx.homeTeam.name }, away: { team_id: fx.awayTeam && fx.awayTeam.id, name_fallback: fx.awayTeam && fx.awayTeam.name }, competition_code: 'FIFA_WORLD_CUP_2026', stage_code: fx.stage ? String(fx.stage).toUpperCase() : null, kickoff_at: fx.date, venue: null, status_code: st },
      probability: { outcomes: [] }, analysis: { context_state_code: 'BASE_ONLY' }, risks: [], confidence_code: null, has_official_v2: false, goal_insights: null
    };
  }
  function mvGpAbsent(beta, fx) {
    var h = beta.header, fin = fx && fx.status === 'final';
    return '<div class="gx-panel gx-memo gx-mv-panel"><div class="gx-memo-head"><span class="gx-memo-title">' + ic('clipboard-text') + esc(t('mod_memo')) + '</span></div>' +
      '<div class="gx-ev-basis gx-ev-dim">' + ic('archive') + '<div><span class="gx-label">' + esc(t('ev_basis')) + '</span><b>' + esc(t(fin ? 'gp_absent_final' : 'gp_absent')) + '</b></div></div>' +
      '<p class="gx-mod-note gx-dim" style="margin-top:12px">' + esc(t(fin ? 'gp_absent_final_sub' : 'gp_absent_sub')) + '</p></div>';
  }
  function mvProbAbsent() {
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('chart-arcs') + esc(t('mod_prob')) + '</span></div><div class="gx-mod-body"><div class="gx-empty">' + ic('chart-dots-3') + '<b>' + esc(t('e_gp_na')) + '</b>' + esc(t('gp_absent_sub')) + '</div></div></div>';
  }

  function mvHero(beta, fx, r, live) {
    var h = beta.header, oc = {}; ((beta.probability && beta.probability.outcomes) || []).forEach(function (o) { oc[o.outcome_code] = o; });
    var gpH = (oc.HOME && oc.HOME.gp_probability) || 0, gpD = (oc.DRAW && oc.DRAW.gp_probability) || 0, gpA = (oc.AWAY && oc.AWAY.gp_probability) || 0;
    var hasGp = (oc.HOME && oc.HOME.gp_probability != null) || (oc.DRAW && oc.DRAW.gp_probability != null) || (oc.AWAY && oc.AWAY.gp_probability != null);
    var gi = beta.goal_insights || null;
    var xgH = gi && gi.expected_goals ? gi.expected_goals.HOME : (fx && fx.modelProbabilities ? fx.modelProbabilities.xgHome : null);
    var xgA = gi && gi.expected_goals ? gi.expected_goals.AWAY : (fx && fx.modelProbabilities ? fx.modelProbabilities.xgAway : null);
    var likely = (gi && gi.top_scores && gi.top_scores[0]) ? gi.top_scores[0].score : (fx && fx.modelProbabilities ? fx.modelProbabilities.likelyScore : null);
    var fresh = beta.analysis ? beta.analysis.data_freshness_code : null;
    var finished = fx && fx.status === 'final';
    var score = ((live || finished) && fx && fx.score) ? (fx.score.home + ' - ' + fx.score.away) : null;
    var minute = (live && fx && fx.minute != null) ? (fx.minute + "'") : null;
    var meta = [esc(t('comp')), stageLabel(h.stage_code) ? esc(stageLabel(h.stage_code)) : '', h.venue ? esc(h.venue) : '', esc(fmtDate(h.kickoff_at))].filter(Boolean).join(' · ');
    var tri = function (fn, cls, hi) { return '<span class="gx-tri ' + cls + '">' + ['HOME', 'DRAW', 'AWAY'].map(function (c) { return '<span' + (hi === c ? ' class="hi"' : '') + '>' + fn(c) + '</span>'; }).join('') + '</span>'; };
    var miniStat = function (label, v, extra) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + v + '</b>' + (extra || '') + '</div>'; };
    return '<div class="gx-panel gx-hero">' +
      '<div class="gx-hero-meta">' + meta + '<span class="gx-spacer"></span>' + (live ? '<span class="gx-live-pill">' + esc(t('st_live')) + '</span>' : finished ? '<span class="gx-dim" style="font-size:11.5px;font-weight:600">' + esc(t('st_ft')) + '</span>' : '<span class="gx-dim" style="font-size:11.5px">' + esc(fmtTime(h.kickoff_at)) + '</span>') + (fresh ? freshChip(fresh, 'data') : '') + '</div>' +
      '<div class="gx-hero-teams">' +
      '<div class="gx-hero-side"><span class="fl">' + flag(h.home.team_id) + '</span><b>' + esc(teamName(h.home.team_id, h.home.name_fallback)) + '</b></div>' +
      '<div class="gx-hero-mid">' + (score ? '<div class="gx-hero-score gx-mono">' + esc(score) + '</div>' + (minute ? '<div class="gx-ck-clock">' + esc(minute) + '</div>' : '') : '<div class="gx-hero-vs">' + esc(t('vs')) + '</div>') + '</div>' +
      '<div class="gx-hero-side"><span class="fl">' + flag(h.away.team_id) + '</span><b>' + esc(teamName(h.away.team_id, h.away.name_fallback)) + '</b></div>' +
      '</div>' +
      // barra GP 1X2 solo si hay probabilidad GP (los partidos sin evaluación no muestran barra a 0%)
      (hasGp ? '<div class="gx-pbar"><i class="h" style="width:' + (gpH * 100) + '%"></i><i class="d" style="width:' + (gpD * 100) + '%"></i><i class="a" style="width:' + (gpA * 100) + '%"></i></div>' +
      '<div class="gx-plabels"><span>' + esc(teamName(h.home.team_id)) + ' <b>' + pct0(gpH) + '</b></span><span>X <b>' + pct0(gpD) + '</b></span><span>' + esc(teamName(h.away.team_id)) + ' <b>' + pct0(gpA) + '</b></span></div>' : '') +
      '<div class="gx-hero-grid">' +
      '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('hero_mkt')) + '</span>' + tri(function (c) { return pct0(r.mk(c)); }, '', null) + '</div>' +
      '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('hero_best')) + '</span>' + tri(function (c) { return odd(r.best(c)); }, 'gx-best', bestCode(r)) + '</div>' +
      (xgH != null || xgA != null ? miniStat(t('hero_xg'), (xgH != null ? Number(xgH).toFixed(2) : '—') + ' – ' + (xgA != null ? Number(xgA).toFixed(2) : '—')) : '') +
      (likely ? miniStat(t('hero_score'), esc(likely)) : '') +
      '</div>' +
      '<div class="gx-hero-note gx-dim">' + esc(t('period_90')) + '</div>' +
      '</div>';
  }

  // ---- módulo 2: Decision Memo con reglas de evidencia ----
  function evidenceBasis(beta) {
    var eid = beta.header.event_id;
    var pubPick = ((S.dash && S.dash.recent_picks) || []).filter(function (p) { return p.event_id === eid && p.lifecycle_code === 'PUBLISHED'; })[0];
    if (pubPick) return { code: 'ev_pick', cls: 'pos', ic: 'circle-check' };
    var vals = (S.value || []).filter(function (v) { return v.event_id === eid; });
    var act = vals.filter(function (v) { var bm = v.best_odds != null && v.minimum_odds != null && v.best_odds < v.minimum_odds; return v.actionable && !bm; })[0];
    if (act) return { code: 'ev_value', cls: 'pos', ic: 'trending-up' };
    var ana = beta.analysis && (beta.analysis.context_moved_line || (beta.analysis.applied_factors && beta.analysis.applied_factors.length));
    if (ana) return { code: 'ev_analysis', cls: 'blue', ic: 'chart-dots' };
    if (vals.length) return { code: 'ev_price_only', cls: 'dim', ic: 'currency-dollar' };
    return { code: 'ev_none', cls: 'dim', ic: 'help' };
  }
  function mvMemo(beta, r, fx) {
    var memo = buildMemo(r), conf = memo.conf, ev = evidenceBasis(beta);
    return '<div class="gx-panel gx-memo gx-mv-panel">' +
      '<div class="gx-memo-head"><span class="gx-memo-title">' + ic('clipboard-text') + esc(t('mod_memo')) + '</span><span class="gx-conf ' + conf.cls + '">' + ic('point') + esc(t('conf') + ': ' + conf.label) + '</span></div>' +
      '<div class="gx-ev-basis gx-ev-' + ev.cls + '">' + ic(ev.ic) + '<div><span class="gx-label">' + esc(t('ev_basis')) + '</span><b>' + esc(t(ev.code)) + '</b></div></div>' +
      '<div class="gx-memo-grid">' +
      memoItem('verdict', memo.verdict) + memoItem('price', memo.price) + memoItem('thesis', memo.thesis) + memoItem('risk', memo.risk, 'risk') + memoItem('invalidation', memo.inval, 'warn') +
      '</div>' + dataTrust(r, memo.ma, fx) +
      '<div class="gx-memo-cta"><span class="gx-bestprice">' + esc(t('best_avail')) + ' <b>' + (memo.bestOdds != null ? odd(memo.bestOdds) : esc(t('e_noprice'))) + '</b>' + (memo.book ? ' · ' + esc(memo.book) : '') + '</span>' +
      (ev.code === 'ev_pick' || ev.code === 'ev_value' ? '<span class="gx-cta-tag gx-ev-' + ev.cls + '">' + esc(memo.cta) + '</span>' : '') + '</div>' +
      '</div>';
  }

  // ---- módulo 3: Probabilidad base + ajustes de contexto = Probabilidad GP + timeline honesto ----
  var TSQ = { es: { INGESTION_OBSERVED: 'Observado en ingesta', SOURCE_PUBLISHED: 'Publicado por la fuente', SOURCE_OBSERVED: 'Observado en la fuente' }, en: { INGESTION_OBSERVED: 'Observed at ingestion', SOURCE_PUBLISHED: 'Source-published', SOURCE_OBSERVED: 'Source-observed' } };
  function tsLabel(c) { if (!c) return ''; return (TSQ[LANG] && TSQ[LANG][c]) || (TSQ.es[c]) || String(c).toLowerCase().replace(/_/g, ' ').replace(/^\w/, function (x) { return x.toUpperCase(); }); }
  function mvProb(beta) {
    var a = beta.analysis || {}, h = beta.header;
    var base = a.base_vector, fin = a.final_vector, adj = a.context_adjustments;
    var hasSnap = !!(base && fin);
    var probBar = function (v) { v = v || {}; return '<div class="gx-pbar sm"><i class="h" style="width:' + ((v.HOME || 0) * 100) + '%"></i><i class="d" style="width:' + ((v.DRAW || 0) * 100) + '%"></i><i class="a" style="width:' + ((v.AWAY || 0) * 100) + '%"></i></div>'; };
    var stageRow = function (label, vec, strong) {
      return '<div class="gx-prob-stage' + (strong ? ' on' : '') + '"><div class="gx-prob-stage-h"><span class="gx-label">' + esc(label) + '</span><span class="gx-mono">' + (vec ? (pct0(vec.HOME) + ' · ' + pct0(vec.DRAW) + ' · ' + pct0(vec.AWAY)) : '—') + '</span></div>' + probBar(vec) + '</div>';
    };
    var body = '';
    if (hasSnap) {
      body += '<p class="gx-mod-intro gx-dim">' + esc(t('prob_explain')) + '</p>' +
        stageRow(t('prob_base'), base) +
        '<div class="gx-prob-arrow">' + ic('arrow-down') + '<span class="gx-dim">' + esc(t('prob_ctx')) + (adj ? ' · ' + ['HOME', 'DRAW', 'AWAY'].map(function (c) { return esc(ocName(h, c).slice(0, 3)) + ' ' + pp(adj[c]); }).join(' / ') : '') + '</span></div>' +
        stageRow(t('prob_final'), fin, true);
      if (!a.context_moved_line) body += '<p class="gx-mod-note gx-dim">' + esc(t('prob_no_ctx')) + '</p>';
      // drivers (applied factors) o evaluated
      var af = a.applied_factors || [];
      if (af.length) {
        body += '<div class="gx-label gx-mod-sub">' + esc(t('drivers')) + '</div><div class="gx-factors">' +
          af.map(function (f) {
            var dir = f.applied_impact >= 0 ? 'gx-pos' : 'gx-neg';
            return '<div class="gx-factor"><div class="gx-factor-main"><b>' + esc(factLabel(f.factor_code)) + '</b>' + (f.subject_team_id ? '<span class="gx-dim"> · ' + esc(teamName(f.subject_team_id)) + '</span>' : '') + '</div>' +
              '<div class="gx-factor-meta"><span class="gx-factor-imp ' + dir + ' gx-mono">' + (f.applied_impact >= 0 ? '+' : '') + Number(f.applied_impact).toFixed(1) + '</span>' +
              (f.confidence != null ? '<span class="gx-dim">' + esc(t('confidence')) + ' ' + pct0(f.confidence) + '</span>' : '') +
              '<span class="gx-evtag gx-ev-' + (f.evidence_class === 'FACT' ? 'pos' : 'blue') + '">' + esc(t(f.evidence_class === 'FACT' ? 'ev_fact' : 'ev_inference')) + '</span>' +
              (f.timestamp_quality_code ? '<span class="gx-dim gx-ts">' + esc(tsLabel(f.timestamp_quality_code)) + '</span>' : '') + '</div></div>';
          }).join('') + '</div>';
      } else {
        var evf = a.evaluated_factors || [];
        if (evf.length) {
          body += '<div class="gx-label gx-mod-sub">' + esc(t('evaluated')) + '</div><div class="gx-factors">' +
            evf.map(function (f) {
              return '<div class="gx-factor"><div class="gx-factor-main"><b>' + esc(factLabel(f.factor_code)) + '</b>' + (f.subject_team_id ? '<span class="gx-dim"> · ' + esc(teamName(f.subject_team_id)) + '</span>' : '') + '</div>' +
                '<div class="gx-factor-meta">' +
                (f.evidence_class ? '<span class="gx-evtag gx-ev-' + (f.evidence_class === 'FACT' ? 'pos' : 'blue') + '">' + esc(t(f.evidence_class === 'FACT' ? 'ev_fact' : 'ev_inference')) + '</span>' : '') +
                (f.confidence != null ? '<span class="gx-dim">' + esc(t('confidence')) + ' ' + pct0(f.confidence) + '</span>' : '') +
                (f.timestamp_quality_code ? '<span class="gx-dim gx-ts">' + esc(tsLabel(f.timestamp_quality_code)) + '</span>' : '') +
                '</div></div>';
            }).join('') + '</div>' +
            '<p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('evaluated_note')) + '</p>';
        }
      }
    } else {
      body += '<p class="gx-mod-intro gx-dim">' + esc(t('prob_base_only')) + '</p>' + stageRow(t('prob_final'), { HOME: (beta.probability.outcomes[0] || {}).gp_probability, DRAW: (beta.probability.outcomes[1] || {}).gp_probability, AWAY: (beta.probability.outcomes[2] || {}).gp_probability }, true);
    }
    // meta línea: factor_count / source_count / completeness
    var ms = [];
    if (a.factor_count) ms.push(a.factor_count + ' ' + (LANG === 'en' ? 'factors' : 'factores'));
    if (a.source_count) ms.push(t('t_sources', { n: a.source_count }));
    if (a.context_completeness != null) ms.push((LANG === 'en' ? 'context ' : 'contexto ') + pct0(a.context_completeness));
    var metaLine = ms.length ? '<div class="gx-prob-metaline gx-dim">' + ms.map(esc).join(' · ') + '</div>' : '';
    // timeline honesto: estado actual real + nota de que no hay snapshots previos (NO se fabrica histórico)
    var timeline = '<div class="gx-mod-sub gx-label">' + esc(t('tl_title')) + '</div>' +
      '<div class="gx-tl"><div class="gx-tl-i"><span class="gx-tl-dot on"></span><div><b>' + esc(t('tl_now')) + '</b>' + (hasSnap ? '<span class="gx-dim"> · ' + esc(t('tl_base_gp')) + '</span>' : '') + (beta.updated_at ? '<div class="gx-dim gx-ts">' + esc(fmtDateTime(beta.updated_at)) + '</div>' : '') + '</div></div>' +
      '<div class="gx-tl-empty gx-dim">' + esc(t('tl_empty')) + '</div></div>';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('chart-arcs') + esc(t('mod_prob')) + '</span></div><div class="gx-mod-body">' + body + metaLine + timeline + '</div></div>';
  }

  // ---- módulo 4: Mercados matriz real (sportsbook / exchange / prediction market) ----
  function mvMarkets(beta, fx, r) {
    var h = beta.header, sections = [];
    // A) Mejor precio por casa (desde value: best_odds + best_sportsbook por outcome)
    var vals = (S.value || []).filter(function (v) { return v.event_id === h.event_id; });
    var bySel = {}; vals.forEach(function (v) { bySel[v.outcome_code] = v; });
    var sbOdds = {}; ['HOME', 'DRAW', 'AWAY'].forEach(function (c) { if (bySel[c] && bySel[c].best_odds) sbOdds[c] = bySel[c].best_odds; });
    if (Object.keys(sbOdds).length) {
      var nv = noVigFromOdds(sbOdds);
      sections.push(mktSection(t('mkt_sb_best'), 'building-bank', ['HOME', 'DRAW', 'AWAY'].filter(function (c) { return bySel[c] && bySel[c].best_odds; }).map(function (c) {
        var v = bySel[c];
        return { outcome: ocName(h, c), provider: v.best_sportsbook || '—', odds: v.best_odds, implied: 1 / v.best_odds, novig: nv ? nv[c] : null, best: c === bestCode(r), liq: null, fresh: ageFresh(v.price_observed_at) };
      }), sections.length === 0));
    }
    // B) Casa de referencia (odds del proveedor contextual: 1 bookmaker home/draw/away)
    var book = fx && fx.odds && fx.odds[0];
    if (book && (book.home || book.draw || book.away)) {
      var bo = {}; ['HOME', 'DRAW', 'AWAY'].forEach(function (c) { var k = c.toLowerCase(); if (book[k]) bo[c] = book[k]; });
      var nvb = noVigFromOdds(bo);
      sections.push(mktSection(t('mkt_sb') + (book.book ? ' · ' + book.book : ''), 'coin', ['HOME', 'DRAW', 'AWAY'].filter(function (c) { return bo[c]; }).map(function (c) {
        return { outcome: ocName(h, c), provider: book.book || '—', odds: bo[c], implied: 1 / bo[c], novig: nvb ? nvb[c] : null, best: false, liq: null, fresh: null };
      }), sections.length === 0));
    }
    // C) Prediction market (Polymarket): price = prob implícita, volume = liquidez
    var mp = (fx && fx.marketPrices) || [];
    if (mp.length) {
      var impMap = {}; mp.forEach(function (o) { var c = (o.side || '').toUpperCase(); if (o.price != null) impMap[c] = o.price; });
      var nvp = normVec(impMap);
      sections.push(mktSection(t('mkt_pm') + ' · Polymarket', 'chart-candle', mp.filter(function (o) { return o.price != null; }).map(function (o) {
        var c = (o.side || '').toUpperCase();
        return { outcome: ocName(h, c), provider: 'Polymarket', odds: o.price > 0 ? 1 / o.price : null, implied: o.price, novig: nvp ? nvp[c] : null, best: false, liq: o.volume != null ? o.volume : null, fresh: null };
      }), sections.length === 0));
    }
    var body = sections.length ? sections.join('') + '<div class="gx-mkt-foot gx-dim">' + ic('info-circle') + esc(t('move_untracked')) + '</div>' : '<div class="gx-empty">' + ic('building-bank') + '<b>' + esc(t('mkt_none')) + '</b></div>';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('arrows-left-right') + esc(t('mod_markets')) + '</span></div><div class="gx-mod-body">' + body + '</div></div>';
  }
  function noVigFromOdds(oddsMap) { var imp = {}; ['HOME', 'DRAW', 'AWAY'].forEach(function (c) { if (oddsMap[c] > 0) imp[c] = 1 / oddsMap[c]; }); return normVec(imp); }
  function mktLiq(v) { if (v == null) return null; if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'; if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K'; return '$' + Math.round(v); }
  function mktSection(title, icon, rows, open) {
    if (!rows.length) return '';
    var liqCell = function (v) { var s = mktLiq(v); return s == null ? '<span class="gx-dim">—</span>' : s; };
    // desktop: matriz densa tipo terminal
    var table = '<table class="gx-mkt-table"><thead><tr><th class="l">' + esc(t('col_outcome')) + '</th><th class="l">' + esc(t('col_provider')) + '</th><th>' + esc(t('col_odds')) + '</th><th>' + esc(t('col_implied')) + '</th><th>' + esc(t('col_novig')) + '</th><th>' + esc(t('col_liq')) + '</th><th>' + esc(t('col_move')) + '</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr' + (x.best ? ' class="best"' : '') + '><td class="l gx-mkt-oc">' + esc(x.outcome) + (x.best ? ' ' + ic('star-filled') : '') + '</td><td class="l gx-dim">' + esc(x.provider) + '</td>' +
          '<td class="gx-mono">' + (x.odds != null ? odd(x.odds) : '—') + '</td><td class="gx-mono gx-dim">' + (x.implied != null ? pct0(x.implied) : '—') + '</td>' +
          '<td class="gx-mono">' + (x.novig != null ? pct0(x.novig) : '—') + '</td><td class="gx-mono gx-dim">' + liqCell(x.liq) + '</td>' +
          '<td>' + (x.fresh ? freshChip(x.fresh, 'price') : '<span class="gx-dim">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
    // móvil: cada resultado/proveedor = card compacta apilada (A.4; sin scroll horizontal)
    var kv = function (label, val, mono) { return '<div class="gx-mkc-kv"><span>' + esc(label) + '</span><b' + (mono ? ' class="gx-mono"' : '') + '>' + val + '</b></div>'; };
    var cards = rows.map(function (x) {
      return '<div class="gx-mkc' + (x.best ? ' best' : '') + '"><div class="gx-mkc-h"><b>' + esc(x.outcome) + (x.best ? ' ' + ic('star-filled') : '') + '</b><span class="gx-dim">' + esc(x.provider) + '</span></div>' +
        '<div class="gx-mkc-grid">' +
        kv(t('col_odds'), x.odds != null ? odd(x.odds) : '—', true) +
        kv(t('col_implied'), x.implied != null ? pct0(x.implied) : '—', true) +
        kv(t('col_novig'), x.novig != null ? pct0(x.novig) : '—', true) +
        kv(t('col_liq'), mktLiq(x.liq) != null ? esc(mktLiq(x.liq)) : esc(t('na_short')), true) +
        kv(t('col_fresh'), x.fresh ? freshChip(x.fresh, 'price') : esc(t('move_na')), false) +
        kv(t('col_move'), esc(t('move_na')), false) +
        '</div></div>';
    }).join('');
    // desktop: tabla siempre visible. móvil: <details> colapsable (el primero — mejor precio — abierto). 4G#20.
    return '<div class="gx-mkt-sec">' +
      '<div class="gx-mkt-desk"><div class="gx-mkt-sec-h">' + ic(icon) + '<span>' + esc(title) + '</span></div>' + table + '</div>' +
      '<details class="gx-mkt-mob gx-mkt-det"' + (open ? ' open' : '') + '><summary class="gx-mkt-sec-h">' + ic(icon) + '<span>' + esc(title) + '</span>' + ic('chevron-down') + '</summary>' + cards + '</details>' +
      '</div>';
  }

  // ---- módulo 5: Contexto narrativo por factor ----
  function mvContext(beta, fx) {
    var h = beta.header, blocks = [];
    var rf = fx && fx.recentForm;
    if (rf && (rf.home || rf.away)) {
      var formSent = function (side, teamId, name) {
        var f = rf[side]; if (!f || !f.played) return '';
        var rec = formStr(f.results);
        return t('ctx_form_line', { team: '<b>' + esc(name) + '</b>', rec: esc(rec), n: f.played, gf: f.goalsFor, ga: f.goalsAgainst });
      };
      var hs = formSent('home', h.home.team_id, teamName(h.home.team_id, h.home.name_fallback)), as = formSent('away', h.away.team_id, teamName(h.away.team_id, h.away.name_fallback));
      if (hs || as) blocks.push(ctxBlock(t('ctx_form'), 'history', [hs, as].filter(Boolean).join(' ')));
    }
    var inj = (fx && fx.injuries) || [];
    if (inj.length) {
      var bySide = { home: [], away: [] }; inj.forEach(function (i) { if (bySide[i.side] && i.player && bySide[i.side].indexOf(i.player) < 0) bySide[i.side].push(i.player); });
      var injSent = function (side, name) { var ps = bySide[side]; if (!ps || !ps.length) return ''; return t('ctx_inj_line', { team: '<b>' + esc(name) + '</b>', players: esc(ps.slice(0, 5).join(', ')) }); };
      var ih = injSent('home', teamName(h.home.team_id)), ia = injSent('away', teamName(h.away.team_id));
      if (ih || ia) blocks.push(ctxBlock(t('ctx_inj'), 'first-aid-kit', [ih, ia].filter(Boolean).join(' ')));
    }
    var lu = fx && fx.lineups;
    if (lu && (lu.home || lu.away)) {
      var luSent = function (side, name) { var l = lu[side]; if (!l) return ''; var tag = l.confirmed ? t('lineup_conf') : t('lineup_proj'); return '<b>' + esc(name) + '</b> — ' + esc(tag) + (l.formation ? ' · ' + esc(t('formation')) + ' ' + esc(l.formation) : '') + (l.coach ? ' · ' + esc(l.coach) : '') + '.'; };
      var lh = luSent('home', teamName(h.home.team_id)), la = luSent('away', teamName(h.away.team_id));
      if (lh || la) blocks.push(ctxBlock(t('ctx_lineups'), 'users-group', [lh, la].filter(Boolean).join(' ')));
    }
    // si no hay contexto externo pero sí factores del análisis GP, narralos
    if (!blocks.length) {
      var af = (beta.analysis && beta.analysis.applied_factors) || [];
      if (af.length) blocks.push(ctxBlock(t('mod_context'), 'bulb', af.map(function (f) { return (LANG === 'en' ? 'GP weighs ' : 'GP pondera ') + factLabel(f.factor_code) + (f.subject_team_id ? ' (' + esc(teamName(f.subject_team_id)) + ')' : '') + '.'; }).join(' ')));
    }
    var body = blocks.length ? blocks.join('') : '<div class="gx-empty">' + ic('notes') + '<b>' + esc(t('ctx_none')) + '</b></div>';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('article') + esc(t('mod_context')) + '</span></div><div class="gx-mod-body">' + body + '</div></div>';
  }
  function ctxBlock(title, icon, html) { return '<div class="gx-ctx-block"><div class="gx-ctx-h">' + ic(icon) + esc(title) + '</div><p>' + html + '</p></div>'; }

  // ---- módulo 6: Goles "en validación" (sin Pick/Value/CTA de apuesta) ----
  function mvGoals(beta) {
    var gi = beta.goal_insights;
    if (!gi) return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('ball-football') + esc(t('mod_goals')) + '</span><span class="gx-badge gx-b-watch">' + esc(t('goals_tag')) + '</span></div><div class="gx-mod-body"><div class="gx-empty">' + ic('ball-football') + '<b>' + esc(t('goals_none')) + '</b></div></div></div>';
    var eg = gi.expected_goals || {}, ou = gi.over_under || {}, btts = gi.btts;
    var ouRow = function (line) { var o = ou[line]; if (!o) return ''; return '<div class="gx-ou-row"><span class="gx-mono">' + line + '</span><div class="gx-ou-bars"><span class="gx-ou-over" style="width:' + ((o.over || 0) * 100) + '%"></span></div><span class="gx-mono gx-dim">' + esc(t('g_over')) + ' ' + pct0(o.over) + ' · ' + esc(t('g_under')) + ' ' + pct0(o.under != null ? o.under : (o.over != null ? 1 - o.over : null)) + '</span></div>'; };
    var stat = function (label, v) { return '<div class="gx-g-stat"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + v + '</b></div>'; };
    var scores = (gi.top_scores || []).slice(0, 5);
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('ball-football') + esc(t('mod_goals')) + '</span><span class="gx-badge gx-b-watch">' + esc(t('goals_tag')) + '</span></div><div class="gx-mod-body">' +
      '<div class="gx-g-stats">' + stat(t('g_xg'), (eg.HOME != null ? Number(eg.HOME).toFixed(2) : '—') + ' – ' + (eg.AWAY != null ? Number(eg.AWAY).toFixed(2) : '—')) + stat(t('g_total'), eg.TOTAL != null ? Number(eg.TOTAL).toFixed(2) : '—') + (btts ? stat(t('g_btts'), esc(t('g_yes')) + ' ' + pct0(btts.yes)) : '') + '</div>' +
      '<div class="gx-mod-sub gx-label">' + esc(t('g_ou')) + '</div>' + ['1.5', '2.5', '3.5'].map(ouRow).filter(Boolean).join('') +
      (scores.length ? '<div class="gx-mod-sub gx-label">' + esc(t('g_scores')) + '</div><div class="gx-scores">' + scores.map(function (s) { return '<div class="gx-score-i"><b class="gx-mono">' + esc(s.score) + '</b><span class="gx-dim gx-mono">' + pct0(s.probability) + '</span></div>'; }).join('') + '</div>' : '') +
      '<p class="gx-mod-note gx-dim">' + ic('alert-triangle') + ' ' + esc(t('goals_disc')) + '</p>' +
      '</div></div>';
  }

  // ---- módulo 7: Live real (solo con fuente válida; no presentar prob prepartido como live) ----
  function mvLive(fx) {
    if (!fx || fx.status !== 'live') return '';
    var mp = fx.modelProbabilities, hasLiveProb = mp && mp.live === true;
    var stale = ageFresh(fx.updatedAt) === 'STALE';
    var sc = fx.score ? (fx.score.home + ' - ' + fx.score.away) : '—';
    var evs = (fx.events || []).slice(-6).reverse();
    var st = fx.statistics;
    var statRow = function (key, label) { if (!st || !st.home || st.home[key] == null && st.away[key] == null) return ''; return '<div class="gx-livestat"><span class="gx-mono">' + (st.home[key] != null ? st.home[key] : '—') + '</span><span class="gx-label">' + esc(label) + '</span><span class="gx-mono">' + (st.away[key] != null ? st.away[key] : '—') + '</span></div>'; };
    var evIcon = { goal: 'ball-football', yellow: 'square-rounded', red: 'square-rounded-filled', subst: 'arrows-exchange', var: 'video' };
    var body =
      '<div class="gx-live-top"><span class="gx-live-pill">' + esc(t('st_live')) + '</span><b class="gx-mono gx-live-score">' + esc(sc) + '</b>' + (fx.minute != null ? '<span class="gx-ck-clock">' + esc(fx.minute + "'") + '</span>' : '') + '<span class="gx-spacer"></span>' + freshChip(ageFresh(fx.updatedAt), 'data') + '</div>' +
      (stale ? '<p class="gx-mod-note gx-warn">' + ic('alert-triangle') + ' ' + esc(t('live_stale')) + '</p>' : '') +
      (hasLiveProb ? '<div class="gx-mod-sub gx-label">' + esc(t('live_prob')) + '</div><div class="gx-pbar sm"><i class="h" style="width:' + ((mp.homeWin || 0) * 100) + '%"></i><i class="d" style="width:' + ((mp.draw || 0) * 100) + '%"></i><i class="a" style="width:' + ((mp.awayWin || 0) * 100) + '%"></i></div><div class="gx-plabels"><span><b>' + pct0(mp.homeWin) + '</b></span><span>X <b>' + pct0(mp.draw) + '</b></span><span><b>' + pct0(mp.awayWin) + '</b></span></div>' : '') +
      (st && st.home ? '<div class="gx-mod-sub gx-label">' + esc(t('live_stats')) + '</div>' + [['possession', t('st_possession')], ['shots', t('st_shots')], ['shotsOnTarget', t('st_sot')], ['corners', t('st_corners')], ['xg', t('st_xg')]].map(function (s) { return statRow(s[0], s[1]); }).filter(Boolean).join('') : '') +
      (evs.length ? '<div class="gx-mod-sub gx-label">' + esc(t('live_events')) + '</div><div class="gx-events">' + evs.map(function (e) { return '<div class="gx-event-i"><span class="gx-mono gx-dim">' + (e.minute != null ? e.minute + "'" : '') + '</span>' + ic(evIcon[e.type] || 'point') + '<span>' + esc(e.player || e.detail || t('evk_other')) + '</span><span class="gx-dim gx-event-team">' + esc(e.teamName || '') + '</span></div>'; }).join('') + '</div>' : '');
    return '<div class="gx-panel gx-mv-panel gx-live-panel"><div class="gx-ph"><span class="gx-label">' + ic('broadcast') + esc(t('mod_live')) + '</span></div><div class="gx-mod-body">' + body + '</div></div>';
  }
  function fmtDate(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short' }); } catch (e) { return '—'; } }
  function fmtDateTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString(LANG === 'en' ? 'en-US' : 'es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }

  // ================= Partidos premium (Corte 3B) =================
  function dayKey(iso) { return (iso || '').slice(0, 10); }
  function dayLabel(iso) {
    if (!iso) return t('e_na');
    var d = new Date(iso), now = new Date();
    var dk = dayKey(iso), tk = dayKey(now.toISOString());
    var tm = new Date(now.getTime() + 864e5);
    if (dk === tk) return t('g_today');
    if (dk === dayKey(tm.toISOString())) return t('g_tomorrow');
    try { return d.toLocaleDateString(LANG === 'en' ? 'en-US' : 'es-ES', { weekday: 'long', day: '2-digit', month: 'short' }); } catch (e) { return dk; }
  }
  function calStatus(c) { return c.status === 'live' ? 'live' : c.status === 'final' ? 'final' : 'scheduled'; }
  function matchRows() {
    var rows = S.cal.filter(function (c) { return c.home && c.away && !c.pending; });
    // filtro por pestaña
    if (S.mFilt === 'live') rows = rows.filter(function (c) { return calStatus(c) === 'live'; });
    else if (S.mFilt === 'up') rows = rows.filter(function (c) { return calStatus(c) === 'scheduled'; });
    else if (S.mFilt === 'fin') rows = rows.filter(function (c) { return calStatus(c) === 'final'; });
    if (S.mStage !== 'all') rows = rows.filter(function (c) { return c.stage === S.mStage; });
    if (S.mQuery) { var q = S.mQuery.toLowerCase(); rows = rows.filter(function (c) { return (teamName(c.home) + ' ' + teamName(c.away) + ' ' + c.home + ' ' + c.away).toLowerCase().indexOf(q) >= 0; }); }
    // 4C#7 orden por defecto: LIVE → próximos/futuros por kickoff ASC → finalizados por fecha DESC.
    var ord = function (c) { var s = calStatus(c); return s === 'live' ? 0 : s === 'scheduled' ? 1 : 2; };
    rows.sort(function (a, b) {
      var oa = ord(a), ob = ord(b); if (oa !== ob) return oa - ob;
      var ta = new Date(a.datetime || 0), tb = new Date(b.datetime || 0);
      return calStatus(a) === 'final' ? (tb - ta) : (ta - tb); // finalizados DESC, resto ASC
    });
    return rows;
  }
  function canonFor(c) { return S.canonByKey[canonKey(c.home, c.away, dayKey(c.datetime))] || null; }
  function mStatusCell(c) {
    var st = calStatus(c);
    if (st === 'live') return '<span class="gx-live-pill">' + esc(t('st_live')) + (c.minute != null ? ' ' + c.minute + "'" : '') + '</span>';
    if (st === 'final') return '<span class="gx-dim" style="font-weight:600;font-size:11px">' + esc(t('st_ft')) + '</span>';
    return '<span class="gx-dim" style="font-size:11px">' + esc(fmtTime(c.datetime)) + '</span>';
  }
  function mScore(c) { return c.score && c.score.home != null ? (c.score.home + ' - ' + c.score.away) : null; }
  function renderMatches() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var rows = matchRows();
    var stages = []; S.cal.forEach(function (c) { if (c.stage && stages.indexOf(c.stage) < 0) stages.push(c.stage); });
    var tabs = [['all', 'all'], ['live', 'live_f'], ['up', 'upcoming_f'], ['fin', 'st_finished']];
    var head =
      '<div class="gx-ohead"><h1>' + esc(t('nav_matches')) + '</h1>' +
      '<div class="gx-seg" id="gx-mtabs">' + tabs.map(function (x) { return '<button data-f="' + x[0] + '"' + (S.mFilt === x[0] ? ' class="on"' : '') + '>' + esc(t(x[1])) + '</button>'; }).join('') + '</div>' +
      '<select class="gx-select" id="gx-mstage"><option value="all">' + esc(t('m_stage_all')) + '</option>' + stages.map(function (s) { return '<option value="' + esc(s) + '"' + (S.mStage === s ? ' selected' : '') + '>' + esc(stageLabel(s)) + '</option>'; }).join('') + '</select>' +
      '<div class="gx-msearch">' + ic('search') + '<input id="gx-msearch-i" placeholder="' + esc(t('m_search')) + '" value="' + esc(S.mQuery) + '"></div>' +
      '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11.5px">' + rows.length + ' ' + esc(t('matches')) + '</span></div>';
    var body;
    if (!rows.length) body = '<div class="gx-panel"><div class="gx-empty">' + ic('calendar-off') + '<b>' + esc(t('m_empty')) + '</b></div></div>';
    else {
      // agrupar por día
      var groups = [], gmap = {};
      rows.forEach(function (c) { var k = dayKey(c.datetime); if (!gmap[k]) { gmap[k] = { k: k, label: dayLabel(c.datetime), rows: [] }; groups.push(gmap[k]); } gmap[k].rows.push(c); });
      body = groups.map(function (g) {
        return '<div class="gx-mgroup"><div class="gx-mgroup-h"><span>' + esc(g.label) + '</span><span class="gx-dim">' + g.rows.length + '</span></div>' +
          '<div class="gx-panel gx-board gx-matches-desk">' + matchesTable(g.rows) + '</div>' +
          '<div class="gx-matches-mob">' + matchesCards(g.rows) + '</div></div>';
      }).join('');
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + head + body + '</div></div>';
    bindMatches();
  }
  function mGpCell(canon) {
    if (canon && canon.gp && canon.gp.HOME != null) return triCell(function (cc) { return pct0(canon.gp[cc]); }, 'gx-gp', maxCode(function (cc) { return canon.gp[cc]; }));
    return '<span class="gx-dim" style="font-size:11px">' + esc(t('e_gp_na')) + '</span>';
  }
  function mSignalCell(canon) {
    if (canon && canon.value && canon.value.signal && canon.value.signal !== 'PASS') return sigBadge(canon.value.signal) + (canon.value.below_min ? ' <span class="gx-belowmin">' + ic('arrow-down') + esc(t('below_min_short')) + '</span>' : '');
    if (canon) return '<span class="gx-dim" style="font-size:11px">' + esc(t('e_nomarket')) + '</span>';
    return '<span class="gx-dim" style="font-size:11px">—</span>';
  }
  function matchesTable(rows) {
    return '<table class="gx-table"><thead><tr><th class="l">' + esc(t('th_time')) + '</th><th class="l">' + esc(t('th_match')) + '</th><th class="l">' + esc(t('th_state')) + '</th><th class="grp">' + esc(t('th_gp')) + '</th><th class="l">' + esc(t('th_signal')) + '</th><th></th></tr></thead><tbody>' +
      rows.map(function (c) {
        var canon = canonFor(c), sc = mScore(c), oid = canon ? canon.event_id : 'fx-' + c.id;
        return '<tr class="gx-row" data-openmatch="' + esc(oid) + '">' +
          '<td class="gx-time">' + esc(fmtTime(c.datetime)) + '<div class="gx-dim" style="font-size:9.5px">' + esc(stageLabel(c.stage)) + '</div></td>' +
          '<td class="l"><div class="gx-cell-team"><span class="fl">' + flag(c.home) + '</span><div class="gx-teamnames"><b>' + esc(teamName(c.home)) + '</b><span>' + esc(teamName(c.away)) + '</span></div><span class="fl">' + flag(c.away) + '</span></div></td>' +
          '<td class="l">' + (sc ? '<span class="gx-mono" style="font-weight:600">' + esc(sc) + '</span> ' : '') + mStatusCell(c) + '</td>' +
          '<td>' + mGpCell(canon) + '</td>' +
          '<td class="l">' + mSignalCell(canon) + '</td>' +
          '<td class="l"><span class="gx-dim">' + ic('chevron-right') + '</span></td></tr>';
      }).join('') + '</tbody></table>';
  }
  function matchesCards(rows) {
    return rows.map(function (c) {
      var canon = canonFor(c), sc = mScore(c), oid = canon ? canon.event_id : 'fx-' + c.id;
      return '<div class="gx-mcard" data-openmatch="' + esc(oid) + '">' +
        '<div class="gx-mcard-top"><span class="gx-time">' + esc(fmtTime(c.datetime)) + ' · ' + esc(stageLabel(c.stage)) + '</span><span class="gx-spacer"></span>' + (sc ? '<span class="gx-mono" style="font-weight:600;margin-right:8px">' + esc(sc) + '</span>' : '') + mStatusCell(c) + '</div>' +
        '<div class="gx-cell-team" style="margin:8px 0"><span class="fl">' + flag(c.home) + '</span><div class="gx-teamnames"><b>' + esc(teamName(c.home)) + '</b><span>' + esc(teamName(c.away)) + '</span></div><span class="fl">' + flag(c.away) + '</span></div>' +
        '<div class="gx-mcard-rows"><div><span class="gx-label">' + esc(t('th_gp')) + '</span>' + mGpCell(canon) + '</div></div>' +
        '<div class="gx-mcard-foot"><span>' + mSignalCell(canon) + '</span><span class="gx-mcard-cta">' + esc(canon ? t('cta_analyze') : t('cta_view_match')) + ' →</span></div>' +
        '</div>';
    }).join('');
  }
  function bindMatches() {
    var tb = $('#gx-mtabs'); if (tb) tb.addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (b) { S.mFilt = b.dataset.f; renderMatches(); } });
    var st = $('#gx-mstage'); if (st) st.addEventListener('change', function () { S.mStage = st.value; renderMatches(); });
    var si = $('#gx-msearch-i'); if (si) si.addEventListener('input', function () { S.mQuery = si.value; clearTimeout(S._mq); S._mq = setTimeout(function () { var pos = si.selectionStart; renderMatches(); var n = $('#gx-msearch-i'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }, 220); });
  }

  // ================= Simulador premium (Corte 3C) =================
  function teamOptions(sel) { return '<option value="">' + esc(t('sim_pick')) + '</option>' + S.stTeams.slice().sort(function (a, b) { return teamName(a.id).localeCompare(teamName(b.id)); }).map(function (tm) { return '<option value="' + esc(tm.id) + '"' + (sel === tm.id ? ' selected' : '') + '>' + esc(teamName(tm.id, tm.name)) + '</option>'; }).join(''); }
  function renderSim() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var s = S.sim;
    var picker =
      '<div class="gx-panel gx-sim-picker"><div class="gx-ph"><span class="gx-label">' + ic('arrows-shuffle') + esc(t('nav_sim')) + '</span></div>' +
      '<div class="gx-sim-row">' +
      '<div class="gx-sim-team"><span class="fl big">' + (s.a ? flag(s.a) : '🏳️') + '</span><select class="gx-select" id="gx-sim-a">' + teamOptions(s.a) + '</select>' + simElo(s.a) + '</div>' +
      '<button class="gx-sim-swap" id="gx-sim-swap" title="' + esc(t('sim_swap')) + '">' + ic('arrows-left-right') + '</button>' +
      '<div class="gx-sim-team"><span class="fl big">' + (s.b ? flag(s.b) : '🏳️') + '</span><select class="gx-select" id="gx-sim-b">' + teamOptions(s.b) + '</select>' + simElo(s.b) + '</div>' +
      '</div>' +
      '<button class="gx-btn gx-sim-go" id="gx-sim-go"' + (s.a && s.b && s.a !== s.b ? '' : ' disabled') + '>' + (s.loading ? ic('loader-2') + esc(t('sim_running')) : ic('player-play') + ' ' + esc(t('sim_go'))) + '</button>' +
      '<div class="gx-sim-hypo">' + ic('flask') + esc(t('sim_hypo')) + '</div>' +
      '</div>';
    var result = s.data ? simResult(s.data) : (s.loading ? '<div class="gx-panel"><div class="gx-empty">' + ic('loader-2') + esc(t('sim_running')) + '</div></div>' : '<div class="gx-panel"><div class="gx-empty">' + ic('arrows-shuffle') + '<b>' + esc(t('sim_empty')) + '</b>' + esc(t('sim_empty_sub')) + '</div></div>');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:16px;max-width:1080px;margin:0 auto">' + picker + result + '</div></div>';
    bindSim();
  }
  function simElo(id) { if (!id) return ''; var tm = (S.stTeams || []).filter(function (x) { return x.id === id; })[0]; if (!tm) return ''; return '<span class="gx-sim-elo gx-mono">Elo ' + Math.round(tm.currentElo || tm.elo || 0) + '</span>'; }
  function bindSim() {
    var a = $('#gx-sim-a'), b = $('#gx-sim-b'), sw = $('#gx-sim-swap'), go = $('#gx-sim-go');
    if (a) a.addEventListener('change', function () { S.sim.a = a.value || null; renderSim(); });
    if (b) b.addEventListener('change', function () { S.sim.b = b.value || null; renderSim(); });
    if (sw) sw.addEventListener('click', function () { var t0 = S.sim.a; S.sim.a = S.sim.b; S.sim.b = t0; renderSim(); });
    if (go) go.addEventListener('click', runSim);
  }
  function runSim() {
    var s = S.sim; if (!s.a || !s.b || s.a === s.b || s.loading) return;
    s.loading = true; s.data = null; renderSim();
    fetch('/api/h2h/deep?a=' + encodeURIComponent(s.a) + '&b=' + encodeURIComponent(s.b), { headers: hdrs() })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) { s.loading = false; s.data = d || { _err: true }; renderSim(); });
  }
  // confianza del cruce hipotético: mapea el nivel ES del backend → enum canónico (NUNCA expone V1/V2/delta)
  function simConf(d) { var lv = d && d.analysis && d.analysis.headline && d.analysis.headline.modelConfidence && d.analysis.headline.modelConfidence.level; var code = lv === 'Alta' ? 'HIGH' : lv === 'Baja' ? 'LOW' : lv === 'Media' ? 'MEDIUM' : null; return confInfo(code); }
  function simResult(d) {
    if (!d || d._err || !d.probs) return '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('sim_err')) + '</b></div></div>';
    var A = d.a, B = d.b, p = d.probs, g = d.goals || {}, mc = d.monteCarlo || {}, hl = (d.analysis && d.analysis.headline) || {};
    var pH = p.aWin || 0, pD = p.draw || 0, pA = p.bWin || 0;
    var conf = simConf(d);
    // hero
    var hero = '<div class="gx-panel gx-hero"><div class="gx-hero-meta">' + ic('flask') + esc(t('sim_hypo')) + '<span class="gx-spacer"></span><span class="gx-conf ' + conf.cls + '">' + ic('point') + esc(t('conf') + ': ' + conf.label) + '</span></div>' +
      '<div class="gx-hero-teams"><div class="gx-hero-side"><span class="fl">' + flag(A.id) + '</span><b>' + esc(teamName(A.id, A.name)) + '</b></div><div class="gx-hero-mid"><div class="gx-hero-vs">' + esc(t('vs')) + '</div></div><div class="gx-hero-side"><span class="fl">' + flag(B.id) + '</span><b>' + esc(teamName(B.id, B.name)) + '</b></div></div>' +
      '<div class="gx-pbar"><i class="h" style="width:' + (pH * 100) + '%"></i><i class="d" style="width:' + (pD * 100) + '%"></i><i class="a" style="width:' + (pA * 100) + '%"></i></div>' +
      '<div class="gx-plabels"><span>' + esc(teamName(A.id)) + ' <b>' + pct0(pH) + '</b></span><span>X <b>' + pct0(pD) + '</b></span><span>' + esc(teamName(B.id)) + ' <b>' + pct0(pA) + '</b></span></div>' +
      '<div class="gx-hero-grid"><div class="gx-hero-mini"><span class="gx-label">' + esc(t('hero_xg')) + '</span><b class="gx-mono">' + (p.xgA != null ? Number(p.xgA).toFixed(2) : '—') + ' – ' + (p.xgB != null ? Number(p.xgB).toFixed(2) : '—') + '</b></div>' +
      '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('hero_score')) + '</span><b class="gx-mono">' + esc(p.likely || '—') + '</b></div>' +
      (mc.btts != null ? '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('g_btts')) + '</span><b class="gx-mono">' + esc(t('g_yes')) + ' ' + pct0(mc.btts) + '</b></div>' : '') +
      (mc.n ? '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('sim_runs')) + '</span><b class="gx-mono">' + (mc.n >= 1000 ? (mc.n / 1000) + 'k' : mc.n) + '</b></div>' : '') +
      '</div></div>';
    // decision memo hipotético (sin precio/value). 4F: narrativa ESTRUCTURADA localizada (no la prosa ES del backend).
    var nar = simNarrative(d);
    var memo = '<div class="gx-panel gx-memo gx-mv-panel"><div class="gx-memo-head"><span class="gx-memo-title">' + ic('clipboard-text') + esc(t('mod_memo')) + ' · ' + esc(t('sim_hypo_tag')) + '</span><span class="gx-conf ' + conf.cls + '">' + ic('point') + esc(t('conf') + ': ' + conf.label) + '</span></div>' +
      '<div class="gx-memo-grid">' +
      '<div class="gx-memo-item"><div class="gx-label">' + esc(t('verdict')) + '</div><p>' + nar.verdict + '</p></div>' +
      '<div class="gx-memo-item"><div class="gx-label">' + esc(t('price')) + '</div><p>' + esc(t('sim_price_na')) + '</p></div>' +
      '<div class="gx-memo-item"><div class="gx-label">' + esc(t('thesis')) + '</div><p>' + nar.thesis + '</p></div>' +
      '<div class="gx-memo-item risk"><div class="gx-label">' + esc(t('risk')) + '</div><p>' + nar.risk + '</p></div>' +
      '</div></div>';
    return hero + '<div class="gx-mv-grid">' + '<div class="gx-mv-col">' + memo + simContext(d) + '</div>' + '<div class="gx-mv-col">' + simSims(d) + simGoals(d) + '</div>' + '</div>';
  }
  // 4F: narrativa del Simulador construida desde estructura (probs/factores), localizada en cliente. Sin prosa ES del backend.
  function simNarrative(d) {
    var A = d.a, B = d.b, p = d.probs || {};
    var pA = p.aWin || 0, pB = p.bWin || 0, pD = p.draw || 0;
    var favA = pA >= pB, favId = favA ? A.id : B.id, dogId = favA ? B.id : A.id, favP = favA ? pA : pB, dogP = favA ? pB : pA;
    var margin = Math.abs(pA - pB);
    var vKey = (pD >= 0.30 || margin < 0.06) ? 'sim_v_even' : (favP >= 0.55 || margin >= 0.25) ? 'sim_v_clear' : 'sim_v_slight';
    var verdict = vKey === 'sim_v_even' ? t('sim_v_even') : t(vKey, { team: '<b>' + esc(teamName(favId)) + '</b>' });
    var thesis = t('sim_thesis', { fav: '<b>' + esc(teamName(favId)) + '</b>', favp: pct0(favP), dog: esc(teamName(dogId)), dogp: pct0(dogP), drawp: pct0(pD) });
    var fac = (d.analysis && d.analysis.factors) || [];
    if (fac.length) thesis += ' ' + t('sim_thesis_factor', { factors: fac.slice(0, 2).map(function (f) { return factLabel(f.factorCode); }).join(', ') });
    return { verdict: verdict, thesis: thesis, risk: t('sim_risk') };
  }
  function simContext(d) {
    var blocks = [];
    var fa = d.form && d.form.a, fb = d.form && d.form.b;
    if (fa || fb) {
      var line = function (f, id) { if (!f || !f.played) return ''; return t('ctx_form_line', { team: '<b>' + esc(teamName(id)) + '</b>', rec: esc(formStr(f.results)), n: f.played, gf: f.goalsFor, ga: f.goalsAgainst }); };
      var s = [line(fa, d.a.id), line(fb, d.b.id)].filter(Boolean).join(' ');
      if (s) blocks.push(ctxBlock(t('ctx_form'), 'history', s));
    }
    var ia = (d.injuries && d.injuries.a) || [], ib = (d.injuries && d.injuries.b) || [];
    if (ia.length || ib.length) {
      var inj = function (arr, id) { if (!arr.length) return ''; return t('ctx_inj_line', { team: '<b>' + esc(teamName(id)) + '</b>', players: esc(arr.slice(0, 5).map(function (x) { return x.player; }).join(', ')) }); };
      var si = [inj(ia, d.a.id), inj(ib, d.b.id)].filter(Boolean).join(' ');
      if (si) blocks.push(ctxBlock(t('ctx_inj'), 'first-aid-kit', si));
    }
    // factores aplicados del análisis (sin V1/V2/delta)
    var fac = (d.analysis && d.analysis.factors) || [];
    if (fac.length) blocks.push(ctxBlock(t('mod_context'), 'bulb', fac.slice(0, 5).map(function (f) { return (LANG === 'en' ? 'GP weighs ' : 'GP pondera ') + factLabel(f.factorCode) + ' (' + esc(teamName(f.side === 'a' ? d.a.id : d.b.id)) + ').'; }).join(' ')));
    var body = blocks.length ? blocks.join('') : '<div class="gx-empty">' + ic('notes') + '<b>' + esc(t('ctx_none')) + '</b></div>';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('article') + esc(t('mod_context')) + '</span></div><div class="gx-mod-body">' + body + '</div></div>';
  }
  function simSims(d) {
    var mc = d.monteCarlo || {};
    var top = (mc.topScores || []).slice(0, 6);
    var totals = (mc.totals || []).slice(0, 8);
    var maxT = totals.reduce(function (m, x) { return Math.max(m, x.p || 0); }, 0) || 1;
    var stat = function (label, v) { return '<div class="gx-g-stat"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + v + '</b></div>'; };
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('dice') + esc(t('sim_montecarlo')) + '</span><span class="gx-dim" style="font-size:10.5px">' + (mc.n ? (mc.n >= 1000 ? (mc.n / 1000) + 'k ' : mc.n + ' ') + esc(t('sim_runs')) : '') + '</span></div><div class="gx-mod-body">' +
      '<div class="gx-g-stats">' + stat(t('g_over') + ' 2.5', pct0(mc.over25)) + stat(t('g_btts'), pct0(mc.btts)) + stat(t('sim_avg_goals'), mc.avgTotal != null ? Number(mc.avgTotal).toFixed(2) : '—') + '</div>' +
      (top.length ? '<div class="gx-mod-sub gx-label">' + esc(t('g_scores')) + '</div><div class="gx-scores">' + top.map(function (s) { return '<div class="gx-score-i"><b class="gx-mono">' + esc(s.score) + '</b><span class="gx-dim gx-mono">' + pct0(s.p) + '</span></div>'; }).join('') + '</div>' : '') +
      (totals.length ? '<div class="gx-mod-sub gx-label">' + esc(t('sim_totals')) + '</div><div class="gx-hist">' + totals.map(function (x) { return '<div class="gx-hist-bar"><i style="height:' + Math.round((x.p / maxT) * 100) + '%"></i><span class="gx-mono">' + x.goals + '</span></div>'; }).join('') + '</div>' : '') +
      '</div></div>';
  }
  function simGoals(d) {
    var g = d.goals || {};
    var ouRow = function (line, over) { if (over == null) return ''; return '<div class="gx-ou-row"><span class="gx-mono">' + line + '</span><div class="gx-ou-bars"><span class="gx-ou-over" style="width:' + (over * 100) + '%"></span></div><span class="gx-mono gx-dim">' + esc(t('g_over')) + ' ' + pct0(over) + ' · ' + esc(t('g_under')) + ' ' + pct0(1 - over) + '</span></div>'; };
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('ball-football') + esc(t('mod_goals')) + '</span><span class="gx-badge gx-b-watch">' + esc(t('goals_tag')) + '</span></div><div class="gx-mod-body">' +
      '<div class="gx-mod-sub gx-label">' + esc(t('g_ou')) + '</div>' + ouRow('1.5', g.over15) + ouRow('2.5', g.over25) + ouRow('3.5', g.over35) +
      '<p class="gx-mod-note gx-dim">' + ic('alert-triangle') + ' ' + esc(t('sim_goals_disc')) + '</p>' +
      '</div></div>';
  }

  // ================= superficies de torneo (Corte 4H) =================
  var pct1 = function (v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; };
  function viewHead(title, extra) { return '<div class="gx-ohead"><h1>' + esc(title) + '</h1>' + (extra || '') + '</div>'; }
  function oidFor(c) { var canon = canonFor(c); return canon ? canon.event_id : 'fx-' + c.id; }
  function teamMatches(id) { return S.cal.filter(function (c) { return c.home === id || c.away === id; }).sort(function (a, b) { return new Date(a.datetime || 0) - new Date(b.datetime || 0); }); }

  // ---- Equipos ----
  function renderTeams() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var teams = S.stTeams.slice().filter(function (t) { return t.sim; }).sort(function (a, b) { return (b.sim.champion || 0) - (a.sim.champion || 0); });
    if (S.tQuery) { var q = S.tQuery.toLowerCase(); teams = teams.filter(function (t) { return (teamName(t.id) + ' ' + t.id).toLowerCase().indexOf(q) >= 0; }); }
    var maxCh = (teams[0] && teams[0].sim.champion) || 1;
    var head = viewHead(t('nav_teams'), '<div class="gx-msearch">' + ic('search') + '<input id="gx-tsearch-i" placeholder="' + esc(t('m_search')) + '" value="' + esc(S.tQuery || '') + '"></div><span class="gx-spacer"></span><span class="gx-dim" style="font-size:11.5px">' + teams.length + ' ' + esc(t('nav_teams').toLowerCase()) + '</span>');
    var rows = teams.map(function (tm, i) {
      var s = tm.sim;
      return '<tr class="gx-row" data-nav-team="' + esc(tm.id) + '">' +
        '<td class="gx-dim gx-mono l" style="width:30px">' + (i + 1) + '</td>' +
        '<td class="l"><div class="gx-cell-team"><span class="fl">' + flag(tm.id) + '</span><b>' + esc(teamName(tm.id, tm.name)) + '</b></div></td>' +
        '<td class="gx-dim l">' + esc(tm.group || '') + '</td>' +
        '<td class="gx-mono">' + Math.round(tm.currentElo || tm.elo || 0) + '</td>' +
        '<td class="l" style="width:160px"><div class="gx-champbar"><i style="width:' + Math.max(2, (s.champion / maxCh) * 100) + '%"></i><span class="gx-mono">' + pct1(s.champion) + '</span></div></td>' +
        '<td class="gx-mono gx-dim">' + pct0(s.reachR32) + '</td>' +
        '<td class="l"><span class="gx-dim">' + ic('chevron-right') + '</span></td></tr>';
    }).join('');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + head +
      '<div class="gx-panel gx-board"><table class="gx-table"><thead><tr><th class="l">#</th><th class="l">' + esc(t('nav_teams')) + '</th><th class="l">' + esc(t('group')) + '</th><th>Elo</th><th class="l">' + esc(t('tm_champion')) + '</th><th>' + esc(t('tm_advance')) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
    var si = $('#gx-tsearch-i'); if (si) si.addEventListener('input', function () { S.tQuery = si.value; clearTimeout(S._tq); S._tq = setTimeout(function () { var p = si.selectionStart; renderTeams(); var n = $('#gx-tsearch-i'); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (e) {} } }, 220); });
  }
  function renderTeam() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var id = S.teamId, td = S.tcache[id];
    if (td === undefined) {
      mv.innerHTML = mvShell(mvLoading()); bindBack();
      fetch('/api/teamdetail/' + encodeURIComponent(id), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.tcache[id] = m || { _empty: true }; if (S.view === 'team' && S.teamId === id) renderTeam(); });
      return;
    }
    if (!td || td._empty) { mv.innerHTML = mvShell('<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('match_404')) + '</b></div></div>'); bindBack(); return; }
    var prob = function (label, v) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + pct1(v) + '</b></div>'; };
    var hero = '<div class="gx-panel gx-hero gx-team-hero"><div class="gx-hero-meta">' + esc(t('comp')) + (td.group ? ' · ' + esc(t('group')) + ' ' + esc(td.group) : '') + '<span class="gx-spacer"></span>' + (td.rank ? '<span class="gx-dim">#' + td.rank + ' Elo</span>' : '') + '</div>' +
      '<div class="gx-team-id"><span class="fl big">' + flag(id) + '</span><div><b>' + esc(teamName(id, td.name)) + '</b><span class="gx-mono gx-dim">Elo ' + Math.round(td.elo || 0) + (td.eloDelta != null ? ' · ' + (td.eloDelta >= 0 ? '+' : '') + Math.round(td.eloDelta) : '') + '</span></div></div>' +
      '<div class="gx-hero-grid">' + prob(t('tm_champion'), td.championProbability) + prob(t('tm_final'), td.finalProbability) + prob(t('tm_semi'), td.semifinalsProbability) + prob(t('tm_qf'), td.quarterfinalsProbability) + prob(t('tm_advance'), td.advanceProbability) + '</div>' +
      '<div class="gx-hero-note gx-dim">' + esc(t('tm_sim_note')) + '</div></div>';
    // próximo + finalizados del calendario
    var ms = teamMatches(id), now = Date.now();
    var up = ms.filter(function (c) { return calStatus(c) !== 'final'; }).slice(0, 1);
    var fin = ms.filter(function (c) { return calStatus(c) === 'final'; }).reverse().slice(0, 5);
    var matchRow = function (c) {
      var opp = c.home === id ? c.away : c.home, sc = mScore(c);
      return '<div class="gx-tmatch gx-row" data-openmatch="' + esc(oidFor(c)) + '"><span class="gx-time">' + esc(fmtDate(c.datetime)) + '</span><div class="gx-cell-team"><span class="gx-dim" style="font-size:11px">' + esc(c.home === id ? t('tm_vs_home') : t('tm_vs_away')) + '</span><span class="fl">' + flag(opp) + '</span><b>' + esc(teamName(opp)) + '</b></div><span class="gx-spacer"></span>' + (sc ? '<span class="gx-mono" style="font-weight:600">' + esc(sc) + '</span>' : mStatusCell(c)) + ' ' + ic('chevron-right') + '</div>';
    };
    var nextBlock = up.length ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('calendar') + esc(t('tm_next')) + '</span></div><div class="gx-mod-body" style="padding:8px 12px">' + up.map(matchRow).join('') + '</div></div>' : '';
    var finBlock = fin.length ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('history') + esc(t('tm_recent_matches')) + '</span></div><div class="gx-mod-body" style="padding:8px 12px">' + fin.map(matchRow).join('') + '</div></div>' : '';
    // forma / bajas / noticias
    var ctxBlocks = [];
    var rf = td.recentForm;
    if (rf && rf.results && rf.results.length) ctxBlocks.push(ctxBlock(t('ctx_form'), 'history', t('ctx_form_line', { team: '<b>' + esc(teamName(id)) + '</b>', rec: esc(formStr(rf.results)), n: rf.played || rf.results.length, gf: rf.goalsFor, ga: rf.goalsAgainst })));
    var inj = (td.injuries || []).concat(td.sidelined || []);
    if (inj.length) ctxBlocks.push(ctxBlock(t('ctx_inj'), 'first-aid-kit', '<b>' + esc(teamName(id)) + '</b>: ' + esc(inj.slice(0, 6).map(function (x) { return x.player || x.name || x; }).join(', ')) + '.'));
    var news = td.news || [];
    if (news.length) ctxBlocks.push(ctxBlock(t('news_title'), 'news', news.slice(0, 3).map(function (n) { return esc(n.title || ''); }).join(' · ')));
    var ctxPanel = ctxBlocks.length ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('article') + esc(t('mod_context')) + '</span></div><div class="gx-mod-body">' + ctxBlocks.join('') + '</div></div>' : '';
    mv.innerHTML = mvShell('<div class="gx-mv-back-wrap"></div>' + hero + '<div class="gx-mv-grid"><div class="gx-mv-col">' + nextBlock + finBlock + '</div><div class="gx-mv-col">' + ctxPanel + '</div></div>');
    bindBack();
  }

  // ---- Grupos ----
  function renderGroups() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var simById = {}; S.stTeams.forEach(function (t) { simById[t.id] = t.sim; });
    var blocks = (S.groups || []).map(function (g) {
      var st = (S.standings && S.standings[g]) || [];
      // equipos del grupo: por standings si hay, si no por stTeams.group
      var ids = st.length ? st.map(function (r) { return r.id; }) : S.stTeams.filter(function (t) { return t.group === g; }).map(function (t) { return t.id; });
      var stById = {}; st.forEach(function (r) { stById[r.id] = r; });
      // ordenar por pts luego por sim.groupWin
      ids.sort(function (a, b) { var ra = stById[a], rb = stById[b]; if (ra && rb && rb.pts !== ra.pts) return rb.pts - ra.pts; return ((simById[b] && simById[b].groupWin) || 0) - ((simById[a] && simById[a].groupWin) || 0); });
      var rows = ids.map(function (id, i) {
        var r = stById[id] || { pj: 0, pts: 0, gf: 0, ga: 0 }, s = simById[id] || {};
        var adv = (s.groupWin || 0) + (s.groupSecond || 0);
        return '<tr class="gx-row" data-nav-team="' + esc(id) + '"><td class="gx-dim gx-mono l" style="width:24px">' + (i + 1) + '</td>' +
          '<td class="l"><div class="gx-cell-team"><span class="fl">' + flag(id) + '</span><b>' + esc(teamName(id)) + '</b></div></td>' +
          '<td class="gx-mono">' + r.pj + '</td><td class="gx-mono" style="color:var(--gx-text)">' + r.pts + '</td><td class="gx-mono gx-dim">' + r.gf + ':' + r.ga + '</td>' +
          '<td class="l" style="width:120px"><div class="gx-champbar sm"><i style="width:' + Math.max(2, adv * 100) + '%"></i><span class="gx-mono">' + pct0(adv) + '</span></div></td></tr>';
      }).join('');
      return '<div class="gx-grp"><div class="gx-grp-h"><span>' + esc(t('group')) + ' ' + esc(g) + '</span></div>' +
        '<div class="gx-panel gx-board"><table class="gx-table"><thead><tr><th class="l">#</th><th class="l">' + esc(t('nav_teams')) + '</th><th>PJ</th><th>Pts</th><th>' + esc(t('grp_goals')) + '</th><th class="l">' + esc(t('grp_advance')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }).join('');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_groups'), '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11px">' + esc(t('grp_advance_note')) + '</span>') + '<div class="gx-grp-grid">' + blocks + '</div></div></div>';
  }

  // ---- Bracket ----
  function renderBracket() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var STAGES = ['R32', 'R16', 'QF', 'SF', 'FINAL'];
    var byStage = {}; (S.knockoutRaw || []).forEach(function (k) { (byStage[k.stage] = byStage[k.stage] || []).push(k); });
    var cols = STAGES.filter(function (s) { return byStage[s]; }).map(function (s) {
      var matches = byStage[s].map(function (k) {
        var hi = k.resolved && k.resolved.home, ai = k.resolved && k.resolved.away;
        var p = k.probs, sc = k.result ? (k.result.hg + '-' + k.result.ag) : null, fin = k.result && k.result.status === 'final';
        var side = function (id, prob, win) { return '<div class="gx-bk-side' + (win ? ' win' : '') + '">' + (id ? '<span class="fl">' + flag(id) + '</span><b>' + esc(teamName(id)) + '</b>' : '<span class="gx-dim">' + esc(t('bk_tbd')) + '</span>') + '<span class="gx-spacer"></span><span class="gx-mono gx-dim">' + (prob != null ? pct0(prob) : '') + '</span></div>'; };
        var winH = fin && k.result.hg > k.result.ag, winA = fin && k.result.ag > k.result.hg;
        var clickable = hi && ai;
        var oid = clickable ? (canonByKey(hi, ai, (k.datetime || k.date || '').slice(0, 10)) || 'fx-' + String(k.m)) : null;
        return '<div class="gx-bk-match' + (clickable ? '' : ' gx-bk-tbd') + '"' + (clickable ? ' data-openmatch="' + esc(oid) + '"' : '') + '>' +
          '<div class="gx-bk-top"><span class="gx-time">' + (fin ? esc(t('st_ft')) : esc(fmtDate(k.datetime || (k.date ? k.date + 'T00:00Z' : null)))) + '</span>' + (sc ? '<span class="gx-mono" style="font-weight:600">' + esc(sc) + '</span>' : '') + '</div>' +
          side(hi, p ? p.home : null, winH) + side(ai, p ? p.away : null, winA) +
          (p && p.draw != null && !fin ? '<div class="gx-bk-draw gx-dim">' + esc(t('bk_reg90')) + ' · X ' + pct0(p.draw) + '</div>' : '') +
          '</div>';
      }).join('');
      return '<div class="gx-bk-col"><div class="gx-bk-colh">' + esc(stageLabel(s)) + '</div>' + matches + '</div>';
    }).join('');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_bracket'), '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11px">' + esc(t('bk_note')) + '</span>') + '<div class="gx-bk-scroll"><div class="gx-bk">' + cols + '</div></div></div></div>';
  }
  function canonByKey(h, a, d) { var c = S.canonByKey[canonKey(h, a, d)]; return c ? c.event_id : null; }

  // ---- Evolución (solo snapshots reales) ----
  function renderEvo() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var hist = S.history || [];
    var body;
    if (hist.length < 2) {
      body = '<div class="gx-panel"><div class="gx-empty">' + ic('chart-line') + '<b>' + esc(t('evo_insufficient')) + '</b>' + esc(t('evo_insufficient_sub', { n: hist.length })) + '</div></div>';
    } else {
      var last = hist[hist.length - 1].probs || {}, first = hist[0].probs || {};
      var top = Object.keys(last).sort(function (a, b) { return (last[b] || 0) - (last[a] || 0); }).slice(0, 10);
      var rows = top.map(function (id) {
        var cur = last[id] || 0, prev = first[id] || 0, d = cur - prev;
        // sparkline simple sobre los snapshots disponibles
        var max = Math.max.apply(null, hist.map(function (h) { return h.probs[id] || 0; }).concat([0.01]));
        var spark = '<span class="gx-spark">' + hist.map(function (h) { var v = h.probs[id] || 0; return '<i style="height:' + Math.max(6, (v / max) * 100) + '%"></i>'; }).join('') + '</span>';
        return '<tr class="gx-row" data-nav-team="' + esc(id) + '"><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(id) + '</span><b>' + esc(teamName(id)) + '</b></div></td>' +
          '<td class="l" style="width:90px">' + spark + '</td>' +
          '<td class="gx-mono" style="color:var(--gx-text)">' + pct1(cur) + '</td>' +
          '<td class="gx-mono ' + (d > 0 ? 'gx-pos' : d < 0 ? 'gx-neg' : 'gx-dim') + '">' + (d === 0 ? '—' : (d > 0 ? '+' : '') + (d * 100).toFixed(1) + ' pp') + '</td></tr>';
      }).join('');
      body = '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('evo_champion')) + '</span><span class="gx-ph-extra">' + hist.length + ' ' + esc(t('evo_snapshots')) + '</span></div><table class="gx-table"><thead><tr><th class="l">' + esc(t('nav_teams')) + '</th><th class="l">' + esc(t('evo_trend')) + '</th><th>' + esc(t('evo_now')) + '</th><th>Δ</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_evo'), '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11px">' + esc(t('evo_note')) + '</span>') + body + '</div></div>';
  }

  // ---- Registro ----
  function renderRegistry() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (S.registry === null) {
      mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_registry')) + mvLoading() + '</div></div>';
      fetch('/api/beta/history', { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.registry = m || { _empty: true }; if (S.view === 'registry') renderRegistry(); });
      return;
    }
    var d = S.registry || {};
    var insufficient = d.sample_status_code === 'INSUFFICIENT_SAMPLE';
    var kpi = function (label, v, cls) { return '<div class="gx-panel gx-kpi"><div class="gx-label">' + esc(label) + '</div><div class="gx-kpi-main"><div class="gx-kpi-sel gx-mono ' + (cls || '') + '">' + v + '</div></div></div>'; };
    var summary = '<div class="gx-kpis" style="grid-template-columns:repeat(4,1fr)">' +
      kpi(t('reg_picks'), d.picks_total != null ? d.picks_total : '—') +
      kpi(t('reg_settled'), d.settled != null ? d.settled : '—') +
      kpi(t('reg_winrate'), (insufficient || d.win_rate == null) ? '—' : pct0(d.win_rate)) +
      kpi(t('reg_sample'), insufficient ? esc(t('reg_insufficient')) : 'OK', insufficient ? 'gx-warn' : 'gx-pos') + '</div>';
    var rows = (d.picks || []).map(function (p) {
      var sel = p.outcome_code === 'DRAW' ? (LANG === 'en' ? 'Draw' : 'Empate') : teamName(p.outcome_code === 'AWAY' ? p.away_team_id : p.home_team_id);
      var lc = { PUBLISHED: 'lc_pub', EVENT_STARTED: 'lc_started', AWAITING_SETTLEMENT: 'lc_await', SETTLED: 'lc_settled' }[p.lifecycle_code] || 'lc_pub';
      var rc = p.result_code, rcl = rc === 'WIN' ? 'gx-pos' : rc === 'LOSS' ? 'gx-neg' : 'gx-dim';
      return '<tr><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(p.outcome_code === 'AWAY' ? p.away_team_id : p.home_team_id) + '</span><div class="gx-teamnames"><b>' + esc(sel) + '</b><span>' + esc(teamName(p.home_team_id) + ' ' + t('vs') + ' ' + teamName(p.away_team_id)) + '</span></div></div></td>' +
        '<td class="gx-mono">' + odd(p.published_odds) + '</td>' +
        '<td class="l"><span class="gx-dim" style="font-size:11px">' + esc(t(lc)) + '</span></td>' +
        '<td class="l"><span class="' + rcl + '" style="font-size:11.5px;font-weight:600">' + esc(t('rc_' + (rc || 'PENDING').toLowerCase())) + '</span></td>' +
        '<td class="gx-dim" style="font-size:10.5px">' + esc(p.model_label_code === 'CURRENT' ? t('reg_era_current') : t('reg_era_previous')) + '</td></tr>';
    }).join('');
    var table = (d.picks || []).length ? '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('reg_history')) + '</span></div><table class="gx-table"><thead><tr><th class="l">Pick</th><th>' + esc(t('reg_odds')) + '</th><th class="l">' + esc(t('th_state')) + '</th><th class="l">' + esc(t('reg_result')) + '</th><th class="l">' + esc(t('reg_era')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '<div class="gx-panel"><div class="gx-empty">' + ic('file-check') + '<b>' + esc(t('reg_empty')) + '</b></div></div>';
    var note = insufficient ? '<p class="gx-mod-note gx-dim" style="padding:0 2px">' + ic('info-circle') + ' ' + esc(t('reg_insufficient_note')) + '</p>' : '';
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_registry')) + summary + table + note + '</div></div>';
  }

  // ---- Metodología (sin V1/V2 interno) ----
  function renderMethod() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var sec = function (icn, title, body) { return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic(icn) + esc(title) + '</span></div><div class="gx-mod-body"><p class="gx-method-p">' + esc(body) + '</p></div></div>'; };
    var blocks = [
      sec('brain', t('me_gp_t'), t('me_gp_b')),
      sec('chart-arcs', t('me_base_t'), t('me_base_b')),
      sec('article', t('me_ctx_t'), t('me_ctx_b')),
      sec('arrows-left-right', t('me_market_t'), t('me_market_b')),
      sec('alert-triangle', t('me_unc_t'), t('me_unc_b')),
      sec('target-arrow', t('me_picks_t'), t('me_picks_b')),
      sec('ball-football', t('me_goals_t'), t('me_goals_b')),
      sec('shield-check', t('me_limits_t'), t('me_limits_b'))
    ].join('');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:860px;margin:0 auto">' + viewHead(t('nav_method')) + blocks + '</div></div>';
  }

  // ---- Admin: Observatory de cobertura (§29, solo admin) ----
  function renderAdmin() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (S.obs === undefined) {
      S.obs = null; mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_admin')) + mvLoading() + '</div></div>';
      fetch('/api/beta/observatory', { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : (x.status === 403 ? { _forbidden: true } : null); }).catch(function () { return null; }).then(function (m) { S.obs = m || { _empty: true }; if (S.view === 'admin') renderAdmin(); });
      return;
    }
    var d = S.obs || {};
    var body;
    if (d._forbidden) body = '<div class="gx-panel"><div class="gx-empty">' + ic('lock') + '<b>' + esc(t('adm_forbidden')) + '</b></div></div>';
    else if (!d.canonical_events) body = '<div class="gx-panel"><div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div></div>';
    else {
      var kpi = function (label, v, cls) { return '<div class="gx-panel gx-kpi"><div class="gx-label">' + esc(label) + '</div><div class="gx-kpi-main"><div class="gx-kpi-sel gx-mono ' + (cls || '') + '">' + v + '</div></div></div>'; };
      var ce = d.canonical_events || {}, cs = d.context_state_distribution || {}, fr = d.snapshot_freshness || {};
      var kpis = '<div class="gx-kpis" style="grid-template-columns:repeat(4,1fr)">' +
        kpi(t('adm_canonical'), ce.total || 0) + kpi(t('adm_with_eval'), d.with_gp_evaluation || 0, 'gx-pos') +
        kpi(t('adm_upcoming_eval'), d.upcoming_with_evaluation || 0) + kpi(t('adm_pending'), d.upcoming_pending || 0, (d.upcoming_pending ? 'gx-warn' : '')) + '</div>';
      var csRows = ['FULL_CONTEXT', 'PARTIAL_CONTEXT', 'BASE_ONLY'].map(function (k) { return '<div class="gx-trust-i"><span class="gx-label">' + esc(k.replace('_', ' ')) + '</span><b class="gx-mono">' + (cs[k] || 0) + '</b></div>'; }).join('');
      var frRows = [['fresh', 'fresh_data'], ['aging', 'aging_data'], ['stale', 'stale_data']].map(function (x) { return '<div class="gx-trust-i"><span class="gx-label">' + esc(t(x[1])) + '</span><b class="gx-mono">' + (fr[x[0]] || 0) + '</b></div>'; }).join('');
      body = kpis +
        '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_ctx_dist')) + '</span></div><div class="gx-trust" style="margin:14px">' + csRows + '</div></div>' +
        '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_snap_fresh')) + '</span></div><div class="gx-trust" style="margin:14px">' + frRows + '</div></div>' +
        '<p class="gx-mod-note gx-dim" style="padding:0 2px">' + ic('info-circle') + ' ' + esc(d.note || '') + '</p>';
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_admin') + ' · ' + t('adm_observatory')) + body + '</div></div>';
  }

  // ---------- lang ----------
  function setLang(l) {
    if (l !== 'es' && l !== 'en') return; LANG = l; try { localStorage.setItem('gp_lang', l); } catch (e) {} document.documentElement.lang = l;
    shell(); render();
    var rr = { match: renderMatch, matches: renderMatches, sim: renderSim, teams: renderTeams, team: renderTeam, groups: renderGroups, bracket: renderBracket, evo: renderEvo, registry: renderRegistry, method: renderMethod, admin: renderAdmin };
    if (rr[S.view]) { applyView(); rr[S.view](); }
  }

  // ---------- boot ----------
  function boot() {
    fetch('/api/i18n').then(function (r) { return r.json(); }).then(function (j) {
      TEAMS = j.teams || {};
    }).catch(function () {}).then(function () {
      // flags desde el estado global (si el server los expone) — si no, fallback vacío (los nombres igual van).
      fetch('/api/state', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (st) {
        if (st && st.teams) { S.stTeams = st.teams; st.teams.forEach(function (tm) { if (tm.id && tm.flag) FLAGS[tm.id] = tm.flag; }); }
        if (st) { S.groups = st.groups || []; S.standings = st.standings || {}; S.knockoutRaw = st.knockout || []; S.history = st.history || []; }
        // puente canónico→fixture + calendario completo (Partidos premium)
        if (st) {
          (st.fixtures || []).forEach(function (f) {
            if (f.home && f.away) S.fixtures.push({ id: f.id, home: f.home, away: f.away, date: (f.datetime || '').slice(0, 10) });
            S.cal.push({ id: f.id, kind: 'group', home: f.home, away: f.away, datetime: f.datetime, stage: 'group', status: f.result ? f.result.status : 'scheduled', score: f.result ? { home: f.result.hg, away: f.result.ag } : null, minute: f.result ? f.result.minute : null, probs: f.probs || null, pending: false });
          });
          (st.knockout || []).forEach(function (k) {
            var h = (k.resolved && k.resolved.home) || (k.result && k.result.home), a = (k.resolved && k.resolved.away) || (k.result && k.result.away);
            if (h && a) S.fixtures.push({ id: String(k.m), home: h, away: a, date: ((k.datetime || k.date || '') + '').slice(0, 10) });
            S.cal.push({ id: String(k.m), kind: 'ko', home: h, away: a, datetime: k.datetime || (k.date ? k.date + 'T18:00:00Z' : null), stage: k.stage, status: k.result ? k.result.status : 'scheduled', score: k.result ? { home: k.result.hg, away: k.result.ag } : null, minute: k.result ? k.result.minute : null, probs: k.probs || null, pending: !(h && a) });
          });
        }
        var pref; try { pref = localStorage.getItem('gp_lang'); } catch (e) {}
        LANG = (pref === 'en' || pref === 'es') ? pref : ((navigator.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es');
        document.documentElement.lang = LANG;
        shell(); load(); loadCanon();
        document.addEventListener('click', function (e) {
          var o = e.target.closest('[data-openmatch]'); if (o) { e.preventDefault(); openMatch(o.getAttribute('data-openmatch')); return; }
          var tt = e.target.closest('[data-nav-team]'); if (tt) { e.preventDefault(); openTeam(tt.getAttribute('data-nav-team')); return; }
          var n = e.target.closest('[data-nav]'); if (n) { e.preventDefault(); navTo(n.getAttribute('data-nav')); }
        });
        window.addEventListener('hashchange', onHash); onHash();
      });
    });
  }
  boot();
})();
