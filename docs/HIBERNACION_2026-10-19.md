# Hibernación de GP Simulador — manual completo (19-oct-2026)

> Orden de Alexis, 19-oct: «Hagamos un shutdown temporal, ponerla a hibernar. No tiene sentido seguir pagando
> esos costes mensuales y seguir en negativo. Cancela todo lo que incurra en costes y guarda absolutamente
> todo, que en unos meses sea solo poner una tarjeta, pagar lo que haya que pagar y levantar todo sin
> problemas y dejarlo donde lo dejamos.»
>
> Este documento es el manual de las dos mitades: **dormir** (hoy) y **levantar** (cuando toque). Está escrito
> para que lo ejecute Alexis con el repo clonado y sin ayuda, y para que una sesión de Claude futura lo lea y
> sepa exactamente dónde quedó todo. Lo que la sesión de hoy pudo hacer sola está hecho (código, scripts,
> página de pausa, rutina semanal apagada); lo que requiere sus cuentas y sus claves está aquí, en orden.

## 0. Qué significa «hibernar» aquí

| | dormida | despierta otra vez |
|---|---|---|
| **Código** | en GitHub (`main`, público), intacto | se despliega el mismo `main` |
| **Datos** | **todo el disco persistente** (`/data`) en un `.tar.gz` verificado, en dos sitios de Alexis; Postgres en un `pg_dump` | se suben con `scripts/levantar.js` + `pg_restore` |
| **Usuarios** | 985 dentro de `db.json` (y el CSV diario en Gmail) | entran con el mismo correo |
| **Configuración** | las variables de entorno de los tres servicios de Render, exportadas a `render/*.env` | se vuelven a pegar (rotando las claves pendientes) |
| **Dominio** | gpsimulador.com sigue de Alexis; apunta a una **página de pausa** gratis en GitHub Pages | DNS de vuelta a Render |
| **Telegram, Gmail, Apps Script, Whop, Google OAuth, Cloudbet** | cuentas gratuitas: se quedan | se reusan |
| **Coste mientras duerme** | **≈ 1 USD/mes** (el dominio, prorrateado). Nada más. | lo que decida la estrategia nueva |
| **Rutina semanal de Claude** | **apagada** (19-oct; `trig_01PM23qE8VEsn2gPNRsPzY5X`, enabled=false) | se vuelve a encender |

Lo que NO se guarda porque no existe fuera de las cuentas de terceros: el historial de apuestas dentro de
Cloudbet (se puede consultar en su web mientras la cuenta exista) y las estadísticas internas de Whop/Resend.
Nada de eso lo necesita la plataforma para arrancar.

## 1. Inventario: dónde vive cada cosa

### 1.1 El disco persistente de Render (`/data`, 5 GB) — ES LO QUE HAY QUE SACAR
Todo cuelga de `dirname(DB_FILE)`. Lo exporta entero `GET /api/internal/hibernar?key=&tar=1` (ruta nueva, 19-oct):

| carpeta / fichero | qué es | lo escribe |
|---|---|---|
| `db.json` | usuarios, sesiones, grants pro/sharp, picks del Mundial y de clubes, combate, goles, hoops, **la sombra entera** (`db.shadow`), validación de tarjetas, ops, Telegram enviados | `server.js` |
| `real-ledger.json` | **el libro del dinero real** (apuestas, días, nocional, realizado, conciliación) | `real-executor/store.js` |
| `backups/` | copias diarias de `db.json` (14 días), `almacenes/<día>` (gzip de los libros), `etiquetas/<nombre>` | `server.js` |
| `clubs/` | **229 MB**: `props-history-*.json`, `results-*.json`, `player-history-*.json`, fotos, mapa AF, `fotmob-*.json`, censo de tarjetas | pases de datos de clubes |
| `esports/` | picks, cierres y props por juego (`picks-cs2.json`…), `props-cs2.json` | `esports-engine/store.js`, `props.js` |
| `propfirm/` | señales, `poly-sombra.json`, `poly-sombra-v2.json`, `poly-mm*.json`, cotizables | `propfirm/*.js` |
| `nfl/`, `nfl-agg/` | picks, cierres, sombra, cuotas, priors; datos point-in-time | `nfl-engine/` |
| `amfoot/` | college/CFL: picks, cierres, sombra, rosters | `amfoot-engine/store.js` |
| `tennis/` | *(ojo: el motor de tenis escribe en `data/tennis/disk` DEL REPO, no en `/data`; en Render eso se pierde en cada deploy y ya se asumía)* | `tennis-engine/store.js` |
| `darts/`, `tt/` | picks, cierres, diagnósticos de liquidación, rankings, resultados | `darts-engine`, `tt-engine` |
| `hoops/` | baloncesto | `basketball-engine/store.js` |
| `f1/` | F1 | `f1-engine/store.js` |
| `lol-raw/` | **97.588 partidas + 535k filas de jugador** de Leaguepedia (CC BY-SA) | `scripts/lol-harvest.js` |
| `tt-raw/`, `val-agg/` | crudo ITTF/WTT; agregados de Valorant | harvests |
| `implicito/` | sombras del proceso implícito (fútbol, hoops) | `implied-engine/sombra.js` |
| `shadow/` | ops autónomas | `shadow-ops/` |
| `tournament/`, `player-props-history.json` | Mundial (terminado en julio) | `pick-engine/` |

