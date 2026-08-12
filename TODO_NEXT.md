# TODO_NEXT.md — GP Simulador

## 🚨 INCIDENTE 12-ago — SOLID (1X2) y CARDS sin nacer (diagnóstico completo, fix en código)
Reporte de Alexis: "sacaste la familia de 1x2 y la de cards under". NO fue un cambio de código — dos fallas operativas:
1. **Postgres ahogado** → la query 1X2/goles del build de picks de clubes moría por statement timeout (15s) en
   silencio (`catch → []`) desde el ~5-ago (alta de las 9 ligas): `sportsbook_goal_quote_current` sin poda con
   ~46k upserts/40min. Resultado: **ninguna SOLID ni GOALS de clubes creada desde el 3-ago** (córners/cards
   sobrevivían por su query propia — fix del 5-ago). Fix en código: query por lotes + filtro 24h + error visible
   (`market-scanner/quotes.js`) y retención `goal_current` (7 días) cableada con flags + endpoint
   `/api/internal/goal-retention?key=<GP_EXPORT_KEY>`.
   **Purga ACTIVADA 12-ago** (`SPORTSBOOK_RETENTION_ENABLED=true`, `DRY_RUN=false` en Render). Medido:
   la tabla tenía **14.67M filas / 6.6GB**. El primer intento murió por el mismo timeout global (seq scan
   sin índice) → fix: índice por `observed_at` (IF NOT EXISTS) + cada lote en SU transacción con
   `SET LOCAL statement_timeout` amplio (el global de 15s sigue protegiendo al resto de la app).
2. **The Odds API sin créditos**: de 11.410 (10-ago) a ~575 (12-ago 09:36); con reserva 2000/6000 los sweeps
   estaban PAUSADOS → sin cuotas frescas no nace ninguna familia. **Decisión Alexis 12-ago: upgrade del plan
   mañana; mientras, correr con el remanente.** Aplicado en Render: `SPORTSBOOK_QUOTA_RESERVE=50` (props frena
   a 3×=150), `GP_CLUBS_PROPS_WINDOW_H=48`, `GP_CLUBS_SWEEP_MIN=120`. ⚠️ TRAS EL UPGRADE: borrar
   `SPORTSBOOK_QUOTA_RESERVE`, `GP_CLUBS_PROPS_WINDOW_H` y `GP_CLUBS_SWEEP_MIN` para volver a los defaults
   (reserva 2000/6000, ventana 144h, cadencia 30min). Nuevo WATCHDOG horario: si los créditos caen bajo la
   reserva o hay partidos en <24h con cero mercados 1X2 en el build → email al admin (dedup 1/día).
   Nota: `cardsValidation` está SANA (p=0.121, no failed). El stop-loss del feed público SÍ tiene frenadas
   `SOLID|anchor` (hit 37% vs BE 56%), `SOLID|lead` (20% vs 23%) y `CORNERS|under` — eso es por diseño (autopsias).

## ✅ CHECKPOINT jun-20-2026 — TODO desplegado en prod (main, ~389 usuarios)
Hecho esta sesión (ver memoria `gp-simulador-mundial.md` para detalle):
- Fase 4 completa + **GLOBAL TERMINAL POLISH** (dark terminal premium).
- **API-Football Pro ACTIVO** (env `API_FOOTBALL_KEY` en Render; resolución de fixture/equipos por lista oficial de fixtures).
- **Calibración** del 1X2 (atenuación λ=0.15, Brier 0.669→~0.62). Modelo v2 EN ESPERA (muestra chica; post-Mundial).
- Intervalos rápidos (ESPN 30s, mercados 60s). Auto-refresco de página de partido en vivo.
- **Alertas de gol + inicio** por email (no solo final). GP Take usa lesiones (Opción C).
- **Telegram ACTIVO** (canal @gpsimulador; auto-publica diario/oportunidades/finales; envs `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHANNEL`).
- **Referidos** (niveles Embajador, sin promesa de pago) + **email masivo** `/api/admin/broadcast`.
- **Buscador de equipos**, **Partidos** con EN VIVO/PRÓXIMOS arriba, **Sandbox "Simula cualquier cruce"** (`/api/h2h`).
- Login robusto (sin candado en Oportunidades) + **cache-busting** (`?v=mtime`) + botón "Entrar" + inputs 16px.
- Pipeline de contenido (PNGs en `/ig/`, render Chrome headless de a uno). Investigación de mercado hecha.

