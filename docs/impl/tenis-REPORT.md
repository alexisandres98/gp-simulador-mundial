# REPORT — mejoras de TENIS (rama `impl/tenis`, 2-sep-2026)

Base: `origin/main` @ `72f9c1d` (comprobado). Rama empujada a `origin/impl/tenis`, sin cambios sin commitear.
Ni `server.js` ni `main` ni `claude/*` se tocaron. Nunca se arrancó `server.js`: todo se verificó con
`node --check` y scripts que requieren el motor directamente.

## Commits (en orden)

| Hash | Tema |
|---|---|
| `045b8f57` | Edad lineal y calendario ATP en el logit del ensamble (tareas 1 y 2) — `adjustments`, `what_matters`, `dist_method` |
| `a0f0e608` | C6 en la distribución de juegos, SOLO ATP bo3 + `scripts/tennis-resid.js` + tabla en `model-priors.json` (tarea 3) |
| `fb70930e` | `best_of` de la cola ESPN desde el marcador + `--repara-bo` + copia del repo reparada (tarea 4) |
| `d9b97574` | Track por evento, preregistro TOTAL ≥ 8 pp, cierres con todas las líneas + smoke (tareas 5, 6, 7) |

## Archivos tocados (8, todos de tenis)

- `tennis-engine/store.js` — `ajustesGanador` / `aplicarAjustes` / `ajustesWhatMatters` (edad + calendario ATP),
  `gamesPmf` (C6 vs desplazamiento) y `distProbs` con `dist_method`, `eventModel` / `simMatch` / `matchDetail`
  exponen `p_a_base`, `adjustments`, `what_matters`; `gate` lleva `dist_method`; `recordShadow` guarda
  `edge_pp_at_create` / `prereg_total8` / `dist_method` en TOTAL; `lineasDe` + `snapshotCloses` con
  `totals_all` / `spreads_all` (máx. 12 líneas, mejor cuota por lado y casa, Pinnacle aparte);
  `settleShadow` busca la línea exacta de la pick (`close_source`, `close_missing`, `clv_pin_pct`);
  `track()` añade `por_evento.TOTAL` (todas / edge8 / preregistradas / abiertas_prereg). Exporta además
  `gamesPmf`, `distProbs`, `ajustesGanador` para el smoke.
- `scripts/tennis-resid.js` — NUEVO: pasada congelada del compilado (copiada de `pass.js::runTour`, variante de
  producción), residuo `R = round(juegos reales − calG)` por formato × tercil de `expGames` en desarrollo
  2018→2024-12-31, comprobación en holdout, escritura en `constants.gamesResid` (merge).
- `scripts/tennis-fit.js` — conserva `gamesResid` al reescribir los priors y avisa de re-correr `tennis-resid.js`.
- `data/tennis/model-priors.json` — `tours.atp.constants.gamesResid` (bo3 usado, bo5 guardado) y
  `tours.wta.constants.gamesResid` (bo3 guardado, bo5 `null`: no hay partidos). Nada más cambia en los priors.
- `scripts/tennis-espn-tail.js` — `formatoDe(tn, setsGanador, nivel)`, reparación de la cola en cada pasada
  con `--apply` (también cuando no hay nada nuevo que traer), modo `--repara-bo` sin red, `escribe` hoistado.
- `data/tennis/matches.json` — 1.024 de 1.526 filas de la cola con `best_of` corregido; ninguna otra celda cambia
  (comprobado fila a fila contra HEAD).
- `docs/PREREGISTRO_TENIS_TOTAL.md` — NUEVO: regla fija, unidad de cuenta (evento), vara (CLV vs Pinnacle), corte.
- `scripts/smoke/tenis-smoke.js` — NUEVO: 38 comprobaciones sin red.

## Decisiones de implementación que conviene saber

1. **ATP = índice 0** (`tourSpwStart` 0,63 en `data.js`); constante `ATP` en store.js. WTA no recibe ningún ajuste
   (`age: 'no aplica (WTA…)'`, `calendar: 'no aplica (WTA)'`) y su `p_a === p_a_base` (comprobado en el smoke).
