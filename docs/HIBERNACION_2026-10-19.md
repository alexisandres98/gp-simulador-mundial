# Hibernación de GP Simulador — manual completo (19-oct-2026)

> Orden de Alexis, 19-oct: «Hagamos un shutdown temporal, ponerla a hibernar. No tiene sentido seguir pagando
> esos costes mensuales y seguir en negativo. Cancela todo lo que incurra en costes y guarda absolutamente
> todo, que en unos meses sea solo poner una tarjeta, pagar lo que haya que pagar y levantar todo sin
> problemas y dejarlo donde lo dejamos.»
>
> Este documento es el manual de las dos mitades: **dormir** (hoy) y **levantar** (cuando toque). Está escrito
> para que lo ejecute Alexis con el repo clonado y sin ayuda, y para que una sesión de Claude futura lo lea y
> sepa exactamente dónde quedó todo. Lo que la sesión de hoy pudo hacer sola está hecho (código, scripts,
> página de pausa, rutina semanal apagada) y pasó por una revisión adversarial el mismo día; lo que requiere
> sus cuentas y sus claves está aquí, en orden.

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
Todo cuelga de `dirname(DB_FILE)`. Lo exporta entero `GET /api/internal/hibernar?tar=1` (ruta nueva, 19-oct;
clave por cabecera `Authorization: Bearer <GP_EXPORT_KEY>` o `?key=`). El tar recorre TODO el disco, así que
nada de esta tabla puede quedarse fuera aunque la tabla esté incompleta:

| carpeta / fichero | qué es | lo escribe |
|---|---|---|
| `db.json` | usuarios, sesiones, grants pro/sharp, picks del Mundial y de clubes, combate, goles, hoops, **la sombra entera** (`db.shadow`), validación de tarjetas, ops, Telegram enviados | `server.js` |
| `real-ledger.json` | **el libro del dinero real** (apuestas, días, nocional, realizado, conciliación) | `real-executor/store.js` |
| `backups/` | copias diarias de `db.json` (14 días), `almacenes/<día>` (gzip de los libros), `etiquetas/<nombre>` | `server.js` |
| `clubs/` | **229 MB**: `props-history-*.json`, `results-*.json`, `player-history-*.json`, fotos, mapa AF, `fotmob-*.json`, censo de tarjetas | pases de datos de clubes |
| `esports/` | picks, cierres y props por juego (`picks-cs2.json`…), `props-cs2.json` | `esports-engine/store.js`, `props.js` |
| `propfirm/` | señales, `poly-sombra.json`, `poly-sombra-v2.json`, `poly-mm*.json`, cotizables | `propfirm/*.js` |
| `polymarket/` | ejecutor de Polymarket (apagado) | `polymarket/ejecutor.js` |
| `nfl/`, `nfl-agg/` | picks, cierres, sombra, cuotas, priors; datos point-in-time | `nfl-engine/` |
| `amfoot/` | college/CFL: picks, cierres, sombra, rosters | `amfoot-engine/store.js` |
| `tennis/`, `tennis-raw/` | tenis: picks, cierres, sombra y crudo (en producción sí escribe en `/data/tennis`; `data/tennis/disk` del repo es solo el fallback local) | `tennis-engine/store.js` |
| `darts/`, `tt/`, `tt-raw/` | dardos y tenis de mesa: picks, cierres, diagnósticos de liquidación, rankings, resultados, crudo ITTF/WTT | `darts-engine`, `tt-engine`, harvests |
| `hoops/` | baloncesto | `basketball-engine/store.js` |
| `f1/` | F1 | `f1-engine/store.js` |
| `lol-raw/` | **97.588 partidas + 535k filas de jugador** de Leaguepedia (CC BY-SA) | `scripts/lol-harvest.js` |
| `val-agg/`, `val-raw/` | agregados y crudo de Valorant | `esports-engine/valorant-data.js` |
| `implicito/` | sombras del proceso implícito (fútbol, hoops) | `implied-engine/sombra.js` |
| `fabric/` | tejido de datos (`GP_FABRIC_DIR=/data/fabric`; comprobar en `render/env-*.env` que está puesta, si no escribe en el repo y se pierde en cada deploy) | `data-fabric/` |
| `libro/`, `encogimiento/`, `derivadas/` | libro de cierres, doble corrida del encogimiento, derivadas de fútbol en sombra | `lib/libro.js`, `lib/encogimiento-sombra.js`, `futbol-derivadas.js` |
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
**Render no conserva copias de una base borrada**: el dump es la única.

