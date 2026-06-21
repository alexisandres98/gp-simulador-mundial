# Sprint 4 — Seguridad

## Admin
- Autenticación + autorización por `isAdmin` (ADMIN_EMAILS / primer usuario). 403 si no admin.
- No se confía en IDs del cliente: rutas con regex de UUID/`op_…`; queries **parametrizadas** ($1,$2…).
- Audit log completo (`arb_publication_history`).

## Calculadora
- Rate limit por usuario (`EXEC_PUBLIC_CALC_RATE_LIMIT`/min).
- Límites de input (positivo, ≤ tope), sin SQL dinámico, sin ejecución de código.
- Recálculo server-side; no se confía en cálculos del browser. No devuelve errores internos crudos.

## Deep links
- Allowlist de dominios (`polymarket.com`, `kalshi.com`), solo HTTPS.
- Sin open redirects (rechaza params de redirección), sin credenciales embebidas, sin URLs arbitrarias desde el frontend.
- `target=_blank` + `rel="noopener noreferrer nofollow"`.

## API pública
- Login requerido. Gated por `EXEC_OPPORTUNITIES_PUBLIC_ENABLED` (404 si off).
- Paginación, payloads acotados, **caché corto** (< ventana de validez).
- **No expone**: raw payloads, order books completos, snapshot ids, input_hash, tokens, secrets, IDs internos
  innecesarios, datos de otros usuarios, reglas internas de seguridad. Redacción por lista blanca en `presentation.js`
  (verificado en tests).

## Datos
- Migración 012 no toca tablas previas; rollback (`-- +migrate down`) elimina solo lo de Sprint 4.
- Analítica nunca persiste capital/bankroll/saldos (solo rangos anónimos opcionales). `db.json` intacto.
