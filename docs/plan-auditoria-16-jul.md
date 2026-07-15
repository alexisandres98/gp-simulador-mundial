# AUDITORÍA 16-JUL — Plan de trabajo (pre-lanzamiento clubes)

> Origen: reporte de Alexis (cockpit del board roto para clubes, gaps Mundial→clubes, track privado
> incompleto, navegación no natural) + auditoría con navegador. Objetivo: **naturalidad total** —
> 0 parpadeo, 0 "cargando" eterno, back siempre vuelve a donde estabas — antes del lanzamiento público
> de clubes. Cada ítem se cierra con QA CDP (desktop+móvil) comparando con el Mundial.

## ✔ YA ARREGLADO (16-jul, prod `5eaa930`)
- **Cockpit del board con picks de clubes iba por el path del Mundial**: "Cargando..." eterno,
  header "Copa Mundial de la FIFA 2026" en un Botafogo–Santos, "Abrir cockpit completo" vacío
  (navegaba a `teams-tm_...`). Fix: picks con `club_eid` construyen la entrada de CLUB en
  `cockpitMatches` → `cockpitCompactClub` + cockpit `cl-` completo.

## P0 — NAVEGACIÓN NATURAL (la queja central; 1 pasada, ~1 sesión)
1. **`S.returnTo` universal.** Hoy `closeMatch()` solo recuerda matches/sim; abrir un partido desde
   Oportunidades/Value/Picks y dar atrás te manda a Partidos (clubes, por el fallback `cl-`→matches)
   o al board. Fix: al abrir CUALQUIER detalle (match, cteam, cplayer, team, player) guardar la vista
   ACTUAL (`S.view` completo con su hash) y volver SIEMPRE ahí. Aplica a `openMatch`, `openClubTeam`,
   `openClubPlayer`, `openTeam`, `openPlayer` y sus back (`closeMatch`/`bindBack`).
2. **Cadena de detalle → detalle.** Cockpit → jugador → atrás debe volver al cockpit (hoy `cplayer`
   no guarda origen). Stack simple de 1 nivel (returnTo del que abre) alcanza.
3. **Back del navegador = back in-app.** Verificar que el botón atrás del navegador y el de la UI
   hagan lo mismo en: board→cockpit club, groups(liga)→cteam, bracket(liga)→cteam, perf→pick→cockpit.
4. **Sub-pestañas que se resetean.** El selector de competición (`S.mComp/gComp/bComp/tComp`) y las
   sub-pestañas (oppSub picks/value/arb; tabs de equipo) persisten en memoria pero NO en el hash →
   recarga/atrás las pierde. Decisión: codificarlas en el hash (p.ej. `#groups/mls`, `#matches/live`)
   para restore honesto. Mínimo: groups/bracket/matches con liga en el hash.
5. **0 pestañeo**: pasada anti-flicker — toda vista que re-renderiza al llegar data async debe
   comparar JSON antes de repintar (patrón refreshClubsLive) — auditar renderGroups/renderBracket/
   renderPerf/cockpit (hoy repintan aunque nada cambió).

## P1 — PARIDAD COCKPIT CLUB = MUNDIAL (los 4 gaps de Alexis)
1. **Lecturas del sistema** (pickReads): el cockpit del Mundial muestra las picks activas del cruce
   con su narrativa; el de club no. Ya hay picks de clubes con why → filtrar `S.dailyPicks` por
   `club_eid` del cruce y reusar el MISMO panel (sec 'lecturas').
2. **Match intel completo (mvIntel)**: el club usa `clubIntelHtml` (solo anotadores P(gol)); el
   Mundial rinde mvIntel con capa de observación por jugador (chips OUT/DOUBT, titular proyectado,
   confianza). El backend ya tiene todo (clubObserver + projectTeam + clubPlayerAvail) → construir el
   payload `match_intel` de club con el MISMO shape que consume mvIntel y borrar la variante
   clubIntelHtml (regla extensión-no-reconstrucción).
3. **Alineaciones antes del XI oficial**: el Mundial muestra XI PROYECTADO (probable) hasta que sale
   el oficial; el club muestra la sección solo cuando AF publica (≈40-60 min antes) → hasta entonces
   parece "faltar". Fix: XI proyectado de `projectTeam` (titularidades del player-history) con la
   MISMA cancha, badge "proyectado", y swap al oficial cuando llegue.
4. **Perfil táctico**: cubierto (BRA/MLS/ARG/KLEAGUE con corpus FotMob en prod). Falta: fuente para
   CSL (FotMob sin shotmaps ahí) y primaryId real de J1; colombia sin fixtures FotMob. Cron/pasada
   post-jornada del backfill FotMob + upload (hoy manual).
5. **Barrido fino restante** (comparar lado a lado navegando): panel Oportunidad al venir de
   arb/lag, calculadora de stake en cards de picks de clubes, SEO /pronostico para clubes (F4.3),
   chips de señal en fila de Partidos (F3.2).

## P2 — TRACK RECORD PRIVADO DE CLUBES = TABLA OFICIAL (para el análisis de la semana)
Hoy: KPIs + desglose liga/familia/gate + historial simple. La tabla oficial tiene además:
- **CLV + línea de cierre** por pick (captureDailyPicksClosing + goal_value_shadow) → extender la
  captura a eventos de clubes (las quotes ya van a las mismas tablas) y calcular CLV de cada pick.
- **Quant** (dailyPicksQuant): brier/calibración por familia, edge realizado vs esperado, ROI por
  tramo de cuota, racha — misma función parametrizada con db.clubDailyPicks.
- **Columnas por pick**: model_prob vs market_prob al crear, odds/book, edge_pp, confidence,
  gate_status, narrativa why, resultado, settled_at — el registro ya las guarda; exponerlas en la
  UI privada con el MISMO layout/columnas de la tabla oficial (reusar el componente, no variante).
- **Export CSV/JSON** del histórico privado para análisis externo.

## P3 — OPERACIÓN / DATA
1. **⚠️ Cuota The Odds API agotada (20k/20k)** → sweeps congelados (Mundial + clubes). Decisión de
   Alexis: upgrade de plan vs esperar reset. Al volver: córners/tarjetas de clubes fluyen (gate ya
   APPROVED en las 8 ligas en temporada).
2. **Pasadas automáticas post-jornada** (hoy manuales): props-history (AF), FotMob, player-history,
   results — un cron diario del server (o script + launchd local) que corre backfills incrementales
   y sube al disco. Sin esto, settlement de CORNERS/CARDS depende del fallback AF y el tactical/xG
   envejecen.
3. **ligamx**: arranca ~17-jul → correr TODOS los backfills (ratings ya está) + af-team-map.
4. **J1 FotMob primaryId** (8965/944/9081 están mal) + fuente alternativa CSL.
5. **git housekeeping**: .git local 114MB (git-filter-repo algún día); dev/prod comparten key de
   The Odds API (separar cuando haya plan pago).

## QA DE CIERRE (cada P0/P1 antes de deploy)
Matriz de flujos: board→cockpit(club/mundial)→jugador→atrás×2 · matches(liga)→cockpit→atrás ·
groups(liga)→cteam→atrás · perf→historial→cockpit→atrás · recarga en cada vista con hash → restaura
sub-estado · móvil 375 sin overflow · 0 errores consola · 0 re-render visible sin cambio de data.