### 1.3 Variables de entorno (Render → cada servicio → Environment)
El código lee **422 nombres distintos** (`docs/hibernacion/ENV_VARS_CODIGO.txt`, generado del código); la
mayoría tiene valor por defecto y no está puesta. **Las que están puestas en Render son la configuración real
y hay que exportarlas tal cual** (`scripts/hibernar.js` con `RENDER_API_KEY` lo hace a `render/env-<servicio>.env`,
paginando, más grupos de entorno y secret files; a mano: copiar una a una desde el dashboard). Las
imprescindibles para arrancar y sus dueños:

| grupo | variables | de dónde sale el valor al levantar |
|---|---|---|
| disco y base | `DB_FILE=/data/db.json`, `DATABASE_URL`, `DB_SSL`, `GP_FABRIC_DIR=/data/fabric` | el servicio nuevo / la base nueva |
| administración | `ADMIN_EMAILS`, `GP_EXPORT_KEY` (**rotar**), `GOOGLE_CLIENT_ID` | Alexis; consola de Google |
| correo | `RESEND_API_KEY` (**rotar**), `MAIL_FROM`, `MAIL_REPLY_TO`, `MAIL_WEBHOOK_URL`, `MAIL_WEBHOOK_TOKEN`, `BROADCAST_FROM` | Resend; Apps Script |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHANNEL=@gpsimulador` | BotFather |
| datos | `API_FOOTBALL_KEY` (**rotar**), `THESTATSAPI_KEY`, `SPORTSBOOK_PROVIDER_API_KEY` (**rotar**), `PINNACLE_GUEST_KEY`, `CFBD_API_KEY`, `PANDASCORE_TOKEN`, `WTT_*`, `FLASHSCORE_FSIGN`, `LOLESPORTS_KEY` | cada proveedor, según lo que se contrate |
| Cloudbet y dinero real | `CLOUDBET_API_KEY`, `CLOUDBET_RELAY_URL`, `GP_RELAY_KEY`, `GP_REAL_*` (todos los canales **apagados** al levantar), `GP_REAL_RELAY_TOKEN` (**rotar**) | Cloudbet; el brazo nuevo |
| LLM | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `GP_LLM_*` | cada proveedor |
| Whop | `WHOP_API_KEY`, `WHOP_WEBHOOK_KEY`, `WHOP_PLAN_*`, `WHOP_FOUNDER_PLAN_IDS` | Whop (**la API v2 muere el 13-nov**: al levantar hay que migrar, §6.7) |
| interruptores de producto | `GP_*_PUBLIC_ENABLED`, `GP_FEED_SIN_VEREDICTO`, `GP_DERIV_NUEVAS`, `GP_POLYMM`, `GP_PROPFIRM_SCAN`, `SPORTSBOOK_DAILY_CREDITS`, `GP_SBGOAL_PURGE`, `NODE_OPTIONS` | tal como estaban en `render/env-gp-simulador-mundial.env` |
| hibernación | `GP_HIBERNADO` | **solo** durante la exportación quieta (§2.3) y la restauración (§6) |

### 1.4 Cuentas externas y su estado al dormir

| cuenta | qué hacer al dormir | se conserva |
|---|---|---|
| **Render** (web `srv-d8krl8flk1mc73c9hbi0`, Postgres `dpg-d8s3lef7f7vs73bkoqtg-a`, relay `srv-da63qc0jo6nc73e9fgt0`) | pagar el saldo pendiente (8 avisos desde el 4-oct), exportar, borrar los tres; **comprobar que el workspace queda en plan Hobby** (un plan Professional cobra cuota aunque no haya servicios) | la cuenta (gratis) |
| **Hetzner** `gp-cb-relay-hel2` (2.29.18.155, brazo de Cloudbet) y `gp-pm-hel1` (brazo PM, apagado) | pagar la factura 089001282007 (11,83); **antes de borrar `gp-pm-hel1`, mirar `/opt/gp-pm/secreto`** (§4.3); borrar servidores **y también Primary IPs, snapshots, backups y volúmenes**, que Hetzner cobra aparte | la cuenta; el código del brazo está en `relay/cb-relay.js` |
| **The Odds API** (5M créditos, 119/mes, renueva el 21-oct) | **cancelar antes del 21** | la cuenta (plan gratis, 500 créditos) |
| **API-Football** (Ultra, vence el 23-oct) | no renovar: cae sola al gratis | la cuenta y la clave (rotar al levantar) |
| **TheStatsAPI** (50-129/mes) | cancelar la suscripción | la cuenta |
| **Resend** (Pro 20/mes, 5 cobros fallidos) | pagar lo pendiente, **mandar el correo de pausa en Pro**, y DESPUÉS bajar a Free (3.000/mes, **100/día**): NO borrar la cuenta, conserva la verificación del dominio `gpsimulador.com` (DKIM/SPF) | dominio verificado, clave |
| **Anthropic / Gemini / Groq** | nada que cancelar (prepago / gratis); comprobar que Anthropic no tiene auto-recarga y que el proyecto de Gemini no tiene facturación enlazada | claves |
| **Whop** | cancelar cada membresía activa a fin de periodo (archivar un producto NO cancela membresías), pagar al afiliado, archivar los productos; retirar saldo (hecho el 18-oct, 13,81) | la cuenta, los planes |
| **Cloudbet** | retirar lo que quede (0,00-0,01), guardar el historial si se quiere (web → Mis apuestas) | la cuenta |
| **Namecheap** (gpsimulador.com) | **conservar con auto-renovación**; cambiar SOLO los registros A y CNAME www a GitHub Pages (§4.2); **no tocar MX ni TXT** (correo y verificación de Resend) | el dominio |
| **Google Apps Script** (relay de correo), **Google OAuth** (login con Google), **Telegram** (bot + canal), **Gmail** (copias diarias) | nada; gratis. Ojo: Google borra clientes OAuth sin uso durante 6 meses (§6.7) | todo |
| **GitHub** (repo público) | activar Pages para la página de pausa (§4.2) | el repo |
| **Claude** (esta sesión y la rutina de los lunes) | rutina ya apagada | la sesión; el manual |

## 2. DÍA 1 — Exportar (antes de pagar, antes de cancelar nada)

Render puede suspender cualquier día por el impago; **el volcado no depende del pago** y el servicio responde
hoy. Primero sacar, después pagar, después borrar.

### 2.1 Lo que hace falta
- Un ordenador con **Node ≥ 18** y espacio para unos pocos GB; `git clone https://github.com/alexisandres98/gp-simulador-mundial` y entrar en la carpeta.
- `GP_EXPORT_KEY`: Render → gp-simulador-mundial → Environment.
- `RENDER_API_KEY` (Render → Account Settings → API Keys; crear una nueva): con ella el script captura servicios, variables (paginadas), grupos de entorno, secret files, discos y la cadena externa de Postgres. Sin ella, todo eso hay que copiarlo a mano del dashboard antes de borrar nada.
- El token de admin de la web, para la segunda copia de `db.json`: en gpsimulador.com con tu sesión, F12 → Console → `localStorage.getItem('wc_token')`.
- Para Postgres: `pg_dump` **de la misma versión mayor que la base** (Render → base → Info la muestra; paquete `postgresql-client-<N>`, en Mac `brew install libpq`). Si la base tiene lista de IPs permitidas (Info → Networking), añadir la tuya.

