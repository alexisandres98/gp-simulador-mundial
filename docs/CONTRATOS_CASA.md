# Contratos de las casas — lo que cobran y bajo qué reglas

> Nace el 15-sep-2026 por el hallazgo **A09** de la auditoría externa: *«Polymarket/propfirm — fees por
> mercado/fill»*. La sombra de Polymarket llevaba desde el 12-ago anotando el P&L sin descontar la comisión
> del taker, y por tanto todo lo que reportó está inflado por esa cantidad exacta.
>
> **Para qué sirve este documento.** Una comisión no es un detalle contable: es la parte del precio que la
> casa se queda pase lo que pase. Cuando una familia entera vive en el rango del 2-3 % de ventaja declarada
> —que es donde viven casi todas las nuestras—, equivocarse en la comisión cambia el signo del negocio, no
> su magnitud. Aquí se anota, casa por casa, **qué cobra, con qué fórmula, de dónde salió el dato, en qué
> fecha se comprobó y qué hay que hacer el día que cambie**. Una tarifa que no está aquí con su URL y su
> cita no se usa en ningún cálculo: se deja parametrizada y se dice que no está verificada.
>
> Regla de método, heredada de `lib/margen.js`: **no se supone un número que se puede medir, y no se
> inventa uno que no se puede.** Si la casa no publica la tarifa, el campo dice «no verificado» con fecha.

---

## Polymarket — comisiones

### Ficha

| | |
|---|---|
| **Fecha de consulta** | 15 de septiembre de 2026 |
| **Fuente 1 (documentación)** | <https://docs.polymarket.com/polymarket-learn/trading/fees> y <https://help.polymarket.com/en/articles/13364478-trading-fees> |
| **Fuente 2 (la propia API, primaria)** | `GET https://gamma-api.polymarket.com/markets?...` → campo `feeSchedule` de cada mercado |
| **¿Hay comisión de taker?** | **Sí.** No es cero en los mercados que usamos |
| **¿Comisión de maker?** | No. Los makers cobran rebate, no pagan |
| **¿Aplica por mercado o global?** | **Por mercado.** Cada mercado publica su propio `feeSchedule` |
| **Cuándo se paga** | Al cruzar (en el fill). El vencimiento no vuelve a cobrar |
| **Implementación** | `lib/comisiones.js`; se aplica en `propfirm/polyshadow.js` y `polymarket/ejecutor.js` |
| **Interruptores** | `GP_PM_FEE_RATE` (tasa) y `GP_PM_FEE_EXP` (exponente) |

### Cita textual de la documentación

> «fee = C × feeRate × p × (1 - p)»
>
> «Makers are never charged fees. Only takers pay fees.»
>
> «Fees are rounded to 5 decimal places. The smallest fee charged is 0.00001 USDC.»
>
> «Geopolitical and world events markets are fee-free.»

Donde `C` es el número de acciones cruzadas y `p` el precio de la acción (entre 0 y 1). La tabla de tasas
por categoría que publica la misma página, el 15-sep-2026:

| Categoría | Tasa de taker | Rebate de maker |
|---|---:|---:|
| Crypto | 0,07 | 20 % |
| Sports | 0,05 | 15 % |
| Economics · Culture · Weather · Other | 0,05 | 25 % |
| Finance · Politics · Tech · Mentions | 0,04 | 25 % |
| Geopolitics | 0 | — |

### Lo que dice la API el mismo día, que no es lo mismo

La documentación de desarrollo pide expresamente **no cablear la tasa** y leer el objeto `feeSchedule` del
propio mercado. Consultado el 15-sep-2026, los binarios de partido de fútbol que usa la sombra —los
`Will <equipo> win on <fecha>?`, que son exactamente la familia `futbol:No` que el ejecutor real iba a
encender— devuelven:

```json
{ "exponent": 1, "rate": 0.03, "takerOnly": true, "rebateRate": 0.25 }
```

Los mercados de partido de LoL devuelven lo mismo. Un barrido de 100 mercados abiertos cualesquiera, el
mismo día, reparte `rate` entre 0,05 (59), 0,07 (39) y 0,04 (2). **El `exponent` es 1 en todos los
observados**, que es lo que hace que la fórmula publicada y la de la API coincidan.

