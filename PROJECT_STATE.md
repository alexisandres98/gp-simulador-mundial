# PROJECT_STATE.md — GP Simulador

Última actualización: checkpoint tras Fase 5 del rediseño UI. Producción viva en https://gpsimulador.com con ~340 usuarios.

## Arquitectura (resumen)
```
Navegador (public/index.html + app.js + style.css, vanilla JS)
        │  fetch /api/*  + SSE /api/stream (fallback polling /api/version)
        ▼
server.js (Node http, sin deps) ── engine.js (Elo→Poisson→MonteCarlo)
        │                         ── mailer.js (Resend / GAS relay / SMTP)
        │                         ── data/tournament.js + fixtures-real.json
        ▼
db.json  (DB_FILE=/data/db.json en prod, disco persistente Render)
        ▲
Fuentes externas:  ESPN scoreboard (marcadores), Polymarket gamma + Kalshi (mercados)
```

## Archivos principales
| Archivo | Para qué |
|---|---|
| `server.js` (~950 ln) | Servidor HTTP, todos los endpoints, auth por email, sync ESPN cada 2 min, fetch de mercados cada 5 min, alertas, Monte Carlo cacheado, persistencia db.json, sirve estáticos. |
| `engine.js` (~299 ln) | Modelo: `simulateTournament`, `matchProbs`, `liveMatchProbs`, `eloUpdate`, `explainTeam`, `effElo`, `assignThirds`, `cmpRows`. Constantes del modelo. |
| `mailer.js` | Envío de email: Resend (HTTPS) → fallback relay Google Apps Script → fallback SMTP. `sendMail`, `isConfigured`. |
| `data-providers/` (Fase 4) | Capa de datos contextuales server-side. `apiFootballProvider.js` (principal, key por env), `espnProvider.js` (fallback), `manualProvider.js` (lee `data/manual/*.json`), `cache.js` (TTL en memoria), `normalizer.js` (raw→Normalized*), `gpTake.js` (`generateGPTake` determinístico), `index.js` (orquestador `getMatchContext`/`getTeamContext` con prioridad API-Football→ESPN→manual). La UI nunca los llama directo. |
| `esports-engine/` (16-ago) | **Quinto deporte, admin-only.** `core.js` (lo compartido: sin margen, consenso, `marketAnchor`, simulación de serie, ventaja y NO PICK, incertidumbre), y **un motor por juego que no se conoce con los de al lado**: `cs2.js` (veto de mapas, rondas con arrastre económico, prórroga MR3), `lol.js` (ritmo de liga → duración → kills, draft y lado, objetivos), `valorant.js` (veto con profundidad de agentes, asimetría ataque/defensa por mapa, prórroga por parejas), `dota2.js` (draft de 24 fases, duración de cola larga, reversión por aegis/buyback). `store.js` despacha, cachea, valora cada línea abierta y guarda el cierre de mercado. |
| `data-providers/esports/cloudbet.js` | Única fuente viva de esports. Agenda, mercados normalizados a la taxonomía de GP e ids propios estables. Documenta lo que esta fuente **no** da: resultados. |
| `darts-engine/` (6-sep, blueprint 8.0) | **Noveno deporte, admin-only.** `rules.js` (reglamento 501 como código: alfabeto de 63 resultados, bust con vuelta al inicio de la visita, double-in/out, checkouts por enumeración, catálogo de formatos por torneo/ronda), `kernel.js` (kernel por dardo regional con política de cierre resuelta por programación dinámica; calibración de precisión al triple, arrastre y dobles a media/180s/% dobles; distribución exacta de visitas, 180s y checkout de un jugador solo ante el 501), `compiler.js` (carrera del leg P(A gana|A sale)=ΣP(T_A=k)P(T_B≥k) con 180s y checkout conjuntos; compilador de legs/sets con saque alterno, dos de diferencia y muerte súbita → ganador, total/hándicap de legs, marcador exacto, 180s total/most/jugador, checkout máximo), `data.js` (base propia 2023→hoy + Elo cronológico + vector de habilidad), `store.js` (agenda PDC, mercado de cuatro casas, tesis con puertas, sombra con cierres y CLV, fichas, ranking, cuadro de torneo con probabilidades de título, simulador, vivo). |
| `data-providers/darts/` | `pdc.js` (API pública de la PDC: torneos con formato por ronda, fixtures con legs, participantes, rankings), `orakel.js` (Darts Orakel: media/180s/dobles por ventana y partidos del PC), `books.js` (Pinnacle deporte 10 · Bovada · Polymarket · Kalshi · Cloudbet, normalizados a familias GP), `flashscore.js` (legs en vivo, display). Cosecha: `scripts/darts-harvest.js`; validación: `scripts/darts-fit.js`; humo: `scripts/smoke/darts-smoke.js`. Derechos: `data/darts/RIGHTS.md`. |
| `data/manual/*.json` (Fase 4) | Editable a mano: `team_notes`, `key_players`, `manual_injuries`, `projected_lineups`, `tactical_notes`, `squad_notes`, `team_form_cache`, `apifootball_ids` (semilla de IDs). |
| `data/tournament.js` | TEAMS (48, con elo/grupo/flag/host/aliases), GROUPS, GROUP_FIXTURES (desde fixtures-real.json), KNOCKOUT (estructura oficial R32→FINAL con slots W/R/T3/M/L). |
| `data/fixtures-real.json` | 72 partidos de grupos reales (de ESPN, auditados) con espnId, datetime, matchday. |
| `build-fixtures.js` | Genera fixtures-real.json desde espn-schedule.json (script de mantenimiento). |
| `public/index.html` | Shell: header, market tape, main con secciones `#tab-*`, bottom nav, avatar menu, sheet, modal login. |
| `public/app.js` (~1132 ln) | Toda la UI: render de cada pestaña, navegación (switchTab), auth, ticker, alertas, GP Take, etc. |
| `public/style.css` (~645 ln) | Design system completo (ver DESIGN_SYSTEM.md). |
| `public/lab.html` | Prototipo de diseño aislado (no es la app real; base del rediseño aprobado). |
| `public/ig/*.png`, `public/designs/*` | Contenido de redes y mockups de diseño. |

