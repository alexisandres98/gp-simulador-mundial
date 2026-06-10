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
  STATE = await (await fetch('/api/state')).json();
  renderAll();
}
async function loadMe() {
  if (!token()) return;
  const r = await fetch('/api/me', { headers: hdrs() });
  if (r.ok) { USER = await r.json(); } else { localStorage.removeItem('wc_token'); USER = null; }
  renderHeader();
}

function renderHeader() {
  $('#loginBtn').textContent = USER ? USER.email : 'Entrar con email';
  $('#adminTab').style.display = USER && USER.isAdmin ? '' : 'none';
}

function renderAll() {
  renderTeams(); renderGroups(); renderMatches(); renderBracket(); renderEvo(); renderAdmin();
  if ($('#tab-arb').classList.contains('active')) loadArb();
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
  const d = await (await fetch('/api/team/' + id)).json();
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
  const r = await fetch('/api/favorite', { method: 'POST', headers: hdrs(), body: JSON.stringify({ teamId: id }) });
  if (r.ok) { USER.favorites = (await r.json()).favorites; closeModal(); renderTeams(); }
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
function matchCard(f, homeId, awayId) {
  const r = f.result;
  const score = r ? `${r.hg} - ${r.ag}` : (f.probs ? f.probs.likelyScore.replace('-', ' - ') : 'vs');
  const status = r ? (r.status === 'live' ? `<div class="live">● EN VIVO ${r.minute}'</div>` : '<div class="muted" style="font-size:9px">FINAL</div>')
    : `<div class="muted" style="font-size:9px">${f.date}${f.stage === 'group' ? ' (aprox)' : ''}</div>`;
  const probs = f.probs;
  return `<div class="mcard">
    <div class="side">${tlabel(homeId)}</div>
    <div class="score">${score}${status}</div>
    <div class="side away">${tlabel(awayId)}</div>
    ${probs ? `<div class="pbar">
      <div class="ph" style="width:${probs.home * 100}%"></div>
      <div class="pd" style="width:${probs.draw * 100}%"></div>
      <div class="pa" style="width:${probs.away * 100}%"></div></div>
    <div class="plabels"><span>${pct(probs.home)} gana</span><span>empate ${pct(probs.draw)}</span><span>gana ${pct(probs.away)}</span></div>
    <div class="plabels"><span>xG ${probs.xgHome.toFixed(2)}</span><span class="muted">marcador más probable ${probs.likelyScore}</span><span>xG ${probs.xgAway.toFixed(2)}</span></div>` : ''}
  </div>`;
}

function renderMatches() {
  let html = '<h2>Partidos · fase de grupos</h2>';
  for (let md = 1; md <= 3; md++) {
    html += `<div class="mday">JORNADA ${md}</div>`;
    html += STATE.fixtures.filter(f => f.matchday === md)
      .sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group))
      .map(f => matchCard(f, f.home, f.away)).join('');
  }
  html += '<h2 style="margin-top:30px">Eliminación directa</h2>';
  for (const k of STATE.knockout) {
    if (k.result && k.result.home) {
      html += `<div class="mday">${STAGES_ES[k.stage]} · PARTIDO ${k.m}</div>` +
        matchCard({ ...k, date: k.date }, k.result.home, k.result.away);
    }
  }
  html += '<div class="muted" style="margin-top:10px">Los cruces de eliminación aparecen aquí cuando el admin los registra. El bracket proyectado está en la pestaña Bracket.</div>';
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
        const h = r && r.home ? tlabel(r.home) : slotDesc(k.home);
        const a = r && r.away ? tlabel(r.away) : slotDesc(k.away);
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
async function loadArb(force = false) {
  $('#tab-arb').innerHTML = '<h2>Arbitraje · cargando mercados…</h2>';
  ARB = await (await fetch('/api/arbitrage' + (force ? '?force=1' : ''))).json();
  const ops = [];
  ARB.rows.forEach(r => r.edges.forEach(e => ops.push({ ...e, team: r.id, model: r.model })));
  ops.sort((a, b) => (b.type === 'arbitraje') - (a.type === 'arbitraje') || b.edge - a.edge);
  let html = `<h2>Oportunidades · modelo vs Polymarket & Kalshi</h2>
    <div class="formrow">
      <button class="btn" onclick="loadArb(true)">↻ Actualizar precios</button>
      <span class="muted">Última actualización: ${ARB.ts ? new Date(ARB.ts).toLocaleTimeString() : '—'}</span>
      ${ARB.errors.length ? `<span class="pbad">${ARB.errors.join(' · ')}</span>` : ''}
    </div>
    <div class="warn">⚠ ${ARB.disclaimer}</div>`;
  if (!ops.length) html += '<div class="muted">Sin oportunidades con edge > 1.5% en este momento.</div>';
  html += '<div class="arbops">' + ops.slice(0, 20).map(o => `
    <div class="opcard ${o.type === 'arbitraje' ? 'pure' : ''}">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <b>${tlabel(o.team)}</b>
        <span class="${o.type === 'arbitraje' ? 'pmid' : 'pgood'}" style="font-size:10px;letter-spacing:1px">${o.type === 'arbitraje' ? '◆ ARBITRAJE PURO' : '● APUESTA DE VALOR'}</span>
        <span>${o.venue} · ${o.side}</span>
        <span class="edge" style="margin-left:auto">+${pct(o.edge)}</span>
      </div>
      <div class="note">${o.note}${o.kelly ? ` · Kelly/4 sugerido: ${pct(o.kelly)} del bankroll` : ''}</div>
    </div>`).join('') + '</div>';
  html += `<h2>Tabla completa · campeón del mundo</h2>
    <table class="arbtable"><tr><th>Equipo</th><th>Modelo</th><th>Polymarket (bid/ask)</th><th>Kalshi (bid/ask)</th><th>Edge máx</th></tr>` +
    ARB.rows.filter(r => r.model > 0.001 || r.polymarket || r.kalshi).map(r => {
      const e = Math.max(0, ...r.edges.map(x => x.edge));
      return `<tr><td class="teamcell" onclick="openTeam('${r.id}')">${tlabel(r.id)}</td>
        <td><b>${pct(r.model)}</b></td>
        <td>${r.polymarket ? `${pct(r.polymarket.bid)} / ${pct(r.polymarket.ask)}` : '<span class="muted">—</span>'}</td>
        <td>${r.kalshi ? `${pct(r.kalshi.bid)} / ${pct(r.kalshi.ask)}` : '<span class="muted">—</span>'}</td>
        <td class="${e > 0.015 ? 'pgood' : 'muted'}">${e > 0 ? '+' + pct(e) : '—'}</td></tr>`;
    }).join('') + '</table>';
  $('#tab-arb').innerHTML = html;
}