**Los dos números son de la misma casa el mismo día y no coinciden**: la tabla dice 0,05 para Sports y el
mercado concreto dice 0,03. No se resuelve eligiendo el que más gusta. Se resuelve así:

1. Cuando la señal trae la tasa del mercado (`fee_rate`, leída del `feeSchedule`), **manda esa**.
2. Cuando no la trae, manda el defecto, que es **0,05**: el peor de los dos valores creíbles. Para una
   puerta que decide si sale dinero, sobrestimar la comisión descarta alguna apuesta buena y subestimarla
   aprueba apuestas malas — y solo el segundo error cuesta dinero.

### La fórmula aplicada

```
comision_por_accion = tasa × (p × (1 − p)) ^ exponente        exponente = 1 hoy
comision_del_fill   = acciones × comision_por_accion          redondeo a 5 decimales, mínimo 0,00001 USDC
EV_neto_por_accion  = prob_modelo − p − comision_por_accion
```

Comprobación contra el ejemplo de la propia documentación: 100 acciones a 0,50 con tasa 0,05 → **1,25
USDC**, que es lo que `lib/comisiones.js` devuelve.

Tres consecuencias que cambian decisiones, no solo cifras:

- **La comisión es máxima justo donde más operamos.** `p(1−p)` tiene su máximo en 0,50. Como fracción del
  nocional, la comisión es `tasa × (1 − p)`: a 0,42 de precio medio son 2,1 % con tasa 0,05. Ese es el orden
  de magnitud del ROI de la mitad del tablero.
- **Se paga sobre el nocional, no sobre el beneficio.** Se paga igual en las que se ganan y en las que se
  pierden.
- **Solo la paga el que cruza** (`takerOnly: true`). Nuestra sombra cruza siempre por construcción —camina
  los asks del libro— y el ejecutor coloca al límite del consenso menos un céntimo, que también cruza. El
  día que se coloque para reposar en el libro, esto deja de aplicar y hay que medirlo aparte, no asumirlo.

### Qué pasa si la documentación cambia

La tasa **no está cableada en ningún cálculo**. Hay tres niveles y se usan en este orden:

1. **La tasa del mercado**, si la señal la trae (`fee_rate` / `fee_exp`, del `feeSchedule` de gamma).
2. **`GP_PM_FEE_RATE` y `GP_PM_FEE_EXP`**, variables de entorno. Cambiar la tarifa en producción es cambiar
   un número y desplegar; no toca código.
3. **El defecto de `lib/comisiones.js`** (0,05 y exponente 1), que es lo que se documenta arriba.

Además, **cada posición guarda la tasa con la que se le aplicó la comisión** (`tasa_comision`). Eso es lo
que impide que un cambio de tarifa reescriba el pasado: un recálculo futuro usa la tarifa que de verdad se
pagó, no la de mañana.

Cuando cambie la tarifa hay que hacer estas tres cosas, en este orden:

1. Actualizar esta ficha: fecha de consulta, cita nueva, y **dejar la anterior tachada con su fecha**, no
   borrarla — el track histórico se liquidó con la vieja.
2. Cambiar `GP_PM_FEE_RATE` en Render y desplegar.
3. Correr `node scripts/poly-comision-recalc.js --ledger` y publicar el antes y el después en
   `docs/METRICAS_RECALCULADAS_2026-09.md`, como se hizo el 15-sep.

Y si algún día la API deja de publicar `feeSchedule` o la documentación desaparece: **no se inventa la
tarifa**. Se deja el último valor verificado con su fecha, se marca aquí como «no verificado desde …», y se
dice en el reporte. Un número sin fuente es peor que un hueco, porque el hueco se ve.

---

## Cloudbet — comisiones

**Pendiente.** Sin verificar el 15-sep-2026. Lo que sí está medido es su **margen** (3,13 % por lado en
`cs2 · RONDAS_HANDICAP`, emparejando las dos caras del mismo mercado en el archivo de cierres, `lib/margen.js`),
que es una cosa distinta: el margen es lo que la casa mete en el precio, la comisión es lo que cobra aparte.
Hace falta comprobar si además cobra comisión de retirada, de cambio de divisa o por operación.

## Pinnacle — comisiones

**Pendiente.** Sin verificar el 15-sep-2026. Margen medido: 2,21 % por lado en `RONDAS_HANDICAP`.

## Underdog — el producto, no la comisión (A18 · T2.9)

