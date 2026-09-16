# Plan de trabajo tras la auditoría externa — 15 de septiembre de 2026

> Documento de ejecución. Lo redactó la sesión de análisis (Fable 5.1) a partir de `docs/AUDITORIA_EXTERNA_2026-09-15.md`
> (la auditoría externa, íntegra) y `docs/AUDITORIA_MODELOS_2026-09-14.md` (nuestro dossier). Lo ejecuta otra sesión
> (Opus 5). Está escrito para que esa sesión no necesite nada más que estos tres documentos, el repositorio y las
> decisiones de Alexis de la sección 2.

---

## ESTADO AL CIERRE DEL 15-SEP-2026

> Añadido por la sesión ejecutora al terminar la jornada. **Las Fases 0 y 1 están cerradas y desplegadas**
> (`6ab0320`, health 200). La Fase 2 quedó hecha en tarjetas, CS2, tenis de mesa y tenis ATP. La Fase 3 y el
> backlog de la sección 7 se empiezan mañana.

### Decisiones de Alexis, tomadas el 15-sep

| ID | Decisión | Lo que dijo | Efecto |
|---|---|---|---|
| **D1a** | ¿Pausar tarjetas? | **No.** Siguen corriendo | `GP_REAL_CARDS_ENABLED` sin tocar |
| **D1b** | ¿Pausar tenis de mesa real? | No más allá de A02 | hecho en T0.4 |
| **D2** | ¿Quitar "confirmada" del tablero? | Sí | hecho en T1.6 |
| **D3** | ¿Parada vinculante? | Sí | hecho en T1.8 |
| **D4** | ¿Retirar versiones sin evidencia? | Sí | hecho en T1.9 |
| **D5** | ¿Córners y goles de clubes? | **Seguir publicando normal por ahora** | sin cambios en el feed |
| **D6** | ¿Reparto de esfuerzo de la Fase 2? | Sí | seguido |
| **D7** | ¿Clasificador de tenis de mesa? | Sí, hoy | hecho en T0.3 |
| **D8** | ¿Rotar claves? | **Más adelante, lo hace él** | PENDIENTE: Render (expuesta el 15-sep), Hetzner, `GP_REAL_RELAY_TOKEN`, `API_FOOTBALL_KEY` |
| **T2.2** | ¿Conectar el árbitro a producción? | **Sí, conéctalo** | hecho: entra a la proyección, `GP_CARDS_REF=1` por defecto |

Además, el 15-sep: confirmado el total depositado (2.280,92 USDT, la conciliación cierra a cero exacto) y
aplicada la migración de las filas sin resultado localizable (10 filas, 8 de CS2 y 2 de tarjetas).

### ESTADO DE LAS PUERTAS AL 16-SEP (Fase 3 arrancada)

`/api/internal/puertas?key=` — las cinco puertas convertidas en código (`lib/puertas.js`).

**Ninguna de las diez familias pasa G0.** Esa es la foto real, y ahora es una cifra y no una impresión.

| familia | G0 | qué la bloquea |
|---|---|---|
| **`futbol:CARDS`** | **6 de 7** | solo le falta la cara contraria del cierre, que empieza a acumularse hoy |
| `esports:lol` | 5 de 7 | contrato y liquidador sin declarar |
| `esports:cs2` | 4 de 7 | **11,8 % sin resultado localizable** (tope 5 %), y contrato/liquidador sin declarar |
| `esports:valorant`, `esports:dota2`, `tt` | 4 de 7 | contrato, liquidador y cierres |
| `tenis`, `dardos`, `nfl`, `hoops` | 3 de 7 | cierres, contrato y liquidador |

Dos cosas que la puerta saca a la luz y que no estaban en ninguna lista:

- **Tarjetas está a UNA comprobación de G0.** Contrato documentado, liquidador concordante, identidad
  completa, cero cierres en vivo, 890 filas legibles, cero sin resolver. Lo único que le falta es la cara
  contraria, y el arreglo ya está puesto: es cuestión de que pasen partidos.
- **CS2 tiene un 11,8 % de apuestas sin resultado localizable**, más del doble del tope. Con esa proporción,
  su ROI y su EV están calculados sobre una muestra seleccionada por la propia ausencia de dato. Es un P0 de
  integridad que no estaba identificado y que bloquea a la familia con más muestra de la casa.

**El umbral corregido del conjunto** (Benjamini–Hochberg al 10 % sobre las cinco familias con EV estimable)
es **p ≤ 0,000346**. Se publica al lado de cada veredicto individual.

### Lo que queda, por orden de importancia

**1. LA CARA CONTRARIA DEL CIERRE. Una tarea, no nueve.** El replay del apartado 5b de
`METRICAS_RECALCULADAS` lo deja medido: **nueve de nueve motores guardan el cierre de su lado y ninguno el
del contrario**. Sin eso no se puede quitar el margen, y sin quitar el margen la vara no puede dar un
veredicto de dinero en NINGÚN deporte, tarjetas incluida. El contador de la muestra objetivo del preregistro
de `cards_under_v2` vale cero por esto mismo. **Es el trabajo previo a todo lo demás y no hay atajo.**

**2. Fase 3 — las cinco puertas** (G0 integridad, G1 señal histórica, G2 sombra prospectiva, G3 piloto real,
G4 escalar) y la decisión sobre el libro transaccional. No se puede empezar antes del punto 1: ningún
challenger ha pasado G1 todavía, y tarjetas no puede pasarlo sin EV contra cierre.

**3. Decisiones abiertas que cambian qué picks nacen** — las cuatro esperan a Alexis:
- **Apagar `shift` en tenis.** Medido que RESTA en ATP bo3 (t +6,28) y que C6 lo bate en WTA (t −4,83).
  Es el único de los cuatro donde el cambio va claramente a favor.
- **Encender C7** (compilador con marcadores legales) en tenis ATP bo3.
- **Encender `GP_TT_UNC_FAMILIA`**: endurece el listón de totales de tenis de mesa un 15-18 %.
- **Encender `GP_TT_DEDUP_EQUIV`**: el catálogo ve cinco apuestas donde hay dos.

