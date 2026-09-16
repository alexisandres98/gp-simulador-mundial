# Plan de trabajo — rentabilidad (16-sep-2026)

> **Para la sesión que lo ejecute:** este plan sustituye a "lo que queda" de
> `docs/PLAN_TRABAJO_AUDITORIA_2026-09-15.md`. Las decisiones de aquí **ya están tomadas** por orden de
> Alexis del 16-sep ("toma las decisiones tú mismo, incluidas las de modelo; el objetivo es rentabilidad").
> No se vuelven a consultar: se ejecutan en el orden escrito y se anota en `docs/REGISTRO_EXPERIMENTOS.md`
> lo que sale. Lo único que este plan no puede decidir es lo que exige la mano de Alexis en un panel (las
> claves) y meter dinero real: **la regla del dinero del 13-sep sigue intacta**. Nada pasa a dinero real sin
> cruzar G2 con el criterio preregistrado de este documento.

---

## 0. El diagnóstico del que sale todo (léase antes de ejecutar nada)

Doce motores medidos el 16-sep sobre sus propios libros liquidados
(`docs/CALIBRACION_2026-09-16.md`, `/api/internal/calibracion`):

- **El modelo se pasa entre +6 y +16 pp donde el precio acierta a 0-4 pp, en las mismas apuestas, en
  nueve de los doce.** El único calibrado es baloncesto, cuyas picks ya están apagadas.
- **Cero volteos de orientación.** El problema no es un bug de signo: es exceso de confianza sistemático.
- **Ninguna familia pasa G0.** Las cinco con EV medible lo tienen negativo. La familia con dinero real
  (tenis de mesa) tiene EV −7,6 % contra un margen del 5 % por lado.
- La autopsia del 2-sep ya lo decía con otro método: `c ≤ 0` en casi todas las familias — **el modelo no
  añade información sobre el precio**. Lo que ganó históricamente (`cs2_rounds_v1`, `cards_under_v1`) ganó
  por precio y momento, no por modelo.

**La conclusión estratégica, y es la que ordena este plan:** *mejorar el modelo para batir el cierre en
mercados eficientes* no es un camino con evidencia a favor en ninguno de los once deportes. Los caminos
que sí tienen evidencia, o al menos una hipótesis estructural que el mercado puede no estar pagando, son
cuatro y están en el §2. Todo lo demás —CS2, LoL, Valorant, Dota, TT, dardos como generadores de picks—
**se congela como control y deja de recibir ingeniería**, porque cada hora invertida ahí es una hora que
no va a producir una pick financiable.

Y una regla operativa que sale directa del diagnóstico: **la primera forma de rentabilidad es dejar de
publicar probabilidades falsas.** Una pick que no nace no pierde. El encogimiento al precio (§1.1) va a
matar la mayoría de las picks del sistema, y eso es el resultado correcto, no un daño colateral.

---

## 1. Decisiones tomadas

Cada una con el número que la justifica. **Ninguna se reabre durante la ejecución.**

### 1.1 Modelo — las que cambian qué picks nacen