### Ficha

| campo | valor |
|---|---|
| Consultado | **15-sep-2026**, 14:55–15:10 UTC |
| Qué se buscaba | tipo de entrada, multiplicadores por número de piernas, reglas de anulación, si admite piernas correlacionadas, y cómo se paga |
| Fuente primaria intentada | `https://underdogfantasy.com/rules` → 301 → `https://www.underdogsports.com/rules` → 301 → `https://app.underdogsports.com/rules` → **403** · `https://help.underdogsports.com/en/articles/13780101-…` → **403** · `https://help.underdogsports.com/en/articles/8974260-…` → **403** |
| API del producto | `https://api.underdogfantasy.com/beta/v5/over_under_lines` → **426 `upgrade_required`** («A new version is required to continue»). Probado también `beta/v3`, `beta/v4`, `beta/v6` (426) y `v6` (404), con y sin cabeceras de versión de cliente |
| Estado del veredicto | **NO VERIFICADO CONTRA LA FUENTE PRIMARIA.** Lo de abajo son fuentes secundarias y no se puede usar para decidir dinero |

> **Esto es lo primero que hay que leer de esta ficha.** El sitio de Underdog devuelve 403 a este entorno y
> su API devuelve 426. No hay cita textual del reglamento de la casa porque no se pudo obtener, y **no se
> inventa**. Lo que sigue son fuentes de terceros, señaladas una a una, y **se contradicen en el número que
> decide el signo del EV**.

### El hallazgo de fondo: el feed de props lleva caído

`data-providers/esports/underdog.js` pega contra `beta/v5/over_under_lines`. Ese endpoint responde hoy
**426 `upgrade_required`**. Comprobado en producción el mismo día: `/api/internal/esports?props=1` devuelve
`board: { available: false, n: 0 }` y la sombra tiene **0 tesis activas**. Las 472 liquidadas
(330 de `props_cs2_v2`) son historia; no está naciendo ninguna props nueva y no se estaba diciendo en
ningún sitio.

### Lo que dicen las fuentes secundarias

**Tipo de entrada.** Pick'em de más/menos por jugador (no hay líneas de ganador, hándicap ni total de
equipo). Dos modos:

- **Standard** — todo o nada. Mínimo 2 piernas.
- **Flex** — mínimo 3 piernas; paga también fallando una (y fallando dos a partir de 6 piernas), con
  multiplicador menor.

Máximo 8 piernas por entrada.

**Multiplicadores. Aquí está el problema, y es el que decide todo.** Las dos familias de fuentes no
coinciden:

| piernas | tabla A (gamedaymath, «Standard») | tabla B (oddsassist / stokastic, 2026) |
|---:|---:|---:|
| 2 | **3×** (+200) | **3,5×** |
| 3 | 6× (+500) | 6× |
| 4 | 10× (+900) | 10× |
| 5 | 20× (+1900) | 20× |
| 6 | — | 35× |
| 8 | — | 120× |

Flex (tabla B): todas acertadas de 3× (3 piernas) a 80× (8 piernas); con un fallo, de 1× a 3×; con dos
fallos, solo de 6 a 8 piernas, de 0,25× a 1×. La reversión por anulación, citada por la fuente:

> *«Entries with a Tie/Void revert down to the next closest entry: 8-pick Flex Entry (80x) → 7-pick Flex
> Entry (40x), 7-pick Flex Entry (40x) → 6-pick Flex Entry (25x), 6-pick Flex Entry (25x) → 5-pick Flex
> Entry (10x), 5-pick Flex Entry (10x) → 4-pick Flex Entry (6x).»*

**Anulaciones.** Una pierna anulada no devuelve la entrada: la **degrada** al número de piernas inmediato
inferior con su multiplicador. Y hay una regla que sí importa para nosotros:

> *«Entries that are reverted down to include only players on one team or just a single player will be void
> and refunded.»*

O sea: **una entrada que se quede con jugadores de un solo equipo se anula y se devuelve.** Eso mata de
raíz la idea de montar un ticket con varias piernas del mismo cinco, que es exactamente lo que la
proyección de GP tiende a producir cuando un equipo tiene el ataque medido por encima.

**Correlación.** No se encontró regla que prohíba combinar piernas del mismo partido — al contrario, la
propia casa describe el producto como elegir varias props del mismo encuentro. Lo que sí hay es el límite
de arriba (un solo equipo ⇒ anulada) y, en esports:

> *«A player must play in all games/maps stated in their projection to be considered active.»*
> *«if an individual map or partial series is played for individual map projections or partial series
> projections, the picks will grade regardless of if later maps in that series are suspended or delayed.»*

**El `american_price` de la API no es un precio al que se pueda apostar suelto.** La entrada mínima son
2 piernas. Nuestro `props.js` calcula el listón como `1/price_dec` con el `american_price` de la pierna
(−112 ⇒ listón 52,83 %), y eso solo sería el listón correcto si existiera la pierna suelta a ese precio.
No existe.

### Por qué esto cambia el signo, con números

Listón por pierna de una entrada Standard de N piernas con multiplicador M, piernas independientes y con la
misma probabilidad: `p* = (1/M)^(1/N)`.

| piernas | M (tabla A) | listón por pierna | M (tabla B) | listón por pierna |
|---:|---:|---:|---:|---:|
| 2 | 3× | **57,74 %** | 3,5× | **53,45 %** |
| 3 | 6× | **55,03 %** | 6× | 55,03 % |
| 4 | 10× | **56,23 %** | 10× | 56,23 % |
| 5 | 20× | **54,93 %** | 20× | 54,93 % |

Contra el 52,83 % del `american_price`, el listón real está entre **2,1 y 4,9 puntos más arriba**. Y con la
tasa de acierto que la sombra lleva midiendo —`props_cs2_v2`: 178 de 330, **53,94 %**— el veredicto cambia
de fuente a fuente:

| ticket | EV con acierto 53,94 % |
|---|---:|
| 2 piernas a 3× (tabla A) | `3 × 0,5394² − 1` = **−12,71 %** |
| 2 piernas a 3,5× (tabla B) | `3,5 × 0,5394² − 1` = **+1,83 %** |
| 3 piernas a 6× | `6 × 0,5394³ − 1` = **−5,84 %** |
| 4 piernas a 10× | `10 × 0,5394⁴ − 1` = **−15,35 %** |
| 5 piernas a 20× | `20 × 0,5394⁵ − 1` = **−8,68 %** |

Con la tabla A **ningún** ticket tiene esperanza positiva. Con la tabla B la tiene uno solo, el de dos
piernas, y por 1,8 puntos — dentro del error de una muestra de 330 (`lib/inferencia.js`: el IC del ROI de
330 a cuota equivalente 1,893 va de −8,01 % a +12,35 %, veinte puntos de ancho). La auditoría externa usó la tabla A y llegó
al mismo sitio: −12,844 % con p = 0,539.

**Conclusión operativa:** el `+2,2 %` por pierna que publica la sombra de props **no es el retorno de nada
comprable**. Hasta que alguien con cuenta en Underdog copie el reglamento y un comprobante de pago, la
familia no puede pasar de sombra, y su EV declarado es «no medible», no «positivo».

### Qué falta para cerrar esta ficha

1. La tabla de multiplicadores **de la propia casa**, con fecha y captura (el 403 se salta desde una IP
   residencial o desde la cuenta).
2. Un **comprobante de pago** real: entrada, piernas, multiplicador aplicado y liquidación.
3. La regla de anulación en esports **por escrito de la casa**, en particular qué pasa cuando la serie no
   llega al mapa 2 y la proyección era «mapas 1-2».
4. Si la casa limita la apuesta por pierna o por entrada, que es lo que decide si la familia tiene capacidad.

### Fuentes secundarias consultadas el 15-sep-2026

- `gamedaymath.com/blog/underdog-fantasy-payout-math` — tabla A (2 piernas 3×) y los listones.
- `oddsassist.com/dfs/how-underdog-works/` — tabla B (2 piernas 3,5×, 6 piernas 35×, 8 piernas 120×),
  mínimos y máximo de 8 piernas.
- `stokastic.com/articles/dfs-strategy/how-underdog-fantasy-multipliers-work` — Standard vs Flex y la regla
  de los Scorchers («If a Scorcher is voided or tied, it counts as a loss»).
- Extractos del centro de ayuda de Underdog servidos por el buscador (`help.underdogsports.com`, artículos
  13780101, 8974260, 13161362 y 10905524), inaccesibles por fetch directo (403).
