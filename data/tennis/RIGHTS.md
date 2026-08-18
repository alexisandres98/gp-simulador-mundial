# Derechos de datos — Tenis (Fase 0 del blueprint 6.0)

> Los derechos son parte del modelo, no un apéndice legal. Este archivo gobierna qué fuente puede
> alimentar qué capa del producto. Si una fuente no autoriza un uso, ese uso NO existe en GP.

## Registro de fuentes

### 1. Jeff Sackmann — tennis_atp / tennis_wta (GitHub)
- **Qué da:** historial de partidos ATP y WTA (fecha, torneo, superficie, nivel, ronda, formato,
  jugadores con mano/altura/edad/ranking, marcador, y las estadísticas de saque por jugador:
  aces, dobles faltas, puntos de saque, primeros adentro, ganados con primero/segundo, juegos
  de saque, break points salvados/enfrentados) + catálogo de jugadores.
- **Licencia:** Creative Commons **BY-NC-SA 4.0** (atribución, NO comercial, compartir igual).
- **Clase de derechos GP:** `research_attribution_noncommercial`.
- **Lo que SÍ permite aquí:** investigación interna, ratings propios, validación walk-forward,
  pantallas **admin-only** con atribución visible ("Datos derivados del proyecto de Jeff Sackmann,
  CC BY-NC-SA 4.0").
- **Lo que NO permite:** ningún producto comercial construido sobre esta base. Por eso el tenis
  queda **admin-only** (`GP_TENNIS_PUBLIC_ENABLED` sin poner), las familias van TODAS en sombra y
  ningún pick de tenis se publica a usuarios. **Antes de abrir tenis al público o cobrar por él,
  esta base se reemplaza por una fuente licenciada** (Sportradar Tennis API / TDI / Stats Perform,
  según el bloque 03 del blueprint) — la arquitectura de adapters está pensada para ese cambio.
- **Cadencia:** el repo se actualiza por tandas (semanas/meses de retraso). La frescura de la base
  se mide en `meta.json` (`last_match_date`); el motor declara la fecha de corte, no la esconde.

### 2. ESPN (site.api.espn.com — tenis ATP/WTA scoreboard)
- **Qué da:** agenda y marcadores del día (partidos en curso y programados).
- **Clase:** `informal_public_endpoint` (misma clase que en fútbol/baloncesto). Solo agenda y
  resultados en vivo; nada del modelo se entrena con esto.

### 3. The Odds API (`SPORTSBOOK_PROVIDER_API_KEY`, plan de la casa)
- **Qué da:** cuotas multi-casa por torneo (claves por torneo, se descubren dinámicamente),
  mercados h2h / totals (juegos) / spreads (hándicap de juegos), ~30 casas en torneos grandes.
- **Clase:** `commercial_ok` (contrato de la casa). Es la fuente del lado MERCADO: cierres,
  consenso, sombra. **Ninguna cuota entra a la probabilidad del modelo: market-blind por
  construcción**, igual que NFL.

## Reglas duras
1. La probabilidad fundamental de GP se calcula SOLO con la base propia (fuente 1). El mercado
   (fuente 3) se usa para comparar, medir CLV y liquidar la sombra — jamás como feature.
2. Tenis es **admin-only** hasta que exista base licenciada para uso comercial.
3. Toda pantalla que enseñe datos derivados de Sackmann lleva la atribución CC BY-NC-SA.
4. Nada de fotos de jugadores ni logos de torneos sin derechos propios: texto-first.
5. Los datos crudos (CSVs) viven en `/data/tennis-raw` (Render) y NO se versionan; al repo solo
   entra la base compacta derivada + priors, con lineage en meta.json.
