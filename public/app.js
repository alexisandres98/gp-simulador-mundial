// Frontend del simulador — vanilla JS, SSE para tiempo real
let STATE = null, USER = null, ARB = null;
const $ = s => document.querySelector(s);
const pct = (p, d = 1) => (p * 100).toFixed(d) + '%';
const token = () => localStorage.getItem('wc_token') || '';
const hdrs = () => token() ? { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };

// Fase K.2 — i18n ES/EN. Consume el diccionario de /api/i18n; el idioma se resuelve en presentación (los datos
// canónicos NO se traducen). Persistencia: perfil (si auth) > localStorage > navegador (1ª visita) > 'es'.
const I18N = {
  dict: { es: {}, en: {} }, teams: {}, locale: 'es', ready: false,
  async load() {
    try { const j = await fetch('/api/i18n').then(r => r.json()); this.dict = j.dict || this.dict; this.teams = j.teams || {}; this.ready = true; } catch {}
    this.locale = this.resolveLocale();
  },
  resolveLocale() {
    const pref = (USER && USER.lang) || localStorage.getItem('gp_lang');
    if (pref === 'es' || pref === 'en') return pref;
    return ((navigator.language || 'es').slice(0, 2) === 'en') ? 'en' : 'es';
  },
  setLocale(l) {
    if (l !== 'es' && l !== 'en') return;
    this.locale = l; localStorage.setItem('gp_lang', l);
    if (USER && USER.email) fetch('/api/me/lang', { method: 'PUT', headers: hdrs(), body: JSON.stringify({ lang: l }) }).catch(() => {});
  },
  t(key, args) {
    const table = this.dict[this.locale] || this.dict.es || {};
    let s = (table[key] != null) ? table[key] : (((this.dict.es || {})[key] != null) ? this.dict.es[key] : key);
    return String(s).replace(/\{(\w+)\}/g, (m, k) => (args && args[k] != null) ? args[k] : m);
  },
  teamName(id, fb) { const e = this.teams[id]; return (e && e[this.locale]) || (e && e.es) || fb || id; },
  renderSelection(model, fbTeam) {
    if (!model || !model.display_key) return '';
    const a = Object.assign({}, model.display_args || {});
    if (a.team_id) a.team = this.teamName(a.team_id, fbTeam);
    return this.t(model.display_key, a);
  },
};
const STAGES_ES = { R32: '16avos', R16: 'Octavos', QF: 'Cuartos', SF: 'Semifinal', '3RD': '3er puesto', FINAL: 'FINAL', group: 'Grupos' };
// §16: etiqueta de fase localizada (usa bracket.* para R32..FINAL; group con clave propia). Fallback a STAGES_ES.
function stageLabel(st) { const k = st === 'group' ? 'stage.group_short' : 'bracket.' + st; const v = I18N.t(k); return v === k ? (STAGES_ES[st] || st) : v; }

const teamOf = id => STATE.teams.find(t => t.id === id);
const tlabel = id => { const t = teamOf(id); return t ? `${t.flag} ${I18N.teamName(t.id, t.name)}` : (id || '—'); };

async function loadState() {
  const s = await (await fetch('/api/state', { headers: hdrs() })).json();
  // Ignora una respuesta "teaser" obsoleta (petición /api/state en vuelo iniciada ANTES del login,
  // sin token) si ya hay sesión: evitaba que, tras iniciar sesión, un loadState rezagado volviera a
  // poner el candado en Oportunidades (las demás pestañas se re-renderizaban después, pero arb no).
  if (s && s.teaser && token()) return;
  STATE = s;
  renderAll();
}

// Ticker de mercados en vivo (Polymarket) en la cabecera — visible con o sin registro
async function renderTicker() {
  try {
    const j = await (await fetch('/api/ticker')).json();
    if (!j.rows || !j.rows.length) return;
    const cents = p => (p * 100).toFixed(1) + '¢';
    const cell = r => {
      const c = r.change24h, cls = Math.abs(c) < 0.0005 ? 'flat' : c > 0 ? 'up' : 'down';
      const arrow = cls === 'flat' ? '—' : c > 0 ? '▲' : '▼';
      const ch = cls === 'flat' ? '' : ` ${(Math.abs(c) * 100).toFixed(1)}%`;
      return `<div class="tk"><span class="tkf">${r.flag}</span><span class="tkn">${r.name}</span><span class="tkp">${cents(r.price)}</span><span class="tkc ${cls}">${arrow}${ch}</span></div>`;
    };
    // duplicar la lista para el scroll infinito sin saltos
    $('#ticker').innerHTML = j.rows.concat(j.rows).map(cell).join('');
    $('#tickerWrap').style.display = '';
  } catch { /* sin mercados, no mostrar ticker */ }
}

// Vista para no registrados: gancho de captura
function renderTeaser() {
  const top = STATE.top;
  const lead = top[0];
  const max = lead.champion;
  const rows = top.slice(1).map((t, i) => `
    <div class="fav-row" onclick="openLogin()">
      <span class="pos">0${i + 2}</span><span class="fl">${t.flag}</span>
      <span class="nm">${t.name}</span>
      <span class="track"><span class="fill" style="width:${(t.champion / max * 100).toFixed(0)}%"></span></span>
      <span class="pc">${pct(t.champion)}</span>
    </div>`).join('');
  const simsStr = STATE.sims.toLocaleString();
  $('#tab-teams').innerHTML = `
    <div class="hero">
      <div class="hero-eyebrow"><span class="dot on"></span>${I18N.t('teaser.eyebrow', { sims: simsStr })}</div>
      <h1 class="hero-h1">${I18N.t('teaser.headline', { wc: `<span class="g">${I18N.t('teaser.wc')}</span>` })}</h1>
      <div class="hero-sub">${I18N.t('teaser.sub', { sims: simsStr })}</div>
      <div class="fav-board">
        <div class="fav-lead tilt" onclick="openLogin()">
          <div class="rk">${I18N.t('teaser.favorite_badge')}</div>
          <div class="lead-team"><div class="fl">${lead.flag}</div><div class="tn">${lead.name}<small>${I18N.t('teaser.group', { group: lead.group })}</small></div></div>
          <div class="lead-big">${(lead.champion * 100).toFixed(1)}<span>%</span></div>
          <div class="lead-cap">${I18N.t('teaser.lead_cap')}</div>
        </div>
        <div class="fav-list">${rows}</div>
      </div>
      <div class="hero-trust">
        <div class="ht"><b>104</b>${I18N.t('teaser.trust_matches')}</div>
        <div class="ht"><b>${STATE.totalTeams}</b>${I18N.t('teaser.trust_teams')}</div>
        <div class="ht"><b>2</b>${I18N.t('teaser.trust_markets')}</div>
        <div class="ht"><b style="color:var(--accent)">${I18N.t('teaser.trust_live')}</b>${I18N.t('teaser.trust_live_sub')}</div>
      </div>
      <div class="hero-cta">
        <button class="btn" onclick="openLogin()">${I18N.t('teaser.cta')}</button>
        <span class="muted" style="font-size:12.5px">${I18N.t('teaser.cta_micro')}</span>
      </div>
    </div>`;
  ['following', 'alerts', 'groups', 'matches', 'bracket', 'arb', 'record', 'evo', 'admin'].forEach(t => {
    $('#tab-' + t).innerHTML = `<div class="lock">
      <div class="lock-icon">🔒</div>
      <div class="lock-title">${I18N.t('teaser.lock_title')}</div>
      <div class="lock-sub">${I18N.t('teaser.lock_sub')}</div>
      <button class="btn" onclick="openLogin()">${I18N.t('teaser.lock_cta')}</button>
      <div class="lock-micro">${I18N.t('teaser.lock_micro')}</div></div>`;
  });
  initTilt();
}
function initTilt() {
  document.querySelectorAll('.tilt').forEach(el => {
    el.onmousemove = e => { const r = el.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; el.style.transform = `perspective(1200px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg)`; };
    el.onmouseleave = () => el.style.transform = '';
  });
}

// Marcador objetivo: ¿le ganamos al mercado? (solo admin)
function marketScoreboardHtml(vm) {
  if (!vm || !vm.n) {
    return `<div class="explain" style="border-left-color:var(--amber)">${I18N.t('scoreboard.accruing')}</div>`;
  }
  const winning = vm.modelBrier < vm.marketBrier;
  return `<div class="explain" style="border-left-color:${winning ? 'var(--accent)' : 'var(--red)'}">
    ${I18N.t('scoreboard.title', { n: vm.n, model: vm.modelBrier, market: vm.marketBrier, verdict: winning ? I18N.t('scoreboard.winning') : I18N.t('scoreboard.losing'), wins: vm.modelWins })}
    <span class="muted" style="font-size:11px">${I18N.t('scoreboard.alpha_proof')}</span></div>`;
}

