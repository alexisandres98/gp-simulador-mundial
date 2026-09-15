# Tenis: el precio, los datos y el total de juegos — resultados

> **T1.2b, T2.14 y T2.15 del plan de trabajo de la auditoría externa.** Ejecutado el 15-sep-2026.
> Reproducible:
> `node scripts/tennis-datos.js --sports <lista de /v4/sports?all=true> [--write]`
> `node scripts/tennis-challengers.js [--congelado] [--out <archivo>]`
> Pruebas: `node tests/tennis-contrato.test.js` · `node tests/tennis-replay.test.js`
> Registro de los experimentos: `docs/REGISTRO_EXPERIMENTOS.md` (E-TEN-01 a E-TEN-07).
> Preregistro que sale de aquí: `docs/PREREGISTRO_TENIS_V2.md`.

---

## Resumen en cinco líneas

1. **El fallo A01 no estaba en la entrada de tenis** —el selector ya filtraba por la línea del consenso—
   pero nadie lo sabía porque no había un solo contador. **Sin ese filtro, el 56,3 % de los lados del
   tablero cogería el precio de otra línea, con la cuota inflada un 11,3 %.**
2. **El histórico de tenis no es auditable**: 766 picks liquidadas y ninguna guarda de qué línea era su
   cuota. Se arregla hacia adelante (`line_price`, `line_mismatch`), no hacia atrás.
3. **Los recortes [0,45 · 0,80] del saque no se activan nunca**: 0 de 126.072 lados en once años.
4. **Las tasas de saque y resto llevan 122 días congeladas** y el 100 % de los jugadores activos las tiene
   anteriores al corte de la espina. El átomo del modelo es de mayo.
5. **El compilador legal (C7) le gana al de producción en ATP bo3** (Δ log −0,02317, t −6,37) y, fuera de
   ATP bo3, **producción está usando el peor de los cuatro métodos disponibles**.

---

# Parte I — T1.2b: el precio es una tupla

## Lo que se encontró, que no es lo que se buscaba

El plan daba por hecho que `tennis-engine/store.js` tenía el fallo A01 ya arreglado en NFL, fútbol
americano universitario, CFL y tenis de mesa: valorar la línea del consenso y pagarla con la cuota de otra
línea. **No lo tenía.** El `filter(x => x.line === consenso)` de `marketOf` estaba ahí desde donde alcanza
el historial del repositorio, para el total y para el hándicap, y el ganador no tiene línea que confundir.

Eso no cierra el asunto: cierra una pregunta y abre la de cuánto trabajo estaba haciendo ese filtro sin que
nadie lo midiera. Con las cuotas reales de un torneo entero (8 partidos, 28,4 casas por partido de media, 111 filas de
total y 86 de hándicap), corriendo el selector viejo y el nuevo **sobre las mismas filas**:

| | |
|---|---:|
| lados evaluados (evento × familia × lado) | 32 |
| lados en los que el selector SIN filtro habría cogido otra línea | **18 (56,3 %)** |
| cuota inflada de media al cogerla | **+11,30 %** |
| distancia media entre la línea del precio y la valorada | 0,89 juegos |
| cotizaciones de total que eran de otra línea | 33 de 111 |
| cotizaciones de hándicap que eran de otra línea | 32 de 86 |

Cuatro ejemplos del mismo torneo, todos en la misma dirección:

| partido | familia | consenso | lo que habría cogido el viejo | lo que coge el nuevo |
|---|---|---|---|---|
| Bucsa – Udvardy | total over | 20,5 | 2,02 en **21,5** (onexbet) | 1,87 en 20,5 (betanysports) |
| Kostyuk – Townsend | hándicap B | −4,5 | 2,55 en **−2,5** (unibet_nl) | 1,82 en −4,5 (gtbets) |
| Stephens – Tjen | hándicap A | 3 | 2,28 en **1,5** (leovegas_se) | 1,97 en 3 (pinnacle) |
| Parry – Stearns | total over | 21,5 | 2,00 en **22,5** (betrivers) | 1,88 en 21,5 (pinnacle) |

La casa que paga más paga más **porque su línea es peor**. Cobrar por esa diferencia es cobrar por un
mercado que no se compró, y el error va siempre en la misma dirección.

## Lo que sí estaba roto y se ha arreglado

