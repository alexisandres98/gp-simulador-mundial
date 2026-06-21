# Sprint 4 — Testing

## Suites
| Comando | Qué cubre | Resultado |
|---|---|---|
| `npm run test:exec` | Eligibility (§34), revalidación (§35), calculadora (§36), deep links (§37), jurisdicción (§38), redacción (§12), analítica (§27). Puro, sin DB. | **65/65** |
| `npm run test:optimizer` | Hardening del size optimizer: binaria del motor vs breakpoints vs oráculo denso (4 golden + 200 aleatorios reproducibles). | **6/6** |
| `npm run test:exec-db` | Ciclo de vida de publicación contra PostgreSQL real (embedded-postgres): migración 012, draft→approve→publish→revalidate→pause→withdraw, auditoría, snapshot, NO auto-publicación, terminales no reviven. | **23/23** |

Sin regresiones: `test:arb` 40, `test:gpi` 31, `test:canonical` 24, `test:market-data` 40 — todos verdes.

## Golden UI dataset (`exec-opportunities/fixtures/golden-ui.js`, §41)
10 casos evaluados por el motor real: pure arb profundo, pure arb pequeño, execution-sensitive, expired, stale,
rules changed, jurisdiction restricted, derived ask, 1X2, fee-heavy.

## Hardening del optimizer (§40) — resultado
Condición del spec verificada: en 204 casos (4 golden + 200 aleatorios con LCG semilla fija), la binaria del motor
**nunca** devolvió un tamaño no elegible (`binaryInfeasible=0`) ni perdió un tamaño elegible materialmente superior
(`missMaterial=0`). Decisión: la calculadora pública usa `breakpointMaxSize` (búsqueda en breakpoints + micro-binaria
en el cruce continuo) como defensa en profundidad; el motor conserva su binaria. Documentado en `sprint-4-calculator.md`.

## Verificación de UI (preview, móvil 375px)
Cards, hero (grilla 2×2), desglose económico, patas con precio límite ("No ejecutar por encima de…"), calculadora,
riesgos, deep links separados con aviso de jurisdicción, metodología versionada. **0 errores de consola**; countdown
"validado hace Ns" actualiza cada segundo. Redacción verificada (sin snapshot ids / order books / términos prohibidos).

## PostgreSQL embebido
`tests/_pg-harness.js` arranca `embedded-postgres` (instalar con `npm i --no-save embedded-postgres`) si no hay
`DATABASE_URL`; lo poda al terminar. `DB_SSL=false` para local.
