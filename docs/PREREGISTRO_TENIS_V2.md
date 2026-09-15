# Preregistro — `tennis_total_v2` (total de juegos, ATP y WTA)

> **T2.16 del plan de trabajo de la auditoría externa.** Escrito el 15-sep-2026, **antes** de que nazca un
> solo ticket con la regla nueva. Sustituye a `docs/PREREGISTRO_TENIS_TOTAL.md` (v1), que se cierra hoy con
> el resultado que tenga y **no se prolonga**: los motivos están en el §1.
>
> **Solo cuentan los tickets nacidos después de la fecha de inicio.** Nada de reciclar histórico, y nada de
> arrastrar los de la v1: se dicen aparte, en su propia sección, y ahí se quedan.

---

## 0. Lo que este documento NO hace

No autoriza dinero. La regla del dinero del 13-sep sigue en pie: no entra un dólar nuevo en ningún sitio
hasta que una familia cruce el listón de `real-executor/parada.js`. **Tenis entero está en sombra y sigue
en sombra**; `tennis_total_v2` nace en sombra, con `tennis_total_v1` corriendo al lado como control.

---

## 1. Por qué se cierra la v1 y por qué hay una v2

### 1.1 La muestra prospectiva de la v1, separada del histórico y dicha aparte

La v1 (2-sep) marcó con `prereg_total8: true` las picks de TOTAL nacidas con ventaja ≥ 8 pp **después** de
su despliegue, y fijó el objetivo en 60 eventos liquidados. A 15-sep-2026, leído de `TEN.track()`:

| cohorte | eventos | picks | ROI/evento | SE | t | acierto | CLV medio | n CLV |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| **preregistradas (prospectivas)** | **11** | **19** | +5,82 % | 30,55 | 0,19 | 54,55 % | +9,76 % | **2** |
| edge ≥ 8 pp (histórico + prospectivo) | 44 | 77 | +19,13 % | 14,42 | 1,33 | 61,36 % | −3,82 % | 10 |
| todas las TOTAL liquidadas | 97 | 171 | +2,40 % | 9,83 | 0,24 | 52,08 % | −2,02 % | 30 |

**La fila que cuenta es la primera y no dice nada.** La auditoría lo señaló con precisión: un t de 2,99 con
**dos** cierres tiene un grado de libertad, y el umbral de Student con 1 gl es 12,71, no 2. Las otras dos
filas son retrospectivas, se solapan entre sí, y la de +19,13 % es exactamente la que sugirió la regla: leer
en ella la confirmación de la regla es el mismo círculo que la auditoría vino a romper.

### 1.2 El objetivo de la v1 no se podía cumplir, y eso también está medido

Con la desviación por evento REAL del libro de TOTAL (SE 9,83 pp sobre 97 eventos → **sd 96,8 pp**), la
potencia del corte de 60 eventos, calculada con `lib/inferencia.js`:

| eventos | potencia para un ROI verdadero de 5 pp | de 10 pp | semiamplitud del IC 95 % |
|---:|---:|---:|---:|
| 11 (lo que hay) | 0,053 | 0,064 | ±57,2 pp |
| 60 (el objetivo de la v1) | 0,069 | **0,126** | ±24,5 pp |
| 100 | 0,081 | 0,178 | ±19,0 pp |
| 200 | 0,113 | 0,309 | ±13,4 pp |

Una potencia de 0,126 quiere decir que, **si la regla ganara de verdad un 10 % por evento**, el corte de 60
eventos lo vería una vez de cada ocho. El resto de las veces cerraría "sin evidencia" una familia buena. No
es un preregistro exigente: es un preregistro ciego, y prolongarlo no lo arregla porque el ROI no es la
magnitud con la que se puede decidir esto (§3).

### 1.3 Qué se ha aprendido entre medias

Tres cosas medidas hoy, las tres en `docs/CHALLENGERS_TENIS_2026-09-15.md`:

1. **El compilador legal (C7) gana al que corre en producción.** En ATP a tres sets, frente a C6:
   Δ log-score **−0,02317**, IC 95 % [−0,03054, −0,01601], t **−6,37**, sobrevive a Benjamini-Hochberg al
   10 %, sobre 3.910 partidos fuera de muestra. Y el error de calibración en las líneas que de verdad se
   cotizan baja de 0,71 pp a **0,30 pp**.
2. **Fuera de ATP bo3, producción usa el método PEOR de los cuatro.** El desplazamiento (`shift`) pierde
   contra C6 por 0,0948 en WTA bo3 (t 4,83) y contra C7 por 0,0978 (t 4,91); en ATP bo3 pierde incluso
   contra el compilador **sin calibrar** (t 6,28). La tabla que lo arreglaría en WTA ya está escrita en
   `data/tennis/model-priors.json` y no se usa.
3. **Las tasas de saque y resto llevan 122 días congeladas** (último partido con estadística de saque:
   17-may-2026 en ATP, 18-may en WTA; el **100 %** de los jugadores activos tiene su tasa anterior al corte
   de la espina). El átomo del que sale todo lo demás es de mayo.

---

## 2. La regla, escrita entera

**Familia.** TOTAL de juegos del partido. ATP y WTA. **En sombra**, sin excepción.

**Universo.** Todo evento del feed de cuotas (The Odds API) que cumpla las cuatro condiciones:
- los dos jugadores resuelven en la base propia (`resolvePlayer`);
- la superficie del torneo es **certificada**, no inferida ni supuesta (`data/tennis/surfaces.json`,
  campo `surface_origen === 'certificada'`). Una clave nueva del proveedor entra como `supuesta` y **no
  genera pick** hasta que se certifique;
- prepartido: la captura es anterior al inicio real del partido;
- ninguno de los dos jugadores está marcado `stale` por la puerta de frescura existente.

**Casa y precio.** El precio es una tupla (`lib/contrato.js`): la cuota se toma de la casa que cotiza **la
línea evaluada**, nunca la mejor del tablero en otra línea. La pick guarda `line` (la valorada) y
`line_price` (la que cotizaba esa casa); si difieren, `line_mismatch` y la pick no cuenta.

**Líneas.** Las que el mercado cuelga de verdad, que están medidas: mediana del consenso ±2,5 juegos. En el
libro vivo y en el tablero del 15-sep eso es **17,5–23,5 en bo3** y **28,5–46,5 en bo5**. Fuera de ese
rango no hay pick aunque el modelo vea ventaja.

**Modelo.** **C7 legal** (`scripts/tennis-challengers.js`), reajustado trimestralmente:
- P(número de sets) del compilador, recalibrada con una Platt por **circuito y formato**, en cascada
  binaria (P(pasa del mínimo) y, en bo5, P(llega al quinto | pasó del mínimo));
- juegos condicionados a cada número de sets, **sobre el soporte legal del compilador**, inclinados
  exponencialmente hasta la media que dice una recta ajustada en entrenamiento por circuito × formato ×
  número de sets;
- masa en totales imposibles: **0,00 %** por construcción (C6 deja 0,281 % y el desplazamiento 0,300 %).

**Listón de entrada.** Ventaja ≥ **3 pp + el error de calibración medido de la familia**, la doctrina de
`goal-engine/mitades.js`. Con C7, medido el 15-sep en las líneas reales:

| estrato | error de calibración medio (pp) | listón efectivo |
|---|---:|---:|
| ATP bo3 | 0,30 | **3,3 pp** |
| WTA bo3 | 1,82 | **4,8 pp** |
| bo5 | 1,03 | **4,0 pp** |

Se mantienen, sin tocarlas, las dos puertas que ya existen: **ventaja > incertidumbre** (desacuerdo interno
del ensamble + impuesto por retraso de la base) y **push < 6 %**. Y se añade un **tope de 15 pp**: por
encima, la ventaja es nuestro error y no el del mercado.

