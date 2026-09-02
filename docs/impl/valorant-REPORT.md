# Informe de implementación — mejoras VALORANT (rama `impl/valorant`)

Base: `origin/main` en `72f9c1d` (2-sep-2026). Spec: las mejoras de Valorant que sobrevivieron a los
backtests de `docs/BACKTESTS_FAMILIAS_2026-09-02.md` §4 (bisección de pRound, anclaje por mapa, nivel de
serie templado, signo del ban, incertidumbre del nivel en margen, rastro en la pick).

## Commits (todos en `impl/valorant`, empujados a origin)

| Commit | Qué |
|---|---|
| `33d0ae25` | `valorant.js`: `pRoundFor` por bisección (sustituye a `clampRound ×0,44`), `mapRounds` devuelve `p_win_a` y nunca deja el mapa empatado, anclaje por mapa al mercado (`map_anchoring`, réplica de `cs2.js:373-386`), nivel de serie con temperatura 0,85 y `maxModel 0,25`, signo del término de composición en el veto. |
| `31e0b3a9` | `store.js` (solo `game === 'valorant'`): `valUncertaintyFor` (RONDAS_EQUIPO paga el nivel del par), `valPickMeta` en la fila y en `recordPicks` (`p_map_market`, `p_map_model`, `shift_logit`, `p_round_solved`, `dist_method`), `track()` con `by_dist_method`. `valorant.js`: el veto no veta el último mapa en pie; respaldo coherente en la bisección del anclaje. `scripts/smoke/valorant-smoke.js`. |
| (este) | `docs/impl/valorant-REPORT.md`. |

## Archivos tocados

- `esports-engine/valorant.js` (+126/−15)
- `esports-engine/store.js` (+68/−2) — cinco regiones, todas condicionadas a `game === 'valorant'` o helpers nuevos que CS2/LoL no llaman
- `scripts/smoke/valorant-smoke.js` (nuevo)
- `docs/impl/valorant-REPORT.md` (nuevo)

**NO tocados:** `esports-engine/cs2.js`, `lol.js`, `dota2.js`, `core.js`, `server.js`, ningún `*-data.js`,
ningún archivo de `public/`. `git diff --stat origin/main..HEAD` lo confirma (ver Verificación).

## Qué se hizo, tarea por tarea

### 1. Bisección de pRound (sustituye `clampRound(×0,44)`)
- `pRoundFor(pMap, bias, eco)`: bisección en [0,20, 0,80], 12 pasos de 6.000 sims (seed 911), cache por
  `(pMap 3 dec, bias 3 dec, eco 3 dec)`. `mapRounds` devuelve `p_win_a` (y `p_round`).
- `roundsAt(pMap, bias, {eco, seed})`: simulación final con 20.000 sims al pRound resuelto; añade
  `p_round_solved`, `p_map_target`, `p_map_sim`, `dist_method: 'bisect'`. Se usa en `rounds` (mapa 1) y en
  cada `rounds_by_map[i]`.
- `clampRound` eliminada de Valorant (CS2 conserva la suya en `cs2.js:545`, intacta).
- `calibrateDrag` no cambia: sigue ajustando el eco a p = 0,5, donde la bisección es la identidad.

### 2. Anclaje por mapa al mercado (réplica de `cs2.js:373-386`)
- Los logits de `veto.likely_maps[].p_a` se desplazan por una constante `mapShift`, resuelta por bisección
  (14 pasos, 2.500 sims, seed 8171, corchete [−3,5, 3,5]) para que `simulateSeries(perMap)` reproduzca
  `pSeries` (la anclada). Sin clamp previo: la fuerza por mapa de `vetoInput` ya es relativa (win-rate
  encogido n+8 enfrentado), como pide §4.5.3.
- Si `anchor.p_map` existe (ancla `MAPA` o `HANDICAP`), ese precio sin margen **es el nivel del mapa 1**
  (pinned) y los demás mapas se desplazan alrededor.
- Se publica `map_anchoring: { shift_logit, bracketed, p_map_market, p_map_market_from, p_map_model_mean,
  model_vs_market_pp, maps[{map, p_a_model, p_a}], why }`. `veto.likely_maps` conserva la `p_a` del modelo
  (como en CS2); la anclada viaja en `map_anchoring.maps`, `rounds.p_map_a` y `rounds_by_map[i].p_map_a`,
  con `p_map_a_model` al lado.
- La simulación de serie (`simulation`) también usa los mapas anclados (antes usaba los del modelo sin
  anclar: serie publicada y marcadores simulados salían de partidos distintos).
