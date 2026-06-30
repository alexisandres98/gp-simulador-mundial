// Simulador Mundial 2026 — servidor sin dependencias (Node >= 18)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Carga variables desde un .env local SI existe (zero-dep, sin dotenv). En Render no hay .env:
// las variables vienen del dashboard. No sobreescribe variables ya definidas en el entorno.
// Debe correr ANTES de requerir data-providers (que lee process.env al cargar).
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch { /* nunca debe impedir el arranque */ }
})();
const { TEAMS, GROUPS, GROUP_FIXTURES, KNOCKOUT } = require('./data/tournament');
const { simulateTournament, matchProbs, probsFromLambdas, lambdas, liveMatchProbs, liveProbsFromLambdas, liveEventAdjustments, simulateH2H, makeRng, eloUpdate, explainTeam, effElo, assignThirds, cmpRows } = require('./engine');
const mailer = require('./mailer');
// Fase 4: capa de datos contextuales (API-Football principal → ESPN → manual). La UI nunca
// llama a estos providers ni ve la API key: solo recibe data normalizada vía /api/match y /api/teamdetail.
const providers = require('./data-providers');
const { generateGPTake } = require('./data-providers/gpTake');
// v2 piloto (solo sandbox): capa de contexto + análisis integral del cruce.
const { contextSignals, buildH2HAnalysis, adjustedLambdas, goalsMarkets, hashInputs, deriveSeed, mathSanity, VERSIONS } = require('./data-providers/gpIntelligence');
// v2 logging experimental (best-effort, tras feature flag).
const gpExperiment = require('./data-providers/gpExperimentLog');
const telegram = require('./telegram');
// Sprint 0 — plataforma de datos v2 (aislada tras feature flags). Requerirla NO abre conexión:
// el pool de pg se crea de forma perezosa solo si hay DATABASE_URL y alguien consulta la capa.
const platformHealth = require('./database/health');
// Sprint 1 — ingesta de mercado (shadow mode). Aislada; requerirla no inicializa ni conecta nada.
const marketData = require('./market-data');
// Sprint 2 — Canonical Event Graph (shadow mode). Aislado; requerirlo no ejecuta matching ni conecta.
const canonicalGraph = require('./canonical-graph');
// Sprint 3 — motor de arbitraje ejecutable V1 (shadow mode, sin publicación). Aislado.
const arbEngine = require('./arb-engine');
// Sprint 4 — capa de producto (oportunidades ejecutables). Inerte con flags apagados; no conecta nada al requerir.
const execOpps = require('./exec-opportunities');
// Sprint 5 — registro inmutable y verificable de señales. Inerte con flags apagados; no conecta nada al requerir.
const signalRegistry = require('./signal-registry');
// Fase G.1 — controles administrativos por señal (interno). Rate limit en memoria (acciones de escritura admin).
const _registryAdminRate = new Map(); // email → [timestamps]
function registryAdminRateOk(email, max = 30, windowMs = 60000) {
  const now = Date.now(); const arr = (_registryAdminRate.get(email) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { _registryAdminRate.set(email, arr); return false; }
  arr.push(now); _registryAdminRate.set(email, arr); return true;
}
// Sprint 6 — motor de métricas / track record verificable. Inerte con flags apagados; no conecta al requerir.
const metricsEngine = require('./metrics-engine');
// Sprint 7 — Value Engine + Picks GP. Inerte con flags apagados; no conecta al requerir.
const valueEngine = require('./value-engine');
const operations = require('./operations'); // Sprint 8A — orquestador de jobs (INERTE si OPERATIONS_ORCHESTRATOR_ENABLED=false)
const uiFlags = require('./ui-flags'); // Sprint 8.1 — flags de integración de UI (INERTE si UI_* off → UI idéntica)
const gpProduct = require('./gp-product/flags'); // Fase Q — experiencia de producto beta (INERTE si GP_BETA_UI_ENABLED off)
const gpProductApi = require('./gp-product/api'); // Fase Q — dispatcher de /api/beta/* (gateado por betaGuard)
const userPrefs = require('./user-preferences'); // Sprint 8A — preferencias + onboarding (INERTE sin flags)
const userAlerts = require('./alerts');           // Sprint 8A — motor de alertas de usuario (INERTE sin flags)
const productAnalytics = require('./analytics');   // Sprint 8A — analítica de producto (INERTE sin flags)
const referrals = require('./referrals');          // Sprint 8A — referrals (INERTE sin flags)
const entitlements = require('./entitlements');    // Sprint 8B — entitlements (no restringe si off; billing OFF)
const proWaitlist = require('./entitlements/waitlist'); // Sprint 8B — waitlist GP Pro (sin pago)
// rate limiter en memoria muy simple (clave → ventana) para la calculadora pública
const _rl = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now(); const e = _rl.get(key);
  if (!e || e.exp < now) { _rl.set(key, { n: 1, exp: now + windowMs }); return true; }
  if (e.n >= max) return false; e.n++; return true;
}
// helper de lectura para endpoints admin de arbitraje (parametrizado; devuelve filas o [] sin lanzar)
async function dbClientSafe(sql, params) { try { const r = await require('./database/client').query(sql, params); return r.rows; } catch { return []; } }

const PORT = process.env.PORT || 3000;
const N_SIMS = Number(process.env.SIMS || 10000);
// DB_FILE puede apuntar a un disco persistente montado (p.ej. /data/db.json en Render Starter)
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'db.json');
const teamById = Object.fromEntries(TEAMS.map(t => [t.id, t]));

// ---------- persistencia ----------
let db = { users: {}, sessions: {}, codes: {}, results: {}, elos: {}, history: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* primera ejecución */ }
TEAMS.forEach(t => { if (db.elos[t.id] == null) db.elos[t.id] = t.elo; });
db.sentAlerts = db.sentAlerts || {}; // inicializado temprano: markExistingFinalsSeen() lo usa al arrancar
db.sentTg = db.sentTg || {};         // inicializado temprano: markExistingTgSeen() lo usa al arrancar
let saveTimer = null;
// Escritura síncrona de db.json. Con try/catch para que un fallo de disco no tumbe el proceso.
function flushDb() {
  saveTimer = null;
  try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1)); }
  catch (e) { console.error('[save] error al escribir db.json:', e.message); }
}
function save() {
  // FIX CRÍTICO: NO reiniciar un timer ya pendiente. Garantiza que el write ocurra como máximo 200ms
  // tras el primer cambio de una ráfaga. (Antes: clearTimeout en cada llamada → bajo tráfico alto el
  // debounce se reseteaba indefinidamente y db.json NUNCA se persistía → se perdían usuarios nuevos.)
  if (saveTimer) return;
  saveTimer = setTimeout(flushDb, 200);
}
// Persistir db.json al recibir señal de apagado (deploy/restart) para no perder cambios en memoria.
// Si el orquestador (Sprint 8) está activo, su shutdown coordinado llamará flushDb antes de salir; este
// handler cubre el caso sin orquestador. Idempotente.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { try { flushDb(); } catch { /* noop */ } });
}

// Recalcula los Elo desde la base replicando todos los resultados finales (permite editar/borrar sin corromper ratings)
function recomputeElos() {
  TEAMS.forEach(t => { db.elos[t.id] = t.elo; });
  const apply = (hId, aId, r) => {
    const [nh, na] = eloUpdate(db.elos[hId], db.elos[aId], r.hg, r.ag, teamById[hId].host, teamById[aId].host);
    db.elos[hId] = nh; db.elos[aId] = na;
  };
  for (const f of GROUP_FIXTURES) {
    const r = db.results[f.id];
    if (r && r.status === 'final') apply(f.home, f.away, r);
  }
  for (const k of KNOCKOUT) {
    const r = db.results[String(k.m)];
    if (r && r.status === 'final' && r.home && r.away) apply(r.home, r.away, r);
  }
}

// ---------- simulación (cacheada) ----------
let simCache = null;
function runSims() {
  const t0 = Date.now();
  simCache = simulateTournament(db.elos, db.results, N_SIMS);
  const top = TEAMS.map(t => t.id).sort((a, b) => simCache[b].champion - simCache[a].champion)[0];
  console.log(`[sim] ${N_SIMS} torneos en ${Date.now() - t0}ms — favorito: ${top} ${(simCache[top].champion * 100).toFixed(1)}%`);
  db.history.push({ ts: Date.now(), probs: Object.fromEntries(TEAMS.map(t => [t.id, +(simCache[t.id].champion).toFixed(4)])) });
  if (db.history.length > 1000) db.history = db.history.slice(-1000);
  save();
}
recomputeElos();
runSims();
markExistingFinalsSeen(); // no reenviar alertas de partidos ya finalizados antes de activar la feature
markExistingTgSeen();     // tampoco publicar en Telegram los finales ya ocurridos

// ---------- SSE (tiempo real) ----------
const sseClients = new Set();
// heartbeat cada 25s: mantiene vivas las conexiones a través de proxies/túneles
setInterval(() => { for (const res of sseClients) res.write(':hb\n\n'); }, 25000);
function broadcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) res.write(msg);
}

// ---------- tabla de posiciones real (solo resultados finales) ----------
function realStandings() {
  const tables = {};
  GROUPS.forEach(g => {
    tables[g] = {};
    TEAMS.filter(t => t.group === g).forEach(t =>
      tables[g][t.id] = { id: t.id, pj: 0, pts: 0, gf: 0, ga: 0 });
  });
  for (const f of GROUP_FIXTURES) {
    const r = db.results[f.id];
    if (!r || r.status !== 'final') continue;
    const H = tables[f.group][f.home], A = tables[f.group][f.away];
    H.pj++; A.pj++; H.gf += r.hg; H.ga += r.ag; A.gf += r.ag; A.ga += r.hg;
    if (r.hg > r.ag) H.pts += 3; else if (r.hg < r.ag) A.pts += 3; else { H.pts++; A.pts++; }
  }
  const out = {};
  GROUPS.forEach(g => {
    out[g] = Object.values(tables[g]).sort((a, b) =>
      b.pts - a.pts || (b.gf - b.ga) - (a.gf - a.ga) || b.gf - a.gf || a.id.localeCompare(b.id));
  });
  return out;
}

// ---------- bracket real (equipos confirmados en eliminatorias) ----------
// Resuelve qué equipos reales ocupan cada llave a partir de resultados FINALES.
function resolveRealBracket() {
  const standings = realStandings();
  const groupDone = {};
  GROUPS.forEach(g => {
    groupDone[g] = GROUP_FIXTURES.filter(f => f.group === g)
      .every(f => db.results[f.id] && db.results[f.id].status === 'final');
  });
  const firsts = {}, seconds = {}, thirdRows = [];
  GROUPS.forEach(g => {
    if (!groupDone[g]) return;
    firsts[g] = standings[g][0].id;
    seconds[g] = standings[g][1].id;
    const t = standings[g][2];
    thirdRows.push({ id: t.id, pts: t.pts, gf: t.gf, ga: t.ga, _rnd: 0 });
  });
  let t3byMatch = {};
  if (GROUPS.every(g => groupDone[g])) {
    thirdRows.sort(cmpRows);
    const qual = thirdRows.slice(0, 8).map(r => r.id);
    const slots = KNOCKOUT.filter(k => k.away.t === 'T3').map(k => k.away);
    const assign = assignThirds(qual, slots);
    KNOCKOUT.filter(k => k.away.t === 'T3').forEach((k, i) => t3byMatch[k.m] = assign[i]);
  }
  const resolved = {}; // m -> {home, away} (solo lados conocidos)
  const winnerOf = m => {
    const r = db.results[String(m)];
    if (!r || r.status !== 'final') return null;
    return r.hg > r.ag ? r.home : r.hg < r.ag ? r.away : (r.pensHome ? r.home : r.away);
  };
  const loserOf = m => {
    const r = db.results[String(m)];
    if (!r || r.status !== 'final') return null;
    return r.hg > r.ag ? r.away : r.hg < r.ag ? r.home : (r.pensHome ? r.away : r.home);
  };
  const side = (s, m) => {
    if (s.t === 'W') return firsts[s.g] || null;
    if (s.t === 'R') return seconds[s.g] || null;
    if (s.t === 'T3') return t3byMatch[m] || null;
    if (s.t === 'M') return winnerOf(s.m);
    if (s.t === 'L') return loserOf(s.m);
  };
  for (const k of KNOCKOUT) {
    resolved[k.m] = { home: side(k.home, k.m), away: side(k.away, k.m) };
    // Override anclado a ESPN: si conocemos los equipos REALES de esta llave (por hora de inicio), mandan ellos.
    // Corrige cruces mal computados (mejores terceros / emparejamientos) y evita partidos fantasma.
    const ov = koOverride[k.m];
    if (ov && ov.home && ov.away) resolved[k.m] = { home: ov.home, away: ov.away };
  }
  return resolved;
}

// ---------- sincronización automática de resultados (API pública de ESPN) ----------
const espnTeamId = {};
TEAMS.forEach(t => [t.en, t.name, ...t.aliases].forEach(a => espnTeamId[normName(a)] = t.id));
let lastSync = { ts: 0, ok: null, applied: 0, error: null };
// Override de cruces de eliminatorias anclado a la REALIDAD de ESPN (por hora de inicio exacta). La asignación
// de mejores terceros / emparejamientos puede divergir del oficial; ESPN tiene los equipos reales de cada llave.
// m -> { home, away } (códigos nuestros). Se repuebla en cada sync. Evita mostrar/transmitir cruces equivocados.
let koOverride = {};
const koSlotByInstant = {};
KNOCKOUT.forEach(k => { if (k.datetime) { const t = new Date(k.datetime).getTime(); if (!isNaN(t)) koSlotByInstant[t] = k.m; } });

function dstr(offsetDays) {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
}

