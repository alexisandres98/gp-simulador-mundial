# Imágenes del landing multideporte

Generadas el 23-ago-2026 con Higgsfield (suscripción propia de Alexis), no descargadas de ningún
banco de imágenes. Importa por qué: **no hay marcas, ni escudos, ni caras, ni patrocinadores en
ninguna** — son objetos genéricos con la luz de la casa. Eso las hace usables en publicidad sin
pedirle permiso a nadie, que es justo lo que un banco de imágenes deportivas no te da.

## Qué hay
- `deportes/0X-*.webp` (720×480, ~11 KB cada una) — una por cada uno de los nueve deportes que
  publica la página de planes, en el mismo orden: fútbol, UFC/MMA, boxeo, tenis, baloncesto,
  esports, NFL, college·CFL, F1.
- `hero-loop.mp4` (1280×720, 12 s, 226 KB) — fondo del hero. Va en ida y vuelta (el clip original
  dura 6 s y se le pega su propio reverso) para que el bucle no dé un tirón al reiniciar.
- `hero-poster.webp` (1600×900, 16 KB) — el primer fotograma. Se pinta como `poster` para que en
  móvil o con datos ahorrados la página no quede en negro esperando el vídeo.

## Cómo usarlas
El vídeo va `muted autoplay loop playsinline` y con `preload="none"` en móvil: es decoración, nunca
debe competir con el contenido por el ancho de banda. Respetar `prefers-reduced-motion` — con la
preferencia activa se enseña solo el póster.

Fuente de la paleta: los tokens reales de `public/premium.css` (fondo #06090B, acento #1FE3A4).
Si se regeneran, mantener esa luz o dejarán de pertenecer al mismo sitio.
