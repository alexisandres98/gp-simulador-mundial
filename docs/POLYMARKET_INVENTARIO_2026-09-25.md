# Inventario de mercados de Polymarket contra Cloudbet — 25-sep-2026

Pregunta de Alexis: «¿qué mercados hay en Polymarket de los deportes que cubrimos que no están en Cloudbet? A ver
si hay alguna familia que por no prestar atención no hemos visto.»

## Método

Polymarket publica 469 ligas y deportes en `gamma-api.polymarket.com/sports`, cada uno con su etiqueta. Se bajaron
todos los eventos abiertos de las etiquetas de nuestros deportes (16 ligas de fútbol, CS2, LoL, Valorant, Dota 2,
tenis ATP/WTA/ITF, NFL, college, CFL, UFC y boxeo, dardos, tenis de mesa, F1 y baloncesto): **79.943 mercados**. Cada
pregunta se redujo a una plantilla (se quitan equipos, jugadores, líneas y fechas) y se contó por deporte con su
liquidez del libro. Guion: `scratchpad/pm_inventario.js`, `pm_raw.js`, `pm_plantillas.js` (no versionados).

Aviso: `startDate` en gamma es la fecha de alta del evento, no el saque, así que el corte «próximos 14 días» no sirve
para separar partidos de futuros. Se leyó el catálogo completo y se separó a mano.

## Veredicto en una línea

**No hay ninguna familia entera que se nos haya escapado.** Lo que Polymarket tiene por partido y Cloudbet no, o
está muerto (liquidez de 0 a 5 USD por mercado) o es un derivado de una familia que ya modelamos. Quedan tres
derivados con liquidez real que podríamos publicar mañana con el modelo que ya tenemos, y varios callejones sin salida
que conviene dejar por escrito para no volver a mirarlos.

## Por deporte: qué hay, qué liquidez, qué tenemos

