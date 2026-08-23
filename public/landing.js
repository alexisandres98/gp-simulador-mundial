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
      lb_txt: 'Nueve deportes abiertos: baloncesto, esports, americano, tenis y F1, gratis esta semana.', lb_cta: 'Crear cuenta gratis',
      eyebrow: '+500 picks liquidadas en público',
      h1: 'El modelo que <span class="g">le discute el precio</span> al mercado.',
      sub: 'Simulamos cada partido 10,000 veces, comparamos contra 40+ casas y publicamos cada pick con su porqué, su cuota congelada y su resultado liquidado en público. Fútbol y combate, en tu idioma.',
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
      why_eye: 'Por qué GP', why_title: 'Funciona distinto. A propósito.',
      why_1t: 'Un modelo, no un tipster', why_1s: 'Simulamos cada partido 10,000 veces (Elo → Poisson → Monte Carlo). La pick sale del modelo, no de una corazonada.',
      why_2t: 'El porqué de cada pick', why_2s: 'Cada pick llega con su lectura de analista: qué ve el modelo, qué paga el mercado y dónde está la diferencia.',
      why_3t: 'Track público, con las perdidas', why_3s: 'Cada pick queda registrada antes del partido y liquidada en público después. Audítalo tú mismo antes de pagar.',
      why_4t: 'Tus ligas y tus casas', why_4s: 'Brasileirão, Liga MX, Argentina, MLS y 40 ligas más, con las casas que se usan en LATAM. En tu idioma.',
      why_5t: 'Combate modelado', why_5s: 'UFC, MMA y boxeo con lectura profunda de cada pelea: ritmo, alcance, presión y camino al triunfo.',
      why_6t: '10 minutos al día', why_6s: 'Entras, ves las picks del día con su porqué y su mejor cuota, y sigues tu cartera. Sin pantallas infinitas.',
      /* P18: mini-demos (datos congelados de picks REALES liquidadas) */
      fe_eye: 'El producto, por dentro', fe_title: 'Pruébalo antes de pagar.',
      fe_sub: 'Componentes reales de la plataforma con picks reales, ya liquidadas. Así se ve por dentro.',
      fe_1t: 'La pick, con su porqué', fe_1s: 'No es una fila verde: cada pick llega con la lectura del modelo.',
      fe_1fam: 'Tarjetas', fe_1win: '✓ Ganada · liquidada 9-ago', fe_1sel: 'Menos de 6.5 tarjetas · cuota 1.44',
      fe_1q: '«La cuota luce generosa frente a lo que suele dejar este tipo de cruces en el Brasileirão. El modelo encuentra un desajuste claro entre el precio y el partido que espera.»',
      fe_cap: 'Componente real · pick real del feed',
      fe_2t: 'La cuota justa, a la vista', fe_2s: 'Quitamos el margen de la casa y te mostramos cuánto debería pagar.',
      fe_2sel: 'Under 5.5 tarjetas · Cuiabá vs Fortaleza',
      fe_2c1: 'justa <b>1.68</b>', fe_2c2: 'mejor <b>1.83</b> · LeoVegas', fe_2c3: 'edge <b>+9.0 pp</b>',
      fe_2q: '«El mercado paga 1.83 al under 5.5 y el modelo detecta 9 puntos porcentuales a favor de esa línea.»',
      fe_cap2: 'Componente real · liquidada como ganada el 9-ago',
      fe_3t: 'Lectura profunda de pelea', fe_3s: 'Combate modelado de verdad: ritmo, alcance y camino al triunfo.',
      fe_3fam: '🥊 UFC · Film study', fe_3s1: 'Golpes significativos / min', fe_3s2: 'Alcance', fe_3s3: 'Lectura del modelo', fe_3s3v: 'ritmo + presión',
      fe_cap3: 'Análisis real de la plataforma · plan Pro+',
      fe_4t: 'El mercado, vigilado 24/7', fe_4s: 'Value, arbitraje, caídas de cuota y middles entre 40+ casas.',
      fe_4s1: 'Cuotas mal pagadas (value)', fe_4v1: 'edge del modelo', fe_4s2: 'Arbitraje puro', fe_4v2: '2 casas, 0 riesgo de dirección',
      fe_4s3: 'Caídas de cuota', fe_4v3: 'sharps vs casas lentas', fe_4s4: 'Middles', fe_4v4: 'dos líneas, zona doble',
      fe_cap4: 'Superficies reales del plan Sharp',
      /* P18: pasos */
      st_eye: 'Cómo empezar', st_title: 'Tres pasos. Sin vueltas.',
      st_1t: '30 segundos', st_1h: 'Entra', st_1p: 'Solo tu email. Sin contraseña, sin tarjeta.',
      st_2t: '2 minutos', st_2h: 'Mira la pick del día', st_2p: 'Con su porqué, su cuota congelada y la mejor casa para tomarla.',
      st_3t: 'Automático', st_3h: 'Sigue el resultado en público', st_3p: 'Cada pick se liquida a la vista de todos. Ganadas y perdidas.',
      /* P18: cobertura + track honesto */
      cv_eye: 'Cobertura', cv_title: 'Tus ligas, tus casas, tu idioma.',
      cv_c1: '<b>44</b> ligas de fútbol en vivo', cv_c2: '🥊 UFC · MMA · boxeo', cv_c3: '<b>40+</b> casas comparadas',
      cv_c4: 'Brasileirão · Liga MX · Argentina · MLS', cv_c5: 'Español · English',
      tk_eye: 'Track público', tk_h: 'Sin ganancias prometidas. Todo a la vista.',
      tk_n1: 'picks liquidadas en público', tk_n2: 'ganadas', tk_n3: 'perdidas',
      tk_p: 'Cada pick queda registrada antes del partido con su cuota congelada, y se liquida en público después — las ganadas y las perdidas, sin editar ni borrar nada. Quien te prometa ganancias garantizadas te está mintiendo; nosotros preferimos que audites el historial completo antes de pagar un centavo.',
      tk_cta: 'Crear cuenta y auditarlo',
      /* P18: pricing */
      pr_eye: 'Planes', pr_title: 'Precios claros, sin sorpresas.',
      pr_mo: 'Mensual', pr_yr: 'Anual', pr_save: '2 meses gratis',
      pr1_n: 'Gratis', pr1_per: 'para siempre',
      pr1_f1: 'La pick del día, con su porqué', pr1_f2: 'Marcadores y lectura del modelo en vivo', pr1_f3: 'Pick diaria gratis en Telegram',
      pr1_cta: 'Crear cuenta gratis', pr1_m: 'Sin tarjeta',
      pr2_per: 'para el que sigue el día a día',
      pr2_f1: 'Todas las picks de fútbol y combate', pr2_f2: 'El porqué completo de cada pick', pr2_f3: 'Cockpit del partido en vivo',
      pr2_f4: 'Bet checker: tu cuota vs la justa', pr2_f5: 'Alertas de tus equipos y ligas',
      pr2_cta: 'Elegir Pro', pr2_m: 'Cancelas en 1 clic',
      pr3_pop: 'Prueba GRATIS 3 días', pr3_per: 'la plataforma completa',
      pr3_f1: 'Todo lo de Pro', pr3_f2: 'Cuotas mal pagadas (value) entre 40+ casas', pr3_f3: 'Arbitraje puro y middles',
      pr3_f4: 'Caídas de cuota: sharps vs casas lentas', pr3_f5: 'Film study de cada pelea', pr3_f6: 'Calculadora de stake con tu bankroll',
      pr3_cta: 'Probar Sharp gratis', pr3_m: 'Hoy pagas $0 · cancelas en 1 clic',
      pr_note: 'Precios en USD · reembolso dentro de las primeras 24 h · sin permanencia',
      /* P18: FAQ */
      fq_eye: 'Preguntas frecuentes', fq_title: 'Lo que preguntarías antes de pagar.',
      fq1_q: '¿Esto es un tipster?', fq1_a: 'No. Un tipster te pide confianza; un modelo te muestra el cálculo. GP simula cada partido 10,000 veces, compara contra el precio real de 40+ casas y publica cada pick con su porqué — y con su resultado, gane o pierda.',
      fq2_q: '¿Me garantizan ganancias?', fq2_a: 'No — y desconfía de quien lo haga. Apostar tiene varianza y ningún modelo gana siempre. Lo que sí garantizamos: cada pick registrada antes del partido, liquidada en público después, con el historial completo auditable. Esa honestidad es la señal de calidad, no un eslogan.',
      fq3_q: '¿Qué es el track público?', fq3_a: 'Cada pick queda publicada antes del partido con su cuota congelada. Cuando termina, se liquida a la vista de todos: ganada o perdida. No se edita ni se borra nada. Ya van más de 500 picks liquidadas así.',
      fq4_q: '¿Qué deportes y ligas cubren?', fq4_a: '44 ligas de fútbol en vivo (Brasileirão, Liga MX, Argentina, MLS y más) y todas las carteleras de UFC, MMA y boxeo, con lectura profunda de cada pelea. Más deportes en camino.',
      fq5_q: '¿Necesito saber de apuestas?', fq5_a: 'No. Al entrar eliges tu nivel y la plataforma ajusta la explicación. Cada pick trae su porqué en español claro, y las guías y calculadoras gratuitas te enseñan lo demás.',
      fq6_q: '¿Puedo cancelar? ¿Hay reembolso?', fq6_a: 'Cancelas en 1 clic desde tu cuenta, sin permanencia. Y si pagas y no era para ti, tienes reembolso dentro de las primeras 24 horas.',
      fq7_q: '¿Funciona en mi país?', fq7_a: 'La plataforma funciona en cualquier país, en español e inglés. Las cuotas que comparamos incluyen casas disponibles en toda LATAM — tú eliges las tuyas y la plataforma te muestra dónde pagan más.',
      /* P18: footer SEO */
      fs_tools: 'Calculadoras gratis', fs_tools_all: 'Todas las calculadoras →',
      fs_guides: 'Guías', fs_guides_all: 'Todas las guías →',
      fs_odds: 'Cuotas', fs_odds_next: 'Próximos partidos y cuota justa',
      champ_eye: 'La lectura del torneo', champ_title: 'Quién levanta la copa.', champ_sub: 'Recalculado en vivo con cada gol. Solo la punta — el análisis completo está dentro.',
      champ_cap: 'de levantar la copa',
      final_h: 'La ventaja no espera. Empieza gratis.',
      disc: 'Estimaciones estadísticas · no es consejo financiero · apuesta con responsabilidad',
      foot_tag: 'Inteligencia deportiva en tiempo real', foot_legal: '© 2026 · No es consejo financiero',
      a_or: 'o', a_g_wait: 'Entrando…', a_sub_g: 'Sin contraseña. Entra con Google en un toque, o te enviamos un código a tu email.',
      tg_lead: 'Pick gratis todos los días en Telegram', tg_sub: 'Y los resultados de cada pick, ganadas y perdidas. Sin registro.', tg_cta: 'Unirme al canal',
      /* modal registro */
      trb_b: 'Prueba Sharp GRATIS 3 días', trb_s: 'Hoy pagas $0 · cancelas en 1 clic', trb_go: 'Empezar →',
      a_eye: 'Acceso gratis', a_h: 'Entra o crea tu cuenta', a_sub: 'Sin contraseña. Te enviamos un código a tu email y entras al instante.',
      a_email_l: 'Tu email', a_email_ph: 'tucorreo@email.com', a_send: 'Enviar código',
      a_micro: 'Nueve deportes · sin tarjeta · sin spam',
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
      /* v3 (clubes) — P18: el hero nuevo (blueprint) manda en todas las versiones; _v3/_v4 ya no pisan h1/sub */
      sc3_live: 'en vivo', sc3_xg: 'xG esperado', sc3_foot: 'Lectura del modelo en vivo · se recalcula con cada gol',
      scf_markets: 'mercados vigilados ahora', scf_leagues: 'ligas monitoreadas 24/7',
      tr_rec_v3: 'aciertos verificados · Mundial 2026', tr_leagues_v3: 'ligas en vivo',
      plays_sub_v3: 'Publicadas antes del partido con su precio congelado, liquidadas en público después. La selección se desbloquea con tu cuenta gratis.',
      chip_wc: 'Mundial',
      scan_sub_v3: 'Vigilamos 40 ligas y el mercado global 24/7 y detectamos el precio que quedó atrás — antes de que lo corrijan.',
      scan_leagues_v3: 'ligas en vivo', scan_books_v3: 'casas comparadas',
      champ_eye_v3: 'La lectura de la temporada', champ_title_v3: 'Las carreras por el título.',
      champ_sub_v3: 'Probabilidad de campeón por liga, recalculada con cada jornada. Solo la punta — el análisis completo está dentro.',
      race_cap: 'prob. de campeón',
      a_micro_v3: 'Gratis · sin tarjeta · sin spam',
      /* v4 (multideporte, 5-ago): la plataforma deja de ser solo fútbol — combate entra al hero.
         Solo se tocan las llaves que cambian; todo lo demás hereda de v3/base. */
      lb_txt_v4: 'Nuevo: UFC, MMA y boxeo ya están adentro — gratis en todos los planes por 7 días.',
      scan_sub_v4: 'Vigilamos 40 ligas, cada cartelera de combate y el mercado global 24/7 — y detectamos el precio que quedó atrás antes de que lo corrijan.',
      tr_sports_v4: 'fútbol · UFC · MMA · boxeo',
      scf_leagues_v4: 'ligas y carteleras 24/7', st4_read: 'Lectura del modelo', st4_sat: 'sábado', st4_combat: 'COMBATE · UFC', st4_ko: 'KO 65% · DEC 35%', st4_feed: 'Así llegan las picks al feed', st4_pick1: 'Gana Young Boys', st4_pick1m: 'Lausanne vs Young Boys · Super League (SUI)', st4_pick2: 'Salkilld · Ganador', st4_pick2m: 'Gamrot vs Salkilld · UFC · estelar', st4_pick3: 'Menos de 11.5 córners', st4_pick3m: 'Ilves vs Mariehamn · Veikkausliiga (FIN)', st4_best: 'MEJOR CUOTA', st4_users: 'usuarios reales', st4_verified: 'track verificado, pick por pick',
      plays_sub_v4: 'Fútbol y combate, publicadas antes con su precio congelado, liquidadas en público después. La selección se desbloquea con tu cuenta gratis.',
      d_sub_v4: 'Compara decenas de casas en tiempo real — en partidos y en peleas — y marca el precio que quedó atrás antes de que lo corrijan.',
    },
    en: {
      nav_login: 'Log in', nav_cta: 'Sign up',
      lb_txt: 'Nine sports open: basketball, esports, American football, tennis and F1, free this week.', lb_cta: 'Create free account',
      eyebrow: '500+ picks settled in public',
      h1: 'The model that <span class="g">argues with the market</span> over price.',
      sub: 'We simulate every match 10,000 times, compare against 40+ books and publish every pick with its reasoning, its frozen odds and its result settled in public. Football and combat, in your language.',
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
      why_eye: 'Why GP', why_title: 'It works differently. On purpose.',
      why_1t: 'A model, not a tipster', why_1s: 'We simulate every match 10,000 times (Elo → Poisson → Monte Carlo). Picks come from the model, not a hunch.',
      why_2t: 'The why behind every pick', why_2s: "Every pick ships with an analyst's read: what the model sees, what the market pays, and where the gap is.",
      why_3t: 'Public track, losses included', why_3s: 'Every pick is logged before the match and settled in public after. Audit it yourself before paying.',
      why_4t: 'Your leagues, your books', why_4s: 'Brasileirão, Liga MX, Argentina, MLS and 40 more leagues, with the books people actually use in LATAM.',
      why_5t: 'Combat, properly modeled', why_5s: 'UFC, MMA and boxing with a deep read of every fight: pace, reach, pressure and path to victory.',
      why_6t: '10 minutes a day', why_6s: "Log in, see today's picks with their reasoning and best odds, track your bets. No endless screens.",
      /* P18: mini-demos */
      fe_eye: 'The product, inside', fe_title: 'Try it before you pay.',
      fe_sub: 'Real platform components with real, already-settled picks. This is what it looks like inside.',
      fe_1t: 'The pick, with its why', fe_1s: "Not a green row: every pick ships with the model's read.",
      fe_1fam: 'Cards', fe_1win: '✓ Won · settled Aug 9', fe_1sel: 'Under 6.5 cards · odds 1.44',
      fe_1q: '«The price looks generous versus what this kind of Brasileirão matchup usually produces. The model finds a clear gap between the price and the match it expects.»',
      fe_cap: 'Real component · real pick from the feed',
      fe_2t: 'Fair odds, in plain sight', fe_2s: "We strip the book's margin and show you what it should pay.",
      fe_2sel: 'Under 5.5 cards · Cuiabá vs Fortaleza',
      fe_2c1: 'fair <b>1.68</b>', fe_2c2: 'best <b>1.83</b> · LeoVegas', fe_2c3: 'edge <b>+9.0 pp</b>',
      fe_2q: '«The market pays 1.83 on the under 5.5 and the model detects 9 percentage points in favor of that line.»',
      fe_cap2: 'Real component · settled as a win on Aug 9',
      fe_3t: 'Deep fight read', fe_3s: 'Combat modeled for real: pace, reach and path to victory.',
      fe_3fam: '🥊 UFC · Film study', fe_3s1: 'Significant strikes / min', fe_3s2: 'Reach', fe_3s3: 'Model read', fe_3s3v: 'pace + pressure',
      fe_cap3: 'Real platform analysis · Pro+ plan',
      fe_4t: 'The market, watched 24/7', fe_4s: 'Value, arbitrage, dropping odds and middles across 40+ books.',
      fe_4s1: 'Mispriced odds (value)', fe_4v1: 'model edge', fe_4s2: 'Pure arbitrage', fe_4v2: '2 books, 0 directional risk',
      fe_4s3: 'Dropping odds', fe_4v3: 'sharps vs slow books', fe_4s4: 'Middles', fe_4v4: 'two lines, double-win zone',
      fe_cap4: 'Real Sharp-plan surfaces',
      /* P18: steps */
      st_eye: 'Getting started', st_title: 'Three steps. No friction.',
      st_1t: '30 seconds', st_1h: 'Sign up', st_1p: 'Just your email. No password, no card.',
      st_2t: '2 minutes', st_2h: "See today's pick", st_2p: 'With its reasoning, its frozen odds and the best book to take it.',
      st_3t: 'Automatic', st_3h: 'Follow the result in public', st_3p: 'Every pick settles in front of everyone. Wins and losses.',
      /* P18: coverage + honest track */
      cv_eye: 'Coverage', cv_title: 'Your leagues, your books, your language.',
      cv_c1: '<b>44</b> live football leagues', cv_c2: '🥊 UFC · MMA · boxing', cv_c3: '<b>40+</b> books compared',
      cv_c4: 'Brasileirão · Liga MX · Argentina · MLS', cv_c5: 'Español · English',
      tk_eye: 'Public track', tk_h: 'No promised profits. Everything in the open.',
      tk_n1: 'picks settled in public', tk_n2: 'won', tk_n3: 'lost',
      tk_p: 'Every pick is logged before the match with its odds frozen, then settled in public — wins and losses, nothing edited or deleted. Anyone promising you guaranteed profits is lying; we would rather you audit the full history before paying a cent.',
      tk_cta: 'Sign up and audit it',
      /* P18: pricing */
      pr_eye: 'Plans', pr_title: 'Clear pricing, no surprises.',
      pr_mo: 'Monthly', pr_yr: 'Annual', pr_save: '2 months free',
      pr1_n: 'Free', pr1_per: 'forever',
      pr1_f1: "Today's pick, with its why", pr1_f2: 'Live scores and model reads', pr1_f3: 'Free daily pick on Telegram',
      pr1_cta: 'Create free account', pr1_m: 'No card',
      pr2_per: 'for the day-to-day follower',
      pr2_f1: 'Every football and combat pick', pr2_f2: 'The full reasoning behind each pick', pr2_f3: 'Live match cockpit',
      pr2_f4: 'Bet checker: your odds vs fair', pr2_f5: 'Alerts for your teams and leagues',
      pr2_cta: 'Choose Pro', pr2_m: 'Cancel in one click',
      pr3_pop: 'FREE 3-day trial', pr3_per: 'the full platform',
      pr3_f1: 'Everything in Pro', pr3_f2: 'Mispriced odds (value) across 40+ books', pr3_f3: 'Pure arbitrage and middles',
      pr3_f4: 'Dropping odds: sharps vs slow books', pr3_f5: 'Film study for every fight', pr3_f6: 'Stake calculator with your bankroll',
      pr3_cta: 'Try Sharp free', pr3_m: '$0 today · cancel in one click',
      pr_note: 'Prices in USD · refund within the first 24h · no lock-in',
      /* P18: FAQ */
      fq_eye: 'FAQ', fq_title: "What you'd ask before paying.",
      fq1_q: 'Is this a tipster?', fq1_a: 'No. A tipster asks for trust; a model shows you the math. GP simulates every match 10,000 times, compares against real prices from 40+ books and publishes every pick with its reasoning — and its result, win or lose.',
      fq2_q: 'Do you guarantee profits?', fq2_a: 'No — and distrust anyone who does. Betting has variance and no model always wins. What we do guarantee: every pick logged before the match, settled in public after, with the full history auditable. That honesty is the quality signal, not a slogan.',
      fq3_q: 'What is the public track?', fq3_a: 'Every pick is published before the match with its odds frozen. When it ends, it settles in front of everyone: won or lost. Nothing is edited or deleted. Over 500 picks have been settled this way.',
      fq4_q: 'Which sports and leagues?', fq4_a: '44 live football leagues (Brasileirão, Liga MX, Argentina, MLS and more) plus every UFC, MMA and boxing card, with a deep read of each fight. More sports on the way.',
      fq5_q: 'Do I need betting knowledge?', fq5_a: 'No. You pick your level when you join and the platform adjusts its explanations. Every pick comes with its reasoning in plain language, and the free guides and calculators teach you the rest.',
      fq6_q: 'Can I cancel? Refunds?', fq6_a: 'Cancel in one click from your account, no lock-in. And if you pay and it was not for you, there is a refund within the first 24 hours.',
      fq7_q: 'Does it work in my country?', fq7_a: 'The platform works in any country, in Spanish and English. The odds we compare include books available across LATAM — you choose yours and the platform shows you where they pay more.',
      /* P18: footer SEO */
      fs_tools: 'Free calculators', fs_tools_all: 'All calculators →',
      fs_guides: 'Guides', fs_guides_all: 'All guides →',
      fs_odds: 'Odds', fs_odds_next: 'Upcoming matches & fair odds',
      champ_eye: 'The tournament read', champ_title: 'Who lifts the cup.', champ_sub: 'Recalculated live with every goal. Just the top — the full analysis is inside.',
      champ_cap: 'to lift the cup',
      final_h: "The edge won't wait. Start free.",
      disc: 'Statistical estimates · not financial advice · bet responsibly',
      foot_tag: 'Real-time sports intelligence', foot_legal: '© 2026 · Not financial advice',
      a_or: 'or', a_g_wait: 'Signing you in…', a_sub_g: 'No password. Continue with Google in one tap, or we send a code to your email.',
      tg_lead: 'A free pick every day on Telegram', tg_sub: 'Plus every result, wins and losses. No signup needed.', tg_cta: 'Join the channel',
      trb_b: 'Try Sharp FREE for 3 days', trb_s: '$0 today · cancel in one click', trb_go: 'Start →',
      a_eye: 'Free access', a_h: 'Log in or sign up', a_sub: 'No password. We email you a code and you’re in instantly.',
      a_email_l: 'Your email', a_email_ph: 'you@email.com', a_send: 'Send code',
      a_micro: 'Nine sports · no card · no spam',
      a_sent_h: 'Check your email', a_sent_sub: 'We sent a link and a code to <b>{email}</b>. Tap the link in the email to log in instantly.',
      a_spam: "Don't see it? Check your <b>Spam</b> or <b>Promotions</b> folder — it can take up to a minute.",
      a_open_mail: 'Open my email', a_resend: 'Resend code', a_resend_in: 'Resend in {s}s', a_resent: '✓ Email resent',
      a_or_code: 'Or enter the code from the email:',
      a_code_l: 'Code', a_code_ph: '••••••', a_verify: 'Enter', a_back: 'Use another email',
      a_ok_h: "You're in!", a_ok_sub: 'Taking you to your account…',
      e_email: 'Enter a valid email.', e_code: 'Wrong or expired code.', e_net: 'Connection error, try again.',
      d_eye: 'Live demo', d_h: 'Inside the scanner', d_sub: 'It compares dozens of books in real time and flags the price that fell behind — before it gets corrected.',
      d_lag: 'Stale price', d_arb: 'Surebet', d_note: 'Illustrative scanner data. The real, live opportunities are inside your account.', d_cta: 'Sign up to see the real one',
      /* v3 (clubs) — P18: new hero copy rules every version */
      sc3_live: 'live', sc3_xg: 'expected xG', sc3_foot: 'Live model read · recalculated with every goal',
      scf_markets: 'markets watched right now', scf_leagues: 'leagues monitored 24/7',
      tr_rec_v3: 'verified hits · 2026 World Cup', tr_leagues_v3: 'live leagues',
      plays_sub_v3: 'Published before kickoff with the price frozen, settled in public after. The selection unlocks with your free account.',
      chip_wc: 'World Cup',
      scan_sub_v3: 'We watch 40 leagues and the global market 24/7 and catch the price that fell behind — before it gets corrected.',
      scan_leagues_v3: 'live leagues', scan_books_v3: 'books compared',
      champ_eye_v3: 'The season read', champ_title_v3: 'The title races.',
      champ_sub_v3: 'Champion probability per league, recalculated after every matchday. Just the top — the full analysis is inside.',
      race_cap: 'champion prob.',
      a_micro_v3: 'Free · no card · no spam',
      /* v4 (multi-sport) */
      lb_txt_v4: 'New: UFC, MMA and boxing are in — free on every plan for 7 days.',
      scan_sub_v4: 'We watch 40 leagues, every combat card and the global market 24/7 — and catch the price that fell behind before it gets corrected.',
      tr_sports_v4: 'football · UFC · MMA · boxing',
      scf_leagues_v4: 'leagues & cards 24/7', st4_read: 'Model read', st4_sat: 'Saturday', st4_combat: 'COMBAT · UFC', st4_ko: 'KO 65% · DEC 35%', st4_feed: 'How picks land on the feed', st4_pick1: 'Young Boys to win', st4_pick1m: 'Lausanne vs Young Boys · Super League (SUI)', st4_pick2: 'Salkilld · Winner', st4_pick2m: 'Gamrot vs Salkilld · UFC · main event', st4_pick3: 'Under 11.5 corners', st4_pick3m: 'Ilves vs Mariehamn · Veikkausliiga (FIN)', st4_best: 'BEST ODDS', st4_users: 'real users', st4_verified: 'verified track, pick by pick',
      plays_sub_v4: 'Football and combat, published before with the price frozen, settled in public after. The selection unlocks with your free account.',
      d_sub_v4: 'It compares dozens of books in real time — on matches and on fights — and flags the price that fell behind before it gets corrected.',
    }
  };
  var lang = (function () { try { var p = localStorage.getItem('gp_lang'); if (p === 'es' || p === 'en') return p; } catch (e) {} return (function(){var d=(typeof window!=='undefined'&&window.__GPDL)||'en';if(d==='es'||d==='en')return d;return (navigator.language||'es').slice(0,2)==='en'?'en':'es';})(); })();
  // LANDING v3 (clubes): el server inyecta __GPL3 (flag) y ?landing3=1 la fuerza (preview). Con v3, T()
  // prefiere la variante `<k>_v3` del copy → un solo diccionario, cero bifurcación de markup estático.
  var V3 = /[?&]landing3=1/.test(location.search) || !!window.__GPL3;
  if (V3) { try { document.body.classList.add('v3'); } catch (e) {} }
  // V4 (multideporte, 5-ago): atada al flag del lanzamiento de combate (__GPM) — o ?landing4=1 para preview.
  // Hereda TODO de v3 y solo pisa las llaves _v4 que existen: cero bifurcación de markup, mismo esqueleto.
  var V4 = /[?&]landing4=1/.test(location.search) || !!window.__GPM;
  if (V4) { V3 = true; try { document.body.classList.add('v3'); } catch (e) {} }
  var T = function (k, a) {
    var d0 = DICT[lang] || DICT.es;
    var s = V4 && d0[k + '_v4'] != null ? d0[k + '_v4'] : V3 && d0[k + '_v3'] != null ? d0[k + '_v3'] : d0[k];
    if (s == null) s = (V4 && DICT.es[k + '_v4'] != null ? DICT.es[k + '_v4'] : V3 && DICT.es[k + '_v3'] != null ? DICT.es[k + '_v3'] : DICT.es[k]) || k;
    return String(s).replace(/\{(\w+)\}/g, function (m, x) { return a && a[x] != null ? a[x] : m; });
  };
  var clubLogo = function (id, cls) { return id && /^tm_[a-z0-9]+$/i.test(String(id)) ? '<img class="' + (cls || 'sc-fl') + '" src="/logos/' + esc(id) + '.png" alt="" onerror="this.remove()">' : ''; };
  var leagueLogo = function (key, cls) { return key && /^[a-z0-9]+$/.test(String(key)) ? '<img class="' + (cls || '') + '" src="/logos/league-' + esc(key) + '.png" alt="" onerror="this.remove()">' : ''; };
  var badge = function (id, cls) { return /^tm_/i.test(String(id || '')) ? clubLogo(id, (cls || 'play-fl') + ' clx') : flag(id, cls); };

  // capturar referido de la URL (?ref=CODE) para no perderlo en el registro desde la landing
  try { var rf = new URLSearchParams(location.search).get('ref'); if (rf) localStorage.setItem('wc_ref', rf); } catch (e) {}

  var ICONS = {
    verify: '<path d="M12 3.5 19 6v5.2c0 4.6-2.9 7.6-7 9.3-4.1-1.7-7-4.7-7-9.3V6Z"/><path d="M9.2 11.8l1.9 1.9 3.6-3.9"/>',
    odds: '<path d="M4 17 9.4 11.5 12.9 15 20 7.8"/><path d="M20 7.8h-4M20 7.8v4"/><path d="M4 20h16"/>',
    bolt: '<path d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z"/>',
    /* P18: iconos para los 6 pilares nuevos */
    model: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="8.5" cy="8.5" r="1.3"/><circle cx="15.5" cy="8.5" r="1.3"/><circle cx="8.5" cy="15.5" r="1.3"/><circle cx="15.5" cy="15.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/>',
    why: '<path d="M6 4h9l3 3v13H6z"/><path d="M15 4v3h3"/><path d="M9 11h6M9 14.5h6M9 18h4"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5s1.3-6.1 3.9-8.5Z"/>',
    fist: '<path d="M7 12V8.5A1.5 1.5 0 0 1 8.5 7h0A1.5 1.5 0 0 1 10 8.5V12"/><path d="M10 11V7.5A1.5 1.5 0 0 1 11.5 6h0A1.5 1.5 0 0 1 13 7.5V11"/><path d="M13 11V8a1.5 1.5 0 0 1 1.5-1.5h0A1.5 1.5 0 0 1 16 8v4"/><path d="M16 12v-2a1.5 1.5 0 0 1 3 0v4c0 3.5-2.5 6-6.5 6S7 17.5 7 14v-2"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>'
  };
  var icon = function (k) { return '<svg viewBox="0 0 24 24">' + (ICONS[k] || '') + '</svg>'; };

  function fillStatic() {
    document.documentElement.lang = lang;
    $$('[data-k]').forEach(function (el) { el.innerHTML = T(el.getAttribute('data-k')); });
    // botones nav
    $$('[data-login]').forEach(function (b) { b.className = 'blink'; b.textContent = T('nav_login'); b.onclick = function () { openAuth(); }; });
    $$('[data-signup]').forEach(function (b) {
      // P18: botones con data-k2 (track/pricing) conservan su clase y su propio label — solo se les cablea el auth
      if (b.getAttribute('data-k2')) { b.textContent = T(b.getAttribute('data-k2')); b.onclick = function () { openAuth(); }; return; }
      var nav = b.closest('.nav'); b.className = nav ? 'btn' : 'btn lg'; b.textContent = nav ? T('nav_cta') : T('cta');
      b.onclick = function () { openAuth(); };
    });
    $$('[data-demo]').forEach(function (b) { b.onclick = openDemo; });
    // banner de anuncio (post-Mundial → clubes): click = crear cuenta (openAuth); data-k pinta el texto ES/EN
    var _lb = $('#lbanner'); if (_lb) { _lb.onclick = function () { openAuth(); }; _lb.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAuth(); } }; }
    // pilares — P18: 6 tarjetas (blueprint BetHero Parte 3), cada una desactiva una objeción
    var PIL_IC = { 1: 'model', 2: 'why', 3: 'verify', 4: 'globe', 5: 'fist', 6: 'clock' };
    $('#pillars').innerHTML = ['1', '2', '3', '4', '5', '6'].map(function (n) {
      return '<div class="pil"><div class="pil-ic">' + icon(PIL_IC[n]) + '</div><h3>' + esc(T('why_' + n + 't')) + '</h3><p>' + esc(T('why_' + n + 's')) + '</p></div>';
    }).join('');
    // P18: toggle mensual/anual del pricing (anual = 2 meses gratis; los montos viven en data-mo/data-yr)
    var pt = $('#ptoggle');
    if (pt) $$('button', pt).forEach(function (b) {
      b.onclick = function () {
        var per = b.getAttribute('data-per');
        $$('button', pt).forEach(function (x) { x.classList.toggle('on', x === b); });
        $$('#pricing .pr-price').forEach(function (pp) {
          var num = pp.querySelector('.pnum'), sm = pp.querySelector('.pper');
          if (num && pp.getAttribute('data-' + per)) num.textContent = pp.getAttribute('data-' + per);
          if (sm && sm.getAttribute('data-' + per)) sm.textContent = sm.getAttribute('data-' + per);
        });
      };
    });
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
    // v4 (5-ago, orden de Alexis): el showcase es ESTÁTICO y carga a la primera — jamás un cuadro vacío
    // esperando al fetch. Data real congelada (lectura del modelo de esta semana), no placeholder inventado.
    // ?live=1 restaura el comportamiento dinámico para inspección.
    var wantLive = /[?&]live=1/.test(location.search);
    if (V4 && !wantLive) {
      if (window.__sc4) return; // ya pintado: la llegada del teaser NO lo pisa
      window.__sc4 = true;
      $('#showcase').innerHTML =
        '<div class="sc-card">' +
        '<div class="sc-head"><span class="scv3-league">' + leagueLogo('brasileirao') + 'Brasileir\u00e3o S\u00e9rie A</span><span class="sc-live"><i></i>' + esc(T('st4_read')) + '</span></div>' +
        '<div class="scv3-teams">' +
          '<div class="scv3-side">' + clubLogo('tm_58387', '') + '<b>Palmeiras</b></div>' +
          '<div class="scv3-mid"><div class="ko">21:00</div><div class="day">' + esc(T('st4_sat')) + '</div></div>' +
          '<div class="scv3-side">' + clubLogo('tm_62523', '') + '<b>Internacional</b></div>' +
        '</div>' +
        '<div class="scv3-bar"><i class="bh" style="width:66%"></i><i class="bd" style="width:22%"></i><i class="ba" style="width:12%"></i></div>' +
        '<div class="scv3-pcts"><span><b>66%</b></span><span class="mid">X 22%</span><span><b>12%</b></span></div>' +
        '<div class="scv3-xg"><span>' + esc(T('sc3_xg')) + '</span><b>1.33 \u2013 1.06</b></div>' +
        '<div class="scv3-xg" style="border-top:1px solid rgba(255,255,255,.06);margin-top:8px;padding-top:10px"><span style="letter-spacing:.08em;font-weight:800;color:#e05252">\ud83e\udd4a ' + esc(T('st4_combat')) + '</span><b style="font-weight:700">Gamrot 23% \u00b7 Salkilld 77% \u00b7 ' + esc(T('st4_ko')) + '</b></div>' +
        '<div class="sc-foot"><span>' + esc(T('sc3_foot')) + '</span></div>' +
        '</div>' +
        '<div class="sc-float"><span class="n">40</span><span class="l">' + esc(T('scf_leagues_v4')) + '</span></div>';
      return;
    }
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

  function renderTrust4(d) {
    var rec = (d && d.record && d.record.total >= 20) ? d.record : { total: 104, winners: 69 };
    var users = roundUsers((d && d.users) || 942);
    var nL = (d && d.clubs && d.clubs.leagues_count) || 40;
    $('#herotrust').innerHTML = '<div class="av"><i></i><i></i><i></i></div><span><b>' + users + '</b> ' + esc(T('ht_users')) + '</span><span class="dot"></span><span>' + esc(T('ht_verified')) + '</span>';
    $('#trust').innerHTML =
      '<div class="tr big"><b>' + Math.round(rec.winners / rec.total * 100) + '%</b><span>' + esc(T('tr_rec_v3')) + ' (' + rec.winners + '/' + rec.total + ')</span></div>' +
      '<div class="tr"><b class="g">' + nL + '</b><span>' + esc(T('tr_leagues_v3')) + '</span></div>' +
      '<div class="tr"><b>\u26bd\u00b7\ud83e\udd4a</b><span>' + esc(T('tr_sports_v4')) + '</span></div>' +
      '<div class="tr"><b>40+</b><span>' + esc(T('tr_books')) + '</span></div>' +
      '<div class="tr"><b class="g">' + esc(T('tr_live')) + '</b><span>' + esc(T('tr_live_s')) + '</span></div>';
  }
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
        // v4: el chip de idiomas cede su lugar al de DEPORTES (la noticia es el multideporte)
        (V4 ? '<div class="tr"><b>⚽·🥊</b><span>' + esc(T('tr_sports_v4')) + '</span></div>' : '') +
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
    // v4: el cuadro de picks es ESTÁTICO (carga a la primera, no depende del teaser). Tres jugadas REALES
    // del feed de esta semana como escaparate del formato — con candado de registro, sin resultados inventados.
    if (V4 && !/[?&]live=1/.test(location.search)) {
      if (!window.__pl4) {
        window.__pl4 = true;
        var ST4 = [
          { fam: 'SOLID', famK: 'fam_solid', lg: 'suiza', chip: 'Super League \u00b7 SUI', sel: T('st4_pick1'), m: T('st4_pick1m'), odds: '2.36' },
          { fam: 'COMBAT', famK: null, lg: null, chip: 'UFC', sel: T('st4_pick2'), m: T('st4_pick2m'), odds: '1.75' },
          { fam: 'CORNERS', famK: 'fam_corners', lg: 'finlandia', chip: 'Veikkausliiga \u00b7 FIN', sel: T('st4_pick3'), m: T('st4_pick3m'), odds: '1.83' },
        ];
        $('#plays').innerHTML = '<div class="plays">' + ST4.map(function (p) {
          var famLbl = p.famK ? T(p.famK) : '\ud83e\udd4a UFC';
          return '<div class="play ' + (p.fam === 'COMBAT' ? 'f-solid' : famC(p.fam)) + '" data-signup>' +
            '<div class="play-top"><span style="display:inline-flex;align-items:center;gap:8px;min-width:0"><span class="play-fam">' + esc(famLbl) + '</span><span class="play-lg">' + (p.lg ? leagueLogo(p.lg, '') : '') + esc(p.chip) + '</span></span><span class="play-ko">' + esc(T('st4_best')) + ' ' + p.odds + '</span></div>' +
            '<div class="play-m"><b style="font-size:15px">' + esc(p.sel) + '</b></div>' +
            '<div class="play-m" style="opacity:.6;font-size:12px">' + esc(p.m) + '</div>' +
            '<div class="play-lock"><span class="lk">\ud83d\udd12</span><span class="lt">' + esc(T('play_lock')) + '</span></div>' +
            '</div>';
        }).join('') + '</div>';
      }
      return renderTrust4(d);
    }
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
  // ===== GOOGLE SIGN-IN (25-jul) — entrar sin código por email ==============================================
  // Gateado por window.__GCID (lo inyecta el server desde GOOGLE_CLIENT_ID). Sin client id NO se carga el
  // script de Google ni se dibuja nada: la landing queda byte-idéntica a hoy. Usamos el botón oficial de
  // Google (política de marca) en variante filled_black + pill, que es la que encaja con el tema oscuro.
  var GCID = (typeof window !== 'undefined' && window.__GCID) || '';
  var gsiLoading = false;
  function loadGsi(cb) {
    if (!GCID) return;
    if (window.google && window.google.accounts && window.google.accounts.id) return cb();
    if (gsiLoading) return; gsiLoading = true;
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = function () { gsiLoading = false; cb(); };
    s.onerror = function () { gsiLoading = false; }; // si Google no carga, el email sigue funcionando
    document.head.appendChild(s);
  }
  function onGoogleCredential(resp) {
    var msg = $('#aMsg');
    if (!resp || !resp.credential) return;
    if (msg) { msg.className = 'm-msg'; msg.textContent = T('a_g_wait'); }
    var ref; try { ref = localStorage.getItem('wc_ref') || undefined; } catch (e) {}
    fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: resp.credential, ref: ref }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.token) { if (msg) { msg.className = 'm-msg err'; msg.textContent = res.j.error || T('e_net'); } return; }
        try { localStorage.setItem('wc_token', res.j.token); document.cookie = 'wc_token=' + res.j.token + ';path=/;max-age=31536000;SameSite=Lax'; } catch (e) {}
        renderAuthSuccess();
        setTimeout(function () { location.href = '/'; }, 1100);
      })
      .catch(function () { if (msg) { msg.className = 'm-msg err'; msg.textContent = T('e_net'); } });
  }
  function mountGoogleBtn() {
    var host = $('#aGoogle'); if (!host || !GCID) return;
    loadGsi(function () {
      try {
        window.google.accounts.id.initialize({ client_id: GCID, callback: onGoogleCredential, ux_mode: 'popup' });
        // Ancho RESPONSIVE: el iframe de Google no respeta max-width del contenedor — un width fijo de 360
        // desbordaba la card en móviles chicos y corría el campo de email fuera de pantalla.
        var gw = Math.max(200, Math.min(360, (host.parentElement && host.parentElement.clientWidth) || 360));
        window.google.accounts.id.renderButton(host, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', width: gw, locale: lang === 'en' ? 'en' : 'es' });
      } catch (e) { /* el email sigue siendo el camino principal */ }
    });
  }
  function renderAuthEmail() {
    $('#authStep').innerHTML =
      '<div class="modal-eye"><i></i>' + esc(T('a_eye')) + '</div>' +
      '<h3>' + esc(T('a_h')) + '</h3><p class="m-sub">' + esc(GCID ? T('a_sub_g') : T('a_sub')) + '</p>' +
      (GCID ? '<div class="m-gbox"><div id="aGoogle"></div></div><div class="m-or"><span>' + esc(T('a_or')) + '</span></div>' : '') +
      '<div class="m-field"><label>' + esc(T('a_email_l')) + '</label>' +
      '<input class="m-input" id="aEmail" type="email" inputmode="email" autocomplete="email" placeholder="' + esc(T('a_email_ph')) + '" value="' + esc(authEmail) + '"></div>' +
      '<button class="btn m-btn" id="aSend">' + esc(T('a_send')) + '</button>' +
      '<div class="m-msg" id="aMsg"></div>' +
      '<div class="m-micro">' + esc(T('a_micro')) + '</div>';
    var inp = $('#aEmail');
    $('#aSend').onclick = sendCode;
    inp.onkeydown = function (e) { if (e.key === 'Enter') sendCode(); };
    mountGoogleBtn();
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
  var demoRows = V4 ? [
    { lg: 'brasileirao', team: 'Palmeiras', tag: 'lag', tagK: 'd_lag', val: '+11%' },
    { emoji: '🥊', team: 'UFC · main event', tag: 'lag', tagK: 'd_lag', val: '+9%' },
    { lg: 'ligamx', team: 'América', tag: 'arb', tagK: 'd_arb', val: '+3.2%' },
    { emoji: '🥊', team: 'Boxeo · título mundial', tag: 'lag', tagK: 'd_lag', val: '+7%' }
  ] : V3 ? [
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
      return '<div class="dr" style="animation-delay:' + (i * 90 + 60) + 'ms">' + (r.emoji ? '<span class="dfl" style="display:inline-flex;align-items:center;justify-content:center;font-size:15px">' + r.emoji + '</span>' : r.lg ? leagueLogo(r.lg, 'dfl') : flag(r.fl, 'dfl')) +
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
  if (V4 && !/[?&]live=1/.test(location.search)) renderData(null); // v4: TODO estático pintado antes del fetch
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
