# Preregistro — CORNERS con ≥2 casas en la creación

**Fecha de registro:** 2 de septiembre de 2026. **Familia:** CORNERS (totales de córners de clubes).
**Estado:** medición en sombra; NO cambia ninguna decisión de publicación.

## Por qué

`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3.4: la regla "≥2 casas" da ROI +12,1 % (n=204, SE 6,1; t 1,95,
clúster liga×semana 2,01), +13,4 % a cuota de creación, exceso de +20 pp frente al nulo "el mercado acierta"
(p 0,0003), sobrevive la multiplicidad de 18 filtros y es positiva en los 5 cortes temporales. Pero quedó
**inconclusa-favorable** por dos defectos de medición:

1. `books` era el **refrescado ≤2 h antes del saque** (`refreshClubPickPrices`), no el de creación. Con el de
   creación (donde existía) n=142 y +9,4 % (t 1,23).
2. **Liga MX** (25 overs, +59 %) aportaba 14,8 de las 24,6 unidades; sin ella +5,5 % (t 0,97).

El grupo "1 casa" son 212 unders de LeoVegas (−10,8 %): la casa está bien calibrada y el pick pierde el margen.

## La regla (congelada)

Una pick CORNERS lleva `prereg_corners_2books: true` si **al nacer** `books_at_create ≥ 2` (número de casas que
cotizaban el lado elegido en el sweep que creó la pick). `mkRecord` congela `books_at_create`,
`best_book_at_create` y `odds_at_create`; `refreshClubPickPrices` **no los pisa** y anota `books_final` (el nº de
casas del último refresco, lo que antes se leía como `books`). Para las picks anteriores al campo, el primer
refresco congela lo que había — se distinguen porque no llevan la etiqueta.

Nada más cambia: el de-vig de córners sigue siendo el proporcional a dos lados (`goal-engine/noVig.consensus`),
el modelo NB, el gate LOO por liga y las reglas de régimen son las de siempre.

## Tamaño de muestra y vara

- **~225 picks** CORNERS liquidadas con la etiqueta definida (true o false): con ~115 CORNERS decididas por
  semana en el libro, unas 2-3 semanas.
- **Vara primaria: resultados a cuota de creación** (`roi_at_create`), no CLV — en córners el cierre no es
  la vara (§4.2 de la autopsia: `closing.odds == best_odds` en 544/587; el "ROI a cierre" no era comprobación
  independiente).
- **Se acepta** si `prereg_corners_2books:on` **fuera de Liga MX** (`CORNERS|prereg_corners_2books:on|resto`)
  da ROI a cuota de creación > 0 con t ≥ 2 frente a `…:off|resto`, y el signo se mantiene en Liga MX.
- **Se rechaza** si el efecto vive solo en Liga MX o si `on` y `off` no se distinguen (t < 1).

## Dónde se lee

Track admin de clubes (`/api/internal/clubs-picks?key=…` → `track_record`):

| Bloque | Qué es |
|---|---|
| `CORNERS\|prereg_corners_2books:on` / `:off` | por etiqueta, todas las ligas |
| `CORNERS\|ligamx` / `CORNERS\|resto` | Liga MX aparte, sin etiqueta |
| `CORNERS\|prereg_corners_2books:on\|ligamx` … `:off\|resto` | el cruce de ambas (la celda que decide) |

Cada bloque trae `n`, `wins`, `losses`, `hit_rate`, `roi` (a `best_odds`) y `roi_at_create` (a `odds_at_create`).

## Lo que este preregistro NO hace

- No cambia qué CORNERS se publican ni su cuota.
- No toca CARDS (`cards_under_v1` sigue exactamente igual) ni GOALS ni SOLID.