**4. D8, las cuatro claves.** Lo hace Alexis en los paneles.

**5. Backlog P1/P2 de la sección 7** — quince tareas, ninguna empezada.

**6. T2.4** (¿ventana o mezcla?) queda **sin contestar y con el número que lo justifica**: con 155 apuestas y
un intervalo de ROI de 32 puntos sobre el libro entero, sus partes no sostienen ninguna conclusión. Pendiente
de muestra, no de trabajo.

### Bloqueos de datos que no son trabajo de modelo

- El feed de props de Underdog lleva caído (426 `upgrade_required`, cero tesis activas).
- El contrato de Underdog sigue sin verificar en lo que decide el signo: falta la tabla de multiplicadores
  de la casa. Entre 3× y 3,5× el resultado va de −12,71 % a +1,83 %.
- El 20,6 % de las apuestas de CS2 no tenía resultado localizable. Ya está etiquetado; la causa raíz no.
- Pinnacle dejó de publicar tenis de mesa y dardos (confirmado desde su propio catálogo). Hecho consumado.
- `derivadas` devuelve cero picks por la ruta `?motor=`: hay que comprobar la ruta del disco en producción.

---

## 0. Cómo usar este plan

**Orden.** Las fases van en orden y las tareas dentro de cada fase también, salvo que se indique "paralelizable". La Fase 0 no se salta: todo lo demás mide sobre lo que la Fase 0 arregla.

**Definición de hecho.** Una tarea está hecha cuando: (1) el cambio está en `main` y desplegado con health 200; (2) su prueba de aceptación pasa en `tests/` y se puede correr con `node tests/<archivo>.test.js`; (3) hay una línea en `docs/REGISTRO_EXPERIMENTOS.md` (nuevo, Fase 1) o en `HANDOFF.md` con fecha, commit, qué cambió y qué número cambió por ello. Un cambio que no mueve ningún número documentado se anota igual, con "sin efecto medible".

**Lo que la sesión ejecutora NO hace sin la palabra de Alexis.** Cambiar qué picks nacen en una familia congelada (`cards_under_v1`, `cs2_rounds_v1`, `lol_kills_hcp_v1`, `corners_over_v1`), encender o apagar un canal de dinero real, cambiar un stake, meter dinero nuevo en ningún sitio. Cada tarea que toca eso lleva la etiqueta **[DECISIÓN Dn]** y espera a la decisión correspondiente de la sección 2. Todo lo demás son arreglos de integridad, medición o sombra, y se ejecutan.

**Reglas de siempre.** No borrar `db.json` en producción; copiar antes de tocar el disco persistente. Probar en vista previa antes de desplegar. Commits con `git -c user.name="GP" -c user.email="alexisgomezico@gmail.com" commit -F <msg>`, rama `claude/gpsim-continuation-vrjuww` y `HEAD:main`, deploy por API de Render y comprobación de `/api/health`. Secretos solo en el área temporal, nunca en el repositorio ni en el chat. Si el contenedor se reinicia, las claves del área temporal se pierden: se recuperan leyendo las variables del servicio en Render con la clave de Render, que Alexis reenvía si hace falta.

**Vocabulario que fija la auditoría y que este plan adopta.** `p_model_raw` (probabilidad del modelo sin calibrar), `p_calibrated`, `q_reference` (probabilidad justa de referencia, desvigada, con casa y momento explícitos), `p_break_even = 1/o`, `edge_information_pp = p − q_reference`, `ev_net = p·o − 1 − costes`, `EV_cierre = o_entrada·q_cierre − 1`. Las puertas de dinero consumen `ev_net`; las de investigación comparan contra `q_reference`.

---

## 1. Lectura de la auditoría

### 1.1 Lo que acepto sin reservas

La auditoría es correcta en su dictamen y en sus matemáticas. Verifiqué en el código las dos afirmaciones centrales antes de escribir esto:

- **La vara mezcla unidades** (`lib/vara.js`). El veredicto resta el margen por lado al CLV recortado y calcula el t sobre el CLV bruto. El contraejemplo de la auditoría es reproducible: entrada 1,97 contra cierre 1,905/1,905 da CLV +3,4 %, la vara declara +0,9 % neto, y el EV real al cierre justo es −1,5 %. **La vara puede aprobar familias con esperanza negativa.** Es el defecto más grave del sistema de medición y se corrige en la Fase 1.
- **Los cuartos asiáticos promedian probabilidades** (`goal-engine/markets.js:54-57`, función `asianTotal`, rama `quarter`). Hay que promediar pagos, no probabilidades. Afecta a toda derivada con línea x,25 o x,75.

Acepto también: que |t| < 2 no prueba equivalencia y por tanto `cierreAporta()` no puede ser un interruptor; que el Brier absoluto no mide eficiencia económica y encima se calcula sobre nuestras picks; que la autopsia de tarjetas suma causas que se solapan; que 100 apuestas son un control operativo y no una certificación; que un resultado desconocido no es un VOID; que un precio es una tupla y `best()` no puede devolver una cuota suelta; que hacen falta clusters por evento y control de comparaciones múltiples; y las puertas G0–G4.

### 1.2 Lo que corrige de nuestro propio dossier

Estas correcciones hay que asumirlas para no repetirlas:

| Nuestra afirmación | Corrección de la auditoría | Estado |
|---|---|---|
| No retirar margen en tenis infla la ventaja | Al revés: 1/o es mayor que la probabilidad desvigada, así que **reduce** la ventaja; es conservador | Aceptada |
| Las líneas de parada se vuelven más laxas al pasar de stake 30 a 40 | Un suelo fijo en dólares se vuelve **más estricto** en unidades de stake. Lo correcto es recalcular el suelo: ≈ −308 a stake 40 | Aceptada; A07 |
| El compilador de tenis de mesa es peor que el Elo solo | Solo mirado en aislamiento. El ensamble mejora el log-loss de 0,5372 a 0,5273; hay información complementaria | Aceptada |
| Semilla fija es una debilidad | No lo es; favorece reproducibilidad | Aceptada |
| CC BY-SA implica no comercial | La licencia permite uso comercial con condiciones; lo que restringe son los términos del sitio | Aceptada; revisar `RIGHTS.md` |
| La ventaja de tarjetas no era del modelo porque el total es la media de la liga | Es una hipótesis que compite con selección, liquidación y varianza; no está demostrada | Aceptada; E1/E2 |
| Apilar costó −413,72 | El contrafactual calculado es +95,66; las causas se solapan | Aceptada; A20 |

