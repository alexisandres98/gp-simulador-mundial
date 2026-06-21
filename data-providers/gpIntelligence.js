// gpIntelligence.js — capa v2 del SANDBOX "Simula cualquier cruce".
// NO sustituye al modelo base ni se despliega en el resto de la plataforma: es un piloto de cómo
// se vería la v2 (Elo+ruido+Poisson+Monte Carlo + capa de contexto total) integrada.
//
// Filosofía: el modelo base (Elo neutral → Poisson/DC/calibración → Monte Carlo) es el PRIOR.
// La capa de contexto traduce señales reales (forma, bajas, racha, solidez) a un AJUSTE DE ELO
// acotado a ±CTX_CAP. CTX_CAP = 55 = ELO_NOISE del torneo: es exactamente "dónde, dentro de la
// banda de incertidumbre de forma del equipo, lo sitúan los datos de hoy". Nada se inventa: cada
// punto de Elo movido es trazable a una señal mostrada al usuario. Determinístico, sin IA externa.

const CTX_CAP = 55;          // tope del ajuste de contexto por equipo (= ELO_NOISE)
const FORM_BASELINE_PPG = 1.5; // PPG "neutro" de referencia en partidos recientes

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = p => (p * 100).toFixed(1) + '%';
const pct0 = p => Math.round(p * 100) + '%';

// ---------- SEÑALES DE CONTEXTO de un equipo → ajuste de Elo ----------
// teamCtx: salida de getTeamContext (recentForm, injuries, keyPlayers, tactical, results...)
// Devuelve { delta, signals[] } donde cada signal = { key,label,detail,eloImpact,dir }.
function contextSignals(teamCtx, teamName) {
  const signals = [];
  if (!teamCtx) {
    return { delta: 0, signals: [{ key: 'nodata', label: 'Sin datos de contexto', detail: 'Solo modelo base disponible para ' + teamName, eloImpact: 0, dir: 'flat' }], hasData: false };
  }

  // --- 1) FORMA RECIENTE ---
  let formImpact = 0;
  const f = teamCtx.recentForm;
  if (f && f.played >= 3) {
    const ppg = f.points / f.played;                       // 0..3
    const ppgImpact = clamp((ppg - FORM_BASELINE_PPG) * 22, -30, 30);
    const gd = (f.avgFor || 0) - (f.avgAgainst || 0);       // diferencia de gol por partido
    const gdImpact = clamp(gd * 9, -16, 16);
    formImpact = clamp(ppgImpact + gdImpact, -40, 40);
    const wd = f.results ? `${f.results.filter(r => r === 'W').length}V-${f.results.filter(r => r === 'D').length}E-${f.results.filter(r => r === 'L').length}D` : '';
    signals.push({
      key: 'form', label: 'Forma reciente',
      detail: `Últimos ${f.played}: ${wd} · ${(f.avgFor || 0).toFixed(1)} GF / ${(f.avgAgainst || 0).toFixed(1)} GC por partido`,
      eloImpact: Math.round(formImpact), dir: formImpact > 3 ? 'up' : formImpact < -3 ? 'down' : 'flat',
    });
  }

  // --- 2) RACHA ---
  let streakImpact = 0;
  if (f && f.streak && /^\d+[WDL]$/.test(f.streak)) {
    const n = parseInt(f.streak), kind = f.streak.slice(-1);
    if (kind === 'W' && n >= 2) streakImpact = clamp(n * 4, 0, 14);
    else if (kind === 'L' && n >= 2) streakImpact = -clamp(n * 4, 0, 14);
    if (streakImpact) signals.push({
      key: 'streak', label: 'Racha',
      detail: kind === 'W' ? `${n} victorias al hilo` : `${n} derrotas al hilo`,
      eloImpact: Math.round(streakImpact), dir: streakImpact > 0 ? 'up' : 'down',
    });
  }

  // --- 3) BAJAS / LESIONES / SUSPENSIONES ---
  let availImpact = 0;
  const inj = (teamCtx.injuries || []).filter(i => ['injured', 'suspended', 'doubt'].includes(i.status));
  if (inj.length) {
    let pen = 0;
    inj.forEach(i => { pen += i.status === 'doubt' ? 3 : 8; });
    availImpact = -clamp(pen, 0, 38);
    const names = inj.slice(0, 3).map(i => i.player).filter(Boolean);
    signals.push({
      key: 'avail', label: 'Bajas y dudas',
      detail: `${inj.length} ausencia(s)/duda(s)${names.length ? ': ' + names.join(', ') + (inj.length > 3 ? '…' : '') : ''}`,
      eloImpact: Math.round(availImpact), dir: 'down',
    });
  } else if (teamCtx.providerStatus && (teamCtx.providerStatus.usedApiFootball)) {
    signals.push({ key: 'avail', label: 'Plantel disponible', detail: 'Sin bajas relevantes confirmadas', eloImpact: 0, dir: 'flat' });
  }

  // --- 4) SOLIDEZ DEFENSIVA (clean sheets recientes) ---
  let solidImpact = 0;
  if (f && f.played >= 3 && f.cleanSheets != null) {
    const csRate = f.cleanSheets / f.played;
    if (csRate >= 0.5) { solidImpact = clamp((csRate - 0.4) * 30, 0, 12); signals.push({ key: 'solid', label: 'Solidez defensiva', detail: `${f.cleanSheets} portería(s) a cero en ${f.played}`, eloImpact: Math.round(solidImpact), dir: 'up' }); }
    else if (csRate === 0 && (f.avgAgainst || 0) >= 1.6) { solidImpact = -clamp((f.avgAgainst - 1.2) * 12, 0, 12); signals.push({ key: 'solid', label: 'Fragilidad atrás', detail: `Encaja ${(f.avgAgainst).toFixed(1)} por partido, sin vallas invictas`, eloImpact: Math.round(solidImpact), dir: 'down' }); }
  }

  const delta = clamp(formImpact + streakImpact + availImpact + solidImpact, -CTX_CAP, CTX_CAP);
  return { delta, signals, hasData: signals.some(s => s.key !== 'nodata') };
}