// ---------- ACIERTOS (track record público del modelo) ----------
async function renderRecord() {
  // Sprint 8.1 §5-8: con UI_VERIFIED_PERFORMANCE_ENABLED → pantalla "Rendimiento" (Verificable | Histórico).
  // Con el flag off, se conserva exactamente la pantalla "Aciertos" de siempre.
  if (USER && USER.uiFlags && USER.uiFlags.verifiedPerformance) return renderPerformance();
  const r = await fetch('/api/aciertos');
  if (!r.ok) return;
  const d = await r.json();
  const pctW = d.total ? Math.round(d.winners / d.total * 100) : 0;
  const recShare = I18N.t('record.share_text', { winners: d.winners, total: d.total, exact: d.exact }).replace(/'/g, "\\'");
  let html = `<div style="margin-bottom:14px"><h2 style="margin-bottom:3px">${I18N.t('record.title')}</h2>
    <div class="muted" style="font-size:12px">${I18N.t('record.subtitle')}</div></div>
    <div class="statrow" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="bigstat"><div class="lbl">${I18N.t('record.evaluated')}</div><div class="val">${d.total}</div></div>
      <div class="bigstat"><div class="lbl">${I18N.t('record.winner_hit')}</div><div class="val pgood">${d.total ? pctW + '%' : '—'}</div><div class="muted" style="font-size:11px">${d.winners}/${d.total}</div></div>
      <div class="bigstat"><div class="lbl">${I18N.t('record.exact_score')}</div><div class="val" style="color:var(--amber)">${d.exact}</div></div>
      ${d.total ? `<div class="bigstat"><div class="lbl">${I18N.t('record.brier')}</div><div class="val blue">${d.brier}</div><div class="muted" style="font-size:11px">${I18N.t('record.chance_066')}</div></div>` : ''}
    </div>
    ${d.total ? `<div class="explain" style="border-left-color:var(--blue)">${I18N.t('record.brier_explain')}</div>` : ''}
    <div class="formrow"><button class="cta-sm" onclick="shareOp(event, '${recShare}')">${I18N.t('record.share_btn')}</button></div>
    ${(USER && USER.isAdmin && d.total) ? marketScoreboardHtml(d.vsMarket) : ''}`;
  if (!d.total) {
    html += `<div class="muted">${I18N.t('record.empty')}</div>`;
  }
  html += '<div class="rec-list">' + d.matches.map(m => {
    const th = teamOf(m.home), ta = teamOf(m.away);
    const pickLabel = m.predicted === 'home' ? I18N.t('record.pick_home', { team: th ? I18N.teamName(th.id, th.name) : m.home }) : m.predicted === 'away' ? I18N.t('record.pick_away', { team: ta ? I18N.teamName(ta.id, ta.name) : m.away }) : I18N.t('record.pick_draw');
    return `<div class="rec-row">
      <span class="rec-dot ${m.correct ? 'ok' : 'no'}"></span>
      <div class="rec-main">
        <div class="rec-score">${th ? th.flag : ''} ${m.home} <b>${m.hg} - ${m.ag}</b> ${m.away} ${ta ? ta.flag : ''}${m.exact ? ` <span class="exact-tag">${I18N.t('record.tag_exact')}</span>` : ''}</div>
        <div class="rec-pred">${I18N.t('record.model_pred', { pick: pickLabel, prob: pct(m.predictedProb) })}</div>
      </div>
      <span class="rec-date">${new Date(m.datetime).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
    </div>`;
  }).join('') + '</div>';
  $('#tab-record').innerHTML = html;
}

// ---------- Sprint 8.1 §5-8: RENDIMIENTO (Verificable | Histórico) — gated por uiFlags.verifiedPerformance ----------
// Default 'legacy' mientras el registro verificable esté vacío (signals=0): el usuario ve datos reales en
// vez de un Verificable vacío. Cuando existan señales verificadas, se puede cambiar el default a 'verified'.
let PERF_SEG = 'legacy';
function perfSetSeg(seg) { PERF_SEG = seg; return renderPerformance(); }
async function renderPerformance() {
  const seg = PERF_SEG;
  const tabBtn = (id, label) => `<button class="seg-btn ${seg === id ? 'on' : ''}" role="tab" aria-selected="${seg === id}" onclick="perfSetSeg('${id}')">${label}</button>`;
  let head = `<div style="margin-bottom:12px"><h2 style="margin-bottom:3px">${xe(I18N.t('perf.title'))}</h2>
    <div class="muted" style="font-size:12px">${I18N.t('perf.subtitle')}</div></div>
    <div class="seg" role="tablist" aria-label="${xe(I18N.t('perf.tablist_aria'))}">${tabBtn('verified', I18N.t('perf.verified_tab'))}${tabBtn('legacy', I18N.t('perf.legacy_tab'))}</div>
    <div id="perfSegBody"><div class="du">${I18N.t('perf.loading')}</div></div>`;
  $('#tab-record').innerHTML = head;
  if (seg === 'verified') $('#perfSegBody').innerHTML = await perfVerifiedHtml();
  else $('#perfSegBody').innerHTML = await perfLegacyHtml();
}

async function perfVerifiedHtml() {
  let sum = null, cal = null;
  try { sum = await fetch('/api/metrics/summary', { headers: hdrs() }).then(x => x.ok ? x.json() : null); } catch (e) { /* noop */ }
  try { cal = await fetch('/api/metrics/calibration', { headers: hdrs() }).then(x => x.ok ? x.json() : null); } catch (e) { /* noop */ }
  const m = (sum && sum.metrics) || {};
  const epoch = sum && sum.verified_epoch ? new Date(sum.verified_epoch).toLocaleDateString() : null;
  const nMax = Math.max(0, ...['brier_multiclass', 'log_loss', 'accuracy_top1', 'ece'].map(k => (m[k] && m[k].sample_size) || 0));
  // §5: sin señales → empty verificable explícito (no ceros que parezcan resultados)
  if (nMax === 0) {
    const emptyMsg = I18N.t('perf.verified_empty');
    return (window.UIState ? UIState.noData(emptyMsg) : `<div class="muted">${xe(emptyMsg)}</div>`) +
      `<div class="muted" style="font-size:11.5px;margin-top:8px">${epoch ? I18N.t('perf.verified_epoch_start', { date: xe(epoch) }) : I18N.t('perf.verified_epoch_pending')} ${I18N.t('perf.metrics_pending')}</div>`;
  }
  // §7: jerarquía → muestra → Brier → log loss → calibración → vs-mercado → CLV → accuracy (secundaria)
  const mc = (label, mk, help, secondary) => {
    const v = m[mk]; const has = v && v.value != null;
    return `<div class="perf-card ${secondary ? 'sec' : ''}"><div class="perf-l">${xe(label)}</div>
      <div class="perf-v">${has ? (typeof v.value === 'number' ? v.value.toFixed(4) : v.value) : 'N/A'}</div>
      <div class="perf-h">${has ? I18N.t('perf.card_help', { n: (v.sample_size || 0), help: xe(help) }) : I18N.t('perf.na_no_sample')}</div></div>`;
  };
  let html = `<div class="explain">${I18N.t('perf.verified_lead', { date: xe(epoch || '—'), n: nMax, copy: xe((sum && sum.copy) || '') })}</div>
    <div class="perf-grid">
      <div class="perf-card hl"><div class="perf-l">${I18N.t('perf.sample_signals')}</div><div class="perf-v">${nMax}</div><div class="perf-h">${I18N.t('perf.sample_help')}</div></div>
      ${mc(I18N.t('perf.brier_1x2'), 'brier_multiclass', I18N.t('perf.brier_help'))}
      ${mc(I18N.t('perf.logloss'), 'log_loss', I18N.t('perf.logloss_help'))}
      ${mc(I18N.t('perf.ece'), 'ece', I18N.t('perf.ece_help'))}
    </div>`;
  if (cal && cal.available && cal.bins && cal.bins.length) html += panel(I18N.t('perf.calibration'), I18N.t('perf.calibration_sub'), calibrationSvg(cal));
  html += `<div class="perf-grid" style="margin-top:10px">${mc(I18N.t('perf.accuracy_secondary'), 'accuracy_top1', I18N.t('perf.accuracy_caveat'), true)}</div>
    <div class="explain" style="border-left-color:var(--blue)">${I18N.t('perf.accuracy_caveat')}</div>
    <div class="formrow"><button class="cta-sm" onclick="sharePerf('verified', ${nMax})">${I18N.t('perf.share_verified')}</button></div>
    <div class="xo-foot">${I18N.t('perf.methodology_foot', { version: xe((sum && sum.methodology_version) || 'metrics-1') })}</div>`;
  return html;
}

async function perfLegacyHtml() {
  let d = null;
  try { d = await fetch('/api/aciertos').then(x => x.ok ? x.json() : null); } catch (e) { /* noop */ }
  if (!d) return window.UIState ? UIState.error() : `<div class="muted">${I18N.t('perf.legacy_load_error')}</div>`;
  const pctW = d.total ? Math.round(d.winners / d.total * 100) : 0;
  // §5: aviso legacy claro arriba
  let html = `<div class="op-state op-warn" role="status"><div class="op-state-ic">⏳</div><div class="op-state-tx">
    <div class="op-state-t">${I18N.t('perf.legacy_notice_title')}</div>
    <div class="op-state-b">${I18N.t('perf.legacy_notice')}</div></div></div>`;
  // §7: Brier primero, "ganador acertado" con caveat (no la cifra dominante única)
  html += `<div class="statrow" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="bigstat"><div class="lbl">${I18N.t('record.evaluated')}</div><div class="val">${d.total}</div></div>
      ${d.total ? `<div class="bigstat"><div class="lbl">${I18N.t('record.brier')}</div><div class="val blue">${d.brier}</div><div class="muted" style="font-size:11px">${I18N.t('perf.lower_is_better')} · ${I18N.t('perf.chance_066_inline')}</div></div>` : ''}
      <div class="bigstat"><div class="lbl">${I18N.t('record.winner_hit')}</div><div class="val pgood">${d.total ? pctW + '%' : '—'}</div><div class="muted" style="font-size:11px">${d.winners}/${d.total}</div></div>
      <div class="bigstat"><div class="lbl">${I18N.t('record.exact_score')}</div><div class="val" style="color:var(--amber)">${d.exact}</div></div>
    </div>
    ${d.total ? `<div class="explain" style="border-left-color:var(--blue)">${I18N.t('perf.accuracy_caveat')}</div>` : ''}
    ${(d.total && d.vsMarket) ? marketScoreboardV2(d.vsMarket) : ''}
    <div class="formrow"><button class="cta-sm" onclick="sharePerf('legacy', ${d.total})">${I18N.t('perf.share_legacy')}</button></div>`;
  html += '<div class="rec-list">' + d.matches.map(m => {
    const th = teamOf(m.home), ta = teamOf(m.away);
    const pickLabel = m.predicted === 'home' ? I18N.t('record.pick_home', { team: th ? I18N.teamName(th.id, th.name) : m.home }) : m.predicted === 'away' ? I18N.t('record.pick_away', { team: ta ? I18N.teamName(ta.id, ta.name) : m.away }) : I18N.t('record.pick_draw');
    return `<div class="rec-row"><span class="rec-dot ${m.correct ? 'ok' : 'no'}"></span>
      <div class="rec-main"><div class="rec-score">${th ? th.flag : ''} ${m.home} <b>${m.hg} - ${m.ag}</b> ${m.away} ${ta ? ta.flag : ''}${m.exact ? ` <span class="exact-tag">${I18N.t('record.tag_exact')}</span>` : ''}</div>
      <div class="rec-pred">${I18N.t('record.model_pred', { pick: pickLabel, prob: pct(m.predictedProb) })}</div></div>
      <span class="rec-date">${new Date(m.datetime).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span></div>`;
  }).join('') + '</div>';
  return html;
}

// §6: marcador modelo-vs-mercado SIN afirmar alpha (cumple la política estadística)
function marketScoreboardV2(vm) {
  if (!vm || !vm.n) return `<div class="explain" style="border-left-color:var(--amber)">${I18N.t('perf.vs_market_accruing')}</div>`;
  const marketBeats = vm.marketBrier < vm.modelBrier;
  return `<div class="explain" style="border-left-color:var(--blue)">
    ${I18N.t('perf.vs_market_title', { n: vm.n, model: vm.modelBrier, market: vm.marketBrier, lower: I18N.t('perf.lower_is_better') })}
    ${marketBeats ? '<br><b>' + I18N.t('perf.market_beats_model') + '</b>' : ''}
    <span class="muted" style="display:block;font-size:11.5px;margin-top:5px">${I18N.t('perf.alpha_replacement')} ${I18N.t('perf.no_edge_yet')}</span></div>`;
}

// ---------- Sprint 8.1 §36: METODOLOGÍA (transparencia de definiciones, sin IP privada) ----------
async function renderMethodology() {
  let epoch = null;
  try { const r = await fetch('/api/metrics/methodology').then(x => x.ok ? x.json() : null); epoch = r && r.verified_epoch; } catch (e) { /* noop */ }
  const def = (t, d) => `<div class="meth-item"><div class="meth-t">${xe(t)}</div><div class="meth-d">${xe(d)}</div></div>`;
  const epochStr = epoch ? I18N.t('meth.verifiable_epoch', { date: new Date(epoch).toLocaleDateString() }) : '';
  $('#tab-methodology').innerHTML = `
    <div style="margin-bottom:12px"><h2 style="margin-bottom:3px">${xe(I18N.t('meth.title'))}</h2>
      <div class="muted" style="font-size:12px">${xe(I18N.t('meth.subtitle'))}</div></div>
    <div class="meth-sec"><h3>${xe(I18N.t('meth.sec_model'))}</h3>
      ${def(I18N.t('meth.gpi_t'), I18N.t('meth.gpi_d'))}
    </div>
    <div class="meth-sec"><h3>${xe(I18N.t('meth.sec_hierarchy'))}</h3>
      ${def(I18N.t('meth.value_signal_t'), I18N.t('meth.value_signal_d'))}
      ${def(I18N.t('meth.candidate_t'), I18N.t('meth.candidate_d'))}
      ${def(I18N.t('meth.pick_t'), I18N.t('meth.pick_d'))}
      ${def(I18N.t('meth.arb_t'), I18N.t('meth.arb_d'))}
    </div>
    <div class="meth-sec"><h3>${xe(I18N.t('meth.sec_metrics'))}</h3>
      ${def(I18N.t('meth.brier_t'), I18N.t('meth.brier_d'))}
      ${def(I18N.t('meth.logloss_t'), I18N.t('meth.logloss_d'))}
      ${def(I18N.t('meth.ece_t'), I18N.t('meth.ece_d'))}
      ${def(I18N.t('meth.clv_t'), I18N.t('meth.clv_d'))}
      ${def(I18N.t('meth.theoretical_t'), I18N.t('meth.theoretical_d'))}
    </div>
    <div class="meth-sec"><h3>${xe(I18N.t('meth.sec_track'))}</h3>
      ${def(I18N.t('meth.verifiable_t'), I18N.t('meth.verifiable_d', { epoch: epochStr }))}
      ${def(I18N.t('meth.legacy_t'), I18N.t('meth.legacy_d'))}
      ${def(I18N.t('meth.limits_t'), I18N.t('meth.limits_d'))}
    </div>
    <div class="xo-foot">${xe(I18N.t('meth.footer'))}</div>`;
}

function sharePerf(kind, n) {
  const verified = kind === 'verified';
  const txt = verified
    ? `📊 Rendimiento VERIFICABLE de GP Simulador · ${n} señales oficiales liquidadas desde el inicio del registro. Track record con timestamp e inputs congelados:`
    : `📊 Histórico (legacy, anterior al registro verificable) de GP Simulador · ${n} partidos evaluados. Se conserva por transparencia:`;
  shareOp(event, txt);
}

async function loadMe() {
  if (token()) {
    const r = await fetch('/api/me', { headers: hdrs() });
    if (r.ok) { USER = await r.json(); } else { localStorage.removeItem('wc_token'); USER = null; }
  }
  // ROUTER de la beta: misma cuenta/sesión; si el usuario tiene acceso (grant admin / 5 referidos verificados
  // / fusión global) → entra a la plataforma nueva (/x). El no-registrado y el registrado sin acceso siguen
  // exactamente igual en la plataforma actual (esta) + banner. No se migra nada (mismo token wc_token).
  if (USER && USER.beta_access && !/[?&]noredir=1/.test(location.search)) { location.replace('/x' + (location.search || '')); BETA_REDIRECT = true; return; }
  renderBetaBanner();
  renderHeader();
}
let BETA_REDIRECT = false;

// ---------- shell de navegación ----------
const ICON = {
  arb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l5-5 4 4 8-8"/><path d="M16 8h5v5"/></svg>',
  matches: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/></svg>',
  teams: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"/></svg>',
  groups: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
  following: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4 7.2 18.9l.9-5.4L4.2 9.7l5.4-.8z"/></svg>',
  bracket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5h6v14H4M14 9h6M14 5v8h6"/></svg>',
  record: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
  evo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7S11 2 8 2 5 5 7 7M12 7s1-5 4-5 3 3 1 5"/></svg>',
  sim: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M5 19l6-6M8 16l-4 4M5 21l-2-2"/></svg>',
  alerts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>',
  opex: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/></svg>',
  registry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  perf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><circle cx="9" cy="9" r="1.5"/><circle cx="14" cy="13" r="1.5"/><circle cx="19" cy="7" r="1.5"/></svg>',
  value: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  picks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v4H4zM4 12h10M4 17h7M16 13l2 2 4-4"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};
const TAB_KEYS = {
  arb: 'nav.opportunities', matches: 'nav.matches', teams: 'nav.teams', groups: 'nav.groups',
  following: 'nav.following', alerts: 'nav.alerts', bracket: 'nav.bracket', record: 'nav.record', evo: 'nav.evo', admin: 'nav.admin',
  sim: 'nav.sim', referidos: 'nav.referrals', opex: 'nav.executables', registry: 'nav.registry', perf: 'nav.performance', value: 'nav.value', picks: 'nav.picks_gp', methodology: 'nav.methodology',
};
const tabLabel = t => TAB_KEYS[t] ? I18N.t(TAB_KEYS[t]) : t;
const OUT_NAV = ['teams', 'groups', 'matches', 'bracket', 'arb'];
const IN_TOPNAV = ['arb', 'matches', 'teams', 'sim', 'groups', 'following', 'bracket', 'record', 'evo'];
const BOTTOM = ['arb', 'matches', 'teams', 'groups'];

// §16: toggle de idioma global (ES/EN) visible en el header para todas las superficies legacy.
function langToggleHtml() {
  const other = I18N.locale === 'en' ? 'es' : 'en';
  // Reutiliza .icon-btn (estilo existente) para no tocar el CSS; muestra el idioma activo y togglea al otro.
  return `<button class="icon-btn" style="font-weight:700;font-size:12px" aria-label="${I18N.t('lang.toggle_aria')}" onclick="setLang('${other}')">${I18N.locale.toUpperCase()}</button>`;
}

function renderHeader() {
  const inApp = !!USER;
  document.body.classList.toggle('logged-in', inApp);
  document.body.classList.toggle('has-bottomnav', inApp);
  // top nav (Sprint 4: "Ejecutables" solo aparece si la capa está activa para este usuario — flags off → no aparece)
  const execTab = inApp && USER.execUi ? ['opex'] : [];
  const regTab = inApp && USER.registryUi ? ['registry'] : [];
  const perfTab = inApp && USER.metricsUi ? ['perf'] : [];
  const valueTab = inApp && USER.valueUi ? ['value'] : [];
  const picksTab = inApp && USER.picksUi ? ['picks'] : [];
  const topItems = inApp ? IN_TOPNAV.concat(execTab).concat(regTab).concat(perfTab).concat(valueTab).concat(picksTab).concat(USER.isAdmin ? ['admin'] : []) : OUT_NAV;
  $('#topnav').innerHTML = topItems.map(t => `<button data-nav="${t}" onclick="switchTab('${t}')">${tabLabel(t)}</button>`).join('');
  // right side
  if (inApp) {
    const initials = (USER.email || '?').slice(0, 1).toUpperCase();
    $('#hdRight').innerHTML =
      `<span class="live-pill" id="livePill"><span class="lp-dot"></span>LIVE</span>
       ${langToggleHtml()}
       <button class="icon-btn" aria-label="${I18N.t('auth.alerts_aria')}" onclick="switchTab('alerts')">${ICON.alerts}</button>
       <button class="avatar-btn" aria-label="${I18N.t('auth.account_aria')}" onclick="toggleAvatarMenu(event)">${initials}</button>`;
  } else {
    $('#hdRight').innerHTML = `${langToggleHtml()}<button class="hd-login" onclick="openLogin()">${I18N.t('auth.login')}</button><button class="cta-sm" onclick="openLogin()">${I18N.t('auth.create_free')}</button>`;
  }
  // bottom nav
  if (inApp) {
    $('#bottomnav').innerHTML = BOTTOM.map(t =>
      `<button data-nav="${t}" onclick="switchTab('${t}')" aria-label="${tabLabel(t)}">${ICON[t]}<span>${tabLabel(t)}</span></button>`).join('')
      + `<button data-nav="more" onclick="openSheet()" aria-label="${I18N.t('nav.more')}">${ICON.more}<span>${I18N.t('nav.more')}</span></button>`;
    $('#bottomnav').style.display = ''; // dejar que el CSS (media query) controle la visibilidad
  } else {
    $('#bottomnav').style.display = 'none';
  }
  renderBetaBanner();
  syncNavActive();
}

// Banner de la beta (solo para usuarios REGISTRADOS sin acceso beta; el no-registrado no lo ve). Aparece en
// toda la plataforma actual, cerrable por sesión, y siempre re-accesible desde Referidos. Lleva a Referidos.
function renderBetaBanner() {
  const el = document.getElementById('beta-banner'); if (!el) return;
  let closed = false; try { closed = sessionStorage.getItem('beta_banner_closed') === '1'; } catch (e) {}
  if (!USER || USER.beta_access || closed) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const ent = USER.beta_entitlement || {};
  const have = ent.verified_referrals || 0, need = ent.referrals_required || 5;
  el.className = 'beta-banner';
  el.innerHTML = `<div class="bb-in">
    <span class="bb-ic">⚡</span>
    <div class="bb-tx"><b>${xe(I18N.t('beta_banner.title'))}</b><span>${xe(I18N.t('beta_banner.desc'))}</span></div>
    <span class="bb-prog" title="${xe(I18N.t('beta_banner.progress'))}">${have}/${need}</span>
    <button class="bb-cta" onclick="switchTab('referidos')">${xe(I18N.t('beta_banner.cta'))} →</button>
    <button class="bb-x" aria-label="${xe(I18N.t('common.close') || 'Cerrar')}" onclick="closeBetaBanner()">✕</button>
  </div>`;
  el.style.display = '';
}
function closeBetaBanner() { try { sessionStorage.setItem('beta_banner_closed', '1'); } catch (e) {} const el = document.getElementById('beta-banner'); if (el) { el.style.display = 'none'; } }

function currentTab() {
  const a = document.querySelector('.tab.active');
  return a ? a.id.replace('tab-', '') : 'teams';
}
function syncNavActive() {
  const cur = currentTab();
  document.querySelectorAll('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === cur || (b.dataset.nav === 'more' && !BOTTOM.includes(cur) && USER)));
}
function switchTab(name) {
  clearDetailTimer();
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  const sec = $('#tab-' + name); if (sec) sec.classList.add('active');
  if (STATE && !STATE.teaser) {
    if (name === 'evo') renderEvo();
    if (name === 'record') renderRecord();
    if (name === 'following') renderFollowing();
    if (name === 'alerts') renderAlerts();
    if (name === 'referidos') renderReferidos();
    if (name === 'sim') renderSim();
    if (name === 'methodology') renderMethodology();
  }
  // Oportunidades: con sesión, (re)carga si no está cargada o si quedó mostrando un candado
  // (auto-cura cualquier carrera del login que dejaba el candado del teaser). Sin sesión, no toca.
  if (name === 'arb' && USER && (!ARB || $('#tab-arb').querySelector('.lock'))) loadArb();
  if (name === 'opex' && USER) loadExecOpps();
  if (name === 'registry' && USER) loadRegistry();
  if (name === 'perf' && USER) loadPerf();
  if (name === 'value' && USER) loadValue();
  if (name === 'picks' && USER) loadPicks();
  syncNavActive(); closeAvatarMenu(); closeSheet();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function toggleAvatarMenu(e) {
  if (e) e.stopPropagation();
  const m = $('#avatarMenu');
  if (m.style.display !== 'none') return closeAvatarMenu();
  const plan = USER.isAdmin ? I18N.t('menu.plan_admin') : I18N.t('menu.plan_free');
  const item = (tab, icon, label) => `<button onclick="switchTab('${tab}')">${ICON[icon]}${label}</button>`;
  const navClean = USER.uiFlags && USER.uiFlags.navigationCleanup;
  // Sprint 8.1 §26: avatar reducido a Cuenta/Preferencias/Privacidad/Logout (sin duplicar todas las herramientas).
  const profItem = `<button onclick="openProfile()">${ICON.account}${I18N.t('profile.menu')}</button>`;
  const body = navClean
    ? `${profItem}
       ${item('alerts', 'alerts', I18N.t('menu.prefs_alerts'))}
       ${item('methodology', 'registry', I18N.t('menu.privacy_methodology'))}
       ${USER.isAdmin ? item('admin', 'admin', I18N.t('menu.admin')) : ''}
       <button class="danger" onclick="logout()">${ICON.logout}${I18N.t('menu.logout')}</button>`
    : `${profItem}
       ${item('sim', 'sim', I18N.t('menu.simulate_cross'))}
       ${item('referidos', 'gift', I18N.t('menu.invite_friends'))}
       ${item('following', 'account', I18N.t('menu.my_following'))}
       ${item('alerts', 'alerts', I18N.t('menu.alerts_notifications'))}
       ${item('record', 'record', I18N.t('menu.model_record'))}
       ${item('evo', 'evo', I18N.t('menu.evolution'))}
       ${USER.isAdmin ? item('admin', 'admin', I18N.t('menu.admin')) : ''}
       <button class="danger" onclick="logout()">${ICON.logout}${I18N.t('menu.logout')}</button>`;
  m.innerHTML = `
    <div class="avmenu-head">
      <div class="av">${(USER.email || '?').slice(0, 1).toUpperCase()}</div>
      <div><div class="em">${USER.email}</div><div class="plan">${plan}</div></div>
    </div>
    ${body}`;
  m.style.display = '';
  setTimeout(() => document.addEventListener('click', closeAvatarMenu, { once: true }), 0);
}
function closeAvatarMenu() { const m = $('#avatarMenu'); if (m) m.style.display = 'none'; }

function openSheet() {
  const navClean = USER && USER.uiFlags && USER.uiFlags.navigationCleanup;
  const cell = (tab, icon, label) => `<button onclick="switchTab('${tab}')">${ICON[icon]}<span>${label}</span></button>`;
  let html;
  if (navClean) {
    // Sprint 8.1 §26-28,§35-36: agrupado (Herramientas / Mi GP / Transparencia / Administración). Sin card "Salir"
    // (el logout vive en el avatar). Transparencia surface: Rendimiento, Registro, Metodología.
    const group = (title, cells) => `<div class="sheet-group"><div class="sheet-gt">${title}</div><div class="sheet-grid">${cells.join('')}</div></div>`;
    html = group(I18N.t('sheet.tools'), [cell('sim', 'sim', I18N.t('sheet.simulate')), cell('bracket', 'bracket', I18N.t('sheet.bracket')), cell('evo', 'evo', I18N.t('sheet.evolution'))])
      + group(I18N.t('sheet.my_gp'), [cell('following', 'following', I18N.t('sheet.following')), cell('alerts', 'alerts', I18N.t('sheet.alerts')), cell('referidos', 'gift', I18N.t('sheet.invite'))])
      + group(I18N.t('sheet.transparency'), [cell('record', 'perf', I18N.t('sheet.performance')), cell('registry', 'registry', I18N.t('sheet.registry')), cell('methodology', 'registry', I18N.t('sheet.methodology'))])
      + (USER && USER.isAdmin ? group(I18N.t('sheet.administration'), [cell('admin', 'admin', I18N.t('sheet.admin'))]) : '');
  } else {
    html = '<div class="sheet-grid">';
    html += `<button onclick="switchTab('sim')">${ICON.sim}<span>${I18N.t('sheet.simulate')}</span></button>`;
    html += `<button onclick="switchTab('following')">${ICON.following}<span>${I18N.t('sheet.following')}</span></button>`;
    html += `<button onclick="switchTab('alerts')">${ICON.alerts}<span>${I18N.t('sheet.alerts')}</span></button>`;
    html += `<button onclick="switchTab('bracket')">${ICON.bracket}<span>${I18N.t('sheet.bracket')}</span></button>`;
    html += `<button onclick="switchTab('record')">${ICON.record}<span>${I18N.t('nav.record')}</span></button>`;
    html += `<button onclick="switchTab('evo')">${ICON.evo}<span>${I18N.t('sheet.evolution')}</span></button>`;
    html += `<button onclick="switchTab('referidos')">${ICON.gift}<span>${I18N.t('sheet.invite')}</span></button>`;
    if (USER && USER.isAdmin) html += `<button onclick="switchTab('admin')">${ICON.admin}<span>${I18N.t('sheet.admin')}</span></button>`;
    html += `<button onclick="toggleAvatarMenu()">${ICON.account}<span>${I18N.t('sheet.account')}</span></button>`;
    html += `<button class="danger" onclick="logout()">${ICON.logout}<span>${I18N.t('sheet.exit')}</span></button>`;
    html += '</div>';
  }
  $('#sheetBody').innerHTML = html;
  $('#sheet').style.display = '';
}
function closeSheet() { const s = $('#sheet'); if (s) s.style.display = 'none'; }

function renderAll() {
  if (STATE.teaser) { renderTeaser(); return; }
  renderTeams(); renderFollowing(); renderAlerts(); renderGroups(); renderMatches(); renderBracket(); renderEvo(); renderAdmin(); renderRecord();
  // Fix pestañeo: el refresco en vivo (SSE/polling → loadState → renderAll) NO debe reconstruir Oportunidades
  // si el usuario está viendo un DETALLE (pick/partido) dentro de la pestaña — lo sacaría de vuelta al listado.
  if ($('#tab-arb').classList.contains('active') && !OPP_DETAIL) loadArb();
}

// ---------- SEGUIDOS (equipos seguidos + alertas) ----------
function nextMatchFor(teamId) {
  const now = Date.now();
  return (STATE.fixtures || [])
    .filter(f => (f.home === teamId || f.away === teamId) && (!f.result || f.result.status !== 'final'))
    .sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''))[0] || null;
}
function mutedTeams() { return (USER && USER.alertPrefs && USER.alertPrefs.mutedTeams) || []; }
function renderFollowing() {
  if (!USER) return; // en teaser ya está el candado
  const favs = USER.favorites || [];
  let html = `<div class="arb-head"><div><h2 style="margin-bottom:3px">${I18N.t('following.title')}</h2>
    <div class="muted" style="font-size:12px">${I18N.t(favs.length === 1 ? 'following.subtitle.one' : 'following.subtitle.other', { n: favs.length })}</div></div>
    <button class="cta-sm" onclick="switchTab('teams')">${I18N.t('following.add_team')}</button></div>`;
  if (!favs.length) {
    html += `<div class="lock"><div class="lock-icon">★</div>
      <div class="lock-title">${I18N.t('following.empty_title')}</div>
      <div class="lock-sub">${I18N.t('following.empty_sub')}</div>
      <button class="btn" onclick="switchTab('teams')">${I18N.t('following.explore')}</button></div>`;
    $('#tab-following').innerHTML = html;
    return;
  }
  const muted = mutedTeams();
  const teams = favs.map(id => STATE.teams.find(t => t.id === id)).filter(Boolean)
    .sort((a, b) => b.sim.champion - a.sim.champion);
  html += '<div class="follow-list">' + teams.map(t => {
    const nm = nextMatchFor(t.id);
    const m = (ARB && ARB.rows) ? ARB.rows.find(r => r.id === t.id) : null;
    const ch = m && m.polymarket ? m.polymarket.change24h : null;
    const navClean = USER.uiFlags && USER.uiFlags.navigationCleanup;
    const opp = nm ? teamOf(nm.home === t.id ? nm.away : nm.home) : null;
    const oppNm = opp ? I18N.teamName(opp.id, opp.name) : '—';
    const tNm = I18N.teamName(t.id, t.name);
    // §25: con el flag, meta a DOS líneas (sin truncar) con hora local del usuario; sin flag, una línea como hoy.
    let metaHtml;
    if (navClean) {
      metaHtml = nm
        ? `<div class="fc-meta fc-meta2" onclick="event.stopPropagation();openMatchPage('${nm.id}')" style="cursor:pointer"><span class="fc-next">${I18N.t('following.next_prefix', { opp: oppNm })}</span><span class="fc-when">${fmtKickoffLocal(nm)}</span></div>`
        : `<div class="fc-meta"><span class="muted">${I18N.t('following.no_next')}</span></div>`;
    } else {
      const meta = nm ? I18N.t('following.next_inline', { opp: oppNm, when: fmtKickoff(nm) }) : I18N.t('following.no_next');
      metaHtml = `<div class="fc-meta">${nm ? `<span onclick="event.stopPropagation();openMatchPage('${nm.id}')" style="cursor:pointer">${meta} →</span>` : meta}</div>`;
    }
    const isMuted = muted.includes(t.id);
    return `<div class="follow-card">
      <span class="fc-flag" style="cursor:pointer" onclick="openTeamPage('${t.id}')">${t.flag}</span>
      <div class="fc-main" style="cursor:pointer" onclick="openTeamPage('${t.id}')">
        <div class="fc-name">${tNm}</div>
        ${metaHtml}
      </div>
      <div class="fc-prob">
        <div class="fc-pc">${pct(t.sim.champion)}</div>
        <div class="fc-chg">${ch != null ? chgBadge(ch) : `<span class="muted" style="font-size:11px">${I18N.t('following.champion')}</span>`}</div>
      </div>
      <button class="fc-bell ${isMuted ? '' : 'on'}" onclick="toggleMute('${t.id}')" aria-label="${I18N.t(isMuted ? 'following.unmute_aria' : 'following.mute_aria', { team: tNm })}">${ICON.alerts}</button>
      <button class="fc-x" onclick="toggleFav('${t.id}')" aria-label="${I18N.t('following.unfollow_aria', { team: tNm })}">✕</button>
    </div>`;
  }).join('') + '</div>';
  html += `<div class="muted" style="font-size:12px;margin-top:14px;text-align:center">${I18N.t('following.config_note', { link: `<a onclick="switchTab('alerts')" style="color:var(--accent);cursor:pointer;font-weight:600">${I18N.t('following.config_link')}</a>` })}</div>`;
  $('#tab-following').innerHTML = html;
}

async function toggleMute(teamId) {
  const r = await fetch('/api/mute', { method: 'POST', headers: hdrs(), body: JSON.stringify({ teamId }) });
  if (r.ok) { USER.alertPrefs = USER.alertPrefs || {}; USER.alertPrefs.mutedTeams = (await r.json()).mutedTeams; renderFollowing(); }
}

// ---------- ALERTAS Y NOTIFICACIONES ----------
// §16: labels/descr vía claves i18n (alert.<k>.t / .d). El 5º elemento (default-on) se preserva.
const ALERT_EVENTS = [
  ['nextMatch', '📅'],
  ['matchStart', '▶'],
  ['goal', '⚽'],
  ['result', '🏁', true],
  ['qualify', '🏆'],
  ['probSwing', '📈'],
  ['valueOpp', '◎'],
  ['arb', '◆'],
];
const ALERT_CHANNELS = [
  ['email', '✉', false],
  ['telegram', '✈', true],
  ['push', '🔔', true],
];
function evOn(k) { const e = (USER.alertPrefs && USER.alertPrefs.events) || {}; return e[k] !== false; }
function chOn(k) { const c = (USER.alertPrefs && USER.alertPrefs.channels) || {}; return k === 'email' ? c.email !== false : c[k] === true; }
function renderAlerts() {
  if (!USER) return;
  let html = `<div style="margin-bottom:6px"><h2 style="margin-bottom:3px">${I18N.t('alerts.title')}</h2>
    <div class="muted" style="font-size:12px">${I18N.t('alerts.subtitle')}</div></div>`;
  html += `<div class="sec-head"><h3>${I18N.t('alerts.events')}</h3></div><div class="alert-group">` +
    ALERT_EVENTS.map(([k, ic]) => {
      const title = I18N.t('alert.' + k + '.t'), desc = I18N.t('alert.' + k + '.d');
      return `
      <div class="alert-row">
        <span class="alert-ic">${ic}</span>
        <div class="alert-txt"><div class="alert-t">${title}</div><div class="alert-d">${desc}</div></div>
        <button class="toggle ${evOn(k) ? 'on' : ''}" onclick="toggleEvent('${k}')" aria-label="${title}"><span class="knob"></span></button>
      </div>`;
    }).join('') + '</div>';
  html += `<div class="sec-head"><h3>${I18N.t('alerts.channels')}</h3></div>
    <div class="muted" style="font-size:12px;margin:-4px 0 12px">${I18N.t('alerts.channels_sub')}</div><div class="alert-group">` +
    ALERT_CHANNELS.map(([k, ic, soon]) => {
      const title = I18N.t('channel.' + k);
      return `
      <div class="alert-row ${soon ? 'soon' : ''}">
        <span class="alert-ic">${ic}</span>
        <div class="alert-txt"><div class="alert-t">${title} ${soon ? `<span class="soon-tag">${I18N.t('alerts.soon_tag')}</span>` : ''}</div><div class="alert-d">${k === 'email' ? USER.email : I18N.t('alerts.available_soon')}</div></div>
        <button class="toggle ${chOn(k) ? 'on' : ''}" ${soon ? 'disabled' : ''} onclick="toggleChannel('${k}')" aria-label="${title}"><span class="knob"></span></button>
      </div>`;
    }).join('') + '</div>';
  html += `<div class="muted" style="font-size:11.5px;margin-top:16px">${I18N.t('alerts.footer', { link: `<a onclick="switchTab('following')" style="color:var(--accent);cursor:pointer;font-weight:600">${I18N.t('alerts.footer_link')}</a>` })}</div>`;
  $('#tab-alerts').innerHTML = html;
}
async function toggleEvent(k) {
  const next = !evOn(k);
  const r = await fetch('/api/alertprefs', { method: 'POST', headers: hdrs(), body: JSON.stringify({ events: { [k]: next } }) });
  if (r.ok) { USER.alertPrefs = (await r.json()).alertPrefs; renderAlerts(); }
}
async function toggleChannel(k) {
  const next = !chOn(k);
  const r = await fetch('/api/alertprefs', { method: 'POST', headers: hdrs(), body: JSON.stringify({ channels: { [k]: next } }) });
  if (r.ok) { USER.alertPrefs = (await r.json()).alertPrefs; renderAlerts(); }
}

// ---------- EQUIPOS ----------
function renderTeams() {
  const favs = USER ? USER.favorites || [] : [];
  const teams = [...STATE.teams].sort((a, b) =>
    (favs.includes(b.id) - favs.includes(a.id)) || b.sim.champion - a.sim.champion);
  const max = Math.max(...teams.map(t => t.sim.champion));
  $('#tab-teams').innerHTML = `
    <h2>${I18N.t('teams.title', { n: STATE.sims.toLocaleString() })}</h2>
    <input id="teamSearch" class="searchbox" type="search" inputmode="search" placeholder="${I18N.t('teams.search_ph')}" oninput="filterTeams(this.value)" autocomplete="off">
    <div id="teamNoRes" class="muted" style="display:none;padding:10px 2px">${I18N.t('teams.no_results')}</div>
    <div class="simcard" onclick="switchTab('sim')"><span class="sc-ic">⚔️</span><div class="sc-tx"><div class="sc-t">${I18N.t('teams.sim_cross_t')}</div><div class="sc-s">${I18N.t('teams.sim_cross_s')}</div></div><span class="sc-go">→</span></div>
    <div class="teamgrid" id="teamGrid">` + teams.map(t => `
    <div class="tcard" data-name="${(t.name + ' ' + t.en + ' ' + (t.aliases || []).join(' ')).toLowerCase()}" onclick="openTeam('${t.id}')">
      <div class="trow">
        <span style="font-size:20px">${t.flag}</span>
        <span class="tname">${I18N.teamName(t.id, t.name)}</span>
        ${favs.includes(t.id) ? '<span class="fav">★</span>' : ''}
        <span class="telo">ELO ${t.currentElo}${t.eloDelta ? ` <span class="${t.eloDelta > 0 ? 'delta-up' : 'delta-down'}">${t.eloDelta > 0 ? '+' : ''}${t.eloDelta}</span>` : ''}<br>${I18N.t('teams.group_label')} ${t.group}${t.host ? ' · ' + I18N.t('teams.host') : ''}</span>
      </div>
      <div class="champ">${pct(t.sim.champion)}</div>
      <div class="bar"><div style="width:${(t.sim.champion / max * 100).toFixed(1)}%"></div></div>
      <div class="pcts">
        <span>${I18N.t('teams.final', { p: pct(t.sim.reachFinal) })}</span>
        <span>${I18N.t('teams.semis', { p: pct(t.sim.reachSF) })}</span>
        <span>${I18N.t('teams.out_groups', { p: `<span class="${t.sim.outInGroups > .5 ? 'pbad' : ''}">${pct(t.sim.outInGroups)}</span>` })}</span>
      </div>
    </div>`).join('') + '</div>';
}
function normSearch(s) { return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
function filterTeams(q) {
  const n = normSearch(q);
  let shown = 0;
  document.querySelectorAll('#teamGrid .tcard').forEach(c => {
    const ok = !n || normSearch(c.dataset.name).includes(n);
    c.style.display = ok ? '' : 'none'; if (ok) shown++;
  });
  const nr = $('#teamNoRes'); if (nr) nr.style.display = shown ? 'none' : '';
}

// ========================================================================
// Fase 4 — PÁGINAS PROFUNDAS DE PARTIDO Y EQUIPO
// La UI consume solo data normalizada de /api/match/:id y /api/teamdetail/:id.
// ========================================================================
let detailReturnTab = 'arb', CUR_MATCH = null, CUR_TEAM = null, teamTab = 'resumen', detailTimer = null;
function clearDetailTimer() { if (detailTimer) { clearInterval(detailTimer); detailTimer = null; } }

// --- helpers de UI compartidos (terminal direction; sin polish final) ---
function du(msg) { return `<div class="du">${msg}</div>`; } // DataUnavailable elegante
function pctD(p, d = 0) { return (p == null || isNaN(p)) ? '—' : (p * 100).toFixed(d) + '%'; }
function gpGradeCls(label) {
  return ({ STRONG: 'g-strong', LEAN: 'g-lean', SLIGHT: 'g-slight', WATCH: 'g-slight', PASS: 'g-pass', PURE_ARB: 'g-arb' })[label] || 'g-pass';
}
function gpLabelTxt(label) { return label === 'PURE_ARB' ? 'PURE ARB' : label; }
function formLetter(r) { const k = 'formletter.' + r; const v = I18N.t(k); return v === k ? r : v; } // V/E/D (es) · W/D/L (en)
function formChips(results) {
  if (!results || !results.length) return '<span class="muted">—</span>';
  return results.map(r => `<span class="fchip f-${(r || '').toLowerCase()}">${formLetter(r)}</span>`).join('');
}
// Cancha visual de alineación (probable o confirmada). Devuelve null si no hay XI suficiente → cae a lista.
function posBucket(p) {
  const s = (p || '').toUpperCase();
  if (/^G|GK|POR/.test(s)) return 'GK';
  if (/^D|DEF|LB|RB|CB/.test(s)) return 'DEF';
  if (/^M|MID|MED|DM|AM/.test(s)) return 'MID';
  if (/^F|FW|DEL|ATT|ST|LW|RW|CF/.test(s)) return 'FWD';
  return 'MID';
}
function shortName(n) { if (!n) return ''; const p = n.trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : n; }
function pitchHtml(l) {
  const xi = (l && l.startXI) || [];
  if (xi.length < 7) return null;
  const b = { GK: [], DEF: [], MID: [], FWD: [] };
  xi.forEach(p => b[posBucket(p.position)].push(p));
  const rows = [b.FWD, b.MID, b.DEF, b.GK].filter(a => a.length);
  if (rows.length < 2) return null;
  const row = arr => `<div class="pitch-row">${arr.map(p => `<div class="pp"><span class="pp-num">${p.number != null ? p.number : '·'}</span><span class="pp-name">${shortName(p.name)}</span></div>`).join('')}</div>`;
  return `<div class="pitch">${rows.map(row).join('')}</div>`;
}
function pStatusBadge(st) {
  const m = { available: ['ok', 'pstatus.available'], injured: ['bad', 'pstatus.injured'], suspended: ['bad', 'pstatus.suspended'], doubt: ['warn', 'pstatus.doubt'], unknown: ['', null] };
  const [cls, key] = m[st] || m.unknown;
  return `<span class="pstatus ${cls}">${key ? I18N.t(key) : '—'}</span>`;
}
function injuryBadge(st) {
  const m = { injured: ['bad', 'pstatus.injured_x'], suspended: ['bad', 'pstatus.suspended_x'], doubt: ['warn', 'pstatus.doubt_q'], available: ['ok', 'pstatus.available'], unknown: ['', null] };
  const [cls, key] = m[st] || m.unknown;
  return `<span class="pstatus ${cls}">${key ? I18N.t(key) : '—'}</span>`;
}
function dShort(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleDateString([], { day: 'numeric', month: 'short' }); }
function dLong(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function detailHead(title) { return `<div class="dh"><button class="backbtn" onclick="backFromDetail()">←</button><span class="dh-t">${title}</span></div>`; }
function openDetailTab(name) {
  clearDetailTimer();
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  const sec = $('#tab-' + name); if (sec) sec.classList.add('active');
  syncNavActive(); closeAvatarMenu(); closeSheet();
  window.scrollTo({ top: 0, behavior: 'auto' });
  try { history.pushState({ detail: name }, '', '#' + name); } catch { }
}
function backFromDetail() { switchTab(detailReturnTab || (USER ? 'arb' : 'teams')); }
window.addEventListener('popstate', () => {
  const c = currentTab();
  if (c === 'match' || c === 'team') {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    const sec = $('#tab-' + (detailReturnTab || 'arb')); if (sec) sec.classList.add('active');
    syncNavActive();
  }
});

// =================== PÁGINA DE PARTIDO ===================
async function openMatchPage(id) {
  if (!USER) { openLogin(); return; }
  const c = currentTab(); if (c !== 'match' && c !== 'team') detailReturnTab = c;
  openDetailTab('match');
  $('#tab-match').innerHTML = detailHead(I18N.t('mpage.title')) + `<div class="muted" style="padding:34px 0;text-align:center">${I18N.t('mpage.loading')}</div>`;
  try {
    const r = await fetch('/api/match/' + encodeURIComponent(id), { headers: hdrs() });
    if (!r.ok) { if (r.status === 401) { openLogin(); return; } throw 0; }
    CUR_MATCH = await r.json();
    renderMatchDetail(CUR_MATCH);
    // partido en vivo → auto-refresco de marcador/eventos/stats cada 25s
    if (CUR_MATCH.status === 'live') detailTimer = setInterval(() => refreshMatch(CUR_MATCH.id), 25000);
  } catch { $('#tab-match').innerHTML = detailHead(I18N.t('mpage.title')) + du(I18N.t('mpage.load_failed')); }
}
async function refreshMatch(id) {
  if (currentTab() !== 'match' || !CUR_MATCH || CUR_MATCH.id !== id) { clearDetailTimer(); return; }
  try {
    const r = await fetch('/api/match/' + encodeURIComponent(id), { headers: hdrs() });
    if (!r.ok) return;
    CUR_MATCH = await r.json();
    const y = window.scrollY;
    renderMatchDetail(CUR_MATCH);
    window.scrollTo(0, y);
    if (CUR_MATCH.status !== 'live') clearDetailTimer(); // partido terminó → dejar de pollear
  } catch { /* reintenta en el próximo tick */ }
}

function renderMatchDetail(d) {
  const th = d.homeTeam, ta = d.awayTeam, mp = d.modelProbabilities, sc = d.score;
  const followsHome = th.id && (USER.favorites || []).includes(th.id);
  const followsAway = ta.id && (USER.favorites || []).includes(ta.id);
  const thNm = th.id ? I18N.teamName(th.id, th.name) : th.name, taNm = ta.id ? I18N.teamName(ta.id, ta.name) : ta.name;
  const statusChip = d.status === 'live'
    ? `<span class="livepill on">${I18N.t('mpage.live')}${d.minute ? " " + d.minute + "'" : ''}</span>`
    : d.status === 'final' ? `<span class="dchip">${I18N.t('mpage.final')}</span>`
      : `<span class="dchip">${dLong(d.date)}</span>`;
  const center = (d.status === 'live' || d.status === 'final') && sc ? `<div class="mh-score">${sc.home} <span>-</span> ${sc.away}</div>` : `<div class="mh-vs">${I18N.t('mpage.vs')}</div>`;

  // Hero
  let html = detailHead((d.stageLabel ? d.stageLabel : I18N.t('mpage.title')) + (d.group ? ' · ' + I18N.t('mpage.group_prefix', { g: d.group }) : ''));
  html += `<div class="mh">
    <div class="mh-side" onclick="${th.id ? `openTeamPage('${th.id}')` : ''}">
      <span class="mh-flag">${th.flag}</span><span class="mh-name">${thNm}</span></div>
    <div class="mh-mid">${statusChip}${center}</div>
    <div class="mh-side right" onclick="${ta.id ? `openTeamPage('${ta.id}')` : ''}">
      <span class="mh-flag">${ta.flag}</span><span class="mh-name">${taNm}</span></div>
  </div>`;
  if (mp) {
    html += `<div class="mh-probs">
      <div class="mhp"><span class="mhp-l">${I18N.t('mpage.model')}</span><span class="mhp-v blue">${pctD(mp.homeWin, 1)} · ${pctD(mp.draw, 1)} · ${pctD(mp.awayWin, 1)}</span></div>`;
    const pm = (d.marketPrices || []);
    const ph = pm.find(x => x.side === 'home'), pd = pm.find(x => x.side === 'draw'), pa = pm.find(x => x.side === 'away');
    if (ph || pa) html += `<div class="mhp"><span class="mhp-l">${I18N.t('mpage.market')}</span><span class="mhp-v">${ph ? cents(ph.price) : '—'} · ${pd ? cents(pd.price) : '—'} · ${pa ? cents(pa.price) : '—'}</span></div>`;
    html += `<div class="mhp"><span class="mhp-l">${I18N.t('mpage.xg_projected')}</span><span class="mhp-v">${mp.xgHome != null ? mp.xgHome.toFixed(2) : '—'} – ${mp.xgAway != null ? mp.xgAway.toFixed(2) : '—'} · ${I18N.t('mpage.likely_score_suffix', { score: mp.likelyScore || '—' })}</span></div>`;
    html += `</div>`;
  } else html += du(I18N.t('mpage.no_model'));
  // Fase Q.1.1 §2: bloque GP Intelligence V2 oficial por partido (detrás de GP_MATCHES_V2_UI_ENABLED + beta).
  // El modelo base de arriba queda claramente separado. Sin V2 válido → estado EXPLÍCITO, sin presentarlo como
  // actualizado ni hacer fallback silencioso.
  if (USER && USER.beta && USER.beta.matchesV2 && d.v2_requested) {
    html += `<div class="sec-head" style="margin-top:16px"><h3>${xe(I18N.t('mpage.gp_intelligence'))}</h3></div>`;
    if (d.v2 && d.v2.has_official_v2) html += oppMatchV2Html(d.v2, { hero: false });
    else html += `<div class="op-state op-info" role="status"><div class="op-state-ic">○</div><div class="op-state-tx"><div class="op-state-t">${xe(I18N.t('mpage.v2_unavailable'))}</div><div class="op-state-b">${xe(I18N.t('mpage.v2_unavailable_why'))}</div></div></div>`;
  }
  if (followsHome || followsAway) html += `<div class="follownote">${I18N.t('mpage.follow_note', { teams: `${followsHome ? thNm : ''}${followsHome && followsAway ? I18N.t('mpage.follow_and') : ''}${followsAway ? taNm : ''}` })}</div>`;

  // GP Take
  html += matchGpTakeHtml(d.gpTake);
  // Market Angles
  html += marketAnglesHtml(d.marketAngles);
  // Live events / stats
  html += liveEventsHtml(d);
  // Lineups
  html += lineupsHtml(d);
  // Recent form
  html += matchFormHtml(d.recentForm, th, ta);
  // Markets
  html += matchMarketsHtml(d, mp);
  // News / injuries
  html += matchNewsHtml(d);

  html += `<div class="disc">${I18N.t('mpage.disclaimer')}</div>`;
  html += providerStatusHtml(d.providerStatus);
  $('#tab-match').innerHTML = html;
}

function panel(title, sub, body) {
  return `<div class="dpanel"><div class="dpanel-h"><span class="dpanel-t">${title}</span>${sub ? `<span class="dpanel-s">${sub}</span>` : ''}</div>${body}</div>`;
}

function matchGpTakeHtml(g) {
  if (!g) return panel(I18N.t('mpage.gp_take'), '', du(I18N.t('mpage.gp_take_empty')));
  return panel(I18N.t('mpage.gp_take'), '',
    `<div class="gptbox">
      <div class="gpt-top"><span class="grade ${gpGradeCls(g.label)}">${gpLabelTxt(g.label)}</span>
        <span class="gpt-conf">${I18N.t('mpage.confidence', { v: g.confidence })}</span>${g.risk ? `<span class="gpt-risk">${I18N.t('mpage.risk', { v: g.risk })}</span>` : ''}</div>
      <div class="gpt-title">${g.title}</div>
      <div class="gpt-sum">${g.summary}</div>
      ${(g.drivers || []).length ? `<ul class="gpt-drivers">${g.drivers.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
    </div>`);
}

function marketAnglesHtml(angles) {
  if (!angles || !angles.length) return panel(I18N.t('mpage.market_angles'), '', du(I18N.t('mpage.no_angles')));
  const rows = angles.map(a => `
    <div class="angle">
      <div class="angle-top"><span class="grade sm ${gpGradeCls(a.grade)}">${gpLabelTxt(a.grade)}</span><span class="angle-mkt">${a.market}</span>
        ${a.edge ? `<span class="angle-edge">+${pctD(a.edge, 1)}</span>` : ''}</div>
      <div class="angle-pick">${a.pick}</div>
      <div class="angle-line">${I18N.t('mpage.angle_model')} <b class="blue">${pctD(a.modelProb, 0)}</b>${a.marketPrice != null ? ` · ${I18N.t('mpage.angle_market')} <b>${cents(a.marketPrice)}</b>` : ''}${a.venue ? ` · ${a.venue}` : ''}</div>
      <div class="angle-note">${a.note}</div>
    </div>`).join('');
  return panel(I18N.t('mpage.market_angles'), angles.length + '', rows);
}

function liveEventsHtml(d) {
  if (d.status === 'scheduled') return panel(I18N.t('mpage.events'), '', du(I18N.t('mpage.events_scheduled')));
  let body = '';
  const ev = d.events || [];
  if (ev.length) {
    const icon = t => t === 'goal' ? '⚽' : t === 'yellow' ? '🟨' : t === 'red' ? '🟥' : t === 'subst' ? '↔' : t === 'var' ? 'VAR' : '•';
    body += '<div class="timeline">' + ev.sort((a, b) => (a.minute || 0) - (b.minute || 0)).map(e => `
      <div class="tl-row ${e.side || ''}">
        <span class="tl-min">${e.minute != null ? e.minute + "'" : ''}</span>
        <span class="tl-ic">${icon(e.type)}</span>
        <span class="tl-txt">${e.player || ''}${e.assist ? ` <span class="muted">(${I18N.t('mpage.assist', { player: e.assist })})</span>` : ''}${e.detail && e.type === 'other' ? ' ' + e.detail : ''}</span>
      </div>`).join('') + '</div>';
  } else body += du(I18N.t('mpage.no_events'));
  // stats
  const st = d.statistics;
  if (st && (st.home || st.away)) {
    const keys = ['possession', 'shots', 'shotsOnTarget', 'corners', 'fouls', 'offsides', 'yellowCards', 'redCards', 'xg'];
    const rows = keys.filter(k => (st.home && st.home[k] != null) || (st.away && st.away[k] != null)).map(k =>
      `<div class="stat-row"><span class="st-h">${st.home && st.home[k] != null ? st.home[k] : '—'}</span><span class="st-l">${I18N.t('stat.' + k)}</span><span class="st-a">${st.away && st.away[k] != null ? st.away[k] : '—'}</span></div>`).join('');
    if (rows) body += `<div class="stats-head"><span>${d.homeTeam.flag}</span><span class="muted">${I18N.t('mpage.statistics')}</span><span>${d.awayTeam.flag}</span></div>` + rows;
  } else if (d.status === 'live') body += du(I18N.t('mpage.stats_soon'));
  return panel(I18N.t('mpage.events_stats'), d.status === 'live' ? I18N.t('mpage.live').replace('● ', '') : I18N.t('mpage.final'), body);
}

function lineupTeamHtml(side, l, team) {
  const tNm = team.id ? I18N.teamName(team.id, team.name) : team.name;
  if (!l) return `<div class="lu-col"><div class="lu-team">${team.flag} ${tNm}</div>${du(I18N.t('mpage.lineups_note_short'))}</div>`;
  const tag = l.confirmed ? `<span class="lu-tag ok">${I18N.t('mpage.confirmed')}</span>` : `<span class="lu-tag">${I18N.t('mpage.probable')}</span>`;
  const pitch = pitchHtml(l);
  const players = (l.startXI || []).map(p => `<div class="lu-p"><span class="lu-n">${p.number != null ? p.number : '·'}</span><span class="lu-name">${p.name}</span><span class="lu-pos">${p.position || ''}</span></div>`).join('');
  return `<div class="lu-col">
    <div class="lu-team">${team.flag} ${tNm} ${tag}</div>
    <div class="lu-form">${l.formation ? I18N.t('mpage.formation', { f: l.formation }) : ''}${l.coach ? ' · ' + I18N.t('mpage.coach', { coach: l.coach }) : ''}</div>
    ${pitch || players || du(I18N.t('mpage.xi_pending'))}
  </div>`;
}
function lineupsHtml(d) {
  const lu = d.lineups || {};
  if (!lu.home && !lu.away) return panel(I18N.t('mpage.lineups'), '', du(I18N.t('mpage.lineups_note')));
  return panel(I18N.t('mpage.lineups'), '', `<div class="lu-grid">${lineupTeamHtml('home', lu.home, d.homeTeam)}${lineupTeamHtml('away', lu.away, d.awayTeam)}</div>`);
}

function formMiniHtml(f, team) {
  const tNm = team.id ? I18N.teamName(team.id, team.name) : team.name;
  if (!f) return `<div class="form-col"><div class="form-team">${team.flag} ${tNm}</div>${du(I18N.t('mpage.form_pending'))}</div>`;
  return `<div class="form-col">
    <div class="form-team">${team.flag} ${tNm}</div>
    <div class="form-chips">${formChips(f.results)}</div>
    <div class="form-stats">
      <span>${I18N.t('form.gf')} <b>${f.goalsFor}</b></span><span>${I18N.t('form.gc')} <b>${f.goalsAgainst}</b></span>
      <span>${I18N.t('form.clean_sheets')} <b>${f.cleanSheets}</b></span><span>${I18N.t('form.streak')} <b>${f.streak || '—'}</b></span>
    </div></div>`;
}
function matchFormHtml(rf, th, ta) {
  rf = rf || {};
  if (!rf.home && !rf.away) return panel(I18N.t('mpage.form'), '', du(I18N.t('mpage.form_pending')));
  return panel(I18N.t('mpage.form'), I18N.t('mpage.form_last5'), `<div class="form-grid">${formMiniHtml(rf.home, th)}${formMiniHtml(rf.away, ta)}</div>`);
}

function matchMarketsHtml(d, mp) {
  let body = '';
  if (mp) body += `<div class="mk-row"><span class="mk-l blue">${I18N.t('mpage.model_1x2')}</span><span class="mk-v">${pctD(mp.homeWin, 1)} · ${pctD(mp.draw, 1)} · ${pctD(mp.awayWin, 1)}</span></div>`;
  const pm = d.marketPrices || [];
  if (pm.length) {
    pm.forEach(o => { body += `<div class="mk-row"><span class="mk-l">${venueChip(o.venue)} ${o.side}</span><span class="mk-v">${cents(o.price)}${o.url ? ` <a class="mlink" href="${o.url}" target="_blank" rel="noopener">↗</a>` : ''}</span></div>`; });
  } else body += du(I18N.t('mpage.no_market'));
  if (d.odds && d.odds.length) {
    const o = d.odds[0];
    body += `<div class="mk-row"><span class="mk-l">${I18N.t('mpage.odds_book', { book: o.book })}</span><span class="mk-v">${o.home || '—'} · ${o.draw || '—'} · ${o.away || '—'}</span></div>`;
  }
  if (d.eventUrl) body += `<div class="formrow" style="margin-top:10px"><a class="venue-btn v-poly" href="${d.eventUrl}" target="_blank" rel="noopener">${I18N.t('mpage.open_polymarket')}</a></div>`;
  return panel(I18N.t('mpage.model_market_odds'), '', body);
}

function matchNewsHtml(d) {
  const inj = d.injuries || [], news = d.news || [];
  if (!inj.length && !news.length) return panel(I18N.t('mpage.news_injuries'), '', du(I18N.t('mpage.no_news_injuries')));
  let body = '';
  if (inj.length) body += '<div class="inj-list">' + inj.map(i => `<div class="inj-row">${injuryBadge(i.status)}<span class="inj-p">${i.player}</span><span class="muted">${i.team || ''} ${i.reason ? '· ' + i.reason : ''}</span></div>`).join('') + '</div>';
  if (news.length) body += '<div class="news-list">' + news.map(n => `<a class="news-row" ${n.url ? `href="${n.url}" target="_blank" rel="noopener"` : ''}><div class="news-t">${n.title}</div><div class="news-m muted">${n.source}${n.published ? ' · ' + dShort(n.published) : ''}</div></a>`).join('') + '</div>';
  return panel(I18N.t('mpage.news_injuries'), '', body);
}

function providerStatusHtml(ps) {
  if (!ps) return '';
  const parts = [];
  parts.push(ps.usedApiFootball ? I18N.t('mpage.api_football_ok') : (ps.apiFootball === 'sin key' ? I18N.t('mpage.api_football_nokey') : I18N.t('mpage.api_football_none')));
  if (ps.usedEspnFallback) parts.push(I18N.t('mpage.espn_fallback'));
  if (ps.usedManualFallback) parts.push(I18N.t('mpage.manual'));
  return `<div class="provstat">${I18N.t('mpage.sources', { parts: parts.join(' · '), time: dLong(ps.lastUpdated) })}</div>`;
}

// =================== PÁGINA DE EQUIPO ===================
async function openTeamPage(id) {
  if (!USER) { openLogin(); return; }
  const c = currentTab(); if (c !== 'match' && c !== 'team') detailReturnTab = c;
  teamTab = 'resumen';
  openDetailTab('team');
  $('#tab-team').innerHTML = detailHead(I18N.t('tpage.title')) + `<div class="muted" style="padding:34px 0;text-align:center">${I18N.t('tpage.loading')}</div>`;
  try {
    const r = await fetch('/api/teamdetail/' + id, { headers: hdrs() });
    if (!r.ok) { if (r.status === 401) { openLogin(); return; } throw 0; }
    CUR_TEAM = await r.json();
    renderTeamDetail(CUR_TEAM);
  } catch { $('#tab-team').innerHTML = detailHead(I18N.t('tpage.title')) + du(I18N.t('tpage.load_failed')); }
}
// compat: tarjetas existentes (Equipos, Grupos, Evolución, tablas) siguen llamando openTeam()
function openTeam(id) { return openTeamPage(id); }

function renderTeamDetail(d) {
  const followed = (USER.favorites || []).includes(d.id);
  const deltaTxt = d.eloDelta ? ` <span class="${d.eloDelta > 0 ? 'delta-up' : 'delta-down'}">${d.eloDelta > 0 ? '+' : ''}${d.eloDelta}</span>` : '';
  const nm = d.nextMatch;
  const dNm = d.id ? I18N.teamName(d.id, d.name) : d.name;
  let hero = detailHead(I18N.t('tpage.title'));
  hero += `<div class="th">
    <span class="th-flag">${d.flag}</span>
    <div class="th-main">
      <div class="th-name">${dNm}</div>
      <div class="th-meta">${I18N.t('tpage.meta', { group: d.group, elo: d.elo + deltaTxt, rank: d.rank })}${d.host ? ' · ' + I18N.t('tpage.host') : ''}</div>
      <div class="th-champ">${pctD(d.championProbability, 1)} <span>${I18N.t('tpage.champion')}</span></div>
    </div>
    <button class="${followed ? 'btn-ghost on' : 'btn'}" onclick="toggleFavFromTeam('${d.id}')">${followed ? I18N.t('tpage.following') : I18N.t('tpage.follow')}</button>
  </div>`;
  if (nm) { const oppNm = nm.opponent.id ? I18N.teamName(nm.opponent.id, nm.opponent.name) : nm.opponent.name; hero += `<div class="th-next" onclick="openMatchPage('${nm.id}')">${I18N.t(nm.home ? 'tpage.next_vs' : 'tpage.next_at', { opp: nm.opponent.flag + ' ' + oppNm, when: dLong(nm.datetime) })}</div>`; }

  const tabs = ['resumen', 'plantilla', 'forma', 'resultados', 'mercados', 'noticias'];
  const tabbar = `<div class="dtabs" id="teamTabs">${tabs.map(k => `<button class="dtab ${k === teamTab ? 'on' : ''}" data-t="${k}" onclick="switchTeamTab('${k}')">${I18N.t('tpage.tab_' + k)}</button>`).join('')}</div>`;
  $('#tab-team').innerHTML = hero + tabbar + '<div id="teamPanel"></div>';
  switchTeamTab(teamTab);
}
function switchTeamTab(name) {
  teamTab = name;
  document.querySelectorAll('#teamTabs .dtab').forEach(b => b.classList.toggle('on', b.dataset.t === name));
  $('#teamPanel').innerHTML = teamPanelHtml(CUR_TEAM, name);
}
async function toggleFavFromTeam(id) {
  await toggleFav(id);
  if (CUR_TEAM && CUR_TEAM.id === id) renderTeamDetail(CUR_TEAM);
}

function teamPanelHtml(d, tab) {
  if (!d) return du(I18N.t('tpage.no_data'));
  if (tab === 'resumen') return teamResumenHtml(d);
  if (tab === 'plantilla') return teamSquadHtml(d);
  if (tab === 'forma') return teamFormHtml(d);
  if (tab === 'resultados') return teamResultsHtml(d);
  if (tab === 'mercados') return teamMarketsHtml(d);
  if (tab === 'noticias') return teamNewsHtml(d);
  return '';
}

function teamResumenHtml(d) {
  const probs = [['championProbability', 'tprob.champion'], ['finalProbability', 'tprob.final'], ['semifinalsProbability', 'tprob.semis'], ['quarterfinalsProbability', 'tprob.quarters'], ['advanceProbability', 'tprob.advance'], ['groupWinProbability', 'tprob.group_win'], ['outInGroupsProbability', 'tprob.out_groups']];
  let body = '<div class="prob-grid">' + probs.map(([k, lk]) =>
    `<div class="prob-cell"><div class="prob-l">${I18N.t(lk)}</div><div class="prob-v ${k === 'outInGroupsProbability' && d[k] > .3 ? 'pbad' : ''}">${pctD(d[k], 1)}</div></div>`).join('') + '</div>';
  body += `<div class="modelread"><div class="mr-h">${I18N.t('tpage.model_read')}</div><div class="mr-b">${d.modelRead}</div>`;
  if (d.keyDrivers && d.keyDrivers.length) body += `<ul class="mr-drivers">${d.keyDrivers.map(x => `<li>${x}</li>`).join('')}</ul>`;
  body += `</div>`;
  if (d.likelyOpponents && d.likelyOpponents.length) {
    body += `<div class="dsub">${I18N.t('tpage.likely_opps')}</div><div class="opp-list">` +
      d.likelyOpponents.map(o => `<button class="opp" onclick="openTeamPage('${o.id}')">${o.flag} ${o.id ? I18N.teamName(o.id, o.name) : o.name} <span class="muted">${pctD(o.pct, 0)}</span></button>`).join('') + '</div>';
  }
  let out = panel(I18N.t('tpage.model_summary'), I18N.t('tpage.tournaments', { n: (d.sims || 0).toLocaleString() }), body);
  // caminos simulados (conserva la riqueza del modal anterior)
  if (d.samples && d.samples.length) {
    const runs = d.samples.slice(0, 6).map((run, i) => `<div class="simrun">#${i + 1} ${run.map(m => {
      const o = teamOf(m.vs);
      return `<span title="${stageLabel(m.stage)}">${o ? o.flag : ''} ${m.score}${m.pen ? ' (pen)' : ''}</span>`;
    }).join(' · ')}</div>`).join('');
    out += panel(I18N.t('tpage.title_paths'), d.counts ? I18N.t('tpage.titles_count', { n: d.counts.champion }) : '', runs);
  }
  if (d.explanation) out += panel(I18N.t('tpage.full_read'), '', `<div class="explain">${d.explanation}</div>`);
  return out;
}

function teamSquadHtml(d) {
  let body = '';
  if (d.keyPlayers && d.keyPlayers.length) {
    body += `<div class="dsub">${I18N.t('tpage.key_players')}</div><div class="sq-list">` + d.keyPlayers.map(playerRow).join('') + '</div>';
  }
  if (d.squad && d.squad.length) {
    body += `<div class="dsub">${I18N.t('tpage.squad')}</div><div class="sq-list">` + d.squad.map(playerRow).join('') + '</div>';
  } else if (!d.keyPlayers || !d.keyPlayers.length) {
    body += du(I18N.t('tpage.squad_pending'));
  } else {
    body += du(I18N.t('tpage.squad_full_pending'));
  }
  let out = panel(I18N.t('tpage.squad'), d.squad && d.squad.length ? I18N.t('tpage.players_count', { n: d.squad.length }) : '', body);
  if (d.projectedLineup) out += projectedLineupHtml(d.projectedLineup, d);
  return out;
}
function playerRow(p) {
  return `<div class="sq-p"><span class="sq-n">${p.number != null ? p.number : '·'}</span>
    <span class="sq-name">${p.name}</span>
    <span class="sq-pos">${p.position || ''}${p.club ? ' · ' + p.club : ''}${p.age ? ' · ' + I18N.t('tpage.age_suffix', { age: p.age }) : ''}</span>
    ${p.status && p.status !== 'available' ? pStatusBadge(p.status) : ''}
    ${p.note ? `<span class="sq-note muted">${p.note}</span>` : ''}</div>`;
}
function projectedLineupHtml(l, d) {
  const tag = l.confirmed ? `<span class="lu-tag ok">${I18N.t('mpage.confirmed')}</span>` : `<span class="lu-tag">${I18N.t('mpage.probable')}</span>`;
  const pitch = pitchHtml(l);
  const players = (l.startXI || []).map(p => `<div class="lu-p"><span class="lu-n">${p.number != null ? p.number : '·'}</span><span class="lu-name">${p.name}</span><span class="lu-pos">${p.position || ''}</span></div>`).join('');
  const body = `<div class="lu-form">${tag}${l.formation ? ' · ' + I18N.t('mpage.formation', { f: l.formation }) : ''}${l.coach ? ' · ' + I18N.t('mpage.coach', { coach: l.coach }) : ''}</div>${pitch || players || du(I18N.t('tpage.xi_probable_pending'))}`;
  return panel(I18N.t('tpage.projected_lineup'), l.formation || '', body);
}

function teamFormHtml(d) {
  const f = d.recentForm;
  if (!f) return panel(I18N.t('mpage.form'), '', du(I18N.t('mpage.form_pending')));
  let body = `<div class="form-chips big">${formChips(f.results)}</div>
    <div class="form-stats wide">
      <span>${I18N.t('form.pts')} <b>${f.points}</b></span><span>${I18N.t('form.played')} <b>${f.played}</b></span>
      <span>${I18N.t('form.gf')} <b>${f.goalsFor}</b></span><span>${I18N.t('form.gc')} <b>${f.goalsAgainst}</b></span>
      <span>${I18N.t('form.clean_sheets')} <b>${f.cleanSheets}</b></span>
      <span>${I18N.t('form.avg_for')} <b>${f.avgFor}</b></span><span>${I18N.t('form.avg_against')} <b>${f.avgAgainst}</b></span>
    </div>`;
  if (f.last && f.last.length) body += `<div class="dsub">${I18N.t('tpage.last_matches')}</div>` + f.last.map(m =>
    `<div class="res-row"><span class="fchip f-${(m.result || '').toLowerCase()}">${formLetter(m.result)}</span><span class="res-opp">${m.home ? I18N.t('matches.vs') : '@'} ${m.opponent || '—'}</span><span class="res-sc">${m.score}</span><span class="muted">${dShort(m.date)}</span></div>`).join('');
  return panel(I18N.t('mpage.form'), '', body);
}

function teamResultsHtml(d) {
  let body = '';
  if (d.nextMatch) { const oppNm = d.nextMatch.opponent.id ? I18N.teamName(d.nextMatch.opponent.id, d.nextMatch.opponent.name) : d.nextMatch.opponent.name; body += `<div class="dsub">${I18N.t('tpage.next_match')}</div><div class="res-row clk" onclick="openMatchPage('${d.nextMatch.id}')"><span class="res-opp">${d.nextMatch.home ? I18N.t('matches.vs') : '@'} ${d.nextMatch.opponent.flag} ${oppNm}</span><span class="muted">${dLong(d.nextMatch.datetime)} →</span></div>`; }
  const res = d.results || [];
  if (res.length) {
    body += `<div class="dsub">${I18N.t('tpage.in_world_cup')}</div>` + res.map(r => {
      const clk = /^G|^[0-9]/.test(r.id) ? `onclick="openMatchPage('${r.id}')"` : '';
      const oppNm = r.opponent ? (r.opponent.flag + ' ' + (r.opponent.id ? I18N.teamName(r.opponent.id, r.opponent.name) : r.opponent.name)) : '—';
      return `<div class="res-row clk" ${clk}><span class="fchip f-${(r.result || '').toLowerCase()}">${formLetter(r.result)}</span><span class="res-opp">${oppNm}</span><span class="res-sc">${r.score || ''}</span><span class="muted">${r.stageLabel || ''}</span></div>`;
    }).join('');
  } else if (!d.nextMatch) body += du(I18N.t('tpage.no_matches_played'));
  return panel(I18N.t('tpage.results'), '', body);
}

function teamMarketsHtml(d) {
  const mp = d.marketPrices || [];
  if (!mp.length) return panel(I18N.t('tpage.markets'), '', du(I18N.t('tpage.no_market')));
  let body = `<div class="mk-row"><span class="mk-l blue">${I18N.t('tpage.model_champion')}</span><span class="mk-v">${pctD(d.championProbability, 1)}</span></div>`;
  mp.forEach(o => {
    const extra = o.venue === 'Polymarket' ? I18N.t('legacy.liq', { v: fmtUsd(o.liquidity) }) : I18N.t('legacy.oi', { v: fmtUsd(o.openInterest) });
    body += `<a class="mk-card" ${o.url ? `href="${o.url}" target="_blank" rel="noopener"` : ''}>
      <div class="mkc-top">${venueChip(o.venue)}${chgBadge(o.change24h)}<span class="ext">↗</span></div>
      <div class="mkc-grid"><div><div class="mkt-lbl">${I18N.t('tpage.price')}</div><div class="mkt-big">${cents(o.price)}</div></div>
        <div><div class="mkt-lbl">${I18N.t('tpage.model')}</div><div class="mkt-big model">${pctD(d.championProbability, 1)}</div></div>
        <div><div class="mkt-lbl">${I18N.t('tpage.edge')}</div><div class="mkt-big edge">${o.edge > 0 ? '+' + pctD(o.edge, 1) : pctD(o.edge, 1)}</div></div></div>
      <div class="mkc-foot muted">${I18N.t('legacy.vol', { v: fmtUsd(o.volume) })} · ${extra}</div></a>`;
  });
  return panel(I18N.t('tpage.team_markets'), '', body);
}

function teamNewsHtml(d) {
  const inj = d.injuries || [], side = d.sidelined || [], news = d.news || [];
  if (!inj.length && !side.length && !news.length) return panel(I18N.t('tpage.news_injuries'), '', du(I18N.t('tpage.no_news')));
  let body = '';
  if (inj.length || side.length) body += `<div class="dsub">${I18N.t('tpage.injuries_outs')}</div><div class="inj-list">` +
    inj.concat(side).map(i => `<div class="inj-row">${injuryBadge(i.status)}<span class="inj-p">${i.player}</span><span class="muted">${i.reason || ''}</span></div>`).join('') + '</div>';
  if (news.length) body += `<div class="dsub">${I18N.t('tpage.news')}</div><div class="news-list">` +
    news.map(n => `<a class="news-row" ${n.url ? `href="${n.url}" target="_blank" rel="noopener"` : ''}><div class="news-t">${n.title}</div><div class="news-m muted">${n.source}${n.published ? ' · ' + dShort(n.published) : ''}</div></a>`).join('') + '</div>';
  return panel(I18N.t('tpage.news_injuries'), '', body);
}

async function toggleFav(id) {
  if (!USER) { openLogin(); return; }
  const r = await fetch('/api/favorite', { method: 'POST', headers: hdrs(), body: JSON.stringify({ teamId: id }) });
  if (r.ok) {
    const j = await r.json();
    USER.favorites = j.favorites;
    if (j.alerts !== undefined) USER.alerts = j.alerts;
    if ($('#modal').style.display === 'flex') closeModal();
    renderTeams(); renderFollowing();
  }
}

// ---------- GRUPOS ----------
let groupSel = 'A';
function heat(p, hue) {
  const a = Math.min(0.42, p * 0.52);
  const c = hue === 'g' ? `24,230,163` : hue === 'a' ? `246,200,95` : `255,107,107`;
  return `background:rgba(${c},${a.toFixed(3)})`;
}
function selectGroup(g) { groupSel = g; renderGroups(); }
function renderGroups() {
  const g = groupSel;
  const chips = STATE.groups.map(x => `<button class="gchip ${x === g ? 'on' : ''}" onclick="selectGroup('${x}')">${x}</button>`).join('');
  const rows = STATE.standings[g].map((r, i) => {
    const t = teamOf(r.id), s = t.sim;
    const third = Math.max(0, s.reachR32 - s.groupWin - s.groupSecond);
    return `<tr onclick="openTeam('${t.id}')">
      <td class="gpos">${i + 1}</td>
      <td class="teamcell">${t.flag} ${I18N.teamName(t.id, t.name)}</td>
      <td>${r.pj}</td><td><b>${r.pts}</b></td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td>
      <td style="${heat(s.groupWin, 'g')}">${pct(s.groupWin, 0)}</td>
      <td style="${heat(s.groupSecond, 'g')}">${pct(s.groupSecond, 0)}</td>
      <td style="${heat(third, 'a')}">${pct(third, 0)}</td>
      <td style="${heat(s.outInGroups, 'r')}">${pct(s.outInGroups, 0)}</td>
    </tr>`;
  }).join('');
  $('#tab-groups').innerHTML = `
    <div style="margin-bottom:6px"><h2 style="margin-bottom:3px">${I18N.t('groups.title')}</h2>
      <div class="muted" style="font-size:12px">${I18N.t('groups.subtitle')}</div></div>
    <div class="gchips">${chips}</div>
    <div class="grp-wrap">
      <table class="grp-tbl">
        <tr><th></th><th>${I18N.t('groups.col_team')}</th><th>${I18N.t('groups.col_pj')}</th><th>${I18N.t('groups.col_pts')}</th><th>${I18N.t('groups.col_dg')}</th><th>${I18N.t('groups.col_first')}</th><th>${I18N.t('groups.col_second')}</th><th>${I18N.t('groups.col_third')}</th><th>${I18N.t('groups.col_out')}</th></tr>
        ${rows}
      </table>
    </div>
    <div class="grp-legend"><span><i class="lg g"></i>${I18N.t('groups.legend_qualify')}</span><span><i class="lg a"></i>${I18N.t('groups.legend_third')}</span><span><i class="lg r"></i>${I18N.t('groups.legend_out')}</span></div>`;
}

// ---------- PARTIDOS ----------
function fmtKickoff(f) {
  if (!f.datetime) return f.date;
  return new Date(f.datetime).toLocaleString([], {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
// §25: fecha+hora en zona horaria del usuario (la del navegador), formato largo para la 2ª línea de Seguidos.
function fmtKickoffLocal(f) {
  if (!f.datetime) return f.date || '—';
  const d = new Date(f.datetime);
  const day = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${day.charAt(0).toUpperCase() + day.slice(1)}, ${time}`;
}

function matchCard(f, homeId, awayId, matchId) {
  const r = f.result;
  const score = r ? `${r.hg} - ${r.ag}` : I18N.t('matches.vs');
  const pens = r && r.pensHome != null && r.hg === r.ag && r.status === 'final'
    ? `<div class="muted" style="font-size:9px">${I18N.t(r.pensHome ? 'matches.pens_home' : 'matches.pens_away')}</div>` : '';
  const status = r ? (r.status === 'live' ? `<div class="live">${I18N.t('matches.live', { min: r.minute + "'" })}</div>` : `<div class="muted" style="font-size:9px">${I18N.t('matches.final')}</div>`)
    : `<div class="muted" style="font-size:9px">${fmtKickoff(f)}</div>`;
  const probs = f.probs;
  return `<div class="mcard${matchId ? ' clk' : ''}"${matchId ? ` onclick="openMatchPage('${matchId}')"` : ''}>
    <div class="side">${tlabel(homeId)}</div>
    <div class="score">${score}${pens}${status}</div>
    <div class="side away">${tlabel(awayId)}</div>
    ${probs && !(r && r.status === 'final') ? `<div class="pbar">
      <div class="ph" style="width:${probs.home * 100}%"></div>
      <div class="pd" style="width:${probs.draw * 100}%"></div>
      <div class="pa" style="width:${probs.away * 100}%"></div></div>
    <div class="plabels"><span>${I18N.t('matches.prob_home', { p: pct(probs.home) })}</span><span>${I18N.t('matches.prob_draw', { p: pct(probs.draw) })}</span><span>${I18N.t('matches.prob_away', { p: pct(probs.away) })}</span></div>
    <div class="plabels"><span>xG ${probs.xgHome.toFixed(2)}</span><span class="muted">${I18N.t('matches.likely_score', { score: probs.likelyScore })}</span><span>xG ${probs.xgAway.toFixed(2)}</span></div>` : ''}
  </div>`;
}

function renderMatches() {
  const sync = STATE.sync || {};
  let html = `<h2>${I18N.t('matches.title')}</h2>
    <div class="muted" style="margin-bottom:14px;font-size:11px">
      ${sync.ok ? '🟢' : '🟡'} ${I18N.t('matches.sync_note')}
      ${sync.ts ? I18N.t('matches.last_sync', { time: new Date(sync.ts).toLocaleTimeString() }) : ''}
      ${I18N.t('matches.local_tz')}
    </div>`;

  // --- pin de EN VIVO + PRÓXIMOS arriba (evita scrollear entre los partidos viejos) ---
  const now = Date.now();
  const all = [];
  STATE.fixtures.forEach(f => all.push({ f, home: f.home, away: f.away, id: f.id, dt: f.datetime, status: (f.result && f.result.status) || 'scheduled' }));
  STATE.knockout.forEach(k => {
    const h = (k.result && k.result.home) || k.resolved.home, a = (k.result && k.result.away) || k.resolved.away;
    if (h && a) all.push({ f: k, home: h, away: a, id: String(k.m), dt: k.datetime || k.date + 'T18:00Z', status: (k.result && k.result.status) || 'scheduled' });
  });
  const live = all.filter(x => x.status === 'live').sort((a, b) => (a.dt || '').localeCompare(b.dt || ''));
  const upcoming = all.filter(x => x.status !== 'final' && x.status !== 'live' && new Date(x.dt).getTime() > now - 3 * 3600000)
    .sort((a, b) => (a.dt || '').localeCompare(b.dt || '')).slice(0, 5);
  const pinned = [...live, ...upcoming];
  if (pinned.length) {
    html += `<div class="mday" style="color:var(--accent)">${live.length ? I18N.t('matches.live_and_next') : I18N.t('matches.upcoming')}</div>`;
    html += pinned.map(x => matchCard(x.f, x.home, x.away, x.id)).join('');
    html += `<div class="mday" style="margin-top:30px">${I18N.t('matches.full_calendar')}</div>`;
  }

  for (let md = 1; md <= 3; md++) {
    html += `<div class="mday">${I18N.t('matches.matchday', { n: md })}</div>`;
    html += STATE.fixtures.filter(f => f.matchday === md)
      .sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''))
      .map(f => matchCard(f, f.home, f.away, f.id)).join('');
  }
  const stages = ['R32', 'R16', 'QF', 'SF', '3RD', 'FINAL'];
  for (const st of stages) {
    const ms = STATE.knockout.filter(k => k.stage === st);
    html += `<div class="mday">${I18N.t('stage.' + st)}</div>`;
    html += ms.sort((a, b) => (a.datetime || a.date).localeCompare(b.datetime || b.date)).map(k => {
      const h = (k.result && k.result.home) || k.resolved.home;
      const a = (k.result && k.result.away) || k.resolved.away;
      if (h && a) return matchCard(k, h, a, String(k.m));
      return `<div class="mcard clk" onclick="openMatchPage('${k.m}')"><div class="side muted">${slotDesc(k.home)}</div>
        <div class="score"><span class="muted" style="font-size:11px">P${k.m}</span><div class="muted" style="font-size:9px">${fmtKickoff(k)}</div></div>
        <div class="side away muted">${slotDesc(k.away)}</div></div>`;
    }).join('');
  }
  $('#tab-matches').innerHTML = html;
}

// ---------- BRACKET ----------
function slotDesc(side) {
  if (side.t === 'W') return I18N.t('slot.group_first', { g: side.g });
  if (side.t === 'R') return I18N.t('slot.group_second', { g: side.g });
  if (side.t === 'T3') return I18N.t('slot.third', { groups: side.allowed.join('/') });
  if (side.t === 'M') return I18N.t('slot.winner', { m: side.m });
  if (side.t === 'L') return I18N.t('slot.loser', { m: side.m });
}
function renderBracket() {
  const rounds = ['R32', 'R16', 'QF', 'SF', '3RD', 'FINAL'];
  $('#tab-bracket').innerHTML = `<div style="margin-bottom:14px"><h2 style="margin-bottom:3px">${I18N.t('bracket.title')}</h2>
    <div class="muted" style="font-size:12px">${I18N.t('bracket.subtitle')}</div></div>
    <div class="bracket">` +
    rounds.map(st => `<div class="bround ${st === 'FINAL' ? 'fin' : ''}"><h4>${I18N.t('bracket.' + st)}</h4>` +
      STATE.knockout.filter(k => k.stage === st).map(k => {
        const r = k.result;
        const hId = (r && r.home) || k.resolved.home, aId = (r && r.away) || k.resolved.away;
        const h = hId ? tlabel(hId) : slotDesc(k.home);
        const a = aId ? tlabel(aId) : slotDesc(k.away);
        let hw = '', aw = '';
        if (r && r.status === 'final') {
          const homeWon = r.hg > r.ag || (r.hg === r.ag && r.pensHome);
          hw = homeWon ? 'winner' : ''; aw = homeWon ? '' : 'winner';
        }
        return `<div class="bmatch clk" onclick="openMatchPage('${k.m}')"><div class="num">P${k.m} · ${k.date}</div>
          <div class="${hw}">${h} ${r ? r.hg : ''}</div>
          <div class="${aw}">${a} ${r ? r.ag : ''}</div></div>`;
      }).join('') + '</div>').join('') + '</div>';
}

// ---------- ARBITRAJE ----------
// ---- GP Take: análisis graduado modelo vs mercado (estilo analista) ----
function gradeEdge(e) {
  if (e >= 0.10) return { g: 'STRONG', cls: 'g-strong' };
  if (e >= 0.06) return { g: 'LEAN', cls: 'g-lean' };
  if (e >= 0.035) return { g: 'SLIGHT', cls: 'g-slight' };
  return null;
}
// Construye el "GP Take" de un partido a partir de modelo vs precio de mercado
function buildMatchTake(m) {
  const MIN_BACK = 0.30; // solo respaldamos resultados con probabilidad real ≥30% (nunca longshots)
  const th = teamOf(m.home), ta = teamOf(m.away);
  const labelOf = s => s === 'home' ? I18N.teamName(th.id, th.name) : s === 'away' ? I18N.teamName(ta.id, ta.name) : I18N.t('take.the_draw');
  const top = ['home', 'draw', 'away'].reduce((a, b) => m.model[a] >= m.model[b] ? a : b); // pick del modelo
  const cands = [];
  let rejected = false;
  for (const side of ['home', 'draw', 'away']) {
    const o = m.outcomes[side]; if (!o) continue;
    const p = m.model[side];
    // COMPRAR SÍ: respaldar lo infravalorado (prob. real ≥30%)
    if (o.ask > 0.001 && p - o.ask > 0) {
      if (p >= MIN_BACK) cands.push({ side, dir: 'back', edge: p - o.ask, price: o.ask, p });
      else rejected = true;
    }
    // COMPRAR NO: ir contra lo sobrevalorado, pero NUNCA contra el favorito del modelo
    if (o.bid > 0.001 && o.bid - p > 0) {
      if (1 - p >= MIN_BACK && side !== top) cands.push({ side, dir: 'fade', edge: o.bid - p, price: o.bid, p });
      else rejected = true;
    }
  }
  cands.sort((a, b) => b.edge - a.edge);
  const best = cands[0];
  const grade = best && gradeEdge(best.edge);
  if (!grade) {
    return { grade: 'PASS', cls: 'g-pass',
      reason: rejected ? I18N.t('take.pass_rejected') : I18N.t('take.pass_aligned') };
  }
  const lbl = labelOf(best.side);
  let reason;
  if (best.dir === 'back') {
    const ctx = best.side === 'draw'
      ? I18N.t('take.back_draw_ctx')
      : I18N.t('take.back_team_ctx', { team: lbl });
    reason = I18N.t('take.back_reason', { team: lbl, price: cents(best.price), prob: pct(best.p), ctx });
  } else {
    reason = I18N.t('take.fade_reason', { team: lbl, price: cents(best.price), prob: pct(best.p) });
  }
  return { grade: grade.g, cls: grade.cls, side: best.side, dir: best.dir, edge: best.edge, reason };
}

// ---- formato de números de mercado ----
function fmtUsd(n) {
  if (!n) return '—';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n.toFixed(0);
}
function cents(p) { return (p * 100).toFixed(1) + '¢'; }
function chgBadge(c) {
  if (c == null || Math.abs(c) < 0.0005) return '<span class="chg flat">—</span>';
  const up = c > 0;
  return `<span class="chg ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${(Math.abs(c) * 100).toFixed(1)}%</span>`;
}
function venueChip(v) {
  return v === 'Polymarket'
    ? `<span class="vchip v-poly">${I18N.t('venue.poly')}</span>`
    : `<span class="vchip v-kalshi">${I18N.t('venue.kalshi')}</span>`;
}

// etiquetas de liquidez / riesgo / confianza para las tarjetas premium (i18n)
function liqLabel(usd) { return I18N.t(usd >= 2e6 ? 'liq.high' : usd >= 4e5 ? 'liq.medium' : 'liq.low'); }
function riskLabel(p) { return I18N.t(p >= 0.55 ? 'risklevel.low' : p >= 0.38 ? 'risklevel.medium' : 'risklevel.high'); }
function confLabel(edge) { return I18N.t(edge >= 0.10 ? 'label.high' : edge >= 0.05 ? 'label.medium' : 'label.low'); }
function riskClsP(p) { return p >= 0.55 ? 'r-low' : p >= 0.38 ? 'r-mid' : 'r-high'; }

async function loadArb(force = false) {
  // Fase Q.1 §4-9: Oportunidades flagship (Picks GP | Value | Arbitraje) cableado a DTOs V2. Detrás de los
  // flags §21 (GP_OPPORTUNITIES_*) + acceso beta. Con todo off → la home legacy de los ~509 usuarios intacta.
  if (USER && USER.beta && USER.beta.opportunities && USER.beta.opportunities.enabled) return loadOpportunities(force);
  $('#tab-arb').innerHTML = `<div class="muted" style="padding:40px 0;text-align:center">${I18N.t('legacy.loading_markets')}</div>`;
  const r = await fetch('/api/arbitrage' + (force ? '?force=1' : ''), { headers: hdrs() });
  if (!r.ok) {
    $('#tab-arb').innerHTML = `<div class="lock"><div class="lock-icon">🔒</div>
      <div class="lock-title">${I18N.t('legacy.unlock_title')}</div>
      <div class="lock-sub">${I18N.t('legacy.unlock_sub')}</div>
      <button class="btn" onclick="openLogin()">${I18N.t('auth.create_free')}</button></div>`;
    return;
  }
  ARB = await r.json();
  const pure = [], value = [];
  ARB.rows.forEach(row => row.edges.forEach(e => {
    (e.type === 'arbitraje' ? pure : value).push({ ...e, team: row.id, model: row.model, row });
  }));
  pure.sort((a, b) => b.edge - a.edge);
  value.sort((a, b) => b.edge - a.edge);
  const M = ARB.matches || [];

  let html = `
    <div class="arb-head">
      <div>
        <h2 style="margin-bottom:3px">${I18N.t('legacy.opportunities')}</h2>
        <div class="muted" style="font-size:12px">
          <span class="livepill on">${I18N.t('legacy.live')}</span> ${I18N.t('legacy.live_model_market', { time: ARB.ts ? new Date(ARB.ts).toLocaleTimeString() : '—' })}
        </div>
      </div>
      <button class="ghost" onclick="loadArb(true)">${I18N.t('legacy.refresh')}</button>
    </div>
    ${ARB.errors.length ? `<div class="warn">${ARB.errors.join(' · ')}</div>` : ''}`;

  // ---- 1. MEJOR OPORTUNIDAD (destacada) ----
  const best = value[0] || pure[0];
  if (best) {
    if (best.type !== 'arbitraje') {
      const v = best.venue === 'Polymarket' ? best.row.polymarket : best.row.kalshi;
      const t = teamOf(best.team);
      const backedP = best.side.includes('SÍ') ? best.model : 1 - best.model;
      const liq = liqLabel(v ? v.volume : 0), risk = riskLabel(backedP), conf = confLabel(best.edge);
      const tNm = t ? I18N.teamName(t.id, t.name) : best.team;
      html += `<div class="sec-head"><h3>${I18N.t('legacy.best_opp')}</h3></div>
      <div class="feat">
        <div class="feat-top">
          <span class="sig sig-edge">${I18N.t('legacy.model_edge')}</span>${venueChip(best.venue)}
          <span class="feat-edge">+${pct(best.edge)}</span>
        </div>
        <div class="feat-team"><span style="font-size:30px">${t ? t.flag : ''}</span>
          <div><div class="feat-name">${tNm}</div><div class="feat-side">${I18N.t('legacy.champion_side', { side: best.side })}</div></div>
        </div>
        <div class="feat-metrics">
          <div class="metric"><div class="m-l">${I18N.t('legacy.price')}</div><div class="m-v">${cents(best.price)}</div></div>
          <div class="metric"><div class="m-l">${I18N.t('legacy.model')}</div><div class="m-v blue">${pct(best.model)}</div></div>
          <div class="metric"><div class="m-l">${I18N.t('legacy.edge')}</div><div class="m-v green">+${pct(best.edge)}</div></div>
          <div class="metric"><div class="m-l">Kelly/4</div><div class="m-v">${best.kelly ? pct(best.kelly) : '—'}</div></div>
          <div class="metric"><div class="m-l">${I18N.t('legacy.liquidity')}</div><div class="m-v">${liq}</div></div>
          <div class="metric"><div class="m-l">${I18N.t('legacy.risk')}</div><div class="m-v ${riskClsP(backedP)}">${risk}</div></div>
          <div class="metric"><div class="m-l">${I18N.t('legacy.confidence')}</div><div class="m-v">${conf}</div></div>
        </div>
        <div class="feat-cta">
          ${v ? `<a class="venue-btn v-${best.venue === 'Polymarket' ? 'poly' : 'kalshi'}" href="${v.url}" target="_blank" rel="noopener">${I18N.t('legacy.open_market', { venue: best.venue })}</a>` : ''}
          <button class="btn-ghost" onclick="openTeam('${best.team}')">${I18N.t('legacy.view_analysis')}</button>
        </div>
      </div>`;
    } else {
      const pm = best.row.polymarket, ks = best.row.kalshi, t = teamOf(best.team);
      html += `<div class="sec-head"><h3>${I18N.t('legacy.best_opp')}</h3></div>
      <div class="feat feat-arb">
        <div class="feat-top"><span class="sig sig-arb">${I18N.t('legacy.pure_arb')}</span><span class="feat-edge amber">+${I18N.t('legacy.net_suffix', { edge: pct(best.edge) })}</span></div>
        <div class="feat-team"><span style="font-size:30px">${t ? t.flag : ''}</span>
          <div><div class="feat-name">${t ? I18N.teamName(t.id, t.name) : best.team}</div><div class="feat-side">${best.note}</div></div>
        </div>
        <div class="feat-cta">
          ${pm ? `<a class="venue-btn v-poly" href="${pm.url}" target="_blank" rel="noopener">Polymarket · ${cents(pm.ask)} ↗</a>` : ''}
          ${ks ? `<a class="venue-btn v-kalshi" href="${ks.url}" target="_blank" rel="noopener">Kalshi · ${cents(ks.ask)} ↗</a>` : ''}
        </div>
      </div>`;
    }
  }

  // ---- 2. ARBITRAJE PURO ----
  if (pure.length) {
    html += `<div class="sec-head"><h3><span class="dot-amber">◆</span> ${I18N.t('legacy.pure_arb_title')}</h3><span class="sub">${I18N.t(pure.length > 1 ? 'legacy.detected.other' : 'legacy.detected.one', { n: pure.length })}</span></div>
    <div class="muted" style="font-size:12px;margin:-4px 0 12px">${I18N.t('legacy.pure_arb_note')}</div>
    <div class="arbops">` + pure.slice(0, 6).map(o => {
      const pm = o.row.polymarket, ks = o.row.kalshi;
      return `<div class="dualcard">
        <div class="dual-top">
          <span style="font-size:22px">${teamOf(o.team) ? teamOf(o.team).flag : ''}</span>
          <b style="font-size:16px">${teamOf(o.team) ? I18N.teamName(o.team, teamOf(o.team).name) : o.team}</b>
          <span class="purebadge">${I18N.t('legacy.pure_arb')}</span>
          <span class="edge-big">+${pct(o.edge)}</span>
        </div>
        <div class="note" style="margin:6px 0 12px">${o.note}</div>
        <div class="dual-btns">
          ${pm ? `<a class="venue-btn v-poly" href="${pm.url}" target="_blank" rel="noopener">Polymarket · ${cents(pm.ask)} ↗</a>` : ''}
          ${ks ? `<a class="venue-btn v-kalshi" href="${ks.url}" target="_blank" rel="noopener">Kalshi · ${cents(ks.ask)} ↗</a>` : ''}
        </div>
      </div>`;
    }).join('') + '</div>';
  }

  // ---- 3. APUESTAS DE VALOR ----
  html += `<div class="sec-head"><h3><span class="dot-green">●</span> ${I18N.t('legacy.value_bets_title')}</h3><span class="sub">${value.length}</span></div>
    <div class="muted" style="font-size:12px;margin:-4px 0 12px">${I18N.t('legacy.value_bets_note')}</div>`;
  if (!value.length) html += `<div class="muted" style="margin-bottom:8px">${I18N.t('legacy.no_discrepancies')}</div>`;
  html += '<div class="mktgrid">' + value.slice(0, 9).map(o => {
    const v = o.venue === 'Polymarket' ? o.row.polymarket : o.row.kalshi;
    if (!v) return '';
    const t = teamOf(o.team);
    const tNm = t ? I18N.teamName(t.id, t.name) : o.team;
    const shareV = I18N.t('legacy.share_value', { team: tNm, price: cents(v.price), model: pct(o.model), edge: pct(o.edge) }).replace(/'/g, '');
    return `<a class="mktcard" href="${v.url}" target="_blank" rel="noopener">
      <div class="mkt-top">${venueChip(o.venue)}${chgBadge(v.change24h)}<span class="ext">↗</span></div>
      <div class="mkt-team"><span style="font-size:24px">${t ? t.flag : ''}</span><b>${tNm}</b><span class="sidetag">${o.side}</span></div>
      <div class="mkt-prices">
        <div><div class="mkt-lbl">${I18N.t('legacy.price')}</div><div class="mkt-big">${cents(v.price)}</div></div>
        <div><div class="mkt-lbl">${I18N.t('legacy.model')}</div><div class="mkt-big model">${pct(o.model)}</div></div>
        <div><div class="mkt-lbl">${I18N.t('legacy.edge')}</div><div class="mkt-big edge">+${pct(o.edge)}</div></div>
      </div>
      <div class="mkt-stats">
        <span>${I18N.t('legacy.vol', { v: fmtUsd(v.volume) })}</span>
        <span>${o.venue === 'Polymarket' ? I18N.t('legacy.liq', { v: fmtUsd(v.liquidity) }) : I18N.t('legacy.oi', { v: fmtUsd(v.openInterest) })}</span>
        ${o.kelly ? `<span class="kelly">Kelly/4 ${pct(o.kelly)}</span>` : ''}
        <button class="sharebtn" onclick="shareOp(event, '${shareV}')">📤</button>
      </div>
    </a>`;
  }).join('') + '</div>';

  // ---- 4. PARTIDOS · GP TAKE ----
  if (M.length) {
    html += `<div class="sec-head"><h3><span style="color:var(--blue)">⚽</span> ${I18N.t('legacy.matches_gp_take')}</h3><span class="sub">${I18N.t('legacy.with_market', { n: M.length })}</span></div>
    <div class="muted" style="font-size:12px;margin:-4px 0 12px">${I18N.t('legacy.gp_take_note')}</div>
    <div class="mktgrid">` + M.map(m => {
      const th = teamOf(m.home), ta = teamOf(m.away);
      const thNm = I18N.teamName(th.id, th.name), taNm = I18N.teamName(ta.id, ta.name);
      const take = buildMatchTake(m);
      const edgeOf = side => (m.edges.find(e => e.side === side) || {});
      const row = (side, label, flag) => {
        const o = m.outcomes[side]; if (!o) return '';
        const e = edgeOf(side);
        const p = m.model[side];
        return `<a class="oc-row ${e.edge ? 'oc-edge' : ''}" href="${o.url}" target="_blank" rel="noopener">
          <span class="oc-label">${flag || ''} ${label}</span>
          <span class="oc-mkt">${cents(o.price)}</span>
          <span class="oc-model">${pct(p)}</span>
          <span class="oc-badge">${e.edge ? '+' + pct(e.edge) + ' ' + (e.type === 'COMPRAR NO' ? 'NO' : 'SÍ') : ''}</span>
        </a>`;
      };
      const shareTxt = I18N.t('legacy.share_match', {
        home: thNm, away: taNm,
        ph: cents(m.outcomes.home.price), pd: m.outcomes.draw ? cents(m.outcomes.draw.price) : '—', pa: cents(m.outcomes.away.price),
        mh: pct(m.model.home), md: pct(m.model.draw), ma: pct(m.model.away),
      });
      return `<div class="mktcard matchmkt">
        <div class="mkt-top">
          ${venueChip('Polymarket')}
          ${m.live ? `<span class="livepill">${I18N.t('legacy.live')}${m.result ? ' ' + m.result.hg + '-' + m.result.ag : ''}</span>` : `<span class="muted" style="font-size:11px;font-weight:600">${fmtKickoff(m)}</span>`}
          <button class="sharebtn" onclick="shareOp(event, '${shareTxt.replace(/'/g, '')}')">📤</button>
        </div>
        <div class="mkt-team" style="margin-bottom:10px"><span style="font-size:20px">${th.flag}</span><b>${thNm} ${I18N.t('matches.vs')} ${taNm}</b><span style="font-size:20px">${ta.flag}</span></div>
        <div class="gptake">
          <div class="gptake-head"><span class="grade ${take.cls}">${take.grade}</span><span class="gptake-title">${I18N.t('legacy.gp_take')}</span>${take.edge ? `<span class="gptake-edge">+${pct(take.edge)}</span>` : ''}</div>
          <div class="gptake-reason">${take.reason}</div>
        </div>
        <div class="oc-head"><span></span><span>${I18N.t('legacy.market')}</span><span>${I18N.t('legacy.model')}</span><span>${I18N.t('legacy.edge')}</span></div>
        ${row('home', thNm, th.flag)}
        ${row('draw', I18N.t('legacy.draw'))}
        ${row('away', taNm, ta.flag)}
        <button class="btn-ghost ver-mas" onclick="openMatchPage('${m.fixtureId}')">${I18N.t('legacy.view_match_analysis')}</button>
      </div>`;
    }).join('') + '</div>';
  }

  // ---- 5. FAVORITOS DEL MODELO (tabla compacta) ----
  const favs = [...STATE.teams].sort((a, b) => b.sim.champion - a.sim.champion).slice(0, 8);
  html += `<div class="sec-head"><h3>${I18N.t('legacy.model_favorites')}</h3></div>
    <table class="fav-tbl"><tr><th>#</th><th>${I18N.t('legacy.col_team')}</th><th>${I18N.t('legacy.col_champion')}</th><th>${I18N.t('legacy.col_market_24h')}</th><th>${I18N.t('legacy.col_group')}</th></tr>` +
    favs.map((t, i) => {
      const m = ARB.rows.find(r => r.id === t.id);
      const ch = m && m.polymarket ? m.polymarket.change24h : null;
      return `<tr onclick="openTeam('${t.id}')">
        <td class="muted">${i + 1}</td>
        <td class="teamcell">${t.flag} ${I18N.teamName(t.id, t.name)}</td>
        <td><b>${pct(t.sim.champion)}</b></td>
        <td>${ch != null ? chgBadge(ch) : '<span class="muted">—</span>'}</td>
        <td class="muted">${t.group}</td></tr>`;
    }).join('') + '</table>';

  html += `<div class="warn" style="margin-top:22px">⚠ ${ARB.disclaimer}</div>`;

  // ---- tabla completa con datos de mercado ----
  html += `<details class="fulltbl"><summary>${I18N.t('legacy.all_markets')}</summary>
    <div style="overflow-x:auto">
    <table class="arbtable"><tr><th>${I18N.t('legacy.col_team')}</th><th>${I18N.t('legacy.col_model')}</th><th>Polymarket</th><th>${I18N.t('legacy.col_24h')}</th><th>${I18N.t('legacy.col_vol')}</th><th>Kalshi</th><th>${I18N.t('legacy.col_24h')}</th><th>${I18N.t('legacy.col_vol')}</th><th>${I18N.t('legacy.col_edge')}</th></tr>` +
    ARB.rows.filter(r => r.model > 0.001 || r.polymarket || r.kalshi).map(row => {
      const e = Math.max(0, ...row.edges.map(x => x.edge));
      const pm = row.polymarket, ks = row.kalshi;
      return `<tr>
        <td class="teamcell" onclick="openTeam('${row.id}')">${tlabel(row.id)}</td>
        <td><b>${pct(row.model)}</b></td>
        <td>${pm ? `<a class="mlink" href="${pm.url}" target="_blank" rel="noopener">${cents(pm.price)} ↗</a>` : '<span class="muted">—</span>'}</td>
        <td>${pm ? chgBadge(pm.change24h) : ''}</td>
        <td class="muted">${pm ? fmtUsd(pm.volume) : ''}</td>
        <td>${ks ? `<a class="mlink" href="${ks.url}" target="_blank" rel="noopener">${cents(ks.price)} ↗</a>` : '<span class="muted">—</span>'}</td>
        <td>${ks ? chgBadge(ks.change24h) : ''}</td>
        <td class="muted">${ks ? fmtUsd(ks.volume) : ''}</td>
        <td class="${e > 0.015 ? 'pgood' : 'muted'}">${e > 0 ? '+' + pct(e) : '—'}</td></tr>`;
    }).join('') + '</table></div></details>';
  $('#tab-arb').innerHTML = html;
}

// ---------- Fase Q.1 §4-9: Oportunidades FLAGSHIP (Picks GP | Value | Arbitraje) cableado a DTOs V2 ----------
// Consume /api/beta/{picks,value,arbitrage,dashboard} (códigos neutrales, sin "V1/V2"), localizado vía I18N,
// con cards premium reusando el shell rico de la plataforma (.feat/.xo-card/.val-grid/.dualcard). Picks default.
let OPP_SUB = 'picks';                                  // §4: Picks GP es el subtab por defecto
let OPP_DETAIL = null;                                  // 'pick'|'match' cuando hay un detalle abierto (anti-pestañeo)
let VAL_FILTER = 'ACTIONABLE';                          // filtro de la subtab Value (§8)
const OPP = { dash: null };                             // cache liviano del dashboard (mejor pick/value/headers)
// deep-link inicial: /#opportunities/picks|value|arbitrage
(function () { const m = (location.hash || '').match(/opportunities\/(picks|value|arb|arbitrage)/); if (m) OPP_SUB = m[1] === 'arbitrage' ? 'arb' : m[1]; })();

const oppT = (k, a) => I18N.t(k, a);
const oppTk = (k) => { const v = I18N.t(k); return v === k ? null : v; };       // null si la key no existe
function oppPct(v) { return v == null ? oppT('common.na') : (v * 100).toFixed(1) + '%'; }
function oppPP(v) { return v == null ? oppT('common.na') : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + ' pp'; }
function oppOdds(v) { return v == null ? '—' : Number(v).toFixed(2); }
function oppFlag(id) { const t = teamOf(id); return t ? t.flag : ''; }
function oppRisk(c) { return oppTk('risk.' + c) || c; }
function oppBlocker(b) { return oppTk('blocker.' + b) || oppTk('blocker.BLOCKED_' + b) || b; }
function oppTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleTimeString(I18N.locale === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }
function oppDateTime(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString(I18N.locale === 'en' ? 'en-US' : 'es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } }
async function oppGetDash() { if (OPP.dash) return OPP.dash; try { const r = await fetch('/api/beta/dashboard', { headers: hdrs() }); if (r.ok) OPP.dash = await r.json(); } catch (e) {} return OPP.dash; }
function oppHeaderMap(d) { const m = {}; ((d && d.upcoming) || []).forEach(u => { m[u.header.event_id] = u.header; }); return m; }

function oppSetSub(s) { OPP_SUB = s; try { history.replaceState(null, '', '#opportunities/' + s); } catch (e) {} return loadOpportunities(); }
async function loadOpportunities(force) {
  OPP_DETAIL = null;                                    // volvemos al listado → el refresco en vivo puede recargar
  const g = (USER.beta && USER.beta.opportunities) || {};
  const subs = [['picks', oppT('nav.picks'), g.picks], ['value', oppT('nav.value'), g.value], ['arb', oppT('nav.arbitrage'), g.arbitrage]];
  if (!subs.find(s => s[0] === OPP_SUB && s[2])) { const first = subs.find(s => s[2]); OPP_SUB = first ? first[0] : 'picks'; }
  const bar = subs.map(([id, l, on]) => on ? `<button class="seg-btn ${OPP_SUB === id ? 'on' : ''}" role="tab" aria-selected="${OPP_SUB === id}" onclick="oppSetSub('${id}')">${xe(l)}</button>` : '').join('');
  $('#tab-arb').innerHTML = `<div style="margin-bottom:10px"><h2 style="margin-bottom:3px">${xe(oppT('opp.title'))}</h2>
    <div class="muted" style="font-size:12px">${xe(oppT('opp.subtitle'))}</div></div>
    <div id="oppSummary"></div>
    <div class="seg" role="tablist" aria-label="${xe(oppT('opp.title'))}">${bar}</div>
    <div id="oppBody"><div class="du">${xe(oppT('common.loading'))}</div></div>`;
  loadOppSummary();
  if (OPP_SUB === 'picks') return loadOppPicks('#oppBody');
  if (OPP_SUB === 'value') return loadOppValue('#oppBody');
  return loadOppArbV2('#oppBody', force);
}

// ---- §5: home premium (mejor pick / mejor value / activas / actualización) ----
async function loadOppSummary() {
  const el = $('#oppSummary'); if (!el) return;
  const d = await oppGetDash(); if (!d || !el.isConnected) { if (el) el.innerHTML = ''; return; }
  const headers = oppHeaderMap(d);
  const bestPick = (d.recent_picks || []).filter(oppPickActive)[0] || null;   // solo picks realmente activas
  const bestValue = (d.value || [])[0];
  const active = (d.recent_picks || []).length + (d.value || []).length;
  const cell = (label, val) => `<div style="flex:1;min-width:140px"><div class="muted" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.04em">${xe(label)}</div><div style="font-size:13px;font-weight:700;margin-top:2px">${val}</div></div>`;
  const pickV = bestPick ? xe(oppPickSelection(bestPick)) : `<span class="muted">${xe(oppT('opp.summary.none'))}</span>`;
  const valV = bestValue ? `${xe(oppValSel(bestValue, headers[bestValue.event_id]))} <span class="green">${oppPP(bestValue.adjusted_edge_pp)}</span>` : `<span class="muted">—</span>`;
  el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:14px;padding:12px 14px;margin-bottom:12px;border:1px solid var(--border,#22303a);border-radius:12px;background:var(--card,#121a20)">
    ${cell(oppT('opp.summary.best_pick'), pickV)}
    ${cell(oppT('opp.summary.best_value'), valV)}
    ${cell(oppT('opp.summary.active'), active)}
    ${cell(oppT('opp.summary.updated'), d.generated_at ? oppTime(d.generated_at) : '—')}
  </div>`;
}

// ---- §6/§7: Picks GP (hero premium + lista + detalle) ----
// Una pick está ACTIVA solo si su partido aún no comenzó (lifecycle PUBLISHED). Si el partido ya empezó/terminó
// (EVENT_STARTED/AWAITING_SETTLEMENT) o está liquidada (SETTLED), NO es activa → no va como hero ni "mejor activa".
function oppPickActive(p) { return p.lifecycle_code === 'PUBLISHED' && (!p.result_code || p.result_code === 'PENDING'); }
function oppPickSelection(p) { if (p.selection_display_key) { const a = Object.assign({}, p.selection_display_args || {}); if (a.team_id) a.team = I18N.teamName(a.team_id); return I18N.t(p.selection_display_key, a); } return p.outcome_code || ''; }
function oppPickStatus(p) {
  if (p.result_code && p.result_code !== 'PENDING') { const cls = p.result_code === 'WIN' ? 'xo-st-active' : p.result_code === 'LOSS' ? 'xo-st-expired' : 'xo-st-paused'; return `<span class="xo-pill ${cls}">${xe(oppT('result.' + p.result_code))}</span>`; }
  const lc = p.lifecycle_code || 'PUBLISHED';
  const cls = lc === 'PUBLISHED' ? 'xo-st-active' : 'xo-st-paused';   // solo PUBLISHED en verde; partido ya jugado → gris
  return `<span class="xo-pill ${cls}">${xe(oppT('lifecycle.' + lc))}</span>`;
}
// §6/§12: badge de PRODUCTO (Pick GP), nunca de modelo. Las picks históricas (V1) llevan SOLO una etiqueta discreta.
function oppPickBadge(p) { return `<span class="xo-badge xo-b-pure">${xe(oppT('pick.badge'))}</span>${p.model_label_code === 'PREVIOUS' ? ` <span class="muted" style="font-size:10.5px">${xe(oppT('pick.previous_tag'))}</span>` : ''}`; }
function oppHeroPick(p) {
  const ev = `${oppFlag(p.home_team_id)} ${I18N.teamName(p.home_team_id)} ${oppT('common.vs')} ${I18N.teamName(p.away_team_id)} ${oppFlag(p.away_team_id)}`;
  const fair = p.gp_probability ? (1 / p.gp_probability) : null;
  const gross = (p.gp_probability != null && p.consensus_probability != null) ? p.gp_probability - p.consensus_probability : null;
  const metric = (l, v, cls) => `<div class="metric"><div class="m-l">${xe(l)}</div><div class="m-v ${cls || ''}">${v}</div></div>`;
  const mainRisk = (p.risk_codes && p.risk_codes[0]) ? oppRisk(p.risk_codes[0]) : null;
  return `<div class="sec-head"><h3>★ ${xe(oppT('opp.summary.best_pick'))}</h3></div>
  <div class="feat">
    <div class="feat-top">${oppPickBadge(p)}${oppPickStatus(p)}<span class="feat-edge">${oppPP(p.adjusted_edge_pp)}</span></div>
    <div class="feat-team"><div><div class="feat-name">${xe(oppPickSelection(p))}</div><div class="feat-side">${xe(ev)} · <span class="mono">${oppDateTime(p.kickoff_at)}</span></div></div></div>
    <div class="feat-metrics">
      ${metric(oppT('pick.gp_prob'), oppPct(p.gp_probability), 'blue')}
      ${metric(oppT('pick.market_prob'), oppPct(p.consensus_probability))}
      ${metric(oppT('pick.diff_gross'), oppPP(gross))}
      ${metric(oppT('pick.edge'), oppPP(p.adjusted_edge_pp), 'green')}
      ${metric(oppT('pick.fair_odds'), oppOdds(fair))}
      ${metric(oppT('pick.published_odds'), oppOdds(p.published_odds))}
      ${metric(oppT('pick.min_odds'), oppOdds(p.minimum_odds))}
      ${p.quality_score != null ? metric(oppT('value.quality'), p.quality_score) : ''}
    </div>
    ${mainRisk ? `<div class="muted" style="font-size:12px;margin-top:4px">${xe(oppT('pick.main_risk'))}: ${xe(mainRisk)}</div>` : ''}
    <div class="feat-cta"><button class="venue-btn v-poly" onclick="openOppPick('${p.pick_id}')">${xe(oppT('pick.view'))} →</button>${p.event_id ? `<button class="btn-ghost" onclick="openMatchV2('${p.event_id}')">${xe(oppT('pick.full_analysis'))}</button>` : ''}</div>
  </div>`;
}
function oppPickCard(p) {
  const ev = `${I18N.teamName(p.home_team_id)} ${oppT('common.vs')} ${I18N.teamName(p.away_team_id)}`;
  return `<div class="xo-card" onclick="openOppPick('${p.pick_id}')">
    <div class="xo-card-top">${oppPickBadge(p)} ${oppPickStatus(p)}</div>
    <div class="xo-ev">${xe(oppPickSelection(p))}</div>
    <div class="xo-mkt">${xe(ev)} · <span class="mono">${oppDateTime(p.kickoff_at)}</span></div>
    <div class="xo-sub">${xe(oppT('pick.published_odds'))}: <b>${oppOdds(p.published_odds)}</b> · ${xe(oppT('pick.min_odds'))}: <b>${oppOdds(p.minimum_odds)}</b> · ${xe(oppT('pick.edge'))} <b class="green">${oppPP(p.adjusted_edge_pp)}</b></div>
    <div class="xo-card-foot"><span>${xe(oppT('value.quality'))} ${p.quality_score == null ? '—' : p.quality_score}</span><span class="xo-cta">${xe(oppT('pick.view'))} →</span></div>
  </div>`;
}
async function loadOppPicks(sel) {
  const root = $(sel); if (!root) return;
  if (!((USER.beta.opportunities || {}).picks)) { root.innerHTML = du(oppT('opp.coming_soon')); return; }
  root.innerHTML = du(oppT('common.loading'));
  let items = [];
  try { const r = await fetch('/api/beta/picks', { headers: hdrs() }); if (!r.ok) { root.innerHTML = du(oppT('common.na')); return; } items = (await r.json()).items || []; }
  catch (e) { root.innerHTML = du(oppT('common.na')); return; }
  if (!items.length) { root.innerHTML = `<div class="op-state op-info" role="status"><div class="op-state-ic">○</div><div class="op-state-tx"><div class="op-state-t">${xe(oppT('pick.no_picks'))}</div></div></div>`; return; }
  // Separar ACTIVAS (partido por jugar) de NO ACTIVAS (partido ya comenzó/terminó). Una pick cuyo partido ya
  // pasó NO se presenta como activa: se lista aparte, atenuada y con etiqueta clara (no se borra del registro).
  const active = items.filter(oppPickActive);
  const inactive = items.filter(p => !oppPickActive(p));
  const hero = active[0] || null;
  const activeRest = active.filter(p => !hero || p.pick_id !== hero.pick_id);
  let html = hero ? oppHeroPick(hero) : `<div class="op-state op-info" role="status"><div class="op-state-ic">○</div><div class="op-state-tx"><div class="op-state-t">${xe(oppT('pick.none_active'))}</div></div></div>`;
  if (activeRest.length) html += `<div class="sec-head"><h3>${xe(oppT('pick.active_title'))}</h3><span class="sub">${activeRest.length}</span></div>` + activeRest.map(oppPickCard).join('');
  if (inactive.length) html += `<div class="sec-head" style="margin-top:14px"><h3>${xe(oppT('pick.inactive_title'))}</h3><span class="sub">${inactive.length}</span></div>`
    + `<div class="muted" style="font-size:11.5px;margin:-4px 0 8px">${xe(oppT('pick.inactive_note'))}</div>`
    + `<div style="opacity:.6">${inactive.map(oppPickCard).join('')}</div>`;
  root.innerHTML = html;
}
async function openOppPick(id) {
  OPP_DETAIL = 'pick';                                  // bloquea el refresco en vivo mientras se ve el detalle
  const root = $('#oppBody') || $('#tab-arb'); if (!root) return;
  root.innerHTML = `<button class="xo-back" onclick="loadOpportunities()">← ${xe(oppT('common.back'))}</button><div id="oppPickDetail">${du(oppT('common.loading'))}</div>`;
  let p;
  try { const r = await fetch('/api/beta/picks/' + encodeURIComponent(id), { headers: hdrs() }); if (!r.ok) { $('#oppPickDetail').innerHTML = du(oppT('common.na')); return; } p = await r.json(); }
  catch (e) { $('#oppPickDetail').innerHTML = du(oppT('common.na')); return; }
  const ev = `${I18N.teamName(p.home_team_id)} ${oppT('common.vs')} ${I18N.teamName(p.away_team_id)}`;
  const fair = p.gp_probability ? (1 / p.gp_probability) : null;
  const gross = (p.gp_probability != null && p.consensus_probability != null) ? p.gp_probability - p.consensus_probability : null;
  const row = (l, v) => `<div class="xo-row"><span>${xe(l)}</span><span class="mono">${v == null ? '—' : v}</span></div>`;
  $('#oppPickDetail').innerHTML = `
    <div class="feat xo-hero"><div class="xo-card-top">${oppPickBadge(p)} ${oppPickStatus(p)}</div>
      <div class="xo-ev" style="font-size:20px">${xe(oppPickSelection(p))}</div><div class="xo-mkt">${xe(ev)} · <span class="mono">${oppDateTime(p.kickoff_at)}</span></div></div>
    ${panel(oppT('pick.price_state'), '', `${row(oppT('pick.published_odds'), oppOdds(p.published_odds) + (p.sportsbook ? ' · ' + xe(p.sportsbook) : ''))}${row(oppT('pick.min_odds'), oppOdds(p.minimum_odds))}${row(oppT('pick.fair_odds'), oppOdds(fair))}${row(oppT('pick.price_state'), oppT('price_state.' + (p.price_state_code || 'AVAILABLE')))}`)}
    ${panel(oppT('pick.intelligence'), '', `${row(oppT('pick.gp_prob'), oppPct(p.gp_probability))}${row(oppT('pick.market_prob'), oppPct(p.consensus_probability))}${row(oppT('pick.diff_gross'), oppPP(gross))}${row(oppT('pick.break_even'), oppPct(p.break_even_probability))}${row(oppT('pick.edge'), oppPP(p.adjusted_edge_pp))}${row(oppT('value.quality'), p.quality_score)}${row(oppT('value.uncertainty'), p.uncertainty_score)}`)}
    ${(p.risk_codes && p.risk_codes.length) ? panel(oppT('match.risks_title'), '', p.risk_codes.map(c => `<div class="xo-note">${xe(oppRisk(c))}</div>`).join('')) : ''}
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${p.event_id ? `<button class="btn-ghost" onclick="openMatchV2('${p.event_id}')">${xe(oppT('pick.full_analysis'))}</button>` : ''}${p.deep_link ? `<a class="venue-btn v-poly" href="${xe(p.deep_link)}" target="_blank" rel="noopener nofollow">${xe(oppT('pick.open_link'))} ↗</a>` : ''}</div>
    <div class="muted" style="font-size:11.5px;margin-top:12px">${xe(oppT('pick.theoretical_note'))}<br>${xe(oppT('pick.not_advice'))}</div>`;
}

// ---- §10/§11: página canónica de partido (GP Intelligence) por canonical_event_id, alcanzable desde el flagship ----
function oppOutcomeLabel(header, code) { if (code === 'DRAW') return oppT('prob.draw'); const team = code === 'AWAY' ? header.away : header.home; return I18N.teamName(team.team_id, team.name_fallback); }
// Render del DTO V2 (GP Intelligence) → HTML. Reusado por openMatchV2 (Oportunidades) y por la página de
// partido (Partidos, Q.1.1 §2). opts.hero=false omite el encabezado de equipos (cuando la página ya lo tiene).
function oppMatchV2Html(m, opts) {
  opts = opts || {};
  const h = m.header;
  let html = '';
  if (opts.hero !== false) {
    const teamLine = `${oppFlag(h.home.team_id)} ${I18N.teamName(h.home.team_id, h.home.name_fallback)} ${oppT('common.vs')} ${I18N.teamName(h.away.team_id, h.away.name_fallback)} ${oppFlag(h.away.team_id)}`;
    html += `<div class="feat xo-hero"><div class="feat-name" style="font-size:20px">${xe(teamLine)}</div><div class="muted" style="font-size:12px;margin-top:3px">${h.venue ? xe(h.venue) + ' · ' : ''}${h.kickoff_at ? '<span class="mono">' + oppDateTime(h.kickoff_at) + '</span>' : ''}</div></div>`;
  }
  if (!m.has_official_v2) { html += du(oppT('match.no_v2')); return html; }
  // Probabilidad GP (1X2 regulación)
  const oc = {}; (m.probability && m.probability.outcomes || []).forEach(o => oc[o.outcome_code] = o);
  const gp = c => (oc[c] && oc[c].gp_probability != null) ? oc[c].gp_probability : 0;
  const mk = c => (oc[c] && oc[c].market_probability != null) ? oc[c].market_probability : null;
  html += panel(oppT('match.gp_probability'), oppT('period.regulation_note'), `
    <div class="pbar"><div class="ph" style="width:${gp('HOME') * 100}%"></div><div class="pd" style="width:${gp('DRAW') * 100}%"></div><div class="pa" style="width:${gp('AWAY') * 100}%"></div></div>
    <div class="plabels"><span>${xe(oppOutcomeLabel(h, 'HOME'))} ${oppPct(gp('HOME'))}</span><span>${xe(oppT('prob.draw'))} ${oppPct(gp('DRAW'))}</span><span>${xe(oppOutcomeLabel(h, 'AWAY'))} ${oppPct(gp('AWAY'))}</span></div>
    ${mk('HOME') != null ? `<div class="muted" style="font-size:11px;margin-top:6px">${xe(oppT('prob.market'))}: ${oppPct(mk('HOME'))} · ${oppPct(mk('DRAW'))} · ${oppPct(mk('AWAY'))}</div>` : ''}`);
  // Clasificación (eliminatorias) — separada de 1X2 90'
  if (m.qualify) html += panel(oppT('match.qualify_title'), oppT('match.qualify_note'), `<div class="xo-row"><span>${xe(oppOutcomeLabel(h, 'HOME'))}</span><span class="mono">${oppPct(m.qualify.home_qualify)}</span></div><div class="xo-row"><span>${xe(oppOutcomeLabel(h, 'AWAY'))}</span><span class="mono">${oppPct(m.qualify.away_qualify)}</span></div>`);
  // Contexto aplicado (§12: probabilidad inicial → contexto aplicado → probabilidad GP final)
  const a = m.analysis;
  if (a) {
    let inner = '';
    if (a.applied_factors && a.applied_factors.length) {
      inner += '<div class="gpi-factors">' + a.applied_factors.slice(0, 6).map(f => `<div class="gpi-factor"><div class="gpi-fac-l">${xe(oppTk('factor.' + f.factor_code) || f.factor_code)}</div><div class="gpi-fac-d">${f.applied_impact >= 0 ? '+' : ''}${f.applied_impact}</div></div>`).join('') + '</div>';
    } else {
      inner += `<div class="muted" style="font-size:12px">${xe(a.context_moved_line ? oppT('match.context_moved') : oppT('match.context_neutral'))}</div>`;
      if (a.evaluated_factors && a.evaluated_factors.length) inner += `<div class="muted" style="font-size:11px;margin-top:6px">${xe(oppT('match.evaluated_title'))}: ${a.evaluated_factors.map(f => xe(oppTk('factor.' + f.factor_code) || f.factor_code)).join(' · ')}</div>`;
    }
    const adj = a.context_adjustments;
    if (adj && adj.HOME != null) inner += `<div class="gpi-deltas" style="margin-top:8px"><span>${xe(oppOutcomeLabel(h, 'HOME'))}: ${oppPP(adj.HOME)}</span><span>${xe(oppT('prob.draw'))}: ${oppPP(adj.DRAW)}</span><span>${xe(oppOutcomeLabel(h, 'AWAY'))}: ${oppPP(adj.AWAY)}</span></div>`;
    // freshness/incertidumbre/completitud como tags (§2)
    const tags = [];
    if (a.data_freshness_code) tags.push(`${xe(oppT('match.data_freshness'))}: ${xe(oppTk('freshness.' + a.data_freshness_code) || a.data_freshness_code)}`);
    if (a.context_completeness != null) tags.push(`${xe(oppT('match.context_completeness') || 'context')}: ${Math.round(a.context_completeness * 100)}%`);
    if (tags.length) inner += `<div class="muted" style="font-size:10.5px;margin-top:8px">${tags.join(' · ')}</div>`;
    html += panel(oppT('match.context_applied'), oppTk('context_state.' + a.context_state_code) || '', inner);
  }
  if (m.risks && m.risks.length) html += panel(oppT('match.risks_title'), '', m.risks.map(c => `<div class="xo-note">${xe(oppRisk(c))}</div>`).join(''));
  if (m.goal_insights) { const g = m.goal_insights, eg = g.expected_goals || {}; html += panel(oppT('goal.section_title'), oppT('goal.disclaimer'), `<div class="xo-row"><span>${xe(oppOutcomeLabel(h, 'HOME'))}</span><span class="mono">${eg.HOME == null ? '—' : eg.HOME}</span></div><div class="xo-row"><span>${xe(oppOutcomeLabel(h, 'AWAY'))}</span><span class="mono">${eg.AWAY == null ? '—' : eg.AWAY}</span></div><div class="xo-row"><span>${xe(oppT('goal.total'))}</span><span class="mono">${eg.TOTAL == null ? '—' : eg.TOTAL}</span></div>`); }
  if (m.updated_at) html += `<div class="muted" style="font-size:11px;margin-top:10px">${xe(oppT('common.updated_at', { time: oppTime(m.updated_at) }))}</div>`;
  return html;
}
async function openMatchV2(eventId) {
  OPP_DETAIL = 'match';                                 // bloquea el refresco en vivo mientras se ve el análisis
  const root = $('#oppBody') || $('#tab-arb'); if (!root) return;
  root.innerHTML = `<button class="xo-back" onclick="loadOpportunities()">← ${xe(oppT('common.back'))}</button><div id="oppMatch">${du(oppT('common.loading'))}</div>`;
  let m;
  try { const r = await fetch('/api/beta/match/' + encodeURIComponent(eventId), { headers: hdrs() }); if (r.status === 404) { $('#oppMatch').innerHTML = du(oppT('error.not_found')); return; } if (!r.ok) { $('#oppMatch').innerHTML = du(oppT('common.na')); return; } m = await r.json(); }
  catch (e) { $('#oppMatch').innerHTML = du(oppT('common.na')); return; }
  $('#oppMatch').innerHTML = oppMatchV2Html(m, { hero: true });
}

// ---- §8: Value (scanner profesional) ----
function oppValSel(v, header) { if (v.outcome_code === 'DRAW') return oppT('prob.draw'); if (header) { const team = v.outcome_code === 'AWAY' ? header.away : header.home; return oppT('selection.team_to_win', { team: I18N.teamName(team.team_id, team.name_fallback) }); } return v.outcome_code || ''; }
function oppValueCard(v, header) {
  const ev = header ? `${I18N.teamName(header.home.team_id, header.home.name_fallback)} ${oppT('common.vs')} ${I18N.teamName(header.away.team_id, header.away.name_fallback)}` : '';
  const cls = { STRONG: 'val-strong', LEAN: 'val-lean', WATCH: 'val-watch', PASS: 'val-pass' }[v.classification_code] || 'val-pass';
  const gross = (v.gp_probability != null && v.market_probability != null) ? v.gp_probability - v.market_probability : null;
  return `<div class="xo-card"${v.event_id ? ` onclick="openMatchV2('${v.event_id}')" style="cursor:pointer"` : ''}>
    ${ev ? `<div class="muted" style="font-size:12px;margin-bottom:4px">${xe(ev)}</div>` : ''}
    <div class="xo-card-top"><span class="val-badge ${cls}">${xe(oppT('classification.' + String(v.classification_code || '').toLowerCase()))}</span> <span class="reg-type">${xe(oppValSel(v, header))}</span>${v.actionable ? `<span class="xo-pill xo-st-active" style="margin-left:auto">${xe(oppT('value.actionable'))}</span>` : ''}</div>
    <div class="val-grid">
      <div><span>${xe(oppT('value.gp_prob'))}</span><b>${oppPct(v.gp_probability)}</b></div>
      <div><span>${xe(oppT('value.market_prob'))}</span><b>${oppPct(v.market_probability)}</b></div>
      <div><span>${xe(oppT('value.diff_gross'))}</span><b>${oppPP(gross)}</b></div>
      <div><span>${xe(oppT('value.edge'))}</span><b class="${(v.adjusted_edge_pp || 0) > 0 ? 'green' : ''}">${oppPP(v.adjusted_edge_pp)}</b></div>
      <div><span>${xe(oppT('value.best_odds'))}</span><b>${oppOdds(v.best_odds)}</b></div>
      <div><span>${xe(oppT('value.min_odds'))}</span><b>${oppOdds(v.minimum_odds)}</b></div>
      ${v.quality_score != null ? `<div><span>${xe(oppT('value.quality'))}</span><b>${v.quality_score}</b></div>` : ''}
      ${v.best_sportsbook ? `<div><span>${xe(oppT('value.sportsbook'))}</span><b>${xe(v.best_sportsbook)}</b></div>` : ''}
    </div>
    ${(!v.actionable && v.blockers && v.blockers.length) ? `<div class="muted" style="font-size:11.5px;margin-top:6px">${v.blockers.map(b => xe(oppBlocker(b))).join(' · ')}</div>` : ''}
    ${v.event_id ? `<div class="xo-card-foot"><span></span><span class="xo-cta">${xe(oppT('value.view_analysis'))} →</span></div>` : ''}
  </div>`;
}
const VAL_FILTERS = [['ACTIONABLE', 'value.filter_actionable'], ['STRONG', 'value.filter_strong'], ['LEAN', 'value.filter_lean'], ['WATCH', 'value.filter_watch'], ['ALL', 'value.filter_all']];
function oppValSetFilter(f) { VAL_FILTER = f; return loadOppValue('#oppBody'); }
async function loadOppValue(sel) {
  const root = $(sel); if (!root) return;
  if (!((USER.beta.opportunities || {}).value)) { root.innerHTML = du(oppT('opp.coming_soon')); return; }
  // §8: filtros (Accionables/STRONG/LEAN/WATCH/Todas) — así se ve que el motor SÍ está evaluando aunque hoy
  // no haya value accionable (todas las evals próximas en PASS/WATCH = el modelo coincide con el mercado).
  const bar = VAL_FILTERS.map(([k, lk]) => `<button class="seg-btn ${VAL_FILTER === k ? 'on' : ''}" onclick="oppValSetFilter('${k}')">${xe(oppT(lk))}</button>`).join('');
  root.innerHTML = `<div class="explain">${xe(oppT('value.subtitle'))}</div><div class="seg" role="tablist" style="margin-bottom:10px">${bar}</div><div id="valFlagBody">${du(oppT('common.loading'))}</div>`;
  const body = $('#valFlagBody'); if (!body) return;
  let items = [];
  try { const r = await fetch('/api/beta/value?class=' + VAL_FILTER, { headers: hdrs() }); await oppGetDash(); if (!r.ok) { body.innerHTML = du(oppT('common.na')); return; } items = (await r.json()).items || []; }
  catch (e) { body.innerHTML = du(oppT('common.na')); return; }
  const headers = oppHeaderMap(OPP.dash);
  if (items.length) { body.innerHTML = items.map(v => oppValueCard(v, headers[v.event_id])).join(''); return; }
  // Empty INFORMATIVO: el motor está corriendo; en este filtro no hay resultados ahora.
  const title = VAL_FILTER === 'ACTIONABLE' ? oppT('value.none_actionable') : oppT('value.no_results');
  body.innerHTML = `<div class="op-state op-info" role="status"><div class="op-state-ic">○</div><div class="op-state-tx"><div class="op-state-t">${xe(title)}</div><div class="op-state-b">${xe(oppT('value.engine_working'))}</div></div></div>`;
}

// ---- §9: Arbitraje (integra Fase R; SOLO ejecutable/válido al cliente; bloqueados quedan en Observatory admin) ----
function oppArbTitle(o) { if (o.home && (o.home.team_id || o.home.name_fallback)) return `${I18N.teamName(o.home.team_id, o.home.name_fallback)} ${oppT('common.vs')} ${I18N.teamName(o.away.team_id, o.away.name_fallback)}`; return oppT('arb.title'); }
function oppArbCard(o) {
  const st = oppTk('arb.state.' + o.state_code) || o.state_code;
  return `<div class="dualcard">
    <div class="dual-top"><b style="font-size:16px">${xe(oppArbTitle(o))}</b><span class="purebadge">${xe(st)}</span><span class="edge-big">${oppPP(o.net_roi)} neto</span></div>
    <div class="note" style="margin:6px 0 8px">${o.venues && o.venues.length ? xe(o.venues.join(' · ')) : ''}${o.updated_at ? ' · ' + oppTime(o.updated_at) : ''}</div>
    <div class="xo-sub">${xe(oppT('arb.executable_capital'))}: <b>${o.executable_capital != null ? xe(String(o.executable_capital)) : oppT('common.na')}</b></div>
  </div>`;
}
async function loadOppArbV2(sel) {
  const root = $(sel); if (!root) return;
  if (!((USER.beta.opportunities || {}).arbitrage)) { root.innerHTML = du(oppT('opp.coming_soon')); return; }
  root.innerHTML = du(oppT('common.loading'));
  let d;
  try { const r = await fetch('/api/beta/arbitrage', { headers: hdrs() }); if (!r.ok) { root.innerHTML = du(oppT('common.na')); return; } d = await r.json(); }
  catch (e) { root.innerHTML = du(oppT('common.na')); return; }
  const items = (d.items || []).filter(o => o.executable);    // §9: nunca mostrar bloqueados/stale como ejecutables
  let html = `<div class="explain">${xe(oppT('arb.subtitle'))}</div>`;
  if (!items.length) html += `<div class="op-state op-info" role="status"><div class="op-state-ic">○</div><div class="op-state-tx"><div class="op-state-t">${xe(oppT('arb.no_executable'))}</div></div></div>`;
  else html += '<div class="arbops">' + items.map(oppArbCard).join('') + '</div>';
  root.innerHTML = html;
}

// ---------- EVOLUCIÓN ----------
const PALETTE = ['#18E6A3', '#4DA3FF', '#F6C85F', '#FF6B6B', '#A78BFA', '#34D399', '#FF9F43', '#5BB0FF', '#DB2777', '#9AE6B4'];
let evoFilter = 'top';
function selectEvo(f) { evoFilter = f; renderEvo(); }
function renderEvo() {
  const mine = USER ? (USER.favorites || []) : [];
  const useMine = evoFilter === 'mine' && mine.length;
  const sel = (useMine ? mine.map(id => STATE.teams.find(t => t.id === id)).filter(Boolean) : [...STATE.teams])
    .sort((a, b) => b.sim.champion - a.sim.champion).slice(0, useMine ? 8 : 10);
  $('#tab-evo').innerHTML = `
    <div style="margin-bottom:10px"><h2 style="margin-bottom:3px">${I18N.t('evo.title')}</h2>
      <div class="muted" style="font-size:12px">${I18N.t('evo.subtitle')}</div></div>
    <div class="gchips" style="margin-bottom:14px">
      <button class="gchip ${evoFilter === 'top' ? 'on' : ''}" onclick="selectEvo('top')">${I18N.t('evo.top10')}</button>
      <button class="gchip ${evoFilter === 'mine' ? 'on' : ''}" onclick="selectEvo('mine')">${I18N.t('evo.mine')}</button>
    </div>
    <div class="evo-chart"><canvas id="evoChart" width="1120" height="420"></canvas></div>
    <div id="evoLegend"></div>
    <div id="evoTable"></div>`;
  const cv = $('#evoChart'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const hist = STATE.history || [];
  if (hist.length < 2) {
    ctx.fillStyle = '#6F7A82'; ctx.font = '13px Inter, sans-serif';
    ctx.fillText(I18N.t('evo.empty'), 24, 36);
  } else {
    const maxP = Math.max(.05, ...hist.flatMap(h => sel.map(t => h.probs[t.id] || 0))) * 1.15;
    const X = i => 50 + i / (hist.length - 1) * (cv.width - 70);
    const Y = p => cv.height - 28 - p / maxP * (cv.height - 48);
    ctx.strokeStyle = 'rgba(255,255,255,.07)'; ctx.fillStyle = '#6F7A82'; ctx.font = '11px Inter, sans-serif';
    for (let g = 0; g <= 4; g++) { const p = maxP * g / 4, y = Y(p); ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(cv.width - 16, y); ctx.stroke(); ctx.fillText(pct(p, 0), 8, y + 3); }
    sel.forEach((t, ti) => {
      ctx.strokeStyle = PALETTE[ti % PALETTE.length]; ctx.lineWidth = 1.8; ctx.beginPath();
      hist.forEach((h, i) => { const y = Y(h.probs[t.id] || 0); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); });
      ctx.stroke();
    });
  }
  $('#evoLegend').innerHTML = sel.map((t, i) =>
    `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${t.flag} ${I18N.teamName(t.id, t.name)} ${pct(t.sim.champion)}</span>`).join('');
  const start = hist.length ? hist[0].probs : {};
  $('#evoTable').innerHTML = `<table class="fav-tbl" style="margin-top:16px">
    <tr><th>#</th><th>${I18N.t('evo.col_team')}</th><th>${I18N.t('evo.col_current')}</th><th>${I18N.t('evo.col_since_start')}</th><th>${I18N.t('evo.col_group')}</th></tr>` +
    sel.map((t, i) => {
      const d = t.sim.champion - (start[t.id] || t.sim.champion);
      const dTxt = Math.abs(d) < 0.0005 ? '<span class="muted">—</span>' : `<span class="${d > 0 ? 'pgood' : 'pbad'}">${d > 0 ? '▲' : '▼'} ${(Math.abs(d) * 100).toFixed(1)}%</span>`;
      return `<tr onclick="openTeam('${t.id}')"><td class="muted">${i + 1}</td><td class="teamcell">${t.flag} ${I18N.teamName(t.id, t.name)}</td><td><b>${pct(t.sim.champion)}</b></td><td>${dTxt}</td><td class="muted">${t.group}</td></tr>`;
    }).join('') + '</table>';
}

// ---------- ADMIN ----------
function renderAdmin() {
  if (!USER || !USER.isAdmin) { $('#tab-admin').innerHTML = '<div class="muted">Solo administradores.</div>'; return; }
  const sync = STATE.sync || {};
  const groupOpts = STATE.fixtures
    .sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''))
    .map(f => `<option value="${f.id}">${teamOf(f.home).name} vs ${teamOf(f.away).name} · ${fmtKickoff(f)} (Grupo ${f.group})</option>`).join('');
  const koOpts = STATE.knockout.map(k => {
    const h = k.resolved.home ? teamOf(k.resolved.home).name : slotDesc(k.home);
    const a = k.resolved.away ? teamOf(k.resolved.away).name : slotDesc(k.away);
    return `<option value="${k.m}">${STAGES_ES[k.stage]} · ${h} vs ${a} · ${k.date}</option>`;
  }).join('');
  const teamOpts = STATE.teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  $('#tab-admin').innerHTML = `
    <div class="explain" style="border-left-color:${sync.ok ? 'var(--accent)' : 'var(--amber)'}">
      ${sync.ok ? '🟢' : '🟡'} <b>Los resultados se cargan solos:</b> el sistema consulta los marcadores oficiales (ESPN)
      cada 2 minutos y actualiza Elo y probabilidades automáticamente, incluso en vivo minuto a minuto.
      ${sync.ts ? `Última sincronización: ${new Date(sync.ts).toLocaleTimeString()}${sync.error ? ' · error: ' + sync.error : ''}.` : ''}
      <br>Este panel es solo para <b>corregir manualmente</b> un marcador si la fuente fallara.
    </div>
    <div class="gcard" id="betaAdminCard">
      <h3>ACCESO BETA · ENTITLEMENT</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px">Concede/revoca acceso a la plataforma nueva por email. Acceso automático: 5 referidos verificados. Fusión global: variable de entorno <b>GP_BETA_FUSION_ENABLED</b>.</div>
      <div class="formrow" style="align-items:flex-end">
        <label style="flex:1;min-width:180px">Email<br><input id="betaEmail" type="email" placeholder="correo@ejemplo.com" style="width:100%"></label>
        <label style="flex:1;min-width:140px">Motivo (opcional)<br><input id="betaReason" type="text" placeholder="motivo / fuente" style="width:100%"></label>
      </div>
      <div class="formrow">
        <button class="btn" onclick="betaAdmin('grant')">Conceder</button>
        <button class="ghost" onclick="betaAdmin('suspend')">Suspender</button>
        <button class="ghost" onclick="betaAdmin('revoke')">Revocar</button>
        <button class="ghost" onclick="betaAdmin('reinstate')">Reactivar</button>
        <button class="ghost" onclick="loadBetaAdmin()">↻ Refrescar</button>
      </div>
      <div id="betaAdminMsg" class="muted" style="font-size:12px;margin:6px 0"></div>
      <div id="betaAdminBody" class="muted" style="font-size:12px">Cargando…</div>
    </div>
    <div class="gcard" id="candidateCard">
      <h3>CANDIDATE FACTORY · COLA INTERNA</h3>
      <div id="candidateBody" class="muted" style="font-size:12px">Cargando…</div>
    </div>
    <div class="gcard" style="margin-top:12px" id="picksCard">
      <h3>PICKS APROBADAS · INTERNAS</h3>
      <div id="picksBody" class="muted" style="font-size:12px">Cargando…</div>
    </div>
    <div class="gcard" style="margin-top:12px" id="shadowObsCard">
      <h3>V2 SHADOW OBSERVATORY · INTERNO</h3>
      <div id="shadowObsBody" class="muted" style="font-size:12px">Cargando…</div>
    </div>
    <div class="gcard" style="margin-top:12px" id="registryAdminCard">
      <h3>REGISTRO DE SEÑALES · CONTROL INTERNO</h3>
      <div id="registryAdminBody" class="muted" style="font-size:12px">Cargando…</div>
    </div>
    <div class="gcard" style="margin-top:12px" id="trackRecordCard">
      <h3>TRACK RECORD · METRICS INTERNO</h3>
      <div id="trackRecordBody" class="muted" style="font-size:12px">Cargando…</div>
    </div>
    <div class="gcard" style="margin-top:12px">
      <h3>CORREGIR PARTIDO · FASE DE GRUPOS</h3>
      <div class="formrow"><label style="width:100%">Partido<br><select id="gMatch" style="width:100%">${groupOpts}</select></label></div>
      <div class="formrow">
        <label>Goles equipo 1 (izquierda)<br><input id="gHg" type="number" min="0" value="0" style="width:120px"></label>
        <label>Goles equipo 2 (derecha)<br><input id="gAg" type="number" min="0" value="0" style="width:120px"></label>
        <label>Estado del partido<br><select id="gStatus"><option value="final">Terminado (final)</option><option value="live">En juego (en vivo)</option></select></label>
        <label>Minuto actual (solo si está en juego)<br><input id="gMin" type="number" min="0" max="90" value="0" style="width:120px"></label>
      </div>
      <div class="formrow">
        <button class="btn" onclick="saveResult(true)">Guardar resultado</button>
        <button class="ghost" onclick="removeResult(true)">Eliminar resultado de este partido</button>
      </div>
    </div>
    <div class="gcard" style="margin-top:12px">
      <h3>CORREGIR PARTIDO · ELIMINACIÓN DIRECTA</h3>
      <div class="formrow"><label style="width:100%">Llave<br><select id="kMatch" style="width:100%">${koOpts}</select></label></div>
      <div class="formrow">
        <label>Equipo 1<br><select id="kHome">${teamOpts}</select></label>
        <label>Equipo 2<br><select id="kAway">${teamOpts}</select></label>
      </div>
      <div class="formrow">
        <label>Goles equipo 1<br><input id="kHg" type="number" min="0" value="0" style="width:120px"></label>
        <label>Goles equipo 2<br><input id="kAg" type="number" min="0" value="0" style="width:120px"></label>
        <label>Estado<br><select id="kStatus"><option value="final">Terminado</option><option value="live">En juego</option></select></label>
        <label>Minuto (si está en juego)<br><input id="kMin" type="number" min="0" max="120" value="0" style="width:120px"></label>
      </div>
      <div class="formrow">
        <label><input type="checkbox" id="kPens"> Si empataron: ganó el <b>equipo 1</b> en penales</label>
      </div>
      <div class="formrow">
        <button class="btn" onclick="saveResult(false)">Guardar resultado</button>
        <button class="ghost" onclick="removeResult(false)">Eliminar resultado</button>
      </div>
    </div>
    <div id="adminMsg" class="warn"></div>
    <div class="gcard" style="margin-top:12px">
      <h3>EMAIL MASIVO</h3>
      <div class="muted" style="font-size:12px;margin-bottom:8px"><b>Anuncio de la beta</b> (diseño completo). Suele caer en Promociones. Prueba primero contigo.</div>
      <div class="formrow">
        <button class="ghost" onclick="broadcastNews(true,'beta')">✉ Prueba (anuncio)</button>
        <button class="btn" onclick="broadcastNews(false,'beta')">📣 Anuncio a TODOS</button>
      </div>
      <div class="muted" style="font-size:12px;margin:14px 0 8px"><b>Reactivación (bandeja Principal)</b>: correo estilo personal para reenganchar inactivos. Optimizado para llegar a Principal, no a Promociones. Prueba primero contigo.</div>
      <div class="formrow">
        <button class="ghost" onclick="broadcastNews(true,'reengage')">✉ Prueba (reactivación)</button>
        <button class="btn" onclick="broadcastNews(false,'reengage')">📣 Reactivación a TODOS</button>
      </div>
      <div id="bcastMsg" class="muted" style="font-size:12px;margin-top:8px"></div>
    </div>
    <div class="gcard" style="margin-top:12px">
      <h3>TELEGRAM</h3>
      <div class="muted" style="font-size:12px;margin-bottom:10px">Publica un mensaje de prueba al canal. Requiere TELEGRAM_BOT_TOKEN y TELEGRAM_CHANNEL en Render.</div>
      <div class="formrow"><button class="ghost" onclick="telegramTest()">✈ Probar publicación</button><button class="ghost" onclick="telegramDaily()">📊 Publicar resumen de hoy</button></div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">Automático: finales de partidos, oportunidades fuertes y el resumen diario (mañana). Estos botones son para probar/forzar.</div>
      <div id="tgMsg" class="muted" style="font-size:12px;margin-top:8px"></div>
    </div>
    <div class="gcard" style="margin-top:12px">
      <h3>BASE DE USUARIOS</h3>
      <div class="muted" style="font-size:11px;margin-bottom:6px">Tu base de clientes va al final del panel: arriba quedan las herramientas internas (candidatos, registro, métricas).</div>
      <div id="userBase" class="muted">Cargando…</div>
    </div>`;
  loadBetaAdmin();
  loadCandidates();
  loadApprovedPicks();
  loadShadowObservatory();
  loadRegistryAdmin();
  loadTrackRecord();
  loadUsers();
}
async function betaAdmin(action) {
  const email = ($('#betaEmail') || {}).value || '';
  const reason = ($('#betaReason') || {}).value || '';
  const msg = $('#betaAdminMsg');
  if (!/.+@.+\..+/.test(email)) { if (msg) msg.textContent = 'Email inválido.'; return; }
  try {
    const r = await fetch('/api/admin/beta/' + action, { method: 'POST', headers: hdrs(), body: JSON.stringify({ email: email.trim().toLowerCase(), reason }) });
    const j = await r.json();
    if (msg) msg.textContent = j.ok ? `✓ ${action} · ${email} → ${j.entitlement && j.entitlement.access ? 'CON acceso' : 'sin acceso'}` : ('Error: ' + (j.error || r.status));
    loadBetaAdmin();
  } catch (e) { if (msg) msg.textContent = 'Error de red.'; }
}
async function loadBetaAdmin() {
  const el = $('#betaAdminBody'); if (!el) return;
  try {
    const r = await fetch('/api/admin/beta/list', { headers: hdrs() });
    if (!r.ok) { el.innerHTML = '<span class="warn">No autorizado (' + r.status + ').</span>'; return; }
    const j = await r.json();
    const rows = (j.grants || []).concat(j.by_referral || []);
    const head = `<div class="muted" style="font-size:11.5px;margin-bottom:6px">Fusión global: <b>${j.fusion ? 'ON (todos acceden)' : 'off'}</b> · Requisito referidos: <b>${j.referrals_required}</b> · Con acceso: <b>${j.total_with_access}</b></div>`;
    if (!rows.length) { el.innerHTML = head + '<span class="muted">Sin grants ni usuarios calificados aún.</span>'; return; }
    const tr = rows.map(g => {
      const st = g.status === 'active' ? '<span class="green">activo</span>' : g.status === 'suspended' ? '<span class="amber">suspendido</span>' : g.status === 'revoked' ? '<span class="warn">revocado</span>' : g.status;
      const dt = g.granted_at ? new Date(g.granted_at).toLocaleDateString() : '—';
      return `<tr><td>${xe(g.email)}</td><td>${st}</td><td>${xe(g.source)}</td><td>${xe(g.granted_by || '—')}</td><td>${dt}</td><td class="mono">${g.verified_referrals}</td><td>${xe(g.reason || '—')}</td></tr>`;
    }).join('');
    el.innerHTML = head + `<div style="overflow:auto"><table class="dtable" style="width:100%;font-size:12px"><thead><tr><th>Email</th><th>Estado</th><th>Fuente</th><th>Concedido por</th><th>Fecha</th><th>Refs✓</th><th>Motivo</th></tr></thead><tbody>${tr}</tbody></table></div>`;
  } catch (e) { el.innerHTML = '<span class="warn">Error de red.</span>'; }
}
async function loadCandidates(bodySel) {
  const el = $(bodySel || '#candidateBody'); if (!el) return;
  try {
    const r = await fetch('/api/internal/value/candidates', { headers: hdrs() });
    if (r.status === 404) { el.innerHTML = '<span class="muted">Value/Candidate Factory apagada (VALUE_ENGINE_ENABLED off).</span>'; return; }
    if (!r.ok) { el.innerHTML = '<span class="warn">No autorizado (' + r.status + ').</span>'; return; }
    const t = await r.json();
    if (!t.candidates) { el.innerHTML = `<div class="explain" style="margin:0">${t.note || 'No apareció ninguna oportunidad que cumpliera los gates actuales.'}</div><div class="muted" style="font-size:11px;margin-top:8px">Conversión a Pick: <b>deshabilitada</b> — se habilitará en la siguiente fase.</div>`; return; }
    const convOn = !!t.conversion_enabled;
    const L = (k, a) => I18N.t(k, a);
    const langSel = `<div class="formrow" style="margin-bottom:8px;align-items:center"><span class="muted" style="font-size:11px">${L('lang.label')}:</span>` +
      ['es', 'en'].map(l => `<button class="ghost" style="${I18N.locale === l ? 'border-color:var(--accent);color:var(--accent)' : ''}" onclick="setLang('${l}','${bodySel || '#candidateBody'}')">${l.toUpperCase()}</button>`).join('') + `</div>`;
    // Solo "por aprobar": ocultar las ya convertidas a Pick y las que dejaron de ser STRONG (eligible_now=false).
    const visible = (t.items || []).filter(c => !c.converted && c.eligible_now !== false);
    if (!visible.length) { el.innerHTML = langSel + `<div class="explain" style="margin:0">${I18N.locale === 'en' ? 'No candidates pending approval right now.' : 'No hay candidatos pendientes de aprobar en este momento.'}</div>`; return; }
    const rows = visible.map(c => {
      const ready = c.candidate_status === 'READY_FOR_REVIEW';
      const fbTeam = c.selection_code === 'away' ? c.away_team : c.home_team;
      const sel = I18N.renderSelection(c.selection_display_model, fbTeam) || c.selection_display_es || c.selection_code;
      const blockers = (c.readiness_blockers || []).map(b => L('blocker.' + b) || b).join(', ');
      const approveBtn = (ready && convOn)
        ? `<button class="btn" onclick="candApprove('${c.candidate_id}','${sel.replace(/'/g, '')}','${c.best_odds}')">${L('ui.approve_as_pick')}</button>`
        : `<button class="ghost" disabled title="${ready ? L('ui.conversion_disabled') : L('ui.not_ready')}">${L('ui.approve_as_pick')}</button>`;
      return `<div class="explain" style="margin:6px 0"><b>${sel}</b> · ${L('classification.strong')}<br>` +
        `<span class="muted" style="font-size:11px">${c.event_display || ''} · ${L('market.match_result')} · ${L('period.regulation')}</span><br>` +
        `${L('ui.current_odds')}: <b>${c.best_odds ?? '—'}</b> · ${L('ui.minimum_odds')}: ${c.minimum_odds ?? '—'} · ${L('ui.price_status')}: ${L('price_state.' + c.price_status) || c.price_status}<br>` +
        `${L('lifecycle.' + c.candidate_status) || c.candidate_status}${blockers ? ' · ' + blockers : ''}<br>` +
        `${L('ui.main_risk')}: ${L('risk.LARGE_MARKET_DISAGREEMENT')}<br>` +
        `<span class="muted" style="font-size:11px">código: ${c.selection_code} · edge ${c.adjusted_edge_pp ?? '—'} · EV ${c.adjusted_ev ?? '—'} · quality ${c.quality ?? '—'} · grupos ${c.verified_groups ?? '—'} · GP ${c.gp_probability ?? '—'} vs consenso ${c.consensus_probability ?? '—'} · ${c.sportsbook || '—'}</span>` +
        `<div class="formrow" style="margin-top:6px">${approveBtn}<button class="ghost" onclick="candReject('${c.candidate_id}')">${L('ui.reject')}</button><button class="ghost" onclick="loadCandidates('${bodySel || '#candidateBody'}')">${L('ui.refresh')}</button></div></div>`;
    }).join('');
    el.innerHTML = langSel + `<div class="muted" style="margin-bottom:6px">${I18N.locale === 'en' ? 'Pending approval' : 'Por aprobar'}: ${visible.length} · ${convOn ? '<span style="color:var(--accent)">conversión on</span>' : 'conversión off'}</div>` + rows +
      `<div class="muted" style="font-size:11px;margin-top:6px">${L('ui.disclaimer')} ${L('ui.approve_warning')}</div>`;
  } catch { el.innerHTML = '<span class="warn">Error de red.</span>'; }
}
function setLang(l, bodySel) {
  I18N.setLocale(l);
  // Superficies admin/internas (cuando están montadas) se recargan como antes.
  if ($('#valCandBody')) loadCandidates('#valCandBody');
  if ($('#candidateBody')) loadCandidates('#candidateBody');
  if ($('#picksBody')) loadApprovedPicks();
  if ($('#valPicksBody')) loadApprovedPicks('#valPicksBody');
  if ($('#shadowObsBody')) loadShadowObservatory();
  // §16: el toggle debe aplicar en TODAS las superficies, no solo la activa. Las estáticas (teams/matches/
  // groups/bracket/evo/following/alerts/record/admin) se construyen una vez en renderAll() y switchTab NO las
  // re-renderiza → hay que reconstruirlas acá. Las dinámicas (sim/methodology/detalle/perf/value/picks) se
  // re-renderizan al navegar, pero la ACTIVA también se refresca para verla traducida al instante.
  try {
    renderHeader();
    if (STATE && STATE.teaser) { renderTeaser(); return; }
    if (STATE) {
      renderAll();                 // reconstruye todas las superficies estáticas en el idioma nuevo
      const cur = currentTab();
      if (cur === 'sim') renderSim();
      else if (cur === 'methodology') renderMethodology();
      else if (cur === 'match' && CUR_MATCH) renderMatchDetail(CUR_MATCH);
      else if (cur === 'team' && CUR_TEAM) renderTeamDetail(CUR_TEAM);
      else if (cur === 'perf' && USER) loadPerf();
      else if (cur === 'value' && USER) loadValue();
      else if (cur === 'picks' && USER) loadPicks();
      else if (cur === 'registry' && USER) loadRegistry();
      // arb se recarga dentro de renderAll() si es la pestaña activa
    }
  } catch (e) { /* el toggle nunca debe romper la vista */ }
}
async function candReject(id) {
  const reason = prompt('Motivo del rechazo (queda registrado):', ''); if (reason == null) return;
  try { await fetch('/api/internal/value/candidates/' + id + '/reject', { method: 'POST', headers: hdrs(), body: JSON.stringify({ reason }) }); loadCandidates(); } catch {}
}
async function candApprove(id, selDisplay, odds) {
  const L = (k, a) => I18N.t(k, a);
  // Aprobación de un clic: un único sí/no con el resumen (evita clics accidentales; la Pick/Signal es inmutable).
  const summary = `${selDisplay}\n${L('ui.current_odds')}: ${odds}\n${L('market.match_result')} — ${L('period.regulation')}\n${L('ui.main_risk')}: ${L('risk.LARGE_MARKET_DISAGREEMENT')}`;
  if (!confirm(L('ui.approve_warning') + '\n\n' + summary + '\n\n' + (I18N.locale === 'en' ? 'Approve this Pick?' : '¿Aprobar esta Pick?'))) return;
  try {
    const r = await fetch('/api/internal/value/candidates/' + id + '/approve-as-pick', { method: 'POST', headers: hdrs(), body: JSON.stringify({ locale: I18N.locale, risks_displayed: ['LARGE_MARKET_DISAGREEMENT'] }) });
    const j = await r.json();
    if (r.ok) alert('✓ ' + (I18N.locale === 'en' ? 'Internal Pick created' : 'Pick interna creada') + ' (' + (j.pick_id || '').slice(0, 8) + ') + Signal ' + (j.signal_id || '').slice(0, 8) + '.');
    else alert('✗ ' + (j.error || 'error') + (j.blockers ? ': ' + j.blockers.join(', ') : ''));
    loadCandidates();
    loadApprovedPicks(); loadApprovedPicks('#valPicksBody');
  } catch { alert('Error de red'); }
}
async function loadApprovedPicks(bodySel) {
  const el = $(bodySel || '#picksBody'); if (!el) return;
  const L = (k, a) => I18N.t(k, a);
  try {
    const r = await fetch('/api/internal/picks', { headers: hdrs() });
    if (r.status === 404) { el.innerHTML = '<span class="muted">Value/Picks apagado.</span>'; return; }
    if (!r.ok) { el.innerHTML = '<span class="warn">No autorizado (' + r.status + ').</span>'; return; }
    const t = await r.json();
    if (!t.count) { el.innerHTML = `<div class="muted" style="font-size:12px">${I18N.locale === 'en' ? 'No approved Picks yet. Approve a candidate above and it will appear here.' : 'Todavía no aprobaste ninguna Pick. Aprobá un candidato arriba y aparecerá acá.'}</div>`; return; }
    const langSel = `<div class="formrow" style="margin-bottom:8px;align-items:center"><span class="muted" style="font-size:11px">${L('lang.label')}:</span>` +
      ['es', 'en'].map(l => `<button class="ghost" style="${I18N.locale === l ? 'border-color:var(--accent);color:var(--accent)' : ''}" onclick="setLang('${l}')">${l.toUpperCase()}</button>`).join('') + `</div>`;
    const rows = (t.items || []).map(pk => {
      const fbTeam = pk.outcome_code === 'AWAY' ? (pk.canonical_away_team_id || '') : (pk.canonical_home_team_id || '');
      const sel = I18N.renderSelection(pk.selection_display_model, fbTeam) || pk.selection_display || pk.selection_outcome;
      const when = pk.approval_timestamp ? new Date(pk.approval_timestamp).toLocaleString() : '';
      return `<div class="explain" style="margin:6px 0"><b>${sel}</b> · ${L('classification.strong')}<br>` +
        `<span class="muted" style="font-size:11px">${pk.event_display || ''} · ${L('market.match_result')} · ${L('period.regulation')}</span><br>` +
        `${L('ui.current_odds')}: <b>${pk.published_odds ?? '—'}</b> · ${L('ui.minimum_odds')}: ${pk.minimum_odds ?? '—'} · ${L('ui.sportsbook')}: ${pk.sportsbook || '—'}<br>` +
        `<span class="muted" style="font-size:11px">edge ${pk.adjusted_edge_pp ?? '—'} · EV ${pk.adjusted_ev ?? '—'} · GP ${pk.gp_probability ?? '—'} vs consenso ${pk.consensus_probability ?? '—'} · Pick ${(pk.pick_id || '').slice(0, 8)} · Signal ${(pk.signal_id || '').slice(0, 8)}</span><br>` +
        `<span class="muted" style="font-size:11px">${I18N.locale === 'en' ? 'approved' : 'aprobada'}: ${when} · ${pk.approving_admin || ''}</span>` +
        (pk.deep_link ? ` · <a href="${pk.deep_link}" target="_blank" rel="noopener">${L('ui.sportsbook')}</a>` : '') + `</div>`;
    }).join('');
    el.innerHTML = langSel + `<div class="muted" style="margin-bottom:6px">${I18N.locale === 'en' ? 'Approved Picks' : 'Picks aprobadas'}: ${t.count}</div>` + rows +
      `<div class="muted" style="font-size:11px;margin-top:6px">${L('ui.disclaimer')} ${I18N.locale === 'en' ? 'Internal only — not published to users.' : 'Solo interno — no se publica a los usuarios.'}</div>`;
  } catch { el.innerHTML = '<span class="warn">Error de red.</span>'; }
}
async function loadShadowObservatory() {
  const el = $('#shadowObsBody'); if (!el) return;
  const EN = I18N.locale === 'en';
  try {
    const r = await fetch('/api/internal/shadow/observatory', { headers: hdrs() });
    if (r.status === 404) { el.innerHTML = '<span class="muted">Shadow ops off.</span>'; return; }
    if (!r.ok) { el.innerHTML = '<span class="warn">No autorizado (' + r.status + ').</span>'; return; }
    const t = await r.json();
    const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
    const gvByEv = {}; (t.goal_value || []).forEach(g => { (gvByEv[g.canonical_event_id] = gvByEv[g.canonical_event_id] || []).push(g); });
    const evRows = (t.events || []).map(e => {
      const v1 = e.v1 || {}, v2 = e.v2 || {};
      const ou25 = (e.over_under || []).find(x => x.line === 2.5);
      const gv = (gvByEv[e.id] || []).find(g => g.market_id === 'TOTAL_GOALS_OVER_2_5');
      return `<div class="explain" style="margin:6px 0"><b>${e.home} vs ${e.away}</b> <span class="muted" style="font-size:11px">· ${e.context_state || ''}</span><br>` +
        `<span class="muted" style="font-size:11px">${EN ? 'home' : 'local'} V1 ${pct(v1.home)} → V2 ${pct(v2.home)} (${v2.home != null && v1.home != null ? ((v2.home - v1.home) * 100 >= 0 ? '+' : '') + ((v2.home - v1.home) * 100).toFixed(1) + 'pp' : '—'}) · unc ${e.uncertainty ?? '—'}</span><br>` +
        `<span class="muted" style="font-size:11px">${EN ? 'exp. goals' : 'goles esp.'} ${e.expected_total_goals ?? '—'} · O2.5 ${pct(ou25 && ou25.over)} · BTTS ${pct(e.btts && e.btts.yes)}${gv ? ` · ${EN ? 'value O2.5' : 'valor O2.5'}: GP ${pct(gv.gp_probability)} vs mkt ${pct(gv.market_consensus_probability)} → <b>${gv.classification}</b>` : ''}</span></div>`;
    }).join('');
    const co = t.cutover;
    const coRows = co ? co.matrix.map(d => `<span style="display:inline-block;margin:2px 6px 2px 0;font-size:11px">${d.dimension}: <b style="color:${d.status === 'PASS' ? 'var(--accent)' : d.status === 'FAIL' ? '#E5484D' : '#E0A800'}">${d.status}</b></span>`).join('') : '';
    const mRows = (t.shadow_metrics || []).map(m => `${m.model_label}/${m.subject_type}: n${m.n} Brier ${m.brier} logloss ${m.log_loss}`).join(' · ');
    const langSel = `<div class="formrow" style="margin-bottom:8px"><span class="muted" style="font-size:11px">${I18N.t('lang.label')}:</span>` +
      ['es', 'en'].map(l => `<button class="ghost" style="${I18N.locale === l ? 'border-color:var(--accent);color:var(--accent)' : ''}" onclick="setLang('${l}')">${l.toUpperCase()}</button>`).join('') + `</div>`;
    el.innerHTML = langSel +
      `<div class="muted" style="margin-bottom:6px">${EN ? 'Cutover readiness' : 'Listo para cutover'}: <b>${co ? co.recommendation : '—'}</b></div>` +
      `<div style="margin-bottom:8px">${coRows}</div>` +
      (mRows ? `<div class="muted" style="font-size:11px;margin-bottom:8px">${EN ? 'Settled shadow metrics' : 'Métricas shadow liquidadas'}: ${mRows}</div>` : '') +
      `<div class="muted" style="font-size:11px;margin-bottom:4px">${EN ? 'Upcoming events (V1 vs V2 shadow)' : 'Eventos próximos (V1 vs V2 shadow)'}: ${(t.events || []).length}</div>` + evRows +
      `<div class="muted" style="font-size:11px;margin-top:6px">${EN ? 'Internal shadow comparison only. No public exposure.' : 'Solo comparación shadow interna. Sin exposición pública.'}</div>`;
  } catch { el.innerHTML = '<span class="warn">Error de red.</span>'; }
}
async function loadTrackRecord() {
  const el = $('#trackRecordBody'); if (!el) return;
  try {
    const r = await fetch('/api/internal/metrics/track-record', { headers: hdrs() });
    if (r.status === 404) { el.innerHTML = '<span class="muted">Metrics interno apagado (METRICS_ENGINE_ENABLED off).</span>'; return; }
    if (!r.ok) { el.innerHTML = '<span class="warn">No autorizado (' + r.status + ').</span>'; return; }
    const t = await r.json();
    const c = t.cards || {}; const co = t.cohorts || {};
    const card = (k, v) => `<div class="explain" style="margin:0;text-align:center"><div class="muted" style="font-size:11px">${k}</div><b style="font-size:15px">${v}</b></div>`;
    const empty = t.sample_size === 0;
    el.innerHTML =
      `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px solid var(--line)"><span class="muted">Verified Epoch</span><b>${t.verified_epoch ? new Date(t.verified_epoch).toISOString() : '—'}</b></div>` +
      `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px solid var(--line)"><span class="muted">Señales oficiales · liquidadas elegibles · sample</span><b>${t.official_signals} · ${t.settled_eligible} · ${t.sample_size}</b></div>` +
      (empty ? `<div class="explain" style="margin:10px 0">${t.empty_state || 'Sin señales oficiales liquidadas desde el Verified Epoch.'}</div>` : '') +
      `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:10px">` +
        card('ROI teórico', c.theoretical_roi) + card('Profit (u)', c.theoretical_profit_units) + card('Brier', c.brier) + card('Log loss', c.log_loss) +
        card('CLV medio', c.avg_clv) + card('CLV+ rate', c.positive_clv_rate) + card('ECE', c.ece) + card('Sample', t.sample_size) +
      `</div>` +
      `<div class="muted" style="font-size:11px;margin-top:10px">Cohortes: oficiales ${co.ALL_OFFICIAL_SIGNALS||0} · elegibles ${co.SETTLED_ELIGIBLE||0} · abiertas ${co.OPEN||0} · retractadas ${co.RETRACTED||0} · quarantine ${co.QUARANTINED||0} · data_error ${co.DATA_ERROR||0} · void ${co.ADMINISTRATIVE_VOID||0} · CLV avail ${co.CLV_AVAILABLE||0}</div>` +
      `<div class="muted" style="font-size:11px;margin-top:4px">ROI teórico · flat 1 unit · executed_by_gp=false · público OFF. Estimaciones de un modelo estadístico, no consejo financiero.</div>`;
  } catch { el.innerHTML = '<span class="warn">Error de red.</span>'; }
}
async function loadRegistryAdmin() {
  const el = $('#registryAdminBody'); if (!el) return;
  try {
    const r = await fetch('/api/internal/registry/overview', { headers: hdrs() });
    if (r.status === 404) { el.innerHTML = '<span class="muted">Registry interno apagado (SIGNAL_REGISTRY_ENABLED off).</span>'; return; }
    if (!r.ok) { el.innerHTML = '<span class="warn">No autorizado (' + r.status + ').</span>'; return; }
    const o = await r.json();
    const h = o.health || {}; const ep = o.epoch || {};
    const sg = await fetch('/api/internal/registry/signals', { headers: hdrs() }).then(x => x.json()).catch(() => ({ items: [], signals_count: 0 }));
    const chainOk = h.audit_chain && h.audit_chain.ok;
    const row = (k, v) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;border-bottom:1px solid var(--line)"><span class="muted">${k}</span><b>${v}</b></div>`;
    const onoff = (b) => b ? '<span style="color:var(--amber)">SÍ</span>' : '<span style="color:var(--accent)">no</span>';
    // controles globales con confirmación + audit (los críticos piden frase exacta)
    const controls = `
      <div class="formrow" style="margin-top:10px;flex-wrap:wrap;gap:8px">
        ${h.writes_paused
          ? `<button class="ghost" onclick="registryControl('resume_writes','Reanudar escrituras del Registry')">▶ Reanudar writes</button>`
          : `<button class="ghost" onclick="registryControl('pause_writes','PAUSAR escrituras del Registry')">⏸ Pausar writes</button>`}
        ${h.registry_public_hidden
          ? `<button class="ghost" onclick="registryControl('show_public','Mostrar el Registry público')">👁 Mostrar público</button>`
          : `<button class="ghost" onclick="registryControl('hide_public','OCULTAR el Registry público')">🙈 Ocultar público</button>`}
        ${h.product_kill_switch
          ? `<button class="ghost" onclick="registryControl('kill_switch_off','Desactivar el kill switch del producto')">Desactivar kill switch</button>`
          : `<button class="btn" style="background:var(--amber)" onclick="registryControl('kill_switch_on','ACTIVAR el KILL SWITCH del producto (corta el Registry)')">🛑 Kill switch</button>`}
      </div>`;
    const signalsCount = sg.signals_count || 0;
    const signalsBlock = signalsCount === 0
      ? `<div class="explain" style="margin-top:10px">Aún no hay señales oficiales (chain válida y vacía). Las acciones por señal (quarantine / restore / retract / correct / data error / administrative void) quedan disponibles y se habilitarán por fila cuando exista la primera señal.</div>
         <table style="width:100%;margin-top:8px;font-size:11.5px;opacity:.6"><tr class="muted"><th align="left">signal</th><th align="left">evento</th><th align="left">publicada</th><th align="left">estado</th><th align="left">seq</th><th align="left">última acción</th><th align="left">visibilidad</th></tr><tr><td colspan="7" class="muted" style="padding:10px;text-align:center">— sin señales —</td></tr></table>`
      : `<div class="muted" style="margin-top:8px">${signalsCount} señal(es). <a onclick="loadRegistryAdmin()" style="cursor:pointer">refrescar</a></div>` +
        sg.items.map(s => `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${(s.signal_id||'').slice(0,8)}</b> · ${s.status} · ${s.visibility} · seq ${s.chain_sequence ?? '—'} <span class="muted">${s.last_admin_action||''}</span></div>`).join('');
    el.innerHTML =
      row('Registry interno', h.registry_enabled ? '<span style="color:var(--accent)">activo</span>' : 'apagado') +
      row('Registry público', h.registry_public_enabled ? 'ACTIVO' : '<span style="color:var(--accent)">apagado</span>') +
      row('Verified Epoch', ep.started_at ? new Date(ep.started_at).toISOString() : '—') +
      row('Chain', (h.chain_status === 'valid_empty' ? 'válida y vacía' : (h.chain_status || '—')) + (chainOk === true ? ' · audit ✓' : chainOk === false ? ' · audit ✗' : '')) +
      row('Signals', signalsCount) +
      row('Writes paused', onoff(h.writes_paused)) +
      row('Kill switch', onoff(h.product_kill_switch)) +
      controls +
      `<h4 style="margin:14px 0 4px">Señales</h4>` + signalsBlock +
      lifecycleBlock(h.lifecycle || {}) +
      `<div id="registryAdminMsg" class="muted" style="font-size:12px;margin-top:8px"></div>`;
  } catch (e) { el.innerHTML = '<span class="warn">Error de red.</span>'; }
}
function lifecycleBlock(lc) {
  const flag = (b) => b ? '<span style="color:var(--accent)">on</span>' : '<span class="muted">off</span>';
  const n = (v) => (v == null ? 0 : v);
  return `
    <h4 style="margin:16px 0 4px">Ciclo de vida interno</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:11.5px">
      <div class="explain" style="margin:0">
        <b>Closing</b> · scheduler ${flag(lc.closing_scheduler_enabled)}<br>
        elegibles: ${n(lc.closing_eligible)}<br>auto: ${n(lc.closing_captured_automatic)} · manual: ${n(lc.closing_captured_manual)}<br>unavailable: ${n(lc.closing_unavailable)}
      </div>
      <div class="explain" style="margin:0">
        <b>Settlement</b> · scheduler ${flag(lc.settlement_scheduler_enabled)} · result-src ${flag(lc.result_provider_wired)}<br>
        pending: ${n(lc.settlement_pending)}<br>final auto: ${n(lc.settlement_finalized_automatic)} · manual: ${n(lc.settlement_finalized_manual)}<br>unresolved: ${n(lc.settlement_unresolved)} · fixtures: ${n(lc.fixture_mappings)}
      </div>
      <div class="explain" style="margin:0">
        <b>Commitments</b> · scheduler ${flag(lc.commitment_scheduler_enabled)} · diario<br>
        count: ${n(lc.commitment_count)}<br>último root: ${lc.last_commitment_root ? '<code>' + lc.last_commitment_root + '…</code>' : '—'}<br>ext-anchor: <span class="muted">off</span>
      </div>
    </div>`;
}
async function registryControl(control, label) {
  const critical = control === 'kill_switch_on' || control === 'pause_writes' || control === 'hide_public';
  if (!confirm(label + '\n\n¿Confirmás esta acción? Queda registrada en el audit log.')) return;
  if (control === 'kill_switch_on' && prompt('Para activar el KILL SWITCH escribí exactamente: KILL') !== 'KILL') { const m = $('#registryAdminMsg'); if (m) m.textContent = 'Cancelado.'; return; }
  const reason = prompt('Motivo (queda en el audit):', '') || '';
  const m = $('#registryAdminMsg'); if (m) m.textContent = 'Aplicando…';
  try {
    const r = await fetch('/api/internal/registry/controls', { method: 'POST', headers: hdrs(), body: JSON.stringify({ control, reason }) });
    const j = await r.json();
    if (m) m.textContent = r.ok ? '✓ ' + control + ' = ' + j.enabled : '✗ ' + (j.error || 'error');
    loadRegistryAdmin();
  } catch { if (m) m.textContent = '✗ Error de red'; }
}
async function telegramTest() { await tgCall('/api/admin/telegram-test'); }
async function telegramDaily() { await tgCall('/api/admin/telegram-daily'); }
async function tgCall(url) {
  const m = $('#tgMsg'); m.textContent = 'Publicando…';
  try {
    const r = await fetch(url, { method: 'POST', headers: hdrs() });
    const j = await r.json();
    m.textContent = r.ok && j.ok ? '✓ Publicado en el canal. Revísalo en Telegram.' : '✗ ' + (j.error || 'no se pudo publicar');
  } catch { m.textContent = '✗ Error de red'; }
}
let bcastBusy = false;
async function broadcastNews(test, variant) {
  if (bcastBusy) return; // evita doble/triple envío por clics repetidos
  if (!test && !confirm('¿Enviar este email a TODOS los usuarios? Esto no se puede deshacer.')) return;
  bcastBusy = true;
  document.querySelectorAll('[onclick^="broadcastNews"]').forEach(b => b.disabled = true);
  const msg = $('#bcastMsg'); msg.textContent = test ? 'Enviando prueba…' : 'Iniciando envío…';
  const done = () => { bcastBusy = false; document.querySelectorAll('[onclick^="broadcastNews"]').forEach(b => b.disabled = false); };
  try {
    const r = await fetch('/api/admin/broadcast', { method: 'POST', headers: hdrs(), body: JSON.stringify({ test, variant }) });
    const j = await r.json();
    if (!r.ok || j.ok === false) { msg.textContent = '✗ ' + (j.error || 'error'); done(); return; }
    if (test) { msg.textContent = `✓ Prueba enviada (${j.sent}/${j.total})`; done(); return; }
    // masivo: corre en SEGUNDO PLANO. Poll del estado para mostrar progreso (no se cuelga el navegador).
    msg.textContent = `Envío iniciado en segundo plano… (${j.total} usuarios)`;
    const poll = async () => {
      try {
        const s = await (await fetch('/api/admin/broadcast', { headers: hdrs() })).json();
        if (s.running) { msg.textContent = `Enviando… ${s.sent}/${s.total}${s.failed ? ` · fallos ${s.failed}` : ''}`; setTimeout(poll, 3000); }
        else { msg.textContent = `✓ Envío completado: ${s.sent}/${s.total}${s.failed ? ` · fallos ${s.failed}` : ''}`; done(); }
      } catch { msg.textContent = 'Envío en curso en el servidor (no se pudo leer el progreso). Revisa los logs.'; done(); }
    };
    setTimeout(poll, 2500);
  } catch { msg.textContent = '✗ Error de red al iniciar'; done(); }
}

async function loadUsers() {
  let r;
  try { r = await fetch('/api/admin/users', { headers: hdrs() }); }
  catch (e) { $('#userBase').textContent = 'Error de red al cargar usuarios.'; return; }
  if (!r.ok) {
    let detail = '';
    try { const j = await r.json(); detail = j.detail || j.error || ''; } catch {}
    $('#userBase').innerHTML = `<span class="warn">Error al cargar usuarios (${r.status})${detail ? ': ' + detail : ''}.</span>` +
      (r.status === 403 ? '<br><span class="muted" style="font-size:11px">Tu sesión pudo expirar — recargá o volvé a entrar.</span>' : '');
    return;
  }
  const j = await r.json();
  const fmt = ts => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const sources = Object.entries(j.bySource || {}).sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `<span class="chip"><b style="display:inline">${n}</b> ${s}</span>`).join(' ');
  const vCount = j.verifiedCount != null ? j.verifiedCount : j.users.filter(u => u.verified !== false).length;
  const lCount = j.leadCount != null ? j.leadCount : (j.total - vCount);
  const bl = j.byLang || {}, le = j.langExplicit || {};
  $('#userBase').innerHTML = `
    <div class="formrow" style="align-items:center">
      <span style="color:var(--text)"><b>${vCount}</b> verificados · <b style="color:var(--amber)">${lCount}</b> leads <span class="muted" style="font-size:11px">(${j.total} total)</span></span>
      <button class="ghost" onclick="exportUsersCSV()">⬇ Exportar CSV</button>
    </div>
    <div class="formrow" style="gap:8px;align-items:center"><span class="muted" style="font-size:11px">IDIOMA (marketing):</span>
      <span class="chip"><b style="display:inline">${bl.es || 0}</b> 🇪🇸 Español</span>
      <span class="chip"><b style="display:inline">${bl.en || 0}</b> 🇬🇧 English</span>
      <span class="muted" style="font-size:11px">· elegido explícito: ${le.es || 0} ES / ${le.en || 0} EN · ${le.none || 0} inferido por país/def.</span>
    </div>
    <div class="muted" style="font-size:11px;margin:-2px 0 8px">Un <b style="color:var(--amber)">LEAD</b> dejó su correo y pidió el código pero no completó la verificación. Igual denota interés → posible lead de marketing. El email masivo se envía a cada uno en su idioma (columna IDIOMA).</div>
    <div class="formrow" style="gap:8px"><span class="muted" style="font-size:11px">FUENTES:</span> ${sources}</div>
    <div class="muted" style="font-size:11px;margin-bottom:8px">Comparte links con ?ref= para atribuir: gpsimulador.com/?ref=x · ?ref=ig · ?ref=wa</div>
    <table><tr><th>Email</th><th>Nombre</th><th>País</th><th>Idioma</th><th>Estado</th><th>Fuente</th><th>Registro</th><th>Última visita</th></tr>
    ${j.users.map(u => `<tr${u.verified === false ? ' style="opacity:.78"' : ''}><td>${u.email}</td><td>${u.name ? xe(u.name) : '<span class="muted">—</span>'}</td><td>${u.country || '<span class="muted">—</span>'}</td><td><b>${(u.mailLang || 'es').toUpperCase()}</b>${u.lang ? '' : '<span class="muted" style="font-size:10px"> (inf.)</span>'}</td><td>${u.verified === false ? '<span class="badge-lead">LEAD</span>' : '<span class="badge-ver">✓</span>'}</td><td><b>${u.ref}</b></td><td>${fmt(u.createdAt)}</td><td>${fmt(u.lastSeen)}</td></tr>`).join('')}
    </table>`;
  window._users = j.users;
}

function exportUsersCSV() {
  const esc = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['email', 'nombre', 'pais', 'idioma_marketing', 'idioma_elegido', 'estado', 'fuente', 'registro', 'ultima_visita', 'favoritos'],
  ...(window._users || []).map(u => [u.email, u.name || '', u.country || '', u.mailLang || 'es', u.lang || '', u.verified === false ? 'lead' : 'verificado', u.ref, new Date(u.createdAt).toISOString(), new Date(u.lastSeen).toISOString(), u.favorites])];
  const csv = rows.map(r => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'usuarios-gp-simulador.csv';
  a.click();
}

async function saveResult(isGroup) {
  const body = isGroup
    ? { matchId: $('#gMatch').value, hg: $('#gHg').value, ag: $('#gAg').value, status: $('#gStatus').value, minute: $('#gMin').value }
    : { matchId: $('#kMatch').value, home: $('#kHome').value, away: $('#kAway').value, hg: $('#kHg').value, ag: $('#kAg').value, status: $('#kStatus').value, minute: $('#kMin').value, pensHome: $('#kPens').checked };
  const r = await fetch('/api/admin/result', { method: 'POST', headers: hdrs(), body: JSON.stringify(body) });
  $('#adminMsg').textContent = r.ok ? '✓ Guardado — probabilidades recalculadas y enviadas a todos los clientes.' : '✗ ' + (await r.json()).error;
}
async function removeResult(isGroup) {
  const matchId = isGroup ? $('#gMatch').value : $('#kMatch').value;
  await fetch('/api/admin/result', { method: 'POST', headers: hdrs(), body: JSON.stringify({ matchId, remove: true }) });
  $('#adminMsg').textContent = '✓ Resultado eliminado.';
}

// ---------- REFERIDOS ----------
const REF_TIERS = [
  { n: 1, rewardKey: 'referidos.tier.amb' },
  { n: 3, rewardKey: 'referidos.tier.silver' },
  { n: 5, rewardKey: 'referidos.tier.gold' },
  { n: 10, rewardKey: 'referidos.tier.legend' },
];
const refReward = t => I18N.t(t.rewardKey);
function refLink() { return 'https://gpsimulador.com/?ref=' + ((USER && USER.refCode) || ''); }
async function renderReferidos() {
  if (!USER) return;
  // refresca refCode + contador + entitlement de beta desde el servidor (tras login USER aún no los tiene)
  try { const r = await fetch('/api/me', { headers: hdrs() }); if (r.ok) { const me = await r.json(); USER.refCode = me.refCode; USER.referrals = me.referrals; USER.beta_access = me.beta_access; USER.beta_entitlement = me.beta_entitlement; } } catch { }
  const n = USER.referrals || 0;
  const link = refLink();
  const next = REF_TIERS.find(t => t.n > n);
  const level = [...REF_TIERS].reverse().find(t => n >= t.n);
  const levelSuffix = level ? ` · ${refReward(level)}` : '';
  let html = `<div style="margin-bottom:14px"><h2 style="margin-bottom:3px">${I18N.t('referidos.title')}</h2>
    <div class="muted" style="font-size:12px">${I18N.t('referidos.subtitle')}</div></div>`;
  // panel de desbloqueo de la BETA (verificados / requeridos)
  const ent = USER.beta_entitlement || {};
  const have = ent.verified_referrals || 0, need = ent.referrals_required || 5;
  const pct = Math.min(100, Math.round(have / need * 100));
  if (USER.beta_access) {
    html += `<div class="dpanel" style="border-color:var(--border-green,rgba(24,230,163,.35));background:linear-gradient(95deg,rgba(24,230,163,.10),transparent)">
      <div class="dpanel-h"><span class="dpanel-t">⚡ ${xe(I18N.t('referidos.beta_unlocked'))}</span></div>
      <div class="muted" style="font-size:12.5px">${xe(I18N.t('referidos.beta_unlocked_note'))}</div>
      <a class="btn" style="display:inline-block;margin-top:10px;text-decoration:none" href="/x">${xe(I18N.t('referidos.beta_open'))} →</a></div>`;
  } else {
    html += `<div class="dpanel" style="border-color:var(--border-green,rgba(24,230,163,.35))">
      <div class="dpanel-h"><span class="dpanel-t">⚡ ${xe(I18N.t('referidos.beta_title'))}</span><span class="mono" style="color:var(--accent);font-weight:700">${have}/${need}</span></div>
      <div style="height:8px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden;margin:4px 0 8px"><div style="height:100%;width:${pct}%;background:var(--accent);border-radius:99px"></div></div>
      <div class="muted" style="font-size:12px">${xe(I18N.t('referidos.beta_note', { n: Math.max(0, need - have) }))}</div></div>`;
  }
  html += `<div class="ref-hero">
    <div class="ref-count">${n}</div>
    <div class="ref-count-lbl">${I18N.t(n === 1 ? 'referidos.count_lbl.one' : 'referidos.count_lbl.other', { level: levelSuffix })}</div>
    <div class="ref-next">${next ? I18N.t(next.n - n === 1 ? 'referidos.next.one' : 'referidos.next.other', { n: next.n - n, reward: refReward(next) }) : I18N.t('referidos.max_level')}</div>
  </div>`;
  html += `<div class="dpanel"><div class="dpanel-h"><span class="dpanel-t">${I18N.t('referidos.your_link')}</span></div>
    <div class="ref-linkbox"><input id="refLinkInput" readonly value="${link}"><button class="btn" onclick="copyRef(event)">${I18N.t('referidos.copy')}</button></div>
    <button class="btn-ghost" style="width:100%;margin-top:10px" onclick="shareRef()">${I18N.t('referidos.share')}</button></div>`;
  html += `<div class="dpanel"><div class="dpanel-h"><span class="dpanel-t">${I18N.t('referidos.levels')}</span></div>` +
    REF_TIERS.map(t => `<div class="ref-tier ${n >= t.n ? 'done' : ''}"><span class="ref-tier-n">${n >= t.n ? '✓' : t.n}</span><span class="ref-tier-r">${refReward(t)}</span><span class="ref-tier-goal">${I18N.t(t.n > 1 ? 'referidos.tier_goal.other' : 'referidos.tier_goal.one', { n: t.n })}</span></div>`).join('') + `</div>`;
  html += `<div class="muted" style="font-size:11.5px;text-align:center;margin-top:8px">${I18N.t('referidos.foot')}</div>`;
  $('#tab-referidos').innerHTML = html;
}
function copyRef(ev) {
  const i = $('#refLinkInput'); if (!i) return;
  i.select(); i.setSelectionRange(0, 99999);
  const done = () => { const b = ev && ev.currentTarget; if (b) { const o = b.textContent; b.textContent = I18N.t('referidos.copied'); setTimeout(() => b.textContent = o, 1500); } };
  if (navigator.clipboard) navigator.clipboard.writeText(i.value).then(done).catch(() => { try { document.execCommand('copy'); done(); } catch { } });
  else { try { document.execCommand('copy'); done(); } catch { } }
}
function shareRef() {
  const text = I18N.t('referidos.share_text');
  const url = refLink();
  if (navigator.share) { navigator.share({ title: I18N.t('referidos.share_title'), text, url }).catch(() => { }); }
  else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank');
}

// ---------- SIMULADOR: simula cualquier cruce ----------
let CUR_SIM = null;
function renderSim() {
  if (!USER) return;
  const teams = [...STATE.teams].map(t => ({ ...t, _nm: I18N.teamName(t.id, t.name) })).sort((a, b) => a._nm.localeCompare(b._nm));
  const opts = () => teams.map(t => `<option value="${t.id}">${t.flag} ${t._nm}</option>`).join('');
  $('#tab-sim').innerHTML = `
    <div style="margin-bottom:10px"><h2 style="margin-bottom:3px">${I18N.t('sim.title')}</h2>
      <div class="muted" style="font-size:12px">${I18N.t('sim.subtitle')}</div></div>
    <div class="sim-pick">
      <select id="simA" class="searchbox" style="margin:0">${opts()}</select>
      <span class="sim-vs">${I18N.t('mpage.vs')}</span>
      <select id="simB" class="searchbox" style="margin:0">${opts()}</select>
    </div>
    <div class="formrow" style="margin-top:12px"><button class="btn" style="width:100%" onclick="simulate()">${I18N.t('sim.button')}</button></div>
    <div id="simResult"></div>`;
  $('#simA').value = 'ARG'; $('#simB').value = 'ESP';
  simulate();
}
async function simulate() {
  const a = $('#simA').value, b = $('#simB').value;
  if (a === b) { $('#simResult').innerHTML = du(I18N.t('sim.pick_distinct')); return; }
  $('#simResult').innerHTML = `<div class="muted" style="padding:24px 0;text-align:center">${I18N.t('sim.analyzing')}<br><span style="font-size:11px">${I18N.t('sim.analyzing_sub')}</span></div>`;
  GPI_OPEN = false;
  try {
    const r = await fetch(`/api/h2h/deep?a=${a}&b=${b}`, { headers: hdrs() });
    if (!r.ok) { if (r.status === 401) { openLogin(); return; } throw 0; }
    CUR_SIM = await r.json();
    $('#simResult').innerHTML = simHeadlineHtml(CUR_SIM);
  } catch { $('#simResult').innerHTML = du(I18N.t('sim.failed')); }
}

// Headline del cruce: el resultado YA es v2 (GP Intelligence). Debajo, botón para el análisis integral.
function simHeadlineHtml(d) {
  const p = d.probs, base = d.base, ctx = d.context;
  const aNm = d.a.id ? I18N.teamName(d.a.id, d.a.name) : d.a.name, bNm = d.b.id ? I18N.teamName(d.b.id, d.b.name) : d.b.name;
  const moved = Math.abs(ctx.deltaA) + Math.abs(ctx.deltaB) > 2;
  // §13: el simulador usa GP Intelligence (V2 oficial). NUNCA etiquetar como "experimental"; nota honesta de hipótesis.
  const v2Label = `<div class="gpi-labelrow"><span class="gpi-explabel">${I18N.t('sim.label_gpi')}</span></div>`;
  return `
    <div class="dpanel" style="margin-top:14px">
      ${v2Label}
      <div class="sim-teams">
        <div class="sim-side"><div class="sim-flag">${d.a.flag}</div><div class="sim-name">${aNm}</div><div class="muted" style="font-size:11px">Elo ${d.a.elo}${ctx.deltaA ? ` <span class="${ctx.deltaA > 0 ? 'pgood' : 'pbad'}">${ctx.deltaA > 0 ? '+' : ''}${ctx.deltaA}</span>` : ''}</div></div>
        <div class="sim-vs2">${I18N.t('mpage.vs')}</div>
        <div class="sim-side"><div class="sim-flag">${d.b.flag}</div><div class="sim-name">${bNm}</div><div class="muted" style="font-size:11px">Elo ${d.b.elo}${ctx.deltaB ? ` <span class="${ctx.deltaB > 0 ? 'pgood' : 'pbad'}">${ctx.deltaB > 0 ? '+' : ''}${ctx.deltaB}</span>` : ''}</div></div>
      </div>
      <div class="pbar" style="margin-top:16px"><div class="ph" style="width:${p.aWin * 100}%"></div><div class="pd" style="width:${p.draw * 100}%"></div><div class="pa" style="width:${p.bWin * 100}%"></div></div>
      <div class="plabels"><span>${I18N.t('sim.prob_home', { p: pct(p.aWin) })}</span><span>${I18N.t('sim.prob_draw', { p: pct(p.draw) })}</span><span>${I18N.t('sim.prob_away', { p: pct(p.bWin) })}</span></div>
      <div class="plabels" style="margin-top:6px"><span>xG ${p.xgA.toFixed(2)}</span><span class="muted">${I18N.t('sim.likely_score', { score: p.likely })}</span><span>xG ${p.xgB.toFixed(2)}</span></div>
      ${moved ? `<div class="gpi-decomp">${I18N.t('sim.base_model', { h: pct(base.aWin, 0), d: pct(base.draw, 0), a: pct(base.bWin, 0) })} <span class="gpi-arrow">→</span> <b>${I18N.t('sim.gpi_integrates')}</b></div>` : ''}
      <div class="gpi-actions">
        <button class="btn" style="flex:1" onclick="toggleGpi()"><span id="gpiBtnTx">${I18N.t('sim.view_gpi')}</span></button>
        <button class="cta-sm" onclick="shareSim(event)" title="${I18N.t('sim.share')}">📤</button>
      </div>
      <div id="simAnalysis" class="gpi-wrap"></div>
    </div>`;
}

let GPI_OPEN = false;
function toggleGpi() {
  GPI_OPEN = !GPI_OPEN;
  const wrap = $('#simAnalysis'), tx = $('#gpiBtnTx');
  if (!GPI_OPEN) { wrap.innerHTML = ''; tx.textContent = I18N.t('sim.view_gpi'); return; }
  tx.textContent = I18N.t('sim.hide_analysis');
  wrap.innerHTML = h2hAnalysisHtml(CUR_SIM);
}

// Mapea la etiqueta del veredicto a una clase de "grade"
function verdictCls(label) {
  return ({ 'FAVORITO CLARO': 'g-strong', 'LIGERO FAVORITO': 'g-lean', 'SIN FAVORITO NETO': 'g-slight', 'CRUCE PAREJO': 'g-slight' })[label] || 'g-slight';
}
function impChip(n) {
  if (!n) return `<span class="gpi-imp flat">±0</span>`;
  return `<span class="gpi-imp ${n > 0 ? 'up' : 'down'}">${n > 0 ? '↑ +' : '↓ '}${n}</span>`;
}

// ANÁLISIS INTEGRAL — mismo lenguaje visual que la página de partido (dpanel), data-driven.
function h2hAnalysisHtml(d) {
  const an = d.analysis, h = an.headline, dec = an.decomposition, mc = an.monteCarlo;
  let html = '';
  // Sprint 8.1 §17: en móvil el análisis es largo. Con el flag, las secciones de detalle se colapsan en
  // acordeones accesibles (Veredicto/Probabilidades/V1-V2/Factores/Riesgos quedan visibles). Flag off → todo expandido.
  const acc = (label, p) => (USER && USER.uiFlags && USER.uiFlags.gpIntelligenceLabels)
    ? `<details class="gpi-acc"><summary>${label}</summary>${p}</details>` : p;
  const aNm = d.a.id ? I18N.teamName(d.a.id, d.a.name) : d.a.name, bNm = d.b.id ? I18N.teamName(d.b.id, d.b.name) : d.b.name;

  // 1) VEREDICTO — confianza del MODELO y calidad de DATOS son conceptos separados (B9)
  const mConf = h.modelConfidence ? h.modelConfidence.level : '—';
  const dQual = h.dataQuality ? h.dataQuality.level : '—';
  html += panel(I18N.t('sim.verdict_title'), '', `
    <div class="gptbox">
      <div class="gpt-top"><span class="grade ${verdictCls(h.verdictLabel)}">${h.verdictLabel}</span>
        <span class="gpt-conf">${I18N.t('sim.model_confidence', { v: mConf })}</span><span class="gpt-conf">${I18N.t('sim.data_quality', { v: dQual })}</span></div>
      <div class="gpt-sum" style="margin-top:8px">${h.verdict}</div>
    </div>`);

  // 2) DESCOMPOSICIÓN V1 control → V2 challenger + delta explícito (B1)
  const decRow = (lbl, line, strong) => `
    <div class="gpi-decrow">
      <span class="gpi-decl">${lbl}</span>
      <div class="pbar" style="margin:0;flex:1"><div class="ph" style="width:${line.aWin * 100}%"></div><div class="pd" style="width:${line.draw * 100}%"></div><div class="pa" style="width:${line.bWin * 100}%"></div></div>
      <span class="gpi-decv ${strong ? 'on' : ''}">${pct(line.aWin, 0)}·${pct(line.draw, 0)}·${pct(line.bWin, 0)}</span>
    </div>`;
  const dpp = dec.deltaPp || { aWin: 0, draw: 0, bWin: 0 };
  const ppChip = v => `<span class="gpi-imp ${v > 0 ? 'up' : v < 0 ? 'down' : 'flat'}">${v > 0 ? '+' : ''}${v.toFixed(1)}pp</span>`;
  html += panel(I18N.t('sim.decomp_title'), I18N.t('sim.decomp_sub'), `
    ${decRow(I18N.t('sim.initial_prob'), dec.baseLine, false)}
    ${decRow(I18N.t('sim.gp_final_prob'), dec.v2Line, true)}
    <div class="gpi-deltas">
      <span>${d.a.flag} ${aNm}: ${ppChip(dpp.aWin)}</span>
      <span>${I18N.t('sim.draw')}: ${ppChip(dpp.draw)}</span>
      <span>${d.b.flag} ${bNm}: ${ppChip(dpp.bWin)}</span>
    </div>
    <div class="gpi-deltas">
      <span>${I18N.t('sim.elo_context', { team: aNm })}${impChip(dec.deltaA)}</span>
      <span>${I18N.t('sim.elo_context', { team: bNm })}${impChip(dec.deltaB)}</span>
    </div>
    <div class="gpi-note">${I18N.t('sim.decomp_note')}</div>`);

  // 3) FACTORES CLAVE (ambos equipos, ordenados por peso; excluidos atenuados)
  if (an.factors && an.factors.length) {
    const rows = an.factors.map(f => `
      <div class="gpi-factor${f.included ? '' : ' gpi-excluded'}">
        <div class="gpi-fac-h"><span class="gpi-fac-team">${f.flag} ${f.team}</span>${f.included ? impChip(f.eloImpact) : `<span class="gpi-imp flat">${I18N.t('sim.factor_omitted')}</span>`}</div>
        <div class="gpi-fac-l">${f.label}${f.group ? ` · <span class="gpi-grp">${f.group}</span>` : ''}</div>
        <div class="gpi-fac-d">${f.detail}${f.included ? '' : ` · <span class="pbad">${I18N.t('sim.factor_excluded', { reason: f.exclusionReason })}</span>`}</div>
      </div>`).join('');
    html += panel(I18N.t('sim.factors_title'), an.factors.length + '', `<div class="gpi-factors">${rows}</div>`);
  }

  // 4) MONTE CARLO — distribución del cruce
  const maxP = Math.max(...mc.topScores.map(s => s.p));
  const scoreBars = mc.topScores.map(s => `
    <div class="gpi-sc">
      <span class="gpi-sc-s">${s.score}</span>
      <div class="gpi-sc-bar"><div style="width:${(s.p / maxP) * 100}%"></div></div>
      <span class="gpi-sc-p">${pct(s.p, 0)}</span>
    </div>`).join('');
  html += acc(I18N.t('sim.mc_acc'), panel(I18N.t('sim.mc_title'), I18N.t('sim.mc_sub'), `
    <div class="gpi-sc-grid">${scoreBars}</div>
    <div class="gpi-mc-stats">
      <div class="gpi-stat"><span class="v">${pct(mc.over25, 0)}</span><span class="l">${I18N.t('sim.over25')}</span></div>
      <div class="gpi-stat"><span class="v">${pct(mc.btts, 0)}</span><span class="l">${I18N.t('sim.btts')}</span></div>
      <div class="gpi-stat"><span class="v">${mc.avgTotal.toFixed(2)}</span><span class="l">${I18N.t('sim.goals_per_match')}</span></div>
      <div class="gpi-stat"><span class="v">${mc.avgMargin.toFixed(2)}</span><span class="l">${I18N.t('sim.avg_margin')}</span></div>
    </div>
    <div class="gpi-note">${an.monteCarlo.narrative}</div>`));

  // 4b) GOLES Y TOTALES — mercados accionables para apostadores (Over/Under, total, distribución por equipo)
  if (d.goals) {
    const g = d.goals;
    const ouRow = (label, over) => `
      <div class="gpi-ou">
        <span class="gpi-ou-l">${label}</span>
        <div class="gpi-ou-split"><div class="gpi-ou-fill" style="width:${over * 100}%"></div><span class="gpi-ou-o">${I18N.t('sim.over', { p: pct(over, 0) })}</span><span class="gpi-ou-u">${I18N.t('sim.under', { p: pct(1 - over, 0) })}</span></div>
      </div>`;
    const teamGoals = (dist, flag, name) => `
      <div class="gpi-tg">
        <div class="gpi-tg-h">${flag} ${name}</div>
        <div class="gpi-tg-cells">
          ${[['0', dist.g0], ['1', dist.g1], ['2', dist.g2], ['3+', dist.g3]].map(([n, p]) => `<div class="gpi-tg-c"><span class="n">${n}</span><span class="p">${pct(p, 0)}</span></div>`).join('')}
        </div>
      </div>`;
    html += acc(I18N.t('sim.goals_acc'), panel(I18N.t('sim.goals_title'), I18N.t('sim.goals_sub'), `
      <div class="gpi-ou-wrap">
        ${ouRow(I18N.t('sim.goals_n', { n: '1.5' }), g.over15)}
        ${ouRow(I18N.t('sim.goals_n', { n: '2.5' }), g.over25)}
        ${ouRow(I18N.t('sim.goals_n', { n: '3.5' }), g.over35)}
      </div>
      <div class="gpi-mc-stats" style="margin-top:13px">
        <div class="gpi-stat"><span class="v">${g.mostLikelyTotal}</span><span class="l">${I18N.t('sim.most_likely_total')}</span></div>
        <div class="gpi-stat"><span class="v">${pct(g.mostLikelyTotalP, 0)}</span><span class="l">${I18N.t('sim.total_prob')}</span></div>
        <div class="gpi-stat"><span class="v">${g.avgTotal.toFixed(2)}</span><span class="l">${I18N.t('sim.expected_goals')}</span></div>
        <div class="gpi-stat"><span class="v">${pct(g.btts, 0)}</span><span class="l">${I18N.t('sim.btts')}</span></div>
      </div>
      <div class="dsub" style="margin-top:14px">${I18N.t('sim.goals_by_team')}</div>
      ${teamGoals(g.teamA, d.a.flag, aNm)}
      ${teamGoals(g.teamB, d.b.flag, bNm)}
      <div class="gpi-note">${d.context.goalModel ? I18N.t('sim.goal_model', { model: d.context.goalModel }) : ''}xG ${d.probs.xgA.toFixed(2)} – ${d.probs.xgB.toFixed(2)}. ${I18N.t('sim.goals_dist_note')}</div>`));
  }

  // 5) LECTURA TÁCTICA (si hay editorial). La nota puede ser texto o {style,strengths[],risks[]}.
  const tacHtml = (t, team, flag) => {
    if (!t) return '';
    if (typeof t === 'string') return `<div class="gpi-tac"><b>${flag} ${team}:</b> ${t}</div>`;
    const tags = (arr, cls) => (arr && arr.length) ? `<div class="gpi-tac-tags">${arr.map(x => `<span class="gpi-tag ${cls}">${x}</span>`).join('')}</div>` : '';
    return `<div class="gpi-tac"><b>${flag} ${team}:</b> ${t.style || ''}
      ${tags(t.strengths, 'up')}${tags(t.risks, 'down')}</div>`;
  };
  const tA = tacHtml(d.tactical && d.tactical.a, aNm, d.a.flag), tB = tacHtml(d.tactical && d.tactical.b, bNm, d.b.flag);
  if (tA || tB) html += acc(I18N.t('sim.tactical_acc'), panel(I18N.t('sim.tactical_title'), '', tA + tB));

  // 6) INSIGHTS determinísticos (anclados a métricas) + qué cambiaría
  const insights = an.insights || [];
  const sevCls = s => s === 'warn' ? 'down' : 'up';
  html += panel(I18N.t('sim.read_risks_title'), '', `
    <div class="dsub">${I18N.t('sim.to_watch')}</div>
    <ul class="gpt-drivers">${insights.map(i => `<li><span class="gpi-ins ${sevCls(i.severity)}">${i.text}</span></li>`).join('')}</ul>
    <div class="dsub" style="margin-top:10px">${I18N.t('sim.what_changes')}</div>
    <ul class="gpt-drivers">${an.whatChanges.map(x => `<li>${x}</li>`).join('')}</ul>`);

  // 7) TRAZABILIDAD — "Cómo llegó GP a este resultado" (colapsable, B11)
  html += traceabilityHtml(d);

  html += `<div class="disc">${I18N.t('sim.disclaimer')}</div>`;
  return html;
}

// Panel colapsable de trazabilidad: modelo base, contexto, resultado y calidad de datos (sin secretos).
function traceabilityHtml(d) {
  const dec = d.analysis.decomposition, ctx = d.context;
  const aNm = d.a.id ? I18N.teamName(d.a.id, d.a.name) : d.a.name, bNm = d.b.id ? I18N.teamName(d.b.id, d.b.name) : d.b.name;
  const factorLines = side => (side || []).filter(f => f.axis === 'elo' && f.factorCode !== 'NO_CONTEXT').map(f =>
    `<div class="gpi-tr-row"><span>${labelForFactor(f.factorCode)}</span><span>${f.included ? (f.cappedContribution > 0 ? '+' : '') + f.cappedContribution + ' Elo' : `<span class="pbad">${I18N.t('sim.trace_omitted', { reason: f.exclusionReason })}</span>`}</span></div>`).join('');
  return `<details class="gpi-trace">
    <summary>${I18N.t('sim.trace_summary')}</summary>
    <div class="gpi-tr-body">
      <div class="gpi-tr-h">${I18N.t('sim.trace_initial')}</div>
      <div class="gpi-tr-row"><span>${d.a.flag} ${I18N.t('sim.trace_elo_base', { team: aNm })}</span><span>${d.a.elo}</span></div>
      <div class="gpi-tr-row"><span>${d.b.flag} ${I18N.t('sim.trace_elo_base', { team: bNm })}</span><span>${d.b.elo}</span></div>
      <div class="gpi-tr-row"><span>${I18N.t('sim.trace_initial')}</span><span>${pct(dec.baseLine.aWin, 1)} · ${pct(dec.baseLine.draw, 1)} · ${pct(dec.baseLine.bWin, 1)}</span></div>
      <div class="gpi-tr-h">${I18N.t('sim.trace_context', { team: aNm })}</div>${factorLines(ctx.factorsA)}
      <div class="gpi-tr-row strong"><span>${I18N.t('sim.trace_total_adj', { team: aNm })}</span><span>${dec.deltaA > 0 ? '+' : ''}${dec.deltaA} Elo</span></div>
      <div class="gpi-tr-h">${I18N.t('sim.trace_context', { team: bNm })}</div>${factorLines(ctx.factorsB)}
      <div class="gpi-tr-row strong"><span>${I18N.t('sim.trace_total_adj', { team: bNm })}</span><span>${dec.deltaB > 0 ? '+' : ''}${dec.deltaB} Elo</span></div>
      <div class="gpi-tr-h">${I18N.t('sim.trace_gp_final')}</div>
      <div class="gpi-tr-row"><span>${I18N.t('sim.trace_adj_elo')}</span><span>${d.a.elo + dec.deltaA} · ${d.b.elo + dec.deltaB}</span></div>
      <div class="gpi-tr-row"><span>${I18N.t('sim.trace_gp_final')}</span><span>${pct(dec.v2Line.aWin, 1)} · ${pct(dec.v2Line.draw, 1)} · ${pct(dec.v2Line.bWin, 1)}</span></div>
    </div>
  </details>`;
}
function labelForFactor(code) {
  const k = 'factor.' + code; const v = I18N.t(k);
  if (v !== k) return v;
  return ({ FORM: 'Forma reciente', STREAK: 'Racha', SOLIDITY: 'Solidez/fragilidad', SQUAD_QUALITY: 'Calidad de plantilla', AVAILABILITY: 'Bajas y dudas', REST: 'Descanso/carga' })[code] || code;
}

function shareSim(ev) {
  if (!CUR_SIM) return; const d = CUR_SIM, p = d.probs;
  const aNm = d.a.id ? I18N.teamName(d.a.id, d.a.name) : d.a.name, bNm = d.b.id ? I18N.teamName(d.b.id, d.b.name) : d.b.name;
  const txt = I18N.t('sim.share_text', {
    aFlag: d.a.flag, bFlag: d.b.flag, a: aNm, b: bNm,
    pa: pct(p.aWin), pd: pct(p.draw), pb: pct(p.bWin), score: p.likely,
  });
  shareOp(ev, txt);
}

// ---------- LOGIN ----------
function openLogin() {
  if (USER) {
    openModal(`<h2>${I18N.t('login.session')}</h2><p>${USER.email}${USER.isAdmin ? ` · <span class="pgood">${I18N.t('login.admin')}</span>` : ''}</p>
      <div class="formrow"><button class="btn" onclick="logout()">${I18N.t('login.logout')}</button></div>`);
    return;
  }
  openModal(`<h2>${I18N.t('login.title')}</h2>
    <p class="muted">${I18N.t('login.subtitle')}</p>
    <div class="formrow"><input id="loginEmail" type="email" placeholder="${I18N.t('login.email_ph')}" style="flex:1">
    <button class="btn" onclick="requestCode()">${I18N.t('login.send_code')}</button></div>
    <div id="loginStep2"></div><div id="loginMsg" class="warn"></div>`);
}
async function requestCode() {
  const email = $('#loginEmail').value.trim();
  const r = await fetch('/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const j = await r.json();
  if (!r.ok) { $('#loginMsg').textContent = j.error; return; }
  $('#loginStep2').innerHTML = `
    ${j.sent
      ? `<p style="color:var(--accent)">${I18N.t('login.sent', { email: $('#loginEmail').value.trim() })}<br>
         <span class="muted">${I18N.t('login.sent_check')}</span></p>`
      : `<p class="warn">${I18N.t('login.demo_code', { code: j.demoCode })}</p>`}
    <div class="formrow"><input id="loginCode" placeholder="${I18N.t('login.code_ph')}" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
    <button class="btn" onclick="verifyCode()">${I18N.t('login.verify')}</button></div>`;
  setTimeout(() => { const c = $('#loginCode'); if (c) c.focus(); }, 100);
}
async function verifyCode() {
  const r = await fetch('/api/auth/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: $('#loginEmail').value.trim(), code: $('#loginCode').value.trim(),
      ref: localStorage.getItem('wc_ref') || undefined,
    }),
  });
  const j = await r.json();
  if (!r.ok) { $('#loginMsg').textContent = j.error; return; }
  localStorage.setItem('wc_token', j.token);
  ARB = null; // fuerza recargar Oportunidades en este login (evita que quede el candado del teaser)
  await loadMe();            // trae el USER completo (incl. beta_access) y redirige a /x si el usuario tiene acceso
  if (BETA_REDIRECT) return; // ya navega a la plataforma nueva
  closeModal(); await loadState(); switchTab('arb'); gotoFromUrl();
  if (currentTab() === 'arb' && !ARB) loadArb(); // garantía extra: cargar arb aunque el estado venga raro
}
async function logout() { localStorage.removeItem('wc_token'); USER = null; ARB = null; closeAvatarMenu(); closeSheet(); renderHeader(); await loadState(); switchTab('teams'); }

