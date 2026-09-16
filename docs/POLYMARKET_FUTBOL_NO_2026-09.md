# Polymarket `fútbol·No` — el veredicto G1 (16-sep-2026, D-1)

**Qué se preguntaba.** De los cuatro candidatos a dinero del plan, `fútbol·No` era el único con muestra y
signo positivo. D-1 pide decidir si pasa G1, y pide hacerlo con tres comprobaciones concretas.

**Cómo.** `scripts/polymarket-segmentos.js` sobre el libro completo de la sombra (483 posiciones, 384
cerradas). El `pnl` de cada posición **ya viene neto de comisión** — `propfirm/polyshadow.js` la resta al
liquidar, desde el arreglo del 15-sep.

---

## La tabla

| segmento | n | partidos | costo | pnl | ROI | t | IC del ROI | BH |
|---|---:|---:|---:|---:|---:|---:|---|---|
| cs2·over | 14 | 14 | 302,67 | +217,44 | +71,84 % | 1,28 | [−37,65 · +181,08] | n<30 |
| lol·home | 4 | 4 | 116,13 | +81,87 | +70,50 % | 0,71 | [−100 · +292,05] | n<30 |
| lol·away | 3 | 3 | 92,00 | +17,00 | +18,48 % | 0,37 | [−100 · +78,57] | n<30 |
| cs2·away | 90 | 63 | 2.249,71 | +117,49 | +5,22 % | 0,32 | [−27,11 · +38,12] | · |
| **futbol·No** | **113** | **106** | **3.405,93** | **+175,48** | **+5,15 %** | **0,49** | **[−15,60 · +26,41]** | **·** |
| lol·under | 5 | 5 | 141,83 | −11,83 | −8,34 % | −0,13 | [−100 · +138,63] | n<30 |
| cs2·home | 91 | 62 | 2.395,46 | −244,68 | −10,21 % | −0,63 | [−41,15 · +21,80] | · |
| futbol·Yes | 50 | 49 | 1.465,71 | −175,39 | −11,97 % | −0,64 | [−47,34 · +24,73] | · |
| cs2·under | 4 | 4 | 68,67 | −10,67 | −15,54 % | −0,30 | [−100 · +63,24] | n<30 |
| lol·over | 10 | 8 | 287,83 | −144,83 | −50,32 % | −1,20 | [−100 · +55,03] | n<30 |

ROI con remuestreo por **partido**, no por posición: tres mercados del mismo enfrentamiento se mueven
juntos y contarlos como tres observaciones divide el error estándar por la raíz de un número que no existe.

---

## Veredicto: **NO pasa G1**

`fútbol·No` rinde **+5,15 %** — más que el +2,71 % que citaba el plan, porque ha seguido acumulando — pero:

- su **t es 0,49**;
- su intervalo del ROI, remuestreando por partido, es **[−15,60 %, +26,41 %]**, que incluye el cero con
  holgura por los dos lados;
- y **no sobrevive a Benjamini-Hochberg** junto a los otros segmentos con muestra.

Con diez segmentos mirados, quedarse con el mejor sin corregir es exactamente cómo se fabrica un
descubrimiento falso. Corregido, no queda nada.

**Se cierra como candidato a dinero.** La sombra sigue corriendo: no cuesta nada y la muestra crece.

---

## Las dos comprobaciones que pedía el plan, contestadas

**1. ¿`Yes` y `No` son el mismo mercado visto de dos lados?** **No.** De los **158 mercados** de fútbol con
posición, solo **5** se apostaron por los dos lados. `Yes` y `No` caen casi siempre en mercados distintos
—«¿gana el Wolfsberger?» y «¿gana el LASK?» son dos mercados, no dos caras de uno—, así que el signo de uno
no es el reflejo aritmético del otro. La hipótesis de que el edge fuera puro sesgo de selección entre caras
**queda descartada**; lo que mata a `fútbol·No` no es eso, es la incertidumbre.

**2. La suma de los dos lados.** +175,48 del `No` y −175,39 del `Yes` suman **+0,09**. Nueve céntimos sobre
4.871 de costo en 163 posiciones. No es aritmética forzada (son mercados distintos), pero es una coincidencia
que merece quedar escrita: apostando a los dos lados del fútbol en Polymarket, la sombra ha terminado
**exactamente en cero**, que es lo que cabría esperar de un mercado eficiente donde la comisión ya se pagó.

---

## Lo que esto deja

Con este veredicto, de los cuatro candidatos a dinero del plan del 16-sep:

| # | candidato | estado a 16-sep, final del día |
|---|---|---|
| **C1** | Polymarket `fútbol·No` | **no pasa G1** (t 0,49, IC [−15,6 · +26,4]) |
| **C2** | HTFT / 2T condicional | **el precio ya lleva la condicionalidad** — `docs/HTFT_CIERRE_2026-09-16.md` |
| **C3** | Córners `corners_v2` | **cerrado por margen** (3,95-4,50 %/lado) — `docs/MARGEN_CLOUDBET_2026-09-16.md` |
| **C5** | Underdog props | **retirada**, la tabla de pagos no se puede verificar — `docs/CONTRATOS_CASA.md` |
| **C4** | Tarjetas `cards_under_v2` | sigue esperando. Punto de decisión ≈ **20-oct**. Nada que construir |

**No queda ningún candidato en construcción.** Queda uno esperando muestra, y es el mismo que ya estaba
esperando el 13-sep.
