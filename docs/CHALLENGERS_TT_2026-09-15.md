# Los aspirantes del tenis de mesa — resultados

> **T2.10 a T2.13 del plan de trabajo de la auditoría externa.** Ejecutado el 15-sep-2026.
> Reproducible: `node scripts/tt-challengers.js [--solo=poblacion|duracion|challengers]`.
> Identidades: `node tests/tt-identidades.test.js`. Compilador: `node -e "console.log(require('./tt-engine/compiler').selfTest().ok)"`.
> Registro de los experimentos: `docs/REGISTRO_EXPERIMENTOS.md` (E-005 a E-009 y E-015).

## La pregunta

El tenis de mesa tiene dinero real: `POINTS_TOTAL` en Cloudbet, 5 USD planos, 60 apuestas liquidadas. El
motor que decide esas apuestas es un compilador exacto punto → game → partido, y hasta hoy **nunca se había
comparado con nada**: las constantes se eligieron por el log-loss del GANADOR y las superficies se midieron
contra una referencia de media constante. Un modelo que gana a nada no ha ganado nada.

Cuatro preguntas, en el orden en que hay que contestarlas:

1. **¿Sobre qué población se ha validado?** Solo 30.644 de 192.460 filas tienen fecha exacta (T2.13).
2. **¿De dónde sale el error del total?** `E[puntos] = Σ_k P(n_games = k)·E[puntos | k]` (T2.11).
3. **¿Hay algo mejor que el compilador?** Tres aspirantes y dos controles (T2.11).
4. **¿El listón de ruido mide lo que dice medir?** `unc_pp` es del ganador y juzga totales (T2.10).

## El montaje

**Datos.** Las 192.460 filas del compacto propio (`data/tt/matches.json.gz`, 1992 → 8-sep-2026, 15.732
jugadores). El replay cronológico usa el historial ENTERO con las constantes congeladas de
`data/tt/model-priors.json` — no el recorte a 2020 que hace `D.build()` en memoria para caber en Render, y
que `scripts/tt-fit.js` heredó sin querer.

**Universo evaluable.** Partidos de mayores (MS/WS), sin retirada, con formato conocido, tres games o más y
los dos jugadores por encima de `warmN` = 8 partidos previos. Desde 2024-01-01 son **15.320 partidos**; la
ventana que se evalúa (2025-01 → 2026-09) son **10.118**.

**Protocolo.** Validación hacia adelante en **21 bloques mensuales**, entrenando cada bloque con todo lo
estrictamente anterior. Los hiperparámetros se eligen DENTRO del entrenamiento, en una validación interna
sobre su último 20 % por fecha: el bloque que se evalúa no se toca nunca. La incertidumbre es un bootstrap
por racimos de **torneo** (`lib/inferencia.js`) —dos partidos del mismo torneo comparten jugadores, mesa y
pelota— y se reporta además el racimo de partido para que se vea cuánto aporta la corrección. Sobre las
comparaciones declaradas se aplica Benjamini–Hochberg al 10 %.

**La comprobación que valida el banco de pruebas.** Corriendo con `--desde=20260101` el script reproduce
**exactamente** los números congelados del holdout de `model-priors.json`: n 4.557, puntos 71,885 reales
contra 71,232 del modelo, barridas 0,4005 contra 0,4117, deuce 0,1578 contra 0,1489. Si no reprodujera esos
seis dígitos, nada de lo que sigue valdría.

**Los aspirantes.**

| id | qué es |
|----|--------|
| **TT0** | el compilador de producción, tal cual: θ → probabilidad de punto → (a, b) con δ = 0,03 → distribución exacta del total |
| **TT1** | Elo **recalibrado** (logística de dos parámetros sobre logit(p_Elo)) + distribución empírica de puntos por cubo de favoritismo × formato, suavizada por núcleo, con el número de cubos, la contracción y el ancho elegidos en el entrenamiento |
| **TT2** | saque/resto jerárquico — **solo si es identificable** |
| **TT3** | forma persistente: media móvil por jugador de su desviación de puntos por game respecto a lo que TT0 le predijo, con vida media y peso elegidos en el entrenamiento |
| **C1** *(control)* | la distribución empírica del formato, sin mirar quién juega. El "no sé nada" de este deporte |
| **C2** *(control)* | binomial negativa con la MEDIA del compilador y la dispersión del entrenamiento. Aísla una pregunta: ¿aporta algo la FORMA de simular el punto, o basta con la media y dos momentos? |