// ---------- modal / tabs / SSE ----------
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').style.display = 'flex'; }
function closeModal() { $('#modal').style.display = 'none'; }

// Perfil: nombre + país + idioma. El idioma segmenta el marketing por correo; el país personaliza/enriquece.
// Lista COMPLETA de países (ISO 3166-1 alpha-2); el nombre se localiza con Intl.DisplayNames según el idioma.
const COUNTRY_CODES = 'AF AL DE AD AO AI AQ AG SA DZ AR AM AW AU AT AZ BS BD BB BH BE BZ BJ BM BY BO BA BW BR BN BG BF BI BT CV KH CM CA QA TD CL CN CY CO KM CG CD KP KR CI CR HR CU CW DK DM EC EG SV AE ER SK SI ES US EE ET PH FI FJ FR GA GM GE GH GI GD GR GL GP GU GT GF GG GN GQ GW GY HT HN HK HU IN ID IQ IR IE IS IM IL IT JM JP JE JO KZ KE KG KI KW LA LS LV LB LR LY LI LT LU MO MK MG MY MW MV ML MT MA MQ MU MR YT MX FM MD MC MN ME MS MZ MM NA NR NP NI NE NG NO NC NZ OM NL PK PW PA PG PY PE PF PL PT PR GB CF CZ DO RE RW RO RU WS AS KN SM PM VC SH LC ST SN RS SC SL SG SX SY SO LK SZ ZA SD SS SE CH SR TH TW TZ TJ IO TF PS TL TG TO TT TN TM TC TR TV UA UG UY UZ VU VA VE VN VG VI WF YE DJ ZM ZW'.split(' ');
function countryOptions(selected, otherLabel) {
  let dn; try { dn = new Intl.DisplayNames([I18N.locale, 'es'], { type: 'region' }); } catch (e) { dn = null; }
  const list = COUNTRY_CODES.map(c => [c, (dn && dn.of(c)) || c]).sort((a, b) => a[1].localeCompare(b[1], I18N.locale));
  list.push(['XX', otherLabel]);
  return list.map(c => `<option value="${c[0]}"${selected === c[0] ? ' selected' : ''}>${xe(c[1])}</option>`).join('');
}
function openProfile() {
  closeAvatarMenu();
  const u = USER || {};
  const lang = u.lang === 'en' ? 'en' : (u.lang === 'es' ? 'es' : I18N.locale);
  const opts = countryOptions(u.country, I18N.t('profile.other'));
  openModal(`<div class="prof">
    <h3 style="margin:0 0 4px">${xe(I18N.t('profile.title'))}</h3>
    <p class="muted" style="font-size:13px;margin:0 0 16px">${xe(I18N.t('profile.intro'))}</p>
    <label class="prof-l">${xe(I18N.t('profile.name'))}</label>
    <input id="profName" class="prof-in" maxlength="60" placeholder="${xe(I18N.t('profile.name_ph'))}" value="${xe(u.name || '')}">
    <label class="prof-l">${xe(I18N.t('profile.country'))}</label>
    <select id="profCountry" class="prof-in"><option value="">${xe(I18N.t('profile.country_ph'))}</option>${opts}</select>
    <label class="prof-l">${xe(I18N.t('profile.language'))}</label>
    <select id="profLang" class="prof-in"><option value="es"${lang === 'es' ? ' selected' : ''}>Español</option><option value="en"${lang === 'en' ? ' selected' : ''}>English</option></select>
    <div id="profMsg" class="muted" style="font-size:12px;min-height:16px;margin:8px 0 0"></div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" onclick="saveProfile()">${xe(I18N.t('profile.save'))}</button><button class="btn-ghost" onclick="closeModal()">${xe(I18N.t('profile.cancel'))}</button></div>
  </div>`);
}
async function saveProfile() {
  const name = ($('#profName').value || '').trim();
  const country = $('#profCountry').value || '';
  const lang = $('#profLang').value === 'en' ? 'en' : 'es';
  const msg = $('#profMsg'); msg.textContent = I18N.t('profile.saving');
  try {
    const r = await fetch('/api/me/profile', { method: 'PUT', headers: hdrs(), body: JSON.stringify({ name, country, lang }) });
    const j = await r.json();
    if (!r.ok) { msg.textContent = '✗ ' + (j.error || 'error'); return; }
    if (USER) { USER.name = j.name; USER.country = j.country; USER.lang = j.lang; }
    if (lang !== I18N.locale) setLang(lang);
    msg.textContent = '✓ ' + I18N.t('profile.saved');
    setTimeout(closeModal, 700);
  } catch (e) { msg.textContent = '✗ ' + I18N.t('profile.neterr'); }
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

function notifyUpdate(reason, ts) {
  const b = $('#banner');
  b.textContent = `⚡ Probabilidades actualizadas en tiempo real (${reason}) · ${new Date(ts).toLocaleTimeString()}`;
  b.style.display = '';
  setTimeout(() => b.style.display = 'none', 6000);
}

// Tiempo real: SSE con fallback automático a polling (túneles/proxies que bufferean streams)
let pollTimer = null, lastVersion = null;
// §33-34: con operationalStates, el badge refleja la frescura real (no siempre "LIVE"). Flag off → como hoy.
function setLive(on, stale) {
  const p = $('#livePill'); if (!p) return;
  p.classList.toggle('on', on && !stale);
  if (USER && USER.uiFlags && USER.uiFlags.operationalStates) {
    p.classList.toggle('stale', !!(on && stale));
    const label = !on ? 'SIN CONEXIÓN' : stale ? 'DATOS RETRASADOS' : 'DATOS LIVE';
    p.innerHTML = `<span class="lp-dot"></span>${label}`;
    const tw = $('#tickerWrap'); if (tw) tw.classList.toggle('stale', !!(on && stale));
  }
}
function startPolling() {
  if (pollTimer) return;
  setLive(true);
  pollTimer = setInterval(async () => {
    try {
      const v = await (await fetch('/api/version')).json();
      if (lastVersion && v.sim !== lastVersion.sim) {
        await loadState();
        if ($('#tab-arb').classList.contains('active')) loadArb();
        if (currentTab() === 'match' && CUR_MATCH) refreshMatch(CUR_MATCH.id);
        notifyUpdate('nuevo resultado', v.sim);
      } else if (lastVersion && v.markets !== lastVersion.markets) {
        if ($('#tab-arb').classList.contains('active')) loadArb();
        if (currentTab() === 'match' && CUR_MATCH) refreshMatch(CUR_MATCH.id);
      }
      lastVersion = v;
      // §33-34: frescura real de mercados — si no se actualizan en >3 min, el badge deja de decir "LIVE".
      const stale = !!(v.markets && (Date.now() - v.markets > 180000));
      setLive(true, stale);
    } catch { setLive(false); }
  }, 10000);
  fetch('/api/version').then(r => r.json()).then(v => lastVersion = v).catch(() => { });
}

function connectSSE() {
  let gotHello = false;
  const es = new EventSource('/api/stream');
  const watchdog = setTimeout(() => { if (!gotHello) { es.close(); startPolling(); } }, 8000);
  es.addEventListener('hello', () => { gotHello = true; clearTimeout(watchdog); setLive(true); });
  es.addEventListener('update', async e => {
    const d = JSON.parse(e.data);
    await loadState();
    if ($('#tab-arb').classList.contains('active')) loadArb();
    if (currentTab() === 'match' && CUR_MATCH) refreshMatch(CUR_MATCH.id); // refresca partido abierto al instante
    notifyUpdate(d.reason, d.ts);
  });
  es.addEventListener('markets', () => {
    if ($('#tab-arb').classList.contains('active')) loadArb();
    if (currentTab() === 'match' && CUR_MATCH) refreshMatch(CUR_MATCH.id);
  });
  es.onerror = () => {
    clearTimeout(watchdog);
    es.close();
    setLive(false);
    gotHello ? setTimeout(connectSSE, 5000) : startPolling();
  };
}

// atribución de fuente: ?ref=x / ig / wa / share — first-touch
(() => {
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && !localStorage.getItem('wc_ref')) localStorage.setItem('wc_ref', ref.slice(0, 24));
})();

