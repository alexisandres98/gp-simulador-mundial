# Preregistro — GOALS "tarde y a precio justo"

**Fecha de registro:** 2 de septiembre de 2026. **Familia:** GOALS (totales de goles de clubes, régimen `anchor`).
**Estado:** medición en sombra; NO cambia ninguna decisión de publicación.

## Por qué

`docs/BACKTESTS_FAMILIAS_2026-09-02.md` §3.3: el modelo de goles está bien calibrado (p_over modelo 0,518,
mercado 0,527, observado 0,523; n=130) y ningún filtro declarado sobrevive. Lo que falla es el **precio**:
CLV −1,32 % (t −4,1) — se publica a un precio que después mejora. En evaluación, publicar con <48 h de
antelación dio +8,0 % (n=43) y +1,0 % (n=51), pero eso salió de mirar el libro y **no es declarable** en el
ajuste. Se preregistra aquí la regla exacta antes de leer un solo resultado más.

## La regla (congelada)

Una pick GOALS lleva `prereg_goals_late: true` si, **al nacer**:

1. `hours_to_ko ≤ 48` — horas entre la creación y el saque (`event.kickoff_at`), y
2. `best_odds ≥ 1 / market_prob` — la mejor cuota disponible es **igual o mejor que la justa del consenso**
   (de-vig proporcional a dos lados, sin cambios). Se guarda también `price_vs_fair = best_odds · market_prob`
   (≥ 1,0 ⇔ cumple la condición 2).

Los dos campos se escriben en `buildClubDailyPicks` (server.js, bloque "PREREGISTROS") a partir de los valores
de creación (`odds_at_create`, `books_at_create`, `hours_to_ko` los congela `mkRecord`; `refreshClubPickPrices`
no los pisa). Todo lo demás de GOALS sigue igual: consenso, ancla, gate, regime, publicación.

## Tamaño de muestra y vara

- **60 picks** con la etiqueta en `true` y liquidadas (WIN/LOSS). Con ~130 GOALS decididas en el libro y una
  fracción ≈45 % de "tarde", son unas 6-8 semanas de temporada de clubes.
- **Vara primaria: CLV.** El mercado de goles es eficiente (§4.2 de la autopsia: el cierre es la vara), así que
  la regla se acepta si el CLV medio de las etiquetadas es **≥ 0 %** con IC 95 % que excluya el −1,32 % del
  libro completo (t ≥ 2 sobre la diferencia). El ROI se reporta a `odds_at_create` (`roi_at_create`) como
  dato secundario, no como criterio.
- **Comparador:** las GOALS con `prereg_goals_late: false` del mismo periodo (mismo consenso, mismo gate).
- **Se rechaza** si a las 60 picks el CLV de las etiquetadas no es distinguible del resto (t < 1) o es negativo.

## Dónde se lee

Track admin de clubes (`/api/internal/clubs-picks?key=…` → `track_record`): bloques
`GOALS|prereg_goals_late:on` y `GOALS|prereg_goals_late:off`, cada uno con `n`, `hit_rate`, `roi`,
`roi_at_create`. El CLV por pick sigue en `clv` / `clv_ev_pp` de cada registro (captura de cierre sin cambios).

## Lo que este preregistro NO hace

- No toca la probabilidad publicable de GOALS ni su de-vig (proporcional a dos lados).
- No cambia qué GOALS se publican ni cuándo.
- No toca CORNERS ni CARDS.