| # | decisión | por qué | cómo |
|---|---|---|---|
| **M1** | **Encogimiento al precio en TODAS las familias**, con `c` por familia ajustado hacia adelante y suelo `c ≥ 0`. `p* = σ(logit(p_mkt sin margen) + c·[logit(p_gp) − logit(p_mkt)])`. | El modelo se pasa 10-16 pp donde el precio acierta. Publicar `p_gp` crudo es publicar un número falso, y las picks nacen de esa falsedad. | Módulo nuevo `lib/encogimiento.js`; `c` walk-forward por familia sobre el libro liquidado, reajuste semanal; `c` y su n viajan en cada pick. **Doble corrida durante 14 días**: la versión actual y la encogida conviven en sombra bajo `rule_version` distinta; a los 14 días la encogida pasa a ser la que publica. Esto **modifica la orden del 15-sep** de "seguir publicando córners y goles normal": se sigue publicando, pero con la probabilidad honesta. |
| **M2** | **Segunda mitad condicionada al marcador del descanso.** Multiplicador por estado (6 estados) sobre cada λ de mitad, ajustado sobre las 27.816 filas de `scripts/mitades-condicional.js` y validado hacia adelante. | El que va perdiendo marca +0,117 goles más de lo previsto y el que gana −0,060; rango 0,177 = 24 % de la λ de media parte; 5 de 6 estados con \|t\| ≥ 3. **Es la única hipótesis del sistema con estructura que el mercado puede no estar pagando**: si Cloudbet cotiza HTFT y 2T desde mitades independientes, la ventaja es real y grande. | `goal-engine/mitades.js` → `descansoFinalCondicional()`; familias `htft_v2`, `h2_1x2_v2`, `h2_ah_v2`, `h2_team_total_v2` en sombra con preregistro. Las v1 se retiran como financiables (D4) y quedan de control. |
| **M3** | **Córners: adoptar `T2a\|nb` como `corners_v2`.** Fuerzas de equipo con `damp` libre en [0,1], sin paridad, vida media elegida en validación interna. | Gana a producción con Δlog −0,00365, t −3,87, 7.405 partidos, pasa BH. | Preregistro `docs/PREREGISTRO_CORNERS_V2.md`; sombra con versión propia; producción no cambia hasta G2. |
| **M4** | **`TOTALS_DAMP` separado por familia** en el auto-tune, y la rejilla se amplía a `[0, 0,25, 0,5, 1]`. | Un solo número sirve a dos familias que lo piden distinto, y las dos piden 1 con frecuencia mientras la rejilla se queda en 0,5. | `server.js` bloque del auto-tune: un `bestDamp` por familia con su propio score. Byte-idéntico si las dos eligen lo mismo. |
| **M5** | **Árbitro: ON en tarjetas, OFF en córners.** Se confirma lo que hay. | Aislado con el mismo arnés: mejora tarjetas (t −3,80) y empeora córners (t +2,12). | Nada que cambiar. Se anota como decisión medida en `docs/CONTRATOS_CASA.md`. |
| **M6** | **Dardos: cambiar el objetivo de `calibrate()` a la media censurada** (partido contra rival de referencia), reajustar todos los jugadores, y **las dos aproximaciones del DP se quedan apagadas para siempre**. | Sesgo hasta +9,95 puntos en jugadores flojos, monótono en fuerza. Las del DP valen 0,026 y 0,017. | `darts-engine/kernel.js`: `calibrate()` usa `mediaObservada()` de `scripts/darts-censura.js` como objetivo; caché de calibración invalidada; `node scripts/darts-fit.js --write`. Sombra nueva `dardos_v2`. **Dardos sigue sin ser candidato a dinero**: el arreglo es de honestidad, no de ventaja. |
| **M7** | **LoL: ensanchar el recorte del reparto a [0,30, 0,95]** y reajustar `gen-priors`. | Probabilidad cero al 3,81 % de la realidad; cae sobre KILLS_HANDICAP y KILLS_DNB. | `esports-engine/lol-gen.js`; `node scripts/lol-gen-fit.js --write`; sombra `lol-gen-3`. **Control, no candidato.** |
| **M8** | **Tenis: `shift` OFF · C7 ON.** | `shift` resta (t +6,28); C7 lo bate en WTA (t −4,83). | Interruptores existentes; sombra con versión nueva. **Control, no candidato** (EV medible negativo, margen alto). |
| **M9** | **Tenis de mesa: `GP_TT_UNC_FAMILIA=1` y `GP_TT_DEDUP_EQUIV=1`.** | Endurece el listón un 15-18 % y deja de ver cinco apuestas donde hay dos. Menos picks, menos pérdida. | Env en Render + deploy. |
| **M10** | **CS2: ninguna inversión más en el modelo de rondas.** Se queda como control con `cs2-s1` disponible pero no adoptado. | Ausencia de dato **seleccionada** (placebo t 2,80) con suelo físico del 10-12 % por bo3.gg; EV −3,46 %, t −6,61. No hay camino. | Nada. Se retira de la lista de candidatos y se dice. |
| **M11** | **Valorant: congelado hasta que tenga fuente de resultados.** | No la tiene. Un motor que no puede liquidar no puede medirse. | Nada. |

