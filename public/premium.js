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
      best_pick: 'Mejor pick GP', best_value: 'Mejor value', top_gap: 'Mayor desacuerdo', arb_verified: 'Arbitraje verificado',
      edge_adj: 'Edge ajustado', no_arb: 'Sin arbitraje ejecutable', no_arb_sub: 'GP sigue comparando precios y reglas', none: 'Sin datos aún',
      th_time: 'Hora', th_match: 'Partido', th_state: 'Estado', th_gp: 'Probabilidad GP', th_market: 'Mercado', th_price: 'Mejor precio', th_edge: 'Edge aj.', th_signal: 'Señal',
      st_live: 'EN VIVO', st_today: 'HOY', st_tom: 'MAÑANA', vs: 'vs',
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
      memo_risk_default: 'Las dudas de disponibilidad y el desacuerdo con el mercado reducen la confianza.',
      memo_inval: 'Revisar si cambian las alineaciones o la cuota cae por debajo del mínimo.',
      loading: 'Cargando…', no_match: 'Elegí un partido del board para ver su cockpit.',
      reg90: '90 min · sin prórroga ni penales', updated_short: 'Actualizado',
      sig_strong: 'STRONG', sig_lean: 'LEAN', sig_watch: 'WATCH', sig_pass: 'PASS',
      comp: 'Copa Mundial de la FIFA 2026', none_active_pick: 'No hay Picks GP activas en este momento.',
      below_min: 'El precio actual está por debajo de la cuota mínima requerida.', min_odds: 'Cuota mínima', cur_price: 'Mejor precio',
      cta_pick: 'Ver pick GP', cta_value: 'Ver oportunidad', cta_analysis: 'Ver análisis completo', cta_analyze: 'Analizar partido', cta_arb: 'Ver arbitraje', cta_state: 'Ver estado',
      unc_copy: 'Las estimaciones internas no convergen del todo, así que la confianza se mantiene moderada.',
      thesis_price_only: 'La diferencia proviene sobre todo del precio: el contexto disponible no aporta evidencia suficiente para elevar la confianza.',
      thesis_ctx2: 'GP apoya su lectura en {factors}.',
      e_na: 'Aún no disponible', e_nomarket: 'Mercado no encontrado', e_lineups: 'Esperando alineaciones', e_partial: 'Contexto parcial', e_noprice: 'Sin precio verificable',
      trust_data: 'Datos', trust_market: 'Mercado', trust_lineup: 'Alineación', trust_context: 'Contexto', t_sources: '{n} fuentes', t_pending: 'Pendiente', t_confirmed: 'Confirmada', t_broad: 'Amplio', t_partial: 'Parcial', t_base: 'Base',
    },
    en: {
      nav_opps: 'Opportunities', nav_matches: 'Matches', nav_teams: 'Teams', nav_sim: 'Simulator', nav_follow: 'Following',
      nav_alerts: 'Alerts', nav_perf: 'Performance', nav_groups: 'Groups', nav_bracket: 'Bracket', nav_evo: 'Evolution',
      nav_registry: 'Registry', nav_method: 'Methodology', nav_admin: 'Admin', more: 'More',
      search: 'Search teams, matches, markets…', matches: 'matches', live: 'live', signals: 'signals today',
      title: 'Opportunities', all: 'All', live_f: 'Live', upcoming_f: 'Upcoming', picks: 'GP Picks', value: 'Value', arb: 'Arbitrage',
      updated: 'Updated {t} ago', board: 'Opportunities board',
      best_pick: 'Top GP pick', best_value: 'Top value', top_gap: 'Biggest disagreement', arb_verified: 'Verified arbitrage',
      edge_adj: 'Adjusted edge', no_arb: 'No executable arbitrage', no_arb_sub: 'GP keeps comparing prices and rules', none: 'No data yet',
      th_time: 'Time', th_match: 'Match', th_state: 'State', th_gp: 'GP probability', th_market: 'Market', th_price: 'Best price', th_edge: 'Adj. edge', th_signal: 'Signal',
      st_live: 'LIVE', st_today: 'TODAY', st_tom: 'TOMORROW', vs: 'vs',
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
      memo_risk_default: 'Availability doubts and market disagreement reduce confidence.',
      memo_inval: 'Watch for lineup changes or the price dropping below the minimum.',
      loading: 'Loading…', no_match: 'Pick a match from the board to see its cockpit.',
      reg90: '90 min · no extra time or penalties', updated_short: 'Updated',
      sig_strong: 'STRONG', sig_lean: 'LEAN', sig_watch: 'WATCH', sig_pass: 'PASS',
      comp: 'FIFA World Cup 2026', none_active_pick: 'No active GP Picks right now.',
      below_min: 'The current price is below the required minimum odds.', min_odds: 'Minimum odds', cur_price: 'Best price',
      cta_pick: 'View GP pick', cta_value: 'View opportunity', cta_analysis: 'View full analysis', cta_analyze: 'Analyze match', cta_arb: 'View arbitrage', cta_state: 'View status',
      unc_copy: 'Internal estimates don’t fully converge, so confidence stays moderate.',
      thesis_price_only: 'The gap comes mainly from price: the available context doesn’t provide enough evidence to raise confidence.',
      thesis_ctx2: 'GP backs its read on {factors}.',
      e_na: 'Not available yet', e_nomarket: 'Market not found', e_lineups: 'Awaiting lineups', e_partial: 'Partial context', e_noprice: 'No verifiable price',
      trust_data: 'Data', trust_market: 'Market', trust_lineup: 'Lineup', trust_context: 'Context', t_sources: '{n} sources', t_pending: 'Pending', t_confirmed: 'Confirmed', t_broad: 'Broad', t_partial: 'Partial', t_base: 'Base',
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
  var S = { dash: null, value: null, sel: null, match: null, sub: 'picks', filt: 'all', mc: {} };

  // ---------- icons ----------
  var ic = function (n) { return '<i class="ti ti-' + n + '" aria-hidden="true"></i>'; };
  var NAV = [
    ['opps', 'target-arrow', 'nav_opps'], ['matches', 'ball-football', 'nav_matches'], ['teams', 'shield', 'nav_teams'],
    ['sim', 'arrows-shuffle', 'nav_sim'], ['follow', 'star', 'nav_follow'], ['alerts', 'bell', 'nav_alerts'], ['perf', 'chart-line', 'nav_perf']
  ];
  var NAV2 = [['groups', 'layout-grid', 'nav_groups'], ['bracket', 'tournament', 'nav_bracket'], ['evo', 'trending-up', 'nav_evo'], ['registry', 'file-check', 'nav_registry'], ['method', 'book', 'nav_method'], ['admin', 'settings', 'nav_admin']];

  function shell() {
    var navHtml = NAV.map(function (n) { return '<div class="gx-nav' + (n[0] === 'opps' ? ' on' : '') + '">' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></div>'; }).join('');
    var nav2 = NAV2.map(function (n) { return '<div class="gx-nav">' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></div>'; }).join('');
    var bnav = [['opps', 'target-arrow', 'nav_opps'], ['matches', 'ball-football', 'nav_matches'], ['teams', 'shield', 'nav_teams'], ['sim', 'arrows-shuffle', 'nav_sim'], ['follow', 'dots', 'more']]
      .map(function (n, i) { return '<a class="' + (i === 0 ? 'on' : '') + '">' + ic(n[1]) + '<span>' + esc(t(n[2])) + '</span></a>'; }).join('');
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
    var bestEdge = null, signal = null, rank = { STRONG: 3, LEAN: 2, WATCH: 1, PASS: 0 };
    vals.forEach(function (v) { if (bestEdge == null || (v.adjusted_edge_pp || -9) > bestEdge) bestEdge = v.adjusted_edge_pp; if (signal == null || rank[v.classification_code] > rank[signal]) signal = v.classification_code; });
    return { h: h, gp: function (c) { return oc[c] ? oc[c].gp_probability : null; }, mk: function (c) { return oc[c] ? oc[c].market_probability : null; }, best: function (c) { return bySel[c] ? bySel[c].best_odds : null; }, edge: bestEdge, signal: signal, live: (h.status_code === 'LIVE'), kickoff: h.kickoff_at };
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
    cards.push(kpiCard(t('top_gap'), 'arrows-diff', gap ? kpiGap(gap) : kpiEmpty()));
    cards.push(kpiCard(t('arb_verified'), 'shield-check', '<div class="gx-kpi-main"><div><div class="gx-kpi-sel gx-dim">' + esc(t('no_arb')) + '</div><div class="gx-kpi-sub">' + esc(t('no_arb_sub')) + '</div></div></div>'));
    $('#gx-kpis').innerHTML = cards.join('');
  }
  function kpiCard(label, icon, body) { return '<div class="gx-panel gx-kpi"><div class="gx-label">' + ic(icon) + esc(label) + '</div>' + body + '</div>'; }
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
    if (r.live) return '<span class="gx-live-pill">' + esc(t('st_live')) + '</span>';
    var d = r.kickoff ? new Date(r.kickoff) : null, now = new Date();
    var lbl = t('st_today'); if (d) { var diff = (d - now) / 864e5; if (diff > 1) lbl = t('st_tom'); }
    return '<span class="gx-dim" style="font-size:11px;font-weight:600">' + esc(lbl) + '</span>';
  }
  function board(rows) {
    if (S.filt === 'live') rows = rows.filter(function (r) { return r.live; });
    $('#gx-board-count').textContent = rows.length + ' · ' + t('th_gp').toLowerCase();
    var bd = $('#gx-board');
    if (!rows.length) { bd.innerHTML = '<div class="gx-empty">' + ic('chart-dots') + '<b>' + esc(t('e_na')) + '</b></div>'; return; }
    // tabla (desktop) y cards (móvil) ambas en el DOM; CSS muestra la que corresponde por viewport (confiable).
    bd.innerHTML = '<div class="gx-bd-desk">' + boardTable(rows) + '</div><div class="gx-bd-mob">' + boardCards(rows) + '</div>';
    [].forEach.call(bd.querySelectorAll('[data-id]'), function (el) {
      el.addEventListener('click', function () { S.sel = el.dataset.id; var rs = (S.dash.upcoming || []).map(function (u) { return eventRow(u, gExpandValue(S.value)); }); board(rs); cockpit(rs); if (window.innerWidth <= 860) { var ck = $('#gx-cockpit'); if (ck) ck.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
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
      '<button class="gx-btn">' + esc(memo.cta) + ' ' + ic('arrow-right') + '</button></div>' +
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
  function dataTrust(r, ma) {
    var fresh = ma && ma.analysis ? ma.analysis.data_freshness_code : null;
    var cs = ma && ma.analysis ? ma.analysis.context_state_code : null;
    var lineup = ma && ma.risks && ma.risks.indexOf('LINEUP_NOT_CONFIRMED') >= 0;
    var rows = [
      [t('trust_data'), fresh ? (fresh === 'FRESH' ? (LANG === 'en' ? 'Fresh' : 'Frescos') : fresh === 'AGING' ? (LANG === 'en' ? 'Aging' : 'Envejeciendo') : (LANG === 'en' ? 'Stale' : 'Desactualizados')) : (ma ? t('e_na') : '…')],
      [t('trust_context'), cs === 'FULL_CONTEXT' ? t('t_broad') : cs === 'PARTIAL_CONTEXT' ? t('t_partial') : cs === 'BASE_ONLY' ? t('t_base') : (ma ? t('e_partial') : '…')],
      [t('trust_lineup'), ma ? (lineup ? t('t_pending') : t('t_confirmed')) : '…']
    ];
    return '<div class="gx-trust">' + rows.map(function (x) { return '<div class="gx-trust-i"><span class="gx-label">' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>'; }).join('') + '</div>';
  }
  function ckStat(label, v) { return '<div class="gx-ck-stat"><div class="gx-label">' + esc(label) + '</div><div class="v">' + v + '</div></div>'; }
  function memoItem(key, val, cls) { return '<div class="gx-memo-item ' + (cls || '') + '"><div class="gx-label">' + esc(t(key)) + '</div><p>' + val + '</p></div>'; }

  var FACT = { es: { FORM: 'forma reciente', STREAK: 'racha', SOLIDITY: 'solidez defensiva', SQUAD_QUALITY: 'calidad de plantilla', AVAILABILITY: 'disponibilidad del plantel', REST: 'descanso', GOALKEEPER: 'el arquero', TACTICS: 'la lectura táctica', VENUE: 'el escenario', WEATHER: 'el clima', LINEUP: 'la alineación' }, en: { FORM: 'recent form', STREAK: 'streak', SOLIDITY: 'defensive solidity', SQUAD_QUALITY: 'squad quality', AVAILABILITY: 'squad availability', REST: 'rest', GOALKEEPER: 'the goalkeeper', TACTICS: 'the tactical read', VENUE: 'the venue', WEATHER: 'the weather', LINEUP: 'the lineup' } };
  function factLabel(c) { return (FACT[LANG] && FACT[LANG][c]) || (FACT.es[c]) || String(c || '').toLowerCase(); }
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
    var conf = (belowMin || edge == null || edge <= 0) ? { cls: 'lo', label: t('conf_lo') } : edge >= 0.05 ? { cls: 'hi', label: t('conf_hi') } : { cls: 'mid', label: t('conf_mid') };
    var cta = pubPick ? t('cta_pick') : actionable ? t('cta_value') : best ? t('cta_analysis') : t('cta_analyze');
    return { verdict: verdict, thesis: thesis, price: price, risk: risk, inval: inval, conf: conf, bestOdds: best ? best.best_odds : null, book: best ? best.best_sportsbook : '', cta: cta, ma: ma };
  }
  var RISK = { es: { MODEL_DISAGREEMENT: 'Las estimaciones internas no convergen del todo, así que la confianza se mantiene moderada.', LARGE_MARKET_DISAGREEMENT: 'GP y el mercado difieren mucho: mayor potencial pero también mayor riesgo.', MODEL_UNCERTAINTY: 'La incertidumbre de la estimación es elevada para este partido.', LINEUP_NOT_CONFIRMED: 'Las alineaciones aún no están confirmadas.', CONTEXT_INCOMPLETE: 'El contexto disponible es incompleto para este partido.', EARLY_TRACK_RECORD: 'El registro verificable todavía es corto.', LOWER_QUALITY_TIMESTAMP: 'Los datos tienen menor frescura.' }, en: { MODEL_DISAGREEMENT: 'Internal estimates don’t fully converge, so confidence stays moderate.', LARGE_MARKET_DISAGREEMENT: 'GP and the market differ widely: higher upside but also higher risk.', MODEL_UNCERTAINTY: 'Estimate uncertainty is elevated for this match.', LINEUP_NOT_CONFIRMED: 'Lineups are not yet confirmed.', CONTEXT_INCOMPLETE: 'The available context is incomplete for this match.', EARLY_TRACK_RECORD: 'The verifiable track record is still short.', LOWER_QUALITY_TIMESTAMP: 'Data has lower freshness.' } };
  function riskText(c) { return (RISK[LANG] && RISK[LANG][c]) || (RISK.es[c]) || c; }

  // ---------- lang ----------
  function setLang(l) { if (l !== 'es' && l !== 'en') return; LANG = l; try { localStorage.setItem('gp_lang', l); } catch (e) {} document.documentElement.lang = l; shell(); render(); }

  // ---------- boot ----------
  function boot() {
    fetch('/api/i18n').then(function (r) { return r.json(); }).then(function (j) {
      TEAMS = j.teams || {};
    }).catch(function () {}).then(function () {
      // flags desde el estado global (si el server los expone) — si no, fallback vacío (los nombres igual van).
      fetch('/api/state', { headers: hdrs() }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (st) {
        if (st && st.teams) st.teams.forEach(function (tm) { if (tm.id && tm.flag) FLAGS[tm.id] = tm.flag; });
        var pref; try { pref = localStorage.getItem('gp_lang'); } catch (e) {}
        LANG = (pref === 'en' || pref === 'es') ? pref : ((navigator.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es');
        document.documentElement.lang = LANG;
        shell(); load();
      });
    });
  }
  boot();
})();
