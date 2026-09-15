# Los cuatro aspirantes de tarjetas — resultados

> **T2.3 del plan de trabajo de la auditoría externa.** Ejecutado el 15-sep-2026.
> Reproducible: `node scripts/cards-challengers.js --dir <carpeta con props-history-*.json> [--conteo casa]`.
> Registro del experimento: `docs/REGISTRO_EXPERIMENTOS.md` (E-001, E-002, E-003).

## La pregunta

`cards_under_v1` es la única familia con dinero real de verdad (~258 USDT en Cloudbet) y la vara nueva no
la declara invertible. Antes de tocar el stake había que saber una cosa que nunca se midió: **¿el modelo
de tarjetas que la genera es mejor que las alternativas obvias, o solo es el primero que escribimos?**

Hasta hoy el prop-engine solo se había comparado consigo mismo y con "el mercado". Un modelo que gana a
nada no ha ganado nada.

## El montaje

**Datos.** 10.436 partidos de clubes terminados sin prórroga, 40 ligas, temporadas 2025 y 2026
(`data/clubs/props-history-*.json`, el disco persistente de Render). 10.199 con árbitro identificado.
Media de 4,432 tarjetas por partido con varianza 4,935 en el conteo antiguo.

**Protocolo.** Validación hacia adelante en diez bloques mensuales sobre 8.078 partidos, entrenando cada
bloque con todo lo estrictamente anterior. Los hiperparámetros se eligen DENTRO del entrenamiento, en una
validación interna sobre su último 20 %: el bloque que se evalúa no se toca nunca. La incertidumbre de cada
comparación es un bootstrap por racimos de partido (`lib/inferencia.js`), y sobre las doce comparaciones se
aplica Benjamini–Hochberg al 10 %.

**Los aspirantes.**

| id | qué es |
|----|--------|
| **T0** | el modelo actual íntegro: `prop-engine` con el histórico de la liga, `TOTALS_DAMP = 0` (el total ES la media de liga), multiplicador de paridad, **sin árbitro** — exactamente como sale hoy en producción, que es el hallazgo A19 |
| **T1** | nivel dinámico por liga × temporada con decaimiento temporal y dispersión estimada en el mismo estrato |
| **T2a** | T1 × fuerzas de equipo encogidas, con un exponente de amortiguación que elige el propio entrenamiento |
| **T2b** | T2a × árbitro **residual** (estimado sobre lo que queda tras descontar liga, temporada y equipos) |

**Las cuatro leyes de conteo** (`lib/conteos.js`) compiten con **la misma media**, para que la comparación
mida solo la forma de la cola: Poisson, binomial negativa, COM-Poisson (la única que puede SUBdispersar) e
histograma empírico suavizado y reinclinado a la media objetivo.

**Un error de diseño que hubo que corregir a mitad.** La primera corrida daba la paridad solo a T0 y T1
"perdía" contra él. No perdía por su nivel: perdía porque se le había escondido una señal. El interruptor
de paridad entró a la rejilla y se decide como cualquier otro hiperparámetro. Se eligió en 9 de 10 bloques.

## Resultado

### Conteo antiguo (amarillas + rojas)

| aspirante · ley | n | log-score | CRPS | Δ log-score vs T0 | IC 95 % | t | p |
|---|---:|---:|---:|---:|---|---:|---:|
| **T2b · NB** | 8.078 | **2,13079** | **1,17716** | **−0,00897** | [−0,01172, −0,00612] | **−6,25** | <0,0001 |
| T2b · Poisson | 8.078 | 2,13102 | 1,17806 | −0,00897 | [−0,01207, −0,00592] | −5,73 | <0,0001 |
| T2a · NB | 8.078 | 2,13389 | 1,18113 | −0,00536 | [−0,00752, −0,00288] | −4,59 | <0,0001 |
| T0 · NB *(actual)* | 7.289 | 2,13390 | 1,18198 | — | — | — | — |
| T2b · COM | 8.078 | 2,13497 | 1,17903 | −0,00489 | [−0,00812, −0,00157] | −2,85 | 0,0044 |
| T1 · NB | 8.078 | 2,13756 | 1,18633 | −0,00144 | [−0,00289, 0,00002] | −1,92 | 0,055 |
| T2b · histograma | 8.078 | 2,14713 | 1,17926 | +0,00584 | [−0,00061, 0,01263] | 1,74 | 0,082 |
| T1 · histograma | 8.078 | 2,15463 | 1,18865 | +0,01420 | [0,00821, 0,02045] | 4,56 | <0,0001 |

