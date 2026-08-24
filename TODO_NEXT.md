# TODO_NEXT.md — GP Simulador

## 💵 25-AGO: EJECUTOR CON DINERO REAL (léeme antes de tocar `real-executor/`)

Hay **dinero real** en juego desde hoy. Cuenta de Cloudbet fondeada con 604 USDT.

**Qué apuesta y qué no.** SOLO `cards_under_v1`: familia CARDS, lado under, casa cloudbet, fútbol. Las
cinco condiciones están escritas en `real-executor/store.js` como constantes, **no** como variables de
entorno, a propósito: un ejecutor de dinero real cuyo alcance se amplía cambiando una casilla en un panel
es un accidente esperando a alguien con prisa. Para ampliarlo hay que editar el archivo y saber lo que se
hace. CS2 sigue solo en la sombra por decisión de Alexis.

**Cómo funciona.** Va colgado DETRÁS del ejecutor en la sombra, sobre la misma apuesta que el sombra acaba
de anotar: misma señal, mismo precio, mismo instante. Así toda diferencia entre los dos registros es
ejecución —deslizamiento, rechazos, topes de la casa— y no dos criterios distintos. Ese contraste es el
único dato que el primer mes no se puede simular.

**Stake:** Kelly/4 con tope del 1,5 % sobre un banco NOCIONAL de $2.000 (≈$30), aunque la cartera tenga
menos. Decisión explícita de Alexis. El banco compone con el P&L real.

**Reparto de autoridades, y esto es lo que más importa:**
- el RESULTADO lo pone NUESTRA liquidación (la misma que cierra la pick del sombra),
- el DINERO lo pone la casa con `returnAmount`,
- si no cuadran, **no se toca el banco**: se marca `discrepancia` y sale en mayúsculas en el parte del día.

No se puede sacar el resultado de la casa: su campo `status` dice si ACEPTÓ la apuesta (ACCEPTED /
PENDING_ACCEPTANCE / REJECTED), no si ganó, y una perdida y una sin resolver son las dos ACCEPTED con
`returnAmount: "0.0"`.

**Tres cosas que parecen detalles y no lo son:**
1. La consulta de estado va por GraphQL (`bet(referenceId:)`). La ruta REST equivalente es POST, no GET
   — pero da igual, porque está bloqueada.
2. Un **HTTP 200 con `status: REJECTED` NO es una apuesta colocada.**
3. La referencia va por **(pick, número de ENVÍO)**: la casa la consume aunque rechace. El número solo sube
   cuando se mandó algo y la casa dijo que no. Un envío cuyo desenlace desconocemos —red cortada, tiempo
   agotado— **NO estrena referencia**: se pregunta por la vieja (`confirmar()`). Estrenar referencia sin
   saber qué pasó con la anterior es la única forma de apostar dos veces lo mismo.

**Estados:** PENDIENTE (se reintenta cada barrido hasta el saque) · EN_ACEPTACION (la casa la evalúa; nunca
se reenvía) · PLACED · SETTLED · CADUCADA (se acabó el tiempo) · DESCARTADA (sin ventaja).

**Frenos:** `GP_REAL_ENABLED` (maestro), `GP_REAL_DRY` (ensayo), tope por apuesta en dólares, tope de
exposición abierta —lo que está en el aire cuenta como comprometido—, parada diaria por pérdida, suelo de
cartera y deslizamiento máximo.

**LA VENTAJA SE MIDE, NO SE FILTRA (25-ago, decisión de Alexis).** El ejecutor llegó a rechazar las señales
con `prob × cuota ≤ 1`. Sonaba prudente y rompía lo único que este primer mes existe para medir: la sombra
SÍ las toma, así que filtrarlas convertía la diferencia entre los dos registros en "dos criterios distintos"
en vez de "papel contra dinero". Son el 14 % de las señales con EV medio −2,1 % — unos 0,3 puntos de EV
global. Se apuestan, se marcan con su `ev_modelo_pct` y el tablero las cuenta APARTE en `por_ev`, para poder
contestar dentro de un mes si de verdad perdieron. `GP_REAL_EXIGIR_VENTAJA=1` vuelve a filtrarlas si el dato
lo pide. **Ojo con el porqué: esto NO es una discusión sobre CLV.** `sin_ventaja` compara el precio con la
probabilidad del propio modelo, no con el cierre.

**LA CASA TIENE DOS APIS DE APUESTAS Y SOLO UNA NOS DEJA ENTRAR.** Con llave `trading` y cuenta fondeada,
toda la familia REST `/pub/vN/bets/*` —colocar, consultar estado, historial— devuelve **403 con página de
cortafuegos de Cloudflare**, igual con llave y sin ella, desde Oregón, desde Fráncfort y desde un tercer
sitio, con user-agent de navegador y con `Authorization: Bearer`. Mientras tanto `/pub/v2/odds/*` y
`/pub/v1/account/*` responden 200 desde esas mismas IPs con esa misma llave. **No es la llave, ni la ruta,
ni el país, ni el cuerpo: es una regla de borde sobre esa familia de rutas.**

La salida es la **API GraphQL de la casa** — oficial, documentada, misma función:
`https://sports-api-graphql.cloudbet.com/graphql`. Comprobado con un evento imposible: contestó
`betStatus: REJECTED, betErrorCode: MALFORMED_REQUEST`, que es el motor de apuestas hablando y no un
cortafuegos. Reparto actual: **cuotas y saldo por REST, colocar/consultar/liquidar por GraphQL.**

Y GraphQL da dos cosas que la REST no daba: el **resultado** de la apuesta (`betStatus` pasa a WIN / LOSS /
PUSH / HALF_WIN / HALF_LOSS / PARTIAL) y un **código de error por rechazo**, que permite separar "vuelve a
intentarlo" (precio movido, tope, mercado suspendido, fondos) de "esto es tuyo con la casa" (RESTRICTED,
VERIFICATION_REQUIRED) de "es un fallo nuestro" (MALFORMED_REQUEST).

**El reenviador de Fráncfort (`gp-relay-eu`, $7/mes) YA NO SE USA.** Se creó sobre la hipótesis de que el
403 era geográfico; la hipótesis resultó FALSA —el 403 sale igual desde Alemania— y por GraphQL se entra
desde cualquier sitio. Está suspendido. `real-executor/relay.js` se conserva por si algún día hace falta
aislar la llave, pero el ejecutor no lo llama.

**Antes de tocar nada:** `node real-executor/auditoria.js`. Levanta una casa de mentira y recorre 22
escenarios del camino del dinero, incluido que el banco cuadre con la suma de resultados. No toca la red ni
la cuenta. Si eso no está en verde, no se despliega.

**Sondas:** `/api/internal/real?key=` (GET tablero, `&preflight=1` resolución sin escribir, POST
`run=saldo|liquidar|plan|parte`) y `https://gp-relay-eu.onrender.com/health` (país de salida, estado de la
puerta y saldo).

**Correos:** plan a las 08:00 y parte a las 23:30, hora local. Ninguno lleva apuestas que colocar: esta
pierna es automática y cuando el correo llega la apuesta ya está puesta.


## ✅ 23-AGO: LOS NUEVE, ABIERTOS
Hecho hoy. El landing nuevo **ya es** `public/landing.html` — no se copió el fichero tal cual: el que
estaba en el artifact era una maqueta **sin formulario de alta** (su botón enlazaba a la propia web), así
que se injertó el diseño nuevo sobre la maquinaria del vivo. Lo que se conservó, y por qué:
- el script de sincronía de sesión (sin él, un usuario con sesión se queda en el landing en vez de entrar),
- la cabeza entera: SEO, OG, canonical, JSON-LD y las fuentes propias de `/fonts`,
- `landing.js` y el modal de alta real (`data-signup`), que es lo único que esta página tiene que hacer,
- cajas ocultas (`#pillars`, `#scan`, `#plays`…) que `landing.js` rellena **sin comprobar si existen**: si
  faltan, revienta a media carga y se lleva por delante el cableado del alta. Comprobado sin errores.
- Los CTA llevan `data-k2="cta"` para que `fillStatic` no les reescriba la clase y se lleve el diseño.

**Si se vuelve a tocar el landing desde un artifact, repetir ese injerto.** Un `cp` deja la página bonita
y muerta.

Interruptores encendidos en Render (los cinco `*_PUBLIC_ENABLED`) y `GP_NEWSPORTS_FREE_UNTIL` con la fecha
real de cierre de la semana abierta. Página de planes: los nueve en ABIERTO.

**Sigue oculto hasta nuevo aviso:** Rendimiento y "El motor", en los siete deportes, para todos menos el
admin (que conserva el atajo en su menú).

## 🏈 FÚTBOL AMERICANO (18-ago): lo que queda tras el build
1. **Vigilar la primera semana de sombra CFL** (juega 20-23 ago): picks TOTAL under con edges 8-19pp —
   o el mercado está blando o el total del modelo se queda corto tras el cambio de reglas 2026. El CLV
   de esas picks lo dirá ANTES que el acierto. No subir el listón ni tocar la base hasta tener 2 semanas.
2. College arranca el 29-ago: la cadena registra sola desde ~20-ago (ventana 9 días). Semana 1 con
   incertidumbre máxima por diseño (NFL-0032 aplicado a college).
3. Mejorables declarados: cierres CFL 2025/2026 incompletos (60/85 y 19/42 — fechas con huso cruzado en
   el matcher histórico), ADN por dimensión de college (PPA de CFBD, gasta llamadas), abreviaturas CFBD
   a veces largas. Ninguno bloquea la sombra.
4. La cosecha CFBD incremental (resultados 2026) la hace el propio server cada 6 h con 1 llamada.

## ⏭️ LO PRIMERO DE LA PRÓXIMA SESIÓN (17-ago noche)
1. **Mirar con Alexis las lentes de fútbol** (rama `claude/gpsim-continuation-vrjuww`, commit `650c56e`) y,
   si convencen, empujar ese SHA a main. Si no, revertir es borrar un commit: nada más de la rama depende
   de él salvo el orden (los scripts de Dota van encima).
2. **Enviar las solicitudes de `SOLICITUDES_DATOS.md`**, por este orden: **GRID Open Access** (gratis,
   CS2 + Dota 2 server-side — es el desbloqueo del dato ronda a ronda) → Liquipedia → Riot (prioridad baja,
   su API pública no sirve partidas profesionales).
3. **Revisar la sombra de props con la primera liquidación** (llega con la pasada diaria del 18-19-ago) y
   leer el CLV nuevo: el componente que informa es la **línea**, no el precio.
4. **Dota 2, siguiente paso medido**: pesar por liga / filtrar tier antes de tocar K — el AUC no se mueve
   con K (0,571-0,577), así que el techo está en el dato. Solo después se enchufa el rating al motor.
5. Sigue en pie el pendiente del domingo 23 (las cuatro correcciones de abajo) y los pendientes de Alexis:
   rotar `API_FOOTBALL_KEY` y `RENDER_API_KEY`.

## 🎮 ESPORTS (nuevo el 16-ago): lo que bloquea que el quinto deporte valga algo
El producto está entero y admin-only, pero **no puede medirse a sí mismo** porque Cloudbet no publica
resultados (comprobado: evento terminado → `settlement` vacío y cero mercados; `/odds/results` es 404).
1. **Fuente de resultados** — OpenDota y la API de Riot son públicas y no necesitan permiso comercial. Es
   el desbloqueo número uno: sin ella no hay rating propio, ni liquidación, ni ROI, ni CLV.
