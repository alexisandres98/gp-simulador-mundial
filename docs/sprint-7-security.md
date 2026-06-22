# Sprint 7 — Seguridad

- **API keys solo en entorno** (Render env). Nunca en repo, DB, payloads, ni logs.
- Endpoints admin: autenticación + autorización (isAdmin), 403/404 gated, validación, queries parametrizadas, audit log.
- Deep links: reutiliza Sprint 4 (allowlist polymarket/kalshi, HTTPS, anti open-redirect). No URLs arbitrarias desde frontend.
- **No aceptar odds/probabilidades desde el frontend**: provienen de evaluaciones server-side.
- API pública: sin raw provider payloads, sin secrets, sin notas internas, sin IDs internos innecesarios.
- No ejecución de apuestas, no conexión de cuentas, no custodia de fondos, no bankroll, no PII financiera.
