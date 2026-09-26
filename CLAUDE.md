# CLAUDE.md — GP Simulador

> Guía para cualquier sesión de Claude Code que continúe este proyecto. Léeme primero.

## Qué es
**GP Simulador** (también "GP Simulador del Mundial") — plataforma web de *sports intelligence / prediction market scanner* para el Mundial 2026. Simula el torneo 10,000 veces (Elo → Poisson → Monte Carlo), compara sus probabilidades contra mercados en vivo (Polymarket/Kalshi) y muestra oportunidades de valor y arbitraje. Captura usuarios por email durante el Mundial para evolucionar a una plataforma de pago post-Mundial.

## ✅ EL PLAN DE RENTABILIDAD ESTÁ EJECUTADO ENTERO (16-sep-2026, noche)
Las seis fases (A→F) del plan están hechas. El resultado, en una línea: **de los cuatro candidatos a
dinero, tres se cerraron con medición y el cuarto sigue esperando muestra.** Ninguno se cayó por falta de
trabajo; se cayeron porque al medirlos no estaban.

| candidato | veredicto | dónde está medido |
|---|---|---|
| **C1** Polymarket `fútbol·No` | **no pasa G1** — t 0,49, IC del ROI [−15,6 · +26,4] % | `docs/POLYMARKET_FUTBOL_NO_2026-09.md` |
| **C2** HTFT / 2T condicional | **cerrado** — el precio YA lleva la condicionalidad del descanso | `docs/HTFT_CIERRE_2026-09-16.md` |
| **C3** córners v2 | **cerrado** — margen 3,95-4,50 %/lado | `docs/MARGEN_CLOUDBET_2026-09-16.md` |
| **C5** Underdog props | **retirada** — la tabla de pagos no se puede verificar | `docs/CONTRATOS_CASA.md § Underdog` |
| **C4** tarjetas `cards_under_v2` | esperando muestra · punto de decisión ≈ **20-oct** | sin cambios |

**Y el encogimiento (M1) dice que el modelo no aporta nada por encima del precio en ninguna familia
medible**: `c` mediano = 0, y las tres familias con `c` > 0 tienen el intervalo pegado al cero
(`docs/ENCOGIMIENTO_2026-09-16.md`). La doble corrida de 14 días está congelada y corriendo **en sombra**:
por orden de Alexis del 16-sep, **el feed sigue publicando con la probabilidad cruda**. La decisión de qué
publicar a los 14 días es suya y está planteada con sus tres caminos en ese documento.

**Ninguna familia pasa de G0.** Las cinco puertas están en código (`lib/puertas.js`), las cuatro que
faltaban implementadas el 16-sep. El registro de decisiones vive en `docs/DECISIONES_EJECUTADAS.md`.

Plan original, con las decisiones M1-M11 y R1-R5: `docs/PLAN_RENTABILIDAD_2026-09-16.md`

## 🎯 EL PLAN QUE MANDABA (16-sep-2026) — `docs/PLAN_RENTABILIDAD_2026-09-16.md`
Alexis ordenó el 16-sep: "toma las decisiones tú mismo, incluidas las de modelo; el objetivo es
rentabilidad". Las decisiones **ya están tomadas** en ese documento (M1-M11 modelo, R1-R5 dinero) y **no se
reabren**: se ejecutan en el orden de sus fases A→F. Los únicos candidatos a dinero son cuatro (Polymarket
`fútbol·No`, HTFT/2T condicional, córners v2, tarjetas v2); todo lo demás es control y no recibe ingeniería
de modelo. La regla del dinero del 13-sep sigue intacta: nada pasa a real sin cruzar G2.
Diagnóstico que lo ordena: `docs/CALIBRACION_2026-09-16.md` — el modelo se pasa 6-16 pp donde el precio
acierta a 0-4, en nueve de doce motores.

## 🔬 LA AUDITORÍA EXTERNA (15-sep-2026) — LO PRIMERO DESPUÉS DE LA REGLA DEL DINERO
Una auditoría independiente revisó los modelos, los precios y la evidencia. Está íntegra en
`docs/AUDITORIA_EXTERNA_2026-09-15.md`, el plan de ejecución en `docs/PLAN_TRABAJO_AUDITORIA_2026-09-15.md` y
el resultado en `docs/METRICAS_RECALCULADAS_2026-09.md`. Tres cosas que cambian cómo se decide aquí:

1. **LA VARA ANTERIOR ESTABA MAL.** Restar el margen por lado a la media del CLV no es el retorno esperado de
   nada: con cierre 1,905/1,905 y entrada a 1,97 daba +0,925 % y el EV real es −1,50 %. Podía aprobar
   familias con esperanza negativa. Ahora manda `lib/ev.js`: EV ticket a ticket contra la probabilidad SIN
   MARGEN del cierre, agregado con incertidumbre por RACIMOS DE EVENTO (`lib/inferencia.js`). El CLV queda
   como diagnóstico de movimiento de línea, nunca como veredicto.
2. **CON LA VARA NUEVA NO HAY NINGUNA FAMILIA INVERTIBLE.** Cero. Diez piden cierre. Familias con CLV
   positivo y significativo tienen EV negativo. Si alguien propone meter dinero, la respuesta está medida.
3. **UN PRECIO ES UNA TUPLA.** Selección, línea y cuota viajan juntas (`lib/contrato.js`). Valorar la línea
   del consenso con el precio de otra infla la ventaja siempre en la misma dirección.