2. **Histórico de vetos y drafts** — el árbol de veto de CS2/Valorant hoy se deriva de la fuerza por mapa,
   que tampoco existe todavía. Depende del punto 1.
3. **Calibrar los supuestos declarados** — ritmo por liga (LoL/Dota), sesgo defensivo por mapa (Valorant) y
   arrastre económico por ronda están puestos como referencia de circuito y marcados como tales en la UI.
   En cuanto haya muestra propia, `calibrateTempo` los sustituye con encogimiento.
4. Demos .dem para la economía real de CS2 — necesita solicitud aprobada en FACEIT.
Mientras tanto el trabajo de `snapshot` guarda el cierre de mercado cada 20 min para que el CLV se pueda
calcular hacia atrás el día que lleguen los resultados.


## 🔴 PENDIENTE DE LA CAÍDA DEL 16-ago: el pico de memoria sigue ahí (solo cabe mejor)
La plataforma está estable, pero lo que la tumbó no está resuelto del todo — está **acomodado**.
- Cada ciclo hay un pico transitorio de **~900 MB** (era 1429 MB antes de encadenar los trabajos). Cabe
  porque el techo de Node subió a 3072 MB; si algo lo hace crecer otra vez, vuelve a caer.
- El vigía `[mem]` (ya en producción) lo atribuye a **`hoops:build`** sobre todo, y al bloque
  **`combate:cloudbet`** de las tres organizaciones los primeros ~600 MB.
- **Descartado por medición, no por intuición:** `db.json` (disco al 25 %, base en memoria sana) y el
  archivo de cuotas de combate (0,2-0,4 MB medidos en producción).
- Siguiente paso: marcas finas dentro de `buildHoopsPicks` y `combatCloudbetRefresh`. **Instrumentar sí;
  tocar la lógica de decisión de baloncesto NO hasta el domingo 23.**
- **Regla que deja esto:** `NODE_OPTIONS` estaba fijado a `--max-old-space-size=1536`, así que subir la
  instancia a 4 GB no sirvió de nada durante una hora. Si en el futuro se sube RAM, **revisar esa variable
  primero**. Y ningún proceso había vivido más de 1,2 h por los redespliegues constantes: un bug que
  aparece a las 8 horas era invisible.

## 🥊 COMBATE 16-ago: capa visual y motor de boxeo — DESPLEGADOS Y VERIFICADOS (`117ccb7`)
Detalle completo y todas las mediciones en `HANDOFF.md` §2. Lo que hay que saber aquí:
- **Boxeo no tenía capa profunda**, no la tenía "adaptada de MMA": `espnstats-boxing.json` no existe, el
  motor de fases producía 0 perfiles y `fightIntel` devolvía `available:false` para toda pelea de boxeo.
  Ahora `combat-engine/boxing.js` produce 2.767 perfiles y está validado sobre 2.768 peleas fuera de
  muestra (finalización AUC 0,694; asalto medio 5,11 contra 5,30 real; método dentro de 1,7 pp).
- **La cobertura de `fights-boxing.json` sigue siendo el pendiente, pero por una razón MÁS ESTRECHA de lo
  que parecía.** Investigado a fondo el 16-ago (detalle y todas las cifras en el encabezado de
  `combat-engine/boxing.js`):
  - Los 1.376 boxeadores con ficha propia tienen el récord **completo** (mediana del 100 %). El crawler
    funciona bien; el problema no es que baje mal lo que baja.
  - Los otros 1.391 perfiles (la mitad exacta) se construyen con récords **truncados**, y el sesgo de sus
    tasas es enorme (−62,9 % de rotura, +145,7 % de fragilidad, t de dos dígitos)…
  - …**pero predicen MEJOR que los completos** (AUC 0,744 contra 0,685). Que solo los conozcamos por sus
    derrotas contra buenos es información: dice que son el lado B. **Por eso NO se corrigió nada.**
  - Se probaron dos correcciones y las dos empeoran, con su medición escrita en el código para que nadie
    las repita: el ajuste por calidad del rival (rompe el nivel: predice 28,8 % donde ocurre 50,3 %) y
    subir el encogimiento (empeora en los cinco escalones probados).
  - **El hueco real que queda son los boxeadores con CERO peleas** — 5 de los 6 de la cartelera del 15-ago.
    Eso no lo arregla ningún modelo, solo más dato.
- **🔴 PARA AMPLIAR EL HISTÓRICO HAY QUE CORRERLO FUERA DEL SANDBOX.** Wikipedia devuelve 429 a la IP de
  salida del sandbox con cualquier ritmo (probado con 3 s entre peticiones; `retry-after: 40`). El comando,
  para correr desde una máquina con IP limpia o desde el servidor de Render:
  ```bash
  node scripts/combat-boxing-backfill.js --depth=3 --max=4000 --sleep=200
  ```
  Es idempotente y cachea, así que se puede parar y reanudar. Sube `fights-boxing.json` (hoy 16 MB / 39.158
  peleas) — vigilar el tamaño y el tiempo de carga de `combatLoad` después.
- MMA sin regresión: las cuatro peleas probadas de UFC 330 devuelven `deep.available:true`; el endpoint
  tarda entre 419 y 1.374 ms.
- **Hipótesis abierta y preregistrada aquí para no cazarla a posteriori:** el ganador del motor de boxeo
  SIN anclar tiene habilidad real (Brier 0,204 contra 0,250 de la moneda, 67,2 % de acierto), a diferencia
  de MMA. Va anclado igual porque está descalibrado (3/8 tramos, ECE 3,79 pp) y porque el mercado de ganador
  es el que pierde dinero. Si aparece histórico de cuotas de boxeo, **medir esto antes que nada**.
- **Lo que NO se puede construir con el dato actual, para no volver a intentarlo:** jab/power desde conteo
  de golpes (no hay CompuBox), derribos como mercado medido (no hay conteo de caídas) y el cruce
  zurdo/diestro (los dos peleadores tienen guardia conocida solo en el 19,5 % de las peleas desde 2018).

## 📌 REVISIÓN DEL DOMINGO 23 DE AGOSTO — las 4 correcciones acordadas
> **Decidido el 16-ago con Alexis:** el sistema corre **como está** hasta el domingo 23 acumulando datos de
> toda la semana. Ese día se aplican las correcciones de abajo con la evidencia ya recogida. No tocar la
> lógica de decisión antes de esa fecha: cambiarla a mitad de la ventana destruiría la muestra.

### Por qué estas cuatro, y no otras
El backtest al cierre (`scripts/hoops-strategy-backtest.js`) midió el problema de fondo:

| | NBA (911 partidos) | WNBA (203) |
|---|---|---|
| ROI base | **−7,27 %** ± 2,67 · **t = −2,72** | −6,15 % ± 6,12 |
| Ganador | −11,87 % (t = −2,05) | −20,73 % |
| Hándicap | −8,80 % (t = −2,39) | −0,34 % |
| **Total** | **−0,26 %** (t = −0,06) | **+2,15 %** |

Y el diagnóstico: **las picks prometían 56,5 % de acierto y dieron 43,6 %**. En el tramo donde el modelo más
confía (67-83 %) acertó el 49,3 %. El modelo calibra bien en general — falla justo donde más se separa del
mercado. **La ventaja que encuentra es su propio error.** Apostar lo contrario tampoco gana (−2,69 % en NBA):
no hay señal invertida, solo ruido pagando margen.

---

### ✅ 1. Apagar el ganador y poner TECHO a la ventaja
- **Ganador fuera** en las dos ligas: −11,87 % y −20,73 % con t significativo no es mala racha.
- **Techo además del suelo.** Hoy más ventaja = mejor pick; los datos dicen lo contrario.
  ROI por banda en NBA: 2-4 pp −3,6 % · 4-6 pp −2,79 % · **6-8 pp −16,07 %** · 8-12 pp −6,61 % · 12+ −8,31 %.
  Propuesta: rechazar por encima de ~6 pp contra un cierre maduro con código `ventaja_inverosimil`.
- Es **higiene, no estrategia**: quita las bandas peores pero ninguna banda gana.
- Dónde: `basketball-engine/gates.js` (`FAMILY`, `evaluate`), `REASONS`.

### ✅ 2. Invertir el criterio: anclarse al mercado y publicar solo la desviación de UNA casa
La idea de Alexis, y es la correcta: *market-anchored derivative pricing*. Nuestro error está en el
**nivel**, no en la **forma**. Entonces:
- Recalibrar la simulación para que su hándicap y total implícitos **coincidan** con el consenso.
- Publicar solo cuando **coincidimos con el consenso y una casa se desvía**. El modelo pasa de opinar a
  validar. Es el inverso exacto de lo que hace hoy.
- Medición que lo respalda (WNBA, 4 partidos, todas las regiones): **9 % de las líneas del mercado
  principal ofrecen ≥2 % de EV** solo por tomar el mejor precio, sin modelo.
- Dónde: `buildHoopsPicks` en `server.js`, `basketball-engine/pricing.js` (`consensus`).

### ✅ 3. Concentrarse en TOTALES, y en el mercado principal de ligas menores
- Totales es la única familia que no sangra (−0,26 % NBA · **+2,15 % WNBA**), y tiene explicación
  estructural: el simulador modela el shock de ambiente compartido, que es justo lo que correlaciona los
  puntos de los dos equipos. Un modelo naíf produce totales demasiado estrechos.
- Extender con el mismo motor: **totales de equipo y de mitades**.
- **NCAA desde noviembre**: ~350 partidos al día y muchas más casas → el volumen de desajustes de
  ejecución es de otro orden. Hoy tiene 0 eventos (fuera de temporada).

### ⚠️ 4. Props: en sombra y con el listón real, NO como plan principal
Medido el 16-ago en WNBA con las 50 casas disponibles:

| | Casas por línea | Vig | EV mejor precio vs consenso | Líneas con EV ≥ 2 % |
|---|---|---|---|---|
| Principal | 8 | **4,71 %** | mediana −3,45 % | **9 %** |
| Props | 6 | **6,98 %** | mediana −4,07 % | **1 %** |

**Los props son más caros y están más de acuerdo entre sí, no menos.** Solo 10 casas los ofrecen y casi
todas compran el mismo feed. El listón real para batirlos no es 3,5 pp sino **~4 pp sobre el consenso sin
margen** — y nuestro modelo fue *peor* que el consenso en el mercado principal.
- Mantener en sombra: es el sitio donde la maquinaria de minutos (RAPM + rotación + árbol de reemplazo)
  podría valer, y ahí sí tenemos algo que el mercado principal no premia.
- Subir el umbral de las familias de jugador en `gates.js` de 3,5-5 pp a ≥4 pp reales sobre consenso.
- ⚠️ **Aviso**: esa medición es de UNA noche (4 partidos). Ver el punto siguiente.

---

