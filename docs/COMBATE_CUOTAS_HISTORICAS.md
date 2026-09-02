# Combate — cuotas históricas de UFC: el modelo contra el cierre en 4.180 peleas

**Fecha:** 2 de septiembre de 2026. **Script:** `scripts/combat-odds-history.js` (sin red si se le pasa
`--csv`; sin server, sin db). **Salida:** `data/combat/odds-history.json.gz` (132 KB, 6.090 peleas).

Era el punto 5 de "cómo se mejora" en `BACKTESTS_FAMILIAS_2026-09-02.md` §7.4: hasta hoy el modelo de
combate solo se había podido comparar con el mercado en las **48** picks del libro. Ahora se compara en
**miles**.

## 1. La fuente y cómo se consiguió

- **Dataset:** `ufc-master.csv`, el *Ultimate UFC Dataset* de Kaggle (autor shortlikeafox / mdabbert). Columnas
  usadas: `RedFighter`, `BlueFighter`, `RedOdds`, `BlueOdds` (americanas), `Date`, `Winner`. 6.541 filas del
  2010-03-21 al 2024-12-14; **6.303 con cuota en ambos lados** (2023-2024 traen huecos: 416/504 y 383/513).
- **URLs probadas** (todas por `curl` a `raw.githubusercontent.com`, dominio accesible):
  - `mdabbert/Ultimate-UFC-Dataset/{master,main}/ufc-master.csv` → 404 (el repo no existe con ese nombre)
  - `WarrierRajeev/UFC-Predictions`, `jansen88/ufc-predictor`, `cwdenn/UFC-Fight-Predictions` → 404 (adivinadas)
  - búsqueda de código en GitHub `filename:ufc-master.csv` → 2 resultados reales:
    - **`shortlikeafox/ultimate_ufc_dataset/main/data/ultimate_ufc_dataset/ufc-master.csv` → 200, 2,9 MB. Es el
      repo del propio autor del dataset de Kaggle. ESTA es la que se usa.**
    - `bsse23094/ufc-predictor/.../tests/fixtures/kaggle_ultimate/ufc-master.csv` → 200 pero 298 bytes (fixture).
  - Kaggle directo no se intentó (requiere cuenta/API key). BestFightOdds no se intentó (scraping, términos).
- El CSV NO se versiona (2,9 MB, no es nuestro); el script lo descarga a un caché temporal o lo lee de `--csv`.

## 2. El cruce

Nombres normalizados (NFD, minúsculas, sin puntuación; coincidencia completa o apellido + inicial, con sufijos
Jr/Sr/II fuera) + fecha **±1 día** contra `data/combat/fights-ufc.json`. Candidato único o nada.

| | |
|---|---|
| Filas con cuota | 6.303 |
| **Cruzadas** | **6.090 (96,6 %)** |
| Ambiguas (descartadas) | 2 |
| Sin cruce | 211 (peleas que no están en nuestro archivo, casi todas 2010 y 2017-2020) |
| Ganador CSV = ganador nuestro | **6.088 / 6.090** — el cruce es limpio |

Cobertura sobre **nuestras** peleas por año: 82 % (2010), 96-99 % (2011-2016), 84-88 % (2017-2022), **75 %
(2023), 68 % (2024)** — los huecos recientes son del CSV, no del cruce. 2025-2026 no existen en el dataset.

## 3. Modelo contra cierre — el número que faltaba

Walk-forward **idéntico** a `scripts/combat-backtest-v2.js` (variante ACTUAL: Elo + rasgos + stats finas,
SGD en línea, warm-up 35 % = hasta 2015-07-15). Se evalúan solo las peleas **fuera de muestra con cuota**:
**4.180** (2015-07 → 2024-12). El "cierre" es la implícita de-vig 2-way de la cuota del dataset.

| | n | Brier | log-loss | acierto |
|---|---|---|---|---|
| **Cierre del mercado** | 4.180 | **0,2120** | **0,6118** | 66,0 % |
| Elo puro | 4.180 | 0,2434 | 0,6797 | 57,0 % |
| Modelo ACTUAL | 4.180 | 0,2343 | 0,6610 | 61,0 % |
| Blend 0,5 (el del monitor) | 4.180 | 0,2180 | 0,6263 | 65,5 % |

Pareado por pelea (ΔBrier, negativo = el primero es mejor):
- modelo − cierre: **+0,0223 ± 0,0020 (t +11,2)** → el cierre es mejor que el modelo, y no por poco.
- blend 0,5 − cierre: **+0,0060 ± 0,0010 (t +6,1)** → mezclar al 50 % sigue siendo peor que el cierre solo.
- modelo − Elo puro: −0,0091 ± 0,0014 (t −6,5) → los rasgos SÍ añaden (confirma §7.1 con otra muestra).

**w\* de la mezcla lineal `(1−w)·modelo + w·cierre` que minimiza el log-loss: w = 1,00** global, y por año:

