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

---

## ACTUALIZACIÓN DEL 16-SEP (A3) — la API sí responde, por otra puerta

El 15-sep se probaron `beta/v3`, `v4`, `v5`, `v6` y `v6`, todas 426 o 404, y se dio la API por cerrada.
**Faltaba probar `v1`, sin el prefijo `beta`.** Responde:

| ruta | respuesta |
|---|---|
| `api.underdogfantasy.com/beta/v4/over_under_lines` | 426 `upgrade_required` |
| `api.underdogfantasy.com/beta/v5/over_under_lines` | 426 `upgrade_required` |
| `api.underdogfantasy.com/beta/v6/over_under_lines` | 426 `upgrade_required` |
| **`api.underdogfantasy.com/v1/over_under_lines`** | **200 · 27,5 MB · 10.075 líneas** |

No es que la versión se quedara atrás: la familia `beta/*` entera está cerrada al cliente viejo y la buena
es `v1`. Y ahí siguen los tres juegos que nos importan — **CS 24 partidos, LOL 4, VAL 9**. La forma del
JSON es la MISMA (`over_under.appearance_stat.appearance_id`, `players[].sport_id`, `options[].american_price`),
así que `propLines()` la digiere sin tocar nada: corrido contra el payload real devuelve **656 filas**
(cs2 448, lol 119, valorant 89). El arreglo es cambiar la URL, y ya está hecho.

### Lo que el payload dice del contrato, que es más de lo que se creía

Cada opción trae **`payout_multiplier`** además del precio. Su relación con el precio no es libre:

- de 15.445 opciones con las dos cosas, la mediana de `decimal_price / payout_multiplier` es **1,910**
  (p10 1,74 · p90 2,01);
- las 5.922 opciones con `payout_multiplier` exactamente **1,0** tienen precio mediano **1,90** (la moda es
  1,90 con 2.541 casos).

Es decir: **el multiplicador por pierna ES el precio de esa pierna normalizado a una pierna estándar de
−110 (1,909)**. De ahí se sigue la forma del contrato, aunque no su constante:

> multiplicador del boleto = **Base(N) × Π mᵢ**

donde `mᵢ` es el multiplicador publicado de cada pierna y `Base(N)` es la tabla plana por número de
piernas. Lo que falta verificar **ya no es todo el precio: es UNA constante por número de piernas.**

### Y esa constante sigue sin poderse verificar

| intento | resultado |
|---|---|
| `help.underdogsports.com/hc/en-us` | **403** (Cloudflare) |
| `help.underdogsports.com/api/v2/help_center/en-us/articles/search.json` (API de Zendesk) | **403** |
| `underdogfantasy.com/help/articles/13780101` → `www.underdogsports.com/help/articles/13780101` | **404** |
| `www.underdogsports.com/games/pickem` | 200, pero **solo copia de marketing** («win up to 500x your money»); ninguna tabla |
| `www.underdogsports.com/sitemap.xml` | 200; no hay ninguna página de pagos ni de reglamento de pick'em |
| `v1/payout_structures`, `v1/pickem_payouts`, `v1/entry_slips/payouts`, `v2/pickem/payout_structures`, `v1/pickem_settings` | **404** |
| `v1/lobby` | 200, pero es de drafts: ni `payout` ni `multiplier` en todo el documento |

La tabla plana solo se ve desde dentro de una cuenta. **Sin cuenta no hay fuente primaria.**

### Veredicto A3

Se aplica la regla escrita en el plan: *«si no se puede verificar en una tarde, C5 se retira»*.
**C5 (props de Underdog) queda RETIRADA** como candidata a dinero — con `Base(2)` sin verificar, el EV del
boleto va de **−12,71 %** (tabla A, 3×) a **+1,83 %** (tabla B, 3,5×), y esa horquilla contiene el cero.
Meter dinero a ciegas ahí sería exactamente lo que la regla del 13-sep prohíbe.

Lo que **sí** se hace, porque es corrección y no ingeniería de modelo: se arregla la URL para que la sombra
vuelva a tener señal en vez de un `available: false` que nadie mira. La familia sigue en sombra, sin dinero
y sin trabajo de modelo.

**Qué cerraría A3 en diez minutos:** una cuenta de Underdog, entrar dos piernas al precio estándar
(−110/−110, `payout_multiplier` 1,0 las dos) y leer el pago potencial. Si dice 3,61× el boleto es el
producto de los precios; si dice 3,00× o 3,50×, es tabla plana y sabemos cuál. **Es lo único que falta y
solo puede hacerlo Alexis.**

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

---

# A5 · LOS TRES REGLAMENTOS — 16-sep-2026