El selector pasa a ser el escrito una sola vez en `lib/contrato.js` (`mejorPrecio`, que devuelve **la fila
entera**), con la gemela de `nfl-engine/store.js::mejorPorLado`. Cuatro defectos reales, ninguno de ellos el
titular:

1. **Comparaba líneas con `===` en coma flotante**, sin tolerancia. Ahora la tolerancia es 0,001, mucho
   menor que el cuarto de punto, así que jamás confunde dos líneas distintas.
2. **Aceptaba filas sin cuota.** `(x[side] || 0)` trata `undefined` como cero, así que el `reduce` podía
   devolver una fila con la cuota vacía; aguas abajo salía un `NaN` que mataba la candidata **en silencio**.
   Ahora se exige cuota > 1 y las que no la tienen se cuentan (`sin_cuota`).
3. **El hándicap no se normalizaba al lado A con signo.** Funcionaba por convenio interno —las filas se
   escriben siempre desde `home_team`— pero A−3,5 / B+3,5 y A+3,5 / B−3,5 son dos mercados con pagos
   opuestos, y un convenio no es una garantía. Ahora la línea viaja como la ve cada lado y `lib/contrato`
   la normaliza.
4. **El desvigado del ganador cruzaba casas.** `consensus.ml_p_a` desviga la mediana de las cuotas de A
   contra la mediana de las de B, y esas dos medianas pueden ser de libros distintos: **17 de 24 parejas
   del tablero lo eran**. Eso fabrica un mercado que no existió y un margen que nadie cobró. Se añade
   `ml_p_a_par` (mediana de la probabilidad desvigada casa a casa, con las dos caras de la misma foto) y se
   deja el campo viejo intacto porque el archivo de cierres lo lleva dentro.

Y lo que faltaba del todo: **los contadores**. `descartadas_por_linea` (total / hándicap / ganador) y
`sin_precio_en_linea` viajan ahora en cada fila del tablero y agregados en `board().precio_tupla`.

## Lo que NO se ha podido medir, y por qué

> **«¿Cuántas de las 766 picks históricas de tenis tenían precio de una línea y probabilidad de otra?»
> No tiene respuesta con los datos que hay.**

Dos motivos, los dos estructurales:

- **Ninguna pick guarda la línea de su precio.** El objeto de pick lleva `line` (la que valoró el modelo) y
  `odds`/`book`, pero no de qué línea era esa cuota. Con un solo número no se puede comprobar la igualdad de
  dos.
- **El libro completo no es exportable.** `/api/internal/tennis` devuelve el agregado y las **40** últimas
  liquidadas de 766; `/api/tennis/track?limit=5000` exige sesión de administrador. No hay ruta interna que
  entregue `picks.json` del disco persistente.

Lo que sí se puede afirmar es más débil y hay que decirlo así: **el camino de código que crea las picks
filtra por la línea del consenso desde donde alcanza el historial del repositorio**, así que el fallo, si
existió, es anterior a lo que se puede ver. Desde hoy cada pick guarda `line_price` y `line_mismatch`, y la
pregunta tiene respuesta a partir del primer barrido.

## Un hallazgo lateral que sale de mirar las líneas

El 78 % de las picks de TOTAL y de SPREAD **no tienen CLV** (38 de 171 y 89 de 399 lo tienen), y el motivo
escrito en cada una es el mismo: *la línea de la pick no se cotiza al cierre*. En las 27 picks con línea de
las 40 exportables, 19 lo dicen, y **la distancia mediana entre la línea de la pick y el consenso al cierre
es de 3 juegos** (casos: 0,5 · 2 · 3 · 3 · 3 · 3,5 · 3,5 · 4).

Eso no es un fallo del liquidador: es la disciplina de la tupla funcionando —antes que un CLV falso, un
hueco—. Pero dice algo incómodo sobre la familia: **las picks nacen en líneas que el mercado abandona**, y
cualquier preregistro que decida por CLV o por EV al cierre se queda con una quinta parte de su muestra.
Está escrito en `docs/PREREGISTRO_TENIS_V2.md` §3.2 como puerta previa.

---

# Parte II — T2.14: de cuándo es cada dato

## `data_as_of`, por componente

Hasta hoy el motor servía **una** fecha de frescura y la interfaz la leía como «la base está al día». No es
una fecha: son cinco, y ninguna coincide con otra.

