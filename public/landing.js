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
      lb_txt: 'Terminó el Mundial: ahora cubrimos el fútbol de clubes todos los días.', lb_cta: 'Crear cuenta gratis',
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
      tg_lead: 'Pick gratis todos los días en Telegram', tg_sub: 'Y los resultados de cada pick, ganadas y perdidas. Sin registro.', tg_cta: 'Unirme al canal',
      /* modal registro */
      a_eye: 'Acceso gratis', a_h: 'Crea tu cuenta', a_sub: 'Sin contraseña. Te enviamos un código a tu email y entras al instante.',
      a_email_l: 'Tu email', a_email_ph: 'tucorreo@email.com', a_send: 'Enviar código',
      a_micro: 'Gratis durante el Mundial · sin tarjeta · sin spam',
      a_sent_h: 'Revisa tu email', a_sent_sub: 'Te enviamos un enlace y un código a <b>{email}</b>. Toca el enlace del correo y entras al instante.',
      a_spam: '¿No lo ves? Revisa <b>Spam</b> o <b>Promociones</b> — puede tardar hasta 1 minuto.',
      a_open_mail: 'Abrir mi correo', a_resend: 'Reenviar código', a_resend_in: 'Reenviar en {s}s', a_resent: '✓ Correo reenviado',
      a_or_code: 'O ingresa el código del correo:',
      a_code_l: 'Código', a_code_ph: '••••••', a_verify: 'Entrar', a_back: 'Usar otro email',
      a_ok_h: '¡Listo!', a_ok_sub: 'Entrando a tu cuenta…',
      e_email: 'Ingresa un email válido.', e_code: 'Código incorrecto o vencido.', e_net: 'Error de conexión, intenta de nuevo.',
      /* demo */
      d_eye: 'Demo en vivo', d_h: 'Así se ve el escáner por dentro', d_sub: 'Compara decenas de casas en tiempo real y marca el precio que quedó atrás — antes de que lo corrijan.',
      d_lag: 'Precio atrasado', d_arb: 'Surebet', d_note: 'Datos ilustrativos del escáner. Las oportunidades reales, en vivo, dentro de tu cuenta.', d_cta: 'Crear cuenta y ver el real',
      /* v3 (clubes) */
      h1_v3: 'El modelo que leyó el Mundial ahora lee <span class="g">el fútbol entero</span>.',
      sub_v3: 'El mismo motor que leyó el Mundial en público ahora cubre 14 ligas en vivo: picks con precio verificado, cuotas mal pagadas al instante y arbitraje entre más de 40 casas.',
      sc3_live: 'en vivo', sc3_xg: 'xG esperado', sc3_foot: 'Lectura del modelo en vivo · se recalcula con cada gol',
      scf_markets: 'mercados vigilados ahora', scf_leagues: 'ligas monitoreadas 24/7',
      tr_rec_v3: 'aciertos verificados · Mundial 2026', tr_leagues_v3: 'ligas en vivo',
      plays_sub_v3: 'Publicadas antes del partido con su precio congelado, liquidadas en público después. La selección se desbloquea con tu cuenta gratis.',
      chip_wc: 'Mundial',
      scan_sub_v3: 'Vigilamos 14 ligas y el mercado global 24/7 y detectamos el precio que quedó atrás — antes de que lo corrijan.',
      scan_leagues_v3: 'ligas en vivo', scan_books_v3: 'casas comparadas',
      champ_eye_v3: 'La lectura de la temporada', champ_title_v3: 'Las carreras por el título.',
      champ_sub_v3: 'Probabilidad de campeón por liga, recalculada con cada jornada. Solo la punta — el análisis completo está dentro.',
      race_cap: 'prob. de campeón',
      a_micro_v3: 'Gratis · sin tarjeta · sin spam',
    },
    en: {
      nav_login: 'Log in', nav_cta: 'Sign up',
      lb_txt: 'The World Cup is over: we now cover club football every day.', lb_cta: 'Create free account',
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
      tg_lead: 'A free pick every day on Telegram', tg_sub: 'Plus every result, wins and losses. No signup needed.', tg_cta: 'Join the channel',
      a_eye: 'Free access', a_h: 'Create your account', a_sub: 'No password. We email you a code and you’re in instantly.',
      a_email_l: 'Your email', a_email_ph: 'you@email.com', a_send: 'Send code',
      a_micro: 'Free during the World Cup · no card · no spam',
      a_sent_h: 'Check your email', a_sent_sub: 'We sent a link and a code to <b>{email}</b>. Tap the link in the email to log in instantly.',
      a_spam: "Don't see it? Check your <b>Spam</b> or <b>Promotions</b> folder — it can take up to a minute.",
      a_open_mail: 'Open my email', a_resend: 'Resend code', a_resend_in: 'Resend in {s}s', a_resent: '✓ Email resent',
      a_or_code: 'Or enter the code from the email:',
      a_code_l: 'Code', a_code_ph: '••••••', a_verify: 'Enter', a_back: 'Use another email',
      a_ok_h: "You're in!", a_ok_sub: 'Taking you to your account…',
      e_email: 'Enter a valid email.', e_code: 'Wrong or expired code.', e_net: 'Connection error, try again.',
      d_eye: 'Live demo', d_h: 'Inside the scanner', d_sub: 'It compares dozens of books in real time and flags the price that fell behind — before it gets corrected.',
      d_lag: 'Stale price', d_arb: 'Surebet', d_note: 'Illustrative scanner data. The real, live opportunities are inside your account.', d_cta: 'Sign up to see the real one',
      /* v3 (clubs) */
      h1_v3: 'The model that read the World Cup now reads <span class="g">all of football</span>.',
      sub_v3: 'The same engine that read the World Cup in public now covers 14 live leagues: picks with verified pricing, mispriced odds caught instantly, and arbitrage across 40+ books.',
      sc3_live: 'live', sc3_xg: 'expected xG', sc3_foot: 'Live model read · recalculated with every goal',
      scf_markets: 'markets watched right now', scf_leagues: 'leagues monitored 24/7',
      tr_rec_v3: 'verified hits · 2026 World Cup', tr_leagues_v3: 'live leagues',
      plays_sub_v3: 'Published before kickoff with the price frozen, settled in public after. The selection unlocks with your free account.',
      chip_wc: 'World Cup',
      scan_sub_v3: 'We watch 14 leagues and the global market 24/7 and catch the price that fell behind — before it gets corrected.',
      scan_leagues_v3: 'live leagues', scan_books_v3: 'books compared',
      champ_eye_v3: 'The season read', champ_title_v3: 'The title races.',
      champ_sub_v3: 'Champion probability per league, recalculated after every matchday. Just the top — the full analysis is inside.',
      race_cap: 'champion prob.',
      a_micro_v3: 'Free · no card · no spam',
    }
  };
  var lang = (function () { try { var p = localStorage.getItem('gp_lang'); if (p === 'es' || p === 'en') return p; } catch (e) {} return (function(){var d=(typeof window!=='undefined'&&window.__GPDL)||'en';if(d==='es'||d==='en')return d;return (navigator.language||'es').slice(0,2)==='en'?'en':'es';})(); })();
  // LANDING v3 (clubes): el server inyecta __GPL3 (flag) y ?landing3=1 la fuerza (preview). Con v3, T()
  // prefiere la variante `<k>_v3` del copy → un solo diccionario, cero bifurcación de markup estático.
  var V3 = /[?&]landing3=1/.test(location.search) || !!window.__GPL3;
  if (V3) { try { document.body.classList.add('v3'); } catch (e) {} }
  var T = function (k, a) { var d0 = DICT[lang] || DICT.es; var s = V3 && d0[k + '_v3'] != null ? d0[k + '_v3'] : d0[k]; if (s == null) s = (V3 && DICT.es[k + '_v3'] != null ? DICT.es[k + '_v3'] : DICT.es[k]) || k; return String(s).replace(/\{(\w+)\}/g, function (m, x) { return a && a[x] != null ? a[x] : m; }); };
  var clubLogo = function (id, cls) { return id && /^tm_[a-z0-9]+$/i.test(String(id)) ? '<img class="' + (cls || 'sc-fl') + '" src="/logos/' + esc(id) + '.png" alt="" onerror="this.remove()">' : ''; };
  var leagueLogo = function (key, cls) { return key && /^[a-z0-9]+$/.test(String(key)) ? '<img class="' + (cls || '') + '" src="/logos/league-' + esc(key) + '.png" alt="" onerror="this.remove()">' : ''; };
  var badge = function (id, cls) { return /^tm_/i.test(String(id || '')) ? clubLogo(id, (cls || 'play-fl') + ' clx') : flag(id, cls); };

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
    // banner de anuncio (post-Mundial → clubes): click = crear cuenta (openAuth); data-k pinta el texto ES/EN
    var _lb = $('#lbanner'); if (_lb) { _lb.onclick = function () { openAuth(); }; _lb.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAuth(); } }; }
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

  function renderShowcase(d) {
    var scan = d && d.scanner;
    var clubs = d && d.clubs, hero = clubs && clubs.hero;
    var nL = (clubs && clubs.leagues_count) || 14;
    // v3 cargando: shell silencioso (nunca un ejemplo muerto que después se reemplaza)
    if (V3 && !d) { $('#showcase').innerHTML = '<div class="sc-card" style="min-height:250px"></div>'; return; }
    if (V3 && hero) {
      // chip flotante: mercados vigilados AHORA (Mundial+clubes); sin dato → ligas 24/7. Jamás un 0.
      var mk = ((scan && scan.markets) || 0) + ((clubs.scanner && clubs.scanner.markets) || 0);
      var floatHtml = mk > 0
        ? '<div class="sc-float"><span class="n" id="scfloat">' + mk + '</span><span class="l">' + esc(T('scf_markets')) + '</span></div>'
        : '<div class="sc-float"><span class="n">' + nL + '</span><span class="l">' + esc(T('scf_leagues')) + '</span></div>';
      var live = hero.status === 'live';
      var hhmm = '', day = '';
      try { var kd = new Date(hero.utc); hhmm = kd.toLocaleTimeString(lang === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }); day = kd.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-ES', { weekday: 'long' }); } catch (e) {}
      var mid = live
        ? '<div class="score">' + esc(hero.hg) + ' – ' + esc(hero.ag) + '</div><div class="min"><i></i>' + esc(T('sc3_live')) + (hero.minute ? ' · ' + esc(hero.minute) + '\'' : '') + '</div>'
        : '<div class="ko">' + esc(hhmm) + '</div><div class="day">' + esc(day) + '</div>';
      var ph = Math.round(hero.home.prob * 100), pa = Math.round(hero.away.prob * 100);
      var pd = Math.max(0, 100 - ph - pa);
      $('#showcase').innerHTML =
        '<div class="sc-card">' +
        '<div class="sc-head"><span class="scv3-league">' + leagueLogo(hero.league) + esc(hero.league_name || '') + '</span><span class="sc-live"><i></i>' + esc(T('sc_live')) + '</span></div>' +
        '<div class="scv3-teams">' +
          '<div class="scv3-side">' + clubLogo(hero.home.id, '') + '<b>' + esc(hero.home.name) + '</b></div>' +
          '<div class="scv3-mid">' + mid + '</div>' +
          '<div class="scv3-side">' + clubLogo(hero.away.id, '') + '<b>' + esc(hero.away.name) + '</b></div>' +
        '</div>' +
        '<div class="scv3-bar"><i class="bh" style="width:' + ph + '%"></i><i class="bd" style="width:' + pd + '%"></i><i class="ba" style="width:' + pa + '%"></i></div>' +
        '<div class="scv3-pcts"><span><b>' + ph + '%</b></span><span class="mid">X ' + pd + '%</span><span><b>' + pa + '%</b></span></div>' +
        (hero.xg ? '<div class="scv3-xg"><span>' + esc(T('sc3_xg')) + '</span><b>' + Number(hero.xg[0]).toFixed(2) + ' – ' + Number(hero.xg[1]).toFixed(2) + '</b></div>' : '') +
        '<div class="sc-foot"><span>' + esc(T('sc3_foot')) + '</span></div>' +
        '</div>' + floatHtml;
      return;
    }
    // legado (Mundial): card estática del escáner
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
    // trust strip — v3: el 67% verificado del Mundial MANDA (historia de origen), luego amplitud real
    var rec = (d && d.record && d.record.total >= 20) ? Math.round(d.record.winners / d.record.total * 100) + '%' : null;
    var nL = (d && d.clubs && d.clubs.leagues_count) || 14;
    var trust = '';
    if (V3 && d && d.clubs) {
      if (rec) trust += '<div class="tr big"><b>' + rec + '</b><span>' + esc(T('tr_rec_v3')) + ' (' + d.record.winners + '/' + d.record.total + ')</span></div>';
      trust += '<div class="tr"><b class="g">' + nL + '</b><span>' + esc(T('tr_leagues_v3')) + '</span></div>' +
        '<div class="tr"><b>40+</b><span>' + esc(T('tr_books')) + '</span></div>' +
        '<div class="tr"><b class="g">' + esc(T('tr_live')) + '</b><span>' + esc(T('tr_live_s')) + '</span></div>';
    } else {
      if (rec) trust += '<div class="tr"><b class="g">' + rec + '</b><span>' + esc(T('tr_record')) + ' (' + d.record.winners + '/' + d.record.total + ')</span></div>';
      trust += '<div class="tr"><b>40+</b><span>' + esc(T('tr_books')) + '</span></div>' +
        '<div class="tr"><b class="g">' + esc(T('tr_live')) + '</b><span>' + esc(T('tr_live_s')) + '</span></div>' +
        '<div class="tr"><b>ES·EN</b><span>' + esc(T('tr_lang')) + '</span></div>';
    }
    $('#trust').innerHTML = trust;
    // jugadas de hoy — v3: Mundial (mientras viva) + clubes intercalados por hora, chip de competición
    var famC = function (f) { return f === 'GOALS' ? 'goals' : f === 'COMBO' ? 'combo' : ''; };
    var famK = function (f) { return f === 'GOALS' ? 'fam_goals' : f === 'COMBO' ? 'fam_combo' : 'fam_solid'; };
    var confK = function (c) { return c === 'high' ? 'c_high' : c === 'med' ? 'c_med' : 'c_low'; };
    var hh = function (iso) { try { return new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-US' : 'es-ES', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
    var picks = ((d && d.picks) || []).slice();
    if (V3 && d && d.clubs && (d.clubs.picks || []).length) {
      picks.forEach(function (p) { p.chip = T('chip_wc'); });
      d.clubs.picks.forEach(function (p) { p.chip = p.competition_name || ''; });
      picks = picks.concat(d.clubs.picks)
        .sort(function (a, b) { return new Date(a.kickoff || 0) - new Date(b.kickoff || 0); })
        .slice(0, 6);
    }
    if (picks.length) {
      $('#plays').innerHTML = '<div class="plays">' + picks.map(function (p) {
        var chip = (V3 && p.chip) ? '<span class="play-lg">' + (p.league ? leagueLogo(p.league, '') : '') + esc(p.chip) + '</span>' : '';
        return '<div class="play ' + famC(p.family) + '" data-signup>' +
          '<div class="play-top"><span style="display:inline-flex;align-items:center;gap:8px;min-width:0">' + '<span class="play-fam">' + esc(T(famK(p.family))) + '</span>' + chip + '</span><span class="play-ko">' + esc(hh(p.kickoff)) + '</span></div>' +
          '<div class="play-m">' + badge(p.home_team_id, 'play-fl') + '<b>' + esc((lang === 'en' && p.home_en) ? p.home_en : (p.home || '')) + '</b><span class="vs">vs</span><b>' + esc((lang === 'en' && p.away_en) ? p.away_en : (p.away || '')) + '</b>' + badge(p.away_team_id, 'play-fl') + '</div>' +
          '<div class="play-lock"><span class="lk">🔒</span><span class="lt">' + esc(T('play_lock')) + '</span></div>' +
          '<div class="play-foot"><span class="play-conf ' + esc(p.confidence_bucket) + '"><i></i>' + esc(T('conf')) + ': <b>' + esc(T(confK(p.confidence_bucket))) + '</b></span></div>' +
          '</div>';
      }).join('') + '</div>';
    } else {
      $('#plays').innerHTML = '<div class="empty"><b>' + esc(T('empty')) + '</b><span>' + esc(T('empty_s')) + '</span></div>';
    }
    // escáner (con gauge) — v3: números ESTRUCTURALES que nunca son 0 (mercados/ligas/casas);
    // el drama de "cuotas mal pagadas" vive en el chip del hero y en la demo, no en un contador en 0.
    var s = (d && d.scanner) || { markets: 0, lag: 0, arb: 0 };
    var gw = function (v, max) { return Math.max(4, Math.min(100, Math.round((v / max) * 100))); };
    var scanEl = $('#scan');
    if (V3 && d && d.clubs) {
      var mkT = (s.markets || 0) + ((d.clubs.scanner && d.clubs.scanner.markets) || 0);
      var st1 = mkT > 0
        ? '<div class="scan-stat hl"><span class="liveflag"><i></i>live</span><b data-n="' + mkT + '">0</b><span>' + esc(T('scan_markets')) + '</span><div class="gauge"><i data-w="100"></i></div></div>'
        : '<div class="scan-stat hl"><span class="liveflag"><i></i>live</span><b>24/7</b><span>' + esc(T('tr_live_s')) + '</span><div class="gauge"><i data-w="100"></i></div></div>';
      scanEl.innerHTML = st1 +
        '<div class="scan-stat"><span class="liveflag"><i></i>live</span><b data-n="' + nL + '">0</b><span>' + esc(T('scan_leagues_v3')) + '</span><div class="gauge"><i data-w="' + gw(nL, 16) + '"></i></div></div>' +
        '<div class="scan-stat"><b>40+</b><span>' + esc(T('scan_books_v3')) + '</span><div class="gauge"><i data-w="80"></i></div></div>';
    } else {
      scanEl.innerHTML =
        '<div class="scan-stat"><span class="liveflag"><i></i>live</span><b data-n="' + s.markets + '">0</b><span>' + esc(T('scan_markets')) + '</span><div class="gauge"><i data-w="' + gw(s.markets, Math.max(s.markets, 60)) + '"></i></div></div>' +
        '<div class="scan-stat hl"><span class="liveflag"><i></i>live</span><b data-n="' + s.lag + '">0</b><span>' + esc(T('scan_lag')) + '</span><div class="gauge"><i data-w="' + gw(s.lag, Math.max(s.lag, 20)) + '"></i></div></div>' +
        '<div class="scan-stat"><span class="liveflag"><i></i>live</span><b data-n="' + s.arb + '">0</b><span>' + esc(T('scan_arb')) + '</span><div class="gauge"><i data-w="' + gw(s.arb, Math.max(s.arb, 8)) + '"></i></div></div>';
    }
    if (scanEl.classList.contains('in')) animateScan(scanEl);
    renderShowcase(d);
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
  // v3: LAS CARRERAS POR EL TÍTULO — una card por liga (prob de campeón del season sim, top 3).
  // Reemplaza a "Quién levanta la copa" (el Mundial termina; las ligas siguen todo el año).
  function renderRaces(clubs) {
    var sec = $('#s-champ'), box = $('#champ');
    var rs = (clubs && clubs.races) || [];
    if (!rs.length) { sec.style.display = 'none'; return; }
    sec.style.display = '';
    box.className = 'races rv' + (box.classList.contains('in') ? ' in' : '');
    box.innerHTML = rs.map(function (r) {
      var maxP = (r.top[0] && r.top[0].prob) || 1;
      var rows = r.top.filter(function (t) { return Math.round(t.prob * 100) >= 1; }).map(function (t) {
        return '<div class="race-row">' + clubLogo(t.id, '') + '<span class="nm">' + esc(t.name) + '</span><span class="tk"><i data-w="' + Math.max(4, Math.round(t.prob / maxP * 100)) + '"></i></span><span class="pc">' + Math.round(t.prob * 100) + '%</span></div>';
      }).join('');
      return '<div class="race"><div class="race-h">' + leagueLogo(r.league) + esc(r.name) + '</div>' + rows + '<div class="race-cap">' + esc(T('race_cap')) + '</div></div>';
    }).join('');
    if (sec.querySelector('.rv.in')) animateChamp();
  }
  function animateChamp() { $$('#champ .tk i').forEach(function (i) { requestAnimationFrame(function () { i.style.width = i.getAttribute('data-w') + '%'; }); }); }

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
  // Deep link al buzón del proveedor, BUSCANDO nuestro correo → salta la pestaña Promociones/Spam (el que
  // llega directo a "de: gpsimulador"). Por dominio del email; desconocido → null (no se muestra el botón).
  function mailInboxUrl(email) {
    var d = (String(email).split('@')[1] || '').toLowerCase();
    if (d === 'gmail.com' || d === 'googlemail.com') return 'https://mail.google.com/mail/u/0/#search/from%3Agpsimulador';
    if (d === 'icloud.com' || d === 'me.com' || d === 'mac.com') return 'https://www.icloud.com/mail/';
    if (d === 'outlook.com' || d === 'hotmail.com' || d === 'live.com' || d === 'msn.com') return 'https://outlook.live.com/mail/0/';
    if (d === 'yahoo.com' || d === 'ymail.com') return 'https://mail.yahoo.com/';
    if (d === 'proton.me' || d === 'protonmail.com') return 'https://mail.proton.me/';
    return null;
  }
  var resendTimer = null;
  function renderAuthCode(demoCode) {
    var mailUrl = mailInboxUrl(authEmail);
    $('#authStep').innerHTML =
      '<div class="modal-eye"><i></i>' + esc(T('a_eye')) + '</div>' +
      '<h3>' + esc(T('a_sent_h')) + '</h3><p class="m-sub">' + T('a_sent_sub', { email: esc(authEmail) }) + '</p>' +
      // PRIMER CTA: abrir el correo directo a la búsqueda de nuestro email (el mayor asesino de fricción en
      // móvil africano: encuentran el correo al instante sin cazar en Promociones, y ahí toca el magic link).
      (mailUrl ? '<a class="btn m-btn" id="aOpen" href="' + mailUrl + '" target="_blank" rel="noopener" style="text-decoration:none;display:block;text-align:center">' + esc(T('a_open_mail')) + '</a>' : '') +
      '<div class="m-spam"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/></svg><span>' + T('a_spam') + '</span></div>' +
      (demoCode ? '<p class="m-msg ok">demo: ' + esc(demoCode) + '</p>' : '') +
      '<p class="m-sub" style="margin:14px 0 6px;font-size:13px;opacity:.75">' + esc(T('a_or_code')) + '</p>' +
      '<div class="m-field"><input class="m-input code" id="aCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="' + esc(T('a_code_ph')) + '"></div>' +
      '<button class="btn m-btn" id="aVerify">' + esc(T('a_verify')) + '</button>' +
      '<div class="m-msg" id="aMsg"></div>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">' +
        '<button class="m-back" id="aResend"></button>' +
        '<button class="m-back" id="aBack">' + esc(T('a_back')) + '</button>' +
      '</div>';
    var inp = $('#aCode');
    setTimeout(function () { inp.focus(); }, 60);
    $('#aVerify').onclick = doVerify;
    inp.onkeydown = function (e) { if (e.key === 'Enter') doVerify(); };
    inp.oninput = function () { inp.value = inp.value.replace(/\D/g, ''); if (inp.value.length === 6) doVerify(); };
    $('#aBack').onclick = function () { if (resendTimer) clearInterval(resendTimer); renderAuthEmail(); };
    startResendCountdown(20);
  }
  // Reenvía el MISMO código/enlace; botón deshabilitado con cuenta regresiva para evitar spam.
  function startResendCountdown(secs) {
    var b = $('#aResend'); if (!b) return;
    var left = secs;
    var tick = function () {
      if (left <= 0) { b.disabled = false; b.textContent = T('a_resend'); if (resendTimer) { clearInterval(resendTimer); resendTimer = null; } return; }
      b.disabled = true; b.textContent = T('a_resend_in', { s: left }); left--;
    };
    b.disabled = true; tick();
    if (resendTimer) clearInterval(resendTimer);
    resendTimer = setInterval(tick, 1000);
    b.onclick = function () {
      if (b.disabled) return;
      b.disabled = true; b.textContent = '…';
      fetch('/api/auth/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authEmail, lang: lang }) })
        .then(function () { var m = $('#aMsg'); if (m) { m.className = 'm-msg ok'; m.textContent = T('a_resent'); } startResendCountdown(30); })
        .catch(function () { startResendCountdown(5); });
    };
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

  /* demo interactiva del escáner — v3: ejemplos de CLUBES (el producto post-Mundial) */
  var demoRows = V3 ? [
    { lg: 'brasileirao', team: 'Palmeiras', tag: 'lag', tagK: 'd_lag', val: '+11%' },
    { lg: 'ligamx', team: 'América', tag: 'lag', tagK: 'd_lag', val: '+8%' },
    { lg: 'mls', team: 'Inter Miami', tag: 'arb', tagK: 'd_arb', val: '+3.2%' },
    { lg: 'argentina', team: 'River Plate', tag: 'lag', tagK: 'd_lag', val: '+6%' }
  ] : [
    { fl: 'AUT', team: 'Austria', tag: 'lag', tagK: 'd_lag', val: '+15%' },
    { fl: 'ALG', team: 'Argelia', tag: 'lag', tagK: 'd_lag', val: '+9%' },
    { fl: 'CRO', team: 'Croacia', tag: 'arb', tagK: 'd_arb', val: '+3.7%' },
    { fl: 'SUI', team: 'Suiza', tag: 'lag', tagK: 'd_lag', val: '+6%' }
  ];
  function openDemo() {
    var rows = demoRows.map(function (r, i) {
      return '<div class="dr" style="animation-delay:' + (i * 90 + 60) + 'ms">' + (r.lg ? leagueLogo(r.lg, 'dfl') : flag(r.fl, 'dfl')) +
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
    // v3: la sección del torneo pasa a ser LAS CARRERAS POR EL TÍTULO (data del propio teaser)
    if (V3) renderRaces((d || {}).clubs);
    requestAnimationFrame(reveal);
  });
  if (!V3) fetch('/api/state').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (s) { if (s && s.top) { renderChamp(s.top); requestAnimationFrame(reveal); } });
  // red de seguridad
  setTimeout(function () { $$('.rv:not(.in)').forEach(revealOne); }, 2200);
})();
