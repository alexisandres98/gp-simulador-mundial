// gpIntelligence.js — capa v2 del SANDBOX "Simula cualquier cruce" (V2 CHALLENGER).
// El modelo global (Elo+Poisson+Dixon-Coles+Monte Carlo) es V1 CONTROL y NO se toca.
//
// Sprint 0.1 — hardening:
//  • Breakdown COMPLETO por factor (raw/normalized/weight/uncapped/capped/source/timestamps/included).
//  • Grupos PERFORMANCE / SQUAD / LOAD con CAPS para evitar double counting (una misma señal no
//    produce tres penalizaciones independientes en el eje Elo).
//  • Eje Elo (fuerza) y eje xG (goles) SEPARADOS — no se suman entre sí.
//  • Safety cap ±55 configurable (GP_INTELLIGENCE_MAX_ELO_ADJUSTMENT); caps por grupo configurables.
//  • Frescura/procedencia por fuente (source_updated_at / fetched_at / expires_at; included/exclusion).
//  • DATA QUALITY (completitud/frescura) SEPARADA de MODEL CONFIDENCE (señal estadística).
//  • Insights determinísticos anclados a métricas (con insight_code auditable).
//  • Versionado de modelo y derivación de seed reproducible (hash de inputs).
// Determinístico, sin IA externa.

'use strict';
const crypto = require('crypto');

// ---------- VERSIONES (internas; no es obligatorio mostrarlas al usuario) ----------
const VERSIONS = {
  control: 'gp-core-1.4.0',          // modelo global (Elo→Poisson→DC→MC + calibración λ=0.15)
  challenger: 'gp-intelligence-0.2.0',
  factorPolicy: 'factor-policy-1',
  normalizer: 'v0',
  dataSchema: 'sprint-0.1',
};

// ---------- CONFIG server-side (no se acepta nada desde el frontend) ----------
const numEnv = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
const CONFIG = {
  // Safety cap del ajuste total de Elo por equipo. BARRERA DE SEGURIDAD, no valor calibrado.
  maxEloAdjustment: numEnv(process.env.GP_INTELLIGENCE_MAX_ELO_ADJUSTMENT, 55),
  // Caps por grupo (eje Elo). Evitan que señales correlacionadas se sumen sin control.
  groupCaps: {
    PERFORMANCE: numEnv(process.env.GP_INTELLIGENCE_CAP_PERFORMANCE, 40),
    SQUAD: numEnv(process.env.GP_INTELLIGENCE_CAP_SQUAD, 35),
    LOAD: numEnv(process.env.GP_INTELLIGENCE_CAP_LOAD, 12),
  },
  // Frescura (ms). Reutiliza los mismos defaults que la política de datos.
  freshnessAgingMs: numEnv(process.env.FRESHNESS_AGING_MS, 60_000),
  freshnessStaleMs: numEnv(process.env.FRESHNESS_STALE_MS, 300_000),
  simulationCount: numEnv(process.env.GP_INTELLIGENCE_SIMS, 10_000),
};
const CTX_CAP = CONFIG.maxEloAdjustment; // back-compat

const BASE_TEAM_GOALS = 1.3;
const FORM_GOAL_BETA = 0.40;
const SQUAD_BASELINE = 6.90;
const FORM_BASELINE_PPG = 1.5;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const pct = p => (p * 100).toFixed(1) + '%';
const pct0 = p => Math.round(p * 100) + '%';
const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// ---------- FRESCURA ----------
// Estado de un dato: fresh | aging | stale | unknown. now en ms.
function freshnessState(sourceUpdatedAt, fetchedAt, now) {
  const ref = sourceUpdatedAt || fetchedAt;
  if (!ref) return 'unknown';
  const age = now - new Date(ref).getTime();
  if (!Number.isFinite(age)) return 'unknown';
  if (age > CONFIG.freshnessStaleMs) return 'stale';
  if (age > CONFIG.freshnessAgingMs) return 'aging';
  return 'fresh';
}

