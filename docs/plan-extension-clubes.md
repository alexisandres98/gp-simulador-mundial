# PLAN MAESTRO — Extensión TOTAL Mundial → Clubes/Ligas

> Orden de Alexis (13-jul-2026): "un partido de la liga china debe verse como se ve hoy Argentina vs
> Inglaterra; entrar a un club y ver lo que veo de Argentina; un jugador al nivel de Yamal. Es una
> EXTENSIÓN, no una reconstrucción: en vez de 48 equipos, ~300; la data la tenemos (TSA, API-Football,
> The Odds API, ESPN, FotMob, observer). Si el engine no se extiende, la probabilidad sale errónea:
> los clubes siguen la MISMA lógica, estructura y engines del Mundial."
>
> Este documento es la fuente de verdad del build. Cada ítem tiene su estado. Actualizarlo al cerrar
> cada pieza. Regla de done por superficie: PARIDAD con la equivalente del Mundial (visual + datos +
> engine), gateado por clubsOn() hasta el relanzamiento.

## FUENTES DE DATOS (verificadas 13-jul)

| Fuente | Qué da para clubes | Estado |
|---|---|---|
| TheStatsAPI | matches (scheduled/finished, score reg/ET/pens), **player-stats por partido (xG, npxG, xA, remates, pases, tarjetas, minutos, rating, titular)**, team-stats, roster por equipo (posición, edad, altura, pie, país, valor, contrato), xg_available=true en ligas top | ✔ verificado — 177 finished Brasileirão con xG en la MISMA season sn_* de ratings.json (status=finished; el "0 rows" anterior era query mala) |
| API-Football | **fotos oficiales de jugadores** (players/squads?team=), alineaciones/eventos/stats EN VIVO por fixture, lesiones, árbitro, fixtures por liga (ids AF por liga: BRA 71, MX 262, MLS 253, ARG 128, COL 239, PAR 250, CSL 169, K-League 292, J1 98, EPL 39, LaLiga 140, BUN 78, SerieA 135, L1 61) | ✔ verificado — squad Palmeiras (AF team 121) 35 jugadores con foto |
| The Odds API | h2h+totals por liga (sweep ✔ live), córners/tarjetas (alternate_*), player props (ligas EU/US top) | ✔ h2h/totals ingestando; props sin cablear |
| ESPN | marcadores vivos por liga (✔ live), logos (✔), calendario | ✔ |
| FotMob | shotmaps/event data por liga (primaryId por liga, mismo endpoint del Mundial) | ◻ por verificar ids de liga |
| Google News RSS (observer) | señales de disponibilidad por club | ◻ extender lista de equipos |

## AUDITORÍA COMPARATIVA (pestaña por pestaña, Mundial vs Clubes hoy)

Leyenda: ✔ = paridad · ½ = parcial · ✘ = falta

### 1. PARTIDOS (lista)
| Pieza (Mundial) | Clubes |
|---|---|
| Tabs Todos/Vivo/Próximos/Finalizados | ✔ |
| Marcador en vivo + minuto + FT (30s) | ✔ (ESPN por liga) |
| GP% tri-cell por partido | ✔ (card IDÉNTICA al Mundial: GP PROBABILITY + %, Analyze match; c6e639b) |
| GP% EN VIVO que se mueve con el marcador (gpProbs) | ✔ (F1.2, 363bf59) |
| Señal Value en la fila (WATCH) | ✘ F3.2 (única diferencia con la card del Mundial) |
| Escudos/banderas | ✔ |
| Buscador, selector, intercalado por fecha | ✔ |

