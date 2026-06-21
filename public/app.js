// Frontend del simulador — vanilla JS, SSE para tiempo real
let STATE = null, USER = null, ARB = null;
const $ = s => document.querySelector(s);
const pct = (p, d = 1) => (p * 100).toFixed(d) + '%';
const token = () => localStorage.getItem('wc_token') || '';
const hdrs = () => token() ? { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
const STAGES_ES = { R32: '16avos', R16: 'Octavos', QF: 'Cuartos', SF: 'Semifinal', '3RD': '3er puesto', FINAL: 'FINAL', group: 'Grupos' };

const teamOf = id => STATE.teams.find(t => t.id === id);
const tlabel = id => { const t = teamOf(id); return t ? `${t.flag} ${t.name}` : (id || '—'); };

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
  $('#tab-teams').innerHTML = `
    <div class="hero">
      <div class="hero-eyebrow"><span class="dot on"></span>${STATE.sims.toLocaleString()} TORNEOS SIMULADOS · ACTUALIZADO EN VIVO</div>
      <h1 class="hero-h1">¿Quién va a ganar el <span class="g">Mundial 2026</span>?</h1>
      <div class="hero-sub">Nuestro modelo simula el torneo completo ${STATE.sims.toLocaleString()} veces y ajusta las probabilidades con cada gol. Esto es lo que dice hoy.</div>
      <div class="fav-board">
        <div class="fav-lead tilt" onclick="openLogin()">
          <div class="rk">★ FAVORITO #1</div>
          <div class="lead-team"><div class="fl">${lead.flag}</div><div class="tn">${lead.name}<small>GRUPO ${lead.group}</small></div></div>
          <div class="lead-big">${(lead.champion * 100).toFixed(1)}<span>%</span></div>
          <div class="lead-cap">probabilidad de levantar la copa</div>
        </div>
        <div class="fav-list">${rows}</div>
      </div>
      <div class="hero-trust">
        <div class="ht"><b>104</b>partidos cubiertos</div>
        <div class="ht"><b>${STATE.totalTeams}</b>selecciones</div>
        <div class="ht"><b>2</b>mercados · Polymarket y Kalshi</div>
        <div class="ht"><b style="color:var(--accent)">EN VIVO</b>se mueve con cada gol</div>
      </div>
      <div class="hero-cta">
        <button class="btn" onclick="openLogin()">Crear mi cuenta gratis</button>
        <span class="muted" style="font-size:12.5px">Sin contraseñas · solo tu email · 30 segundos</span>
      </div>
    </div>`;
  ['following', 'alerts', 'groups', 'matches', 'bracket', 'arb', 'record', 'evo', 'admin'].forEach(t => {
    $('#tab-' + t).innerHTML = `<div class="lock">
      <div class="lock-icon">🔒</div>
      <div class="lock-title">Desbloquea esta sección gratis</div>
      <div class="lock-sub">Crea tu cuenta para ver probabilidades completas, oportunidades de mercado, simulaciones y alertas en vivo.</div>
      <button class="btn" onclick="openLogin()">Crear cuenta gratis</button>
      <div class="lock-micro">Sin contraseña · solo tu email</div></div>`;
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
    return `<div class="explain" style="border-left-color:var(--amber)">
      🆚 <b>Modelo vs Mercado:</b> acumulando… Capturamos la línea de cierre de cada partido desde ahora;
      el head-to-head aparecerá cuando terminen los próximos partidos con mercado.</div>`;
  }
  const winning = vm.modelBrier < vm.marketBrier;
  return `<div class="explain" style="border-left-color:${winning ? 'var(--accent)' : 'var(--red)'}">
    🆚 <b>Modelo vs Mercado (${vm.n} partidos):</b>
    nuestro Brier <b>${vm.modelBrier}</b> vs mercado <b>${vm.marketBrier}</b> —
    ${winning ? '🟢 le estamos GANANDO al mercado' : '🔴 el mercado nos gana'} ·
    ganamos el partido en ${vm.modelWins}/${vm.n} (Brier más bajo gana).
    <span class="muted" style="font-size:11px">Esto es la prueba objetiva de si tenemos alpha real.</span></div>`;
}

// ---------- ACIERTOS (track record público del modelo) ----------
async function renderRecord() {
  const r = await fetch('/api/aciertos');
  if (!r.ok) return;
  const d = await r.json();
  const pctW = d.total ? Math.round(d.winners / d.total * 100) : 0;
  let html = `<div style="margin-bottom:14px"><h2 style="margin-bottom:3px">Aciertos · rendimiento del modelo</h2>
    <div class="muted" style="font-size:12px">Cada predicción se registra con los datos que el modelo tenía <b>antes</b> del partido. Aciertos y fallos, todo público.</div></div>
    <div class="statrow" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
      <div class="bigstat"><div class="lbl">Evaluados</div><div class="val">${d.total}</div></div>
      <div class="bigstat"><div class="lbl">Ganador acertado</div><div class="val pgood">${d.total ? pctW + '%' : '—'}</div><div class="muted" style="font-size:11px">${d.winners}/${d.total}</div></div>
      <div class="bigstat"><div class="lbl">Marcador exacto</div><div class="val" style="color:var(--amber)">${d.exact}</div></div>
      ${d.total ? `<div class="bigstat"><div class="lbl">Brier score</div><div class="val blue">${d.brier}</div><div class="muted" style="font-size:11px">azar = 0.66</div></div>` : ''}
    </div>
    ${d.total ? `<div class="explain" style="border-left-color:var(--blue)">El % de ganador directo no mide toda la calibración. El <b>Brier score</b> mide qué tan buenas fueron las probabilidades asignadas: más bajo es mejor (0 = perfecto, 0.66 = azar a 3 vías).</div>` : ''}
    <div class="formrow"><button class="cta-sm" onclick="shareOp(event, '⚽ El modelo de GP Simulador va ${d.winners}/${d.total} acertando ganadores del Mundial (${d.exact} marcadores exactos). Míralo en vivo:')">📤 Compartir track record</button></div>
    ${(USER && USER.isAdmin && d.total) ? marketScoreboardHtml(d.vsMarket) : ''}`;
  if (!d.total) {
    html += '<div class="muted">Los primeros resultados aparecerán al terminar los próximos partidos.</div>';
  }
  html += '<div class="rec-list">' + d.matches.map(m => {
    const th = teamOf(m.home), ta = teamOf(m.away);
    const pickLabel = m.predicted === 'home' ? `Gana ${th ? th.name : m.home}` : m.predicted === 'away' ? `Gana ${ta ? ta.name : m.away}` : 'Empate';
    return `<div class="rec-row">
      <span class="rec-dot ${m.correct ? 'ok' : 'no'}"></span>
      <div class="rec-main">
        <div class="rec-score">${th ? th.flag : ''} ${m.home} <b>${m.hg} - ${m.ag}</b> ${m.away} ${ta ? ta.flag : ''}${m.exact ? ' <span class="exact-tag">EXACTO</span>' : ''}</div>
        <div class="rec-pred">Modelo: ${pickLabel} (${pct(m.predictedProb)})</div>
      </div>
      <span class="rec-date">${new Date(m.datetime).toLocaleDateString([], { day: 'numeric', month: 'short' })}</span>
    </div>`;
  }).join('') + '</div>';
  $('#tab-record').innerHTML = html;
}
async function loadMe() {
  if (token()) {
    const r = await fetch('/api/me', { headers: hdrs() });
    if (r.ok) { USER = await r.json(); } else { localStorage.removeItem('wc_token'); USER = null; }
  }
  renderHeader();
}

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
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};
const TABS = {
  arb: 'Oportunidades', matches: 'Partidos', teams: 'Equipos', groups: 'Grupos',
  following: 'Seguidos', alerts: 'Alertas', bracket: 'Bracket', record: 'Aciertos', evo: 'Evolución', admin: 'Admin',
  sim: 'Simulador', referidos: 'Invitar',
};
const OUT_NAV = ['teams', 'groups', 'matches', 'bracket', 'arb'];
const IN_TOPNAV = ['arb', 'matches', 'teams', 'sim', 'groups', 'following', 'bracket', 'record', 'evo'];
const BOTTOM = ['arb', 'matches', 'teams', 'groups'];

function renderHeader() {
  const inApp = !!USER;
  document.body.classList.toggle('logged-in', inApp);
  document.body.classList.toggle('has-bottomnav', inApp);
  // top nav
  const topItems = inApp ? IN_TOPNAV.concat(USER.isAdmin ? ['admin'] : []) : OUT_NAV;
  $('#topnav').innerHTML = topItems.map(t => `<button data-nav="${t}" onclick="switchTab('${t}')">${TABS[t]}</button>`).join('');
  // right side
  if (inApp) {
    const initials = (USER.email || '?').slice(0, 1).toUpperCase();
    $('#hdRight').innerHTML =
      `<span class="live-pill" id="livePill"><span class="lp-dot"></span>LIVE</span>
       <button class="icon-btn" aria-label="Alertas y notificaciones" onclick="switchTab('alerts')">${ICON.alerts}</button>
       <button class="avatar-btn" aria-label="Tu cuenta" onclick="toggleAvatarMenu(event)">${initials}</button>`;
  } else {
    $('#hdRight').innerHTML = `<button class="hd-login" onclick="openLogin()">Entrar</button><button class="cta-sm" onclick="openLogin()">Crear cuenta gratis</button>`;
  }
  // bottom nav
  if (inApp) {
    $('#bottomnav').innerHTML = BOTTOM.map(t =>
      `<button data-nav="${t}" onclick="switchTab('${t}')" aria-label="${TABS[t]}">${ICON[t]}<span>${TABS[t]}</span></button>`).join('')
      + `<button data-nav="more" onclick="openSheet()" aria-label="Más">${ICON.more}<span>Más</span></button>`;
    $('#bottomnav').style.display = ''; // dejar que el CSS (media query) controle la visibilidad
  } else {
    $('#bottomnav').style.display = 'none';
  }
  syncNavActive();
}

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
  }
  // Oportunidades: con sesión, (re)carga si no está cargada o si quedó mostrando un candado
  // (auto-cura cualquier carrera del login que dejaba el candado del teaser). Sin sesión, no toca.
  if (name === 'arb' && USER && (!ARB || $('#tab-arb').querySelector('.lock'))) loadArb();
  syncNavActive(); closeAvatarMenu(); closeSheet();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function toggleAvatarMenu(e) {
  if (e) e.stopPropagation();
  const m = $('#avatarMenu');
  if (m.style.display !== 'none') return closeAvatarMenu();
  const plan = USER.isAdmin ? 'ADMIN' : 'FREE';
  const item = (tab, icon, label) => `<button onclick="switchTab('${tab}')">${ICON[icon]}${label}</button>`;
  m.innerHTML = `
    <div class="avmenu-head">
      <div class="av">${(USER.email || '?').slice(0, 1).toUpperCase()}</div>
      <div><div class="em">${USER.email}</div><div class="plan">${plan}</div></div>
    </div>
    ${item('sim', 'sim', 'Simula cualquier cruce ⚔️')}
    ${item('referidos', 'gift', 'Invitar amigos 🎁')}
    ${item('following', 'account', 'Mis seguidos')}
    ${item('alerts', 'alerts', 'Alertas y notificaciones')}
    ${item('record', 'record', 'Aciertos del modelo')}
    ${item('evo', 'evo', 'Evolución')}
    ${USER.isAdmin ? item('admin', 'admin', 'Admin') : ''}
    <button class="danger" onclick="logout()">${ICON.logout}Cerrar sesión</button>`;
  m.style.display = '';
  setTimeout(() => document.addEventListener('click', closeAvatarMenu, { once: true }), 0);
}
function closeAvatarMenu() { const m = $('#avatarMenu'); if (m) m.style.display = 'none'; }