Y dos reglas de método que la auditoría dejó por escrito: un resultado que no se encuentra NO es una
devolución (`DATA_UNRESOLVED`, nunca VOID), y 100 apuestas son un control operativo de riesgo, no una
certificación estadística — a cuota 1,91 el intervalo del ROI con 100 apuestas mide 19 puntos de ancho.

## 🛑 LA REGLA DEL DINERO (13-sep-2026) — LA PRIMERA QUE HAY QUE LEER
**NO SE METE MÁS DINERO EN NINGÚN SITIO** hasta que una familia cruce el listón escrito en
`real-executor/parada.js`. Decisión de Alexis del 13-sep tras tres días de auditoría. No la re-propongas:
hoy **no hay una sola familia en todo el sistema de la que se pueda decir con seguridad "mete dinero ahí"**,
y eso está medido, no opinado (HANDOFF §📊).

**Dónde hay dinero de verdad (16-sep, noche): EN NINGÚN SITIO.** Los tres canales reales están apagados —
tarjetas desde el 13-sep con los fondos fuera, CS2 retirado (R2) y **tenis de mesa apagado el 16-sep (R1)**,
que cerró en **tablas exactas**: 60 liquidadas, 300 USDT apostados, 33-27, P&L 0,00. `GP_REAL_ENABLED` sigue
en `true` a propósito: es la llave maestra del ejecutor, no de un canal, y mantiene viva la conciliación.
**CS2 en Pinnacle NO tiene dinero** (`cs2_real: "pausado"`). **Polymarket TAMPOCO** (banco simulado 2.000).
Todo lo demás es papel. Si alguien pide "sacar el dinero de CS2 o de Polymarket", no hay nada que sacar.

**El listón, en una línea:** una familia es invertible cuando le gana al precio DESPUÉS de descontar lo que
cobra la casa, con muestra suficiente. Ni el ROI ni el CLV a secas valen — ver `lib/vara.js`.

**Punto de decisión ≈ 20-oct** (100 liquidadas del núcleo limpio, a 18,7/semana). Antes no hay nada que decidir.

## REGLAS DURAS (no romper)
- **El nombre del producto es "GP Simulador". NUNCA "GP Edge" / "GP Markets" / "EDGE Terminal".** (Los mockups decían "GP EDGE" — ignorar; el usuario lo prohibió explícitamente.) Etiquetas internas SÍ permitidas: Model Edge, GP Take, Pure Arb, Market Mover, Oportunidades, Arbitraje puro.
- **No romper la lógica del modelo, APIs, Monte Carlo, Elo, Polymarket, Kalshi ni rutas existentes** salvo que sea estrictamente necesario.
- **No perder datos ni usuarios.** La base vive en disco persistente de Render (`/data/db.json`). Hay ~340 usuarios reales. Nunca borrar `db.json` en producción.
- **Plataforma EN VIVO durante el Mundial.** Probar siempre en preview antes de desplegar. Render no promueve un deploy que falla el health check, pero igual: cuidado.
- Producto en **español** (audiencia LATAM). Mobile-first, escala a desktop.
- Sin consejo financiero: siempre el disclaimer "estimaciones de un modelo estadístico, no consejo financiero".

