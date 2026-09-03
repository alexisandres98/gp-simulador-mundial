# REPORT — INTERFAZ: ajustes de tenis y anclaje de Valorant (rama `impl/ui`, 3-sep-2026)

Base: `origin/main` @ `673202bb`. Rama empujada a `origin/impl/ui`, árbol limpio. Nunca se arrancó
`server.js`; ni rutas ni motores se tocaron. `public/style.css` no hizo falta: la capa premium carga solo
`public/premium.css` (tema oscuro único, sin `prefers-color-scheme`) y todo lo nuevo reutiliza clases que ya
existen ahí (`gx-panel`, `gx-ph`, `gx-es-what` / `gx-esw2`, `gx-es-kpis`, `gx-t gx-es-t`, `gx-perf-scroll`,
`gx-es-note`, `gx-up` / `gx-down`).

## Commits

| Hash | Qué |
|---|---|
| `e10e9b69` | `public/premium.js`: bloque de tenis + anclaje de Valorant. `scripts/smoke/ui-smoke.js` (nuevo, 52 comprobaciones). |
| (este) | `docs/impl/ui-REPORT.md`. |

Archivos tocados: `public/premium.js` (+115/−4), `scripts/smoke/ui-smoke.js`, `docs/impl/ui-REPORT.md`. Nada más.

## Qué se pinta y dónde