// ---------- ANÁLISIS INTEGRAL del cruce (determinístico, estilo analista) ----------
// args: { a:{code,name,flag}, b:{...}, baseElo:{a,b}, base:{aWin,draw,bWin,likely,xgA,xgB},
//         v2:{aWin,draw,bWin,xgA,xgB,likely}, delta:{a,b}, sig:{a:[],b:[]}, mc, formA, formB }
function buildH2HAnalysis(args) {
  const { a, b, base, v2, delta, sig, mc } = args;
  const favSide = v2.aWin > v2.bWin ? 'a' : 'b';
  const fav = favSide === 'a' ? a : b, dog = favSide === 'a' ? b : a;
  const favProb = favSide === 'a' ? v2.aWin : v2.bWin;
  const dogProb = favSide === 'a' ? v2.bWin : v2.aWin;
  const baseFavProb = favSide === 'a' ? base.aWin : base.bWin;
  const parity = Math.abs(v2.aWin - v2.bWin) < 0.08 && v2.draw > 0.24;

  // Confianza: fuerza del favorito + si el contexto reforzó o contradijo al modelo base
  const ctxAgrees = Math.sign(v2.aWin - v2.bWin) === Math.sign(base.aWin - base.bWin) || Math.abs(base.aWin - base.bWin) < 0.04;
  let confidence = 'Media';
  if (parity) confidence = 'Baja';
  else if (favProb >= 0.6 && ctxAgrees) confidence = 'Alta';
  else if (favProb >= 0.48 && ctxAgrees) confidence = 'Media';
  else confidence = 'Baja';

  // Etiqueta del cruce
  let verdictLabel;
  if (parity) verdictLabel = 'CRUCE PAREJO';
  else if (favProb >= 0.62) verdictLabel = 'FAVORITO CLARO';
  else if (favProb >= 0.5) verdictLabel = 'LIGERO FAVORITO';
  else verdictLabel = 'SIN FAVORITO NETO';

  // Cuánto movió el contexto al favorito (en puntos porcentuales)
  const shift = Math.round((favProb - baseFavProb) * 100);
  const shiftPhrase = parity
    ? 'el contexto no rompe la paridad: ninguno de los dos se despega'
    : shift > 1 ? `el contexto refuerza a ${fav.name} (+${shift} pts sobre el modelo base)`
    : shift < -1 ? `el contexto recorta a ${fav.name} (${shift} pts frente al modelo base), pero sigue al frente`
    : `el contexto apenas mueve la aguja: confirma la lectura del modelo base`;

  // Veredicto en prosa — específico, con números reales (no genérico)
  const verdict = parity
    ? `El modelo base (Elo + Monte Carlo, ${mc.n.toLocaleString('es')} simulaciones) ya veía un duelo cerrado, y ${shiftPhrase}. ${a.name} ${pct(v2.aWin)} · empate ${pct(v2.draw)} · ${b.name} ${pct(v2.bWin)}: un cruce para resolverse por detalles. El marcador más repetido es ${mc.topScores[0].score} (${pct(mc.topScores[0].p)}).`
    : `El modelo base abre con ${fav.name} a ${pct(baseFavProb)}. Al integrar el contexto —forma, bajas y racha de ambos—, ${shiftPhrase}: GP Intelligence cierra en ${fav.name} ${pct(favProb)}, empate ${pct(v2.draw)}, ${dog.name} ${pct(dogProb)}. En las ${mc.n.toLocaleString('es')} simulaciones el marcador más probable es ${mc.topScores[0].score} (${pct(mc.topScores[0].p)}) y ${mc.over25 >= 0.5 ? `el ${pct0(mc.over25)} de los partidos supera los 2.5 goles` : `el ${pct0(mc.under25)} se queda por debajo de 2.5 goles`}.`;

  // Factores clave de ambos lados, ordenados por peso absoluto
  const factors = [];
  (sig.a || []).forEach(s => { if (s.key !== 'nodata') factors.push({ side: 'a', team: a.name, flag: a.flag, ...s }); });
  (sig.b || []).forEach(s => { if (s.key !== 'nodata') factors.push({ side: 'b', team: b.name, flag: b.flag, ...s }); });
  factors.sort((x, y) => Math.abs(y.eloImpact) - Math.abs(x.eloImpact));

  // Proyección de marcador (narrativa Monte Carlo)
  const scoreNarr = `El reparto de ${mc.n.toLocaleString('es')} simulaciones deja ${mc.topScores.slice(0, 3).map(s => `${s.score} (${pct0(s.p)})`).join(', ')} como resultados más frecuentes. Promedio de ${mc.avgTotal.toFixed(2)} goles por partido; ambos marcan en el ${pct0(mc.btts)} de los escenarios.`;

  // Factores X (situacionales)
  const xFactors = [];
  if (mc.draw >= 0.27) xFactors.push(`Alta tasa de empate (${pct0(mc.draw)}): un punto puede valer más que ir a por los tres.`);
  if (mc.btts >= 0.55) xFactors.push(`Partido de ida y vuelta: BTTS en ${pct0(mc.btts)} de las simulaciones.`);
  if (mc.over25 <= 0.42) xFactors.push(`Pinta cerrado y de pocos goles (Under 2.5 en ${pct0(mc.under25)}).`);
  if (Math.abs(delta.a) >= 25 || Math.abs(delta.b) >= 25) xFactors.push('El contexto pesa fuerte aquí: la forma actual cambia de manera notable la foto que daría solo el ranking.');
  if (!xFactors.length) xFactors.push('Sin alertas situacionales: el cruce se ajusta a lo que dicta el modelo.');

  // Qué cambiaría la lectura
  const whatChanges = [];
  whatChanges.push(`Bajas de última hora en ${fav.name} estrecharían el margen rápidamente.`);
  if (favProb < 0.62) whatChanges.push(`Si ${dog.name} llega en racha o con su once de gala, esto se vuelve moneda al aire.`);
  whatChanges.push('Al ser cancha neutral, no hay factor localía: si fuese sede de uno de los anfitriones, súmale ~75 Elo de ventaja.');

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

module.exports = { contextSignals, buildH2HAnalysis, CTX_CAP };