## Stack
- **Backend:** Node puro, sin dependencias npm (`server.js`, `engine.js`, `mailer.js`, `data/tournament.js` + `data/fixtures-real.json`). Node >= 18.
- **Frontend:** vanilla JS (`public/index.html`, `public/app.js`, `public/style.css`). Sin framework, sin build step. SSE para tiempo real con fallback a polling.
- **Persistencia:** `db.json` (un solo archivo). En prod: `DB_FILE=/data/db.json` (disco persistente).
- **Hosting:** Render (plan Starter $7/mes), servicio `srv-d8krl8flk1mc73c9hbi0`, owner `tea-d8krj5v7f7vs73fc7m70`, región Oregon. Dominio: **gpsimulador.com** (Namecheap; A @ → 216.24.57.1, CNAME www → gp-simulador-mundial.onrender.com).
- **Email:** Resend Pro (50k/mes) desde `codigo@gpsimulador.com`; fallback relay Google Apps Script. Vars: `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_WEBHOOK_URL`, `MAIL_WEBHOOK_TOKEN`. Alertas: código de login + resultado final + **inicio de partido + gol** (equipos seguidos). Email masivo de novedades: `/api/admin/broadcast`.
- **Telegram (activo):** `telegram.js` publica al canal **@gpsimulador**. Vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL=@gpsimulador`. Auto-publica resumen diario + oportunidades fuertes + resultados finales (dedup en `db.sentTg`).
- **Cache-busting:** el server inyecta `?v=<mtime>` a `app.js`/`style.css` en `index.html` → cada deploy fuerza recarga del código en todos los navegadores (no más versiones viejas en desktop).
- **Contenido redes:** HTML en `ig-src/` → render a PNG con **Chrome headless** (renderizar de a UNO; el 2º en un
  script se cuelga) → servidos en `gpsimulador.com/ig/*.png`. **El viewport real es ~85-100 px MÁS BAJO que el
  `--window-size`** y todo lo que cae por debajo sale sin pintar (el pie salía en negro): renderizar con la
  ventana más alta y recortar con `scripts/png-crop.js`. Receta:
  ```bash
  CH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
  $CH --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=1200,790 \
      --screenshot=/tmp/r.png ig-src/<pieza>.html          # X 1200x675 → ventana 790
  node scripts/png-crop.js /tmp/r.png 675 public/ig/<pieza>.png
  # story 1080x1920 → --window-size=1080,2020 y recortar a 1920
  ```
- **🔑 PENDIENTE:** rotar la API key de API-Football (quedó expuesta en chat) y actualizar `API_FOOTBALL_KEY` en Render.
- **The Odds API — plan de 5M créditos/mes desde el 21-sep (Alexis pagó; la suscripción anterior caducó el
  19-sep).** OJO: una suscripción nueva da una **clave NUEVA**; la vieja (`f214…`) sigue respondiendo
  `DEACTIVATED_KEY` aunque se haya pagado. Hasta que la clave nueva esté en Render
  (`SPORTSBOOK_PROVIDER_API_KEY`, nunca por chat), TODO lo que depende de The Odds API sigue a oscuras —sombras
  de NFL/college/CFL, baloncesto, tenis, combate, F1, props y cuotas de clubes— y **el dinero real NO se
  entera**: tarjetas corre contra Cloudbet directo. Presupuesto ya puesto para el plan grande:
  `SPORTSBOOK_DAILY_CREDITS=0` (sin tope), `SPORTSBOOK_QUOTA_RESERVE=2000`, `GP_CLUBS_SWEEP_MIN=12`.
  **`lib/odds-gate.js` es la puerta única (19-sep):** envuelve `fetch` y toda llamada a `api.the-odds-api.com`,
  esté en el archivo que esté, pasa por el presupuesto — tope diario `SPORTSBOOK_DAILY_CREDITS` (**16** en
  Render = 500/31), reserva `SPORTSBOOK_QUOTA_RESERVE` (**60**), clave muerta 6 h tras un 401
  `DEACTIVATED_KEY`/`INVALID_KEY`. Lo bloqueado recibe un 429 sintético (`x-odds-gate: <motivo>`) sin salir a
  la red; los endpoints gratis (`/sports`, `/events`) pasan siempre. `SPORTSBOOK_GATE=off` la apaga. Sonda:
  `/api/internal/odds-gate?key=`. Ojo: con 16 créditos/día el barrido de baloncesto (15 créditos por deporte)
  se come el día en una pasada — el plan gratis es supervivencia, no medición. **Cuando Alexis vuelva a pagar:**
  subir `SPORTSBOOK_DAILY_CREDITS` (0 = sin tope), `SPORTSBOOK_QUOTA_RESERVE` a 2000 y `GP_CLUBS_SWEEP_MIN` a 12.
- **LLM (tres proveedores):** `llm.js` es la única puerta, con **cadena de reserva**: chat = Anthropic →
  Gemini → Groq; redactores = Gemini → Groq → Anthropic; extractor = Groq → Gemini → Anthropic. Vars:
  `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`. El presupuesto **solo raciona lo de pago**: se
  DERIVA del saldo restante (`GP_LLM_BALANCE_USD` / `GP_LLM_BALANCE_AT`) dividido por
  `GP_LLM_HORIZON_DAYS` → caída geométrica, nunca se apaga solo. `GP_LLM_CHAT_RESERVE` es intocable para
  el chat. Recargar = actualizar las dos vars de saldo **y disparar un deploy** (cambiar env por API no
  basta). Estado: `/api/internal/llm?key=$GP_EXPORT_KEY`.
  **Ojo con los modelos que razonan:** el techo de salida es *respuesta + pensamiento*, no solo respuesta.
  Nos ha mordido dos veces (Gemini truncando JSON, Groq cortando el extractor a mitad).
- **Verificador de lecturas (`GP_LLM_VERIFY`, on):** ninguna lectura se publica sin comprobar sus números
  contra el dossier. El **código** encuentra los que no casan, el **modelo** —siempre otro distinto del que
  escribió— juzga solo los sospechosos. Escribe → verifica → reescribe una vez → descarta. Un verificador
  caído nunca bloquea la publicación. Contadores en `/api/internal/llm` bajo `verificador`.
- **Observación de prensa (`GP_OBS_DEPORTES`, on):** `observer/deportes.js` lee Google News por sujeto y
  extrae señales tipadas en **fútbol, combate, esports, tenis y fútbol americano** (vocabulario propio por
  deporte en `llm.js`). Tapa el hueco que los modelos tienen por construcción —son ciegos a la plantilla—:
  stand-ins en esports, retiradas de cuadro en tenis, quarterbacks en NFL/College/CFL. **DISPLAY, NUNCA
  MODELO**: se pintan con su cita textual y entran al dossier del redactor marcadas como PRENSA; ninguna
  toca una probabilidad. Estado y forzado: `/api/internal/observer?key=` (POST `&dom=`).
- **Baloncesto (4º deporte, admin-only):** `basketball-engine/` (possessions, ratings, simulate, store,
  markets) + `data-providers/basketball/espn.js`. Rutas `/api/hoops/*`. Picks APAGADAS: el modelo no bate
  al cierre (skill −0.0079 fuera de muestra en WNBA). Value/arbitraje/caídas/middles sí se publican porque
  salen de precios entre casas, no del modelo.
- **NFL (6º deporte, admin-only):** `nfl-engine/` (data point-in-time, simulador conjunto margen/total con
  residuos reales vs cierre 2016-2025, store) + `scripts/nfl-harvest.js` (nflverse) y `scripts/nfl-fit.js`
  (constantes + validación walk-forward → `data/nfl/model-priors.json`). Rutas `/api/nfl/*` tras
  `GP_NFL_PUBLIC_ENABLED` (sin poner = solo admin); probe `/api/internal/nfl?key=`. **TODAS las familias en
  SOMBRA** (el modelo queda a ~0.45 pts del cierre; blueprint NFL-1125) y el moneyline cerrado por doctrina.
  El modelo es market-blind POR CONSTRUCCIÓN: ninguna cuota entra a la probabilidad. Jobs: cuotas+cierres+
  sombra cada 30 min SOLO con partidos a ≤9 días (The Odds API, 1 llamada/pasada). Kickoff: 9-sep-2026.
- **Esports (5º deporte, admin-only):** `esports-engine/` (core + un motor POR JUEGO: `cs2`, `lol`,
  `valorant`, `dota2` + `store`) y `data-providers/esports/cloudbet.js`. Rutas `/api/esports/*` tras
  `GP_ESPORTS_PUBLIC_ENABLED` (sin poner = solo admin). **Los cuatro juegos NO comparten motor**: cada uno
  tiene su lógica (veto en CS2, kills en LoL, ataque/defensa en Valorant, cola de duración en Dota 2).
  Picks SOLO de familias derivadas — el ganador de serie está cerrado por código (`PICK_FAMILIES`).
  **Props de jugador (17-ago, del análisis LCS Larry):** `esports-engine/props.js` + `data-providers/esports/underdog.js`
  proyecta kills en mapas 1-2 (solo CS2, con scoreboard propio) contra líneas de Underdog (libro blando DFS,
  precio por pierna) y anota tesis en SU PROPIA sombra (`props-cs2.json` en disco persistente, dedup por tesis,
  liquidación automática desde los logs propios) — **separada por completo del ejecutor en la sombra de la casa**.
  Barrido cada 2 h + settle en cs2DailyJob. Rutas `/api/esports/{props,propstrack}`, vista "Props" en Esport.
  **Boleto GP:** combinador de piernas en todas las pick cards (cuota combinada, prob GP, EV, ¼ Kelly tope 2 %).
  **Cloudbet no publica resultados** (comprobado): no hay rating propio hasta que entre OpenDota/Riot; lo
  que sí se acumula es el cierre de mercado en `data/esports/`.
  **LoL sí tiene base propia (2-sep):** 97.588 partidas 2020→hoy + 535k filas de jugador, cosechadas de
  Leaguepedia con `scripts/lol-harvest.js --export` (CargoExport, 5.000 filas/llamada; la cadena en Render está
  APAGADA con `GP_LOL_HARVEST=0`). Rating validado walk-forward (`priors.json`), fichas, campeones por parche y
  Draft Room encendidos. Crudo archivado en `/data/lol-raw` (PUT `/api/internal/lolraw`). Derechos: CC BY-SA →
  admin-only, nunca pick pública (`data/esports/lol/RIGHTS.md`).
- **Dardos (9º deporte, 6-sep, admin-only, blueprint 8.0):** `darts-engine/` (`rules.js` reglamento 501 + catálogo de
  formatos, `kernel.js` kernel de visita por dardo con política de cierre resuelta por DP y calibración a
  media/180s/dobles, `compiler.js` carrera del leg exacta + compilador de legs/sets con 180s y checkout
  conjuntos, `data.js` base propia + Elo, `store.js` agenda/mercado/sombra/catálogo) + `data-providers/darts/`
  (`pdc.js` API pública de la PDC: formato POR RONDA certificado y resultados; `orakel.js` Darts Orakel:
  media/180s/dobles por ventana; `books.js` Pinnacle (deporte 10) · Bovada (180s, marcador exacto) ·
  Polymarket · Kalshi · Cloudbet; `flashscore.js` legs en vivo, display). Rutas `/api/darts/*` tras
  `GP_DARTS_PUBLIC_ENABLED` (**público desde el 9-sep**: la env solo sirve para CERRARLO, `=0`; ventana libre
  para todos los planes hasta `GP_DARTS_TT_FREE_UNTIL`, 17-sep, y después free/pro/sharp como los demás; el
  motor y el rendimiento siguen siendo admin por caja negra); sonda `/api/internal/darts?key=` (`&odds=1` refresca y
  enseña las claves crudas de Cloudbet, `&rec=1`, `&settle=1`). Jobs: `dartsJob` cada 10 min (agenda PDC +
  cuotas + sombra + liquidación), `dartsTailJob` diario (cola de la base en proceso aparte;
  `GP_DARTS_TAIL=false` la apaga). **TODAS las familias en SOMBRA**; el ganador es referencia. Modelo
  market-blind por construcción. Base: `data/darts/{matches,orakel}.json.gz` + `players.json` (2023→hoy,
  104k resultados PDC) — la cola en Render escribe en `/data/darts` y conserva el compacto del repo como
  línea de base. Derechos: `data/darts/RIGHTS.md` (sin uso comercial hasta fuente licenciada). Smoke:
  `node scripts/smoke/darts-smoke.js`; validación: `node scripts/darts-fit.js [--write]`.
- **Tenis de mesa (11º deporte, admin-only, 8-sep, blueprint 9.0):** `tt-engine/` (rules, compiler EXACTO punto → game →
  partido con cola de deuce analítica, data con Elo + rating de punto, store) + `data-providers/tt/{wtt,flashscore,books}.js` +
  `scripts/tt-harvest.js` (crudo ITTF/WTT en `/data/tt-raw`, compacto en `data/tt/`) + `scripts/tt-fit.js` (walk-forward →
  `data/tt/model-priors.json`). Rutas `/api/tt/*` tras `GP_TT_PUBLIC_ENABLED` (**público desde el 9-sep**, misma ventana y mismas reservas
  de caja negra que dardos); sonda
  `/api/internal/tt?key=`. TODAS las familias en SOMBRA; ganador = referencia. Solo competiciones WTT/ITTF (VERIFIED_SCOPE):
  las ligas privadas de apuestas (Liga Pro, Setka Cup, TT Cup…) se enseñan con aviso y jamás se modelan. `selfTest()` del
  compilador reproduce la tabla sintética del blueprint a 6 decimales — si se toca el compilador, correrlo. Derechos: `data/tt/RIGHTS.md`.
- **Proceso implícito y transferencias de TT (9-sep):** `implied-engine/` — `uncertainty.js` (unc_pp por muestra +
  veredicto 0,75×unc, SOLO etiqueta), `closes.js` (cubos T−60/−30/−10/−5/−1 contra la MISMA casa), `football.js` /
  `hoops.js` (inversores de precio: 1X2↔total, hándicap↔ganador), `sombra.js` + `run-futbol.js` / `run-hoops.js`
  (familias de PRECIO en sombra propia, regla `implicito_v1`, disco `<dbdir>/implicito/`). Sonda
  `/api/internal/implicito?key=`. **Ninguna de estas piezas cambia qué picks nacen**; las familias congeladas siguen igual.
  Generador de kills de LoL en sombra: `esports-engine/lol-gen.js` (+ `lol-gen-shadow.js`, `scripts/lol-gen-fit.js`,
  `data/esports/lol/gen-priors.json`), sonda `/api/internal/lol-gen?key=`. No toca `lol.js` ni `lol_kills_hcp_v1`.
- **Datos en vivo:** ESPN (`site.api.espn.com/.../fifa.world/scoreboard`) para marcadores; Polymarket gamma + Kalshi para mercados.
- **Datos contextuales (Fase 4):** API-Football (principal) → ESPN (fallback) → manual (`data/manual/*.json`). Capa **server-side** en `data-providers/` (providers + cache + normalizer); la UI solo consume JSON normalizado vía `/api/match/:id` y `/api/teamdetail/:id`. **API key NUNCA en el frontend** — env `API_FOOTBALL_KEY` (alias aceptado: `VITE_API_FOOTBALL_KEY`). Opcionales: `API_FOOTBALL_HOST` (default `v3.football.api-sports.io`; usar `api-football-v1.p.rapidapi.com` para RapidAPI), `API_FOOTBALL_LEAGUE` (1), `API_FOOTBALL_SEASON` (2026). Sin key, todo cae a ESPN/manual/modelo sin romper.

## 📏 LA VARA — cómo se decide si una familia sirve (11-13-sep)
Tres módulos, en este orden. **No juzgues una familia por su ROI ni por su CLV a secas: los dos mienten.**
- **`lib/margen.js`** — el margen de la casa, medido emparejando las DOS caras del mismo mercado **del mismo
  partido** en el archivo de cierres. Si solo hay una cara dice `null`: un margen supuesto haría pasar por
  invertible algo que no lo es.
  **⚠️ LOS NÚMEROS DE ESTA LÍNEA ESTUVIERON MAL DEL 11 AL 16-SEP** y conviene saber por qué, porque el fallo
  es del tipo que más caro sale. La clave del mercado no llevaba el partido, así que todas las filas con la
  misma casa+familia+línea caían en el mismo cubo aunque fueran de partidos distintos, y de cada cara se
  quedaba la de MEJOR cuota: se emparejaba el *over* de un partido con el *under* de otro. Eso no es un
  margen, es un arbitraje imaginario. Se veía: `cs2·bovada·KILLS` informaba **0,00 %** —ninguna casa cobra
  cero— y el 2,21 % de pinnacle salía de **cuatro** mercados. Corregido el 16-sep: **51 de 64 márgenes
  subieron, la mediana del cambio fue +0,89 pp y la mediana de la muestra pasó de 4 a 128 mercados.**
  El margen se RESTA del CLV, así que todo lo decidido con los números viejos miraba a las familias **más
  favorablemente de lo que merecían**.
  Medidos de nuevo (16-sep): pinnacle RONDAS_HANDICAP **3,10 %**/lado (era 2,21) · cloudbet RONDAS_HANDICAP
  **3,92 %** (era 3,13) · bovada KILLS **3,26 %** (era 0,00) · lol bovada KILLS **3,39 %** (era 2,35) ·
  lol cloudbet KILLS_HANDICAP **4,90 %** (era 0,38). **La banda real de casi todo el sistema es 3-5 %/lado.**
  Y el total de goles de fútbol NO cobra 0,69 %: medido partido a partido sobre el libro en vivo de Cloudbet
  cobra **3,09 %/lado** (`scripts/cloudbet-margen-futbol.js`, 48 partidos). Tabla completa de los 14 mercados
  de fútbol en `docs/MARGEN_CLOUDBET_2026-09-16.md`: córners 3,95-4,50 % (**cierra C3**), marcador exacto
  28,91 % — y la excepción barata, el **total de goles de 2ª parte a 2,71 %/lado**, el más barato de los
  catorce y por donde debe entrar C2.
  **Y el recargo de los derivados no es un número, es una escalera por competición** (medido sobre 92
  partidos de 13 ligas): el HT/FT cobra **~9 %** en Premier y Bundesliga, **~22 %** en LaLiga/Serie A/
  Ligue 1/Championship/Eredivisie/Brasileirão/Liga Portugal y **~36 %** en Argentina, Turquía, Bélgica y
  MLS, con centésimas de dispersión dentro de cada peldaño. El 1X2 del partido NO hace escalera (5,03 →
  8,20 % continuo): Cloudbet afina el mercado principal partido a partido y **tarifa los derivados por
  bloques**. Cotejado contra el campo `probability` que publica la propia casa, que suma 1,0000.
  **Y la palabra:** esto es SOBRE-REDONDEO, no comisión. **Cloudbet no cobra comisión ninguna**; el recargo
  solo lo paga quien cruza, y se evita entero no entrando. **Polymarket sí cobra comisión** y es pequeña:
  `acciones × tasa × p × (1−p)`, solo taker, tasa 0,03-0,07 → máximo **1,25 % de lo cruzado** en p = 0,50.
  Lo caro de Polymarket es la horquilla, no la tarifa.