// compartir oportunidades (Web Share API con fallback a WhatsApp)
async function shareOp(ev, text) {
  ev.preventDefault(); ev.stopPropagation();
  const url = 'https://gpsimulador.com/?ref=share';
  if (navigator.share) {
    try {
      await navigator.share({ title: 'GP Simulador del Mundial', text, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // el usuario cerró el menú: no es error
      // cualquier otra falla cae a WhatsApp
    }
  }
  window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank');
}

// ============================================================================
// SPRINT 4 — Oportunidades ejecutables (capa de producto). Mobile-first.
// "Simple en la superficie, riguroso al profundizar." Nunca promete ganancia garantizada.
// ============================================================================
let EXEC = { items: null, country: localStorage.getItem('xo_country') || '', timer: null, sort: 'net_roi', filters: {} };
const xe = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const XO_DISCLAIMER = 'Estimación basada en precios y profundidad observados. Las condiciones pueden cambiar antes de completar ambas operaciones. Verifica fees, reglas y elegibilidad directamente con cada plataforma.';
const COUNTRIES = [['', 'Selecciona país…'], ['MX', 'México'], ['CO', 'Colombia'], ['AR', 'Argentina'], ['CL', 'Chile'], ['PE', 'Perú'], ['ES', 'España'], ['US', 'Estados Unidos'], ['BR', 'Brasil'], ['UY', 'Uruguay'], ['OT', 'Otro']];

function clearExecTimer() { if (EXEC.timer) { clearInterval(EXEC.timer); EXEC.timer = null; } }
function xoStatusPill(st) {
  const map = { ACTIVE: ['Activa', 'xo-st-active'], VERIFYING: ['Verificando…', 'xo-st-verifying'], AGING: ['Envejeciendo', 'xo-st-aging'], EXPIRED: ['Expirada', 'xo-st-expired'], PAUSED: ['Pausada', 'xo-st-paused'], WITHDRAWN: ['Retirada', 'xo-st-paused'] };
  const [t, c] = map[st] || ['—', 'xo-st-paused'];
  return `<span class="xo-pill ${c}">${t}</span>`;
}
function xoBadge(b) { return `<span class="xo-badge ${b === 'PURE ARB' ? 'xo-b-pure' : 'xo-b-exec'}">${xe(b)}</span>`; }
function fmtAge(s) { if (s == null) return '—'; if (s < 60) return 'hace ' + s + 's'; const m = Math.floor(s / 60); return 'hace ' + m + ' min'; }

async function loadExecOpps() {
  clearExecTimer();
  const root = $('#tab-opex');
  root.innerHTML = `
    <div class="sec-head"><h3><span class="dot" style="background:var(--accent)"></span>Oportunidades ejecutables</h3>
      <span class="sec-badge">experimental</span></div>
    <div class="explain">Arbitraje ejecutable <b>estimado</b> entre plataformas. Margen neto estimado, sujeto a precio, profundidad, fees, elegibilidad y ejecución. <b>No</b> es ganancia garantizada.</div>
    ${USER.isAdmin ? '<div id="xoAdmin"></div>' : ''}
    <div id="xoFilters"></div>
    <div id="xoList"><div class="du">Cargando oportunidades verificadas…</div></div>
    <div class="xo-foot">${xe(XO_DISCLAIMER)} · GP Simulador no acepta apuestas, no custodia fondos y no ejecuta operaciones.</div>`;
  renderExecFilters();
  if (USER.isAdmin) loadExecAdmin();
  if (!USER.execPublic) { $('#xoList').innerHTML = du('La vista pública está en preparación. Como administrador puedes revisar y publicar oportunidades arriba.'); return; }
  try {
    const q = EXEC.country ? '?country=' + encodeURIComponent(EXEC.country) : '';
    const r = await fetch('/api/executable-opportunities' + q, { headers: hdrs() }).then(x => x.json());
    EXEC.items = (r && r.items) || [];
    renderExecList();
    EXEC.timer = setInterval(tickExecAges, 1000);
  } catch (e) { $('#xoList').innerHTML = du('No se pudieron cargar las oportunidades. Intenta de nuevo.'); }
}

function renderExecFilters() {
  const f = EXEC.filters;
  const countrySel = `<select class="xo-sel" onchange="setExecCountry(this.value)">${COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === EXEC.country ? 'selected' : ''}>${xe(n)}</option>`).join('')}</select>`;
  $('#xoFilters').innerHTML = `
    <div class="xo-filters">
      <button class="gchip ${!f.cls ? 'active' : ''}" onclick="execFilter('cls','')">Todas</button>
      <button class="gchip ${f.cls === 'pure_arb' ? 'active' : ''}" onclick="execFilter('cls','pure_arb')">Pure Arb</button>
      <button class="gchip ${f.cls === 'execution_sensitive' ? 'active' : ''}" onclick="execFilter('cls','execution_sensitive')">Sensible</button>
      <button class="gchip ${f.rules ? 'active' : ''}" onclick="execFilter('rules',!${!!f.rules})">Reglas confirmadas</button>
      <select class="xo-sel" onchange="EXEC.sort=this.value;renderExecList()">
        <option value="net_roi">Orden: Net ROI</option>
        <option value="profit">Beneficio máximo</option>
        <option value="recent">Más reciente</option>
        <option value="confidence">Confianza</option>
      </select>
      <span class="xo-geo">🌎 ${countrySel}</span>
    </div>`;
}
function execFilter(k, v) { EXEC.filters[k] = v; renderExecFilters(); renderExecList(); }
function setExecCountry(c) { EXEC.country = c; localStorage.setItem('xo_country', c); loadExecOpps(); }

function filteredSorted() {
  let items = (EXEC.items || []).slice();
  const f = EXEC.filters;
  if (f.cls) items = items.filter(x => x.classification === f.cls);
  if (f.rules) items = items.filter(x => x.rules_confirmed);
  const num = v => parseFloat(String(v || '').replace(/[^0-9.\-]/g, '')) || 0;
  if (EXEC.sort === 'net_roi') items.sort((a, b) => num(b.net_margin_pct) - num(a.net_margin_pct));
  else if (EXEC.sort === 'profit') items.sort((a, b) => num(b.estimated_net_profit_at_max_display) - num(a.estimated_net_profit_at_max_display));
  else if (EXEC.sort === 'recent') items.sort((a, b) => (a.detected_age_seconds || 0) - (b.detected_age_seconds || 0));
  else if (EXEC.sort === 'confidence') items.sort((a, b) => ({ alta: 3, media: 2, baja: 1 }[b.confidence_label_es] || 0) - ({ alta: 3, media: 2, baja: 1 }[a.confidence_label_es] || 0));
  return items;
}

function renderExecList() {
  const items = filteredSorted();
  if (!items.length) {
    $('#xoList').innerHTML = `<div class="du" style="padding:28px 18px">No hay oportunidades ejecutables verificadas en este momento.<br><span style="color:var(--muted)">GP continúa revisando precios, profundidad, fees y reglas.</span></div>`;
    return;
  }
  $('#xoList').innerHTML = items.map(execCard).join('');
}

function execCard(c) {
  const legs = (c.legs || []).map(l => `<span class="xo-leg">${xe(l.provider_label)} · ${xe(l.outcome || '')} <b>${xe(l.best_price_cents || '')}</b></span>`).join('');
  const juris = c.jurisdiction_status === 'restricted' ? `<div class="warn" style="margin-top:8px">Una de las plataformas puede no estar disponible en tu jurisdicción.</div>` : '';
  return `<div class="xo-card" onclick="openExecDetail('${c.public_id}')">
    <div class="xo-card-top">${xoBadge(c.badge)} ${xoStatusPill(c.display_status)}</div>
    <div class="xo-ev">${xe(c.event || 'Oportunidad')}</div>
    <div class="xo-mkt">${xe(c.market || '')}</div>
    <div class="xo-metric"><span class="xo-m-l">Margen neto estimado</span><span class="xo-m-v green">${xe(c.net_margin_pct || '—')}</span></div>
    <div class="xo-sub">Hasta <b>${xe(c.max_executable_capital_display || '—')}</b> · Beneficio estimado <b>${xe(c.estimated_net_profit_at_max_display || '—')}</b> · <span class="xo-val" data-vage="${c.validation_age_seconds == null ? '' : c.validation_age_seconds}">Validado ${fmtAge(c.validation_age_seconds)}</span></div>
    <div class="xo-legs">${legs}</div>
    <div class="xo-card-foot"><span>${c.rules_confirmed ? '✓ Reglas confirmadas' : 'Reglas no confirmadas'} · Calidad ejec.: ${xe(c.confidence_label_es || '—')}</span><span class="xo-cta">Ver desglose →</span></div>
    ${juris}
  </div>`;
}

function tickExecAges() {
  document.querySelectorAll('#tab-opex .xo-val[data-vage]').forEach(el => {
    let s = parseInt(el.dataset.vage, 10); if (isNaN(s)) return; s += 1; el.dataset.vage = s;
    el.textContent = 'Validado ' + fmtAge(s);
    if (s > 30) el.textContent = 'Verificando…';
  });
}

async function openExecDetail(publicId) {
  clearExecTimer();
  const root = $('#tab-opex');
  root.innerHTML = `<button class="xo-back" onclick="loadExecOpps()">← Volver</button><div id="xoDetail">${du('Cargando desglose…')}</div>`;
  try {
    const q = EXEC.country ? '?country=' + encodeURIComponent(EXEC.country) : '';
    const r = await fetch('/api/executable-opportunities/' + publicId + q, { headers: hdrs() }).then(x => x.json());
    if (r.error || !r.payload) { $('#xoDetail').innerHTML = du('Esta oportunidad ya no está disponible.'); return; }
    renderExecDetail(r.payload, r.publication_status);
  } catch (e) { $('#xoDetail').innerHTML = du('No se pudo cargar el desglose.'); }
}

function renderExecDetail(p, status) {
  const ec = p.economics || {}, sz = p.sizing || {}, cf = p.confidence || {};
  const econRow = (l, v) => `<div class="xo-row"><span>${xe(l)}</span><span class="mono">${xe(v == null ? '—' : v)}</span></div>`;
  const legRows = (p.legs || []).map(l => `<div class="xo-leg-card">
      <div class="xo-leg-h">${xe(l.provider_label)} · ${xe(l.outcome || l.side || '')}</div>
      <div class="xo-leg-g">
        ${econRow('Mejor precio', l.best_price_cents)}${econRow('VWAP', l.vwap_cents)}${econRow('Peor precio', l.worst_price_cents)}
        ${econRow('No ejecutar por encima de', l.max_acceptable_price_cents)}${econRow('Fee', l.fee_display)}${econRow('Niveles consumidos', l.levels_consumed)}
        ${econRow('Fuente de precio', l.price_source_label)}
      </div></div>`).join('');
  const risks = (p.structural_risks || []).map(r => `<li>${xe(r)}</li>`).join('');
  const warns = (p.warnings || []).map(w => `<div class="warn">${xe(w.text)}</div>`).join('');
  const dls = (p.deep_links || []).map(d => d.url
    ? `<a class="venue-btn ${d.provider === 'polymarket' ? 'v-poly' : 'v-kalshi'}" href="${xe(d.url)}" target="_blank" rel="noopener noreferrer nofollow" onclick="execTrackClick('${p.public_id}','${d.provider}')">${xe(d.label || 'Abrir')} ↗</a>`
    : `<span class="venue-btn xo-dl-off">${xe((d.label || 'Plataforma'))} — no disponible en tu jurisdicción</span>`).join('');
  const jur = p.jurisdiction ? `<div class="${p.jurisdiction.combined === 'restricted' ? 'warn' : 'explain'}">${xe(p.jurisdiction.message)}</div>` : '';

  $('#xoDetail').innerHTML = `
    <div class="feat xo-hero">
      <div class="xo-card-top">${xoBadge(p.badge)} ${xoStatusPill(p.display_status)}</div>
      <div class="xo-ev" style="font-size:20px">${xe(p.event || '')}</div>
      <div class="xo-mkt">${xe(p.market || '')}</div>
      <div class="xo-hero-metrics">
        <div class="xo-hm"><span class="xo-hm-l">Margen neto est.</span><span class="xo-hm-v green">${xe(ec.net_margin_pct || '—')}</span></div>
        <div class="xo-hm"><span class="xo-hm-l">Capital máx.</span><span class="xo-hm-v">${xe(sz.max_executable_capital_display || '—')}</span></div>
        <div class="xo-hm"><span class="xo-hm-l">Beneficio est.</span><span class="xo-hm-v">${xe(sz.estimated_net_profit_at_max_display || '—')}</span></div>
        <div class="xo-hm"><span class="xo-hm-l">Calidad ejec.</span><span class="xo-hm-v blue">${xe(cf.label_es || '—')}</span></div>
      </div>
      <div class="xo-sub"><span class="xo-val" data-vage="${p.validation_age_seconds == null ? '' : p.validation_age_seconds}">Validado ${fmtAge(p.validation_age_seconds)}</span> · Detectada ${fmtAge(p.detected_age_seconds)}</div>
    </div>
    ${warns}
    ${panel('Desglose económico', 'al tamaño de referencia', `
      ${econRow('Margen bruto', ec.gross_margin_pct)}${econRow('Fees estimadas', ec.fees_total_display)}
      ${econRow('Buffer de ejecución', ec.execution_buffer_display)}${econRow('Margen neto estimado', ec.net_margin_pct)}
      ${econRow('Coste total (capital)', '$' + (ec.total_cost || '—'))}`)}
    ${panel('Patas', (p.legs || []).length + ' plataformas', legRows)}
    ${panel('Equivalencia de reglas', p.rules && p.rules.equivalence === 'confirmed' ? 'confirmada' : 'no confirmada', `
      <div class="${p.rules && p.rules.equivalence === 'confirmed' ? 'explain' : 'warn'}">${xe(p.rules ? p.rules.label : '')}</div>
      <div class="xo-dim">Compara: ${(p.rules && p.rules.dimensions || []).map(xe).join(' · ')}</div>`)}
    ${USER.execCalc && p.display_status !== 'EXPIRED' ? panel('Calculadora de capital', 'recálculo server-side', `
      <div class="xo-calc">
        <label>Capital total (USD)<input id="xoCap" class="xo-input" inputmode="decimal" placeholder="500"></label>
        <label>ROI mínimo % (opcional)<input id="xoRoi" class="xo-input" inputmode="decimal" placeholder="1"></label>
        <button class="cta-sm" onclick="execCalc('${p.public_id}')">Calcular</button>
      </div>
      <div class="xo-note">No guardamos tu capital. No preguntamos bankroll ni patrimonio. No ejecutamos operaciones.</div>
      <div id="xoCalcOut"></div>`) : ''}
    ${panel('Riesgos', 'siempre presentes', `<ul class="xo-risks">${risks}</ul>`)}
    ${dls ? panel('Abrir plataformas', 'enlaces externos', `${jur}<div class="dual-btns" style="margin-top:8px">${dls}</div><div class="xo-note">Los precios pueden haber cambiado. Revisa nuevamente antes de continuar.</div>`) : jur}
    ${panel('Metodología', 'versiones', `${econRow('Motor', p.methodology && p.methodology.engine_version)}${econRow('Fees', p.methodology && p.methodology.fee_engine_version)}${econRow('Capa', p.methodology && p.methodology.layer_version)}${econRow('Aviso de riesgo', p.methodology && p.methodology.risk_disclosure_version)}`)}
    <div class="xo-foot">${xe(p.disclaimer || XO_DISCLAIMER)}</div>`;
  EXEC.timer = setInterval(tickExecAges, 1000);
}

async function execCalc(publicId) {
  const cap = ($('#xoCap') || {}).value, roi = ($('#xoRoi') || {}).value;
  const out = $('#xoCalcOut'); if (!out) return;
  out.innerHTML = du('Calculando…');
  try {
    const r = await fetch('/api/executable-opportunities/' + publicId + '/calculate', { method: 'POST', headers: hdrs(), body: JSON.stringify({ capital: cap, minRoi: roi }) }).then(x => x.json());
    if (r.available === false) { out.innerHTML = `<div class="warn">${xe(r.message || 'Esta oportunidad ya no está disponible con los precios observados.')}</div>`; return; }
    if (r.feasible === false) { out.innerHTML = `<div class="warn">${xe(r.message || 'No factible con ese capital.')}</div>`; return; }
    const legs = (r.legs || []).map(l => `<div class="xo-row"><span>${xe(l.provider_label)} · ${xe(l.outcome || '')}</span><span class="mono">${xe(l.capital_on_platform_display)} · límite ${xe(l.price_limit_cents)}</span></div>`).join('');
    out.innerHTML = `<div class="xo-calc-res">
      <div class="xo-row"><span>Contratos por pata</span><span class="mono">${xe(r.contracts_per_leg)}</span></div>
      ${legs}
      <div class="xo-row"><span>Capital requerido</span><span class="mono">${xe(r.capital_required_display)}</span></div>
      <div class="xo-row"><span>Beneficio mínimo estimado</span><span class="mono green">${xe(r.estimated_min_profit_display)}</span></div>
      <div class="xo-row"><span>Net ROI</span><span class="mono green">${xe(r.net_roi_pct)}</span></div>
      <div class="xo-note">Válido hasta: ${xe(r.valid_until || 'revalidar')} · ${xe((r.warnings || [])[0] || '')}</div>
    </div>`;
  } catch (e) { out.innerHTML = du('No se pudo calcular.'); }
}

function execTrackClick(publicId, provider) {
  try { fetch('/api/executable-opportunities/event', { method: 'POST', headers: hdrs(), body: JSON.stringify({ event: 'deep_link_clicked', props: { public_id: publicId, provider } }) }); } catch (e) {}
}

// ---------- panel admin de revisión (§25) ----------
async function loadExecAdmin() {
  const el = $('#xoAdmin'); if (!el) return;
  el.innerHTML = du('Cargando cola de revisión…');
  try {
    const r = await fetch('/api/internal/executable-opportunities', { headers: hdrs() }).then(x => x.json());
    const counts = (r.status && r.status.counts) || {};
    const rows = (r.items || []).map(p => `<div class="xo-adm-row">
        <div><b>${xe(p.publication_status)}</b> · ${xe((p.public_payload && p.public_payload.event) || p.opportunity_key)} <span class="xo-pill xo-st-paused">${xe(p.visibility)}</span></div>
        <div class="xo-adm-btns">
          <button onclick="execAdminAct('${p.id}','approve')">Aprobar</button>
          <button onclick="execAdminAct('${p.id}','publish')">Publicar</button>
          <button onclick="execAdminAct('${p.id}','pause')">Pausar</button>
          <button onclick="execAdminAct('${p.id}','revalidate')">Revalidar</button>
          <button class="danger" onclick="execAdminAct('${p.id}','withdraw')">Retirar</button>
        </div></div>`).join('') || du('Sin publicaciones en cola.');
    el.innerHTML = panel('Revisión administrativa', `${counts.total || 0} publicaciones · ${counts.published || 0} activas`,
      `<div class="explain">Aprobación manual. Nada se publica automáticamente. Cada acción queda auditada.</div>${rows}`);
  } catch (e) { el.innerHTML = du('No se pudo cargar la cola de revisión.'); }
}
async function execAdminAct(id, action) {
  try {
    const r = await fetch('/api/internal/executable-opportunities/' + id + '/' + action, { method: 'POST', headers: hdrs(), body: JSON.stringify({}) }).then(x => x.json());
    if (r.error) alert('No se pudo: ' + r.error);
    loadExecAdmin();
  } catch (e) { alert('Error de red'); }
}

// ============================================================================
// SPRINT 5 — Registro verificable de señales. "La señal se publica, se congela, se verifica y se liquida."
// ============================================================================
const REG_VERIF = { verified: ['Verificada', 'reg-verified'], late: ['Tardía', 'reg-late'], legacy_unverified: ['Legacy', 'reg-legacy'], experimental: ['Experimento', 'reg-exp'], disputed: ['En disputa', 'reg-disp'] };
function regBadge(v) { const [t, c] = REG_VERIF[v] || [v, 'reg-legacy']; return `<span class="reg-pill ${c}">${xe(t)}</span>`; }
function regAge(s) { if (s == null) return '—'; if (s < 90) return 'hace ' + s + 's'; if (s < 5400) return 'hace ' + Math.round(s / 60) + ' min'; if (s < 172800) return 'hace ' + Math.round(s / 3600) + ' h'; return 'hace ' + Math.round(s / 86400) + ' días'; }

async function loadRegistry() {
  const root = $('#tab-registry');
  root.innerHTML = `
    <div class="sec-head"><h3><span class="dot" style="background:var(--accent)"></span>${xe(I18N.t('registry.section_title'))}</h3><span class="sec-badge">${xe(I18N.t('registry.section_badge'))}</span></div>
    <div class="explain">${I18N.t('registry.intro')}</div>
    <div id="regList"><div class="du">${xe(I18N.t('registry.loading'))}</div></div>
    <div class="xo-foot">Registro con evidencia de integridad y detección de modificaciones. No es asesoría financiera.</div>`;
  if (!USER.registryPublic) { $('#regList').innerHTML = du('La vista pública del registro está en preparación.'); return; }
  try {
    const r = await fetch('/api/signals?limit=50', { headers: hdrs() }).then(x => x.json());
    const items = (r && r.items) || [];
    $('#regList').innerHTML = items.length ? items.map(regCard).join('') : du('Aún no hay señales registradas públicamente.');
  } catch (e) { $('#regList').innerHTML = du('No se pudo cargar el registro.'); }
}
function regCard(s) {
  const result = s.settlement_status ? `<span class="reg-res">${xe(s.settlement_status)}</span>` : '<span class="reg-res reg-pend">pendiente</span>';
  return `<div class="xo-card" onclick="openSignal('${s.public_id}')">
    <div class="xo-card-top"><span class="reg-type">${xe(s.signal_type)}</span> ${regBadge(s.verification_status)} ${result}</div>
    <div class="xo-ev">${xe(s.event || s.headline || 'Señal')}</div>
    <div class="xo-mkt">${xe(s.headline || '')}${s.score_eligible ? ' · cuenta para el track record' : ''}</div>
    <div class="xo-card-foot"><span>Publicada ${regAge(s.published_age_seconds)}</span><span class="xo-cta">Ver señal →</span></div>
  </div>`;
}
async function openSignal(publicId) {
  const root = $('#tab-registry');
  root.innerHTML = `<button class="xo-back" onclick="loadRegistry()">← Volver</button><div id="regDetail">${du('Cargando señal…')}</div>`;
  try {
    const r = await fetch('/api/signals/' + publicId, { headers: hdrs() }).then(x => x.json());
    const vr = await fetch('/api/signals/' + publicId + '/verify', { headers: hdrs() }).then(x => x.json()).catch(() => null);
    if (r.error || !r.detail) { $('#regDetail').innerHTML = du('Señal no encontrada.'); return; }
    renderSignalDetail(r.detail, vr);
  } catch (e) { $('#regDetail').innerHTML = du('No se pudo cargar la señal.'); }
}
function renderSignalDetail(d, vr) {
  const o = d.original || {}, intg = d.integrity || {}, st = d.status || {};
  const row = (l, v) => `<div class="xo-row"><span>${xe(l)}</span><span class="mono">${xe(v == null ? '—' : v)}</span></div>`;
  const pred = o.prediction && o.prediction.probabilities ? Object.entries(o.prediction.probabilities).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' · ') : (o.headline || '—');
  const verifBox = vr ? `<div class="${vr.valid ? 'explain' : 'warn'}">${vr.valid ? '✓ Hash verificado · integridad correcta' : '✗ Verificación falló'} · posición ${xe(intg.chain_position)}</div>` : '';
  const timeline = (d.history || []).map(e => `<div class="xo-row"><span>${xe(e.event_type)}</span><span class="mono">${xe(e.at ? new Date(e.at).toLocaleString() : '')}</span></div>`).join('');
  const settle = (d.settlement || []).map(s => `<div class="xo-row"><span>v${s.version} · ${xe(s.status)}${s.correction_reason ? ' (corrección)' : ''}</span><span class="mono">${xe(s.winning_outcome_id || s.result_type || '')}</span></div>`).join('') || du('Sin liquidación aún.');
  const closing = (d.closing_benchmarks || []).map(c => `<div class="xo-row"><span>${xe(c.benchmark_type)}</span><span class="mono">${c.capture_status === 'captured' ? (c.executable_price || c.midpoint || '—') : xe(c.capture_status)}</span></div>`).join('') || du('Sin benchmark de cierre.');
  const sources = (d.sources || []).map(s => `<span class="xo-leg">${xe(s.source_type)}${s.snapshot_timestamp ? ' · ' + new Date(s.snapshot_timestamp).toLocaleString() : ''}</span>`).join('');
  $('#regDetail').innerHTML = `
    <div class="feat xo-hero">
      <div class="xo-card-top"><span class="reg-type">${xe(d.signal_type)}</span> ${regBadge(st.verification_status)}</div>
      <div class="xo-ev" style="font-size:20px">${xe(o.event || 'Señal')}</div>
      <div class="xo-mkt">${xe(o.market || o.headline || '')}</div>
      ${verifBox}
      <div class="reg-transp">${xe(d.transparency)}</div>
    </div>
    ${panel('Señal original (congelada)', 'antes del evento', `
      ${row('Predicción', pred)}${row('Publicada', o.published_at ? new Date(o.published_at).toLocaleString() : '—')}
      ${row('Modelo', o.model_version)}${row('Metodología', o.methodology_version)}${row('Corte de datos', o.input_cutoff_at ? new Date(o.input_cutoff_at).toLocaleString() : '—')}
      ${row('Cuenta para track record', st.score_eligible ? 'sí' : 'no')}`)}
    ${panel('Fuentes', d.sources.length + ' inputs', `<div class="xo-legs">${sources}</div>`)}
    ${panel('Integridad', 'evidencia', `${row('Hash de registro', intg.registry_hash_short + '…')}${row('Posición en la cadena', intg.chain_position)}${row('Hash previo', (intg.previous_registry_hash_short || '—') + '…')}`)}
    ${panel('Resultado', 'liquidación', settle)}
    ${panel('Historial', 'append-only', timeline)}
    ${panel('Benchmark de cierre', 'sin calcular CLV', closing)}`;
}

// ============================================================================
// SPRINT 6 — Dashboard de rendimiento (track record verificable). N/A ≠ 0. Muestra siempre visible.
// ============================================================================
const SAMPLE_LABEL = { insufficient: 'muestra insuficiente', early: 'resultados iniciales', developing: 'muestra en desarrollo', established: 'muestra más estable' };
function metricVal(m) {
  if (!m || m.value == null || !m.available) return '<span class="perf-na">N/A</span>';
  return `<span class="perf-v ${m.higher_is_better === false ? '' : ''}">${m.value.toFixed(4)}</span>`;
}
function metricCi(m) {
  if (!m || !m.confidence_interval || m.confidence_interval.low == null) return '';
  const c = m.confidence_interval; return `<span class="perf-ci">[${(c.low).toFixed(3)}, ${(c.high).toFixed(3)}]</span>`;
}
function perfCard(label, m, desc) {
  const prov = m && m.provisional ? '<span class="perf-prov">provisional</span>' : '';
  const n = m && m.sample_size != null ? `n=${m.sample_size}` : '';
  return `<div class="perf-card"><div class="perf-l">${xe(label)} ${prov}</div><div class="perf-num">${metricVal(m)} ${metricCi(m)}</div><div class="perf-meta">${n}${m && m.sample_status ? ' · ' + xe(SAMPLE_LABEL[m.sample_status] || m.sample_status) : ''}</div><div class="perf-desc">${xe(desc)}</div></div>`;
}

async function loadPerf() {
  const root = $('#tab-perf');
  root.innerHTML = `<div class="sec-head"><h3><span class="dot" style="background:var(--accent)"></span>${xe(I18N.t('perf.section_title'))}</h3><span class="sec-badge">${xe(I18N.t('perf.section_badge'))}</span></div><div id="perfBody"><div class="du">${xe(I18N.t('perf.loading_metrics'))}</div></div>`;
  if (!USER.metricsPublic) { $('#perfBody').innerHTML = du(I18N.t('perf.preview_gate')); return; }
  try {
    const [sum, cal, arb, exp] = await Promise.all([
      fetch('/api/metrics/summary', { headers: hdrs() }).then(x => x.json()).catch(() => null),
      fetch('/api/metrics/calibration', { headers: hdrs() }).then(x => x.json()).catch(() => null),
      fetch('/api/metrics/arb', { headers: hdrs() }).then(x => x.json()).catch(() => null),
      fetch('/api/metrics/experimental', { headers: hdrs() }).then(x => x.json()).catch(() => null),
    ]);
    renderPerf(sum, cal, arb, exp);
  } catch (e) { $('#perfBody').innerHTML = du('No se pudieron cargar las métricas.'); }
}
function renderPerf(sum, cal, arb, exp) {
  const m = (sum && sum.metrics) || {};
  const epoch = sum && sum.verified_epoch ? new Date(sum.verified_epoch).toLocaleDateString() : 'sin configurar';
  const nMax = Math.max(...['brier_multiclass', 'log_loss', 'accuracy_top1', 'ece'].map(k => (m[k] && m[k].sample_size) || 0));
  const header = `<div class="explain">Registro verificable desde <b>${xe(epoch)}</b> · ${nMax} señales oficiales liquidadas · ${xe((sum && sum.copy) || '')}</div>`;
  const empty = nMax === 0 ? du('Aún no hay señales oficiales liquidadas. El motor está listo; las métricas aparecerán cuando se publiquen y liquiden señales verificadas.') : '';
  const cards = nMax > 0 ? `<div class="perf-grid">
    ${perfCard('Brier (1X2)', m.brier_multiclass, 'Menor es mejor. Σ(p−y)².')}
    ${perfCard('Log loss', m.log_loss, 'Menor es mejor. −ln(p del resultado).')}
    ${perfCard('Accuracy (2ª)', m.accuracy_top1, 'Secundaria: una predicción del 40% que pierde no fue mala.')}
    ${perfCard('ECE (calibración)', m.ece, 'Menor es mejor. Brecha confianza vs realidad.')}
  </div>` : '';
  const calChart = (cal && cal.available && cal.bins && cal.bins.length) ? panel('Calibración', 'pronosticado vs observado', calibrationSvg(cal)) : '';
  const arbBlock = arb && arb.opportunities_detected != null ? panel('Arbitraje (operativo)', 'oportunidades observadas, sin ROI realizado', `
    <div class="xo-row"><span>Oportunidades publicadas</span><span class="mono">${arb.opportunities_published}</span></div>
    <div class="xo-row"><span>Quoted→ejecutable</span><span class="mono">${arb.quoted_to_executable_conversion == null ? 'N/A' : (arb.quoted_to_executable_conversion * 100).toFixed(0) + '%'}</span></div>
    <div class="xo-row"><span>Vida mediana (s)</span><span class="mono">${(arb.lifetime_seconds && arb.lifetime_seconds.p50) ?? 'N/A'}</span></div>
    <div class="warn">Las métricas reflejan oportunidades observadas, no ejecuciones realizadas por GP. ROI realizado: N/A.</div>`) : '';
  const expBlock = (exp && exp.enabled) ? panel('Señales en validación', 'no afectan el modelo oficial ni el track record', `<div class="warn">${xe(exp.note)}</div>`) : (exp ? `<div class="xo-foot">${xe(exp.note || '')}</div>` : '');
  $('#perfBody').innerHTML = header + empty + cards + calChart + arbBlock + expBlock +
    `<div class="xo-foot">Metodología ${xe((sum && sum.methodology_version) || '')}. N/A indica que la métrica no es calculable (no es cero). Las señales experimentales y legacy se muestran por separado.</div>`;
}
function calibrationSvg(cal) {
  const W = 280, H = 200, pad = 28;
  const x = p => pad + p * (W - 2 * pad), y = p => H - pad - p * (H - 2 * pad);
  const ideal = `<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="var(--muted)" stroke-dasharray="4 4" stroke-width="1"/>`;
  const pts = cal.bins.map(b => `<circle cx="${x(b.predicted_average)}" cy="${y(b.observed_frequency)}" r="${Math.max(3, Math.min(9, Math.sqrt(b.sample_size)))}" fill="var(--accent)" opacity="0.8"><title>pred ${b.predicted_average.toFixed(2)} / obs ${b.observed_frequency.toFixed(2)} (n=${b.sample_size})</title></circle>`).join('');
  return `<div class="perf-chart"><svg viewBox="0 0 ${W} ${H}" width="100%"><rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${H - 2 * pad}" fill="none" stroke="var(--border)"/>${ideal}${pts}<text x="${W / 2}" y="${H - 6}" fill="var(--muted)" font-size="9" text-anchor="middle">Probabilidad pronosticada</text></svg><div class="perf-desc">ECE: ${cal.ece != null ? cal.ece.toFixed(4) : 'N/A'} · línea punteada = calibración ideal · tamaño del punto ∝ muestra</div></div>`;
}