**Las líneas.** La calibración se mide en las que Cloudbet cotiza de verdad, sacadas del libro real del
ejecutor: **69,5 · 73,5 · 74,5 · 75,5** al mejor de 5 y **106,5 · 107,5** al mejor de 7. Calibrar en 2,5 y
3,5 de laboratorio es medir una superficie que nadie paga.

---

## 1. La población (T2.13): no es una muestra, es un corte de época

**La ausencia de fecha no es aleatoria: es perfectamente estructural.** La fecha exacta la pone el
calendario de eventos de la WTT, que empieza en 2021. El reparto por año no deja lugar a dudas:

| año | filas | con fecha | % |
|---|---:|---:|---:|
| 1992–2021 | 161.816 | **0** | 0,0 % |
| 2022 | 3.834 | 3.389 | 88,4 % |
| 2023 | 7.436 | 6.966 | 93,7 % |
| 2024 | 8.122 | 8.002 | 98,5 % |
| 2025 | 6.515 | 6.515 | 100 % |
| 2026 | 5.772 | 5.772 | 100 % |

No hay una sola fila fechada antes de 2022 y casi ninguna sin fechar después de 2024. Las que no la tienen
entran al replay con la fecha **1 de julio de su año**.

**En qué se diferencian las excluidas.** En casi todo lo que define un partido:

| | con fecha (30.644) | sin fecha (161.816) |
|---|---:|---:|
| juveniles | 8,8 % | 54,5 % |
| al mejor de 7 | 21,3 % | 35,3 % |
| jugadores distintos | 3.259 | 14.494 (12.063 **solo** aquí) |
| partidos previos del jugador al jugar | 310,6 | 120,4 |
| ranking ITTF medio | 202 | 271 |
| cobertura de ranking | 85,8 % | 62,6 % |

Por nivel de evento el corte es binario: WTT Champions 100 %, Feeder 99,5 %, Contender 83,3 %, Star
Contender 80,7 % — y Continental 0 %, Olímpicos 0 %, ITTF Tour 0,5 %, juvenil 0,19 %. **La base fechada es
el circuito WTT moderno; la no fechada es todo lo demás.**

**Y sin embargo, el juego es el mismo.** Los observables, con bootstrap por torneo:

| | con fecha | sin fecha | diferencia |
|---|---|---|---|
| puntos por partido | 75,209 [74,02; 76,43] | 78,212 [77,16; 79,82] | −3,003 |
| games por partido | 4,104 [4,040; 4,170] | 4,255 [4,216; 4,297] | −0,150 |
| **puntos por game** | **18,2222** [18,189; 18,257] | **18,2223** [18,111; 18,432] | **−0,0001** |
| deuce por game | 0,1439 [0,1416; 0,1465] | 0,1361 [0,1346; 0,1374] | +0,0078 |
| barridas | 0,4099 [0,4006; 0,4190] | 0,4378 [0,4314; 0,4437] | −0,0280 |

Los partidos excluidos son más largos, pero **no porque el game sea distinto: porque hay más al mejor de 7**.
Los puntos por game coinciden hasta el cuarto decimal. Restringiendo al MISMO estrato (mayores, al mejor de
5) la diferencia de puntos por game es +0,081 con los intervalos solapados; lo que sí se mueve de verdad es
el deuce, +0,61 pp (0,1433 [0,1407; 0,1459] contra 0,1372 [0,1336; 0,1406]).

**La era de los 21 puntos** (el reglamento cambió en septiembre de 2001) son **46 filas de 192.460**:
0,024 %. No contamina nada, pero conviene que esté escrito.

**¿Y el orden inventado?** Las 161.816 filas sin fecha entran al replay con la fecha 1 de julio, así que
dentro de cada año el orden cronológico es el del identificador de torneo, que es arbitrario. Como los
ratings se construyen en ese orden, había que medir cuánto dependen las predicciones de él. Barajando el
bloque sin fecha dentro de cada año, cuatro veces:

| | base | barajado | rango |
|---|---:|---|---:|
| puntos esperados del modelo | 72,3776 | [72,3444; 72,3600] | 0,0156 |
| error absoluto medio de puntos | 14,2478 | [14,2352; 14,2421] | 0,0069 |
| log-loss del Elo | 0,53443 | [0,53450; 0,53458] | 0,00008 |