function openSheet() {
  const items = [['following', 'Seguidos'], ['following', 'Alertas', 'alerts'], ['bracket', 'Bracket'], ['record', 'Aciertos'], ['evo', 'Evolución'], ['account', 'Mi cuenta', 'account']];
  let html = '<div class="sheet-grid">';
  html += `<button onclick="switchTab('sim')">${ICON.sim}<span>Simular</span></button>`;
  html += `<button onclick="switchTab('following')">${ICON.following}<span>Seguidos</span></button>`;
  html += `<button onclick="switchTab('alerts')">${ICON.alerts}<span>Alertas</span></button>`;
  html += `<button onclick="switchTab('bracket')">${ICON.bracket}<span>Bracket</span></button>`;
  html += `<button onclick="switchTab('record')">${ICON.record}<span>Aciertos</span></button>`;
  html += `<button onclick="switchTab('evo')">${ICON.evo}<span>Evolución</span></button>`;
  html += `<button onclick="switchTab('referidos')">${ICON.gift}<span>Invitar</span></button>`;
  if (USER && USER.isAdmin) html += `<button onclick="switchTab('admin')">${ICON.admin}<span>Admin</span></button>`;
  html += `<button onclick="toggleAvatarMenu()">${ICON.account}<span>Cuenta</span></button>`;
  html += `<button class="danger" onclick="logout()">${ICON.logout}<span>Salir</span></button>`;
  html += '</div>';
  $('#sheetBody').innerHTML = html;
  $('#sheet').style.display = '';
}
function closeSheet() { const s = $('#sheet'); if (s) s.style.display = 'none'; }

function renderAll() {
  if (STATE.teaser) { renderTeaser(); return; }
  renderTeams(); renderFollowing(); renderAlerts(); renderGroups(); renderMatches(); renderBracket(); renderEvo(); renderAdmin(); renderRecord();
  if ($('#tab-arb').classList.contains('active')) loadArb();
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
  let html = `<div class="arb-head"><div><h2 style="margin-bottom:3px">Seguidos</h2>
    <div class="muted" style="font-size:12px">${favs.length} equipo${favs.length === 1 ? '' : 's'} seguido${favs.length === 1 ? '' : 's'} · alertas de partidos y cambios de probabilidad</div></div>
    <button class="cta-sm" onclick="switchTab('teams')">+ Seguir equipo</button></div>`;
  if (!favs.length) {
    html += `<div class="lock"><div class="lock-icon">★</div>
      <div class="lock-title">Todavía no sigues equipos</div>
      <div class="lock-sub">Sigue selecciones para recibir alertas de partidos, resultados y cambios de probabilidad.</div>
      <button class="btn" onclick="switchTab('teams')">Explorar equipos</button></div>`;
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
    let meta = 'Sin próximo partido programado';
    if (nm) { const opp = teamOf(nm.home === t.id ? nm.away : nm.home); meta = `Próximo · vs ${opp ? opp.name : '—'} · ${fmtKickoff(nm)}`; }
    const isMuted = muted.includes(t.id);
    return `<div class="follow-card">
      <span class="fc-flag" style="cursor:pointer" onclick="openTeamPage('${t.id}')">${t.flag}</span>
      <div class="fc-main" style="cursor:pointer" onclick="openTeamPage('${t.id}')">
        <div class="fc-name">${t.name}</div>
        <div class="fc-meta">${nm ? `<span onclick="event.stopPropagation();openMatchPage('${nm.id}')" style="cursor:pointer">${meta} →</span>` : meta}</div>
      </div>
      <div class="fc-prob">
        <div class="fc-pc">${pct(t.sim.champion)}</div>
        <div class="fc-chg">${ch != null ? chgBadge(ch) : '<span class="muted" style="font-size:11px">campeón</span>'}</div>
      </div>
      <button class="fc-bell ${isMuted ? '' : 'on'}" onclick="toggleMute('${t.id}')" aria-label="${isMuted ? 'Activar' : 'Silenciar'} alertas de ${t.name}">${ICON.alerts}</button>
      <button class="fc-x" onclick="toggleFav('${t.id}')" aria-label="Dejar de seguir ${t.name}">✕</button>
    </div>`;
  }).join('') + '</div>';
  html += `<div class="muted" style="font-size:12px;margin-top:14px;text-align:center">Configura qué eventos y canales recibir en <a onclick="switchTab('alerts')" style="color:var(--accent);cursor:pointer;font-weight:600">Alertas</a>.</div>`;
  $('#tab-following').innerHTML = html;
}

async function toggleMute(teamId) {
  const r = await fetch('/api/mute', { method: 'POST', headers: hdrs(), body: JSON.stringify({ teamId }) });
  if (r.ok) { USER.alertPrefs = USER.alertPrefs || {}; USER.alertPrefs.mutedTeams = (await r.json()).mutedTeams; renderFollowing(); }
}

// ---------- ALERTAS Y NOTIFICACIONES ----------
const ALERT_EVENTS = [
  ['nextMatch', '📅', 'Próximo partido', 'Recibe una alerta antes del próximo partido'],
  ['matchStart', '▶', 'Inicio de partido', 'Al comenzar el partido'],
  ['goal', '⚽', 'Gol', 'Cada vez que marque un equipo seguido'],
  ['result', '🏁', 'Resultado final', 'Cuando finalice el partido', true],
  ['qualify', '🏆', 'Clasificación / eliminación', 'Cambios importantes en la tabla'],
  ['probSwing', '📈', 'Cambio fuerte de probabilidad', 'Variaciones significativas en el modelo'],
  ['valueOpp', '◎', 'Nueva oportunidad de valor', 'Cuando el modelo detecta value según tu perfil'],
  ['arb', '◆', 'Arbitraje puro detectado', 'Cuando Polymarket y Kalshi se contradicen'],
];
const ALERT_CHANNELS = [
  ['email', '✉', 'Email', false],
  ['telegram', '✈', 'Telegram', true],
  ['push', '🔔', 'Push', true],
];
function evOn(k) { const e = (USER.alertPrefs && USER.alertPrefs.events) || {}; return e[k] !== false; }
function chOn(k) { const c = (USER.alertPrefs && USER.alertPrefs.channels) || {}; return k === 'email' ? c.email !== false : c[k] === true; }
function renderAlerts() {
  if (!USER) return;
  let html = `<div style="margin-bottom:6px"><h2 style="margin-bottom:3px">Alertas</h2>
    <div class="muted" style="font-size:12px">Configura cuándo y cómo quieres recibir notificaciones de tus equipos seguidos.</div></div>`;
  html += `<div class="sec-head"><h3>Eventos</h3></div><div class="alert-group">` +
    ALERT_EVENTS.map(([k, ic, title, desc]) => `
      <div class="alert-row">
        <span class="alert-ic">${ic}</span>
        <div class="alert-txt"><div class="alert-t">${title}</div><div class="alert-d">${desc}</div></div>
        <button class="toggle ${evOn(k) ? 'on' : ''}" onclick="toggleEvent('${k}')" aria-label="${title}"><span class="knob"></span></button>
      </div>`).join('') + '</div>';
  html += `<div class="sec-head"><h3>Canales de notificación</h3></div>
    <div class="muted" style="font-size:12px;margin:-4px 0 12px">Elige dónde quieres recibir tus alertas.</div><div class="alert-group">` +
    ALERT_CHANNELS.map(([k, ic, title, soon]) => `
      <div class="alert-row ${soon ? 'soon' : ''}">
        <span class="alert-ic">${ic}</span>
        <div class="alert-txt"><div class="alert-t">${title} ${soon ? '<span class="soon-tag">PRÓXIMAMENTE</span>' : ''}</div><div class="alert-d">${k === 'email' ? USER.email : 'Disponible pronto'}</div></div>
        <button class="toggle ${chOn(k) ? 'on' : ''}" ${soon ? 'disabled' : ''} onclick="toggleChannel('${k}')" aria-label="${title}"><span class="knob"></span></button>
      </div>`).join('') + '</div>';
  html += `<div class="muted" style="font-size:11.5px;margin-top:16px">Las alertas se envían para tus equipos seguidos. Gestiona qué equipos sigues en <a onclick="switchTab('following')" style="color:var(--accent);cursor:pointer;font-weight:600">Seguidos</a>.</div>`;
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
    <h2>Probabilidad de ganar la Copa del Mundo · ${STATE.sims.toLocaleString()} torneos simulados</h2>
    <input id="teamSearch" class="searchbox" type="search" inputmode="search" placeholder="🔍 Busca tu selección (ej. España)…" oninput="filterTeams(this.value)" autocomplete="off">
    <div id="teamNoRes" class="muted" style="display:none;padding:10px 2px">Sin resultados — prueba con otro nombre.</div>
    <div class="simcard" onclick="switchTab('sim')"><span class="sc-ic">⚔️</span><div class="sc-tx"><div class="sc-t">Simula cualquier cruce</div><div class="sc-s">Enfrenta a tu selección contra quien quieras</div></div><span class="sc-go">→</span></div>
    <div class="teamgrid" id="teamGrid">` + teams.map(t => `
    <div class="tcard" data-name="${(t.name + ' ' + t.en + ' ' + (t.aliases || []).join(' ')).toLowerCase()}" onclick="openTeam('${t.id}')">
      <div class="trow">
        <span style="font-size:20px">${t.flag}</span>
        <span class="tname">${t.name}</span>
        ${favs.includes(t.id) ? '<span class="fav">★</span>' : ''}
        <span class="telo">ELO ${t.currentElo}${t.eloDelta ? ` <span class="${t.eloDelta > 0 ? 'delta-up' : 'delta-down'}">${t.eloDelta > 0 ? '+' : ''}${t.eloDelta}</span>` : ''}<br>GRUPO ${t.group}${t.host ? ' · LOCAL' : ''}</span>
      </div>
      <div class="champ">${pct(t.sim.champion)}</div>
      <div class="bar"><div style="width:${(t.sim.champion / max * 100).toFixed(1)}%"></div></div>
      <div class="pcts">
        <span>Final ${pct(t.sim.reachFinal)}</span>
        <span>Semis ${pct(t.sim.reachSF)}</span>
        <span>Elim. grupos <span class="${t.sim.outInGroups > .5 ? 'pbad' : ''}">${pct(t.sim.outInGroups)}</span></span>
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
function formLetter(r) { return ({ W: 'V', D: 'E', L: 'D' })[r] || r; } // V/E/D en español
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
  const m = { available: ['ok', 'Disponible'], injured: ['bad', 'Lesión'], suspended: ['bad', 'Suspendido'], doubt: ['warn', 'Duda'], unknown: ['', '—'] };
  const [cls, lbl] = m[st] || m.unknown;
  return `<span class="pstatus ${cls}">${lbl}</span>`;
}
function injuryBadge(st) {
  const m = { injured: ['bad', '✚ Lesión'], suspended: ['bad', '⊘ Suspendido'], doubt: ['warn', '? Duda'], available: ['ok', 'Disponible'], unknown: ['', '—'] };
  const [cls, lbl] = m[st] || m.unknown;
  return `<span class="pstatus ${cls}">${lbl}</span>`;
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
  $('#tab-match').innerHTML = detailHead('Partido') + '<div class="muted" style="padding:34px 0;text-align:center">Cargando partido…</div>';
  try {
    const r = await fetch('/api/match/' + encodeURIComponent(id), { headers: hdrs() });
    if (!r.ok) { if (r.status === 401) { openLogin(); return; } throw 0; }
    CUR_MATCH = await r.json();
    renderMatchDetail(CUR_MATCH);
    // partido en vivo → auto-refresco de marcador/eventos/stats cada 25s
    if (CUR_MATCH.status === 'live') detailTimer = setInterval(() => refreshMatch(CUR_MATCH.id), 25000);
  } catch { $('#tab-match').innerHTML = detailHead('Partido') + du('No se pudo cargar el partido. Intenta de nuevo.'); }
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
  const statusChip = d.status === 'live'
    ? `<span class="livepill on">● EN VIVO${d.minute ? " " + d.minute + "'" : ''}</span>`
    : d.status === 'final' ? '<span class="dchip">FINAL</span>'
      : `<span class="dchip">${dLong(d.date)}</span>`;
  const center = (d.status === 'live' || d.status === 'final') && sc ? `<div class="mh-score">${sc.home} <span>-</span> ${sc.away}</div>` : '<div class="mh-vs">VS</div>';

  // Hero
  let html = detailHead((d.stageLabel ? d.stageLabel : 'Partido') + (d.group ? ' · Grupo ' + d.group : ''));
  html += `<div class="mh">
    <div class="mh-side" onclick="${th.id ? `openTeamPage('${th.id}')` : ''}">
      <span class="mh-flag">${th.flag}</span><span class="mh-name">${th.name}</span></div>
    <div class="mh-mid">${statusChip}${center}</div>
    <div class="mh-side right" onclick="${ta.id ? `openTeamPage('${ta.id}')` : ''}">
      <span class="mh-flag">${ta.flag}</span><span class="mh-name">${ta.name}</span></div>
  </div>`;
  if (mp) {
    html += `<div class="mh-probs">
      <div class="mhp"><span class="mhp-l">Modelo</span><span class="mhp-v blue">${pctD(mp.homeWin, 1)} · ${pctD(mp.draw, 1)} · ${pctD(mp.awayWin, 1)}</span></div>`;
    const pm = (d.marketPrices || []);
    const ph = pm.find(x => x.side === 'home'), pd = pm.find(x => x.side === 'draw'), pa = pm.find(x => x.side === 'away');
    if (ph || pa) html += `<div class="mhp"><span class="mhp-l">Mercado</span><span class="mhp-v">${ph ? cents(ph.price) : '—'} · ${pd ? cents(pd.price) : '—'} · ${pa ? cents(pa.price) : '—'}</span></div>`;
    html += `<div class="mhp"><span class="mhp-l">xG proyectado</span><span class="mhp-v">${mp.xgHome != null ? mp.xgHome.toFixed(2) : '—'} – ${mp.xgAway != null ? mp.xgAway.toFixed(2) : '—'} · marcador prob. ${mp.likelyScore || '—'}</span></div>`;
    html += `</div>`;
  } else html += du('Modelo no disponible para este partido (equipos por definir).');
  if (followsHome || followsAway) html += `<div class="follownote">★ Sigues a ${followsHome ? th.name : ''}${followsHome && followsAway ? ' y ' : ''}${followsAway ? ta.name : ''}</div>`;

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

  html += `<div class="disc">Las probabilidades son estimaciones de un modelo estadístico. No es consejo financiero ni recomendación de apuesta.</div>`;
  html += providerStatusHtml(d.providerStatus);
  $('#tab-match').innerHTML = html;
}