### 1.3 Dónde matizo

- **Parada que no apaga.** La auditoría pide que las condiciones de parada bloqueen órdenes nuevas de forma vinculante (A07). Que no apague fue una decisión explícita de Alexis el 13-sep ("una alarma que además ejecuta es una alarma en la que ya no se confía"). Las dos posturas son defendibles. Lo llevo a decisión (D3) con mi recomendación: bloquear **solo órdenes nuevas**, con registro y correo, y con un interruptor de entorno para que Alexis pueda levantar el bloqueo sin desplegar.
- **Pausar tenis de mesa.** La auditoría lo agrupa con tarjetas. El canal de tenis de mesa lleva 60 apuestas liquidadas a 5 USD con P&L exactamente 0,00 y su único defecto de ejecución conocido (A02, dos totales del mismo partido) se arregla en una hora. Recomiendo arreglar A02 y verificar el contrato del total antes de la siguiente apuesta, y no pausarlo más allá de eso (D1b).
- **Comisiones de Polymarket.** La auditoría cita una fórmula y una tasa "vigentes en la consulta". Antes de recalcular la sombra hay que verificar la tarifa por mercado en la documentación del día y guardar la fuente (A09).
- **Lo que la auditoría no vio porque no tuvo el código.** Tres cosas encontradas por nosotros el 14 y 15 de septiembre entran en el plan: el clasificador de competiciones de tenis de mesa excluye todos los WTT Star Contender por un falso positivo de texto (Fase 0); el listón de ruido de tenis de mesa usa la incertidumbre del **ganador** para juzgar **totales** (Fase 2); Pinnacle devuelve cero eventos de tenis de mesa (Fase 1).

---

## 2. Decisiones que necesita Alexis antes de arrancar

Cada una con mi recomendación. La sesión ejecutora arranca la Fase 0 sin esperar a ninguna; las decisiones bloquean solo las tareas etiquetadas.

| ID | Decisión | Recomendación | Bloquea |
|---|---|---|---|
| **D1a** | ¿Pausar órdenes nuevas de tarjetas under durante la Fase 0 y 1 (≈10 días)? | **Sí.** Seguir apostando bajo una versión cuya medición, liquidación y contrato vamos a cambiar acumula muestra que habrá que descartar. Las posiciones abiertas se dejan correr. Se reanuda al cerrar G0 con preregistro nuevo | T0.7 |
| **D1b** | ¿Pausar tenis de mesa real? | **No más allá de A02.** Arreglar la posición por partido, verificar el contrato del total, y seguir a 5 USD | T0.4 |
| **D2** | ¿Retirar del tablero y de la interfaz las etiquetas "confirmada" y el ranking por t hasta que el CLV se recalcule por contrato? | **Sí.** Conservar los históricos con advertencia y versión | T1.6 |
| **D3** | ¿Hacer vinculantes las líneas de parada sobre órdenes nuevas? | **Sí, solo sobre nuevas**, con `GP_PARADA_BLOQUEA=off` para levantarlo sin desplegar | T1.8 |
| **D4** | ¿Retirar como versión financiable: `derivadas_v1`, hándicap de kills de LoL (v1), UFC ganador bruto, Boleto GP con EV agregado, y las cinco familias con veredicto "cerrar"? Se conservan como controles en sombra con etiqueta de versión | **Sí** | T1.9 |
| **D5** | ¿Seguir publicando a usuarios córners y goles de clubes (la mitad del feed) mientras se mide? | Decisión de producto. Mi voto: dejar de etiquetarlos como picks con ventaja; mostrarlos como "modelo vs mercado" sin recomendación | T1.6 |
| **D6** | ¿Aceptar el reparto 40 % medición común, 20 % tarjetas, 20 % CS2, 10 % tenis de mesa, 10 % tenis ATP? | **Sí** | Fase 2 |
| **D7** | ¿Corregir hoy el clasificador de tenis de mesa que excluye los Star Contender? Cambia qué picks nacen, pero es un fallo de texto, no una regla | **Sí, hoy.** Es un bug | T0.3 |
| **D8** | Rotar claves: Render (pasó por el chat el 15-sep), Hetzner, `GP_REAL_RELAY_TOKEN`, `API_FOOTBALL_KEY` | **Sí.** Lo hace Alexis en los paneles; el ejecutor actualiza el documento de despliegue | T0.8 |

---

## 3. Fase 0 — Congelar y reconciliar (días 1 a 3)

Objetivo: que no se pierda nada, que el dinero cuadre, y que los fallos que hoy corrompen datos dejen de hacerlo. Ningún modelo se toca.

### T0.1 Etiqueta y copia de seguridad
- `git tag pre-auditoria-2026-09-15` en `056e37e`/`05b5958`. Copia de `/data/db.json` y de los directorios de sombra del disco persistente (`/data/tt`, `/data/darts`, `/data/esports`, `<dbdir>/implicito`, `props-cs2.json`) a `/data/backup-2026-09-15/` mediante la ruta interna de backup existente (`/api/internal/ops` lista `backups`; si no hay ruta de copia, añadir `POST /api/internal/backup?key=` que copie sin borrar).
- Aceptación: el listado de backups muestra la fecha y los tamaños coinciden con los originales.

### T0.2 Reconciliación total del dinero (A08 parte contable, §12.3)
- Correr `real-executor/reconciliar.js` y `auditoria-reconciliar.js` contra Cloudbet para el 100 % de filas con estado `PLACED`, `EN_ACEPTACION` o `SETTLED`. Salida: tabla de discrepancias (referencia, estado nuestro, estado casa, importe nuestro, importe casa).
- Anotar los depósitos que faltan (`/api/internal/anotar`) hasta que cierre la ecuación `Δsaldo = depósitos − retiros − stakes aceptados + pagos brutos − comisiones`.
- Aceptación: `conciliacion.descuadre` en `/api/internal/real` es cero o cada descuadre restante tiene una fila de incidencia con motivo.

