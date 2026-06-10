// Motor de probabilidades: modelo Elo→goles (Poisson) + Monte Carlo del torneo completo.
const { TEAMS, GROUPS, GROUP_FIXTURES, KNOCKOUT } = require('./data/tournament');

const HOME_BONUS = 75;        // ventaja de local para los 3 anfitriones (todo el torneo se juega en su suelo)
const TOTAL_GOALS = 2.6;      // media de goles esperada en un partido parejo
const K_WC = 60;              // factor K de eloratings.net para Copas del Mundo
const ELO_NOISE = 55;         // incertidumbre del rating por torneo simulado (la "forma" real del equipo)

const teamById = Object.fromEntries(TEAMS.map(t => [t.id, t]));

function winExpectancy(diff) {
  return 1 / (1 + Math.pow(10, -diff / 400));
}

function effElo(elos, id) {
  return elos[id] + (teamById[id].host ? HOME_BONUS : 0);
}

// Tasas de gol de cada lado a partir de la expectativa Elo
function lambdas(eloH, eloA) {
  const we = winExpectancy(eloH - eloA);
  const lh = Math.max(0.12, Math.min(4.8, TOTAL_GOALS * Math.pow(we, 0.93)));
  const la = Math.max(0.12, Math.min(4.8, TOTAL_GOALS * Math.pow(1 - we, 0.93)));
  return [lh, la];
}

function poissonSample(lambda, rng) {
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= rng(); } while (p > L);
  return k - 1;
}

function poissonPmf(lambda, k) {
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) p *= lambda / i;
  return p;
}

// Probabilidades 1X2 exactas (rejilla Poisson 0..12) — para mostrar por partido
function matchProbs(eloH, eloA) {
  const [lh, la] = lambdas(eloH, eloA);
  let pH = 0, pD = 0, pA = 0;
  const ph = [], pa = [];
  for (let k = 0; k <= 12; k++) { ph.push(poissonPmf(lh, k)); pa.push(poissonPmf(la, k)); }
  let best = { p: 0, h: 0, a: 0 };
  for (let h = 0; h <= 12; h++) for (let a = 0; a <= 12; a++) {
    const p = ph[h] * pa[a];
    if (h > a) pH += p; else if (h === a) pD += p; else pA += p;
    if (p > best.p) best = { p, h, a };
  }
  const s = pH + pD + pA;
  return { home: pH / s, draw: pD / s, away: pA / s, xgHome: lh, xgAway: la, likelyScore: `${best.h}-${best.a}` };
}

// Simula un partido. Si hay marcador en vivo, condiciona en el marcador actual y simula el resto.
function simMatch(eloH, eloA, rng, live) {
  const [lh, la] = lambdas(eloH, eloA);
  if (live && live.status === 'live') {
    const remain = Math.max(0, (90 - (live.minute || 0)) / 90);
    return [live.hg + poissonSample(lh * remain, rng), live.ag + poissonSample(la * remain, rng)];
  }
  return [poissonSample(lh, rng), poissonSample(la, rng)];
}

// Penales: ligera ventaja al mejor Elo
function penaltyWin(eloH, eloA, rng) {
  const p = Math.min(0.65, Math.max(0.35, 0.5 + (eloH - eloA) / 4000));
  return rng() < p;
}

function cmpRows(a, b) {
  return b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || (a._rnd - b._rnd);
}

// Asigna los 8 mejores terceros a los slots T3 respetando los grupos permitidos (backtracking)
function assignThirds(thirds, slots) {
  const order = slots.map((s, i) => i).sort((x, y) => slots[x].allowed.length - slots[y].allowed.length);
  const assign = new Array(slots.length).fill(null);
  const used = new Set();
  function bt(i) {
    if (i === order.length) return true;
    const slot = slots[order[i]];
    for (const th of thirds) {
      if (used.has(th) || !slot.allowed.includes(teamById[th].group)) continue;
      used.add(th); assign[order[i]] = th;
      if (bt(i + 1)) return true;
      used.delete(th); assign[order[i]] = null;
    }
    return false;
  }
  if (!bt(0)) {
    // sin emparejamiento perfecto (raro): asignación greedy ignorando restricciones sobrantes
    const left = thirds.filter(t => !used.has(t));
    assign.forEach((a, i) => { if (!a) assign[i] = left.shift(); });
  }
  return assign;
}

/**
 * Corre el Monte Carlo completo.
 * @param elos  ratings actuales {id: elo}
 * @param results resultados reales: { 'GA1': {hg,ag,status,minute}, '79': {home,away,hg,ag,pens,status,minute}, ... }
 * @param N número de torneos simulados
 */