### 🔬 QUÉ SE ESTÁ ACUMULANDO ESTA SEMANA (para que el domingo haya con qué decidir)
| Dato | Estado | Sirve para |
|---|---|---|
| Movimiento de línea (apertura → cierre) | ✅ ya, en `sportsbook_quote_history` | El experimento de "ganarle a la apertura, no al cierre" |
| Partes de bajas con hora | ✅ desde el 16-ago, en el data-fabric | Que el backtest pueda por fin medir la capa de plantilla |
| **Props: vig, casas y dispersión** | ✅ **añadido el 16-ago** (`hoopsPropsCapture`, cada 30 min) | Confirmar o tumbar la medición de una noche del punto 4 |
| Picks del monitor con veredicto de compuertas | ✅ ya | Ver cuáles se habrían publicado de verdad |

**El domingo, antes de tocar nada, correr:**
```bash
node scripts/hoops-strategy-backtest.js wnba      # ROI, calibración, bandas, caída máxima
node scripts/hoops-validate.js                     # veredicto de capas por liga
curl "$HOST/api/hoops/fabric?mode=health"          # cuántos eventos se acumularon
curl "$HOST/api/hoops/perf?league=wnba&force=1"    # calibración, CRPS, CLV
```
Y comparar la semana de props contra la noche del 16-ago: si el vig sigue en ~7 % y la dispersión sigue por
debajo del mercado principal, el punto 4 queda cerrado y props baja a prioridad de investigación.

### 🚫 QUÉ NO HACER EL DOMINGO
- **No** seguir refinando el modelo de fuerza de equipo para el ganador. Está medido que no lleva a nada.
- **No** buscar un subconjunto rentable en los 5.274 candidatos históricos sin haberlo declarado antes:
  con esa cantidad SIEMPRE aparece uno por azar. Preregistrar el segmento o no vale.
- **No** decidir con ROI donde se pueda decidir con CLV: el ROI necesita ~1.000 apuestas para significancia
  y el CLV ~100.


## 🧠 PRESUPUESTO DEL LLM 15-ago — saldo $20, y no se apaga solo
El gasto diario dejó de ser una constante: es **el saldo restante dividido por un horizonte**
(`GP_LLM_HORIZON_DAYS`, 30). Gastar 1/30 de lo que queda cada día es una caída geométrica — el saldo tiende
a cero pero nunca lo toca, así que el LLM no se corta solo. El suelo también es relativo (nunca más de 1/5
de lo que queda) para que no se vacíe linealmente al final. **Reserva de chat del 35%**: los jobs de fondo
cortan antes, así que un usuario preguntándole a GP siempre tiene presupuesto. Contabilidad persistente en
`db.llmBalance`, aviso por email al 15% y foto completa en `/api/internal/llm`.
Vars: `GP_LLM_BALANCE_USD`, `GP_LLM_BALANCE_AT` (cambiar cualquiera = recarga nueva → reabre el día),
`GP_LLM_HORIZON_DAYS`, `GP_LLM_CHAT_RESERVE`, `GP_LLM_DAILY_MAX_USD`, `GP_LLM_DAILY_USD` (techo heredado).
Hoy: $20 → **$0.67/día**, ~29 días de autonomía sin recargar.
⚠️ **Render**: cambiar una env var por API NO basta — hay que disparar un deploy después o el proceso sigue
con el valor viejo (pasó justo con `GP_LLM_BALANCE_AT`).

## 🚨 BUG DE PRODUCCIÓN ENCONTRADO 15-ago — el escáner de fútbol devolvía CERO en silencio
`market-scanner/quotes.js` acumulaba los lotes de la query con `rows.push(...r.rows)`. Extender un array de
decenas de miles de filas como ARGUMENTOS supera el límite de la pila (`Maximum call stack size exceeded`), y
con el plan de 5M —55.000 cuotas por barrido más las columnas de profundidad— empezó a pasar de verdad. El
`.catch(() => [])` de `getClubsScan` se lo tragaba: **arbitraje, price-lag y middles vacíos, con la tabla
llena y sin una sola línea de log.** Arreglado con un bucle en los tres sitios (el patrón estaba también en el
módulo nuevo de baloncesto, donde aún no dolía por volumen) y el catch ahora loguea.
Medido tras el arreglo: **1.175 mercados escaneados · 147 arbitrajes (32 ejecutables) · 680 price-lag.**
Lo que lo destapó: `/api/internal/clubs-scan` ahora reporta cada escalón (eventos totales, sin baloncesto,
dentro de ventana, mercados cargados, error del loader) en vez de un `available:false` mudo.
**Regla que deja esto:** ningún catch de un cargador de datos puede ser mudo, y ningún feed vacío es
"normal" hasta haberlo medido.

⚠️ Efecto lateral esperado de separar deportes: los "40 middles" de fútbol de esta mañana incluían partidos
de baloncesto (el sweep de hoops escribe `match_total` en el mismo almacén). Ahora esos viven en
`/api/hoops/opps` y el de fútbol muestra los suyos, que hoy son 0.

## 🎯 EVALUACIÓN DEL MODELO DE BALONCESTO 15-ago — dónde estamos y qué falta
**Medido fuera de muestra (ventana expandida, ningún partido evaluado entró en su propio ajuste):**

| | NBA | WNBA |
|---|---|---|
| Partidos evaluados | 772 | 164 |
| Brier del mercado (cierre) | 0.1878 | 0.1953 |
| Brier de GP | 0.2083 | 0.2032 |
| **Skill vs cierre** | **−0.0205 ± 0.0040 · t = −5.16** | **−0.0079 ± 0.0067 · t = −1.18** |
| Acierto | 67.0% | 67.7% |
| MAE de margen | 12.11 | 9.80 |

**Veredicto honesto:** en NBA el modelo está DECISIVAMENTE por detrás del cierre (t = −5.16 no es ruido,
es un hecho). En WNBA está por detrás pero dentro del ruido. Ningún caso justifica publicar picks.

**LO QUE NOS FALTA, y no es datos — es modelado.** Ya cosechamos por partido: play-by-play completo,
box de CADA jugador (min, pts, reb, ast, tov, +/-, titular) y coordenadas de tiro. El motor solo consume
AGREGADOS DE EQUIPO. Los tres huecos medidos en nuestros propios datos:
1. **Disponibilidad y minutos de jugadores** — 546 jugadores cosechados en NBA, cero usados. El jugador
   más usado juega 37.2 min de media: que falte mueve la línea entre 2 y 6 puntos y el modelo no lo ve.
2. **Descanso** — el 15,3% de los partidos NBA son back-to-back. Medido acá: el equipo en B2B rinde
   **1,56 puntos peor** (n=261). Es casi el DOBLE de la ventaja de cancha que sí modelamos (1,68).
3. **Garbage time** — el detector marca el 64% de los partidos, o sea que no discrimina. Los ratings
   incluyen minutos de basura que no describen la fuerza del equipo.

Además: una sola temporada de WNBA y dos de NBA (priors pobres), sin efecto de viaje/altitud, sin
árbitros (faltas → totales), sin modelo en vivo, sin props de jugador (el mercado más blando), y sin
encogimiento hacia el mercado en lo que el modelo no puede ver.

## ✅ 16-ago — LOS SEIS PUNTOS, CONSTRUIDOS Y MEDIDOS
La estructura de arriba está cerrada. Lo que sigue NO es construir: es acumular partidos y ajustar.

| Punto | Dónde vive | Estado medido |
|---|---|---|
| 1 · Minutos y disponibilidad | `basketball-engine/minutes.js` | rotación EWMA + techo + reparto; bajas de ESPN con probabilidad explícita |
| 2 · Ratings de jugador | `players.js` + `lineups.js` | RAPM por gradiente conjugado, λ por CV temporal; quintetos reconstruidos con MAE 0,25–0,32 min contra el acta |
| 3 · Descanso y calendario | `context.js` | B2B, descanso, 3-en-4, viaje, altitud; con error estándar, t, encogimiento y **prior de signo** |
| 4 · Filtro de basura | `markGarbage` en `lineups.js` | 7–10% de posesiones (antes la bandera marcaba 51–64%) |
| 5 · Encogimiento al mercado | `fitBlend`/`blend` en `model.js` | w = 0,134 (NBA) · 0,233 (WNBA), con validación anidada |
| 6 · Props de jugador | `props.js` | binomial negativa por jugador y categoría, con factor de rival |

**Correcciones que cambiaron la historia (y que hay que recordar):**
- El **1,56 de back-to-back** de la tabla de arriba era una media cruda. Controlando por calidad de equipo
  queda en **−1,03 ± 1,55 (t = −0,66): no significativo.** La conclusión anterior era un artefacto.
- La **altitud** salía −10,6 puntos (t = −3,5) diciendo que jugar en altura perjudica al local. Con solo dos
  sedes en altura ese término no medía altura, medía el residuo de Denver y Utah → prior de signo.
- El peso de mezcla salía **w = 1** hasta que se estimó con validación anidada. Era el rating prediciendo
  partidos que ya había visto.

**GATING POR VALIDACIÓN** (`data/basketball/validation-<liga>.json`, escrito por `scripts/hoops-validate.js`):
el motor lee `layers` y aplica solo lo que se ganó su sitio.
- NBA (n = 772): base −0,0202 → mezcla **−0,0019**. Plantilla (−0,0020) y contexto (−0,0002) APAGADOS.
- WNBA (n = 164): base −0,0075 → mezcla **−0,0041**. Plantilla ENCENDIDA (+0,0023), contexto apagado.
- **Seguimos por detrás del cierre en las dos ligas. Las picks de modelo siguen apagadas.**

**El ajuste salió de la petición** (`scripts/hoops-fit.js` → `data/basketball/fit-<liga>.json`): RAPM (4,5 s)
y mezcla (1,0 s) se entrenaban dentro de `store.load()`, o sea dentro de la primera petición tras cada
refresco de caché — 5,7 s de CPU bloqueante cada 30 min, que en Node de un hilo congela el sitio ENTERO.
Ahora se entrena fuera de línea y el servidor solo lee: carga de NBA 5.761 ms → **464 ms**. El re-ajuste
está acoplado a `hoops-backfill.js` para que el artefacto no envejezca en silencio.


## 🥊 16-ago — BLUEPRINT DE COMBATE, PRIMERA TANDA (aditivo, desplegado)

**Lo que estaba sin usar.** El dataset de ESPN traía por pelea y peleador los golpes significativos por
POSICIÓN (distancia/clinch/suelo) × OBJETIVO (cabeza/cuerpo/pierna) —nueve celdas—, derribos, avances
posicionales (media guardia, lateral, montada, espalda), reversiones, sumisiones y tiempo de control.
**7.998 peleas.** El modelo solo consumía agregados.

| Módulo | Cubre | Qué aporta |
|---|---|---|
| `combat-engine/phases.js` | 57-90 | Perfil por las 9 celdas con decaimiento temporal y **ajuste por rival** · la CADENA de lucha: intento → derribo → control → avance → amenaza |
| `combat-engine/style.js` | 101-122 | ADN en 8 ejes de percentil + arquetipos con confianza · cruce ATAQUE contra DEFENSA · **ruta de victoria** ponderada por probabilidad de fase · **fragilidad** del pronóstico |
| `combat-engine/fightsim.js` | 123-146 | Riesgos competitivos (KO/sumisión/límite compiten por el mismo minuto) · fatiga que conecta estilo con método · **tres tarjetas de jueces** → unánime/dividida/mayoría/empate |
| `combat-engine/intel.js` | — | Capa que sirve, caché por organización (404 ms) · `/api/combat/fight?deep=1` |
| `scripts/combat-validate.js` | 211-232 | Validación con ventana móvil por bloques |