### 2. VISTA DE PARTIDO (cockpit) — el corazón
| Pieza (Mundial) | Clubes |
|---|---|
| Hero marcador vivo/final | ✔ |
| Prob 1X2 + Contexto | ✔ tab Context (bajas AF+descanso+forma, 3ae57c5); **ajuste al modelo ✔ (F2.3, a21ee8c — base→contexto→GP tras flag)** |
| Proyección de goles (λ xG, O/U, BTTS, marcadores) | ✔ (engines de la casa; **λ ataque/defensa por liga d595e1a — realista por liga, no ~51% constante**) |
| Momentum GP en vivo (SVG, dots de gol) | ✔ (F1.2, 363bf59) |
| Alineaciones (XI + formación + DT) | ✔ (afc6cff); **XI clickeable al perfil ✔ (dc61d87)**; **eventos en vivo ✔ (2195df8)**; XI en-cancha (pitch) ✘ |
| Panel xG del partido (post-partido, 1T/2T, ocasiones) | ✘ F1.3 (TSA lo da, mismo patrón xg-report) |
| Match Intel (anotadores probables P(gol) por jugador + radar disponibilidad) | ✘ F2.2+F2.3 |
| Hallazgos de inteligencia (observer narrado) | ✔ (F2.3, a21ee8c — tab Context) |
| Perfil táctico (style-engine: vías de peligro, aéreo, hallazgos) | ✘ F2.4 (necesita event data F1.3) |
| Lecturas del sistema (picks del cruce con narrativa) | ✘ F3 |
| Matriz de mercados por casa (cuotas del partido) | ✘ F1.5 (cuotas YA en DB por el sweep) |
| Calculadora de stake | ✘ F1.5 |
| Value del cruce | ✔ |
| Panel Oportunidad (viniendo de arb/lag) | ✔ |
| SEO /pronostico/<slug> | ✘ F4.3 |

### 2b. COCKPIT — MAPA REAL (auditoría navegando el Mundial, 14-jul)
**Estructura**: HECHO (2d4dabe) el cockpit de club ahora usa TABS (Resumen/Goles/Inteligencia/Forma/Mercados/Value). El del Mundial usa TABS (`gx-mv-nav`): **Summary · GP probability · Markets · Context · Recent form · Lineups · Match intel · Goal projection**. El de club son paneles en scroll (GP probability · Goal projection · Markets · Value). Para PARIDAD el cockpit de club debe reestructurarse a esos 8 tabs.
- Summary → ✔ (2d4dabe, tab Resumen)
- GP probability → ½ (club tiene prob base; falta base→CONTEXTO→GP con factores) F1.4
- Markets → ✔ (tab, cuota+casa sin calc)
- Context → ✔ (3ae57c5, bajas+descanso+forma)
- Recent form → ✔ (2d4dabe, tab Forma+H2H)
- Lineups → ✔ (afc6cff, AF por fixture; se activa con partidos)
- Match intel → ½ anotadores probables ✔ (f09deed); disponibilidad ✘ F2.3
- Goal projection → ✔ (tab)
La CALCULADORA de stake va SOLO en las superficies de oportunidad (Value board tabla, Picks cards, Arbitraje/precio-atrasado), NUNCA en el cockpit del partido.

### 3. EQUIPOS
| Pieza (Mundial: /api/teamdetail + tabs) | Clubes |
|---|---|
| Lista con ranking/Elo/prob | ✔ (standings+Elo por liga) |
| Hero de equipo (probs campeón/avance) | ½ (posición/pts/récord; prob de campeón de liga ✘ F4.1 simulador de temporada) |
| Tab Plantilla con FOTOS clickeables | ✔ (tabs + fotos) |
| Tab Forma (últimos 5) | ✔ (6bc4169) |
| Tab Resultados | ✔ (6bc4169) |
| Tab Mercados (Poly/Kalshi campeón) | ✘ F4.1 (mercados de campeón de liga si existen en Poly) |
| Tab Noticias | ✘ F2.3 (observer) |
| Seguir equipo (follow + alertas email inicio/gol) | ✘ F2.5 |

### 4. JUGADORES
| Pieza (Mundial: /api/beta/player nivel Yamal) | Clubes |
|---|---|
| Ficha bio (posición/edad/altura/pie/país/valor/contrato) | ✔ (F2-fase1; el Mundial ni tiene valor de mercado — clubes ya lo supera aquí) |
| FOTO oficial | ✔ (2440 fotos) |
| Stats/90 (xG, xA, remates, minutos) + muestra | ✔ (a644057, con tiles de muestra) |
| Radar percentiles vs posición | ✔ (percentil por stat también) |
| Arquetipo ganado + scout read ES/EN | ✔ |
| % del ataque del equipo, forma | ✔ % ataque; match-by-match ✔ |
| Mercados del jugador (cuotas vs GP) | ✘ F3.4 (props ligas top) |
| Disponibilidad narrada (observer) | ✔ (F2.3, a21ee8c — perfil de jugador) |
| H2H vs próximo rival | ✘ F2.2 |
| Buscador de jugadores | ½ (clubes por equipo; índice global ✘ F2.2) |
| SEO /jugador/<slug> | ✘ F4.3 |

