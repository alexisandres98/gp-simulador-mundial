# El brazo de Polymarket

**Estado: PROBADO DE PUNTA A PUNTA contra la casa, con una cuenta real. Falta la clave y el dinero.**

| | |
|---|---|
| máquina | `gp-pm-hel1` · Hetzner **Helsinki (FI)** · CX23 · **6,49 €/mes** |
| proyecto | «GP simulador polymarket» (separado del de Cloudbet, a propósito) |
| dirección | la que diga `GP_PM_RELAY_URL` en Render |

## Lo que la casa aceptó (13-sep, cuenta de pruebas)

Con la cuenta de pruebas de Alexis dentro, el alta dio **los cinco escalones en verde** y una orden real de
4,94 $ llegó hasta el último filtro:

```
POST /order → 400 "not enough balance / allowance:
              the balance is not enough -> balance: 8100, order amount: 5140070"
```

Ese mensaje es el final del camino. La casa validó la región, la firma envuelta de Deposit Wallet, el tipo,
la identidad, el `owner` y el contrato de riesgo negativo, y lo único que objeta es que la cuenta tiene
**0,0081 $** y la orden compromete **5,14 $** (los 4,94 de la orden más su comisión). Las dos cifras son
enteros de seis decimales y cuadran al céntimo.

**Ojo con esa comisión al calcular la exposición**: un stake de 5 $ compromete ~5,14 $ en la casa. Con banco
de 200 y tope de 100 sobra margen, pero el tope se queda corto en un ~3 % si algún día se apura.

Y el ejecutor, en una pasada en seco sobre las **437 señales reales** de ese momento: 3 revisadas, 2 fuera
de familia, 1 elegida — comprar 26 acciones a 0,19 = 4,94 $, que es exactamente el stake configurado.

## Lo único que falta: la clave privada

No está puesta a propósito, y hay una razón concreta para cada sitio donde NO está:

- **No por el chat.** Queda en la conversación, en los registros y en el almacén de imágenes. Ya hubo que
  quemar dos claves así (la de pruebas y la del relayer, y sigue pendiente rotar `GP_REAL_RELAY_TOKEN`).
- **No en el `cloud-init`.** Hetzner guarda lo que recibe cloud-init y lo lee cualquiera con el token del
  proyecto. Poner ahí la clave sería guardarla en el sitio que precisamente queremos que no la tenga.

Quedan dos caminos, los dos buenos. El primero es una llamada; el segundo no confía en nada.

### Camino A — una llamada desde tu ordenador

**1. Consigue el certificado de la máquina y comprueba que es el suyo.**

```bash
IP=<la IP del brazo>
openssl s_client -connect $IP:443 </dev/null 2>/dev/null | openssl x509 > /tmp/gp-pm.pem
openssl x509 -in /tmp/gp-pm.pem -noout -fingerprint -sha256
```

Esa huella tiene que ser **la misma** que devuelve `huella_cert` en:

```bash
curl "https://gpsimulador.com/api/internal/pm-relay?key=$GP_EXPORT_KEY&diag=1"
```

Son dos caminos independientes hasta la misma máquina — tu ordenador por un lado, el servidor de Oregón por
otro. Que las dos huellas coincidan quiere decir que nadie está en medio, porque tendría que estar en los
dos sitios a la vez. **Si no coinciden, para y avisa.**

**2. Manda la clave, verificando contra ESE certificado.**

```bash
curl --cacert /tmp/gp-pm.pem -X POST \
  "https://$IP/pm/alta?alta=<token de alta>" \
  -H 'content-type: application/json' \
  -d '{"clave":"0x...","maker":"0x..."}'
```

(El certificado lleva la IP como `subjectAltName`, así que `--cacert` verifica de verdad. Nada de `-k`: el
único momento en que la clave viaja no puede ser también el único sin autenticar al otro extremo.)

Responde con la **dirección que se deduce de la clave**. Compárala con la «Dirección del firmante» que
muestra Polymarket en Ajustes. Si no coincide, la clave es de otra cuenta — y eso se ve aquí, no tres
órdenes después.

La puerta vale **una sola vez**: en cuanto hay clave configurada contesta 409 y no vuelve a abrirse. Un
token de alta filtrado después del alta no sirve para nada. Y no es la llave del brazo: tenerlo no da
permiso para colocar órdenes.

### Camino B — desde la consola de Hetzner, sin confiar en la red

console.hetzner.com → `gp-pm-hel1` → **Reset root password** (así la que se generó al crearla queda
anulada) → **Console** → entrar → y:

```bash
/opt/gp-pm/poner-clave.sh
```

Pide la clave sin mostrarla, comprueba la forma antes de escribir nada, no la deja en el historial del
shell, reinicia el servicio y enseña el estado.

