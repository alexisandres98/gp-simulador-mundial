// gpIntelligence.js — capa v2 del SANDBOX "Simula cualquier cruce".
// NO sustituye al modelo base ni se despliega en el resto de la plataforma: es un piloto de cómo
// se vería la v2 (Elo+ruido+Poisson+Monte Carlo + capa de contexto total) integrada.
//
// Marco (referencia: metodología de analistas profesionales — Dixon-Coles attack/defence + xG +
// forma con decaimiento, disponibilidad de jugadores clave, descanso/carga, calidad de plantilla):
//  • PRIOR: Elo neutral → Poisson/Dixon-Coles/calibración → Monte Carlo. Encapsula fuerza global.
//  • CAPA DE CONTEXTO: traduce señales reales a (a) un AJUSTE DE ELO acotado a ±CTX_CAP y
//    (b) un PERFIL DE GOLES (ataque/defensa) que hace el xG ESPECÍFICO POR EQUIPO, no solo
//    función del Elo. Así el total de goles proyectado refleja el estilo real de cada selección.
//  CTX_CAP = 55 = ELO_NOISE: "dónde, dentro de la banda de forma del equipo, lo sitúan los datos".
//  Todo es trazable a una señal mostrada al usuario. Determinístico, sin IA externa.

const CTX_CAP = 55;            // tope del ajuste de contexto por equipo (= ELO_NOISE)
const FORM_BASELINE_PPG = 1.5; // PPG "neutro" de referencia
const BASE_TEAM_GOALS = 1.3;   // goles por equipo en un partido medio (= TOTAL_GOALS/2)
const FORM_GOAL_BETA = 0.40;   // peso del perfil ataque/defensa de forma vs xG-Elo (prior domina)
const SQUAD_BASELINE = 6.90;   // rating medio de referencia (API-Football)

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = p => (p * 100).toFixed(1) + '%';
const pct0 = p => Math.round(p * 100) + '%';
const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Perfil de goles del equipo a partir de su forma reciente (ataque/defensa relativos a la media).
function goalProfile(form) {
  if (!form || form.played < 3) return { attackMult: 1, defenseMult: 1, has: false };
  return {
    attackMult: clamp((form.avgFor != null ? form.avgFor : BASE_TEAM_GOALS) / BASE_TEAM_GOALS, 0.6, 1.7),
    defenseMult: clamp((form.avgAgainst != null ? form.avgAgainst : BASE_TEAM_GOALS) / BASE_TEAM_GOALS, 0.6, 1.7),
    has: true,
  };
}

// Combina las tasas xG implícitas por Elo con el perfil ataque/defensa de forma de AMBOS equipos.
// expA = media * (ataque de A) * (fragilidad defensiva de B). Devuelve [λA, λB, beta usado].
function adjustedLambdas(lAelo, lBelo, profA, profB) {
  const beta = (profA.has && profB.has) ? FORM_GOAL_BETA : 0;
  const expA = BASE_TEAM_GOALS * profA.attackMult * profB.defenseMult;
  const expB = BASE_TEAM_GOALS * profB.attackMult * profA.defenseMult;
  const lA = clamp(lAelo * (1 - beta) + expA * beta, 0.3, 4.6);
  const lB = clamp(lBelo * (1 - beta) + expB * beta, 0.3, 4.6);
  return [lA, lB, beta];
}

// Mercados de goles/totales desde la distribución Monte Carlo + las tasas Poisson por equipo.
function goalsMarkets(mc, lA, lB) {
  const overLine = x => mc.totals.filter(t => t.goals >= x + 1).reduce((s, t) => s + t.p, 0);
  const ml = mc.totals.slice().sort((a, b) => b.p - a.p)[0] || { goals: null, p: 0 };
  const teamDist = l => { const p0 = Math.exp(-l), p1 = p0 * l, p2 = p1 * l / 2; return { g0: p0, g1: p1, g2: p2, g3: Math.max(0, 1 - p0 - p1 - p2) }; };
  return {
    over15: overLine(1), over25: overLine(2), over35: overLine(3),
    under25: 1 - overLine(2),
    mostLikelyTotal: ml.goals, mostLikelyTotalP: ml.p,
    btts: mc.btts, avgTotal: mc.avgTotal,
    teamA: teamDist(lA), teamB: teamDist(lB),
  };
}