// Crea un objeto factor con todos los campos de trazabilidad. Por defecto incluido.
function makeFactor(o) {
  return {
    factorCode: o.factorCode,
    group: o.group || null,         // PERFORMANCE | SQUAD | LOAD | null (eje xg / informativo)
    axis: o.axis || 'elo',          // elo | xg | quality
    rawValue: o.rawValue ?? null,
    normalizedValue: o.normalizedValue ?? null,
    weight: o.weight ?? 1,
    uncappedContribution: o.uncappedContribution ?? 0, // en Elo (eje elo) — antes de caps de grupo/global
    cappedContribution: 0,           // se rellena tras aplicar caps de grupo
    source: o.source || 'unknown',
    sourceUpdatedAt: o.sourceUpdatedAt || null,
    fetchedAt: o.fetchedAt || null,
    expiresAt: o.expiresAt || null,
    included: o.included !== false,
    exclusionReason: o.exclusionReason || null,  // missing | stale | conflict | low_quality | null
    explanationKey: o.explanationKey || null,
    detail: o.detail || '',
  };
}

// Perfil de goles (eje xG) desde la forma — separado del eje Elo.
function goalProfile(form) {
  if (!form || form.played < 3) return { attackMult: 1, defenseMult: 1, has: false };
  return {
    attackMult: clamp((form.avgFor != null ? form.avgFor : BASE_TEAM_GOALS) / BASE_TEAM_GOALS, 0.6, 1.7),
    defenseMult: clamp((form.avgAgainst != null ? form.avgAgainst : BASE_TEAM_GOALS) / BASE_TEAM_GOALS, 0.6, 1.7),
    has: true,
  };
}

