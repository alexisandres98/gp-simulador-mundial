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
      sub_nav: 'Mi suscripción', sub_title: 'Mi suscripción', sub_plan: 'Plan actual', sub_founder: 'FOUNDER', sub_status: 'Estado',
      sub_active: 'Activa', sub_cancelled: 'Cancelada', sub_pastdue: 'Pago pendiente', sub_since: 'Miembro desde',
      sub_free_note: 'Acceso completo gratis durante el Mundial. Los planes llegan pronto — los primeros 100 tendrán precio founder de por vida.',
      sub_upgrade: 'Ver planes', fb_lead: 'Founder Pass abierto', fb_sub: 'Precio de por vida, solo mientras dure el Mundial', fb_spots: 'Quedan {n} de 100', fb_close: 'Cierra con la final en {t}', fb_cta: 'Asegurar el mío', sub_up_sharp: 'Mejorar a Sharp', sub_cancel: 'Cancelar suscripción', sub_cancelled_note: 'Tu suscripción está cancelada. Mantienes el acceso hasta el fin del ciclo pagado.', cx_title: 'Cancelar suscripción', cx_step1: '¿Seguro que querés cancelar? Perderás el acceso a las picks y al análisis al terminar el ciclo actual. Por seguridad te enviaremos un código a tu correo para confirmar.', cx_keep: 'Mantener mi plan', cx_yes: 'Sí, quiero cancelar', cx_step2: 'Te enviamos un código a tu correo. Ingresalo para confirmar la cancelación.', cx_confirm: 'Confirmar cancelación', cx_code_bad: 'Ingresá el código de 6 dígitos.', cx_err: 'Algo salió mal. Intentá de nuevo.', cx_close: 'Cerrar', cx_done: 'Suscripción cancelada.', cx_done_clean: 'Listo: no se te volverá a cobrar. Mantienes el acceso hasta el fin del ciclo pagado.', cx_done_note: 'No se te volverá a cobrar. Para detener el pago recurrente, cancelá también desde tu cuenta de Whop.', cx_whop: 'Ir a mi cuenta de Whop', sub_manage: 'Gestionar suscripción', sub_manage_soon: 'Disponible al lanzar los pagos',
      sub_asplan: 'Ver la plataforma como (solo admin)', sub_asplan_real: 'Real',
      sup_nav: 'Soporte', sup_title: 'Soporte', sup_intro: 'Contanos tu problema o consulta y te respondemos por email, normalmente dentro de 24 horas.',
      sup_subject: 'Asunto (opcional)', sup_msg: 'Tu mensaje', sup_msg_ph: 'Escribí acá tu consulta…', sup_send: 'Enviar',
      sup_sent: 'Mensaje enviado — te respondemos a tu email. También podés escribirnos a soporte@gpsimulador.com.',
      sup_err: 'No se pudo enviar, probá de nuevo.', sup_short: 'Contanos un poco más para poder ayudarte.', sup_rate: 'Demasiados mensajes seguidos; probá en un rato.',
      lock_sharp_t: 'Disponible en el plan Sharp', lock_sharp_s: 'Value y arbitraje en tiempo real son parte del plan Sharp.',
      lock_bets_s: 'Mi cartera —tu P&L, ROI y CLV personal— es parte del plan Sharp.',
      lock_style_s: 'El perfil táctico (event data remate a remate) es parte del plan Sharp.',
      lock_pro_t: 'Disponible desde el plan Pro', lock_pro_s: 'La proyección de goles de cada partido es parte de los planes Pro y Sharp.',
      lock_player_s: 'Los perfiles de jugador con radar de scouting y proyecciones son parte de los planes Pro y Sharp.',
      lock_calc_s: 'La calculadora de stake con gestión de bankroll es parte de los planes Pro y Sharp.',
      onb_1t: 'Las picks del día', onb_1s: 'El modelo publica jugadas verificadas cada día en 24 ligas, con historial público de aciertos y errores. Tu pick gratis diaria te espera en el board.',
      onb_2t: 'Cada partido, a fondo', onb_2s: 'Entrá a cualquier partido: probabilidades en vivo, goles esperados, alineaciones, bajas y contexto. Un cockpit de análisis completo.',
      onb_3t: 'Value y Arbitraje', onb_3s: 'El escáner compara 40+ casas en tiempo real y encuentra cuotas que pagan de más y jugadas cubiertas entre casas.',
      onb_4t: 'Mi cartera', onb_4s: 'Registrá tus apuestas y mirá tu rendimiento real: ganancia, ROI y racha, todo en un solo lugar.',
      onb_sharp: 'Disponible en Sharp',
      onb_next: 'Siguiente', onb_done: '¡Listo, empezar!', onb_skip: 'Saltar',
      adm_ana: 'ACTIVIDAD · RETENCIÓN', adm_ana_today: 'Activos hoy', adm_ana_d1: 'Retención D1', adm_ana_d7: 'Retención D7', adm_ana_hab: 'Vuelven a diario (4+ de 7 días)', adm_ana_since: 'Midiendo desde', adm_ana_nodata: 'Acumulando datos — las métricas maduran con los días.',
      lock_more_picks: '{n} picks más hoy', lock_more_picks_s: 'Disponibles en los planes Pro y Sharp.',
      lock_delay: 'La pick gratis del día se desbloquea 60 minutos antes del partido.',
      lock_picks_t: 'Las picks de hoy son para suscriptores', lock_picks_s: 'Suscribite para ver las picks del día del modelo. No es que no haya picks — están en Pro y Sharp.',
      lock_cta: 'Ver planes',
      wp_title: 'Tu primera pick gratis', wp_sub: 'Nuestra selección más segura de hoy — bienvenido a GP Simulador.', wp_dismiss: 'Descartar',
      frb_lead: 'Estás en el plan Free', frb_sub: 'Desbloqueá todas las picks del día, el cockpit en vivo y las herramientas.', frb_cta: 'Ver planes',
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
      memo: 'Decision memo', conf: 'Confianza', conf_hi: 'Alta', conf_mid: 'Media', conf_lo: 'Baja', conf_na: 'Sin evaluar',
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
      ck_choose: 'Elegí un partido', ck_over25: 'Over 2.5', ck_todaypick: 'Pick del día',
      reg90: '90 min · sin prórroga ni penales', updated_short: 'Actualizado',
      sig_strong: 'STRONG', sig_lean: 'LEAN', sig_watch: 'WATCH', sig_pass: 'PASS',
      comp: 'Copa Mundial de la FIFA 2026', none_active_pick: 'No hay Picks GP activas en este momento.',
      below_min: 'El precio actual está por debajo de la cuota mínima requerida.', below_min_short: 'Bajo mínimo', min_odds: 'Cuota mínima', cur_price: 'Mejor precio',
      cta_pick: 'Ver pick GP', cta_value: 'Ver oportunidad', cta_analysis: 'Ver análisis completo', cta_analyze: 'Analizar partido', cta_view_match: 'Ver partido', cta_arb: 'Ver arbitraje', cta_state: 'Ver estado',
      unc_copy: 'Las estimaciones internas no convergen del todo en este partido.',
      thesis_price_only: 'La diferencia proviene sobre todo del precio: el contexto disponible no aporta evidencia suficiente para sostener una lectura más fuerte.',
      thesis_ctx2: 'GP apoya su lectura en {factors}.',
      e_na: 'Datos no disponibles', e_nomarket: 'Mercado no cargado', e_lineups: 'Alineación pendiente', e_partial: 'Contexto parcial', e_noprice: 'Cuota no disponible ahora', e_gp_na: 'GP Intelligence no disponible', e_stale: 'Datos desactualizados',
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
      prob_base_only: 'La evaluación de contexto GP para este partido aún no se generó; se muestra la probabilidad base del modelo GP. El contexto disponible (forma, bajas, alineaciones) está en la pestaña Contexto.',
      drivers: 'Factores que movieron la línea', evaluated: 'Factores evaluados', impact: 'Impacto', confidence: 'Confianza', evidence: 'Evidencia', freshness: 'Frescura',
      evaluated_note: 'Estos factores se evaluaron; su efecto está reflejado en el ajuste neto de contexto, no como un impacto aislado por factor.',
      fac_favors: 'a favor', fac_against: 'en contra', fac_neutral: 'neutral',
      ev_fact: 'Dato', ev_inference: 'Inferencia',
      tl_title: 'Línea de tiempo', tl_now: 'Estado actual', tl_base_gp: 'Base → Probabilidad GP',
      tl_empty: 'Aún no hay snapshots previos registrados para este partido. Los cambios de probabilidad, precio, noticias y alineaciones se registrarán a partir de ahora.',
      mkt_sb: 'Casas de apuestas', mkt_sb_best: 'Mejor precio por casa', mkt_ex: 'Exchange', mkt_pm: 'Prediction markets',
      col_provider: 'Fuente', col_outcome: 'Resultado', col_odds: 'Cuota', col_implied: 'Implícita', col_novig: 'Sin margen', col_move: 'Movimiento', col_liq: 'Liquidez', col_fresh: 'Frescura', na_short: 'No disponible', move_na: 'Aún sin registro',
      mkt_none: 'Sin mercados cargados para este partido todavía.', move_untracked: 'El movimiento de precio aún no se registra para estas fuentes.', novig_na: 'Requiere el set completo de resultados.',
      ctx_none: 'Sin contexto verificado disponible para este partido todavía.', ctx_form: 'Forma reciente', ctx_inj: 'Bajas y disponibilidad', ctx_lineups: 'Alineaciones',
      ctx_form_line: '{team} llega con {rec} en sus últimos {n} ({gf} a favor, {ga} en contra).', ctx_form_line_short: '{team} llega con {rec} en sus últimos {n}.', ctx_inj_line: '{team}: {players}.', no_inj: 'sin bajas reportadas',
      goals_tag: 'En validación', goals_disc: 'Proyección estadística del modelo, en validación. No es una Pick ni un Value; sin recomendación de apuesta.',
      g_xg: 'xG esperado', g_total: 'Total esperado', g_ou: 'Más / Menos', g_btts: 'Ambos anotan', g_scores: 'Marcadores más probables', g_over: 'Más', g_under: 'Menos', g_yes: 'Sí', g_no: 'No', goals_none: 'Sin proyección de goles disponible.',
      g_dist: 'Distribución de goles', g_margin: 'Margen de victoria', g_combos: 'Combinaciones', g_either2: 'Cualquiera gana por 2+', g_team_by2: '{team} por 2+', g_draw: 'Empate', g_team_wino25: '{team} gana y +2.5', g_wintonil: 'Cualquiera gana a cero', g_team_cs: '{team} valla invicta', g_push: 'empuje', g_home: 'Local', g_away: 'Visitante',
      live_min: 'Minuto', live_events: 'Eventos', live_stats: 'Estadísticas', live_prob: 'Probabilidad en vivo (modelo)', live_none: 'No hay datos en vivo verificados para este partido.',
      live_stale: 'Datos en vivo posiblemente desactualizados; pueden no reflejar el estado actual.',
      live_ctx_red: 'Probabilidad en vivo ajustada por tarjeta roja ({team}).',
      st_possession: 'Posesión', st_shots: 'Remates', st_sot: 'Al arco', st_corners: 'Córners', st_fouls: 'Faltas', st_xg: 'xG', st_offsides: 'Offsides', st_yellow: 'Amarillas',
      mod_form: 'Forma reciente', mod_lineups: 'Alineaciones', mod_stats: 'Estadísticas',
      mod_xg: 'xG del partido', xg_total: 'xG total', xg_h1: 'xG 1er tiempo', xg_h2: 'xG 2do tiempo', xg_bigch: 'Ocasiones claras', xg_shots: 'Remates',
      mod_momentum: 'Evolución GP en vivo', mom_note: 'Probabilidad GP de ganar el partido, actualizada durante el juego. Los puntos marcan los goles.', hero_scores: 'Marcadores probables',
      mod_intel: 'Intel del partido', intel_player: 'Jugador', intel_goal: 'Gol', intel_shots: 'Remates', intel_radar: 'Radar de disponibilidad', intel_miss: 'riesgo', intel_out: 'BAJA', intel_susp: 'SANCIÓN', intel_doubt: 'DUDA', intel_rest: 'ROTACIÓN', intel_factor: 'Si las ausencias se confirman, la generación del equipo caería ~{pct}%.', intel_note: 'Probabilidad de anotar y volumen de remates proyectado por jugador, con las alertas de disponibilidad detectadas en fuentes publicadas.', intel_findings: 'Hallazgos de inteligencia',
      pi_role_starter_confirmed: 'Titular confirmado', pi_role_starter_projected: 'Titular probable', pi_role_bench: 'Suplente probable', pi_sample_strong: 'Muestra sólida', pi_sample_thin: 'Muestra corta', pi_rates_elite: 'Producción élite', pi_rates_above_pos: 'Produce sobre su posición', pi_finishing_hot: 'Definición caliente', pi_finishing_cold: 'Definición fría', pi_team_attack_up: 'Ataque del equipo al alza', pi_team_attack_down: 'Ataque del equipo a la baja', pi_avail_out: 'Baja confirmada', pi_avail_susp: 'Sancionado', pi_avail_doubt: 'En duda', pi_avail_unverified: 'Alerta sin confirmar', pi_avail_rest: 'Riesgo de rotación', pi_set_piece_pen: 'Lanzador de penales', pi_set_piece_fk: 'Lanzador de tiros libres', pi_set_piece_corners: 'Lanzador de córners',
      arch_star: 'Estrella', arch_clinical: 'Finalizador', arch_creator: 'Creador', arch_aerial: 'Amenaza aérea', arch_super_sub: 'Revulsivo', arch_engine: 'Motor', arch_set_piece: 'Balón parado',
      ax_production: 'Peligro', ax_volume: 'Remates', ax_accuracy: 'Puntería', ax_creation: 'Creación', ax_finishing: 'Definición', ax_presence: 'Presencia', ax_aerial: 'Aéreo', ax_attack_share: 'Peso ofensivo',
      pp_radar: 'Radar de scouting', pp_radar_sub: 'vs jugadores de su posición', ft_title: 'Destacados de hoy', ft_goal: 'P(gol)',
      pp_empty: 'Perfil no disponible', pp_reading: 'Lectura GP', pp_sample: 'Muestra del torneo', pp_min: 'Minutos', pp_apps: 'Titular/PJ', pp_goals: 'Goles', pp_expmin: 'Min. típicos', pp_per90: 'Producción por 90 minutos', pp_shots: 'Remates', pp_sot: 'Al arco', pp_next: 'Próximo partido · proyección', pp_pgoal: 'P(gol)', pp_proj_shots: 'Remates proy.', pp_proj_min: 'Minutos proy.', pp_form: 'Partido a partido', pp_rival: 'Rival', pp_shots_h: 'REM', pp_sot_h: 'ARCO', pp_goals_h: 'GOL', pp_conf_high: 'Confianza alta', pp_conf_med: 'Confianza media', pp_conf_low: 'Confianza baja', pp_finding: 'Hallazgo de inteligencia', pp_mindist: 'Minutos · distribución', pp_pstart: 'P(titular)', pp_if_start: 'Si titular', pp_if_bench: 'Si banco', pp_p60: '60+ min', pp_p75: '75+ min', pp_p90: '90 min', mi_start_chip: 'tit', sr_players: 'Jugadores', pp_markets: 'Mercados del jugador', pp_market: 'Mercado', pp_best: 'Mejor', pp_implied: 'Implícita', pp_books: 'casas', pp_mk_goal: 'Anota (anytime)', pp_h2h: 'Ante este rival', pp_share: '{pct}% del ataque de su equipo', pp_pctl: 'Top {p}% de su posición',
      form_gf: 'GF', form_ga: 'GC', form_cs: 'Vallas', form_avg: 'Prom.', lineup_subs: 'Suplentes',
      evk_goal: 'Gol', evk_yellow: 'Amarilla', evk_red: 'Roja', evk_subst: 'Cambio', evk_var: 'VAR', evk_other: 'Evento',
      lineup_conf: 'Confirmada', lineup_proj: 'Proyectada', formation: 'Formación', news_title: 'Noticias', match_loading: 'Cargando partido…', match_404: 'No se pudo cargar el análisis de este partido.',
      // ---- Corte 3: Partidos + Simulador ----
      g_today: 'Hoy', g_tomorrow: 'Mañana', m_stage_all: 'Todas las fases', m_search: 'Buscar equipo…', m_empty: 'No hay partidos para este filtro.',
      gp_absent: 'Sin evaluación GP prepartido', gp_absent_sub: 'No se registró una evaluación GP prepartido para este encuentro.',
      gp_absent_final: 'Sin evaluación GP prepartido', gp_absent_final_sub: 'No se registró una evaluación GP prepartido para este encuentro. Se muestran el resultado y los datos del partido.',
      sim_pick: 'Elegí un equipo', sim_swap: 'Intercambiar', sim_go: 'Simular cruce', sim_running: 'Simulando…', sim_hypo: 'Simulación hipotética con el contexto disponible actualmente.', sim_pick_team: 'Elegí un equipo…', sim_no_mix: 'Selecciones y clubes no son comparables entre sí — elegí dos selecciones o dos clubes.',
      sim_empty: 'Elegí dos equipos para simular un cruce.', sim_empty_sub: 'GP cruza ambos con su contexto actual.', sim_err: 'No se pudo simular el cruce.',
      sim_thesis_na: 'Sin lectura disponible para este cruce.', sim_risk_na: 'Sin factores de cambio destacados.', sim_verdict_na: 'Cruce sin favorito neto claro.',
      sim_factors: 'Factores GP', sim_f_applied: 'Pesa', sim_f_neutral: 'Neutral',
      sim_v_even: 'Cruce parejo, sin favorito neto.', sim_v_clear: '{team} es favorito claro.', sim_v_slight: '{team} es ligero favorito.',
      sim_thesis: 'GP da {fav} {favp}, {dog} {dogp} y empate {drawp}.', sim_thesis_factor: 'Pesan {factors}.', sim_risk: 'Una baja de última hora o un cambio de alineación pueden estrechar el margen.',
      sim_price_na: 'No se evalúa precio porque este cruce no corresponde a un mercado programado.', sim_hypo_tag: 'Hipotético', sim_runs: 'escenarios',
      sim_montecarlo: 'Proyección de escenarios GP', sim_avg_goals: 'Goles promedio', sim_totals: 'Distribución de goles',
      sim_goals_disc: 'Proyección de goles en validación. Disponible para análisis; no genera Picks GP ni Value.',
      // ---- Corte 4H: superficies de torneo ----
      group: 'Grupo',
      tm_champion: 'Campeón', tm_final: 'Final', tm_semi: 'Semis', tm_qf: 'Cuartos', tm_advance: 'Avanza',
      tm_sim_note: 'Probabilidades de la proyección GP del torneo con el contexto disponible.',
      tm_next: 'Próximo partido', tm_recent_matches: 'Partidos recientes', tm_vs_home: 'vs (local)', tm_vs_away: 'vs (visita)',
      grp_goals: 'GF:GC', grp_advance: 'Avanza', grp_advance_note: 'Avanza = probabilidad de pasar de fase (1º o 2º).',
      bk_tbd: 'Por definir', bk_reg90: '90 min', bk_note: 'Probabilidad 1X2 a 90 min (no es probabilidad de avanzar).',
      bk_subtitle: 'Cuadro de eliminación · estructura oficial FIFA · desliza para ver todas las rondas',
      slot_gw: '1º Grupo {g}', slot_gr: '2º Grupo {g}', slot_t3: '3º ({groups})', slot_win: 'Ganador P{m}', slot_los: 'Perdedor P{m}',
      evo_insufficient: 'Evolución no disponible todavía', evo_insufficient_sub: 'Aún no hay suficientes snapshots reales ({n}). La evolución se registra a medida que el torneo avanza.',
      evo_champion: 'Probabilidad de campeón', evo_snapshots: 'snapshots', evo_trend: 'Tendencia', evo_now: 'Ahora', evo_top: 'Top 10', evo_note: 'Solo snapshots reales registrados; sin histórico fabricado.',
      evo_club_note: 'Proyección por jornada: prob. de campeón del modelo con la tabla y el calendario restante de cada fecha.',
      reg_picks: 'Picks', reg_settled: 'Liquidadas', reg_winrate: 'Aciertos', reg_sample: 'Muestra', reg_insufficient: 'Insuficiente', reg_history: 'Historial de Picks',
      // ---- Feed de picks diarias (producto) ----
      pf_today: 'Picks del día', pf_count: 'picks activas', pf_count1: 'pick activa', pf_pick_of_day: 'Pick del día', pf_all_by_match: 'Todas las picks por partido',
      pf_corr: 'Son del mismo partido: se resuelven juntas. Para tu stake trátalas como <b>una sola apuesta</b>, no como {n} independientes.',
      cl_wc: 'Mundial 2026', cl_all_comps: 'Todas las competiciones', cl_gate_ok: 'Gate aprobado', cl_gate_sh: 'En calibración', cl_hfa: 'localía',
      cl_states_soon: 'En vivo y finalizados de clubes llegan con la integración de marcadores.',
      cl_preseason: 'La temporada arranca pronto: ratings listos, la liga entra calibrada a su kickoff.',
      cl_value: 'Value vs mercado', cl_neutral: 'cancha neutral',
      cl_value_board: 'Value de clubes por liga', cl_value_board_sub: 'Modelo GP vs consenso del mercado en las ligas en temporada. Informativo: las picks de clubes nacen cuando la liga tiene gate aprobado y el precio confirma.',
      cl_pj: 'PJ', cl_pts: 'Pts', cl_dif: 'DIF', cl_pos: 'Posición', cl_record: 'G-E-P', cl_goals: 'Goles', cl_of: 'de', cl_new: 'NUEVO',
      cl_standings: 'Tabla de posiciones', cl_grp_note: 'Avance = prob. de terminar en zona alta (Top 4) del season sim. Se actualiza cada jornada.', cl_grp_fav: 'Favorito al título:',
      cl_bk_title: 'Playoffs (proyección)', cl_bk_champ: 'Campeón proyectado', cl_bk_winner: 'Ganador', cl_bk_seed: 'Siembra',
      cl_bk_note: 'Bracket proyectado · sembrado por la posición proyectada del season sim · modelo de eliminación a partido único · se actualiza cada jornada.',
      cl_bk_no_playoff: 'Esta competición se define por la tabla de posiciones, sin fase de eliminación.', cl_bk_race: 'Carrera por el título (proyección)',
      cl_bk_soon: 'El bracket proyectado aparece cuando la temporada esté en marcha.',
      cl_upcoming: 'Próximos partidos', cl_no_upcoming: 'Sin partidos programados en la ventana del calendario.',
      cl_live_recent: 'En juego y recientes', cl_no_live: 'Ningún partido de clubes en juego ahora.', cl_no_final: 'Sin partidos finalizados recientes.',
      cl_clubs: 'Clubes',
      cl_squad: 'Plantilla', cl_no_squad: 'Plantilla no disponible.', cl_gk: 'Arqueros', cl_def: 'Defensas', cl_mid: 'Mediocampistas', cl_fwd: 'Delanteros', cl_yr: ' años',
      cl_age: 'Edad', cl_height: 'Altura', cl_foot: 'Pie', cl_nat: 'País', cl_contract: 'Contrato', cl_nat_team: 'Selección',
      cl_foot_l: 'Izquierdo', cl_foot_r: 'Derecho', cl_foot_b: 'Ambos',
      cl_player_soon: 'Estadísticas por 90 minutos, radar y arquetipo del jugador llegan con la ingesta de datos por partido de la liga.',
      cl_profile: 'Perfil del jugador', cl_apps: 'partidos', cl_stats90: 'Estadísticas por 90 minutos', cl_shots90: 'Remates/90', cl_sot90: 'Al arco/90',
      cl_ga: 'Goles / Asistencias', cl_att_share: '% del ataque', cl_scout: 'Lectura de scouting',
      cl_markets: 'Mercados del partido', cl_best_odds: 'mejor cuota entre casas',
      cl_intel: 'Inteligencia del partido', cl_anytime: 'prob. de marcar',
      cl_top: 'Top', cl_of_pos: 'de su posición', cl_minutes: 'Minutos', cl_startsapps: 'Titular/PJ', cl_goals: 'Goles',
      cl_mbm: 'Partido a partido', cl_date: 'Fecha', cl_opp: 'Rival', cl_sh: 'REM', cl_g: 'G',
      cl_tab_summary: 'Resumen', cl_tab_form: 'Forma', cl_tab_results: 'Resultados', cl_no_results: 'Sin resultados registrados.', cl_no_news: 'Sin novedades de disponibilidad por ahora.', cl_local: 'Cond.', cl_score: 'Marc.', cl_home_h: 'L', cl_away_a: 'V',
      cl_season: 'Proyección de temporada', cl_champion: 'Campeón', cl_top: 'Top', cl_proj_finish: 'Posición proy.', cl_releg: 'Descenso', cl_title_race: 'Lucha por el título', cl_remaining: 'partidos restantes', cl_season_note: 'Simulación de los partidos que faltan (calendario reconstruido) con la fuerza actual. Se actualiza cada jornada.',
      cl_no_markets: 'Sin cuotas disponibles para este partido.', cl_h2h: 'Enfrentamientos directos', cl_no_lineups: 'Alineación no publicada aún (llega cerca del partido).', nav_lineups: 'Alineaciones',
      nav_context: 'Contexto', cl_no_context: 'Contexto no disponible.', cl_injuries: 'Bajas y lesiones', cl_no_injuries: 'Sin bajas reportadas.', cl_rest: 'Descanso', cl_days: 'días', cl_context_sub: 'Bajas de API-Football, descanso, forma y hallazgos de disponibilidad de la capa de observación.', cl_ctx_applied: 'Contexto aplicado (disponibilidad)', cl_ctx_base: 'base',
      cl_cross: 'Cruce entre ligas: cada liga se calibra por separado, la comparación es aproximada (sin ajuste inter-liga todavía).',
      cl_note_ctx: 'Fase clubes en construcción: contexto, alineaciones, jugadores y picks por liga llegan tras sus gates. Este análisis usa el núcleo del modelo (ratings + proyección de goles).',
      cl_xg: 'xG esperado', cl_o25: 'Más de 2.5 goles', cl_btts: 'Ambos anotan', cl_scores: 'Marcadores más probables',
      pf_empty: 'No hay picks activas ahora mismo', pf_empty_sub: 'Las picks del día aparecen aquí en cuanto se publican. Vuelve pronto.',
      pf_yesterday: 'Ayer: {won} de {total} picks acertadas', pf_next_ko: 'El próximo partido es a las {time} — las picks salen unas horas antes',
      pf_fam_solid: 'Ganador', pf_fam_goals: 'Goles', pf_fam_combo: 'Combinada',
      pf_fam_corners: 'Córners', pf_fam_cards: 'Tarjetas', pf_fam_player: 'Jugador',
      pf_over_corners: 'Más de {line} córners', pf_under_corners: 'Menos de {line} córners',
      pf_over_cards: 'Más de {line} tarjetas', pf_under_cards: 'Menos de {line} tarjetas',
      pf_player_goal: '{player} anota', pf_player_shots: '{player}: más de {line} remates', pf_player_sot: '{player}: más de {line} al arco', pf_player_assist: '{player}: da una asistencia',
      pf_wins: 'Gana {team}', pf_dc: '{team} o empate (doble oportunidad)', pf_over: 'Más de {line} goles', pf_under: 'Menos de {line} goles',
      pf_conf: 'Confianza', pf_conf_high: 'Alta', pf_conf_med: 'Media', pf_conf_low: 'Moderada', ps_win: 'Prob. de acierto', pf_corr_calc: 'Correlación {rho}× medida en la matriz de marcadores → si tomás ambas, stake total sugerido ≈ {pct}% de la suma individual.', ps_edge: 'Edge', ps_data: 'Datos', ps_quality: 'Calidad', ps_dc_low: 'Baja', ps_q_strong: 'Fuerte', ps_q_moderate: 'Moderada', ps_q_marginal: 'Marginal', ps_stake: 'Stake sug.',
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
      adm_fix_group: 'Corregir partido · Fase de grupos', adm_fix_ko: 'Corregir partido · Eliminación directa',
      adm_match: 'Partido', adm_bracket: 'Llave', adm_goals_h: 'Goles equipo 1', adm_goals_a: 'Goles equipo 2', adm_status: 'Estado', adm_st_final: 'Terminado', adm_st_live: 'En juego', adm_minute: 'Minuto', adm_team1: 'Equipo 1', adm_team2: 'Equipo 2', adm_pens: 'Si empataron: ganó el equipo 1 en penales',
      adm_save: 'Guardar resultado', adm_remove: 'Eliminar resultado', adm_saving: 'Guardando…', adm_saved: 'Guardado — probabilidades recalculadas y enviadas a todos.', adm_removed: 'Resultado eliminado.', adm_neterr: 'Error de red',
      adm_broadcast: 'Email masivo', adm_bc_beta: 'Anuncio de la plataforma (diseño completo). Suele caer en Promociones. Prueba primero contigo.', adm_bc_reengage: 'Reactivación (bandeja Principal): correo personal para reenganchar inactivos. Prueba primero contigo.',
      adm_bc_test: '✉ Prueba', adm_bc_send: '📣 Enviar a TODOS', adm_bc_confirm: '¿Enviar este email a TODOS los usuarios? No se puede deshacer.', adm_bc_sending_test: 'Enviando prueba…', adm_bc_starting: 'Iniciando envío…', adm_bc_test_ok: 'Prueba enviada ({sent}/{total})', adm_bc_started: 'Envío iniciado en segundo plano… ({total} usuarios)', adm_bc_progress: 'Enviando… {sent}/{total}', adm_bc_done: 'Envío completado: {sent}/{total}', adm_bc_server: 'Envío en curso en el servidor (no se pudo leer el progreso).',
      adm_telegram: 'Telegram', adm_tg_note: 'Publica al canal @gpsimulador. Automático: finales, oportunidades fuertes y resumen diario. Estos botones son para probar/forzar.', adm_tg_test: '✈ Probar publicación', adm_tg_daily: '📊 Publicar resumen de hoy', adm_tg_sending: 'Publicando…', adm_tg_ok: 'Publicado en el canal.', adm_tg_fail: 'no se pudo publicar',
      adm_users: 'Base de usuarios', adm_users_err: 'No se pudo cargar la base de usuarios.', adm_verified: 'verificados', adm_leads: 'leads', adm_total: 'total', adm_sources: 'Fuentes', adm_name: 'Nombre', adm_country: 'País', adm_lang: 'Idioma', adm_state: 'Estado', adm_source: 'Fuente', adm_reg: 'Registro', adm_lastseen: 'Última visita',
      // ---- Fase 5: equipos tabs + cuenta ----
      nav_refer: 'Invitar',
      tm_groupwin: 'Gana grupo', tm_groupsecond: '2º grupo', tm_out: 'Fuera', tm_follow: 'Seguir', tm_following: 'Siguiendo',
      tm_tab_squad: 'Plantilla', tm_tab_results: 'Resultados', tm_keyplayers: 'Jugadores clave', tm_last5: 'Últimos 5', tm_mkt_price: 'Precio', tm_read: 'Lectura del modelo', tm_likely_opp: 'Rivales probables', tm_paths: 'Caminos simulados',
      tm_next_ctx: 'Próximo partido · contexto GP', tm_ctx_note: 'Abrí el cockpit del partido para ver la probabilidad GP con el contexto aplicado (forma, bajas, clima).', tm_base_note: 'Las probabilidades de torneo reflejan la fuerza base del equipo según el modelo GP. El contexto de cada partido (forma, bajas, clima) se aplica en el cockpit de ese encuentro.',
      st_injured: 'Lesionado', st_suspended: 'Suspendido', st_doubt: 'Duda', st_available: 'Disponible',
      fol_empty: 'Aún no sigues equipos', fol_empty_sub: 'Marca la estrella en un equipo para seguirlo.',
      al_events: 'Eventos', al_channels: 'Canales', al_next: 'Próximo partido', al_start: 'Inicio del partido', al_goal: 'Gol', al_result: 'Resultado final', al_qualify: 'Clasificación', al_swing: 'Cambio de probabilidad', al_value: 'Oportunidad de valor', al_arb: 'Arbitraje', al_email: 'Email', al_telegram: 'Telegram', al_push: 'Notificaciones push', al_soon: 'pronto', al_note: 'Las alertas por email están activas; Telegram y push llegan pronto.',
      ref_verified: 'referidos verificados', ref_copy: 'Copiar enlace', ref_copied: '¡Copiado!', ref_tiers: 'Niveles', ref_rule: 'Un referido se verifica cuando tu invitado confirma su correo. Umbral de acceso: 5 referidos verificados.',
      aff_available: 'Disponible', aff_pending: 'En espera', aff_pending_sub: 'madura a los 7 días', aff_paid: 'Pagado', aff_paying: 'referidos con suscripción activa', aff_forlife: 'de por vida', aff_lead: 'Ganás una comisión recurrente por cada persona que entre con tu enlace y pague una suscripción, mientras siga activa.', aff_wallet: 'Tu billetera', aff_wallet_sub: 'Cobrás en stablecoins (USDC/USDT). Elegí la red que uses.', aff_network: 'Red', aff_asset: 'Moneda', aff_address: 'Dirección', aff_address_ph: 'pegá tu dirección', aff_save_wallet: 'Guardar billetera', aff_wallet_saved: '✓ Billetera guardada', aff_withdraw: 'Retirar', aff_request: 'Solicitar retiro', aff_wd_open: 'Tenés una solicitud de {amt} en proceso.', aff_wd_min: 'Necesitás {min} disponibles para retirar.', aff_wd_cooldown: 'Ya solicitaste un retiro esta semana. Podés pedir el próximo en 7 días.', aff_wd_ready: 'Podés retirar {amt} ahora.', aff_wd_done: '✓ Retiro solicitado. Te avisamos por email cuando salga.', aff_rules: 'Mínimo $50 · un retiro por semana · el saldo queda disponible 7 días después de cada pago.', aff_period: 'Período', aff_referral: 'Referido', aff_plan: 'Plan', aff_commission: 'Comisión', aff_status: 'Estado', aff_st_available: 'disponible', aff_st_paid: 'pagado', aff_st_pending: 'en espera',
      aff_signups: 'registrados con tu enlace', aff_signups_note: 'Todos los que entraron con tu link, paguen o no. Solo los que pagan una suscripción generan comisión.', aff_signups_h: 'Tus registros', aff_su_date: 'Fecha', aff_su_status: 'Estado', aff_su_sub: 'suscrito', aff_su_verified: 'verificado', aff_su_reg: 'registrado',
      adm_aff: 'Afiliados', adm_aff_email: 'Email del afiliado', adm_aff_rate: 'Comisión %', adm_aff_apply: 'Aplicar', adm_aff_ok: '✓ Rate aplicado', adm_aff_note: 'Default 10% · máximo 20% (influencers). El rate no se anuncia públicamente.', adm_aff_empty: 'Sin afiliados con actividad todavía', adm_aff_signups: 'Registros', adm_aff_refs: 'Pagando', adm_aff_wd: 'Retiros pendientes', adm_aff_pay: 'Pagar', adm_aff_reject: 'Rechazar', adm_aff_tx_ph: 'tx hash (opcional)',
      nav_combat: 'Combate',
      // ── COMBATE (R2 28-jul): navegación + vistas del deporte ──
      sport_futbol: 'Fútbol', sport_combat: 'Combate', sport_nba: 'NBA', sport_soon: 'Próximamente',
      nav_cb_fights: 'Peleas', nav_cb_fighters: 'Peleadores', nav_cb_orgs: 'Organizaciones',
      cb_title: 'Combate', cb_opps_title: 'Oportunidades', cb_fights_title: 'Peleas', cb_fighters_title: 'Peleadores', cb_sim_title: 'Simulador', cb_perf_title: 'Rendimiento', cb_orgs_title: 'Organizaciones', cb_evo_title: 'Evolución', cb_follow_title: 'Seguidos',
      cb_main_event: 'Evento estelar', cb_card: 'Cartelera', cb_fights_n: 'peleas', cb_rounds: 'rounds', cb_analyze: 'Analizar pelea', cb_reach: 'alcance', cb_loading: 'Cargando…',
      cb_gpprob: 'PROBABILIDAD GP', cb_market: 'mercado', cb_books_n: 'casas', cb_no_odds: 'sin cuotas aún', cb_best_odds: 'mejor cuota',
      cb_method: 'MÉTODO DE VICTORIA', cb_finish: 'termina', cb_inside2: 'antes del 3º', cb_tale: 'Tale of the tape', cb_age: 'Edad', cb_height: 'Altura', cb_exp: 'Peleas', cb_kow: 'KO', cb_subw: 'SUB', cb_streak: 'Racha', cb_intel: 'Inteligencia', cb_intel_none: 'Sin señales — pelea limpia de banderas.',
      cb_recent: 'Últimas 5', cb_h2h: 'Historial entre ellos', cb_odds_by_book: 'Cuotas por casa', cb_form: 'Forma',
      cb_search_ph: 'Buscar peleador…', cb_all_divs: 'Todas las divisiones', cb_no_results: 'Sin resultados para esa búsqueda.',
      cb_sim_pick: 'Elegí dos peleadores para simular la pelea.', cb_sim_a: 'Esquina verde', cb_sim_b: 'Esquina roja', cb_sim_run: 'Simular pelea', cb_sim_swap: 'Invertir esquinas',
      cb_picks: 'Picks activas', cb_value: 'Valor de compra', cb_value_sub: 'mejor cuota vs consenso de mercado', cb_arb: 'Arbitraje', cb_arb_none: 'Sin arbitrajes 2-way ejecutables ahora.', cb_no_picks: 'Sin picks activas — el motor genera cuando hay edge post-blend ≥2pp.', cb_monitor: 'monitor privado',
      cb_track: 'Track record', cb_settled: 'Liquidadas', cb_no_settled: 'Todavía no liquida ninguna pick.', cb_units: 'unidades', cb_hit: 'acierto', cb_clv: 'CLV medio',
      cb_org_since: 'desde', cb_org_active: 'activos', cb_org_next: 'Próximo evento', cb_org_top: 'Élite por Elo', cb_org_hist: 'histórico',
      cb_evo_top: 'La élite en el tiempo', cb_evo_up: 'En ascenso', cb_evo_down: 'En caída', cb_evo_12m: 'últimos 12 meses',
      cb_follow_none: 'Todavía no seguís a ningún peleador. Entrá a un perfil y tocá ★ Seguir.', cb_follow_btn: 'Seguir', cb_following: '★ Siguiendo', cb_next_fight: 'Próxima pelea',
      cb_division: 'División', cb_opp_quality: 'Nivel de oposición', cb_cage_min: 'Minutos de jaula', cb_ko_losses: 'KOs recibidos', cb_last: 'última',
      pf_fam_method: 'Método', pf_fam_rounds: 'Rounds', cb_mkt_panel: 'Método y rounds · GP vs mercado', cb_mkt_model: 'GP', cb_mkt_market: 'Mercado', cb_mkt_src: 'vs consenso del mercado',
      cb_read: 'Lectura GP', cb_matchup: 'Matchup', cb_matchup_sub: 'qué inclina la pelea y cuánto', cb_pred: 'Predicción completa', cb_pred_sub: 'todos los desenlaces', cb_rdist: 'La pelea termina en…', cb_dist_lab: 'Decisión',
      cb_fx_misswt: 'condición en el pesaje', cb_camp: 'Campamento', nav_cb_ask: 'Preguntale a GP', cba_ph: 'Preguntá por una pelea o un peleador…', cba_send: 'Preguntar', cba_intro: 'Respondo con lo que el modelo realmente sabe de las carteleras cargadas. Si no lo sé, te lo digo.', cba_try: 'Probá con:', cba_open: 'Ver la ficha completa →', cba_thinking: 'Buscando…', cbm_title: 'El mercado se movió', cbm_sub: 'apertura → ahora, y hacia dónde', cbm_with: 'A FAVOR', cbm_against: 'EN CONTRA', cbm_snaps: 'lecturas', cbm_none: 'Sin movimientos relevantes todavía. El archivo de precios lleva pocas horas: esto se llena solo.', nav_cb_card: 'Mapa de la noche', cbc_night: 'La forma de la velada', cbc_fin_exp: 'peleas terminan antes del límite', cbc_rounds_exp: 'rounds en total', cbc_dist: 'Cuántas acaban antes del límite', cbc_early: 'La que más chance tiene de acabar temprano', cbc_far: 'La que más lejos llega', cbc_gap: 'Mayor discrepancia con el mercado', cbc_card_sel: 'Cartelera', cbc_sims: 'sobre 10.000 veladas simuladas', cb_ref: 'Árbitro:', cb_judges: 'Jueces:',
      cbb_next: 'La próxima cartelera', cbb_div: 'Donde GP y el mercado no coinciden', cbb_div_sub: 'las mayores distancias de la cartelera', cbb_intel: 'Señales del vestuario', cbb_picks: 'En el monitor', cbb_recent: 'Cómo venimos', cbb_none: 'Nada que reportar por ahora.', cbb_cards: 'Carteleras por delante', cbb_model: 'GP', cbb_market: 'mercado', cbb_fights_n: 'peleas',
      cb_live: 'EN VIVO', cb_live_sub: 'la probabilidad se mueve con el reloj', cb_live_pre: 'antes de empezar', cb_live_now: 'ahora', cb_live_fin: 'termina antes del límite', cb_live_dec: 'llega a decisión', cb_live_left: 'rounds por delante', cb_live_tl: 'Cronología del combate', cb_live_note: 'La cronología viene sin atribuir desde la fuente oficial: son hechos del combate, no de un peleador. La probabilidad la mueven el modelo y el reloj.',
      cb_film: 'Film study', cb_film_sub: 'lo que dice la cinta', cb_film_none: 'Sin suficiente registro de acción para leer la cinta de este cruce.', cb_film_what: 'Lectura automática del registro de acción de cada pelea (a dónde van los golpes y con cuánta intención, cómo entra el juego de suelo, en qué round se cierran sus peleas). No es análisis de video.', cb_film_pace: 'Ritmo', cb_film_target: 'Reparto de golpes', cb_film_power: 'Intención', cb_film_gr: 'Suelo', cb_film_ctrl: 'Control', cb_film_early: 'Cierra temprano', cb_film_deep: 'Aguas profundas',
      cb_conf_high: 'Confianza alta', cb_conf_med: 'Confianza media', cb_conf_low: 'Confianza baja', cb_conf_sub_low: 'muestra corta o mercado fino — el sistema lo sabe',
      cb_fx_elo: 'Nivel demostrado', cb_fx_reach: 'Alcance', cb_fx_exp: 'Experiencia', cb_fx_years: 'Desgaste de carrera', cb_fx_age: 'Edad', cb_fx_chin: 'Durabilidad', cb_fx_streak: 'Momento', cb_fx_mileage: 'Oficio en jaula',
      cb_momentum: 'Momentum', cb_mom_delta: 'últimos 12 meses', cb_quality: 'Calidad de victorias', cb_q_elite: 'élite vencida', cb_q_strong: 'rivales duros', cb_q_top: 'Mejores victorias',
      cb_pace: 'Ritmo y fondo', cb_pace_r1: 'cierra en el R1', cb_pace_deep: 'en aguas profundas (R3+)', cb_pace_dist: 'va a decisión', cb_similar: 'Perfiles similares', cb_sim_pct: 'parecido',
      cb_wins_by: 'Gana', cb_loses_by: 'Pierde', cb_upd: 'actualizado',
      cb_sims: '10,000 simulaciones', cb_style_hist: 'Historial de estilos', cb_style_line: 'Históricamente, {a} gana {pct}% contra {b} ({n} peleas)', cb_style_of: 'Perfil',
      cb_striking: 'Striking engine', cb_grappling: 'Grappling engine', cb_slpm: 'Golpes/min', cb_head: 'Cabeza', cb_body: 'Cuerpo', cb_legs: 'Piernas', cb_power: 'De poder', cb_kd15: 'KD por 15min', cb_td15: 'Derribos/15min', cb_tdacc: 'Precisión derribo', cb_tddef: 'Defensa derribo', cb_sub15: 'Sumisiones int./15', cb_ctrl: 'Control del cage', cb_fine_n: 'peleas con métrica fina (2022+)', cb_fine_src: 'era moderna',
      tb_lead: 'Probá Sharp GRATIS 3 días', tb_sub: 'Hoy pagás $0 · cancelás en 1 clic', tb_cta: 'Empezar mi prueba',
      tm_eyebrow: 'Prueba gratis · 3 días', tm_title: 'Probá Sharp sin pagar hoy', tm_sub: 'El plan completo, desbloqueado 3 días. Si no es para vos, cancelás en un clic y no se te cobra nada.',
      tm_b1: 'Todas las picks del día con stake sugerido', tm_b2: 'Value y arbitraje en 40+ casas', tm_b3: 'Tu cartera de apuestas con ROI real', tm_b4: 'Historial público verificado — ganadas y perdidas',
      tm_cta: 'Empezar mis 3 días gratis', tm_micro: 'US$0 hoy · $59/mes solo si te quedás · cancelás cuando quieras', tm_no: 'Ahora no',
      adm_grant_plan: 'Suscripción manual', adm_grant_give: 'Dar plan', adm_grant_revoke: 'Quitar plan', adm_grant_ok: '✓ Aplicado', adm_grant_note: 'Da acceso Pro/Sharp sin pago (usa el email de arriba). Para influencers o cortesías. "Quitar plan" lo regresa a Free.',
      ref_t1: 'Embajador', ref_t3: 'Plata', ref_t5: 'Oro · acceso', ref_t10: 'Leyenda',
      perf_sample: 'Muestra', perf_method: 'Metodología', perf_method_b: 'Métricas verificables sobre señales liquidadas desde el Verified Epoch: Brier (calibración), Log loss (penaliza errores extremos) y ECE (error de calibración). No afirmamos rentabilidad con muestra chica.',
      perf_total: 'Evaluados', perf_hits: 'Aciertos', perf_exact: 'Marcador exacto', perf_vs_market: 'GP vs mercado', perf_hitrate: '% de aciertos (1X2)',
      pp_title: 'Rendimiento de picks', pp_settled: 'Liquidadas', pp_hit: '% Aciertos', pp_roi: 'ROI', pp_pnl: 'P&L', pp_byfam: 'Por familia', pp_history: 'Historial de picks', pp_hist_window: 'Últimas {shown} de {total} liquidadas', pp_pick: 'Pick', pp_active: 'activas', pp_none: 'Aún no hay picks liquidadas.', pp_model: 'Calibración del modelo (1X2)',
      lm_with: 'El mercado se movió a favor ({pp}pp) desde la publicación', lm_against: 'El mercado se movió en contra ({pp}pp) desde la publicación',
      pf_why_btn: 'Por qué esta pick', reads_title: 'Lecturas del sistema',
      st_title: 'Perfil táctico', st_sub: 'torneo, remate a remate', st_sub_club: 'temporada, remate a remate', st_findings: 'Hallazgos del cruce', st_xg: 'xG por partido', st_xga: 'xG en contra', st_corners_pct: 'Peligro de córners', st_sp_pct: 'Balón parado', st_counter_pct: 'Contragolpe', st_aerial: 'Juego aéreo', st_c90: 'Córners por partido', st_cards: 'Tarjetas por partido', st_note: 'Porcentajes = parte del peligro generado por esa vía. Verde = lidera la comparación.',
      sf_corner_edge: 'Ventaja de córners para {team}: genera por esa vía justo donde el rival concede', sf_set_piece_edge: 'Ventaja de balón parado para {team}: su peligro nace donde el rival sufre', sf_aerial_edge: 'Ventaja aérea para {team}: amenaza de cabeza contra un rival que concede en ese juego', sf_counter_edge: '{team} lastima a la contra y el rival concede en transiciones', sf_zone_overlap: 'El sector favorito de ataque de {team} coincide con la zona donde el rival más concede', sf_volume_edge: '{team} genera volumen contra una defensa que viene concediendo',
      qm_title: 'Calidad de las picks vs mercado', qm_clv: 'CLV medio', qm_clv_sub: 'valor vs línea de cierre', qm_beat_close: 'Le ganó al cierre', qm_brier_gp: 'Precisión GP', qm_brier_mkt: 'Precisión consenso', qm_brier_sub: 'Brier, más bajo es mejor', qm_skill: 'Ventaja GP', qm_cal_title: 'Calibración por rangos', qm_cal_note: 'Cuando el sistema proyecta un rango de probabilidad, esto es lo que ocurrió en la realidad.', qm_cal_range: 'Proyectado', qm_cal_obs: 'Real', qm_cal_n: 'Picks', qm_clv_note: 'CLV positivo = tomamos mejor precio que el cierre del mercado. Es la medida profesional de calidad de una pick.',
      opp_value_empty: 'Sin Value accionable ahora', opp_value_empty_sub: 'El motor sigue evaluando; aparece cuando GP detecta ventaja sobre el precio.',
      outright_title: 'Campeón del Mundial · Value', outright_sub: 'Probabilidad GP del torneo vs mercado', outright_none: 'Sin ventaja sobre el mercado para el título ahora.',
      tm_gpi: 'GP Intelligence · título', tm_gpi_model: 'Probabilidad GP (campeón)', tm_gpi_market: 'Mercado', tm_gpi_edge: 'Ventaja GP', tm_gpi_note: 'Probabilidad de ser campeón según el modelo GP del torneo. El contexto de cada partido (forma, bajas, clima) se aplica en el cockpit del encuentro y en el próximo partido de abajo.',
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
      gp_pending_ctx: 'La evaluación de contexto GP para este partido aún no se generó; se muestra la probabilidad base del modelo GP. El contexto detallado (forma, bajas, etc.) está en la pestaña Contexto.',
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
      calc_mode_pf: 'Portfolio del día',
      cpf_intro: 'Tu cartera del día: stake sugerido por pick (Kelly fraccionado), correlación intra-partido aplicada y límite de riesgo diario.',
      cpf_empty: 'Sin picks con inicio en las próximas 24 horas.', cpf_empty_sub: 'El portfolio se arma solo cuando hay picks activas del día.',
      cpf_n_picks: '{n} picks · próximas 24 h', cpf_day_limit: 'Límite diario', cpf_of_day: 'del bankroll',
      cpf_total_stake: 'Stake total recomendado', cpf_total_risk: 'Riesgo total del día', cpf_max_loss: 'Pérdida máx. estimada (95%)', cpf_exp_pnl: 'Resultado esperado',
      cpf_by_match: 'Exposición por partido', cpf_by_league: 'Exposición por liga', cpf_picks: 'Stake por pick',
      cpf_corr_note: 'Picks del mismo partido con stake ajustado por correlación (ρ medida en la matriz de marcadores).',
      cpf_scaled: 'La suma sugerida ({sum}) superaba tu límite diario — todos los stakes se escalaron a {pct}% para respetarlo.',
      cpf_maxloss_note: 'En el 95% de los días no perderías más que esto (simulación con las probabilidades y correlaciones de hoy). Peor caso absoluto = el riesgo total.',
      nav_bets: 'Mi cartera', nav_books: 'Mis casas', nav_brief: 'Daily Brief',
      pf_empty_live: 'Sin picks de partidos en vivo ahora', pf_empty_up: 'Sin picks de partidos próximos', pf_empty_filt_sub: 'Mirá "Todos" para ver todas las picks activas.',
      mb_title: 'Mi cartera', mb_intro: 'Registrá lo que apostás (con o sin pick GP) y marcá el resultado — P&L, ROI y CLV personal, y tu rendimiento siguiendo GP vs apuestas propias.',
      mb_add: 'Registrar apuesta', mb_pick: 'Pick GP (opcional)', mb_manual_opt: 'Apuesta manual (sin pick)', mb_label: 'Descripción', mb_odds: 'Cuota', mb_stake: 'Stake', mb_book: 'Casa (opcional)', mb_save: 'Guardar',
      mb_pnl: 'P&L', mb_roi: 'ROI', mb_record: 'Récord', mb_clv: 'CLV personal', mb_open: 'Abiertas', mb_gp: 'Siguiendo GP', mb_manual: 'Manuales',
      mb_result: 'Resultado', mb_won: 'Ganada', mb_lost: 'Perdida', mb_void: 'Nula', mb_reopen: 'Reabrir', mb_del: 'Borrar', mb_del_confirm: '¿Borrar esta apuesta del registro?',
      mb_empty: 'Aún sin apuestas registradas', mb_empty_sub: 'Registrá tu primera apuesta y tu P&L personal arranca solo.',
      mb_note: 'Registro personal y privado. El CLV usa el cierre oficial de la pick cuando existe.',
      bk_title: 'Mis casas', bk_intro: 'Marcá las casas donde tenés cuenta: el feed te muestra qué picks son ejecutables para vos y cuáles cotizan mejor en una casa que no tenés.',
      bk_save: 'Guardar', bk_saved: 'Guardado', bk_custom: 'Otra casa…', bk_add: 'Agregar', bk_only_mine: 'Solo mis casas', bk_not_mine: 'mejor cuota en casa que no tenés',
      bk_sportsbooks: 'Casas de apuestas que cubrimos', bk_crypto: 'Casas cripto', bk_prediction: 'Mercados de predicción',
      bk_empty: 'Ninguna pick activa cotiza en tus casas', bk_hidden: '{n} oportunidades ocultas por "Solo mis casas" — tocá el filtro para verlas todas.', bk_empty_sub: 'Desactivá "Solo mis casas" para ver todas, o agregá más casas en Mis casas.',
      wp_watch: 'Vigilar precio', wp_target: 'Avisame si la mejor cuota llega a', wp_set: 'Crear alerta', wp_created: 'Alerta creada',
      wp_list: 'Precios vigilados', wp_hit: 'Alcanzado', wp_expired: 'Vencido', wp_active: 'Vigilando', wp_last: 'última', wp_target_s: 'objetivo', wp_none: 'Sin precios vigilados. Creá uno desde cualquier pick con "Vigilar precio".',
      bf_title: 'GP Daily Brief', bf_sub: 'Tu resumen diario: oportunidades, partidos, movimientos y resultados.',
      bf_top: 'Top oportunidades de hoy', bf_matches: 'Partidos del día', bf_moves: 'Movimientos de línea', bf_findings: 'Radar de bajas', bf_yesterday: 'Resultados de ayer', bf_bankroll: 'Tu cartera',
      bf_email: 'Recibir el brief por email cada día', bf_email_saved: 'Preferencia guardada',
      bf_empty: 'El brief se arma solo cuando hay picks activas del día.', bf_yn: '{wins}G-{losses}P de {n} liquidadas',
      bf_move_with: 'a favor', bf_move_against: 'en contra',
    },
    en: {
      nav_opps: 'Opportunities', nav_matches: 'Matches', nav_teams: 'Teams', nav_sim: 'Simulator', nav_follow: 'Following',
      nav_alerts: 'Alerts', nav_perf: 'Performance', nav_groups: 'Groups', nav_bracket: 'Bracket', nav_evo: 'Evolution',
      nav_registry: 'Registry', nav_method: 'Methodology', nav_admin: 'Admin', more: 'More',
      account: 'My profile', account_beta: 'BETA', logout: 'Sign out',
      sub_nav: 'My subscription', sub_title: 'My subscription', sub_plan: 'Current plan', sub_founder: 'FOUNDER', sub_status: 'Status',
      sub_active: 'Active', sub_cancelled: 'Cancelled', sub_pastdue: 'Payment past due', sub_since: 'Member since',
      sub_free_note: 'Full access is free during the World Cup. Plans are coming soon — the first 100 get a lifetime founder price.',
      sub_upgrade: 'See plans', fb_lead: 'Founder Pass is open', fb_sub: 'Price locked for life, only while the World Cup lasts', fb_spots: '{n} of 100 left', fb_close: 'Closes with the final in {t}', fb_cta: 'Secure mine', sub_up_sharp: 'Upgrade to Sharp', sub_cancel: 'Cancel subscription', sub_cancelled_note: 'Your subscription is cancelled. You keep access until the end of the paid cycle.', cx_title: 'Cancel subscription', cx_step1: 'Are you sure you want to cancel? You will lose access to picks and analysis at the end of the current cycle. For your security we will email you a code to confirm.', cx_keep: 'Keep my plan', cx_yes: 'Yes, I want to cancel', cx_step2: 'We sent a code to your email. Enter it to confirm the cancellation.', cx_confirm: 'Confirm cancellation', cx_code_bad: 'Enter the 6-digit code.', cx_err: 'Something went wrong. Try again.', cx_close: 'Close', cx_done: 'Subscription cancelled.', cx_done_clean: 'Done: you will not be charged again. You keep access until the end of the paid cycle.', cx_done_note: 'You will not be charged again. To stop the recurring payment, also cancel from your Whop account.', cx_whop: 'Go to my Whop account', sub_manage: 'Manage subscription', sub_manage_soon: 'Available when payments launch',
      sub_asplan: 'View the platform as (admin only)', sub_asplan_real: 'Real',
      sup_nav: 'Support', sup_title: 'Support', sup_intro: 'Tell us your issue or question and we’ll reply by email, usually within 24 hours.',
      sup_subject: 'Subject (optional)', sup_msg: 'Your message', sup_msg_ph: 'Write your question here…', sup_send: 'Send',
      sup_sent: 'Message sent — we’ll reply to your email. You can also write to soporte@gpsimulador.com.',
      sup_err: 'Couldn’t send, try again.', sup_short: 'Tell us a bit more so we can help.', sup_rate: 'Too many messages; try again later.',
      lock_sharp_t: 'Available on the Sharp plan', lock_sharp_s: 'Real-time value and arbitrage are part of the Sharp plan.',
      lock_bets_s: 'My bets —your personal P&L, ROI and CLV— is part of the Sharp plan.',
      lock_style_s: 'The tactical profile (shot-by-shot event data) is part of the Sharp plan.',
      lock_pro_t: 'Available from the Pro plan', lock_pro_s: 'The goal projection for every match is part of the Pro and Sharp plans.',
      lock_player_s: 'Player profiles with scouting radar and projections are part of the Pro and Sharp plans.',
      lock_calc_s: 'The stake calculator with bankroll management is part of the Pro and Sharp plans.',
      onb_1t: "Today's picks", onb_1s: 'The model publishes verified plays every day across 24 leagues, with a public track record of hits and misses. Your free daily pick is waiting on the board.',
      onb_2t: 'Every match, in depth', onb_2s: 'Open any match: live probabilities, expected goals, lineups, injuries and context. A full analysis cockpit.',
      onb_3t: 'Value & Arbitrage', onb_3s: 'The scanner compares 40+ sportsbooks in real time to find overpaying odds and covered plays across books.',
      onb_4t: 'My bets', onb_4s: 'Log your bets and see your real performance: profit, ROI and streak, all in one place.',
      onb_sharp: 'Available on Sharp',
      onb_next: 'Next', onb_done: "Let's go!", onb_skip: 'Skip',
      adm_ana: 'ACTIVITY · RETENTION', adm_ana_today: 'Active today', adm_ana_d1: 'D1 retention', adm_ana_d7: 'D7 retention', adm_ana_hab: 'Daily returners (4+ of 7 days)', adm_ana_since: 'Tracking since', adm_ana_nodata: 'Accumulating data — metrics mature over the days.',
      lock_more_picks: '{n} more picks today', lock_more_picks_s: 'Available on the Pro and Sharp plans.',
      lock_delay: 'The free daily pick unlocks 60 minutes before kickoff.',
      lock_picks_t: "Today's picks are for subscribers", lock_picks_s: "Subscribe to see the model's daily picks. It's not that there are none — they're on Pro and Sharp.",
      lock_cta: 'See plans',
      wp_title: 'Your first pick, free', wp_sub: 'Our safest call of the day — welcome to GP Simulador.', wp_dismiss: 'Dismiss',
      frb_lead: "You're on the Free plan", frb_sub: 'Unlock every daily pick, the live cockpit and the tools.', frb_cta: 'See plans',
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
      memo: 'Decision memo', conf: 'Confidence', conf_hi: 'High', conf_mid: 'Medium', conf_lo: 'Low', conf_na: 'Not assessed',
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
      ck_choose: 'Pick a match', ck_over25: 'Over 2.5', ck_todaypick: 'Today’s pick',
      reg90: '90 min · no extra time or penalties', updated_short: 'Updated',
      sig_strong: 'STRONG', sig_lean: 'LEAN', sig_watch: 'WATCH', sig_pass: 'PASS',
      comp: 'FIFA World Cup 2026', none_active_pick: 'No active GP Picks right now.',
      below_min: 'The current price is below the required minimum odds.', below_min_short: 'Below min', min_odds: 'Minimum odds', cur_price: 'Best price',
      cta_pick: 'View GP pick', cta_value: 'View opportunity', cta_analysis: 'View full analysis', cta_analyze: 'Analyze match', cta_view_match: 'View match', cta_arb: 'View arbitrage', cta_state: 'View status',
      unc_copy: 'Internal estimates don’t fully converge for this match.',
      thesis_price_only: 'The gap comes mainly from price: the available context doesn’t provide enough evidence to support a stronger read.',
      thesis_ctx2: 'GP backs its read on {factors}.',
      e_na: 'Data unavailable', e_nomarket: 'Market not loaded', e_lineups: 'Lineup pending', e_partial: 'Partial context', e_noprice: 'Odds not currently available', e_gp_na: 'GP Intelligence unavailable', e_stale: 'Stale data',
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
      prob_base_only: 'The GP context evaluation for this match hasn’t been generated yet; the GP model’s base probability is shown. Available context (form, absences, lineups) is in the Context tab.',
      drivers: 'Factors that moved the line', evaluated: 'Evaluated factors', impact: 'Impact', confidence: 'Confidence', evidence: 'Evidence', freshness: 'Freshness',
      evaluated_note: 'These factors were evaluated; their effect is reflected in the net context adjustment, not as an isolated per-factor impact.',
      fac_favors: 'favors', fac_against: 'against', fac_neutral: 'neutral',
      ev_fact: 'Fact', ev_inference: 'Inference',
      tl_title: 'Timeline', tl_now: 'Current state', tl_base_gp: 'Base → GP probability',
      tl_empty: 'No prior snapshots recorded for this match yet. Probability, price, news and lineup changes will be tracked from now on.',
      mkt_sb: 'Sportsbooks', mkt_sb_best: 'Best price per book', mkt_ex: 'Exchange', mkt_pm: 'Prediction markets',
      col_provider: 'Source', col_outcome: 'Outcome', col_odds: 'Odds', col_implied: 'Implied', col_novig: 'No-vig', col_move: 'Movement', col_liq: 'Liquidity', col_fresh: 'Freshness', na_short: 'Unavailable', move_na: 'Not recorded yet',
      mkt_none: 'No markets loaded for this match yet.', move_untracked: 'Price movement isn’t tracked for these sources yet.', novig_na: 'Requires the full outcome set.',
      ctx_none: 'No verified context available for this match yet.', ctx_form: 'Recent form', ctx_inj: 'Absences & availability', ctx_lineups: 'Lineups',
      ctx_form_line: '{team} arrives with {rec} in its last {n} ({gf} for, {ga} against).', ctx_form_line_short: '{team} arrives with {rec} in its last {n}.', ctx_inj_line: '{team}: {players}.', no_inj: 'no reported absences',
      goals_tag: 'In validation', goals_disc: 'Statistical model projection, in validation. Not a Pick or Value; no betting recommendation.',
      g_xg: 'Expected xG', g_total: 'Expected total', g_ou: 'Over / Under', g_btts: 'Both teams score', g_scores: 'Most likely scores', g_over: 'Over', g_under: 'Under', g_yes: 'Yes', g_no: 'No', goals_none: 'No goal projection available.',
      g_dist: 'Goal distribution', g_margin: 'Winning margin', g_combos: 'Combinations', g_either2: 'Either team by 2+', g_team_by2: '{team} by 2+', g_draw: 'Draw', g_team_wino25: '{team} wins & over 2.5', g_wintonil: 'Either wins to nil', g_team_cs: '{team} clean sheet', g_push: 'push', g_home: 'Home', g_away: 'Away',
      live_min: 'Minute', live_events: 'Events', live_stats: 'Stats', live_prob: 'Live probability (model)', live_none: 'No verified live data for this match.',
      live_stale: 'Live data may be stale; it might not reflect the current state.',
      live_ctx_red: 'Live probability adjusted for a red card ({team}).',
      st_possession: 'Possession', st_shots: 'Shots', st_sot: 'On target', st_corners: 'Corners', st_fouls: 'Fouls', st_xg: 'xG', st_offsides: 'Offsides', st_yellow: 'Yellows',
      mod_form: 'Recent form', mod_lineups: 'Lineups', mod_stats: 'Statistics',
      mod_xg: 'Match xG', xg_total: 'Total xG', xg_h1: '1st half xG', xg_h2: '2nd half xG', xg_bigch: 'Big chances', xg_shots: 'Shots',
      mod_momentum: 'Live GP momentum', mom_note: 'GP win probability, updated as the match unfolds. Dots mark goals.', hero_scores: 'Likely scores',
      mod_intel: 'Match intel', intel_player: 'Player', intel_goal: 'Goal', intel_shots: 'Shots', intel_radar: 'Availability radar', intel_miss: 'risk', intel_out: 'OUT', intel_susp: 'BAN', intel_doubt: 'DOUBT', intel_rest: 'ROTATION', intel_factor: 'If the absences are confirmed, team creation would drop ~{pct}%.', intel_note: 'Scoring probability and projected shot volume per player, with availability alerts detected from published sources.', intel_findings: 'Intelligence findings',
      pi_role_starter_confirmed: 'Confirmed starter', pi_role_starter_projected: 'Projected starter', pi_role_bench: 'Likely sub', pi_sample_strong: 'Solid sample', pi_sample_thin: 'Thin sample', pi_rates_elite: 'Elite output', pi_rates_above_pos: 'Above-position output', pi_finishing_hot: 'Hot finishing', pi_finishing_cold: 'Cold finishing', pi_team_attack_up: 'Team attack trending up', pi_team_attack_down: 'Team attack trending down', pi_avail_out: 'Confirmed out', pi_avail_susp: 'Suspended', pi_avail_doubt: 'Doubtful', pi_avail_unverified: 'Unverified alert', pi_avail_rest: 'Rotation risk', pi_set_piece_pen: 'Penalty taker', pi_set_piece_fk: 'Free kick taker', pi_set_piece_corners: 'Corner taker',
      arch_star: 'Star', arch_clinical: 'Clinical finisher', arch_creator: 'Creator', arch_aerial: 'Aerial threat', arch_super_sub: 'Super sub', arch_engine: 'Engine', arch_set_piece: 'Set piece specialist',
      ax_production: 'Threat', ax_volume: 'Shots', ax_accuracy: 'Accuracy', ax_creation: 'Creation', ax_finishing: 'Finishing', ax_presence: 'Presence', ax_aerial: 'Aerial', ax_attack_share: 'Attack share',
      pp_radar: 'Scouting radar', pp_radar_sub: 'vs players in his position', ft_title: "Today's featured players", ft_goal: 'P(goal)',
      pp_empty: 'Profile not available', pp_reading: 'GP reading', pp_sample: 'Tournament sample', pp_min: 'Minutes', pp_apps: 'Starts/Apps', pp_goals: 'Goals', pp_expmin: 'Typical min.', pp_per90: 'Output per 90 minutes', pp_shots: 'Shots', pp_sot: 'On target', pp_next: 'Next match · projection', pp_pgoal: 'P(goal)', pp_proj_shots: 'Proj. shots', pp_proj_min: 'Proj. minutes', pp_form: 'Match by match', pp_rival: 'Opponent', pp_shots_h: 'SH', pp_sot_h: 'SOT', pp_goals_h: 'G', pp_conf_high: 'High confidence', pp_conf_med: 'Medium confidence', pp_conf_low: 'Low confidence', pp_finding: 'Intelligence finding', pp_mindist: 'Minutes · distribution', pp_pstart: 'P(starter)', pp_if_start: 'If starter', pp_if_bench: 'From bench', pp_p60: '60+ min', pp_p75: '75+ min', pp_p90: '90 min', mi_start_chip: 'st', sr_players: 'Players', pp_markets: 'Player markets', pp_market: 'Market', pp_best: 'Best', pp_implied: 'Implied', pp_books: 'books', pp_mk_goal: 'To score (anytime)', pp_h2h: 'Vs this opponent', pp_share: '{pct}% of team attack', pp_pctl: 'Top {p}% of position',
      form_gf: 'GF', form_ga: 'GA', form_cs: 'Clean sheets', form_avg: 'Avg.', lineup_subs: 'Substitutes',
      evk_goal: 'Goal', evk_yellow: 'Yellow', evk_red: 'Red', evk_subst: 'Sub', evk_var: 'VAR', evk_other: 'Event',
      lineup_conf: 'Confirmed', lineup_proj: 'Projected', formation: 'Formation', news_title: 'News', match_loading: 'Loading match…', match_404: 'Couldn’t load this match analysis.',
      // ---- Corte 3: Matches + Simulator ----
      g_today: 'Today', g_tomorrow: 'Tomorrow', m_stage_all: 'All stages', m_search: 'Search team…', m_empty: 'No matches for this filter.',
      gp_absent: 'No pre-match GP evaluation', gp_absent_sub: 'No pre-match GP evaluation was recorded for this match.',
      gp_absent_final: 'No pre-match GP evaluation', gp_absent_final_sub: 'No pre-match GP evaluation was recorded for this match. Result and match data are shown.',
      sim_pick: 'Pick a team', sim_swap: 'Swap', sim_go: 'Simulate matchup', sim_running: 'Simulating…', sim_hypo: 'Hypothetical simulation using the context currently available.', sim_pick_team: 'Pick a team…', sim_no_mix: 'National teams and clubs are not comparable — pick two national teams or two clubs.',
      sim_empty: 'Pick two teams to simulate a matchup.', sim_empty_sub: 'GP crosses both with their current context.', sim_err: 'Couldn’t simulate the matchup.',
      sim_thesis_na: 'No read available for this matchup.', sim_risk_na: 'No notable change factors.', sim_verdict_na: 'Matchup with no clear favorite.',
      sim_factors: 'GP factors', sim_f_applied: 'Weighs', sim_f_neutral: 'Neutral',
      sim_v_even: 'Even matchup, no clear favorite.', sim_v_clear: '{team} is a clear favorite.', sim_v_slight: '{team} is a slight favorite.',
      sim_thesis: 'GP gives {fav} {favp}, {dog} {dogp} and a draw {drawp}.', sim_thesis_factor: 'Key factors: {factors}.', sim_risk: 'A last-minute absence or lineup change could narrow the margin.',
      sim_price_na: 'Price is not evaluated because this hypothetical matchup does not correspond to a scheduled market.', sim_hypo_tag: 'Hypothetical', sim_runs: 'scenarios',
      sim_montecarlo: 'GP scenario projection', sim_avg_goals: 'Avg goals', sim_totals: 'Goal distribution',
      sim_goals_disc: 'Goal projection in validation. Available for analysis; does not generate GP Picks or Value.',
      // ---- Corte 4H: tournament surfaces ----
      group: 'Group',
      tm_champion: 'Champion', tm_final: 'Final', tm_semi: 'Semis', tm_qf: 'Quarters', tm_advance: 'Advance',
      tm_sim_note: 'Probabilities from the GP tournament projection with the available context.',
      tm_next: 'Next match', tm_recent_matches: 'Recent matches', tm_vs_home: 'vs (home)', tm_vs_away: 'vs (away)',
      grp_goals: 'GF:GA', grp_advance: 'Advance', grp_advance_note: 'Advance = probability of progressing (1st or 2nd).',
      bk_tbd: 'TBD', bk_reg90: '90 min', bk_note: '1X2 probability at 90 min (not the probability of advancing).',
      bk_subtitle: 'Knockout bracket · official FIFA structure · scroll to see all rounds',
      slot_gw: '1st Group {g}', slot_gr: '2nd Group {g}', slot_t3: '3rd ({groups})', slot_win: 'Winner M{m}', slot_los: 'Loser M{m}',
      evo_insufficient: 'Evolution not available yet', evo_insufficient_sub: 'Not enough real snapshots yet ({n}). Evolution is recorded as the tournament progresses.',
      evo_champion: 'Champion probability', evo_snapshots: 'snapshots', evo_trend: 'Trend', evo_now: 'Now', evo_top: 'Top 10', evo_note: 'Only real recorded snapshots; no fabricated history.',
      evo_club_note: 'Per-matchday projection: model champion probability with each date’s table and remaining schedule.',
      reg_picks: 'Picks', reg_settled: 'Settled', reg_winrate: 'Win rate', reg_sample: 'Sample', reg_insufficient: 'Insufficient', reg_history: 'Picks history',
      // ---- Daily picks feed (product) ----
      pf_today: "Today's picks", pf_count: 'active picks', pf_count1: 'active pick', pf_pick_of_day: 'Pick of the day', pf_all_by_match: 'All picks by match',
      pf_corr: 'Same match: they settle together. For your stake, treat them as <b>one single bet</b>, not {n} independent ones.',
      cl_wc: 'World Cup 2026', cl_all_comps: 'All competitions', cl_gate_ok: 'Gate approved', cl_gate_sh: 'Calibrating', cl_hfa: 'home edge',
      cl_states_soon: 'Live and finished club states arrive with the scores integration.',
      cl_preseason: 'The season starts soon: ratings ready, the league enters calibrated at kickoff.',
      cl_value: 'Value vs market', cl_neutral: 'neutral venue',
      cl_value_board: 'Club value by league', cl_value_board_sub: 'GP model vs market consensus across in-season leagues. Informational: club picks are born once a league has an approved gate and the price confirms.',
      cl_pj: 'GP', cl_pts: 'Pts', cl_dif: 'GD', cl_pos: 'Position', cl_record: 'W-D-L', cl_goals: 'Goals', cl_of: 'of', cl_new: 'NEW',
      cl_standings: 'Standings', cl_grp_note: 'Advance = prob. of finishing in the top zone (Top 4) per the season sim. Updates each matchday.', cl_grp_fav: 'Title favorite:',
      cl_bk_title: 'Playoffs (projected)', cl_bk_champ: 'Projected champion', cl_bk_winner: 'Winner', cl_bk_seed: 'Seed',
      cl_bk_note: 'Projected bracket · seeded by the season sim projected finish · single-elimination model · updates each matchday.',
      cl_bk_no_playoff: 'This competition is decided by the league table, with no knockout stage.', cl_bk_race: 'Title race (projection)',
      cl_bk_soon: 'The projected bracket appears once the season is underway.',
      cl_upcoming: 'Upcoming matches', cl_no_upcoming: 'No matches scheduled in the calendar window.',
      cl_live_recent: 'Live and recent', cl_no_live: 'No club matches in play right now.', cl_no_final: 'No recently finished matches.',
      cl_clubs: 'Clubs',
      cl_squad: 'Squad', cl_no_squad: 'Squad not available.', cl_gk: 'Goalkeepers', cl_def: 'Defenders', cl_mid: 'Midfielders', cl_fwd: 'Forwards', cl_yr: ' yo',
      cl_age: 'Age', cl_height: 'Height', cl_foot: 'Foot', cl_nat: 'Country', cl_contract: 'Contract', cl_nat_team: 'National team',
      cl_foot_l: 'Left', cl_foot_r: 'Right', cl_foot_b: 'Both',
      cl_player_soon: 'Per-90 stats, radar and player archetype arrive with per-match data ingestion for the league.',
      cl_profile: 'Player profile', cl_apps: 'apps', cl_stats90: 'Per-90 stats', cl_shots90: 'Shots/90', cl_sot90: 'On target/90',
      cl_ga: 'Goals / Assists', cl_att_share: '% of attack', cl_scout: 'Scouting read',
      cl_markets: 'Match markets', cl_best_odds: 'best odds across books',
      cl_intel: 'Match intel', cl_anytime: 'anytime goal prob.',
      cl_top: 'Top', cl_of_pos: 'of position', cl_minutes: 'Minutes', cl_startsapps: 'Starts/Apps', cl_goals: 'Goals',
      cl_mbm: 'Match by match', cl_date: 'Date', cl_opp: 'Opponent', cl_sh: 'SH', cl_g: 'G',
      cl_tab_summary: 'Summary', cl_tab_form: 'Form', cl_tab_results: 'Results', cl_no_results: 'No results recorded.', cl_no_news: 'No availability news right now.', cl_local: 'H/A', cl_score: 'Score', cl_home_h: 'H', cl_away_a: 'A',
      cl_season: 'Season projection', cl_champion: 'Champion', cl_top: 'Top', cl_proj_finish: 'Proj. finish', cl_releg: 'Relegation', cl_title_race: 'Title race', cl_remaining: 'matches left', cl_season_note: 'Simulation of the remaining matches (schedule reconstructed) with current strength. Updates every matchday.',
      cl_no_markets: 'No odds available for this match.', cl_h2h: 'Head to head', cl_no_lineups: 'Lineup not published yet (arrives near kickoff).', nav_lineups: 'Lineups',
      nav_context: 'Context', cl_no_context: 'Context unavailable.', cl_injuries: 'Injuries & absences', cl_no_injuries: 'No absences reported.', cl_rest: 'Rest', cl_days: 'days', cl_context_sub: 'Absences from API-Football, rest, form and availability findings from the observation layer.', cl_ctx_applied: 'Context applied (availability)', cl_ctx_base: 'base',
      cl_cross: 'Cross-league matchup: each league is calibrated separately, the comparison is approximate (no inter-league anchoring yet).',
      cl_note_ctx: 'Clubs phase under construction: context, lineups, players and per-league picks arrive after their gates. This analysis uses the model core (ratings + goal projection).',
      cl_xg: 'Expected goals', cl_o25: 'Over 2.5 goals', cl_btts: 'Both teams score', cl_scores: 'Most likely scores',
      pf_empty: 'No active picks right now', pf_empty_sub: 'Daily picks show up here as soon as they are published. Check back soon.',
      pf_yesterday: 'Yesterday: {won} of {total} picks hit', pf_next_ko: 'Next match kicks off at {time} — picks drop a few hours before',
      pf_fam_solid: 'Winner', pf_fam_goals: 'Goals', pf_fam_combo: 'Combo',
      pf_fam_corners: 'Corners', pf_fam_cards: 'Cards', pf_fam_player: 'Player',
      pf_over_corners: 'Over {line} corners', pf_under_corners: 'Under {line} corners',
      pf_over_cards: 'Over {line} cards', pf_under_cards: 'Under {line} cards',
      pf_player_goal: '{player} to score', pf_player_shots: '{player}: over {line} shots', pf_player_sot: '{player}: over {line} shots on target', pf_player_assist: '{player}: to provide an assist',
      pf_wins: '{team} to win', pf_dc: '{team} or draw (double chance)', pf_over: 'Over {line} goals', pf_under: 'Under {line} goals',
      pf_conf: 'Confidence', pf_conf_high: 'High', pf_conf_med: 'Medium', pf_conf_low: 'Moderate', ps_win: 'Win probability', pf_corr_calc: 'Correlation {rho}× measured on the score matrix → if you take both, suggested total stake ≈ {pct}% of the individual sum.', ps_edge: 'Edge', ps_data: 'Data', ps_quality: 'Quality', ps_dc_low: 'Low', ps_q_strong: 'Strong', ps_q_moderate: 'Moderate', ps_q_marginal: 'Marginal', ps_stake: 'Sugg. stake',
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
      adm_fix_group: 'Fix match · Group stage', adm_fix_ko: 'Fix match · Knockout',
      adm_match: 'Match', adm_bracket: 'Bracket', adm_goals_h: 'Team 1 goals', adm_goals_a: 'Team 2 goals', adm_status: 'Status', adm_st_final: 'Final', adm_st_live: 'Live', adm_minute: 'Minute', adm_team1: 'Team 1', adm_team2: 'Team 2', adm_pens: 'If drawn: team 1 won on penalties',
      adm_save: 'Save result', adm_remove: 'Remove result', adm_saving: 'Saving…', adm_saved: 'Saved — probabilities recalculated and pushed to everyone.', adm_removed: 'Result removed.', adm_neterr: 'Network error',
      adm_broadcast: 'Mass email', adm_bc_beta: 'Platform announcement (full design). Often lands in Promotions. Test on yourself first.', adm_bc_reengage: 'Re-engagement (Primary inbox): personal-style email to win back inactives. Test on yourself first.',
      adm_bc_test: '✉ Test', adm_bc_send: '📣 Send to ALL', adm_bc_confirm: 'Send this email to ALL users? This cannot be undone.', adm_bc_sending_test: 'Sending test…', adm_bc_starting: 'Starting send…', adm_bc_test_ok: 'Test sent ({sent}/{total})', adm_bc_started: 'Send started in background… ({total} users)', adm_bc_progress: 'Sending… {sent}/{total}', adm_bc_done: 'Send complete: {sent}/{total}', adm_bc_server: 'Send running on the server (progress unreadable).',
      adm_telegram: 'Telegram', adm_tg_note: 'Posts to the @gpsimulador channel. Automatic: final scores, strong opportunities and the daily summary. These buttons are to test/force.', adm_tg_test: '✈ Test post', adm_tg_daily: '📊 Post today’s summary', adm_tg_sending: 'Posting…', adm_tg_ok: 'Posted to the channel.', adm_tg_fail: 'could not post',
      adm_users: 'User base', adm_users_err: 'Could not load the user base.', adm_verified: 'verified', adm_leads: 'leads', adm_total: 'total', adm_sources: 'Sources', adm_name: 'Name', adm_country: 'Country', adm_lang: 'Language', adm_state: 'State', adm_source: 'Source', adm_reg: 'Signed up', adm_lastseen: 'Last seen',
      // ---- Phase 5: team tabs + account ----
      nav_refer: 'Invite',
      tm_groupwin: 'Win group', tm_groupsecond: '2nd group', tm_out: 'Out', tm_follow: 'Follow', tm_following: 'Following',
      tm_tab_squad: 'Squad', tm_tab_results: 'Results', tm_keyplayers: 'Key players', tm_last5: 'Last 5', tm_mkt_price: 'Price', tm_read: 'Model read', tm_likely_opp: 'Likely opponents', tm_paths: 'Simulated paths',
      tm_next_ctx: 'Next match · GP context', tm_ctx_note: 'Open the match cockpit to see the GP probability with context applied (form, availability, weather).', tm_base_note: "Tournament probabilities reflect the team's base strength per the GP model. Each match's context (form, availability, weather) is applied in that match's cockpit.",
      st_injured: 'Injured', st_suspended: 'Suspended', st_doubt: 'Doubt', st_available: 'Available',
      fol_empty: 'You don’t follow any teams yet', fol_empty_sub: 'Tap the star on a team to follow it.',
      al_events: 'Events', al_channels: 'Channels', al_next: 'Next match', al_start: 'Match start', al_goal: 'Goal', al_result: 'Final result', al_qualify: 'Qualification', al_swing: 'Probability swing', al_value: 'Value opportunity', al_arb: 'Arbitrage', al_email: 'Email', al_telegram: 'Telegram', al_push: 'Push notifications', al_soon: 'soon', al_note: 'Email alerts are active; Telegram and push are coming soon.',
      ref_verified: 'verified referrals', ref_copy: 'Copy link', ref_copied: 'Copied!', ref_tiers: 'Tiers', ref_rule: 'A referral is verified when your invitee confirms their email. Access threshold: 5 verified referrals.',
      aff_available: 'Available', aff_pending: 'Maturing', aff_pending_sub: 'clears after 7 days', aff_paid: 'Paid out', aff_paying: 'referrals with an active subscription', aff_forlife: 'for life', aff_lead: 'You earn a recurring commission for every person who joins with your link and pays for a subscription, as long as it stays active.', aff_wallet: 'Your wallet', aff_wallet_sub: 'You get paid in stablecoins (USDC/USDT). Pick the network you use.', aff_network: 'Network', aff_asset: 'Asset', aff_address: 'Address', aff_address_ph: 'paste your address', aff_save_wallet: 'Save wallet', aff_wallet_saved: '✓ Wallet saved', aff_withdraw: 'Withdraw', aff_request: 'Request withdrawal', aff_wd_open: 'You have a {amt} request in progress.', aff_wd_min: 'You need {min} available to withdraw.', aff_wd_cooldown: 'You already requested a withdrawal this week. Next one in 7 days.', aff_wd_ready: 'You can withdraw {amt} now.', aff_wd_done: '✓ Withdrawal requested. We\'ll email you when it goes out.', aff_rules: 'Min $50 · one withdrawal per week · balance clears 7 days after each payment.', aff_period: 'Period', aff_referral: 'Referral', aff_plan: 'Plan', aff_commission: 'Commission', aff_status: 'Status', aff_st_available: 'available', aff_st_paid: 'paid', aff_st_pending: 'maturing',
      aff_signups: 'signed up with your link', aff_signups_note: 'Everyone who joined through your link, paying or not. Only paid subscriptions earn commission.', aff_signups_h: 'Your sign-ups', aff_su_date: 'Date', aff_su_status: 'Status', aff_su_sub: 'subscribed', aff_su_verified: 'verified', aff_su_reg: 'signed up',
      adm_aff: 'Affiliates', adm_aff_email: 'Affiliate email', adm_aff_rate: 'Commission %', adm_aff_apply: 'Apply', adm_aff_ok: '✓ Rate applied', adm_aff_note: 'Default 10% · max 20% (influencers). The rate is never announced publicly.', adm_aff_empty: 'No affiliates with activity yet', adm_aff_signups: 'Sign-ups', adm_aff_refs: 'Paying', adm_aff_wd: 'Pending withdrawals', adm_aff_pay: 'Pay', adm_aff_reject: 'Reject', adm_aff_tx_ph: 'tx hash (optional)',
      nav_combat: 'Combat',
      // ── COMBAT (R2 28-jul) ──
      sport_futbol: 'Football', sport_combat: 'Combat', sport_nba: 'NBA', sport_soon: 'Coming soon',
      nav_cb_fights: 'Fights', nav_cb_fighters: 'Fighters', nav_cb_orgs: 'Organizations',
      cb_title: 'Combat', cb_opps_title: 'Opportunities', cb_fights_title: 'Fights', cb_fighters_title: 'Fighters', cb_sim_title: 'Simulator', cb_perf_title: 'Performance', cb_orgs_title: 'Organizations', cb_evo_title: 'Evolution', cb_follow_title: 'Following',
      cb_main_event: 'Main event', cb_card: 'Fight card', cb_fights_n: 'fights', cb_rounds: 'rounds', cb_analyze: 'Analyze fight', cb_reach: 'reach', cb_loading: 'Loading…',
      cb_gpprob: 'GP PROBABILITY', cb_market: 'market', cb_books_n: 'books', cb_no_odds: 'no odds yet', cb_best_odds: 'best odds',
      cb_method: 'METHOD OF VICTORY', cb_finish: 'finish', cb_inside2: 'inside 2 rounds', cb_tale: 'Tale of the tape', cb_age: 'Age', cb_height: 'Height', cb_exp: 'Fights', cb_kow: 'KO', cb_subw: 'SUB', cb_streak: 'Streak', cb_intel: 'Intelligence', cb_intel_none: 'No signals — a clean fight, no red flags.',
      cb_recent: 'Last 5', cb_h2h: 'Head to head', cb_odds_by_book: 'Odds by book', cb_form: 'Form',
      cb_search_ph: 'Search fighter…', cb_all_divs: 'All divisions', cb_no_results: 'No results for that search.',
      cb_sim_pick: 'Pick two fighters to simulate the fight.', cb_sim_a: 'Green corner', cb_sim_b: 'Red corner', cb_sim_run: 'Simulate fight', cb_sim_swap: 'Swap corners',
      cb_picks: 'Active picks', cb_value: 'Buy-side value', cb_value_sub: 'best odds vs market consensus', cb_arb: 'Arbitrage', cb_arb_none: 'No executable 2-way arbs right now.', cb_no_picks: 'No active picks — the engine generates when post-blend edge ≥2pp.', cb_monitor: 'private monitor',
      cb_track: 'Track record', cb_settled: 'Settled', cb_no_settled: 'No settled picks yet.', cb_units: 'units', cb_hit: 'hit rate', cb_clv: 'avg CLV',
      cb_org_since: 'since', cb_org_active: 'active', cb_org_next: 'Next event', cb_org_top: 'Elo elite', cb_org_hist: 'historical',
      cb_evo_top: 'The elite over time', cb_evo_up: 'Rising', cb_evo_down: 'Falling', cb_evo_12m: 'last 12 months',
      cb_follow_none: 'You are not following any fighter yet. Open a profile and tap ★ Follow.', cb_follow_btn: 'Follow', cb_following: '★ Following', cb_next_fight: 'Next fight',
      cb_division: 'Division', cb_opp_quality: 'Opposition level', cb_cage_min: 'Cage minutes', cb_ko_losses: 'KO losses', cb_last: 'last',
      pf_fam_method: 'Method', pf_fam_rounds: 'Rounds', cb_mkt_panel: 'Method & rounds · GP vs market', cb_mkt_model: 'GP', cb_mkt_market: 'Market', cb_mkt_src: 'vs market consensus',
      cb_read: 'GP read', cb_matchup: 'Matchup', cb_matchup_sub: 'what tilts the fight and by how much', cb_pred: 'Full prediction', cb_pred_sub: 'every outcome', cb_rdist: 'The fight ends in…', cb_dist_lab: 'Decision',
      cb_fx_misswt: 'condition at the weigh-in', cb_camp: 'Camp', nav_cb_ask: 'Ask GP', cba_ph: 'Ask about a fight or a fighter…', cba_send: 'Ask', cba_intro: 'I answer with what the model actually knows about the loaded cards. If I do not know, I say so.', cba_try: 'Try:', cba_open: 'Open the full breakdown →', cba_thinking: 'Looking…', cbm_title: 'The market moved', cbm_sub: 'open → now, and which way', cbm_with: 'WITH US', cbm_against: 'AGAINST', cbm_snaps: 'reads', cbm_none: 'No relevant moves yet. The price archive is only hours old: this fills itself in.', nav_cb_card: 'Map of the night', cbc_night: 'The shape of the night', cbc_fin_exp: 'fights end inside the limit', cbc_rounds_exp: 'total rounds', cbc_dist: 'How many end inside the limit', cbc_early: 'Most likely to end early', cbc_far: 'Most likely to go the distance', cbc_gap: 'Widest gap vs the market', cbc_card_sel: 'Card', cbc_sims: 'across 10,000 simulated nights', cb_ref: 'Referee:', cb_judges: 'Judges:',
      cbb_next: 'The next card', cbb_div: 'Where GP and the market disagree', cbb_div_sub: 'the widest gaps on the card', cbb_intel: 'Signals from the camp', cbb_picks: 'On the monitor', cbb_recent: 'How we are doing', cbb_none: 'Nothing to report right now.', cbb_cards: 'Cards ahead', cbb_model: 'GP', cbb_market: 'market', cbb_fights_n: 'fights',
      cb_live: 'LIVE', cb_live_sub: 'the probability moves with the clock', cb_live_pre: 'before the opening bell', cb_live_now: 'now', cb_live_fin: 'ends inside the limit', cb_live_dec: 'goes to decision', cb_live_left: 'rounds ahead', cb_live_tl: 'Fight timeline', cb_live_note: 'The timeline arrives unattributed from the official feed: these are facts of the fight, not of a fighter. The probability is moved by the model and the clock.',
      cb_film: 'Film study', cb_film_sub: 'what the tape says', cb_film_none: 'Not enough recorded action to read the tape on this matchup.', cb_film_what: 'Automated reading of the recorded action of every fight (where the strikes go and with how much intent, how the ground game enters, which round their fights close in). This is not video analysis.', cb_film_pace: 'Pace', cb_film_target: 'Strike split', cb_film_power: 'Intent', cb_film_gr: 'Ground', cb_film_ctrl: 'Control', cb_film_early: 'Closes early', cb_film_deep: 'Deep water',
      cb_conf_high: 'High confidence', cb_conf_med: 'Medium confidence', cb_conf_low: 'Low confidence', cb_conf_sub_low: 'small sample or thin market — the system knows it',
      cb_fx_elo: 'Proven level', cb_fx_reach: 'Reach', cb_fx_exp: 'Experience', cb_fx_years: 'Career wear', cb_fx_age: 'Age', cb_fx_chin: 'Durability', cb_fx_streak: 'Momentum', cb_fx_mileage: 'Cage craft',
      cb_momentum: 'Momentum', cb_mom_delta: 'last 12 months', cb_quality: 'Quality of wins', cb_q_elite: 'elite beaten', cb_q_strong: 'tough opponents', cb_q_top: 'Best wins',
      cb_pace: 'Pace & gas tank', cb_pace_r1: 'finishes in R1', cb_pace_deep: 'in deep water (R3+)', cb_pace_dist: 'goes to decision', cb_similar: 'Similar profiles', cb_sim_pct: 'match',
      cb_wins_by: 'Wins by', cb_loses_by: 'Loses by', cb_upd: 'updated',
      cb_sims: '10,000 simulations', cb_style_hist: 'Style history', cb_style_line: 'Historically, {a} beats {b} {pct}% of the time ({n} fights)', cb_style_of: 'Profile',
      cb_striking: 'Striking engine', cb_grappling: 'Grappling engine', cb_slpm: 'Strikes/min', cb_head: 'Head', cb_body: 'Body', cb_legs: 'Legs', cb_power: 'Power', cb_kd15: 'KD per 15min', cb_td15: 'Takedowns/15min', cb_tdacc: 'TD accuracy', cb_tddef: 'TD defense', cb_sub15: 'Sub attempts/15', cb_ctrl: 'Cage control', cb_fine_n: 'fights with fine metrics (2022+)', cb_fine_src: 'modern era',
      tb_lead: 'Try Sharp FREE for 3 days', tb_sub: '$0 today · cancel in one click', tb_cta: 'Start my trial',
      tm_eyebrow: 'Free trial · 3 days', tm_title: 'Try Sharp without paying today', tm_sub: 'The full plan, unlocked for 3 days. Not for you? Cancel in one click and nothing gets charged.',
      tm_b1: 'Every daily pick with suggested stake', tm_b2: 'Value & arbitrage across 40+ sportsbooks', tm_b3: 'Your personal bet tracker with real ROI', tm_b4: 'Public verified track record — wins and losses',
      tm_cta: 'Start my 3 free days', tm_micro: '$0 today · $59/mo only if you stay · cancel anytime', tm_no: 'Not now',
      adm_grant_plan: 'Manual subscription', adm_grant_give: 'Grant plan', adm_grant_revoke: 'Remove plan', adm_grant_ok: '✓ Applied', adm_grant_note: 'Grants Pro/Sharp access without payment (uses the email above). For influencers or comps. "Remove plan" sets them back to Free.',
      ref_t1: 'Ambassador', ref_t3: 'Silver', ref_t5: 'Gold · access', ref_t10: 'Legend',
      perf_sample: 'Sample', perf_method: 'Methodology', perf_method_b: 'Verifiable metrics over settled signals since the Verified Epoch: Brier (calibration), Log loss (penalizes extreme errors) and ECE (calibration error). We don’t claim profitability with a small sample.',
      perf_total: 'Evaluated', perf_hits: 'Hits', perf_exact: 'Exact score', perf_vs_market: 'GP vs market', perf_hitrate: 'Hit rate (1X2)',
      pp_title: 'Picks performance', pp_settled: 'Settled', pp_hit: 'Win rate', pp_roi: 'ROI', pp_pnl: 'P&L', pp_byfam: 'By family', pp_history: 'Picks history', pp_hist_window: 'Last {shown} of {total} settled', pp_pick: 'Pick', pp_active: 'active', pp_none: 'No settled picks yet.', pp_model: 'Model calibration (1X2)',
      lm_with: 'Market moved with us ({pp}pp) since publication', lm_against: 'Market moved against us ({pp}pp) since publication',
      pf_why_btn: 'Why this pick', reads_title: 'System reads',
      st_title: 'Tactical profile', st_sub: 'tournament, shot by shot', st_sub_club: 'season, shot by shot', st_findings: 'Matchup findings', st_xg: 'xG per match', st_xga: 'xG against', st_corners_pct: 'Corner threat', st_sp_pct: 'Set pieces', st_counter_pct: 'Counter attack', st_aerial: 'Aerial game', st_c90: 'Corners per match', st_cards: 'Cards per match', st_note: 'Percentages = share of threat created through that route. Green = leads the comparison.',
      sf_corner_edge: 'Corner edge for {team}: creates from that route right where the rival concedes', sf_set_piece_edge: 'Set piece edge for {team}: their threat comes from where the rival struggles', sf_aerial_edge: 'Aerial edge for {team}: heading threat against a side that concedes in the air', sf_counter_edge: '{team} hurts on the break and the opponent concedes in transitions', sf_zone_overlap: '{team}\'s favorite attacking sector matches the zone where the rival concedes most', sf_volume_edge: '{team} creates volume against a defense that has been conceding',
      qm_title: 'Pick quality vs the market', qm_clv: 'Avg CLV', qm_clv_sub: 'value vs closing line', qm_beat_close: 'Beat the close', qm_brier_gp: 'GP accuracy', qm_brier_mkt: 'Consensus accuracy', qm_brier_sub: 'Brier, lower is better', qm_skill: 'GP edge', qm_cal_title: 'Calibration by range', qm_cal_note: 'When the system projects a probability range, this is what actually happened.', qm_cal_range: 'Projected', qm_cal_obs: 'Actual', qm_cal_n: 'Picks', qm_clv_note: 'Positive CLV = we took a better price than the market close. It is the professional measure of pick quality.',
      opp_value_empty: 'No actionable Value right now', opp_value_empty_sub: 'The engine keeps evaluating; it appears when GP finds an edge over the price.',
      outright_title: 'World Cup winner · Value', outright_sub: 'GP tournament probability vs market', outright_none: 'No edge over the market for the title right now.',
      tm_gpi: 'GP Intelligence · title', tm_gpi_model: 'GP probability (champion)', tm_gpi_market: 'Market', tm_gpi_edge: 'GP edge', tm_gpi_note: 'Probability of winning the title per the GP tournament model. Each match\'s context (form, availability, weather) is applied in the match cockpit and in the next match below.',
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
      gp_pending_ctx: 'The GP context evaluation for this match hasn’t been generated yet; the GP model’s base probability is shown. Detailed context (form, absences, etc.) is in the Context tab.',
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
      calc_mode_pf: 'Daily portfolio',
      cpf_intro: 'Your portfolio for the day: suggested stake per pick (fractional Kelly), intra-match correlation applied and a daily risk limit.',
      cpf_empty: 'No picks kicking off in the next 24 hours.', cpf_empty_sub: 'The portfolio builds itself when there are active picks for the day.',
      cpf_n_picks: '{n} picks · next 24 h', cpf_day_limit: 'Daily limit', cpf_of_day: 'of bankroll',
      cpf_total_stake: 'Recommended total stake', cpf_total_risk: 'Total risk for the day', cpf_max_loss: 'Est. max loss (95%)', cpf_exp_pnl: 'Expected result',
      cpf_by_match: 'Exposure by match', cpf_by_league: 'Exposure by league', cpf_picks: 'Stake per pick',
      cpf_corr_note: 'Same-match picks have their stake adjusted for correlation (ρ measured on the score matrix).',
      cpf_scaled: 'The suggested sum ({sum}) exceeded your daily limit — all stakes were scaled to {pct}% to respect it.',
      cpf_maxloss_note: 'On 95% of days you would not lose more than this (simulated with today’s probabilities and correlations). Absolute worst case = the total risk.',
      nav_bets: 'My bets', nav_books: 'My books', nav_brief: 'Daily Brief',
      pf_empty_live: 'No picks from live matches right now', pf_empty_up: 'No picks from upcoming matches', pf_empty_filt_sub: 'Check "All" to see every active pick.',
      mb_title: 'My bets', mb_intro: 'Log what you bet (with or without a GP pick) and mark the result — personal P&L, ROI and CLV, plus your performance following GP vs your own bets.',
      mb_add: 'Log a bet', mb_pick: 'GP pick (optional)', mb_manual_opt: 'Manual bet (no pick)', mb_label: 'Description', mb_odds: 'Odds', mb_stake: 'Stake', mb_book: 'Book (optional)', mb_save: 'Save',
      mb_pnl: 'P&L', mb_roi: 'ROI', mb_record: 'Record', mb_clv: 'Personal CLV', mb_open: 'Open', mb_gp: 'Following GP', mb_manual: 'Manual',
      mb_result: 'Result', mb_won: 'Won', mb_lost: 'Lost', mb_void: 'Void', mb_reopen: 'Reopen', mb_del: 'Delete', mb_del_confirm: 'Delete this bet from the log?',
      mb_empty: 'No bets logged yet', mb_empty_sub: 'Log your first bet and your personal P&L starts building itself.',
      mb_note: 'Personal, private log. CLV uses the pick’s official closing price when available.',
      bk_title: 'My books', bk_intro: 'Mark the sportsbooks where you have an account: the feed shows which picks are executable for you and which are priced best at a book you don’t have.',
      bk_save: 'Save', bk_saved: 'Saved', bk_custom: 'Another book…', bk_add: 'Add', bk_only_mine: 'My books only', bk_not_mine: 'best odds at a book you don’t have',
      bk_sportsbooks: 'Sportsbooks we cover', bk_crypto: 'Crypto sportsbooks', bk_prediction: 'Prediction markets',
      bk_empty: 'No active pick is quoted at your books', bk_hidden: '{n} opportunities hidden by "My books only" — tap the filter to see them all.', bk_empty_sub: 'Turn off "My books only" to see all picks, or add more books in My books.',
      wp_watch: 'Watch price', wp_target: 'Alert me if the best odds reach', wp_set: 'Create alert', wp_created: 'Alert created',
      wp_list: 'Watched prices', wp_hit: 'Hit', wp_expired: 'Expired', wp_active: 'Watching', wp_last: 'last', wp_target_s: 'target', wp_none: 'No watched prices. Create one from any pick with "Watch price".',
      bf_title: 'GP Daily Brief', bf_sub: 'Your daily summary: opportunities, matches, line moves and results.',
      bf_top: 'Top opportunities today', bf_matches: 'Today’s matches', bf_moves: 'Line moves', bf_findings: 'Availability watch', bf_yesterday: 'Yesterday’s results', bf_bankroll: 'Your bets',
      bf_email: 'Get the brief by email every day', bf_email_saved: 'Preference saved',
      bf_empty: 'The brief builds itself when there are active picks for the day.', bf_yn: '{wins}W-{losses}L of {n} settled',
      bf_move_with: 'toward our side', bf_move_against: 'against',
    }
  };
  var LANG = 'es', TEAMS = {};
  // P4 (red sistémica): un arg null/undefined jamás filtra el placeholder interno ({gf}, {ga}, …) al usuario —
  // si se PASÓ el arg pero vino null → "—"; si la llamada no pasa args para ese placeholder, se conserva el
  // literal (señal de bug para el auditor estático, no alcanzable en producción con los call sites actuales).
  var t = function (k, a) { var s = (DICT[LANG] && DICT[LANG][k]) || (DICT.es[k] != null ? DICT.es[k] : k); return String(s).replace(/\{(\w+)\}/g, function (m, x) { if (!a) return m; return a[x] != null ? a[x] : (x in a ? '—' : m); }); };
  // FASE CLUBES: ids tm_ (clubes) resuelven por el índice de clubes (S.clubNames, poblado por loadClubs) → las
  // MISMAS funciones/render del Mundial sirven partidos de club sin bifurcar (regla: extensión, no variantes).
  var teamName = function (id, fb) { if (id && /^tm_/.test(id)) { return (S.clubNames && S.clubNames[id]) || fb || id; } var e = TEAMS[id]; return (e && e[LANG]) || (e && e.es) || fb || id || ''; };

  // ---------- format ----------
  var pct = function (v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; };
  var pct0 = function (v) { return v == null ? '—' : Math.round(v * 100) + '%'; };
  var pp = function (v) { return v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + ' pp'; };
  var odd = function (v) { return v == null ? '—' : Number(v).toFixed(2); };
  var FLAGS = {};
  // Banderas SVG self-hosted (nítidas en todos los OS — los emoji NO renderizan en Windows). Escala con el
  // font-size del contenedor (.fl) vía em. Fallback al emoji del server para ids fuera de los 48 del Mundial.
  var KNOWN_FLAG = /^(MEX|KOR|CZE|RSA|SUI|CAN|BIH|QAT|BRA|MAR|SCO|HAI|TUR|PAR|AUS|USA|ECU|GER|CIV|CUW|NED|JPN|SWE|TUN|BEL|IRN|EGY|NZL|ESP|URU|CPV|KSA|FRA|NOR|SEN|IRQ|ARG|AUT|ALG|JOR|POR|COL|UZB|COD|ENG|CRO|PAN|GHA)$/;
  var flag = function (id) { if (!id) return ''; if (/^tm_/.test(id)) return '<img class="clx" src="/logos/' + id + '.png" alt="" draggable="false" onerror="this.remove()">'; if (KNOWN_FLAG.test(id)) return '<img class="flx" src="/flags/' + id + '.svg" alt="" draggable="false">'; return FLAGS[id] || ''; };
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
    cloudbet: 'Cloudbet', stake: 'Stake', rollbit: 'Rollbit', bcgame: 'BC.Game', sportsbetio: 'Sportsbet.io', bitcasino: 'Bitcasino', livecasino: 'Livecasino',
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

  // ---- logos de casas/exchanges/prediction markets (misma línea visual que las banderas: SVG self-hosted
  // en /books/, cache inmutable). Marca desconocida → sin logo (el onerror lo quita), jamás un tile roto.
  var BOOK_BRAND_ALIAS = { betfair_ex_eu: 'betfair', betfair_ex_uk: 'betfair', betfair_sb_uk: 'betfair', sport888: '888sport', onexbet: 'onexbet', pointsbetau: 'pointsbet', mybookieag: 'mybookie', betonlineag: 'betonline', betfred_uk: 'betfred', '10bet': 'tenbet' };
  function bookBrand(code) {
    if (!code) return null;
    var c = String(code).toLowerCase();
    if (BOOK_BRAND_ALIAS[c]) return BOOK_BRAND_ALIAS[c];
    var b = c.replace(/_(uk|us|us2|eu|au|fr|de|nl|se|se2|ag)$/g, '').replace(/_(uk|us|us2|eu|au|fr|de|nl|se|se2|ag)$/g, '');
    return BOOK_BRAND_ALIAS[b] || b;
  }
  function bookLogo(code) {
    var b = bookBrand(code); if (!b || !/^[a-z0-9]+$/.test(b)) return '';
    // logo OFICIAL (favicon/app-icon real de la marca, self-hosted .png) → fallback tile monograma .svg → nada
    return '<img class="bkx" src="/books/' + b + '.png" alt="" draggable="false" onerror="if(this.dataset.f){this.remove()}else{this.dataset.f=1;this.src=\'/books/' + b + '.svg\'}">';
  }
  // casa con logo + nombre (para cards/tablas; en textos corridos se sigue usando prettyBook solo)
  function bookChip(code) { if (!code) return ''; return '<span class="gx-bkchip">' + bookLogo(code) + esc(prettyBook(code)) + '</span>'; }
  // FASE CLUBES: escudo OFICIAL de club (self-hosted /logos/<tm_id>.png, mismo trato que banderas/casas). Se
  // auto-remueve si el club no tiene logo → degrada al ícono genérico sin hueco. leagueLogo = logo de la liga.
  function clubLogo(id) { if (!id || !/^tm_[a-z0-9]+$/i.test(id)) return ''; return '<img class="clx" src="/logos/' + id + '.png" alt="" draggable="false" onerror="this.remove()">'; }
  function leagueLogo(key) { if (!key || !/^[a-z0-9]+$/.test(key)) return ''; return '<img class="clx-lg" src="/logos/league-' + key + '.png" alt="" draggable="false" onerror="this.remove()">'; }

  // ---- índice de jugadores (perfil por jugador): buscador + resolución nombre→pid en alineaciones y
  // plantillas. Se carga solo si el server lo permite (mismo gate que el perfil: admin-first).
  var pnorm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, ''); };
  function loadPlayerIndex() {
    if (S.pidx !== undefined) return;
    S.pidx = null;
    fetch('/api/beta/player-index', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
      if (!d || !d.players || !d.players.length) return;
      var byTeam = {};
      d.players.forEach(function (p) {
        var tm = byTeam[p.team] || (byTeam[p.team] = { full: {}, last: {}, dup: {} });
        var full = pnorm(p.name);
        tm.full[full] = p.pid;
        var last = pnorm(String(p.name).trim().split(/\s+/).pop());
        if (last.length >= 3) {
          if (tm.last[last] && tm.last[last] !== p.pid) { tm.dup[last] = 1; delete tm.last[last]; }
          else if (!tm.dup[last]) tm.last[last] = p.pid;
        }
      });
      S.pidx = { list: d.players, byTeam: byTeam };
    });
  }
  // GAP-AUDIT 1: índice de jugadores de CLUB para el buscador global (paridad con loadPlayerIndex del Mundial).
  function loadClubsPlayerIndex() {
    if (S.cpidx !== undefined || !clubsOn()) return;
    S.cpidx = null;
    fetch('/api/beta/clubs-player-index', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
      if (!d || !d.players || !d.players.length) return;
      S.cpidx = { list: d.players };
    });
  }
  function pidxResolve(teamId, rawName) {
    if (!S.pidx || !teamId || !rawName) return null;
    var tm = S.pidx.byTeam[teamId]; if (!tm) return null;
    var n = pnorm(rawName);
    if (tm.full[n]) return tm.full[n];
    var last = pnorm(String(rawName).trim().split(/\s+/).pop());
    return tm.last[last] || null;
  }
  // nombre de jugador → link al perfil (si el índice está cargado y el nombre resuelve); si no, texto plano
  function playerLink(teamId, rawName, inner) {
    // FASE CLUBES: para equipos tm_ el índice viene del server (pid en las alineaciones) → perfil cplayer.
    if (teamId && /^tm_/.test(teamId)) {
      var cx = S.clubPidx && S.clubPidx[teamId];
      var cpid = cx && rawName ? cx.byName[pnorm(rawName)] : null;
      if (!cpid) return inner;
      return '<a href="#cplayer/' + esc(cx.league + '-' + teamId + '-' + cpid) + '" class="gx-plk">' + inner + '</a>';
    }
    var pid = pidxResolve(teamId, rawName);
    if (!pid) return inner;
    return '<a href="#player/' + esc(pid) + '" class="gx-plk">' + inner + '</a>';
  }

  // ---------- state ----------
  var S = { sport: 'futbol', cb: {}, dash: null, value: null, sel: null, match: null, sub: 'picks', filt: 'all', mc: {}, view: 'board', matchId: null, fixtures: [], mfix: {},
    cal: [], stTeams: [], canon: [], canonByKey: {}, mFilt: 'all', mStage: 'all', mQuery: '', sim: { a: null, b: null, data: null, loading: false },
    groups: [], standings: {}, knockoutRaw: [], history: [], teamId: null, tcache: {}, hist: null, registry: null, tQuery: '', obs: undefined,
    teamTab: 'resumen', me: null, refer: null, perf: undefined, evoFilt: 'top', oppSub: 'picks', arb: undefined, arbSub: 'pure', arbCtx: null, pendingSec: null, h2h: {}, xgr: {}, intel: {}, style: {} };

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
    // COMBATE (R2): guante y cinturón — mismos trazos del set
    'glove': '<path d="M7.5 11V7.8A3.3 3.3 0 0 1 10.8 4.5h3.4a3.3 3.3 0 0 1 3.3 3.3V12a5 5 0 0 1-5 5h-.6"/><path d="M7.5 11a2.2 2.2 0 0 0 0 4.4h2"/><path class="a" d="M11 8.2h3.6"/><path d="M9.5 17v2.5h5.8"/>',
    'belt': '<ellipse cx="12" cy="12" rx="5" ry="4.2"/><path d="M7 9.6 3.5 8.4v7.2L7 14.4M17 9.6l3.5-1.2v7.2L17 14.4"/><path class="a" d="M12 9.9l.9 1.5 1.7.2-1.2 1.2.3 1.7-1.7-.8-1.7.8.3-1.7-1.2-1.2 1.7-.2Z"/>',
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
  var NAV2 = [['brief', 'news', 'nav_brief'], ['bets', 'wallet', 'nav_bets'], ['books', 'building-bank', 'nav_books'], ['groups', 'layout-grid', 'nav_groups'], ['bracket', 'tournament', 'nav_bracket'], ['evo', 'trending-up', 'nav_evo'], ['registry', 'file-check', 'nav_registry'], ['refer', 'user-plus', 'nav_refer'], ['method', 'book', 'nav_method'], ['admin', 'settings', 'nav_admin']];
  // ── COMBATE (R2): navegación PROPIA del deporte — la sidebar entera cambia con el deporte activo.
  // Espejo conceptual del fútbol: Oportunidades/Peleas/Peleadores/Simulador/Seguidos/Alertas/Rendimiento.
  var NAV_CB = [
    ['cbopps', 'target-arrow', 'nav_opps'], ['cbbrief', 'news', 'nav_brief'], ['cbcard', 'layout-grid', 'nav_cb_card'], ['cbask', 'message-circle', 'nav_cb_ask'], ['cbfights', 'glove', 'nav_cb_fights'], ['cbfighters', 'user', 'nav_cb_fighters'],
    ['cbsim', 'arrows-shuffle', 'nav_sim'], ['cbfollow', 'star', 'nav_follow'], ['alerts', 'bell', 'nav_alerts'], ['cbperf', 'chart-line', 'nav_perf']
  ];
  var NAV2_CB = [['bets', 'wallet', 'nav_bets'], ['books', 'building-bank', 'nav_books'], ['cborgs', 'belt', 'nav_cb_orgs'], ['cbevo', 'trending-up', 'nav_evo'], ['refer', 'user-plus', 'nav_refer'], ['admin', 'settings', 'nav_admin']];
  var CB_VIEWS = ['cbopps', 'cbbrief', 'cbcard', 'cbask', 'cbfights', 'cbfight', 'cbfighters', 'cbfighter', 'cbsim', 'cbfollow', 'cbperf', 'cborgs', 'cbevo'];
  // Vistas COMPARTIDAS entre deportes (la cuenta es una sola: cartera, casas, alertas, invitar, admin…).
  // No pertenecen a ningún deporte → no deben arrastrarte de Combate a Fútbol: el shell se queda donde estás.
  var SHARED_VIEWS = ['bets', 'books', 'alerts', 'refer', 'calc', 'sub', 'support', 'admin'];
  // LANZAMIENTO PÚBLICO DE COMBATE: con el flag ON, cualquier usuario con sesión entra a las superficies de
  // INTELIGENCIA; las de PICKS (Oportunidades y Rendimiento) siguen siendo admin. Con el flag OFF, todo
  // combate es admin-only igual que hoy.
  var CB_PICK_VIEWS = ['cbopps', 'cbperf'];
  function cbCanSee(v) {
    if (!S.me) return false;
    if (S.me.isAdmin) return true;
    if (!S.me.combatPublic) return false;
    return CB_PICK_VIEWS.indexOf(v) < 0;
  }
  function cbSportAllowed() { return !!(S.me && (S.me.isAdmin || S.me.combatPublic)); }
  function sportOf(v) {
    if (CB_VIEWS.indexOf(v) >= 0) return 'combat';
    if (SHARED_VIEWS.indexOf(v) >= 0) return S.sport || 'futbol'; // neutral: conserva el deporte activo
    return 'futbol';
  }

  function viewNav(v) {
    if (v === 'cbfight') return 'cbfights';
    if (v === 'cbfighter') return 'cbfighters';
    if (CB_VIEWS.indexOf(v) >= 0) return v;
    return v === 'team' ? 'teams' : (['matches', 'teams', 'sim', 'groups', 'bracket', 'evo', 'registry', 'method', 'admin', 'follow', 'alerts', 'refer', 'perf', 'calc', 'sub', 'support', 'bets', 'books', 'brief', 'combat'].indexOf(v) >= 0 ? v : 'opps');
  }
  // BANNER FOUNDER (growth): barra superior a todo ancho anunciando el programa. Solo cuando el server
  // enciende founder_public (lanzamiento). Cierra por sesión, pero la env manda. Click → /founder.
  function founderBanner() {
    return ''; // FASE POST-MUNDIAL (20-jul): programa founder CERRADO → banner retirado. La página de planes
    // y "Mi suscripción" siguen accesibles (founder_public sigue true = superficie de precios pública).
    // eslint-disable-next-line no-unreachable
    if (!(S.me && S.me.founder_public)) return '';
    if (S.me.plan === 'sharp' && S.me.plan_founder) return ''; // ya es founder Sharp: no le vendemos
    // Urgencia por DEADLINE real (cierra con la final 19-jul 19:00Z), no por cupos: el contador de cupos
    // pasó a segundo plano en /founder (decisión 13-jul). Texto estático por render; el banner se
    // redibuja con la navegación, no necesita reloj vivo.
    var ms = Date.UTC(2026, 6, 19, 19, 0, 0) - Date.now();
    var cdTxt = ms > 0
      ? t('fb_close', { t: Math.floor(ms / 86400000) + 'd ' + Math.floor(ms % 86400000 / 3600000) + 'h' })
      : t('fb_sub');
    return '<a class="gx-fbanner" href="/plans">' +
      '<span class="gx-fbanner-pulse"></span>' +
      '<b>' + esc(t('fb_lead')) + '</b>' +
      '<span class="gx-fbanner-sub">' + esc(t('fb_sub')) + '</span>' +
      '<span class="gx-fbanner-spots">⏳ ' + esc(cdTxt) + '</span>' +
      '<span class="gx-fbanner-cta">' + esc(t('fb_cta')) + ' ' + ic('arrow-right') + '</span>' +
      '</a>';
  }

  // Banner IN-APP para usuarios FREE (post-Mundial): CTA de upgrade a /plans. Reusa el markup del founder
  // banner (retirado). Solo plan free; paid/admin → vacío. Se pinta en el mismo slot cuando llega S.me.
  function freeBanner() {
    if (!S.me || uiPlan() !== 'free') return '';
    // FREE TRIAL (27-jul): si es elegible, el banner in-app VENDE la prueba gratis (clickeable directo al
    // checkout del trial); si ya la usó, cae al banner de upgrade de siempre.
    if (S.me.trial_eligible) {
      return '<a class="gx-fbanner gx-freebanner gx-trialbanner" href="/api/founder/checkout?plan=sharp_t">' +
        '<span class="gx-fbanner-pulse"></span>' +
        '<b>' + esc(t('tb_lead')) + '</b>' +
        '<span class="gx-fbanner-sub">' + esc(t('tb_sub')) + '</span>' +
        '<span class="gx-fbanner-cta">' + esc(t('tb_cta')) + ' ' + ic('arrow-right') + '</span>' +
        '</a>';
    }
    return '<a class="gx-fbanner gx-freebanner" href="/plans">' +
      '<span class="gx-fbanner-pulse"></span>' +
      '<b>' + esc(t('frb_lead')) + '</b>' +
      '<span class="gx-fbanner-sub">' + esc(t('frb_sub')) + '</span>' +
      '<span class="gx-fbanner-cta">' + esc(t('frb_cta')) + ' ' + ic('arrow-right') + '</span>' +
      '</a>';
  }
  // Rellena el slot del banner cuando llega S.me (shell se dibuja antes de /api/me). Founder cerrado → si no
  // hay founder banner, muestra el banner de upgrade para free.
  function syncFounderBanner() { var slot = $('#gx-fbanner-slot'); if (slot) slot.innerHTML = founderBanner() || freeBanner(); }

  function shell() {
    var cur = viewNav(S.view), live = ['opps', 'matches', 'teams', 'sim', 'follow', 'alerts', 'perf', 'groups', 'bracket', 'evo', 'registry', 'method', 'refer', 'admin', 'bets', 'books', 'brief'].concat(CB_VIEWS); // vistas implementadas (clickeables)
    var isCombat = S.sport === 'combat';
    // Back office solo-admin en /x: Rendimiento, Registro y Metodología se ocultan a usuarios beta (producto = picks, no quant).
    var NAV_A = isCombat ? NAV_CB : NAV, NAV_B = isCombat ? NAV2_CB : NAV2;
    var navHtml = NAV_A.map(function (n) { var clk = live.indexOf(n[0]) >= 0; return '<div class="gx-nav' + (n[0] === cur ? ' on' : '') + '"' + (clk ? ' data-nav="' + n[0] + '"' : '') + '>' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></div>'; }).join('');
    // F1/F2/F4: items gateados por flag del server (S.me.my_bets/my_books/daily_brief) — patrón gx-admin-only.
    var FEAT_NAV = { bets: 'gx-feat-bets', books: 'gx-feat-books', brief: 'gx-feat-brief' };
    var nav2 = NAV_B.map(function (n) { var clk = live.indexOf(n[0]) >= 0; var adminOnly = (n[0] === 'admin' || n[0] === 'registry' || n[0] === 'method' || n[0] === 'cbperf' || n[0] === 'cbopps') ? ' gx-admin-only' : (FEAT_NAV[n[0]] ? ' ' + FEAT_NAV[n[0]] : ''); var hid = adminOnly ? ' style="display:none"' : ''; return '<div class="gx-nav' + adminOnly + (n[0] === cur ? ' on' : '') + '"' + hid + (clk ? ' data-nav="' + n[0] + '"' : '') + '>' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></div>'; }).join('');
    var moreViews = isCombat ? ['cbfollow', 'alerts', 'cbperf', 'cborgs', 'cbevo', 'refer', 'admin', 'bets', 'books'] : ['follow', 'alerts', 'perf', 'groups', 'bracket', 'evo', 'registry', 'refer', 'method', 'admin', 'bets', 'books', 'brief'];
    var bnavItems = isCombat
      ? [['cbopps', 'target-arrow', 'nav_opps'], ['cbfights', 'glove', 'nav_cb_fights'], ['cbsim', 'arrows-shuffle', 'nav_sim'], ['cbfighters', 'user', 'nav_cb_fighters'], ['__more', 'dots', 'more']]
      : [['opps', 'target-arrow', 'nav_opps'], ['matches', 'ball-football', 'nav_matches'], ['sim', 'arrows-shuffle', 'nav_sim'], ['teams', 'shield', 'nav_teams'], ['__more', 'dots', 'more']];
    var bnav = bnavItems
      .map(function (n) { if (n[0] === '__more') { var act = moreViews.indexOf(cur) >= 0 ? ' on' : ''; return '<a class="' + act.trim() + '" data-more="1">' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></a>'; } var clk = live.indexOf(n[0]) >= 0; return '<a class="' + (n[0] === cur ? 'on' : '') + '"' + (clk ? ' data-nav="' + n[0] + '"' : '') + '>' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></a>'; }).join('');
    $('#gx-root').innerHTML =
      '<div class="gx">' +
      '<aside class="gx-side">' +
      '<div class="gx-brand"><div class="gx-logo" aria-hidden="true"><svg viewBox="0 0 34 34" width="34" height="34"><defs><linearGradient id="gxg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#12B98A"/><stop offset="1" stop-color="#1FE3A4"/></linearGradient></defs><rect x="8.5" y="18" width="4" height="8.5" rx="2" fill="rgba(31,227,164,.34)"/><rect x="15" y="13.5" width="4" height="13" rx="2" fill="rgba(31,227,164,.62)"/><rect x="21.5" y="7.5" width="4" height="19" rx="2" fill="url(#gxg)"/></svg></div><div><b>GP Intelligence</b><span>Sports intelligence</span></div></div>' +
      '<div class="gx-navgroup">' + navHtml + '</div>' +
      '<div class="gx-navgroup"><div class="gx-label">' + esc(t('more')) + '</div>' + nav2 + '</div>' +
      '<div class="gx-side-foot"><div class="gx-avatar">' + esc(((S.me && S.me.email) || 'G').charAt(0).toUpperCase()) + '</div><div style="font-size:12px"><b style="font-weight:600">' + esc((S.me && S.me.email) ? S.me.email.split('@')[0] : 'GP') + '</b><div class="gx-dim" style="font-size:10.5px">' + esc(S.me && S.me.isAdmin ? 'Admin' : 'GP Intelligence') + '</div></div></div>' +
      '</aside>' +
      '<div class="gx-body">' +
      '<div id="gx-fbanner-slot">' + (founderBanner() || freeBanner()) + '</div>' +
      '<header class="gx-top">' +
      '<div class="gx-top-brand"><div class="gx-logo" aria-hidden="true"><svg viewBox="0 0 34 34" width="34" height="34"><defs><linearGradient id="gxg" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#12B98A"/><stop offset="1" stop-color="#1FE3A4"/></linearGradient></defs><rect x="8.5" y="18" width="4" height="8.5" rx="2" fill="rgba(31,227,164,.34)"/><rect x="15" y="13.5" width="4" height="13" rx="2" fill="rgba(31,227,164,.62)"/><rect x="21.5" y="7.5" width="4" height="19" rx="2" fill="url(#gxg)"/></svg></div><b>GP Intelligence</b></div>' +
      '<div class="gx-search">' + ic('search') + '<input id="gx-search-i" autocomplete="off" spellcheck="false" placeholder="' + esc(t('search')) + '"><div class="gx-search-res" id="gx-search-res" hidden></div></div>' +
      // R2 (28-jul, orden de Alexis): fuera el contador 0-0-0 (gx-pulse) → la búsqueda respira; el
      // selector de deporte vive en su PROPIA barra bajo el header (sportbar) — ahí caben más deportes.
      '<div class="gx-spacer"></div>' +
      '<div class="gx-langs" id="gx-langs"><button data-l="es" class="' + (LANG === 'es' ? 'on' : '') + '">ES</button><button data-l="en" class="' + (LANG === 'en' ? 'on' : '') + '">EN</button></div>' +
      '<div class="gx-iconbtn" data-nav="alerts" title="' + esc(t('nav_alerts')) + '">' + ic('bell') + '<span class="gx-dot"></span></div>' +
      '<div class="gx-acct"><button class="gx-avatar-btn" id="gx-avatar-btn" aria-label="' + esc(t('account')) + '">' + ic('user') + '</button><div class="gx-acct-menu" id="gx-acct-menu" hidden></div></div>' +
      '</header>' +
      // ── SPORTBAR (R2): el conmutador de deporte — cambia TODA la plataforma (sidebar+vistas). Combate es
      // admin-only hasta validar (no-admins lo ven "Próximamente" = teaser del roadmap, cero fuga de producto).
      '<div class="gx-sportbar" id="gx-sportbar">' +
        '<button class="gx-sport' + (S.sport !== 'combat' ? ' on' : '') + '" data-sportgo="futbol"><span class="gx-sport-ico">⚽</span>' + esc(t('sport_futbol')) + '</button>' +
        '<button class="gx-sport' + (S.sport === 'combat' ? ' on' : '') + ' gx-sport-cb" data-sportgo="combat"><span class="gx-sport-ico">🥊</span>' + esc(t('sport_combat')) + (cbSportAllowed() ? '' : '<span class="gx-sport-soon gx-cbsoon">' + esc(t('sport_soon')) + '</span>') + '</button>' +
        '<button class="gx-sport dim" disabled><span class="gx-sport-ico">🏀</span>' + esc(t('sport_nba')) + '<span class="gx-sport-soon">' + esc(t('sport_soon')) + '</span></button>' +
      '</div>' +
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
    var sb2 = $('#gx-sportbar'); if (sb2) sb2.addEventListener('click', function (e) { var b = e.target.closest('[data-sportgo]'); if (b) setSport(b.dataset.sportgo); });
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
      // jugadores (perfil por jugador; el índice solo existe si el server dio acceso)
      var players = [];
      if (S.pidx && S.pidx.list) {
        players = S.pidx.list.filter(function (pp) { return pnorm(pp.name).indexOf(nq.replace(/[^a-z0-9]/g, '')) >= 0; });
        players.sort(function (a, b) { return (b.min || 0) - (a.min || 0); });
        players = players.slice(0, 6);
      }
      // jugadores de CLUB (GAP-AUDIT 1: mismo índice pero multi-liga; link a #cplayer)
      var cplayers = [];
      if (S.cpidx && S.cpidx.list) {
        cplayers = S.cpidx.list.filter(function (pp) { return pnorm(pp.name).indexOf(nq.replace(/[^a-z0-9]/g, '')) >= 0; });
        cplayers.sort(function (a, b) { return (b.min || 0) - (a.min || 0); });
        cplayers = cplayers.slice(0, 6);
      }
      var html = '';
      if (players.length) html += '<div class="gx-sr-h">' + esc(t('sr_players')) + '</div>' + players.map(function (pp) { return '<div class="gx-sr-i" data-sr-player="' + esc(pp.pid) + '"><span class="fl">' + flag(pp.team) + '</span><b>' + esc(pp.name) + '</b><span class="gx-dim" style="margin-left:6px;font-size:10.5px">' + esc(pp.pos || '') + '</span></div>'; }).join('');
      if (cplayers.length) html += '<div class="gx-sr-h">' + esc(t('sr_players')) + '</div>' + cplayers.map(function (pp) { return '<div class="gx-sr-i" data-sr-cplayer="' + esc(pp.league + '|' + pp.team + '|' + pp.pid) + '">' + clubBadge(pp.team) + '<b style="margin-left:6px">' + esc(pp.name) + '</b><span class="gx-spacer"></span><span class="gx-dim" style="font-size:10.5px">' + leagueLogo(pp.league) + esc((pp.league_name || '').split(' · ')[0]) + '</span></div>'; }).join('');
      if (teams.length) html += '<div class="gx-sr-h">' + esc(t('nav_teams')) + '</div>' + teams.map(function (tm) { return '<div class="gx-sr-i" data-sr-team="' + esc(tm.id) + '"><span class="fl">' + flag(tm.id) + '</span><b>' + esc(teamName(tm.id, tm.name)) + '</b></div>'; }).join('');
      // FASE CLUBES: equipos de clubes (con escudo) → perfil de club. Solo si clubsOn() y ya cargó S.clubs.
      if (clubsOn() && S.clubs && S.clubs.leagues) {
        var cteams = [];
        S.clubs.leagues.forEach(function (L) { (L.table || []).forEach(function (tt) { if (norm(tt.name || '').indexOf(nq) >= 0) cteams.push({ lg: L.key, lgn: L.name.split(' · ')[0], id: tt.id, name: tt.name }); }); });
        cteams = cteams.slice(0, 6);
        if (cteams.length) html += '<div class="gx-sr-h">' + esc(t('cl_clubs')) + '</div>' + cteams.map(function (c) { return '<div class="gx-sr-i" data-sr-cteam="' + esc(c.lg + '|' + c.id) + '">' + clubBadge(c.id) + '<b style="margin-left:6px">' + esc(c.name) + '</b><span class="gx-spacer"></span><span class="gx-dim" style="font-size:10.5px">' + leagueLogo(c.lg) + esc(c.lgn) + '</span></div>'; }).join('');
      }
      if (cal.length) html += '<div class="gx-sr-h">' + esc(t('nav_matches')) + '</div>' + cal.map(function (c) { return '<div class="gx-sr-i" data-sr-match="' + esc(oidFor(c)) + '"><span class="fl">' + flag(c.home) + '</span><b>' + esc(teamName(c.home)) + '</b><span class="gx-dim" style="margin:0 4px">' + esc(t('vs')) + '</span><span class="fl">' + flag(c.away) + '</span><b>' + esc(teamName(c.away)) + '</b><span class="gx-spacer"></span><span class="gx-dim gx-mono" style="font-size:10.5px">' + esc(fmtDate(c.datetime)) + '</span></div>'; }).join('');
      if (!html) html = '<div class="gx-sr-empty gx-dim">' + esc(t('e_na')) + '</div>';
      res.innerHTML = html; res.hidden = false;
    };
    inp.addEventListener('input', function () { clearTimeout(S._sq); S._sq = setTimeout(run, 160); });
    inp.addEventListener('focus', function () { if ((inp.value || '').trim().length >= 2) run(); });
    res.addEventListener('click', function (e) {
      var pp = e.target.closest('[data-sr-player]'); if (pp) { inp.value = ''; hide(); openPlayer(pp.getAttribute('data-sr-player')); return; }
      var cp = e.target.closest('[data-sr-cplayer]'); if (cp) { inp.value = ''; hide(); var cpp = cp.getAttribute('data-sr-cplayer').split('|'); openClubPlayer(cpp[0], cpp[1], cpp[2]); return; }
      var tm = e.target.closest('[data-sr-team]'); if (tm) { inp.value = ''; hide(); openTeam(tm.getAttribute('data-sr-team')); return; }
      var ct = e.target.closest('[data-sr-cteam]'); if (ct) { inp.value = ''; hide(); var pp2 = ct.getAttribute('data-sr-cteam').split('|'); openClubTeam(pp2[0], pp2[1]); return; }
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
      // Soporte: ABIERTO a todos (8-jul). Mi suscripción sigue solo-admin hasta el lanzamiento de pagos.
      (S.me && (S.me.isAdmin || S.me.founder_public) ? '<button class="gx-acct-i" id="gx-sub">' + ic('crown') + '<span>' + esc(t('sub_nav')) + '</span></button>' : '') +
      '<button class="gx-acct-i" id="gx-support">' + ic('lifebuoy') + '<span>' + esc(t('sup_nav')) + '</span></button>' +
      '<button class="gx-acct-i gx-acct-danger" id="gx-logout">' + ic('logout') + '<span>' + esc(t('logout')) + '</span></button>';
    var pf = m.querySelector('#gx-profile'); if (pf) pf.addEventListener('click', function () { closeAcctMenu(); openGxProfile(); });
    var sb = m.querySelector('#gx-sub'); if (sb) sb.addEventListener('click', function () { closeAcctMenu(); navTo('sub'); });
    var sp = m.querySelector('#gx-support'); if (sp) sp.addEventListener('click', function () { closeAcctMenu(); navTo('support'); });
    var lo = m.querySelector('#gx-logout'); if (lo) lo.addEventListener('click', gxLogout);
    m.hidden = false;
    setTimeout(function () { document.addEventListener('click', closeAcctMenu, { once: true }); }, 0);
  }
  function closeAcctMenu() { var m = $('#gx-acct-menu'); if (m) m.hidden = true; }
  function gxLogout() { try { localStorage.removeItem('wc_token'); document.cookie = 'wc_token=;path=/;max-age=0'; } catch (e) {} location.replace('/'); }
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
    // R2: Combate en la sportbar — para admin es un deporte ACTIVO (sin "Próximamente"); para el resto, teaser
    [].forEach.call(document.querySelectorAll('.gx-cbsoon'), function (el) { el.style.display = on ? 'none' : ''; });
    [].forEach.call(document.querySelectorAll('.gx-sport-cb'), function (el) { el.classList.toggle('dim', !on); });
    // F1/F2/F4: superficies gateadas por flag del server (off → invisibles, plataforma idéntica)
    [['gx-feat-bets', 'my_bets_feature'], ['gx-feat-books', 'my_books'], ['gx-feat-brief', 'daily_brief']].forEach(function (fc) {
      var vis = !!(S.me && S.me[fc[1]]);
      [].forEach.call(document.querySelectorAll('.' + fc[0]), function (el) { el.style.display = vis ? '' : 'none'; });
    });
    // Identidad real en el pie del sidebar (el shell puede pintarse antes de /api/me).
    var foot = document.querySelector('.gx-side-foot');
    if (foot && S.me && S.me.email) {
      var pre = S.me.email.split('@')[0];
      foot.innerHTML = '<div class="gx-avatar">' + esc(pre.charAt(0).toUpperCase()) + '</div><div style="font-size:12px"><b style="font-weight:600">' + esc(pre) + '</b><div class="gx-dim" style="font-size:10.5px">' + esc(on ? 'Admin' : 'GP Intelligence') + '</div></div>';
    }
  }
  function openMoreSheet() {
    var isAdmin = !!(S.me && S.me.isAdmin);
    var items = S.sport === 'combat'
      ? [['cbfollow', 'star', 'nav_follow'], ['alerts', 'bell', 'nav_alerts']]
        .concat(isAdmin ? [['cbperf', 'chart-line', 'nav_perf']] : [])
        .concat(S.me && S.me.my_bets_feature ? [['bets', 'wallet', 'nav_bets']] : [])
        .concat(S.me && S.me.my_books ? [['books', 'building-bank', 'nav_books']] : [])
        .concat([['cborgs', 'belt', 'nav_cb_orgs'], ['cbevo', 'trending-up', 'nav_evo'], ['refer', 'user-plus', 'nav_refer']])
        .concat(isAdmin ? [['admin', 'settings', 'nav_admin']] : [])
      : [['calc', 'calculator', 'calc_nav'], ['follow', 'star', 'nav_follow'], ['alerts', 'bell', 'nav_alerts'], ['perf', 'chart-line', 'nav_perf']]
        .concat(S.me && S.me.daily_brief ? [['brief', 'news', 'nav_brief']] : [])
        .concat(S.me && S.me.my_bets_feature ? [['bets', 'wallet', 'nav_bets']] : [])
        .concat(S.me && S.me.my_books ? [['books', 'building-bank', 'nav_books']] : [])
        .concat([['groups', 'layout-grid', 'nav_groups'], ['bracket', 'tournament', 'nav_bracket'], ['evo', 'trending-up', 'nav_evo'], ['refer', 'user-plus', 'nav_refer']])
        .concat(isAdmin ? [['registry', 'file-check', 'nav_registry'], ['method', 'book', 'nav_method'], ['admin', 'settings', 'nav_admin']] : []);
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

  // ¿Hay una calculadora de stake abierta dentro del board? (estado solo-DOM → un re-render la mataría).
  function calcOpenInBoard() { var b = $('#gx-board'); return !!(b && b.querySelector('.gx-calc-holder, .gx-calc-trow')); }
  function load(attempt, silent) {
    attempt = attempt || 0;
    // silent=true (refresco en vivo): NO mostrar el spinner — reemplazar el board por "Cargando" colapsa la altura
    // de la página y el navegador clampa el scroll → salto a la parte de arriba (bug reportado con la calculadora).
    if (attempt === 0 && !silent) { var b = $('#gx-board'); if (b) b.innerHTML = '<div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div>'; }
    Promise.all([
      fetch('/api/beta/dashboard', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      // Value es plan Sharp: 403 {upgrade} → candado (no error). asplanQS = preview admin de otros planes.
      fetch('/api/beta/value?class=ALL' + asplanQS('&'), { headers: hdrs() }).then(function (r) { if (r.status === 403) { S.valueLocked = true; return null; } S.valueLocked = false; return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      // server frío: el primer /api/beta/dashboard puede tardar/fallar → reintenta antes de mostrar vacío.
      if (!res[0] && attempt < 4) { setTimeout(function () { load(attempt + 1, silent); }, 900 + attempt * 600); return; }
      S.dash = res[0]; S.value = (res[1] && res[1].items) || [];
      // anti-cierre: si el usuario tiene una calculadora abierta en el board, no re-renderizar (el próximo
      // tick del loop en vivo actualiza al cerrarla). Mismo patrón que el anti-pestañeo de la plataforma vieja.
      if (silent && calcOpenInBoard()) return;
      // anti-pestañeo: en refresco silencioso, si el payload no cambió no hay nada que redibujar.
      var _bj = null;
      try { _bj = JSON.stringify([S.dash, S.value]); } catch (e) { _bj = null; }
      if (silent && _bj && _bj === S._lastBoardJson) return;
      if (_bj) S._lastBoardJson = _bj;
      render();
    });
  }

  function render() {
    var d = S.dash || {}, up = d.upcoming || [], valBy = gExpandValue(S.value);
    var rows = up.map(function (u) { return eventRow(u, valBy); });
    // updated (R2: el contador gx-pulse se retiró del topbar — orden de Alexis, la búsqueda respira)
    var upd = $('#gx-upd'); if (upd) upd.textContent = t('updated_short') + ' · ' + (d.generated_at ? fmtTime(d.generated_at) : '—');
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
    if (S.dailyPicks === undefined) { S.dailyPicks = null; fetch('/api/beta/picks' + asplanQS('?'), { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.dailyPicks = (j && j.picks) || []; S.dailyPicksMeta = j ? { yesterday: j.yesterday || null, next_kickoff: j.next_kickoff || null, plan: j.plan || null, locked_count: j.locked_count || 0, plan_delayed: !!j.plan_delayed, welcome_pick: j.welcome_pick || null, layout: j.picks_layout || 'flat' } : null; if (S.view === 'board') { kpis(S.dash || {}, rows); refreshCockpit(); } }); }
    var pick = (S.dailyPicks && S.dailyPicks.length) ? S.dailyPicks.slice().sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); })[0] : null;
    var val = (d.value || [])[0];
    // OUTRIGHT (campeón GP vs mercado): fuente de los fallbacks de "Mejor value" y "Mayor desacuerdo" cuando no hay
    // datos por-partido. Se carga siempre una vez (barato, cacheado) → ninguna caja queda "sin datos".
    if (S.valueOutright === undefined) { S.valueOutright = null; fetch('/api/beta/value-outright' + asplanQS('?'), { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.valueOutright = (j && j.items) || []; if (S.view === 'board' && S.oppSub !== 'picks') kpis(S.dash || {}, rows); }); }
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
      '<div class="gx-kpi-foot"><span class="gx-mono" style="display:inline-flex;align-items:center;gap:5px">' + bookLogo(it.venue_label || it.venue) + esc(prettyBook(it.venue_label || it.venue)) + '</span><span class="gx-pp gx-pos">+' + (it.edge * 100).toFixed(1) + '%</span></div>';
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
    return '<div class="gx-kpi-main"><div><div class="gx-kpi-sel">' + esc(v.outcome_code) + '</div><div class="gx-kpi-sub" style="display:flex;align-items:center;gap:5px">' + bookLogo(v.best_sportsbook) + esc(prettyBook(v.best_sportsbook || "")) + '</div></div></div>' +
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
  // Estado EN VIVO del partido de una pick (filtro Todos/En vivo/Próximos): datos reales primero —
  // Mundial por status_code del dash, clubes por la lista live de su liga — y fallback por ventana de
  // juego (kickoff pasado < 2h45) cuando el estado real no está cargado.
  function pickIsLive(p) {
    if (p.event_id && S.dash && (S.dash.upcoming || []).length) {
      for (var i = 0; i < S.dash.upcoming.length; i++) {
        var h = (S.dash.upcoming[i] || {}).header || {};
        if (h.event_id === p.event_id) return h.status_code === 'LIVE';
      }
    }
    if (p.club_eid && S.clubs && (S.clubs.leagues || []).length) {
      var mm = p.club_eid.match(/^cl-([a-z0-9]+)-(tm_[a-z0-9]+)-(tm_[a-z0-9]+)$/i);
      var L = mm && clubLeague(mm[1]);
      if (L) {
        var lv = L.live || [];
        for (var k = 0; k < lv.length; k++) if (lv[k].home && lv[k].away && String(lv[k].home.id) === mm[2] && String(lv[k].away.id) === mm[3]) return true;
        return false;
      }
    }
    var ko = Date.parse(p.kickoff || 0);
    return isFinite(ko) && Date.now() >= ko && Date.now() - ko < 165 * 60e3;
  }
  // Filtro del board aplicado al FEED de picks: live = partido en vivo ahora; up = próximos (kickoff
  // futuro, sin contar los live); all = todas. Una pick de partido terminado pendiente de liquidar no
  // entra en live ni en up (solo en Todos).
  function picksFiltered(picks) {
    if (booksOnlyOn()) picks = picks.filter(pickInMyBooks); // F2: solo picks cotizadas en MIS casas
    if (S.filt === 'live') return picks.filter(pickIsLive);
    if (S.filt === 'up') return picks.filter(function (p) { if (pickIsLive(p)) return false; var ko = Date.parse(p.kickoff || 0); return isFinite(ko) && ko > Date.now(); });
    return picks;
  }
  // ONBOARDING — PRIMERA PICK GRATIS: la selección más segura del día para el usuario recién registrado.
  // Se muestra arriba del board (incluso si el resto está bloqueado por plan free) hasta que la descarta.
  function welcomeCard(meta) {
    var wp = meta && meta.welcome_pick;
    if (!wp) return '';
    return '<div class="gx-welcome-pick">' +
      '<div class="gx-welcome-hd">' + ic('gift') + '<div class="gx-welcome-tx"><b>' + esc(t('wp_title')) + '</b><span class="gx-dim">' + esc(t('wp_sub')) + '</span></div>' +
      '<button type="button" class="gx-welcome-x" data-welcome-dismiss aria-label="' + esc(t('wp_dismiss')) + '">' + ic('x') + '</button></div>' +
      pickCard(wp, { welcome: true }) + '</div>';
  }
  function wireWelcome(bd) {
    var x = bd && bd.querySelector('[data-welcome-dismiss]');
    if (!x) return;
    x.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (S.dailyPicksMeta) S.dailyPicksMeta.welcome_pick = null;
      fetch('/api/me/welcome-pick-seen', { method: 'POST', headers: hdrs() }).catch(function () {});
      var b = $('#gx-board'); if (b && S.oppSub === 'picks') picksFeed(b);
    });
  }
  function picksFeed(bd) {
    if (S.dailyPicks === undefined) {
      S.dailyPicks = null;
      fetch('/api/beta/picks' + asplanQS('?'), { headers: hdrs(), signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(12000) : undefined }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
        if (!j) { // fetch falló (timeout/red): NO cachear "sin picks" → reintento con backoff (auto-recupera sin reload)
          S.dailyPicks = undefined;
          if (S._picksRetry) clearTimeout(S._picksRetry);
          S._picksRetry = setTimeout(function () { S._picksRetry = null; if (S.dailyPicks === undefined && S.view === 'board' && S.oppSub === 'picks') { var b = $('#gx-board'); if (b) picksFeed(b); } }, 4000);
          return;
        }
        S.dailyPicks = (j && j.picks) || []; S.dailyPicksMeta = j ? { yesterday: j.yesterday || null, next_kickoff: j.next_kickoff || null, plan: j.plan || null, locked_count: j.locked_count || 0, plan_delayed: !!j.plan_delayed, welcome_pick: j.welcome_pick || null, layout: j.picks_layout || 'flat' } : null;
        if (S.oppSub === 'picks') { var b = $('#gx-board'); if (b) picksFeed(b); }
        refreshCockpit();
      });
      bd.innerHTML = '<div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div>';
      return;
    }
    var picks = picksFiltered(S.dailyPicks || []);
    var cc = $('#gx-board-count'); if (cc) cc.textContent = picks.length + ' ' + (picks.length === 1 ? t('pf_count1') : t('pf_count'));
    var meta = S.dailyPicksMeta || {};
    var welcome = welcomeCard(meta); // primera pick gratis (onboarding) — arriba de todo, hasta descartarla
    // recap de AYER (prueba social agregada — el historial detallado sigue admin): "Ayer: 2 de 3 ✓"
    var recap = (meta.yesterday && meta.yesterday.total > 0)
      ? '<div class="gx-pick-recap' + (meta.yesterday.won / meta.yesterday.total >= 0.5 ? ' gx-recap-pos' : '') + '">' + ic('circle-check') + esc(t('pf_yesterday', { won: meta.yesterday.won, total: meta.yesterday.total })) + '</div>' : '';
    // teaser de upgrade (gating por plan): "N picks más hoy — en Pro/Sharp" + nota de delay del plan Free
    var lockTeaser = '';
    if (meta.locked_count > 0) {
      lockTeaser = '<div class="gx-pick-lock">' + ic('lock') + '<div><b>' + esc(t('lock_more_picks', { n: meta.locked_count })) + '</b><span class="gx-dim">' + esc(t('lock_more_picks_s')) + '</span></div><a class="gx-btn gx-lock-cta" href="/plans">' + esc(t('lock_cta')) + '</a></div>';
    }
    if (meta.plan_delayed) lockTeaser += '<div class="gx-pick-recap">' + ic('clock') + esc(t('lock_delay')) + '</div>';
    if (!picks.length) {
      // vacío POR FILTRO (hay picks pero no en esta pestaña/casas) ≠ vacío real (sin picks activas)
      if ((S.dailyPicks || []).length && (S.filt === 'live' || S.filt === 'up' || booksOnlyOn())) {
        var emptyKey = (S.filt === 'live') ? 'pf_empty_live' : (S.filt === 'up') ? 'pf_empty_up' : 'bk_empty';
        bd.innerHTML = welcome + myBooksBar() + recap + lockTeaser + '<div class="gx-empty gx-pick-empty">' + illo("tickets") + '<b>' + esc(t(emptyKey)) + '</b><span class="gx-dim">' + esc(t(emptyKey === 'bk_empty' ? 'bk_empty_sub' : 'pf_empty_filt_sub')) + '</span></div>';
        wireBooksBar(bd, function () { picksFeed(bd); });
        wireWelcome(bd);
        return;
      }
      // countdown (reversible por env GP_PICKS_COUNTDOWN_ENABLED): el vacío da una CITA, no un "vuelve pronto"
      var ko = '';
      if (meta.next_kickoff) { try { var hh = new Date(meta.next_kickoff).toLocaleTimeString(LANG === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }); ko = '<span class="gx-pick-nextko">' + ic('clock') + esc(t('pf_next_ko', { time: hh })) + '</span>'; } catch (e) {} }
      // CANDADO, no "sin picks": si HAY picks hoy pero el plan no las ve (locked_count>0, p.ej. Free sin su pick
      // liberada aún) → panel de upgrade CLARO ("no es que no haya picks, es que hay que suscribirse"), jamás un
      // vacío que parezca "no hay señal / error".
      if (meta.locked_count > 0) {
        bd.innerHTML = welcome + recap + '<div class="gx-empty gx-lockpanel">' + ic('lock') + '<b>' + esc(t('lock_picks_t')) + '</b><span class="gx-dim">' + esc(meta.plan_delayed ? t('lock_delay') : t('lock_picks_s')) + '</span><a class="gx-btn gx-lock-cta" href="/plans">' + ic('crown') + esc(t('lock_cta')) + '</a>' + ko + '</div>';
        wireWelcome(bd);
        return;
      }
      bd.innerHTML = welcome + recap + lockTeaser + '<div class="gx-empty gx-pick-empty">' + illo("tickets") + '<b>' + esc(t('pf_empty')) + '</b><span class="gx-dim">' + esc(t('pf_empty_sub')) + '</span>' + ko + '</div>';
      wireWelcome(bd);
      return;
    }
    // LAYOUT (admin-first): 'sections' agrupa las picks por partido con el PICK DEL DÍA como hero arriba;
    // 'flat' es el feed corrido de siempre (todos los no-admin hasta que GP_PICKS_SECTIONS_PUBLIC=true).
    var picksHtml = (meta.layout === 'sections' && picks.length > 1)
      ? picksSectioned(picks)
      : '<div class="gx-picks-feed">' + picks.map(pickCard).join('') + '</div>';
    bd.innerHTML = welcome + myBooksBar() + recap + featuredStrip() + picksHtml + lockTeaser +
      '<div class="gx-pick-disc">' + esc(t('pf_disclaimer')) + '</div>';
    wireBooksBar(bd, function () { picksFeed(bd); });
    wireWelcome(bd);
  }
  // Board en SECCIONES: hero "Pick del día" (mayor confianza) arriba + el resto agrupado por partido, con
  // encabezado clickeable que abre el cockpit del partido. El hero se excluye de su sección para no duplicar.
  function picksSectioned(picks) {
    var sorted = picks.slice().sort(function (a, b) { return (b.confidence || 0) - (a.confidence || 0); });
    // SOLID (ganador) es el producto estrella: es la familia que LE GANA AL MERCADO en el track (65% combinado)
    // → lidera como "Pick del día". Sin SOLID en el feed, cae al de mayor confianza (comportamiento previo).
    var hero = sorted.filter(function (p) { return p.family === 'SOLID'; })[0] || sorted[0];
    var rest = picks.filter(function (p) { return p !== hero; });
    var groups = {}, order = [];
    rest.forEach(function (p) {
      var k = p.home_team_id + '~' + p.away_team_id;
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(p);
    });
    order.sort(function (a, b) { return new Date(groups[a][0].kickoff || 0) - new Date(groups[b][0].kickoff || 0); });
    var html = '';
    if (hero) {
      html += '<div class="gx-pickday"><div class="gx-pickday-lbl">' + ic('star') + esc(t('pf_pick_of_day')) + '</div>' + pickCard(hero) + '</div>';
    }
    if (order.length) {
      html += '<div class="gx-secdiv">' + esc(t('pf_all_by_match')) + '</div>';
      order.forEach(function (k) {
        var gp = groups[k], f = gp[0];
        // club_eid PRIMERO (mismo orden que pickCard): un pick de club con event_id canónico abría el cockpit
        // del Mundial vacío ("Copa Mundial de la FIFA 2026" + sin evaluación) — bug reportado 24-jul.
        var openId = f.club_eid || f.event_id || ((f.home_team_id && f.away_team_id) ? 'teams-' + f.home_team_id + '-' + f.away_team_id : null);
        var when = '';
        try { when = new Date(f.kickoff).toLocaleString(LANG === 'en' ? 'en-US' : 'es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) {}
        var hh = teamName(f.home_team_id, f.home), aa = teamName(f.away_team_id, f.away);
        var head = '<div class="gx-msec-head"' + (openId ? ' data-openmatch="' + esc(openId) + '"' : '') + '>' +
          '<div class="gx-msec-teams"><span class="fl">' + flag(f.home_team_id) + '</span><b>' + esc(hh) + '</b>' +
          '<span class="gx-msec-vs">' + esc(t('vs')) + '</span><b>' + esc(aa) + '</b><span class="fl">' + flag(f.away_team_id) + '</span></div>' +
          '<div class="gx-msec-meta"><span class="gx-dim">' + esc(when) + '</span><span class="gx-msec-count">' + gp.length + ' ' + esc(gp.length === 1 ? t('pf_count1') : t('pf_count')) + '</span>' + ic('chevron-right') + '</div></div>';
        // EXPOSICIÓN POR PARTIDO: 2+ picks del mismo cruce están CORRELACIONADAS (se ganan/pierden juntas si el
        // partido va como el modelo espera). Aviso honesto para que el usuario no las apueste como si fueran
        // independientes (la lección de la noche del 11-jul: 2 partidos barrieron 11 picks).
        var corrData = gp.map(function (p) { return p.corr; }).filter(Boolean)[0];
        var corr = gp.length >= 2
          ? '<div class="gx-corr">' + ic('alert-triangle') + '<span>' + t('pf_corr', { n: gp.length }) +
            (corrData ? ' ' + t('pf_corr_calc', { rho: corrData.rho, pct: Math.round(corrData.stake_factor * 100) }) : '') + '</span></div>'
          : '';
        html += '<div class="gx-msec">' + head + corr + '<div class="gx-picks-feed">' + gp.map(function (p) { return pickCard(p, { hideMatch: true }); }).join('') + '</div></div>';
      });
    }
    return html;
  }
  // DESTACADOS DE HOY: los jugadores del partido del día (top proyección de gol + arquetipo + gancho de
  // scouting) en un strip horizontal sobre el feed. Cada card abre el perfil completo del jugador.
  function featuredStrip() {
    if (S.featured === undefined) {
      S.featured = null;
      // Featured del Mundial + de CLUBES (mismo shape, cada jugador lleva su href: #player o #cplayer). Post-Mundial
      // el del Mundial devuelve vacío y quedan los de clubes; se mergean y ordenan por P(gol).
      var gj = fetch('/api/beta/featured-today', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      var cj = fetch('/api/beta/clubs-featured-today', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
      Promise.all([gj, cj]).then(function (rr) {
        var wc = (rr[0] && rr[0].available && rr[0].players) || [];
        var cl = (rr[1] && rr[1].available && rr[1].players) || [];
        wc.forEach(function (p) { p.href = '#player/' + p.pid; });
        cl.forEach(function (p) { p.href = '#cplayer/' + p.league + '-' + p.team_id + '-' + p.pid; });
        S.featured = wc.concat(cl).sort(function (a, b) { return (b.anytime || 0) - (a.anytime || 0); }).slice(0, 8);
        if (S.oppSub === 'picks') { var b = $('#gx-board'); if (b) { noAnimWindow(); picksFeed(b); } }
      });
      return '';
    }
    var ps = S.featured || [];
    if (!ps.length) return '';
    var cards = ps.map(function (p) {
      var photo = p.photo ? '<img src="' + esc(p.photo) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '';
      var hook = LANG === 'en' ? (p.hook_en || p.hook_es) : (p.hook_es || p.hook_en);
      var risk = p.risk ? '<span class="gx-badge gx-intel-risk">' + esc(p.risk === 'DOUBT' ? t('intel_doubt') : p.risk === 'OUT' ? t('intel_out') : t('intel_susp')) + '</span>' : '';
      return '<a class="gx-feat-card" href="' + esc(p.href || ('#player/' + p.pid)) + '">' + photo +
        '<div class="gx-feat-b"><div class="gx-feat-n"><span class="fl">' + flag(p.team_id) + '</span><b>' + esc(p.name) + '</b></div>' +
        '<div class="gx-feat-meta">' + archBadge(p.archetype) + risk + '<span class="gx-mono gx-pos">' + pct0(p.anytime) + '</span><span class="gx-dim" style="font-size:10px">' + esc(t('ft_goal')) + '</span></div>' +
        (hook ? '<div class="gx-feat-hook">' + esc(hook) + '</div>' : '') + '</div></a>';
    }).join('');
    return '<div class="gx-feat"><div class="gx-ph" style="margin-bottom:8px"><span class="gx-label">' + ic('bulb') + esc(t('ft_title')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:11px">' + ps.length + '</span></div><div class="gx-feat-row">' + cards + '</div></div>';
  }
  function pickTeam(p, code) { return code === 'home' ? teamName(p.home_team_id, p.home) : teamName(p.away_team_id, p.away); }
  function pickRecText(p) {
    if (p.family === 'SOLID') {
      // DOBLE CHANCE (27-jul, modelo-líder en blandas): selection not_home/not_away = "el rival o empate"
      if (String(p.selection_code || '').indexOf('not_') === 0) return t('pf_dc', { team: pickTeam(p, p.selection_code === 'not_home' ? 'away' : 'home') });
      return t('pf_wins', { team: pickTeam(p, p.selection_code) });
    }
    if (p.family === 'GOALS') return p.side === 'over' ? t('pf_over', { line: p.line }) : t('pf_under', { line: p.line });
    if (p.family === 'COMBO') return (p.legs || []).map(function (l) {
      if (l.type === '1X2') return t('pf_wins', { team: pickTeam(p, l.selection) });
      return l.side === 'over' ? t('pf_over', { line: l.line }) : t('pf_under', { line: l.line });
    }).join(' ' + t('pf_combo_and') + ' ');
    if (p.family === 'FIGHT') return t('pf_wins', { team: p.selection_name || '' });
    if (p.family === 'METHOD' || p.family === 'ROUNDS') return p.selection_name || '';
    if (p.family === 'CORNERS') return t(p.side === 'over' ? 'pf_over_corners' : 'pf_under_corners', { line: p.line });
    if (p.family === 'CARDS') return t(p.side === 'over' ? 'pf_over_cards' : 'pf_under_cards', { line: p.line });
    if (p.family === 'PLAYER') {
      if (p.player_family === 'player_goal') return t('pf_player_goal', { player: p.player_name || '' });
      if (p.player_family === 'player_assist') return t('pf_player_assist', { player: p.player_name || '' });
      return t(p.player_family === 'player_sot' ? 'pf_player_sot' : 'pf_player_shots', { player: p.player_name || '', line: p.line });
    }
    return '';
  }
  // Narrativa multi-factor de la pick (server-side, caja negra): el "por qué" al nivel de un analista.
  // REVELACIÓN PROGRESIVA (feedback Alexis 9-jul): cerrada por defecto tras un toggle discreto — la card
  // mantiene su jerarquía (pick + cuota + confianza) y el que quiere profundidad la abre. La lectura
  // completa vive además en el análisis del partido (mvPickReads).
  function pickWhy(p) {
    var w = LANG === 'en' ? (p.why_en || p.why_es) : (p.why_es || p.why_en);
    if (!w) return '';
    return '<div class="gx-pick-whywrap"><button type="button" class="gx-why-btn" data-whytoggle><span class="gx-why-car">▸</span>' + esc(t('pf_why_btn')) + '</button><div class="gx-pick-why" hidden>' + esc(w) + '</div></div>';
  }

  // Chip de movimiento de línea (line-intel): hacia dónde se movió el consenso del mercado desde que se
  // publicó la pick. A favor = el mercado se acercó a nuestra selección (verde); en contra = ámbar tenue.
  // Solo se muestra con movimiento real (direction with/against); flat no ensucia la card.
  function lineMoveChip(p) {
    var lm = p.line_move;
    if (!lm || lm.direction === 'flat' || lm.pp == null) return '';
    var withUs = lm.direction === 'with';
    var arrow = withUs ? '▲' : '▼';
    var txt = t(withUs ? 'lm_with' : 'lm_against', { pp: (lm.pp > 0 ? '+' : '') + lm.pp });
    return '<div class="gx-pick-linemove ' + (withUs ? 'gx-lm-with' : 'gx-lm-against') + '">' + arrow + ' ' + esc(txt) + '</div>';
  }

  function pickCard(p, opts) {
    opts = opts || {};
    var famKey = (p.family === 'SOLID' || p.family === 'FIGHT') ? 'pf_fam_solid' : p.family === 'METHOD' ? 'pf_fam_method' : p.family === 'ROUNDS' ? 'pf_fam_rounds' : p.family === 'GOALS' ? 'pf_fam_goals' : p.family === 'CORNERS' ? 'pf_fam_corners' : p.family === 'CARDS' ? 'pf_fam_cards' : p.family === 'PLAYER' ? 'pf_fam_player' : 'pf_fam_combo';
    var bucket = confBucket(p.confidence || 0);
    var confLabel = bucket === 'high' ? t('pf_conf_high') : bucket === 'med' ? t('pf_conf_med') : t('pf_conf_low');
    var hh = teamName(p.home_team_id, p.home), aa = teamName(p.away_team_id, p.away);
    var odds = p.odds != null ? Number(p.odds).toFixed(2) : '—';
    // TODAS las picks abren el GP Intelligence del partido: canónicas por event_id (cockpit completo + mercados),
    // sintéticas por team-ids (teams-HOME-AWAY → base→contexto→GP + proyección de goles, vía h2h deep). Si hay 3 picks
    // del mismo partido, cada una abre el mismo análisis del partido.
    // picks de CLUB (shadow admin): club_eid abre el cockpit de club (mismo camino renderMatch cl-)
    var openId = p.cb_hash ? null : (p.club_eid || p.event_id || ((p.home_team_id && p.away_team_id) ? 'teams-' + p.home_team_id + '-' + p.away_team_id : null));
    var clickable = !!openId || !!p.cb_hash;
    var openAttr = p.cb_hash ? ' data-openhash="' + esc(p.cb_hash) + '"' : (clickable ? ' data-openmatch="' + esc(openId) + '"' : '');
    return '<div class="gx-pick-card gx-pick-' + p.family.toLowerCase() + (clickable ? ' gx-pick-clickable' : '') + '"' + openAttr + '>' +
      '<div class="gx-pick-top"><span class="gx-pick-fam">' + esc(t(famKey)) + (p.competition_name ? ' <span class="gx-dim" style="font-weight:600;text-transform:none;letter-spacing:0">· ' + esc(p.competition_name) + '</span>' : '') +
      // Chip MONITOR (26-jul): solo lo ve el admin (los no-admin nunca reciben picks monitor). Distingue de
      // un vistazo el track privado del feed público real — evita confundir "el feed sigue lleno".
      (p.signals && p.signals.regime === 'monitor' ? ' <span class="gx-clgate sh" style="font-size:9.5px;vertical-align:middle">MONITOR</span>' : '') + '</span>' +
      (opts.hideMatch ? '' : '<span class="gx-pick-time">' + ic('clock') + esc(fmtDateTime(p.kickoff)) + '</span>') + '</div>' +
      (opts.hideMatch ? '' : '<div class="gx-pick-match">' +
        (p.cb_avas ? '<span class="gx-pick-cbava gr">' + (p.cb_avas.h ? '<img src="' + esc(p.cb_avas.h) + '" alt="" onerror="this.remove()">' : '') + '</span>' : '<span class="fl">' + flag(p.home_team_id) + '</span>') + '<b>' + esc(hh) + '</b>' +
        '<span class="gx-pick-vs">' + esc(t('vs')) + '</span><b>' + esc(aa) + '</b>' +
        (p.cb_avas ? '<span class="gx-pick-cbava rd">' + (p.cb_avas.a ? '<img src="' + esc(p.cb_avas.a) + '" alt="" onerror="this.remove()">' : '') + '</span>' : '<span class="fl">' + flag(p.away_team_id) + '</span>') + '</div>') +
      '<div class="gx-pick-rec"><span class="gx-pick-rec-label">' + esc(t('pf_pick_label')) + '</span><div class="gx-pick-rec-text">' + esc(pickRecText(p)) + '</div>' + pickWhy(p) + '</div>' +
      lineMoveChip(p) +
      '<div class="gx-pick-foot">' +
      (p.signals && p.signals.win_prob != null
        ? '<div class="gx-pick-conf gx-conf-' + bucket + '"><span class="gx-pick-conf-dot"></span>' + esc(t('ps_win')) + ': <b>' + Math.round(p.signals.win_prob * 100) + '%</b></div>'
        : '<div class="gx-pick-conf gx-conf-' + bucket + '"><span class="gx-pick-conf-dot"></span>' + esc(t('pf_conf')) + ': <b>' + esc(confLabel) + '</b></div>') +
      '<div class="gx-pick-odds"><span class="gx-pick-odds-label">' + esc(t('pf_best_odds')) + '</span><span class="gx-pick-odds-val">' + esc(odds) + '</span>' +
      (p.book ? '<span class="gx-pick-book">' + esc(t('pf_at')) + ' ' + bookLogo(p.book) + esc(prettyBook(p.book)) + '</span>' : '') + '</div>' +
      '</div>' +
      pickSignalsRow(p) +
      myBooksHint(p.book) + // F2: la mejor cuota está en una casa que el usuario no marcó
      (p.odds != null && p.confidence != null ? '<div class="gx-calc-row">' + stakeCalcBtn(p.confidence, Number(p.odds), pickRecText(p), 'gp') + ' ' + watchBtn(p) + '</div>' : '') +
      '</div>';
  }
  // F2: hint discreto cuando la mejor cuota vive en una casa fuera de las del usuario (solo con casas guardadas)
  function myBooksHint(book) {
    var mine = (S.me && S.me.my_books) && (S.me.my_books_list || []);
    if (!mine || !mine.length || !book) return '';
    if (mine.indexOf(String(book).toLowerCase()) >= 0) return '';
    return '<div class="gx-dim" style="font-size:10.5px;margin-top:4px">' + ic('info-circle') + ' ' + esc(t('bk_not_mine')) + ' (' + esc(prettyBook(book)) + ')</div>';
  }
  // F2: FILTRO "solo mis casas" — compartido por Picks / Value / Arbitraje. El server manda books_list por pick
  // (qué casas cotizan ese mercado); value filtra por la casa del mejor precio; arbitraje exige TODAS las patas
  // en tus casas (si no, no es ejecutable para vos). Estado persistido por dispositivo (gp_books_only).
  function myBooksMine() { return ((S.me && S.me.my_books && S.me.my_books_list) || []).map(function (b) { return String(b).toLowerCase(); }); }
  function booksOnlyOn() { return myBooksMine().length > 0 && lsGet('gp_books_only') === '1'; }
  function inMyBooks(code) { return code != null && myBooksMine().indexOf(String(code).toLowerCase()) >= 0; }
  function pickInMyBooks(p) {
    if (!p.books_list || !p.books_list.length) return true; // desconocido ≠ no disponible (no ocultar)
    return p.books_list.some(inMyBooks);
  }
  function myBooksBar() {
    var mine = myBooksMine(); if (!mine.length) return '';
    var on = booksOnlyOn();
    return '<div class="gx-bkonly"><button type="button" class="gx-calc-frac' + (on ? ' on' : '') + '" data-bkonly>' + ic('building-bank') + ' ' + esc(t('bk_only_mine')) + '</button>' +
      '<span class="gx-dim" style="font-size:10.5px">' + esc(mine.slice(0, 4).map(prettyBook).join(', ')) + (mine.length > 4 ? ' +' + (mine.length - 4) : '') + '</span>' +
      '<a href="#books" class="gx-dim" style="font-size:10.5px;text-decoration:underline">' + esc(t('bk_title')) + '</a></div>';
  }
  function wireBooksBar(bd, rerender) {
    var b = bd.querySelector('[data-bkonly]'); if (!b) return;
    b.addEventListener('click', function () { lsSet('gp_books_only', booksOnlyOn() ? null : '1'); rerender(); });
  }
  // P3 (spec Alexis 17-jul): la confianza habla de la CERTEZA del input/modelo, no sustituye la probabilidad.
  // Señales: edge estimado (pp vs consenso) · Datos (profundidad/frescura del input) · Calidad (composite).
  function pickSignalsRow(p) {
    var sg = p.signals;
    if (!sg) return '';
    var dcK = sg.data_confidence === 'high' ? 'pf_conf_high' : sg.data_confidence === 'med' ? 'pf_conf_med' : 'ps_dc_low';
    var qK = sg.pick_quality === 'strong' ? 'ps_q_strong' : sg.pick_quality === 'marginal' ? 'ps_q_marginal' : 'ps_q_moderate';
    var parts = [];
    if (sg.edge_pp != null) parts.push(esc(t('ps_edge')) + ' <b>' + (sg.edge_pp >= 0 ? '+' : '') + Number(sg.edge_pp).toFixed(1) + 'pp</b>');
    parts.push(esc(t('ps_data')) + ' <b>' + esc(t(dcK)) + '</b>');
    parts.push(esc(t('ps_quality')) + ' <b class="gx-q-' + esc(sg.pick_quality || 'moderate') + '">' + esc(t(qK)) + '</b>');
    // Stake sugerido Kelly/4 (26-jul, el sistema): viene del server sobre la prob encogida al mercado
    if (p.stake_pct != null) parts.push(esc(t('ps_stake')) + ' <b>' + Number(p.stake_pct).toFixed(1) + '%</b>');
    return '<div class="gx-pick-signals">' + parts.join('<span class="gx-sig-dot">·</span>') + '</div>';
  }

  // ---- Oportunidades · Value: OUTRIGHT (campeón del Mundial) — GP% (torneo) vs mercado ----
  function outrightValueHtml() {
    if (S.valueOutright === undefined) {
      S.valueOutright = null;
      fetch('/api/beta/value-outright' + asplanQS('?'), { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.valueOutright = (j && j.items) || []; if (S.oppSub === 'value') { var b = $('#gx-board'); if (b) oppValueBoard(b); } });
      return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('trophy') + esc(t('outright_title')) + '</span></div><div class="gx-mod-body"><div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div></div></div>';
    }
    var all = S.valueOutright || [];
    var pos = all.filter(function (x) { return x.edge_pp > 0.005; }).slice(0, 8);
    if (!pos.length) return '';
    var rowD = function (x) { return '<tr class="gx-row" data-nav-team="' + esc(x.team_id) + '"><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(x.team_id) + '</span><b>' + esc(teamName(x.team_id)) + '</b></div></td>' +
      '<td class="gx-mono gx-gp"><span class="hi">' + pct1(x.model_pct) + '</span></td><td class="gx-mono gx-dim">' + pct1(x.market_pct) + '</td>' +
      '<td class="gx-edge gx-pos">' + pp(x.edge_pp) + '</td><td class="l gx-dim" style="font-size:11px;white-space:nowrap">' + bookLogo(x.best_book) + esc(x.best_book || '—') + '</td></tr>'; };
    var desk = '<table class="gx-table"><thead><tr><th class="l">' + esc(t('nav_teams')) + '</th><th>GP</th><th>' + esc(t('hero_mkt')) + '</th><th>' + esc(t('th_edge')) + '</th><th class="l">' + esc(t('col_provider')) + '</th></tr></thead><tbody>' + pos.map(rowD).join('') + '</tbody></table>';
    var mob = pos.map(function (x) { return '<div class="gx-mcard" data-nav-team="' + esc(x.team_id) + '"><div class="gx-cell-team"><span class="fl">' + flag(x.team_id) + '</span><b>' + esc(teamName(x.team_id)) + '</b><span class="gx-spacer"></span><span class="gx-edge gx-pos">' + pp(x.edge_pp) + '</span></div>' +
      '<div class="gx-mcard-foot"><span class="gx-mono">GP ' + pct1(x.model_pct) + ' · ' + esc(t('hero_mkt')) + ' ' + pct1(x.market_pct) + '</span><span class="gx-dim" style="font-size:11px;display:inline-flex;align-items:center">' + bookLogo(x.best_book) + esc(x.best_book || '') + '</span></div></div>'; }).join('');
    return '<div class="gx-panel gx-board" style="margin-bottom:14px"><div class="gx-ph"><span class="gx-label">' + ic('trophy') + esc(t('outright_title')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:11px">' + esc(t('outright_sub')) + '</span></div><div class="gx-bd-desk">' + desk + '</div><div class="gx-bd-mob">' + mob + '</div></div>';
  }
  // (18-jul) clubsValueHtml ELIMINADA: el value de clubes vive en la MISMA lista de oppValueBoard (fusión).
  // ---- Oportunidades · Value ----
  function oppValueBoard(bd) {
    if (S.valueLocked) { bd.innerHTML = lockPanel(); return; } // plan Sharp (candado con CTA)
    var outright = outrightValueHtml();
    var vals = (S.value || []).slice();
    // FUSIÓN (pedido 18-jul): el value de clubes entra a la MISMA lista que el del Mundial (antes vivía en un
    // panel aparte "Value de clubes por liga"). Normalización: edge de clubes viene en PP (÷100 → fracción,
    // la unidad del Mundial); señal por los mismos umbrales de clubSignal (8/5/2.5 pp).
    if (clubsOn()) {
      (((S.clubsValue || {}).rows) || []).forEach(function (v) {
        if (!(v.edge_pp > 0 && v.best_odds > 1)) return;
        vals.push({
          _club: true, event_id: 'cl-' + v.league + '-' + v.home_id + '-' + v.away_id,
          outcome_code: String(v.outcome || '').toUpperCase(),
          gp_probability: v.our, market_probability: v.consensus, best_odds: v.best_odds,
          adjusted_edge_pp: v.edge_pp / 100, actionable: v.edge_pp >= 5,
          classification_code: v.edge_pp >= 8 ? 'STRONG' : v.edge_pp >= 5 ? 'LEAN' : v.edge_pp >= 2.5 ? 'WATCH' : 'PASS',
          best_sportsbook: v.best_book, _home: v.home, _away: v.away, _homeId: v.home_id, _awayId: v.away_id,
          _league: String(v.league_name || v.league).split(' · ')[0], _gate: v.gate || null,
        });
      });
    }
    vals.sort(function (a, b) { return (b.adjusted_edge_pp || 0) - (a.adjusted_edge_pp || 0); });
    // F2: "solo mis casas" — el value se filtra por la casa del MEJOR precio (esa es la cuota ejecutable)
    if (booksOnlyOn()) vals = vals.filter(function (v) { return inMyBooks(v.best_sportsbook); });
    var hdr = {}; ((S.dash && S.dash.upcoming) || []).forEach(function (u) { hdr[u.header.event_id] = u.header; });
    if (!vals.length) { bd.innerHTML = myBooksBar() + outright + '<div class="gx-empty">' + ic('trending-up') + '<b>' + esc(t('opp_value_empty')) + '</b>' + esc(t('opp_value_empty_sub')) + '</div>'; wireBooksBar(bd, function () { oppValueBoard(bd); }); return; }
    var row = function (v) {
      // fila de CLUB (fusión): nombres directos del payload + escudo tm_ (flag() ya resuelve) + liga en el sub
      if (v._club) {
        var oc2 = v.outcome_code;
        var nm2 = oc2 === 'DRAW' ? (LANG === 'en' ? 'Draw' : 'Empate') : (oc2 === 'AWAY' ? teamName(v._awayId, v._away) : teamName(v._homeId, v._home));
        return { v: v, h: null, fid: oc2 === 'DRAW' ? null : (oc2 === 'AWAY' ? v._awayId : v._homeId), name: nm2, matchN: v._home + ' ' + t('vs') + ' ' + v._away + ' · ' + v._league, bm: false };
      }
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
        '<td class="l gx-dim" style="font-size:11px">' + bookLogo(v.best_sportsbook) + esc(prettyBook(v.best_sportsbook) || "—") + (v.gp_probability > 0 && v.best_odds > 1 ? ' ' + stakeCalcBtn(v.gp_probability, Number(v.best_odds), x.name + (x.matchN ? ' · ' + x.matchN : ''), 'gp') : '') + '</td></tr>'; }).join('') + '</tbody></table>';
    var mob = rows.map(function (x) { var v = x.v; return '<div class="gx-mcard" data-openmatch="' + esc(v.event_id) + '"><div class="gx-mcard-top">' + (sigBadge(v.classification_code) || '') + '<span class="gx-spacer"></span>' + (x.bm ? '<span class="gx-belowmin">' + esc(t('below_min_short')) + '</span>' : (v.actionable ? '<span class="gx-badge gx-b-strong">' + esc(t('opp_actionable')) + '</span>' : '')) + '</div>' +
      '<div class="gx-cell-team" style="margin:6px 0">' + (x.fid ? '<span class="fl">' + flag(x.fid) + '</span>' : '') + '<div class="gx-teamnames"><b>' + esc(x.name) + '</b><span>' + esc(x.matchN) + '</span></div></div>' +
      '<div class="gx-mcard-foot"><span class="gx-mono">GP ' + pct0(v.gp_probability) + ' · ' + esc(t('th_price')) + ' ' + odd(v.best_odds) + '</span><span class="gx-edge ' + (v.adjusted_edge_pp > 0 ? 'gx-pos' : 'gx-dim') + '">' + pp(v.adjusted_edge_pp) + '</span></div>' +
      (v.gp_probability > 0 && v.best_odds > 1 ? '<div class="gx-calc-row">' + stakeCalcBtn(v.gp_probability, Number(v.best_odds), x.name + (x.matchN ? ' · ' + x.matchN : ''), 'gp') + '</div>' : '') +
      '</div>'; }).join('');
    bd.innerHTML = myBooksBar() + outright + '<div class="gx-bd-desk">' + desk + '</div><div class="gx-bd-mob">' + mob + '</div>';
    wireBooksBar(bd, function () { oppValueBoard(bd); });
  }
  // ---- Oportunidades · Arbitraje ----
  // ---- Oportunidades · Arbitraje: scanner MULTI-VENUE con dos familias. "Arbitraje puro" (surebet 2/N patas,
  // el mercado se contradice entre casas → ganás pase lo que pase) y "Precio atrasado" (value 1-pata: una casa
  // cuelga una cuota por encima del consenso no-vig del resto → +EV en una apuesta). Sin modelo GP (eso es Value).
  function arbAgo(s) { if (s == null) return ''; if (s < 90) return t('arb_ago_now'); var m = Math.round(s / 60); if (m < 60) return t('arb_ago_min', { m: m }); return t('arb_ago_hr', { h: Math.round(m / 60) }); }
  function arbTag(it) {
    var base = it.market_family === 'champion' ? t('arb_tag_champ') : it.market_family === 'match_total' ? t('arb_tag_totals', { line: it.line }) : t('arb_tag_1x2');
    // FASE CLUBES: los items de clubes viajan con competition_name (liga) → chip de contexto en la card
    return (it.competition_name ? String(it.competition_name).split(' · ')[0] + ' · ' : '') + base;
  }
  function arbTitle(it) { return it.market_family === 'champion' ? teamName(it.home_team_id, it.home) : (teamName(it.home_team_id, it.home) + ' ' + t('vs') + ' ' + teamName(it.away_team_id, it.away)); }
  function arbSel(it, outcome) {
    if (it.market_family === 'champion') return outcome === 'yes' ? t('arb_champ_yes', { team: teamName(it.home_team_id, it.home) }) : t('arb_champ_no', { team: teamName(it.home_team_id, it.home) });
    if (it.market_family === 'match_total') return outcome === 'over' ? t('arb_over', { line: it.line }) : t('arb_under', { line: it.line });
    if (outcome === 'draw') return t('arb_draw');
    if (outcome === 'home') return teamName(it.home_team_id, it.home);
    if (outcome === 'away') return teamName(it.away_team_id, it.away);
    return outcome;
  }
  function arbMatchRow(it) {
    // FASE CLUBES: escudo del club (tm_ id resuelto); resto: bandera de selección
    var badge = it.competition ? function (id) { return clubBadge(id); } : function (id) { return '<span class="fl">' + flag(id) + '</span>'; };
    var lead = it.competition ? leagueLogo(it.competition) : '';
    return '<div class="gx-arb-match">' + lead + badge(it.home_team_id) + '<b>' + esc(arbTitle(it)) + '</b>' + (it.market_family === 'champion' ? '' : badge(it.away_team_id)) + '</div>';
  }
  function arbCard(a, i) {
    var legs = (a.legs || []).map(function (l) {
      return '<div class="gx-arb-leg"><span class="gx-arb-leg-sel">' + esc(arbSel(a, l.outcome)) + '</span>' +
        '<span class="gx-arb-leg-odds gx-mono">' + Number(l.odds).toFixed(2) + '</span>' +
        '<span class="gx-arb-leg-book">' + bookLogo(l.venue_label || l.venue) + esc(prettyBook(l.venue_label || l.venue)) + (l.is_exchange ? ' <span class="gx-arb-exch">' + esc(t('arb_exchange')) + '</span>' : '') + '</span>' +
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
      '<span class="gx-lag-book">' + esc(t('arb_at')) + ' ' + bookLogo(l.venue_label || l.venue) + esc(prettyBook(l.venue_label || l.venue)) + '</span>' +
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
    // Arbitraje es plan Sharp: 403 {upgrade} → candado (no error). asplanQS = preview admin.
    fetch('/api/beta/arbitrage' + asplanQS('?'), { headers: hdrs(), signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(12000) : undefined }).then(function (r) { if (r.status === 403) { S.arbLocked = true; return null; } S.arbLocked = false; return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (m) {
      S._arbLoading = false;
      if (m) { S.arb = m; arbRefresh(); return; }
      if (S.arbLocked) { S.arb = { available: false, reason: 'locked' }; arbRefresh(); return; }
      // fetch falló (timeout/red/no-ok): NO cachear un "vacío" pegajoso → AUTO-REINTENTO (sin reload manual).
      // Deja S.arb=null → el board muestra "cargando", no "sin oportunidades", y reintenta en 4s.
      S.arb = null;
      if (S._arbRetry) clearTimeout(S._arbRetry);
      S._arbRetry = setTimeout(function () { S._arbRetry = null; if (S.view === 'board' && S.oppSub === 'arb' && !S.arb) loadArb(); }, 4000);
    });
    return false;
  }
  function arbRefresh() {
    if (S.view !== 'board') return;
    if (calcOpenInBoard()) return; // no re-renderizar con una calculadora abierta (mataría el estado del usuario)
    if (S.oppSub === 'arb') { var b = $('#gx-board'); if (b) oppArbBoard(b); }
    var kp = $('#gx-kpis'); if (kp && S.oppSub !== 'picks') { var rs = (S.dash && S.dash.upcoming || []).map(function (u) { return eventRow(u, gExpandValue(S.value)); }); kpis(S.dash || {}, rs); }
  }
  // Re-escaneo SILENCIOSO (efímero, como el feed de picks): re-fetch de /api/beta/arbitrage y re-render solo al
  // llegar la data (sin flash de "cargando"). Las oportunidades que dejaron de ser válidas se caen solas. NO se
  // persiste nada — el scanner es en vivo (sin registro de arbitrajes).
  function refreshArbSilent() {
    if (S._arbLoading || S.arbLocked) return;
    S._arbLoading = true;
    fetch('/api/beta/arbitrage' + asplanQS('?'), { headers: hdrs(), signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(12000) : undefined }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (m) {
      S._arbLoading = false;
      if (!m) return;
      // anti-pestañeo: si solo cambiaron timestamps/frescura, no redibujar (los precios/patas mandan).
      var _aj = null;
      try { _aj = JSON.stringify(m).replace(/"[a-z_]*(_at|age[a-z_]*|freshness[a-z_]*)":"?[^,"}\]]*"?/g, ''); } catch (e) { _aj = null; }
      if (_aj && _aj === S._lastArbJson) { S.arb = m; return; }
      if (_aj) S._lastArbJson = _aj;
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
    if (S.arbLocked) { var cc0 = $('#gx-board-count'); if (cc0) cc0.textContent = ''; bd.innerHTML = lockPanel(); return; }
    if (!loadArb()) { bd.innerHTML = '<div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div>'; return; }
    var d = S.arb || {};
    var cc = $('#gx-board-count'); if (cc) cc.textContent = '';
    if (!d.available) { bd.innerHTML = '<div class="gx-empty"><div class="gx-arb-scan-ic">' + ic('arrows-left-right') + '</div><b>' + esc(t('arb_prep')) + '</b><span class="gx-dim">' + esc(t('arb_prep_sub')) + '</span></div>'; return; }
    var C = d.counts || {}, arbs = d.arbitrage || [], lags = d.price_lag || [];
    // F2: "solo mis casas" — un arbitraje solo es ejecutable PARA VOS si TODAS las patas están en tus casas;
    // un precio atrasado, si la casa rezagada es tuya.
    var bkHidden = 0;
    if (booksOnlyOn()) {
      var vOk = function (l) { return inMyBooks(l.venue) || inMyBooks(l.venue_label); };
      var a0 = arbs.length, l0 = lags.length;
      arbs = arbs.filter(function (a) { return (a.legs || []).every(vOk); });
      lags = lags.filter(vOk);
      bkHidden = (a0 - arbs.length) + (l0 - lags.length);
    }
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
      if (lags.length) body += '<div class="gx-arb-warn">' + ic('alert-triangle') + esc(t('arb_gubbing')) + '</div>' + '<div class="gx-picks-feed">' + lags.map(function (l) { return lagCard(l, (d.price_lag || []).indexOf(l)); }).join('') + '</div>';
      else body += '<div class="gx-empty gx-arb-obs">' + illo("radar") + '<b>' + esc(t('arb_none_lag')) + '</b><span class="gx-dim">' + esc(t('arb_none_lag_sub')) + '</span></div>';
      body += '</div>';
    } else {
      // ejecutables (surebets) primero; teóricos (margen fino / profundidad PM no verificada) en grupo aparte.
      var idx = arbs.map(function (a) { return { a: a, i: (d.arbitrage || []).indexOf(a) }; }); // índice ORIGINAL (openArbDetail resuelve contra d.arbitrage; el filtro "mis casas" desplaza los locales)
      var exe = idx.filter(function (x) { return x.a.executable; }), theo = idx.filter(function (x) { return !x.a.executable; });
      body = '<div class="gx-arb-sec"><div class="gx-arb-sec-h"><span class="gx-dim">' + esc(t('arb_fam_pure_sub')) + '</span></div>';
      if (exe.length) body += '<div class="gx-arb-warn">' + ic('alert-triangle') + esc(t('arb_gubbing')) + '</div>' + '<div class="gx-picks-feed">' + exe.map(function (x) { return arbCard(x.a, x.i); }).join('') + '</div>';
      else body += '<div class="gx-empty gx-arb-obs">' + illo("radar") + '<b>' + esc(t('arb_none_pure')) + '</b><span class="gx-dim">' + esc(t('arb_none_pure_sub', { n: C.markets_scanned || 0 })) + '</span></div>';
      if (theo.length) body += '<div class="gx-arb-theo-h">' + ic('info-circle') + esc(t('arb_theo_group', { n: theo.length })) + '</div><div class="gx-picks-feed">' + theo.map(function (x) { return arbCard(x.a, x.i); }).join('') + '</div>';
      body += '</div>';
    }
    // aviso EXPLÍCITO cuando el filtro "solo mis casas" oculta oportunidades (jamás un vacío silencioso)
    var bkNote = bkHidden > 0 ? '<div class="gx-pick-recap">' + ic('eye-off') + esc(t('bk_hidden', { n: bkHidden })) + '</div>' : '';
    bd.innerHTML = myBooksBar() + bkNote + head + arbSubTabs(C) + body + '<div class="gx-pick-disc">' + esc(t('arb_disclaimer')) + '</div>';
    wireBooksBar(bd, function () { oppArbBoard(bd); });
    // wiring: sub-tabs + apertura de la card de detalle
    [].forEach.call(bd.querySelectorAll('[data-arbsub]'), function (el) {
      el.addEventListener('click', function () { S.arbSub = el.getAttribute('data-arbsub'); S._arbSubUser = true; oppArbBoard(bd); });
    });
    [].forEach.call(bd.querySelectorAll('[data-arbref]'), function (el) {
      el.addEventListener('click', function (e) {
        // la calculadora vive DENTRO de la card: su click no debe abrir el detalle (bug reportado 8-jul)
        if (e.target.closest('[data-calc], .gx-calc-holder, .gx-calc-trow')) return;
        openArbDetail(el.getAttribute('data-arbref'));
      });
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
    // FASE CLUBES: los items de clubes traen competition + tm_ ids resueltos → cockpit del cruce cl-<liga>-<h>-<a>.
    if (opp.competition && opp.home_team_id && opp.away_team_id) { opp._openId = 'cl-' + opp.competition + '-' + opp.home_team_id + '-' + opp.away_team_id; S.arbCtx = opp; openMatch(opp._openId); return; }
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
    if (uiPlan() === 'free') return ''; // la calculadora es Pro+ (gating por plan)
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
          // "Retorno si acierta" TAMBIÉN en modo valor: sin esto la gente confundía "ganancia esperada" (EV,
          // promedio a largo plazo) con lo que cobra si la apuesta gana. Se muestran ambas, claramente separadas.
          (br > 0 ? stakeStat(t('calc_return_win'), '+' + fmtMoney(res.stake * (res.odds - 1), ccy), 'gx-pos') : '') +
          (br > 0 ? stakeStat(t('calc_ev'), fmtMoney(res.ev, ccy), '') : '') +
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

  // ---- P5: PORTFOLIO DEL DÍA — cartera agregada de las picks activas de las próximas 24 h ----
  // Reusa la misma matemática del panel simple (calcKelly) y la correlación intra-partido del feed (p.corr,
  // ρ real de la matriz de marcadores): 2+ picks del mismo evento reducen su stake por stake_factor en vez de
  // sumarse como independientes. Un límite diario (% del bankroll) escala todo proporcionalmente si se excede.
  function pfDayLimit() { var v = parseFloat(lsGet('gp_calc_daylimit')); return (isFinite(v) && v > 0 && v <= 100) ? v / 100 : 0.10; }
  function pfPicksOfDay() {
    var now = Date.now();
    return (S.dailyPicks || []).filter(function (p) {
      if (!(Number(p.odds) > 1 && p.confidence > 0)) return false;
      var ko = Date.parse(p.kickoff || 0);
      return isFinite(ko) && ko > now - 3 * 3600e3 && ko < now + 24 * 3600e3;
    });
  }
  function pfEventKey(p) { return p.club_eid || p.event_id || (p.home_team_id + '~' + p.away_team_id); }
  function pfBuild() {
    var br = calcBankroll(), fr = calcFraction(), lim = pfDayLimit();
    var rows = pfPicksOfDay().map(function (p) {
      var prob = (p.signals && p.signals.win_prob) || p.confidence;
      var res = calcKelly(prob, Number(p.odds), 1, fr); // bankroll 1 → el pct sale directo
      return { p: p, prob: prob, odds: Number(p.odds), pct: res.hasEdge ? res.pct : res.flatPct, corrF: 1 };
    });
    var byEvent = {}, order = [];
    rows.forEach(function (r) { var k = pfEventKey(r.p); if (!byEvent[k]) { byEvent[k] = []; order.push(k); } byEvent[k].push(r); });
    order.forEach(function (k) {
      var g = byEvent[k]; if (g.length < 2) return;
      var corr = g.map(function (r) { return r.p.corr; }).filter(Boolean)[0];
      if (corr && corr.stake_factor > 0) g.forEach(function (r) { r.corrF = corr.stake_factor; });
    });
    var sumPct = rows.reduce(function (a, r) { return a + r.pct * r.corrF; }, 0);
    var scale = (sumPct > lim && sumPct > 0) ? lim / sumPct : 1;
    rows.forEach(function (r) { r.finalPct = r.pct * r.corrF * scale; r.stake = br > 0 ? br * r.finalPct : 0; });
    var totalPct = sumPct * scale;
    // pérdida máx. estimada (p95) + resultado esperado: Monte Carlo sobre las probs del día; pares correlacionados
    // muestrean su conjunta 2x2 (joint_prob del feed); grupos sin conjunta comparten el uniforme (conservador).
    var expPnl = 0, p95Loss = 0;
    if (rows.length) {
      var N = 2000, pnls = new Array(N);
      for (var it = 0; it < N; it++) {
        var pnl = 0;
        order.forEach(function (k) {
          var g = byEvent[k];
          if (g.length === 2 && g[0].p.corr && g[0].p.corr.joint_prob > 0) {
            var pA = g[0].prob, pB = g[1].prob, pAB = Math.min(g[0].p.corr.joint_prob, pA, pB);
            var p10 = Math.max(pA - pAB, 0), p01 = Math.max(pB - pAB, 0);
            var u = Math.random(), wA, wB;
            if (u < pAB) { wA = 1; wB = 1; } else if (u < pAB + p10) { wA = 1; wB = 0; } else if (u < pAB + p10 + p01) { wA = 0; wB = 1; } else { wA = 0; wB = 0; }
            pnl += (wA ? g[0].stake * (g[0].odds - 1) : -g[0].stake) + (wB ? g[1].stake * (g[1].odds - 1) : -g[1].stake);
          } else {
            var us = g.length > 1 ? Math.random() : null;
            g.forEach(function (r) { var win = (us == null ? Math.random() : us) < r.prob; pnl += win ? r.stake * (r.odds - 1) : -r.stake; });
          }
        });
        pnls[it] = pnl;
        expPnl += pnl / N;
      }
      pnls.sort(function (a, b) { return a - b; });
      p95Loss = Math.max(0, -pnls[Math.floor(N * 0.05)]);
    }
    return { rows: rows, byEvent: byEvent, order: order, sumPct: sumPct, scale: scale, totalPct: totalPct, totalStake: br > 0 ? br * totalPct : 0, expPnl: expPnl, p95Loss: p95Loss, bankroll: br, limit: lim };
  }
  function pfExpoBars(items, ccy, br) {
    var max = items.reduce(function (a, x) { return Math.max(a, x.pct); }, 0) || 1;
    return items.map(function (x) {
      return '<div class="gx-cpf-row"><div class="gx-cpf-row-h"><span class="gx-cpf-lbl">' + x.label + '</span>' +
        '<span class="gx-mono">' + (br > 0 ? fmtMoney(x.stake, ccy) : (x.pct * 100).toFixed(1) + '%') + (x.n > 1 ? ' <span class="gx-dim">· ' + x.n + ' ' + esc(t('pf_count')) + '</span>' : '') + '</span></div>' +
        '<div class="gx-cpf-track"><div class="gx-cpf-bar" style="width:' + Math.max(3, Math.round(x.pct / max * 100)) + '%"></div></div></div>';
    }).join('');
  }
  function pfPanelHtml() {
    var ccy = calcCcy(), br = calcBankroll(), fr = calcFraction();
    if (S.dailyPicks === undefined) {
      S.dailyPicks = null;
      fetch('/api/beta/picks' + asplanQS('?'), { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
        S.dailyPicks = (j && j.picks) || [];
        if (S.view === 'calc' && S.calcMode === 'pf') renderCalc();
      });
    }
    if (S.dailyPicks === null) return '<div class="gx-calc gx-calc-standalone" data-cmode="pf"><div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div></div>';
    var pf = pfBuild();
    var head = '<div class="gx-calc-grid">' +
      '<label class="gx-calc-f gx-calc-f-br"><span>' + esc(t('calc_bankroll')) + '</span><div class="gx-calc-money"><span class="gx-calc-cur">' + esc(calcSym(ccy)) + '</span><input class="gx-calc-in" data-k="bankroll" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="' + (br > 0 ? br : '') + '"><select class="gx-calc-ccy" data-k="ccy">' + ccyOptions(ccy) + '</select></div></label>' +
      '<label class="gx-calc-f"><span>' + esc(t('cpf_day_limit')) + '</span><div class="gx-calc-unit"><input class="gx-calc-in" data-k="daylimit" type="number" inputmode="decimal" min="1" max="100" step="1" value="' + (pf.limit * 100).toFixed(0) + '"><i>%</i></div></label>' +
      '</div>' +
      '<div class="gx-calc-fracrow"><span class="gx-calc-lbl">' + esc(t('calc_fraction')) + '</span><div class="gx-calc-fracs">' + fracChips(fr) + '</div></div>';
    if (!pf.rows.length) {
      return '<div class="gx-calc gx-calc-standalone" data-cmode="pf">' + head +
        '<div class="gx-empty gx-pick-empty" style="margin-top:10px"><b>' + esc(t('cpf_empty')) + '</b><span class="gx-dim">' + esc(t('cpf_empty_sub')) + '</span></div></div>';
    }
    // agregados por partido y por liga
    var byMatch = pf.order.map(function (k) {
      var g = pf.byEvent[k], f = g[0].p;
      var label = '<span class="fl">' + flag(f.home_team_id) + '</span> <b>' + esc(teamName(f.home_team_id, f.home)) + '</b> <span class="gx-dim">' + esc(t('vs')) + '</span> <b>' + esc(teamName(f.away_team_id, f.away)) + '</b>' + (g[0].corrF < 1 ? ' <span class="gx-cpf-corr">ρ</span>' : '');
      return { label: label, stake: g.reduce(function (a, r) { return a + r.stake; }, 0), pct: g.reduce(function (a, r) { return a + r.finalPct; }, 0), n: g.length };
    }).sort(function (a, b) { return b.pct - a.pct; });
    var byLeague = {};
    pf.rows.forEach(function (r) {
      var k = r.p.competition_name || t('comp');
      var o = byLeague[k] = byLeague[k] || { label: esc(k), stake: 0, pct: 0, n: 0 };
      o.stake += r.stake; o.pct += r.finalPct; o.n++;
    });
    var leagues = Object.keys(byLeague).map(function (k) { return byLeague[k]; }).sort(function (a, b) { return b.pct - a.pct; });
    var anyCorr = pf.rows.some(function (r) { return r.corrF < 1; });
    var money = function (v) { return pf.bankroll > 0 ? fmtMoney(v, ccy) : '—'; };
    var pickRows = pf.rows.slice().sort(function (a, b) { return b.finalPct - a.finalPct; }).map(function (r) {
      var f = r.p;
      return '<div class="gx-cpf-row"><div class="gx-cpf-row-h"><span class="gx-cpf-lbl"><b>' + esc(pickRecText(f)) + '</b> <span class="gx-dim">· ' + esc(teamName(f.home_team_id, f.home)) + ' ' + esc(t('vs')) + ' ' + esc(teamName(f.away_team_id, f.away)) + ' · @' + r.odds.toFixed(2) + '</span>' + (r.corrF < 1 ? ' <span class="gx-cpf-corr">ρ ×' + r.corrF.toFixed(2) + '</span>' : '') + '</span>' +
        '<span class="gx-mono">' + (pf.bankroll > 0 ? fmtMoney(r.stake, ccy) : (r.finalPct * 100).toFixed(1) + '%') + '</span></div></div>';
    }).join('');
    return '<div class="gx-calc gx-calc-standalone" data-cmode="pf">' + head +
      '<div class="gx-cpf-count gx-dim">' + ic('ticket') + esc(t('cpf_n_picks', { n: pf.rows.length })) + '</div>' +
      '<div class="gx-calc-result">' +
        '<div class="gx-calc-big"><div class="gx-calc-biglbl">' + esc(t('cpf_total_stake')) + '</div><div class="gx-calc-bigval gx-mono">' + (pf.bankroll > 0 ? money(pf.totalStake) : '—') + '</div>' +
          '<div class="gx-calc-bigsub">' + (pf.bankroll > 0 ? (pf.totalPct * 100).toFixed(1) + '% ' + esc(t('calc_of_bankroll')) : esc(t('calc_set_bankroll'))) + '</div></div>' +
        '<div class="gx-calc-stats">' +
          stakeStat(t('cpf_total_risk'), pf.bankroll > 0 ? '−' + fmtMoney(pf.totalStake, ccy).replace('−', '') : (pf.totalPct * 100).toFixed(1) + '%', 'gx-neg') +
          (pf.bankroll > 0 ? stakeStat(t('cpf_max_loss'), '−' + fmtMoney(pf.p95Loss, ccy).replace('−', ''), 'gx-neg') : '') +
          (pf.bankroll > 0 ? stakeStat(t('cpf_exp_pnl'), (pf.expPnl >= 0 ? '+' : '') + fmtMoney(pf.expPnl, ccy), pf.expPnl >= 0 ? 'gx-pos' : 'gx-neg') : '') +
        '</div>' +
      '</div>' +
      (pf.scale < 1 ? '<div class="gx-calc-cap">' + ic('shield-check') + esc(t('cpf_scaled', { sum: pf.bankroll > 0 ? fmtMoney(pf.bankroll * pf.sumPct, ccy) : (pf.sumPct * 100).toFixed(1) + '%', pct: Math.round(pf.scale * 100) })) + '</div>' : '') +
      '<div class="gx-cpf-sec">' + esc(t('cpf_by_match')) + '</div>' + pfExpoBars(byMatch, ccy, pf.bankroll) +
      (leagues.length > 1 ? '<div class="gx-cpf-sec">' + esc(t('cpf_by_league')) + '</div>' + pfExpoBars(leagues, ccy, pf.bankroll) : '') +
      '<div class="gx-cpf-sec">' + esc(t('cpf_picks')) + '</div>' + pickRows +
      (anyCorr ? '<div class="gx-calc-prefill">' + ic('sparkles') + esc(t('cpf_corr_note')) + '</div>' : '') +
      (pf.bankroll > 0 ? '<div class="gx-calc-prefill">' + ic('info-circle') + esc(t('cpf_maxloss_note')) + '</div>' : '') +
      '<div class="gx-calc-disc">' + esc(t('calc_disc')) + '</div>' +
    '</div>';
  }
  function wirePfPanel(root) {
    root.addEventListener('click', function (e) { e.stopPropagation(); });
    [].forEach.call(root.querySelectorAll('.gx-calc-in, .gx-calc-ccy'), function (el) {
      var apply = function () {
        var k = el.getAttribute('data-k');
        if (k === 'bankroll') { var v = parseFloat(el.value); lsSet('gp_calc_bankroll', isFinite(v) && v > 0 ? v : null); }
        else if (k === 'daylimit') { var d = parseFloat(el.value); lsSet('gp_calc_daylimit', isFinite(d) && d > 0 && d <= 100 ? d : null); }
        else if (k === 'ccy') lsSet('gp_calc_ccy', el.value);
        renderCalc();
      };
      el.addEventListener('change', apply);
      if (el.tagName !== 'SELECT') el.addEventListener('keydown', function (e) { if (e.key === 'Enter') apply(); });
    });
    [].forEach.call(root.querySelectorAll('.gx-calc-frac'), function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); lsSet('gp_calc_fraction', b.getAttribute('data-frac')); renderCalc(); });
    });
  }

  // ---- vista STANDALONE (desde "Más") ----
  function renderCalc() {
    var mv = $('#gx-matchview'); if (!mv) return;
    // Calculadora de stake = plan Pro+. Free → candado con "Ver planes".
    if (uiPlan() === 'free') { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('calc_title')) + lockPanelPro('lock_calc_s') + '</div></div>'; return; }
    var mode = S.calcMode === 'arb' ? 'arb' : S.calcMode === 'pf' ? 'pf' : 'simple';
    var tabs = '<div class="gx-calc-modes">' +
      '<button class="gx-calc-mode' + (mode === 'simple' ? ' on' : '') + '" data-cmode-sw="simple">' + ic('target-arrow') + esc(t('calc_mode_simple')) + '</button>' +
      '<button class="gx-calc-mode' + (mode === 'pf' ? ' on' : '') + '" data-cmode-sw="pf">' + ic('briefcase') + esc(t('calc_mode_pf')) + '</button>' +
      '<button class="gx-calc-mode' + (mode === 'arb' ? ' on' : '') + '" data-cmode-sw="arb">' + ic('arrows-left-right') + esc(t('calc_mode_arb')) + '</button></div>';
    var body;
    if (mode === 'arb') {
      body = '<p class="gx-calc-intro gx-dim">' + esc(t('calc_intro_arb')) + '</p>' + arbPanelHtml([1.90, 2.10], [t('calc_leg') + ' 1', t('calc_leg') + ' 2'], ['', ''], 'gx-calc-standalone', true);
    } else if (mode === 'pf') {
      body = '<p class="gx-calc-intro gx-dim">' + esc(t('cpf_intro')) + '</p>' + pfPanelHtml();
    } else {
      body = '<p class="gx-calc-intro gx-dim">' + esc(t('calc_intro_simple')) + '</p>' + stakePanelHtml(0.55, 2.00, '', 'gp', 'gx-calc-standalone');
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:680px">' + viewHead(t('calc_title')) +
      '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body">' + tabs + body +
      '<p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('calc_kelly_note')) + '</p></div></div></div></div>';
    [].forEach.call(mv.querySelectorAll('[data-cmode-sw]'), function (b) { b.addEventListener('click', function () { S.calcMode = b.getAttribute('data-cmode-sw'); renderCalc(); }); });
    var holder = mv.querySelector('.gx-calc');
    if (holder) { if (mode === 'arb') wireArbPanel(holder); else if (mode === 'pf') wirePfPanel(holder); else wireStakePanel(holder); }
  }

  // ============================ F1 — MI CARTERA ============================
  // Registro personal de apuestas: P&L/ROI/CLV del usuario + GP-vs-manual. Flag S.me.my_bets (server).
  function mbPost(body, cb) {
    fetch('/api/me/bets', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) { if (j) S.myBets = j; if (cb) cb(j); if (S.view === 'bets') renderBets(); });
  }
  function mbStatTile(label, val, cls) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono ' + (cls || '') + '">' + val + '</b></div>'; }
  function renderBets() {
    var mv = $('#gx-matchview'); if (!mv) return;
    // Mi cartera = plan Sharp. Si el plan no la tiene → CANDADO con "Ver planes" (no redirigir en silencio).
    if (S.me && !S.me.my_bets) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_bets')) + lockPanel('lock_sharp_t', 'lock_bets_s') + '</div></div>'; return; }
    if (S.myBets === undefined) {
      S.myBets = null;
      fetch('/api/me/bets', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.myBets = j || { bets: [], stats: null }; if (S.view === 'bets') renderBets(); });
    }
    if (S.dailyPicks === undefined) {
      S.dailyPicks = null;
      fetch('/api/beta/picks' + asplanQS('?'), { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.dailyPicks = (j && j.picks) || []; if (S.view === 'bets') renderBets(); });
    }
    var d = S.myBets;
    if (!d) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('mb_title')) + mvLoading() + '</div></div>'; return; }
    var st = d.stats || {};
    var ccy = calcCcy();
    var money = function (v) { return fmtMoney(v || 0, ccy); };
    var ov = st.overall || { n: 0 };
    var kpis = '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body"><div class="gx-hero-grid" style="margin:0">' +
      mbStatTile(t('mb_pnl'), (ov.pnl >= 0 ? '+' : '') + money(ov.pnl), ov.pnl >= 0 ? 'gx-pos' : 'gx-neg') +
      mbStatTile(t('mb_roi'), ov.roi != null ? (ov.roi >= 0 ? '+' : '') + (ov.roi * 100).toFixed(1) + '%' : '—', ov.roi > 0 ? 'gx-pos' : ov.roi < 0 ? 'gx-neg' : '') +
      mbStatTile(t('mb_record'), (ov.wins || 0) + 'W-' + (ov.losses || 0) + 'L') +
      mbStatTile(t('mb_clv'), st.clv ? (st.clv.avg_pct >= 0 ? '+' : '') + st.clv.avg_pct + '%' : '—', st.clv && st.clv.avg_pct > 0 ? 'gx-pos' : '') +
      mbStatTile(t('mb_open'), (st.open_count || 0) + (st.open_stake ? ' · ' + money(st.open_stake) : '')) +
      '</div>' +
      ((st.gp && st.gp.n) || (st.manual && st.manual.n) ? '<div class="gx-pick-signals" style="margin-top:10px">' +
        esc(t('mb_gp')) + ' <b>' + (st.gp.wins || 0) + 'W-' + (st.gp.losses || 0) + 'L · ' + (st.gp.pnl >= 0 ? '+' : '') + money(st.gp.pnl) + '</b>' +
        '<span class="gx-sig-dot">·</span>' + esc(t('mb_manual')) + ' <b>' + (st.manual.wins || 0) + 'W-' + (st.manual.losses || 0) + 'L · ' + (st.manual.pnl >= 0 ? '+' : '') + money(st.manual.pnl) + '</b></div>' : '') +
      '</div></div>';
    // form de registro: pick del feed (autollenar cuota) o manual
    var pickOpts = '<option value="">' + esc(t('mb_manual_opt')) + '</option>' + (S.dailyPicks || []).map(function (p2) {
      return '<option value="' + esc(p2.pick_id) + '" data-odds="' + (p2.odds != null ? Number(p2.odds).toFixed(2) : '') + '">' + esc(pickRecText(p2) + ' · ' + teamName(p2.home_team_id, p2.home) + ' v ' + teamName(p2.away_team_id, p2.away) + (p2.odds ? ' @' + Number(p2.odds).toFixed(2) : '')) + '</option>';
    }).join('');
    var form = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('plus') + esc(t('mb_add')) + '</span></div><div class="gx-mod-body">' +
      '<div class="gx-calc" style="padding:0;border:0;background:none">' +
      '<label class="gx-calc-f"><span>' + esc(t('mb_pick')) + '</span><select class="gx-calc-in" id="mb-pick" style="width:100%">' + pickOpts + '</select></label>' +
      '<div class="gx-calc-grid" style="margin-top:8px">' +
      '<label class="gx-calc-f gx-calc-f-br"><span>' + esc(t('mb_label')) + '</span><input class="gx-calc-in" id="mb-label" maxlength="140" placeholder="Bahia v Chapecoense · Over 2.5"></label>' +
      '<label class="gx-calc-f"><span>' + esc(t('mb_odds')) + '</span><input class="gx-calc-in" id="mb-odds" type="number" inputmode="decimal" min="1.01" step="0.01"></label>' +
      '<label class="gx-calc-f"><span>' + esc(t('mb_stake')) + '</span><input class="gx-calc-in" id="mb-stake" type="number" inputmode="decimal" min="0" step="any"></label>' +
      '</div>' +
      '<div class="gx-calc-grid" style="margin-top:8px">' +
      '<label class="gx-calc-f"><span>' + esc(t('mb_book')) + '</span><input class="gx-calc-in" id="mb-book" maxlength="40" placeholder="bet365" list="mb-book-list"><datalist id="mb-book-list">' +
        (function () { var mine = (S.me && S.me.my_books_list) || []; var rest = BK_COMMON.concat(BK_PREDICTION).filter(function (b) { return mine.indexOf(b) < 0; }); return mine.concat(rest).map(function (b) { return '<option value="' + esc(b) + '">' + esc(prettyBook(b)) + '</option>'; }).join(''); })() + '</datalist></label>' +
      '<div class="gx-calc-f" style="justify-content:flex-end"><button class="gx-btn" id="mb-save">' + esc(t('mb_save')) + '</button></div>' +
      '</div></div></div></div>';
    // historial
    var rows = (d.bets || []).map(function (b) {
      var res = b.result === 'won' ? '<span class="gx-badge" style="background:rgba(31,227,164,.12);color:var(--gx-accent)">' + esc(t('mb_won')) + '</span>'
        : b.result === 'lost' ? '<span class="gx-badge" style="background:rgba(255,107,107,.12);color:var(--gx-neg)">' + esc(t('mb_lost')) + '</span>'
        : b.result === 'void' ? '<span class="gx-badge gx-dim">' + esc(t('mb_void')) + '</span>' : '';
      var actions = b.result === 'open'
        ? '<button class="gx-why-btn" data-mbres="won|' + esc(b.id) + '">W</button> <button class="gx-why-btn" data-mbres="lost|' + esc(b.id) + '">L</button> <button class="gx-why-btn" data-mbres="void|' + esc(b.id) + '">∅</button>'
        : res + ' <button class="gx-why-btn" data-mbres="open|' + esc(b.id) + '">' + esc(t('mb_reopen')) + '</button>';
      return '<tr><td class="l gx-dim" style="font-size:10.5px;white-space:nowrap">' + esc(fmtDate(b.at)) + '</td>' +
        '<td class="l"><b style="font-size:12px">' + esc(b.label) + '</b>' + (b.pick_id ? ' <span class="gx-badge" style="font-size:9px">GP</span>' : '') + (b.book ? '<div class="gx-dim" style="font-size:10px">' + esc(prettyBook(b.book)) + '</div>' : '') + '</td>' +
        '<td class="gx-mono">' + Number(b.odds).toFixed(2) + '</td><td class="gx-mono">' + money(b.stake) + '</td>' +
        '<td class="l" style="white-space:nowrap">' + actions + ' <button class="gx-why-btn" data-mbdel="' + esc(b.id) + '" title="' + esc(t('mb_del')) + '">' + ic('x') + '</button></td></tr>';
    }).join('');
    var table = (d.bets || []).length
      ? '<div class="gx-panel gx-board"><table class="gx-table"><thead><tr><th class="l">·</th><th class="l">' + esc(t('mb_label')) + '</th><th>' + esc(t('mb_odds')) + '</th><th>' + esc(t('mb_stake')) + '</th><th class="l">' + esc(t('mb_result')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="gx-empty gx-pick-empty">' + illo('tickets') + '<b>' + esc(t('mb_empty')) + '</b><span class="gx-dim">' + esc(t('mb_empty_sub')) + '</span></div>';
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:860px">' + viewHead(t('mb_title')) +
      '<p class="gx-calc-intro gx-dim">' + esc(t('mb_intro')) + '</p>' + kpis + form + table +
      '<p class="gx-mod-note gx-dim">' + ic('lock') + ' ' + esc(t('mb_note')) + '</p></div></div>';
    var sel = mv.querySelector('#mb-pick');
    if (sel) sel.addEventListener('change', function () {
      var op = sel.options[sel.selectedIndex];
      var od = op && op.getAttribute('data-odds');
      if (od) mv.querySelector('#mb-odds').value = od;
      if (sel.value) mv.querySelector('#mb-label').value = (op.textContent || '').split(' @')[0];
    });
    var sv = mv.querySelector('#mb-save');
    if (sv) sv.addEventListener('click', function () {
      var body = {
        pick_id: (mv.querySelector('#mb-pick') || {}).value || null,
        label: (mv.querySelector('#mb-label') || {}).value || '',
        odds: parseFloat((mv.querySelector('#mb-odds') || {}).value),
        stake: parseFloat((mv.querySelector('#mb-stake') || {}).value),
        book: (mv.querySelector('#mb-book') || {}).value || null,
      };
      if (!(body.odds > 1) || !(body.stake > 0)) return;
      mbPost(body);
    });
    [].forEach.call(mv.querySelectorAll('[data-mbres]'), function (b) {
      b.addEventListener('click', function () { var pp2 = b.getAttribute('data-mbres').split('|'); mbPost({ id: pp2[1], result: pp2[0] }); });
    });
    [].forEach.call(mv.querySelectorAll('[data-mbdel]'), function (b) {
      b.addEventListener('click', function () { if (confirm(t('mb_del_confirm'))) mbPost({ id: b.getAttribute('data-mbdel'), delete: true }); });
    });
  }

  // ============================ F2 — MIS CASAS ============================
  // Universo REAL de casas con cuotas en nuestro scanner (códigos de The Odds API presentes en la DB de
  // cuotas), ordenado: primero las marcas grandes/LATAM, luego el resto alfabético. + mercados de predicción.
  var BK_COMMON = [
    'bet365', 'betano', 'betano_uk', 'draftkings', 'fanduel', 'betmgm', 'caesars', 'betrivers', 'espnbet', 'pinnacle', 'williamhill', 'williamhill_us', 'codere', 'codere_it', 'bplay', 'betway', 'bwin', 'unibet',
    'onexbet', 'betanysports', 'betclic_fr', 'betfair_ex_eu', 'betfair_ex_uk', 'betfair_sb_uk', 'betfred_uk', 'betonlineag', 'betsson', 'betus', 'betvictor', 'bovada', 'boylesports', 'casumo', 'coolbet', 'coral',
    'everygame', 'fanatics', 'grosvenor', 'gtbets', 'ladbrokes_uk', 'leovegas', 'leovegas_se', 'livescorebet', 'lowvig', 'marathonbet', 'matchbook', 'mybookieag', 'nordicbet', 'paddypower', 'pmu_fr', 'skybet',
    'smarkets', 'sport888', 'tipico_de', 'unibet_fr', 'unibet_nl', 'unibet_se', 'unibet_uk', 'virginbet', 'winamax_de', 'winamax_fr'
  ];
  var BK_PREDICTION = ['polymarket', 'kalshi', 'myriad']; // mercados de predicción que el scanner compara
  var BK_CRYPTO = ['cloudbet', 'stake', 'rollbit', 'bcgame', 'sportsbetio', 'bitcasino', 'livecasino']; // casas cripto (cloudbet LIVE; sportsbet.io/bitcasino/livecasino con afiliado partners.io 27-jul)
  function renderBooks() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (S.me && !S.me.my_books) { showView('board'); return; }
    var mine = (S.me && S.me.my_books_list) || [];
    var known = BK_PREDICTION.concat(BK_CRYPTO);
    var all = BK_COMMON.slice();
    mine.forEach(function (b) { if (all.indexOf(b) < 0 && known.indexOf(b) < 0) all.push(b); });
    var chip = function (b) {
      var on = mine.indexOf(b) >= 0;
      return '<button class="gx-calc-frac' + (on ? ' on' : '') + '" data-bk="' + esc(b) + '" style="font-size:12px;padding:7px 12px">' + bookLogo(b) + esc(prettyBook(b)) + '</button>';
    };
    var chips = all.map(chip).join('');
    var predChips = BK_PREDICTION.map(chip).join('');
    var cryptoChips = BK_CRYPTO.map(chip).join('');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:680px">' + viewHead(t('bk_title')) +
      '<p class="gx-calc-intro gx-dim">' + esc(t('bk_intro')) + '</p>' +
      '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body">' +
      '<div class="gx-cpf-sec" style="border-top:0;padding-top:0;margin-top:0">' + esc(t('bk_sportsbooks')) + '</div>' +
      '<div class="gx-calc-fracs" style="flex-wrap:wrap;gap:8px;margin-top:8px">' + chips + '</div>' +
      '<div class="gx-cpf-sec" style="margin-top:14px">' + esc(t('bk_crypto')) + '</div>' +
      '<div class="gx-calc-fracs" style="flex-wrap:wrap;gap:8px;margin-top:8px">' + cryptoChips + '</div>' +
      // ABRIR CASA (25-jul): los chips de arriba son toggles de preferencia; estos son enlaces salientes reales.
      // Stake lleva el código de afiliado de GP. Cripto no cotiza en nuestro feed de cuotas, así que esta es la
      // única superficie donde el enlace puede existir.
      '<div class="gx-calc-fracs" style="flex-wrap:wrap;gap:8px;margin-top:8px">' +
        BK_CRYPTO.filter(function (b) { return !!bookUrl(b); }).map(function (b) {
          return '<a class="gx-ov-venue" href="' + esc(bookUrl(b)) + '" target="_blank" rel="noopener noreferrer" style="font-size:12px;padding:7px 12px">' + bookLogo(b) + ic('external-link') + esc(prettyBook(b)) + '</a>';
        }).join('') +
      '</div>' +
      '<div class="gx-cpf-sec" style="margin-top:14px">' + esc(t('bk_prediction')) + '</div>' +
      '<div class="gx-calc-fracs" style="flex-wrap:wrap;gap:8px;margin-top:8px">' + predChips + '</div>' +
      '<div class="gx-calc-grid" style="margin-top:12px"><label class="gx-calc-f gx-calc-f-br"><span>' + esc(t('bk_custom')) + '</span><input class="gx-calc-in" id="bk-custom" maxlength="40" placeholder="pinnacle"></label>' +
      '<div class="gx-calc-f" style="justify-content:flex-end"><button class="gx-btn" id="bk-add">' + esc(t('bk_add')) + '</button></div></div>' +
      '<div style="margin-top:12px;display:flex;align-items:center;gap:10px"><button class="gx-btn" id="bk-save">' + esc(t('bk_save')) + '</button><span class="gx-dim" id="bk-msg" style="font-size:12px"></span></div>' +
      '</div></div></div></div>';
    var sel = {};
    mine.forEach(function (b) { sel[b] = true; });
    [].forEach.call(mv.querySelectorAll('[data-bk]'), function (b) {
      b.addEventListener('click', function () { var k = b.getAttribute('data-bk'); sel[k] = !sel[k]; b.classList.toggle('on', !!sel[k]); });
    });
    var add = mv.querySelector('#bk-add');
    if (add) add.addEventListener('click', function () {
      var v = String((mv.querySelector('#bk-custom') || {}).value || '').toLowerCase().trim();
      if (!v) return;
      sel[v] = true;
      S.me.my_books_list = Object.keys(sel).filter(function (k) { return sel[k]; });
      renderBooks();
    });
    var sv = mv.querySelector('#bk-save');
    if (sv) sv.addEventListener('click', function () {
      var books = Object.keys(sel).filter(function (k) { return sel[k]; });
      fetch('/api/me/books', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify({ books: books }) })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { if (j) { S.me.my_books_list = j.books; var m = mv.querySelector('#bk-msg'); if (m) m.textContent = '✓ ' + t('bk_saved'); } });
    });
  }

  // ============================ F3 — WATCH PRICE (UI) ============================
  function wpPost(body, cb) {
    fetch('/api/me/watches', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) { if (j) S.watches = j.watches || []; if (cb) cb(j); if (S.view === 'alerts') renderAlerts(); });
  }
  function watchBtn(p) {
    if (!(S.me && S.me.watch_price) || !p.pick_id || p.odds == null) return '';
    return '<button class="gx-why-btn" data-watchbtn="' + esc(p.pick_id) + '" data-odds="' + Number(p.odds).toFixed(2) + '">' + ic('eye') + esc(t('wp_watch')) + '</button>';
  }
  function toggleWatchRow(btn) {
    var card = btn.closest('.gx-pick-card'); if (!card) return;
    var ex = card.querySelector(':scope > .gx-wp-row');
    if (ex) { ex.remove(); return; }
    var row = document.createElement('div');
    row.className = 'gx-wp-row';
    var cur = parseFloat(btn.getAttribute('data-odds')) || 2;
    row.innerHTML = '<span class="gx-dim" style="font-size:11.5px">' + esc(t('wp_target')) + '</span>' +
      '<input class="gx-calc-in" type="number" inputmode="decimal" min="1.01" step="0.01" value="' + (cur + 0.1).toFixed(2) + '" style="width:84px">' +
      '<button class="gx-btn" style="padding:6px 12px;font-size:12px">' + esc(t('wp_set')) + '</button><span class="gx-dim" style="font-size:11px"></span>';
    row.addEventListener('click', function (e) { e.stopPropagation(); });
    row.querySelector('.gx-btn').addEventListener('click', function () {
      var tv = parseFloat(row.querySelector('input').value);
      if (!(tv > 1)) return;
      wpPost({ pick_id: btn.getAttribute('data-watchbtn'), target_odds: tv }, function (j) {
        row.querySelector('span:last-child').textContent = j ? '✓ ' + t('wp_created') : '✗';
        setTimeout(function () { row.remove(); }, 1200);
      });
    });
    card.appendChild(row);
  }
  function watchesPanel() {
    if (!(S.me && S.me.watch_price)) return '';
    if (S.watches === undefined) {
      S.watches = null;
      fetch('/api/me/watches', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.watches = (j && j.watches) || []; if (S.view === 'alerts') renderAlerts(); });
    }
    var ws = S.watches || [];
    var rows = ws.map(function (w) {
      var stt = w.triggered_at ? '<span class="gx-badge" style="background:rgba(31,227,164,.12);color:var(--gx-accent)">' + esc(t('wp_hit')) + '</span>'
        : w.dead ? '<span class="gx-badge gx-dim">' + esc(t('wp_expired')) + '</span>'
        : '<span class="gx-badge" style="background:rgba(91,168,255,.12);color:var(--gx-blue)">' + esc(t('wp_active')) + '</span>';
      return '<div class="gx-intel-row" style="grid-template-columns:minmax(0,1fr) auto auto auto"><span class="n"><b style="font-size:12px">' + esc(w.label) + '</b><div class="gx-dim" style="font-size:10.5px">' + esc(t('wp_target_s')) + ' ' + Number(w.target_odds).toFixed(2) + (w.last_odds != null ? ' · ' + esc(t('wp_last')) + ' ' + Number(w.last_odds).toFixed(2) : '') + '</div></span>' +
        '<span class="v">' + stt + '</span><span class="v"><button class="gx-why-btn" data-wpdel="' + esc(w.id) + '">' + ic('x') + '</button></span></div>';
    }).join('');
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('eye') + esc(t('wp_list')) + '</span></div><div class="gx-mod-body">' +
      (rows || '<p class="gx-dim" style="font-size:12px;margin:0">' + esc(t('wp_none')) + '</p>') + '</div></div>';
  }

  // ============================ F4 — GP DAILY BRIEF (in-app) ============================
  function renderBrief() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (S.me && !S.me.daily_brief) { showView('board'); return; }
    if (S.brief === undefined) {
      S.brief = null;
      fetch('/api/me/brief', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { S.brief = j; if (S.view === 'brief') renderBrief(); });
    }
    var d = S.brief;
    if (!d) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('bf_title')) + mvLoading() + '</div></div>'; return; }
    var b = d.brief || {};
    var secPanel = function (icn, key, inner) { return inner ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic(icn) + esc(t(key)) + '</span></div><div class="gx-mod-body">' + inner + '</div></div>' : ''; };
    var topHtml = (b.top_picks || []).map(function (p2) {
      var openId = p2.club_eid || p2.event_id || ((p2.home_team_id && p2.away_team_id) ? 'teams-' + p2.home_team_id + '-' + p2.away_team_id : null);
      return '<div class="gx-intel-row' + (openId ? ' gx-pick-clickable' : '') + '"' + (openId ? ' data-openmatch="' + esc(openId) + '"' : '') + ' style="grid-template-columns:minmax(0,1fr) auto auto"><span class="n"><b style="font-size:12.5px">' + esc(pickRecText(p2)) + '</b><div class="gx-dim" style="font-size:10.5px">' + esc(teamName(p2.home_team_id, p2.home) + ' v ' + teamName(p2.away_team_id, p2.away)) + (p2.league ? ' · ' + esc(p2.league) : '') + ' · ' + esc(fmtDateTime(p2.kickoff)) + '</div></span>' +
        '<span class="v gx-mono">' + (p2.odds ? '@' + Number(p2.odds).toFixed(2) : '') + '</span>' +
        '<span class="v gx-mono gx-pos">' + (p2.edge_pp != null ? '+' + p2.edge_pp + 'pp' : '') + '</span></div>';
    }).join('');
    var matchesHtml = (b.matches || []).map(function (m) {
      var openId = m.club_eid || ((m.home_team_id && m.away_team_id) ? 'teams-' + m.home_team_id + '-' + m.away_team_id : null);
      return '<div class="gx-intel-row' + (openId ? ' gx-pick-clickable' : '') + '"' + (openId ? ' data-openmatch="' + esc(openId) + '"' : '') + ' style="grid-template-columns:minmax(0,1fr) auto"><span class="n"><span class="fl">' + flag(m.home_team_id) + '</span> <b>' + esc(teamName(m.home_team_id, m.home)) + '</b> <span class="gx-dim">' + esc(t('vs')) + '</span> <b>' + esc(teamName(m.away_team_id, m.away)) + '</b><div class="gx-dim" style="font-size:10.5px">' + (m.league ? esc(m.league) + ' · ' : '') + esc(fmtDateTime(m.kickoff)) + '</div></span>' +
        '<span class="v gx-dim" style="font-size:11px">' + m.picks + ' ' + esc(m.picks === 1 ? t('pf_count1') : t('pf_count')) + '</span></div>';
    }).join('');
    var movesHtml = (b.line_moves || []).map(function (m) {
      return '<div class="gx-intel-row" style="grid-template-columns:minmax(0,1fr) auto"><span class="n">' + esc(m.home + ' v ' + m.away) + ' <i class="gx-dim">' + esc(m.family) + '</i></span><span class="v gx-mono ' + (m.direction === 'with' ? 'gx-pos' : '') + '">' + (m.pp > 0 ? '+' : '') + m.pp + 'pp ' + esc(m.direction === 'with' ? t('bf_move_with') : t('bf_move_against')) + '</span></div>';
    }).join('');
    var findingsHtml = (b.findings || []).map(function (f) {
      return '<div class="gx-finding"><span class="gx-finding-dot gx-fd-' + (f.status === 'OUT' || f.status === 'SUSPENDED' ? 'out' : 'doubt') + '"></span><span class="fl">' + flag(f.team_id) + '</span><span class="gx-finding-tx">' + esc((LANG === 'en' ? f.why_en : f.why_es) || f.player) + '</span></div>';
    }).join('');
    var y = b.yesterday || { n: 0 };
    var yHtml = y.n ? '<div class="gx-pick-recap' + (y.wins / Math.max(1, y.wins + y.losses) >= 0.5 ? ' gx-recap-pos' : '') + '" style="margin-bottom:8px">' + ic('circle-check') + esc(t('bf_yn', { wins: y.wins, losses: y.losses, n: y.n })) + '</div>' +
      (y.rows || []).map(function (r) {
        return '<div class="gx-intel-row" style="grid-template-columns:minmax(0,1fr) auto"><span class="n">' + esc(r.home + ' v ' + r.away) + ' <i class="gx-dim">' + esc(r.family) + (r.league ? ' · ' + esc(r.league) : '') + '</i></span><span class="v gx-mono ' + (r.result === 'WIN' ? 'gx-pos' : r.result === 'LOSS' ? 'gx-neg' : 'gx-dim') + '">' + esc(r.result) + '</span></div>';
      }).join('') : '';
    var bk = d.bankroll && d.bankroll.overall && d.bankroll.overall.n ? (function (st) {
      var ccy = calcCcy();
      return '<div class="gx-hero-grid" style="margin:0">' +
        mbStatTile(t('mb_pnl'), (st.overall.pnl >= 0 ? '+' : '') + fmtMoney(st.overall.pnl, ccy), st.overall.pnl >= 0 ? 'gx-pos' : 'gx-neg') +
        mbStatTile(t('mb_record'), st.overall.wins + 'W-' + st.overall.losses + 'L') +
        mbStatTile(t('mb_open'), String(st.open_count || 0)) + '</div>';
    })(d.bankroll) : '';
    var emailTgl = '<label style="display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer"><input type="checkbox" id="bf-email"' + (d.email_opt_in ? ' checked' : '') + '> ' + esc(t('bf_email')) + ' <span class="gx-dim" id="bf-email-msg" style="font-size:11px"></span></label>';
    var empty = !(b.top_picks || []).length && !y.n ? '<div class="gx-empty gx-pick-empty">' + illo('tickets') + '<b>' + esc(t('bf_empty')) + '</b></div>' : '';
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:760px">' + viewHead(t('bf_title')) +
      '<p class="gx-calc-intro gx-dim">' + esc(t('bf_sub')) + '</p>' + empty +
      secPanel('star', 'bf_top', topHtml) +
      secPanel('ball-football', 'bf_matches', matchesHtml) +
      secPanel('trending-up', 'bf_moves', movesHtml) +
      (findingsHtml ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('bulb') + esc(t('bf_findings')) + '</span></div><div class="gx-findings" style="padding:10px 16px 12px">' + findingsHtml + '</div></div>' : '') +
      secPanel('circle-check', 'bf_yesterday', yHtml) +
      secPanel('wallet', 'bf_bankroll', bk) +
      '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body">' + emailTgl + '</div></div>' +
      '<div class="gx-pick-disc">' + esc(t('pf_disclaimer')) + '</div></div></div>';
    var tgl = mv.querySelector('#bf-email');
    if (tgl) tgl.addEventListener('change', function () {
      fetch('/api/me/brief', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify({ email_opt_in: tgl.checked }) })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { var m = mv.querySelector('#bf-email-msg'); if (m) m.textContent = j ? '✓ ' + t('bf_email_saved') : '✗'; });
    });
  }

  // ============================ ONBOARDING (primer ingreso) ============================
  // Solo cuentas creadas DESPUÉS del feature (los ~600 usuarios existentes nunca lo ven) y solo la primera vez:
  // el "visto" se persiste por cuenta en el server (db.users.onboarded) + localStorage como respaldo.
  // ============================ FREE TRIAL: modal de entrada (27-jul) ============================
  // A TODO usuario FREE elegible (nunca usó el trial), en CADA sesión (sessionStorage, no localStorage:
  // la orden de Alexis es que reaparezca en cada entrada pero se cierre fácil con la X).
  function maybeTrialModal() {
    try {
      if (!S.me || !S.me.trial_eligible || uiPlan() !== 'free') return;
      if (sessionStorage.getItem('gp_trial_seen')) return;
      if (document.getElementById('gx-trialm')) return;
      var benefits = ['tm_b1', 'tm_b2', 'tm_b3', 'tm_b4'].map(function (k) {
        return '<li>' + ic('circle-check') + '<span>' + esc(t(k)) + '</span></li>';
      }).join('');
      var wrap = document.createElement('div'); wrap.id = 'gx-trialm'; wrap.className = 'gx-onb';
      wrap.innerHTML = '<div class="gx-onb-bg"></div><div class="gx-onb-card gx-trial-card">' +
        '<button class="gx-trial-x" id="gx-trialm-x" aria-label="✕">✕</button>' +
        '<div class="gx-trial-eyebrow">' + esc(t('tm_eyebrow')) + '</div>' +
        '<h3>' + esc(t('tm_title')) + '</h3>' +
        '<p class="gx-trial-sub">' + esc(t('tm_sub')) + '</p>' +
        '<ul class="gx-trial-list">' + benefits + '</ul>' +
        '<a class="gx-btn gx-onb-cta gx-trial-cta" href="/api/founder/checkout?plan=sharp_t">' + esc(t('tm_cta')) + '</a>' +
        '<div class="gx-trial-micro">' + esc(t('tm_micro')) + '</div>' +
        '<button class="gx-onb-skip" id="gx-trialm-no">' + esc(t('tm_no')) + '</button></div>';
      var close = function () { try { sessionStorage.setItem('gp_trial_seen', '1'); } catch (e) {} wrap.remove(); };
      wrap.querySelector('#gx-trialm-x').addEventListener('click', close);
      wrap.querySelector('#gx-trialm-no').addEventListener('click', close);
      document.body.appendChild(wrap);
    } catch (e) {}
  }

  var ONB_CUTOFF = Date.parse('2026-07-04T18:00:00Z');
  // BUG 26-jul (reporte Alexis): la marca "ya vio el tour" era una key GLOBAL de localStorage → si en ese
  // navegador cualquier cuenta cerró el tour alguna vez, una cuenta NUEVA no lo veía jamás (típico en el
  // móvil del propio Alexis). La marca ahora es POR CUENTA; la fuente principal sigue siendo el flag del
  // server (db.users.onboarded) y el localStorage es solo respaldo por si el POST no llegó.
  function onbKey() { return 'gp_onboarded:' + ((S.me && S.me.email) || ''); }
  function maybeOnboard() {
    try {
      if (!S.me || S.me.onboarded || lsGet(onbKey())) return;
      if (!(S.me.createdAt && S.me.createdAt >= ONB_CUTOFF)) return;
      showOnboard();
    } catch (e) {}
  }
  function onbFinish() {
    lsSet(onbKey(), '1');
    fetch('/api/me/onboarded', { method: 'POST', headers: hdrs() }).catch(function () {});
    if (S.me) S.me.onboarded = Date.now();
    var o = document.getElementById('gx-onb'); if (o) o.remove();
  }
  function showOnboard() {
    if (document.getElementById('gx-onb')) return;
    // 26-jul (pedido de Alexis): el tour muestra los MEJORES features — picks, cockpit de partidos, Value/Arb
    // y Mi cartera (los Sharp llevan chip "Disponible en Sharp") — en vez de seguidos/alertas: mucha gente
    // entraba sin enterarse de todo lo que ofrece la plataforma.
    var steps = [
      { ic: 'ticket', t: 'onb_1t', s: 'onb_1s' },
      { ic: 'ball-football', t: 'onb_2t', s: 'onb_2s' },
      { ic: 'trending-up', t: 'onb_3t', s: 'onb_3s', sharp: true },
      { ic: 'wallet', t: 'onb_4t', s: 'onb_4s', sharp: true },
    ];
    var i = 0;
    var wrap = document.createElement('div'); wrap.id = 'gx-onb'; wrap.className = 'gx-onb';
    function paint() {
      var st = steps[i];
      wrap.innerHTML = '<div class="gx-onb-bg"></div><div class="gx-onb-card">' +
        '<div class="gx-onb-ic">' + ic(st.ic) + '</div>' +
        '<h3>' + esc(t(st.t)) + '</h3>' + (st.sharp ? '<span class="gx-onb-chip">' + ic('crown') + ' ' + esc(t('onb_sharp')) + '</span>' : '') + '<p>' + esc(t(st.s)) + '</p>' +
        '<div class="gx-onb-dots">' + steps.map(function (_, k) { return '<i class="' + (k === i ? 'on' : '') + '"></i>'; }).join('') + '</div>' +
        '<button class="gx-btn gx-onb-cta" id="gx-onb-next">' + esc(t(i === steps.length - 1 ? 'onb_done' : 'onb_next')) + '</button>' +
        '<button class="gx-onb-skip" id="gx-onb-skip">' + esc(t('onb_skip')) + '</button></div>';
      wrap.querySelector('#gx-onb-next').addEventListener('click', function () { if (i < steps.length - 1) { i++; paint(); } else onbFinish(); });
      wrap.querySelector('#gx-onb-skip').addEventListener('click', onbFinish);
    }
    paint();
    document.body.appendChild(wrap);
  }

  // ============================ PLANES: helpers + Mi suscripción + Soporte ============================
  // uiPlan(): plan efectivo para la UI. El admin puede PREVISUALIZAR otro plan con gp_asplan (localStorage);
  // el server honra el mismo override vía ?asplan= (solo admin). Pre-lanzamiento todos son 'sharp'.
  function uiPlan() {
    var as = (S.me && S.me.isAdmin) ? (lsGet('gp_asplan') || '') : '';
    if (as === 'free' || as === 'pro' || as === 'sharp') return as;
    return (S.me && S.me.plan_effective) || 'sharp';
  }
  function asplanQS(sep) {
    var as = (S.me && S.me.isAdmin) ? (lsGet('gp_asplan') || '') : '';
    return (as === 'free' || as === 'pro' || as === 'sharp') ? ((sep || '?') + 'asplan=' + as) : '';
  }
  // panel candado (Value/Arbitraje para no-Sharp) — mismo lenguaje del lock de la landing
  function lockPanel(titleK, subK) {
    return '<div class="gx-empty gx-lockpanel">' + ic('lock') + '<b>' + esc(t(titleK || 'lock_sharp_t')) + '</b>' +
      '<span class="gx-dim">' + esc(t(subK || 'lock_sharp_s')) + '</span>' +
      '<a class="gx-btn gx-lock-cta" href="/plans">' + ic('crown') + esc(t('lock_cta')) + '</a></div>';
  }
  // candado Pro (proyección de goles para el plan Free)
  function lockPanelPro(subK) {
    return '<div class="gx-empty gx-lockpanel">' + ic('lock') + '<b>' + esc(t('lock_pro_t')) + '</b>' +
      '<span class="gx-dim">' + esc(t(subK || 'lock_pro_s')) + '</span>' +
      '<a class="gx-btn gx-lock-cta" href="/plans">' + ic('crown') + esc(t('lock_cta')) + '</a></div>';
  }
  function renderSub() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var plan = (S.me && S.me.plan) || 'free';
    var enforced = !!(S.me && S.me.plans_enforced);
    var founder = !!(S.me && S.me.plan_founder);
    var status = (S.me && S.me.plan_status) || null;
    var statusLbl = status === 'cancelled' ? t('sub_cancelled') : status === 'past_due' ? t('sub_pastdue') : t('sub_active');
    var planName = plan === 'sharp' ? 'Sharp' : plan === 'pro' ? 'Pro' : 'Free';
    var body = '<div class="gx-sub-row"><span class="gx-label">' + esc(t('sub_plan')) + '</span><b class="gx-sub-plan">' + planName + (founder ? ' <span class="gx-sub-founder">★ ' + esc(t('sub_founder')) + '</span>' : '') + '</b></div>' +
      (status ? '<div class="gx-sub-row"><span class="gx-label">' + esc(t('sub_status')) + '</span><b>' + esc(statusLbl) + '</b></div>' : '') +
      (S.me && S.me.plan_since ? '<div class="gx-sub-row"><span class="gx-label">' + esc(t('sub_since')) + '</span><b>' + esc(fmtDate(S.me.plan_since)) + '</b></div>' : '') +
      (!enforced ? '<p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('sub_free_note')) + '</p>' : '') +
      '<div class="gx-sub-actions">' +
        (plan !== 'sharp' ? '<a class="gx-btn gx-btn-ac" href="/plans">' + ic('crown') + '<span>' + esc(plan === 'pro' ? t('sub_up_sharp') : t('sub_upgrade')) + '</span></a>' : '') +
        (plan !== 'free' && status !== 'cancelled' ? '<button class="gx-btn" id="gx-sub-cancel">' + ic('x') + '<span>' + esc(t('sub_cancel')) + '</span></button>' : '') +
      '</div>' +
      (status === 'cancelled' ? '<p class="gx-mod-note gx-dim" style="margin-top:10px">' + ic('info-circle') + ' ' + esc(t('sub_cancelled_note')) + '</p>' : '');
    var admin = '';
    if (S.me && S.me.isAdmin) {
      var cur = lsGet('gp_asplan') || '';
      var chip = function (v, lbl) { return '<button class="gx-chip gx-chip-btn' + (cur === v ? ' on' : '') + '" data-asplan="' + v + '">' + esc(lbl) + '</button>'; };
      admin = '<div class="gx-panel" style="margin-top:14px"><div class="gx-mod-body"><span class="gx-label">' + esc(t('sub_asplan')) + '</span>' +
        '<div class="gx-chips" style="margin-top:10px">' + chip('', t('sub_asplan_real')) + chip('free', 'Free') + chip('pro', 'Pro') + chip('sharp', 'Sharp') + '</div></div></div>';
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:640px">' + viewHead(t('sub_title')) +
      '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body">' + body + '</div></div>' + admin + '</div></div>';
    var cbtn = mv.querySelector('#gx-sub-cancel');
    if (cbtn) cbtn.addEventListener('click', openCancelFlow);
    [].forEach.call(mv.querySelectorAll('[data-asplan]'), function (b) {
      b.addEventListener('click', function () { var v = b.getAttribute('data-asplan'); lsSet('gp_asplan', v || null); location.reload(); });
    });
  }
  // Cancelación con doble confirmación + código al email (fricción intencional y seguridad).
  function openCancelFlow() {
    var ov = document.createElement('div'); ov.className = 'gx-modal-ov'; ov.id = 'gx-cancel-ov';
    ov.innerHTML = '<div class="gx-modal">' +
      '<div class="gx-modal-h"><b>' + esc(t('cx_title')) + '</b><button class="gx-modal-x" data-cx-close>&times;</button></div>' +
      '<div class="gx-modal-b" id="gx-cx-body">' +
        '<p style="margin:0 0 14px;color:var(--gx-text2);font-size:14px;line-height:1.5">' + esc(t('cx_step1')) + '</p>' +
        '<div class="gx-modal-acts"><button class="gx-btn" data-cx-close>' + esc(t('cx_keep')) + '</button>' +
        '<button class="gx-btn gx-btn-danger" id="gx-cx-yes">' + esc(t('cx_yes')) + '</button></div>' +
      '</div></div>';
    document.body.appendChild(ov);
    var close = function () { ov.remove(); };
    [].forEach.call(ov.querySelectorAll('[data-cx-close]'), function (b) { b.addEventListener('click', close); });
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#gx-cx-yes').addEventListener('click', function () {
      var body = ov.querySelector('#gx-cx-body');
      body.innerHTML = '<div class="gx-empty" style="padding:20px">' + ic('loader-2') + '</div>';
      fetch('/api/me/cancel/request', { method: 'POST', headers: hdrs() }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res) {
        if (!res.ok) { body.innerHTML = '<p class="gx-neg" style="font-size:14px">' + esc((res.j && res.j.error) || t('cx_err')) + '</p><div class="gx-modal-acts"><button class="gx-btn" data-cx-close>' + esc(t('cx_close')) + '</button></div>'; body.querySelector('[data-cx-close]').addEventListener('click', close); return; }
        body.innerHTML = '<p style="margin:0 0 12px;color:var(--gx-text2);font-size:14px;line-height:1.5">' + esc(t('cx_step2')) + '</p>' +
          '<input class="gx-pf-in" id="gx-cx-code" inputmode="numeric" maxlength="6" placeholder="000000" style="text-align:center;letter-spacing:8px;font-size:20px">' +
          '<div class="gx-modal-acts" style="margin-top:14px"><button class="gx-btn" data-cx-close>' + esc(t('cx_keep')) + '</button>' +
          '<button class="gx-btn gx-btn-danger" id="gx-cx-confirm">' + esc(t('cx_confirm')) + '</button></div>' +
          '<div class="gx-mod-note" id="gx-cx-out" style="min-height:16px"></div>';
        body.querySelector('[data-cx-close]').addEventListener('click', close);
        body.querySelector('#gx-cx-confirm').addEventListener('click', function () {
          var code = (body.querySelector('#gx-cx-code').value || '').trim();
          var out = body.querySelector('#gx-cx-out');
          if (!/^\d{6}$/.test(code)) { out.className = 'gx-mod-note gx-neg'; out.textContent = t('cx_code_bad'); return; }
          out.className = 'gx-mod-note gx-dim'; out.textContent = '...';
          fetch('/api/me/cancel', { method: 'POST', headers: hdrs(), body: JSON.stringify({ code: code }) }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (res2) {
            if (!res2.ok) { out.className = 'gx-mod-note gx-neg'; out.textContent = (res2.j && res2.j.error) || t('cx_err'); return; }
            // Si el server ya canceló la membresía EN Whop por API (caso normal), el ciclo se cierra acá
            // mismo: nota limpia y cero menciones a Whop. El link de respaldo solo aparece si la API falló.
            var whopOk = !!(res2.j && res2.j.whop_cancelled);
            body.innerHTML = '<p style="font-size:15px;color:var(--gx-text)">' + ic('circle-check') + ' ' + esc(t('cx_done')) + '</p>' +
              '<p class="gx-mod-note gx-dim">' + esc(whopOk ? t('cx_done_clean') : t('cx_done_note')) + '</p>' +
              (whopOk ? '' : '<a class="gx-btn" href="https://whop.com/@me" target="_blank" rel="noopener">' + esc(t('cx_whop')) + '</a>');
            loadMe();
          });
        });
      });
    });
  }

  function renderSupport() {
    var mv = $('#gx-matchview'); if (!mv) return;
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:640px">' + viewHead(t('sup_title')) +
      '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body">' +
      '<p class="gx-mod-note gx-dim" style="margin-top:0">' + esc(t('sup_intro')) + '</p>' +
      '<label class="gx-label" style="display:block;margin:12px 0 6px">' + esc(t('sup_subject')) + '</label>' +
      '<input class="gx-pf-in" id="gx-sup-subject" maxlength="120">' +
      '<label class="gx-label" style="display:block;margin:14px 0 6px">' + esc(t('sup_msg')) + '</label>' +
      '<textarea class="gx-pf-in" id="gx-sup-msg" rows="6" maxlength="4000" placeholder="' + esc(t('sup_msg_ph')) + '"></textarea>' +
      '<button class="gx-btn" id="gx-sup-send" style="margin-top:14px">' + ic('send') + '<span>' + esc(t('sup_send')) + '</span></button>' +
      '<div class="gx-mod-note" id="gx-sup-out" style="min-height:18px"></div>' +
      '</div></div></div></div>';
    var btn = $('#gx-sup-send'), out = $('#gx-sup-out');
    btn.addEventListener('click', function () {
      var msg = ($('#gx-sup-msg').value || '').trim();
      if (msg.length < 5) { out.style.color = '#FFC15E'; out.textContent = t('sup_short'); return; }
      btn.disabled = true;
      fetch('/api/support', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify({ message: msg, subject: ($('#gx-sup-subject').value || '').trim() }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status }; }); })
        .then(function (res) {
          btn.disabled = false;
          if (res.ok) { out.style.color = 'var(--gx-accent)'; out.textContent = t('sup_sent'); $('#gx-sup-msg').value = ''; $('#gx-sup-subject').value = ''; }
          else { out.style.color = '#FF8080'; out.textContent = res.status === 429 ? t('sup_rate') : t('sup_err'); }
        })
        .catch(function () { btn.disabled = false; out.style.color = '#FF8080'; out.textContent = t('sup_err'); });
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
  // Partidos seleccionables para el cockpit: los canónicos con evals V2 (dashboard.upcoming, ricos) + los partidos
  // de las picks del día (sintéticos por team-ids; su GP viene de /api/h2h/deep). Distinct por par de equipos.
  function cockpitMatches() {
    var list = [], seen = {};
    ((S.dash && S.dash.upcoming) || []).forEach(function (u) {
      var h = u.header, hid = h.home.team_id, aid = h.away.team_id; if (!hid || !aid) return;
      seen[hid + '|' + aid] = 1;
      list.push({ key: 'ev:' + h.event_id, id: h.event_id, hid: hid, aid: aid, kickoff: h.kickoff_at, home: teamName(hid, h.home.name_fallback), away: teamName(aid, h.away.name_fallback), canonical: true });
    });
    ((S.dailyPicks) || []).forEach(function (p) {
      var hid = p.home_team_id, aid = p.away_team_id; if (!hid || !aid || seen[hid + '|' + aid]) return;
      seen[hid + '|' + aid] = 1;
      // Pick de CLUB (club_eid = 'cl-<liga>-<h>-<a>'): entrada de club (cockpitCompactClub + cockpit cl-),
      // NO la genérica del Mundial — el bug era mandarla por /api/h2h/deep con ids tm_ ("Cargando..." eterno,
      // header "Copa Mundial", cockpit completo vacío vía teams-tm_...).
      if (p.club_eid && /^cl-/.test(p.club_eid)) {
        var lgk = p.club_eid.slice(3).split('-')[0];
        var Lc = clubLeague(lgk);
        list.push({ key: 'cl:' + lgk + ':' + hid + '-' + aid, id: p.club_eid, hid: hid, aid: aid, kickoff: p.kickoff, home: teamName(hid, p.home), away: teamName(aid, p.away), canonical: false, club: true, league: lgk, leagueName: (Lc && Lc.name) || (p.competition_name || '') });
        return;
      }
      list.push({ key: 'tm:' + hid + '-' + aid, id: 'teams-' + hid + '-' + aid, hid: hid, aid: aid, kickoff: p.kickoff, home: teamName(hid, p.home), away: teamName(aid, p.away), canonical: false });
    });
    // FALLBACK calendario: partidos EN VIVO o de las próximas 48h aunque no haya picks (el cockpit vive siempre —
    // antes, sin picks visibles (p.ej. plan Free con delay, o día sin picks) el panel desaparecía entero).
    ((S.cal) || []).forEach(function (c) {
      if (!c.home || !c.away || seen[c.home + '|' + c.away]) return;
      var kt = c.datetime ? new Date(c.datetime).getTime() : 0;
      if (!(c.status === 'live' || (kt > Date.now() - 3 * 3600e3 && kt < Date.now() + 48 * 3600e3))) return;
      seen[c.home + '|' + c.away] = 1;
      list.push({ key: 'cal:' + c.id, id: 'teams-' + c.home + '-' + c.away, hid: c.home, aid: c.away, kickoff: c.datetime, home: teamName(c.home), away: teamName(c.away), canonical: false });
    });
    // CLUBES (shadow): en vivo + próximos <48h de todas las ligas — mismo selector, cockpit compacto de club
    if (clubsOn()) {
      (((S.clubs || {}).leagues) || []).forEach(function (L) {
        (L.upcoming || []).concat(L.live || []).forEach(function (f) {
          if (!f.home || !f.away || seen[f.home.id + '|' + f.away.id]) return;
          var isLive = f.result && f.result.status === 'live';
          var kt = f.utc ? new Date(f.utc).getTime() : 0;
          if (!(isLive || (kt > Date.now() && kt < Date.now() + 48 * 3600e3))) return;
          seen[f.home.id + '|' + f.away.id] = 1;
          list.push({ key: 'cl:' + L.key + ':' + f.home.id + '-' + f.away.id, id: 'cl-' + L.key + '-' + f.home.id + '-' + f.away.id, hid: f.home.id, aid: f.away.id, kickoff: f.utc, home: f.home.name, away: f.away.name, canonical: false, club: true, league: L.key, leagueName: L.name });
        });
      });
    }
    list.sort(function (a, b) { return new Date(a.kickoff || 0) - new Date(b.kickoff || 0); });
    return list;
  }
  // Re-render del cockpit desde el estado actual (usado cuando llegan picks/h2h async estando en el board).
  function refreshCockpit() {
    if (S.view !== 'board') return;
    var rs = (S.dash && S.dash.upcoming || []).map(function (u) { return eventRow(u, gExpandValue(S.value)); });
    cockpit(rs);
  }
  function cockpit(rows) {
    var el = $('#gx-cockpit'); if (!el) return;
    var main = el.closest('.gx-main');
    var matches = cockpitMatches();
    // Sin ningún partido (ni canónico ni de picks) → ocultar el cockpit y usar todo el ancho (sin panel muerto).
    if (!matches.length) { el.style.display = 'none'; el.innerHTML = ''; if (main) main.classList.add('gx-solo'); return; }
    el.style.display = ''; if (main) main.classList.remove('gx-solo');
    // partido seleccionado (persistente por S.ckSel; default = el seleccionado del board o el primero)
    var sel = matches.filter(function (m) { return m.key === S.ckSel; })[0];
    if (!sel) { sel = matches.filter(function (m) { return m.id === S.sel; })[0] || matches[0]; S.ckSel = sel.key; }
    var selectorHtml = '<div class="gx-ck-picker"><span class="gx-label">' + esc(t('ck_choose')) + '</span>' +
      '<div class="gx-ck-selwrap">' + ic('device-desktop-analytics') + '<select class="gx-ck-select" id="gx-ck-select">' +
      matches.map(function (m) { return '<option value="' + esc(m.key) + '"' + (m.key === S.ckSel ? ' selected' : '') + '>' + esc(m.home + ' ' + t('vs') + ' ' + m.away) + '</option>'; }).join('') +
      '</select>' + ic('chevron-down') + '</div></div>';
    var body, canonRow = sel.canonical ? rows.filter(function (x) { return x.h.event_id === sel.id; })[0] : null;
    if (canonRow) body = cockpitRich(canonRow);
    else if (sel.club) body = cockpitCompactClub(sel);
    else body = cockpitCompact(sel);
    el.innerHTML = selectorHtml + body;
    var s = $('#gx-ck-select'); if (s) s.addEventListener('change', function () { S.ckSel = s.value; refreshCockpit(); var ck = $('#gx-cockpit'); if (window.innerWidth <= 1180 && ck) ck.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    // enriquecimiento del canónico (tesis/riesgo reales) — una vez por evento
    if (canonRow && canonRow.h.event_id && !S.mc[canonRow.h.event_id]) {
      fetch('/api/beta/match/' + encodeURIComponent(canonRow.h.event_id), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.mc[canonRow.h.event_id] = m || { _empty: true }; refreshCockpit(); });
    }
  }
  // Cockpit COMPACTO para un partido de picks (sintético): GP 1X2 (h2h/deep) + proyección de goles + pick(s) del día
  // + botón al análisis completo. La persona lo elige en el selector y aparece acá.
  function cockpitCompact(m) {
    var hk = m.hid + '_' + m.aid;
    if (S.h2h[hk] === undefined) {
      S.h2h[hk] = null;
      fetch('/api/h2h/deep?a=' + encodeURIComponent(m.hid) + '&b=' + encodeURIComponent(m.aid) + asplanQS('&'), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (j) { S.h2h[hk] = j || { _empty: true }; if (S.ckSel === m.key) refreshCockpit(); });
    }
    var h2h = (S.h2h[hk] && !S.h2h[hk]._empty) ? S.h2h[hk] : null;
    var probs = h2h && h2h.probs ? h2h.probs : null;
    var gpH = probs ? probs.aWin : null, gpD = probs ? probs.draw : null, gpA = probs ? probs.bWin : null;
    var gi = h2h && h2h.goal_insights, ou = gi && gi.over_under && gi.over_under['2.5'];
    var xg = gi && gi.expected_goals ? gi.expected_goals : null;
    var mPicks = (S.dailyPicks || []).filter(function (p) { return p.home_team_id === m.hid && p.away_team_id === m.aid; });
    var probBlock = probs
      ? '<div class="gx-pbar"><i class="h" style="width:' + (gpH * 100) + '%"></i><i class="d" style="width:' + (gpD * 100) + '%"></i><i class="a" style="width:' + (gpA * 100) + '%"></i></div>' +
        '<div class="gx-plabels"><span>' + esc(m.home) + ' <b>' + pct0(gpH) + '</b></span><span>X <b>' + pct0(gpD) + '</b></span><span>' + esc(m.away) + ' <b>' + pct0(gpA) + '</b></span></div>'
      : '<div class="gx-empty" style="padding:14px 0">' + ic('loader-2') + esc(t('loading')) + '</div>';
    var stats = '<div class="gx-ck-stats">' +
      ckStat(t('prob_gp'), probs ? pct0(Math.max(gpH, gpA)) : '—') +
      ckStat('xG', xg && xg.TOTAL != null ? Number(xg.TOTAL).toFixed(1) : '—') +
      ckStat(t('ck_over25'), ou && ou.over != null ? pct0(ou.over) : '—') +
      '</div>';
    var picksHtml = mPicks.length ? '<div class="gx-ck-picks"><span class="gx-label">' + esc(t('ck_todaypick')) + '</span>' +
      mPicks.map(function (p) { return '<div class="gx-ck-pickrow"><span class="gx-ck-picksel">' + esc(pickRecText(p)) + '</span>' + (p.odds != null ? '<span class="gx-ck-pickodds gx-mono">' + Number(p.odds).toFixed(2) + '</span>' : '') + '</div>'; }).join('') + '</div>' : '';
    // ronda REAL del partido desde el calendario (antes estaba fija en R16 → mostraba "Octavos" en cuartos/semis)
    var calM = (S.cal || []).filter(function (c) { return (c.home === m.hid && c.away === m.aid) || (c.home === m.aid && c.away === m.hid); })[0];
    var stg = calM ? stageLabel(calM.stage === 'group' ? 'GROUP' : calM.stage) : '';
    return '<div class="gx-panel gx-ck-score">' +
      '<div class="gx-ck-comp" style="text-align:center;margin-bottom:10px">' + esc((stg || t('comp'))) + (m.kickoff ? ' · ' + esc(fmtDateTime(m.kickoff)) : '') + '</div>' +
      '<div class="gx-ck-teams"><div class="gx-ck-side"><span class="fl">' + flag(m.hid) + '</span><b>' + esc(m.home) + '</b></div>' +
      '<div class="gx-ck-mid"><div class="gx-ck-num">' + t('vs') + '</div></div>' +
      '<div class="gx-ck-side"><span class="fl">' + flag(m.aid) + '</span><b>' + esc(m.away) + '</b></div></div>' +
      probBlock + stats + picksHtml +
      '<button class="gx-btn" style="width:100%;justify-content:center;margin-top:14px" data-openmatch="' + esc(m.id) + '">' + esc(t('open_cockpit')) + ' ' + ic('arrow-right') + '</button>' +
      '</div>';
  }
  // Cockpit COMPACTO para un partido de CLUB (shadow): mismo layout que cockpitCompact, data de /api/clubs/match
  // (cache S.clm compartido con el cockpit completo). flag() ya resuelve escudos tm_.
  function cockpitCompactClub(m) {
    S.clm = S.clm || {};
    if (S.clm[m.id] === undefined) {
      S.clm[m.id] = null;
      fetch('/api/clubs/match?hl=' + encodeURIComponent(m.league) + '&h=' + encodeURIComponent(m.hid) + '&al=' + encodeURIComponent(m.league) + '&a=' + encodeURIComponent(m.aid) + '&hn=' + encodeURIComponent(m.home) + '&an=' + encodeURIComponent(m.away), { headers: hdrs() })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { S.clm[m.id] = j || { _empty: true }; if (S.ckSel === m.key) refreshCockpit(); });
    }
    var cm = (S.clm[m.id] && !S.clm[m.id]._empty) ? S.clm[m.id] : null;
    var probs = cm && cm.probs ? cm.probs : null;
    var gpH = probs ? probs.home : null, gpD = probs ? probs.draw : null, gpA = probs ? probs.away : null;
    var probBlock = probs
      ? '<div class="gx-pbar"><i class="h" style="width:' + (gpH * 100) + '%"></i><i class="d" style="width:' + (gpD * 100) + '%"></i><i class="a" style="width:' + (gpA * 100) + '%"></i></div>' +
        '<div class="gx-plabels"><span>' + esc(m.home) + ' <b>' + pct0(gpH) + '</b></span><span>X <b>' + pct0(gpD) + '</b></span><span>' + esc(m.away) + ' <b>' + pct0(gpA) + '</b></span></div>'
      : '<div class="gx-empty" style="padding:14px 0">' + ic('loader-2') + esc(t('loading')) + '</div>';
    var stats = '<div class="gx-ck-stats">' +
      ckStat(t('prob_gp'), probs ? pct0(Math.max(gpH, gpA)) : '—') +
      ckStat('xG', cm && cm.xg && cm.xg.total != null ? Number(cm.xg.total).toFixed(1) : '—') +
      ckStat(t('ck_over25'), cm && cm.over25 != null ? pct0(cm.over25) : '—') +
      '</div>';
    return '<div class="gx-panel gx-ck-score">' +
      '<div class="gx-ck-comp" style="text-align:center;margin-bottom:10px">' + esc((m.leagueName || '').split(' · ')[0]) + (m.kickoff ? ' · ' + esc(fmtDateTime(m.kickoff)) : '') + '</div>' +
      '<div class="gx-ck-teams"><div class="gx-ck-side"><span class="fl">' + flag(m.hid) + '</span><b>' + esc(m.home) + '</b></div>' +
      '<div class="gx-ck-mid"><div class="gx-ck-num">' + t('vs') + '</div></div>' +
      '<div class="gx-ck-side"><span class="fl">' + flag(m.aid) + '</span><b>' + esc(m.away) + '</b></div></div>' +
      probBlock + stats +
      '<button class="gx-btn" style="width:100%;justify-content:center;margin-top:14px" data-openmatch="' + esc(m.id) + '">' + esc(t('open_cockpit')) + ' ' + ic('arrow-right') + '</button>' +
      '</div>';
  }
  // Cockpit RICO para un partido canónico (con evals V2): el análisis completo con memo/trust.
  function cockpitRich(r) {
    var h = r.h, gpH = r.gp('HOME') || 0, gpD = r.gp('DRAW') || 0, gpA = r.gp('AWAY') || 0;
    var memo = buildMemo(r);
    var conf = memo.conf;
    return '<div class="gx-panel gx-ck-score">' +
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
      '<div class="gx-memo-cta"><span class="gx-bestprice">' + esc(t('best_avail')) + ' <b>' + (memo.bestOdds != null ? odd(memo.bestOdds) : esc(t('e_noprice'))) + '</b>' + (memo.book ? ' · ' + bookLogo(memo.bookCode) + esc(memo.book) : '') + '</span>' +
      '<button class="gx-btn" data-openmatch="' + esc(h.event_id) + '">' + esc(t('open_cockpit')) + ' ' + ic('arrow-right') + '</button></div>' +
      '</div>';
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
    return { code: null, cls: 'mid', label: t('conf_na') };
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
    var price = belowMin ? ('<b>' + odd(best.best_odds) + '</b> · ' + esc(t('below_min'))) : (best && best.best_odds ? t('memo_price', { odds: '<b>' + odd(best.minimum_odds || best.best_odds) + '</b>', book: best.best_sportsbook ? " (" + bookLogo(best.best_sportsbook) + esc(prettyBook(best.best_sportsbook)) + ")" : "" }) : t('memo_price_none'));
    var riskCode = (ma && ma.risks && ma.risks[0]) || (best && best.risk_codes && best.risk_codes[0]);
    var risk = riskCode ? riskText(riskCode) : t('memo_risk_default');
    var inval = t('memo_inval');
    var edge = best ? best.adjusted_edge_pp : null;
    var conf = confInfo(ma && ma.confidence_code);  // A.1: un SOLO valor canónico del DTO controla el badge
    var cta = pubPick ? t('cta_pick') : actionable ? t('cta_value') : best ? t('cta_analysis') : t('cta_analyze');
    return { verdict: verdict, thesis: thesis, price: price, risk: risk, inval: inval, conf: conf, bestOdds: best ? best.best_odds : null, book: best ? prettyBook(best.best_sportsbook) : "", bookCode: best ? best.best_sportsbook : null, cta: cta, ma: ma };
  }
  // copy de riesgo: enuncia el HECHO; NUNCA afirma un nivel de confianza (eso lo controla SOLO el badge, A.1)
  var RISK = { es: { MODEL_DISAGREEMENT: 'Las estimaciones internas no convergen del todo.', LARGE_MARKET_DISAGREEMENT: 'GP y el mercado difieren mucho: mayor potencial pero también mayor riesgo.', MODEL_UNCERTAINTY: 'La incertidumbre de la estimación es elevada para este partido.', LINEUP_NOT_CONFIRMED: 'Las alineaciones aún no están confirmadas.', CONTEXT_INCOMPLETE: 'El contexto disponible es incompleto para este partido.', EARLY_TRACK_RECORD: 'El registro verificable todavía es corto.', LOWER_QUALITY_TIMESTAMP: 'Los datos tienen menor frescura.' }, en: { MODEL_DISAGREEMENT: 'Internal estimates don’t fully converge.', LARGE_MARKET_DISAGREEMENT: 'GP and the market differ widely: higher upside but also higher risk.', MODEL_UNCERTAINTY: 'Estimate uncertainty is elevated for this match.', LINEUP_NOT_CONFIRMED: 'Lineups are not yet confirmed.', CONTEXT_INCOMPLETE: 'The available context is incomplete for this match.', EARLY_TRACK_RECORD: 'The verifiable track record is still short.', LOWER_QUALITY_TIMESTAMP: 'Data has lower freshness.' } };
  function riskText(c) { return (RISK[LANG] && RISK[LANG][c]) || (RISK.es[c]) || c; }

  // ================= deep match cockpit (Corte 2) =================
  function setHash(h) { try { if ((location.hash || '').replace(/^#/, '') !== h) location.hash = h; } catch (e) {} }
  // PROFUNDIDAD DE NAVEGACIÓN in-app: se lleva con un serial en history.state (asignado en onHash, que corre en
  // TODA navegación). Direccional-independiente (no depende de popstate — que en este entorno dispara también al
  // avanzar). curSerial = posición actual; el primer view in-app = 1. Así el botón "atrás" usa history.back() y
  // vuelve EXACTAMENTE a donde estabas, con cualquier origen y cualquier cadena detalle→detalle
  // (cockpit→jugador→atrás→cockpit), en vez del returnTo de un solo slot que saltaba a una pestaña alterna.
  function trackDepth() {
    var st = null; try { st = history.state; } catch (e) {}
    if (st && typeof st.gpS === 'number') { S._curSerial = st.gpS; }
    else { S._curSerial = (S._maxSerial = (S._maxSerial || 0) + 1); try { history.replaceState({ gpS: S._curSerial }, ''); } catch (e) {} }
  }
  // Home de respaldo SOLO cuando no hay historial in-app (entraste por URL directa/recarga a un detalle).
  function homeFallback() {
    var v = S.view;
    if (v === 'match') return /^cl-/.test(S.matchId || '') ? 'matches' : '';
    if (v === 'cteam' || v === 'team') return 'teams';
    if (v === 'cbfight') return 'cbfights';
    if (v === 'cbfighter') return 'cbfighters';
    return '';
  }
  function goBack() { if ((S._curSerial || 1) > 1) { try { history.back(); return; } catch (e) {} } setHash(homeFallback()); }
  function onHash() {
    trackDepth();
    var h = ''; try { h = (location.hash || '').replace(/^#/, ''); } catch (e) {}
    var m = h.match(/^match\/([0-9a-f-]{36}|qa-[a-z0-9-]+|fx-[A-Za-z0-9]+|teams-[A-Za-z0-9]{2,5}-[A-Za-z0-9]{2,5}|cl-[a-z0-9]+-[A-Za-z0-9_]+-[A-Za-z0-9_]+)$/i);
    if (m) { if (!(S.view === 'match' && S.matchId === m[1])) openMatch(m[1], true); return; }
    var tm = h.match(/^team\/([A-Za-z]{2,4})$/i);
    if (tm) { var tid = tm[1].toUpperCase(); if (!(S.view === 'team' && S.teamId === tid)) openTeam(tid, true); return; }
    // FASE CLUBES: perfil de club (cteam/<liga>-<tm_id>)
    var ctm = h.match(/^cteam\/([a-z0-9]+)-(tm_[A-Za-z0-9]+)$/i);
    if (ctm) { if (!(S.view === 'cteam' && S.cteamId === ctm[2] && S.cteamLg === ctm[1])) openClubTeam(ctm[1], ctm[2], true); return; }
    // FASE CLUBES: perfil de jugador de club (cplayer/<liga>-<tm_id>-<pl_id>)
    var cpl = h.match(/^cplayer\/([a-z0-9]+)-(tm_[A-Za-z0-9]+)-(pl_[A-Za-z0-9]+)$/i);
    if (cpl) { if (!(S.view === 'cplayer' && S.cplPid === cpl[3])) openClubPlayer(cpl[1], cpl[2], cpl[3], true); return; }
    var pm = h.match(/^player\/(pl_[A-Za-z0-9]+)$/i);
    if (pm) { if (!(S.view === 'player' && S.playerId === pm[1])) openPlayer(pm[1], true); return; }
    // ── COMBATE (R2): rutas del deporte — detalle de pelea y de peleador + vistas de sección
    if (h === 'combat') { setHash('cbfights'); return; } // compat con el hash viejo de la vista única
    var cbf = h.match(/^cbfight\/([a-z]+)-(\d+)$/i);
    if (cbf) { S.cb.org = cbf[1]; if (!(S.view === 'cbfight' && S.cb.fightId === cbf[2])) { S.cb.fightId = cbf[2]; S.cb.fight = undefined; showView('cbfight'); } return; }
    var cbp = h.match(/^cbfighter\/([a-z]+)-(\d+)$/i);
    if (cbp) { S.cb.org = cbp[1]; if (!(S.view === 'cbfighter' && S.cb.fighterId === cbp[2])) { S.cb.fighterId = cbp[2]; S.cb.fighter = undefined; showView('cbfighter'); } return; }
    var cbv = h.match(/^(cbbrief|cbcard|cbask|cbfights|cbfighters|cbsim|cbfollow|cbperf|cborgs|cbevo|cb)(?:\/([a-z0-9_]+))?$/); // 'cb' AL FINAL: si va primero se come el prefijo de los demás
    if (cbv) {
      if (cbv[2] === 'ufc' || cbv[2] === 'mma') S.cb.org = cbv[2]; // el sufijo de org vale en TODAS las vistas
      showView(cbv[1] === 'cb' ? 'cbopps' : cbv[1]); return;
    }
    // sub-estado del selector de competición en el hash (#groups/mls, #bracket/mls, #matches/mls, #teams/mls) →
    // la selección SOBREVIVE a la recarga y al enlace directo (P0.4). Sin sufijo = default de la vista.
    var v = h.match(/^(matches|teams|sim|groups|bracket|evo|registry|method|admin|follow|alerts|refer|perf|calc|support|sub|bets|books|brief|combat)(?:\/([a-z0-9_]+))?/);
    if (v) {
      var sub = v[2] || null;
      if (v[1] === 'groups') S.gComp = sub || 'wc';
      else if (v[1] === 'bracket') S.bComp = sub || 'wc';
      else if (v[1] === 'teams') S.tComp = sub || 'wc';
      else if (v[1] === 'evo') S.eComp = sub || 'wc';
      else if (v[1] === 'matches') S.mComp = sub || (clubsOn() ? 'todos' : null);
      showView(v[1]); return;
    }
    showView('board');
  }
  var NAV_HASH = { opps: '', matches: 'matches', teams: 'teams', sim: 'sim', groups: 'groups', bracket: 'bracket', evo: 'evo', registry: 'registry', method: 'method', admin: 'admin', follow: 'follow', alerts: 'alerts', refer: 'refer', perf: 'perf', calc: 'calc', sub: 'sub', support: 'support', bets: 'bets', books: 'books', brief: 'brief', combat: 'cbfights', cbopps: 'cb', cbbrief: 'cbbrief', cbcard: 'cbcard', cbask: 'cbask', cbfights: 'cbfights', cbfighters: 'cbfighters', cbsim: 'cbsim', cbfollow: 'cbfollow', cbperf: 'cbperf', cborgs: 'cborgs', cbevo: 'cbevo' };
  // el nav preserva la competición elegida (memoria) al volver a la sección — reload la reconstruye del hash.
  function compHash(nav) {
    if (!clubsOn()) return NAV_HASH[nav];
    if (nav === 'groups' && S.gComp && S.gComp !== 'wc') return 'groups/' + S.gComp;
    if (nav === 'bracket' && S.bComp && S.bComp !== 'wc') return 'bracket/' + S.bComp;
    if (nav === 'teams' && S.tComp && S.tComp !== 'wc') return 'teams/' + S.tComp;
    if (nav === 'evo' && S.eComp && S.eComp !== 'wc') return 'evo/' + S.eComp;
    if (nav === 'matches' && S.mComp && S.mComp !== 'todos') return 'matches/' + S.mComp;
    return NAV_HASH[nav];
  }
  function navTo(nav) { var hh = compHash(nav); setHash(hh != null ? hh : ''); }
  // helper para los selectores: cambiar la competición actualiza el hash (setHash → onHash re-renderiza).
  function setCompHash(view, val, def) { setHash((!val || val === def) ? view : view + '/' + val); }
  function openTeam(id, fromHash) { if (!id) return; if (!fromHash) { S.returnTo = (S.view === 'teams' ? 'teams' : ''); setHash('team/' + id); } S.view = 'team'; S.teamId = id; S.teamTab = 'resumen'; applyView(); syncNavActive(); try { window.scrollTo(0, 0); } catch (e) {} renderTeam(); }
  // ── PERFIL DE JUGADOR (capa de inteligencia por jugador, admin-first) ─────────────────────────────────
  function openPlayer(pid, fromHash) { if (!pid) return; if (!fromHash) setHash('player/' + pid); S.view = 'player'; S.playerId = pid; applyView(); syncNavActive(); try { window.scrollTo(0, 0); } catch (e) {} renderPlayer(); }
  // Radar SVG del jugador (misma matemática que el server para las páginas públicas; tema de la plataforma).
  function gxRadar(axes) {
    var n = (axes || []).length; if (n < 3) return '';
    var size = 320, pad = 62, cx = size / 2, cy = size / 2, R = size / 2 - pad, rings = 4;
    var ang = function (i) { return -Math.PI / 2 + (2 * Math.PI * i) / n; };
    var pol = function (r, a) { return [(cx + r * Math.cos(a)).toFixed(1), (cy + r * Math.sin(a)).toFixed(1)]; };
    var out = '<svg viewBox="0 0 ' + size + ' ' + size + '" class="gx-radar" role="img">';
    for (var r = 1; r <= rings; r++) {
      out += '<polygon points="' + axes.map(function (_, i) { return pol((R * r) / rings, ang(i)).join(','); }).join(' ') + '" fill="none" stroke="var(--gx-line)" stroke-width="1"/>';
    }
    for (var i = 0; i < n; i++) { var e = pol(R, ang(i)); out += '<line x1="' + cx + '" y1="' + cy + '" x2="' + e[0] + '" y2="' + e[1] + '" stroke="var(--gx-line)" stroke-width="1"/>'; }
    var pts = axes.map(function (a, i) { return pol(R * Math.max(0.06, Math.min(1, a.pct || 0)), ang(i)).join(','); }).join(' ');
    out += '<polygon points="' + pts + '" fill="rgba(43,227,166,.2)" stroke="var(--gx-pos)" stroke-width="2" stroke-linejoin="round"/>';
    for (var j = 0; j < n; j++) {
      var d = pol(R * Math.max(0.06, Math.min(1, axes[j].pct || 0)), ang(j));
      out += '<circle cx="' + d[0] + '" cy="' + d[1] + '" r="3" fill="var(--gx-pos)"/>';
      var a2 = ang(j), lp = pol(R + 17, a2);
      var anchor = Math.abs(Math.cos(a2)) < 0.35 ? 'middle' : Math.cos(a2) > 0 ? 'start' : 'end';
      var dy = Math.sin(a2) > 0.6 ? 8 : Math.sin(a2) < -0.6 ? -2 : 4;
      var lk = 'ax_' + axes[j].key, lbl = t(lk); if (lbl === lk) lbl = axes[j].key;
      out += '<text x="' + lp[0] + '" y="' + (parseFloat(lp[1]) + dy).toFixed(1) + '" text-anchor="' + anchor + '" font-size="10.5" font-weight="600" fill="var(--gx-text3)">' + esc(lbl) + '</text>';
    }
    return out + '</svg>';
  }
  function archBadge(code) {
    if (!code) return '';
    var k = 'arch_' + String(code).toLowerCase(), s = t(k);
    return s === k ? '' : '<span class="gx-badge gx-arch">★ ' + esc(s) + '</span>';
  }

  function renderPlayer() {
    var mv = $('#gx-matchview'); if (!mv) return;
    var pid = S.playerId;
    // Perfil de jugador (radar de scouting + proyecciones) = plan Pro+. Free → candado con "Ver planes".
    if (uiPlan() === 'free') { mv.innerHTML = mvShell(lockPanelPro('lock_player_s')); bindBack(); return; }
    mv.innerHTML = mvShell(mvLoading()); bindBack();
    fetch('/api/beta/player?pid=' + encodeURIComponent(pid), { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
      if (S.view !== 'player' || S.playerId !== pid) return;
      if (!d || !d.available) { mv.innerHTML = mvShell('<div class="gx-panel"><div class="gx-empty">' + esc(t('pp_empty')) + '</div></div>'); bindBack(); return; }
      var pr = d.profile, sm = d.sample || {}, rt = d.rates90 || {}, it = d.intel || null;
      var photo = pr.photo ? '<img src="' + esc(pr.photo) + '" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--gx-line)" onerror="this.style.display=\'none\'">' : '';
      var confKey = it && it.confidence === 'HIGH' ? 'pp_conf_high' : it && it.confidence === 'MEDIUM' ? 'pp_conf_med' : 'pp_conf_low';
      var head = '<div class="gx-panel"><div class="gx-mod-body" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">' + photo +
        '<div style="min-width:0"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:18px">' + esc(pr.name) + '</b><span class="gx-badge">' + esc(pr.pos || '') + '</span>' + archBadge(d.scout && d.scout.archetype) + (it ? '<span class="gx-badge">' + esc(t(confKey)) + '</span>' : '') + '</div>' +
        '<div class="gx-dim" style="display:flex;align-items:center;gap:6px;margin-top:4px">' + flag(pr.team) + ' ' + esc(teamName(pr.team)) + '</div></div></div></div>';
      var reasons = it && it.reasons && it.reasons.length
        ? '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('pp_reading')) + '</span></div><div class="gx-mod-body" style="display:flex;gap:6px;flex-wrap:wrap">' +
          it.reasons.map(function (c) { var k = 'pi_' + String(c).toLowerCase(); var s = t(k); return s === k ? '' : '<span class="gx-badge">' + esc(s) + '</span>'; }).join('') + '</div></div>' : '';
      // Hallazgo del observer narrado (por qué está en duda/baja): el "recuadro" en el perfil del jugador.
      var an = d.availability_narrative;
      var finding = an && (LANG === 'en' ? an.en : an.es)
        ? '<div class="gx-panel"><div class="gx-findings" style="margin:0"><div class="gx-findings-h">' + ic('bulb') + '<span>' + esc(t('pp_finding')) + '</span></div><div class="gx-finding"><span class="gx-finding-dot gx-fd-' + (d.availability && (d.availability.status === 'OUT' || d.availability.status === 'SUSPENDED') ? 'out' : 'doubt') + '"></span><span class="gx-finding-tx">' + esc(LANG === 'en' ? an.en : an.es) + '</span></div></div></div>' : '';
      var stat = function (l, v) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(l) + '</span><b class="gx-mono">' + v + '</b></div>'; };
      var pcs = d.percentiles || {};
      var pctlChip = function (v) { if (v == null || v < 60) return ''; return '<span class="gx-badge" style="font-size:9px">' + esc(t('pp_pctl', { p: Math.max(1, 100 - v) })) + '</span>'; };
      var nums = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('pp_sample')) + '</span>' + (d.attack_share_pct != null ? '<span class="gx-badge">' + esc(t('pp_share', { pct: d.attack_share_pct })) + '</span>' : '') + '</div><div class="gx-mod-body" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">' +
        stat(t('pp_min'), sm.minutes || 0) + stat(t('pp_apps'), (sm.starts || 0) + '/' + (sm.apps || 0)) + stat(t('pp_goals'), (sm.goals || 0) + (sm.assists ? ' +' + sm.assists + 'A' : '')) + stat(t('pp_expmin'), sm.exp_minutes_start || '—') + '</div>' +
        '<div class="gx-ph"><span class="gx-label">' + esc(t('pp_per90')) + '</span></div><div class="gx-mod-body" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">' +
        '<div class="gx-hero-mini"><span class="gx-label">xG/90</span><b class="gx-mono">' + (rt.xg != null ? rt.xg : '—') + '</b>' + pctlChip(pcs.xg90) + '</div>' +
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('pp_shots')) + '/90</span><b class="gx-mono">' + (rt.shots != null ? rt.shots : '—') + '</b>' + pctlChip(pcs.shots90) + '</div>' +
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('pp_sot')) + '/90</span><b class="gx-mono">' + (rt.sot != null ? rt.sot : '—') + '</b>' + pctlChip(pcs.sot90) + '</div>' +
        '<div class="gx-hero-mini"><span class="gx-label">xA/90</span><b class="gx-mono">' + (rt.xa != null ? rt.xa : '—') + '</b></div>' + '</div></div>';
      // MERCADOS DEL JUGADOOR: qué cotizan las casas para él vs lo que dice nuestro modelo
      var mkts = '';
      if (d.markets && d.markets.length) {
        var famLbl = function (m) { return m.family === 'player_goal' ? t('pp_mk_goal') : (m.family === 'player_shots' ? t('pp_shots') : t('pp_sot')) + ' o' + m.line; };
        var mrows = d.markets.map(function (m) {
          var be = m.best_odds > 1 ? 1 / m.best_odds : null;
          return '<div class="gx-intel-row" style="grid-template-columns:minmax(0,1fr) 56px 52px 56px"><span class="n">' + esc(famLbl(m)) + ' <i class="gx-dim" style="font-size:10px">' + m.books + ' ' + esc(t('pp_books')) + '</i></span>' +
            '<span class="v gx-mono">@' + Number(m.best_odds).toFixed(2) + '</span><span class="v gx-mono gx-dim">' + (be != null ? pct0(be) : '—') + '</span><span class="v gx-mono' + (m.model_prob != null && be != null && m.model_prob > be ? ' gx-pos' : '') + '">' + (m.model_prob != null ? pct0(m.model_prob) : '—') + '</span></div>';
        }).join('');
        var mhead = '<div class="gx-intel-row gx-intel-head" style="grid-template-columns:minmax(0,1fr) 56px 52px 56px"><span class="n gx-label">' + esc(t('pp_market')) + '</span><span class="v gx-label">' + esc(t('pp_best')) + '</span><span class="v gx-label">' + esc(t('pp_implied')) + '</span><span class="v gx-label">GP</span></div>';
        mkts = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('pp_markets')) + '</span></div><div class="gx-mod-body">' + mhead + mrows + '</div></div>';
      }
      // H2H contra el próximo rival (partidos previos del torneo)
      var h2h = '';
      if (d.h2h_vs_next && d.h2h_vs_next.length && d.next_match) {
        var rivalId = d.h2h_vs_next[0].opponent;
        var hr = d.h2h_vs_next.map(function (f) {
          return '<div class="gx-intel-row" style="grid-template-columns:minmax(0,1fr) 40px 40px 40px 40px"><span class="n gx-dim">' + esc(fmtDate(f.date)) + (f.started ? '' : ' <i style="font-size:10px">SUP</i>') + '</span>' +
            '<span class="v gx-mono">' + f.min + "'" + '</span><span class="v gx-mono">' + f.shots + '</span><span class="v gx-mono">' + f.sot + '</span><span class="v gx-mono' + (f.goals > 0 ? ' gx-pos' : '') + '">' + f.goals + '</span></div>';
        }).join('');
        h2h = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('pp_h2h')) + '</span><span class="gx-dim" style="font-size:11px;display:inline-flex;align-items:center;gap:5px">' + flag(rivalId) + esc(teamName(rivalId)) + '</span></div><div class="gx-mod-body">' + hr + '</div></div>';
      }
      var proj = '';
      if (it && it.projection && d.next_match) {
        var pj = it.projection;
        proj = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('pp_next')) + '</span><span class="gx-dim" style="font-size:11px">' + esc(teamName(d.next_match.home)) + ' vs ' + esc(teamName(d.next_match.away)) + '</span></div>' +
          '<div class="gx-mod-body" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' +
          stat(t('pp_pgoal'), pct0(pj.anytime_goal)) + stat(t('pp_proj_shots'), (pj.shots_match || 0).toFixed(1)) + stat(t('pp_proj_min'), Math.round(pj.minutes || 0) + "'") + '</div></div>';
      }
      var formRows = (d.form || []).map(function (f) {
        return '<div class="gx-intel-row" style="grid-template-columns:minmax(0,1fr) 40px 40px 40px 40px"><span class="n">' + flag(f.opponent) + ' ' + esc(teamName(f.opponent)) + (f.started ? '' : ' <i class="gx-dim" style="font-size:10px">SUP</i>') + '</span>' +
          '<span class="v gx-mono">' + f.min + "'" + '</span><span class="v gx-mono">' + f.shots + '</span><span class="v gx-mono">' + f.sot + '</span><span class="v gx-mono' + (f.goals > 0 ? ' gx-pos' : '') + '">' + f.goals + '</span></div>';
      }).join('');
      var formHead = '<div class="gx-intel-row gx-intel-head" style="grid-template-columns:minmax(0,1fr) 40px 40px 40px 40px"><span class="n gx-label">' + esc(t('pp_rival')) + '</span><span class="v gx-label">MIN</span><span class="v gx-label">' + esc(t('pp_shots_h')) + '</span><span class="v gx-label">' + esc(t('pp_sot_h')) + '</span><span class="v gx-label">' + esc(t('pp_goals_h')) + '</span></div>';
      var form = formRows ? '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('pp_form')) + '</span></div><div class="gx-mod-body">' + formHead + formRows + '</div></div>' : '';
      // SCOUT CARD: radar vs su posición + lectura de scouting (fortalezas/límite)
      var scoutBlock = '';
      if (d.scout && d.scout.axes && d.scout.axes.length >= 3) {
        var rd = d.scout.read || { strengths: [], limit: null };
        var sLis = (rd.strengths || []).map(function (s) { return '<li>' + esc(LANG === 'en' ? s.en : s.es) + '</li>'; }).join('');
        var lLi = rd.limit ? '<li class="gx-scout-lim">' + esc(LANG === 'en' ? rd.limit.en : rd.limit.es) + '</li>' : '';
        scoutBlock = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + ic('chart-line') + esc(t('pp_radar')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:11px">' + esc(t('pp_radar_sub')) + '</span></div>' +
          '<div class="gx-mod-body"><div class="gx-radar-wrap">' + gxRadar(d.scout.axes) + '</div>' +
          (sLis || lLi ? '<ul class="gx-scout-read">' + sLis + lLi + '</ul>' : '') + '</div></div>';
      }
      mv.innerHTML = mvShell(head + finding + scoutBlock + reasons + proj + minutesDistPanel(d.minutes_dist) + mkts + h2h + nums + form);
      bindBack();
    });
  }
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
    // R2: sportbar — el deporte activo sigue a la vista
    [].forEach.call(document.querySelectorAll('#gx-sportbar [data-sportgo]'), function (el) {
      el.classList.toggle('on', el.getAttribute('data-sportgo') === S.sport);
    });
  }
  // ── R2: cambio de DEPORTE — reconstruye el shell entero (sidebar+bnav) y navega al home del deporte.
  // Combate es admin-only hasta validar: para no-admins el botón es un teaser ("Próximamente"), no navega.
  function setSport(sport) {
    if (sport === 'combat' && !cbSportAllowed()) return;
    if (sport === S.sport) return;
    S.sport = sport;
    try { localStorage.setItem('gp_sport', sport); } catch (e) {}
    shell();
    navTo(sport === 'combat' ? (cbCanSee('cbopps') ? 'cbopps' : 'cbfights') : 'opps');
  }
  // si la vista pedida pertenece a otro deporte (hash directo/atrás), el shell se reconstruye para ese deporte
  function ensureSport(v) {
    var sp = sportOf(v);
    if (sp !== S.sport) { S.sport = sp; try { localStorage.setItem('gp_sport', sp); } catch (e) {} shell(); }
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
    // 'sub' y 'support' son admin-only HASTA el lanzamiento de pagos (sacarlos de esta lista al abrir).
    // R2: TODO Combate es admin-only hasta que el monitor valide (ni por hash directo).
    if (S.me && !S.me.isAdmin && (['registry', 'method', 'admin'].indexOf(v) >= 0 || (CB_VIEWS.indexOf(v) >= 0 && !cbCanSee(v)) || (v === 'sub' && !S.me.founder_public))) { v = 'board'; }
    ensureSport(v); // hash directo a otra sección de deporte → el shell se adapta
    var changed = S.view !== v;
    S.view = v; if (v !== 'match') S.matchId = null;
    applyView(); syncNavActive();
    if (changed) try { window.scrollTo(0, 0); } catch (e) {}
    if (CB_VIEWS.indexOf(v) >= 0) renderCb(v);
    else if (v === 'matches') renderMatches();
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
    else if (v === 'sub') renderSub();
    else if (v === 'support') renderSupport();
    else if (v === 'bets') renderBets();
    else if (v === 'books') renderBooks();
    else if (v === 'brief') renderBrief();
    // El board NO tenía rama: al volver de Combate el shell() se reconstruye vacío y nadie repoblaba las
    // picks ni el cockpit lateral (había que entrar a otra pestaña o refrescar). render() los repinta.
    else if (v === 'board' && S.dash) render();
  }
  function openMatch(eventId, fromHash) {
    if (!eventId) return;
    if (!fromHash) S.returnTo = (S.view === 'matches' ? 'matches' : S.view === 'sim' ? 'sim' : '');
    S.view = 'match'; S.matchId = eventId;
    if (!fromHash) setHash('match/' + eventId);
    applyView(); syncNavActive(); try { window.scrollTo(0, 0); } catch (e) {}
    renderMatch();
  }
  // Back del cockpit: al returnTo si existe; sin él (recarga/URL directa), un partido de CLUB vuelve a Partidos
  // (su hogar natural) — antes caía a Oportunidades y desorientaba (bug reportado 15-jul).
  function closeMatch(fromHash) { var fb = /^cl-/.test(S.matchId || '') ? 'matches' : ''; if (!fromHash) setHash(S.returnTo || fb); else showView('board'); }
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
  function stageLabel(c) { if (!c) return ''; var m = { GROUP: LANG === 'en' ? 'Group stage' : 'Fase de grupos', KNOCKOUT: LANG === 'en' ? 'Knockout' : 'Eliminatorias', R32: LANG === 'en' ? 'Round of 32' : '16avos', R16: LANG === 'en' ? 'Round of 16' : 'Octavos', QF: LANG === 'en' ? 'Quarter-finals' : 'Cuartos', SF: LANG === 'en' ? 'Semi-finals' : 'Semifinal', '3RD': LANG === 'en' ? '3rd place' : '3er puesto', FINAL: 'Final' }; return m[c] || c; }
  function ocName(h, c) { return c === 'DRAW' ? (LANG === 'en' ? 'Draw' : 'Empate') : teamName(c === 'AWAY' ? h.away.team_id : h.home.team_id, c === 'AWAY' ? h.away.name_fallback : h.home.name_fallback); }
  function ageFresh(iso) { if (!iso) return null; var ms = Date.now() - new Date(iso).getTime(); if (isNaN(ms)) return null; var h = ms / 3.6e6; return h <= 2 ? 'FRESH' : h <= 12 ? 'AGING' : 'STALE'; }
  // kind: 'data' (frescura de datos) | 'price' (frescura del precio) → etiqueta acorde a lo que se califica (A.6)
  function freshChip(code, kind) { if (!code) return ''; kind = kind === 'price' ? 'price' : 'data'; var k = { FRESH: ['fresh_' + kind, 'gx-fresh'], AGING: ['aging_' + kind, 'gx-aging'], STALE: ['stale_' + kind, 'gx-stale'] }[code]; return k ? '<span class="gx-freshchip ' + k[1] + '">' + esc(t(k[0])) + '</span>' : ''; }
  // no-vig SOLO con el set completo de resultados (1X2 → HOME+DRAW+AWAY); set parcial → null (no se inventa).
  function normVec(map) { var present = ['HOME', 'DRAW', 'AWAY'].filter(function (c) { return map[c] > 0; }); if (present.length < 3) return null; var sum = present.reduce(function (a, c) { return a + map[c]; }, 0); if (sum <= 0) return null; var o = {}; ['HOME', 'DRAW', 'AWAY'].forEach(function (c) { o[c] = map[c] > 0 ? map[c] / sum : null; }); return o; }

  // Vista de PARTIDO DE CLUB (shadow): id 'cl-<liga>-<homeId>-<awayId>'. Hero + probabilidad + proyección de
  // goles + marcadores del /api/clubs/match (engines de la casa) + value del cruce si el scan lo tiene.
  // Contexto/alineaciones/jugadores de clubes: en construcción (nota honesta).
  // COCKPIT DE PARTIDO DE CLUB = ADAPTADOR al render del Mundial (regla dura de Alexis: mismo mecanismo,
  // misma estructura, diferente data). Construye beta+fx con la MISMA forma que consume renderMatch y llama
  // las MISMAS funciones (mvHero/mvNav/mvMemo/mvProb/mvContext/mvForm/mvLineups con cancha/mvMarkets/mvStats/
  // mvLive/mvMomentum/mvGoals). flag()/teamName()/playerLink() ya resuelven ids tm_ → cero componentes nuevos.
  function renderClubMatch(eid, mv) {
    var parts = eid.slice(3).split('-'); var lgk = parts[0], hId = parts[1], aId = parts[2];
    S.clm = S.clm || {};
    if (S.clm[eid] === undefined) {
      S.clm[eid] = null; mv.innerHTML = mvShell(mvLoading()); bindBack();
      // nombres para equipos 'NUEVO' (sin rating): del fixture en el estado de clubes si lo tenemos
      var Lup = clubLeague(lgk), fxm = Lup ? (Lup.upcoming || []).find(function (f) { return f.home.id === hId && f.away.id === aId; }) : null;
      var nq = fxm ? '&hn=' + encodeURIComponent(fxm.home.name) + '&an=' + encodeURIComponent(fxm.away.name) : '';
      fetch('/api/clubs/match?hl=' + encodeURIComponent(lgk) + '&h=' + encodeURIComponent(hId) + '&al=' + encodeURIComponent(lgk) + '&a=' + encodeURIComponent(aId) + nq, { headers: hdrs() })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (m) { S.clm[eid] = m || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
      return;
    }
    var m = S.clm[eid];
    if (!m || m._empty || m.error) { mv.innerHTML = mvShell('<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('match_404')) + '</b></div></div>'); bindBack(); return; }
    // lazy-fetch de alineaciones y contexto del cruce (mismos endpoints; re-render al llegar)
    S.clu = S.clu || {}; S.cctx = S.cctx || {};
    if (!m.cross_league && S.clu[eid] === undefined) {
      S.clu[eid] = null;
      fetch('/api/clubs/lineups?league=' + encodeURIComponent(lgk) + '&h=' + encodeURIComponent(hId) + '&a=' + encodeURIComponent(aId), { headers: hdrs() })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { S.clu[eid] = j || { available: false }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
    }
    if (!m.cross_league && S.cctx[eid] === undefined) {
      S.cctx[eid] = null;
      fetch('/api/clubs/context?league=' + encodeURIComponent(lgk) + '&h=' + encodeURIComponent(hId) + '&a=' + encodeURIComponent(aId), { headers: hdrs() })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { S.cctx[eid] = j || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
    }
    // marcador en vivo/finalizado del cruce (si el sync de clubes lo tiene)
    var Lm = clubLeague(lgk), fxr = Lm ? (Lm.live || []).concat(Lm.upcoming || []).find(function (f) { return f.home.id === hId && f.away.id === aId; }) : null;
    var cres = fxr && fxr.result ? fxr.result : null;
    // ---- beta (misma forma que /api/beta/match del Mundial) ----
    var stCode = cres ? (cres.status === 'live' ? 'LIVE' : 'FINISHED') : 'SCHEDULED';
    var vRows = ((S.clubsValue && S.clubsValue.rows) || []).filter(function (v) { return v.home === m.home.name && v.away === m.away.name; });
    var mkOf = function (side) { var v = vRows.filter(function (x) { return x.outcome === side; })[0]; if (!v) return null; if (v.market != null) return v.market; if (v.edge_pp != null) return round4(m.probs[side] - v.edge_pp / 100); return null; };
    var fin = { HOME: m.probs.home, DRAW: m.probs.draw, AWAY: m.probs.away };
    var ca = m.context_adjust;
    var analysis = (ca && ca.active && ca.base_probs)
      ? (function () { var base = { HOME: ca.base_probs.home, DRAW: ca.base_probs.draw, AWAY: ca.base_probs.away }; return { context_state_code: 'FULL_CONTEXT', base_vector: base, final_vector: fin, context_adjustments: { HOME: round4(fin.HOME - base.HOME), DRAW: round4(fin.DRAW - base.DRAW), AWAY: round4(fin.AWAY - base.AWAY) }, context_moved_line: true, applied_factors: [], evaluated_factors: [], data_freshness_code: 'FRESH' }; })()
      : { context_state_code: 'BASE_ONLY', base_vector: fin, final_vector: fin, context_adjustments: { HOME: 0, DRAW: 0, AWAY: 0 }, context_moved_line: false, applied_factors: [], evaluated_factors: [], data_freshness_code: 'FRESH' };
    var beta = {
      header: { event_id: eid, competition_name: m.home.league_name, competition_code: 'CLUB', stage_code: null, kickoff_at: (fxr && fxr.utc) || (cres ? new Date().toISOString() : null), venue: null, status_code: stCode, home: { team_id: hId, name_fallback: m.home.name }, away: { team_id: aId, name_fallback: m.away.name } },
      probability: { market_code: '1X2', period_code: 'REGULATION', period_note_code: 'REGULATION_90', sums_to_one: true, outcomes: [
        { outcome_code: 'HOME', team_ref: 'home', gp_probability: m.probs.home, market_probability: mkOf('home') },
        { outcome_code: 'DRAW', team_ref: null, gp_probability: m.probs.draw, market_probability: mkOf('draw') },
        { outcome_code: 'AWAY', team_ref: 'away', gp_probability: m.probs.away, market_probability: mkOf('away') }] },
      analysis: analysis, confidence_code: null, risks: [], has_official_v2: false,
      goal_insights: m.goal_insights || null,
    };
    // ---- fx (misma forma que /api/match/:id del Mundial) ----
    var lu = (S.clu[eid] && S.clu[eid].available) ? S.clu[eid] : null;
    var mapSide = function (s, teamId) {
      if (!s) return null;
      // índice nombre→pid del server (XI clickeable al perfil vía playerLink, mismo camino del Mundial)
      S.clubPidx = S.clubPidx || {};
      var cx = S.clubPidx[teamId] = S.clubPidx[teamId] || { league: lgk, byName: {} };
      (s.xi || []).concat(s.bench || []).forEach(function (p) { if (p.pid && p.name) cx.byName[pnorm(p.name)] = p.pid; });
      return { formation: s.formation || null, coach: s.coach || null, confirmed: !s.projected, // P1.3: XI proyectado → badge "proyectado" (mvLineups)
        startXI: (s.xi || []).map(function (p) { return { name: p.name, number: p.num != null ? p.num : null, position: p.pos || null }; }),
        substitutes: (s.bench || []).map(function (p) { return { name: p.name, number: null, position: null }; }) };
    };
    var cctx = (S.cctx[eid] && !S.cctx[eid]._empty) ? S.cctx[eid] : null;
    var injuries = [];
    if (cctx) ['home', 'away'].forEach(function (sd) { ((cctx[sd] && cctx[sd].injuries) || []).forEach(function (i) { injuries.push({ side: sd, player: i.name }); }); ((cctx[sd] && cctx[sd].avail) || []).forEach(function (f) { if (f.player) injuries.push({ side: sd, player: f.player }); }); });
    var mapForm = function (arr) { return (arr && arr.length) ? { played: arr.length, results: arr } : null; };
    var fx = {
      status: cres ? (cres.status === 'live' ? 'live' : 'final') : 'scheduled',
      score: cres ? { home: cres.hg, away: cres.ag } : null,
      minute: cres ? cres.minute : null,
      date: (fxr && fxr.utc) || null,
      events: m.events || [],
      statistics: m.statistics || null,
      lineups: lu ? { home: mapSide(lu.home, hId), away: mapSide(lu.away, aId) } : {},
      recentForm: m.form ? { home: mapForm(m.form.home), away: mapForm(m.form.away) } : null,
      injuries: injuries,
      momentum: m.momentum || null,
      gpLive: m.gp_live ? { homeWin: m.gp_live.home, draw: m.gp_live.draw, awayWin: m.gp_live.away } : null,
      modelProbabilities: m.gp_live ? { homeWin: m.gp_live.home, draw: m.gp_live.draw, awayWin: m.gp_live.away, live: true, xgHome: m.xg.home, xgAway: m.xg.away, likelyScore: m.gp_live.likely_score } : { xgHome: m.xg.home, xgAway: m.xg.away },
      odds: (m.markets && m.markets.h2h && m.markets.h2h.home) ? [{ book: prettyBook(m.markets.h2h.home.book) || m.markets.h2h.home.book, home: m.markets.h2h.home.odds, draw: m.markets.h2h.draw && m.markets.h2h.draw.odds, away: m.markets.h2h.away && m.markets.h2h.away.odds }] : [],
      updatedAt: new Date().toISOString(),
    };
    // GP en vivo: mismo override del Mundial (la prob del hero se mueve con el marcador, la descomposición queda pre-partido)
    if (fx.status === 'live' && fx.gpLive) {
      var mk0 = {}; beta.probability.outcomes.forEach(function (o) { mk0[o.outcome_code] = o.market_probability; });
      beta.probability = { market_code: '1X2', period_code: 'REGULATION', period_note_code: 'REGULATION_90', sums_to_one: true, live: true, outcomes: [
        { outcome_code: 'HOME', team_ref: 'home', gp_probability: round4(fx.gpLive.homeWin), market_probability: mk0.HOME },
        { outcome_code: 'DRAW', team_ref: null, gp_probability: round4(fx.gpLive.draw), market_probability: mk0.DRAW },
        { outcome_code: 'AWAY', team_ref: 'away', gp_probability: round4(fx.gpLive.awayWin), market_probability: mk0.AWAY }] };
      if (beta.analysis) { beta.analysis.final_vector = { HOME: round4(fx.gpLive.homeWin), DRAW: round4(fx.gpLive.draw), AWAY: round4(fx.gpLive.awayWin) }; beta.analysis.live_adjusted = true; }
      beta._gpLive = fx.gpLive;
    }
    // ---- MISMO layout del Mundial: hero + nav de anclas + grid de 2 columnas con las mismas secciones ----
    // P1.1 LECTURAS DEL SISTEMA: las picks del cruce con su narrativa — MISMO mvPickReads del Mundial (las
    // picks de clubes del feed traen home/away_team_id tm_ y why de compose()). Lazy-load del feed si se entró
    // directo por URL (el Mundial lo carga en el board; acá lo disparamos para paridad sin depender del board).
    if (S.dailyPicks === undefined && S.me) {
      S.dailyPicks = null;
      fetch('/api/beta/picks' + asplanQS('?'), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; })
        .then(function (j) { S.dailyPicks = (j && j.picks) || []; if (S.view === 'match' && S.matchId === eid) { noAnimWindow(); renderMatch(); } });
    }
    var matchPicks = (S.dailyPicks || []).filter(function (p) { return (p.home_team_id === hId && p.away_team_id === aId) || (p.home_team_id === aId && p.away_team_id === hId); });
    var pickReads = mvPickReads(matchPicks);
    var r = rowFromBeta(beta);
    var live = fx.status === 'live';
    var hasForm = fx.recentForm && (fx.recentForm.home || fx.recentForm.away);
    var hasLineups = !!(fx.lineups && (fx.lineups.home || fx.lineups.away));
    var hasStats = fx.statistics && fx.statistics.home;
    var hasEvents = fx.events && fx.events.length;
    var hasMom = fx.momentum && fx.momentum.length > 2;
    var xgr = m.xg_report || null; // F1.3: xG observado post-partido (mismo panel mvXg del Mundial)
    var sections = [{ id: 'resumen', key: 'tab_summary' }, { id: 'prob', key: 'mod_prob' }, { id: 'mercados', key: 'mod_markets' }, { id: 'contexto', key: 'mod_context' }];
    if (pickReads) sections.push({ id: 'lecturas', key: 'reads_title' });
    if (hasForm) sections.push({ id: 'forma', key: 'mod_form' });
    if (hasLineups) sections.push({ id: 'alineaciones', key: 'mod_lineups' });
    if (hasMom) sections.push({ id: 'momentum', key: 'mod_momentum' });
    // P1.2 MATCH INTEL COMPLETO: mismo mvIntel del Mundial; los links de jugador van al perfil de club (href).
    var intelD = (m.match_intel && m.match_intel.available) ? m.match_intel : null;
    if (intelD) {
      (intelD.home && intelD.home.scorers || []).forEach(function (p2) { if (p2.pid && !p2.href) p2.href = '#cplayer/' + lgk + '-' + hId + '-' + p2.pid; });
      (intelD.away && intelD.away.scorers || []).forEach(function (p2) { if (p2.pid && !p2.href) p2.href = '#cplayer/' + lgk + '-' + aId + '-' + p2.pid; });
    }
    if (intelD) sections.push({ id: 'intel', key: 'mod_intel' });
    var styleD = (m.style && m.style.available) ? m.style : null; // F2.4: perfil táctico (event data FotMob de la liga)
    if (styleD) sections.push({ id: 'estilo', key: 'st_title' });
    if (hasStats || hasEvents || live) sections.push({ id: 'stats', key: 'mod_stats' });
    if (xgr) sections.push({ id: 'xg', key: 'mod_xg' });
    sections.push({ id: 'goles', key: 'mod_goals' });
    if (live) sections.push({ id: 'live', key: 'mod_live' });
    var sec = function (id, html) { return html ? '<div class="gx-sec" id="sec-' + id + '">' + html + '</div>' : ''; };
    mv.innerHTML = mvShell(
      mvHero(beta, fx, r, live) +
      mvNav(sections) +
      '<div class="gx-mv-grid">' +
      '<div class="gx-mv-col">' + sec('resumen', mvMemo(beta, r, fx)) + sec('prob', mvProb(beta)) + sec('contexto', mvContext(beta, fx)) + (hasForm ? sec('forma', mvForm(beta, fx)) : '') + '</div>' +
      '<div class="gx-mv-col">' + (live ? sec('live', mvLive(fx)) : '') + (pickReads ? sec('lecturas', pickReads) : '') + (hasMom ? sec('momentum', mvMomentum(fx, beta.header)) : '') + (hasLineups ? sec('alineaciones', mvLineups(beta, fx)) : '') + sec('mercados', mvMarkets(beta, fx, r)) + ((hasStats || hasEvents) ? sec('stats', mvStats(beta, fx)) : '') + (xgr ? sec('xg', mvXg(xgr, beta.header)) : '') + (intelD ? sec('intel', mvIntel(intelD, beta.header)) : '') + (styleD ? sec('estilo', uiPlan() === 'sharp' ? mvStyle(styleD, beta.header) : lockPanel('lock_sharp_t', 'lock_style_s')) : '') + sec('goles', mvGoals(beta)) + '</div>' +
      '</div>' +
      (m.cross_league ? '<div class="gx-panel"><div style="padding:12px 16px;font-size:11px;color:var(--gx-warn);line-height:1.5">' + esc(t('cl_cross')) + '</div></div>' : '')
    );
    bindBack(); bindMvNav();
    [].forEach.call(mv.querySelectorAll('[data-cplayer]'), function (el) {
      el.addEventListener('click', function () { var pp = el.getAttribute('data-cplayer').split('|'); openClubPlayer(pp[0], pp[1], pp[2]); });
    });
  }
  // (P1.2) clubIntelHtml ELIMINADA: el Match intel de club rinde con el MISMO mvIntel del Mundial
  // (regla extensión-no-reconstrucción) — el server ya entrega el shape completo en /api/clubs/match.
  function mvShell(body) {
    return '<div class="gx-mv">' +
      '<div class="gx-mv-bar"><button class="gx-mv-back">' + ic('arrow-left') + '<span>' + esc(t('back')) + '</span></button></div>' +
      body + '</div>';
  }
  function mvLoading() { return '<div class="gx-panel"><div class="gx-empty">' + ic('loader-2') + esc(t('match_loading')) + '</div></div>'; }
  function bindBack() { var b = $('.gx-mv-back'); if (b) b.addEventListener('click', function () { goBack(); }); }
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
    polymarket: 'https://polymarket.com', kalshi: 'https://kalshi.com', novig: 'https://novig.us', prophetx: 'https://prophetbettingexchange.com', myriad: 'https://myriad.markets',
    // CASAS CRIPTO. `stake` lleva el código de afiliado de GP (25-jul): todo enlace saliente a Stake desde el
    // escáner/oportunidades/casas acredita la referencia. Cloudbet queda con URL limpia hasta cerrar el acuerdo
    // (ahí se le agrega su código igual que acá).
    stake: 'https://stake.com/?c=qLKRRqOf', cloudbet: 'https://www.cloudbet.com',
    rollbit: 'https://rollbit.com', bcgame: 'https://bc.game',
    // PARTNERS.IO (27-jul): links de afiliado del grupo Coingaming — Sportsbet.io + casinos hermanos
    sportsbetio: 'https://go.sportsbet.io?asset_id=37501966',
    bitcasino: 'https://go.bitcasino.io?asset_id=37501965', livecasino: 'https://go.livecasino.io?asset_id=37501967'
  };
  function bookUrl(code) { return BOOK_URLS[code] || BOOK_URLS[String(code || '').replace(/_(se|nl|fr|de|uk|us|eu|au|at|es|it)$/i, '')] || null; }
  function venueBtn(code, label) { var u = bookUrl(code); if (!u) return '<span class="gx-ov-venuex">' + bookLogo(code) + esc(label || code) + '</span>'; return '<a class="gx-ov-venue" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + bookLogo(code) + ic('external-link') + esc(label || code) + '</a>'; }
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
    if (/^cl-/.test(eid)) { renderClubMatch(eid, mv); return; } // partido de CLUBES (shadow)
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
      fetch('/api/h2h/deep?a=' + encodeURIComponent(hid) + '&b=' + encodeURIComponent(aid) + asplanQS('&'), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.h2h[hk] = m || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
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
    // xG OBSERVADO del partido (solo TERMINADOS; el server cachea permanente, 1 fetch por partido).
    var matchFinished = fx && fx.status === 'final';
    if (matchFinished && hid && aid && S.xgr[hk] === undefined) {
      S.xgr[hk] = null;
      fetch('/api/beta/xg-report?home=' + encodeURIComponent(hid) + '&away=' + encodeURIComponent(aid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.xgr[hk] = m || { available: false }; if (S.view === 'match' && S.matchId === eid) renderMatch(); });
    }
    var xgr = (matchFinished && S.xgr[hk] && S.xgr[hk].available) ? S.xgr[hk] : null;
    // INTEL (props de jugador + radar de observación): el server decide el acceso (GP_PROPS_PICKS_PUBLIC
    // abierto 8-jul); si devuelve 403 el panel simplemente no aparece. Se intenta para todos.
    var wantIntel = !matchFinished && hid && aid && !!S.me;
    if (wantIntel && S.intel[hk] === undefined) {
      S.intel[hk] = null;
      fetch('/api/beta/match-intel?home=' + encodeURIComponent(hid) + '&away=' + encodeURIComponent(aid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.intel[hk] = m || { available: false }; if (S.view === 'match' && S.matchId === eid) { noAnimWindow(); renderMatch(); } });
    }
    var intel = (wantIntel && S.intel[hk] && S.intel[hk].available) ? S.intel[hk] : null;
    // PERFIL TÁCTICO (style engine, event data del torneo): mismo gate server-side que el intel (403 → no aparece).
    if (hid && aid && S.me && S.style[hk] === undefined) {
      S.style[hk] = null;
      fetch('/api/beta/style?home=' + encodeURIComponent(hid) + '&away=' + encodeURIComponent(aid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (m) { S.style[hk] = m || { available: false }; if (S.view === 'match' && S.matchId === eid) { noAnimWindow(); renderMatch(); } });
    }
    var styleD = (hid && aid && S.style[hk] && S.style[hk].available) ? S.style[hk] : null;
    // LECTURAS DEL SISTEMA: narrativa de las picks activas de ESTE partido (destino natural del "por qué").
    if (S.dailyPicks === undefined && S.me) {
      S.dailyPicks = null;
      fetch('/api/beta/picks' + asplanQS('?'), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (j) { S.dailyPicks = (j && j.picks) || []; if (S.view === 'match' && S.matchId === eid) { noAnimWindow(); renderMatch(); } });
    }
    var matchPicks = (S.dailyPicks || []).filter(function (p) { return (p.home_team_id === hid && p.away_team_id === aid) || (p.home_team_id === aid && p.away_team_id === hid); });
    var pickReads = mvPickReads(matchPicks);
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
    var hasMom = fx && fx.momentum && fx.momentum.length > 2;
    if (hasMom) sections.push({ id: 'momentum', key: 'mod_momentum' });
    if (intel) sections.push({ id: 'intel', key: 'mod_intel' });
    if (hasStats || hasEvents || live) sections.push({ id: 'stats', key: 'mod_stats' });
    if (xgr) sections.push({ id: 'xg', key: 'mod_xg' });
    if (!gpAbsent) sections.push({ id: 'goles', key: 'mod_goals' });
    if (live) sections.push({ id: 'live', key: 'mod_live' });
    var sec = function (id, html) { return html ? '<div class="gx-sec" id="sec-' + id + '">' + html + '</div>' : ''; };
    mv.innerHTML = mvShell(
      mvHero(beta, fx, r, live) +
      mvNav(sections) +
      (arbCtx ? mvOpportunity(arbCtx, header) : '') +
      '<div class="gx-mv-grid">' +
      '<div class="gx-mv-col">' + sec('resumen', gpAbsent ? mvGpAbsent(beta, fx) : mvMemo(beta, r, fx)) + sec('prob', gpAbsent ? mvProbAbsent() : mvProb(beta)) + sec('contexto', mvContext(beta, fx)) + (hasForm ? sec('forma', mvForm(beta, fx)) : '') + '</div>' +
      '<div class="gx-mv-col">' + (live ? sec('live', mvLive(fx)) : '') + (pickReads ? sec('lecturas', pickReads) : '') + (hasMom ? sec('momentum', mvMomentum(fx, header)) : '') + (hasLineups ? sec('alineaciones', mvLineups(beta, fx)) : '') + sec('mercados', mvMarkets(beta, fx, r)) + ((hasStats || hasEvents) ? sec('stats', mvStats(beta, fx)) : '') + (xgr ? sec('xg', mvXg(xgr, header)) : '') + (intel ? sec('intel', mvIntel(intel, header)) : '') + (styleD ? sec('estilo', uiPlan() === 'sharp' ? mvStyle(styleD, header) : lockPanel('lock_sharp_t', 'lock_style_s')) : '') + (gpAbsent ? '' : sec('goles', mvGoals(beta))) + '</div>' +
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
  function pitchHtmlP(l, teamId) {
    var xi = (l && l.startXI) || []; if (xi.length < 7) return null;
    var b = { GK: [], DEF: [], MID: [], FWD: [] };
    xi.forEach(function (p) { b[posBucketP(p.position)].push(p); });
    var rows = [b.FWD, b.MID, b.DEF, b.GK].filter(function (a) { return a.length; });
    if (rows.length < 2) return null;
    // cada jugador de la cancha es clickeable → perfil (cuando el nombre resuelve en el índice)
    var row = function (arr) { return '<div class="gx-pitch-row">' + arr.map(function (p) { var inner = '<div class="gx-pp"><span class="gx-pp-num gx-mono">' + (p.number != null ? p.number : '·') + '</span><span class="gx-pp-name">' + esc(shortNameP(p.name)) + '</span></div>'; return teamId ? playerLink(teamId, p.name, inner) : inner; }).join('') + '</div>'; };
    return '<div class="gx-pitch">' + rows.map(row).join('') + '</div>';
  }
  function mvLineups(beta, fx) {
    var h = beta.header, lu = fx.lineups || {}, eid = beta.header.event_id;
    // lazy-fetch teamdetail para lados sin alineación (próximos partidos sin XI confirmado/proyectado en /api/match)
    ['home', 'away'].forEach(function (sk) { var id = sk === 'home' ? h.home.team_id : h.away.team_id; if (!lu[sk] && id && !/^tm_/.test(id) && S.tcache[id] === undefined) { S.tcache[id] = null; fetch('/api/teamdetail/' + encodeURIComponent(id), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(function (td) { S.tcache[id] = td || { _empty: true }; if (S.view === 'match' && S.matchId === eid) renderMatch(); }); } });
    var side = function (sideKey, id, name) {
      var l = lu[sideKey], fromTeam = false;
      if (!l) { var td = S.tcache[id]; if (td && !td._empty && td.projectedLineup && (td.projectedLineup.startXI || []).length) { l = td.projectedLineup; fromTeam = true; } }
      if (!l) return '<div class="gx-lu-side"><div class="gx-lu-h"><span class="fl">' + flag(id) + '</span><b>' + esc(name) + '</b></div><div class="gx-dim" style="font-size:12px;padding:6px 0">' + esc(S.tcache[id] === null ? t('loading') : t('e_lineups')) + '</div></div>';
      var tag = (l.confirmed && !fromTeam) ? '<span class="gx-badge gx-b-strong">' + esc(t('lineup_conf')) + '</span>' : '<span class="gx-badge gx-b-watch">' + esc(t('lineup_proj')) + '</span>';
      var pl = function (p) { var inner = '<div class="gx-lu-p"><span class="gx-lu-n gx-mono">' + (p.number != null ? p.number : '–') + '</span><b>' + esc(p.name || '') + '</b>' + (p.position ? '<span class="gx-dim gx-lu-pos">' + esc(p.position) + '</span>' : '') + '</div>'; return playerLink(id, p.name, inner); };
      var pitch = pitchHtmlP(l, id);
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
  // xG OBSERVADO del partido (post-partido): total, por mitades y ocasiones claras. Data del server
  // (/api/beta/xg-report, cache permanente). Muestra el RENDIMIENTO real, complementa la proyección GP.
  function mvXg(xgr, header) {
    var hn = teamName(header.home && header.home.team_id, header.home && header.home.name_fallback);
    var an = teamName(header.away && header.away.team_id, header.away && header.away.name_fallback);
    var row = function (label, pair, dec) {
      if (!pair || pair.home == null || pair.away == null) return '';
      var hv = Number(pair.home), av = Number(pair.away), tot = hv + av, hp = tot > 0 ? hv / tot * 100 : 50;
      var f = function (v) { return dec ? v.toFixed(2) : String(v); };
      return '<div class="gx-stat-row"><span class="gx-mono" style="font-weight:700">' + f(hv) + '</span><div class="gx-stat-mid"><span class="gx-label">' + esc(label) + '</span><div class="gx-stat-bar"><i style="width:' + hp + '%"></i></div></div><span class="gx-mono" style="font-weight:700">' + f(av) + '</span></div>';
    };
    var body = '<div class="gx-form-h" style="justify-content:space-between;margin-bottom:10px"><span><span class="fl">' + flag(header.home && header.home.team_id) + '</span> <b>' + esc(hn) + '</b></span><span><b>' + esc(an) + '</b> <span class="fl">' + flag(header.away && header.away.team_id) + '</span></span></div>' +
      '<div class="gx-stats">' +
      row(t('xg_total'), xgr.xg, true) +
      row(t('xg_h1'), xgr.xg_h1, true) +
      row(t('xg_h2'), xgr.xg_h2, true) +
      row(t('xg_bigch'), xgr.big_chances, false) +
      (xgr.shots ? row(t('xg_shots'), xgr.shots, false) : '') +
      '</div>';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('target-arrow') + esc(t('mod_xg')) + '</span></div><div class="gx-mod-body">' + body + '</div></div>';
  }
  // INTEL del partido (admin-first): anotadores probables (props de jugador) + radar de disponibilidad
  // (capa de observación) con el factor λ sugerido si las ausencias se confirman.
  // LECTURAS DEL SISTEMA: las picks activas de este partido con su narrativa completa (el "por qué" vive acá
  // a texto completo; en la card del feed queda tras un toggle). Devuelve '' si no hay nada que contar.
  function mvPickReads(matchPicks) {
    var withWhy = (matchPicks || []).filter(function (p) { return p.why_es || p.why_en; });
    if (!withWhy.length) return '';
    var rows = withWhy.map(function (p) {
      var famKey = p.family === 'SOLID' ? 'pf_fam_solid' : p.family === 'GOALS' ? 'pf_fam_goals' : p.family === 'CORNERS' ? 'pf_fam_corners' : p.family === 'CARDS' ? 'pf_fam_cards' : p.family === 'PLAYER' ? 'pf_fam_player' : 'pf_fam_combo';
      var w = LANG === 'en' ? (p.why_en || p.why_es) : (p.why_es || p.why_en);
      return '<div class="gx-read"><div class="gx-read-h"><span class="gx-badge">' + esc(t(famKey)) + '</span><b>' + esc(pickRecText(p)) + '</b>' + (p.odds != null ? '<span class="gx-mono gx-dim" style="margin-left:auto">' + Number(p.odds).toFixed(2) + '</span>' : '') + '</div><p class="gx-read-tx">' + esc(w) + '</p></div>';
    }).join('');
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('bulb') + esc(t('reads_title')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:11px">' + withWhy.length + '</span></div><div class="gx-mod-body">' + rows + '</div></div>';
  }

  // PERFIL TÁCTICO (style engine): comparativa ataque/defensa de los dos equipos + hallazgos de matchup.
  function mvStyle(st, header) {
    var H = st.home, A = st.away;
    if (!H || !A) return '';
    var hn = teamName(H.team_id), an = teamName(A.team_id);
    var pc = function (x) { return x != null ? Math.round(x * 100) + '%' : '—'; };
    var n1 = function (x) { return x != null ? Number(x).toFixed(1) : '—'; };
    var row = function (label, hv, av, fmt, invert) {
      var f = fmt || n1;
      var hRaw = hv != null ? Number(hv) : null, aRaw = av != null ? Number(av) : null;
      var hWin = hRaw != null && aRaw != null && (invert ? hRaw < aRaw : hRaw > aRaw);
      var aWin = hRaw != null && aRaw != null && (invert ? aRaw < hRaw : aRaw > hRaw);
      return '<div class="gx-style-row"><span class="gx-mono v' + (hWin ? ' hi' : '') + '">' + f(hv) + '</span><span class="lbl">' + esc(label) + '</span><span class="gx-mono v' + (aWin ? ' hi' : '') + '">' + f(av) + '</span></div>';
    };
    var findTxt = function (f) {
      var team = teamName(f.side === 'home' ? H.team_id : A.team_id);
      var key = 'sf_' + String(f.code || '').toLowerCase();
      var s = t(key, { team: team });
      return s === key ? null : s;
    };
    var finds = (st.findings || []).map(findTxt).filter(Boolean).slice(0, 3);
    var findsHtml = finds.length ? '<div class="gx-findings" style="margin:0 0 10px"><div class="gx-findings-h">' + ic('bulb') + '<span>' + esc(t('st_findings')) + '</span></div>' + finds.map(function (s) { return '<div class="gx-finding"><span class="gx-finding-dot"></span><span class="gx-finding-tx">' + esc(s) + '</span></div>'; }).join('') + '</div>' : '';
    var head = '<div class="gx-style-row gx-style-head"><span class="v"><span class="fl">' + flag(H.team_id) + '</span> ' + esc(hn) + '</span><span class="lbl"></span><span class="v">' + esc(an) + ' <span class="fl">' + flag(A.team_id) + '</span></span></div>';
    var body = findsHtml + head +
      row(t('st_xg'), H.attack.xg_p90, A.attack.xg_p90) +
      row(t('st_xga'), H.defense.xg_p90, A.defense.xg_p90, null, true) +
      row(t('st_corners_pct'), H.attack.corner_share_xg, A.attack.corner_share_xg, pc) +
      row(t('st_sp_pct'), H.attack.sp_share_xg, A.attack.sp_share_xg, pc) +
      row(t('st_counter_pct'), H.attack.fastbreak_share_xg, A.attack.fastbreak_share_xg, pc) +
      row(t('st_aerial'), H.attack.header_share, A.attack.header_share, pc) +
      (H.props && A.props ? row(t('st_c90'), H.props.corners_for_p90, A.props.corners_for_p90) + row(t('st_cards'), H.props.cards_p90, A.props.cards_p90) : '') +
      '<p class="gx-mod-note gx-dim">' + esc(t('st_note')) + '</p>';
    var subKey = (header && header.competition_code === 'CLUB') ? 'st_sub_club' : 'st_sub';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('layout-grid') + esc(t('st_title')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:11px">' + esc(t(subKey)) + '</span></div><div class="gx-mod-body">' + body + '</div></div>';
  }

  // P2: distribución de minutos — panel COMPARTIDO (perfil del Mundial + perfil de club, mismo componente)
  function minutesDistPanel(md) {
    if (!md) return '';
    var s = function (label, val) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + val + '</b></div>'; };
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('clock') + esc(t('pp_mindist')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:10.5px">' + md.starts + '/' + md.apps + ' ' + esc(t('pp_apps').toLowerCase()) + '</span></div><div class="gx-mod-body"><div class="gx-hero-grid" style="margin:0">' +
      s(t('pp_pstart'), pct0(md.p_start)) +
      s(t('pp_if_start'), md.exp_min_start + "'") +
      s(t('pp_if_bench'), md.exp_min_sub != null ? md.exp_min_sub + "'" : '—') +
      s(t('pp_p60'), pct0(md.p60)) + s(t('pp_p75'), pct0(md.p75)) + s(t('pp_p90'), pct0(md.p90)) +
      '</div></div></div>';
  }
  function mvIntel(intel, header) {
    var riskChip = function (r) {
      if (!r) return '';
      var lbl = r === 'OUT' ? t('intel_out') : r === 'SUSPENDED' ? t('intel_susp') : r === 'DOUBT' ? t('intel_doubt') : t('intel_rest');
      return '<span class="gx-badge gx-intel-risk">' + esc(lbl) + '</span>';
    };
    var sideCol = function (code, nameFallback, d) {
      if (!d) return '';
      var head = '<div class="gx-intel-row gx-intel-head"><span class="n gx-label">' + esc(t('intel_player')) + '</span><span class="v gx-label">' + esc(t('intel_goal')) + '</span><span class="v gx-label">' + esc(t('intel_shots')) + '</span></div>';
      var rows = (d.scorers || []).map(function (p) {
        // "Por qué": códigos de razón del player-intel engine, localizados. Nunca fuentes ni métodos.
        var why = (p.reasons || []).slice(0, 4).map(function (c) { var k = 'pi_' + String(c).toLowerCase(); var s = t(k); return s === k ? null : s; }).filter(Boolean).join(' · ');
        var whyHtml = why ? '<div class="gx-dim" style="font-size:10px;grid-column:1/-1;padding:1px 0 3px">' + esc(why) + '</div>' : '';
        // p.href (clubes) pisa la ruta del perfil (#cplayer/liga-equipo-pid); default = ruta del Mundial, byte-idéntico.
        var nameHtml = p.href ? '<a href="' + esc(p.href) + '" style="color:inherit;text-decoration:none"><b>' + esc(p.name) + '</b></a>' : (p.pid ? '<a href="#player/' + esc(p.pid) + '" style="color:inherit;text-decoration:none"><b>' + esc(p.name) + '</b></a>' : '<b>' + esc(p.name) + '</b>');
        // P2: mini-chip de minutos (P titular · min esperados) cuando la distribución viaja en la fila
        var md = p.minutes_dist;
        var mdChip = md ? '<i class="gx-dim" style="font-size:10px">' + Math.round(md.p_start * 100) + '% ' + esc(t('mi_start_chip')) + ' · ' + md.exp_min + '\'</i>' : '';
        return '<div class="gx-intel-row"><span class="n">' + nameHtml + '<i class="gx-dim">' + esc(p.pos || '') + '</i>' + mdChip + riskChip(p.risk) + '</span><span class="v gx-mono gx-pos">' + pct0(p.anytime) + '</span><span class="v gx-mono">' + p.shots + '</span>' + whyHtml + '</div>';
      }).join('');
      var radar = (d.radar && d.radar.players || []).map(function (x) {
        var why = LANG === 'en' ? x.why_en : x.why_es;
        var whyHtml = why ? '<div class="gx-dim" style="font-size:10.5px;grid-column:1/-1;padding:2px 0 4px;line-height:1.45">' + esc(why) + '</div>' : '';
        return '<div class="gx-intel-row"><span class="n">' + esc(x.player) + riskChip(x.status) + '</span><span class="v gx-mono gx-dim">' + pct0(x.prob_miss) + '</span><span class="v gx-dim" style="font-size:10px">' + esc(t('intel_miss')) + '</span>' + whyHtml + '</div>';
      }).join('');
      var factor = d.radar && d.radar.lambda_factor != null && d.radar.lambda_factor !== 1 ? '<p class="gx-mod-note gx-dim">' + esc(t('intel_factor', { pct: Math.round((1 - d.radar.lambda_factor) * 100) })) + '</p>' : '';
      return '<div class="gx-intel-side"><div class="gx-form-h"><span class="fl">' + flag(code) + '</span><b>' + esc(teamName(code, nameFallback)) + '</b></div>' + head + rows + (radar ? '<div class="gx-mod-sub gx-label">' + esc(t('intel_radar')) + '</div>' + radar + factor : '') + '</div>';
    };
    // ── HALLAZGOS DE INTELIGENCIA (8-jul): el "recuadro" narrado que faltaba. Agrega los descubrimientos del
    // contexto/observación de AMBOS equipos en prosa — la gente ve el POR QUÉ del DUDA (ej. Haaland enfermo),
    // no solo la etiqueta. Sin fuentes ni métodos (caja negra).
    var findings = [];
    ['home', 'away'].forEach(function (sk) {
      var d = intel[sk], code = sk === 'home' ? (header.home && header.home.team_id) : (header.away && header.away.team_id);
      ((d && d.radar && d.radar.players) || []).forEach(function (x) {
        var why = LANG === 'en' ? x.why_en : x.why_es;
        if (why) findings.push({ code: code, status: x.status, why: why });
      });
    });
    var ordr = { OUT: 0, SUSPENDED: 1, DOUBT: 2, REST_RISK: 3 };
    findings.sort(function (a, b) { return (ordr[a.status] == null ? 9 : ordr[a.status]) - (ordr[b.status] == null ? 9 : ordr[b.status]); });
    var findingsBlock = findings.length ? '<div class="gx-findings"><div class="gx-findings-h">' + ic('bulb') + '<span>' + esc(t('intel_findings')) + '</span></div>' +
      findings.slice(0, 6).map(function (f) {
        return '<div class="gx-finding"><span class="gx-finding-dot gx-fd-' + (f.status === 'OUT' || f.status === 'SUSPENDED' ? 'out' : 'doubt') + '"></span><span class="fl">' + flag(f.code) + '</span><span class="gx-finding-tx">' + esc(f.why) + '</span></div>';
      }).join('') + '</div>' : '';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('users') + esc(t('mod_intel')) + '</span></div>' + findingsBlock + '<div class="gx-mod-body gx-intel-grid">' +
      sideCol(header.home && header.home.team_id, header.home && header.home.name_fallback, intel.home) +
      sideCol(header.away && header.away.team_id, header.away && header.away.name_fallback, intel.away) +
      '</div><p class="gx-mod-note gx-dim">' + esc(t('intel_note')) + '</p></div>';
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
    var meta = [h.competition_name ? esc(h.competition_name) : esc(t('comp')), stageLabel(h.stage_code) ? esc(stageLabel(h.stage_code)) : '', h.venue ? esc(h.venue) : '', esc(fmtDate(h.kickoff_at))].filter(Boolean).join(' · ');
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
      // marcadores más probables como CHIPS (top 3 con %); sin goal_insights cae al marcador único de antes
      ((gi && gi.top_scores && gi.top_scores.length) ?
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('hero_scores')) + '</span><span style="display:flex;gap:5px;flex-wrap:wrap">' +
        gi.top_scores.slice(0, 3).map(function (s) { return '<span class="gx-badge" style="font-size:11px">' + esc(s.score) + (s.probability != null ? ' · ' + pct0(s.probability) : '') + '</span>'; }).join('') +
        '</span></div>'
        : (likely ? miniStat(t('hero_score'), esc(likely)) : '')) +
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
      '<div class="gx-memo-cta"><span class="gx-bestprice">' + esc(t('best_avail')) + ' <b>' + (memo.bestOdds != null ? odd(memo.bestOdds) : esc(t('e_noprice'))) + '</b>' + (memo.book ? ' · ' + bookLogo(memo.bookCode) + esc(memo.book) : '') + '</span>' +
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
        return { outcome: ocName(h, c), provider: prettyBook(v.best_sportsbook) || '—', providerCode: v.best_sportsbook, odds: v.best_odds, implied: 1 / v.best_odds, novig: nv ? nv[c] : null, best: c === bestCode(r), liq: null, fresh: ageFresh(v.price_observed_at) };
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
        return { outcome: ocName(h, c), provider: 'Polymarket', providerCode: 'polymarket', odds: o.price > 0 ? 1 / o.price : null, implied: o.price, novig: nvp ? nvp[c] : null, best: false, liq: o.volume != null ? o.volume : null, fresh: null };
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
        return '<tr' + (x.best ? ' class="best"' : '') + '><td class="l gx-mkt-oc">' + esc(x.outcome) + (x.best ? ' ' + ic('star-filled') : '') + '</td><td class="l gx-dim" style="white-space:nowrap">' + bookLogo(x.providerCode) + esc(x.provider) + '</td>' +
          '<td class="gx-mono">' + (x.odds != null ? odd(x.odds) : '—') + '</td><td class="gx-mono gx-dim">' + (x.implied != null ? pct0(x.implied) : '—') + '</td>' +
          '<td class="gx-mono">' + (x.novig != null ? pct0(x.novig) : '—') + '</td><td class="gx-mono gx-dim">' + liqCell(x.liq) + '</td>' +
          '<td>' + (x.fresh ? freshChip(x.fresh, 'price') : '<span class="gx-dim">—</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
    // móvil: cada resultado/proveedor = card compacta apilada (A.4; sin scroll horizontal)
    var kv = function (label, val, mono) { return '<div class="gx-mkc-kv"><span>' + esc(label) + '</span><b' + (mono ? ' class="gx-mono"' : '') + '>' + val + '</b></div>'; };
    var cards = rows.map(function (x) {
      return '<div class="gx-mkc' + (x.best ? ' best' : '') + '"><div class="gx-mkc-h"><b>' + esc(x.outcome) + (x.best ? ' ' + ic('star-filled') : '') + '</b><span class="gx-dim" style="display:inline-flex;align-items:center;gap:5px">' + bookLogo(x.providerCode) + esc(x.provider) + '</span></div>' +
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
        return t(f.goalsFor != null && f.goalsAgainst != null ? 'ctx_form_line' : 'ctx_form_line_short', { team: '<b>' + esc(name) + '</b>', rec: esc(rec), n: f.played, gf: f.goalsFor, ga: f.goalsAgainst });
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
    // GATING: la proyección de goles es Pro+ — el plan Free ve el candado con CTA (decisión Alexis 4-jul).
    if (uiPlan() === 'free') return head + '<div class="gx-mod-body">' + lockPanelPro() + '</div></div>';
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
  // ---- MOMENTUM GP: evolución de la probabilidad en vivo (serie muestreada por el server cada ~30s). ----
  // Dos líneas (local/visitante) + marcadores de gol donde cambia el marcador. Vive en vivo Y post-partido.
  function mvMomentum(fx, header, opts) {
    var pts = fx && fx.momentum;
    if (!pts || pts.length < 3) return '';
    opts = opts || {};
    // badge/nameOf parametrizables para REUSAR esta función en clubes (escudos) sin bifurcar; default = Mundial (banderas).
    var badge = opts.badge || function (id) { return '<span class="fl">' + flag(id) + '</span>'; };
    var nameOf = opts.nameOf || function (id, fb) { return teamName(id, fb); };
    var hid = header.home && header.home.team_id, aid = header.away && header.away.team_id;
    var W = 620, H = 190, L = 36, R = 12, T = 14, B = 26, cw = W - L - R, ch = H - T - B;
    var xmax = Math.max(95, pts[pts.length - 1].t + 3);
    var X = function (t) { return L + (t / xmax) * cw; };
    var Y = function (p) { return T + (1 - p) * ch; };
    var line = function (key) { return pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p[key]).toFixed(1); }).join(' '); };
    // goles: donde el marcador sube respecto del punto anterior
    var goals = [];
    for (var i = 1; i < pts.length; i++) {
      if (pts[i].hg > pts[i - 1].hg) goals.push({ t: pts[i].t, y: Y(pts[i].h), side: 'h' });
      if (pts[i].ag > pts[i - 1].ag) goals.push({ t: pts[i].t, y: Y(pts[i].a), side: 'a' });
    }
    var grid = [0.25, 0.5, 0.75].map(function (g) { return '<line x1="' + L + '" y1="' + Y(g) + '" x2="' + (W - R) + '" y2="' + Y(g) + '" stroke="rgba(255,255,255,.07)"' + (g === 0.5 ? ' stroke-dasharray="3 3"' : '') + '/>'; }).join('');
    var vlines = [45, 90].filter(function (m) { return m < xmax; }).map(function (m) { return '<line x1="' + X(m) + '" y1="' + T + '" x2="' + X(m) + '" y2="' + (T + ch) + '" stroke="rgba(255,255,255,.10)" stroke-dasharray="4 4"/><text x="' + X(m) + '" y="' + (H - 8) + '" fill="#5F747B" font-size="10" text-anchor="middle">' + m + '′</text>'; }).join('');
    var dots = goals.map(function (g) { return '<circle cx="' + X(g.t).toFixed(1) + '" cy="' + g.y.toFixed(1) + '" r="5.5" fill="' + (g.side === 'h' ? '#5BA8FF' : '#1FE3A4') + '" stroke="#0B1417" stroke-width="2"/>'; }).join('');
    var last = pts[pts.length - 1];
    var legend = '<div class="gx-plabels" style="margin-top:8px"><span>' + badge(hid) + ' ' + esc(nameOf(hid, header.home && header.home.name_fallback)) + ' <b style="color:#5BA8FF">' + pct0(last.h) + '</b></span><span>X <b>' + pct0(last.d) + '</b></span><span>' + esc(nameOf(aid, header.away && header.away.name_fallback)) + ' <b style="color:#1FE3A4">' + pct0(last.a) + '</b> ' + badge(aid) + '</span></div>';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('trending-up') + esc(t('mod_momentum')) + '</span>' + (fx.status === 'live' ? '<span class="gx-live-pill">' + esc(t('st_live')) + '</span>' : '') + '</div>' +
      '<div class="gx-mod-body"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">' +
      grid + vlines +
      '<text x="' + (L - 6) + '" y="' + (Y(0.5) + 3) + '" fill="#5F747B" font-size="10" text-anchor="end">50%</text>' +
      '<path d="' + line('h') + '" fill="none" stroke="#5BA8FF" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<path d="' + line('a') + '" fill="none" stroke="#1FE3A4" stroke-width="2.2" stroke-linejoin="round"/>' +
      dots + '</svg>' + legend +
      '<p class="gx-mod-note gx-dim">' + esc(t('mom_note')) + '</p></div></div>';
  }
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
  // ===== FASE CLUBES — SHADOW solo admin (GP_CLUBS_SHADOW_ENABLED → clubs_shadow en /api/me). Extensión de
  // la plataforma, no página aparte (decisión 13-jul): el Mundial sigue INTACTO (sus partidos quedan como
  // finalizados) y las ligas de clubes se suman a las MISMAS superficies. Con el flag off o sin admin, cero
  // cambios de comportamiento para todos los demás. =====
  function clubsOn() { return !!(S.me && S.me.clubs_shadow); }
  function loadClubs() {
    if (!clubsOn() || S.clubs !== undefined) return;
    S.clubs = null;
    fetch('/api/clubs/state', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) {
        S.clubs = j || { leagues: [] };
        // índice tm_id → nombre (alimenta teamName() para que TODOS los componentes del Mundial sirvan clubes)
        S.clubNames = {};
        (S.clubs.leagues || []).forEach(function (L) { (L.table || []).forEach(function (tm) { S.clubNames[tm.id] = tm.name; }); });
        // re-render de la vista actual si usa el selector de competición y se abrió antes de tener las ligas
        // (hash directo a #groups/#bracket): sin esto el <select> queda solo con "Mundial".
        if (S.view === 'matches') renderMatches();
        else if (S.view === 'groups') renderGroups();
        else if (S.view === 'bracket') renderBracket();
      });
    fetch('/api/clubs/value', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) { S.clubsValue = j || null; if (S.view === 'match' && /^cl-/.test(S.matchId || '')) renderMatch(); });
  }
  function clubLeague(k) { var Ls = (S.clubs && S.clubs.leagues) || []; for (var i = 0; i < Ls.length; i++) if (Ls[i].key === k) return Ls[i]; return null; }
  // Lanzamiento 18-jul: el chip de gate (Aprobado / En calibración) es una señal INTERNA de modelo — solo
  // admin la ve; el público recibe la superficie limpia, sin marcas de estado.
  function clubGateChip(g) { if (!g || !(S.me && S.me.isAdmin)) return ''; return g.status === 'approved' ? '<span class="gx-clgate ok">' + esc(t('cl_gate_ok')) + '</span>' : '<span class="gx-clgate sh">' + esc(t('cl_gate_sh')) + '</span>'; }
  // tri-cell de la card: en vivo usa la prob GP condicionada al marcador (f.gpProbs, se mueve con el partido),
  // igual que el Mundial; si no, la prob pre-partido a 90 min.
  function clubTriCell(f) { var m = (f.gpProbs && f.gpProbs.home != null) ? { HOME: f.gpProbs.home, DRAW: f.gpProbs.draw, AWAY: f.gpProbs.away } : { HOME: f.home.prob, DRAW: f.draw, AWAY: f.away.prob }; return triCell(function (c) { return pct0(m[c]); }, 'gx-gp', maxCode(function (c) { return m[c]; })); }
  // marcador (f.result desde ESPN por liga) o null; estado en vivo/final/próximo.
  function clubScore(f) { return f.result && f.result.hg != null ? (f.result.hg + ' - ' + f.result.ag) : null; }
  // IDÉNTICO a mStatusCell del Mundial: live pill / Full time / y en PRÓXIMO la HORA (no "Upcoming").
  function clubStatusCell(f) {
    var r = f.result;
    if (r && r.status === 'live') return '<span class="gx-live-pill">' + esc(t('st_live')) + (r.minute ? ' ' + r.minute + "'" : '') + '</span>';
    if (r && r.status === 'final') return '<span class="gx-dim" style="font-weight:600;font-size:11px">' + esc(t('st_ft')) + '</span>';
    return '<span class="gx-dim" style="font-size:11px">' + (f.utc ? esc(fmtTime(f.utc)) : esc(t('st_upcoming'))) + '</span>';
  }
  // SEÑAL de value del cruce (el WATCH/LEAN/STRONG del Mundial) derivada del value multi-liga (S.clubsValue):
  // mismo criterio de fuerza por edge. Sin value para el cruce → sin señal (igual que un partido del Mundial
  // sin evaluación canónica). Reusa sigBadge del Mundial.
  function clubSignal(f) {
    var rows = (S.clubsValue && S.clubsValue.rows) || [];
    var best = null;
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i];
      if (v.home === f.home.name && v.away === f.away.name && v.edge_pp > 0 && (best == null || v.edge_pp > best)) best = v.edge_pp;
    }
    if (best == null) return '';
    var sig = best >= 8 ? 'STRONG' : best >= 5 ? 'LEAN' : best >= 2.5 ? 'WATCH' : null;
    return sig ? sigBadge(sig) : '';
  }
  function clubBadge(id) { return clubLogo(id) || ic('shield-half'); }
  function clubRowHtml(L, f) {
    var oid = 'cl-' + L.key + '-' + f.home.id + '-' + f.away.id, sc = clubScore(f);
    return '<tr class="gx-row" data-openmatch="' + esc(oid) + '">' +
      '<td class="gx-time">' + (f.utc ? esc(fmtTime(f.utc)) : '<span class="gx-dim">·</span>') + '<div class="gx-dim" style="font-size:9.5px">' + esc(L.name.split(' · ')[0]) + '</div></td>' +
      '<td class="l"><div class="gx-cell-team">' + clubBadge(f.home.id) + '<div class="gx-teamnames"><b>' + esc(f.home.name) + '</b><span>' + esc(f.away.name) + '</span></div>' + clubBadge(f.away.id) + '</div></td>' +
      '<td class="l">' + (sc ? '<span class="gx-mono" style="font-weight:600">' + esc(sc) + '</span> ' : '') + clubStatusCell(f) + '</td>' +
      '<td>' + clubTriCell(f) + '</td>' +
      '<td class="l">' + (clubSignal(f) || '<span class="gx-dim" style="font-size:11px">—</span>') + '</td>' +
      '<td class="l"><span class="gx-dim">' + ic('chevron-right') + '</span></td></tr>';
  }
  function clubMatchesTable(L, rows) { return matchesTableHead() + rows.map(function (f) { return clubRowHtml(L, f); }).join('') + '</tbody></table>'; }
  // MISMO markup que wcCardHtml (partido del Mundial): estado + GP PROBABILITY con los 3 % + "Analizar partido →".
  function clubCardHtml(L, f) {
    var oid = 'cl-' + L.key + '-' + f.home.id + '-' + f.away.id, sc = clubScore(f);
    return '<div class="gx-mcard" data-openmatch="' + esc(oid) + '">' +
      '<div class="gx-mcard-top"><span class="gx-time">' + leagueLogo(L.key) + (f.utc ? esc(fmtTime(f.utc)) + ' · ' : '') + esc(L.name.split(' · ')[0]) + '</span><span class="gx-spacer"></span>' + (sc ? '<span class="gx-mono" style="font-weight:600;margin-right:8px">' + esc(sc) + '</span>' : '') + clubStatusCell(f) + '</div>' +
      '<div class="gx-cell-team" style="margin:8px 0">' + clubBadge(f.home.id) + '<div class="gx-teamnames"><b>' + esc(f.home.name) + '</b><span>' + esc(f.away.name) + '</span></div>' + clubBadge(f.away.id) + '</div>' +
      '<div class="gx-mcard-rows"><div><span class="gx-label">' + esc(t('th_gp')) + '</span>' + clubTriCell(f) + '</div></div>' +
      '<div class="gx-mcard-foot"><span>' + clubSignal(f) + '</span><span class="gx-mcard-cta">' + esc(t('cta_analyze')) + ' →</span></div>' +
      '</div>';
  }
  function clubMatchesCards(L, rows) { return rows.map(function (f) { return clubCardHtml(L, f); }).join(''); }
  // Vista TODOS (shadow): Mundial + todas las ligas en una sola línea de tiempo, intercalados por fecha.
  function renderAllCompMatches(mv) {
    var Ls = (S.clubs && S.clubs.leagues) || [];
    var tabs = [['all', 'all'], ['live', 'live_f'], ['up', 'upcoming_f'], ['fin', 'st_finished']];
    var q = (S.mQuery || '').toLowerCase();
    // Orden de la casa (Q1 4C#7): EN VIVO primero, próximos ASC (Mundial + clubes intercalados), finalizados
    // DESC — nunca abrir con partidos antiguos.
    var live = [], up = [], fin = [];
    matchRows().forEach(function (c) {
      var it = { dt: c.datetime, kind: 'wc', c: c };
      if (c.status === 'live') live.push(it); else if (c.status === 'final') fin.push(it); else up.push(it);
    });
    // partidos de clubes por bucket REAL (upcoming puede traer marcador vivo/final) — GATEADOS por el tab
    // activo (antes los finales de clubes se colaban en la pestaña "En vivo": el partido "frizado").
    Ls.forEach(function (L) {
      (L.upcoming || []).concat(L.live || [], L.finished || []).forEach(function (f) {
        if (q && (f.home.name + ' ' + f.away.name).toLowerCase().indexOf(q) < 0) return;
        var st = f.result && f.result.status; // undefined | 'live' | 'final'
        // RED DE SEGURIDAD (25-jul): sin marcador y con kickoff hace >3.5h el partido YA terminó — nunca
        // puede seguir en "Próximos" (el server ya lo filtra; esto cubre estado viejo cacheado en el cliente).
        if (!st && f.utc && new Date(f.utc).getTime() < Date.now() - 3.5 * 3600e3) return;
        var bucket = st === 'live' ? 'live' : st === 'final' ? 'fin' : 'up';
        if (S.mFilt !== 'all' && S.mFilt !== bucket) return;
        var it = { dt: f.utc, kind: 'cl', L: L, f: f };
        if (bucket === 'live') live.push(it); else if (bucket === 'fin') fin.push(it); else up.push(it);
      });
    });
    up.sort(function (a, b) { return new Date(a.dt || 0) - new Date(b.dt || 0); });
    fin.sort(function (a, b) { return new Date(b.dt || 0) - new Date(a.dt || 0); });
    var items = live.concat(up, fin);
    var head =
      '<div class="gx-ohead"><h1>' + esc(t('nav_matches')) + '</h1>' +
      '<div class="gx-seg" id="gx-mtabs">' + tabs.map(function (x) { return '<button data-f="' + x[0] + '"' + (S.mFilt === x[0] ? ' class="on"' : '') + '>' + esc(t(x[1])) + '</button>'; }).join('') + '</div>' +
      '<select class="gx-select" id="gx-mcomp"><option value="todos" selected>' + esc(t('cl_all_comps')) + '</option><option value="wc">' + esc(t('cl_wc')) + '</option>' + Ls.map(function (x) { return '<option value="' + esc(x.key) + '">' + esc(x.name.split(' · ')[0]) + (x.starts ? ' · ' + esc(x.starts) : '') + '</option>'; }).join('') + '</select>' +
      '<div class="gx-msearch">' + ic('search') + '<input id="gx-msearch-i" placeholder="' + esc(t('m_search')) + '" value="' + esc(S.mQuery) + '"></div>' +
      '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11.5px">' + items.length + ' ' + esc(t('matches')) + '</span></div>';
    var body;
    if (!items.length) body = '<div class="gx-panel"><div class="gx-empty">' + ic('calendar-off') + '<b>' + esc(t('m_empty')) + '</b></div></div>';
    else {
      var groups = [], gmap = {};
      items.forEach(function (it) { var k = dayKey(it.dt); if (!gmap[k]) { gmap[k] = { k: k, label: dayLabel(it.dt), items: [] }; groups.push(gmap[k]); } gmap[k].items.push(it); });
      body = groups.map(function (g) {
        var trs = g.items.map(function (it) { return it.kind === 'wc' ? wcRowHtml(it.c) : clubRowHtml(it.L, it.f); }).join('');
        var cards = g.items.map(function (it) { return it.kind === 'wc' ? wcCardHtml(it.c) : clubCardHtml(it.L, it.f); }).join('');
        return '<div class="gx-mgroup"><div class="gx-mgroup-h"><span>' + esc(g.label) + '</span><span class="gx-dim">' + g.items.length + '</span></div>' +
          '<div class="gx-panel gx-board gx-matches-desk">' + matchesTableHead() + trs + '</tbody></table></div>' +
          '<div class="gx-matches-mob">' + cards + '</div></div>';
      }).join('');
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + head + body + '</div></div>';
    bindMatches();
  }
  function renderMatches() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (clubsOn()) loadClubs();
    // COMPETICIÓN seleccionada (shadow clubes): 'wc' = Mundial (comportamiento de siempre); 'todos' =
    // Mundial + ligas intercalados por fecha; una liga = su cartelera. DEFAULT = 'todos' (pedido de Alexis:
    // Partidos abre con todas las competiciones, no con el Mundial).
    if (clubsOn() && S.mComp == null) S.mComp = 'todos';
    if (clubsOn() && S.mComp === 'todos') { renderAllCompMatches(mv); return; }
    if (clubsOn() && S.mComp && S.mComp !== 'wc') { renderClubLeagueMatches(mv); return; }
    var rows = matchRows();
    var stages = []; S.cal.forEach(function (c) { if (c.stage && stages.indexOf(c.stage) < 0) stages.push(c.stage); });
    var tabs = [['all', 'all'], ['live', 'live_f'], ['up', 'upcoming_f'], ['fin', 'st_finished']];
    var head =
      '<div class="gx-ohead"><h1>' + esc(t('nav_matches')) + '</h1>' +
      '<div class="gx-seg" id="gx-mtabs">' + tabs.map(function (x) { return '<button data-f="' + x[0] + '"' + (S.mFilt === x[0] ? ' class="on"' : '') + '>' + esc(t(x[1])) + '</button>'; }).join('') + '</div>' +
      (clubsOn() ? '<select class="gx-select" id="gx-mcomp"><option value="todos">' + esc(t('cl_all_comps')) + '</option><option value="wc" selected>' + esc(t('cl_wc')) + '</option>' + ((S.clubs && S.clubs.leagues) || []).map(function (L) { return '<option value="' + esc(L.key) + '"' + (S.mComp === L.key ? ' selected' : '') + '>' + esc(L.name.split(' · ')[0]) + (L.starts ? ' · ' + esc(L.starts) : '') + '</option>'; }).join('') + '</select>' : '') +
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
  // Cartelera de UNA liga de clubes dentro de la vista Partidos (shadow). Mismo shell: tabs de estado,
  // selector de competición, buscador; filas con el markup de la casa. En vivo/finalizados de clubes llegan
  // con la integración de marcadores (nota honesta mientras tanto).
  function renderClubLeagueMatches(mv) {
    var L = clubLeague(S.mComp);
    var Ls = (S.clubs && S.clubs.leagues) || [];
    var tabs = [['all', 'all'], ['live', 'live_f'], ['up', 'upcoming_f'], ['fin', 'st_finished']];
    var q = (S.mQuery || '').toLowerCase();
    // combinar live/finalizados (L.live + L.finished persistentes) con próximos (L.upcoming); marcador en f.result
    var liveRows = L ? (L.live || []) : [], upRows = L ? (L.upcoming || []) : [], finRows = L ? (L.finished || []) : [];
    // misma red de seguridad que la vista "todas": sin marcador y kickoff hace >3.5h ⇒ ya se jugó, fuera de Próximos
    upRows = upRows.filter(function (f) { return !(!(f.result && f.result.status) && f.utc && new Date(f.utc).getTime() < Date.now() - 3.5 * 3600e3); });
    var all = liveRows.concat(upRows, finRows);
    if (S.mFilt === 'live') all = liveRows.concat(upRows).filter(function (f) { return f.result && f.result.status === 'live'; });
    else if (S.mFilt === 'fin') all = liveRows.concat(upRows).filter(function (f) { return f.result && f.result.status === 'final'; }).concat(finRows);
    else if (S.mFilt === 'up') all = upRows.filter(function (f) { return !(f.result && f.result.status); });
    var rows = all.filter(function (f) { return !q || (f.home.name + ' ' + f.away.name).toLowerCase().indexOf(q) >= 0; });
    var head =
      '<div class="gx-ohead"><h1>' + esc(t('nav_matches')) + '</h1>' +
      '<div class="gx-seg" id="gx-mtabs">' + tabs.map(function (x) { return '<button data-f="' + x[0] + '"' + (S.mFilt === x[0] ? ' class="on"' : '') + '>' + esc(t(x[1])) + '</button>'; }).join('') + '</div>' +
      '<select class="gx-select" id="gx-mcomp"><option value="todos">' + esc(t('cl_all_comps')) + '</option><option value="wc">' + esc(t('cl_wc')) + '</option>' + Ls.map(function (x) { return '<option value="' + esc(x.key) + '"' + (S.mComp === x.key ? ' selected' : '') + '>' + esc(x.name.split(' · ')[0]) + (x.starts ? ' · ' + esc(x.starts) : '') + '</option>'; }).join('') + '</select>' +
      '<div class="gx-msearch">' + ic('search') + '<input id="gx-msearch-i" placeholder="' + esc(t('m_search')) + '" value="' + esc(S.mQuery) + '"></div>' +
      '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11.5px">' + rows.length + ' ' + esc(t('matches')) + '</span></div>';
    var meta = L ? '<div class="gx-panel" style="padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' + leagueLogo(L.key) + clubGateChip(L.gate) + '<span class="gx-dim" style="font-size:11.5px">' + esc(L.name) + ' · ' + esc(L.country) + ' · ' + esc(t('cl_hfa')) + ' +' + L.hfa + ' Elo · ' + L.n_matches + ' ' + esc(t('matches')) + '</span></div>' : '';
    var body;
    if (!L) body = '<div class="gx-panel"><div class="gx-empty">' + ic('loader-2') + '<b>…</b></div></div>';
    else if (!rows.length) body = '<div class="gx-panel"><div class="gx-empty">' + ic('calendar-off') + '<b>' + esc(S.mFilt === 'live' ? t('cl_no_live') : S.mFilt === 'fin' ? t('cl_no_final') : (L.starts ? t('cl_preseason') : t('m_empty'))) + '</b></div></div>';
    else {
      // los partidos en vivo/finalizados (sin utc) van a un grupo "En juego / recientes" arriba; el resto por día
      var groups = [], gmap = {}, liveG = null;
      rows.forEach(function (f) {
        if (!f.utc || (f.result && (f.result.status === 'live' || f.result.status === 'final'))) { if (!liveG) { liveG = { k: '_live', label: t('cl_live_recent'), rows: [] }; groups.push(liveG); } liveG.rows.push(f); return; }
        var k = dayKey(f.utc); if (!gmap[k]) { gmap[k] = { k: k, label: dayLabel(f.utc), rows: [] }; groups.push(gmap[k]); } gmap[k].rows.push(f);
      });
      body = groups.map(function (g) {
        return '<div class="gx-mgroup"><div class="gx-mgroup-h"><span>' + esc(g.label) + '</span><span class="gx-dim">' + g.rows.length + '</span></div>' +
          '<div class="gx-panel gx-board gx-matches-desk">' + clubMatchesTable(L, g.rows) + '</div>' +
          '<div class="gx-matches-mob">' + clubMatchesCards(L, g.rows) + '</div></div>';
      }).join('');
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + head + meta + body + '</div></div>';
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
  function matchesTableHead() {
    return '<table class="gx-table"><thead><tr><th class="l">' + esc(t('th_time')) + '</th><th class="l">' + esc(t('th_match')) + '</th><th class="l">' + esc(t('th_state')) + '</th><th class="grp">' + esc(t('th_gp')) + '</th><th class="l">' + esc(t('th_signal')) + '</th><th></th></tr></thead><tbody>';
  }
  function wcRowHtml(c) {
    var canon = canonFor(c), sc = mScore(c), oid = canon ? canon.event_id : 'fx-' + c.id;
    return '<tr class="gx-row" data-openmatch="' + esc(oid) + '">' +
      '<td class="gx-time">' + esc(fmtTime(c.datetime)) + '<div class="gx-dim" style="font-size:9.5px">' + esc(stageLabel(c.stage)) + '</div></td>' +
      '<td class="l"><div class="gx-cell-team"><span class="fl">' + flag(c.home) + '</span><div class="gx-teamnames"><b>' + esc(teamName(c.home)) + '</b><span>' + esc(teamName(c.away)) + '</span></div><span class="fl">' + flag(c.away) + '</span></div></td>' +
      '<td class="l">' + (sc ? '<span class="gx-mono" style="font-weight:600">' + esc(sc) + '</span> ' : '') + mStatusCell(c) + '</td>' +
      '<td>' + mGpCell(canon, c) + '</td>' +
      '<td class="l">' + mSignalCell(canon) + '</td>' +
      '<td class="l"><span class="gx-dim">' + ic('chevron-right') + '</span></td></tr>';
  }
  function matchesTable(rows) { return matchesTableHead() + rows.map(wcRowHtml).join('') + '</tbody></table>'; }
  function matchesCards(rows) { return rows.map(wcCardHtml).join(''); }
  function wcCardHtml(c) {
    return [c].map(function (c) {
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
    var mc = $('#gx-mcomp'); if (mc) mc.addEventListener('change', function () { setCompHash('matches', mc.value, 'todos'); });
    var si = $('#gx-msearch-i'); if (si) si.addEventListener('input', function () { S.mQuery = si.value; clearTimeout(S._mq); S._mq = setTimeout(function () { var pos = si.selectionStart; renderMatches(); var n = $('#gx-msearch-i'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } }, 220); });
  }

  // ================= Simulador premium (Corte 3C) =================
  function teamOptions(sel) { return '<option value="">' + esc(t('sim_pick')) + '</option>' + S.stTeams.slice().sort(function (a, b) { return teamName(a.id).localeCompare(teamName(b.id)); }).map(function (tm) { return '<option value="' + esc(tm.id) + '"' + (sel === tm.id ? ' selected' : '') + '>' + esc(teamName(tm.id, tm.name)) + '</option>'; }).join(''); }
  function renderSim() {
    var mv = $('#gx-matchview'); if (!mv) return;
    // esperar a /api/me en la carga directa a #sim (sin esto el selector de competición no aparecía para admin)
    if (S.me == null) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + mvLoading() + '</div></div>'; setTimeout(function () { if (S.view === 'sim') renderSim(); }, 500); return; }
    if (clubsOn()) loadClubs();
    var s = S.sim;
    // SELECTOR DE COMPETICIÓN por lado (clubes shadow): Mundial + ligas — cualquier club de cualquier liga vs
    // cualquier otro (cross-liga = cancha neutral, endpoint /api/clubs/match). Mundial-vs-club NO es comparable
    // (fits independientes) → Run deshabilitado con nota. Sin clubs_shadow todo queda byte-idéntico.
    s.aComp = s.aComp || 'wc'; s.bComp = s.bComp || 'wc';
    var compOptions = function (sel2) {
      var Ls = ((S.clubs || {}).leagues) || [];
      return '<option value="wc"' + (sel2 === 'wc' ? ' selected' : '') + '>' + esc(t('cl_wc')) + '</option>' +
        Ls.map(function (L) { return '<option value="' + esc(L.key) + '"' + (sel2 === L.key ? ' selected' : '') + '>' + esc(L.name.split(' · ')[0]) + '</option>'; }).join('');
    };
    var sideTeamOptions = function (comp, sel2) {
      if (comp === 'wc') return teamOptions(sel2);
      var L = clubLeague(comp); if (!L) return '<option value="">…</option>';
      return '<option value="">' + esc(t('sim_pick_team')) + '</option>' + (L.table || []).map(function (tm) { return '<option value="' + esc(tm.id) + '"' + (tm.id === sel2 ? ' selected' : '') + '>' + esc(tm.name) + '</option>'; }).join('');
    };
    var mixed = clubsOn() && ((s.aComp === 'wc') !== (s.bComp === 'wc'));
    var ready = s.a && s.b && s.a !== s.b && !mixed;
    var sideHtml = function (key, comp, id) {
      return '<div class="gx-sim-team"><span class="fl big">' + (id ? flag(id) : '🏳️') + '</span>' +
        (clubsOn() ? '<select class="gx-select" id="gx-sim-' + key + 'c" style="margin-bottom:6px">' + compOptions(comp) + '</select>' : '') +
        '<select class="gx-select" id="gx-sim-' + key + '">' + sideTeamOptions(comp, id) + '</select>' + simElo(id, comp) + '</div>';
    };
    var picker =
      '<div class="gx-panel gx-sim-picker"><div class="gx-ph"><span class="gx-label">' + ic('arrows-shuffle') + esc(t('nav_sim')) + '</span></div>' +
      '<div class="gx-sim-row">' +
      sideHtml('a', s.aComp, s.a) +
      '<button class="gx-sim-swap" id="gx-sim-swap" title="' + esc(t('sim_swap')) + '">' + ic('arrows-left-right') + '</button>' +
      sideHtml('b', s.bComp, s.b) +
      '</div>' +
      '<button class="gx-btn gx-sim-go" id="gx-sim-go"' + (ready ? '' : ' disabled') + '>' + (s.loading ? ic('loader-2') + esc(t('sim_running')) : ic('player-play') + ' ' + esc(t('sim_go'))) + '</button>' +
      (mixed ? '<div class="gx-sim-hypo" style="color:var(--gx-warn)">' + ic('alert-triangle') + esc(t('sim_no_mix')) + '</div>' : '<div class="gx-sim-hypo">' + ic('flask') + esc(t('sim_hypo')) + '</div>') +
      '</div>';
    var result = s.data ? (s.data._club ? simResultClub(s.data) : simResult(s.data)) : (s.loading ? '<div class="gx-panel"><div class="gx-empty">' + ic('loader-2') + esc(t('sim_running')) + '</div></div>' : '<div class="gx-panel"><div class="gx-empty">' + ic('arrows-shuffle') + '<b>' + esc(t('sim_empty')) + '</b>' + esc(t('sim_empty_sub')) + '</div></div>');
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:16px;max-width:1080px;margin:0 auto">' + picker + result + '</div></div>';
    bindSim();
  }
  function simElo(id, comp) {
    if (!id) return '';
    if (comp && comp !== 'wc') { var L = clubLeague(comp); var tm2 = L ? (L.table || []).filter(function (x) { return x.id === id; })[0] : null; return tm2 ? '<span class="gx-sim-elo gx-mono">Elo ' + Math.round(tm2.elo) + '</span>' : ''; }
    var tm = (S.stTeams || []).filter(function (x) { return x.id === id; })[0]; if (!tm) return '';
    return '<span class="gx-sim-elo gx-mono">Elo ' + Math.round(tm.currentElo || tm.elo || 0) + '</span>';
  }
  function bindSim() {
    var a = $('#gx-sim-a'), b = $('#gx-sim-b'), sw = $('#gx-sim-swap'), go = $('#gx-sim-go');
    var ac = $('#gx-sim-ac'), bc = $('#gx-sim-bc');
    if (ac) ac.addEventListener('change', function () { S.sim.aComp = ac.value; S.sim.a = null; S.sim.data = null; renderSim(); });
    if (bc) bc.addEventListener('change', function () { S.sim.bComp = bc.value; S.sim.b = null; S.sim.data = null; renderSim(); });
    if (a) a.addEventListener('change', function () { S.sim.a = a.value || null; renderSim(); });
    if (b) b.addEventListener('change', function () { S.sim.b = b.value || null; renderSim(); });
    if (sw) sw.addEventListener('click', function () { var t0 = S.sim.a, c0 = S.sim.aComp; S.sim.a = S.sim.b; S.sim.aComp = S.sim.bComp; S.sim.b = t0; S.sim.bComp = c0; renderSim(); });
    if (go) go.addEventListener('click', runSim);
  }
  function runSim() {
    var s = S.sim; if (!s.a || !s.b || s.a === s.b || s.loading) return;
    var isClub = clubsOn() && (s.aComp !== 'wc' || s.bComp !== 'wc');
    if (isClub && ((s.aComp === 'wc') !== (s.bComp === 'wc'))) return; // Mundial vs club: no comparable
    s.loading = true; s.data = null; renderSim();
    if (isClub) {
      // cross-liga entre CLUBES: mismo endpoint del cockpit (cancha neutral si las ligas difieren)
      fetch('/api/clubs/match?hl=' + encodeURIComponent(s.aComp) + '&h=' + encodeURIComponent(s.a) + '&al=' + encodeURIComponent(s.bComp) + '&a=' + encodeURIComponent(s.b) + '&neutral=1', { headers: hdrs() })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (d) { s.loading = false; s.data = d ? Object.assign({ _club: true }, d) : { _err: true, _club: true }; renderSim(); });
      return;
    }
    fetch('/api/h2h/deep?a=' + encodeURIComponent(s.a) + '&b=' + encodeURIComponent(s.b), { headers: hdrs() })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (d) { s.loading = false; s.data = d || { _err: true }; renderSim(); });
  }
  // RESULTADO del cruce hipotético entre CLUBES (cross-liga): panel de inteligencia con el shape de /api/clubs/match.
  function simResultClub(d) {
    if (!d || d._err || !d.probs) return '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('sim_err')) + '</b></div></div>';
    var pH = d.probs.home || 0, pD = d.probs.draw || 0, pA = d.probs.away || 0;
    var mini = function (label, v) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + v + '</b></div>'; };
    var gi = d.goal_insights || {};
    var scores = (gi.top_scores || d.top_scores || []).slice(0, 3).map(function (x) { return '<span class="gx-badge" style="font-size:11px">' + esc(x.score) + ' · ' + pct0(x.probability != null ? x.probability : x.p) + '</span>'; }).join(' ');
    return '<div class="gx-panel gx-hero">' +
      '<div class="gx-hero-meta">' + ic('flask') + esc(t('sim_hypo')) + '<span class="gx-spacer"></span>' + (d.cross_league ? '<span class="gx-clgate sh">' + esc(t('cl_neutral')).toUpperCase() + '</span>' : '') + '</div>' +
      '<div class="gx-hero-teams">' +
      '<div class="gx-hero-side"><span class="fl">' + flag(d.home.id) + '</span><b>' + esc(d.home.name) + '</b><span class="gx-dim gx-mono" style="font-size:10.5px">' + esc(d.home.league_name || '') + ' · Elo ' + d.home.elo + '</span></div>' +
      '<div class="gx-hero-mid"><div class="gx-hero-vs">' + esc(t('vs')) + '</div></div>' +
      '<div class="gx-hero-side"><span class="fl">' + flag(d.away.id) + '</span><b>' + esc(d.away.name) + '</b><span class="gx-dim gx-mono" style="font-size:10.5px">' + esc(d.away.league_name || '') + ' · Elo ' + d.away.elo + '</span></div>' +
      '</div>' +
      '<div class="gx-pbar"><i class="h" style="width:' + (pH * 100) + '%"></i><i class="d" style="width:' + (pD * 100) + '%"></i><i class="a" style="width:' + (pA * 100) + '%"></i></div>' +
      '<div class="gx-plabels"><span>' + esc(d.home.name) + ' <b>' + pct0(pH) + '</b></span><span>X <b>' + pct0(pD) + '</b></span><span>' + esc(d.away.name) + ' <b>' + pct0(pA) + '</b></span></div>' +
      '<div class="gx-hero-grid">' +
      mini(t('hero_xg'), d.xg ? (Number(d.xg.home).toFixed(2) + ' – ' + Number(d.xg.away).toFixed(2)) : '—') +
      mini(t('cl_o25'), d.over25 != null ? pct0(d.over25) : '—') +
      mini(t('cl_btts'), d.btts != null ? pct0(d.btts) : '—') +
      (scores ? '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('hero_scores')) + '</span><span style="display:flex;gap:5px;flex-wrap:wrap">' + scores + '</span></div>' : '') +
      '</div>' +
      (d.cross_league ? '<div class="gx-hero-note gx-dim">' + esc(t('cl_cross')) + '</div>' : '<div class="gx-hero-note gx-dim">' + esc(t('period_90')) + '</div>') +
      '</div>';
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
      var line = function (f, id) { if (!f || !f.played) return ''; return t(f.goalsFor != null && f.goalsAgainst != null ? 'ctx_form_line' : 'ctx_form_line_short', { team: '<b>' + esc(teamName(id)) + '</b>', rec: esc(formStr(f.results)), n: f.played, gf: f.goalsFor, ga: f.goalsAgainst }); };
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
    if (clubsOn()) loadClubs();
    // FASE CLUBES: selector de competición en Equipos ("clubes o selecciones") — mismo patrón que Partidos
    var tsel = clubsOn()
      ? '<select class="gx-select" id="gx-tcomp"><option value="wc"' + (!S.tComp || S.tComp === 'wc' ? ' selected' : '') + '>' + esc(t('cl_wc')) + '</option>' + ((S.clubs && S.clubs.leagues) || []).map(function (L) { return '<option value="' + esc(L.key) + '"' + (S.tComp === L.key ? ' selected' : '') + '>' + esc(L.name.split(' · ')[0]) + (L.starts ? ' · ' + esc(L.starts) : '') + '</option>'; }).join('') + '</select>'
      : '';
    if (clubsOn() && S.tComp && S.tComp !== 'wc') { renderClubTeamsList(mv, tsel); return; }
    var teams = S.stTeams.slice().filter(function (t) { return t.sim; }).sort(function (a, b) { return (b.sim.champion || 0) - (a.sim.champion || 0); });
    if (S.tQuery) { var q = S.tQuery.toLowerCase(); teams = teams.filter(function (t) { return (teamName(t.id) + ' ' + t.id).toLowerCase().indexOf(q) >= 0; }); }
    var maxCh = (teams[0] && teams[0].sim.champion) || 1;
    var head = viewHead(t('nav_teams'), tsel + '<div class="gx-msearch">' + ic('search') + '<input id="gx-tsearch-i" placeholder="' + esc(t('m_search')) + '" value="' + esc(S.tQuery || '') + '"></div><span class="gx-spacer"></span><span class="gx-dim" style="font-size:11.5px">' + teams.length + ' ' + esc(t('nav_teams').toLowerCase()) + '</span>');
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
    wireTeamComp();
  }
  function wireTeamComp() {
    var sel = $('#gx-tcomp'); if (sel) sel.addEventListener('change', function () { S.tQuery = ''; setCompHash('teams', sel.value, 'wc'); });
  }
  // FASE CLUBES: tabla de equipos de una liga (standings + Elo del modelo). Click → perfil de club (cteam/).
  function renderClubTeamsList(mv, tsel) {
    var L = clubLeague(S.tComp);
    if (!S.clubs) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + mvLoading() + '</div></div>'; return; }
    if (!L) { S.tComp = 'wc'; renderTeams(); return; }
    var elo = {}; (L.table || []).forEach(function (x) { elo[x.id] = x.elo; });
    var hasSt = (L.standings || []).length > 0;
    var rows = hasSt
      ? L.standings.map(function (s, i) { return { id: s.id, name: s.name, pos: i + 1, pts: s.pts, pj: s.pj, dif: (s.gf != null && s.ga != null) ? s.gf - s.ga : null, elo: elo[s.id] || null }; })
      : (L.table || []).map(function (x, i) { return { id: x.id, name: x.name, pos: i + 1, pts: null, pj: null, dif: null, elo: x.elo }; });
    if (S.tQuery) { var q = S.tQuery.toLowerCase(); rows = rows.filter(function (r) { return (r.name || '').toLowerCase().indexOf(q) >= 0; }); }
    var head = viewHead(t('nav_teams'), tsel + '<div class="gx-msearch">' + ic('search') + '<input id="gx-tsearch-i" placeholder="' + esc(t('m_search')) + '" value="' + esc(S.tQuery || '') + '"></div><span class="gx-spacer"></span>' + clubGateChip(L.gate) + '<span class="gx-dim" style="font-size:11.5px">' + rows.length + ' ' + esc(t('nav_teams').toLowerCase()) + '</span>');
    var trs = rows.map(function (r) {
      return '<tr class="gx-row" data-nav-cteam="' + esc(L.key + '|' + r.id) + '">' +
        '<td class="gx-dim gx-mono l" style="width:30px">' + r.pos + '</td>' +
        '<td class="l"><div class="gx-cell-team">' + clubBadge(r.id) + '<b>' + esc(r.name) + '</b></div></td>' +
        (hasSt ? '<td class="gx-mono gx-dim">' + (r.pj != null ? r.pj : '·') + '</td><td class="gx-mono">' + (r.pts != null ? r.pts : '·') + '</td><td class="gx-mono gx-dim">' + (r.dif != null ? (r.dif > 0 ? '+' : '') + r.dif : '·') + '</td>' : '') +
        '<td class="gx-mono">' + (r.elo != null ? Math.round(r.elo) : '<span class="gx-dim">' + esc(t('cl_new')) + '</span>') + '</td>' +
        '<td class="l"><span class="gx-dim">' + ic('chevron-right') + '</span></td></tr>';
    }).join('');
    var note = L.starts ? '<div class="gx-arb-warn" style="margin-bottom:10px">' + ic('info-circle') + esc(t('cl_preseason')) + '</div>' : '';
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + head + note +
      '<div class="gx-panel gx-board"><table class="gx-table"><thead><tr><th class="l">#</th><th class="l">' + esc(t('nav_teams')) + '</th>' + (hasSt ? '<th>' + esc(t('cl_pj')) + '</th><th>' + esc(t('cl_pts')) + '</th><th>' + esc(t('cl_dif')) + '</th>' : '') + '<th>Elo</th><th></th></tr></thead><tbody>' + trs + '</tbody></table></div></div></div>';
    var si = $('#gx-tsearch-i'); if (si) si.addEventListener('input', function () { S.tQuery = si.value; clearTimeout(S._tq); S._tq = setTimeout(function () { var p = si.selectionStart; renderTeams(); var n = $('#gx-tsearch-i'); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (e) {} } }, 220); });
    wireTeamComp();
    [].forEach.call(mv.querySelectorAll('[data-nav-cteam]'), function (el) {
      el.addEventListener('click', function () { var pp = el.getAttribute('data-nav-cteam').split('|'); openClubTeam(pp[0], pp[1]); });
    });
  }
  // Perfil de CLUB (shadow): Elo + posición + próximos partidos de la liga (clickeables → cockpit cl-).
  function openClubTeam(lg, id, fromHash) {
    if (!lg || !id) return;
    if (!fromHash) setHash('cteam/' + lg + '-' + id);
    S.view = 'cteam'; S.cteamLg = lg; S.cteamId = id; S.cteamTab = 'resumen';
    applyView(); syncNavActive(); try { window.scrollTo(0, 0); } catch (e) {}
    renderClubTeam();
  }
  function renderClubTeam() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (clubsOn()) loadClubs();
    if (!S.clubs) { mv.innerHTML = mvShell(mvLoading()); bindBack(); setTimeout(function () { if (S.view === 'cteam') renderClubTeam(); }, 800); return; }
    var lg = S.cteamLg, id = S.cteamId, L = clubLeague(lg);
    if (!L) { mv.innerHTML = mvShell('<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('match_404')) + '</b></div></div>'); bindBack(); return; }
    var tbl = (L.table || []); var me = null, rank = null;
    for (var i = 0; i < tbl.length; i++) if (tbl[i].id === id) { me = tbl[i]; rank = i + 1; break; }
    var st = (L.standings || []).find(function (s) { return s.id === id; }) || null;
    var pos = st ? (L.standings.indexOf(st) + 1) : null;
    var name = (me && me.name) || (st && st.name) || id;
    var hero = '<div class="gx-panel gx-hero gx-team-hero"><div class="gx-hero-meta">' + leagueLogo(L.key) + esc(L.name) + '<span class="gx-spacer"></span>' + clubGateChip(L.gate) + '</div>' +
      '<div class="gx-team-id"><span class="fl big">' + clubBadge(id) + '</span><div><b>' + esc(name) + '</b><span class="gx-mono gx-dim">' + (me ? 'Elo ' + Math.round(me.elo) + (rank ? ' · #' + rank + ' ' + esc(t('cl_of')) + ' ' + tbl.length : '') : esc(t('cl_new'))) + '</span></div></div>' +
      (st ? '<div class="gx-hero-grid">' +
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('cl_pos')) + '</span><b class="gx-mono">' + pos + '°</b></div>' +
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('cl_pts')) + '</span><b class="gx-mono">' + st.pts + '</b></div>' +
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('cl_record')) + '</span><b class="gx-mono">' + st.w + '-' + st.d + '-' + st.l + '</b></div>' +
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('cl_goals')) + '</span><b class="gx-mono">' + st.gf + ':' + st.ga + '</b></div>' +
        '</div>' : '') + '</div>';
    var ups = (L.upcoming || []).filter(function (f) { return f.home.id === id || f.away.id === id; });
    var upHtml;
    if (L.starts) upHtml = '<div class="gx-empty">' + ic('calendar') + esc(t('cl_preseason')) + '</div>';
    else if (!ups.length) upHtml = '<div class="gx-empty">' + ic('calendar') + esc(t('cl_no_upcoming')) + '</div>';
    else upHtml = ups.map(function (f) {
      var oid = 'cl-' + L.key + '-' + f.home.id + '-' + f.away.id;
      var probMe = f.home.id === id ? f.home.prob : f.away.prob;
      return '<div class="gx-clrow gx-pick-clickable" data-openmatch="' + esc(oid) + '" style="cursor:pointer"><span>' + esc(fmtDateTime(f.utc)) + ' · <b>' + esc(f.home.name) + '</b> ' + esc(t('vs')) + ' <b>' + esc(f.away.name) + '</b></span><span class="gx-mono" style="font-weight:700">' + pct0(probMe) + '</span></div>';
    }).join('');
    // PLANTILLA: lazy-load del roster (TSA) por equipo → jugadores por línea, clickeables al perfil de jugador.
    S.csquad = S.csquad || {};
    var sqKey = lg + '|' + id;
    if (S.csquad[sqKey] === undefined) {
      S.csquad[sqKey] = null;
      fetch('/api/clubs/squad?league=' + encodeURIComponent(lg) + '&team=' + encodeURIComponent(id), { headers: hdrs() })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { S.csquad[sqKey] = j || { players: [] }; if (S.view === 'cteam' && S.cteamId === id) renderClubTeam(); });
    }
    var sq = S.csquad[sqKey];
    var squadHtml;
    if (sq === null) squadHtml = '<div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div>';
    else if (!sq.players || !sq.players.length) squadHtml = '<div class="gx-empty">' + ic('users') + esc(t('cl_no_squad')) + '</div>';
    else {
      var GRP = [['GK', t('cl_gk')], ['DEF', t('cl_def')], ['MID', t('cl_mid')], ['FWD', t('cl_fwd')], ['OTH', '—']];
      squadHtml = GRP.map(function (g) {
        var ps = sq.players.filter(function (p) { return p.group === g[0]; });
        if (!ps.length) return '';
        return '<div class="gx-sqgrp"><div class="gx-sqgrp-h">' + esc(g[1]) + '</div>' + ps.map(function (p) {
          return '<div class="gx-clrow gx-pick-clickable" data-cplayer="' + esc(lg + '|' + id + '|' + p.pid) + '" style="cursor:pointer">' +
            '<span><b>' + esc(p.name) + '</b>' + (p.nat ? ' <span class="gx-dim" style="font-size:10.5px">· ' + esc(p.nat) + '</span>' : '') + '</span>' +
            '<span class="gx-mono gx-dim" style="font-size:11px">' + (p.age != null ? p.age + esc(t('cl_yr')) : '') + (p.value ? ' · ' + clubMoney(p.value) : '') + '</span></div>';
        }).join('') + '</div>';
      }).join('');
    }
    // FORMA + RESULTADOS: lazy-load de team-form (results-<liga>.json vía server).
    S.cform = S.cform || {};
    if (S.cform[sqKey] === undefined) {
      S.cform[sqKey] = null;
      fetch('/api/clubs/team-form?league=' + encodeURIComponent(lg) + '&team=' + encodeURIComponent(id), { headers: hdrs() })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (j) { S.cform[sqKey] = j || { form: [], results: [] }; if (S.view === 'cteam' && S.cteamId === id) renderClubTeam(); });
    }
    var fm = S.cform[sqKey];
    // TABS (paridad con la vista de equipo del Mundial: Resumen/Plantilla/Forma/Resultados)
    var tab = S.cteamTab || 'resumen';
    var TABS = [['resumen', t('cl_tab_summary')], ['plantilla', t('cl_squad')], ['forma', t('cl_tab_form')], ['resultados', t('cl_tab_results')], ['noticias', t('news_title')]];
    var tabNav = '<nav class="gx-mv-nav" id="gx-cteam-tabs">' + TABS.map(function (x) { return '<a data-cttab="' + x[0] + '"' + (x[0] === tab ? ' class="on"' : '') + '>' + esc(x[1]) + '</a>'; }).join('') + '</nav>';
    // forma como chips W/D/L
    var formChips = function (arr) { return (arr || []).map(function (r) { var c = r === 'W' ? 'var(--gx-pos)' : r === 'L' ? '#F09595' : 'var(--gx-text3)'; return '<span style="display:inline-flex;width:22px;height:22px;border-radius:5px;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#06231A;background:' + c + ';margin-right:4px">' + esc(r) + '</span>'; }).join(''); };
    var body;
    if (tab === 'plantilla') {
      body = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + ic('users') + esc(t('cl_squad')) + (sq && sq.players ? ' <span class="gx-dim">· ' + sq.players.length + '</span>' : '') + '</span></div><div style="padding:6px 16px 12px">' + squadHtml + '</div></div>';
    } else if (tab === 'forma') {
      if (fm === null) body = '<div class="gx-panel"><div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div></div>';
      else if (!(fm.results || []).length) body = '<div class="gx-panel"><div class="gx-empty">' + ic('calendar-off') + esc(t('cl_no_results')) + '</div></div>';
      else body = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + ic('activity') + esc(t('cl_tab_form')) + '</span><span class="gx-ph-extra">' + formChips(fm.form) + '</span></div><div style="padding:6px 16px 12px">' +
        fm.results.slice(0, 5).map(function (r) {
          var rc = r.res === 'W' ? 'gx-pos' : r.res === 'L' ? 'gx-neg' : 'gx-dim';
          return '<div class="gx-clrow"><span>' + esc(fmtDate(r.date)) + ' · ' + (r.home ? '' : '@ ') + '<b>' + esc(String(r.opp).split(' · ')[0]) + '</b></span><span class="gx-mono ' + rc + '" style="font-weight:700">' + r.gf + '-' + r.ag + ' ' + r.res + '</span></div>';
        }).join('') + '</div></div>';
    } else if (tab === 'resultados') {
      if (fm === null) body = '<div class="gx-panel"><div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div></div>';
      else if (!(fm.results || []).length) body = '<div class="gx-panel"><div class="gx-empty">' + ic('calendar-off') + esc(t('cl_no_results')) + '</div></div>';
      else body = '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + ic('list-numbers') + esc(t('cl_tab_results')) + '</span></div><table class="gx-table"><thead><tr><th class="l">' + esc(t('cl_date')) + '</th><th class="l">' + esc(t('cl_opp')) + '</th><th>' + esc(t('cl_local')) + '</th><th>' + esc(t('cl_score')) + '</th><th></th></tr></thead><tbody>' +
        fm.results.map(function (r) {
          var rc = r.res === 'W' ? 'gx-pos' : r.res === 'L' ? 'gx-neg' : 'gx-dim';
          return '<tr class="gx-row" data-nav-cteam="' + esc(lg + '|' + r.opp_id) + '"><td class="l gx-dim" style="font-size:10.5px">' + esc(fmtDate(r.date)) + '</td><td class="l">' + esc(String(r.opp).split(' · ')[0]) + '</td><td class="gx-mono gx-dim">' + (r.home ? esc(t('cl_home_h')) : esc(t('cl_away_a'))) + '</td><td class="gx-mono" style="font-weight:700">' + r.gf + '-' + r.ag + '</td><td class="gx-mono ' + rc + '" style="font-weight:800">' + r.res + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (tab === 'noticias') {
      // News = hallazgos de disponibilidad del observer (caja negra, sin fuente), como el News/Context del Mundial.
      var av = (fm && fm.news) || [];
      if (fm === null) body = '<div class="gx-panel"><div class="gx-empty">' + ic('loader-2') + esc(t('loading')) + '</div></div>';
      else if (!av.length) body = '<div class="gx-panel"><div class="gx-empty">' + ic('news') + esc(t('cl_no_news')) + '</div></div>';
      else body = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('news') + esc(t('news_title')) + '</span></div><div class="gx-findings" style="padding:10px 16px 12px">' +
        av.map(function (f) {
          var col = (f.status === 'OUT' || f.status === 'SUSPENDED') ? '#F09595' : f.status === 'DOUBT' ? 'var(--gx-warn)' : 'var(--gx-text3)';
          return '<div class="gx-finding"><span class="gx-finding-dot" style="background:' + col + '"></span><span>' + esc(LANG === 'en' ? f.en : f.es) + '</span></div>';
        }).join('') + '</div></div>';
    } else { // resumen: proyección de temporada (campeón/top/descenso, paridad Mundial) + próximos partidos
      var seasonHtml = '';
      if (fm && fm.season) {
        var sp = fm.season;
        var sStat = function (lbl, val, cls) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(lbl) + '</span><b class="gx-mono ' + (cls || '') + '">' + val + '</b></div>'; };
        var leaders = (fm.season_leaders || []).map(function (l) {
          var isMe = l.id === id;
          return '<div class="gx-clrow' + (isMe ? '' : ' gx-pick-clickable') + '"' + (isMe ? '' : ' data-nav-cteam="' + esc(lg + '|' + l.id) + '"') + ' style="' + (isMe ? 'background:rgba(45,230,163,.07);border-radius:6px' : 'cursor:pointer') + '"><span>' + clubBadge(l.id) + ' <b' + (isMe ? ' style="color:var(--gx-accent)"' : '') + '>' + esc(l.name) + '</b></span><span class="gx-mono" style="font-weight:700">' + pct1(l.champion) + '</span></div>';
        }).join('');
        seasonHtml = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('trophy') + esc(t('cl_season')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:10.5px">' + sp.remaining + ' ' + esc(t('cl_remaining')) + '</span></div><div class="gx-mod-body">' +
          '<div class="gx-hero-grid" style="margin:0">' +
          sStat(t('cl_champion'), pct1(sp.champion), 'hi') +
          sStat(t('cl_top') + ' ' + sp.top_n, pct1(sp.top)) +
          sStat(t('cl_proj_finish'), sp.exp_rank + '°') +
          sStat(t('cl_releg'), pct1(sp.relegation), sp.relegation > 0.3 ? 'gx-neg' : '') +
          '</div>' +
          (leaders ? '<div class="gx-mod-sub gx-label">' + esc(t('cl_title_race')) + '</div>' + leaders : '') +
          '<p class="gx-mod-note gx-dim" style="margin-top:8px">' + ic('info-circle') + ' ' + esc(t('cl_season_note')) + '</p>' +
          '</div></div>';
      }
      body = seasonHtml + '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + ic('calendar') + esc(t('cl_upcoming')) + '</span></div><div style="padding:6px 16px 12px">' + upHtml + '</div></div>';
    }
    mv.innerHTML = mvShell('<div class="gx-content" style="gap:14px">' + hero + tabNav + body + '<div class="gx-pick-disc">' + esc(t('tm_sim_note')) + '</div></div>');
    var tn = $('#gx-cteam-tabs'); if (tn) tn.addEventListener('click', function (e) { var a = e.target.closest('[data-cttab]'); if (a) { S.cteamTab = a.getAttribute('data-cttab'); renderClubTeam(); } });
    bindBack(); // los [data-openmatch] los maneja el delegado global de clicks
    [].forEach.call(mv.querySelectorAll('[data-cplayer]'), function (el) {
      el.addEventListener('click', function () { var pp = el.getAttribute('data-cplayer').split('|'); openClubPlayer(pp[0], pp[1], pp[2]); });
    });
    [].forEach.call(mv.querySelectorAll('[data-nav-cteam]'), function (el) {
      el.addEventListener('click', function () { var pp = el.getAttribute('data-nav-cteam').split('|'); openClubTeam(pp[0], pp[1]); });
    });
  }
  function clubMoney(v) { v = Number(v); if (!isFinite(v) || v <= 0) return ''; if (v >= 1e6) return '€' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M'; if (v >= 1e3) return '€' + Math.round(v / 1e3) + 'K'; return '€' + v; }
  // PERFIL de JUGADOR de club (shadow): ficha desde el roster + (fase 2) radar/stats cuando haya backfill.
  function openClubPlayer(lg, tid, pid, fromHash) {
    if (!lg || !tid || !pid) return;
    if (!fromHash) setHash('cplayer/' + lg + '-' + tid + '-' + pid);
    S.view = 'cplayer'; S.cplLg = lg; S.cplTeam = tid; S.cplPid = pid;
    applyView(); syncNavActive(); try { window.scrollTo(0, 0); } catch (e) {}
    renderClubPlayer();
  }
  function renderClubPlayer() {
    var mv = $('#gx-matchview'); if (!mv) return;
    // Perfil de jugador (radar/scouting/proyecciones) = plan Pro+. Free → candado con "Ver planes" (mismo
    // gate que el perfil del Mundial; los links de jugador de club van por #cplayer).
    if (uiPlan() === 'free') { mv.innerHTML = mvShell(lockPanelPro('lock_player_s')); bindBack(); return; }
    var lg = S.cplLg, tid = S.cplTeam, pid = S.cplPid, key = lg + '|' + tid + '|' + pid;
    S.cpl = S.cpl || {};
    if (S.cpl[key] === undefined) {
      S.cpl[key] = null; mv.innerHTML = mvShell(mvLoading()); bindBack();
      fetch('/api/clubs/player?league=' + encodeURIComponent(lg) + '&team=' + encodeURIComponent(tid) + '&pid=' + encodeURIComponent(pid), { headers: hdrs() })
        .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (m) { S.cpl[key] = m || { _empty: true }; if (S.view === 'cplayer' && S.cplPid === pid) renderClubPlayer(); });
      return;
    }
    var p = S.cpl[key];
    if (!p || p._empty || p.error) { mv.innerHTML = mvShell('<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('match_404')) + '</b></div></div>'); bindBack(); return; }
    var mini = function (label, val) { return val == null || val === '' ? '' : '<div class="gx-hero-mini"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + esc(val) + '</b></div>'; };
    var footL = { left: t('cl_foot_l'), right: t('cl_foot_r'), both: t('cl_foot_b') };
    var iv = p.intel || {};
    var avatar = p.photo ? '<img class="gx-cpl-photo" src="' + esc(p.photo) + '" alt="" onerror="this.style.display=\'none\'">' : '<span class="fl big">' + ic('user') + '</span>';
    var hero = '<div class="gx-panel gx-hero gx-team-hero"><div class="gx-hero-meta">' + leagueLogo(lg) + '<span class="gx-pick-clickable" data-cteam="' + esc(lg + '|' + tid) + '" style="cursor:pointer">' + clubBadge(tid) + ' ' + esc(p.team_name || '') + '</span><span class="gx-spacer"></span>' + (p.position ? '<span class="gx-clgate sh">' + esc(p.position) + '</span>' : '') + '</div>' +
      '<div class="gx-team-id">' + avatar + '<div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>' + esc(p.name) + '</b>' + archBadge(iv.scout && iv.scout.archetype) + '</div>' + (p.national_team ? '<span class="gx-mono gx-dim">' + esc(t('cl_nat_team')) + ': ' + esc(p.national_team) + '</span>' : '') + '</div></div>' +
      '<div class="gx-hero-grid">' +
      mini(t('cl_age'), p.age != null ? p.age + esc(t('cl_yr')) : null) +
      mini(t('cl_height'), p.height ? p.height + ' cm' : null) +
      mini(t('cl_foot'), p.foot ? (footL[p.foot] || p.foot) : null) +
      mini(t('cl_nat'), p.nationality) +
      mini(t('cl_value'), clubMoney(p.market_value)) +
      mini(t('cl_contract'), p.contract_until ? String(p.contract_until).slice(0, 4) : null) +
      '</div></div>';
    // NIVEL YAMAL (paridad con el perfil del Mundial): tiles de muestra + radar + stats/90 CON percentil por
    // stat + scout read + MATCH BY MATCH. Mismos engines/datos que el Mundial.
    var intelHtml = '';
    if (iv.stats_available && iv.scout) {
      // percentil por stat desde los ejes del radar (production=xg90, volume=shots90, creation=xa90)
      var axPct = {}; (iv.scout.axes || []).forEach(function (a) { axPct[a.key] = a.pct; });
      var pctTag = function (k) { return axPct[k] != null ? '<span class="gx-dim" style="font-size:10px">' + esc(t('cl_top') + ' ' + Math.round((1 - axPct[k]) * 100) + '% ' + t('cl_of_pos')) + '</span>' : ''; };
      var s90 = function (label, v, k) {
        return '<div class="gx-clrow" style="align-items:baseline"><span>' + esc(label) + ' ' + pctTag(k) + '</span><span class="gx-mono" style="font-weight:700">' + (v != null ? Number(v).toFixed(2) : '—') + '</span></div>';
      };
      // tiles de muestra (minutos / titularidades / goles) — como el Mundial
      var sampleTiles = '<div class="gx-hero-grid" style="margin:0 0 4px">' +
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('cl_minutes')) + '</span><b class="gx-mono">' + (iv.minutes || 0) + '\'</b></div>' +
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('cl_startsapps')) + '</span><b class="gx-mono">' + (iv.starts || 0) + '/' + (iv.apps || 0) + '</b></div>' +
        '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('cl_goals')) + '</span><b class="gx-mono">' + (iv.goals || 0) + '</b></div>' +
        (iv.attack_share ? '<div class="gx-hero-mini"><span class="gx-label">' + esc(t('cl_att_share')) + '</span><b class="gx-mono">' + pct0(iv.attack_share) + '</b></div>' : '') +
        '</div>';
      var radar = (iv.scout.axes && iv.scout.axes.length >= 3) ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('radar') + esc(t('cl_profile')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:10.5px">' + iv.minutes + '\' · ' + iv.apps + ' ' + esc(t('cl_apps')) + '</span></div><div class="gx-mod-body">' + sampleTiles + '<div class="gx-radar-wrap">' + gxRadar(iv.scout.axes) + '</div></div></div>' : '';
      var stats = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + ic('chart-bar') + esc(t('cl_stats90')) + '</span></div><div style="padding:6px 16px 12px">' +
        s90('xG/90', iv.xg90, 'production') + s90(t('cl_shots90'), iv.shots90, 'volume') + s90(t('cl_sot90'), iv.sot90, 'accuracy') + s90('xA/90', iv.xa90, 'creation') +
        '<div class="gx-clrow"><span>' + esc(t('cl_ga')) + '</span><span class="gx-mono" style="font-weight:700">' + (iv.goals || 0) + ' / ' + (iv.assists || 0) + '</span></div></div></div>';
      var read = '';
      if (iv.scout.read) {
        var str = (iv.scout.read.strengths || []).map(function (x) { return '<div class="gx-finding"><span class="gx-finding-dot" style="background:var(--gx-pos)"></span>' + esc(LANG === 'en' ? x.en : x.es) + '</div>'; }).join('');
        var lim = iv.scout.read.limit ? '<div class="gx-finding"><span class="gx-finding-dot" style="background:#F09595"></span>' + esc(LANG === 'en' ? iv.scout.read.limit.en : iv.scout.read.limit.es) + '</div>' : '';
        if (str || lim) read = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + ic('search') + esc(t('cl_scout')) + '</span></div><div class="gx-findings" style="padding:10px 16px 12px">' + str + lim + '</div></div>';
      }
      // MATCH BY MATCH — tabla partido a partido (como el Mundial)
      var mbm = '';
      if ((p.matches || []).length) {
        var rows = p.matches.map(function (r) {
          return '<tr><td class="l gx-dim" style="font-size:10.5px">' + esc(fmtDate(r.date)) + '</td><td class="l">' + esc(String(r.opp || '').split(' · ')[0]) + '</td><td class="gx-mono">' + (r.min || 0) + '\'</td><td class="gx-mono">' + (r.sh != null ? r.sh : '·') + '</td><td class="gx-mono">' + (r.sot != null ? r.sot : '·') + '</td><td class="gx-mono ' + (r.g ? 'gx-pos' : '') + '" style="font-weight:700">' + (r.g || 0) + '</td><td class="gx-mono gx-dim">' + (r.xg != null ? r.xg.toFixed(2) : '·') + '</td></tr>';
        }).join('');
        mbm = '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + ic('list-numbers') + esc(t('cl_mbm')) + '</span></div>' +
          '<table class="gx-table"><thead><tr><th class="l">' + esc(t('cl_date')) + '</th><th class="l">' + esc(t('cl_opp')) + '</th><th>MIN</th><th>' + esc(t('cl_sh')) + '</th><th>SOT</th><th>' + esc(t('cl_g')) + '</th><th>xG</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
      // NEXT MATCH · PROJECTION (paridad Mundial): P(gol)/remates/xG/min proy del próximo partido (projectTeam de liga)
      var np = p.next_projection, nextHtml = '';
      if (np) {
        var oppN = (S.clubNames && S.clubNames[np.opp_id]) || np.opp;
        var npStat = function (label, val) { return '<div class="gx-hero-mini"><span class="gx-label">' + esc(label) + '</span><b class="gx-mono">' + val + '</b></div>'; };
        nextHtml = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('target-arrow') + esc(t('pp_next')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:10.5px">' + (np.home ? '' : '@ ') + esc(oppN) + '</span></div><div class="gx-mod-body"><div class="gx-hero-grid" style="margin:0">' +
          npStat(t('pp_pgoal'), pct0(np.anytime)) +
          npStat(t('pp_proj_shots'), np.shots != null ? Number(np.shots).toFixed(1) : '—') +
          npStat('xG', np.xg != null ? Number(np.xg).toFixed(2) : '—') +
          npStat(t('pp_proj_min'), np.minutes != null ? np.minutes + "'" : '—') +
          '</div></div></div>';
      }
      intelHtml = radar + nextHtml + minutesDistPanel(p.minutes_dist) + stats + read + mbm;
    } else {
      intelHtml = '<div class="gx-panel"><div style="padding:12px 16px;font-size:11px;color:var(--gx-text3);line-height:1.5">' + esc(t('cl_player_soon')) + '</div></div>';
    }
    // F2.3: disponibilidad narrada del OBSERVER (caja negra, sin fuente) — como el "Hallazgo" del perfil del Mundial.
    var availHtml = '';
    if (p.avail && (p.avail.es || p.avail.en)) {
      var acol = (p.avail.status === 'OUT' || p.avail.status === 'SUSPENDED') ? '#F09595' : p.avail.status === 'DOUBT' ? 'var(--gx-warn)' : 'var(--gx-text3)';
      availHtml = '<div class="gx-panel"><div class="gx-ph"><span class="gx-label">' + ic('search') + esc(t('pp_finding')) + '</span></div><div class="gx-findings" style="padding:10px 16px 12px"><div class="gx-finding"><span class="gx-finding-dot" style="background:' + acol + '"></span><span>' + esc(LANG === 'en' ? p.avail.en : p.avail.es) + '</span></div></div></div>';
    }
    mv.innerHTML = mvShell('<div class="gx-content" style="gap:14px">' + hero + availHtml + intelHtml + '<div class="gx-pick-disc">' + esc(t('tm_sim_note')) + '</div></div>');
    bindBack();
    [].forEach.call(mv.querySelectorAll('[data-cteam]'), function (el) {
      el.addEventListener('click', function () { var pp = el.getAttribute('data-cteam').split('|'); openClubTeam(pp[0], pp[1]); });
    });
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
      var playerRow = function (p) { var inner0 = '<div class="gx-lu-p"><span class="gx-lu-n gx-mono">' + (p.number != null ? p.number : '–') + '</span><b>' + esc(p.name || '') + '</b>' + (p.position ? '<span class="gx-dim gx-lu-pos">' + esc(p.position) + '</span>' : '') + (p.age ? '<span class="gx-dim" style="font-size:10.5px">' + p.age + '</span>' : '') + (p.status && p.status !== 'available' ? '<span class="gx-badge gx-b-watch" style="font-size:9px">' + esc(t('st_' + p.status) || p.status) + '</span>' : '') + '</div>'; return playerLink(S.teamId, p.name, inner0); };
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
        return '<tr><td class="l gx-mkt-oc" style="white-space:nowrap">' + bookLogo(o.venue) + esc(o.venue || '—') + '</td><td class="gx-mono">' + (o.price != null ? (o.price <= 1 ? pct0(o.price) : odd(o.price)) : '—') + '</td><td class="gx-mono gx-dim">' + (o.bid != null && o.ask != null ? pct0(o.bid) + '/' + pct0(o.ask) : '—') + '</td><td class="gx-mono gx-dim">' + (liq != null ? mktLiq(liq) : '—') + '</td><td class="gx-mono ' + (o.change24h > 0 ? 'gx-pos' : o.change24h < 0 ? 'gx-neg' : 'gx-dim') + '">' + (o.change24h != null ? (o.change24h > 0 ? '+' : '') + (o.change24h * 100).toFixed(1) + '%' : '—') + '</td></tr>';
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
        (mPct != null ? '<div class="gx-hero-mini"><span class="gx-label" style="display:inline-flex;align-items:center;gap:3px">' + esc(t('tm_gpi_market')) + (bestM && bestM.venue ? ' · ' + bookLogo(bestM.venue) + esc(bestM.venue) : '') + '</span><b class="gx-mono">' + pct1(mPct) + '</b></div>' : '') +
        (edge != null ? stat(t('tm_gpi_edge'), (edge >= 0 ? '+' : '') + (edge * 100).toFixed(1) + ' pp', edge > 0.005 ? 'gx-pos' : edge < -0.005 ? 'gx-neg' : 'gx-dim') : '') + '</div>';
      gpiPanel = teamPanel('trophy', t('tm_gpi'), grid + '<p class="gx-mod-note gx-dim" style="margin-top:10px">' + ic('info-circle') + ' ' + esc(t('tm_gpi_note')) + '</p>');
    }
    return summaryPanel + gpiPanel + nextCtx + read + opp + paths;
  }

  // ---- Grupos ----
  function renderGroups() {
    var mv = $('#gx-matchview'); if (!mv) return;
    // carrera: hash directo a #groups puede correr antes de /api/me → clubsOn() falso → sin selector de liga.
    if (S.me == null) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_groups')) + mvLoading() + '</div></div>'; setTimeout(function () { if (S.view === 'groups') renderGroups(); }, 500); return; }
    if (clubsOn()) loadClubs();
    if (clubsOn() && S.gComp == null) S.gComp = 'wc';
    // FASE CLUBES: selector de competición en Grupos ("Mundial o liga") — mismo patrón que Partidos/Equipos.
    var gsel = clubsOn()
      ? '<select class="gx-select" id="gx-gcomp"><option value="wc"' + (!S.gComp || S.gComp === 'wc' ? ' selected' : '') + '>' + esc(t('cl_wc')) + '</option>' + ((S.clubs && S.clubs.leagues) || []).map(function (L) { return '<option value="' + esc(L.key) + '"' + (S.gComp === L.key ? ' selected' : '') + '>' + esc(L.name.split(' · ')[0]) + (L.starts ? ' · ' + esc(L.starts) : '') + '</option>'; }).join('') + '</select>'
      : '';
    if (clubsOn() && S.gComp && S.gComp !== 'wc') { renderClubLeagueTable(mv, gsel); return; }
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
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_groups'), gsel + '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11px">' + esc(t('grp_advance_note')) + '</span>') + '<div class="gx-grp-grid">' + blocks + '</div></div></div>';
    wireGroupComp();
  }
  function wireGroupComp() {
    var sel = $('#gx-gcomp'); if (sel) sel.addEventListener('change', function () { setCompHash('groups', sel.value, 'wc'); });
  }
  // FASE CLUBES: TABLA DE POSICIONES de una liga (= "Grupos" del Mundial para una competición de liga corrida).
  // Reusa el markup gx-board/gx-champbar del Mundial. Columna "avance" = prob de TOP-N del season sim (mismo
  // espíritu que groupWin+groupSecond). Carga progresiva (regla data-parcial): la tabla se pinta con L.standings
  // ya disponible en /api/clubs/state; la columna avance se enriquece al llegar /api/clubs/season. Click → cteam/.
  function renderClubLeagueTable(mv, gsel) {
    var L = clubLeague(S.gComp);
    if (!S.clubs) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + mvLoading() + '</div></div>'; return; }
    if (!L) { S.gComp = 'wc'; renderGroups(); return; }
    var key = L.key, hasSt = (L.standings || []).length > 0;
    // season sim (avance %) — se dispara una vez por liga, la tabla no espera a que llegue.
    S.clubSeason = S.clubSeason || {};
    if (S.clubSeason[key] === undefined && hasSt && !L.starts) {
      S.clubSeason[key] = null;
      fetch('/api/clubs/season?league=' + encodeURIComponent(key), { headers: hdrs() })
        .then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; })
        .then(function (j) { S.clubSeason[key] = (j && j.sim) || { _empty: true }; if (S.view === 'groups' && S.gComp === key) renderGroups(); });
    }
    var sim = S.clubSeason[key];
    var teamsSim = (sim && sim.teams) ? sim.teams : null;
    var loadingSim = hasSt && !L.starts && sim === null; // pedido en vuelo
    var nm = {}; (L.standings || []).concat(L.table || []).forEach(function (x) { if (x && x.id && x.name) nm[x.id] = x.name; });
    // favorito al título por prob de campeón del season sim
    var fav = null;
    if (teamsSim) { Object.keys(teamsSim).forEach(function (id) { var c = teamsSim[id].champion || 0; if (!fav || c > fav.c) fav = { id: id, c: c }; }); }
    var rows = hasSt
      ? L.standings.map(function (s, i) { return { id: s.id, name: s.name, pos: i + 1, pts: s.pts, pj: s.pj, gf: s.gf, ga: s.ga }; })
      : (L.table || []).map(function (x, i) { return { id: x.id, name: x.name, pos: i + 1, pts: null, pj: null, gf: null, ga: null }; });
    var trs = rows.map(function (r) {
      var sm = teamsSim ? teamsSim[r.id] : null;
      var adv = sm ? (sm.top || 0) : null;
      var advCell = sm != null
        ? '<div class="gx-champbar sm"><i style="width:' + Math.max(2, adv * 100) + '%"></i><span class="gx-mono">' + pct0(adv) + '</span></div>'
        : '<span class="gx-dim gx-mono">' + (loadingSim ? '…' : '·') + '</span>';
      return '<tr class="gx-row" data-nav-cteam="' + esc(key + '|' + r.id) + '">' +
        '<td class="gx-dim gx-mono l" style="width:24px">' + r.pos + '</td>' +
        '<td class="l"><div class="gx-cell-team">' + clubBadge(r.id) + '<b>' + esc(r.name) + '</b></div></td>' +
        '<td class="gx-mono">' + (r.pj != null ? r.pj : '·') + '</td>' +
        '<td class="gx-mono" style="color:var(--gx-text)">' + (r.pts != null ? r.pts : '·') + '</td>' +
        '<td class="gx-mono gx-dim">' + (r.gf != null ? r.gf + ':' + r.ga : '·') + '</td>' +
        '<td class="l" style="width:120px">' + advCell + '</td></tr>';
    }).join('');
    var head = viewHead(t('cl_standings'), gsel + '<span class="gx-spacer"></span>' + clubGateChip(L.gate) + '<span class="gx-dim" style="font-size:11px">' + esc(t('cl_grp_note')) + '</span>');
    var pre = L.starts ? '<div class="gx-arb-warn" style="margin-bottom:10px">' + ic('info-circle') + esc(t('cl_preseason')) + '</div>' : '';
    var favHtml = (fav && fav.c > 0) ? '<div class="gx-dim" style="font-size:11.5px;margin-bottom:8px;display:flex;align-items:center;gap:6px">' + esc(t('cl_grp_fav')) + ' ' + clubBadge(fav.id) + ' <b style="color:var(--gx-text)">' + esc(nm[fav.id] || fav.id) + '</b> · <span class="gx-mono">' + pct0(fav.c) + '</span></div>' : '';
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + head + pre + favHtml +
      '<div class="gx-panel gx-board"><table class="gx-table"><thead><tr><th class="l">#</th><th class="l">' + esc(t('nav_teams')) + '</th><th>' + esc(t('cl_pj')) + '</th><th>' + esc(t('cl_pts')) + '</th><th>' + esc(t('grp_goals')) + '</th><th class="l">' + esc(t('grp_advance')) + '</th></tr></thead><tbody>' + trs + '</tbody></table></div></div></div>';
    wireGroupComp();
    [].forEach.call(mv.querySelectorAll('[data-nav-cteam]'), function (el) {
      el.addEventListener('click', function () { var pp = el.getAttribute('data-nav-cteam').split('|'); openClubTeam(pp[0], pp[1]); });
    });
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
    // carrera: hash directo a #bracket puede correr antes de /api/me → clubsOn() falso → sin selector de liga.
    // Esperar a S.me (mismo patrón que #sim/#perf) antes de decidir el branch de clubes.
    if (S.me == null) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_bracket')) + mvLoading() + '</div></div>'; setTimeout(function () { if (S.view === 'bracket') renderBracket(); }, 500); return; }
    if (clubsOn()) loadClubs();
    if (clubsOn() && S.bComp == null) S.bComp = 'wc';
    // FASE CLUBES: selector de competición en Bracket ("Mundial o liga") — mismo patrón que Grupos/Partidos.
    var bsel = clubsOn()
      ? '<select class="gx-select" id="gx-bcomp"><option value="wc"' + (!S.bComp || S.bComp === 'wc' ? ' selected' : '') + '>' + esc(t('cl_wc')) + '</option>' + ((S.clubs && S.clubs.leagues) || []).map(function (L) { return '<option value="' + esc(L.key) + '"' + (S.bComp === L.key ? ' selected' : '') + '>' + esc(L.name.split(' · ')[0]) + (L.starts ? ' · ' + esc(L.starts) : '') + '</option>'; }).join('') + '</select>'
      : '';
    if (clubsOn() && S.bComp && S.bComp !== 'wc') { renderClubBracket(mv, bsel); return; }
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
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_bracket'), bsel + '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11px">' + esc(t('bk_subtitle')) + '</span>') + '<div class="gx-bk-scroll"><div class="gx-bk">' + cols + '</div></div></div></div>';
    wireBracketComp();
  }
  function wireBracketComp() {
    var sel = $('#gx-bcomp'); if (sel) sel.addEventListener('change', function () { setCompHash('bracket', sel.value, 'wc'); });
  }
  // FASE CLUBES: BRACKET DE PLAYOFFS PROYECTADO (MX/MLS). Reusa el markup gx-bk/gx-bk-col/gx-bk-match/gx-bk-side
  // del Mundial (mismo enfoque que renderClubLeagueTable con gx-board). QF = clasificados sembrados por la
  // proyección del season sim + prob de avance (Elo); SF/Final = slots "Ganador QF/SF" (como los slot-desc del
  // Mundial). Campeón proyectado arriba. Carga progresiva vía /api/clubs/bracket (regla data-parcial). Ligas sin
  // fase final o sin temporada en marcha → nota honesta.
  function renderClubBracket(mv, bsel) {
    var L = clubLeague(S.bComp);
    if (!S.clubs) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + mvLoading() + '</div></div>'; return; }
    if (!L) { S.bComp = 'wc'; renderBracket(); return; }
    var key = L.key;
    S.clubBracket = S.clubBracket || {};
    if (S.clubBracket[key] === undefined) {
      S.clubBracket[key] = null;
      fetch('/api/clubs/bracket?league=' + encodeURIComponent(key), { headers: hdrs() })
        .then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; })
        .then(function (j) { S.clubBracket[key] = (j && j.bracket) || { _err: true }; if (S.view === 'bracket' && S.bComp === key) renderBracket(); });
    }
    var bk = S.clubBracket[key];
    var head = viewHead(t('cl_bk_title'), bsel + '<span class="gx-spacer"></span>' + clubGateChip(L.gate) + '<span class="gx-dim" style="font-size:11px">' + esc(t('cl_bk_note')) + '</span>');
    var body;
    if (bk === null) { body = mvLoading(); }
    else if (!bk.has_playoff) {
      // Liga sin fase final: nota + CARRERA POR EL TÍTULO (top 6 del season sim) — nunca un panel vacío
      var race = (bk.title_race || []).map(function (r, i) {
        return '<div class="gx-bk-side" data-nav-cteam="' + esc(key + '|' + r.id) + '" style="cursor:pointer"><span class="gx-dim gx-mono" style="width:20px;text-align:center">' + (i + 1) + '</span>' + clubBadge(r.id) + '<b>' + esc(r.name) + '</b><span class="gx-spacer"></span><div class="gx-champbar sm" style="width:110px"><i style="width:' + Math.max(2, r.champion * 100) + '%"></i><span class="gx-mono">' + pct0(r.champion) + '</span></div></div>';
      }).join('');
      body = '<div class="gx-panel"><div class="gx-empty" style="padding-bottom:8px">' + ic('info-circle') + '<b>' + esc(L.name.split(' · ')[0]) + '</b>' + esc(t('cl_bk_no_playoff')) + '</div>' +
        (race ? '<div class="gx-mod-body"><div class="gx-mod-sub gx-label">' + esc(t('cl_bk_race')) + '</div>' + race + '</div>' : '') + '</div>';
    }
    else if (!bk.available) { body = '<div class="gx-panel"><div class="gx-empty">' + ic('info-circle') + '<b>' + esc(t('cl_bk_title')) + '</b>' + esc(t('cl_bk_soon')) + '</div></div>'; }
    else {
      var champ = bk.favorite ? '<div class="gx-panel" style="display:flex;align-items:center;gap:12px;padding:16px 18px;margin-bottom:12px"><span class="gx-dim" style="font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase">' + esc(t('cl_bk_champ')) + '</span>' + clubBadge(bk.favorite.id) + '<b>' + esc(bk.favorite.name) + '</b><span class="gx-spacer"></span><span class="gx-mono" style="color:var(--gx-acc,#1FE3A4);font-size:18px;font-weight:800">' + pct0(bk.favorite.champion) + '</span></div>' : '';
      // columna QF: cruces proyectados con prob de avance
      var qfCol = '<div class="gx-bk-col"><div class="gx-bk-colh">' + esc(stageLabel('QF')) + '</div>' + bk.qf.map(function (m) {
        var sd = function (t2) { return '<div class="gx-bk-side"><span class="gx-dim gx-mono" style="width:20px;text-align:center">' + t2.seed + '</span>' + clubBadge(t2.id) + '<b>' + esc(t2.name) + '</b><span class="gx-spacer"></span><span class="gx-mono gx-dim">' + pct0(t2.adv) + '</span></div>'; };
        return '<div class="gx-bk-match" data-nav-cteam="' + esc(key + '|' + m.hi.id) + '"><div class="gx-bk-top"><span class="gx-time">' + esc(stageLabel('QF')) + ' · ' + esc(t('cl_bk_seed')) + ' ' + m.hi.seed + 'v' + m.lo.seed + '</span></div>' + sd(m.hi) + sd(m.lo) + '</div>';
      }).join('') + '</div>';
      // columnas SF/Final: slots "Ganador QF/SF" (proyección, sin equipo fijo)
      var nSF = bk.qf.length / 2;
      var slotCol = function (stage, n, ofLabel) {
        var ms = []; for (var i = 0; i < n; i++) {
          var s1 = ofLabel + (i * 2 + 1), s2 = ofLabel + (i * 2 + 2);
          ms.push('<div class="gx-bk-match gx-bk-tbd"><div class="gx-bk-top"><span class="gx-time">' + esc(stageLabel(stage)) + '</span></div>' +
            '<div class="gx-bk-side tbd"><span class="gx-bk-slot">' + esc(t('cl_bk_winner')) + ' · ' + s1 + '</span></div>' +
            '<div class="gx-bk-side tbd"><span class="gx-bk-slot">' + esc(t('cl_bk_winner')) + ' · ' + s2 + '</span></div></div>');
        }
        return '<div class="gx-bk-col"><div class="gx-bk-colh">' + esc(stageLabel(stage)) + '</div>' + ms.join('') + '</div>';
      };
      var cols2 = qfCol + slotCol('SF', nSF, 'QF') + slotCol('FINAL', 1, 'SF');
      body = champ + '<div class="gx-bk-scroll"><div class="gx-bk">' + cols2 + '</div></div>';
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + head + body + '</div></div>';
    wireBracketComp();
    [].forEach.call(mv.querySelectorAll('[data-nav-cteam]'), function (el) {
      el.addEventListener('click', function () { var pp = el.getAttribute('data-nav-cteam').split('|'); openClubTeam(pp[0], pp[1]); });
    });
  }
  function canonByKey(h, a, d) { var c = S.canonByKey[canonKey(h, a, d)]; return c ? c.event_id : null; }

  // ---- Evolución (solo snapshots reales) ----
  function renderEvo() {
    var mv = $('#gx-matchview'); if (!mv) return;
    // carrera: hash directo a #evo/<liga> puede correr antes de /api/me (patrón groups/bracket)
    if (S.me == null) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_evo')) + mvLoading() + '</div></div>'; setTimeout(function () { if (S.view === 'evo') renderEvo(); }, 500); return; }
    if (clubsOn()) loadClubs();
    if (clubsOn() && S.eComp == null) S.eComp = 'wc';
    // FASE CLUBES: selector de competición (mismo patrón que Grupos/Bracket) — la evolución de cada club
    // DENTRO de su liga (historia retrospectiva de prob de campeón por jornada del season sim).
    var esel = clubsOn()
      ? '<select class="gx-select" id="gx-ecomp"><option value="wc"' + (!S.eComp || S.eComp === 'wc' ? ' selected' : '') + '>' + esc(t('cl_wc')) + '</option>' + ((S.clubs && S.clubs.leagues) || []).map(function (L) { return '<option value="' + esc(L.key) + '"' + (S.eComp === L.key ? ' selected' : '') + '>' + esc(L.name.split(' · ')[0]) + (L.starts ? ' · ' + esc(L.starts) : '') + '</option>'; }).join('') + '</select>'
      : '';
    var isClub = clubsOn() && S.eComp && S.eComp !== 'wc';
    var hist;
    if (isClub) {
      S.clubEvo = S.clubEvo || {};
      var lg = S.eComp, ce = S.clubEvo[lg];
      if (ce === undefined) {
        S.clubEvo[lg] = null;
        fetch('/api/clubs/evo?league=' + encodeURIComponent(lg), { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
          .then(function (j) { S.clubEvo[lg] = j || { available: false }; if (S.view === 'evo') renderEvo(); });
        hist = null;
      } else if (ce === null) hist = null; // cargando
      else hist = (ce.available && ce.history) || [];
    } else hist = S.history || [];
    var body;
    if (hist === null) {
      body = '<div class="gx-panel"><div class="gx-mod-body">' + mvLoading() + '</div></div>';
    } else if (hist.length < 2) {
      body = '<div class="gx-panel"><div class="gx-empty">' + ic('chart-line') + '<b>' + esc(t('evo_insufficient')) + '</b>' + esc(t('evo_insufficient_sub', { n: hist.length })) + '</div></div>';
    } else {
      var last = hist[hist.length - 1].probs || {}, first = hist[0].probs || {};
      var followed = isClub ? [] : ((S.me && S.me.favorites) || []);
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
      var navAttr = function (id) { return isClub ? ' data-evoct="' + esc(id) + '"' : ' data-nav-team="' + esc(id) + '"'; };
      var legend = sel.map(function (id, k) { return '<div class="gx-evo-leg"' + navAttr(id) + '><span class="gx-evo-dot" style="background:' + COLORS[k % COLORS.length] + '"></span><span class="fl">' + flag(id) + '</span><b>' + esc(teamName(id)) + '</b><span class="gx-mono gx-dim">' + pct1(last[id] || 0) + '</span></div>'; }).join('');
      var chart = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('evo_champion')) + '</span><span class="gx-spacer"></span>' +
        '<div class="gx-seg" id="gx-evo-seg"><button data-evo="top"' + (filt === 'top' ? ' class="on"' : '') + '>' + esc(t('evo_top')) + '</button>' + (followed.length ? '<button data-evo="mine"' + (filt === 'mine' ? ' class="on"' : '') + '>' + esc(t('nav_follow')) + '</button>' : '') + '</div>' +
        '<span class="gx-ph-extra" style="margin-left:10px">' + hist.length + ' ' + esc(t('evo_snapshots')) + '</span></div>' +
        '<div class="gx-mod-body"><svg class="gx-evo-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">' + grid + lines + '</svg><div class="gx-evo-legend">' + legend + '</div></div></div>';
      // tabla con Δ
      var rows = sel.map(function (id) { var cur = last[id] || 0, prev = first[id] || 0, dd = cur - prev; return '<tr class="gx-row"' + navAttr(id) + '><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(id) + '</span><b>' + esc(teamName(id)) + '</b></div></td><td class="gx-mono" style="color:var(--gx-text)">' + pct1(cur) + '</td><td class="gx-mono ' + (dd > 0 ? 'gx-pos' : dd < 0 ? 'gx-neg' : 'gx-dim') + '">' + (dd === 0 ? '—' : (dd > 0 ? '+' : '') + (dd * 100).toFixed(1) + ' pp') + '</td></tr>'; }).join('');
      var table = '<div class="gx-panel gx-board"><table class="gx-table"><thead><tr><th class="l">' + esc(t('nav_teams')) + '</th><th>' + esc(t('evo_now')) + '</th><th>Δ</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      body = chart + table;
    }
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_evo'), esel + '<span class="gx-spacer"></span><span class="gx-dim" style="font-size:11px">' + esc(t(isClub ? 'evo_club_note' : 'evo_note')) + '</span>') + body + '</div></div>';
    [].forEach.call(mv.querySelectorAll('[data-evo]'), function (b) { b.addEventListener('click', function () { S.evoFilt = b.getAttribute('data-evo'); renderEvo(); }); });
    var ecs = $('#gx-ecomp'); if (ecs) ecs.addEventListener('change', function () { setCompHash('evo', ecs.value, 'wc'); });
    [].forEach.call(mv.querySelectorAll('[data-evoct]'), function (el) {
      el.addEventListener('click', function () { openClubTeam(S.eComp, el.getAttribute('data-evoct')); });
    });
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
      watchesPanel() + // F3: precios vigilados (flag watch_price; sin flag = '')
      '<p class="gx-mod-note gx-dim">' + ic('info-circle') + ' ' + esc(t('al_note')) + '</p></div></div>';
    [].forEach.call(mv.querySelectorAll('[data-alert-ev]'), function (b) { b.addEventListener('click', function () { toggleAlert('events', b.getAttribute('data-alert-ev'), b); }); });
    [].forEach.call(mv.querySelectorAll('[data-alert-ch]'), function (b) { b.addEventListener('click', function () { toggleAlert('channels', b.getAttribute('data-alert-ch'), b); }); });
    [].forEach.call(mv.querySelectorAll('[data-wpdel]'), function (b) { b.addEventListener('click', function () { wpPost({ id: b.getAttribute('data-wpdel'), delete: true }); }); });
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
  // ============================ COMBATE (R2 28-jul — producto paralelo completo, ADMIN-ONLY) ============================
  // Deporte espejo del fútbol con su propia navegación: Oportunidades / Peleas / Peleadores / Simulador /
  // Seguidos / Rendimiento / Organizaciones / Evolución. Firma visual: el EJE DEL ENFRENTAMIENTO — esquina
  // verde vs esquina roja en todo (heroes cara a cara, tale-of-the-tape espejado, barra GP tira-y-afloja).
  // Server: /api/combat/* (404 no-admin). Estado: S.cb.* con cache por clave; org activa S.cb.org (ufc|mma).
  function cbOrg() { return S.cb.org === 'mma' ? 'mma' : 'ufc'; }
  function cbOrgLab() { return cbOrg() === 'mma' ? 'MMA' : 'UFC'; }
  function cbAva(f, side, cls) {
    var ini = (f.name || '?').split(' ').map(function (x) { return x[0] || ''; }).join('').slice(0, 2).toUpperCase();
    var img = f.headshot ? '<img src="' + esc(f.headshot) + '" alt="" decoding="async" onerror="this.remove()">' : '';
    return '<div class="gx-cb-ava ' + (side === 1 ? 'gr' : 'rd') + (cls ? ' ' + cls : '') + '">' + img + '<span>' + esc(ini) + '</span></div>';
  }
  function cbForm(form) {
    if (!form || !form.length) return '';
    return '<div class="gx-cb-formdots">' + form.map(function (r) { return '<i class="' + (r === 'W' ? 'w' : 'l') + '"></i>'; }).join('') + '</div>';
  }
  function cbMethod(m) {
    if (!m) return '';
    var bar = function (lab, v, cls) {
      return '<div class="gx-cb-mrow"><span>' + lab + '</span><div class="gx-cb-mbar"><i class="' + cls + '" style="width:' + Math.round(v * 100) + '%"></i></div><b>' + Math.round(v * 100) + '%</b></div>';
    };
    return '<div class="gx-cb-meth"><div class="gx-label">' + esc(t('cb_method')) + '</div>' +
      bar('KO', m.ko, 'ko') + bar('SUB', m.sub, 'sub') + bar('DEC', m.dec, 'dec') +
      '<div class="gx-dim gx-cb-methnote">' + esc(t('cb_finish')) + ' ' + Math.round(m.finish * 100) + '% · ' + esc(t('cb_inside2')) + ' ' + Math.round(((m.r_le || {})[2] || 0) * 100) + '% · ~' + m.exp_rounds + ' ' + esc(t('cb_rounds')) + '</div></div>';
  }
  // fetch con cache en S.cb[key] — STALE-WHILE-REVALIDATE (29-jul, reporte de Alexis "se queda cargando y hay
  // que refrescar"). Tres reglas para que cambiar de pestaña/org fluya como en fútbol:
  //   1. si ya hay data (aunque esté vencida) se DEVUELVE YA y se refresca por detrás → cero spinner al volver.
  //   2. la cache CADUCA (antes era para siempre: una primera carga fallida te dejaba pegado hasta refrescar F5).
  //   3. un error NO se cachea como resultado final: se reintenta en el siguiente render.
  var CB_TTL = 60e3;
  function cbGet(key, url, ttl) {
    var e = S.cb[key];
    var age = e && e._at ? Date.now() - e._at : Infinity;
    var stale = age > (ttl || CB_TTL);
    if (e && e.v !== undefined && !stale) return e.v;          // fresco
    if (!e || !e._inflight) cbFetch(key, url, !!(e && e.v !== undefined));
    return e && e.v !== undefined ? e.v : null;                // stale: pinta lo viejo mientras llega lo nuevo
  }
  function cbFetch(key, url, silent) {
    var e = S.cb[key] = S.cb[key] || {};
    e._inflight = true;
    var done = false;
    // red colgada: nunca dejar la vista en "cargando" para siempre
    var to = setTimeout(function () {
      if (done) return;
      done = true; e._inflight = false;
      if (e.v === undefined) { e.v = { _err: true }; e._at = Date.now() - CB_TTL + 5e3; } // reintenta en 5s
      if (CB_VIEWS.indexOf(S.view) >= 0) renderCb(S.view);
    }, 20000);
    fetch(url, { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) {
        if (done) return;
        done = true; clearTimeout(to); e._inflight = false;
        if (j) { e.v = j; e._at = Date.now(); }
        else if (e.v === undefined) { e.v = { _err: true }; e._at = Date.now() - CB_TTL + 5e3; }
        else { e._at = Date.now() - CB_TTL + 5e3; } // falló el refresco: conserva lo bueno, reintenta pronto
        if (CB_VIEWS.indexOf(S.view) >= 0) renderCb(S.view);
      });
  }
  // invalida la cache de combate (cambio de org/deporte) sin borrar lo ya pintado
  function cbExpire(pred) {
    for (var k in S.cb) {
      if (!S.cb[k] || S.cb[k].v === undefined) continue;
      if (!pred || pred(k)) S.cb[k]._at = 0;
    }
  }
  function cbWhen(d, withTime) {
    try { return new Date(d).toLocaleString(LANG === 'en' ? 'en-US' : 'es-ES', withTime === false ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function cbShell(title, inner, opts) {
    var mv = $('#gx-matchview'); if (!mv) return;
    // scroll memory: al volver a una vista ya visitada, restaurar la posición (naturalidad de navegación)
    var hk = ''; try { hk = location.hash; } catch (e) {}
    var back = (opts && opts.back) ? '<div class="gx-cb-backrow"><span class="gx-clgate sh gx-cb-back" data-cbgoback="' + esc(opts.back) + '">← ' + esc(t(opts.backLabel || 'cb_fights_title')) + '</span></div>' : '';
    if (S.cb._lastHash && S.cb._lastHash !== hk) (S.cb._scroll = S.cb._scroll || {})[S.cb._lastHash] = window.scrollY || 0;
    S.cb._lastHash = hk;
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content gx-cb-content">' + viewHead(title, opts && opts.extra) + back + inner + '</div></div>';
    mv.onclick = cbClicks; // delegación única de la sección (se reasigna en cada render — sin listeners duplicados)
    var sy = (S.cb._scroll || {})[hk];
    if (sy) requestAnimationFrame(function () { try { window.scrollTo(0, sy); } catch (e) {} });
  }
  function cbClicks(e) {
    var bk = e.target.closest('[data-cbgoback]'); if (bk) { goBack(); return; }
    // Cambio de organización: se QUEDA en la pestaña donde estás (antes te empujaba siempre a Peleas —
    // desde Oportunidades o Peleadores acababas en otra vista sin haberlo pedido).
    var ac = e.target.closest('[data-cbask]'); if (ac) { cbAskSend(ac.getAttribute('data-cbask')); return; }
    var as = e.target.closest('[data-cbasksend]'); if (as) { var i2 = $('#gx-cb-askin'); if (i2) cbAskSend(i2.value); return; }
    var ag = e.target.closest('[data-cbgo]'); if (ag) { setHash(ag.getAttribute('data-cbgo')); return; }
    var cc = e.target.closest('[data-cbcard]'); if (cc) { S.cb.cardId = cc.getAttribute('data-cbcard'); renderCb('cbcard'); return; }
    var og = e.target.closest('[data-cborgtab]'); if (og) {
      var o = og.getAttribute('data-cborgtab');
      if (o !== cbOrg()) {
        S.cb.org = o;
        var base = NAV_HASH[viewNav(S.view)] || 'cbfights';
        setHash(o === 'ufc' ? base : base + '/' + o);
        renderCb(S.view);
      }
      return;
    }
    var fl = e.target.closest('[data-cbfollow]'); if (fl) { cbToggleFollow(JSON.parse(fl.getAttribute('data-cbfollow'))); renderCb(S.view); return; }
    var sa = e.target.closest('[data-cbsimpick]'); if (sa) { cbSimPick(sa.getAttribute('data-cbsimpick'), JSON.parse(sa.getAttribute('data-cbsimf'))); return; }
    var sw = e.target.closest('[data-cbsimswap]'); if (sw) { var tmp = S.cb.simA; S.cb.simA = S.cb.simB; S.cb.simB = tmp; S.cb.simRes = undefined; renderCb('cbsim'); return; }
    var sx = e.target.closest('[data-cbsimclear]'); if (sx) { S.cb[sx.getAttribute('data-cbsimclear')] = null; S.cb.simRes = undefined; renderCb('cbsim'); return; }
    var ft2 = e.target.closest('[data-cbfilt]'); if (ft2) { S.cb.oppFilt = ft2.getAttribute('data-cbfilt'); renderCb('cbopps'); return; }
    var sb3 = e.target.closest('[data-cbsub]'); if (sb3) { S.cb.oppSub = sb3.getAttribute('data-cbsub'); renderCb('cbopps'); return; }
  }
  function renderCb(v) {
    // carrera S.me con hash directo (patrón #perf): S.me arranca NULL (no undefined) hasta que /api/me llega —
    // esperar, no redirigir (el handler de llegada de me re-renderiza las vistas CB)
    if (!S.me) { cbShell(t('cb_title'), mvLoading()); return; }
    if (!cbCanSee(v)) { showView('board'); return; }
    if (v === 'cbopps') renderCbOpps();
    else if (v === 'cbbrief') renderCbBrief();
    else if (v === 'cbcard') renderCbCard();
    else if (v === 'cbask') renderCbAsk();
    else if (v === 'cbfights') renderCbFights();
    else if (v === 'cbfight') renderCbFight();
    else if (v === 'cbfighters') renderCbFighters();
    else if (v === 'cbfighter') renderCbFighter();
    else if (v === 'cbsim') renderCbSim();
    else if (v === 'cbfollow') renderCbFollow();
    else if (v === 'cbperf') renderCbPerf();
    else if (v === 'cborgs') renderCbOrgs();
    else if (v === 'cbevo') renderCbEvo();
  }
  // tabs de organización (compartidos por Peleas/Peleadores/…)
  function cbOrgTabs() {
    return '<div class="gx-cb-tabs">' +
      '<span class="gx-cb-tab' + (cbOrg() === 'ufc' ? ' on' : '') + '" data-cborgtab="ufc">UFC</span>' +
      '<span class="gx-cb-tab' + (cbOrg() === 'mma' ? ' on' : '') + '" data-cborgtab="mma">MMA · PFL</span>' +
      '<span class="gx-cb-tab dim">BOXEO · ' + esc(t('sport_soon')) + '</span>' +
      '<span class="gx-spacer"></span></div>';
  }
  // ── PELEAS: calendario por cartelera (evento → main event destacado + resto de la cartelera) ──
  function renderCbFights() {
    var d = cbGet('state_' + cbOrg(), '/api/combat/state?org=' + cbOrg());
    if (!d) { cbShell(t('cb_fights_title'), cbOrgTabs() + mvLoading()); return; }
    if (d._err) { cbShell(t('cb_fights_title'), cbOrgTabs() + '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>'); return; }
    var html = (d.cards || []).map(function (ev) {
      var main = ev.fights.find(function (f) { return f.main; }) || ev.fights[0];
      var rest = ev.fights.filter(function (f) { return f !== main; });
      var hero = main ? cbFightHero(ev, main, { compact: true }) : '';
      var rows = rest.map(function (f) { return cbFightRow(ev, f); }).join('');
      return '<div class="gx-panel gx-cb-event"><div class="gx-cb-evhead"><b>' + esc(ev.name) + '</b><span class="gx-dim">' + esc(cbWhen(ev.date)) + ' · ' + ev.fights.length + ' ' + esc(t('cb_fights_n')) + '</span></div>' +
        hero + (rows ? '<div class="gx-cb-card"><div class="gx-label gx-cb-cardlab">' + esc(t('cb_card')) + '</div>' + rows + '</div>' : '') + '</div>';
    }).join('');
    if (!(d.cards || []).length) html = '<div class="gx-panel"><div class="gx-empty">' + illo('radar') + '<b>' + esc(t('cb_no_results')) + '</b></div></div>';
    cbShell(t('cb_fights_title'), cbOrgTabs() + html);
  }
  // hero de UNA pelea (usado en calendario compacto y arriba del cockpit completo)
  function cbFightHero(ev, ft, opts) {
    var pr = ft.prob || {}; var p1 = Math.round((pr.p1 || 0.5) * 100);
    var link = 'cbfight/' + cbOrg() + '-' + ft.comp_id;
    var compact = opts && opts.compact;
    var mkt = ft.market ? '<div class="gx-dim gx-cb-subline">' + esc(t('cb_market')) + ': ' + Math.round(ft.market.f1 * 100) + '% · ' + Math.round(ft.market.f2 * 100) + '% (' + ft.market.books + ' ' + esc(t('cb_books_n')) + ')</div>' : '';
    var pick = ft.pick ? '<div class="gx-cb-pickchip"><span class="gx-clgate ok">▲ PICK · ' + esc(ft.pick.name) + ' @' + ft.pick.odds + ' · +' + ft.pick.edge_blend_pp + 'pp</span></div>' : '';
    var side = function (f, s) {
      return '<a class="gx-cb-f" href="#cbfighter/' + cbOrg() + '-' + esc(String(f.id || '')) + '">' + cbAva(f, s, compact ? '' : 'xl') +
        '<div class="gx-cb-nm">' + esc(f.name || '') + '</div>' +
        '<div class="gx-cb-rec">' + f.record.w + '-' + f.record.l + ' ' + cbOrgLab() + ' · ' + f.record.ko + ' KO · ' + f.record.sub + ' SUB</div>' +
        (f.reach_in ? '<div class="gx-cb-rec gx-dim">' + esc(String(f.reach_in)) + ' ' + esc(t('cb_reach')) + '</div>' : '') + cbForm(f.form) + '</a>';
    };
    return '<div class="gx-cb-hero' + (compact ? ' cp' : '') + '">' +
      '<div class="gx-cb-evrow">' + (ft.main ? '<span class="gx-cb-tag">★ ' + esc(t('cb_main_event')).toUpperCase() + '</span>' : '') +
        '<span class="gx-dim" style="font-size:12px">' + esc(ft.weight || '') + ' · ' + (ft.rounds || 3) + ' ' + esc(t('cb_rounds')) + '</span><span class="gx-spacer"></span>' +
        (compact ? '<a class="gx-clgate ok gx-cb-analyze" href="#' + link + '">' + esc(t('cb_analyze')) + ' →</a>' : '') + '</div>' +
      '<div class="gx-cb-face">' + side(ft.f1, 1) +
        '<div class="gx-cb-mid"><div class="gx-cb-vs">VS</div><div class="gx-label gx-cb-problab">' + esc(t('cb_gpprob')) + '</div>' +
          '<div class="gx-cb-bar"><i style="width:' + p1 + '%"></i></div>' +
          '<div class="gx-cb-pcts"><span>' + p1 + '%</span><span class="p2">' + (100 - p1) + '%</span></div>' + mkt +
          '<div class="gx-dim gx-cb-subline">Elo ' + (pr.r1 || '—') + ' · ' + (pr.r2 || '—') + (ft.odds ? ' · ' + esc(t('cb_best_odds')) + ' ' + ft.odds.f1 + ' / ' + ft.odds.f2 : ' · ' + esc(t('cb_no_odds'))) + '</div>' +
          (compact ? '' : cbMethod(ft.method)) + pick + '</div>' +
        side(ft.f2, 2) + '</div></div>';
  }
  function cbFightRow(ev, f) {
    var pp = Math.round(((f.prob || {}).p1 || 0.5) * 100);
    var chip = f.pick ? '<span class="gx-clgate ok">PICK ' + esc((f.pick.name || '').split(' ').pop()) + ' @' + f.pick.odds + '</span>'
      : (f.odds ? '<span class="gx-clgate sh">' + f.odds.f1 + ' / ' + f.odds.f2 + '</span>' : '<span class="gx-clgate sh">' + esc(t('cb_no_odds')) + '</span>');
    return '<a class="gx-cb-bout lnk" href="#cbfight/' + cbOrg() + '-' + esc(f.comp_id) + '">' +
      '<span class="gx-cb-avapair">' + cbAva(f.f1, 1) + cbAva(f.f2, 2) + '</span>' +
      '<div class="gx-cb-bnames"><b>' + esc(f.f1.name || '') + ' <i class="gx-cb-vsi">vs</i> ' + esc(f.f2.name || '') + '</b><span class="gx-dim">' + esc(f.weight || '') + ' · ' + f.f1.record.w + '-' + f.f1.record.l + ' / ' + f.f2.record.w + '-' + f.f2.record.l + '</span></div>' +
      '<div class="gx-cb-mini"><div class="gx-cb-minibar"><i style="width:' + pp + '%"></i></div><span class="gx-mono gx-dim">' + pp + '% · ' + (100 - pp) + '%</span></div>' + chip + '</a>';
  }
  // ── R3: builders compartidos de los engines nuevos (cockpit + simulador) ──
  var CB_FX = { elo: 'cb_fx_elo', reach: 'cb_fx_reach', exp: 'cb_fx_exp', years: 'cb_fx_years', age: 'cb_fx_age', chin: 'cb_fx_chin', streak: 'cb_fx_streak', mileage: 'cb_fx_mileage', slpm: 'cb_slpm', td15: 'cb_td15', tddef: 'cb_tddef', ctrl: 'cb_ctrl', kdr: 'cb_kd15', misswt: 'cb_fx_misswt' };
  function cbConfBadge(c) {
    if (!c) return '';
    var k = c.level === 'high' ? 'cb_conf_high' : c.level === 'med' ? 'cb_conf_med' : 'cb_conf_low';
    return '<span class="gx-cb-confbadge ' + c.level + '"><i></i>' + esc(t(k)) + '</span>';
  }
  function cbContextChips(ctx) {
    if (!ctx || !ctx.length) return '';
    return '<div class="gx-cb-ctxchips">' + ctx.map(function (c) { return '<span class="gx-clgate sh' + (c.code === 'title' ? ' gold' : '') + '">' + esc(LANG === 'en' ? c.en : c.es) + '</span>'; }).join('') + '</div>';
  }
  // LECTURA GP: la explicación del sistema, arriba de todo (caja negra: factores, no mecánica)
  function cbReadPanel(read, conf) {
    if (!read) return '';
    return '<div class="gx-panel gx-cb-readpanel"><div class="gx-cb-readtop"><span class="gx-label">' + esc(t('cb_read')) + '</span>' + cbConfBadge(conf) + '</div>' +
      '<div class="gx-cb-readtxt">' + esc(LANG === 'en' ? read.en : read.es) + '</div>' +
      (conf && conf.level === 'low' ? '<div class="gx-dim gx-cb-readsub">' + esc(t('cb_conf_sub_low')) + '</div>' : '') + '</div>';
  }
  // MATCHUP: barras de contribución desde el centro (verde → esquina verde, rojo → esquina roja)
  function cbMatchupPanel(parts, f1n, f2n) {
    if (!parts || !parts.length) return '';
    var mx = Math.max.apply(null, parts.map(function (p2) { return Math.abs(p2.pp); }));
    var rows = parts.map(function (p2) {
      var w = Math.max(4, Math.abs(p2.pp) / mx * 100);
      var pos = p2.pp > 0;
      return '<div class="gx-cb-mxrow"><span class="gx-cb-mxlab">' + esc(t(CB_FX[p2.key] || p2.key)) + '</span>' +
        '<div class="gx-cb-mxbar"><div class="l">' + (pos ? '<i style="width:' + w + '%"></i>' : '') + '</div><div class="r">' + (!pos ? '<i style="width:' + w + '%"></i>' : '') + '</div></div>' +
        '<b class="gx-mono ' + (pos ? 'gr' : 'rd') + '">' + (pos ? '+' : '') + p2.pp + 'pp</b></div>';
    }).join('');
    var net = parts.reduce(function (a2, p2) { return a2 + p2.pp; }, 0);
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_matchup')) + '</span><span class="gx-ph-extra gx-dim">' + esc(t('cb_matchup_sub')) + '</span></div>' +
      '<div class="gx-mod-body"><div class="gx-cb-mxhead"><span class="gr">' + esc((f1n || '').split(' ').pop()) + '</span><span class="rd">' + esc((f2n || '').split(' ').pop()) + '</span></div>' + rows +
      '<div class="gx-cb-mxnet">MATCHUP: <b class="' + (net >= 0 ? 'gr' : 'rd') + '">' + (net >= 0 ? '+' : '') + net.toFixed(1) + 'pp → ' + esc(((net >= 0 ? f1n : f2n) || '').split(' ').pop()) + '</b></div></div></div>';
  }
  // PREDICCIÓN COMPLETA: todos los desenlaces + distribución por round (capa 10)
  function cbPredictionPanel(pred, f1n, f2n) {
    if (!pred) return '';
    var l1 = (f1n || '').split(' ').pop(), l2 = (f2n || '').split(' ').pop();
    var by = pred.by || {};
    var outRow = function (lab, v, cls) {
      var sims = Math.round((v || 0) * 10000).toLocaleString();
      return '<div class="gx-cb-predrow"><span>' + lab + '</span><div class="gx-cb-predbar"><i class="' + (cls || '') + '" style="width:' + Math.round((v || 0) * 100) + '%"></i></div><b class="gx-mono" title="' + sims + '">' + Math.round((v || 0) * 100) + '% <span class="gx-dim" style="font-weight:600">· ' + sims + '</span></b></div>';
    };
    var side = function (nm, w, byS, cls) {
      return '<div class="gx-cb-predside"><div class="gx-cb-predname ' + cls + '">' + esc(nm) + ' · ' + Math.round(w * 100) + '%</div>' +
        outRow('KO/TKO', (byS || {}).ko, cls) + outRow('SUB', (byS || {}).sub, cls) + outRow('DEC', (byS || {}).dec, cls) + '</div>';
    };
    var dist = (pred.round_dist || []).map(function (rd) {
      return '<div class="gx-cb-rdcol"><div class="gx-cb-rdbar"><i style="height:' + Math.max(3, Math.round(rd.p * 240)) + 'px"></i></div><span>R' + rd.r + '</span><b class="gx-mono">' + Math.round(rd.p * 100) + '%</b></div>';
    }).join('') + '<div class="gx-cb-rdcol"><div class="gx-cb-rdbar"><i class="dec" style="height:' + Math.max(3, Math.round((pred.distance || 0) * 240)) + 'px"></i></div><span>' + esc(t('cb_dist_lab')) + '</span><b class="gx-mono">' + Math.round((pred.distance || 0) * 100) + '%</b></div>';
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_pred')) + '</span><span class="gx-ph-extra gx-dim">' + esc(t('cb_sims')) + ' · ' + esc(t('cb_pred_sub')) + '</span></div><div class="gx-mod-body">' +
      '<div class="gx-cb-predgrid">' + side(l1, pred.win.f1, by.f1, 'gr') + side(l2, pred.win.f2, by.f2, 'rd') + '</div>' +
      '<div class="gx-label gx-cb-rdlab">' + esc(t('cb_rdist')) + '</div><div class="gx-cb-rdist">' + dist + '</div>' +
      '<div class="gx-dim gx-cb-subline" style="text-align:center">~' + pred.exp_rounds + ' ' + esc(t('cb_rounds')) + ' · ' + esc(t('cb_finish')) + ' ' + Math.round((pred.finish || 0) * 100) + '%</div></div></div>';
  }
  // ── #8 PREGUNTALE A GP: capa conversacional acotada a lo que el modelo sabe ──
  function renderCbAsk() {
    var st = S.cb.ask || (S.cb.ask = { q: '', a: null, loading: false, hist: [] });
    var sugg = LANG === 'en'
      ? ['Who wins the main event?', 'How does it end?', 'How many rounds?', 'What does the market say?', 'Any red flags?', 'What does the tape say?', 'Do we have a play?', 'How many fights on the card?']
      : ['¿Quién gana el estelar?', '¿Cómo termina?', '¿Cuántos rounds dura?', '¿Qué dice el mercado?', '¿Hay señales de riesgo?', '¿Qué dice la cinta?', '¿Tenemos jugada?', '¿Cuántas peleas tiene la cartelera?'];
    var chips = sugg.map(function (x) { return '<span class="gx-cb-askchip" data-cbask="' + esc(x) + '">' + esc(x) + '</span>'; }).join('');
    var hist = (st.hist || []).slice().reverse().map(function (h) {
      return '<div class="gx-cb-qa">' +
        '<div class="gx-cb-q">' + ic('message-circle') + '<span>' + esc(h.q) + '</span></div>' +
        '<div class="gx-cb-a">' + esc(LANG === 'en' ? h.answer_en : h.answer_es) +
        (h.link ? ' <a class="gx-cb-alink" data-cbgo="' + esc(h.link) + '">' + esc(t('cba_open')) + '</a>' : '') + '</div></div>';
    }).join('');
    cbShell(t('nav_cb_ask'), cbOrgTabs() +
      '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body">' +
      '<div class="gx-dim gx-cb-askintro">' + esc(t('cba_intro')) + '</div>' +
      '<div class="gx-cb-askbar"><input id="gx-cb-askin" type="text" placeholder="' + esc(t('cba_ph')) + '" value="' + esc(st.q || '') + '" autocomplete="off">' +
      '<button class="gx-btn" data-cbasksend="1">' + esc(t('cba_send')) + '</button></div>' +
      '<div class="gx-cb-askchips"><span class="gx-dim">' + esc(t('cba_try')) + '</span>' + chips + '</div>' +
      (st.loading ? '<div class="gx-dim gx-cb-askload">' + esc(t('cba_thinking')) + '</div>' : '') +
      hist + '</div></div>');
    var inp = $('#gx-cb-askin');
    if (inp) {
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { cbAskSend(inp.value); } });
      if (st.focus) { try { inp.focus(); } catch (e) {} st.focus = false; }
    }
  }
  function cbAskSend(q) {
    q = String(q || '').trim(); if (!q) return;
    var st = S.cb.ask || (S.cb.ask = { hist: [] });
    st.q = ''; st.loading = true; st.focus = true;
    renderCb('cbask');
    fetch('/api/combat/ask?org=' + cbOrg() + '&q=' + encodeURIComponent(q), { headers: hdrs() })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (j) {
        st.loading = false;
        if (j && (j.answer_es || j.answer_en)) { st.hist = (st.hist || []).concat([{ q: q, answer_es: j.answer_es, answer_en: j.answer_en, link: j.link }]); }
        else { st.hist = (st.hist || []).concat([{ q: q, answer_es: t('e_net'), answer_en: t('e_net'), link: null }]); }
        if (S.view === 'cbask') renderCb('cbask');
      });
  }
  // ── #6 MAPA DE LA NOCHE: la cartelera entera de una sola lectura + la forma de la velada ──
  function renderCbCard() {
    var evId = S.cb.cardId || '';
    var d = cbGet('card_' + cbOrg() + '_' + (evId || 'next'), '/api/combat/card?org=' + cbOrg() + (evId ? '&id=' + encodeURIComponent(evId) : ''));
    if (!d) { cbShell(t('nav_cb_card'), cbOrgTabs() + mvLoading()); return; }
    if (d._err || !d.event) { cbShell(t('nav_cb_card'), cbOrgTabs() + '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>'); return; }
    var n = d.night || {};
    // selector de cartelera
    var sel = (d.cards || []).length > 1 ? '<div class="gx-cb-cardsel">' + (d.cards || []).map(function (c) {
      return '<span class="gx-cb-tab' + (String(c.id) === String(d.event.id) ? ' on' : '') + '" data-cbcard="' + esc(c.id) + '">' + esc(c.name.replace(/^UFC\s*/, '').slice(0, 26)) + '</span>';
    }).join('') + '</div>' : '';
    // la forma de la velada
    var mx = Math.max.apply(null, (n.finish_dist || []).map(function (x) { return x.p; }).concat(0.01));
    var dist = (n.finish_dist || []).map(function (x) {
      var hi = x.n === n.most_likely_finishes;
      return '<div class="gx-cb-ndcol"><div class="gx-cb-ndbar"><i class="' + (hi ? 'hi' : '') + '" style="height:' + Math.max(3, Math.round(x.p / mx * 120)) + 'px"></i></div><span>' + x.n + '</span><b class="gx-mono">' + Math.round(x.p * 100) + '%</b></div>';
    }).join('');
    var tile = function (lab, val) { return '<div class="gx-cb-ntile"><span class="gx-dim">' + esc(lab) + '</span><b class="gx-mono">' + val + '</b></div>'; };
    var hl = function (key, f) {
      if (!f) return '';
      var pct = Math.round((f.method.finish || 0) * 100);
      return '<div class="gx-intel-row gx-pick-clickable" data-openhash="cbfight/' + esc(d.org) + '-' + esc(f.comp_id) + '" style="grid-template-columns:minmax(0,1fr) auto">' +
        '<span class="n"><i class="gx-dim" style="font-style:normal;font-size:10px">' + esc(t(key)) + '</i><div><b>' + esc(f.f1.name) + '</b> <span class="gx-dim">vs</span> <b>' + esc(f.f2.name) + '</b></div></span>' +
        '<span class="v gx-mono">' + (key === 'cbc_gap' ? ((f.gap_pp >= 0 ? '+' : '') + f.gap_pp + 'pp') : pct + '%') + '</span></div>';
    };
    var night = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('bolt') + esc(t('cbc_night')) + '</span><span class="gx-ph-extra gx-dim">' + esc(t('cbc_sims')) + '</span></div><div class="gx-mod-body">' +
      '<div class="gx-cb-ntiles">' + tile(t('cbc_fin_exp'), n.exp_finishes + '/' + d.event.fights) + tile(t('cbc_rounds_exp'), '~' + n.exp_rounds) + '</div>' +
      '<div class="gx-label gx-cb-rdlab">' + esc(t('cbc_dist')) + '</div><div class="gx-cb-ndist">' + dist + '</div>' +
      hl('cbc_early', n.most_likely_finish) + hl('cbc_far', n.most_likely_distance) + hl('cbc_gap', n.biggest_gap) +
      '</div></div>';
    // la cartelera, pelea por pelea
    var rows = (d.fights || []).map(function (f) {
      var p1 = Math.round(f.prob.f1 * 100);
      var lead = f.prob.f1 >= 0.5 ? f.f1.name : f.f2.name;
      return '<div class="gx-cb-crow gx-pick-clickable" data-openhash="cbfight/' + esc(d.org) + '-' + esc(f.comp_id) + '">' +
        '<div class="gx-cb-cmeta">' + (f.main ? '<span class="gx-clgate ok">★</span>' : '') + '<span class="gx-dim">' + esc(f.weight || '') + ' · ' + f.rounds + 'R</span>' + (f.pick ? '<span class="gx-clgate ok">PICK</span>' : '') + '</div>' +
        '<div class="gx-cb-cnames"><b>' + esc(f.f1.name) + '</b><span class="gx-dim">vs</span><b>' + esc(f.f2.name) + '</b></div>' +
        '<div class="gx-cb-cbar"><i class="gr" style="width:' + p1 + '%"></i><i class="rd" style="width:' + (100 - p1) + '%"></i></div>' +
        '<div class="gx-cb-cfoot"><span>' + esc(lead.split(' ').pop()) + ' ' + Math.max(p1, 100 - p1) + '%</span>' +
        '<span class="gx-dim">' + esc(t('cb_finish')) + ' ' + Math.round(f.method.finish * 100) + '% · ~' + f.method.exp_rounds + 'R</span>' +
        (f.gap_pp != null && Math.abs(f.gap_pp) >= 5 ? '<span class="' + (f.gap_pp >= 0 ? 'gx-pos' : 'gx-dim') + '">' + (f.gap_pp >= 0 ? '+' : '') + f.gap_pp + 'pp</span>' : '') +
        '</div></div>';
    }).join('');
    cbShell(t('nav_cb_card'), cbOrgTabs() + sel +
      '<div class="gx-cb-evhead"><b>' + esc(d.event.name) + '</b><span class="gx-dim">' + esc(cbWhen(d.event.date)) + ' · ' + d.event.fights + ' ' + esc(t('cbb_fights_n')) + '</span></div>' +
      night + '<div class="gx-cb-cgrid">' + rows + '</div>');
  }
  // ── DAILY BRIEF DE COMBATE (R5c): el equivalente del brief de fútbol para la cartelera.
  // Qué viene, dónde discrepamos del mercado, qué señales hay y cómo venimos. Caja negra: factores.
  function renderCbBrief() {
    var d = cbGet('brief_' + cbOrg(), '/api/combat/brief?org=' + cbOrg());
    if (!d) { cbShell(t('nav_brief'), cbOrgTabs() + mvLoading()); return; }
    if (d._err) { cbShell(t('nav_brief'), cbOrgTabs() + '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>'); return; }
    var panel = function (icn, key, inner, sub) {
      return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic(icn) + esc(t(key)) + '</span>' +
        (sub ? '<span class="gx-ph-extra gx-dim">' + esc(sub) + '</span>' : '') + '</div><div class="gx-mod-body">' + inner + '</div></div>';
    };
    var none = '<div class="gx-dim gx-cb-clean">' + esc(t('cbb_none')) + '</div>';
    // próxima cartelera + las siguientes
    var nc = d.next_card;
    var head = nc ? '<div class="gx-cb-briefhero"><b>' + esc(nc.name) + '</b><span class="gx-dim">' + esc(cbWhen(nc.date)) + ' · ' + nc.fights + ' ' + esc(t('cbb_fights_n')) + '</span></div>' : none;
    var rest = (d.cards || []).slice(1).map(function (c) {
      return '<div class="gx-intel-row" style="grid-template-columns:minmax(0,1fr) auto"><span class="n">' + esc(c.name) + '</span><span class="v gx-dim" style="font-size:11px">' + esc(cbWhen(c.date, false)) + ' · ' + c.fights + '</span></div>';
    }).join('');
    // divergencias: lo que el sistema mira de esta cartelera
    var divs = (d.divergences || []).map(function (x) {
      var pos = x.gap_pp >= 0;
      return '<div class="gx-intel-row gx-pick-clickable" data-openhash="cbfight/' + esc(d.org) + '-' + esc(x.comp_id) + '" style="grid-template-columns:minmax(0,1fr) auto auto">' +
        '<span class="n"><b style="font-size:12.5px">' + esc(x.name) + '</b>' + (x.main ? ' <i class="gx-clgate ok" style="font-style:normal;font-size:9px">★</i>' : '') +
        '<div class="gx-dim" style="font-size:10.5px">' + esc(x.f1 + ' vs ' + x.f2) + ' · ' + x.books + ' ' + esc(t('cb_books_n')) + '</div></span>' +
        '<span class="v gx-mono">' + (x.odds ? '@' + Number(x.odds).toFixed(2) : '') + '</span>' +
        '<span class="v gx-mono ' + (pos ? 'gx-pos' : 'gx-dim') + '">' + (pos ? '+' : '') + x.gap_pp + 'pp</span></div>';
    }).join('');
    // señales (intel + observer), ya narradas en caja negra por el server
    var intel = (d.intel || []).map(function (f) {
      return '<div class="gx-cb-flag ' + (f.severity === 'high' ? 'hi' : '') + '"><span class="gx-cb-flagdot"></span><span>' + esc(LANG === 'en' ? f.en : f.es) + '</span></div>';
    }).join('');
    // picks del monitor + cómo venimos
    var picks = (d.picks || []).map(function (p2) {
      return '<div class="gx-intel-row gx-pick-clickable" data-openhash="cbfight/' + esc(d.org) + '-' + esc(String(p2.event.canonical_event_id).replace('cb-', '')) + '" style="grid-template-columns:minmax(0,1fr) auto auto">' +
        '<span class="n"><b style="font-size:12.5px">' + esc(p2.selection_name) + '</b><div class="gx-dim" style="font-size:10.5px">' + esc(p2.family) + ' · ' + esc(p2.event.home + ' vs ' + p2.event.away) + '</div></span>' +
        '<span class="v gx-mono">' + (p2.best_odds ? '@' + Number(p2.best_odds).toFixed(2) : '') + '</span>' +
        '<span class="v gx-mono gx-pos">' + (p2.edge_blend_pp != null ? '+' + p2.edge_blend_pp + 'pp' : '') + '</span></div>';
    }).join('');
    var rec = (d.recent || []).map(function (r) {
      return '<div class="gx-intel-row" style="grid-template-columns:minmax(0,1fr) auto"><span class="n"><span class="gx-clgate ' + (r.result === 'WIN' ? 'ok' : 'no') + '">' + (r.result === 'WIN' ? 'W' : 'L') + '</span> ' + esc(r.name) + ' <i class="gx-dim">' + esc(r.family) + '</i></span>' +
        '<span class="v gx-mono ' + (r.units > 0 ? 'gx-pos' : 'gx-dim') + '">' + (r.units > 0 ? '+' : '') + Number(r.units || 0).toFixed(2) + 'u</span></div>';
    }).join('');
    // #7: movimiento de línea — lo que importa es la DIRECCIÓN respecto a nuestra lectura
    var moves = (d.moves || []).map(function (m) {
      var cls = m.with_us === true ? 'gx-pos' : m.with_us === false ? 'rd' : 'gx-dim';
      var lab = m.with_us === true ? t('cbm_with') : m.with_us === false ? t('cbm_against') : '';
      return '<div class="gx-intel-row gx-pick-clickable" data-openhash="cbfight/' + esc(d.org) + '-' + esc(m.comp_id) + '" style="grid-template-columns:minmax(0,1fr) auto auto">' +
        '<span class="n"><b style="font-size:12.5px">' + esc(m.toward_name) + '</b>' +
        '<div class="gx-dim" style="font-size:10.5px">' + esc(m.f1 + ' vs ' + m.f2) + ' · ' + m.hours + 'h · ' + m.snapshots + ' ' + esc(t('cbm_snaps')) + '</div></span>' +
        '<span class="v gx-mono">' + (m.move_pp >= 0 ? '+' : '') + m.move_pp + 'pp</span>' +
        '<span class="v gx-mono ' + cls + '" style="font-size:10px">' + esc(lab) + '</span></div>';
    }).join('');
    var tr = d.track && d.track.total;
    var trLine = tr && tr.n ? '<div class="gx-pick-recap" style="margin-bottom:8px">' + ic('circle-check') + tr.w + '-' + tr.l + ' · ' + (tr.units >= 0 ? '+' : '') + Number(tr.units).toFixed(2) + 'u</div>' : '';
    cbShell(t('nav_brief'), cbOrgTabs() +
      panel('calendar', 'cbb_next', head + rest) +
      '<div class="gx-cb-grid">' +
      panel('target-arrow', 'cbb_div', divs || none, t('cbb_div_sub')) +
      panel('alert-triangle', 'cbb_intel', intel || none) +
      panel('bolt', 'cbb_picks', picks || none) +
      panel('trending-up', 'cbm_title', moves || '<div class="gx-dim gx-cb-clean">' + esc(t('cbm_none')) + '</div>', t('cbm_sub')) +
      panel('chart-line', 'cbb_recent', trLine + (rec || none)) +
      '</div>');
  }
  // EN VIVO (R5): la misma probabilidad del modelo, condicionada al round y al reloj. Arriba de todo,
  // porque mientras la pelea corre es LO que el usuario mira.
  function cbLivePanel(live, lp, pre, f1n, f2n) {
    if (!live || live.state !== 'in' || !lp) return '';
    var l1 = (f1n || '').split(' ').pop(), l2 = (f2n || '').split(' ').pop();
    var p1 = lp.p1, d1 = (p1 - (pre || p1)) * 100;
    var delta = function (d) { return Math.abs(d) < 0.5 ? '' : '<i class="' + (d > 0 ? 'gr' : 'rd') + '" style="font-style:normal">' + (d > 0 ? '▲' : '▼') + Math.abs(d).toFixed(1) + 'pp</i>'; };
    var tl = (live.plays || []).slice().reverse().slice(0, 14).map(function (p2) {
      return '<div class="gx-cb-tlrow"><span class="gx-mono gx-dim">R' + p2.round + (p2.clock ? ' ' + p2.clock : '') + '</span><span>' + esc(cbPlayLabel(p2.type)) + '</span></div>';
    }).join('');
    return '<div class="gx-panel gx-cb-livepanel"><div class="gx-ph"><span class="gx-label"><span class="gx-cb-livedot"></span>' + esc(t('cb_live')) + ' · R' + live.round + (live.clock ? ' ' + esc(live.clock) : '') + '</span><span class="gx-ph-extra gx-dim">' + esc(t('cb_live_sub')) + '</span></div>' +
      '<div class="gx-mod-body">' +
      '<div class="gx-cb-livebar"><i class="gr" style="width:' + Math.round(p1 * 100) + '%"></i><i class="rd" style="width:' + Math.round((1 - p1) * 100) + '%"></i></div>' +
      '<div class="gx-cb-liverow"><b class="gr">' + esc(l1) + ' ' + Math.round(p1 * 100) + '% ' + delta(d1) + '</b><b class="rd">' + delta(-d1) + ' ' + Math.round((1 - p1) * 100) + '% ' + esc(l2) + '</b></div>' +
      '<div class="gx-cb-livetiles">' +
      '<div><span class="gx-dim">' + esc(t('cb_live_fin')) + '</span><b class="gx-mono">' + Math.round(lp.finish_left * 100) + '%</b></div>' +
      '<div><span class="gx-dim">' + esc(t('cb_live_dec')) + '</span><b class="gx-mono">' + Math.round(lp.decision * 100) + '%</b></div>' +
      '<div><span class="gx-dim">' + esc(t('cb_live_left')) + '</span><b class="gx-mono">~' + lp.rounds_left + '</b></div>' +
      '<div><span class="gx-dim">' + esc(t('cb_live_pre')) + '</span><b class="gx-mono">' + Math.round((pre || 0) * 100) + '%</b></div>' +
      '</div>' +
      (tl ? '<div class="gx-label gx-cb-rdlab">' + esc(t('cb_live_tl')) + '</div><div class="gx-cb-tl">' + tl + '</div>' : '') +
      '<div class="gx-dim gx-cb-subline">' + esc(t('cb_live_note')) + '</div>' +
      '</div></div>';
  }
  // los eventos llegan en inglés y SIN dueño → se narran como hechos del combate
  var CB_PLAY_ES = { 'Round Start': 'Arranca el round', 'Round End': 'Fin del round', 'Takedown': 'Derribo', 'Takedown Attempt': 'Intento de derribo', 'Submission Attempt': 'Intento de sumisión', 'Knockdown': 'Caída', 'Reversal': 'Reversión', 'Round Pause': 'Pelea detenida', 'Round Unpause': 'Se reanuda', 'Fight Over': 'Fin del combate' };
  function cbPlayLabel(tx) { return LANG === 'en' ? tx : (CB_PLAY_ES[tx] || tx); }
  // FILM STUDY (R5): la lectura de la cinta — perfiles + el cruce ataque/vulnerabilidad
  function cbFilmPanel(film, f1n, f2n) {
    if (!film) return '';
    var pr = film.profile || {}, fi = film.findings || [];
    var l1 = (f1n || '').split(' ').pop(), l2 = (f2n || '').split(' ').pop();
    var pct = function (x) { return x == null ? '—' : Math.round(x * 100) + '%'; };
    var col = function (P, nm, cls) {
      if (!P) return '';
      var s = P.strike, g = P.grapple, tm = P.timing || {};
      var row = function (lab, val) { return '<div class="gx-cb-filmrow"><span class="gx-dim">' + esc(lab) + '</span><b class="gx-mono">' + val + '</b></div>'; };
      return '<div class="gx-cb-filmcol"><div class="gx-cb-rec5head ' + cls + '">' + esc(nm) + '</div>' +
        (s ? row(t('cb_film_pace'), s.pace != null ? s.pace.toFixed(1) + '/min' : '—') +
          row(t('cb_film_target'), s.head != null ? Math.round(s.head * 100) + '/' + Math.round((s.body || 0) * 100) + '/' + Math.round((s.legs || 0) * 100) : '—') +
          row(t('cb_film_power'), pct(s.power)) : '') +
        (g ? row(t('cb_film_gr'), (g.td15 != null ? g.td15.toFixed(1) : '—') + ' · ' + pct(g.td_def)) + row(t('cb_film_ctrl'), pct(g.ctrl)) : '') +
        row(t('cb_film_early'), pct(tm.early_win)) +
        row(t('cb_film_deep'), tm.deep_n >= 3 ? pct(tm.deep_rate) + ' <span class="gx-dim">(' + tm.deep_n + ')</span>' : '—') +
        '</div>';
    };
    var body = '<div class="gx-cb-filmgrid">' + col(pr.f1, l1, 'gr') + col(pr.f2, l2, 'rd') + '</div>' +
      (fi.length ? '<div class="gx-cb-filmfind">' + fi.map(function (x) {
        return '<div class="gx-cb-flag ' + (x.severity === 'high' ? 'hi' : '') + '"><span class="gx-cb-flagdot"></span><span>' + esc(LANG === 'en' ? x.en : x.es) + '</span></div>';
      }).join('') + '</div>' : '<div class="gx-dim gx-cb-clean">' + esc(t('cb_film_none')) + '</div>');
    return '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_film')) + '</span><span class="gx-ph-extra gx-dim">' + esc(t('cb_film_sub')) + '</span></div>' +
      '<div class="gx-mod-body">' + body + '<div class="gx-dim gx-cb-subline">' + esc(t('cb_film_what')) + '</div></div></div>';
  }
  // ── COCKPIT DE PELEA: el panel de inteligencia completo ──
  function renderCbFight() {
    var key = 'fight_' + cbOrg() + '_' + S.cb.fightId;
    var d = cbGet(key, '/api/combat/fight?id=' + encodeURIComponent(S.cb.fightId) + '&org=' + cbOrg());
    if (!d) { cbShell(t('cb_fights_title'), mvLoading(), { back: 'cbfights' }); return; }
    if (d._err || !d.fight) { cbShell(t('cb_fights_title'), '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>', { back: 'cbfights' }); return; }
    var ft = d.fight, ta = d.tale || {};
    var evline = '<div class="gx-cb-evhead"><b>' + esc(d.event.name) + '</b><span class="gx-dim">' + esc(cbWhen(d.event.date)) + '</span></div>' + cbContextChips(d.context);
    var hero = cbFightHero(d.event, Object.assign({}, ft, { prob: d.prob, method: d.method, market: d.market, pick: d.pick, odds: d.market && d.market.best ? { f1: d.market.best.f1, f2: d.market.best.f2 } : null, f1: Object.assign({}, ft.f1, ta.f1), f2: Object.assign({}, ft.f2, ta.f2) }), {});
    // TALE OF THE TAPE — el eje del enfrentamiento (barras espejadas desde el centro)
    var rows = [
      [t('cb_age'), ta.f1.age, ta.f2.age, function (x) { return x != null ? x : '—'; }],
      [t('cb_reach'), inchesNum(ta.f1.reach_in), inchesNum(ta.f2.reach_in), function (x) { return x != null ? x + '"' : '—'; }],
      [t('cb_height'), inchesNum(ta.f1.height_in), inchesNum(ta.f2.height_in), function (x) { return x != null ? Math.floor(x / 12) + "'" + (x % 12) : '—'; }],
      [t('cb_exp'), ta.f1.n_fights, ta.f2.n_fights, null],
      ['KO', ta.f1.record.ko, ta.f2.record.ko, null],
      ['SUB', ta.f1.record.sub, ta.f2.record.sub, null],
      [t('cb_streak'), ta.f1.streak, ta.f2.streak, function (x) { return (x > 0 ? 'W' : x < 0 ? 'L' : '—') + Math.abs(x || 0); }],
      ['ELO', ta.f1.elo, ta.f2.elo, null],
    ].map(function (r) { return cbTapeRow(r[0], r[1], r[2], r[3]); }).join('');
    if (d.fine && d.fine.f1 && d.fine.f2) {
      rows += cbTapeRow(t('cb_slpm'), d.fine.f1.slpm, d.fine.f2.slpm, null) +
        cbTapeRow('TD/15', d.fine.f1.td_per15, d.fine.f2.td_per15, null) +
        cbTapeRow(t('cb_ctrl'), Math.round((d.fine.f1.control_pct || 0) * 100), Math.round((d.fine.f2.control_pct || 0) * 100), function (x) { return x + '%'; }) +
        (d.fine.f1.td_def != null && d.fine.f2.td_def != null ? cbTapeRow(t('cb_tddef'), Math.round(d.fine.f1.td_def * 100), Math.round(d.fine.f2.td_def * 100), function (x) { return x + '%'; }) : '');
    }
    // #4: oficiales como CONTEXTO (rechazado como predictor, ver server). Fila propia bajo el tape.
    var off = d.officials;
    var offRow = off && (off.ref || (off.judges || []).length)
      ? '<div class="gx-cb-offrow">' +
        (off.ref ? '<span><i class="gx-dim">' + esc(t('cb_ref')) + '</i> <b>' + esc(off.ref) + '</b></span>' : '') +
        ((off.judges || []).length ? '<span><i class="gx-dim">' + esc(t('cb_judges')) + '</i> <b>' + esc(off.judges.join(' · ')) + '</b></span>' : '') +
        '</div>' : '';
    var campRow = (ta.f1.camp || ta.f2.camp)
      ? '<div class="gx-cb-taperow gx-cb-camprow"><b class="v1">' + esc(ta.f1.camp || '—') + '</b>' +
        '<div class="gx-cb-tapebar"><span>' + esc(t('cb_camp')) + '</span></div>' +
        '<b class="v2">' + esc(ta.f2.camp || '—') + '</b></div>' : '';
    var tape = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_tale')) + '</span></div><div class="gx-mod-body gx-cb-tape">' + rows + campRow + offRow + '</div></div>';
    // INTELIGENCIA — red flags (capa de observación: layoff, cambio de división, viene de KO, chin, brecha de edad)
    var intel = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_intel')) + '</span></div><div class="gx-mod-body">' +
      ((d.intel || []).length ? d.intel.map(function (x) {
        return '<div class="gx-cb-flag ' + (x.severity === 'high' ? 'hi' : '') + '"><span class="gx-cb-flagdot"></span><span>' + esc(LANG === 'en' ? x.en : x.es) + '</span></div>';
      }).join('') : '<div class="gx-dim gx-cb-clean">' + esc(t('cb_intel_none')) + '</div>') + '</div></div>';
    // ÚLTIMAS 5 de cada esquina
    var rec5 = function (list, side) {
      return '<div class="gx-cb-rec5col"><div class="gx-cb-rec5head ' + (side === 1 ? 'gr' : 'rd') + '">' + esc(side === 1 ? ft.f1.name : ft.f2.name) + '</div>' +
        (list || []).map(function (h) {
          return '<div class="gx-cb-rec5row"><span class="gx-clgate ' + (h.win ? 'ok' : 'no') + '">' + (h.win ? 'W' : 'L') + '</span><span class="gx-cb-rec5opp">' + esc(h.opponent) + '</span><span class="gx-mono gx-dim">' + esc(h.method || '') + (h.round ? ' R' + h.round : '') + '</span></div>';
        }).join('') + '</div>';
    };
    var recent = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_recent')) + '</span></div><div class="gx-mod-body gx-cb-rec5">' + rec5((d.recent || {}).f1, 1) + rec5((d.recent || {}).f2, 2) + '</div></div>';
    // H2H
    var h2h = (d.h2h || []).length ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_h2h')) + '</span></div><div class="gx-mod-body">' +
      d.h2h.map(function (x) { var wn = String(x.winner_id) === String(ft.f1.id) ? ft.f1.name : ft.f2.name; return '<div class="gx-cb-rec5row"><span class="gx-mono gx-dim">' + esc(cbWhen(x.date, false)) + '</span><b>' + esc(wn) + '</b><span class="gx-mono gx-dim">' + esc(x.method || '') + (x.round ? ' R' + x.round : '') + '</span></div>'; }).join('') + '</div></div>' : '';
    // CUOTAS POR CASA (line shopping)
    var last1 = (ft.f1.name || '').split(' ').pop(), last2 = (ft.f2.name || '').split(' ').pop();
    var bestF1 = Math.max.apply(null, (d.books || []).map(function (b) { return b.f1; }).concat(0));
    var bestF2 = Math.max.apply(null, (d.books || []).map(function (b) { return b.f2; }).concat(0));
    var books = (d.books || []).length ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_odds_by_book')) + '</span><span class="gx-ph-extra gx-dim">' + d.books.length + ' ' + esc(t('cb_books_n')) + '</span></div><div class="gx-mod-body gx-cb-books">' +
      '<div class="gx-cb-bookrow gx-cb-bookhead"><span></span><b>' + esc(last1) + '</b><b>' + esc(last2) + '</b></div>' +
      d.books.map(function (b) {
        return '<div class="gx-cb-bookrow"><span>' + esc(b.book) + '</span><b class="' + (b.f1 === bestF1 ? 'best' : '') + '">' + b.f1.toFixed(2) + '</b><b class="' + (b.f2 === bestF2 ? 'best' : '') + '">' + b.f2.toFixed(2) + '</b></div>';
      }).join('') + '</div></div>' : '';
    // R2c: método y rounds — modelo vs mercado (cuando Cloudbet cotiza la pelea)
    var cbm = '';
    if (d.cb_markets && (d.cb_markets.method || (d.cb_markets.totals || []).length)) {
      var mrows = (d.cb_markets.method || []).filter(function (m2) { return m2.key !== 'draw'; }).map(function (m2) {
        var eg2 = m2.model != null ? (m2.model - m2.market) * 100 : null;
        return '<div class="gx-cb-bookrow"><span>' + esc(m2.name) + '</span><b>' + (m2.model != null ? Math.round(m2.model * 100) + '%' : '—') + '</b><b>' + Math.round(m2.market * 100) + '% · @' + Number(m2.price).toFixed(2) + (eg2 != null && eg2 >= 2 ? ' <i class="gx-pos" style="font-style:normal">+' + eg2.toFixed(1) + 'pp</i>' : '') + '</b></div>';
      }).join('');
      var trows = (d.cb_markets.totals || []).map(function (t2) {
        var egO = t2.model_over != null ? (t2.model_over - t2.market_over) * 100 : null;
        return '<div class="gx-cb-bookrow"><span>O/U ' + t2.line + ' rounds</span><b>' + (t2.model_over != null ? Math.round(t2.model_over * 100) + '%' : '—') + '</b><b>' + Math.round(t2.market_over * 100) + '% · @' + Number(t2.over).toFixed(2) + '/' + Number(t2.under).toFixed(2) + (egO != null && Math.abs(egO) >= 2 ? ' <i class="' + (egO > 0 ? 'gx-pos' : 'gx-dim') + '" style="font-style:normal">' + (egO > 0 ? '+' : '') + egO.toFixed(1) + 'pp</i>' : '') + '</b></div>';
      }).join('');
      cbm = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_mkt_panel')) + '</span><span class="gx-ph-extra gx-dim">' + esc(t('cb_mkt_src')) + '</span></div><div class="gx-mod-body gx-cb-books mkt">' +
        '<div class="gx-cb-bookrow gx-cb-bookhead"><span></span><b>' + esc(t('cb_mkt_model')) + '</b><b>' + esc(t('cb_mkt_market')) + '</b></div>' + mrows + trows + '</div></div>';
    }
    var readP = cbReadPanel(d.gp_read, d.confidence);
    // R4: historial de estilos (Historical Match Engine)
    if (d.style_match && (d.style_match.f1 || d.style_match.f2)) {
      var sm2 = d.style_match;
      var chip2 = function (st, cls) { return st ? '<span class="gx-clgate ' + cls + '">' + esc(t('cb_style_of')) + ': ' + esc(LANG === 'en' ? st.en : st.es) + '</span>' : ''; };
      var histLine = '';
      if (sm2.hist && sm2.f1 && sm2.f2) {
        var wr = sm2.hist.f1_style_winrate;
        var aSt = wr >= 0.5 ? sm2.f1 : sm2.f2, bSt = wr >= 0.5 ? sm2.f2 : sm2.f1;
        histLine = '<div class="gx-dim gx-cb-stylehist">' + esc(t('cb_style_line', { a: (LANG === 'en' ? aSt.en : aSt.es), b: (LANG === 'en' ? bSt.en : bSt.es), pct: Math.round(Math.max(wr, 1 - wr) * 100), n: sm2.hist.n.toLocaleString() })) + '</div>';
      }
      readP += '<div class="gx-cb-stylerow">' + chip2(sm2.f1, 'ok') + chip2(sm2.f2, 'no') + histLine + '</div>';
    }
    var mxP = cbMatchupPanel(d.breakdown, ft.f1.name, ft.f2.name);
    var predP = cbPredictionPanel(d.prediction, ft.f1.name, ft.f2.name);
    var liveP = cbLivePanel(d.live, d.live_probs, d.prob && d.prob.p1, ft.f1.name, ft.f2.name);
    var filmP = cbFilmPanel(d.film, ft.f1.name, ft.f2.name);
    cbShell(t('cb_fights_title'), evline + hero + liveP + readP + '<div class="gx-cb-grid">' + predP + mxP + filmP + tape + intel + recent + h2h + books + cbm + '</div>', { back: 'cbfights' });
    // mientras la pelea corre, el cockpit se refresca solo (un único temporizador; muere al salir de la vista)
    if (d.live && d.live.state === 'in') {
      clearTimeout(S.cb._liveT);
      S.cb._liveT = setTimeout(function () {
        if (S.view !== 'cbfight') return;
        delete S.cb[key];
        renderCb('cbfight');
      }, 25000);
    }
  }
  function inchesNum(s) { if (!s) return null; var m = String(s).match(/(\d+)'\s*(\d+)?/); if (m) return (+m[1]) * 12 + (+(m[2] || 0)); var n = String(s).match(/([\d.]+)/); return n ? +n[1] : null; }
  function cbTapeRow(label, v1, v2, fmt) {
    var f = fmt || function (x) { return x != null ? x : '—'; };
    var a = Number(v1), b = Number(v2);
    var ok = isFinite(a) && isFinite(b) && (Math.abs(a) + Math.abs(b)) > 0;
    var s1 = ok ? Math.max(0.06, Math.abs(a) / (Math.abs(a) + Math.abs(b))) : 0.5;
    return '<div class="gx-cb-taperow"><b class="v1' + (ok && a > b ? ' lead' : '') + '">' + esc(String(f(v1))) + '</b>' +
      '<div class="gx-cb-tapebar"><div class="l"><i style="width:' + Math.round(s1 * 100) + '%"></i></div><span>' + esc(label) + '</span><div class="r"><i style="width:' + Math.round((1 - s1) * 100) + '%"></i></div></div>' +
      '<b class="v2' + (ok && b > a ? ' lead' : '') + '">' + esc(String(f(v2))) + '</b></div>';
  }
  // ── PELEADORES: directorio con búsqueda y filtro por división ──
  function renderCbFighters() {
    var q = S.cb.fq || '', div = S.cb.fdiv || '';
    var key = 'dir_' + cbOrg() + '_' + q + '_' + div;
    var d = cbGet(key, '/api/combat/fighters?org=' + cbOrg() + '&q=' + encodeURIComponent(q) + '&div=' + encodeURIComponent(div));
    var divs = (d && d.divisions) || S.cb.lastDivs || {};
    if (d && d.divisions) S.cb.lastDivs = d.divisions;
    var controls = '<div class="gx-cb-dirctl">' +
      '<div class="gx-cb-search">' + ic('search') + '<input id="gx-cbf-q" placeholder="' + esc(t('cb_search_ph')) + '" value="' + esc(q) + '" autocomplete="off"></div>' +
      '<select id="gx-cbf-div" class="gx-cb-select"><option value="">' + esc(t('cb_all_divs')) + '</option>' +
        Object.keys(divs).sort().map(function (dv) { return '<option value="' + esc(dv) + '"' + (dv === div ? ' selected' : '') + '>' + esc(dv) + ' (' + divs[dv] + ')</option>'; }).join('') + '</select></div>';
    var grid;
    if (!d) grid = mvLoading();
    else if (d._err) grid = '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>';
    else if (!(d.fighters || []).length) grid = '<div class="gx-panel"><div class="gx-empty">' + illo('radar') + '<b>' + esc(t('cb_no_results')) + '</b></div></div>';
    else grid = '<div class="gx-cb-dirgrid">' + d.fighters.map(cbFighterCard).join('') + '</div>';
    cbShell(t('cb_fighters_title'), cbOrgTabs() + controls + grid);
    var qi = document.getElementById('gx-cbf-q');
    if (qi) { qi.addEventListener('input', function () { clearTimeout(S.cb._qt); var val = qi.value; S.cb._qt = setTimeout(function () { S.cb.fq = val.trim(); renderCb('cbfighters'); }, 320); });
      if (S.cb._focusQ) { qi.focus(); try { qi.setSelectionRange(qi.value.length, qi.value.length); } catch (e) {} } S.cb._focusQ = true; }
    var ds = document.getElementById('gx-cbf-div');
    if (ds) ds.addEventListener('change', function () { S.cb.fdiv = ds.value; S.cb._focusQ = false; renderCb('cbfighters'); });
  }
  function cbFighterCard(f) {
    var stk = f.streak > 1 ? '<span class="gx-cb-stk w">W' + f.streak + '</span>' : (f.streak < -1 ? '<span class="gx-cb-stk l">L' + (-f.streak) + '</span>' : '');
    return '<a class="gx-cb-fcard" href="#cbfighter/' + cbOrg() + '-' + esc(String(f.id)) + '">' +
      cbAva(f, 1, 'dir') +
      '<div class="gx-cb-fcard-nm">' + esc(f.name || '') + stk + '</div>' +
      (f.nick ? '<div class="gx-cb-fcard-nick">"' + esc(f.nick) + '"</div>' : '') +
      '<div class="gx-cb-fcard-meta">' + esc(f.division || '—') + '</div>' +
      '<div class="gx-cb-fcard-stats"><span>' + f.record.w + '-' + f.record.l + '</span><span class="elo">' + f.elo + '</span></div>' +
      cbForm(f.form) + '</a>';
  }
  // ── PERFIL DE PELEADOR (ampliado: edad real, curva de Elo, divisiones, oposición) ──
  function renderCbFighter() {
    var key = 'fp_' + cbOrg() + '_' + S.cb.fighterId;
    var d = cbGet(key, '/api/combat/fighter?id=' + encodeURIComponent(S.cb.fighterId) + '&org=' + cbOrg());
    if (!d) { cbShell(t('cb_fighters_title'), mvLoading(), { back: 'cbfighters', backLabel: 'cb_fighters_title' }); return; }
    if (d._err || !d.fighter) { cbShell(t('cb_fighters_title'), '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>', { back: 'cbfighters', backLabel: 'cb_fighters_title' }); return; }
    var f = d.fighter, s = d.summary || {}, ms = d.method_split || {};
    var bio = [];
    if (f.nick) bio.push('"' + f.nick + '"');
    if (s.age != null) bio.push(s.age + ' ' + (LANG === 'en' ? 'yrs' : 'años'));
    if (f.height_in) bio.push(String(f.height_in));
    if (f.reach_in) bio.push(String(f.reach_in) + ' ' + t('cb_reach'));
    if (s.stance) bio.push(s.stance);
    if (f.country) bio.push(f.country);
    var isFl = cbIsFollowed(S.cb.fighterId);
    var followBtn = '<button class="gx-cb-followbtn' + (isFl ? ' on' : '') + '" data-cbfollow=\'' + esc(JSON.stringify({ id: String(s.id || S.cb.fighterId), org: cbOrg(), name: s.name || '', headshot: s.headshot || '', record: s.record || null, division: s.division || null })) + '\'>' + (isFl ? esc(t('cb_following')) : '★ ' + esc(t('cb_follow_btn'))) + '</button>';
    var finish = s.record && s.record.w ? Math.round((s.record.ko + s.record.sub) / s.record.w * 100) : null;
    var tile = function (lab, val) { return '<div class="gx-cb-tile"><div class="gx-mono gx-cb-tileval">' + val + '</div><div class="gx-label">' + lab + '</div></div>'; };
    var tiles = '<div class="gx-cb-tiles">' + tile('ELO', s.elo || '—') + tile(esc(t('cb_exp')).toUpperCase(), (s.record || {}).w + '-' + (s.record || {}).l) + tile('KO', (s.record || {}).ko) + tile('SUB', (s.record || {}).sub) +
      (finish != null ? tile('FINISH', finish + '%') : '') + (s.age != null ? tile(esc(t('cb_age')).toUpperCase(), s.age) : '') +
      tile(esc(t('cb_cage_min')).toUpperCase(), s.cage_min || 0) + (d.opposition_elo ? tile(esc(t('cb_opp_quality')).toUpperCase(), d.opposition_elo) : '') + '</div>';
    var wDec = Math.max(0, (ms.wins || 0) - (ms.winKo || 0) - (ms.winSub || 0));
    var mBar = function (lab, v, tot, cls) { var pct = tot ? Math.round(v / tot * 100) : 0; return '<div class="gx-cb-mrow"><span>' + lab + '</span><div class="gx-cb-mbar"><i class="' + cls + '" style="width:' + pct + '%"></i></div><b>' + v + ' · ' + pct + '%</b></div>'; };
    var meth = ms.wins ? '<div class="gx-cb-meth wide"><div class="gx-label">' + esc(t('cb_method')) + '</div>' + mBar('KO', ms.winKo || 0, ms.wins, 'ko') + mBar('SUB', ms.winSub || 0, ms.wins, 'sub') + mBar('DEC', wDec, ms.wins, 'dec') + '</div>' : '';
    var divs = Object.keys(d.divisions || {}).length ? '<div class="gx-cb-divchips">' + Object.entries(d.divisions).sort(function (a, b) { return b[1] - a[1]; }).map(function (x) { return '<span class="gx-clgate sh">' + esc(x[0]) + ' · ' + x[1] + '</span>'; }).join('') + '</div>' : '';
    var hero = '<div class="gx-cb-hero"><div class="gx-cb-fphero">' + cbAva({ name: s.name, headshot: s.headshot }, 1, 'xl') +
      '<div class="gx-cb-fpmain"><div class="gx-cb-fpname">' + esc(s.name || '') + followBtn + '</div>' +
      '<div class="gx-dim gx-cb-subline">' + esc(bio.join(' · ')) + '</div>' +
      '<div class="gx-dim gx-cb-subline">' + esc(s.division || '') + ' · ' + (s.n_fights || 0) + ' ' + esc(t('cb_fights_n')) + (s.last_fight ? ' · ' + esc(t('cb_last')) + ' ' + esc(cbWhen(s.last_fight, false)) : '') + '</div>' +
      tiles + meth + divs + '</div></div></div>';
    var chart = (d.elo_series || []).length > 2 ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">ELO</span><span class="gx-ph-extra gx-dim">' + d.elo_series.length + ' ' + esc(t('cb_fights_n')) + '</span></div><div class="gx-mod-body">' + cbEloChart([{ series: d.elo_series, name: s.name }], 640, 180) + '</div></div>' : '';
    var hist = (d.history || []).map(function (h) {
      var chip = h.nc ? '<span class="gx-clgate sh">NC</span>' : (h.win ? '<span class="gx-clgate ok">W</span>' : '<span class="gx-clgate no">L</span>');
      return '<a class="gx-cb-bout lnk" href="#cbfighter/' + cbOrg() + '-' + esc(String(h.opponent.id || '')) + '">' + chip + cbAva(h.opponent, h.win ? 2 : 1) +
        '<div class="gx-cb-bnames"><b>vs ' + esc(h.opponent.name || '') + '</b><span class="gx-dim">' + esc(h.event || '') + ' · ' + esc(h.weight || '') + '</span></div>' +
        '<span class="gx-mono gx-dim gx-cb-histmeta">' + esc(h.method || '') + (h.round ? ' · R' + h.round : '') + ' · ' + esc(cbWhen(h.date, false)) + '</span></a>';
    }).join('');
    // R3 — Momentum / Calidad de victorias / Ritmo y fondo / Similares
    var mom = d.momentum || {};
    var recTxt = function (r) { return r ? r.w + '-' + r.l : '—'; };
    var momP = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_momentum')) + '</span>' +
      (mom.delta_12m != null ? '<span class="gx-ph-extra gx-mono ' + (mom.delta_12m >= 0 ? 'gx-cb-up' : 'gx-cb-down') + '">' + (mom.delta_12m >= 0 ? '▲ +' : '▼ ') + mom.delta_12m + ' Elo · ' + esc(t('cb_mom_delta')) + '</span>' : '') + '</div>' +
      '<div class="gx-mod-body gx-cb-tiles">' +
      '<div class="gx-cb-tile"><div class="gx-mono gx-cb-tileval">' + recTxt(mom.l3) + '</div><div class="gx-label">L3</div></div>' +
      '<div class="gx-cb-tile"><div class="gx-mono gx-cb-tileval">' + recTxt(mom.l5) + '</div><div class="gx-label">L5</div></div>' +
      '<div class="gx-cb-tile"><div class="gx-mono gx-cb-tileval">' + recTxt(mom.l10) + '</div><div class="gx-label">L10</div></div>' + '</div></div>';
    var q = d.quality || {};
    var qTop = (q.top_wins || []).map(function (w2) {
      return '<a class="gx-cb-bout lnk" href="#cbfighter/' + cbOrg() + '-' + esc(String(w2.id)) + '"><span class="gx-clgate ok">W</span>' +
        '<div class="gx-cb-bnames"><b>' + esc(w2.name) + '</b><span class="gx-dim">' + esc(w2.method || '') + ' · ' + esc(cbWhen(w2.date, false)) + '</span></div><span class="gx-mono" style="color:var(--gx-ac)">' + w2.elo + '</span></a>';
    }).join('');
    var qP = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_quality')) + '</span>' +
      '<span class="gx-ph-extra gx-dim">' + (q.elite_wins || 0) + ' ' + esc(t('cb_q_elite')) + ' · ' + (q.strong_wins || 0) + ' ' + esc(t('cb_q_strong')) + '</span></div>' +
      '<div class="gx-mod-body">' + (qTop || '<div class="gx-dim gx-cb-clean">—</div>') + '</div></div>';
    var pc = d.pace || {};
    var pcP = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_pace')) + '</span></div><div class="gx-mod-body gx-cb-tiles">' +
      (pc.r1_finish_rate != null ? '<div class="gx-cb-tile"><div class="gx-mono gx-cb-tileval">' + Math.round(pc.r1_finish_rate * 100) + '%</div><div class="gx-label">' + esc(t('cb_pace_r1')) + '</div></div>' : '') +
      (pc.deep_water ? '<div class="gx-cb-tile"><div class="gx-mono gx-cb-tileval">' + pc.deep_water.w + '-' + pc.deep_water.l + '</div><div class="gx-label">' + esc(t('cb_pace_deep')) + '</div></div>' : '') +
      (pc.distance_rate != null ? '<div class="gx-cb-tile"><div class="gx-mono gx-cb-tileval">' + Math.round(pc.distance_rate * 100) + '%</div><div class="gx-label">' + esc(t('cb_pace_dist')) + '</div></div>' : '') + '</div></div>';
    var simP = (d.similar || []).length ? '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_similar')) + '</span></div><div class="gx-mod-body gx-cb-dirgrid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))">' +
      d.similar.map(function (sf) {
        return '<a class="gx-cb-fcard" href="#cbfighter/' + cbOrg() + '-' + esc(String(sf.id)) + '">' + cbAva(sf, 1, 'dir') +
          '<div class="gx-cb-fcard-nm">' + esc(sf.name) + '</div><div class="gx-cb-fcard-meta">' + esc(sf.division || '') + ' · ' + (sf.record ? sf.record.w + '-' + sf.record.l : '') + '</div>' +
          '<div class="gx-cb-fcard-stats"><span class="elo">' + Math.round(sf.sim * 100) + '% ' + esc(t('cb_sim_pct')) + '</span></div></a>';
      }).join('') + '</div></div>' : '';
    var histP = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_recent')) + ' · ' + (d.history || []).length + '</span></div><div class="gx-mod-body">' + hist + '</div></div>';
    // R4b: STRIKING + GRAPPLING engines (stats finas api-sports, era moderna)
    var fineP = '';
    if (d.fine) {
      var fn = d.fine;
      var fbar = function (lab, v, col) { return '<div class="gx-cb-mrow"><span style="width:74px">' + lab + '</span><div class="gx-cb-mbar"><i style="width:' + Math.round((v || 0) * 100) + '%;background:' + col + '"></i></div><b>' + Math.round((v || 0) * 100) + '%</b></div>'; };
      var stTile = function (lab, val) { return '<div class="gx-cb-tile"><div class="gx-mono gx-cb-tileval">' + val + '</div><div class="gx-label">' + lab + '</div></div>'; };
      fineP = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_striking')) + '</span><span class="gx-ph-extra gx-dim">' + fn.n + ' ' + esc(t('cb_fine_n')) + '</span></div>' +
        '<div class="gx-mod-body"><div class="gx-cb-tiles">' + stTile(esc(t('cb_slpm')).toUpperCase(), fn.slpm) + stTile(esc(t('cb_kd15')).toUpperCase(), fn.kd_per15) + stTile(esc(t('cb_power')).toUpperCase(), Math.round((fn.power_pct || 0) * 100) + '%') + '</div>' +
        '<div style="max-width:430px;margin-top:10px;display:flex;flex-direction:column;gap:3px">' +
        fbar(esc(t('cb_head')), fn.head_pct, 'var(--gx-ac,#1FE3A4)') + fbar(esc(t('cb_body')), fn.body_pct, '#5aa7ff') + fbar(esc(t('cb_legs')), fn.legs_pct, '#E8C468') + '</div></div></div>' +
        '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_grappling')) + '</span><span class="gx-ph-extra gx-dim">' + esc(t('cb_fine_src')) + '</span></div>' +
        '<div class="gx-mod-body gx-cb-tiles">' + stTile(esc(t('cb_td15')).toUpperCase(), fn.td_per15) +
        (fn.td_acc != null ? stTile(esc(t('cb_tdacc')).toUpperCase(), Math.round(fn.td_acc * 100) + '%') : '') +
        (fn.td_def != null ? stTile(esc(t('cb_tddef')).toUpperCase(), Math.round(fn.td_def * 100) + '%') : '') +
        stTile(esc(t('cb_sub15')).toUpperCase(), fn.sub_per15) + stTile(esc(t('cb_ctrl')).toUpperCase(), Math.round((fn.control_pct || 0) * 100) + '%') + '</div></div>';
    }
    cbShell(t('cb_fighters_title'), hero + chart + '<div class="gx-cb-grid">' + fineP + momP + pcP + qP + simP + '</div>' + histP, { back: 'cbfighters', backLabel: 'cb_fighters_title' });
  }
  // línea de Elo (SVG propio, sin librerías): eje temporal real, área bajo la curva, punto final
  function cbEloChart(items, w, h) {
    var all = []; items.forEach(function (it) { (it.series || []).forEach(function (p) { all.push(p); }); });
    if (all.length < 2) return '';
    var t0 = Math.min.apply(null, all.map(function (p) { return Date.parse(p.d); }));
    var t1 = Math.max.apply(null, all.map(function (p) { return Date.parse(p.d); }));
    var r0 = Math.min.apply(null, all.map(function (p) { return p.r; })) - 20;
    var r1 = Math.max.apply(null, all.map(function (p) { return p.r; })) + 20;
    var X = function (d) { return 34 + (Date.parse(d) - t0) / Math.max(1, t1 - t0) * (w - 44); };
    var Y = function (r) { return 8 + (1 - (r - r0) / Math.max(1, r1 - r0)) * (h - 30); };
    var cols = ['#1FE3A4', '#5aa7ff', '#b98cff', '#E8C468', '#FF7A7A', '#4be0d8', '#f19ad2', '#9be25f', '#ff9d5c', '#8fa8ff'];
    var lines = items.map(function (it, i) {
      var pts = (it.series || []).map(function (p) { return X(p.d).toFixed(1) + ',' + Y(p.r).toFixed(1); }).join(' ');
      var lastP = it.series[it.series.length - 1];
      var area = items.length === 1 ? '<polygon points="' + X(it.series[0].d).toFixed(1) + ',' + (h - 22) + ' ' + pts + ' ' + X(lastP.d).toFixed(1) + ',' + (h - 22) + '" fill="rgba(31,227,164,.08)"/>' : '';
      return area + '<polyline points="' + pts + '" fill="none" stroke="' + cols[i % cols.length] + '" stroke-width="2" stroke-linejoin="round"/>' +
        '<circle cx="' + X(lastP.d).toFixed(1) + '" cy="' + Y(lastP.r).toFixed(1) + '" r="3.4" fill="' + cols[i % cols.length] + '"/>';
    }).join('');
    var y0 = new Date(t0).getFullYear(), y1 = new Date(t1).getFullYear();
    return '<svg class="gx-cb-elochart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<line x1="34" y1="' + (h - 22) + '" x2="' + (w - 8) + '" y2="' + (h - 22) + '" stroke="rgba(255,255,255,.12)"/>' +
      '<text x="4" y="14" fill="#5F747B" font-size="10">' + Math.round(r1 - 20) + '</text><text x="4" y="' + (h - 26) + '" fill="#5F747B" font-size="10">' + Math.round(r0 + 20) + '</text>' +
      '<text x="34" y="' + (h - 8) + '" fill="#5F747B" font-size="10">' + y0 + '</text><text x="' + (w - 40) + '" y="' + (h - 8) + '" fill="#5F747B" font-size="10">' + y1 + '</text>' +
      lines + '</svg>';
  }
  // ── SIMULADOR: dos esquinas, cualquier par de la base ──
  function cbSimCorner(slot, fighter, side) {
    var lab = side === 1 ? t('cb_sim_a') : t('cb_sim_b');
    if (fighter) {
      return '<div class="gx-cb-simcorner ' + (side === 1 ? 'gr' : 'rd') + '"><div class="gx-label">' + esc(lab) + '</div>' +
        cbAva(fighter, side) + '<div class="gx-cb-nm">' + esc(fighter.name) + '</div>' +
        '<div class="gx-cb-rec">' + (fighter.record ? fighter.record.w + '-' + fighter.record.l : '') + ' · ' + esc(fighter.division || '') + '</div>' +
        '<button class="gx-clgate sh" data-cbsimclear="' + (side === 1 ? 'simA' : 'simB') + '">✕</button></div>';
    }
    return '<div class="gx-cb-simcorner ' + (side === 1 ? 'gr' : 'rd') + ' empty"><div class="gx-label">' + esc(lab) + '</div>' +
      '<div class="gx-cb-simsearch">' + ic('search') + '<input data-cbsimq="' + slot + '" placeholder="' + esc(t('cb_search_ph')) + '" autocomplete="off"><div class="gx-cb-simres" id="gx-simres-' + slot + '" hidden></div></div></div>';
  }
  function cbSimPick(slot, f) { S.cb[slot === 'a' ? 'simA' : 'simB'] = f; S.cb.simRes = undefined; renderCb('cbsim'); }
  function renderCbSim() {
    var a = S.cb.simA, b = S.cb.simB;
    var corners = '<div class="gx-cb-simgrid">' + cbSimCorner('a', a, 1) +
      '<div class="gx-cb-simmid"><div class="gx-cb-vs">VS</div>' + (a && b ? '<button class="gx-clgate sh" data-cbsimswap="1">⇄ ' + esc(t('cb_sim_swap')) + '</button>' : '') + '</div>' +
      cbSimCorner('b', b, 2) + '</div>';
    var result = '';
    if (a && b) {
      var key = 'sim_' + cbOrg() + '_' + a.id + '_' + b.id;
      if (S.cb.simRes === undefined) { S.cb.simRes = null; delete S.cb[key]; }
      var d = cbGet(key, '/api/combat/sim?org=' + cbOrg() + '&f1=' + encodeURIComponent(a.id) + '&f2=' + encodeURIComponent(b.id));
      if (d && !d._err) {
        S.cb.simRes = d;
        var p1 = Math.round((d.prob.p1 || 0.5) * 100);
        var rows = [
          [t('cb_age'), (d.tale.f1 || {}).age, (d.tale.f2 || {}).age, null],
          [t('cb_reach'), inchesNum((d.tale.f1 || {}).reach_in), inchesNum((d.tale.f2 || {}).reach_in), function (x) { return x != null ? x + '"' : '—'; }],
          [t('cb_exp'), (d.tale.f1 || {}).n_fights, (d.tale.f2 || {}).n_fights, null],
          ['ELO', (d.tale.f1 || {}).elo, (d.tale.f2 || {}).elo, null],
        ].map(function (r) { return cbTapeRow(r[0], r[1], r[2], r[3]); }).join('');
        result = '<div class="gx-cb-hero"><div class="gx-cb-mid" style="max-width:460px;margin:0 auto"><div class="gx-label gx-cb-problab">' + esc(t('cb_gpprob')) + '</div>' +
          '<div class="gx-cb-bar"><i style="width:' + p1 + '%"></i></div>' +
          '<div class="gx-cb-pcts"><span>' + esc((a.name || '').split(' ').pop()) + ' ' + p1 + '%</span><span class="p2">' + (100 - p1) + '% ' + esc((b.name || '').split(' ').pop()) + '</span></div>' +
          '<div class="gx-dim gx-cb-subline">Elo ' + d.prob.r1 + ' · ' + d.prob.r2 + ' · ' + esc(d.weight || '') + '</div>' + cbMethod(d.method) + '</div></div>' +
          cbReadPanel(d.gp_read, d.confidence) +
          '<div class="gx-cb-grid">' + cbPredictionPanel(d.prediction, a.name, b.name) + cbMatchupPanel(d.breakdown, a.name, b.name) + '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_tale')) + '</span></div><div class="gx-mod-body gx-cb-tape">' + rows + '</div></div>' +
          '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_intel')) + '</span></div><div class="gx-mod-body">' +
          ((d.intel || []).length ? d.intel.map(function (x) { return '<div class="gx-cb-flag ' + (x.severity === 'high' ? 'hi' : '') + '"><span class="gx-cb-flagdot"></span><span>' + esc(LANG === 'en' ? x.en : x.es) + '</span></div>'; }).join('') : '<div class="gx-dim gx-cb-clean">' + esc(t('cb_intel_none')) + '</div>') + '</div></div></div>';
      } else if (d && d._err) result = '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>';
      else result = mvLoading();
    } else {
      result = '<div class="gx-panel"><div class="gx-empty">' + illo('radar') + '<b>' + esc(t('cb_sim_pick')) + '</b></div></div>';
    }
    cbShell(t('cb_sim_title'), cbOrgTabs() + corners + result);
    // wiring de los buscadores de esquina
    [].forEach.call(document.querySelectorAll('[data-cbsimq]'), function (inp) {
      var slot = inp.getAttribute('data-cbsimq');
      inp.addEventListener('input', function () {
        clearTimeout(S.cb._st); var val = inp.value.trim();
        S.cb._st = setTimeout(function () {
          if (val.length < 2) return;
          fetch('/api/combat/fighters?org=' + cbOrg() + '&q=' + encodeURIComponent(val), { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
            var box = document.getElementById('gx-simres-' + slot); if (!box) return;
            var list = (j && j.fighters || []).slice(0, 8);
            box.hidden = !list.length;
            box.innerHTML = list.map(function (f) {
              return '<div class="gx-cb-simhit" data-cbsimpick="' + slot + '" data-cbsimf=\'' + esc(JSON.stringify({ id: String(f.id), name: f.name, headshot: f.headshot, record: f.record, division: f.division, elo: f.elo })) + '\'>' + cbAva(f, 1) + '<span>' + esc(f.name) + '</span><span class="gx-mono gx-dim">' + f.elo + '</span></div>';
            }).join('');
          });
        }, 280);
      });
    });
  }
  // ── OPORTUNIDADES: espejo EXACTO del board de fútbol (orden Alexis 28-jul: mismo formato, misma
  // gramática — seg Todos/En vivo/Próximos + chips Picks del día/Value/Arbitraje + pickCard/gx-table/arbCard
  // REUSADOS tal cual vía adaptador, el precedente de clubes). Todo monitor privado (admin).
  function cbShapePick(p2) { // adaptador: pick de combate → shape que consume el pickCard del fútbol
    var org2 = p2.league === 'mma' ? 'mma' : 'ufc';
    var stE = S.cb['state_' + org2]; var st = stE && stE.v; // avatares desde el estado de peleas si está cargado (barato, opcional)
    var avas = null;
    if (st && st.cards) for (var i = 0; i < st.cards.length; i++) {
      var ftx = st.cards[i].fights.find(function (f) { return 'cb-' + f.comp_id === p2.event.canonical_event_id; });
      if (ftx) { avas = { h: (ftx.f1 || {}).headshot || null, a: (ftx.f2 || {}).headshot || null }; break; }
    }
    var eg = p2.edge_blend_pp != null ? Number(p2.edge_blend_pp) : null;
    return {
      family: p2.family || 'FIGHT', selection_name: p2.selection_name,
      competition_name: (org2 === 'mma' ? 'PFL / MMA' : 'UFC') + (p2.card_slot === 'main' ? ' · Main event' : ''),
      kickoff: p2.event.kickoff_at, home: p2.event.home, away: p2.event.away,
      home_team_id: null, away_team_id: null, cb_avas: avas,
      cb_hash: 'cbfight/' + org2 + '-' + String(p2.event.canonical_event_id).replace(/^cb-/, ''),
      odds: p2.best_odds, book: p2.best_book, confidence: p2.blend_prob,
      why_es: p2.why_es, why_en: p2.why_en,
      signals: { regime: 'monitor', win_prob: p2.blend_prob, edge_pp: eg,
        data_confidence: (p2.books || 0) >= 12 ? 'high' : 'med',
        pick_quality: eg >= 5 ? 'strong' : eg >= 3 ? 'moderate' : 'marginal' },
    };
  }
  function cbOppFilter(list, getDate) { // Todos / En vivo / Próximos (estado por reloj)
    var f = S.cb.oppFilt || 'all';
    if (f === 'all') return list;
    var now = Date.now();
    return list.filter(function (x) {
      var ko = Date.parse(getDate(x) || 0);
      if (f === 'live') return ko <= now && now - ko < 7 * 3600e3; // cartelera en curso
      return ko > now;
    });
  }
  function renderCbOpps() {
    var d = cbGet('opps_' + cbOrg(), '/api/combat/opps?org=' + cbOrg());
    cbGet('state_' + cbOrg(), '/api/combat/state?org=' + cbOrg()); // avatares para las pick cards (llegan y repintan)
    var sub = S.cb.oppSub || 'picks';
    // cabecera = la MISMA gramática del board de fútbol (gx-ohead + gx-seg + gx-prodchip)
    var head = '<div class="gx-ohead" style="margin:0">' +
      '<div class="gx-seg">' + [['all', t('all')], ['live', t('live_f')], ['up', t('upcoming_f')]].map(function (x) {
        return '<button data-cbfilt="' + x[0] + '" class="' + ((S.cb.oppFilt || 'all') === x[0] ? 'on' : '') + '">' + esc(x[1]) + '</button>';
      }).join('') + '</div>' +
      '<div style="display:flex;gap:8px">' + [['picks', t('picks')], ['value', t('value')], ['arb', t('arb')]].map(function (x) {
        return '<span class="gx-prodchip' + (sub === x[0] ? ' on' : '') + '" data-cbsub="' + x[0] + '">' + esc(x[1]) + '</span>';
      }).join('') + '</div></div>';
    if (!d) { cbShell(t('cb_opps_title'), cbOrgTabs() + head + mvLoading()); return; }
    if (d._err) { cbShell(t('cb_opps_title'), cbOrgTabs() + head + '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>'); return; }
    var tr = (d.track || {}).total || {};
    var inner = '';
    if (sub === 'picks') {
      var picks = cbOppFilter(d.picks || [], function (p2) { return p2.event.kickoff_at; })
        .slice().sort(function (a, b) { return (b.blend_prob || 0) - (a.blend_prob || 0); });
      var countTxt = picks.length + ' ' + t(picks.length === 1 ? 'pf_count1' : 'pf_count');
      var body;
      if (!picks.length) body = '<div class="gx-empty">' + illo('tickets') + '<b>' + esc(t('cb_no_picks')) + '</b></div>';
      else {
        var shaped = picks.map(cbShapePick);
        body = '<div class="gx-pick-ofday"><div class="gx-label gx-pod-label">★ ' + esc(t('pf_pick_of_day')) + '</div>' + pickCard(shaped[0], {}) + '</div>' +
          (shaped.length > 1 ? '<div class="gx-label gx-pod-label" style="margin-top:14px">' + esc(t('pf_today')) + ' · ' + (shaped.length - 1) + '</div>' + shaped.slice(1).map(function (p3) { return pickCard(p3, {}); }).join('') : '');
      }
      inner = '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('board')) + '</span><span class="gx-ph-extra">' + esc(countTxt) +
        (tr.n ? ' · ' + tr.w + 'W-' + tr.l + 'L · ' + (tr.units >= 0 ? '+' : '') + tr.units + 'u' : '') + '</span></div><div class="gx-mod-body">' + body + '</div></div>';
    } else if (sub === 'value') {
      // MISMO formato del Value de fútbol: tabla desktop + gx-mcard móvil, señal por umbrales de la casa (8/5/2.5)
      var vals = cbOppFilter(d.value || [], function (v2) { return v2.date; }).map(function (v2) {
        var edgePp = (v2.model - v2.fair) * 100;
        return { v: v2, edgePp: edgePp, cls: edgePp >= 8 ? 'STRONG' : edgePp >= 5 ? 'LEAN' : edgePp >= 2.5 ? 'WATCH' : 'PASS' };
      });
      vals.sort(function (a, b) { return b.edgePp - a.edgePp; });
      if (!vals.length) inner = '<div class="gx-panel gx-board"><div class="gx-mod-body"><div class="gx-empty">' + ic('trending-up') + '<b>' + esc(t('opp_value_empty')) + '</b>' + esc(t('opp_value_empty_sub')) + '</div></div></div>';
      else {
        var cbFl = function (head) { return '<span class="fl">' + (head ? '<img class="clx" src="' + esc(head) + '" alt="" style="border-radius:50%;object-position:top" onerror="this.remove()">' : '') + '</span>'; };
        var desk = '<table class="gx-table"><thead><tr><th class="l">' + esc(t('th_match')) + '</th><th class="l">' + esc(t('th_signal')) + '</th><th>GP</th><th>' + esc(t('hero_mkt')) + '</th><th>' + esc(t('th_price')) + '</th><th>' + esc(t('th_edge')) + '</th><th class="l">' + esc(t('th_state')) + '</th><th class="l">' + esc(t('col_provider')) + '</th></tr></thead><tbody>' +
          vals.map(function (x) { var v2 = x.v; return '<tr class="gx-row gx-pick-clickable" data-openhash="cbfight/' + esc(cbOrg()) + '-' + esc(v2.comp_id) + '">' +
            '<td class="l"><div class="gx-cell-team">' + cbFl(v2.head) + '<div class="gx-teamnames"><b>' + esc(v2.name) + '</b><span>' + esc(v2.fight) + ' · ' + esc(cbOrgLab()) + '</span></div></div></td>' +
            '<td class="l">' + (sigBadge(x.cls) || '—') + '</td>' +
            '<td class="gx-mono gx-gp"><span class="hi">' + pct0(v2.model) + '</span></td><td class="gx-mono gx-dim">' + pct0(v2.fair) + '</td>' +
            '<td class="gx-mono gx-best"><span class="hi">' + odd(v2.odds) + '</span></td>' +
            '<td class="gx-edge ' + (x.edgePp > 0 ? 'gx-pos' : 'gx-dim') + '">' + pp(x.edgePp / 100) + '</td>' +
            '<td class="l">' + (v2.ev_pct >= 2 ? '<span class="gx-badge gx-b-strong">' + esc(t('opp_actionable')) + '</span>' : '<span class="gx-dim" style="font-size:11px">' + esc(t('opp_watch_only')) + '</span>') + '</td>' +
            '<td class="l gx-dim" style="font-size:11px">' + bookLogo(v2.book) + esc(prettyBook(v2.book) || '—') + (v2.model > 0 && v2.odds > 1 ? ' ' + stakeCalcBtn(v2.model, Number(v2.odds), v2.name + ' · ' + v2.fight, 'gp') : '') + '</td></tr>'; }).join('') + '</tbody></table>';
        var mob = vals.map(function (x) { var v2 = x.v; return '<div class="gx-mcard" data-openhash="cbfight/' + esc(cbOrg()) + '-' + esc(v2.comp_id) + '"><div class="gx-mcard-top">' + (sigBadge(x.cls) || '') + '<span class="gx-spacer"></span>' + (v2.ev_pct >= 2 ? '<span class="gx-badge gx-b-strong">' + esc(t('opp_actionable')) + '</span>' : '') + '</div>' +
          '<div class="gx-cell-team" style="margin:6px 0">' + cbFl(v2.head) + '<div class="gx-teamnames"><b>' + esc(v2.name) + '</b><span>' + esc(v2.fight) + ' · ' + esc(cbOrgLab()) + '</span></div></div>' +
          '<div class="gx-mcard-foot"><span class="gx-mono">GP ' + pct0(v2.model) + ' · ' + esc(t('th_price')) + ' ' + odd(v2.odds) + '</span><span class="gx-edge ' + (x.edgePp > 0 ? 'gx-pos' : 'gx-dim') + '">' + pp(x.edgePp / 100) + '</span></div>' +
          (v2.model > 0 && v2.odds > 1 ? '<div class="gx-calc-row">' + stakeCalcBtn(v2.model, Number(v2.odds), v2.name + ' · ' + v2.fight, 'gp') + '</div>' : '') + '</div>'; }).join('');
        inner = '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('board')) + '</span><span class="gx-ph-extra gx-dim">' + esc(t('cb_value_sub')) + '</span></div><div class="gx-mod-body"><div class="gx-bd-desk">' + desk + '</div><div class="gx-bd-mob">' + mob + '</div></div></div>';
      }
    } else {
      // MISMO formato del Arbitraje de fútbol: cards con patas + ROI, o el estado "0 ejecutables es un resultado válido"
      var arbs = cbOppFilter(d.arbs || [], function (a2) { return a2.date; });
      var evald = (d.value || []).length + (d.picks || []).length;
      if (!arbs.length) inner = '<div class="gx-panel gx-board"><div class="gx-mod-body"><div class="gx-empty"><div class="gx-arb-scan-ic">' + ic('arrows-left-right') + '</div><b>' + esc(t('opp_arb_na')) + '</b>' +
        '<span class="gx-dim">' + evald + ' ' + esc(t('opp_arb_evaluated')) + ' · 0 ' + esc(t('opp_arb_executable')) + '</span><span class="gx-dim" style="font-size:11.5px">' + esc(t('opp_arb_note')) + '</span></div></div></div>';
      else inner = '<div class="gx-panel gx-board"><div class="gx-mod-body">' + arbs.map(function (a2) {
        var stake1 = Math.round(100 / a2.f1.odds / (1 / a2.f1.odds + 1 / a2.f2.odds));
        return '<div class="gx-arb-card gx-arb-exe gx-pick-clickable" data-openhash="cbfight/' + esc(cbOrg()) + '-' + esc(a2.comp_id) + '">' +
          '<div class="gx-pick-top"><span class="gx-pick-fam gx-fam-pure">' + ic('arrows-left-right') + esc(t('arb_fam_pure')) + '</span><span class="gx-pick-time">' + esc(cbOrgLab()) + ' · ' + esc(cbWhen(a2.date)) + '</span></div>' +
          '<div class="gx-arb-match"><span class="fl">' + (a2.f1.head ? '<img class="clx" src="' + esc(a2.f1.head) + '" alt="" style="border-radius:50%;object-position:top" onerror="this.remove()">' : '') + '</span><b>' + esc(a2.fight) + '</b><span class="fl">' + (a2.f2.head ? '<img class="clx" src="' + esc(a2.f2.head) + '" alt="" style="border-radius:50%;object-position:top" onerror="this.remove()">' : '') + '</span></div>' +
          '<div class="gx-arb-legs">' +
            '<div class="gx-arb-leg"><span class="gx-arb-leg-sel">' + esc(a2.f1.name || a2.fight.split(' vs ')[0]) + '</span><span class="gx-arb-leg-odds gx-mono">' + Number(a2.f1.odds).toFixed(2) + '</span><span class="gx-arb-leg-book">' + bookLogo(a2.f1.book) + esc(prettyBook(a2.f1.book)) + '</span><span class="gx-arb-leg-stake">' + esc(t('arb_stake')) + ' ' + stake1 + '%</span></div>' +
            '<div class="gx-arb-leg"><span class="gx-arb-leg-sel">' + esc(a2.f2.name || a2.fight.split(' vs ')[1] || '') + '</span><span class="gx-arb-leg-odds gx-mono">' + Number(a2.f2.odds).toFixed(2) + '</span><span class="gx-arb-leg-book">' + bookLogo(a2.f2.book) + esc(prettyBook(a2.f2.book)) + '</span><span class="gx-arb-leg-stake">' + esc(t('arb_stake')) + ' ' + (100 - stake1) + '%</span></div>' +
          '</div>' +
          '<div class="gx-pick-foot"><div class="gx-arb-roi gx-pos">' + ic('shield-check') + esc(t('arb_roi')) + ': <b>+' + a2.profit_pct + '%</b></div></div></div>';
      }).join('') + '</div></div>';
    }
    cbShell(t('cb_opps_title'), cbOrgTabs() + head + inner);
    animNums($('#gx-matchview'));
  }
  // ── RENDIMIENTO: track del monitor + liquidadas (espejo del perf de fútbol; todo privado) ──
  function renderCbPerf() {
    var d = cbGet('perf', '/api/combat/perf');
    if (!d) { cbShell(t('cb_perf_title'), mvLoading()); return; }
    if (d._err) { cbShell(t('cb_perf_title'), '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>'); return; }
    var tr = d.track || {}; var tt = tr.total || {};
    var kpi = function (lab, val, cls) { return '<div class="gx-cb-tile"><div class="gx-mono gx-cb-tileval' + (cls ? ' ' + cls : '') + '">' + val + '</div><div class="gx-label">' + lab + '</div></div>'; };
    var kpis2 = '<div class="gx-cb-tiles perf">' +
      kpi('PICKS', tt.n || 0) + kpi('W-L', (tt.w || 0) + '-' + (tt.l || 0)) +
      kpi(esc(t('cb_hit')).toUpperCase(), tt.hit != null ? tt.hit + '%' : '—') +
      kpi(esc(t('cb_units')).toUpperCase(), (tt.units >= 0 ? '+' : '') + (tt.units || 0), tt.units > 0 ? 'up' : tt.units < 0 ? 'down' : '') +
      kpi(esc(t('cb_clv')).toUpperCase(), tt.clv_avg != null ? tt.clv_avg + '%' : '—', tt.clv_avg > 0 ? 'up' : tt.clv_avg < 0 ? 'down' : '') +
      kpi('MAIN', ((tr.main || {}).w || 0) + '-' + ((tr.main || {}).l || 0)) + kpi('PRELIM', ((tr.prelim || {}).w || 0) + '-' + ((tr.prelim || {}).l || 0)) + '</div>';
    var rows = (d.settled || []).map(function (p2) {
      var rc = p2.result_code;
      var chip = rc === 'WIN' ? '<span class="gx-clgate ok">W</span>' : rc === 'LOSS' ? '<span class="gx-clgate no">L</span>' : '<span class="gx-clgate sh">' + esc(rc) + '</span>';
      return '<div class="gx-cb-bout">' + chip +
        '<div class="gx-cb-bnames"><b>' + esc(p2.selection_name || '') + '</b><span class="gx-dim">' + esc(p2.event.home + ' vs ' + p2.event.away) + ' · ' + esc(p2.card_slot || '') + ' · ' + esc(cbWhen(p2.event.kickoff_at, false)) + '</span></div>' +
        '<span class="gx-mono gx-dim">@' + p2.best_odds + (p2.clv_pct != null ? ' · CLV ' + (p2.clv_pct >= 0 ? '+' : '') + p2.clv_pct + '%' : '') + '</span>' +
        '<b class="gx-mono ' + ((p2.units || 0) > 0 ? 'gx-cb-up' : (p2.units || 0) < 0 ? 'gx-cb-down' : 'gx-dim') + '">' + ((p2.units || 0) > 0 ? '+' : '') + (p2.units || 0) + 'u</b></div>';
    }).join('');
    var list = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_settled')) + ' · ' + (d.settled || []).length + '</span><span class="gx-ph-extra gx-dim">' + esc(t('cb_monitor')) + '</span></div><div class="gx-mod-body">' +
      (rows || '<div class="gx-empty">' + illo('chart') + '<b>' + esc(t('cb_no_settled')) + '</b></div>') + '</div></div>';
    cbShell(t('cb_perf_title'), kpis2 + list);
  }
  // ── ORGANIZACIONES: UFC / PFL / Bellator ──
  function renderCbOrgs() {
    var d = cbGet('orgs', '/api/combat/orgs');
    if (!d) { cbShell(t('cb_orgs_title'), mvLoading()); return; }
    if (d._err) { cbShell(t('cb_orgs_title'), '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>'); return; }
    var cards = (d.orgs || []).map(function (o) {
      var orgKey = o.tag === 'ufc' ? 'ufc' : 'mma';
      var top = (o.top || []).map(function (f) {
        return '<a class="gx-cb-orgtop" href="#cbfighter/' + orgKey + '-' + esc(String(f.id)) + '">' + cbAva(f, 1) + '<span>' + esc((f.name || '').split(' ').pop()) + '</span><b class="gx-mono">' + f.elo + '</b></a>';
      }).join('');
      return '<div class="gx-panel gx-cb-orgcard' + (o.live ? '' : ' hist') + '"><div class="gx-cb-orghead"><b>' + esc(o.label) + '</b>' + (o.live ? '' : '<span class="gx-clgate sh">' + esc(t('cb_org_hist')) + '</span>') + '</div>' +
        '<div class="gx-cb-orgstats"><span><b class="gx-mono">' + o.fights + '</b> ' + esc(t('cb_fights_n')) + '</span><span><b class="gx-mono">' + o.active + '</b> ' + esc(t('cb_org_active')) + '</span><span>' + esc(t('cb_org_since')) + ' <b class="gx-mono">' + (o.since ? new Date(o.since).getFullYear() : '—') + '</b></span></div>' +
        (o.next ? '<div class="gx-cb-orgnext"><span class="gx-label">' + esc(t('cb_org_next')) + '</span><b>' + esc(o.next.name) + '</b><span class="gx-dim">' + esc(cbWhen(o.next.date)) + ' · ' + o.next.fights + ' ' + esc(t('cb_fights_n')) + '</span></div>' : '') +
        (top ? '<div class="gx-label gx-cb-cardlab">' + esc(t('cb_org_top')) + '</div>' + top : '') + '</div>';
    }).join('');
    cbShell(t('cb_orgs_title'), '<div class="gx-cb-orgsgrid">' + cards + '</div>');
  }
  // ── EVOLUCIÓN: la élite en el tiempo (curvas de Elo) + movers 12 meses ──
  function renderCbEvo() {
    var d = cbGet('evo_' + cbOrg(), '/api/combat/evo?org=' + cbOrg());
    if (!d) { cbShell(t('cb_evo_title'), cbOrgTabs() + mvLoading()); return; }
    if (d._err) { cbShell(t('cb_evo_title'), cbOrgTabs() + '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div>'); return; }
    var cols = ['#1FE3A4', '#5aa7ff', '#b98cff', '#E8C468', '#FF7A7A', '#4be0d8', '#f19ad2', '#9be25f', '#ff9d5c', '#8fa8ff'];
    var legend = (d.top || []).map(function (f, i) {
      return '<a class="gx-cb-legitem" href="#cbfighter/' + cbOrg() + '-' + esc(String(f.id)) + '"><i style="background:' + cols[i % cols.length] + '"></i>' + cbAva(f, 1) + '<span>' + esc(f.name) + '</span><b class="gx-mono">' + f.elo + '</b></a>';
    }).join('');
    var chart = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + esc(t('cb_evo_top')) + '</span></div><div class="gx-mod-body">' +
      cbEloChart(d.top || [], 720, 260) + '<div class="gx-cb-legend">' + legend + '</div></div></div>';
    var mover = function (f, up) {
      return '<a class="gx-cb-bout lnk" href="#cbfighter/' + cbOrg() + '-' + esc(String(f.id)) + '">' + cbAva(f, up ? 1 : 2) +
        '<div class="gx-cb-bnames"><b>' + esc(f.name) + '</b><span class="gx-dim">' + f.fights_12m + ' ' + esc(t('cb_fights_n')) + ' · ' + esc(t('cb_evo_12m')) + '</span></div>' +
        '<b class="gx-mono ' + (up ? 'gx-cb-up' : 'gx-cb-down') + '">' + (f.delta >= 0 ? '+' : '') + f.delta + '</b><span class="gx-mono gx-dim">' + f.elo + '</span></a>';
    };
    var movers = '<div class="gx-cb-grid"><div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">▲ ' + esc(t('cb_evo_up')) + '</span></div><div class="gx-mod-body">' +
      (d.up || []).map(function (f) { return mover(f, true); }).join('') + '</div></div>' +
      '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">▼ ' + esc(t('cb_evo_down')) + '</span></div><div class="gx-mod-body">' +
      (d.down || []).map(function (f) { return mover(f, false); }).join('') + '</div></div></div>';
    cbShell(t('cb_evo_title'), cbOrgTabs() + chart + movers);
  }
  // ── SEGUIDOS: peleadores seguidos (localStorage v1 — vista admin-only, un solo usuario) ──
  function cbFollows() { try { return JSON.parse(localStorage.getItem('gp_cb_follows') || '[]'); } catch (e) { return []; } }
  function cbIsFollowed(id) { return cbFollows().some(function (f) { return String(f.id) === String(id); }); }
  function cbToggleFollow(f) {
    var list = cbFollows();
    var i = list.findIndex(function (x) { return String(x.id) === String(f.id); });
    if (i >= 0) list.splice(i, 1); else list.push(f);
    try { localStorage.setItem('gp_cb_follows', JSON.stringify(list)); } catch (e) {}
    delete S.cb['fp_' + (f.org || 'ufc') + '_' + f.id + '_render']; // nada que invalidar del server; solo repintar
  }
  function renderCbFollow() {
    var list = cbFollows();
    var inner;
    if (!list.length) inner = '<div class="gx-panel"><div class="gx-empty">' + illo('radar') + '<b>' + esc(t('cb_follow_none')) + '</b></div></div>';
    else inner = '<div class="gx-cb-dirgrid">' + list.map(function (f) {
      return '<a class="gx-cb-fcard" href="#cbfighter/' + esc(f.org || 'ufc') + '-' + esc(String(f.id)) + '">' + cbAva(f, 1, 'dir') +
        '<div class="gx-cb-fcard-nm">' + esc(f.name || '') + '</div>' +
        '<div class="gx-cb-fcard-meta">' + esc(f.division || '') + (f.record ? ' · ' + f.record.w + '-' + f.record.l : '') + '</div></a>';
    }).join('') + '</div>';
    cbShell(t('cb_follow_title'), inner);
  }


  function renderRefer() {
    var mv = $('#gx-matchview'); if (!mv) return;
    // PROGRAMA DE AFILIADOS (25-jul): con GP_AFFILIATES_ENABLED muestra el panel de comisiones + retiro; sin el
    // flag degrada al panel de tiers de siempre (byte-idéntico). El rate público es 10% (el 20% de influencers
    // se setea por admin y solo lo ve el propio afiliado en su balance, nunca se anuncia).
    if (S.me && S.me.affiliatesOn) return renderAffiliate();
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
  // ---- PANEL DE AFILIADO (25-jul) ----
  function renderAffiliate() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (S.aff === undefined) {
      S.aff = null;
      mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_refer')) + mvLoading() + '</div></div>';
      fetch('/api/affiliate/me', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (a) { S.aff = a || { _err: true }; if (S.view === 'refer') renderAffiliate(); });
      return;
    }
    var a = S.aff || {};
    if (a._err) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_refer')) + '<div class="gx-panel"><div class="gx-empty">' + ic('alert-triangle') + '<b>' + esc(t('e_net')) + '</b></div></div></div></div>'; return; }
    var money = function (v) { return '$' + Number(v || 0).toFixed(2); };
    var link = a.code ? 'https://gpsimulador.com/?ref=' + a.code : '';
    var pct = Math.round((a.rate || 0.10) * 100);
    // KPIs: disponible / pendiente (madurando) / pagado
    var kpis = '<div class="gx-kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">' +
      '<div class="gx-panel gx-kpi"><div class="gx-label">' + esc(t('aff_available')) + '</div><div class="gx-kpi-main"><div class="gx-kpi-sel gx-mono gx-pos">' + money(a.available) + '</div></div></div>' +
      '<div class="gx-panel gx-kpi"><div class="gx-label">' + esc(t('aff_pending')) + '</div><div class="gx-kpi-main"><div class="gx-kpi-sel gx-mono">' + money(a.pending) + '</div></div><div class="gx-kpi-sub gx-dim">' + esc(t('aff_pending_sub')) + '</div></div>' +
      '<div class="gx-panel gx-kpi"><div class="gx-label">' + esc(t('aff_paid')) + '</div><div class="gx-kpi-main"><div class="gx-kpi-sel gx-mono">' + money(a.paid) + '</div></div></div>' +
      '</div>';
    // link + referidos
    var head = '<div class="gx-panel gx-mv-panel"><div class="gx-mod-body">' +
      '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px"><b class="gx-mono" style="font-size:22px">' + a.paying_referrals + '</b><span class="gx-dim">' + esc(t('aff_paying')) + '</span><span class="gx-spacer"></span><span class="gx-clgate ok">' + pct + '% ' + esc(t('aff_forlife')) + '</span></div>' +
      '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px"><b class="gx-mono" style="font-size:22px">' + (a.signups || 0) + '</b><span class="gx-dim">' + esc(t('aff_signups')) + '</span></div>' +
      '<p class="gx-dim" style="font-size:12.5px;margin:2px 0 14px">' + esc(t('aff_lead')) + '</p>' +
      (link ? '<div class="gx-ref-link"><input id="gx-aff-input" readonly value="' + esc(link) + '"><button class="gx-btn" id="gx-aff-copy">' + ic('copy') + ' ' + esc(t('ref_copy')) + '</button></div>' : '') +
      '</div></div>';
    // Registros con el link (26-jul): pague o no — el afiliado monitorea su embudo registro→verificado→suscrito
    var suRows = (a.recent_signups || []).map(function (s) {
      var st = (s.plan === 'pro' || s.plan === 'sharp') ? '<span class="gx-clgate ok">' + esc(t('aff_su_sub')) + ' · ' + esc(s.plan.toUpperCase()) + '</span>'
        : s.verified ? '<span class="gx-clgate">' + esc(t('aff_su_verified')) + '</span>'
          : '<span class="gx-clgate sh">' + esc(t('aff_su_reg')) + '</span>';
      return '<tr><td class="l gx-dim" style="font-size:11px">' + esc((s.created_at || '').slice(0, 10)) + '</td><td class="l">' + esc(s.email) + '</td><td>' + st + '</td></tr>';
    }).join('');
    var suPanel = suRows
      ? '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('aff_signups_h')) + '</span></div><table class="gx-tbl"><thead><tr><th class="l">' + esc(t('aff_su_date')) + '</th><th class="l">' + esc(t('aff_referral')) + '</th><th>' + esc(t('aff_su_status')) + '</th></tr></thead><tbody>' + suRows + '</tbody></table>' +
        '<p class="gx-mod-note gx-dim" style="padding:0 14px 12px">' + ic('info-circle') + ' ' + esc(t('aff_signups_note')) + '</p></div>'
      : '';
    // billetera
    var w = a.wallet;
    var chainOpts = Object.keys(a.chains || {}).map(function (k) { return '<option value="' + k + '"' + (w && w.chain === k ? ' selected' : '') + '>' + esc(a.chains[k]) + '</option>'; }).join('');
    var assetOpts = (a.assets || []).map(function (x) { return '<option value="' + x + '"' + (w && w.asset === x ? ' selected' : '') + '>' + x + '</option>'; }).join('');
    var wallet = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('wallet') + ' ' + esc(t('aff_wallet')) + '</span></div><div class="gx-mod-body">' +
      '<p class="gx-dim" style="font-size:12.5px;margin-bottom:12px">' + esc(t('aff_wallet_sub')) + '</p>' +
      '<div class="gx-calc-grid" style="grid-template-columns:1fr 1fr;gap:10px">' +
      '<label class="gx-calc-f"><span>' + esc(t('aff_network')) + '</span><select class="gx-select" id="gx-aff-chain">' + chainOpts + '</select></label>' +
      '<label class="gx-calc-f"><span>' + esc(t('aff_asset')) + '</span><select class="gx-select" id="gx-aff-asset">' + assetOpts + '</select></label>' +
      '</div>' +
      '<label class="gx-calc-f gx-calc-f-br" style="margin-top:10px"><span>' + esc(t('aff_address')) + '</span><input class="gx-calc-in" id="gx-aff-addr" maxlength="64" placeholder="' + esc(t('aff_address_ph')) + '" value="' + esc(w ? w.address : '') + '"></label>' +
      '<button class="gx-btn" id="gx-aff-savew" style="margin-top:12px">' + esc(t('aff_save_wallet')) + '</button>' +
      '<div class="m-msg" id="gx-aff-wmsg" style="margin-top:8px"></div>' +
      '</div></div>';
    // retiro
    var canW = a.can_withdraw, openReq = a.open_request;
    var wdState = openReq ? '<div class="gx-corr">' + ic('clock') + '<span>' + t('aff_wd_open', { amt: money(openReq.amount) }) + '</span></div>'
      : (a.available < a.min_withdraw) ? '<p class="gx-dim" style="font-size:12.5px">' + t('aff_wd_min', { min: '$' + a.min_withdraw }) + '</p>'
        : (a.cooldown_until && new Date(a.cooldown_until) > new Date()) ? '<p class="gx-dim" style="font-size:12.5px">' + esc(t('aff_wd_cooldown')) + '</p>'
          : '<p class="gx-dim" style="font-size:12.5px">' + t('aff_wd_ready', { amt: money(a.available) }) + '</p>';
    var withdraw = '<div class="gx-panel gx-mv-panel"><div class="gx-ph"><span class="gx-label">' + ic('bank') + ' ' + esc(t('aff_withdraw')) + '</span></div><div class="gx-mod-body">' +
      wdState +
      '<button class="gx-btn' + (canW ? '' : ' gx-btn-dim') + '" id="gx-aff-wd" style="margin-top:12px"' + (canW ? '' : ' disabled') + '>' + esc(t('aff_request')) + '</button>' +
      '<div class="m-msg" id="gx-aff-wdmsg" style="margin-top:8px"></div>' +
      '<p class="gx-mod-note gx-dim" style="margin-top:10px">' + ic('info-circle') + ' ' + esc(t('aff_rules')) + '</p>' +
      '</div></div>';
    // historial de comisiones
    var rows = (a.commissions || []).map(function (c) {
      var st = c.status === 'available' ? '<span class="gx-clgate ok">' + esc(t('aff_st_available')) + '</span>' : c.status === 'paid' ? '<span class="gx-clgate">' + esc(t('aff_st_paid')) + '</span>' : '<span class="gx-clgate sh">' + esc(t('aff_st_pending')) + '</span>';
      return '<tr><td class="l gx-dim" style="font-size:11px">' + esc(c.period) + '</td><td class="l">' + esc(c.referred) + '</td><td class="l gx-dim" style="font-size:11px">' + esc((c.plan || '').toUpperCase()) + '</td><td class="gx-mono gx-pos">' + money(c.commission) + '</td><td>' + st + '</td></tr>';
    }).join('');
    var hist = rows ? '<div class="gx-panel gx-board"><table class="gx-tbl"><thead><tr><th class="l">' + esc(t('aff_period')) + '</th><th class="l">' + esc(t('aff_referral')) + '</th><th class="l">' + esc(t('aff_plan')) + '</th><th>' + esc(t('aff_commission')) + '</th><th>' + esc(t('aff_status')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '';
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px;max-width:720px">' + viewHead(t('nav_refer')) + kpis + head + suPanel + wallet + withdraw + hist + '</div></div>';
    var cp = $('#gx-aff-copy'); if (cp) cp.addEventListener('click', function () { var inp = $('#gx-aff-input'); if (inp) { inp.select(); try { document.execCommand('copy'); } catch (e) {} try { navigator.clipboard.writeText(inp.value); } catch (e) {} cp.innerHTML = ic('check') + ' ' + esc(t('ref_copied')); } });
    var sw = $('#gx-aff-savew'); if (sw) sw.addEventListener('click', function () {
      var msg = $('#gx-aff-wmsg'); sw.disabled = true;
      fetch('/api/affiliate/wallet', { method: 'POST', headers: hdrs({ 'Content-Type': 'application/json' }), body: JSON.stringify({ chain: $('#gx-aff-chain').value, asset: $('#gx-aff-asset').value, address: ($('#gx-aff-addr').value || '').trim() }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { sw.disabled = false; msg.className = 'm-msg ' + (res.ok ? 'ok' : 'err'); msg.textContent = res.ok ? t('aff_wallet_saved') : (res.j.error || t('e_net')); if (res.ok) { S.aff = undefined; } })
        .catch(function () { sw.disabled = false; msg.className = 'm-msg err'; msg.textContent = t('e_net'); });
    });
    var wd = $('#gx-aff-wd'); if (wd && canW) wd.addEventListener('click', function () {
      var msg = $('#gx-aff-wdmsg'); wd.disabled = true;
      fetch('/api/affiliate/withdraw', { method: 'POST', headers: hdrs({ 'Content-Type': 'application/json' }), body: JSON.stringify({}) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) { msg.className = 'm-msg ' + (res.ok ? 'ok' : 'err'); msg.textContent = res.ok ? t('aff_wd_done') : (res.j.error || t('e_net')); if (res.ok) { S.aff = undefined; setTimeout(function () { if (S.view === 'refer') renderAffiliate(); }, 900); } else wd.disabled = false; })
        .catch(function () { wd.disabled = false; msg.className = 'm-msg err'; msg.textContent = t('e_net'); });
    });
  }
  // ---- Rendimiento (métricas verificadas) ----
  // Texto legible de una pick por familia (COMPARTIDO entre la tabla oficial y el monitoreo privado de clubes —
  // mismas columnas, mismo componente; regla extensión-no-reconstrucción).
  function pickBetText(p, hh, aa) {
    return p.family === 'SOLID' ? (String(p.selection_code || '').indexOf('not_') === 0 ? t('pf_dc', { team: p.selection_code === 'not_home' ? aa : hh }) : t('pf_wins', { team: p.selection_code === 'home' ? hh : aa }))
      : p.family === 'GOALS' ? (p.side === 'over' ? t('pf_over', { line: p.line }) : t('pf_under', { line: p.line }))
      : p.family === 'CORNERS' ? t(p.side === 'over' ? 'pf_over_corners' : 'pf_under_corners', { line: p.line })
      : p.family === 'CARDS' ? t(p.side === 'over' ? 'pf_over_cards' : 'pf_under_cards', { line: p.line })
      : p.family === 'PLAYER' ? (p.player_family === 'player_goal' ? t('pf_player_goal', { player: p.player_name || '' }) : p.player_family === 'player_assist' ? t('pf_player_assist', { player: p.player_name || '' }) : t(p.player_family === 'player_sot' ? 'pf_player_sot' : 'pf_player_shots', { player: p.player_name || '', line: p.line }))
      : (p.legs || []).map(function (l) { return l.type === '1X2' ? t('pf_wins', { team: l.selection === 'home' ? hh : aa }) : (l.side === 'over' ? t('pf_over', { line: l.line }) : t('pf_under', { line: l.line })); }).join(' + ');
  }
  function renderPerf() {
    var mv = $('#gx-matchview'); if (!mv) return;
    // esperar a /api/me antes del primer fetch: sin esto, entrar directo a #perf decidía admin=false y cacheaba
    // el endpoint público (la sección admin de clubes nunca aparecía hasta recargar desde otra vista)
    if (S.perf === undefined && S.me == null) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_perf')) + mvLoading() + '</div></div>'; setTimeout(function () { if (S.view === 'perf') renderPerf(); }, 500); return; }
    if (S.perf === undefined) {
      S.perf = null; mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_perf')) + mvLoading() + '</div></div>';
      var isAdm = !!(S.me && S.me.isAdmin);
      // Track record de picks para TODOS (prueba social): admin usa el endpoint interno (más completo);
      // el resto el endpoint saneado /api/beta/picks-record (misma forma: track_record + picks liquidadas).
      Promise.all([fetch('/api/metrics/summary', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }), fetch('/api/aciertos', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }), fetch(isAdm ? '/api/internal/daily-picks' : '/api/beta/picks-record', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })]).then(function (res) { S.perf = { sum: res[0], leg: res[1], picks: res[2] }; if (S.view === 'perf') renderPerf(); });
      return;
    }
    var d = S.perf || {}, sum = d.sum, leg = d.leg;
    var kpi = function (label, v, cls, sub) { return '<div class="gx-panel gx-kpi"><div class="gx-label">' + esc(label) + '</div><div class="gx-kpi-main"><div class="gx-kpi-sel gx-mono ' + (cls || '') + '">' + v + '</div></div>' + (sub ? '<div class="gx-kpi-sub gx-dim">' + esc(sub) + '</div>' : '') + '</div>'; };
    var body = '';
    // ===== Rendimiento de PICKS (todos los usuarios desde 6-jul; antes solo admin): track record del producto. =====
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
      // ===== PICKS DE CLUBES · MONITOREO PRIVADO (solo admin; jamás en el rendimiento público) =====
      if (pk.clubs && clubsOn()) {
        var ctr = pk.clubs.track_record || {}, cov = ctr.overall || {};
        var active = (pk.clubs.picks || []).filter(function (p) { return p.status === 'ACTIVE'; });
        body += '<div class="gx-ph" style="margin:18px 0 8px"><span class="gx-label">' + ic('shield-half') + 'Picks de clubes · monitoreo</span><span class="gx-ph-extra"><span class="gx-clgate sh">PRIVADO</span><span class="gx-dim" style="font-size:11px;margin-left:8px">' + (cov.n || 0) + ' liquidadas · ' + active.length + ' activas</span></span></div>';
        if (cov.n) {
          body += '<div class="gx-kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">' +
            kpi('Liquidadas', cov.n, '') +
            kpi('Acierto', pctc(cov.hit_rate), 'gx-pos', (cov.wins || 0) + 'W-' + (cov.losses || 0) + 'L' + (cov.pushes ? '-' + cov.pushes + 'P' : '')) +
            kpi('ROI', cov.roi != null ? (cov.roi > 0 ? '+' : '') + Math.round(cov.roi * 100) + '%' : '—', (cov.roi >= 0 ? 'gx-pos' : 'gx-neg')) +
            kpi('P&L', cov.pnl != null ? (cov.pnl > 0 ? '+' : '') + cov.pnl + 'u' : '—', (cov.pnl >= 0 ? 'gx-pos' : 'gx-neg')) + '</div>';
          var segRows = Object.keys(ctr).filter(function (k) { return k !== 'overall'; }).map(function (k) { var v = ctr[k]; return '<span>' + esc(k) + ' <b>' + (v.wins || 0) + '/' + (v.wins + v.losses || 0) + '</b> (ROI ' + (v.roi != null ? Math.round(v.roi * 100) + '%' : '—') + ')</span>'; }).join('');
          if (segRows) body += teamPanel('layout-grid', 'Por liga · familia · gate', '<div class="gx-form-stats">' + segRows + '</div>');
        }
        // P2: quant de clubes (CLV, brier modelo-vs-mercado) — MISMOS KPIs de la tabla oficial (qm_*).
        var cq = pk.clubs.quant;
        if (cq && ((cq.clv && cq.clv.n) || (cq.model_vs_market && cq.model_vs_market.n))) {
          var cqk = '';
          if (cq.clv && cq.clv.n) {
            cqk += kpi(t('qm_clv'), sgn(cq.clv.avg_pct, '%'), (cq.clv.avg_pct >= 0 ? 'gx-pos' : 'gx-neg'), t('qm_clv_sub') + ' · n=' + cq.clv.n);
            if (cq.clv.positive_rate != null) cqk += kpi(t('qm_beat_close'), pctc(cq.clv.positive_rate), (cq.clv.positive_rate >= 0.5 ? 'gx-pos' : ''), '');
          }
          if (cq.model_vs_market && cq.model_vs_market.n && cq.model_vs_market.brier_model != null) {
            cqk += kpi(t('qm_brier_gp'), Number(cq.model_vs_market.brier_model).toFixed(3), (cq.model_vs_market.skill > 0 ? 'gx-pos' : ''), t('qm_brier_sub')) +
              kpi(t('qm_brier_mkt'), Number(cq.model_vs_market.brier_market).toFixed(3), '', 'n=' + cq.model_vs_market.n);
          }
          if (cqk) body += '<div class="gx-kpis" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:10px">' + cqk + '</div>';
        }
        var chist = (pk.clubs.picks || []).filter(function (p) { return p.status === 'SETTLED' && p.result_code !== 'SUPERSEDED'; }).sort(function (a, b) { return new Date(b.settled_at || 0) - new Date(a.settled_at || 0); }).slice(0, 60);
        var clist = active.concat(chist);
        if (clist.length) {
          // P2: MISMAS columnas de la tabla oficial (Pick legible/Cuota/CLV/Resultado) + Liga/Model·Mkt/Gate del monitoreo.
          var cRows = clist.map(function (p) {
            var rc = p.result_code === 'WIN' ? 'gx-pos' : p.result_code === 'LOSS' ? 'gx-neg' : 'gx-dim';
            var hh2 = p.event.home, aa2 = p.event.away;
            var bet = pickBetText(p, hh2, aa2);
            var famChip2 = '<span class="gx-badge" style="font-size:9.5px">' + esc(t(p.family === 'SOLID' ? 'pf_fam_solid' : p.family === 'GOALS' ? 'pf_fam_goals' : p.family === 'CORNERS' ? 'pf_fam_corners' : p.family === 'CARDS' ? 'pf_fam_cards' : p.family === 'PLAYER' ? 'pf_fam_player' : 'pf_fam_combo')) + '</span>';
            var mm = (p.model_prob != null ? pct0(p.model_prob) : '—') + '/' + (p.market_prob != null ? pct0(p.market_prob) : '—');
            var clvCell2 = p.clv != null ? '<span class="gx-mono ' + (p.clv >= 0 ? 'gx-pos' : 'gx-dim') + '" style="font-size:11px">' + (p.clv > 0 ? '+' : '') + Number(p.clv).toFixed(1) + '%</span>' : '<span class="gx-dim">—</span>';
            return '<tr class="gx-row"' + (p.event && p.event.club_eid ? ' data-openmatch="' + esc(p.event.club_eid) + '"' : '') + '><td class="l gx-dim" style="font-size:10.5px">' + esc((p.league || '').slice(0, 12)) + '</td><td class="l">' + esc(hh2 + ' - ' + aa2) + '</td><td class="l">' + famChip2 + ' <span style="font-size:12px">' + esc(bet) + '</span></td><td class="gx-mono">' + (p.best_odds != null ? Number(p.best_odds).toFixed(2) : '—') + (p.best_book ? '<div class="gx-dim" style="font-size:9.5px">' + esc(p.best_book) + '</div>' : '') + '</td><td class="gx-mono gx-dim" style="font-size:10.5px">' + mm + '</td><td>' + clvCell2 + '</td><td><span class="gx-clgate ' + (p.gate_status === 'approved' ? 'ok' : 'sh') + '">' + esc(p.gate_status || 'shadow') + '</span></td><td class="gx-mono ' + rc + '" style="font-weight:800">' + esc(p.status === 'ACTIVE' ? 'ACTIVE' : p.result_code) + '</td></tr>';
          }).join('');
          body += '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">Historial de clubes</span><span class="gx-spacer"></span><button class="gx-btn" id="gx-clexp" style="font-size:11px;padding:5px 12px">Exportar CSV</button></div><div class="gx-perf-scroll"><table class="gx-table"><thead><tr><th class="l">Liga</th><th class="l">Partido</th><th class="l">Pick</th><th>Cuota</th><th>GP/Mkt</th><th>CLV</th><th>Gate</th><th>Resultado</th></tr></thead><tbody>' + cRows + '</tbody></table></div></div>';
        } else if (!cov.n) {
          body += '<div class="gx-panel"><div style="padding:12px 16px;font-size:11.5px;color:var(--gx-text3)">Sin picks de clubes todavía — el motor corre cada 15 min sobre las ligas con cuotas; nacerán con los próximos partidos.</div></div>';
        }
      }
      // ===== Métricas quant de las picks (CLV, precisión vs consenso, calibración). Misma forma admin/público. =====
      var q = pk.quant;
      if (q && ((q.clv && q.clv.n) || (q.model_vs_market && q.model_vs_market.n) || (q.calibration || []).length)) {
        var qk = '';
        if (q.clv && q.clv.n) {
          qk += kpi(t('qm_clv'), sgn(q.clv.avg_pct, '%'), (q.clv.avg_pct >= 0 ? 'gx-pos' : 'gx-neg'), t('qm_clv_sub') + ' · n=' + q.clv.n);
          if (q.clv.positive_rate != null) qk += kpi(t('qm_beat_close'), pctc(q.clv.positive_rate), (q.clv.positive_rate >= 0.5 ? 'gx-pos' : ''), '');
        }
        if (q.model_vs_market && q.model_vs_market.n && q.model_vs_market.brier_model != null) {
          qk += kpi(t('qm_brier_gp'), Number(q.model_vs_market.brier_model).toFixed(3), (q.model_vs_market.skill > 0 ? 'gx-pos' : ''), t('qm_brier_sub')) +
            kpi(t('qm_brier_mkt'), Number(q.model_vs_market.brier_market).toFixed(3), '', 'n=' + q.model_vs_market.n);
        }
        if (qk) {
          body += '<div class="gx-ph" style="margin:14px 0 8px"><span class="gx-label">' + ic('chart-line') + esc(t('qm_title')) + '</span></div>' +
            '<div class="gx-kpis" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:10px">' + qk + '</div>' +
            (q.clv && q.clv.n ? '<p class="gx-mod-note gx-dim" style="margin:0 0 12px">' + ic('info-circle') + ' ' + esc(t('qm_clv_note')) + '</p>' : '');
        }
        var cal = (q.calibration || []).filter(function (b) { return b.n >= 5; });
        if (cal.length) {
          var calRows = cal.map(function (b) {
            return '<tr class="gx-row"><td class="gx-mono l">' + esc(b.range) + '%</td><td class="gx-mono">' + b.predicted + '%</td><td class="gx-mono" style="font-weight:600">' + b.observed + '%</td><td class="gx-mono ' + (Math.abs(b.gap_pp) <= 5 ? 'gx-pos' : 'gx-dim') + '">' + (b.gap_pp > 0 ? '+' : '') + b.gap_pp + 'pp</td><td class="gx-dim">' + b.n + '</td></tr>';
          }).join('');
          body += '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('qm_cal_title')) + '</span></div><div class="gx-perf-scroll"><table class="gx-table"><thead><tr><th class="l">' + esc(t('qm_cal_range')) + '</th><th>GP</th><th>' + esc(t('qm_cal_obs')) + '</th><th>Δ</th><th>' + esc(t('qm_cal_n')) + '</th></tr></thead><tbody>' + calRows + '</tbody></table></div><p class="gx-mod-note gx-dim" style="margin:8px 10px">' + esc(t('qm_cal_note')) + '</p></div>';
        }
      }
      var settled = (pk.picks || []).filter(function (p) { return p.status === 'SETTLED' && p.result_code !== 'SUPERSEDED'; }).sort(function (a, b) { return new Date(b.settled_at || 0) - new Date(a.settled_at || 0); });
      if (settled.length) {
        var prows = settled.map(function (p) {
          var hh = teamName(p.event.home_team_id, p.event.home), aa = teamName(p.event.away_team_id, p.event.away);
          var betTxt = pickBetText(p, hh, aa);
          var res = p.result_code === 'WIN' ? '<span class="gx-pos" style="font-weight:700">✓ WIN</span>' : p.result_code === 'LOSS' ? '<span class="gx-neg" style="font-weight:700">✗ LOSS</span>' : '<span class="gx-dim" style="font-size:11px">' + esc(p.result_code || '—') + '</span>';
          var famChip = '<span class="gx-badge" style="font-size:9.5px">' + esc(t(p.family === 'SOLID' ? 'pf_fam_solid' : p.family === 'GOALS' ? 'pf_fam_goals' : p.family === 'CORNERS' ? 'pf_fam_corners' : p.family === 'CARDS' ? 'pf_fam_cards' : p.family === 'PLAYER' ? 'pf_fam_player' : 'pf_fam_combo')) + '</span>';
          var clvCell = p.clv != null ? '<span class="gx-mono ' + (p.clv >= 0 ? 'gx-pos' : 'gx-dim') + '" style="font-size:11px">' + (p.clv > 0 ? '+' : '') + Number(p.clv).toFixed(1) + '%</span>' : '<span class="gx-dim">—</span>';
          return '<tr class="gx-row"><td class="gx-time l">' + esc(fmtDate(p.settled_at)) + '</td><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(p.event.home_team_id) + '</span><b>' + esc(hh) + '</b><span class="gx-dim" style="margin:0 3px">' + esc(t('vs')) + '</span><span class="fl">' + flag(p.event.away_team_id) + '</span><b>' + esc(aa) + '</b></div></td><td class="l">' + famChip + ' <span style="font-size:12px">' + esc(betTxt) + '</span></td><td class="gx-mono">' + (p.best_odds != null ? Number(p.best_odds).toFixed(2) : '—') + '</td><td>' + clvCell + '</td><td>' + res + '</td></tr>';
        }).join('');
        // El server ventanea el historial (últimas 120) pero los KPIs usan el cuadro COMPLETO → rotular la
        // ventana para que contar filas no parezca una inconsistencia (pregunta de Alexis 26-jul).
        var histCount = (ov.settled && ov.settled > settled.length) ? t('pp_hist_window', { shown: settled.length, total: ov.settled }) : String(settled.length);
        body += '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + esc(t('pp_history')) + '</span><span class="gx-ph-extra gx-dim" style="font-size:11px">' + esc(histCount) + '</span></div><div class="gx-perf-scroll"><table class="gx-table"><thead><tr><th class="l">' + esc(t('th_time')) + '</th><th class="l">' + esc(t('th_match')) + '</th><th class="l">' + esc(t('pp_pick')) + '</th><th>' + esc(t('reg_odds')) + '</th><th>CLV</th><th>' + esc(t('perf_result')) + '</th></tr></thead><tbody>' + prows + '</tbody></table></div></div>';
      } else {
        body += '<div class="gx-panel"><div class="gx-empty">' + ic('target-arrow') + '<b>' + esc(t('pp_none')) + '</b></div></div>';
      }
      // CUADRO APARTE de PLAYER (solo llega para admin, decisión 24-jul): goleadores/asistencias acumulan su
      // track SEPARADO del oficial — para analizar la familia y decidir su futuro sin ensuciar el cuadro.
      if (pk.player_track && pk.player_track.picks && pk.player_track.picks.length) {
        var ptr = (pk.player_track.track_record && pk.player_track.track_record.overall) || {};
        var prows2 = pk.player_track.picks.map(function (p) {
          var hh2 = teamName(p.event.home_team_id, p.event.home), aa2 = teamName(p.event.away_team_id, p.event.away);
          var res2 = p.result_code === 'WIN' ? '<span class="gx-pos" style="font-weight:700">✓ WIN</span>' : p.result_code === 'LOSS' ? '<span class="gx-neg" style="font-weight:700">✗ LOSS</span>' : '<span class="gx-dim" style="font-size:11px">' + esc(p.result_code || '—') + '</span>';
          var what = (p.player_name || '—') + ' · ' + (p.player_family === 'player_assist' ? (LANG === 'en' ? 'assist' : 'asistencia') : (LANG === 'en' ? 'scores' : 'anota'));
          return '<tr class="gx-row"><td class="gx-time l">' + esc(fmtDate(p.settled_at)) + '</td><td class="l"><div class="gx-cell-team"><span class="fl">' + flag(p.event.home_team_id) + '</span><b>' + esc(hh2) + '</b><span class="gx-dim" style="margin:0 3px">' + esc(t('vs')) + '</span><span class="fl">' + flag(p.event.away_team_id) + '</span><b>' + esc(aa2) + '</b></div></td><td class="l" style="font-size:12px">' + esc(what) + '</td><td class="gx-mono">' + (p.best_odds != null ? Number(p.best_odds).toFixed(2) : '—') + '</td><td>' + res2 + '</td></tr>';
        }).join('');
        var ptHead = ptr.settled != null ? ((ptr.wins || 0) + '/' + ptr.settled + (ptr.roi_pct != null ? ' · ROI ' + ptr.roi_pct + '%' : '')) : '';
        body += '<div class="gx-panel gx-board"><div class="gx-ph"><span class="gx-label">' + ic('user') + esc(LANG === 'en' ? 'Player picks track (admin)' : 'Track de picks de jugador (admin)') + '</span><span class="gx-ph-extra gx-dim">' + esc(ptHead) + '</span></div><div class="gx-perf-scroll"><table class="gx-table"><thead><tr><th class="l">' + esc(t('th_time')) + '</th><th class="l">' + esc(t('th_match')) + '</th><th class="l">Pick</th><th>' + esc(t('reg_odds')) + '</th><th>' + esc(t('perf_result')) + '</th></tr></thead><tbody>' + prows2 + '</tbody></table></div><p class="gx-mod-note gx-dim" style="margin:8px 10px">' + esc(LANG === 'en' ? 'Family under separate evaluation — not part of the official record.' : 'Familia en evaluación aparte — no cuenta en el cuadro oficial.') + '</p></div>';
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
    // P2: export CSV del monitoreo privado de clubes (todas las columnas del registro, para análisis externo)
    var exBtn = $('#gx-clexp');
    if (exBtn) exBtn.addEventListener('click', function () {
      var rows = ((S.perf && S.perf.picks && S.perf.picks.clubs && S.perf.picks.clubs.picks) || []);
      var cols = ['pick_id', 'created_at', 'league', 'competition_name', 'family', 'gate_status', 'home', 'away', 'kickoff_at', 'selection_code', 'market_id', 'side', 'line', 'player_name', 'best_odds', 'best_book', 'books', 'model_prob', 'market_prob', 'edge_pp', 'confidence', 'closing_fair', 'closing_odds', 'clv_pct', 'status', 'result_code', 'settled_at'];
      var csv = cols.join(',') + '\n' + rows.map(function (p) {
        var v = { pick_id: p.pick_id, created_at: p.created_at, league: p.league, competition_name: p.competition_name, family: p.family, gate_status: p.gate_status, home: p.event && p.event.home, away: p.event && p.event.away, kickoff_at: p.event && p.event.kickoff_at, selection_code: p.selection_code, market_id: p.market_id, side: p.side, line: p.line, player_name: p.player_name, best_odds: p.best_odds, best_book: p.best_book, books: p.books, model_prob: p.model_prob, market_prob: p.market_prob, edge_pp: p.edge_pp, confidence: p.confidence, closing_fair: p.closing && p.closing.fair_prob, closing_odds: p.closing && p.closing.odds, clv_pct: p.clv, status: p.status, result_code: p.result_code, settled_at: p.settled_at };
        return cols.map(function (c) { var x = v[c]; if (x == null) return ''; x = String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(',');
      }).join('\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = 'gp-clubs-picks-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
    });
  }

  // ---- Admin: Observatory de cobertura (§29, solo admin) ----
  // ADMIN (post-fusión): las 4 herramientas operativas portadas de la plataforma vieja — corregir partido,
  // base de usuarios, email masivo, Telegram. Mismos endpoints (/api/admin/*), datos compartidos (misma DB).
  function admStage(c) { return stageLabel(c) || ({ R32: LANG === 'en' ? 'Round of 32' : '16avos', '3RD': LANG === 'en' ? '3rd place' : '3er puesto', group: LANG === 'en' ? 'Group' : 'Grupos' }[c]) || c; }
  function renderAdmin() {
    var mv = $('#gx-matchview'); if (!mv) return;
    if (!(S.me && S.me.isAdmin)) { mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_admin')) + '<div class="gx-panel"><div class="gx-empty">' + ic('lock') + '<b>' + esc(t('adm_forbidden')) + '</b></div></div></div></div>'; return; }
    if (S.adminData === undefined) {
      S.adminData = null;
      mv.innerHTML = '<div class="gx-mv"><div class="gx-content">' + viewHead(t('nav_admin')) + mvLoading() + '</div></div>';
      Promise.all([
        fetch('/api/state', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        fetch('/api/admin/users', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        fetch('/api/internal/affiliates', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
        fetch('/api/admin/grants', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      ]).then(function (res) { S.adminData = { state: res[0] || {}, users: res[1], aff: res[2], grants: res[3] }; if (S.view === 'admin') renderAdmin(); });
      return;
    }
    var st = S.adminData.state || {}, uj = S.adminData.users;
    // ---- Corregir partido ----
    var gOpts = (st.fixtures || []).filter(function (f) { return f.home && f.away; })
      .sort(function (a, b) { return (a.datetime || '').localeCompare(b.datetime || ''); })
      .map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(teamName(f.home) + ' vs ' + teamName(f.away) + (f.group ? ' · ' + (LANG === 'en' ? 'Group' : 'Grupo') + ' ' + f.group : '')) + '</option>'; }).join('');
    var koOpts = (st.knockout || []).map(function (k) {
      var h = (k.resolved && k.resolved.home) ? teamName(k.resolved.home) : (typeof k.home === 'string' ? k.home : '?');
      var a = (k.resolved && k.resolved.away) ? teamName(k.resolved.away) : (typeof k.away === 'string' ? k.away : '?');
      return '<option value="' + esc(k.m) + '">' + esc(admStage(k.stage) + ' · ' + h + ' vs ' + a + (k.date ? ' · ' + k.date : '')) + '</option>';
    }).join('');
    var teamOpts = (st.teams || []).map(function (tm) { return '<option value="' + esc(tm.id) + '">' + esc(tm.name) + '</option>'; }).join('');
    var matchCorrect =
      '<div class="gx-panel gx-mv-panel gx-adm"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_fix_group')) + '</span></div><div class="gx-mod-body gx-adm-body">' +
        '<label class="gx-adm-f"><span>' + esc(t('adm_match')) + '</span><select class="gx-select" id="gxa-gmatch">' + gOpts + '</select></label>' +
        '<div class="gx-adm-row"><label class="gx-adm-f"><span>' + esc(t('adm_goals_h')) + '</span><input class="gx-pf-in" id="gxa-ghg" type="number" min="0" value="0"></label>' +
        '<label class="gx-adm-f"><span>' + esc(t('adm_goals_a')) + '</span><input class="gx-pf-in" id="gxa-gag" type="number" min="0" value="0"></label>' +
        '<label class="gx-adm-f"><span>' + esc(t('adm_status')) + '</span><select class="gx-select" id="gxa-gstatus"><option value="final">' + esc(t('adm_st_final')) + '</option><option value="live">' + esc(t('adm_st_live')) + '</option></select></label>' +
        '<label class="gx-adm-f"><span>' + esc(t('adm_minute')) + '</span><input class="gx-pf-in" id="gxa-gmin" type="number" min="0" max="90" value="0"></label></div>' +
        '<div class="gx-adm-actions"><button class="gx-btn" data-adm="save-g">' + esc(t('adm_save')) + '</button><button class="gx-btn ghost" data-adm="rm-g">' + esc(t('adm_remove')) + '</button></div>' +
      '</div></div>' +
      '<div class="gx-panel gx-mv-panel gx-adm"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_fix_ko')) + '</span></div><div class="gx-mod-body gx-adm-body">' +
        '<label class="gx-adm-f"><span>' + esc(t('adm_bracket')) + '</span><select class="gx-select" id="gxa-kmatch">' + koOpts + '</select></label>' +
        '<div class="gx-adm-row"><label class="gx-adm-f"><span>' + esc(t('adm_team1')) + '</span><select class="gx-select" id="gxa-khome">' + teamOpts + '</select></label>' +
        '<label class="gx-adm-f"><span>' + esc(t('adm_team2')) + '</span><select class="gx-select" id="gxa-kaway">' + teamOpts + '</select></label></div>' +
        '<div class="gx-adm-row"><label class="gx-adm-f"><span>' + esc(t('adm_goals_h')) + '</span><input class="gx-pf-in" id="gxa-khg" type="number" min="0" value="0"></label>' +
        '<label class="gx-adm-f"><span>' + esc(t('adm_goals_a')) + '</span><input class="gx-pf-in" id="gxa-kag" type="number" min="0" value="0"></label>' +
        '<label class="gx-adm-f"><span>' + esc(t('adm_status')) + '</span><select class="gx-select" id="gxa-kstatus"><option value="final">' + esc(t('adm_st_final')) + '</option><option value="live">' + esc(t('adm_st_live')) + '</option></select></label>' +
        '<label class="gx-adm-f"><span>' + esc(t('adm_minute')) + '</span><input class="gx-pf-in" id="gxa-kmin" type="number" min="0" max="120" value="0"></label></div>' +
        '<label class="gx-adm-check"><input type="checkbox" id="gxa-kpens"> ' + esc(t('adm_pens')) + '</label>' +
        '<div class="gx-adm-actions"><button class="gx-btn" data-adm="save-k">' + esc(t('adm_save')) + '</button><button class="gx-btn ghost" data-adm="rm-k">' + esc(t('adm_remove')) + '</button></div>' +
      '</div></div>' +
      '<div class="gx-adm-msg" id="gxa-msg"></div>';
    // ---- Email masivo ----
    var broadcast =
      '<div class="gx-panel gx-mv-panel gx-adm"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_broadcast')) + '</span></div><div class="gx-mod-body gx-adm-body">' +
        '<p class="gx-dim" style="font-size:12.5px">' + esc(t('adm_bc_beta')) + '</p>' +
        '<div class="gx-adm-actions"><button class="gx-btn ghost" data-adm="bc-test-beta">' + esc(t('adm_bc_test')) + '</button><button class="gx-btn" data-adm="bc-all-beta">' + esc(t('adm_bc_send')) + '</button></div>' +
        '<p class="gx-dim" style="font-size:12.5px;margin-top:6px">' + esc(t('adm_bc_reengage')) + '</p>' +
        '<div class="gx-adm-actions"><button class="gx-btn ghost" data-adm="bc-test-reengage">' + esc(t('adm_bc_test')) + '</button><button class="gx-btn" data-adm="bc-all-reengage">' + esc(t('adm_bc_send')) + '</button></div>' +
        '<div class="gx-adm-msg" id="gxa-bcmsg"></div>' +
      '</div></div>';
    // ---- Telegram ----
    var telegram =
      '<div class="gx-panel gx-mv-panel gx-adm"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_telegram')) + '</span></div><div class="gx-mod-body gx-adm-body">' +
        '<p class="gx-dim" style="font-size:12.5px">' + esc(t('adm_tg_note')) + '</p>' +
        '<div class="gx-adm-actions"><button class="gx-btn ghost" data-adm="tg-test">' + esc(t('adm_tg_test')) + '</button><button class="gx-btn ghost" data-adm="tg-daily">' + esc(t('adm_tg_daily')) + '</button></div>' +
        '<div class="gx-adm-msg" id="gxa-tgmsg"></div>' +
      '</div></div>';
    // ---- Afiliados (26-jul): subir rate 10→20% a cuentas elegidas + lista + retiros pendientes ----
    var affAdm = admAffiliatesHtml(S.adminData.aff, S.adminData.grants);
    // ---- Base de usuarios ----
    var users = admUsersHtml(uj);
    // ---- Actividad/retención (lazy: carga al montar) ----
    var analytics = '<div class="gx-panel gx-mv-panel gx-adm"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_ana')) + '</span></div><div class="gx-mod-body gx-adm-body" id="gxa-ana">' + mvLoading() + '</div></div>';
    mv.innerHTML = '<div class="gx-mv"><div class="gx-content" style="gap:14px">' + viewHead(t('nav_admin')) + analytics + matchCorrect + affAdm + users + broadcast + telegram + '</div></div>';
    wireAdmin();
    fetch('/api/admin/analytics', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (a) {
      var el = $('#gxa-ana'); if (!el) return;
      if (!a) { el.innerHTML = '<span class="gx-dim">—</span>'; return; }
      var kpi = function (l, v) { return '<div class="gx-g-stat"><span class="gx-label">' + esc(l) + '</span><b class="gx-mono" style="font-size:20px">' + v + '</b></div>'; };
      var bars = (a.dau || []).map(function (d) { var max = Math.max.apply(null, a.dau.map(function (x) { return x.n; })) || 1; return '<div class="gxa-bar" title="' + esc(d.date + ': ' + d.n) + '"><i style="height:' + Math.max(6, Math.round(d.n / max * 44)) + 'px"></i><span>' + d.date.slice(8) + '</span></div>'; }).join('');
      el.innerHTML =
        '<div style="display:flex;gap:18px;flex-wrap:wrap">' +
          kpi(t('adm_ana_today'), a.today) +
          kpi(t('adm_ana_d1'), a.d1 ? a.d1.pct + '% <span class="gx-dim" style="font-size:11px">(n=' + a.d1.sample + ')</span>' : '—') +
          kpi(t('adm_ana_d7'), a.d7 ? a.d7.pct + '% <span class="gx-dim" style="font-size:11px">(n=' + a.d7.sample + ')</span>' : '—') +
          kpi(t('adm_ana_hab'), a.habituales_count) +
        '</div>' +
        (bars ? '<div class="gxa-bars">' + bars + '</div>' : '') +
        '<p class="gx-dim" style="font-size:11.5px;margin-top:8px">' + esc(t('adm_ana_since')) + ': ' + esc(a.tracking_since || '—') + ' · ' + esc(t('adm_ana_nodata')) + '</p>' +
        ((a.habituales || []).length ? '<div class="gx-chips" style="margin-top:8px">' + a.habituales.slice(0, 15).map(function (h) { return '<span class="gx-chip">' + esc(h.email) + ' · ' + h.days + 'd</span>'; }).join('') + '</div>' : '');
    });
  }
  // Panel admin de afiliados (26-jul): setear rate custom (hasta 20%), dar/quitar plan manual (paquete
  // influencer: comisión + suscripción gratis), ver lista con embudo y resolver retiros.
  function admAffiliatesHtml(aj, gj) {
    var head = '<div class="gx-panel gx-mv-panel gx-adm"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_aff')) + '</span></div><div class="gx-mod-body gx-adm-body">';
    if (!aj) return head + '<span class="gx-dim">—</span></div></div>';
    var money = function (v) { return '$' + Number(v || 0).toFixed(2); };
    var setter =
      '<div class="gx-adm-row"><label class="gx-adm-f" style="flex:2"><span>' + esc(t('adm_aff_email')) + '</span><input class="gx-pf-in" id="gxa-affemail" type="email" placeholder="email@..."></label>' +
      '<label class="gx-adm-f"><span>' + esc(t('adm_aff_rate')) + '</span><input class="gx-pf-in" id="gxa-affrate" type="number" min="1" max="20" step="1" value="20"></label></div>' +
      '<div class="gx-adm-actions"><button class="gx-btn" data-adm="aff-rate">' + esc(t('adm_aff_apply')) + '</button></div>' +
      '<p class="gx-dim" style="font-size:11.5px;margin-top:4px">' + esc(t('adm_aff_note')) + '</p>' +
      // Suscripción manual (mismo email de arriba): dar Pro/Sharp gratis o quitarla
      '<div class="gx-adm-row" style="margin-top:10px;align-items:flex-end"><label class="gx-adm-f"><span>' + esc(t('adm_grant_plan')) + '</span><select class="gx-select" id="gxa-grplan"><option value="pro">Pro</option><option value="sharp" selected>Sharp</option></select></label>' +
      '<button class="gx-btn" data-adm="grant-give">' + esc(t('adm_grant_give')) + '</button>' +
      '<button class="gx-btn ghost" data-adm="grant-revoke">' + esc(t('adm_grant_revoke')) + '</button></div>' +
      '<p class="gx-dim" style="font-size:11.5px;margin-top:4px">' + esc(t('adm_grant_note')) + '</p>' +
      ((gj && gj.grants || []).filter(function (g) { return g.status === 'active'; }).length
        ? '<div class="gx-chips" style="margin-top:6px">' + gj.grants.filter(function (g) { return g.status === 'active'; }).map(function (g) { return '<span class="gx-chip">' + esc(g.email) + ' · <b>' + esc((g.plan || '').toUpperCase()) + '</b>' + (g.source === 'admin' ? ' · admin' : '') + '</span>'; }).join('') + '</div>'
        : '') +
      '<div class="gx-adm-msg" id="gxa-affmsg"></div>';
    var rows = (aj.affiliates || []).map(function (a) {
      return '<tr><td>' + esc(a.affiliate) + '</td><td><b>' + Math.round((a.rate || 0.1) * 100) + '%</b></td><td>' + (a.signups || 0) + '</td><td>' + (a.referrals || 0) + '</td><td class="gx-mono gx-pos">' + money(a.available) + '</td><td class="gx-mono">' + money(a.pending) + '</td><td class="gx-mono">' + money(a.paid) + '</td><td class="gx-dim" style="font-size:11px">' + esc(a.wallet ? (a.wallet.asset + ' · ' + a.wallet.chain) : '—') + '</td></tr>';
    }).join('');
    var list = rows
      ? '<div class="gx-adm-table-wrap" style="margin-top:12px"><table class="gx-adm-table"><thead><tr><th>Email</th><th>%</th><th>' + esc(t('adm_aff_signups')) + '</th><th>' + esc(t('adm_aff_refs')) + '</th><th>' + esc(t('aff_st_available')) + '</th><th>' + esc(t('aff_st_pending')) + '</th><th>' + esc(t('aff_st_paid')) + '</th><th>Wallet</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<p class="gx-dim" style="font-size:12px;margin-top:10px">' + esc(t('adm_aff_empty')) + '</p>';
    var wds = (aj.pending_withdrawals || []).map(function (w) {
      return '<div class="gx-adm-row" style="align-items:center;flex-wrap:wrap;gap:8px;margin-top:8px">' +
        '<span style="font-size:12.5px">' + esc(w.affiliate) + ' · <b class="gx-mono">' + money(w.amount) + '</b> ' + esc(w.asset || '') + ' · ' + esc((w.chain || '') + ' ') + '<span class="gx-mono gx-dim" style="font-size:10.5px">' + esc(w.address || '') + '</span></span>' +
        '<input class="gx-pf-in" style="flex:1;min-width:120px" id="gxa-tx-' + esc(w.id) + '" placeholder="' + esc(t('adm_aff_tx_ph')) + '">' +
        '<button class="gx-btn" data-adm="aff-pay" data-wid="' + esc(w.id) + '">' + esc(t('adm_aff_pay')) + '</button>' +
        '<button class="gx-btn ghost" data-adm="aff-reject" data-wid="' + esc(w.id) + '">' + esc(t('adm_aff_reject')) + '</button></div>';
    }).join('');
    var wdBlock = wds ? '<div style="margin-top:14px"><span class="gx-label">' + esc(t('adm_aff_wd')) + '</span>' + wds + '</div>' : '';
    return head + setter + list + wdBlock + '</div></div>';
  }
  function admAffRate() {
    var em = (($('#gxa-affemail') || {}).value || '').trim().toLowerCase();
    var pct = Number(($('#gxa-affrate') || {}).value || 0);
    if (!em || !pct) return admMsg('gxa-affmsg', '✗');
    admMsg('gxa-affmsg', t('adm_saving'));
    fetch('/api/internal/affiliates', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify({ action: 'set_rate', email: em, rate: pct / 100 }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) { admMsg('gxa-affmsg', res.ok ? t('adm_aff_ok') + ' · ' + em + ' → ' + Math.round(res.j.rate * 100) + '%' : '✗ ' + (res.j.error || 'error')); if (res.ok) S.adminData = undefined; })
      .catch(function () { admMsg('gxa-affmsg', '✗ ' + t('adm_neterr')); });
  }
  // Dar/quitar suscripción manual (usa /api/admin/grants, que ya existía desde el 4-jul; solo faltaba la UI)
  function admGrant(revoke) {
    var em = (($('#gxa-affemail') || {}).value || '').trim().toLowerCase();
    if (!em) return admMsg('gxa-affmsg', '✗ email');
    var plan = ($('#gxa-grplan') || {}).value || 'sharp';
    if (!window.confirm((revoke ? t('adm_grant_revoke') : t('adm_grant_give') + ' ' + plan.toUpperCase()) + ' → ' + em + '?')) return;
    admMsg('gxa-affmsg', t('adm_saving'));
    fetch('/api/admin/grants', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify(revoke ? { action: 'revoke', email: em } : { email: em, plan: plan }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) { admMsg('gxa-affmsg', res.ok ? t('adm_grant_ok') + ' · ' + em + ' → ' + (res.j.plan || 'free').toUpperCase() : '✗ ' + (res.j.error || 'error')); if (res.ok) S.adminData = undefined; })
      .catch(function () { admMsg('gxa-affmsg', '✗ ' + t('adm_neterr')); });
  }
  function admAffWd(action, wid) {
    var tx = (($('#gxa-tx-' + wid) || {}).value || '').trim();
    if (!window.confirm(action === 'payout' ? t('adm_aff_pay') + '?' : t('adm_aff_reject') + '?')) return;
    admMsg('gxa-affmsg', t('adm_saving'));
    fetch('/api/internal/affiliates', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify({ action: action, withdrawal_id: wid, tx_hash: tx || undefined }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) { admMsg('gxa-affmsg', res.ok ? '✓' : '✗ ' + (res.j.error || 'error')); if (res.ok) { S.adminData = undefined; if (S.view === 'admin') renderAdmin(); } })
      .catch(function () { admMsg('gxa-affmsg', '✗ ' + t('adm_neterr')); });
  }
  function admUsersHtml(uj) {
    if (!uj) return '<div class="gx-panel gx-mv-panel gx-adm"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_users')) + '</span></div><div class="gx-mod-body gx-adm-body"><span class="gx-dim">' + esc(t('adm_users_err')) + '</span></div></div>';
    var fmt = function (ts) { try { return new Date(ts).toLocaleString(LANG === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    var vCount = uj.verifiedCount != null ? uj.verifiedCount : (uj.users || []).filter(function (u) { return u.verified !== false; }).length;
    var lCount = uj.leadCount != null ? uj.leadCount : ((uj.total || 0) - vCount);
    var bl = uj.byLang || {}, sources = Object.keys(uj.bySource || {}).sort(function (a, b) { return uj.bySource[b] - uj.bySource[a]; }).map(function (s) { return '<span class="gx-adm-chip"><b>' + uj.bySource[s] + '</b> ' + esc(s) + '</span>'; }).join(' ');
    var rows = (uj.users || []).map(function (u) {
      return '<tr' + (u.verified === false ? ' style="opacity:.72"' : '') + '><td>' + esc(u.email) + '</td><td>' + (u.name ? esc(u.name) : '—') + '</td><td>' + esc(u.country || '—') + '</td><td><b>' + esc((u.mailLang || 'es').toUpperCase()) + '</b></td><td>' + (u.verified === false ? '<span class="gx-adm-lead">LEAD</span>' : '<span class="gx-pos">✓</span>') + '</td><td>' + esc(u.ref || '') + '</td><td class="gx-dim">' + esc(fmt(u.createdAt)) + '</td><td class="gx-dim">' + esc(fmt(u.lastSeen)) + '</td></tr>';
    }).join('');
    S._admUsers = uj.users || [];
    return '<div class="gx-panel gx-mv-panel gx-adm"><div class="gx-ph"><span class="gx-label">' + esc(t('adm_users')) + '</span>' +
      '<button class="gx-btn ghost gx-adm-csv" data-adm="csv">' + ic('download') + ' CSV</button></div>' +
      '<div class="gx-mod-body gx-adm-body">' +
      '<div class="gx-adm-ucount"><b class="gx-pos">' + vCount + '</b> ' + esc(t('adm_verified')) + ' · <b class="gx-warn">' + lCount + '</b> ' + esc(t('adm_leads')) + ' <span class="gx-dim">(' + (uj.total || 0) + ' ' + esc(t('adm_total')) + ')</span></div>' +
      '<div class="gx-adm-langs"><span class="gx-adm-chip"><b>' + (bl.es || 0) + '</b> ES</span><span class="gx-adm-chip"><b>' + (bl.en || 0) + '</b> EN</span>' + (sources ? ' <span class="gx-dim" style="font-size:11px;margin-left:6px">' + esc(t('adm_sources')) + ':</span> ' + sources : '') + '</div>' +
      '<div class="gx-adm-table-wrap"><table class="gx-adm-table"><thead><tr><th>Email</th><th>' + esc(t('adm_name')) + '</th><th>' + esc(t('adm_country')) + '</th><th>' + esc(t('adm_lang')) + '</th><th>' + esc(t('adm_state')) + '</th><th>' + esc(t('adm_source')) + '</th><th>' + esc(t('adm_reg')) + '</th><th>' + esc(t('adm_lastseen')) + '</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</div></div>';
  }
  var _admBusy = false;
  function admMsg(id, txt) { var e = $('#' + id); if (e) e.textContent = txt; }
  function wireAdmin() {
    var mv = $('#gx-matchview'); if (!mv) return;
    [].forEach.call(mv.querySelectorAll('[data-adm]'), function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-adm');
        if (a === 'csv') return admExportCSV();
        if (a === 'save-g' || a === 'rm-g' || a === 'save-k' || a === 'rm-k') return admResult(a);
        if (a.indexOf('bc-') === 0) { var parts = a.split('-'); return admBroadcast(parts[1] === 'test', parts[2]); }
        if (a === 'tg-test') return admTelegram('/api/admin/telegram-test');
        if (a === 'tg-daily') return admTelegram('/api/admin/telegram-daily');
        if (a === 'aff-rate') return admAffRate();
        if (a === 'aff-pay') return admAffWd('payout', b.getAttribute('data-wid'));
        if (a === 'aff-reject') return admAffWd('reject', b.getAttribute('data-wid'));
        if (a === 'grant-give' || a === 'grant-revoke') return admGrant(a === 'grant-revoke');
      });
    });
  }
  function admResult(a) {
    var jhdr = Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body;
    if (a === 'rm-g') body = { matchId: ($('#gxa-gmatch') || {}).value, remove: true };
    else if (a === 'rm-k') body = { matchId: ($('#gxa-kmatch') || {}).value, remove: true };
    else if (a === 'save-g') body = { matchId: $('#gxa-gmatch').value, hg: $('#gxa-ghg').value, ag: $('#gxa-gag').value, status: $('#gxa-gstatus').value, minute: $('#gxa-gmin').value };
    else body = { matchId: $('#gxa-kmatch').value, home: $('#gxa-khome').value, away: $('#gxa-kaway').value, hg: $('#gxa-khg').value, ag: $('#gxa-kag').value, status: $('#gxa-kstatus').value, minute: $('#gxa-kmin').value, pensHome: $('#gxa-kpens').checked };
    admMsg('gxa-msg', t('adm_saving'));
    fetch('/api/admin/result', { method: 'POST', headers: jhdr, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) { admMsg('gxa-msg', res.ok ? (body.remove ? '✓ ' + t('adm_removed') : '✓ ' + t('adm_saved')) : '✗ ' + (res.j.error || 'error')); })
      .catch(function () { admMsg('gxa-msg', '✗ ' + t('adm_neterr')); });
  }
  function admBroadcast(test, variant) {
    if (_admBusy) return;
    if (!test && !window.confirm(t('adm_bc_confirm'))) return;
    _admBusy = true; admMsg('gxa-bcmsg', test ? t('adm_bc_sending_test') : t('adm_bc_starting'));
    var done = function () { _admBusy = false; };
    fetch('/api/admin/broadcast', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, hdrs()), body: JSON.stringify({ test: test, variant: variant }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || res.j.ok === false) { admMsg('gxa-bcmsg', '✗ ' + (res.j.error || 'error')); return done(); }
        if (test) { admMsg('gxa-bcmsg', '✓ ' + t('adm_bc_test_ok', { sent: res.j.sent, total: res.j.total })); return done(); }
        admMsg('gxa-bcmsg', t('adm_bc_started', { total: res.j.total }));
        var poll = function () {
          fetch('/api/admin/broadcast', { headers: hdrs() }).then(function (r) { return r.json(); }).then(function (s) {
            if (s.running) { admMsg('gxa-bcmsg', t('adm_bc_progress', { sent: s.sent, total: s.total }) + (s.failed ? ' · ' + s.failed + ' ✗' : '')); setTimeout(poll, 3000); }
            else { admMsg('gxa-bcmsg', '✓ ' + t('adm_bc_done', { sent: s.sent, total: s.total }) + (s.failed ? ' · ' + s.failed + ' ✗' : '')); done(); }
          }).catch(function () { admMsg('gxa-bcmsg', t('adm_bc_server')); done(); });
        };
        setTimeout(poll, 2500);
      })
      .catch(function () { admMsg('gxa-bcmsg', '✗ ' + t('adm_neterr')); done(); });
  }
  function admTelegram(url) {
    admMsg('gxa-tgmsg', t('adm_tg_sending'));
    fetch(url, { method: 'POST', headers: hdrs() }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) { admMsg('gxa-tgmsg', res.ok && res.j.ok ? '✓ ' + t('adm_tg_ok') : '✗ ' + (res.j.error || t('adm_tg_fail'))); })
      .catch(function () { admMsg('gxa-tgmsg', '✗ ' + t('adm_neterr')); });
  }
  function admExportCSV() {
    var q = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var rows = [['email', 'nombre', 'pais', 'idioma_marketing', 'idioma_elegido', 'estado', 'fuente', 'registro', 'ultima_visita', 'favoritos']]
      .concat((S._admUsers || []).map(function (u) { return [u.email, u.name || '', u.country || '', u.mailLang || 'es', u.lang || '', u.verified === false ? 'lead' : 'verificado', u.ref, new Date(u.createdAt).toISOString(), new Date(u.lastSeen).toISOString(), u.favorites]; }));
    var csv = rows.map(function (r) { return r.map(q).join(','); }).join('\n');
    var a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = 'usuarios-gp-simulador.csv'; a.click();
  }

  // ---------- lang ----------
  function setLang(l) {
    if (l !== 'es' && l !== 'en') return; LANG = l; try { localStorage.setItem('gp_lang', l); } catch (e) {} document.documentElement.lang = l;
    shell(); render();
    var rr = { match: renderMatch, matches: renderMatches, sim: renderSim, teams: renderTeams, team: renderTeam, groups: renderGroups, bracket: renderBracket, evo: renderEvo, registry: renderRegistry, method: renderMethod, admin: renderAdmin, follow: renderFollow, alerts: renderAlerts, refer: renderRefer, perf: renderPerf, calc: renderCalc, sub: renderSub, support: renderSupport, bets: renderBets, books: renderBooks, brief: renderBrief };
    if (CB_VIEWS.indexOf(S.view) >= 0) { applyView(); renderCb(S.view); }
    else if (rr[S.view]) { applyView(); rr[S.view](); }
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
  // Ventana "sin animación de entrada" para re-renders SILENCIOSOS: el refresco en vivo redibuja el DOM y
  // sin esto las cards REPLAYEAN el fade-up (gxUp) en cada ciclo → la página "pestañea". La clase se quita
  // sola a los 3s (cubre el fetch+render async del reload silencioso).
  function noAnimWindow() {
    document.body.classList.add('gx-noanim');
    clearTimeout(S._noanimT);
    S._noanimT = setTimeout(function () { document.body.classList.remove('gx-noanim'); }, 3000);
  }
  // F1.2: refresco SILENCIOSO del cockpit de club abierto (gp_live/momentum se mueven con el marcador). Mismo
  // patrón que el re-fetch del cockpit del Mundial en refreshLive: re-render solo si el payload cambió.
  function refreshClubMatchLive(eid) {
    var parts = eid.slice(3).split('-'); var lgk = parts[0], hId = parts[1], aId = parts[2];
    var Lup = clubLeague(lgk), fxm = Lup ? (Lup.upcoming || []).find(function (f) { return f.home.id === hId && f.away.id === aId; }) : null;
    var nq = fxm ? '&hn=' + encodeURIComponent(fxm.home.name) + '&an=' + encodeURIComponent(fxm.away.name) : '';
    fetch('/api/clubs/match?hl=' + encodeURIComponent(lgk) + '&h=' + encodeURIComponent(hId) + '&al=' + encodeURIComponent(lgk) + '&a=' + encodeURIComponent(aId) + nq, { headers: hdrs() })
      .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (m) {
        if (!m || S.view !== 'match' || S.matchId !== eid) return;
        var prev = S.clm[eid];
        try { if (prev && JSON.stringify(prev) === JSON.stringify(m)) return; } catch (e) {}
        S.clm[eid] = m; noAnimWindow(); renderMatch();
      });
  }
  // F1.2: refresca el estado de clubes en vivo (la cartelera y el cockpit) — loadClubs es one-shot, así que sin
  // esto los marcadores/GP en vivo solo se movían al recargar. Anti-pestañeo por comparación de JSON.
  function refreshClubsLive() {
    if (!clubsOn()) return;
    fetch('/api/clubs/state', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
      if (!j) return;
      var js = null; try { js = JSON.stringify(j.leagues || []); } catch (e) { js = null; }
      if (!(js && js === S._clubsJson)) {
        if (js) S._clubsJson = js; S.clubs = j;
        S.clubNames = {};
        (j.leagues || []).forEach(function (L) { (L.table || []).forEach(function (tm) { S.clubNames[tm.id] = tm.name; }); });
        if (S.view === 'matches') { noAnimWindow(); renderMatches(); }
      }
      if (S.view === 'match' && /^cl-/.test(S.matchId || '')) refreshClubMatchLive(S.matchId);
    });
  }
  function refreshLive() {
    if (clubsOn() && (S.view === 'matches' || (S.view === 'match' && /^cl-/.test(S.matchId || '')))) refreshClubsLive();
    fetch('/api/state', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (st) {
      if (!st) return;
      S._lastLiveAt = Date.now();
      // ANTI-PESTAÑEO (8-jul): si el estado es IDÉNTICO al del último refresco (fuera del timestamp de
      // sync, que cambia siempre), no se re-renderiza NADA. El parpadeo era el board redibujándose entero
      // cada push/poll aunque no hubiera un solo dato nuevo.
      var _cmp = null;
      try { var _c = {}; for (var _k in st) if (_k !== 'sync') _c[_k] = st[_k]; _cmp = JSON.stringify(_c); } catch (e) { _cmp = null; }
      if (_cmp && _cmp === S._lastStateJson) return;
      if (_cmp) S._lastStateJson = _cmp;
      var wasLive = anyLive();
      ingestState(st);
      var live = anyLive();
      if (!live && !wasLive && S.view !== 'match') return; // nada que mover
      noAnimWindow();
      if (S.view === 'matches') renderMatches();
      else if (S.view === 'opps' || S.view === 'board') load(0, true); // silencioso: sin spinner (no saltar el scroll ni cerrar la calculadora)
      // cockpit de un partido abierto: re-fetch SILENCIOSO del fx (marcador/eventos/gpLive/momentum) y
      // re-render SOLO si el payload cambió (evita redibujar por redibujar → sin parpadeo).
      if (S.view === 'match' && S.matchId) {
        var mid = S.matchId;
        var apply = function (cacheKey) {
          return function (m) {
            if (!m || S.view !== 'match' || S.matchId !== mid) return;
            var prev = S.mfix[cacheKey];
            try { if (prev && JSON.stringify(prev) === JSON.stringify(m)) return; } catch (e) { }
            S.mfix[cacheKey] = m; noAnimWindow(); renderMatch();
          };
        };
        if (/^fx-/.test(mid)) {
          var fxid = mid.slice(3);
          fetch('/api/match/' + encodeURIComponent(fxid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(apply(fxid));
        } else {
          var beta = S.mc[mid];
          var fid = (beta && beta.header) ? fixtureIdFor(beta.header) : null;
          if (fid != null) fetch('/api/match/' + encodeURIComponent(fid), { headers: hdrs() }).then(function (x) { return x.ok ? x.json() : null; }).catch(function () { return null; }).then(apply(fid));
        }
      }
    });
  }
  function startLiveLoop() { if (S._liveTimer) return; S._liveTimer = setInterval(function () { try { refreshLive(); } catch (e) {} try { if ((S.view === 'board' || S.view === 'opps') && S.oppSub === 'arb') refreshArbSilent(); } catch (e) {} }, 25000); startSse(); }
  // SSE: el server EMPUJA 'update' al instante en que el sync ve un cambio (gol/minuto/final) → refresco
  // inmediato (~10-15s tras el gol real vs hasta ~55s con solo polling). El polling de 25s QUEDA como respaldo:
  // si SSE falla o un proxy lo corta, todo sigue funcionando exactamente como antes. Debounce 1.5s por ráfagas.
  function startSse() {
    if (S._sse || typeof EventSource === 'undefined') return;
    try {
      var es = new EventSource('/api/stream');
      var deb = null;
      es.addEventListener('update', function () {
        if (deb) return;
        deb = setTimeout(function () { deb = null; }, 1500);
        // throttle: si el polling (u otro push) refrescó hace <10s, no redibujar de nuevo — el SSE aporta
        // inmediatez tras un gol, no más frecuencia sostenida (evita el "pestañeo" por doble disparador).
        if (S._lastLiveAt && Date.now() - S._lastLiveAt < 10000) return;
        try { refreshLive(); } catch (e) { }
      });
      es.onerror = function () { /* EventSource se auto-reconecta solo; el polling sigue de respaldo */ };
      S._sse = es;
    } catch (e) { /* navegador sin SSE → polling normal, como siempre */ }
  }

  // ---------- boot ----------
  function boot() {
    // FUSIÓN — un solo sitio: la plataforma se sirve en la raíz (gpsimulador.com). El SERVER decide qué servir en /
    // por la cookie de sesión (sin redirección). Acá sincronizamos cookie↔localStorage para que ambos coincidan
    // (la cookie deja que el server sepa que hay sesión; localStorage sigue siendo la fuente para las APIs).
    try {
      var _ls = localStorage.getItem('wc_token');
      var _ck = (document.cookie.match(/(?:^|;\s*)wc_token=([^;]+)/) || [])[1];
      if (_ls && !_ck) document.cookie = 'wc_token=' + _ls + ';path=/;max-age=31536000;SameSite=Lax';
      else if (!_ls && _ck) localStorage.setItem('wc_token', decodeURIComponent(_ck));
    } catch (e) {}
    fetch('/api/i18n').then(function (r) { return r.json(); }).then(function (j) {
      TEAMS = j.teams || {};
    }).catch(function () {}).then(function () {
      // flags desde el estado global (si el server los expone) — si no, fallback vacío (los nombres igual van).
      fetch('/api/state', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (st) {
        ingestState(st);
        var pref; try { pref = localStorage.getItem('gp_lang'); } catch (e) {}
        LANG = (pref === 'en' || pref === 'es') ? pref : (function(){var d=(typeof window!=='undefined'&&window.__GPDL)||'en';if(d==='es'||d==='en')return d;return (navigator.language||'es').slice(0,2)==='en'?'en':'es';})();
        document.documentElement.lang = LANG;
        // R2: deporte inicial — el hash manda (link directo a #cb*); si no, el último usado
        var h0 = ''; try { h0 = (location.hash || '').replace(/^#/, ''); } catch (e) {}
        if (/^cb/.test(h0)) S.sport = 'combat';
        else { var sp0; try { sp0 = localStorage.getItem('gp_sport'); } catch (e) {} if (sp0 === 'combat' && !h0) S.sport = 'combat'; }
        shell(); load(); loadCanon(); startLiveLoop();
        fetch('/api/me', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (me) {
          // Guard: /x es la plataforma nueva para usuarios CON acceso beta (o admin). Si alguien sin acceso entra
          // manualmente a /x, lo devolvemos a la plataforma actual (no debe quedar atrapado con datos gateados).
          if (!me || (!me.beta_access && !me.isAdmin)) { try { localStorage.removeItem('wc_token'); document.cookie = 'wc_token=;path=/;max-age=0'; } catch (e) {} if (!/[?&]noredir=1/.test(location.search)) { location.replace('/landing'); return; } }
          if (me) { S.me = me; syncAdminUI(); syncFounderBanner(); maybeOnboard(); if (!document.getElementById('gx-onb')) maybeTrialModal(); loadPlayerIndex(); loadClubsPlayerIndex();
            // FASE CLUBES shadow: /api/me llega DESPUÉS del primer render por hash → precargar clubes y
            // repintar Partidos para que el selector de competición aparezca sin interacción extra.
            // el shell se pinta ANTES de que llegue /api/me → el sportbar se construyó sin saber si combate
            // está permitido. Si al llegar la sesión cambia el veredicto, se reconstruye (badge "Próximamente").
            if (cbSportAllowed() && $('.gx-cbsoon')) shell();
            if (me.clubs_shadow) { loadClubs(); if (S.view === 'matches') renderMatches(); } if (!me.isAdmin && (['registry', 'method', 'admin'].indexOf(S.view) >= 0 || (CB_VIEWS.indexOf(S.view) >= 0 && !cbCanSee(S.view)) || (S.view === 'sub' && !me.founder_public))) { if (S.sport === 'combat') { S.sport = 'futbol'; shell(); } showView('board'); } else if (CB_VIEWS.indexOf(S.view) >= 0) { applyView(); renderCb(S.view); } else if (['follow', 'alerts', 'refer', 'admin', 'registry', 'method', 'perf', 'sub', 'support', 'bets', 'books', 'brief'].indexOf(S.view) >= 0) { applyView(); ({ follow: renderFollow, alerts: renderAlerts, refer: renderRefer, admin: renderAdmin, registry: renderRegistry, method: renderMethod, perf: renderPerf, sub: renderSub, support: renderSupport, bets: renderBets, books: renderBooks, brief: renderBrief }[S.view] || function () {})(); } }
        });
        document.addEventListener('click', function (e) {
          var mo = e.target.closest('[data-more]'); if (mo) { e.preventDefault(); openMoreSheet(); return; }
          var cb = e.target.closest('[data-calc]'); if (cb) { e.preventDefault(); e.stopPropagation(); toggleCalc(cb); return; }
          var wpb = e.target.closest('[data-watchbtn]'); if (wpb) { e.preventDefault(); e.stopPropagation(); toggleWatchRow(wpb); return; }
          var wt = e.target.closest('[data-whytoggle]'); if (wt) { e.preventDefault(); e.stopPropagation(); var wb = wt.parentNode.querySelector('.gx-pick-why'); if (wb) { wb.hidden = !wb.hidden; wt.classList.toggle('open', !wb.hidden); } return; }
          var oh = e.target.closest('[data-openhash]'); if (oh) { e.preventDefault(); setHash(oh.getAttribute('data-openhash')); return; }
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
