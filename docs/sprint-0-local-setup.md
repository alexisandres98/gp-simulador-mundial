# Sprint 0 — Setup local

> Cómo levantar la plataforma de datos v2 en local. La app actual sigue funcionando **sin** estos
> pasos (la capa v2 solo se activa si hay `DATABASE_URL`).

## 0. Dependencias
La app actual es zero-dependency, pero la capa v2 usa el driver `pg`:
```bash
npm install        # instala pg (declarado en package.json)
```

## 1. PostgreSQL local (o una URL de desarrollo)
Necesitas un PostgreSQL accesible. Opciones:
- **Postgres local** (Homebrew): `brew install postgresql@16 && brew services start postgresql@16`,
  luego `createdb gpsim_dev`.
- **Docker**: `docker run -d --name gpsim-pg -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16`.
- **URL de desarrollo gestionada** (Render/Neon/Supabase): copia su connection string.

## 2. Configurar `.env` (gitignored)
Copia la plantilla y rellena solo lo de la sección Sprint 0:
```bash
cp .env.example .env
```
```env
DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/gpsim_dev
DB_SSL=false            # true si tu Postgres exige SSL (Render sí)
MARKET_DATA_PLATFORM_V2=true
MARKET_DATA_WRITE_ENABLED=false
```
> Nunca subas `.env`. Nunca pongas la URL con credenciales en el frontend ni en logs.

## 3. Ejecutar migraciones
```bash
npm run db:migrate
```
Crea 10 tablas + `schema_migrations`. Idempotente: re-ejecutar no duplica nada.

## 4. Verificar estado de migraciones
```bash
npm run db:status
# Aplicadas: 4 · Pendientes: 0 · AL DÍA ✅
```

## 5. Iniciar la aplicación
```bash
npm start            # node server.js → http://localhost:3000
```
La app arranca igual que siempre; la capa v2 queda disponible pero sin polling (Sprint 0).

## 6. Probar el health check
- CLI: `npm run platform:health` (imprime el snapshot JSON, sin secretos).
- HTTP (admin-only): inicia sesión como admin y consulta
  `GET /api/internal/platform-health` con tu `Authorization: Bearer <token>`.
  Respuesta esperada con DB arriba:
  ```json
  { "status": "ok",
    "database": { "configured": true, "connected": true, "latencyMs": 3, "migrationStatus": "up_to_date" },
    "platformV2": { "enabled": true, "writeEnabled": false }, "providers": [ ... ] }
  ```

## 7. Rollback (opcional)
```bash
npm run db:rollback   # revierte la última migración aplicada
```

## 8. Desactivar la nueva capa
Quita `DATABASE_URL` (o pon `MARKET_DATA_PLATFORM_V2=false`) y reinicia. La app vuelve al estado
"sin DB": `configured:false`, todo lo demás intacto. **No tumba producción.**

## 9. Variables que habrá que añadir a Render (más adelante)
Ver `sprint-0-render-setup.md`. Resumen: `DATABASE_URL` (Internal URL), `DB_SSL=true`,
`MARKET_DATA_PLATFORM_V2`, `MARKET_DATA_WRITE_ENABLED` (ambas `false` al principio).