## Endpoints (server.js)
- `GET /api/state` — sin sesión: teaser (top-6); con sesión: estado completo (teams+sim, standings, fixtures, knockout, history, sync). Marca `lastSeen`.
- `GET /api/ticker` — **público**: top mercados Polymarket para el tape.
- `GET /api/version` — ligero: {sim, markets, users} para polling.
- `GET /api/team/:id` — detalle equipo (modal legacy, requiere sesión).
- `GET /api/match/:id` — **(Fase 4, requiere sesión)** NormalizedMatchDetail: hero, modelo 1X2, marketPrices, gpTake, marketAngles, events, statistics, lineups, recentForm, injuries, news, odds, providerStatus. Fusiona modelo/mercados existentes + capa `data-providers/`.
- `GET /api/teamdetail/:id` — **(Fase 4, requiere sesión)** NormalizedTeamDetail: probs del modelo, Model Read, samples/counts, marketPrices (campeón), squad/keyPlayers/projectedLineup, recentForm, results/schedule, injuries/news, providerStatus.
- `GET /api/arbitrage` — (requiere sesión) rows de campeón modelo-vs-mercado con edges, `matches` (mercados por partido 1X2), snapshots, disclaimer. Captura "closing line" de mercado por partido.
- `GET /api/aciertos` — **público**: track record (winners, exact, brier, avgProbActual, vsMarket scoreboard, matches con prob pre-partido).
- `POST /api/auth/request` {email} — genera código 6 díg, lo envía por email (Resend). Rate limit 3/10min, dedup <90s. Sin SMTP → modo demo devuelve `demoCode`.
- `POST /api/auth/verify` {email, code, ref} — crea usuario si no existe (guarda `ref` de atribución), devuelve token+favorites+alerts.
- `GET /api/me` — usuario actual (incluye favorites, alerts, alertPrefs).
- `POST /api/favorite` {teamId} — seguir/dejar de seguir (toggle); activa alertas al seguir el primero.
- `POST /api/alerts` {enabled} — master on/off (legacy).
- `POST /api/alertprefs` {events, channels} — merge de preferencias de alertas.
- `POST /api/mute` {teamId} — silenciar/reactivar alertas de un equipo.
- `POST /api/admin/result` — (admin) registrar/corregir/eliminar resultado; recalcula Elo+sims, dispara alertas.
- `POST /api/admin/refresh-markets` — (admin) forzar fetch de mercados.
- `GET /api/admin/users` — (admin) base de usuarios + atribución por fuente + (UI tiene export CSV).
- `GET /api/esports/overview` — **(admin)** panorama de los cuatro juegos: agenda, ligas, cierres guardados, estado del rating y por qué está vacío.
- `GET /api/esports/board?game=` — **(admin)** pizarra de un juego: probabilidad anclada, mercados abiertos y ventajas por partida.
- `GET /api/esports/match?game=&id=` — **(admin)** centro de inteligencia de una partida, con el bloque propio de cada juego.
- `GET /api/esports/model?game=` — **(admin)** ficha del motor: qué tiene de propio, qué familias cotiza, dónde aporta, estado del rating.
- `POST /api/esports/snapshot?game=` — **(admin)** fuerza el guardado del cierre de mercado.
- `GET /api/darts/{board,agenda,match?id,live?id&legs_a&legs_b,players?q,player?id,ranking,tournaments,tournament?id,sim?a&b&format,track,model,brief,read?id,search?q}` — **(admin; `GP_DARTS_PUBLIC_ENABLED` abre)** contrato completo en `docs/impl/DARTS_API_CONTRACT.md`. `sim/read/brief/track` son Pro; las tesis viajan dentro de `board`/`match`. Sonda: `/api/internal/darts?key=[&odds=1&rec=1&settle=1]`.
- `GET /api/stream` — SSE (eventos: hello, update, markets). Padding 2KB + heartbeat 25s para túneles/proxies.

