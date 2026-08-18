# HANDOFF — estado al 18-ago-2026 (los cuatro esports vivos + correcciones del día + caja negra)

## 🕐 18-ago (mediodía) — LA OLA GRANDE DEL DÍA DESPLEGADA (`c3040a0` en main)

**Todo lo pedido por Alexis el 18 está EN PRODUCCIÓN salvo las lentes de fútbol** (commit `804fa80`,
ÚNICO que queda solo en la rama `claude/gpsim-continuation-vrjuww` — se despliega cuando Alexis lo
apruebe mirándolo en preview; el partido de fútbol es el producto público en vivo).

1. **Valorant y Dota 2 completos en código con base real.** Valorant: 33.073 series de vlr.gg
   (holdout 8,0% de skill, AUC 0,66, n=893 — nivel CS2), Elo propio + `valorant-data.js` (Agentes,
   Sala de composición con vetoInput medido, fichas). Dota 2: 49.645 partidas de OpenDota +
   capa estratégica por Explorer SQL (meta 7.41 con 127 héroes, doctrina de 1.826 equipos,
   2.291 jugadores por posición inferida de GPM) + `dota2-data.js` (Héroes, Draft Room con
   doctrina, jugadores KP/KDA/GPM). Los CUATRO juegos con motor propio separado.
2. **Correcciones del 18:** brief diario + Pregúntale a GP + simulador en Esport (4 juegos) y en
   Fútbol americano (3 ligas); los 9 escudos CFL locales en `/logos/cfl_*.png`; Jugadores NFL ya
   no rebota a partidos en College/CFL (muestra el hueco honesto); sonda
   `/api/internal/hoops-brief?key=…&league=wnba` para diagnosticar el brief de baloncesto sin sesión.
3. **REGLA DE CAJA NEGRA aplicada a toda la capa servida** (doctrina nueva, pisa a la vieja
   "auditoría visible"): las APIs y la UI enseñan EVIDENCIA (ventanas de validación, tamaños de
   muestra, métricas fuera de muestra) y NUNCA la receta — ni familias de modelo, ni constantes,
   ni pesos, ni medias-vidas, ni fórmulas. Los internos completos siguen en las sondas con key y
   en los docs del repo. Al tocar pantallas nuevas: no volver a filtrar la receta.
4. **Barrido Playwright de 63 vistas (los 6 deportes, 4 juegos, 3 ligas):** cero errores JS propios,
   cero imágenes rotas locales, cero "undefined/NaN" visibles. Ojo con el arnés: `gp_onboarded`
   va con sufijo de email y hay que esperar ~8 s a que cargue la sesión antes de navegar por hash,
   si no TODO rebota al tablero de fútbol y el barrido mide mentiras.
5. **Cosechas en curso en Render (disco persistente, sobreviven deploys):** Valorant detalles
   moliendo (`/data/val-raw`, 9.780 series pendientes a ritmo robots-friendly — días); LoL SIN
   ventana de Fandom desde las 10:50 (plan B: Drive de Oracle's Elixir mañana, o cuenta bot de
   Fandom de Alexis). Avance: `/api/internal/{valraw,lolraw}?key=$GP_EXPORT_KEY`.

## 🎮 18-ago (tarde) — LoL COMPLETO EN CÓDIGO, LA COSECHA MOLIENDO EN RENDER

**En producción: `75265e6`.** El blueprint 3.0 de LoL (docx de Alexis) construido de punta a punta y
**probado con datos sintéticos en el formato exacto de la cosecha** (generador en scratchpad; los
sintéticos NO se versionan, se borraron). Lo único que falta es la BASE REAL, que se está cosechando
sola en Render. El punto de retoma exacto:

1. **Cosecha (Fase 1) — cadena paciente en Render, `/data/lol-raw` (persistente).** La 1ª pasada enseñó
   que Fandom limita también la IP de Render (cubo: ~6 páginas y ~10 min de bloqueo) y el script se
   rendía dando tablas por terminadas con 0 filas — PEOR que fallar. Corregido: espera las ventanas
   (hasta ~2 h por llamada), escritura atómica, y el server reencadena pasadas cada 20 min hasta que
   `state.json` diga `complete` (`lolHarvestJob`). Avance visible en
   `/api/internal/lolraw?key=$GP_EXPORT_KEY` (games.json creciendo desde las 10:51). Con el ritmo
   medido, games (~160 páginas) tarda horas y players 2023→ (~700 páginas) un día-plus. **Cuando
   state.json esté completo: bajar los tres archivos por lolraw (gzip), correr `lol-aggregate.js` +
   `lol-validate.js`, commitear la base compacta + priors, y APAGAR GP_LOL_HARVEST en Render.**
   Plan B si no converge: Oracle's Elixir (Drive con cuota agotada el 18; reintentar; IDs en scratchpad).
2. **Todo lo demás YA ESTÁ desplegado y probado** (`129f249` + `a4ec5ad` + `75265e6`): `lol-data.js`
   (contrato cs2-data + championsBoard + draftIntel + tempoFor medido por liga), store integrado (Elo
   propio anclado a mercado con peso por muestra, `draft_room` en analyzeMatch, h2h, ratings_state por
   juego), vista **Campeones** (en el hueco de El circuito para LoL), **Draft Room V1** en la partida,
   **Equipos/Ranking/Jugadores/ficha de jugador** propios de LoL (KP/KDA/CSPM por rol), atribución
   CC BY-SA donde se enseña el dato. Con la carpeta `data/esports/lol/` vacía todo degrada honesto
   (available:false) — ese es el estado de prod hasta que la base real se commitee.
3. **Bug de identidad cazado por el smoke-test:** `resolveTeam` resolvía academias al primer equipo
   ("Nongshim RedForce Challengers" → quinteto de Nongshim RedForce). Ahora un prefijo compartido solo
   es variante si lo que sobra es palabra de organización; los marcadores de segundo equipo
   (challengers/academy/GC/2/B…) NO resuelven. Mejor sin ficha que con la ficha de otro.
4. **Derechos (Fase 0):** `data/esports/lol/RIGHTS.md` — Leaguepedia es CC BY-SA
   (research_attribution_ccbysa, NO betting_commercial_ok): LoL sigue admin-only, familias en sombra,
   probabilidad pública anclada a mercado; la base propia afina peso y alimenta catálogo/draft. La
   política de Riot PROHÍBE apuestas → nada de Riot API ni assets de campeones (texto-first).

## 🏈 18-ago — FÚTBOL AMERICANO COMPLETO: la pestaña NFL ahora es NFL · College · CFL

**Desplegado y verificado en prod (`cfca83a`).** El encargo de Alexis: extender la inteligencia de NFL a
las ligas menos eficientes, TODO generando picks al monitor privado. Hecho con la doctrina intacta
(market-blind, sombra, moneyline cerrado). La sonda responde por las tres ligas:
`/api/internal/nfl?key=…` → pasos `amfoot:ncaaf` y `amfoot:cfl` (College 8 partidos/22 casas y CFL
8/20 al desplegar).

1. **Datos.** NCAAF: CFBD (key gratis de Alexis, en Render como `CFBD_API_KEY`) — 11.260 partidos FBS
   2014-2026, 8.614 con cierre histórico; 38 llamadas de 1.000/mes. CFL: cosido de CUATRO fuentes —
   ESPN 2021-22 (transporte curl; Akamai rechaza fetch de Node), Wikipedia 2023-25 POR EQUIPO con doble
   testigo (254/257 confirmados), scoreboard oficial cfl.ca para 2026, y **los cierres "imposibles"
   salieron del HISTÓRICO de The Odds API** (el plan de la casa lo incluye: /historical/events da los
   kickoffs por 1 crédito, snapshot a kickoff−5min captura el cierre) → 254/453 con cierre, ~28k créditos.
2. **Fit walk-forward por liga** (`scripts/amfoot-fit.js` → `data/amfoot/priors-*.json`): NCAAF MAE
   margen 13,59 vs 12,34 del cierre (TOTAL roza breakeven: 52,9% umbral 6, n=2.199); CFL 10,55 vs 9,88 y
   total a 0,12 del cierre — **backtest TOTAL CFL 57-65% en n=43/26, la señal de liga blanda que la
   sombra tiene que confirmar o matar**. CFL 2026 anota +6 pts (cambio de reglas, 53,0→59,1 medidos):
   base móvil corta (50) por eso.