- **`lib/vara.js`** — CLV **recortado al 10 %** (la media cruda la destrozan cierres rotos: hay un +148 % en
  cloudbet), serie por semana, rodante de 100, neto de margen, veredicto y ¼ Kelly. **Y antes de todo eso
  pregunta si el CLV sirve**: `cierreAporta()` compara el error del precio de entrada con el del cierre. En
  NUESTROS mercados el cierre NO predice mejor que la entrada en ninguna familia (|t| < 2 en las diez), y en
  muchas la línea ni se mueve (TT POINTS_TOTAL 78,8 %, dota2 93,8 %). Cuando el CLV no aplica manda
  `modeloContraPrecio()`: ¿acierta más la probabilidad del modelo que la del precio? **Ahí NO se resta
  margen** — el ROI ya está medido contra las cuotas que de verdad pagaron.
- **`real-executor/parada.js`** — las cuatro líneas de parada del dinero real, calculadas con Monte Carlo de
  60.000 corridas (no opinadas). Corre cada hora, manda UN correo al admin la primera vez que cada línea
  cruza, y **NO APAGA NADA**: apagar es decisión de Alexis (`GP_REAL_ENABLED=false`).

- **`goal-engine/mitades.js`** (13-sep) — **el error de calibración de cada familia entra en su listón.**
  Calculable no es calibrada. Antes de abrir un mercado hay que medir cuánto se desvía su probabilidad
  contra resultados reales, y ese error se SUMA al listón base de ventaja: una familia que se desvía 5,8 pp
  no puede cobrar 3 pp, porque esos 3 pp caben enteros dentro de su error. El suelo de ruido del método son
  las familias de control que ya publicamos (3,4 y 2,9 pp). Aplíquese a cualquier familia nueva, de
  cualquier deporte.

