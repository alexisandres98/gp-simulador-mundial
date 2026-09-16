# Lo que hace nuestro liquidador, familia por familia

**16-sep-2026 · la mitad que sí se puede escribir de `contrato_documentado` / `liquidador_concuerda`**

---

## Por qué existe este documento y qué NO resuelve

La puerta G0 (`lib/puertas.js`) exige dos declaraciones por familia:

- **`contrato_documentado`** — que el reglamento de la casa esté leído y escrito.
- **`liquidador_concuerda`** — que nuestro código liquide con **esa** regla.

Hoy solo `futbol:CARDS` las tiene las dos, y por eso es la única familia que llega a 6 de 7 en G0. Las otras
nueve están bloqueadas por `contrato_documentado: null`, que es lo correcto: lo que no se puede comprobar
bloquea igual que lo que falla.

**Este documento no las desbloquea, y no lo pretende.** Rellenar las dos casillas con un `true` sin haber
leído el reglamento de la casa sería exactamente el fallo que la puerta existe para impedir — y sería peor
que dejarlas en `null`, porque una familia declarada en falso pasa a G1 y ahí ya nadie vuelve a mirar.

Lo que hace es escribir **la mitad que sí se puede escribir hoy sin pedirle nada a nadie**: qué regla aplica
nuestro liquidador, exactamente, en cada familia. Con eso, comprobar el contrato deja de ser «leerse tres
reglamentos y auditar el código» y pasa a ser «leerse tres reglamentos y comparar con esta tabla». Es la
diferencia entre una tarea de días y una de una tarde.

La segunda mitad —el reglamento de la casa— **necesita a un humano abriendo la página de reglas de Cloudbet,
Pinnacle y Bovada**. No se puede deducir del código ni del histórico.

---

## Esports (CS2, LoL, Valorant, Dota 2) — `esports-engine/store.js`, `settleOne()`

Fuente de resultado: bo3.gg (CS2) · Leaguepedia (LoL) · OpenDota (Dota 2) · sin fuente (Valorant).

| familia | lo que hace nuestro liquidador | empate exacto | qué hay que comprobar contra la casa |
|---|---|---|---|
| `TOTAL_MAPAS` | compara `maps_a + maps_b` con la línea | la línea entera clavada → **PUSH** | si la casa devuelve o si usa medio punto siempre |
| `HANDICAP` | `(maps_a − maps_b) + línea`; > 0 gana el local | resultado 0 → **PUSH** | ídem |
| `RONDAS` | `m.rounds` del mapa contra la línea | → **PUSH** | **si las rondas de prórroga cuentan.** Es la comprobación más importante de esta tabla |
| `RONDAS_EQUIPO` | `score_a` o `score_b` del mapa contra la línea | → **PUSH** | ídem prórroga |
| `RONDAS_HANDICAP` | `(score_a − score_b) + línea` | resultado 0 → **PUSH** | ídem prórroga |
| `PRORROGA` | `m.ot` booleano | — | qué cuenta como prórroga en el formato MR12 actual |
| `KILLS` | `kills_a + kills_b` del mapa | → **PUSH** | si la casa cuenta ejecuciones y muertes por torre/monstruo |
| `KILLS_EQUIPO` | `kills_a` o `kills_b` | → **PUSH** | ídem |
| `KILLS_HANDICAP` | `(kills_a − kills_b) + línea` | resultado 0 → **PUSH** | ídem |
| `KILLS_DNB` | `kills_a` contra `kills_b` | empate exacto → **PUSH** | ídem |

**Reglas transversales del liquidador de esports, y las tres son decisiones nuestras:**

1. **Una serie a medias no liquida nada de la serie** (16-sep). `TOTAL_MAPAS`, `HANDICAP` y `SERIE` esperan a
   que alguien llegue a los mapas que pide el formato (`bo`). Las familias de mapa sí se liquidan en cuanto
   ese mapa concreto está jugado.
2. **Un mapa que no se jugó se anula** cuando la serie ya terminó (7-sep): `VOID`, cero unidades.
3. **Un resultado que no se encuentra NO es una devolución** (15-sep): `DATA_UNRESOLVED`, fuera del ROI y del
   recuento de liquidadas, con su motivo a la vista.

---

## Tenis de mesa — `tt-engine/store.js`

Fuente: WTT score API (match card oficial, con puntos por game).