**Una posición por partido y lado, sin la línea** (doctrina del ejecutor, 13-sep). Under 20,5 y under 21,5
del mismo partido no son dos apuestas. La unidad de cuenta es el **evento**.

**Qué NO entra.** El ganador (familia de referencia, jamás pick) y el hándicap (no se ha validado su
distribución de margen: el challenger midió el TOTAL, no el margen, y la v2 no cobra por lo que no midió).

---

## 3. Qué se mide, cómo, y qué contaría como éxito

### 3.1 La vara

**`lib/ev.js`, sin excepciones.** EV ticket a ticket contra la probabilidad SIN MARGEN del cierre, con las
**dos caras del mismo libro** en la misma captura:

    q_cierre = (1/cuota_cierre) / (1/cuota_cierre + 1/cuota_contraria)
    EV_cierre = cuota_entrada × q_cierre − 1

Tenis puede hacerlo y casi ninguna otra familia de la casa puede: el archivo de cierres guarda
`totals_all[].bb[casa][lado]` para **los dos lados de cada línea desde el 9-sep**. Desde hoy cada pick
liquidada guarda `ev_cierre_pct`, `q_cierre`, `Q_cierre`, `p_break_even` y `edge_information_pp`
(`tennis-engine/store.js`), y `TEN.track().ev_cierre` los agrega con bootstrap por racimos de **evento**.

**El CLV se anota como diagnóstico de movimiento de línea y NO entra en el veredicto.** El del ganador es
−15,54 % sobre 196 picks y no significa lo que parece: el cierre del ganador se guarda como mejor cuota por
lado **entre casas**, así que ni siquiera es un mercado que existiera.

### 3.2 La puerta previa, que hoy no está abierta

**Cobertura.** `ev_cierre` solo vale si hay cierre de la línea exacta con las dos caras del mismo libro.
Hoy la cobertura de CLV —que es una condición más laxa— es del **22 %** en TOTAL (38 de 171) y del 22 % en
SPREAD (89 de 399), porque la línea se mueve una **mediana de 3 juegos** entre el nacimiento de la pick y
el cierre.

> **Si la cobertura de `ev_cierre` no llega al 60 %, este preregistro NO se puede cerrar de ninguna forma**,
> igual que le pasa al de tarjetas. Arreglar la captura es el trabajo previo a todo lo demás, y la primera
> medición de cobertura (a los 30 días) es un **punto de integridad, no de decisión**.

### 3.3 El tamaño de muestra, calculado y no inventado

Con la varianza REAL del libro de tenis (`lib/inferencia.js`), y diciendo de dónde sale cada número:

**Por ROI** (cuota media medida de las picks de TOTAL: **1,9333**):

| ROI verdadero | tickets (α 0,05, potencia 0,80) | inflado por racimos (1,763 picks/evento) |
|---|---:|---:|
| 2 % | 18.304 | ~32.300 |
| 3 % | 8.132 | ~14.300 |
| 5 % | 2.925 | ~5.200 |
| 8 % | 1.141 | ~2.000 |

**Por EV al cierre**, que es la vara. No hay todavía varianza propia de `ev_cierre` —el campo nace hoy—,
así que se usa como cota la del CLV por evento medida en TOTAL, **sd 20,92 pp**, y se **recalcula** en
cuanto haya 30 eventos con cobertura:

| efecto a detectar | eventos necesarios |
|---|---:|
| 1 pp de EV | 3.437 |
| 2 pp de EV | 860 |
| 3 pp de EV | 382 |

**Hay que leer esta tabla y aceptar lo que dice.** No hay ningún corte de 60 ni de 100 eventos que
certifique nada en tenis. Por eso:

**Muestra objetivo: 380 eventos con `ev_cierre` calculable, o el 30-jun-2027, lo que llegue antes.**
Ése es el número con el que se detecta un EV de 3 pp con potencia 0,80, y está elegido porque es lo mínimo
que decide algo, no porque sea alcanzable pronto.

