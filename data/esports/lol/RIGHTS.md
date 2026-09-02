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

## Actualización 18-ago-2026 — la base entra por el espejo archivístico
Fandom limita la cosecha directa (ventanas de horas); la base histórica entró por el espejo
**gptilt/lol-esports-matches** (Hugging Face, CC BY-SA 3.0), que es él mismo derivado de
Leaguepedia/lol.fandom.com — MISMA clase de derechos (`research_attribution_ccbysa`), misma
atribución obligatoria a Leaguepedia, mismo veto a uso betting_commercial. 84.586 partidas
2021→ago-2026 con picks/bans. El scoreboard POR JUGADOR sigue pendiente de la cadena de
Leaguepedia (fichas de jugador y pools del Draft Room a media luz hasta que entre).

## Actualización 2-sep-2026 — la base propia de Leaguepedia entra ENTERA y sustituye al espejo
La cosecha directa terminó en 113 llamadas por `Special:CargoExport` (5.000 filas por llamada, sin el cubo
de ~10 minutos que tenía a `api.php` a 2 páginas por pasada en Render). Base embarcada en el repo:
**97.588 partidas 2020-01 → 2026-09-01** (kills, dragones, barones, torres y oro por lado, nativos),
**535.478 filas de scoreboard por jugador 2023-01 →** (agregadas en `player-stats.json` y `champions.json`;
el crudo NO viaja en el repo, vive en `/data/lol-raw` de Render) y **33.185 drafts con orden 2024-01 →**.
Misma fuente, misma clase de derechos (`research_attribution_ccbysa`), misma atribución obligatoria a
Leaguepedia, mismo veto a uso `betting_commercial`. El espejo de HuggingFace deja de usarse (ids propios
de Leaguepedia en las tres tablas ⇒ players y drafts casan con games por `GameId`).
Oracle's Elixir se volvió a intentar como atajo (la cuota de descarga de Drive seguía agotada; una copia al
Drive del propietario tampoco es descargable por la vía disponible) — no entró ningún dato de OE.