### 1.2 Postgres `gp-simulador-db` (basic-1gb, disco 60 GB)
45 migraciones en `database/migrations/` (se recrean con `npm run db:migrate`). Tablas: proveedores y corridas,
snapshots, grafo canónico y mapeos, señales y registro de señales, catálogo de mercados y libro, motor de
arbitraje, publicaciones ejecutables, motor de métricas, picks del motor de valor, operaciones, proveedor de
casas (`sportsbook_goal_quote_current` + histórico: **la tabla de cuotas**, millones de filas), alertas y
onboarding, analítica y referidos, entitlements, lifecycle de cierres, hechos métricos, fábrica de candidatos.
**Nada de ahí hace falta para que los usuarios entren**; sí para que nazcan picks de tarjetas (leen
`cards_total`) y para la investigación (dos meses de cierres multi-casa). Se guarda entera con `pg_dump`.

### 1.3 Variables de entorno (Render → cada servicio → Environment)
El código lee **422 nombres distintos** (`docs/hibernacion/ENV_VARS_CODIGO.txt`, generado del código); la
mayoría tiene valor por defecto y no está puesta. **Las que están puestas en Render son la configuración real
y hay que exportarlas tal cual** (`scripts/hibernar.js --render` lo hace a `render/env-<servicio>.env`; a
mano: copiar una a una desde el dashboard). Las imprescindibles para arrancar y sus dueños:

| grupo | variables | de dónde sale el valor al levantar |
|---|---|---|
| disco y base | `DB_FILE=/data/db.json`, `DATABASE_URL`, `DB_SSL` | el servicio nuevo / la base nueva |
| administración | `ADMIN_EMAILS`, `GP_EXPORT_KEY` (**rotar**), `GOOGLE_CLIENT_ID` | Alexis; consola de Google |
| correo | `RESEND_API_KEY` (**rotar**), `MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_WEBHOOK_URL`, `MAIL_WEBHOOK_TOKEN` | Resend; Apps Script |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL=@gpsimulador` | BotFather |
| datos | `API_FOOTBALL_KEY` (**rotar**), `THESTATSAPI_KEY`, `SPORTSBOOK_PROVIDER_API_KEY` (**rotar**), `PINNACLE_GUEST_KEY`, `CFBD_API_KEY`, `PANDASCORE_TOKEN`, `WTT_*`, `FLASHSCORE_FSIGN`, `LOLESPORTS_KEY` | cada proveedor, según lo que se contrate |
| Cloudbet y dinero real | `CLOUDBET_API_KEY`, `CLOUDBET_RELAY_URL`, `GP_RELAY_KEY`, `GP_REAL_*` (todos los canales **apagados** al levantar), `GP_REAL_RELAY_TOKEN` (**rotar**) | Cloudbet; el brazo nuevo |
| LLM | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `GP_LLM_*` | cada proveedor |
| Whop | `WHOP_API_KEY`, `WHOP_WEBHOOK_KEY`, `WHOP_PLAN_*`, `WHOP_FOUNDER_PLAN_IDS` | Whop (**la API v2 muere el 13-nov**: al levantar hay que migrar, §6.7) |
| interruptores de producto | `GP_*_PUBLIC_ENABLED`, `GP_FEED_SIN_VEREDICTO`, `GP_DERIV_NUEVAS`, `GP_POLYMM`, `GP_PROPFIRM_SCAN`, `SPORTSBOOK_DAILY_CREDITS`, `GP_SBGOAL_PURGE`, `NODE_OPTIONS` | tal como estaban en `render/env-gp-simulador-mundial.env` |
| hibernación | `GP_HIBERNADO` | **solo** durante la restauración (§6.4) |

### 1.4 Cuentas externas y su estado al dormir

| cuenta | qué hacer al dormir | se conserva |
|---|---|---|
| **Render** (web `srv-d8krl8flk1mc73c9hbi0`, Postgres `dpg-d8s3lef7f7vs73bkoqtg-a`, relay `srv-da63qc0jo6nc73e9fgt0`) | pagar el saldo pendiente (8 avisos desde el 4-oct), exportar, borrar los tres | la cuenta (gratis) |
| **Hetzner** `gp-cb-relay-hel2` (2.29.18.155, brazo de Cloudbet) y `gp-pm-hel1` (brazo PM, apagado) | pagar la factura 089001282007 (11,83), borrar los dos servidores | la cuenta; el código del brazo está en `relay/cb-relay.js` |
| **The Odds API** (5M créditos, 119/mes, renueva el 21-oct) | **cancelar antes del 21** | la cuenta (plan gratis, 500 créditos) |
| **API-Football** (Ultra, vence el 23-oct) | no renovar: cae sola al gratis | la cuenta y la clave (rotar al levantar) |
| **TheStatsAPI** (50-129/mes) | cancelar la suscripción | la cuenta |
| **Resend** (Pro 20/mes, 5 cobros fallidos) | **bajar a Free, NO borrar la cuenta**: conserva la verificación del dominio `gpsimulador.com` (DKIM/SPF) y 3.000 correos/mes, de sobra para volver | dominio verificado, clave |
| **Anthropic / Gemini / Groq** | nada que cancelar (prepago / gratis) | claves |
| **Whop** | pausar o archivar los productos; comprobar membresías activas (§3.3); retirar saldo (hecho el 18-oct, 13,81) | la cuenta, los planes |
| **Cloudbet** | retirar lo que quede (0,00-0,01), guardar el historial si se quiere (web → Mis apuestas) | la cuenta |
| **Namecheap** (gpsimulador.com) | **conservar con auto-renovación**; cambiar DNS a GitHub Pages (§4.2) | el dominio |
| **Google Apps Script** (relay de correo), **Google OAuth** (login con Google), **Telegram** (bot + canal), **Gmail** (copias diarias) | nada; gratis | todo |
| **GitHub** (repo público) | activar Pages para la página de pausa (§4.2) | el repo |
| **Claude** (esta sesión y la rutina de los lunes) | rutina ya apagada | la sesión; el manual |

## 2. DÍA 1 — Exportar (antes de pagar, antes de cancelar nada)

Render puede suspender cualquier día por el impago; **el volcado no depende del pago** y el servicio responde
hoy. Primero sacar, después pagar, después borrar.

### 2.1 Lo que hace falta
- Un ordenador con **Node ≥ 18** y espacio para unos pocos GB; `git clone https://github.com/alexisandres98/gp-simulador-mundial` y entrar en la carpeta.
- `GP_EXPORT_KEY`: Render → gp-simulador-mundial → Environment.
- Opcional pero recomendado: `RENDER_API_KEY` (Render → Account Settings → API Keys; crear una nueva) para que el script capture servicios, variables, discos y la cadena de Postgres.
- Opcional: el token de admin de la web para la segunda copia de `db.json`: en gpsimulador.com con tu sesión, F12 → Console → `localStorage.getItem('wc_token')`.
- Para Postgres: `pg_dump` instalado (paquete `postgresql-client`; en Mac `brew install libpq`).

### 2.2 Correr el exportador
```bash
node scripts/hibernar.js --key <GP_EXPORT_KEY> --render <RENDER_API_KEY> --token <wc_token> --pg
```
Deja `gp-hibernacion-<fecha>/` (la carpeta está en `.gitignore`: **nunca** se sube al repo) con:
`health.json`, `manifiesto.json` (todo el disco con sha256), `disco.tar.gz` (el disco entero), `disco/`
(desempaquetado y comprobado fichero a fichero), `db-admin.json`, `sondas/` (la foto final de sombra, real,
vara, Polymarket, market making, puertas…), `render/` (**secretos**, modo 600), `postgres.dump`, `RESUMEN.md`.