function panel(title, sub, body) {
  return `<div class="dpanel"><div class="dpanel-h"><span class="dpanel-t">${title}</span>${sub ? `<span class="dpanel-s">${sub}</span>` : ''}</div>${body}</div>`;
}

function matchGpTakeHtml(g) {
  if (!g) return panel('GP Take', '', du('Sin lectura disponible todavía.'));
  return panel('GP Take', '',
    `<div class="gptbox">
      <div class="gpt-top"><span class="grade ${gpGradeCls(g.label)}">${gpLabelTxt(g.label)}</span>
        <span class="gpt-conf">Confianza: ${g.confidence}</span>${g.risk ? `<span class="gpt-risk">Riesgo: ${g.risk}</span>` : ''}</div>
      <div class="gpt-title">${g.title}</div>
      <div class="gpt-sum">${g.summary}</div>
      ${(g.drivers || []).length ? `<ul class="gpt-drivers">${g.drivers.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
    </div>`);
}

function marketAnglesHtml(angles) {
  if (!angles || !angles.length) return panel('Ángulos de mercado', '', du('No hay ángulos disponibles para este evento.'));
  const rows = angles.map(a => `
    <div class="angle">
      <div class="angle-top"><span class="grade sm ${gpGradeCls(a.grade)}">${gpLabelTxt(a.grade)}</span><span class="angle-mkt">${a.market}</span>
        ${a.edge ? `<span class="angle-edge">+${pctD(a.edge, 1)}</span>` : ''}</div>
      <div class="angle-pick">${a.pick}</div>
      <div class="angle-line">Modelo <b class="blue">${pctD(a.modelProb, 0)}</b>${a.marketPrice != null ? ` · Mercado <b>${cents(a.marketPrice)}</b>` : ''}${a.venue ? ` · ${a.venue}` : ''}</div>
      <div class="angle-note">${a.note}</div>
    </div>`).join('');
  return panel('Ángulos de mercado', angles.length + '', rows);
}

function liveEventsHtml(d) {
  if (d.status === 'scheduled') return panel('Eventos', '', du('Los eventos aparecerán cuando comience el partido.'));
  let body = '';
  const ev = d.events || [];
  if (ev.length) {
    const icon = t => t === 'goal' ? '⚽' : t === 'yellow' ? '🟨' : t === 'red' ? '🟥' : t === 'subst' ? '↔' : t === 'var' ? 'VAR' : '•';
    body += '<div class="timeline">' + ev.sort((a, b) => (a.minute || 0) - (b.minute || 0)).map(e => `
      <div class="tl-row ${e.side || ''}">
        <span class="tl-min">${e.minute != null ? e.minute + "'" : ''}</span>
        <span class="tl-ic">${icon(e.type)}</span>
        <span class="tl-txt">${e.player || ''}${e.assist ? ` <span class="muted">(asist. ${e.assist})</span>` : ''}${e.detail && e.type === 'other' ? ' ' + e.detail : ''}</span>
      </div>`).join('') + '</div>';
  } else body += du('Sin eventos cargados todavía.');
  // stats
  const st = d.statistics;
  if (st && (st.home || st.away)) {
    const keys = [['possession', 'Posesión'], ['shots', 'Tiros'], ['shotsOnTarget', 'Al arco'], ['corners', 'Córners'], ['fouls', 'Faltas'], ['offsides', 'Fueras de juego'], ['yellowCards', 'Amarillas'], ['redCards', 'Rojas'], ['xg', 'xG']];
    const rows = keys.filter(([k]) => (st.home && st.home[k] != null) || (st.away && st.away[k] != null)).map(([k, lbl]) =>
      `<div class="stat-row"><span class="st-h">${st.home && st.home[k] != null ? st.home[k] : '—'}</span><span class="st-l">${lbl}</span><span class="st-a">${st.away && st.away[k] != null ? st.away[k] : '—'}</span></div>`).join('');
    if (rows) body += `<div class="stats-head"><span>${d.homeTeam.flag}</span><span class="muted">Estadísticas</span><span>${d.awayTeam.flag}</span></div>` + rows;
  } else if (d.status === 'live') body += du('Stats disponibles cuando avance el partido.');
  return panel('Eventos y estadísticas', d.status === 'live' ? 'EN VIVO' : 'FINAL', body);
}

function lineupTeamHtml(side, l, team) {
  if (!l) return `<div class="lu-col"><div class="lu-team">${team.flag} ${team.name}</div>${du('Las alineaciones suelen confirmarse 30-60 min antes.')}</div>`;
  const tag = l.confirmed ? '<span class="lu-tag ok">CONFIRMADA</span>' : '<span class="lu-tag">PROBABLE</span>';
  const pitch = pitchHtml(l);
  const players = (l.startXI || []).map(p => `<div class="lu-p"><span class="lu-n">${p.number != null ? p.number : '·'}</span><span class="lu-name">${p.name}</span><span class="lu-pos">${p.position || ''}</span></div>`).join('');
  return `<div class="lu-col">
    <div class="lu-team">${team.flag} ${team.name} ${tag}</div>
    <div class="lu-form">${l.formation ? 'Formación ' + l.formation : ''}${l.coach ? ' · DT ' + l.coach : ''}</div>
    ${pitch || players || du('XI pendiente.')}
  </div>`;
}
function lineupsHtml(d) {
  const lu = d.lineups || {};
  if (!lu.home && !lu.away) return panel('Alineaciones', '', du('Las alineaciones suelen confirmarse 30-60 minutos antes del partido.'));
  return panel('Alineaciones', '', `<div class="lu-grid">${lineupTeamHtml('home', lu.home, d.homeTeam)}${lineupTeamHtml('away', lu.away, d.awayTeam)}</div>`);
}

function formMiniHtml(f, team) {
  if (!f) return `<div class="form-col"><div class="form-team">${team.flag} ${team.name}</div>${du('Forma pendiente de actualización.')}</div>`;
  return `<div class="form-col">
    <div class="form-team">${team.flag} ${team.name}</div>
    <div class="form-chips">${formChips(f.results)}</div>
    <div class="form-stats">
      <span>GF <b>${f.goalsFor}</b></span><span>GC <b>${f.goalsAgainst}</b></span>
      <span>Vallas <b>${f.cleanSheets}</b></span><span>Racha <b>${f.streak || '—'}</b></span>
    </div></div>`;
}
function matchFormHtml(rf, th, ta) {
  rf = rf || {};
  if (!rf.home && !rf.away) return panel('Forma reciente', '', du('Forma reciente pendiente de actualización.'));
  return panel('Forma reciente', 'últimos 5', `<div class="form-grid">${formMiniHtml(rf.home, th)}${formMiniHtml(rf.away, ta)}</div>`);
}

function matchMarketsHtml(d, mp) {
  let body = '';
  if (mp) body += `<div class="mk-row"><span class="mk-l blue">Modelo 1X2</span><span class="mk-v">${pctD(mp.homeWin, 1)} · ${pctD(mp.draw, 1)} · ${pctD(mp.awayWin, 1)}</span></div>`;
  const pm = d.marketPrices || [];
  if (pm.length) {
    pm.forEach(o => { body += `<div class="mk-row"><span class="mk-l">${venueChip(o.venue)} ${o.side}</span><span class="mk-v">${cents(o.price)}${o.url ? ` <a class="mlink" href="${o.url}" target="_blank" rel="noopener">↗</a>` : ''}</span></div>`; });
  } else body += du('No hay mercado de predicción activo para este evento.');
  if (d.odds && d.odds.length) {
    const o = d.odds[0];
    body += `<div class="mk-row"><span class="mk-l">Cuotas (${o.book})</span><span class="mk-v">${o.home || '—'} · ${o.draw || '—'} · ${o.away || '—'}</span></div>`;
  }
  if (d.eventUrl) body += `<div class="formrow" style="margin-top:10px"><a class="venue-btn v-poly" href="${d.eventUrl}" target="_blank" rel="noopener">Abrir mercado en Polymarket ↗</a></div>`;
  return panel('Modelo · Mercado · Cuotas', '', body);
}

function matchNewsHtml(d) {
  const inj = d.injuries || [], news = d.news || [];
  if (!inj.length && !news.length) return panel('Lesiones y noticias', '', du('No hay lesiones o noticias relevantes cargadas.'));
  let body = '';
  if (inj.length) body += '<div class="inj-list">' + inj.map(i => `<div class="inj-row">${injuryBadge(i.status)}<span class="inj-p">${i.player}</span><span class="muted">${i.team || ''} ${i.reason ? '· ' + i.reason : ''}</span></div>`).join('') + '</div>';
  if (news.length) body += '<div class="news-list">' + news.map(n => `<a class="news-row" ${n.url ? `href="${n.url}" target="_blank" rel="noopener"` : ''}><div class="news-t">${n.title}</div><div class="news-m muted">${n.source}${n.published ? ' · ' + dShort(n.published) : ''}</div></a>`).join('') + '</div>';
  return panel('Lesiones y noticias', '', body);
}

function providerStatusHtml(ps) {
  if (!ps) return '';
  const parts = [];
  parts.push(ps.usedApiFootball ? 'API-Football ✓' : (ps.apiFootball === 'sin key' ? 'API-Football (sin key)' : 'API-Football —'));
  if (ps.usedEspnFallback) parts.push('ESPN fallback');
  if (ps.usedManualFallback) parts.push('manual');
  return `<div class="provstat">Fuentes: ${parts.join(' · ')} · act. ${dLong(ps.lastUpdated)}</div>`;
}

// =================== PÁGINA DE EQUIPO ===================
async function openTeamPage(id) {
  if (!USER) { openLogin(); return; }
  const c = currentTab(); if (c !== 'match' && c !== 'team') detailReturnTab = c;
  teamTab = 'resumen';
  openDetailTab('team');
  $('#tab-team').innerHTML = detailHead('Equipo') + '<div class="muted" style="padding:34px 0;text-align:center">Cargando equipo…</div>';
  try {
    const r = await fetch('/api/teamdetail/' + id, { headers: hdrs() });
    if (!r.ok) { if (r.status === 401) { openLogin(); return; } throw 0; }
    CUR_TEAM = await r.json();
    renderTeamDetail(CUR_TEAM);
  } catch { $('#tab-team').innerHTML = detailHead('Equipo') + du('No se pudo cargar el equipo. Intenta de nuevo.'); }
}
// compat: tarjetas existentes (Equipos, Grupos, Evolución, tablas) siguen llamando openTeam()
function openTeam(id) { return openTeamPage(id); }

function renderTeamDetail(d) {
  const followed = (USER.favorites || []).includes(d.id);
  const deltaTxt = d.eloDelta ? ` <span class="${d.eloDelta > 0 ? 'delta-up' : 'delta-down'}">${d.eloDelta > 0 ? '+' : ''}${d.eloDelta}</span>` : '';
  const nm = d.nextMatch;
  let hero = detailHead('Equipo');
  hero += `<div class="th">
    <span class="th-flag">${d.flag}</span>
    <div class="th-main">
      <div class="th-name">${d.name}</div>
      <div class="th-meta">Grupo ${d.group} · Elo ${d.elo}${deltaTxt} · Rank #${d.rank}${d.host ? ' · LOCAL' : ''}</div>
      <div class="th-champ">${pctD(d.championProbability, 1)} <span>campeón</span></div>
    </div>
    <button class="${followed ? 'btn-ghost on' : 'btn'}" onclick="toggleFavFromTeam('${d.id}')">${followed ? '★ Siguiendo' : '☆ Seguir'}</button>
  </div>`;
  if (nm) hero += `<div class="th-next" onclick="openMatchPage('${nm.id}')">Próximo · ${nm.home ? 'vs' : '@'} ${nm.opponent.flag} ${nm.opponent.name} · ${dLong(nm.datetime)} →</div>`;

  const tabs = [['resumen', 'Resumen'], ['plantilla', 'Plantilla'], ['forma', 'Forma'], ['resultados', 'Resultados'], ['mercados', 'Mercados'], ['noticias', 'Noticias']];
  const tabbar = `<div class="dtabs" id="teamTabs">${tabs.map(([k, l]) => `<button class="dtab ${k === teamTab ? 'on' : ''}" data-t="${k}" onclick="switchTeamTab('${k}')">${l}</button>`).join('')}</div>`;
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
  if (!d) return du('Sin datos.');
  if (tab === 'resumen') return teamResumenHtml(d);
  if (tab === 'plantilla') return teamSquadHtml(d);
  if (tab === 'forma') return teamFormHtml(d);
  if (tab === 'resultados') return teamResultsHtml(d);
  if (tab === 'mercados') return teamMarketsHtml(d);
  if (tab === 'noticias') return teamNewsHtml(d);
  return '';
}

function teamResumenHtml(d) {
  const probs = [['championProbability', 'Campeón'], ['finalProbability', 'Final'], ['semifinalsProbability', 'Semis'], ['quarterfinalsProbability', 'Cuartos'], ['advanceProbability', 'Avanzar'], ['groupWinProbability', 'Gana grupo'], ['outInGroupsProbability', 'Elim. grupos']];
  let body = '<div class="prob-grid">' + probs.map(([k, l]) =>
    `<div class="prob-cell"><div class="prob-l">${l}</div><div class="prob-v ${k === 'outInGroupsProbability' && d[k] > .3 ? 'pbad' : ''}">${pctD(d[k], 1)}</div></div>`).join('') + '</div>';
  body += `<div class="modelread"><div class="mr-h">MODEL READ</div><div class="mr-b">${d.modelRead}</div>`;
  if (d.keyDrivers && d.keyDrivers.length) body += `<ul class="mr-drivers">${d.keyDrivers.map(x => `<li>${x}</li>`).join('')}</ul>`;
  body += `</div>`;
  if (d.likelyOpponents && d.likelyOpponents.length) {
    body += `<div class="dsub">Cruces más probables en 16avos</div><div class="opp-list">` +
      d.likelyOpponents.map(o => `<button class="opp" onclick="openTeamPage('${o.id}')">${o.flag} ${o.name} <span class="muted">${pctD(o.pct, 0)}</span></button>`).join('') + '</div>';
  }
  let out = panel('Resumen del modelo', `${(d.sims || 0).toLocaleString()} torneos`, body);
  // caminos simulados (conserva la riqueza del modal anterior)
  if (d.samples && d.samples.length) {
    const runs = d.samples.slice(0, 6).map((run, i) => `<div class="simrun">#${i + 1} ${run.map(m => {
      const o = teamOf(m.vs);
      return `<span title="${STAGES_ES[m.stage] || m.stage}">${o ? o.flag : ''} ${m.score}${m.pen ? ' (pen)' : ''}</span>`;
    }).join(' · ')}</div>`).join('');
    out += panel('Caminos simulados al título', d.counts ? d.counts.champion + ' títulos' : '', runs);
  }
  if (d.explanation) out += panel('Lectura completa', '', `<div class="explain">${d.explanation}</div>`);
  return out;
}

function teamSquadHtml(d) {
  let body = '';
  if (d.keyPlayers && d.keyPlayers.length) {
    body += '<div class="dsub">Jugadores clave</div><div class="sq-list">' + d.keyPlayers.map(playerRow).join('') + '</div>';
  }
  if (d.squad && d.squad.length) {
    body += '<div class="dsub">Plantilla</div><div class="sq-list">' + d.squad.map(playerRow).join('') + '</div>';
  } else if (!d.keyPlayers || !d.keyPlayers.length) {
    body += du('Plantilla pendiente de actualización.');
  } else {
    body += du('Plantilla completa pendiente de actualización.');
  }
  let out = panel('Plantilla', d.squad && d.squad.length ? d.squad.length + ' jug.' : '', body);
  if (d.projectedLineup) out += projectedLineupHtml(d.projectedLineup, d);
  return out;
}
function playerRow(p) {
  return `<div class="sq-p"><span class="sq-n">${p.number != null ? p.number : '·'}</span>
    <span class="sq-name">${p.name}</span>
    <span class="sq-pos">${p.position || ''}${p.club ? ' · ' + p.club : ''}${p.age ? ' · ' + p.age + 'a' : ''}</span>
    ${p.status && p.status !== 'available' ? pStatusBadge(p.status) : ''}
    ${p.note ? `<span class="sq-note muted">${p.note}</span>` : ''}</div>`;
}
function projectedLineupHtml(l, d) {
  const tag = l.confirmed ? '<span class="lu-tag ok">CONFIRMADA</span>' : '<span class="lu-tag">PROBABLE</span>';
  const pitch = pitchHtml(l);
  const players = (l.startXI || []).map(p => `<div class="lu-p"><span class="lu-n">${p.number != null ? p.number : '·'}</span><span class="lu-name">${p.name}</span><span class="lu-pos">${p.position || ''}</span></div>`).join('');
  const body = `<div class="lu-form">${tag}${l.formation ? ' · Formación ' + l.formation : ''}${l.coach ? ' · DT ' + l.coach : ''}</div>${pitch || players || du('XI probable pendiente.')}`;
  return panel('Alineación probable', l.formation || '', body);
}

function teamFormHtml(d) {
  const f = d.recentForm;
  if (!f) return panel('Forma reciente', '', du('Forma reciente pendiente de actualización.'));
  let body = `<div class="form-chips big">${formChips(f.results)}</div>
    <div class="form-stats wide">
      <span>Pts <b>${f.points}</b></span><span>PJ <b>${f.played}</b></span>
      <span>GF <b>${f.goalsFor}</b></span><span>GC <b>${f.goalsAgainst}</b></span>
      <span>Vallas <b>${f.cleanSheets}</b></span>
      <span>Prom. GF <b>${f.avgFor}</b></span><span>Prom. GC <b>${f.avgAgainst}</b></span>
    </div>`;
  if (f.last && f.last.length) body += '<div class="dsub">Últimos partidos</div>' + f.last.map(m =>
    `<div class="res-row"><span class="fchip f-${(m.result || '').toLowerCase()}">${formLetter(m.result)}</span><span class="res-opp">${m.home ? 'vs' : '@'} ${m.opponent || '—'}</span><span class="res-sc">${m.score}</span><span class="muted">${dShort(m.date)}</span></div>`).join('');
  return panel('Forma reciente', '', body);
}

function teamResultsHtml(d) {
  let body = '';
  if (d.nextMatch) body += `<div class="dsub">Próximo partido</div><div class="res-row clk" onclick="openMatchPage('${d.nextMatch.id}')"><span class="res-opp">${d.nextMatch.home ? 'vs' : '@'} ${d.nextMatch.opponent.flag} ${d.nextMatch.opponent.name}</span><span class="muted">${dLong(d.nextMatch.datetime)} →</span></div>`;
  const res = d.results || [];
  if (res.length) {
    body += '<div class="dsub">En el Mundial</div>' + res.map(r => {
      const clk = /^G|^[0-9]/.test(r.id) ? `onclick="openMatchPage('${r.id}')"` : '';
      return `<div class="res-row clk" ${clk}><span class="fchip f-${(r.result || '').toLowerCase()}">${formLetter(r.result)}</span><span class="res-opp">${r.opponent ? (r.opponent.flag + ' ' + r.opponent.name) : '—'}</span><span class="res-sc">${r.score || ''}</span><span class="muted">${r.stageLabel || ''}</span></div>`;
    }).join('');
  } else if (!d.nextMatch) body += du('Aún no hay partidos jugados.');
  return panel('Resultados', '', body);
}

function teamMarketsHtml(d) {
  const mp = d.marketPrices || [];
  if (!mp.length) return panel('Mercados', '', du('No hay mercado activo para este equipo ahora mismo.'));
  let body = `<div class="mk-row"><span class="mk-l blue">Modelo · campeón</span><span class="mk-v">${pctD(d.championProbability, 1)}</span></div>`;
  mp.forEach(o => {
    const extra = o.venue === 'Polymarket' ? `Liq ${fmtUsd(o.liquidity)}` : `OI ${fmtUsd(o.openInterest)}`;
    body += `<a class="mk-card" ${o.url ? `href="${o.url}" target="_blank" rel="noopener"` : ''}>
      <div class="mkc-top">${venueChip(o.venue)}${chgBadge(o.change24h)}<span class="ext">↗</span></div>
      <div class="mkc-grid"><div><div class="mkt-lbl">Precio</div><div class="mkt-big">${cents(o.price)}</div></div>
        <div><div class="mkt-lbl">Modelo</div><div class="mkt-big model">${pctD(d.championProbability, 1)}</div></div>
        <div><div class="mkt-lbl">Edge</div><div class="mkt-big edge">${o.edge > 0 ? '+' + pctD(o.edge, 1) : pctD(o.edge, 1)}</div></div></div>
      <div class="mkc-foot muted">Vol ${fmtUsd(o.volume)} · ${extra}</div></a>`;
  });
  return panel('Mercados del equipo', '', body);
}

function teamNewsHtml(d) {
  const inj = d.injuries || [], side = d.sidelined || [], news = d.news || [];
  if (!inj.length && !side.length && !news.length) return panel('Noticias y lesiones', '', du('No hay noticias recientes para este equipo.'));
  let body = '';
  if (inj.length || side.length) body += '<div class="dsub">Lesiones y bajas</div><div class="inj-list">' +
    inj.concat(side).map(i => `<div class="inj-row">${injuryBadge(i.status)}<span class="inj-p">${i.player}</span><span class="muted">${i.reason || ''}</span></div>`).join('') + '</div>';
  if (news.length) body += '<div class="dsub">Noticias</div><div class="news-list">' +
    news.map(n => `<a class="news-row" ${n.url ? `href="${n.url}" target="_blank" rel="noopener"` : ''}><div class="news-t">${n.title}</div><div class="news-m muted">${n.source}${n.published ? ' · ' + dShort(n.published) : ''}</div></a>`).join('') + '</div>';
  return panel('Noticias y lesiones', '', body);
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
      <td class="teamcell">${t.flag} ${t.name}</td>
      <td>${r.pj}</td><td><b>${r.pts}</b></td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td>
      <td style="${heat(s.groupWin, 'g')}">${pct(s.groupWin, 0)}</td>
      <td style="${heat(s.groupSecond, 'g')}">${pct(s.groupSecond, 0)}</td>
      <td style="${heat(third, 'a')}">${pct(third, 0)}</td>
      <td style="${heat(s.outInGroups, 'r')}">${pct(s.outInGroups, 0)}</td>
    </tr>`;
  }).join('');
  $('#tab-groups').innerHTML = `
    <div style="margin-bottom:6px"><h2 style="margin-bottom:3px">Grupos</h2>
      <div class="muted" style="font-size:12px">Probabilidades de clasificación · 10,000 torneos simulados</div></div>
    <div class="gchips">${chips}</div>
    <div class="grp-wrap">
      <table class="grp-tbl">
        <tr><th></th><th>Equipo</th><th>PJ</th><th>Pts</th><th>DG</th><th>1º</th><th>2º</th><th>3º cl.</th><th>Fuera</th></tr>
        ${rows}
      </table>
    </div>
    <div class="grp-legend"><span><i class="lg g"></i>Clasifica 1º/2º</span><span><i class="lg a"></i>3º (repechaje)</span><span><i class="lg r"></i>Eliminado</span></div>`;
}