3. **Motor** `amfoot-engine/store.js`: arquitectura nfl-engine con dimensión de liga, MISMOS DTOs → la UI
   de NFL rinde las tres ligas con un selector (molde baloncesto). Overlay de resultados en disco
   persistente (CFBD/cfl.ca). Jobs cada 30 min, ventana ≤9 días: **CFL registra sombra YA** (juega esta
   semana), college desde el ~20-ago (kickoff 29-ago).
4. **🔴 BUG REAL CORREGIDO EN NFL:** los gates usaban |edge| → los DOS lados del mismo mercado pasaban a
   la vez (la primera pasada CFL registró el lado -EV). Corregido en ambos motores: edge positivo. El
   latente de NFL habría debutado con los mercados de la Semana 1.
5. Primera pasada real de sombra CFL (local): 5 picks — 4 TOTAL under + 1 SPREAD, solo lado +EV.
   `/api/amfoot/{slate,game,teams,model,track}?league=` con el gate de NFL; Jugadores/lecturas/lesiones
   quedan solo-NFL y la UI lo declara.


## 🧭 17-ago (sesión de noche) — LO ÚLTIMO, LÉEME ANTES QUE NADA

**En producción ahora mismo: `11a0fb2`.** Lo que sigue en la rama
`claude/gpsim-continuation-vrjuww` **sin tocar main, esperando el OK de Alexis**: las lentes de fútbol y
los scripts de Dota 2 (ver más abajo). Reglas fijas intactas: ejecutor en la sombra sin tocar; baloncesto
congelado SOLO-RAMA hasta el domingo 23; a main solo por SHA.

1. **Revisión de la sombra de props, y el fallo que destapó.** Las 24 tesis vivas estaban anotadas
   **22 de 24 al MISMO precio** (1,893 → listón 0,5283): Underdog es un libro DFS y casi no mueve precio,
   mueve la LÍNEA. El CLV que había medía solo `close_bar − bar` y encima descartaba las tesis cuya línea
   se había movido → **medía cero por construcción justo en los casos informativos**. Corregido y
   desplegado: CLV = **línea + precio**, la línea evaluada con la proyección CONGELADA al anotar (mu/sigma
   guardados en la tesis), que es lo que aísla el movimiento del libro de la deriva del modelo. Retroactivo
   (las tesis ya guardaban `mu`, `sigma` y `close_line`). Signos comprobados: over 26,5 que cierra en 28,5
   = +13,2 pp; el mismo que cierra en 24,5 = −12,8 pp. Añadido también el **CLV provisional de las tesis
   abiertas** (`perf_open`), porque con 0 liquidadas la familia estaba ciega.
2. **Liquidadas: 0, y es lo esperado** — no un fallo. Las primeras tesis son de partidas del 18 y 19-ago;
   liquidan con la pasada diaria siguiente. Al cierre de esta sesión: 24 activas, 2 con la línea ya movida.
3. **Rutas internas nuevas** (misma llave `GP_EXPORT_KEY`, solo lectura, porque revisar una familia en
   sombra desde una terminal no debería exigir sesión de navegador):
   `/api/internal/esports?key=…&props=1` (track + resumen de pizarra) y `…&evidence=cs2`.
4. **Evidencia de mercado: vacía todavía, con motivo medido.** `with_open_and_close: 0` y
   `avg_passes: 1` — el trabajo de cierres corre a los 320 s del arranque y luego cada 20 min, y **cada
   deploy reinicia ese reloj**: en un día de despliegues seguidos ningún evento llega a una segunda pasada
   y la apertura nunca se congela. No es un bug del panel; es cadencia. En un día sin deploys se llena solo.
5. **Fase 3 del rediseño (fútbol) — EN LA RAMA, pendiente de que Alexis lo mire.** Decisión tomada con él:
   **versión ligera**, porque el partido de fútbol NO estaba como CS2/NFL/baloncesto (aquí ya había nav
   sticky con scrollspy y dos columnas). El mismo nav deja de listar 9-11 anclas y pasa a filtrar tres
   lentes (El partido / El modelo / Contexto, con su traducción al inglés); dentro de la lente las
   secciones se reparten en las dos columnas existentes partiendo por la MITAD del orden de lectura, para
   que en móvil el orden no cambie. Héroe y panel de oportunidad, intactos y siempre visibles. Medido en
   México–Sudáfrica: **móvil 2.518 → 1.251 px, desktop 1.804 → 954 px**, cero errores JS a 430 y 1360 px.
6. **Dota 2: base propia + la validación, ANTES de enchufar nada** (también en la rama).
   `scripts/dota-harvest.js` bajó **30.000 partidas profesionales** (jul-2025 → ago-2026; 28.529 con los dos
   equipos identificados, 2.069 equipos). `scripts/dota-validate.js`, walk-forward estricto:
   **Elo+lado = 1,92 % de skill, AUC 0,574, ECE 0,017** contra 0,06 % de "saber de qué lado juegas".
   CS2 con la misma validación da 7,28 % / 0,652 → **la señal de Dota 2 es real pero vale una cuarta parte**,
   y el AUC no se mueve con K, así que el techo está en el dato (mezcla tier-1 con tier-3). **No habilita
   picks**; sirve para tener rating propio y poder medir CLV cuando haya cuotas guardadas.
7. **🔴 CORRECCIÓN al punto 5 de la sesión anterior (costes de datos):** existe **GRID Open Access**, que es
   **GRATIS** y da datos oficiales de CS2 y Dota 2 (server-side, evento a evento) a proyectos pre-revenue.
   Es el desbloqueo del dato ronda a ronda **sin los ~1.600 €/mes** que quedaron escritos. El feed de
   apuestas (*Series Events*) queda fuera de Open Access y es de pago — conviene decirlo nosotros en la
   solicitud. Y al revés: **la API pública de Riot NO sirve partidas profesionales**, solo cuentas
   normales; para el circuito lo que hay es lolesports (que ya usamos) y Liquipedia → Riot baja de
   prioridad. Los tres textos listos para enviar están en **`SOLICITUDES_DATOS.md`** (GRID, Liquipedia,
   Riot); enviarlos necesita tu cuenta.

## 🧭 17-ago (cierre de sesión anterior) — PUNTO DE RETOMA

**Todo lo de abajo está DESPLEGADO y verificado en prod** (último deploy: lentes en todos los deportes).
Estado de las reglas fijas: ejecutor en la sombra ($2.000, cards_under_v1) INTOCADO; baloncesto congelado
SOLO-RAMA (`claude/gpsim-combat-visual-boxing-276pin`, commit en la punta) hasta el DOMINGO 23-ago;
`GP_BOXING_BACKFILL=0` (backfill completo: 39.384 peleas / 1.417 boxeadores, en main).

1. **Props de jugador CS2 vs Underdog, EN SOMBRA** (`esports-engine/props.js` +
   `data-providers/esports/underdog.js` + rutas `/api/esports/{props,propstrack}` + vista Props):
   v1.1 con factor rival (dpr del cinco rival, clamp ±12%), headshots como 2ª stat, CLV por tesis.
   Barrido cada 2 h anota tesis solo; settle en cs2DailyJob. **POR QUÉ NO GENERA PICKS TODAVÍA** (si
   Alexis pregunta): doctrina de la casa — toda familia nueva acumula muestra fuera de muestra en sombra
   y se revisa con Alexis ANTES de publicar; el modelo v1.1 no está validado contra resultados aún (0
   liquidadas al cierre de sesión; las primeras liquidan con la pasada diaria del 18-ago). El listón
   está escrito en el propio track (`doctrine`). La bitácora de jugador lleva `hs` desde la pasada del
   18-ago (para liquidar headshots; los anteriores caen a VOID con motivo).
2. **Boleto GP**: combinador de piernas en TODAS las pick cards (localStorage `gp_slip`, ¼-Kelly tope
   2 %, correlación avisada). Listener global con captura; botón junto a la calculadora.
3. **Blueprint feedback CS2 aplicado**: apertura point-in-time en cierres (`snapshotCloses` congela
   primera lectura), panel Evidencia de mercado en Rendimiento (`/api/esports/evidence`: cobertura,
   apertura→cierre, CLV por casa), Huella GP (percentiles 6D en ficha de jugador), estado del cinco en
   ficha de equipo.
