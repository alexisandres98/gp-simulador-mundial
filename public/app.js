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
  STATE = await (await fetch('/api/state', { headers: hdrs() })).json();
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
  let html = `<h2>Track record del modelo · transparencia total</h2>
    <div class="muted" style="font-size:12.5px;margin:-8px 0 16px">
      Cada predicción queda registrada con los datos que el modelo tenía <b>antes</b> del partido. Aciertos y fallos, todo público.
    </div>
    <div class="statrow" style="grid-template-columns:repeat(3,1fr)">
      <div class="bigstat"><div class="lbl">Partidos evaluados</div><div class="val">${d.total}</div></div>
      <div class="bigstat"><div class="lbl">Ganador acertado</div><div class="val pgood">${d.winners}/${d.total}${d.total ? ` <span style="font-size:15px">(${pctW}%)</span>` : ''}</div></div>
      <div class="bigstat"><div class="lbl">Marcador exacto 🎯</div><div class="val" style="color:var(--amber)">${d.exact}</div></div>
    </div>
    <div class="formrow"><button class="ghost" onclick="shareOp(event, '⚽ El modelo de GP Simulador va ${d.winners}/${d.total} acertando ganadores del Mundial (${d.exact} marcadores exactos). Míralo en vivo:')">📤 Compartir track record</button></div>
    ${(USER && USER.isAdmin && d.total) ? `<div class="explain" style="border-left-color:var(--blue)">
      📊 <b>Calibración (solo admin):</b> Brier ${d.brier} (azar 3-vías = 0.66, más bajo = mejor) ·
      prob. media al resultado real ${pct(d.avgProbActual)} · empate medio ${pct(d.matches.reduce((s, m) => s + m.probs.draw, 0) / d.matches.length)}.</div>
      ${marketScoreboardHtml(d.vsMarket)}` : ''}`;
  if (!d.total) {
    html += '<div class="muted">Los primeros resultados aparecerán al terminar los próximos partidos.</div>';
  }
  html += d.matches.map(m => {
    const th = teamOf(m.home), ta = teamOf(m.away);
    const pickLabel = m.predicted === 'home' ? `Gana ${th ? th.name : m.home}` : m.predicted === 'away' ? `Gana ${ta ? ta.name : m.away}` : 'Empate';
    return `<div class="mcard" style="grid-template-columns:auto 1fr auto;gap:14px">
      <div style="font-size:22px;font-weight:800;font-family:var(--font-head)">${m.correct ? '✅' : '❌'}${m.exact ? '🎯' : ''}</div>
      <div>
        <div style="font-weight:700">${th ? th.flag + ' ' + th.name : m.home} ${m.hg} - ${m.ag} ${ta ? ta.name + ' ' + ta.flag : m.away}</div>
        <div class="muted" style="font-size:12px">El modelo decía: <b>${pickLabel}</b> (${pct(m.predictedProb)}) · marcador más probable ${m.likelyScore}${m.exact ? ' — <b style="color:var(--amber)">EXACTO</b>' : ''}</div>
      </div>
      <div class="muted" style="font-size:11px">${new Date(m.datetime).toLocaleDateString([], { day: 'numeric', month: 'short' })}</div>
    </div>`;
  }).join('');
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
  alerts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
};
const TABS = {
  arb: 'Oportunidades', matches: 'Partidos', teams: 'Equipos', groups: 'Grupos',
  following: 'Seguidos', alerts: 'Alertas', bracket: 'Bracket', record: 'Aciertos', evo: 'Evolución', admin: 'Admin',
};
const OUT_NAV = ['teams', 'groups', 'matches', 'bracket', 'arb'];
const IN_TOPNAV = ['arb', 'matches', 'teams', 'groups', 'following', 'bracket', 'record', 'evo'];
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
    $('#hdRight').innerHTML = `<button class="cta-sm" onclick="openLogin()">Crear cuenta gratis</button>`;
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
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  const sec = $('#tab-' + name); if (sec) sec.classList.add('active');
  if (STATE && !STATE.teaser) {
    if (name === 'arb' && !ARB) loadArb();
    if (name === 'evo') renderEvo();
    if (name === 'record') renderRecord();
    if (name === 'following') renderFollowing();
    if (name === 'alerts') renderAlerts();
  }
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
  html += `<button onclick="switchTab('following')">${ICON.following}<span>Seguidos</span></button>`;
  html += `<button onclick="switchTab('alerts')">${ICON.alerts}<span>Alertas</span></button>`;
  html += `<button onclick="switchTab('bracket')">${ICON.bracket}<span>Bracket</span></button>`;
  html += `<button onclick="switchTab('record')">${ICON.record}<span>Aciertos</span></button>`;
  html += `<button onclick="switchTab('evo')">${ICON.evo}<span>Evolución</span></button>`;
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
      <span class="fc-flag">${t.flag}</span>
      <div class="fc-main">
        <div class="fc-name">${t.name}</div>
        <div class="fc-meta">${meta}</div>
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
    <div class="teamgrid">` + teams.map(t => `
    <div class="tcard" onclick="openTeam('${t.id}')">
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

