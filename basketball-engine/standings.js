// ── CLASIFICACIÓN Y EVOLUCIÓN (19-ago, pedido de Alexis: "agreguemos una parte de bracket para
// baloncesto, bracket o evolución lo que aplique mejor o ambas") ─────────────────────────────────────────
//
// APLICAN LAS DOS, PERO NO LA MISMA EN CADA MOMENTO. Un bracket solo existe cuando la liga entra en
// playoffs; una clasificación existe siempre y es de donde SALE el bracket. Así que se calcula la
// clasificación de la temporada regular con el reparto de plazas de cada liga, y el cuadro se deriva de
// ella —emparejando 1-8, 2-7…— declarando que es PROYECTADO mientras la fase regular siga viva.
//
// Todo sale del registro de partidos propio: no hay una llamada nueva a nadie. Y lleva la fecha del último
// partido cargado, porque una clasificación sin fecha es una clasificación que puede estar meses vieja sin
// que se note.
'use strict';

const r1 = (x) => (Number.isFinite(x) ? +x.toFixed(1) : null);

// plazas de playoff y formato del cuadro por liga
const PLAYOFF = {
  wnba: { spots: 8, note: 'las ocho mejores por balance, sin conferencias (formato actual de la WNBA)' },
  nba: { spots: 8, by_conference: true, note: 'ocho por conferencia; del 7º al 10º entran por el play-in' },
};

// LA CONFERENCIA NO VIENE EN EL REGISTRO, y sin ella un cuadro de la NBA está simplemente mal: cruzaría a
// Oklahoma con los Lakers en primera ronda, que no puede pasar. No es un dato de modelo ni cambia ningún
// número — es el reparto oficial de la liga, estable desde hace décadas, así que se declara aquí en vez de
// pedirlo a nadie. La WNBA no lo necesita: juega tabla única desde 2022.
const NBA_CONF = {
  E: ['ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DET', 'IND', 'MIA', 'MIL', 'NY', 'ORL', 'PHI', 'TOR', 'WSH'],
  W: ['DAL', 'DEN', 'GS', 'HOU', 'LAC', 'LAL', 'MEM', 'MIN', 'NO', 'OKC', 'PHX', 'POR', 'SAC', 'SA', 'UTAH'],
};
const CONF_DE = (() => { const m = {}; for (const [c, list] of Object.entries(NBA_CONF)) for (const a of list) m[a] = c; return m; })();
const CONF_LABEL = { E: 'Este', W: 'Oeste' };

function standings(C) {
  if (!C || !C.games) return null;
  const T = {};
  const cell = (id) => (T[id] = T[id] || { id, w: 0, l: 0, pf: 0, pa: 0, poss: 0, ort: 0, drt: 0, n: 0,
    home_w: 0, home_l: 0, away_w: 0, away_l: 0, last10: [], streak: 0, last_date: null });
  // SOLO TEMPORADA REGULAR. `season_type` 2 es regular y 1 es pretemporada: mezclarlas mete partidos de
  // exhibición en una clasificación, que es exactamente el tipo de error que nadie mira dos veces.
  const games = C.games.filter((g) => g.season_type === 2 && g.home && g.away && g.home.pts != null)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  for (const g of games) {
    const H = cell(g.home.id), A = cell(g.away.id);
    const hw = g.home.pts > g.away.pts;
    H.pf += g.home.pts; H.pa += g.away.pts; A.pf += g.away.pts; A.pa += g.home.pts;
    if (g.home.ff && g.home.ff.ortg) { H.ort += g.home.ff.ortg; H.drt += (g.away.ff && g.away.ff.ortg) || 0; H.n++; }
    if (g.away.ff && g.away.ff.ortg) { A.ort += g.away.ff.ortg; A.drt += (g.home.ff && g.home.ff.ortg) || 0; A.n++; }
    if (hw) { H.w++; A.l++; H.home_w++; A.away_l++; } else { H.l++; A.w++; H.home_l++; A.away_w++; }
    H.last10.push(hw ? 1 : 0); A.last10.push(hw ? 0 : 1);
    H.streak = hw ? (H.streak > 0 ? H.streak + 1 : 1) : (H.streak < 0 ? H.streak - 1 : -1);
    A.streak = hw ? (A.streak < 0 ? A.streak - 1 : -1) : (A.streak > 0 ? A.streak + 1 : 1);
    H.last_date = A.last_date = g.date;
  }
  // FUERA LO QUE NO ES UN EQUIPO DE LA LIGA. En el registro de la WNBA aparece un id que no está en el
  // catálogo —el equipo del partido de las estrellas— y con un 1-0 se colaba en el primer puesto de la
  // clasificación. Un equipo que no existe encabezando la tabla es de los errores que nadie mira dos veces.
  const rows = Object.values(T).filter((x) => (C.teams || {})[x.id]).map((x) => {
    const t = (C.teams || {})[x.id] || {};
    const l10 = x.last10.slice(-10);
    return {
      id: x.id, abbr: t.abbr || x.id, name: t.name || t.short || x.id, logo: t.logo || null,
      w: x.w, l: x.l, pj: x.w + x.l,
      pct: (x.w + x.l) ? +(x.w / (x.w + x.l)).toFixed(3) : null,
      pf: r1(x.pf / Math.max(1, x.w + x.l)), pa: r1(x.pa / Math.max(1, x.w + x.l)),
      diff: r1((x.pf - x.pa) / Math.max(1, x.w + x.l)),
      // ritmo neutralizado: puntos por 100 posesiones a favor y en contra, que es la medida con la que el
      // motor trabaja. Un diferencial por partido premia a quien juega rápido; este no.
      ortg: x.n ? r1(x.ort / x.n) : null, drtg: x.n ? r1(x.drt / x.n) : null,
      net: x.n ? r1((x.ort - x.drt) / x.n) : null,
      home: `${x.home_w}-${x.home_l}`, away: `${x.away_w}-${x.away_l}`,
      last10: `${l10.filter(Boolean).length}-${l10.length - l10.filter(Boolean).length}`,
      streak: x.streak > 0 ? `G${x.streak}` : `P${-x.streak}`,
    };
  }).sort((a, b) => (b.pct - a.pct) || (b.net - a.net));
  const cfg = PLAYOFF[C.league] || { spots: 8 };
  // el cabeza de serie se numera DENTRO de la conferencia cuando la liga las tiene, que es lo que decide
  // los cruces de verdad
  if (cfg.by_conference) {
    for (const r of rows) r.conf = CONF_DE[r.abbr] || null;
    const cnt = {};
    for (const r of rows) { const c = r.conf || '?'; cnt[c] = (cnt[c] || 0) + 1; r.seed = cnt[c]; r.conf_label = CONF_LABEL[r.conf] || null; }
  } else {
    rows.forEach((r, i) => { r.seed = i + 1; });
  }
  return {
    league: C.league, season: C.season, rows, playoff_spots: cfg.spots, playoff_note: cfg.note || null,
    by_conference: !!cfg.by_conference, conferences: cfg.by_conference ? CONF_LABEL : null,
    games: games.length, last_game: games.length ? games[games.length - 1].date : null,
  };
}

