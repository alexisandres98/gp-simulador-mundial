# Sprint 0 — Setup de Render (NO ejecutar todavía)

> Instrucciones exactas para cuando decidas activar la plataforma de datos v2 en Render. **No se ha
> creado ni desplegado nada.** Nada de esto afecta a la app actual hasta que crees la base y actives
> los flags. Yo (Claude) no creo servicios de pago sin tu autorización.

## 1. Crear la base PostgreSQL en Render
1. Dashboard de Render → **New → PostgreSQL**.
2. **Name**: `gp-simulador-db` (o el que prefieras).
3. **Region**: **la MISMA que el web service** (`gp-simulador-mundial`, Oregon) — para latencia mínima
   y para poder usar la *Internal Database URL*.
4. **Plan**: el más barato que cubra el volumen previsto (puedes empezar pequeño y escalar).
5. **PostgreSQL Version**: 16 o superior.
6. Crea la base y espera a que quede *available*.

## 2. Obtener la connection string
- En la página de la base, copia la **Internal Database URL** (no la External): el web service y la
  base están en la misma región/red privada → más rápido y seguro.
- Formato: `postgres://USER:PASSWORD@HOST/DBNAME`.

## 3. Variables de entorno en el WEB SERVICE (no en la base)
Web service `gp-simulador-mundial` → **Environment** → añade:
```
DATABASE_URL = <Internal Database URL copiada>
DB_SSL = true
MARKET_DATA_PLATFORM_V2 = false      # actívalo cuando quieras inicializar la capa
MARKET_DATA_WRITE_ENABLED = false    # se activa en Sprint 1+ (collectors)
```
> `DATABASE_URL` es un secreto: va SOLO aquí (env del backend), nunca en el repo ni en el frontend.
> Render Postgres requiere SSL → `DB_SSL=true`.

## 4. Build command (instalar `pg`)
La app pasa a tener una dependencia (`pg`). Asegúrate de que el web service la instale:
- **Build Command**: `npm install`
- **Start Command**: `node server.js` (sin cambios)

(Hoy `render.yaml` tiene `buildCommand: ""`. Habrá que ponerlo en `npm install` cuando actives esto.)

## 5. Ejecutar migraciones
Opciones:
- **Manual (recomendado la primera vez)**: en la base de Render, usa la pestaña **Shell**/**psql** o
  conéctate con la *External URL* desde tu máquina y corre `npm run db:migrate` apuntando a esa URL.
- **Automático**: añadir `npm run db:migrate` como *pre-deploy command* (Render lo soporta) o al
  arranque. **No** lo automatices hasta validar manualmente la primera migración.

## 6. Rollback
```bash
npm run db:rollback   # revierte la última migración (usa la sección -- +migrate down)
```

## 7. Backups
- Render PostgreSQL incluye backups automáticos según el plan. Verifica la política del plan elegido.
- Considera un export periódico adicional (`pg_dump`) si el dato se vuelve crítico (Sprint 5+).
- Recuerda: hoy `db.json` (usuarios/closing line) vive en el disco `/data`; la migración de esos datos
  a Postgres NO es parte del Sprint 0.

## 8. Comprobación posterior al deploy
1. `GET /api/internal/platform-health` (admin) → `database.connected: true`, `migrationStatus: up_to_date`.
2. `MARKET_DATA_PLATFORM_V2` y `writeEnabled` reflejan lo que pusiste.
3. La app pública sigue **idéntica** (oportunidades, partidos, alertas, Telegram) — los flags en
   `false` garantizan cero cambios visibles.

## 9. Qué NO hacer en Sprint 0
- No activar `MARKET_DATA_WRITE_ENABLED` (no hay collectors aún).
- No apuntar ninguna ruta pública a la nueva base.
- No migrar usuarios ni resultados todavía.