| familia | lo que hace nuestro liquidador | qué comprobar |
|---|---|---|
| `ML` | ganador del partido | nada; es inequívoco |
| `GAME_ML` | ganador de un game concreto | qué hace la casa si el partido acaba antes de ese game |
| `GAMES_HCP` | margen de games + línea | tratamiento del retiro |
| `GAME_POINTS_TOTAL` / `POINTS_TOTAL` | suma de puntos | **el retiro**, que es frecuente en TT |
| `GAME_POINTS_HCP` | margen de puntos + línea | ídem |

**Hueco conocido:** el contrato del retiro. En tenis de mesa un jugador que se retira a mitad de partido es
lo bastante habitual como para que la regla importe, y nuestro liquidador no la tiene escrita.

---

## Dardos — `darts-engine/store.js`

Fuente: API pública de la PDC (resultados con legs, **formato por ronda certificado**).

| familia | lo que hace nuestro liquidador | qué comprobar |
|---|---|---|
| ganador del partido | ganador según la PDC | nada |
| total de legs | suma de legs de los dos | si la casa cuenta sets o legs cuando el formato es por sets |
| hándicap de legs | margen + línea | ídem |
| 180s | conteo de la PDC | **si la casa cuenta los 180 del desempate** |

**Lo que sí está resuelto y conviene que conste:** el formato por ronda viene certificado por la propia PDC,
así que no hay que adivinar si un partido es al mejor de 11 legs o de 7 sets. Eso es más de lo que tiene
cualquier otro deporte de la casa.

---

## Tenis — `tennis-engine/store.js`

| familia | lo que hace nuestro liquidador | qué comprobar |
|---|---|---|
| `ML` | ganador del partido | **el retiro**: casi todas las casas dan por ganado al que avanza si se completó un set |
| `SPREAD` (juegos) | margen de juegos + línea | **el retiro**: aquí casi todas DEVUELVEN |
| `TOTAL` (juegos) | suma de juegos | ídem; y si el súper tie-break cuenta como un juego |

**Hueco conocido, y es el mismo de TT pero peor:** el retiro en tenis tiene reglas DISTINTAS por familia
dentro de la misma casa —el ganador se paga, el hándicap se devuelve— y nuestro liquidador aplica la misma
regla a las tres.

---

## NFL — `nfl-engine/store.js`

| familia | lo que hace nuestro liquidador | qué comprobar |
|---|---|---|
| hándicap | margen + línea | si la prórroga cuenta (sí en todas las casas grandes, pero no está escrito) |
| total | puntos de los dos | ídem |
| moneyline | ganador | el empate, que en la NFL existe |

---

## Baloncesto — `basketball-engine/`

Picks apagadas; lo que se publica sale de precios entre casas, no del modelo. Aun así el liquidador existe y
sus reglas son las mismas tres (hándicap, total, ganador) con la prórroga incluida.

---

## Fútbol: derivadas — `futbol-derivadas.js` + `goal-engine/mitades.js`

Quince familias nuevas en sombra desde el 13-sep. El marcador al descanso entra por ESPN con **doble
puerta**: el nombre tiene que resolver Y las dos mitades tienen que sumar el final conocido. Esa doble
puerta es lo que impide liquidar una mitad con el marcador de otro partido, y es más estricta que lo que
hace cualquier otro motor de la casa.

**Lo que falta:** ninguna de las quince tiene el reglamento de la casa leído. En particular, el contrato del
**gol en el descanso prolongado** (un penalti ejecutado tras el minuto 45+8) y el de la **prórroga** en
competiciones a eliminatoria.

---

## Resumen: qué falta exactamente para cerrar `contrato_documentado`

Tres reglamentos y una tarde:

1. **Cloudbet** — reglas de esports (¿cuentan las rondas de prórroga?), de tenis de mesa (retiro) y de
   fútbol (descanso prolongado). Es la casa con dinero real, así que es la primera.
2. **Pinnacle** — reglas de esports y de NFL.
3. **Bovada** — reglas de kills y de marcador exacto de dardos.

Y una comprobación que no es de reglamento sino de dato: **la tabla de multiplicadores de Underdog** para
props de CS2. Sin verificar, 3× contra 3,5× cambia el ROI de −12,71 % a +1,83 % — o sea, cambia el signo.

Hasta que eso exista, `contrato_documentado` sigue en `null` en las nueve familias y G0 sigue cerrada. Es lo
correcto.