### T0.3 Clasificador de competiciones de tenis de mesa **[DECISIÓN D7]**
- `tt-engine/rules.js:101-108`, `integrityOf`. Hoy la lista de ligas privadas se evalúa antes que la de organizador oficial y el patrón `tt star` casa con "w**tt star** contender". Cambio: comprobar primero `/\b(wtt|ittf)\b/` → `VERIFIED_SCOPE`; después la lista de privadas; después el resto. Añadir `tests/tt-integridad.test.js` con al menos: `WTT Star Contender Astana, WS` → verificada; `TT Star Series` → restringida; `WTT Contender Prague Czech` → verificada; `ITTF Czech Open` → verificada; `Czech Liga Pro`, `Setka Cup`, `Moscow Liga Pro` → restringidas.
- Aceptación: la sonda `/api/internal/tt?key=&board=1` muestra los eventos de Star Contender con `integrity: VERIFIED_SCOPE` y `cloudbet_read` incluye sus ids.

### T0.4 Tenis de mesa real: una posición por partido y lado, y contrato del total (A02) **[DECISIÓN D1b]**
- `real-executor/tt.js:33-38`, `ocupada()`: quitar la condición de línea. Una fila está ocupada si hay dinero en el mismo `cb_event_id` y el mismo `side`, con cualquier línea. Reutilizar `posicionOcupada` de `real-executor/store.js` si su firma lo permite; si no, replicar la regla y dejar comentario cruzado.
- Verificar el contrato `table_tennis.totals` de Cloudbet: qué suma (puntos de todos los games), qué pasa con retirada antes y durante el partido, y si el total se liquida en partidos acortados. Guardar el texto de las reglas de la casa en `docs/CONTRATOS_CASA.md` (nuevo) con fecha.
- Aceptación: `tests/tt-real.test.js` con dos filas over 73,5 y over 75,5 del mismo evento → la segunda muere en `linea_ya_apostada` (renombrar motivo a `posicion_ya_apostada`). Fijar en Render `GP_REAL_TT_ENABLED=true` y `GP_REAL_TT_STAKE=5` explícitas (hoy no existen y el código asume los valores).

### T0.5 Liquidadores: estado no resuelto separado del anulado (A03, A04, A05)
- Introducir el estado `DATA_UNRESOLVED` en todos los liquidadores que hoy convierten "sin resultado a N días" en `VOID`: `futbol-derivadas.js` (rama `void` por incoherencia y 72 h), `esports-engine/store.js` (`settlePicks`, 7 días), `tt-engine/store.js` (`settleShadow`, `voidDays: 10`), `darts-engine/store.js` (12 días), `basketball-engine/store.js`, `tennis-engine/store.js`, `combat` (72 h), `nfl-engine/store.js`, `amfoot-engine/store.js`. `BOOK_VOID` solo cuando la casa devolvió el dinero. Los `DATA_UNRESOLVED` no entran al ROI y cuentan aparte en cada track con su motivo.
- **Moneyline de fútbol americano (A04):** `nfl-engine/store.js` y `amfoot-engine/store.js` solo liquidan `SPREAD` y `TOTAL`; toda pick de ganador queda en PUSH con cero unidades. Añadir la rama de ganador (victoria, derrota, empate según contrato). Regenerar el track de la familia con etiqueta de versión; no sumar el histórico anterior.
- **LoL y Dota 2 (A05):** confirmar la orientación del lado en la liquidación de kills tras el arreglo del 2-sep y que una serie BO3 en 1–0 no se liquida como terminada. Regenerar tracks por versión.
- Aceptación: `tests/liquidacion.test.js` cubre la tabla 3.5 de la auditoría: A/B invertidos con hándicap → mismo pago; línea entera y cuartos en la frontera → WIN/LOSS/PUSH/half exactos; ML de NFL nunca PUSH por rama ausente; BO3 1–0 no finaliza; TT 11–10, 12–10 y deuce legales; resultado ausente → `DATA_UNRESOLVED`.

### T0.6 Truncado de no ejecutables y registro de decisiones (A32, parte)
- `server.js`, sombra: `S.unexec` se trunca a 300 filas mientras `bets` crece; la tasa de ejecución se sesga. Sustituir por archivo rotativo en disco (`<dbdir>/shadow/unexec-YYYY-MM.json`) sin truncar, y calcular `exec_rate_pct` sobre el mismo periodo que las apuestas.
- Aceptación: `exec_rate_pct` de los últimos 7 días coincide con el recuento manual de señales y apuestas de ese periodo.

### T0.7 Pausa de tarjetas **[DECISIÓN D1a]**
- Si Alexis dice sí: no apagar `GP_REAL_ENABLED` (apagaría también tenis de mesa). Añadir `GP_REAL_CARDS_ENABLED` (default `true`) leído por el perímetro de tarjetas en `real-executor/store.js`, y ponerlo a `false` en Render. Las filas `PLACED` siguen liquidándose.
- Aceptación: `/api/internal/real` muestra `cards: pausado` y la cola de tarjetas queda en cero nuevas durante 24 h.

### T0.8 Claves **[DECISIÓN D8]**
- Tras la rotación de Alexis: actualizar `relay/DESPLIEGUE-PM.md` y `HANDOFF.md` con la fecha; probar `/api/internal/pm-relay` y el relay de Frankfurt; comprobar que el brazo de Polymarket sigue respondiendo.

---

## 4. Fase 1 — Una sola medición (días 4 a 10)

Objetivo: que todas las familias se midan con la misma vara, sobre contratos exactos, con incertidumbre por clusters, y que el histórico se recalcule una vez bajo esa vara. Al terminar, ninguna etiqueta del tablero viene de la medición antigua.

