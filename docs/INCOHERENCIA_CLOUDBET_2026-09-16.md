# La incoherencia interna de Cloudbet: real, medida, y **no es dinero**

**De dónde sale.** Midiendo C-2 apareció de rebote: el mercado HT/FT de Cloudbet y su propio 1X2 de primera
parte **no dicen lo mismo**. La marginal del descanso que sale de sumar las tres celdas de una fila del
HT/FT se separa de la que publica su 1X2 de 1ª parte una **mediana de 0,92 pp, y hasta 5,28**. Contra el
1X2 del partido completo, mediana 0,93 pp y hasta 3,60.

Eso es una discrepancia **precio contra precio dentro de la misma casa**, que es exactamente la familia que
la doctrina dice que funciona: lo que gana en este sistema (cs2 rondas, tarjetas) gana por precio y momento,
no porque el modelo acierte. Así que la pregunta obligada era si se puede cobrar.

**Se probó. No se puede.** Y conviene que quede escrito con los números, porque es la clase de hallazgo que
parece una oportunidad hasta que se calcula.

---

## 1. Arbitraje: cero de 1.104

Las tres celdas de la fila *i* del HT/FT cubren exactamente «va ganando *i* al descanso». Los otros dos
resultados del 1X2 de 1ª parte cubren «no va ganando *i*». Juntos son exhaustivos y excluyentes: si la suma
de las implícitas **crudas** es menor que 1, hay beneficio garantizado pase lo que pase. Lo mismo con las
columnas y el 1X2 del partido.

Probadas las cuatro formas sobre **92 partidos, 1.104 combinaciones**:

| combinación | n | la mejor | la mediana |
|---|---:|---:|---:|
| fila HT/FT + 1X2 de 1ª parte | 276 | **+5,37 %** | +11,89 % |
| las otras dos filas + 1X2 de 1ª parte | 276 | +5,59 % | +17,59 % |
| columna HT/FT + 1X2 del partido | 276 | +5,62 % | +11,68 % |
| las otras dos columnas + 1X2 del partido | 276 | +6,13 % | +16,81 % |

**Arbitrajes encontrados: 0.** Ni uno. La combinación más barata de las 1.104 todavía cuesta **+5,37 %**, y
la mediana está entre el 11 % y el 17 %.

## 2. Una sola pata, apostando el HT/FT: cero de 276

Si el 1X2 de 1ª parte es el mercado afilado (6 % de sobre-redondeo frente al 22 % del HT/FT, que es la
señal habitual de cuál mira la casa con más cuidado), lo lógico sería usarlo como verdad y apostar donde el
HT/FT discrepa. Pero eso significa apostar **en el mercado del 22 %**:

**0 de 276 con EV positivo. EV mediano −18,08 %.** El mejor caso de los 276 es −2,45 %. El peaje del HT/FT
se come la discrepancia veinte veces.

## 3. Una sola pata, apostando el 1X2 de 1ª parte: **el artefacto**

La dirección contraria —usar el HT/FT como verdad y apostar en el mercado barato— parecía dar algo:
**6 de 276 con EV positivo**, el mejor +14,41 %.

Pero los cinco mejores salían todos a **cuota alta** (14,00 · 7,65 · 7,55 · 7,30 · 5,25), y esa es la firma
de un artefacto conocido, no de una oportunidad: quitar el margen dividiendo todas las implícitas por el
mismo Q **sobrestima la probabilidad justa de los resultados raros**, porque las casas cargan más margen en
el longshot. En un mercado de NUEVE salidas con 22 % de sobre-redondeo, ese sesgo es enorme.

Se repitió quitando el margen **por potencia** (buscar *k* tal que Σ pᵢᵏ = 1, que quita más al favorito y
menos al longshot):

| método | con EV positivo | EV mediano | EV medio a cuota ≥ 5 | EV medio a cuota < 5 |
|---|---:|---:|---:|---:|
| proporcional | **6 de 276** | −6,07 % | **−1,24 %** | −6,94 % |
| potencia (k mediano 1,114) | **1 de 276** | −7,16 % | **−17,34 %** | −7,23 % |

**La oportunidad cambia de signo según cómo se quite el margen.** Con el método proporcional los longshots
parecen los mejores (−1,24 %); con el método de potencia son los peores (−17,34 %), y de los seis positivos
sobrevive uno solo, a +1,23 %, que es ruido.

Eso es la definición de artefacto: el hallazgo es una propiedad de mi método, no de los precios. Y el
exponente medido (**k = 1,114**, por encima de 1) confirma el mecanismo: la casa sí carga más margen en las
salidas raras.

---

## Por qué no podía salir, en una línea

**La discrepancia vale 0,92 pp y la forma más barata de actuar sobre ella cuesta 3 % por lado.** Para
cobrar una incoherencia hace falta que sea más grande que el peaje de cruzarla, y ésta es cuatro veces más
pequeña. No es que la incoherencia no exista: es que la casa cobra por dejarte opinar sobre ella más de lo
que vale la opinión.

## Qué SÍ podría ser dinero, y no se ha probado

La misma prueba **entre casas**, no dentro de una. Comparar el HT/FT de Cloudbet contra el HT/FT de otra
casa: ahí se paga **un solo margen** en vez de dos, y las discrepancias entre libros distintos son de otro
orden de magnitud que las internas — no 0,92 pp, sino varios puntos cuando una casa mueve la línea y otra
no. Es exactamente la familia que ya funciona en este sistema (valor, arbitraje, caídas, middles).

**Pero no lo abre este documento**, y conviene decir por qué: hoy solo bajamos el HT/FT de Cloudbet. Hacer
esa prueba exige el mismo mercado de un segundo libro, y ninguna de las casas que ya leemos publica HT/FT
en nuestro pipeline. Es trabajo de datos, no de modelo — y es el único camino de los tres que no está
cerrado por aritmética.

**Reproducible:** `node scripts/cloudbet-incoherencia.js <carpeta de eventos de Cloudbet>`