- Sin veto simulable (`p_a` nulos): `map_anchoring = null`, `rounds` usa la p implícita de la serie (o el
  precio directo del mapa si lo hay) y `rounds_by_map` no existe — igual que antes.

### 3. Nivel de serie
- `modelP = σ(0,85 · logit(Elo))` y `C.anchoredProbability(marketP, modelP, { n: sample, maxModel: 0.25 })`.
  `maxModel` ya era parámetro de `core.js` (default 0,45): **core.js no se toca y CS2 no cambia**.
- El objeto `probability` añade `model_p_raw`, `temperature`, `max_model` para que se vea la corrección.

### 4. Signo del ban en `vetoTree`
- **Término de fuerza: ya iba bien.** `pref(side, −1)` da peso `exp(−6·edge)`: cuanto más fuerte el rival
  en un mapa (edge negativo), más probable vetarlo. No se tocó.
- **Término de composición: estaba invertido en el veto.** La fórmula
  `exp(sign·(edge·6 − gap·6·(sign>0 ? 1 : −1)))` con `sign = −1` daba `exp(−6·edge − 6·gap)`: un mapa SIN
  composición (gap alto) salía con MENOS probabilidad de ser vetado, justo lo contrario de lo que dice el
  comentario del código ("un mapa que no sabes jugar se banea aunque el rival tampoco"). Corregido a
  `exp(sign·(edge·6 − gap·6))`: resta al elegir, suma al vetar. Humo: pearl sin composición pasa de ban
  0,541 → 0,863 y de pick 0,021 → 0,004.
- **Prórroga:** tras el tope de 10 parejas, el mapa podía quedar 23-23 y contar como "nadie gana" en el
  margen y en `p_win_a`. Ahora la pareja final se resuelve con una ronda a `pDef` (`while (a === b) play(pDef)`).
- **Extra necesario (salió en el humo):** con el pool medido del circuito de menos de siete mapas, la
  secuencia ban-ban-pick-pick-ban-ban vetaba también el último mapa y un BO3 se quedaba con dos mapas y sin
  decisivo; el tercer mapa de la serie caía al respaldo 0,5 y el anclaje no cuadraba. `step()` ya no veta
  cuando queda un solo mapa en pie. Con siete mapas el comportamiento es idéntico al anterior.

### 5. Incertidumbre del nivel en familias de margen (solo Valorant)
- `RONDAS_HANDICAP` no está en `VOLUME_FAMILIES` → ya pagaba la epistémica entera (incluye el término de
  muestra del par). **No se le suma dos veces.**
- `RONDAS_EQUIPO` sí está en `VOLUME_FAMILIES` → solo pagaba el perfil del mapa. En Valorant ahora paga
  además el término "muestra propia del par" (`14/√n`, leído de `model.uncertainty.drivers`):
  `valUncertaintyFor`, llamada en `evaluateAll` únicamente cuando `game === 'valorant'`. CS2/LoL siguen en
  `uncertaintyFor` sin cambio de firma. `uncertainty_kind` pasa a "perfil de la liga + nivel del par".
  Humo: RONDAS_EQUIPO con n = 40 → 5,14 pp en Valorant vs 4,64 pp por el camino de CS2.

### 6. Persistencia en la pick de Valorant y track
- `valPickMeta(model, Rrow)` cuelga de la fila valorada (solo valorant) `p_map_market` (p anclada del mapa
  de la pick), `p_map_model`, `shift_logit`, `p_round_solved`, `dist_method: 'bisect'`; `recordPicks` los
  guarda en `picks-valorant.json`.
- `track('valorant')` añade `by_dist_method` (n, acierto, unidades, ROI, CLV y desglose por familia); las
  picks anteriores al 2-sep sin `dist_method` salen como `'clamp'`. Los otros juegos no reciben la clave.

## Verificación

