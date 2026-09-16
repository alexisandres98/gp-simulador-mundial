# ¿El precio ya lleva la condicionalidad del descanso? — 16-sep-2026 (C-2)

**Qué se preguntaba.** A22 midió sobre 27.816 partidos que las dos mitades **no** son independientes: el
equipo que va perdiendo al descanso marca **+0,117 goles más** de lo previsto y el que va ganando **−0,060
menos**. El rango, 0,177 goles, es el **24 % de la λ de media parte**. Era la única estructura del sistema
con número detrás que el mercado *podría* no estar pagando, y por eso C2 era el candidato principal.

C-2 pide contestar si Cloudbet ya la cotiza. Si la cotiza, no hay ventaja y C2 se cierra sin escribir una
línea de modelo.

**Cómo.** `scripts/htft-cierre.js`, sobre **41 partidos** del libro de Cloudbet (Premier, Serie A,
Bundesliga, LaLiga, MLS, Ligue 1; 7 más descartados por no publicar HT/FT). Sin necesitar ni un resultado:
**se le pregunta al precio contra sí mismo.**

---

## El método, y el error que hubo que corregir por el camino

La idea es comparar la conjunta HT/FT que la casa cotiza contra la que saldría si las dos mitades fueran
independientes. La primera versión construía esa referencia con el **1X2 de primera parte**, otro mercado
de la misma casa. Al comprobarlo, resultó que **la casa no cuadra consigo misma**: la marginal del descanso
que sale de su HT/FT se separa de su propio 1X2 de 1ª parte una **mediana de 0,92 pp, y hasta 5,28**. El
efecto que se quería medir vale entre 0,17 y 1,55 pp por celda — o sea, **del mismo tamaño que la
incoherencia**. Así no se puede distinguir «la casa cotiza las mitades como dependientes» de «la casa tiene
dos mercados que no se hablan», y un número que no distingue esas dos cosas no decide nada.

**Arreglo:** la marginal del descanso se toma de la **propia conjunta HT/FT**. Cuadra por construcción, y
lo único que queda por explicar es la forma de las tres condicionales, que es justo la pregunta. Todo sale
de un solo mercado.

---

## El resultado: el precio lleva la condicionalidad, y no por poco

Se ajusta la segunda parte de dos maneras y se compara el residuo medio por celda:

| ajuste | residuo por celda | IC |
|---|---:|---|
| **mitades independientes** | **0,697 pp** | [0,644 · 0,748] |
| **mitades condicionadas** | **0,060 pp** | [0,055 · 0,066] |
| lo que gana permitir la dependencia | **0,637 pp** | [0,583 · 0,689] |

Independencia deja un residuo **once veces mayor**. Con los dos multiplicadores, el ajuste baja a 0,06 pp
por celda — que es el orden del redondeo de las propias cuotas. **La conjunta que cotiza Cloudbet no se
puede explicar con mitades independientes y sí se explica casi exactamente con mitades condicionadas.**

Las nueve celdas se desvían de la referencia independiente pasando Benjamini-Hochberg, y en la dirección
que A22 midió: las remontadas pesan **+2,06 pp** de más y los «se mantiene» **−2,56 pp** de menos.

---

## Y el tamaño, que es lo que decide

Convertido a la misma unidad en que A22 midió el efecto —goles de media parte:

| | A22 (27.816 partidos, resultados) | el precio (41 partidos) | IC del precio | fracción pagada |
|---|---:|---:|---|---:|
| va por detrás | **+0,117** | **+0,0895** | [+0,081 · +0,098] | **76,5 %** |
| va por delante | **−0,060** | **−0,1029** | [−0,123 · −0,082] | **171 %** |

Multiplicadores medios implícitos: **×1,117** al que va por detrás y **×0,861** al que va por delante.

La casa paga el efecto, pero lo reparte distinto: **infravalora la aceleración del que pierde en un 23 % y
sobrevalora la frenada del que gana en un 71 %**. En conjunto cotiza **más** cierre de brecha que el que
A22 encontró (0,192 frente a 0,177 de diferencial total).

---

## Veredicto: **C2 se cierra**

La premisa del candidato —«Cloudbet cotiza el HT/FT desde mitades independientes, así que la ventaja es
real y grande»— **es falsa**. El precio lleva la estructura dentro.

Queda una discrepancia en el reparto, y conviene decir hacia dónde apunta para que nadie la lea al revés:
como el mercado cotiza **más** mean-reversion que la que A22 midió, el lado con ventaja teórica sería
**apostar a que el que va ganando mantiene**, no a la remontada — lo contrario de lo que sugeriría leer A22
sin esta medición. Pero es una diferencia del 8 % sobre un efecto pequeño, con 41 partidos de precios y un
modelo de dos parámetros. **No es base para dinero.**

---

## Lo que esta medición no dice, dicho aquí

1. **41 partidos, un solo día, seis ligas, y precios prepartido — no cierres.** La dirección del resultado
   es inequívoca (0,70 pp contra 0,06 pp no lo mueve la muestra), pero los números de la tabla de goles sí
   se moverían con más partidos.
2. **El modelo condicional tiene dos parámetros libres y ajusta casi perfecto.** «Ajusta bien» no prueba
   que el mecanismo sea el estado al descanso: cualquier familia de dos parámetros que redistribuya masa
   hacia el cierre de brecha ajustaría parecido. Lo que sí queda probado es que **mitades independientes no
   sirven**.
3. **A22 mide resultados; esto mide creencias.** Son comparables en unidades, no son el mismo objeto.
4. **La incoherencia entre mercados de la misma casa sigue ahí** —0,92 pp de mediana entre su HT/FT y su
   1X2 de 1ª parte, hasta 5,28— y es un hallazgo aparte. Es una discrepancia **precio contra precio dentro
   de la misma casa**, que es justo la familia que la doctrina dice que funciona (lo que gana, gana por
   precio y momento). No se explora aquí, pero queda anotada como pista con su medida.
