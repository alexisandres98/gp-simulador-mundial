# Combate — modelo consciente del mercado: ¿algún rasgo añade información al cierre?

**Fecha:** 3 de septiembre de 2026. **Script:** `scripts/combat-market-aware.js` (sin red, sin server, sin db;
3 s). **Datos:** `data/combat/odds-history.json.gz` (6.090 peleas de UFC 2010-2024 con cuota de cierre, ver
`COMBATE_CUOTAS_HISTORICAS.md`). **Resultado en código:** `combat-engine/market-aware.js` +
`data/combat/market-aware-priors.json` (coeficientes **0**).

## Veredicto en tres líneas

1. **Ningún rasgo del modelo pasa t ≥ 2 fuera de muestra frente al cierre recalibrado.** El único candidato es la
   **edad** (coeficiente −0,149, t −3,3 en muestra; fuera de muestra Δlog-loss −0,00095 ± 0,00066, **t −1,45**,
   P(mejor) 0,93). Tamaño: una brecha de 8 años mueve ~3,7 pp a 50/50. Todo lo demás —alcance, experiencia,
   inactividad, racha, mentón, minutos, Elo— es cero o ruido.
2. Lo que SÍ mejora al cierre crudo es **recalibrarlo** (`a` = 1,11 sobre el logit, t 28,7; Δlog-loss −0,00084,
   t −2,37, 9 de 10 años): es el sesgo favorito-longshot que deja el de-vig proporcional, no un rasgo nuestro.
   Lo confirma Shin (−0,00072, t −2,96). Casi todo lo que un rasgo "mejora" frente al cierre crudo es esto.
3. Las **stats finas** (slpm, td15, tddef, ctrl, kdr) y el **pesaje real** no se pueden evaluar: en el archivo con
   cuota tienen 4 / 83 / 195 peleas activas en 2022 / 2023 / 2024 y ~90 pesajes en total. Sin la regla de
   actividad (≥ 200 filas ≠ 0 para entrar al ajuste) daban coeficientes de ±8 y un Δlog-loss de +0,35 en 2023.

Por tanto `marketAwareProb` devuelve hoy **el cierre tal cual** y `p_mkt_aware` en la pick es la `k` del consenso.
La maquinaria queda lista para cuando (si) un rasgo pase.

## 1. Qué se ajustó y cómo

    logit(p) = a · logit(p_cierre) + Σ b_i · x_i          sin intercepto (antisimétrico: inmune al orden f1/f2 de ESPN)

- `p_cierre`: implícita **proporcional** de-vig 2-way de la cuota del dataset (la misma forma que usa
  `combatFightOdds` en el server → sin skew entrenar/servir). Shin se reporta aparte.
- `x_i`: los 13 rasgos antisimétricos de `combat-engine/ratings.js#featDiff`, en su escala (reach, exp, years,
  age, chin, streak, mileage, misswt, slpm, td15, tddef, ctrl, kdr), reconstruidos con el **mismo walk-forward**
  de `combat-odds-history.js` (el `p_model` recomputado coincide con el archivado en las 6.090: máx |Δ| 0,00005).
  Más `delo` = logit(p_elo) − logit(p_cierre) (discrepancia del Elo puro) y `dmodel` (ídem, modelo ACTUAL).
- **Walk-forward por año:** para cada año Y (2015-2024) se entrena con TODAS las peleas cruzadas anteriores a Y
  (incluidas las del warm-up del Elo: son solo filas de entrenamiento) y se evalúa Y. Mínimo 800 de
  entrenamiento; un rasgo entra al ajuste solo si es ≠ 0 en ≥ 200 filas de entrenamiento (si no, 0: inerte).
- Evaluación **fuera de muestra** sobre las **4.180** peleas (2015-07 → 2024-12), pareada por pelea contra
  (a) el cierre solo y (b) el **cierre recalibrado** (`a` ajustado, sin rasgos). Bootstrap pareado 2.000
  remuestreos, semilla fija. Newton-Raphson con ridge 10⁻⁴; t del coeficiente = ajuste final 2010-2024.

## 2. Por rasgo — coeficiente, t y Δlog-loss pareado (n = 4.180)