### ⚠️ LA MEDICIÓN, Y LA CORRECCIÓN QUE FORZÓ (3.140 peleas)
| | Resultado |
|---|---|
| **Quién gana** | Brier **0,276** contra **0,250** de decir siempre 50% → **peor que una moneda**. Cuando decía 93% ganaba el 67%; cuando decía 8% ganaba el 46%. 7 de 8 tramos descalibrados, resolución 0,004 |
| **Cómo termina** | KO 29,4% vs 32,3% real · sumisión 19,4 vs 17,6 · decisión 51,2 vs 50,1 · límite 51,3 vs 50,1 → **las cuatro dentro de 3 pp** |

**El monitor en vivo dice exactamente lo mismo** con 66 picks liquidadas: familia FIGHT con **CLV −8,34%**
y familia ROUNDS con **CLV +4,88%** y 52,2% de acierto. Dos mediciones independientes coincidiendo.

**Corrección aplicada:** el ganador lo fija el modelo de habilidad (Elo) y el método/asalto/duración el
motor de fases. Se resuelve por búsqueda binaria el desplazamiento que hace que la simulación reproduzca el
prior. Verificado: con ancla al 75%, Makhachev sale 74,7% y conserva su 36% de sumisión; Pereira-Adesanya
mantiene 71% KO y 2% sumisión. Cada cruce conserva su firma.

### 🔜 LO QUE FALTA DE ESTE BLUEPRINT
1. **Capa visual** (secciones 32-39): Matchup Battlefield, Fight DNA como pieza gráfica, línea de tiempo
   por asalto, Scorecard Room, Simulation Room. **Los datos ya salen por la API — falta dibujarlos.**
2. **Motor de boxeo propio** (14-18): el documento pide otro lenguaje técnico (jab/power split, iniciativa
   por asalto, tarjeta de 10 puntos). Hoy boxeo usa el motor de MMA adaptado.
3. **Concentrar el trabajo en ROUNDS/MÉTODO**, que es donde las dos mediciones dicen que hay algo. El
   ganador está anclado y no debe generar selecciones por sí solo.
4. **Sin histórico de cuotas de combate** no se puede medir ROI retrospectivo. El CLV del monitor es la
   única vara disponible, y por eso hay que dejarlo acumular.

## 🧭 16-ago — EL BLUEPRINT DE INTELIGENCIA, APLICADO COMO ADITIVO
Documento de referencia: `GPsimulador_Basketball_Intelligence_Master_Blueprint` (349 módulos). No se
reconstruyó nada: se auditó lo existente contra el documento y se construyó SOLO lo que faltaba.

| Módulo nuevo | Cubre | Lo que aporta que no teníamos |
|---|---|---|
| `advanced.js` | 24-45 | Four factors ajustados por rival · **eFG esperado** por mezcla de tiros → descomposición de suerte · cuartos · clutch desde tramos · forma ajustada por calendario · récord sostenible |
| `rotations.js` | 66-80 | Quintetos con encogimiento por posesiones · cinta de rotación minuto a minuto · P(titular) y P(cerrar) · árbol de reemplazo por afinidad real · redistribución de uso por categoría |
| `pricing.js` | 166-182 | Sin vig por Shin/potencia/proporcional **con el método registrado** · consenso ponderado por casa y frescura · **lógica de empuje** en líneas enteras · cuota mínima jugable · sensibilidad del EV · Kelly con límite inferior |
| `scenarios.js` | 84-92, 149, 271-272 | Ramas juega/limitado/no juega simuladas · tornado de sensibilidad · **incertidumbre aleatoria vs epistémica** · panel de riesgos |
| `gates.js` | 183-200 | Umbral por familia · compuerta de incertidumbre (ventaja > 1,3× epistémica) · **NO PICK con código de razón y contrafactual** · expiración · ciclo de vida por familia |
| `metrics.js` | 215-227 | Log loss · nitidez · Murphy · calibración con Wilson · **CRPS** de margen y total · distribución de CLV con bootstrap · estabilidad por segmento |

**Piezas visuales propias** (243-285, y las reglas anti-IA 286-310): cinta de rotación, cascada de "quién
ocupa el hueco", conmutador si-juega/si-no-juega, tornado con barra de incertidumbre, tablero de cruce,
calidad de tiro real vs merecida, identidad por cuartos y quintetos. Un color = un significado, sin
degradados decorativos, números tabulares, y en móvil recomposición en vez de encogimiento.

**Decisiones que conviene recordar:**
- El **monitor privado es MODO SOMBRA** (módulo 229 del blueprint), no una lista de picks. Cada registro
  lleva ahora el veredicto de compuertas, así que se podrá responder "¿de estas cuáles habríamos
  publicado?" sin volver a correr nada.
- El **prior del clutch subió de 80 a 300 posesiones**. Con 80, una temporada de WNBA devolvía +23,7 por
  100; el bruto era +39,2. Así nacen las narrativas de "equipo clutch".
- ESPN **no publica points-off-turnovers** en NBA ni WNBA: se devuelve como no observado, nunca como 0.

## 🧱 16-ago (tarde) — MEMORIA POINT-IN-TIME, VIVO Y ÁRBITROS

**1-12 · DATA FABRIC — construido.** `data-fabric/{store,entities,provenance,snapshots}.js`.
El problema tenía nombre: el parte de ESPN se sobrescribe, así que "en duda a las 18:00 → fuera a las
19:30" se guardaba solo como "fuera", y cualquier backtest de esa noche creería que sabíamos a las 18:00
lo que supimos a las 19:30. Ahora los partes entran como EVENTOS con sus tres tiempos y `asOf()`
reconstruye qué sabíamos en cualquier instante — filtrando por **ingested**, no por effective, que es la
fuga más difícil de ver. Además: IDs canónicos con alias por fuente (para cuando entren los datos de
stats.nba.com), jerarquía de conflictos por dominio, cinco estados de ausencia, congelado por predicción
con hash y auditoría de fuga. Endpoint `/api/hoops/fabric` (health · asof · history · timeline ·
revisions · freeze). **`GP_FABRIC_DIR=/data/fabric`** en Render: sin eso escribía en disco efímero y se
borraba en cada deploy.

**233-242 · EN VIVO — construido y medido.** `basketball-engine/live.js`, `/api/hoops/live`.
- El resto se simula como un partido más corto desde el marcador actual.
- **La varianza del final no es la varianza del partido**: sobre 4 posesiones manda que cada una vale
  0, 2 o 3 puntos (var ≈ 1,5). Con la varianza "de partido" salía +6 a 30 s = **100,0%**; ahora 99,2%.
- **Validado sobre 8.071 estados reales**: Brier 0,150 · ECE 2,35 pp · **0,31 pp en el último minuto**.
- **Dos correcciones probadas y rechazadas** (actualizar con el marcador de hoy; escalar la cancha /
  Platt): mejoraban en muestra y empeoraban fuera (5,08 → 7,38 y → 8,64 pp). Era ruido, no sesgo.
- **Latencia real medida: 27-39 s** en local y hasta 114 s en producción. Presupuesto: informar ≤ 90 s,
  recomendar ≤ 20 s → **las recomendaciones en vivo quedan apagadas solas**. Es la compuerta 242.

**121-125 · ÁRBITROS — se podía, se hizo, y no hay señal.** ESPN publica la terna y no la cosechábamos;
ya entra en el pipeline y se backfillearon los 275 partidos WNBA. `basketball-engine/officials.js`,
`/api/hoops/officials`. Efecto medido sobre residuos con encogimiento: **3 de 32 árbitros pasan |t|≥2 —
justo lo que produce el azar con 32 pruebas— y NINGUNO sobrevive a Benjamini-Hochberg.** Capa apagada.
Pendiente: backfillear las ternas de NBA (1.292 partidos, ~15 min) para repetir la prueba con 4× muestra.

**18/55/58 · TIPOS DE JUGADA Y TRACKING — hay una vía gratis para NBA, no para WNBA.**
`stats.nba.com` responde 200 y sirve, sin coste y sin clave: Synergy play types (30 equipos, temporada
2025-26), tracking de penetraciones, defensa del aro por jugador (562 filas) y perfil de tiro por
distancia del defensor. Los mismos endpoints con `LeagueID=10` (WNBA) devuelven **0 filas**: la NBA no
publica Synergy ni tracking de la WNBA por ahí. Para WNBA haría falta proveedor de pago.

**Corregido un error propio en la medida de calibración**: comprobaba si lo OBSERVADO caía dentro de su
propio intervalo — una tautología que devuelve "calibrado" siempre. Con el fallo, el modelo en vivo
parecía calibrado en 10 de 10 tramos; sin él, son 6 de 10.

**Lo que el blueprint pide y sigue sin construirse (y por qué):**
- **Tipos de jugada y tracking en WNBA**: sin fuente gratuita. Ver la tabla de costes en el informe.
- **Comparación con precios EN VIVO**: The Odds API no cubre en vivo en nuestro plan, y sin precio en vivo
  no hay CLV ni valor en vivo que medir. Es lo que falta para pasar de "informativo" a "completo".
- **Coordenadas de tiro reales**: ESPN las trae en `plays.coordinate` y ya se guardan; falta usarlas para
  el mapa de cancha del blueprint (248-249) en vez de las cinco zonas actuales.

**LO QUE FALTA AHORA (ya no es estructura):**
1. Acumular temporadas. Con una WNBA y dos NBA los priors son pobres y la validación no puede encender
   capas que probablemente sí valen. Cosechar 2022-2025 de las dos ligas es la palanca más grande.
2. Re-correr `hoops-validate.js` tras cada bloque de datos nuevo y dejar que el gating decida solo.
3. NCAA (noviembre): el dataset más grande y el mercado más blando.
4. Árbitros (faltas → totales) y modelo en vivo: los dos huecos de modelado que quedan.
5. Props contra precios reales: hoy se publica la distribución; falta cruzarla con las líneas de casas
   para medir si ahí sí hay ventaja, que es donde un modelo fino gana antes que en el ganador.

## 🏀 BALONCESTO 15-ago — 4º deporte, ADMIN-ONLY (pestaña abierta, picks apagadas)
- **Datos**: colector ESPN (`data-providers/basketball/espn.js`) — NBA, WNBA, NCAA M y F, gratis, con
  play-by-play completo (~450 jugadas/partido: coordenadas de tiro, 63 tipos de jugada y SUSTITUCIONES).
  Eso desbloquea quintetos, on/off, mapas de tiro y clutch **sin comprar un solo dato**.
  Derivación en `basketball-engine/possessions.js` → 12,6KB por partido en vez de ~1MB de crudo.
  **Cosechado: NBA 1.292 partidos + WNBA 275, cero fallos.** NCAA espera a noviembre (fuera de temporada).
  Dos cosas se MIDIERON, no se supusieron: el aro está en (25,1) —lo dicen 238 mates/bandejas— y los tiros
  libres se colaban como tiros de campo. Con ambas corregidas los tiros detectados cuadran con los FGA del
  box score al **0,00%**.
- **Motor** (`ratings.js` + `simulate.js`): ritmo × eficiencia ajustado por rival, no Elo. Monte Carlo con
  ruido de tres piezas (posesiones compartidas + shock de ambiente compartido + ruido propio), los tres
  sigma sacados de los residuos del ajuste. La ventaja de cancha se estima: 2,73 pts/100 en WNBA.