// ---------- PARTIDOS ----------
function fmtKickoff(f) {
  if (!f.datetime) return f.date;
  return new Date(f.datetime).toLocaleString([], {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function matchCard(f, homeId, awayId, matchId) {
  const r = f.result;
  const score = r ? `${r.hg} - ${r.ag}` : 'vs';
  const pens = r && r.pensHome != null && r.hg === r.ag && r.status === 'final'
    ? `<div class="muted" style="font-size:9px">penales: ${r.pensHome ? 'local' : 'visitante'}</div>` : '';
  const status = r ? (r.status === 'live' ? `<div class="live">● EN VIVO ${r.minute}'</div>` : '<div class="muted" style="font-size:9px">FINAL</div>')
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
    <div class="plabels"><span>${pct(probs.home)} gana</span><span>empate ${pct(probs.draw)}</span><span>gana ${pct(probs.away)}</span></div>
    <div class="plabels"><span>xG ${probs.xgHome.toFixed(2)}</span><span class="muted">marcador más probable ${probs.likelyScore}</span><span>xG ${probs.xgAway.toFixed(2)}</span></div>` : ''}
  </div>`;
}

function renderMatches() {
  const sync = STATE.sync || {};
  let html = `<h2>Partidos · calendario oficial</h2>
    <div class="muted" style="margin-bottom:14px;font-size:11px">
      ${sync.ok ? '🟢' : '🟡'} Los marcadores se sincronizan automáticamente cada 30 segundos (fuente: ESPN).
      ${sync.ts ? 'Última sincronización: ' + new Date(sync.ts).toLocaleTimeString() + '.' : ''}
      Horarios mostrados en tu zona horaria local.
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
    html += `<div class="mday" style="color:var(--accent)">${live.length ? '● EN VIVO Y PRÓXIMOS' : 'PRÓXIMOS PARTIDOS'}</div>`;
    html += pinned.map(x => matchCard(x.f, x.home, x.away, x.id)).join('');
    html += `<div class="mday" style="margin-top:30px">CALENDARIO COMPLETO</div>`;
  }

  for (let md = 1; md <= 3; md++) {
    html += `<div class="mday">JORNADA ${md} · FASE DE GRUPOS</div>`;
    html += STATE.fixtures.filter(f => f.matchday === md)
      .sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''))
      .map(f => matchCard(f, f.home, f.away, f.id)).join('');
  }
  const stages = [['R32', '16AVOS DE FINAL'], ['R16', 'OCTAVOS'], ['QF', 'CUARTOS'], ['SF', 'SEMIFINALES'], ['3RD', 'TERCER PUESTO'], ['FINAL', 'FINAL']];
  for (const [st, name] of stages) {
    const ms = STATE.knockout.filter(k => k.stage === st);
    html += `<div class="mday">${name}</div>`;
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
  if (side.t === 'W') return `1º Grupo ${side.g}`;
  if (side.t === 'R') return `2º Grupo ${side.g}`;
  if (side.t === 'T3') return `3º (${side.allowed.join('/')})`;
  if (side.t === 'M') return `Ganador P${side.m}`;
  if (side.t === 'L') return `Perdedor P${side.m}`;
}
function renderBracket() {
  const rounds = [['R32', '16avos'], ['R16', 'Octavos'], ['QF', 'Cuartos'], ['SF', 'Semifinales'], ['3RD', '3er puesto'], ['FINAL', 'Final']];
  $('#tab-bracket').innerHTML = `<div style="margin-bottom:14px"><h2 style="margin-bottom:3px">Bracket</h2>
    <div class="muted" style="font-size:12px">Cuadro de eliminación · estructura oficial FIFA · desliza para ver todas las rondas</div></div>
    <div class="bracket">` +
    rounds.map(([st, name]) => `<div class="bround ${st === 'FINAL' ? 'fin' : ''}"><h4>${name}</h4>` +
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
  const labelOf = s => s === 'home' ? th.name : s === 'away' ? ta.name : 'el empate';
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
      reason: rejected
        ? `Hay diferencias de precio, pero solo implicarían apostar contra el favorito o a un resultado improbable — eso no es valor real. Mejor PASS.`
        : `Modelo y mercado prácticamente coinciden. Sin ventaja clara — preferimos no jugar este partido.` };
  }
  const lbl = labelOf(best.side);
  let reason;
  if (best.dir === 'back') {
    const ctx = best.side === 'draw'
      ? 'el modelo ve el partido más cerrado de lo que el mercado descuenta'
      : `el modelo le da más probabilidad a ${lbl} de la que el precio implica`;
    reason = `Valor en <b>${lbl}</b>: el mercado lo paga a ${cents(best.price)} y nuestro modelo lo ve en ${pct(best.p)} — ${ctx}.`;
  } else {
    reason = `El mercado <b>sobrevalora a ${lbl}</b> (${cents(best.price)}) frente al ${pct(best.p)} del modelo — el valor está en ir en contra.`;
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
    ? '<span class="vchip v-poly">◆ Polymarket</span>'
    : '<span class="vchip v-kalshi">◆ Kalshi</span>';
}

// etiquetas de liquidez / riesgo / confianza para las tarjetas premium
function liqLabel(usd) { return usd >= 2e6 ? 'Alta' : usd >= 4e5 ? 'Media' : 'Baja'; }
function riskLabel(p) { return p >= 0.55 ? 'Bajo' : p >= 0.38 ? 'Medio' : 'Alto'; }
function confLabel(edge) { return edge >= 0.10 ? 'Alta' : edge >= 0.05 ? 'Media' : 'Baja'; }
function riskCls(l) { return l === 'Bajo' ? 'r-low' : l === 'Medio' ? 'r-mid' : 'r-high'; }

async function loadArb(force = false) {
  $('#tab-arb').innerHTML = '<div class="muted" style="padding:40px 0;text-align:center">Cargando mercados en vivo…</div>';
  const r = await fetch('/api/arbitrage' + (force ? '?force=1' : ''), { headers: hdrs() });
  if (!r.ok) {
    $('#tab-arb').innerHTML = `<div class="lock"><div class="lock-icon">🔒</div>
      <div class="lock-title">Desbloquea las oportunidades gratis</div>
      <div class="lock-sub">Crea tu cuenta para ver el escáner de oportunidades modelo vs mercado.</div>
      <button class="btn" onclick="openLogin()">Crear cuenta gratis</button></div>`;
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
        <h2 style="margin-bottom:3px">Oportunidades</h2>
        <div class="muted" style="font-size:12px">
          <span class="livepill on">● EN VIVO</span> Modelo vs mercado · actualizado ${ARB.ts ? new Date(ARB.ts).toLocaleTimeString() : '—'} · refresca cada 1 min
        </div>
      </div>
      <button class="ghost" onclick="loadArb(true)">↻ Actualizar</button>
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
      html += `<div class="sec-head"><h3>★ Mejor oportunidad</h3></div>
      <div class="feat">
        <div class="feat-top">
          <span class="sig sig-edge">MODEL EDGE</span>${venueChip(best.venue)}
          <span class="feat-edge">+${pct(best.edge)}</span>
        </div>
        <div class="feat-team"><span style="font-size:30px">${t ? t.flag : ''}</span>
          <div><div class="feat-name">${t ? t.name : best.team}</div><div class="feat-side">${best.side} · campeón del Mundial</div></div>
        </div>
        <div class="feat-metrics">
          <div class="metric"><div class="m-l">Precio</div><div class="m-v">${cents(best.price)}</div></div>
          <div class="metric"><div class="m-l">Modelo</div><div class="m-v blue">${pct(best.model)}</div></div>
          <div class="metric"><div class="m-l">Edge</div><div class="m-v green">+${pct(best.edge)}</div></div>
          <div class="metric"><div class="m-l">Kelly/4</div><div class="m-v">${best.kelly ? pct(best.kelly) : '—'}</div></div>
          <div class="metric"><div class="m-l">Liquidez</div><div class="m-v">${liq}</div></div>
          <div class="metric"><div class="m-l">Riesgo</div><div class="m-v ${riskCls(risk)}">${risk}</div></div>
          <div class="metric"><div class="m-l">Confianza</div><div class="m-v">${conf}</div></div>
        </div>
        <div class="feat-cta">
          ${v ? `<a class="venue-btn v-${best.venue === 'Polymarket' ? 'poly' : 'kalshi'}" href="${v.url}" target="_blank" rel="noopener">Abrir mercado en ${best.venue} ↗</a>` : ''}
          <button class="btn-ghost" onclick="openTeam('${best.team}')">Ver análisis</button>
        </div>
      </div>`;
    } else {
      const pm = best.row.polymarket, ks = best.row.kalshi, t = teamOf(best.team);
      html += `<div class="sec-head"><h3>★ Mejor oportunidad</h3></div>
      <div class="feat feat-arb">
        <div class="feat-top"><span class="sig sig-arb">PURE ARB</span><span class="feat-edge amber">+${pct(best.edge)} neto</span></div>
        <div class="feat-team"><span style="font-size:30px">${t ? t.flag : ''}</span>
          <div><div class="feat-name">${t ? t.name : best.team}</div><div class="feat-side">${best.note}</div></div>
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
    html += `<div class="sec-head"><h3><span class="dot-amber">◆</span> Arbitraje puro</h3><span class="sub">${pure.length} detectado${pure.length > 1 ? 's' : ''}</span></div>
    <div class="muted" style="font-size:12px;margin:-4px 0 12px">Polymarket y Kalshi se contradicen: comprando en ambas ganas la diferencia, gane quien gane. Retorno neto estimado — depende de ejecución, fees y settlement.</div>
    <div class="arbops">` + pure.slice(0, 6).map(o => {
      const pm = o.row.polymarket, ks = o.row.kalshi;
      return `<div class="dualcard">
        <div class="dual-top">
          <span style="font-size:22px">${teamOf(o.team) ? teamOf(o.team).flag : ''}</span>
          <b style="font-size:16px">${teamOf(o.team) ? teamOf(o.team).name : o.team}</b>
          <span class="purebadge">PURE ARB</span>
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
  html += `<div class="sec-head"><h3><span class="dot-green">●</span> Apuestas de valor · modelo vs mercado</h3><span class="sub">${value.length}</span></div>
    <div class="muted" style="font-size:12px;margin:-4px 0 12px">Donde nuestras 10,000 simulaciones discrepan más del precio. Toca para ir al mercado exacto.</div>`;
  if (!value.length) html += '<div class="muted" style="margin-bottom:8px">Sin discrepancias relevantes ahora mismo.</div>';
  html += '<div class="mktgrid">' + value.slice(0, 9).map(o => {
    const v = o.venue === 'Polymarket' ? o.row.polymarket : o.row.kalshi;
    if (!v) return '';
    const t = teamOf(o.team);
    return `<a class="mktcard" href="${v.url}" target="_blank" rel="noopener">
      <div class="mkt-top">${venueChip(o.venue)}${chgBadge(v.change24h)}<span class="ext">↗</span></div>
      <div class="mkt-team"><span style="font-size:24px">${t ? t.flag : ''}</span><b>${t ? t.name : o.team}</b><span class="sidetag">${o.side}</span></div>
      <div class="mkt-prices">
        <div><div class="mkt-lbl">Precio</div><div class="mkt-big">${cents(v.price)}</div></div>
        <div><div class="mkt-lbl">Modelo</div><div class="mkt-big model">${pct(o.model)}</div></div>
        <div><div class="mkt-lbl">Edge</div><div class="mkt-big edge">+${pct(o.edge)}</div></div>
      </div>
      <div class="mkt-stats">
        <span>Vol ${fmtUsd(v.volume)}</span>
        <span>${o.venue === 'Polymarket' ? 'Liq ' + fmtUsd(v.liquidity) : 'OI ' + fmtUsd(v.openInterest)}</span>
        ${o.kelly ? `<span class="kelly">Kelly/4 ${pct(o.kelly)}</span>` : ''}
        <button class="sharebtn" onclick="shareOp(event, '📊 ${t ? t.name : o.team} campeón del Mundial: el mercado paga ${cents(v.price)} y el modelo de 10,000 simulaciones dice ${pct(o.model)} (+${pct(o.edge)} de edge).')">📤</button>
      </div>
    </a>`;
  }).join('') + '</div>';

  // ---- 4. PARTIDOS · GP TAKE ----
  if (M.length) {
    html += `<div class="sec-head"><h3><span style="color:var(--blue)">⚽</span> Partidos · GP Take</h3><span class="sub">${M.length} con mercado</span></div>
    <div class="muted" style="font-size:12px;margin:-4px 0 12px">Nuestro modelo vs el mercado 1X2, graduado. Mostramos también los PASS. Toca un resultado para abrir su mercado.</div>
    <div class="mktgrid">` + M.map(m => {
      const th = teamOf(m.home), ta = teamOf(m.away);
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
      const shareTxt = `⚽ ${th.name} vs ${ta.name}: el mercado paga ${cents(m.outcomes.home.price)} / ${m.outcomes.draw ? cents(m.outcomes.draw.price) : '—'} / ${cents(m.outcomes.away.price)} y nuestro modelo dice ${pct(m.model.home)} / ${pct(m.model.draw)} / ${pct(m.model.away)}.`;
      return `<div class="mktcard matchmkt">
        <div class="mkt-top">
          ${venueChip('Polymarket')}
          ${m.live ? `<span class="livepill">● EN VIVO${m.result ? ' ' + m.result.hg + '-' + m.result.ag : ''}</span>` : `<span class="muted" style="font-size:11px;font-weight:600">${fmtKickoff(m)}</span>`}
          <button class="sharebtn" onclick="shareOp(event, '${shareTxt.replace(/'/g, '')}')">📤</button>
        </div>
        <div class="mkt-team" style="margin-bottom:10px"><span style="font-size:20px">${th.flag}</span><b>${th.name} vs ${ta.name}</b><span style="font-size:20px">${ta.flag}</span></div>
        <div class="gptake">
          <div class="gptake-head"><span class="grade ${take.cls}">${take.grade}</span><span class="gptake-title">GP TAKE</span>${take.edge ? `<span class="gptake-edge">+${pct(take.edge)}</span>` : ''}</div>
          <div class="gptake-reason">${take.reason}</div>
        </div>
        <div class="oc-head"><span></span><span>Mercado</span><span>Modelo</span><span>Edge</span></div>
        ${row('home', th.name, th.flag)}
        ${row('draw', 'Empate')}
        ${row('away', ta.name, ta.flag)}
        <button class="btn-ghost ver-mas" onclick="openMatchPage('${m.fixtureId}')">Ver análisis del partido →</button>
      </div>`;
    }).join('') + '</div>';
  }

  // ---- 5. FAVORITOS DEL MODELO (tabla compacta) ----
  const favs = [...STATE.teams].sort((a, b) => b.sim.champion - a.sim.champion).slice(0, 8);
  html += `<div class="sec-head"><h3>🏆 Favoritos del modelo</h3></div>
    <table class="fav-tbl"><tr><th>#</th><th>Equipo</th><th>Campeón</th><th>Mercado 24h</th><th>Grupo</th></tr>` +
    favs.map((t, i) => {
      const m = ARB.rows.find(r => r.id === t.id);
      const ch = m && m.polymarket ? m.polymarket.change24h : null;
      return `<tr onclick="openTeam('${t.id}')">
        <td class="muted">${i + 1}</td>
        <td class="teamcell">${t.flag} ${t.name}</td>
        <td><b>${pct(t.sim.champion)}</b></td>
        <td>${ch != null ? chgBadge(ch) : '<span class="muted">—</span>'}</td>
        <td class="muted">${t.group}</td></tr>`;
    }).join('') + '</table>';

  html += `<div class="warn" style="margin-top:22px">⚠ ${ARB.disclaimer}</div>`;

  // ---- tabla completa con datos de mercado ----
  html += `<details class="fulltbl"><summary>Los 48 mercados · campeón del mundo</summary>
    <div style="overflow-x:auto">
    <table class="arbtable"><tr><th>Equipo</th><th>Modelo</th><th>Polymarket</th><th>24h</th><th>Vol</th><th>Kalshi</th><th>24h</th><th>Vol</th><th>Edge</th></tr>` +
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
    <div style="margin-bottom:10px"><h2 style="margin-bottom:3px">Evolución</h2>
      <div class="muted" style="font-size:12px">Probabilidad de campeón a lo largo del torneo</div></div>
    <div class="gchips" style="margin-bottom:14px">
      <button class="gchip ${evoFilter === 'top' ? 'on' : ''}" onclick="selectEvo('top')">Top 10</button>
      <button class="gchip ${evoFilter === 'mine' ? 'on' : ''}" onclick="selectEvo('mine')">Mis seguidos</button>
    </div>
    <div class="evo-chart"><canvas id="evoChart" width="1120" height="420"></canvas></div>
    <div id="evoLegend"></div>
    <div id="evoTable"></div>`;
  const cv = $('#evoChart'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const hist = STATE.history || [];
  if (hist.length < 2) {
    ctx.fillStyle = '#6F7A82'; ctx.font = '13px Inter, sans-serif';
    ctx.fillText('La evolución aparecerá cuando se jueguen partidos y cambien las probabilidades.', 24, 36);
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
    `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${t.flag} ${t.name} ${pct(t.sim.champion)}</span>`).join('');
  const start = hist.length ? hist[0].probs : {};
  $('#evoTable').innerHTML = `<table class="fav-tbl" style="margin-top:16px">
    <tr><th>#</th><th>Equipo</th><th>Prob actual</th><th>Desde inicio</th><th>Grupo</th></tr>` +
    sel.map((t, i) => {
      const d = t.sim.champion - (start[t.id] || t.sim.champion);
      const dTxt = Math.abs(d) < 0.0005 ? '<span class="muted">—</span>' : `<span class="${d > 0 ? 'pgood' : 'pbad'}">${d > 0 ? '▲' : '▼'} ${(Math.abs(d) * 100).toFixed(1)}%</span>`;
      return `<tr onclick="openTeam('${t.id}')"><td class="muted">${i + 1}</td><td class="teamcell">${t.flag} ${t.name}</td><td><b>${pct(t.sim.champion)}</b></td><td>${dTxt}</td><td class="muted">${t.group}</td></tr>`;
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
    <div class="gcard">
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
      <h3>EMAIL MASIVO DE NOVEDADES</h3>
      <div class="muted" style="font-size:12px;margin-bottom:10px">Envía a TODOS los usuarios el correo de novedades (con su link de referido personal). Prueba primero contigo.</div>
      <div class="formrow">
        <button class="ghost" onclick="broadcastNews(true)">✉ Enviarme una prueba</button>
        <button class="btn" onclick="broadcastNews(false)">📣 Enviar a TODOS</button>
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
      <div id="userBase" class="muted">Cargando…</div>
    </div>`;
  loadUsers();
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
async function broadcastNews(test) {
  if (bcastBusy) return; // evita doble/triple envío por clics repetidos
  if (!test && !confirm('¿Enviar el email de novedades a TODOS los usuarios? Esto no se puede deshacer.')) return;
  bcastBusy = true;
  document.querySelectorAll('[onclick^="broadcastNews"]').forEach(b => b.disabled = true);
  const msg = $('#bcastMsg'); msg.textContent = test ? 'Enviando prueba…' : 'Enviando a todos… (puede tardar)';
  try {
    const r = await fetch('/api/admin/broadcast', { method: 'POST', headers: hdrs(), body: JSON.stringify({ test }) });
    const j = await r.json();
    msg.textContent = r.ok ? `✓ Enviados ${j.sent}/${j.total}${j.failed ? ` · fallos ${j.failed}` : ''}${j.test ? ' (prueba)' : ''}` : '✗ ' + (j.error || 'error');
  } catch { msg.textContent = '✗ Error de red'; }
  finally { bcastBusy = false; document.querySelectorAll('[onclick^="broadcastNews"]').forEach(b => b.disabled = false); }
}

async function loadUsers() {
  const r = await fetch('/api/admin/users', { headers: hdrs() });
  if (!r.ok) { $('#userBase').textContent = 'Error al cargar usuarios.'; return; }
  const j = await r.json();
  const fmt = ts => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const sources = Object.entries(j.bySource || {}).sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `<span class="chip"><b style="display:inline">${n}</b> ${s}</span>`).join(' ');
  $('#userBase').innerHTML = `
    <div class="formrow" style="align-items:center">
      <span style="color:var(--text)"><b>${j.total}</b> usuarios registrados</span>
      <button class="ghost" onclick="exportUsersCSV()">⬇ Exportar CSV</button>
    </div>
    <div class="formrow" style="gap:8px"><span class="muted" style="font-size:11px">FUENTES:</span> ${sources}</div>
    <div class="muted" style="font-size:11px;margin-bottom:8px">Comparte links con ?ref= para atribuir: gpsimulador.com/?ref=x · ?ref=ig · ?ref=wa</div>
    <table><tr><th>Email</th><th>Fuente</th><th>Registro</th><th>Última visita</th><th>Favoritos</th></tr>
    ${j.users.map(u => `<tr><td>${u.email}</td><td><b>${u.ref}</b></td><td>${fmt(u.createdAt)}</td><td>${fmt(u.lastSeen)}</td><td>${u.favorites}</td></tr>`).join('')}
    </table>`;
  window._users = j.users;
}

function exportUsersCSV() {
  const rows = [['email', 'fuente', 'registro', 'ultima_visita', 'favoritos'],
  ...(window._users || []).map(u => [u.email, u.ref, new Date(u.createdAt).toISOString(), new Date(u.lastSeen).toISOString(), u.favorites])];
  const csv = rows.map(r => r.join(',')).join('\n');
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
  { n: 1, reward: 'Embajador 🏅' },
  { n: 3, reward: 'Embajador Plata 🥈' },
  { n: 5, reward: 'Embajador Oro 🥇' },
  { n: 10, reward: 'Embajador Leyenda 👑' },
];
function refLink() { return 'https://gpsimulador.com/?ref=' + ((USER && USER.refCode) || ''); }
async function renderReferidos() {
  if (!USER) return;
  // refresca refCode + contador desde el servidor (tras login USER aún no los tiene)
  try { const r = await fetch('/api/me', { headers: hdrs() }); if (r.ok) { const me = await r.json(); USER.refCode = me.refCode; USER.referrals = me.referrals; } } catch { }
  const n = USER.referrals || 0;
  const link = refLink();
  const next = REF_TIERS.find(t => t.n > n);
  const level = [...REF_TIERS].reverse().find(t => n >= t.n);
  let html = `<div style="margin-bottom:14px"><h2 style="margin-bottom:3px">Invita y sube de nivel 🎁</h2>
    <div class="muted" style="font-size:12px">Comparte tu link. Cada amigo que cree su cuenta te sube como Embajador del GP Simulador.</div></div>`;
  html += `<div class="ref-hero">
    <div class="ref-count">${n}</div>
    <div class="ref-count-lbl">amigo${n === 1 ? '' : 's'} invitado${n === 1 ? '' : 's'}${level ? ` · ${level.reward}` : ''}</div>
    <div class="ref-next">${next ? `Te falta${next.n - n === 1 ? '' : 'n'} <b>${next.n - n}</b> para: ${next.reward}` : '¡Nivel máximo alcanzado! 👑'}</div>
  </div>`;
  html += `<div class="dpanel"><div class="dpanel-h"><span class="dpanel-t">Tu link de invitación</span></div>
    <div class="ref-linkbox"><input id="refLinkInput" readonly value="${link}"><button class="btn" onclick="copyRef(event)">Copiar</button></div>
    <button class="btn-ghost" style="width:100%;margin-top:10px" onclick="shareRef()">Compartir 📤</button></div>`;
  html += `<div class="dpanel"><div class="dpanel-h"><span class="dpanel-t">Niveles de Embajador</span></div>` +
    REF_TIERS.map(t => `<div class="ref-tier ${n >= t.n ? 'done' : ''}"><span class="ref-tier-n">${n >= t.n ? '✓' : t.n}</span><span class="ref-tier-r">${t.reward}</span><span class="ref-tier-goal">${t.n} amigo${t.n > 1 ? 's' : ''}</span></div>`).join('') + `</div>`;
  html += `<div class="muted" style="font-size:11.5px;text-align:center;margin-top:8px">Los Embajadores tendrán beneficios exclusivos cuando evolucionemos la plataforma. ¡Gracias por correr la voz! ⚽</div>`;
  $('#tab-referidos').innerHTML = html;
}
function copyRef(ev) {
  const i = $('#refLinkInput'); if (!i) return;
  i.select(); i.setSelectionRange(0, 99999);
  const done = () => { const b = ev && ev.currentTarget; if (b) { const o = b.textContent; b.textContent = '¡Copiado!'; setTimeout(() => b.textContent = o, 1500); } };
  if (navigator.clipboard) navigator.clipboard.writeText(i.value).then(done).catch(() => { try { document.execCommand('copy'); done(); } catch { } });
  else { try { document.execCommand('copy'); done(); } catch { } }
}
function shareRef() {
  const text = '⚽ Mira las probabilidades del Mundial 2026 EN VIVO (gratis) en GP Simulador:';
  const url = refLink();
  if (navigator.share) { navigator.share({ title: 'GP Simulador del Mundial', text, url }).catch(() => { }); }
  else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank');
}

// ---------- SIMULADOR: simula cualquier cruce ----------
let CUR_SIM = null;
function renderSim() {
  if (!USER) return;
  const teams = [...STATE.teams].sort((a, b) => a.name.localeCompare(b.name));
  const opts = () => teams.map(t => `<option value="${t.id}">${t.flag} ${t.name}</option>`).join('');
  $('#tab-sim').innerHTML = `
    <div style="margin-bottom:10px"><h2 style="margin-bottom:3px">Simula cualquier cruce ⚔️</h2>
      <div class="muted" style="font-size:12px">Enfrenta a cualquiera de las 48 selecciones — cancha neutral, según el modelo (10.000 simulaciones).</div></div>
    <div class="sim-pick">
      <select id="simA" class="searchbox" style="margin:0">${opts()}</select>
      <span class="sim-vs">VS</span>
      <select id="simB" class="searchbox" style="margin:0">${opts()}</select>
    </div>
    <div class="formrow" style="margin-top:12px"><button class="btn" style="width:100%" onclick="simulate()">⚔️ Simular cruce</button></div>
    <div id="simResult"></div>`;
  $('#simA').value = 'ARG'; $('#simB').value = 'ESP';
  simulate();
}
async function simulate() {
  const a = $('#simA').value, b = $('#simB').value;
  if (a === b) { $('#simResult').innerHTML = du('Elige dos selecciones distintas.'); return; }
  $('#simResult').innerHTML = '<div class="muted" style="padding:24px 0;text-align:center">🧠 Analizando con GP Intelligence…<br><span style="font-size:11px">modelo base + contexto + 10.000 simulaciones</span></div>';
  GPI_OPEN = false;
  try {
    const r = await fetch(`/api/h2h/deep?a=${a}&b=${b}`, { headers: hdrs() });
    if (!r.ok) { if (r.status === 401) { openLogin(); return; } throw 0; }
    CUR_SIM = await r.json();
    $('#simResult').innerHTML = simHeadlineHtml(CUR_SIM);
  } catch { $('#simResult').innerHTML = du('No se pudo simular. Intenta de nuevo.'); }
}

// Headline del cruce: el resultado YA es v2 (GP Intelligence). Debajo, botón para el análisis integral.
function simHeadlineHtml(d) {
  const p = d.probs, base = d.base, ctx = d.context;
  const moved = Math.abs(ctx.deltaA) + Math.abs(ctx.deltaB) > 2;
  return `
    <div class="dpanel" style="margin-top:14px">
      <div class="sim-teams">
        <div class="sim-side"><div class="sim-flag">${d.a.flag}</div><div class="sim-name">${d.a.name}</div><div class="muted" style="font-size:11px">Elo ${d.a.elo}${ctx.deltaA ? ` <span class="${ctx.deltaA > 0 ? 'pgood' : 'pbad'}">${ctx.deltaA > 0 ? '+' : ''}${ctx.deltaA}</span>` : ''}</div></div>
        <div class="sim-vs2">VS</div>
        <div class="sim-side"><div class="sim-flag">${d.b.flag}</div><div class="sim-name">${d.b.name}</div><div class="muted" style="font-size:11px">Elo ${d.b.elo}${ctx.deltaB ? ` <span class="${ctx.deltaB > 0 ? 'pgood' : 'pbad'}">${ctx.deltaB > 0 ? '+' : ''}${ctx.deltaB}</span>` : ''}</div></div>
      </div>
      <div class="pbar" style="margin-top:16px"><div class="ph" style="width:${p.aWin * 100}%"></div><div class="pd" style="width:${p.draw * 100}%"></div><div class="pa" style="width:${p.bWin * 100}%"></div></div>
      <div class="plabels"><span>${pct(p.aWin)} gana</span><span>empate ${pct(p.draw)}</span><span>gana ${pct(p.bWin)}</span></div>
      <div class="plabels" style="margin-top:6px"><span>xG ${p.xgA.toFixed(2)}</span><span class="muted">marcador prob. ${p.likely}</span><span>xG ${p.xgB.toFixed(2)}</span></div>
      ${moved ? `<div class="gpi-decomp">Modelo base: ${pct(base.aWin, 0)} · ${pct(base.draw, 0)} · ${pct(base.bWin, 0)} <span class="gpi-arrow">→</span> <b>GP Intelligence integra el contexto</b></div>` : ''}
      <div class="gpi-actions">
        <button class="btn" style="flex:1" onclick="toggleGpi()"><span id="gpiBtnTx">🧠 Ver análisis GP Intelligence</span></button>
        <button class="cta-sm" onclick="shareSim(event)" title="Compartir">📤</button>
      </div>
      <div id="simAnalysis" class="gpi-wrap"></div>
    </div>`;
}

let GPI_OPEN = false;
function toggleGpi() {
  GPI_OPEN = !GPI_OPEN;
  const wrap = $('#simAnalysis'), tx = $('#gpiBtnTx');
  if (!GPI_OPEN) { wrap.innerHTML = ''; tx.textContent = '🧠 Ver análisis GP Intelligence'; return; }
  tx.textContent = '✕ Ocultar análisis';
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

  // 1) VEREDICTO — confianza del MODELO y calidad de DATOS son conceptos separados (B9)
  const mConf = h.modelConfidence ? h.modelConfidence.level : '—';
  const dQual = h.dataQuality ? h.dataQuality.level : '—';
  html += panel('GP Intelligence · Veredicto', d.dataSource, `
    <div class="gptbox">
      <div class="gpt-top"><span class="grade ${verdictCls(h.verdictLabel)}">${h.verdictLabel}</span>
        <span class="gpt-conf">Confianza modelo: ${mConf}</span><span class="gpt-conf">Calidad datos: ${dQual}</span></div>
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
  html += panel('V1 control → V2 challenger', 'modelo base vs GP Intelligence', `
    ${decRow('V1 (modelo base)', dec.baseLine, false)}
    ${decRow('V2 (GP Intelligence)', dec.v2Line, true)}
    <div class="gpi-deltas">
      <span>${d.a.flag} ${d.a.name}: ${ppChip(dpp.aWin)}</span>
      <span>empate: ${ppChip(dpp.draw)}</span>
      <span>${d.b.flag} ${d.b.name}: ${ppChip(dpp.bWin)}</span>
    </div>
    <div class="gpi-deltas">
      <span>Contexto Elo ${d.a.name}: ${impChip(dec.deltaA)}</span>
      <span>Contexto Elo ${d.b.name}: ${impChip(dec.deltaB)}</span>
    </div>
    <div class="gpi-note">El modelo global (V1) sigue siendo el control. V2 es un challenger experimental solo en este sandbox: ajusta el Elo de cada equipo (cap de seguridad) y reconstruye la probabilidad. El delta es V2 − V1 en puntos porcentuales.</div>`);

  // 3) FACTORES CLAVE (ambos equipos, ordenados por peso; excluidos atenuados)
  if (an.factors && an.factors.length) {
    const rows = an.factors.map(f => `
      <div class="gpi-factor${f.included ? '' : ' gpi-excluded'}">
        <div class="gpi-fac-h"><span class="gpi-fac-team">${f.flag} ${f.team}</span>${f.included ? impChip(f.eloImpact) : `<span class="gpi-imp flat">omitido</span>`}</div>
        <div class="gpi-fac-l">${f.label}${f.group ? ` · <span class="gpi-grp">${f.group}</span>` : ''}</div>
        <div class="gpi-fac-d">${f.detail}${f.included ? '' : ` · <span class="pbad">excluido: ${f.exclusionReason}</span>`}</div>
      </div>`).join('');
    html += panel('Factores que pesan', an.factors.length + '', `<div class="gpi-factors">${rows}</div>`);
  }

  // 4) MONTE CARLO — distribución del cruce
  const maxP = Math.max(...mc.topScores.map(s => s.p));
  const scoreBars = mc.topScores.map(s => `
    <div class="gpi-sc">
      <span class="gpi-sc-s">${s.score}</span>
      <div class="gpi-sc-bar"><div style="width:${(s.p / maxP) * 100}%"></div></div>
      <span class="gpi-sc-p">${pct(s.p, 0)}</span>
    </div>`).join('');
  html += panel('Monte Carlo · 10.000 simulaciones', 'contexto integrado', `
    <div class="gpi-sc-grid">${scoreBars}</div>
    <div class="gpi-mc-stats">
      <div class="gpi-stat"><span class="v">${pct(mc.over25, 0)}</span><span class="l">Over 2.5</span></div>
      <div class="gpi-stat"><span class="v">${pct(mc.btts, 0)}</span><span class="l">Ambos marcan</span></div>
      <div class="gpi-stat"><span class="v">${mc.avgTotal.toFixed(2)}</span><span class="l">Goles/partido</span></div>
      <div class="gpi-stat"><span class="v">${mc.avgMargin.toFixed(2)}</span><span class="l">Margen prom.</span></div>
    </div>
    <div class="gpi-note">${an.monteCarlo.narrative}</div>`);

  // 4b) GOLES Y TOTALES — mercados accionables para apostadores (Over/Under, total, distribución por equipo)
  if (d.goals) {
    const g = d.goals;
    const ouRow = (label, over) => `
      <div class="gpi-ou">
        <span class="gpi-ou-l">${label}</span>
        <div class="gpi-ou-split"><div class="gpi-ou-fill" style="width:${over * 100}%"></div><span class="gpi-ou-o">Over ${pct(over, 0)}</span><span class="gpi-ou-u">Under ${pct(1 - over, 0)}</span></div>
      </div>`;
    const teamGoals = (dist, flag, name) => `
      <div class="gpi-tg">
        <div class="gpi-tg-h">${flag} ${name}</div>
        <div class="gpi-tg-cells">
          ${[['0', dist.g0], ['1', dist.g1], ['2', dist.g2], ['3+', dist.g3]].map(([n, p]) => `<div class="gpi-tg-c"><span class="n">${n}</span><span class="p">${pct(p, 0)}</span></div>`).join('')}
        </div>
      </div>`;
    html += panel('Goles y totales', 'para totales', `
      <div class="gpi-ou-wrap">
        ${ouRow('1.5 goles', g.over15)}
        ${ouRow('2.5 goles', g.over25)}
        ${ouRow('3.5 goles', g.over35)}
      </div>
      <div class="gpi-mc-stats" style="margin-top:13px">
        <div class="gpi-stat"><span class="v">${g.mostLikelyTotal}</span><span class="l">Total más prob.</span></div>
        <div class="gpi-stat"><span class="v">${pct(g.mostLikelyTotalP, 0)}</span><span class="l">Prob. de ese total</span></div>
        <div class="gpi-stat"><span class="v">${g.avgTotal.toFixed(2)}</span><span class="l">Goles esperados</span></div>
        <div class="gpi-stat"><span class="v">${pct(g.btts, 0)}</span><span class="l">Ambos marcan</span></div>
      </div>
      <div class="dsub" style="margin-top:14px">Goles por equipo (probabilidad)</div>
      ${teamGoals(g.teamA, d.a.flag, d.a.name)}
      ${teamGoals(g.teamB, d.b.flag, d.b.name)}
      <div class="gpi-note">${d.context.goalModel ? 'Modelo de goles: ' + d.context.goalModel + '. ' : ''}xG ${d.probs.xgA.toFixed(2)} – ${d.probs.xgB.toFixed(2)}. Distribución de las 10.000 simulaciones.</div>`);
  }

  // 5) LECTURA TÁCTICA (si hay editorial). La nota puede ser texto o {style,strengths[],risks[]}.
  const tacHtml = (t, team, flag) => {
    if (!t) return '';
    if (typeof t === 'string') return `<div class="gpi-tac"><b>${flag} ${team}:</b> ${t}</div>`;
    const tags = (arr, cls) => (arr && arr.length) ? `<div class="gpi-tac-tags">${arr.map(x => `<span class="gpi-tag ${cls}">${x}</span>`).join('')}</div>` : '';
    return `<div class="gpi-tac"><b>${flag} ${team}:</b> ${t.style || ''}
      ${tags(t.strengths, 'up')}${tags(t.risks, 'down')}</div>`;
  };
  const tA = tacHtml(d.tactical && d.tactical.a, d.a.name, d.a.flag), tB = tacHtml(d.tactical && d.tactical.b, d.b.name, d.b.flag);
  if (tA || tB) html += panel('Lectura táctica', '', tA + tB);

  // 6) INSIGHTS determinísticos (anclados a métricas) + qué cambiaría
  const insights = an.insights || [];
  const sevCls = s => s === 'warn' ? 'down' : 'up';
  html += panel('Lectura y riesgos', '', `
    <div class="dsub">A vigilar</div>
    <ul class="gpt-drivers">${insights.map(i => `<li><span class="gpi-ins ${sevCls(i.severity)}">${i.text}</span></li>`).join('')}</ul>
    <div class="dsub" style="margin-top:10px">Qué cambiaría la lectura</div>
    <ul class="gpt-drivers">${an.whatChanges.map(x => `<li>${x}</li>`).join('')}</ul>`);

  // 7) TRAZABILIDAD — "Cómo llegó GP a este resultado" (colapsable, B11)
  html += traceabilityHtml(d);

  html += `<div class="disc">V1 (modelo global) es el control; V2 (GP Intelligence) es un challenger experimental solo en este sandbox y no afecta al track record. Cancha neutral, sin factor localía. Estimaciones de un modelo estadístico + contexto. No es consejo financiero ni recomendación de apuesta.</div>`;
  return html;
}

// Panel colapsable de trazabilidad: modelo base, contexto, resultado y calidad de datos (sin secretos).
function traceabilityHtml(d) {
  const dec = d.analysis.decomposition, ctx = d.context, run = d.run || {}, v = d.versions || {};
  const factorLines = side => (side || []).filter(f => f.axis === 'elo' && f.factorCode !== 'NO_CONTEXT').map(f =>
    `<div class="gpi-tr-row"><span>${labelForFactor(f.factorCode)}</span><span>${f.included ? (f.cappedContribution > 0 ? '+' : '') + f.cappedContribution + ' Elo' : '<span class="pbad">omitido (' + f.exclusionReason + ')</span>'}</span></div>`).join('');
  const dqA = ctx.dataQualityA || {}, dqB = ctx.dataQualityB || {};
  const omitted = [...(dqA.missing || []), ...(dqA.stale || []), ...(dqB.missing || []), ...(dqB.stale || [])];
  return `<details class="gpi-trace">
    <summary>🔎 Cómo llegó GP a este resultado</summary>
    <div class="gpi-tr-body">
      <div class="gpi-tr-h">Modelo base (V1)</div>
      <div class="gpi-tr-row"><span>${d.a.flag} ${d.a.name} · Elo base</span><span>${d.a.elo}</span></div>
      <div class="gpi-tr-row"><span>${d.b.flag} ${d.b.name} · Elo base</span><span>${d.b.elo}</span></div>
      <div class="gpi-tr-row"><span>Probabilidad V1</span><span>${pct(dec.baseLine.aWin, 1)} · ${pct(dec.baseLine.draw, 1)} · ${pct(dec.baseLine.bWin, 1)}</span></div>
      <div class="gpi-tr-h">Contexto · ${d.a.name}</div>${factorLines(ctx.factorsA)}
      <div class="gpi-tr-row strong"><span>Ajuste total ${d.a.name}</span><span>${dec.deltaA > 0 ? '+' : ''}${dec.deltaA} Elo</span></div>
      <div class="gpi-tr-h">Contexto · ${d.b.name}</div>${factorLines(ctx.factorsB)}
      <div class="gpi-tr-row strong"><span>Ajuste total ${d.b.name}</span><span>${dec.deltaB > 0 ? '+' : ''}${dec.deltaB} Elo</span></div>
      <div class="gpi-tr-h">Resultado (V2)</div>
      <div class="gpi-tr-row"><span>Elo ajustado</span><span>${d.a.elo + dec.deltaA} · ${d.b.elo + dec.deltaB}</span></div>
      <div class="gpi-tr-row"><span>Probabilidad V2</span><span>${pct(dec.v2Line.aWin, 1)} · ${pct(dec.v2Line.draw, 1)} · ${pct(dec.v2Line.bWin, 1)}</span></div>
      <div class="gpi-tr-h">Calidad de datos</div>
      <div class="gpi-tr-row"><span>Nivel</span><span>${(d.analysis.headline.dataQuality || {}).level || '—'}</span></div>
      <div class="gpi-tr-row"><span>Factores omitidos</span><span>${omitted.length ? omitted.join(', ') : 'ninguno'}</span></div>
      <div class="gpi-tr-row"><span>Fuente</span><span>${d.dataSource}</span></div>
      <div class="gpi-tr-row"><span>Versión modelo</span><span>${v.control || '—'} / ${v.challenger || '—'}</span></div>
      <div class="gpi-tr-row"><span>Seed · sims</span><span>${run.randomSeed != null ? run.randomSeed : '—'} · ${run.simulationCount || '—'}</span></div>
      ${run.sanity && !run.sanity.ok ? `<div class="gpi-tr-row"><span class="pbad">Sanity</span><span class="pbad">${run.sanity.errors.join('; ')}</span></div>` : ''}
    </div>
  </details>`;
}
function labelForFactor(code) {
  return ({ FORM: 'Forma reciente', STREAK: 'Racha', SOLIDITY: 'Solidez/fragilidad', SQUAD_QUALITY: 'Calidad de plantilla', AVAILABILITY: 'Bajas y dudas', REST: 'Descanso/carga' })[code] || code;
}

function shareSim(ev) {
  if (!CUR_SIM) return; const d = CUR_SIM, p = d.probs;
  const fav = p.aWin >= p.bWin ? d.a : d.b, favP = Math.max(p.aWin, p.bWin);
  const txt = `⚔️ ${d.a.flag} ${d.a.name} vs ${d.b.name} ${d.b.flag} — análisis GP Intelligence (modelo + contexto + 10.000 sims):\n${d.a.name} ${pct(p.aWin)} · empate ${pct(p.draw)} · ${d.b.name} ${pct(p.bWin)} · marcador probable ${p.likely}.\nSimula tu cruce gratis:`;
  shareOp(ev, txt);
}

// ---------- LOGIN ----------
function openLogin() {
  if (USER) {
    openModal(`<h2>Sesión</h2><p>${USER.email}${USER.isAdmin ? ' · <span class="pgood">ADMIN</span>' : ''}</p>
      <div class="formrow"><button class="btn" onclick="logout()">Cerrar sesión</button></div>`);
    return;
  }
  openModal(`<h2>Entrar o crear cuenta</h2>
    <p class="muted">Solo tu email. Te enviamos un código de 6 dígitos: sirve igual si ya tienes cuenta o si es tu primera vez.</p>
    <div class="formrow"><input id="loginEmail" type="email" placeholder="tu@email.com" style="flex:1">
    <button class="btn" onclick="requestCode()">Enviar código</button></div>
    <div id="loginStep2"></div><div id="loginMsg" class="warn"></div>`);
}
async function requestCode() {
  const email = $('#loginEmail').value.trim();
  const r = await fetch('/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
  const j = await r.json();
  if (!r.ok) { $('#loginMsg').textContent = j.error; return; }
  $('#loginStep2').innerHTML = `
    ${j.sent
      ? `<p style="color:var(--accent)">📬 Te enviamos el código a <b>${$('#loginEmail').value.trim()}</b>.<br>
         <span class="muted">Si no lo ves en 1 minuto, revisa Promociones o Spam.</span></p>`
      : `<p class="warn">Modo demo (sin SMTP): tu código es <b>${j.demoCode}</b></p>`}
    <div class="formrow"><input id="loginCode" placeholder="código de 6 dígitos" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
    <button class="btn" onclick="verifyCode()">Verificar y entrar</button></div>`;
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
  USER = { email: j.email, isAdmin: j.isAdmin, favorites: j.favorites, alerts: j.alerts };
  ARB = null; // fuerza recargar Oportunidades en este login (evita que quede el candado del teaser)
  closeModal(); renderHeader(); await loadState(); switchTab('arb');
  if (currentTab() === 'arb' && !ARB) loadArb(); // garantía extra: cargar arb aunque el estado venga raro
}
async function logout() { localStorage.removeItem('wc_token'); USER = null; ARB = null; closeAvatarMenu(); closeSheet(); renderHeader(); await loadState(); switchTab('teams'); }

// ---------- modal / tabs / SSE ----------
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').style.display = 'flex'; }
function closeModal() { $('#modal').style.display = 'none'; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

function notifyUpdate(reason, ts) {
  const b = $('#banner');
  b.textContent = `⚡ Probabilidades actualizadas en tiempo real (${reason}) · ${new Date(ts).toLocaleTimeString()}`;
  b.style.display = '';
  setTimeout(() => b.style.display = 'none', 6000);
}

// Tiempo real: SSE con fallback automático a polling (túneles/proxies que bufferean streams)
let pollTimer = null, lastVersion = null;
function setLive(on) { const p = $('#livePill'); if (p) p.classList.toggle('on', on); }
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

(async () => { await loadMe(); await loadState(); if (USER && !STATE.teaser) switchTab('arb'); renderTicker(); connectSSE(); })();
