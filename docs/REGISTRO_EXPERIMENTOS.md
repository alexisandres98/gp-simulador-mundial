# Registro de experimentos — GP Simulador

> Abierto el 15-sep-2026 por exigencia de la auditoría externa (§4.3, §4.4).
> **Aquí se anota TODO intento, incluidos los que salen mal.** Un registro que solo guarda los aciertos no
> es un registro: es una vitrina, y una vitrina no permite saber cuántas veces se buscó antes de encontrar.
> Sin ese número, ningún resultado significativo lo es.

## Por qué existe

La auditoría encontró que llevamos meses probando variantes de modelo y quedándonos con la que mejor
puntuaba, sin anotar cuántas se probaron. Con treinta comparaciones y un umbral de 5 %, una y media sale
"significativa" por puro azar. El remedio no es dejar de probar: es anotar todas las pruebas y corregir el
umbral por el número de comparaciones (Benjamini–Hochberg al 10 %, `lib/inferencia.js` → `bh()`).

## Reglas del registro

1. **Se anota ANTES de mirar el resultado.** La fila nace con hipótesis, datos, protocolo y criterio de
   éxito. El resultado se rellena después. Una fila que aparece ya con resultado es sospechosa por diseño.
2. **Un intento es una fila.** Cambiar un hiperparámetro y volver a correr es un intento nuevo si la
   decisión de cambiarlo vino de haber visto el resultado anterior. Si el barrido estaba declarado de
   antemano, es un solo intento.
3. **El protocolo temporal es anidado** (§4.4): los hiperparámetros se eligen DENTRO del entrenamiento, en
   una validación interna que nunca toca el bloque que se evalúa.
4. **La incertidumbre es por racimos**, no por tickets. Tres líneas del mismo partido no son tres datos.
5. **Ganar aquí no es invertir.** Un aspirante que describe mejor el conteo sigue teniendo que pasar
   `lib/vara.js` contra el precio antes de que se hable de dinero.

## Estado de los experimentos

| # | Fecha | Familia | Hipótesis | Datos | Protocolo | Criterio de éxito | Resultado | Veredicto |
|---|-------|---------|-----------|-------|-----------|-------------------|-----------|-----------|
| E-001 | 15-sep-2026 | Tarjetas (`cards_under_v1`) | El modelo actual (nivel de liga del prop-engine, TOTALS_DAMP=0) no es mejor que un nivel dinámico por liga×temporada, ni que las leyes de conteo alternativas | 10.436 partidos de clubes, 40 ligas, temporadas 2025 y 2026 (`data/clubs/props-history-*.json`) | Validación hacia adelante en 10 bloques mensuales sobre 8.078 partidos; hiperparámetros por validación interna al 80 % del entrenamiento; cuatro leyes con la MISMA media | Un aspirante gana a T0 en log-score y CRPS, y no empeora la calibración en 4,5/5,5/6,5 | **T2b·NB gana**: Δlog −0,00897, IC [−0,01172, −0,00612], t −6,25, sobrevive BH al 10 %. Gana también en CRPS (1,17716 vs 1,18198) y mejora la calibración en las tres líneas. Se repite con el conteo de la casa (Δlog −0,00841, t −5,46) | **confirmado** |
| E-002 | 15-sep-2026 | Tarjetas | Las fuerzas de equipo aportan señal al TOTAL cuando hay 10.000 partidos, aunque no la aportaran con los 102 del Mundial | ídem E-001 | El exponente de amortiguación `damp` se elige dentro del entrenamiento; si las fuerzas son ruido, el propio entrenamiento lo pone a 0 | `damp > 0` elegido en la mayoría de los bloques Y mejora de log-score sobre T1 | **`damp > 0` en 10/10 bloques** (damp = 1 en ocho). T2a gana a T0: Δlog −0,00536, t −4,59 | **confirmado** |
| E-003 | 15-sep-2026 | Tarjetas | El árbitro aporta cuando se estima sobre el RESIDUO (descontando liga y equipos) y no sobre el bruto — hallazgo A19: hoy se entrena y no se sirve | ídem E-001, 10.199 partidos con árbitro identificado | ídem; multiplicador encogido y topado ±20 % | T2b gana a T2a en log-score con la diferencia fuera del error por racimos | **Δlog −0,00309, IC [−0,00473, −0,00152], t −3,80, p 0,0001** (conteo de la casa: −0,00335, t −3,28). El árbitro es el aspirante entero | **confirmado** |
| E-004 | 15-sep-2026 | Tarjetas — contrato | Cloudbet liquida el mercado de tarjetas con el mismo conteo que nosotros (amarillas + rojas) | Reglamento de Cloudbet + 113 apuestas reales liquidadas por la casa, cruzadas con las estadísticas del partido | Se buscan las apuestas donde los dos conteos dan veredictos OPUESTOS y se mira cuál reprodujo la casa | Si algún caso contradice el reglamento, el reglamento no se aplica | **REFUTADA. Una roja vale DOS.** El reglamento lo dice literal y los dos únicos casos diagnósticos (Stoke–Charlton under 4,5 y Palmeiras–São Paulo under 6,5) los pagó la casa como perdidos mientras nuestro conteo los daba ganados. Cuesta 2,24-3,35 pp de P(under) según la línea | **refutada — liquidador corregido** |

## Intentos descartados

_(Ninguno todavía en este registro. Los anteriores al 15-sep no se anotaron — ese es exactamente el
problema que la auditoría señaló, y no se puede reconstruir a posteriori sin inventar. Los experimentos
previos documentados viven en `docs/PREREGISTRO_*.md` y `docs/impl/*-REPORT.md`, sin contador de intentos.)_

## Contador de comparaciones vivas

Para la corrección por comparaciones múltiples hay que saber cuántas pruebas están sobre la mesa a la vez.

| Bloque | Comparaciones declaradas | Umbral BH al 10 % |
|--------|--------------------------|-------------------|
| Fase 2 — tarjetas | 12 (cuatro aspirantes × cuatro leyes, menos T0) | **0,08229** con el conteo antiguo, **0,07141** con el de la casa. Sobreviven a favor: T2b·NB, T2a·NB, T2b·COM, T1·NB. Sobreviven EN CONTRA (pierden con claridad): las tres versiones del histograma, T1·com y T1·poisson |
| Fase 2 — CS2 | pendiente de declarar | — |
| Fase 2 — tenis de mesa | pendiente de declarar | — |
| Fase 2 — tenis ATP | pendiente de declarar | — |
