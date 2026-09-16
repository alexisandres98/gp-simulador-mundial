# Córners: el modelo actual pierde, y no debería compartir hiperparámetros con tarjetas

**16-sep-2026 · A21 del backlog de la auditoría externa**

Correr: `node scripts/cards-challengers.js --familia corners --dir <props-history> --rapido`
Preregistro y protocolo: el mismo que tarjetas (`docs/CHALLENGERS_TARJETAS_2026-09-15.md`).

---

## De qué iba A21

> «Córners: DAMP y prior de equipo separados; árbitro fuera de producción; challengers C0–C3.»

Tres cosas. Las tres tienen ahora un número detrás.

## El problema estructural: un solo DAMP para dos familias

`server.js` elige `TOTALS_DAMP` por liga con una búsqueda en rejilla sobre `[0, 0,25, 0,5]`, y el criterio
es el **skill COMBINADO de córners y tarjetas**:

```js
const score = (c.skill_vs_baseline || 0) + (k.skill_vs_baseline || 0);
```

O sea: el valor que gane en una familia se le impone a la otra. No hay ninguna razón para que las dos
compartan amortiguación — de hecho hay una razón medida para que no: los córners de local y visitante van
correlacionados **−0,249** y las tarjetas **+0,201**. Son dos conteos con estructura opuesta.

La forma de separarlos no era duplicar el arnés de tarjetas sino parametrizarlo, así que
`scripts/cards-challengers.js` acepta ahora `--familia cards|corners`. Sin el argumento, el comportamiento
de tarjetas es idéntico al del 15-sep.

## Lo que eligió cada familia, por su cuenta

Las dos corridas son comparables entre sí: mismo arnés, mismos ficheros, `--rapido` en las dos.

| | tarjetas | córners |
|---|---|---|
| **paridad** (el multiplicador 1,06 − 0,25·gap) | elegida en **9 de 10** bloques | elegida en **0 de 10** |
| amortiguación de fuerzas de equipo (`damp`) | entre 0,25 y 1 | **1 en 9 de 10** |
| vida media | **90 d** casi siempre | 730 d al principio, 90-180 d desde marzo |
| prior de liga | 5-60, inestable | 60 estable |
| **el árbitro, aislado** (T2b − T2a) | **−0,00309** (t −3,80): MEJORA | **+0,00087** (t 2,12): EMPEORA |

Dos contrastes se sostienen con claridad, y son los que importan:

1. **La paridad: 9 de 10 contra 0 de 10.** Un partido parejo se pica más —las tarjetas lo quieren en casi
   todos los bloques— y no se sacan más córners por ser parejo. Es un sí y un no rotundos sobre la misma
   señal.
2. **El árbitro va en direcciones opuestas y con significación en las dos.** Mejora las tarjetas (t −3,80)
   y empeora los córners (t +2,12). Eso valida exactamente la configuración que hay hoy en producción:
   `GP_CARDS_REF` encendido desde el 15-sep y `GP_CORNERS_REF` apagado — cada uno por su propia medición y
   no por una regla común.

Sobre `damp` el contraste es menos limpio de lo que esperaba: las dos familias lo eligen distinto de cero
en casi todos los bloques, así que el problema no es tanto «0 contra 1» como que **el auto-tune de
producción solo ofrece `[0, 0,25, 0,5]` y las dos familias piden con frecuencia 1**. La rejilla se queda
corta por arriba para las dos, y encima les impone un único valor.

Y la vida media apunta al revés de lo que dicta la intuición: las tarjetas quieren 90 días casi siempre —lo
reciente manda, seguramente porque las instrucciones a los árbitros cambian dentro de la temporada— y los
córners empiezan pidiendo 730 y se acortan a partir de marzo.

## El resultado: T2a gana a producción, y con holgura

Diferencia pareada de log-score contra T0 (el modelo actual), bootstrap por partido, 7.405 partidos con
predicción de los dos. Negativo = el aspirante gana.