2. **Edad**: `dob` numérico `YYYYMMDD` en `players.json` (2.517 de 2.632 jugadores lo tienen; los ids nuevos de
   la cola nacen con `dob: null`). Sin dob en alguno → no se aplica y `adjustments.age` lo dice
   (`'sin fecha de nacimiento de a|b|ambos: no se aplica'`). Edad a la fecha de `commence_time` (simulador: hoy).
3. **Calendario**: se exige `prof.lastDate ≥ meta.tail.from` (20260526) en AMBOS; si no, `calendar: 'sin fecha
   real'`. Días = `min(60, max(0, día − último))`, `n7` de `prof.recent` (14 últimos partidos, suficiente). Se
   anota `calendar_detail.base_lag_days`: **ojo**, si la base va N días por detrás del partido, los días de los
   dos se inflan por igual (el Δlog1p se comprime, no cambia de signo) y `n7` sale 0 para ambos. Con la base al
   día (cola diaria en Render) no pasa; con el repo (base al 20-ago) el smoke lo muestra: 15/15 días, n7 0/0.
4. **C6**: la masa de `calG + R` se reparte entre los dos enteros vecinos (misma mecánica `distAffine` que
   validó el backtest), así el soporte queda entero y `push` está definido en líneas enteras. La tabla viaja
   redondeada a 6 decimales y `gamesPmf` renormaliza (ΣPMF = 1 exacto). El tercil se decide con el `expGames`
   CRUDO del compilador (cortes ATP bo3: 24,73 / 25,04). `calG` usa `gamesCal` de producción (no un re-fit):
   coincide con el backtest a la 3ª decimal (−10,985/1,386 vs −10,991/1,387).
5. **SPREAD** sigue exactamente igual (margen del compilador sin C6), como pide la spec.
6. **Formato en la cola**: `sw === 3 → 5; si no, (ATP y nivel G) → 5; resto → 3`. Difiere de la regla literal
   "2 → bo3" en 7 filas ATP de Grand Slam con 2 sets ganados (retiros mal fechados como completos): un Grand
   Slam masculino nunca es bo3. `tennis-resid.js` usa la regla de `pass.js` (2 → bo3) para reproducir el backtest;
   la diferencia son esas 7 filas.
7. **Reparación en Render**: no hace falta tocar `tennisTailJob`. La pasada diaria (`--apply --paso=2`) repara la
   cola del disco persistente en su siguiente ejecución, incluso si no hay partidos nuevos.
8. **Por evento**: una unidad por `event_id` repartida a partes iguales entre sus picks; acierto = signo de esa
   unidad (0 = no decidido); CLV promediado dentro del evento y después entre eventos; SE y t incluidos.
   `edge8` filtra por `edge_pp_at_create ?? edge_pp` (histórico); `preregistradas` solo por la bandera.
9. **Pinnacle**: `lineasDe` guarda `pin_over/pin_under` (`pin_a/pin_b`) por línea cuando la casa cotiza;
   `settleShadow` anota `close_pin` y `clv_pin_pct`, y `por_evento` los agrega en `clv_pin_*`.

## Verificación

### `node --check`
`tennis-engine/store.js`, `scripts/tennis-resid.js`, `scripts/tennis-fit.js`, `scripts/tennis-espn-tail.js`,
`scripts/smoke/tenis-smoke.js`, `server.js` (sin cambios): todos OK.

