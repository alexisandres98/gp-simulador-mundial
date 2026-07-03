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
      account: 'Mi perfil', account_beta: 'BETA', logout: 'Cerrar sesión',
      pf_title: 'Mi perfil', pf_intro: 'Completá tu perfil para recibir novedades en tu idioma y contenido de tu país.', pf_name: 'Nombre', pf_country: 'País', pf_country_ph: 'Seleccioná tu país', pf_lang: 'Idioma', pf_other: 'Otro', pf_save: 'Guardar', pf_saving: 'Guardando…', pf_saved: 'Perfil guardado', pf_neterr: 'Error de red',
      search: 'Buscar equipos, partidos, mercados…', matches: 'partidos', live: 'en vivo', signals: 'señales hoy',
      title: 'Oportunidades', all: 'Todos', live_f: 'En vivo', upcoming_f: 'Próximos', picks: 'Picks del día', value: 'Value', arb: 'Arbitraje',
      updated: 'Actualizado hace {t}', board: 'Board de oportunidades',
      best_pick: 'Mejor pick GP', best_value: 'Mejor value', top_gap: 'Mayor desacuerdo GP–mercado', gap_tooltip: 'Una diferencia entre GP y el mercado no implica por sí sola una oportunidad ejecutable.', arb_verified: 'Arbitraje verificado',
      edge_adj: 'Edge ajustado', no_arb: 'Sin arbitraje ejecutable', no_arb_sub: 'GP sigue comparando precios y reglas', none: 'Sin datos aún',
      th_time: 'Hora', th_match: 'Partido', th_state: 'Estado', th_gp: 'Probabilidad GP', th_market: 'Mercado', th_price: 'Mejor precio', th_edge: 'Edge aj.', th_signal: 'Señal',
      st_live: 'EN VIVO', st_today: 'HOY', st_tom: 'MAÑANA', st_ft: 'Finalizado', st_upcoming: 'Próximo', st_finished: 'Finalizados', vs: 'vs',
      decided_pens: 'Penales', decided_et: 'Tras prórroga', in_et: 'Prórroga', won_by: 'Ganó {team}', pens_short: 'pen',
      cockpit: 'Cockpit del partido', prob_gp: 'Probabilidad GP', score_prob: 'Marcador prob.',
      tab_summary: 'Resumen', tab_markets: 'Mercados', tab_context: 'Contexto', tab_stats: 'Estadísticas', tab_events: 'Eventos',
      memo: 'Decision memo', conf: 'Confianza', conf_hi: 'Alta', conf_mid: 'Media', conf_lo: 'Baja',
      verdict: 'Veredicto', thesis: 'Tesis', price: 'Precio', risk: 'Riesgo', invalidation: 'Invalidación',
      best_avail: 'Mejor precio disponible', view_pick: 'Ver pick GP', open_analysis: 'Análisis completo',
      vp1_t: 'Picks diarias', vp1_s: 'A quién apostarle y cuántos goles, claro y directo — sin tecnicismos.',
      vp2_t: 'La mejor cuota', vp2_s: 'Comparamos decenas de casas y te damos siempre el mejor precio.',
      vp3_t: 'Análisis de experto', vp3_s: 'Cada pick viene con su lectura del partido y los goles esperados.',
      vp4_t: 'Inteligencia deportiva', vp4_s: 'Proyecciones, cruces y herramientas para apostar con cabeza.',
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
      prob_live_adj: 'Probabilidad GP ajustada EN VIVO con el marcador, el minuto y los eventos del partido.',
      prob_base_only: 'La evaluación de contexto GP para este partido aún no se generó; se muestra la probabilidad base del modelo (Elo + Monte Carlo). El contexto disponible (forma, bajas, alineaciones) está en la pestaña Contexto.',
      drivers: 'Factores que movieron la línea', evaluated: 'Factores evaluados', impact: 'Impacto', confidence: 'Confianza', evidence: 'Evidencia', freshness: 'Frescura',
      evaluated_note: 'Estos factores se evaluaron; su efecto está reflejado en el ajuste neto de contexto, no como un impacto aislado por factor.',
      fac_favors: 'a favor', fac_against: 'en contra', fac_neutral: 'neutral',
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
      g_dist: 'Distribución de goles', g_margin: 'Margen de victoria', g_combos: 'Combinaciones', g_either2: 'Cualquiera gana por 2+', g_team_by2: '{team} por 2+', g_draw: 'Empate', g_team_wino25: '{team} gana y +2.5', g_wintonil: 'Cualquiera gana a cero', g_team_cs: '{team} valla invicta', g_push: 'empuje', g_home: 'Local', g_away: 'Visitante',
      live_min: 'Minuto', live_events: 'Eventos', live_stats: 'Estadísticas', live_prob: 'Probabilidad en vivo (modelo)', live_none: 'No hay datos en vivo verificados para este partido.',
      live_stale: 'Datos en vivo posiblemente desactualizados; pueden no reflejar el estado actual.',
      live_ctx_red: 'Probabilidad en vivo ajustada por tarjeta roja ({team}).',
      st_possession: 'Posesión', st_shots: 'Remates', st_sot: 'Al arco', st_corners: 'Córners', st_fouls: 'Faltas', st_xg: 'xG', st_offsides: 'Offsides', st_yellow: 'Amarillas',
      mod_form: 'Forma reciente', mod_lineups: 'Alineaciones', mod_stats: 'Estadísticas',
      form_gf: 'GF', form_ga: 'GC', form_cs: 'Vallas', form_avg: 'Prom.', lineup_subs: 'Suplentes',
      evk_goal: 'Gol', evk_yellow: 'Amarilla', evk_red: 'Roja', evk_subst: 'Cambio', evk_var: 'VAR', evk_other: 'Evento',
      lineup_conf: 'Confirmada', lineup_proj: 'Proyectada', formation: 'Formación', news_title: 'Noticias', match_loading: 'Cargando partido…', match_404: 'No se pudo cargar el análisis de este partido.',
      // ---- Corte 3: Partidos + Simulador ----
      g_today: 'Hoy', g_tomorrow: 'Mañana', m_stage_all: 'Todas las fases', m_search: 'Buscar equipo…', m_empty: 'No hay partidos para este filtro.',
      gp_absent: 'Sin evaluación GP prepartido', gp_absent_sub: 'No se registró una evaluación GP prepartido para este encuentro.',
      gp_absent_final: 'Sin evaluación GP prepartido', gp_absent_final_sub: 'No se registró una evaluación GP prepartido para este encuentro. Se muestran el resultado y los datos del partido.',
      sim_pick: 'Elegí un equipo', sim_swap: 'Intercambiar', sim_go: 'Simular cruce', sim_running: 'Simulando…', sim_hypo: 'Simulación hipotética con el contexto disponible actualmente.',
      sim_empty: 'Elegí dos equipos para simular un cruce.', sim_empty_sub: 'GP cruza ambos con su contexto actual.', sim_err: 'No se pudo simular el cruce.',
      sim_thesis_na: 'Sin lectura disponible para este cruce.', sim_risk_na: 'Sin factores de cambio destacados.', sim_verdict_na: 'Cruce sin favorito neto claro.',
      sim_factors: 'Factores GP', sim_f_applied: 'Pesa', sim_f_neutral: 'Neutral',
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
      bk_subtitle: 'Cuadro de eliminación · estructura oficial FIFA · desliza para ver todas las rondas',
      slot_gw: '1º Grupo {g}', slot_gr: '2º Grupo {g}', slot_t3: '3º ({groups})', slot_win: 'Ganador P{m}', slot_los: 'Perdedor P{m}',
      evo_insufficient: 'Evolución no disponible todavía', evo_insufficient_sub: 'Aún no hay suficientes snapshots reales ({n}). La evolución se registra a medida que el torneo avanza.',
      evo_champion: 'Probabilidad de campeón', evo_snapshots: 'snapshots', evo_trend: 'Tendencia', evo_now: 'Ahora', evo_top: 'Top 10', evo_note: 'Solo snapshots reales registrados; sin histórico fabricado.',
      reg_picks: 'Picks', reg_settled: 'Liquidadas', reg_winrate: 'Aciertos', reg_sample: 'Muestra', reg_insufficient: 'Insuficiente', reg_history: 'Historial de Picks',
      // ---- Feed de picks diarias (producto) ----
      pf_today: 'Picks del día', pf_count: 'picks activas', pf_count1: 'pick activa',
      pf_empty: 'No hay picks activas ahora mismo', pf_empty_sub: 'Las picks del día aparecen aquí en cuanto se publican. Vuelve pronto.',
      pf_yesterday: 'Ayer: {won} de {total} picks acertadas', pf_next_ko: 'El próximo partido es a las {time} — las picks salen unas horas antes',
      pf_fam_solid: 'Ganador', pf_fam_goals: 'Goles', pf_fam_combo: 'Combinada',
      pf_wins: 'Gana {team}', pf_over: 'Más de {line} goles', pf_under: 'Menos de {line} goles',
      pf_conf: 'Confianza', pf_conf_high: 'Alta', pf_conf_med: 'Media', pf_conf_low: 'Moderada',
      pf_best_odds: 'Mejor cuota', pf_at: 'en', pf_combo_and: 'y', pf_pick_label: 'Nuestra pick',
      pf_disclaimer: 'Estimaciones de inteligencia deportiva. No es consejo financiero. Apuesta con responsabilidad.',
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
      // ---- Fase 5: equipos tabs + cuenta ----
      nav_refer: 'Invitar',
      tm_groupwin: 'Gana grupo', tm_groupsecond: '2º grupo', tm_out: 'Fuera', tm_follow: 'Seguir', tm_following: 'Siguiendo',
      tm_tab_squad: 'Plantilla', tm_tab_results: 'Resultados', tm_keyplayers: 'Jugadores clave', tm_last5: 'Últimos 5', tm_mkt_price: 'Precio', tm_read: 'Lectura del modelo', tm_likely_opp: 'Rivales probables', tm_paths: 'Caminos simulados',
      tm_next_ctx: 'Próximo partido · contexto GP', tm_ctx_note: 'Abrí el cockpit del partido para ver la probabilidad GP con el contexto aplicado (forma, bajas, clima).', tm_base_note: 'Las probabilidades de torneo reflejan la fuerza base del equipo (Elo + simulación). El contexto de cada partido (forma, bajas, clima) se aplica en el cockpit de ese encuentro.',
      st_injured: 'Lesionado', st_suspended: 'Suspendido', st_doubt: 'Duda', st_available: 'Disponible',
      fol_empty: 'Aún no sigues equipos', fol_empty_sub: 'Marca la estrella en un equipo para seguirlo.',
      al_events: 'Eventos', al_channels: 'Canales', al_next: 'Próximo partido', al_start: 'Inicio del partido', al_goal: 'Gol', al_result: 'Resultado final', al_qualify: 'Clasificación', al_swing: 'Cambio de probabilidad', al_value: 'Oportunidad de valor', al_arb: 'Arbitraje', al_email: 'Email', al_telegram: 'Telegram', al_push: 'Notificaciones push', al_soon: 'pronto', al_note: 'Las alertas por email están activas; Telegram y push llegan pronto.',
      ref_verified: 'referidos verificados', ref_copy: 'Copiar enlace', ref_copied: '¡Copiado!', ref_tiers: 'Niveles', ref_rule: 'Un referido se verifica cuando tu invitado confirma su correo. Umbral de acceso: 5 referidos verificados.',
      ref_t1: 'Embajador', ref_t3: 'Plata', ref_t5: 'Oro · acceso', ref_t10: 'Leyenda',
      perf_sample: 'Muestra', perf_method: 'Metodología', perf_method_b: 'Métricas verificables sobre señales liquidadas desde el Verified Epoch: Brier (calibración), Log loss (penaliza errores extremos) y ECE (error de calibración). No afirmamos rentabilidad con muestra chica.',
      perf_total: 'Evaluados', perf_hits: 'Aciertos', perf_exact: 'Marcador exacto', perf_vs_market: 'GP vs mercado', perf_hitrate: '% de aciertos (1X2)',
      pp_title: 'Rendimiento de picks', pp_settled: 'Liquidadas', pp_hit: '% Aciertos', pp_roi: 'ROI', pp_pnl: 'P&L', pp_byfam: 'Por familia', pp_history: 'Historial de picks', pp_pick: 'Pick', pp_active: 'activas', pp_none: 'Aún no hay picks liquidadas.', pp_model: 'Calibración del modelo (1X2)',
      opp_value_empty: 'Sin Value accionable ahora', opp_value_empty_sub: 'El motor sigue evaluando; aparece cuando GP detecta ventaja sobre el precio.',
      outright_title: 'Campeón del Mundial · Value', outright_sub: 'Probabilidad GP del torneo vs mercado', outright_none: 'Sin ventaja sobre el mercado para el título ahora.',
      tm_gpi: 'GP Intelligence · título', tm_gpi_model: 'Probabilidad GP (campeón)', tm_gpi_market: 'Mercado', tm_gpi_edge: 'Ventaja GP', tm_gpi_note: 'Probabilidad de ser campeón según el modelo GP del torneo (fuerza base Elo + simulación Monte Carlo). El contexto de cada partido (forma, bajas, clima) se aplica en el cockpit del encuentro y en el próximo partido de abajo.',
      opp_actionable: 'Accionable', opp_watch_only: 'En observación',
      opp_arb_na: 'Arbitraje no disponible', opp_arb_evaluated: 'comparaciones', opp_arb_executable: 'ejecutables', opp_arb_note: 'Cero ejecutables es un resultado válido: los mercados están alineados.', opp_arb_market: 'Mercado', opp_arb_margin: 'Margen neto',
      arbst_EXECUTABLE: 'Ejecutable', arbst_THEORETICAL_ONLY: 'Solo teórico', arbst_PARTIAL_EXECUTION_RISK: 'Ejecución parcial', arbst_BLOCKED: 'Bloqueado', arbst_BLOCKED_SEMANTIC_MISMATCH: 'Reglas distintas', arbst_EXPIRED: 'Expirado', arbst_SUSPENDED: 'Suspendido', arbst_STALE: 'Desactualizado',
      arb_tag_1x2: '1X2', arb_tag_totals: 'Goles {line}', arb_tag_champ: 'Campeón', arb_over: 'Más de {line}', arb_under: 'Menos de {line}', arb_draw: 'Empate',
      arb_champ_yes: '{team} campeón', arb_champ_no: '{team} no campeón',
      arb_fam_pure: 'Arbitraje puro', arb_fam_pure_sub: 'El mercado se contradice entre casas: apostás las dos patas y ganás pase lo que pase.',
      arb_fam_lag: 'Precio atrasado', arb_fam_lag_sub: 'Una casa quedó por encima del consenso: value +EV en una sola apuesta.',
      arb_roi: 'ROI garantizado', arb_roi_theo: 'ROI teórico', arb_theo_badge: 'teórico', arb_value: 'Valor', arb_stake: 'Poné', arb_at: 'en', arb_fair: 'Cuota justa', arb_consensus: 'consenso de {n} casas', arb_exchange: 'exchange',
      arb_x_pure_theo: 'Teórico: el margen es demasiado fino y puede desaparecer al confirmar (la cuota se mueve). No es un surebet garantizado.',
      arb_x_pure_theo_pm: 'Teórico: incluye un prediction market donde solo vemos el mejor precio, no la profundidad real ejecutable. Tras fees y liquidez el margen suele desaparecer — históricamente Poly↔Kalshi no deja arbitraje ejecutable. Verificá tamaño y fees antes de operar.',
      arb_theo_group: '{n} teóricos (margen fino o profundidad no verificada, no garantizados)',
      arb_kpi_markets: 'mercados escaneados', arb_kpi_surebets: 'surebets', arb_kpi_lags: 'precios atrasados',
      arb_none_pure: 'Sin surebets ahora mismo', arb_none_pure_sub: 'Escaneamos {n} mercados y las casas están alineadas. Seguimos mirando.',
      arb_none_lag: 'Sin precios atrasados ahora', arb_none_lag_sub: 'Ninguna casa se salió del consenso lo suficiente. Volvé en unos minutos.',
      arb_gubbing: 'Ojo: las casas recreativas limitan o cierran a quien apuesta siempre con ventaja. Apostá con moderación y variá de casa.',
      arb_prep: 'Arbitraje en preparación', arb_prep_sub: 'El scanner multi-venue se está activando. Vuelve en un momento.',
      arb_disclaimer: 'Estimaciones de un scanner de precios de mercado, no consejo financiero. Verificá cuota y reglas en la casa antes de apostar.',
      arb_ago_now: 'recién', arb_ago_min: 'hace {m} min', arb_ago_hr: 'hace {h} h',
      arb_detail_cta: 'Ver oportunidad', arb_vs_fav_short: 'Contra el favorito', arb_detected: 'Oportunidad detectada', arb_sec_opp: 'Oportunidad',
      arb_best: 'Mejor arbitraje', arb_none_now: 'Sin oportunidad ahora', arb_scanning: 'Escaneando mercados…',
      arb_x_pure_1: 'Cubrí las patas con el reparto indicado y ganás {roi} pase lo que pase.',
      arb_x_pure_2: 'Necesitás cuenta en cada casa y actuar rápido: la cuota se mueve en segundos.',
      arb_x_lag_1: '{book} cuelga {sel} a {odds}. El consenso sin margen de {n} casas lo valora en {fair} → {edge} de valor esperado.',
      arb_x_lag_against: '{sel} NO es el favorito (lo es {fav} ~{favpct}). Vas contra la corriente: en UNA sola apuesta lo más probable es que pierdas y la cuota se vaya a 0.',
      arb_x_trade_title: 'Cómo tomarla:',
      arb_x_trade_exch: 'tomá el precio ahora y, cuando el venue ajuste su cuota hacia el consenso, vendé/cubrí la posición para asegurar ganancia sin importar el resultado (trading de línea). No la holdees hasta el final.',
      arb_x_trade_soft: 'en esta casa no podés vender la posición, así que el valor se realiza a LARGO PLAZO (muchas apuestas), con varianza plena en cada una. Apostá poco; si la cuota se mueve a tu favor, algunas casas ofrecen "cash out" parcial para cerrar antes.',
      perf_matches: 'Todos los partidos evaluados', perf_predicted: 'GP', perf_result: 'Resultado', perf_hit: 'Acierto', perf_acc: 'Precisión',
      gp_pending_ctx: 'La evaluación de contexto GP para este partido aún no se generó; se muestra la probabilidad base del modelo (Elo + Monte Carlo). El contexto detallado (forma, bajas, etc.) está en la pestaña Contexto.',
      calc_nav: 'Calculadora', calc_title: 'Calculadora de stake', calc_open: 'Calcular stake', calc_open_arb: 'Repartir stake',
      calc_bankroll: 'Tu bankroll', calc_currency: 'Moneda', calc_prob: 'Probabilidad', calc_prob_gp: 'Probabilidad GP', calc_prob_cons: 'Consenso del mercado',
      calc_odds: 'Cuota', calc_fraction: 'Fracción Kelly', calc_full: 'Pleno',
      calc_suggested: 'Stake sugerido', calc_of_bankroll: 'del bankroll', calc_ev: 'Ganancia esperada', calc_be: 'Prob. de equilibrio',
      calc_noedge: 'Sin ventaja a esta cuota', calc_noedge_sub: 'La cuota no cubre la probabilidad estimada — no se sugiere stake.',
      calc_capped: 'Limitado al {pct} del bankroll (tope de seguridad)',
      calc_prefill_gp: 'Prellenado con la probabilidad GP', calc_prefill_cons: 'Prellenado con el consenso sin margen del mercado',
      calc_set_bankroll: 'Ingresá tu bankroll para ver el monto', calc_kelly_note: 'Kelly fraccionado con tope del 5% — gestión de riesgo conservadora.',
      calc_disc: 'Sugerencia educativa según tu bankroll. No es consejo financiero. Apostá con responsabilidad.',
      calc_mode_simple: 'Apuesta simple', calc_mode_arb: 'Arbitraje',
      calc_total: 'Monto total a repartir', calc_per_leg: 'Reparto por pata', calc_guaranteed: 'Ganancia garantizada', calc_payout: 'Retorno igual',
      calc_put: 'Poné', calc_arb_invalid: 'Con estas cuotas no hay ganancia garantizada (margen ≥ 100%).', calc_leg: 'Pata',
      calc_intro_simple: 'Calculá cuánto apostar según tu bankroll. Prellenamos la probabilidad con nuestro modelo — ese es el diferenciador.',
      calc_intro_arb: 'Ingresá las cuotas de cada pata y el monto total: te repartimos cuánto poner en cada casa para asegurar la ganancia.',
      calc_add_leg: 'Agregar pata', calc_remove: 'Quitar', calc_saved: 'Guardado en este dispositivo', calc_edge: 'Ventaja',
      calc_level: 'Nivel de stake', calc_value_tag: 'VALOR', calc_flat_tag: 'PLANO', calc_return_win: 'Retorno si acierta',
      calc_flat_warn: 'Sin ventaja de valor a esta cuota (mercado eficiente). Te sugerimos un stake plano para gestión de bankroll — apostá con disciplina.',
    },
    en: {
      nav_opps: 'Opportunities', nav_matches: 'Matches', nav_teams: 'Teams', nav_sim: 'Simulator', nav_follow: 'Following',
      nav_alerts: 'Alerts', nav_perf: 'Performance', nav_groups: 'Groups', nav_bracket: 'Bracket', nav_evo: 'Evolution',
      nav_registry: 'Registry', nav_method: 'Methodology', nav_admin: 'Admin', more: 'More',
      account: 'My profile', account_beta: 'BETA', logout: 'Sign out',
      pf_title: 'My profile', pf_intro: 'Complete your profile to get updates in your language and content for your country.', pf_name: 'Name', pf_country: 'Country', pf_country_ph: 'Select your country', pf_lang: 'Language', pf_other: 'Other', pf_save: 'Save', pf_saving: 'Saving…', pf_saved: 'Profile saved', pf_neterr: 'Network error',
      search: 'Search teams, matches, markets…', matches: 'matches', live: 'live', signals: 'signals today',
      title: 'Opportunities', all: 'All', live_f: 'Live', upcoming_f: 'Upcoming', picks: "Today's picks", value: 'Value', arb: 'Arbitrage',
      updated: 'Updated {t} ago', board: 'Opportunities board',
      best_pick: 'Top GP pick', best_value: 'Top value', top_gap: 'Largest GP–market disagreement', gap_tooltip: 'A difference between GP and the market does not by itself imply an executable opportunity.', arb_verified: 'Verified arbitrage',
      edge_adj: 'Adjusted edge', no_arb: 'No executable arbitrage', no_arb_sub: 'GP keeps comparing prices and rules', none: 'No data yet',
      th_time: 'Time', th_match: 'Match', th_state: 'State', th_gp: 'GP probability', th_market: 'Market', th_price: 'Best price', th_edge: 'Adj. edge', th_signal: 'Signal',
      st_live: 'LIVE', st_today: 'TODAY', st_tom: 'TOMORROW', st_ft: 'Full time', st_upcoming: 'Upcoming', st_finished: 'Finished', vs: 'vs',
      decided_pens: 'Penalties', decided_et: 'After extra time', in_et: 'Extra time', won_by: '{team} won', pens_short: 'pen',
      cockpit: 'Match cockpit', prob_gp: 'GP probability', score_prob: 'Likely score',
      tab_summary: 'Summary', tab_markets: 'Markets', tab_context: 'Context', tab_stats: 'Stats', tab_events: 'Events',
      memo: 'Decision memo', conf: 'Confidence', conf_hi: 'High', conf_mid: 'Medium', conf_lo: 'Low',
      verdict: 'Verdict', thesis: 'Thesis', price: 'Price', risk: 'Risk', invalidation: 'Invalidation',
      best_avail: 'Best available price', view_pick: 'View GP pick', open_analysis: 'Full analysis',
      vp1_t: 'Daily picks', vp1_s: 'Who to bet and how many goals — clear and simple, no jargon.',
      vp2_t: 'The best odds', vp2_s: 'We compare dozens of books and always give you the best price.',
      vp3_t: 'Expert analysis', vp3_s: 'Every pick comes with its match read and expected goals.',
      vp4_t: 'Sports intelligence', vp4_s: 'Projections, matchups and tools to bet smart.',
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
      prob_live_adj: 'GP probability adjusted LIVE with the score, the minute and in-match events.',
      prob_base_only: 'The GP context evaluation for this match hasn’t been generated yet; the model’s base probability (Elo + Monte Carlo) is shown. Available context (form, absences, lineups) is in the Context tab.',
      drivers: 'Factors that moved the line', evaluated: 'Evaluated factors', impact: 'Impact', confidence: 'Confidence', evidence: 'Evidence', freshness: 'Freshness',
      evaluated_note: 'These factors were evaluated; their effect is reflected in the net context adjustment, not as an isolated per-factor impact.',
      fac_favors: 'favors', fac_against: 'against', fac_neutral: 'neutral',
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
      g_dist: 'Goal distribution', g_margin: 'Winning margin', g_combos: 'Combinations', g_either2: 'Either team by 2+', g_team_by2: '{team} by 2+', g_draw: 'Draw', g_team_wino25: '{team} wins & over 2.5', g_wintonil: 'Either wins to nil', g_team_cs: '{team} clean sheet', g_push: 'push', g_home: 'Home', g_away: 'Away',
      live_min: 'Minute', live_events: 'Events', live_stats: 'Stats', live_prob: 'Live probability (model)', live_none: 'No verified live data for this match.',
      live_stale: 'Live data may be stale; it might not reflect the current state.',
      live_ctx_red: 'Live probability adjusted for a red card ({team}).',
      st_possession: 'Possession', st_shots: 'Shots', st_sot: 'On target', st_corners: 'Corners', st_fouls: 'Fouls', st_xg: 'xG', st_offsides: 'Offsides', st_yellow: 'Yellows',
      mod_form: 'Recent form', mod_lineups: 'Lineups', mod_stats: 'Statistics',
      form_gf: 'GF', form_ga: 'GA', form_cs: 'Clean sheets', form_avg: 'Avg.', lineup_subs: 'Substitutes',
      evk_goal: 'Goal', evk_yellow: 'Yellow', evk_red: 'Red', evk_subst: 'Sub', evk_var: 'VAR', evk_other: 'Event',
      lineup_conf: 'Confirmed', lineup_proj: 'Projected', formation: 'Formation', news_title: 'News', match_loading: 'Loading match…', match_404: 'Couldn’t load this match analysis.',
      // ---- Corte 3: Matches + Simulator ----
      g_today: 'Today', g_tomorrow: 'Tomorrow', m_stage_all: 'All stages', m_search: 'Search team…', m_empty: 'No matches for this filter.',
      gp_absent: 'No pre-match GP evaluation', gp_absent_sub: 'No pre-match GP evaluation was recorded for this match.',
      gp_absent_final: 'No pre-match GP evaluation', gp_absent_final_sub: 'No pre-match GP evaluation was recorded for this match. Result and match data are shown.',
      sim_pick: 'Pick a team', sim_swap: 'Swap', sim_go: 'Simulate matchup', sim_running: 'Simulating…', sim_hypo: 'Hypothetical simulation using the context currently available.',
      sim_empty: 'Pick two teams to simulate a matchup.', sim_empty_sub: 'GP crosses both with their current context.', sim_err: 'Couldn’t simulate the matchup.',
      sim_thesis_na: 'No read available for this matchup.', sim_risk_na: 'No notable change factors.', sim_verdict_na: 'Matchup with no clear favorite.',
      sim_factors: 'GP factors', sim_f_applied: 'Weighs', sim_f_neutral: 'Neutral',
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
      bk_subtitle: 'Knockout bracket · official FIFA structure · scroll to see all rounds',
      slot_gw: '1st Group {g}', slot_gr: '2nd Group {g}', slot_t3: '3rd ({groups})', slot_win: 'Winner M{m}', slot_los: 'Loser M{m}',
      evo_insufficient: 'Evolution not available yet', evo_insufficient_sub: 'Not enough real snapshots yet ({n}). Evolution is recorded as the tournament progresses.',
      evo_champion: 'Champion probability', evo_snapshots: 'snapshots', evo_trend: 'Trend', evo_now: 'Now', evo_top: 'Top 10', evo_note: 'Only real recorded snapshots; no fabricated history.',
      reg_picks: 'Picks', reg_settled: 'Settled', reg_winrate: 'Win rate', reg_sample: 'Sample', reg_insufficient: 'Insufficient', reg_history: 'Picks history',
      // ---- Daily picks feed (product) ----
      pf_today: "Today's picks", pf_count: 'active picks', pf_count1: 'active pick',
      pf_empty: 'No active picks right now', pf_empty_sub: 'Daily picks show up here as soon as they are published. Check back soon.',
      pf_yesterday: 'Yesterday: {won} of {total} picks hit', pf_next_ko: 'Next match kicks off at {time} — picks drop a few hours before',
      pf_fam_solid: 'Winner', pf_fam_goals: 'Goals', pf_fam_combo: 'Combo',
      pf_wins: '{team} to win', pf_over: 'Over {line} goals', pf_under: 'Under {line} goals',
      pf_conf: 'Confidence', pf_conf_high: 'High', pf_conf_med: 'Medium', pf_conf_low: 'Moderate',
      pf_best_odds: 'Best odds', pf_at: 'at', pf_combo_and: 'and', pf_pick_label: 'Our pick',
      pf_disclaimer: 'Sports-intelligence estimates. Not financial advice. Bet responsibly.',
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
      // ---- Phase 5: team tabs + account ----
      nav_refer: 'Invite',
      tm_groupwin: 'Win group', tm_groupsecond: '2nd group', tm_out: 'Out', tm_follow: 'Follow', tm_following: 'Following',
      tm_tab_squad: 'Squad', tm_tab_results: 'Results', tm_keyplayers: 'Key players', tm_last5: 'Last 5', tm_mkt_price: 'Price', tm_read: 'Model read', tm_likely_opp: 'Likely opponents', tm_paths: 'Simulated paths',
      tm_next_ctx: 'Next match · GP context', tm_ctx_note: 'Open the match cockpit to see the GP probability with context applied (form, availability, weather).', tm_base_note: "Tournament probabilities reflect the team's base strength (Elo + simulation). Each match's context (form, availability, weather) is applied in that match's cockpit.",
      st_injured: 'Injured', st_suspended: 'Suspended', st_doubt: 'Doubt', st_available: 'Available',
      fol_empty: 'You don’t follow any teams yet', fol_empty_sub: 'Tap the star on a team to follow it.',
      al_events: 'Events', al_channels: 'Channels', al_next: 'Next match', al_start: 'Match start', al_goal: 'Goal', al_result: 'Final result', al_qualify: 'Qualification', al_swing: 'Probability swing', al_value: 'Value opportunity', al_arb: 'Arbitrage', al_email: 'Email', al_telegram: 'Telegram', al_push: 'Push notifications', al_soon: 'soon', al_note: 'Email alerts are active; Telegram and push are coming soon.',
      ref_verified: 'verified referrals', ref_copy: 'Copy link', ref_copied: 'Copied!', ref_tiers: 'Tiers', ref_rule: 'A referral is verified when your invitee confirms their email. Access threshold: 5 verified referrals.',
      ref_t1: 'Ambassador', ref_t3: 'Silver', ref_t5: 'Gold · access', ref_t10: 'Legend',
      perf_sample: 'Sample', perf_method: 'Methodology', perf_method_b: 'Verifiable metrics over settled signals since the Verified Epoch: Brier (calibration), Log loss (penalizes extreme errors) and ECE (calibration error). We don’t claim profitability with a small sample.',
      perf_total: 'Evaluated', perf_hits: 'Hits', perf_exact: 'Exact score', perf_vs_market: 'GP vs market', perf_hitrate: 'Hit rate (1X2)',
      pp_title: 'Picks performance', pp_settled: 'Settled', pp_hit: 'Win rate', pp_roi: 'ROI', pp_pnl: 'P&L', pp_byfam: 'By family', pp_history: 'Picks history', pp_pick: 'Pick', pp_active: 'active', pp_none: 'No settled picks yet.', pp_model: 'Model calibration (1X2)',
      opp_value_empty: 'No actionable Value right now', opp_value_empty_sub: 'The engine keeps evaluating; it appears when GP finds an edge over the price.',
      outright_title: 'World Cup winner · Value', outright_sub: 'GP tournament probability vs market', outright_none: 'No edge over the market for the title right now.',
      tm_gpi: 'GP Intelligence · title', tm_gpi_model: 'GP probability (champion)', tm_gpi_market: 'Market', tm_gpi_edge: 'GP edge', tm_gpi_note: 'Probability of winning the title per the GP tournament model (base Elo strength + Monte Carlo simulation). Each match\'s context (form, availability, weather) is applied in the match cockpit and in the next match below.',
      opp_actionable: 'Actionable', opp_watch_only: 'Watch',
      opp_arb_na: 'Arbitrage unavailable', opp_arb_evaluated: 'comparisons', opp_arb_executable: 'executable', opp_arb_note: 'Zero executable is a valid result: the markets are aligned.', opp_arb_market: 'Market', opp_arb_margin: 'Net margin',
      arbst_EXECUTABLE: 'Executable', arbst_THEORETICAL_ONLY: 'Theoretical only', arbst_PARTIAL_EXECUTION_RISK: 'Partial execution', arbst_BLOCKED: 'Blocked', arbst_BLOCKED_SEMANTIC_MISMATCH: 'Different rules', arbst_EXPIRED: 'Expired', arbst_SUSPENDED: 'Suspended', arbst_STALE: 'Stale',
      arb_tag_1x2: '1X2', arb_tag_totals: 'Goals {line}', arb_tag_champ: 'Champion', arb_over: 'Over {line}', arb_under: 'Under {line}', arb_draw: 'Draw',
      arb_champ_yes: '{team} champion', arb_champ_no: '{team} not champion',
      arb_fam_pure: 'Pure arbitrage', arb_fam_pure_sub: 'The market contradicts itself across books: back every leg and profit no matter the result.',
      arb_fam_lag: 'Stale price', arb_fam_lag_sub: 'One book lags the consensus: +EV value on a single bet.',
      arb_roi: 'Guaranteed ROI', arb_roi_theo: 'Theoretical ROI', arb_theo_badge: 'theoretical', arb_value: 'Value', arb_stake: 'Stake', arb_at: 'at', arb_fair: 'Fair odds', arb_consensus: '{n}-book consensus', arb_exchange: 'exchange',
      arb_x_pure_theo: 'Theoretical: the margin is too thin and may vanish on confirmation (odds move). Not a guaranteed surebet.',
      arb_x_pure_theo_pm: 'Theoretical: it includes a prediction market where we only see the best price, not the real executable depth. After fees and liquidity the margin usually disappears — historically Poly↔Kalshi leaves no executable arbitrage. Verify size and fees before trading.',
      arb_theo_group: '{n} theoretical (thin margin or unverified depth, not guaranteed)',
      arb_kpi_markets: 'markets scanned', arb_kpi_surebets: 'surebets', arb_kpi_lags: 'stale prices',
      arb_none_pure: 'No surebets right now', arb_none_pure_sub: 'We scanned {n} markets and the books are aligned. Still watching.',
      arb_none_lag: 'No stale prices right now', arb_none_lag_sub: 'No book strayed far enough from consensus. Check back in a few minutes.',
      arb_gubbing: 'Heads up: soft books limit or close accounts that always bet with an edge. Bet moderately and vary books.',
      arb_prep: 'Arbitrage warming up', arb_prep_sub: 'The multi-venue scanner is spinning up. Check back shortly.',
      arb_disclaimer: 'Estimates from a market-price scanner, not financial advice. Verify odds and rules at the book before betting.',
      arb_ago_now: 'just now', arb_ago_min: '{m} min ago', arb_ago_hr: '{h}h ago',
      arb_detail_cta: 'View opportunity', arb_vs_fav_short: 'Against the favorite', arb_detected: 'Opportunity detected', arb_sec_opp: 'Opportunity',
      arb_best: 'Top arbitrage', arb_none_now: 'No opportunity now', arb_scanning: 'Scanning markets…',
      arb_x_pure_1: 'Cover every leg with the shown split and you profit {roi} no matter the result.',
      arb_x_pure_2: 'You need an account at each book and must act fast — the odds move within seconds.',
      arb_x_lag_1: '{book} is offering {sel} at {odds}. The no-vig consensus of {n} books values it at {fair} → {edge} expected value.',
      arb_x_lag_against: '{sel} is NOT the favorite ({fav} ~{favpct} is). You are going against the grain: on a SINGLE bet you will most likely lose and the odds go to 0.',
      arb_x_trade_title: 'How to take it:',
      arb_x_trade_exch: 'take the price now and, when the venue shifts its odds toward consensus, sell/hedge the position to lock a profit regardless of the result (line trading). Do not hold it to settlement.',
      arb_x_trade_soft: 'at this book you cannot sell the position, so value is realized over the LONG RUN (many bets), with full variance on each. Bet small; if the line moves your way, some books offer partial cash out to close early.',
      perf_matches: 'All evaluated matches', perf_predicted: 'GP', perf_result: 'Result', perf_hit: 'Hit', perf_acc: 'Accuracy',
      gp_pending_ctx: 'The GP context evaluation for this match hasn’t been generated yet; the model’s base probability (Elo + Monte Carlo) is shown. Detailed context (form, absences, etc.) is in the Context tab.',
      calc_nav: 'Calculator', calc_title: 'Stake calculator', calc_open: 'Calculate stake', calc_open_arb: 'Split stake',
      calc_bankroll: 'Your bankroll', calc_currency: 'Currency', calc_prob: 'Probability', calc_prob_gp: 'GP probability', calc_prob_cons: 'Market consensus',
      calc_odds: 'Odds', calc_fraction: 'Kelly fraction', calc_full: 'Full',
      calc_suggested: 'Suggested stake', calc_of_bankroll: 'of bankroll', calc_ev: 'Expected profit', calc_be: 'Break-even prob.',
      calc_noedge: 'No edge at these odds', calc_noedge_sub: 'The odds don’t cover the estimated probability — no stake suggested.',
      calc_capped: 'Capped at {pct} of bankroll (safety cap)',
      calc_prefill_gp: 'Prefilled with the GP probability', calc_prefill_cons: 'Prefilled with the market’s no-vig consensus',
      calc_set_bankroll: 'Enter your bankroll to see the amount', calc_kelly_note: 'Fractional Kelly capped at 5% — conservative risk management.',
      calc_disc: 'Educational suggestion based on your bankroll. Not financial advice. Bet responsibly.',
      calc_mode_simple: 'Single bet', calc_mode_arb: 'Arbitrage',
      calc_total: 'Total to split', calc_per_leg: 'Split per leg', calc_guaranteed: 'Guaranteed profit', calc_payout: 'Equal payout',
      calc_put: 'Stake', calc_arb_invalid: 'These odds don’t guarantee a profit (margin ≥ 100%).', calc_leg: 'Leg',
      calc_intro_simple: 'Work out how much to bet based on your bankroll. We prefill the probability from our model — that’s the edge.',
      calc_intro_arb: 'Enter each leg’s odds and your total: we split how much to stake at each book so the profit is locked in.',
      calc_add_leg: 'Add leg', calc_remove: 'Remove', calc_saved: 'Saved on this device', calc_edge: 'Edge',
      calc_level: 'Stake level', calc_value_tag: 'VALUE', calc_flat_tag: 'FLAT', calc_return_win: 'Return if it wins',
      calc_flat_warn: 'No value edge at these odds (efficient market). We suggest a flat stake for bankroll management — bet with discipline.',
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
  // Banderas SVG self-hosted (nítidas en todos los OS — los emoji NO renderizan en Windows). Escala con el
  // font-size del contenedor (.fl) vía em. Fallback al emoji del server para ids fuera de los 48 del Mundial.
  var KNOWN_FLAG = /^(MEX|KOR|CZE|RSA|SUI|CAN|BIH|QAT|BRA|MAR|SCO|HAI|TUR|PAR|AUS|USA|ECU|GER|CIV|CUW|NED|JPN|SWE|TUN|BEL|IRN|EGY|NZL|ESP|URU|CPV|KSA|FRA|NOR|SEN|IRQ|ARG|AUT|ALG|JOR|POR|COL|UZB|COD|ENG|CRO|PAN|GHA)$/;
  var flag = function (id) { if (!id) return ''; if (KNOWN_FLAG.test(id)) return '<img class="flx" src="/flags/' + id + '.svg" alt="" draggable="false">'; return FLAGS[id] || ''; };
  // Nombres presentables de casas/venues — NUNCA códigos crudos ("betfair_ex_uk") frente al usuario.
  var BOOK_NAMES = {
    pinnacle: 'Pinnacle', bet365: 'bet365', williamhill: 'William Hill', williamhill_us: 'William Hill', betway: 'Betway',
    betvictor: 'BetVictor', betfred_uk: 'Betfred', boylesports: 'BoyleSports', unibet: 'Unibet', unibet_fr: 'Unibet FR',
    unibet_nl: 'Unibet NL', unibet_se: 'Unibet SE', unibet_se2: 'Unibet SE', unibet_eu: 'Unibet', unibet_uk: 'Unibet UK',
    betsson: 'Betsson', nordicbet: 'NordicBet', betclic_fr: 'Betclic', betanysports: 'BetAnySports', betonlineag: 'BetOnline',
    draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM', caesars: 'Caesars', betrivers: 'BetRivers',
    espnbet: 'ESPN BET', fanatics: 'Fanatics', ladbrokes: 'Ladbrokes', ladbrokes_au: 'Ladbrokes AU', coral: 'Coral',
    paddypower: 'Paddy Power', skybet: 'Sky Bet', '888sport': '888sport', sport888: '888sport', sportsbet: 'Sportsbet',
    tab: 'TAB', neds: 'Neds', pointsbetau: 'PointsBet', betfair_ex_eu: 'Betfair Exchange', betfair_ex_uk: 'Betfair Exchange',
    betfair_sb_uk: 'Betfair Sportsbook', betfair: 'Betfair', smarkets: 'Smarkets', matchbook: 'Matchbook',
    winamax_de: 'Winamax DE', winamax_fr: 'Winamax FR', tipico_de: 'Tipico', leovegas: 'LeoVegas', leovegas_se: 'LeoVegas SE',
    casumo: 'Casumo', onexbet: '1xBet', coolbet: 'Coolbet', grosvenor: 'Grosvenor', pmu_fr: 'PMU', marathonbet: 'Marathonbet',
    mybookieag: 'MyBookie', lowvig: 'LowVig', bovada: 'Bovada', betus: 'BetUS', gtbets: 'GTbets', everygame: 'Everygame',
    suprabets: 'Suprabets', ballybet: 'Bally Bet', betparx: 'betPARX', hardrockbet: 'Hard Rock Bet', playup: 'PlayUp',
    polymarket: 'Polymarket', kalshi: 'Kalshi', myriad: 'Myriad', novig: 'Novig', prophetx: 'ProphetX',
    tabtouch: 'TABtouch', betright: 'Bet Right', topsport: 'TopSport', boombet: 'BoomBet', betr_au: 'betr', dabble_au: 'Dabble'
  };
  function prettyBook(code) {
    if (!code) return '';
    var c = String(code); if (BOOK_NAMES[c]) return BOOK_NAMES[c];
    var lc = c.toLowerCase(); if (BOOK_NAMES[lc]) return BOOK_NAMES[lc];
    // desconocido: humanizar ("some_book_uk" → "Some Book UK") — jamás un código crudo en pantalla
    return lc.replace(/_/g, ' ').replace(/\b[a-z]/g, function (m) { return m.toUpperCase(); }).replace(/\b(Uk|Us|Us2|Eu|Au|Fr|De|Nl|Se|Ag|Ex)\b/g, function (m) { return m.toUpperCase(); });
  }
  var fmtTime = function (iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleTimeString(LANG === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };

  // ---------- state ----------
  var S = { dash: null, value: null, sel: null, match: null, sub: 'picks', filt: 'all', mc: {}, view: 'board', matchId: null, fixtures: [], mfix: {},
    cal: [], stTeams: [], canon: [], canonByKey: {}, mFilt: 'all', mStage: 'all', mQuery: '', sim: { a: null, b: null, data: null, loading: false },
    groups: [], standings: {}, knockoutRaw: [], history: [], teamId: null, tcache: {}, hist: null, registry: null, tQuery: '', obs: undefined,
    teamTab: 'resumen', me: null, refer: null, perf: undefined, evoFilt: 'top', oppSub: 'picks', arb: undefined, arbSub: 'pure', arbCtx: null, pendingSec: null, h2h: {} };

  // ---------- icons ----------
  // ---- iconografía PROPIA (firma visual): set dibujado a mano, dual-tone (detalle en acento vía clase .a/.af).
  // Grammar: 24×24, stroke 1.8 redondeado, UN elemento en acento por ícono. Los nombres no cubiertos caen a Tabler.
  var IC_SVG = {
    'target-arrow': '<circle cx="12" cy="13" r="7.6"/><circle cx="12" cy="13" r="3.2"/><path class="a" d="M12 13l6.2-6.2M18.2 6.8h-3.6M18.2 6.8v3.6"/>',
    'ball-football': '<circle cx="12" cy="12" r="8.4"/><path class="a" d="M12 8.3 15.4 10.8 14.1 14.7 9.9 14.7 8.6 10.8Z"/><path d="M12 3.6v4.7M4.6 9.8l4 1M6.8 18.2l3.1-3.5M17.2 18.2l-3.1-3.5M19.4 9.8l-4 1"/>',
    'arrows-shuffle': '<path d="M4 7.2h3.2c4.2 0 5.4 9.6 9.6 9.6H20"/><path d="M4 16.8h3.2c1.7 0 2.9-1.5 3.9-3.3M20 7.2h-3.2c-1.7 0-2.9 1.5-3.9 3.3"/><path class="a" d="M20 16.8l-2.6-2.6M20 16.8l-2.6 2.6M20 7.2l-2.6-2.6M20 7.2l-2.6 2.6"/>',
    'shield': '<path d="M12 3.6 19 6.1v5.1c0 4.5-2.9 7.5-7 9.2-4.1-1.7-7-4.7-7-9.2V6.1Z"/><path class="a" d="M9.3 11.9l1.9 1.9 3.5-3.8"/>',
    'shield-check': '<path d="M12 3.6 19 6.1v5.1c0 4.5-2.9 7.5-7 9.2-4.1-1.7-7-4.7-7-9.2V6.1Z"/><path class="a" d="M9.3 11.9l1.9 1.9 3.5-3.8"/>',
    'dots': '<circle cx="5.4" cy="12" r="1.5"/><circle class="af" cx="12" cy="12" r="1.5"/><circle cx="18.6" cy="12" r="1.5"/>',
    'star': '<path d="M12 4.4 14.3 9.2 19.6 10 15.8 13.7 16.7 18.9 12 16.4 7.3 18.9 8.2 13.7 4.4 10 9.7 9.2Z"/><path class="a" d="M19.2 4.2v2.8M17.8 5.6h2.8"/>',
    'bell': '<path d="M12 4.6c-2.9 0-4.9 2.1-4.9 4.9v3.1L5.5 15.4h13L16.9 12.6V9.5c0-2.8-2-4.9-4.9-4.9Z"/><path d="M10.1 18.3a1.9 1.9 0 0 0 3.8 0"/><path class="a" d="M18.3 5.4a6.8 6.8 0 0 1 1.7 3"/>',
    'search': '<circle cx="11" cy="11" r="6.4"/><path d="M15.7 15.7 20 20"/><path class="a" d="M8.6 11a2.4 2.4 0 0 1 2.4-2.4"/>',
    'user': '<circle cx="12" cy="8.5" r="3.5"/><path d="M5.2 19.3c1.3-2.9 3.8-4.5 6.8-4.5s5.5 1.6 6.8 4.5"/><circle class="af" cx="18.2" cy="17.4" r="1.7"/>',
    'trending-up': '<path d="M4 17 9.4 11.6 12.9 15.1 20 8"/><path class="a" d="M20 8h-4M20 8v4"/>',
    'arrows-left-right': '<path d="M20 8H7"/><path class="a" d="M7 8l3-3M7 8l3 3"/><path d="M4 16h13"/><path class="a" d="M17 16l-3-3M17 16l-3 3"/>',
    'clipboard-text': '<rect x="6" y="5" width="12" height="15.4" rx="2"/><path d="M9.5 5a2.5 2.5 0 0 1 5 0"/><path class="a" d="M9 10.6h6M9 13.6h6M9 16.6h3.4"/>',
    'alert-triangle': '<path d="M12 4.6 21 19.4H3Z"/><path class="a" d="M12 10v4.2M12 16.9v.2"/>',
    'clock': '<circle cx="12" cy="12" r="8.4"/><path class="a" d="M12 7.6V12l3 2.1"/>',
    'arrow-right': '<path d="M4.6 12H19"/><path class="a" d="M19 12l-4-4M19 12l-4 4"/>',
    'refresh': '<path d="M18.8 8.8A7.5 7.5 0 1 0 19.5 12"/><path class="a" d="M19.5 5v3.8h-3.8"/>',
    'ticket': '<path d="M4 8.5a2 2 0 0 0 0 7V19h16v-3.5a2 2 0 0 1 0-7V5H4Z" transform="translate(0 0)"/><path class="a" d="M12 6.5v2M12 11v2M12 15.5v2"/>',
  };
  var ic = function (n) {
    var c = IC_SVG[n];
    if (c) return '<i class="ti gxi" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + c + '</svg></i>';
    return '<i class="ti ti-' + n + '" aria-hidden="true"></i>';
  };
  // ---- ilustraciones de estados vacíos (line-art propio con un punto de acento — no un ícono suelto) ----
  var ILLO = {
    // radar: el observatorio escaneando mercados
    radar: '<svg class="gx-illo" viewBox="0 0 140 96" fill="none" aria-hidden="true"><circle cx="70" cy="48" r="40" stroke="rgba(255,255,255,.09)"/><circle cx="70" cy="48" r="26" stroke="rgba(255,255,255,.12)"/><circle cx="70" cy="48" r="12" stroke="rgba(255,255,255,.15)"/><path d="M70 8v80M30 48h80" stroke="rgba(255,255,255,.05)"/><path d="M70 48 104 22" stroke="rgba(31,227,164,.65)" stroke-width="1.6" stroke-linecap="round"/><path d="M70 48 104 22A40 40 0 0 0 92 14Z" fill="rgba(31,227,164,.10)"/><circle cx="52" cy="60" r="2.6" fill="rgba(255,255,255,.25)"/><circle cx="88" cy="66" r="2.6" fill="rgba(255,255,255,.18)"/><circle cx="96" cy="30" r="3.2" fill="#1FE3A4"><animate attributeName="opacity" values="1;.35;1" dur="2.2s" repeatCount="indefinite"/></circle></svg>',
    // tickets: el feed de picks sin picks activas
    tickets: '<svg class="gx-illo" viewBox="0 0 140 96" fill="none" aria-hidden="true"><g transform="rotate(-6 70 52)"><rect x="34" y="34" width="72" height="40" rx="7" stroke="rgba(255,255,255,.10)"/></g><g transform="rotate(3 70 48)"><rect x="30" y="28" width="80" height="44" rx="7" stroke="rgba(255,255,255,.22)" fill="rgba(255,255,255,.02)"/><path d="M52 28v44" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 4"/><path d="M60 42h34M60 50h24" stroke="rgba(255,255,255,.20)" stroke-linecap="round"/><circle cx="41" cy="50" r="5" stroke="rgba(31,227,164,.8)"/><path d="M38.8 50l1.6 1.6 2.8-3" stroke="#1FE3A4" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></g></svg>',
    // línea: no hay datos aún (gráfico esperando)
    chart: '<svg class="gx-illo" viewBox="0 0 140 96" fill="none" aria-hidden="true"><path d="M26 76h92M26 76V22" stroke="rgba(255,255,255,.12)" stroke-linecap="round"/><path d="M26 64 52 52 76 58 104 34" stroke="rgba(255,255,255,.28)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 5"/><circle cx="104" cy="34" r="3.4" fill="#1FE3A4"><animate attributeName="opacity" values="1;.4;1" dur="2s" repeatCount="indefinite"/></circle></svg>',
  };
  var illo = function (k) { return ILLO[k] || ''; };
  // ---- count-up: los números protagonistas cuentan hasta su valor al aparecer (respeta reduced-motion) ----
  function animNums(root) {
    if (!root) return;
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) {}
    [].forEach.call(root.querySelectorAll('.gx-anum'), function (el) {
      if (el.dataset.animated) return; el.dataset.animated = '1';
      var target = parseFloat(el.dataset.v != null ? el.dataset.v : el.textContent); if (!isFinite(target) || target === 0) return;
      var dec = (String(el.dataset.v || el.textContent).split('.')[1] || '').length;
      var t0 = null, dur = 620;
      function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / dur); var e = 1 - Math.pow(1 - p, 3); el.textContent = (target * e).toFixed(dec); if (p < 1) requestAnimationFrame(step); }
      requestAnimationFrame(step);
    });
  }
  var NAV = [
    ['opps', 'target-arrow', 'nav_opps'], ['matches', 'ball-football', 'nav_matches'], ['teams', 'shield', 'nav_teams'],
    ['sim', 'arrows-shuffle', 'nav_sim'], ['follow', 'star', 'nav_follow'], ['alerts', 'bell', 'nav_alerts'], ['perf', 'chart-line', 'nav_perf']
  ];
  var NAV2 = [['groups', 'layout-grid', 'nav_groups'], ['bracket', 'tournament', 'nav_bracket'], ['evo', 'trending-up', 'nav_evo'], ['registry', 'file-check', 'nav_registry'], ['refer', 'user-plus', 'nav_refer'], ['method', 'book', 'nav_method'], ['admin', 'settings', 'nav_admin']];

  function viewNav(v) { return v === 'team' ? 'teams' : (['matches', 'teams', 'sim', 'groups', 'bracket', 'evo', 'registry', 'method', 'admin', 'follow', 'alerts', 'refer', 'perf', 'calc'].indexOf(v) >= 0 ? v : 'opps'); }
  function shell() {
    var cur = viewNav(S.view), live = ['opps', 'matches', 'teams', 'sim', 'follow', 'alerts', 'perf', 'groups', 'bracket', 'evo', 'registry', 'method', 'refer', 'admin']; // vistas implementadas (clickeables)
    // Back office solo-admin en /x: Rendimiento, Registro y Metodología se ocultan a usuarios beta (producto = picks, no quant).
    var navHtml = NAV.map(function (n) { var clk = live.indexOf(n[0]) >= 0; return '<div class="gx-nav' + (n[0] === cur ? ' on' : '') + '"' + (clk ? ' data-nav="' + n[0] + '"' : '') + '>' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></div>'; }).join('');
    var nav2 = NAV2.map(function (n) { var clk = live.indexOf(n[0]) >= 0; var adminOnly = (n[0] === 'admin' || n[0] === 'registry' || n[0] === 'method') ? ' gx-admin-only' : ''; return '<div class="gx-nav' + adminOnly + (n[0] === cur ? ' on' : '') + '"' + (adminOnly ? ' style="display:none"' : '') + (clk ? ' data-nav="' + n[0] + '"' : '') + '>' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></div>'; }).join('');
    var moreViews = ['follow', 'alerts', 'perf', 'groups', 'bracket', 'evo', 'registry', 'refer', 'method', 'admin'];
    var bnav = [['opps', 'target-arrow', 'nav_opps'], ['matches', 'ball-football', 'nav_matches'], ['sim', 'arrows-shuffle', 'nav_sim'], ['teams', 'shield', 'nav_teams'], ['__more', 'dots', 'more']]
      .map(function (n) { if (n[0] === '__more') { var act = moreViews.indexOf(cur) >= 0 ? ' on' : ''; return '<a class="' + act.trim() + '" data-more="1">' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></a>'; } var clk = live.indexOf(n[0]) >= 0; return '<a class="' + (n[0] === cur ? 'on' : '') + '"' + (clk ? ' data-nav="' + n[0] + '"' : '') + '>' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></a>'; }).join('');
    $('#gx-root').innerHTML =
      '<div class="gx">' +
      '<aside class="gx-side">' +
      '<div class="gx-brand"><div class="gx-logo" aria-hidden="true"><svg viewBox="0 0 34 34" width="34" height="34"><defs><linearGradient id="gxg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#12B98A"/><stop offset="1" stop-color="#1FE3A4"/></linearGradient></defs><rect x="8.5" y="18" width="4" height="8.5" rx="2" fill="rgba(31,227,164,.34)"/><rect x="15" y="13.5" width="4" height="13" rx="2" fill="rgba(31,227,164,.62)"/><rect x="21.5" y="7.5" width="4" height="19" rx="2" fill="url(#gxg)"/></svg></div><div><b>GP Intelligence</b><span>Sports intelligence</span></div></div>' +
      '<div class="gx-navgroup">' + navHtml + '</div>' +
      '<div class="gx-navgroup"><div class="gx-label">' + esc(t('more')) + '</div>' + nav2 + '</div>' +
      '<div class="gx-side-foot"><div class="gx-avatar">A</div><div style="font-size:12px"><b style="font-weight:600">Alexis</b><div class="gx-dim" style="font-size:10.5px">Superadmin</div></div></div>' +
      '</aside>' +
      '<div class="gx-body">' +
      '<header class="gx-top">' +
      '<div class="gx-top-brand"><div class="gx-logo" aria-hidden="true"><svg viewBox="0 0 34 34" width="34" height="34"><defs><linearGradient id="gxg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#12B98A"/><stop offset="1" stop-color="#1FE3A4"/></linearGradient></defs><rect x="8.5" y="18" width="4" height="8.5" rx="2" fill="rgba(31,227,164,.34)"/><rect x="15" y="13.5" width="4" height="13" rx="2" fill="rgba(31,227,164,.62)"/><rect x="21.5" y="7.5" width="4" height="19" rx="2" fill="url(#gxg)"/></svg></div><b>GP Intelligence</b></div>' +
      '<div class="gx-search">' + ic('search') + '<input id="gx-search-i" autocomplete="off" spellcheck="false" placeholder="' + esc(t('search')) + '"><div class="gx-search-res" id="gx-search-res" hidden></div></div>' +
      '<div class="gx-pulse" id="gx-pulse"></div>' +
      '<div class="gx-spacer"></div>' +
      '<div class="gx-langs" id="gx-langs"><button data-l="es" class="' + (LANG === 'es' ? 'on' : '') + '">ES</button><button data-l="en" class="' + (LANG === 'en' ? 'on' : '') + '">EN</button></div>' +
      '<div class="gx-iconbtn" data-nav="alerts" title="' + esc(t('nav_alerts')) + '">' + ic('bell') + '<span class="gx-dot"></span></div>' +
      '<div class="gx-acct"><button class="gx-avatar-btn" id="gx-avatar-btn" aria-label="' + esc(t('account')) + '">' + ic('user') + '</button><div class="gx-acct-menu" id="gx-acct-menu" hidden></div></div>' +
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
    syncAdminUI();
    $('#gx-langs').addEventListener('click', function (e) { var b = e.target.closest('[data-l]'); if (b) setLang(b.dataset.l); });
    var avb = $('#gx-avatar-btn'); if (avb) avb.addEventListener('click', toggleAcctMenu);
    // subtabs de Oportunidades: Picks / Value / Arbitraje
    var setSub = function (sub) { S.oppSub = sub; ['picks', 'value', 'arb'].forEach(function (s) { var el = $('#gx-pc-' + s); if (el) el.classList.toggle('on', s === sub); }); var k = $('#gx-kpis'); if (k) k.style.display = (sub === 'picks') ? 'none' : ''; var rs = (S.dash && S.dash.upcoming || []).map(function (u) { return eventRow(u, gExpandValue(S.value)); }); if (sub !== 'picks') kpis(S.dash || {}, rs); board(rs); };
    var pc = function (id, sub) { var el = $('#gx-pc-' + id); if (el) el.addEventListener('click', function () { setSub(sub); }); };
    pc('picks', 'picks'); pc('value', 'value'); pc('arb', 'arb');
    // filtro Todos / En vivo / Próximos (estaba decorativo): setea S.filt y re-renderiza el board
    var filt = $('#gx-filt');
    if (filt) filt.addEventListener('click', function (e) {
      var b = e.target.closest('[data-f]'); if (!b) return;
      S.filt = b.dataset.f;
      [].forEach.call(filt.querySelectorAll('[data-f]'), function (x) { x.classList.toggle('on', x === b); });
      var rs = (S.dash && S.dash.upcoming || []).map(function (u) { return eventRow(u, gExpandValue(S.value)); });
      board(rs);
    });
    // buscador global (estaba decorativo): equipos + partidos → navega
    wireSearch();
  }

  // ---------- buscador global ----------
  function wireSearch() {
    var inp = $('#gx-search-i'), res = $('#gx-search-res'); if (!inp || !res) return;
    var hide = function () { res.hidden = true; res.innerHTML = ''; };
    var run = function () {
      var q = (inp.value || '').trim().toLowerCase(); if (q.length < 2) { hide(); return; }
      var norm = function (s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
      var nq = norm(q);
      // equipos
      var teams = (S.stTeams || []).filter(function (tm) { return norm(teamName(tm.id, tm.name)).indexOf(nq) >= 0; }).slice(0, 6);
      // partidos (no jugados primero)
      var cal = (S.cal || []).filter(function (c) { return c.home && c.away && (norm(teamName(c.home)).indexOf(nq) >= 0 || norm(teamName(c.away)).indexOf(nq) >= 0); });
      cal.sort(function (a, b) { var fa = (a.status === 'final') ? 1 : 0, fb = (b.status === 'final') ? 1 : 0; if (fa !== fb) return fa - fb; return new Date(a.datetime || 0) - new Date(b.datetime || 0); });
      cal = cal.slice(0, 6);
      var html = '';
      if (teams.length) html += '<div class="gx-sr-h">' + esc(t('nav_teams')) + '</div>' + teams.map(function (tm) { return '<div class="gx-sr-i" data-sr-team="' + esc(tm.id) + '"><span class="fl">' + flag(tm.id) + '</span><b>' + esc(teamName(tm.id, tm.name)) + '</b></div>'; }).join('');
      if (cal.length) html += '<div class="gx-sr-h">' + esc(t('nav_matches')) + '</div>' + cal.map(function (c) { return '<div class="gx-sr-i" data-sr-match="' + esc(oidFor(c)) + '"><span class="fl">' + flag(c.home) + '</span><b>' + esc(teamName(c.home)) + '</b><span class="gx-dim" style="margin:0 4px">' + esc(t('vs')) + '</span><span class="fl">' + flag(c.away) + '</span><b>' + esc(teamName(c.away)) + '</b><span class="gx-spacer"></span><span class="gx-dim gx-mono" style="font-size:10.5px">' + esc(fmtDate(c.datetime)) + '</span></div>'; }).join('');
      if (!html) html = '<div class="gx-sr-empty gx-dim">' + esc(t('e_na')) + '</div>';
      res.innerHTML = html; res.hidden = false;
    };
    inp.addEventListener('input', function () { clearTimeout(S._sq); S._sq = setTimeout(run, 160); });
    inp.addEventListener('focus', function () { if ((inp.value || '').trim().length >= 2) run(); });
    res.addEventListener('click', function (e) {
      var tm = e.target.closest('[data-sr-team]'); if (tm) { inp.value = ''; hide(); openTeam(tm.getAttribute('data-sr-team')); return; }
      var mm = e.target.closest('[data-sr-match]'); if (mm) { inp.value = ''; hide(); openMatch(mm.getAttribute('data-sr-match')); return; }
    });
    document.addEventListener('click', function (e) { if (!e.target.closest('.gx-search')) hide(); });
  }

  // ---------- hoja "Más" (bottom nav móvil) ----------
  // Menú de cuenta (arriba a la derecha, junto a la campana). Misma mecánica que la plataforma principal,
  // pero SIN repetir las opciones que ya están en "Más": solo identidad + Cerrar sesión (lo que faltaba en /x).
  function toggleAcctMenu(e) {
    if (e) e.stopPropagation();
    var m = $('#gx-acct-menu'); if (!m) return;
    if (!m.hidden) { m.hidden = true; return; }
    var email = (S.me && S.me.email) || '';
    var isAdmin = !!(S.me && S.me.isAdmin);
    var role = isAdmin ? 'ADMIN' : (t('account_beta') || 'BETA');
    m.innerHTML = '<div class="gx-acct-head"><div class="gx-avatar">' + esc(email ? email[0].toUpperCase() : 'GP') + '</div><div class="gx-acct-id"><div class="gx-acct-em">' + esc(email || '—') + '</div><div class="gx-acct-role">' + esc(role) + '</div></div></div>' +
      '<button class="gx-acct-i" id="gx-profile">' + ic('user') + '<span>' + esc(t('account')) + '</span></button>' +
      '<button class="gx-acct-i gx-acct-danger" id="gx-logout">' + ic('logout') + '<span>' + esc(t('logout')) + '</span></button>';
    var pf = m.querySelector('#gx-profile'); if (pf) pf.addEventListener('click', function () { closeAcctMenu(); openGxProfile(); });
    var lo = m.querySelector('#gx-logout'); if (lo) lo.addEventListener('click', gxLogout);
    m.hidden = false;
    setTimeout(function () { document.addEventListener('click', closeAcctMenu, { once: true }); }, 0);
  }
  function closeAcctMenu() { var m = $('#gx-acct-menu'); if (m) m.hidden = true; }
  function gxLogout() { try { localStorage.removeItem('wc_token'); } catch (e) {} location.replace('/'); }
  // Perfil en /x: nombre + país + idioma (hoja). Misma data que la principal (mismo /api/me/profile).
  // Lista COMPLETA de países (ISO 3166-1 alpha-2); nombre localizado con Intl.DisplayNames según el idioma.
  var GX_COUNTRY_CODES = 'AF AL DE AD AO AI AQ AG SA DZ AR AM AW AU AT AZ BS BD BB BH BE BZ BJ BM BY BO BA BW BR BN BG BF BI BT CV KH CM CA QA TD CL CN CY CO KM CG CD KP KR CI CR HR CU CW DK DM EC EG SV AE ER SK SI ES US EE ET PH FI FJ FR GA GM GE GH GI GD GR GL GP GU GT GF GG GN GQ GW GY HT HN HK HU IN ID IQ IR IE IS IM IL IT JM JP JE JO KZ KE KG KI KW LA LS LV LB LR LY LI LT LU MO MK MG MY MW MV ML MT MA MQ MU MR YT MX FM MD MC MN ME MS MZ MM NA NR NP NI NE NG NO NC NZ OM NL PK PW PA PG PY PE PF PL PT PR GB CF CZ DO RE RW RO RU WS AS KN SM PM VC SH LC ST SN RS SC SL SG SX SY SO LK SZ ZA SD SS SE CH SR TH TW TZ TJ IO TF PS TL TG TO TT TN TM TC TR TV UA UG UY UZ VU VA VE VN VG VI WF YE DJ ZM ZW'.split(' ');
  function openGxProfile() {
    document.getElementById('gx-prof-sheet') && document.getElementById('gx-prof-sheet').remove();
    var me = S.me || {};
    var lng = me.lang === 'en' ? 'en' : me.lang === 'es' ? 'es' : LANG;
    var dn; try { dn = new Intl.DisplayNames([LANG, 'es'], { type: 'region' }); } catch (e) { dn = null; }
    var clist = GX_COUNTRY_CODES.map(function (c) { return [c, (dn && dn.of(c)) || c]; }).sort(function (a, b) { return a[1].localeCompare(b[1], LANG); });
    clist.push(['XX', t('pf_other')]);
    var opts = clist.map(function (c) { return '<option value="' + c[0] + '"' + (me.country === c[0] ? ' selected' : '') + '>' + esc(c[1]) + '</option>'; }).join('');
    var w = document.createElement('div'); w.id = 'gx-prof-sheet'; w.className = 'gx-sheet-wrap';
    w.innerHTML = '<div class="gx-sheet-bg"></div><div class="gx-sheet"><div class="gx-sheet-h"><b>' + esc(t('pf_title')) + '</b><button class="gx-sheet-x">' + ic('x') + '</button></div>' +
      '<div style="display:flex;flex-direction:column;gap:4px">' +
      '<p class="gx-dim" style="font-size:12.5px;margin:0 0 8px">' + esc(t('pf_intro')) + '</p>' +
      '<label class="gx-pf-l">' + esc(t('pf_name')) + '</label><input id="gx-pf-name" class="gx-pf-in" maxlength="60" value="' + esc(me.name || '') + '">' +
      '<label class="gx-pf-l">' + esc(t('pf_country')) + '</label><select id="gx-pf-country" class="gx-pf-in"><option value="">' + esc(t('pf_country_ph')) + '</option>' + opts + '</select>' +
      '<label class="gx-pf-l">' + esc(t('pf_lang')) + '</label><select id="gx-pf-lang" class="gx-pf-in"><option value="es"' + (lng === 'es' ? ' selected' : '') + '>Español</option><option value="en"' + (lng === 'en' ? ' selected' : '') + '>English</option></select>' +
      '<div id="gx-pf-msg" class="gx-dim" style="font-size:12px;min-height:16px;margin-top:8px"></div>' +
      '<button class="gx-btn-primary" id="gx-pf-save" style="margin-top:6px">' + esc(t('pf_save')) + '</button>' +
      '</div></div>';
    document.body.appendChild(w);
    var close = function () { w.remove(); };
    w.querySelector('.gx-sheet-bg').addEventListener('click', close);
    w.querySelector('.gx-sheet-x').addEventListener('click', close);
    w.querySelector('#gx-pf-save').addEventListener('click', function () {
      var name = (w.querySelector('#gx-pf-name').value || '').trim(), country = w.querySelector('#gx-pf-country').value || '', lang = w.querySelector('#gx-pf-lang').value === 'en' ? 'en' : 'es';
      var msg = w.querySelector('#gx-pf-msg'); msg.textContent = t('pf_saving');
      fetch('/api/me/profile', { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify({ name: name, country: country, lang: lang }) }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
        if (!j) { msg.textContent = '✗ ' + t('pf_neterr'); return; }
        S.me = S.me || {}; S.me.name = j.name; S.me.country = j.country; S.me.lang = j.lang;
        msg.textContent = '✓ ' + t('pf_saved');
        if (lang !== LANG) setTimeout(function () { close(); setLang(lang); }, 600); else setTimeout(close, 600);
      });
    });
  }

  // Muestra/oculta las superficies SOLO-ADMIN (Admin) según la sesión. Llamado tras /api/me y en cada shell().
  function syncAdminUI() {
    var on = !!(S.me && S.me.isAdmin);
    [].forEach.call(document.querySelectorAll('.gx-admin-only'), function (el) { el.style.display = on ? '' : 'none'; });
  }
  function openMoreSheet() {
    var isAdmin = !!(S.me && S.me.isAdmin);
    var items = [['calc', 'calculator', 'calc_nav'], ['follow', 'star', 'nav_follow'], ['alerts', 'bell', 'nav_alerts'], ['perf', 'chart-line', 'nav_perf'], ['groups', 'layout-grid', 'nav_groups'], ['bracket', 'tournament', 'nav_bracket'], ['evo', 'trending-up', 'nav_evo'], ['refer', 'user-plus', 'nav_refer']].concat(isAdmin ? [['registry', 'file-check', 'nav_registry'], ['method', 'book', 'nav_method'], ['admin', 'settings', 'nav_admin']] : []);
    var existing = document.getElementById('gx-more-sheet'); if (existing) existing.remove();
    var sheet = document.createElement('div'); sheet.id = 'gx-more-sheet'; sheet.className = 'gx-sheet-wrap';
    sheet.innerHTML = '<div class="gx-sheet-bg"></div><div class="gx-sheet"><div class="gx-sheet-h"><b>' + esc(t('more')) + '</b><button class="gx-sheet-x" aria-label="close">' + ic('x') + '</button></div><div class="gx-sheet-grid">' +
      items.map(function (n) { return '<a class="gx-sheet-i" data-nav="' + n[0] + '">' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></a>'; }).join('') + '</div></div>';
    document.body.appendChild(sheet);
    var close = function () { sheet.remove(); };
    sheet.querySelector('.gx-sheet-bg').addEventListener('click', close);
    sheet.querySelector('.gx-sheet-x').addEventListener('click', close);
    sheet.addEventListener('click', function (e) { var a = e.target.closest('[data-nav]'); if (a) { close(); navTo(a.getAttribute('data-nav')); } });
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
    // En el tab de Picks (producto) la tira de KPIs quant (top gap, etc.) no aplica: el feed es autónomo. Se oculta.
    var strip = $('#gx-kpis'); if (strip) { if (S.oppSub === 'picks') { strip.style.display = 'none'; strip.innerHTML = ''; return; } strip.style.display = ''; }
    // Mejor pick: la pick diaria de mayor confianza (feed del producto). Lazy-load si aún no está.
    if (S.dailyPicks === undefined) { S.dailyPicks = null; fetch('/api/beta/picks', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.dailyPicks = (j && j.picks) || []; S.dailyPicksMeta = j ? { yesterday: j.yesterday || null, next_kickoff: j.next_kickoff || null } : null; if (S.view === 'board') kpis(S.dash || {}, rows); }); }
    var pick = (S.dailyPicks && S.dailyPicks.length) ? S.dailyPicks.slice().sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); })[0] : null;
    var val = (d.value || [])[0];
    // OUTRIGHT (campeón GP vs mercado): fuente de los fallbacks de "Mejor value" y "Mayor desacuerdo" cuando no hay
    // datos por-partido. Se carga siempre una vez (barato, cacheado) → ninguna caja queda "sin datos".
    if (S.valueOutright === undefined) { S.valueOutright = null; fetch('/api/beta/value-outright', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.valueOutright = (j && j.items) || []; if (S.view === 'board' && S.oppSub !== 'picks') kpis(S.dash || {}, rows); }); }
    var valOut = (!val && S.valueOutright && S.valueOutright.length) ? S.valueOutright.filter(function (x) { return x.edge_pp > 0.005; })[0] : null;
    var gap = rows.map(function (r) { var g = ['HOME', 'DRAW', 'AWAY'].map(function (c) { return { c: c, gp: r.gp(c), mk: r.mk(c) }; }).filter(function (x) { return x.gp != null && x.mk != null; }).sort(function (a, b) { return Math.abs(b.gp - b.mk) - Math.abs(a.gp - a.mk); })[0]; return g ? { r: r, g: g } : null; }).filter(Boolean).sort(function (a, b) { return Math.abs(b.g.gp - b.g.mk) - Math.abs(a.g.gp - a.g.mk); })[0];
    // Sin desacuerdo por-partido (el mercado 1X2 rara vez está cargado en el dashboard) → fallback al mayor
    // desacuerdo OUTRIGHT (campeón GP vs mercado), misma fuente que "Mejor value" → casi siempre hay data.
    var gapOut = (!gap && S.valueOutright && S.valueOutright.length) ? S.valueOutright.slice().sort(function (a, b) { return Math.abs(b.edge_pp) - Math.abs(a.edge_pp); })[0] : null;
    // Mejor oportunidad de arbitraje: surebet ejecutable > mejor precio atrasado soft. Carga compartida (loadArb).
    loadArb();
    var bestArb = null, bestArbRef = null;
    if (S.arb && S.arb.available) {
      var exeArb = (S.arb.arbitrage || []).filter(function (a) { return a.executable; })[0];
      if (exeArb) { bestArb = { fam: 'PURE_ARB', it: exeArb }; bestArbRef = 'arb:' + (S.arb.arbitrage || []).indexOf(exeArb); }
      else if ((S.arb.price_lag || []).length) { bestArb = { fam: 'PRICE_LAG', it: S.arb.price_lag[0] }; bestArbRef = 'lag:0'; }
    }
    var cards = [];
    cards.push(kpiCard(t('best_pick'), 'target-arrow', pick ? kpiPick2(pick) : '<div class="gx-kpi-sel gx-dim">' + esc(t('none_active_pick')) + '</div>', null, pick ? 'picks' : null));
    cards.push(kpiCard(t('best_value'), 'trending-up', val ? kpiVal(val) : (valOut ? kpiValOutright(valOut) : kpiEmpty()), null, (val || valOut) ? 'value' : null));
    cards.push(kpiCard(t('top_gap'), 'arrows-diff', gap ? kpiGap(gap) : (gapOut ? kpiGapOutright(gapOut) : kpiEmpty()), t('gap_tooltip'), gap ? ('match:' + gap.r.h.event_id) : (gapOut ? ('team:' + gapOut.team_id) : null)));
    var arbBody = bestArb ? kpiArb(bestArb)
      : (S.arb && S.arb.available) ? '<div class="gx-kpi-main"><div><div class="gx-kpi-sel gx-dim">' + esc(t('arb_none_now')) + '</div></div></div>'
      : (S.arb === null) ? '<div class="gx-kpi-main"><div><div class="gx-kpi-sel gx-dim">' + ic('loader-2') + ' ' + esc(t('arb_scanning')) + '</div></div></div>'
      : kpiEmpty();
    cards.push(kpiCard(t('arb_best'), 'arrows-left-right', arbBody, null, bestArbRef ? ('arb:' + bestArbRef) : null));
    $('#gx-kpis').innerHTML = cards.join('');
    // click en una caja KPI → navega a su superficie (o abre la card de la oportunidad de arbitraje)
    [].forEach.call($('#gx-kpis').querySelectorAll('[data-kpinav]'), function (el) {
      el.addEventListener('click', function () { kpiNav(el.getAttribute('data-kpinav')); });
    });
  }
  function kpiNav(target) {
    if (!target) return;
    if (target.indexOf('arb:') === 0) { // arb:<ref>  (ref = "arb:N" o "lag:N")
      var ref = target.slice(4);
      S.oppSub = 'arb'; ['picks', 'value', 'arb'].forEach(function (s) { var el = $('#gx-pc-' + s); if (el) el.classList.toggle('on', s === 'arb'); });
      openArbDetail(ref); return;
    }
    if (target.indexOf('match:') === 0) { S.arbCtx = null; openMatch(target.slice(6)); return; } // mayor desacuerdo → análisis del partido
    if (target.indexOf('team:') === 0) { openTeam(target.slice(5)); return; } // desacuerdo outright → página del equipo
    // picks | value → cambia de subtab y renderiza
    S.oppSub = target; ['picks', 'value', 'arb'].forEach(function (s) { var el = $('#gx-pc-' + s); if (el) el.classList.toggle('on', s === target); });
    var k = $('#gx-kpis'); if (k) k.style.display = (target === 'picks') ? 'none' : '';
    var rs = (S.dash && S.dash.upcoming || []).map(function (u) { return eventRow(u, gExpandValue(S.value)); }); board(rs);
  }
  function kpiCard(label, icon, body, tip, nav) { return '<div class="gx-panel gx-kpi' + (nav ? ' gx-kpi-clk' : '') + '"' + (nav ? ' data-kpinav="' + esc(nav) + '"' : '') + (tip ? ' title="' + esc(tip) + '"' : '') + '><div class="gx-label">' + ic(icon) + esc(label) + (tip ? ' <i class="ti ti-info-circle gx-kpi-info" aria-hidden="true"></i>' : '') + (nav ? '<span class="gx-spacer"></span>' + ic('arrow-right') : '') + '</div>' + body + '</div>'; }
  // pick diaria (feed del producto) en formato KPI. selection_code viene en minúscula ('home'/'away'/'draw') del
  // feed — normalizamos; el empate muestra "Empate" (no la frase larga del memo, que desbordaba la caja).
  function kpiPick2(p) {
    var sc = String(p.selection_code || '').toUpperCase();
    var sel = p.family === 'SOLID' ? (sc === 'AWAY' ? teamName(p.away_team_id, p.away) : sc === 'HOME' ? teamName(p.home_team_id, p.home) : t('arb_draw')) : (p.family === 'GOALS' ? (p.side === 'over' ? t('arb_over', { line: p.line }) : t('arb_under', { line: p.line })) : t('pf_fam_combo'));
    var flagId = sc === 'AWAY' ? p.away_team_id : p.home_team_id;
    return '<div class="gx-kpi-main"><span class="gx-kpi-flag">' + flag(flagId) + '</span><div><div class="gx-kpi-sel">' + esc(sel) + '</div><div class="gx-kpi-sub">' + esc(teamName(p.home_team_id, p.home) + ' ' + t('vs') + ' ' + teamName(p.away_team_id, p.away)) + '</div></div></div>' +
      '<div class="gx-kpi-foot"><span class="gx-mono">' + odd(p.odds) + '</span><span class="gx-pp gx-pos">' + esc(t('pf_fam_' + p.family.toLowerCase())) + '</span></div>';
  }
  // mejor value OUTRIGHT (campeón) — fallback cuando no hay value de partido; clickeable → subtab Value.
  function kpiValOutright(o) {
    return '<div class="gx-kpi-main"><span class="gx-kpi-flag">' + flag(o.team_id) + '</span><div><div class="gx-kpi-sel">' + esc(teamName(o.team_id)) + '</div><div class="gx-kpi-sub">' + esc(t('outright_title')) + '</div></div></div>' +
      '<div class="gx-kpi-foot"><span class="gx-mono">GP ' + pct1(o.model_pct) + ' · ' + pct1(o.market_pct) + '</span><span class="gx-pp gx-pos">' + pp(o.edge_pp) + '</span></div>';
  }
  // mayor desacuerdo OUTRIGHT (campeón GP vs mercado) — fallback del top_gap; clickeable → página del equipo.
  function kpiGapOutright(o) {
    return '<div class="gx-kpi-main"><span class="gx-kpi-flag">' + flag(o.team_id) + '</span><div><div class="gx-kpi-sel">' + esc(teamName(o.team_id)) + '</div><div class="gx-kpi-sub">' + esc(t('outright_title')) + '</div></div></div>' +
      '<div class="gx-kpi-foot"><span class="gx-mono">GP ' + pct1(o.model_pct) + ' · ' + pct1(o.market_pct) + '</span><span class="gx-pp gx-blue">' + pp(o.edge_pp) + '</span></div>';
  }
  // mejor oportunidad de arbitraje en formato KPI
  function kpiArb(b) {
    var it = b.it;
    if (b.fam === 'PURE_ARB') {
      return '<div class="gx-kpi-main"><span class="gx-kpi-flag">' + flag(it.home_team_id) + '</span><div><div class="gx-kpi-sel">' + esc(arbSel(it, it.legs[0].outcome)) + ' + …</div><div class="gx-kpi-sub">' + esc(arbTitle(it)) + '</div></div></div>' +
        '<div class="gx-kpi-foot"><span class="gx-mono">' + esc(t('arb_fam_pure')) + '</span><span class="gx-pp gx-pos">+' + (it.net_roi * 100).toFixed(2) + '%</span></div>';
    }
    return '<div class="gx-kpi-main"><span class="gx-kpi-flag">' + flag(it.home_team_id) + '</span><div><div class="gx-kpi-sel">' + esc(arbSel(it, it.outcome)) + ' @' + Number(it.odds).toFixed(2) + '</div><div class="gx-kpi-sub">' + esc(arbTitle(it)) + '</div></div></div>' +
      '<div class="gx-kpi-foot"><span class="gx-mono">' + esc(prettyBook(it.venue_label || it.venue)) + '</span><span class="gx-pp gx-pos">+' + (it.edge * 100).toFixed(1) + '%</span></div>';
  }
  function kpiEmpty() { return '<div class="gx-kpi-sel gx-dim">' + esc(t('none')) + '</div>'; }
  function pickSel(p) { if (p.selection_display_key) { return p.outcome_code === 'DRAW' ? t('memo_even') : teamName(p.home_team_id) + ' / ' + teamName(p.away_team_id); } return p.outcome_code || ''; }
  function kpiPick(p) {
    var name = p.outcome_code === 'DRAW' ? '' : (p.outcome_code === 'AWAY' ? teamName(p.away_team_id) : teamName(p.home_team_id));
    return '<div class="gx-kpi-main"><span class="gx-kpi-flag">' + (p.outcome_code === 'AWAY' ? flag(p.away_team_id) : flag(p.home_team_id)) + '</span><div><div class="gx-kpi-sel">' + esc(name) + '</div><div class="gx-kpi-sub">' + esc(teamName(p.home_team_id) + ' ' + t('vs') + ' ' + teamName(p.away_team_id)) + '</div></div></div>' +
      '<div class="gx-kpi-foot"><span class="gx-mono">' + odd(p.published_odds) + '</span><span class="gx-pp gx-pos">' + pp(p.adjusted_edge_pp) + '</span></div>';
  }
  function kpiVal(v) {
    var name = v.outcome_code === 'DRAW' ? '' : (v.team_ref === 'away' ? '' : '');
    return '<div class="gx-kpi-main"><div><div class="gx-kpi-sel">' + esc(v.outcome_code) + '</div><div class="gx-kpi-sub">' + esc(prettyBook(v.best_sportsbook || "")) + '</div></div></div>' +
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
    var bd = $('#gx-board');
    // subtabs Picks / Value / Arbitraje (prodchips). Value y Arbitraje muestran su propio contenido.
    if (S.oppSub === 'value') { $('#gx-board-count').textContent = ''; oppValueBoard(bd); return; }
    if (S.oppSub === 'arb') { $('#gx-board-count').textContent = ''; oppArbBoard(bd); return; }
    // Picks (producto): feed de picks diarias del día (efímero). Reemplaza la tabla quant (GP%/mercado%/edge).
    if (S.oppSub === 'picks') { picksFeed(bd); return; }
    if (S.filt === 'live') rows = rows.filter(function (r) { return r.live; });
    else if (S.filt === 'up') rows = rows.filter(function (r) { return !r.live; });
    $('#gx-board-count').textContent = rows.length + ' ' + t('matches') + ' · ' + t('th_gp');
    if (!rows.length) { bd.innerHTML = '<div class="gx-empty gx-empty-illo">' + illo("chart") + '<b>' + esc(t('e_na')) + '</b></div>'; return; }
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
  // ---- Oportunidades · Picks: FEED de picks diarias (producto principal). EFÍMERO: solo ACTIVE (las liquidadas
  // desaparecen). Lenguaje simple, sin tecnicismos: la pick + confianza + mejor cuota. Un solo "GP" (sin model%/mercado%).
  function confBucket(c) { return c >= 0.6 ? 'high' : c >= 0.45 ? 'med' : 'low'; }
  function picksFeed(bd) {
    if (S.dailyPicks === undefined) {
      S.dailyPicks = null;
      fetch('/api/beta/picks', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
        S.dailyPicks = (j && j.picks) || []; S.dailyPicksMeta = j ? { yesterday: j.yesterday || null, next_kickoff: j.next_kickoff || null } : null;
        if (S.oppSub === 'picks') { var b = $('#gx-board'); if (b) picksFeed(b); }
      });
      bd.innerHTML = '<div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div>';
      return;
    }
    var picks = S.dailyPicks || [];
    var cc = $('#gx-board-count'); if (cc) cc.textContent = picks.length + ' ' + (picks.length === 1 ? t('pf_count1') : t('pf_count'));
    var meta = S.dailyPicksMeta || {};
    // recap de AYER (prueba social agregada — el historial detallado sigue admin): "Ayer: 2 de 3 ✓"
    var recap = (meta.yesterday && meta.yesterday.total > 0)
      ? '<div class="gx-pick-recap' + (meta.yesterday.won / meta.yesterday.total >= 0.5 ? ' gx-recap-pos' : '') + '">' + ic('circle-check') + esc(t('pf_yesterday', { won: meta.yesterday.won, total: meta.yesterday.total })) + '</div>' : '';
    if (!picks.length) {
      // countdown (reversible por env GP_PICKS_COUNTDOWN_ENABLED): el vacío da una CITA, no un "vuelve pronto"
      var ko = '';
      if (meta.next_kickoff) { try { var hh = new Date(meta.next_kickoff).toLocaleTimeString(LANG === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }); ko = '<span class="gx-pick-nextko">' + ic('clock') + esc(t('pf_next_ko', { time: hh })) + '</span>'; } catch (e) {} }
      bd.innerHTML = recap + '<div class="gx-empty gx-pick-empty">' + illo("tickets") + '<b>' + esc(t('pf_empty')) + '</b><span class="gx-dim">' + esc(t('pf_empty_sub')) + '</span>' + ko + '</div>';
      return;
    }
    bd.innerHTML = recap + '<div class="gx-picks-feed">' + picks.map(pickCard).join('') + '</div>' +
      '<div class="gx-pick-disc">' + esc(t('pf_disclaimer')) + '</div>';
  }
  function pickTeam(p, code) { return code === 'home' ? teamName(p.home_team_id, p.home) : teamName(p.away_team_id, p.away); }
  function pickRecText(p) {
    if (p.family === 'SOLID') return t('pf_wins', { team: pickTeam(p, p.selection_code) });
    if (p.family === 'GOALS') return p.side === 'over' ? t('pf_over', { line: p.line }) : t('pf_under', { line: p.line });
    if (p.family === 'COMBO') return (p.legs || []).map(function (l) {
      if (l.type === '1X2') return t('pf_wins', { team: pickTeam(p, l.selection) });
      return l.side === 'over' ? t('pf_over', { line: l.line }) : t('pf_under', { line: l.line });
    }).join(' ' + t('pf_combo_and') + ' ');
    return '';
  }
  function pickCard(p) {
    var famKey = p.family === 'SOLID' ? 'pf_fam_solid' : p.family === 'GOALS' ? 'pf_fam_goals' : 'pf_fam_combo';
    var bucket = confBucket(p.confidence || 0);
    var confLabel = bucket === 'high' ? t('pf_conf_high') : bucket === 'med' ? t('pf_conf_med') : t('pf_conf_low');
    var hh = teamName(p.home_team_id, p.home), aa = teamName(p.away_team_id, p.away);
    var odds = p.odds != null ? Number(p.odds).toFixed(2) : '—';
    // TODAS las picks abren el GP Intelligence del partido: canónicas por event_id (cockpit completo + mercados),
    // sintéticas por team-ids (teams-HOME-AWAY → base→contexto→GP + proyección de goles, vía h2h deep). Si hay 3 picks
    // del mismo partido, cada una abre el mismo análisis del partido.
    var openId = p.event_id || ((p.home_team_id && p.away_team_id) ? 'teams-' + p.home_team_id + '-' + p.away_team_id : null);
    var clickable = !!openId;
    var openAttr = clickable ? ' data-openmatch="' + esc(openId) + '"' : '';
    return '<div class="gx-pick-card gx-pick-' + p.family.toLowerCase() + (clickable ? ' gx-pick-clickable' : '') + '"' + openAttr + '>' +
      '<div class="gx-pick-top"><span class="gx-pick-fam">' + esc(t(famKey)) + '</span>' +
      '<span class="gx-pick-time">' + ic('clock') + esc(fmtDateTime(p.kickoff)) + '</span></div>' +
      '<div class="gx-pick-match"><span class="fl">' + flag(p.home_team_id) + '</span><b>' + esc(hh) + '</b>' +
      '<span class="gx-pick-vs">' + esc(t('vs')) + '</span><b>' + esc(aa) + '</b><span class="fl">' + flag(p.away_team_id) + '</span></div>' +
      '<div class="gx-pick-rec"><span class="gx-pick-rec-label">' + esc(t('pf_pick_label')) + '</span><div class="gx-pick-rec-text">' + esc(pickRecText(p)) + '</div></div>' +
      '<div class="gx-pick-foot">' +
      '<div class="gx-pick-conf gx-conf-' + bucket + '"><span class="gx-pick-conf-dot"></span>' + esc(t('pf_conf')) + ': <b>' + esc(confLabel) + '</b></div>' +
      '<div class="gx-pick-odds"><span class="gx-pick-odds-label">' + esc(t('pf_best_odds')) + '</span><span class="gx-pick-odds-val">' + esc(odds) + '</span>' +
      (p.book ? '<span class="gx-pick-book">' + esc(t('pf_at')) + ' ' + esc(prettyBook(p.book)) + '</span>' : '') + '</div>' +
      '</div>' +
      (p.odds != null && p.confidence != null ? '<div class="gx-calc-row">' + stakeCalcBtn(p.confidence, Number(p.odds), pickRecText(p), 'gp') + '</div>' : '') +
      '</div>';
  }

  // ---- Oportunidades · Value: OUTRIGHT (campeón del Mundial) — GP% (torneo) vs mercado ----
  function outrightValueHtml() {
    if (S.valueOutright === undefined) {
      S.valueOutright = null;
      fetch('/api/beta/value-outright', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.valueOutright = (j && j.items) || []; if (S.oppSub === 'value') { var b = $('#gx-board'); if (b) oppValueBoard(b); } });
      return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('trophy') + esc(t('outright_title')) + '</span></div><div class="gx-mod-body"><div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div></div></div>';
    }
    var all = S.valueOutright || [];
    var pos = all.filter(function (x) { return x.edge_pp > 0.005; }).slice(0, 8);
    if (!pos.length) return '';
    var rowD = function (x) { return '<tr class="gx-row" data-nav-team="' + esc(x.team_id) + '"><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(x.team_id) + '</span><b>' + esc(teamName(x.team_id)) + '</b></div></td>' +
      '<td class="gx-mono gx-gp"><span class="hi">' + pct1(x.model_pct) + '</span></td><td class="gx-mono gx-dim">' + pct1(x.market_pct) + '</td>' +
      '<td class="gx-edge gx-pos">' + pp(x.edge_pp) + '</td><td class="l gx-dim" style="font-size:11px">' + esc(x.best_book || '—') + '</td></tr>'; };
    var desk = '<table class="gx-table"><thead><tr><th class="l">' + esc(t('nav_teams')) + '</th><th>GP</th><th>' + esc(t('hero_mkt')) + '</th><th>' + esc(t('th_edge')) + '</th><th class="l">' + esc(t('col_provider')) + '</th></tr></thead><tbody>' + pos.map(rowD).join('') + '</tbody></table>';
    var mob = pos.map(function (x) { return '<div class="gx-mcard" data-nav-team="' + esc(x.team_id) + '"><div class="gx-cell-team"><span class="fl">' + flag(x.team_id) + '</span><b>' + esc(teamName(x.team_id)) + '</b><span class="gx-spacer"></span><span class="gx-edge gx-pos">' + pp(x.edge_pp) + '</span></div>' +
      '<div class="gx-mcard-foot"><span class="gx-mono">GP ' + pct1(x.model_pct) + ' · ' + esc(t('hero_mkt')) + ' ' + pct1(x.market_pct) + '</span><span class="gx-dim" style="font-size:11px">' + esc(x.best_book || '') + '</span></div></div>'; }).join('');
    return '<div class="gx-panel gx-board" style="margin-bottom:14px"><div class="gx-ph"><span class="gx-label">' + ic('trophy') + esc(t('outright_title')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:11px">' + esc(t('outright_sub')) + '</span></div><div class="gx-bd-desk">' + desk + '</div><div class="gx-bd-mob">' + mob + '</div></div>';
  }
  // ---- Oportunidades · Value ----
  function oppValueBoard(bd) {
    var outright = outrightValueHtml();
    var vals = (S.value || []).slice().sort(function (a, b) { return (b.adjusted_edge_pp || 0) - (a.adjusted_edge_pp || 0); });
    var hdr = {}; ((S.dash && S.dash.upcoming) || []).forEach(function (u) { hdr[u.header.event_id] = u.header; });
    if (!vals.length) { bd.innerHTML = outright + '<div class="gx-empty">' + ic('trending-up') + '<b>' + esc(t('opp_value_empty')) + '</b>' + esc(t('opp_value_empty_sub')) + '</div>'; return; }
    var row = function (v) {
      var h = hdr[v.event_id], oc = v.outcome_code, fid = h ? (oc === 'AWAY' ? h.away.team_id : h.home.team_id) : null;
      var name = oc === 'DRAW' ? (LANG === 'en' ? 'Draw' : 'Empate') : (h ? teamName(fid) : oc);
      var matchN = h ? (teamName(h.home.team_id) + ' ' + t('vs') + ' ' + teamName(h.away.team_id)) : '';
      var bm = v.best_odds != null && v.minimum_odds != null && v.best_odds < v.minimum_odds;
      return { v: v, h: h, fid: fid, name: name, matchN: matchN, bm: bm };
    };
    var rows = vals.map(row);
    var desk = '<table class="gx-table"><thead><tr><th class="l">' + esc(t('th_match')) + '</th><th class="l">' + esc(t('th_signal')) + '</th><th>GP</th><th>' + esc(t('hero_mkt')) + '</th><th>' + esc(t('th_price')) + '</th><th>' + esc(t('th_edge')) + '</th><th class="l">' + esc(t('th_state')) + '</th><th class="l">' + esc(t('col_provider')) + '</th></tr></thead><tbody>' +
      rows.map(function (x) { var v = x.v; return '<tr class="gx-row" data-openmatch="' + esc(v.event_id) + '"><td class="l"><div class="gx-cell-team">' + (x.fid ? '<span class="fl">' + flag(x.fid) + '</span>' : '') + '<div class="gx-teamnames"><b>' + esc(x.name) + '</b><span>' + esc(x.matchN) + '</span></div></div></td>' +
        '<td class="l">' + (sigBadge(v.classification_code) || '—') + '</td><td class="gx-mono gx-gp"><span class="hi">' + pct0(v.gp_probability) + '</span></td><td class="gx-mono gx-dim">' + pct0(v.market_probability) + '</td><td class="gx-mono gx-best"><span class="hi">' + odd(v.best_odds) + '</span></td>' +
        '<td class="gx-edge ' + (v.adjusted_edge_pp > 0 ? 'gx-pos' : 'gx-dim') + '">' + pp(v.adjusted_edge_pp) + '</td>' +
        '<td class="l">' + (x.bm ? '<span class="gx-belowmin">' + ic('arrow-down') + esc(t('below_min_short')) + '</span>' : (v.actionable ? '<span class="gx-badge gx-b-strong">' + esc(t('opp_actionable')) + '</span>' : '<span class="gx-dim" style="font-size:11px">' + esc(t('opp_watch_only')) + '</span>')) + '</td>' +
        '<td class="l gx-dim" style="font-size:11px">' + esc(prettyBook(v.best_sportsbook) || "—") + (v.gp_probability > 0 && v.best_odds > 1 ? ' ' + stakeCalcBtn(v.gp_probability, Number(v.best_odds), x.name + (x.matchN ? ' · ' + x.matchN : ''), 'gp') : '') + '</td></tr>'; }).join('') + '</tbody></table>';
    var mob = rows.map(function (x) { var v = x.v; return '<div class="gx-mcard" data-openmatch="' + esc(v.event_id) + '"><div class="gx-mcard-top">' + (sigBadge(v.classification_code) || '') + '<span class="gx-spacer"></span>' + (x.bm ? '<span class="gx-belowmin">' + esc(t('below_min_short')) + '</span>' : (v.actionable ? '<span class="gx-badge gx-b-strong">' + esc(t('opp_actionable')) + '</span>' : '')) + '</div>' +
      '<div class="gx-cell-team" style="margin:6px 0">' + (x.fid ? '<span class="fl">' + flag(x.fid) + '</span>' : '') + '<div class="gx-teamnames"><b>' + esc(x.name) + '</b><span>' + esc(x.matchN) + '</span></div></div>' +
      '<div class="gx-mcard-foot"><span class="gx-mono">GP ' + pct0(v.gp_probability) + ' · ' + esc(t('th_price')) + ' ' + odd(v.best_odds) + '</span><span class="gx-edge ' + (v.adjusted_edge_pp > 0 ? 'gx-pos' : 'gx-dim') + '">' + pp(v.adjusted_edge_pp) + '</span></div>' +
      (v.gp_probability > 0 && v.best_odds > 1 ? '<div class="gx-calc-row">' + stakeCalcBtn(v.gp_probability, Number(v.best_odds), x.name + (x.matchN ? ' · ' + x.matchN : ''), 'gp') + '</div>' : '') +
      '</div>'; }).join('');
    bd.innerHTML = outright + '<div class="gx-bd-desk">' + desk + '</div><div class="gx-bd-mob">' + mob + '</div>';
  }
  // ---- Oportunidades · Arbitraje ----
  // ---- Oportunidades · Arbitraje: scanner MULTI-VENUE con dos familias. "Arbitraje puro" (surebet 2/N patas,
  // el mercado se contradice entre casas → ganás pase lo que pase) y "Precio atrasado" (value 1-pata: una casa
  // cuelga una cuota por encima del consenso no-vig del resto → +EV en una apuesta). Sin modelo GP (eso es Value).
  function arbAgo(s) { if (s == null) return ''; if (s < 90) return t('arb_ago_now'); var m = Math.round(s / 60); if (m < 60) return t('arb_ago_min', { m: m }); return t('arb_ago_hr', { h: Math.round(m / 60) }); }
  function arbTag(it) { return it.market_family === 'champion' ? t('arb_tag_champ') : it.market_family === 'match_total' ? t('arb_tag_totals', { line: it.line }) : t('arb_tag_1x2'); }
  function arbTitle(it) { return it.market_family === 'champion' ? teamName(it.home_team_id, it.home) : (teamName(it.home_team_id, it.home) + ' ' + t('vs') + ' ' + teamName(it.away_team_id, it.away)); }
  function arbSel(it, outcome) {
    if (it.market_family === 'champion') return outcome === 'yes' ? t('arb_champ_yes', { team: teamName(it.home_team_id, it.home) }) : t('arb_champ_no', { team: teamName(it.home_team_id, it.home) });
    if (it.market_family === 'match_total') return outcome === 'over' ? t('arb_over', { line: it.line }) : t('arb_under', { line: it.line });
    if (outcome === 'draw') return t('arb_draw');
    if (outcome === 'home') return teamName(it.home_team_id, it.home);
    if (outcome === 'away') return teamName(it.away_team_id, it.away);
    return outcome;
  }
  function arbMatchRow(it) { return '<div class="gx-arb-match"><span class="fl">' + flag(it.home_team_id) + '</span><b>' + esc(arbTitle(it)) + '</b>' + (it.market_family === 'champion' ? '' : '<span class="fl">' + flag(it.away_team_id) + '</span>') + '</div>'; }
  function arbCard(a, i) {
    var legs = (a.legs || []).map(function (l) {
      return '<div class="gx-arb-leg"><span class="gx-arb-leg-sel">' + esc(arbSel(a, l.outcome)) + '</span>' +
        '<span class="gx-arb-leg-odds gx-mono">' + Number(l.odds).toFixed(2) + '</span>' +
        '<span class="gx-arb-leg-book">' + esc(prettyBook(l.venue_label || l.venue)) + (l.is_exchange ? ' <span class="gx-arb-exch">' + esc(t('arb_exchange')) + '</span>' : '') + '</span>' +
        '<span class="gx-arb-leg-stake">' + esc(t('arb_stake')) + ' ' + Math.round(l.stake_pct) + '%</span></div>';
    }).join('');
    var roi = (a.net_roi * 100);
    var roiLbl = a.executable ? t('arb_roi') : t('arb_roi_theo');
    return '<div class="gx-arb-card gx-pick-clickable' + (a.executable ? ' gx-arb-exe' : '') + '" data-arbref="arb:' + i + '">' +
      '<div class="gx-pick-top"><span class="gx-pick-fam gx-fam-pure">' + ic('arrows-left-right') + esc(t('arb_fam_pure')) + (a.executable ? '' : ' <span class="gx-arb-theo">' + esc(t('arb_theo_badge')) + '</span>') + '</span>' +
      '<span class="gx-pick-time">' + esc(arbTag(a)) + ' · ' + esc(fmtDateTime(a.kickoff)) + '</span></div>' +
      arbMatchRow(a) +
      '<div class="gx-arb-legs">' + legs + '</div>' +
      '<div class="gx-pick-foot"><div class="gx-arb-roi ' + (a.executable ? 'gx-pos' : 'gx-dim') + '">' + ic('shield-check') + esc(roiLbl) + ': <b>+' + roi.toFixed(2) + '%</b></div>' +
      '<div class="gx-arb-fresh gx-dim">' + esc(t('arb_detail_cta')) + ' ' + ic('arrow-right') + '</div></div>' +
      ((a.legs || []).length >= 2 ? '<div class="gx-calc-row">' + arbCalcBtn(a) + '</div>' : '') +
      '</div>';
  }
  function lagCard(l, i) {
    var edge = (l.edge * 100);
    return '<div class="gx-lag-card gx-pick-clickable" data-arbref="lag:' + i + '">' +
      '<div class="gx-pick-top"><span class="gx-pick-fam gx-fam-lag">' + ic('trending-up') + esc(t('arb_fam_lag')) + '</span>' +
      '<span class="gx-pick-time">' + esc(arbTag(l)) + ' · ' + esc(fmtDateTime(l.kickoff)) + '</span></div>' +
      arbMatchRow(l) +
      '<div class="gx-lag-rec"><span class="gx-lag-sel">' + esc(arbSel(l, l.outcome)) + '</span>' +
      '<span class="gx-lag-odds gx-mono">' + Number(l.odds).toFixed(2) + '</span>' +
      '<span class="gx-lag-book">' + esc(t('arb_at')) + ' ' + esc(prettyBook(l.venue_label || l.venue)) + '</span>' +
      (l.is_favorite ? '' : '<span class="gx-lag-under">' + ic('alert-triangle') + esc(t('arb_vs_fav_short')) + '</span>') + '</div>' +
      '<div class="gx-pick-foot"><div class="gx-lag-edge gx-pos">' + ic('target-arrow') + esc(t('arb_value')) + ': <b>+' + edge.toFixed(1) + '%</b>' +
      '<span class="gx-dim"> · ' + esc(t('arb_fair')) + ' ' + Number(l.fair_odds).toFixed(2) + ' · ' + esc(t('arb_consensus', { n: l.consensus_groups })) + '</span></div>' +
      '<div class="gx-arb-fresh gx-dim">' + esc(t('arb_detail_cta')) + ' ' + ic('arrow-right') + '</div></div>' +
      (l.fair_odds > 1 && l.odds > 1 ? '<div class="gx-calc-row">' + stakeCalcBtn(1 / Number(l.fair_odds), Number(l.odds), arbSel(l, l.outcome), 'cons') + '</div>' : '') +
      '</div>';
  }
  // Carga ÚNICA compartida de /api/beta/arbitrage (KPIs y board la usan sin pisarse). Devuelve true si ya está lista.
  function loadArb() {
    if (S.arb && S.arb !== null && S.arb !== undefined) return true;
    if (S._arbLoading) return false;
    S._arbLoading = true; S.arb = null;
    fetch('/api/beta/arbitrage', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (m) { S.arb = m || { available: false, reason: 'error' }; S._arbLoading = false; arbRefresh(); });
    return false;
  }
  function arbRefresh() {
    if (S.view !== 'board') return;
    if (S.oppSub === 'arb') { var b = $('#gx-board'); if (b) oppArbBoard(b); }
    var kp = $('#gx-kpis'); if (kp && S.oppSub !== 'picks') { var rs = (S.dash && S.dash.upcoming || []).map(function (u) { return eventRow(u, gExpandValue(S.value)); }); kpis(S.dash || {}, rs); }
  }
  // Re-escaneo SILENCIOSO (efímero, como el feed de picks): re-fetch de /api/beta/arbitrage y re-render solo al
  // llegar la data (sin flash de "cargando"). Las oportunidades que dejaron de ser válidas se caen solas. NO se
  // persiste nada — el scanner es en vivo (sin registro de arbitrajes).
  function refreshArbSilent() {
    if (S._arbLoading) return;
    S._arbLoading = true;
    fetch('/api/beta/arbitrage', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (m) {
      S._arbLoading = false;
      if (!m) return;
      S.arb = m;
      arbRefresh();
    });
  }
  // sub-tabs internas de Arbitraje: "Arbitraje puro" | "Precio atrasado"
  function arbSubTabs(C) {
    var tab = function (id, icon, label, n, cls) {
      return '<button class="gx-arbsub' + (S.arbSub === id ? ' on' : '') + '" data-arbsub="' + id + '">' + ic(icon) + '<span>' + esc(label) + '</span>' +
        '<b class="gx-arbsub-n ' + (n ? cls : 'gx-dim') + '">' + n + '</b></button>';
    };
    return '<div class="gx-arbsubs">' +
      tab('pure', 'arrows-left-right', t('arb_fam_pure'), C.arb_executable || 0, 'gx-pos') +
      tab('lag', 'trending-up', t('arb_fam_lag'), C.lag_soft || 0, 'gx-pos') +
      '</div>';
  }
  function oppArbBoard(bd) {
    if (!loadArb()) { bd.innerHTML = '<div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div>'; return; }
    var d = S.arb || {};
    var cc = $('#gx-board-count'); if (cc) cc.textContent = '';
    if (!d.available) { bd.innerHTML = '<div class="gx-empty"><div class="gx-arb-scan-ic">' + ic('arrows-left-right') + '</div><b>' + esc(t('arb_prep')) + '</b><span class="gx-dim">' + esc(t('arb_prep_sub')) + '</span></div>'; return; }
    var C = d.counts || {}, arbs = d.arbitrage || [], lags = d.price_lag || [];
    // default INTELIGENTE del sub-tab (si el usuario no eligió manualmente): las surebets son raras por naturaleza
    // → aterrizar en "Arbitraje puro" vacío es mala primera impresión. Con 0 surebets ejecutables y precios
    // atrasados disponibles → abrir en "Precio atrasado". Si hay surebet → "Arbitraje puro" (es LA noticia).
    if (!S._arbSubUser) S.arbSub = (C.arb_executable > 0) ? 'pure' : (C.lag_soft > 0 ? 'lag' : S.arbSub);
    // KPIs del observatorio
    var head = '<div class="gx-arb-head">' +
      '<div class="gx-arb-kpi"><b class="gx-mono gx-anum" data-v="' + (C.markets_scanned || 0) + '">' + (C.markets_scanned || 0) + '</b><span class="gx-dim">' + esc(t('arb_kpi_markets')) + '</span></div>' +
      '<div class="gx-arb-kpi"><b class="gx-mono ' + (C.arb_executable ? 'gx-pos' : 'gx-dim') + ' gx-anum" data-v="' + (C.arb_executable || 0) + '">' + (C.arb_executable || 0) + '</b><span class="gx-dim">' + esc(t('arb_kpi_surebets')) + '</span></div>' +
      '<div class="gx-arb-kpi"><b class="gx-mono ' + (C.lag_soft ? 'gx-pos' : 'gx-dim') + ' gx-anum" data-v="' + (C.lag_soft || 0) + '">' + (C.lag_soft || 0) + '</b><span class="gx-dim">' + esc(t('arb_kpi_lags')) + '</span></div>' +
      '</div>';
    var body;
    if (S.arbSub === 'lag') {
      body = '<div class="gx-arb-sec"><div class="gx-arb-sec-h"><span class="gx-dim">' + esc(t('arb_fam_lag_sub')) + '</span></div>';
      if (lags.length) body += '<div class="gx-arb-warn">' + ic('alert-triangle') + esc(t('arb_gubbing')) + '</div>' + '<div class="gx-picks-feed">' + lags.map(lagCard).join('') + '</div>';
      else body += '<div class="gx-empty gx-arb-obs">' + illo("radar") + '<b>' + esc(t('arb_none_lag')) + '</b><span class="gx-dim">' + esc(t('arb_none_lag_sub')) + '</span></div>';
      body += '</div>';
    } else {
      // ejecutables (surebets) primero; teóricos (margen fino / profundidad PM no verificada) en grupo aparte.
      var idx = arbs.map(function (a, i) { return { a: a, i: i }; });
      var exe = idx.filter(function (x) { return x.a.executable; }), theo = idx.filter(function (x) { return !x.a.executable; });
      body = '<div class="gx-arb-sec"><div class="gx-arb-sec-h"><span class="gx-dim">' + esc(t('arb_fam_pure_sub')) + '</span></div>';
      if (exe.length) body += '<div class="gx-arb-warn">' + ic('alert-triangle') + esc(t('arb_gubbing')) + '</div>' + '<div class="gx-picks-feed">' + exe.map(function (x) { return arbCard(x.a, x.i); }).join('') + '</div>';
      else body += '<div class="gx-empty gx-arb-obs">' + illo("radar") + '<b>' + esc(t('arb_none_pure')) + '</b><span class="gx-dim">' + esc(t('arb_none_pure_sub', { n: C.markets_scanned || 0 })) + '</span></div>';
      if (theo.length) body += '<div class="gx-arb-theo-h">' + ic('info-circle') + esc(t('arb_theo_group', { n: theo.length })) + '</div><div class="gx-picks-feed">' + theo.map(function (x) { return arbCard(x.a, x.i); }).join('') + '</div>';
      body += '</div>';
    }
    bd.innerHTML = head + arbSubTabs(C) + body + '<div class="gx-pick-disc">' + esc(t('arb_disclaimer')) + '</div>';
    // wiring: sub-tabs + apertura de la card de detalle
    [].forEach.call(bd.querySelectorAll('[data-arbsub]'), function (el) {
      el.addEventListener('click', function () { S.arbSub = el.getAttribute('data-arbsub'); S._arbSubUser = true; oppArbBoard(bd); });
    });
    [].forEach.call(bd.querySelectorAll('[data-arbref]'), function (el) {
      el.addEventListener('click', function () { openArbDetail(el.getAttribute('data-arbref')); });
    });
    animNums(bd);
  }
  // Abre la oportunidad como una card GP Intelligence del partido, con un panel "Oportunidad" arriba (link a la
  // casa/exchange/mercado + explicación + trade-out). Reusa la vista de partido (teams-) que ya trae el análisis.
  function openArbDetail(ref) {
    var parts = (ref || '').split(':'), fam = parts[0], i = +parts[1];
    var d = S.arb || {}; var opp = fam === 'arb' ? (d.arbitrage || [])[i] : (d.price_lag || [])[i];
    if (!opp) return;
    // Campeón (outright): no es un partido → abre la página del equipo (con su análisis de campeonato).
    if (opp.market_family === 'champion') { S.arbCtx = null; openTeam(opp.home_team_id); return; }
    // SOLO navegamos con team ids resueltos (teams-X-Y abre GP Intelligence). El event_id del proveedor NO es un
    // id de análisis — navegar con él daba "no se pudo cargar el análisis". Sin ids: la card no navega.
    var openId = (opp.home_team_id && opp.away_team_id) ? 'teams-' + opp.home_team_id + '-' + opp.away_team_id : null;
    if (!openId) return;
    opp._openId = openId; S.arbCtx = opp;
    openMatch(openId);
  }

  // ============================ CALCULADORA DE STAKE (solo /x) ============================
  // Prellenada con la probabilidad GP (picks/value) o el consenso sin margen del mercado (precio atrasado) —
  // ese prellenado ES el diferenciador. Kelly fraccionado (default 1/4) con tope duro del 5% del bankroll.
  // Arbitraje: reparte un monto total entre las patas → montos por casa + ganancia garantizada. Bankroll y
  // moneda viven SOLO en localStorage (privado, sin servidor, sin tocar la cuenta). NUNCA en la principal.
  var CALC_CCYS = [['USD', '$'], ['EUR', '€'], ['GBP', '£'], ['COP', '$'], ['MXN', '$'], ['ARS', '$'], ['CLP', '$'], ['PEN', 'S/'], ['BRL', 'R$'], ['NGN', '₦'], ['GHS', 'GH₵'], ['KES', 'KSh'], ['ZAR', 'R'], ['XOF', 'CFA']];
  var CALC_KELLY_CAP = 0.05; // tope duro: nunca sugerir más del 5% del bankroll
  var CALC_FLAT_BASE = 0.08; // stake plano (sin edge): base × fracción → ½=4% ¼=2% ⅛=1%, capado al 5%
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch (e) {} }
  function calcCcy() { var c = lsGet('gp_calc_ccy'); for (var i = 0; i < CALC_CCYS.length; i++) if (CALC_CCYS[i][0] === c) return c; return 'USD'; }
  function calcSym(code) { code = code || calcCcy(); for (var i = 0; i < CALC_CCYS.length; i++) if (CALC_CCYS[i][0] === code) return CALC_CCYS[i][1]; return '$'; }
  function calcBankroll() { var v = parseFloat(lsGet('gp_calc_bankroll')); return isFinite(v) && v > 0 ? v : 0; }
  function calcFraction() { var v = parseFloat(lsGet('gp_calc_fraction')); return (isFinite(v) && v > 0 && v <= 1) ? v : 0.25; }
  function fmtMoney(v, code) { var sym = calcSym(code); if (!isFinite(v)) v = 0; var neg = v < 0; v = Math.abs(v); var s = v >= 1000 ? v.toFixed(0) : (Math.round(v * 100) / 100).toFixed(2); s = s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); return (neg ? '−' : '') + sym + s; }
  var FRACS = [['0.5', '½'], ['0.25', '¼'], ['0.125', '⅛']];
  // Kelly fraccionado con tope. p en (0,1), odds decimales. Devuelve el desglose completo.
  function calcKelly(p, odds, bankroll, fraction) {
    var b = odds - 1, r = { p: p, odds: odds, hasEdge: false, kellyFull: 0, fracPct: 0, pct: 0, capped: false, stake: 0, ev: 0, be: (odds > 0 ? 1 / odds : 0), edge: null, flatPct: 0, flatStake: 0, flatReturn: 0 };
    // Stake plano SIEMPRE disponible (gestión de bankroll cuando no hay edge — el Mundial es eficiente por diseño).
    r.flatPct = Math.min(CALC_FLAT_BASE * fraction, CALC_KELLY_CAP);
    r.flatStake = bankroll > 0 ? bankroll * r.flatPct : 0;
    r.flatReturn = r.flatStake * (odds > 1 ? odds - 1 : 0);
    if (!(p > 0 && p < 1) || !(odds > 1)) return r;
    r.edge = p - 1 / odds;
    var f = (b * p - (1 - p)) / b; r.kellyFull = f;
    if (f <= 0) return r;
    r.hasEdge = true;
    var frac = f * fraction; r.fracPct = frac;
    var pct = Math.min(frac, CALC_KELLY_CAP); r.capped = pct < frac - 1e-9; r.pct = pct;
    r.stake = bankroll > 0 ? bankroll * pct : 0;
    r.ev = r.stake * (p * b - (1 - p));
    return r;
  }
  // Reparte 'total' entre patas de cuotas 'odds' para igualar el retorno pase lo que pase.
  function calcArbSplit(odds, total) {
    var inv = odds.map(function (o) { return o > 1 ? 1 / o : 0; });
    var sum = inv.reduce(function (a, x) { return a + x; }, 0);
    var ok = sum > 0;
    var stakes = inv.map(function (x) { return ok ? total * x / sum : 0; });
    var payout = ok ? total / sum : 0;
    return { stakes: stakes, payout: payout, guaranteed: payout - total, roi: total > 0 ? (payout - total) / total : 0, sumInv: sum, valid: ok && sum < 1 };
  }

  // ---- botones que se inyectan en las cards ----
  function stakeCalcBtn(p, odds, sel, src) {
    if (!(p > 0 && p < 1) || !(odds > 1)) return '';
    return '<button class="gx-calc-btn" data-calc="stake" data-p="' + p.toFixed(4) + '" data-odds="' + Number(odds).toFixed(2) + '" data-sel="' + esc(sel || '') + '" data-src="' + (src || 'gp') + '">' + ic('calculator') + '<span>' + esc(t('calc_open')) + '</span></button>';
  }
  function arbCalcBtn(a) {
    var legs = a.legs || []; if (legs.length < 2) return '';
    var odds = legs.map(function (l) { return Number(l.odds).toFixed(2); }).join(',');
    var sels = legs.map(function (l) { return arbSel(a, l.outcome); }).join('|');
    var books = legs.map(function (l) { return prettyBook(l.venue_label || l.venue); }).join('|');
    return '<button class="gx-calc-btn" data-calc="arb" data-odds="' + esc(odds) + '" data-sels="' + esc(sels) + '" data-books="' + esc(books) + '">' + ic('calculator') + '<span>' + esc(t('calc_open_arb')) + '</span></button>';
  }

  // ---- toggle inline (append en cards / colspan-row en tablas) ----
  function toggleCalc(btn) {
    var mode = btn.getAttribute('data-calc');
    var tr = btn.closest('tr');
    if (tr && tr.parentNode) {
      var nx = tr.nextElementSibling;
      if (nx && nx.classList.contains('gx-calc-trow')) { nx.parentNode.removeChild(nx); btn.classList.remove('on'); return; }
      var ncols = tr.children.length, row = document.createElement('tr'); row.className = 'gx-calc-trow';
      var td = document.createElement('td'); td.colSpan = ncols; td.appendChild(buildCalcPanel(btn, mode)); row.appendChild(td);
      tr.parentNode.insertBefore(row, tr.nextSibling); btn.classList.add('on'); return;
    }
    var card = btn.closest('.gx-pick-card, .gx-arb-card, .gx-lag-card, .gx-mcard');
    if (!card) return;
    var ex = card.querySelector(':scope > .gx-calc-holder');
    if (ex) { card.removeChild(ex); btn.classList.remove('on'); return; }
    card.appendChild(buildCalcPanel(btn, mode)); btn.classList.add('on');
  }
  function buildCalcPanel(btn, mode) {
    var holder = document.createElement('div'); holder.className = 'gx-calc-holder';
    if (mode === 'arb') {
      var odds = (btn.getAttribute('data-odds') || '').split(',').map(parseFloat).filter(function (x) { return isFinite(x); });
      var sels = (btn.getAttribute('data-sels') || '').split('|'); var books = (btn.getAttribute('data-books') || '').split('|');
      holder.innerHTML = arbPanelHtml(odds, sels, books, '', false);
      wireArbPanel(holder);
    } else {
      var p = parseFloat(btn.getAttribute('data-p')), o = parseFloat(btn.getAttribute('data-odds'));
      var sel = btn.getAttribute('data-sel') || '', src = btn.getAttribute('data-src') || 'gp';
      holder.innerHTML = stakePanelHtml(p, o, sel, src, '');
      wireStakePanel(holder);
    }
    return holder;
  }

  // ---- panel HTML: apuesta simple (Kelly) ----
  function ccyOptions(sel) { return CALC_CCYS.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === sel ? ' selected' : '') + '>' + c[0] + '</option>'; }).join(''); }
  function fracChips(active) { return FRACS.map(function (f) { return '<button type="button" class="gx-calc-frac' + (Math.abs(parseFloat(f[0]) - active) < 1e-6 ? ' on' : '') + '" data-frac="' + f[0] + '">' + f[1] + '</button>'; }).join(''); }
  function stakePanelHtml(p, odds, sel, src, klass) {
    var ccy = calcCcy(), br = calcBankroll(), fr = calcFraction();
    var prefill = src === 'cons' ? t('calc_prefill_cons') : t('calc_prefill_gp');
    return '<div class="gx-calc' + (klass ? ' ' + klass : '') + '" data-cmode="stake">' +
      (sel ? '<div class="gx-calc-sel">' + ic('target-arrow') + '<b>' + esc(sel) + '</b></div>' : '') +
      '<div class="gx-calc-grid">' +
        '<label class="gx-calc-f gx-calc-f-br"><span>' + esc(t('calc_bankroll')) + '</span><div class="gx-calc-money"><span class="gx-calc-cur">' + esc(calcSym(ccy)) + '</span><input class="gx-calc-in" data-k="bankroll" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="' + (br > 0 ? br : '') + '"><select class="gx-calc-ccy" data-k="ccy">' + ccyOptions(ccy) + '</select></div></label>' +
        '<label class="gx-calc-f"><span>' + esc(src === 'cons' ? t('calc_prob_cons') : t('calc_prob_gp')) + '</span><div class="gx-calc-unit"><input class="gx-calc-in" data-k="prob" type="number" inputmode="decimal" min="0.1" max="99.9" step="0.1" value="' + (p * 100).toFixed(1) + '"><i>%</i></div></label>' +
        '<label class="gx-calc-f"><span>' + esc(t('calc_odds')) + '</span><input class="gx-calc-in" data-k="odds" type="number" inputmode="decimal" min="1.01" step="0.01" value="' + Number(odds).toFixed(2) + '"></label>' +
      '</div>' +
      '<div class="gx-calc-fracrow"><span class="gx-calc-lbl" data-fraclbl>' + esc(t('calc_fraction')) + '</span><div class="gx-calc-fracs">' + fracChips(fr) + '</div></div>' +
      '<div class="gx-calc-out" data-out></div>' +
      '<div class="gx-calc-prefill">' + ic('sparkles') + esc(prefill) + '</div>' +
      '<div class="gx-calc-disc">' + esc(t('calc_disc')) + '</div>' +
    '</div>';
  }
  function stakeStat(label, val, cls) { return '<div class="gx-calc-stat"><span>' + esc(label) + '</span><b class="' + (cls || '') + ' gx-mono">' + val + '</b></div>'; }
  function stakeOutHtml(res, ccy) {
    var br = calcBankroll();
    if (res.hasEdge) {
      // MODO VALOR — Kelly fraccionado (hay ventaja real vs la cuota)
      var main = br > 0 ? fmtMoney(res.stake, ccy) : '—';
      return '<div class="gx-calc-result">' +
        '<div class="gx-calc-big"><div class="gx-calc-biglbl">' + esc(t('calc_suggested')) + ' <span class="gx-calc-vtag">' + esc(t('calc_value_tag')) + '</span></div><div class="gx-calc-bigval gx-mono">' + main + '</div>' +
          '<div class="gx-calc-bigsub">' + (br > 0 ? (res.pct * 100).toFixed(1) + '% ' + esc(t('calc_of_bankroll')) : esc(t('calc_set_bankroll'))) + '</div></div>' +
        '<div class="gx-calc-stats">' +
          stakeStat(t('calc_edge'), '+' + (res.edge * 100).toFixed(1) + ' pp', 'gx-pos') +
          (br > 0 ? stakeStat(t('calc_ev'), fmtMoney(res.ev, ccy), 'gx-pos') : '') +
          stakeStat(t('calc_be'), (res.be * 100).toFixed(1) + '%', '') +
        '</div>' +
        (res.capped ? '<div class="gx-calc-cap">' + ic('shield-check') + esc(t('calc_capped', { pct: (CALC_KELLY_CAP * 100) + '%' })) + '</div>' : '') +
      '</div>';
    }
    // MODO PLANO — sin ventaja de valor: igual sugiere un monto (gestión de bankroll), con advertencia honesta.
    var main2 = br > 0 ? fmtMoney(res.flatStake, ccy) : '—';
    return '<div class="gx-calc-result">' +
      '<div class="gx-calc-flatwarn">' + ic('info-circle') + '<span>' + esc(t('calc_flat_warn')) + '</span></div>' +
      '<div class="gx-calc-big gx-calc-big-flat"><div class="gx-calc-biglbl">' + esc(t('calc_suggested')) + ' <span class="gx-calc-ftag">' + esc(t('calc_flat_tag')) + '</span></div><div class="gx-calc-bigval gx-mono">' + main2 + '</div>' +
        '<div class="gx-calc-bigsub">' + (br > 0 ? (res.flatPct * 100).toFixed(1) + '% ' + esc(t('calc_of_bankroll')) : esc(t('calc_set_bankroll'))) + '</div></div>' +
      '<div class="gx-calc-stats">' +
        (br > 0 ? stakeStat(t('calc_return_win'), '+' + fmtMoney(res.flatReturn, ccy), 'gx-pos') : '') +
        (res.p > 0 ? stakeStat(t('calc_prob_gp'), (res.p * 100).toFixed(1) + '%', '') : '') +
        (res.be > 0 ? stakeStat(t('calc_be'), (res.be * 100).toFixed(1) + '%', '') : '') +
      '</div>' +
    '</div>';
  }
  function recomputeStake(root) {
    var g = function (k) { return root.querySelector('.gx-calc-in[data-k="' + k + '"], .gx-calc-ccy[data-k="' + k + '"]'); };
    var brEl = g('bankroll'), prEl = g('prob'), odEl = g('odds'), ccyEl = g('ccy');
    var ccy = ccyEl ? ccyEl.value : calcCcy();
    if (brEl) { var brv = parseFloat(brEl.value); lsSet('gp_calc_bankroll', isFinite(brv) && brv > 0 ? brv : null); }
    lsSet('gp_calc_ccy', ccy);
    var curEl = root.querySelector('.gx-calc-cur'); if (curEl) curEl.textContent = calcSym(ccy);
    var p = parseFloat(prEl && prEl.value) / 100, odds = parseFloat(odEl && odEl.value), fr = calcFraction();
    var res = calcKelly(p, odds, calcBankroll(), fr);
    var out = root.querySelector('[data-out]'); if (out) out.innerHTML = stakeOutHtml(res, ccy);
    var lbl = root.querySelector('[data-fraclbl]'); if (lbl) lbl.textContent = t(res.hasEdge ? 'calc_fraction' : 'calc_level');
  }
  function wireStakePanel(root) {
    [].forEach.call(root.querySelectorAll('.gx-calc-in, .gx-calc-ccy'), function (el) {
      el.addEventListener('input', function () { recomputeStake(root); });
      el.addEventListener('change', function () { recomputeStake(root); });
      el.addEventListener('click', function (e) { e.stopPropagation(); });
    });
    [].forEach.call(root.querySelectorAll('.gx-calc-frac'), function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); lsSet('gp_calc_fraction', b.getAttribute('data-frac')); [].forEach.call(root.querySelectorAll('.gx-calc-frac'), function (x) { x.classList.remove('on'); }); b.classList.add('on'); recomputeStake(root); });
    });
    root.addEventListener('click', function (e) { e.stopPropagation(); });
    recomputeStake(root);
  }

  // ---- panel HTML: arbitraje (reparto). editable=true → cuotas editables + agregar/quitar patas (standalone). ----
  function arbLegHtml(i, o, sel, book, editable, removable) {
    var oddsCell = editable
      ? '<div class="gx-calc-unit gx-calc-oddsin"><i>@</i><input class="gx-calc-in gx-calc-legodds" data-legodds type="number" inputmode="decimal" min="1.01" step="0.01" value="' + (isFinite(o) ? Number(o).toFixed(2) : '') + '"></div>'
      : '<span class="gx-calc-leg-odds gx-mono">@ ' + Number(o).toFixed(2) + '</span>';
    return '<div class="gx-calc-leg" data-leg="' + i + '" data-odds="' + (isFinite(o) ? Number(o).toFixed(2) : '') + '"><div class="gx-calc-leg-h"><span class="gx-calc-leg-sel">' + esc(sel || (t('calc_leg') + ' ' + (i + 1))) + '</span>' +
      (book ? '<span class="gx-calc-leg-book">' + esc(book) + '</span>' : '') +
      (editable && removable ? '<button type="button" class="gx-calc-legx" data-legrm title="' + esc(t('calc_remove')) + '">' + ic('x') + '</button>' : '') + '</div>' +
      '<div class="gx-calc-leg-b">' + oddsCell + '<span class="gx-calc-leg-stake gx-mono" data-legstake></span></div></div>';
  }
  function arbPanelHtml(odds, sels, books, klass, editable) {
    var ccy = calcCcy();
    var last = parseFloat(lsGet('gp_calc_arb_total')); var total = (isFinite(last) && last > 0) ? last : 100;
    var legs = odds.map(function (o, i) { return arbLegHtml(i, o, sels[i], books && books[i], editable, editable && odds.length > 2); }).join('');
    return '<div class="gx-calc' + (klass ? ' ' + klass : '') + '" data-cmode="arb"' + (editable ? ' data-editable="1"' : '') + '>' +
      '<label class="gx-calc-f gx-calc-f-br"><span>' + esc(t('calc_total')) + '</span><div class="gx-calc-money"><span class="gx-calc-cur">' + esc(calcSym(ccy)) + '</span><input class="gx-calc-in" data-k="total" type="number" inputmode="decimal" min="0" step="any" value="' + total + '"><select class="gx-calc-ccy" data-k="ccy">' + ccyOptions(ccy) + '</select></div></label>' +
      '<div class="gx-calc-legs">' + legs + '</div>' +
      (editable ? '<button type="button" class="gx-calc-addleg" data-legadd>' + ic('plus') + esc(t('calc_add_leg')) + '</button>' : '') +
      '<div class="gx-calc-out" data-out></div>' +
      '<div class="gx-calc-disc">' + esc(t('calc_disc')) + '</div>' +
    '</div>';
  }
  function arbReadOdds(root) {
    return [].map.call(root.querySelectorAll('.gx-calc-leg'), function (leg) {
      var inp = leg.querySelector('[data-legodds]');
      return parseFloat(inp ? inp.value : leg.getAttribute('data-odds'));
    });
  }
  function recomputeArb(root) {
    var totEl = root.querySelector('.gx-calc-in[data-k="total"]'), ccyEl = root.querySelector('.gx-calc-ccy[data-k="ccy"]');
    var ccy = ccyEl ? ccyEl.value : calcCcy(); lsSet('gp_calc_ccy', ccy);
    var curEl = root.querySelector('.gx-calc-cur'); if (curEl) curEl.textContent = calcSym(ccy);
    var total = parseFloat(totEl && totEl.value); if (!(total > 0)) total = 0;
    lsSet('gp_calc_arb_total', total > 0 ? total : null);
    var odds = arbReadOdds(root), r = calcArbSplit(odds, total);
    [].forEach.call(root.querySelectorAll('.gx-calc-leg'), function (leg, idx) { var s = leg.querySelector('[data-legstake]'); if (s) s.textContent = total > 0 ? t('calc_put') + ' ' + fmtMoney(r.stakes[idx] || 0, ccy) : ''; });
    var out = root.querySelector('[data-out]');
    if (out) {
      if (!r.valid || r.guaranteed <= 0) out.innerHTML = '<div class="gx-calc-noedge">' + ic('alert-triangle') + '<div><b>' + esc(t('calc_arb_invalid')) + '</b></div></div>';
      else out.innerHTML = '<div class="gx-calc-result"><div class="gx-calc-big gx-calc-big-pos"><div class="gx-calc-biglbl">' + esc(t('calc_guaranteed')) + '</div><div class="gx-calc-bigval gx-mono gx-pos">' + fmtMoney(r.guaranteed, ccy) + '</div><div class="gx-calc-bigsub">+' + (r.roi * 100).toFixed(2) + '% ROI · ' + esc(t('calc_payout')) + ' ' + fmtMoney(r.payout, ccy) + '</div></div></div>';
    }
  }
  function wireArbPanel(root) {
    root.addEventListener('click', function (e) { e.stopPropagation(); });
    var bind = function () {
      [].forEach.call(root.querySelectorAll('.gx-calc-in, .gx-calc-ccy'), function (el) {
        if (el._cb) return; el._cb = 1;
        el.addEventListener('input', function () { recomputeArb(root); });
        el.addEventListener('change', function () { recomputeArb(root); });
      });
    };
    var legsWrap = root.querySelector('.gx-calc-legs');
    var editable = root.getAttribute('data-editable') === '1';
    if (editable) {
      var reindex = function () {
        var n = legsWrap.children.length;
        [].forEach.call(legsWrap.children, function (leg, i) {
          leg.setAttribute('data-leg', i);
          var sel = leg.querySelector('.gx-calc-leg-sel'); if (sel) sel.textContent = t('calc_leg') + ' ' + (i + 1);
          var rm = leg.querySelector('[data-legrm]'); if (n <= 2 && rm) rm.remove();
        });
      };
      var addBtn = root.querySelector('[data-legadd]');
      if (addBtn) addBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (legsWrap.children.length >= 4) return;
        var tmp = document.createElement('div'); tmp.innerHTML = arbLegHtml(legsWrap.children.length, 2.00, '', '', true, true);
        legsWrap.appendChild(tmp.firstChild);
        // asegurar botón de quitar en la 1ª/2ª pata cuando pasamos de 2→3
        [].forEach.call(legsWrap.children, function (leg) { if (!leg.querySelector('[data-legrm]')) { var h = leg.querySelector('.gx-calc-leg-h'); var b = document.createElement('button'); b.type = 'button'; b.className = 'gx-calc-legx'; b.setAttribute('data-legrm', ''); b.innerHTML = ic('x'); h.appendChild(b); } });
        reindex(); bind(); recomputeArb(root);
      });
      legsWrap.addEventListener('click', function (e) {
        var rm = e.target.closest('[data-legrm]'); if (!rm) return;
        e.stopPropagation(); if (legsWrap.children.length <= 2) return;
        rm.closest('.gx-calc-leg').remove(); reindex(); recomputeArb(root);
      });
    }
    bind(); recomputeArb(root);
  }

  // ---- vista STANDALONE (desde "Más") ----
  function renderCalc() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var mode = S.calcMode === 'arb' ? 'arb' : 'simple';
    var tabs = '<div class="gx-calc-modes">' +
      '<button class="gx-calc-mode' + (mode === 'simple' ? ' on' : '') + '" data-cmode-sw="simple">' + ic('target-arrow') + esc(t('calc_mode_simple')) + '</button>' +
      '<button class="gx-calc-mode' + (mode === 'arb' ? ' on' : '') + '" data-cmode-sw="arb">' + ic('arrows-left-right') + esc(t('calc_mode_arb')) + '</button></div>';
    var body;
    if (mode === 'arb') {
      body = '<p class="gx-calc-intro gx-dim">' + esc(t('calc_intro_arb')) + '</p>' + arbPanelHtml([1.90, 2.10], [t('calc_leg') + ' 1', t('calc_leg') + ' 2'], ['', ''], 'gx-calc-standalone', true);
    } else {
      body = '<p class="gx-calc-intro gx-dim">' + esc(t('calc_intro_simple')) + '</p>' + stakePanelHtml(0.55, 2.00, '', 'gp', 'gx-calc-standalone');
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:680px">' + viewHead(t('calc_title')) +
      '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body">' + tabs + body +
      '<p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('calc_kelly_note')) + '</p></div></div></div></div>';
    [].forEach.call(mv.querySelectorAll('[data-cmode-sw]'), function (b) { b.addEventListener('click', function () { S.calcMode = b.getAttribute('data-cmode-sw'); renderCalc(); }); });
    var holder = mv.querySelector('.gx-calc');
    if (holder) { if (mode === 'arb') wireArbPanel(holder); else wireStakePanel(holder); }
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
      '<div class="gx-tabs" style="margin-top:14px"><button class="on" data-openmatch="' + esc(h.event_id) + '" data-cock-sec="resumen">' + esc(t('tab_summary')) + '</button><button data-openmatch="' + esc(h.event_id) + '" data-cock-sec="mercados">' + esc(t('tab_markets')) + '</button><button data-openmatch="' + esc(h.event_id) + '" data-cock-sec="contexto">' + esc(t('tab_context')) + '</button><button data-openmatch="' + esc(h.event_id) + '" data-cock-sec="stats">' + esc(t('tab_stats')) + '</button><button data-openmatch="' + esc(h.event_id) + '" data-cock-sec="stats">' + esc(t('tab_events')) + '</button></div>' +
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

  var FACT = { es: { FORM: 'forma reciente', STREAK: 'racha', SOLIDITY: 'solidez defensiva', SQUAD_QUALITY: 'calidad de plantilla', XG_PROFILE: 'perfil de goles', AVAILABILITY: 'disponibilidad del plantel', REST: 'descanso', GOALKEEPER: 'el arquero', TACTICS: 'la lectura táctica', VENUE: 'el escenario', WEATHER: 'el clima', LINEUP: 'la alineación', HIGH_HUMIDITY: 'humedad alta', HEAT: 'calor', HIGH_HEAT: 'calor extremo', ALTITUDE: 'altitud', COLD: 'frío', RAIN: 'lluvia', WIND: 'viento', TRAVEL: 'viaje', CONGESTION: 'congestión de partidos', MOTIVATION: 'motivación', HOME_ADVANTAGE: 'localía' }, en: { FORM: 'recent form', STREAK: 'streak', SOLIDITY: 'defensive solidity', SQUAD_QUALITY: 'squad quality', XG_PROFILE: 'goal profile', AVAILABILITY: 'squad availability', REST: 'rest', GOALKEEPER: 'the goalkeeper', TACTICS: 'the tactical read', VENUE: 'the venue', WEATHER: 'the weather', LINEUP: 'the lineup', HIGH_HUMIDITY: 'high humidity', HEAT: 'heat', HIGH_HEAT: 'extreme heat', ALTITUDE: 'altitude', COLD: 'cold', RAIN: 'rain', WIND: 'wind', TRAVEL: 'travel', CONGESTION: 'fixture congestion', MOTIVATION: 'motivation', HOME_ADVANTAGE: 'home advantage' } };
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
    var ma = S.mc[r.h.event_id] || r._beta; // match detail (analysis/risks); fallback al beta inyectado (h2h en vivo)
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
    var price = belowMin ? ('<b>' + odd(best.best_odds) + '</b> · ' + esc(t('below_min'))) : (best && best.best_odds ? t('memo_price', { odds: '<b>' + odd(best.minimum_odds || best.best_odds) + '</b>', book: best.best_sportsbook ? " (" + esc(prettyBook(best.best_sportsbook)) + ")" : "" }) : t('memo_price_none'));
    var riskCode = (ma && ma.risks && ma.risks[0]) || (best && best.risk_codes && best.risk_codes[0]);
    var risk = riskCode ? riskText(riskCode) : t('memo_risk_default');
    var inval = t('memo_inval');
    var edge = best ? best.adjusted_edge_pp : null;
    var conf = confInfo(ma && ma.confidence_code);  // A.1: un SOLO valor canónico del DTO controla el badge
    var cta = pubPick ? t('cta_pick') : actionable ? t('cta_value') : best ? t('cta_analysis') : t('cta_analyze');
    return { verdict: verdict, thesis: thesis, price: price, risk: risk, inval: inval, conf: conf, bestOdds: best ? best.best_odds : null, book: best ? prettyBook(best.best_sportsbook) : "", cta: cta, ma: ma };
  }
  // copy de riesgo: enuncia el HECHO; NUNCA afirma un nivel de confianza (eso lo controla SOLO el badge, A.1)
  var RISK = { es: { MODEL_DISAGREEMENT: 'Las estimaciones internas no convergen del todo.', LARGE_MARKET_DISAGREEMENT: 'GP y el mercado difieren mucho: mayor potencial pero también mayor riesgo.', MODEL_UNCERTAINTY: 'La incertidumbre de la estimación es elevada para este partido.', LINEUP_NOT_CONFIRMED: 'Las alineaciones aún no están confirmadas.', CONTEXT_INCOMPLETE: 'El contexto disponible es incompleto para este partido.', EARLY_TRACK_RECORD: 'El registro verificable todavía es corto.', LOWER_QUALITY_TIMESTAMP: 'Los datos tienen menor frescura.' }, en: { MODEL_DISAGREEMENT: 'Internal estimates don’t fully converge.', LARGE_MARKET_DISAGREEMENT: 'GP and the market differ widely: higher upside but also higher risk.', MODEL_UNCERTAINTY: 'Estimate uncertainty is elevated for this match.', LINEUP_NOT_CONFIRMED: 'Lineups are not yet confirmed.', CONTEXT_INCOMPLETE: 'The available context is incomplete for this match.', EARLY_TRACK_RECORD: 'The verifiable track record is still short.', LOWER_QUALITY_TIMESTAMP: 'Data has lower freshness.' } };
  function riskText(c) { return (RISK[LANG] && RISK[LANG][c]) || (RISK.es[c]) || c; }

  // ================= deep match cockpit (Corte 2) =================
  function setHash(h) { try { if ((location.hash || '').replace(/^#/, '') !== h) location.hash = h; } catch (e) {} }
  function onHash() {
    var h = ''; try { h = (location.hash || '').replace(/^#/, ''); } catch (e) {}
    var m = h.match(/^match\/([0-9a-f-]{36}|qa-[a-z0-9-]+|fx-[A-Za-z0-9]+|teams-[A-Za-z0-9]{2,5}-[A-Za-z0-9]{2,5})$/i);
    if (m) { if (!(S.view === 'match' && S.matchId === m[1])) openMatch(m[1], true); return; }
    var tm = h.match(/^team\/([A-Za-z]{2,4})$/i);
    if (tm) { var tid = tm[1].toUpperCase(); if (!(S.view === 'team' && S.teamId === tid)) openTeam(tid, true); return; }
    var v = h.match(/^(matches|teams|sim|groups|bracket|evo|registry|method|admin|follow|alerts|refer|perf|calc)/);
    if (v) { showView(v[1]); return; }
    showView('board');
  }
  var NAV_HASH = { opps: '', matches: 'matches', teams: 'teams', sim: 'sim', groups: 'groups', bracket: 'bracket', evo: 'evo', registry: 'registry', method: 'method', admin: 'admin', follow: 'follow', alerts: 'alerts', refer: 'refer', perf: 'perf', calc: 'calc' };
  function navTo(nav) { setHash(NAV_HASH[nav] != null ? NAV_HASH[nav] : ''); }
  function openTeam(id, fromHash) { if (!id) return; if (!fromHash) { S.returnTo = (S.view === 'teams' ? 'teams' : ''); setHash('team/' + id); } S.view = 'team'; S.teamId = id; S.teamTab = 'resumen'; applyView(); syncNavActive(); try { window.scrollTo(0, 0); } catch (e) {} renderTeam(); }
  function isFollowing(id) { return !!(S.me && S.me.favorites && S.me.favorites.indexOf(id) >= 0); }
  function toggleFollow(id) {
    if (!S.me) return; var favs = S.me.favorites || (S.me.favorites = []);
    fetch('/api/favorite', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify({ teamId: id }) }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (res) {
      if (res && res.favorites) S.me.favorites = res.favorites;
      else { var i = favs.indexOf(id); if (i >= 0) favs.splice(i, 1); else favs.push(id); }
      // repintar la superficie activa
      if (S.view === 'team' && S.teamId === id) renderTeam(); else if (S.view === 'follow') renderFollow();
    });
  }
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
    // Back office solo-admin (/x): registro, metodología, rendimiento, admin. Usuarios beta no acceden ni por hash directo.
    if (['registry', 'method', 'admin'].indexOf(v) >= 0 && S.me && !S.me.isAdmin) { v = 'board'; }
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
    else if (v === 'follow') renderFollow();
    else if (v === 'alerts') renderAlerts();
    else if (v === 'refer') renderRefer();
    else if (v === 'perf') renderPerf();
    else if (v === 'calc') renderCalc();
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
    return { h: beta.header, _beta: beta, confidence_code: beta.confidence_code || null, gp: function (c) { return oc[c] ? oc[c].gp_probability : null; }, mk: function (c) { return oc[c] ? oc[c].market_probability : null; }, best: function (c) { return bySel[c] ? bySel[c].best_odds : null; }, edge: bestEdge, signal: signal, live: beta.header.status_code === 'LIVE', kickoff: beta.header.kickoff_at };
  }
  // ===== Contexto en vivo: convierte /api/h2h/deep en la capa de análisis GP (base→contexto→GP) para CUALQUIER
  // partido, así el contexto aparece en TODOS (no solo los pocos con snapshot canónico). model GP = base + contexto.
  function h2hToAnalysis(h2h) {
    if (!h2h || !h2h.base || !h2h.probs) return null;
    var base = { HOME: round4(h2h.base.aWin), DRAW: round4(h2h.base.draw), AWAY: round4(h2h.base.bWin) };
    var fin = { HOME: round4(h2h.probs.aWin), DRAW: round4(h2h.probs.draw), AWAY: round4(h2h.probs.bWin) };
    var adj = { HOME: round4(fin.HOME - base.HOME), DRAW: round4(fin.DRAW - base.DRAW), AWAY: round4(fin.AWAY - base.AWAY) };
    var moved = (Math.abs(adj.HOME) + Math.abs(adj.DRAW) + Math.abs(adj.AWAY)) >= 0.004;
    var c = h2h.context || {}, hasData = !!c.hasData;
    var aId = h2h.a && h2h.a.id, bId = h2h.b && h2h.b.id;
    var fac = (h2h.analysis && h2h.analysis.factors) || [];
    var evaluated = fac.map(function (f) {
      return { factor_code: f.factorCode, category_code: f.category || 'team', evidence_class: f.fact_or_inference === 'fact' ? 'FACT' : 'INFERENCE', confidence: f.confidence != null ? f.confidence : null, timestamp_quality_code: null, subject_team_id: f.side === 'a' ? aId : f.side === 'b' ? bId : null, direction_code: (f.dir === 'up' ? 'UP' : f.dir === 'down' ? 'DOWN' : 'FLAT'), included: !!f.included, detail: f.detail || null };
    });
    var dqA = c.dataQualityA || {}, dqB = c.dataQualityB || {};
    var compl = round4(((Number(dqA.score) || 0) + (Number(dqB.score) || 0)) / 2);
    return { context_state_code: !hasData ? 'BASE_ONLY' : moved ? 'FULL_CONTEXT' : 'PARTIAL_CONTEXT', base_vector: base, final_vector: fin, context_adjustments: adj, context_moved_line: moved, applied_factors: [], evaluated_factors: evaluated, factor_count: fac.length, source_count: hasData ? 2 : 0, data_freshness_code: 'FRESH', context_completeness: compl };
  }
  function h2hProbability(h2h) {
    var p = h2h.probs || {};
    return { market_code: '1X2', period_code: 'REGULATION', period_note_code: 'REGULATION_90', outcomes: [
      { outcome_code: 'HOME', team_ref: 'home', gp_probability: round4(p.aWin), market_probability: null },
      { outcome_code: 'DRAW', team_ref: null, gp_probability: round4(p.draw), market_probability: null },
      { outcome_code: 'AWAY', team_ref: 'away', gp_probability: round4(p.bWin), market_probability: null }], sums_to_one: true };
  }
  function h2hConfidence(h2h) { var lv = h2h && h2h.analysis && h2h.analysis.headline && h2h.analysis.headline.modelConfidence && h2h.analysis.headline.modelConfidence.level; return lv === 'Alta' ? 'HIGH' : lv === 'Baja' ? 'LOW' : lv === 'Media' ? 'MEDIUM' : null; }
  function round4(x) { return (x == null || !isFinite(x)) ? null : Math.round(x * 1e4) / 1e4; }
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

  // Homepages de casas/exchanges para el botón "abrir" de la card de oportunidad (mejor-esfuerzo; the_odds_api no
  // da deep-link por apuesta). Si no está en el mapa, no ponemos link (solo el nombre).
  var BOOK_URLS = {
    bet365: 'https://www.bet365.com', williamhill: 'https://www.williamhill.com', williamhill_us: 'https://www.williamhill.com',
    betway: 'https://www.betway.com', betvictor: 'https://www.betvictor.com', betfred_uk: 'https://www.betfred.com',
    boylesports: 'https://www.boylesports.com', unibet: 'https://www.unibet.com', unibet_fr: 'https://www.unibet.fr', unibet_nl: 'https://www.unibet.nl', unibet_se: 'https://www.unibet.se', unibet_eu: 'https://www.unibet.com', unibet_uk: 'https://www.unibet.co.uk',
    betsson: 'https://www.betsson.com', nordicbet: 'https://www.nordicbet.com', betclic_fr: 'https://www.betclic.fr', betanysports: 'https://www.betanysports.eu',
    betonlineag: 'https://www.betonline.ag', pinnacle: 'https://www.pinnacle.com', draftkings: 'https://sportsbook.draftkings.com', fanduel: 'https://sportsbook.fanduel.com',
    betmgm: 'https://sports.betmgm.com', caesars: 'https://www.caesars.com/sportsbook', betrivers: 'https://www.betrivers.com', espnbet: 'https://espnbet.com', fanatics: 'https://sportsbook.fanatics.com',
    ladbrokes: 'https://sports.ladbrokes.com', coral: 'https://sports.coral.co.uk', paddypower: 'https://www.paddypower.com', skybet: 'https://www.skybet.com', sport888: 'https://www.888sport.com', '888sport': 'https://www.888sport.com',
    sportsbet: 'https://www.sportsbet.com.au', tab: 'https://www.tab.com.au', neds: 'https://www.neds.com.au', pointsbetau: 'https://pointsbet.com.au', ladbrokes_au: 'https://www.ladbrokes.com.au',
    betfair_ex_eu: 'https://www.betfair.com/exchange', betfair_ex_uk: 'https://www.betfair.com/exchange', smarkets: 'https://smarkets.com', matchbook: 'https://www.matchbook.com',
    winamax_de: 'https://www.winamax.de', winamax_fr: 'https://www.winamax.fr', tipico_de: 'https://www.tipico.de', leovegas_se: 'https://www.leovegas.com', casumo: 'https://www.casumo.com',
    onexbet: 'https://1xbet.com', coolbet: 'https://www.coolbet.com', grosvenor: 'https://www.grosvenorcasinos.com', pmu_fr: 'https://www.pmu.fr', unibet_se2: 'https://www.unibet.se',
    polymarket: 'https://polymarket.com', kalshi: 'https://kalshi.com', novig: 'https://novig.us', prophetx: 'https://prophetbettingexchange.com', myriad: 'https://myriad.markets'
  };
  function bookUrl(code) { return BOOK_URLS[code] || BOOK_URLS[String(code || '').replace(/_(se|nl|fr|de|uk|us|eu|au|at|es|it)$/i, '')] || null; }
  function venueBtn(code, label) { var u = bookUrl(code); if (!u) return '<span class="gx-ov-venuex">' + esc(label || code) + '</span>'; return '<a class="gx-ov-venue" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + ic('external-link') + esc(label || code) + '</a>'; }
  // Panel "Oportunidad" de la card GP Intelligence: (1) link a la casa/exchange/mercado, (2) [el análisis del
  // partido va debajo, reusado], (3) explicación de la oportunidad + trade-out (clave: value en contra del favorito).
  function mvOpportunity(opp, header) {
    if (!opp) return '';
    var isArb = opp.family === 'PURE_ARB';
    var famLabel = isArb ? t('arb_fam_pure') : t('arb_fam_lag');
    var famCls = isArb ? 'gx-fam-pure' : 'gx-fam-lag';
    // (1) venues + (parte central) el resumen de la jugada
    var play, venues, explain;
    if (isArb) {
      var roi = (opp.net_roi * 100);
      play = '<div class="gx-ov-legs">' + (opp.legs || []).map(function (l) {
        return '<div class="gx-ov-leg"><span class="gx-ov-leg-sel">' + esc(arbSel(opp, l.outcome)) + '</span>' +
          '<span class="gx-ov-leg-odds gx-mono">' + Number(l.odds).toFixed(2) + '</span>' + venueBtn(l.venue, prettyBook(l.venue_label || l.venue)) +
          '<span class="gx-ov-leg-stake">' + esc(t('arb_stake')) + ' ' + Math.round(l.stake_pct) + '%</span></div>';
      }).join('') + '</div>' +
        '<div class="gx-ov-roi ' + (opp.executable ? 'gx-pos' : 'gx-dim') + '">' + ic('shield-check') + esc(opp.executable ? t('arb_roi') : t('arb_roi_theo')) + ': <b>+' + roi.toFixed(2) + '%</b></div>';
      venues = '';
      if (opp.executable) {
        explain = '<p>' + esc(t('arb_x_pure_1', { roi: '+' + roi.toFixed(2) + '%' })) + '</p>' + '<p>' + esc(t('arb_x_pure_2')) + '</p>';
      } else {
        explain = '<div class="gx-ov-warn">' + ic('alert-triangle') + esc(opp.unverified_depth ? t('arb_x_pure_theo_pm') : t('arb_x_pure_theo')) + '</div>';
      }
      explain += '<div class="gx-ov-warn">' + ic('alert-triangle') + esc(t('arb_gubbing')) + '</div>';
    } else {
      var edge = (opp.edge * 100), favPct = opp.favorite_prob != null ? Math.round(opp.favorite_prob * 100) : null;
      var favName = opp.favorite_outcome ? arbSel(opp, opp.favorite_outcome) : null;
      var kind = opp.venue_kind === 'pm' ? 'pm' : (opp.is_exchange ? 'exchange' : 'sportsbook');
      play = '<div class="gx-ov-lag"><div class="gx-ov-lag-main"><span class="gx-ov-lag-sel">' + esc(arbSel(opp, opp.outcome)) + '</span>' +
        '<span class="gx-ov-lag-odds gx-mono">' + Number(opp.odds).toFixed(2) + '</span></div>' +
        '<div class="gx-ov-lag-sub gx-dim">' + esc(t('arb_value')) + ' <b class="gx-pos">+' + edge.toFixed(1) + '%</b> · ' + esc(t('arb_fair')) + ' ' + Number(opp.fair_odds).toFixed(2) + ' · ' + esc(t('arb_consensus', { n: opp.consensus_groups })) + '</div></div>';
      venues = '<div class="gx-ov-venues">' + venueBtn(opp.venue, prettyBook(opp.venue_label || opp.venue)) + '</div>';
      explain = '<p>' + esc(t('arb_x_lag_1', { book: prettyBook(opp.venue_label || opp.venue), sel: arbSel(opp, opp.outcome), odds: Number(opp.odds).toFixed(2), n: opp.consensus_groups, fair: Number(opp.fair_odds).toFixed(2), edge: '+' + edge.toFixed(1) + '%' })) + '</p>';
      if (!opp.is_favorite && favName != null) explain += '<div class="gx-ov-warn gx-ov-warn-under">' + ic('alert-triangle') + esc(t('arb_x_lag_against', { sel: arbSel(opp, opp.outcome), fav: favName, favpct: favPct != null ? favPct + '%' : '—' })) + '</div>';
      explain += '<p class="gx-ov-trade"><b>' + esc(t('arb_x_trade_title')) + '</b> ' + esc(kind === 'sportsbook' ? t('arb_x_trade_soft') : t('arb_x_trade_exch')) + '</p>';
      explain += '<div class="gx-ov-warn">' + ic('alert-triangle') + esc(t('arb_gubbing')) + '</div>';
    }
    return '<div class="gx-sec" id="sec-oportunidad"><div class="gx-panel gx-ov">' +
      '<div class="gx-ov-head"><span class="gx-pick-fam ' + famCls + '">' + ic(isArb ? 'arrows-left-right' : 'trending-up') + esc(famLabel) + '</span>' +
      '<span class="gx-dim" style="font-size:11px">' + esc(t('arb_detected')) + ' · ' + esc(arbAgo(opp.freshness_s)) + '</span></div>' +
      '<div class="gx-ov-body"><div class="gx-ov-play">' + play + venues + '</div>' +
      '<div class="gx-ov-explain">' + explain + '</div></div>' +
      '</div></div>';
  }

  function renderMatch() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var eid = S.matchId;
    // A.8 QA: escenarios determinísticos SOLO en preview interno (premium-qa.js se carga únicamente con el
    // flag QA on en el server; en prod no existe → window.__GP_QA es undefined). NUNCA mezcla DB real.
    var qa = (/^qa-/.test(eid) && window.__GP_QA) ? window.__GP_QA.get(eid, LANG) : null;
    if (qa) S.mc[eid] = qa.beta;   // QA: el memo/dataTrust leen S.mc; sembrarlo para que el análisis sea consistente
    var fixtureOnly = /^fx-/.test(eid);   // 4C#8: partido sin evaluación canónica → cockpit desde /api/match
    var teamsOnly = /^teams-/.test(eid);  // Picks de eventos sintéticos → GP Intelligence del partido por team-ids (h2h deep)
    var fx, beta, gpAbsent = false;
    if (teamsOnly) {
      var tp = eid.slice(6).split('-'), thid = tp[0], taid = tp[1];
      if (!thid || !taid) { mv.innerHTML = mvShell('<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('match_404')) + '</b></div></div>'); bindBack(); return; }
      // Header mínimo: el motor de contexto (h2h deep, más abajo) rellena base→contexto→GP + proyección de goles.
      beta = { header: { event_id: eid, home: { team_id: thid }, away: { team_id: taid }, competition_code: 'FIFA_WORLD_CUP_2026', stage_code: null, kickoff_at: null, status_code: 'SCHEDULED' }, probability: { outcomes: [] }, analysis: { context_state_code: 'BASE_ONLY' }, risks: [], confidence_code: null, has_official_v2: false, goal_insights: null };
      gpAbsent = true;
      // Cargar el FIXTURE por par de equipos → marcador en vivo, alineaciones, eventos y stats (si el partido existe/está en juego).
      var tfid = fixtureIdFor(beta.header);
      if (tfid != null) {
        if (S.mfix[tfid] === undefined) {
          S.mfix[tfid] = null;
          fetch('/api/match/' + encodeURIComponent(tfid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.mfix[tfid] = m || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
        }
        fx = (S.mfix[tfid] && !S.mfix[tfid]._empty) ? S.mfix[tfid] : null;
      }
    } else if (fixtureOnly) {
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
    // Contexto en vivo para CUALQUIER partido: si beta no trae la capa de contexto (snapshot canónico), la
    // derivamos de /api/h2h/deep (mismo motor) → GP+contexto en TODOS los partidos, sin "no disponible".
    var hid = header.home && header.home.team_id, aid = header.away && header.away.team_id, hk = hid + '_' + aid;
    if (hid && aid && S.h2h[hk] === undefined) {
      S.h2h[hk] = null;
      fetch('/api/h2h/deep?a=' + encodeURIComponent(hid) + '&b=' + encodeURIComponent(aid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.h2h[hk] = m || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
    }
    var h2h = (hid && aid && S.h2h[hk] && !S.h2h[hk]._empty) ? S.h2h[hk] : null;
    if (h2h) {
      if (!beta.analysis || !beta.analysis.base_vector) { var ana = h2hToAnalysis(h2h); if (ana) beta.analysis = ana; }
      if (beta.confidence_code == null) beta.confidence_code = h2hConfidence(h2h);
      if (!beta.probability || !beta.probability.outcomes || !beta.probability.outcomes.length || beta.probability.outcomes[0].gp_probability == null) beta.probability = h2hProbability(h2h);
      if (!beta.goal_insights && h2h.goal_insights) beta.goal_insights = h2h.goal_insights; // proyección de goles en TODOS los partidos
      gpAbsent = false; // ya tenemos GP+contexto en vivo → mostramos el análisis completo
    }
    // GP Intelligence EN VIVO: si el partido está en juego y el server recalculó la prob GP (marcador+minuto+
    // eventos), sobreescribimos el headline para que NO quede estática al pitazo. La base→contexto sigue pre-partido.
    if (fx && fx.status === 'live' && fx.gpLive && fx.gpLive.homeWin != null) {
      var gl = fx.gpLive;
      var mkmap = {}; ((beta.probability && beta.probability.outcomes) || []).forEach(function (o) { mkmap[o.outcome_code] = o.market_probability; });
      beta.probability = { market_code: '1X2', period_code: 'REGULATION', period_note_code: 'REGULATION_90', sums_to_one: true, live: true, outcomes: [
        { outcome_code: 'HOME', team_ref: 'home', gp_probability: round4(gl.homeWin), market_probability: mkmap.HOME != null ? mkmap.HOME : null },
        { outcome_code: 'DRAW', team_ref: null, gp_probability: round4(gl.draw), market_probability: mkmap.DRAW != null ? mkmap.DRAW : null },
        { outcome_code: 'AWAY', team_ref: 'away', gp_probability: round4(gl.awayWin), market_probability: mkmap.AWAY != null ? mkmap.AWAY : null } ] };
      if (beta.analysis) { beta.analysis.final_vector = { HOME: round4(gl.homeWin), DRAW: round4(gl.draw), AWAY: round4(gl.awayWin) }; beta.analysis.live_adjusted = true; }
      beta._gpLive = gl; gpAbsent = false;
    }
    var r = rowFromBeta(beta);
    var live = header.status_code === 'LIVE' || (fx && fx.status === 'live');
    // disponibilidad real de cada módulo (cobertura honesta; presente sólo si hay datos)
    var hasForm = fx && fx.recentForm && (fx.recentForm.home || fx.recentForm.away);
    var hasLineups = !!fx; // siempre mostramos la sección para fixtures reales; mvLineups hace fallback a la probable
    var hasStats = fx && fx.statistics && fx.statistics.home;
    var hasEvents = fx && fx.events && fx.events.length;
    // Panel de oportunidad (si llegamos acá desde una card de Arbitraje/Precio atrasado, y corresponde a ESTE partido).
    var arbCtx = (S.arbCtx && S.arbCtx._openId === eid) ? S.arbCtx : null;
    // A.7: navegación interna de secciones (sticky). Las secciones presentes definen el menú.
    var sections = [];
    if (arbCtx) sections.push({ id: 'oportunidad', key: 'arb_sec_opp' });
    sections = sections.concat([{ id: 'resumen', key: 'tab_summary' }, { id: 'prob', key: 'mod_prob' }, { id: 'mercados', key: 'mod_markets' }, { id: 'contexto', key: 'mod_context' }]);
    if (hasForm) sections.push({ id: 'forma', key: 'mod_form' });
    if (hasLineups) sections.push({ id: 'alineaciones', key: 'mod_lineups' });
    if (hasStats || hasEvents || live) sections.push({ id: 'stats', key: 'mod_stats' });
    if (!gpAbsent) sections.push({ id: 'goles', key: 'mod_goals' });
    if (live) sections.push({ id: 'live', key: 'mod_live' });
    var sec = function (id, html) { return html ? '<div class="gx-sec" id="sec-' + id + '">' + html + '</div>' : ''; };
    mv.innerHTML = mvShell(
      mvHero(beta, fx, r, live) +
      mvNav(sections) +
      (arbCtx ? mvOpportunity(arbCtx, header) : '') +
      '<div class="gx-mv-grid">' +
      '<div class="gx-mv-col">' + sec('resumen', gpAbsent ? mvGpAbsent(beta, fx) : mvMemo(beta, r, fx)) + sec('prob', gpAbsent ? mvProbAbsent() : mvProb(beta)) + sec('contexto', mvContext(beta, fx)) + (hasForm ? sec('forma', mvForm(beta, fx)) : '') + '</div>' +
      '<div class="gx-mv-col">' + (live ? sec('live', mvLive(fx)) : '') + (hasLineups ? sec('alineaciones', mvLineups(beta, fx)) : '') + sec('mercados', mvMarkets(beta, fx, r)) + ((hasStats || hasEvents) ? sec('stats', mvStats(beta, fx)) : '') + (gpAbsent ? '' : sec('goles', mvGoals(beta))) + '</div>' +
      '</div>'
    );
    bindBack(); bindMvNav();
    if (S.pendingSec) { var ps = S.pendingSec; S.pendingSec = null; var pel = document.getElementById('sec-' + ps); if (pel) setTimeout(function () { window.scrollTo({ top: pel.getBoundingClientRect().top + window.scrollY - 110, behavior: 'smooth' }); }, 80); }
  }
  // ---- forma reciente (ambos equipos) ----
  function formResults(arr) { return '<span class="gx-formchips">' + (arr || []).slice(0, 5).map(function (x) { var c = x === 'W' ? 'w' : x === 'L' ? 'l' : 'd'; var lbl = LANG === 'en' ? x : { W: 'V', D: 'E', L: 'D' }[x] || x; return '<i class="gx-fc gx-fc-' + c + '">' + lbl + '</i>'; }).join('') + '</span>'; }
  function mvForm(beta, fx) {
    var h = beta.header, rf = fx.recentForm || {};
    var side = function (sideKey, id, name) {
      var f = rf[sideKey]; if (!f || !f.played) return '';
      var last = (f.last || []).slice(0, 5).map(function (m) { return '<div class="gx-form-last"><span class="gx-dim">' + esc(m.home ? t('tm_vs_home') : t('tm_vs_away')) + '</span><b>' + esc(m.opponent || '') + '</b><span class="gx-mono">' + esc(m.score || '') + '</span><i class="gx-fc gx-fc-' + (m.result === 'W' ? 'w' : m.result === 'L' ? 'l' : 'd') + '">' + esc(LANG === 'en' ? m.result : { W: 'V', D: 'E', L: 'D' }[m.result] || m.result) + '</i></div>'; }).join('');
      return '<div class="gx-form-side"><div class="gx-form-h"><span class="fl">' + flag(id) + '</span><b>' + esc(name) + '</b>' + formResults(f.results) + '</div>' +
        '<div class="gx-form-stats"><span>' + esc(t('form_gf')) + ' <b>' + (f.goalsFor != null ? f.goalsFor : '—') + '</b></span><span>' + esc(t('form_ga')) + ' <b>' + (f.goalsAgainst != null ? f.goalsAgainst : '—') + '</b></span><span>' + esc(t('form_cs')) + ' <b>' + (f.cleanSheets != null ? f.cleanSheets : '—') + '</b></span>' + (f.avgFor != null ? '<span>' + esc(t('form_avg')) + ' <b>' + f.avgFor + '</b></span>' : '') + '</div>' + (last ? '<div class="gx-form-lasts">' + last + '</div>' : '') + '</div>';
    };
    var body = side('home', h.home.team_id, teamName(h.home.team_id, h.home.name_fallback)) + side('away', h.away.team_id, teamName(h.away.team_id, h.away.name_fallback));
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('history') + esc(t('mod_form')) + '</span></div><div class="gx-mod-body gx-form-body">' + (body || '<div class="gx-empty">' + esc(t('na_short')) + '</div>') + '</div></div>';
  }
  // ---- alineaciones (formación + XI + suplentes + DT); fallback a la alineación probable de /api/teamdetail ----
  // cancha estilo plataforma principal: ubica el XI por líneas (FWD/MID/DEF/GK arriba→abajo)
  function posBucketP(p) { var s = (p || '').toUpperCase(); if (/^G|GK|POR/.test(s)) return 'GK'; if (/^D|DEF|LB|RB|CB/.test(s)) return 'DEF'; if (/^M|MID|MED|DM|AM/.test(s)) return 'MID'; if (/^F|FW|DEL|ATT|ST|LW|RW|CF/.test(s)) return 'FWD'; return 'MID'; }
  function shortNameP(n) { if (!n) return ''; var p = String(n).trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : n; }
  function pitchHtmlP(l) {
    var xi = (l && l.startXI) || []; if (xi.length < 7) return null;
    var b = { GK: [], DEF: [], MID: [], FWD: [] };
    xi.forEach(function (p) { b[posBucketP(p.position)].push(p); });
    var rows = [b.FWD, b.MID, b.DEF, b.GK].filter(function (a) { return a.length; });
    if (rows.length < 2) return null;
    var row = function (arr) { return '<div class="gx-pitch-row">' + arr.map(function (p) { return '<div class="gx-pp"><span class="gx-pp-num gx-mono">' + (p.number != null ? p.number : '·') + '</span><span class="gx-pp-name">' + esc(shortNameP(p.name)) + '</span></div>'; }).join('') + '</div>'; };
    return '<div class="gx-pitch">' + rows.map(row).join('') + '</div>';
  }
  function mvLineups(beta, fx) {
    var h = beta.header, lu = fx.lineups || {}, eid = beta.header.event_id;
    // lazy-fetch teamdetail para lados sin alineación (próximos partidos sin XI confirmado/proyectado en /api/match)
    ['home', 'away'].forEach(function (sk) { var id = sk === 'home' ? h.home.team_id : h.away.team_id; if (!lu[sk] && id && S.tcache[id] === undefined) { S.tcache[id] = null; fetch('/api/teamdetail/' + encodeURIComponent(id), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (td) { S.tcache[id] = td || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); }); } });
    var side = function (sideKey, id, name) {
      var l = lu[sideKey], fromTeam = false;
      if (!l) { var td = S.tcache[id]; if (td && !td._empty && td.projectedLineup && (td.projectedLineup.startXI || []).length) { l = td.projectedLineup; fromTeam = true; } }
      if (!l) return '<div class="gx-lu-side"><div class="gx-lu-h"><span class="fl">' + flag(id) + '</span><b>' + esc(name) + '</b></div><div class="gx-dim" style="font-size:12px;padding:6px 0">' + esc(S.tcache[id] === null ? t('loading') : t('e_lineups')) + '</div></div>';
      var tag = (l.confirmed && !fromTeam) ? '<span class="gx-badge gx-b-strong">' + esc(t('lineup_conf')) + '</span>' : '<span class="gx-badge gx-b-watch">' + esc(t('lineup_proj')) + '</span>';
      var pl = function (p) { return '<div class="gx-lu-p"><span class="gx-lu-n gx-mono">' + (p.number != null ? p.number : '–') + '</span><b>' + esc(p.name || '') + '</b>' + (p.position ? '<span class="gx-dim gx-lu-pos">' + esc(p.position) + '</span>' : '') + '</div>'; };
      var pitch = pitchHtmlP(l);
      var xi = (l.startXI || []).map(pl).join('');
      var subs = (l.substitutes || []).slice(0, 9).map(pl).join('');
      return '<div class="gx-lu-side"><div class="gx-lu-h"><span class="fl">' + flag(id) + '</span><b>' + esc(name) + '</b>' + tag + '</div>' +
        '<div class="gx-lu-meta gx-dim">' + (l.formation ? esc(t('formation')) + ' <b>' + esc(l.formation) + '</b>' : '') + (l.coach ? ' · ' + esc(l.coach) : '') + '</div>' +
        (pitch ? pitch : (xi ? '<div class="gx-lu-xi">' + xi + '</div>' : '')) +
        (subs ? '<div class="gx-lu-sub-h gx-label">' + esc(t('lineup_subs')) + '</div><div class="gx-lu-subs">' + subs + '</div>' : '') + '</div>';
    };
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('users-group') + esc(t('mod_lineups')) + '</span></div><div class="gx-mod-body gx-lu-grid">' + side('home', h.home.team_id, teamName(h.home.team_id, h.home.name_fallback)) + side('away', h.away.team_id, teamName(h.away.team_id, h.away.name_fallback)) + '</div></div>';
  }
  // ---- estadísticas + eventos ----
  var STAT_ROWS = [['possession', 'st_possession', '%'], ['shots', 'st_shots', ''], ['shotsOnTarget', 'st_sot', ''], ['corners', 'st_corners', ''], ['fouls', 'st_fouls', ''], ['offsides', 'st_offsides', ''], ['yellowCards', 'st_yellow', ''], ['xg', 'st_xg', '']];
  function mvStats(beta, fx) {
    var st = fx.statistics, sh = st && st.home, sa = st && st.away;
    var rows = sh ? STAT_ROWS.map(function (s) {
      var hv = sh[s[0]], av = sa ? sa[s[0]] : null; if (hv == null && av == null) return '';
      var tot = (Number(hv) || 0) + (Number(av) || 0), hp = tot > 0 ? (Number(hv) || 0) / tot * 100 : 50;
      return '<div class="gx-stat-row"><span class="gx-mono">' + (hv != null ? hv + s[2] : '—') + '</span><div class="gx-stat-mid"><span class="gx-label">' + esc(t(s[1])) + '</span><div class="gx-stat-bar"><i style="width:' + hp + '%"></i></div></div><span class="gx-mono">' + (av != null ? av + s[2] : '—') + '</span></div>';
    }).filter(Boolean).join('') : '';
    var evIcon = { goal: 'ball-football', yellow: 'square-rounded', red: 'square-rounded-filled', subst: 'arrows-exchange', var: 'video' };
    var evs = (fx.events || []).slice().reverse().slice(0, 14).map(function (e) { return '<div class="gx-event-i gx-ev-' + (e.side || '') + '"><span class="gx-mono gx-dim">' + (e.minute != null ? e.minute + "'" : '') + '</span><span class="gx-evt-ic gx-evt-' + (e.type || 'other') + '">' + ic(evIcon[e.type] || 'point') + '</span><span>' + esc(e.player || e.detail || t('evk_other')) + '</span>' + (e.assist ? '<span class="gx-dim" style="font-size:11px">· ' + esc(e.assist) + '</span>' : '') + '<span class="gx-dim gx-event-team">' + esc(e.teamName || '') + '</span></div>'; }).join('');
    var body = (rows ? '<div class="gx-stats">' + rows + '</div>' : '') + (evs ? '<div class="gx-mod-sub gx-label">' + esc(t('live_events')) + '</div><div class="gx-events">' + evs + '</div>' : '');
    if (!body) body = '<div class="gx-empty">' + esc(t('na_short')) + '</div>';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('chart-bar') + esc(t('mod_stats')) + '</span></div><div class="gx-mod-body">' + body + '</div></div>';
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
    // eliminatoria: prórroga / penales / ganador (no se corta a los 90')
    var koLine = '';
    if (fx && (finished || live)) {
      var kp = [];
      if (fx.decided === 'pens') kp.push(esc(t('decided_pens')) + (fx.penalties ? ' ' + fx.penalties.home + '-' + fx.penalties.away : ''));
      else if (fx.decided === 'et') kp.push(esc(t('decided_et')));
      if (finished && fx.winnerId) kp.push(esc(t('won_by', { team: teamName(fx.winnerId) })));
      else if (live && (fx.minute || 0) > 90) kp.push(esc(t('in_et')));
      if (kp.length) koLine = '<div class="gx-hero-ko">' + kp.join(' · ') + '</div>';
    }
    var meta = [esc(t('comp')), stageLabel(h.stage_code) ? esc(stageLabel(h.stage_code)) : '', h.venue ? esc(h.venue) : '', esc(fmtDate(h.kickoff_at))].filter(Boolean).join(' · ');
    var tri = function (fn, cls, hi) { return '<span class="gx-tri ' + cls + '">' + ['HOME', 'DRAW', 'AWAY'].map(function (c) { return '<span' + (hi === c ? ' class="hi"' : '') + '>' + fn(c) + '</span>'; }).join('') + '</span>'; };
    var miniStat = function (label, v, extra) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + v + '</b>' + (extra || '') + '</div>'; };
    return '<div class="gx-panel gx-hero">' +
      '<div class="gx-hero-meta">' + meta + '<span class="gx-spacer"></span>' + (live ? '<span class="gx-live-pill">' + esc(t('st_live')) + '</span>' : finished ? '<span class="gx-dim" style="font-size:11.5px;font-weight:600">' + esc(t('st_ft')) + '</span>' : '<span class="gx-dim" style="font-size:11.5px">' + esc(fmtTime(h.kickoff_at)) + '</span>') + (fresh ? freshChip(fresh, 'data') : '') + '</div>' +
      '<div class="gx-hero-teams">' +
      '<div class="gx-hero-side"><span class="fl">' + flag(h.home.team_id) + '</span><b>' + esc(teamName(h.home.team_id, h.home.name_fallback)) + '</b></div>' +
      '<div class="gx-hero-mid">' + (score ? '<div class="gx-hero-score gx-mono">' + esc(score) + '</div>' + (minute ? '<div class="gx-ck-clock">' + esc(minute) + '</div>' : '') : '<div class="gx-hero-vs">' + esc(t('vs')) + '</div>') + koLine + '</div>' +
      '<div class="gx-hero-side"><span class="fl">' + flag(h.away.team_id) + '</span><b>' + esc(teamName(h.away.team_id, h.away.name_fallback)) + '</b></div>' +
      '</div>' +
      // barra GP 1X2 solo si hay probabilidad GP (los partidos sin evaluación no muestran barra a 0%)
      (hasGp ? '<div class="gx-pbar"><i class="h" style="width:' + (gpH * 100) + '%"></i><i class="d" style="width:' + (gpD * 100) + '%"></i><i class="a" style="width:' + (gpA * 100) + '%"></i></div>' +
      '<div class="gx-plabels"><span>' + esc(teamName(h.home.team_id)) + ' <b>' + pct0(gpH) + '</b></span><span>X <b>' + pct0(gpD) + '</b></span><span>' + esc(teamName(h.away.team_id)) + ' <b>' + pct0(gpA) + '</b></span></div>' : '') +
      '<div class="gx-hero-grid">' +
      // celdas de mercado/mejor precio SOLO si hay datos (la cuota prematch muere al pitazo — sin guiones vacíos)
      (['HOME', 'DRAW', 'AWAY'].some(function (c) { return r.mk(c) != null; }) ? '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('hero_mkt')) + '</span>' + tri(function (c) { return pct0(r.mk(c)); }, '', null) + '</div>' : '') +
      (['HOME', 'DRAW', 'AWAY'].some(function (c) { return r.best(c) != null; }) ? '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('hero_best')) + '</span>' + tri(function (c) { return odd(r.best(c)); }, 'gx-best', bestCode(r)) + '</div>' : '') +
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
      if (a.live_adjusted) body += '<p class="gx-mod-note gx-live-ctx">' + ic('broadcast') + ' ' + esc(t('prob_live_adj')) + '</p>';
      else if (!a.context_moved_line) body += '<p class="gx-mod-note gx-dim">' + esc(t('prob_no_ctx')) + '</p>';
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
              var dc = f.direction_code, dCls = dc === 'UP' ? 'gx-pos' : dc === 'DOWN' ? 'gx-neg' : 'gx-dim', dIc = dc === 'UP' ? 'arrow-up-right' : dc === 'DOWN' ? 'arrow-down-right' : 'minus';
              return '<div class="gx-factor"><div class="gx-factor-main">' + (dc ? '<span class="' + dCls + '" style="margin-right:5px">' + ic(dIc) + '</span>' : '') + '<b>' + esc(factLabel(f.factor_code)) + '</b>' + (f.subject_team_id ? '<span class="gx-dim"> · ' + esc(teamName(f.subject_team_id)) + '</span>' : '') + '</div>' +
                '<div class="gx-factor-meta">' +
                (dc ? '<span class="' + dCls + '">' + esc(t(dc === 'UP' ? 'fac_favors' : dc === 'DOWN' ? 'fac_against' : 'fac_neutral')) + '</span>' : '') +
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
        return { outcome: ocName(h, c), provider: prettyBook(v.best_sportsbook) || '—', odds: v.best_odds, implied: 1 / v.best_odds, novig: nv ? nv[c] : null, best: c === bestCode(r), liq: null, fresh: ageFresh(v.price_observed_at) };
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

  // ---- módulo 6: Goles "en validación" (sin Pick/Value/CTA de apuesta). TODO deriva de la misma distribución:
  //      xG, distribución total, escalera O/U (con push en líneas enteras), margen de victoria y combinaciones. ----
  function mvGoals(beta) {
    var gi = beta.goal_insights;
    var head = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('ball-football') + esc(t('mod_goals')) + '</span><span class="gx-badge gx-b-watch">' + esc(t('goals_tag')) + '</span></div>';
    if (!gi) return head + '<div class="gx-mod-body"><div class="gx-empty">' + ic('ball-football') + '<b>' + esc(t('goals_none')) + '</b></div></div></div>';
    var h = beta.header || {};
    var hN = teamName(h.home && h.home.team_id, h.home && h.home.name_fallback) || t('g_home'), aN = teamName(h.away && h.away.team_id, h.away && h.away.name_fallback) || t('g_away');
    var eg = gi.expected_goals || {}, btts = gi.btts;
    var asian = gi.asian_over_under || [], dist = gi.total_distribution || [], wm = gi.winning_margin || {}, cm = gi.combos || {};
    var stat = function (label, v) { return '<div class="gx-g-stat"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + v + '</b></div>'; };
    // distribución total de goles (barras relativas al pico)
    var maxP = dist.reduce(function (m, d) { return Math.max(m, d.p || 0); }, 0.0001);
    var distHtml = dist.map(function (d) { return '<div class="gx-ou-row"><span class="gx-mono">' + esc(d.label) + '</span><div class="gx-ou-bars"><span class="gx-ou-over" style="width:' + ((d.p / maxP) * 100) + '%"></span></div><span class="gx-mono gx-dim gx-g-pct">' + pct0(d.p) + '</span></div>'; }).join('');
    // escalera O/U con push (líneas enteras muestran el empuje)
    var LAD = [1.5, 2.0, 2.5, 3.0, 3.5];
    var ladRow = function (line) {
      var a = null; for (var i = 0; i < asian.length; i++) if (asian[i].line === line) { a = asian[i]; break; }
      if (!a) return '';
      var pushTxt = (a.push && a.push > 0.001) ? ' · ' + esc(t('g_push')) + ' ' + pct0(a.push) : '';
      return '<div class="gx-ou-row"><span class="gx-mono">' + line.toFixed(1) + '</span><div class="gx-ou-bars"><span class="gx-ou-over" style="width:' + ((a.over || 0) * 100) + '%"></span></div><span class="gx-mono gx-dim">' + esc(t('g_over')) + ' ' + pct0(a.over) + ' · ' + esc(t('g_under')) + ' ' + pct0(a.under) + pushTxt + '</span></div>';
    };
    // fila etiqueta + barra + % (margen / combinaciones)
    var mRow = function (label, p) { if (p == null) return ''; return '<div class="gx-ou-row"><span class="gx-g-mlabel">' + esc(label) + '</span><div class="gx-ou-bars"><span class="gx-ou-over" style="width:' + (p * 100) + '%"></span></div><span class="gx-mono gx-dim gx-g-pct">' + pct0(p) + '</span></div>'; };
    var marginHtml = mRow(t('g_either2'), wm.either_by_2_plus) + mRow(t('g_team_by2', { team: hN }), wm.home_by_2_plus) + mRow(t('g_team_by2', { team: aN }), wm.away_by_2_plus) + mRow(t('g_draw'), wm.draw);
    var combosHtml = mRow(t('g_team_wino25', { team: hN }), cm.home_win_and_over_2_5) + mRow(t('g_team_wino25', { team: aN }), cm.away_win_and_over_2_5) + mRow(t('g_wintonil'), cm.win_to_nil_either) + mRow(t('g_team_cs', { team: hN }), cm.home_clean_sheet) + mRow(t('g_team_cs', { team: aN }), cm.away_clean_sheet);
    var scores = (gi.top_scores || []).slice(0, 5);
    return head + '<div class="gx-mod-body">' +
      '<div class="gx-g-stats">' + stat(t('g_xg'), (eg.HOME != null ? Number(eg.HOME).toFixed(2) : '—') + ' – ' + (eg.AWAY != null ? Number(eg.AWAY).toFixed(2) : '—')) + stat(t('g_total'), eg.TOTAL != null ? Number(eg.TOTAL).toFixed(2) : '—') + (btts ? stat(t('g_btts'), esc(t('g_yes')) + ' ' + pct0(btts.yes)) : '') + '</div>' +
      (dist.length ? '<div class="gx-mod-sub gx-label">' + esc(t('g_dist')) + '</div>' + distHtml : '') +
      '<div class="gx-mod-sub gx-label">' + esc(t('g_ou')) + '</div>' + LAD.map(ladRow).filter(Boolean).join('') +
      (marginHtml ? '<div class="gx-mod-sub gx-label">' + esc(t('g_margin')) + '</div>' + marginHtml : '') +
      (combosHtml ? '<div class="gx-mod-sub gx-label">' + esc(t('g_combos')) + '</div>' + combosHtml : '') +
      (scores.length ? '<div class="gx-mod-sub gx-label">' + esc(t('g_scores')) + '</div><div class="gx-scores">' + scores.map(function (s) { return '<div class="gx-score-i"><b class="gx-mono">' + esc(s.score) + '</b><span class="gx-dim gx-mono">' + pct0(s.probability) + '</span></div>'; }).join('') + '</div>' : '') +
      '<p class="gx-mod-note gx-dim">' + ic('alert-triangle') + ' ' + esc(t('goals_disc')) + '</p>' +
      '</div></div>';
  }

  // ---- módulo 7: Live real (solo con fuente válida; no presentar prob prepartido como live) ----
  function mvLive(fx) {
    if (!fx || fx.status !== 'live') return '';
    var mp = fx.modelProbabilities, hasLiveProb = mp && mp.live === true;
    var lc = mp && mp.liveContext;
    var lcNote = '';
    if (lc && (lc.home_reds || lc.away_reds)) {
      var redTeam = lc.home_reds && lc.away_reds ? (lc.home_team + ' / ' + lc.away_team) : lc.home_reds ? lc.home_team : lc.away_team;
      lcNote = '<p class="gx-mod-note gx-live-ctx">' + ic('square-rounded-filled') + ' ' + esc(t('live_ctx_red', { team: redTeam })) + '</p>';
    }
    var stale = ageFresh(fx.updatedAt) === 'STALE';
    var sc = fx.score ? (fx.score.home + ' - ' + fx.score.away) : '—';
    var evs = (fx.events || []).slice(-6).reverse();
    var st = fx.statistics;
    var statRow = function (key, label) { if (!st || !st.home || st.home[key] == null && st.away[key] == null) return ''; return '<div class="gx-livestat"><span class="gx-mono">' + (st.home[key] != null ? st.home[key] : '—') + '</span><span class="gx-label">' + esc(label) + '</span><span class="gx-mono">' + (st.away[key] != null ? st.away[key] : '—') + '</span></div>'; };
    var evIcon = { goal: 'ball-football', yellow: 'square-rounded', red: 'square-rounded-filled', subst: 'arrows-exchange', var: 'video' };
    var body =
      '<div class="gx-live-top"><span class="gx-live-pill">' + esc(t('st_live')) + '</span><b class="gx-mono gx-live-score">' + esc(sc) + '</b>' + (fx.minute != null ? '<span class="gx-ck-clock">' + esc(fx.minute + "'") + '</span>' : '') + '<span class="gx-spacer"></span>' + freshChip(ageFresh(fx.updatedAt), 'data') + '</div>' +
      (stale ? '<p class="gx-mod-note gx-warn">' + ic('alert-triangle') + ' ' + esc(t('live_stale')) + '</p>' : '') +
      (hasLiveProb ? '<div class="gx-mod-sub gx-label">' + esc(t('live_prob')) + '</div><div class="gx-pbar sm"><i class="h" style="width:' + ((mp.homeWin || 0) * 100) + '%"></i><i class="d" style="width:' + ((mp.draw || 0) * 100) + '%"></i><i class="a" style="width:' + ((mp.awayWin || 0) * 100) + '%"></i></div><div class="gx-plabels"><span><b>' + pct0(mp.homeWin) + '</b></span><span>X <b>' + pct0(mp.draw) + '</b></span><span><b>' + pct0(mp.awayWin) + '</b></span></div>' + lcNote : '') +
      (st && st.home ? '<div class="gx-mod-sub gx-label">' + esc(t('live_stats')) + '</div>' + [['possession', t('st_possession')], ['shots', t('st_shots')], ['shotsOnTarget', t('st_sot')], ['corners', t('st_corners')], ['xg', t('st_xg')]].map(function (s) { return statRow(s[0], s[1]); }).filter(Boolean).join('') : '') +
      (evs.length ? '<div class="gx-mod-sub gx-label">' + esc(t('live_events')) + '</div><div class="gx-events">' + evs.map(function (e) { return '<div class="gx-event-i"><span class="gx-mono gx-dim">' + (e.minute != null ? e.minute + "'" : '') + '</span><span class="gx-evt-ic gx-evt-' + (e.type || 'other') + '">' + ic(evIcon[e.type] || 'point') + '</span><span>' + esc(e.player || e.detail || t('evk_other')) + '</span><span class="gx-dim gx-event-team">' + esc(e.teamName || '') + '</span></div>'; }).join('') + '</div>' : '');
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
  function mGpCell(canon, c) {
    // EN VIVO: si el server entregó la prob GP en vivo (gpProbs) la usamos (se mueve con el partido).
    if (c && c.gpProbs && c.gpProbs.home != null) { var gl = { HOME: c.gpProbs.home, DRAW: c.gpProbs.draw, AWAY: c.gpProbs.away }; return triCell(function (cc) { return pct0(gl[cc]); }, 'gx-gp', maxCode(function (cc) { return gl[cc]; })); }
    if (canon && canon.gp && canon.gp.HOME != null) return triCell(function (cc) { return pct0(canon.gp[cc]); }, 'gx-gp', maxCode(function (cc) { return canon.gp[cc]; }));
    // sin evaluación canónica: mostramos la Probabilidad GP del modelo (base) — el desglose de contexto aparece al abrir el partido.
    var p = c && c.probs; if (p && p.home != null) { var m = { HOME: p.home, DRAW: p.draw, AWAY: p.away }; return triCell(function (cc) { return pct0(m[cc]); }, 'gx-gp', maxCode(function (cc) { return m[cc]; })); }
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
          '<td>' + mGpCell(canon, c) + '</td>' +
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
        '<div class="gx-mcard-rows"><div><span class="gx-label">' + esc(t('th_gp')) + '</span>' + mGpCell(canon, c) + '</div></div>' +
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
    return hero + '<div class="gx-mv-grid">' + '<div class="gx-mv-col">' + memo + simFactors(d) + simContext(d) + '</div>' + '<div class="gx-mv-col">' + simSims(d) + simGoals(d) + '</div>' + '</div>';
  }
  // factores del análisis (localizado, sin prosa ES ni deltas técnicos): label + equipo + dirección + aplicado/neutral
  function simFactors(d) {
    var fac = (d.analysis && d.analysis.factors) || [];
    if (!fac.length) return '';
    var rows = fac.slice(0, 8).map(function (f) {
      var team = teamName(f.side === 'a' ? d.a.id : d.b.id);
      var imp = f.eloImpact != null ? f.eloImpact : (f.cappedContribution != null ? f.cappedContribution : 0);
      var dir = f.dir || (imp > 0 ? 'up' : imp < 0 ? 'down' : 'flat'), applied = f.included !== false && dir !== 'flat';
      var dcls = dir === 'up' ? 'gx-pos' : dir === 'down' ? 'gx-neg' : 'gx-dim', dic = dir === 'up' ? 'arrow-up-right' : dir === 'down' ? 'arrow-down-right' : 'minus';
      return '<div class="gx-factor"><div class="gx-factor-main"><b>' + esc(factLabel(f.factorCode)) + '</b><span class="gx-dim"> · ' + esc(team) + '</span></div>' +
        '<div class="gx-factor-meta"><span class="' + dcls + '">' + ic(dic) + ' ' + esc(t(applied ? 'sim_f_applied' : 'sim_f_neutral')) + '</span>' + (f.category ? '<span class="gx-dim">' + esc(factLabel(f.category)) + '</span>' : '') + '</div></div>';
    }).join('');
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('chart-arcs') + esc(t('sim_factors')) + '</span></div><div class="gx-mod-body"><div class="gx-factors">' + rows + '</div><p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('evaluated_note')) + '</p></div></div>';
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
      '<div class="gx-hero-grid">' + prob(t('tm_champion'), td.championProbability) + prob(t('tm_final'), td.finalProbability) + prob(t('tm_semi'), td.semifinalsProbability) + prob(t('tm_qf'), td.quarterfinalsProbability) + prob(t('tm_advance'), td.advanceProbability) + (td.groupWinProbability != null ? prob(t('tm_groupwin'), td.groupWinProbability) : '') + '</div>' +
      '<div class="gx-team-actions"><button class="gx-btn ghost gx-follow" data-follow="' + esc(id) + '">' + ic(isFollowing(id) ? 'star-filled' : 'star') + ' ' + esc(t(isFollowing(id) ? 'tm_following' : 'tm_follow')) + '</button><span class="gx-hero-note gx-dim">' + esc(t('tm_sim_note')) + '</span></div></div>';
    // tabs
    var TABS = [['resumen', 'tab_summary'], ['plantilla', 'tm_tab_squad'], ['forma', 'mod_form'], ['resultados', 'tm_tab_results'], ['mercados', 'mod_markets'], ['noticias', 'news_title']];
    var tab = S.teamTab || 'resumen';
    var tabNav = '<nav class="gx-mv-nav" id="gx-team-tabs">' + TABS.map(function (x) { return '<a data-ttab="' + x[0] + '"' + (x[0] === tab ? ' class="on"' : '') + '>' + esc(t(x[1])) + '</a>'; }).join('') + '</nav>';
    mv.innerHTML = mvShell('<div></div>' + hero + tabNav + '<div id="gx-team-body">' + teamTabBody(id, td, tab) + '</div>');
    bindBack();
    [].forEach.call(mv.querySelectorAll('[data-ttab]'), function (a) { a.addEventListener('click', function () { S.teamTab = a.getAttribute('data-ttab'); [].forEach.call(mv.querySelectorAll('[data-ttab]'), function (x) { x.classList.toggle('on', x === a); }); $('#gx-team-body').innerHTML = teamTabBody(id, td, S.teamTab); a.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }); });
  }
  function teamMatchRow(c, id) { var opp = c.home === id ? c.away : c.home, sc = mScore(c); return '<div class="gx-tmatch gx-row" data-openmatch="' + esc(oidFor(c)) + '"><span class="gx-time">' + esc(fmtDate(c.datetime)) + '</span><div class="gx-cell-team"><span class="gx-dim" style="font-size:11px">' + esc(c.home === id ? t('tm_vs_home') : t('tm_vs_away')) + '</span><span class="fl">' + flag(opp) + '</span><b>' + esc(teamName(opp)) + '</b></div><span class="gx-spacer"></span>' + (sc ? '<span class="gx-mono" style="font-weight:600">' + esc(sc) + '</span>' : mStatusCell(c)) + ' ' + ic('chevron-right') + '</div>'; }
  function teamPanel(icn, title, body) { return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic(icn) + esc(title) + '</span></div><div class="gx-mod-body">' + body + '</div></div>'; }
  function teamTabBody(id, td, tab) {
    if (tab === 'plantilla') {
      var playerRow = function (p) { return '<div class="gx-lu-p"><span class="gx-lu-n gx-mono">' + (p.number != null ? p.number : '–') + '</span><b>' + esc(p.name || '') + '</b>' + (p.position ? '<span class="gx-dim gx-lu-pos">' + esc(p.position) + '</span>' : '') + (p.age ? '<span class="gx-dim" style="font-size:10.5px">' + p.age + '</span>' : '') + (p.status && p.status !== 'available' ? '<span class="gx-badge gx-b-watch" style="font-size:9px">' + esc(t('st_' + p.status) || p.status) + '</span>' : '') + '</div>'; };
      var kp = (td.keyPlayers || []).length ? teamPanel('star', t('tm_keyplayers'), '<div class="gx-lu-xi">' + td.keyPlayers.map(playerRow).join('') + '</div>') : '';
      var sq = (td.squad || []).length ? teamPanel('users-group', t('tm_tab_squad') + ' · ' + td.squad.length, '<div class="gx-lu-xi">' + td.squad.map(playerRow).join('') + '</div>') : '';
      var pl = td.projectedLineup ? teamPanel('layout-board', td.projectedLineup.confirmed ? t('lineup_conf') : t('lineup_proj'), '<div class="gx-lu-meta gx-dim">' + (td.projectedLineup.formation ? esc(t('formation')) + ' <b>' + esc(td.projectedLineup.formation) + '</b>' : '') + (td.projectedLineup.coach ? ' · ' + esc(td.projectedLineup.coach) : '') + '</div><div class="gx-lu-xi">' + (td.projectedLineup.startXI || []).map(playerRow).join('') + '</div>') : '';
      var body = kp + sq + pl;
      return body || teamPanel('users-group', t('tm_tab_squad'), '<div class="gx-empty">' + esc(t('na_short')) + '</div>');
    }
    if (tab === 'forma') {
      var f = td.recentForm; if (!f || !f.played) return teamPanel('history', t('mod_form'), '<div class="gx-empty">' + esc(t('na_short')) + '</div>');
      var last = (f.last || []).slice(0, 6).map(function (m) { return '<div class="gx-form-last"><span class="gx-dim">' + esc(fmtDate(m.date)) + '</span><span class="gx-dim" style="font-size:11px">' + esc(m.home ? t('tm_vs_home') : t('tm_vs_away')) + '</span><b>' + esc(m.opponent || '') + '</b><span class="gx-mono">' + esc(m.score || '') + '</span><i class="gx-fc gx-fc-' + (m.result === 'W' ? 'w' : m.result === 'L' ? 'l' : 'd') + '">' + esc(LANG === 'en' ? m.result : { W: 'V', D: 'E', L: 'D' }[m.result] || m.result) + '</i></div>'; }).join('');
      return teamPanel('history', t('mod_form'), '<div class="gx-form-h" style="margin-bottom:12px"><b>' + esc(t('tm_last5')) + '</b>' + formResults(f.results) + '</div><div class="gx-form-stats" style="margin-bottom:12px"><span>' + esc(t('form_gf')) + ' <b>' + (f.goalsFor != null ? f.goalsFor : '—') + '</b></span><span>' + esc(t('form_ga')) + ' <b>' + (f.goalsAgainst != null ? f.goalsAgainst : '—') + '</b></span><span>' + esc(t('form_cs')) + ' <b>' + (f.cleanSheets != null ? f.cleanSheets : '—') + '</b></span><span>' + esc(t('form_avg')) + ' <b>' + (f.avgFor != null ? f.avgFor : '—') + '</b></span></div>' + (last ? '<div class="gx-form-lasts">' + last + '</div>' : ''));
    }
    if (tab === 'resultados') {
      var ms = teamMatches(id);
      var up = ms.filter(function (c) { return calStatus(c) !== 'final'; }).slice(0, 3);
      var fin = ms.filter(function (c) { return calStatus(c) === 'final'; }).reverse();
      var nb = up.length ? teamPanel('calendar', t('tm_next'), up.map(function (c) { return teamMatchRow(c, id); }).join('')) : '';
      var fb = fin.length ? teamPanel('history', t('tm_recent_matches'), fin.map(function (c) { return teamMatchRow(c, id); }).join('')) : '';
      return (nb + fb) || teamPanel('calendar', t('tm_tab_results'), '<div class="gx-empty">' + esc(t('na_short')) + '</div>');
    }
    if (tab === 'mercados') {
      var mp = td.marketPrices || []; if (!mp.length) return teamPanel('arrows-left-right', t('mod_markets'), '<div class="gx-empty">' + esc(t('mkt_none')) + '</div>');
      var rows = mp.map(function (o) {
        var liq = o.liquidity != null ? o.liquidity : (o.volume != null ? o.volume : null);
        return '<tr><td class="l gx-mkt-oc">' + esc(o.venue || '—') + '</td><td class="gx-mono">' + (o.price != null ? (o.price <= 1 ? pct0(o.price) : odd(o.price)) : '—') + '</td><td class="gx-mono gx-dim">' + (o.bid != null && o.ask != null ? pct0(o.bid) + '/' + pct0(o.ask) : '—') + '</td><td class="gx-mono gx-dim">' + (liq != null ? mktLiq(liq) : '—') + '</td><td class="gx-mono ' + (o.change24h > 0 ? 'gx-pos' : o.change24h < 0 ? 'gx-neg' : 'gx-dim') + '">' + (o.change24h != null ? (o.change24h > 0 ? '+' : '') + (o.change24h * 100).toFixed(1) + '%' : '—') + '</td></tr>';
      }).join('');
      return teamPanel('arrows-left-right', t('mod_markets') + ' · ' + t('tm_champion'), '<table class="gx-mkt-table"><thead><tr><th class="l">' + esc(t('col_provider')) + '</th><th>' + esc(t('tm_mkt_price')) + '</th><th>Bid/Ask</th><th>' + esc(t('col_liq')) + '</th><th>Δ24h</th></tr></thead><tbody>' + rows + '</tbody></table>');
    }
    if (tab === 'noticias') {
      var inj = []; var seen = {}; (td.injuries || []).concat(td.sidelined || []).forEach(function (x) { var nm = x.player || x.name; if (nm && !seen[nm]) { seen[nm] = 1; inj.push(x); } });
      var injB = inj.length ? teamPanel('first-aid-kit', t('ctx_inj'), '<div class="gx-injlist">' + inj.slice(0, 12).map(function (x) { return '<div class="gx-inj-i"><b>' + esc(x.player || x.name) + '</b>' + (x.status ? '<span class="gx-badge gx-b-watch">' + esc(t('st_' + x.status) || x.status) + '</span>' : '') + (x.reason ? '<span class="gx-dim" style="font-size:11.5px">' + esc(x.reason) + '</span>' : '') + '</div>'; }).join('') + '</div>') : '';
      var news = td.news || [];
      var newsB = news.length ? teamPanel('news', t('news_title'), '<div class="gx-newslist">' + news.slice(0, 6).map(function (n) { return '<div class="gx-news-i"><b>' + esc(n.title || '') + '</b><span class="gx-dim">' + esc(n.source || '') + (n.published ? ' · ' + esc(fmtDate(n.published)) : '') + '</span></div>'; }).join('') + '</div>') : '';
      return (injB + newsB) || teamPanel('news', t('news_title'), '<div class="gx-empty">' + esc(t('na_short')) + '</div>');
    }
    // Resumen (default)
    var probGrid = '<div class="gx-hero-grid" style="margin-top:0">' + ['championProbability', 'finalProbability', 'semifinalsProbability', 'quarterfinalsProbability', 'advanceProbability', 'groupWinProbability', 'groupSecondProbability', 'outInGroupsProbability'].map(function (k) { var lbls = { championProbability: 'tm_champion', finalProbability: 'tm_final', semifinalsProbability: 'tm_semi', quarterfinalsProbability: 'tm_qf', advanceProbability: 'tm_advance', groupWinProbability: 'tm_groupwin', groupSecondProbability: 'tm_groupsecond', outInGroupsProbability: 'tm_out' }; return td[k] != null ? '<div class="gx-hero-mini"><span class="gx-label">' + esc(t(lbls[k])) + '</span><b class="gx-mono">' + pct1(td[k]) + '</b></div>' : ''; }).join('') + '</div>';
    var read = (td.modelRead || (td.keyDrivers && td.keyDrivers.length) || td.explanation) ? teamPanel('bulb', t('tm_read'), (td.modelRead ? '<p class="gx-method-p">' + esc(td.modelRead) + '</p>' : '') + ((td.keyDrivers || []).length ? '<div class="gx-chips" style="margin-top:10px">' + td.keyDrivers.slice(0, 6).map(function (d) { return '<span class="gx-chip">' + esc(d) + '</span>'; }).join('') + '</div>' : '') + (td.explanation ? '<p class="gx-method-p gx-dim" style="margin-top:10px">' + esc(td.explanation) + '</p>' : '')) : '';
    var opp = (td.likelyOpponents || []).length ? teamPanel('swords', t('tm_likely_opp'), '<div class="gx-opplist">' + td.likelyOpponents.slice(0, 6).map(function (o) { return '<div class="gx-opp-i" data-nav-team="' + esc(o.id) + '"><span class="fl">' + flag(o.id) + '</span><b>' + esc(teamName(o.id, o.name)) + '</b><span class="gx-spacer"></span><span class="gx-mono gx-dim">' + pct0(o.pct) + '</span></div>'; }).join('') + '</div>') : '';
    var paths = (td.samples || []).length ? teamPanel('route', t('tm_paths') + ' · ' + (td.sims ? td.sims.toLocaleString() : '') + ' sims', '<div class="gx-paths">' + td.samples.slice(0, 5).map(function (run) { return '<div class="gx-path"><div class="gx-path-steps">' + (run || []).map(function (s) { return '<span class="gx-path-step ' + (s.score ? '' : 'gx-dim') + '">' + esc(stageLabel(s.stage) || '') + ' <b>' + esc(s.score || '') + '</b>' + (s.pen ? ' (p)' : '') + '</span>'; }).join('<i class="gx-path-arrow">›</i>') + '</div></div>'; }).join('') + '</div>') : '';
    // Próximo partido + contexto: enlaza al cockpit (donde la prob GP del partido refleja forma/bajas/clima).
    // Las probabilidades de torneo (arriba) reflejan la fuerza base; el contexto por partido vive en el cockpit.
    var nx = teamMatches(id).filter(function (c) { return calStatus(c) !== 'final'; })[0];
    var nextCtx = nx ? teamPanel('calendar-event', t('tm_next_ctx'), teamMatchRow(nx, id) + '<p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('tm_ctx_note')) + '</p>') : '';
    var summaryPanel = teamPanel('chart-arcs', t('tab_summary'), probGrid + '<p class="gx-mod-note gx-dim" style="margin-top:10px">' + ic('info-circle') + ' ' + esc(t('tm_base_note')) + '</p>');
    // GP Intelligence del título: probabilidad GP de ser campeón vs mercado (Polymarket/Kalshi) + ventaja
    var gpiPanel = '';
    if (td.championProbability != null) {
      var mkts = (td.marketPrices || []).filter(function (m) { return m.ask != null || m.price != null; });
      var bestM = mkts.slice().sort(function (a, b) { return (a.ask != null ? a.ask : a.price) - (b.ask != null ? b.ask : b.price); })[0];
      var mPct = bestM ? (bestM.ask != null ? bestM.ask : bestM.price) : null;
      var edge = mPct != null ? (td.championProbability - mPct) : null;
      var stat = function (lbl, val, cls) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(lbl) + '</span><b class="gx-mono ' + (cls || '') + '">' + val + '</b></div>'; };
      var grid = '<div class="gx-hero-grid" style="margin-top:0">' + stat(t('tm_gpi_model'), pct1(td.championProbability), 'hi') +
        (mPct != null ? stat(t('tm_gpi_market') + (bestM && bestM.venue ? ' · ' + esc(bestM.venue) : ''), pct1(mPct)) : '') +
        (edge != null ? stat(t('tm_gpi_edge'), (edge >= 0 ? '+' : '') + (edge * 100).toFixed(1) + ' pp', edge > 0.005 ? 'gx-pos' : edge < -0.005 ? 'gx-neg' : 'gx-dim') : '') + '</div>';
      gpiPanel = teamPanel('trophy', t('tm_gpi'), grid + '<p class="gx-mod-note gx-dim" style="margin-top:10px">' + ic('info-circle') + ' ' + esc(t('tm_gpi_note')) + '</p>');
    }
    return summaryPanel + gpiPanel + nextCtx + read + opp + paths;
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
  // descripción de slot (estructura oficial FIFA) igual que la plataforma principal: Ganador P{m}, 1º/2º Grupo, etc.
  function slotDesc(side) {
    if (!side) return t('bk_tbd');
    if (side.t === 'W') return t('slot_gw', { g: side.g });
    if (side.t === 'R') return t('slot_gr', { g: side.g });
    if (side.t === 'T3') return t('slot_t3', { groups: (side.allowed || []).join('/') });
    if (side.t === 'M') return t('slot_win', { m: side.m });
    if (side.t === 'L') return t('slot_los', { m: side.m });
    return t('bk_tbd');
  }
  function renderBracket() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var STAGES = ['R32', 'R16', 'QF', 'SF', '3RD', 'FINAL'];
    var byStage = {}; (S.knockoutRaw || []).forEach(function (k) { (byStage[k.stage] = byStage[k.stage] || []).push(k); });
    var cols = STAGES.filter(function (s) { return byStage[s]; }).map(function (s) {
      var matches = byStage[s].map(function (k) {
        var r = k.result, fin = r && r.status === 'final';
        var hi = (r && r.home) || (k.resolved && k.resolved.home), ai = (r && r.away) || (k.resolved && k.resolved.away);
        var p = k.probs;
        var winH = fin && (r.hg > r.ag || (r.hg === r.ag && r.pensHome)), winA = fin && !winH && (r.ag >= r.hg);
        var side = function (id, slot, prob, win, score) {
          var label = id ? ('<span class="fl">' + flag(id) + '</span><b>' + esc(teamName(id)) + '</b>') : '<span class="gx-bk-slot">' + esc(slotDesc(slot)) + '</span>';
          return '<div class="gx-bk-side' + (win ? ' win' : '') + (id ? '' : ' tbd') + '">' + label + '<span class="gx-spacer"></span>' + (score != null ? '<span class="gx-mono gx-bk-sc">' + score + '</span>' : (prob != null && !fin ? '<span class="gx-mono gx-dim">' + pct0(prob) + '</span>' : '')) + '</div>';
        };
        var clickable = hi && ai;
        var oid = clickable ? (canonByKey(hi, ai, (k.datetime || k.date || '').slice(0, 10)) || 'fx-' + String(k.m)) : null;
        return '<div class="gx-bk-match' + (clickable ? '' : ' gx-bk-tbd') + '"' + (clickable ? ' data-openmatch="' + esc(oid) + '"' : '') + '>' +
          '<div class="gx-bk-top"><span class="gx-time">P' + k.m + ' · ' + esc(fmtDate(k.datetime || (k.date ? k.date + 'T00:00Z' : null))) + '</span>' + (fin ? '<span class="gx-dim" style="font-size:10px">' + esc(t('st_ft')) + '</span>' : '') + '</div>' +
          side(hi, k.home, p ? p.home : null, winH, fin ? r.hg : null) + side(ai, k.away, p ? p.away : null, winA, fin ? r.ag : null) +
          (p && p.draw != null && !fin && hi && ai ? '<div class="gx-bk-draw gx-dim">' + esc(t('bk_reg90')) + ' · X ' + pct0(p.draw) + '</div>' : '') +
          '</div>';
      }).join('');
      return '<div class="gx-bk-col"><div class="gx-bk-colh">' + esc(stageLabel(s)) + '</div>' + matches + '</div>';
    }).join('');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_bracket'), '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11px">' + esc(t('bk_subtitle')) + '</span>') + '<div class="gx-bk-scroll"><div class="gx-bk">' + cols + '</div></div></div></div>';
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
      var followed = (S.me && S.me.favorites) || [];
      var filt = S.evoFilt === 'mine' && followed.length ? 'mine' : 'top';
      var sel = filt === 'mine' ? followed.slice(0, 10) : Object.keys(last).sort(function (a, b) { return (last[b] || 0) - (last[a] || 0); }).slice(0, 10);
      // gráfico SVG multi-línea sobre snapshots REALES
      var W = 720, H = 240, padL = 8, padR = 8, padT = 12, padB = 8, iw = W - padL - padR, ih = H - padT - padB;
      var ymax = Math.max.apply(null, sel.map(function (id) { return Math.max.apply(null, hist.map(function (h) { return h.probs[id] || 0; })); }).concat([0.05]));
      var COLORS = ['#1FE3A4', '#5BA8FF', '#F2C14E', '#FF6B6B', '#34D6C8', '#B08CFF', '#FF9F5B', '#5BEFC0', '#8FE0BE', '#FF7AC8'];
      var x = function (i) { return padL + (hist.length === 1 ? iw / 2 : i / (hist.length - 1) * iw); };
      var y = function (v) { return padT + ih - (v / ymax) * ih; };
      var lines = sel.map(function (id, k) {
        var pts = hist.map(function (h, i) { return x(i) + ',' + y(h.probs[id] || 0); }).join(' ');
        var lv = last[id] || 0;
        return '<polyline points="' + pts + '" fill="none" stroke="' + COLORS[k % COLORS.length] + '" stroke-width="2" stroke-linejoin="round"/>' +
          '<circle cx="' + x(hist.length - 1) + '" cy="' + y(lv) + '" r="3" fill="' + COLORS[k % COLORS.length] + '"/>';
      }).join('');
      var grid = [0.25, 0.5, 0.75].map(function (f) { var yy = padT + ih - f * ih; return '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy + '" stroke="rgba(255,255,255,.05)"/>'; }).join('');
      var legend = sel.map(function (id, k) { return '<div class="gx-evo-leg" data-nav-team="' + esc(id) + '"><span class="gx-evo-dot" style="background:' + COLORS[k % COLORS.length] + '"></span><span class="fl">' + flag(id) + '</span><b>' + esc(teamName(id)) + '</b><span class="gx-mono gx-dim">' + pct1(last[id] || 0) + '</span></div>'; }).join('');
      var chart = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('evo_champion')) + '</span><span class="gx-spacer"></span>' +
        '<div class="gx-seg" id="gx-evo-seg"><button data-evo="top"' + (filt === 'top' ? ' class="on"' : '') + '>' + esc(t('evo_top')) + '</button>' + (followed.length ? '<button data-evo="mine"' + (filt === 'mine' ? ' class="on"' : '') + '>' + esc(t('nav_follow')) + '</button>' : '') + '</div>' +
        '<span class="gx-ph-extra" style="margin-left:10px">' + hist.length + ' ' + esc(t('evo_snapshots')) + '</span></div>' +
        '<div class="gx-mod-body"><svg class="gx-evo-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid + lines + '</svg><div class="gx-evo-legend">' + legend + '</div></div></div>';
      // tabla con Δ
      var rows = sel.map(function (id) { var cur = last[id] || 0, prev = first[id] || 0, dd = cur - prev; return '<tr class="gx-row" data-nav-team="' + esc(id) + '"><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(id) + '</span><b>' + esc(teamName(id)) + '</b></div></td><td class="gx-mono" style="color:var(--gx-text)">' + pct1(cur) + '</td><td class="gx-mono ' + (dd > 0 ? 'gx-pos' : dd < 0 ? 'gx-neg' : 'gx-dim') + '">' + (dd === 0 ? '—' : (dd > 0 ? '+' : '') + (dd * 100).toFixed(1) + ' pp') + '</td></tr>'; }).join('');
      var table = '<div class="gx-panel gx-board"><table class="gx-table"><thead><tr><th class="l">' + esc(t('nav_teams')) + '</th><th>' + esc(t('evo_now')) + '</th><th>Δ</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      body = chart + table;
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_evo'), '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11px">' + esc(t('evo_note')) + '</span>') + body + '</div></div>';
    [].forEach.call(mv.querySelectorAll('[data-evo]'), function (b) { b.addEventListener('click', function () { S.evoFilt = b.getAttribute('data-evo'); renderEvo(); }); });
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

  // ---- Seguidos ----
  function renderFollow() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var favs = (S.me && S.me.favorites) || [];
    var simById = {}; S.stTeams.forEach(function (t) { simById[t.id] = t.sim; });
    var body;
    if (!favs.length) body = '<div class="gx-panel"><div class="gx-empty">' + ic('star') + '<b>' + esc(t('fol_empty')) + '</b>' + esc(t('fol_empty_sub')) + '</div></div>';
    else {
      var rows = favs.map(function (id) {
        var s = simById[id] || {}, ms = teamMatches(id).filter(function (c) { return calStatus(c) !== 'final'; })[0];
        return '<tr class="gx-row" data-nav-team="' + esc(id) + '"><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(id) + '</span><b>' + esc(teamName(id)) + '</b></div></td>' +
          '<td class="l gx-dim" style="font-size:11.5px">' + (ms ? esc(t('vs') + ' ' + teamName(ms.home === id ? ms.away : ms.home) + ' · ' + fmtDate(ms.datetime)) : '—') + '</td>' +
          '<td class="gx-mono">' + pct1(s.champion) + '</td>' +
          '<td class="l"><button class="gx-iconmini" data-follow="' + esc(id) + '" title="' + esc(t('tm_following')) + '">' + ic('star-filled') + '</button></td></tr>';
      }).join('');
      body = '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('nav_follow')) + '</span><span class="gx-ph-extra">' + favs.length + '</span></div><table class="gx-table"><thead><tr><th class="l">' + esc(t('nav_teams')) + '</th><th class="l">' + esc(t('tm_next')) + '</th><th>' + esc(t('tm_champion')) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_follow')) + body + '</div></div>';
  }
  // ---- Alertas ----
  var ALERT_EVENTS = [['nextMatch', 'calendar', 'al_next'], ['matchStart', 'player-play', 'al_start'], ['goal', 'ball-football', 'al_goal'], ['result', 'flag', 'al_result'], ['qualify', 'trophy', 'al_qualify'], ['probSwing', 'trending-up', 'al_swing'], ['valueOpp', 'target-arrow', 'al_value'], ['arb', 'arrows-left-right', 'al_arb']];
  var ALERT_CHANNELS = [['email', 'mail', 'al_email', false], ['telegram', 'brand-telegram', 'al_telegram', true], ['push', 'bell', 'al_push', true]];
  function renderAlerts() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var prefs = (S.me && S.me.alertPrefs) || {}, ev = prefs.events || {}, ch = prefs.channels || {};
    var evRows = ALERT_EVENTS.map(function (a) { var on = ev[a[0]] !== false && (a[0] === 'result' ? ev[a[0]] !== false : ev[a[0]] === true || (a[0] === 'result')); on = a[0] === 'result' ? (ev[a[0]] !== false) : (ev[a[0]] === true); return '<div class="gx-altrow"><span class="gx-altl">' + ic(a[1]) + esc(t(a[2])) + '</span><button class="gx-toggle' + (on ? ' on' : '') + '" data-alert-ev="' + a[0] + '"><i></i></button></div>'; }).join('');
    var chRows = ALERT_CHANNELS.map(function (a) { var soon = a[3]; var on = a[0] === 'email' ? (ch.email !== false) : ch[a[0]] === true; return '<div class="gx-altrow"><span class="gx-altl">' + ic(a[1]) + esc(t(a[2])) + (soon ? ' <span class="gx-dim" style="font-size:10px">' + esc(t('al_soon')) + '</span>' : '') + '</span><button class="gx-toggle' + (on ? ' on' : '') + (soon ? ' off' : '') + '"' + (soon ? ' disabled' : ' data-alert-ch="' + a[0] + '"') + '><i></i></button></div>'; }).join('');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:680px">' + viewHead(t('nav_alerts')) +
      '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('al_events')) + '</span></div><div class="gx-mod-body" style="gap:2px">' + evRows + '</div></div>' +
      '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('al_channels')) + '</span></div><div class="gx-mod-body" style="gap:2px">' + chRows + '</div></div>' +
      '<p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('al_note')) + '</p></div></div>';
    [].forEach.call(mv.querySelectorAll('[data-alert-ev]'), function (b) { b.addEventListener('click', function () { toggleAlert('events', b.getAttribute('data-alert-ev'), b); }); });
    [].forEach.call(mv.querySelectorAll('[data-alert-ch]'), function (b) { b.addEventListener('click', function () { toggleAlert('channels', b.getAttribute('data-alert-ch'), b); }); });
  }
  function toggleAlert(kind, key, btn) {
    if (!S.me) return; var p = S.me.alertPrefs || (S.me.alertPrefs = { events: {}, channels: {} }); var bag = p[kind] || (p[kind] = {});
    var cur = key === 'result' || (kind === 'channels' && key === 'email') ? bag[key] !== false : bag[key] === true;
    bag[key] = !cur; btn.classList.toggle('on', !cur);
    var payload = {}; payload[kind] = bag;
    fetch('/api/alertprefs', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify(payload) }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (res) { if (res && res.alertPrefs) S.me.alertPrefs = res.alertPrefs; });
  }
  // ---- Invitar / Referidos ----
  var REF_TIERS = [[1, 'ref_t1'], [3, 'ref_t3'], [5, 'ref_t5'], [10, 'ref_t10']];
  function renderRefer() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (S.refer === undefined) S.refer = null;
    var code = (S.me && S.me.refCode) || null, count = (S.me && (S.me.referrals != null ? (typeof S.me.referrals === 'number' ? S.me.referrals : (S.me.referrals.length || 0)) : 0)) || 0;
    if (!code) {
      fetch('/api/referrals/me', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (st) { if (st) { if (st.code) { S.me = S.me || {}; S.me.refCode = st.code; } if (st.verifiedCount != null) S.me.referrals = st.verifiedCount; if (S.view === 'refer') renderRefer(); } });
    }
    var link = code ? 'https://gpsimulador.com/?ref=' + code : null;
    var nextTier = REF_TIERS.filter(function (x) { return x[0] > count; })[0];
    var progress = nextTier ? Math.min(100, count / nextTier[0] * 100) : 100;
    var tiers = REF_TIERS.map(function (x) { var got = count >= x[0]; return '<div class="gx-tier' + (got ? ' on' : '') + '"><span class="gx-tier-n gx-mono">' + x[0] + '</span><span>' + esc(t(x[1])) + '</span>' + (got ? ic('circle-check') : '') + '</div>'; }).join('');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:680px">' + viewHead(t('nav_refer')) +
      '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body"><div class="gx-ref-count"><b class="gx-mono">' + count + '</b><span class="gx-dim">' + esc(t('ref_verified')) + '</span></div>' +
      '<div class="gx-champbar" style="margin:12px 0"><i style="width:' + progress + '%"></i><span class="gx-mono">' + (nextTier ? count + '/' + nextTier[0] : '★') + '</span></div>' +
      (link ? '<div class="gx-ref-link"><input id="gx-ref-input" readonly value="' + esc(link) + '"><button class="gx-btn" id="gx-ref-copy">' + ic('copy') + ' ' + esc(t('ref_copy')) + '</button></div>' : '<div class="gx-dim">' + esc(t('loading')) + '</div>') +
      '<p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('ref_rule')) + '</p></div></div>' +
      '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('ref_tiers')) + '</span></div><div class="gx-mod-body gx-tiers">' + tiers + '</div></div>' +
      '</div></div>';
    var cp = $('#gx-ref-copy'); if (cp) cp.addEventListener('click', function () { var inp = $('#gx-ref-input'); if (inp) { inp.select(); try { document.execCommand('copy'); } catch (e) {} try { navigator.clipboard.writeText(inp.value); } catch (e) {} cp.innerHTML = ic('check') + ' ' + esc(t('ref_copied')); } });
  }
  // ---- Rendimiento (métricas verificadas) ----
  function renderPerf() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (S.perf === undefined) {
      S.perf = null; mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_perf')) + mvLoading() + '</div></div>';
      var isAdm = !!(S.me && S.me.isAdmin);
      Promise.all([fetch('/api/metrics/summary', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }), fetch('/api/aciertos', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }), isAdm ? fetch('/api/internal/daily-picks', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }) : Promise.resolve(null)]).then(function (res) { S.perf = { sum: res[0], leg: res[1], picks: res[2] }; if (S.view === 'perf') renderPerf(); });
      return;
    }
    var d = S.perf || {}, sum = d.sum, leg = d.leg;
    var kpi = function (label, v, cls, sub) { return '<div class="gx-panel gx-kpi"><div class="gx-label">' + esc(label) + '</div><div class="gx-kpi-main"><div class="gx-kpi-sel gx-mono ' + (cls || '') + '">' + v + '</div></div>' + (sub ? '<div class="gx-kpi-sub gx-dim">' + esc(sub) + '</div>' : '') + '</div>'; };
    var body = '';
    // ===== Rendimiento de PICKS (solo admin): track record completo de las picks del producto (acertó/falló, ROI). =====
    var pk = d.picks;
    if (pk && pk.track_record) {
      var tr = pk.track_record, ov = tr.overall || {};
      var pctc = function (v) { return v != null ? Math.round(v * 100) + '%' : '—'; };
      var sgn = function (v, suf) { return v != null ? (v > 0 ? '+' : '') + v + (suf || '') : '—'; };
      body += '<div class="gx-ph" style="margin-bottom:8px"><span class="gx-label">' + ic('target-arrow') + esc(t('pp_title')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:11px">' + (ov.settled || 0) + ' ' + esc(t('pp_settled').toLowerCase()) + ' · ' + (tr.active || 0) + ' ' + esc(t('pp_active')) + '</span></div>';
      body += '<div class="gx-kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">' +
        kpi(t('pp_settled'), ov.settled != null ? ov.settled : '—', '') +
        kpi(t('pp_hit'), pctc(ov.hit_rate), 'gx-pos', ov.settled ? (ov.wins || 0) + '/' + ov.settled : '') +
        kpi(t('pp_roi'), sgn(ov.roi_pct, '%'), (ov.roi_pct >= 0 ? 'gx-pos' : 'gx-neg')) +
        kpi(t('pp_pnl'), sgn(ov.pnl_u, 'u'), (ov.pnl_u >= 0 ? 'gx-pos' : 'gx-neg')) + '</div>';
      var fams = tr.by_family || {};
      var famRows = Object.keys(fams).map(function (f) { var v = fams[f]; return '<span>' + esc(f) + ' <b>' + (v.wins || 0) + '/' + (v.n || 0) + '</b> (' + pctc(v.hit_rate) + ' · ROI ' + (v.roi_pct != null ? v.roi_pct + '%' : '—') + ')</span>'; }).join('');
      if (famRows) body += teamPanel('layout-grid', t('pp_byfam'), '<div class="gx-form-stats">' + famRows + '</div>');
      var settled = (pk.picks || []).filter(function (p) { return p.status === 'SETTLED' && p.result_code !== 'SUPERSEDED'; }).sort(function (a, b) { return new Date(b.settled_at || 0) - new Date(a.settled_at || 0); });
      if (settled.length) {
        var prows = settled.map(function (p) {
          var hh = teamName(p.event.home_team_id, p.event.home), aa = teamName(p.event.away_team_id, p.event.away);
          var betTxt = p.family === 'SOLID' ? t('pf_wins', { team: p.selection_code === 'home' ? hh : aa })
            : p.family === 'GOALS' ? (p.side === 'over' ? t('pf_over', { line: p.line }) : t('pf_under', { line: p.line }))
            : (p.legs || []).map(function (l) { return l.type === '1X2' ? t('pf_wins', { team: l.selection === 'home' ? hh : aa }) : (l.side === 'over' ? t('pf_over', { line: l.line }) : t('pf_under', { line: l.line })); }).join(' + ');
          var res = p.result_code === 'WIN' ? '<span class="gx-pos" style="font-weight:700">✓ WIN</span>' : p.result_code === 'LOSS' ? '<span class="gx-neg" style="font-weight:700">✗ LOSS</span>' : '<span class="gx-dim" style="font-size:11px">' + esc(p.result_code || '—') + '</span>';
          var famChip = '<span class="gx-badge" style="font-size:9.5px">' + esc(t(p.family === 'SOLID' ? 'pf_fam_solid' : p.family === 'GOALS' ? 'pf_fam_goals' : 'pf_fam_combo')) + '</span>';
          return '<tr class="gx-row"><td class="gx-time l">' + esc(fmtDate(p.settled_at)) + '</td><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(p.event.home_team_id) + '</span><b>' + esc(hh) + '</b><span class="gx-dim" style="margin:0 3px">' + esc(t('vs')) + '</span><span class="fl">' + flag(p.event.away_team_id) + '</span><b>' + esc(aa) + '</b></div></td><td class="l">' + famChip + ' <span style="font-size:12px">' + esc(betTxt) + '</span></td><td class="gx-mono">' + (p.best_odds != null ? Number(p.best_odds).toFixed(2) : '—') + '</td><td>' + res + '</td></tr>';
        }).join('');
        body += '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('pp_history')) + '</span><span class="gx-ph-extra">' + settled.length + '</span></div><div class="gx-perf-scroll"><table class="gx-table"><thead><tr><th class="l">' + esc(t('th_time')) + '</th><th class="l">' + esc(t('th_match')) + '</th><th class="l">' + esc(t('pp_pick')) + '</th><th>' + esc(t('reg_odds')) + '</th><th>' + esc(t('perf_result')) + '</th></tr></thead><tbody>' + prows + '</tbody></table></div></div>';
      } else {
        body += '<div class="gx-panel"><div class="gx-empty">' + ic('target-arrow') + '<b>' + esc(t('pp_none')) + '</b></div></div>';
      }
      body += '<div class="gx-ph" style="margin:20px 0 8px"><span class="gx-label">' + ic('chart-line') + esc(t('pp_model')) + '</span></div>';
    }
    // % de aciertos (como la plataforma principal): predicción 1X2 acertada / total evaluado
    if (leg && leg.total) {
      var pctW = Math.round((leg.winners || 0) / leg.total * 100);
      body += '<div class="gx-kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
        kpi(t('perf_hitrate'), pctW + '%', 'gx-pos', (leg.winners || 0) + '/' + leg.total) +
        kpi(t('perf_exact'), (leg.exact != null ? leg.exact : '—') + (leg.total ? ' · ' + Math.round((leg.exact || 0) / leg.total * 100) + '%' : ''), '') +
        kpi(t('perf_total'), leg.total != null ? leg.total : '—', '') + '</div>';
    }
    if (sum && sum.metrics) {
      var m = sum.metrics, g = function (k) { return m[k] && m[k].value != null ? m[k].value : null; }, n = (m.brier_multiclass && m.brier_multiclass.sample_size) || 0;
      body += '<div class="gx-kpis" style="grid-template-columns:repeat(4,1fr)">' + kpi(t('perf_sample'), n) + kpi('Brier', g('brier_multiclass') != null ? g('brier_multiclass').toFixed(3) : '—') + kpi('Log loss', g('log_loss') != null ? g('log_loss').toFixed(3) : '—') + kpi('ECE', g('ece') != null ? g('ece').toFixed(3) : '—') + '</div>' +
        (n < 10 ? '<p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('reg_insufficient_note')) + '</p>' : '') +
        teamPanel('book', t('perf_method'), '<p class="gx-method-p gx-dim">' + esc(t('perf_method_b')) + '</p>');
    }
    if (leg && leg.vsMarket) {
      body += teamPanel('arrows-left-right', t('perf_vs_market'), '<div class="gx-form-stats"><span>GP Brier <b>' + Number(leg.vsMarket.modelBrier).toFixed(3) + '</b></span><span>' + esc(t('hero_mkt')) + ' Brier <b>' + Number(leg.vsMarket.marketBrier).toFixed(3) + '</b></span><span>n <b>' + leg.vsMarket.n + '</b></span></div>');
    }
    if (!body) body = '<div class="gx-panel"><div class="gx-empty">' + ic('chart-line') + '<b>' + esc(t('na_short')) + '</b></div></div>';
    // tabla completa de TODOS los partidos evaluados (data acumulada)
    var matches = (leg && leg.matches) || [];
    if (matches.length) {
      var ms = matches.slice().sort(function (a, b) { return new Date(b.datetime || 0) - new Date(a.datetime || 0); });
      var rows = ms.map(function (m) {
        var sc = (m.hg != null && m.ag != null) ? (m.hg + '-' + m.ag) : '—';
        if (m.pens) sc += ' <span class="gx-dim" style="font-size:10.5px">(' + m.pens.home + '-' + m.pens.away + ' ' + esc(t('pens_short')) + ')</span>';
        else if (m.decided === 'et') sc += ' <span class="gx-dim" style="font-size:10.5px">(' + esc(t('decided_et')) + ')</span>';
        var winTag = (m.ko && m.winner) ? '<div class="gx-dim" style="font-size:10.5px">' + esc(t('won_by', { team: teamName(m.winner) })) + '</div>' : '';
        var predName = m.predicted === 'draw' ? (LANG === 'en' ? 'Draw' : 'Empate') : teamName(m.predicted === 'away' ? m.away : m.home);
        return '<tr class="gx-row" data-openmatch="fx-' + esc(m.id) + '"><td class="gx-time l">' + esc(fmtDate(m.datetime)) + '</td>' +
          '<td class="l"><div class="gx-cell-team"><span class="fl">' + flag(m.home) + '</span><b>' + esc(teamName(m.home)) + '</b><span class="gx-dim" style="margin:0 4px">' + esc(t('vs')) + '</span><span class="fl">' + flag(m.away) + '</span><b>' + esc(teamName(m.away)) + '</b></div>' + winTag + '</td>' +
          '<td class="gx-mono" style="font-weight:600">' + sc + '</td>' +
          '<td class="l gx-dim">' + esc(predName) + ' <span class="gx-mono">' + pct0(m.predictedProb) + '</span></td>' +
          '<td class="l">' + (m.exact ? '<span class="gx-badge gx-b-strong">' + esc(t('perf_exact')) + '</span>' : m.correct ? '<span class="gx-pos" style="font-size:11.5px;font-weight:600">' + esc(t('perf_hit')) + '</span>' : '<span class="gx-neg" style="font-size:11.5px;font-weight:600">✗</span>') + '</td></tr>';
      }).join('');
      body += '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('perf_matches')) + '</span><span class="gx-ph-extra">' + matches.length + '</span></div><div class="gx-perf-scroll"><table class="gx-table"><thead><tr><th class="l">' + esc(t('th_time')) + '</th><th class="l">' + esc(t('th_match')) + '</th><th>' + esc(t('perf_result')) + '</th><th class="l">' + esc(t('perf_predicted')) + '</th><th class="l">' + esc(t('perf_hit')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_perf')) + body + '</div></div>';
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
    var rr = { match: renderMatch, matches: renderMatches, sim: renderSim, teams: renderTeams, team: renderTeam, groups: renderGroups, bracket: renderBracket, evo: renderEvo, registry: renderRegistry, method: renderMethod, admin: renderAdmin, follow: renderFollow, alerts: renderAlerts, refer: renderRefer, perf: renderPerf };
    if (rr[S.view]) { applyView(); rr[S.view](); }
  }

  // Construye S.cal/S.fixtures desde /api/state (boot Y refresco en vivo). gpProbs = prob GP en vivo del server.
  function ingestState(st) {
    if (!st) return;
    if (st.teams) { S.stTeams = st.teams; st.teams.forEach(function (tm) { if (tm.id && tm.flag) FLAGS[tm.id] = tm.flag; }); }
    S.groups = st.groups || []; S.standings = st.standings || {}; S.knockoutRaw = st.knockout || []; S.history = st.history || [];
    S.cal = []; S.fixtures = [];
    (st.fixtures || []).forEach(function (f) {
      if (f.home && f.away) S.fixtures.push({ id: f.id, home: f.home, away: f.away, date: (f.datetime || '').slice(0, 10) });
      S.cal.push({ id: f.id, kind: 'group', home: f.home, away: f.away, datetime: f.datetime, stage: 'group', status: f.result ? f.result.status : 'scheduled', score: f.result ? { home: f.result.hg, away: f.result.ag } : null, minute: f.result ? f.result.minute : null, probs: f.probs || null, gpProbs: f.gpProbs || null, pending: false });
    });
    (st.knockout || []).forEach(function (k) {
      var h = (k.resolved && k.resolved.home) || (k.result && k.result.home), a = (k.resolved && k.resolved.away) || (k.result && k.result.away);
      if (h && a) S.fixtures.push({ id: String(k.m), home: h, away: a, date: ((k.datetime || k.date || '') + '').slice(0, 10) });
      S.cal.push({ id: String(k.m), kind: 'ko', home: h, away: a, datetime: k.datetime || (k.date ? k.date + 'T18:00:00Z' : null), stage: k.stage, status: k.result ? k.result.status : 'scheduled', score: k.result ? { home: k.result.hg, away: k.result.ag } : null, minute: k.result ? k.result.minute : null, probs: k.probs || null, gpProbs: k.gpProbs || null, pending: !(h && a) });
    });
  }
  function anyLive() { return (S.cal || []).some(function (c) { return c.status === 'live'; }); }
  // Refresco EN VIVO (premium no tenía polling → nada se movía). Cada 25s: re-trae el estado (marcadores + prob
  // GP en vivo) y re-renderiza la vista actual; si hay un partido EN VIVO abierto, refresca su cockpit (fx+beta).
  function refreshLive() {
    fetch('/api/state', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (st) {
      if (!st) return;
      var wasLive = anyLive();
      ingestState(st);
      var live = anyLive();
      if (!live && !wasLive && S.view !== 'match') return; // nada que mover
      if (S.view === 'matches') renderMatches();
      else if (S.view === 'opps' || S.view === 'board') load();
      // cockpit de un partido abierto: re-fetch SILENCIOSO del fx (trae marcador/eventos/gpLive) → re-render sin flash
      if (S.view === 'match' && S.matchId) {
        var mid = S.matchId;
        if (/^fx-/.test(mid)) {
          var fxid = mid.slice(3);
          fetch('/api/match/' + encodeURIComponent(fxid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { if (m && S.view === 'match' && S.matchId === mid) { S.mfix[fxid] = m; renderMatch(); } });
        } else {
          var beta = S.mc[mid];
          var fid = (beta && beta.header) ? fixtureIdFor(beta.header) : null;
          if (fid != null) fetch('/api/match/' + encodeURIComponent(fid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { if (m && S.view === 'match' && S.matchId === mid) { S.mfix[fid] = m; renderMatch(); } });
        }
      }
    });
  }
  function startLiveLoop() { if (S._liveTimer) return; S._liveTimer = setInterval(function () { try { refreshLive(); } catch (e) {} try { if ((S.view === 'board' || S.view === 'opps') && S.oppSub === 'arb') refreshArbSilent(); } catch (e) {} }, 25000); }

  // ---------- boot ----------
  function boot() {
    fetch('/api/i18n').then(function (r) { return r.json(); }).then(function (j) {
      TEAMS = j.teams || {};
    }).catch(function () {}).then(function () {
      // flags desde el estado global (si el server los expone) — si no, fallback vacío (los nombres igual van).
      fetch('/api/state', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (st) {
        ingestState(st);
        var pref; try { pref = localStorage.getItem('gp_lang'); } catch (e) {}
        LANG = (pref === 'en' || pref === 'es') ? pref : ((navigator.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es');
        document.documentElement.lang = LANG;
        shell(); load(); loadCanon(); startLiveLoop();
        fetch('/api/me', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (me) {
          // Guard: /x es la plataforma nueva para usuarios CON acceso beta (o admin). Si alguien sin acceso entra
          // manualmente a /x, lo devolvemos a la plataforma actual (no debe quedar atrapado con datos gateados).
          if (!me || (!me.beta_access && !me.isAdmin)) { if (!/[?&]noredir=1/.test(location.search)) { location.replace('/'); return; } }
          if (me) { S.me = me; syncAdminUI(); if (['registry', 'method', 'admin'].indexOf(S.view) >= 0 && !me.isAdmin) { showView('board'); } else if (['follow', 'alerts', 'refer'].indexOf(S.view) >= 0) { applyView(); ({ follow: renderFollow, alerts: renderAlerts, refer: renderRefer }[S.view] || function () {})(); } }
        });
        document.addEventListener('click', function (e) {
          var mo = e.target.closest('[data-more]'); if (mo) { e.preventDefault(); openMoreSheet(); return; }
          var cb = e.target.closest('[data-calc]'); if (cb) { e.preventDefault(); e.stopPropagation(); toggleCalc(cb); return; }
          var o = e.target.closest('[data-openmatch]'); if (o) { e.preventDefault(); S.arbCtx = null; S.pendingSec = o.getAttribute('data-cock-sec') || null; openMatch(o.getAttribute('data-openmatch')); return; }
          var ff = e.target.closest('[data-follow]'); if (ff) { e.preventDefault(); e.stopPropagation(); toggleFollow(ff.getAttribute('data-follow')); return; }
          var tt = e.target.closest('[data-nav-team]'); if (tt) { e.preventDefault(); openTeam(tt.getAttribute('data-nav-team')); return; }
          var n = e.target.closest('[data-nav]'); if (n) { e.preventDefault(); navTo(n.getAttribute('data-nav')); }
        });
        window.addEventListener('hashchange', onHash); onHash();
      });
    });
  }
  boot();
})();