4. **LENTES CONTEXTUALES (arquitectura visual, fase 1+2 ENTREGADA)**: patrón `gx-seg` sticky
   («La partida / El modelo / Contexto») aplicado a: partida CS2, partida esports genérica (LoL/VAL/Dota,
   2 lentes), partido NFL (`data-nfllens`, bind de cancha solo en lente partida) y partido baloncesto
   (`data-bblens`, era la pantalla más vertical: 17 bloques). Handlers: esClicks para esports; listener
   global de captura para NFL/BB. El VERDE NO SE TOCA (decisión de Alexis 17-ago). PENDIENTE de la
   fase 3: fútbol (renderMatch — producto público en vivo, hacerlo con Alexis mirando) y fichas de
   equipo/jugador si se quiere.
5. **Datos round-level (punto 1 del feedback) — investigación de costes (17-ago)**: PandaScore con
   rondas detalladas ≈ €1.600/mes histórico, €4.000/mes live (pricing público). GRID/Bayes = enterprise
   con presupuesto a medida (GRID tiene programas de acceso para proyectos pequeños — vale la pena
   aplicar). **Gratis y oficiales para los OTROS esports**: Riot API (LoL y Valorant, gratis con
   aprobación) y OpenDota/Steam (Dota 2, gratis) — dan detalle por partida que bo3 no tiene para CS2.
   Camino recomendado: aplicar a GRID + pedir Riot API + Liquipedia (email pendiente de Alexis);
   PandaScore solo si el producto ya paga.
6. **Recordatorio programado**: trigger `trig_012Ai9w8HHmxRXL9GneDcAzv` dispara el 7-sep-2026 14:00 UTC
   (sesión fresca, push+email a Alexis) para construir el ROSTER TIMELINE de CS2 con las ~3 semanas de
   fotos diarias de plantilla ya acumuladas. Si hay <15 días de fotos, reprogramar.
7. **Análisis LCS Larry** (competidor, lcslarry.com + @LCSLarry): escáner de props esports contra libros
   DFS blandos, $150/mes vía Whop, track record auto-calificado no auditable (claims ~60% hit / 30% ROI).
   Veredicto: modelo no comparable ni auditable; negocio listo en lo comercial. Sus 2 ideas buenas ya
   replicadas (props → punto 1, boleto → punto 2). Pendientes de decisión de producto con Alexis:
   track record público cuando la sombra aguante, comunidad de pago post-Mundial.


## 📋 17-ago (tarde-3) — BLUEPRINT DE FEEDBACK CS2 aplicado (P0 evidencia de mercado + P1 jugador/roster)

Del docx "Product Feedback & Next-Level Review" de Alexis. Lo aplicado, en su orden de prioridad:
- **P0 · Apertura + cinta point-in-time** (`store.snapshot`): antes cada pasada de cierres SOBREESCRIBÍA
  la anterior — quedaba el cierre y se perdía la apertura. Ahora la primera lectura de cada evento queda
  congelada (`open_rows`/`open_at`), se cuentan las pasadas (`moves`) y el ganador de serie lleva una
  cinta ligera de hasta 30 puntos (mejor precio por lado). Acumula desde este deploy vía el job de 20 min.
- **P0 · `marketEvidence(game)`** + ruta `/api/esports/evidence`: cobertura (cierres, con ambas puntas,
  pasadas medias), movimiento apertura→cierre en pp de probabilidad implícita (top movers con nombres) y
  **CLV por CASA** (el corte que faltaba; por familia ya lo daba `track()`). Panel "Evidencia de mercado"
  en Rendimiento. Doctrina del documento dentro del dato: predictividad ≠ rentabilidad.
- **P1 · Huella GP** en la ficha de jugador (`playerProfile.footprint`): percentil contra la población
  cualificada en apertura/volumen/daño/consistencia/clutch/multi-kill — "impacto contextual, no más
  campos". Smell test: ZywOo p99-p100 en todo.
- **P1 · Estado del cinco** en la ficha de equipo: estabilidad medida en días (517 equipos la tienen),
  titulares incompletos declarados, y el aviso de cambio reciente ya existente.
- **Pendiente del blueprint (no entró hoy, por diseño)**: round/economía/T-CT (necesita datos ronda a
  ronda que bo3 no da), spatial intelligence, arquitectura visual menos vertical: ENTREGADA en la pantalla más vertical (panel de partida CS2 →
  lentes contextuales «La partida / El modelo / Contexto» con el gx-seg de la casa, héroe+oportunidades
  siempre visibles, sticky); extenderla al resto de pantallas y el «verde escaso» siguen para sesión propia, roster timeline histórico (requiere fotos de plantilla acumuladas).

## 🎯 17-ago (tarde-2) — PROPS DE JUGADOR (familia nueva EN SOMBRA) + BOLETO GP

Del análisis de LCS Larry (competidor: escáner de props de esports contra libros DFS blandos). Se
replicaron sus dos ideas buenas con la disciplina de la casa:
- **Props CS2 contra Underdog** (`esports-engine/props.js` + `data-providers/esports/underdog.js`):
  Underdog publica su pizarra entera en un endpoint público CON precio por pierna (PrizePicks bloquea con
  captcha, probado). Proyección PROPIA de kills en mapas 1-2: kpr encogido (ancla poblacional, K=250
  rondas) × rondas esperadas medidas (~21,4/mapa), sigma de sus últimos 12 mapas ×√2 con suelo. Solo CS2
  proyecta (único título con scoreboard propio); LoL/Valorant se listan sin valorar y se dice por qué.
  Vetos: muestra_corta, ventaja_no_creible (>20 pp), stat_no_modelada. **Sombra PROPIA** en
  `<disk>/esports/props-cs2.json` — UNA anotación por TESIS (día|jugador|stat|lado, la línea de más
  ventaja), liquidación automática desde los logs propios (mapas 1-2 = últimas 2 filas de la serie en el
  log, `settle_basis` escrito en cada pick), VOID a los 7 días sin scoreboard. **CERO contacto con el
  ejecutor en la sombra de la casa** (cards_under_v1 sigue intocable hasta el domingo 23). Barrido de
  anotación cada 2 h (`esPropsSweep`) + settle dentro de `cs2DailyJob`. Rutas
  `/api/esports/{props,propstrack}` (admin), vista **Props** en Esport. Al construirla había 385 líneas,
  12 sobre el listón, 8 tesis anotadas. v1 declarado sin ajuste por rival — y **v1.1 (misma tarde)** lo entregó: factor rival MEDIDO
  (media de dpr del cinco rival vs poblacional, ≥3 medidos, recorte ±12 % por la trampa de filiales),
  **headshots en mapas 1-2** como segunda stat (derivada de kills × proporción encogida; la bitácora
  lleva `hs` fila a fila desde la pasada del 18-ago y con eso liquida) y **registro de CIERRE por tesis**
  en cada barrido → CLV medio en el rendimiento (la métrica que decide antes que el acierto).
- **Boleto GP** (todas las pick cards, los 4+ deportes): botón "Boleto" junto a la calculadora → fab
  flotante con panel: piernas, cuota combinada, prob GP combinada (solo con partidas distintas: piernas
  correlacionadas no multiplican y se avisa), EV, stake sugerido ¼-Kelly tope 2 %, copiar al portapapeles,
  disclaimer. localStorage `gp_slip`, máx 6 piernas. Probado con Playwright (desktop + móvil, cero
  errores JS).
- Listón de salida de la sombra de props: el de toda la casa — muestra fuera de muestra revisada con
  Alexis antes de publicar nada como pick.

## 🏈 17-ago (noche) — NFL INTELLIGENCE TERMINAL (V1 del blueprint, admin-only)

Sexto deporte, construido del blueprint maestro de Alexis (Word). Lo entregado es la columna V0→V1:
- **Base propia point-in-time**: `scripts/nfl-harvest.js` baja nflverse (games.csv 1999→hoy CON cierres
  históricos + stats_team_week 2016-2025 con EPA) → `data/nfl/` (games 3.033, team-weeks 5.522, venues con
  coordenadas para clima). Crudo en `<disk>/nfl-raw/`.