Sondas: `/api/internal/vara?key=&bankroll=` · `/api/internal/parada?key=` · `/api/internal/ventana-tarjetas?key=&h=`
· `/api/internal/cercania?key=` · `/api/internal/futbol-derivadas?key=&tabla=1`

## ⚽ MERCADOS DE FÚTBOL: EL CENSO (13-sep)
Cloudbet publica **43 mercados distintos por partido** y leíamos **9**. De los 34 que faltaban se abrieron
**15 en sombra** (`derivadas_v2`): las catorce de mitad —con el reparto del gol medido sobre 33.364 partidos,
cuota del 1T = **0,446**, y **sin Dixon-Coles**, que a media lambda sobrestima el empate 2,6-3,6 pp— más
marcador exacto, portería a cero y ganar a cero, que la matriz ya calculaba y nadie leía. Motor en
`goal-engine/mitades.js` (constante, medición y errores por familia) y `goal-engine/descanso.js` (marcador al
descanso desde ESPN, con doble puerta: nombre resuelto Y las dos mitades tienen que sumar el final conocido).
**Siguen fuera con motivo escrito** (`FUERA` en `futbol-derivadas.js`): momento y orden del gol, goleadores y
las derivadas de córners y tarjetas — medido que los córners local/visita van correlacionados **−0,249** y
las tarjetas **+0,201**, así que dos Poisson independientes no valen para ninguna de las dos.
Interruptores: `GP_DERIV_NUEVAS` (on) · `GP_DERIV_NUEVAS_HORAS` (48).

