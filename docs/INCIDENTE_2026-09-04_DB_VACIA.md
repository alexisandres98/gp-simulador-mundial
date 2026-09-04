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
