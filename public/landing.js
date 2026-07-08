/* landing.js — página de aterrizaje STANDALONE (sin el shell de la app). Posicionamiento caja-negra:
   vende el resultado, nunca el método. i18n ES/EN inline, data real del teaser público, sin dependencias.
   Registro passwordless funcional (modal: email → código → sesión) + demo interactiva del escáner. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var KNOWN = /^(MEX|KOR|CZE|RSA|SUI|CAN|BIH|QAT|BRA|MAR|SCO|HAI|TUR|PAR|AUS|USA|ECU|GER|CIV|CUW|NED|JPN|SWE|TUN|BEL|IRN|EGY|NZL|ESP|URU|CPV|KSA|FRA|NOR|SEN|IRQ|ARG|AUT|ALG|JOR|POR|COL|UZB|COD|ENG|CRO|PAN|GHA)$/;
  var flag = function (id, cls) { return id && KNOWN.test(id) ? '<img class="' + (cls || 'sc-fl') + '" src="/flags/' + id + '.svg" alt="">' : ''; };

  var DICT = {
    es: {
      nav_login: 'Entrar', nav_cta: 'Crear cuenta',
      eyebrow: 'GP INTELLIGENCE · EN VIVO',
      h1: 'La ventaja que el mercado <span class="g">no ve</span>.',
      sub: 'Jugadas verificadas cada día, cuotas mal pagadas detectadas al instante y arbitraje entre más de 40 casas. Inteligencia de nivel institucional, lista para ejecutar.',
      cta: 'Crear mi cuenta gratis', micro: 'Sin contraseña · solo tu email · 30 segundos',
      ht_users: 'usuarios activos', ht_verified: 'resultados verificados públicamente',
      sc_tag: 'Precio atrasado', sc_live: 'en vivo', sc_edge: 'value', sc_fair: 'consenso · justa 10.4', sc_foot: 'Consenso de {n} casas · vendes cuando el precio se corrige',
      sc_float_l: 'cuotas mal pagadas detectadas ahora',
      tr_record: 'aciertos verificados', tr_books: 'casas monitoreadas', tr_live: '24/7', tr_live_s: 'tiempo real', tr_lang: 'español · english',
      plays_eye: 'Producto', plays_title: 'Las jugadas de hoy', plays_sub: 'Publicadas antes del partido, verificadas después. La selección se desbloquea con tu cuenta gratis.',
      demo_cta: 'Ver demo interactiva',
      play_lock: 'Ver la jugada', conf: 'Confianza', c_high: 'Alta', c_med: 'Media', c_low: 'Baja',
      fam_solid: 'Ganador', fam_goals: 'Goles', fam_combo: 'Combinada',
      empty: 'Las jugadas de hoy aún no salen', empty_s: 'Se publican unas horas antes de cada partido. Crea tu cuenta y recíbelas apenas caigan.',
      scan_eye: 'El escáner', scan_title: 'No duerme.', scan_sub: 'Vigilamos el mercado global y detectamos el precio que quedó atrás — antes de que lo corrijan.',
      scan_markets: 'mercados monitoreados', scan_lag: 'cuotas mal pagadas', scan_arb: 'surebets activas',
      why_eye: 'Por qué GP', why_title: 'La diferencia está en el detalle.',
      why_1t: 'Verificado, no prometido', why_1s: 'Cada jugada queda registrada antes del partido. El récord es público: aciertos y fallos, sin editar.',
      why_2t: 'Siempre la mejor cuota', why_2s: 'Comparamos más de 40 casas por ti y te señalamos exactamente dónde pagan más.',
      why_3t: 'Señales ejecutables', why_3s: 'Cuando el mercado se atrasa, lo ves con tiempo para actuar — no cuando ya se corrigió.',
      champ_eye: 'La lectura del torneo', champ_title: 'Quién levanta la copa.', champ_sub: 'Recalculado en vivo con cada gol. Solo la punta — el análisis completo está dentro.',
      champ_cap: 'de levantar la copa',
      final_h: 'La ventaja no espera. Empieza gratis.',
      disc: 'Estimaciones estadísticas · no es consejo financiero · apuesta con responsabilidad',
      foot_tag: 'Inteligencia deportiva en tiempo real', foot_legal: '© 2026 · No es consejo financiero',
      /* modal registro */
      a_eye: 'Acceso gratis', a_h: 'Crea tu cuenta', a_sub: 'Sin contraseña. Te enviamos un código a tu email y entras al instante.',
      a_email_l: 'Tu email', a_email_ph: 'tucorreo@email.com', a_send: 'Enviar código',
      a_micro: 'Gratis durante el Mundial · sin tarjeta · sin spam',
      a_sent_h: 'Revisa tu email', a_sent_sub: 'Te enviamos un código de 6 dígitos a <b>{email}</b>.',
      a_spam: '¿No lo ves? Revisa <b>Spam</b> o <b>Promociones</b> — puede tardar hasta 1 minuto.',
      a_code_l: 'Código', a_code_ph: '••••••', a_verify: 'Entrar', a_back: 'Usar otro email',
      a_ok_h: '¡Listo!', a_ok_sub: 'Entrando a tu cuenta…',
      e_email: 'Ingresa un email válido.', e_code: 'Código incorrecto o vencido.', e_net: 'Error de conexión, intenta de nuevo.',
      /* demo */
      d_eye: 'Demo en vivo', d_h: 'Así se ve el escáner por dentro', d_sub: 'Compara decenas de casas en tiempo real y marca el precio que quedó atrás — antes de que lo corrijan.',
      d_lag: 'Precio atrasado', d_arb: 'Surebet', d_note: 'Datos ilustrativos del escáner. Las oportunidades reales, en vivo, dentro de tu cuenta.', d_cta: 'Crear cuenta y ver el real',
    },
    en: {
      nav_login: 'Log in', nav_cta: 'Sign up',
      eyebrow: 'GP INTELLIGENCE · LIVE',
      h1: "The edge the market <span class=\"g\">doesn't see</span>.",
      sub: 'Verified plays every day, mispriced odds caught the moment they appear, and arbitrage across 40+ books. Institutional-grade intelligence, ready to execute.',
      cta: 'Create my free account', micro: 'No password · just your email · 30 seconds',
      ht_users: 'active users', ht_verified: 'publicly verified results',
      sc_tag: 'Stale price', sc_live: 'live', sc_edge: 'value', sc_fair: 'consensus · fair 10.4', sc_foot: '{n}-book consensus · sell when the price corrects',
      sc_float_l: 'mispriced odds detected now',
      tr_record: 'verified hit rate', tr_books: 'books monitored', tr_live: '24/7', tr_live_s: 'real time', tr_lang: 'english · español',
      plays_eye: 'Product', plays_title: "Today's plays", plays_sub: 'Published before the match, verified after. The selection unlocks with your free account.',
      demo_cta: 'Watch interactive demo',
      play_lock: 'See the play', conf: 'Confidence', c_high: 'High', c_med: 'Medium', c_low: 'Low',
      fam_solid: 'Winner', fam_goals: 'Goals', fam_combo: 'Combo',
      empty: "Today's plays aren't out yet", empty_s: 'They drop a few hours before each match. Create your account and get them the moment they land.',
      scan_eye: 'The scanner', scan_title: 'Never sleeps.', scan_sub: 'We watch the global market and catch the price that fell behind — before it gets corrected.',
      scan_markets: 'markets monitored', scan_lag: 'mispriced odds', scan_arb: 'live surebets',
      why_eye: 'Why GP', why_title: 'The difference is in the detail.',
      why_1t: 'Verified, not promised', why_1s: 'Every play is logged before the match. The record is public: hits and misses, unedited.',
      why_2t: 'Always the best odds', why_2s: 'We compare 40+ books for you and point to exactly where they pay more.',
      why_3t: 'Executable signals', why_3s: 'When the market lags, you see it in time to act — not after it corrected.',
      champ_eye: 'The tournament read', champ_title: 'Who lifts the cup.', champ_sub: 'Recalculated live with every goal. Just the top — the full analysis is inside.',
      champ_cap: 'to lift the cup',
      final_h: "The edge won't wait. Start free.",
      disc: 'Statistical estimates · not financial advice · bet responsibly',
      foot_tag: 'Real-time sports intelligence', foot_legal: '© 2026 · Not financial advice',
      a_eye: 'Free access', a_h: 'Create your account', a_sub: 'No password. We email you a code and you’re in instantly.',
      a_email_l: 'Your email', a_email_ph: 'you@email.com', a_send: 'Send code',
      a_micro: 'Free during the World Cup · no card · no spam',
      a_sent_h: 'Check your email', a_sent_sub: 'We sent a 6-digit code to <b>{email}</b>.',
      a_spam: "Don't see it? Check your <b>Spam</b> or <b>Promotions</b> folder — it can take up to a minute.",
      a_code_l: 'Code', a_code_ph: '••••••', a_verify: 'Enter', a_back: 'Use another email',
      a_ok_h: "You're in!", a_ok_sub: 'Taking you to your account…',
      e_email: 'Enter a valid email.', e_code: 'Wrong or expired code.', e_net: 'Connection error, try again.',
      d_eye: 'Live demo', d_h: 'Inside the scanner', d_sub: 'It compares dozens of books in real time and flags the price that fell behind — before it gets corrected.',
      d_lag: 'Stale price', d_arb: 'Surebet', d_note: 'Illustrative scanner data. The real, live opportunities are inside your account.', d_cta: 'Sign up to see the real one',
    }
  };
  var lang = (function () { try { var p = localStorage.getItem('gp_lang'); if (p === 'es' || p === 'en') return p; } catch (e) {} return (function(){var d=(typeof window!=='undefined'&&window.__GPDL)||'en';if(d==='es'||d==='en')return d;return (navigator.language||'es').slice(0,2)==='en'?'en':'es';})(); })();
  var T = function (k, a) { var s = (DICT[lang] || DICT.es)[k]; if (s == null) s = DICT.es[k] || k; return String(s).replace(/\{(\w+)\}/g, function (m, x) { return a && a[x] != null ? a[x] : m; }); };

  // capturar referido de la URL (?ref=CODE) para no perderlo en el registro desde la landing
  try { var rf = new URLSearchParams(location.search).get('ref'); if (rf) localStorage.setItem('wc_ref', rf); } catch (e) {}

  var ICONS = {
    verify: '<path d="M12 3.5 19 6v5.2c0 4.6-2.9 7.6-7 9.3-4.1-1.7-7-4.7-7-9.3V6Z"/><path d="M9.2 11.8l1.9 1.9 3.6-3.9"/>',
    odds: '<path d="M4 17 9.4 11.5 12.9 15 20 7.8"/><path d="M20 7.8h-4M20 7.8v4"/><path d="M4 20h16"/>',
    bolt: '<path d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z"/>'
  };
  var icon = function (k) { return '<svg viewBox="0 0 24 24">' + (ICONS[k] || '') + '</svg>'; };

  function fillStatic() {
    document.documentElement.lang = lang;
    $$('[data-k]').forEach(function (el) { el.innerHTML = T(el.getAttribute('data-k')); });
    // botones nav
    $$('[data-login]').forEach(function (b) { b.className = 'blink'; b.textContent = T('nav_login'); b.onclick = function () { openAuth(); }; });
    $$('[data-signup]').forEach(function (b) {
      var nav = b.closest('.nav'); b.className = nav ? 'btn' : 'btn lg'; b.textContent = nav ? T('nav_cta') : T('cta');
      b.onclick = function () { openAuth(); };
    });
    $$('[data-demo]').forEach(function (b) { b.onclick = openDemo; });
    // pilares
    $('#pillars').innerHTML = ['1', '2', '3'].map(function (n) {
      var ik = n === '1' ? 'verify' : n === '2' ? 'odds' : 'bolt';
      return '<div class="pil"><div class="pil-ic">' + icon(ik) + '</div><h3>' + esc(T('why_' + n + 't')) + '</h3><p>' + esc(T('why_' + n + 's')) + '</p></div>';
    }).join('');
    // lang toggle
    $$('#lang button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-l') === lang);
      b.onclick = function () { var l = b.getAttribute('data-l'); if (l === lang) return; try { localStorage.setItem('gp_lang', l); } catch (e) {} lang = l; location.reload(); };
    });
    // cerrar modales
    $$('[data-close]').forEach(function (b) { b.onclick = closeModals; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModals(); });
  }

  function renderShowcase(scan) {
    var lag = (scan && scan.lag != null) ? scan.lag : 14;
    $('#showcase').innerHTML =
      '<div class="sc-card">' +
      '<div class="sc-head"><span class="sc-tag">' + esc(T('sc_tag')) + '</span><span class="sc-live"><i></i>' + esc(T('sc_live')) + '</span></div>' +
      '<div class="sc-row"><span class="sc-team">' + flag('AUT') + 'Austria</span><span class="sc-odds">12.00</span></div>' +
      '<div class="sc-row"><span class="sc-team" style="color:var(--tx3);font-size:13px">' + esc(T('sc_fair')) + '</span><span class="sc-edge">+15%</span></div>' +
      '<div class="sc-foot"><span>' + esc(T('sc_foot', { n: 33 })) + '</span></div>' +
      '</div>' +
      '<div class="sc-float"><span class="n" id="scfloat">' + lag + '</span><span class="l">' + esc(T('sc_float_l')) + '</span></div>';
  }

  function countUp(el, to) {
    if (!el || !to) return;
    try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; } } catch (e) {}
    var t0 = null; function step(ts) { if (!t0) t0 = ts; var p = Math.min(1, (ts - t0) / 700); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  }

  // número "premium": redondea hacia abajo a 50 más cercano y agrega "+"
  function roundUsers(n) { if (!n || n < 50) return n || 0; return (Math.floor(n / 50) * 50) + '+'; }

  function renderData(d) {
    // trust inline del hero: usuarios reales + verificado
    var users = d && d.users ? roundUsers(d.users) : null;
    var ht = '';
    ht += '<div class="av"><i></i><i></i><i></i></div>';
    if (users) ht += '<span><b>' + users + '</b> ' + esc(T('ht_users')) + '</span>';
    ht += '<span class="dot"></span><span>' + esc(T('ht_verified')) + '</span>';
    $('#herotrust').innerHTML = ht;
    // trust strip
    var rec = (d && d.record && d.record.total >= 20) ? Math.round(d.record.winners / d.record.total * 100) + '%' : null;
    var trust = '';
    if (rec) trust += '<div class="tr"><b class="g">' + rec + '</b><span>' + esc(T('tr_record')) + ' (' + d.record.winners + '/' + d.record.total + ')</span></div>';
    trust += '<div class="tr"><b>40+</b><span>' + esc(T('tr_books')) + '</span></div>' +
      '<div class="tr"><b class="g">' + esc(T('tr_live')) + '</b><span>' + esc(T('tr_live_s')) + '</span></div>' +
      '<div class="tr"><b>ES·EN</b><span>' + esc(T('tr_lang')) + '</span></div>';
    $('#trust').innerHTML = trust;
    // jugadas de hoy
    var famC = function (f) { return f === 'GOALS' ? 'goals' : f === 'COMBO' ? 'combo' : ''; };
    var famK = function (f) { return f === 'GOALS' ? 'fam_goals' : f === 'COMBO' ? 'fam_combo' : 'fam_solid'; };
    var confK = function (c) { return c === 'high' ? 'c_high' : c === 'med' ? 'c_med' : 'c_low'; };
    var hh = function (iso) { try { return new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    var picks = (d && d.picks) || [];
    if (picks.length) {
      $('#plays').innerHTML = '<div class="plays">' + picks.map(function (p) {
        return '<div class="play ' + famC(p.family) + '" data-signup>' +
          '<div class="play-top"><span class="play-fam">' + esc(T(famK(p.family))) + '</span><span class="play-ko">' + esc(hh(p.kickoff)) + '</span></div>' +
          '<div class="play-m">' + flag(p.home_team_id, 'play-fl') + '<b>' + esc((lang === 'en' && p.home_en) ? p.home_en : (p.home || '')) + '</b><span class="vs">vs</span><b>' + esc((lang === 'en' && p.away_en) ? p.away_en : (p.away || '')) + '</b>' + flag(p.away_team_id, 'play-fl') + '</div>' +
          '<div class="play-lock"><span class="lk">🔒</span><span class="lt">' + esc(T('play_lock')) + '</span></div>' +
          '<div class="play-foot"><span class="play-conf ' + esc(p.confidence_bucket) + '"><i></i>' + esc(T('conf')) + ': <b>' + esc(T(confK(p.confidence_bucket))) + '</b></span></div>' +
          '</div>';
      }).join('') + '</div>';
    } else {
      $('#plays').innerHTML = '<div class="empty"><b>' + esc(T('empty')) + '</b><span>' + esc(T('empty_s')) + '</span></div>';
    }
    // escáner (con gauge)
    var s = (d && d.scanner) || { markets: 0, lag: 0, arb: 0 };
    var gw = function (v, max) { return Math.max(4, Math.min(100, Math.round((v / max) * 100))); };
    var scanEl = $('#scan');
    scanEl.innerHTML =
      '<div class="scan-stat"><span class="liveflag"><i></i>live</span><b data-n="' + s.markets + '">0</b><span>' + esc(T('scan_markets')) + '</span><div class="gauge"><i data-w="' + gw(s.markets, Math.max(s.markets, 60)) + '"></i></div></div>' +
      '<div class="scan-stat hl"><span class="liveflag"><i></i>live</span><b data-n="' + s.lag + '">0</b><span>' + esc(T('scan_lag')) + '</span><div class="gauge"><i data-w="' + gw(s.lag, Math.max(s.lag, 20)) + '"></i></div></div>' +
      '<div class="scan-stat"><span class="liveflag"><i></i>live</span><b data-n="' + s.arb + '">0</b><span>' + esc(T('scan_arb')) + '</span><div class="gauge"><i data-w="' + gw(s.arb, Math.max(s.arb, 8)) + '"></i></div></div>';
    if (scanEl.classList.contains('in')) animateScan(scanEl);
    renderShowcase(s);
    // re-vincular data-signup (las play cards nuevas)
    $$('[data-signup]').forEach(function (b) { if (b.closest('.play')) b.onclick = function () { openAuth(); }; });
  }

  function animateScan(scanEl) {
    $$('[data-n]', scanEl).forEach(function (b) { countUp(b, +b.getAttribute('data-n')); });
    $$('.gauge i', scanEl).forEach(function (i) { requestAnimationFrame(function () { i.style.width = i.getAttribute('data-w') + '%'; }); });
  }

  function renderChamp(top) {
    if (!top || !top.length) { $('#s-champ').style.display = 'none'; return; }
    var lead = top[0], max = lead.champion;
    var rows = top.slice(1, 6).map(function (t) {
      return '<div class="champ-row">' + flag(t.id) + '<span class="nm">' + esc(t.name) + '</span><span class="tk"><i data-w="' + (t.champion / max * 100).toFixed(0) + '"></i></span><span class="pc">' + (t.champion * 100).toFixed(1) + '%</span></div>';
    }).join('');
    $('#champ').innerHTML =
      '<div class="champ-lead">' + flag(lead.id) + '<div class="tn">' + esc(lead.name) + '<small>' + esc(T('champ_cap')) + '</small></div><div class="big">' + (lead.champion * 100).toFixed(1) + '<small>%</small></div></div>' +
      rows;
    if ($('#s-champ').querySelector('.rv.in')) animateChamp();
  }
  function animateChamp() { $$('#champ .champ-row .tk i').forEach(function (i) { requestAnimationFrame(function () { i.style.width = i.getAttribute('data-w') + '%'; }); }); }

  /* ===== modales ===== */
  function openModal(id) { var m = $('#' + id); if (!m) return; m.classList.add('open'); document.body.classList.add('lock'); }
  function closeModals() { $$('.modal').forEach(function (m) { m.classList.remove('open'); }); document.body.classList.remove('lock'); }

  var authEmail = '', sending = false;
  function openAuth() { renderAuthEmail(); openModal('auth'); setTimeout(function () { var e = $('#aEmail'); if (e) e.focus(); }, 320); }
  function renderAuthEmail() {
    $('#authStep').innerHTML =
      '<div class="modal-eye"><i></i>' + esc(T('a_eye')) + '</div>' +
      '<h3>' + esc(T('a_h')) + '</h3><p class="m-sub">' + esc(T('a_sub')) + '</p>' +
      '<div class="m-field"><label>' + esc(T('a_email_l')) + '</label>' +
      '<input class="m-input" id="aEmail" type="email" inputmode="email" autocomplete="email" placeholder="' + esc(T('a_email_ph')) + '" value="' + esc(authEmail) + '"></div>' +
      '<button class="btn m-btn" id="aSend">' + esc(T('a_send')) + '</button>' +
      '<div class="m-msg" id="aMsg"></div>' +
      '<div class="m-micro">' + esc(T('a_micro')) + '</div>';
    var inp = $('#aEmail');
    $('#aSend').onclick = sendCode;
    inp.onkeydown = function (e) { if (e.key === 'Enter') sendCode(); };
  }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
  function sendCode() {
    if (sending) return;
    var inp = $('#aEmail'), msg = $('#aMsg'), btn = $('#aSend');
    var em = (inp.value || '').trim();
    if (!validEmail(em)) { msg.className = 'm-msg err'; msg.textContent = T('e_email'); inp.focus(); return; }
    authEmail = em; sending = true; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; msg.textContent = '';
    fetch('/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: em, lang: lang }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        sending = false;
        if (!res.ok) { btn.disabled = false; btn.textContent = T('a_send'); msg.className = 'm-msg err'; msg.textContent = res.j.error || T('e_net'); return; }
        renderAuthCode(res.j.demoCode);
      })
      .catch(function () { sending = false; btn.disabled = false; btn.textContent = T('a_send'); msg.className = 'm-msg err'; msg.textContent = T('e_net'); });
  }
  function renderAuthCode(demoCode) {
    $('#authStep').innerHTML =
      '<div class="modal-eye"><i></i>' + esc(T('a_eye')) + '</div>' +
      '<h3>' + esc(T('a_sent_h')) + '</h3><p class="m-sub">' + T('a_sent_sub', { email: esc(authEmail) }) + '</p>' +
      // muchos códigos caen en Spam/Promociones (sobre todo Gmail móvil en África) y el lead nunca completa →
      // aviso sutil en la piel del modal, ANTES del campo del código.
      '<div class="m-spam"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg><span>' + T('a_spam') + '</span></div>' +
      (demoCode ? '<p class="m-msg ok">demo: ' + esc(demoCode) + '</p>' : '') +
      '<div class="m-field"><label>' + esc(T('a_code_l')) + '</label>' +
      '<input class="m-input code" id="aCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="' + esc(T('a_code_ph')) + '"></div>' +
      '<button class="btn m-btn" id="aVerify">' + esc(T('a_verify')) + '</button>' +
      '<div class="m-msg" id="aMsg"></div>' +
      '<button class="m-back" id="aBack">' + esc(T('a_back')) + '</button>';
    var inp = $('#aCode');
    setTimeout(function () { inp.focus(); }, 60);
    $('#aVerify').onclick = doVerify;
    inp.onkeydown = function (e) { if (e.key === 'Enter') doVerify(); };
    inp.oninput = function () { inp.value = inp.value.replace(/\D/g, ''); if (inp.value.length === 6) doVerify(); };
    $('#aBack').onclick = renderAuthEmail;
  }
  function doVerify() {
    if (sending) return;
    var inp = $('#aCode'), msg = $('#aMsg'), btn = $('#aVerify');
    var code = (inp.value || '').trim();
    if (code.length < 4) { msg.className = 'm-msg err'; msg.textContent = T('e_code'); return; }
    sending = true; btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; msg.textContent = '';
    var ref; try { ref = localStorage.getItem('wc_ref') || undefined; } catch (e) {}
    fetch('/api/auth/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authEmail, code: code, ref: ref }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        sending = false;
        if (!res.ok || !res.j.token) { btn.disabled = false; btn.textContent = T('a_verify'); msg.className = 'm-msg err'; msg.textContent = res.j.error || T('e_code'); inp.focus(); return; }
        // sesión en localStorage (APIs) + cookie (el server sirve la plataforma en la raíz sin redirección)
        try { localStorage.setItem('wc_token', res.j.token); document.cookie = 'wc_token=' + res.j.token + ';path=/;max-age=31536000;SameSite=Lax'; } catch (e) {}
        renderAuthSuccess();
        setTimeout(function () { location.href = '/'; }, 1100);
      })
      .catch(function () { sending = false; btn.disabled = false; btn.textContent = T('a_verify'); msg.className = 'm-msg err'; msg.textContent = T('e_net'); });
  }
  function renderAuthSuccess() {
    $('#authStep').innerHTML =
      '<div class="m-success"><div class="m-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></svg></div>' +
      '<h3>' + esc(T('a_ok_h')) + '</h3><p class="m-sub">' + esc(T('a_ok_sub')) + '</p></div>';
  }

  /* demo interactiva del escáner */
  var demoRows = [
    { fl: 'AUT', team: 'Austria', tag: 'lag', tagK: 'd_lag', val: '+15%' },
    { fl: 'ALG', team: 'Argelia', tag: 'lag', tagK: 'd_lag', val: '+9%' },
    { fl: 'CRO', team: 'Croacia', tag: 'arb', tagK: 'd_arb', val: '+3.7%' },
    { fl: 'SUI', team: 'Suiza', tag: 'lag', tagK: 'd_lag', val: '+6%' }
  ];
  function openDemo() {
    var rows = demoRows.map(function (r, i) {
      return '<div class="dr" style="animation-delay:' + (i * 90 + 60) + 'ms">' + flag(r.fl, 'dfl') +
        '<span class="dteam">' + esc(r.team) + '<span class="dtag ' + r.tag + '">' + esc(T(r.tagK)) + '</span></span>' +
        '<span class="dval">' + esc(r.val) + '</span></div>';
    }).join('');
    $('#demoBody').innerHTML =
      '<div class="demo-head"><span class="modal-eye" style="margin:0"><i></i>' + esc(T('d_eye')) + '</span></div>' +
      '<div class="demo-title">' + esc(T('d_h')) + '</div>' +
      '<p class="m-sub">' + esc(T('d_sub')) + '</p>' +
      '<div class="demo-body">' + rows + '</div>' +
      '<div class="demo-foot"><span class="dl">' + esc(T('d_note')) + '</span><button class="btn" id="dCta">' + esc(T('d_cta')) + '</button></div>';
    openModal('demo');
    $('#dCta').onclick = function () { closeModals(); setTimeout(openAuth, 260); };
  }

  // scroll reveal — robusto: revela de inmediato lo que ya está en viewport + observa el resto.
  var _io = null;
  function inView(el) { var r = el.getBoundingClientRect(); return r.top < (window.innerHeight || 0) - 40 && r.bottom > 0; }
  function revealOne(el) {
    el.classList.add('in');
    if (el.id === 'scan') animateScan(el);
    if (el.id === 'champ' || (el.closest && el.closest('#s-champ'))) animateChamp();
  }
  function reveal() {
    var els = $$('.rv');
    if (!('IntersectionObserver' in window)) { els.forEach(revealOne); return; }
    els.forEach(function (e) { if (inView(e)) revealOne(e); });
    if (!_io) _io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { revealOne(e.target); _io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
    els.forEach(function (e) { if (!e.classList.contains('in')) _io.observe(e); });
  }

  // nav scrolled state
  var nav = $('#nav');
  window.addEventListener('scroll', function () { if (nav) nav.classList.toggle('scrolled', window.scrollY > 12); reveal(); }, { passive: true });

  fillStatic();
  renderShowcase(null);
  reveal();
  fetch('/api/public/teaser').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
    renderData(d || {});
    requestAnimationFrame(reveal);
  });
  fetch('/api/state').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (s) { if (s && s.top) { renderChamp(s.top); requestAnimationFrame(reveal); } });
  // red de seguridad
  setTimeout(function () { $$('.rv:not(.in)').forEach(revealOne); }, 2200);
})();
