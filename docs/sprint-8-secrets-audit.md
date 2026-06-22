# Sprint 8 — Auditoría de secretos (§66)

Solo NOMBRES y estado. **Nunca valores.** Todos los secretos vienen de `process.env` (Render), nunca del
repo, DB, logs, fixtures, screenshots ni responses públicas.

| Secreto (env) | Uso | Estado | Nota |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL | configured (Render) | externo solo para migrar desde local |
| `SPORTSBOOK_PROVIDER_API_KEY` | The Odds API | **missing** | ponerla en Render al activar fase 3; redactada de toda URL/log (`redactKey`) |
| `API_FOOTBALL_KEY` | datos contextuales | configured | 🔑 PENDIENTE rotar (expuesta hace tiempo) |
| `RESEND_API_KEY` | email | configured | — |
| `TELEGRAM_BOT_TOKEN` | canal @gpsimulador | configured | 🔑 expuesto en chat jun-22 → rotar en BotFather |
| `MAIL_WEBHOOK_TOKEN` | relay GAS | configured | — |
| `ADMIN_EMAILS` | gate admin | configured | server-side, no confía en frontend |
| `RENDER_API_KEY` | deploys | configured (chat) | 🔑 rotar al terminar |

## Verificaciones aplicadas en Sprint 8
- La API key de sportsbooks viaja solo en el query string hacia el host oficial y se **redacta** (`apiKey=***`)
  en cualquier error/log (`theOddsApiProvider.redactKey`). Tests lo verifican.
- `error_summary` de los job runs y `safe_payload` de las dead letters se **redactan** (logger.redact) —
  los tests verifican que no aparecen `postgres`/`password`.
- Analítica: lista negra de claves (`bankroll|stake|password|api_key|card|cvv|secret|token`) rechaza propiedades sensibles.
- Waitlist: rechaza cualquier campo de pago (`card|cvv|iban|stripe|payment|deposit`).
- Billing: ningún secreto de Stripe se solicita ni usa (provider noop).

## Pendientes de rotación (heredados + nuevos)
1. `API_FOOTBALL_KEY` (expuesta hace tiempo).
2. `TELEGRAM_BOT_TOKEN` (expuesto jun-22 en chat).
3. `RENDER_API_KEY` (usada en chat jun-22).
