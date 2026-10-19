# Avisos de la pausa (borradores, 19-oct-2026)

Tres textos para el día que se duerma la plataforma. Son borradores de Alexis para que los mande él: nada de
esto sale solo. Producto siempre «GP Simulador».

## 1. Correo a los usuarios

Está en código como variante del broadcast (`pausa`: cada usuario en su idioma, `pausa_es` / `pausa_en`
fijos; función `pausaEmail` en `server.js`). Se manda con `POST /api/admin/broadcast?key=<GP_EXPORT_KEY>`
y cuerpo `{"variant":"pausa"}`; antes, `{"variant":"pausa","count":true}` dice a cuántos llegaría y
`{"variant":"pausa","test":true}` lo manda solo al admin. Con Resend en Pro (Free solo deja 100 al día),
y ANTES de poner `GP_HIBERNADO=1` si se quiere que los usuarios lo lean con la web todavía viva.

**Asunto:** GP Simulador se toma una pausa

Hola,

Te escribo porque tienes cuenta en GP Simulador y mereces saberlo de primera mano: **a partir de hoy la
plataforma entra en pausa**. Durante cuatro meses publicamos probabilidades, oportunidades y picks para el
Mundial y para once deportes, y medimos cada una contra el mercado. Esa medición es lo más valioso que nos
llevamos, y también la razón de parar ahora: queremos volver con algo mejor, no con más de lo mismo.

Qué cambia para ti:
- La web mostrará un aviso de pausa en lugar de la plataforma.
- Tu cuenta y tus preferencias quedan guardadas. Cuando volvamos entrarás con el mismo correo.
- Si tenías un plan de pago activo, te escribimos aparte para cerrarlo sin que pagues nada más.
- No vamos a mandarte correos mientras tanto, salvo el día que volvamos.

Si quieres seguir el hilo, el canal de Telegram sigue abierto: https://t.me/gpsimulador. Y para cualquier
cosa, soporte@gpsimulador.com.

Gracias por haber estado. De verdad.

Alexis · GP Simulador

*Las probabilidades que publicamos eran estimaciones de un modelo estadístico, no consejo financiero.*

## 2. Mensaje fijado en @gpsimulador

📌 **GP Simulador entra en pausa.**

Después de cuatro meses midiendo nuestros modelos contra el mercado, paramos para preparar la siguiente etapa
con calma. La web mostrará un aviso; las cuentas quedan guardadas y el día que volvamos lo anunciamos aquí
primero.

Gracias a todos los que estuvieron. soporte@gpsimulador.com para lo que sea.

## 3. Correo a cada suscriptor de Whop con membresía activa (si los hay)

**Asunto:** Tu plan de GP Simulador: lo cerramos sin coste

Hola,

GP Simulador entra en pausa y no queremos que pagues por algo que no vas a poder usar. Tu membresía queda
cancelada al final del periodo que ya tienes pagado [o: te devolvemos la parte proporcional, X USD, por
Whop en los próximos días]. No tienes que hacer nada.

Como fuiste de los primeros, cuando volvamos tendrás el mismo precio que tenías ahora: lo prometimos y lo
mantenemos.

Si prefieres el reembolso completo del último cobro, responde a este correo y lo hacemos.

Gracias por confiar.

Alexis · GP Simulador
