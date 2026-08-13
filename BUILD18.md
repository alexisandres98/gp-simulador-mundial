# BUILD18 — estado de obra (18 puntos BetHero → GP) · iniciado 13-ago

> Tracker vivo de la construcción. Actualizar el estado de cada punto al completarlo.
> Regla: cada lote se commitea + deploya + verifica antes del siguiente. La auditoría (17) corre al final.

| # | Punto | Estado | Notas |
|---|-------|--------|-------|
| 1 | Dropping Odds fútbol (vista propia, Sharp) | PENDIENTE | SQL sobre sportsbook_goal_quote_current: sharp 45min vs 2-8h, retail rezagado; memo 5min; db.clubsQuoteEvents para nombres |
| 2 | Bet Checker (Pro+) | PENDIENTE | Partido del feed + mercado + línea + cuota del usuario → fair de-vig + veredicto + mejor cuota |
| 3 | Línea de sharps en Value | PENDIENTE | Per-book odds en filas de value (query aparte), marcar sharps (pinnacle/cloudbet/exchanges) + cuota justa |
| 4 | Cartera: calendario P&L + por casa/deporte | PENDIENTE | Extender My Bets (Sharp); myBetsStats ya existe |
| 5 | Middles (Sharp) | PENDIENTE | Scan totals/corners/cards cross-book lados opuestos con gap de línea ≥1 |
| 6 | En Vivo (alcance honesto) | PENDIENTE | Tab live en value/dropping con cuotas is_live del sweep + disclaimer de latencia |
| 7 | Onboarding bankroll + nivel | PENDIENTE | Multi-paso: bankroll (alimenta Kelly/stake calc) + nivel (ajusta explicación); guardar en user |
| 8 | Tour guiado primera pick | PENDIENTE | Coach-marks sobre pick card: edge → porqué → track |
| 9 | Controles live del board | PENDIENTE | play/pausa refresh, "viendo X de Y", badge de actualizaciones |
| 10 | Anatomía card +EV | PENDIENTE | EV%, cuota justa, vig, prob, stake Kelly, casas disponibles (N) — layout tipo BetHero |
| 11 | Ocultar/descartar picks | PENDIENTE | Ojo en card → localStorage + filtro "ocultas (n)" |
| 12 | Chips sort/filtro con badges | PENDIENTE | Consistencia en todas las superficies |
| 13 | Calculadoras ES (SEO) | PENDIENTE | /calculadoras/: kelly, valor-esperado, arbitraje, no-vig, cuota-implicita, clv, poisson, combinada. Estáticas vanilla |
| 14 | Páginas de cuotas por evento (SEO) | PENDIENTE | /cuotas/<liga>/<slug> server-rendered del feed, indexable |
| 15 | Guías/blog (SEO) | PENDIENTE | 3-4 guías estáticas: value betting, kelly, CLV, cómo leer una pick GP |
| 16 | Alertas por usuario | PENDIENTE | alertPrefs.events += edge_strong con umbral + ligas/equipos seguidos → email en ciclo 15min |
| 17 | AUDITORÍA completa | PENDIENTE | node --check todo, smoke endpoints, asplan x3, flujos, prod |
| 18 | Landing nueva | PENDIENTE | Blueprint Parte 3 BETHERO_PLAN.md. LECCIÓN v4 (commit d37d171): estático-primero con data real congelada en el HTML, hidratación en el mismo layout sin flash, cero cuadros vacíos, ?live=1 para modo dinámico |

## Decisiones de alcance
- Dropping/Middles/Live = Sharp (consistente con value/arb). Bet Checker = Pro+. Calculadoras/cuotas/guías = públicas (SEO).
- SHARP_BOOKS = pinnacle, cloudbet, betfair_ex_*, polymarket, kalshi (los que existan en quotes).
- Nada de promesas de ganancia en ningún copy nuevo.
- Cifras de landing: congeladas de la DB real al construir + hidratación viva.
