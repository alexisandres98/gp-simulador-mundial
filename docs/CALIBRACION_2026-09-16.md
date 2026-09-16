# La probabilidad que decimos no es la que ocurre — y no es un problema de orientación

**16-sep-2026 · A17 del backlog de la auditoría externa · medido sobre los nueve libros liquidados**

Sonda viva: `/api/internal/calibracion?key=$GP_EXPORT_KEY` (`&motor=`, `&detalle=1`)
Módulo: `lib/calibracion.js` · Test: `tests/calibracion.test.js`

---

## Lo que pedía A17, y por qué la respuesta es otra

La auditoría señaló Valorant —«p ≥ 0,70 daba 74,5 % y ocurría 42,3 %»— y propuso **revisar la
orientación**: la sospecha de que estuviéramos liquidando el lado contrario.

**No es eso.** Un volteo de orientación tiene una firma muy concreta: lo que un lado se pasa, el otro se
queda corto. Medido lado a lado, en las 382 liquidadas de Valorant los dos lados se desvían **en la misma
dirección**:

| familia · lado | dice el modelo | ocurre | se desvía |
|---|---:|---:|---:|
| RONDAS_HANDICAP · local | 51,3 % | 32,6 % | **+18,8 pp** |
| RONDAS_HANDICAP · visitante | 50,2 % | 36,6 % | **+13,7 pp** |
| RONDAS · under | 50,5 % | 39,3 % | **+11,2 pp** |

Y el cubo de probabilidad BAJA también cae (dice 39,1 %, ocurre 31,1 %), cosa que un volteo no puede
producir. Buscar y "arreglar" una orientación que está bien es una forma segura de romperla, así que
conviene que esto quede escrito: **no hay un solo volteo en todo el sistema**.

## El control que convierte esto en un diagnóstico: el precio

Sobre **las mismas apuestas**, la probabilidad implícita del mercado se desvía 2,1 pp donde el modelo se
desvía 12,8. Ese contraste es lo que separa "el modelo está mal" de "la muestra es rara": si los dos
fallaran igual, el problema estaría en cómo se eligen las picks, no en el modelo.

## El patrón, y es el mismo en ocho de los nueve motores

| motor | n | modelo | precio | Brier modelo | Brier precio | veredicto |
|---|---:|---:|---:|---:|---:|---|
| `esports:cs2` | 1.726 | **+10,2 pp** (t 5,73) | +0,2 pp | 0,25198 | 0,23928 | descalibrado |
| `esports:lol` | 1.133 | **+13,4 pp** (t 7,05) | −0,4 pp | 0,27051 | 0,23773 | descalibrado |
| `tenis` | 771 | **+10,6 pp** (t 3,77) | −1,7 pp | 0,25054 | 0,23634 | descalibrado |
| `tt` | 449 | **+15,8 pp** (t 4,23) | +4,4 pp | 0,26633 | 0,23379 | descalibrado |
| `esports:valorant` | 382 | **+12,8 pp** (t 4,29) | +2,1 pp | 0,24536 | 0,22418 | descalibrado |
| `esports:dota2` | 235 | **+14,9 pp** (t 4,17) | +4,3 pp | 0,27661 | 0,25257 | descalibrado |
| `hoops` | 186 | +1,4 pp (t 0,21) | −3,0 pp | 0,24169 | 0,24580 | **calibrado** |
| `dardos` | 41 | +25,0 pp | +16,0 pp | 0,25280 | 0,21925 | muestra sesgada |
| `nfl` | 29 | +24,8 pp | +13,5 pp | 0,29630 | 0,25891 | muestra sesgada |

Todo con **bootstrap por racimos de evento**: dos mapas de la misma serie o dos juegos del mismo partido no
son dos observaciones, y contarlos como tales infla cualquier t.

Tres lecturas:

1. **El modelo se pasa entre 10 y 16 puntos porcentuales; el precio acierta entre 0 y 4.** En seis motores
   con muestra suficiente, y en cada familia que genera picks. Esto no contradice la autopsia del 2-sep: la
   confirma con otro método y con más datos.
2. **Baloncesto es la excepción** — calibrado dentro del ruido. Sus picks ya están apagadas y lo que se
   publica sale de precios entre casas, no del modelo: es la única familia donde la doctrina y la medición
   ya coincidían.
3. **Dardos y NFL fallan los DOS** (modelo y precio). Con 41 y 29 apuestas eso no señala al modelo: señala
   a cómo se han elegido esas apuestas, o sencillamente a que no hay muestra. No se saca ninguna conclusión
   de modelo de ahí.

## El sesgo de selección, que hay que tener presente al leer

Estas apuestas **no son una muestra al azar de las predicciones**: existen porque el modelo dijo más que el
precio. Con un modelo ruidoso, las de más ventaja declarada son aquellas donde el ruido salió más a favor, y
regresan más — por eso la desviación crece con la probabilidad (+18,8 pp arriba contra +7,9 abajo).

Por tanto **lo medido aquí es un techo del error de calibración, no su medida limpia**. La medida limpia
exige el universo COMPLETO de predicciones, no solo las que pasaron el filtro. Está declarado en la salida
de la sonda (`aviso_seleccion`) y no debe borrarse de ahí.

Ahora bien, el techo ya dice algo suficiente para decidir: en las apuestas que de verdad hacemos, la
probabilidad del modelo es peor que la del precio, por Brier y por calibración, en todos los deportes con
muestra. Que la medida limpia fuera mejor no cambiaría el hecho de que **lo que se publica es esto**.

## Qué NO se ha hecho, y por qué

No se ha recalibrado nada. La fórmula operativa ya está escrita desde el 2-sep:

```
p* = σ( logit(p_mkt sin margen) + c·[ logit(p_gp) − logit(p_mkt) ] )
```

con `c` ajustado por familia fuera de muestra. Lo que estas mediciones añaden es que, en todas las familias
de la tabla salvo baloncesto, `c` saldría cercano a cero o negativo — o sea, la recomendación sería hacerle
caso al precio y no al modelo.

Aplicar eso **cambia cómo nace cada pick del sistema**, y esa es una decisión de Alexis, no de un módulo de
medición (regla del dinero, 13-sep). `lib/calibracion.js` mide y enseña; no toca ninguna probabilidad
publicada.

## La decisión que queda abierta

Con la vara nueva ninguna de estas familias es invertible, así que recalibrar no desbloquea dinero: lo que
haría es que las picks publicadas dijeran la verdad sobre su propia probabilidad. Hoy una tarjeta que dice
«60 %» acierta el 45 %, y eso es un problema de producto aunque no haya un euro detrás.

Dos caminos, y los dos son de Alexis:

- **Aplicar el encogimiento al precio** (`c` por familia, fuera de muestra) en todas las familias en sombra.
  Las probabilidades publicadas pasarían a estar calibradas; la ventaja declarada se desplomaría, porque una
  probabilidad encogida al precio casi no puede tener ventaja contra el precio. Sería honesto y dejaría casi
  ninguna pick.
- **Dejar el modelo como está y etiquetar**: cada familia publica su desviación medida junto a su
  probabilidad. Mantiene el producto como está y le pone la etiqueta delante.