## Y después: el alta de cinco escalones

```bash
curl "https://gpsimulador.com/api/internal/pm-relay?key=$GP_EXPORT_KEY&alta=1&token=<token_id>"
```

Se para en el primero que falle:

1. ¿el brazo responde y la región deja colocar? — **ya en verde**
2. ¿la clave da la dirección del firmante que muestra Polymarket?
3. ¿la casa nos entrega credenciales de trading?
4. **¿cuál es el tipo de firma?** — se averigua mandando una compra a 0,01 sobre un token real: si la firma
   vale, la casa la acepta y la deja descansando en el libro (donde nunca se cruza, porque nadie vende a ese
   precio) y se cancela al instante. **Coste cero.** Si no vale, se prueba el siguiente.
5. ¿la política del ejecutor está puesta?

Con los cinco en verde y `GP_PM_ENABLED=1`, el ejecutor coloca en el barrido siguiente (cada 10 minutos).

## La política, en Render

```
GP_PM_BANCO            200
GP_PM_STAKE            5
GP_PM_MAX_EXPOSICION   100     (si no se pone: la mitad del banco)
GP_PM_PARADA_DIARIA_PCT 15
GP_PM_FAMILIAS         futbol:no
GP_PM_ENABLED          1       ← SIN esto el ejecutor ensaya y no coloca
```

Y el enlace con el brazo: `GP_PM_RELAY_URL`, `GP_PM_RELAY_KEY`, `GP_PM_BUNDLE_KEY`. Si las dos primeras no
están, todo cae al relay de Cloudbet — que era el plan original y sigue siendo un destino válido.

---

# Cómo está montado, y por qué así

## Máquina aparte, y no dentro del relay de Cloudbet

El plan era montar el segundo brazo en el servidor que ya coloca en Cloudbet. Que el proyecto de Hetzner
sea otro obligó a replantearlo, y salió mejor:

- **Dos secretos que no se caen juntos.** En Helsinki vive la llave de Cloudbet. Meter ahí también la clave
  privada de la cartera sería juntar en una máquina la capacidad de apostar la cuenta de la casa Y la de
  firmar transferencias. Separados, quien entre en una no se lleva la otra.
- **El camino que lleva dinero real no se toca.** El brazo de Cloudbet coloca desde agosto.
- **El token de Hetzner es por proyecto**: el que gobierna esta máquina no puede ni ver la de Cloudbet.

## El código no vive en la máquina: se lo trae

`/opt/gp-pm/traer.sh` le pide los ocho ficheros a `gpsimulador.com/api/internal/pm-bundle` **antes de cada
arranque**. O sea: **reiniciar es actualizar**, y reiniciar se hace desde la API de Hetzner sin entrar por
SSH.

Esto no es elegancia, es la cicatriz de un problema real: el servidor de Cloudbet lleva desde agosto
corriendo una versión que no se podía tocar, porque el token de Hetzner de aquella sesión se fue con su
contenedor. Una máquina a la que solo se le puede meter código a mano acaba corriendo algo que nadie
recuerda.

Si el servidor principal no contesta, arranca con la copia que ya tiene. Un brazo que se niega a levantarse
porque el cerebro está desplegando es un brazo que se cae cada vez que desplegamos.

La ruta del paquete entrega **solo esos ocho ficheros, de una lista fija en el código**. No es un lector de
ficheros con un parámetro — un parámetro ahí sería una puerta para leer `db.json`.

## Dónde se puede colocar: el mapa lo publica la casa

Está en `relay/geo-polymarket.js` con fecha, fuente (`docs.polymarket.com/developers/CLOB/geoblock`) y
pruebas. Tres grupos:

| grupo | qué significa | quién está |
|---|---|---|
| sancionadas (OFAC) | ni abrir ni cerrar | IR, SY, CU, KP, y Crimea / Donetsk / Lugansk |
| **solo cerrar, web Y API** | se pueden cerrar posiciones, **no abrir ninguna** | **US, DE, GB, FR, IT, BE, PL, SK, SG, BR, AU, NZ, RU, TW, TH, VE**, y CA-BC/ON/AB/QC |
| solo cerrar en la web | la API **no** está restringida → **sirve para el brazo** | IE, JP, NL, MT |

1. **Finlandia no aparece en ninguna lista.** Helsinki no fue una suposición afortunada.
2. **Ninguna región de Render puede colocar.** Son cinco: Oregón, Ohio, Virginia (US), Fráncfort (DE) y
   Singapur (SG). Existe un `gp-relay-eu` en Fráncfort que controlamos entero con la llave de Render y
   parecía el atajo obvio; no lo es. Medido: su `/health` sale con `loc=DE, colo=FRA`.

