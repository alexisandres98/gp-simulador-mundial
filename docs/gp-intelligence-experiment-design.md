# GP Intelligence — Diseño del experimento (V1 control vs V2 challenger)

> Cómo se medirá si GP Intelligence (V2) mejora al modelo global (V1) **sin** contaminar el track
> record actual. En Sprint 0.1 solo se deja preparada la infraestructura; la medición es posterior.

## Control vs challenger
- **V1 CONTROL** = modelo global (`gp-core-1.4.0`): Elo → Poisson → Dixon-Coles → calibración λ=0.15 →
  Monte Carlo. **Es la fuente de verdad del producto y del track record.** No se toca ni se reemplaza.
- **V2 CHALLENGER** = GP Intelligence (`gp-intelligence-0.2.0`): V1 como prior + capa de contexto
  (forma, plantilla, bajas, descanso, xG por equipo). **Solo vive en el sandbox "Simula cualquier cruce".**

Cada ejecución del sandbox produce y conserva: probabilidades **V1**, probabilidades **V2** y el
**delta V2 − V1** (en puntos porcentuales por resultado). Nunca se sustituyen silenciosamente las
probabilidades globales por las de V2.

## Registro de ejecuciones (`model_analysis_runs`)
Tabla genérica (migración 008) para guardar cada análisis cuando el flag esté activo:
- flag `GP_INTELLIGENCE_EXPERIMENT_LOGGING=false` por defecto → **no escribe**.
- sin `DATABASE_URL` → no escribe (GP Intelligence sigue funcionando).
- un fallo al registrar **nunca** rompe la simulación del usuario (best-effort).

Se guardan: `input_hash`, `random_seed`, `simulation_count`, versiones (`control`/`challenger`/
`factor_policy`), referencias de equipos/evento, `input_payload`, `context_payload` (breakdown de
factores), `control_output` (V1), `challenger_output` (V2), `data_quality_payload`. **Sin secretos.**

## Reproducibilidad
- Monte Carlo con **PRNG seeded** (`makeRng`). La seed se deriva determinísticamente del `input_hash`
  (equipos, Elos, ajustes, λ, versión). Mismo input + misma versión → mismos outputs.
- Cada ejecución es reproducible; dos ejecuciones distintas no comparten seed.

## Versionado
Cada ejecución identifica: `control_model_version`, `challenger_model_version`, `factor_policy_version`,
`data_schema_version`, `normalizer_version`. Permite reinterpretar una ejecución histórica con la
lógica vigente cuando ocurrió.

## Cómo se evaluará (futuro, NO en este sprint)
Cuando haya partidos reales con su resultado:
1. Para cada partido, comparar la predicción **V1** y la **V2** previas contra el desenlace.
2. Métricas por modelo y por separado: **Brier**, **log loss**, calibración; y si hay mercado,
   **CLV** (closing line value).
3. Promover V2 solo si **mejora de forma estable y con muestra suficiente** (no por un par de aciertos).

## Reglas duras
- **No mezclar** V2 con el track record/aciertos/Brier públicos (que siguen siendo de V1).
- **No recalcular** predicciones antiguas como si GP Intelligence hubiera existido entonces.
- V2 permanece como **challenger experimental** hasta que la evidencia justifique promoverlo.