- **BACKTEST walk-forward** (`scripts/hoops-backtest.js`), 1.185 partidos evaluados en dos ligas:
  | | NBA | WNBA |
  |---|---|---|
  | Brier vs tasa base | 0.2056 / **skill +17,1%** | 0.2059 / **+15,0%** |
  | Acierto | 67,5% | 67,3% |
  | Cobertura banda 50% | **50,0%** | 55,6% |
  | Cobertura banda 90% | **87,1%** | 87,9% |
  | **vs cierre DraftKings** | **−0.0104** | **−0.0120** |
  Habilidad real contra la tasa base y **incertidumbre honesta** (cuando dice 90%, cae el 87%). Pero el
  mercado gana por ~1 punto de Brier en las dos ligas. **PICKS APAGADAS** hasta que ese número cambie de
  signo; el panel lo dice explícitamente. Falta meter lesiones, descanso, rotaciones y quintetos — ese es
  justo el hueco, y ahora hay vara para saber si cada módulo suma.
- **Producto**: pestaña 🏀 con sub-ligas (NBA/WNBA/NCAA M/F) + Game Intelligence Center: probabilidad con
  intervalo y confianza, marcador y posesiones proyectadas, curvas de margen y total, P(ganar por 1-5/6-10/
  11+), descomposición del porqué (la suma da el margen), GP contra el mercado, cuotas justas, matriz de
  explotación por zona, cancha con perfil de tiro, four factors enfrentados, plantillas con foto clickables
  y "lo que decide este partido" (generado de los números, sin LLM, para que sea auditable).
  Endpoints `/api/hoops/{state,game,team,player}`, gate admin (`GP_HOOPS_PUBLIC_ENABLED` para abrirlo).
- **Cuotas**: `hoopsQuotesSweep` con 8 claves (NBA, WNBA, NCAA M/F, EuroLeague, NBL, pretemporada, summer
  league) × h2h+spreads+totals al MISMO almacén que el fútbol → value/arbitraje/caídas/middles y la captura
  de profundidad las ven sin tocar esas superficies. Las claves fuera de temporada se activan solas.
- **B5 HECHO (15-ago)** — la pestaña quedó a paridad con fútbol y combate:
  - **Oportunidades** (`basketball-engine/markets.js`): value (line shopping contra el consenso sin margen),
    arbitraje de dos salidas, caídas de la línea afilada y middles. **Ninguna depende del modelo** — por eso
    se publican con las picks apagadas; el número del modelo va al lado como *GP Take*. Módulo PROPIO: el
    ganador de baloncesto es de dos salidas y de-vigar a tres (el loader de fútbol) infla la probabilidad
    justa y rompe el arbitraje. De paso, las superficies de fútbol dejaron de mezclar partidos de NBA.
  - **Partidos**: agenda real en vivo/próximos/finalizados del scoreboard de ESPN, con proyección por
    partido y el estado de temporada explicado cuando la liga está fuera de calendario.
  - **Rendimiento**: validación FUERA DE MUESTRA por ventana expandida (3 bloques, el rating se reajusta
    con lo anterior a cada bloque). Ojo con esto: la primera versión medía in-sample y daba skill **+0.007**
    —el modelo ya había visto los resultados—; bien medido da **−0.0079 ± 0.0067 (t = −1.18)** en WNBA,
    coherente con el backtest. Se publica con error estándar y t para que nadie encienda picks sobre ruido.
  - **Lectura GP por partido** (LLM, persistida ~$0.04 c/u), **parte de bajas** de ESPN, **brief de la
    jornada** y **Ask GP** con herramientas propias (agenda, partido, equipo, jugadoras, precios).
  - **Buscador** de baloncesto server-side (el dataset son 20MB, no viaja al cliente).
  - **Ficha de equipo** rehecha: colores del club, percentiles contra la liga, ADN de juego, canchas y forma.
  - Endpoints: `/api/hoops/{state,schedule,opps,game,read,team,player,brief,perf,search}`.
- **PENDIENTE**: el detector de garbage time sigue marcando el 64% — se arregla con quintetos. NCAA M/F
  esperan a noviembre. Enriquecimiento api-sports (ligas europeas) cuando suba ese plan.

## 💳 PLAN 5M 15-ago — la plataforma vuelve a respirar
- Clave nueva en Render, 5.000.000 de créditos. **Gastados hoy: 4.574 (0,09%).**
- Ocho frenos de escasez soltados: regiones 3→5, sweep 30→12min, eventos/liga 25→60, ventana de props
  144→240h, props 100→30min, Polymarket 30→60, AF por poll 6→20, pre-check 6h→2h.
- Resultado medido: **57.353 cuotas en un barrido · value 40 · caídas 30 · middles 40 (estaban en 0) ·
  arbitraje 108 con 14 ejecutables sobre 1.162 mercados escaneados · 7 casas con profundidad.**

## 🌍 COBERTURA TOTAL 13-ago (orden Alexis: "las quiero absolutamente todas") · construido, espera créditos
- **Estado del proveedor**: The Odds API en **0/500 créditos** (plan gratuito agotado) → plataforma ciega
  desde el 12-ago. **Alexis sube el plan (dijo: 5M calls)**; al volver créditos TODO lo de abajo arranca solo.
- **Capa 1 — copas con equipos ya modelados** (`CLUB_CUPS` + `clubsEnsureCups()` en server.js, EN MEMORIA —
  ratings.json no se toca): libertadores(118 equipos), sudamericana(118), leaguescup(49), eflcup(94),
  facup, dfbpokal(60), copadelrey, coppaitalia, coupefrance, uclq(351) + saudi/aleague (sin ratings, solo
  mercado) + odds_key cableada a los placeholders champions/europa/uefa(conference). Ratings COMPARTIDOS POR
  REFERENCIA (Elo dinámico global por equipo → cero drift). Entran a: sweep de cuotas, props, value board,
  pipeline de picks (gate 'shadow' — la disciplina decide qué se publica), contexto AF (`CLUB_AF_LEAGUE`) y
  LIQUIDACIÓN vía ESPN (`CLUB_ESPN`, 12 slugs verificados el 13-ago).
- **Capa 2 — AUTO, todo lo demás que cotice** (`clubsAutoLeagues()`): catálogo /v4/sports (gratis, cache 12h)
  → toda clave soccer activa NO configurada entra al sweep sin ratings (Saudi, femenino, Nations League, lo
  que el proveedor active mañana — p.ej. FA Cup/UCL/UEL/Copa del Rey hoy inactivas, entran solas al activarse).
  Superficies de mercado completas (cuotas SSR, bet checker, caídas, middles, arb, Cloudbet); value/picks NO
  (sin modelo). Off: `GP_QUOTES_ALL_SOCCER=false`.
- **Control de gasto**: pre-check GRATIS de agenda por clave (/events, cache 6h) → sin partidos en 72h no se
  paga el /odds. Reserva de créditos y cadencias existentes intactas.
- **Límites honestos del proveedor** (no es infra nuestra): The Odds API NO tiene amistosos (PSG–Madrid del
  12-ago no existe ahí — cubierto vía ESPN/`amistosos`), ni ligas menores tipo Islandia 4ª/Calcuta (los 167
  de BetHero salen de un proveedor de otra categoría de precio). 67 claves soccer es el techo actual.
- **HECHO 13-ago tarde**: fit Elo vía API-Football (`scripts/clubs-af-onboard.js`, pipeline reusable) —
  **saudi APPROVED 1X2** (612 partidos, Brier 0.5615) y **aleague shadow** (339, liga pareja). 37 escudos
  tm_af* en public/logos. Nations queda solo-mercado (selecciones ≠ engine de clubes).
- **⚠️ TSA EN LÍMITE MENSUAL (13-ago)**: `USAGE_LIMIT_EXCEEDED` → este mes NO corren: próximos por liga del
  Partidos (TSA fixtures), data pass de player-history (percentiles/scout), plantillas TSA. Decisión de
  Alexis: subir plan TSA **o** (mejor, ya tenemos AF Ultra 75k/día) migrar esas capas a API-Football.
- **HECHO 13-ago noche (paridad AF, parte 1)**: fallback AF de PRÓXIMOS en /api/clubs/state (todas las
  ligas con id en CLUB_AF_LEAGUE, copas incluidas; máx 6 fetches AF por poll, memo 6h) + plantillas AF en
  /api/clubs/squad para equipos tm_af* (con foto y dorsal, cache 24h). Memo v2 ya NO revela pick ni valor
  a quien su plan no los incluye (regla Alexis: el memo es inteligencia, la pick se paga).
- **HECHO 13-ago noche (paridad AF, parte 2 COMPLETA)**: `clubAfIdOf()` universal (tm_af embebido → mapa →
  cross-liga para copas) destapa contexto/alineaciones/eventos de TODA liga nueva; bajas sin filtro de liga
  (copas). Data pass AF (`scripts/clubs-af-datapass.js` + `clubs-af-photos.js`) subido al disco de prod:
  saudi 9.185 filas jugador-partido, aleague 5.036, libertadores 1.235, sudamericana 1.485, leaguescup
  1.499 + 2.603 fotos (player-photos 15.540). Verificado en prod: NEOM–Al-Fayha con XI proyectado del fit
  AF (pids afp clickeables), forma/H2H/xG/intel de goleadores; Rosario Central–Corinthians (Libertadores)
  con 8 bajas reales de Corinthians por nombre y XI de 11. Perfiles /api/clubs/player sirven pids afp*.
  Copas: cobertura parcial de equipos sin mapa AF (ecuatorianos/peruanos etc.) — se completa cuando el
  data pass diario les cree entradas. Lecturas del sistema (picks) llegan solas con el upgrade de créditos.

## 📏 PROFUNDIDAD 15-ago — cuánto dinero entra de verdad a cada precio (base para dimensionar y repartir capital)
- **Qué faltaba**: guardábamos el precio pero no la capacidad. `max_stake` iba en null → una oportunidad de
  $50 y una de $5.000 se veían iguales. Sin esto no se puede dimensionar una apuesta ni repartir bankroll.
- **Definición**: `max_stake` = USD colocables a un precio no peor que `GP_DEPTH_TOL_PCT` (2%) del mejor.
  Fuente etiquetada en `depth_src`: `cloudbet_max` (tope de la casa, exacto) · `kalshi_book` (contratos en
  el mejor ask × precio, exacto y conservador) · `polymarket_book` (libro CLOB acumulado, exacto) ·
  `myriad_amm` (**estimación**: no hay libro sino pool; en un CPMM el stake que mueve el precio ~tol es
  ≈ tol·L·p·(1−p) — no vale lo mismo que un libro real al repartir capital).
- **CAPACIDAD MEDIDA (15-ago, mediana / máx por apuesta)**:
  | casa | familia | mediana | máx |
  |---|---|---|---|
  | cloudbet | **cards_total** | **$223** | $312 |
  | cloudbet | corners_total | $237 | $237 |
  | cloudbet | match_total (goles) | $412 | $3.001 |
  | cloudbet | match_winner | $302 | $384 |
  | kalshi | match_winner | $338 | $41.924 |
  | polymarket | match_winner | $1.008 | $22.057 |
  | myriad *(aprox)* | match_winner | $1.827 | $2.500 |