**El orden arbitrario del 84 % de la base mueve la predicción 0,016 puntos**, cuando el error del propio
modelo es de 0,65. No es un problema; ahora está medido en vez de supuesto.

### El veredicto de T2.13

La validación temporal sobre 30.644 filas **es representativa de lo que el modelo predice en producción** —
competiciones WTT/ITTF de mayores desde 2022, que es exactamente el perímetro `VERIFIED_SCOPE` del motor— y
**no es representativa de la base que entrena los ratings**, que es mayoritariamente juvenil, pre-2022 y de
jugadores que nunca vuelven a aparecer. Las dos cosas son ciertas a la vez y ninguna es un defecto: es la
consecuencia de que la fuente de fechas empiece en 2021.

Lo que **no** se puede hacer es imputar fechas para "recuperar" las 161.816 filas en una validación
temporal. Sería inventar el orden y después validar el orden inventado. Se dejan donde están: construyendo
ratings, sin ser nunca objeto de evaluación.

---

## 2. La duración (T2.11): el game está bien, la mezcla no

`E[puntos] = Σ_k P(n_games = k) · E[puntos | n_games = k]`, con las dos mitades medidas por separado.

**La segunda mitad es casi perfecta.** E[puntos | k] del modelo, calculada exacta (condicionado al ganador
de cada game, los games son independientes, así que `E[puntos | marcador] = ga·E[t | gana A] + gb·E[t | gana B]`):

| n_games | P real | P modelo | puntos reales | puntos modelo | n |
|---|---:|---:|---:|---:|---:|
| 3 | 0,3828 | 0,3832 | 53,519 | 53,443 | 5.865 |
| 4 | 0,3452 | **0,3345** | 73,908 | 73,809 | 5.289 |
| 5 | 0,2435 | **0,2525** | 93,611 | 93,516 | 3.731 |
| 6 | 0,0159 | 0,0165 | 113,020 | 111,971 | 244 |
| 7 | 0,0125 | 0,0133 | 131,723 | 131,354 | 191 |

Los puntos condicionados a la duración fallan entre 0,08 y 1,05 sobre totales de 53 a 132: **entre el 0,1 % y
el 0,9 %**. El compilador sabe cuánto dura un game. Lo que no sabe es cuántos games va a haber: pone un punto
porcentual de más en los partidos de cinco games y uno de menos en los de cuatro.

**Y la media global no lo enseña.** Sobre los 15.320 partidos, el sesgo del total es **+0,133 puntos
[−0,166; +0,393], t 0,92**: insesgado. Descompuesto, +0,227 de duración y −0,094 de game, que se comen entre
sí. Ese es justo el tipo de compensación que una media esconde y que, familia a familia, se paga.

### El hallazgo: el error es monótono en el favoritismo

| cubo de favoritismo | n | puntos reales | modelo | diferencia | IC 95 % | t |
|---|---:|---:|---:|---:|---|---:|
| parejo (<0,05) | 1.900 | 75,846 | 77,371 | **+1,525** | [0,732; 2,295] | 3,67 |
| leve (0,05–0,15) | 3.650 | 75,531 | 76,703 | **+1,173** | [0,624; 1,702] | 4,27 |
| claro (0,15–0,30) | 5.188 | 73,654 | 73,893 | +0,239 | [−0,240; 0,688] | 1,00 |
| aplastante (>0,30) | 4.582 | 66,538 | 65,145 | **−1,393** | [−1,906; −0,898] | −5,40 |

Y en 2026 a solas, más fuerte: +1,897 [0,500; 3,371] en los parejos y **−2,353 [−3,141; −1,590], t −6,09** en
los aplastantes.

**Lectura.** El modelo estira demasiado la escala: cree que los partidos parejos son más largos de lo que
son y que las palizas son más cortas de lo que son. Es decir, **su probabilidad de punto reacciona demasiado
al rating**. La constante que gobierna eso, `pointScaleDist`, se congeló en **1,0** — sin ninguna
contracción — porque la rejilla de `tt-fit.js` la eligió por una puntuación compuesta de medias agregadas, y
en la media agregada los dos errores se cancelan (+0,133, t 0,92). *La constante no estaba mal: estaba
elegida con una métrica que no puede ver el defecto.*