| variante | coef (t) | Δlog-loss vs cierre | t | P(mejor) | Δlog-loss vs **recal** | t | P(mejor) |
|---|---|---|---|---|---|---|---|
| **cierre recalibrado** (solo `a`) | a = 1,112 (28,7) | **−0,00084** | **−2,37** | 0,991 | — | — | — |
| + age | −0,149 (**−3,3**) | −0,00180 | −2,28 | 0,991 | **−0,00095** | **−1,45** | 0,929 |
| + reach | +0,168 (1,9) | −0,00106 | −1,88 | 0,972 | −0,00021 | −0,48 | 0,68 |
| + exp | −0,002 (−0,1) | −0,00074 | −2,04 | 0,974 | +0,00010 | +1,48 | 0,06 |
| + years | −0,039 (−1,0) | −0,00083 | −1,77 | 0,961 | +0,00001 | +0,05 | 0,47 |
| + chin | +0,022 (0,5) | −0,00073 | −1,95 | 0,974 | +0,00011 | +0,95 | 0,19 |
| + streak | −0,077 (−1,0) | −0,00075 | −1,76 | 0,962 | +0,00010 | +0,35 | 0,36 |
| + mileage | +0,045 (0,9) | −0,00079 | −1,97 | 0,978 | +0,00005 | +0,23 | 0,41 |
| + misswt | inerte (92 peleas) | = recal | | | 0 | — | — |
| + slpm / td15 / tddef / ctrl / kdr | inertes en todos los pliegues | = recal | | | 0 | — | — |
| + delo (Elo − cierre) | −0,142 (−1,8) | −0,00090 | −1,82 | 0,966 | −0,00006 | −0,16 | 0,55 |
| + dmodel (modelo − cierre) | +0,069 (1,1) | −0,00068 | −1,43 | 0,927 | +0,00017 | +0,63 | 0,27 |
| físicos 7 (reach…mileage) | 8 cols | −0,00193 | −1,85 | 0,962 | −0,00109 | −1,12 | 0,86 |
| rasgos 13 | 14 cols (5 inertes) | −0,00193 | −1,85 | 0,971 | −0,00109 | −1,12 | 0,88 |
| full (delo + 13) | 15 cols | −0,00182 | −1,73 | 0,961 | −0,00098 | −1,00 | 0,85 |

ΔBrier va en la misma dirección y con la misma (in)significancia (age vs recal: −0,00046, t −1,58; físicos 7:
−0,00051, t −1,19). Referencias del 2-sep sobre las mismas peleas: modelo ACTUAL − cierre +0,0492 (t +11,3);
blend 0,5 − cierre +0,0145 (t +6,6).

**Lectura.** Con el listón justo (cierre recalibrado) solo la edad queda por debajo de cero con algo de cuerpo;
`delo` es exactamente cero: **la discrepancia del Elo con el cierre no lleva información** (el signo negativo en
muestra dice, si acaso, que cuando el Elo discrepa hay que fiarse aún más del cierre). Los coeficientes de los
7 físicos son estables entre pliegues (age −0,13…−0,18 desde 2017, reach +0,14…+0,20, mileage +0,18…+0,34) pero
su suma no mueve el log-loss más que la edad sola.

## 3. Por año (fuera de muestra; Δlog-loss frente al cierre solo, con t)

| año | n | log-loss cierre | recal | + age | + reach | + delo | físicos 7 |
|---|---|---|---|---|---|---|---|
| 2015 (jul-dic) | 200 | 0,6243 | +0,0016 (0,7) | +0,0026 (0,8) | +0,0010 (0,4) | +0,0042 (1,2) | +0,0058 (1,2) |
| 2016 | 468 | 0,6213 | −0,0004 (−0,8) | **−0,0025 (−2,3)** | −0,0006 (−0,4) | +0,0003 (0,3) | −0,0028 (−1,3) |
| 2017 | 428 | 0,6169 | −0,0002 (−0,3) | **−0,0045 (−2,1)** | −0,0002 (−0,1) | −0,0004 (−0,4) | −0,0014 (−0,5) |
| 2018 | 449 | 0,6042 | −0,0010 (−1,5) | −0,0015 (−0,6) | −0,0020 (−1,4) | −0,0013 (−1,5) | −0,0037 (−1,1) |
| 2019 | 472 | 0,6278 | −0,0001 (−0,1) | +0,0001 (0,0) | −0,0006 (−0,4) | −0,0017 (−1,5) | −0,0023 (−0,7) |
| 2020 | 414 | 0,6169 | −0,0009 (−0,9) | −0,0011 (−0,4) | −0,0021 (−1,1) | −0,0009 (−0,6) | −0,0016 (−0,4) |
| 2021 | 471 | 0,6284 | −0,0006 (−0,5) | −0,0015 (−0,7) | −0,0011 (−0,6) | −0,0019 (−1,3) | −0,0021 (−0,7) |
| 2022 | 479 | 0,6037 | −0,0013 (−1,2) | −0,0010 (−0,4) | +0,0001 (0,0) | −0,0007 (−0,4) | +0,0011 (0,4) |
| 2023 | 416 | 0,5864 | **−0,0028 (−2,1)** | **−0,0071 (−3,0)** | −0,0026 (−1,4) | −0,0030 (−1,7) | **−0,0076 (−2,6)** |
| 2024 | 383 | 0,5891 | −0,0017 (−0,9) | +0,0007 (0,2) | −0,0017 (−0,8) | −0,0010 (−0,4) | −0,0007 (−0,2) |

