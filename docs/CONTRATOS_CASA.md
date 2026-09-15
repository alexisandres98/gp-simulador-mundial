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

## Underdog — comisiones

**Pendiente.** Sin verificar el 15-sep-2026. Es un libro DFS con precio por pierna, así que lo que hay que
determinar no es una comisión sino **el payout real del ticket** y cómo se degrada al añadir piernas — que
es justamente lo que la auditoría pide en A18. Hasta entonces, las props de CS2 siguen en sombra propia.