### 1. Tenis — "Qué mueve la probabilidad" (`tenWhatPanel`, `tenDistLabel`)
- **Dónde:** ficha del partido (`renderTenMatch`, lente *El partido*, entre "El duelo" y "El camino al
  resultado") y simulador (`renderTenSim`, justo debajo de la cabecera del duelo). Los dos JSON
  (`/api/tennis/match`, `/api/tennis/sim`) traen la misma forma, así que es una sola función.
- **Cabecera:** `base 37.0% → 37.1%` (`p_a_base` → `p_a`, un decimal, con `title`).
- **Cuerpo:** cada entrada de `what_matters` con la gramática de `esWhat()` de esports (número, driver, pp
  con signo en verde/rojo/gris, barra proporcional al peso, texto en español tal como viene del motor).
- **Casillas (`gx-es-kpis`), una por ajuste:** *Edad* → `+0.11 pp` con `27.6 vs 27.8 años` (o `no se aplica` con
  el motivo cuando falta la fecha de nacimiento); *Calendario* → `+0.19 pp` con `15 / 3 días sin jugar · 0 / 2 en
  7 días`, o la casilla `sin fecha real`.
- **Pie:** `Juegos totales: distribución empírica (ATP 3 sets)` (`c6`) o `distribución desplazada` (`shift`),
  leído de `duel.dist_method` (ficha) o `adjustments.dist_method` (simulador), más el disclaimer del producto.
- **Cuándo NO existe:** WTA (`adjustments.age` y `.calendar` vienen como `no aplica…`), fichas sin
  `adjustments` ni `what_matters`, `null`. Devuelve `''`, así que la ficha de antes queda idéntica.

### 2. Valorant — anclaje por mapa junto al veto (`esValAnchor`, `esValDistLabel`, cambios en `esVeto` y `esRounds`)
- **Dónde:** panel *Veto de mapas* (lente *El modelo* de la partida y simulador de Valorant, que ya llamaba a
  `esVeto`/`esRounds` y hereda el bloque) y panel *Rondas del mapa* (lente *La partida* y simulador).
- **Veto, con `map_anchoring`:** la tabla "Mapa probable" pasa a cinco columnas — *Equipo · GP* (`p_a_model`),
  *Equipo · anclada* (`p_a`, en negrita: es la que alimenta rondas y hándicaps), *Δ pp* (anclada − modelo, con
  color) y *P(ronda)* (`rounds_by_map[i].p_round_solved`). La lectura del mapa (`note`) sigue bajo el nombre.
  Envuelta en `gx-perf-scroll` para que a 360 px haga scroll horizontal en vez de romper el panel. Debajo,
  tres casillas: *Nivel del mapa · mercado* (`p_map_market` + `p_map_market_from`: "mercado directo (ganador
  del mapa 1)" o "implícita de la serie anclada"), *Media del modelo* (`p_map_model_mean` + `model_vs_market_pp`)
  y *Desplazamiento* (`shift_logit` en logit, "resuelto por bisección" o "fuera de rango: sin desplazar" si
  `bracketed === false`). Cierra la frase corta: *el nivel de cada mapa lo pone el mercado; el modelo aporta la
  forma (qué mapa le va mejor a cada equipo y cómo se reparten las rondas)*, y si `probability` trae
  `temperature`/`max_model`, "la voz propia sobre la serie va templada (temperatura 0.85, peso máximo 25 %)".
- **Rondas, con `map_anchoring`:** tres casillas nuevas tras Media/Prórroga — *P(ronda) resuelta*
  (`p_round_solved`), *Mapa anclado* (`p_map_a`, con "modelo sin anclar X %" de `p_map_a_model`) y *Método*
  (`dist_method: 'bisect'` → "bisección", con "la simulación reproduce X %" de `p_map_sim`) — y una nota de una
  línea sobre nivel (mercado) vs forma (modelo).
- **Sin `map_anchoring` (null o ausente):** no se pinta nada nuevo; `esVeto` y `esRounds` devuelven exactamente
  lo de `origin/main`.

### 3. Móvil / tema / compatibilidad
- Todo con las clases responsivas que ya existen (`gx-es-kpis` pasa a 2 columnas bajo 600 px; la tabla del
  veto hace scroll dentro de `gx-perf-scroll`). Estilos inline solo para tamaños de fuente pequeños.
- `premium.css` es tema oscuro único (no distingue claro/oscuro), así que no hay nada que duplicar.
- Se usa `gx-down` (existe) y no `gx-dn` (no existe en el CSS, aunque `valMapBoard` lo use).

## Cómo se verificó

```
node --check public/premium.js && node --check scripts/smoke/ui-smoke.js
node scripts/smoke/ui-smoke.js            # compara contra `git show origin/main:public/premium.js`
```

`ui-smoke.js` no necesita navegador ni jsdom: extrae por nombre las funciones de render del texto de
`premium.js` (y las de `origin/main`), las evalúa con los helpers reales (`esc`, `esPct`, `esPct0`, `esSign`,
`esPanel`, `esHist`) y stubs mínimos (`ic`, `esT`, `S`, `LANG`, `t`, `tenPct`), y las pasa por datos sintéticos
con la forma exacta que documentan `tenis-REPORT.md` y `valorant-REPORT.md`.

Salida (resumen; 52 OK, 0 fallos):
```
[tenis] ficha ATP con edad + calendario aplicados, distribución C6
  OK título · base 37.0% → 37.1% · +0.11 pp / +0.19 pp · detalle calendario y edad · etiqueta c6 · disclaimer · sin "GP Edge" · 2 líneas
[tenis] ATP bo5 sin fecha real, distribución desplazada
  OK -1.63 pp en rojo · casilla "sin fecha real" · etiqueta shift
[tenis] ATP sin fecha de nacimiento (simulador)
  OK casilla "no se aplica" con el motivo · método leído de adjustments.dist_method
[tenis] WTA y ficha vieja
  OK WTA → '' · sin campos → '' · null/{} → '' · método desconocido sin etiqueta · texto escapado
[valorant] serie con anclaje por mapa
  OK columnas GP/anclada · Haven 58% → 65% · Δ +6.6 en verde · Sunset 44% → 51% · P(ronda) por mapa
  OK nivel del mercado con origen · +0.28 logit y bisección · -7.44 pp vs mercado · frase nivel/forma
  OK temperatura 0.85 y peso máximo 25 % · lectura del mapa · secuencia e impacto intactos · gx-perf-scroll
  OK rondas: P(ronda) 53.5% · bisección · mapa anclado 65% (modelo 58%) · simulación reproduce 65% · resto intacto
[valorant] mercado directo + bisección fuera de rango
  OK "mercado directo (ganador del mapa 1)" · "fuera de rango: sin desplazar"
[valorant] map_anchoring null / ficha vieja
  OK nada nuevo · tabla de siempre · esVeto y esRounds === origin/main (3 fichas, byte a byte)
[cableado]
  OK renderTenMatch · renderTenSim · simulador de Valorant reutiliza esVeto/esRounds
[smoke] 52 OK, 0 fallos
```

## Pendientes

- **Vista en navegador real.** El smoke prueba el HTML, no el layout: conviene abrir en preview una ficha ATP
  con ambos ajustes (p. ej. un partido de Masters con fecha real en la cola) y una serie de Valorant con veto
  simulable, en móvil, para confirmar que la tabla de cinco columnas se lee bien con scroll.
- **`valMapBoard` (tablero de siete mapas)** sigue enseñando solo la p del modelo (`likely_maps[].p_a`). La
  spec pedía el anclaje *junto al veto* y se dejó el tablero como estaba para no cargar siete cards; si se
  quiere, es una línea `gx-vmap-note` por card leyendo `map_anchoring.maps` por `map`.
- **`esRoundsExplorer`** (línea de rondas interactiva) no sabe de `rounds_by_map`: sigue usando la distribución
  del mapa 1. Fuera de alcance aquí.
- **Traducción EN:** la red de seguridad `enWatch` traduce por diccionario; los textos nuevos no tienen entrada
  y se verán en español con el idioma en inglés, como el resto de bloques de tenis y esports.
- `valMapBoard` usa la clase `gx-dn`, que no existe en `premium.css` (los mapas hostiles no salen en rojo). No se
  tocó por no ser de esta tarea; el fix es `gx-dn` → `gx-down` en esa función.