// ---------- SEÑALES DE CONTEXTO de un equipo → ajuste de Elo + perfil de goles ----------
// teamCtx: getTeamContext (recentForm, injuries, keyPlayers, tactical...). extra: { squadRating, restDays, oppRestDays }.
function contextSignals(teamCtx, teamName, extra = {}) {
  const signals = [];
  const prof = goalProfile(teamCtx && teamCtx.recentForm);
  if (!teamCtx) {
    return { delta: 0, signals: [{ key: 'nodata', label: 'Sin datos de contexto', detail: 'Solo modelo base para ' + teamName, eloImpact: 0, dir: 'flat' }], hasData: false, goalProfile: prof };
  }
  const f = teamCtx.recentForm;

  // 1) FORMA RECIENTE (PPG + diferencia de gol)
  let formImpact = 0;
  if (f && f.played >= 3) {
    const ppg = f.points / f.played;
    const ppgImpact = clamp((ppg - FORM_BASELINE_PPG) * 22, -30, 30);
    const gd = (f.avgFor || 0) - (f.avgAgainst || 0);
    const gdImpact = clamp(gd * 9, -16, 16);
    formImpact = clamp(ppgImpact + gdImpact, -40, 40);
    const wd = f.results ? `${f.results.filter(r => r === 'W').length}V-${f.results.filter(r => r === 'D').length}E-${f.results.filter(r => r === 'L').length}D` : '';
    signals.push({ key: 'form', label: 'Forma reciente', detail: `Últimos ${f.played}: ${wd} · ${(f.avgFor || 0).toFixed(1)} GF / ${(f.avgAgainst || 0).toFixed(1)} GC por partido`, eloImpact: Math.round(formImpact), dir: formImpact > 3 ? 'up' : formImpact < -3 ? 'down' : 'flat' });
  }

  // 2) RACHA
  let streakImpact = 0;
  if (f && f.streak && /^\d+[WDL]$/.test(f.streak)) {
    const n = parseInt(f.streak), kind = f.streak.slice(-1);
    if (kind === 'W' && n >= 2) streakImpact = clamp(n * 4, 0, 14);
    else if (kind === 'L' && n >= 2) streakImpact = -clamp(n * 4, 0, 14);
    if (streakImpact) signals.push({ key: 'streak', label: 'Racha', detail: kind === 'W' ? `${n} victorias al hilo` : `${n} derrotas al hilo`, eloImpact: Math.round(streakImpact), dir: streakImpact > 0 ? 'up' : 'down' });
  }

  // 3) DISPONIBILIDAD — bajas ponderadas por JUGADOR CLAVE (lesión/suspensión/duda)
  let availImpact = 0;
  const keyNames = new Set((teamCtx.keyPlayers || []).map(p => normName(p.name)));
  const inj = (teamCtx.injuries || []).filter(i => ['injured', 'suspended', 'doubt'].includes(i.status));
  if (inj.length) {
    let pen = 0; const keyHits = [];
    inj.forEach(i => {
      const isKey = keyNames.has(normName(i.player));
      pen += i.status === 'doubt' ? (isKey ? 6 : 3) : (isKey ? 15 : 7);
      if (isKey) keyHits.push(i.player);
    });
    availImpact = -clamp(pen, 0, 42);
    signals.push({ key: 'avail', label: keyHits.length ? 'Bajas de peso' : 'Bajas y dudas', detail: `${inj.length} ausencia(s)/duda(s)${keyHits.length ? ` · clave: ${keyHits.slice(0, 2).join(', ')}` : ''}`, eloImpact: Math.round(availImpact), dir: 'down' });
  } else if (teamCtx.providerStatus && teamCtx.providerStatus.usedApiFootball) {
    signals.push({ key: 'avail', label: 'Plantel completo', detail: 'Sin bajas relevantes confirmadas', eloImpact: 0, dir: 'flat' });
  }

  // 4) CALIDAD DE PLANTILLA — rating medio del XI más usado (temporada)
  let squadImpact = 0;
  if (extra.squadRating && extra.squadRating.avg) {
    squadImpact = clamp((extra.squadRating.avg - SQUAD_BASELINE) * 30, -22, 22);
    if (Math.abs(squadImpact) >= 3) signals.push({ key: 'squad', label: 'Calidad de plantilla', detail: `Rating medio del XI ~${extra.squadRating.avg.toFixed(2)} (${extra.squadRating.n} jugadores, temporada)`, eloImpact: Math.round(squadImpact), dir: squadImpact > 0 ? 'up' : 'down' });
  }

  // 5) SOLIDEZ DEFENSIVA (porterías a cero recientes)
  let solidImpact = 0;
  if (f && f.played >= 3 && f.cleanSheets != null) {
    const csRate = f.cleanSheets / f.played;
    if (csRate >= 0.5) { solidImpact = clamp((csRate - 0.4) * 30, 0, 12); signals.push({ key: 'solid', label: 'Solidez defensiva', detail: `${f.cleanSheets} portería(s) a cero en ${f.played}`, eloImpact: Math.round(solidImpact), dir: 'up' }); }
    else if (csRate === 0 && (f.avgAgainst || 0) >= 1.6) { solidImpact = -clamp(((f.avgAgainst) - 1.2) * 12, 0, 12); signals.push({ key: 'solid', label: 'Fragilidad atrás', detail: `Encaja ${(f.avgAgainst).toFixed(1)} por partido, sin vallas invictas`, eloImpact: Math.round(solidImpact), dir: 'down' }); }
  }

  // 6) DESCANSO / CARGA — días desde el último partido vs el rival
  let restImpact = 0;
  if (extra.restDays != null && extra.oppRestDays != null) {
    const diff = extra.restDays - extra.oppRestDays;
    restImpact = clamp(diff * 2.5, -10, 10);
    if (Math.abs(restImpact) >= 3) signals.push({ key: 'rest', label: restImpact > 0 ? 'Mejor descanso' : 'Menos descanso', detail: `${extra.restDays}d desde su último partido vs ${extra.oppRestDays}d del rival`, eloImpact: Math.round(restImpact), dir: restImpact > 0 ? 'up' : 'down' });
  }

  const delta = clamp(formImpact + streakImpact + availImpact + squadImpact + solidImpact + restImpact, -CTX_CAP, CTX_CAP);
  return { delta, signals, hasData: signals.some(s => s.key !== 'nodata'), goalProfile: prof };
}

