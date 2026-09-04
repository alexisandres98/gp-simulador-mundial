# Incidente 4-sep-2026 — db.json roto, base vacía y avalancha en Telegram

## Qué se vio

A las 08:08-08:09 UTC el canal **@gpsimulador** recibió de golpe una veintena larga de mensajes
"⚽ FINAL" con resultados del Mundial 2026, un torneo que terminó el 19 de julio.

## Qué pasó de verdad

El mensaje en el canal es el **síntoma**, no la avería. La avería es que **la base arrancó vacía**.

Cronología (todo en UTC del 4-sep):

| Hora | Hecho |
|---|---|
| 02:56 | reinicio previo, base sana |
| 03:00 | copia diaria de usuarios al correo del admin: **982 usuarios** |
| 08:07:45 | entra en producción el deploy `1edba7b` (contenido de redes) → reinicio |
| 08:08:39 | el sync de ESPN reingiere el torneo entero y lo ve como "finales nuevos" |
| 08:08:41-08:09:04 | el canal recibe los finales de junio y julio |
| 08:11:36 | copia diaria de usuarios: **0 usuarios** |

Ese "0 usuarios" a las 08:11 es la prueba: el proceso arrancó sin base. También lo confirman
`[reconcile-grants] ... "was":"missing"` y que `/api/internal/picks-export` devolviera `count: 0`
mientras la sombra (35 apuestas) y el ejecutor real (213) seguían intactos — esos dos viven en
archivos propios del disco persistente, no en `db.json`.

## Causa raíz

`flushDb()` escribía `db.json` con un `fs.writeFileSync` **directamente encima del archivo bueno**.
Eso no es atómico. Un deploy manda `SIGTERM` (que además dispara otro `flushDb`) y a los pocos
segundos `SIGKILL`. Si el golpe cae dentro de la escritura, `db.json` queda **truncado a medio JSON**.

En el arranque siguiente:

```js
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* primera ejecución */ }
```

El `JSON.parse` fallaba, el `catch` se lo tragaba **en silencio** y la plataforma seguía viva con la
base por defecto: sin usuarios, sin `results` y sin `sentTg`. Sin `sentTg`, el sync de ESPN —que
reingiere todo el rango del torneo **a propósito**, para autorrepararse tras un reinicio— vio 104
partidos finalizados que nunca se habían publicado, y `tgDispatchFinals()` los publicó.

El deploy no fue la causa; fue el disparador. Cualquier reinicio podía provocarlo, y el fallo estaba
latente desde que existe la persistencia en archivo.

**Lo que salvó a los usuarios de recibir la misma avalancha por correo fue, irónicamente, la propia
pérdida de datos**: `dispatchPendingAlerts()` recorre `db.users`, que estaba vacío. Con la base sana
y `sentAlerts` perdido, casi mil personas habrían recibido decenas de correos de partidos de julio.

## Arreglos aplicados

1. **Escritura atómica** (`flushDb`): se escribe en `db.json.tmp` y se **renombra** encima. El rename
   dentro del mismo sistema de archivos es atómico: `db.json` solo puede existir en el estado de antes
   o en el de después, nunca a medias. Esto elimina la causa raíz.

2. **Arranque que se autorrepara**: si `db.json` no se puede leer, o se lee pero viene **sin usuarios**
   habiendo copias diarias que sí los tienen, se arranca desde la copia más reciente utilizable y se
   **grita en el log** (`[db] ¡ALERTA! ...`). Nunca más un arranque silencioso sobre una base vacía.
   Si el archivo roto era legible, sus usuarios se **conservan** además de los de la copia: nadie que
   se haya registrado mientras la base estaba vacía se queda fuera.

3. **Freno por fecha en los avisos de final** (`avisoDentroDeVentana`, `GP_AVISO_FINAL_DIAS`, 3 días):
   un partido jugado hace más de la ventana **no genera aviso**, exista o no su marca de dedup, ni por
   Telegram ni por correo. El dedup en `sentTg`/`sentAlerts` cubre el caso normal; esto cubre el caso
   en que ese dedup se pierde. Comprobado: los 104 partidos del Mundial tienen fecha conocida y los 104
   quedan fuera de la ventana, así que ni con la base vacía vuelve a salir un solo mensaje.

4. **`/api/internal/ops` publica `db_origen`**: de dónde salió la base en este arranque, si hubo
   restauración, desde qué copia y cuántos usuarios hay. Antes, "¿arrancó bien?" solo se podía
   responder esperando al correo diario del CSV.

## Verificación

- Los cuatro casos del arranque probados en frío fuera de producción: archivo sano (no toca nada),
  archivo sin usuarios (restaura), archivo truncado (restaura), vacío y sin copias (arranca en vacío
  avisando).
- Freno por fecha probado contra el calendario real: 0 de 104 partidos dentro de ventana hoy; un
  partido de hoy sí pasa, uno de hace 2 días también, uno de hace 5 no.

## Qué se perdió

Del estado en `db.json` entre las 02:57 (copia diaria en disco) y las 08:08: altas de usuarios de esa
franja y el historial de simulación de esas horas. Los usuarios se recuperan a 982 desde
`backups/db-2026-09-04.json`. La sombra, el ejecutor real, las bases de los deportes y los CSV de
usuarios por correo no se vieron afectados en ningún momento.

---

# SEGUNDA PÉRDIDA, ENCONTRADA AL MIRAR LA PANTALLA DE RENDIMIENTO