// ============================================================================
// SPRINT 7 — Value Engine + Picks GP. PASS/WATCH/LEAN/STRONG. Picks manuales desde STRONG.
// ============================================================================
const VAL_CLS = { strong: ['STRONG', 'val-strong'], lean: ['LEAN', 'val-lean'], watch: ['WATCH', 'val-watch'], pass: ['PASS', 'val-pass'], aging: ['AGING', 'val-watch'], expired: ['EXPIRED', 'val-pass'] };
function valBadge(c) { const [t, k] = VAL_CLS[c] || [c, 'val-pass']; return `<span class="val-badge ${k}">${xe(t)}</span>`; }
const pp = v => v == null ? 'N/A' : (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + 'pp';
const pct1 = v => v == null ? 'N/A' : (v * 100).toFixed(1) + '%';

async function loadValue(rootSel) {
  const root = $(rootSel || '#tab-value');
  root.innerHTML = `<div class="sec-head"><h3><span class="dot" style="background:var(--accent)"></span>Value</h3><span class="sec-badge">shadow</span></div>
    <div class="explain">El Value Engine clasifica mercados en <b>PASS / WATCH / LEAN / STRONG</b> comparando la probabilidad del modelo, el consenso de sportsbooks sin vig y los prediction markets. <b>PASS es una decisión válida.</b> Solo STRONG puede convertirse en candidata a Pick GP.</div>
    <div id="valBody"><div class="du">Cargando señales…</div></div>
    <div class="xo-foot">Estimación de consenso / probabilidad ensemble estimada (no "probabilidad verdadera"). No es consejo financiero.</div>`;
  const opSt = USER.uiFlags && USER.uiFlags.operationalStates && window.UIState;
  if (!USER.valuePublic) {
    // admin preview interno (público off): el admin ve las evaluaciones oficiales vía el endpoint interno
    if (USER.isAdmin && USER.valueUi) {
      try {
        const r = await fetch('/api/internal/value/evaluations', { headers: hdrs() }).then(x => x.json());
        const items = (r && r.items) || [];
        const order = { strong: 0, lean: 1, watch: 2, pass: 3 };
        items.sort((a, b) => (order[a.classification] - order[b.classification]) || ((b.adjusted_edge_pp || 0) - (a.adjusted_edge_pp || 0)));
        const head = `<div class="explain"><b>Vista admin (interna)</b> · ${items.length} evaluaciones · no pública.<br>
          <b>Edge bruto</b> = combinada (ensemble) − break-even · <b>Edge ajustado</b> = conservadora − break-even. GP no es el ensemble.<br>
          Diagnóstico interno del Value Engine. Probabilidad GP = modelo oficial.</div>`;
        // Candidatos READY (con el botón "Aprobar como Pick interna") arriba de las evaluaciones.
        const candSection = `<div class="gcard" style="margin-bottom:12px"><h3>CANDIDATOS A PICK GP (revisión humana)</h3><div id="valCandBody" class="muted" style="font-size:12px">Cargando…</div></div>`;
        const picksSection = `<div class="gcard" style="margin-bottom:12px"><h3>PICKS APROBADAS · INTERNAS</h3><div id="valPicksBody" class="muted" style="font-size:12px">Cargando…</div></div>`;
        $('#valBody').innerHTML = candSection + picksSection + (items.length ? head + items.map(valueCard).join('') : du('No hay evaluaciones internas todavía.'));
        loadCandidates('#valCandBody');
        loadApprovedPicks('#valPicksBody');
      } catch (e) { $('#valBody').innerHTML = du('No se pudieron cargar las evaluaciones internas.'); }
      return;
    }
    $('#valBody').innerHTML = opSt ? UIState.featureDisabled('La vista pública de Value está en preparación.') : du('La vista pública de Value está en preparación.'); return;
  }
  try {
    const r = await fetch('/api/value/signals', { headers: hdrs() }).then(x => x.json());
    const items = (r && r.items) || [];
    const empty = opSt ? UIState.notConfigured('Las cuotas de sportsbooks todavía no están configuradas. Las señales de Value se calcularán cuando haya consenso de casas.') : du('No hay señales de value disponibles. Requiere cuotas de sportsbooks (proveedor pendiente de integrar).');
    $('#valBody').innerHTML = items.length ? items.map(valueCard).join('') : empty;
  } catch (e) { $('#valBody').innerHTML = opSt ? UIState.error('No se pudieron cargar las señales.') : du('No se pudieron cargar las señales.'); }
}
function valueCard(s) {
  const ev = (s.home_participant && s.away_participant) ? `<div class="muted" style="font-size:12px;margin-bottom:4px">${xe(s.home_participant)} vs ${xe(s.away_participant)}</div>` : '';
  const consensus = s.sportsbook_consensus != null ? s.sportsbook_consensus : s.sportsbook_consensus_probability;
  const be = (s.best_decimal_odds != null && Number(s.best_decimal_odds) > 0) ? 1 / Number(s.best_decimal_odds) : null;
  const v2 = s.detail && s.detail.quality_diagnostic_v2_score;
  const bookLine = s.best_sportsbook_code ? `<div class="muted" style="font-size:11.5px;margin-top:6px">Mejor cuota en <b>${xe(s.best_sportsbook_name || s.best_sportsbook_code)}</b>${s.edge_source_code ? ' · '+xe(s.edge_source_code) : ''}</div>` : '';
  return `<div class="xo-card">
    ${ev}<div class="xo-card-top">${valBadge(s.classification)} <span class="reg-type">${xe(s.selection || '')}</span></div>
    <div class="val-grid">
      <div><span>GP V1</span><b>${pct1(s.gp_probability)}</b></div>
      <div><span>Consenso no-vig</span><b>${pct1(consensus)}</b></div>
      <div><span>Combinada (ensemble)</span><b>${pct1(s.ensemble_probability)}</b></div>
      <div><span>Conservadora</span><b>${pct1(s.conservative_probability)}</b></div>
      <div><span>Break-even</span><b>${pct1(be)}</b></div>
      <div><span>GP vs consenso</span><b>${pp(s.gp_vs_consensus_pp)}</b></div>
      <div><span>Mejor cuota</span><b>${s.best_decimal_odds != null ? Number(s.best_decimal_odds).toFixed(2) : 'N/A'}</b></div>
      <div><span>Cuota mínima</span><b>${s.minimum_acceptable_odds != null ? Number(s.minimum_acceptable_odds).toFixed(2) : 'N/A'}</b></div>
      <div><span>Edge bruto (ens−BE)</span><b>${pp(s.raw_edge_pp)}</b></div>
      <div><span>Edge ajustado (cons−BE)</span><b class="${(s.adjusted_edge_pp||0)>0?'green':''}">${pp(s.adjusted_edge_pp)}</b></div>
      <div><span>Grupos verif.</span><b>${s.verified_independence_group_count ?? 'N/A'}</b></div>
      <div><span>Calidad</span><b>${s.quality_score ?? 'N/A'}${s.quality_max_points ? ' <span class="muted" style="font-weight:500">('+(s.quality_raw_points!=null?Number(s.quality_raw_points):'?')+'/'+Number(s.quality_max_points)+(v2!=null?' · v2 '+Number(v2).toFixed(0):'')+')</span>' : ''}</b></div>
    </div>${bookLine}</div>`;
}

async function loadPicks(rootSel) {
  const root = $(rootSel || '#tab-picks');
  root.innerHTML = `<div class="sec-head"><h3><span class="dot" style="background:var(--accent)"></span>Picks GP</h3><span class="sec-badge">Strong Value</span></div>
    <div id="picksBody"><div class="du">Cargando picks…</div></div>
    <div class="xo-foot">Pick GP basada en una señal Strong Value. Cuota observada al momento de publicación. Válida únicamente mientras la cuota permanezca en o por encima del mínimo. Resultado teórico con stake unitario; GP no ejecutó esta operación.</div>`;
  const opSt = USER.uiFlags && USER.uiFlags.operationalStates && window.UIState;
  if (!USER.picksPublic) { $('#picksBody').innerHTML = opSt ? UIState.featureDisabled('La vista pública de Picks GP está en preparación.') : du('La vista pública de Picks GP está en preparación.'); return; }
  try {
    const r = await fetch('/api/picks', { headers: hdrs() }).then(x => x.json());
    const items = (r && r.items) || [];
    // §10: el vacío de Picks NO es un error — es un estado válido con su explicación.
    const empty = `<div class="op-state op-info" role="status"><div class="op-state-ic">○</div><div class="op-state-tx"><div class="op-state-t">${(window.COPY?COPY.picksEmpty:'Hoy no hay Picks GP.')}</div><div class="op-state-b">${(window.COPY?COPY.picksEmptyWhy:'Ninguna señal supera actualmente todos los criterios.')}</div></div></div>`;
    $('#picksBody').innerHTML = items.length ? items.map(pickCard).join('') : empty;
  } catch (e) { $('#picksBody').innerHTML = opSt ? UIState.error('No se pudieron cargar las picks.') : du('No se pudieron cargar las picks.'); }
}
const PICK_ST = { published: ['ABIERTA', 'xo-st-active'], price_moved: ['CUOTA MOVIDA', 'xo-st-aging'], closed: ['CERRADA', 'xo-st-paused'], settlement_pending: ['LIQUIDANDO', 'xo-st-aging'], settled: ['LIQUIDADA', 'xo-st-paused'], void: ['ANULADA', 'xo-st-paused'], disputed: ['EN DISPUTA', 'xo-st-expired'] };
function pickSt(s) { const [t, k] = PICK_ST[s] || [s, 'xo-st-paused']; return `<span class="xo-pill ${k}">${t}</span>`; }
function pickCard(p) {
  const odds = p.observed_odds != null;
  return `<div class="xo-card" onclick="openPick('${p.public_id}')">
    <div class="xo-card-top"><span class="xo-badge xo-b-pure">PICK GP — STRONG VALUE</span> ${pickSt(p.status)}</div>
    <div class="xo-ev">${xe(p.selection || '')} ${p.event ? '· ' + xe(p.event) : ''}</div>
    <div class="xo-mkt">${xe(p.market || '')}</div>
    <div class="xo-sub">${odds ? `Cuota observada: <b>${p.observed_odds.toFixed(2)}</b> · Mínima: <b>${p.minimum_acceptable_odds != null ? p.minimum_acceptable_odds.toFixed(2) : '—'}</b>` : `Precio: <b>${p.observed_price}</b> · máx: <b>${p.maximum_acceptable_price}</b>`} · Edge ajustado <b class="green">${pp(p.adjusted_edge_pp)}</b></div>
    ${p.status === 'price_moved' ? '<div class="warn" style="margin-top:8px">La pick permanece en el registro, pero la cuota actual ya no supera el mínimo de value.</div>' : ''}
    <div class="xo-card-foot"><span>Calidad ${p.quality_score ?? '—'} · incertidumbre ${p.uncertainty_score ?? '—'}</span><span class="xo-cta">Ver pick →</span></div>
  </div>`;
}
async function openPick(publicId) {
  const root = $('#tab-picks');
  root.innerHTML = `<button class="xo-back" onclick="loadPicks()">← Volver</button><div id="pickDetail">${du('Cargando…')}</div>`;
  try {
    const r = await fetch('/api/picks/' + publicId, { headers: hdrs() }).then(x => x.json());
    if (r.error || !r.detail) { $('#pickDetail').innerHTML = du('Pick no encontrada.'); return; }
    const d = r.detail, pr = d.probabilities || {};
    const row = (l, v) => `<div class="xo-row"><span>${xe(l)}</span><span class="mono">${xe(v == null ? '—' : v)}</span></div>`;
    const timeline = (d.history || []).map(e => `<div class="xo-row"><span>${xe(e.action)}</span><span class="mono">${xe(e.created_at ? new Date(e.created_at).toLocaleString() : '')}</span></div>`).join('');
    $('#pickDetail').innerHTML = `
      <div class="feat xo-hero"><div class="xo-card-top"><span class="xo-badge xo-b-pure">PICK GP — STRONG VALUE</span> ${pickSt(d.status)}</div>
        <div class="xo-ev" style="font-size:20px">${xe(d.selection || '')}</div><div class="xo-mkt">${xe(d.event || '')} · ${xe(d.market || '')}</div>
        <div class="reg-transp">${xe(d.disclaimer || '')}</div></div>
      ${panel('Precio', 'observado y límite', `${row('Cuota observada', d.observed_odds)}${row('Cuota mínima aceptable', d.minimum_acceptable_odds)}${row('Cuota actual', d.current_odds)}${row('Cuota justa', d.fair_odds)}`)}
      ${panel('Probabilidades', 'estimaciones', `${row('GP', pct1(pr.gp))}${row('Consenso no-vig', pct1(pr.sportsbook_consensus))}${row('Prediction markets', pct1(pr.prediction_market))}${row('Ensemble', pct1(pr.ensemble))}${row('Conservadora', pct1(pr.conservative))}`)}
      ${panel('Value', 'edge y calidad', `${row('Edge ajustado', pp(d.adjusted_edge_pp))}${row('EV ajustado', pct1(d.adjusted_ev))}${row('Calidad', d.quality_score)}${row('Incertidumbre', d.uncertainty_score)}${row('Fuentes', d.source_count)}${row('Grupos independientes', d.independence_groups)}`)}
      ${d.rationale ? panel('Explicación', 'determinística', `<div class="explain">${xe(d.rationale)}</div>`) : ''}
      ${panel('Seguimiento', 'teórico', `<div class="xo-note">${xe((d.tracking && d.tracking.note) || '')}</div>`)}
      ${panel('Historial', 'append-only', timeline)}
      ${panel('Metodología', 'versiones', `${row('Modelo', d.versions && d.versions.model)}${row('Ensemble', d.versions && d.versions.ensemble)}${row('No-vig', d.versions && d.versions.no_vig)}`)}`;
  } catch (e) { $('#pickDetail').innerHTML = du('No se pudo cargar la pick.'); }
}

// loadMe() renderiza el header ANTES de que I18N.load() traiga el diccionario → el nav/login saldría con keys
// crudas (nav.teams, auth.login). Tras cargar i18n, I18N.load() ya re-resolvió el locale (con USER.lang si hay
// sesión) → repintamos el header para que el nav y el botón de login queden traducidos. (Fix bug Q.1.1.)
// deep-link opcional: ?goto=<tab> (p.ej. el email de la beta enlaza a ?goto=referidos). Solo tabs seguros y con sesión.
function gotoFromUrl() {
  try { const g = new URLSearchParams(location.search).get('goto'); if (g && USER && ['referidos', 'following', 'alerts', 'perf', 'value', 'picks', 'arb'].indexOf(g) >= 0) switchTab(g); } catch (e) {}
}
(async () => { await loadMe(); if (BETA_REDIRECT) return; await I18N.load(); renderHeader(); await loadState(); if (USER && !STATE.teaser) switchTab('arb'); gotoFromUrl(); renderTicker(); connectSSE(); })();
