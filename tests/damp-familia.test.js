// tests/damp-familia.test.js — UN AMORTIGUADOR POR FAMILIA (16-sep, M4)
//
// Córners y tarjetas llevaban el MISMO `TOTALS_DAMP`, elegido por la SUMA de sus dos skills. Con un solo
// número, la familia que más pesara en la suma decidía por la otra — y no lo piden igual: las tarjetas
// ganan señal de equipo y de árbitro donde los córners no. Lo que se fija aquí es que el amortiguador de
// cada familia mueva SOLO a esa familia, y que poner los dos iguales siga dando exactamente lo de antes.
'use strict';
const pe = require('../prop-engine');

let fallos = 0;
const t = (nombre, ok, extra = '') => { if (!ok) fallos++; console.log(`${ok ? 'ok  ' : 'FALLA'}  ${nombre}${extra ? ' — ' + extra : ''}`); };

const BASE = {
  league: { teamCornersMean: 5, teamCardsMean: 2, totalCornersMean: 10, totalCardsMean: 4,
    rCornersTotal: 20, rCardsTotal: 10, rCornersTeam: 15, rCardsTeam: 8, matches: 100, phaseMult: {} },
  teams: { A: { n: 30, cornersForRatio: 1.3, cornersAgainstRatio: 1.1, cardsForRatio: 1.25, cardsDrawnRatio: 1.0 },
    B: { n: 30, cornersForRatio: 1.2, cornersAgainstRatio: 1.0, cardsForRatio: 1.15, cardsDrawnRatio: 1.1 } },
  refs: {},
};
const CFG = { PRIOR_MATCHES: 4, REF_PRIOR: 14, REF_CLAMP: 0.2, GAME_STATE_WEIGHT: 0.5, GS_CLAMP: 0.25,
  TOTALS_DAMP: 0, TOTALS_DAMP_CORNERS: null, TOTALS_DAMP_CARDS: null, PHASE_PRIOR: 10 };
const con = (o) => pe.project({ ...BASE, cfg: Object.assign({}, CFG, o) }, { home: 'A', away: 'B' });

const d0 = con({ TOTALS_DAMP: 0 });
const d1 = con({ TOTALS_DAMP: 1 });

// ── 1. EL AMORTIGUADOR HACE LO QUE DICE ─────────────────────────────────────────────────────────────────
t('con damp 0 el total es la media de liga', Math.abs(d0.corners.total - 10) < 1e-9 && Math.abs(d0.cards.total - 4) < 1e-9,
  `${d0.corners.total.toFixed(4)} / ${d0.cards.total.toFixed(4)}`);
t('con damp 1 el total conserva la señal de equipo', d1.corners.total > 12 && d1.cards.total > 4.5,
  `${d1.corners.total.toFixed(4)} / ${d1.cards.total.toFixed(4)}`);

// ── 2. CADA FAMILIA MUEVE SOLO LA SUYA ──────────────────────────────────────────────────────────────────
const soloCorners = con({ TOTALS_DAMP: 0, TOTALS_DAMP_CORNERS: 1 });
t('subir el damp de córners no toca a las tarjetas',
  Math.abs(soloCorners.corners.total - d1.corners.total) < 1e-9 && Math.abs(soloCorners.cards.total - d0.cards.total) < 1e-9,
  `córners ${soloCorners.corners.total.toFixed(4)} · tarjetas ${soloCorners.cards.total.toFixed(4)}`);
const soloCards = con({ TOTALS_DAMP: 0, TOTALS_DAMP_CARDS: 1 });
t('y subir el de tarjetas no toca a los córners',
  Math.abs(soloCards.cards.total - d1.cards.total) < 1e-9 && Math.abs(soloCards.corners.total - d0.corners.total) < 1e-9,
  `córners ${soloCards.corners.total.toFixed(4)} · tarjetas ${soloCards.cards.total.toFixed(4)}`);

// ── 3. CON LOS DOS IGUALES, NADA CAMBIA ─────────────────────────────────────────────────────────────────
// Es la garantía de que este cambio no reescribe el pasado: mientras las dos familias elijan lo mismo, la
// salida es la de siempre hasta el último decimal.
for (const v of [0, 0.25, 0.5, 1]) {
  const uno = con({ TOTALS_DAMP: v });
  const dos = con({ TOTALS_DAMP: 0, TOTALS_DAMP_CORNERS: v, TOTALS_DAMP_CARDS: v });
  t(`con los dos a ${v} la salida es idéntica`,
    Math.abs(uno.corners.total - dos.corners.total) < 1e-12 && Math.abs(uno.cards.total - dos.cards.total) < 1e-12);
}

// ── 4. SIN PONER NADA, SE HEREDA `TOTALS_DAMP` ──────────────────────────────────────────────────────────
const heredado = con({ TOTALS_DAMP: 0.5 });
const explicito = con({ TOTALS_DAMP: 0.5, TOTALS_DAMP_CORNERS: null, TOTALS_DAMP_CARDS: undefined });
t('un damp por familia sin poner cae a TOTALS_DAMP',
  Math.abs(heredado.corners.total - explicito.corners.total) < 1e-12
  && Math.abs(heredado.cards.total - explicito.cards.total) < 1e-12);

// ── 5. LOS MERCADOS POR EQUIPO NO SE AMORTIGUAN ─────────────────────────────────────────────────────────
// El amortiguador es del TOTAL. Si tocara también a los equipos, cambiaría una familia que ya está
// validada (skill LOO +0,022) sin que nadie lo hubiera pedido.
t('el amortiguador no toca los mercados por equipo',
  Math.abs(d0.corners.home - d1.corners.home) < 1e-12 && Math.abs(d0.cards.away - d1.cards.away) < 1e-12,
  `${d0.corners.home.toFixed(4)} vs ${d1.corners.home.toFixed(4)}`);

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo correcto');
process.exit(fallos ? 1 : 0);