## El modelo (engine.js) — constantes clave
- `HOME_BONUS = 75` (anfitriones MEX/USA/CAN, +75 Elo efectivo).
- `TOTAL_GOALS = 2.6` (media de goles partido parejo).
- `K_WC = 60` (factor K eloratings para actualizar Elo con resultados).
- `ELO_NOISE = 55` (ruido por torneo simulado).
- `GOAL_FLOOR = 0.45` (piso de goles del equipo débil — calibrado vs ArbBets, anti-sobreconfianza).
- `DC_RHO = -0.13` (Dixon-Coles: infla empates 0-0/1-1; aplicado en matchProbs/liveMatchProbs, NO en el sampling Monte Carlo).
- Elo base de eloratings.net (8-jun-2026). Elos se recomputan desde base replicando todos los resultados finales.
- **Recalibraciones hechas:** piso 0.45 + Dixon-Coles bajaron el Brier 0.791→0.769→~0.74 (mejora real medida).
- **Sobreconfianza de torneo CONOCIDA y NO corregida (decisión):** el % de campeón es más concentrado que Opta/mercados (España nos daba ~27% vs ~16% de Opta/Polymarket). Causa: poca varianza por torneo (ELO_NOISE bajo) → favoritos ganan demasiado seguido (se eleva a la ^7). Probado que subir ELO_NOISE a ~150 acerca a Opta, PERO el usuario decidió NO copiar a Opta y dejarlo; el % de campeón no es validable este torneo (n=1). El marcador objetivo real es el Brier por partido y "modelo vs mercado".

## Lógica de recomendaciones (importante, ya corregida)
- **GP Take por partido** y oportunidades: solo se recomienda respaldar un resultado con **prob. modelo ≥ 30%** (MIN_BACK; nunca longshots).
- **Nunca recomendar "COMPRAR NO" contra el favorito del modelo** (no apostar contra tu propio pronóstico). Solo: respaldar lo infravalorado (SÍ) o ir contra lo sobrevalorado que NO sea el favorito (NO).
- Grados GP Take: STRONG ≥10% edge, LEAN ≥6%, SLIGHT ≥3.5%, si no → PASS (con razón honesta).

## Pantallas (pestañas) y estado
Logged-in nav (bottom en móvil): Oportunidades · Partidos · Equipos · Grupos · Más. "Más" + avatar menu: Seguidos, Alertas, Bracket, Aciertos, Evolución, Admin (si aplica), Cuenta, Salir. Logged-out: top sub-nav simplificado (Equipos, Grupos, Partidos, Bracket, Oportunidades) + locked states.