Esto importa donde hay dinero: `POINTS_TOTAL` se apuesta partido a partido, no en agregado. Una apuesta al
total de una paliza se toma sobre un modelo que se queda 1,4 puntos corto; una al total de un partido parejo,
sobre uno que se pasa 1,5.

**Otros cortes** (todos en `docs/` reproducibles con `--solo=duracion`): al mejor de 7 el sesgo es +1,396
[−0,169; 3,612] contra +0,035 al mejor de 5; con jugadores frescos (≤30 días) +0,363 [0,030; 0,701] y con
jugadores rancios (>240 días) +1,110 [0,015; 2,210]; por competición nada sobrevive al intervalo salvo
muestras con dos o tres torneos detrás, que no cuentan (el script imprime el número de racimos justo para
que no se lean como si contaran).

---

## 3. Los aspirantes (T2.11)

Log-score y CRPS del total de puntos, pareados partido a partido, 10.118 partidos en 88 torneos.

| aspirante | log-score | Δ vs TT0 | IC 95 % | t | p | CRPS | Δ CRPS | t |
|---|---:|---:|---|---:|---:|---:|---:|---:|
| **TT1** · empírico por gap×formato | **4,14842** | **−0,07145** | [−0,10183; −0,04461] | **−4,81** | 0,000006 | **9,82592** | −0,01254 | −0,28 |
| C1 · empírico por formato *(control)* | 4,17792 | −0,04195 | [−0,07524; −0,01337] | −2,66 | 0,0093 | 10,16066 | **+0,32220** | **5,50** |
| TT0 *(actual)* | 4,21987 | — | — | — | — | 9,83846 | — | — |
| TT3 · forma persistente | 4,22039 | +0,00052 | [−0,00058; 0,00173] | 0,89 | 0,378 | 9,83652 | −0,00194 | −0,35 |
| C2 · NB con la media del compilador | 4,25749 | +0,03762 | [0,00555; 0,06614] | 2,42 | 0,0175 | 9,84204 | +0,00359 | 0,34 |

Benjamini–Hochberg al 10 % sobre las cuatro comparaciones: umbral **0,017547**; sobreviven TT1 y C1 **a
favor** y C2 **en contra**. El bootstrap por torneo da errores estándar un 22 % mayores que el de partido; la
corrección importa y no cambia ningún signo.

### Lo que esto dice, en tres piezas

**1. TT0 acierta la media y falla la anchura.** TT1 le gana en log-score y solo le empata en CRPS, y el CRPS
es la métrica sensible a la posición. Traducido: el compilador pone el centro donde va y la campana demasiado
estrecha. Medido:

| modelo | sd declarada | sd real | z² medio | IC 95 % |
|---|---:|---:|---:|---|
| **TT0** | **15,858** | 17,351 | **1,2689** | [1,2179; 1,3213] |
| TT1 | 17,428 | 17,326 | 0,9912 | [0,9667; 1,0164] |
| TT3 | 15,843 | 17,346 | 1,2756 | [1,2275; 1,3258] |
| C1 | 17,821 | 17,841 | 1,0028 | [0,9792; 1,0254] |
| C2 | 19,238 | 17,351 | 0,8310 | [0,8049; 0,8588] |

**La varianza real del total supera en un 27 % a la que TT0 declara.** Eso es todo el log-score que pierde, y
enlaza directamente con T2.10 (apartado 4).

**2. La forma del compilador no sobra — pero tampoco es la que paga.** C2, que le presta a TT0 su media y le
cambia la forma por una binomial negativa, **pierde** (+0,03762, t 2,42, sobrevive a BH en contra): simular el
punto describe la cola mejor que dos momentos. Y C1, que ni siquiera mira quién juega, **gana en log-score y
pierde con claridad en CRPS** (+0,32220, t 5,50): su forma es correcta y su centro, malo. Las dos mitades del
problema se separan limpiamente.

**3. La forma persistente no existe, y el entrenamiento se equivocó al creerla.** TT3 eligió peso λ > 0 en
**19 de 21 bloques** —la validación interna estaba convencida— y fuera de muestra no aporta nada: +0,00052
[−0,00058; 0,00173], t 0,89. No hay un "ritmo" de jugador que persista más allá de lo que el rating ya sabe.
Vale la pena dejarlo escrito: en tarjetas el entrenamiento eligió `damp > 0` en 10 de 10 bloques y acertó;
aquí eligió λ > 0 en 19 de 21 y se equivocó. **Que el entrenamiento elija un hiperparámetro no es evidencia
de nada; solo lo es que el bloque no visto lo confirme.**