### 1.2 Dinero real y canales

| # | decisión | por qué |
|---|---|---|
| **R1** | **Apagar el canal real de tenis de mesa** (`GP_REAL_TT_ENABLED=false`). | EV −7,6 % (t −6,16) contra un margen del 5 % por lado, y la entrada es igual al cierre en 17 de 21: el EV se reduce exactamente a menos el margen. Son 5 USD planos, así que la exposición es trivial — pero un canal que pierde por construcción no es un experimento, es una fuga. Es coherente con la regla del dinero: no se **añade**, se **quita** lo que está medido perdiendo. |
| **R2** | **Retirar formalmente `cs2_rounds` como canal real** (ya pausado). | M10. |
| **R3** | **Tarjetas: sigue pausado.** Fondos fuera. Se reevalúa **solo** cuando `cards_under_v2` cruce G1 con la cara contraria acumulada. | Sin EV medido; ventaja inflada 2,24-3,35 pp; IC del núcleo [−8,56, +28,30]. |
| **R4** | **Polymarket real: sigue simulado.** | La sombra neta es −1,44 %. Pero ver C1 en §2: hay un segmento que sí merece la medición. |
| **R5** | **Libro transaccional: append-only con hash encadenado** sobre `signal-registry/`, no migración a `pg`. | Es la recomendación del plan del 15-sep y el coste de la migración no se justifica con cero familias financiables. |

### 1.3 Lo que solo puede hacer Alexis (bloquea, no se ejecuta)

- **D8**: rotar Render, Hetzner, `GP_REAL_RELAY_TOKEN`, `API_FOOTBALL_KEY`. El plan deja escrito en cada
  fase qué dependía de ello.
- **Los interruptores de Render** de M9 y R1: la sesión ejecutora los puede cambiar por API (tiene la
  clave) y disparar deploy. Lo hace y lo anota en `docs/DESPLIEGUE.md` o equivalente. Si Alexis prefiere
  hacerlo él, lo dice; si no dice nada, se ejecuta.

---

## 2. Los cuatro candidatos a dinero (y solo estos)

Con la evidencia de hoy, estos son los únicos lugares donde hay una razón medida —o una hipótesis
estructural con número detrás— para pensar que puede haber ventaja después del margen. **Todo el esfuerzo
de "buscar rentabilidad" va a estos cuatro. Nada más recibe trabajo de modelo.**

| # | candidato | evidencia hoy | qué le falta para G1 | qué le falta para G2 |
|---|---|---|---|---|
| **C1** | **Polymarket `fútbol·No`** | +86,54 neto (+2,71 %) en 106 apuestas, **comisión ya descontada**. Único segmento con muestra y signo positivo. | Bootstrap por evento, BH junto a los otros 9 segmentos, y separar si el `Yes` (−21 %) y el `No` son el mismo mercado visto de dos lados (si lo son, el "edge" es selección). | Regla congelada, 100 eventos prospectivos, cuotas ejecutables con profundidad de libro. |
| **C2** | **HTFT / 2T condicional (M2)** | Estructura real de 0,177 goles que el modelo independiente no ve. **Hipótesis**: Cloudbet tampoco la ve. | Construir M2; medir contra el **cierre de Cloudbet en HTFT y 2T**: si la probabilidad implícita del cierre ya lleva la condicionalidad, no hay edge y se cierra en una semana. Si no, hay. | Sombra `htft_v2` 100 eventos con cara contraria. |
| **C3** | **Córners `corners_v2` (M3)** | Gana al modelo actual t −3,87 sobre 7.405 partidos. | Medir el **margen de Cloudbet en córners** (`lib/margen.js` sobre el archivo de cierres; hoy no se sabe) y el EV al cierre de la v2 en replay sobre el libro de córners. Si el margen es ≥ 4 %, se cierra: no hay modelo que lo cubra. | Sombra 100 eventos. |
| **C4** | **Tarjetas `cards_under_v2`** | La más cerca en G0 (6/7). Contrato arreglado. Cara contraria acumulando. | EV al cierre con la contraria (≥ 100 eventos). Nada que construir: **esperar**. Punto de decisión ≈ 20-oct. | Ya está en sombra preregistrada. |

