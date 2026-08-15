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
- **LLM (Anthropic):** `llm.js` es la única puerta. El presupuesto diario se DERIVA del saldo restante
  (`GP_LLM_BALANCE_USD` / `GP_LLM_BALANCE_AT`) dividido por `GP_LLM_HORIZON_DAYS` → caída geométrica, nunca
  se apaga solo. `GP_LLM_CHAT_RESERVE` (35%) es intocable para el chat: los jobs de fondo cortan antes.
  Recargar = actualizar las dos vars de saldo **y disparar un deploy** (cambiar env por API no basta).
  Estado: `/api/internal/llm?key=$GP_EXPORT_KEY`.
- **Baloncesto (4º deporte, admin-only):** `basketball-engine/` (possessions, ratings, simulate, store,
  markets) + `data-providers/basketball/espn.js`. Rutas `/api/hoops/*`. Picks APAGADAS: el modelo no bate
  al cierre (skill −0.0079 fuera de muestra en WNBA). Value/arbitraje/caídas/middles sí se publican porque
  salen de precios entre casas, no del modelo.
- **Datos en vivo:** ESPN (`site.api.espn.com/.../fifa.world/scoreboard`) para marcadores; Polymarket gamma + Kalshi para mercados.
- **Datos contextuales (Fase 4):** API-Football (principal) → ESPN (fallback) → manual (`data/manual/*.json`). Capa **server-side** en `data-providers/` (providers + cache + normalizer); la UI solo consume JSON normalizado vía `/api/match/:id` y `/api/teamdetail/:id`. **API key NUNCA en el frontend** — env `API_FOOTBALL_KEY` (alias aceptado: `VITE_API_FOOTBALL_KEY`). Opcionales: `API_FOOTBALL_HOST` (default `v3.football.api-sports.io`; usar `api-football-v1.p.rapidapi.com` para RapidAPI), `API_FOOTBALL_LEAGUE` (1), `API_FOOTBALL_SEASON` (2026). Sin key, todo cae a ESPN/manual/modelo sin romper.

## Comandos
```bash
# correr local
node server.js                 # http://localhost:3000  (usa db.json local)
SIMS=20000 node server.js      # más precisión de simulación

# verificar sintaxis (NO hay lint/test formal en el repo)
node --check server.js && node --check engine.js && node --check public/app.js

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

## Documentos hermanos
- `PROJECT_STATE.md` — arquitectura, pantallas, archivos, endpoints, modelo, negocio.
- `DESIGN_SYSTEM.md` — tokens, tipografía, componentes, layout, responsive.
- `TODO_NEXT.md` — pendientes, bugs/riesgos, próximos pasos.
