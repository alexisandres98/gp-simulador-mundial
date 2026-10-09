# ¿Hay arbitraje o cobertura entre Cloudbet y Polymarket? — medido el 8-oct-2026

**Pregunta de Alexis (8-oct):** «¿hay algún tipo de market making o arbitraje entre Cloudbet y Polymarket al que
le podamos sacar ventaja?» · **Script:** `scratchpad/arb/medir.js` (fuera del repo; reproducible con la clave de
Cloudbet y el libro `poly-mm-libro.json`) · **Datos:** libro vivo del CLOB de Polymarket y cuotas vivas de Cloudbet a
las 23:45 UTC del 8-oct, sobre los mismos partidos.

## Respuesta en una línea

**No.** En 66 mercados con precio en las dos casas (42 binarios de fútbol 1X2, 24 de tenis ML) no hay **ni un
solo** arbitraje taker, en ninguna de las dos direcciones, y el mejor caso pierde −1,9 %. Reposar una orden en
Polymarket que se pueda cubrir en Cloudbet con ganancia cerrada obliga a ponerla **1-4 céntimos por detrás del
mejor precio del libro**, donde solo se llena cuando el precio te atraviesa.

## Qué se midió

Para cada binario de Polymarket emparejado con un partido de Cloudbet (mismos equipos o apellidos, saque a menos
de 3 h de diferencia) y su complemento exacto en Cloudbet: el 1X2 para «gana X» y la **doble oportunidad** para
«no gana X» (`home_draw` / `draw_away` / `home_away`), el ganador para tenis.

| medida | fórmula |
|---|---|
| Arbitraje taker A | comprar el outcome en PM al mejor ask + comisión taker (tasa × p × (1−p)) + cubrir el complemento en Cloudbet a 1/cuota. Ganancia = 1 − coste |
| Arbitraje taker B | lo mismo en la otra dirección (comprar el complemento en PM a 1 − mejor bid, cubrir el outcome en Cloudbet) |
| Maker cubierto | el bid máximo en PM que, cubierto con el complemento en Cloudbet, deja ≥ 0: `1 − 1/cuota_complemento`. Distancia en céntimos al mejor bid vigente (y lo mismo del lado ask) |

## Resultado

| | fútbol (42) | tenis (24) |
|---|---|---|
| sobre-redondeo de Cloudbet, mediana | 5,91 % | 5,88 % |
| horquilla de Polymarket, mediana | 1 céntimo | 1 céntimo |
| PM (medio) − Cloudbet sin margen, mediana del valor absoluto | 0,36 pp (p90 1,07 · máx 2,11) | 0,81 pp (p90 1,50 · máx 2,16) |
| arbitraje taker, mejor caso | **−2,05 %** | **−1,90 %** |
| arbitraje taker, mediana | −3,20 % | −4,04 % |
| filas con arbitraje > 0 | 0 | 0 |
| maker cubierto: distancia al mejor precio (lado bueno), mediana | 1,3 c (p10 0,8 · mín 0,2) | 2,0 c (p10 1,0 · mín 0,3) |
| filas donde el mejor precio vigente ya cubre | 0 | 0 |
| cola en el mejor precio de PM, mediana | 413 shares | 3.235 shares |
| tope de Cloudbet por selección (`maxStake`), mediana | 208 USD | 343 USD |

Competiciones: Brasileirão, K-League, J-League, 2. Bundesliga, Eliteserien, Superligaen, Primeira Liga, Argentina,
Turquía, Rusia, China, Arabia; ATP Shanghái y WTA Pekín.

## Por qué sale así, y por qué no va a cambiar mañana

1. **Los dos precios son el mismo precio.** El medio de Polymarket y el precio sin margen de Cloudbet se separan
   0,4 pp en fútbol y 0,8 pp en tenis. Los dos miran el mismo consenso; Polymarket no es un mercado «ingenuo».
2. **Cloudbet cobra ~5,9 % de sobre-redondeo en el mercado principal** (ya medido en septiembre: 5,03-8,20 % en
   el 1X2). Para que exista arbitraje, Polymarket tendría que estar desviado más de ~3 pp del consenso en la
   dirección correcta. El máximo observado son 2,1-2,2 pp, y en el lado que no sirve.
3. **La cobertura maker tampoco:** cubrir en Cloudbet cuesta el margen de Cloudbet, así que la orden en Polymarket
   tiene que compensarlo entera. Eso la deja 1-4 céntimos detrás de un libro que ya está a 1 céntimo con cientos o
   miles de shares delante. Es exactamente la trampa que la regla `mm_ancho` enseñó el 7-oct.
4. **Y aunque apareciera:** el tope de cuenta de Cloudbet (≈6 % del `maxStake`, 10-20 USD por boleto, medido el
   27-sep) y el geobloqueo de Render para operar en Polymarket (sonda `poly_geo`) hacen que la pata de cobertura no
   se pueda poner a tamaño ni desde donde corre el sistema.

## Auditoría independiente (misma noche)

Catorce agentes intentaron refutar la medición: mapeo de la doble oportunidad al complemento correcto (con la
inversión de equipos), fórmula de la comisión taker (`tasa × p × (1−p)` por share, solo taker, igual que
`lib/comisiones.js`), cobertura de las dos direcciones (y de las ocho combinaciones a tres vías que el script no
prueba: mejor caso −2,57 %), emparejamientos sin falsos positivos y aritmética exacta en las 66 filas. **La
conclusión se sostiene.** Tres salvedades que no la cambian:

- Es **una sola foto** (23:45 UTC, saques entre 0,8 y 30 h después). Un cruce entre casas, si existiera, sería
  transitorio; para descartarlo en general habría que muestrear cada pocos minutos hasta el saque.
- En **6 de 66 filas el mejor nivel del CLOB es polvo** (≤ 20 shares): el "mejor caso" de tenis (−1,9 %) es
  Ugo Carabelli contra 20 shares y un `maxStake` de 34 USD en Cloudbet. En esas filas la distancia maker está medida
  contra un bid que no existe a tamaño; en el resto la cola es real (cientos o miles de shares).
- El script no usa el `maxStake` de Cloudbet ni el tope de cuenta: aunque hubiera cruce, la pata de cobertura no
  cabría a 2.000.

## Lo que SÍ queda abierto

- El market making en sombra sobre Polymarket **sin cubrir** (`mm_libro`, preregistro del 7-oct) es la única
  hipótesis estructural viva: cobra la horquilla de Polymarket y asume el inventario, en vez de pagar el margen de
  Cloudbet para no asumirlo. Lectura el 3-nov.
- Cloudbet no tiene exchange ni órdenes limitadas: no hay «market making en Cloudbet». Lo único que se puede hacer
  allí es cruzar al precio que publica.

Registro: `docs/DECISIONES_EJECUTADAS.md` (8-oct).