// ---------- detalle de equipo ----------
async function openTeam(id) {
  const r = await fetch('/api/team/' + id, { headers: hdrs() });
  if (!r.ok) { openLogin(); return; }
  const d = await r.json();
  const t = teamOf(id), s = d.sim, c = s.counts;
  const favBtn = USER ? `<button class="ghost" onclick="toggleFav('${id}')">${(USER.favorites || []).includes(id) ? '★ Quitar favorito' : '☆ Seguir equipo'}</button>` : '';
  openModal(`
    <div class="trow" style="display:flex;align-items:center;gap:10px">
      <span style="font-size:30px">${t.flag}</span>
      <div><div style="font-size:20px;font-weight:700">${t.name}</div>
      <div class="muted" style="font-size:11px">ELO ${t.currentElo} · RANK #${[...STATE.teams].sort((a,b)=>b.currentElo-a.currentElo).findIndex(x=>x.id===id)+1} · GRUPO ${t.group}</div></div>
      <div style="margin-left:auto">${favBtn}</div>
    </div>
    <div class="statrow">
      <div class="bigstat"><div class="lbl">Mejor caso · Probabilidad de campeonato</div>
        <div class="val pgood">${pct(s.champion)}</div>
        <div class="muted" style="font-size:10px">IC 95% ${pct(s.ciLow)}–${pct(s.ciHigh)}</div></div>
      <div class="bigstat"><div class="lbl">Peor caso · Eliminado en grupos</div>
        <div class="val ${s.outInGroups > .3 ? 'pbad' : ''}">${pct(s.outInGroups)}</div>
        <div class="muted" style="font-size:10px">gana su grupo el ${pct(s.groupWin)}</div></div>
    </div>
    <div class="muted" style="font-size:10px;letter-spacing:1px">EXPLORA SIMULACIONES · ${s.sims.toLocaleString()} TORNEOS</div>
    <div class="roundchips">
      <div class="chip"><b>${c.champion}</b>CAMPEÓN ${pct(s.champion)}</div>
      <div class="chip"><b>${c.final - c.champion}</b>SUBCAMPEÓN</div>
      <div class="chip"><b>${c.third}</b>3ER PUESTO</div>
      <div class="chip"><b>${c.fourth}</b>4º PUESTO</div>
      <div class="chip"><b>${c.qf - c.sf}</b>CUARTOS</div>
      <div class="chip"><b>${c.r16 - c.qf}</b>OCTAVOS</div>
      <div class="chip"><b>${c.r32 - c.r16}</b>16AVOS</div>
      <div class="chip"><b>${c.groupOut}</b>FUERA EN GRUPOS ${pct(s.outInGroups)}</div>
    </div>
    <div class="explain">${d.explanation}</div>
    ${s.samples.length ? `<div class="muted" style="font-size:10px;letter-spacing:1px;margin-top:14px">CAMPEÓN: ${c.champion} SIMULACIONES · ${s.samples.length} EJEMPLOS MUESTREADOS</div>
    ${s.samples.map((run, i) => `<div class="simrun">#${i + 1} ${run.map(m => {
      const o = teamOf(m.vs);
      return `<span title="${STAGES_ES[m.stage] || m.stage}">${o ? o.flag : ''} ${m.score}${m.pen ? ' (pen)' : ''}</span>`;
    }).join(' · ')}</div>`).join('')}` : '<div class="muted">Sin títulos en las simulaciones muestreadas.</div>'}
  `);
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
function renderGroups() {
  $('#tab-groups').innerHTML = '<h2>Fase de grupos · probabilidades de avanzar</h2><div class="groupgrid">' +
    STATE.groups.map(g => {
      const rows = STATE.standings[g].map(r => {
        const t = teamOf(r.id), s = t.sim;
        const third = Math.max(0, s.reachR32 - s.groupWin - s.groupSecond);
        return `<tr>
          <td class="teamcell" onclick="openTeam('${t.id}')">${t.flag} ${t.name}</td>
          <td>${r.pj}</td><td><b>${r.pts}</b></td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td>
          <td class="pgood">${pct(s.groupWin, 0)}</td>
          <td>${pct(s.groupSecond, 0)}</td>
          <td class="pmid">${pct(third, 0)}</td>
          <td class="pbad">${pct(s.outInGroups, 0)}</td>
        </tr>`;
      }).join('');
      return `<div class="gcard"><h3>GRUPO ${g}</h3>
        <table><tr><th>Equipo</th><th>PJ</th><th>Pts</th><th>DG</th><th>1º</th><th>2º</th><th>3º clas.</th><th>Fuera</th></tr>${rows}</table></div>`;
    }).join('') + '</div>';
}

// ---------- PARTIDOS ----------
function fmtKickoff(f) {
  if (!f.datetime) return f.date;
  return new Date(f.datetime).toLocaleString([], {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

function matchCard(f, homeId, awayId) {
  const r = f.result;
  const score = r ? `${r.hg} - ${r.ag}` : 'vs';
  const pens = r && r.pensHome != null && r.hg === r.ag && r.status === 'final'
    ? `<div class="muted" style="font-size:9px">penales: ${r.pensHome ? 'local' : 'visitante'}</div>` : '';
  const status = r ? (r.status === 'live' ? `<div class="live">● EN VIVO ${r.minute}'</div>` : '<div class="muted" style="font-size:9px">FINAL</div>')
    : `<div class="muted" style="font-size:9px">${fmtKickoff(f)}</div>`;
  const probs = f.probs;
  return `<div class="mcard">
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
      ${sync.ok ? '🟢' : '🟡'} Los marcadores se sincronizan automáticamente cada 2 minutos (fuente: ESPN).
      ${sync.ts ? 'Última sincronización: ' + new Date(sync.ts).toLocaleTimeString() + '.' : ''}
      Horarios mostrados en tu zona horaria local.
    </div>`;
  for (let md = 1; md <= 3; md++) {
    html += `<div class="mday">JORNADA ${md} · FASE DE GRUPOS</div>`;
    html += STATE.fixtures.filter(f => f.matchday === md)
      .sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''))
      .map(f => matchCard(f, f.home, f.away)).join('');
  }
  const stages = [['R32', '16AVOS DE FINAL'], ['R16', 'OCTAVOS'], ['QF', 'CUARTOS'], ['SF', 'SEMIFINALES'], ['3RD', 'TERCER PUESTO'], ['FINAL', 'FINAL']];
  for (const [st, name] of stages) {
    const ms = STATE.knockout.filter(k => k.stage === st);
    html += `<div class="mday">${name}</div>`;
    html += ms.sort((a, b) => (a.datetime || a.date).localeCompare(b.datetime || b.date)).map(k => {
      const h = (k.result && k.result.home) || k.resolved.home;
      const a = (k.result && k.result.away) || k.resolved.away;
      if (h && a) return matchCard(k, h, a);
      return `<div class="mcard"><div class="side muted">${slotDesc(k.home)}</div>
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
  $('#tab-bracket').innerHTML = '<h2>Bracket · estructura oficial FIFA</h2><div class="bracket">' +
    rounds.map(([st, name]) => `<div class="bround"><h4>${name}</h4>` +
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
        return `<div class="bmatch"><div class="num">P${k.m} · ${k.date}</div>
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
          <span class="livepill on">● EN VIVO</span> Modelo vs mercado · actualizado ${ARB.ts ? new Date(ARB.ts).toLocaleTimeString() : '—'} · refresca cada 5 min
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
const PALETTE = ['#0BA661', '#2E7CF6', '#E5484D', '#D97706', '#8B5CF6', '#0D9488', '#DB2777', '#65A30D', '#EA580C', '#0891B2'];
function renderEvo() {
  // el muro de registro pudo haber reemplazado el contenido de la pestaña: reconstruir el lienzo
  if (!$('#evoChart')) {
    $('#tab-evo').innerHTML = '<canvas id="evoChart" width="1100" height="420"></canvas><div id="evoLegend"></div>';
  }
  const cv = $('#evoChart'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const hist = STATE.history;
  if (hist.length < 2) {
    ctx.fillStyle = '#64748B'; ctx.font = '13px Inter, sans-serif';
    ctx.fillText('La evolución aparecerá cuando se jueguen partidos y cambien las probabilidades.', 30, 40);
    $('#evoLegend').innerHTML = '';
    return;
  }
  const top = [...STATE.teams].sort((a, b) => b.sim.champion - a.sim.champion).slice(0, 10);
  const maxP = Math.max(.05, ...hist.flatMap(h => top.map(t => h.probs[t.id] || 0))) * 1.15;
  const X = i => 50 + i / (hist.length - 1) * (cv.width - 70);
  const Y = p => cv.height - 30 - p / maxP * (cv.height - 50);
  ctx.strokeStyle = '#E4E8EF'; ctx.fillStyle = '#64748B'; ctx.font = '11px Inter, sans-serif';
  for (let g = 0; g <= 4; g++) {
    const p = maxP * g / 4, y = Y(p);
    ctx.beginPath(); ctx.moveTo(50, y); ctx.lineTo(cv.width - 20, y); ctx.stroke();
    ctx.fillText(pct(p, 0), 8, y + 3);
  }
  top.forEach((t, ti) => {
    ctx.strokeStyle = PALETTE[ti]; ctx.lineWidth = 2; ctx.beginPath();
    hist.forEach((h, i) => { const y = Y(h.probs[t.id] || 0); i ? ctx.lineTo(X(i), y) : ctx.moveTo(X(i), y); });
    ctx.stroke();
  });
  $('#evoLegend').innerHTML = top.map((t, i) =>
    `<span><i style="background:${PALETTE[i]}"></i>${t.flag} ${t.name} ${pct(t.sim.champion)}</span>`).join('');
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
      <h3>BASE DE USUARIOS</h3>
      <div id="userBase" class="muted">Cargando…</div>
    </div>`;
  loadUsers();
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

// ---------- LOGIN ----------
function openLogin() {
  if (USER) {
    openModal(`<h2>Sesión</h2><p>${USER.email}${USER.isAdmin ? ' · <span class="pgood">ADMIN</span>' : ''}</p>
      <div class="formrow"><button class="btn" onclick="logout()">Cerrar sesión</button></div>`);
    return;
  }
  openModal(`<h2>Entrar con email</h2>
    <p class="muted">Te enviamos un código de 6 dígitos para verificar tu email.</p>
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
  closeModal(); renderHeader(); await loadState(); switchTab('arb');
}
async function logout() { localStorage.removeItem('wc_token'); USER = null; closeAvatarMenu(); closeSheet(); renderHeader(); await loadState(); switchTab('teams'); }

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
        notifyUpdate('nuevo resultado', v.sim);
      } else if (lastVersion && v.markets !== lastVersion.markets && $('#tab-arb').classList.contains('active')) {
        loadArb();
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
    notifyUpdate(d.reason, d.ts);
  });
  es.addEventListener('markets', () => { if ($('#tab-arb').classList.contains('active')) loadArb(); });
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