### 2.2 Primera pasada: con el servicio vivo
Las claves por variables de entorno, no por argumentos (no quedan en el historial del shell):
```bash
GP_EXPORT_KEY=… RENDER_API_KEY=… GP_ADMIN_TOKEN=… node scripts/hibernar.js --pg
```
Deja `gp-hibernacion-<fecha>/` (está en `.gitignore`: **nunca** se sube al repo; TODA la carpeta es secreta,
`db.json` lleva sesiones y correos) con: `health.json`, `manifiesto.json`, `disco.tar.gz` (el disco entero),
`manifiesto-sha-antes.json` y `-despues.json` (sha256 de todo el disco antes y después de bajarlo), `disco/`
(el tar desempaquetado y comprobado fichero a fichero), `db-admin.json`, `sondas/` (la foto final de sombra,
real, vara, Polymarket, market making, puertas…), `render/` (**secretos**), `postgres.dump`, `RESUMEN.md`.
Cada paso es de solo lectura y, si falla, se anota y se sigue: se puede repetir las veces que haga falta.

Con el servicio vivo, `db.json` y algún almacén cambian entre el manifiesto y la descarga: el script lo dice
como «cambiaron mientras se bajaba» y da por bueno un fichero si casa con la versión de antes o con la de
después. Lo que no casa con ninguna o falta, sale con ✗ y el veredicto no dice VERIFICADO.