### Un segundo intento, declarado (E-015)

En la primera corrida el ancho de núcleo elegido por TT1 fue el mínimo de la rejilla (1,5) en 19 de 21
bloques: el entrenamiento pedía menos suavizado del que se le ofrecía, así que la victoria podía ser del
borde. Se amplió la rejilla por abajo a {0,5; 0,75; 1; 1,5; 3; 5} y se volvió a correr, **anotándolo como
intento nuevo antes de mirar el resultado**. Con la rejilla ampliada el óptimo queda en el interior (1,5 en
17 de 21) y TT1 gana lo mismo: −0,07145 contra −0,07132. El hallazgo no era del borde.

### Calibración en las líneas que la casa cotiza

Y aquí TT1 **no** mejora lo que importa:

| modelo | línea (BO5) | modelo | real | sesgo | IC 95 % | Brier |
|---|---|---:|---:|---:|---|---:|
| TT0 | over 69,5 | 0,5098 | 0,5166 | −0,68 pp | [−1,71; 0,27] | 0,2393 |
| TT0 | over 73,5 | 0,4205 | 0,4230 | −0,25 pp | [−1,19; 0,70] | 0,2360 |
| TT0 | over 74,5 | 0,3980 | 0,3976 | +0,04 pp | [−0,91; 0,98] | 0,2332 |
| TT0 | over 75,5 | 0,3768 | 0,3751 | +0,17 pp | [−0,79; 1,01] | 0,2289 |
| TT1 | over 73,5 | 0,4237 | 0,4230 | +0,07 pp | [−1,03; 1,12] | 0,2349 |
| TT1 | over 75,5 | 0,3798 | 0,3751 | +0,47 pp | [−0,61; 1,54] | 0,2268 |
| TT0 | over 106,5 (BO7) | 0,3616 | 0,3690 | −0,74 pp | [−4,72; 4,55] | 0,2274 |
| TT1 | over 106,5 (BO7) | 0,3287 | 0,3690 | **−4,03 pp** | [−11,04; 1,46] | 0,2232 |

**TT0 está bien calibrado en las seis líneas** (todos los intervalos contienen el cero) y TT1 lo mejora una
milésima de Brier al mejor de 5 mientras se desvía 4 pp al mejor de 7, donde tiene 645 partidos y el empírico
se queda sin muestra. C2 es el peor: −3,20 pp [−4,21; −2,24] en la 69,5.

**Conclusión operativa: no hay motivo para cambiar de modelo hoy.** TT1 gana una comparación de densidad que
no se cobra en ninguna línea. Lo que sí hay que arreglar es lo que las dos comparaciones señalan a la vez: la
anchura de TT0 y su escala de favoritismo.

---

## 4. TT2 y la incertidumbre (T2.10)

### TT2 no se construye, y no por falta de ganas

El blueprint congeló δ = 0,03 como prior de población y escribió que el reparto saque/resto (L2) no está
identificado con esta fuente. Hasta hoy eso era una afirmación sin número. Ahora tiene dos.

**El primero es una simetría, y decide el asunto antes de mirar datos.** Con el primer servidor desconocido
—que es el caso en todo partido antes del sorteo, y la fuente nunca lo publica— la verosimilitud mezcla al
50 % los dos servidores iniciales. Cambiar δ por −δ es intercambiar a y b, que es exactamente lo mismo que
intercambiar el primer servidor: **la mezcla es invariante**. El signo de δ no se identifica ni con infinitos
datos, y δ = 0 es siempre un punto crítico.

**El segundo es la curvatura.** Perfil de verosimilitud sobre los 60.207 games de la ventana, con la
probabilidad de punto fijada por θ:

| δ | log-verosimilitud por game |
|---|---:|
| **0** | **−2,98639** |
| 0,01 | −2,98641 |
| 0,02 | −2,98650 |
| 0,03 *(el congelado)* | −2,98661 |
| 0,06 | −2,98748 |
| 0,12 | −2,99206 |

El máximo está en δ = 0 con un error estándar de **0,00598**, y la razón de verosimilitudes contra el δ = 0,03
del blueprint es **25,96** (un grado de libertad, p ≈ 3,5·10⁻⁷). O sea: **los datos rechazan el δ congelado**,
y lo que dicen es que la ventaja de saque, medida a través de la forma del game, es indistinguible de cero.