### 4b. PERFIL DE JUGADOR — COMPARACIÓN HONESTA (Musiala Mundial vs Paulinho club, 14-jul)
Tras a644057 el perfil de club tiene: foto+ficha bio (plus del club) · radar+percentiles · tiles de muestra (min/starts/goles/%ataque) · PER-90 con "Top X% of position" por stat · scouting read · MATCH BY MATCH (partido a partido). **A LA PAR** del Mundial en lo cuantitativo.
FALTA vs Mundial (depende de otras fases): GP reading narrada (F2.3 observer/narrativa) · Projected starter + confidence (F1.4 context/alineación) · mercados del jugador cuotas-vs-GP (F3.4 props ligas top) · H2H vs próximo rival · disponibilidad narrada (F2.3).

### 5. PICKS (producto principal)
| Pieza (Mundial: 6 familias + narrativa + track record) | Clubes |
|---|---|
| SOLID/GOALS/COMBO (gate + anclaje mercado) | ✘ F3.1-F3.3 (cuotas ✔ en DB; gates por liga ✔ clubs-gate-1; falta curate multi-liga + BACKTEST por liga — regla dura) |
| CORNERS/CARDS/PLAYER | ✘ F3.4 (necesita props-history por liga) |
| Narrativa multi-factor por pick | ✘ F3.3 |
| Settlement 90' automático | ½ (clubResults reg ✔; falta cablear a settleDailyPicks) F3.3 |
| Track record integrado (etiqueta por liga) | ✘ F3.3 |
| Calculadora en cards | ✔ (genérica, cae sola con las picks) |
| Alertas de picks | ✘ F3.5 |

### 6. VALUE / ARBITRAJE / OPORTUNIDADES
| Pieza | Clubes |
|---|---|
| Value board multi-liga | ✔ (shadow) |
| Value outright (campeón de liga) | ✘ F4.1 |
| Arbitraje/precio atrasado multi-venue | ✔ (navegan al cockpit, escudos) |

### 7. TORNEO / LIGA
| Pieza (Mundial) | Clubes |
|---|---|
| Grupos → Tabla de posiciones por liga | ✔ (en Equipos) |
| Bracket → Liguilla/playoffs (MX, MLS) | ✘ F4.2 |
| Evolución (curva de prob/Elo) | ✘ F0.3 (groundwork snapshots) → F4.2 |
| Simulador de temporada (Monte Carlo: campeón/descenso/playoffs) | ✘ F4.1 |
| Elo DINÁMICO (se actualiza con cada resultado) | ✘✘ **F0.4 — CRÍTICO** (hoy el Elo es el del fit offline; sin update por resultado, las probs derivan → exactamente lo que Alexis señaló) |

### 8. ENGINE / INFRA INVISIBLE
| Pieza (Mundial) | Clubes |
|---|---|
| Contexto (lesiones/descanso/forma) | ½ mostrado (3ae57c5); ajuste de prob ✘ F2.3 |
| Observer (noticias → disponibilidad → λ) | ✔ (F2.3, a21ee8c) |
| Event data (FotMob shotmaps, situaciones) | ✘ F2.4 |
| Momentum sampler | ✘ F1.2 |
| SSE broadcast en cambios | ✔ (clubScoresSync emite update) |
| i18n dic de equipos (ES/EN) | ✔ n/a (nombres de club universales) |

## FASES DE TRABAJO (orden de ejecución)

### F0 — FUNDACIONES DE DATOS (destraba todo; sin esto lo demás es cascarón)
- [x] **F0.1 Backfill player-stats por liga** (Brasileirão 177/8106, MLS en curso; resto corriendo) (`scripts/clubs-player-backfill.js`, patrón player-props-backfill del Mundial): por liga activa, matches status=finished de la season → `/matches/{id}/player-stats` → `data/clubs/player-history-<liga>.json` (jugador-partido: min, titular, goles, remates, SOT, xG, npxG, xA, pases clave, tarjetas). Resumible, throttle 12 req/min. ~177 partidos BRA + MX/MLS/ARG/COL/PAR ≈ 700-900 requests ≈ 1-2h de reloj. Pase incremental diario (post-jornada) en el server.
- [x] **F0.2 Fotos de jugadores** ✔ 2440 fotos (player-photos.json) en el perfil (script listo; correr tras el backfill, comparte rate-limit TSA) (`scripts/gen-club-player-photos.js`, patrón del Mundial): AF `players/squads?team=<af_id>` por club → matchear AF↔TSA por nombre normalizado → mapa `data/clubs/player-photos.json` {pl_* → af_photo_url} + proxy/self-host. Necesita mapa tm_→AF team id por liga (por nombre, una vez, curado a JSON).
- [ ] **F0.3 Snapshots para Evolución**: `db.clubHistory[liga][fecha] = {tm_id: {pos, elo, pts}}` diario (loop server, barato) → alimenta F4.2.
- [x] **F0.4 ELO DINÁMICO por resultado** ✔ prod eb22cc9 (CRÍTICO para probabilidad honesta): al finalizar un partido de club (clubResults status final), actualizar Elo de ambos equipos (K por liga, mismo recomputeElos conceptual del Mundial; goleada/localía como el fit). Persistir en db.clubElos (overlay sobre ratings.json, nunca escribir el archivo) y usar overlay en TODAS las probs (state, match, value, scanner). Re-fit offline mensual recalibra.
- [ ] **F0.5 Fixtures ampliados**: ventana upcoming de 12 → toda la jornada visible + past reciente (para Forma/Resultados).