// ---------- BREAKDOWN DE CONTEXTO de un equipo ----------
// teamCtx: getTeamContext (recentForm, injuries, keyPlayers...). extra: { squadRating, restDays,
//   oppRestDays, now, fetchedAt:{form,injuries,squad,rest}, sourceUpdatedAt:{...} }.
function contextSignals(teamCtx, teamName, extra = {}) {
  const now = extra.now || Date.now();
  const fetched = extra.fetchedAt || {};
  const srcUpd = extra.sourceUpdatedAt || {};
  const factors = [];
  const prof = goalProfile(teamCtx && teamCtx.recentForm);
  const baseElo = extra.baseElo ?? null;

  // helper: decide inclusión por frescura. Devuelve { included, exclusionReason, state, expiresAt }
  function freshness(key, ttlMs) {
    const f = fetched[key] || null;
    const s = srcUpd[key] || null;
    const state = freshnessState(s, f, now);
    const expiresAt = f ? new Date(new Date(f).getTime() + (ttlMs || CONFIG.freshnessStaleMs)).toISOString() : null;
    // stale → se excluye; missing (sin dato) lo maneja cada factor; unknown/aging/fresh → se incluye
    return { included: state !== 'stale', exclusionReason: state === 'stale' ? 'stale' : null, state, expiresAt, fetchedAt: f, sourceUpdatedAt: s };
  }

  if (!teamCtx) {
    factors.push(makeFactor({ factorCode: 'NO_CONTEXT', group: null, axis: 'quality', included: false, exclusionReason: 'missing', detail: 'Sin datos de contexto para ' + teamName, explanationKey: 'no_context' }));
    return finalize(factors, prof, baseElo, teamName, { allMissing: true });
  }
  const f = teamCtx.recentForm;

  // 1) FORMA (PERFORMANCE, eje elo)
  {
    const fr = freshness('form', 2 * 60 * 60 * 1000);
    if (!f || f.played < 3) {
      factors.push(makeFactor({ factorCode: 'FORM', group: 'PERFORMANCE', included: false, exclusionReason: 'missing', source: 'api_football', detail: 'Forma reciente no disponible', explanationKey: 'form_missing' }));
    } else {
      const ppg = f.points / f.played;
      const gd = (f.avgFor || 0) - (f.avgAgainst || 0);
      const contribution = clamp(clamp((ppg - FORM_BASELINE_PPG) * 22, -30, 30) + clamp(gd * 9, -16, 16), -40, 40);
      const wd = `${f.results.filter(r => r === 'W').length}V-${f.results.filter(r => r === 'D').length}E-${f.results.filter(r => r === 'L').length}D`;
      factors.push(makeFactor({
        factorCode: 'FORM', group: 'PERFORMANCE', axis: 'elo',
        rawValue: { ppg: +ppg.toFixed(2), gd: +gd.toFixed(2) }, normalizedValue: +(contribution / 40).toFixed(3), weight: 1,
        uncappedContribution: fr.included ? Math.round(contribution) : 0,
        source: 'api_football', sourceUpdatedAt: fr.sourceUpdatedAt, fetchedAt: fr.fetchedAt, expiresAt: fr.expiresAt,
        included: fr.included, exclusionReason: fr.exclusionReason,
        detail: `Últimos ${f.played}: ${wd} · ${(f.avgFor || 0).toFixed(1)} GF / ${(f.avgAgainst || 0).toFixed(1)} GC`, explanationKey: 'form',
      }));
    }
  }

  // 2) RACHA (PERFORMANCE, eje elo)
  if (f && f.streak && /^\d+[WDL]$/.test(f.streak)) {
    const fr = freshness('form', 2 * 60 * 60 * 1000);
    const n = parseInt(f.streak), kind = f.streak.slice(-1);
    let c = 0;
    if (kind === 'W' && n >= 2) c = clamp(n * 4, 0, 14);
    else if (kind === 'L' && n >= 2) c = -clamp(n * 4, 0, 14);
    if (c) factors.push(makeFactor({
      factorCode: 'STREAK', group: 'PERFORMANCE', axis: 'elo',
      rawValue: f.streak, normalizedValue: +(c / 14).toFixed(3), uncappedContribution: fr.included ? Math.round(c) : 0,
      source: 'api_football', fetchedAt: fr.fetchedAt, expiresAt: fr.expiresAt, included: fr.included, exclusionReason: fr.exclusionReason,
      detail: kind === 'W' ? `${n} victorias al hilo` : `${n} derrotas al hilo`, explanationKey: 'streak',
    }));
  }

  // 3) SOLIDEZ DEFENSIVA (PERFORMANCE, eje elo)
  if (f && f.played >= 3 && f.cleanSheets != null) {
    const fr = freshness('form', 2 * 60 * 60 * 1000);
    const csRate = f.cleanSheets / f.played;
    let c = 0, detail = '';
    if (csRate >= 0.5) { c = clamp((csRate - 0.4) * 30, 0, 12); detail = `${f.cleanSheets} portería(s) a cero en ${f.played}`; }
    else if (csRate === 0 && (f.avgAgainst || 0) >= 1.6) { c = -clamp(((f.avgAgainst) - 1.2) * 12, 0, 12); detail = `Encaja ${(f.avgAgainst).toFixed(1)}/partido, sin vallas invictas`; }
    if (c) factors.push(makeFactor({
      factorCode: 'SOLIDITY', group: 'PERFORMANCE', axis: 'elo',
      rawValue: +csRate.toFixed(2), normalizedValue: +(c / 12).toFixed(3), uncappedContribution: fr.included ? Math.round(c) : 0,
      source: 'api_football', fetchedAt: fr.fetchedAt, expiresAt: fr.expiresAt, included: fr.included, exclusionReason: fr.exclusionReason,
      detail, explanationKey: c > 0 ? 'solidity_good' : 'solidity_bad',
    }));
  }

  // 4) CALIDAD DE PLANTILLA (SQUAD, eje elo)
  if (extra.squadRating && extra.squadRating.avg) {
    const fr = freshness('squad', 24 * 60 * 60 * 1000);
    const c = clamp((extra.squadRating.avg - SQUAD_BASELINE) * 30, -22, 22);
    if (Math.abs(c) >= 3) factors.push(makeFactor({
      factorCode: 'SQUAD_QUALITY', group: 'SQUAD', axis: 'elo',
      rawValue: +extra.squadRating.avg.toFixed(2), normalizedValue: +(c / 22).toFixed(3), uncappedContribution: fr.included ? Math.round(c) : 0,
      source: 'api_football', fetchedAt: fr.fetchedAt, expiresAt: fr.expiresAt, included: fr.included, exclusionReason: fr.exclusionReason,
      detail: `Rating medio del XI ~${extra.squadRating.avg.toFixed(2)} (${extra.squadRating.n} jugadores)`, explanationKey: 'squad_quality',
    }));
  }

  // 5) DISPONIBILIDAD (SQUAD, eje elo) — bajas ponderadas por jugador clave
  {
    const fr = freshness('injuries', 20 * 60 * 1000);
    const keyNames = new Set((teamCtx.keyPlayers || []).map(p => normName(p.name)));
    const inj = (teamCtx.injuries || []).filter(i => ['injured', 'suspended', 'doubt'].includes(i.status));
    if (inj.length) {
      let pen = 0; const keyHits = [];
      inj.forEach(i => { const isKey = keyNames.has(normName(i.player)); pen += i.status === 'doubt' ? (isKey ? 6 : 3) : (isKey ? 15 : 7); if (isKey) keyHits.push(i.player); });
      const c = -clamp(pen, 0, 42);
      factors.push(makeFactor({
        factorCode: 'AVAILABILITY', group: 'SQUAD', axis: 'elo',
        rawValue: { count: inj.length, keyHits }, normalizedValue: +(c / 42).toFixed(3), uncappedContribution: fr.included ? Math.round(c) : 0,
        source: 'api_football', fetchedAt: fr.fetchedAt, sourceUpdatedAt: fr.sourceUpdatedAt, expiresAt: fr.expiresAt,
        included: fr.included, exclusionReason: fr.exclusionReason,
        detail: `${inj.length} ausencia(s)/duda(s)${keyHits.length ? ` · clave: ${keyHits.slice(0, 2).join(', ')}` : ''}`, explanationKey: keyHits.length ? 'availability_key' : 'availability',
      }));
    } else if (teamCtx.providerStatus && teamCtx.providerStatus.usedApiFootball) {
      // dato presente (la fuente respondió) sin bajas → plantel completo, contribución 0 pero cuenta como dato.
      factors.push(makeFactor({
        factorCode: 'AVAILABILITY', group: 'SQUAD', axis: 'elo', rawValue: { count: 0 }, uncappedContribution: 0,
        source: 'api_football', fetchedAt: fr.fetchedAt, expiresAt: fr.expiresAt, included: fr.included, exclusionReason: fr.exclusionReason,
        detail: 'Sin bajas relevantes confirmadas', explanationKey: 'availability_clear',
      }));
    }
  }

  // 6) DESCANSO / CARGA (LOAD, eje elo)
  if (extra.restDays != null && extra.oppRestDays != null) {
    const fr = freshness('rest', 24 * 60 * 60 * 1000);
    const diff = extra.restDays - extra.oppRestDays;
    const c = clamp(diff * 2.5, -10, 10);
    if (Math.abs(c) >= 3) factors.push(makeFactor({
      factorCode: 'REST', group: 'LOAD', axis: 'elo',
      rawValue: { restDays: extra.restDays, oppRestDays: extra.oppRestDays }, normalizedValue: +(c / 10).toFixed(3), uncappedContribution: fr.included ? Math.round(c) : 0,
      source: 'derived', fetchedAt: fr.fetchedAt, expiresAt: fr.expiresAt, included: fr.included, exclusionReason: fr.exclusionReason,
      detail: `${extra.restDays}d vs ${extra.oppRestDays}d del rival`, explanationKey: c > 0 ? 'rest_advantage' : 'rest_disadvantage',
    }));
  }

  // 7) xG ATAQUE/DEFENSA (eje xg, NO suma al Elo) — informativo + alimenta el modelo de goles
  factors.push(makeFactor({
    factorCode: 'XG_PROFILE', group: null, axis: 'xg',
    rawValue: { attackMult: +prof.attackMult.toFixed(2), defenseMult: +prof.defenseMult.toFixed(2) },
    included: prof.has, exclusionReason: prof.has ? null : 'missing', uncappedContribution: 0,
    source: 'api_football', detail: prof.has ? `Ataque ×${prof.attackMult.toFixed(2)} · solidez ×${prof.defenseMult.toFixed(2)}` : 'xG específico no disponible (forma insuficiente)',
    explanationKey: 'xg_profile',
  }));

  return finalize(factors, prof, baseElo, teamName, {});
}