### `node scripts/tennis-resid.js` (82 s)
```
[atp] pasada: 23290 partidos completos desde 20180101 · 35.7s
[atp] bo3: n=14917 cortes expGames 24.73 / 25.04 · por tercil n=4960/4978/4979 · media R 0.15 / -0.27 / 0.09 · soporte 30/29/28
[atp] bo5: n=3467 cortes expGames 40.11 / 41.12 · por tercil n=1155/1156/1156 · media R -0.14 / -0.35 / -0.17 · soporte 43/51/52
[wta] pasada: 21399 partidos completos desde 20180101 · 20.5s
[wta] bo3: n=16911 cortes expGames 23.97 / 24.38 · por tercil n=5634/5639/5638 · media R -0.03 / -0.09 / 0.25 · soporte 33/30/30
[wta] bo5: 0 partidos en desarrollo — sin tabla

[holdout 2025→] comprobación (solo lectura; positivo = C6 mejor que el desplazamiento):
┌───────┬─────────┬──────┬───────────────────┬────────────────┬───────────────────────────┬───────────┬───────────────────┬────────┐
│ tour  │ formato │ n    │ P(real>med) shift │ P(real>med) c6 │ ΔBrier abanico (shift−c6) │ t abanico │ ΔBrier línea fija │ t fija │
├───────┼─────────┼──────┼───────────────────┼────────────────┼───────────────────────────┼───────────┼───────────────────┼────────┤
│ 'atp' │ 'bo3'   │ 3931 │ 0.419             │ 0.456          │ 0.00328                   │ 5.38      │ 0.00527           │ 5.56   │
│ 'atp' │ 'bo5'   │ 975  │ 0.475             │ 0.508          │ 0.00082                   │ 0.61      │ 0.00044           │ 0.32   │
│ 'wta' │ 'bo3'   │ 4488 │ 0.444             │ 0.494          │ 0.00056                   │ 1.03      │ 0.00105           │ 1.26   │
└───────┴─────────┴──────┴───────────────────┴────────────────┴───────────────────────────┴───────────┴───────────────────┴────────┘
[resid] gamesResid escrito en data/tennis/model-priors.json
```
Coincide con el backtest en dirección y magnitud: ATP bo3 mejora (el backtest daba ΔBrier 0,0029 con t 9,9 por
bootstrap; aquí t 5,4 con SE analítica), bo5 y WTA sin efecto → tabla guardada y NO usada, como se acordó.

### `node scripts/tennis-espn-tail.js --repara-bo [--apply]` sobre la copia del repo
```
[cola] formato: 1526 filas de la cola revisadas · 1024 con best_of corregido desde el marcador
[cola] escrito en …/data/tennis (solo reparación de formato)
(segunda pasada) [cola] formato: 1526 filas de la cola revisadas · 0 con best_of corregido · nada que reparar
```
Antes: ATP nivel 250 `bo5` 516, WTA `bo5` 508. Después: ATP 250 → bo3 (516), WTA → bo3 (508), ATP Grand Slam
bo5 (207). Diff fila a fila contra HEAD: 1.024 celdas `best_of` cambiadas, 0 otras.

### `node scripts/smoke/tenis-smoke.js` (38 OK, 0 fallos, 428 ms)
```
Frances Tiafoe vs Taylor Fritz · tennis_atp_cincinnati · bo3
  p_a base 0.37 → 0.371  (edad logit 0.0047 = 0.11 pp · calendario logit 0 = 0 pp · calendario: aplicado {"days_a":15,"days_b":15,"n7_a":0,"n7_b":0,"base_lag_days":15})
  dist_method c6 (tercil 2) · exp_games 24.12 · mediana 23 · P(over 23) 0.4462 push 0.0620 · P(over 23.5) 0.4462 · ΣPMF 1.000000
Christopher Oconnell vs Felix Auger Aliassime · tennis_atp_us_open · bo5
  p_a base 0.159 → 0.143  (edad logit -0.1274 = -1.63 pp · edad {"a":32.25,"b":26.07,"diff":6.18})
  dist_method shift · exp_games 34.43 · P(over mediana) 0.4857
Lorenzo Musetti vs Alexander Zverev · tennis_atp_paris_masters · bo3
  p_a base 0.323 → 0.347  (edad logit 0.1003 = 2.23 pp · calendario logit 0.0083 = 0.19 pp)
  dist_method c6 (tercil 1) · exp_games 23.59 · mediana 22 · P(over 22) 0.4649 push 0.0715 · ΣPMF 1.000000
Aryna Sabalenka vs Madison Keys · tennis_wta_cincinnati · bo3      p_a 0.753 → 0.753 · shift · ajustes 0
Sorana Cirstea vs Marie Bouzkova · tennis_wta_us_open · bo3         p_a 0.634 → 0.634 · shift · ajustes 0
Jessica Pegula vs Amanda Anisimova · tennis_wta_beijing · bo3       p_a 0.595 → 0.595 · shift · ajustes 0
[sim] what_matters: "1. Edad (0.11 pp): Frances Tiafoe tiene 0.2 años menos que Taylor Fritz: el Elo sobreestima a
  los veteranos y el ajuste mueve la probabilidad de Frances Tiafoe +0.11 pp." / "2. Calendario (0 pp): …"
[smoke] todo OK
```
P(over mediana) en ATP bo3 sintético: 0,446 y 0,465 (rango pedido 0,44-0,45 se cumple en el primero; el segundo
cae en el tercil bajo, con más masa en la mediana). PMF suma 1. WTA no cambia.