## 🧠 v2 PILOTO — "GP Intelligence" (jun-21, SOLO en el sandbox "Simula cualquier cruce")
Prueba de cómo se vería la v2 desplegada a futuro, **contenida al sandbox** (no toca el resto de la plataforma: seguimos sin desplegar v2 global hasta tener más muestra para calibrar).
- **Backend**: `engine.js` → `simulateH2H(eloA,eloB,N)` (Monte Carlo dedicado del cruce: distribución de marcadores, over/under 2.5, BTTS, goles totales, margen). Nuevo módulo `data-providers/gpIntelligence.js` (`contextSignals` → Δ Elo acotado a ±55 = ELO_NOISE, desde forma/racha/bajas/solidez reales; `buildH2HAnalysis` → análisis determinístico). Endpoint `/api/h2h/deep?a=&b=` (login req.): base `matchProbs` (prior) → `getTeamContext` de ambos → Δ contexto por lado → v2 = `matchProbs(elo+Δ)` → Monte Carlo v2 → análisis. Caché en memoria 10 min por par. `/api/h2h` viejo intacto.
- **Frontend** (`app.js` `simulate()`): el resultado del sandbox **ya es v2** (headline con Δ Elo por contexto + descomposición "base → GP Intelligence"). Botón **"🧠 Ver análisis GP Intelligence"** despliega panel integral (mismo lenguaje `dpanel` que la página de partido): Veredicto, Cómo se construye (barras base vs v2 + Δ trazables), Factores que pesan (forma/racha/bajas/solidez con ↑/↓ y peso Elo), Monte Carlo 10.000 (distribución de marcadores + over/btts/goles/margen), Lectura táctica (style+fortalezas/riesgos), Factores X + Qué cambiaría. CSS `gpi-*` en `style.css`.
- **Principio clave**: cada punto de Elo movido es **trazable a una señal mostrada** (no caja negra, no texto genérico tipo ChatGPT). Determinístico, sin IA externa.
- **UPGRADE jun-21 (marco de analista pro)**: tras feedback del usuario (un buen análisis toma en cuenta TODO). (1) **xG ESPECÍFICO POR EQUIPO**: `engine.probsFromLambdas`/`lambdas` exportados; `gpIntelligence.adjustedLambdas` combina el xG-Elo con perfil ataque/defensa real (forma, β=0.40) → resuelve el "marcador máximo 2-0" (ahora proyecta 3-0/4-0 cuando corresponde). (2) **Mercados de goles/totales** (panel "Goles y totales"): Over/Under 1.5/2.5/3.5, total más probable, **distribución de goles por equipo** (0/1/2/3+), BTTS — accionable para apostadores. (3) **Bajas ponderadas por jugador clave** (cruza `keyPlayers`×`injuries`: clave=-15, normal=-7, duda=-3/-6). (4) **Calidad de plantilla** (`providers.getSquadRating` = rating medio del XI más usado, temporada, vía `getTeamPlayers`). (5) **Descanso/carga** (`restDaysFromResults` desde fechas de resultados). (6) Monte Carlo etiquetado "contexto integrado" (siempre usó Elo+Δ). (7) TTLs endurecidos para Mundial: forma 16h→2h, lesiones 40min→20min. Verificado en preview con datos reales (FRA-ENG, BRA-QAT: Brasil 58% de 3+ goles). **PENDIENTE: desplegar a prod** (commit hecho; falta Manual Deploy).