### T1.1 La vara nueva (A06, §2.1, §2.2, §2.3) — paralelizable con T1.2
Reescribir `lib/vara.js` sobre un módulo nuevo `lib/ev.js`:
- Por ticket: `q_cierre` = probabilidad desvigada del cierre **del mismo contrato y la misma casa** (dos caras contemporáneas; si falta una cara, `q_cierre = null` y el ticket no entra a la vara, con contador). `EV_cierre = o_entrada·q_cierre − 1`. Para cuartos y enteros, `EV = A·(o−1) − B` con las masas de pago del cierre.
- Agregado: media de `EV_cierre` con error estándar por **clusters de evento** (bootstrap por bloques, 2.000 réplicas, semilla fija), y t sobre esa media. No sobre el CLV bruto.
- CLV bruto y CLV recortado se conservan como diagnósticos, etiquetados "movimiento de línea", nunca como veredicto.
- `cierreAporta()` deja de ser interruptor: pasa a informar `mejora_pareada`, `t`, `n` y `potencia_aprox`; el veredicto usa `EV_cierre` y, cuando `q_cierre` no existe, `modeloContraPrecio()` marcado como "sin referencia de cierre".
- Veredictos: `invertible` (EV_cierre > 0, t ≥ 2 sobre clusters, n_eventos ≥ 100), `promete`, `sin_evidencia`, `cerrar` (t ≤ −2 con n_eventos ≥ 100), `sin_cierre`. Añadir corrección por comparaciones múltiples en la vista global: reportar el número de familias evaluadas y el umbral ajustado (Benjamini–Hochberg al 10 %) junto al veredicto individual.
- Guardar por ticket `p_model_raw`, `p_calibrated`, `q_reference`, `p_break_even`, `edge_information_pp`, `ev_net` (§2.1) en el objeto de pick de cada motor que los tenga; donde no existan, `null`.
- Aceptación: `tests/vara.test.js` reproduce el contraejemplo de la auditoría (entrada 1,97, cierre 1,905/1,905 → EV −1,5 %, veredicto no invertible) y el ejemplo del cuarto (over 2,25 con 0,30/0,25/0,45 → cuota justa 1,9444).

### T1.2 El precio es una tupla (A01, §3.1) — paralelizable con T1.1
- Definir `lib/contrato.js`: clave canónica `evento|orientación|deporte|competición|fase|periodo|familia|selección|línea con signo|reglas|casa|fuente|timestamp`. Función `mejorPrecio(filas)` que devuelve **la fila entera** (cuota, línea, selección, casa, hora), nunca una cuota suelta.
- Sustituir en: `edge-board.js` (`best()` descarta la línea), `server.js` `currentBestOddsForPick` (≈9834), `amfoot-engine/store.js` y `nfl-engine/store.js` (línea de consenso con precio de otra casa), `basketball-engine`, `esports-engine/store.js` (dedupe por mejor cuota), `tt-engine/store.js` (`evaluateEdges:314-317`). El modelo valora **esa** línea, no la mediana del tablero.
- Hándicaps: no emparejar por `abs(line)`; normalizar a la línea del lado A con signo. Caras contemporáneas: la pareja para desvigar tiene que ser de la misma casa y de la misma pasada.
- Tenis de mesa: la familia (puntos o games) sale del `market_key` del proveedor, no del umbral de magnitud (`isPointsTotal`, `isPointsHcp` en `data-providers/tt/books.js`).
- Replay: correr el histórico de picks de clubes, esports, amfoot y hoops con la tupla y listar cuántas picks tenían precio de una línea y probabilidad de otra. Ese número va al registro.
- Aceptación: `tests/contrato.test.js` con precio de otra línea → rechazo antes de valorar; A/B invertidos → misma clave canónica.

### T1.3 Cierres: prepartido real y mismo contrato (A11)
- `implied-engine/closes.js` y las capturas de cada motor: el cubo T−1 solo se escribe si `ahora < inicio_real`; el inicio real viene del marcador (ESPN, WTT, Flashscore) cuando existe. Cierres tomados después del inicio se marcan `in_play` y se excluyen de `q_cierre`. Contar cuántos había.
- Aceptación: cero cierres con `at > inicio_real` en los tracks recalculados.

### T1.4 Cuartos asiáticos (A22, §3.2)
- `goal-engine/markets.js:54-57` y toda réplica (buscar `fairAt`, `components`, "half-stake"): promediar pagos. `A = E[w]`, `B = E[l]`, `o_fair = 1 + B/A`, `p_equiv = A/(A+B)`. Lo mismo en hándicaps asiáticos de fútbol (`futbol-derivadas.js`), esports y baloncesto si cotizan cuartos.
- Aceptación: en `tests/cuartos.test.js`, over 2,25 con P(<2)=0,30, P(=2)=0,25, P(>2)=0,45 → `o_fair = 1,944444`.

### T1.5 Inferencia común (A30)
- `lib/inferencia.js`: bootstrap por clusters (evento; serie en esports; partido en TT; carrera en F1), n_tickets y n_eventos separados, intervalos de ROI remuestreando beneficio y stake conjuntamente, y una función `bh(pvalores, q=0,10)` para comparaciones múltiples. Prohibido calcular un t sobre tickets como si fueran independientes en cualquier track nuevo.
- Aceptación: los IC de NFL, NCAAF y props CS2 del §5.2 de la auditoría se reproducen con `lib/inferencia.js` sobre agregados a ±0,1 pp.

### T1.6 Tablero y feed **[DECISIÓN D2, D5]**
- `edge-board.js`: una cohorte por `rule_version`; conciliar las 96 filas declaradas contra las 98 sumadas por estado (A31); sustituir la columna "t" por `EV_cierre`, `t_clusters`, `n_eventos`, `veredicto`; quitar la etiqueta "confirmada" hasta que exista veredicto `invertible` con la vara nueva.
- Feed público: si D5 es sí, córners y goles pasan a la vista "modelo vs mercado" sin la palabra ventaja.

### T1.7 Cohortes de decisión y de caja (A32)
- `/api/internal/real` y el reporte semanal: separar "rendimiento por fecha de decisión con estado maduro" de "movimiento de caja por fecha de liquidación". Eliminar la fila que divide P&L liquidado del día por stake colocado del día, o renombrarla "tesorería".
- Reporte de los lunes (`shadowWeeklyReport`): usar las cohortes nuevas y la vara nueva; incluir `DATA_UNRESOLVED` y el rango de P&L asignando a los no resueltos su pago máximo y mínimo (§3.3).