### 2.3 Segunda pasada: con el servicio quieto (recomendada)
Render → gp-simulador-mundial → Environment → `GP_HIBERNADO=1` → deploy. El servicio arranca sin trabajos,
la web muestra la página de pausa (los usuarios ya no ven la plataforma: hacerlo DESPUÉS de mandar el correo
de pausa, §3.2, o asumirlo) y siguen respondiendo salud, hibernar, las sondas con clave, la copia de admin y
el broadcast. Entonces:
```bash
GP_EXPORT_KEY=… node scripts/hibernar.js --solo-disco --out gp-hibernacion-<fecha>-quieto
```
Esta vez el manifiesto y el tar cuadran al byte. Es la carpeta que se restaura al levantar; la primera pasada
conserva las sondas y la copia de admin.

Para bajar por partes si la conexión no aguanta el tar entero: `GET /api/internal/hibernar?tar=1&solo=<carpeta>`
(una carpeta de primer nivel por llamada; el tar conserva el prefijo, así que se restaura en su sitio) y
`&sin=backups` para excluir las copias internas.

### 2.4 Verificar (no saltarse)
`RESUMEN.md` tiene que decir **«disco: VERIFICADO»** y el número de usuarios de `db.json` (≈ 985). Comprobar a
ojo que están `disco/db.json`, `disco/real-ledger.json`, `disco/clubs/` (cientos de MB), `disco/propfirm/`,
`disco/esports/`, `disco/lol-raw/`, `render/env-gp-simulador-mundial.env` (con decenas de variables, no vacío) y
`postgres.dump`. Si el dump no salió, el comando exacto está en `RESUMEN.md`; y como copia extra gratis,
Render → base → Recovery → descargar la última exportación lógica (se borra con la base).

### 2.5 Guardar en DOS sitios
Copiar la carpeta entera a (a) un disco externo y (b) una nube (Google Drive / iCloud). `render/` lleva todas
las claves: además, pegar su contenido en el gestor de contraseñas. Hasta que las dos copias existan **no se
cancela nada**.

## 3. DÍA 1-2 — Pagar lo que bloquea, cerrar lo que está abierto y avisar

### 3.1 Pagar Render, Resend y Hetzner (antes de avisar)
Resend está en el camino crítico: sin él no sale ni el correo de pausa ni el código de login del admin (solo
queda el relay de Apps Script, ~100 correos/día). Render, para que la cuenta no quede terminada (sin cuenta en
regla no se pueden recrear los servicios al levantar). Hetzner, porque con factura impagada bloquea la cuenta
y no deja borrar limpio.

### 3.2 El libro real
Antes de congelarlo, que cuadre con la casa: anotar los dos movimientos pendientes (54,81 del 30-sep y 19,19
del 2-4 oct) y el cashback de 40,29 del 16-oct como movimientos (`/api/internal/real?key=&run=movimiento…`),
y resolver la fila «BESTIA vs Damajuana» (una CS2 vieja que la casa liquidó a −5 sin resultado nuestro).
Después, un último `picks-export?real=1` a `sondas/`. Si se prefiere no tocar nada, queda escrito aquí: el
libro exportado tiene una conciliación de −74,00 y un descuadre de −5 pendientes.

### 3.3 Usuarios (985) y canal
El correo existe como variante del broadcast (`pausa`: cada usuario en su idioma; `pausa_es` / `pausa_en`
fijos). Texto en `docs/hibernacion/AVISOS.md` §1. Con Resend en Pro (en Free solo caben 100 al día):
```bash
# cuántos lo recibirían (no manda nada)
curl -X POST "https://gpsimulador.com/api/admin/broadcast?key=$GP_EXPORT_KEY" -H 'Content-Type: application/json' -d '{"variant":"pausa","count":true}'
# prueba a tu propio correo
curl -X POST "https://gpsimulador.com/api/admin/broadcast?key=$GP_EXPORT_KEY" -H 'Content-Type: application/json' -d '{"variant":"pausa","test":true}'
# el envío (responde al instante y manda en segundo plano; GET al mismo endpoint enseña el progreso)
curl -X POST "https://gpsimulador.com/api/admin/broadcast?key=$GP_EXPORT_KEY" -H 'Content-Type: application/json' -d '{"variant":"pausa"}'
```
Y un último mensaje fijado en @gpsimulador (AVISOS §2). La página de pausa (§4.2) dice lo mismo.

