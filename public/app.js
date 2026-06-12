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

// Vista para no registrados: gancho de captura
function renderTeaser() {
  const max = Math.max(...STATE.top.map(t => t.champion));
  const cards = STATE.top.map(t => `
    <div class="tcard" onclick="openLogin()">
      <div class="trow"><span style="font-size:20px">${t.flag}</span><span class="tname">${t.name}</span>
      <span class="telo">GRUPO ${t.group}</span></div>
      <div class="champ">${pct(t.champion)}</div>
      <div class="bar"><div style="width:${(t.champion / max * 100).toFixed(1)}%"></div></div>
    </div>`).join('');
  const wall = `
    <div class="wall">
      <div class="wall-title">¿Quién va a ganar el Mundial? Descúbrelo en vivo ⚽</div>
      <div class="wall-sub">
        Los ${STATE.totalTeams} equipos con probabilidades que se mueven partido a partido, marcadores en tiempo real,
        grupos, bracket completo y las oportunidades que nuestro modelo detecta frente a Polymarket y Kalshi.
        Gratis con tu email — sin contraseñas.
      </div>
      <button class="btn" onclick="openLogin()">Crear mi cuenta gratis</button>
    </div>`;
  $('#tab-teams').innerHTML = `
    <h2>Probabilidad de ganar el Mundial 2026 · ${STATE.sims.toLocaleString()} torneos simulados</h2>
    <div class="teamgrid">${cards}</div>${wall}`;
  ['groups', 'matches', 'bracket', 'arb', 'evo', 'admin'].forEach(t => {
    $('#tab-' + t).innerHTML = `<div class="lock">
      <div class="lock-icon">🔒</div>
      <div class="lock-title">Esta sección es para usuarios registrados</div>
      <div class="muted" style="margin-bottom:18px">Es gratis y solo toma 30 segundos con tu email.</div>
      <button class="btn" onclick="openLogin()">Entrar con mi email</button></div>`;
  });
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
  if (STATE.teaser) { renderTeaser(); return; }
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

async function loadArb(force = false) {
  $('#tab-arb').innerHTML = '<h2>Oportunidades · cargando mercados en vivo…</h2>';
  const r = await fetch('/api/arbitrage' + (force ? '?force=1' : ''), { headers: hdrs() });
  if (!r.ok) {
    $('#tab-arb').innerHTML = `<div class="lock"><div class="lock-icon">🔒</div>
      <div class="lock-title">Inicia sesión para ver las oportunidades</div>
      <button class="btn" onclick="openLogin()">Entrar con mi email</button></div>`;
    return;
  }
  ARB = await r.json();
  const byId = Object.fromEntries(ARB.rows.map(x => [x.id, x]));
  const pure = [], value = [];
  ARB.rows.forEach(row => row.edges.forEach(e => {
    (e.type === 'arbitraje' ? pure : value).push({ ...e, team: row.id, model: row.model, row });
  }));
  pure.sort((a, b) => b.edge - a.edge);
  value.sort((a, b) => b.edge - a.edge);

  let html = `
    <div class="arb-head">
      <div>
        <h2 style="margin-bottom:2px">Mercados en vivo · Polymarket & Kalshi</h2>
        <div class="muted" style="font-size:12px">
          <span class="livepill">● EN VIVO</span> Última actualización ${ARB.ts ? new Date(ARB.ts).toLocaleTimeString() : '—'}
          · se refresca cada 5 min · toca una tarjeta para abrir el mercado real
        </div>
      </div>
      <button class="ghost" onclick="loadArb(true)">↻ Actualizar</button>
    </div>
    ${ARB.errors.length ? `<div class="warn">${ARB.errors.join(' · ')}</div>` : ''}`;

  // ---- arbitraje puro (dos plataformas, ganancia asegurada) ----
  if (pure.length) {
    html += `<div class="sect-title"><span class="dot-amber">◆</span> Arbitraje puro · ganancia asegurada entre plataformas</div>
    <div class="muted" style="font-size:12px;margin:-6px 0 14px">Los precios de Polymarket y Kalshi se contradicen: comprando en ambas ganas la diferencia, gane quien gane.</div>
    <div class="arbops">` + pure.slice(0, 6).map(o => {
      const pm = o.row.polymarket, ks = o.row.kalshi;
      return `<div class="dualcard">
        <div class="dual-top">
          <span style="font-size:22px">${teamOf(o.team) ? teamOf(o.team).flag : ''}</span>
          <b style="font-size:16px">${teamOf(o.team) ? teamOf(o.team).name : o.team}</b>
          <span class="purebadge">ARBITRAJE PURO</span>
          <span class="edge-big">+${pct(o.edge)}</span>
        </div>
        <div class="note" style="margin:6px 0 12px">${o.note}</div>
        <div class="dual-btns">
          ${pm ? `<a class="venue-btn v-poly" href="${pm.url}" target="_blank" rel="noopener">Abrir en Polymarket · ${cents(pm.ask)} ↗</a>` : ''}
          ${ks ? `<a class="venue-btn v-kalshi" href="${ks.url}" target="_blank" rel="noopener">Abrir en Kalshi · ${cents(ks.ask)} ↗</a>` : ''}
        </div>
      </div>`;
    }).join('') + '</div>';
  }

  // ---- apuestas de valor (tarjetas de mercado clicables) ----
  html += `<div class="sect-title"><span class="dot-green">●</span> Apuestas de valor · modelo vs mercado</div>
    <div class="muted" style="font-size:12px;margin:-6px 0 14px">Donde nuestras 10,000 simulaciones discrepan más del precio. Toca para ir al mercado exacto.</div>`;
  if (!value.length) html += '<div class="muted">Sin discrepancias mayores al 1.5% ahora mismo.</div>';
  html += '<div class="mktgrid">' + value.slice(0, 12).map(o => {
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
        <span>Vol ${fmtUsd(v.volume)}</span><span>24h ${fmtUsd(v.volume24h)}</span>
        <span>${o.venue === 'Polymarket' ? 'Liq ' + fmtUsd(v.liquidity) : 'OI ' + fmtUsd(v.openInterest)}</span>
        ${o.kelly ? `<span class="kelly">Kelly/4: ${pct(o.kelly)}</span>` : ''}
      </div>
    </a>`;
  }).join('') + '</div>';

  html += `<div class="warn" style="margin-top:22px">⚠ ${ARB.disclaimer}</div>`;

  // ---- tabla completa con datos de mercado ----
  html += `<h2 style="margin-top:26px">Los 48 mercados · campeón del mundo</h2>
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
    }).join('') + '</table>';
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
  $('#userBase').innerHTML = `
    <div class="formrow" style="align-items:center">
      <span style="color:var(--text)"><b>${j.total}</b> usuarios registrados</span>
      <button class="ghost" onclick="exportUsersCSV()">⬇ Exportar CSV</button>
    </div>
    <table><tr><th>Email</th><th>Registro</th><th>Última visita</th><th>Favoritos</th></tr>
    ${j.users.map(u => `<tr><td>${u.email}</td><td>${fmt(u.createdAt)}</td><td>${fmt(u.lastSeen)}</td><td>${u.favorites}</td></tr>`).join('')}
    </table>`;
  window._users = j.users;
}

function exportUsersCSV() {
  const rows = [['email', 'registro', 'ultima_visita', 'favoritos'],
  ...(window._users || []).map(u => [u.email, new Date(u.createdAt).toISOString(), new Date(u.lastSeen).toISOString(), u.favorites])];
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
    body: JSON.stringify({ email: $('#loginEmail').value.trim(), code: $('#loginCode').value.trim() }),
  });
  const j = await r.json();
  if (!r.ok) { $('#loginMsg').textContent = j.error; return; }
  localStorage.setItem('wc_token', j.token);
  USER = { email: j.email, isAdmin: j.isAdmin, favorites: j.favorites };
  closeModal(); renderHeader(); await loadState();
}
async function logout() { localStorage.removeItem('wc_token'); USER = null; closeModal(); renderHeader(); await loadState(); }

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