**Qué se pedía.** Leer los reglamentos de Cloudbet, Pinnacle y Bovada y cerrar `contrato_documentado` en
las nueve familias que lo tenían en `null`.

**Resultado en una línea: uno de los tres se obtuvo entero, dos están fuera de alcance de este entorno.**

| casa | intento | resultado |
|---|---|---|
| **Cloudbet** | `www.cloudbet.com/en/help/sports-betting-rules` | **200 — reglamento completo, 2.177 líneas, 60+ deportes.** Es la fuente de todo lo que sigue |
| Pinnacle | `help.pinnacle.com/hc/en-us` | **bloqueado por la política de egreso** del entorno (`connect_rejected`) |
| Pinnacle | `www.pinnacle.com/{en,es}/rules`, `/betting-resources/rules/esports` | 404 |
| Bovada | `help.bovada.lv/hc/en-us` | **bloqueado por la política de egreso** (`connect_rejected`) |
| Bovada | `www.bovada.lv/rules`, `/help/sports-betting[-rules]` | 404 |

Esto importa para el veredicto y no es un detalle: **casi ninguna familia opera en una sola casa.** Medido
sobre los cierres del 16-sep, cs2, lol, valorant, dota2 y dardos operan en **pinnacle + bovada + cloudbet**
(dardos además polymarket) y tt en **cloudbet + bovada**. Un contrato está documentado cuando lo está para
TODAS las casas en las que la familia cruza, así que resolver Cloudbet no basta para poner un `true` en
ninguna de ellas — pero sí convierte «no sabemos nada» en «falta esto y sabemos exactamente qué».

---

## Lo que Cloudbet contesta, con su texto

### Esports — la prórroga CUENTA

> «Any overtime or other tiebreaker method used is considered valid in determining results.»

Contesta la pregunta pendiente de `esports:cs2` y `esports:valorant`. **Y abre una del lado del modelo:**
si el mercado de rondas incluye la prórroga, un total de rondas tiene una cola derecha más gorda que la que
sale de simular solo el tiempo reglamentario. Anotado como pendiente de modelo, no de contrato.

### Esports — otras cuatro reglas que nos afectan

> «If a Map is void due to retirement, default, disconnection, disqualification, walkover, or other admin
> decision, all bets on the **Match** are void. Bets on any individual Maps that are played to completion
> will have action.»

Un mapa anulado tumba **el partido entero**, no solo ese mapa. Nuestro liquidador de series ya exige serie
terminada desde el 16-sep, lo cual va en la misma dirección, pero la regla es más amplia.

> «Match-period Handicap, Money Line and Over/Under markets use **Maps won** as scoring units.»
> «Total Maps Markets: **Tied Maps are not counted** towards Total Maps markets.»
> «If a Match isn't started **30 hours** after its scheduled starting time all bets on that Match are void.»

### Esports — CS:GO, y aquí el reglamento se quedó atrás

> «Rounds **1-15** constitute the first half of CS:GO Maps.»
> «Rounds 1-12 constitute the first half of Valorant Maps.»

Valorant cuadra. **CS:GO no: la regla es de MR15 y CS2 se juega a MR12**, así que la primera mitad son las
rondas 1-12. Cloudbet no ha actualizado esa línea al juego actual. Cualquier mercado de primera mitad de CS2
queda **ambiguo por el propio reglamento** y no se puede declarar documentado.

### Esports — kills

**LoL:** su sub-apartado no define kill, así que manda la regla general —
> «"Kill" markets will be resulted using the Match summary.»
— y en LoL el match summary cuenta kills de campeón, que es lo que modelamos. **Cuadra.**

**Dota 2: definido, y la definición se contradice con sus propios precios.** Texto literal:

> «The following will be counted as a kill in Dota 2: Player kills · **Tower kills of the opposing team** ·
> **Creep kills of the opposing team**. The following will not be counted as a kill in Dota 2: A teammate
> deny · Suicide · Death from neutral creeps · Death from the Roshan.»

Leído al pie de la letra, los creeps de línea contarían y los totales de kills irían en **centenares**.
Cloudbet publica líneas de ~45-55. Las dos lecturas difieren en un orden de magnitud, así que **la
ambigüedad misma bloquea el contrato** de `dota2 KILLS`: no es que no lo hayamos leído, es que lo hemos
leído y dice dos cosas.

### Tenis — la regla que teníamos mal

Éste era el `contrato_pendiente` escrito palabra por palabra («el ganador se paga y el hándicap se devuelve;
nuestro liquidador aplica la misma regla a las tres»). **Confirmado contra la fuente primaria:**

> «One full set must be completed for money line / winner wagers to stand. If less than 1 set is completed,
> all money line wagers will be void. The winner of the match is the participant declared the victor by the
> umpire of the match.»
>
> «If a tennis match is not completed because of a player retirement or disqualification, all Handicap and
> Total Games wagers will be void, **regardless of the score of the match**.»