| aspirante | Δ log-score | IC 95 % | t | p |
|---|---:|---|---:|---:|
| **T2a\|nb** (nivel + fuerzas de equipo, binomial negativa) | **−0,00365** | [−0,00555, −0,00187] | **−3,87** | **0,0001** |
| **T2b\|nb** (T2a + árbitro residual) | −0,00264 | [−0,00483, −0,00061] | −2,51 | 0,0119 |
| T1\|nb (solo nivel liga×temporada) | −0,00101 | [−0,00211, +0,00006] | −1,79 | 0,0741 |
| T2a\|poisson | +0,00120 | [−0,00254, +0,00480] | 0,63 | 0,5256 |
| T2b\|poisson | +0,00225 | [−0,00149, +0,00588] | 1,16 | 0,2460 |
| T1\|poisson | +0,00436 | [+0,00084, +0,00788] | 2,48 | 0,0130 |

Con Benjamini–Hochberg al 10 % (umbral 0,01304):

- **GANAN a T0: `T2a|nb` y `T2b|nb`.**
- **PIERDE contra T0: `T1|poisson`** — Poisson a secas es peor que lo que hay.
- Empate: el resto.

En córners **las fuerzas de equipo sí aportan**, y se ve en que `T2a|nb` − `T1|nb` es la mayor parte de la
mejora: −0,00365 contra −0,00101. El nivel dinámico solo (T1) no basta; lo que gana es añadirle el equipo.

## El árbitro: fuera de producción, y ahora con el número

`T2b|nb − T2a|nb` aísla exactamente el multiplicador residual del árbitro, porque los dos comparten todo lo
demás:

> **Δ log-score +0,00087 · IC [+0,00008, +0,00164] · t 2,12 · p 0,0340**

Positivo significa PEOR. El árbitro **empeora** la predicción de córners, y el intervalo no toca el cero.

Eso responde la segunda parte de A21 sin ambigüedad: `GP_CORNERS_REF` está apagado por defecto y **debe
seguir apagado**. No es prudencia, es la medición.

Y el contraste con tarjetas es directo, porque el mismo aislamiento corrido sobre la misma base da
**−0,00309 con t −3,80**: el árbitro **mejora** las tarjetas con la misma contundencia con la que empeora
los córners. Las dos configuraciones de producción —`GP_CARDS_REF` encendido desde el 15-sep,
`GP_CORNERS_REF` apagado— quedan cada una respaldada por su propia medición, que es exactamente lo que A21
pedía al separar las familias.

## Calibración en las líneas que se ofrecen

En 8,5 · 9,5 · 10,5, `T1|nb` se desvía entre +0,57 y +1,13 pp; las variantes Poisson se desvían hasta
−1,14 pp por debajo en 8,5 y +1,25 por encima en 10,5 — el patrón clásico de una ley sin sobredispersión:
demasiada masa en el centro y poca en las colas. La razón varianza/media de los córners lo confirma.

Un error de calibración de ~1 pp es **bueno** comparado con el suelo de ruido del método (2,9–3,4 pp en las
familias de control de `goal-engine/mitades.js`), pero por la doctrina del 13-sep ese error se SUMA al
listón de ventaja de la familia: córners no puede cobrar 1 pp de ventaja, porque 1 pp cabe dentro de su
propio error.

## Lo que NO dice este informe

No mide ventaja contra el mercado. No tenemos cierre histórico de córners fuera de línea, igual que en
tarjetas. Un ganador aquí describe mejor el conteo; **no** demuestra que haya dinero. El listón sigue
siendo `lib/vara.js` y la puerta sigue siendo G0–G4.

## Lo que queda para Alexis

1. **Separar `TOTALS_DAMP` por familia** en el auto-tune de `server.js`. Hoy un solo número sirve a dos
   familias que lo quieren en extremos opuestos (0 contra 1). Es un cambio de modelo: cambia qué picks
   nacen.
2. **Adoptar `T2a|nb` para córners**, que le gana a producción con t −3,87 sobre 7.405 partidos.
3. **Dejar el árbitro de córners apagado**, ahora con el +0,00087 (t 2,12) detrás en vez de por defecto.

Ninguna de las tres se ha aplicado. Son decisiones de modelo y las toma Alexis.