| componente | fecha | retraso a 15-sep |
|---|---|---:|
| último partido de la base (ATP / WTA) | 20260820 | 27 días (en producción: 20260913 / 20260915) |
| **espina con estadística de saque y resto** | **20260525** | **114 días** |
| último partido con saque de verdad (ATP / WTA) | 20260517 / 20260518 | **122 / 121 días** |
| cola del marcador (ESPN): 1.614 filas | 20260526 → 20260820 | — |
| constantes del modelo (`model-priors.json`) | 2026-08-18, desarrollo hasta 20250101 | — |

Ahora viajan las cinco: en `D.build().data_as_of`, en cada `eventModel` y en cada pick.

## Las tasas de saque y resto están congeladas, y no es una nota al pie

El compilador es un modelo de PUNTO: todo —ganador, total de juegos, hándicap, probabilidad de tiebreak—
sale de `paSrv` y `pbSrv`. Y esas dos:

| | ATP | WTA |
|---|---:|---:|
| último partido del circuito con estadística de saque | 20260517 | 20260518 |
| días congelado | **122** | **121** |
| jugadores activos (≥10 partidos y último partido dentro de los 90 días finales de la base) | 171 | 198 |
| **activos cuya tasa de saque es anterior al corte de la espina** | **100 %** | **100 %** |
| mediana de días desde el último dato de saque de cada activo | 133 | 134 |

No hay forma de actualizarlas: los repositorios públicos de Jeff Sackmann fueron retirados y la cola de
ESPN trae ganador, sets y juegos, pero **ni un punto de saque**. Así que se hace lo único honesto: se
**declara la fecha en cada pick** (`data_as_of.saque_a`, `saque_b`) y se mantiene el impuesto de
incertidumbre por retraso de la base que ya existía.

## La tasa de activación de los recortes: cero

La pregunta del plan era si los recortes `[0,45 · 0,80]` de la probabilidad de punto al saque se activan a
menudo, porque si lo hacen «el modelo está siendo recortado más de lo que nadie cree». Medido sobre los
partidos que de verdad se jugaron, con el estado PREVIO a cada uno (63.036 partidos, 2015→ago-2026):

| | ATP | WTA |
|---|---:|---:|
| partidos evaluados | 32.621 | 30.415 |
| lados evaluados | 65.242 | 60.830 |
| **lados recortados** | **0** | **0** |
| **tasa de activación** | **0,00 %** | **0,00 %** |
| crudo mínimo / máximo | 0,5232 / 0,7718 | 0,4535 / 0,6866 |
| holgura al borde bajo (0,45) | +7,32 pp | **+0,35 pp** |
| holgura al borde alto (0,80) | +2,82 pp | +11,34 pp |
| percentiles del crudo (p1 / p50 / p99) | 0,5728 / 0,6385 / 0,7158 | 0,5077 / 0,5686 / 0,6335 |

**La respuesta es que el recorte no muerde nunca**, en once años y 126.072 lados. Es código inerte, no una
salvaguarda que a veces actúa: nadie está recortando nada. Con un matiz que no conviene perder: en la WTA
el valor crudo más extremo se quedó a **0,35 pp** del suelo, así que ahí está a una estimación mala de
morder — y lo haría en silencio. Por eso `probsEn` devuelve ahora `clampA`/`clampB` y el valor crudo, y
cada pick lo declara si ocurre.

## La superficie, certificada por evento

La superficie salía de una expresión regular sobre el nombre de la clave del proveedor, y lo que no casaba
caía a **dura** sin decirlo. Contrastando las **45** claves de tenis que publica The Odds API contra la
superficie observada en la base propia:

| | |
|---|---:|
| claves evaluadas | 45 |
| certificables contra la base | **45** |
| discrepancias de superficie | **0** |
| discrepancias de formato (bo3/bo5) | **0** |
| **claves que caían al defecto "dura" sin ninguna evidencia** | **25** |

La regla acierta hoy en las 45. **Acertar por casualidad no es saber**: 25 de esas 45 no tenían detrás nada
más que "no encontré nada en el nombre", y la próxima clave que abra el proveedor —un torneo nuevo, una
sede movida, una gira sudamericana de arcilla— entra como dura sin que salte nada. Se escribe
`data/tennis/surfaces.json` (45/45 certificadas, con el torneo de la base, el número de partidos y la fecha
del último) y `torneoDe()` lo consulta primero; cada fila del tablero declara `surface_origen` con uno de
tres valores: `certificada`, `inferida` o `supuesta`.