La edad "gana" en 2016, 2017 y 2023 y no hace nada en 2019, 2022 ni 2024: tres años buenos de diez no es una
señal para publicar con coeficiente distinto de 0. La recalibración es negativa en 9 de 10 años.

## 4. Regla de lado × ventaja exigida (picks simuladas al cierre, cuota < 3)

`k` = fair proporcional; "fav45" = k ≥ 0,45 (favorito amplio, lo preregistrado); ROI con la cuota de cierre y
bootstrap. **No hay CLV**: el dataset trae una sola cuota por pelea (el cierre), así que el CLV frente al cierre
es 0 por construcción; lo que se mide es el ROI al cierre, que es el CLV "hecho dinero" sin la deriva en contra
que sufren las picks reales.

| fuente de p | ventaja | todas: n / hit / ROI | fav45: n / hit / ROI | perro: n / hit / ROI |
|---|---|---|---|---|
| **blend 0,5 (la compuerta actual)** | ≥ 2 pp | 2.031 / 47,0 / −0,6 ± 2,4 | **852 / 59,6 / +5,2 ± 3,0** | 1.179 / 37,9 / −4,8 ± 3,6 |
| | ≥ 4 pp | 1.330 / 45,7 / −0,0 ± 3,1 | 478 / 59,6 / +7,6 ± 4,1 | 852 / 37,9 / −4,3 ± 4,2 |
| | ≥ 6 pp | 829 / 44,3 / +0,5 ± 4,0 | 244 / 59,4 / +9,1 ± 5,9 | 585 / 38,0 / −3,1 ± 5,2 |
| modelo puro (sin blend) | ≥ 2 pp | 2.394 / 47,5 / −1,2 ± 2,2 | 1.088 / 58,8 / +3,1 ± 2,7 | 1.306 / 38,0 / −4,7 ± 3,4 |
| cierre recalibrado | ≥ 2 pp | 119 / 81,5 / −0,1 ± 4,5 | 119 / 81,5 / −0,1 ± 4,5 | 0 |
| cierre + age | ≥ 2 pp | 1.643 / 66,1 / +0,5 ± 1,9 | 1.486 / 69,0 / +1,1 ± 1,8 | 157 / 38,9 / −5,7 ± 9,5 |
| | ≥ 4 pp | 393 / 66,4 / +2,2 ± 3,8 | 363 / 68,9 / +3,1 ± 3,7 | 30 / 36,7 / −9,4 ± 22 |
| cierre + delo | ≥ 2 pp | 731 / 70,0 / +1,5 ± 2,6 | 699 / 71,2 / +1,4 ± 2,5 | 32 |
| cierre + físicos 7 | ≥ 2 pp | 2.077 / 63,8 / +2,2 ± 1,8 | 1.730 / 68,3 / +2,4 ± 1,8 | 347 / 40,9 / +0,8 ± 6,6 |
| | ≥ 4 pp | 826 / 64,0 / +4,0 ± 2,9 | 705 / 67,5 / +3,3 ± 2,8 | 121 / 43,8 / +7,8 ± 11 |
| | ≥ 6 pp | 229 / 63,8 / +8,2 ± 5,8 | 189 / 67,7 / +6,8 ± 5,5 | 40 / 45,0 / +14,8 ± 20 |
| cierre + delo + 13 (full) | ≥ 2 pp | 2.089 / 63,6 / +2,5 ± 1,8 | 1.723 / 68,0 / +1,9 ± 1,8 | 366 / 42,9 / +5,5 ± 6,4 |
| | ≥ 4 pp | 828 / 64,0 / +4,6 ± 2,9 | 702 / 67,8 / +4,3 ± 2,8 | 126 / 42,9 / +6,3 ± 11 |
| | ≥ 6 pp | 244 / 63,9 / +8,5 ± 5,6 | 206 / 67,0 / +6,5 ± 5,4 | 38 / 47,4 / +19,5 ± 21 |

