# Matriz de paridad — Plataforma principal (`app.js`) vs Premium (`/x`, `premium.js`)

Fase Premium 5. La plataforma principal es la **especificación funcional**. Premium debe igualar o superar.
Estado: `✅ paridad` · `⬆ superior` · `🔧 en este corte` · `⏳ pendiente` · `🚫 externo (no disponible en ninguna fuente)`.

> Fuentes de datos ya fetcheadas por premium: `/api/beta/match` (GP V2), `/api/match` (deportivo: lineups/events/
> stats/injuries/news/recentForm/odds/marketPrices/gpTake/marketAngles), `/api/teamdetail` (equipo completo),
> `/api/h2h/deep` (simulador), `/api/beta/value`, `/api/beta/dashboard`, `/api/state` (torneo/history).

## Match cockpit — `renderMatchDetail` (11 módulos) vs premium cockpit

| Módulo principal | Fuente | Estado premium | Acción |
|---|---|---|---|
| Hero/score/kickoff/estado | /api/match + beta | ✅ | — |
| Modelo 1X2 + xG + marcador probable | beta.probability + fx.modelProbabilities | ✅ | — |
| GP Take / Decision Memo | beta + value + pick | ⬆ (memo con evidencia) | — |
| Ángulos de mercado / Mercados (SB/exchange/PM) | value + fx.odds + fx.marketPrices | ⬆ (matriz no-vig + 3 fuentes) | — |
| Eventos en vivo (timeline) | fx.events | ✅ (módulo Live) | — |
| Estadísticas (possession/shots/SOT/corners/fouls/xG…) | fx.statistics | 🔧 tabla completa (live + final) | render |
| Alineaciones (formación/XI/suplentes/DT/cancha) | fx.lineups | 🔧 módulo lineups visual | render |
| Forma reciente (ambos, W/D/L+goles) | fx.recentForm | 🔧 módulo forma | render |
| Mercados/odds (libro + Polymarket + link) | fx.odds/marketPrices | ✅ | — |
| Noticias + lesiones | fx.news/injuries | ✅ (contexto narrativo, dedup) | — |
| Provider status / Data Trust | fx.providerStatus + beta freshness | ✅ (Data Trust + provenance) | — |
| **Probabilidad base→contexto→GP + factores** | beta.analysis | ⬆ (módulo "Por qué GP cambió") | — |
| **Cobertura: GP sin cuotas** | beta + fx | 🔧 GP prob visible sin mercado | sep. |

## Team detail — `renderTeamDetail` (6 tabs) vs premium team

| Tab principal | Fuente | Estado premium | Acción |
|---|---|---|---|
| Resumen (champ/final/SF/QF/advance/groupWin/out + modelRead + keyDrivers + likelyOpponents + samples/paths + explanation) | /api/teamdetail | 🔧 ampliar (rivales/caminos/drivers) | render |
| Plantilla (keyPlayers + squad + projectedLineup) | teamdetail.squad/keyPlayers/projectedLineup | 🔧 tab Plantilla | render |
| Forma (results/points/avg/last) | teamdetail.recentForm | 🔧 tab Forma | render |
| Resultados (nextMatch + results[] con fase) | teamdetail.results/schedule | 🔧 tab Resultados | render |
| Mercados (Polymarket/Kalshi bid/ask/vol/liq/OI/Δ24h/edge) | teamdetail.marketPrices | 🔧 tab Mercados | render |
| Noticias (injuries+sidelined + news) | teamdetail.news/injuries/sidelined | 🔧 tab Noticias | render |
| Follow/unfollow | /api/favorite | 🔧 botón seguir | render |

## Simulador — `h2hAnalysisHtml` (8 secciones) vs premium sim

| Sección principal | Fuente | Estado premium | Acción |
|---|---|---|---|
| Selectores + Elo + swap + hipotético | /api/h2h/deep | ✅ | — |
| Probabilidades base→GP + pp + xG + marcador + confianza + calidad datos | d.base/probs/delta/context | ✅ + 🔧 pp/calidad | render |
| Veredicto/Tesis/Riesgo/Invalidación (estructurado, localizado) | d.analysis estructurado | ⬆ (4F localizado) | — |
| Factores (flag/team/label/detail/included/eloImpact/categoría/evidencia) | d.analysis.factors / d.context.factorsA/B | 🔧 lista completa de factores | render |
| Monte Carlo (topScores/over25/btts/avgTotal/avgMargin/narrativa) | d.monteCarlo | 🔧 marcadores + agregados | render |
| Goles + totales (O/U 1.5/2.5/3.5 + g0-g3 por equipo) | d.goals | ✅ + 🔧 dist. por equipo | render |
| Lectura táctica (style/strengths/risks) | d.tactical | 🔧 módulo táctico | render |
| Escenarios / whatChanges | d.analysis.whatChanges | 🔧 módulo escenarios | render |

## Superficies de torneo y cuenta

| Superficie | Ruta principal | Estado premium | Acción |
|---|---|---|---|
| Oportunidades (Picks/Value/Arbitraje) | board | ✅/⬆ | — |
| Grupos | /api/state | ✅ | — |
| Bracket | /api/state | ✅ (1X2-90 vs avance) + ⏳ conexiones visuales | mejora |
| Evolución | /api/state.history (snapshots REALES) | 🔧 gráfico temporal real (no sparkline) | render |
| Registro/Rendimiento | /api/aciertos + /api/metrics/* | ✅ (Registro) + 🔧 métricas verificadas | render |
| Metodología | estático | ✅ | — |
| **Seguidos** | /api/favorite/mute | 🔧 restaurar | build |
| **Alertas** | /api/alertprefs (8 eventos × 3 canales) | 🔧 restaurar | build |
| **Invitar/Referidos** | /api/referrals/* (tiers 1/3/5/10) | 🔧 restaurar | build |
| Perfil/acceso | /api/me | 🔧 en cuenta | build |
| Admin/Observatory | /api/beta/observatory | ⬆ | — |

## Cobertura de datos (auditada)

| Dato | Fuente | ¿Existe? |
|---|---|---|
| Lineups/eventos/stats/injuries/news/form/odds | API-Football → ESPN → manual | ✅ (degrada honesto) |
| Mercados sportsbook | The Odds API | ✅ |
| Prediction markets | Polymarket/Kalshi | ✅ |
| Contexto V2 (form/availability/squad/solidity/streak + clima HIGH_HUMIDITY/HEAVY_RAIN) | context-engine | ✅ (applied_impact=0 → efecto neto) |
| **Clima exacto (temp/viento/precip)** | Open-Meteo | 🚫 NO integrado en data-providers (solo factores de humedad/lluvia en V2) |
| **Sede/estadio/ciudad** | API-Football fixture.venue | 🚫 canonical_events.venue NULL → no disponible |
| Head-to-head | — | 🚫 no hay endpoint H2H (la principal tampoco lo muestra) |

## Invariantes verificados
GP V2 oficial · sin V1/V2/challenger/lambda al cliente · sin fabricar · 509 usuarios/auth/Registry/Epoch/Picks V1=2
intactos · arbitraje/billing/públicos/auto-exec/auto-publicación OFF · `/x` aislado tras `GP_PREMIUM_UI_ENABLED`.