### Conteo de la casa (una roja vale dos — ver más abajo)

| aspirante · ley | log-score | Δ vs T0 | IC 95 % | t | p |
|---|---:|---:|---|---:|---:|
| **T2b · NB** | **2,21086** | **−0,00841** | [−0,01129, −0,00539] | **−5,46** | <0,0001 |
| T2a · NB | 2,21421 | −0,00560 | [−0,00803, −0,00302] | −4,36 | <0,0001 |
| T0 · NB | 2,21362 | — | — | — | — |
| T1 · NB | 2,21793 | −0,00154 | [−0,00312, −0,00004] | −1,97 | 0,049 |

**La conclusión no depende del conteo**, y eso importa: si el ganador cambiara al cambiar la escala, el
resultado sería un artefacto de la escala y no un hallazgo.

## Las tres cosas que esto contesta

### 1. El árbitro es señal, y hoy se entrena y no se sirve (E-003, A19)

T2b y T2a comparten **todo** menos el multiplicador residual del árbitro. Aislado:

| conteo | Δ log-score | IC 95 % | t | p |
|---|---:|---|---:|---:|
| antiguo | −0,00309 | [−0,00473, −0,00152] | −3,80 | 0,0001 |
| de la casa | −0,00335 | [−0,00545, −0,00145] | −3,28 | 0,0010 |

Esto es exactamente el hallazgo A19 con un número detrás: `server.js` llama a `project()` **sin** `referee`
mientras `prop-engine/model.js` lo espera y la validación LOO lo usa. Llevamos meses validando un modelo
que no es el que sirve, y el que no sirve es el mejor de los dos.

Con una condición que hay que decir: el árbitro que gana es el **residual**, estimado sobre lo que queda
tras descontar liga, temporada y equipos. Un árbitro que solo pita en una liga violenta no es un árbitro
estricto, y el multiplicador bruto —el que hay hoy en el código— no sabe distinguirlo.

### 2. Las fuerzas de equipo sí aportan al total, con 10.000 partidos (E-002)

T2a le gana a T0 (−0,00536, t −4,59) y el entrenamiento eligió amortiguación > 0 en **10 de 10 bloques**
(damp = 1 en ocho de ellos). El `TOTALS_DAMP = 0` del prop-engine se calibró con los **102 partidos** del
Mundial, donde cada equipo tenía 4-6 partidos; a escala de clubes la señal existe. La constante no estaba
mal: estaba calibrada para otro tamaño de muestra, y nadie volvió a mirarla.

### 3. La familia paramétrica no sobra, y la binomial negativa es la correcta

El **histograma empírico pierde con claridad** contra las tres leyes paramétricas en las dos escalas, así
que suavizar la forma observada no basta. Y **COM-Poisson pierde contra NB**: el conteo de tarjetas está
sobredispersado, no subdispersado, así que la restricción de la NB —que solo puede sobredispersar— no está
mordiendo. Elegir NB fue acertado; ahora está medido en vez de supuesto.

## El hallazgo que no estaba en el guion: contamos mal las tarjetas

`scripts/cards-contrato.js`. El reglamento de Cloudbet («Booking Markets», copia literal en
`docs/CONTRATOS_CASA.md`) dice:

> *Yellow card counts as 1 card and red or yellow-red card as 2. The 2nd yellow for one player which leads
> to a yellow red card is not considered. […] Cards for non-players (already substituted players, managers,
> players on bench) are not considered.*

**Una roja vale dos.** Nosotros contábamos amarillas + rojas, en el ajuste del modelo y en el liquidador.

| | media | P(under 4,5) | P(under 5,5) | P(under 6,5) |
|---|---:|---:|---:|---:|
| nuestro conteo | 4,4318 | 0,5571 | 0,7135 | 0,8331 |
| conteo de la casa | 4,6312 | 0,5347 | 0,6872 | 0,7995 |
| **diferencia** | +0,1994 | **−2,24 pp** | **−2,63 pp** | **−3,35 pp** |