**Condicional, fuera de la lista hasta que se verifique un dato:** Underdog props (soft book por
construcción). Si la tabla de multiplicadores resulta ser 3,5× el boleto da +1,83 %; si es 3×, −12,71 %.
El feed además está caído (426). Se verifica la tabla en la Fase A (una tarde); si sale 3,5× y el feed
vuelve, entra como **C5**. Si no, se retira.

**Y una advertencia honesta sobre plazos:** G2 exige 100 eventos prospectivos bajo regla congelada. Al
ritmo actual eso son **6-8 semanas como mínimo** para el primer candidato. Ninguna fase de este plan puede
acortarlo: el tiempo lo pone la muestra.

---

## 3. Fases

Orden estricto. Dentro de cada fase, las tareas marcadas ∥ se pueden paralelizar.

### Fase A — Destapar los datos que bloquean la medición (días 1-3)

Sin esto, dos de los cuatro candidatos no se pueden medir.

| tarea | qué | bloquea a |
|---|---|---|
| **A1** | **Archivos de resultados de clubes.** `results-<liga>.json` tiene cero filas en laliga, irlanda, brasilb, suiza, polonia y menos de 60 en otras seis. Averiguar por qué la cosecha no escribe en el disco de Render (ruta, permisos, liga no cubierta por la fuente), arreglarlo, **relanzar la liquidación de las 1.807 derivadas** en `DATA_UNRESOLVED` y las 2.013 `ACTIVE`. Diagnóstico ya puesto: `diag_marcador` en la pasada de derivadas. | C2, C3 (los dos viven en fútbol de clubes) |
| **A2** ∥ | **Los tres casos `fuera_de_ventana: true`** (superettan, sudamericana, libertadores): el par está en el archivo con fecha a más de dos días. Casi seguro zona horaria — usar `lib/zona.js`. | A1 |
| **A3** ∥ | **Verificar la tabla de multiplicadores de Underdog.** Probar desde otra IP/UA; si el sitio sigue en 403/426, buscar la tabla en la documentación pública o en capturas de terceros con fecha. Decide el signo del C5. Si no se puede verificar en una tarde, **C5 se retira** y se anota. | C5 |
| **A4** ∥ | **Margen de Cloudbet en córners y en HTFT/2T**, con `lib/margen.js` sobre los archivos de cierres de derivadas. Si el archivo no tiene la cara contraria en esas familias, esto se convierte en el primer paso de la Fase B. | C2, C3 |
| **A5** ∥ | **Leer los tres reglamentos** (Cloudbet primero: esports rondas de prórroga, TT retiro, fútbol descanso prolongado; luego Pinnacle esports/NFL; luego Bovada kills/dardos) y cerrar `contrato_documentado` y `liquidador_concuerda` en las nueve familias contra `docs/LIQUIDADORES_DECLARADOS_2026-09-16.md`. Donde no concuerde, se arregla el liquidador. | G0 de todas |

**Salida de la Fase A:** derivadas liquidando; margen de córners y HTFT conocido; Underdog verificado o
retirado; nueve familias con contrato declarado.

### Fase B — El encogimiento y la retirada de lo falso (días 3-7)

