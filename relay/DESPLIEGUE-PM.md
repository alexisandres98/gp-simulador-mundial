# Desplegar el brazo de Polymarket en Helsinki

## LO QUE HAY QUE MANDAR PARA DAR DE ALTA UNA CUENTA

Seis datos. Con eso el ejecutor arranca; todo lo demás lo averigua el sistema.

| dato | dónde sale | ejemplo |
|---|---|---|
| **clave privada del firmante** | de la wallet que controla la cuenta | `0x…` (64 hex) |
| **dirección de la cuenta** | Polymarket → el menú de perfil, arriba | `0x922eeC312…` |
| **cuánto se fondea** | decisión tuya | `200` |
| **cuánto por apuesta** | decisión tuya | `5` |
| **qué familias** | decisión tuya | `futbol:no` |
| **un `token_id` de cualquier mercado abierto** | para averiguar el tipo de firma | un entero largo |

Lo que **NO** hay que mandar, porque se averigua solo: el tipo de firma de la cuenta, el `tick_size` de cada
mercado, si un mercado es de riesgo negativo, las credenciales de trading del CLOB y la dirección del
firmante (sale de la clave).

⚠️ **La clave privada no va por chat.** Se pone directamente como variable de entorno en el relay. Si me la
mandas por aquí, queda en la conversación y en los logs y hay que rotarla — igual que pasó con la del
relayer y con `GP_REAL_RELAY_TOKEN` el 7-sep, que sigue pendiente.

## Las variables, de un vistazo

En el **relay de Helsinki** (ahí vive el secreto):
```
PM_PRIVATE_KEY     la clave privada del firmante
PM_MAKER_ADDRESS   la dirección de la cuenta (la que tiene los fondos)
PM_SIG_TYPE        lo dice el paso 4 del alta
PM_MAX_USD         25      ← tope duro por orden, la última red
```

En **Render** (ahí vive la política):
```
GP_PM_BANCO            200
GP_PM_STAKE            5
GP_PM_MAX_EXPOSICION   100     (si no se pone: la mitad del banco)
GP_PM_PARADA_DIARIA_PCT 15
GP_PM_FAMILIAS         futbol:no
GP_PM_ENABLED          1       ← SIN esto el ejecutor ensaya y no coloca
```

## El alta, en una sola llamada

```bash
curl "https://gpsimulador.com/api/internal/pm-relay?key=$GP_EXPORT_KEY&alta=1&token=<token_id>"
```

Devuelve cinco escalones y se para en el primero que falle:

1. ¿el brazo responde y **la región deja colocar**?
2. ¿la clave da la dirección del firmante que muestra Polymarket?
3. ¿la casa nos entrega credenciales de trading?
4. **¿cuál es el tipo de firma?** — se averigua mandando una orden de compra a 0,01 sobre un token real:
   si la firma vale, la casa la acepta y la deja descansando en el libro (donde nunca se cruza, porque
   nadie vende a ese precio), y se cancela al instante. **Coste cero.** Si no vale, se prueba el siguiente.
5. ¿la política del ejecutor está puesta?

Con los cinco en verde y `GP_PM_ENABLED=1`, el ejecutor coloca en el barrido siguiente (cada 10 minutos).

---


El servidor es el mismo que ya coloca en Cloudbet: **`gp-cb-relay-hel2`, Hetzner Helsinki, `2.29.18.155:8443`**.
No hace falta una máquina nueva. Lo que cambia es que el proceso pasa a tener dos brazos y una variable más:
la clave privada de la wallet de Polymarket.

## Por qué la clave va ahí y no en Render

La misma razón que con la llave de Cloudbet, y va escrita en `real-executor/relay.js` desde agosto: el
servidor principal es público, sirve la plataforma entera a casi mil usuarios y tiene muchísima más
superficie de ataque. El relay no sirve a nadie más que al ejecutor. Además **Render no puede colocar en
Polymarket ni aunque quisiera** — está en Oregón y la casa bloquea el trading desde Estados Unidos.

## Pasos

```bash
ssh root@2.29.18.155

# 1. traer el código nuevo
cd /opt/gp-relay            # (o donde esté el clon; `systemctl cat gp-relay` lo dice)
git pull origin main

# 2. las variables nuevas del servicio
systemctl edit gp-relay     # o editar /etc/systemd/system/gp-relay.service.d/override.conf
```

