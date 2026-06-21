# TODO_NEXT.md — GP Simulador

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

## ⏭️ PRÓXIMOS PASOS (en orden, para la siguiente sesión)
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