### `track()` con picks sintéticas (disco local temporal, borrado después)
`por_evento.TOTAL.todas`: 3 eventos de 4 picks, ROI −3,33 % (= media de (0,9−1)/2, −1, 0,95), acierto 33,3 %;
`edge8`: 2 eventos; `preregistradas`: 1 evento; `abiertas_prereg`: 1. Cálculo a mano coincide.

## Pendientes y por qué

- **Frontend**: la ficha de tenis en `public/premium.js` (`renderTenMatch`) no pinta aún `what_matters` ni
  `adjustments`; están en el JSON de `/api/tennis/match` y `/api/tennis/sim`. No se tocó `premium.js` para no
  cruzar regiones con otros agentes; es un bloque de ~10 líneas (hay un `esWhat()` reutilizable en esports).
- **Guarda por retraso de la base en el calendario** (decisión de Alexis): con la base N días por detrás, el
  término de calendario se comprime hacia 0 y n7 se anula para ambos. Hoy se anota (`base_lag_days`) y no se
  bloquea; si se prefiere, una línea en `ajustesGanador` (no aplicar si `base_lag_days > 3`).
- **Cierres de Pinnacle**: `totals_all` recoge `pin_*` solo si The Odds API devuelve `pinnacle` en las regiones
  `eu,us` que pide `refreshOdds` (hoy sí). Sin él, el preregistro cae a la mejor cuota de cierre de la misma
  línea (`clv_pct`), como dice el doc.
- **La tabla de residuos hay que regenerarla tras cualquier re-fit** (`tennis-fit.js` avisa). Si se arreglara la
  espina con fechas reales o entrara saque/resto nuevo, correr `tennis-resid.js` otra vez.
- **Los 7 partidos ATP de Grand Slam con 2 sets ganados** en la cola son retiros sin `ret=1` (la cola no marca
  retiros): fuera de alcance aquí; afecta solo a re-fits.
- **Re-liquidar CLV de picks viejas** con `totals_all`: los cierres antiguos no llevan `totals_all`; solo las
  picks liquidadas desde el deploy tendrán `close_source` distinto de `consenso`.

## Riesgos de merge

- **`server.js`: cero cambios en esta rama.** La ruta `/api/tennis/track` ya devuelve `TEN.track(...)`, que ahora
  incluye `por_evento`; `tennisTailJob` no necesita `--repara-bo` (la pasada diaria repara sola).
- `origin/main` avanzó un commit tras el corte (`547c14e5`, ejecutor real: `real-executor/store.js`, `server.js`):
  ningún archivo en común con esta rama → merge limpio esperado.
- `data/tennis/matches.json` (7,7 MB, una línea): si otra rama lo regenera (cola), el conflicto se resuelve
  quedándose con el suyo y corriendo `node scripts/tennis-espn-tail.js --repara-bo --apply` (idempotente).
- `data/tennis/model-priors.json`: si otra rama corre `tennis-fit.js` con la versión vieja del script se pierde
  `gamesResid` → volver a correr `tennis-resid.js` (82 s). Con la versión de esta rama se conserva.
- En Render la base vive en `/data/tennis`; la reparación de formato del disco la hace la primera pasada
  diaria tras el deploy (o a mano: `node scripts/tennis-espn-tail.js --repara-bo --apply` con `DB_FILE` puesto).

## Cómo probar en preview (sin publicar nada)
```
node --check tennis-engine/store.js && node scripts/smoke/tenis-smoke.js
node scripts/tennis-resid.js --dry           # tabla + comprobación holdout, no escribe
node scripts/tennis-espn-tail.js --repara-bo # simulacro de reparación (cuenta filas)
```
`/api/tennis/match?id=…` → `adjustments`, `what_matters`, `duel.dist_method`; `/api/tennis/track` → `por_evento`.