// Aplica caps por grupo (anti-double-counting) y el cap global. Calcula dataQuality.
function finalize(factors, prof, baseElo, teamName, opts) {
  // 1) sumar contribuciones uncapped por grupo (solo eje elo, incluidas)
  const groupUncapped = { PERFORMANCE: 0, SQUAD: 0, LOAD: 0 };
  for (const fa of factors) {
    if (fa.axis === 'elo' && fa.included && fa.group) groupUncapped[fa.group] += fa.uncappedContribution;
  }
  // 2) cap por grupo (escala proporcional para preservar el peso relativo dentro del grupo)
  const groupCapped = {};
  for (const g of Object.keys(groupUncapped)) {
    const cap = CONFIG.groupCaps[g];
    groupCapped[g] = clamp(groupUncapped[g], -cap, cap);
    const scale = groupUncapped[g] !== 0 ? groupCapped[g] / groupUncapped[g] : 0;
    for (const fa of factors) if (fa.axis === 'elo' && fa.included && fa.group === g) fa.cappedContribution = Math.round(fa.uncappedContribution * scale);
  }
  // 3) sumar grupos y aplicar cap global
  const uncappedTotal = Object.values(groupCapped).reduce((s, x) => s + x, 0);
  const finalCappedTotal = clamp(uncappedTotal, -CONFIG.maxEloAdjustment, CONFIG.maxEloAdjustment);

  // 4) data quality: completitud + frescura (NO es model confidence)
  const eloFactors = factors.filter(fa => fa.axis === 'elo');
  const expected = ['FORM', 'AVAILABILITY', 'SQUAD_QUALITY']; // fuentes clave esperadas
  const present = expected.filter(code => factors.some(fa => fa.factorCode === code && fa.included));
  const stale = factors.filter(fa => fa.exclusionReason === 'stale').map(fa => fa.factorCode);
  const missing = factors.filter(fa => fa.exclusionReason === 'missing').map(fa => fa.factorCode);
  const score = +(present.length / expected.length).toFixed(2);
  let level = 'Insuficiente';
  if (score >= 0.8) level = 'Alta'; else if (score >= 0.55) level = 'Media'; else if (score >= 0.3) level = 'Baja';
  const dataQuality = { score, level, missing, stale, presentSources: present };

  return {
    teamName, baseElo,
    delta: finalCappedTotal,                  // back-compat: el ajuste final de Elo
    finalCappedTotal, uncappedTotal, groupUncapped, groupCapped,
    factors,
    goalProfile: prof,
    dataQuality,
    hasData: eloFactors.some(fa => fa.included && fa.factorCode !== 'NO_CONTEXT'),
    // back-compat con la firma anterior (signals[] con label/eloImpact/dir)
    signals: factors.filter(fa => fa.axis === 'elo' && fa.factorCode !== 'NO_CONTEXT').map(fa => ({
      key: fa.factorCode.toLowerCase(), label: labelFor(fa.factorCode), detail: fa.detail,
      eloImpact: fa.included ? fa.cappedContribution : 0, dir: fa.cappedContribution > 0 ? 'up' : fa.cappedContribution < 0 ? 'down' : 'flat',
      included: fa.included, exclusionReason: fa.exclusionReason,
    })),
  };
}

