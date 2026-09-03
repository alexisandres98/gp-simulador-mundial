# Elo alimentado con cuotas vs Elo de resultados — backtest walk-forward (football-data, 2021-22 → 2025-26)

**Fecha:** 3 de septiembre de 2026. **Script:** `scripts/clubs-rating-backtest.js` (descarga los CSV de
football-data.co.uk a un directorio de trabajo; los datos NO se embarcan). **Matemática compartida:**
`clubs-engine/eloOdds.js` (la usan el backtest, `scripts/smoke/elo-odds-smoke.js` y el rating paralelo del
servidor). **Pregunta** (`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3.6): ¿hay un rating que bata al Elo de
resultados en log-loss walk-forward, y alguno que se acerque al cierre?

## Método

- **Datos.** 18 divisiones (E0-E3, D1-D2, SP1-SP2, I1-I2, F1-F2, N1, P1, B1, T1, G1, SC0), cinco temporadas
  completas 2122-2526: **33.335 partidos** con cierre (Pinnacle cierre 29.393; media de cierre 3.937 donde
  football-data no trae Pinnacle: E2/E3/SC0). El de-vig del cierre es **Shin** (`lib/devig.js`), el mismo
  que usa el consenso 1X2 de producción desde el 2-sep.
- **Walk-forward.** Cada partido se predice con los ratings PRE-partido y el MISMO `engine.matchProbs` de
  producción (Elo → Poisson → Dixon-Coles → calibración λ=0,15); después entra la actualización. Pools por
  división (como las ligas de producción); entre temporadas, regresión a la media (α) y prior para los
  recién llegados (1500 en producción; "media de los que se fueron" en D). Localía por división resuelta
  iterativamente en desarrollo (como `clubs-engine/ratings.fit`) y congelada.
- **Variantes.** **A** Elo de resultados con las constantes de producción (`applyClubElo`: K=30, factor G
  por margen, localía de liga). **B** Elo con cuotas (Wunderlich & Memmert 2018): la observación es
  `p_local + ½·p_empate` del cierre Shin y Δ = K_odds·(E_mercado − E_elo); K_odds elegido en desarrollo.
  **C** híbrido Δ = w·Δ_cuotas + (1−w)·Δ_resultado. **D** A/B/C + regresión α + recién llegados a la media de
  los salidos. **Techo del transform:** el rating implícito del PROPIO cierre pasado por `matchProbs` — lo
  mejor que puede hacer cualquier rating con este transform.
- **Partición.** 2122 calienta ratings (no puntúa); **desarrollo 2223 + 2324** (elige K, w, α);
  **evaluación 2425 + 2526** con todo congelado.
- **Métrica principal.** Log-loss del resultado y Brier a tres resultados, por temporada; diferencias
  PAREADAS por partido contra A y contra el cierre (t = media/SE, n≈6.600 por temporada) y bootstrap
  pareado (2.000 remuestreos) para el IC 95 % de la diferencia con A.
- **Métrica secundaria.** ROI de la regla `lead` de producción bajo cada rating: `0,5·modelo + 0,5·mercado`,
  ventaja ≥ 2 pp, solo local/visita; el "mercado de creación" es la cuota previa de Pinnacle (PSH/PSD/PSA,
  viernes/martes) y se liquida a la de cierre (PSC) y también a la de creación.

## Resultados

Partidos: 33335 (2122, 2223, 2324, 2425, 2526; 18 divisiones; cierre Pinnacle PSC 29393, PS 5, media AvgC 3937; con cuota previa PS: 29353). Pool: division. Calentamiento: 2122; desarrollo: 2223, 2324; evaluación: 2425, 2526.

Localía por división ajustada en desarrollo — resultados: D2 48, B1 43, F2 46, SC0 67, E1 46, F1 37, P1 52, E2 51, E3 48, T1 64, N1 46, SP2 76, D1 68, E0 60, SP1 67, I2 38, I1 39, G1 51.
Localía por división ajustada en desarrollo — cuotas: D2 46, B1 46, F2 47, SC0 47, E1 50, F1 51, P1 47, E2 46, E3 46, T1 56, N1 60, SP2 64, D1 54, E0 48, SP1 63, I2 51, I1 50, G1 66.

### Desarrollo de parámetros (log-loss medio en 2223+2324)

| Variante | Parámetro | Log-loss dev |
|---|---|---:|
| B | K_odds=30 | 1,0089 |
| B | K_odds=60 | 1,0039 |
| B | K_odds=120 | 1,0011 |
| B | K_odds=180 | 1,0002 |
| B | K_odds=250 | 0,9999 ← |
| B | K_odds=300 | 0,9999 |
| B | K_odds=350 | 1,0000 |
| B | K_odds=400 | 1,0004 |
| B | K_odds=500 | 1,0019 |
| C | w=0.25 (K=250) | 1,0025 |
| C | w=0.5 (K=250) | 0,9999 |
| C | w=0.75 (K=250) | 0,9992 ← |
| C | w=0.9 (K=250) | 0,9993 |
| D_A | α=0 | 1,0134 |
| D_A | α=0.1 | 1,0130 |
| D_A | α=0.2 | 1,0130 ← |
| D_A | α=0.3 | 1,0132 |
| D_A | α=0.5 | 1,0148 |
| D_B | α=0 (K=250) | 0,9995 ← |
| D_B | α=0.1 (K=250) | 0,9995 |
| D_B | α=0.2 (K=250) | 0,9996 |
| D_B | α=0.3 (K=250) | 0,9998 |
| D_B | α=0.5 (K=250) | 1,0003 |
| — | A (referencia) | 1,0139 |
| — | Cierre Pinnacle (Shin) | 0,9867 |

### Métrica principal — todas las jornadas

| Temporada | n | Variante | Log-loss | Brier | Δ log-loss vs A (t) [IC 95 %] | Δ log-loss vs cierre (t) | Δ Brier vs A (t) |
|---|---:|---|---:|---:|---:|---:|---:|
| 2223 (dev) | 6709 | Cierre Pinnacle (Shin) | 0,9894 | 0,5908 | — | — | — |
| 2223 (dev) | 6709 | Techo del transform (rating implícito del propio cierre → matchProbs) | 0,9965 | 0,5949 | — | +0,0071 (t 6,68) | — |
| 2223 (dev) | 6709 | A · Elo resultados (producción) | 1,0145 | 0,6069 | — | +0,0251 (t 9,52) | — |
| 2223 (dev) | 6709 | B · Elo cuotas (K=250) | 1,0019 | 0,5985 | -0,0126 (t -5,41) [-0,0170, -0,0083] | +0,0126 (t 7,77) | -0,0084 (t -5,23) |
| 2223 (dev) | 6709 | C · híbrido (w=0.75, K=250) | 1,0009 | 0,5978 | -0,0136 (t -6,48) [-0,0176, -0,0096] | +0,0116 (t 7,02) | -0,0091 (t -6,30) |
| 2223 (dev) | 6709 | D_A · A + regresión α=0.2 + llegados=media salidos | 1,0140 | 0,6068 | -0,0005 (t -0,46) [-0,0026, +0,0015] | +0,0246 (t 9,47) | -0,0001 (t -0,21) |
| 2223 (dev) | 6709 | D_B · B + regresión α=0 + llegados=media salidos | 1,0016 | 0,5983 | -0,0129 (t -5,50) [-0,0175, -0,0085] | +0,0122 (t 7,62) | -0,0086 (t -5,30) |
| 2223 (dev) | 6709 | D_C · C + regresión α=0.2 + llegados=media salidos | 1,0007 | 0,5977 | -0,0138 (t -6,48) [-0,0178, -0,0097] | +0,0113 (t 6,96) | -0,0092 (t -6,24) |
| 2324 (dev) | 6707 | Cierre Pinnacle (Shin) | 0,9840 | 0,5870 | — | — | — |
| 2324 (dev) | 6707 | Techo del transform (rating implícito del propio cierre → matchProbs) | 0,9917 | 0,5914 | — | +0,0077 (t 6,49) | — |
| 2324 (dev) | 6707 | A · Elo resultados (producción) | 1,0133 | 0,6062 | — | +0,0292 (t 11,00) | — |
| 2324 (dev) | 6707 | B · Elo cuotas (K=250) | 0,9978 | 0,5957 | -0,0155 (t -6,67) [-0,0200, -0,0109] | +0,0138 (t 7,98) | -0,0105 (t -6,60) |
| 2324 (dev) | 6707 | C · híbrido (w=0.75, K=250) | 0,9975 | 0,5956 | -0,0158 (t -7,53) [-0,0199, -0,0117] | +0,0134 (t 7,81) | -0,0107 (t -7,44) |
| 2324 (dev) | 6707 | D_A · A + regresión α=0.2 + llegados=media salidos | 1,0119 | 0,6053 | -0,0014 (t -1,49) [-0,0032, +0,0004] | +0,0279 (t 10,97) | -0,0009 (t -1,46) |
| 2324 (dev) | 6707 | D_B · B + regresión α=0 + llegados=media salidos | 0,9974 | 0,5955 | -0,0158 (t -6,80) [-0,0204, -0,0113] | +0,0134 (t 7,81) | -0,0107 (t -6,73) |
| 2324 (dev) | 6707 | D_C · C + regresión α=0.2 + llegados=media salidos | 0,9972 | 0,5954 | -0,0161 (t -7,53) [-0,0202, -0,0119] | +0,0132 (t 7,73) | -0,0109 (t -7,42) |
| **2425** (eval) | 6589 | Cierre Pinnacle (Shin) | 0,9905 | 0,5911 | — | — | — |
| **2425** (eval) | 6589 | Techo del transform (rating implícito del propio cierre → matchProbs) | 0,9957 | 0,5942 | — | +0,0052 (t 4,29) | — |
| **2425** (eval) | 6589 | A · Elo resultados (producción) | 1,0213 | 0,6117 | — | +0,0308 (t 11,30) | — |
| **2425** (eval) | 6589 | B · Elo cuotas (K=250) | 1,0032 | 0,5996 | -0,0180 (t -7,69) [-0,0226, -0,0133] | +0,0127 (t 7,05) | -0,0121 (t -7,58) |
| **2425** (eval) | 6589 | C · híbrido (w=0.75, K=250) | 1,0040 | 0,6001 | -0,0173 (t -8,18) [-0,0214, -0,0130] | +0,0135 (t 7,50) | -0,0117 (t -8,09) |
| **2425** (eval) | 6589 | D_A · A + regresión α=0.2 + llegados=media salidos | 1,0184 | 0,6100 | -0,0028 (t -2,80) [-0,0048, -0,0008] | +0,0280 (t 10,69) | -0,0017 (t -2,50) |
| **2425** (eval) | 6589 | D_B · B + regresión α=0 + llegados=media salidos | 1,0028 | 0,5994 | -0,0184 (t -7,80) [-0,0231, -0,0138] | +0,0124 (t 6,87) | -0,0124 (t -7,67) |
| **2425** (eval) | 6589 | D_C · C + regresión α=0.2 + llegados=media salidos | 1,0037 | 0,5999 | -0,0176 (t -8,07) [-0,0219, -0,0133] | +0,0132 (t 7,41) | -0,0118 (t -7,97) |
| **2526** (eval) | 6554 | Cierre Pinnacle (Shin) | 0,9967 | 0,5960 | — | — | — |
| **2526** (eval) | 6554 | Techo del transform (rating implícito del propio cierre → matchProbs) | 1,0019 | 0,5991 | — | +0,0052 (t 5,00) | — |
| **2526** (eval) | 6554 | A · Elo resultados (producción) | 1,0243 | 0,6141 | — | +0,0276 (t 10,15) | — |
| **2526** (eval) | 6554 | B · Elo cuotas (K=250) | 1,0095 | 0,6042 | -0,0148 (t -6,03) [-0,0198, -0,0099] | +0,0128 (t 7,84) | -0,0099 (t -5,93) |
| **2526** (eval) | 6554 | C · híbrido (w=0.75, K=250) | 1,0099 | 0,6044 | -0,0144 (t -6,48) [-0,0188, -0,0098] | +0,0132 (t 8,08) | -0,0096 (t -6,40) |
| **2526** (eval) | 6554 | D_A · A + regresión α=0.2 + llegados=media salidos | 1,0226 | 0,6132 | -0,0016 (t -1,55) [-0,0037, +0,0005] | +0,0260 (t 10,05) | -0,0008 (t -1,14) |
| **2526** (eval) | 6554 | D_B · B + regresión α=0 + llegados=media salidos | 1,0091 | 0,6039 | -0,0152 (t -6,16) [-0,0201, -0,0102] | +0,0124 (t 7,61) | -0,0101 (t -6,06) |
| **2526** (eval) | 6554 | D_C · C + regresión α=0.2 + llegados=media salidos | 1,0090 | 0,6038 | -0,0152 (t -6,68) [-0,0198, -0,0107] | +0,0124 (t 7,65) | -0,0103 (t -6,62) |

### Primeras 8 jornadas (arranque de temporada)

| Temporada | n | Variante | Log-loss | Brier | Δ log-loss vs A (t) [IC 95 %] | Δ log-loss vs cierre (t) | Δ Brier vs A (t) |
|---|---:|---|---:|---:|---:|---:|---:|
| 2223 (dev) | 1404 | Cierre Pinnacle (Shin) | 0,9914 | 0,5914 | — | — | — |
| 2223 (dev) | 1404 | Techo del transform (rating implícito del propio cierre → matchProbs) | 0,9970 | 0,5951 | — | +0,0056 (t 2,28) | — |
| 2223 (dev) | 1404 | A · Elo resultados (producción) | 1,0164 | 0,6080 | — | +0,0250 (t 4,13) | — |
| 2223 (dev) | 1404 | B · Elo cuotas (K=250) | 1,0021 | 0,5983 | -0,0143 (t -2,92) [-0,0235, -0,0044] | +0,0107 (t 2,50) | -0,0097 (t -2,84) |
| 2223 (dev) | 1404 | C · híbrido (w=0.75, K=250) | 1,0012 | 0,5977 | -0,0152 (t -3,52) [-0,0233, -0,0065] | +0,0098 (t 2,24) | -0,0103 (t -3,45) |
| 2223 (dev) | 1404 | D_A · A + regresión α=0.2 + llegados=media salidos | 1,0096 | 0,6037 | -0,0068 (t -1,90) [-0,0138, +0,0002] | +0,0181 (t 3,05) | -0,0044 (t -1,76) |
| 2223 (dev) | 1404 | D_B · B + regresión α=0 + llegados=media salidos | 1,0001 | 0,5972 | -0,0163 (t -3,14) [-0,0257, -0,0059] | +0,0087 (t 2,11) | -0,0109 (t -3,02) |
| 2223 (dev) | 1404 | D_C · C + regresión α=0.2 + llegados=media salidos | 0,9993 | 0,5968 | -0,0171 (t -3,63) [-0,0258, -0,0079] | +0,0079 (t 1,90) | -0,0112 (t -3,44) |
| 2324 (dev) | 1400 | Cierre Pinnacle (Shin) | 0,9833 | 0,5867 | — | — | — |
| 2324 (dev) | 1400 | Techo del transform (rating implícito del propio cierre → matchProbs) | 0,9919 | 0,5917 | — | +0,0086 (t 3,69) | — |
| 2324 (dev) | 1400 | A · Elo resultados (producción) | 1,0171 | 0,6094 | — | +0,0338 (t 5,58) | — |
| 2324 (dev) | 1400 | B · Elo cuotas (K=250) | 1,0024 | 0,5986 | -0,0147 (t -2,86) [-0,0244, -0,0048] | +0,0191 (t 4,72) | -0,0108 (t -3,05) |
| 2324 (dev) | 1400 | C · híbrido (w=0.75, K=250) | 1,0023 | 0,5985 | -0,0148 (t -3,22) [-0,0235, -0,0060] | +0,0190 (t 4,67) | -0,0109 (t -3,44) |
| 2324 (dev) | 1400 | D_A · A + regresión α=0.2 + llegados=media salidos | 1,0128 | 0,6063 | -0,0043 (t -1,36) [-0,0106, +0,0018] | +0,0295 (t 5,42) | -0,0031 (t -1,39) |
| 2324 (dev) | 1400 | D_B · B + regresión α=0 + llegados=media salidos | 1,0006 | 0,5974 | -0,0165 (t -3,13) [-0,0262, -0,0064] | +0,0173 (t 4,40) | -0,0120 (t -3,31) |
| 2324 (dev) | 1400 | D_C · C + regresión α=0.2 + llegados=media salidos | 1,0007 | 0,5975 | -0,0164 (t -3,31) [-0,0257, -0,0070] | +0,0174 (t 4,49) | -0,0118 (t -3,48) |
| **2425** (eval) | 1384 | Cierre Pinnacle (Shin) | 0,9810 | 0,5857 | — | — | — |
| **2425** (eval) | 1384 | Techo del transform (rating implícito del propio cierre → matchProbs) | 0,9878 | 0,5898 | — | +0,0068 (t 2,59) | — |
| **2425** (eval) | 1384 | A · Elo resultados (producción) | 1,0162 | 0,6100 | — | +0,0352 (t 5,47) | — |
| **2425** (eval) | 1384 | B · Elo cuotas (K=250) | 0,9919 | 0,5926 | -0,0243 (t -4,47) [-0,0349, -0,0139] | +0,0109 (t 2,48) | -0,0174 (t -4,67) |
| **2425** (eval) | 1384 | C · híbrido (w=0.75, K=250) | 0,9943 | 0,5944 | -0,0219 (t -4,54) [-0,0311, -0,0123] | +0,0133 (t 3,04) | -0,0156 (t -4,72) |
| **2425** (eval) | 1384 | D_A · A + regresión α=0.2 + llegados=media salidos | 1,0108 | 0,6067 | -0,0054 (t -1,59) [-0,0120, +0,0011] | +0,0298 (t 5,08) | -0,0033 (t -1,39) |
| **2425** (eval) | 1384 | D_B · B + regresión α=0 + llegados=media salidos | 0,9901 | 0,5915 | -0,0261 (t -4,69) [-0,0369, -0,0157] | +0,0091 (t 2,10) | -0,0185 (t -4,86) |
| **2425** (eval) | 1384 | D_C · C + regresión α=0.2 + llegados=media salidos | 0,9931 | 0,5936 | -0,0231 (t -4,32) [-0,0337, -0,0128] | +0,0121 (t 2,85) | -0,0164 (t -4,46) |
| **2526** (eval) | 1378 | Cierre Pinnacle (Shin) | 1,0039 | 0,6013 | — | — | — |
| **2526** (eval) | 1378 | Techo del transform (rating implícito del propio cierre → matchProbs) | 1,0101 | 0,6052 | — | +0,0061 (t 2,62) | — |
| **2526** (eval) | 1378 | A · Elo resultados (producción) | 1,0390 | 0,6237 | — | +0,0351 (t 5,47) | — |
| **2526** (eval) | 1378 | B · Elo cuotas (K=250) | 1,0275 | 0,6171 | -0,0115 (t -2,07) [-0,0225, -0,0005] | +0,0235 (t 5,60) | -0,0065 (t -1,73) |
| **2526** (eval) | 1378 | C · híbrido (w=0.75, K=250) | 1,0291 | 0,6180 | -0,0099 (t -2,02) [-0,0193, -0,0004] | +0,0251 (t 6,02) | -0,0056 (t -1,69) |
| **2526** (eval) | 1378 | D_A · A + regresión α=0.2 + llegados=media salidos | 1,0342 | 0,6206 | -0,0048 (t -1,30) [-0,0120, +0,0025] | +0,0303 (t 5,31) | -0,0031 (t -1,22) |
| **2526** (eval) | 1378 | D_B · B + regresión α=0 + llegados=media salidos | 1,0255 | 0,6157 | -0,0135 (t -2,36) [-0,0249, -0,0023] | +0,0216 (t 5,17) | -0,0079 (t -2,04) |
| **2526** (eval) | 1378 | D_C · C + regresión α=0.2 + llegados=media salidos | 1,0247 | 0,6149 | -0,0143 (t -2,60) [-0,0250, -0,0035] | +0,0208 (t 5,22) | -0,0087 (t -2,35) |

### ROI de la regla `lead` (0,5·modelo + 0,5·mercado de creación, ventaja ≥ 2 pp, local/visita)

| Temporada | Variante | n picks | ROI a cierre (PSC) | SE | t | ROI a creación (PS) | Unidades a cierre |
|---|---|---:|---:|---:|---:|---:|---:|
| 2223 (dev) | A · Elo resultados (producción) | 3882 | -5,3 % | 2,5 % | -2,12 | -5,4 % | -204,35 |
| 2223 (dev) | B · Elo cuotas (K=250) | 1292 | -11,1 % | 5,2 % | -2,15 | -8,7 % | -143,51 |
| 2223 (dev) | C · híbrido (w=0.75, K=250) | 1514 | -7,3 % | 4,6 % | -1,58 | -5,6 % | -110,13 |
| 2223 (dev) | D_A · A + regresión α=0.2 + llegados=media salidos | 3790 | -6,5 % | 2,5 % | -2,59 | -6,8 % | -245,04 |
| 2223 (dev) | D_B · B + regresión α=0 + llegados=media salidos | 1271 | -10,2 % | 5,2 % | -1,96 | -7,7 % | -130,16 |
| 2223 (dev) | D_C · C + regresión α=0.2 + llegados=media salidos | 1461 | -7,6 % | 4,7 % | -1,59 | -5,4 % | -110,35 |
| 2324 (dev) | A · Elo resultados (producción) | 3606 | -10,4 % | 2,5 % | -4,19 | -11,3 % | -374,96 |
| 2324 (dev) | B · Elo cuotas (K=250) | 1193 | -23,7 % | 5,2 % | -4,58 | -22,6 % | -282,80 |
| 2324 (dev) | C · híbrido (w=0.75, K=250) | 1304 | -18,0 % | 4,9 % | -3,65 | -17,1 % | -234,84 |
| 2324 (dev) | D_A · A + regresión α=0.2 + llegados=media salidos | 3480 | -11,7 % | 2,6 % | -4,57 | -12,6 % | -406,12 |
| 2324 (dev) | D_B · B + regresión α=0 + llegados=media salidos | 1172 | -23,3 % | 5,3 % | -4,41 | -22,2 % | -272,58 |
| 2324 (dev) | D_C · C + regresión α=0.2 + llegados=media salidos | 1252 | -18,0 % | 5,2 % | -3,46 | -17,0 % | -225,85 |
| **2425** (eval) | A · Elo resultados (producción) | 3633 | -10,4 % | 2,7 % | -3,82 | -12,2 % | -377,37 |
| **2425** (eval) | B · Elo cuotas (K=250) | 1321 | -13,1 % | 5,9 % | -2,24 | -14,6 % | -173,51 |
| **2425** (eval) | C · híbrido (w=0.75, K=250) | 1341 | -14,5 % | 5,7 % | -2,57 | -15,9 % | -195,06 |
| **2425** (eval) | D_A · A + regresión α=0.2 + llegados=media salidos | 3499 | -9,9 % | 2,9 % | -3,47 | -11,8 % | -346,42 |
| **2425** (eval) | D_B · B + regresión α=0 + llegados=media salidos | 1315 | -12,5 % | 5,9 % | -2,13 | -14,4 % | -164,65 |
| **2425** (eval) | D_C · C + regresión α=0.2 + llegados=media salidos | 1287 | -13,7 % | 5,9 % | -2,33 | -15,5 % | -176,55 |
| **2526** (eval) | A · Elo resultados (producción) | 3632 | -13,7 % | 2,3 % | -5,86 | -14,3 % | -497,49 |
| **2526** (eval) | B · Elo cuotas (K=250) | 1486 | -27,0 % | 4,1 % | -6,59 | -27,1 % | -401,03 |
| **2526** (eval) | C · híbrido (w=0.75, K=250) | 1523 | -27,1 % | 4,0 % | -6,74 | -27,2 % | -413,12 |
| **2526** (eval) | D_A · A + regresión α=0.2 + llegados=media salidos | 3517 | -12,9 % | 2,5 % | -5,26 | -13,4 % | -454,56 |
| **2526** (eval) | D_B · B + regresión α=0 + llegados=media salidos | 1484 | -26,2 % | 4,1 % | -6,40 | -26,4 % | -388,54 |
| **2526** (eval) | D_C · C + regresión α=0.2 + llegados=media salidos | 1486 | -25,2 % | 4,2 % | -6,04 | -25,4 % | -374,85 |

## Lectura

1. **B (Elo con cuotas) bate a A (Elo de resultados) con t ≈ −6 a −8 en las DOS temporadas de
   evaluación**, con IC 95 % de la diferencia de log-loss entero por debajo de cero (2425: −0,0180
   [−0,0226, −0,0133]; 2526: −0,0148 [−0,0198, −0,0099]) y el Brier a tres resultados también (t −7,6 y −5,9).
   La mejora es consistente en desarrollo y evaluación y del mismo orden en todas las temporadas: no es un
   artefacto de la partición. El K óptimo es alto (meseta 250-300, se toma el menor: cada partido cierra
   ≈72 % de la brecha entre lo que el Elo espera y lo que cotiza el mercado; con K≥350 sobrepasa y
   empeora): en la práctica el rating
   "recuerda" la última línea de cierre de cada equipo y la lleva al siguiente partido.
2. **Ninguna variante se acerca al cierre.** B queda a +0,013 del cierre (t 7-8); el híbrido C (w=0,75) y las
   D no cambian eso (todas entre +0,012 y +0,014). Dos componentes: (a) el **transform** `matchProbs`
   pierde +0,005 (t 4-5) incluso con el rating implícito del propio cierre — la calibración λ=0,15 hacia
   uniforme y el Poisson comprimen el 1X2 más de lo que el mercado lo hace; (b) el **rating** pierde otros
   +0,008: la última línea de un equipo es información de hace una semana (bajas, alineación, descanso
   llegan después). Con este transform el techo alcanzable es 0,9988 (eval) contra 0,9936 del cierre.
3. **Regresión de temporada:** en A ayuda poco (α=0,2 y llegados=media de salidos: −0,0028 t −2,8 en 2425,
   −0,0016 t −1,6 en 2526; en las 8 primeras jornadas −0,005 t −1,3/−1,6); en B **α=0 es lo mejor** — el
   rating con cuotas se re-ancla solo en una o dos jornadas, así que la regresión sobra.
4. **Arranque de temporada (8 primeras jornadas):** ahí la ventaja de B sobre A es mayor (2425: −0,0243
   t −4,5; 2526: −0,0115 t −2,1) porque el mercado ya trae el prior de plantilla/traspasos que el Elo de
   resultados tarda 8-10 jornadas en aprender (Deutscher et al.). Es la ventana donde un prior de plantilla
   tendría más que aportar; ver §"Prior de plantilla".
5. **La regla `lead` pierde bajo TODOS los ratings y más con B.** A: −10,4 % (n 3.633, t −3,8) y −13,7 %
   (n 3.632, t −5,9) al cierre; B: −13,1 % (n 1.321, t −2,2) y −27,0 % (n 1.486, t −6,6). Con un rating que sigue al
   mercado, las "ventajas ≥ 2 pp" que quedan son exactamente los partidos donde la línea se movió desde la
   última vez que el equipo jugó — o sea, donde el rating está desactualizado — y el mercado gana esas. Es la
   misma conclusión de §3.1 del 2-sep (c = 0): un rating mejor **no** convierte a `lead` en rentable; sirve
   para que la probabilidad publicada y las derivadas (goles, córners vía λ) partan de una fuerza más actual,
   no para apostar contra el cierre.

## Veredicto

- **¿Alguna variante bate al Elo de resultados con t ≥ 2 en evaluación?** **Sí: B (y C, D_B, D_C, que son
  B con adornos), con t −6,0 a −8,2 en 2425 y 2526, y también en las 8 primeras jornadas (t −2,1 a −4,7).**
  La regresión de temporada sola (D_A) no llega (t −2,8 y −1,6).
- **¿Alguna se acerca al cierre?** **No.** La mejor queda a +0,012/+0,013 de log-loss (t 7-8). La mitad de
  esa distancia es del transform rating→probabilidad, no del rating.
- **Consecuencia para producción.** Se implementa en sombra (`db.clubElosOdds`, `GP_CLUB_ELO_SOURCE=odds`
  para leerlo; default `results`) y se mide en vivo contra el rating de resultados con los partidos que van
  liquidando (`/api/internal/clubs-elo` → `odds.compare`). **No cambia** la política de picks del 1X2
  (`GP_SOLID_C = 0`: se publica el consenso Shin): el backtest dice que el rating con cuotas mejora la
  probabilidad del modelo, no que gane al mercado.

## Prior de plantilla (tarea 2) — NO MEDIDO: qué falta

- La plataforma expone el valor de mercado por jugador vía TheStatsAPI (`clubRosterRows` en `server.js`,
  endpoint `/teams/{tm_id}/players`, campo `market_value`) — **solo valores ACTUALES** (plantillas 2026-27).
- `scripts/clubs-squad-values.js` deja hecho (1) el **mapa de nombres football-data → ratings.json** para las
  18 divisiones: **342/342 equipos de 2526 emparejados** (`<out>/squad-map.json`, alias a mano para los
  ~90 que el normalizador no resuelve: "Nott'm Forest", "Buyuksehyr", "St. Gilloise"…), y (2) la descarga y
  suma por club (1 llamada por equipo, 1,3 s entre llamadas ≈ 9 min) → `<out>/squad-values-2526.json` con
  la forma que consume `clubs-rating-backtest.js --squad`.
- **Lo que falta es la key:** `THESTATSAPI_KEY` no existe en este entorno (solo en Render). Con ella:
  `THESTATSAPI_KEY=… node scripts/clubs-squad-values.js --out $SP/fd` y luego
  `node scripts/clubs-rating-backtest.js --no-download --squad $SP/fd/squad-values-2526.json`. El backtest ya
  contiene la variante **SQ**: ajusta `rating_inicio = a + b·log(valor)` por división contra el rating final
  de **2425** (no de 2526, para reducir la fuga), lo mezcla con β ∈ {0,5; 1} sobre el arrastre regresado y
  reporta las 8 primeras jornadas de 2526 frente a D_A/D_B. Sesgo de supervivencia reconocido: los valores
  son de hoy, no de agosto de 2025 (los clubes que subieron valor en 2526 aparecen más caros).
- Lo que el backtest ya dice sin el prior: en las 8 primeras jornadas el mercado (que sí tiene ese prior)
  está a +0,035 de A y a +0,011/+0,023 de B. Un prior de plantilla tiene, como máximo, ese espacio para
  cerrar — y B ya recupera dos tercios de él en 2425 sin ningún dato de plantilla.

## Reproducir

```bash
SP=<directorio de trabajo> node scripts/clubs-rating-backtest.js --out $SP/fd --md $SP/fd/backtest-tables.md   # descarga (≈90 MB) y corre
node scripts/clubs-rating-backtest.js --out $SP/fd --no-download                                              # solo con lo descargado
node scripts/clubs-rating-backtest.js --out $SP/fd --no-download --pool country                               # pools por país (ascensos/descensos comparten rating)
node scripts/smoke/elo-odds-smoke.js                                                                          # prueba unitaria del módulo
```
Escribe las tablas por stdout (y `--md`) y `<out>/rating-backtest.json` con todos los pareados.
