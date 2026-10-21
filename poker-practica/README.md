# Mesa de práctica · Poker Math

App de una sola página para practicar los ejercicios de
[tylerjw/poker_math](https://github.com/tylerjw/poker_math) (dominio público), basado en
*Essential Poker Math, Expanded Edition*. Independiente de GP Simulador: no toca servidor, modelo ni datos.

Ejercicios:
- **Pot odds** (cap. 6): los cuatro niveles de `pot_odds.py` (enteros escalados, fraccionarios, 1 call, 0-3 calls).
- **Cuota ↔ %** (cap. 6): m:n = n ÷ (m + n).
- **Outs** (cap. 8): reparte flop o turn con un proyecto y cuenta exacta de outs (escalera/color, sin contar doble).
- **Regla del 2 y 4** (cap. 8): equity aproximada y exacta.
- **Call o fold**: equity del proyecto contra la equity que exigen las pot odds.
- **SPR** (cap. 2): stack efectivo ÷ bote y zona de compromiso.
- **Flashcards**: `resources/flashcards.csv` traducido.

Marcador por ejercicio en `localStorage`. Teclas: 1-4 / A S D F, Enter, Espacio.

Prueba de la lógica: `node poker-practica/test.js`
