# Derechos de los datos de tenis de mesa (blueprint 9.0 §6 — DATA RIGHTS FIREWALL)

Estado al 8-sep-2026. Ninguna fuente tiene contrato firmado: el módulo es **admin-only** y toda familia
corre **en sombra**. Las autorizaciones son triestado y UNKNOWN falla cerrado.

| Fuente | Qué da | display | betting (interno) | commercial | training | Notas |
|---|---|---|---|---|---|---|
| WTT CMS (`wtt-website-api-vm-frontdoor….azurefd.net/primary/api/cms/`) | eventos con fechas y sedes, agenda por evento (hora local, jugadores con IttfId, país, cabeza de serie, fecha de nacimiento), retratos, ficha (mano, empuñadura, estilo) | ALLOW con atribución | ALLOW (uso interno de investigación) | UNKNOWN | ALLOW (calendario público del organizador) | Claves públicas de cliente embebidas en el bundle de worldtabletennis.com; sin términos publicados para la API. Los retratos (`wttsimfiles.blob.core.windows.net`) se enlazan, no se rehospedan. |
| WTT score API (`…/liveeventsapi/api/cms/GetOfficialResult_Minimal`) | match card oficial: al mejor de N, puntos por game, tiempos muertos, duración, hora UTC | ALLOW con atribución | ALLOW (liquidación) | UNKNOWN | ALLOW | Certifica formato y zona horaria del evento. |
| WTT live (`wtt-web-frontdoor-withoutcache….azurefd.net/`) | ids en juego por evento y match card en vivo (puntos del game en curso, servidor) | ALLOW (display + probabilidad en vivo) | — | — | DENY | Efímero; no se persiste. |
| ITTF gateway (`wttcmsapigateway-new.azure-api.net/ttu/`) | ranking semanal (1.500 por categoría) e HISTORIAL de partidos por jugador con los puntos de cada game (2012 →) | ALLOW con atribución | ALLOW (investigación) | DENY | ALLOW (investigación, no redistribución) | Es la base del rating de punto. `OverallScore` viene repetido en miles de filas: el ganador se deduce de los puntos. Eventos "TEST -", "SIM -" y "PRODUCTION TEST" se excluyen. Ritmo: 4 descargas en paralelo, 150 ms entre ellas. |
| Flashscore (`global.flashscore.ninja`, deporte 25) | games y puntos en vivo | ALLOW (display, efímero) | DENY (jamás input del modelo) | DENY | DENY | Solo eventos WTT; profundidad ±7 días. |
| Pinnacle (API de invitado, deporte 32) | ganador, hándicap y total del partido; por game | ALLOW | referencia de precio (CLV) | DENY | — | Publica el día del partido. Referencia, jamás venue. |
| Bovada (cupón público `table-tennis`) | ganador, spread de games, spread y total de puntos, marcador exacto, 1er game (ML, spread, total), deuce ("extra points") | ALLOW | referencia de precio (CLV) | DENY | — | La superficie más rica para el compilador; no ejecutable desde la cuenta de la casa. |
| Cloudbet (API con clave) | `table_tennis.winner` · `totals` · `correct_score` · `game_point_handicap.v2` · `game_total_points.v2` · `game_winner.v2` | ALLOW | venue ejecutable de la casa | — | — | Solo se leen los mercados de competiciones VERIFICADAS casadas con la agenda; las ligas privadas cuentan para el mapa de integridad y nada más. |

## Integridad de competición (blueprint §7)
- **VERIFIED_SCOPE**: WTT/ITTF (organizador oficial con resultado publicado). Único estado que entra al modelo y a la sombra.
- **WATCH**: ligas nacionales con federación (T.League, Bundesliga…) sin fuente propia: solo mercado.
- **RESTRICTED**: ligas privadas creadas para las apuestas (Czech Liga Pro, Setka Cup, TT Cup, TT Elite Series, Challenger Series…): display con aviso; jamás modelo, jamás sombra.
- QUARANTINED / BLOCKED: reservados para una competición verificada que muestre anomalías o una orden explícita.

## Consecuencias
- **9-sep-2026 — decisión del dueño (Alexis), riesgo asumido y anotado**: el deporte se abre al público con
  ventana libre de siete días y después por plan. La tabla no lo autoriza: WTT da `display` con atribución pero
  `commercial` sigue en UNKNOWN. Mitigación aplicada: `/api/tt/model` y las vistas de motor y rendimiento quedan
  admin-only, la doctrina se le quita a quien no es admin, y los retratos se enlazan al blob de la WTT sin
  rehospedarlos. Si la fuente reclama, se apaga con `GP_TT_PUBLIC_ENABLED=0` sin desplegar. Contexto y plan:
  `PLAN_LANZAMIENTO_DARDOS_TT.md`.
- (histórico, superado por la línea anterior) Nada de esto autorizaba abrir el deporte al público ni cobrar por él: `GP_TT_PUBLIC_ENABLED` se quedaba sin poner.
- Un modelo entrenado con el historial de la ITTF hereda la restricción: research-only. Antes de un producto comercial hay que
  licenciar la fuente (WTT/ITTF data partner o Sportradar) o negociar.
- Revocación: si una fuente pide retirada, se apaga su proveedor, se invalidan las cachés y se reconstruye la base desde lo
  permitido (`scripts/tt-harvest.js --build` sin su directorio crudo).

## Trazabilidad
- Crudo: `GP_TT_RAW` (fuera del repo; `/data/tt-raw` en Render): `players/<ittfid>.json`, `rank_MS.json`, `rank_WS.json`, `events.json`, `photos.json`, `cards.json`.
- Compacto versionado: `data/tt/{matches.json.gz, players.json, formats.json, meta.json, model-priors.json}` con `meta.sources` y `built_at`.
- Cada fila de `matches.json` conserva el id del evento (`tid`) y de los dos jugadores; `dated` marca si la fecha es exacta (eventos 2021 →) o por año.
