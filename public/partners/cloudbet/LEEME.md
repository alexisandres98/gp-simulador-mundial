# Creatividades de Cloudbet

`cbetBanner()` (en `public/premium.js`) pide estos archivos **por nombre exacto** y elige el tamaño
según el ancho de pantalla. **Si un archivo no está, esa sección cae sola a la banda de texto** — que
es lo que se ve hoy y funciona igual. Se pueden soltar los PNG aquí sin tocar código ni desplegar dos
veces, y sin riesgo de dejar un hueco si falta alguno.

## Los archivos

Dos por deporte. Nombre = `<deporte>-<ancho>x<alto>.webp`.

| deporte | escritorio (≥900 px) | móvil (<900 px) | creatividad de Cloudbet |
|---|---|---|---|
| combate | `combate-728x90.webp` | `combate-320x100.webp` | boxeador · *Knockout odds* |
| esport | `esport-728x90.webp` | `esport-320x100.webp` | guerrero · *Clutch the win* |
| baloncesto | `baloncesto-728x90.webp` | `baloncesto-320x100.webp` | base · *Beat the buzzer* |
| tenis | `tenis-728x90.webp` | `tenis-320x100.webp` | tenista · *Serve you better* |
| futbol | `futbol-728x90.webp` | `futbol-320x100.webp` | futbolista · *Drive the attack* |

Fútbol todavía no está cableado (ver el comentario en `CBET_ON`), pero el archivo ya está aquí.

## Dónde aparece cada uno

Solo en las vistas de ENTRADA de cada sección — en fichas de jugador, simuladores y pantallas de
análisis no va, porque ahí el usuario está leyendo, no decidiendo dónde apostar.

- combate → `cbopps`, `cbfights`
- esport → `esopps`, `esboard`
- baloncesto → `bbopps`, `bbgames`
- tenis → `tenopps`, `tengames`

## Notas

- Ya optimizados: los JPG/PNG originales de Drive (981 KB en total) se reencodaron a WebP q=0.88 → 160 KB,
  un 84 % menos. Cada banda pesa entre 10 y 21 KB. Si se sustituye alguno, reencodar igual.
- El aviso de **18+** lo pone el producto encima del arte: las creatividades no lo traen.
- Cada sección sale con su propio `src` en el enlace, así que `/api/internal/outclicks?key=` dice
  cuál convierte y cuál es decorado.
- Tamaños que Cloudbet también entrega y que hoy no se usan (300x250, 300x600, 160x600, 120x600,
  970x90): reservados para la barra lateral del board de fútbol cuando se decida esa colocación.

Origen: Drive → `cloudbet/2026 assets/Static Banners/` (Sports/{Boxing,Basketball,Tennis,Soccer}/EN
y Generic/Esports Generic/EN). Descargados el 22-ago-2026.