function labelFor(code) {
  return ({ FORM: 'Forma reciente', STREAK: 'Racha', SOLIDITY: 'Solidez/fragilidad', SQUAD_QUALITY: 'Calidad de plantilla', AVAILABILITY: 'Bajas y dudas', REST: 'Descanso/carga', XG_PROFILE: 'Perfil de goles' })[code] || code;
}

// ---------- MODELO DE GOLES (eje xG) ----------
function adjustedLambdas(lAelo, lBelo, profA, profB) {
  const beta = (profA.has && profB.has) ? FORM_GOAL_BETA : 0;
  const expA = BASE_TEAM_GOALS * profA.attackMult * profB.defenseMult;
  const expB = BASE_TEAM_GOALS * profB.attackMult * profA.defenseMult;
  const lA = clamp(lAelo * (1 - beta) + expA * beta, 0.3, 4.6);
  const lB = clamp(lBelo * (1 - beta) + expB * beta, 0.3, 4.6);
  return [lA, lB, beta];
}

function goalsMarkets(mc, lA, lB) {
  const overLine = x => mc.totals.filter(t => t.goals >= x + 1).reduce((s, t) => s + t.p, 0);
  const ml = mc.totals.slice().sort((a, b) => b.p - a.p)[0] || { goals: null, p: 0 };
  const teamDist = l => { const p0 = Math.exp(-l), p1 = p0 * l, p2 = p1 * l / 2; return { g0: p0, g1: p1, g2: p2, g3: Math.max(0, 1 - p0 - p1 - p2) }; };
  return {
    over15: overLine(1), over25: overLine(2), over35: overLine(3), under25: 1 - overLine(2),
    mostLikelyTotal: ml.goals, mostLikelyTotalP: ml.p,
    btts: mc.btts, avgTotal: mc.avgTotal, teamA: teamDist(lA), teamB: teamDist(lB),
  };
}