async function syncFromESPN(depth = 0) {
  try {
    // Rango COMPLETO del torneo, incluyendo partidos FUTUROS: además de reingerir resultados (auto-reparación
    // tras reinicios), trae los cruces YA programados por la FIFA/ESPN para anclar el bracket a la realidad
    // (koOverride). Si el rango terminaba "hoy", los partidos de mañana en adelante caían en el bracket COMPUTADO
    // (terceros aproximados) y mostraban cruces equivocados (p.ej. Bélgica vs Argelia en vez de Bélgica vs Senegal).
    const url = process.env.ESPN_TEST_URL ||
      `https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260611-20260720&limit=400`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    // PASO 0: anclar los cruces de eliminatorias a la realidad de ESPN por hora de inicio (las horas de nuestro
    // calendario coinciden con el oficial). Así corregimos emparejamientos mal computados (p.ej. mejores terceros)
    // ANTES de resolver el bracket → el partido real se reconoce y se ingiere/transmite correctamente.
    for (const ev of j.events || []) {
      const c = ev.competitions && ev.competitions[0]; if (!c || !ev.date) continue;
      const inst = new Date(ev.date).getTime(); const m = koSlotByInstant[inst];
      if (m == null) continue; // solo slots de eliminatoria con hora conocida (R32)
      const H = c.competitors.find(x => x.homeAway === 'home'), A = c.competitors.find(x => x.homeAway === 'away');
      if (!H || !A) continue;
      const hId = espnTeamId[normName(H.team.displayName)] || espnTeamId[normName(H.team.name)];
      const aId = espnTeamId[normName(A.team.displayName)] || espnTeamId[normName(A.team.name)];
      if (hId && aId) koOverride[m] = { home: hId, away: aId };
    }
    const bracket = resolveRealBracket();
    let changed = 0;
    const liveAlerts = []; // {matchId,hId,aId,hg,ag,kind:'start'|'goal'}
    for (const ev of j.events || []) {
      const c = ev.competitions && ev.competitions[0];
      if (!c) continue;
      const state = ev.status && ev.status.type && ev.status.type.state; // pre | in | post
      if (state !== 'in' && state !== 'post') continue;
      const H = c.competitors.find(x => x.homeAway === 'home');
      const A = c.competitors.find(x => x.homeAway === 'away');
      const hId = espnTeamId[normName(H.team.displayName)] || espnTeamId[normName(H.team.name)];
      const aId = espnTeamId[normName(A.team.displayName)] || espnTeamId[normName(A.team.name)];
      if (!hId || !aId) continue;
      const hg = Number(H.score) || 0, ag = Number(A.score) || 0;
      const minute = parseInt(ev.status.displayClock) || 0;
      const hPen = H.shootoutScore != null ? Number(H.shootoutScore) : null;
      const aPen = A.shootoutScore != null ? Number(A.shootoutScore) : null;

      // ¿partido de grupos? — el match por espnId debe coincidir también en equipos (blindaje)
      const sameTeams = f => (f.home === hId && f.away === aId) || (f.home === aId && f.away === hId);
      const byId = GROUP_FIXTURES.find(f => f.espnId === ev.id);
      const gf = (byId && sameTeams(byId)) ? byId : GROUP_FIXTURES.find(sameTeams);
      let matchId = null, payload = null;
      if (gf) {
        const flip = gf.home !== hId; // orientación del fixture oficial
        payload = {
          hg: flip ? ag : hg, ag: flip ? hg : ag,
          status: state === 'post' ? 'final' : 'live', minute,
        };
        matchId = gf.id;
      } else {
        // eliminatoria: localizar la llave cuyos equipos reales coinciden
        const m = Object.keys(bracket).find(m =>
          (bracket[m].home === hId && bracket[m].away === aId) ||
          (bracket[m].home === aId && bracket[m].away === hId));
        if (!m) continue;
        const flip = bracket[m].home !== hId;
        payload = {
          home: bracket[m].home, away: bracket[m].away,
          hg: flip ? ag : hg, ag: flip ? hg : ag,
          status: state === 'post' ? 'final' : 'live', minute,
        };
        if (hPen != null && aPen != null) {
          payload.pensHome = flip ? aPen > hPen : hPen > aPen;
        }
        matchId = String(m);
      }
      const prev = db.results[matchId];
      const same = prev && prev.status === payload.status && prev.hg === payload.hg &&
        prev.ag === payload.ag && prev.minute === payload.minute && prev.pensHome === payload.pensHome;
      if (!same) {
        db.results[matchId] = { ...(prev || {}), ...payload, source: 'espn' };
        changed++;
        console.log(`[sync] ${matchId}: ${payload.hg}-${payload.ag} ${payload.status}${payload.status === 'live' ? ` ${payload.minute}'` : ''}`);
        // detectar transiciones para alertas en vivo (inicio de partido / gol)
        try {
          const hId = gf ? gf.home : payload.home, aId = gf ? gf.away : payload.away;
          if (hId && aId && payload.status === 'live') {
            const wasLive = prev && (prev.status === 'live' || prev.status === 'final');
            const total = (payload.hg || 0) + (payload.ag || 0), ptotal = ((prev && prev.hg) || 0) + ((prev && prev.ag) || 0);
            if (!wasLive) liveAlerts.push({ matchId, hId, aId, hg: payload.hg, ag: payload.ag, kind: 'start' });
            else if (prev && total > ptotal) liveAlerts.push({ matchId, hId, aId, hg: payload.hg, ag: payload.ag, kind: 'goal' });
          }
        } catch { /* nunca romper el sync */ }
      }
    }
    lastSync = { ts: Date.now(), ok: true, applied: changed, error: null };
    if (changed) {
      // segunda pasada: con los grupos ya ingresados, el bracket real se resuelve y
      // los resultados de eliminatorias del mismo lote encuentran su llave
      if (depth === 0) await syncFromESPN(1);
      recomputeElos();
      runSims();
      broadcast('update', { reason: 'resultados en vivo (ESPN)', ts: Date.now() });
      // alertas de equipos seguidos (nunca debe romper el sync)
      if (depth === 0) dispatchPendingAlerts().catch(e => console.error('[alert] dispatch:', e.message));
      // alertas en vivo de inicio/gol (deduplicadas; el dedup evita dobles entre pasadas)
      if (liveAlerts.length) dispatchLiveAlerts(liveAlerts).catch(e => console.error('[alert] live:', e.message));
      // publicar resultados finales en el canal de Telegram (deduplicado)
      if (depth === 0) tgDispatchFinals().catch(e => console.error('[telegram] finals:', e.message));
    }
  } catch (e) {
    lastSync = { ts: Date.now(), ok: false, applied: 0, error: e.message };
    console.error('[sync] error:', e.message);
  }
}

// ---------- mercados (Polymarket + Kalshi) ----------
let marketCache = { ts: 0, polymarket: {}, kalshi: {}, errors: [] };
function normName(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim(); }
const aliasToId = {};
TEAMS.forEach(t => [t.en, t.name, ...t.aliases].forEach(a => aliasToId[normName(a)] = t.id));

// Fase J.1 — resolver OFICIAL V1 point-in-time para Value operativo. Mapea los nombres de equipo del evento
// (metadata del sportsbook / label) a códigos del motor y computa la probabilidad 1X2 oficial (Elo→Poisson→DC).
// V2 official weight = 0: NO interviene. Sin resolver ambos equipos → null (el evento se considera pero no produce
// GP → no STRONG; no se inventa nada). SÍNCRONO (buildEventInput lo llama sin await).
function v1GpResolver({ canonicalEventId, label, meta } = {}) {
  try {
    const m = meta || {};
    const hName = m.home_team || (label ? String(label).split(' vs ')[0] : null);
    const aName = m.away_team || (label ? String(label).split(' vs ')[1] : null);
    const h = aliasToId[normName(hName)], a = aliasToId[normName(aName)];
    if (!h || !a) return null;
    const eh = effElo(db.elos, h), ea = effElo(db.elos, a);
    const probs = matchProbs(eh, ea); // V1 oficial (mismo modelo que sirve el sitio)
    if (!probs || !Number.isFinite(probs.home)) return null;
    return {
      probabilities: { home: probs.home, draw: probs.draw, away: probs.away },
      model_version: 'gp-core-1.4.0', methodology_version: 'gp-core-1.4.0',
      sampleStatus: 'ok', calibrationStatus: 'calibrated', data_quality: 0.7,
      input_cutoff_at: new Date().toISOString(), calc_ts: new Date().toISOString(),
      home_code: h, away_code: a, elo_snapshot: { home: eh, away: ea },
    };
  } catch { return null; }
}

// Fase P — resolver OFICIAL V2: usa la probabilidad GP Intelligence V2 (base V1 + contexto) producida por el
// shadow autónomo y persistida en v2_probability_snapshots. Forward-only: la evaluación oficial posterior al
// cutover lleva model_family/version V2. Si no hay snapshot V2 fresco → BASE_ONLY_FALLBACK (no inventa contexto;
// usa la base V1 pero marca fallback → no genera STRONG). async (lee DB).
async function v2GpResolver({ canonicalEventId, label, meta } = {}) {
  try {
    const dbc = require('./database/client');
    const snap = canonicalEventId ? (await dbc.query(
      `SELECT final_probability_vector, base_probability_vector, context_adjustments, context_state, uncertainty, model_version
         FROM v2_probability_snapshots WHERE canonical_event_id=$1 ORDER BY created_at DESC LIMIT 1`, [canonicalEventId])).rows[0] : null;
    if (snap && snap.final_probability_vector) {
      const v = snap.final_probability_vector;
      if (Number.isFinite(Number(v.home))) return {
        probabilities: { home: Number(v.home), draw: Number(v.draw), away: Number(v.away) },
        model_version: snap.model_version || 'gp-intelligence-v2-0.1.0', methodology_version: 'gp-intelligence-v2-0.1.0',
        model_family: 'GP_INTELLIGENCE_V2', base_probability_vector: snap.base_probability_vector, context_adjustments: snap.context_adjustments,
        context_state: snap.context_state || 'FULL_CONTEXT', uncertainty: snap.uncertainty != null ? Number(snap.uncertainty) : null,
        fallback_status: 'FULL_CONTEXT', sampleStatus: 'ok', calibrationStatus: 'calibrated', data_quality: 0.7,
        input_cutoff_at: new Date().toISOString(), calc_ts: new Date().toISOString(),
      };
    }
    // sin snapshot V2 → fallback explícito a la base V1 (NO contexto inventado), marcado BASE_ONLY_FALLBACK.
    const base = v1GpResolver({ canonicalEventId, label, meta });
    if (!base) return null;
    return { ...base, model_version: 'gp-intelligence-v2-0.1.0', methodology_version: 'gp-intelligence-v2-0.1.0', model_family: 'GP_INTELLIGENCE_V2', context_state: 'BASE_ONLY_FALLBACK', fallback_status: 'BASE_ONLY_FALLBACK' };
  } catch { return null; }
}
// selector del resolver oficial según el modelo oficial efectivo (kill switch fuerza V1).
function officialGpResolver() {
  try { const eff = require('./model-registry/promotion').effectiveOfficialModel(); return eff === 'v2' ? v2GpResolver : v1GpResolver; } catch { return v1GpResolver; }
}

async function fetchMarkets(force = false) {
  if (!force && Date.now() - marketCache.ts < 60 * 1000) return marketCache;
  const next = { ts: Date.now(), polymarket: {}, kalshi: {}, errors: [] };
  // Polymarket — Gamma API (precio + volumen + liquidez + cambio 24h + link directo al mercado)
  try {
    const r = await fetch('https://gamma-api.polymarket.com/events?slug=world-cup-winner', { signal: AbortSignal.timeout(15000) });
    const ev = (await r.json())[0];
    for (const m of ev.markets || []) {
      const id = aliasToId[normName(m.groupItemTitle || m.question)];
      if (!id) continue;
      let price = null;
      try { price = Number(JSON.parse(m.outcomePrices)[0]); } catch { }
      const bid = m.bestBid != null ? Number(m.bestBid) : price;
      const ask = m.bestAsk != null ? Number(m.bestAsk) : price;
      if (price != null && !Number.isNaN(price)) next.polymarket[id] = {
        price, bid, ask,
        volume: Number(m.volumeNum || m.volume) || 0,
        volume24h: Number(m.volume24hr) || 0,
        liquidity: Number(m.liquidityNum || m.liquidity) || 0,
        change24h: Number(m.oneDayPriceChange) || 0,
        url: m.slug ? `https://polymarket.com/event/${ev.slug}/${m.slug}` : `https://polymarket.com/event/${ev.slug}`,
      };
    }
  } catch (e) { next.errors.push('Polymarket: ' + e.message); }
  // Kalshi — API pública (precio + volumen + interés abierto + cambio vs cierre anterior + link al evento)
  try {
    let cursor = '', pages = 0;
    while (pages++ < 5) {
      const url = `https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=KXMENWORLDCUP-26&limit=100${cursor ? '&cursor=' + cursor : ''}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      for (const m of j.markets || []) {
        const id = aliasToId[normName(m.no_sub_title || m.yes_sub_title)];
        if (!id) continue;
        const yesBid = m.yes_bid_dollars != null ? Number(m.yes_bid_dollars) : 1 - Number(m.no_ask_dollars);
        const yesAsk = m.yes_ask_dollars != null ? Number(m.yes_ask_dollars) : 1 - Number(m.no_bid_dollars);
        const last = Number(m.last_price_dollars) || 0;
        next.kalshi[id] = {
          price: last, bid: +yesBid.toFixed(4), ask: +yesAsk.toFixed(4),
          volume: Number(m.volume_fp) || 0,
          volume24h: Number(m.volume_24h_fp) || 0,
          openInterest: Number(m.open_interest_fp) || 0,
          change24h: +(last - (Number(m.previous_price_dollars) || last)).toFixed(4),
          ticker: m.ticker,
          url: 'https://kalshi.com/markets/kxmenworldcup/mens-world-cup-winner/kxmenworldcup-26',
        };
      }
      cursor = j.cursor;
      if (!cursor) break;
    }
  } catch (e) { next.errors.push('Kalshi: ' + e.message); }
  if (Object.keys(next.polymarket).length || Object.keys(next.kalshi).length) marketCache = next;
  else marketCache.errors = next.errors;
  return marketCache;
}

// ---------- mercados por partido (Polymarket: fifwc-*) ----------
// Los slugs usan códigos arbitrarios (kr, hai, rsa, che...) → descubrimiento por búsqueda
// de nombres, cacheado permanentemente en db.matchSlugs.
let matchMktCache = { ts: 0, matches: [] };
db.matchSlugs = db.matchSlugs || {};
db.marketSnapshots = db.marketSnapshots || {}; // probs implícitas del mercado capturadas antes del partido (closing line)
db.sentAlerts = db.sentAlerts || {};           // alertas ya enviadas por partido (evita reenvíos/spam)
db.refCodes = db.refCodes || {};               // referidos: code → email (lookup de quién refirió)
db.betaGrants = db.betaGrants || {};           // beta entitlement por admin: email → {status,grantedBy,grantedAt,reason}

// ===== Entitlement de la BETA (rollout sin migrar usuarios) =====
// La plataforma nueva (premium /x) y la actual (app.js) conviven; un router por usuario decide cuál mostrar.
// Reglas: (1) GP_BETA_FUSION_ENABLED=true → fin de beta, TODOS los registrados a la nueva. (2) grant admin
// (active) → acceso; suspended/revoked → bloqueado. (3) >= N referidos VERIFICADOS → acceso automático.
// Misma cuenta/sesión/DB; solo cambia la interfaz. No se pierde nada (referidos/seguidos/historial/etc.).
function betaBool(v) { return /^(1|true|yes|on)$/i.test(String(v == null ? '' : v).trim()); }
function betaFusionOn() { return betaBool(process.env.GP_BETA_FUSION_ENABLED); }
function betaReferralsRequired() { const n = parseInt(process.env.GP_BETA_REFERRALS_REQUIRED, 10); return Number.isFinite(n) && n > 0 ? n : 5; }
function verifiedReferralCount(email) {
  const u = db.users[email]; if (!u || !Array.isArray(u.referrals)) return 0;
  return u.referrals.filter(e => db.users[e] && db.users[e].verified).length;
}
function betaEntitlement(email) {
  const required = betaReferralsRequired();
  const verified = verifiedReferralCount(email);
  const grant = db.betaGrants[email] || null;
  const fusion = betaFusionOn();
  let access = false, source = null, status = grant ? grant.status : null;
  if (fusion) { access = true; source = 'fusion'; }
  else if (grant && (grant.status === 'suspended' || grant.status === 'revoked')) { access = false; source = grant.status; }
  else if (grant && grant.status === 'active') { access = true; source = 'admin'; }
  else if (verified >= required) { access = true; source = 'referrals'; }
  return {
    access, source, status,
    granted_by: grant ? grant.grantedBy || null : null,
    granted_at: grant ? grant.grantedAt || null : null,
    reason: grant ? grant.reason || null : null,
    verified_referrals: verified, referrals_required: required,
  };
}

// Genera (si falta) un código de referido único para un usuario. Link: gpsimulador.com/?ref=<code>
function ensureRefCode(email) {
  const u = db.users[email];
  if (!u) return null;
  if (!u.refCode) {
    const base = email.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 4).toLowerCase() || 'gp';
    let code;
    do { code = base + crypto.randomBytes(2).toString('hex'); } while (db.refCodes[code]);
    u.refCode = code; db.refCodes[code] = email; save();
  }
  return u.refCode;
}

function teamTokens(id) {
  const t = teamById[id];
  return [t.en, ...t.aliases].map(normName);
}

async function discoverMatchSlug(f) {
  if (db.matchSlugs[f.id]) return db.matchSlugs[f.id];
  const h = teamById[f.home], a = teamById[f.away];
  const queries = [`${h.en} ${a.en}`, `${h.aliases[0] || h.en} ${a.aliases[0] || a.en}`];
  const fDate = new Date(f.datetime).getTime();
  for (const q of queries) {
    try {
      const r = await fetch(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=6`,
        { signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      for (const ev of j.events || []) {
        if (!/^fifwc-/.test(ev.slug)) continue;
        const m = ev.slug.match(/(\d{4}-\d{2}-\d{2})$/);
        if (!m) continue;
        const dDiff = Math.abs(new Date(m[1] + 'T12:00Z').getTime() - fDate);
        if (dDiff > 2 * 86400000) continue; // otro partido de los mismos equipos
        const title = normName(ev.title || '');
        const hOk = teamTokens(f.home).some(t => title.includes(t));
        const aOk = teamTokens(f.away).some(t => title.includes(t));
        if (hOk && aOk) {
          db.matchSlugs[f.id] = ev.slug;
          save();
          console.log(`[matches] slug descubierto ${f.id} → ${ev.slug}`);
          return ev.slug;
        }
      }
    } catch { /* siguiente query */ }
  }
  return null;
}

async function fetchMatchMarkets(force = false) {
  if (!force && Date.now() - matchMktCache.ts < 60 * 1000) return matchMktCache;
  const now = Date.now();
  // grupos con horario + eliminatorias con equipos ya resueltos
  const bracket = resolveRealBracket();
  const upcoming = [
    ...GROUP_FIXTURES.map(f => ({ ...f, _h: f.home, _a: f.away })),
    ...KNOCKOUT.filter(k => bracket[k.m] && bracket[k.m].home && bracket[k.m].away)
      .map(k => ({ id: String(k.m), datetime: k.datetime || k.date + 'T18:00Z', _h: bracket[k.m].home, _a: bracket[k.m].away })),
  ].filter(f => {
    const t = new Date(f.datetime).getTime();
    return t > now - 5 * 3600000 && t < now + 60 * 3600000; // en vivo + próximas ~2.5 jornadas
  }).sort((x, y) => x.datetime.localeCompare(y.datetime));

  const out = [];
  let discoveries = 0;
  for (const f of upcoming) {
    let slug = db.matchSlugs[f.id];
    if (!slug && discoveries < 5) { discoveries++; slug = await discoverMatchSlug({ ...f, home: f._h, away: f._a }); }
    if (!slug) continue;
    try {
      const r = await fetch(`https://gamma-api.polymarket.com/events?slug=${slug}`, { signal: AbortSignal.timeout(10000) });
      const ev = (await r.json())[0];
      if (!ev || !ev.markets) continue;
      const outcomes = {};
      for (const m of ev.markets) {
        let side = null;
        const gt = normName(m.groupItemTitle || m.question || '');
        if (/draw|empate/.test(gt)) side = 'draw';
        else if (teamTokens(f._h).some(t => gt.includes(t))) side = 'home';
        else if (teamTokens(f._a).some(t => gt.includes(t))) side = 'away';
        if (!side) continue;
        let price = null;
        try { price = Number(JSON.parse(m.outcomePrices)[0]); } catch { }
        outcomes[side] = {
          price, bid: m.bestBid != null ? Number(m.bestBid) : price,
          ask: m.bestAsk != null ? Number(m.bestAsk) : price,
          volume: Number(m.volumeNum || m.volume) || 0,
          url: `https://polymarket.com/event/${slug}/${m.slug}`,
        };
      }
      if (!outcomes.home || !outcomes.away) continue;
      // probabilidades del modelo (condicionadas al marcador si está en vivo)
      const res = db.results[f.id];
      const probs = (res && res.status === 'live')
        ? liveMatchProbs(effElo(db.elos, f._h), effElo(db.elos, f._a), res.hg, res.ag, res.minute)
        : matchProbs(effElo(db.elos, f._h), effElo(db.elos, f._a));
      // Reglas de recomendación:
      // - COMPRAR SÍ: respaldar un resultado infravalorado por el mercado, con prob. real ≥30% (nunca longshot).
      // - COMPRAR NO: ir contra un resultado SOBREVALORADO, pero NUNCA contra el favorito del modelo
      //   (apostar contra tu propio pronóstico no tiene sentido).
      const MIN_BACK = 0.30;
      const top = ['home', 'draw', 'away'].reduce((a, b) => probs[a] >= probs[b] ? a : b); // pick del modelo
      const edges = [];
      for (const side of ['home', 'draw', 'away']) {
        const o = outcomes[side]; if (!o) continue;
        const p = probs[side];
        if (o.ask > 0.001 && p - o.ask > 0.04 && p >= MIN_BACK) edges.push({ side, type: 'COMPRAR SÍ', edge: +(p - o.ask).toFixed(4) });
        else if (o.bid > 0.001 && o.bid - p > 0.04 && (1 - p) >= MIN_BACK && side !== top) edges.push({ side, type: 'COMPRAR NO', edge: +(o.bid - p).toFixed(4) });
      }
      // Snapshot del mercado ANTES del kickoff (probs implícitas sin vig) para el marcador modelo-vs-mercado.
      // Se sobreescribe hasta que arranca el partido → queda la "closing line".
      const sumP = (outcomes.home ? outcomes.home.price : 0) + (outcomes.draw ? outcomes.draw.price : 0) + (outcomes.away ? outcomes.away.price : 0);
      if (sumP > 0.5 && Date.now() < new Date(f.datetime).getTime()) {
        db.marketSnapshots[f.id] = {
          home: +((outcomes.home ? outcomes.home.price : 0) / sumP).toFixed(4),
          draw: +((outcomes.draw ? outcomes.draw.price : 0) / sumP).toFixed(4),
          away: +((outcomes.away ? outcomes.away.price : 0) / sumP).toFixed(4),
          ts: Date.now(),
        };
        save();
      }
      out.push({
        fixtureId: f.id, home: f._h, away: f._a, datetime: f.datetime,
        live: !!(res && res.status === 'live'), result: res || null,
        outcomes, model: { home: probs.home, draw: probs.draw, away: probs.away }, edges,
        eventUrl: `https://polymarket.com/event/${slug}`,
      });
    } catch { /* partido sin mercado accesible */ }
  }
  matchMktCache = { ts: Date.now(), matches: out };
  return matchMktCache;
}

// ---------- track record público del modelo ----------
function trackRecord() {
  const elos = {};
  TEAMS.forEach(t => { elos[t.id] = t.elo; });
  const finished = [];
  const koFin = KNOCKOUT.filter(k => {
    const r = db.results[String(k.m)];
    return r && r.status === 'final' && r.home && r.away;
  }).map(k => ({ id: String(k.m), datetime: k.datetime || k.date, ko: true }));
  const all = [
    ...GROUP_FIXTURES.filter(f => db.results[f.id] && db.results[f.id].status === 'final')
      .map(f => ({ id: f.id, datetime: f.datetime, home: f.home, away: f.away })),
    ...koFin,
  ].sort((x, y) => String(x.datetime).localeCompare(String(y.datetime)));
  for (const f of all) {
    const r = db.results[f.id];
    const h = f.home || r.home, a = f.away || r.away;
    // predicción con los Elo PREVIOS a ese partido (lo que el modelo decía antes del pitazo)
    const probs = matchProbs(effElo(elos, h), effElo(elos, a));
    const picks = [['home', probs.home], ['draw', probs.draw], ['away', probs.away]].sort((x, y) => y[1] - x[1]);
    const predicted = picks[0][0];
    const actual = r.hg > r.ag ? 'home' : r.hg < r.ag ? 'away' : 'draw';
    finished.push({
      id: f.id, datetime: f.datetime, home: h, away: a, hg: r.hg, ag: r.ag,
      predicted, predictedProb: +picks[0][1].toFixed(4),
      probs: { home: +probs.home.toFixed(4), draw: +probs.draw.toFixed(4), away: +probs.away.toFixed(4) },
      likelyScore: probs.likelyScore,
      correct: predicted === actual,
      exact: probs.likelyScore === `${r.hg}-${r.ag}`,
    });
    const [nh, na] = eloUpdate(elos[h], elos[a], r.hg, r.ag, teamById[h].host, teamById[a].host);
    elos[h] = nh; elos[a] = na;
  }
  // calibración: Brier multiclase (0=perfecto, 0.66=azar 3-vías) y prob. media al resultado real
  let brier = 0, sumActual = 0;
  for (const m of finished) {
    const act = m.hg > m.ag ? 'home' : m.hg < m.ag ? 'away' : 'draw';
    ['home', 'draw', 'away'].forEach(k => { const o = k === act ? 1 : 0; brier += (m.probs[k] - o) ** 2; });
    sumActual += m.probs[act];
  }
  const n = finished.length || 1;
  return {
    total: finished.length,
    winners: finished.filter(x => x.correct).length,
    exact: finished.filter(x => x.exact).length,
    brier: +(brier / n).toFixed(3),
    avgProbActual: +(sumActual / n).toFixed(3),
    vsMarket: scoreboard(finished),
    matches: finished.reverse(),
  };
}

// Marcador objetivo: ¿le ganamos al mercado? Compara Brier del modelo vs Brier del mercado
// en los partidos donde capturamos la línea de cierre (snapshot pre-partido).
function scoreboard(finished) {
  let mb = 0, kb = 0, nn = 0, modelWins = 0;
  const rows = [];
  for (const m of finished) {
    const snap = db.marketSnapshots[m.id];
    if (!snap) continue;
    const act = m.hg > m.ag ? 'home' : m.hg < m.ag ? 'away' : 'draw';
    let bm = 0, bk = 0;
    ['home', 'draw', 'away'].forEach(k => {
      const o = k === act ? 1 : 0;
      bm += (m.probs[k] - o) ** 2;
      bk += ((snap[k] || 0) - o) ** 2;
    });
    mb += bm; kb += bk; nn++;
    if (bm < bk) modelWins++;
    rows.push({ id: m.id, home: m.home, away: m.away, modelBrier: +bm.toFixed(3), marketBrier: +bk.toFixed(3), modelWon: bm < bk });
  }
  return {
    n: nn,
    modelBrier: nn ? +(mb / nn).toFixed(3) : null,
    marketBrier: nn ? +(kb / nn).toFixed(3) : null,
    modelWins, rows: rows.reverse(),
  };
}

// ---------- alertas por email de equipos seguidos ----------
function matchTeams(matchId) {
  const r = db.results[matchId];
  if (!r || r.status !== 'final') return null;
  if (/^G/.test(matchId)) {
    const f = GROUP_FIXTURES.find(x => x.id === matchId);
    return f ? { home: f.home, away: f.away, hg: r.hg, ag: r.ag } : null;
  }
  return (r.home && r.away) ? { home: r.home, away: r.away, hg: r.hg, ag: r.ag } : null;
}

function alertEmail(followedNames, info, champLine) {
  const h = teamById[info.home], a = teamById[info.away];
  const won = info.hg > info.ag ? h.name : info.hg < info.ag ? a.name : null;
  const resLine = won ? `Ganó ${won}` : 'Terminó en empate';
  const subject = `⚽ ${h.name} ${info.hg}-${info.ag} ${a.name}`;
  const text = `Actualización de ${followedNames.join(' y ')}:\n\n${h.flag} ${h.name} ${info.hg} - ${info.ag} ${a.name} ${a.flag}\n${resLine}.\n\n${champLine}\n\nMira las probabilidades actualizadas: https://gpsimulador.com\n\n— GP Simulador del Mundial\n(Para dejar de recibir estas alertas, entra y desactívalas en la pestaña Seguidos.)`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#14201A">
<h2 style="margin-bottom:4px">⚽ GP Simulador del Mundial</h2>
<p style="color:#555">Actualización de <b>${followedNames.join(' y ')}</b></p>
<div style="background:#0E2A1E;color:#fff;border-radius:12px;padding:18px 20px;text-align:center;margin:14px 0">
  <div style="font-size:26px;font-weight:800">${h.flag} ${info.hg} - ${info.ag} ${a.flag}</div>
  <div style="font-size:14px;color:#9FD9BE;margin-top:4px">${h.name} vs ${a.name} · ${resLine}</div>
</div>
<p style="font-size:14px">${champLine}</p>
<p><a href="https://gpsimulador.com" style="display:inline-block;background:#0E9F6E;color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:99px">Ver probabilidades actualizadas →</a></p>
<p style="color:#999;font-size:11px">Para dejar de recibir alertas, entra y desactívalas en la pestaña Seguidos.</p>
</div>`;
  return { subject, text, html };
}

// Envía alertas de un partido finalizado a quienes siguen alguno de los dos equipos
async function sendTeamAlerts(matchIds) {
  if (!mailer.isConfigured()) return;
  for (const matchId of matchIds) {
    if (db.sentAlerts[matchId]) continue;
    const info = matchTeams(matchId);
    if (!info) continue;
    let sent = 0;
    for (const [email, u] of Object.entries(db.users)) {
      if (u.alerts === false) continue;
      const prefs = u.alertPrefs || {};
      const ev = prefs.events || {}, ch = prefs.channels || {};
      if (ev.result === false) continue;        // evento "resultado final" desactivado
      if (ch.email === false) continue;          // canal email desactivado
      const muted = prefs.mutedTeams || [];
      const favs = u.favorites || [];
      const followed = [info.home, info.away].filter(t => favs.includes(t) && !muted.includes(t));
      if (!followed.length) continue;
      const names = followed.map(t => teamById[t].name);
      // línea de campeonato del primer equipo seguido
      const ft = followed[0];
      const champ = simCache[ft] ? (simCache[ft].champion * 100).toFixed(1) : null;
      const champLine = champ ? `Probabilidad de ${teamById[ft].name} de ser campeón ahora: ${champ}%.` : '';
      try {
        await mailer.sendMail({ to: email, ...alertEmail(names, info, champLine) });
        sent++;
      } catch (e) { console.error('[alert]', email, e.message); }
    }
    db.sentAlerts[matchId] = Date.now();
    save();
    if (sent) console.log(`[alert] ${matchId}: ${sent} correos enviados`);
  }
}

// Email de alerta en vivo (inicio de partido / gol)
// Email masivo de novedades (re-engancha a usuarios que entraron antes de las nuevas features)
// Estado del envío masivo (en memoria) para el envío en segundo plano + poll de progreso desde Admin.
let bcastState = { running: false, sent: 0, failed: 0, total: 0, startedAt: null, finishedAt: null, test: false };

// Idioma del usuario para marketing: 1) idioma EXPLÍCITO elegido (perfil/toggle) — manda; 2) si no, se infiere
// del país (es para países hispanohablantes, en para el resto); 3) default es (audiencia LATAM).
const ES_COUNTRIES = new Set(['AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'SV', 'GT', 'HN', 'MX', 'NI', 'PA', 'PY', 'PE', 'PR', 'ES', 'UY', 'VE', 'GQ']);
function userLang(email) {
  const u = db.users[email]; if (!u) return 'es';
  if (u.lang === 'en' || u.lang === 'es') return u.lang;
  const c = (u.country || '').toUpperCase();
  if (c) return ES_COUNTRIES.has(c) ? 'es' : 'en';
  return 'es';
}

// Email de anuncio de la BETA (rollout por referidos). CTA → ventana de Referidos del usuario (?goto=referidos).
// Conciso, una sola acción clara, multipart text+html (mejor entregabilidad), sin imágenes externas ni palabras
// "spammy", con motivo de recepción + baja. El From verificado (codigo@gpsimulador.com, SPF/DKIM Resend) hace el resto.
function broadcastEmail(referLink, lang) {
  if (lang === 'en') return broadcastEmailEN(referLink);
  const subject = 'Tu acceso anticipado a la beta de GP Intelligence';
  const preheader = 'Invita a 5 amigos y desbloquea Picks, Value, arbitraje y la nueva terminal — gratis.';
  const text = `Hola,

Estamos abriendo la BETA de GP Intelligence: una versión nueva, mucho más potente, del GP Simulador del Mundial.

Qué incluye la beta:
• Picks GP — selecciones del modelo con seguimiento honesto.
• Oportunidades de Value y de arbitraje (modelo vs mercado).
• Un modelo más potente y mejor calibrado, con contexto en vivo.
• Comparación entre más de 40 casas de apuestas.
• Nueva terminal de inteligencia deportiva (más rápida y completa).

Cómo entrar — gratis:
Invita a 5 amigos verificados con tu link personal. Cuando se registren, se te desbloquea el acceso a la beta automáticamente. (Yo también puedo darte acceso manual.)

Abre tu ventana de referidos, copia tu link y mira tu progreso (0/5):
${referLink}

Tu cuenta, tus seguidos, tu historial y tus alertas siguen igual: la beta es la misma cuenta, con una experiencia nueva.

— Alexis · GP Simulador del Mundial

Recibes este correo porque tienes una cuenta en GP Simulador. Para no recibir novedades, responde a este correo con "baja".`;
  const html = `<div style="background:#f4f6f5;padding:24px 12px;margin:0">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f6f5">${preheader}</span>
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:linear-gradient(135deg,#0E2A1E,#0a1f16);padding:26px 26px 22px;color:#fff">
      <div style="font-size:13px;letter-spacing:.08em;color:#18E6A3;font-weight:700;text-transform:uppercase">Acceso anticipado</div>
      <h1 style="margin:8px 0 0;font-size:23px;line-height:1.25">Te invitamos a la beta de <span style="color:#18E6A3">GP Intelligence</span></h1>
      <p style="margin:10px 0 0;font-size:14px;color:#c7d3ce;line-height:1.5">Una versión nueva y mucho más potente del GP Simulador del Mundial. La misma cuenta, una experiencia nueva.</p>
    </div>
    <div style="padding:22px 26px">
      <p style="margin:0 0 12px;font-size:14px;color:#14201A;font-weight:700">Qué desbloqueas en la beta</p>
      <ul style="margin:0 0 20px;padding-left:18px;line-height:1.7;font-size:14px;color:#2b3a33">
        <li><b>Picks GP</b> — selecciones del modelo con seguimiento honesto.</li>
        <li><b>Value y arbitraje</b> — oportunidades del modelo frente al mercado.</li>
        <li><b>Modelo más potente y calibrado</b>, con contexto en vivo.</li>
        <li>Comparación entre <b>más de 40 casas</b> de apuestas.</li>
        <li>Nueva <b>terminal de inteligencia deportiva</b>.</li>
      </ul>
      <div style="background:#f0faf6;border:1px solid #cdeede;border-radius:12px;padding:16px 18px;margin:0 0 20px">
        <p style="margin:0 0 6px;font-size:15px;color:#0E2A1E;font-weight:800">Cómo entrar — gratis</p>
        <p style="margin:0;font-size:13.5px;color:#3a4a42;line-height:1.55">Invita a <b>5 amigos verificados</b> con tu link personal. Cuando se registren, tu acceso a la beta se desbloquea solo.</p>
      </div>
      <p style="text-align:center;margin:0 0 8px">
        <a href="${referLink}" style="display:inline-block;background:#0E9F6E;color:#fff;text-decoration:none;font-weight:800;padding:15px 30px;border-radius:99px;font-size:15px">Ver mi progreso e invitar →</a>
      </p>
      <p style="text-align:center;margin:0 0 22px;font-size:12px;color:#8a9a92">Abre tu ventana de referidos, copia tu link y mira tu progreso (0/5).</p>
      <p style="margin:0;font-size:13px;color:#5a6a62;line-height:1.5">Tus seguidos, historial, alertas y preferencias siguen intactos. La beta es tu misma cuenta.</p>
    </div>
    <div style="border-top:1px solid #eef2f0;padding:16px 26px;background:#fbfcfb">
      <p style="margin:0 0 4px;font-size:13px;color:#3a4a42">✈️ ¿Quieres oportunidades y resultados en vivo? <a href="https://t.me/gpsimulador" style="color:#0E9F6E;font-weight:700;text-decoration:none">Únete a nuestro canal de Telegram</a>.</p>
      <p style="margin:8px 0 0;font-size:11px;color:#9aa8a1">Recibes este correo porque tienes una cuenta en GP Simulador del Mundial. Para no recibir novedades, responde con "baja".</p>
    </div>
  </div>
</div>`;
  return { subject, text, html };
}

// Anuncio de la BETA — versión EN.
function broadcastEmailEN(referLink) {
  const subject = 'Your early access to the GP Intelligence beta';
  const preheader = 'Invite 5 friends and unlock Picks, Value, arbitrage and the new terminal — free.';
  const text = `Hi,

We're opening the GP Intelligence beta: a new, much more powerful version of the World Cup GP Simulator.

What's inside the beta:
• GP Picks — model selections with honest tracking.
• Value and arbitrage opportunities (model vs market).
• A stronger, better-calibrated model with live context.
• Comparison across 40+ sportsbooks.
• A new sports intelligence terminal (faster and more complete).

How to get in — free:
Invite 5 verified friends with your personal link. Once they sign up, beta access unlocks automatically. (I can also grant it manually.)

Open your referrals page, copy your link and see your progress (0/5):
${referLink}

Your account, follows, history and alerts stay the same: the beta is the same account, with a new experience.

— Alexis · World Cup GP Simulator

You're getting this because you have an account at GP Simulador. To stop receiving updates, reply "unsubscribe".`;
  const html = `<div style="background:#f4f6f5;padding:24px 12px;margin:0">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f6f5">${preheader}</span>
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:linear-gradient(135deg,#0E2A1E,#0a1f16);padding:26px 26px 22px;color:#fff">
      <div style="font-size:13px;letter-spacing:.08em;color:#18E6A3;font-weight:700;text-transform:uppercase">Early access</div>
      <h1 style="margin:8px 0 0;font-size:23px;line-height:1.25">You're invited to the <span style="color:#18E6A3">GP Intelligence</span> beta</h1>
      <p style="margin:10px 0 0;font-size:14px;color:#c7d3ce;line-height:1.5">A new, far more powerful version of the World Cup GP Simulator. Same account, new experience.</p>
    </div>
    <div style="padding:22px 26px">
      <p style="margin:0 0 12px;font-size:14px;color:#14201A;font-weight:700">What you unlock in the beta</p>
      <ul style="margin:0 0 20px;padding-left:18px;line-height:1.7;font-size:14px;color:#2b3a33">
        <li><b>GP Picks</b> — model selections with honest tracking.</li>
        <li><b>Value and arbitrage</b> — model opportunities vs the market.</li>
        <li><b>Stronger, better-calibrated model</b>, with live context.</li>
        <li>Comparison across <b>40+ sportsbooks</b>.</li>
        <li>A new <b>sports intelligence terminal</b>.</li>
      </ul>
      <div style="background:#f0faf6;border:1px solid #cdeede;border-radius:12px;padding:16px 18px;margin:0 0 20px">
        <p style="margin:0 0 6px;font-size:15px;color:#0E2A1E;font-weight:800">How to get in — free</p>
        <p style="margin:0;font-size:13.5px;color:#3a4a42;line-height:1.55">Invite <b>5 verified friends</b> with your personal link. Once they sign up, your beta access unlocks automatically.</p>
      </div>
      <p style="text-align:center;margin:0 0 8px">
        <a href="${referLink}" style="display:inline-block;background:#0E9F6E;color:#fff;text-decoration:none;font-weight:800;padding:15px 30px;border-radius:99px;font-size:15px">See my progress & invite →</a>
      </p>
      <p style="text-align:center;margin:0 0 22px;font-size:12px;color:#8a9a92">Open your referrals page, copy your link and track your progress (0/5).</p>
      <p style="margin:0;font-size:13px;color:#5a6a62;line-height:1.5">Your follows, history, alerts and preferences stay intact. The beta is your same account.</p>
    </div>
    <div style="border-top:1px solid #eef2f0;padding:16px 26px;background:#fbfcfb">
      <p style="margin:0 0 4px;font-size:13px;color:#3a4a42">✈️ Want live opportunities and results? <a href="https://t.me/gpsimulador" style="color:#0E9F6E;font-weight:700;text-decoration:none">Join our Telegram channel</a>.</p>
      <p style="margin:8px 0 0;font-size:11px;color:#9aa8a1">You're getting this because you have an account at GP Simulador. To stop receiving updates, reply "unsubscribe".</p>
    </div>
  </div>
</div>`;
  return { subject, text, html };
}

// Email de REACTIVACIÓN — estrategia "bandeja PRINCIPAL" (no Promociones): se ve como un correo PERSONAL 1:1,
// no como campaña. HTML mínimo (solo párrafos, sin botones/cards/imágenes/colores), remitente con nombre de
// persona, asunto conversacional en minúscula, un solo enlace en texto plano, y la baja en el cuerpo (sin el
// header List-Unsubscribe, que delata correo masivo). Objetivo: reenganchar a quien hace días no entra.
function reengageEmail(referLink, lang) {
  if (lang === 'en') {
    const subject = 'I know you keep losing money betting';
    const text = `Hi,

I'll be blunt: almost everyone loses money betting because they play against the house with no real info.

That's why I built GP Simulador: it simulates the World Cup 10,000 times and shows you where the market is wrong.

I just opened a new, much more powerful version, and I want you to try it. Log in with your same account at gpsimulador.com and go to "Invite": I'll explain how to unlock it there.

Want to try it? If you have any questions, just reply to this email.

Alexis
GP Simulador

(If you'd rather not get more emails, reply "unsubscribe".)`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:540px">` +
      text.split('\n\n').map(function (p) { return '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>') + '</p>'; }).join('') + `</div>`;
    return { subject, text, html };
  }
  const subject = 'ya sé que estás perdiendo dinero apostando';
  // SIN enlaces (los links empujan a Promociones; el email de código llega a Principal porque no tiene ninguno),
  // corto, personal, y termina con una PREGUNTA (invitar respuesta es señal fuerte de Principal). Sin "gratis".
  const text = `Hola,

Casi todos pierden plata apostando por ir contra la casa sin información real.

Para eso hice GP Simulador: simula el Mundial 10.000 veces y te muestra dónde el mercado se equivoca.

Hace poco abrí una versión nueva, bastante más potente, y quiero que la pruebes. Entrá con tu misma cuenta en gpsimulador.com y andá a "Invitar": ahí te explico cómo activarla.

¿La probás? Si tenés cualquier duda, respondé este correo y te leo.

Alexis
GP Simulador

(Si no querés recibir más correos, respondé "baja".)`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:540px">` +
    text.split('\n\n').map(function (p) { return '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>') + '</p>'; }).join('') +
    `</div>`;
  return { subject, text, html };
}
const REENGAGE_FROM = 'Alexis de GP Simulador <codigo@gpsimulador.com>';

function liveAlertEmail(h, aw, a) {
  const isGoal = a.kind === 'goal';
  const subject = isGoal ? `⚽ GOL · ${h.name} ${a.hg}-${a.ag} ${aw.name}` : `▶ Empezó · ${h.name} vs ${aw.name}`;
  const head = isGoal ? '⚽ ¡Gol!' : '▶ ¡Arrancó el partido!';
  const line = isGoal ? `${h.flag} ${h.name} ${a.hg} - ${a.ag} ${aw.name} ${aw.flag}` : `${h.flag} ${h.name} vs ${aw.name} ${aw.flag}`;
  const text = `${head}\n\n${line}\n\nSigue las probabilidades EN VIVO: https://gpsimulador.com\n\n— GP Simulador del Mundial\n(Gestiona tus alertas en la pestaña Alertas.)`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#14201A">
<h2 style="margin-bottom:4px">${head}</h2>
<div style="background:#0E2A1E;color:#fff;border-radius:12px;padding:18px 20px;text-align:center;margin:14px 0">
  <div style="font-size:26px;font-weight:800">${isGoal ? `${h.flag} ${a.hg} - ${a.ag} ${aw.flag}` : `${h.flag} vs ${aw.flag}`}</div>
  <div style="font-size:14px;color:#9FD9BE;margin-top:4px">${h.name} ${isGoal ? 'vs' : 'vs'} ${aw.name}</div>
</div>
<p><a href="https://gpsimulador.com" style="display:inline-block;background:#0E9F6E;color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:99px">Ver probabilidades EN VIVO →</a></p>
<p style="color:#999;font-size:11px">Gestiona o desactiva tus alertas en la pestaña Alertas.</p>
</div>`;
  return { subject, text, html };
}

// Despacha alertas en vivo (inicio/gol) a quienes siguen alguno de los dos equipos. Deduplicado por clave.
async function dispatchLiveAlerts(list) {
  if (!mailer.isConfigured()) return;
  for (const a of list) {
    const key = a.kind === 'start' ? `${a.matchId}:start` : `${a.matchId}:g${a.hg}-${a.ag}`;
    if (db.sentAlerts[key]) continue;
    const h = teamById[a.hId], aw = teamById[a.aId];
    if (!h || !aw) continue;
    let sent = 0;
    for (const [email, u] of Object.entries(db.users)) {
      if (u.alerts === false) continue;
      const prefs = u.alertPrefs || {};
      const ev = prefs.events || {}, ch = prefs.channels || {};
      if (ch.email === false) continue;
      if (a.kind === 'start' && ev.matchStart === false) continue;
      if (a.kind === 'goal' && ev.goal === false) continue;
      const muted = prefs.mutedTeams || [];
      const favs = u.favorites || [];
      if (![a.hId, a.aId].some(t => favs.includes(t) && !muted.includes(t))) continue;
      try { await mailer.sendMail({ to: email, ...liveAlertEmail(h, aw, a) }); sent++; }
      catch (e) { console.error('[alert]', email, e.message); }
    }
    db.sentAlerts[key] = Date.now();
    save();
    if (sent) console.log(`[alert] ${a.kind} ${a.matchId}: ${sent} correos enviados`);
  }
}

// Revisa todos los partidos finalizados y alerta los que aún no se han notificado
async function dispatchPendingAlerts() {
  const finals = [];
  for (const f of GROUP_FIXTURES) {
    const r = db.results[f.id];
    if (r && r.status === 'final' && !db.sentAlerts[f.id]) finals.push(f.id);
  }
  for (const k of KNOCKOUT) {
    const id = String(k.m), r = db.results[id];
    if (r && r.status === 'final' && r.home && !db.sentAlerts[id]) finals.push(id);
  }
  if (finals.length) await sendTeamAlerts(finals);
}

// Al arrancar: marca como "ya vistos" los partidos finalizados existentes (no reenviar histórico)
function markExistingFinalsSeen() {
  let n = 0;
  const mark = id => { if (db.results[id] && db.results[id].status === 'final' && !db.sentAlerts[id]) { db.sentAlerts[id] = Date.now(); n++; } };
  GROUP_FIXTURES.forEach(f => mark(f.id));
  KNOCKOUT.forEach(k => mark(String(k.m)));
  if (n) { save(); console.log(`[alert] ${n} partidos finalizados marcados como vistos (sin reenviar)`); }
}

// ---------- Telegram: auto-publicación al canal ----------
db.sentTg = db.sentTg || {}; // dedup de lo ya publicado en Telegram
const tgPct = v => (v * 100).toFixed(0) + '%';

// "Lo que dice el modelo para hoy" — próximos partidos del día con 1X2 del modelo
function tgDailyText() {
  const today = new Date().toISOString().slice(0, 10);
  const ups = GROUP_FIXTURES
    .filter(f => f.datetime.slice(0, 10) === today && !(db.results[f.id] && db.results[f.id].status === 'final'))
    .sort((a, b) => a.datetime.localeCompare(b.datetime)).slice(0, 6);
  if (!ups.length) return null;
  const lines = ups.map(f => {
    const p = matchProbs(effElo(db.elos, f.home), effElo(db.elos, f.away));
    const h = teamById[f.home], a = teamById[f.away];
    return `${h.flag} <b>${h.name}</b> vs <b>${a.name}</b> ${a.flag}\n   ${tgPct(p.home)} · empate ${tgPct(p.draw)} · ${tgPct(p.away)}`;
  });
  return `📊 <b>Lo que dice el modelo para hoy</b>\n\n${lines.join('\n')}\n\n⚡ Se mueven en vivo con cada gol:\n👉 <a href="https://gpsimulador.com/?ref=tg">gpsimulador.com</a>`;
}
function tgFinalText(id) {
  const info = matchTeams(id); if (!info) return null;
  const h = teamById[info.home], a = teamById[info.away];
  const won = info.hg > info.ag ? h.name : info.hg < info.ag ? a.name : null;
  return `⚽ <b>FINAL</b>\n${h.flag} <b>${h.name} ${info.hg} - ${info.ag} ${a.name}</b> ${a.flag}\n${won ? 'Ganó ' + won : 'Terminó en empate'}\n\n👉 <a href="https://gpsimulador.com/?ref=tg">Probabilidades actualizadas</a>`;
}
function tgOppText(row, e) {
  const t = teamById[row.id], pc = v => (v * 100).toFixed(1);
  if (e.type === 'arbitraje') return `💸 <b>Arbitraje entre plataformas</b>\n${t.flag} <b>${t.name}</b> · campeón del Mundial\n\n${e.note}\n\n⚠️ Estimación entre Polymarket y Kalshi. El margen real depende de la ejecución, las comisiones y la liquidación de cada plataforma. No es consejo financiero.\n\n👉 <a href="https://gpsimulador.com/?ref=tg">Ver en gpsimulador.com</a>`;
  return `🟢 <b>Oportunidad de valor</b>\n${t.flag} <b>${t.name}</b> · campeón · ${e.venue}\nPrecio ${pc(e.price)}¢ · Modelo ${pc(row.model)}% · Edge +${pc(e.edge)}%\n\n👉 <a href="https://gpsimulador.com/?ref=tg">gpsimulador.com</a>`;
}
// Publica finales nuevos al canal (no reenvía)
async function tgDispatchFinals() {
  if (!telegram.configured()) return;
  const ids = [];
  GROUP_FIXTURES.forEach(f => { const r = db.results[f.id]; if (r && r.status === 'final' && !db.sentTg['final:' + f.id]) ids.push(f.id); });
  KNOCKOUT.forEach(k => { const id = String(k.m), r = db.results[id]; if (r && r.status === 'final' && r.home && !db.sentTg['final:' + id]) ids.push(id); });
  for (const id of ids) { const t = tgFinalText(id); if (t && await telegram.post(t)) { db.sentTg['final:' + id] = Date.now(); save(); } }
}
// Tick periódico: resumen diario (ventana mañana América) + 1 oportunidad fuerte nueva
async function tgTick() {
  if (!telegram.configured()) return;
  try {
    const now = new Date(), day = now.toISOString().slice(0, 10), h = now.getUTCHours();
    if (h >= 13 && h < 16 && !db.sentTg['daily:' + day]) {
      const t = tgDailyText();
      if (t && await telegram.post(t)) { db.sentTg['daily:' + day] = Date.now(); save(); }
    }
    let best = null;
    for (const row of arbitrage()) for (const e of row.edges) {
      const strong = (e.type === 'valor' && e.edge >= 0.06) || (e.type === 'arbitraje' && e.edge >= 0.02);
      if (!strong) continue;
      const key = `opp:${day}:${row.id}:${e.type}:${e.venue}:${e.side}`;
      if (db.sentTg[key]) continue;
      if (!best || e.edge > best.e.edge) best = { row, e, key };
    }
    if (best) { const t = tgOppText(best.row, best.e); if (t && await telegram.post(t)) { db.sentTg[best.key] = Date.now(); save(); } }
  } catch (e) { console.error('[telegram] tick:', e.message); }
}
// Al arrancar: marca finales existentes como ya publicados (no backfillear el canal)
function markExistingTgSeen() {
  let n = 0;
  const mark = id => { if (db.results[id] && db.results[id].status === 'final' && !db.sentTg['final:' + id]) { db.sentTg['final:' + id] = Date.now(); n++; } };
  GROUP_FIXTURES.forEach(f => mark(f.id));
  KNOCKOUT.forEach(k => mark(String(k.m)));
  if (n) save();
}

function arbitrage() {
  const rows = [];
  for (const t of TEAMS) {
    const p = simCache[t.id].champion;
    const pm = marketCache.polymarket[t.id], ks = marketCache.kalshi[t.id];
    const row = { id: t.id, model: p, polymarket: pm || null, kalshi: ks || null, edges: [] };
    if (pm && pm.ask > 0.001 && p - pm.ask > 0.015) row.edges.push({
      type: 'valor', venue: 'Polymarket', side: 'COMPRAR SÍ', price: pm.ask, edge: p - pm.ask,
      note: `Modelo ${(p * 100).toFixed(1)}% vs precio ${(pm.ask * 100).toFixed(1)}%`,
    });
    if (pm && pm.bid > 0.001 && pm.bid - p > 0.015) row.edges.push({
      type: 'valor', venue: 'Polymarket', side: 'COMPRAR NO', price: 1 - pm.bid, edge: pm.bid - p,
      note: `Mercado sobrevalora: ${(pm.bid * 100).toFixed(1)}% vs modelo ${(p * 100).toFixed(1)}%`,
    });
    if (ks && ks.ask > 0.001 && p - ks.ask > 0.015) row.edges.push({
      type: 'valor', venue: 'Kalshi', side: 'COMPRAR SÍ', price: ks.ask, edge: p - ks.ask,
      note: `Modelo ${(p * 100).toFixed(1)}% vs precio ${(ks.ask * 100).toFixed(1)}%`,
    });
    if (ks && ks.bid > 0.001 && ks.bid - p > 0.015) row.edges.push({
      type: 'valor', venue: 'Kalshi', side: 'COMPRAR NO', price: 1 - ks.bid, edge: ks.bid - p,
      note: `Mercado sobrevalora: ${(ks.bid * 100).toFixed(1)}% vs modelo ${(p * 100).toFixed(1)}%`,
    });
    // Arbitraje puro entre plataformas (sin riesgo de modelo)
    if (pm && ks && pm.ask > 0.001 && ks.bid - pm.ask > 0.01) row.edges.push({
      type: 'arbitraje', venue: 'Poly→Kalshi', side: 'SÍ en Polymarket + NO en Kalshi',
      price: pm.ask, edge: ks.bid - pm.ask,
      note: (() => { const cost = pm.ask + (1 - ks.bid), prof = ks.bid - pm.ask, ret = cost > 0 ? prof / cost * 100 : 0;
        return `Comprás «sí gana» en Polymarket a ${(pm.ask * 100).toFixed(0)}¢ y «no gana» en Kalshi a ${((1 - ks.bid) * 100).toFixed(0)}¢ — cubrís los dos lados. Invertís ${(cost * 100).toFixed(0)}¢ y recuperás 100¢ gane quien gane: +${(prof * 100).toFixed(1)}¢ (~${ret.toFixed(1)}% estimado).`; })(),
    });
    if (pm && ks && ks.ask > 0.001 && pm.bid - ks.ask > 0.01) row.edges.push({
      type: 'arbitraje', venue: 'Kalshi→Poly', side: 'SÍ en Kalshi + NO en Polymarket',
      price: ks.ask, edge: pm.bid - ks.ask,
      note: (() => { const cost = ks.ask + (1 - pm.bid), prof = pm.bid - ks.ask, ret = cost > 0 ? prof / cost * 100 : 0;
        return `Comprás «sí gana» en Kalshi a ${(ks.ask * 100).toFixed(0)}¢ y «no gana» en Polymarket a ${((1 - pm.bid) * 100).toFixed(0)}¢ — cubrís los dos lados. Invertís ${(cost * 100).toFixed(0)}¢ y recuperás 100¢ gane quien gane: +${(prof * 100).toFixed(1)}¢ (~${ret.toFixed(1)}% estimado).`; })(),
    });
    // Kelly sugerido para apuestas de valor (fracción conservadora 1/4)
    row.edges.forEach(e => {
      if (e.type === 'valor' && e.side.includes('SÍ')) {
        const b = (1 - e.price) / e.price;
        e.kelly = Math.max(0, +(((p * b - (1 - p)) / b) / 4).toFixed(3));
      }
    });
    rows.push(row);
  }
  return rows.sort((a, b) => Math.max(0, ...b.edges.map(e => e.edge)) - Math.max(0, ...a.edges.map(e => e.edge)));
}

// ---------- estado para el cliente ----------
function buildState() {
  const standings = realStandings();
  // GP en vivo para el listado (barato: usa solo el xG GP cacheado de buildH2HDeep + marcador/minuto; sin
  // recompute en este hot path). Si no hay xG GP cacheado → null y el cliente cae a la prob del modelo.
  const gpLiveCheap = (h, a, r) => {
    if (!h || !a || !r || r.status !== 'live') return null;
    const xg = gpXgFromCache(h, a); if (!xg) return null;
    const p = liveProbsFromLambdas(xg.xgA, xg.xgB, r.hg, r.ag, r.minute);
    return { home: +p.home.toFixed(4), draw: +p.draw.toFixed(4), away: +p.away.toFixed(4), live: true };
  };
  const fixtures = GROUP_FIXTURES.map(f => {
    const r = db.results[f.id] || null;
    const probs = (r && r.status === 'live')
      ? liveMatchProbs(effElo(db.elos, f.home), effElo(db.elos, f.away), r.hg, r.ag, r.minute)
      : matchProbs(effElo(db.elos, f.home), effElo(db.elos, f.away));
    return { ...f, result: r, probs, gpProbs: gpLiveCheap(f.home, f.away, r) };
  });
  const bracket = resolveRealBracket();
  const knockout = KNOCKOUT.map(k => {
    const r = db.results[String(k.m)] || null;
    const resolved = bracket[k.m] || { home: null, away: null };
    const h = (r && r.home) || resolved.home, a = (r && r.away) || resolved.away;
    let probs = null;
    if (h && a) probs = (r && r.status === 'live')
      ? liveMatchProbs(effElo(db.elos, h), effElo(db.elos, a), r.hg, r.ag, r.minute)
      : matchProbs(effElo(db.elos, h), effElo(db.elos, a));
    return { ...k, result: r, resolved, probs, gpProbs: gpLiveCheap(h, a, r) };
  });
  return {
    sync: lastSync,
    teams: TEAMS.map(t => ({
      ...t, currentElo: Math.round(db.elos[t.id] * 10) / 10, eloDelta: Math.round((db.elos[t.id] - t.elo) * 10) / 10,
      sim: simCache[t.id],
    })),
    groups: GROUPS, standings, fixtures, knockout,
    history: db.history.slice(-200),
    sims: N_SIMS, lastSim: db.history.length ? db.history[db.history.length - 1].ts : null,
  };
}

// ---------- Fase 4: detalle profundo de PARTIDO y EQUIPO ----------
// Reutiliza el modelo y los mercados existentes (no los modifica) y los fusiona con la
// data contextual de la capa de providers. Devuelve objetos Normalized* listos para la UI.
const STAGE_LABEL = { R32: '16avos', R16: 'Octavos', QF: 'Cuartos', SF: 'Semifinal', '3RD': '3er puesto', FINAL: 'Final', group: 'Grupos' };

function findFixtureMeta(id) {
  if (/^G/.test(id)) {
    const f = GROUP_FIXTURES.find(x => x.id === id);
    if (!f) return null;
    return { id, kind: 'group', home: f.home, away: f.away, datetime: f.datetime, group: f.group, espnId: f.espnId, stage: 'group' };
  }
  const k = KNOCKOUT.find(x => String(x.m) === String(id));
  if (!k) return null;
  const bracket = resolveRealBracket();
  const r = db.results[String(k.m)];
  const home = (r && r.home) || (bracket[k.m] && bracket[k.m].home) || null;
  const away = (r && r.away) || (bracket[k.m] && bracket[k.m].away) || null;
  return { id: String(id), kind: 'ko', m: k.m, home, away, datetime: k.datetime || (k.date + 'T18:00Z'), group: null, espnId: null, stage: k.stage };
}

function modelProbsFor(home, away, result) {
  if (!home || !away) return null;
  return (result && result.status === 'live')
    ? liveMatchProbs(effElo(db.elos, home), effElo(db.elos, away), result.hg, result.ag, result.minute)
    : matchProbs(effElo(db.elos, home), effElo(db.elos, away));
}

// ===== GP Intelligence EN VIVO =====
// La probabilidad GP (base + contexto + observables) NO debe quedar estática al pitazo: durante el partido se
// recalcula condicionando al MARCADOR + MINUTO + EVENTOS (rojas) — exactamente como el modelo base en vivo,
// pero usando el xG del modelo GP (que ya incorpora forma/bajas/clima/etc.) en vez del xG del Elo crudo.
// El xG GP sale del cache de buildH2HDeep (probs.xgA/xgB). En hot paths (lista) NO se fuerza recompute.
function gpXgFromCache(home, away) {
  const hit = h2hDeepCache.get(home + '_' + away);
  if (hit && hit.data && hit.data.probs && hit.data.probs.xgA != null) return { xgA: hit.data.probs.xgA, xgB: hit.data.probs.xgB };
  return null;
}
async function liveGpProbs(home, away, result, events, { allowCompute = false } = {}) {
  if (!home || !away || !result || result.status !== 'live') return null;
  let xg = gpXgFromCache(home, away);
  if (!xg && allowCompute) { try { const d = await buildH2HDeep(home, away); if (d && d.probs) xg = { xgA: d.probs.xgA, xgB: d.probs.xgB }; } catch { /* noop */ } }
  if (!xg) return null;
  const adj = liveEventAdjustments(events || []);
  const redMul = (n) => n <= 0 ? 1 : Math.pow(0.70, Math.min(n, 2));   // equipo con roja: menos gol restante
  const oppBoost = (n) => n <= 0 ? 1 : 1 + 0.12 * Math.min(n, 2);      // rival con un hombre de más
  const mulH = redMul(adj.homeReds) * oppBoost(adj.awayReds);
  const mulA = redMul(adj.awayReds) * oppBoost(adj.homeReds);
  const p = liveProbsFromLambdas(xg.xgA, xg.xgB, result.hg, result.ag, result.minute, { mulH, mulA });
  return { home: p.home, draw: p.draw, away: p.away, xgHome: p.xgHome, xgAway: p.xgAway, likelyScore: p.likelyScore, reds: { home: adj.homeReds, away: adj.awayReds }, live: true };
}

// Mercados de goles aproximados desde las tasas Poisson (para "ángulos" sin mercado externo)
function goalsAngles(lh, la) {
  const pmf = (l, k) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
  const tot = lh + la;
  const over25 = 1 - (pmf(tot, 0) + pmf(tot, 1) + pmf(tot, 2));
  const btts = (1 - Math.exp(-lh)) * (1 - Math.exp(-la));
  return { over25: Math.max(0, Math.min(1, over25)), btts: Math.max(0, Math.min(1, btts)) };
}
function gradeLabel(edge) {
  if (edge >= 0.10) return 'STRONG';
  if (edge >= 0.04) return 'LEAN';
  if (edge >= 0.02) return 'WATCH';
  return 'PASS';
}
const basicTeam = id => { const t = id && teamById[id]; return t ? { id: t.id, name: t.name, flag: t.flag, group: t.group } : { id: null, name: 'Por definir', flag: '', group: null }; };

async function buildMatchDetail(id, user = null) {
  const meta = findFixtureMeta(id);
  if (!meta) return null;
  await fetchMatchMarkets(false).catch(() => { });
  const result = db.results[meta.id] || null;
  const status = result && result.status === 'live' ? 'live' : result && result.status === 'final' ? 'final' : 'scheduled';
  const th = meta.home && teamById[meta.home], ta = meta.away && teamById[meta.away];
  let probs = modelProbsFor(meta.home, meta.away, result);
  const mkt = (matchMktCache.matches || []).find(m => m.fixtureId === meta.id) || null;
  const outcomes = mkt ? mkt.outcomes : null;
  const names = { home: th ? th.name : 'Local', away: ta ? ta.name : 'Visitante', draw: 'el empate' };

  const marketPrices = [];
  if (outcomes) for (const side of ['home', 'draw', 'away']) {
    const o = outcomes[side]; if (!o) continue;
    marketPrices.push({ venue: 'Polymarket', side, price: o.price, bid: o.bid, ask: o.ask, volume: o.volume, url: o.url });
  }

  // Contexto externo (lineups, eventos, stats, forma, lesiones, noticias, odds) — se obtiene
  // ANTES del GP Take para que las bajas confirmadas puedan informar la lectura (Opción C).
  const namesOf = t => t ? [t.en, t.name, ...(t.aliases || [])] : [];
  const ctx = await providers.getMatchContext({
    homeCode: meta.home, awayCode: meta.away,
    homeName: th ? th.en : '', awayName: ta ? ta.en : '',
    homeNames: namesOf(th), awayNames: namesOf(ta),
    isoDate: meta.datetime, espnId: meta.espnId,
    isLive: status === 'live', isFinal: status === 'final',
  }).catch(() => null);

  // Grupo 3 (jun-29): CONTEXTO EN VIVO REACTIVO. Si el partido está en juego, los eventos del partido
  // (hoy: tarjeta roja, inequívoca) ajustan la probabilidad en vivo del modelo sobre el resto del encuentro
  // (penalizan la expectativa del equipo sancionado). Antes la prob en vivo solo usaba marcador+minuto.
  let liveContext = null;
  if (status === 'live' && probs && probs.live && ctx && Array.isArray(ctx.events)) {
    const adj = liveEventAdjustments(ctx.events);
    if (adj.homeElo || adj.awayElo) {
      probs = liveMatchProbs(effElo(db.elos, meta.home), effElo(db.elos, meta.away), result.hg, result.ag, result.minute, { eloAdjH: adj.homeElo, eloAdjA: adj.awayElo });
      liveContext = { home_reds: adj.homeReds, away_reds: adj.awayReds, home_team: names.home, away_team: names.away };
    }
  }

  // Bajas confirmadas por lado: SOLO informan el GP Take (driver + confianza). NO tocan el modelo.
  const injBySide = { home: { team: names.home, players: [] }, away: { team: names.away, players: [] } };
  ((ctx && ctx.injuries) || []).forEach(i => {
    if ((i.side === 'home' || i.side === 'away') && ['injured', 'suspended', 'doubt'].includes(i.status)) injBySide[i.side].players.push(i.player);
  });

  // GP Take determinístico
  let gpTake = null;
  if (probs) {
    const liq = outcomes ? ['home', 'draw', 'away'].reduce((s, k) => s + (outcomes[k] ? outcomes[k].volume || 0 : 0), 0) : 0;
    gpTake = generateGPTake({ home: probs.home, draw: probs.draw, away: probs.away }, outcomes, names, { liquidityUsd: liq, injuries: injBySide });
  }

  // Ángulos de mercado
  const marketAngles = [];
  if (probs) {
    if (outcomes && mkt) {
      const top = ['home', 'draw', 'away'].reduce((a, b) => probs[a] >= probs[b] ? a : b);
      const e = (mkt.edges || []).slice().sort((x, y) => y.edge - x.edge)[0];
      const pickSide = e ? e.side : top;
      marketAngles.push({
        market: 'Resultado (1X2)', pick: names[pickSide] + (e ? ` · ${e.type}` : ''),
        modelProb: probs[pickSide], marketPrice: outcomes[pickSide] ? outcomes[pickSide].price : null,
        edge: e ? e.edge : 0, grade: gradeLabel(e ? e.edge : 0), venue: 'Polymarket',
        note: e ? 'El modelo difiere del precio del mercado.' : 'Modelo y mercado prácticamente alineados.',
      });
    }
    const gm = goalsAngles(probs.xgHome, probs.xgAway);
    marketAngles.push({ market: 'Más de 2.5 goles', pick: 'Over 2.5', modelProb: gm.over25, marketPrice: null, edge: 0, grade: 'WATCH', venue: null, note: 'Estimación del modelo por ritmo de goles proyectado. Sin mercado comparable cargado.' });
    marketAngles.push({ market: 'Ambos anotan', pick: 'BTTS Sí', modelProb: gm.btts, marketPrice: null, edge: 0, grade: 'WATCH', venue: null, note: 'Estimación del modelo. Sin mercado comparable cargado.' });
  }

  // Fase Q.1.1 §2: adjunta la probabilidad GP Intelligence V2 oficial por partido real (detrás de
  // GP_MATCHES_V2_UI_ENABLED + acceso beta). SOLO presentación — NO altera modelProbabilities ni el modelo
  // del backend. Sin mapping aprobado (fixture↔canonical) o sin snapshot V2 válido → v2=null y el cliente
  // muestra un estado EXPLÍCITO ("V2 no disponible para este partido"), sin fallback silencioso a V1.
  let v2 = null;
  if (user && user.beta && user.beta.matchesV2) {
    try {
      const rr = require('./signal-registry/resultResolver');
      const resolveTeamId = (name) => aliasToId[normName(name)] || null;
      // 1) puente persistente por fixture_id/espn_id (grupos con ESPN id mapeado); 2) por equipos+fecha (knockouts).
      let canonicalId = await rr.resolveCanonicalByFixture(meta.espnId);
      if (!canonicalId && meta.id) canonicalId = await rr.resolveCanonicalByFixture(meta.id);
      if (!canonicalId) canonicalId = await rr.resolveCanonicalByTeams(meta.home, meta.away, meta.datetime, resolveTeamId);
      if (canonicalId) {
        const gpCtx = { db: require('./database/client'), json, resolveTeamId };
        v2 = await gpProductApi.buildMatch(gpCtx, canonicalId, user);
      }
    } catch (e) { v2 = null; }
  }

  // GP Intelligence EN VIVO: durante el partido la prob GP (base+contexto+observables) NO debe quedar estática.
  // Se recalcula condicionando al marcador+minuto+eventos (rojas) con el xG del modelo GP, y se sobreescribe el
  // headline del bloque V2 (final_vector + outcomes). La descomposición base→contexto sigue siendo la pre-partido.
  let gpLive = null;
  if (status === 'live') {
    gpLive = await liveGpProbs(meta.home, meta.away, result, (ctx && ctx.events) || [], { allowCompute: true }).catch(() => null);
    if (gpLive && v2 && v2.probability && Array.isArray(v2.probability.outcomes)) {
      const map = { HOME: gpLive.home, DRAW: gpLive.draw, AWAY: gpLive.away };
      v2.probability.outcomes = v2.probability.outcomes.map(o => map[o.outcome_code] != null ? { ...o, gp_probability: +map[o.outcome_code].toFixed(4) } : o);
      if (v2.analysis) { v2.analysis.final_vector = { HOME: +gpLive.home.toFixed(4), DRAW: +gpLive.draw.toFixed(4), AWAY: +gpLive.away.toFixed(4) }; }
      v2.live_adjusted = true; v2.live_minute = result.minute; v2.live_score = { home: result.hg, away: result.ag };
    }
  }

  return {
    id: meta.id, date: meta.datetime, status,
    minute: result ? result.minute : undefined,
    group: meta.group, stage: meta.stage, stageLabel: STAGE_LABEL[meta.stage] || null,
    homeTeam: basicTeam(meta.home), awayTeam: basicTeam(meta.away),
    score: result ? { home: result.hg, away: result.ag } : undefined,
    modelProbabilities: probs ? {
      homeWin: probs.home, draw: probs.draw, awayWin: probs.away,
      xgHome: probs.xgHome, xgAway: probs.xgAway, likelyScore: probs.likelyScore, live: !!probs.live,
      liveContext,                       // {home_reds,away_reds,...} si un evento en vivo ajustó la prob
    } : undefined,
    v2,                                  // DTO GP Intelligence V2 | null (Q.1.1 §2, solo con flag+beta)
    gpLive: gpLive ? { homeWin: gpLive.home, draw: gpLive.draw, awayWin: gpLive.away, xgHome: gpLive.xgHome, xgAway: gpLive.xgAway, likelyScore: gpLive.likelyScore, reds: gpLive.reds } : null, // GP en vivo (cockpit /x)
    v2_requested: !!(user && user.beta && user.beta.matchesV2), // el cliente sabe si debía mostrar V2
    marketPrices, eventUrl: mkt ? mkt.eventUrl : null,
    odds: ctx ? ctx.odds : [],
    events: ctx ? ctx.events : [],
    statistics: ctx ? ctx.statistics : null,
    lineups: ctx ? ctx.lineups : { home: null, away: null },
    injuries: ctx ? ctx.injuries : [],
    recentForm: ctx ? ctx.recentForm : { home: null, away: null },
    gpTake, marketAngles,
    news: ctx ? ctx.news : [],
    providerStatus: ctx ? ctx.providerStatus : null,
    updatedAt: new Date().toISOString(),
  };
}

// ---------- v2 piloto: cruce profundo del sandbox "GP Intelligence" ----------
const h2hDeepCache = new Map(); // `${a}_${b}` -> { ts, data }
const H2H_DEEP_TTL = 10 * 60 * 1000;
const namesOfTeam = t => t ? [t.en, t.name, ...(t.aliases || [])].filter(Boolean) : [];

function formSummary(f) {
  if (!f || !f.played) return null;
  return {
    played: f.played, results: f.results || [], points: f.points,
    goalsFor: f.goalsFor, goalsAgainst: f.goalsAgainst, cleanSheets: f.cleanSheets,
    avgFor: f.avgFor, avgAgainst: f.avgAgainst, streak: f.streak || '',
    last: (f.last || []).slice(0, 5),
  };
}

function restDaysFromResults(results) {
  if (!results || !results.length) return null;
  const now = Date.now();
  const past = results.map(r => new Date(r.date).getTime()).filter(t => !isNaN(t) && t <= now);
  if (!past.length) return null;
  return Math.round((now - Math.max(...past)) / (24 * 3600 * 1000));
}

// Logging experimental de una ejecución de GP Intelligence (best-effort; flag + DB). NO incluye secretos.
async function logGpIntelligenceRun({ a, b, base, v2, csA, csB, inputHash, randomSeed, SIMS, analysis }) {
  return gpExperiment.logRun({
    analysisType: 'h2h_sandbox', status: analysis.headline ? 'completed' : 'partial',
    completedAt: new Date().toISOString(),
    controlModelVersion: VERSIONS.control, challengerModelVersion: VERSIONS.challenger, factorPolicyVersion: VERSIONS.factorPolicy,
    inputHash, randomSeed, simulationCount: SIMS,
    teamAReference: a, teamBReference: b, eventReference: a + '_' + b,
    inputPayload: { a, b, eloA: Math.round(db.elos[a]), eloB: Math.round(db.elos[b]) },
    contextPayload: { factorsA: csA.factors, factorsB: csB.factors, groupsA: csA.groupCapped, groupsB: csB.groupCapped },
    controlOutput: base, challengerOutput: v2,
    dataQualityPayload: { a: csA.dataQuality, b: csB.dataQuality, modelConfidence: analysis.headline && analysis.headline.modelConfidence },
    metadata: { verdictLabel: analysis.headline && analysis.headline.verdictLabel },
  });
}

async function buildH2HDeep(a, b) {
  const key = a + '_' + b;
  const hit = h2hDeepCache.get(key);
  if (hit && Date.now() - hit.ts < H2H_DEEP_TTL) return hit.data;

  const ta = teamById[a], tb = teamById[b];
  // 1) PRIOR: modelo base neutral (sin bono local)
  const base = matchProbs(db.elos[a], db.elos[b]);
  const baseLine = { aWin: base.home, draw: base.draw, bWin: base.away, xgA: base.xgHome, xgB: base.xgAway, likely: base.likelyScore };

  // 2) CONTEXTO total de ambos + calidad de plantilla (ratings reales). Nunca lanza.
  const safe = async (fn) => { try { return await fn(); } catch { return null; } };
  const [ctxA, ctxB, sqA, sqB] = await Promise.all([
    safe(() => providers.getTeamContext({ code: a, name: ta.en, names: namesOfTeam(ta) })),
    safe(() => providers.getTeamContext({ code: b, name: tb.en, names: namesOfTeam(tb) })),
    safe(() => providers.getSquadRating({ code: a, name: ta.en, names: namesOfTeam(ta) })),
    safe(() => providers.getSquadRating({ code: b, name: tb.en, names: namesOfTeam(tb) })),
  ]);

  // 3) Descanso/carga desde fechas de resultados recientes
  const restA = restDaysFromResults(ctxA && ctxA.results), restB = restDaysFromResults(ctxB && ctxB.results);

  // 4) Señales → breakdown completo por factor + ajuste de Elo (con caps por grupo + safety cap global).
  //    Frescura: marcamos fetched_at = ahora por fuente (source_updated_at desconocido en API-Football).
  const now = Date.now(), nowIso = new Date(now).toISOString();
  const fetchedAt = { form: nowIso, injuries: nowIso, squad: nowIso, rest: nowIso };
  const csA = contextSignals(ctxA, ta.name, { squadRating: sqA, restDays: restA, oppRestDays: restB, now, fetchedAt, baseElo: Math.round(db.elos[a]) });
  const csB = contextSignals(ctxB, tb.name, { squadRating: sqB, restDays: restB, oppRestDays: restA, now, fetchedAt, baseElo: Math.round(db.elos[b]) });
  const eloA2 = db.elos[a] + csA.finalCappedTotal, eloB2 = db.elos[b] + csB.finalCappedTotal;

  // 5) xG ESPECÍFICO POR EQUIPO (eje xG, separado del eje Elo)
  const [lAelo, lBelo] = lambdas(eloA2, eloB2);
  const [lA, lB, beta] = adjustedLambdas(lAelo, lBelo, csA.goalProfile, csB.goalProfile);

  // 6) Reproducibilidad: seed determinístico desde el hash de los inputs (misma entrada → misma seed).
  const inputHash = hashInputs({ a, b, eloA: db.elos[a], eloB: db.elos[b], dA: csA.finalCappedTotal, dB: csB.finalCappedTotal, lA: +lA.toFixed(6), lB: +lB.toFixed(6), v: VERSIONS.challenger });
  const randomSeed = deriveSeed(inputHash);
  const SIMS = 10000;

  // 7) v2: 1X2 desde tasas ajustadas + Monte Carlo 10k REPRODUCIBLE (seed fija)
  const v2 = probsFromLambdas(lA, lB);
  const v2Line = { aWin: v2.home, draw: v2.draw, bWin: v2.away, xgA: lA, xgB: lB, likely: v2.likelyScore };
  const mc = simulateH2H(0, 0, SIMS, makeRng(randomSeed), [lA, lB]);
  const goals = goalsMarkets(mc, lA, lB);

  // 8) Sanity matemático + análisis integral (V1 control vs V2 challenger)
  const sanity = mathSanity({ v2: v2Line, goals, mc, deltaA: csA.finalCappedTotal, deltaB: csB.finalCappedTotal });
  const aMeta = { code: a, name: ta.name, flag: ta.flag }, bMeta = { code: b, name: tb.name, flag: tb.flag };
  const analysis = buildH2HAnalysis({ a: aMeta, b: bMeta, base: baseLine, v2: v2Line, ctxA: csA, ctxB: csB, mc, goals, beta });

  // Privacidad: nunca enviamos al cliente la FUENTE de datos ni las versiones internas del modelo
  // (son información privada / nuestro foso). Strip de source/timestamps por factor y de versions/run/dataSource.
  const stripF = f => { const { source, sourceUpdatedAt, fetchedAt, expiresAt, ...rest } = f; return rest; };
  if (analysis.factors) analysis.factors = analysis.factors.map(stripF);
  const data = {
    a: { ...basicTeam(a), elo: Math.round(db.elos[a]) },
    b: { ...basicTeam(b), elo: Math.round(db.elos[b]) },
    control: baseLine,                 // V1 CONTROL (modelo global, no se promueve)
    base: baseLine,                    // alias back-compat
    probs: v2Line,                     // V2 CHALLENGER — headline del sandbox
    delta: analysis.decomposition.deltaPp, // V2 vs V1 en puntos porcentuales por resultado
    context: {
      deltaA: Math.round(csA.finalCappedTotal), deltaB: Math.round(csB.finalCappedTotal),
      signalsA: csA.signals, signalsB: csB.signals,
      factorsA: csA.factors.map(stripF), factorsB: csB.factors.map(stripF),
      groupsA: csA.groupCapped, groupsB: csB.groupCapped,
      dataQualityA: csA.dataQuality, dataQualityB: csB.dataQuality,
      hasData: csA.hasData || csB.hasData,
      goalModel: beta > 0 ? 'xG específico por equipo' : 'xG por ranking',
    },
    goals,
    form: { a: formSummary(ctxA && ctxA.recentForm), b: formSummary(ctxB && ctxB.recentForm) },
    injuries: {
      a: ((ctxA && ctxA.injuries) || []).filter(i => ['injured', 'suspended', 'doubt'].includes(i.status)).slice(0, 6),
      b: ((ctxB && ctxB.injuries) || []).filter(i => ['injured', 'suspended', 'doubt'].includes(i.status)).slice(0, 6),
    },
    tactical: { a: (ctxA && ctxA.tactical) || null, b: (ctxB && ctxB.tactical) || null },
    monteCarlo: mc,
    analysis,
    updatedAt: nowIso,
  };
  // Logging experimental (best-effort, no rompe la simulación si falla). B2.
  logGpIntelligenceRun({ a, b, aMeta, bMeta, base: baseLine, v2: v2Line, csA, csB, inputHash, randomSeed, SIMS, analysis }).catch(() => {});
  h2hDeepCache.set(key, { ts: Date.now(), data });
  return data;
}

// ===== Motor de contexto por evento (jun-28). Evalúa TODOS los fixtures canónicos próximos con la capa de
// contexto en vivo (buildH2HDeep: forma/plantilla/lesiones/descanso/táctico) y persiste el resultado como
// v2_probability_snapshot + context_observations (idempotente por input_hash). Esto hace que /x muestre la capa
// base→contexto→GP en cada partido. SHADOW: no toca el modelo oficial (Value/Picks/Registry siguen igual).
let _ctxEvalRunning = false, _ctxEvalLast = null;
function contextEngineOn() { return /^(1|true|yes|on)$/i.test(String(process.env.CONTEXT_ENGINE_ENABLED || '')); }
async function evaluateUpcomingContext({ limit = 60, throttleMs = 220 } = {}) {
  if (_ctxEvalRunning) return { skipped: 'running' };
  _ctxEvalRunning = true;
  const out = { evaluated: 0, snapshots_new: 0, observations: 0, skipped: 0, errors: 0, started: new Date().toISOString() };
  try {
    const dbc = require('./database/client');
    const dbcfg = require('./database/config');
    if (!dbcfg.db || !dbcfg.db.configured) { return { skipped: 'no_db' }; }
    const crepo = require('./context-engine/repository');
    const cf = require('./context-engine/collectorFactors');
    const crypto2 = require('crypto');
    const evs = (await dbc.query(
      `SELECT id, home_participant, away_participant, scheduled_start FROM canonical_events
        WHERE scheduled_start > now() ORDER BY scheduled_start LIMIT $1`, [limit])).rows;
    for (const ev of evs) {
      try {
        const a = aliasToId[normName(ev.home_participant)], b = aliasToId[normName(ev.away_participant)];
        if (!a || !b || db.elos[a] == null || db.elos[b] == null) { out.skipped++; continue; }
        const deep = await buildH2HDeep(a, b);
        if (!deep || !deep.base || !deep.probs) { out.skipped++; continue; }
        const base = deep.base, v2 = deep.probs, c = deep.context || {};
        const baseVec = { home: round4(base.aWin), draw: round4(base.draw), away: round4(base.bWin) };
        const deepVec = { home: v2.aWin, draw: v2.draw, away: v2.bWin };
        // ---- Grupo 2: fusionar observaciones del collector (clima Open-Meteo + claims de noticias) ----
        // El clima y las noticias se escribían por separado y NO movían la probabilidad. Acá se convierten en
        // factores que ajustan el vector final de buildH2HDeep y se persisten como observaciones (con su
        // evidencia Dato/Inferencia derivada del origen). Cutoff = kickoff (anti-leakage en lectura aguas abajo).
        const wRow = (await dbc.query(`SELECT weather_factors, venue, apparent_c, precip_mm, wind_kmh, humidity_pct FROM weather_snapshots WHERE canonical_event_id=$1 ORDER BY created_at DESC LIMIT 1`, [ev.id]).catch(() => ({ rows: [] }))).rows[0] || null;
        const claimRows = (await dbc.query(`SELECT factor_code, fact_or_inference, confidence, team_id, subject_id, review_status FROM context_claims WHERE event_id=$1 AND review_status='auto' ORDER BY created_at DESC LIMIT 40`, [ev.id]).catch(() => ({ rows: [] }))).rows;
        const fused = cf.fuse(deepVec, { weatherRow: wRow, claims: claimRows, homeId: a, awayId: b });
        const collectorFx = fused.factors;
        const finalVec = { home: round4(fused.adjusted.home), draw: round4(fused.adjusted.draw), away: round4(fused.adjusted.away) };
        const adj = { home: round4(finalVec.home - baseVec.home), draw: round4(finalVec.draw - baseVec.draw), away: round4(finalVec.away - baseVec.away) };
        const facA = (c.factorsA || []).map(f => ({ ...f, side: 'a', teamId: a }));
        const facB = (c.factorsB || []).map(f => ({ ...f, side: 'b', teamId: b }));
        const all = facA.concat(facB), included = all.filter(f => f.included);
        const dqA = c.dataQualityA || { score: 0 }, dqB = c.dataQualityB || { score: 0 };
        const compl = round4(((Number(dqA.score) || 0) + (Number(dqB.score) || 0)) / 2);
        const hasData = !!c.hasData || collectorFx.length > 0;
        const moved = (Math.abs(adj.home) + Math.abs(adj.draw) + Math.abs(adj.away)) >= 0.004;
        const contextState = !hasData ? 'BASE_ONLY' : moved ? 'FULL_CONTEXT' : 'PARTIAL_CONTEXT';
        const srcCount = (c.hasData ? 2 : 0) + (wRow ? 1 : 0) + (claimRows.length ? 1 : 0);
        const totalFactorCount = all.length + collectorFx.length;
        const input_hash = 'sha256:' + crypto2.createHash('sha256').update(JSON.stringify({ e: ev.id, base: baseVec, adj, cf: collectorFx.map(f => f.rawCode + f.side), v: 'live-0.3.0' })).digest('hex');
        const run = await crepo.recordEvaluationRun({
          canonical_event_id: ev.id, context_policy_version: 'context-policy-1', cutoff_at: null,
          observation_count: totalFactorCount, applied_factor_count: included.length + collectorFx.length, context_state: contextState,
          context_completeness: compl, data_freshness: 1.0, missing_critical_inputs: [], notes: 'live-h2h-deep+collector',
        }).catch(() => null);
        const snap = await crepo.recordV2Snapshot({
          context_evaluation_run_id: run ? run.run_id : null, canonical_event_id: ev.id, market_code: '1X2', period_code: 'REGULATION',
          model_family: 'GP_INTELLIGENCE_V2', model_version: 'gp-intelligence-v2-live-0.3.0', context_policy_version: 'context-policy-1',
          base_probability_vector: baseVec, context_adjustments: adj, pre_uncertainty_vector: finalVec, final_probability_vector: finalVec,
          confidence: compl, uncertainty: round4(1 - compl), data_freshness: 1.0, context_completeness: compl,
          source_count: srcCount, factor_count: totalFactorCount, missing_critical_inputs: [], context_state: contextState,
          cutoff_at: null, input_hash,
        });
        out.evaluated++;
        if (snap && !snap.idempotent) {
          out.snapshots_new++;
          const nowIso2 = new Date().toISOString();
          for (const f of all) {
            try {
              // FACT↔INFERENCE: un factor es DATO cuando lo respalda un dato observado real (lista de lesiones
              // no vacía) o cuando una noticia FACT confirma la baja de ese equipo; el resto son inferencias.
              const isAvail = f.factorCode === 'AVAILABILITY';
              const hasRealList = isAvail && f.rawValue && Number(f.rawValue.count) > 0;
              const confirmed = isAvail && fused.confirmedAvailability.has(f.teamId);
              const evidence = (hasRealList || confirmed) ? 'fact' : 'inference';
              await crepo.recordObservation({
                context_policy_version: 'context-policy-1', factor_code: f.factorCode, category: f.category || 'team',
                subject_type: 'team', subject_id: f.teamId, canonical_event_id: ev.id, source_type: 'provider', source_name: 'gp-context-live',
                observed_at: nowIso2, confidence: f.confidence != null ? f.confidence : (confirmed ? 0.85 : 0.6), fact_or_inference: evidence,
                direction: f.dir === 'up' ? 'positive' : f.dir === 'down' ? 'negative' : 'neutral',
                proposed_impact: Number(f.cappedContribution != null ? f.cappedContribution : (f.eloImpact || 0)) || 0,
                applied_impact: Number(f.cappedContribution != null ? f.cappedContribution : (f.eloImpact || 0)) || 0,
                raw_value: { label: f.label || null, detail: f.detail || null, included: !!f.included, confirmed_by_source: !!confirmed },
              });
              out.observations++;
            } catch (e) { /* dup/no-op */ }
          }
          // observaciones del collector (clima + noticias) con su evidencia real
          for (const f of collectorFx) {
            try {
              await crepo.recordObservation({
                context_policy_version: 'context-policy-1', factor_code: f.factorCode, category: f.category || 'conditions',
                subject_type: f.side === 'match' ? 'match' : 'team', subject_id: f.side === 'match' ? null : f.teamId,
                canonical_event_id: ev.id, source_type: f.source === 'open-meteo' ? 'weather' : 'news', source_name: f.source || 'collector',
                observed_at: nowIso2, confidence: f.confidence != null ? f.confidence : 0.6, fact_or_inference: f.evidence,
                direction: f.dir === 'positive' ? 'positive' : f.dir === 'negative' ? 'negative' : 'neutral',
                proposed_impact: 0, applied_impact: 0,
                raw_value: { raw_code: f.rawCode, detail: f.detail || null, pp: f.drawPp != null ? f.drawPp : (f.teamPp != null ? Math.abs(f.teamPp) : null) },
              });
              out.observations++;
            } catch (e) { /* dup/no-op */ }
          }
        }
        if (throttleMs) await new Promise(r => setTimeout(r, throttleMs));
      } catch (e) { out.errors++; }
    }
  } catch (e) { out.error = e.message; }
  finally { _ctxEvalRunning = false; out.finished = new Date().toISOString(); _ctxEvalLast = out; }
  return out;
}
function round4(x) { return (x == null || !isFinite(x)) ? null : Math.round(x * 1e4) / 1e4; }

function nextMatchForTeam(code) {
  const bracket = resolveRealBracket();
  const cands = [];
  GROUP_FIXTURES.forEach(f => {
    if (f.home === code || f.away === code) {
      const r = db.results[f.id];
      if (!r || r.status !== 'final') cands.push({ id: f.id, datetime: f.datetime, home: f.home, away: f.away });
    }
  });
  KNOCKOUT.forEach(k => {
    const res = bracket[k.m];
    if (res && (res.home === code || res.away === code)) {
      const r = db.results[String(k.m)];
      if (!r || r.status !== 'final') cands.push({ id: String(k.m), datetime: k.datetime || (k.date + 'T18:00Z'), home: res.home, away: res.away });
    }
  });
  cands.sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''));
  return cands[0] || null;
}

function wcResultsForTeam(code) {
  const out = [];
  GROUP_FIXTURES.filter(f => (f.home === code || f.away === code) && db.results[f.id] && db.results[f.id].status === 'final')
    .forEach(f => { const r = db.results[f.id]; out.push({ id: f.id, datetime: f.datetime, home: f.home, away: f.away, hg: r.hg, ag: r.ag, stage: 'group' }); });
  KNOCKOUT.forEach(k => {
    const r = db.results[String(k.m)];
    if (r && r.status === 'final' && (r.home === code || r.away === code)) out.push({ id: String(k.m), datetime: k.datetime || k.date, home: r.home, away: r.away, hg: r.hg, ag: r.ag, stage: k.stage });
  });
  return out.sort((a, b) => String(b.datetime).localeCompare(String(a.datetime)));
}

async function buildTeamDetail(code) {
  const t = teamById[code];
  if (!t) return null;
  await fetchMarkets(false).catch(() => { });
  const sim = simCache[code];
  const elo = db.elos[code];
  const rank = TEAMS.map(x => x.id).sort((a, b) => db.elos[b] - db.elos[a]).indexOf(code) + 1;
  const fmt = p => (p * 100).toFixed(1) + '%';

  const pm = marketCache.polymarket[code] || null, ks = marketCache.kalshi[code] || null;
  const marketPrices = [];
  if (pm) marketPrices.push({ venue: 'Polymarket', side: 'campeón', price: pm.price, bid: pm.bid, ask: pm.ask, volume: pm.volume, liquidity: pm.liquidity, change24h: pm.change24h, url: pm.url, edge: +(sim.champion - pm.ask).toFixed(4) });
  if (ks) marketPrices.push({ venue: 'Kalshi', side: 'campeón', price: ks.price, bid: ks.bid, ask: ks.ask, volume: ks.volume, openInterest: ks.openInterest, change24h: ks.change24h, url: ks.url, edge: +(sim.champion - ks.ask).toFixed(4) });

  const nm = nextMatchForTeam(code);
  const nextMatch = nm ? {
    id: nm.id, datetime: nm.datetime,
    opponent: basicTeam(nm.home === code ? nm.away : nm.home),
    home: nm.home === code,
  } : null;

  const wcResults = wcResultsForTeam(code).map(r => ({
    id: r.id, datetime: r.datetime, stageLabel: STAGE_LABEL[r.stage] || 'Grupos',
    opponent: basicTeam(r.home === code ? r.away : r.home),
    score: r.home === code ? `${r.hg}-${r.ag}` : `${r.ag}-${r.hg}`,
    result: (r.home === code ? r.hg - r.ag : r.ag - r.hg) > 0 ? 'W' : (r.hg === r.ag ? 'D' : 'L'),
  }));

  const ctx = await providers.getTeamContext({ code, name: t.en, names: [t.en, t.name, ...(t.aliases || [])] }).catch(() => null);

  // Model Read: manual editorial primero; si no, derivado del modelo
  let modelRead, keyDrivers;
  if (ctx && ctx.notes && ctx.notes.modelRead) { modelRead = ctx.notes.modelRead; keyDrivers = ctx.notes.keyDrivers || []; }
  else {
    modelRead = `${t.name} tiene ${fmt(sim.champion)} de ser campeón (Elo ${Math.round(elo)}, #${rank} del torneo). Avanza de grupos el ${fmt(sim.reachR32)} y gana su grupo el ${fmt(sim.groupWin)}.`;
    keyDrivers = [`Gana el grupo ${fmt(sim.groupWin)}`, `Avanza a 16avos ${fmt(sim.reachR32)}`, `Eliminado en grupos ${fmt(sim.outInGroups)}`];
    if (sim.likelyR32Opponents && sim.likelyR32Opponents[0]) {
      const o = teamById[sim.likelyR32Opponents[0].id];
      if (o) keyDrivers.push(`Cruce más probable: ${o.name}`);
    }
  }

  return {
    id: code, code: t.id, name: t.name, flag: t.flag, group: t.group,
    elo: Math.round(elo * 10) / 10, eloDelta: Math.round((elo - t.elo) * 10) / 10, rank, host: !!t.host,
    championProbability: sim.champion, ciLow: sim.ciLow, ciHigh: sim.ciHigh,
    finalProbability: sim.reachFinal, semifinalsProbability: sim.reachSF, quarterfinalsProbability: sim.reachQF,
    advanceProbability: sim.reachR32, groupWinProbability: sim.groupWin, groupSecondProbability: sim.groupSecond,
    outInGroupsProbability: sim.outInGroups,
    counts: sim.counts, samples: sim.samples, sims: sim.sims,
    explanation: explainTeam(code, db.elos, sim, simCache),
    likelyOpponents: (sim.likelyR32Opponents || []).map(o => ({ ...basicTeam(o.id), pct: o.pct })),
    marketPrices,
    modelRead, keyDrivers, notes: keyDrivers, tactical: ctx ? ctx.tactical : null,
    nextMatch,
    squad: ctx ? ctx.squad : [], keyPlayers: ctx ? ctx.keyPlayers : [],
    injuries: ctx ? ctx.injuries : [], sidelined: ctx ? ctx.sidelined : [],
    projectedLineup: ctx ? ctx.projectedLineup : null,
    recentForm: ctx ? ctx.recentForm : null,
    results: wcResults.length ? wcResults : (ctx ? ctx.results : []),
    schedule: ctx ? ctx.schedule : [],
    news: ctx ? ctx.news : [],
    providerStatus: ctx ? ctx.providerStatus : null,
    updatedAt: new Date().toISOString(),
  };
}

// ---------- auth por email ----------
function getUser(req) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '');
  const email = db.sessions[tok];
  if (!email) return null;
  const admin = isAdmin(email);
  // Sprint 4: flags de la capa de oportunidades ejecutables, para que el frontend muestre la pestaña
  // SOLO cuando corresponde (admin preview o público). Con flags off, no aparece ninguna ruta nueva.
  const xf = execOpps.cfg.flags;
  const execUi = (admin && xf.adminPreviewEnabled) || xf.publicEnabled;
  // Sprint 5: registro verificable público (pestaña visible solo si el flag está activo o el usuario es admin)
  const srf = signalRegistry.cfg.flags;
  const registryUi = srf.publicEnabled || (admin && srf.enabled);
  // Sprint 6: dashboard de rendimiento (pestaña visible si público activo o admin con preview)
  const mf = metricsEngine.cfg.flags;
  const metricsUi = mf.publicEnabled || (admin && mf.adminPreviewEnabled);
  // Sprint 7: Value + Picks GP (pestañas visibles si público activo o admin con preview)
  const vf = valueEngine.cfg.flags;
  const valueUi = vf.valuePublic || (admin && vf.valueAdminPreview);
  const picksUi = vf.picksPublic || (admin && vf.picksAdminPreview);
  // Sprint 8.1: flags de integración de UI (default off → la UI se comporta exactamente como hoy)
  const ui = uiFlags.resolveForUser(admin);
  // Fase Q: gating de la experiencia de producto beta (default off → beta:false, nada nuevo se monta).
  const beta = gpProduct.resolveForUser({ email, isAdmin: admin });
  // Rollout de la beta: el entitlement (grant admin / 5 referidos verificados / fusión) habilita el acceso a
  // la plataforma nueva (/x). Un usuario entitled puede acceder a /api/beta/* aunque no sea admin/allowlist.
  const ent = betaEntitlement(email);
  beta.beta = beta.beta || ent.access;       // betaGuard usa esto → entitled accede a /x
  beta.entitled = ent.access;
  return { email, ...db.users[email], isAdmin: admin, lang: (db.users[email] && db.users[email].lang) || null, uiFlags: ui, beta, beta_access: ent.access, beta_entitlement: ent, execUi: !!execUi, execPublic: !!xf.publicEnabled, execCalc: !!xf.calculatorEnabled, execGeo: !!xf.geoFilterEnabled, registryUi: !!registryUi, registryPublic: !!srf.publicEnabled, metricsUi: !!metricsUi, metricsPublic: !!mf.publicEnabled, valueUi: !!valueUi, valuePublic: !!vf.valuePublic, picksUi: !!picksUi, picksPublic: !!vf.picksPublic };
}
function isAdmin(email) {
  const envAdmins = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (envAdmins.includes(email)) return true;
  const firstUser = Object.keys(db.users).sort((a, b) => db.users[a].createdAt - db.users[b].createdAt)[0];
  return email === firstUser; // el primer usuario registrado es admin
}