### T1.8 Parada (A07) **[DECISIÓN D3]**
- `real-executor/parada.js`: recalcular las cuatro líneas con el stake y la cuota media **realmente servidos** por canal (tarjetas a 30 o 40 según env; tenis de mesa a 5; CS2 a 5 si se enciende). La línea 1 hoy solo mira tarjetas: añadir tenis de mesa y CS2 con sus parámetros. Las líneas 2 y 3 miden picks; pasarlas a apuestas colocadas.
- Si D3 es sí: cuando una línea cruza, `RE.frenos()` devuelve `freno: parada_<n>` para órdenes nuevas del canal afectado, con registro y correo; `GP_PARADA_BLOQUEA=off` lo desactiva.
- Aceptación: `tests/parada.test.js` con el ejemplo de la auditoría: 100 apuestas, cuota 1,81, p = 1/1,81 + 0,07 → percentil 1 = 51 victorias → −230,70 a stake 30 y −307,60 a stake 40.

### T1.9 Retirar versiones **[DECISIÓN D4]**
- `derivadas_v1`, hándicap de kills v1, UFC ganador bruto, Boleto GP con EV agregado, y las cinco familias con veredicto cerrar: dejan de aparecer como picks; siguen en sombra con `rule_version` y etiqueta "control". El Boleto GP pasa a mostrar las piernas sin EV ni Kelly combinados hasta tener precio real del producto y probabilidad conjunta (§6.5).

### T1.10 Ejecutor: reserva, saldo, Kelly (A08, hallazgo Kelly)
- `real-executor/store.js`: reserva atómica de exposición antes de enviar (escribir la fila con `stake_comprometido` y guardar **antes** de la llamada al relay); saldo desconocido bloquea en vez de estimarse; `Kelly ≤ 0` o `ev_net ≤ 0` → stake cero sin tope que lo reactive (hoy el 14 % de las señales sale con EV medio −2,1 % y se apuesta el tope). Timeout tras enviar → consultar por referencia, nunca reenviar con id nuevo (verificar que la rama existente cubre todos los códigos).
- Aceptación: `tests/ejecutor.test.js`: EV negativo → stake 0; saldo `null` → freno `saldo_desconocido`; timeout simulado → `EN_ACEPTACION` y consulta por referencia.

### T1.11 Polymarket: comisiones por fill (A09)
- Verificar la tarifa vigente por mercado en la documentación de Polymarket **el día de la tarea** y guardar la URL y el texto en `docs/CONTRATOS_CASA.md`. Aplicar `fee = C·tasa·p·(1−p)` (o la que diga la documentación) por fill en `propfirm/polyshadow.js` y `polymarket/ejecutor.js`. Recalcular la sombra desde el origen con la fee; publicar antes y después.

### T1.12 Baloncesto: puertas que no actúan (A15)
- `buildHoopsPicks`: la puerta de frescura lee `best.at` y la fila trae `seen`; la regla "solo under" compara `'total'` cuando la familia es `match_total`. Arreglar ambas, con sello de era. Son dos líneas.

### T1.13 Replay del histórico
- Con T1.1–T1.5 desplegados: recalcular todos los tracks (clubes, derivadas, esports por juego, props, hoops, amfoot, NFL, tenis, TT, dardos, combate, F1, sombra, Polymarket) y publicar `docs/METRICAS_RECALCULADAS_2026-09.md`: por familia y versión, n_tickets, n_eventos, EV_cierre con IC por clusters, ROI con IC, `DATA_UNRESOLVED`, veredicto nuevo, y **al lado el veredicto antiguo**. Este documento es el entregable de la Fase 1.

### T1.14 Fuentes caídas
- Pinnacle devuelve cero eventos de tenis de mesa con `available: true` (`data-providers/tt/books.js`, `pinnacle()`): comprobar el endpoint y el id de deporte; si Pinnacle dejó de publicar, documentarlo. Comprobar lo mismo en dardos y esports.

---

## 5. Fase 2 — Los cuatro challengers (semanas 2 y 3)

Objetivo: para cada prioridad, un conjunto de modelos emparejados sobre las **mismas filas y los mismos precios**, con protocolo temporal anidado (§4.4), competidores obligatorios (§4.3) y registro de todo intento en `docs/REGISTRO_EXPERIMENTOS.md`. Ninguno entra a dinero en esta fase.

### 5.1 Tarjetas (E1, E2, A19, A20, §3.4, §6.1)

- **T2.1 Contrato de tarjetas.** Construir un conjunto de 40 partidos reales con incidencias (segunda amarilla, roja directa, tarjeta a suplente, a cuerpo técnico, tras el pitido final, en prórroga) y contrastar: nuestro recuento (fuente), la regla de Cloudbet y el pago real de las apuestas liquidadas. Salida en `docs/CONTRATOS_CASA.md`. Si el contrato no cuenta lo que contamos, corregir el liquidador y reliquidar el libro real.
- **T2.2 Árbitro servido = árbitro entrenado (A19).** `server.js:8489` llama a `project()` sin `referee` mientras `prop-engine/model.js:98` lo espera y la validación LOO lo usa. Decidir una de dos: conectar el árbitro en producción **o** quitarlo de la validación. En el challenger T2b se conecta; T0 queda tal cual para comparar.
- **T2.3 Challengers.** `scripts/cards-challengers.js`: T0 (actual, íntegro), T1 (nivel dinámico por liga×temporada con dispersión estimada; competidores histograma suavizado, Poisson, NB y COM-Poisson), T2a (T1 + fuerzas de equipo), T2b (T2a + árbitro residual controlando liga y equipos). Walk-forward con selección de hiperparámetros dentro del entrenamiento. Puntuación: log-score y CRPS del total, y calibración en **las líneas realmente ofrecidas** (4,5 a 6,5), no solo 2,5/3,5.
- **T2.4 E1: ¿ventana o mezcla?** Reponderar el libro real a mezcla fija de liga×línea×horizonte y separar el cambio dentro de estrato del cambio entre estratos. Registrar eventos de disponibilidad de mercado (`cloudbetCercania` ya captura; añadir mercados sin pick).
- **T2.5 A20: contrafactual sin doble conteo.** Rehacer la autopsia del libro real con las causas como partición (cada ticket en un solo grupo) y el contrafactual de una posición por partido con la regla aplicable con información de entonces.
- **T2.6 Preregistro nuevo** en `docs/PREREGISTRO_CARDS_V2.md`: regla, universo, casa, líneas, tamaño objetivo calculado con `lib/inferencia.js` sobre la varianza real del libro, y fecha de inicio. Solo cuentan tickets posteriores a la fecha.