// ---------- SEED / HASH reproducible ----------
function hashInputs(obj) {
  const json = JSON.stringify(obj, Object.keys(obj).sort());
  return 'sha256:' + crypto.createHash('sha256').update(json).digest('hex');
}
function deriveSeed(inputHash) {
  const hex = String(inputHash).replace(/^sha256:/, '').slice(0, 8);
  return parseInt(hex, 16) >>> 0;
}

// ---------- MODEL CONFIDENCE (estadística; distinta de data quality) ----------
function modelConfidence(v2) {
  const top = Math.max(v2.aWin, v2.bWin);
  const gap = Math.abs(v2.aWin - v2.bWin);
  let level = 'Baja';
  if (gap >= 0.30 && top >= 0.55) level = 'Alta';
  else if (gap >= 0.12) level = 'Media';
  return { level, favProb: +top.toFixed(4), spread: +gap.toFixed(4) };
}

// ---------- SANITY MATEMÁTICO ----------
function mathSanity({ v2, goals, mc, deltaA, deltaB }) {
  const errors = [];
  const approx = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
  // 1X2 suma 1
  const sum1x2 = v2.aWin + v2.draw + v2.bWin;
  if (!approx(sum1x2, 1)) errors.push(`1X2 no suma 1 (${sum1x2.toFixed(4)})`);
  // monotonicidad Over
  if (!(goals.over15 >= goals.over25 - 1e-9 && goals.over25 >= goals.over35 - 1e-9)) errors.push('Over no monotónico (O1.5≥O2.5≥O3.5)');
  // BTTS en [0,1]
  if (!(goals.btts >= 0 && goals.btts <= 1)) errors.push('BTTS fuera de [0,1]');
  // score matrix ~1 (suma de topScores ≤ 1 y distribución total ~1)
  const totalP = mc.totals.reduce((s, t) => s + t.p, 0);
  if (!approx(totalP, 1, 0.03)) errors.push(`Distribución de totales no suma 1 (${totalP.toFixed(4)})`);
  // xG válido
  for (const [k, v] of [['xgA', v2.xgA], ['xgB', v2.xgB]]) {
    if (!Number.isFinite(v) || v < 0 || v > 6) errors.push(`xG inválido ${k}=${v}`);
  }
  // caps
  if (Math.abs(deltaA) > CONFIG.maxEloAdjustment + 0.5 || Math.abs(deltaB) > CONFIG.maxEloAdjustment + 0.5) errors.push('Ajuste fuera del safety cap');
  return { ok: errors.length === 0, errors };
}