function simulateTournament(elos, results, N = 10000) {
  const stats = {};
  TEAMS.forEach(t => stats[t.id] = {
    champion: 0, final: 0, third: 0, fourth: 0, sf: 0, qf: 0, r16: 0, r32: 0,
    groupOut: 0, groupWin: 0, groupSecond: 0, samples: [],
  });
  const koOpp = {}; // oponentes más comunes en R32 por equipo
  let seed = 42;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  for (let n = 0; n < N; n++) {
    // Cada torneo simulado perturba el Elo de cada equipo (forma, lesiones, factores no medidos)
    const simElos = {};
    for (const t of TEAMS) {
      const u1 = Math.max(1e-9, rng()), u2 = rng();
      const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      simElos[t.id] = elos[t.id] + gauss * ELO_NOISE;
    }
    const simLog = {}; // teamId -> [{vs, gf, ga, stage}]
    const log = (id, vs, gf, ga, stage, pen) => {
      (simLog[id] = simLog[id] || []).push({ vs, gf, ga, stage, pen });
    };

    // ---- fase de grupos ----
    const tables = {};
    GROUPS.forEach(g => {
      tables[g] = {};
      TEAMS.filter(t => t.group === g).forEach(t =>
        tables[g][t.id] = { id: t.id, pts: 0, gf: 0, ga: 0, _rnd: rng() });
    });
    for (const f of GROUP_FIXTURES) {
      const r = results[f.id];
      let hg, ag;
      if (r && r.status === 'final') { hg = r.hg; ag = r.ag; }
      else [hg, ag] = simMatch(effElo(simElos, f.home), effElo(simElos, f.away), rng, r);
      const H = tables[f.group][f.home], A = tables[f.group][f.away];
      H.gf += hg; H.ga += ag; A.gf += ag; A.ga += hg;
      if (hg > ag) H.pts += 3; else if (hg < ag) A.pts += 3; else { H.pts++; A.pts++; }
      log(f.home, f.away, hg, ag, 'group'); log(f.away, f.home, ag, hg, 'group');
    }
    const firsts = {}, seconds = {}, thirdRows = [];
    GROUPS.forEach(g => {
      const rows = Object.values(tables[g]).sort(cmpRows);
      firsts[g] = rows[0].id; seconds[g] = rows[1].id; thirdRows.push(rows[2]);
      stats[rows[0].id].groupWin++; stats[rows[1].id].groupSecond++;
      stats[rows[3].id].groupOut++;
    });
    thirdRows.sort(cmpRows);
    const qualThirds = thirdRows.slice(0, 8).map(r => r.id);
    thirdRows.slice(8).forEach(r => stats[r.id].groupOut++);

    const t3slots = KNOCKOUT.filter(k => k.away.t === 'T3').map(k => k.away);
    const t3assign = assignThirds(qualThirds, t3slots);
    const t3byMatch = {};
    KNOCKOUT.filter(k => k.away.t === 'T3').forEach((k, i) => t3byMatch[k.m] = t3assign[i]);

    // ---- eliminación directa ----
    const winners = {}, losers = {};
    const resolveSide = (side, m) => {
      if (side.t === 'W') return firsts[side.g];
      if (side.t === 'R') return seconds[side.g];
      if (side.t === 'T3') return t3byMatch[m];
      if (side.t === 'M') return winners[side.m];
      if (side.t === 'L') return losers[side.m];
    };
    for (const k of KNOCKOUT) {
      const home = resolveSide(k.home, k.m), away = resolveSide(k.away, k.m);
      if (k.stage === 'R32') {
        stats[home].r32++; stats[away].r32++;
        koOpp[home] = koOpp[home] || {}; koOpp[home][away] = (koOpp[home][away] || 0) + 1;
        koOpp[away] = koOpp[away] || {}; koOpp[away][home] = (koOpp[away][home] || 0) + 1;
      }
      const r = results[String(k.m)];
      let hg, ag, homeWins, pen = false;
      if (r && r.status === 'final' && r.home === home && r.away === away) {
        hg = r.hg; ag = r.ag;
        homeWins = hg > ag ? true : hg < ag ? false : !!r.pensHome;
        pen = hg === ag;
      } else {
        const live = (r && r.status === 'live' && r.home === home && r.away === away) ? r : null;
        [hg, ag] = simMatch(effElo(simElos, home), effElo(simElos, away), rng, live);
        if (hg === ag) { pen = true; homeWins = penaltyWin(effElo(simElos, home), effElo(simElos, away), rng); }
        else homeWins = hg > ag;
      }
      winners[k.m] = homeWins ? home : away;
      losers[k.m] = homeWins ? away : home;
      log(home, away, hg, ag, k.stage, pen ? (homeWins ? 'W' : 'L') : null);
      log(away, home, ag, hg, k.stage, pen ? (homeWins ? 'L' : 'W') : null);
      if (k.stage === 'R16') { stats[home].r16++; stats[away].r16++; }
      if (k.stage === 'QF') { stats[home].qf++; stats[away].qf++; }
      if (k.stage === 'SF') { stats[home].sf++; stats[away].sf++; }
      if (k.stage === '3RD') { stats[winners[k.m]].third++; stats[losers[k.m]].fourth++; }
      if (k.stage === 'FINAL') {
        stats[home].final++; stats[away].final++;
        const champ = winners[k.m];
        stats[champ].champion++;
        if (stats[champ].samples.length < 15) {
          stats[champ].samples.push(simLog[champ].map(x => ({
            vs: x.vs, score: `${x.gf}-${x.ga}`, stage: x.stage, pen: x.pen || null,
          })));
        }
      }
    }
  }

  // condensar
  const out = {};
  for (const t of TEAMS) {
    const s = stats[t.id];
    const p = s.champion / N;
    const ci = 1.96 * Math.sqrt(p * (1 - p) / N);
    const opps = Object.entries(koOpp[t.id] || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([id, c]) => ({ id, pct: c / Math.max(1, s.r32) }));
    out[t.id] = {
      champion: p, ciLow: Math.max(0, p - ci), ciHigh: Math.min(1, p + ci),
      counts: { champion: s.champion, final: s.final, third: s.third, fourth: s.fourth,
        sf: s.sf, qf: s.qf, r16: s.r16, r32: s.r32, groupOut: s.groupOut },
      reachFinal: s.final / N, reachSF: s.sf / N, reachQF: s.qf / N,
      reachR16: s.r16 / N, reachR32: s.r32 / N, outInGroups: s.groupOut / N,
      groupWin: s.groupWin / N, groupSecond: s.groupSecond / N,
      likelyR32Opponents: opps, samples: s.samples, sims: N,
    };
  }
  return out;
}