### 3.4 Criterio de éxito, declarado antes de mirar

`tennis_total_v2` se promueve a candidata (G2 superada, que **no** es dinero) cuando, al llegar al corte:

1. **`EV_cierre` medio > 0 con t ≥ 2** sobre racimos de evento, y
2. le gana a `tennis_total_v1` corriendo en paralelo sobre las mismas fechas, con la diferencia pareada
   fuera del intervalo por racimos, y
3. sobrevive a Benjamini-Hochberg al 10 % junto con el resto de familias que se estén juzgando a la vez
   (`docs/REGISTRO_EXPERIMENTOS.md` lleva el contador), y
4. la cobertura de `ev_cierre` es ≥ 60 %.

### 3.5 Criterio de fracaso, igual de declarado

- **`EV_cierre` medio con t ≤ −2**: se cierra la familia y se dice.
- **Cobertura < 60 % al corte**: el preregistro se declara **no concluyente por captura**, no por modelo.
  No se sustituye la vara por otra más fácil para poder concluir.
- **No superar a la v1** con la muestra objetivo cumplida: la v2 se retira a `lib/retiradas.js` como control
  y se escribe por qué.
- Un intervalo que contenga el cero con la muestra completa **no es un fracaso del método**: es la
  respuesta, y se publica como tal.

---

## 4. Calendario y estado

| | |
|---|---|
| **Escrito** | 15-sep-2026, antes del primer ticket de la v2 |
| **Inicio** | cuando C7 sustituya a `gamesPmf` en producción **y** la sonda confirme que `ev_cierre` se está calculando. **No antes.** |
| **Control en paralelo** | `tennis_total_v1` (la regla de hoy: `shift`/C6 según estrato, corte 8 pp) sigue corriendo intacta, marcada `control`. Su regla NO se toca durante la ventana |
| **Punto de integridad** | a los 30 días: cobertura de `ev_cierre`, tasa de `line_mismatch`, cierres in-play. **No es un punto de decisión y no se mira el EV** |
| **Reajuste del modelo** | trimestral, con validación interna sobre el último 20 % del entrenamiento, sin mirar picks vivas |
| **Corte** | 380 eventos con `ev_cierre` calculable, o el 30-jun-2027 |
| **Dinero** | ninguno |

---

## 5. Lo que este preregistro se compromete a NO hacer

- No cambiar el listón, las líneas, el universo, el modelo ni la vara una vez empezada la ventana. Si algo
  de eso cambia, la ventana se cierra y empieza otra con otro número de versión.
- No reciclar tickets anteriores a la fecha de inicio, ni los 11 eventos de la v1.
- No leer el resultado antes del corte para decidir si seguir. El estado se puede mirar; la regla no se toca.
- No partir la muestra (ATP/WTA, over/under, superficie) para buscar el trozo que gana. Esos cortes se miran
  **después** del cierre y se declaran exploratorios.
- No sustituir `EV_cierre` por el CLV, ni por el ROI, ni por el acierto, si la vara elegida sale mal.
- No llamar "confirmada" a esta familia por pasar G2. G2 no es dinero: es permiso para hablar de G3.

---

## 6. Lo que no se ha podido medir y por tanto no se afirma

- **Contra el mercado, en el histórico, no hay comparación posible.** El archivo de cierres y el libro de
  766 picks liquidadas viven en el disco persistente de Render y no tienen ruta de exportación:
  `/api/internal/tennis` devuelve el agregado y las 40 últimas. Todo lo que dice el challenger es que C7
  describe mejor el total de juegos; **no dice que le gane a un precio**, y esa es la única pregunta que
  decide si algún día hay dinero.
- **La varianza de `ev_cierre` en tenis no existe todavía.** El tamaño objetivo de 380 eventos usa la del
  CLV como cota y está declarado como provisional en el §3.3.
