# /x — Grupos 2 y 3 (jun-29-2026)

Trabajo aislado en `/x` detrás de `GP_PREMIUM_UI_ENABLED`. **No se tocó la plataforma principal (app.js).**
Shadow: no se tocó el modelo oficial (Value/Picks/Registry/Verified Epoch siguen intactos). Sin migraciones.

## GRUPO 2 — contexto abundante + integridad del modelo

### 2.1 — Observaciones del collector (clima + noticias) como factores que ajustan la probabilidad
- **`context-engine/collectorFactors.js`** (puro, testeado): convierte
  - **clima Open-Meteo** (`weather_snapshots.weather_factors`: EXTREME_HEAT/HIGH_HUMIDITY/HEAVY_RAIN/STRONG_WIND)
    → empuja hacia el empate y comprime al favorito (cap 3 pp). Evidencia = **Inferencia** (pronóstico).
  - **claims de noticias** (`context_claims`: PLAYER_CONFIRMED_OUT/SUSPENDED/DOUBTFUL/RETURNED/STARTER…)
    → penaliza/beneficia al equipo sujeto (cap 4.5 pp/equipo; FACT pesa 100%, INFERENCE 55%, RUMOR/review→0).
- **`evaluateUpcomingContext` (server.js)** ahora **fusiona** clima+noticias sobre el vector final de
  `buildH2HDeep` y renormaliza. El efecto NETO queda en `context_adjustments` del snapshot
  (`gp-intelligence-v2-live-0.3.0`) y cada factor se persiste como `context_observations` con su evidencia.
- **Sedes (resolver más partidos):** `collector/venuesSeed.js` (16 estadios WC2026, coords verificadas) +
  `jobResolveVenues` (ESPN sede+ciudad → catálogo canónico) en `shadow-ops/autonomousOps.js`.
  **Resultado en prod:** 16 sedes sembradas, **3/3 próximos resueltos**, clima poblado para los 3.
  → Brasil/Japón en NRG Houston con **EXTREME_HEAT (37.7 °C)** = factor real fusionado.

### 2.2 — FACT ↔ INFERENCE derivado del origen real
- Antes `evaluateUpcomingContext` grababa todo como `inference`. Ahora:
  - **AVAILABILITY** pasa a **Dato (verde)** cuando hay una lista de lesiones real (`count>0`) o una
    noticia FACT confirma la baja del equipo; el resto sigue **Inferencia (azul)**.
  - Clima = **Inferencia** (es pronóstico). Noticias llevan su propia clase (FACT/INFERENCE/RUMOR).
- `entityResolver.resolveTeamFocus` atribuye el claim al equipo sujeto (home/away); ambiguo → null
  (no se adivina). `jobNews` graba `team_id`.
- `gp-product/repository.observationsForEvent` ahora ordena por `created_at DESC` → el cockpit muestra
  la evidencia **más reciente**. `dto.analysisFactors` expone `direction_code` en `evaluated_factors`.
- **Verificado en prod:** USA/Bosnia → AVAILABILITY = **DATO** (lista de lesiones real);
  Países Bajos/Marruecos → Inferencia (sin bajas). Brasil/Japón → "calor extremo" (Inferencia).

### 2.3 — Contexto en TODA probabilidad (auditoría #5)
- **Cockpit:** todas las probabilidades de partido pasan por base→contexto→GP (Grupo 1 + esta fusión).
- **Equipos (superficie con prob de torneo base-sola):** se añadió un panel **"Próximo partido · contexto
  GP"** que enlaza al cockpit (donde la prob refleja forma/bajas/clima) + **nota de metodología**: las
  probabilidades de torneo reflejan la fuerza base (Elo + simulación); el contexto por partido vive en el
  cockpit. (Enfoque honesto: NO se altera el Monte Carlo del torneo —es el modelo oficial compartido—; se
  expone el contexto del próximo partido como pide el spec.)
- **DIFERIDO (riesgo del grafo canónico, decisión consciente):** crear `canonical_events` para los 104
  fixtures + auto-registro. `canonical_events` **no tiene clave única (home,away,fecha)**; insertar en masa
  arriesga DUPLICADOS cuando el motor de matching mapee los mismos partidos desde the_odds_api (el grafo de
  equivalencia/approval). En un sistema EN VIVO con historial de incidentes no se hizo a ciegas. Plan seguro
  para el follow-up: (a) dedup por (home_participant, away_participant, fecha±3h) antes de insertar; (b)
  insertar solo GROUP_FIXTURES (equipos conocidos) + knockouts con bracket resuelto; (c) hook de
  auto-registro en la resolución de bracket; (d) verificar que el matching reusa el canónico existente.
  **Nota:** el cockpit YA cubre los no-canónicos vía modo `fx-` (Grupo 1), así que NO hay hueco visible.

## GRUPO 3 — contexto en vivo reactivo
- **`engine.liveEventAdjustments(events)`** + **`liveMatchProbs(…, opts)`**: una **tarjeta roja**
  (evento inequívoco de ESPN/API-Football) penaliza la expectativa del equipo sancionado sobre el resto del
  partido (−150 Elo/roja, escala sola con los minutos restantes). Backward-compatible.
- **`buildMatchDetail` (server.js)** recalcula la prob en vivo con el ajuste y expone `liveContext`.
- **Módulo Live de `/x`** muestra la nota "Probabilidad en vivo ajustada por tarjeta roja (equipo)" (ES/EN).
- Re-evaluación prepartido cada 20 min: intacta.
- **Nota:** no hubo partido en vivo con roja en la ventana de captura (Brasil/Japón arranca 17:00Z); el
  mecanismo está cubierto por tests y se verá en el primer partido en vivo con roja.

## Tests
- `tests/collector-factors.test.js` (7/0), `tests/live-context.test.js` (5/0).
- Intactos: `gp-product` 41/0, `premium-i18n` 9/0, `premium-confidence` 10/0, `q11-flagship` 29/0.

## Capturas (preview :3011 contra DB de prod, Chromium real)
- Cockpit Brasil/Japón ES desktop — tesis con "calor extremo"; sin overflow.
- Probabilidad GP USA/Bosnia ES desktop — base 59/25/16 → contexto (Est −3.5/Emp −0.5/Bos +3.9) → GP
  56/24/20; **disponibilidad del plantel = DATO (verde)** + resto Inferencia.
- Equipos Brasil ES desktop — "Próximo partido · contexto GP" + nota de metodología.
- Probabilidad GP Brasil/Japón EN desktop — extreme heat (INFERENCE) + squad availability (FACT).
- Cockpit Brasil/Japón ES móvil 390×844 — sin overflow, tesis con "calor extremo, perfil de goles".

## Deploys
- `c76f058` (Grupo 2.1/2.2 + 3 + sedes), `8cf4cee` (Grupo 2.3 Equipos + orden + label).

## STOP
No fusionar `/x` con la principal. Esperar aprobación visual+funcional de Alexis.
