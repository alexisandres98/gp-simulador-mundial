# Preregistro — `cards_under_v2`

> **T2.6 del plan de trabajo de la auditoría externa.** Escrito el 15-sep-2026, **antes** de ver un solo
> ticket de la regla nueva. Ese es el punto entero de un preregistro: si se escribe después, no es un
> preregistro, es una explicación.
>
> **Solo cuentan los tickets nacidos después de la fecha de inicio.** Nada de reciclar histórico.

---

## 0. La decisión que hay que tomar y que este documento NO toma

Este preregistro **no autoriza dinero**. La regla del dinero del 13-sep sigue en pie: no entra un dólar
nuevo en ningún sitio hasta que una familia cruce el listón de `real-executor/parada.js`. `cards_under_v2`
nace **en sombra**, con la v1 corriendo al lado como control, y lo que se decide el día del corte es si se
promueve, no cuánto se apuesta.

---

## 1. Por qué hay una v2

Tres cosas medidas entre el 14 y el 15-sep, las tres en `docs/CHALLENGERS_TARJETAS_2026-09-15.md`:

1. **Contamos mal las tarjetas.** El reglamento de Cloudbet cuenta una roja como DOS y nosotros sumábamos
   amarillas + rojas. Sobre 10.436 partidos eso desplaza la media de 4,4318 a 4,6312 y quita entre 2,24 y
   3,35 pp de probabilidad al under según la línea. Dos apuestas reales liquidadas por la casa lo
   confirman. El liquidador ya está corregido; el modelo no, porque cambiarlo cambia qué picks nacen.
2. **El árbitro es señal y no se está sirviendo.** Aislado, el multiplicador residual del árbitro gana
   −0,00309 de log-score con t = −3,80 sobre racimos de partido (−0,00335 y t = −3,28 con el conteo de la
   casa). `server.js` llama a `project()` sin `referee` mientras el modelo lo espera y la validación LOO lo
   usa: llevamos meses validando un modelo distinto del que sirve.
3. **Las fuerzas de equipo aportan al total a escala de clubes.** El `TOTALS_DAMP = 0` se calibró con los
   102 partidos del Mundial. Con 10.000 partidos el entrenamiento elige amortiguación > 0 en 10 de 10
   bloques, y T2a le gana a T0 con t = −4,59.

---

## 2. La regla, escrita entera

**Universo.** Fútbol de clubes, las ligas que ya cubre `clubDailyPicks`. Solo mercados `cards_total` con
línea terminada en `,5` (sin empate). Solo prepartido.

**Casa.** Cloudbet, que es donde se ejecuta. El precio se valora contra la **línea exacta** de esa casa
(`lib/contrato.js`); nunca contra la línea del consenso con el precio de otra.

**Líneas.** 4,5 · 5,5 · 6,5. Las que Cloudbet ofrece de verdad y en las que entraría el dinero. Fuera de
ese rango no hay pick, aunque el modelo vea ventaja: una calibración excelente en 2,5 no dice nada sobre
la cola donde vive el under.

**Conteo.** El de la casa: `amarillas + 2 × rojas` (`prop-engine/conteo.js`), tanto en el ajuste como en la
liquidación. Se sabe que es un **suelo** —una doble amarilla vale 3 para la casa y 2 para esta fórmula— y
ese sesgo residual va en nuestra contra, no a favor, que es el lado correcto para equivocarse.

**Modelo.** T2b del challenger:
- nivel por liga × temporada con decaimiento exponencial, encogido a liga y a global;
- × fuerzas de equipo encogidas, con exponente de amortiguación;
- × multiplicador de paridad (el actual, 1,06 − 0,25·|p_local − p_visita|, topado ±10 %);
- × **árbitro residual**, estimado sobre lo que queda tras liga, temporada y equipos, encogido y topado ±20 %;
- ley binomial negativa, dispersión por momentos sobre el mismo estrato.

**Hiperparámetros.** Se reajustan mensualmente con validación interna sobre el último 20 % del
entrenamiento, **nunca mirando picks vivas**. La rejilla es la de `scripts/cards-challengers.js` con una
ampliación obligada: vida media baja a `[30, 45, 60, 90, 180, 365, 730]` días, porque el entrenamiento
eligió el extremo corto (90) en 7 de 10 bloques y una rejilla cuyo óptimo cae en el borde no ha terminado
de buscar.

