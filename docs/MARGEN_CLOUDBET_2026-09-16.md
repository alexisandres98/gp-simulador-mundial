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

---

## Precisión del 16-sep (noche): el HT/FT no cobra «un 21,93 %», cobra **uno de tres precios**

La tabla de arriba da la mediana de 48 partidos de seis ligas. Al preguntarse si esa cifra era creíble se
midió otra vez sobre **92 partidos de trece competiciones**, y el número no es un continuo alrededor de una
mediana: es una **escalera de tres peldaños**, y la liga decide en cuál cae el partido.

| peldaño | sobre-redondeo HT/FT | coste EV de una apuesta | competiciones observadas |
|---|---:|---:|---|
| **barato** | ~**9,0 %** | −8,2 % | Premier League · Bundesliga |
| **medio** | ~**22,0 %** | −18,0 % | LaLiga · Serie A · Ligue 1 · Championship · Eredivisie · Brasileirão · Liga Portugal |
| **caro** | ~**36,0 %** | −26,5 % | Liga Profesional (ARG) · Süper Lig · Pro League (BEL) · MLS |

Los peldaños son sorprendentemente exactos: dentro de cada uno la dispersión entre partidos es de
centésimas (8,95-9,03 · 21,93-22,06 · 35,97-36,08), lo que dice que **no es un precio por partido, es un
parámetro por competición**. La mediana global de 22,00 % es real, pero es la del peldaño donde caen más
ligas, no «lo que cobra el mercado».

El mismo corte en el 1X2 del partido no hace escalera: va de 5,03 % (Ligue 1) a 8,20 % (Süper Lig) de forma
continua, mediana 7,21 % sobre los 114 partidos. Es decir, **Cloudbet afina el mercado principal partido a
partido y tarifa los derivados por bloques.**

### Dos comprobaciones que descartan que sea un fallo de lectura

1. **No hay duplicación de salidas.** Los 92 partidos tienen exactamente 1 submercado y exactamente 9
   selecciones activas en HT/FT. Sumar todas las salidas y quedarse con una por resultado dan el mismo
   número.
2. **La propia casa publica su probabilidad.** Cada selección de Cloudbet lleva un campo `probability`
   además del `price`, y **esas probabilidades suman 1,0000** (rango observado 0,998-1,002 en los 92
   partidos), mientras la suma de `1/cuota` suma 1,09, 1,22 o 1,36. La distancia entre las dos sumas **es**
   el recargo, medido sin ninguna hipótesis nuestra de desmarginado. Coincide.

### La palabra correcta es sobre-redondeo, no comisión

Conviene fijarlo porque se ha dicho mal en conversación: **Cloudbet no cobra ninguna comisión.** No hay una
tarifa que se reste del ingreso ni del depósito. Lo que hay es que las cuotas de un mercado implican
probabilidades que suman más de 1, y ese exceso es el recargo. La diferencia práctica importa: una comisión
se paga siempre, el sobre-redondeo solo lo paga quien cruza ese mercado — y se evita entero **no entrando**.

Polymarket es el caso contrario y también se dijo mal: **sí cobra una comisión explícita**, pero es
pequeña. Su fórmula documentada es `comisión = acciones × tasa × p × (1 − p)`, solo al taker, con tasa
0,03-0,07 según categoría (los binarios de fútbol que usa la sombra devuelven 0,03 en su propio
`feeSchedule`). Su **máximo** está en p = 0,50 y con la tasa por defecto de 0,05 vale **1,25 % de lo
cruzado**; a p = 0,90 baja a 0,45 %. Es decir: la comisión de Polymarket es del orden de un punto, no de
veinte. Lo caro de Polymarket es la horquilla, no la tarifa (`docs/CONTRATOS_CASA.md § Polymarket`).

### Qué cambia de lo decidido: nada, y por qué

- **C3 (córners) sigue cerrado.** Se cerró con 3,95-4,50 % por lado en córners, medido con el mismo método
  y en mercados de dos caras, donde no hay escalera que valga.
- **C2 (HT/FT) sigue cerrado**, pero el motivo bueno es el otro: el precio ya lleva dentro la
  condicionalidad del descanso (`docs/HTFT_CIERRE_2026-09-16.md`). El recargo solo acaba de rematar.
- **La puerta barata sigue siendo la misma**: total de goles de 2ª parte, 2,71 % por lado.

Lo que sí hay que dejar de decir es «el HT/FT cobra 22 %» a secas. En Premier y Bundesliga cobra 9 %, y en
Argentina, Turquía, Bélgica y MLS cobra 36 %.