Si algo falla a mitad, se puede repetir; cada paso es de solo lectura. Para bajar por partes:
`GET /api/internal/hibernar?key=&tar=1&solo=clubs` (una carpeta de primer nivel por llamada) y
`&sin=backups` para excluir las copias internas.

Opcional, para que `db.json` no cambie mientras se baja: poner `GP_HIBERNADO=1` en Render y desplegar ANTES
de exportar. El servicio queda quieto (sin trabajos, sin correos, la web muestra la página de pausa) y el
manifiesto y el tar cuadran al byte. Si no se hace, el script marcará como «distintos» los ficheros vivos que
cambiaron entre el manifiesto y la descarga (normal; el tar lleva la versión más reciente).

### 2.3 Verificar (no saltarse)
`RESUMEN.md` tiene que decir **«disco: VERIFICADO fichero a fichero»** y el número de usuarios de `db.json`
(≈ 985). Si no, repetir con `GP_HIBERNADO=1`. Comprobar a ojo que están `disco/db.json`,
`disco/real-ledger.json`, `disco/clubs/` (cientos de MB), `disco/propfirm/`, `disco/esports/`, `disco/lol-raw/`
y `postgres.dump` (si no se pudo, el comando exacto está en `RESUMEN.md`; el dump también se puede sacar desde
Render → base → Connect → External URL).

### 2.4 Guardar en DOS sitios
Copiar la carpeta entera a (a) un disco externo y (b) una nube (Google Drive / iCloud). `render/` lleva todas
las claves: además, pegar su contenido en el gestor de contraseñas. Hasta que las dos copias existan **no se
cancela nada**.

## 3. DÍA 1-2 — Cerrar lo que está abierto y avisar

### 3.1 El libro real
Antes de congelarlo, que cuadre con la casa: anotar los dos movimientos pendientes (54,81 del 30-sep y 19,19
del 2-4 oct) y el cashback de 40,29 del 16-oct como movimientos (`/api/internal/real?key=&run=movimiento…`),
y resolver la fila «BESTIA vs Damajuana» (una CS2 vieja que la casa liquidó a −5 sin resultado nuestro).
Después, un último `picks-export?real=1` a `sondas/`. Si se prefiere no tocar nada, dejarlo escrito aquí: el
libro exportado tiene una conciliación de −74,00 y un descuadre de −5 pendientes.

### 3.2 Usuarios (985) y canal
Borrador en `docs/hibernacion/AVISOS.md`: un correo por `/api/admin/broadcast` (con sesión de admin; sale por
Resend, hay que mandarlo ANTES de bajar Resend a Free o cabe en los 3.000 del gratis) y un último mensaje
fijado en @gpsimulador. La página de pausa (§4.2) dice lo mismo.

### 3.3 Suscriptores de Whop
`public/legal.html` promete cancelación al final del ciclo pagado, reembolso en 24 h y precio founder de por
vida. En 60 días no hubo ventas, pero puede haber membresías recurrentes vivas: Whop → Memberships → filtrar
activas. Para cada una: cancelar al final del periodo (o reembolsar el prorrateo) y escribir al cliente.
Pagar los 1,90 pendientes del afiliado (`/api/internal/affiliates`). Luego archivar los productos.

## 4. DÍA 2 — Dormir, proveedor por proveedor (en este orden)

### 4.1 Pagar las deudas
Render (saldo pendiente; sin pagar, la cuenta puede quedar terminada y luego no se podrían recrear los
servicios en ella), Resend (la factura fallida, luego bajar a Free), Hetzner (11,83; con factura impagada
bloquean la cuenta y no deja borrar limpio).

### 4.2 Página de pausa en el dominio (gratis)
Está en el repo: `hibernacion/index.html` + `hibernacion/CNAME`, publicada por el workflow
`.github/workflows/pagina-de-pausa.yml`. Una sola vez, a mano:
1. GitHub → repo → Settings → Pages → Source: **GitHub Actions**. Luego Actions → «pagina-de-pausa» → Run workflow.
2. Namecheap → gpsimulador.com → Advanced DNS: borrar el A @ → 216.24.57.1 y el CNAME www → onrender; poner
   **A @ → 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153** y **CNAME www → alexisandres98.github.io**.