// ---------- ANÁLISIS INTEGRAL del cruce (determinístico, estilo analista) ----------
function buildH2HAnalysis(args) {
  const { a, b, base, v2, delta, sig, mc, goals, beta } = args;
  const favSide = v2.aWin > v2.bWin ? 'a' : 'b';
  const fav = favSide === 'a' ? a : b, dog = favSide === 'a' ? b : a;
  const favProb = favSide === 'a' ? v2.aWin : v2.bWin;
  const dogProb = favSide === 'a' ? v2.bWin : v2.aWin;
  const baseFavProb = favSide === 'a' ? base.aWin : base.bWin;
  const parity = Math.abs(v2.aWin - v2.bWin) < 0.08 && v2.draw > 0.24;

  const ctxAgrees = Math.sign(v2.aWin - v2.bWin) === Math.sign(base.aWin - base.bWin) || Math.abs(base.aWin - base.bWin) < 0.04;
  let confidence = 'Media';
  if (parity) confidence = 'Baja';
  else if (favProb >= 0.6 && ctxAgrees) confidence = 'Alta';
  else if (favProb >= 0.48 && ctxAgrees) confidence = 'Media';
  else confidence = 'Baja';

  let verdictLabel;
  if (parity) verdictLabel = 'CRUCE PAREJO';
  else if (favProb >= 0.62) verdictLabel = 'FAVORITO CLARO';
  else if (favProb >= 0.5) verdictLabel = 'LIGERO FAVORITO';
  else verdictLabel = 'SIN FAVORITO NETO';

  const shift = Math.round((favProb - baseFavProb) * 100);
  const shiftPhrase = parity
    ? 'el contexto no rompe la paridad: ninguno se despega'
    : shift > 1 ? `el contexto refuerza a ${fav.name} (+${shift} pts sobre el modelo base)`
    : shift < -1 ? `el contexto recorta a ${fav.name} (${shift} pts frente al modelo base), pero sigue al frente`
    : `el contexto apenas mueve la aguja: confirma la lectura del modelo base`;

  const goalsPhrase = goals
    ? ` El modelo proyecta ~${goals.avgTotal.toFixed(2)} goles (Over 2.5 al ${pct0(goals.over25)}); total más probable: ${goals.mostLikelyTotal} ${goals.mostLikelyTotal === 1 ? 'gol' : 'goles'}.`
    : '';

  const verdict = parity
    ? `El modelo base (Elo + Monte Carlo, ${mc.n.toLocaleString('es')} simulaciones) ya veía un duelo cerrado, y ${shiftPhrase}. ${a.name} ${pct(v2.aWin)} · empate ${pct(v2.draw)} · ${b.name} ${pct(v2.bWin)}: se resuelve por detalles. Marcador más repetido: ${mc.topScores[0].score} (${pct(mc.topScores[0].p)}).${goalsPhrase}`
    : `El modelo base abre con ${fav.name} a ${pct(baseFavProb)}. Al integrar el contexto —forma, bajas de peso, plantilla, descanso—, ${shiftPhrase}: GP Intelligence cierra en ${fav.name} ${pct(favProb)}, empate ${pct(v2.draw)}, ${dog.name} ${pct(dogProb)}. Marcador más probable: ${mc.topScores[0].score} (${pct(mc.topScores[0].p)}).${goalsPhrase}`;

  const factors = [];
  (sig.a || []).forEach(s => { if (s.key !== 'nodata') factors.push({ side: 'a', team: a.name, flag: a.flag, ...s }); });
  (sig.b || []).forEach(s => { if (s.key !== 'nodata') factors.push({ side: 'b', team: b.name, flag: b.flag, ...s }); });
  factors.sort((x, y) => Math.abs(y.eloImpact) - Math.abs(x.eloImpact));

  const scoreNarr = `El reparto de ${mc.n.toLocaleString('es')} simulaciones (con el contexto ya integrado) deja ${mc.topScores.slice(0, 3).map(s => `${s.score} (${pct0(s.p)})`).join(', ')} como resultados más frecuentes. ${goals ? `Promedio ${goals.avgTotal.toFixed(2)} goles; ambos marcan en el ${pct0(goals.btts)}.` : ''}`;

  const xFactors = [];
  if (beta > 0) xFactors.push('El xG es específico por equipo: combina la fuerza Elo con el ritmo goleador y la solidez reales de cada selección (no solo el ranking).');
  if (mc.draw >= 0.27) xFactors.push(`Alta tasa de empate (${pct0(mc.draw)}): el empate es un resultado vivo.`);
  if (goals && goals.over25 >= 0.55) xFactors.push(`Pinta partido de goles: Over 2.5 al ${pct0(goals.over25)} y Over 1.5 al ${pct0(goals.over15)}.`);
  if (goals && goals.under25 >= 0.58) xFactors.push(`Pinta cerrado: Under 2.5 al ${pct0(goals.under25)}.`);
  if (Math.abs(delta.a) >= 25 || Math.abs(delta.b) >= 25) xFactors.push('El contexto pesa fuerte: la forma actual cambia de manera notable la foto que daría solo el ranking.');
  if (!xFactors.length) xFactors.push('Sin alertas situacionales: el cruce se ajusta a lo que dicta el modelo.');

  const whatChanges = [];
  whatChanges.push(`Una baja de última hora en ${fav.name} estrecharía el margen rápidamente.`);
  if (favProb < 0.62) whatChanges.push(`Si ${dog.name} llega con su once de gala y enchufado, esto se vuelve moneda al aire.`);
  whatChanges.push('Cancha neutral: no hay factor localía. Si fuese sede de un anfitrión, súmale ~75 Elo de ventaja.');

  return {
    headline: { favSide, favName: fav.name, favFlag: fav.flag, favProb, dogName: dog.name, dogProb, drawProb: v2.draw, confidence, verdictLabel, verdict, parity },
    decomposition: {
      baseFavProb, v2FavProb: favProb, shift,
      baseLine: { aWin: base.aWin, draw: base.draw, bWin: base.bWin },
      v2Line: { aWin: v2.aWin, draw: v2.draw, bWin: v2.bWin },
      deltaA: Math.round(delta.a), deltaB: Math.round(delta.b),
    },
    factors,
    monteCarlo: { ...mc, narrative: scoreNarr },
    xFactors, whatChanges,
  };
}

module.exports = { contextSignals, buildH2HAnalysis, adjustedLambdas, goalsMarkets, CTX_CAP };