fav45 ≥ 2 pp por año, ROI al cierre (n): blend 0,5 → 2015 +11,7 (26), 2016 +18,0 (107), 2017 +15,7 (86), 2018
−0,2 (98), 2019 −7,1 (95), 2020 +1,7 (101), 2021 +3,3 (100), 2022 +11,3 (74), 2023 +5,6 (85), 2024 −3,0 (80).
Físicos 7 → −11,8 (83), +9,6 (128), +9,1 (144), −5,6 (178), +1,4 (202), +2,8 (189), +4,3 (211), −1,6 (217),
+11,6 (185), +0,5 (193).

**Lectura.**
- Un modelo consciente del mercado **no genera picks** con la ventaja actual: pegado al cierre, sus "ventajas"
  de ≥ 2 pp son en un 85 % favoritos a cuota 1,5-1,7 (hit 63-68 %) con ROI ≈ 0-2 % ± 2. A ≥ 6 pp quedan 200-250
  picks en diez años con +6-8 % ± 5-6: no significativo, y es la 3ª de 3 ventanas mirada (comparaciones
  múltiples).
- El corte **favorito vs perro del blend** (+5,2 vs −4,8, ≈ 10 puntos, t ≈ 2,1) sigue siendo el único patrón que
  se repite en todas las fuentes: el perro pierde con cualquier modelo. Es el argumento del preregistro y no
  cambia con este trabajo.
- Exigir más ventaja al blend (4, 6 pp) sube el ROI del favorito (+7,6, +9,1) pero con la mitad y un cuarto de
  las picks y errores de 4-6: indistinguible del +5,2 de 2 pp. No hay motivo para mover el umbral.

## 5. Qué queda en el código y qué no

- `combat-engine/market-aware.js` (puro): `marketAwareProb({pClose, features, coefs})`, `featuresFor`,
  `loadPriors`, `edgePP`, `zeroCoefs`. Con coeficientes 0 devuelve `pClose` **exacto** (sin pasar por logit).
- `data/combat/market-aware-priors.json`: `variante: cierre_solo`, `coefs.close = 1`, todos los rasgos 0,
  con fecha, muestra, criterio y el resumen fuera de muestra de cada variante. Lo dice en `veredicto`.
- La pick FIGHT persiste `p_mkt_aware` (= k mientras los coeficientes sean 0) y `edge_mkt_aware_pp` (= 0):
  **informativos**. `fight_breakdown.mkt_aware_edge` los corta en ≥ 2 / < 2 / sin dato. `/api/internal/combat-picks`
  expone `market_aware` (meta + coeficientes cargados).
- **No cambia:** `ratings.js`, blend 0,5, umbral 2 pp, techo 3, la generación de picks, el preregistro.

## 6. Cómo se mejora (decide Alexis)

1. **De-vig.** Lo único con t > 2 aquí es la recalibración del cierre (a = 1,11) / Shin (t −2,96): el consenso
   proporcional infla al perro. Es una decisión de `combatFightOdds` (usar Shin o potencia), no de este modelo,
   y afecta a la `k` de todas las picks. Medirla primero con nuestros `closing` reales.
2. **Edad.** Si con 2025-2026 (nuestros `closing`) la edad repite t ≤ −2 frente al cierre recalibrado, se
   escribe `feats.age ≈ −0,15` en los priors y `p_mkt_aware` empieza a separarse de `k`; el corte del track
   ya está esperando. Hasta entonces, 0.
3. **Finas y pesaje.** Sin muestra con cuota. Crece ~50 peleas finas/mes; re-testear con ≥ 400 activas.
4. Las 48 picks del libro + las que vengan con `p_mkt_aware` guardado permiten contrastar este archivo
   (cierre de una casa desconocida) contra nuestro consenso real.

## 7. Reproducir

```bash
node scripts/combat-market-aware.js                 # imprime todo; no escribe priors
node scripts/combat-market-aware.js --write-priors  # reescribe data/combat/market-aware-priors.json
node scripts/combat-market-aware.js --boot=5000 --min-active=100 --json=/ruta/salida.json
node scripts/smoke/combat-mkt-smoke.js              # 9 comprobaciones de la función y del track
```
