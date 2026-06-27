/* beta.js — Fase Q. Experiencia de producto beta (GP Intelligence). SPA vanilla, sin framework.
   Toda cadena visible pasa por I18N.t (cero hardcode). Datos desde /api/beta/* (DTOs neutrales). El idioma se
   resuelve SOLO en presentación: cambiarlo no altera datos ni navegación. Reusa el token wc_token del sitio. */
'use strict';
(function () {
  const TOKEN = () => localStorage.getItem('wc_token') || '';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------------- i18n ----------------
  const I18N = {
    dict: { es: {}, en: {} }, teams: {}, locale: 'es', version: null,
    async load() {
      try {
        const j = await fetch('/api/i18n').then((r) => r.json());
        this.dict = j.dict || this.dict; this.teams = j.teams || {}; this.version = j.i18n_version || null;
      } catch { /* fallback al diccionario vacío → keys crudas */ }
      this.locale = this.resolve();
      document.documentElement.lang = this.locale;
    },
    resolve() {
      const pref = (STATE.gating && STATE.lang) || localStorage.getItem('gp_lang');
      if (pref === 'es' || pref === 'en') return pref;
      return ((navigator.language || 'es').slice(0, 2) === 'en') ? 'en' : 'es';
    },
    setLocale(l) {
      if (l !== 'es' && l !== 'en' || l === this.locale) return;
      this.locale = l; localStorage.setItem('gp_lang', l); document.documentElement.lang = l;
      if (TOKEN()) fetch('/api/me/lang', { method: 'PUT', headers: { Authorization: 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: l }) }).catch(() => {});
      renderShell(); renderRoute(); // re-render con datos en cache: cambiar idioma NO recarga datos
    },
    t(key, args) {
      const tbl = this.dict[this.locale] || this.dict.es || {};
      let s = tbl[key] != null ? tbl[key] : ((this.dict.es || {})[key] != null ? this.dict.es[key] : key);
      return String(s).replace(/\{(\w+)\}/g, (m, k) => (args && args[k] != null ? args[k] : m));
    },
    teamName(id, fb) { const e = this.teams[id]; return (e && e[this.locale]) || (e && e.es) || fb || id || ''; },
  };
  const t = (k, a) => I18N.t(k, a);

  // ---------------- formatters (localizados) ----------------
  const nf = () => new Intl.NumberFormat(I18N.locale === 'en' ? 'en-US' : 'es-ES', { style: 'percent', maximumFractionDigits: 0 });
  const nf1 = () => new Intl.NumberFormat(I18N.locale === 'en' ? 'en-US' : 'es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtPct = (p) => (p == null ? t('common.na') : nf().format(p));
  const fmtOdds = (o) => (o == null ? '—' : nf1().format(o));
  const fmtPP = (pp) => { if (pp == null) return t('common.na'); const v = pp * 100; return (v >= 0 ? '+' : '') + v.toFixed(1) + ' pp'; };
  const fmtDateTime = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(I18N.locale === 'en' ? 'en-US' : 'es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
  const fmtTime = (iso) => { if (!iso) return '—'; try { return new Date(iso).toLocaleTimeString(I18N.locale === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
  const confLabel = (unc) => { if (unc == null) return null; if (unc < 30) return t('confidence.high'); if (unc <= 55) return t('confidence.medium'); return t('confidence.low'); };

  // outcome neutral → etiqueta localizada con team del header
  function outcomeLabel(header, code) {
    if (code === 'DRAW') return t('prob.draw');
    const team = code === 'AWAY' ? header.away : header.home;
    return t('prob.home_win', { team: I18N.teamName(team.team_id, team.name_fallback) });
  }
  function teamLabel(ref, header) { const team = ref === 'away' ? header.away : header.home; return I18N.teamName(team.team_id, team.name_fallback); }

  // ---------------- estado + fetch ----------------
  const STATE = { gating: null, lang: null, route: { name: 'home' }, cache: {} };
  async function gpFetch(path) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(path, { headers: { Authorization: 'Bearer ' + TOKEN() }, signal: ctrl.signal });
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data };
    } catch { return { ok: false, status: 0, data: {} }; }
    finally { clearTimeout(to); }
  }

  // ---------------- estados visuales ----------------
  const loadingState = () => `<div class="gpb-grid cols2">${'<div class="gpb-skel"></div>'.repeat(4)}</div>`;
  const emptyState = (msg, ic = '○') => `<div class="gpb-state"><div class="ic">${ic}</div><div class="msg">${esc(msg)}</div></div>`;
  const errorState = () => `<div class="gpb-state"><div class="ic">!</div><div class="msg">${esc(t('error.load_failed'))}</div><div style="margin-top:14px"><button class="gpb-btn ghost" data-act="reload">${esc(t('common.retry'))}</button></div></div>`;

  // ================= NAV / SHELL =================
  const NAV = ['home', 'intelligence', 'picks', 'value', 'history'];
  function navItems() {
    const g = STATE.gating || {};
    const items = [{ k: 'home', label: t('nav.home') }, { k: 'intelligence', label: t('nav.intelligence') }];
    if (g.picks) items.push({ k: 'picks', label: t('nav.picks') });
    if (g.value) items.push({ k: 'value', label: t('nav.value') });
    if (g.history) items.push({ k: 'history', label: t('nav.history') });
    if (g.arbitrage) items.push({ k: 'arbitrage', label: t('nav.arbitrage') }); // R.4: gateado por GP_ARBITRAGE_UI_ENABLED
    return items;
  }
  function renderShell() {
    $('#gpb-brand-name').textContent = t('brand.product');
    $('#gpb-beta-chip').textContent = t('common.beta');
    const cur = STATE.route.name;
    const items = navItems();
    const arbSoon = (STATE.gating && STATE.gating.arbitrage) ? '' : `<button class="gpb-soon" disabled>${esc(t('nav.arbitrage'))}<span>${esc(t('common.coming_soon'))}</span></button>`;
    const navHtml = items.map((i) => `<button data-route="${i.k}" ${cur === i.k ? 'aria-current="page"' : ''}>${esc(i.label)}</button>`).join('') + arbSoon;
    $('#gpb-nav').innerHTML = navHtml;
    $('#gpb-tabbar').innerHTML = items.map((i) => `<button data-route="${i.k}" ${cur === i.k ? 'aria-current="page"' : ''}>${esc(i.label)}</button>`).join('');
    $('#gpb-lang').innerHTML = ['es', 'en'].map((l) => `<button data-lang="${l}" aria-pressed="${I18N.locale === l}">${l.toUpperCase()}</button>`).join('');
    $('#gpb-disclaimer').textContent = t('disclaimer.not_financial');
  }

  // ================= COMPONENTES =================
  function probBar(prob, header) {
    if (!prob || !prob.outcomes || !prob.outcomes.some((o) => o.gp_probability != null)) return '';
    const seg = (o) => { const w = Math.max(0, (o.gp_probability || 0) * 100); return `<div class="gpb-prob-seg ${o.outcome_code.toLowerCase()}" style="width:${w}%" title="${esc(outcomeLabel(header, o.outcome_code))}">${w >= 12 ? Math.round(w) + '%' : ''}</div>`; };
    const legend = (o) => `<div class="gpb-prob-item ${o.outcome_code.toLowerCase()}"><span class="lab">${esc(outcomeLabel(header, o.outcome_code))}</span><span class="val">${esc(fmtPct(o.gp_probability))}</span><span class="mkt">${esc(t('prob.market'))} ${esc(fmtPct(o.market_probability))}</span></div>`;
    return `<div class="gpb-prob"><div class="gpb-prob-bar" role="img" aria-label="${esc(t('match.gp_probability'))}">${prob.outcomes.map(seg).join('')}</div><div class="gpb-prob-legend">${prob.outcomes.map(legend).join('')}</div></div>`;
  }
  function matchMeta(header) {
    const parts = [];
    parts.push(`<span class="mono">${esc(fmtDateTime(header.kickoff_at))}</span>`);
    if (header.venue) parts.push(`<span>${esc(header.venue)}</span>`);
    if (header.status_code && header.status_code !== 'SCHEDULED') parts.push(`<span>${esc(header.status_code)}</span>`);
    return `<div class="gpb-meta">${parts.join('')}</div>`;
  }
  function teamsLine(header) {
    return `<div class="gpb-teams"><span>${esc(I18N.teamName(header.home.team_id, header.home.name_fallback))}</span><span class="vs">${esc(t('common.vs'))}</span><span>${esc(I18N.teamName(header.away.team_id, header.away.name_fallback))}</span></div>`;
  }
  function classChip(code) { const c = (code || '').toLowerCase(); return `<span class="gpb-chip ${c}">${esc(t('classification.' + c))}</span>`; }

  // ================= PÁGINA: HOME =================
  async function renderHome(view) {
    view.innerHTML = `<h1 class="gpb-page-title">${esc(t('dashboard.title'))}</h1><div class="gpb-page-sub">${esc(t('brand.tagline'))}</div>${loadingState()}`;
    const r = STATE.cache.dashboard || (STATE.cache.dashboard = await gpFetch('/api/beta/dashboard'));
    if (!r.ok) { view.querySelector('.gpb-grid,.gpb-skel') && (view.innerHTML = `<h1 class="gpb-page-title">${esc(t('dashboard.title'))}</h1>${errorState()}`); return; }
    const d = r.data;
    let html = `<h1 class="gpb-page-title">${esc(t('dashboard.title'))}</h1><div class="gpb-page-sub">${esc(t('brand.tagline'))}</div>`;
    // próximos
    html += `<section class="gpb-section"><h2>${esc(t('dashboard.upcoming'))}</h2>`;
    html += d.upcoming.length ? `<div class="gpb-grid cols2">${d.upcoming.slice(0, 6).map(upcomingCard).join('')}</div>` : emptyState(t('dashboard.no_upcoming'));
    html += `</section>`;
    // value
    if ((STATE.gating || {}).value) {
      html += `<section class="gpb-section"><h2>${esc(t('dashboard.value_opps'))}</h2>`;
      html += d.value.length ? `<div class="gpb-grid cols2">${d.value.slice(0, 4).map((v) => valueCard(v, findHeader(d, v.event_id))).join('')}</div>` : emptyState(t('dashboard.no_value'));
      html += `</section>`;
    }
    // picks
    if ((STATE.gating || {}).picks) {
      html += `<section class="gpb-section"><h2>${esc(t('dashboard.recent_picks'))}</h2>`;
      html += d.recent_picks.length ? `<div class="gpb-grid cols2">${d.recent_picks.map(pickCard).join('')}</div>` : emptyState(t('dashboard.no_picks'));
      html += `</section>`;
    }
    view.innerHTML = html;
  }
  function findHeader(d, eventId) { const m = d.upcoming.find((u) => u.header.event_id === eventId); return m ? m.header : null; }
  function upcomingCard(m) {
    const h = m.header;
    return `<article class="gpb-card clickable" tabindex="0" role="button" data-route="match" data-id="${esc(h.event_id)}" aria-label="${esc(I18N.teamName(h.home.team_id, h.home.name_fallback))} ${esc(t('common.vs'))} ${esc(I18N.teamName(h.away.team_id, h.away.name_fallback))}">
      <div class="gpb-match-head">${teamsLine(h)}${m.has_value ? `<span class="gpb-chip lean" style="margin-left:auto">${esc(t('nav.value'))}</span>` : ''}</div>
      ${matchMeta(h)}${probBar(m.probability, h)}
    </article>`;
  }

  // ================= PÁGINA: GP INTELLIGENCE (lista) =================
  async function renderIntelligence(view) {
    view.innerHTML = `<h1 class="gpb-page-title">${esc(t('nav.intelligence'))}</h1><div class="gpb-page-sub">${esc(t('brand.tagline'))}</div>${loadingState()}`;
    const r = STATE.cache.dashboard || (STATE.cache.dashboard = await gpFetch('/api/beta/dashboard'));
    let html = `<h1 class="gpb-page-title">${esc(t('nav.intelligence'))}</h1><div class="gpb-page-sub">${esc(t('brand.tagline'))}</div>`;
    if (!r.ok) { view.innerHTML = html + errorState(); return; }
    html += r.data.upcoming.length ? `<div class="gpb-grid cols2">${r.data.upcoming.map(upcomingCard).join('')}</div>` : emptyState(t('dashboard.no_upcoming'));
    view.innerHTML = html;
  }

  // ================= PÁGINA: MATCH DETAIL =================
  async function renderMatch(view, id) {
    view.innerHTML = loadingState();
    const r = await gpFetch('/api/beta/match/' + encodeURIComponent(id));
    if (r.status === 404) { view.innerHTML = `<button class="gpb-btn ghost" data-route="intelligence">${esc(t('common.back'))}</button>${emptyState(t('error.not_found'))}`; return; }
    if (!r.ok) { view.innerHTML = errorState(); return; }
    const m = r.data; const h = m.header;
    let html = `<button class="gpb-btn ghost" data-route="intelligence" style="margin-bottom:14px">← ${esc(t('common.back'))}</button>`;
    html += `<div class="gpb-card"><div class="gpb-match-head">${teamsLine(h)}</div>${matchMeta(h)}`;
    if (!m.has_official_v2) { html += emptyState(t('match.no_v2')); html += `</div>`; view.innerHTML = html; return; }
    // probabilidad GP
    html += `<div style="margin-top:14px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">${esc(t('match.gp_probability'))}</h2>${probBar(m.probability, h)}<div class="gpb-meta" style="margin-top:8px">${esc(t('match.regulation_note'))}${m.probability.sums_to_one ? '' : ' · ⚠'}</div></div>`;
    // clasificación (qualify) si existe
    if (m.qualify) {
      html += `<div style="margin-top:16px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)">${esc(t('match.qualify_title'))}</h2>
        <div class="gpb-kv"><span class="k">${esc(teamLabel('home', h))}</span><span class="v">${esc(fmtPct(m.qualify.home_qualify))}</span><span class="k">${esc(teamLabel('away', h))}</span><span class="v">${esc(fmtPct(m.qualify.away_qualify))}</span></div>
        <div class="gpb-meta" style="margin-top:6px">${esc(t('match.qualify_note'))}</div></div>`;
    }
    html += `</div>`; // cierra card principal
    // análisis
    html += analysisBlock(m.analysis, h);
    // riesgos
    if (m.risks && m.risks.length) html += `<div class="gpb-card" style="margin-top:12px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:8px">${esc(t('match.risks_title'))}</h2><ul class="gpb-list">${m.risks.map((c) => `<li class="gpb-risk">${esc(t('risk.' + c, {}) !== 'risk.' + c ? t('risk.' + c) : c)}</li>`).join('')}</ul></div>`;
    // goles (flag)
    if (m.goal_insights) html += goalBlock(m.goal_insights, h);
    if (m.updated_at) html += `<div class="gpb-updated" style="margin-top:12px">${esc(t('common.updated_at', { time: fmtTime(m.updated_at) }))}</div>`;
    view.innerHTML = html;
  }
  function analysisBlock(a, h) {
    if (!a) return '';
    let inner = '';
    const adj = a.context_adjustments;
    if (a.applied_factors && a.applied_factors.length) {
      inner += `<h3 style="font-size:12px;color:var(--dim);margin:6px 0">${esc(t('match.drivers_title'))}</h3><ul class="gpb-list">` +
        a.applied_factors.slice(0, 6).map((f) => `<li class="gpb-factor"><span class="fc">${esc(factorLabel(f.factor_code))}</span><span class="fcat">${esc(catLabel(f.category_code))}</span><span style="margin-left:auto;font-family:var(--mono);color:${f.applied_impact >= 0 ? 'var(--accent)' : 'var(--red)'}">${f.applied_impact >= 0 ? '+' : ''}${f.applied_impact}</span></li>`).join('') + `</ul>`;
    } else {
      inner += `<p style="font-size:13px;color:var(--dim)">${esc(a.context_moved_line ? t('match.context_moved') : t('match.context_neutral'))}</p>`;
      if (a.evaluated_factors && a.evaluated_factors.length) {
        inner += `<div style="font-size:11px;color:var(--muted);margin-top:8px">${esc(t('match.evaluated_title'))}</div><div class="gpb-tags">${a.evaluated_factors.map((f) => `<span class="gpb-tag">${esc(factorLabel(f.factor_code))}</span>`).join('')}</div>`;
      }
    }
    if (adj && (adj.HOME != null)) {
      inner += `<div class="gpb-kv" style="margin-top:12px"><span class="k">${esc(t('match.net_adjustment'))} · ${esc(teamLabel('home', h))}</span><span class="v ${adj.HOME >= 0 ? 'pos' : 'neg'}">${fmtPP(adj.HOME)}</span>
        <span class="k">${esc(t('prob.draw'))}</span><span class="v ${adj.DRAW >= 0 ? 'pos' : 'neg'}">${fmtPP(adj.DRAW)}</span>
        <span class="k">${esc(teamLabel('away', h))}</span><span class="v ${adj.AWAY >= 0 ? 'pos' : 'neg'}">${fmtPP(adj.AWAY)}</span></div>`;
    }
    const cs = a.context_state_code ? `<span class="gpb-tag">${esc(t('context_state.' + a.context_state_code, {}) !== 'context_state.' + a.context_state_code ? t('context_state.' + a.context_state_code) : a.context_state_code)}</span>` : '';
    const fr = a.data_freshness_code ? `<span class="gpb-tag">${esc(t('match.data_freshness'))}: ${esc(t('freshness.' + a.data_freshness_code))}</span>` : '';
    return `<div class="gpb-card" style="margin-top:12px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">${esc(t('match.analysis_title'))}</h2>${inner}<div class="gpb-tags" style="margin-top:10px">${cs}${fr}</div></div>`;
  }
  function factorLabel(code) { const k = 'factor.' + code; const v = t(k); return v === k ? code : v; }
  function catLabel(code) { const k = 'category.' + code; const v = t(k); return v === k ? code : v; }

  // ================= GOAL INSIGHTS =================
  function goalBlock(g, h) {
    if (!g) return '';
    const eg = g.expected_goals || {};
    const ou = g.over_under || {};
    const ouCell = (line) => ou[line] ? `<div class="cell"><div class="l">${esc(t('goal.over'))} ${line}</div><div class="n">${esc(fmtPct(ou[line].over))}</div></div>` : '';
    const btts = g.btts ? `<div class="cell"><div class="l">${esc(t('goal.btts'))}</div><div class="n">${esc(fmtPct(g.btts.yes))}</div></div>` : '';
    const scores = (g.top_scores || []).map((s) => `<div class="cell"><div class="l">${esc(s.score)}</div><div class="n">${esc(fmtPct(s.probability))}</div></div>`).join('');
    return `<div class="gpb-goal"><h3>${esc(t('goal.section_title'))}</h3><p class="disc">${esc(t('goal.disclaimer'))}</p>
      <div class="gpb-xg"><div><span class="lab">${esc(teamLabel('home', h))}</span><br>${esc(eg.HOME)}</div><div><span class="lab">${esc(teamLabel('away', h))}</span><br>${esc(eg.AWAY)}</div><div><span class="lab">${esc(t('goal.total'))}</span><br>${esc(eg.TOTAL)}</div></div>
      <div class="gpb-ou">${ouCell('1.5')}${ouCell('2.5')}${ouCell('3.5')}${btts}</div>
      ${scores ? `<div style="font-size:11px;color:var(--dim);margin:12px 0 6px">${esc(t('goal.top_scores'))}</div><div class="gpb-ou">${scores}</div>` : ''}</div>`;
  }

  // ================= PÁGINA: VALUE =================
  const VALUE_FILTERS = [['ACTIONABLE', 'value.filter_actionable'], ['STRONG', 'value.filter_strong'], ['LEAN', 'value.filter_lean'], ['WATCH', 'value.filter_watch'], ['ALL', 'value.filter_all']];
  async function renderValue(view, filter) {
    const f = filter || 'ACTIONABLE';
    let html = `<h1 class="gpb-page-title">${esc(t('value.title'))}</h1><div class="gpb-page-sub">${esc(t('value.subtitle'))}</div>`;
    html += `<div class="gpb-filters" role="group">${VALUE_FILTERS.map(([k, lk]) => `<button data-vfilter="${k}" aria-pressed="${k === f}">${esc(t(lk))}</button>`).join('')}</div><div id="gpb-value-list">${loadingState()}</div>`;
    view.innerHTML = html;
    const r = await gpFetch('/api/beta/value?class=' + f);
    const list = $('#gpb-value-list', view);
    if (!r.ok) { list.innerHTML = errorState(); return; }
    // necesito headers de eventos para etiquetar equipos → uso dashboard cache
    const dash = STATE.cache.dashboard || (STATE.cache.dashboard = await gpFetch('/api/beta/dashboard'));
    const headers = {}; if (dash.ok) dash.data.upcoming.forEach((u) => { headers[u.header.event_id] = u.header; });
    list.innerHTML = r.data.items.length ? `<div class="gpb-grid cols2">${r.data.items.map((v) => valueCard(v, headers[v.event_id])).join('')}</div>` : emptyState(t('value.no_results'));
  }
  function valueCard(v, header) {
    const sel = header ? outcomeLabel(header, v.outcome_code) : (v.outcome_code === 'DRAW' ? t('prob.draw') : v.outcome_code);
    const ev = header ? `${I18N.teamName(header.home.team_id, header.home.name_fallback)} ${t('common.vs')} ${I18N.teamName(header.away.team_id, header.away.name_fallback)}` : '';
    let kv = `<div class="gpb-kv">
      <span class="k">${esc(t('value.gp_prob'))}</span><span class="v">${esc(fmtPct(v.gp_probability))}</span>
      <span class="k">${esc(t('value.market_prob'))}</span><span class="v">${esc(fmtPct(v.market_probability))}</span>
      <span class="k">${esc(t('value.best_odds'))}</span><span class="v">${esc(fmtOdds(v.best_odds))}${v.best_sportsbook ? ' · ' + esc(v.best_sportsbook) : ''}</span>
      <span class="k">${esc(t('value.edge'))}</span><span class="v ${(v.adjusted_edge_pp || 0) >= 0 ? 'pos' : 'neg'}">${esc(fmtPP(v.adjusted_edge_pp))}</span>`;
    if (v.quality_score != null) kv += `<span class="k">${esc(t('value.quality'))}</span><span class="v">${v.quality_score}</span>`;
    kv += `</div>`;
    let blockers = '';
    if (!v.actionable && v.blockers && v.blockers.length) {
      blockers = `<div style="margin-top:8px;font-size:11px;color:var(--muted)">${esc(t('value.blockers_title'))}</div><div class="gpb-tags">${v.blockers.map((b) => `<span class="gpb-tag">${esc(blockerLabel(b))}</span>`).join('')}</div>`;
    }
    return `<article class="gpb-card"><div class="gpb-match-head">${classChip(v.classification_code)}${v.actionable ? `<span class="gpb-chip strong" style="margin-left:auto">${esc(t('value.actionable'))}</span>` : ''}</div>
      <div style="font-weight:700;margin-top:8px">${esc(sel)}</div><div class="gpb-meta">${esc(ev)}</div>${kv}${blockers}</article>`;
  }
  function blockerLabel(b) { const k = 'blocker.' + b; let v = t(k); if (v !== k) return v; const k2 = 'blocker.BLOCKED_' + b; v = t(k2); return v !== k2 ? v : b; }

  // ================= PÁGINA: PICKS =================
  async function renderPicks(view) {
    view.innerHTML = `<h1 class="gpb-page-title">${esc(t('pick.title'))}</h1><div class="gpb-page-sub">${esc(t('pick.subtitle'))}</div>${loadingState()}`;
    const r = STATE.cache.picks || (STATE.cache.picks = await gpFetch('/api/beta/picks'));
    let html = `<h1 class="gpb-page-title">${esc(t('pick.title'))}</h1><div class="gpb-page-sub">${esc(t('pick.subtitle'))}</div>`;
    if (!r.ok) { view.innerHTML = html + errorState(); return; }
    html += r.data.items.length ? `<div class="gpb-grid cols2">${r.data.items.map(pickCard).join('')}</div>` : emptyState(t('pick.no_picks'));
    view.innerHTML = html;
  }
  function pickSelection(p) {
    if (p.selection_display_key) {
      const args = { ...(p.selection_display_args || {}) };
      if (args.team_id) args.team = I18N.teamName(args.team_id);
      return t(p.selection_display_key, args);
    }
    return p.outcome_code || '';
  }
  function pickCard(p) {
    const ev = `${I18N.teamName(p.home_team_id)} ${t('common.vs')} ${I18N.teamName(p.away_team_id)}`;
    const result = p.result_code && p.result_code !== 'PENDING' ? `<span class="gpb-chip ${p.result_code === 'WIN' ? 'win' : p.result_code === 'LOSS' ? 'loss' : 'pending'}" style="margin-left:auto">${esc(t('result.' + p.result_code))}</span>` : `<span class="gpb-chip pending" style="margin-left:auto">${esc(t('lifecycle.' + (p.lifecycle_code || 'PUBLISHED')))}</span>`;
    return `<article class="gpb-card clickable" tabindex="0" role="button" data-route="pick" data-id="${esc(p.pick_id)}">
      <div class="gpb-match-head"><span class="gpb-chip neutral">${esc(t('model_label.' + (p.model_label_code || 'CURRENT')))}</span>${result}</div>
      <div style="font-weight:700;margin-top:8px;font-size:15px">${esc(pickSelection(p))}</div><div class="gpb-meta">${esc(ev)} · <span class="mono">${esc(fmtDateTime(p.kickoff_at))}</span></div>
      <div class="gpb-kv"><span class="k">${esc(t('pick.published_odds'))}</span><span class="v">${esc(fmtOdds(p.published_odds))}</span><span class="k">${esc(t('pick.min_odds'))}</span><span class="v">${esc(fmtOdds(p.minimum_odds))}</span><span class="k">${esc(t('pick.edge'))}</span><span class="v ${(p.adjusted_edge_pp || 0) >= 0 ? 'pos' : 'neg'}">${esc(fmtPP(p.adjusted_edge_pp))}</span></div>
    </article>`;
  }
  async function renderPickDetail(view, id) {
    view.innerHTML = loadingState();
    const r = await gpFetch('/api/beta/picks/' + encodeURIComponent(id));
    if (r.status === 404) { view.innerHTML = `<button class="gpb-btn ghost" data-route="picks">${esc(t('common.back'))}</button>${emptyState(t('error.not_found'))}`; return; }
    if (!r.ok) { view.innerHTML = errorState(); return; }
    const p = r.data; const ev = `${I18N.teamName(p.home_team_id)} ${t('common.vs')} ${I18N.teamName(p.away_team_id)}`;
    let html = `<button class="gpb-btn ghost" data-route="picks" style="margin-bottom:14px">← ${esc(t('common.back'))}</button>`;
    html += `<div class="gpb-card"><div class="gpb-match-head"><span class="gpb-chip neutral">${esc(t('model_label.' + (p.model_label_code || 'CURRENT')))}</span>${p.result_code && p.result_code !== 'PENDING' ? `<span class="gpb-chip ${p.result_code === 'WIN' ? 'win' : 'loss'}" style="margin-left:auto">${esc(t('result.' + p.result_code))}</span>` : `<span class="gpb-chip pending" style="margin-left:auto">${esc(t('lifecycle.' + (p.lifecycle_code || 'PUBLISHED')))}</span>`}</div>
      <h1 class="gpb-page-title" style="margin-top:10px;font-size:20px">${esc(pickSelection(p))}</h1><div class="gpb-meta">${esc(ev)} · <span class="mono">${esc(fmtDateTime(p.kickoff_at))}</span></div>
      <div class="gpb-kv">
        <span class="k">${esc(t('pick.published_odds'))}</span><span class="v">${esc(fmtOdds(p.published_odds))}${p.sportsbook ? ' · ' + esc(p.sportsbook) : ''}</span>
        <span class="k">${esc(t('pick.min_odds'))}</span><span class="v">${esc(fmtOdds(p.minimum_odds))}</span>
        <span class="k">${esc(t('pick.price_state'))}</span><span class="v">${esc(t('price_state.' + (p.price_state_code || 'AVAILABLE')))}</span>
      </div>${p.deep_link ? `<a class="gpb-btn" href="${esc(p.deep_link)}" target="_blank" rel="noopener nofollow" style="margin-top:12px">${esc(t('pick.open_link'))}</a>` : ''}</div>`;
    // inteligencia
    html += `<div class="gpb-card" style="margin-top:12px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">${esc(t('pick.intelligence'))}</h2>
      <div class="gpb-kv">
        <span class="k">${esc(t('pick.gp_prob'))}</span><span class="v">${esc(fmtPct(p.gp_probability))}</span>
        <span class="k">${esc(t('pick.market_prob'))}</span><span class="v">${esc(fmtPct(p.consensus_probability))}</span>
        <span class="k">${esc(t('pick.break_even'))}</span><span class="v">${esc(fmtPct(p.break_even_probability))}</span>
        <span class="k">${esc(t('pick.edge'))}</span><span class="v ${(p.adjusted_edge_pp || 0) >= 0 ? 'pos' : 'neg'}">${esc(fmtPP(p.adjusted_edge_pp))}</span>
        ${p.quality_score != null ? `<span class="k">${esc(t('value.quality'))}</span><span class="v">${p.quality_score}</span>` : ''}
      </div>
      ${p.risk_codes && p.risk_codes.length ? `<div style="margin-top:10px">${p.risk_codes.map((c) => `<div class="gpb-risk" style="margin-top:6px">${esc(riskText(c))}</div>`).join('')}</div>` : ''}
      <p style="font-size:11.5px;color:var(--muted);margin-top:12px">${esc(t('pick.theoretical_note'))}<br>${esc(t('pick.not_advice'))}</p></div>`;
    view.innerHTML = html;
  }
  function riskText(c) { const k = 'risk.' + c; const v = t(k); return v === k ? c : v; }

  // ================= PÁGINA: HISTORY =================
  async function renderHistory(view) {
    view.innerHTML = `<h1 class="gpb-page-title">${esc(t('history.title'))}</h1>${loadingState()}`;
    const r = STATE.cache.history || (STATE.cache.history = await gpFetch('/api/beta/history'));
    let html = `<h1 class="gpb-page-title">${esc(t('history.title'))}</h1>`;
    if (!r.ok) { view.innerHTML = html + errorState(); return; }
    const d = r.data;
    html += `<div class="gpb-page-sub">${esc(t('history.evolved_note'))}</div>`;
    if (d.sample_status_code === 'INSUFFICIENT_SAMPLE') html += `<div class="gpb-risk info" style="margin-bottom:14px">${esc(t('history.insufficient'))}</div>`;
    // métricas
    html += `<div class="gpb-card"><div class="gpb-kv">
      <span class="k">${esc(t('history.picks_total'))}</span><span class="v">${d.picks_total}</span>
      <span class="k">${esc(t('history.won'))}</span><span class="v">${d.wins}</span>
      <span class="k">${esc(t('history.lost'))}</span><span class="v">${d.losses}</span>
      <span class="k">${esc(t('history.void'))}</span><span class="v">${d.voids}</span>
      <span class="k">${esc(t('history.win_rate'))}</span><span class="v">${d.win_rate != null ? esc(fmtPct(d.win_rate)) : esc(t('common.na'))}</span>
      <span class="k">${esc(t('history.sample_size'))}</span><span class="v">${d.settled}</span></div></div>`;
    // baseline interno (referencia, etiquetado como modelo anterior/actual)
    if (d.shadow_baseline && d.shadow_baseline.length) {
      html += `<div class="gpb-card" style="margin-top:12px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:8px">${esc(t('history.baseline'))}</h2>${d.shadow_baseline.map((b) => `<div class="gpb-kv"><span class="k">${esc(t('model_label.' + b.model_label_code))} · ${esc(t('history.sample_size'))}</span><span class="v">${b.n}</span><span class="k">${esc(t('history.brier'))}</span><span class="v">${b.brier != null ? b.brier : esc(t('common.na'))}</span><span class="k">${esc(t('history.log_loss'))}</span><span class="v">${b.log_loss != null ? b.log_loss : esc(t('common.na'))}</span></div>`).join('')}</div>`;
    }
    // picks
    if (d.picks && d.picks.length) html += `<section class="gpb-section" style="margin-top:18px"><h2>${esc(t('pick.title'))}</h2><div class="gpb-grid cols2">${d.picks.map(pickCard).join('')}</div></section>`;
    view.innerHTML = html;
  }

  // ================= PÁGINA: ARBITRAJE (R.4) =================
  const ARB_STATE_CLASS = { EXECUTABLE: 'strong', THEORETICAL_ONLY: 'watch', PARTIAL_EXECUTION_RISK: 'lean', BLOCKED: 'pass', EXPIRED: 'pass', SUSPENDED: 'pass', STALE: 'pass', DEGRADED: 'watch', DETECTED: 'neutral', VALIDATING: 'neutral', SETTLED: 'neutral' };
  function arbStateChip(code) { return `<span class="gpb-chip ${ARB_STATE_CLASS[code] || 'neutral'}">${esc(t('arb.state.' + code, {}) !== 'arb.state.' + code ? t('arb.state.' + code) : code)}</span>`; }
  function arbTitle(o) {
    if (o.home.team_id || o.home.name_fallback) return `${I18N.teamName(o.home.team_id, o.home.name_fallback)} ${t('common.vs')} ${I18N.teamName(o.away.team_id, o.away.name_fallback)}`;
    return t('arb.title') + ' · ' + (o.strategy_code || '');
  }
  async function renderArbitrage(view) {
    view.innerHTML = `<h1 class="gpb-page-title">${esc(t('arb.title'))}</h1><div class="gpb-page-sub">${esc(t('arb.subtitle'))}</div>${loadingState()}`;
    const r = await gpFetch('/api/beta/arbitrage');
    let html = `<h1 class="gpb-page-title">${esc(t('arb.title'))}</h1><div class="gpb-page-sub">${esc(t('arb.subtitle'))}</div>`;
    if (!r.ok) { view.innerHTML = html + errorState(); return; }
    const d = r.data;
    if (d.executable_count === 0) html += `<div class="gpb-risk info" style="margin-bottom:14px">${esc(t('arb.no_executable'))}</div>`;
    html += d.items.length ? `<div class="gpb-grid cols2">${d.items.map(arbCard).join('')}</div>` : emptyState(t('arb.no_opportunities'));
    view.innerHTML = html;
  }
  function arbCard(o) {
    return `<article class="gpb-card clickable" tabindex="0" role="button" data-route="arb" data-id="${esc(o.opportunity_id)}">
      <div class="gpb-match-head"><div class="gpb-teams"><span>${esc(arbTitle(o))}</span></div>${arbStateChip(o.state_code)}</div>
      <div class="gpb-meta">${o.venues && o.venues.length ? esc(o.venues.join(' · ')) : ''}${o.updated_at ? ' · <span class="mono">' + esc(fmtTime(o.updated_at)) + '</span>' : ''}</div>
      <div class="gpb-kv">
        <span class="k">${esc(t('arb.net_return'))}</span><span class="v ${(o.net_roi || 0) > 0 ? 'pos' : 'neg'}">${esc(fmtPP(o.net_roi))}</span>
        <span class="k">${esc(t('arb.executable_capital'))}</span><span class="v">${o.executable_capital != null ? esc(nf1().format(o.executable_capital)) : esc(t('common.na'))}</span>
      </div></article>`;
  }
  async function renderArbDetail(view, id) {
    view.innerHTML = loadingState();
    const r = await gpFetch('/api/beta/arbitrage/' + encodeURIComponent(id));
    if (r.status === 404) { view.innerHTML = `<button class="gpb-btn ghost" data-route="arbitrage">${esc(t('common.back'))}</button>${emptyState(t('error.not_found'))}`; return; }
    if (!r.ok) { view.innerHTML = errorState(); return; }
    const o = r.data;
    let html = `<button class="gpb-btn ghost" data-route="arbitrage" style="margin-bottom:14px">← ${esc(t('common.back'))}</button>`;
    html += `<div class="gpb-card"><div class="gpb-match-head"><div class="gpb-teams"><span>${esc(arbTitle(o))}</span></div>${arbStateChip(o.state_code)}</div>
      <div class="gpb-meta">${o.venues && o.venues.length ? esc(o.venues.join(' · ')) : ''}</div>
      <p style="font-size:12px;color:var(--muted);margin-top:8px">${esc(t('arb.verified'))}</p></div>`;
    // economía
    const e = o.economics || {};
    html += `<div class="gpb-card" style="margin-top:12px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">${esc(t('arb.economics'))}</h2>
      <div class="gpb-kv">
        <span class="k">${esc(t('arb.gross_margin'))}</span><span class="v">${esc(fmtPP(e.gross_margin))}</span>
        <span class="k">${esc(t('arb.net_margin'))}</span><span class="v ${(e.net_margin || 0) > 0 ? 'pos' : 'neg'}">${esc(fmtPP(e.net_margin))}</span>
        <span class="k">${esc(t('arb.net_profit'))}</span><span class="v">${e.net_profit != null ? esc(nf1().format(e.net_profit)) : esc(t('common.na'))}</span>
        <span class="k">${esc(t('arb.executable_capital'))}</span><span class="v">${e.executable_capital != null ? esc(nf1().format(e.executable_capital)) : esc(t('common.na'))}</span>
        ${e.limiting_leg_index != null ? `<span class="k">${esc(t('arb.limiting_leg'))}</span><span class="v">${esc(t('arb.leg'))} ${e.limiting_leg_index + 1}</span>` : ''}
      </div></div>`;
    // legs
    html += `<div class="gpb-card" style="margin-top:12px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:8px">${esc(t('arb.legs'))}</h2>`;
    html += (o.legs || []).map((l, i) => `<div style="padding:8px 0;border-top:${i ? '1px solid var(--border-subtle)' : '0'}">
      <div style="font-weight:700">${esc(t('arb.leg'))} ${i + 1} · ${esc(l.outcome_code || '')}</div>
      <div class="gpb-kv"><span class="k">${esc(t('arb.venue'))}</span><span class="v">${esc(l.venue || '—')}</span>
        <span class="k">${esc(t('arb.price'))}</span><span class="v">${l.price != null ? esc(nf1().format(l.price)) : '—'}</span>
        ${l.fee != null ? `<span class="k">${esc(t('arb.fee'))}</span><span class="v">${esc(String(l.fee))}</span>` : ''}</div>
      ${l.deep_link ? `<a class="gpb-btn ghost" href="${esc(l.deep_link)}" target="_blank" rel="noopener nofollow" style="margin-top:6px;font-size:12px">${esc(t('arb.open_link'))}${l.deep_link_status === 'FALLBACK_PROVIDER_HOME' ? ' ·' : ''}</a>${l.deep_link_status === 'FALLBACK_PROVIDER_HOME' ? `<div style="font-size:10.5px;color:var(--muted);margin-top:3px">${esc(t('arb.deep_link_fallback'))}</div>` : ''}` : ''}
    </div>`).join('');
    html += `</div>`;
    // settlement compat
    const s = o.settlement_compatibility || {};
    html += `<div class="gpb-card" style="margin-top:12px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:6px">${esc(t('arb.settlement_compat'))}</h2>
      <div class="gpb-tags">${s.semantic_ok ? `<span class="gpb-tag">✓</span>` : (s.blocker_codes || []).slice(0, 5).map(b => `<span class="gpb-tag">${esc(b)}</span>`).join('')}</div></div>`;
    // riesgos
    if (o.risk_codes && o.risk_codes.length) html += `<div class="gpb-card" style="margin-top:12px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:8px">${esc(t('arb.execution_risk'))}</h2><ul class="gpb-list">${o.risk_codes.map(c => `<li class="gpb-risk">${esc(t('arb.risk.' + c, {}) !== 'arb.risk.' + c ? t('arb.risk.' + c) : c)}</li>`).join('')}</ul></div>`;
    // calculadora (no ejecuta; bloquea si no es ejecutable)
    html += `<div class="gpb-card" style="margin-top:12px"><h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin-bottom:8px">${esc(t('arb.calculator'))}</h2>`;
    if (!o.executable) html += `<div class="gpb-risk">${esc(t('arb.calc_blocked'))}</div>`;
    else html += `<div class="gpb-meta">${esc(t('arb.calc_note'))}</div>`;
    html += `</div>`;
    view.innerHTML = html;
  }

  // ================= ROUTER =================
  function parseHash() {
    const h = (location.hash || '#home').replace(/^#/, '');
    const [name, id] = h.split('/');
    return { name: name || 'home', id: id || null };
  }
  function renderRoute() {
    const route = STATE.route; const view = $('#gpb-view');
    renderShell();
    $('#gpb-main').focus({ preventScroll: false });
    const g = STATE.gating || {};
    if (route.name === 'match') return renderMatch(view, route.id);
    if (route.name === 'pick' && g.picks) return renderPickDetail(view, route.id);
    if (route.name === 'intelligence') return renderIntelligence(view);
    if (route.name === 'picks' && g.picks) return renderPicks(view);
    if (route.name === 'value' && g.value) return renderValue(view, 'ACTIONABLE');
    if (route.name === 'history' && g.history) return renderHistory(view);
    if (route.name === 'arbitrage' && g.arbitrage) return renderArbitrage(view);
    if (route.name === 'arb' && g.arbitrage) return renderArbDetail(view, route.id);
    return renderHome(view);
  }
  function go(name, id) { location.hash = '#' + name + (id ? '/' + id : ''); }
  window.addEventListener('hashchange', () => { STATE.route = parseHash(); renderRoute(); });

  // ================= EVENTOS (delegación) =================
  document.addEventListener('click', (e) => {
    const lang = e.target.closest('[data-lang]'); if (lang) { I18N.setLocale(lang.dataset.lang); return; }
    const vf = e.target.closest('[data-vfilter]'); if (vf) { renderValue($('#gpb-view'), vf.dataset.vfilter); return; }
    const act = e.target.closest('[data-act]'); if (act && act.dataset.act === 'reload') { Object.keys(STATE.cache).forEach((k) => delete STATE.cache[k]); renderRoute(); return; }
    const r = e.target.closest('[data-route]'); if (r) { go(r.dataset.route, r.dataset.id); return; }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-route][role="button"]')) { e.preventDefault(); go(e.target.dataset.route, e.target.dataset.id); }
  });

  // ================= BOOT =================
  const gate = (ic, msgKey, withLink) => `<div class="gpb-state"><div class="ic">${ic}</div><div class="msg">${esc(t(msgKey))}</div>${withLink ? `<div style="margin-top:14px"><a class="gpb-btn" href="/">GP Simulador</a></div>` : ''}</div>`;
  async function boot() {
    const main = $('#gpb-view');
    await I18N.load(); // diccionario primero → todos los mensajes (incl. gates) localizados
    if (!TOKEN()) { main.innerHTML = gate('🔒', 'error.session_required', true); return; }
    const r = await gpFetch('/api/beta/bootstrap');
    if (r.status === 401) { main.innerHTML = gate('🔒', 'error.session_required', true); return; }
    if (r.status === 403 || r.status === 404) { main.innerHTML = gate('🔒', 'error.beta_unavailable', false); return; }
    if (!r.ok) { main.innerHTML = gate('!', 'error.load_failed', false); return; }
    STATE.gating = r.data.gating || {}; STATE.lang = r.data.user && r.data.user.lang;
    I18N.locale = I18N.resolve(); document.documentElement.lang = I18N.locale; // re-resuelve con lang del user
    STATE.route = parseHash();
    renderRoute();
  }
  boot();
})();