- **Modelo market-blind** (`nfl-engine/`): rating en puntos (opponent-adjusted, recency, carry 2025
  encogido) + estados EPA de 4 lados → margen y total. `scripts/nfl-fit.js` = walk-forward 2017-2025:
  **MAE margen 10.31 vs 9.86 del cierre · Brier 0.224 vs 0.210** — bueno, NO bate al mercado, y por eso
  **TODO está en sombra** (registro privado + CLV; moneyline cerrado por doctrina). Simulador: pares de
  residuos reales vs cierre (masa de números clave 3/6/7/10/14 real) + ruido por la varianza extra medida.
- **Terminal** (pestaña NFL junto a Esport): Command Center (delta GP-vs-mercado por partido), Game
  Intelligence Terminal (héroe con banda de incertidumbre, distribución margen/total con la línea del
  mercado marcada, gravedad de números clave, ADN EPA divergente, grid multi-casa, veredictos con gates,
  Weather Lens open-meteo, forma/h2h, procedencia), Equipos + ficha, Model card con la validación entera,
  Rendimiento (sombra). Probado con clicks a 1360/390px.
- **Jobs**: cuotas (The Odds API, 1 llamada liga entera) + cierres + sombra cada 30 min SOLO con partidos
  a ≤9 días. Probe: `/api/internal/nfl?key=`. Kickoff real: mié 9-sep (SEA) y SF–LAR en Melbourne el 10.
- **Pendiente natural (V1.2+ del blueprint)**: roster licenciado, player props (motor de
  oportunidad), 1H, Ask GP. Nada de eso se finge en la UI: se declara.

### v2 (misma noche, pedidos de Alexis)
- **Oportunidades NFL**: pantalla honesta — estado de cada familia con su porqué medido, el reloj al
  kickoff, y lo que la sombra registra. **Jugadores**: directorio QB/RB/WR/TE (nflverse 2024-2025,
  headshots, por-partido). **Partidos** reformateado a la gramática de la casa (tabla Hora·Partido·
  Mercado·Probabilidad·Señal). **Buscador scoped**: en NFL solo NFL (`/api/nfl/search`), en Esport solo
  CS2 (`/api/esports/search`).
- **LA CANCHA INTERACTIVA** (Game Terminal): el eje es el margen (cada yarda = un punto), la
  distribución del simulador pintada por bando sobre el césped, números clave recuadrados, banderines
  GP/mercado, y DOS exploradores (spread y total) que arrastran una línea y leen la CDF completa de las
  20.000 simulaciones — así se cotiza cualquier línea alternativa (NFL-0464) sin re-simular.
- **Backtest de picks vs cierre** (2017-2025, en el Motor y en Oportunidades): ML −7/−10% ROI, spread y
  total negativos en umbrales chicos; único bolsillo >breakeven: spread con desacuerdo ≥4 pts (53.2%,
  +1.55%, 575 apuestas — dentro del ruido). Es la justificación NUMÉRICA de la sombra.
- **Lecturas LLM** (`llm.writeNflRead` / `writeCs2Read` + `db.nflReads`/`db.esReads`): la capa de
  contexto narrada del dossier estructurado, cacheada (se paga una vez), pasada de fondo
  `llmEsNflReadsPass` (cap 3) + generación bajo demanda por ruta. Baloncesto ya la tenía.
- **Disponibilidad NFL**: ESPN core API, cacheada 6 h, SIEMPRE etiquetada "mejor esfuerzo · no
  oficial" — la decisión del motor no la consume (eso exige feed licenciado, NFL-0069).

> Punto de retoma para la siguiente sesión. Lee `CLAUDE.md` primero (reglas duras), luego esto, luego el
> principio de `TODO_NEXT.md`.

## 🆕 17-ago (tarde) — CATÁLOGO CS2 (6 productos) + OPS AUTOMÁTICAS

**Producto (todo servido de la base propia, nada depende de las casas):** Finalizados (marcadores bo3 reales
en Partidas), Equipos (directorio + ficha con efecto por mapa/quinteto/forma/rivales), Ranking GP (top 50 por
Elo propio validado; foto semanal en `data/esports/cs2/rankings-history/` — las flechas aparecen con la 2ª
foto), Jugadores (rating 6m del proveedor, ETIQUETADO como suyo; escala 0-10, no la ~1.0 de HLTV), El
circuito (meta del pool medido) y H2H (en partida, simulador y ficha). Rutas: `/api/esports/{directory,team,
players,ranking,circuit,results,h2h}`. Vistas: `esteams/esteam/escircuit` + segmento `fin` en esboard.
La base se re-cosechó COMPLETA: **88.502 mapas** (antes 48.678) — los agregados nuevos (`pairs.json`,
`form.json`, `rankings.json`, `players.json`) salen de `cs2-harvest.js --aggregate-only` + `cs2-roster.js`.

**Ops (server.js, bloque "OPS AUTOMÁTICAS"):** (1) CSV de usuarios DIARIO por correo al admin (adjunto
Resend — copia fuera de la máquina); (2) cosecha CS2 diaria automática a las ≥09 UTC en hijos con tope de
heap y guardia de RSS (`GP_CS2_HARVEST_ENABLED=0` la apaga; estado en `/api/internal/ops?key=`); (3)
`/api/internal/cs2raw?key=` para SEMBRAR el crudo en el disco de Render (subir gzip; sin esto el primer día
re-cosecharía todo); (4) backfill de boxeo con `GP_BOXING_BACKFILL=1` (una vez por boot, Wikipedia no limita
la IP de Render); (5) panel de créditos arreglado: `quota_updated_at` (migración 045) — la fecha de la cuota
ya no miente; (6) memMarks finos dentro de buildHoopsPicks y combatCloudbetRefresh (solo instrumentación).

**⚠️ CONGELADO HASTA EL DOM 23:** las temporadas históricas de baloncesto (games-nba-2024/2025,
games-wnba-2023/24/25, ~55 MB) están SOLO en la rama `claude/gpsim-combat-visual-boxing-276pin`, NO en main:
`store.load()` re-ajusta el rating con TODOS los `games-*` del disco y meterlas ahora cambiaría la decisión
en mitad de la ventana. El domingo 23: fast-forward de main a la rama + re-fit + validación. Los artefactos
`fit-*.json` que el backfill reescribió se REVIRTIERON por lo mismo.

## 🔬 CS2 2.0 — VALIDACIÓN, MODELO NUEVO Y ROSTER (16-ago, tercera pasada)

Sobre el blueprint 2.0. Lo que sigue es lo entregado, y **lo primero es una corrección a mí mismo**.

### ⚠️ LA VALIDACIÓN TUMBÓ EL MODELO QUE YO HABÍA DEFENDIDO
`scripts/cs2-validate.js` recorre los 48.678 mapas en orden cronológico estricto y predice cada uno con el
estado ANTERIOR a jugarlo (walk-forward por construcción, punto en el tiempo real). Cinco predictores sobre
exactamente los mismos mapas:

| predictor | skill de Brier | AUC |
|---|---|---|
| moneda (0,5) | 0 % | 0,500 |
| **Elo GLOBAL** (ignora el mapa) | **6,88 %** | 0,649 |
| Elo por mapa | 3,04 % | 0,600 |
| tasa por mapa | 1,00 % | 0,577 |
| **modelo que estaba desplegado** | **2,12 %** | 0,589 |

El argumento «Elo POR MAPA, no global» que escribí con toda confianza en el código, en `PROJECT_STATE.md` y
en el documento Word que entregué **estaba mal**. Partir el historial de un equipo en siete mapas deja cada
trozo con un séptimo de la muestra; el ruido se come la señal y el modelo acaba por debajo de ignorar el
mapa entero.

### La corrección (módulo 9 del blueprint 2.0)
El mapa no se tira: se degrada de rating a **corrección** sobre la fuerza global.
`logit(p) = CAL_SLOPE × [ logit(p_elo_global) + LAMBDA × (efecto_A − efecto_B) ]`, con
`efecto(equipo,mapa) = (su tasa en ese mapa − su tasa global)` encogido por muestra.
λ y el encogimiento se ajustaron en 2024-2025 y **se confirmaron en 2026 sin volver a tocarlos**:

