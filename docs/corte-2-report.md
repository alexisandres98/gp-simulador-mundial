# Rediseño Premium — CORTE 2: Match Cockpit profundo (`/x`)

**Fecha:** 2026-06-28 · **Aislado en `/x`** detrás de `GP_PREMIUM_UI_ENABLED` (ON en Render para QA).
La plataforma de los 509 usuarios queda **intacta** (la ruta no existe con el flag off; no toca `app.js`, datos, modelo, auth).

## Qué se construyó
Página canónica de partido premium, navegable vía `#match/<canonical_event_id>` (deep-link), que toma el área de
contenido con un botón **← Oportunidades** para volver. Se abre desde:
- **Desktop:** botón "Abrir cockpit completo" del cockpit lateral del board.
- **Móvil:** tap directo en la card del board ("Ver análisis completo →").

### Puente de datos canónico → fixture
El board usa `canonical_event_id` (`/api/beta/*`), pero `/api/match/:id` se indexa por fixture. Se resuelve
**cliente-side** mapeando `home.team_id + away.team_id + fecha` contra `/api/state` (`fixtures` + `knockout`).
Los códigos de equipo del header beta coinciden con los de state. Verificado: ALG/AUT y BRA/JPN resuelven y traen
`odds` (10Bet) + `marketPrices` (Polymarket) reales.

### Los 7 módulos (todos contra datos REALES, sin fabricar)
1. **Hero** — competición/fase/fecha/estado, equipos+banderas, score+minuto si LIVE, barra Prob GP 1X2, tri de
   Mercado 1X2 + Mejor precio 1X2, xG esperado y marcador probable (si existen, desde `goal_insights`/modelo),
   chip de frescura, nota "90 min · sin prórroga ni penales".
2. **Decision Memo con reglas de evidencia** — distingue la base real: `Pick GP publicada` / `Value accionable` /
   `Análisis GP del partido` / `Lectura basada en el precio` / `Sin evidencia accionable`. Reusa el memo
   editorializado (veredicto/precio/tesis/riesgo/invalidación + confianza) + Data Trust. El tag de CTA sólo aparece
   cuando hay Pick publicada o Value accionable.
3. **Probabilidad base + ajustes de contexto = Probabilidad GP** — `base_vector → context_adjustments → final_vector`
   con barras; drivers per-factor (impacto Elo con signo / confianza / evidencia FACT·INFERENCE / calidad de
   timestamp) cuando `applied_factors` tiene deltas; si no, chips de `evaluated_factors`; meta-línea de
   factores/fuentes/completitud. **Timeline honesto:** estado actual real + nota explícita de que aún no hay
   snapshots previos (NO se fabrica histórico). Si no hay snapshot → muestra la probabilidad base con nota honesta.
4. **Mercados (matriz real)** — separa **Casas de apuestas** (mejor precio por casa desde `value` + casa de
   referencia desde `/api/match` odds), **Exchange** y **Prediction markets** (Polymarket). Por fila:
   fuente/resultado/cuota/prob implícita/**no-vig** (sólo con el set completo de resultados; parcial → "—")/liquidez
   (volumen Polymarket)/frescura. El "movimiento" se declara **no registrado todavía** (no se inventa histórico).
5. **Contexto narrativo por factor** — frases (no listas) de forma reciente, bajas/disponibilidad (deduplicadas) y
   alineaciones (confirmada/proyectada + formación + DT) desde `/api/match`. Fallback: narra los factores del
   análisis GP. Vacío honesto si no hay contexto.
6. **Proyección de goles "en validación"** — xG/total/O-U (1.5/2.5/3.5)/BTTS/marcadores probables desde
   `goal_insights`. Badge "En validación" + disclaimer. **Sin Pick/Value/STRONG/LEAN/WATCH ni CTA de apuesta.**
7. **Live (real)** — sólo si `status==='live'`: score/minuto/eventos/estadísticas/**probabilidad en vivo del modelo**
   (sólo si `modelProbabilities.live===true`; nunca se presenta la prepartido como live) + chip de frescura y aviso
   si los datos están stale.

### Polish Corte 1.1
- **Below-minimum por-fila** en el board (chip "Bajo mínimo" cuando el mejor precio < cuota mínima de la señal).
- **Frescura por-fila** en el board (chip ● desde `price_observed_at`).
- **Tokens de color semántico formalizados** en `:root` (`--gx-sem-positive/negative/warning/info/live` +
  `--gx-fresh/aging/stale`), un solo lugar significado→color.

## QA (preview local :3011, DB de producción read-only, admin)
- **Viewports:** 1440×900 y 390×844 verificados; **sin overflow horizontal** (`scrollWidth === clientWidth`).
- **ES/EN:** toggle re-renderiza el cockpit profundo completo; cero keys crudas (se corrigió `HIGH_HUMIDITY` y otros
  códigos de contexto).
- **Estados ejercitados con datos reales:**
  - Análisis completo (ALG vs AUT): FULL_CONTEXT, base 22/27/51 → ajuste → GP 19/27/54, factores evaluados,
    goal_insights, casa de referencia 10Bet con no-vig.
  - Price-only / BASE_ONLY (BRA vs JPN): evidencia "Lectura basada en el precio", base-only sin capa de contexto,
    **3 secciones de Mercados** (Mejor precio por casa / Casas 10Bet / Prediction markets Polymarket) con no-vig y
    liquidez ($1.0M/$617K/$475K), value WATCH por encima de la mínima.
  - Goles con datos y vacío honesto; contexto narrativo con forma/bajas/alineaciones.
- **Cero errores y warnings de consola.**
- **Live:** no había partidos en vivo al momento del QA (0 en vivo) → el módulo es condicional y quedó verificado por
  código; se capturará en vivo cuando haya un fixture LIVE.
- **Pick publicada / Value accionable (STRONG):** no hay ninguna activa ahora (KPI "No hay Picks GP activas"), así que
  esos dos tags de evidencia no se pudieron capturar con datos vivos; la lógica que los distingue quedó verificada.

## Invariantes (intactos)
GP_OFFICIAL_MODEL=v2 · Picks/Signals históricas · Verified Epoch · usuarios/auth/sesiones/betaGuard ·
auto-publication=false · goals public=false · arbitrage public=false + auto-execution=false · nombre **GP Simulador**.
**No se fusionó `/x` con la plataforma principal. No se inició Simulador ni Equipos.**

## Archivos tocados
- `public/premium.js` — i18n ES/EN del cockpit, routing `#match/:id`, los 7 módulos, polish del board.
- `public/premium.css` — tokens semánticos + estilos del cockpit profundo + responsive.
- `.claude/launch.json` — config de preview `worldcup-premium` (puerto 3011, sólo dev).

## STOP
Detenido tras Corte 2 + polish + capturas + reporte. **Esperando aprobación visual EXPLÍCITA de Alexis** antes de
avanzar a Simulador/Equipos o fusionar el premium en la plataforma principal.