## 📣 EL FEED PUBLICA SIN VEREDICTO (21-sep-2026, orden de Alexis)
«Los clientes pagan por ver picks»: cuando entren a un deporte tiene que haber picks, sean rentables o no.
`lib/feed.js` · `GP_FEED_SIN_VEREDICTO` (**encendido por defecto**, `0` lo apaga). Con él puesto: las familias
retiradas por veredicto salen como pick con su retirada escrita encima (`sin_veredicto: true`, chip SIN
VEREDICTO en la card), el ganador de dardos y tenis de mesa sale como tesis (en la sombra sigue siendo
`benchmark`), las picks de baloncesto se leen con plan pro/sharp y el ganador de combate ya no se esconde.
**No toca** la sombra, la vara, las puertas de calidad, el fútbol de clubes ni el ejecutor real (test
`tests/feed.test.js`). Registro: `docs/DECISIONES_EJECUTADAS.md` (21-sep, noche).

## 🌍 SELECCIONES ENTRE MUNDIAL Y MUNDIAL (26-sep-2026, orden de Alexis)
Hasta el 26-sep no cubríamos ni un partido de selecciones fuera del Mundial: `LEAGUE_DISCOVERY_SKIP` los salta a
propósito y el motor del Mundial solo conoce su cuadro. Ahora son ligas del motor de clubes:
- **Pool** `selecciones` en `data/clubs/ratings.json` (`pool: true, hidden: true`): un Elo por selección absoluta,
  ids `tm_af<id>`, ajustado con `scripts/selecciones-fit.js` sobre la base `data/selecciones/matches.json`
  (`scripts/selecciones-harvest.js`: partidos jugados 2023→hoy con amarillas, rojas, córners, faltas y árbitro
  desde API-Football). **Nunca subir `_meta.fitted_at`**: borra los overlays dinámicos de todas las ligas.