Alexis abrió Esport → Rendimiento y dijo "me parece vacío como si se hubiese borrado". Tenía razón, y **no
es lo mismo que lo de arriba**: es otro fichero, otro mecanismo y otro momento.

## Lo que se perdió

El **track del monitor de esports** de tres juegos. Contra la auditoría del 21-ago (`/api/internal/settle`,
mismo endpoint, misma semántica):

| juego | liquidadas 21-ago | liquidadas 4-sep | abiertas 4-sep |
|---|---|---|---|
| CS2 | **207** | **0** | 34 |
| LoL | **77** | **0** | 41 |
| Valorant | **14** | **0** | 25 |
| Dota 2 | 31 | **142** ✅ | 74 |

Dota 2 no solo sobrevivió: creció. Y todos los demás deportes crecieron con normalidad en esa misma ventana
(combate 79 → 106, baloncesto 50 → 186, tenis 19/27 → 303/289, CFL 4 → 43, F1 0 → 11). Solo esos tres.

**Cuándo.** Las picks que quedan en los tres ficheros nacieron TODAS hoy: la más antigua de Valorant es de
las 05:20, la de LoL de las 07:40, la de CS2 de las 08:00 (`born_at`, que se escribe una sola vez y no se
reescribe). Como el almacén nunca poda —una pick que caduca se cierra VOID y **se queda dentro**, contando
como liquidada—, que no haya ni una anterior a hoy significa que los ficheros se vaciaron hoy, **antes de
las 05:20**. Es decir: **antes de cualquiera de los despliegues de esta mañana**.

## El mecanismo (distinto al de `db.json`)

```js
const st = rd(FICHERO) || { picks: {} };   // rd() se tragaba CUALQUIER error y devolvía null
...                                        // el llamador cree de buena fe que no había nada
wr(FICHERO, st);                           // y guarda el almacén VACÍO encima del bueno
```

"No pude leer" tratado igual que "no hay nada". Basta un pico de memoria, un descriptor de fichero agotado,
un disco que tarda en montar o un JSON roto para que la siguiente pasada destruya el histórico. Y no deja
rastro: el fichero queda perfectamente válido y perfectamente vacío. Que se llevara tres juegos a la vez y
dejara Dota 2 encaja con un fallo de lectura momentáneo en una pasada, no con una escritura interrumpida.

No se puede afirmar el disparador exacto sin los logs de Render de la madrugada; lo que sí es un hecho es
el mecanismo, porque está en el código y se reproduce a voluntad (ver el humo).

## Lo que NO se perdió — y es lo que importa para el edge

El **libro de la sombra está entero**: 554 apuestas, 368 liquidadas, del 14-ago a hoy, con **287 de
`cs2_rounds_v1`** y 38 de `lol_kills_hcp_v1`. El **ejecutor real** también: 213 apuestas desde el 24-ago.
Ahí es donde se mide el edge de las familias congeladas, y vive en ficheros propios que no se tocaron.
Lo que desapareció es la pantalla de rendimiento POR JUEGO, no la medición del edge.

Tampoco se perdieron los cierres de mercado (`closes-*.json`), que es lo otro que esports acumulaba.

## Recuperación

**No hay.** `/data/esports` no entra en la copia diaria (que solo cubre `db.json`). Las 298 picks liquidadas
de CS2, LoL y Valorant no vuelven. Reconstruirlas desde la sombra daría un histórico PARCIAL y con precios
de otra fuente: sería inventarse un track, que es justo lo contrario de para qué existe.

## Arreglo: `lib/jsonstore.js`

Una sola puerta para todos los almacenes en disco, con la regla que faltaba: **"no existe" y "no se pudo
leer" son cosas distintas**.

| caso | antes | ahora |
|---|---|---|
| el fichero no existe (ENOENT) | almacén vacío | almacén vacío (correcto) |
| existe pero el JSON está roto | almacén vacío → **se guardaba encima** | se **aparta** a `<fichero>.roto-<fecha>` con sus bytes intactos y se empieza de cero |
| existe y falla la E/S | almacén vacío → **se guardaba encima** | **escritura BLOQUEADA** hasta que una lectura vuelva a ir |
| escritura | `writeFileSync` encima del bueno | temporal + `rename` (atómico) |

Pasan por ahí los siete almacenes del disco persistente: `esports-engine/store.js`, `esports-engine/props.js`,
`nfl-engine/store.js`, `amfoot-engine/store.js`, `propfirm/scan.js`, `propfirm/polyshadow.js` y
`real-executor/store.js` — este último es el **libro de dinero real**, donde el mismo fallo habría hecho
perder la pista de las apuestas abiertas.

**Comprobado** en `scripts/smoke/jsonstore-smoke.js` (25 en verde), que reproduce el escenario exacto:
fichero con histórico + lectura que falla por E/S + el llamador intentando guardar un almacén vacío → el
guardado se rechaza y el histórico sigue en disco.

## Pendiente

- **Meter `/data/esports`, `/data/propfirm` y `/data/nfl` en la copia diaria.** Hoy la copia solo cubre
  `db.json`, y por eso esto no tiene vuelta atrás.
- Sigue abierto el problema DISTINTO de que CS2/LoL/Valorant no liquidan: la fuente (bo3.gg) no casa los
  nombres de los equipos de tier bajo. Eso ya estaba documentado el 21-ago y no lo causó nada de esto.