### 3.4 Suscriptores de Whop
Lo firmado en `public/legal.html`: cancelación al final del ciclo pagado; garantía de reembolso completo solo
en las primeras 24 h de la primera suscripción; las renovaciones no son reembolsables salvo caso por caso; el
precio founder se mantiene «mientras la suscripción siga activa e ininterrumpida». En 60 días no hubo ventas,
pero puede haber membresías recurrentes vivas: Whop → Memberships → activas. Para cada una: **cancelar a fin
de periodo desde Memberships** (archivar el producto no cancela nada) y escribir al cliente (AVISOS §3, que
es más generoso que lo firmado a propósito: precio conservado al volver y devolución del último cobro si lo
pide). Pagar los 1,90 pendientes del afiliado (`/api/internal/affiliates`). Luego archivar los productos.

## 4. DÍA 2 — Dormir, proveedor por proveedor (en este orden)

### 4.1 Página de pausa en el dominio (gratis)
Está en el repo: `hibernacion/index.html` + `hibernacion/CNAME` (informativo: con origen «GitHub Actions» el
dominio se declara en Settings), publicada por `.github/workflows/pagina-de-pausa.yml`. La primera corrida
automática del 19-oct falló porque Pages no estaba activado: es lo esperado. Una sola vez, a mano:
1. GitHub → repo → Settings → Pages → Source: **GitHub Actions**. Actions → «pagina-de-pausa» → Run workflow.
2. Settings → Pages → Custom domain: `gpsimulador.com` → Save. GitHub pide un TXT de verificación
   (`_github-pages-challenge-alexisandres98`): ponerlo en Namecheap ANTES de cambiar los A, para que nadie
   pueda reclamar el dominio.
3. Namecheap → gpsimulador.com → Advanced DNS: cambiar **solo** el `A @ → 216.24.57.1` por **cuatro A @ →
   185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153** y el `CNAME www → …onrender.com` por
   **CNAME www → alexisandres98.github.io**. **No tocar MX, TXT (SPF, DKIM `resend._domainkey`, DMARC, `send.`)
   ni el reenvío de soporte@**: son el correo.
4. Cuando GitHub emita el certificado (minutos a horas): «Enforce HTTPS».
Hasta que el DNS propague, Render sigue sirviendo; si ya está en `GP_HIBERNADO=1`, sirve la misma página.

### 4.2 Cancelar y borrar
1. **The Odds API**: cancelar la suscripción (antes del 21-oct).
2. **TheStatsAPI**: cancelar.
3. **API-Football**: no renovar (vence el 23).
4. **Resend**: ya pagado y con el correo de pausa enviado → bajar a Free (Settings → Billing). No borrar el dominio.
5. **Anthropic**: Billing → auto-reload OFF. **Google Cloud**: el proyecto de Gemini sin cuenta de facturación.
6. **Hetzner**: (a) por consola en `gp-pm-hel1`: `cat /opt/gp-pm/secreto`; si hay `PM_PRIVATE_KEY`, comprobar el saldo de esa wallet en Polymarket/Polygonscan y guardar la clave en el gestor de contraseñas; (b) borrar `gp-cb-relay-hel2` y `gp-pm-hel1`; (c) Cloud → proyecto → **Primary IPs, Floating IPs, Snapshots, Backups, Volumes**: borrar lo que quede (las IP se cobran sueltas); (d) comprobar en la siguiente factura que es 0.
7. **Render**, **solo con las dos copias verificadas**: borrar `gp-relay-eu`; borrar la base `gp-simulador-db` (el `pg_dump` es la única copia); borrar `gp-simulador-mundial` (el disco y sus snapshots se van con el servicio). Workspace → Settings → Billing: plan Hobby, saldo 0.
8. **Whop**: membresías canceladas, productos archivados (3.4). **Cloudbet**: saldo retirado. **Namecheap**: auto-renew encendido.
9. Comprobar que `https://gpsimulador.com` muestra la página de pausa y que nada más cobra: Render 0, Hetzner 0 (IPs incluidas), Odds API 0, TSA 0, Resend 0, API-Football 0, Anthropic sin recarga.