```
$ node --check esports-engine/valorant.js && node --check esports-engine/store.js && node --check scripts/smoke/valorant-smoke.js
(sin salida: OK)

$ git diff --stat origin/main..HEAD
 esports-engine/store.js         |  70 +++++++++++++++++++-
 esports-engine/valorant.js      | 139 +++++++++++++++++++++++++++++++++++-----
 scripts/smoke/valorant-smoke.js |  98 ++++++++++++++++++++++++++++
(sin cs2.js, lol.js, dota2.js, core.js ni server.js)

$ node scripts/smoke/valorant-smoke.js
[1] pRound por bisección vs ×0,44 (bias 0,51, eco 0,065, 20.000 sims)
      p_mapa 0.55: pRound 0.5122 → p_win_a 0.5547 (viejo ×0,44: pRound 0.522 → 0.5921) · media 21.31 rondas · prórroga 0.1232
  OK    p_win_a ≈ 0.55 (±0,015)
      p_mapa 0.7: pRound 0.5468 → p_win_a 0.6905 (viejo ×0,44: pRound 0.588 → 0.8267) · media 20.96 rondas · prórroga 0.1105
  OK    p_win_a ≈ 0.7 (±0,015)
  OK    el viejo ×0,44 daba ~0,82 con p 0,70 (lo que el backtest midió)
      p_mapa 0.8: pRound 0.576 → p_win_a 0.7917 (viejo ×0,44: pRound 0.632 → 0.9232) · media 20.39 rondas · prórroga 0.0904
  OK    p_win_a ≈ 0.8 (±0,015)
  OK    cache estable por (p, bias, eco)
[2] analyze() con mercado y ratings sintéticos (BO3, 5 mapas)
      probabilidad: {"p":0.6195,"w_model":0.1,"market_p":0.622,"model_p":0.5966,...,"model_p_raw":0.6131,"temperature":0.85,"max_model":0.25}
      map_anchoring: {"shift_logit":0.28,"bracketed":true,"p_map_market":0.5811,"p_map_market_from":"implícita de la serie anclada",
                      "p_map_model_mean":0.5067,"model_vs_market_pp":-7.44,
                      "maps":[{"map":"haven","p_a_model":0.58,"p_a":0.6462},{"map":"sunset","p_a_model":0.44,"p_a":0.5096},{"map":"lotus","p_a_model":0.5,"p_a":0.5695}]}
      rounds: {"map":"haven","p_map_a":0.6462,"p_map_a_model":0.58,"p_round_solved":0.5354,"p_map_target":0.6462,"p_map_sim":0.649,"dist_method":"bisect","mean_rounds":21.04,"overtime_p":0.1139,"measured":true}
      rounds_by_map[1]: {"map":"haven","p_map_a":0.6462,"p_map_a_model":0.58,"p_round_solved":0.5354,"p_map_sim":0.649,...}
      rounds_by_map[2]: {"map":"sunset","p_map_a":0.5096,"p_map_a_model":0.44,"p_round_solved":0.503,"p_map_sim":0.5139,...}
      rounds_by_map[3]: {"map":"lotus","p_map_a":0.5695,"p_map_a_model":0.5,"p_round_solved":0.5156,"p_map_sim":0.5652,...}
      simulación de serie: {"p_series_a":0.6038,"scores":[{"score":"2-0","p":0.3625},{"score":"2-1","p":0.2412},{"score":"1-2","p":0.1991},{"score":"0-2","p":0.1971}]}
  OK    nivel de serie: maxModel 0,25 y temperatura 0,85
  OK    peso propio ≤ 0,25 (sale 0.1)
  OK    map_anchoring resuelto por bisección
  OK    serie simulada sobre mapas anclados ≈ serie anclada (0.6038 vs 0.6195)
  OK    rounds trae p_round_solved y dist_method bisect
  OK    rounds: p_map_sim ≈ p_map_target
  OK    rounds_by_map con al menos tres mapas
  OK    rounds_by_map: cada mapa reproduce su p anclada
  OK    veto conserva p_a del modelo y map_anchoring.maps lleva p_a_model
  OK    el anclaje conserva el orden de los mapas (forma del veto)
[2b] analyze() con mercado DIRECTO de mapa (anchor.p_map manda sobre el mapa 1)
      market_anchor: {"from":"ganador del mapa 1","family":"MAPA","direct":false,"p_map":0.6818}
      map_anchoring: {"shift_logit":0.787,"p_map_market":0.6818,"from":"mercado directo (ganador del mapa 1)",
                      "maps":[{"map":"haven","p_a_model":0.58,"p_a":0.6818},{"map":"sunset","p_a_model":0.44,"p_a":0.6331},{"map":"lotus","p_a_model":0.5,"p_a":0.6871}]}
  OK    el mapa 1 usa el precio directo del mercado (0.6818)
[2c] analyze() sin fuerza por mapa (solo Elo + serie): estructura sin veto, sin rounds_by_map
  OK    sin veto: rounds por bisección, sin anclaje por mapa ni tabla por mapa
[3] veto: el mapa sin composición se veta MÁS, no menos
      secuencia: a ban pearl · b ban ascent · a pick haven · b pick sunset → decisivo lotus
  OK    con 5 mapas el BO3 deja dos picks y un decisivo (no se veta el último)
      pearl (A sin composición): ban 0.541 → 0.863 · pick 0.021 → 0.004
  OK    la falta de composición SUBE la probabilidad de veto
  OK    la falta de composición BAJA la probabilidad de elección
  OK    A veta primero el mapa donde el rival es más fuerte (pearl)
[4] cs2.js intacto
  OK    cs2.js carga
  OK    ningún mapa acaba empatado

Todo en orden
```