## El tiebreak por edición

El compilador cierra **todo** set decisivo con tiebreak en 6-6. Eso no siempre fue verdad: Wimbledon no
tuvo tiebreak de set final hasta 2019, el Abierto de Australia hasta 2019 y Roland Garros hasta 2022.
Medido edición a edición (torneo × año, ≥20 partidos, mirando los marcadores del set decisivo):

| | |
|---|---:|
| ediciones con ≥20 partidos | 1.348 |
| ediciones con sets decisivos que pasan de 7 juegos ganados | **34** |
| partidos afectados | **148** (0,23 % de la base) |
| peores | wta Wimbledon 2016 (9,45 %), atp Wimbledon 2015 (7,20 %), atp Wimbledon 2016 (5,65 %), wta Australian Open 2018 (5,51 %) |
| juegos máximos vistos en un set decisivo | 26 (atp Wimbledon 2018) |

**Es pequeño en el total y grande donde ocurre.** Los 148 partidos son todos de grandes anteriores a 2022,
es decir, dentro de la ventana de desarrollo de las constantes y fuera del holdout. Para el bo3 —donde vive
la familia que se preregistra— el efecto es nulo. Queda anotado y no se corrige: corregirlo exige una regla
de tiebreak por edición del torneo, y la clave del proveedor no dice la edición.

---

# Parte III — T2.15: el total de juegos con marcadores legales

## La pregunta

La distribución de juegos de un partido es una **mezcla de dos jorobas**: la del partido que acaba en dos
sets y la del que se va a tres, con un valle entre ellas. Y el soporte tiene agujeros: los totales de set
legales son {6, 7, 8, 9, 10, 12, 13}, así que al mejor de tres solo caben totales de 12 a 26 (dos sets) o de
18 a 39 (tres). **No existe un partido de 11 juegos ni de 40.**

El compilador ya sabe todo eso —camino a camino, con marcadores exactos— y después producción lo aplasta de
dos maneras, las dos sobre la mezcla entera:

- **`shift`**: desplaza la distribución completa para que su media sea `calG = a + b·E[juegos]`. En ATP bo3,
  `b = 1,386`: no es un ajuste fino, es un reescalado grande.
- **`C6`**: suma un residuo empírico por tercil de juegos esperados y reparte la masa fraccionaria entre los
  dos enteros vecinos.

## Los aspirantes

| id | qué es |
|----|--------|
| **C0_crudo** | el compilador sin calibrar. El suelo: si nadie le gana, la calibración sobra |
| **C0_shift** | **producción hoy en WTA bo3 y en los cuatro grandes** |
| **C6** | **producción hoy en ATP bo3** (tabla de residuos por tercil, `model-priors.json`) |
| **CE** | empírico por favoritismo: histograma del total por circuito × formato × tercil de \|p−0,5\| |
| **C7** | el aspirante: P(nº de sets) recalibrada, y juegos condicionados a ese número sobre soporte legal |
| ~~mercado~~ | **no medible**, ver abajo |

**C7, escrito entero.** `P(juegos = g) = Σ_k P(k sets) · P(juegos = g | k sets)`, donde:
- `P(k sets)` sale del compilador y se recalibra con una Platt **por circuito y formato**, en cascada
  binaria: P(pasa del mínimo de sets) y, en bo5, P(llega al quinto | pasó del mínimo);
- `P(juegos | k sets)` es la condicional exacta del compilador —soporte legal por construcción— inclinada
  exponencialmente (`q(g) ∝ p(g)·e^{θg}`, la misma inclinación que usa el challenger de tarjetas) hasta que
  su media sea la que dice una recta ajustada en entrenamiento por circuito × formato × número de sets.
- **La inclinación no puede sacar masa del soporte**: donde `p` vale cero, `q` vale cero. Ése es el punto.

## El montaje

**Datos.** 44.487 partidos de la base propia, 2018 → ago-2026, sin retiros (1.219 descartados) y con
marcador coherente (204 descartados). Holdout 2025→: **9.321 partidos evaluados** en 7 bloques trimestrales.