Nuestro liquidador anulaba las tres. **Arreglado** en `tennis-engine/store.js`: el ganador se anula solo si
la retirada llegó antes de completar un set, y el hándicap y el total se anulan siempre. Fijado en
`tests/tenis-retiro.test.js`.

Cuánto pesaba: **3 picks de ML** anuladas por retiro sobre 199 liquidadas (1,5 %). Poco, pero el sesgo no es
neutro — el que se retira suele ir perdiendo, así que lo que se borraba del track eran sobre todo aciertos
sobre el favorito — y crece con la muestra. Las tres filas históricas se dejan como están; las nuevas llevan
`contrato: 'cloudbet_2026-09-16'` para poder separar las dos cohortes.

### Tenis de mesa — la regla es uniforme, pero tiene una palabra que importa

> «If a player retires all **undecided** markets are considered void.»
> «In the case of a match not being finished all **undecided** markets are considered void.»

Uniforme entre familias, sí, pero **«undecided»**: un mercado ya determinado se paga. En nuestro
`POINTS_TOTAL` eso significa que si el total ya pasó la línea, el *over* está decidido y **se paga** aunque
haya retirada; el *under* se anula. Es asimétrico y nuestro liquidador no lo tiene escrito. Pendiente.

### Dardos

> «Match Wagers: The player progressing to the next round will be deemed the winner, providing one of the
> players has thrown a dart at the start of the first leg. If the first dart is not thrown, all bets are void.»
> «Sets Wagers: The full number of sets required to win the match must be completed. If for any reason the
> match is awarded to a contestant before the full number of sets is completed, all sets wagers are void.»
> «In the case of a match not being finished all undecided markets are considered void.»

No dice nada de si los 180 del desempate cuentan, que es justo la pregunta pendiente. **Sigue abierta.**

### Baloncesto — la prórroga

> «Any wager on the game or the 2nd half will include any overtime that may occur, unless otherwise specified.»
> «Any wager on the 4th quarter does **not** include any overtime.»
> «Market: Odd/Even is graded upon regular time only.»

Y el mínimo para que haya acción: **35 minutos** en todas las ligas, **43** en NBA, 36 en pretemporada NBA.

### Fútbol americano — la prórroga y el empate

> «Bets on the Game and 2nd Half-periods include points scored in overtime.»
> «If a game is suspended with fewer than 55 minutes completed and is not completed within 12 hours, all
> bets on the Game-period will be void and bets on completed periods will have action.»

Contesta la mitad de la pregunta de NFL (la prórroga en hándicap y total: **cuenta**). **El empate en
moneyline no lo dice el apartado de fútbol americano**, así que esa mitad sigue abierta.

---

## Veredicto por familia

Ninguna pasa a `contrato_documentado: true`, y por un motivo que ahora está medido en vez de supuesto: cada
una cruza en dos o tres casas y solo tenemos el reglamento de una. Lo que cambia es que el hueco pasa de
«nadie lo ha mirado» a una lista corta y concreta.

| familia | Cloudbet | qué falta |
|---|---|---|
| `esports:cs2` | prórroga **resuelta** (cuenta) | Pinnacle y Bovada; y la primera mitad de CS2, que el propio reglamento de Cloudbet deja ambigua (dice MR15) |
| `esports:lol` | kills **resueltos** (match summary = kills de campeón) | Pinnacle y Bovada |
| `esports:valorant` | prórroga **resuelta**; primera mitad 1-12 **cuadra** | Pinnacle y Bovada; y Valorant sigue sin fuente de resultados propia |
| `esports:dota2` | kills **leídos y contradictorios** con sus propias líneas | resolver la contradicción con la casa; Pinnacle y Bovada |
| `tt` | retiro **resuelto**, con el matiz de «undecided» sin implementar | escribir el matiz en el liquidador; Bovada |
| `tenis` | retiro **resuelto y ARREGLADO en el código** | Pinnacle y Bovada |
| `dardos` | el reglamento **no menciona** los 180 del desempate | preguntar a la casa; Pinnacle, Bovada y Polymarket |
| `nfl` | prórroga en hándicap y total **resuelta** (cuenta) | el empate en moneyline; y las casas de The Odds API |
| `hoops` | prórroga **resuelta** + mínimos de tiempo | las casas de The Odds API; picks apagadas de todas formas |

**Lo que cerraría el resto:** los reglamentos de Pinnacle y Bovada, que este entorno no puede alcanzar
(política de egreso). Los abre cualquiera con un navegador normal en `help.pinnacle.com` y
`help.bovada.lv`, y con eso se cierran seis de las nueve.
