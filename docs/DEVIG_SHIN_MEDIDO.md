# De-vig del 1X2: proporcional vs Shin vs frecuencia real (cierres de football-data.co.uk)

**Fecha:** 2 de septiembre de 2026. **Script:** `scripts/clubs-closes-fd.js` (descarga los CSV a un directorio
de trabajo; los datos NO se embarcan en el repo). **Qué se mide:** para cada partido con cierre de Pinnacle
(`PSCH/PSCD/PSCA`; si falta, `PSH/PSD/PSA`; si falta, `AvgCH/AvgCD/AvgCA`), la probabilidad implícita del
resultado con de-vig **proporcional** (`q_i/Σq`) y con **Shin (1993)** (`lib/devig.js`), agrupada por tramo de
cuota del resultado y comparada con la **frecuencia observada** (`FTR`). Cada partido aporta sus tres resultados.

## Muestra

- Temporadas **2023-24, 2024-25 y 2025-26** (esta última en curso al 2-sep).
- 18 divisiones: E0, E1, E2, E3, D1, D2, SP1, SP2, I1, I2, F1, F2, N1, P1, B1, T1, G1, SC0.
- **19.850 partidos** → 59.550 resultados. Fuente del cierre: Pinnacle cierre 15.910, Pinnacle apertura 4,
  media de cierre 3.936 (E2/E3/SC0 y parte de las menores no traen Pinnacle en football-data).
- z medio de Shin (fracción de apostadores informados implícita): **0,0216**.

## Resultado

| Tramo de cuota | n resultados | Implícita proporcional | Implícita Shin | Frecuencia real | Error prop. (pp) | Error Shin (pp) | Brier prop. | Brier Shin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ≤1,50 | 2892 | 72,7 % | 74,0 % | 75,1 % | −2,47 | −1,15 | 0,1818 | 0,1813 |
| 1,50-2,00 | 6807 | 54,5 % | 55,2 % | 55,7 % | −1,18 | −0,49 | 0,2441 | 0,2439 |
| 2,00-2,50 | 7523 | 42,8 % | 43,1 % | 44,1 % | −1,29 | −1,00 | 0,2462 | 0,2461 |
| 2,50-3,20 | 11057 | 33,2 % | 33,2 % | 32,7 % | +0,55 | +0,53 | 0,2195 | 0,2195 |
| 3,20-5,00 | 23852 | 25,6 % | 25,4 % | 25,3 % | +0,35 | +0,11 | 0,1877 | 0,1876 |
| 5,00-8,00 | 5218 | 16,1 % | 15,5 % | 15,1 % | +0,99 | +0,43 | 0,1281 | 0,1280 |
| >8,00 | 2201 | 8,7 % | 7,9 % | 6,4 % | +2,36 | +1,58 | 0,0596 | 0,0593 |
| **Total** | 59550 | | | | | | 0,1972 | 0,1971 |

Log-loss medio por resultado: proporcional **0,57919** · Shin **0,57894**.

## Lectura

1. **El sesgo favorito-longshot existe en el cierre y va en la dirección que decía el libro** (§3.1 de
   `BACKTESTS_FAMILIAS_2026-09-02.md`): el proporcional sobreestima los longshots (+2,4 pp por encima de 8,00,
   +1,0 pp entre 5 y 8) y subestima a los favoritos (−2,5 pp por debajo de 1,50).
2. **Shin corrige algo más de la mitad de ese sesgo** en los extremos (>8,00: +2,36 → +1,58 pp; ≤1,50: −2,47 →
   −1,15 pp) y no empeora ningún tramo. El Brier y el log-loss mejoran en todos los tramos o quedan iguales.
   La mejora agregada es pequeña porque la mayoría de los resultados viven entre 2,50 y 5,00, donde ambos
   métodos coinciden con la frecuencia real.
3. **No corrige todo.** Por encima de 8,00 Shin sigue 1,6 pp por encima de lo observado. Con un solo cierre
   por partido (una casa), el z estimado es bajo (0,02) y la corrección conservadora; en producción el consenso
   se hace **por casa y mediana entre casas** sobre ~30 libros, así que la medición aquí es la cota inferior de
   lo que corrige el consenso. Un de-vig más agresivo en el extremo (o un tope de cuota en el 1X2, ya acordado
   el 23-ago) es lo que cierra el hueco restante.
4. **Para el libro de SOLID** esto significa que la parte de la "ventaja" que venía de comprar longshots a la
   mejor de 30 casas contra un consenso proporcional (mercado 17,1 % vs observado 13,1 % en cuota >5) era
   margen mal repartido, no señal. Con Shin en el consenso y `c = 0` (`GP_SOLID_C`), la probabilidad publicable
   del 1X2 es la del mercado corregida, y `lead` deja de generar picks por construcción.

## Qué NO cambia con esto

Los totales (goles, córners, **tarjetas**) siguen con el de-vig proporcional a dos lados en su código de
siempre (`goal-engine/noVig.consensus`, `market-scanner/scanner.consensus`, el cierre en
`captureClubPicksClosing`). `cards_under_v1` no toca nada de esto. Shin entra únicamente en el 1X2 de clubes
(`buildClubDailyPicks`, rama `1x2`) y, como dato al lado (`closing.fair_prob_shin`), en el cierre de SOLID.

## Reproducir

```bash
SP=<directorio de trabajo> node scripts/clubs-closes-fd.js --out $SP/fd      # descarga (≈50 MB) y mide
node scripts/clubs-closes-fd.js --out $SP/fd --no-download                   # solo con lo ya descargado
```
Escribe la tabla por stdout y `<out>/fd-devig-summary.json`.
