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