**jerárquico calibrado → skill 7,28 % · AUC 0,652 · ECE 0,0081 · pendiente 0,999** (3,4× lo desplegado).

### Roster: org ≠ roster (P0.5, el 2,0/10 del scorecard)
`scripts/cs2-roster.js` — 20.278 jugadores, **2.443 organizaciones, 689 con quinteto completo, 44 con cambio
reciente**. El proveedor da la plantilla ACTUAL, no el histórico, así que se toma una **foto diaria**: el
lineage propio con fechas efectivas empieza hoy. Un cambio reciente **ensancha la incertidumbre** (+2,6 pp
por equipo afectado) en vez de fingir que el historial sigue describiendo al equipo. Repesar el pasado por
parecido de alineación queda pendiente y se declara como pendiente.

### Ficha del modelo (P0.9)
Cada constante etiquetada **aprendida / convención / doctrina / experimental**, con su motivo, servida en la
API y pintada con código de color. Una constante sin etiqueta se lee como si estuviera medida y la mayoría
no lo están (el coeficiente de veto y el momentum de serie son experimentales, no ajustes).

### Lo que sigue faltando, por orden
1. **Baseline de mercado y CLV** — sin histórico de cuotas de CS2 no se puede decidir si alguna familia
   merece picks públicas. Es la comparación que falta y está declarada en pantalla.
2. Histórico de vetos reales (Liquipedia) para sustituir el coeficiente supuesto.
3. Multi-book: medido hoy, bo3 no da cuotas y Kalshi/Polymarket no cotizan partidos de CS2.
4. Demos .dem para economía, lados T/CT y jugadores.

### Operación nueva
```bash
node scripts/cs2-harvest.js                 # base histórica (semanal)
node scripts/cs2-roster.js                  # plantillas + foto del día (DIARIO: cada día que falte es lineage perdido)
node scripts/cs2-validate.js --json=...     # re-validar tras tocar el modelo
```

---

## 🔫 CS2 — BASE HISTÓRICA PROPIA Y CAPA VISUAL (16-ago, segunda pasada)

Alexis rechazó la primera entrega con tres reproches justos: UI de tablas apiladas sin una imagen, foco
disperso en cuatro juegos cuando el blueprint era **solo de CS2**, y dependencia de un único proveedor
pudiendo construir data propia. Esto es la respuesta.

### La base propia (`data/esports/cs2/`, 956 KB versionados)
`scripts/cs2-harvest.js` + `data-providers/esports/bo3.js` → **48.678 mapas, 48.486 con los dos equipos
resueltos (99,6 %), 1.031 equipos con perfil**. El crudo (25 MB) queda en el disco persistente; solo viajan
los agregados, que son *nuestras* definiciones de features:
- fuerza por mapa encogida hacia el 50 % con decaimiento (media vida 180 días) y peso por tier
- **Elo POR MAPA**, no global: en CS2 un equipo puede ser top en Mirage y flojo en Nuke
- distribución real de rondas, prórroga y palizas por mapa

Re-cosechar: `node scripts/cs2-harvest.js` (incremental) o `--aggregate-only` para re-derivar sin red.

### Lo que cambió porque ahora hay datos
| Antes | Ahora |
|---|---|
| fuerza por mapa `null` → **el tablero de veto no existía** | se dibuja con la fuerza real de los dos equipos |
| prórroga 12,8 % asumida | **11,4 % medida**, y distinta por mapa |
| arrastre económico elegido a ojo | **ajustado por mapa** para reproducir su prórroga real; el residuo en rondas se publica |
| pool de mapas escrito a mano | **deducido de lo que se juega**, con desempate por tendencia |
| sin mercado → pantalla con un guion | **GP da su propia probabilidad** simulando la serie sobre la fuerza por mapa |

El desempate del pool merece una nota: Cache y Overpass empataban en volumen reciente, pero los 259 mapas de
Cache son **todos** de los últimos 100 días (entra al pool) y los de Overpass son el rescoldo de 2.617
históricos (sale). Ordenar por volumen a secas habría dejado fuera al mapa que se va a jugar.

### Resolver a qué equipo pertenece cada mapa (fallaba en un tercio)
El proveedor guarda el **nombre del clan**, no el id, y no coincide con el del equipo casi un tercio de las
veces. Buscarlo entre 8.359 equipos fallaba en el 31 % y, cuando acertaba por casualidad, podía asignar el
mapa al equipo equivocado — peor que perderlo. Se cambió el problema: **el mapa pertenece a uno de los DOS
equipos de su partido**. De 31 % sin resolver a 0,4 %. Aparte, `norm()` NO limpia "academy"/"junior": al
limpiarlos, Team Spirit heredaba el historial de su filial.

### La capa visual
Logos reales del histórico; **planos de los siete mapas dibujados en SVG aquí dentro** (dos sitios, medio y
conectores — ninguna imagen de terceros, y más legible que una captura); héroe con halo de incertidumbre;
tablero de veto con las siete cartas; escalera de ventaja por mapa; y el perfil de rondas con la simulación
**dibujada encima de lo observado**, para que el modelo se pueda juzgar en vez de solo creer.

### ⚠️ La dependencia que hay que resolver
El `robots.txt` de bo3.gg desaconseja el acceso automatizado a `/api/`. Es el riesgo que el blueprint señala
para HLTV. Decisión consciente y reversible: se usa para arrancar, detrás de un adaptador que es lo único
que sabe que bo3 existe. **Hay que pedir acceso a Liquipedia** (tiene vía oficial) y, con él, cambiar de
fuente cuesta un archivo. Lo que sigue faltando para el blueprint completo: veto histórico real (hoy el
árbol se deriva de la fuerza por mapa), y demos .dem para la economía de ronda.

---

## 🎮 ESPORTS — el quinto deporte, construido el 16-ago y ADMIN-ONLY desde el día uno

**Qué hay.** Cuatro juegos que NO comparten motor, cada uno en su pestaña, porque su lógica es distinta de
verdad: CS2 (veto de mapas, rondas, economía), LoL (ritmo de liga → duración → kills), Valorant (veto,
composiciones y asimetría ataque/defensa) y Dota 2 (draft, duración de cola larga, reversión por aegis y
buyback). Archivos: `esports-engine/{core,cs2,lol,valorant,dota2,store}.js` y
`data-providers/esports/cloudbet.js`. Rutas `/api/esports/{overview,board,match,model,snapshot}`, todas
detrás del mismo portón que baloncesto (`GP_ESPORTS_PUBLIC_ENABLED`, hoy sin poner = solo admin). En la UI:
deporte **Esport** en la barra de deportes, con teaser "Próximamente" para el público.

**La doctrina, puesta desde el minuto cero en vez de aprendida otra vez.** El ganador de serie se calcula,
se enseña y se explica, pero **no genera picks**: la puerta está cerrada en `PICK_FAMILIES`, no en una
variable de entorno. Es donde baloncesto perdió −11,87 % de ROI y combate −8,34 % de CLV. Las picks solo
salen de familias derivadas (rondas, kills, totales, hándicaps).

### Lo que se midió contra el proveedor, y conviene no volver a intentarlo
- **The Odds API no tiene NI UN deporte electrónico** (0 de 75). Cloudbet sí, y ya estaba pagada.
- **Cloudbet NO publica resultados.** Un evento terminado llega con `settlement: {}` y CERO mercados; el
  catálogo de fixtures solo mira hacia delante; `/odds/results` y `/events/settled` son 404. Consecuencia
  seria: **el rating propio de esports no puede arrancar solo.** El diseño lo aguanta (la probabilidad va
  anclada al mercado con 0 % de peso propio) y la UI lo dice con todas las letras en Rendimiento, en vez de
  enseñar un cuadro en cero que se leería como un fallo.
- **Lo que sí se acumula desde hoy: el CIERRE de mercado** (`snapshot`, cada 20 min, `data/esports/`). Sin
  resultados no se liquida, pero el día que entre una fuente de histórico el CLV se calcula hacia atrás.
- **La mayoría de partidos NO cotiza el ganador de serie** pero sí marcador, hándicap y ganador de mapa. Por
  eso `marketAnchor` recorre esas cuatro fuentes en orden y dice de cuál salió. Anclarse solo a `SERIE`
  dejaba en blanco partidos con dieciséis líneas abiertas.

