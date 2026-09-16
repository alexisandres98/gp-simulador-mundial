# Lo que cobra Cloudbet en cada mercado de fútbol — 16-sep-2026 (A4)

**Qué se preguntaba.** El plan de rentabilidad manda cerrar C3 (córners v2) si Cloudbet cobra **≥ 4 % por
lado** en córners, y decidir con el mismo número si la familia condicional de HT/FT y segunda parte merece
ingeniería de modelo. Hasta hoy nadie había medido ninguno de los dos.

**Cómo.** `scripts/cloudbet-margen-futbol.js`, sobre **48 partidos** del libro en vivo de Cloudbet
(Premier, Serie A, Bundesliga, LaLiga, MLS, Ligue 1), emparejando las dos caras del mismo mercado **del
mismo partido** con `lib/margen.js`. Reproducible: `node scripts/cloudbet-margen-futbol.js`.

---

## La tabla

| familia | salidas | sobre-redondeo | por lado | coste EV | línea equilibrada, por lado |
|---|---:|---:|---:|---:|---:|
| TOTAL_GOLES_2T | 2 | 5,41 % | 2,71 % | 5,13 % | 3,41 % |
| HANDICAP_ASIATICO *(control)* | 2 | 5,75 % | 2,88 % | 5,44 % | 2,56 % |
| 1X2 *(control)* | 3 | 5,99 % | — | 5,65 % | — |
| **TOTAL_GOLES** *(control)* | 2 | **6,18 %** | **3,09 %** | 5,82 % | 2,56 % |
| AMBOS_MARCAN | 2 | 6,23 % | 3,11 % | 5,86 % | 3,11 % |
| TOTAL_GOLES_1T | 2 | 7,14 % | 3,57 % | 6,66 % | 3,25 % |
| TOTAL_TARJETAS | 2 | 7,64 % | 3,82 % | 7,10 % | 3,01 % |
| **TOTAL_CORNERS** | 2 | **7,91 %** | **3,95 %** | 7,33 % | 3,11 % |
| TOTAL_PUNTOS_TARJETA | 2 | 8,01 % | 4,00 % | 7,42 % | 4,22 % |
| **HANDICAP_CORNERS** | 2 | **8,78 %** | **4,39 %** | 8,07 % | 3,73 % |
| **TOTAL_CORNERS_1T** | 2 | **8,99 %** | **4,50 %** | 8,25 % | 4,03 % |
| 1X2_2T | 3 | 10,89 % | — | 9,82 % | — |
| **HT/FT** | 9 | **21,93 %** | — | **17,99 %** | — |
| MARCADOR_EXACTO | 27 | 28,91 % | — | 22,43 % | — |

*por lado* = sobre-redondeo ÷ 2, que es la convención con la que están medidos Pinnacle y Bovada.
*coste EV* = lo que de verdad cuesta cruzar el mercado en esperanza, `R/(1+R)`.
*línea equilibrada* = solo la línea de cada partido cuyas dos caras están más cerca de 50/50, que es por
donde se entra de verdad al mercado.

---

## Las tres respuestas

**1. Córners: C3 se cierra.** El total de córners cobra **3,95 % por lado** y las otras dos puertas de
entrada a la familia —hándicap de córners 4,39 %, córners de primera parte 4,50 %— pasan el listón de 4 %
holgadamente. La única lectura que queda por debajo es la línea equilibrada del total (3,11 %), y aun ésa
está en el mismo orden que el control. Puesto junto a lo que ya sabíamos —que los córners de local y
visitante van correlacionados **−0,249** y sobredispersos (var/media 1,18), así que dos Poisson
independientes no valen y haría falta un bivariante propio— la cuenta es: construir ese modelo para
después regalar ~4 puntos por apuesta. **C3 cerrado.** El motivo no es que no se pueda modelar: es que el
peaje se come cualquier ventaja que el modelo pudiera sacar.

**2. HT/FT: cerrado, y no por poco.** **21,93 % de sobre-redondeo repartido entre nueve salidas**, con un
coste real de **17,99 %** por cruzarlo. Para ganar dinero ahí hay que acertar casi dieciocho puntos por
encima del precio, en el mercado donde peor calibrado está el modelo. No hay ninguna versión de esto que
salga. Y conviene decirlo entero: el marcador exacto, que el censo del 13-sep SÍ abrió en sombra, cobra
**28,91 %** — es el mercado más caro del libro y está publicándose.

**3. Segunda parte: es la excepción, y es la barata.** `TOTAL_GOLES_2T` cobra **2,71 % por lado**, el más
barato de los catorce medidos — por debajo del total de goles completo (3,09 %) y del hándicap asiático
(2,88 %). Es decir, de las cuatro candidatas a dinero del plan, la única cuya puerta de entrada no está
cerrada por peaje es el **total de goles de segunda parte**, no el HT/FT con el que viajaba emparejada.
La familia condicional de C2 debe apuntar ahí. Ojo con la otra cara: `1X2_2T` cobra 10,89 %, así que
«segunda parte» barato significa **el total**, no el ganador.

---

## El hallazgo que no se buscaba: los márgenes de la doctrina estaban mal

Al comparar el control con lo que dice `CLAUDE.md` —«total de goles de fútbol **0,69 %**, el más barato =
el más eficiente = el peor sitio para buscar ventaja»— la diferencia era de más de cuatro veces contra los
**3,09 %** medidos aquí partido a partido. La causa está en `lib/margen.js`: `claveMercado` indexaba por
casa + familia + mapa + línea, **sin nada que distinguiera un partido de otro**. Todas las filas de todos
los partidos con la misma línea caían en el mismo cubo y, como de cada cara se queda la de mejor cuota, se
emparejaba el *over* de un partido con el *under* de otro. Eso no es el margen de un mercado: es un
arbitraje imaginario entre partidos distintos.

La prueba más limpia estaba a la vista en la sonda: **`cs2 · bovada · KILLS` informaba un margen de
exactamente 0 %** sobre 46 «mercados». Ninguna casa cobra cero. Y los tamaños de muestra lo confirmaban:
`cs2 · pinnacle · RONDAS_HANDICAP`, la cifra de 2,21 % que está escrita en la doctrina, salía de **cuatro**
mercados.

Qué implica. El margen **se resta** del CLV para decidir si una familia es invertible, así que un margen
demasiado bajo hace que **todas** las familias parezcan mejores de lo que son. La dirección del error es la
peligrosa. No cambia el veredicto vigente —hoy no hay ninguna familia invertible y esto solo lo refuerza—
pero sí invalida los cuatro números de márgenes que estaban en `CLAUDE.md` y obliga a volver a medirlos.

Corregido en `lib/margen.js` (el partido entra en la clave, y una fila sin partido ya **no se empareja**:
se cuenta aparte en `_filas.sin_evento`), en el aplanado de `server.js` que tiraba la clave del archivo de
cierres, y fijado en `tests/margen.test.js` con el arbitraje imaginario reconstruido.