| tarea | qué |
|---|---|
| **B1** | **M1**: `lib/encogimiento.js` + `c` por familia walk-forward + doble corrida 14 días. Empieza por fútbol de clubes (goles, córners, tarjetas, derivadas) porque es lo que ven los usuarios; después esports, tenis, TT, dardos, combate. |
| **B2** ∥ | **R1, R2, M9**: apagar TT real, retirar CS2 real, encender los dos interruptores de TT. Env por API de Render + deploy. Anotar en el registro de decisiones con la fecha. |
| **B3** ∥ | **M8, M7, M6, M11**: tenis `shift` OFF / C7 ON; LoL recorte a [0,30, 0,95] y refit; dardos objetivo censurado y refit; Valorant congelado. Cada uno con su `rule_version` nueva en sombra. **Son controles**: se hacen para que la sombra diga la verdad, no porque vayan a producir dinero. Si el tiempo apremia, B3 va detrás de las Fases C y D. |
| **B4** ∥ | **M4**: `TOTALS_DAMP` por familia, rejilla hasta 1. |

**Salida de la Fase B:** cada familia publica una probabilidad encogida al precio con su `c` a la vista.
El número de picks va a caer mucho. **Eso es la fase funcionando.**

### Fase C — Los dos candidatos de fútbol (días 5-12)

| tarea | qué |
|---|---|
| **C-1** | **M2**: `descansoFinalCondicional()` con el multiplicador por estado; preregistro `docs/PREREGISTRO_HTFT_V2.md` (criterio de éxito ESCRITO antes de la primera observación: EV al cierre > 0 con t ≥ 2 sobre ≥ 100 eventos, cara contraria, BH con las demás); sombra `htft_v2`, `h2_1x2_v2`, `h2_ah_v2`, `h2_team_total_v2`. |
| **C-2** | **La prueba que decide C2 en una semana**: replay sobre el libro de derivadas ya liquidado (con A1 hecho) — ¿la probabilidad implícita del cierre de Cloudbet en HTFT reproduce la condicionalidad o no? Se mide el desvío del cierre por estado al descanso igual que se midió el del modelo. **Si el cierre ya la lleva, C2 se cierra y se dice.** Si no la lleva, C2 es el candidato principal del sistema. |
| **C-3** ∥ | **M3**: `corners_v2` con preregistro y sombra; replay del EV al cierre de la v2 sobre el libro de córners (con A4 hecho). **Si el margen medido en A4 es ≥ 4 %, C3 se cierra.** |

### Fase D — Polymarket `fútbol·No` (días 5-9, ∥ con C)

| tarea | qué |
|---|---|
| **D-1** | Bootstrap por evento del segmento; BH sobre los 10 segmentos; contrastar `Yes` y `No` del mismo mercado (si son complementarios, la suma de los dos es lo que hay que mirar, y es −206). Salida: `docs/POLYMARKET_FUTBOL_NO_2026-09.md` con veredicto **G1 pasa / no pasa**. |
| **D-2** | Si pasa: preregistro `docs/PREREGISTRO_PM_FUTBOL_NO.md` con regla congelada, profundidad de libro mínima y comisión por fill; la sombra actual sigue pero con la versión nueva etiquetada. Si no pasa: se cierra y se anota. |

### Fase E — Las puertas que faltan y el libro (días 8-14, ∥ con C y D)

| tarea | qué |
|---|---|
| **E1** | **G2 en código** (`lib/puertas.js`): versión congelada (hash de la regla), criterio preregistrado con fecha anterior a la primera observación, BH sobre las familias en sombra, cuotas ejecutables (la que se pudo tomar, no la mejor del mercado). Evalúa sobre el libro prospectivo desde la fecha del preregistro. |
| **E2** | **G3 en código**: presupuesto absoluto de pérdida, límite por evento y por día, conciliación fills-vs-casa (reusar `real-executor/parada.js` y la conciliación de caja del 15-sep). Con la advertencia escrita: veinte órdenes no validan el edge. |
| **E3** | **G4 en código**: rentabilidad neta con IC por racimos, capacidad al tamaño siguiente (degradación de precio medida), drawdown máximo. |
| **E4** ∥ | **R5**: libro append-only con hash encadenado para el libro real y las cotizaciones, sobre `signal-registry/`. Verificación de cadena en `/api/internal/parada`. |