| año | n | Brier cierre | Brier modelo | Brier blend 0,5 | w\* |
|---|---|---|---|---|---|
| 2015 (jul-dic) | 200 | 0,2183 | 0,2375 | 0,2214 | 0,90 |
| 2016 | 468 | 0,2165 | 0,2281 | 0,2177 | 0,85 |
| 2017 | 428 | 0,2136 | 0,2383 | 0,2189 | 0,95 |
| 2018 | 449 | 0,2094 | 0,2317 | 0,2156 | 1,00 |
| 2019 | 472 | 0,2194 | 0,2438 | 0,2266 | 1,00 |
| 2020 | 414 | 0,2137 | 0,2348 | 0,2200 | 1,00 |
| 2021 | 471 | 0,2195 | 0,2434 | 0,2270 | 1,00 |
| 2022 | 479 | 0,2083 | 0,2334 | 0,2157 | 1,00 |
| 2023 | 416 | 0,2004 | 0,2237 | 0,2071 | 1,00 |
| 2024 | 383 | 0,2014 | 0,2279 | 0,2094 | 1,00 |

La curva del log-loss es monótona en w (0,661 en w=0 → 0,612 en w=1): **en ningún año** hay un w interior
que mejore al cierre. El modelo, mezclado linealmente, **no añade información al cierre** en UFC 2015-2024.
(El "dato colateral" de §7.3 —la mezcla 0,5 batiendo al mercado por Brier en la 2ª mitad del libro, n=24—
era ruido, como se sospechaba.)

## 4. La regla preregistrada, simulada al cierre

Se aplica la compuerta del monitor tal cual (lado de mayor ventaja post-blend 0,5, **≥ 2 pp**, **cuota < 3**)
sobre las 4.180 peleas, usando la cuota de **cierre** como cuota tomada (o sea, sin el castigo de llegar
tarde que sufren las picks reales):

| subconjunto | n | acierto | ROI | se | cuota media | modelo dice | cierre dice |
|---|---|---|---|---|---|---|---|
| todas las picks | 2.031 | 47,0 % | −0,6 % | 2,4 | 2,21 | 57,2 % | 45,3 % |
| **`prereg_fav45` (k ≥ 0,45)** | **852** | **59,6 %** | **+5,2 %** | **3,0** | 1,78 | 64,8 % | 54,8 % |
| perro (k < 0,45) | 1.179 | 37,9 % | −4,8 % | 3,6 | 2,53 | 51,8 % | 38,5 % |
| favorito estricto (k ≥ 0,50) | 611 | 60,6 % | +1,0 % | 3,3 | 1,68 | 67,2 % | 57,7 % |
| ventaja 2-4 pp | 701 | 49,5 % | −1,7 % | 3,9 | | | |
| ventaja 4-6 pp | 501 | 48,1 % | −0,9 % | 4,8 | | | |
| ventaja ≥ 6 pp | 829 | 44,3 % | +0,5 % | 4,0 | | | |

Lectura honesta:
- El acierto real (47 %) cae **entre** lo que dice el modelo (57 %) y lo que dice el cierre (45 %), más cerca
  del cierre. Es el mismo patrón de las 48 picks del libro (57 % prometido → 40 % real), en 2.031.
- El corte por lado **replica** el hallazgo H3d: favorito amplio +5,2 ± 3,0 % (t 1,7) contra perro −4,8 ± 3,6 %
  (t −1,3); diferencia ≈ 10 puntos, t ≈ 2,1. **Al cierre, sin vig extra y sin deriva en contra.** Con la cuota
  que de verdad se toma (42/48 picks reales se tomaron a peor precio que el consenso), el perro es peor aún.
- El favorito **estricto** (k ≥ 0,50) rinde menos (+1,0 %) que el amplio: la franja 0,45-0,50 (pick'em donde el
  modelo ve favorito claro) es la que aporta. Es un argumento a favor del 0,45 del preregistro, y también un
  aviso: 241 picks separan las dos filas, no es un efecto enorme.
- **Nada de esto es un edge demostrado**: +5,2 % con se 3,0 es t 1,7 sobre picks simuladas con cuotas de
  cierre de un dataset ajeno. Es exactamente lo que justifica **preregistrar 40 picks reales y esperar**
  (`docs/PREREGISTRO_COMBATE_FAVORITO.md`), no cambiar la compuerta.

## 5. Qué cambia y qué no

- **No se toca `combat-engine/ratings.js`, ni el blend, ni el umbral, ni el techo.** Este documento mide; la
  decisión es de Alexis en la revisión.
- Lo que la evidencia sugiere para esa revisión, en orden: (1) el modelo market-blind **no bate al cierre** en
  UFC y mezclarlo al 50 % tampoco — el modelo *market-aware* honesto (rasgos como corrección residual sobre el
  logit del cierre) ya se puede ajustar y validar con este archivo; (2) el único subconjunto con ROI positivo
  al cierre es el favorito amplio, que es lo preregistrado; (3) el cierre del dataset es "el cierre" del
  dataset: no sabemos de qué casa ni a qué hora — la comparación con nuestro `closing` real (consenso de varias
  casas minutos antes) tiene que hacerse aparte cuando haya muestra.
- Pendiente de datos: 2025-2026 no existen en el CSV; nuestro archivo de cierres reales (`closing` en cada pick)
  es la continuación natural.

## 6. Reproducir

```bash
node scripts/combat-odds-history.js                       # descarga el CSV a un caché temporal
node scripts/combat-odds-history.js --csv=/ruta/ufc-master.csv --no-save
```
Escribe el resumen JSON en el directorio temporal del sistema (`gp-combat-odds-history-result.json`).