// ---------- INSIGHTS determinísticos (anclados a métricas, con código auditable) ----------
function buildInsights({ a, b, v2, goals, mc, ctxA, ctxB, beta }) {
  const out = [];
  const add = (code, severity, templateKey, inputMetrics, text) => out.push({ insightCode: code, severity, templateKey, inputMetrics, text });
  const xgGap = (v2.xgA || 0) - (v2.xgB || 0);
  if (xgGap >= 0.6) add('OFFENSIVE_ADVANTAGE', 'info', 'offensive_adv', { xgA: v2.xgA, xgB: v2.xgB, gap: +xgGap.toFixed(2) }, `${a.name} proyecta más volumen ofensivo (xG ${v2.xgA.toFixed(2)} vs ${v2.xgB.toFixed(2)}).`);
  else if (xgGap <= -0.6) add('OFFENSIVE_ADVANTAGE', 'info', 'offensive_adv', { xgA: v2.xgA, xgB: v2.xgB, gap: +xgGap.toFixed(2) }, `${b.name} proyecta más volumen ofensivo (xG ${v2.xgB.toFixed(2)} vs ${v2.xgA.toFixed(2)}).`);
  if (goals.over25 >= 0.58) add('HIGH_TOTAL_VOLATILITY', 'info', 'high_total', { over25: goals.over25 }, `Pinta partido de goles: Over 2.5 al ${pct0(goals.over25)}.`);
  if (goals.under25 >= 0.58) add('LOW_TOTAL', 'info', 'low_total', { under25: goals.under25 }, `Pinta cerrado: Under 2.5 al ${pct0(goals.under25)}.`);
  // ausencia de jugador clave
  const keyAbs = side => (side.factors || []).find(fa => fa.factorCode === 'AVAILABILITY' && fa.included && fa.rawValue && fa.rawValue.keyHits && fa.rawValue.keyHits.length);
  const ka = keyAbs(ctxA), kb = keyAbs(ctxB);
  if (ka) add('KEY_PLAYER_ABSENCE', 'warn', 'key_absence', { team: a.name, players: ka.rawValue.keyHits }, `Baja(s) de peso en ${a.name}: ${ka.rawValue.keyHits.slice(0, 2).join(', ')}.`);
  if (kb) add('KEY_PLAYER_ABSENCE', 'warn', 'key_absence', { team: b.name, players: kb.rawValue.keyHits }, `Baja(s) de peso en ${b.name}: ${kb.rawValue.keyHits.slice(0, 2).join(', ')}.`);
  // ventaja de descanso
  const restF = side => (side.factors || []).find(fa => fa.factorCode === 'REST' && fa.included);
  const ra = restF(ctxA);
  if (ra && ra.cappedContribution >= 5) add('REST_ADVANTAGE', 'info', 'rest_adv', ra.rawValue, `${a.name} llega con mejor descanso.`);
  // calidad de datos baja
  const dqMin = Math.min(ctxA.dataQuality.score, ctxB.dataQuality.score);
  if (dqMin < 0.55) add('LOW_DATA_QUALITY', 'warn', 'low_dq', { score: dqMin }, 'Datos de contexto incompletos: la lectura se apoya más en el modelo base.');
  if (!out.length) add('NO_SIGNAL', 'info', 'no_signal', {}, 'Sin señales contextuales destacadas: el cruce se ajusta al modelo.');
  return out;
}