### F1 — PARTIDO DE CLUB = PARTIDO DEL MUNDIAL (cockpit)
- [½] **F1.1 Alineaciones/eventos/stats en vivo**: alineaciones AF por fixture ✔ (afc6cff); **XI clickeable al perfil ✔ (dc61d87**); **eventos en vivo ✔ (2195df8** — clubAfFixture helper compartido + clubMatchEvents normaliza /fixtures/events al shape del Mundial {minute,type,player,assist,teamName,side}, panel EVENTS en Resumen reusando gx-event-i/evIcon, gated live/final, memo 30s). FALTA: XI en-cancha (pitch clickeable) + stats del partido (posesión/remates AF). Mismo normalizador del Mundial.
- [x] **F1.2 GP% en vivo + Momentum** ✔ prod `363bf59`: prob condicionada al marcador/minuto (liveProbsFromLambdas con los λ del cruce = mismo engine) + sampler momentum (db.clubMomentum, sampleClubMomentum en clubScoresSync 30s, cero llamadas externas) + SVG del cockpit (reusa mvMomentum parametrizado con escudos/nombres de club; default byte-idéntico para el Mundial). gp_live+momentum en /api/clubs/match, gpProbs vivo en /api/clubs/state, clubTriCell usa gpProbs, refreshClubsLive/refreshClubMatchLive (loadClubs era one-shot). QA CDP: Palmeiras 1-0 min60 → GP live 81% (pre 68%), momentum SVG, 0 errores.
- [ ] **F1.3 xG post-partido**: TSA player-stats agregadas → panel "xG del partido" (total/por equipo/remates/ocasiones) — mismo layout del Mundial.
- [ ] **F1.4 Motor de contexto de clubes**: lesiones AF por liga + descanso (días desde último partido, congestión) + forma (últimos 5) → ajuste base→contexto→GP con desglose visible (mismo UI del Mundial).
- [x] **F1.5 Matriz de mercados** ✔ prod (tab "Markets" del cockpit: cuota+casa por resultado, SIN calc). CORRECCIÓN 14-jul: la calc NO va en el cockpit — vive en Value/Picks/Arb (verificado navegando el Mundial: cockpit calc:0, Value calc:4): cuotas del partido por casa (ya en sportsbook_goal_quote_current) → tabla mercados del cockpit + botón calculadora (prob GP prellenada).

### F2 — EQUIPOS Y JUGADORES NIVEL MUNDIAL
- [ ] **F2.1 Vista de equipo completa**: tabs Resumen/Plantilla(fotos)/Forma/Resultados/Noticias; forma y resultados desde finished de TSA + clubResults.
- [x] **F2.2 Jugador nivel Yamal** ✔ prod 33f4d24 (radar+arquetipo+scout+stats/90, Brasileirão; resto con backfill): stats/90 + percentiles vs posición DE LA LIGA (player-history F0.1) + radar SVG + arquetipo + scout read + % del ataque + forma + índice global de jugadores de clubes en el buscador.
- [x] **F2.3 Observer multi-liga** ✔ prod `a21ee8c`: mismo pipeline del Mundial (sources/extract/verify/assess/narrate) por club — Google News por nombre (solo clubes con partido <72h), roster TSA para matchear, señales en db.clubObservations. `clubObserverLambdaFactor` (assessPlayers+suggestTeamFactor con clubsFit.leagueFit, clamp [0.75,1.0]) → **base→contexto→GP** en /api/clubs/match tras el flag GP_OBSERVER_LAMBDA_ENABLED (=Mundial). Narrativa (caja negra) en tab Context + nota base→GP en Resumen + 'Intelligence finding' en el perfil. Endpoint /api/internal/clubs-observer. QA: Mauricio OUT → 0.926 → GP 68%→65%; sweep real trae noticias+señal. FALTA: tab News dedicado (hoy los hallazgos viven en Context/perfil).
- [ ] **F2.4 Style engine / event data**: FotMob por liga (verificar primaryIds) → shotmaps + perfil táctico del cruce.
- [ ] **F2.5 Follow + alertas** de clubes (inicio/gol email — la infra del Mundial es genérica).

