# Creatividades de Cloudbet

`cbetBanner()` (en `public/premium.js`) pide estos archivos **por nombre exacto** y elige el tamaño
según el ancho de pantalla. **Si un archivo no está, esa sección cae sola a la banda de texto** — que
es lo que se ve hoy y funciona igual. Se pueden soltar los PNG aquí sin tocar código ni desplegar dos
veces, y sin riesgo de dejar un hueco si falta alguno.

## Los archivos

Dos por deporte. Nombre = `<deporte>-<ancho>x<alto>.png`.

| deporte | escritorio (≥900 px) | móvil (<900 px) | creatividad de Cloudbet |
|---|---|---|---|
| combate | `combate-728x90.png` | `combate-320x100.png` | boxeador · *Knockout odds* |
| esport | `esport-728x90.png` | `esport-320x100.png` | guerrero · *Clutch the win* |
| baloncesto | `baloncesto-728x90.png` | `baloncesto-320x100.png` | base · *Beat the buzzer* |
| tenis | `tenis-728x90.png` | `tenis-320x100.png` | tenista · *Serve you better* |
| futbol | `futbol-728x90.png` | `futbol-320x100.png` | futbolista · *Drive the attack* |

Fútbol todavía no está cableado (ver el comentario en `CBET_ON`), pero se puede dejar el archivo listo.

## Dónde aparece cada uno

Solo en las vistas de ENTRADA de cada sección — en fichas de jugador, simuladores y pantallas de
análisis no va, porque ahí el usuario está leyendo, no decidiendo dónde apostar.

- combate → `cbopps`, `cbfights`
- esport → `esopps`, `esboard`
- baloncesto → `bbopps`, `bbgames`
- tenis → `tenopps`, `tengames`

## Notas

- Optimizar antes de subir: se cargan en cada pintado de la sección.
- El aviso de **18+** lo pone el producto encima del arte: las creatividades no lo traen.
- Cada sección sale con su propio `src` en el enlace, así que `/api/internal/outclicks?key=` dice
  cuál convierte y cuál es decorado.
- Tamaños que Cloudbet también entrega y que hoy no se usan (300x250, 300x600, 160x600, 120x600,
  970x90): reservados para la barra lateral del board de fútbol cuando se decida esa colocación.

De la carpeta "2026 assets" de Alexis · 22-ago-2026.
