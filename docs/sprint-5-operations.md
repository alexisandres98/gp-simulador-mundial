# Sprint 5 — Operación

## CLI
```bash
npm run signals:status         # total, verified, legacy, experimental, score eligible, pending settlement,
                               # closing unavailable, chain head, commitments
npm run signals:verify-chain   # verifica de genesis a head; exit 1 si hay inconsistencia
npm run signals:verify-signal -- --id=<public_id>
npm run signals:commit-day -- --date=YYYY-MM-DD   # commitment idempotente
npm run signals:capture-closing  # (vía scheduler/endpoints, requiere SIGNAL_CLOSING_CAPTURE_ENABLED)
npm run signals:settle           # (vía scheduler/endpoints, requiere SIGNAL_SETTLEMENT_ENABLED)
```
Contra la DB de Render: prefijar `DATABASE_URL=<externo> DB_SSL=true`.

## Integraciones
- **V1 (predicción oficial)**: admin `POST /api/internal/signals/publish-model` congela probabilidades + modelo +
  inputs + timestamp + versiones. No publica automáticamente todas las simulaciones (auto-model-capture off).
- **Sprint 4 (arb)**: con `SIGNAL_REGISTRY_AUTO_ARB_CAPTURE_ENABLED`, `publicationService.publish` crea la señal en
  la MISMA transacción ("no signal → no public publication"). Con el flag off, Sprint 4 se comporta como antes.
- **V2 (GP Intelligence)**: `captureExperiment` registra experimentos con `experimental=true`, `score_eligible=false`.
  Nunca se promueve al track record durante este sprint.

## Endpoints admin (§32)
`GET /api/internal/signals`, `GET :id`, `POST publish-model`, `POST :id/{withdraw|add-correction|settle|capture-closing}`,
`POST verify-chain`. Admin-only (403), 404 si registry off, rate-limit en escritura, validación, sin modificación de
señal original ni publicación retroactiva como verificada.

## Performance (§46)
Inserción 1000 señales ≈ 2.3 ms/señal (advisory lock + transacción). Verificación de cadena de 1012 señales ≈ 313 ms.
Para escala, verificar por rangos / paginar; la verificación no bloquea el servidor principal.