- **Lo que dice el dato para el plan de reparto de capital**: en **1X2** los cuatro venues suman **~$3.475
  por partido** (kalshi+poly+myriad+cloudbet) — bastante más que el ejemplo de $400. En **cards under NO
  hay reparto posible**: solo cotiza Cloudbet y el techo es ~$223 por apuesta. La familia candidata es
  también la de menor capacidad.
- Migración 044 (`max_stake`, `depth_src`) + **`/api/internal/migrate`** (GET estado, POST aplica) porque el
  runner es manual y la base no es alcanzable desde fuera de Render. `upsertGoalQuote` detecta las columnas
  una vez y cae al INSERT viejo si aún no están (nunca tumba las escrituras de precios).
- Capacidad por casa/familia en `/api/internal/venues`.
- **Ojo al leer arbitraje**: `arb_executable` bajó a 0 porque ahora las patas mezclan frescuras distintas y
  el gate `stale` (desfase entre patas) las descarta — es el comportamiento honesto, converge según corren
  los barridos de 15min. Pendiente menor: `loadClubsMarkets` marca `venue_kind:'sportsbook'` también para
  kalshi/polymarket/myriad (son mercados de predicción); hoy no molesta porque su profundidad ya es real.

## 🔌 VENUES GRATIS 15-ago — Myriad y Kalshi por fin cotizan (la plataforma deja de depender de un solo proveedor)
- **Diagnóstico**: The Odds API sigue en **0/500** (el plan NUNCA se subió; el panel
  `/api/internal/sportsbook/status` reporta 91.242 restantes y MIENTE — números viejos con fecha fresca,
  **bug de ops pendiente de arreglar**). Con eso, la profundidad real era: de 182 picks activas, **157 con
  cero casas y 25 con una. Ninguna con dos** → arbitraje y middles imposibles por aritmética, no por código.
- **MYRIAD** pedía los mercados equivocados: `keyword=vs&sort=volume_24h` sin filtrar estado, y el volumen
  histórico lo dominan los YA RESUELTOS → las 60 filas volvían todas 'resolved' y el filtro las tiraba.
  Nunca cotizó una sola vez. Con `state=open`: 7 partidos con 1X2 completo y 500k de liquidez.
- **KALSHI**, dos fallas encadenadas: (a) la lista de series era manual y `GP_KALSHI_SERIES` nunca se
  configuró → el barrido salía en la primera línea; ahora se DESCUBREN del catálogo (`KX<LIGA>GAME`,
  **99 series de fútbol**, cache 12h, env sigue como override); (b) la API migró a precios en dólares
  string (`yes_ask_dollars`) y leíamos el entero en centavos (`yes_ask`, hoy undefined) → el gate mataba
  todas las patas. Se leen ambas formas. Match por las PATAS (cada una trae su equipo), no por el título.
- **TABLERO DE VALOR** pedía cuotas a The Odds API EN VIVO dentro del handler y nunca miraba
  `sportsbook_goal_quote_current` — por eso caídas y middles sobrevivían y valor no. Añadida 2ª fuente
  desde el almacén (umbral 2 casas, filas marcadas `src:'venues'`). Con créditos no cambia nada.
- **ESCÁNER DE ARBITRAJE**: `loadClubsMarkets` filtraba `data_provider = $1` (un solo proveedor) — arbitrar
  es comparar VARIOS. Ahora entran los cinco. El gate de `≥6 cuotas` por 1X2 (2 casas completas) se respeta.
- **Resultado medido**: 817 cuotas escritas (kalshi 690 · polymarket 63 · cloudbet 49 · myriad 15) ·
  **256 mercados escaneados · 7 arbitrajes (3 ejecutables)** · tablero de valor **40 filas** · caídas vivas.
  Verificado a mano que el cruce no está mal casado (Santander–Villarreal: Kalshi 0.30/0.45/0.27 vs Myriad
  0.163/0.180/0.657 — divergencia real entre venues, ambos el mismo partido del 16-ago).
- **Límites honestos**: los arbs son de mercados de predicción → tamaño limitado por liquidez on-chain y
  profundidad del libro, y **no capturamos `max_stake`** de estos venues (las patas van con depth null).
  **MIDDLES siguen en 0** y seguirán: necesitan totales over/under de 2+ casas y los mercados de predicción
  solo cotizan 1X2. Se llenan cuando vuelvan los créditos o entre otra casa con totales.
- Operación: `GET/POST /api/internal/venues?key=…` (`?dry=1` ensaya sin escribir, `?only=<venue>`).
- **Frenos de emergencia BORRADOS de Render** (`GP_CLUBS_SWEEP_MIN`, `GP_CLUBS_PROPS_WINDOW_H`,
  `SPORTSBOOK_QUOTA_RESERVE`): vuelven a sus defaults (30min / 144h / 2000) para cuando entren créditos.

## 🥊 BOXEO — RESULTADOS AUTOMÁTICOS 14-ago (el panel "Finalizados" ya se llena solo)
- **Qué estaba roto**: el panel de Finalizados de boxeo estaba SIEMPRE vacío. UFC/MMA se nutren del
  scoreboard de ESPN y **ESPN no tiene boxeo** (re-verificado 14-ago: sport `boxing` → 400 "Invalid sport");
  la única vía automática que quedaba era el `/scores` de The Odds API, que vive de créditos agotados. O sea:
  una pelea de boxeo nunca pasaba a "disputada".
- **Cómo se resolvió**: `combat-engine/boxing-results.js` — versión EN VIVO del parser de Wikipedia que ya
  construyó todo el histórico de boxeo (tabla "Professional record": resultado, rival, método, round, fecha;
  se actualiza en horas). Tres piezas en server.js: `boxingPendingTrack()` anota cada pelea de la agenda
  (hace falta porque el feed de cuotas la borra en cuanto ocurre), `boxingResultsSync()` pasa cada 30min por
  las que ya terminaron (+4h de gracia) y pregunta, y el merge en `combatLoad()` mete lo resuelto en `C.own`
  **y en el pool** (si no, el panel enlazaría a un 404 al abrir la pelea).
- **Nunca inventa**: fila única con rival que matchea y fecha ±3 días, o no resuelve. Backoff 40min las
  primeras 4 tentativas y 3h después; a los 30 días se abandona. Cachea el título de Wikipedia por boxeador
  (incluido el "no existe") para no pagar la búsqueda cada ciclo.
- **Bonus**: liquida picks de boxeo **sin gastar un crédito** y con método+round, así que también cierran
  METHOD y ROUNDS (con `/scores` —marcador pelado— era imposible). Arreglado de paso: ROUNDS usaba rounds de
  5 minutos (MMA) para liquidar boxeo, que son de 3.
- **Operación**: `GET/POST /api/internal/boxing-results?key=$GP_EXPORT_KEY` (POST fuerza, `&max=`, `&grace_h=`).
  Apagable con `GP_BOXING_RESULTS=false`. Corre fuera del gate de picks (es producto, no monitor).
  Arranca con las carteleras del 15/16-ago en adelante — antes de eso no hay nada anotado.

## 🥊 R6 COMBATE 12-ago — profundidad (orden Alexis) · VEREDICTO DEL BACKTEST
- **Interacciones de matchup** (grap/power/absorb/age5/subth) construidas en `combat-engine/ratings.js` y
  backtesteadas PAREADAS (`scripts/combat-backtest-v2.js`, único harness que alimenta las stats finas):
  UFC n=5,842 OOS + MMA n=2,752 → **Brier idéntico (0.2332)**, bootstrap P mejor caso 0.773 (+absorb) vs
  gate de la casa 0.983. El modelo lineal ya extrae esa señal por los marginales; la muestra fina (2022+,
  2.199 peleas) es chica para cruces. **NO se shippean** → quedan tras `COMBAT_X_FEATURES=true` (default
  OFF, byte-idéntico). RE-TESTEAR en ~2 meses cuando la muestra fina crezca (crece ~50 peleas/mes).
- **Profundidad que SÍ shippeó**: redactor PROFUNDO de combate (`llm.writeFightRead` + `combatPickDossier`)
  — cada pick FIGHT recibe lectura de élite (tesis + camino de victoria + riesgo + invalidación + valor)
  anclada al dossier completo (breakdown, film study, estilos, tale, señales, método, mercado). Las activas
  se regeneran una vez (migración `cbDeepReadV1`). La probabilidad NO la toca (doctrina LLM intacta).
- Bonus del análisis Makhachev-Garry: el patrón "campeón que subió gana la subida y pierde la 1ª defensa"
  (Ilia/Khamzat 2026) medido en nuestra base: subir de división NO penaliza en agregado (racheados subiendo
  60.5% vs 58.1% sin subir, n=81/3,256) — sigue siendo INTEL/narrativa, no feature (confirma decisión 28-jul).

## 🚨 INCIDENTE 12-ago — SOLID (1X2) y CARDS sin nacer (diagnóstico completo, fix en código)
Reporte de Alexis: "sacaste la familia de 1x2 y la de cards under". NO fue un cambio de código — dos fallas operativas:
1. **Postgres ahogado** → la query 1X2/goles del build de picks de clubes moría por statement timeout (15s) en
   silencio (`catch → []`) desde el ~5-ago (alta de las 9 ligas): `sportsbook_goal_quote_current` sin poda con
   ~46k upserts/40min. Resultado: **ninguna SOLID ni GOALS de clubes creada desde el 3-ago** (córners/cards
   sobrevivían por su query propia — fix del 5-ago). Fix en código: query por lotes + filtro 24h + error visible
   (`market-scanner/quotes.js`) y retención `goal_current` (7 días) cableada con flags + endpoint
   `/api/internal/goal-retention?key=<GP_EXPORT_KEY>`.
   **Purga ACTIVADA 12-ago** (`SPORTSBOOK_RETENTION_ENABLED=true`, `DRY_RUN=false` en Render). Medido:
   la tabla tenía **14.67M filas / 6.6GB**. El primer intento murió por el mismo timeout global (seq scan
   sin índice) → fix: índice por `observed_at` (IF NOT EXISTS) + cada lote en SU transacción con
   `SET LOCAL statement_timeout` amplio (el global de 15s sigue protegiendo al resto de la app).
2. **The Odds API sin créditos**: de 11.410 (10-ago) a ~575 (12-ago 09:36); con reserva 2000/6000 los sweeps
   estaban PAUSADOS → sin cuotas frescas no nace ninguna familia. **Decisión Alexis 12-ago: upgrade del plan
   mañana; mientras, correr con el remanente.** Aplicado en Render: `SPORTSBOOK_QUOTA_RESERVE=50` (props frena
   a 3×=150), `GP_CLUBS_PROPS_WINDOW_H=48`, `GP_CLUBS_SWEEP_MIN=120`. ⚠️ TRAS EL UPGRADE: borrar
   `SPORTSBOOK_QUOTA_RESERVE`, `GP_CLUBS_PROPS_WINDOW_H` y `GP_CLUBS_SWEEP_MIN` para volver a los defaults
   (reserva 2000/6000, ventana 144h, cadencia 30min). Nuevo WATCHDOG horario: si los créditos caen bajo la
   reserva o hay partidos en <24h con cero mercados 1X2 en el build → email al admin (dedup 1/día).
   Nota: `cardsValidation` está SANA (p=0.121, no failed). El stop-loss del feed público SÍ tiene frenadas
   `SOLID|anchor` (hit 37% vs BE 56%), `SOLID|lead` (20% vs 23%) y `CORNERS|under` — eso es por diseño (autopsias).