- **Tres ligas virtuales** en `clubs-engine/cups.js` que copian el pool en un solo nivel: `uefanl` (Nations
  League UEFA, clave The Odds API), `concacafnl` y `amistososel` (solo Cloudbet). Calendario `CLUB_AF_LEAGUE`
  (5, 536, 10), marcadores `CLUB_ESPN` (`uefa.nations`, `concacaf.nations.league`, `fifa.friendly`), alias de
  nombres en `CLUB_ALIAS` (Czechia, FYR Macedonia, Turkey, South Korea, USA, Rep. Of Ireland…).
- **Bandas fijadas a mano** (`LEAGUE_EFF_PRIOR`): `uefanl` eficiente (1X2 y goles anclados al consenso), las
  otras dos intermedia (tarjetas under y córners públicas). **El dinero real está vetado POR LIGA** en
  `real-executor/store.js` (`GP_REAL_LIGAS_VETADAS`, defecto las tres): la sombra `cards_under_v1` las mide y
  la decisión de abrirlas es de Alexis con 60 liquidadas. Los torneos a cancha neutral (Mundial, Euro, Copa
  América) NO se abren aquí: el motor no tiene sede neutral.
- Tarjetas y córners necesitan `props-history-<key>.json` con ≥ 20 partidos en el disco de clubes (los escribe
  el fit; se suben con `/api/internal/clubs-data`). Sin ese fichero no nace ni una pick de tarjetas.
- Test: `node tests/selecciones.test.js`. Registro: `docs/DECISIONES_EJECUTADAS.md` (26-sep).

## 🟣 POLYMARKET EN SOMBRA: DOS LIBROS (24-sep-2026)
`propfirm/scan.js` genera señales (consenso sharp vs precio de Polymarket) y `propfirm/polyshadow.js` las
"coloca" contra el libro real del CLOB en DOS bancos simulados: **v1** (`poly-sombra.json`, congelada como
control; −5,5 % neto en 450) y **v2** (`poly-sombra-v2.json`, regla en `propfirm/v2.js`: Shin en fútbol,
listón NETO ≥ 3 pp, precio 0,40-0,70, entrar a ≤ 2 h del saque, familias que se sostuvieron + tenis, Valorant
y Dota 2 solo en v2). `GP_PROPFIRM_SCAN` enciende el barrido (defecto on); `GP_PROPFIRM_ENABLED=false` solo
apaga el correo de la prop firm. Sonda `/api/internal/propfirm?key=` (`poly_sombra.v2`), export
`picks-export?poly=2`. Ningún dinero real: la puerta es 100 resueltas y t ≥ 2 por deporte.

## ⚖️ DOCTRINA DEL EJECUTOR REAL (lo aprendido a base de perder dinero)
- **Una posición por PARTIDO + LADO, sin la línea** (13-sep). Under 4,5 y under 5,5 del mismo partido no son
  dos apuestas: si hay siete tarjetas pierden las dos. Las sueltas ganan (+3,85 % ROI), las apiladas pierden
  (−17,63 % con dos, −45,83 % con tres). `GP_REAL_UNA_POR_PARTIDO=off` revierte.
- **Esperar no es fallar** (12-sep). Un intento frenado por saldo o exposición no gasta reintento, y el tope
  se estira con las horas que faltan para el saque (`topeReintentos`). Antes se perdían picks vivas con el
  saque a tres días porque el contador de 13 h se agotaba esperando un depósito.
- **El veto de bandas llega tarde** y eso ya costó −453,43 en cuatro ligas (premier, bundesliga, mls, rusia)
  clasificadas como eficientes DESPUÉS de haberlas apostado. Propuesto y sin aprobar: veto por pérdida.

## Comandos
```bash
# correr local
node server.js                 # http://localhost:3000  (usa db.json local)
SIMS=20000 node server.js      # más precisión de simulación

# verificar sintaxis (NO hay lint/test formal en el repo)
node --check server.js && node --check engine.js && node --check public/app.js
node scripts/llm-smoke.js    # firmas de los 10 escritores + el parseador de JSON (sin red, sin coste)

# preview durante desarrollo: usar las tools preview_* del harness (.claude/launch.json -> "worldcup")
```
**No hay build, lint ni test suite.** "Tests" = `node --check` + verificación manual en preview + scripts ad-hoc (p.ej. `backtest.js`, gitignored).