| deporte | familia en Polymarket | liquidez por mercado | ¿la tenemos? |
|---|---|---|---|
| fútbol | ganador Sí/No, empate, spread, O/U goles | 2-27 k · 2-18 k · 2,5 k · < 100 | sí (v2 solo juega el *No*) |
| fútbol | BTTS | ~4,3 k | en sombra (`derivadas_v2`), no en Polymarket |
| fútbol | líder al descanso / empate al descanso | ~3,4 k | en sombra (`h1_1x2`), no en Polymarket |
| fútbol | marcador exacto y **marcador exacto de 1ª parte** | 1-2 k · 3,5 k (Liga MX) | la matriz de mitades lo calcula; no se publica el de 1ª parte |
| fútbol | **primero en marcar en la 1ª parte** | 0,6-1 k | no; calculable con la matriz de 1ª parte |
| fútbol | ganador de la 2ª parte | ~150 | en sombra; en Polymarket muerto |
| fútbol | córners totales, par/impar, primer córner | **0** | en Cloudbet sí; en Polymarket muerto |
| fútbol | once inicial («Will P be in X's Starting 11?») | ~2 | no; muerto |
| tenis | ganador | 40-120 k | sí (v2) |
| tenis | **ganador del set K** | 41 de 150 mercados con ≥ 500 | **no**, y el compilador ya calcula `p_set_a` |
| tenis | **hándicap de sets · total de sets** | 46 de 139 · 29 de 75 con ≥ 500 | **no**; Cloudbet cotiza el marcador exacto en sets |
| tenis | juegos por set O/U · juegos del partido O/U · spread de juegos | 3,8 k · 4 k · 2 k | TOTAL y SPREAD de juegos sí; por set no |
| tenis | «Completed Match» (retirada) | ~20 | no; muerto |
| combate | ganador | 250 k por cartelera | sí |
| combate | **O/U asaltos** | **~4 k** (el derivado más hondo de todo el inventario) | ROUNDS existe en el motor; Cloudbet `mma.totals` |
| combate | método (KO/TKO, sumisión, decisión), por peleador y global | 0,8-1 k | METHOD existe; Cloudbet `mma.winning_method` |
| combate | **gana en el asalto K · termina antes del asalto K** | ~600 · ~1,1 k | no como familia; `fightsim` ya da asalto y reloj del final |
| NFL / college | spread, total, moneyline | 5-25 k | sí |
| NFL / college | **totales por equipo** | ~500-600 (1.361 mercados en college) | no; salen del simulador conjunto margen/total |
| NFL / college | spread y O/U de 1ª mitad y por cuarto | 1ª mitad ~600-1 k · cuartos ~500 | no; el simulador es de partido entero |
| college | margen exacto, empate | 0-65 | no; muerto |
| college | props de jugador por partido (yardas, TD, recepciones) | **< 1** (771 mercados a 0,35 de media) | no; muerto |
| college | «ambos anotan en el cuarto K», prórroga, pick-six, retorno de kickoff | < 1 | no; muerto |
| NFL | props de temporada (N+ yardas, N+ TD) | ~150 | no; sin modelo |
| CS2 | ganador de mapa, hándicap de mapas, hándicap y total de rondas, total de mapas | 270 · 190 · 220 · 300 · 80 | sí, todo |
| CS2 | par/impar de kills y de rondas por mapa | 0-25 | no; es moneda al aire |
| LoL / Dota 2 | ganador de mapa, total de mapas, hándicap de mapas, kills O/U | 6,6 k · 3,6 k · 6 k · 2 k | sí |
| LoL / Dota 2 | Barón/dragón/inhibidores por ambos, first blood, quadra/penta, rampage, «termina de día» | **0-10** | no; con la base de Leaguepedia se podrían modelar, pero no hay a quién vendérselos |
| Valorant | ganador de mapa, hándicap y total de rondas, total de mapas | 0,5-2,5 k | sí |
| dardos | solo ganador en 2 torneos (World Grand Prix, MODUS) | ~100 | Cloudbet tiene más (legs, 180s) |
| tenis de mesa | solo Setka Cup: total de juegos, hándicap de juegos | ~4 | liga privada, fuera por regla (VERIFIED_SCOPE) |
| F1 | ganador, pole, podio, campeón | 5-100 k | en sombra admin |
| F1 | «quién termina más arriba» (cabeza a cabeza) | ~20 | no; muerto |
| baloncesto | solo futuros y premios (pretemporada) | — | — |

## Las tres cosas que sí valdría la pena abrir (en sombra `pm_v2`, nunca con dinero)

1. **Tenis: ganador del set 1, hándicap de sets y total de sets.** Es la familia con más liquidez de todo lo que no
   publicamos y el modelo ya la tiene calculada (`p_set_a` en `tennis-engine/store.js`). Cloudbet cotiza el
   marcador exacto en sets, así que hay cierre contra el que medir. Riesgo conocido: el ganador de tenis en
   nuestra vara es una familia de control, y estos derivados heredan su calibración.
2. **College: totales por equipo.** Salen del mismo simulador conjunto que hoy da +13,1 % en totales de partido en
   sombra (541 liquidadas). 1.361 mercados en Polymarket a 500-600 por mercado. Ojo: están correlacionados con el
   total del partido, así que no son una segunda fuente de ventaja, son la misma repartida. Las mitades y cuartos
   requerirían un reparto por periodos que el simulador no tiene: no se abren.
3. **Combate: «termina antes del asalto K».** El simulador de peleas ya da asalto y reloj del final; Polymarket
   cotiza cada asalto a ~600-1.100 por mercado y el O/U de asaltos a ~4.000. Volumen pequeño (29 peleas listadas),
   así que la muestra tardará meses.

Lo que NO se propone, aunque exista: BTTS y líder al descanso de fútbol en Polymarket (liquidez de 3-4 k) porque el
diagnóstico del 16-sep dice que en derivados de fútbol el modelo es donde peor calibra, y el consenso Shin de tres
vías no vale para un mercado de dos vías sin rehacer la puerta.

## Callejones sin salida, para no volver

Córners en Polymarket (liquidez 0), once inicial, props de jugador por partido en college, margen exacto, objetivos
de LoL y Dota 2, par/impar en CS2, cabeza a cabeza de F1, tenis de mesa (solo Setka Cup), dardos (solo ganador de
dos torneos).

## Números crudos del inventario

Mercados por deporte: fútbol 14.889 · CS2 3.690 · LoL 1.673 · Valorant 934 · Dota 2 702 · tenis 2.358 · NFL 19.439
· college 32.053 · CFL 12 · combate 1.078 · dardos 66 · tenis de mesa 1.842 · F1 306 · baloncesto 901.