3. En Settings → Pages poner Custom domain `gpsimulador.com` y marcar «Enforce HTTPS» cuando el certificado esté (minutos a horas).
Hasta que el DNS cambie, Render seguirá sirviendo la web; si Render ya está en `GP_HIBERNADO=1`, sirve la misma página de pausa.

### 4.3 Cancelar
1. **The Odds API**: cancelar la suscripción (antes del 21-oct).
2. **TheStatsAPI**: cancelar.
3. **API-Football**: no renovar (vence el 23).
4. **Resend**: bajar a Free (Settings → Billing). No borrar el dominio verificado.
5. **Hetzner**: borrar `gp-cb-relay-hel2` y `gp-pm-hel1` (Cloud → proyecto → servidores → Delete). No hay nada en ellos que no esté en el repo.
6. **Render**, **solo con las dos copias verificadas**: borrar `gp-relay-eu`, borrar la base `gp-simulador-db` (Render no conserva copias de una base borrada: el `pg_dump` es la única), borrar `gp-simulador-mundial` (el disco se va con el servicio). Dejar la cuenta con el saldo a cero.
7. **Whop**: productos archivados (3.3). **Cloudbet**: saldo retirado. **Namecheap**: auto-renew encendido.
8. Comprobar que `https://gpsimulador.com` muestra la página de pausa y que nada más cobra: Render 0, Hetzner 0, Odds API 0, TSA 0, Resend 0, API-Football 0.

## 5. Mientras duerme
Nada corre. Lo único vivo: la página de pausa (GitHub), el canal de Telegram (mensaje fijado), el correo
soporte@gpsimulador.com (Gmail) y el dominio. La sesión de Claude conserva este manual; la rutina semanal
está apagada y no cuesta nada. Si en algún momento quieres hacer análisis sobre los datos dormidos, todo está
en `disco/` y `postgres.dump` en formato abierto (JSON y pg_dump): no hace falta levantar nada para leerlos.

## 6. LEVANTAR — cuando haya capital y estrategia

Orden pensado para no pisar lo restaurado y para no arrancar cosechas contra claves muertas.

### 6.1 Render: servicios nuevos
1. Web Service desde el repo (`main`): Node, Build `(vacío)`, Start `node server.js`, Health Check `/api/health`, región Oregon, plan según la estrategia (Standard 2 GB basta sin esports/NFL/LLM; Pro 4 GB era el de producción). **Disco** 5 GB montado en `/data`.
2. Postgres (basic-1gb bastaba; el disco de 60 GB solo por la tabla de cuotas: empezar con menos).
3. Environment: pegar `render/env-gp-simulador-mundial.env` **rotando** `GP_EXPORT_KEY`, `RESEND_API_KEY`, `API_FOOTBALL_KEY`, `SPORTSBOOK_PROVIDER_API_KEY`, `GP_REAL_RELAY_TOKEN` y la de Render; `DATABASE_URL` la nueva; todos los `GP_REAL_*_ENABLED=false`; **`GP_HIBERNADO=1`**. Quitar las claves de servicios que no se vuelvan a contratar (el código funciona sin ellas).
4. Deploy. `GET /api/health` responde y la web muestra la página de pausa: el servicio está quieto.

### 6.2 El disco
```bash
node scripts/levantar.js --carpeta gp-hibernacion-<fecha> --key <GP_EXPORT_KEY nueva> --url https://<servicio>.onrender.com
```
Sube `disco.tar.gz` a `POST /api/internal/hibernar?restaurar=1`; el servidor lo desempaqueta en
`/data/.hibernacion-restaurar-<ts>`, cambia de golpe (lo que hubiera queda en `.hibernacion-previo-<ts>`,
no se borra) y **termina el proceso** para arrancar leyendo el `db.json` restaurado. El script espera, compara
el manifiesto nuevo con `manifiesto.json` y dice qué falta.

### 6.3 Postgres
`pg_restore --no-owner --no-privileges -d "<DATABASE_URL externa nueva>" postgres.dump`. Si se prefiere
empezar sin el histórico de cuotas: `npm run db:migrate` crea el esquema vacío (las picks de tarjetas tardan
unas horas en tener cuotas otra vez).