## 🟢 SPRINT 4 — Oportunidades ejecutables (capa de producto) — CONSTRUIDO, STOP antes de deploy (jun-21-2026)
Carpeta `exec-opportunities/` + migración 012 + endpoints `server.js` + pestaña "Ejecutables" (`#tab-opex`).
Publicación CONTROLADA (draft→approve→publish→revalidate→expire/withdraw), auditada, **sin auto-publicación**
(`autoPublicationBlocked=true` siempre). Calculadora server-side (no guarda capital), deep links versionados
(allowlist+HTTPS), jurisdicción informativa (selector manual de país), redacción por lista blanca.
- **Flags** (todos default false): `EXEC_OPPORTUNITIES_{UI,ADMIN_PREVIEW,PUBLIC,MANUAL_PUBLICATION,CALCULATOR,DEEP_LINKS,GEO_FILTER}_ENABLED` + umbrales `EXEC_PUBLIC_*` (conservadores). Con todo off → app idéntica, sin rutas nuevas.
- **Tests verdes**: `test:exec` 65, `test:optimizer` 6, `test:exec-db` 23 (embedded-postgres). 0 regresiones. UI verificada en preview móvil (0 errores consola).
- **Docs**: `docs/sprint-4-*.md` (10). **NO desplegado, NO commit, NO push.**
- **Pendiente del usuario para producción**: (1) activar Sprint 2 y luego Sprint 3 en Render (siguen apagados) para que el motor tenga candidatos reales; (2) aprobar deploy de Sprint 4; (3) subir flags por fase: inerte→admin preview→publicaciones internas→beta→público. Público SOLO tras ≥24h shadow + 0 falsos Pure Arb materiales.

## ⏭️ PRÓXIMOS PASOS (en orden, para la siguiente sesión)
0. 🔌 **Activar Sprint 2 (Canonical Graph) y luego Sprint 3 (motor)** en Render — prerequisito para datos reales de arbitraje que Sprint 4 publicaría. Sprint 1 ya está activo (Postgres creado jun-21).
1. 🔑 **ROTAR la API key de API-Football** (quedó expuesta en chat) → regenerar en api-sports.io + actualizar `API_FOOTBALL_KEY` en Render.
2. **Monetización: afiliados RevShare** (monetiza usuarios gratis ya, financia crecimiento; encaja con sitio de contenido/comparación) + **test de disposición a pagar** (la de LATAM NO está probada).
3. **Expansión multideporte** (existencial post-Mundial — sin esto somos "novedad del Mundial"). NFL en septiembre.
4. Opcional: backup automático diario de `db.json` al email admin; share-imagen del sandbox; props/córners; automatizar el contenido diario; Modelo v2 (señales de contexto) con más muestra.

---
(Histórico) Checkpoint tras Fase 5 del rediseño.

## Rediseño UI — estado por fase
- ✅ **Fase 1** AppShell premium (header, market tape, bottom nav, avatar menu, logged-out).
- ✅ **Fase 2** Home Oportunidades terminal (mejor oportunidad, arbitraje, valor, GP Take, favoritos).
- ✅ **Fase 3** Alertas (pantalla dedicada) + Seguidos rediseñado.
- ✅ **Fase 5** Grupos (heatmap), Bracket (escalonado), Aciertos (analítico+Brier), Evolución (chart dark+tabla).
- ✅ **Fase 4** Páginas profundas de PARTIDO y EQUIPO + capa de datos modular (API-Football principal → ESPN → manual, providers+cache+normalizer server-side en `data-providers/`). Endpoints `/api/match/:id` y `/api/teamdetail/:id` (data normalizada). Navegación desde Partidos/Equipos/Grupos/Bracket/Seguidos/Oportunidades. GP Take determinístico, ángulos de mercado, alineaciones, forma, eventos/stats, lesiones, noticias, mercados, con fallbacks elegantes. **Falta por completar (no bloqueante):** poner `API_FOOTBALL_KEY` en Render para activar la fuente principal; llenar `data/manual/*.json` (jugadores clave, XI, lesiones, notas) para más equipos. Pendiente real: **GLOBAL TERMINAL POLISH PASS** (rediseño visual final de estas vistas).