Comprobación adicional de `store.evaluateAll` con filas sintéticas de Valorant (RONDAS, RONDAS_HANDICAP,
RONDAS_EQUIPO) contra el mismo `model`:

```
RONDAS_EQUIPO over 11.5 map 2  p_gp 0.5766 edge 5.03  unc 5.14 "perfil de la liga + nivel del par"
   meta {"p_map_market":0.5096,"p_map_model":0.44,"shift_logit":0.28,"p_round_solved":0.503,"dist_method":"bisect"}
RONDAS under 21.5 map 1        p_gp 0.5471 edge 2.08  unc 4.72 "perfil de la liga"
RONDAS_HANDICAP home -2.5 map 1 p_gp 0.5123 edge -1.4 unc 4.69 "conocimiento del emparejamiento"
RONDAS_EQUIPO unc valorant 5.14 vs cs2 4.64 | cs2 meta present? false
```

- `require('./esports-engine/cs2.js')` funciona (humo [4]); `require('./esports-engine/store')` carga (39 exports).
- **Backtests de `research/backtests-2026-09-02/valorant/` NO re-ejecutados:** además de las rutas absolutas
  viejas (`/home/user/gp-simulador-mundial`), dependen de `h1_preds.json`, `h1_final_ratings.json` y
  `$SP/research/es_full_valorant.json`, que no están en el repo ni en el scratchpad actual. La bisección
  implementada es la misma que `pRoundFor` de `h2_rounds_dist.js` (mismo corchete, misma condición).

## Pendientes

1. **Reponer los insumos del backtest** (`h1_preds.json`, `es_full_valorant.json`) y re-correr
   `h2_rounds_dist.js` / `skeptic_valorant.js` contra el motor nuevo, ya sin réplica local de la bisección.
2. **UI:** `premium.js` pinta `veto.likely_maps[].p_a` (modelo). Valorar si el tablero de veto debe enseñar
   también la anclada (`map_anchoring.maps[].p_a`) como hace la ficha de CS2. No se tocó `public/`.
3. **Datos (§4.5.5 del backtest):** guardar ambos lados de cada mercado de rondas y la p de mercado al nacer
   (ahora `p_map_market` ya viaja con la pick; falta el precio del otro lado).
4. Revisar tras una semana `track('valorant').by_dist_method`: comparar `bisect` contra `clamp` por familia
   antes de sacar conclusiones (el backtest avisa de que la bisección quita información falsa, no acierta más).
5. `whatMatters` sigue redactando "el mapa se decide parejo": con la anclada puede no serlo; texto menor.

## Riesgos de merge

- **`server.js`: no tocado.** Riesgo cero por esta rama.
- **`core.js`: no tocado.** `maxModel` se pasa como opción desde `valorant.js`.
- **`store.js`, cinco regiones** (líneas en `origin/main`): tras `uncertaintyFor` (~738, helpers nuevos
  `VAL_LEVEL_FAMILIES`, `valUncertaintyFor`, `valPickMeta`); `evaluateAll` (~780, `uncFam` condicionado;
  ~804, `uncertainty_kind` + spread de `valPickMeta`); `recordPicks` (~1397, spread condicionado);
  `track()` (~1910, `by_dist_method` condicionado). Conflicto probable solo si `main` toca esas mismas líneas
  de `evaluateAll`/`recordPicks`; la resolución es mecánica (añadir el condicional).
- **`valorant.js`:** reescritura de la mitad de `analyze()`; si `main` cambia `analyze()` de Valorant en
  paralelo habrá conflicto y conviene quedarse con esta versión y reaplicar lo de `main` encima.
- **Comportamiento en producción al desplegar:** las picks de Valorant cambian de distribución (ya no
  nacerán las under que salían del ×0,44, §4.3) y de nivel por mapa. Es el efecto buscado; el registro
  queda separable por `dist_method`.
- **`GP_EXPORT` / consumidores de `track`:** `by_dist_method` es una clave nueva solo en Valorant; nadie la
  lee todavía, nada se rompe.