### 5.2 CS2 (E3, A16, A17, A18, §7.1, §7.2)

- **T2.7 S1 en `esports-engine/cs2.js`:** tipar `p_round`, `p_map`, `p_series`; resolver `p_round` por bisección para que la simulación de mapa reproduzca `p_map`; compilar la serie con los `p_map` resultantes; momentum apagado por defecto en el challenger; veto: distribución sobre vetos factibles prematch y condicionamiento exacto cuando el veto se publica. Prueba de ida y vuelta mapa↔ronda↔serie con tolerancia 0,002.
- **T2.8 E3:** mismas series, mismos mapas, mismas líneas: modelo actual vs S1 vs `p = 0,5`, valorados a Pinnacle y a Cloudbet por separado, con `EV_cierre` por contrato. Si S1 elimina el ROI antiguo, se acepta: no se conserva el sesgo para conservar el backtest.
- **T2.9 Props (A18):** verificar el producto de Underdog (tipo de entrada, multiplicadores, reglas de anulación, correlación permitida, comprobante de pago) y guardarlo en `docs/CONTRATOS_CASA.md`. P1: simular conjuntamente rondas de los dos mapas, KPR con incertidumbre y forma compartida; dedupe por serie canónica|jugador|stat|lado|política. Evaluar el **ticket** con su pago real, no la pierna teórica a −112.

### 5.3 Tenis de mesa (E5, A25, hallazgos propios)

- **T2.10 Incertidumbre por familia.** `tt-engine/data.js:143-146`: `unc_pp` es la incertidumbre del ganador y se usa como listón para totales. Definir una incertidumbre propia para totales (varianza del total simulado bajo la incertidumbre de los ratings) y medir cuántas tesis nacen con cada una. Solo sombra.
- **T2.11 Descomposición de la duración.** `E[puntos] = Σ P(n_games = k)·E[puntos | k]`, por gap, formato, competición y antigüedad, contra el holdout (71,885 real vs 71,232; sweep 0,4005 vs 0,4117; deuce 0,1578 vs 0,1489). Challengers TT1 (Elo recalibrado + empírico de puntos por gap/formato), TT2 (saque/resto jerárquico si es identificable), TT3 (forma persistente).
- **T2.12 Identidades de QA** (§10.2): en un game, −1,5 puntos ≡ ganar el game; over 20,5 ≡ over 21,5 ≡ deuce. Usarlas como prueba del catálogo y de los precios.
- **T2.13 Población válida:** solo 30.644 de 192.460 filas con fecha exacta; medir cómo difieren las excluidas y no imputar fechas para validación temporal.

### 5.4 Tenis ATP BO3 totales (E6, A23, A24)

- **T2.14 Datos:** `data_as_of` por componente; actualizar saque/resto (hoy congelados en mayo); superficie certificada por evento; tiebreak por edición; tasa de activación de los clamps [0,45; 0,80].
- **T2.15 C6 legal:** modelar primero P(2 sets / 3 sets) y después games condicionados, con marcadores legales; comparar contra compilador básico, empírico por favoritismo y mercado, en el mismo universo.
- **T2.16 Preregistro:** los ocho casos prospectivos existentes se separan del histórico; el preregistro se completa solo con muestra nueva.

---

## 6. Fase 3 — Sombra preregistrada y puertas (semana 4 en adelante)

- Cada challenger que pase G1 entra en sombra con versión fija, precios realmente vistos, y regla de parada escrita antes de la primera observación. Revisiones preprogramadas (no un t cada hora).
- Puertas, adoptadas de la auditoría:
  - **G0 integridad:** contratos, pagos, identidad, tiempos, libro y cierres reconciliados; ningún P0 abierto en la ruta.
  - **G1 señal histórica:** walk-forward anidado, competidores obligatorios, universo completo, diferencia pareada con IC por clusters, selección y costes incluidos.
  - **G2 sombra prospectiva:** versión fija, criterio preregistrado, control de comparaciones múltiples, cuotas ejecutables observadas.
  - **G3 piloto real:** solo con presupuesto absoluto de pérdida y límites por evento y día, para validar fills y contabilidad. Veinte órdenes bien ejecutadas no validan el edge.
  - **G4 escalar:** rentabilidad neta con incertidumbre, capacidad demostrada, límites de drawdown; subir tamaño gradualmente midiendo degradación de precio.
- El punto de decisión del 20-oct pasa a ser **revisión de integridad, calibración y viabilidad**, no certificación por 100 tickets.
- Libro transaccional (§12.1): decidir en esta fase si se migra el libro real a una base transaccional (`pg` ya está disponible) o si basta con el archivo append-only. Recomendación: append-only con hash encadenado para el libro real y las cotizaciones, reutilizando `signal-registry/` (hoy apagado por defecto), antes que una migración completa.

---

## 7. Backlog P1/P2 por deporte (después de las cuatro prioridades)

