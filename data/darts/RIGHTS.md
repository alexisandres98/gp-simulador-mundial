# Derechos de los datos de dardos (blueprint 8.0 §6 — DATA RIGHTS FIREWALL)

Estado al 6-sep-2026. Ninguna fuente tiene contrato firmado: el módulo es **admin-only** y toda familia
corre **en sombra**. Las autorizaciones son triestado y UNKNOWN falla cerrado.

| Fuente | Qué da | display | betting (interno) | commercial | training | Notas |
|---|---|---|---|---|---|---|
| API pública de la PDC (`*.darts.web.gc.pdcservices.co.uk/v2/`) | calendario, formato por ronda, resultados con legs, participantes (dob, foto), rankings | ALLOW con atribución | ALLOW (uso interno de investigación) | UNKNOWN | ALLOW (resultados públicos del organizador) | Sin clave ni términos publicados para la API; es la que alimenta pdc.tv. Las imágenes (`images.gc.pdcservices.co.uk`) se enlazan, no se rehospedan. |
| Darts Orakel (`dartsorakel.com`, `app.dartsorakel.com`) | media, 180s, % dobles, checkout más alto por jugador y ventana; partidos del Players Championship | ALLOW con atribución | ALLOW (investigación) | DENY | ALLOW (investigación, no redistribución) | Sitio privado sin licencia de redistribución; el uso comercial exige acuerdo. Ritmo ≤ 3 llamadas/s. |
| Wikipedia (resumen REST) | retrato del jugador cuando la PDC no lo tiene | ALLOW con atribución | — | ALLOW (CC BY-SA con crédito) | — | Se enlaza la miniatura, no se rehospeda. |
| Wikimedia Commons (`commons.wikimedia.org`) | retrato del jugador (galerías de fotógrafos de European Tour) | ALLOW con atribución | — | ALLOW solo con licencia libre por archivo | — | Solo CC*/dominio público; autor, licencia y página del archivo viajan en `photo_credit` y se pintan en la ficha. Se enlaza, no se rehospeda. |
| Flashscore (`global.flashscore.ninja`) | legs en vivo y estado | ALLOW (display, efímero) | DENY (jamás input del modelo) | DENY | DENY | Solo display en pantalla; no se persiste. |
| Pinnacle (API de invitado) | ganador y total de legs | ALLOW | referencia de precio (CLV) | DENY | — | Cerrada al público desde 23-07-2025: referencia, jamás venue. |
| Bovada (cupón público) | ganador, marcador exacto, 180s (total, most, jugador) | ALLOW | referencia de precio (CLV) | DENY | — | Da precio a la familia de 180s; no ejecutable desde la cuenta de la casa. |
| Polymarket (gamma, serie 12754) | ganador (PDC) | ALLOW | referencia + sombra de Polymarket | — | — | Liquidez fina. |
| Kalshi (`KXPDCDARTS`) | campeón del Mundial | ALLOW | referencia | — | — | |
| Cloudbet (API con clave) | mercados de dardos (a confirmar con la sonda) | ALLOW | venue ejecutable de la casa | — | — | Claves de mercado crudas visibles en `/api/internal/darts?key=`. |

## Consecuencias
- **9-sep-2026 — decisión del dueño (Alexis), riesgo asumido y anotado**: el deporte se abre al público con
  ventana libre de siete días y después por plan. Nada en esta tabla lo autoriza: PDC y Wikipedia/Commons dan
  `display` con atribución pero `commercial` sigue en UNKNOWN, y Orakel es research-only con `commercial: DENY`.
  Mitigación aplicada: lo derivado de Orakel (el motor, su validación y su rendimiento) NO se publica —
  `/api/darts/model` y las vistas de motor y rendimiento quedan admin-only, y la doctrina se le quita a quien
  no es admin—, las fotos se enlazan con crédito y jamás se rehospedan. Si una fuente reclama, se apaga con
  `GP_DARTS_PUBLIC_ENABLED=0` sin desplegar. Contexto y plan: `PLAN_LANZAMIENTO_DARDOS_TT.md`.
- (histórico, superado por la línea anterior) Nada de esto autorizaba abrir el deporte al público ni cobrar por él: `GP_DARTS_PUBLIC_ENABLED` se quedaba sin poner.
- Un modelo entrenado con Orakel hereda la restricción: research-only. Antes de un producto comercial hay que
  sustituir Orakel por una fuente licenciada (Sportradar Darts v2 es el candidato L3 del blueprint) o negociar.
- Revocación: si una fuente pide retirada, se apaga su proveedor, se invalidan las cachés y se reconstruye la
  base desde lo permitido (`scripts/darts-harvest.js --build` sin su directorio crudo).

## Trazabilidad
- Crudo: `GP_DARTS_RAW` (fuera del repo; `/data/darts-raw` en Render).
- Compacto versionado: `data/darts/{matches,players,orakel,meta}.json` con `meta.sources` y `built_at`.
- Cada fila de `matches.json` conserva `fid` (fixture de la PDC) y las columnas de Orakel solo donde casaron.