### Cuatro errores que se encontraron MIDIENDO y que ya están corregidos (no repetirlos)
1. **El prefijo de Valorant es `esport_valorant`, no `valorant`.** Asumirlo dejaba todos sus mercados a cero.
2. **La línea vive en `sel.params`, no en la clave del submercado.** Leer solo la clave dejaba todas las
   líneas en `null` y con eso ninguna familia derivada se podía valorar.
3. **El hándicap se aplica SIEMPRE al local, con su signo; el lado visitante es el complemento.** Verificado
   con un partido que cotizaba a la vez marcador, ganador de mapa y hándicap (UNiTY vs Misa): las tres
   familias daban P(local 2-0) = 0,308 / 0,306 / 0,330. Agrupar por `Math.abs(line)` perdía el signo y
   fabricaba un favorito del 62 % donde el mercado decía 90 %.
4. **No se busca valor en el precio contra el que te has calibrado.** La familia que ancló la probabilidad
   queda excluida de la valoración y se dice por qué. Sin eso salía una "ventaja" de +41,76 pp en el mismo
   hándicap que era el ancla — y llegó a pintarse en pantalla antes de detectarla.

### Dos decisiones de modelo que conviene entender antes de tocarlas
- **Una sola casa no puede ser un veto permanente.** Bloquear toda pick con menos de dos casas significaba
  cero picks para siempre (GP tiene UNA fuente de esports). En vez de ignorar el riesgo, **sube el listón**:
  +2,5 pp de ventaja exigida cuando solo cotiza una casa, y se dice en la ficha.
- **La incertidumbre no es la misma para todas las familias.** Un total de kills no depende de conocer a los
  dos equipos, depende de si el perfil de ritmo de la liga es correcto. Cobrarle la ignorancia sobre el
  emparejamiento (±15 pp con muestra cero) hacía imposible que ninguna línea de volumen pasara nunca. Ahora
  las familias de VOLUMEN pagan la incertidumbre del perfil (±7,4 pp) y las de MARGEN la del par.

### Calibraciones declaradas como supuesto (no como medición de GP)
- Perfiles de ritmo por liga (LoL) y por circuito (Dota 2): referencia de circuito 2026.
- Sesgo defensivo por mapa en Valorant: referencia de circuito.
- **Arrastre económico por ronda** (CS2 0,055 / Valorant 0,065): calibrado para que la tasa de prórroga caiga
  del 16,4 % del binomio al ~12,8 %, que es lo que da el circuito. El **signo importa y es fácil de
  equivocar**: quien ganó la ronda anterior llega con dinero, así que la racha se refuerza (`+`). Con el
  signo al revés el modelo revertía a la media y disparaba la prórroga al 19 %.
- CS2: la carrera a 13 hacía IMPOSIBLE el 12-12 y la tasa de prórroga salía exactamente 0 — un imposible del
  juego, no un resultado. Ahora son 24 rondas de regulación y bloques MR3 de prórroga.

### Verificado (en local contra la API de producción de Cloudbet, con datos reales)
- Los cuatro juegos responden; CS2 12 eventos / 5 ligas, LoL ~22 / 9, Valorant 4 / 1, Dota 2 sin agenda hoy.
- Sumas de probabilidad coherentes en las diez familias derivadas (más/menos = 1, hándicaps complementarios).
- Las cinco vistas pintan a 1400 px y a 390 px **sin un solo error de JS**, y los otros cuatro deportes
  siguen intactos (fútbol, combate y baloncesto probados en la misma pasada).
- El público (usuario beta no admin) ve **Esport · Próximamente** deshabilitado, las tres rutas devuelven
  404 y un enlace directo a `#esopps` cae al board de fútbol.
- **El menú "más" del móvil lleva su rama de esports desde el principio** — es el fallo que ya mordió a
  combate el 2-ago y a baloncesto el 16-ago por la mañana; no se repitió.

### Verificado EN PRODUCCIÓN (deploy `81fc4ea`, 16-ago 12:57)
`GET /api/internal/esports?key=$GP_EXPORT_KEY` — misma llave que `/llm` y `/shadow`, no sirve inteligencia
ni picks, solo estado. Devuelve: los cuatro motores cargan, la clave del proveedor está, el trabajo de
cierres corre, y la agenda real (CS2 9 partidas / 5 ligas, LoL 21 / 9, Valorant 4 / 1, Dota 2 sin agenda).
- **Los cierres se escriben en `/data/esports` (disco persistente), no en el repo.** Se corrigió tras
  desplegar: el directorio del repo se recrea en cada deploy y habría borrado el histórico justo cuando
  empieza a acumularse. La ruta interna dice cuál de los dos está en uso (`closes_dir_persistent`).
- El resto de la plataforma sigue sana (`/`, `/api/aciertos`, `/api/ticker` en 200).
- **Sonda de servidor**: `?probe=<juego>` en la misma ruta interna ejecuta pizarra + ficha del motor +
  una partida y devuelve tiempos y errores. Los cuatro juegos en verde (pizarra 1,5-2,9 s en frío).
- **Navegación por clic verificada** en escritorio y móvil, en los cinco deportes.

### 🐞 EL FALLO QUE SE ESCAPÓ AL PRIMER DESPLIEGUE, y la lección de método
Alexis lo reportó en cuanto entró: *"me aparece la pestaña de Esport pero nada me carga"*. **`NAV_HASH` no
tenía las cinco vistas de esports**, así que `compHash` devolvía `undefined` y `navTo` hacía `setHash('')`
— que es el hash del board de FÚTBOL. Cada clic del menú, y el propio botón del deporte, cambiaban la barra
lateral a esports y dejaban al usuario callado en otro deporte.

**Las vistas estaban perfectas.** Se pintaban, respondían y devolvían datos correctos por URL directa. Lo
que no existía era el camino del clic hasta ellas. Y ese es el punto: **toda la verificación previa navegó
escribiendo la URL (`#esopps`), nunca pulsando el menú**, así que ese camino no se ejercitó ni una vez. Una
prueba que entra por la puerta de atrás no prueba la puerta de delante.

Corregido en tres partes: las cinco vistas en `NAV_HASH`; el juego elegido viaja en el hash
(`#esboard/lol`), igual que la liga en baloncesto; y `navTo` cae al nombre de la vista en vez de a la cadena
vacía cuando falta una entrada — porque la cadena vacía no da error visible, da un menú que "no hace nada".
**Al añadir un sexto deporte: la prueba se hace a golpe de clic, no por URL.**

### Lo que falta en esports (por orden de valor)
1. **Una fuente de resultados.** OpenDota (público) y la API de Riot son las dos primeras y no necesitan
   permiso comercial. Sin esto no hay rating propio, ni liquidación, ni ROI que enseñar.
2. Histórico de vetos y de drafts: hoy el árbol de veto se deriva de la fuerza por mapa, que a su vez no
   existe todavía (por lo mismo del punto 1).
3. Demos .dem para CS2 (economía real por ronda) — necesita solicitud aprobada en FACEIT.

---

## Estado: desplegado y estable tras la caída del 16-ago (ver el bloque siguiente).
- `origin/main` = **`117ccb7`** · deploy `dep-da0crhtbedkc73ag12t0` en **live** sirviendo ese commit.
- **Ojo con el `main` LOCAL de una sesión nueva:** el contenedor clona con profundidad 50, así que el `main`
  local puede ser una ventana vieja del histórico y `git merge` responde *"refusing to merge unrelated
  histories"*. No es un conflicto real. La verdad está en `origin/main`: comprobar con
  `git merge-base --is-ancestor origin/main <rama>` y empujar con
  `git push origin <rama>:main`, que es un avance rápido limpio.

### Verificado EN PRODUCCIÓN (no en local)
- MMA, cartelera de UFC 330: las cuatro peleas probadas devuelven `deep.available: true` con el contrato
  nuevo (`sport`, `axes`, `phase_strip`) — **sin regresión**. Endpoint completo entre 419 y 1.374 ms.
- La app real (el `premium.js` que sirve producción, contra la API de producción) pinta **las cinco piezas**
  a 1.280 px y a 390 px, sin desbordes y sin un solo error de JS.
