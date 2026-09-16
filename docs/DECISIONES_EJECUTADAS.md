# Registro de decisiones ejecutadas

Cada fila es un cambio que **ya está aplicado en producción**, con su fecha, quién lo ordenó, qué se tocó y
cómo se revierte. Existe porque un interruptor cambiado sin registro es indistinguible de un accidente seis
semanas después, y porque el track se lee por cohortes: sin la fecha exacta del cambio no se sabe qué parte
de la muestra corresponde a qué regla.

---

## 16-sep-2026 — Fase B2 del plan de rentabilidad

Ordenadas en `docs/PLAN_RENTABILIDAD_2026-09-16.md` §1.2 (R1, R2) y §1.1 (M9). El plan autoriza
expresamente a la sesión ejecutora a cambiar estos interruptores por la API de Render y desplegar.

| # | qué | antes | ahora | revertir |
|---|---|---|---|---|
| **R1** | Canal REAL de tenis de mesa | `GP_REAL_TT_ENABLED=true` | **`false`** | poner `true` y desplegar |
| **M9** | Listón de TT por familia | `GP_TT_UNC_FAMILIA` sin poner | **`1`** | borrar la var y desplegar |
| **M9** | Deduplicación de equivalentes en TT | `GP_TT_DEDUP_EQUIV` sin poner | **`1`** | borrar la var y desplegar |
| **R2** | CS2 como canal real | ya `GP_REAL_CS2_ENABLED=false` | sin cambio; **retirado formalmente** | — |

Verificado después del despliegue: `/api/internal/real-tt` devuelve `resumen.canal: "apagado"`.

### El estado que deja: no queda ningún canal real encendido

| canal | interruptor | estado |
|---|---|---|
| Tarjetas under | `GP_REAL_CARDS_ENABLED=false` | apagado (pausado desde el 13-sep, fondos fuera) |
| CS2 rondas | `GP_REAL_CS2_ENABLED=false` | apagado (R2, retirado) |
| Tenis de mesa | `GP_REAL_TT_ENABLED=false` | **apagado hoy (R1)** |

`GP_REAL_ENABLED` sigue en `true`: es la llave maestra del ejecutor, no de un canal. Con los tres canales
apagados no coloca nada, y dejarla encendida mantiene vivos la conciliación y el barrido de liquidación de
lo que ya está colocado, que es justo lo que hace falta para cerrar bien las posiciones vivas.

### El número real del canal de TT, medido al cerrarlo

El plan justifica R1 con **EV al cierre −7,6 % (t −6,16)**. Al apagarlo se leyó el libro real entero, y el
resultado **realizado** es otro y conviene que conste:

| | |
|---|---|
| Apuestas liquidadas | **60** (de 71 creadas; 11 caducaron) |
| Apostado | **300 USDT** (5 planos) |
| Ganadas / perdidas | 33 / 27 |
| Cuota real media | **1,8198** |
| Acierto | **55,0 %** |
| Equilibrio a esa cuota | **55,0 %** |
| **P&L neto** | **0,00 USDT** — +135,00 en las ganadas, −135,00 en las perdidas |

Es decir: el canal quedó **exactamente en tablas**, no perdiendo. No contradice R1 y no la reabre, por dos
motivos escritos en la doctrina: el veredicto se toma con el **EV contra el cierre**, no con el ROI
realizado (§ La vara), y **60 apuestas no certifican nada** — a cuota 1,82 el intervalo del ROI con esa
muestra es de decenas de puntos. Pero un canal que se apaga con la cuenta en cero no es lo mismo que uno que
se apaga sangrando, y el registro tiene que decir cuál de los dos fue.

Los pagos vienen de la propia casa (`fuente_estado: 'graphql'`, `casa_estado` WIN/LOSS, `importe_casa_semantica: 'neto'`),
no de nuestro liquidador, así que esta cifra es dinero contado, no estimado.

### Nota sobre un campo que parece decir otra cosa

Las 60 apuestas llevan `envios: 0` y aun así están colocadas y pagadas. **No es un fallo.** `envios` no
cuenta envíos: cuenta cuántas veces hubo que **estrenar referencia nueva tras un rechazo de la casa**
(`real-executor/store.js`, la referencia solo se quema si la casa llegó a hablar). Una apuesta aceptada a la
primera tiene `envios: 0` por definición. Queda anotado aquí porque el nombre invita a leerlo mal.