**Protocolo.** Walk-forward por trimestre: cada bloque se puntúa con lo ajustado **solo con lo estrictamente
anterior**. El modo de C7 y los hiperparámetros de CE se eligen en el último 20 % del entrenamiento
—validación interna que nunca toca el bloque evaluado—. El estado del modelo (Elo, saque, resto) es el
PREVIO a cada partido y sale de la misma regla de actualización que usa producción: `tests/tennis-replay.test.js`
comprueba que recorrer la base deja el Elo **idéntico al bit**.

**Incertidumbre.** Bootstrap por racimos de **partido** (`lib/inferencia.js`, 2.000 réplicas, semilla fija),
diferencias **pareadas** sobre las mismas filas, y Benjamini-Hochberg al 10 % sobre las 12 comparaciones
declaradas de cada estrato.

## Resultado

### ATP bo3 — el único sitio donde C6 corre en producción (n = 3.910)

| aspirante | log-score | CRPS | Δ log vs C6 | IC 95 % | t | p |
|---|---:|---:|---:|---|---:|---:|
| **C7** | **3,05177** | **3,34719** | **−0,02317** | [−0,03054, −0,01601] | **−6,37** | <0,0001 |
| CE | 3,06774 | 3,38128 | −0,00720 | [−0,01389, −0,00059] | −2,11 | 0,035 |
| C6 *(producción)* | 3,07493 | 3,35338 | — | — | — | — |
| C0_crudo | 3,08942 | 3,47212 | +0,01448 | [+0,00389, +0,02531] | +2,63 | 0,008 |
| C0_shift | 3,22132 | 3,38156 | +0,14639 | [+0,10763, +0,18556] | +7,26 | <0,0001 |

**C7 gana en las dos métricas** y sobrevive a Benjamini-Hochberg (umbral 0,0346; las 12 comparaciones lo
pasan).

### WTA bo3 (n = 4.436) — empate técnico, y producción en el sitio equivocado

| aspirante | log-score | CRPS | Δ log vs C6 | t | p |
|---|---:|---:|---:|---:|---:|
| CE | **3,06175** | 3,27147 | −0,01524 | −1,77 | 0,077 |
| C7 | 3,07395 | **3,23884** | −0,00304 | −0,74 | 0,46 |
| C6 *(escrito y **sin usar**)* | 3,07700 | 3,23963 | — | — | — |
| C0_shift *(producción)* | 3,17179 | 3,25807 | **+0,09479** | **+4,83** | <0,0001 |
| C0_crudo | 3,14079 | 3,43935 | +0,06380 | +7,92 | <0,0001 |

**En la WTA, C7 no aporta nada sobre C6** y hay que decirlo así. El motivo está en el propio ajuste: la
recta de la media condicionada a dos sets en la WTA sale `[−0,78, 0,986]`, prácticamente la identidad, es
decir, **el compilador ya acierta la duración condicionada en la WTA y no hay nada que corregir**. En la
ATP esa misma recta sale `[−14,23, 1,695]`: ahí sí.

### bo5, los cuatro grandes (n = 975)

| aspirante | log-score | CRPS | Δ log vs producción (`shift`) | t | p |
|---|---:|---:|---:|---:|---:|
| **C7** | **3,57702** | **5,30862** | **−0,10023** | **−3,69** | 0,0002 |
| CE | 3,59501 | 5,44855 | −0,08434 | −3,16 | 0,0016 |
| C6 | 3,62357 | 5,32329 | −0,05424 | −1,33 | 0,18 |
| C0_crudo | 3,65737 | 5,68571 | −0,02044 | −0,65 | 0,51 |
| C0_shift *(producción)* | 3,67781 | 5,35816 | — | — | — |

C7 es el mejor en las dos métricas y le gana a producción con claridad; contra C6 la diferencia (−0,046)
**no** es significativa con 975 partidos (t −1,35). Con este tamaño no se puede separar a los dos.

### Calibración en las líneas que se ofrecen de verdad

Las líneas de evaluación son las que cubren el 20-80 % de los totales reales de cada estrato, que es donde
las casas cuelgan la suya: **18,5–30,5 en ATP bo3**, **17,5–28,5 en WTA bo3**, **28,5–46,5 en bo5**. Se
puede comprobar contra el libro vivo de picks de tenis (líneas observadas: 18,5 · 19,5 · 20,5 · 21 · 21,5 ·
32,5 · 33,5 · 34 · 34,5 · 40,5 · 42,5 · 43) y contra el tablero del 15-sep (consensos de 19,5 a 21,5).

