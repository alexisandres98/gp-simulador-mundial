# Sprint 7 — Auditoría de fuentes

Leyenda: **[D]** directo del proveedor · **[G]** generado/derivado por GP · **[E]** estimado · **[—]** no disponible.

## Fuentes existentes HOY
| Fuente | Tipo | Cobertura | Freshness | Notas |
|---|---|---|---|---|
| **Polymarket** (gamma) | prediction market | champion 1X-team ("world-cup-winner"); **NO** 1X2 por partido | poll ~min | best bid/ask [D], midpoint [G], slug/deep-link [D]. Bloqueado en algunas jurisdicciones. |
| **Kalshi** (trade-api) | prediction market | champion; **NO** 1X2 por partido | poll ~min | yes/no bids [D], NO ask derivado [G], fee conocida [D]. Solo EE.UU. (verificar). |
| **API-Football** | contexto (lineup/injuries/forma) | Mundial | TTL capas | no es cuota; usado en GP Take/GP Intelligence. |
| **ESPN** | resultados | Mundial | 30s | settlement de partidos (post→final). |

## Fuente CRÍTICA ausente: **sportsbooks**
- **NO existe proveedor de cuotas de sportsbooks** integrado (ni The Odds API, ni agregador, ni APIs oficiales). `docs/sprint-0` lo lista como "sportsbooks futuros".
- Consecuencia directa: **el consenso de sportsbooks no-vig NO es calculable con datos reales** hoy. El Value Engine se construye provider-agnostic + se prueba con FIXTURES; producirá señales reales solo cuando se conecte un proveedor autorizado y documentado.
- The Odds API (investigada en `TODO_NEXT.md`): de pago, multideporte, devuelve múltiples books → sería un **agregador** (no un sportsbook), por lo que habría que separar `data_provider` vs `sportsbook` y aplicar `independence_group` (§6-7). Decisión de gasto pendiente del usuario.

## Mercados 1X2 por partido: ausentes
- Los collectors solo ingieren **champion** ("¿X gana el Mundial?"), no "¿quién gana España-Uruguay (90m)?". Para Picks GP 1X2 se necesita ingerir mercados 1X2 por partido (Polymarket `fifwc-*` por partido existe en `db.matchSlugs` pero no se ingiere a la plataforma v2; sportsbooks 1X2 requieren proveedor).

## Reglas de incorporación (no negociables)
- **No scraping no autorizado.** Toda fuente nueva: origen, licencia/forma de acceso, freshness, limitaciones, atribución, estabilidad — documentados antes de usarse.
- **API keys solo en entorno** (Render env). Nunca en repo, DB, payloads ni logs (ya es práctica del proyecto).
- No declarar "consenso" con un solo sportsbook. No tratar un agregador como un sportsbook. Máx. un voto pleno por `independence_group`.
- No llamar al consenso "probabilidad verdadera" → usar "estimación de consenso / probabilidad de mercado sin vig / probabilidad ensemble estimada".

## Conclusión
El Sprint 7 entrega la **maquinaria completa y probada con fixtures**, con una **interfaz provider-agnostic** lista para un agregador/sportsbook autorizado. Estado: **COMPLETADO CON PENDIENTE DE VALIDACIÓN REAL** (sin feed de sportsbooks ni 1X2 por partido reales). No se afirma rentabilidad demostrada por fixtures.