## 5. Mientras duerme
Nada corre. Lo único vivo: la página de pausa (GitHub), el canal de Telegram (mensaje fijado), el correo
soporte@gpsimulador.com (Gmail) y el dominio. La sesión de Claude conserva este manual; la rutina semanal
está apagada y no cuesta nada. Si en algún momento quieres hacer análisis sobre los datos dormidos, todo está
en `disco/` y `postgres.dump` en formato abierto (JSON y pg_dump): no hace falta levantar nada para leerlos.

## 6. LEVANTAR — cuando haya capital y estrategia

Orden pensado para no pisar lo restaurado y para no arrancar cosechas contra claves muertas.

### 6.1 Render: servicios nuevos
1. Web Service desde el repo (`main`): Node, Build `(vacío)`, Start `node server.js`, Health Check `/api/health`, región Oregon, plan según la estrategia (Standard 2 GB basta sin esports/NFL/LLM; Pro 4 GB era el de producción). **Disco** montado en `/data`, **vacío y de al menos 2× los MB del manifiesto** (la restauración convive un rato con la copia apartada).
2. Postgres (basic-1gb bastaba; el disco de 60 GB solo por la tabla de cuotas: empezar con menos).
3. Environment: pegar `render/env-gp-simulador-mundial.env` **rotando** `GP_EXPORT_KEY`, `RESEND_API_KEY`, `API_FOOTBALL_KEY`, `SPORTSBOOK_PROVIDER_API_KEY`, `GP_REAL_RELAY_TOKEN` y la de Render; `DATABASE_URL` la nueva; todos los `GP_REAL_*_ENABLED=false`; **`GP_HIBERNADO=1`**. Quitar las claves de servicios que no se vuelvan a contratar (el código funciona sin ellas). Si `render/env-groups.json` o `secret_files` traían algo, recrearlo.
4. Deploy. `GET /api/health` responde y la web muestra la página de pausa: el servicio está quieto.

### 6.2 El disco
```bash
GP_EXPORT_KEY=… node scripts/levantar.js --carpeta gp-hibernacion-<fecha>-quieto --url https://<servicio>.onrender.com
```
Sube `disco.tar.gz` (el **original**, nunca uno rehecho con otra herramienta) a `POST /api/internal/hibernar?restaurar=1`
en una sola petición larga (el servicio en pausa no la corta; con 1 MB/s de subida, 1 GB son ~17 min). El
servidor lo desempaqueta en `/data/.hibernacion-restaurar-<ts>`, cambia de golpe (lo que hubiera queda en
`.hibernacion-previo-<ts>`, no se borra; si un paso falla, deshace y el disco queda como estaba), **congela el
`db.json` en memoria** para que nada lo pise, y el script compara carpeta a carpeta con `manifiesto.json`.
Si la subida entera no es viable, carpeta a carpeta con los tars de `&solo=`:
```bash
curl -X POST --data-binary @disco-clubs.tar.gz -H "Authorization: Bearer $GP_EXPORT_KEY" "https://<servicio>.onrender.com/api/internal/hibernar?restaurar=1"
```
(cada tar `&solo=` conserva el prefijo de su carpeta y solo sustituye esa carpeta).

### 6.3 Postgres
`pg_restore --no-owner --no-privileges -d "<DATABASE_URL externa nueva>" postgres.dump`. Si se prefiere
empezar sin el histórico de cuotas: `npm run db:migrate` crea el esquema vacío (las picks de tarjetas tardan
unas horas en tener cuotas otra vez).

### 6.4 Encender
Quitar `GP_HIBERNADO` del Environment y desplegar: el proceso nuevo lee el `db.json` restaurado. Comprobar
`/api/internal/ops?key=` (usuarios, trabajos, memoria), `/api/internal/shadow?key=` (el banco y las apuestas
donde se dejaron), `/api/internal/real?key=` (el libro), `/api/internal/hibernar?key=` (`por_carpeta` igual
al manifiesto). Cuando todo cuadre, borrar `/data/.hibernacion-previo-*`.

### 6.5 Dominio
Namecheap: A @ → IP del servicio nuevo (Render la muestra en Settings → Custom Domains), CNAME www →
`<servicio>.onrender.com`; añadir el dominio en Render. Quitar el Custom domain de GitHub Pages (o dejar el
workflow sin dominio: no estorba). MX y TXT no se tocaron, así que el correo sigue.

