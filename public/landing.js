/* landing.js — página de aterrizaje STANDALONE (sin el shell de la app). Posicionamiento caja-negra:
   vende el resultado, nunca el método. i18n ES/EN inline, data real del teaser público, sin dependencias. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
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
      sc_tag: 'Precio atrasado', sc_live: 'en vivo', sc_edge: 'value', sc_foot: 'Consenso de {n} casas · vendes cuando el precio se corrige',
      sc_float_l: 'cuotas mal pagadas detectadas ahora',
      tr_record: 'aciertos verificados', tr_books: 'casas monitoreadas', tr_live: '24/7', tr_live_s: 'tiempo real', tr_lang: 'español · english',
      plays_eye: 'Producto', plays_title: 'Las jugadas de hoy', plays_sub: 'Publicadas antes del partido, verificadas después. La selección se desbloquea con tu cuenta gratis.',
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
    },
    en: {
      nav_login: 'Log in', nav_cta: 'Sign up',
      eyebrow: 'GP INTELLIGENCE · LIVE',
      h1: "The edge the market <span class=\"g\">doesn't see</span>.",
      sub: 'Verified plays every day, mispriced odds caught the moment they appear, and arbitrage across 40+ books. Institutional-grade intelligence, ready to execute.',
      cta: 'Create my free account', micro: 'No password · just your email · 30 seconds',
      sc_tag: 'Stale price', sc_live: 'live', sc_edge: 'value', sc_foot: '{n}-book consensus · sell when the price corrects',
      sc_float_l: 'mispriced odds detected now',
      tr_record: 'verified hit rate', tr_books: 'books monitored', tr_live: '24/7', tr_live_s: 'real time', tr_lang: 'english · español',
      plays_eye: 'Product', plays_title: "Today's plays", plays_sub: 'Published before the match, verified after. The selection unlocks with your free account.',
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
    }
  };
  var lang = (function () { try { var p = localStorage.getItem('gp_lang'); if (p === 'es' || p === 'en') return p; } catch (e) {} return (navigator.language || 'es').slice(0, 2) === 'en' ? 'en' : 'es'; })();
  var T = function (k, a) { var s = (DICT[lang] || DICT.es)[k]; if (s == null) s = DICT.es[k] || k; return String(s).replace(/\{(\w+)\}/g, function (m, x) { return a && a[x] != null ? a[x] : m; }); };
  var go = function () { location.href = '/?auth=1'; };

  var ICONS = {
    verify: '<path d="M12 3.5 19 6v5.2c0 4.6-2.9 7.6-7 9.3-4.1-1.7-7-4.7-7-9.3V6Z"/><path d="M9.2 11.8l1.9 1.9 3.6-3.9"/>',
    odds: '<path d="M4 17 9.4 11.5 12.9 15 20 7.8"/><path d="M20 7.8h-4M20 7.8v4"/><path d="M4 20h16"/>',
    bolt: '<path d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z"/>'
  };
  var icon = function (k) { return '<svg viewBox="0 0 24 24">' + (ICONS[k] || '') + '</svg>'; };

  function fillStatic() {
    document.documentElement.lang = lang;
    [].forEach.call(document.querySelectorAll('[data-k]'), function (el) { el.innerHTML = T(el.getAttribute('data-k')); });
    [].forEach.call(document.querySelectorAll('[data-go]'), function (b, i) { b.textContent = i === document.querySelectorAll('[data-go]').length - 1 ? T('nav_cta') : b.textContent; });
    // botones nav: primero login (ghost), luego cta; el hero/final usan cta
    var navBtns = document.querySelectorAll('.nav [data-go]');
    if (navBtns[0]) { navBtns[0].className = 'blink'; navBtns[0].textContent = T('nav_login'); }
    if (navBtns[1]) { navBtns[1].className = 'btn'; navBtns[1].textContent = T('nav_cta'); }
    [].forEach.call(document.querySelectorAll('.hero-cta [data-go], .final [data-go]'), function (b) { b.className = 'btn lg'; b.textContent = T('cta'); });
    [].forEach.call(document.querySelectorAll('[data-go]'), function (b) { b.onclick = go; });
    // pilares
    $('#pillars').innerHTML = ['1', '2', '3'].map(function (n) {
      var ik = n === '1' ? 'verify' : n === '2' ? 'odds' : 'bolt';
      return '<div class="pil"><div class="pil-ic">' + icon(ik) + '</div><h3>' + esc(T('why_' + n + 't')) + '</h3><p>' + esc(T('why_' + n + 's')) + '</p></div>';
    }).join('');
    // lang toggle
    [].forEach.call(document.querySelectorAll('#lang button'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-l') === lang);
      b.onclick = function () { var l = b.getAttribute('data-l'); if (l === lang) return; try { localStorage.setItem('gp_lang', l); } catch (e) {} lang = l; location.reload(); };
    });
  }

  function renderShowcase(scan) {
    var n = (scan && scan.markets) || 52;
    var lag = (scan && scan.lag != null) ? scan.lag : 14;
    $('#showcase').innerHTML =
      '<div class="sc-card">' +
      '<div class="sc-head"><span class="sc-tag">' + esc(T('sc_tag')) + '</span><span class="sc-live"><i></i>' + esc(T('sc_live')) + '</span></div>' +
      '<div class="sc-row"><span class="sc-team">' + flag('AUT') + 'Austria</span><span class="sc-odds">12.00</span></div>' +
      '<div class="sc-row"><span class="sc-team" style="color:var(--tx3);font-size:13px">consenso · fair 10.4</span><span class="sc-edge">+15%</span></div>' +
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

  function renderData(d) {
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
        return '<div class="play ' + famC(p.family) + '" data-go>' +
          '<div class="play-top"><span class="play-fam">' + esc(T(famK(p.family))) + '</span><span class="play-ko">' + esc(hh(p.kickoff)) + '</span></div>' +
          '<div class="play-m">' + flag(p.home_team_id, 'play-fl') + '<b>' + esc(p.home || '') + '</b><span class="vs">vs</span><b>' + esc(p.away || '') + '</b>' + flag(p.away_team_id, 'play-fl') + '</div>' +
          '<div class="play-lock"><span class="lk">🔒</span><span class="lt">' + esc(T('play_lock')) + '</span></div>' +
          '<div class="play-foot"><span class="play-conf ' + esc(p.confidence_bucket) + '"><i></i>' + esc(T('conf')) + ': <b>' + esc(T(confK(p.confidence_bucket))) + '</b></span></div>' +
          '</div>';
      }).join('') + '</div>';
    } else {
      $('#plays').innerHTML = '<div class="empty"><b>' + esc(T('empty')) + '</b><span>' + esc(T('empty_s')) + '</span></div>';
    }
    // escáner
    var s = (d && d.scanner) || { markets: 0, lag: 0, arb: 0 };
    var scanEl = $('#scan');
    scanEl.innerHTML =
      '<div class="scan-stat"><b data-n="' + s.markets + '">0</b><span>' + esc(T('scan_markets')) + '</span></div>' +
      '<div class="scan-stat hl"><b data-n="' + s.lag + '">0</b><span>' + esc(T('scan_lag')) + '</span></div>' +
      '<div class="scan-stat"><b data-n="' + s.arb + '">0</b><span>' + esc(T('scan_arb')) + '</span></div>';
    // si la sección ya está revelada (se llenó DESPUÉS del reveal), disparar el count-up ahora; si no, el reveal lo hará
    if (scanEl.classList.contains('in')) [].forEach.call(scanEl.querySelectorAll('[data-n]'), function (b) { countUp(b, +b.getAttribute('data-n')); });
    renderShowcase(s);
    [].forEach.call(document.querySelectorAll('[data-go]'), function (b) { b.onclick = go; });
  }

  function renderChamp(top) {
    if (!top || !top.length) { $('#s-champ').style.display = 'none'; return; }
    var lead = top[0], max = lead.champion;
    var rows = top.slice(1, 6).map(function (t) {
      return '<div class="champ-row">' + flag(t.id) + '<span class="nm">' + esc(t.name) + '</span><span class="tk"><i style="width:' + (t.champion / max * 100).toFixed(0) + '%"></i></span><span class="pc">' + (t.champion * 100).toFixed(1) + '%</span></div>';
    }).join('');
    $('#champ').innerHTML =
      '<div class="champ-lead">' + flag(lead.id) + '<div class="tn">' + esc(lead.name) + '<small>' + esc(T('champ_cap')) + '</small></div><div class="big">' + (lead.champion * 100).toFixed(1) + '<small>%</small></div></div>' +
      rows;
  }

  // scroll reveal — robusto: revela de inmediato lo que ya está en viewport + observa el resto. Nunca deja huecos.
  var _io = null;
  function inView(el) { var r = el.getBoundingClientRect(); return r.top < (window.innerHeight || 0) - 40 && r.bottom > 0; }
  function revealOne(el) { el.classList.add('in'); [].forEach.call(el.querySelectorAll('[data-n]'), function (b) { countUp(b, +b.getAttribute('data-n')); }); }
  function reveal() {
    var els = [].slice.call(document.querySelectorAll('.rv'));
    if (!('IntersectionObserver' in window)) { els.forEach(revealOne); return; }
    els.forEach(function (e) { if (inView(e)) revealOne(e); }); // lo que ya se ve, ya
    if (!_io) _io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { revealOne(e.target); _io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
    els.forEach(function (e) { if (!e.classList.contains('in')) _io.observe(e); });
  }

  fillStatic();
  renderShowcase(null);
  reveal(); // hero visible ya
  fetch('/api/public/teaser').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (d) {
    renderData(d || {});
    requestAnimationFrame(reveal); // re-observa las secciones ya con contenido
  });
  // el champion viene de /api/state (teaser)
  fetch('/api/state').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (s) { if (s && s.top) { renderChamp(s.top); requestAnimationFrame(reveal); } });
  window.addEventListener('scroll', function () { reveal(); }, { passive: true });
  // red de seguridad: nada queda invisible aunque el observer falle (después de 2.2s se revela todo pendiente)
  setTimeout(function () { [].forEach.call(document.querySelectorAll('.rv:not(.in)'), revealOne); }, 2200);
})();
