# CLAUDE.md — GP Simulador

> Guía para cualquier sesión de Claude Code que continúe este proyecto. Léeme primero.

## Qué es
**GP Simulador** (también "GP Simulador del Mundial") — plataforma web de *sports intelligence / prediction market scanner* para el Mundial 2026. Simula el torneo 10,000 veces (Elo → Poisson → Monte Carlo), compara sus probabilidades contra mercados en vivo (Polymarket/Kalshi) y muestra oportunidades de valor y arbitraje. Captura usuarios por email durante el Mundial para evolucionar a una plataforma de pago post-Mundial.

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
- **Contenido redes:** HTML en `ig-src/` → render a PNG con **Chrome headless** (renderizar de a UNO; el 2º en un script se cuelga) → servidos en `gpsimulador.com/ig/*.png`.
- **🔑 PENDIENTE:** rotar la API key de API-Football (quedó expuesta en chat) y actualizar `API_FOOTBALL_KEY` en Render.
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
- **Datos en vivo:** ESPN (`site.api.espn.com/.../fifa.world/scoreboard`) para marcadores; Polymarket gamma + Kalshi para mercados.
- **Datos contextuales (Fase 4):** API-Football (principal) → ESPN (fallback) → manual (`data/manual/*.json`). Capa **server-side** en `data-providers/` (providers + cache + normalizer); la UI solo consume JSON normalizado vía `/api/match/:id` y `/api/teamdetail/:id`. **API key NUNCA en el frontend** — env `API_FOOTBALL_KEY` (alias aceptado: `VITE_API_FOOTBALL_KEY`). Opcionales: `API_FOOTBALL_HOST` (default `v3.football.api-sports.io`; usar `api-football-v1.p.rapidapi.com` para RapidAPI), `API_FOOTBALL_LEAGUE` (1), `API_FOOTBALL_SEASON` (2026). Sin key, todo cae a ESPN/manual/modelo sin romper.

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
