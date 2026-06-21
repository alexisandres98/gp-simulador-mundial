# GP Intelligence — Política de factores (anti double-counting)

> Cómo la capa de contexto (V2 challenger) traduce señales reales a ajustes, evitando que una misma
> información se cuente varias veces. El modelo global (V1 control) NO se toca. Versión: `factor-policy-1`.

## Principio
El **Elo ya contiene** información histórica de rendimiento/fuerza. La capa de contexto solo debe
añadir lo que el Elo **no** capta de la situación actual (forma muy reciente, bajas confirmadas hoy,
descanso, calidad de plantilla), y hacerlo con **límites** para no penalizar/premiar tres veces la
misma señal.

## Dos ejes SEPARADOS (no se suman entre sí)
| Eje | Qué ajusta | Factores |
|---|---|---|
| **Elo** | fuerza global → 1X2 | forma, racha, solidez, calidad de plantilla, bajas, descanso |
| **xG** | volumen de goles → totales/marcadores | perfil ataque/defensa (de la forma) |

El eje xG **no** suma al Elo: un equipo con buena racha goleadora ajusta su Elo (vía forma) y, por
separado, su tasa de goles (vía perfil xG). Son dimensiones distintas (quién gana vs cuántos goles).

## Grupos del eje Elo y CAPS (configurables server-side)
| Grupo | Factores | Cap por grupo (Elo) | Env |
|---|---|---|---|
| **PERFORMANCE** | FORM, STREAK, SOLIDITY | ±40 | `GP_INTELLIGENCE_CAP_PERFORMANCE` |
| **SQUAD** | SQUAD_QUALITY, AVAILABILITY | ±35 | `GP_INTELLIGENCE_CAP_SQUAD` |
| **LOAD** | REST | ±12 | `GP_INTELLIGENCE_CAP_LOAD` |

Los factores de PERFORMANCE (forma, racha, fragilidad) **derivan todos de los resultados recientes** →
si se sumaran libres, los mismos malos resultados penalizarían 3 veces. El **cap de grupo** lo impide.

## Orden de aplicación
1. Cada factor calcula su **contribución uncapped** (en Elo), dentro de su propio rango.
2. Se **suma por grupo** y se aplica el **cap del grupo** (escalado proporcional: preserva el peso
   relativo de los factores dentro del grupo).
3. Se **suman los grupos** → total uncapped.
4. Se aplica el **safety cap global** `±GP_INTELLIGENCE_MAX_ELO_ADJUSTMENT` (default 55).

```
factor → grupo (cap) → suma de grupos → safety cap global → Δ Elo final
```

## Safety cap ±55
Es una **barrera de seguridad**, NO un valor científicamente calibrado (= `ELO_NOISE` del torneo).
Configurable (`GP_INTELLIGENCE_MAX_ELO_ADJUSTMENT`). Se calibrará después con Brier / log loss / CLV /
backtesting cuando haya muestra. **No cambiar 55 sin evidencia.**

## Frescura y procedencia (no inventar datos)
Cada factor lleva `source`, `source_updated_at`, `fetched_at`, `expires_at`, `included`,
`exclusion_reason`. Si un dato está **stale** → `included:false, exclusion_reason:'stale'` (contribución
0). Si **falta** → `missing`. La ausencia de información **reduce la calidad de datos**, no crea un
ajuste artificial.

## Data quality ≠ model confidence
- **Data quality** (Alta/Media/Baja/Insuficiente): completitud y frescura de las fuentes.
- **Model confidence** (Alta/Media/Baja): señal estadística (diferencia de fuerza, dispersión).
Son independientes: se puede tener confianza alta del modelo (favorito clarísimo) con calidad de datos
baja (faltan alineaciones), y viceversa. Se muestran por separado en el sandbox.

## Factores actuales (resumen)
| factor_code | grupo | eje | rango uncapped | fuente |
|---|---|---|---|---|
| FORM | PERFORMANCE | elo | ±40 | api_football |
| STREAK | PERFORMANCE | elo | ±14 | api_football |
| SOLIDITY | PERFORMANCE | elo | ±12 | api_football |
| SQUAD_QUALITY | SQUAD | elo | ±22 | api_football (ratings) |
| AVAILABILITY | SQUAD | elo | −42..0 | api_football (lesiones, ponderado por jugador clave) |
| REST | LOAD | elo | ±10 | derivado (fechas de resultados) |
| XG_PROFILE | — | xg | — | api_football (forma) |
