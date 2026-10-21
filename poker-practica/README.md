# Mesa de práctica · Poker Math

App de una sola página para practicar los ejercicios de
[tylerjw/poker_math](https://github.com/tylerjw/poker_math) (dominio público), basado en
*Essential Poker Math, Expanded Edition*. Independiente de GP Simulador: no toca servidor, modelo ni datos.

**Fundamentos**
- **Cuota ↔ %** (cap. 6): m:n = n ÷ (m + n).
- **Pot odds** (cap. 6): los cuatro niveles de `pot_odds.py`; se responde en cuota o en % de equity necesaria.
- **SPR** (cap. 2): stack efectivo ÷ bote y zona de compromiso.
- **Flashcards**: `resources/flashcards.csv` traducido + mazo extra (combos, preflop, EV, MDF).

**Proyectos**
- **Outs** (cap. 8): flop o turn con un proyecto; cuenta exacta (escalera/color, sin contar doble).
- **Regla del 2 y 4** (cap. 8): equity aproximada y exacta.
- **Call o fold**: en el turn (una carta) o all-in en el flop (dos cartas).
- **Implied odds**: cuánto hay que ganar en el river para que el call no pierda.

**Más allá**
- **EV** de pagar, con los errores típicos como distractores.
- **Farol y MDF**: fold necesario de un farol y defensa mínima.
- **Combos**: combinaciones de manos con bloqueadores en la mesa.
- **Preflop**: equity de enfrentamientos típicos, simulada (15.000 mesas, evaluador de 7 cartas).

**Entreno**
- **Mixto**: pregunta al azar de cualquier ejercicio.
- **Fallos**: repite lo que fallaste hasta acertarlo.

Marcador por ejercicio (aciertos, racha, tiempo medio) y progreso global en `localStorage`.
Teclas: 1-4 / A S D F, Enter, Espacio.

Pruebas de la lógica (evaluador, equities conocidas, outs, combos, EV): `node poker-practica/test.js`
