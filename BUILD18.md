# BUILD18 — estado de obra (18 puntos BetHero → GP) · iniciado 13-ago

> Tracker vivo de la construcción. Actualizar el estado de cada punto al completarlo.
> Regla: cada lote se commitea + deploya + verifica antes del siguiente. La auditoría (17) corre al final.

| # | Punto | Estado | Notas |
|---|-------|--------|-------|
| 1 | Dropping Odds fútbol (vista propia, Sharp) | HECHO | /api/clubs/dropping (pre+live, Sharp) + board con tabs |
| 2 | Bet Checker (Pro+) | HECHO | /api/clubs/betcheck (Pro+) + vista betcheck |
| 3 | Línea de sharps en Value | HECHO | fair_odds/vig/books_detail en value + chips .gx-val-line |
| 4 | Cartera: calendario P&L + por casa/deporte | HECHO | calendario P&L + desglose por casa/familia en Mi cartera |
| 5 | Middles (Sharp) | HECHO | /api/clubs/middles (Sharp) + board |
| 6 | En Vivo (alcance honesto) | HECHO | cubierto por el tab en-vivo de dropping (?live=1) + disclaimer |
| 7 | Onboarding bankroll + nivel | HECHO | onboarding con bankroll+moneda+nivel → /api/me/setup |
| 8 | Tour guiado primera pick | HECHO | tour de 3 pasos sobre la primera pick (gp_tour_done) |
| 9 | Controles live del board | HECHO | feedbar: refresh/pausa, "viendo X de Y", badge de nuevas |
| 10 | Anatomía card +EV | HECHO | card con cuota justa, vig, books y edge (fairLine) |
| 11 | Ocultar/descartar picks | HECHO | ojo en card → localStorage + chip "ocultas (n)" |
| 12 | Chips sort/filtro con badges | HECHO | chips compartidos (feedbar + subs de board) en todas las superficies |
| 13 | Calculadoras ES (SEO) | HECHO | /calculadoras: 8 calculadoras ES estáticas + índice |
| 14 | Páginas de cuotas por evento (SEO) | HECHO | /cuotas SSR (índice + /cuotas/e/<id> con cuota justa de-vig) |
| 15 | Guías/blog (SEO) | HECHO | /guias: value betting, kelly/bankroll, CLV + índice |
| 16 | Alertas por usuario | HECHO | umbral value_min_pp (5/8/12) + sweep 15min con cap 3/día y dedup |
| 17 | AUDITORÍA completa | HECHO | node --check, smoke prod de endpoints nuevos, gating asplan x3, regresión de flujos, logs limpios |
| 18 | Landing nueva | HECHO | hero nuevo + 6 pilares + mini-demos reales + 3 pasos + cobertura + track honesto (505/253/252) + pricing + FAQ + footer SEO. Estático-primero, cifras congeladas 13-ago |

## Decisiones de alcance
- Dropping/Middles/Live = Sharp (consistente con value/arb). Bet Checker = Pro+. Calculadoras/cuotas/guías = públicas (SEO).
- SHARP_BOOKS = pinnacle, cloudbet, betfair_ex_*, polymarket, kalshi (los que existan en quotes).
- Nada de promesas de ganancia en ningún copy nuevo.
- Cifras de landing: congeladas de la DB real al construir + hidratación viva.