### 6.4 Encender
Quitar `GP_HIBERNADO` del Environment y desplegar. Comprobar `/api/internal/ops?key=` (usuarios, trabajos,
memoria), `/api/internal/shadow?key=` (el banco y las apuestas donde se dejaron), `/api/internal/real?key=`
(el libro), `/api/internal/hibernar?key=` (`por_carpeta` igual al manifiesto).

### 6.5 Dominio
Namecheap: A @ → IP del servicio nuevo (Render la muestra en Settings → Custom Domains), CNAME www →
`<servicio>.onrender.com`; añadir el dominio en Render. Quitar el Custom domain de GitHub Pages (o dejar el
workflow sin dominio: no estorba).

### 6.6 Proveedores, según la estrategia nueva
Lo mínimo para fútbol de clubes y tarjetas: API-Football Pro (19), Resend Free o Pro, Cloudbet (gratis) y, si
se va a colocar dinero, **un brazo en Hetzner** (`relay/cb-relay.js`, cloud-init en HANDOFF 1-sep: nodejs +
certificado autofirmado + systemd; variables `GP_RELAY_KEY`, `CLOUDBET_API_KEY`, `PORT=8443`; en Render
`CLOUDBET_RELAY_URL=https://<ip>:8443` y `GP_RELAY_KEY`). The Odds API, TheStatsAPI, LLM de pago y los demás
deportes solo si la estrategia los pide (costes en `docs/COSTES_Y_MODO_MINIMO_2026-10-10.md`).

### 6.7 Deuda que espera al despertar (no se hizo al dormir, a propósito)
- **Whop API v2 muere el 13-nov-2026**: migrar los cinco sitios de `server.js` (memberships ×2, cancel, checkout_sessions, webhook) a `/api/v1` y al webhook firmado antes de volver a vender. Alternativa: grants a mano en `/api/admin/grants`.
- Rotación de las seis claves (arriba) y `GP_EXPORT_KEY` nueva en el bloc de la sesión de Claude.
- El detector de límite de API-Football no reconoce el cupo diario ni la temporada fuera de plan (`afLimitado`, `server.js`); con el plan gratis el mapa de partidos se vacía en cuatro días.
- El correo semanal de la sombra lee el cierre de un campo que la sombra no escribe (`close_odds` vs `closing`) y su veredicto es del libro agregado.
- Conciliación del libro real (−74,00 y la fila BESTIA–Damajuana) si no se cerró en §3.1.
- Volver a encender la rutina de los lunes en Claude (`trig_01PM23qE8VEsn2gPNRsPzY5X`, enabled=true).
- Todo lo que estaba en la mesa de Alexis el 14-oct (`docs/ESTADO_COMPLETO_2026-10-14.html` §Pendiente).

## 7. Lista de control (imprimible)

**Dormir**
- [ ] `node scripts/hibernar.js … --pg` → `RESUMEN.md` dice VERIFICADO y ≈ 985 usuarios
- [ ] `postgres.dump` existe
- [ ] carpeta copiada a disco externo Y a nube; `render/` en el gestor de contraseñas
- [ ] libro real: movimientos anotados o dejados por escrito
- [ ] correo a usuarios + mensaje fijado en Telegram
- [ ] membresías de Whop revisadas; afiliado pagado; productos archivados
- [ ] deudas pagadas: Render, Resend, Hetzner
- [ ] GitHub Pages activo; DNS cambiado; https://gpsimulador.com muestra la pausa
- [ ] cancelado: Odds API, TheStatsAPI; API-Football sin renovar; Resend en Free
- [ ] Hetzner: dos servidores borrados
- [ ] Render: relay, base y web borrados; saldo 0
- [ ] rutina semanal de Claude apagada (hecho el 19-oct)

**Levantar**
- [ ] servicio web + disco + Postgres creados; env pegado con claves rotadas; `GP_HIBERNADO=1`
- [ ] `node scripts/levantar.js …` → manifiesto cuadra
- [ ] `pg_restore` (o migraciones)
- [ ] quitar `GP_HIBERNADO`, deploy, sondas ok
- [ ] DNS a Render; Pages sin dominio
- [ ] Whop migrado a v1 antes de vender; rutina de los lunes encendida