// ---------- ANÁLISIS INTEGRAL ----------
function buildH2HAnalysis(args) {
  const { a, b, base, v2, ctxA, ctxB, mc, goals, beta } = args;
  const deltaA = ctxA.finalCappedTotal, deltaB = ctxB.finalCappedTotal;
  const favSide = v2.aWin > v2.bWin ? 'a' : 'b';
  const fav = favSide === 'a' ? a : b, dog = favSide === 'a' ? b : a;
  const favProb = favSide === 'a' ? v2.aWin : v2.bWin;
  const dogProb = favSide === 'a' ? v2.bWin : v2.aWin;
  const baseFavProb = favSide === 'a' ? base.aWin : base.bWin;
  const parity = Math.abs(v2.aWin - v2.bWin) < 0.08 && v2.draw > 0.24;

  const conf = modelConfidence(v2);
  const dataQuality = { level: worseLevel(ctxA.dataQuality.level, ctxB.dataQuality.level), a: ctxA.dataQuality, b: ctxB.dataQuality };

  let verdictLabel;
  if (parity) verdictLabel = 'CRUCE PAREJO';
  else if (favProb >= 0.62) verdictLabel = 'FAVORITO CLARO';
  else if (favProb >= 0.5) verdictLabel = 'LIGERO FAVORITO';
  else verdictLabel = 'SIN FAVORITO NETO';

  const shift = Math.round((favProb - baseFavProb) * 100);
  const shiftPhrase = parity ? 'el contexto no rompe la paridad'
    : shift > 1 ? `el contexto refuerza a ${fav.name} (+${shift} pts sobre el modelo base)`
    : shift < -1 ? `el contexto recorta a ${fav.name} (${shift} pts), pero sigue al frente`
    : 'el contexto confirma la lectura del modelo base';
  const goalsPhrase = goals ? ` Proyección: ~${goals.avgTotal.toFixed(2)} goles (Over 2.5 al ${pct0(goals.over25)}); total más probable ${goals.mostLikelyTotal}.` : '';
  const verdict = parity
    ? `La probabilidad inicial ya veía un duelo cerrado y ${shiftPhrase}. ${a.name} ${pct(v2.aWin)} · empate ${pct(v2.draw)} · ${b.name} ${pct(v2.bWin)}. Marcador más repetido: ${mc.topScores[0].score} (${pct(mc.topScores[0].p)}).${goalsPhrase}`
    : `La probabilidad inicial abre con ${fav.name} a ${pct(baseFavProb)}. Integrando el contexto, ${shiftPhrase}: la probabilidad GP final cierra en ${fav.name} ${pct(favProb)}, empate ${pct(v2.draw)}, ${dog.name} ${pct(dogProb)}. Marcador más probable: ${mc.topScores[0].score} (${pct(mc.topScores[0].p)}).${goalsPhrase}`;

  const insights = buildInsights({ a, b, v2, goals, mc, ctxA, ctxB, beta });

  // factores combinados para la UI (incluidos, eje elo, ordenados por |impacto|)
  const factors = [];
  for (const [ctx, meta] of [[ctxA, a], [ctxB, b]]) {
    for (const fa of ctx.factors) {
      if (fa.axis === 'elo' && fa.factorCode !== 'NO_CONTEXT') factors.push({ side: meta === a ? 'a' : 'b', team: meta.name, flag: meta.flag, ...fa, eloImpact: fa.included ? fa.cappedContribution : 0, label: labelFor(fa.factorCode), dir: fa.cappedContribution > 0 ? 'up' : fa.cappedContribution < 0 ? 'down' : 'flat' });
    }
  }
  factors.sort((x, y) => Math.abs(y.eloImpact) - Math.abs(x.eloImpact));

  const scoreNarr = `El reparto de ${mc.n.toLocaleString('es')} simulaciones (contexto integrado, seed fija) deja ${mc.topScores.slice(0, 3).map(s => `${s.score} (${pct0(s.p)})`).join(', ')} como más frecuentes.${goals ? ` Promedio ${goals.avgTotal.toFixed(2)} goles; ambos marcan ${pct0(goals.btts)}.` : ''}`;

  const whatChanges = [];
  whatChanges.push(`Una baja de última hora en ${fav.name} estrecharía el margen.`);
  if (favProb < 0.62) whatChanges.push(`Si ${dog.name} llega con su once de gala, esto se vuelve moneda al aire.`);
  whatChanges.push('Cancha neutral: sin factor localía (un anfitrión sumaría ~75 Elo).');

  return {
    headline: { favSide, favName: fav.name, favFlag: fav.flag, favProb, dogName: dog.name, dogProb, drawProb: v2.draw, verdictLabel, verdict, parity, modelConfidence: conf, dataQuality },
    decomposition: {
      baseFavProb, v2FavProb: favProb, shift,
      baseLine: { aWin: base.aWin, draw: base.draw, bWin: base.bWin },
      v2Line: { aWin: v2.aWin, draw: v2.draw, bWin: v2.bWin },
      deltaA, deltaB,
      deltaPp: { aWin: +((v2.aWin - base.aWin) * 100).toFixed(1), draw: +((v2.draw - base.draw) * 100).toFixed(1), bWin: +((v2.bWin - base.bWin) * 100).toFixed(1) },
      groupsA: ctxA.groupCapped, groupsB: ctxB.groupCapped,
    },
    factors, insights, monteCarlo: { ...mc, narrative: scoreNarr }, whatChanges,
  };
}

function worseLevel(x, y) {
  const order = ['Insuficiente', 'Baja', 'Media', 'Alta'];
  return order[Math.min(order.indexOf(x) < 0 ? 3 : order.indexOf(x), order.indexOf(y) < 0 ? 3 : order.indexOf(y))];
}

module.exports = {
  contextSignals, adjustedLambdas, goalsMarkets, buildH2HAnalysis,
  hashInputs, deriveSeed, modelConfidence, mathSanity, freshnessState,
  VERSIONS, CONFIG, CTX_CAP,
};