Escalando por 1/√n, un jugador necesitaría:

| games del jugador | se(δ) |
|---|---:|
| 100 | 0,147 |
| 300 | 0,085 |
| 1.000 | 0,046 |
| 3.000 | 0,027 |

Con |δ| acotado por los datos en unas milésimas, un δ **por jugador** tendría un error estándar entre diez y
veinticinco veces mayor que el efecto que pretende medir. **TT2 no es identificable con los marcadores por
game que tenemos y no se construye.** Para construirlo hace falta otra fuente: quién sirvió cada punto.

Dicho eso, δ = 0,03 mueve poco y la diferencia de log-verosimilitud por game es de 2,2·10⁻⁴; cambiarlo a 0
cambiaría qué picks nacen y **no se toca** sin decisión.

### La incertidumbre por familia: el listón medía otra cosa

`tt-engine/data.js:143` calcula una sola incertidumbre —la del GANADOR,
`100·0,28·√(1/(nA+2)+1/(nB+2))`— y `tt-engine/store.js:352` la usa como listón de ruido para **todas** las
familias, `POINTS_TOTAL` incluida. No son la misma cantidad: la del ganador mide cuánto se mueve P(gana A)
con el rating; la de un total mide cuánto se mueve P(más de L), que es otra derivada.

**Cómo se mide la propia.** Por el método delta, con σ_p la desviación del rating en probabilidad de punto:

```
Var(total)      = Var_compilador(total | p) + (∂E[total]/∂p)² · σ_p²
unc(selección)  = |∂P(selección)/∂p| · σ_p
```

Las dos derivadas salen de recompilar en p ± h, que el compilador ya sabe hacer y cachea.

**Y σ_p no se supone: se mide.** El exceso de dispersión del apartado 3 se regresa sobre
`(∂E/∂p · √(1/(nA+2)+1/(nB+2)))²` **con ordenada en el origen**, y la ordenada es la mitad del hallazgo:

| pieza | valor |
|---|---|
| α — anchura que le falta a TODOS | **43,95 puntos²** (6,63 puntos de desviación) |
| c — σ_p por unidad de exposición | **0,1064** [0,0273; 0,1486] |
| desviación extra que aporta el rating | 2,373 puntos |

| | z² antes | + solo rating | + rating y α |
|---|---:|---:|---:|
| global | 1,2689 | 1,2322 | **1,0194** |
| cuartil 1 de exposición (n medio 583) | 1,2415 | 1,2355 | 1,0383 |
| cuartil 2 (n medio 362) | 1,2323 | 1,2210 | 1,0147 |
| cuartil 3 (n medio 225) | 1,2094 | 1,1864 | 0,9907 |
| cuartil 4 (n medio 132) | 1,3924 | 1,2859 | 1,0339 |

**Un ajuste por el origen habría sido un error, y grande.** El exceso de dispersión es casi constante en los
tres primeros cuartiles y solo crece en el cuarto: **la mayor parte NO es incertidumbre del rating, es que la
distribución compilada es demasiado estrecha para todo el mundo**. Forzar todo el exceso a depender de la
exposición habría inflado el listón de ruido de los jugadores más conocidos —justo donde el modelo es
fiable— y habría escondido un defecto del compilador vendiéndolo como incertidumbre. Con las dos piezas
separadas, la razón de varianzas queda en 1,019 y deja de depender de la exposición.

**Son dos arreglos en dos sitios distintos:** α en el compilador (una distribución demasiado estrecha es una
mala especificación, y la sospecha razonable es la misma escala de favoritismo del apartado 2); c en la
puerta de ruido.

### Cuántas tesis nacen con una y con otra

| | unc del ganador | unc propia del total | razón | la puerta muerde |
|---|---:|---:|---:|---|
| BO5 · over 69,5 | 3,605 pp | 4,625 pp | ×1,28 | 31,6 % → **44,6 %** |
| BO5 · over 73,5 | 3,605 pp | 4,360 pp | ×1,21 | 31,6 % → **41,7 %** |
| BO5 · over 74,5 | 3,605 pp | 4,239 pp | ×1,18 | 31,6 % → **40,5 %** |
| BO5 · over 75,5 | 3,605 pp | 4,110 pp | ×1,14 | 31,6 % → **38,8 %** |
| BO7 · over 106,5 | 2,355 pp | 3,044 pp | ×1,29 | 8,5 % → **25,1 %** |
| BO7 · over 107,5 | 2,355 pp | 2,983 pp | ×1,27 | 8,5 % → **23,6 %** |

