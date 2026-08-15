# Data Fabric — la memoria point-in-time de GP Baloncesto

> Módulos 1-12 del blueprint. Esta capa NO reemplaza a `data/basketball/*`: la envuelve.

## El problema que resuelve

Hoy podemos responder *"¿qué sabemos de este partido?"*. No podemos responder *"¿qué sabíamos **el martes a
las 19:04**, justo antes de que se anunciara la baja?"*. Esa segunda pregunta es la que separa un backtest
creíble de uno que se engaña solo, porque cualquier validación que use datos que llegaron *después* del
momento de la predicción está midiendo un modelo que en producción nunca existió.

El caso concreto que nos puede morder: el parte de lesiones de ESPN se **sobrescribe**. Si a las 18:00 un
jugador figuraba "en duda" y a las 19:30 pasó a "fuera", nuestro archivo solo conserva "fuera". Un backtest
que reconstruya aquella noche creerá que sabíamos a las 18:00 lo que en realidad supimos a las 19:30, y las
picks saldrán mejor de lo que salieron. Nadie lo nota hasta que el dinero real no reproduce el backtest.

## Las tres capas

```
BRONZE   respuestas crudas tal como llegaron, comprimidas y con hash
   ↓     (nunca se editan; si la fuente corrige algo, entra una revisión nueva)
SILVER   entidades y eventos normalizados con tiempo efectivo
   ↓     (lesiones, cuotas, alineaciones, resultados — como EVENTOS, no como estados)
GOLD     features, ratings, probabilidades y precios
         (lo que ya vive en data/basketball/* y en los artefactos de ajuste)
```

## Los tres tiempos que lleva cada dato

Un dato sin sus tres marcas de tiempo no sirve para reconstruir el pasado:

| Marca | Qué significa | Ejemplo |
|---|---|---|
| `effective_at` | Desde cuándo es cierto **en el mundo** | el jugador quedó descartado a las 19:30 |
| `observed_at` | Cuándo lo **vio la fuente** | ESPN lo publicó a las 19:34 |
| `ingested_at` | Cuándo **lo guardamos nosotros** | nuestro sweep lo capturó a las 19:36 |

Reconstruir "qué sabíamos a las 19:00" = filtrar por `ingested_at <= 19:00`, no por `effective_at`. Usar
`effective_at` para eso es el error de fuga más común y el más difícil de ver.

## Ficheros

- `store.js` — bronze/silver: escribir eventos, leer el estado a una fecha (`asOf`), revisiones.
- `entities.js` — IDs canónicos y resolución de identidad (cambios de nombre, traspasos, homónimos).
- `provenance.js` — procedencia, confianza por fuente, jerarquía de conflictos y registro de ausencias.
- `snapshots.js` — congelado point-in-time por predicción y congelado histórico diario.

## Dónde vive

`GP_FABRIC_DIR` (por defecto `data/fabric/`). En producción conviene apuntarlo al disco persistente de
Render (`/data/fabric`) para que sobreviva a los deploys, igual que `db.json`.