| Pantalla (tab id) | Estado | Notas |
|---|---|---|
| Oportunidades (`arb`) — HOME logged-in | ✅ Rediseñada (Fase 2) | Mejor oportunidad destacada (signal/métricas/riesgo/confianza), Arbitraje puro, Apuestas de valor, Partidos·GP Take, Favoritos del modelo, tabla 48 colapsable. |
| Partidos (`matches`) | ✅ Funcional + cada partido abre la Match Detail Page | Calendario con matchCard (pbar 1X2). Las tarjetas ahora navegan a `#tab-match`. |
| Equipos (`teams`) | ✅ Cards + teaser hero; cada equipo abre la Team Detail Page | El modal `openTeam` se reemplazó por `openTeamPage` (Fase 4), con tabs Resumen/Plantilla/Forma/Resultados/Mercados/Noticias. |
| Partido (`match`, Fase 4) | ✅ Nueva | Match Detail Page: hero, GP Take, ángulos, eventos/stats, alineaciones, forma, modelo·mercado·cuotas, lesiones/noticias. Datos de `/api/match/:id`. |
| Equipo (`team`, Fase 4) | ✅ Nueva | Team Detail Page: hero+Seguir, resumen del modelo (Model Read + probs + caminos simulados), plantilla/jugadores clave/XI probable, forma, resultados, mercados, noticias. Datos de `/api/teamdetail/:id`. |
| Grupos (`groups`) | ✅ Rediseñada (Fase 5) | Chips A-L + tabla heatmap. |
| Seguidos (`following`) | ✅ Rediseñada (Fase 3) | Tarjetas con campana por equipo + cambio de mercado. |
| Alertas (`alerts`) | ✅ Nueva (Fase 3) | Eventos + canales (Telegram/Push = "próximamente"). |
| Bracket (`bracket`) | ✅ Rediseñada (Fase 5) | Cuadro escalonado + trofeo en final. |
| Aciertos (`record`) | ✅ Rediseñada (Fase 5) | Stats + Brier público + texto contextual + lista sobria. Público pero bloqueado para no registrados. |
| Evolución (`evo`) | ✅ Rediseñada (Fase 5) | Chart dark + filtros (Top10/Mis seguidos) + tabla. |
| Admin (`admin`) | ✅ Funcional | Registrar resultados (corrección manual) + base de usuarios + export CSV. Oculto a no-admin. |
| Dardos (`dtopps`, `dtgames`, `dtmatch/<id>`, `dtplayers`, `dtplayer/<id>`, `dtrank`, `dttours`, `dttour/<id>`, `dtsim`, `dtperf`, `dtbrief`, `dtask`, `dtmodel`) — terminal `/x`, admin-only | ✅ Nueva (6-sep) | Oportunidades con la card de la casa (todo en sombra), calendario PDC con vivo, panel del partido con tres lentes (el partido: salir/romper, distribución de legs y margen, marcador exacto, 180 Loom, escalera de checkout, Format Prism; la diana: diana SVG con los dobles esperados, Scoring DNA, checkout y visitas del kernel; contexto: prensa, h2h, forma, mercado, registro de invalidación), jugadores y fichas, ranking GP, torneos con cuadro y probabilidades de título, simulador con leg de muestra, sombra, brief, Pregúntale a GP, motor. |

## Alertas por email (cómo funciona)
- Al finalizar un partido (sync ESPN o admin), `dispatchPendingAlerts`→`sendTeamAlerts` envía email a quienes siguen alguno de los dos equipos.
- Respeta: `user.alerts !== false`, `alertPrefs.events.result !== false`, `alertPrefs.channels.email !== false`, equipo no en `mutedTeams`.
- Dedup por `db.sentAlerts[matchId]`. Al arrancar, `markExistingFinalsSeen()` marca finales históricos como vistos (no spamear).
- Telegram/Push: solo UI, sin backend (estructura lista).

## Negocio / producto (decisiones)
- **Visión:** capturar máx. usuarios gratis durante el Mundial → convertir a plataforma de pago post-Mundial (suscripción ~$19-49/mes; mercado valida $59-199/mes en competidores). Expandir a más deportes/mercados (NFL en septiembre = timing ideal; las APIs de cuotas son multideporte con una sola suscripción; las de stats son por deporte).
- **Foso:** modelo propio + transparencia (track record honesto con Brier) + arbitraje prediction-markets + español + potencial on-chain. Nadie combina las 4.
- **Login obligatorio** para casi todo (teaser top-6 sin registro) → fuerza captura de email.
- **Competidores estudiados:** ACE (acebets.io, sportsbooks +EV, GP Take se inspira en su "ACE Take"), ArbBets/getarbitragebets (arbitraje prediction markets, $59/mes, simulador gratis idéntico), Opta/theanalyst (supercomputer, benchmark de calibración), PolyArbiter (arb on-chain Solana).
- Costo mensual actual ≈ $28 (Render $7 + Resend $20 + dominio ~$1).
- Atribución de fuente activa: links `?ref=x / ig / wa / share` → `user.ref`, visible en Admin.
- Track record en vivo: ~5/13 ganador directo al checkpoint; Brier mejorando. "Modelo vs Mercado" acumulando (empezó tarde, sin histórico de closing lines).
