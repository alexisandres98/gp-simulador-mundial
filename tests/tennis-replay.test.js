// tests/tennis-replay.test.js — EL WALK-FORWARD TIENE QUE SER EL MISMO MODELO (T2.14/T2.15, 15-sep-2026)
//
// Por qué existe. Para validar el compilador hacia adelante hace falta el estado del modelo tal y como era
// ANTES de cada partido, y eso vivía dentro de `build()` sin forma de asomarse. La salida fácil —copiar el
// bucle a un script— es la que garantiza que un día el script valide un modelo que ya no es el que sirve:
// alguien toca la vida media en `data.js`, el script sigue con la suya, y el challenger mide otra cosa sin
// que nadie se entere.
//
// Así que la regla se escribe UNA vez (`aplicaFila`) y la usan las dos puertas. Este test comprueba la
// equivalencia: recorrer la base con `recorre()` tiene que dejar EXACTAMENTE el mismo Elo, el mismo Elo por
// superficie, el mismo nivel de saque del circuito y los mismos perfiles que `build()`. Si alguien rompe la
// equivalencia, aquí salta.
//
// Correr: node tests/tennis-replay.test.js
'use strict';
const D = require('../tennis-engine/data.js');

let fallos = 0;
const igual = (nombre, real, esperado) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}: esperado ${JSON.stringify(esperado)}, real ${JSON.stringify(real)}`);
};

const fin = D.build();
// `desde: 99999999` recorre la base entera sin llamar al hook ni una vez: solo interesa el estado final
const rep = D.recorre({ desde: 99999999 });

igual('el recorrido ve las mismas filas', rep.filas, fin.rows.length);
igual('y no evalúa ninguna con el filtro cerrado', rep.evaluados, 0);

for (const tn of [0, 1]) {
  const lbl = tn === 0 ? 'atp' : 'wta';
  const A = fin.T[tn], B = rep.T[tn];
  igual(`${lbl}: mismo número de jugadores con Elo`, B.elo.size, A.elo.size);
  let maxElo = 0, maxSurf = 0;
  for (const [id, v] of A.elo) maxElo = Math.max(maxElo, Math.abs(v - (B.elo.get(id) != null ? B.elo.get(id) : NaN)));
  for (let s = 0; s < 4; s++) for (const [id, v] of A.eloSurf[s]) {
    const w = B.eloSurf[s].get(id);
    maxSurf = Math.max(maxSurf, Math.abs(v - (w != null ? w : NaN)));
  }
  igual(`${lbl}: el Elo general coincide al bit`, maxElo, 0);
  igual(`${lbl}: el Elo por superficie también`, maxSurf, 0);
  igual(`${lbl}: mismo nivel de saque del circuito`, B.tourSpw, A.tourSpw);
  igual(`${lbl}: mismos perfiles de catálogo`, B.prof.size, A.prof.size);
}

// ── Y LA SEGUNDA MITAD: el estado PREVIO es de verdad previo ────────────────────────────────────────────
// Un walk-forward que se asoma al estado ya actualizado no es un walk-forward: es el modelo mirando el
// resultado. Se comprueba con el primer partido de un jugador — antes de jugarlo su Elo es el de arranque
// (1500) y su contador de partidos, cero.
let comprobados = 0, sucios = 0;
D.recorre({ desde: 20250101, hasta: 20250131, onMatch: (r, t) => {
  const F = fin.F;
  const w = r[F.wid];
  const n = t.nMatch.get(w);
  if (n !== 0 && n !== undefined) return;             // no es su primer partido: no dice nada
  comprobados++;
  if ((t.elo.get(w) != null && t.elo.get(w) !== 1500)) sucios++;
} });
igual('el estado que ve el hook es anterior al partido (Elo de arranque en el debut)', sucios, 0);
console.log(`      (${comprobados} debuts comprobados en enero de 2025)`);

// ── EL RECORTE DEL SAQUE VIAJA DECLARADO ────────────────────────────────────────────────────────────────
const p = D.probsEn(fin.T[0], [...fin.T[0].elo.keys()][0], [...fin.T[0].elo.keys()][1], 0);
igual('probsEn declara el recorte de A', Object.prototype.hasOwnProperty.call(p, 'clampA'), true);
igual('y el valor crudo, para poder medir cuánto se recortó', Number.isFinite(p.paSrvCrudo), true);
igual('el recortado nunca se sale del rango', p.paSrv >= D.CLAMP_SPW[0] && p.paSrv <= D.CLAMP_SPW[1], true);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