// betaGuard — Fase Q. Guard server-side de toda ruta /api/beta/*. Devuelve el user autorizado o null (y ya
// respondió). 404 si la beta está globalmente apagada (la ruta "no existe"); 401 sin sesión; 403 si hay sesión
// pero el usuario no es admin ni está en la allowlist de QA. NO confía en flags del cliente.
function betaGuard(req, res) {
  if (!gpProduct.flags().betaUi) { json(res, 404, { error: 'No encontrado' }); return null; }
  const user = getUser(req);
  if (!user) { json(res, 401, { error: 'Sesión requerida' }); return null; }
  if (!user.beta || !user.beta.beta) { json(res, 403, { error: 'Acceso beta no autorizado' }); return null; }
  return user;
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // --- SSE ---
    if (p === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      });
      // padding de 2KB para atravesar proxies/túneles que bufferean (Cloudflare, nginx)
      res.write(':' + ' '.repeat(2048) + '\n\n');
      res.write('event: hello\ndata: {}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }
    // --- Fase Q: experiencia de producto beta (/api/beta/*) ---
    // betaGuard responde 404 (beta off), 401 (sin sesión) o 403 (no autorizado) y devuelve null; si pasa,
    // devuelve el user con acceso beta. Los DTOs salen de gp-product/api (códigos neutrales, sin secretos).
    if (p.startsWith('/api/beta/')) {
      const betaUser = betaGuard(req, res);
      if (!betaUser) return; // ya respondió
      // Value OUTRIGHT (campeón del Mundial): probabilidad GP del torneo (Monte Carlo) vs mercado
      // (Polymarket/Kalshi). Mismo concepto que la plataforma principal (modelo% vs mercado%). Read-only.
      if (p === '/api/beta/value-outright' && req.method === 'GET') {
        await fetchMarkets(false).catch(() => {});
        const items = TEAMS.map(tm => {
          const sim = simCache[tm.id]; if (!sim || sim.champion == null) return null;
          const pm = marketCache.polymarket[tm.id] || null, ks = marketCache.kalshi[tm.id] || null;
          const opts = [];
          if (pm && pm.ask != null) opts.push({ book: 'Polymarket', ask: pm.ask, price: pm.price, url: pm.url, vol: pm.volume, liq: pm.liquidity });
          if (ks && ks.ask != null) opts.push({ book: 'Kalshi', ask: ks.ask, price: ks.price, url: ks.url, vol: ks.volume });
          if (!opts.length) return null;
          const best = opts.sort((a, b) => a.ask - b.ask)[0];
          return {
            team_id: tm.id, model_pct: +Number(sim.champion).toFixed(4), market_pct: +Number(best.ask).toFixed(4),
            edge_pp: +(sim.champion - best.ask).toFixed(4), best_book: best.book, market_url: best.url || null,
            volume: best.vol != null ? best.vol : null, elo: Math.round(db.elos[tm.id] || 0),
          };
        }).filter(Boolean).sort((a, b) => b.edge_pp - a.edge_pp);
        return json(res, 200, { items, count: items.length, market_code: 'WC_WINNER', generated_at: new Date().toISOString() });
      }
      const ctx = {
        db: require('./database/client'),
        json,
        resolveTeamId: (name) => aliasToId[normName(name)] || null,
      };
      const handled = await gpProductApi.handle(req, res, p, betaUser, ctx);
      if (handled === false) return json(res, 404, { error: 'No encontrado' });
      return;
    }
    // --- Fase R.5 §25: Observatory de arbitraje (admin). Telemetría read-only del dry-run. ---
    if (p === '/api/internal/arbitrage/observatory' && req.method === 'GET') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'No autorizado' });
      const obs = await require('./gp-product/arbitrage').observatory(require('./database/client'), { windowMin: 15 });
      return json(res, 200, obs);
    }
    // --- auth ---
    if (p === '/api/auth/request' && req.method === 'POST') {
      const { email } = await readBody(req);
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Email inválido' });
      const e = email.toLowerCase();
      // anti-abuso: máximo 3 códigos por email cada 10 minutos
      const prev = db.codes[e];
      if (prev && prev.count >= 3 && prev.exp > Date.now()) {
        return json(res, 429, { error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' });
      }
      // ahorro de cuota: si hay un código vigente enviado hace <90s, no reenviar otro correo
      if (prev && prev.exp > Date.now() && prev.ts && Date.now() - prev.ts < 90 * 1000 && prev.sent) {
        return json(res, 200, { ok: true, sent: true, resent: true });
      }
      const code = String(crypto.randomInt(100000, 999999));
      db.codes[e] = {
        code, exp: Date.now() + 10 * 60 * 1000, ts: Date.now(), sent: false,
        count: (prev && prev.exp > Date.now() ? prev.count : 0) + 1,
      };
      // CAPTURA DE LEAD: el email es válido (validado arriba) y mostró interés al pedir el código. Si aún
      // no es usuario, lo guardamos marcado como LEAD / no verificado (puede que el código cayera en spam
      // y no llegara a entrar; el haber dejado su correo ya denota interés → posible lead de marketing).
      if (!db.users[e]) {
        db.users[e] = { createdAt: Date.now(), favorites: [], verified: false, lead: true, leadAt: Date.now(), ref: 'lead' };
      }
      save();
      if (mailer.isConfigured()) {
        try {
          await mailer.sendMail({
            to: e,
            subject: `${code} es tu código · GP Simulador del Mundial`,
            text: `¡Bienvenido al GP Simulador del Mundial 2026! ⚽\n\nTu código de acceso es: ${code}\n\nEscríbelo en la página para entrar. Vence en 10 minutos.\n\nCon tu cuenta puedes seguir en tiempo real las probabilidades de los 48 equipos, los marcadores en vivo partido a partido, y las oportunidades que nuestro modelo detecta frente a los mercados de predicción.\n\n— GP Simulador del Mundial`,
            html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
<h2 style="margin-bottom:4px">⚽ GP Simulador del Mundial</h2>
<p>¡Bienvenido! Tu código de acceso es:</p>
<p style="font-size:34px;font-weight:bold;letter-spacing:6px;background:#f4f4f4;padding:14px 20px;border-radius:8px;text-align:center">${code}</p>
<p>Escríbelo en la página para entrar. Vence en 10 minutos.</p>
<p style="color:#555;font-size:13px">Con tu cuenta puedes seguir en tiempo real las probabilidades de los 48 equipos del Mundial 2026, los marcadores en vivo partido a partido, y las oportunidades que nuestro modelo detecta frente a los mercados de predicción.</p>
<p style="color:#999;font-size:12px">Si no pediste este código, ignora este correo.</p>
</div>`,
          });
          db.codes[e].sent = true;
          save();
          console.log(`[auth] código enviado por email a ${e}`);
          return json(res, 200, { ok: true, sent: true });
        } catch (err) {
          console.error('[mail] error:', err.message);
          return json(res, 502, { error: 'No pudimos enviar el correo. Revisa que el email esté bien escrito e intenta de nuevo.' });
        }
      }
      console.log(`[auth] código para ${e}: ${code} (modo demo, SMTP no configurado)`);
      return json(res, 200, { ok: true, demo: true, demoCode: code });
    }
    if (p === '/api/auth/verify' && req.method === 'POST') {
      const { email, code, ref } = await readBody(req);
      const e = String(email || '').toLowerCase();
      const c = db.codes[e];
      if (!c || c.exp < Date.now() || c.code !== String(code)) return json(res, 401, { error: 'Código incorrecto o expirado' });
      delete db.codes[e];
      // ¿es un alta nueva o un LEAD que ahora sí completa? (un lead existe en db.users con lead:true)
      const isNewOrLead = !db.users[e] || db.users[e].lead;
      if (!db.users[e]) db.users[e] = { createdAt: Date.now(), favorites: [] };
      // atribución de fuente (?ref=...) en el primer registro real o al convertir un lead (su ref era 'lead')
      if (isNewOrLead && ref) {
        const r = String(ref).slice(0, 24).replace(/[^\w-]/g, '');
        db.users[e].ref = r;
        const referrer = db.refCodes[r];
        if (referrer && referrer !== e && db.users[referrer]) {
          const ru = db.users[referrer];
          ru.referrals = ru.referrals || [];
          if (!ru.referrals.includes(e)) ru.referrals.push(e);
        }
      }
      // marcar como VERIFICADO (completó el registro). Si su ref seguía siendo 'lead', pásalo a 'directo'.
      db.users[e].verified = true;
      db.users[e].lead = false;
      if (!db.users[e].verifiedAt) db.users[e].verifiedAt = Date.now();
      if (db.users[e].ref === 'lead') db.users[e].ref = 'directo';
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = e;
      save();
      return json(res, 200, { token, email: e, isAdmin: isAdmin(e), favorites: db.users[e].favorites, alerts: db.users[e].alerts !== false });
    }
    if (p === '/api/me') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'No autenticado' });
      const code = ensureRefCode(u.email);
      return json(res, 200, { ...u, refCode: code, referrals: (db.users[u.email].referrals || []).length });
    }
    if (p === '/api/favorite' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { teamId } = await readBody(req);
      const favs = db.users[u.email].favorites;
      const i = favs.indexOf(teamId);
      i >= 0 ? favs.splice(i, 1) : favs.push(teamId);
      // al seguir el primer equipo, activa alertas por defecto (opt-in al seguir)
      if (i < 0 && db.users[u.email].alerts === undefined) db.users[u.email].alerts = true;
      save();
      return json(res, 200, { favorites: favs, alerts: db.users[u.email].alerts !== false });
    }
    if (p === '/api/alerts' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { enabled } = await readBody(req);
      db.users[u.email].alerts = !!enabled;
      save();
      return json(res, 200, { alerts: db.users[u.email].alerts });
    }
    // preferencias de alertas (eventos + canales)
    if (p === '/api/alertprefs' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { events, channels } = await readBody(req);
      const usr = db.users[u.email];
      usr.alertPrefs = usr.alertPrefs || {};
      if (events && typeof events === 'object') usr.alertPrefs.events = { ...(usr.alertPrefs.events || {}), ...events };
      if (channels && typeof channels === 'object') usr.alertPrefs.channels = { ...(usr.alertPrefs.channels || {}), ...channels };
      save();
      return json(res, 200, { alertPrefs: usr.alertPrefs });
    }
    // silenciar / reactivar alertas de un equipo (campana por equipo)
    if (p === '/api/mute' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { teamId } = await readBody(req);
      const usr = db.users[u.email];
      usr.alertPrefs = usr.alertPrefs || {};
      const muted = usr.alertPrefs.mutedTeams = usr.alertPrefs.mutedTeams || [];
      const i = muted.indexOf(teamId);
      i >= 0 ? muted.splice(i, 1) : muted.push(teamId);
      save();
      return json(res, 200, { mutedTeams: muted });
    }
    // --- Admin: gestión del entitlement de la BETA (grant/revoke/suspend/list). Solo admin. ---
    if (p.startsWith('/api/admin/beta/')) {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (p === '/api/admin/beta/list' && req.method === 'GET') {
        const grants = Object.entries(db.betaGrants || {}).map(([email, g]) => ({
          email, status: g.status, source: 'admin', granted_by: g.grantedBy || null, granted_at: g.grantedAt || null, reason: g.reason || null,
          verified_referrals: verifiedReferralCount(email), registered: !!db.users[email],
        }));
        const byReferral = Object.keys(db.users || {})
          .filter(e => !db.betaGrants[e] && verifiedReferralCount(e) >= betaReferralsRequired())
          .map(e => ({ email: e, status: 'active', source: 'referrals', granted_by: 'system:referrals', granted_at: null, reason: null, verified_referrals: verifiedReferralCount(e), registered: true }));
        return json(res, 200, { fusion: betaFusionOn(), referrals_required: betaReferralsRequired(), grants, by_referral: byReferral, total_with_access: grants.filter(g => g.status === 'active').length + byReferral.length });
      }
      if (req.method === 'POST') {
        const body = await readBody(req).catch(() => ({}));
        const email = String(body.email || '').trim().toLowerCase();
        if (!email || !/.+@.+\..+/.test(email)) return json(res, 400, { error: 'Email inválido' });
        const now = Date.now();
        const act = p.split('/').pop();
        const cur = db.betaGrants[email] || {};
        if (act === 'grant') db.betaGrants[email] = { status: 'active', grantedBy: u.email, grantedAt: now, reason: body.reason || null };
        else if (act === 'revoke') db.betaGrants[email] = { ...cur, status: 'revoked', grantedBy: u.email, grantedAt: cur.grantedAt || now, revokedAt: now, reason: body.reason || cur.reason || null };
        else if (act === 'suspend') db.betaGrants[email] = { ...cur, status: 'suspended', grantedBy: cur.grantedBy || u.email, grantedAt: cur.grantedAt || now, suspendedAt: now, reason: body.reason || cur.reason || null };
        else if (act === 'reinstate') db.betaGrants[email] = { ...cur, status: 'active', grantedBy: u.email, grantedAt: now, reason: body.reason || cur.reason || null };
        else return json(res, 404, { error: 'Acción desconocida' });
        save();
        return json(res, 200, { ok: true, email, entitlement: betaEntitlement(email) });
      }
      return json(res, 404, { error: 'No encontrado' });
    }
    if (p === '/api/admin/users') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try {
        // DEFENSIVO: una sola entrada malformada en db.users (null, no-objeto, sin campos) no debe tumbar TODA la
        // base de usuarios. Se filtran entradas inválidas y se protege cada campo. Los usuarios son lo crítico.
        let skipped = 0;
        const users = Object.entries(db.users || {}).map(([email, x]) => {
          if (!email || !x || typeof x !== 'object') { skipped++; return null; }
          const created = Number(x.createdAt) || 0;
          return {
            email,
            createdAt: created,
            lastSeen: Number(x.lastSeen || x.createdAt) || created,
            favorites: Array.isArray(x.favorites) ? x.favorites.length : 0,
            ref: x.ref || 'directo',
            verified: !x.lead,          // false = lead (pidió código pero no completó la verificación)
            leadAt: x.leadAt || null,
            name: x.name || null,
            country: x.country || null,
            lang: x.lang || null,            // idioma EXPLÍCITO (null = no elegido)
            mailLang: userLang(email),       // idioma efectivo para marketing (explícito o inferido del país)
          };
        }).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
        const bySource = {};
        users.forEach(uu => { bySource[uu.ref] = (bySource[uu.ref] || 0) + 1; });
        const verifiedCount = users.filter(uu => uu.verified).length;
        // segmentación de idioma para marketing: efectivo (mailLang) y explícito (cuántos lo eligieron)
        const byLang = { es: 0, en: 0 }, langExplicit = { es: 0, en: 0, none: 0 };
        users.forEach(uu => { byLang[uu.mailLang] = (byLang[uu.mailLang] || 0) + 1; langExplicit[uu.lang === 'en' ? 'en' : uu.lang === 'es' ? 'es' : 'none']++; });
        if (skipped) console.error('[admin/users] entradas malformadas omitidas:', skipped);
        return json(res, 200, { total: users.length, verifiedCount, leadCount: users.length - verifiedCount, users, bySource, byLang, langExplicit, skipped });
      } catch (e) {
        console.error('[admin/users] error:', e.message);
        return json(res, 500, { error: 'users_error', detail: e.message });
      }
    }
    // ticker público de mercados en vivo (Polymarket) — para la cabecera, también sin registro
    if (p === '/api/ticker') {
      await fetchMarkets(false);
      const rows = TEAMS.map(t => {
        const pm = marketCache.polymarket[t.id];
        if (!pm) return null;
        return { id: t.id, flag: t.flag, name: t.name, price: pm.price, change24h: pm.change24h || 0 };
      }).filter(Boolean).sort((a, b) => b.price - a.price).slice(0, 14);
      return json(res, 200, { ts: marketCache.ts, rows });
    }
    // --- datos ---
    // Fase K.2 — diccionario i18n ES/EN (público, read-only): el frontend lo consume para localizar.
    if (p === '/api/i18n') {
      const d = require('./i18n/dictionary');
      return json(res, 200, { dict: d.DICT, teams: d.TEAMS_I18N, locales: d.LOCALES, default_locale: d.DEFAULT_LOCALE, i18n_version: d.I18N_VERSION });
    }
    // preferencia de idioma del usuario autenticado (persiste en el perfil).
    if (p === '/api/me/lang' && req.method === 'PUT') {
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const body = await readBody(req).catch(() => ({}));
      const lang = body.lang === 'en' ? 'en' : (body.lang === 'es' ? 'es' : null);
      if (!lang) return json(res, 400, { error: 'lang_invalido' });
      if (db.users[u.email]) { db.users[u.email].lang = lang; save(); }
      return json(res, 200, { lang });
    }
    // Perfil: nombre + país + idioma (para personalización y segmentación de marketing por idioma).
    if (p === '/api/me/profile' && req.method === 'PUT') {
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const body = await readBody(req).catch(() => ({}));
      const rec = db.users[u.email]; if (!rec) return json(res, 404, { error: 'no_user' });
      if (typeof body.name === 'string') rec.name = body.name.trim().slice(0, 60);
      if (typeof body.country === 'string') rec.country = body.country.trim().toUpperCase().slice(0, 3);
      if (body.lang === 'en' || body.lang === 'es') rec.lang = body.lang;
      save();
      return json(res, 200, { ok: true, name: rec.name || null, country: rec.country || null, lang: rec.lang || null });
    }
    if (p === '/api/version') {
      // endpoint ligero para el fallback de polling (cuando el SSE no atraviesa el proxy/túnel)
      return json(res, 200, {
        sim: db.history.length ? db.history[db.history.length - 1].ts : 0,
        markets: marketCache.ts,
        users: Object.keys(db.users).filter(em => !db.users[em].lead).length, // solo verificados
      });
    }
    if (p === '/api/state') {
      const u = getUser(req);
      if (!u) {
        // sin registro: vista previa limitada (gancho para crear cuenta)
        const top = TEAMS.map(t => ({
          id: t.id, name: t.name, flag: t.flag, group: t.group,
          champion: simCache[t.id].champion,
        })).sort((a, b) => b.champion - a.champion).slice(0, 6);
        return json(res, 200, { teaser: true, top, sims: N_SIMS, totalTeams: TEAMS.length });
      }
      // lastSeen se actualiza en memoria siempre, pero solo se PERSISTE como máx. 1/min por usuario:
      // /api/state es un hot path (polling); guardar en cada request presiona innecesariamente el disco.
      const _prevSeen = db.users[u.email].lastSeen || 0;
      db.users[u.email].lastSeen = Date.now();
      if (Date.now() - _prevSeen > 60000) save();
      return json(res, 200, buildState());
    }
    if (p.startsWith('/api/team/')) {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const id = p.split('/')[3];
      if (!teamById[id]) return json(res, 404, { error: 'Equipo no encontrado' });
      return json(res, 200, {
        team: teamById[id], elo: db.elos[id], sim: simCache[id],
        explanation: explainTeam(id, db.elos, simCache[id], simCache),
      });
    }
    // Fase 4: detalle profundo de partido (requiere sesión, como el resto de la app)
    if (p.startsWith('/api/match/')) {
      const mu = getUser(req);
      if (!mu) return json(res, 401, { error: 'Inicia sesión' });
      const id = decodeURIComponent(p.split('/')[3] || '');
      const detail = await buildMatchDetail(id, mu);
      return detail ? json(res, 200, detail) : json(res, 404, { error: 'Partido no encontrado' });
    }
    // Fase 4: detalle profundo de equipo
    if (p.startsWith('/api/teamdetail/')) {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const id = (p.split('/')[3] || '').toUpperCase();
      if (!teamById[id]) return json(res, 404, { error: 'Equipo no encontrado' });
      const detail = await buildTeamDetail(id);
      return json(res, 200, detail);
    }
    // Sandbox "simula cualquier cruce" — par de selecciones en cancha neutral (sin bono de local)
    if (p === '/api/h2h') {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const a = (url.searchParams.get('a') || '').toUpperCase(), b = (url.searchParams.get('b') || '').toUpperCase();
      if (!teamById[a] || !teamById[b] || a === b) return json(res, 400, { error: 'Equipos inválidos' });
      const pr = matchProbs(db.elos[a], db.elos[b]); // neutral: elos crudos, sin HOME_BONUS
      return json(res, 200, {
        a: basicTeam(a), b: basicTeam(b),
        aElo: Math.round(db.elos[a]), bElo: Math.round(db.elos[b]),
        probs: { aWin: pr.home, draw: pr.draw, bWin: pr.away, xgA: pr.xgHome, xgB: pr.xgAway, likely: pr.likelyScore },
      });
    }
    // Sandbox v2 "GP Intelligence": modelo base (Elo+Poisson+DC+calibración) + Monte Carlo dedicado
    // del cruce + capa de CONTEXTO (forma/bajas/racha/solidez) → ajuste de Elo acotado → análisis integral.
    if (p === '/api/h2h/deep') {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const a = (url.searchParams.get('a') || '').toUpperCase(), b = (url.searchParams.get('b') || '').toUpperCase();
      if (!teamById[a] || !teamById[b] || a === b) return json(res, 400, { error: 'Equipos inválidos' });
      const out = await buildH2HDeep(a, b);
      return json(res, 200, out);
    }
    if (p === '/api/aciertos') {
      // público a propósito: el track record es la credibilidad de la marca
      return json(res, 200, trackRecord());
    }
    if (p === '/api/arbitrage') {
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const force = url.searchParams.get('force') === '1';
      await fetchMarkets(force);
      await fetchMatchMarkets(force);
      return json(res, 200, {
        ts: marketCache.ts, errors: marketCache.errors, rows: arbitrage(),
        matches: matchMktCache.matches,
        disclaimer: 'Estimaciones del modelo, no consejo financiero. Kalshi cobra comisiones (~7% de p·(1−p) por contrato) y Polymarket tiene spread/gas; un edge < 2-3% puede no ser rentable tras costos.',
      });
    }
    // --- admin: registrar resultados ---
    if (p === '/api/admin/result' && req.method === 'POST') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador puede registrar resultados' });
      const body = await readBody(req);
      const { matchId, hg, ag, status, minute, home, away, pensHome, remove } = body;
      const isGroup = /^G[A-L][1-6]$/.test(matchId);
      const isKO = /^(7[3-9]|8\d|9\d|10[0-4])$/.test(String(matchId));
      if (!isGroup && !isKO) return json(res, 400, { error: 'matchId inválido' });
      if (remove) {
        delete db.results[matchId];
      } else {
        if (!['live', 'final'].includes(status)) return json(res, 400, { error: 'status debe ser live o final' });
        const r = { hg: Number(hg) || 0, ag: Number(ag) || 0, status, minute: Number(minute) || 0 };
        if (isKO) { r.home = home; r.away = away; r.pensHome = !!pensHome; }
        db.results[matchId] = r;
      }
      recomputeElos();
      runSims();
      broadcast('update', { reason: remove ? 'resultado eliminado' : `resultado ${matchId}`, ts: Date.now() });
      if (!remove && status === 'final') dispatchPendingAlerts().catch(e => console.error('[alert] dispatch:', e.message));
      return json(res, 200, { ok: true });
    }
    // --- admin: probar conexión con Telegram ---
    if (p === '/api/admin/telegram-test' && req.method === 'POST') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (!telegram.configured()) return json(res, 400, { error: 'Telegram no configurado (faltan TELEGRAM_BOT_TOKEN y/o TELEGRAM_CHANNEL en Render)' });
      const ok = await telegram.post(
        '✅ <b>GP Simulador del Mundial</b> conectado a Telegram.\n\nA partir de ahora publicaremos aquí oportunidades y novedades del Mundial 2026.\n\n👉 <a href="https://gpsimulador.com">gpsimulador.com</a>');
      return json(res, 200, { ok, posted: ok });
    }
    // --- admin: publicar el resumen del día en el canal (a demanda) ---
    if (p === '/api/admin/telegram-daily' && req.method === 'POST') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (!telegram.configured()) return json(res, 400, { error: 'Telegram no configurado' });
      const t = tgDailyText();
      if (!t) return json(res, 200, { ok: false, error: 'No hay partidos por jugar hoy' });
      const ok = await telegram.post(t);
      return json(res, 200, { ok, posted: ok });
    }
    if (p === '/api/admin/refresh-markets' && req.method === 'POST') {
      await fetchMarkets(true);
      broadcast('markets', { ts: marketCache.ts });
      return json(res, 200, { ok: true, ts: marketCache.ts });
    }
    // --- Sprint 8A: preferencias de usuario (§80). Requiere sesión. 404 si la capa está off. ---
    if (p === '/api/me/preferences') {
      if (!userPrefs.flags().enabled) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      if (req.method === 'GET') return json(res, 200, await userPrefs.get(u.email));
      if (req.method === 'PUT') { const body = await readBody(req).catch(() => ({})); const r = await userPrefs.update(u.email, body); return json(res, r.ok ? 200 : 400, r); }
    }
    if (p === '/api/me/onboarding') {
      if (!userPrefs.flags().onboarding) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      if (req.method === 'GET') return json(res, 200, await userPrefs.getOnboarding(u.email));
      if (req.method === 'PUT') { const body = await readBody(req).catch(() => ({})); const r = await userPrefs.updateOnboarding(u.email, body); return json(res, r.ok ? 200 : 400, r); }
    }
    // --- Sprint 8A: inbox de alertas de usuario (§81). Se generan server-side; el frontend NO crea alerts. ---
    if (p.startsWith('/api/alerts')) {
      if (!userAlerts.cfg.flags.enabled) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      try {
        if (p === '/api/alerts' && req.method === 'GET') return json(res, 200, { items: await userAlerts.repo.listForUser(u.email, { limit: 50 }), unread: await userAlerts.repo.unreadCount(u.email) });
        if (p === '/api/alerts/read-all' && req.method === 'POST') return json(res, 200, { read: await userAlerts.repo.markAllRead(u.email) });
        const mRead = p.match(/^\/api\/alerts\/([0-9a-f-]{36})\/read$/i);
        if (mRead && req.method === 'POST') return json(res, 200, { ok: await userAlerts.repo.markRead(u.email, mRead[1]) });
      } catch (e) { return json(res, 500, { error: 'error' }); }
      return json(res, 404, { error: 'No encontrado' });
    }
    // --- Sprint 8A: ingest de analítica de producto (§42). Validado por lista blanca; sin PII sensible. ---
    if (p === '/api/events' && req.method === 'POST') {
      if (!productAnalytics.flags().enabled) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); const body = await readBody(req).catch(() => ({}));
      const r = await productAnalytics.record({ event_name: body.event, user_ref: u ? u.email : null, anonymous_id: body.anonymousId, session_id: body.sessionId, properties: body.properties, context: body.context });
      return json(res, r.recorded ? 200 : 400, r);
    }
    // --- Motor de contexto: disparar evaluación de todos los próximos (admin). GET=estado, POST=ejecutar. ---
    if (p === '/api/internal/context/evaluate') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (req.method === 'POST') { const r = await evaluateUpcomingContext({ limit: 80 }).catch(e => ({ error: e.message })); return json(res, 200, r); }
      return json(res, 200, { enabled: contextEngineOn(), running: _ctxEvalRunning, last: _ctxEvalLast });
    }
    // --- Sprint 8A: admin analytics (§46). Admin-only. ---
    if (p.startsWith('/api/internal/analytics/')) {
      if (!productAnalytics.flags().enabled) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (p === '/api/internal/analytics/overview') return json(res, 200, await productAnalytics.overview({ days: 7 }));
      if (p === '/api/internal/analytics/funnel') return json(res, 200, await productAnalytics.funnel({}));
    }
    // --- Sprint 8A: referrals (§82). track es público con rate limit; el resto requiere sesión. ---
    if (p.startsWith('/api/referrals')) {
      if (!referrals.flags().enabled) return json(res, 404, { error: 'No encontrado' });
      if (p === '/api/referrals/track' && req.method === 'POST') { const body = await readBody(req).catch(() => ({})); if (!rateLimit('ref:' + (req.socket.remoteAddress || 'x'), 20, 60000)) return json(res, 429, { error: 'Demasiados intentos' }); return json(res, 200, await referrals.track({ code: body.code, anonymousId: body.anonymousId || null })); }
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      if (p === '/api/referrals/me' && req.method === 'GET') return json(res, 200, await referrals.status(u.email));
      if (p === '/api/referrals/code' && req.method === 'POST') return json(res, 200, await referrals.ensureCode(u.email));
      if (p === '/api/referrals/status' && req.method === 'GET') return json(res, 200, await referrals.status(u.email));
    }
    // --- Sprint 8B: waitlist GP Pro (§83). Sin pago, sin tarjeta. ---
    if (p === '/api/pro-waitlist' && req.method === 'POST') {
      if (!proWaitlist.flags().enabled) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const body = await readBody(req).catch(() => ({})); const r = await proWaitlist.join(u.email, body); return json(res, r.ok ? 200 : 400, r);
    }
    if (p === '/api/me/pro-waitlist') {
      if (!proWaitlist.flags().enabled) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      if (req.method === 'GET') return json(res, 200, await proWaitlist.get(u.email) || { joined: false });
      if (req.method === 'DELETE') return json(res, 200, await proWaitlist.leave(u.email));
    }
    // --- Sprint 8B: entitlements del usuario (§84). El frontend NO decide permisos. ---
    if (p === '/api/me/entitlements' && req.method === 'GET') {
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      return json(res, 200, await entitlements.userEntitlements(u.email));
    }
    // --- Sprint 8A: health público mínimo (§25). Sin detalles sensibles. ---
    if (p === '/api/health') {
      return json(res, 200, { status: 'ok', version: (process.env.RENDER_GIT_COMMIT || '').slice(0, 7) || null, timestamp: new Date().toISOString() });
    }
    // --- Sprint 8A: API interna de operaciones (admin-only; 404 si OPERATIONS_ADMIN_ENABLED off). ---
    if (p.startsWith('/api/internal/operations')) {
      if (!operations.cfg.flags.admin) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try {
        if (p === '/api/internal/operations/status' && req.method === 'GET') return json(res, 200, await operations.status());
        if (p === '/api/internal/operations/health' && req.method === 'GET') return json(res, 200, await operations.health.health());
        if (p === '/api/internal/operations/freshness' && req.method === 'GET') return json(res, 200, await operations.health.freshnessSnapshot());
        if (p === '/api/internal/operations/jobs' && req.method === 'GET') return json(res, 200, { jobs: (await operations.status()).jobs });
        if (p === '/api/internal/operations/dead-letters' && req.method === 'GET') return json(res, 200, { items: await require('./operations/repositories/deadLetterRepository').list({ limit: 100 }) });
        const mJob = p.match(/^\/api\/internal\/operations\/jobs\/([a-z0-9_]+)$/i);
        if (mJob && req.method === 'GET') { const st = await operations.status(); return json(res, 200, st.jobs.find(j => j.job_name === mJob[1]) || { error: 'unknown_job' }); }
        const mRun = p.match(/^\/api\/internal\/operations\/jobs\/([a-z0-9_]+)\/run$/i);
        if (mRun && req.method === 'POST') return json(res, 200, await operations.runOnce(mRun[1], { runType: 'manual' }));
        const mDl = p.match(/^\/api\/internal\/operations\/dead-letters\/([0-9a-f-]{36})\/(retry|resolve|ignore)$/i);
        if (mDl && req.method === 'POST') { const body = await readBody(req).catch(() => ({})); const status = mDl[2] === 'retry' ? 'retrying' : (mDl[2] === 'ignore' ? 'ignored' : 'resolved'); return json(res, 200, await require('./operations/repositories/deadLetterRepository').setStatus(mDl[1], status, body.note || null) || { error: 'not_found' }); }
        return json(res, 404, { error: 'No encontrado' });
      } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    // --- Sprint 8A: estado del proveedor de sportsbooks (admin-only; 404 si el proveedor está off). Sin API key. ---
    if (p === '/api/internal/sportsbook/status') {
      const sb = require('./sportsbook-providers');
      if (!sb.cfg.flags.enabled) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { return json(res, 200, await sb.adminStatus()); } catch (e) { return json(res, 200, { enabled: true, error: 'status failed' }); }
    }
    // --- Sprint 0: health interno de la plataforma de datos v2 (admin-only, sin secretos) ---
    if (p === '/api/internal/platform-health') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { return json(res, 200, await platformHealth.snapshot()); }
      catch (e) { return json(res, 200, { status: 'unavailable', error: 'health snapshot failed', timestamp: new Date().toISOString() }); }
    }
    // --- Sprint 1: status de la ingesta de mercado (admin-only, sin secretos, no ejecuta ingesta) ---
    if (p === '/api/internal/market-data-status') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { return json(res, 200, await marketData.adminStatus()); }
      catch (e) { return json(res, 200, { enabled: false, error: 'status failed', timestamp: new Date().toISOString() }); }
    }
    // --- Sprint 2: Canonical Event Graph (admin-only; no ejecuta matching ni migra) ---
    if (p === '/api/internal/canonical/status') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { return json(res, 200, await canonicalGraph.adminStatus()); } catch (e) { return json(res, 200, { error: 'status failed' }); }
    }
    if (p === '/api/internal/canonical/review' && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const status = (url.searchParams.get('status') || 'pending').slice(0, 20);
      const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 200);
      const offset = Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
      try { return json(res, 200, { items: await canonicalGraph.reviewList(status, limit, offset) }); } catch (e) { return json(res, 200, { items: [] }); }
    }
    const mReview = p.match(/^\/api\/internal\/canonical\/review\/([0-9a-f-]{36})$/i);
    if (mReview && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { const item = await canonicalGraph.reviewGet(mReview[1]); return item ? json(res, 200, item) : json(res, 404, { error: 'No encontrado' }); } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    const mDecide = p.match(/^\/api\/internal\/canonical\/review\/([0-9a-f-]{36})\/decision$/i);
    if (mDecide && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const body = await readBody(req);
      const decision = ['approve', 'reject', 'conditional', 'dismiss'].includes(body.decision) ? body.decision : null;
      if (!decision) return json(res, 400, { error: 'decision inválida (approve|reject|conditional|dismiss)' });
      try { const r = await canonicalGraph.reviewDecide(mDecide[1], { decision, reviewedBy: u.email, notes: (body.notes || '').slice(0, 1000) }); return r ? json(res, 200, r) : json(res, 404, { error: 'No encontrado' }); } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    // --- Sprint 3: motor de arbitraje (admin-only; no ejecuta órdenes, no publica) ---
    if (p === '/api/internal/arb/status') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { return json(res, 200, await arbEngine.adminStatus()); } catch (e) { return json(res, 200, { error: 'status failed' }); }
    }
    if (p === '/api/internal/arb/opportunities' && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 200);
      const offset = Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
      try { const r = await dbClientSafe(`SELECT * FROM arb_opportunities ORDER BY last_seen_at DESC LIMIT $1 OFFSET $2`, [limit, offset]); return json(res, 200, { items: r }); } catch (e) { return json(res, 200, { items: [] }); }
    }
    const mOpp = p.match(/^\/api\/internal\/arb\/opportunities\/([0-9a-f-]{36})$/i);
    if (mOpp && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { const r = await dbClientSafe('SELECT * FROM arb_opportunities WHERE id=$1', [mOpp[1]]); return r[0] ? json(res, 200, r[0]) : json(res, 404, { error: 'No encontrado' }); } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    const mEval = p.match(/^\/api\/internal\/arb\/evaluations\/([0-9a-f-]{36})$/i);
    if (mEval && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { const ev = await dbClientSafe('SELECT * FROM arb_evaluations WHERE id=$1', [mEval[1]]); const legs = await dbClientSafe('SELECT * FROM arb_evaluation_legs WHERE evaluation_id=$1 ORDER BY leg_index', [mEval[1]]); return ev[0] ? json(res, 200, { evaluation: ev[0], legs }) : json(res, 404, { error: 'No encontrado' }); } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    if (p === '/api/internal/arb/run-once' && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { const candidates = await require('./arb-engine/candidateGenerator').generateFromDB(); const r = await arbEngine.runShadow({ candidates }); return json(res, 200, { counts: r.counts, persisted: r.persisted }); } catch (e) { return json(res, 500, { error: 'run failed' }); }
    }
    // --- Sprint 4: capa de producto (oportunidades ejecutables). Inerte si EXEC_OPPORTUNITIES_UI_ENABLED=false ---
    if (p.startsWith('/api/internal/executable-opportunities') || p.startsWith('/api/executable-opportunities')) {
      if (!execOpps.cfg.flags.uiEnabled) return json(res, 404, { error: 'No encontrado' });
    }
    // estado + lista para revisión (admin)
    if (p === '/api/internal/executable-opportunities' && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const status = url.searchParams.get('status') || null;
      const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 200);
      const offset = Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
      try {
        const st = await execOpps.adminStatus();
        const list = execOpps.cfg.platform.db.configured ? await execOpps.publication.repo.list({ status, limit, offset }) : { items: [], total: 0 };
        return json(res, 200, { status: st, ...list });
      } catch (e) { return json(res, 200, { status: { flags: execOpps.cfg.flags }, items: [], total: 0 }); }
    }
    const mXoId = p.match(/^\/api\/internal\/executable-opportunities\/([0-9a-f-]{36})$/i);
    if (mXoId && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try {
        const pub = await execOpps.publication.repo.findById(mXoId[1]);
        if (!pub) return json(res, 404, { error: 'No encontrado' });
        const history = await execOpps.publication.history.listForPublication(pub.id);
        let diff = null;
        try { const live = await require('./exec-opportunities/adapters').loadLiveContext(pub.opportunity_key); if (live) diff = execOpps.publication.detailDiff(pub, live.evaluationView); } catch { /* noop */ }
        return json(res, 200, { publication: pub, history, diff });
      } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    const mXoAction = p.match(/^\/api\/internal\/executable-opportunities\/([0-9a-f-]{36})\/(approve|publish|pause|withdraw|revalidate)$/i);
    if (mXoAction && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const id = mXoAction[1], action = mXoAction[2].toLowerCase();
      const body = await readBody(req).catch(() => ({}));
      try {
        const pub = await execOpps.publication.repo.findById(id);
        if (!pub) return json(res, 404, { error: 'No encontrado' });
        if (action === 'pause') return json(res, 200, await execOpps.publication.pause(id, { actorId: u.email, reason: (body.reason || '').slice(0, 500) }));
        if (action === 'withdraw') return json(res, 200, await execOpps.publication.withdraw(id, { actorId: u.email, reason: (body.reason || '').slice(0, 500) }));
        // approve/publish/revalidate requieren la evaluación VIVA (datos reales)
        const live = await require('./exec-opportunities/adapters').loadLiveContext(pub.opportunity_key);
        if (!live) return json(res, 409, { error: 'Sin evaluación vigente para esta oportunidad (requiere datos reales del motor).' });
        const opts = { actorId: u.email, evaluationView: live.evaluationView, context: { ...live.context, evaluationId: live.context.evaluationId }, allowExecutionSensitive: !!body.allowExecutionSensitive };
        if (action === 'approve') return json(res, 200, await execOpps.publication.approve(id, opts));
        if (action === 'revalidate') return json(res, 200, await execOpps.publication.revalidatePublication(id, { evaluationView: live.evaluationView, context: live.context }));
        if (action === 'publish') return json(res, 200, await execOpps.publication.publish(id, { ...opts, visibility: body.visibility || 'public', ttlMs: body.ttlMs }));
      } catch (e) { return json(res, 400, { error: e.code || e.message || 'error' }); }
    }
    // crear borrador desde una oportunidad del motor (admin)
    if (p === '/api/internal/executable-opportunities/create' && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const body = await readBody(req).catch(() => ({}));
      const key = (body.opportunityKey || '').slice(0, 80);
      if (!key) return json(res, 400, { error: 'opportunityKey requerido' });
      try {
        const opp = (await dbClientSafe('SELECT * FROM arb_opportunities WHERE opportunity_key=$1', [key]))[0];
        const live = await require('./exec-opportunities/adapters').loadLiveContext(key);
        if (!live) return json(res, 409, { error: 'Sin evaluación vigente para esa oportunidad.' });
        const draft = await execOpps.publication.createDraft({
          opportunityId: opp && opp.id, opportunityKey: key, evaluationId: live.context.evaluationId,
          evaluationView: live.evaluationView, context: live.context, actorId: u.email, visibility: body.visibility || 'internal',
        });
        return json(res, 200, draft);
      } catch (e) { return json(res, 400, { error: e.code || e.message || 'error' }); }
    }

    // --- públicos experimentales (solo si EXEC_OPPORTUNITIES_PUBLIC_ENABLED) ---
    if (p === '/api/executable-opportunities' && req.method === 'GET') {
      if (!execOpps.cfg.flags.publicEnabled) return json(res, 404, { error: 'No encontrado' });
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const country = (url.searchParams.get('country') || '').slice(0, 2).toUpperCase() || null;
      const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 100);
      const offset = Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
      try { return json(res, 200, await execOpps.listPublicOpportunities({ country, limit, offset })); }
      catch (e) { return json(res, 200, { items: [], enabled: true }); }
    }
    const mXoPub = p.match(/^\/api\/executable-opportunities\/(op_[a-f0-9]{6,})$/i);
    if (mXoPub && req.method === 'GET') {
      if (!execOpps.cfg.flags.publicEnabled) return json(res, 404, { error: 'No encontrado' });
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      const country = (url.searchParams.get('country') || '').slice(0, 2).toUpperCase() || null;
      try { const r = await execOpps.getPublicOpportunity(mXoPub[1], { country }); return r.error ? json(res, 404, r) : json(res, 200, r); }
      catch (e) { return json(res, 500, { error: 'error' }); }
    }
    const mXoCalc = p.match(/^\/api\/executable-opportunities\/(op_[a-f0-9]{6,})\/calculate$/i);
    if (mXoCalc && req.method === 'POST') {
      if (!execOpps.cfg.flags.publicEnabled || !execOpps.cfg.flags.calculatorEnabled) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      if (!rateLimit('calc:' + u.email, execOpps.cfg.calculator.rateLimitPerMin, 60000)) return json(res, 429, { error: 'Demasiados cálculos. Espera un momento.' });
      const body = await readBody(req).catch(() => ({}));
      // resolver de patas vivas para recálculo server-side
      const resolver = async (publicId) => {
        const pub = await execOpps.publication.repo.findByPublicId(publicId);
        if (!pub) return { expired: true };
        const expired = pub.publication_status !== 'published' || (pub.expires_at && new Date(pub.expires_at).getTime() <= Date.now());
        const live = await require('./exec-opportunities/adapters').loadLiveContext(pub.opportunity_key);
        if (!live) return { expired: true, evaluationId: pub.evaluation_id };
        return { legs: live.evaluationView.evaluation.legs.map(l => ({ provider: l.provider, side: l.side, levels: [], priceSource: l.priceSource })), strategy: live.evaluationView.strategy, evaluationId: pub.evaluation_id, validUntil: pub.expires_at, expired, legMeta: live.context.legMeta };
      };
      try { return json(res, 200, await execOpps.calculate(mXoCalc[1], { capital: body.capital, minRoi: body.minRoi, isAdmin: u.isAdmin, executionBufferBps: body.executionBufferBps }, resolver)); }
      catch (e) { return json(res, 400, { error: 'error' }); }
    }
    // analítica de producto (mínima; nunca guarda capital). Solo registra eventos permitidos.
    if (p === '/api/executable-opportunities/event' && req.method === 'POST') {
      if (!execOpps.cfg.flags.uiEnabled) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const body = await readBody(req).catch(() => ({}));
      try { await execOpps.analytics.record(body.event, body.props || {}, { sessionRef: null }); } catch { /* noop */ }
      return json(res, 200, { ok: true });
    }

    // --- Sprint 5: registro inmutable de señales. Inerte si SIGNAL_REGISTRY_ENABLED=false ---
    if (p.startsWith('/api/internal/signals') || p === '/api/signals' || p.startsWith('/api/signals/') || p === '/api/signal-registry/commitments') {
      if (!signalRegistry.cfg.flags.enabled) return json(res, 404, { error: 'No encontrado' });
    }
    // admin (§32)
    if (p === '/api/internal/signals' && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 200);
      const offset = Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
      try { const st = await signalRegistry.adminStatus(); const items = signalRegistry.cfg.platform.db.configured ? await signalRegistry.repo.signals.list({ limit, offset }) : []; return json(res, 200, { status: st, items }); }
      catch (e) { return json(res, 200, { status: { flags: signalRegistry.cfg.flags }, items: [] }); }
    }
    if (p === '/api/internal/signals/verify-chain' && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { return json(res, 200, await signalRegistry.verifyChain()); } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    if (p === '/api/internal/signals/publish-model' && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const body = await readBody(req).catch(() => ({}));
      try {
        const r = await signalRegistry.publishModelPrediction({
          canonical_event_id: body.canonical_event_id || null, event_start_at: body.event_start_at || null, market_close_at: body.market_close_at || null,
          input_cutoff_at: body.input_cutoff_at || null, prediction_edition: body.prediction_edition || null, supersedes_signal_id: body.supersedes_signal_id || null,
          model_version: body.model_version || undefined, visibility: body.visibility || 'internal',
          public_payload: body.public_payload || null, signal_payload: body.signal_payload || {},
        }, { actorId: u.email, sourceRefs: body.source_refs || [{ source_type: 'model_output', source_id: body.model_output_id || null }] });
        return json(res, 200, r);
      } catch (e) { return json(res, 400, { error: e.code || e.message || 'error' }); }
    }
    const mSigAct = p.match(/^\/api\/internal\/signals\/([0-9a-f-]{36})\/(withdraw|add-correction|settle|capture-closing)$/i);
    if (mSigAct && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const id = mSigAct[1], action = mSigAct[2].toLowerCase();
      const body = await readBody(req).catch(() => ({}));
      try {
        if (action === 'withdraw') return json(res, 200, await signalRegistry.withdraw(id, { reason: (body.reason || '').slice(0, 500), actorId: u.email }));
        if (action === 'settle') { if (!signalRegistry.cfg.flags.settlementEnabled) return json(res, 403, { error: 'SIGNAL_SETTLEMENT_ENABLED off' }); return json(res, 200, await signalRegistry.settle(id, body, { actorId: u.email })); }
        if (action === 'capture-closing') { if (!signalRegistry.cfg.flags.closingCaptureEnabled) return json(res, 403, { error: 'SIGNAL_CLOSING_CAPTURE_ENABLED off' }); return json(res, 200, await signalRegistry.captureClosing(id, body, { actorId: u.email })); }
        if (action === 'add-correction') return json(res, 200, await signalRegistry.addCorrection(id, { ...body }, { actorId: u.email }));
      } catch (e) { return json(res, 400, { error: e.code || e.message || 'error' }); }
    }
    const mSigGet = p.match(/^\/api\/internal\/signals\/([0-9a-f-]{36})$/i);
    if (mSigGet && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { const sig = await signalRegistry.repo.signals.byId(mSigGet[1]); if (!sig) return json(res, 404, { error: 'No encontrado' }); return json(res, 200, { signal: sig, bundle: await signalRegistry.loadBundle(sig) }); }
      catch (e) { return json(res, 500, { error: 'error' }); }
    }
    // públicos (§29) — solo si SIGNAL_REGISTRY_PUBLIC_ENABLED
    if (p === '/api/signals' && req.method === 'GET') {
      if (!signalRegistry.cfg.flags.publicEnabled) return json(res, 404, { error: 'No encontrado' });
      const opt = { signalType: url.searchParams.get('type') || null, verification: url.searchParams.get('verification') || null, limit: Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 100), offset: Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0) };
      try { return json(res, 200, await signalRegistry.listPublic(opt)); } catch (e) { return json(res, 200, { items: [], enabled: true }); }
    }
    if (p === '/api/signal-registry/commitments' && req.method === 'GET') {
      if (!signalRegistry.cfg.flags.publicEnabled) return json(res, 404, { error: 'No encontrado' });
      try { return json(res, 200, { commitments: await signalRegistry.listCommitments({ limit: 60 }) }); } catch (e) { return json(res, 200, { commitments: [] }); }
    }
    const mSigVerify = p.match(/^\/api\/signals\/(sig_[a-f0-9]{6,})\/verify$/i);
    if (mSigVerify && req.method === 'GET') {
      if (!signalRegistry.cfg.flags.publicEnabled) return json(res, 404, { error: 'No encontrado' });
      try { return json(res, 200, await signalRegistry.verify(mSigVerify[1])); } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    const mSigPub = p.match(/^\/api\/signals\/(sig_[a-f0-9]{6,})$/i);
    if (mSigPub && req.method === 'GET') {
      if (!signalRegistry.cfg.flags.publicEnabled) return json(res, 404, { error: 'No encontrado' });
      try { const r = await signalRegistry.getPublic(mSigPub[1]); return r.error ? json(res, 404, r) : json(res, 200, r); } catch (e) { return json(res, 500, { error: 'error' }); }
    }

    // --- Fase G.1: superficie administrativa del Registry (interna, NO pública). Controles por señal +
    //     globales (pause/resume/kill/public-hidden) + audit. Gated por SIGNAL_REGISTRY_ENABLED. ---
    if (p === '/api/internal/registry' || p.startsWith('/api/internal/registry/')) {
      if (!signalRegistry.cfg.flags.enabled) return json(res, 404, { error: 'No encontrado' });
      const RA = require('./signal-registry/registryAdmin');
      const SA = require('./signal-registry/signalAdmin');
      const SM = require('./signal-registry/stateMachine');
      const authz = require('./signal-registry/authz');
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' }); // §11 no autenticado → 401
      const superEmails = (process.env.REGISTRY_SUPERADMIN_EMAILS || process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
      const actor = authz.buildActor({ authenticated: true, isAdmin: !!u.isAdmin, email: u.email,
        isSuperAdmin: !!u.isAdmin && (superEmails.length === 0 || superEmails.includes(u.email)) });
      const reqId = (req.headers['x-request-id'] || '').toString().slice(0, 80) || null;

      // GET overview (§14)
      if (p === '/api/internal/registry/overview' && req.method === 'GET') {
        const a = authz.authorize(actor, 'registry:read'); if (!a.ok) return json(res, a.status, { error: a.error });
        try {
          const health = await RA.health(); const epoch = await RA.activeEpoch();
          return json(res, 200, { health, epoch: epoch ? { epoch_id: epoch.epoch_id, started_at: epoch.epoch_started_at_utc, status: epoch.status, policy: epoch.registry_policy_version } : null, actions_available: SM.ACTION_NAMES, scopes: [...actor.scopes], is_superadmin: actor.isSuperAdmin });
        } catch (e) { return json(res, 500, { error: 'error' }); }
      }
      // GET lista de señales (empty state mientras signals=0)
      if (p === '/api/internal/registry/signals' && req.method === 'GET') {
        const a = authz.authorize(actor, 'registry:read'); if (!a.ok) return json(res, a.status, { error: a.error });
        const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 50, 200);
        const offset = Math.max(parseInt(url.searchParams.get('offset'), 10) || 0, 0);
        try { const items = await SA.listSignals({ limit, offset }); const counts = await signalRegistry.repo.statusCounts().catch(() => ({ total: 0 })); return json(res, 200, { items, signals_count: counts.total || 0 }); }
        catch (e) { return json(res, 200, { items: [], signals_count: 0 }); }
      }
      // GET audit log (§12)
      if (p === '/api/internal/registry/audit' && req.method === 'GET') {
        const a = authz.authorize(actor, 'audit:read'); if (!a.ok) return json(res, a.status, { error: a.error });
        const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 100, 500);
        try { return json(res, 200, { items: await SA.listAudit({ limit }), chain: await SA.verifyChain() }); } catch (e) { return json(res, 200, { items: [], chain: { ok: null } }); }
      }
      // GET detalle de señal (original + efectiva + timeline)
      const mDet = p.match(/^\/api\/internal\/registry\/signals\/([0-9a-f-]{36})$/i);
      if (mDet && req.method === 'GET') {
        const a = authz.authorize(actor, 'registry:read'); if (!a.ok) return json(res, a.status, { error: a.error });
        try { const d = await SA.getSignalDetail(mDet[1]); return d ? json(res, 200, d) : json(res, 404, { error: 'No encontrado' }); } catch (e) { return json(res, 500, { error: 'error' }); }
      }
      // POST controles globales (§14): pause/resume writes, kill switch, public hidden
      if (p === '/api/internal/registry/controls' && req.method === 'POST') {
        const a = authz.authorize(actor, 'registry:pause'); if (!a.ok) return json(res, a.status, { error: a.error });
        if (!registryAdminRateOk(u.email)) return json(res, 429, { error: 'rate_limited' });
        const body = await readBody(req).catch(() => ({}));
        const MAP = { pause_writes: ['registry_writes_paused', true], resume_writes: ['registry_writes_paused', false], hide_public: ['registry_public_hidden', true], show_public: ['registry_public_hidden', false], kill_switch_on: ['product_kill_switch', true], kill_switch_off: ['product_kill_switch', false] };
        const m = MAP[body.control]; if (!m) return json(res, 400, { error: 'control_invalido' });
        try { const r = await RA.setControl(m[0], m[1], { adminId: u.email, reasonText: (body.reason || '').toString().slice(0, 500), requestId: reqId }); return json(res, 200, { control: m[0], enabled: r.enabled }); }
        catch (e) { return json(res, 400, { error: e.code || 'error' }); }
      }
      // POST acciones por señal (§3,§15): /signals/:id/{quarantine|restore|retract|correct|data-error|administrative-void}
      const mAct = p.match(/^\/api\/internal\/registry\/signals\/([0-9a-f-]{36})\/(quarantine|restore|retract|correct|data-error|administrative-void)$/i);
      if (mAct && req.method === 'POST') {
        const id = mAct[1]; const actionKey = mAct[2].toLowerCase().replace(/-/g, '_');
        const FN = { quarantine: 'quarantine', restore: 'restore', retract: 'retract', correct: 'correct', data_error: 'dataError', administrative_void: 'administrativeVoid' };
        const fn = FN[actionKey]; if (!fn) return json(res, 400, { error: 'accion_invalida' });
        if (!registryAdminRateOk(u.email)) return json(res, 429, { error: 'rate_limited' });
        const body = await readBody(req).catch(() => ({}));
        const material = actionKey === 'correct' && SM.classifyCorrection(body.corrected_fields || {}).material;
        const az = authz.authorizeAction(actor, actionKey, { material: !!material, postEvent: !!body.post_event });
        if (!az.ok) return json(res, az.status, { error: az.error }); // 403 sin scope / sin superadmin
        try {
          const r = await SA[fn](id, {
            adminId: u.email, reasonCode: body.reason_code || null, reasonText: body.reason_text || body.explanation || '',
            confirmedSignalId: body.confirm_signal_id, confirmationPhrase: body.confirmation_phrase,
            correctedFields: body.corrected_fields, quarantineRef: body.quarantine_ref,
            idempotencyKey: (req.headers['idempotency-key'] || body.idempotency_key || '').toString().slice(0, 120) || null,
            requestId: reqId, isSuperAdmin: actor.isSuperAdmin, postEvent: body.post_event,
            sessionMetadata: { ua: (req.headers['user-agent'] || '').toString().slice(0, 200), request_id: reqId },
            policyVersion: 'registry-policy-1', schemaVersion: 'signal-v1',
          });
          return json(res, 200, { ok: true, idempotent: !!r.idempotent, status: r.state ? r.state.admin_status : null, visibility: r.state ? r.state.visibility : null, audit_event_id: r.audit ? r.audit.audit_event_id : null, audit_hash_short: r.audit && r.audit.audit_hash ? String(r.audit.audit_hash).slice(0, 12) : null, correction_id: r.correction ? r.correction.correction_id : null });
        } catch (e) {
          if (e.code === 'validation_failed') return json(res, 422, { error: 'validation_failed', details: e.details || [] });
          if (e.code === 'signal_not_found') return json(res, 404, { error: 'signal_not_found' });
          return json(res, 400, { error: e.code || 'error' });
        }
      }
      // POST recuperación MANUAL (§8): fallback admin de closing/settlement, capture_source=manual_recovery, con reason+audit.
      const mRec = p.match(/^\/api\/internal\/registry\/signals\/([0-9a-f-]{36})\/(recover-closing|recover-settlement)$/i);
      if (mRec && req.method === 'POST') {
        const az = authz.authorize(actor, 'signal:correct'); if (!az.ok) return json(res, az.status, { error: az.error });
        if (!registryAdminRateOk(u.email)) return json(res, 429, { error: 'rate_limited' });
        const id = mRec[1], kind = mRec[2];
        const body = await readBody(req).catch(() => ({}));
        if (!body.reason || String(body.reason).trim().length < 4) return json(res, 422, { error: 'reason_required' });
        const sig = (await signalRegistry.repo.signals.byId(id).catch(() => null));
        if (!sig) return json(res, 404, { error: 'signal_not_found' });
        const adminState = await SA.getState(id).catch(() => null);
        try {
          if (kind === 'recover-closing') {
            const catalog = await require('./sportsbook-providers/sourceCatalog').load(process.env.SPORTSBOOK_PROVIDER_KEY || 'the_odds_api').catch(() => ({}));
            const r = await require('./signal-registry/closingResolver').resolveClosing(
              { id: sig.id, canonical_event_id: sig.canonical_event_id, event_start_at: sig.event_start_at, signal_payload: sig.signal_payload, direction: sig.direction },
              { now: Date.now(), catalog, captureSource: 'manual_recovery', adminStatus: adminState && adminState.admin_status, actorId: u.email });
            return json(res, 200, { ok: true, kind, state: r.state, reason_logged: true });
          }
          // recover-settlement: el admin aporta el marcador reglamentario como evidencia (no infiere el sistema)
          const rp = (body.home_goals != null && body.away_goals != null)
            ? async () => ({ providerStatus: body.provider_status || 'post', regulationHomeGoals: Number(body.home_goals), regulationAwayGoals: Number(body.away_goals), observedAt: new Date().toISOString(), finalizedAt: (body.provider_status || 'post') === 'post' ? new Date().toISOString() : null, sourceReference: 'manual:' + u.email + ':' + Date.now() })
            : null;
          const r = await require('./signal-registry/resultResolver').resolveAndSettle(
            { id: sig.id, canonical_event_id: sig.canonical_event_id, event_start_at: sig.event_start_at },
            { now: Date.now(), resultProvider: rp, captureSource: 'manual_recovery', adminStatus: adminState && adminState.admin_status, actorId: u.email });
          return json(res, 200, { ok: true, kind, state: r.state, settlement_status: r.settlement_status || null, reason_logged: true });
        } catch (e) {
          if (e.code === 'look_ahead_rejected') return json(res, 422, { error: 'look_ahead_rejected' });
          return json(res, 400, { error: e.code || 'recover_failed' });
        }
      }
      return json(res, 404, { error: 'No encontrado' });
    }

    // --- Sprint 6: motor de métricas / track record. Inerte si METRICS_ENGINE_ENABLED=false ---
    if (p.startsWith('/api/internal/metrics') || p.startsWith('/api/metrics')) {
      if (!metricsEngine.cfg.flags.enabled) return json(res, 404, { error: 'No encontrado' });
    }
    // admin (§29)
    if (p.startsWith('/api/internal/metrics/') && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try {
        if (p === '/api/internal/metrics/status') return json(res, 200, await metricsEngine.adminStatus());
        if (p === '/api/internal/metrics/runs') return json(res, 200, { runs: await metricsEngine.repo.runs.recent({ limit: 20 }) });
        if (p === '/api/internal/metrics/aggregates') return json(res, 200, { aggregates: await metricsEngine.repo.aggregates.list({ metricCode: url.searchParams.get('metric') || null }) });
        if (p === '/api/internal/metrics/exclusions') return json(res, 200, { exclusions: await metricsEngine.repo.facts.exclusions({ limit: 200 }) });
        // Fase I: track record reproducible (preview admin). Empty → N/A explícito, nunca ceros engañosos.
        if (p === '/api/internal/metrics/track-record') return json(res, 200, await require('./metrics-engine/trackRecord').status());
        if (p === '/api/internal/metrics/readiness') return json(res, 200, await require('./metrics-engine/trackRecord').readiness({ canonicalEventId: url.searchParams.get('event') || null }));
      } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    if (p.startsWith('/api/internal/metrics/') && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const body = await readBody(req).catch(() => ({}));
      try {
        if (p === '/api/internal/metrics/run') { await metricsEngine.seedDefinitions(); return json(res, 200, await metricsEngine.runOnce({ verifiedEpoch: body.epoch })); }
        if (p === '/api/internal/metrics/rebuild') { await metricsEngine.seedDefinitions(); return json(res, 200, await metricsEngine.fullRebuild({ verifiedEpoch: body.epoch })); }
        if (p === '/api/internal/metrics/publish-snapshot') return json(res, 200, await metricsEngine.publishSnapshot({ settlementCutoff: body.settlementCutoff || null }));
        if (p === '/api/internal/metrics/verify') return json(res, 200, await metricsEngine.verify());
        // Fase I: one-shot del track record (rebuild facts + snapshot). Con signals=0 → no-op sano.
        if (p === '/api/internal/metrics/track-record/run') { const tr = require('./metrics-engine/trackRecord'); const rb = await tr.rebuild(); const sn = await tr.snapshot(); return json(res, 200, { rebuild: rb, snapshot: sn, status: await tr.status() }); }
      } catch (e) { return json(res, 400, { error: e.code || e.message || 'error' }); }
    }
    // público (§30) — solo si METRICS_PUBLIC_ENABLED
    if (p.startsWith('/api/metrics/') && req.method === 'GET') {
      if (!metricsEngine.cfg.flags.publicEnabled && p !== '/api/metrics/methodology') return json(res, 404, { error: 'No encontrado' });
      try {
        if (p === '/api/metrics/summary') return json(res, 200, await metricsEngine.publicSummary());
        if (p === '/api/metrics/calibration') return json(res, 200, await metricsEngine.publicCalibration());
        if (p === '/api/metrics/cohorts') return json(res, 200, { cohorts: await metricsEngine.repo.aggregates.list({}) });
        if (p === '/api/metrics/arb') return json(res, 200, await metricsEngine.publicArb({}));
        if (p === '/api/metrics/experimental') return json(res, 200, await metricsEngine.publicExperimental());
        if (p === '/api/metrics/snapshots') return json(res, 200, { snapshots: await metricsEngine.listSnapshots() });
        if (p === '/api/metrics/methodology') return json(res, 200, { definitions: metricsEngine.definitions.DEFINITIONS, methodology_version: 'metrics-1', verified_epoch: signalRegistry.cfg.params.verifiedEpoch });
      } catch (e) { return json(res, 200, { error: 'error' }); }
    }

    // --- Sprint 7: Value Engine + Picks GP. Inerte si VALUE_ENGINE_ENABLED / PICKS_ENABLED están apagados ---
    if (p.startsWith('/api/internal/value') || p.startsWith('/api/internal/picks') || p.startsWith('/api/value') || p.startsWith('/api/picks')) {
      const onV = valueEngine.cfg.flags.valueEnabled, onP = valueEngine.cfg.flags.picksEnabled;
      if (!onV && !onP) return json(res, 404, { error: 'No encontrado' });
    }
    // admin Value (§44)
    if (p.startsWith('/api/internal/value/') && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try {
        if (p === '/api/internal/value/status') return json(res, 200, await valueEngine.adminStatus());
        if (p === '/api/internal/value/evaluations') return json(res, 200, { items: await valueEngine.repo.evaluations.recent({ limit: 100 }) });
        if (p === '/api/internal/value/strong') return json(res, 200, { items: await valueEngine.repo.evaluations.recent({ classification: 'strong', limit: 100 }) });
        // Fase J §14: cola de candidates (interna). Empty (0) es correcto si no apareció un STRONG real.
        if (p === '/api/internal/value/candidates') return json(res, 200, await require('./value-engine/candidateFactory').status());
      } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    // Fase J §14: acciones permitidas sobre candidates (NO approve/publish/register en esta fase).
    {
      const mCand = p.match(/^\/api\/internal\/value\/candidates\/([0-9a-f-]{36})\/(reject|note|refresh)$/i);
      if (mCand && req.method === 'POST') {
        const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
        const id = mCand[1], action = mCand[2].toLowerCase(); const body = await readBody(req).catch(() => ({}));
        const cf = require('./value-engine/candidateFactory');
        try {
          if (action === 'reject') return json(res, 200, await cf.reject(id, { adminId: u.email, reason: body.reason || '' }));
          if (action === 'note') return json(res, 200, await cf.addNote(id, { adminId: u.email, note: body.note || '' }));
          if (action === 'refresh') { await cf.run({ now: Date.now() }); return json(res, 200, await cf.status()); }
        } catch (e) { return json(res, 400, { error: e.code || 'error' }); }
      }
      // Fase K.1 §1: APPROVE_AS_INTERNAL_PICK — acción MANUAL, AUDITADA, ATÓMICA. SOLO superadmin. Doble
      // confirmación (escribir el candidate_id + frase "CONFIRM <id>"). Crea Pick interna + Signal oficial.
      const mApprove = p.match(/^\/api\/internal\/value\/candidates\/([0-9a-f-]{36})\/approve-as-pick$/i);
      if (mApprove && req.method === 'POST') {
        const u = getUser(req); if (!u) return json(res, 401, { error: 'Inicia sesión' });
        if (!u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
        // gate de mecanismo (la acción debe estar habilitada explícitamente; default OFF para no permitir conversión)
        if (!/^(1|true|yes|on)$/i.test(String(process.env.PICK_MANUAL_CONVERSION_ENABLED || ''))) return json(res, 403, { error: 'pick_conversion_disabled' });
        const superEmails = (process.env.REGISTRY_SUPERADMIN_EMAILS || process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
        const isSuper = !!u.isAdmin && (superEmails.length === 0 || superEmails.includes(u.email));
        if (!isSuper) return json(res, 403, { error: 'superadmin_required' });
        if (!registryAdminRateOk(u.email)) return json(res, 429, { error: 'rate_limited' });
        const id = mApprove[1]; const body = await readBody(req).catch(() => ({}));
        // Aprobación de un clic (decisión del owner): SIN escribir candidate_id, frase "CONFIRM" ni nota humana.
        // La doble confirmación reforzada se quitó; el sí/no vive en el frontend. El motivo se auto-rellena para
        // mantener el rastro de auditoría (human_review_reason es NOT NULL y la Signal es inmutable). Siguen vivos
        // los gates de seguridad: superadmin + PICK_MANUAL_CONVERSION_ENABLED + rate limit (no son fricción visible).
        const reason = (body.reason && String(body.reason).trim().length >= 4) ? String(body.reason).trim() : `Aprobada desde el panel admin por ${u.email}`;
        try {
          const r = await require('./value-engine/pickConversion').convertToPick(id, {
            adminId: u.email, superadmin: true, reason, locale: body.locale === 'en' ? 'en' : 'es',
            risks: body.risks_displayed || [], idempotencyKey: req.headers['idempotency-key'] || ('convert:' + id), now: Date.now(),
          });
          return json(res, 200, { ok: true, idempotent: !!r.idempotent, pick_id: r.pick ? r.pick.pick_id : null, signal_id: r.signal_id || (r.signal && r.signal.id) || null, candidate_lifecycle: 'CONVERTED_TO_PICK' });
        } catch (e) {
          if (e.code === 'revalidation_failed') return json(res, 422, { error: 'revalidation_failed', blockers: e.details || [] });
          return json(res, 400, { error: e.code || 'error', details: e.details || null });
        }
      }
      // one-shot de evaluación operativa (internal_operational). gpResolver no se cablea aquí → produce evals sin GP
      // (0 STRONG garantizado sin GP); el STRONG real requiere el gpResolver, fuera de alcance de esta ruta.
      if (p === '/api/internal/value/operational-run' && req.method === 'POST') {
        const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
        try { const r = await require('./sportsbook-providers/valueDryRun').runOperational({ gpResolver: v1GpResolver }); const c = await require('./value-engine/candidateFactory').run({ now: Date.now() }); return json(res, 200, { value: r, candidates: c, gp_resolver_wired: true }); }
        catch (e) { return json(res, 400, { error: e.code || 'error' }); }
      }
    }
    // Fase N.1: Admin Observatory SHADOW (interno, admin-only). V1/V2/goles/mercado/cutover. NO público.
    if (p === '/api/internal/shadow/observatory' && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try {
        const dbc = require('./database/client');
        const events = await dbc.query(`SELECT ce.id, ce.home_participant home, ce.away_participant away, ce.scheduled_start kickoff,
            v.base_probability_vector v1, v.final_probability_vector v2, v.context_state, v.uncertainty,
            g.expected_total_goals, g.over_under, g.btts, g.top_scorelines, g.final_lambda_home, g.final_lambda_away
          FROM v2_probability_snapshots v
          JOIN canonical_events ce ON ce.id=v.canonical_event_id
          LEFT JOIN LATERAL (SELECT * FROM goal_model_snapshots gg WHERE gg.canonical_event_id=v.canonical_event_id ORDER BY created_at DESC LIMIT 1) g ON true
          WHERE ce.scheduled_start > now() ORDER BY ce.scheduled_start LIMIT 30`).catch(() => ({ rows: [] }));
        const goalValue = (await dbc.query(`SELECT canonical_event_id, market_id, gp_probability, market_consensus_probability, best_decimal_odds, adjusted_edge_pp, classification FROM goal_value_shadow ORDER BY created_at DESC LIMIT 60`).catch(() => ({ rows: [] }))).rows;
        const jobs = await require('./shadow-ops/repository').recentRuns({ limit: 20 }).catch(() => []);
        const cutover = await require('./shadow-ops/cutoverReadiness').matrix().catch(() => null);
        const metrics = (await dbc.query(`SELECT model_label, subject_type, count(*)::int n, round(avg(brier_score)::numeric,4) brier, round(avg(log_loss)::numeric,4) log_loss FROM shadow_metric_facts GROUP BY model_label, subject_type`).catch(() => ({ rows: [] }))).rows;
        const sources = (await dbc.query(`SELECT source_key, source_name, reliability_tier, source_type, enabled, kill_switch FROM context_source_catalog ORDER BY reliability_tier LIMIT 30`).catch(() => ({ rows: [] }))).rows;
        const claims = (await dbc.query(`SELECT factor_code, fact_or_inference, confidence, materiality, applied, review_status FROM context_claims ORDER BY created_at DESC LIMIT 20`).catch(() => ({ rows: [] }))).rows;
        const weather = (await dbc.query(`SELECT canonical_event_id, venue, apparent_c, precip_mm, wind_kmh, weather_factors FROM weather_snapshots ORDER BY created_at DESC LIMIT 20`).catch(() => ({ rows: [] }))).rows;
        return json(res, 200, { events: events.rows, goal_value: goalValue, jobs, shadow_metrics: metrics, collector: { sources, claims, weather }, cutover, shadow: true });
      } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    // admin Picks (§44)
    // Picks internas aprobadas (K.1/K.2): lista las filas de internal_picks para el panel admin (NO público).
    if (p === '/api/internal/picks' && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { return json(res, 200, await require('./value-engine/pickConversion').listPicks({ limit: 100 })); } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    if (p === '/api/internal/picks/candidates' && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { return json(res, 200, { items: await valueEngine.repo.candidates.list({ limit: 100 }) }); } catch (e) { return json(res, 500, { error: 'error' }); }
    }
    const mPickAct = p.match(/^\/api\/internal\/picks\/candidates\/([0-9a-f-]{36})\/(approve|reject|revalidate|publish)$/i);
    if (mPickAct && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const id = mPickAct[1], action = mPickAct[2].toLowerCase(); const body = await readBody(req).catch(() => ({}));
      try {
        if (action === 'approve') return json(res, 200, await valueEngine.picks.approve(id, { actorId: u.email }));
        if (action === 'reject') return json(res, 200, await valueEngine.picks.reject(id));
        if (action === 'publish') { const cand = await valueEngine.repo.candidates.byId(id); const ev = cand && await valueEngine.repo.evaluations.byId(cand.value_evaluation_id); return json(res, 200, await valueEngine.picks.publish(id, { actorId: u.email, currentEvaluation: ev, eventLabel: body.eventLabel, marketLabel: body.marketLabel, rationale: body.rationale })); }
        if (action === 'revalidate') { const cand = await valueEngine.repo.candidates.byId(id); const ev = cand && await valueEngine.repo.evaluations.byId(cand.value_evaluation_id); return json(res, 200, { classification: ev && ev.classification, strong_blockers: ev && ev.strong_blockers }); }
      } catch (e) { return json(res, 400, { error: e.code || e.message || 'error' }); }
    }
    const mPickPub = p.match(/^\/api\/internal\/picks\/([0-9a-f-]{36})\/(withdraw|close)$/i);
    if (mPickPub && req.method === 'POST') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const body = await readBody(req).catch(() => ({}));
      try { return json(res, 200, mPickPub[2] === 'withdraw' ? await valueEngine.picks.withdraw(mPickPub[1], { actorId: u.email, reason: body.reason }) : await valueEngine.picks.close(mPickPub[1], { actorId: u.email })); }
      catch (e) { return json(res, 400, { error: e.code || e.message || 'error' }); }
    }
    // público (§45)
    if (p === '/api/value/signals' && req.method === 'GET') {
      if (!valueEngine.cfg.flags.valuePublic) return json(res, 404, { error: 'No encontrado' });
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      try { return json(res, 200, await valueEngine.publicValueSignals({ limit: 50 })); } catch (e) { return json(res, 200, { items: [], enabled: true }); }
    }
    if (p === '/api/picks' && req.method === 'GET') {
      if (!valueEngine.cfg.flags.picksPublic) return json(res, 404, { error: 'No encontrado' });
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      try { return json(res, 200, await valueEngine.publicPicks({ limit: 50 })); } catch (e) { return json(res, 200, { items: [], enabled: true }); }
    }
    const mPkPub = p.match(/^\/api\/picks\/(pk_[a-f0-9]{6,})$/i);
    if (mPkPub && req.method === 'GET') {
      if (!valueEngine.cfg.flags.picksPublic) return json(res, 404, { error: 'No encontrado' });
      if (!getUser(req)) return json(res, 401, { error: 'Inicia sesión' });
      try { const r = await valueEngine.publicPick(mPkPub[1]); return r.error ? json(res, 404, r) : json(res, 200, r); } catch (e) { return json(res, 500, { error: 'error' }); }
    }

    // --- admin: email masivo de novedades. La PRUEBA es síncrona (1 email). El masivo corre en SEGUNDO PLANO
    // (responde al instante) porque enviar a cientos toma minutos y el gateway cortaría la conexión del navegador
    // (eso producía un falso "error de red" aunque el envío sí terminaba). Guard anti-doble-envío + estado por GET.
    if (p === '/api/admin/broadcast' && (req.method === 'POST' || req.method === 'GET')) {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (req.method === 'GET') return json(res, 200, bcastState);
      if (!mailer.isConfigured()) return json(res, 400, { error: 'Email no configurado (modo demo)' });
      const { test, variant } = await readBody(req);
      const link = 'https://gpsimulador.com/?goto=referidos';
      // variant 'reengage' = correo de estilo PERSONAL (bandeja Principal): from con nombre + sin List-Unsubscribe.
      // Cada usuario recibe el correo en SU idioma (perfil → idioma; si no, inferido del país; si no, es).
      const buildMail = (variant === 'reengage')
        ? (lng) => ({ ...reengageEmail(link, lng), from: REENGAGE_FROM, noListUnsub: true })
        : (lng) => broadcastEmail(link, lng);
      if (test) {
        try { ensureRefCode(u.email); await mailer.sendMail({ to: u.email, ...buildMail(userLang(u.email)) }); console.log(`[broadcast] enviados 1/1 (prueba${variant ? ' ' + variant : ''} ${userLang(u.email)})`); return json(res, 200, { ok: true, sent: 1, failed: 0, total: 1, test: true }); }
        catch (e) { return json(res, 200, { ok: false, error: e.message, test: true }); }
      }
      if (bcastState.running) return json(res, 200, { ok: false, error: 'Ya hay un envío en curso', state: bcastState });
      const targets = Object.keys(db.users);
      bcastState = { running: true, sent: 0, failed: 0, total: targets.length, startedAt: new Date().toISOString(), finishedAt: null, test: false, variant: variant || 'beta' };
      // responder YA; enviar en segundo plano (no se await)
      json(res, 200, { ok: true, started: true, total: targets.length });
      (async () => {
        for (const email of targets) {
          try { ensureRefCode(email); await mailer.sendMail({ to: email, ...buildMail(userLang(email)) }); bcastState.sent++; }
          catch (e) { bcastState.failed++; console.error('[broadcast]', email, e.message); }
          await new Promise(r => setTimeout(r, 120)); // throttle suave para no quemar cuota
        }
        bcastState.running = false; bcastState.finishedAt = new Date().toISOString();
        console.log(`[broadcast] enviados ${bcastState.sent}/${targets.length} (fallos ${bcastState.failed}) [${bcastState.variant}]`);
      })().catch(e => { bcastState.running = false; bcastState.finishedAt = new Date().toISOString(); console.error('[broadcast] fatal', e.message); });
      return;
    }
    // --- Fase Q: superficie beta (gateada por GP_BETA_UI_ENABLED; 404 si off → la ruta no existe) ---
    // El shell HTML/JS/CSS no contiene datos sensibles (todo viene de /api/beta/* gateado por betaGuard),
    // pero igual NO se sirve si la beta está apagada, para no exponer una superficie nueva públicamente.
    // --- capa visual premium (aislada en /x; gateada por GP_PREMIUM_UI_ENABLED; 404 si off → la ruta no existe) ---
    const premiumOn = gpProduct.flags().premiumUi;
    if (p === '/x' || p === '/x/') {
      if (!premiumOn) { json(res, 404, { error: 'No encontrado' }); return; }
      try {
        const pf = path.join(__dirname, 'public', 'premium.html');
        const vjs = Math.floor(fs.statSync(path.join(__dirname, 'public', 'premium.js')).mtimeMs);
        const vcss = Math.floor(fs.statSync(path.join(__dirname, 'public', 'premium.css')).mtimeMs);
        let html = fs.readFileSync(pf, 'utf8')
          .replace('src="premium.js"', `src="premium.js?v=${vjs}"`)
          .replace('href="premium.css"', `href="premium.css?v=${vcss}"`);
        // A.8: fixtures QA del cockpit — se inyectan SOLO con el flag GP_PREMIUM_QA_ENABLED (preview interno).
        if (gpProduct.flags().premiumQa) {
          try {
            const vqa = Math.floor(fs.statSync(path.join(__dirname, 'public', 'premium-qa.js')).mtimeMs);
            html = html.replace(`<script src="premium.js?v=${vjs}">`, `<script src="premium-qa.js?v=${vqa}"></script><script src="premium.js?v=${vjs}">`);
          } catch {}
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(html);
      } catch { json(res, 404, { error: 'No encontrado' }); return; }
    }
    if (/^\/premium\.(js|css)$/.test(p) && !premiumOn) { json(res, 404, { error: 'No encontrado' }); return; }
    if (p === '/premium-qa.js' && (!premiumOn || !gpProduct.flags().premiumQa)) { json(res, 404, { error: 'No encontrado' }); return; }
    const betaOn = gpProduct.flags().betaUi;
    if (p === '/beta' || p === '/beta/') {
      if (!betaOn) { json(res, 404, { error: 'No encontrado' }); return; }
      try {
        const betaFull = path.join(__dirname, 'public', 'beta.html');
        const vjs = Math.floor(fs.statSync(path.join(__dirname, 'public', 'beta.js')).mtimeMs);
        const vcss = Math.floor(fs.statSync(path.join(__dirname, 'public', 'beta.css')).mtimeMs);
        let html = fs.readFileSync(betaFull, 'utf8')
          .replace('src="beta.js"', `src="beta.js?v=${vjs}"`)
          .replace('href="beta.css"', `href="beta.css?v=${vcss}"`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(html);
      } catch { json(res, 404, { error: 'No encontrado' }); return; }
    }
    // estáticos beta (beta.js / beta.css): solo si la beta está encendida.
    if (/^\/beta\.(js|css)$/.test(p) && !betaOn) { json(res, 404, { error: 'No encontrado' }); return; }
    // --- estáticos ---
    let file = p === '/' ? '/index.html' : p;
    const full = path.join(__dirname, 'public', path.normalize(file));
    // index.html: inyecta una versión (mtime) a app.js/style.css → cache-busting automático.
    // Garantiza que cualquier navegador (también desktop con caché agresiva) cargue el código nuevo
    // tras cada deploy, sin tener que hacer hard-refresh.
    if (full === path.join(__dirname, 'public', 'index.html')) {
      try {
        const vjs = Math.floor(fs.statSync(path.join(__dirname, 'public', 'app.js')).mtimeMs);
        const vcss = Math.floor(fs.statSync(path.join(__dirname, 'public', 'style.css')).mtimeMs);
        let html = fs.readFileSync(full, 'utf8')
          .replace('src="app.js"', `src="app.js?v=${vjs}"`)
          .replace('href="style.css"', `href="style.css?v=${vcss}"`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(html);
      } catch { /* si falla, cae al servido normal */ }
    }
    if (full.startsWith(path.join(__dirname, 'public')) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      const ext = path.extname(full);
      // html/js/css siempre revalidan (si no, los usuarios quedan con código viejo tras cada deploy);
      // imágenes sí se cachean
      const cache = ['.html', '.js', '.css'].includes(ext)
        ? 'no-cache, must-revalidate'
        : 'public, max-age=86400';
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cache,
        'Last-Modified': fs.statSync(full).mtime.toUTCString(),
      });
      return fs.createReadStream(full).pipe(res);
    }
    json(res, 404, { error: 'No encontrado' });
  } catch (e) {
    console.error(e);
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`⚽ Simulador Mundial 2026 → http://localhost:${PORT}`);
  fetchMarkets().catch(() => { });
  // Mercados/oportunidades: refresco cada 1 min (antes 5 min)
  setInterval(() => Promise.all([fetchMarkets(true), fetchMatchMarkets(true)])
    .then(() => { broadcast('markets', { ts: marketCache.ts }); return tgTick(); }).catch(() => { }), 60 * 1000);
  // Resultados desde ESPN cada 30 s (antes 2 min) → marcador en vivo más fresco
  syncFromESPN();
  setInterval(syncFromESPN, 30 * 1000);
  // En Render free el servicio duerme tras 15 min sin tráfico: auto-ping cada 10 min para mantenerlo 24/7
  if (process.env.RENDER_EXTERNAL_URL) {
    setInterval(() => fetch(process.env.RENDER_EXTERNAL_URL + '/api/version').catch(() => { }), 10 * 60 * 1000);
  }
  // Sprint 1 — ingesta de mercado en shadow mode. BEST-EFFORT y AISLADA: con los flags apagados no hace
  // nada; un fallo aquí jamás debe afectar al flujo principal (de ahí el catch vacío).
  marketData.initialize().catch(() => { });
  // Sprint 2 — scheduler de matching canónico. Hace autónomo el pipeline (ingesta→match→evaluación). Solo
  // arranca si CANONICAL_GRAPH_ENABLED+WRITE+AUTO_MATCH; best-effort, aislado, anti-solape (advisory lock).
  try { require('./canonical-graph/scheduler').start(); } catch { /* aislado */ }
  // Sprint 3 — scheduler del motor de arbitraje (shadow, sin publicación). Solo arranca si los flags
  // ARB_ENGINE_* lo habilitan; best-effort, aislado del flujo principal.
  try { require('./arb-engine/scheduler').start(); } catch { /* aislado */ }
  // Sprint 6 — scheduler de métricas (recalcula incremental). Solo si METRICS_ENGINE_SCHEDULER_ENABLED.
  try { require('./metrics-engine/scheduler').start(); } catch { /* aislado */ }
  // Sprint 7 — scheduler del Value Engine + monitor de precio de picks. Solo si los flags VALUE/PICKS lo habilitan.
  try { require('./value-engine/scheduler').start(); } catch { /* aislado */ }
  // Retención de telemetría shadow (market-data + arb-engine) — evita que la DB se llene (incidente jun-28).
  // Solo si GP_TELEMETRY_RETENTION_ENABLED; best-effort, aislada. Corre 1 min tras arrancar y luego cada 30 min.
  try {
    const retention = require('./market-data/retention');
    if (retention.enabled()) {
      const dbc = require('./database/client');
      const runRetention = () => retention.pruneTelemetry(dbc).then(r => console.log('[retention]', JSON.stringify(r))).catch(() => { });
      setTimeout(runRetention, 60 * 1000);
      setInterval(runRetention, 30 * 60 * 1000);
    }
  } catch { /* aislado */ }
  // Motor de contexto por evento (jun-28). Solo si CONTEXT_ENGINE_ENABLED. Corre 40s tras arrancar y cada 20 min:
  // evalúa todos los fixtures canónicos próximos con la capa de contexto en vivo y persiste snapshots+observaciones.
  // SHADOW (no toca el modelo oficial). Aislado/best-effort.
  try {
    if (contextEngineOn()) {
      const runCtx = () => evaluateUpcomingContext({ limit: 60 }).then(r => console.log('[context-engine]', JSON.stringify(r))).catch(() => { });
      setTimeout(runCtx, 40 * 1000);
      setInterval(runCtx, 20 * 60 * 1000);
    }
  } catch { /* aislado */ }
  // Fase H.1 — cablea el result provider del settlement automático: accesor a los resultados ESPN (db.results).
  // Solo el marcador REGLAMENTARIO (sin prórroga ni penales): para knockout con penales → regulation null → UNRESOLVED.
  try {
    require('./signal-registry/sweeps').setResultProvider((fixture) => {
      const r = db.results && db.results[fixture.fixture_id];
      if (!r) return null;
      const regulationKnown = !fixture.is_knockout && r.pensHome == null; // grupos = 90' reglamentarios
      const status = r.status === 'final' ? 'post' : r.status === 'live' ? 'in' : 'pre';
      return {
        providerStatus: status,
        regulationHomeGoals: regulationKnown ? r.hg : null,
        regulationAwayGoals: regulationKnown ? r.ag : null,
        observedAt: new Date().toISOString(),
        finalizedAt: r.status === 'final' ? new Date().toISOString() : null,
      };
    });
  } catch { /* aislado */ }
  // Fase J.1/P — cablea el resolver OFICIAL al Value scheduler. Selector por modelo oficial efectivo
  // (v1 default; v2 tras el cutover; kill switch fuerza v1). Boot consistency check: log del modelo activo.
  try {
    const eff = require('./model-registry/promotion').effectiveOfficialModel();
    require('./value-engine/scheduler').setGpResolver(officialGpResolver());
    require('./database/logger').info('boot: official GP model', { official_model: eff });
  } catch { /* aislado */ }
  // Fase O §16 — cablea el resultResolver real (ESPN) al shadow_loop: settlement/metrics shadow automáticos
  // cuando un evento eliminatorio finalice (regulation). AISLADO: nunca afecta el lifecycle oficial V1.
  try { require('./value-engine/scheduler').setShadowResultResolver((cid) => require('./shadow-ops/resultResolver').resolve(cid)); } catch { /* aislado */ }
  // Sprint 8A — orquestador de jobs (registro de runs, heartbeats, dependencias, apagado ordenado). INERTE
  // si OPERATIONS_ORCHESTRATOR_ENABLED=false: no arranca timers, no escribe, no toca el manejo de señales.
  operations.initialize({ flushDb }).catch(() => { /* aislado */ }); // flushDb: persistir db.json en el apagado coordinado
});