## ✅ CHECKPOINT jun-20-2026 — TODO desplegado en prod (main, ~389 usuarios)
Hecho esta sesión (ver memoria `gp-simulador-mundial.md` para detalle):
- Fase 4 completa + **GLOBAL TERMINAL POLISH** (dark terminal premium).
- **API-Football Pro ACTIVO** (env `API_FOOTBALL_KEY` en Render; resolución de fixture/equipos por lista oficial de fixtures).
- **Calibración** del 1X2 (atenuación λ=0.15, Brier 0.669→~0.62). Modelo v2 EN ESPERA (muestra chica; post-Mundial).
- Intervalos rápidos (ESPN 30s, mercados 60s). Auto-refresco de página de partido en vivo.
- **Alertas de gol + inicio** por email (no solo final). GP Take usa lesiones (Opción C).
- **Telegram ACTIVO** (canal @gpsimulador; auto-publica diario/oportunidades/finales; envs `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHANNEL`).
- **Referidos** (niveles Embajador, sin promesa de pago) + **email masivo** `/api/admin/broadcast`.
- **Buscador de equipos**, **Partidos** con EN VIVO/PRÓXIMOS arriba, **Sandbox "Simula cualquier cruce"** (`/api/h2h`).
- Login robusto (sin candado en Oportunidades) + **cache-busting** (`?v=mtime`) + botón "Entrar" + inputs 16px.
- Pipeline de contenido (PNGs en `/ig/`, render Chrome headless de a uno). Investigación de mercado hecha.

## 🧠 v2 PILOTO — "GP Intelligence" (jun-21, SOLO en el sandbox "Simula cualquier cruce")
Prueba de cómo se vería la v2 desplegada a futuro, **contenida al sandbox** (no toca el resto de la plataforma: seguimos sin desplegar v2 global hasta tener más muestra para calibrar).
- **Backend**: `engine.js` → `simulateH2H(eloA,eloB,N)` (Monte Carlo dedicado del cruce: distribución de marcadores, over/under 2.5, BTTS, goles totales, margen). Nuevo módulo `data-providers/gpIntelligence.js` (`contextSignals` → Δ Elo acotado a ±55 = ELO_NOISE, desde forma/racha/bajas/solidez reales; `buildH2HAnalysis` → análisis determinístico). Endpoint `/api/h2h/deep?a=&b=` (login req.): base `matchProbs` (prior) → `getTeamContext` de ambos → Δ contexto por lado → v2 = `matchProbs(elo+Δ)` → Monte Carlo v2 → análisis. Caché en memoria 10 min por par. `/api/h2h` viejo intacto.
- **Frontend** (`app.js` `simulate()`): el resultado del sandbox **ya es v2** (headline con Δ Elo por contexto + descomposición "base → GP Intelligence"). Botón **"🧠 Ver análisis GP Intelligence"** despliega panel integral (mismo lenguaje `dpanel` que la página de partido): Veredicto, Cómo se construye (barras base vs v2 + Δ trazables), Factores que pesan (forma/racha/bajas/solidez con ↑/↓ y peso Elo), Monte Carlo 10.000 (distribución de marcadores + over/btts/goles/margen), Lectura táctica (style+fortalezas/riesgos), Factores X + Qué cambiaría. CSS `gpi-*` en `style.css`.
- **Principio clave**: cada punto de Elo movido es **trazable a una señal mostrada** (no caja negra, no texto genérico tipo ChatGPT). Determinístico, sin IA externa.
- **UPGRADE jun-21 (marco de analista pro)**: tras feedback del usuario (un buen análisis toma en cuenta TODO). (1) **xG ESPECÍFICO POR EQUIPO**: `engine.probsFromLambdas`/`lambdas` exportados; `gpIntelligence.adjustedLambdas` combina el xG-Elo con perfil ataque/defensa real (forma, β=0.40) → resuelve el "marcador máximo 2-0" (ahora proyecta 3-0/4-0 cuando corresponde). (2) **Mercados de goles/totales** (panel "Goles y totales"): Over/Under 1.5/2.5/3.5, total más probable, **distribución de goles por equipo** (0/1/2/3+), BTTS — accionable para apostadores. (3) **Bajas ponderadas por jugador clave** (cruza `keyPlayers`×`injuries`: clave=-15, normal=-7, duda=-3/-6). (4) **Calidad de plantilla** (`providers.getSquadRating` = rating medio del XI más usado, temporada, vía `getTeamPlayers`). (5) **Descanso/carga** (`restDaysFromResults` desde fechas de resultados). (6) Monte Carlo etiquetado "contexto integrado" (siempre usó Elo+Δ). (7) TTLs endurecidos para Mundial: forma 16h→2h, lesiones 40min→20min. Verificado en preview con datos reales (FRA-ENG, BRA-QAT: Brasil 58% de 3+ goles). **PENDIENTE: desplegar a prod** (commit hecho; falta Manual Deploy).

## 🟢 SPRINT 4 — Oportunidades ejecutables (capa de producto) — CONSTRUIDO, STOP antes de deploy (jun-21-2026)
Carpeta `exec-opportunities/` + migración 012 + endpoints `server.js` + pestaña "Ejecutables" (`#tab-opex`).
Publicación CONTROLADA (draft→approve→publish→revalidate→expire/withdraw), auditada, **sin auto-publicación**
(`autoPublicationBlocked=true` siempre). Calculadora server-side (no guarda capital), deep links versionados
(allowlist+HTTPS), jurisdicción informativa (selector manual de país), redacción por lista blanca.
- **Flags** (todos default false): `EXEC_OPPORTUNITIES_{UI,ADMIN_PREVIEW,PUBLIC,MANUAL_PUBLICATION,CALCULATOR,DEEP_LINKS,GEO_FILTER}_ENABLED` + umbrales `EXEC_PUBLIC_*` (conservadores). Con todo off → app idéntica, sin rutas nuevas.
- **Tests verdes**: `test:exec` 65, `test:optimizer` 6, `test:exec-db` 23 (embedded-postgres). 0 regresiones. UI verificada en preview móvil (0 errores consola).
- **Docs**: `docs/sprint-4-*.md` (10). **NO desplegado, NO commit, NO push.**
- **Pendiente del usuario para producción**: (1) activar Sprint 2 y luego Sprint 3 en Render (siguen apagados) para que el motor tenga candidatos reales; (2) aprobar deploy de Sprint 4; (3) subir flags por fase: inerte→admin preview→publicaciones internas→beta→público. Público SOLO tras ≥24h shadow + 0 falsos Pure Arb materiales.

## ⏭️ PRÓXIMOS PASOS (en orden, para la siguiente sesión)
0. 🔌 **Activar Sprint 2 (Canonical Graph) y luego Sprint 3 (motor)** en Render — prerequisito para datos reales de arbitraje que Sprint 4 publicaría. Sprint 1 ya está activo (Postgres creado jun-21).
1. 🔑 **ROTAR la API key de API-Football** (quedó expuesta en chat) → regenerar en api-sports.io + actualizar `API_FOOTBALL_KEY` en Render.
2. **Monetización: afiliados RevShare** (monetiza usuarios gratis ya, financia crecimiento; encaja con sitio de contenido/comparación) + **test de disposición a pagar** (la de LATAM NO está probada).
3. **Expansión multideporte** (existencial post-Mundial — sin esto somos "novedad del Mundial"). NFL en septiembre.
4. Opcional: backup automático diario de `db.json` al email admin; share-imagen del sandbox; props/córners; automatizar el contenido diario; Modelo v2 (señales de contexto) con más muestra.

---
(Histórico) Checkpoint tras Fase 5 del rediseño.

## Rediseño UI — estado por fase
- ✅ **Fase 1** AppShell premium (header, market tape, bottom nav, avatar menu, logged-out).
- ✅ **Fase 2** Home Oportunidades terminal (mejor oportunidad, arbitraje, valor, GP Take, favoritos).
- ✅ **Fase 3** Alertas (pantalla dedicada) + Seguidos rediseñado.
- ✅ **Fase 5** Grupos (heatmap), Bracket (escalonado), Aciertos (analítico+Brier), Evolución (chart dark+tabla).
- ✅ **Fase 4** Páginas profundas de PARTIDO y EQUIPO + capa de datos modular (API-Football principal → ESPN → manual, providers+cache+normalizer server-side en `data-providers/`). Endpoints `/api/match/:id` y `/api/teamdetail/:id` (data normalizada). Navegación desde Partidos/Equipos/Grupos/Bracket/Seguidos/Oportunidades. GP Take determinístico, ángulos de mercado, alineaciones, forma, eventos/stats, lesiones, noticias, mercados, con fallbacks elegantes. **Falta por completar (no bloqueante):** poner `API_FOOTBALL_KEY` en Render para activar la fuente principal; llenar `data/manual/*.json` (jugadores clave, XI, lesiones, notas) para más equipos. Pendiente real: **GLOBAL TERMINAL POLISH PASS** (rediseño visual final de estas vistas).

## PRÓXIMO GRANDE: Fase 4 + Datos de equipo (la construcción que falta de la lista original del usuario)
La Fase 4 depende de construir primero la **feature de datos de equipo** (no existe aún):
- **Página de partido pro**: Match Hero, tabs (GP Take / Análisis / Eventos / Cuotas / Alineaciones), GP Take card de analista, "mejores ángulos", eventos en vivo (posesión/tiros/corners), **alineaciones** (XI probable), forma reciente, best odds.
- **Página de equipo pro**: hero con seguir, tabs (Resumen / Plantilla / Forma / Resultados / Noticias / Mercados). Reemplazar el párrafo largo actual de `openTeam` por "Model read" + bullets (key drivers, risks, next checkpoint).
- **Fuente de datos investigada:** API-Football (api-sports.io) tiene alineaciones/plantilla/forma; tier gratis limitado (~100 req/día, solo testing). xG real es de pago (Sportmonks ~€78/mo, TheStatsAPI). The Odds API = cuotas multideporte 1 suscripción. Decisión pendiente del usuario sobre gastar en data (recomendado: no gastar hasta empezar a cobrar; validar Brier vs mercado primero).
- Alineaciones gratis alternativa: extraer el XI que publican ~1h antes (scraping/feed) y cachear; mostrar al hacer click en el partido.

## Mejoras de modelo / datos (de sesiones previas)
- **Marcador "Modelo vs Mercado"**: ya instrumentado (`scoreboard` en /api/aciertos, captura closing line por partido en `db.marketSnapshots`). Empezó tarde → necesita ~3-4 semanas de partidos para veredicto de si le ganamos al mercado. NO cobrar hasta tener esta prueba.
- **Calibración de torneo (% campeón) sobreconcentrada**: decisión actual = NO tocar (no validable este torneo, n=1; usuario no quiere copiar a Opta). Si se retoma: subir `ELO_NOISE` (~120-150) y/o regresión a la media; medir contra Brier, no contra Opta.
- **Señales gratis para el modelo** (de las 5 propuestas): forma ya está implícita en Elo; descanso/motivación marginales; xG e injuries son de pago. Recomendación: no agregar señales marginales sin que mejoren el Brier medido.