## PRÓXIMO GRANDE: Fase 4 + Datos de equipo (la construcción que falta de la lista original del usuario)
La Fase 4 depende de construir primero la **feature de datos de equipo** (no existe aún):
- **Página de partido pro**: Match Hero, tabs (GP Take / Análisis / Eventos / Cuotas / Alineaciones), GP Take card de analista, "mejores ángulos", eventos en vivo (posesión/tiros/corners), **alineaciones** (XI probable), forma reciente, best odds.
- **Página de equipo pro**: hero con seguir, tabs (Resumen / Plantilla / Forma / Resultados / Noticias / Mercados). Reemplazar el párrafo largo actual de `openTeam` por "Model read" + bullets (key drivers, risks, next checkpoint).
- **Fuente de datos investigada:** API-Football (api-sports.io) tiene alineaciones/plantilla/forma; tier gratis limitado (~100 req/día, solo testing). xG real es de pago (Sportmonks ~€78/mo, TheStatsAPI). The Odds API = cuotas multideporte 1 suscripción. Decisión pendiente del usuario sobre gastar en data (recomendado: no gastar hasta empezar a cobrar; validar Brier vs mercado primero).
- Alineaciones gratis alternativa: extraer el XI que publican ~1h antes (scraping/feed) y cachear; mostrar al hacer click en el partido.

## Mejoras de modelo / datos (de sesiones previas)
- **Marcador "Modelo vs Mercado"**: ya instrumentado (`scoreboard` en /api/aciertos, captura closing line por partido en `db.marketSnapshots`). Empezó tarde → necesita ~3-4 semanas de partidos para veredicto de si le ganamos al mercado. NO cobrar hasta tener esta prueba.
- **Calibración de torneo (% campeón) sobreconcentrada**: decisión actual = NO tocar (no validable este torneo, n=1; usuario no quiere copiar a Opta). Si se retoma: subir `ELO_NOISE` (~120-150) y/o regresión a la media; medir contra Brier, no contra Opta.
- **Señales gratis para el modelo** (de las 5 propuestas): forma ya está implícita en Elo; descanso/motivación marginales; xG e injuries son de pago. Recomendación: no agregar señales marginales sin que mejoren el Brier medido.

## Crecimiento / negocio (pendientes)
- Persistencia/backup de la base de usuarios: el disco de Render ya evita pérdidas, pero falta export diario automático al email del admin como seguro.
- Telegram bot de alertas (canal): alto valor para esta audiencia, no construido (UI dice "próximamente").
- Canales Telegram/Push: backend no implementado (solo UI/estado preparado en alertPrefs.channels).
- Pantalla de "lista de espera Pro" / pricing hacia fin de Mundial para validar disposición a pagar.
- Segundo deporte (NFL en septiembre) para el "precipicio post-Mundial".
- Contenido de redes: hay plantillas en `public/ig/` + `ig-src/`; generar diario (post/story/X) con datos reales del día. Captions y tono "transparencia" definidos.

## Bugs conocidos / riesgos
- **Cuota de email**: Resend Pro 50k/mes (suficiente). Si se rompe, fallback a relay GAS (~100/día). Vigilar en olas de registro.
- **db.json efímero si falla el disco**: usuarios/favoritos se perderían (resultados se auto-recuperan de ESPN). Mitigación: export CSV manual frecuente; pendiente backup automático.
- **Autodeploy de Render a veces no dispara** → forzar por API (ver CLAUDE.md). Primer request tras deploy puede dar 502 unos segundos.
- **SSE no atraviesa algunos proxies** → ya hay fallback a polling cada 10s.
- **`matchProbs` aplica Dixon-Coles pero el Monte Carlo (simMatch) no** — inconsistencia menor conocida; el % de campeón usa solo el piso de goles, no DC.
- **Página Partidos y modal de equipo** siguen con diseño/copys viejos (texto largo) → Fase 4.
- Al desarrollar: `rm -f db.json` SOLO en local; jamás en prod. Probar en preview antes de push.

## Reglas de producto a recordar (ver CLAUDE.md)
- Nombre = "GP Simulador" (nunca GP Edge).
- No recomendar longshots (<30% prob) ni apostar contra el favorito del modelo.
- Login obligatorio salvo teaser top-6.
- Español, mobile-first, sin consejo financiero.
