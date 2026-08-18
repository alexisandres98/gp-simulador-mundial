# REGISTRO DE DERECHOS DE FUENTE — DOTA 2 (D-0029…0042 del blueprint 5.0)

> Regla crítica heredada del blueprint (D-0030/D-0031): **una pick pública solo puede nacer de features
> cuyo linaje sea compatible con betting.** Nada de lo listado abajo lo es todavía — y ante la duda se
> cierra (D-0042, fail closed). Consecuencia operativa, vigente hasta que exista revisión legal o un
> acuerdo (GRID u otro autorizado): **Dota 2 es admin-only, todas sus familias corren en SOMBRA, y la
> probabilidad publicada sigue ANCLADA A MERCADO** — la base propia afina el peso del modelo y alimenta
> el catálogo/draft/research, no una pick pública.

| source_id | Fuente | Campos | Términos | rights_class | ¿betting ok? | Uso permitido en GP |
|---|---|---|---|---|---|---|
| dota-opendota | OpenDota API (proMatches, Explorer SQL, heroes) | resultados pro, picks/bans, scoreboard por jugador, parches | API pública y gratuita, datos derivados de replays de Valve; sin términos comerciales de betting publicados | `research_only` | **NO** (D-0038: research accelerator y QA) | investigación, rating interno, catálogo admin, sombra privada. Cosecha lenta con UA identificado. |
| dota-steam-valve | Steam / Valve Web API | metadata, resultados | términos de Steam Web API; revisión legal pendiente para uso comercial | `adapter_pending_review` | pendiente de revisión | adaptador futuro; no se usa todavía. |
| dota-stratz | STRATZ GraphQL | estadística profunda | requiere key y revisión de términos | `research_only` | **NO** | cross-check futuro; no enchufado. |
| dota-grid | GRID Open Access / paid | telemetría oficial | contrato / elegibilidad requerida | `upgrade_path` | con contrato, SÍ | el camino de subida (D-0040: adaptador, no reescritura). |
| dota-cloudbet / dota-pinnacle / dota-bovada | Casas vía integraciones existentes | cuotas, cierres | términos de cada casa (display/analytics) | `market_data` | n/a (es el mercado) | precios, CLV, anclaje de probabilidad. |
| dota-valve-assets | Arte de héroes, logos, retratos | assets visuales | derechos de Valve, política aparte (D-0033) | `prohibited_until_review` | — | NO usar: representación texto-first como en LoL y Valorant. |

## Interruptor de emergencia
Borrar `data/esports/dota2/*.json` del deploy degrada el motor a mercado-solo sin romper nada:
`dota2-data.js` declara `available:false` y el resto de la casa sigue.

## Aprobación humana (D-0034)
Fuente aprobada por Alexis el 18-ago-2026 en sesión ("el blueprint del último Esport… procede"), con esta
ficha como registro. La revisión legal formal queda pendiente ANTES de cualquier lanzamiento público de
picks de Dota 2.