**ATP bo3, línea a línea** (P(over) predicha vs ocurrida):

| línea | ocurrió | C6 | error C6 | C7 | error C7 |
|---|---:|---:|---:|---:|---:|
| 18,5 | 77,03 % | 77,06 % | +0,03 | 77,16 % | +0,13 |
| 19,5 | 67,83 % | 69,02 % | +1,20 | 67,85 % | **+0,02** |
| 20,5 | 59,59 % | 61,45 % | +1,85 | 60,24 % | **+0,65** |
| 21,5 | 54,37 % | 54,71 % | +0,34 | 54,42 % | **+0,04** |
| 22,5 | 46,01 % | 47,27 % | +1,26 | 45,98 % | **−0,03** |
| 23,5 | 40,18 % | 41,59 % | +1,41 | 40,00 % | **−0,18** |
| 24,5 | 38,87 % | 38,56 % | −0,31 | 38,70 % | −0,17 |
| 25,5 | 35,27 % | 34,87 % | −0,40 | 35,30 % | +0,04 |
| 26,5 | 30,36 % | 30,98 % | +0,62 | 31,28 % | +0,92 |
| 27,5 | 27,67 % | 27,91 % | +0,23 | 28,40 % | +0,73 |
| 28,5 | 24,58 % | 24,26 % | −0,32 | 24,98 % | +0,41 |
| 29,5 | 21,30 % | 20,69 % | −0,61 | 21,20 % | −0,10 |
| 30,5 | 17,75 % | 17,14 % | −0,61 | 17,31 % | −0,44 |

Error medio absoluto en las líneas reales:

| estrato | C0_crudo | C0_shift | C6 | CE | **C7** |
|---|---:|---:|---:|---:|---:|
| ATP bo3 | 9,11 | 3,29 | 0,71 | 0,44 | **0,30** |
| WTA bo3 | 12,20 | 2,48 | **1,19** | 1,07 | 1,82 |
| bo5 | 13,41 | 2,20 | 1,39 | 2,01 | **1,03** |

### Masa en totales imposibles

| aspirante | masa media en totales que no pueden ocurrir |
|---|---:|
| C0_crudo | **0,000 %** |
| **C7** | **0,000 %** |
| CE | 0,054 % |
| C6 | 0,281 % |
| C0_shift | 0,300 % |

**Y aquí conviene no exagerar.** La masa que se escapa del soporte legal es del orden de tres décimas de
punto: el problema de `shift` y de C6 **no es principalmente que pongan probabilidad donde no cabe un
partido**, sino que mueven una mezcla bimodal como si fuera una joroba sola. La legalidad del soporte es la
consecuencia bonita de construirlo bien, no el mecanismo de la mejora.

## Las tres cosas que esto contesta

### 1. Producción está usando el peor método disponible fuera de ATP bo3 (E-TEN-07)

El desplazamiento —lo que corre hoy en WTA bo3 y en los cuatro grandes— **pierde contra no calibrar** en
ATP bo3: Δ log +0,1319, IC [+0,092, +0,172], t +6,28. En WTA empata con el crudo (t −1,41) y pierde contra
C6 por 0,0948 (t −4,83). **Y la tabla de C6 para la WTA ya está escrita en `data/tennis/model-priors.json`
con la etiqueta "no demostrado" y no se usa.** Está demostrada: fuera de muestra, sobre 4.436 partidos de
2025-2026. Cambiarlo cambia qué picks nacen, así que es decisión de Alexis, no del ejecutor.

### 2. La mejora de C7 no viene de tener datos más frescos

C7 y CE se reajustan cada trimestre con todo lo anterior, mientras que las constantes de producción están
congeladas en enero de 2025. Eso le da al aspirante información que la referencia no tiene. Con
`--congelado`, **todos entrenando con la misma ventana que usó producción**:

| estrato | C7 vs C6 (walk-forward) | C7 vs C6 (ventana congelada) |
|---|---|---|
| ATP bo3 | −0,02317 (t −6,37) | **−0,02327 (t −6,37)** |
| WTA bo3 | −0,00304 (t −0,74) | −0,00254 (t −0,62) |
| bo5 | −0,04656 (t −1,35) | −0,04656 (t −1,37) |
| global | −0,01598 (t −3,71) | −0,01584 (t −3,68) |