// EL CUADRO, DERIVADO DE LA CLASIFICACIÓN Y DECLARADO COMO PROYECTADO. No se inventa un bracket oficial:
// se dice de dónde sale cada cruce y que mientras queden partidos de fase regular esto se mueve.
function bracket(C) {
  const st = standings(C);
  if (!st || !st.rows.length) return null;
  const n = st.playoff_spots;
  const cuadroDe = (rows) => {
    const dentro = rows.slice(0, n), fuera = rows.slice(n);
    const cruces = [];
    for (let i = 0; i < n / 2 && dentro[n - 1 - i]; i++) cruces.push({ hi: dentro[i], lo: dentro[n - 1 - i] });
    return { pairs: cruces, in: dentro, out: fuera.slice(0, 4) };
  };
  const grupos = st.by_conference
    ? Object.entries(CONF_LABEL).map(([k, label]) => ({ key: k, label, ...cuadroDe(st.rows.filter((r) => r.conf === k)) }))
    : [{ key: 'all', label: null, ...cuadroDe(st.rows) }];
  return {
    league: st.league, season: st.season, projected: true,
    spots: n, groups: grupos,
    // compatibilidad con la lectura de un solo cuadro
    pairs: grupos[0].pairs, in: grupos[0].in, out: grupos[0].out,
    last_game: st.last_game, games: st.games,
    note: st.playoff_note,
    why: 'cuadro PROYECTADO con la clasificación de hoy: mientras queden partidos de fase regular, los cruces se mueven.',
  };
}

// LA EVOLUCIÓN: el balance y el diferencial neto de cada equipo partido a partido. Es la vista que responde
// a "¿este equipo está mejorando o está viviendo de lo que hizo en mayo?", que la tabla no puede contestar.
function evolution(C, { top = 10 } = {}) {
  if (!C || !C.games) return null;
  const games = C.games.filter((g) => g.season_type === 2 && g.home && g.home.pts != null)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const acc = {};
  const series = {};
  const esEquipo = (id) => !!(C.teams || {})[id];
  for (const g of games) {
    for (const [me, rival] of [[g.home, g.away], [g.away, g.home]]) {
      if (!esEquipo(me.id)) continue;                      // el mismo filtro del partido de las estrellas
      const a = (acc[me.id] = acc[me.id] || { w: 0, l: 0, ort: 0, drt: 0, n: 0 });
      if (me.pts > rival.pts) a.w++; else a.l++;
      if (me.ff && me.ff.ortg) { a.ort += me.ff.ortg; a.drt += (rival.ff && rival.ff.ortg) || 0; a.n++; }
      (series[me.id] = series[me.id] || []).push({
        d: String(g.date).slice(0, 10), pj: a.w + a.l, w: a.w, l: a.l,
        net: a.n ? r1((a.ort - a.drt) / a.n) : null,
      });
    }
  }
  const st = standings(C);
  const rows = (st ? st.rows : []).slice(0, top).map((r) => ({
    id: r.id, abbr: r.abbr, name: r.name, logo: r.logo, seed: r.seed, w: r.w, l: r.l, net: r.net,
    points: series[r.id] || [],
  }));
  return { league: C.league, season: C.season, rows, last_game: st ? st.last_game : null,
    metric: 'diferencial neto acumulado por 100 posesiones',
    why: 'cada punto es el acumulado del equipo TRAS ese partido, no el partido suelto: por eso la línea se aplana según avanza la temporada.' };
}

module.exports = { standings, bracket, evolution, PLAYOFF };
