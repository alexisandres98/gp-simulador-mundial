# La segunda mitad SÍ depende del marcador al descanso

**16-sep-2026 · A22 del backlog de la auditoría externa**

Correr: `node scripts/mitades-condicional.js [--json salida.json]`
Módulo afectado: `goal-engine/mitades.js` (`descansoFinal`, `h2_*`, `htft`)

---

## Las dos mitades de A22

> «Goles y mitades: no transportar la calibración de λ del cierre de Pinnacle a las derivadas del modelo;
> segunda mitad condicionada al marcador de la primera.»

Son dos cosas distintas. La primera es un problema de **contabilidad del error**; la segunda, de **modelo**.
Las dos tienen ahora número.

---

## 1. El listón estaba midiendo otra cosa

La tabla `ERROR_CAL` de `goal-engine/mitades.js` se midió resolviendo λ del **cierre real de Pinnacle** y
derivando la mitad de ahí. Eso responde: *dado un λ correcto, ¿cuánto se desvía la partición en mitades?*
La respuesta —entre 0,008 y 0,058— es la que está escrita y es correcta.

Pero no es la pregunta que decide una pick. En producción λ no sale del cierre: sale de **nuestro modelo**,
que trae su propio error. El error de lo que publicamos es:

```
error(derivada publicada)  ≈  error(estructura de mitades)  ⊕  error(λ del modelo)
```

y el listón solo cuenta el primer término. **Subestima**, siempre en la misma dirección: se exigen 3 + 5,8 pp
donde habría que exigir 3 + 5,8 + x, así que nacen picks que no deberían nacer.

El segundo término **no está medido y no se ha inventado**. Medirlo exige rehacer las 33 mil validaciones
con el λ point-in-time del modelo de clubes, no con el implícito del cierre. Hasta entonces:

- `listonDe()` devuelve **lo mismo que antes** — no se cambia en silencio qué picks nacen;
- `listonDetalle()` declara que es parcial, con su procedencia y su hueco, y eso viaja a la sonda.

Un listón que se presenta como completo cuando le falta un término es peor que uno que se presenta como
parcial: el segundo invita a cerrarlo.

---

## 2. La segunda mitad no es independiente de la primera. Está medido.

**27.816 partidos**, 80 ficheros de football-data.co.uk (16 divisiones × 5 temporadas). λ resuelta del
**cierre**, no del modelo, para que lo que se mida sea la condicionalidad y no el error del modelo encima.
La predicción independiente es la del módulo: λ_2T = λ_partido × (1 − 0,446), la misma para todos los
estados **por construcción**.

| estado al descanso | n | local: obs | pred | desvío | visitante: obs | pred | desvío |
|---|---:|---:|---:|---:|---:|---:|---:|
| local pierde por 2+ | 1.729 | 0,774 | 0,697 | **+0,076** (t 3,6) | 0,811 | 0,848 | −0,037 (t −1,7) |
| local pierde por 1 | 5.245 | 0,869 | 0,752 | **+0,117** (t 9,6) | 0,692 | 0,746 | **−0,054** (t −4,7) |
| empate a 0 | 8.218 | 0,767 | 0,793 | −0,026 (t −2,8) | 0,636 | 0,666 | −0,030 (t −3,5) |
| empate con goles | 3.216 | 0,836 | 0,823 | +0,013 (t 0,8) | 0,661 | 0,690 | −0,030 (t −2,2) |
| local gana por 1 | 6.652 | 0,824 | 0,883 | **−0,060** (t −5,5) | 0,680 | 0,628 | **+0,052** (t 5,2) |
| local gana por 2+ | 2.756 | 0,969 | 1,017 | **−0,048** (t −2,7) | 0,632 | 0,582 | **+0,050** (t 3,4) |

### Lo que hay que mirar no es el tamaño, es el SIGNO

Un sesgo global —todos los estados desviándose igual— sería un problema de la constante 0,446 y se
arreglaría cambiándola. **Aquí el signo se invierte**:

- el equipo que va **perdiendo** marca **más** de lo previsto (+0,117 goles el local que pierde por uno);
- el equipo que va **ganando** marca **menos** (−0,060 el local que gana por uno, −0,048 si gana por dos);
- y el visitante hace exactamente lo simétrico (−0,054 cuando va ganando, +0,052 cuando va perdiendo).

**El rango entre estados es 0,177 goles en el local y 0,106 en el visitante.** Sobre una λ de mitad de ~0,75,
eso es un **24 %**. No es ruido y no se arregla con una constante: el que pierde se abre y el que gana se
echa atrás, y el modelo independiente no lo ve.

Cinco de los seis estados tienen |t| ≥ 3.

### Por qué la correlación 1T↔2T de 0,05 no lo había detectado

Porque mide otra cosa. `0,05` es la correlación entre los **goles totales** de una mitad y los de la otra, y
esa es genuinamente pequeña — los efectos se cancelan al sumar los dos equipos. Lo que cambia con el
marcador no es cuántos goles se marcan sino **quién los marca**. El total puede quedar igual y el reparto
cambiar mucho, que es exactamente lo que enseña la tabla.

Esa distinción es la aportación de A22 y era correcta.

---

## Qué familias toca

De las quince derivadas abiertas, la condicionalidad afecta a **cuatro**:

- **`htft`** (descanso/final) — la más afectada, y su error declarado ya decía «el modelo no ve las
  remontadas» con 0,047. Ahora ese 0,047 tiene una causa medida detrás en vez de una sospecha.
- **`h2_1x2`**, **`h2_ah`**, **`h2_team_total`** — las de segunda mitad con lado. Sus errores declarados
  (0,022 · 0,022 · 0,032) se midieron PROMEDIANDO sobre todos los estados, así que promedian un +0,117 con
  un −0,060 y salen pequeños. El error condicional a un estado concreto es mucho mayor.

**`h2_total`** (el total de la segunda mitad, sin lado) es la que MENOS se ve afectada, justo por lo mismo:
los dos desvíos se cancelan al sumar.

Las de primera mitad no se ven afectadas: al descanso todavía no hay marcador del que condicionar.

---

## Lo que queda para Alexis

1. **Modelar la segunda mitad condicionada al marcador del descanso.** La forma natural es un multiplicador
   por estado sobre cada λ de mitad, estimado sobre estas mismas 27.816 filas y validado hacia adelante.
   Cambia `htft` y las tres familias con lado de la segunda mitad.
2. **Mientras tanto, subir el listón de esas cuatro familias**, o cerrarlas. Su error declarado está
   promediado sobre estados que se cancelan, así que es una cota inferior de lo que de verdad se desvían.
3. **Cerrar el término que falta del listón**: rehacer la validación con el λ del modelo en vez del del
   cierre.

Ninguna se ha aplicado. Son decisiones de modelo.