### Fase F — Esperar y medir (desde el día 14)

No hay nada que construir aquí. La sombra corre, la cara contraria se acumula, `/api/internal/puertas` dice
en qué puerta está cada candidato. Revisión **semanal** con este orden de preguntas, y solo estas:

1. ¿Algún candidato pasó G1? Si sí, ¿tiene preregistro con fecha anterior a su primera observación?
2. ¿Algún candidato en G2 llegó a 100 eventos? Si sí, ¿EV al cierre > 0 con t ≥ 2 y pasa BH?
3. ¿Alguna familia congelada muestra algo que la reabra? (Solo si pasa BH junto a las demás; una sola
   familia "buena" entre veinte es lo que sale por azar.)

**El 20-oct** sigue siendo el punto de decisión de tarjetas (C4). Si cruza, es la primera con derecho a
G3 — con presupuesto de pérdida escrito, stake plano y los frenos de `parada.js`.

---

## 4. Lo que este plan NO hace, a propósito

- **No busca ventaja en CS2, LoL, Valorant, Dota, TT ni dardos.** Se les arregla lo que está roto para que
  la sombra diga la verdad (B3) y se dejan como control. Cualquier hora de modelo ahí es una hora perdida
  con la evidencia de hoy.
- **No mete dinero en ningún sitio.** Quita el que está midiendo pérdida (R1).
- **No promete plazos de dinero.** El primer candidato posible a G3 es tarjetas el 20-oct; los demás, 6-8
  semanas después de su preregistro como mínimo, y solo si la muestra dice que sí.
- **No cambia la vara.** `lib/ev.js`, `lib/vara.js`, `lib/inferencia.js`, `lib/puertas.js` y sus listones
  se quedan como están. El 5 % de `sin_resolver` incluido: CS2 demostró que estaba protegiendo algo real.

---

## 5. Qué esperar al final

Si todo sale como la evidencia sugiere:

- **Muchas menos picks publicadas**, con probabilidades que aciertan lo que dicen. Es el primer resultado y
  el más seguro.
- **Uno o dos candidatos vivos en G2** (lo más probable: C1 y C2, o C1 y C4) acumulando muestra
  prospectiva bajo regla congelada.
- **Dos o tres candidatos cerrados con el número que los cierra** (lo más probable: C3 si el margen de
  córners es alto; C5 si Underdog no se verifica).
- **Un sistema en el que se puede decir qué haría falta para meter dinero en cada familia**, que es lo que
  faltaba el 15-sep y sigue faltando hoy.

Si C2 resulta que el mercado ya lleva la condicionalidad, y C1 no sobrevive a BH, y tarjetas no cruza el
20-oct, la respuesta honesta al final de este plan será **"no hay ninguna familia financiable y ya sabemos
por qué en cada una"**. Esa respuesta también vale el trabajo: es la diferencia entre no tener dinero
invertido porque no se sabe y no tenerlo porque se midió.

---

## 6. Convenciones para la sesión ejecutora

- Cada cambio de modelo nace con `rule_version` nueva y **su preregistro escrito antes** del primer pick
  (`docs/PREREGISTRO_*.md`, formato del de tarjetas). Sin preregistro no hay sombra.
- Todo experimento va a `docs/REGISTRO_EXPERIMENTOS.md` con E-nnn, fecha, hipótesis, resultado.
- Tests: `node --check` + los `tests/*.test.js` que toquen + los cinco humos de `scripts/smoke/` antes de
  cualquier deploy que toque tenis, Valorant, baloncesto, fútbol de clubes o combate.
- Deploy: push a `claude/gpsim-continuation-vrjuww` y `HEAD:main`, POST al deploy de Render, poll a `live`,
  `/api/health` 200, y comprobar las sondas que el cambio toque.
- Secretos solo en el scratchpad; nunca en el repo ni en el chat.
- Al cerrar cada fase: actualizar la cabecera de `HANDOFF.md` y de `TODO_NEXT.md` con lo hecho y lo que
  queda, en este mismo formato.