Tesis que nacerían, sobre los 9.473 partidos al mejor de 5 y 645 al mejor de 7 de la ventana, con la ventaja
declarada que se indique (la puerta es `edge ≥ 3 pp` **y** `edge ≥ 0,75·unc`):

| ventaja | BO5 73,5 con el listón de hoy | con el propio | BO7 106,5 hoy | con el propio |
|---|---:|---:|---:|---:|
| 3 pp | 6.484 | **5.519** (−14,9 %) | 590 | **483** (−18,1 %) |
| 4 pp | 7.677 | **6.846** (−10,8 %) | 623 | **589** (−5,5 %) |
| 5 pp | 8.432 | 7.624 (−9,6 %) | — | — |
| 6 pp | 8.989 | 8.181 (−9,0 %) | — | — |

**El listón de hoy es demasiado BLANDO justo donde hay dinero.** Entre el 9 % y el 18 % de las tesis que hoy
nacen no superarían su propio ruido. Y de paso: la incertidumbre del propio ganador, propagada como debe,
sale **5,69 pp** frente a los 3,53 pp que da la fórmula del 0,28 — la constante tampoco es la del ganador.

### Lo que se ha cambiado en el código, y lo que no

**Cambiado (no toca ninguna pick):** `tt-engine/data.js` expone `pointSigma()` y `uncFamiliaPp()`, y cada
candidata del catálogo lleva ya su `unc_fam_pp` calculada y guardada en la sombra. Es medición.

**Detrás de interruptor:** `GP_TT_UNC_FAMILIA`. Con él puesto, la puerta de ruido usa la incertidumbre propia
de cada familia en vez de la del ganador. **Sin poner, nada cambia.** Cambiar el listón cambia qué tesis
nacen y eso es una decisión, no un arreglo — la disciplina que costó la autopsia de agosto.

**Una trampa que mordió al escribirlo, por si vuelve:** `store.eventModel()` devuelve
`{ ...matchModel(), a: <jugador A>, b: <jugador B> }`, o sea que **pisa** las dos probabilidades de punto con
las fichas de los jugadores. Cualquier cálculo que las lea de ahí sale NaN, y con un suelo puesto el NaN se
disfraza de un número plausible sin avisar. Las que sobreviven son `p_point_dist` y `serve_delta`.

---

## 5. Las identidades de QA (T2.12)

Dos identidades que salen del reglamento y que tienen que cumplirse exactamente:

1. **Dentro de un game, hándicap −1,5 puntos ≡ ganar el game.** El margen mínimo son dos puntos.
2. **Over 20,5 ≡ over 21,5 ≡ que el game llegue a deuce.** El total 21 no existe (11–10 no cierra) y desde el
   deuce los totales solo pueden ser pares.

`tests/tt-identidades.test.js`, 18 comprobaciones, **0 fallos**:

| identidad | peor desvío |
|---|---|
| over 20,5 ≡ over 21,5 | **0** exacto |
| over 20,5 ≡ P(deuce) | 7,0·10⁻¹² |
| hándicap −1,5 y −0,5 ≡ ganar el game | 5,6·10⁻¹⁶ |
| misma clase de pago ⇒ mismo precio (80 parejas) | 7,0·10⁻¹² |

El 7·10⁻¹² no es un error: es el ε de la cola de deuce que el compilador trunca **y reporta**, sin adjudicar
nunca la masa residual a un ganador (bloque 12.2 del blueprint). Es la diferencia entre un modelo que redondea
y uno que dice dónde redondea.

### Pero el catálogo sí tiene un agujero, y este es el hallazgo

El compilador **ya sabía** que estas apuestas son la misma (`payoffEquivalences()`), pero solo para
**enseñarlo en pantalla**: el catálogo deduplica por `familia|lado|línea|game`, así que

> "más de 20,5 puntos del 1er game", "más de 21,5 puntos del 1er game" y "deuce en el 1er game"

son **tres candidatas distintas** para el sistema y **una sola apuesta** para el bolsillo. Igual que "gana el
1er game" y "hándicap −1,5 del 1er game". Sobre una parrilla de cinco selecciones equivalentes, el dedupe de
hoy ve **5** y las clases de pago ven **2**.

