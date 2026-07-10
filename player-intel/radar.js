// player-intel/radar.js — RADAR SVG del jugador (PURO, sin I/O, sin deps). Dibuja los ejes del scout
// (percentiles 0-1 vs su posición) como polígono sobre una malla; parametrizable por tema para que la misma
// función sirva en el perfil de /x (tema plataforma) y en las páginas SEO públicas (tema landing).
// La serie es "este torneo vs jugadores de su posición"; post-Mundial se superpone la serie de su liga.
'use strict';

const DEF = {
  size: 320, rings: 4, pad: 58,
  stroke: '#2be3a6', fill: 'rgba(43,227,166,.22)',
  grid: 'rgba(255,255,255,.12)', label: '#9fbcae', labelSize: 10.5,
  dot: '#2be3a6', bg: 'transparent',
};

function polar(cx, cy, r, angle) {
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

// axes: [{ key, pct }] (3-9 ejes) · labels: { key: 'texto' } · theme: overrides de DEF
function radarSvg(axes, labels = {}, theme = {}) {
  const T = { ...DEF, ...theme };
  const n = (axes || []).length;
  if (n < 3) return '';
  const cx = T.size / 2, cy = T.size / 2, R = T.size / 2 - T.pad;
  const ang = i => -Math.PI / 2 + (2 * Math.PI * i) / n;
  let out = `<svg viewBox="0 0 ${T.size} ${T.size}" xmlns="http://www.w3.org/2000/svg" role="img" style="background:${T.bg}">`;
  // malla: anillos concéntricos + radios
  for (let r = 1; r <= T.rings; r++) {
    const pts = axes.map((_, i) => polar(cx, cy, (R * r) / T.rings, ang(i)).map(v => v.toFixed(1)).join(',')).join(' ');
    out += `<polygon points="${pts}" fill="none" stroke="${T.grid}" stroke-width="1"/>`;
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = polar(cx, cy, R, ang(i));
    out += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${T.grid}" stroke-width="1"/>`;
  }
  // polígono del jugador (percentiles, piso visual 0.06 para que un eje bajo no colapse el vértice)
  const pts = axes.map((a, i) => polar(cx, cy, R * Math.max(0.06, Math.min(1, a.pct || 0)), ang(i)).map(v => v.toFixed(1)).join(',')).join(' ');
  out += `<polygon points="${pts}" fill="${T.fill}" stroke="${T.stroke}" stroke-width="2" stroke-linejoin="round"/>`;
  for (let i = 0; i < n; i++) {
    const a = axes[i];
    const [x, y] = polar(cx, cy, R * Math.max(0.06, Math.min(1, a.pct || 0)), ang(i));
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${T.dot}"/>`;
  }
  // etiquetas
  for (let i = 0; i < n; i++) {
    const a = ang(i);
    const [x, y] = polar(cx, cy, R + 16, a);
    const anchor = Math.abs(Math.cos(a)) < 0.35 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end';
    const dy = Math.sin(a) > 0.6 ? 8 : Math.sin(a) < -0.6 ? -2 : 4;
    const txt = labels[axes[i].key] || axes[i].key;
    out += `<text x="${x.toFixed(1)}" y="${(y + dy).toFixed(1)}" text-anchor="${anchor}" font-size="${T.labelSize}" font-weight="600" fill="${T.label}" font-family="inherit">${txt}</text>`;
  }
  out += '</svg>';
  return out;
}

module.exports = { radarSvg };