A cuota 1,91 son entre 4,3 y 6,4 puntos de EV que creíamos tener y no estaban. Y el error va **siempre en
la misma dirección**: hace que el under parezca mejor de lo que es, en la única familia con dinero real.

**La comprobación empírica.** De las 113 apuestas de tarjetas que liquidó la propia casa, 74 se cruzaron
con las estadísticas del partido y **dos distinguen entre los dos conteos**. Las dos le dan la razón al
reglamento:

| partido | línea | amarillas | rojas | nuestro | casa cuenta | resultado de la casa |
|---|---|---:|---:|---:|---:|---|
| Stoke City – Charlton | under 4,5 | 3 | 1 | 4 → ganada | 5 | **perdida** |
| Palmeiras – São Paulo | under 6,5 | 5 | 1 | 6 → ganada | 7 | **perdida** |

Dos casos no miden nada por sí solos. Lo que confirman es que el reglamento escrito se aplica, que es lo
que hacía falta saber.

**Dónde duele más.** Ligue 1 (−5,06 pp en la línea 5,5), Ligue 2 (−4,25), Paraguay (−4,20), Brasil B
(−3,77), Colombia (−3,36). Donde menos: J1 (−0,75), League One (−0,84), League Two (−1,70). Correlaciona
con las rojas por partido, como tiene que ser.

**Lo que sigue sin resolverse, y hay que decirlo.** Los agregados de API-Football no distinguen la roja
directa de la doble amarilla. En los 12 expulsados del Mundial que sí tienen detalle por jugador, el feed
marca `rc=1, yc=0` **siempre**. Si ese es también el criterio de API-Football, para una doble amarilla la
casa cuenta 3 (la primera amarilla 1 + la amarilla-roja 2) y `amarillas + 2·rojas` cuenta 2: **seguiríamos
quedándonos cortos en uno**. La corrección exacta necesita el detalle de eventos (API-Football
`fixtures/events` distingue «Second Yellow card» de «Red Card»). Hasta tenerlo, `amarillas + 2·rojas` es un
suelo y el sesgo restante va en nuestra contra.

## Lo que ya se cambió y lo que no

**Cambiado (no toca ninguna pick):** el liquidador. `settleClubPropsViaAf` y la segunda fuente pasan al
conteo de la casa, y cada pick guarda `conteo_antiguo` para poder releer el track viejo sin reescribirlo.
Nuestra liquidación tiene que coincidir con la que paga el dinero; que no coincidiera hacía que el track
mintiera a nuestro favor.

**No cambiado:** el conteo del **modelo**. Cambiárselo cambia qué picks nacen, y cambiar la regla a mitad
de ventana destruye la muestra — la disciplina que ya costó una autopsia en agosto. Espera detrás de
`GP_CARDS_CONTEO_CASA` a la v2 preregistrada (`docs/PREREGISTRO_CARDS_V2.md`).

## Lo que este trabajo NO dice

**No dice que haya dinero en tarjetas.** Mide cuál de los cuatro describe mejor el conteo, y nada más. No
hay cierre histórico de tarjetas de clubes fuera de línea, así que aquí no se ha medido ventaja contra
ningún precio. Ganar esta comparación es condición **necesaria y no suficiente**: el listón sigue siendo
`lib/vara.js`, y con él `cards_under_v1` no es invertible hoy.

**Y hay un aviso de calibración que va en contra de todos.** Los cuatro aspirantes subestiman P(under)
entre 1,3 y 5,4 puntos porcentuales en las tres líneas, y T0 es el peor calibrado de todos (−4,10 pp en la
5,5 con el conteo antiguo, −4,76 con el de la casa). Es decir: el modelo predice **más** tarjetas de las
que salen, en todas sus versiones, y el error no se cierra al corregir el conteo. Eso apunta a una
tendencia a la baja en el número de tarjetas que ningún nivel de los probados alcanza a seguir, ni siquiera
con vida media de 90 días — que es la que el entrenamiento eligió en 7 de 10 bloques, la más corta de la
rejilla. La rejilla se quedó corta por abajo y hay que ampliarla.

Que el error de calibración vaya en dirección favorable al under y el error de conteo en dirección
contraria, y que los dos midan entre 2 y 4 puntos, explica bastante bien por qué `cards_under_v1` lleva
meses sin ganar ni perder de forma clara: **dos errores de tamaño parecido en sentidos opuestos**.