| ID | Tarea | Archivos |
|---|---|---|
| A12 | Baloncesto: rehacer el holdout de lesiones sin el boxscore del propio partido; si no hay snapshots PIT, validar sin esa capa y empezar a guardarlos | `basketball-engine/injuries-history.js`, `scenarios.js` |
| A13 | Baloncesto: denominador de minutos por liga (240 NBA / 200 WNBA) y prueba con alineación de impacto conocido | `basketball-engine/minutes.js`, `lineups.js` |
| A14 | Baloncesto: peso de mercado por familia; no transportar el de ML a totales; breakeven a −110 es 0,52381, no 0,5 | `basketball-engine/pricing.js` |
| A17 | Valorant: calibración por favoritismo y lado (p ≥ 0,70 daba 74,5 % y ocurría 42,3 %); revisar orientación | `esports-engine/valorant.js` |
| A21 | Córners: DAMP y prior de equipo separados; árbitro fuera de producción; challengers C0–C3 | `server.js` bloque REFS, `prop-engine` |
| A22 | Goles y mitades: no transportar la calibración de λ del cierre de Pinnacle a las derivadas del modelo; segunda mitad condicionada al marcador de la primera | `goal-engine/mitades.js`, `descanso.js` |
| A26 | Dardos: el DP aproxima el bust volviendo al resto actual; el kernel de visita vuelve al inicio de la visita. Unificar el estado; sensibilidad sin caché (pT×10, pD×20) | `darts-engine/kernel.js`, `compiler.js` |
| A27 | Dardos: calibrar a estadísticas observadas simulando la misma censura del leg que el dataset | `darts-engine/data.js`, `scripts/darts-fit.js` |
| A28 | Fútbol americano: atlas con pool estrictamente pasado, coordenadas coherentes, media realizada vs solicitada, paridad T ≥ |M| | `nfl-engine/posterior.js`, `simulate.js` |
| A29 | NFL: hora local → UTC con zona real; plantillas 2026, no 2025 | `nfl-engine/data.js`, `scripts/nfl-harvest.js` |
| A33 | Combate: mercado recalibrado como control; métodos y ganador coherentes; señal de peso con el mismo significado al entrenar y servir; el corte por doce cubos sobre 140 no se vuelve a citar | `combat-engine/*` |
| A34 | F1: DNF y H2H por reglamento; winner ≤ podio ≤ puntos tras calibrar; lista de participantes del evento actual; copia del archivo juez | `f1-engine/*` |
| A36 | Fuentes: inventario con licencia, cobertura, coste, alternativa; revisar `RIGHTS.md` de LoL a la luz de CC BY-SA | `data/*/RIGHTS.md` |
| H-L1/L2 | LoL: medir `winner_kills < loser_kills` en la base; probar que el total del generador no cambia con `pMap`; `gen-priors.json` corresponde a `lol-gen-1` y producción corre `lol-gen-2` | `esports-engine/lol-gen.js` |
| D-Dota | Dota 2: parar la liquidación prematura de series; no elegir equipo por mayor historial ante nombres ambiguos (A10) | `esports-engine/dota2.js`, `results.js` |

---

## 8. Mapa A01–A36 → tareas

| Auditoría | Tarea | Fase |
|---|---|---|
| A01 | T1.2 | 1 |
| A02 | T0.4 | 0 |
| A03, A04, A05 | T0.5 | 0 |
| A06 | T1.1 | 1 |
| A07 | T1.8 | 1 |
| A08 | T0.2 (contable), T1.10 (ejecutor) | 0–1 |
| A09 | T1.11 | 1 |
| A10 | T1.2 (tupla) + D-Dota | 1 / backlog |
| A11 | T1.3 | 1 |
| A12–A14 | Backlog | — |
| A15 | T1.12 | 1 |
| A16 | T2.7 | 2 |
| A17 | T2.7 (CS2) + backlog (Valorant) | 2 / backlog |
| A18 | T2.9 | 2 |
| A19 | T2.2 | 2 |
| A20 | T2.5 | 2 |
| A21, A22 | Backlog (A22 parcial en T1.4) | — |
| A23, A24 | T2.14, T2.15 | 2 |
| A25 | T2.11 | 2 |
| A26, A27, A28, A29 | Backlog | — |
| A30 | T1.5 | 1 |
| A31 | T1.6 | 1 |
| A32 | T0.6, T1.7 | 0–1 |
| A33, A34 | Backlog | — |
| A35 | G3/G4 | 3 |
| A36 | Backlog | — |
| E1, E2 | T2.4, T2.3 | 2 |
| E3 | T2.8 | 2 |
| E4 | T2.9 | 2 |
| E5 | T2.11 | 2 |
| E6 | T2.15 | 2 |
| E7 | Fase 3, con la vara nueva (curva retorno vs ventaja declarada en `EV_cierre`) | 3 |
| E8 | T1.13 (replay de NCAA/CFL con tupla y cierre justo) | 1 |
| E9 | G3 | 3 |

---

## 9. Registro de experimentos (formato)

`docs/REGISTRO_EXPERIMENTOS.md`, una fila por intento, sin borrar los fallidos:

```
| fecha | id (Tn.m / En) | familia | versión/commit | universo (fechas, n_eventos) | métrica primaria | competidores | resultado | decisión | quién |
```

Un experimento que falla se conserva con su motivo. No se abre otra banda sobre la misma muestra y se suma al original.

---

## 10. Qué esperar al final de cada fase

| Fase | Entregable | Cómo se comprueba |
|---|---|---|
| 0 | Dinero reconciliado; liquidadores sin VOID falso; tenis de mesa con una posición por partido y Star Contender dentro; tarjetas pausadas si D1a | `/api/internal/real` sin descuadres; pruebas de liquidación en verde; sonda de TT con Astana verificado |
| 1 | `docs/METRICAS_RECALCULADAS_2026-09.md`: todas las familias bajo la vara nueva, con veredicto viejo al lado | Ningún track usa CLV − margen; ningún cierre in-play; IC por clusters en todas las tablas |
| 2 | Cuatro informes de challengers con comparación pareada y preregistros nuevos | `docs/REGISTRO_EXPERIMENTOS.md` con todos los intentos; `docs/PREREGISTRO_*_V2.md` fechados |
| 3 | Sombras en marcha con puertas; decisión mantener/cerrar por familia con evidencia nueva | Revisión preprogramada; nada promovido sin G2 |

Lo que este plan no promete: que alguna familia salga invertible. Lo que sí promete: que cuando una lo parezca, el número que lo diga sea el correcto.