- El caso sin datos también se ve bien: la pelea de boxeo de esta noche muestra el panel de respaldo con su
  motivo, no un hueco.

### ⚠️ EL LÍMITE REAL DE BOXEO NO ES EL MOTOR, ES LA COBERTURA DEL DATASET
Las **tres** peleas de la cartelera de boxeo del 15-ago dan `available:false`, y no es un fallo de
identificadores: de los seis boxeadores, **cinco tienen CERO peleas en `fights-boxing.json`** (Angulo sí:
30 peleas, perfilado sin problema). El motor carga bien (2.767 perfiles, 144 ms). El dataset viene de
Wikipedia y cubre a los conocidos, no las carteleras de club que trae la agenda de The Odds API.
En la propia validación se ve el mismo sesgo: de 12.966 peleas candidatas, 8.667 se descartan porque a uno
de los dos le falta perfil.
**Próximo paso natural para que boxeo rinda: ampliar `fights-boxing.json` hacia BoxRec/prospectos**, no
tocar el motor.

### ✅ Corregido: el aviso de ruta en MMA usaba un umbral único para cuatro escalas distintas
`style.js` marcaba una ruta con *"la pelea probablemente no llegue ahí"* cuando la masa de su fase bajaba de
0,40 — el mismo corte para las cuatro fases. Medido sobre 1.199 cruces reales de la UFC, las fases no viven
en la misma escala ni de lejos (mediana: pie 0,414 · clinch 0,103 · lucha 0,386 · suelo 0,469), así que
**cualquier ruta que fuera por el clinch llevaba el aviso el 100 % de las veces** y a Makhachev le salía con
el suelo al 22 %. Un aviso que no puede no salir no informa. Ahora cada fase se compara contra su propio
percentil 25 y el texto dice lo que el número dice ("pesa poco en esta pelea", no "no llega ahí"). El aviso
pasa de estructural a dispararse en el 10,8 % de las rutas.

### 🔬 El récord truncado de boxeo: investigado, medido y NO corregido a propósito
La mitad de los perfiles de boxeo (1.391 de 2.767) se construyen sobre récords truncados y sus tasas están
sesgadas de forma brutal (−62,9 % de rotura, +145,7 % de fragilidad). **Pero predicen mejor que los
completos** (AUC 0,744 contra 0,685): que solo los conozcamos por sus derrotas contra buenos dice que son el
lado B, y eso acierta. Se probaron dos correcciones y las dos empeoran — el ajuste por calidad del rival
además rompe el nivel (predice 28,8 % donde ocurre 50,3 %). Todo escrito con sus cifras en el encabezado de
`combat-engine/boxing.js`, y la partición por completitud queda vigilada en cada corrida de
`scripts/boxing-validate.js`.

**Lo que sí falta es dato**, y no se puede bajar desde aquí: Wikipedia devuelve 429 a la IP del sandbox con
cualquier ritmo. Comando para correr desde fuera:
`node scripts/combat-boxing-backfill.js --depth=3 --max=4000 --sleep=200` (idempotente, cachea).

## 🚨 CAÍDA DE PRODUCCIÓN DEL 16-ago (05:06 → 09:05 UTC) — resuelta, causa raíz a medias

**Síntoma:** 22 caídas por falta de memoria en bucle, 502 casi continuo durante ~4 horas. El proceso
arrancaba sano en ~150 MB, daba **un único salto a 1,5 GB en menos de un minuto** y moría a los ~215 s.

**Por qué nadie lo vio venir:** ningún despliegue del histórico había vivido más de 1,2 h — la tarde del
15-ago hubo 25 redespliegues seguidos. El primer proceso que corrió una noche entera fue el de las 21:20,
y llegó al pico. **El "no había OOM en 3 días" no probaba nada: el proceso nunca vivía lo suficiente.**

**El error que hizo perder una hora:** subir la instancia a 4 GB **no cambió nada**, porque
`NODE_OPTIONS=--max-old-space-size=1536` estaba fijado a mano en Render. Node se quedaba topado en 1,5 GB
pasara lo que pasara con la RAM del contenedor — los logs de GC lo decían (`1544 MB`) y tardé en mirarlo.

**Lo que restauró el servicio (tres cosas):**
1. `NODE_OPTIONS` → `--max-old-space-size=3072`. **Esto es lo que de verdad levantó la plataforma.**
2. Los tres trabajos de baloncesto (`buildHoopsPicks`, `settleHoopsPicks`, `hoopsPicksCloseline`) dejaron
   de dispararse a la vez a los 200 s del arranque; ahora van encadenados. Pico: 1429 → 912 MB.
3. Un vigía de memoria (`[mem]`) que muestrea el montón cada 5 s y, al cruzar escalones de 250 MB, imprime
   la bitácora de trabajos de los últimos 45 s. **Sin él esto no se resuelve**: el trabajo que revienta
   muere antes de loguear, y tres horas de arqueología de logs no bastaron.

**Estado:** estable. Pico ~912 MB contra un techo de 3072, cero OOM, sitio en 200.

**LO QUE FALTA (no urgente, pero real):** el pico de ~900 MB sigue siendo desproporcionado. El vigía lo
atribuye sobre todo a `hoops:build` (el constructor de picks de baloncesto), con el bloque
`combate:cloudbet` de las tres organizaciones aportando los primeros ~600 MB. **Dos hipótesis mías ya
cayeron por medición**: no es `db.json` (259 MB de disco al 25 %, base en memoria sana) y no es el archivo
de cuotas de combate (pesa 0,2-0,4 MB, medido en producción). Para cerrarlo hacen falta marcas finas
dentro de `buildHoopsPicks` y de `combatCloudbetRefresh`. **Ojo: `buildHoopsPicks` es lógica de baloncesto
y está congelada hasta el domingo 23** — instrumentar sí, reordenar su lógica no.

---

## EL PRINCIPIO QUE GOBIERNA TODO LO QUE SIGUE

Medido por separado en dos deportes, con métodos independientes, y coincidiendo:

**El mercado de GANADOR es donde se pierde dinero. Los mercados DERIVADOS son donde hay señal.**

| | Ganador | Derivado |
|---|---|---|
| **Baloncesto** (backtest al cierre, 911 partidos NBA) | ROI −11,87 % · t = −2,05 | Totales −0,26 % (NBA) · **+2,15 %** (WNBA) |
| **Combate** (monitor en vivo, 66 picks liquidadas) | Familia FIGHT · **CLV −8,34 %** | Familia ROUNDS · **CLV +4,88 %** · 52,2 % acierto |

Corolario que ya está aplicado en los dos motores: **anclarse a lo que funciona y dejar que el modelo mande
solo donde ha demostrado que sabe.** En baloncesto, encogimiento al consenso de mercado. En combate, el
ganador lo fija el Elo y el método/asalto/duración el motor de fases.

---

## 1) BALONCESTO — CERRADO HASTA EL DOMINGO 23

**NO TOCAR LA LÓGICA DE DECISIÓN ANTES DEL 23 DE AGOSTO.** Está corriendo para acumular una semana de
datos. Cambiarla a mitad de la ventana destruye la muestra. Las 4 correcciones acordadas están al principio
de `TODO_NEXT.md` con su evidencia y los comandos a correr ese día.

Se está acumulando solo: movimiento de línea (`sportsbook_quote_history`), partes de bajas con hora
(data-fabric), props con vig y dispersión (`hoopsPropsCapture`, cada 30 min) y picks con veredicto de
compuertas.

**Números clave que no hay que volver a calcular:**
- Backtest al cierre NBA: ROI −7,27 % ± 2,67 (t = −2,72) sobre 1.910 selecciones.
- Las picks prometían 56,5 % de acierto y dieron 43,6 %. En el tramo 67-83 % acertaron el 49,3 %.
- Fadear tampoco gana (−2,69 % NBA): no hay señal invertida, solo ruido pagando margen.
- Props WNBA: vig 6,98 % vs 4,71 % del mercado principal; 1 % de líneas con EV ≥ 2 % vs 9 %.

---

## 2) COMBATE — PRIMERA TANDA HECHA, DOS BLOQUES PENDIENTES

