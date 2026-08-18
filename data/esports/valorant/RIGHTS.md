# REGISTRO DE DERECHOS DE FUENTE — VALORANT (V-0021…0030 del blueprint 4.0)

> Regla crítica heredada del blueprint (V-0022/V-0023): **una pick pública solo puede nacer de features
> cuyo linaje sea `betting_commercial_ok`.** Nada de lo listado abajo lo es todavía. Consecuencia
> operativa, vigente hasta que exista un acuerdo comercial (GRID/VDP Betting & Fantasy u otro
> autorizado): **Valorant es admin-only, todas sus familias corren en SOMBRA, y la probabilidad
> publicada sigue ANCLADA A MERCADO** — la base propia afina el peso del modelo y alimenta el
> catálogo/veto/composición, no una pick pública.

| source_id | Fuente | Campos | Términos | rights_class | ¿betting_commercial_ok? | Uso permitido en GP |
|---|---|---|---|---|---|---|
| val-vlrgg | vlr.gg (sitio comunitario) | series, mapas, mitades por lado, agentes por jugador, scoreboard (rating2/ACS/K/D/A/ADR/KAST/FK/FD) | sin API pública ni términos comerciales publicados; robots.txt permite estas rutas; cosecha lenta (1 req/2,5 s) con UA identificado y contacto | `research_only` | **NO** | investigación, rating interno, catálogo admin, sombra privada. Cortesía de atribución donde se muestre el dato. |
| val-riot-dev | Riot Developer API (VAL-MATCH/CONTENT/RANKED) | partidas, contenido, assets | política Riot: **prohíbe funcionalidad de apuestas** (V-32/EXTERNAL CONSTRAINTS) | `prohibited_betting` | **NO — prohibición explícita** | NO usar para nada que toque picks. Assets de agentes/mapas tampoco (V-0026): representación texto-first. |
| val-grid-vdp | GRID / VALORANT Data Portal | datos oficiales VCT, capa Betting & Fantasy (de pago) | contrato comercial requerido | `upgrade_path` | con contrato, SÍ | el camino de subida: el conector oficial es un adaptador, no una reescritura (V-0030). |
| val-cloudbet / val-pinnacle / val-bovada | Casas vía integraciones existentes | cuotas, cierres | términos de cada casa (display/analytics) | `market_data` | n/a (es el mercado, no un input del modelo) | precios, CLV, anclaje de probabilidad. |
| val-liquipedia | Liquipedia valorant (CC BY-SA) | torneos, rosters | licencia CC BY-SA; API oficial requiere solicitud (pendiente en SOLICITUDES_DATOS.md) | `research_attribution_ccbysa` | **NO** | fallback/enriquecimiento de identidad si vlr.gg falla. Atribución obligatoria. |

## Interruptor de emergencia (análogo LOL-0046)
Borrar `data/esports/valorant/*.json` del deploy degrada el motor a mercado-solo sin romper nada:
`valorant-data.js` declara `available:false` y el resto de la casa sigue.

## Aprobación humana (V-0027)
Fuente aprobada por Alexis el 18-ago-2026 en sesión ("aquí el blueprint, valorant, procede"), con esta
ficha como registro. La revisión legal formal queda pendiente ANTES de cualquier lanzamiento público de
picks de Valorant.