// ---------- EVOLUCIÓN ----------
const PALETTE = ['#4ade80', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#34d399', '#f472b6', '#a3e635', '#fb923c', '#22d3ee'];
function renderEvo() {
  const cv = $('#evoChart'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const hist = STATE.history;
  if (hist.length < 2) {
    ctx.fillStyle = '#8a919e'; ctx.font = '13px monospace';
    ctx.fillText('La evolución aparecerá cuando se registren resultados y cambien las probabilidades.', 30, 40);
    $('#evoLegend').innerHTML = '';
    return;
  }
  const top = [...STATE.teams].sort((a, b) => b.sim.champion - a.sim.champion).slice(0, 10);
  const maxP = Math.max(.05, ...hist.flatMap(h => top.map(t => h.probs[t.id] || 0))) * 1.15;
  const X = i => 50 + i / (hist.length - 1) * (cv.width - 70);
  const Y = p => cv.height - 30 - p / maxP * (cv.height - 50);
  ctx.strokeStyle = '#262a32'; ctx.fillStyle = '#8a919e'; ctx.font = '10px monospace';
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
  const groupOpts = STATE.fixtures.map(f =>
    `<option value="${f.id}">${f.id} · ${teamOf(f.home).name} vs ${teamOf(f.away).name}</option>`).join('');
  const koOpts = STATE.knockout.map(k => `<option value="${k.m}">P${k.m} · ${STAGES_ES[k.stage]}</option>`).join('');
  const teamOpts = STATE.teams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  $('#tab-admin').innerHTML = `
    <h2>Registrar resultado · recalcula 10,000 simulaciones y actualiza Elo en vivo</h2>
    <div class="gcard">
      <h3>FASE DE GRUPOS</h3>
      <div class="formrow">
        <select id="gMatch">${groupOpts}</select>
        <input id="gHg" type="number" min="0" style="width:60px" placeholder="local">
        <input id="gAg" type="number" min="0" style="width:60px" placeholder="visita">
        <select id="gStatus"><option value="final">Final</option><option value="live">En vivo</option></select>
        <input id="gMin" type="number" min="0" max="90" style="width:70px" placeholder="minuto">
        <button class="btn" onclick="saveResult(true)">Guardar</button>
        <button class="ghost" onclick="removeResult(true)">Borrar resultado</button>
      </div>
    </div>
    <div class="gcard" style="margin-top:12px">
      <h3>ELIMINACIÓN DIRECTA</h3>
      <div class="formrow">
        <select id="kMatch">${koOpts}</select>
        <select id="kHome">${teamOpts}</select> vs <select id="kAway">${teamOpts}</select>
        <input id="kHg" type="number" min="0" style="width:60px" placeholder="local">
        <input id="kAg" type="number" min="0" style="width:60px" placeholder="visita">
        <select id="kStatus"><option value="final">Final</option><option value="live">En vivo</option></select>
        <input id="kMin" type="number" min="0" max="120" style="width:70px" placeholder="minuto">
        <label><input type="checkbox" id="kPens"> ganó local en penales</label>
        <button class="btn" onclick="saveResult(false)">Guardar</button>
        <button class="ghost" onclick="removeResult(false)">Borrar</button>
      </div>
    </div>
    <div id="adminMsg" class="warn"></div>`;
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
    ${j.demo ? `<p class="warn">Modo demo (sin SMTP): tu código es <b>${j.demoCode}</b></p>` : '<p class="muted">Revisa tu correo.</p>'}
    <div class="formrow"><input id="loginCode" placeholder="código de 6 dígitos" maxlength="6">
    <button class="btn" onclick="verifyCode()">Verificar</button></div>`;
}
async function verifyCode() {
  const r = await fetch('/api/auth/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: $('#loginEmail').value.trim(), code: $('#loginCode').value.trim() }),
  });
  const j = await r.json();
  if (!r.ok) { $('#loginMsg').textContent = j.error; return; }
  localStorage.setItem('wc_token', j.token);
  USER = { email: j.email, isAdmin: j.isAdmin, favorites: j.favorites };
  closeModal(); renderHeader(); renderAll();
}
function logout() { localStorage.removeItem('wc_token'); USER = null; closeModal(); renderHeader(); renderAll(); }

// ---------- modal / tabs / SSE ----------
function openModal(html) { $('#modalBody').innerHTML = html; $('#modal').style.display = 'flex'; }
function closeModal() { $('#modal').style.display = 'none'; }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
$('#loginBtn').addEventListener('click', openLogin);
document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#tabs button').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  $('#tab-' + b.dataset.tab).classList.add('active');
  if (b.dataset.tab === 'arb' && !ARB) loadArb();
  if (b.dataset.tab === 'evo') renderEvo();
}));

function notifyUpdate(reason, ts) {
  const b = $('#banner');
  b.textContent = `⚡ Probabilidades actualizadas en tiempo real (${reason}) · ${new Date(ts).toLocaleTimeString()}`;
  b.style.display = '';
  setTimeout(() => b.style.display = 'none', 6000);
}

// Tiempo real: SSE con fallback automático a polling (túneles/proxies que bufferean streams)
let pollTimer = null, lastVersion = null;
function startPolling() {
  if (pollTimer) return;
  $('#liveDot').classList.add('on');
  $('#liveDot').title = 'Tiempo real (polling cada 10s)';
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
    } catch { $('#liveDot').classList.remove('on'); }
  }, 10000);
  fetch('/api/version').then(r => r.json()).then(v => lastVersion = v).catch(() => { });
}

function connectSSE() {
  let gotHello = false;
  const es = new EventSource('/api/stream');
  const watchdog = setTimeout(() => { if (!gotHello) { es.close(); startPolling(); } }, 8000);
  es.addEventListener('hello', () => { gotHello = true; clearTimeout(watchdog); $('#liveDot').classList.add('on'); });
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
    $('#liveDot').classList.remove('on');
    gotHello ? setTimeout(connectSSE, 5000) : startPolling();
  };
}

(async () => { await loadMe(); await loadState(); connectSSE(); })();
