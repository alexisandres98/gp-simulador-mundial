# REGISTRO DE DERECHOS DE FUENTE — LoL (LOL-0036…0049 del blueprint 3.0)

> Regla crítica del blueprint (LOL-0038): **una pick pública solo puede nacer de features cuyo linaje sea
> `betting_commercial_ok`.** Nada de lo listado abajo lo es todavía. Consecuencia operativa, vigente hasta
> que exista un acuerdo comercial (GRID u otro autorizado): **LoL es admin-only, todas sus familias corren
> en SOMBRA, y la probabilidad publicada sigue ANCLADA A MERCADO** — la base propia afina el peso del
> modelo y alimenta el catálogo/draft/research, no una pick pública.

| source_id | Fuente | Campos | Licencia | rights_class | ¿betting_commercial_ok? | Uso permitido en GP |
|---|---|---|---|---|---|---|
| lol-leaguepedia | Leaguepedia (lol.fandom.com) Cargo API | partidas, scoreboard por jugador, picks/bans | CC BY-SA 4.0 (contenido de la comunidad) | `research_attribution_ccbysa` | **NO** | investigación, rating interno, catálogo admin, sombra privada. Atribución obligatoria donde se muestre el dato. |
| lol-lolesports | lolesports (API no oficial del cliente web) | calendario y resultados de serie | sin términos comerciales publicados | `research_only` | **NO** | liquidación de la sombra, calendario. |
| lol-cloudbet / lol-pinnacle / lol-bovada | Casas vía integraciones existentes | cuotas, cierres | términos de cada casa (display/analytics) | `market_data` | n/a (es el mercado, no un input del modelo) | precios, CLV, anclaje de probabilidad. |
| lol-oracleselixir | Oracle's Elixir (Drive público) | dataset investigación 2014-2026 | uso investigación; cuota de descarga agotada el 18-ago | `research_only` | **NO** | bootstrap alternativo si Leaguepedia falla. |
| lol-riot-dev | Riot Developer Tools / Data Dragon | datos estáticos, assets | política Riot: **prohíbe funcionalidad de apuestas** | `prohibited_betting` | **NO — prohibición explícita** | NO usar para nada que toque picks. Assets de campeones tampoco (LOL-0043): representación texto-first hasta aclarar arte. |
| lol-grid | GRID / datos oficiales Riot esports | datos oficiales en vivo | contrato comercial requerido | `upgrade_path` | con contrato, SÍ | el camino de subida: los adaptadores del motor están pensados para enchufarlo sin reescribir modelos (LOL-0048). |

## Interruptor de emergencia (LOL-0046)
Borrar `data/esports/lol/*.json` del deploy (o vaciar la carpeta en el disco) degrada el motor a
mercado-solo sin romper nada: `lol-data.js` declara `available:false` y el resto de la casa sigue.

## Aprobación humana (LOL-0045)
Fuente aprobada por Alexis el 18-ago-2026 en sesión ("sigue el blueprint"), con esta ficha como registro.
La revisión legal formal (LOL-0049) queda pendiente ANTES de cualquier lanzamiento público de picks de LoL.