**Hecho y desplegado:** `combat-engine/{phases,style,fightsim,intel}.js` + `scripts/combat-validate.js`.
`/api/combat/fight?deep=1` devuelve ADN, cruce por fase, rutas, fragilidad, método, asalto, duración,
tarjetas e incertidumbre.

**Validación (3.140 peleas, ventana móvil):** ganador Brier 0,276 vs 0,250 de la moneda (peor que una
moneda, 7 de 8 tramos descalibrados) · método dentro de 3 pp en las cuatro categorías. Por eso el ganador
va anclado al Elo.

### ✅ HECHO A — Capa visual de combate (secciones 32-39)
Cinco piezas en `public/premium.js` (`cbDeepField`, `cbDeepDna`, `cbDeepRoutes`, `cbDeepCards`, `cbDeepSim`,
envueltas por `cbDeepSection`) + su CSS al final de `public/premium.css` (bloque `gx-cbf/cbd/cbr/cbs/cbsim`).
Van en el cockpit **después de la lectura y antes de las tablas de referencia**: es lo que la gente viene a
buscar, no un apéndice.

**Sirven para los DOS deportes con el mismo código.** El contrato lo pone el payload
(`deep.axes`, `deep.phases`, `deep.phase_strip`, `matchup.dims`, `routes`, `fragility`, `projection`) y la UI
no tiene ninguna lista de ejes escrita a mano.

Cuatro decisiones de diseño que se tomaron **mirando el render, no en abstracto** (banco de pruebas:
Playwright + el `premium.css` real, 820 px y 390 px):
- **El histograma de asalto de finalización va en su propia escala.** Con "llega al límite" (57 %) como una
  columna más, los doce asaltos que importan (2-5 % cada uno) quedaban aplastados y no se distinguía R2 de
  R9. El total al límite se dice en una línea debajo.
- **La tabla de totales muestra solo las 6 líneas alrededor de la mediana.** Un combate a 12 genera once, y
  "más de 1,5 asaltos al 97 %" no lo cuelga ninguna casa.
- **Un asalto sin dueño se pinta GRIS, no ámbar.** La primera versión marcaba en ámbar todo asalto a menos
  de 8 pp del 50 % y en una pelea pareja salían 10 de 12: un muro ámbar no dice "esto está en el aire".
- **La incertidumbre se publica en cuota, no en "pp".** La parte aleatoria es la desviación de un Bernoulli
  y en cualquier pelea pareja vale ~50 → salía un "±46 pp" que asusta sin informar. Se publica el reparto en
  porcentaje y la parte epistémica en puntos con sus causas, que es lo único que baja con más datos.

### ✅ HECHO B — Motor de boxeo propio (secciones 14-18)
`combat-engine/boxing.js` + `scripts/boxing-validate.js`. Entra por la misma puerta (`intel.js` despacha por
deporte) y el endpoint lo usa con `org=boxing`.

**Lo primero que había que saber, y no era lo que creíamos:** boxeo no estaba "usando el motor de MMA
adaptado" — **no tenía capa profunda en absoluto.** `intel.js` buscaba `espnstats-boxing.json`, ese archivo
NO EXISTE (ESPN no publica estadística de boxeo), `buildProfiles` producía **0 perfiles** y `fightIntel`
devolvía `available:false` para toda pelea de boxeo. Verificado ejecutando el camino que corre hoy en
producción. Ahora produce 2.767 perfiles.

**Lo que el dato de boxeo tiene:** asaltos pactados, asalto y reloj de final, método (KO/TKO/RTD/UD/SD/MD/
PTS/TD), ganador; y por peleador alcance, altura, guardia, nacimiento, récord. **NO hay conteo de golpes.**
El "jab/power split" que pide el blueprint no puede salir de CompuBox porque no tenemos CompuBox: se publica
como un eje de **cuándo se resuelve la pelea**, con su procedencia escrita en el propio payload (`no_data`).

**Validación fuera de muestra — 2.768 peleas desde 2017, ventana móvil por bloques:**

| | Predicho | Real | |
|---|---|---|---|
| **¿Se rompe la pelea?** | 50,5 % | 51,1 % | **AUC 0,694** · Brier 0,221 vs 0,250 · deciles monótonos (24/22 → 82/81) |
| **¿Cuándo?** | asalto 5,11 | 5,30 | corr 0,43 · "antes del 4º" 38,6/34,5 (AUC 0,685) |
| KO | 16,3 % | 17,1 % | |
| TKO | 30,0 % | 29,4 % | |
| Retirada (RTD) | 4,2 % | 4,7 % | |
| Decisión | 47,2 % | 48,9 % | |
| Empate | 2,27 % | 1,77 % | |
| Dividida/mayoritaria | 15,1 % | 17,8 % | de las decisiones |

**⚠️ UNA MEDICIÓN QUE CONTRADICE LO QUE ESPERÁBAMOS.** En MMA el motor de fases salió PEOR que una moneda
para el ganador (Brier 0,276 vs 0,250) y ese fue el argumento del anclaje. **En boxeo no pasa:** Brier
**0,204 vs 0,250**, 67,2 % de acierto, y no es un artefacto del orden (f1 gana el 49,3 % en el archivo).
Se ancla igual, por otras dos razones: (a) el principio medido en dos deportes dice que el mercado de
ganador es donde se pierde dinero, discrimine o no el modelo; (b) 3 de 8 tramos siguen descalibrados
(ECE 3,79 pp) — distingue, pero sus números aún no están para poner precio.
**Si algún día hay histórico de cuotas de boxeo, esta es la primera hipótesis que merece una prueba real.**

**Lo que se DESCARTÓ con su medición:** la guardia (zurdo/diestro). Hay dato para 1.296 de 1.406 peleadores
del índice, pero en peleas desde 2018 **los dos** tienen guardia conocida solo el **19,5 %** de las veces.
Una dimensión que falta en 4 de cada 5 cruces no puede ser una dimensión del cruce: se muestra como dato,
no toca la probabilidad.

**La única constante libre (`KAPPA_FIN = 0,50`) está ajustada contra la tasa real de finalización**, no a
ojo. La primera versión, con los multiplicadores de fatiga y daño apilados sobre el peligro base, predecía
**69,7 % de finalización contra un 51 % real** — el peligro ahora va anclado a la tasa medida de la liga
(0,0527 por lado y asalto) en forma ataque × defensa.

**⚠️ SIN DESPLEGAR.** Todo esto está en la rama `claude/gpsim-combat-visual-boxing-276pin`, no en `main`.
Producción sigue sirviendo `bc5f296`.

## 3) LO QUE NO SE PUEDE MEDIR TODAVÍA (y por qué)
- **ROI retrospectivo de combate**: no hay histórico de cuotas. El CLV del monitor es la única vara.
- **Capa de plantilla en baloncesto**: sin partes de bajas históricos, su ajuste vale cero por construcción
  (es un delta contra el equipo habitual). El fabric empezó a recogerlos el 16-ago.
- **Props de WNBA con muestra**: la captura arrancó el 16-ago. El domingo habrá una semana.

---

## 4) RESTRICCIÓN DE SEGURIDAD QUE PERSISTE
Existe una segunda clave gratuita de The Odds API (`dec73d5d4ccfc5a8e5501b140fe01338`) creada en una cuenta
nueva tras agotar la cuota de la primera. **No debe conectarse ni usarse**: usar una segunda cuenta gratuita
para extender una cuota agotada viola los términos del proveedor. La clave en producción
(`f214ddd251b7f339d3a6802b8b62b745`) es una mejora de pago legítima de 5M créditos y es la correcta.

---

## 5) DATOS ÚTILES DE OPERACIÓN
- `GP_EXPORT_KEY` = `53cada409f32a4686e70dc38c20ae867824aeb1c21abbe4b`
- Token admin para probar endpoints: `scratchpad/gp_token.txt` (cabecera `Authorization: Bearer <tok>`)
- `GP_FABRIC_DIR=/data/fabric` (disco persistente de Render; sin eso el fabric se borra en cada deploy)
- Los endpoints de baloncesto y combate son **admin-only** (404 sin token).
- El sandbox no deja salir a Chromium: para probar UI, servidor estático local en :8099 + Playwright con
  `pg.route('**/api/**')` relayando a producción.
- `node` nativo no honra el proxy: usar `NODE_USE_ENV_PROXY=1` en local (producción no tiene proxy).