Idénticos a la tercera cifra. **La ventaja es del método, no de los datos.**

### 3. El compilador predice demasiados partidos a tres sets

La Platt de la duración en ATP bo3 sale con intercepto **−0,49** y pendiente ≈1: es un desplazamiento
limpio del logit, es decir, el compilador **sobreestima sistemáticamente** la probabilidad de que el
partido se vaya al tercer set (unos 12 puntos porcentuales alrededor de p = 0,5). En la WTA, −0,56 con
pendiente 0,77. No es ruido de un bloque: los siete bloques dan lo mismo (−0,48 a −0,56), y el modo
`nsets_y_media` se eligió en **7 de 7** validaciones internas.

Eso tiene un nombre y ya estaba en el blueprint: los puntos se suponen **independientes dentro del
partido**. Un modelo IID produce más partidos igualados de los que hay, y eso se ve exactamente donde tenía
que verse — en cuántos sets dura el partido.

## Lo que este trabajo NO dice

**No dice que haya dinero en el total de juegos de tenis.** Mide cuál de los cinco describe mejor el total,
y nada más. Ganar esta comparación es condición **necesaria y no suficiente**.

**Y no se ha podido comparar contra el mercado.** El archivo de cierres y el libro de 766 picks liquidadas
viven en el disco persistente de Render y no tienen ruta de exportación. Con las 40 filas exportables —de
una sola gira, nueve de ellas de TOTAL— no se puede medir nada, y aquí no se finge: el aspirante que gana a
los otros cuatro **sigue sin haber ganado a un precio**, que es lo único que decide si algún día hay dinero.

**Un límite del empírico, dicho aparte.** CE eligió **un solo estrato** (circuito × formato, sin partir por
favoritismo) en 6 de los 7 bloques, y en el séptimo solo cambió el suavizado. Es decir: **el favoritismo no
añadió nada** al histograma del total en la validación interna. No es un fallo del competidor; es un dato
sobre el problema, y explica por qué un histograma tan simple aguanta tan bien contra el compilador.

---

## Qué se ha cambiado y qué no

**Cambiado (no toca ninguna probabilidad ni ninguna pick):**
- el selector de precio de `marketOf`, ahora vía `lib/contrato.js`, con contadores;
- `line_price` y `line_mismatch` en cada candidata y en cada pick de sombra;
- `data_as_of` por componente en la base, en el modelo de cada evento y en cada pick;
- `surface_origen` (`certificada` / `inferida` / `supuesta`) y `data/tennis/surfaces.json`;
- `clampA` / `clampB` y los valores crudos del saque, declarados;
- `ev_cierre_pct`, `q_cierre`, `Q_cierre`, `p_break_even` y `edge_information_pp` por ticket liquidado, y
  `track().ev_cierre` agregado con bootstrap por racimos de evento — la vara nueva de `lib/ev.js`, que en
  tenis **sí** se puede calcular porque el archivo de cierres guarda las dos caras del mismo libro
  (`totals_all[].bb[casa][lado]`, desde el 9-sep). Un ejemplo con la forma real de un cierre de tenis:
  entrada 1,97, cierre del mismo libro 1,90 / 1,95 → **CLV bruto +3,68 % y EV real −0,22 %**. Es el
  contraejemplo de la auditoría con números de esta casa: el CLV dice que la línea se movió a favor y el EV
  dice que se pierde dinero, y las dos cosas son ciertas a la vez;
- `pNSets` y `gamesByNSets` en la salida del compilador (campos nuevos, nada existente cambia);
- `recorre()` en `data.js`: la regla de actualización, escrita una sola vez, con el walk-forward encima.

**No cambiado:** `gamesPmf`. **C7 no está en producción.** Cambiarlo cambia qué picks nacen, y cambiar la
regla a mitad de ventana destruye la muestra — la disciplina que ya costó una autopsia en agosto. Espera al
preregistro (`docs/PREREGISTRO_TENIS_V2.md`) y a la palabra de Alexis. Lo mismo para encender la tabla de
C6 en la WTA, que es un cambio de dos líneas y una mejora medida de 0,0948 de log-score.
