// basketball-engine/possessions.js — DE PLAY-BY-PLAY A JUEGO ENTENDIDO (15-ago).
//
// ESPN sirve ~450 jugadas por partido con tipo, reloj, marcador, autor, coordenadas de tiro y SUSTITUCIONES.
// Este módulo las convierte en lo que el modelo necesita de verdad: posesiones, four factors, perfil de tiro
// por zona y —lo que casi nadie hace— separación entre posesiones COMPETITIVAS y garbage time.
//
// POR QUÉ IMPORTA EL GARBAGE TIME: un 130-98 contamina las medias. Los últimos 8 minutos con suplentes no
// describen a ninguno de los dos equipos, y si entran al rating el modelo aprende ruido. Todos los sistemas
// serios los sacan; nosotros marcamos el punto de corte y guardamos AMBAS versiones para poder comparar.
//
// PURO: sin red, sin disco, sin db. Entra el summary normalizado del colector, sale un registro derivado
// COMPACTO — el crudo pesa ~1MB por partido y no tiene sentido versionarlo; lo derivado son ~8KB.
'use strict';

// segundos jugados al terminar cada periodo (NBA 4×12, NCAA 2×20, prórrogas de 5)
function periodSecs(L, period) {
  const reg = L.periods, len = (L.minutes / reg) * 60;
  return period <= reg ? period * len : reg * len + (period - reg) * (L.otMin * 60);
}
// segundos transcurridos desde el salto inicial, a partir de (periodo, reloj que cuenta hacia atrás)
function elapsed(L, period, clock) {
  const m = String(clock || '').match(/(\d+):(\d+)/);
  const rem = m ? (+m[1] * 60 + +m[2]) : 0;
  const reg = L.periods, len = (L.minutes / reg) * 60;
  const plen = period <= reg ? len : L.otMin * 60;
  return periodSecs(L, period - 1) + (plen - rem);
}

// ---- ZONA DE TIRO desde las coordenadas de ESPN ----------------------------------------------------------
// GEOMETRÍA CALIBRADA CONTRA LOS DATOS, no supuesta (15-ago). Se midieron 238 mates/bandejas —tiros que por
// definición salen del aro— y su mediana cae en (25, 1); los 309 triples de la misma muestra tienen mediana
// y=22 y x repartida de 1 a 49. O sea: el aro está en (25, 1), no en (25, 5) como asumí primero. Con el
// origen mal puesto, la mitad de los tiros al aro se clasificaban como media distancia y el perfil de tiro
// de todos los equipos salía deformado.
// La taxonomía es la que mueve la aguja: un triple de esquina y uno frontal NO valen lo mismo, y el midrange
// es el tiro que separa ataques buenos de malos. No se busca precisión de tracking, sino honestidad.
const HOOP_X = 25, HOOP_Y = 1;
function shotZone(x, y, attempted) {
  if (x == null || y == null) return attempted === 3 ? 'atb3' : 'short_mid';
  const dx = x - HOOP_X, dy = y - HOOP_Y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (attempted === 3) {
    if (dy <= 8 && Math.abs(dx) >= 20) return 'corner3';   // esquina: línea más corta, el triple más eficiente
    return 'atb3';                                         // por encima de la línea de fondo
  }
  if (d <= 4.5) return 'rim';
  if (d <= 14) return 'short_mid';
  return 'long_mid';
}
const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };
const madeAtt = (s) => { const m = String(s || '').match(/(\d+)-(\d+)/); return m ? { m: +m[1], a: +m[2] } : { m: 0, a: 0 }; };

// ---- POSESIONES ------------------------------------------------------------------------------------------
// Fórmula estándar de la literatura (Oliver), la misma que usan Basketball-Reference y Cleaning the Glass:
//   POS = FGA − ORB + TOV + 0.44·FTA
// El 0.44 estima qué fracción de tiros libres termina una posesión (los and-one y el 1º de 2 no la terminan).
// Se promedian ambos equipos porque en un partido las posesiones son casi iguales por construcción y el
// promedio cancela el ruido de los rebotes ofensivos mal atribuidos.
function possessions(a, b) {
  const p = (t) => t.fga - t.orb + t.tov + 0.44 * t.fta;
  return (p(a) + p(b)) / 2;
}

// ---- GARBAGE TIME ----------------------------------------------------------------------------------------
// Regla explícita en vez de heurística vaga: la basura empieza cuando la diferencia supera un umbral que se
// afloja según queda menos tiempo, y ya no vuelve atrás. Umbrales de referencia del uso de la industria:
// 25 puntos a falta de 12', 20 a falta de 9', 15 a falta de 6', 10 a falta de 3'.
//
// Dos ajustes sobre esa lista: se cae la regla de "10 puntos a falta de 3'" (con 3 minutos por jugar y 10
// arriba se sigue faltando y presionando: eso es un final competitivo, no un partido resuelto) y los
// umbrales se ESCALAN por el nivel de anotación de la liga (L.ppg contra los ~115 de la NBA), porque 25
// puntos sobre 115 y 25 sobre 85 no describen la misma ventaja.
//
// ESTADO HONESTO (medido, no supuesto): aun con esos ajustes la regla marca el 64% de los partidos WNBA
// —era 62% antes—, o sea que NO quedó resuelta. Un criterio de solo-marcador flaggea de más se lo afine
// como se lo afine. La detección buena necesita saber QUIÉN está en pista (basura de verdad = suplentes de
// los dos lados), y eso se reconstruye desde las sustituciones del play-by-play en el módulo de quintetos.
// Hasta entonces `garbage` es INFORMATIVO: se guarda y se muestra, pero el rating todavía no lo usa para
// filtrar posesiones — filtrar con un criterio que se come 2 de cada 3 partidos sería peor que no filtrar.
function garbageStart(L, plays) {
  const total = periodSecs(L, L.periods);
  const k = (L.ppg || 115) / 115;
  const rules = [[12 * 60, 25 * k], [9 * 60, 20 * k], [6 * 60, 15 * k]];
  for (const p of plays) {
    if (!p.period || p.period < L.periods) continue;              // solo en el último periodo reglamentario
    const el = elapsed(L, p.period, p.clock);
    const rem = total - el;
    if (rem < 0) continue;
    const diff = Math.abs((p.home_score || 0) - (p.away_score || 0));
    for (const [t, d] of rules) if (rem <= t && diff >= d) return { sec: el, period: p.period, clock: p.clock, diff };
  }
  return null;
}