Que no haya costado dinero todavía es suerte del catálogo de la casa: Cloudbet no cotiza el deuce de tenis de
mesa y el libro de la sombra solo tiene `POINTS_TOTAL`, `GAME_POINTS_HCP`, `GAME_ML` y `ML`. **Bovada sí lo
cotiza**, y también líneas alternativas de total de game. Apilar la misma apuesta ya costó −17,63 % de ROI en
tarjetas con dos líneas y −45,83 % con tres; el agujero está abierto.

**Lo que se ha hecho:** `tt-engine/rules.js` gana `equivalenceKey()`, que construye la clase de pago desde el
CONJUNTO ALCANZABLE en vez de desde una lista de casos — dos líneas son la misma apuesta cuando el primer
resultado alcanzable que las cruza es el mismo. Así "más de 22,5" y "más de 23,5" también caen juntas
(`total ≥ 24`) sin que nadie las haya escrito. Cada candidata lleva ya `equiv` y `equiv_dup`.

**Lo que NO se ha hecho:** agrupar de verdad. Vive detrás de `GP_TT_DEDUP_EQUIV`, apagado. Agrupar cambia qué
tesis nacen.

**Un aviso menor, con su número:** el objeto que se sirve a la pantalla lleva las distribuciones recortadas
(`trim(g1.total, 0,0005)`), y la cola del deuce son muchas casillas diminutas. Quien lea P(más de 20,5) del
objeto servido se queda **0,088 pp corto**, y la distribución de puntos del partido conserva el 99,79 % de la
masa. El precio no lo usa —`evaluateEdges` lee la distribución entera— pero una lectura de pantalla sí.

---

## Lo que este trabajo NO dice

**No dice que haya dinero en el total de puntos de tenis de mesa.** Mide quién describe mejor el total, y nada
más. La medición contra el precio ya está hecha y está en otro sitio: la vara del 15-sep da a
`tt · POINTS_TOTAL · cloudbet` un **EV medio de −6,58 % [−6,85; −6,34]** sobre 63 tickets en 50 racimos, con
el cierre sin mover el 61,9 % de las veces (el CLV no mide nada ahí) y `modeloContraPrecio` sin evidencia a
favor del modelo. Ganar esta comparación es condición **necesaria y no suficiente**, y con la vara puesta la
familia no es invertible hoy.

**No dice que TT0 deba cambiarse por TT1.** TT1 gana una comparación de densidad que no se cobra en ninguna
línea cotizada, y empeora la calibración al mejor de 7. Lo que hay que arreglar no es el modelo entero: son
dos cosas concretas y localizadas.

**No dice que α sea incertidumbre.** Los 43,95 puntos² de anchura que le faltan al compilador a todo el mundo
son mala especificación. Atribuirlos al rating habría sido cómodo —y habría dejado la puerta de ruido con el
número correcto por el motivo equivocado— pero los cuartiles de exposición lo desmienten.

**Y no dice nada sobre las competiciones que no modelamos.** Todo esto es WTT/ITTF de mayores. Las ligas
privadas de apuestas (Liga Pro, Setka Cup, TT Cup) siguen fuera del modelo y de la sombra, y nada de lo
medido aquí las cubre.

## Lo que queda abierto

1. **`pointScaleDist = 1,0` no tiene contracción y el error monótono en el favoritismo dice que debería
   tenerla.** No se toca sin preregistro: cambiarla cambia qué picks nacen en la única familia con dinero.
2. **α: de dónde salen los 43,95 puntos² que le faltan de anchura al compilador.** La sospecha razonable es
   la misma escala del punto 1, pero eso es una hipótesis, no una medición.
3. **La clase de pago está escrita y apagada.** Encenderla (`GP_TT_DEDUP_EQUIV`) es decisión de Alexis.
4. **El listón propio por familia está escrito y apagado.** Ídem (`GP_TT_UNC_FAMILIA`).
5. **TT2 necesita otra fuente.** Sin saber quién sirve cada punto, el saque/resto no se estima; ni por
   jugador, ni de población.
6. **El formato se dio por conocido.** En la validación se deduce del marcador final y por tanto es exacto;
   en producción sale de `formatFor(tier, round)`, que casi nunca está certificado. Todos los aspirantes
   comparten ese regalo, así que la comparación es limpia, pero el error absoluto de producción es mayor que
   el que aquí se mide.