La lista puede cambiar, así que el `diag` no la usa para decidir: **mide**. Y medir sale gratis, porque **el
cortafuegos geográfico salta antes que la autenticación**: un `POST /order` con cuerpo vacío y sin
credenciales ya devuelve el 403 de región. Cualquier servidor candidato se puede evaluar antes de alquilarlo.

## ¿Y con la clave de la API, sin la privada? NO. Comprobado.

En el esquema de `POST /order`, el campo **`signature` es OBLIGATORIO** (`required: [maker, signer, tokenId,
makerAmount, takerAmount, side, expiration, timestamp, builder, signature, salt, signatureType]`). Y no hay
ninguna otra ruta que coloque órdenes. Son dos cosas distintas y hacen falta las dos:

| | qué dice | quién la da |
|---|---|---|
| credenciales del CLOB | **quién llama** | se derivan firmando una vez |
| firma EIP-712 de la orden | **quién autoriza esta operación concreta** | la clave privada, en cada orden |

La clave del **relayer** tampoco sirve: es para transacciones on-chain sin gas (aprobaciones, depósitos,
cobrar posiciones resueltas). Una orden del CLOB no es una transacción on-chain — es un mensaje firmado que
se publica en el libro.

**La recomendación sigue en pie: una wallet dedicada**, usada solo para esto, con exactamente el dinero del
experimento. Si alguien entrara en el brazo, el techo de la pérdida son esos 200 dólares. Convierte
«confiarle todo al sistema» en «confiarle 200».

(La alternativa teóricamente mejor, la **Session Key** —un firmante aparte que no puede retirar fondos y
caduca a los 180 días—, está **en beta**, funciona **solo con Deposit Wallets** y exige una Builder API key
que hay que pedir a `builder@polymarket.com`.)

## El tipo de firma: la Deposit Wallet es EL caso, no un caso raro

**Toda cuenta de Polymarket creada desde el 4-may-2026 es una Deposit Wallet.** Lo dice su documentación, y
la casa nos lo confirmó rechazando los tres tipos antiguos con «maker address not allowed, please use the
deposit wallet flow». La cuenta nueva de Alexis también lo será.

| wallet | cuándo | `PM_SIG_TYPE` |
|---|---|---|
| **Deposit Wallet** | **todas las creadas desde el 4-may-2026** | **`deposito` (por defecto, no hace falta ponerlo)** |
| Proxy Wallet | legado: cuenta por Magic Link o Google | `proxy` |
| Safe Wallet | legado: cuenta con MetaMask o Rabby | `safe` |
| EOA | una wallet normal | `eoa` |

Una Deposit Wallet es un contrato, no una persona: no firma con una clave, **valida** firmas (ERC-1271).
Eso cambia tres cosas, todas implementadas y cotejadas contra el código de la casa en
`tests/deposito.test.js`:

1. **El `signer` de la orden es la propia wallet**, al revés que en Proxy y Safe. Quien firma sigue siendo
   la clave del dueño; lo que cambia es a quién declara la orden como responsable.
2. **Se firma la orden ENVUELTA** en un `TypedDataSign` (ERC-7739) que mete dentro el dominio de la cuenta,
   para que una firma hecha para una cuenta no valga en otra.
3. **La firma lleva cola**: separador de dominio, hash de la orden, el texto del tipo y su longitud. 317
   bytes en total en vez de 65.

⚠️ **`PM_SIG_TYPE` no se fija en el `cloud-init` a propósito.** El valor por defecto del código ya es
`deposito`. Fijarlo fue exactamente cómo conseguimos que el alta midiera una cosa (`deposito`) y la máquina
firmara otra (`proxy`), con los cinco escalones en verde y todas las órdenes rechazadas. Por eso el paso 4
ahora **compara** lo medido con lo que el brazo usa y no pasa si difieren.

Y un detalle que también nos costó una ronda: el campo **`owner` del cuerpo es la clave de API** (un UUID),
no una dirección. Sin él la casa contesta «the order owner has to be the owner of the API KEY», que suena a
direcciones y no lo es.

## Lo que este brazo NO hace

- **No decide.** No mira el modelo, no elige mercado, no calcula el tamaño. Recibe la intención y la firma.
- **No guarda nada.** Ni la orden, ni la respuesta.
- **No obedece cualquier cifra.** `PM_MAX_USD` (25) rechaza una orden que cueste más, aquí abajo, después
  de todos los frenos del servidor principal. Un brazo que obedece ciegamente amplifica los errores del
  cerebro.
- **No toca el camino de Cloudbet.** Ese lleva dinero real y no se modificó ni una línea para añadir esto.