### 6.6 Proveedores, según la estrategia nueva
Lo mínimo para fútbol de clubes y tarjetas: API-Football Pro (19), Resend Free o Pro, Cloudbet (gratis) y, si
se va a colocar dinero, **un brazo en Hetzner** (`relay/cb-relay.js`, cloud-init en HANDOFF 1-sep: nodejs +
certificado autofirmado + systemd; variables `GP_RELAY_KEY`, `CLOUDBET_API_KEY`, `PORT=8443`; en Render
`CLOUDBET_RELAY_URL=https://<ip>:8443` y `GP_RELAY_KEY`). The Odds API, TheStatsAPI, LLM de pago y los demás
deportes solo si la estrategia los pide (costes en `docs/COSTES_Y_MODO_MINIMO_2026-10-10.md`).

### 6.7 Deuda que espera al despertar (no se hizo al dormir, a propósito)
- **Whop API v2 muere el 13-nov-2026**: migrar los cinco sitios de `server.js` (memberships ×2, cancel, checkout_sessions, webhook) a `/api/v1` y al webhook firmado antes de volver a vender. Alternativa: grants a mano en `/api/admin/grants`.
- **Google OAuth**: Google borra clientes sin actividad durante 6 meses (avisa antes; 30 días para restaurar). Si pasó, restaurarlo o crear uno nuevo con los mismos orígenes y actualizar `GOOGLE_CLIENT_ID`.
- Rotación de las seis claves (arriba) y `GP_EXPORT_KEY` nueva en el bloc de la sesión de Claude.
- El detector de límite de API-Football no reconoce el cupo diario ni la temporada fuera de plan (`afLimitado`, `server.js`); con el plan gratis el mapa de partidos se vacía en cuatro días.
- El correo semanal de la sombra lee el cierre de un campo que la sombra no escribe (`close_odds` vs `closing`) y su veredicto es del libro agregado.
- Conciliación del libro real (−74,00 y la fila BESTIA–Damajuana) si no se cerró en §3.2.
- Volver a encender la rutina de los lunes en Claude (`trig_01PM23qE8VEsn2gPNRsPzY5X`, enabled=true).
- Todo lo que estaba en la mesa de Alexis el 14-oct (`docs/ESTADO_COMPLETO_2026-10-14.html` §Pendiente).

## 7. Lista de control (imprimible)

**Dormir**
- [ ] pasada 1: `node scripts/hibernar.js --pg` → `RESUMEN.md` con disco VERIFICADO, ≈ 985 usuarios, `render/env-*.env` no vacío, `postgres.dump`
- [ ] pagar Render, Resend, Hetzner
- [ ] libro real: movimientos anotados o dejados por escrito
- [ ] correo de pausa (`variant: pausa`, antes `count`) + mensaje fijado en Telegram
- [ ] `GP_HIBERNADO=1` + deploy → pasada 2 `--solo-disco` → disco VERIFICADO al byte
- [ ] carpeta(s) copiadas a disco externo Y a nube; `render/` en el gestor de contraseñas
- [ ] membresías de Whop canceladas a fin de periodo; afiliado pagado; productos archivados
- [ ] GitHub Pages activo; dominio verificado en Settings; DNS: solo A y CNAME www; https://gpsimulador.com muestra la pausa
- [ ] cancelado: Odds API, TheStatsAPI; API-Football sin renovar; Resend en Free; Anthropic sin auto-recarga
- [ ] Hetzner: secreto de `gp-pm-hel1` revisado; servidores, IPs, snapshots y volúmenes borrados
- [ ] Render: relay, base y web borrados; workspace Hobby; saldo 0
- [ ] rutina semanal de Claude apagada (hecho el 19-oct)

**Levantar**
- [ ] servicio web + disco vacío (≥ 2×) + Postgres creados; env pegado con claves rotadas; `GP_HIBERNADO=1`
- [ ] `node scripts/levantar.js …` → todas las carpetas cuadran
- [ ] `pg_restore` (o migraciones)
- [ ] quitar `GP_HIBERNADO`, deploy, sondas ok; borrar `.hibernacion-previo-*`
- [ ] DNS a Render; Pages sin dominio
- [ ] Whop migrado a v1 antes de vender; OAuth comprobado; rutina de los lunes encendida