// Actualización Elo real (reglas eloratings.net) al registrar un resultado final
function eloUpdate(eloH, eloA, hg, ag, homeIsHost, awayIsHost) {
  const dh = homeIsHost ? HOME_BONUS : 0, da = awayIsHost ? HOME_BONUS : 0;
  const we = winExpectancy((eloH + dh) - (eloA + da));
  const W = hg > ag ? 1 : hg === ag ? 0.5 : 0;
  const margin = Math.abs(hg - ag);
  const G = margin <= 1 ? 1 : margin === 2 ? 1.5 : (11 + margin) / 8;
  const delta = K_WC * G * (W - we);
  return [Math.round((eloH + delta) * 10) / 10, Math.round((eloA - delta) * 10) / 10];
}

// Explicación en español de la probabilidad de un equipo
function explainTeam(team, elos, sim, allSims) {
  const t = teamById[team];
  const rivals = TEAMS.filter(x => x.group === t.group && x.id !== team);
  const avgRival = Math.round(rivals.reduce((s, r) => s + elos[r.id], 0) / 3);
  const rank = TEAMS.map(x => x.id).sort((a, b) => elos[b] - elos[a]).indexOf(team) + 1;
  const s = sim;
  const fmt = p => (p * 100).toFixed(1) + '%';
  const groupDiff = avgRival > 1850 ? 'muy exigente' : avgRival > 1750 ? 'competitivo' : avgRival > 1650 ? 'accesible' : 'favorable';
  const parts = [];
  parts.push(`${t.flag} ${t.name} tiene Elo ${Math.round(elos[team])} (#${rank} del torneo)${t.host ? ', con ventaja de local como anfitrión (+75 Elo efectivo)' : ''}.`);
  parts.push(`Su grupo ${t.group} es ${groupDiff}: rivales con Elo promedio de ${avgRival} (${rivals.map(r => `${teamById[r.id].name} ${Math.round(elos[r.id])}`).join(', ')}).`);
  parts.push(`En ${s.sims.toLocaleString()} torneos simulados ganó su grupo el ${fmt(s.groupWin)} de las veces, avanzó a 16avos el ${fmt(s.reachR32)} y quedó eliminado en grupos solo el ${fmt(s.outInGroups)}.`);
  if (s.likelyR32Opponents.length) {
    parts.push(`Sus cruces más probables en 16avos: ${s.likelyR32Opponents.map(o => `${teamById[o.id].name} (${fmt(o.pct)})`).join(', ')}.`);
  }
  parts.push(`Probabilidad de campeonato: ${fmt(s.champion)} (IC 95%: ${fmt(s.ciLow)}–${fmt(s.ciHigh)}). Llega a la final el ${fmt(s.reachFinal)}, a semifinales el ${fmt(s.reachSF)} y a cuartos el ${fmt(s.reachQF)}.`);
  const better = TEAMS.filter(x => allSims[x.id].champion > s.champion).length;
  parts.push(better === 0
    ? `Es el favorito número 1 del modelo.`
    : `Hay ${better} ${better === 1 ? 'equipo' : 'equipos'} con mejor probabilidad según el modelo.`);
  return parts.join(' ');
}

module.exports = { simulateTournament, matchProbs, eloUpdate, explainTeam, effElo, HOME_BONUS };