**Listón de entrada.** Ventaja ≥ **3 pp + el error de calibración medido de la familia**, la doctrina de
`goal-engine/mitades.js`. El error de calibración de tarjetas totales medido el 15-sep en las tres líneas
con el conteo de la casa es de 2,26 a 4,12 pp (T2b · NB), así que el listón efectivo arranca en **5,3 a
7,1 pp** según la línea. Se recalcula con cada reajuste mensual.

**Tope de ventaja.** 15 pp. Por encima, la ventaja es nuestro error y no del mercado.

**Una posición por partido y lado**, sin la línea (doctrina del ejecutor, 13-sep). Under 4,5 y under 5,5
del mismo partido no son dos apuestas: con siete tarjetas pierden las dos.

---

## 3. Qué se mide, cómo, y qué contaría como éxito

**La vara es `lib/vara.js`**, sin excepciones: EV ticket a ticket contra la probabilidad sin margen del
cierre del mismo contrato y la misma casa, agregado con bootstrap por racimos de partido. El CLV se anota
como diagnóstico de movimiento de línea y **no entra en el veredicto**.

**Criterio de éxito, declarado antes de mirar:** `cards_under_v2` se promueve cuando su veredicto es
`invertible` —EV > 0 con t ≥ 2 sobre eventos y muestra suficiente— **y** le gana a `cards_under_v1`
corriendo en paralelo sobre las mismas fechas, con la diferencia fuera del intervalo por racimos.

**Criterio de fracaso, igual de declarado:** veredicto `cerrar` (t ≤ −2), o no superar a la v1 con la
muestra objetivo cumplida. En ese caso la v2 se retira a `lib/retiradas.js` como control y se dice por qué.

### El tamaño de muestra, calculado y no inventado

Con la varianza real del libro de tarjetas (155 apuestas liquidadas, cuota media **1,780**, ROI −2,03 %
con IC por racimos [−17,71 %, +14,03 %], `lib/inferencia.js`):

| ROI verdadero a detectar | apuestas necesarias (α 0,05, potencia 0,80) | inflado por racimos (1,26 filas/partido) |
|---|---:|---:|
| 2 % | 15.277 | ~19.200 |
| 3 % | 6.783 | ~8.500 |
| 5 % | 2.437 | ~3.100 |
| 8 % | 948 | ~1.200 |

**Hay que leer esta tabla y aceptar lo que dice.** A 18,7 apuestas por semana, detectar un ROI verdadero
del 3 % tardaría **siete años**. El punto de decisión del 20-oct con 100 liquidadas **no certifica nada**:
es un control operativo de riesgo, exactamente como la auditoría escribió. Con 100 apuestas a cuota 1,78 el
intervalo del ROI mide unos 20 puntos de ancho — cabe dentro cualquier conclusión.

**Por eso la muestra objetivo de este preregistro NO es de tickets, es de EV contra el cierre:** 100
eventos con cierre valorable (las dos caras del mismo contrato en la misma casa), que es lo que la vara
necesita para dar un veredicto con t. Ese contador es el que manda, y hoy vale cero: el archivo de cierres
de tarjetas no guarda las dos caras. **Arreglar esa captura es el trabajo previo a todo lo demás**, y sin
él este preregistro no puede cerrarse de ninguna forma.

---

## 4. Calendario y estado

| | |
|---|---|
| **Escrito** | 15-sep-2026, antes del primer ticket de la v2 |
| **Inicio** | cuando se encienda `GP_CARDS_CONTEO_CASA=1` y la captura de cierres guarde las dos caras. **No antes.** |
| **Control en paralelo** | `cards_under_v1` sigue corriendo intacta, marcada `control`. Su regla NO se toca durante la ventana. |
| **Reajuste de hiperparámetros** | mensual, con validación interna, sin mirar picks vivas |
| **Corte** | 100 eventos con cierre valorable, o el 31-dic-2026, lo que llegue antes |
| **Dinero** | ninguno. La v2 nace y vive en sombra hasta que pase el listón de `real-executor/parada.js`. |

## 5. Lo que este preregistro se compromete a NO hacer

- No cambiar el listón, las líneas, el universo ni la casa una vez empezada la ventana. Si algo de eso
  cambia, la ventana se cierra y empieza otra con otro número de versión.
- No reciclar tickets anteriores a la fecha de inicio.
- No leer el resultado antes del corte para decidir si seguir. El estado se puede mirar; la regla no se
  toca.
- No contar el resultado como significativo sin aplicar Benjamini–Hochberg junto al resto de familias que
  se estén juzgando a la vez (`docs/REGISTRO_EXPERIMENTOS.md` lleva el contador).