## Crecimiento / negocio (pendientes)
- Persistencia/backup de la base de usuarios: el disco de Render ya evita pérdidas, pero falta export diario automático al email del admin como seguro.
- Telegram bot de alertas (canal): alto valor para esta audiencia, no construido (UI dice "próximamente").
- Canales Telegram/Push: backend no implementado (solo UI/estado preparado en alertPrefs.channels).
- Pantalla de "lista de espera Pro" / pricing hacia fin de Mundial para validar disposición a pagar.
- Segundo deporte (NFL en septiembre) para el "precipicio post-Mundial".
- Contenido de redes: hay plantillas en `public/ig/` + `ig-src/`; generar diario (post/story/X) con datos reales del día. Captions y tono "transparencia" definidos.

## Bugs conocidos / riesgos
- **Cuota de email**: Resend Pro 50k/mes (suficiente). Si se rompe, fallback a relay GAS (~100/día). Vigilar en olas de registro.
- **db.json efímero si falla el disco**: usuarios/favoritos se perderían (resultados se auto-recuperan de ESPN). Mitigación: export CSV manual frecuente; pendiente backup automático.
- **Autodeploy de Render a veces no dispara** → forzar por API (ver CLAUDE.md). Primer request tras deploy puede dar 502 unos segundos.
- **SSE no atraviesa algunos proxies** → ya hay fallback a polling cada 10s.
- **`matchProbs` aplica Dixon-Coles pero el Monte Carlo (simMatch) no** — inconsistencia menor conocida; el % de campeón usa solo el piso de goles, no DC.
- **Página Partidos y modal de equipo** siguen con diseño/copys viejos (texto largo) → Fase 4.
- Al desarrollar: `rm -f db.json` SOLO en local; jamás en prod. Probar en preview antes de push.

## Reglas de producto a recordar (ver CLAUDE.md)
- Nombre = "GP Simulador" (nunca GP Edge).
- No recomendar longshots (<30% prob) ni apostar contra el favorito del modelo.
- Login obligatorio salvo teaser top-6.
- Español, mobile-first, sin consejo financiero.

## ═══ SESIÓN 12-AGO (noche) — estado guardado para la próxima sesión ═══

### HECHO Y DESPLEGADO HOY (commits 5fb7f8c → 5bb4ef2+)
- **Punto 3 EJECUTADO — combate por planes** (efectivo desde las 20:00 UTC, cuando venció la ventana gratis):
  free = toda la inteligencia (agenda/fichas/cockpit/vivo/mapa/rendimiento) + 1 pick GANADOR liberada 60min
  antes + candado con conteo; pro = feed completo GANADOR + brief/slate/parlay + Ask; sharp = value/arb/
  movimiento de línea + MÉTODO/ROUNDS. Server: cbPlan en /api/combat/* (admin previsualiza ?asplan=free|pro|sharp,
  también vía chips de Mi suscripción). UI: teasers/lockpanels reutilizando la gramática de fútbol. /plans
  (founder.html) actualizado ES+EN con features de combate + FAQs. VERIFICADO en vivo con asplan.
- **Punto 1 — lectura profunda en el cockpit de la PELEA**: llm.writeFightPreview + combatFightDossier +
  llmFightReadsPass (cada 30min, 1 vez por pelea, poda 7d) + gp_read servido desde db.combatFightReads.
  Forzar pase: POST /api/internal/llm?key=<GP_EXPORT_KEY>&run=fightreads&cap=6
  ✅ CERRADO (misma noche): la causa NO era el prompt — combatFightDossier y combatPickDossier usaban CE
  sin require (no hay CE global en server.js), el ReferenceError moría en el catch mudo y el redactor
  recibía un dossier casi vacío → rellenaba con su prior. Fix (commit 15de5fc): require en ambos + catch
  con console.error + migración cbFightReadV3 (limpió lecturas de pelea y why profundos de picks FIGHT).
  Regenerado y VERIFICADO: la lectura de Makhachev-Garry defiende a Garry con los números reales del
  dossier (8.93 vs 4.5 golpes/min, alcance 74.5" vs 70.5", derribo temprano como señal de alarma), y 7/8
  why de picks regenerados (el 8º, Wes Schultz, sale solo con el pase de 30 min cuando el presupuesto LLM
  diario resetee a medianoche UTC — hoy se gastaron los $10).
- **Bonus — capa de contexto**: CLUB_AF_LEAGUE cubría 24 de 40 ligas; se agregaron las 16 de la expansión
  + uefa (531) + amistosos (667). af-team-map.json en disco (+PSG 85, Villa 66, Madrid 541, Depor 544) —
  VERIFICADO: PSG-Villa fixture 1583664 con stats en vivo; Madrid-Depor 1591931. Herramientas nuevas:
  /api/internal/af-team-search?key=&q= y /api/internal/clubs-data?key=&name= (descarga).
- **Punto 4 (foundation)**: CLUB_ESPN += champions/europa + stubs en ratings.json. Lo pesado (roster con
  Elo anclado CROSS-LIGA + backtest 1X2 antes de publicar prob/picks) es proyecto de fin de agosto: las
  keys de The Odds API se activan en septiembre y la fase liga arranca a mediados de sept.
- **Fix lectura-vs-pick**: prompt writeFightPreview PROHÍBE contradecir favorito_gp (pendiente de validar, ver arriba).

### EMAIL MASIVO COMBATE — PREPARADO, NO ENVIADO (Alexis da el GO)
- Variants: gpcombat2_es / gpcombat2_en (server.js gpCombat2Email). Imagen: gpsimulador.com/ig/combat-intel-email.png (+-en).
- ⚠️ DECISIÓN EDITORIAL: el pedido original era "acertamos la mayoría de las picks" pero el track público
  dice 26W-40L (-3.03u, 39.4%) y cualquier usuario puede abrir Rendimiento. El email preparado vende
  PROFUNDIDAD + TRANSPARENCIA (track auditable) + Makhachev-Garry como demo del sistema contra el consenso
  + features por plan + sin aumento de precio. NO afirma récord ganador. Si Alexis insiste en el claim del
  récord, mostrarle los números primero.
- ENVIAR (cuando dé el go): verificar conteo → POST /api/admin/broadcast?key=<GP_EXPORT_KEY> body {"variant":"gpcombat2_es","count":true}
  → disparar ES: body {"variant":"gpcombat2_es"} → agendar EN +6h: body {"variant":"gpcombat2_en","schedule_at":"<ISO +6h>"}
- Probar antes con {"variant":"gpcombat2_es","test":true} (va solo al admin) si se quiere ver en bandeja.

### PENDIENTES QUE SIGUEN
- Punto 4 completo: anclaje cross-liga + backtest (antes de sept).
- Auditoría de identidad de fotos wiki (más homónimos tipo Ernesto Mercado).
- Post-upgrade Odds API: borrar envs temporales (SPORTSBOOK_QUOTA_RESERVE, GP_CLUBS_PROPS_WINDOW_H,
  GP_CLUBS_SWEEP_MIN, GP_GATE_OVERRIDE_SEGMENTS) y rotar API_FOOTBALL_KEY.
- Alexis revisará todos los números de picks después del fin de semana.

### PROMPT PARA ABRIR SESIÓN NUEVA (móvil)
> Continúa GP Simulador. Lee CLAUDE.md y la sección "SESIÓN 12-AGO (noche)" de TODO_NEXT.md.
> Pendiente inmediato: (1) cerrar el sesgo del redactor de lecturas de pelea (run=dossier / run=fightread1,
> caso Makhachev-Garry debe defender a Garry); (2) el email gpcombat2 está listo — yo doy el go para ES y
> la versión EN se agenda 6h después; (3) seguir con el anclaje cross-liga de Champions/Europa.
> Token admin: pedírmelo si no está en scratchpad. RENDER_API_KEY: pedírmela.

## ═══ PLAN EDGE + EJECUTOR EN LA SOMBRA (12-ago, decisión de Alexis — MEMORIA PERMANENTE) ═══

### La tesis (guardada a pedido de Alexis)
1. **Hoy NO hay edge global** (376 picks clubes: ROI -10%; combate 66: -3u). Dos vetas candidatas con datos:
   **cards-under** (n=56, ROI +15% AL CIERRE, positiva en ambas mitades temporales, pasó el z-test vs base-rate)
   y **combate ROUNDS** (n=23, +2.4u, única familia con CLV+ +4.9%). Ninguna "verificada" aún: el estándar es
   **300+ picks con regla congelada ex-ante, positivas al precio de cierre**.
2. **Explotación (como apostador, no plataforma)**: venues que no limitan ganadores — exchanges (Betfair),
   mercados de predicción (Polymarket/Kalshi: solo mercados tipo GANADOR de eventos grandes; NO listan props),
   y cripto books (Cloudbet: props de fútbol + método/rounds MMA; ya integrado como fuente de cuotas, partner
   comercial). Regla dura: NADA de multicuentas/evasión de cierres — el stack funciona porque no lo necesita.
3. **Números objetivo** ($5k/mes): con solo cards ≈ stake $830/apuesta (choca con límites de mercado) →
   escenario sano = PORTAFOLIO de 3-4 familias verificadas, ~200 apuestas/mes, stake ~$420, bankroll $35-42k
   (1-1.25%/apuesta, 100 unidades). Se llega COMPONIENDO desde chico, no depositando $40k el día 1.
4. **Multi-deporte** (plan Alexis): NBA → béisbol → tenis → esports. Cada deporte paga su ciclo completo
   (data → backtest gate → monitor → 300 congeladas). Expectativa honesta: de 6 deportes sobreviven 3-4 familias.

### EJECUTOR EN LA SOMBRA (corriendo desde 12-ago)
- **Qué es**: paper-trading en server.js (shadowSweep/shadowSummary/shadowWeeklyReport, db.shadow en el disco
  persistente). Bankroll simulado **$2,000**. Segmento v1: `cards_under_v1` (toda CARDS under publicada, entrada
  al precio de publicación, stake Kelly/4 con techo 1.5% del bankroll vivo, piso $5). Liquida espejo del track
  real (VOID=push), compone el bankroll, captura closing/CLV por apuesta. NO coloca nada en ninguna casa.
- **Ritmo**: sweep cada 10 min · **reporte por email al admin cada LUNES (UTC)** con: apuestas de la semana,
  W-L, $ apostado, P&L sobre los $2,000, ROI, CLV, y acumulado desde el inicio. **Revisión semanal con Alexis
  todos los lunes.**
- **Ops**: GET/POST `/api/internal/shadow?key=<GP_EXPORT_KEY>` (`run=sweep|report`).
- **Agregar un segmento** (cuando se declare probado): push a `db.shadow.cfg` con key versionada
  (`rounds_v1`, etc.) + `frozen_at` — JAMÁS editar un segmento existente ni aplicar retroactivo. Candidato
  siguiente: combate ROUNDS (necesita que shadowSweep aprenda a leer db.combatPicks — hoy solo clubes).
- **Go-live futuro** (cuando un segmento pase las 300): ejecutores reales vía API oficial — Cloudbet Trading
  API (la key actual es de FEED; para colocar hará falta key con scope de trading), Polymarket CLOB
  (wallet), Betfair. Arquitectura: selector (solo segmentos congelados) → motor de riesgo (mismo Kelly/4 +
  kill-switch) → adaptadores por venue → reconciliación vs cierre. Alexis provee las keys de trading entonces.