## Deploy (flujo usado en toda la sesión)
```bash
git add <archivos> && git -c user.name="GP" -c user.email="alexisgomezico@gmail.com" commit -m "..."
git push origin main
# forzar deploy (el autodeploy a veces no dispara):
curl -s -X POST "https://api.render.com/v1/services/srv-d8krl8flk1mc73c9hbi0/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" -d '{}'
# pollear estado:
curl -s "https://api.render.com/v1/services/srv-d8krl8flk1mc73c9hbi0/deploys?limit=1" -H "Authorization: Bearer $RENDER_API_KEY"
```
- La **RENDER_API_KEY** la tiene el usuario (se usó en chat; pedirla si hace falta, no está versionada).
- **Cambiar plan vía API da error 500** — hacerlo por el dashboard de Render.
- Repo GitHub: `github.com/alexisandres98/gp-simulador-mundial` (gh CLI autenticado como alexisandres98).
- Headers `no-cache` en html/js/css → los usuarios reciben el código nuevo en cada deploy.

## Co-autoría de commits
Terminar mensajes de commit con: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` (convención usada en la sesión).

## Dinero real: canales
- Tarjetas under (`real-executor/store.js`, perímetro en piedra), CS2 rondas (pausado, `GP_REAL_CS2_ENABLED=false`) y
  **tenis de mesa total de puntos en Cloudbet a $5 planos** (`real-executor/tt.js`, desde el 9-sep por orden de Alexis;
  `GP_REAL_TT_ENABLED`, `GP_REAL_TT_STAKE`; sonda `/api/internal/real-tt?key=`). Todos comparten libro, frenos,
  confirmación y liquidación por referencia.

## Ejecutor en la sombra (paper-trading del edge)
Corriendo desde el 12-ago: bankroll simulado $2,000, segmento `cards_under_v1` (regla congelada), sweep 10min,
**reporte email al admin cada lunes** + revisión semanal con Alexis. Estado: `/api/internal/shadow?key=<GP_EXPORT_KEY>`.
Plan completo y reglas (cómo agregar segmentos, go-live): sección "PLAN EDGE + EJECUTOR EN LA SOMBRA" en TODO_NEXT.md.
**Ejecutor REAL (Cloudbet, `real-executor/`):** desde el 2-sep entra con **stake plano 40** en cards under
(`GP_REAL_STAKE_FLAT=40`, orden de Alexis; sin la var vuelve a Kelly/4 con tope 1,5 %) y 5 en CS2
(`GP_REAL_CS2_STAKE`). Libros completos: `/api/internal/picks-export?key=&shadow=1|real=1`.

**Mejoras de modelo del 2-sep (desplegadas):** informes por familia en `docs/impl/*-REPORT.md`, humos en
`scripts/smoke/*.js` (correr los cinco antes de cualquier deploy que toque tenis, Valorant, baloncesto, fútbol
de clubes o combate). Vars nuevas: `GP_SOLID_C` (default 0: el `lead` del 1X2 no genera picks),
`GP_CUP_TIER_GAP_ELO` (default 150). Preregistros vivos en `docs/PREREGISTRO_*.md`.

## 📌 PENDIENTE FIJO: revisión del domingo 23-ago
El sistema corre **como está** hasta el domingo 23 acumulando datos. Ese día se aplican **cuatro
correcciones ya acordadas y documentadas** al principio de `TODO_NEXT.md`: (1) apagar el mercado de ganador
y poner techo a la ventaja, (2) invertir el criterio — anclarse al consenso y publicar solo la desviación
de una casa, (3) concentrarse en totales y en el mercado principal de ligas menores, (4) props solo en
sombra con el listón real. **No tocar la lógica de decisión antes de esa fecha**: cambiarla a mitad de la
ventana destruye la muestra. Motivo de fondo: el backtest al cierre da −7,27% de ROI en NBA con t = −2,72,
y las picks prometían 56,5% de acierto contra 43,6% real.
**Autopsia del 2-sep (`docs/AUTOPSIA_MODELOS_2026-09-02.md`):** con los libros completos, el Brier del modelo
pierde contra el mercado en todas las familias; el peso que merece el modelo (`c`) es ≤0 salvo en CARDS y
tenis TOTAL. Lo que gana (cs2_rounds_v1, cards_under_v1) gana por precio y momento. Fórmula operativa:
`p* = σ(logit(p_mkt sin margen) + c·[logit(p_gp) − logit(p_mkt)])`, `c` por familia fuera de muestra. Las
decisiones están listadas al principio de `TODO_NEXT.md` y las toma Alexis. Y ojo: **tres liquidadores
mentían** (tenis 0-0, kills sin voltear, totales en cubos de 5) — antes de leer un track, comprobar que el
marcador con el que se liquidó es coherente.

## Documentos hermanos
- `HANDOFF.md` — **punto de retoma**: estado exacto, qué está cerrado, qué está pendiente y por qué.

- `PROJECT_STATE.md` — arquitectura, pantallas, archivos, endpoints, modelo, negocio.
- `DESIGN_SYSTEM.md` — tokens, tipografía, componentes, layout, responsive.
- `TODO_NEXT.md` — pendientes, bugs/riesgos, próximos pasos.