// ---- DERIVADO DE UN PARTIDO ------------------------------------------------------------------------------
// Entra: game (del scoreboard) + sum (del summary). Sale: un registro compacto listo para el motor.
function deriveGame(game, sum, L) {
  if (!game || !sum) return null;
  const byId = {}; for (const t of (sum.team_stats || [])) byId[t.team_id] = t;
  const side = (g, ts) => {
    const fg = madeAtt(ts['fieldGoalsMade-fieldGoalsAttempted']), tp = madeAtt(ts['threePointFieldGoalsMade-threePointFieldGoalsAttempted']);
    const ft = madeAtt(ts['freeThrowsMade-freeThrowsAttempted']);
    return {
      id: g.id, abbr: g.abbr, pts: g.score, line: g.line || [],
      fgm: fg.m, fga: fg.a, tpm: tp.m, tpa: tp.a, ftm: ft.m, fta: ft.a,
      orb: num(ts.offensiveRebounds), drb: num(ts.defensiveRebounds), reb: num(ts.totalRebounds),
      ast: num(ts.assists), stl: num(ts.steals), blk: num(ts.blocks), tov: num(ts.totalTurnovers || ts.turnovers),
      pf: num(ts.fouls), paint: num(ts.pointsInPaint), fastbreak: num(ts.fastBreakPoints),
      pts_off_tov: num(ts.pointsConcededOffTurnovers),
    };
  };
  const H = side(game.home, byId[game.home.id] || {}), A = side(game.away, byId[game.away.id] || {});
  if (!(H.fga > 0 && A.fga > 0)) return null;                     // sin box score utilizable
  const pos = possessions(H, A);
  // FOUR FACTORS (Oliver): explican ~90% de la varianza de un partido. Son la base del rating del motor.
  const ff = (t, o) => ({
    ortg: pos > 0 ? +(100 * t.pts / pos).toFixed(2) : null,        // puntos por 100 posesiones
    efg: t.fga > 0 ? +((t.fgm + 0.5 * t.tpm) / t.fga).toFixed(4) : null,   // tiro de campo con el triple pesado
    tov_pct: pos > 0 ? +(t.tov / pos).toFixed(4) : null,
    orb_pct: (t.orb + o.drb) > 0 ? +(t.orb / (t.orb + o.drb)).toFixed(4) : null,
    ftr: t.fga > 0 ? +(t.fta / t.fga).toFixed(4) : null,           // cuánto pisa la línea de personal
    tpa_rate: t.fga > 0 ? +(t.tpa / t.fga).toFixed(4) : null,
  });
  // tiros con zona (para mapa de tiro, calidad de tiro y el simulador)
  const shots = [];
  for (const p of (sum.plays || [])) {
    // los TIROS LIBRES también vienen con shootingPlay=true y pointsAttempted=1: si entran acá se les asigna
    // una zona (siempre la misma, la del aro) y deforman el perfil de tiro del equipo — el primer conteo daba
    // 33% de triples cuando la liga está en ~42% justamente por esto. Solo tiros de campo: 2 o 3 puntos.
    if (!p.shooting || (p.attempted !== 2 && p.attempted !== 3)) continue;
    shots.push({ t: p.team_id, a: (p.athletes || [])[0] || null, z: shotZone(p.x, p.y, p.attempted),
      v: p.attempted, m: p.scoring ? 1 : 0, s: p.period ? elapsed(L, p.period, p.clock) : null });
  }
  const gt = garbageStart(L, sum.plays || []);
  // líneas de jugador ya en números (el box score de ESPN viene como texto "15-22")
  const players = (sum.players || []).filter(p => !p.dnp).map(p => {
    const fg = madeAtt(p.FG), tp = madeAtt(p['3PT']), ft = madeAtt(p.FT);
    return { id: p.id, t: p.team_id, n: p.name, pos: p.pos, st: p.starter ? 1 : 0,
      min: num(p.MIN), pts: num(p.PTS), reb: num(p.REB), ast: num(p.AST), tov: num(p.TO),
      stl: num(p.STL), blk: num(p.BLK), pf: num(p.PF), pm: num(p['+/-']),
      fgm: fg.m, fga: fg.a, tpm: tp.m, tpa: tp.a, ftm: ft.m, fta: ft.a,
      orb: num(p.OREB), drb: num(p.DREB) };
  });
  return {
    id: game.id, league: game.league, date: game.date, season: game.season, season_type: game.season_type,
    neutral: !!game.neutral,
    home: { ...H, ff: ff(H, A) }, away: { ...A, ff: ff(A, H) },
    poss: +pos.toFixed(2), pace: +(pos * (L.minutes / (L.minutes + (Math.max(0, (game.home.line || []).length - L.periods) * L.otMin))) ).toFixed(2),
    ot: Math.max(0, (game.home.line || []).length - L.periods),
    garbage: gt ? { sec: gt.sec, diff: gt.diff } : null,
    players, shots,
  };
}

module.exports = { deriveGame, possessions, shotZone, garbageStart, elapsed, periodSecs };