### F3 — PICKS DE CLUBES (el producto; TODO gateado por backtest)
- [½] **F3.1 Calibración por liga** — backtest de GOLES ✔ (49c1e0b) + **MODELO ATAQUE/DEFENSA** ✔ (d595e1a). `goalsBacktest` (gate clubs-goals-gate-1: n≥120·cal_err≤0.04·skill≥0.005). Modelo nuevo `clubs-engine/goalsModel.js` (Dixon-Coles ataque/defensa por equipo con shrinkage tau=20, fiteado de results-<liga>.json) reemplaza los λ del Elo en la PROYECCIÓN de goles del cockpit → **realista por liga** (argentina over 33% real→33% modelo, csl 60%→59%, colombia 48%→46%; antes Elo 51% para todo). El 1X2 (gate-approved) y gp_live siguen del Elo. **HALLAZGO FUNDAMENTAL: cal_err de NIVEL arreglado (~0.13→~0.03) pero SKILL de discriminación O/U 2.5 sigue ~0** (ninguna liga llega a skill≥0.005 en 9 ligas con walk-forward+shrinkage — el total de goles es Poisson-ruidoso y el mercado de totales es eficiente, LÍMITE FUNDAMENTAL). **Picks de GOLES siguen BLOQUEADAS** (correcto). Caminos futuros para edge: player goal props (modelo distinto, más tratable) o picks por divergencia vs mercado en vivo (no backtesteable offline). SOLID (1X2 anclado): colombia approved en-temporada.
- [ ] **F3.2 Señal value en fila de Partidos** + value engine formal por liga (evaluaciones persistidas, no memo).
- [ ] **F3.3 Curate multi-liga**: SOLID/GOALS/COMBO solo ligas gate approved + anclaje al mercado (mismas reglas del Mundial); narrativa; settlement reg90 desde clubResults + TSA; track record con etiqueta de liga; board integrado.
- [ ] **F3.4 Props de clubes**: córners/tarjetas (AF stats por fixture → props-history por liga → NB por liga → backtest → gate) + player props (The Odds API ligas top).
- [ ] **F3.5 Alertas de picks** por liga.

### F4 — TORNEO / PLATAFORMA / CRECIMIENTO
- [ ] **F4.1 Simulador de temporada**: Monte Carlo de la liga (fixtures restantes + Elo dinámico) → prob campeón/top4/descenso por equipo → hero de equipo + value outright de liga (Polymarket tiene mercados de campeón de ligas top).
- [ ] **F4.2 Bracket/liguilla (MX/MLS) + Evolución por liga** (con F0.3/F0.4 acumulando).
- [ ] **F4.3 SEO clubes**: /pronostico/<slug> por partido de liga + /jugador/<slug> de clubes + sitemap (el activo compuesto post-Mundial).
- [ ] **F4.4 Simulador H2H custom** entre clubes (ya existe cross-liga en /api/clubs/match — pulir UI en pestaña Simulador).

## REGLAS DEL BUILD (no negociables)
1. Todo detrás de clubsOn() (admin + GP_CLUBS_SHADOW_ENABLED) hasta el relanzamiento; byte-idéntico para el resto.
2. NADA de picks de clubes sin gate approved por liga + backtest del cambio (regla dura de la casa).
3. Caja negra en todo lo público (jamás Elo/Monte Carlo en textos).
4. Presupuesto de APIs: TSA 12 req/min (backfills resumibles con throttle), AF plan Pro (lesiones/fixtures por liga solo ligas activas), The Odds API guard 2000 créditos.
5. QA por pieza: CDP desktop+móvil (Emulation 390) + cero errores de consola ANTES de deploy. Deploy: verificar commit del deploy en la respuesta de Render.
6. Los engines NO se bifurcan: parametrizar por competición (el goal engine, prop engine, observer, player-intel son los MISMOS módulos con datos de la liga).