Añadir:

```ini
[Service]
Environment=PM_PRIVATE_KEY=0x…          # la clave privada del FIRMANTE de Polymarket
Environment=PM_MAKER_ADDRESS=0x…        # la wallet que tiene los fondos (la cuenta, no el firmante)
Environment=PM_SIG_TYPE=proxy           # proxy | safe | eoa | deposito — ver abajo
Environment=PM_MAX_USD=25               # tope duro POR ORDEN, la última red
```

```bash
# 3. reiniciar y comprobar
systemctl daemon-reload && systemctl restart gp-relay
journalctl -u gp-relay -n 30 --no-pager
```

## Cuál es el `PM_SIG_TYPE`

Lo decide cómo se creó la cuenta, y equivocarse hace que la casa rechace **todas** las órdenes sin explicar
por qué. La regla de la documentación:

| wallet | `PM_SIG_TYPE` | maker | signer |
|---|---|---|---|
| Deposit Wallet | `deposito` | la misma dirección | la misma dirección |
| Proxy Wallet (cuenta por email/magic) | `proxy` | la cuenta | el firmante |
| Safe Wallet (cuenta por wallet de navegador) | `safe` | la cuenta | el firmante |
| EOA | `eoa` | la misma dirección | la misma dirección |

**Si la dirección de la cuenta y la del firmante son distintas, es `proxy` o `safe`.** Cuál de las dos se
averigua con un ensayo: se firma con una y, si la casa contesta que la firma no valida, se prueba la otra.
Por eso existe `/pm/ensayo`, que firma sin enviar, y por eso el primer envío real es de $1.

⚠️ **La Deposit Wallet necesita además envolver la firma para ERC-7739**, y eso NO está implementado todavía
(está escrito en `polymarket/orden.js` de dónde sale). Si la cuenta resulta ser Deposit Wallet, hay que
añadirlo antes de colocar nada.

## Verificación, en este orden

Desde el servidor principal, que es quien alcanza el relay:

```bash
# 1. ¿la región de Helsinki deja colocar? ¿la clave da la dirección esperada?
curl "https://gpsimulador.com/api/internal/pm-relay?key=$GP_EXPORT_KEY&diag=1"
```

Lo que hay que leer de la respuesta:
- `bloqueado_por_region: false` → Finlandia sirve. Si sale `true`, este brazo tampoco vale y hay que
  buscar otra región (el mapa de Cloudbet decía que Brasil, Argentina, México, Chile, Colombia y Canadá
  también pasaban, pero **eso era el mapa de Cloudbet, no el de Polymarket** — habría que volver a medirlo).
- `firmante` → tiene que ser la "Dirección del firmante" que muestra Polymarket en Ajustes.
- `maker_igual_firmante: false` → confirma que es Proxy o Safe, no Deposit ni EOA.
- `credenciales.ok: true` → la casa nos reconoce.

```bash
# 2. firmar una orden real SIN enviarla
curl "https://gpsimulador.com/api/internal/pm-relay?key=$GP_EXPORT_KEY&ensayo=1\
&token=<token_id>&side=BUY&price=0.52&size=2"
```

Devuelve el cuerpo exacto que se enviaría. Se comprueba a ojo: `makerAmount` = precio × tamaño en enteros de
seis decimales, `takerAmount` = acciones, `signatureType` el que toca.

```bash
# 3. la primera orden DE VERDAD, de ~$1, y solo por orden tuya
curl -X POST "https://gpsimulador.com/api/internal/pm-relay?key=$GP_EXPORT_KEY&colocar=1\
&token=<token_id>&side=BUY&price=0.52&size=2"
```

## Lo que este brazo NO hace

- **No decide.** No mira el modelo, no elige mercado, no calcula el tamaño. Recibe la intención y la firma.
- **No guarda nada.** Ni la orden, ni la respuesta, ni la clave en disco.
- **No obedece cualquier cifra.** `PM_MAX_USD` rechaza una orden que cueste más, aquí abajo, después de
  todos los frenos del servidor principal. Un brazo que obedece ciegamente amplifica los errores del cerebro.
- **No toca el camino de Cloudbet.** Ese lleva dinero real y no se modificó ni una línea para añadir esto.
