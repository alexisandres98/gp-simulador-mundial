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
const marketScanner = require('./market-scanner');        // Scanner multi-venue (Arbitraje puro + Precio atrasado). INERTE sin MARKET_SCANNER_ENABLED.
const marketScannerDto = require('./market-scanner/dto');  // DTO neutral del scanner para /api/beta/arbitrage
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
// Datos GRANDES de clubes (player-history/results/fotos/af-map ~17MB) NO viven en git (inflaban el clone del
// deploy a 114MB → builds de 17min). Se sirven del disco persistente <dir(DB_FILE)>/clubs/ si están ahí;
// fallback al repo (data/clubs/) para dev y para los archivos chicos (ratings.json queda versionado).
const CLUB_DATA_DISK = path.join(path.dirname(DB_FILE), 'clubs');
function clubDataFile(name) {
  try { const d = path.join(CLUB_DATA_DISK, name); if (fs.existsSync(d)) return d; } catch { /* */ }
  return path.join(__dirname, 'data', 'clubs', name);
}
const teamById = Object.fromEntries(TEAMS.map(t => [t.id, t]));

// ---------- persistencia ----------
let db = { users: {}, sessions: {}, codes: {}, magic: {}, results: {}, elos: {}, history: [] };
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

// ---------- backup automático de db.json (sin servicios externos, sin costo) ----------
// Copia diaria rotativa en <dir(DB_FILE)>/backups/db-YYYY-MM-DD.json (mismo disco persistente de Render).
// Protege contra corrupción/borrado accidental del archivo; para pérdida del disco está el download admin
// (GET /api/admin/backup). Retención: 14 días. Idempotente por día; chequeo barato cada 6h + al boot.
const BACKUP_DIR = path.join(path.dirname(DB_FILE), 'backups');
const BACKUP_KEEP = 14;
function backupDbDaily() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const dest = path.join(BACKUP_DIR, `db-${today}.json`);
    if (fs.existsSync(dest)) return; // ya hay backup de hoy
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    // serializa el estado EN MEMORIA (más fresco que el archivo) a un tmp y renombra (write atómico)
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, dest);
    // retención: conservar los últimos BACKUP_KEEP
    const files = fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, f));
    console.log(`[backup] db.json respaldado en ${dest} (${files.length > BACKUP_KEEP ? BACKUP_KEEP : files.length} retenidos)`);
  } catch (e) { console.error('[backup] error:', e.message); }
}
setTimeout(backupDbDaily, 90 * 1000);            // al boot (90s después, sin competir con el arranque)
setInterval(backupDbDaily, 6 * 3600 * 1000);     // chequeo cada 6h (escribe solo si falta el del día)

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

// Ganador REAL de un partido (incl. prórroga y penales). r.winner es autoritativo (de ESPN); si falta, se
// deduce del marcador y, en empate, de la tanda (pensHome). Devuelve null si fue empate sin desempate (grupos).
function matchWinner(r, home, away) {
  if (!r) return null;
  if (r.winner) return r.winner;
  if (r.hg > r.ag) return home;
  if (r.hg < r.ag) return away;
  if (r.pensHome === true) return home;
  if (r.pensHome === false) return away;
  return null; // empate genuino (fase de grupos)
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
    return matchWinner(r, r.home, r.away);
  };
  const loserOf = m => {
    const r = db.results[String(m)];
    if (!r || r.status !== 'final') return null;
    const w = matchWinner(r, r.home, r.away);
    return w == null ? null : (w === r.home ? r.away : r.home);
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
// Horarios REALES de kickoff según ESPN (todo el torneo, refrescado cada 30s por syncFromESPN). Fuente de verdad
// para la cadencia adaptativa de los loops: los datetimes de nuestro calendario KNOCKOUT pueden divergir del
// horario oficial (solo R32 quedó anclado por instante) → sin esto la ventana "normal" caería a la hora equivocada.
let espnKickoffs = [];
// Horario REAL por PAR de equipos (clave ids ordenados → [ISO,...]). Fuente de verdad para los KO cuyo slot de
// calendario no tiene datetime (R16+ solo trae fecha) → sin esto todos caían al fallback 18:00Z ("todo a las 6 PM").
let espnKoTimes = {};
function espnKickoffFor(h, a, aroundDate) {
  if (!h || !a) return null;
  const list = espnKoTimes[[h, a].sort().join('|')] || [];
  if (!list.length) return null;
  // mismo par puede jugar dos veces (grupos y luego eliminatoria) → elegir el evento más cercano a la fecha del slot
  const target = aroundDate ? new Date(aroundDate + 'T12:00Z').getTime() : null;
  if (target == null) return list[0];
  let best = null, bd = Infinity;
  for (const iso of list) { const d = Math.abs(new Date(iso).getTime() - target); if (d < bd) { bd = d; best = iso; } }
  return bd <= 4 * 86400000 ? best : null; // solo si cae a ±4 días del slot (misma llave)
}
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
    // horarios reales de TODO el torneo → fuente de verdad de la cadencia adaptativa de los loops
    { const ks = (j.events || []).map(ev => +new Date(ev.date)).filter(Number.isFinite); if (ks.length) espnKickoffs = ks; }
    // PASO 0: anclar los cruces de eliminatorias a la realidad de ESPN por hora de inicio (las horas de nuestro
    // calendario coinciden con el oficial). Así corregimos emparejamientos mal computados (p.ej. mejores terceros)
    // ANTES de resolver el bracket → el partido real se reconoce y se ingiere/transmite correctamente.
    const koTimesNew = {};
    for (const ev of j.events || []) {
      const c = ev.competitions && ev.competitions[0]; if (!c || !ev.date) continue;
      const H = c.competitors.find(x => x.homeAway === 'home'), A = c.competitors.find(x => x.homeAway === 'away');
      if (!H || !A) continue;
      const hId = espnTeamId[normName(H.team.displayName)] || espnTeamId[normName(H.team.name)];
      const aId = espnTeamId[normName(A.team.displayName)] || espnTeamId[normName(A.team.name)];
      if (hId && aId) {
        // horario REAL por par (todo el torneo) → corrige los KO sin datetime propio (fallback 18:00Z)
        const key = [hId, aId].sort().join('|');
        (koTimesNew[key] = koTimesNew[key] || []).push(ev.date);
      }
      const inst = new Date(ev.date).getTime(); const m = koSlotByInstant[inst];
      if (m == null) continue; // solo slots de eliminatoria con hora conocida (R32)
      if (hId && aId) koOverride[m] = { home: hId, away: aId, espnId: ev.id }; // espnId → habilita fallback de alineaciones ESPN en KO
    }
    if (Object.keys(koTimesNew).length) espnKoTimes = koTimesNew;
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
      const espnWinner = H.winner ? hId : A.winner ? aId : null;   // ganador autoritativo de ESPN (incl. prórroga/penales)
      const period = (ev.status && ev.status.period) || 0;          // 2=reg, 3/4=prórroga, 5=tanda de penales
      const detail = (ev.status && ev.status.type && ev.status.type.detail) || '';

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
          payload.hpen = flip ? aPen : hPen;   // tanda orientada a home/away de la llave
          payload.apen = flip ? hPen : aPen;
        }
        payload.winner = espnWinner || null;   // ganador real (prórroga/penales incluidos)
        payload.decided = (hPen != null && aPen != null) || /pen/i.test(detail) || period >= 5 ? 'pens'
          : (period === 3 || period === 4 || /\bET\b|AET|extra|prórroga|prorroga/i.test(detail)) ? 'et' : 'reg';
        // Snapshot del marcador REGLAMENTARIO: mientras el reloj no pasó de 90 (el descuento muestra "90'+X"
        // → parseInt=90) el último marcador visto ES el de los 90'. Si el partido luego va a prórroga/penales,
        // este snapshot permite liquidar las picks a 90' (igual que las casas) en vez de anularlas.
        if (payload.status === 'live' && minute <= 90) payload.reg90 = { hg: payload.hg, ag: payload.ag, minute };
        matchId = String(m);
      }
      const prev = db.results[matchId];
      const same = prev && prev.status === payload.status && prev.hg === payload.hg &&
        prev.ag === payload.ag && prev.minute === payload.minute && prev.pensHome === payload.pensHome &&
        prev.winner === payload.winner && prev.decided === payload.decided && prev.hpen === payload.hpen;
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
// Resolución TOLERANTE de nombres de proveedor → team id. Los proveedores varían la forma ("Bosnia & Herzegovina"
// vs "Bosnia and Herzegovina", guiones, "Utd"). Sin esto, un nombre no resuelto rompe la navegación de la UI
// (card → análisis del partido) para ese evento.
function resolveTeamIdLoose(name) {
  if (!name) return null;
  const n = normName(name);
  return aliasToId[n]
    || aliasToId[normName(String(name).replace(/&/g, 'and'))]
    || aliasToId[normName(String(name).replace(/[-–—]/g, ' '))]
    || aliasToId[normName(String(name).replace(/\butd\b/i, 'united'))]
    || null;
}

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
db.goalPicks = db.goalPicks || [];             // GOLES G5: Picks de goles (shadow/admin). Registro completo §6.
db.dailyPicks = db.dailyPicks || [];           // PICKS DIARIAS (producto /x): auto-publicadas, feed efímero. Track record solo admin.
db.tsaXg = db.tsaXg || {};
db.tsaPlayers = db.tsaPlayers || {};              // stats por jugador de partidos TERMINADOS (TheStatsAPI): cache permanente para settlement de props.                     // xG observado por partido TERMINADO (TheStatsAPI): cache PERMANENTE (1 fetch por partido, plan 12 req/min).
db.observations = db.observations || {};       // CAPA DE OBSERVACIÓN (shadow): señales de disponibilidad por equipo desde noticias publicadas. Solo admin.
db.momentum = db.momentum || {};               // MOMENTUM GP en vivo: serie de prob GP muestreada cada ~30s por partido (persiste post-partido para el gráfico y contenido).
db.clubMomentum = db.clubMomentum || {};       // MOMENTUM GP en vivo de CLUBES (F1.2): misma serie que db.momentum pero por cruce de liga (clubScoreKey). Muestreada por clubScoresSync (30s), cero llamadas externas.
db.clubObservations = db.clubObservations || {}; // OBSERVER de CLUBES (F2.3, shadow): señales de disponibilidad por tm_id desde Google News. Mismo pipeline que db.observations del Mundial (extract/verify/assess/narrate).
db.fotmob = db.fotmob || { matches: [] };      // EVENT DATA incremental (FotMob): partidos terminados post-deploy (el histórico vive en data/fotmob-events.json del repo). Cache permanente por matchId.
db.premiumGrants = db.premiumGrants || {};     // PLANES (Whop): email → {plan:'pro'|'sharp', status:'active'|'cancelled'|'past_due', founder, source, whop_membership_id, since, updatedAt}
db.whopEvents = db.whopEvents || [];           // últimos eventos del webhook de Whop (debug admin; ring 100)
db.supportMsgs = db.supportMsgs || [];         // mensajes de soporte in-platform (respaldo local; ring 200)

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

// ===== PLANES / entitlements de pago (Whop) =====
// premiumGrants es la fuente de verdad del plan de cada usuario (se alimenta por webhook de Whop o grant
// manual admin). GP_PLANS_ENFORCED gobierna si el gating se APLICA: default OFF → durante el Mundial todos
// tienen acceso completo (comportamiento actual intacto); se enciende en el lanzamiento de pagos.
// El ADMIN siempre es 'sharp' y puede PREVISUALIZAR otros planes con ?asplan=free|pro (solo admin).
function plansEnforced() { return betaBool(process.env.GP_PLANS_ENFORCED); }
function planFor(email) {
  if (!email) return 'free';
  if (isAdmin(email)) return 'sharp';
  const g = db.premiumGrants[String(email).toLowerCase()];
  if (g && g.status === 'active' && (g.plan === 'pro' || g.plan === 'sharp')) return g.plan;
  return 'free';
}
function effectivePlan(email, asplan) {
  if (email && isAdmin(email) && (asplan === 'free' || asplan === 'pro' || asplan === 'sharp')) return asplan; // preview admin
  if (!plansEnforced()) return 'sharp'; // pre-lanzamiento: acceso completo para todos
  return planFor(email);
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
    const isKO = !!f.ko;
    const winner = isKO ? matchWinner(r, h, a) : (r.hg > r.ag ? h : r.hg < r.ag ? a : null);
    const winnerSide = winner === h ? 'home' : winner === a ? 'away' : null;
    let predicted, predictedProb, correct;
    if (isKO) {
      // ELIMINATORIA: no hay empate como resultado final → el modelo apuesta a quién AVANZA (favorito).
      // Acierto si el equipo favorito efectivamente ganó la llave (en 90', prórroga o penales).
      predicted = probs.home >= probs.away ? 'home' : 'away';
      predictedProb = predicted === 'home' ? probs.home : probs.away;
      correct = winnerSide != null && predicted === winnerSide;
    } else {
      const picks = [['home', probs.home], ['draw', probs.draw], ['away', probs.away]].sort((x, y) => y[1] - x[1]);
      predicted = picks[0][0]; predictedProb = picks[0][1];
      const actual = r.hg > r.ag ? 'home' : r.hg < r.ag ? 'away' : 'draw';
      correct = predicted === actual;
    }
    finished.push({
      id: f.id, datetime: f.datetime, home: h, away: a, hg: r.hg, ag: r.ag,
      predicted, predictedProb: +predictedProb.toFixed(4),
      probs: { home: +probs.home.toFixed(4), draw: +probs.draw.toFixed(4), away: +probs.away.toFixed(4) },
      likelyScore: probs.likelyScore,
      correct,
      exact: probs.likelyScore === `${r.hg}-${r.ag}`,
      ko: isKO, decided: r.decided || 'reg',
      pens: (r.hpen != null && r.apen != null) ? { home: r.hpen, away: r.apen } : null,
      winner: winner || null,
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
// Email masivo BANKROLL (7-jul): "cuanto hubieras generado siguiendo todas las picks". Idioma FIJO por
// variante (bankroll_es / bankroll_en): TODOS los usuarios reciben ambos, por decision de Alexis.
// PDF completo hosteado en /informes (adjuntarlo a ~1,400 envios mata entregabilidad) + tabla inline.
function bankrollEmail(lang) {
  const en = lang === 'en';
  const url = 'https://gpsimulador.com';
  const pdf = url + '/informes/bankroll-sim-' + (en ? 'en' : 'es') + '.pdf';
  const subject = en
    ? 'If you had followed every pick: $5,000 became $10,356 in two weeks'
    : 'Si hubieras seguido todas las picks: $5,000 se convirtieron en $10,356 en dos semanas';
  const preheader = en
    ? '52 settled picks, 67.3% hit rate, worst night included. The full report, pick by pick, in PDF.'
    : '52 picks liquidadas, 67.3% de acierto, con la peor noche incluida. El informe completo, pick por pick, en PDF.';
  const rows = [
    ['$5,000 · Kelly 1/4', '$8,099', '+62.0%'],
    ['$5,000 · Kelly 1/2', '$10,356', '+107.1%'],
    ['$10,000 · Kelly 1/4', '$16,197', '+62.0%'],
    ['$10,000 · Kelly 1/2', '$20,712', '+107.1%'],
  ];
  const text = en
    ? `We ran the numbers.

If a user had deposited $5,000 on June 30 and followed EVERY pick the system published, staking with the platform calculator (fractional Kelly), today they would have $10,356 with 1/2 Kelly (+107.1%) or $8,099 with 1/4 Kelly (+62.0%).

With $10,000: $20,712 or $16,197.

The record behind it: 52 settled picks from June 30 to July 12, our worst night included. 35 won, 17 lost. 67.3% hit rate. Every pick, stake and result is in the full report:

${pdf}

Today's picks are already on the board: ${url}

Past performance does not guarantee future results. Two weeks is a small sample. Not financial advice. 18+.

- Alexis · GP Simulador

You are receiving this email because you have an account at GP Simulador.`
    : `Corrimos los numeros.

Si un usuario hubiera depositado $5,000 el 30 de junio y hubiera seguido TODAS las picks que publico el sistema, con el stake de la calculadora de la plataforma (Kelly fraccionado), hoy tendria $10,356 con Kelly 1/2 (+107.1%) o $8,099 con Kelly 1/4 (+62.0%).

Con $10,000: $20,712 o $16,197.

El registro detras: 52 picks liquidadas del 30 de junio al 12 de julio, con nuestra peor noche incluida. 35 ganadas, 17 perdidas. 67.3% de acierto. Cada pick, stake y resultado esta en el informe completo:

${pdf}

Las picks de hoy ya estan en el tablero: ${url}

Rendimientos pasados no garantizan resultados futuros. Dos semanas es una muestra corta. No es consejo financiero. 18+.

- Alexis · GP Simulador

Recibes este correo porque tienes una cuenta en GP Simulador.`;
  const html = `<div style="background:#f4f6f5;padding:24px 12px;margin:0">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f6f5">${preheader}</span>
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:linear-gradient(135deg,#0E2A1E,#0a1f16);padding:28px 26px 24px;color:#fff">
      <div style="font-size:13px;letter-spacing:.08em;color:#18E6A3;font-weight:700;text-transform:uppercase">${en ? 'The numbers are in' : 'Corrimos los numeros'}</div>
      <h1 style="margin:8px 0 0;font-size:23px;line-height:1.25">${en ? 'If you had followed <span style="color:#18E6A3">every pick</span> of the system' : 'Si hubieras seguido <span style="color:#18E6A3">todas las picks</span> del sistema'}</h1>
      <p style="margin:11px 0 0;font-size:14px;color:#c7d3ce;line-height:1.5">${en ? 'June 30 to July 12 · 52 settled picks · 35 won, 17 lost · <b style="color:#18E6A3">67.3% hit rate</b>' : 'Del 30 de junio al 12 de julio · 52 picks liquidadas · 35 ganadas, 17 perdidas · <b style="color:#18E6A3">67.3% de acierto</b>'}</p>
    </div>
    <div style="padding:24px 26px">
      <p style="margin:0 0 14px;font-size:14px;color:#2b3a33;line-height:1.6">${en ? 'A user deposits the capital, follows every pick and stakes with the platform calculator (fractional Kelly). This is where the bankroll ends up:' : 'Un usuario deposita el capital, sigue todas las picks y apuesta con la calculadora de la plataforma (Kelly fraccionado). Asi termina el bankroll:'}</p>
      <table style="border-collapse:collapse;width:100%;font-size:14px">
        ${rows.map(r => `<tr><td style="padding:8px 10px;border:1px solid #e6ebe9;color:#2b3a33"><b>${r[0]}</b></td><td style="padding:8px 10px;border:1px solid #e6ebe9;font-weight:800;color:#14201A">${r[1]}</td><td style="padding:8px 10px;border:1px solid #e6ebe9;color:#0a8f5b;font-weight:700">${r[2]}</td></tr>`).join('')}
      </table>
      <p style="margin:14px 0 20px;font-size:13px;color:#5c6f66;line-height:1.6">${en ? 'Every pick, the odds, the stake and the result, one by one, are in the full report.' : 'Cada pick, la cuota, el stake y el resultado, una por una, estan en el informe completo.'}</p>
      <div style="text-align:center;margin-bottom:10px"><a href="${pdf}" style="display:inline-block;background:#18E6A3;color:#06231A;font-weight:800;font-size:15px;padding:13px 26px;border-radius:99px;text-decoration:none">${en ? 'Download the full report (PDF)' : 'Descargar el informe completo (PDF)'}</a></div>
      <div style="text-align:center;margin-bottom:22px"><a href="${url}" style="display:inline-block;color:#0a8f5b;font-weight:700;font-size:14px;text-decoration:none">${en ? "See today's picks →" : 'Ver las picks de hoy →'}</a></div>
      <p style="margin:0;font-size:11px;color:#9aa8a1;line-height:1.5">${en ? 'Retrospective simulation over the real pick record. Past performance does not guarantee future results; two weeks is a small sample and variance is high. Not financial advice. 18+.' : 'Simulacion retrospectiva sobre el registro real de picks. Rendimientos pasados no garantizan resultados futuros; dos semanas es una muestra corta y la varianza es alta. No es consejo financiero. 18+.'}</p>
    </div>
    <div style="padding:14px 26px;background:#fafbfa;border-top:1px solid #eef2f0;font-size:11px;color:#9aa8a1">${en ? 'You are receiving this email because you have an account at GP Simulador. To stop receiving updates, reply with "unsubscribe".' : 'Recibes este correo porque tienes una cuenta en GP Simulador. Para no recibir novedades, responde con "baja".'}</div>
  </div></div>`;
  return { subject, text, html };
}

// Email de FEATURES (8-jul): anuncia los mercados nuevos (córners, tarjetas, goleador) + perfiles de
// jugador + intel del partido, con los cuartos de final como gancho. Idioma FIJO por variante (todos
// reciben ambos, mismo criterio que bankroll). SIN rayitas (regla dura de textos públicos).
function featuresEmail(lang) {
  const en = lang === 'en';
  const url = 'https://gpsimulador.com';
  const subject = en
    ? 'New on your account: corners, cards, goalscorers and player intelligence'
    : 'Nuevo en tu cuenta: córners, tarjetas, goleadores y perfiles de jugador';
  const preheader = en
    ? 'The system now reads three new markets and every player has an intelligence profile. Live for the quarter finals.'
    : 'El sistema ahora lee tres mercados nuevos y cada jugador tiene su perfil de inteligencia. Ya activo para los cuartos de final.';
  const text = en
    ? `The biggest upgrade since launch is live on your account.

THREE NEW PICK MARKETS
The same system that hit 81.5% on its settled picks now also reads corners, cards and goalscorer markets. When it finds a play worth taking, it lands on your board next to the daily picks, with the best odds and the bookmaker.

PLAYER INTELLIGENCE PROFILES
Search any player by name, or tap a name in a lineup, and you get his full profile: production per 90 minutes, match by match form, whether he is projected to start, what the market is paying for him and the system's read on why. With his photo and his numbers against the rest of his position.

MATCH INTEL ON EVERY QUARTER FINAL
Probable scorers with their goal probability, projected shot volume and an availability radar that tracks who might miss the match, updated from published sources around the clock.

PICKS THAT PROTECT THEMSELVES
If a player pick is published and the official lineup later comes out without him, the pick withdraws itself before kickoff. No dead tickets.

The quarter finals start tomorrow. France vs Morocco, Spain vs Belgium, Norway vs England, Argentina vs Switzerland. The board is already loaded:

${url}

Also new: direct support from your profile menu. Write to us and a human answers.

Past performance does not guarantee future results. Not financial advice. 18+.

Alexis · GP Simulador

You are receiving this email because you have an account at GP Simulador. To stop receiving updates, reply with "unsubscribe".`
    : `La actualización más grande desde el lanzamiento ya está activa en tu cuenta.

TRES MERCADOS NUEVOS DE PICKS
El mismo sistema que acertó el 81.5% de sus picks liquidadas ahora también lee córners, tarjetas y goleador del partido. Cuando encuentra una jugada que vale la pena, aparece en tu tablero junto a las picks diarias, con la mejor cuota y la casa.

PERFILES DE INTELIGENCIA POR JUGADOR
Buscá a cualquier jugador por nombre, o tocá su nombre en una alineación, y tenés su perfil completo: producción por 90 minutos, forma partido a partido, si se proyecta titular, qué está pagando el mercado por él y la lectura del sistema con sus razones. Con su foto y sus números contra el resto de su posición.

INTEL DEL PARTIDO EN CADA CUARTO DE FINAL
Anotadores probables con su probabilidad de gol, volumen de remates proyectado y un radar de disponibilidad que detecta quién puede perderse el partido, actualizado desde fuentes publicadas todo el día.

PICKS QUE SE PROTEGEN SOLAS
Si una pick de jugador está publicada y la alineación oficial sale sin él, la pick se retira sola antes del kickoff. Cero tickets muertos.

Los cuartos arrancan mañana. Francia vs Marruecos, España vs Bélgica, Noruega vs Inglaterra, Argentina vs Suiza. El tablero ya está cargado:

${url}

También nuevo: soporte directo desde el menú de tu perfil. Escribinos y te responde un humano.

Rendimientos pasados no garantizan resultados futuros. No es consejo financiero. 18+.

Alexis · GP Simulador

Recibes este correo porque tienes una cuenta en GP Simulador. Para no recibir novedades, responde con "baja".`;
  const F = [
    en ? ['Three new pick markets', 'Corners, cards and goalscorer of the match. Same system, more markets. Every pick lands with the best odds and the bookmaker.'] : ['Tres mercados nuevos de picks', 'Córners, tarjetas y goleador del partido. El mismo sistema, más mercados. Cada pick llega con la mejor cuota y la casa.'],
    en ? ['Player intelligence profiles', 'Search any player or tap his name in a lineup: production per 90, match by match form, projected role, what the market pays for him and why the system reads him that way. With photo.'] : ['Perfiles de inteligencia por jugador', 'Buscá a cualquier jugador o tocá su nombre en una alineación: producción por 90, forma partido a partido, rol proyectado, qué paga el mercado por él y por qué el sistema lo lee así. Con foto.'],
    en ? ['Match intel in every quarter final', 'Probable scorers with goal probability, projected shots and an availability radar that catches who might miss the match.'] : ['Intel del partido en cada cuarto de final', 'Anotadores probables con probabilidad de gol, remates proyectados y un radar de disponibilidad que detecta quién puede perderse el partido.'],
    en ? ['Picks that protect themselves', 'If the official lineup comes out without the player of a pick, the pick withdraws itself before kickoff.'] : ['Picks que se protegen solas', 'Si la alineación oficial sale sin el jugador de una pick, la pick se retira sola antes del kickoff.'],
    en ? ['Direct support', 'From your profile menu. A human answers.'] : ['Soporte directo', 'Desde el menú de tu perfil. Te responde un humano.'],
  ];
  const html = `<div style="background:#f4f6f5;padding:24px 12px;margin:0">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f6f5">${preheader}</span>
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:linear-gradient(135deg,#0E2A1E,#0a1f16);padding:28px 26px 24px;color:#fff">
      <div style="font-size:13px;letter-spacing:.08em;color:#18E6A3;font-weight:700;text-transform:uppercase">${en ? 'Already live on your account' : 'Ya activo en tu cuenta'}</div>
      <h1 style="margin:8px 0 0;font-size:24px;line-height:1.22">${en ? 'Corners, cards, goalscorers and <span style="color:#18E6A3">player intelligence</span>' : 'Córners, tarjetas, goleadores y <span style="color:#18E6A3">perfiles de jugador</span>'}</h1>
      <p style="margin:11px 0 0;font-size:14px;color:#c7d3ce;line-height:1.5">${en ? 'The system that hit 81.5% of its settled picks now reads three new markets and profiles every player. Live for the quarter finals.' : 'El sistema que acertó el 81.5% de sus picks liquidadas ahora lee tres mercados nuevos y perfila a cada jugador. Ya activo para los cuartos de final.'}</p>
    </div>
    <div style="padding:24px 26px">
      ${F.map(f => `<div style="margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid #eef2f0"><p style="margin:0 0 4px;font-size:14.5px;color:#14201A;font-weight:800">${f[0]}</p><p style="margin:0;font-size:13.5px;color:#2b3a33;line-height:1.55">${f[1]}</p></div>`).join('')}
      <p style="margin:2px 0 18px;font-size:14px;color:#2b3a33;line-height:1.6"><b>${en ? 'The quarter finals start tomorrow.' : 'Los cuartos arrancan mañana.'}</b> ${en ? 'France vs Morocco, Spain vs Belgium, Norway vs England, Argentina vs Switzerland. The board is already loaded.' : 'Francia vs Marruecos, España vs Bélgica, Noruega vs Inglaterra, Argentina vs Suiza. El tablero ya está cargado.'}</p>
      <div style="text-align:center;margin-bottom:22px"><a href="${url}" style="display:inline-block;background:#18E6A3;color:#06231A;font-weight:800;font-size:15px;padding:13px 28px;border-radius:99px;text-decoration:none">${en ? 'Open my board' : 'Abrir mi tablero'}</a></div>
      <p style="margin:0;font-size:11px;color:#9aa8a1;line-height:1.5">${en ? 'Past performance does not guarantee future results. Not financial advice. 18+.' : 'Rendimientos pasados no garantizan resultados futuros. No es consejo financiero. 18+.'}</p>
    </div>
    <div style="padding:14px 26px;background:#fafbfa;border-top:1px solid #eef2f0;font-size:11px;color:#9aa8a1">${en ? 'You are receiving this email because you have an account at GP Simulador.' : 'Recibes este correo porque tienes una cuenta en GP Simulador.'}</div>
  </div></div>`;
  return { subject, text, html };
}

// LANZAMIENTO POST-MUNDIAL (18-jul): la fusión. La plataforma deja de ser "del Mundial" y se abre completa —
// 15 ligas, picks multi-liga, value/arbitraje, cartera, casas, watch price, brief. Fin de semana abierto para
// todos; la fase founder cierra con el Mundial. Un correo por usuario en SU idioma (userLang).
function launchEmail(lang) {
  const en = lang === 'en';
  const url = 'https://gpsimulador.com';
  const subject = en
    ? 'The full platform is open: 15 leagues, daily picks and the new GP Simulador'
    : 'Abrimos la plataforma completa: 15 ligas, picks diarias y el nuevo GP Simulador';
  const preheader = en
    ? 'The model that read the World Cup now reads all of football. Everything is open for you this weekend.'
    : 'El modelo que leyó el Mundial ahora lee el fútbol entero. Todo abierto para vos este fin de semana.';
  const F = [
    en ? ['15 live leagues', 'Brasileirão, MLS, Liga MX, Argentina, Colombia and more — every match with the same deep analysis you saw in the World Cup: probabilities, context, lineups, projected goals.'] : ['15 ligas en vivo', 'Brasileirão, MLS, Liga MX, Argentina, Colombia y más — cada partido con el mismo análisis profundo que viste en el Mundial: probabilidades, contexto, alineaciones, goles proyectados.'],
    en ? ['Daily multi-league picks', 'The same engine that published its World Cup picks in public, now across club football. With the why, the price and the record.'] : ['Picks diarias multi-liga', 'El mismo motor que publicó sus picks del Mundial en público, ahora sobre el fútbol de clubes. Con su porqué, su cuota y su registro.'],
    en ? ['Unified value & arbitrage', 'One single list of opportunities: model vs market and cross-book contradictions, across every competition.'] : ['Value y arbitraje unificados', 'Una sola lista de oportunidades: modelo vs mercado y contradicciones entre casas, en todas las competiciones.'],
    en ? ['My bets & my books', 'Log what you bet and track your P&L, record and personal CLV. Mark the books where you have an account and see only what is executable for you.'] : ['Mi cartera y mis casas', 'Registrá lo que apostás y seguí tu P&L, récord y CLV personal. Marcá las casas donde tenés cuenta y mirá solo lo ejecutable para vos.'],
    en ? ['Price watch & Daily Brief', "Set a target price and we email you when the market reaches it. The day's opportunities, line moves and availability radar in one place."] : ['Vigilar precio y Daily Brief', 'Elegí una cuota objetivo y te avisamos cuando el mercado la alcanza. Las oportunidades del día, movimientos de línea y radar de bajas en un solo lugar.'],
  ];
  const text = (en
    ? `The World Cup ends this Sunday. What we built in public during the tournament — the model, the verified picks, the analysis cockpit — is no longer just about the World Cup: starting today it is a complete football intelligence platform, on your same account.\n\n`
    : `El Mundial termina este domingo. Lo que construimos en público durante el torneo — el modelo, las picks verificadas, el cockpit de análisis — ya no es solo del Mundial: desde hoy es una plataforma completa de inteligencia de fútbol, con tu misma cuenta.\n\n`)
    + F.map(f => `· ${f[0]}: ${f[1]}`).join('\n')
    + (en
      ? `\n\nEverything is open to every user until the World Cup ends. Come in, explore, try it all — no limits this weekend.\n\nOne more thing: the founder phase ends with the World Cup. Until Sunday the founder price is locked for life for whoever takes it; after that, plans return to their normal price.\n\n${url}\n\nEstimates from a statistical model, not financial advice. 18+. Reply "unsubscribe" to stop receiving these.`
      : `\n\nTodo está abierto para todos los usuarios hasta que termine el Mundial. Entrá, recorré, probá — sin límites este fin de semana.\n\nY una cosa más: la fase founder termina con el Mundial. Hasta el domingo el precio founder queda congelado de por vida para quien lo tome; después, los planes vuelven a su precio normal.\n\n${url}\n\nEstimaciones de un modelo estadístico, no consejo financiero. 18+. Respondé "baja" para no recibir estos correos.`);
  const html = `<div style="background:#f4f6f5;padding:24px 12px;margin:0">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f6f5">${preheader}</span>
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:linear-gradient(135deg,#0E2A1E,#0a1f16);padding:28px 26px 24px;color:#fff">
      <div style="font-size:13px;letter-spacing:.08em;color:#18E6A3;font-weight:700;text-transform:uppercase">${en ? 'The platform is now one' : 'La plataforma ya es una sola'}</div>
      <h1 style="margin:8px 0 0;font-size:24px;line-height:1.22">${en ? 'The model that read the World Cup <span style="color:#18E6A3">now reads all of football</span>' : 'El modelo que leyó el Mundial <span style="color:#18E6A3">ahora lee el fútbol entero</span>'}</h1>
      <p style="margin:11px 0 0;font-size:14px;color:#c7d3ce;line-height:1.5">${en ? 'Everything you saw during the World Cup — plus 15 live leagues — is open on your same account. Free for everyone this weekend.' : 'Todo lo que viste en el Mundial — más 15 ligas en vivo — está abierto en tu misma cuenta. Gratis para todos este fin de semana.'}</p>
    </div>
    <div style="padding:24px 26px">
      ${F.map(f => `<div style="margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid #eef2f0"><p style="margin:0 0 4px;font-size:14.5px;color:#14201A;font-weight:800">${f[0]}</p><p style="margin:0;font-size:13.5px;color:#2b3a33;line-height:1.55">${f[1]}</p></div>`).join('')}
      <p style="margin:2px 0 18px;font-size:14px;color:#2b3a33;line-height:1.6"><b>${en ? 'Open for everyone this weekend.' : 'Abierto para todos este fin de semana.'}</b> ${en ? 'And the founder phase ends with the World Cup — until Sunday the founder price is locked for life; after that, plans return to their normal price.' : 'Y la fase founder termina con el Mundial — hasta el domingo el precio founder queda congelado de por vida; después, los planes vuelven a su precio normal.'}</p>
      <div style="text-align:center;margin-bottom:22px"><a href="${url}" style="display:inline-block;background:#18E6A3;color:#06231A;font-weight:800;font-size:15px;padding:13px 28px;border-radius:99px;text-decoration:none">${en ? 'Open the platform' : 'Entrar a la plataforma'}</a></div>
      <p style="margin:0;font-size:11px;color:#9aa8a1;line-height:1.5">${en ? 'Estimates from a statistical model, not financial advice. 18+.' : 'Estimaciones de un modelo estadístico, no consejo financiero. 18+.'}</p>
    </div>
    <div style="padding:14px 26px;background:#fafbfa;border-top:1px solid #eef2f0;font-size:11px;color:#9aa8a1">${en ? 'You are receiving this email because you have an account at GP Simulador. Reply "unsubscribe" to opt out.' : 'Recibes este correo porque tienes una cuenta en GP Simulador. Responde "baja" para no recibirlos.'}</div>
  </div></div>`;
  return { subject, text, html };
}

// LANZAMIENTO — VERSIÓN PERSONAL ANTI-PROMOCIONES (18-jul). El launchEmail de plantilla cayó en Promociones
// (HTML pesado + botones + List-Unsubscribe = señales de bulk). Este aplica el playbook PROBADO del reengage
// (que llega a Principal): texto plano 1:1 firmado por Alexis, CERO etiquetas <a> (la URL va como texto),
// sin imágenes ni botones, termina con una PREGUNTA (invita respuesta = señal fuerte de Principal), y se
// envía con from: REENGAGE_FROM + noListUnsub (la baja vive en el cuerpo).
function launchPersonalEmail(lang) {
  const en = lang === 'en';
  const tr = dailyPicksTrackRecord().overall || {};
  const hit = tr.hit_rate != null ? Math.round(tr.hit_rate * 100) : 63;
  if (en) {
    const subject = 'I left everything open for you until Sunday';
    const text = `Hi,

I'm Alexis, the person behind GP Simulador. I'm writing to you directly because there are two things I want you to know before the final.

First: this weekend I left the full platform open for everyone with an account. The model that followed the World Cup now reads 15 leagues — Brasileirão, MLS, Liga MX, Argentina and more — with daily picks, the complete analysis of every match, market comparison, and new tools like your personal bet tracker and price alerts. Log in with your usual account at gpsimulador.com and look around; nothing is locked until Sunday.

Second: during the World Cup the model published every one of its picks in public and hit ${hit}%, with a +27% return for anyone who followed them. All verifiable inside, pick by pick. That record is the reason behind the founder plan: a price frozen for life for the first people in. It closes on Sunday with the final — on Monday the platform becomes paid and plans return to their normal price.

If the World Cup was useful to you, this is the same thing, every day of the year.

Which league would you like the model to follow first? Reply and tell me — I read every answer.

Alexis
GP Simulador

(If you'd rather not get my emails, reply "unsubscribe" and I'll take you off the list.)`;
    const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">` +
      text.split('\n\n').map(p => '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>') + '</p>').join('') + `</div>`;
    return { subject, text, html };
  }
  const subject = 'te dejé todo abierto hasta el domingo';
  const text = `Hola,

Soy Alexis, el que está detrás de GP Simulador. Te escribo directo porque hay dos cosas que quiero que sepas antes de la final.

La primera: este fin de semana dejé la plataforma completa abierta para todos los que tienen cuenta. El modelo que siguió el Mundial ahora lee 15 ligas — Brasileirão, MLS, Liga MX, Argentina y más — con picks diarias, el análisis completo de cada partido, comparación contra el mercado y herramientas nuevas como tu cartera de apuestas y alertas de precio. Entrá con tu cuenta de siempre en gpsimulador.com y recorrelo; no hay nada bloqueado hasta el domingo.

La segunda: durante el Mundial el modelo publicó todas sus picks en público y acertó el ${hit}%, con un retorno del +27% para quien las siguió. Todo verificable adentro, pick por pick. Ese registro es la razón del plan founder: un precio congelado de por vida para los primeros que se suban. Se cierra el domingo con la final — el lunes la plataforma pasa a ser de pago y los planes vuelven a su precio normal.

Si el Mundial te sirvió, esto es lo mismo todos los días del año.

¿Qué liga te gustaría que el modelo siga primero? Respondeme y contame — leo todas las respuestas.

Alexis
GP Simulador

(Si preferís no recibir mis correos, respondé "baja" y te saco de la lista.)`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">` +
    text.split('\n\n').map(p => '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>') + '</p>').join('') + `</div>`;
  return { subject, text, html };
}

// LAST CALL (19-jul, cierre de la fase founder): correo CORTO estilo personal → bandeja Principal (mismo playbook
// anti-Promociones que launchPersonalEmail: from REENGAGE_FROM + noListUnsub, sin <a>/imágenes, baja en el cuerpo,
// cierra con invitación a responder). Gancho de urgencia "última oportunidad". Cobertura encuadrada como TODO EL
// AÑO (cualquier liga/club que las casas coticen en cualquier temporada), NO solo las 14 activas hoy. Track record
// en vivo. Se envía a TODOS en inglés (variant lastcall_en).
function lastCallEmail(lang) {
  const en = lang !== 'es';
  const tr = dailyPicksTrackRecord().overall || {};
  const hit = tr.hit_rate != null ? Math.round(tr.hit_rate * 100) : 63;
  const roi = tr.roi_pct != null ? Math.round(tr.roi_pct) : 27;
  const mk = (subject, text) => ({
    subject, text,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">` +
      text.split('\n\n').map(p => '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>') + '</p>').join('') + `</div>`,
  });
  if (en) {
    return mk('the founder price closes tonight', `Hi,

Alexis here — fast, because the clock is real.

The World Cup ends tonight, and the founder price ends with it. From tomorrow it's the regular price. This is the last email before that door shuts.

What you lock in tonight, frozen for life: the same model that called the World Cup in public — ${hit}% hit, +${roi}% return, every pick verifiable — now on club football all year round. Whatever league the sportsbooks are pricing — this month, next season, anywhere in the world — the model follows it as it comes into season. Daily picks, the full read on every match, your own bet tracker and price alerts.

You already have the account. It's open right now at gpsimulador.com — locking the founder price takes a minute. After the final, it's gone.

If the World Cup was useful to you, don't let this one slip by. Want in? Just reply "yes" and I'll make sure you're set.

Alexis
GP Simulador

(Not for you? Reply "unsubscribe" and I'll take you off the list.)`);
  }
  return mk('el precio founder se cierra esta noche', `Hola,

Soy Alexis, rápido porque el reloj es real.

El Mundial termina esta noche, y el precio founder termina con él. Desde mañana es el precio normal. Este es el último correo antes de que esa puerta se cierre.

Lo que congelás esta noche, de por vida: el mismo modelo que siguió el Mundial en público — ${hit}% de acierto, +${roi}% de retorno, todo verificable — ahora sobre fútbol de clubes todo el año. Cualquier liga que las casas coticen — este mes, la próxima temporada, en cualquier parte del mundo — el modelo la sigue en cuanto entra en temporada. Picks diarias, el análisis completo de cada partido, tu cartera de apuestas y alertas de precio.

Ya tenés la cuenta. Está abierta ahora en gpsimulador.com — congelar el precio founder te toma un minuto. Después de la final, se va.

Si el Mundial te sirvió, no dejes pasar esta. ¿Te sumás? Respondé "sí" y me aseguro de que quedes adentro.

Alexis
GP Simulador

(¿No es para vos? Respondé "baja" y te saco de la lista.)`);
}

// REACTIVACIÓN post-Mundial (20-jul): a los que NO activaron suscripción (free + leads). Estilo PERSONAL
// anti-Promociones (from REENGAGE_FROM + noListUnsub, sin <a>, baja en el cuerpo, cierra con pregunta →
// Principal). CAJA NEGRA: la predicción de España NO revela cómo funciona el modelo. Teaser UFC/boxeo
// como 2º deporte incluido en Sharp. Idioma FIJO (reactivate_es ahora / reactivate_en +6h).
function reactivateEmail(lang) {
  const en = lang !== 'es';
  const mk = (subject, text) => ({
    subject, text,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1a1a;max-width:560px">` +
      text.split('\n\n').map(p => '<p style="margin:0 0 14px">' + p.replace(/\n/g, '<br>') + '</p>').join('') + `</div>`,
  });
  if (en) {
    return mk('we called Spain — from day one', `Hi,

Alexis here, from GP Simulador — writing to you directly.

I noticed you never activated your subscription during the founder phase. No worries at all — but I want to show you what's coming, because I think you'll want in.

Remember we said Spain would win the World Cup? We called it before the first match was played, when nobody had them that clear. And Spain lifted the trophy. Yesterday we closed our World Cup run with that call proven, in plain sight.

But the World Cup was just the proof. From here on, the same model — sharper than ever — covers every league and every club, every single day: daily picks, the full read on each match, value, and a stack of new tools. Football all year, not once every four.

And something I'm genuinely excited about: soon we add UFC and boxing as a second sport, with the same intelligence layer and picks — at no extra cost, included in the Sharp plan.

If the World Cup was useful to you, this is the same thing, every day. Log in with your usual account at gpsimulador.com and take a look at the plans.

Which league would you like the model to follow first? Reply and I'll tell you exactly what it sees for that weekend.

Alexis
GP Simulador

(If you'd rather not hear from me, reply "unsubscribe" and I'll take you off the list.)`);
  }
  return mk('lo de España lo dijimos desde el día uno', `Hola,

Soy Alexis, de GP Simulador. Te escribo yo, directo.

Me di cuenta de que no llegaste a activar tu suscripción durante la fase founder. Sin drama — pero quiero mostrarte lo que viene, porque creo que te va a interesar.

¿Te acordás de que dijimos que España ganaba el Mundial? Lo dijimos desde antes del primer partido, cuando nadie la daba tan clara. Y España levantó la copa. Ayer cerramos nuestra etapa del Mundial con esa predicción cumplida, a la vista de todos.

Pero el Mundial era solo la prueba. Desde ahora, el mismo modelo — más afilado que nunca — cubre cada liga y cada club, todos los días: picks diarias, el análisis completo de cada partido, value, y un montón de herramientas nuevas. Fútbol todo el año, no una vez cada cuatro.

Y algo que se viene y me tiene entusiasmado: pronto sumamos UFC y boxeo como segundo deporte, con la misma capa de inteligencia y picks — sin costo extra, incluido en el plan Sharp.

Si el Mundial te sirvió, esto es lo mismo, todos los días. Entrá con tu cuenta de siempre en gpsimulador.com y mirá los planes.

¿Qué liga querés que el modelo siga primero? Respondeme y te cuento qué ve para ese fin de semana.

Alexis
GP Simulador

(¿No querés saber más de mí? Respondé "baja" y te saco de la lista.)`);
}

// SECUENCIA FOUNDER (lanzamiento 12-jul): 3 correos, ES/EN, caja negra, sin rayitas. Los números
// (track record, cupos) se resuelven AL MOMENTO DEL ENVÍO — nunca quedan viejos en el copy.
// seq: 1 = apertura · 2 = los números (prueba) · 3 = última llamada. ctx.spotsLeft viene del contador Whop.
function founderEmail(seq, lang, ctx = {}) {
  const en = lang === 'en';
  const url = 'https://gpsimulador.com/plans';
  const tr = dailyPicksTrackRecord().overall || {};
  const hit = tr.hit_rate != null ? Math.round(tr.hit_rate * 100) : null;
  const roi = tr.roi_pct != null ? tr.roi_pct : null;
  const spots = ctx.spotsLeft != null ? ctx.spotsLeft : 100;
  const wrap = (kicker, h1, bodyHtml, ctaLabel) => `<div style="background:#f4f6f5;padding:24px 12px;margin:0">
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:linear-gradient(135deg,#0E2A1E,#0a1f16);padding:28px 26px 24px;color:#fff">
      <div style="font-size:13px;letter-spacing:.08em;color:#18E6A3;font-weight:700;text-transform:uppercase">${kicker}</div>
      <h1 style="margin:8px 0 0;font-size:24px;line-height:1.22">${h1}</h1>
    </div>
    <div style="padding:24px 26px">
      ${bodyHtml}
      <div style="text-align:center;margin:20px 0 22px"><a href="${url}" style="display:inline-block;background:#18E6A3;color:#06231A;font-weight:800;font-size:15px;padding:13px 28px;border-radius:99px;text-decoration:none">${ctaLabel}</a></div>
      <p style="margin:0;font-size:11px;color:#9aa8a1;line-height:1.5">${en ? 'Past performance does not guarantee future results. Not financial advice. 18+. Refunds within 24 hours of your first charge.' : 'Rendimientos pasados no garantizan resultados futuros. No es consejo financiero. 18+. Reembolso dentro de las 24 horas del primer cobro.'}</p>
    </div>
    <div style="padding:14px 26px;background:#fafbfa;border-top:1px solid #eef2f0;font-size:11px;color:#9aa8a1">${en ? 'You are receiving this email because you have an account at GP Simulador.' : 'Recibes este correo porque tienes una cuenta en GP Simulador.'}</div>
  </div></div>`;
  const p = s => `<p style="margin:0 0 14px;font-size:14px;color:#2b3a33;line-height:1.6">${s}</p>`;
  const li = s => `<p style="margin:0 0 8px;font-size:14px;color:#2b3a33;line-height:1.55">· ${s}</p>`;

  if (seq === 1) {
    const subject = en ? 'Founder Pass: your price locked for life (first 100)' : 'Founder Pass: tu precio de por vida (primeros 100)';
    // Línea de transparencia (12-jul): la peor jornada del torneo va en el email de apertura, no se esconde.
    // Los porcentajes son vivos (track record al momento del envío); el 2 de 11 es el dato de la noche del 11-jul.
    const transEs = `Y esos resultados incluyen lo malo: anoche tuvimos nuestra peor jornada del torneo (2 aciertos de 11) y está completa en el registro, no borramos ni maquillamos derrotas. Aun con ella, el historial va en ${hit}% de acierto con +${roi}% de ROI. Así se ve un sistema real.`;
    const transEn = `And those results include the bad part: last night was our worst day of the tournament (2 hits out of 11) and it is fully in the record, we do not delete or dress up losses. Even with it, the history stands at ${hit}% hit rate with +${roi}% ROI. That is what a real system looks like.`;
    const text = en
      ? `You used the full platform for free during the World Cup. That was on purpose: I wanted you to see the results before asking you for anything.\n\n${transEn}\n\nToday I am opening the Founder Pass: the first 100 people in keep the founder price forever.\n\n· Pro: 12 dollars a month (going to 20 after). Every winner and goals pick, live cockpit, player profiles, stake calculator, alerts.\n· Sharp: 39 dollars a month (going to 59 after). Everything in Pro, plus corners, cards, goalscorers and assists, the mispriced odds detector, the 40+ books scanner, and new sports coming soon.\n\nThe price you lock today never goes up while you keep your subscription. Annual: 2 months free. Refund within 24 hours if it is not for you.\n\nSecure my Founder Pass: ${url}\n\nQuarterfinals are done, semifinals and the final are ahead. And after the World Cup comes the full club calendar: this platform does not shut down on the 19th, that is when it really starts.\n\nAlexis · GP Simulador`
      : `Durante todo el Mundial usaste la plataforma completa gratis. Eso fue a propósito: quería que vieras los resultados antes de pedirte un peso.\n\n${transEs}\n\nHoy abro el Founder Pass: los primeros 100 que entren se quedan con el precio fundador para siempre.\n\n· Pro: 12 dólares al mes (después será 20). Todas las picks de ganador y goles, cockpit en vivo, perfiles de jugador, calculadora de stake, alertas.\n· Sharp: 39 dólares al mes (después será 59). Todo lo de Pro, más córners, tarjetas, goleadores y asistencias, el detector de cuotas mal pagadas, el escáner de más de 40 casas, y nuevos deportes muy pronto.\n\nEl precio que asegures hoy no sube nunca mientras mantengas la suscripción. Anual: 2 meses gratis. Reembolso dentro de las 24 horas si no te convence.\n\nAsegurar mi Founder Pass: ${url}\n\nQuedan semifinales y la final. Y después del Mundial viene el calendario completo de clubes: la plataforma no se apaga el 19, ahí arranca.\n\nAlexis · GP Simulador`;
    const html = wrap(
      en ? 'Founder Pass · first 100' : 'Founder Pass · primeros 100',
      en ? 'Your price, <span style="color:#18E6A3">locked for life</span>' : 'Tu precio, <span style="color:#18E6A3">congelado de por vida</span>',
      p(en ? 'You used the full platform for free during the World Cup. That was on purpose: I wanted you to see the results before asking you for anything.' : 'Durante todo el Mundial usaste la plataforma completa gratis. Eso fue a propósito: quería que vieras los resultados antes de pedirte un peso.') +
      p(en ? transEn : transEs) +
      p(en ? '<b>Today I open the Founder Pass:</b> the first 100 people in keep the founder price forever.' : '<b>Hoy abro el Founder Pass:</b> los primeros 100 que entren se quedan con el precio fundador para siempre.') +
      li(en ? '<b>Pro: $12/month</b> (going to $20). Every winner and goals pick, live cockpit, player profiles, stake calculator, alerts.' : '<b>Pro: $12/mes</b> (después $20). Todas las picks de ganador y goles, cockpit en vivo, perfiles de jugador, calculadora, alertas.') +
      li(en ? '<b>Sharp: $39/month</b> (going to $59). Everything in Pro plus corners, cards, goalscorers and assists, value detector, 40+ books scanner, and new sports coming soon.' : '<b>Sharp: $39/mes</b> (después $59). Todo lo de Pro más córners, tarjetas, goleadores y asistencias, detector de value, escáner de 40+ casas, y nuevos deportes muy pronto.') +
      p(en ? 'The price you lock today never goes up while you keep your subscription. Annual: 2 months free. Refund within 24 hours if it is not for you.' : 'El precio que asegures hoy no sube nunca mientras mantengas tu suscripción. Anual: 2 meses gratis. Reembolso dentro de las 24 horas si no te convence.'),
      en ? 'Secure my Founder Pass →' : 'Asegurar mi Founder Pass →'
    );
    return { subject, text, html };
  }
  if (seq === 2) {
    const rec = hit != null ? `${tr.wins}/${tr.settled} (${hit}%)` : '';
    const subject = en ? 'If you had followed every pick, this is what would have happened' : 'Si hubieras seguido todas las picks, esto habría pasado';
    const pdf = en ? 'https://gpsimulador.com/informes/bankroll-sim-en.pdf' : 'https://gpsimulador.com/informes/bankroll-sim-es.pdf';
    const text = en
      ? `Yesterday I opened the Founder Pass and spots are going. Today I want to show you why.\n\nThe real record (check it under Performance in your account): ${tr.settled} settled picks, ${tr.wins} wins, ${hit}% hit rate, +${roi}% ROI. Published BEFORE each match, settled after. No way to cheat that. And it includes our worst night of the tournament, nothing was removed.\n\nThe real money simulation: we took the full history and simulated a 5,000 dollar bankroll following every pick with the platform calculator. Result: 10,356 dollars in two weeks. The full report, pick by pick: ${pdf}\n\nA Sharp subscription costs 39 dollars a month with the Founder Pass. ${spots} founder spots left out of 100.\n\nSecure my Founder Pass: ${url}\n\nAlexis · GP Simulador`
      : `Ayer abrí el Founder Pass y los cupos están corriendo. Hoy te muestro por qué.\n\nEl registro real (podés verlo en Rendimiento dentro de tu cuenta): ${tr.settled} picks liquidadas, ${tr.wins} ganadas, ${hit}% de acierto, +${roi}% de ROI. Publicadas ANTES de cada partido, liquidadas después. Sin trampa posible. Y el historial incluye nuestra peor noche del torneo, no se borró nada.\n\nLa simulación con dinero real: tomamos el historial completo y simulamos un bankroll de 5,000 dólares siguiendo todas las picks con la calculadora de la plataforma. Resultado: 10,356 dólares en dos semanas. El informe completo, pick por pick: ${pdf}\n\nUna suscripción Sharp cuesta 39 dólares al mes con el Founder Pass. Quedan ${spots} cupos founder de 100.\n\nAsegurar mi Founder Pass: ${url}\n\nAlexis · GP Simulador`;
    const html = wrap(
      en ? 'The numbers' : 'Los números',
      en ? `${rec} hit rate, <span style="color:#18E6A3">+${roi}% ROI</span>, all public` : `${rec} de acierto, <span style="color:#18E6A3">+${roi}% de ROI</span>, todo público`,
      p(en ? 'Yesterday I opened the Founder Pass and spots are going. Today I want to show you why.' : 'Ayer abrí el Founder Pass y los cupos están corriendo. Hoy te muestro por qué.') +
      p(en ? `<b>The real record</b> (under Performance in your account): ${tr.settled} settled picks, ${tr.wins} wins, ${hit}% hit rate, +${roi}% ROI. Published BEFORE each match, settled after. No way to cheat that.` : `<b>El registro real</b> (en Rendimiento dentro de tu cuenta): ${tr.settled} picks liquidadas, ${tr.wins} ganadas, ${hit}% de acierto, +${roi}% de ROI. Publicadas ANTES de cada partido, liquidadas después. Sin trampa posible.`) +
      p(en ? `<b>The real money simulation:</b> a 5,000 dollar bankroll following every pick with the platform calculator became <b>10,356 dollars in two weeks</b>, worst night included. <a href="${pdf}" style="color:#0BA661;font-weight:700">Full report, pick by pick →</a>` : `<b>La simulación con dinero real:</b> un bankroll de 5,000 dólares siguiendo todas las picks con la calculadora de la plataforma se convirtió en <b>10,356 dólares en dos semanas</b>, con la peor noche incluida. <a href="${pdf}" style="color:#0BA661;font-weight:700">Informe completo, pick por pick →</a>`) +
      p(en ? `A Sharp subscription is $39/month with the Founder Pass. <b>${spots} founder spots left out of 100.</b>` : `Una suscripción Sharp cuesta $39/mes con el Founder Pass. <b>Quedan ${spots} cupos founder de 100.</b>`),
      en ? 'Secure my Founder Pass →' : 'Asegurar mi Founder Pass →'
    );
    return { subject, text, html };
  }
  // seq 3: última llamada
  const subject = en ? 'Semifinals, the final, and a decision' : 'Semifinales, la final y una decisión';
  const text = en
    ? `This is the last week of the World Cup: semifinals and the final on Sunday the 19th. The platform will be on for every match, with picks, live odds and the scanner running.\n\nIt is also the last call for the Founder Pass. ${spots} spots left out of 100. When they are gone, prices move to the permanent ones: Pro at 20, Sharp at 59.\n\nWhat you lock in today:\n· Your price frozen for life (12 or 39 dollars a month)\n· Full access to the final week of the World Cup\n· Everything that comes after: the full club calendar, more markets, new sports. Founders get in first on all of it.\n\nIf you have been following the results, you already know what the system does. This is the window to keep it at the early price.\n\nSecure my Founder Pass: ${url}\n\nSee you at the semifinals.\nAlexis · GP Simulador`
    : `Esta es la última semana del Mundial: semifinales y la final del domingo 19. La plataforma va a estar encendida para cada partido, con picks, cuotas en vivo y el escáner corriendo.\n\nY es también la última llamada del Founder Pass. Quedan ${spots} cupos de 100. Cuando se acaben, los precios pasan a los definitivos: Pro 20, Sharp 59.\n\nLo que asegurás hoy:\n· Tu precio congelado de por vida (12 o 39 dólares al mes)\n· Acceso completo a la última semana del Mundial\n· Todo lo que viene después: el calendario completo de clubes, más mercados, nuevos deportes. Los founders entran primero a todo.\n\nSi venís siguiendo los resultados, ya sabés lo que hace el sistema. Esta es la ventana para quedártelo al precio de los primeros.\n\nAsegurar mi Founder Pass: ${url}\n\nNos vemos en las semifinales.\nAlexis · GP Simulador`;
  const html = wrap(
    en ? 'Last call' : 'Última llamada',
    en ? `${spots} founder spots left, <span style="color:#18E6A3">then prices go up</span>` : `Quedan ${spots} cupos founder, <span style="color:#18E6A3">después los precios suben</span>`,
    p(en ? 'This is the last week of the World Cup: semifinals and the final on Sunday the 19th. The platform will be on for every match.' : 'Esta es la última semana del Mundial: semifinales y la final del domingo 19. La plataforma va a estar encendida para cada partido.') +
    li(en ? 'Your price frozen for life ($12 or $39 a month)' : 'Tu precio congelado de por vida ($12 o $39 al mes)') +
    li(en ? 'Full access to the final week of the World Cup' : 'Acceso completo a la última semana del Mundial') +
    li(en ? 'Everything after: the full club calendar, more markets, new sports. Founders get in first.' : 'Todo lo que viene después: calendario completo de clubes, más mercados, nuevos deportes. Los founders entran primero.') +
    p(en ? 'If you have been following the results, you already know what the system does. This is the window to keep it at the early price.' : 'Si venís siguiendo los resultados, ya sabés lo que hace el sistema. Esta es la ventana para quedártelo al precio de los primeros.'),
    en ? 'Secure my Founder Pass →' : 'Asegurar mi Founder Pass →'
  );
  return { subject, text, html };
}

function broadcastEmail(referLink, lang) {
  if (lang === 'en') return broadcastEmailEN(referLink);
  const url = 'https://gpsimulador.com';
  const subject = 'Ya está aquí: la nueva plataforma de GP Simulador';
  const preheader = 'Picks diarias, mejores cuotas entre 40+ casas, calculadora de stake y la lectura del torneo en vivo — todo en gpsimulador.com.';
  const text = `Hola,

Se acabó la espera: la nueva plataforma de GP Simulador ya está LIVE para todos. Una sola plataforma, mucho más potente — y ahora todo vive en un mismo lugar: gpsimulador.com.

Tu misma cuenta, tu historial intacto, una experiencia completamente nueva.

Qué encontrarás:
• Picks diarias del modelo — a quién apostar y cuántos goles, claro y directo.
• Value y arbitraje — dónde el mercado paga de más, comparando 40+ casas por ti.
• Calculadora de stake — cuánto apostar según tu bankroll, prellenada con la probabilidad del modelo.
• La lectura del torneo en vivo — quién levanta la copa, recalculado con cada gol.
• Terminal más rápida y bilingüe (ES/EN), pensada para el móvil.

Entra ahora: ${url}

Tus seguidos, tu historial y tus alertas siguen igual. Solo entra y ya estás dentro.

— Alexis · GP Simulador del Mundial

Recibes este correo porque tienes una cuenta en GP Simulador. Para no recibir novedades, responde a este correo con "baja".`;
  const html = `<div style="background:#f4f6f5;padding:24px 12px;margin:0">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f6f5">${preheader}</span>
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:linear-gradient(135deg,#0E2A1E,#0a1f16);padding:28px 26px 24px;color:#fff">
      <div style="font-size:13px;letter-spacing:.08em;color:#18E6A3;font-weight:700;text-transform:uppercase">Ya está live · gratis</div>
      <h1 style="margin:8px 0 0;font-size:24px;line-height:1.22">La nueva plataforma de <span style="color:#18E6A3">GP Simulador</span> ya está aquí</h1>
      <p style="margin:11px 0 0;font-size:14px;color:#c7d3ce;line-height:1.5">Una sola plataforma, mucho más potente. Tu misma cuenta y todo tu historial — una experiencia completamente nueva.</p>
    </div>
    <div style="padding:24px 26px">
      <p style="margin:0 0 12px;font-size:14px;color:#14201A;font-weight:700">Qué encontrarás</p>
      <ul style="margin:0 0 22px;padding-left:18px;line-height:1.7;font-size:14px;color:#2b3a33">
        <li><b>Picks diarias del modelo</b> — a quién apostar y cuántos goles, claro y directo.</li>
        <li><b>Value y arbitraje</b> — dónde el mercado paga de más, entre <b>40+ casas</b>.</li>
        <li><b>Calculadora de stake</b> — cuánto apostar según tu bankroll, con la probabilidad del modelo.</li>
        <li><b>La lectura del torneo en vivo</b> — quién levanta la copa, recalculado con cada gol.</li>
        <li>Terminal más rápida, <b>bilingüe (ES/EN)</b> y pensada para el móvil.</li>
      </ul>
      <p style="text-align:center;margin:0 0 10px">
        <a href="${url}" style="display:inline-block;background:#0E9F6E;color:#fff;text-decoration:none;font-weight:800;padding:16px 34px;border-radius:99px;font-size:15px">Entrar a la plataforma →</a>
      </p>
      <p style="text-align:center;margin:0 0 22px;font-size:12px;color:#8a9a92">Un solo lugar: <b style="color:#0E2A1E">gpsimulador.com</b></p>
      <p style="margin:0;font-size:13px;color:#5a6a62;line-height:1.5">Tus seguidos, historial, alertas y preferencias siguen intactos. Solo entra y ya estás dentro de la nueva plataforma.</p>
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
  const url = 'https://gpsimulador.com';
  const subject = 'It’s here: the new GP Simulador platform';
  const preheader = 'Daily picks, best odds across 40+ books, a stake calculator and the live tournament read — all at gpsimulador.com.';
  const text = `Hi,

The wait is over: the new GP Simulador platform is now LIVE for everyone. One platform, far more powerful — and now everything lives in one place: gpsimulador.com.

Same account, history intact, a completely new experience.

What you'll find:
• Daily model picks — who to back and how many goals, clear and direct.
• Value and arbitrage — where the market overpays, comparing 40+ books for you.
• Stake calculator — how much to bet based on your bankroll, prefilled with the model's probability.
• The live tournament read — who lifts the cup, recalculated with every goal.
• A faster, bilingual (EN/ES) terminal, built for mobile.

Come in now: ${url}

Your follows, history and alerts stay the same. Just log in and you're already inside.

— Alexis · World Cup GP Simulator

You're getting this because you have an account at GP Simulador. To stop receiving updates, reply "unsubscribe".`;
  const html = `<div style="background:#f4f6f5;padding:24px 12px;margin:0">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f6f5">${preheader}</span>
  <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:540px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:linear-gradient(135deg,#0E2A1E,#0a1f16);padding:28px 26px 24px;color:#fff">
      <div style="font-size:13px;letter-spacing:.08em;color:#18E6A3;font-weight:700;text-transform:uppercase">Now live · free</div>
      <h1 style="margin:8px 0 0;font-size:24px;line-height:1.22">The new <span style="color:#18E6A3">GP Simulador</span> platform is here</h1>
      <p style="margin:11px 0 0;font-size:14px;color:#c7d3ce;line-height:1.5">One platform, far more powerful. Your same account and full history — a completely new experience.</p>
    </div>
    <div style="padding:24px 26px">
      <p style="margin:0 0 12px;font-size:14px;color:#14201A;font-weight:700">What you'll find</p>
      <ul style="margin:0 0 22px;padding-left:18px;line-height:1.7;font-size:14px;color:#2b3a33">
        <li><b>Daily model picks</b> — who to back and how many goals, clear and direct.</li>
        <li><b>Value and arbitrage</b> — where the market overpays, across <b>40+ books</b>.</li>
        <li><b>Stake calculator</b> — how much to bet based on your bankroll, with the model's probability.</li>
        <li><b>The live tournament read</b> — who lifts the cup, recalculated with every goal.</li>
        <li>A faster, <b>bilingual (EN/ES)</b> terminal, built for mobile.</li>
      </ul>
      <p style="text-align:center;margin:0 0 10px">
        <a href="${url}" style="display:inline-block;background:#0E9F6E;color:#fff;text-decoration:none;font-weight:800;padding:16px 34px;border-radius:99px;font-size:15px">Enter the platform →</a>
      </p>
      <p style="text-align:center;margin:0 0 22px;font-size:12px;color:#8a9a92">One place: <b style="color:#0E2A1E">gpsimulador.com</b></p>
      <p style="margin:0;font-size:13px;color:#5a6a62;line-height:1.5">Your follows, history, alerts and preferences stay intact. Just log in and you're already inside.</p>
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

// Email de REACTIVACIÓN de LEADS (9-jul): a quien puso su email pero nunca entró (el código cayó en spam o
// se trabó en el copy/paste). Genera un MAGIC LINK personalizado por lead (un toque y entra, sin código),
// TTL 7 días. Estilo personal/plano (cae en Principal, no Promociones). Solo INGLÉS (audiencia anglófona).
function leadReactivationEmail(email) {
  const tok = crypto.randomBytes(24).toString('hex');
  db.magic[tok] = { email: String(email).toLowerCase(), exp: Date.now() + 7 * 24 * 3600 * 1000 };
  const mlink = `https://gpsimulador.com/api/auth/magic?t=${tok}`;
  const btn = 'display:inline-block;background:#0BA661;color:#fff;font-weight:bold;font-size:16px;padding:14px 32px;border-radius:99px;text-decoration:none';
  const subject = 'Your GP Simulador access is one tap away';
  const text = `Hi,

You entered your email at GP Simulador but never made it inside — the access code probably landed in your spam or promotions folder.

No code needed this time. Just tap this link and you're in:

${mlink}

Inside you'll find the model's picks for today's World Cup quarter-finals, the best odds across 40+ bookmakers, and the full track record: 25 of the last 30 settled picks landed (83%).

See you inside,
Alexis · GP Simulador

This link logs you in directly and works for the next 7 days.`;
  const html = `<div style="font-family:-apple-system,Arial,sans-serif;max-width:460px;margin:0 auto;color:#1a1a1a;font-size:15px;line-height:1.6">
<p style="margin:18px 0 12px">Hi,</p>
<p style="margin:0 0 12px">You entered your email at GP Simulador but never made it inside — the access code probably landed in your <b>spam</b> or <b>promotions</b> folder.</p>
<p style="margin:0 0 18px">No code needed this time. Just tap the button and you're in:</p>
<p style="text-align:center;margin:0 0 22px"><a href="${mlink}" style="${btn}">Enter the platform →</a></p>
<p style="margin:0 0 14px">Inside you'll find the model's picks for today's World Cup quarter-finals, the best odds across 40+ bookmakers, and the full track record: <b>25 of the last 30 settled picks landed (83%)</b>.</p>
<p style="margin:18px 0 2px">See you inside,</p>
<p style="margin:0;color:#444">Alexis · GP Simulador</p>
<p style="margin:20px 0 0;font-size:12px;color:#999">This link logs you in directly and works for the next 7 days.</p>
</div>`;
  return { subject, text, html };
}

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
    // ALERTAS EN TIEMPO REAL del scanner multi-venue (Fase F): surebets ejecutables + precios atrasados fuertes,
    // ya con fees/gates (a diferencia del legacy). Dedup por oportunidad+día. Gateado por MARKET_SCANNER_ALERTS_ENABLED.
    await tgScannerAlerts(day).catch(e => console.error('[telegram] scanner alerts:', e.message));
    // Publicación de "oportunidades" del Sistema A legacy (arbitrage(), solo campeón Poly↔Kalshi, SIN descontar
    // fees → falsos positivos). APAGADA por defecto: el research confirmó que anuncia arbitrajes que pierden tras
    // la fee de Kalshi/gas. El scanner multi-venue (market-scanner, con fees/gates) lo reemplaza. Reactivar solo
    // con LEGACY_ARB_TG_ENABLED=true (no recomendado). El resumen diario y los finales siguen publicándose.
    if (/^(1|true|yes|on)$/i.test(String(process.env.LEGACY_ARB_TG_ENABLED || '').trim())) {
      let best = null;
      for (const row of arbitrage()) for (const e of row.edges) {
        const strong = (e.type === 'valor' && e.edge >= 0.06) || (e.type === 'arbitraje' && e.edge >= 0.02);
        if (!strong) continue;
        const key = `opp:${day}:${row.id}:${e.type}:${e.venue}:${e.side}`;
        if (db.sentTg[key]) continue;
        if (!best || e.edge > best.e.edge) best = { row, e, key };
      }
      if (best) { const t = tgOppText(best.row, best.e); if (t && await telegram.post(t)) { db.sentTg[best.key] = Date.now(); save(); } }
    }
  } catch (e) { console.error('[telegram] tick:', e.message); }
}
// Alertas en tiempo real del scanner multi-venue: publica a Telegram las oportunidades EJECUTABLES/FUERTES ya
// descontadas fees y con gates (no falsos positivos). Framing honesto: arbitraje = surebet garantizado; precio
// atrasado = value 1-pata (+EV, no libre de riesgo), con nota de gubbing. Dedup por oportunidad+día.
async function tgScannerAlerts(day) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.MARKET_SCANNER_ALERTS_ENABLED || '').trim())) return;
  if (!telegram.configured()) return;
  const scan = await getMarketScan();
  if (!scan || scan.disabled || scan.unavailable) return;
  const dto = marketScannerDto.buildDto(scan, { resolveTeamId: (name) => resolveTeamIdLoose(name), maxItems: 40 });
  if (!dto.available) return;
  const nm = (id, fb) => { const tm = teamById[id]; return (tm && tm.name) || fb || id; };
  const selName = (it, oc) => it.market_family === 'match_total'
    ? (oc === 'over' ? `Más de ${it.line}` : `Menos de ${it.line}`)
    : (oc === 'draw' ? 'Empate' : oc === 'home' ? nm(it.home_team_id, it.home) : nm(it.away_team_id, it.away));
  const match = (it) => `${nm(it.home_team_id, it.home)} vs ${nm(it.away_team_id, it.away)}`;
  // 1) surebets ejecutables (arbitraje puro) — máx 1 por tick, el de mayor ROI neto
  const arb = (dto.arbitrage || []).filter(a => a.executable).sort((a, b) => b.net_roi - a.net_roi)[0];
  if (arb) {
    const key = `scan:arb:${day}:${arb.event_id}:${arb.legs.map(l => l.outcome + l.venue).join('_')}`;
    if (!db.sentTg[key]) {
      const legs = arb.legs.map(l => `• ${selName(arb, l.outcome)} @${Number(l.odds).toFixed(2)} (${l.venue_label || l.venue}) — poné ${Math.round(l.stake_pct)}%`).join('\n');
      const t = `🔒 <b>Arbitraje puro (surebet)</b>\n${match(arb)}\n${legs}\n\n<b>ROI garantizado: +${(arb.net_roi * 100).toFixed(2)}%</b> pase lo que pase.\nRequiere cuenta en cada casa y actuar rápido; verificá cuotas y reglas. No es consejo financiero.`;
      if (await telegram.post(t)) { db.sentTg[key] = Date.now(); save(); }
    }
  }
  // 2) precio atrasado fuerte (soft, edge alto, prob significativa) — máx 1 por tick, el de mayor edge
  const lag = (dto.price_lag || []).filter(l => l.is_soft && l.edge >= 0.05 && l.fair_prob >= 0.15).sort((a, b) => b.edge - a.edge)[0];
  if (lag) {
    const key = `scan:lag:${day}:${lag.event_id}:${lag.outcome}:${lag.venue}`;
    if (!db.sentTg[key]) {
      const against = !lag.is_favorite ? `\n⚠️ Va contra el favorito: en una sola apuesta lo más probable es perder. Ideal en exchange/PM para vender al reajustar; en casa soft es +EV a largo plazo (apostá poco).` : '';
      const t = `📈 <b>Precio atrasado (value)</b>\n${match(lag)}\n${selName(lag, lag.outcome)} @${Number(lag.odds).toFixed(2)} en ${lag.venue_label || lag.venue}\nConsenso sin margen: ${Number(lag.fair_odds).toFixed(2)} · <b>+${(lag.edge * 100).toFixed(1)}% de valor</b>${against}\n\nValue de mercado (+EV), no arbitraje libre de riesgo. No es consejo financiero.`;
      if (await telegram.post(t)) { db.sentTg[key] = Date.now(); save(); }
    }
  }
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
    // hora REAL de ESPN por par de equipos: los slots R16+ no traen datetime → sin esto todos salían 18:00Z
    const realDt = espnKickoffFor(h, a, k.date);
    return { ...k, ...(realDt ? { datetime: realDt } : {}), result: r, resolved, probs, gpProbs: gpLiveCheap(h, a, r) };
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
  return { id: String(id), kind: 'ko', m: k.m, home, away, datetime: espnKickoffFor(home, away, k.date) || k.datetime || (k.date + 'T18:00Z'), group: null, espnId: (koOverride[k.m] && koOverride[k.m].espnId) || null, stage: k.stage };
}

// ===== SEO helpers: pronósticos públicos server-rendered =====
const SEO_STAGE = { group: { es: 'Fase de grupos', en: 'Group stage' }, R32: { es: '16avos de final', en: 'Round of 32' }, R16: { es: 'Octavos de final', en: 'Round of 16' }, QF: { es: 'Cuartos de final', en: 'Quarter-final' }, SF: { es: 'Semifinal', en: 'Semi-final' }, '3RD': { es: 'Partido por el 3er puesto', en: 'Third-place match' }, FINAL: { es: 'Final', en: 'Final' } };
function seoSlug(name) { return String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
let _seoCache = { ts: 0, list: null };
function seoMatches() {
  if (_seoCache.list && Date.now() - _seoCache.ts < 60000) return _seoCache.list;
  const dic = require('./i18n/dictionary');
  const bracket = resolveRealBracket();
  const out = [];
  const push = (id, h, a, dt, stage, r) => {
    if (!h || !a || !teamById[h] || !teamById[a]) return;
    out.push({
      id, home: h, away: a, datetime: dt, stage, result: r,
      name: { es: dic.teamName(h, 'es') + ' vs ' + dic.teamName(a, 'es'), en: dic.teamName(h, 'en') + ' vs ' + dic.teamName(a, 'en') },
      slug: { es: seoSlug(dic.teamName(h, 'es')) + '-vs-' + seoSlug(dic.teamName(a, 'es')), en: seoSlug(dic.teamName(h, 'en')) + '-vs-' + seoSlug(dic.teamName(a, 'en')) },
    });
  };
  for (const f of GROUP_FIXTURES) push(f.id, f.home, f.away, f.datetime, 'group', db.results[f.id] || null);
  for (const k of KNOCKOUT) {
    const r = db.results[String(k.m)] || null;
    const res = bracket[k.m] || {};
    const h = (r && r.home) || res.home, a = (r && r.away) || res.away;
    push(String(k.m), h, a, espnKickoffFor(h, a, k.date) || k.datetime || (k.date + 'T18:00Z'), k.stage, r);
  }
  _seoCache = { ts: Date.now(), list: out };
  return out;
}
function seoShellCss() {
  return `*{margin:0;padding:0;box-sizing:border-box}body{background:#06090B;color:#EAF1F2;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.6}
.wrap{max-width:720px;margin:0 auto;padding:0 20px 70px}.nav{display:flex;align-items:center;gap:10px;padding:20px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.logo{display:flex;align-items:center;gap:9px;font-weight:800;font-size:16px;color:#EAF1F2;text-decoration:none}.logo i{width:30px;height:30px;border-radius:9px;background:rgba(31,227,164,.14);border:1px solid rgba(31,227,164,.45);display:grid;place-items:center;font-style:normal;color:#1FE3A4;font-size:14px}
.crumb{font-size:12.5px;color:#5F747B;margin:18px 0 6px}.crumb a{color:#5F747B}
h1{font-size:clamp(26px,5.2vw,36px);font-weight:800;letter-spacing:-.02em;line-height:1.15;margin:4px 0 6px}
.meta{color:#9DB0B5;font-size:14px;margin-bottom:26px}
.card{background:linear-gradient(165deg,#111A1E,#0D1417);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:22px 22px;margin:14px 0}
.plabel{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#5F747B;margin-bottom:12px}
.prow{display:flex;align-items:center;gap:12px;margin:9px 0}.prow .nm{width:132px;font-weight:700;font-size:14.5px}.prow .pct{width:56px;text-align:right;font-weight:800;font-variant-numeric:tabular-nums}
.bar{flex:1;height:12px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}.bar i{display:block;height:100%;border-radius:99px}
.b1 i{background:#1FE3A4}.b2 i{background:rgba(255,255,255,.35)}.b3 i{background:#5BA8FF}
p.read{color:#B9C7CB;font-size:15.5px;margin:14px 0}
.score{font-size:44px;font-weight:800;letter-spacing:2px;text-align:center;margin:10px 0}
.cta{display:block;background:#1FE3A4;color:#06231A;font-weight:800;text-align:center;text-decoration:none;border-radius:12px;padding:15px;margin:22px 0 8px;font-size:15.5px}
.ctasub{text-align:center;color:#5F747B;font-size:12.5px}
.idx{list-style:none}.idx li{border-bottom:1px solid rgba(255,255,255,.07)}.idx a{display:flex;justify-content:space-between;gap:10px;color:#EAF1F2;text-decoration:none;padding:13px 2px;font-weight:600;font-size:15px}.idx a:hover{color:#1FE3A4}.idx .when{color:#5F747B;font-size:12.5px;font-weight:600;white-space:nowrap}
.foot{margin-top:40px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);color:#5F747B;font-size:12px;line-height:1.7}.foot a{color:#5F747B}`;
}
function seoFmtDt(iso, lang) {
  try { return new Date(iso).toLocaleString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'; } catch { return ''; }
}
function seoMatchHtml(m, lang) {
  const dic = require('./i18n/dictionary');
  const hN = dic.teamName(m.home, lang), aN = dic.teamName(m.away, lang);
  const flags = (id) => (teamById[id] && teamById[id].flag) || '';
  const stage = (SEO_STAGE[m.stage] || SEO_STAGE.group)[lang];
  const base = 'https://gpsimulador.com';
  const urlEs = base + '/pronostico/' + m.slug.es, urlEn = base + '/prediction/' + m.slug.en;
  const url = lang === 'es' ? urlEs : urlEn;
  const done = m.result && m.result.status === 'final';
  const live = m.result && m.result.status === 'live';
  const title = lang === 'es'
    ? `Pronóstico ${hN} vs ${aN} — Mundial 2026 (${stage})`
    : `${hN} vs ${aN} Prediction — 2026 World Cup (${stage})`;
  let probs = null, body = '';
  if (!done) probs = live ? liveMatchProbs(effElo(db.elos, m.home), effElo(db.elos, m.away), m.result.hg, m.result.ag, m.result.minute) : matchProbs(effElo(db.elos, m.home), effElo(db.elos, m.away));
  const pct = (x) => Math.round(x * 100) + '%';
  if (done) {
    const r = m.result;
    body = `<div class="card"><div class="plabel">${lang === 'es' ? 'Resultado final' : 'Final score'}</div><div class="score">${flags(m.home)} ${r.hg} – ${r.ag} ${flags(m.away)}</div></div>
<p class="read">${lang === 'es' ? `El partido terminó ${r.hg}–${r.ag}. Las jugadas del día, el historial completo del modelo y las cuotas mejor pagadas de los próximos partidos están dentro de la plataforma.` : `The match ended ${r.hg}–${r.ag}. Today's plays, the model's full public record and the best-paying odds for upcoming matches are inside the platform.`}</p>`;
  } else if (probs) {
    const xgT = (probs.xgHome || 0) + (probs.xgAway || 0);
    const fav = probs.home >= probs.away ? { n: hN, p: probs.home } : { n: aN, p: probs.away };
    const goalsRead = lang === 'es'
      ? (xgT >= 2.9 ? `Se proyecta un partido abierto, con ~${xgT.toFixed(1)} goles esperados en total.` : xgT >= 2.3 ? `Se proyecta un partido equilibrado en goles (~${xgT.toFixed(1)} esperados).` : `Se proyecta un partido cerrado, de pocos goles (~${xgT.toFixed(1)} esperados).`)
      : (xgT >= 2.9 ? `The projection points to an open match, with ~${xgT.toFixed(1)} expected goals in total.` : xgT >= 2.3 ? `The projection points to a balanced match on goals (~${xgT.toFixed(1)} expected).` : `The projection points to a tight, low-scoring match (~${xgT.toFixed(1)} expected).`);
    body = `<div class="card"><div class="plabel">${lang === 'es' ? 'Probabilidades del modelo' + (live ? ' · EN VIVO' : '') : 'Model probabilities' + (live ? ' · LIVE' : '')}</div>
<div class="prow b1"><span class="nm">${flags(m.home)} ${hN}</span><span class="bar"><i style="width:${pct(probs.home)}"></i></span><span class="pct">${pct(probs.home)}</span></div>
<div class="prow b2"><span class="nm">${lang === 'es' ? 'Empate' : 'Draw'}</span><span class="bar"><i style="width:${pct(probs.draw)}"></i></span><span class="pct">${pct(probs.draw)}</span></div>
<div class="prow b3"><span class="nm">${flags(m.away)} ${aN}</span><span class="bar"><i style="width:${pct(probs.away)}"></i></span><span class="pct">${pct(probs.away)}</span></div></div>
<p class="read">${lang === 'es' ? `El modelo le da a <b>${fav.n}</b> un <b>${pct(fav.p)}</b> de probabilidad de llevarse el partido en los 90 minutos; el empate corre con ${pct(probs.draw)}.` : `The model gives <b>${fav.n}</b> a <b>${pct(fav.p)}</b> chance of taking the match in 90 minutes; the draw sits at ${pct(probs.draw)}.`}</p>
<p class="read">${goalsRead}</p>
<p class="read">${lang === 'es' ? 'La jugada del día de este partido, el análisis completo y la mejor cuota entre más de 40 casas están dentro de la plataforma — gratis durante el Mundial.' : "Today's play for this match, the full analysis and the best odds across 40+ books are inside the platform — free during the World Cup."}</p>`;
  }
  const jsonld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'SportsEvent', name: m.name[lang] + ' — FIFA World Cup 2026', startDate: m.datetime, sport: 'Soccer', competitor: [{ '@type': 'SportsTeam', name: hN }, { '@type': 'SportsTeam', name: aN }] });
  const desc = done
    ? (lang === 'es' ? `Resultado final ${hN} ${m.result.hg}-${m.result.ag} ${aN} (${stage}, Mundial 2026).` : `Final score ${hN} ${m.result.hg}-${m.result.ag} ${aN} (${stage}, 2026 World Cup).`)
    : (lang === 'es' ? `Probabilidades ${hN} vs ${aN}: ${probs ? pct(probs.home) + ' / ' + pct(probs.draw) + ' / ' + pct(probs.away) : ''} · ${stage} del Mundial 2026. Pronóstico del modelo y mejores cuotas.` : `${hN} vs ${aN} probabilities: ${probs ? pct(probs.home) + ' / ' + pct(probs.draw) + ' / ' + pct(probs.away) : ''} · 2026 World Cup ${stage}. Model prediction and best odds.`);
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}">
<link rel="canonical" href="${url}"><link rel="alternate" hreflang="es" href="${urlEs}"><link rel="alternate" hreflang="en" href="${urlEn}"><link rel="alternate" hreflang="x-default" href="${urlEn}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:image" content="${base}/og.png">
<script type="application/ld+json">${jsonld}</script><style>${seoShellCss()}</style></head>
<body><div class="wrap"><nav class="nav"><a class="logo" href="/"><i>▟</i> GP Simulador</a></nav>
<div class="crumb"><a href="${lang === 'es' ? '/pronosticos' : '/predictions'}">${lang === 'es' ? 'Pronósticos del Mundial 2026' : '2026 World Cup predictions'}</a> · ${stage}</div>
<h1>${lang === 'es' ? 'Pronóstico' : 'Prediction:'} ${flags(m.home)} ${hN} vs ${aN} ${flags(m.away)}</h1>
<div class="meta">${stage} · ${seoFmtDt(m.datetime, lang)}</div>
${body}
<a class="cta" href="/">${lang === 'es' ? 'Ver la jugada del día → cuenta gratis' : "See today's play → free account"}</a>
<div class="ctasub">${lang === 'es' ? 'Sin tarjeta · solo tu email · historial público y verificado' : 'No card · just your email · public, verified record'}</div>
<div class="foot">${lang === 'es' ? 'Estimaciones de un modelo estadístico con fines informativos. No es consejo financiero. Apostá con responsabilidad. 18+.' : 'Statistical model estimates for informational purposes. Not financial advice. Bet responsibly. 18+.'}<br><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="${lang === 'es' ? '/predictions' : '/pronosticos'}">${lang === 'es' ? 'English version' : 'Versión en español'}</a></div>
</div></body></html>`;
}
function seoIndexHtml(lang) {
  const ms = seoMatches().slice().sort((a, b) => new Date(a.datetime || 0) - new Date(b.datetime || 0));
  const now = Date.now();
  const upcoming = ms.filter(m => !(m.result && m.result.status === 'final') && new Date(m.datetime).getTime() > now - 3 * 3600e3);
  const recent = ms.filter(m => m.result && m.result.status === 'final').slice(-10).reverse();
  const base = lang === 'es' ? '/pronostico/' : '/prediction/';
  const li = (m, done) => `<li><a href="${base}${m.slug[lang]}"><span>${(teamById[m.home] || {}).flag || ''} ${m.name[lang]} ${(teamById[m.away] || {}).flag || ''}</span><span class="when">${done && m.result ? m.result.hg + '–' + m.result.ag : seoFmtDt(m.datetime, lang)}</span></a></li>`;
  const title = lang === 'es' ? 'Pronósticos del Mundial 2026 — probabilidades de cada partido' : '2026 World Cup predictions — probabilities for every match';
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} | GP Simulador</title><meta name="description" content="${lang === 'es' ? 'Pronóstico y probabilidades de todos los partidos del Mundial 2026, actualizados en tiempo real por el modelo de GP Simulador.' : 'Predictions and probabilities for every 2026 World Cup match, updated in real time by the GP Simulador model.'}">
<link rel="canonical" href="https://gpsimulador.com${lang === 'es' ? '/pronosticos' : '/predictions'}"><link rel="alternate" hreflang="es" href="https://gpsimulador.com/pronosticos"><link rel="alternate" hreflang="en" href="https://gpsimulador.com/predictions"><link rel="alternate" hreflang="x-default" href="https://gpsimulador.com/predictions">
<style>${seoShellCss()}</style></head>
<body><div class="wrap"><nav class="nav"><a class="logo" href="/"><i>▟</i> GP Simulador</a></nav>
<h1>${lang === 'es' ? 'Pronósticos del Mundial 2026' : '2026 World Cup Predictions'}</h1>
<div class="meta">${lang === 'es' ? 'Probabilidades del modelo para cada partido, actualizadas en tiempo real.' : 'Model probabilities for every match, updated in real time.'}</div>
<div class="card"><div class="plabel">${lang === 'es' ? 'Próximos partidos' : 'Upcoming matches'}</div><ul class="idx">${upcoming.map(m => li(m, false)).join('')}</ul></div>
${recent.length ? `<div class="card"><div class="plabel">${lang === 'es' ? 'Resultados recientes' : 'Recent results'}</div><ul class="idx">${recent.map(m => li(m, true)).join('')}</ul></div>` : ''}
<a class="cta" href="/">${lang === 'es' ? 'Ver la jugada del día → cuenta gratis' : "See today's play → free account"}</a>
<div class="foot">${lang === 'es' ? 'Estimaciones de un modelo estadístico. No es consejo financiero. 18+.' : 'Statistical model estimates. Not financial advice. 18+.'}<br><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></div>
</div></body></html>`;
}

// ===== SEO por JUGADOR (/jugador/<slug> ES · /player/<slug> EN) =============================================
// La "card de jugador" pública: radar (percentil vs su posición), arquetipo, scout read y stats del torneo,
// server-rendered e indexable. Long-tail ("<jugador> mundial 2026 estadísticas") + cada card es compartible.
// Caja negra: solo lecturas y percentiles, nunca método. Los mercados/cuotas viven DENTRO de la plataforma (CTA).
const SEO_ARCH = {
  STAR: { es: 'Estrella', en: 'Star' }, CLINICAL: { es: 'Finalizador', en: 'Clinical finisher' },
  CREATOR: { es: 'Creador', en: 'Creator' }, AERIAL: { es: 'Amenaza aérea', en: 'Aerial threat' },
  SUPER_SUB: { es: 'Revulsivo', en: 'Super sub' }, ENGINE: { es: 'Motor', en: 'Engine' },
  SET_PIECE: { es: 'Balón parado', en: 'Set piece specialist' },
};
const SEO_AXIS = {
  production: { es: 'Peligro', en: 'Threat' }, volume: { es: 'Remates', en: 'Shots' },
  accuracy: { es: 'Puntería', en: 'Accuracy' }, creation: { es: 'Creación', en: 'Creation' },
  finishing: { es: 'Definición', en: 'Finishing' }, presence: { es: 'Presencia', en: 'Presence' },
  aerial: { es: 'Aéreo', en: 'Aerial' }, attack_share: { es: 'Peso ofensivo', en: 'Attack share' },
};
let _seoPlayersCache = { ts: 0, bySlug: null };
function seoPlayers() {
  if (_seoPlayersCache.bySlug && Date.now() - _seoPlayersCache.ts < 10 * 60e3) return _seoPlayersCache.bySlug;
  const PF = obsFit();
  if (!PF) return {};
  const bySlug = {};
  for (const pl of Object.values(PF.players)) {
    if (!pl.reliable || pl.minutes < 180) continue;
    const slug = seoSlug(pl.name);
    if (!slug) continue;
    if (!bySlug[slug] || bySlug[slug].minutes < pl.minutes) bySlug[slug] = pl; // colisión de nombre: gana el de más minutos
  }
  _seoPlayersCache = { ts: Date.now(), bySlug };
  return bySlug;
}
function seoPlayerHtml(pl, lang) {
  const dic = require('./i18n/dictionary');
  const scoutMod = require('./player-intel/scout');
  const spMod = require('./player-intel/setPieces');
  const { radarSvg } = require('./player-intel/radar');
  const PF = obsFit();
  const scout = scoutMod.buildScout(PF, pl.pid, { aerial: playerAerial(pl.name), setPieceRoles: spMod.rolesFor(pl.team, pl.name) });
  const teamN = dic.teamName(pl.team, lang);
  const flag = (teamById[pl.team] && teamById[pl.team].flag) || '';
  const base = 'https://gpsimulador.com';
  const slug = seoSlug(pl.name);
  const urlEs = base + '/jugador/' + slug, urlEn = base + '/player/' + slug;
  const url = lang === 'es' ? urlEs : urlEn;
  const POS = { F: { es: 'Delantero', en: 'Forward' }, M: { es: 'Mediocampista', en: 'Midfielder' }, D: { es: 'Defensor', en: 'Defender' }, G: { es: 'Arquero', en: 'Goalkeeper' } };
  const posN = (POS[pl.pos] || POS.M)[lang];
  const title = lang === 'es'
    ? `${pl.name} — Estadísticas y proyección en el Mundial 2026 (${teamN})`
    : `${pl.name} — 2026 World Cup stats and projection (${teamN})`;
  const arch = scout && scout.archetype ? SEO_ARCH[scout.archetype] : null;
  const labels = Object.fromEntries(Object.entries(SEO_AXIS).map(([k, v]) => [k, v[lang]]));
  const radar = scout ? radarSvg(scout.axes, labels, { stroke: '#2be3a6', fill: 'rgba(43,227,166,.2)', grid: 'rgba(255,255,255,.13)', label: '#9fbcae', size: 320 }) : '';
  const reads = scout && scout.read ? scout.read : { strengths: [], limit: null };
  const li = s => `<li>${s[lang]}</li>`;
  const ph = db.playerPhotos && db.playerPhotos[pl.pid] && db.playerPhotos[pl.pid].photo;
  const g90 = pl.minutes > 0 ? ((pl.goals / pl.minutes) * 90).toFixed(2) : '0.00';
  const desc = lang === 'es'
    ? `${pl.name} (${teamN}, ${posN}) en el Mundial 2026: ${pl.goals} goles y ${pl.assists || 0} asistencias en ${pl.apps} partidos. Radar vs su posición, lectura de scouting y proyección del sistema.`
    : `${pl.name} (${teamN}, ${posN}) at the 2026 World Cup: ${pl.goals} goals and ${pl.assists || 0} assists in ${pl.apps} matches. Radar vs his position, scouting read and system projection.`;
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Person', name: pl.name,
    jobTitle: lang === 'es' ? 'Futbolista' : 'Football player',
    memberOf: { '@type': 'SportsTeam', name: teamN }, url,
  });
  const statCell = (n, k) => `<div class="st"><div class="n">${n}</div><div class="k">${k}</div></div>`;
  const stats = lang === 'es'
    ? statCell(pl.goals, 'goles') + statCell(pl.assists || 0, 'asistencias') + statCell(pl.apps, 'partidos') + statCell(pl.minutes, 'minutos') + statCell(g90, 'goles por 90')
    : statCell(pl.goals, 'goals') + statCell(pl.assists || 0, 'assists') + statCell(pl.apps, 'matches') + statCell(pl.minutes, 'minutes') + statCell(g90, 'goals per 90');
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}">
<link rel="canonical" href="${url}"><link rel="alternate" hreflang="es" href="${urlEs}"><link rel="alternate" hreflang="en" href="${urlEn}"><link rel="alternate" hreflang="x-default" href="${urlEn}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:image" content="${ph || base + '/og.png'}">
<script type="application/ld+json">${jsonld}</script><style>${seoShellCss()}
.php{display:flex;align-items:center;gap:18px;margin:6px 0 4px}
.php img{width:84px;height:84px;border-radius:18px;object-fit:cover;border:1px solid rgba(255,255,255,.14);background:#0a140f}
.badge{display:inline-block;background:rgba(43,227,166,.14);border:1px solid rgba(43,227,166,.4);color:#2be3a6;font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:5px 12px;border-radius:99px;margin-top:8px}
.radarw{display:flex;justify-content:center;padding:8px 0 2px}
.radarw svg{width:min(340px,88vw);height:auto}
.sr{margin:10px 0 0;padding-left:20px}
.sr li{margin:7px 0;color:#cfe6da;font-size:14.5px}
.sr.lim li{color:#c9b27f}
.sth{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:14px}
.st{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px 8px;text-align:center}
.st .n{font-size:22px;font-weight:800}.st .k{font-size:11px;color:#9fbcae;margin-top:2px}
@media(max-width:520px){.sth{grid-template-columns:repeat(3,1fr)}}
</style></head>
<body><div class="wrap"><nav class="nav"><a class="logo" href="/"><i>▟</i> GP Simulador</a></nav>
<div class="crumb"><a href="${lang === 'es' ? '/pronosticos' : '/predictions'}">${lang === 'es' ? 'Mundial 2026' : '2026 World Cup'}</a> · ${flag} ${teamN}</div>
<div class="php">${ph ? `<img src="${ph}" alt="${pl.name}" loading="lazy">` : ''}<div><h1 style="margin:0">${pl.name}</h1>
<div class="meta">${posN} · ${flag} ${teamN}</div>${arch ? `<span class="badge">★ ${arch[lang]}</span>` : ''}</div></div>
<div class="card"><div class="plabel">${lang === 'es' ? 'Radar vs jugadores de su posición · Mundial 2026' : 'Radar vs players in his position · 2026 World Cup'}</div>
<div class="radarw">${radar}</div></div>
${reads.strengths.length ? `<div class="card"><div class="plabel">${lang === 'es' ? 'Lectura de scouting' : 'Scouting read'}</div><ul class="sr">${reads.strengths.map(li).join('')}</ul>${reads.limit ? `<ul class="sr lim">${li(reads.limit)}</ul>` : ''}</div>` : ''}
<div class="card"><div class="plabel">${lang === 'es' ? 'Números del torneo' : 'Tournament numbers'}</div><div class="sth">${stats}</div></div>
<p class="read">${lang === 'es'
    ? `La proyección de gol de ${pl.name} para el próximo partido, sus mercados con la mejor cuota entre más de 40 casas y la lectura del sistema están dentro de la plataforma, gratis durante el Mundial.`
    : `${pl.name}'s goal projection for the next match, his markets with the best odds across 40+ books and the system read live inside the platform, free during the World Cup.`}</p>
<a class="cta" href="/">${lang === 'es' ? 'Ver su proyección y mercados → cuenta gratis' : 'See his projection and markets → free account'}</a>
<div class="ctasub">${lang === 'es' ? 'Sin tarjeta · solo tu email · historial público y verificado' : 'No card · just your email · public, verified record'}</div>
<div class="foot">${lang === 'es' ? 'Estimaciones estadísticas con fines informativos. No es consejo financiero. 18+.' : 'Statistical estimates for informational purposes. Not financial advice. 18+.'}<br><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="${lang === 'es' ? urlEn : urlEs}">${lang === 'es' ? 'English version' : 'Versión en español'}</a></div>
</div></body></html>`;
}

// ===== GAP-AUDIT 2: SEO por JUGADOR de CLUB (/jugador/<slug> ES · /player/<slug> EN) ==========================
// Paridad con seoPlayers/seoPlayerHtml del Mundial, pero multi-liga (clubsFit) y con el framing de la liga.
// El route resuelve primero el Mundial y cae a clubes; el sitemap suma ambos. Caja negra igual (solo lecturas).
let _seoClubPlayersCache = { ts: 0, bySlug: null };
function seoClubPlayers() {
  if (_seoClubPlayersCache.bySlug && Date.now() - _seoClubPlayersCache.ts < 10 * 60e3) return _seoClubPlayersCache.bySlug;
  const cf = require('./player-intel/clubsFit');
  let RT = global._clubsRatings;
  if (!RT || !RT.leagues) { try { RT = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); global._clubsRatings = RT; } catch { RT = { leagues: {} }; } }
  const bySlug = {};
  for (const league of Object.keys(RT.leagues || {})) {
    let fit = null; try { fit = cf.leagueFit(league); } catch { fit = null; }
    if (!fit) continue;
    const L = RT.leagues[league] || {};
    const leagueName = (L.name || league).split(' · ')[0];
    for (const pl of Object.values(fit.players)) {
      if (!pl.reliable || pl.minutes < 180) continue;
      const slug = seoSlug(pl.name); if (!slug) continue;
      const cur = bySlug[slug];
      if (!cur || cur.minutes < pl.minutes) {
        const teamName = (L.ratings && L.ratings[pl.team] && L.ratings[pl.team].name) || pl.team;
        bySlug[slug] = { pid: pl.pid, name: pl.name, team: pl.team, league, leagueName, teamName, minutes: pl.minutes, pos: pl.pos };
      }
    }
  }
  _seoClubPlayersCache = { ts: Date.now(), bySlug };
  return bySlug;
}
function seoClubPlayerHtml(e, lang) {
  const cf = require('./player-intel/clubsFit');
  const { radarSvg } = require('./player-intel/radar');
  const intel = cf.clubPlayerScout(e.league, e.pid);
  if (!intel) return null;
  const scout = intel.scout;
  const base = 'https://gpsimulador.com';
  const slug = seoSlug(e.name);
  const urlEs = base + '/jugador/' + slug, urlEn = base + '/player/' + slug;
  const url = lang === 'es' ? urlEs : urlEn;
  const POS = { F: { es: 'Delantero', en: 'Forward' }, M: { es: 'Mediocampista', en: 'Midfielder' }, D: { es: 'Defensor', en: 'Defender' }, G: { es: 'Arquero', en: 'Goalkeeper' } };
  const posN = (POS[e.pos] || POS.M)[lang];
  const title = lang === 'es'
    ? `${e.name} — Estadísticas y proyección (${e.teamName}, ${e.leagueName})`
    : `${e.name} — Stats and projection (${e.teamName}, ${e.leagueName})`;
  const arch = scout && scout.archetype ? SEO_ARCH[scout.archetype] : null;
  const labels = Object.fromEntries(Object.entries(SEO_AXIS).map(([k, v]) => [k, v[lang]]));
  const radar = scout ? radarSvg(scout.axes, labels, { stroke: '#2be3a6', fill: 'rgba(43,227,166,.2)', grid: 'rgba(255,255,255,.13)', label: '#9fbcae', size: 320 }) : '';
  const reads = scout && scout.read ? scout.read : { strengths: [], limit: null };
  const li = s => `<li>${s[lang]}</li>`;
  const ph = global._clubPlayerPhotos && global._clubPlayerPhotos[e.pid] && global._clubPlayerPhotos[e.pid].photo;
  const goals = intel.goals || 0, assists = intel.assists || 0, apps = intel.apps || 0, minutes = intel.minutes || 0;
  const g90 = minutes > 0 ? ((goals / minutes) * 90).toFixed(2) : '0.00';
  const desc = lang === 'es'
    ? `${e.name} (${e.teamName}, ${posN}) en ${e.leagueName}: ${goals} goles y ${assists} asistencias en ${apps} partidos. Radar vs su posición, lectura de scouting y proyección del sistema.`
    : `${e.name} (${e.teamName}, ${posN}) in ${e.leagueName}: ${goals} goals and ${assists} assists in ${apps} matches. Radar vs his position, scouting read and system projection.`;
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'Person', name: e.name,
    jobTitle: lang === 'es' ? 'Futbolista' : 'Football player',
    memberOf: { '@type': 'SportsTeam', name: e.teamName }, url,
  });
  const statCell = (n, k) => `<div class="st"><div class="n">${n}</div><div class="k">${k}</div></div>`;
  const stats = lang === 'es'
    ? statCell(goals, 'goles') + statCell(assists, 'asistencias') + statCell(apps, 'partidos') + statCell(minutes, 'minutos') + statCell(g90, 'goles por 90')
    : statCell(goals, 'goals') + statCell(assists, 'assists') + statCell(apps, 'matches') + statCell(minutes, 'minutes') + statCell(g90, 'goals per 90');
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title><meta name="description" content="${desc}">
<link rel="canonical" href="${url}"><link rel="alternate" hreflang="es" href="${urlEs}"><link rel="alternate" hreflang="en" href="${urlEn}"><link rel="alternate" hreflang="x-default" href="${urlEn}">
<meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:image" content="${ph || base + '/og.png'}">
<script type="application/ld+json">${jsonld}</script><style>${seoShellCss()}
.php{display:flex;align-items:center;gap:18px;margin:6px 0 4px}
.php img{width:84px;height:84px;border-radius:18px;object-fit:cover;border:1px solid rgba(255,255,255,.14);background:#0a140f}
.badge{display:inline-block;background:rgba(43,227,166,.14);border:1px solid rgba(43,227,166,.4);color:#2be3a6;font-size:11.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:5px 12px;border-radius:99px;margin-top:8px}
.radarw{display:flex;justify-content:center;padding:8px 0 2px}
.radarw svg{width:min(340px,88vw);height:auto}
.sr{margin:10px 0 0;padding-left:20px}
.sr li{margin:7px 0;color:#cfe6da;font-size:14.5px}
.sr.lim li{color:#c9b27f}
.sth{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-top:14px}
.st{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:12px 8px;text-align:center}
.st .n{font-size:22px;font-weight:800}.st .k{font-size:11px;color:#9fbcae;margin-top:2px}
@media(max-width:520px){.sth{grid-template-columns:repeat(3,1fr)}}
</style></head>
<body><div class="wrap"><nav class="nav"><a class="logo" href="/"><i>▟</i> GP Simulador</a></nav>
<div class="crumb">${e.leagueName} · ${e.teamName}</div>
<div class="php">${ph ? `<img src="${ph}" alt="${e.name}" loading="lazy">` : ''}<div><h1 style="margin:0">${e.name}</h1>
<div class="meta">${posN} · ${e.teamName}</div>${arch ? `<span class="badge">★ ${arch[lang]}</span>` : ''}</div></div>
<div class="card"><div class="plabel">${lang === 'es' ? 'Radar vs jugadores de su posición · ' + e.leagueName : 'Radar vs players in his position · ' + e.leagueName}</div>
<div class="radarw">${radar}</div></div>
${reads.strengths.length ? `<div class="card"><div class="plabel">${lang === 'es' ? 'Lectura de scouting' : 'Scouting read'}</div><ul class="sr">${reads.strengths.map(li).join('')}</ul>${reads.limit ? `<ul class="sr lim">${li(reads.limit)}</ul>` : ''}</div>` : ''}
<div class="card"><div class="plabel">${lang === 'es' ? 'Números de la temporada' : 'Season numbers'}</div><div class="sth">${stats}</div></div>
<p class="read">${lang === 'es'
    ? `La proyección de gol de ${e.name} para el próximo partido, sus mercados con la mejor cuota entre más de 40 casas y la lectura del sistema están dentro de la plataforma.`
    : `${e.name}'s goal projection for the next match, his markets with the best odds across 40+ books and the system read live inside the platform.`}</p>
<a class="cta" href="/">${lang === 'es' ? 'Ver su proyección y mercados → cuenta gratis' : 'See his projection and markets → free account'}</a>
<div class="ctasub">${lang === 'es' ? 'Sin tarjeta · solo tu email · historial público y verificado' : 'No card · just your email · public, verified record'}</div>
<div class="foot">${lang === 'es' ? 'Estimaciones estadísticas con fines informativos. No es consejo financiero. 18+.' : 'Statistical estimates for informational purposes. Not financial advice. 18+.'}<br><a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="${lang === 'es' ? urlEn : urlEs}">${lang === 'es' ? 'English version' : 'Versión en español'}</a></div>
</div></body></html>`;
}

function modelProbsFor(home, away, result) {
  if (!home || !away) return null;
  if (result && result.status === 'live') {
    const ft = (result.minute > 90 || result.decided === 'et') ? 120 : 90; // prórroga en eliminatorias
    return liveMatchProbs(effElo(db.elos, home), effElo(db.elos, away), result.hg, result.ag, result.minute, { fullTime: ft });
  }
  return matchProbs(effElo(db.elos, home), effElo(db.elos, away));
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
  const ft = (result.minute > 90 || result.decided === 'et') ? 120 : 90;
  const p = liveProbsFromLambdas(xg.xgA, xg.xgB, result.hg, result.ag, result.minute, { mulH, mulA, fullTime: ft });
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
      const resolveTeamId = (name) => resolveTeamIdLoose(name);
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
    // eliminatoria: desenlace real (prórroga/penales) + ganador, para mostrarlo más allá de los 90'
    penalties: (result && result.hpen != null && result.apen != null) ? { home: result.hpen, away: result.apen } : null,
    decided: result ? (result.decided || (result.status === 'final' ? 'reg' : null)) : null,
    winnerId: (result && result.status === 'final' && meta.kind === 'ko') ? matchWinner(result, meta.home, meta.away) : null,
    modelProbabilities: probs ? {
      homeWin: probs.home, draw: probs.draw, awayWin: probs.away,
      xgHome: probs.xgHome, xgAway: probs.xgAway, likelyScore: probs.likelyScore, live: !!probs.live,
      liveContext,                       // {home_reds,away_reds,...} si un evento en vivo ajustó la prob
    } : undefined,
    v2,                                  // DTO GP Intelligence V2 | null (Q.1.1 §2, solo con flag+beta)
    gpLive: gpLive ? { homeWin: gpLive.home, draw: gpLive.draw, awayWin: gpLive.away, xgHome: gpLive.xgHome, xgAway: gpLive.xgAway, likelyScore: gpLive.likelyScore, reds: gpLive.reds } : null, // GP en vivo (cockpit /x)
    momentum: (db.momentum[String(meta.id)] && db.momentum[String(meta.id)].points && db.momentum[String(meta.id)].points.length > 2) ? db.momentum[String(meta.id)].points : null, // serie GP en vivo (gráfico de evolución)
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

// ===== GOLES (G2): persiste el goal_model_snapshot del evento (SHADOW). Reusa las lambdas que buildH2HDeep YA
// calculó — base (sin contexto, deep.base.xgA/xgB) vs final (con contexto, deep.probs.xgA/xgB) — y deriva la
// matriz de marcadores + mercados de primera capa (O/U, BTTS, team totals, scorelines). Idempotente por
// input_hash (event+modelo+lambdas finales). Best-effort: nunca rompe el loop de contexto. Sin Monte Carlo ni
// llamadas API extra. Solo lo lee mvGoals en /x (detrás de GP_GOAL_INSIGHTS_UI_ENABLED). NO toca el modelo oficial.
async function persistGoalSnapshot(ev, deep, completeness) {
  try {
    const goalDist = require('./goal-engine/distribution');
    const grepo = require('./goal-engine/repository');
    const baseLh = Number(deep.base && deep.base.xgA), baseLa = Number(deep.base && deep.base.xgB);
    const lh = Number(deep.probs && deep.probs.xgA), la = Number(deep.probs && deep.probs.xgB);
    if (!(lh > 0) || !(la > 0)) return null;
    const MV = 'goal-engine-live-1.0.0';
    const out = goalDist.goalModelOutput(lh, la, { modelVersion: MV });
    const matrixHash = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify({ lh: +lh.toFixed(6), la: +la.toFixed(6), mv: MV })).digest('hex');
    return await grepo.recordGoalSnapshot({
      canonical_event_id: ev.id, model_version: MV, period_code: 'REGULATION',
      base_lambda_home: isFinite(baseLh) ? baseLh : null, base_lambda_away: isFinite(baseLa) ? baseLa : null,
      context_lambda_home: lh, context_lambda_away: la, final_lambda_home: lh, final_lambda_away: la,
      expected_total_goals: out.expected_total_goals, scoreline_matrix_hash: matrixHash,
      total_goals_distribution: out.total_goals_distribution, over_under: out.over_under, btts: out.btts,
      team_totals: out.team_totals, top_scorelines: out.top_scorelines, uncertainty: out.uncertainty,
      data_completeness: completeness != null ? completeness : null,
      // factor_lineage lleva los team-ids + kickoff para que la capa de Picks pueda reconstruir el evento sin
      // depender de canonical_events (los ids de goles pueden ser sintéticos, desacoplados del grafo canónico).
      factor_lineage: [{ source: 'h2h-deep', goal_model: (deep.context && deep.context.goalModel) || null, home_team_id: ev.homeId || null, away_team_id: ev.awayId || null, kickoff_at: ev.kickoff || null }], cutoff_at: null,
    });
  } catch (e) { return null; }
}

// ===== GOLES (G3): Value de goles SHADOW. Compara la prob GP del Goal Engine contra el consenso NO-VIG del
// mercado real (sportsbook_goal_quote_current, ingerido por jobTotals) para cada línea de totales con ambos lados
// y casas suficientes. Política propia (goal-value-policy-shadow-1), NO reutiliza thresholds 1X2. SHADOW puro:
// registry/pick/public = false; NO genera Picks ni Value público (eso es G5, tras calibración por familia). Solo
// lo ve el admin. Idempotente. Best-effort. NO toca el modelo oficial.
async function persistGoalValue(ev, lh, la, goalSnapshotId) {
  try {
    const dbc = require('./database/client');
    const grepo = require('./goal-engine/repository');
    const noVig = require('./goal-engine/noVig');
    const goalValue = require('./goal-engine/goalValue');
    const rows = (await dbc.query(
      `SELECT sportsbook_code, line, side, odds_decimal, quote_status, is_live
         FROM sportsbook_goal_quote_current
        WHERE canonical_event_id=$1 AND market_family='match_total' AND COALESCE(quote_status,'open')='open' AND COALESCE(is_live,false)=false`, [ev.id])).rows;
    if (!rows.length) return 0;
    const byLine = {};
    for (const r of rows) { const k = String(Number(r.line)); (byLine[k] = byLine[k] || []).push(r); }
    let persisted = 0;
    for (const [lineStr, lrows] of Object.entries(byLine)) {
      const line = Number(lineStr);
      const lineTag = String(line).replace('.', '_');
      const quotes = lrows.map(r => ({ sportsbook_code: r.sportsbook_code, independence_group: r.sportsbook_code, side: String(r.side).toLowerCase(), odds_decimal: Number(r.odds_decimal), quote_status: r.quote_status || 'open', is_live: !!r.is_live }));
      const consOver = noVig.consensus(quotes, 'over', 'under', { minGroups: 3 });
      if (!consOver.ok) continue;
      const bestOver = Math.max(0, ...lrows.filter(r => String(r.side).toLowerCase() === 'over').map(r => Number(r.odds_decimal)));
      const bestUnder = Math.max(0, ...lrows.filter(r => String(r.side).toLowerCase() === 'under').map(r => Number(r.odds_decimal)));
      for (const [mid, consProb, best] of [[`TOTAL_GOALS_OVER_${lineTag}`, consOver.probability, bestOver], [`TOTAL_GOALS_UNDER_${lineTag}`, 1 - consOver.probability, bestUnder]]) {
        if (!(best > 1)) continue;
        const e = goalValue.evaluate({ lambdaHome: lh, lambdaAway: la, marketId: mid, marketFamily: 'match_total', consensusProb: consProb, bestOdds: best, groups: consOver.groups });
        if (!e.ok) continue;
        await grepo.recordGoalValue({
          goal_snapshot_id: goalSnapshotId || null, canonical_event_id: ev.id, market_id: mid, market_family: 'match_total',
          period_code: 'REGULATION', gp_probability: e.gp_probability, market_consensus_probability: e.market_consensus_probability,
          best_decimal_odds: best, break_even_probability: e.break_even_probability, raw_edge_pp: e.raw_edge_pp,
          conservative_probability: e.conservative_probability, adjusted_edge_pp: e.adjusted_edge_pp, adjusted_ev: e.adjusted_ev,
          line_probability_sensitivity: e.line_probability_sensitivity, classification: e.classification,
          goal_value_policy_version: e.policy_version, cutoff_at: null,
        }).catch(() => {});
        persisted++;
      }
    }
    return persisted;
  } catch (e) { return 0; }
}

// Persiste el VALUE de GANADOR (1X2) de un partido próximo, reusando goal_value_shadow (market_family='match_winner')
// — sin migración. Ingiere las cuotas h2h del proveedor a sportsbook_goal_quote_current (para books count + CLV),
// calcula el consenso no-vig 3-way del mercado, y guarda model (deep.probs) vs mercado por resultado. Habilita las
// picks SÓLIDAS en partidos NO canónicos (la mayoría de próximos usan id sintético). Idempotente por input_hash.
async function persistMatchWinnerValue(ev, deep, theOddsEvent, goalSnapshotId) {
  try {
    if (!theOddsEvent || !deep || !deep.probs) return 0;
    const grepo = require('./goal-engine/repository');
    const homeName = normName(theOddsEvent.home_team), awayName = normName(theOddsEvent.away_team);
    const byBook = {};
    for (const bk of theOddsEvent.bookmakers || []) {
      for (const m of bk.markets || []) {
        if (m.key !== 'h2h') continue;
        const o = {};
        for (const oc of m.outcomes || []) {
          const n = normName(oc.name);
          if (n === homeName) o.home = Number(oc.price);
          else if (n === awayName) o.away = Number(oc.price);
          else o.draw = Number(oc.price); // 'Draw'
        }
        if (o.home > 1 && o.draw > 1 && o.away > 1) byBook[bk.key] = { ...o, last_update: bk.last_update };
      }
    }
    const books = Object.keys(byBook);
    if (books.length < 3) return 0; // consenso requiere ≥3 casas
    // Ingiere las cuotas h2h (para books count consistente + CLV futuro).
    for (const bkKey of books) {
      const o = byBook[bkKey];
      for (const side of ['home', 'draw', 'away']) {
        await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: bkKey, external_event_id: theOddsEvent.id, canonical_event_id: ev.id, market_family: 'match_winner', line: 0, side, market_id: 'MATCH_WINNER_' + side.toUpperCase(), odds_decimal: o[side], implied_probability: o[side] > 1 ? 1 / o[side] : null, quote_status: 'open', is_live: false, provider_update: o.last_update }).catch(() => {});
      }
    }
    // No-vig 3-way: por casa normaliza 1/odds; promedia por resultado.
    const acc = { home: 0, draw: 0, away: 0 };
    for (const bkKey of books) {
      const o = byBook[bkKey], raw = { home: 1 / o.home, draw: 1 / o.draw, away: 1 / o.away };
      const s = raw.home + raw.draw + raw.away;
      acc.home += raw.home / s; acc.draw += raw.draw / s; acc.away += raw.away / s;
    }
    const n = books.length, cons = { home: acc.home / n, draw: acc.draw / n, away: acc.away / n };
    const best = { home: Math.max(...books.map(k => byBook[k].home)), draw: Math.max(...books.map(k => byBook[k].draw)), away: Math.max(...books.map(k => byBook[k].away)) };
    const model = { home: Number(deep.probs.aWin), draw: Number(deep.probs.draw), away: Number(deep.probs.bWin) };
    let persisted = 0;
    for (const side of ['home', 'draw', 'away']) {
      const gp = model[side], bo = best[side]; if (!(bo > 1) || !(gp >= 0)) continue;
      const be = 1 / bo;
      await grepo.recordGoalValue({
        goal_snapshot_id: goalSnapshotId || null, canonical_event_id: ev.id, market_id: 'MATCH_WINNER_' + side.toUpperCase(),
        market_family: 'match_winner', period_code: 'REGULATION', gp_probability: gp, market_consensus_probability: cons[side],
        best_decimal_odds: bo, break_even_probability: be, raw_edge_pp: gp - be, conservative_probability: gp,
        adjusted_edge_pp: gp - be, adjusted_ev: gp * bo - 1, classification: 'shadow', goal_value_policy_version: 'match-winner-shadow-1',
      }).catch(() => {});
      persisted++;
    }
    return persisted;
  } catch (e) { return 0; }
}

// ===== GOLES (G5): Picks de goles. Promueve un Value (G3) en familia APROBADA (G4) a Pick GP con el gate
// editorial (goalPick.qualifyPick). SHADOW/admin: persiste a db.goalPicks (db.json), NO se expone a usuarios.
// Gated por GP_GOAL_PICKS_ENABLED (default OFF → dormido aunque haya cuotas). Idempotente por (evento,mercado).
function goalPicksOn() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_GOAL_PICKS_ENABLED || '')); }
const GOAL_GATE_FAMILY = { match_total: 'TOTALS', btts: 'BTTS', team_total: 'TEAM_TOTALS', winning_margin: 'WINNING_MARGIN' };
let _goalPicksRunning = false, _goalPicksLast = null;
async function evaluateGoalPicks() {
  if (!goalPicksOn()) return { skipped: 'disabled' };
  if (_goalPicksRunning) return { skipped: 'running' };
  _goalPicksRunning = true;
  const out = { considered: 0, qualified: 0, new: 0, skipped: 0, errors: 0, started: new Date().toISOString() };
  try {
    const dbc = require('./database/client');
    const dbcfg = require('./database/config');
    if (!dbcfg.db || !dbcfg.db.configured) return { skipped: 'no_db' };
    const goalPick = require('./goal-engine/goalPick');
    const gate = require('./calibration/goalGates').report({ results: db.results || {} });
    // Sin JOIN a canonical_events (los ids de goles pueden ser sintéticos). Los equipos + kickoff salen del
    // factor_lineage del snapshot más reciente. Solo Value reciente (≈ partidos próximos).
    // Casas por evento en UNA pasada agrupada (el subquery correlacionado por fila sobre la tabla de cuotas de
    // ~400K filas causaba statement timeout — mismo fix que buildDailyPicks, ver migración 043).
    const booksByEvent = {};
    for (const b of (await dbc.query(
      `SELECT canonical_event_id, count(distinct sportsbook_code)::int books
       FROM sportsbook_goal_quote_current GROUP BY 1`)).rows) booksByEvent[b.canonical_event_id] = b.books;
    const rows = (await dbc.query(
      `SELECT DISTINCT ON (gv.canonical_event_id, gv.market_id)
         gv.canonical_event_id, gv.market_id, gv.market_family, gv.gp_probability, gv.market_consensus_probability,
         gv.best_decimal_odds, gv.adjusted_edge_pp, gv.adjusted_ev, gv.conservative_probability, gv.classification,
         s.data_completeness, s.factor_lineage
       FROM goal_value_shadow gv
       LEFT JOIN LATERAL (SELECT data_completeness, factor_lineage FROM goal_model_snapshots g WHERE g.canonical_event_id=gv.canonical_event_id ORDER BY created_at DESC LIMIT 1) s ON true
       WHERE gv.created_at > now() - interval '2 days'
       ORDER BY gv.canonical_event_id, gv.market_id, gv.created_at DESC`)).rows;
    const idx = {}; for (const p of db.goalPicks) idx[p.event.canonical_event_id + '|' + p.market_id] = p;
    const nowMs = Date.now();
    for (const r of rows) {
      out.considered++;
      try {
        const famGate = gate.families[GOAL_GATE_FAMILY[r.market_family]] || { status: 'shadow' };
        const lin = (Array.isArray(r.factor_lineage) ? r.factor_lineage[0] : null) || {};
        const a = lin.home_team_id || null, b = lin.away_team_id || null, kickoff = lin.kickoff_at || null;
        if (kickoff && new Date(kickoff).getTime() <= nowMs) { out.skipped++; continue; } // ya empezó → no es Pick prepartido
        const q = goalPick.qualifyPick({
          valueRow: r, gate: famGate, snapshot: { data_completeness: r.data_completeness },
          event: { canonical_event_id: r.canonical_event_id, home_team_id: a, away_team_id: b, kickoff_at: kickoff },
          market: { books_available: Number(booksByEvent[r.canonical_event_id] || 0), best_sportsbook: null, lineup_status: 'UNKNOWN', sources: [] },
        });
        if (!q.qualifies) { out.skipped++; continue; }
        out.qualified++;
        const key = r.canonical_event_id + '|' + r.market_id;
        if (idx[key]) continue; // ya existe → idempotente
        const pick = { ...q.pick, pick_id: 'gpk_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 16), created_at: new Date().toISOString() };
        db.goalPicks.push(pick); idx[key] = pick; out.new++;
      } catch (e) { out.errors++; }
    }
    if (out.new) save();
  } catch (e) { out.error = e.message; }
  finally { _goalPicksRunning = false; out.finished = new Date().toISOString(); _goalPicksLast = out; }
  return out;
}

// Liquida los Picks de goles PENDIENTES por el marcador REGLAMENTARIO. Solo partidos de GRUPO (90' garantizado);
// los de eliminatoria necesitan el marcador de 90' como fuente limpia → quedan PENDING (settlement futuro).
function goalGroupScore(homeId, awayId) {
  for (const f of GROUP_FIXTURES) {
    const r = db.results[f.id];
    if (!r || r.status !== 'final' || typeof r.hg !== 'number') continue;
    if (f.home === homeId && f.away === awayId) return { homeGoals: r.hg, awayGoals: r.ag };
    if (f.home === awayId && f.away === homeId) return { homeGoals: r.ag, awayGoals: r.hg };
  }
  return null;
}
function settleGoalPicks() {
  const goalPick = require('./goal-engine/goalPick');
  let settled = 0;
  for (const p of db.goalPicks) {
    if (p.result_code !== 'PENDING') continue;
    const sc = goalGroupScore(p.event.home_team_id, p.event.away_team_id);
    if (!sc) continue;
    const upd = goalPick.settlePick(p, sc);
    p.result_code = upd.result_code; p.settlement_code = upd.settlement_code; p.lifecycle_code = 'SETTLED'; p.clv = upd.clv;
    settled++;
  }
  if (settled) save();
  return settled;
}

// ===== PICKS DIARIAS (producto principal /x). "Tipster mejorado": sigue al mercado en 1X2 (anclaje), deja liderar
// al modelo en goles, y arma combos. AUTO-PUBLICADAS (sin aprobación manual) vía pick-engine/curate (validado 12/13
// en backtest). FEED EFÍMERO: el usuario solo ve ACTIVE; al liquidarse pasan a SETTLED (track record solo admin).
// Gated por GP_DAILY_PICKS_ENABLED (default OFF → dormido). Idempotente por pick_id estable (evento|familia|selección).
function dailyPicksOn() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_DAILY_PICKS_ENABLED || '')); }
let _dailyPicksRunning = false, _dailyPicksLast = null;
async function evaluateDailyPicks() {
  if (!dailyPicksOn()) return { skipped: 'disabled' };
  if (_dailyPicksRunning) return { skipped: 'running' };
  _dailyPicksRunning = true;
  const out = { considered: null, new: 0, started: new Date().toISOString() };
  try {
    const dbcfg = require('./database/config');
    if (!dbcfg.db || !dbcfg.db.configured) { out.skipped = 'no_db'; return out; }
    const dbc = require('./database/client');
    const daily = require('./pick-engine/dailyPicks');
    const built = await daily.buildDailyPicks({ query: (sql, pr) => dbc.query(sql, pr), now: Date.now(), playerAvailability: observerAvailability(), projectedStarters: projectedStarters(), confirmedXi: confirmedXiPids() });
    out.considered = built.considered; out.counts = built.counts;
    const idx = {}; for (const p of db.dailyPicks) idx[p.pick_id] = p;
    for (const pick of built.picks) {
      if (idx[pick.pick_id]) continue; // ya publicada → idempotente
      db.dailyPicks.push(pick); idx[pick.pick_id] = pick; out.new++;
    }
    // COHERENCIA: una sola pick ACTIVE por (PARTIDO, familia) — se conserva la MÁS RECIENTE y se supersede el resto.
    // Evita contradicciones por acumulación (ej: Over 3.5 y Under 3.5 del mismo partido cuando el modelo se da vuelta
    // al salir alineaciones). El combo y los goles del run más reciente quedan alineados (se construyen juntos).
    // La clave es el PAR DE EQUIPOS (no el event id): el mismo partido puede existir bajo id canónico Y sintético
    // (canónicos aprobados + pipeline de goles) y agrupar por id dejaba picks duplicadas ACTIVE en el feed.
    // Seguro contra falsos positivos: dos selecciones ya jugadas del mismo par están SETTLED (no entran aquí).
    const byEF = {};
    for (const p of db.dailyPicks) {
      if (p.status !== 'ACTIVE') continue;
      const ev = p.event || {};
      const matchKey = (ev.home_team_id && ev.away_team_id) ? [ev.home_team_id, ev.away_team_id].sort().join('~') : ev.canonical_event_id;
      (byEF[matchKey + '|' + p.family] = byEF[matchKey + '|' + p.family] || []).push(p);
    }
    for (const key in byEF) {
      const arr = byEF[key]; if (arr.length <= 1) continue;
      // editorial (reemplazo manual vía picks-replace) GANA sobre lo que emita el motor; entre iguales, la más reciente
      arr.sort((a, b) => ((b.editorial ? 1 : 0) - (a.editorial ? 1 : 0)) || (new Date(b.created_at) - new Date(a.created_at)));
      for (let i = 1; i < arr.length; i++) { arr[i].status = 'SETTLED'; arr[i].result_code = 'SUPERSEDED'; arr[i].settled_at = new Date().toISOString(); out.superseded = (out.superseded || 0) + 1; }
    }
    if (out.new || out.superseded) save();
  } catch (e) { out.error = e.message; }
  finally { _dailyPicksRunning = false; out.finished = new Date().toISOString(); _dailyPicksLast = out; }
  return out;
}

// Datos VERIFICADOS de 90' por par de equipos (POST /api/internal/picks-reg90): marcador reglamentario y,
// opcionalmente, córners/tarjetas/goleadores de los 90'. Fuente prioritaria para liquidar a 90' los partidos
// definidos en prórroga/penales. Fallback: snapshot automático reg90 del sync ESPN (último marcador con reloj
// <=90'; se exige minute>=85 para no liquidar con un snapshot viejo por caída del sync). Orientado a (homeId, awayId).
function reg90For(homeId, awayId) {
  const man = (db.reg90 || {})[homeId + '~' + awayId] || (db.reg90 || {})[awayId + '~' + homeId];
  if (man) {
    const flip = man.home !== homeId;
    return {
      homeGoals: man.hg90 != null ? (flip ? man.ag90 : man.hg90) : null,
      awayGoals: man.ag90 != null ? (flip ? man.hg90 : man.ag90) : null,
      corners: man.corners90 != null ? Number(man.corners90) : null,
      cards: man.cards90 != null ? Number(man.cards90) : null,
      scorers: Array.isArray(man.scorers90) ? man.scorers90 : null,
      nonstarters: Array.isArray(man.nonstarters90) ? man.nonstarters90 : null,
      source: 'manual-verified',
    };
  }
  for (const k of KNOCKOUT) {
    const r = db.results[String(k.m)];
    if (!r || r.status !== 'final' || !r.home || !r.reg90 || !(Number(r.reg90.minute) >= 85)) continue;
    if (r.home === homeId && r.away === awayId) return { homeGoals: r.reg90.hg, awayGoals: r.reg90.ag, source: 'sync' };
    if (r.home === awayId && r.away === homeId) return { homeGoals: r.reg90.ag, awayGoals: r.reg90.hg, source: 'sync' };
  }
  return null;
}
// ===== REGIONES DE THE ODDS API (plan 100k, 17-jul) — el costo es mercados×regiones por request. ============
// Con el plan grande abrimos el abanico de casas: multi-casa REAL es lo que habilita el modo EDGE de
// córners/tarjetas (con 1 sola casa el de-vig ≈ el precio de esa casa → nunca hay precio que batir).
// PROPS = las 5 regiones (córners/cards/player viven repartidos entre libros UK/EU/US/AU → máxima cobertura).
// SCAN 1X2/totales = 3 regiones (profundidad de casas suficiente para el consenso de SOLID/GOALS sin gastar
// de más en el barrido horario). Ajustar aquí un solo lugar cambia todos los sweeps.
const ODDS_REGIONS_PROPS = 'us,us2,uk,eu,au';
const ODDS_REGIONS_SCAN = 'us,uk,eu';
// ===== PRESUPUESTO DE THE ODDS API (plan 100k, 17-jul) — tracker + guard compartido ==========================
// Cada respuesta de The Odds API trae `x-requests-remaining` (créditos del ciclo, resetea el 24). Lo capturamos
// en global._oddsCredits y los sweeps consultan `oddsBudgetOk(reserve)` ANTES de gastar: por debajo de la
// reserva se saltan (el intervalo reintenta más tarde) → los 100k NUNCA se agotan (nos frenamos con colchón).
// Reservas: props (caro, 20 créd/evento) frena antes; scan (barato) puede seguir con menos. El plan grande deja
// correr cadencias frescas casi todo el mes; la reserva solo muerde a fin de ciclo.
global._oddsCredits = global._oddsCredits || { remaining: null, at: 0 };
function noteOddsCredits(r) {
  try { const v = Number(r && r.headers && r.headers.get('x-requests-remaining')); if (Number.isFinite(v)) { global._oddsCredits.remaining = v; global._oddsCredits.at = Date.now(); } } catch { /* header ausente */ }
}
function oddsBudgetOk(reserve) {
  const c = global._oddsCredits.remaining;
  return c == null || c >= reserve; // desconocido (aún sin llamadas) → permitir; el header lo corrige tras la 1ª
}
// ===== FASE CLUBES: INGESTA DE CUOTAS a las tablas de la casa (shadow, cadencia ~60 min) =====
// Punto 1 del spec de adaptación (13-jul): las cuotas de clubes viven en sportsbook_goal_quote_current
// (match_winner + match_total, ids SINTÉTICOS por liga+par — MISMO patrón que el Mundial vía
// stableGoalEventId, sin FK ni tocar el grafo canónico). Con eso el market-scanner (precio atrasado /
// arbitraje, venue-agnóstico) y el futuro value multi-liga leen clubes SIN UI nueva. Inerte para el
// pipeline del Mundial: solo se escriben QUOTES (ninguna evaluación/valor/pick).
// Costo: h2h,totals × ODDS_REGIONS_SCAN (3) = 6 créditos × ligas en temporada con cuotas (~6) ≈ 12/hora al ritmo
// de 30 min (plan 100k). Cadencia 30 min (era 55) para líneas 1X2/totales más frescas; reserva de créditos 2000.
let _clubsQuotesLast = 0, _clubsQuotesRunning = false, _clubsQuotesOut = null;
async function clubsQuotesSweep({ force = false } = {}) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.GP_CLUBS_SHADOW_ENABLED || '').trim())) return { skipped: 'off' };
  const dbc = require('./database/client'); if (!dbc.isConfigured()) return { skipped: 'db_off' };
  const key = process.env.SPORTSBOOK_PROVIDER_API_KEY || ''; if (!key) return { skipped: 'no_key' };
  if (_clubsQuotesRunning) return { skipped: 'running' };
  if (!force && Date.now() - _clubsQuotesLast < 30 * 60e3) return { skipped: 'throttle' };
  if (!force && !oddsBudgetOk(2000)) return { skipped: 'budget_reserve', credits_remaining: global._oddsCredits.remaining };
  _clubsQuotesRunning = true;
  const out = { leagues: 0, events: 0, quotes: 0, started: new Date().toISOString() };
  try {
    if (!global._clubsRatings) {
      try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); }
      catch { global._clubsRatings = { leagues: {} }; }
    }
    const { stableGoalEventId } = require('./goal-engine/eventKey');
    const grepo = require('./goal-engine/repository');
    const inSeason = Object.values(global._clubsRatings.leagues || {}).filter(L => L.odds_key && !L.starts);
    for (const L of inSeason) {
      let events = null;
      try {
        const r = await fetch(`https://api.the-odds-api.com/v4/sports/${L.odds_key}/odds?apiKey=${key}&regions=${ODDS_REGIONS_SCAN}&markets=h2h,totals&oddsFormat=decimal`, { signal: AbortSignal.timeout(15000) });
        noteOddsCredits(r);
        events = r.ok ? await r.json().catch(() => null) : null;
      } catch { /* liga sin datos este ciclo */ }
      if (!Array.isArray(events)) continue;
      out.leagues++;
      for (const ev of events.slice(0, 25)) {
        const ceid = stableGoalEventId('cl:' + L.key + ':' + ev.home_team, 'cl:' + L.key + ':' + ev.away_team);
        out.events++;
        // metadata del evento sintético (liga, equipos, kickoff) para que el market-scanner pueda armar
        // mercados de clubes: la tabla de quotes no guarda nombres y el JOIN de la casa no ve estos ids.
        db.clubsQuoteEvents = db.clubsQuoteEvents || {};
        db.clubsQuoteEvents[ceid] = { league: L.key, league_name: L.name || L.key, home: ev.home_team, away: ev.away_team, kickoff: ev.commence_time || null, oa_id: ev.id, at: Date.now() };
        for (const bk of ev.bookmakers || []) {
          for (const mk of bk.markets || []) {
            if (mk.key === 'h2h') {
              for (const oc of mk.outcomes || []) {
                if (!(oc.price > 1)) continue;
                const side = oc.name === ev.home_team ? 'home' : oc.name === ev.away_team ? 'away' : 'draw';
                await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: bk.key, external_event_id: ev.id, canonical_event_id: ceid, market_family: 'match_winner', line: 0, side, market_id: 'MATCH_WINNER_' + side.toUpperCase(), odds_decimal: oc.price, implied_probability: 1 / oc.price, quote_status: 'open', is_live: false, provider_update: bk.last_update }).catch(() => {});
                out.quotes++;
              }
            } else if (mk.key === 'totals') {
              for (const oc of mk.outcomes || []) {
                const line = Number(oc.point);
                if (!Number.isFinite(line) || !(oc.price > 1)) continue;
                const side = /over/i.test(oc.name) ? 'over' : 'under';
                await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: bk.key, external_event_id: ev.id, canonical_event_id: ceid, market_family: 'match_total', line, side, team_scope: 'total', market_id: 'TOTAL_GOALS_' + side.toUpperCase() + '_' + String(line).replace('.', '_'), odds_decimal: oc.price, implied_probability: 1 / oc.price, quote_status: 'open', is_live: false, provider_update: bk.last_update }).catch(() => {});
                out.quotes++;
              }
            }
          }
        }
      }
    }
    _clubsQuotesLast = Date.now();
    // poda: eventos con kickoff viejo (o sin refrescar hace 48h) salen del mapa — el scanner solo mira próximos
    if (db.clubsQuoteEvents) {
      for (const [id, m] of Object.entries(db.clubsQuoteEvents)) {
        const k = m.kickoff ? +new Date(m.kickoff) : 0;
        if ((k && k < Date.now() - 36 * 3600e3) || (!k && Date.now() - (m.at || 0) > 48 * 3600e3)) delete db.clubsQuoteEvents[id];
      }
      save();
    }
  } catch (e) { out.error = e.message; }
  finally { _clubsQuotesRunning = false; out.finished = new Date().toISOString(); _clubsQuotesOut = out; }
  console.log('[clubs] quotes sweep:', JSON.stringify({ leagues: out.leagues, events: out.events, quotes: out.quotes, error: out.error || null }));
  return out;
}
// ===== CLOUDBET (crypto sportsbook) — UNA CASA MÁS ==========================================================
// Cloudbet tiene API pública (key gratis). Su fútbol se FUSIONA sobre los eventos que el scanner ya rastrea
// (db.clubsQuoteEvents): match por nombres normalizados → escribimos sus cuotas 1X2/totals con
// sportsbook_code='cloudbet' y el MISMO canonical_event_id → value/arbitraje/best-odds/picks la ven sin tocar
// nada. GATED tras CLOUDBET_API_KEY: sin key = no-op absoluto (jamás toca la DB). Fallback graceful total.
let _cloudbetRunning = false, _cloudbetLast = 0, _cloudbetOut = null;
function cloudbetKeyName(s) { // normalización tolerante para matchear nombres de equipo entre proveedores
  return normName(s).replace(/\b(fc|cf|cd|sc|ac|afc|club|deportivo|atletico|athletic|the|de|do|da)\b/g, '').replace(/[^a-z0-9]/g, '');
}
function cloudbetNameMatch(a, b) { // contains bidireccional sobre la forma reducida (tolera "Man Utd" vs "Manchester United")
  const x = cloudbetKeyName(a), y = cloudbetKeyName(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)));
}
async function cloudbetSweep({ force = false, dryRun = false } = {}) {
  const apiKey = process.env.CLOUDBET_API_KEY || '';
  if (!apiKey) return { skipped: 'no_key' };
  const dbc = require('./database/client'); if (!dbc.isConfigured()) return { skipped: 'db_off' };
  if (_cloudbetRunning) return { skipped: 'running' };
  if (!force && Date.now() - _cloudbetLast < 20 * 60e3) return { skipped: 'throttle' };
  _cloudbetRunning = true;
  const out = { events_cloudbet: 0, matched: 0, quotes: 0, samples: [], started: new Date().toISOString(), dry_run: !!dryRun };
  try {
    const cbEvents = await require('./market-scanner/venues/cloudbet').fetchCloudbetSoccer({ apiKey });
    out.events_cloudbet = cbEvents.length;
    const grepo = require('./goal-engine/repository');
    const known = Object.entries(db.clubsQuoteEvents || {}); // [ceid, {home,away,league,...}]
    for (const cb of cbEvents) {
      // buscar el evento conocido de este partido (directo o cruzado home/away)
      const hit = known.find(([, m]) =>
        (cloudbetNameMatch(cb.home, m.home) && cloudbetNameMatch(cb.away, m.away)) ||
        (cloudbetNameMatch(cb.home, m.away) && cloudbetNameMatch(cb.away, m.home)));
      if (!hit) continue;
      const [ceid, meta] = hit;
      const swapped = !(cloudbetNameMatch(cb.home, meta.home) && cloudbetNameMatch(cb.away, meta.away)); // Cloudbet home = nuestro away?
      out.matched++;
      if (out.samples.length < 8) out.samples.push({ cloudbet: cb.home + ' v ' + cb.away, matched: meta.home + ' v ' + meta.away, league: meta.league, h2h: cb.markets.h2h, totals: cb.markets.totals.length });
      if (dryRun) continue;
      const eid = 'cloudbet-' + ceid;
      // 1X2 (orientado a NUESTRO home): si swapped, home↔away de Cloudbet se intercambian
      if (cb.markets.h2h) {
        const h = cb.markets.h2h, sides = swapped ? { home: h.away, draw: h.draw, away: h.home } : h;
        for (const side of ['home', 'draw', 'away']) {
          if (!(sides[side] > 1)) continue;
          await grepo.upsertGoalQuote({ data_provider: 'cloudbet', sportsbook_code: 'cloudbet', external_event_id: eid, canonical_event_id: ceid, market_family: 'match_winner', line: 0, side, market_id: 'MATCH_WINNER_' + side.toUpperCase(), odds_decimal: sides[side], implied_probability: 1 / sides[side], quote_status: 'open', is_live: false }).catch(() => {});
          out.quotes++;
        }
      }
      // totales (over/under; simétricos, el swap no afecta)
      for (const t of cb.markets.totals) {
        if (!(t.line > 0)) continue;
        for (const side of ['over', 'under']) {
          const o = t[side]; if (!(o > 1)) continue;
          await grepo.upsertGoalQuote({ data_provider: 'cloudbet', sportsbook_code: 'cloudbet', external_event_id: eid, canonical_event_id: ceid, market_family: 'match_total', line: t.line, side, market_id: 'TOTAL_GOALS_' + side.toUpperCase() + '_' + String(t.line).replace('.', '_'), odds_decimal: o, implied_probability: 1 / o, quote_status: 'open', is_live: false }).catch(() => {});
          out.quotes++;
        }
      }
    }
    if (!dryRun) _cloudbetLast = Date.now();
  } catch (e) { out.error = e.message; }
  finally { _cloudbetRunning = false; out.finished = new Date().toISOString(); _cloudbetOut = out; }
  return out;
}
// PLAYER PROPS de clubes (F3.4 encendida 15-jul, orden de Alexis: assists activas — estaban en shadow):
// por evento próximo (<48h) pide player_assists + player_goal_scorer_anytime a The Odds API y las ingesta con
// el ceid sintético del evento (mismo patrón del sweep). Nombre del jugador → pl_ id vía el fit de la liga
// (mismo matcher full/apellido). Coste: 1 req por evento, cadencia 6h, solo ligas con odds_key en temporada.
// HOY cotizan: MLS assists(1 casa)+anytime(6), Liga MX anytime(3); BRA/ARG sin props — las casas EU llegan
// en agosto y esto queda encendido para entonces.
let _clubsPropsRunning = false, _clubsPropsLast = 0, _clubsPropsOut = null;
async function clubsPlayerPropsSweep({ force = false } = {}) {
  if (!clubsShadowOn()) return { skipped: 'off' };
  const dbc = require('./database/client'); if (!dbc.isConfigured()) return { skipped: 'db_off' };
  const key = process.env.SPORTSBOOK_PROVIDER_API_KEY || ''; if (!key) return { skipped: 'no_key' };
  if (_clubsPropsRunning) return { skipped: 'running' };
  if (!force && Date.now() - _clubsPropsLast < 3 * 3600e3) return { skipped: 'throttle' }; // cadencia 3h (era 5.5) con plan 100k
  if (!force && !oddsBudgetOk(6000)) return { skipped: 'budget_reserve', credits_remaining: global._oddsCredits.remaining }; // props caro → reserva mayor
  _clubsPropsRunning = true;
  const out = { events: 0, quotes: 0, unmatched: 0, started: new Date().toISOString() };
  try {
    if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { leagues: {} }; } }
    const RT = global._clubsRatings;
    const grepo = require('./goal-engine/repository');
    const now = Date.now();
    // resolutores de nombre→pid por liga (fit del player-history, ambos equipos del evento)
    const rsvCache = {};
    const pidOf = (lg, name) => {
      if (!rsvCache[lg]) {
        const idx = { full: {}, last: {}, dup: {} };
        try {
          const fit = require('./player-intel/clubsFit').leagueFit(lg);
          for (const pid in (fit && fit.players) || {}) {
            const nm = normName(fit.players[pid].name); if (!nm) continue;
            if (!idx.full[nm]) idx.full[nm] = pid;
            const ln = nm.split(/\s+/).pop();
            if (ln && ln.length >= 3) { if (idx.last[ln] && idx.last[ln] !== pid) { idx.dup[ln] = 1; delete idx.last[ln]; } else if (!idx.dup[ln]) idx.last[ln] = pid; }
          }
        } catch { /* liga sin fit */ }
        rsvCache[lg] = idx;
      }
      const idx = rsvCache[lg], n = normName(name);
      return idx.full[n] || idx.last[n.split(/\s+/).pop()] || null;
    };
    for (const [ceid, meta] of Object.entries(db.clubsQuoteEvents || {})) {
      if (!meta.oa_id || !meta.kickoff) continue;
      const kt = +new Date(meta.kickoff);
      if (!(kt > now && kt < now + 48 * 3600e3)) continue;
      const L = RT.leagues[meta.league]; if (!L || !L.odds_key) continue;
      let o = null;
      try {
        // F3.4: córners/tarjetas en la MISMA llamada por evento (mismos markets del Mundial: alternate_totals_*)
        const r = await fetch(`https://api.the-odds-api.com/v4/sports/${L.odds_key}/events/${meta.oa_id}/odds?apiKey=${key}&regions=${ODDS_REGIONS_PROPS}&markets=player_assists,player_goal_scorer_anytime,alternate_totals_corners,alternate_totals_cards&oddsFormat=decimal`, { signal: AbortSignal.timeout(12000) });
        noteOddsCredits(r);
        o = r.ok ? await r.json().catch(() => null) : null;
      } catch { o = null; }
      if (!o || !Array.isArray(o.bookmakers)) continue;
      out.events++;
      for (const bk of o.bookmakers) for (const m of (bk.markets || [])) {
        // ---- CÓRNERS/TARJETAS de equipo (mismo parseo del Mundial: solo líneas .0/.5, mid CORNERS_/CARDS_) ----
        const tfam = m.key === 'alternate_totals_corners' ? 'corners_total' : m.key === 'alternate_totals_cards' ? 'cards_total' : null;
        if (tfam) {
          for (const oc of (m.outcomes || [])) {
            const side = /under/i.test(oc.name) ? 'under' : 'over';
            const line = Number(oc.point), odds = Number(oc.price);
            if (!Number.isFinite(line) || !(odds >= 1.05 && odds <= 51)) continue;
            if (Math.abs(line * 10 % 5) > 0.001) continue; // solo .0/.5 (el settle usa .5, sin push)
            const mid = (tfam === 'corners_total' ? 'CORNERS_' : 'CARDS_') + side.toUpperCase() + '_' + String(line).replace('.', '_');
            await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: bk.key, external_event_id: meta.oa_id, canonical_event_id: ceid, market_family: tfam, line, side, team_scope: 'total', market_id: mid, odds_decimal: odds, implied_probability: 1 / odds, quote_status: 'open', is_live: false, provider_update: bk.last_update }).catch(() => {});
            out.team_quotes = (out.team_quotes || 0) + 1;
          }
          continue;
        }
        const fam = m.key === 'player_assists' ? 'player_assist' : m.key === 'player_goal_scorer_anytime' ? 'player_goal' : null;
        if (!fam) continue;
        for (const oc of (m.outcomes || [])) {
          // player_assists: name=Over/Under + point + description=jugador; anytime scorer: name=jugador (Yes)
          const pname = oc.description || oc.name;
          if (fam === 'player_assist' && String(oc.name).toLowerCase() === 'under') continue; // solo el lado over/anytime
          if (!(oc.price > 1) || !pname) continue;
          const pid = pidOf(meta.league, pname);
          if (!pid) { out.unmatched++; continue; }
          const line = oc.point != null ? Number(oc.point) : null;
          const marketId = fam === 'player_assist' ? `PLAYER_ASSIST_${pid}` : `PLAYER_GOAL_${pid}`;
          await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: bk.key, external_event_id: meta.oa_id, canonical_event_id: ceid, market_family: fam, line: line != null ? line : 0, side: 'yes', team_scope: pid, market_id: marketId, odds_decimal: oc.price, implied_probability: 1 / oc.price, quote_status: 'open', is_live: false, provider_update: bk.last_update }).catch(() => {});
          out.quotes++;
        }
      }
      await new Promise(r => setTimeout(r, 400)); // gentileza con el proveedor
    }
    _clubsPropsLast = Date.now();
  } catch (e) { out.error = e.message; }
  finally { _clubsPropsRunning = false; out.finished = new Date().toISOString(); _clubsPropsOut = out; }
  if (out.quotes || out.team_quotes || out.error) console.log('[clubs] props sweep:', JSON.stringify({ events: out.events, player_quotes: out.quotes, team_quotes: out.team_quotes || 0, unmatched: out.unmatched, error: out.error || null }));
  return out;
}

// ===== FASE CLUBES: MARCADORES EN VIVO / FINALIZADOS (shadow, ESPN por liga) =====
// Mismo pipeline probado del Mundial (syncFromESPN): scoreboard ESPN por código de liga, estado pre/in/post,
// marcador + minuto (displayClock) + tanda de penales/prórroga. Los equipos de ESPN se matchean a NUESTROS
// ids tm_ (TheStatsAPI, los mismos de ratings.json) por nombre normalizado + alias curados; un partido solo
// se registra si AMBOS lados matchean a ids distintos (evita marcadores cruzados). Se guarda en
// db.clubResults[<liga>|<idA-idB ordenados>] → lo consumen /api/clubs/state y la vista cl-. Gate por
// GP_CLUBS_SHADOW_ENABLED; ESPN es gratis (0 créditos). Nada de esto toca el Mundial ni el pipeline de picks.
const CLUB_ESPN = { ligamx: 'mex.1', brasileirao: 'bra.1', mls: 'usa.1', argentina: 'arg.1', colombia: 'col.1', paraguay: 'par.1', csl: 'chn.1', kleague: 'kor.1', j1: 'jpn.1', premier: 'eng.1', laliga: 'esp.1', bundesliga: 'ger.1', seriea: 'ita.1', ligue1: 'fra.1' };
// alias ESPN(normalizado) → nombre de NUESTRO roster (normalizado), para los abreviados con guion/marca.
const CLUB_ALIAS = { 'athletico pr': 'athletico paranaense', 'atletico mg': 'atletico mineiro', 'atletico go': 'atletico goianiense', 'red bull new york': 'new york red bulls', 'lafc': 'los angeles', 'dc united': 'd c united', 'atletico junior': 'junior' };
function clubNorm(s) {
  let n = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  n = n.replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(fc|cf|cd|sc|ac|afc|ec|sad)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return CLUB_ALIAS[n] || n;
}
function clubScoreKey(lg, a, b) { return lg + '|' + [a, b].sort().join('-'); }
// F3.1: fit ataque/defensa de goles por liga (clubs-engine/goalsModel) desde results-<liga>.json. Memo 30min.
// Da λ de goles REALISTAS por liga para la proyección del cockpit (el goal engine base sobre Elo predice ~51%
// over en todas). El 1X2 sigue del Elo; esto NO habilita picks de goles (skill de discriminación ~0, gate shadow).
function clubGoalsFit(league) {
  global._clubGoalsFit = global._clubGoalsFit || {};
  const c = global._clubGoalsFit[league];
  if (c && Date.now() - c.at < 30 * 60e3) return c.fit;
  let fit = null;
  try {
    const rows = JSON.parse(fs.readFileSync(clubDataFile(`results-${league}.json`), 'utf8')).rows || [];
    const matches = rows.filter(r => r.hg != null && r.ag != null).map(r => ({ home: { id: r.home_id, goals: r.hg }, away: { id: r.away_id, goals: r.ag } }));
    fit = require('./clubs-engine/goalsModel').fitLeagueGoals(matches);
  } catch { fit = null; }
  global._clubGoalsFit[league] = { at: Date.now(), fit };
  return fit;
}
// F4.1: SIMULADOR DE TEMPORADA por liga (Monte Carlo, mismo espíritu que el del Mundial). Reconstruye el
// calendario restante de los resultados (round-robin) + Elo dinámico → prob campeón/top-N/descenso por equipo.
// Se construye con la data disponible y se recomputa cuando cambian el Elo/resultados. Memo por liga (invalida
// con la versión del overlay Elo). meetings=2 (doble round-robin, el default de casi todas; override por liga).
const CLUB_MEETINGS = { /* overrides si alguna liga no es doble round-robin */ };
function clubSeasonSim(league) {
  if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { return null; } }
  const L = (global._clubsRatings.leagues || {})[league];
  // standings vacías NO cortan: el fallback abajo reconstruye la tabla desde los results (fix ligamx 17-jul —
  // ratings.json quedó sin tabla al cambiar de torneo, pero los results del Apertura ya existen)
  if (!L) return null;
  global._clubSeason = global._clubSeason || {};
  const eloVer = JSON.stringify(db.clubElos || {}).length; // cambia al aplicar Elo dinámico por un resultado nuevo
  const c = global._clubSeason[league];
  if (c && Date.now() - c.at < 30 * 60e3 && c.eloVer === eloVer) return c.sim;
  let sim = null;
  try {
    global._clubsResults = global._clubsResults || {};
    if (!global._clubsResults[league]) { try { global._clubsResults[league] = JSON.parse(fs.readFileSync(clubDataFile(`results-${league}.json`), 'utf8')).rows || []; } catch { global._clubsResults[league] = []; } }
    const rows = global._clubsResults[league];
    sim = require('./clubs-engine/seasonSim').projectSeason({
      standings: L.standings, eloOf: (id) => clubElo(league, id), hfa: L.hfa || 60,
      results: rows, meetings: CLUB_MEETINGS[league] || 2, sims: 5000,
    });
    // FALLBACK (fix ligamx 17-jul): cuando la tabla de ratings.json es de la TEMPORADA ANTERIOR terminada
    // (Clausura completo → remaining=0 → sim null) pero los results ya traen el torneo NUEVO, la tabla se
    // reconstruye DESDE los resultados (universo = equipos del fit) y se proyecta con eso. Torneos cortos
    // (Apertura/Clausura) reviven solos al llegar la primera jornada — regla data-parcial.
    if (!sim && rows.length) {
      sim = require('./clubs-engine/seasonSim').projectSeason({
        standings: clubStandingsFromResults(league, rows), eloOf: (id) => clubElo(league, id), hfa: L.hfa || 60,
        results: rows, meetings: CLUB_MEETINGS[league] || 2, sims: 5000,
      });
    }
  } catch { sim = null; }
  global._clubSeason[league] = { at: Date.now(), eloVer, sim };
  return sim;
}
// Tabla reconstruida desde los RESULTADOS (universo = equipos del fit de la liga): puntos/GF/GA por equipo.
// Usada como fallback cuando la tabla de ratings.json quedó de una temporada terminada (torneos cortos).
function clubStandingsFromResults(league, rows) {
  const L = ((global._clubsRatings || {}).leagues || {})[league] || {};
  const st = {};
  Object.keys(L.ratings || {}).forEach(id => { st[id] = { id, pts: 0, gf: 0, ga: 0 }; });
  for (const r of rows) {
    if (r.hg == null || !st[r.home_id] || !st[r.away_id]) continue;
    st[r.home_id].gf += r.hg; st[r.home_id].ga += r.ag; st[r.away_id].gf += r.ag; st[r.away_id].ga += r.hg;
    if (r.hg > r.ag) st[r.home_id].pts += 3; else if (r.hg < r.ag) st[r.away_id].pts += 3; else { st[r.home_id].pts++; st[r.away_id].pts++; }
  }
  return Object.values(st);
}
// ===== EVOLUCIÓN POR LIGA (paridad con la Evolución del Mundial) =============================================
// Historia de prob de CAMPEÓN por jornada, reconstruida retrospectivamente: para cada fecha con partidos,
// tabla del prefijo de resultados + season sim del calendario restante (MISMO projectSeason). Elo actual
// (estático a lo largo de la serie) — proyección retrospectiva honesta. Mismo shape que st.history del
// Mundial ({date, probs{id:champ%}}) → renderEvo del cliente lo grafica sin variantes. Memo por mtime.
function clubEvoHistory(league) {
  if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { return null; } }
  const L = (global._clubsRatings.leagues || {})[league];
  if (!L) return null;
  let fp = null, stamp = '0';
  try { fp = clubDataFile(`results-${league}.json`); stamp = String(fs.statSync(fp).mtimeMs); } catch { return { available: false }; }
  global._clubEvo = global._clubEvo || {};
  const c = global._clubEvo[league];
  if (c && c.stamp === stamp) return c.data;
  // OOM guard (18-jul, fusión pública): computar UNA evo a la vez en todo el proceso — N usuarios × ligas
  // concurrentes apilaban Monte Carlos simultáneos en un contenedor de 512MB (exit 134). El que llega durante
  // un cómputo recibe "cargando" y el cliente reintenta al re-render.
  global._clubEvoBusy = global._clubEvoBusy || false;
  if (global._clubEvoBusy) return (c && c.data) || { available: false, computing: true };
  global._clubEvoBusy = true;
  try {
  let data = { available: false };
  try {
    const all = (JSON.parse(fs.readFileSync(fp, 'utf8')).rows || [])
      .filter(r => r.hg != null && L.ratings[r.home_id] && L.ratings[r.away_id])
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const dates = [...new Set(all.map(r => String(r.date).slice(0, 10)))].slice(-40); // cap: últimas 40 jornadas-fecha
    const eloOf = (id) => clubElo(league, id);
    const { projectSeason } = require('./clubs-engine/seasonSim');
    const history = [];
    for (const d of dates) {
      const prefix = all.filter(r => String(r.date).slice(0, 10) <= d);
      const sim = projectSeason({
        standings: clubStandingsFromResults(league, prefix), eloOf, hfa: L.hfa || 60,
        results: prefix, meetings: CLUB_MEETINGS[league] || 2, sims: 2000, // plan Standard (2GB): MÁS precisión que el original (1500); el lock anti-concurrencia se queda (higiene)
      });
      if (!sim) continue;
      const probs = {};
      for (const [id, v] of Object.entries(sim.teams)) probs[id] = v.champion;
      history.push({ date: d, probs });
    }
    data = history.length ? { available: true, history } : { available: false };
  } catch { data = { available: false }; }
  global._clubEvo[league] = { stamp, data };
  return data;
  } finally { global._clubEvoBusy = false; }
}
// ARQUITECTURA DE COMPETICIÓN — BRACKET DE PLAYOFFS PROYECTADO (MX/MLS). Las ligas con fase final no se deciden
// solo por tabla: al terminar la temporada regular, los mejores clasificados juegan un bracket de eliminación.
// Hoy la temporada regular está en curso → NO hay bracket real; se PROYECTA (regla data-parcial): sembramos el
// cuadro con la posición PROYECTADA del season sim (exp_rank) y estimamos el avance por Elo (misma matchProbs del
// Mundial). Se actualiza cada jornada (invalida con el overlay Elo, como el season sim). Modelo de eliminación a
// partido único con localía del mejor sembrado — simplificación honesta del formato oficial (ida/vuelta, repechaje,
// conferencias), etiquetada como PROYECCIÓN en la UI. size = nº de clasificados que arma el cuadro.
// argentina/colombia (fix 17-jul): SÍ tienen fase final (playoffs del Clausura / cuadrangulares) → bracket
// proyectado single-elim con los mejores 8 proyectados — simplificación honesta del formato real, etiquetada
// PROYECCIÓN en la UI (igual que MLS/MX simplifican conferencias/ida-vuelta).
const CLUB_PLAYOFFS = {
  mls: { size: 8, name: 'MLS Cup Playoffs' }, ligamx: { size: 8, name: 'Liguilla' },
  argentina: { size: 8, name: 'Playoffs del Clausura' }, colombia: { size: 8, name: 'Cuadrangulares' },
};
function clubPlayoffBracket(league) {
  const cfg = CLUB_PLAYOFFS[league];
  if (!cfg) {
    // Liga SIN fase final: no un panel vacío — devolvemos la CARRERA POR EL TÍTULO del season sim (top 6 por
    // prob de campeón) para que la vista siempre muestre la data que sí tenemos (pedido Alexis 17-jul).
    const season = clubSeasonSim(league);
    if (!season || !season.teams) return { has_playoff: false };
    const RT0 = global._clubsRatings || {};
    const L0 = RT0.leagues && RT0.leagues[league];
    const nm = (id) => (L0 && L0.ratings && L0.ratings[id] && L0.ratings[id].name) || id;
    const race = Object.keys(season.teams)
      .map(id => ({ id, name: nm(id), champion: season.teams[id].champion, exp_rank: season.teams[id].exp_rank }))
      .sort((a, b) => b.champion - a.champion).slice(0, 6);
    return { has_playoff: false, title_race: race, remaining: season.remaining };
  }
  const season = clubSeasonSim(league);
  if (!season || !season.teams) return { has_playoff: true, available: false };
  const RT = global._clubsRatings || {};
  const L = RT.leagues && RT.leagues[league];
  const nameOf = (id) => (L && L.ratings && L.ratings[id] && L.ratings[id].name) || id;
  const hfa = (L && L.hfa) || 60;
  // clasificados = mejores `size` por posición PROYECTADA (exp_rank asc); sembrados 1..size
  const seeded = Object.keys(season.teams)
    .map(id => ({ id, exp_rank: season.teams[id].exp_rank, elo: clubElo(league, id) }))
    .sort((a, b) => a.exp_rank - b.exp_rank).slice(0, cfg.size)
    .map((s, i) => ({ ...s, seedIdx: i, seed: i + 1, name: nameOf(s.id) }));
  if (seeded.length < cfg.size) return { has_playoff: true, available: false };
  // prob de que el LOCAL (mejor sembrado) avance en un cruce a partido único (empate se reparte 50/50)
  const advHome = (home, away) => { const p = matchProbs(home.elo + hfa, away.elo); return p.home + 0.5 * p.draw; };
  const playMatch = (x, y, rng) => { const home = x.seedIdx < y.seedIdx ? x : y, away = home === x ? y : x; return rng() < advHome(home, away) ? home : away; };
  // emparejamientos QF por siembra (bracket estándar: 1 y 2 solo se cruzan en la final)
  const pairIdx = cfg.size === 8 ? [[0, 7], [3, 4], [2, 5], [1, 6]] : [[0, 3], [1, 2]];
  const qf = pairIdx.map((pr, i) => {
    const A = seeded[pr[0]], B = seeded[pr[1]]; const aAdv = advHome(A, B);
    return { i, hi: { id: A.id, name: A.name, seed: A.seed, elo: Math.round(A.elo), adv: +aAdv.toFixed(3) },
      lo: { id: B.id, name: B.name, seed: B.seed, elo: Math.round(B.elo), adv: +(1 - aAdv).toFixed(3) } };
  });
  // Monte Carlo del bracket completo (single-elim) → prob de campeón/llegar a la final por equipo
  const N = 5000; const champ = {}, reachF = {}; seeded.forEach(s => { champ[s.id] = 0; reachF[s.id] = 0; });
  const rng = Math.random;
  for (let s = 0; s < N; s++) {
    let round = pairIdx.map(pr => [seeded[pr[0]], seeded[pr[1]]]);
    let winners = round.map(([x, y]) => playMatch(x, y, rng));
    while (winners.length > 1) {
      if (winners.length === 2) { reachF[winners[0].id]++; reachF[winners[1].id]++; }
      const next = []; for (let i = 0; i < winners.length; i += 2) next.push(playMatch(winners[i], winners[i + 1], rng));
      winners = next;
    }
    champ[winners[0].id]++;
  }
  const seeds = seeded.map(s => ({ seed: s.seed, id: s.id, name: s.name, elo: Math.round(s.elo),
    champion: +(champ[s.id] / N).toFixed(3), reach_final: +(reachF[s.id] / N).toFixed(3) }));
  const favorite = seeds.slice().sort((a, b) => b.champion - a.champion)[0] || null;
  return { has_playoff: true, available: true, league, format: cfg.name, size: cfg.size,
    seeds, qf, favorite, sims: N, remaining: season.remaining };
}
// F2.4 STYLE ENGINE por liga — PERFIL TÁCTICO desde el event data FotMob (data/clubs/fotmob-<liga>.json en DISCO,
// backfill scripts/clubs-fotmob-backfill.js). MISMO fitStyles/matchupFindings del Mundial (no variante): shotmaps
// con situación (córner/balón parado/contra/zona/aéreo) → perfil ataque+defensa por equipo, percentiles DENTRO del
// corpus de la liga. Keyed por tm_ (el backfill guarda homeCode/awayCode=tm_). Memo por conteo de partidos del
// archivo → se enriquece conforme el backfill/sweep agrega partidos (regla data-parcial). Cross-liga: no aplica.
function clubStyleFit(league) {
  global._clubStyle = global._clubStyle || {};
  let fp = null, stamp = '0';
  try { fp = clubDataFile(`fotmob-${league}.json`); stamp = String(fs.statSync(fp).mtimeMs); } catch { fp = null; }
  try { stamp += '|' + fs.statSync(clubDataFile(`props-history-${league}.json`)).mtimeMs; } catch { /* sin props aún */ }
  const c = global._clubStyle[league];
  if (c && c.stamp === stamp) return c.fit; // sin cambios en el archivo → memo (no re-parsea ni re-fitea)
  let fit = null;
  try {
    const rows = JSON.parse(fs.readFileSync(fp, 'utf8')).matches || [];
    // props-history de la liga (si el backfill corrió): completa las filas "córners/tarjetas por partido"
    // del Tactical profile (mismo 2º parámetro que styleFit del Mundial). Opcional: sin archivo → null.
    let props = null;
    try { props = JSON.parse(fs.readFileSync(clubDataFile(`props-history-${league}.json`), 'utf8')).matches || null; } catch { props = null; }
    fit = require('./style-engine/profile').fitStyles(rows, props);
  } catch { fit = null; }
  global._clubStyle[league] = { stamp, fit };
  return fit;
}
function clubMatchStyle(league, hId, aId) {
  const S = clubStyleFit(league);
  if (!S) return { available: false };
  const home = S[hId] || null, away = S[aId] || null;
  if (!home || !away) return { available: false };
  let findings = [];
  try { findings = require('./style-engine/profile').matchupFindings(home, away); } catch { findings = []; }
  return { available: true, home: { team_id: hId, ...home }, away: { team_id: aId, ...away }, findings, generated_at: new Date().toISOString() };
}
// F3.4 PROPS DE EQUIPO por liga — córners/tarjetas con el MISMO prop-engine del Mundial (fit/project/backtest
// LOO son puros y keyean por code=tm_). Dataset: data/clubs/props-history-<liga>.json (disco, backfill
// scripts/clubs-props-backfill.js = mismo shape del props-history.json del Mundial). El BACKTEST LOO corre en
// el mismo memo → gate por familia (corners_total/cards_total: n≥40, brier≤0.25, calErr≤0.06 = los umbrales
// del Mundial) SIN proceso nuevo. Memo por mtime (recarga cuando el backfill actualiza el archivo).
function clubPropsFit(league) {
  global._clubProps = global._clubProps || {};
  let fp = null, stamp = '0';
  try { fp = clubDataFile(`props-history-${league}.json`); stamp = String(fs.statSync(fp).mtimeMs); } catch { fp = null; }
  const c = global._clubProps[league];
  if (c && c.stamp === stamp) return c.out;
  let out = null;
  try {
    const matches = JSON.parse(fs.readFileSync(fp, 'utf8')).matches || [];
    if (matches.length >= 20) {
      const pe = require('./prop-engine');
      // AUTO-TUNE de TOTALS_DAMP por liga (17-jul, lo que el comentario del modelo invitó: "re-tunear con
      // clubes, 30+ partidos/equipo → DAMP>0 probablemente gane"). Con el Mundial (4-6 partidos) el óptimo era
      // 0 (media de liga); con clubes las TARJETAS ganan señal de equipo/árbitro (verificado: J1 +0.010,
      // Brasileirão +0.003 con DAMP~0.5). Grid-search: elige el DAMP con mejor skill COMBINADO (córners+cards)
      // vs baseline de liga, SOLO si no empeora la calibración (calErr≤0.06). Default 0 si nada mejora (=
      // comportamiento anterior byte-idéntico). Memo por mtime → corre solo cuando el backfill actualiza data.
      let bestDamp = 0, bestScore = -Infinity, bestBt = null;
      for (const damp of [0, 0.25, 0.5]) {
        let bt = null; try { bt = pe.backtest(matches, { TOTALS_DAMP: damp }); } catch { continue; }
        const c = (bt.families && bt.families.corners_total) || {}, k = (bt.families && bt.families.cards_total) || {};
        if ((c.cal_err != null && c.cal_err > 0.06) || (k.cal_err != null && k.cal_err > 0.06)) { if (damp === 0 && !bestBt) { bestBt = bt; } continue; }
        const score = (c.skill_vs_baseline || 0) + (k.skill_vs_baseline || 0);
        if (score > bestScore) { bestScore = score; bestDamp = damp; bestBt = bt; }
      }
      const fit = pe.fit(matches, { TOTALS_DAMP: bestDamp });
      out = { fit, backtest: bestBt, matches: matches.length, totals_damp: bestDamp };
    }
  } catch { out = null; }
  global._clubProps[league] = { stamp, out };
  return out;
}
function clubPropsGate(league, family) {
  const pf = clubPropsFit(league);
  const f = pf && pf.backtest && pf.backtest.families && pf.backtest.families[family];
  return (f && f.status) || 'shadow';
}
// ===== FASE CLUBES F1.1: XI clickeable al perfil =====
// El XI/bench viene de API-Football (NOMBRES); los perfiles usan pl_ ids de TSA. Este resolver mapea nombre
// AF → pl_ id del roster TSA del equipo (misma lógica que pidxResolve del Mundial: match por nombre completo,
// luego por apellido con guarda de duplicados). Reusa el cache global._clubsSquad de /api/clubs/squad (24h).
async function clubRosterRows(teamId) {
  const tsaKey = process.env.THESTATSAPI_KEY || '';
  if (!tsaKey || !/^tm_[a-z0-9]+$/i.test(teamId)) return [];
  global._clubsSquad = global._clubsSquad || {};
  let sq = global._clubsSquad[teamId];
  if (!sq || Date.now() - sq.at > 24 * 3600e3) {
    try {
      const r = await fetch(`https://api.thestatsapi.com/api/football/teams/${teamId}/players?per_page=60`, { headers: { Authorization: `Bearer ${tsaKey}` }, signal: AbortSignal.timeout(15000) });
      const j = r.ok ? await r.json().catch(() => null) : null;
      const rows = (j && j.data) || j || [];
      sq = { at: Date.now(), rows: Array.isArray(rows) ? rows : [] };
      global._clubsSquad[teamId] = sq;
    } catch { sq = sq || { at: Date.now(), rows: [] }; }
  }
  return (sq && sq.rows) || [];
}
function clubRosterResolver(rows) {
  const full = {}, last = {}, dup = {};
  const add = (nm, pid) => { const n = normName(nm); if (n && !full[n]) full[n] = pid; };
  for (const p of (rows || [])) {
    if (!p || !p.id) continue;
    add(p.name, p.id); add(p.short_name, p.id);
    const parts = normName(p.name || p.short_name).split(/\s+/).filter(Boolean);
    const ln = parts[parts.length - 1];
    if (ln && ln.length >= 3) {
      if (last[ln] && last[ln] !== p.id) { dup[ln] = 1; delete last[ln]; }
      else if (!dup[ln]) last[ln] = p.id;
    }
  }
  return function (rawName) {
    if (!rawName) return null;
    const n = normName(rawName);
    if (full[n]) return full[n];
    const parts = n.split(/\s+/).filter(Boolean);
    const ln = parts[parts.length - 1];
    return (ln && last[ln]) || null;
  };
}
// Resuelve (y cachea 30 min) el fixture de API-Football del cruce de club por los af team ids del mapa: próximo
// entre ambos, o el más reciente. Compartido por /api/clubs/lineups y /api/clubs/match (eventos en vivo) → una
// sola resolución + cache para ambos. Devuelve { id, date, status, afH, afA, home_af } o null.
async function clubAfFixture(league, hId, aId) {
  const afk = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
  const afLg = CLUB_AF_LEAGUE[league], afMap = (global._clubAfMap || {})[league] || {};
  const afH = afMap[hId] && afMap[hId].af_id, afA = afMap[aId] && afMap[aId].af_id;
  if (!afk || !afLg || !afH || !afA) return null;
  global._clubAfFx = global._clubAfFx || {};
  const ck = league + '|' + hId + '|' + aId;
  let c = global._clubAfFx[ck];
  if (!c || Date.now() - c.at > 30 * 60e3) {
    c = { at: Date.now(), fx: null };
    try {
      const af = async (q) => { const r = await fetch('https://v3.football.api-sports.io' + q, { headers: { 'x-apisports-key': afk }, signal: AbortSignal.timeout(15000) }); const j = r.ok ? await r.json() : null; return (j && j.response) || []; };
      let fxs = await af(`/fixtures?team=${afH}&next=10`);
      let fx = fxs.find(x => x.teams && (x.teams.home.id === afA || x.teams.away.id === afA));
      if (!fx) { fxs = await af(`/fixtures?team=${afH}&last=10`); fx = fxs.find(x => x.teams && (x.teams.home.id === afA || x.teams.away.id === afA)); }
      if (fx) c.fx = { id: fx.fixture.id, date: fx.fixture.date, status: fx.fixture.status && fx.fixture.status.short, afH, afA, home_af: fx.teams.home.id };
    } catch { /* AF sin datos este ciclo */ }
    global._clubAfFx[ck] = c;
  }
  return c.fx;
}
// EVENTOS en vivo del cruce (F1.1b): goles/tarjetas/subs/VAR desde API-Football, normalizados al MISMO shape que
// el Mundial ({minute,type,player,assist,teamName,side}) para reusar el componente gx-event-i del cockpit. Memo
// ~30s por cruce (los eventos cambian en vivo). side por el home_af del fixture.
async function clubMatchEvents(league, hId, aId) {
  const fx = await clubAfFixture(league, hId, aId);
  if (!fx || !fx.id) return null;
  const afk = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
  global._clubEvents = global._clubEvents || {};
  const ck = league + '|' + hId + '|' + aId;
  let c = global._clubEvents[ck];
  if (!c || Date.now() - c.at > 30 * 1000) {
    c = { at: Date.now(), events: null };
    try {
      const r = await fetch(`https://v3.football.api-sports.io/fixtures/events?fixture=${fx.id}`, { headers: { 'x-apisports-key': afk }, signal: AbortSignal.timeout(15000) });
      const j = r.ok ? await r.json() : null; const resp = (j && j.response) || [];
      const mapType = (e) => {
        const ty = String(e.type || '').toLowerCase(), det = String(e.detail || '').toLowerCase();
        if (ty === 'goal') return 'goal';
        if (ty === 'card') return det.includes('red') ? 'red' : 'yellow';
        if (ty === 'subst') return 'subst';
        if (ty === 'var') return 'var';
        return 'other';
      };
      c.events = resp.map(e => ({
        minute: (e.time && e.time.elapsed != null) ? e.time.elapsed + ((e.time.extra) ? e.time.extra : 0) : null,
        type: mapType(e),
        player: (e.player && e.player.name) || null,
        assist: (e.assist && e.assist.name) || null, // gol: asistente · subst: entra
        teamName: (e.team && e.team.name) || null,
        side: (e.team && e.team.id === fx.home_af) ? 'home' : 'away',
      })).filter(e => e.minute != null || e.player);
    } catch { c.events = null; }
    global._clubEvents[ck] = c;
  }
  return c.events;
}
// STATS del partido en vivo (F1.1c): posesión/remates/córners/faltas de API-Football, normalizadas al MISMO
// shape que consume mvStats del Mundial ({home:{possession,shots,...},away:{...}}). Memo 60s (cambian en vivo).
async function clubMatchStats(league, hId, aId) {
  const fx = await clubAfFixture(league, hId, aId);
  if (!fx || !fx.id) return null;
  const afk = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
  global._clubStats = global._clubStats || {};
  const ck = league + '|' + hId + '|' + aId;
  let c = global._clubStats[ck];
  if (!c || Date.now() - c.at > 60 * 1000) {
    c = { at: Date.now(), stats: null };
    try {
      const r = await fetch(`https://v3.football.api-sports.io/fixtures/statistics?fixture=${fx.id}`, { headers: { 'x-apisports-key': afk }, signal: AbortSignal.timeout(15000) });
      const j = r.ok ? await r.json() : null; const resp = (j && j.response) || [];
      if (resp.length >= 2) {
        const MAP = { 'Ball Possession': 'possession', 'Total Shots': 'shots', 'Shots on Goal': 'shotsOnTarget', 'Corner Kicks': 'corners', 'Fouls': 'fouls', 'Offsides': 'offsides', 'Yellow Cards': 'yellowCards', 'Red Cards': 'redCards', 'expected_goals': 'xg' };
        const side = (afTeamId) => {
          const s = resp.find(x => x.team && x.team.id === afTeamId); if (!s) return null;
          const out = {};
          for (const st of (s.statistics || [])) { const k = MAP[st.type]; if (!k || st.value == null) continue; out[k] = typeof st.value === 'string' ? parseFloat(st.value) : st.value; }
          return Object.keys(out).length ? out : null;
        };
        const home = side(fx.afH), away = side(fx.afA);
        if (home || away) c.stats = { home, away };
      }
    } catch { c.stats = null; }
    global._clubStats[ck] = c;
  }
  return c.stats;
}
// xG OBSERVADO del partido (F1.3): agrega el player-history de la liga por equipo para el cruce recién jugado
// (mismo panel mvXg del Mundial). Solo si el match del backfill es de fecha cercana; aparece cuando el backfill
// de la liga se actualiza (regla: construir con la data disponible, se enriquece al llegar más).
function clubXgReport(league, hId, aId) {
  try {
    const raw = JSON.parse(fs.readFileSync(clubDataFile(`player-history-${league}.json`), 'utf8')).rows || [];
    const byMatch = {};
    for (const r of raw) { const m = byMatch[r.match] = byMatch[r.match] || { teams: new Set(), date: r.date, rows: [] }; m.teams.add(r.team); m.rows.push(r); }
    const cands = Object.values(byMatch).filter(m => m.teams.has(hId) && m.teams.has(aId)).sort((a, b) => (a.date < b.date ? 1 : -1));
    const m = cands[0]; if (!m) return null;
    const agg = (tid) => { let xg = 0, sh = 0, sot = 0; for (const r of m.rows) { if (r.team !== tid) continue; xg += Number(r.xg) || 0; sh += Number(r.shots) || 0; sot += Number(r.sot) || 0; } return { xg: +xg.toFixed(2), shots: sh, sot }; };
    const H = agg(hId), A = agg(aId);
    if (!H.shots && !A.shots) return null;
    return { available: true, date: m.date, xg: { home: H.xg, away: A.xg }, shots: { home: H.shots, away: A.shots }, sot: { home: H.sot, away: A.sot } };
  } catch { return null; }
}
// ===== FASE CLUBES F0.4: ELO DINÁMICO =====
// El ratings.json se fitea offline (base). Sin actualizar el Elo con cada resultado, la probabilidad DERIVA
// (exactamente lo que Alexis señaló). db.clubElos es un OVERLAY sobre el base: arranca del fit y se ajusta con
// cada partido que TRANSICIONA a final (nunca se escribe el archivo; el re-fit mensual resetea el overlay).
// Misma matemática del Mundial (winExpectancy logística + G por margen de gol) con K de liga doméstica y la
// localía (hfa) de cada liga en vez del HOME_BONUS del Mundial.
const CLUB_ELO_K = 30; // ligas domésticas (eloratings.net ~20-40); el Mundial usa 60
function clubBaseElo(lg, tid) {
  const RT = global._clubsRatings || {};
  const L = RT.leagues && RT.leagues[lg];
  return (L && L.ratings && L.ratings[tid] && L.ratings[tid].elo) || 1500;
}
function clubElo(lg, tid) {
  return (db.clubElos && db.clubElos[tid] != null) ? db.clubElos[tid] : clubBaseElo(lg, tid);
}
function applyClubElo(lg, hId, aId, hg, ag) {
  const RT = global._clubsRatings || {};
  const L = RT.leagues && RT.leagues[lg]; if (!L) return;
  db.clubElos = db.clubElos || {};
  const hfa = L.hfa || 60;
  const eH = clubElo(lg, hId), eA = clubElo(lg, aId);
  const we = 1 / (1 + Math.pow(10, -((eH + hfa) - eA) / 400)); // esperanza del local con su ventaja de cancha
  const W = hg > ag ? 1 : hg === ag ? 0.5 : 0;
  const margin = Math.abs(hg - ag);
  const G = margin <= 1 ? 1 : margin === 2 ? 1.5 : (11 + margin) / 8;
  const delta = CLUB_ELO_K * G * (W - we);
  db.clubElos[hId] = Math.round((eH + delta) * 10) / 10;
  db.clubElos[aId] = Math.round((eA - delta) * 10) / 10;
}
// resetea el overlay si el fit base cambió (nuevo ratings.json): el re-fit ya incorpora los resultados.
function clubEloReconcileFit() {
  const RT = global._clubsRatings || {};
  const fa = (RT._meta && RT._meta.fitted_at) || 'none';
  if (db.clubElosFitAt !== fa) { db.clubElos = {}; db.clubElosFitAt = fa; }
}
// FORMA reciente de ambos equipos + H2H directo del cruce, desde results-<liga>.json (memo). Reusa el mismo
// archivo que /api/clubs/team-form. Devuelve { home:[W/D/L de local], away:[...], h2h:[últimos directos] }.
function clubMatchForm(league, homeId, awayId) {
  global._clubsResults = global._clubsResults || {};
  if (!global._clubsResults[league]) {
    try { global._clubsResults[league] = JSON.parse(fs.readFileSync(clubDataFile(`results-${league}.json`), 'utf8')).rows || []; }
    catch { global._clubsResults[league] = []; }
  }
  const rows = global._clubsResults[league].filter(r => r.hg != null && r.ag != null);
  const formOf = (tid) => rows
    .filter(r => r.home_id === tid || r.away_id === tid)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5)
    .map(r => { const gf = r.home_id === tid ? r.hg : r.ag, ga = r.home_id === tid ? r.ag : r.hg; return gf > ga ? 'W' : gf < ga ? 'L' : 'D'; });
  const h2h = rows
    .filter(r => (r.home_id === homeId && r.away_id === awayId) || (r.home_id === awayId && r.away_id === homeId))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 5)
    .map(r => ({ date: r.date, hg: r.hg, ag: r.ag, home_id: r.home_id }));
  const home = formOf(homeId), away = formOf(awayId);
  if (!home.length && !away.length && !h2h.length) return null;
  return { home, away, h2h };
}
// F1.5: MERCADOS del cruce de clubes — mejor cuota por resultado (1X2) + O/U por línea, desde las cuotas que
// el sweep dejó en sportsbook_goal_quote_current (ids sintéticos por liga+par). Empareja el cruce (liga+ids) a
// su ceid buscando en db.clubsQuoteEvents el evento cuyos nombres resuelven a esos ids. Read-only.
async function clubMatchMarkets(league, homeId, awayId) {
  const dbc = require('./database/client'); if (!dbc.isConfigured()) return null;
  // hallar el ceid del cruce
  let ceid = null;
  for (const [id, m] of Object.entries(db.clubsQuoteEvents || {})) {
    if (m.league !== league) continue;
    const h = resolveClubId(league, m.home), a = resolveClubId(league, m.away);
    if ((h === homeId && a === awayId) || (h === awayId && a === homeId)) { ceid = id; break; }
  }
  if (!ceid) return null;
  const r = await dbc.query(
    `SELECT market_family, side, line, MAX(odds_decimal) AS best, (array_agg(sportsbook_code ORDER BY odds_decimal DESC))[1] AS book, COUNT(DISTINCT sportsbook_code) AS books
       FROM sportsbook_goal_quote_current
      WHERE data_provider='the_odds_api' AND canonical_event_id=$1
        AND market_family IN ('match_winner','match_total') AND coalesce(quote_status,'open')='open'
      GROUP BY market_family, side, line`, [ceid]).catch(() => ({ rows: [] }));
  const h2h = {}; const totalsMap = {};
  for (const row of r.rows) {
    if (row.market_family === 'match_winner') {
      if (['home', 'draw', 'away'].includes(row.side)) h2h[row.side] = { odds: +Number(row.best).toFixed(2), book: row.book, books: Number(row.books) };
    } else if (Number.isFinite(Number(row.line))) {
      const ln = Number(row.line); totalsMap[ln] = totalsMap[ln] || { line: ln };
      totalsMap[ln][row.side] = { odds: +Number(row.best).toFixed(2), book: row.book, books: Number(row.books) };
    }
  }
  const totals = Object.values(totalsMap).filter(t => t.over && t.under).sort((a, b) => a.line - b.line);
  if (!Object.keys(h2h).length && !totals.length) return null;
  return { h2h: Object.keys(h2h).length ? h2h : null, totals };
}
// resuelve un nombre de club a nuestro tm_ id dentro de una liga (índice normalizado cacheado por liga).
const _clubIdIdx = {};
function resolveClubId(league, name) {
  const RT = global._clubsRatings || {};
  const L = RT.leagues && RT.leagues[league]; if (!L) return null;
  if (!_clubIdIdx[league]) { _clubIdIdx[league] = {}; for (const [tid, tt] of Object.entries(L.ratings || {})) _clubIdIdx[league][clubNorm(tt.name)] = tid; }
  const idx = _clubIdIdx[league], n = clubNorm(name);
  if (idx[n]) return idx[n];
  for (const k in idx) { if (k && (k === n || k.includes(n) || n.includes(k))) return idx[k]; }
  return null;
}
let _clubScoresLast = 0, _clubScoresRunning = false, _clubScoresOut = null;
// FASE CLUBES F1.2: MOMENTUM GP en vivo. Misma mecánica que sampleMomentum del Mundial pero por cruce de liga:
// para cada partido de club EN JUEGO, prob GP condicionada al marcador+minuto (liveProbsFromLambdas con los λ
// del cruce = mismo engine). CERO llamadas externas: el marcador/minuto ya lo trajo clubScoresSync (ESPN) y los
// λ salen del Elo dinámico en memoria. Sin eventos (las rojas en vivo llegan con F1.1 eventos; el driver
// dominante es goles+minuto, igual que en el Mundial). Cada punto: {t,h,d,a,hg,ag,at}.
function sampleClubMomentum(RT) {
  db.clubMomentum = db.clubMomentum || {};
  for (const [key, r] of Object.entries(db.clubResults || {})) {
    if (!r || r.status !== 'live' || typeof r.minute !== 'number') continue;
    const L = RT.leagues && RT.leagues[r.league]; if (!L) continue;
    const rh = clubElo(r.league, r.home_id), ra = clubElo(r.league, r.away_id);
    const l = lambdas(rh + (L.hfa || 60), ra);
    let p; try { p = liveProbsFromLambdas(l[0], l[1], r.hg, r.ag, r.minute); } catch { continue; }
    if (!p) continue;
    const slot = db.clubMomentum[key] || (db.clubMomentum[key] = { league: r.league, home_id: r.home_id, away_id: r.away_id, points: [] });
    const last = slot.points[slot.points.length - 1];
    if (last && last.t === r.minute && last.hg === r.hg && last.ag === r.ag && Date.now() - (last.at || 0) < 60 * 1000) continue;
    slot.points.push({ t: r.minute, h: +p.home.toFixed(4), d: +p.draw.toFixed(4), a: +p.away.toFixed(4), hg: r.hg, ag: r.ag, at: Date.now() });
    if (slot.points.length > 400) slot.points = slot.points.slice(-400);
  }
  // poda: series de partidos que ya no están en clubResults (podados a las 3-6h) salen a las 12h
  for (const [k, s] of Object.entries(db.clubMomentum)) {
    const last = s.points && s.points[s.points.length - 1];
    if (!db.clubResults[k] && (!last || Date.now() - (last.at || 0) > 12 * 3600e3)) delete db.clubMomentum[k];
  }
}
async function clubScoresSync({ force = false } = {}) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.GP_CLUBS_SHADOW_ENABLED || '').trim())) return { skipped: 'off' };
  if (_clubScoresRunning) return { skipped: 'running' };
  if (!force && Date.now() - _clubScoresLast < 25 * 1000) return { skipped: 'throttle' };
  _clubScoresRunning = true;
  const out = { leagues: 0, live: 0, final: 0, changed: 0, started: new Date().toISOString() };
  try {
    if (!global._clubsRatings) {
      try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); }
      catch { global._clubsRatings = { leagues: {} }; }
    }
    const RT = global._clubsRatings;
    db.clubResults = db.clubResults || {};
    clubEloReconcileFit(); // F0.4: si el fit base cambió, resetear el overlay dinámico
    const fromD = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
    const toD = new Date(Date.now() + 1 * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
    let anyChange = false;
    for (const [lgKey, L] of Object.entries(RT.leagues || {})) {
      const code = CLUB_ESPN[lgKey]; if (!code || L.starts) continue; // pretemporada: sin partidos aún
      // índice nombre-normalizado → tm_id de la liga
      const idx = {};
      for (const [tid, t] of Object.entries(L.ratings || {})) idx[clubNorm(t.name)] = tid;
      const matchId = (name) => {
        const n = clubNorm(name);
        if (idx[n]) return idx[n];
        for (const k in idx) { if (k && (k === n || k.includes(n) || n.includes(k))) return idx[k]; }
        const ke = new Set(n.split(' ').filter(Boolean)); let best = null, bs = 0;
        for (const k in idx) { const kk = new Set(k.split(' ').filter(Boolean)); let ov = 0; ke.forEach(x => { if (kk.has(x)) ov++; }); const sc = ov / Math.max(1, new Set([...ke, ...kk]).size); if (ov >= 1 && sc >= 0.5 && ov > bs) { bs = ov; best = idx[k]; } }
        return best;
      };
      let events = null;
      try {
        const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard?dates=${fromD}-${toD}&limit=80`, { signal: AbortSignal.timeout(12000) });
        events = r.ok ? await r.json().catch(() => null) : null;
      } catch { /* liga sin datos este ciclo */ }
      if (!events || !Array.isArray(events.events)) continue;
      out.leagues++;
      for (const ev of events.events) {
        const c = ev.competitions && ev.competitions[0]; if (!c) continue;
        const state = ev.status && ev.status.type && ev.status.type.state; // pre|in|post
        if (state !== 'in' && state !== 'post') continue;
        const H = c.competitors.find(x => x.homeAway === 'home'), A = c.competitors.find(x => x.homeAway === 'away');
        if (!H || !A) continue;
        const hId = matchId(H.team.displayName) || matchId(H.team.name || ''), aId = matchId(A.team.displayName) || matchId(A.team.name || '');
        if (!hId || !aId || hId === aId) continue; // ambos deben matchear a ids distintos
        const hg = Number(H.score) || 0, ag = Number(A.score) || 0;
        const minute = parseInt(ev.status.displayClock) || (ev.status && ev.status.period ? 0 : 0);
        const hPen = H.shootoutScore != null ? Number(H.shootoutScore) : null, aPen = A.shootoutScore != null ? Number(A.shootoutScore) : null;
        const winner = H.winner ? hId : A.winner ? aId : null;
        const detail = (ev.status && ev.status.type && ev.status.type.detail) || '';
        const key = clubScoreKey(lgKey, hId, aId);
        const payload = { league: lgKey, home_id: hId, away_id: aId, hg, ag, status: state === 'post' ? 'final' : 'live', minute, at: Date.now() };
        if (state === 'post') { payload.winner = winner; if (hPen != null && aPen != null) { payload.hpen = hPen; payload.apen = aPen; } payload.detail = detail; }
        if (state === 'in') out.live++; else out.final++;
        const prev = db.clubResults[key];
        const same = prev && prev.status === payload.status && prev.hg === hg && prev.ag === ag && prev.minute === payload.minute && prev.winner === payload.winner;
        if (!same) {
          // F0.4: al TRANSICIONAR a final, actualizar el Elo dinámico (una sola vez por partido).
          const wasFinal = prev && prev.status === 'final';
          if (payload.status === 'final' && !wasFinal && !(prev && prev.elo_applied)) { applyClubElo(lgKey, hId, aId, hg, ag); payload.elo_applied = true; }
          else if (prev && prev.elo_applied) payload.elo_applied = true;
          db.clubResults[key] = payload; out.changed++; anyChange = true; console.log(`[clubs-score] ${lgKey} ${H.team.displayName} ${hg}-${ag} ${A.team.displayName} ${payload.status}${payload.status === 'live' ? ` ${minute}'` : ''}`);
        }
      }
    }
    // poda: resultados con más de 3h de finalizado (o sin refrescarse en 6h) salen
    for (const [k, r] of Object.entries(db.clubResults)) {
      const age = Date.now() - (r.at || 0);
      if ((r.status === 'final' && age > 3 * 3600e3) || age > 6 * 3600e3) delete db.clubResults[k];
    }
    try { sampleClubMomentum(RT); } catch { /* momentum no crítico */ } // F1.2: muestrea la prob GP en vivo de los partidos en juego
    try { if (anyChange) settleClubDailyPicks(); } catch { /* settle no crítico */ } // F3.3: liquida picks de clubes al llegar finales
    _clubScoresLast = Date.now();
    if (anyChange) { save(); broadcast('update', { reason: 'marcadores de clubes', ts: Date.now() }); }
  } catch (e) { out.error = e.message; }
  finally { _clubScoresRunning = false; out.finished = new Date().toISOString(); _clubScoresOut = out; }
  if (out.changed || out.error) console.log('[clubs] scores sync:', JSON.stringify({ leagues: out.leagues, live: out.live, final: out.final, changed: out.changed, error: out.error || null }));
  return out;
}
// FASE CLUBES F0.3: SNAPSHOT DIARIO de posición+Elo+pts por liga → serie temporal para la Evolución por liga
// (patrón renderEvo del Mundial). Con el Elo dinámico (F0.4) la serie tiene señal real cuando las ligas juegan.
// db.clubHistory[liga] = [{ d:'YYYY-MM-DD', teams:{ tm_id:{pos,elo,pts} } }], una entrada por día (dedupe),
// ventana 120 días. Barato: solo lee ratings + standings (sin APIs).
function clubHistorySnapshot() {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.GP_CLUBS_SHADOW_ENABLED || '').trim())) return;
  if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { return; } }
  const RT = global._clubsRatings; db.clubHistory = db.clubHistory || {};
  const d = new Date().toISOString().slice(0, 10);
  let touched = false;
  for (const [lg, L] of Object.entries(RT.leagues || {})) {
    if (L.starts) continue; // pretemporada: aún no hay tabla que evolucione
    const teams = {};
    const st = (L.standings || []);
    const posOf = {}; st.forEach((s, i) => { posOf[s.id] = i + 1; });
    for (const [tid, t] of Object.entries(L.ratings || {})) {
      teams[tid] = { elo: Math.round(clubElo(lg, tid)), pos: posOf[tid] || null, pts: (st.find(s => s.id === tid) || {}).pts ?? null };
    }
    const arr = db.clubHistory[lg] = db.clubHistory[lg] || [];
    const last = arr[arr.length - 1];
    if (last && last.d === d) { last.teams = teams; } // refresca el de hoy (el Elo pudo moverse)
    else arr.push({ d, teams });
    if (arr.length > 120) arr.splice(0, arr.length - 120);
    touched = true;
  }
  if (touched) save();
}
// Marcador REGLAMENTARIO (90') por par de equipos: grupo (goalGroupScore) o eliminatoria. Los mercados "a ganar"
// y O/U se liquidan a 90' (full-time), NO a prórroga — igual que las casas. Si el knockout fue a ET/penales
// (minute>90) se usa el snapshot de 90' (reg90For: dato manual verificado o captura del sync); sin ese dato
// devuelve null (se trata como VOID en settleDailyPicks, último recurso).
function regulationScoreFor(homeId, awayId) {
  const g = goalGroupScore(homeId, awayId);
  if (g) return g;
  for (const k of KNOCKOUT) {
    const r = db.results[String(k.m)];
    if (!r || r.status !== 'final' || typeof r.hg !== 'number' || !r.home) continue;
    if (!((r.home === homeId && r.away === awayId) || (r.home === awayId && r.away === homeId))) continue;
    if (Number(r.minute) > 90) {
      const s = reg90For(homeId, awayId);
      if (s && s.homeGoals != null && s.awayGoals != null) return { homeGoals: s.homeGoals, awayGoals: s.awayGoals };
      continue; // fue a prórroga/penales y no hay snapshot de 90' → VOID
    }
    if (r.home === homeId && r.away === awayId) return { homeGoals: r.hg, awayGoals: r.ag };
    return { homeGoals: r.ag, awayGoals: r.hg };
  }
  return null;
}
// ¿El partido ya terminó (cualquier resultado final, decidido como sea)? Para sacar del feed picks de partidos
// jugados que no se pueden liquidar a 90' (ET/penales) marcándolas VOID.
function matchFinalFor(homeId, awayId) {
  const g = goalGroupScore(homeId, awayId); if (g) return true;
  for (const k of KNOCKOUT) {
    const r = db.results[String(k.m)];
    if (!r || r.status !== 'final' || !r.home) continue;
    if ((r.home === homeId && r.away === awayId) || (r.home === awayId && r.away === homeId)) return true;
  }
  return false;
}
function settleDailyPicks() {
  const daily = require('./pick-engine/dailyPicks');
  let settled = 0;
  for (const p of db.dailyPicks) {
    if (p.status !== 'ACTIVE') continue;
    if (PROP_FAMS.includes(p.family)) continue; // CORNERS/CARDS/PLAYER se liquidan en settlePropsPicks (TSA)
    const sc = regulationScoreFor(p.event.home_team_id, p.event.away_team_id);
    if (sc) {
      p.result_code = daily.settleOne(p, sc);
      p.status = 'SETTLED'; p.settled_at = new Date().toISOString();
      settled++;
    } else if (matchFinalFor(p.event.home_team_id, p.event.away_team_id)) {
      // Partido jugado pero a ET/penales → sin 90' limpio: VOID (sale del feed, no cuenta en track record).
      p.result_code = 'VOID'; p.status = 'SETTLED'; p.settled_at = new Date().toISOString();
      settled++;
    }
  }
  if (settled) save();
  return settled;
}
// ── Cierre + CLV de picks diarias ───────────────────────────────────────────────────────────────────────────
// La serie de goal_value_shadow ya persiste consenso no-vig + mejor cuota por ciclo (20-75 min): la última
// evaluación ANTES del kickoff ES la línea de cierre. Idempotente (solo toca picks sin closing/clv), corre en
// el ciclo tras la liquidación y por endpoint retro (/api/internal/picks-clv). force=true recalcula todo.
async function captureDailyPicksClosing({ force = false } = {}) {
  const dbc = require('./database/client');
  if (!dbc.isConfigured()) return { skipped: 'db_off' };
  const metrics = require('./pick-engine/metrics');
  const now = Date.now();
  let captured = 0, clvSet = 0, misses = 0;
  for (const p of db.dailyPicks) {
    if (p.result_code === 'SUPERSEDED') continue;
    const ko = Date.parse((p.event && p.event.kickoff_at) || '');
    if (!isFinite(ko) || ko > now) continue; // el cierre existe recién cuando el partido arrancó
    if (!p.closing || force) {
      const specs = metrics.closingMarketIds(p);
      if (!specs) continue;
      const legs = []; let ok = true;
      for (const s of specs) {
        const r = await dbc.query(
          `SELECT market_consensus_probability AS fair, best_decimal_odds AS odds, created_at
             FROM goal_value_shadow
            WHERE canonical_event_id = $1 AND market_id = $2 AND created_at <= $3
            ORDER BY created_at DESC LIMIT 1`,
          [p.event.canonical_event_id, s.market_id, new Date(ko).toISOString()]
        ).catch(() => null);
        const row = r && r.rows && r.rows[0];
        if (!row || row.fair == null) { ok = false; break; }
        legs.push({ market_id: s.market_id, fair: Number(row.fair), odds: row.odds != null ? Number(row.odds) : null, at: row.created_at });
      }
      if (!ok) { misses++; continue; }
      const fair = legs.reduce((a, l) => a * l.fair, 1);
      const odds = legs.every(l => l.odds > 1) ? legs.reduce((a, l) => a * l.odds, 1) : null;
      p.closing = {
        fair_prob: +fair.toFixed(6), odds: odds != null ? +odds.toFixed(4) : null,
        at: legs[legs.length - 1].at, legs: legs.length > 1 ? legs : undefined,
      };
      captured++;
    }
    if (p.closing && (p.clv == null || force) && p.best_odds) {
      const c = metrics.computeClv(Number(p.best_odds), p.closing);
      if (c) { p.clv = c.clv_pct; p.clv_ev_pp = c.ev_close_pp; clvSet++; }
    }
  }
  if (captured || clvSet) save();
  return { captured, clv_set: clvSet, misses };
}
function dailyPicksQuant() {
  return require('./pick-engine/metrics').quantMetrics(db.dailyPicks || [], { experimentFams: EXPERIMENT_FAMS });
}

// ── NARRATIVA MULTI-FACTOR por pick (capa editorial, caja negra) ───────────────────────────────────────────
// Ensambla FACTORES desde style-engine (event data), balón parado curado, observer y player-intel, y los
// compone en 1-2 frases ES/EN por pick (pick-engine/narrative). Se calcula UNA vez por pick (estable) en el
// ciclo; el feed la serializa. Sin model% en el texto; sin fuentes; sin rayitas.
let _tournTeams = null;
function _teamNames(code) {
  if (!_tournTeams) { try { _tournTeams = {}; require('./data/tournament').TEAMS.forEach(t => { _tournTeams[t.id] = { es: t.name, en: t.en || t.name }; }); } catch { _tournTeams = {}; } }
  return _tournTeams[code] || { es: code, en: code };
}
function dailyPickNarrativeFactors(p) {
  const F = [];
  const S = styleFit() || {};
  const h = p.event.home_team_id, a = p.event.away_team_id;
  const H = S[h], A = S[a];
  const selCode = p.selection_code === 'home' ? h : p.selection_code === 'away' ? a : null;
  const selProf = selCode === h ? H : selCode === a ? A : null;
  const rivProf = selCode === h ? A : selCode === a ? H : null;
  const rivCode = selCode === h ? a : h;
  const nm = _teamNames, r1 = x => x != null ? +Number(x).toFixed(1) : null;
  const pctl = (prof, side, key) => prof && prof[side] && prof[side]._pct ? prof[side]._pct[key] : null;

  if (p.family === 'SOLID' && selProf) {
    if (p.books >= 10) F.push({ code: 'MARKET_ANCHOR', w: 3, books: p.books });
    if (p.model_prob != null && p.market_prob != null && p.model_prob > p.market_prob + 0.02) F.push({ code: 'MODEL_AGREES_UP', w: 2 });
    if (pctl(selProf, 'defense', 'xg_p90') != null && pctl(selProf, 'defense', 'xg_p90') <= 0.3)
      F.push({ code: 'SOLID_DEFENSE_BASE', w: 2.5, team_es: nm(selCode).es, team_en: nm(selCode).en, xga: r1(selProf.defense.xg_p90) });
    if (pctl(selProf, 'attack', 'xg_p90') >= 0.7 && pctl(rivProf, 'defense', 'xg_p90') >= 0.6)
      F.push({ code: 'GOALS_ATTACK_VS_LEAKY', w: 2.2, team_es: nm(selCode).es, team_en: nm(selCode).en, xg: r1(selProf.attack.xg_p90) });
  }
  if (p.family === 'GOALS' && H && A) {
    if (p.side === 'over') {
      if (pctl({ attack: H.attack }, 'attack', 'xg_p90') >= 0.5 && pctl({ attack: A.attack }, 'attack', 'xg_p90') >= 0.5)
        F.push({ code: 'GOALS_VOLUME_BOTH', w: 3, h: r1(H.attack.xg_p90), a: r1(A.attack.xg_p90) });
      for (const [tc, me, riv] of [[h, H, A], [a, A, H]]) {
        if (pctl(me, 'attack', 'xg_p90') >= 0.7 && pctl(riv, 'defense', 'xg_p90') >= 0.7)
          F.push({ code: 'GOALS_ATTACK_VS_LEAKY', w: 2.5, team_es: nm(tc).es, team_en: nm(tc).en, xg: r1(me.attack.xg_p90) });
        if (pctl(me, 'attack', 'fastbreak_share_xg') >= 0.7 && pctl(riv, 'defense', 'fastbreak_share_xg') >= 0.7)
          F.push({ code: 'COUNTER_GAME', w: 2, team_es: nm(tc).es, team_en: nm(tc).en });
      }
    } else if (pctl(H, 'defense', 'xg_p90') <= 0.35 && pctl(A, 'defense', 'xg_p90') <= 0.35) {
      F.push({ code: 'GOALS_DEFENSES_TIGHT', w: 3 });
    }
    if (Number(p.edge_pp) >= 3) F.push({ code: 'PRICE_ABOVE_FAIR', w: 1.5 });
  }
  if (p.family === 'CORNERS' && H && A) {
    // Backtest 10-jul (walk-forward n=44): el share de xG de córners correlaciona NEGATIVO con los córners
    // reales vs el modelo (r=-0.295) → la amenaza de córners es EFICIENCIA, no volumen. Para totales de
    // córners narra el VOLUMEN (córners por partido); el share queda para goles/aéreo donde sí aplica.
    const tot = (H.props && A.props) ? +(H.props.corners_for_p90 + A.props.corners_for_p90).toFixed(1) : null;
    if (p.side === 'over') {
      if (tot != null && tot >= 9.5) F.push({ code: 'CORNER_VOLUME', w: 3, total: tot });
    } else if (tot != null && tot <= 9) {
      F.push({ code: 'CORNER_LOW_VOLUME', w: 3, total: tot });
    }
    if (Number(p.edge_pp) >= 4) F.push({ code: 'PRICE_ABOVE_FAIR', w: 1.8 });
  }
  if (p.family === 'CARDS' && H && A && H.props && A.props) {
    const cards = +(H.props.cards_p90 + A.props.cards_p90).toFixed(1);
    const fouls = +(H.props.fouls_p90 + A.props.fouls_p90).toFixed(0);
    if (p.side === 'over') {
      if (cards >= 4) F.push({ code: 'CARDS_TEAMS_HOT', w: 3, total: cards, fouls });
      F.push({ code: 'PHASE_KO_CARDS', w: 1.5 });
    } else if (cards <= 4) {
      F.push({ code: 'CARDS_TEAMS_COLD', w: 3, total: cards });
    }
    if (Number(p.edge_pp) >= 5) F.push({ code: 'PRICE_ABOVE_FAIR', w: 1.8 });
  }
  if (p.family === 'PLAYER' && p.pid) {
    try {
      const PF = obsFit();
      const avail = observerAvailability();
      const starters = projectedStarters();
      const cxi = confirmedXiPids()[_xiPairKey(h, a)] || null;
      const pi = PF && require('./player-intel/engine').playerIntel(PF, p.pid, {
        projectedStarter: starters.size ? starters.has(p.pid) : null,
        confirmedStarter: cxi ? cxi.has(p.pid) : null,
        availability: avail[p.pid] || null,
        setPieceReasons: require('./player-intel/setPieces').reasonsFor(PF.players[p.pid] && PF.players[p.pid].team, p.player_name),
      });
      if (pi) {
        if (pi.reasons.includes('ROLE_STARTER_CONFIRMED')) F.push({ code: 'PLAYER_CONFIRMED', w: 3 });
        else if (pi.projection && pi.projection.minutes) F.push({ code: 'PLAYER_MINUTES', w: 2.5, minutes: Math.round(pi.projection.minutes) });
        if (pi.reasons.includes('RATES_ELITE')) F.push({ code: 'PLAYER_FORM', w: 2.2, elite: true });
        else if (pi.reasons.includes('RATES_ABOVE_POS')) F.push({ code: 'PLAYER_FORM', w: 2.2, elite: false });
        if (pi.reasons.includes('FINISHING_HOT')) F.push({ code: 'PLAYER_FINISHING_HOT', w: 1.8 });
        if (pi.reasons.includes('TEAM_ATTACK_UP')) F.push({ code: 'PLAYER_TEAM_ATTACK', w: 1.5 });
        if (pi.reasons.includes('AVAIL_DOUBT')) F.push({ code: 'AVAIL_CAVEAT', w: 0, name: p.player_name });
        const spr = require('./player-intel/setPieces').rolesFor(pi.team, p.player_name);
        if (spr) {
          const roles = [], rolesEn = [];
          const strong = x => x && (x.rank === 1 || (x.rank === 2 && x.confidence === 'alta'));
          if (strong(spr.penalties)) { roles.push('los penales'); rolesEn.push('penalties'); }
          if (strong(spr.freekicks)) { roles.push('los tiros libres'); rolesEn.push('free kicks'); }
          if (strong(spr.corners)) { roles.push('los córners'); rolesEn.push('corners'); }
          if (roles.length) F.push({ code: 'PLAYER_SET_PIECE', w: 2, roles, rolesEn });
        }
        // Debilidad aérea del rival (solo mercado de gol) y bajas defensivas rivales corroboradas
        const myTeam = pi.team, rival = myTeam === h ? a : h;
        const rp = S[rival];
        if (p.player_family === 'player_goal' && pctl(rp, 'defense', 'header_share') >= 0.7)
          F.push({ code: 'RIVAL_DEFENSE_WEAK_AIR', w: 1.6, rival_es: nm(rival).es, rival_en: nm(rival).en });
        if (PF) {
          for (const [pid2, av] of Object.entries(avail)) {
            const pl2 = PF.players[pid2];
            if (pl2 && pl2.team === rival && pl2.pos === 'D' && (av.status === 'OUT' || av.status === 'SUSPENDED') && av.corroborated !== false) {
              F.push({ code: 'RIVAL_ABSENCE_DEF', w: 2, name: pl2.name });
              break;
            }
          }
        }
      }
    } catch { /* narrativa de jugador opcional */ }
  }
  if (p.family === 'COMBO' && H && A) {
    if (p.books >= 10) F.push({ code: 'MARKET_ANCHOR', w: 3, books: p.books });
    if (pctl({ attack: H.attack }, 'attack', 'xg_p90') >= 0.5 && pctl({ attack: A.attack }, 'attack', 'xg_p90') >= 0.5)
      F.push({ code: 'GOALS_VOLUME_BOTH', w: 2.5, h: r1(H.attack.xg_p90), a: r1(A.attack.xg_p90) });
  }
  return F;
}
function annotateDailyPicksNarrative({ force = false } = {}) {
  const narrative = require('./pick-engine/narrative');
  let annotated = 0;
  for (const p of db.dailyPicks) {
    if (p.status !== 'ACTIVE' || p.result_code === 'SUPERSEDED') continue;
    if (p.why_es && !force) continue;
    try {
      const txt = narrative.compose(dailyPickNarrativeFactors(p));
      if (txt) { p.why_es = txt.es; p.why_en = txt.en; annotated++; }
    } catch { /* siguiente */ }
  }
  if (annotated) save();
  return { annotated };
}

// ── Movimiento de línea de picks ACTIVAS (line-intel, SHADOW/informativo) ──────────────────────────────────
// Para cada pick activa con kickoff futuro: consenso actual del mercado vs la prob de mercado al PUBLICAR
// (ya guardada en la pick) → p.line_move {pp, direction, now, at}. Corre en el ciclo; el feed lo serializa.
// NO gatea nada (regla: backtest antes de tocar gates).
async function updateDailyPicksLineIntel() {
  const dbc = require('./database/client');
  if (!dbc.isConfigured()) return { skipped: 'db_off' };
  const metrics = require('./pick-engine/metrics');
  const lineIntel = require('./line-intel/engine');
  const now = Date.now();
  let updated = 0;
  for (const p of db.dailyPicks) {
    if (p.status !== 'ACTIVE' || p.result_code === 'SUPERSEDED') continue;
    const ko = Date.parse((p.event && p.event.kickoff_at) || '');
    if (!isFinite(ko) || ko <= now) continue; // arrancado el partido, el cierre manda (captureDailyPicksClosing)
    if (p.market_prob == null) continue;      // sin baseline de publicación (COMBO) no hay señal honesta
    const specs = metrics.closingMarketIds(p);
    if (!specs || specs.length !== 1) continue;
    const r = await dbc.query(
      `SELECT market_consensus_probability AS fair, created_at
         FROM goal_value_shadow
        WHERE canonical_event_id = $1 AND market_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [p.event.canonical_event_id, specs[0].market_id]
    ).catch(() => null);
    const row = r && r.rows && r.rows[0];
    if (!row || row.fair == null) continue;
    const mv = lineIntel.moveForPick(Number(p.market_prob), Number(row.fair));
    if (!mv) continue;
    p.line_move = { pp: mv.pp, direction: mv.direction, now: +Number(row.fair).toFixed(4), at: row.created_at };
    updated++;
  }
  if (updated) save();
  return { updated };
}

// Track record (solo admin): acierto y rendimiento por familia sobre picks liquidadas. NO se expone al usuario.
function dailyPicksTrackRecord(list) {
  // Las familias EXPERIMENTO (decisión Alexis 8-jul) se liquidan y se observan, pero NO cuentan en el
  // track record oficial: el modelo de jugador asume titularidad para todos → edges inflados, en revisión.
  // `list` (opcional): permite computar el record sobre un set combinado (Mundial + clubes públicas =
  // CONTINUACIÓN post-Mundial 20-jul). Sin arg → db.dailyPicks (comportamiento original intacto).
  const picks = list || db.dailyPicks;
  const fam = {}, exp = {};
  let n = 0, wins = 0, stake = 0, ret = 0;
  for (const p of picks) {
    if (p.status !== 'SETTLED' || p.result_code === 'PUSH' || p.result_code === 'VOID' || p.result_code === 'SUPERSEDED') continue;
    const isExp = EXPERIMENT_FAMS.includes(p.family);
    const f = (isExp ? exp : fam)[p.family] || ((isExp ? exp : fam)[p.family] = { n: 0, w: 0, stake: 0, ret: 0 });
    const won = p.result_code === 'WIN';
    f.n++; f.stake += 1;
    if (won) { f.w++; f.ret += Number(p.best_odds || 0); }
    if (!isExp) { n++; stake += 1; if (won) { wins++; ret += Number(p.best_odds || 0); } }
  }
  const fmt = o => ({ n: o.n, wins: o.w, hit_rate: o.n ? +(o.w / o.n).toFixed(4) : null, roi_pct: o.stake ? +(((o.ret - o.stake) / o.stake) * 100).toFixed(1) : null });
  return {
    overall: { settled: n, wins, hit_rate: n ? +(wins / n).toFixed(4) : null, roi_pct: stake ? +(((ret - stake) / stake) * 100).toFixed(1) : null, pnl_u: +(ret - stake).toFixed(2) },
    by_family: Object.fromEntries(Object.entries(fam).map(([k, v]) => [k, fmt(v)])),
    experiment: Object.fromEntries(Object.entries(exp).map(([k, v]) => [k, fmt(v)])),
    active: picks.filter(p => p.status === 'ACTIVE').length,
  };
}
// Picks de clubes PÚBLICAS (post-Mundial 20-jul): CONTINUACIÓN del Mundial. Reglas (corrección Alexis 20-jul):
//  (1) regime !== 'monitor' = excluye el edge de goles y los props privados (viven solo en el monitoreo admin).
//  (2) CUTOFF DE LIQUIDACIÓN: las de clubes VIEJAS ya monitoreadas se QUEDAN en el shadow; solo las que se
//      LIQUIDEN desde el lanzamiento (settled_at >= CLUBS_CONTINUATION_START) suben al historial público. Las
//      ACTIVE siguen (cerrarán de este lado). Mismo shape que db.dailyPicks (event.home_team_id = tm_ → escudo).
const CLUBS_CONTINUATION_START = Date.parse('2026-07-20T00:00:00Z');
function clubPublicPicks({ isAdmin = false, hideProps = false } = {}) {
  return (db.clubDailyPicks || [])
    .filter(x => x.regime !== 'monitor')
    .filter(x => !hideProps || PROP_FAMS.indexOf(x.family) < 0)
    .filter(x => isAdmin || EXPERIMENT_FAMS.indexOf(x.family) < 0)
    .filter(x => x.status !== 'SETTLED' || Date.parse(x.settled_at || 0) >= CLUBS_CONTINUATION_START);
}

// STOP-LOSS ROLLING (23-jul, gobernanza automática): si una familia cae por debajo de su break-even en sus
// últimas 30 liquidadas PÚBLICAS, sale sola del FEED (las activas dejan de mostrarse) hasta que la ventana se
// recupere. El historial del cuadro NO se toca (es inmutable). Solo cuenta lo que HOY sería público: SOLID/GOALS
// ancla, córners/tarjetas todas. Requiere ventana llena (≥30) → dormant hasta acumular muestra bajo las reglas
// nuevas. Break-even = 1/cuota media (a la cuota típica de la familia, el hit mínimo para no perder).
function clubFamilyStopped() {
  const inPublic = (p) => (p.family === 'SOLID' || p.family === 'GOALS') ? p.regime === 'anchor' : (p.family === 'CORNERS' || p.family === 'CARDS');
  const byFam = {};
  const settled = (db.clubDailyPicks || [])
    .filter(p => p.status === 'SETTLED' && (p.result_code === 'WIN' || p.result_code === 'LOSS') && inPublic(p))
    .sort((a, b) => new Date(b.settled_at || 0) - new Date(a.settled_at || 0));
  for (const p of settled) (byFam[p.family] = byFam[p.family] || []).push(p);
  const stopped = new Set();
  for (const [fam, list] of Object.entries(byFam)) {
    const w = list.slice(0, 30);
    if (w.length < 30) continue; // sin muestra suficiente → no se frena
    let wins = 0, oddsSum = 0;
    w.forEach(p => { if (p.result_code === 'WIN') wins++; oddsSum += Number(p.best_odds) || 0; });
    const hit = wins / w.length, avgOdds = oddsSum / w.length, breakEven = avgOdds > 1 ? 1 / avgOdds : 1;
    if (hit < breakEven) stopped.add(fam);
  }
  return stopped;
}

// ===== CAPA DE OBSERVACIÓN de jugadores (6-jul, SHADOW) ======================================================
// Captura lo PUBLICADO (Google News RSS por equipo VIVO, EN+ES) → señales de disponibilidad por jugador
// (lesión/enfermedad/duda/sanción/descanso/vuelta) → evaluación con prob de ausencia + factor λ sugerido
// (prop-engine/lineupAdjust). TODO SHADOW: db.observations + endpoint admin. NO toca el modelo oficial —
// la aplicación al modelo se cablea recién cuando se encienda la capa de props (post The Odds API 100k).
// Flag: GP_OBSERVER_ENABLED (default off). Cadencia educada: cada 3h por equipo vivo (≤8 en eliminatorias).
function observerOn() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_OBSERVER_ENABLED || '')); }
let _obsRunning = false, _obsLast = null, _obsRoster = null, _obsFit = null;
function obsRoster() {
  if (_obsRoster) return _obsRoster;
  _obsRoster = {};
  try {
    const hist = require('./data/player-props-history.json');
    for (const m of hist.matches) for (const p of m.players) {
      const t = _obsRoster[p.team] || (_obsRoster[p.team] = {});
      t[p.pid] = { pid: p.pid, name: p.name };
    }
    for (const t in _obsRoster) _obsRoster[t] = Object.values(_obsRoster[t]);
  } catch { _obsRoster = {}; }
  return _obsRoster;
}
function obsFit() {
  if (_obsFit) return _obsFit;
  try { _obsFit = require('./prop-engine/players').fitPlayers(require('./data/player-props-history.json').matches); }
  catch { _obsFit = null; }
  return _obsFit;
}

// ===== STYLE ENGINE (event data FotMob + props API-Football) =================================================
// Perfil táctico por equipo (balón parado/córners/aéreo/contragolpe/zonas/volumen, ataque Y defensa) desde
// los shotmaps con situación. Baseline del torneo en data/fotmob-events.json (repo) + incremental db.fotmob
// (partidos que terminan post-deploy, recolectados por fotmobSweep cada 6h). SHADOW para modelos: alimenta
// Match Intel y narrativa, NO toca gates. Kill switch: GP_FOTMOB_ENABLED=false apaga la recolección.
function fotmobOn() { return !/^(0|false|no|off)$/i.test(String(process.env.GP_FOTMOB_ENABLED || 'true').trim()); }
let _styleFit = null, _styleFitStamp = '';
function styleFit() {
  const stamp = String((db.fotmob.matches || []).length);
  if (_styleFit && _styleFitStamp === stamp) return _styleFit;
  try {
    let base = [];
    try { base = require('./data/fotmob-events.json').matches || []; } catch { /* sin baseline */ }
    const seen = new Set(base.map(m => m.matchId));
    const extra = (db.fotmob.matches || []).filter(m => !seen.has(m.matchId));
    let props = null;
    try { props = require('./data/props-history.json').matches; } catch { /* opcional */ }
    _styleFit = require('./style-engine/profile').fitStyles(base.concat(extra), props);
    _styleFitStamp = stamp;
  } catch { _styleFit = null; }
  return _styleFit;
}
// Perfil AÉREO por jugador desde el event data (share de remates de cabeza): alimenta el eje aéreo del
// radar y el arquetipo AMENAZA AÉREA. Memo por conteo de partidos (baseline + incremental).
let _playerAerial = null, _playerAerialStamp = '';
const _aerialNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
function playerAerial(name) {
  const stamp = String((db.fotmob.matches || []).length);
  if (!_playerAerial || _playerAerialStamp !== stamp) {
    _playerAerial = {};
    try {
      let base = [];
      try { base = require('./data/fotmob-events.json').matches || []; } catch { /* sin baseline */ }
      const seen = new Set(base.map(m => m.matchId));
      const all = base.concat((db.fotmob.matches || []).filter(m => !seen.has(m.matchId)));
      for (const m of all) for (const s of (m.shots || [])) {
        if (!s.player) continue;
        const k = _aerialNorm(s.player);
        const row = _playerAerial[k] = _playerAerial[k] || { shots: 0, headers: 0 };
        row.shots++; if (s.shot_type === 'Header') row.headers++;
      }
      _playerAerialStamp = stamp;
    } catch { _playerAerial = {}; }
  }
  if (!name) return null;
  const k = _aerialNorm(name);
  if (_playerAerial[k]) return _playerAerial[k];
  // fallback por apellido único (FotMob a veces usa forma corta del nombre)
  const last = k.split(' ').pop();
  if (last && last.length >= 4) {
    const hits = Object.keys(_playerAerial).filter(x => x.endsWith(' ' + last) || x === last);
    if (hits.length === 1) return _playerAerial[hits[0]];
  }
  return null;
}

let _fotmobSweeping = false;
async function fotmobSweep() {
  if (!fotmobOn() || _fotmobSweeping) return { skipped: true };
  _fotmobSweeping = true;
  try {
    const fotmob = require('./data-providers/fotmob');
    let baseIds = new Set();
    try { baseIds = new Set((require('./data/fotmob-events.json').matches || []).map(m => m.matchId)); } catch { /* sin baseline */ }
    const haveIds = new Set((db.fotmob.matches || []).map(m => m.matchId));
    const days = [0, 1].map(d => new Date(Date.now() - d * 86400e3).toISOString().slice(0, 10).replace(/-/g, ''));
    let added = 0;
    for (const date of days) {
      const list = await fotmob.matchesByDate(date).catch(() => []);
      for (const m of list) {
        if (!m.finished || baseIds.has(m.matchId) || haveIds.has(m.matchId)) continue;
        const ev = await fotmob.matchEvents(m.matchId).catch(() => null);
        if (!ev || !ev.shots.length) continue;
        ev.date = date;
        db.fotmob.matches.push(ev); haveIds.add(m.matchId); added++;
      }
    }
    if (added) { save(); console.log(`[fotmob] +${added} partidos con event data (total incremental ${db.fotmob.matches.length})`); }
    return { added };
  } catch (e) { return { error: e.message }; }
  finally { _fotmobSweeping = false; }
}
// Once PROYECTADO por equipo (mismo criterio que Match Intel/projectTeam: los 11 con más titularidades,
// desempate por minutos). Gate de las picks de jugador: proyectar como titular a cualquier cotizado era el
// bug del caso Doué (edges inflados con suplentes). Cache simple; el dataset cambia 1 vez por jornada.
let _projStarters = null, _projStartersAt = 0;
function projectedStarters() {
  if (_projStarters && Date.now() - _projStartersAt < 60 * 60 * 1000) return _projStarters;
  const out = new Set();
  const fit = obsFit();
  if (fit) {
    // INTERCONEXIÓN observer→once (8-jul): un OUT/SUSPENDED corroborado (o prob_miss alta) SALE del once
    // proyectado y su lugar lo toma el siguiente por titularidades — antes Onana (rotura de ligamentos,
    // confirmado) seguía en el XI proyectado de Bélgica porque la proyección era 100% histórica.
    const avail = observerAvailability();
    const excluded = pid => {
      const a = avail[pid]; if (!a) return false;
      if ((a.status === 'OUT' || a.status === 'SUSPENDED') && a.corroborated) return true;
      return a.prob_miss >= 0.6;
    };
    const byTeam = {};
    for (const p of Object.values(fit.players)) (byTeam[p.team] = byTeam[p.team] || []).push(p);
    for (const t in byTeam) {
      byTeam[t].sort((a, b) => (b.starts - a.starts) || (b.minutes - a.minutes))
        .filter(p => !excluded(p.pid))
        .slice(0, 11).forEach(p => out.add(p.pid));
    }
  }
  _projStarters = out; _projStartersAt = Date.now();
  return out;
}
function obsAliveTeams() {
  const bracket = resolveRealBracket();
  const alive = new Set();
  for (const k of KNOCKOUT) {
    const res = bracket[k.m], r = db.results[String(k.m)];
    if (res && res.home && res.away && (!r || r.status !== 'final')) { alive.add(res.home); alive.add(res.away); }
  }
  return [...alive];
}
async function runObserver() {
  if (!observerOn()) return { skipped: 'disabled' };
  if (_obsRunning) return { skipped: 'running' };
  _obsRunning = true;
  const out = { teams: 0, items: 0, signals: 0, errors: 0, started: new Date().toISOString() };
  try {
    const sources = require('./observer/sources');
    const { extract } = require('./observer/extract');
    const { verifyArticle } = require('./observer/verify');
    const roster = obsRoster();
    const teamName = code => { const t = TEAMS.find(x => x.id === code); return t ? { en: t.en || t.name, es: t.name || t.en } : { en: code, es: code }; };
    for (const code of obsAliveTeams()) {
      out.teams++;
      const tn = teamName(code);
      const slot = db.observations[code] || (db.observations[code] = { signals: [] });
      const seen = new Set(slot.signals.map(s => s.title));
      for (const q of sources.teamQueries(tn.en, tn.es)) {
        let items = [];
        try { items = await sources.googleNewsRss(q.q, q.lang); }
        catch (e) { out.errors++; continue; }
        out.items += items.length;
        for (const it of items) {
          if (!it.title || seen.has(it.title)) continue;
          const sigs = extract(it, { team: code, roster: roster[code] || [] });
          if (!sigs.length) continue;
          // PUNTO 2 roadmap: VERIFICACIÓN ANTI-CLICKBAIT. Para señales negativas con jugador identificado,
          // se intenta leer el CUERPO del artículo: si lo contradice (desenlace positivo) la señal se
          // DESCARTA antes de guardarse; si lo confirma queda body_check='confirmed'. Presupuesto acotado
          // por pasada (educado con las fuentes); sin lectura posible → la señal vive igual (la
          // corroboración multi-fuente y la alineación confirmada son las otras redes).
          const kept = [];
          for (const s of sigs) {
            const negative = s.category === 'OUT' || s.category === 'SUSPENDED' || s.category === 'DOUBT';
            if (negative && s.pid && (out.verified_fetches || 0) < 12) {
              out.verified_fetches = (out.verified_fetches || 0) + 1;
              const v = await verifyArticle(s, { extract, roster: roster[code] || [], team: code }).catch(() => ({ status: 'unavailable' }));
              if (v.status === 'contradicted') { out.contradicted = (out.contradicted || 0) + 1; console.log('[observer] señal descartada por cuerpo del artículo:', s.player, s.category, '"' + String(s.title).slice(0, 80) + '"'); continue; }
              if (v.status === 'confirmed') { s.body_check = 'confirmed'; out.body_confirmed = (out.body_confirmed || 0) + 1; }
            }
            kept.push(s);
          }
          if (kept.length) { slot.signals.push(...kept); kept.forEach(s => seen.add(s.title)); out.signals += kept.length; }
        }
        await new Promise(r => setTimeout(r, 1200)); // educado con la fuente
      }
      if (slot.signals.length > 120) slot.signals = slot.signals.slice(-120); // ring por equipo
      slot.fetched_at = new Date().toISOString();
    }
    if (out.signals) save();
  } catch (e) { out.error = e.message; }
  finally { _obsRunning = false; out.finished = new Date().toISOString(); _obsLast = out; if (out.signals || out.error) console.log('[observer]', JSON.stringify(out)); }
  return out;
}
// Saneo al boot: re-valida las señales GUARDADAS con las reglas de extracción vigentes. Sin esto, un falso
// positivo persiste en el ring ~días por el decaimiento (36h半vida) aunque el extractor ya esté arreglado —
// caso real 8-jul: Messi quedó SUSPENDED por "estuvo bien sancionado el penal" y bloqueaba su pick.
// Solo re-valida señales cuyo keyword vive en el TITULAR (las de description no son re-evaluables acá).
function sanitizeObservations() {
  try {
    const { extract } = require('./observer/extract');
    const roster = obsRoster();
    const normS = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    let dropped = 0;
    for (const code of Object.keys(db.observations || {})) {
      const slot = db.observations[code]; if (!slot || !Array.isArray(slot.signals)) continue;
      slot.signals = slot.signals.filter(s => {
        if (!s || !s.title) return false;
        if (s.keyword && !normS(s.title).includes(normS(s.keyword))) return true; // matcheó en la descripción → conservar
        const re = extract({ title: s.title, description: '' }, { team: code, roster: roster[code] || [] });
        const ok = re.some(x => x.category === s.category && (x.pid || null) === (s.pid || null));
        if (!ok) dropped++;
        return ok;
      });
    }
    if (dropped) { save(); console.log('[observer] saneo con reglas nuevas: ' + dropped + ' señales descartadas'); }
    return dropped;
  } catch (e) { console.log('[observer] saneo error', e.message); return 0; }
}
if (observerOn()) {
  setTimeout(() => { sanitizeObservations(); runObserver().catch(() => { }); }, 90 * 1000);
  setInterval(() => runObserver().catch(() => { }), 3 * 3600 * 1000);
}
// F2.3: observer de clubes (mismo pipeline, gated GP_CLUBS_SHADOW_ENABLED + GP_OBSERVER_ENABLED). Cadencia 3h.
if (observerOn() && clubsShadowOn()) {
  setTimeout(() => { runClubObserver().catch(() => { }); }, 150 * 1000);
  setInterval(() => runClubObserver().catch(() => { }), 3 * 3600 * 1000);
}

// ===== MOMENTUM GP en vivo (7-jul) ==========================================================================
// Muestrea la probabilidad GP en vivo de cada partido EN JUEGO cada ~30s y la persiste (db.momentum) para el
// gráfico de evolución del cockpit (en vivo y post-partido) y para contenido. CERO llamadas externas nuevas:
// usa el marcador/minuto de db.results (sync ESPN 30s ya existente) + el xG del modelo en cache (buildH2HDeep
// se cachea al primer uso; los loops NORMAL lo mantienen caliente en ventana de partido). Sin eventos (las
// rojas ajustan el gpLive del cockpit pero no esta serie; el driver dominante son goles+minuto).
// Cada punto: { t: minuto, h/d/a: prob GP, hg/ag: marcador } → el cliente marca goles donde cambia el marcador.
async function sampleMomentum() {
  for (const id in db.results) {
    const r = db.results[id];
    if (!r || r.status !== 'live' || typeof r.minute !== 'number') continue;
    const meta = findFixtureMeta(id);
    if (!meta || !meta.home || !meta.away) continue;
    let p = null;
    try { p = await liveGpProbs(meta.home, meta.away, r, [], { allowCompute: true }); } catch { /* noop */ }
    if (!p) continue;
    const slot = db.momentum[String(id)] || (db.momentum[String(id)] = { home: meta.home, away: meta.away, points: [] });
    const last = slot.points[slot.points.length - 1];
    // nuevo punto si avanzó el minuto, cambió el marcador o pasaron 60s (prórroga: minute puede quedarse en 90+)
    if (last && last.t === r.minute && last.hg === r.hg && last.ag === r.ag && Date.now() - (last.at || 0) < 60 * 1000) continue;
    slot.points.push({ t: r.minute, h: +p.home.toFixed(4), d: +p.draw.toFixed(4), a: +p.away.toFixed(4), hg: r.hg, ag: r.ag, at: Date.now() });
    if (slot.points.length > 400) slot.points = slot.points.slice(-400);
    save();
  }
}
setInterval(() => sampleMomentum().catch(() => { }), 30 * 1000);

// ===== CANÓNICOS AUTOMÁTICOS (7-jul, pedido de Alexis: fin de la aprobación manual) ========================
// Cada hora: generateCandidates (lee sportsbook_quote_current, CERO llamadas externas) + auto-aprobación de
// los candidatos PERFECTOS (validación completa; lo dudoso queda en cola manual). Así los cruces nuevos
// (QF/SF/Final y post-Mundial la cartelera) entran solos al grafo canónico → Value evalúa y las picks SOLID
// nacen canónicas (clickeables) sin intervención. Kill switch: GP_CANONICAL_AUTO_APPROVE=false.
function canonicalAutoOn() { return !/^(0|false|no|off)$/i.test(String(process.env.GP_CANONICAL_AUTO_APPROVE || 'true').trim()); }
async function runCanonicalAuto() {
  if (!canonicalAutoOn()) return { skipped: 'disabled' };
  try {
    const dbcfg = require('./database/config');
    if (!dbcfg.db || !dbcfg.db.configured) return { skipped: 'no_db' };
    const sc = require('./sportsbook-providers/sportsbookCanonical');
    await sc.seedParticipants().catch(() => { });
    const gen = await sc.generateCandidates('the_odds_api');
    const app = await sc.autoApprovePerfectCandidates();
    if (app.approved || app.errors) console.log('[canonical-auto]', JSON.stringify({ candidates: gen.candidates, approved: app.approved, left_for_review: app.left_for_review, errors: app.errors, events: app.events }));
    return { gen, app };
  } catch (e) { console.error('[canonical-auto]', e.message); return { error: e.message }; }
}
if (canonicalAutoOn()) {
  setTimeout(() => runCanonicalAuto().catch(() => { }), 2 * 60 * 1000);
  setInterval(() => runCanonicalAuto().catch(() => { }), 60 * 60 * 1000);
  // Event data FotMob: barrido incremental de partidos terminados (2 fechas, ~2-6 req/pasada, educado).
  setTimeout(() => fotmobSweep().catch(() => { }), 3 * 60 * 1000);
  setInterval(() => fotmobSweep().catch(() => { }), 6 * 3600 * 1000);
}

// ===== PROPS (7-jul): córners/tarjetas/jugador END-TO-END =====================================================
// Ingesta de cuotas (The Odds API por evento, con guard de créditos) → value contra el prop-engine calibrado
// (backtest LOO approved) → picks CORNERS/CARDS/PLAYER (gates en pick-engine/curate) → settlement vía
// TheStatsAPI. Familias VISIBLES SOLO PARA ADMIN hasta GP_PROPS_PICKS_PUBLIC=true (aprobación de Alexis).
function propsOn() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_PROPS_ENABLED || '')); }
function propsPicksPublic() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_PROPS_PICKS_PUBLIC || '')); }
// LAYOUT del board (10-jul, feedback pwnlord69): agrupar las picks en SECCIONES por partido con el pick del
// día como hero arriba. Admin-first: el admin lo ve ya; GP_PICKS_SECTIONS_PUBLIC=true lo abre a todos.
function picksSectionsPublic() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_PICKS_SECTIONS_PUBLIC || '')); }

// CONTADOR REAL de cupos founder: membresías vigentes en Whop sobre los 4 planes founder (memo 5 min).
// "Primeros 100" = 100 cupos TOTALES entre todos los planes. Fallback null (la página muestra 100/100).
let _founderSpots = { at: 0, left: null };
async function whopFounderSpotsLeft() {
  if (Date.now() - _founderSpots.at < 5 * 60e3 && _founderSpots.left != null) return _founderSpots.left;
  const key = process.env.WHOP_API_KEY;
  const ids = String(process.env.WHOP_FOUNDER_PLAN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!key || !ids.length) return null;
  try {
    let sold = 0;
    for (const pid of ids) {
      const r = await fetch(`https://api.whop.com/api/v2/memberships?plan_id=${encodeURIComponent(pid)}&per=100`, {
        headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(8000),
      });
      const j = r.ok ? await r.json() : null;
      sold += ((j && j.data) || []).filter(m => m.valid === true || ['active', 'trialing', 'completed', 'past_due'].includes(m.status)).length;
    }
    _founderSpots = { at: Date.now(), left: Math.max(0, 100 - sold) };
  } catch { _founderSpots.at = Date.now(); /* conserva el último valor conocido */ }
  return _founderSpots.left;
}
// Idioma por DEFECTO del primer ingreso (visitante sin preferencia guardada). El cliente lo lee de
// window.__GPDL. 8-jul: 'en' para el test de ads en África (la landing en español disparaba leads que
// no entendían y no entraban). Valores: 'en' | 'es' | 'auto' (auto = según el navegador, comportamiento
// viejo). Revertir el test = GP_DEFAULT_LANG=auto (o 'es') en Render + Manual Deploy. NO afecta a quien ya
// eligió idioma (preferencia guardada gana) ni al toggle ES/EN.
function defaultLang() { const v = String(process.env.GP_DEFAULT_LANG || 'en').toLowerCase(); return (v === 'es' || v === 'auto') ? v : 'en'; }
// LANDING v3 (post-Mundial, clubes): OFF por default → landing byte-idéntica. ?landing3=1 la
// previsualiza sin flag (preview de Alexis); GP_LANDING_V3_ENABLED=true la enciende para todos.
function landingV3On() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_LANDING_V3_ENABLED || '').trim()); }
const PROP_FAMS = ['CORNERS', 'CARDS', 'PLAYER'];
// Familias en modo EXPERIMENTO: solo admin SIEMPRE (aunque GP_PROPS_PICKS_PUBLIC esté on) y fuera del
// track record. 8-jul: Alexis aprobó el rediseño de PLAYER (anclada al mercado + once proyectado + gates
// de titularidad/corroboración) → sale del experimento: pública y cuenta en el track record. El mecanismo
// queda para futuras familias nuevas (post-Mundial: agregar acá cualquier mercado en rodaje).
const EXPERIMENT_FAMS = [];
let _propsRunning = false, _propsLast = null, _propsLastRunMs = 0, _propsCredits = null;
let _propFitCache = null;
function propFit() {
  if (_propFitCache) return _propFitCache;
  try { _propFitCache = require('./prop-engine/model').fit(require('./data/props-history.json').matches); } catch { _propFitCache = null; }
  return _propFitCache;
}
// Fase del cruce para el prop-engine: si el par está en el bracket de eliminatoria → 'knockout'.
// Post-Mundial esto se generaliza por competición (cada torneo etiqueta sus fases en su dataset).
function pairPhase(h, a) {
  try {
    const br = resolveRealBracket();
    for (const k of KNOCKOUT) {
      const x = br[k.m];
      if (x && x.home && x.away && ((x.home === h && x.away === a) || (x.home === a && x.away === h))) return 'knockout';
    }
  } catch { /* sin bracket → grupos */ }
  return 'group';
}
// Disponibilidad por jugador desde la CAPA DE OBSERVACIÓN.
// pid → { status, prob_miss, corroborated, source_count } (antes solo el status: ahora las capas de picks,
// once proyectado e inteligencia consumen la evaluación completa, no un string suelto).
function observerAvailability() {
  const out = {};
  try {
    const { assessPlayers } = require('./observer/assess');
    for (const code of Object.keys(db.observations || {})) {
      const a = assessPlayers((db.observations[code] || {}).signals || []);
      for (const pid in a) if (a[pid].prob_miss > 0) out[pid] = { status: a[pid].status, prob_miss: a[pid].prob_miss, corroborated: a[pid].corroborated !== false, source_count: a[pid].source_count || 1 };
    }
  } catch { /* sin observer → sin flags */ }
  return out;
}
// PUNTO 3 roadmap (8-jul, orden de Alexis "no esperes"): factor λ del OBSERVER aplicado a la capa de
// GOLES/PROPS. Si el once habitual pierde generación (baja/duda ponderada por prob_miss), la λ del equipo
// baja → totales, anytime y props lo reflejan. Flag GP_OBSERVER_LAMBDA_ENABLED (kill switch), clamp de
// seguridad [0.75, 1.10]. NO toca el 1X2 oficial (esa vía ya tiene su capa de contexto propia).
function observerLambdaOn() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_OBSERVER_LAMBDA_ENABLED || '')); }
let _obsLambdaMemo = {};
function observerLambdaFactor(code) {
  if (!observerLambdaOn()) return 1;
  const hit = _obsLambdaMemo[code];
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.f;
  let f = 1;
  try {
    const { assessPlayers, suggestTeamFactor } = require('./observer/assess');
    const fit = obsFit();
    if (fit && db.observations && db.observations[code]) {
      const asmts = assessPlayers((db.observations[code] || {}).signals || []);
      f = Math.max(0.75, Math.min(1.10, suggestTeamFactor(fit, code, asmts).factor));
    }
  } catch { f = 1; }
  _obsLambdaMemo[code] = { f, at: Date.now() };
  return f;
}
const _propNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
let _propRoster = null; // norm(nombre) → { pid, team } y último apellido → pid (por equipo)
function propRoster() {
  if (_propRoster) return _propRoster;
  _propRoster = { byTeam: {} };
  try {
    const hist = require('./data/player-props-history.json');
    for (const m of hist.matches) for (const p of m.players) {
      const t = _propRoster.byTeam[p.team] || (_propRoster.byTeam[p.team] = { full: {}, last: {}, lastDup: {} });
      const full = _propNorm(p.name);
      t.full[full] = p.pid;
      const last = full ? p.name.trim().split(/\s+/).pop() : null;
      if (last && last.length >= 3) {
        const ln = _propNorm(last);
        // Colisión de apellidos (Theo/Lucas Hernández en FRA): si dos jugadores DISTINTOS comparten
        // apellido, el fallback por apellido queda inválido para ese apellido (solo matchea nombre completo).
        if (t.last[ln] && t.last[ln] !== p.pid) { t.lastDup[ln] = true; delete t.last[ln]; }
        else if (!t.lastDup[ln]) t.last[ln] = p.pid;
      }
    }
  } catch { /* sin dataset */ }
  return _propRoster;
}
// ===== FASE CLUBES F2.3: OBSERVER MULTI-LIGA =====
// Mismo pipeline que el observer del Mundial (sources/extract/verify/assess/narrate) parametrizado por club:
// Google News por nombre de club (solo clubes con partido en <72h → requests acotados), roster de TSA para
// matchear jugadores, señales en db.clubObservations[tm_id]. SHADOW: el ajuste al λ va tras el MISMO flag
// GP_OBSERVER_LAMBDA_ENABLED del Mundial; la narrativa/hallazgos se muestran en el Context/perfil (admin).
function clubsShadowOn() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_CLUBS_SHADOW_ENABLED || '').trim()); }
let _clubObsRunning = false, _clubObsLast = null;
async function clubObsRoster(tmId) {
  const rows = await clubRosterRows(tmId);
  return rows.map(p => ({ pid: p.id, name: p.name || p.short_name })).filter(x => x.pid && x.name);
}
// clubes con partido en las próximas 72h (upcoming memoizado por /api/clubs/state + live en curso) → [{league,tmId,name}]
function clubObsTeams() {
  const RT = global._clubsRatings || { leagues: {} }; const out = {}; const now = Date.now();
  const nameOf = (league, tmId) => { const L = RT.leagues[league]; return (L && L.ratings && L.ratings[tmId] && L.ratings[tmId].name) || tmId; };
  const add = (league, tmId, name) => { if (tmId && !out[tmId]) out[tmId] = { league, tmId, name: name || nameOf(league, tmId) }; };
  for (const [league, up] of Object.entries(global._clubsUpcoming || {})) {
    for (const m of (up.rows || [])) {
      const t = m.utc_date ? +new Date(m.utc_date) : 0;
      if (t && t - now < 72 * 3600e3 && t - now > -6 * 3600e3) {
        add(league, String(m.home_team && m.home_team.id), m.home_team && m.home_team.name);
        add(league, String(m.away_team && m.away_team.id), m.away_team && m.away_team.name);
      }
    }
  }
  for (const r of Object.values(db.clubResults || {})) { if (r.status === 'live') { add(r.league, r.home_id); add(r.league, r.away_id); } }
  return Object.values(out);
}
async function runClubObserver() {
  if (!observerOn() || !clubsShadowOn()) return { skipped: 'disabled' };
  if (_clubObsRunning) return { skipped: 'running' };
  _clubObsRunning = true;
  const out = { teams: 0, items: 0, signals: 0, errors: 0, started: new Date().toISOString() };
  try {
    const sources = require('./observer/sources');
    const { extract } = require('./observer/extract');
    const { verifyArticle } = require('./observer/verify');
    for (const { league, tmId, name } of clubObsTeams()) {
      out.teams++;
      const roster = await clubObsRoster(tmId);
      const slot = db.clubObservations[tmId] || (db.clubObservations[tmId] = { league, name, signals: [] });
      slot.league = league; slot.name = name;
      const seen = new Set(slot.signals.map(s => s.title));
      for (const q of sources.clubQueries(name)) {
        let items = [];
        try { items = await sources.googleNewsRss(q.q, q.lang); } catch { out.errors++; continue; }
        out.items += items.length;
        for (const it of items) {
          if (!it.title || seen.has(it.title)) continue;
          const sigs = extract(it, { team: tmId, roster });
          if (!sigs.length) continue;
          const kept = [];
          for (const s of sigs) {
            const negative = s.category === 'OUT' || s.category === 'SUSPENDED' || s.category === 'DOUBT';
            if (negative && s.pid && (out.verified_fetches || 0) < 8) {
              out.verified_fetches = (out.verified_fetches || 0) + 1;
              const v = await verifyArticle(s, { extract, roster, team: tmId }).catch(() => ({ status: 'unavailable' }));
              if (v.status === 'contradicted') { out.contradicted = (out.contradicted || 0) + 1; continue; }
              if (v.status === 'confirmed') s.body_check = 'confirmed';
            }
            kept.push(s);
          }
          if (kept.length) { slot.signals.push(...kept); kept.forEach(s => seen.add(s.title)); out.signals += kept.length; }
        }
        await new Promise(r => setTimeout(r, 1200)); // educado con la fuente
      }
      if (slot.signals.length > 120) slot.signals = slot.signals.slice(-120);
      slot.fetched_at = new Date().toISOString();
    }
    if (out.signals) save();
  } catch (e) { out.error = e.message; }
  finally { _clubObsRunning = false; out.finished = new Date().toISOString(); _clubObsLast = out; if (out.signals || out.error) console.log('[clubs-observer]', JSON.stringify(out)); }
  return out;
}
// factor λ del observer para un club (bajas del XI habitual): mismo assessPlayers+suggestTeamFactor del Mundial
// con el fitres de la liga (clubsFit.leagueFit). Clamp [0.75,1.10] y memo 5min iguales. Gated GP_OBSERVER_LAMBDA.
let _clubObsLambdaMemo = {};
function clubObserverLambdaFactor(league, tmId) {
  if (!observerLambdaOn()) return 1;
  const key = league + '|' + tmId;
  const hit = _clubObsLambdaMemo[key];
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.f;
  let f = 1;
  try {
    const { assessPlayers, suggestTeamFactor } = require('./observer/assess');
    const fit = require('./player-intel/clubsFit').leagueFit(league);
    const slot = db.clubObservations[tmId];
    if (fit && slot && slot.signals) {
      const asmts = assessPlayers(slot.signals);
      // clamp [0.75, 1.0]: una baja SOLO baja o queda neutral. (El fit de clubes es ruidoso y suele proyectar
      // que sacar a un titular flojo "mejora" la generación — eso NO se muestra como boost, sería engañoso.)
      f = Math.max(0.75, Math.min(1.0, suggestTeamFactor(fit, tmId, asmts).factor));
    }
  } catch { f = 1; }
  _clubObsLambdaMemo[key] = { f, at: Date.now() };
  return f;
}
// hallazgos narrados de disponibilidad de un club (caja negra, sin fuente) para el Context/perfil. Ordenados por riesgo.
function clubObserverFindings(tmId) {
  const slot = db.clubObservations[tmId];
  if (!slot || !slot.signals || !slot.signals.length) return [];
  try {
    const { assessPlayers } = require('./observer/assess');
    const { narratePlayer } = require('./observer/narrate');
    const asmts = assessPlayers(slot.signals);
    const out = [];
    for (const pid in asmts) {
      const a = asmts[pid];
      if (!a.prob_miss) continue;
      const nar = narratePlayer(a);
      out.push({ pid, player: a.player, status: a.status, prob_miss: a.prob_miss, es: nar && nar.es, en: nar && nar.en });
    }
    return out.sort((x, y) => y.prob_miss - x.prob_miss);
  } catch { return []; }
}
// ===== FASE CLUBES F3.3: PICKS DE CLUBES = MISMO PIPELINE DEL MUNDIAL =====
// curate() y settleOne() son EXACTAMENTE los del Mundial (pick-engine); solo cambia la fuente de datos:
// mercado = cuotas del sweep de clubes (consenso no-vig + mejor cuota con las MISMAS funciones del scanner),
// modelo = matchProbs con Elo dinámico (1X2, gate-approved por liga) + goal engine con λ de la liga (totales).
// REGLAS DURAS de la casa intactas: SOLID solo en ligas con gate 1X2 approved (clubs-gate-1); GOALS pasa por
// familyApproved = goals_backtest approved por liga (hoy ninguna → curate las bloquea solo, igual que el
// GOAL_FAMILY_APPROVED del Mundial). Shadow: db.clubDailyPicks separado (el settlement del Mundial itera
// fixtures del Mundial), mismo shape de registro; el feed las fusiona para admin.
let _clubPicksRunning = false, _clubPicksLast = null;
async function buildClubDailyPicks({ dryRun = false } = {}) {
  const dbc = require('./database/client');
  if (!dbc.isConfigured()) return { skipped: 'sin DB' };
  if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { return { skipped: 'sin ratings' }; } }
  const RT = global._clubsRatings;
  const qevents = db.clubsQuoteEvents || {};
  if (!Object.keys(qevents).length) return { skipped: 'sin eventos del sweep' };
  const { consensus, freshQuotes } = require('./market-scanner/scanner');
  const markets = await require('./market-scanner/quotes').loadClubsMarkets(dbc, { events: qevents, now: Date.now() }).catch(() => []);
  if (!markets.length) return { skipped: 'sin mercados frescos' };
  const now = Date.now();
  const minGroups = marketScanner.params.minIndependentGroups || 2;
  const events = [], goalMarkets = [];
  const out = { markets: markets.length, events_1x2: 0, goal_markets: 0, by_league: {} };
  for (const mk of markets) {
    const meta = qevents[mk.event_id]; if (!meta) continue;
    const lg = meta.league, L = RT.leagues[lg]; if (!L) continue;
    const kickoff = mk.kickoff || meta.kickoff;
    if (!kickoff || +new Date(kickoff) <= now) continue; // solo prepartido (misma regla del Mundial)
    const hId = resolveClubId(lg, meta.home || mk.home), aId = resolveClubId(lg, meta.away || mk.away);
    if (!hId || !aId || hId === aId) continue;
    const fresh = freshQuotes(mk.quotes || [], now, 75 * 60e3);
    const cons = consensus(mk, fresh, { minGroups });
    if (!cons || cons.status !== 'ok') continue;
    const bestOf = (o) => { let b = null, bk = null; for (const q of fresh) { if (q.outcome === o && q.odds_decimal > (b || 0)) { b = q.odds_decimal; bk = q.venue; } } return { odds: b, book: bk }; };
    const booksOf = (o) => new Set(fresh.filter(q => q.outcome === o).map(q => q.venue)).size;
    const st = out.by_league[lg] = out.by_league[lg] || { solid_gate: (L.backtest && L.backtest.status) || null, goals_gate: (L.goals_backtest && L.goals_backtest.status) || null, events: 0, totals: 0 };
    if (mk.market_family === '1x2') {
      // MONITOREO (Alexis 15-jul): se generan picks para TODAS las ligas con cuotas — el gate de liga viaja en
      // la pick (gate_status) y el track record privado del admin separa approved vs shadow. NADA de esto toca
      // el rendimiento público (db.clubDailyPicks vive aparte y picks-record no lo incluye).
      const rh = clubElo(lg, hId), ra = clubElo(lg, aId);
      const pr = matchProbs(rh + (L.hfa || 60), ra); // MISMO modelo 1X2 del cockpit (Elo dinámico + hfa de liga)
      const sel = {};
      for (const o of ['home', 'draw', 'away']) { const b = bestOf(o); sel[o] = { model: pr[o], market: cons.fair[o], bestOdds: b.odds, bestBook: b.book, books: booksOf(o) }; }
      events.push({ eventId: mk.event_id, home: meta.home, away: meta.away, homeId: hId, awayId: aId, league: lg, kickoff, selections: sel });
      out.events_1x2++; st.events++;
    } else if (mk.market_family === 'match_total') {
      // MISMO goal engine del cockpit: λ ataque/defensa de la liga (fallback Elo) + ajuste del observer si activo
      let l = null;
      try { const gf = clubGoalsFit(lg); if (gf) l = require('./clubs-engine/goalsModel').goalLambdas(gf, hId, aId); } catch { l = null; }
      if (!l) { const rh = clubElo(lg, hId), ra = clubElo(lg, aId); l = lambdas(rh + (L.hfa || 60), ra); }
      const fH = clubObserverLambdaFactor(lg, hId), fA = clubObserverLambdaFactor(lg, aId);
      const g = require('./goal-engine/distribution').goalModelOutput(l[0] * fH, l[1] * fA);
      const ou = (g.over_under || []).find(x => Math.abs((x.line != null ? x.line : x.l) - mk.line) < 0.01);
      if (!ou) continue;
      const famApproved = !!(L.goals_backtest && L.goals_backtest.status === 'approved');
      for (const side of ['over', 'under']) {
        const model = side === 'over' ? (ou.over != null ? ou.over : ou.o) : (ou.under != null ? ou.under : ou.u);
        const market = cons.fair[side]; if (market == null) continue;
        const b = bestOf(side);
        // régimen dual: eficiencia del mercado del lado (profundidad + dispersión de precios entre casas)
        const sidePrices = fresh.filter(q => q.outcome === side).map(q => q.odds_decimal);
        goalMarkets.push({
          eventId: mk.event_id, home: meta.home, away: meta.away, homeId: hId, awayId: aId, league: lg, kickoff,
          marketId: `TOTAL_GOALS_${side.toUpperCase()}_${String(mk.line).replace('.', '_')}`,
          family: 'match_total', side, line: mk.line,
          modelProb: model, marketProb: market, edgePp: model - market,
          bestOdds: b.odds, bestBook: b.book, books: booksOf(side), familyApproved: famApproved,
          efficiency: require('./pick-engine/efficiency').marketEfficiency({ books: booksOf(side), prices: sidePrices }),
          lh: +(l[0] * fH).toFixed(2), la: +(l[1] * fA).toFixed(2), // λ del modelo (para la narrativa)
        });
        out.goal_markets++; st.totals++;
      }
    }
  }
  // PLAYER PROPS (assists + anytime goal, F3.4 encendida): cuotas del props-sweep + modelo projectTeam de la
  // liga (anytime_goal/anytime_assist con el λ del cruce) + disponibilidad del observer. impliedMedian =
  // mediana de 1/odds entre casas (sin de-vig fino: 1 lado cotizado).
  const playerMarkets = [];
  try {
    const evIds = [...new Set(events.map(e => e.eventId).concat(goalMarkets.map(g => g.eventId)))];
    if (evIds.length) {
      const pq = await dbc.query(
        `SELECT canonical_event_id, market_family, market_id, team_scope pid, sportsbook_code, odds_decimal::float o
           FROM sportsbook_goal_quote_current
          WHERE canonical_event_id = ANY($1) AND market_family IN ('player_assist','player_goal')
            AND observed_at > now() - interval '12 hours'`, [evIds]).catch(() => ({ rows: [] }));
      const byKey = {};
      for (const r of pq.rows) { (byKey[r.canonical_event_id + '|' + r.market_family + '|' + r.pid] = byKey[r.canonical_event_id + '|' + r.market_family + '|' + r.pid] || []).push(r); }
      const projCache = {};
      for (const [k, rows] of Object.entries(byKey)) {
        const [ceid, fam, pid] = k.split('|');
        const meta = qevents[ceid]; if (!meta) continue;
        const lg = meta.league, L = RT.leagues[lg]; if (!L) continue;
        const hId = resolveClubId(lg, meta.home), aId = resolveClubId(lg, meta.away); if (!hId || !aId) continue;
        // proyección del cruce (una vez por evento): projectTeam de ambos lados con el λ del goal model de liga
        if (!projCache[ceid]) {
          try {
            let l2 = null; const gf = clubGoalsFit(lg); if (gf) l2 = require('./clubs-engine/goalsModel').goalLambdas(gf, hId, aId);
            if (!l2) { const rh = clubElo(lg, hId), ra = clubElo(lg, aId); l2 = lambdas(rh + (L.hfa || 60), ra); }
            const fit = require('./player-intel/clubsFit').leagueFit(lg);
            const proj = {};
            if (fit) {
              require('./prop-engine/players').projectTeam(fit, hId, { teamLambda: l2[0], top: 40 }).forEach(p => proj[p.pid] = { ...p, starter: true });
              require('./prop-engine/players').projectTeam(fit, aId, { teamLambda: l2[1], top: 40 }).forEach(p => proj[p.pid] = { ...p, starter: true });
            }
            projCache[ceid] = proj;
          } catch { projCache[ceid] = {}; }
        }
        const pr = projCache[ceid][pid];
        if (!pr) continue; // sin proyección del jugador (no está en el XI proyectado) → no hay pick
        const model = fam === 'player_assist' ? pr.anytime_assist : pr.anytime_goal;
        if (!(model > 0)) continue;
        const implied = rows.map(r => 1 / r.o).sort((a, b) => a - b);
        const med = implied[Math.floor(implied.length / 2)];
        const best = rows.slice().sort((a, b) => b.o - a.o)[0];
        const av = clubPlayerAvail(pr.team, pid);
        playerMarkets.push({
          eventId: ceid, home: meta.home, away: meta.away, homeId: hId, awayId: aId, league: lg, kickoff: meta.kickoff,
          family: fam, marketId: fam === 'player_assist' ? `PLAYER_ASSIST_${pid}` : `PLAYER_GOAL_${pid}`,
          player: pr.name, pid, side: 'yes', line: null,
          modelProb: model, impliedMedian: med, bestOdds: best.o, bestBook: best.sportsbook_code,
          books: new Set(rows.map(r => r.sportsbook_code)).size,
          availabilityRisk: av ? av.status : null, availabilityMiss: av ? Number(av.prob_miss) || 0 : 0,
          isStarter: true,
        });
      }
    }
  } catch { /* sin props este ciclo */ }
  // PROPS DE EQUIPO (córners/tarjetas, F3.4): cuotas del sweep (alternate_totals_*) + proyección NB del
  // prop-engine del Mundial con el props-history de la liga. familyApproved = gate LOO por liga (clubPropsGate);
  // curate las bloquea con FAMILY_NOT_APPROVED igual que las GOALS — pero viajan al monitoreo (gate_status).
  const propMarkets = [];
  try {
    const { nbPmf } = require('./goal-engine/negativeBinomial');
    const nbOver = (mu, r, line) => { if (!(mu > 0)) return 0; let u = 0; for (let k = 0; k <= Math.floor(line); k++) u += nbPmf(mu, r, k); return Math.max(0, Math.min(1, 1 - u)); };
    const noVig = require('./goal-engine/noVig');
    const evIds2 = [...new Set(events.map(e => e.eventId).concat(goalMarkets.map(g => g.eventId)))];
    if (evIds2.length) {
      const tq = await dbc.query(
        `SELECT canonical_event_id, market_family, line::float, side, sportsbook_code, odds_decimal::float o
           FROM sportsbook_goal_quote_current
          WHERE canonical_event_id = ANY($1) AND market_family IN ('corners_total','cards_total')
            AND observed_at > now() - interval '12 hours'`, [evIds2]).catch(() => ({ rows: [] }));
      const byGrp = {};
      for (const r of tq.rows) { (byGrp[r.canonical_event_id + '|' + r.market_family + '|' + r.line] = byGrp[r.canonical_event_id + '|' + r.market_family + '|' + r.line] || []).push(r); }
      const projCache2 = {};
      for (const [k, rows] of Object.entries(byGrp)) {
        const [ceid, fam, lineStr] = k.split('|'); const line = Number(lineStr);
        if (Math.abs(line % 1 - 0.5) > 0.01) continue; // picks SOLO líneas .5 (sin push, mismo criterio del Mundial)
        const meta = qevents[ceid]; if (!meta) continue;
        const lg = meta.league, L = RT.leagues[lg]; if (!L) continue;
        const hId = resolveClubId(lg, meta.home), aId = resolveClubId(lg, meta.away); if (!hId || !aId) continue;
        // proyección del cruce (una vez por evento): prop-engine.project con fit de la liga + λ + paridad 1X2
        if (projCache2[ceid] === undefined) {
          projCache2[ceid] = null;
          try {
            const pf = clubPropsFit(lg);
            if (pf && pf.fit) {
              let l3 = null; const gf = clubGoalsFit(lg); if (gf) l3 = require('./clubs-engine/goalsModel').goalLambdas(gf, hId, aId);
              if (!l3) { const rh = clubElo(lg, hId), ra = clubElo(lg, aId); l3 = lambdas(rh + (L.hfa || 60), ra); }
              const pr3 = matchProbs(clubElo(lg, hId) + (L.hfa || 60), clubElo(lg, aId));
              projCache2[ceid] = require('./prop-engine').project(pf.fit, { home: hId, away: aId, lambdas: { home: l3[0], away: l3[1] }, closeness1x2: pr3 });
            }
          } catch { projCache2[ceid] = null; }
        }
        const proj = projCache2[ceid]; if (!proj) continue;
        const quotes = rows.map(r => ({ sportsbook_code: r.sportsbook_code, independence_group: r.sportsbook_code, side: r.side, odds_decimal: r.o, quote_status: 'open', is_live: false }));
        // minGroups:1 — las líneas de córners/tarjetas de clubes hoy cotizan en 1-2 casas (mismo criterio que los
        // player props, playerMinBooks:1). Es MONITOREO privado (gate viaja, no público) → de-vig de 1 casa sirve
        // para trackear modelo-vs-mercado. El conteo de casas viaja en la pick para el análisis.
        const cons = noVig.consensus(quotes, 'over', 'under', { minGroups: 1 });
        if (!cons.ok) continue;
        const mu = fam === 'corners_total' ? proj.corners.total : proj.cards.total;
        const rDisp = fam === 'corners_total' ? proj.corners.r_total : proj.cards.r_total;
        const fairOver = nbOver(mu, rDisp, line);
        const famApproved = clubPropsGate(lg, fam) === 'approved';
        const tag = String(line).replace('.', '_'); const P = fam === 'corners_total' ? 'CORNERS_' : 'CARDS_';
        for (const side of ['over', 'under']) {
          const model = side === 'over' ? fairOver : 1 - fairOver;
          const market = side === 'over' ? cons.probability : 1 - cons.probability;
          const sq = quotes.filter(q => q.side === side);
          if (!sq.length) continue;
          const best = sq.slice().sort((a, b) => b.odds_decimal - a.odds_decimal)[0];
          propMarkets.push({
            eventId: ceid, home: meta.home, away: meta.away, homeId: hId, awayId: aId, league: lg, kickoff: meta.kickoff,
            family: fam, marketId: P + side.toUpperCase() + '_' + tag, side, line,
            modelProb: model, marketProb: market, edgePp: model - market,
            bestOdds: best.odds_decimal, bestBook: best.sportsbook_code, books: new Set(sq.map(q => q.sportsbook_code)).size,
            familyApproved: famApproved, mu: +mu.toFixed(2),
          });
        }
      }
    }
  } catch { /* sin cuotas de córners/tarjetas este ciclo */ }
  // MISMO curate del Mundial (todas sus reglas: anclaje, coherencia de dirección, edge mínimo, casas mínimas).
  // goalsRequireApprovedFamily:false = las GOALS nacen para el MONITOREO aunque el gate de goles de la liga
  // esté shadow (el estado del gate viaja en la pick; el público no ve nada de esto). playerMinBooks:1 = los
  // props de estas ligas cotizan en 1-6 casas hoy (EU llega en agosto); el conteo de casas viaja en la pick.
  const { curate } = require('./pick-engine/curate');
  // goalsAnchorEnabled:true (17-jul, régimen dual de Alexis): en mercados de goles EFICIENTES el camino
  // ANCLA sigue el lean del consenso cuando el modelo confirma — picks "ganadoras con poco edge" en vez
  // de perseguir edge de modelo en mercados afilados. El Mundial no toca este flag (default false).
  const res = curate({ events, goalMarkets, propMarkets, playerMarkets, config: { goalsRequireApprovedFamily: false, propsRequireApprovedFamily: false, playerMinBooks: 1, propsMinBooks: 1, goalsAnchorEnabled: true, propsMonitoringMode: true } });
  out.player_markets = playerMarkets.length;
  out.prop_markets = propMarkets.length;
  out.eligible = { solid: res.eligible.solid.length, goals: res.eligible.goals.length, combo: res.eligible.combo.length };
  // dry-run: devolver candidatos + bloqueos sin persistir (verificación del mecanismo con cuotas reales)
  if (dryRun) {
    out.candidates = {
      solid: res.all.solid.map(s => ({ league: (events.find(e => e.eventId === s.eventId) || {}).league, home: s.home, away: s.away, selection: s.selection, odds: s.bestOdds, conf: s.confidence != null ? +s.confidence.toFixed(3) : null, eligible: s.eligible, blockers: s.blockers })),
      goals: res.all.goals.map(g => ({ league: (goalMarkets.find(x => x.eventId === g.eventId && x.marketId === g.marketId) || {}).league, home: g.home, away: g.away, market: g.marketId, edge_pp: g.edgePp, odds: g.bestOdds, regime: g.regime, efficiency: g.efficiency, eligible: g.eligible, blockers: g.blockers })),
      props: res.all.props.map(g => ({ league: (propMarkets.find(x => x.eventId === g.eventId && x.marketId === g.marketId) || {}).league, home: g.home, away: g.away, market: g.marketId, edge_pp: g.edgePp, odds: g.bestOdds, books: g.books, eligible: g.eligible, blockers: g.blockers })),
    };
    return out;
  }
  // Persistencia: mismo shape de registro del Mundial + league; idempotente por pick_id; SUPERSEDED por
  // (evento, familia) conservando la más reciente (misma regla anti-contradicción del Mundial).
  const { compose } = require('./pick-engine/narrative');
  const stable = (key) => 'cdp_' + require('crypto').createHash('sha256').update(key).digest('hex').slice(0, 16);
  const gateOf = (lg2, fam) => {
    const L2 = RT.leagues[lg2] || {};
    if (fam === 'GOALS') return (L2.goals_backtest && L2.goals_backtest.status) || 'shadow';
    if (fam === 'CORNERS') return clubPropsGate(lg2, 'corners_total');
    if (fam === 'CARDS') return clubPropsGate(lg2, 'cards_total');
    return (L2.backtest && L2.backtest.status) || 'shadow';
  };
  const mkRecord = (family, ev, fields, key) => ({
    pick_id: stable(key), family, is_club: true, league: fields.league,
    gate_status: gateOf(fields.league, family), // approved|shadow — el track privado separa por esto
    competition_name: (RT.leagues[fields.league] && RT.leagues[fields.league].name) || fields.league,
    event: { canonical_event_id: ev, is_canonical: false, club_eid: 'cl-' + fields.league + '-' + fields.homeId + '-' + fields.awayId, home: fields.home, away: fields.away, home_team_id: fields.homeId, away_team_id: fields.awayId, kickoff_at: fields.kickoff },
    selection_code: fields.selection_code || null, market_id: fields.market_id || null, side: fields.side || null, line: fields.line != null ? fields.line : null,
    player_name: fields.player_name || null, pid: fields.pid || null, player_family: fields.player_family || null,
    best_odds: fields.best_odds || null, best_book: fields.best_book || null, books: fields.books || null,
    model_prob: fields.model_prob != null ? fields.model_prob : null, market_prob: fields.market_prob != null ? fields.market_prob : null,
    confidence: fields.confidence != null ? fields.confidence : null, edge_pp: fields.edge_pp != null ? fields.edge_pp : null,
    why_es: fields.why && fields.why.es, why_en: fields.why && fields.why.en,
    regime: fields.regime || null, // 'anchor' | 'edge' — régimen dual (análisis del track privado)
    solid_lever: fields.solid_lever || false, // SOLID que pasa SOLO por la palanca ajustada (modelo<mercado) — monitoreo
    status: 'ACTIVE', result_code: 'PENDING', created_at: new Date().toISOString(), settled_at: null,
  });
  let fresh = []; // (let: las reglas de publicación lo re-filtran antes de persistir)
  // FILTRO ANCLA-SOLID (23-jul, autopsia: el 1X2 no le gana al mercado — CLV −4.5%, bucket conf 60-70 roto
  // −27pp). Una SOLID solo se CREA si es favorito CLARO del consenso (mercado ≥55%), con mercado profundo
  // (≥5 casas) y SIN sobreconfianza del modelo (modelo ≤ mercado+5pp — se corta justo la dirección del bucket
  // roto). PALANCA AJUSTADA (a monitorear hasta el lunes): se admite el caso modelo<mercado−5pp (favorito real
  // donde nuestro modelo es MÁS conservador que el mercado) y se marca solid_lever para evaluarlo aparte.
  const SOLID_MIN_MKT = 0.55, SOLID_MIN_BOOKS = 5, SOLID_MAX_OVERCONF = 0.05, SOLID_LEVER_MARGIN = 0.05;
  for (const s of res.eligible.solid) {
    const mkt = Number(s.marketProb || 0), mdl = Number(s.modelProb || 0), bk = Number(s.books || 0);
    if (mkt < SOLID_MIN_MKT || bk < SOLID_MIN_BOOKS) continue;   // no favorito claro / mercado fino → NO se crea
    if (mdl > mkt + SOLID_MAX_OVERCONF) continue;                // modelo sobreconfiado (bucket roto) → NO se crea
    const lever = mdl < mkt - SOLID_LEVER_MARGIN;                // palanca: modelo menos confiado que el mercado
    const ev = events.find(e => e.eventId === s.eventId) || {};
    const why = compose([
      { code: 'MARKET_ANCHOR', w: 3, books: s.books },
      ...(s.modelProb > s.marketProb ? [{ code: 'MODEL_AGREES_UP', w: 2 }] : []),
    ]);
    fresh.push(mkRecord('SOLID', s.eventId, { league: ev.league, home: s.home, away: s.away, homeId: ev.homeId, awayId: ev.awayId, kickoff: s.kickoff, selection_code: s.selection, best_odds: s.bestOdds, best_book: s.bestBook, books: s.books, model_prob: s.modelProb, market_prob: s.marketProb, confidence: s.confidence, why, regime: 'anchor', solid_lever: lever }, s.eventId + '|SOLID|' + s.selection));
  }
  // 1 GOALS por evento. POST-MUNDIAL (19-jul, decisión de Alexis): goles al PÚBLICO = solo ANCLA. El mercado de
  // goles es eficiente → el "edge" del modelo EMPATA al consenso (combinado Mundial+clubes: 53%/+1.5u; clubes
  // solos 31%/−5.1u). Se PREFIERE la ancla para el pick público; el edge de goles NO se descarta: se conserva en
  // el track PRIVADO (regime:'monitor', admin only) para seguir validando si algún día desarrolla skill real.
  const bestGoalByEvent = {};
  const goalRank = x => (x.regime === 'anchor' ? 1 : 0); // la ancla gana al edge para el pick público
  for (const g of res.eligible.goals) {
    const cur = bestGoalByEvent[g.eventId];
    if (!cur) { bestGoalByEvent[g.eventId] = g; continue; }
    const better = goalRank(g) !== goalRank(cur)
      ? goalRank(g) > goalRank(cur)
      : (g.regime === 'anchor' ? g.confidence > cur.confidence : g.edgePp > cur.edgePp);
    if (better) bestGoalByEvent[g.eventId] = g;
  }
  for (const g of Object.values(bestGoalByEvent)) {
    if (g.regime !== 'anchor') continue; // GOALS no-ancla de clubes NO se crean (23-jul): 7-14 histórico, sin edge; ensuciaban el cuadro
    const gm = goalMarkets.find(x => x.eventId === g.eventId && x.marketId === g.marketId) || {};
    // narrativa por régimen: la ANCLA se explica como ancla (consenso + modelo confirma), no como edge
    const why = g.regime === 'anchor'
      ? compose([
          { code: 'MARKET_ANCHOR', w: 3, books: g.books },
          ...(Math.abs(g.modelProb - g.marketProb) <= 0.05 ? [{ code: 'MODEL_AGREES_UP', w: 2 }] : []),
          ...(g.bestOdds > 1 / Math.max(1e-6, g.marketProb) ? [{ code: 'PRICE_ABOVE_FAIR', w: 1 }] : []),
        ])
      : compose([
          ...(g.side === 'over' && gm.lh != null ? [{ code: 'GOALS_VOLUME_BOTH', w: 3, h: gm.lh, a: gm.la }] : []),
          ...(g.side === 'under' ? [{ code: 'GOALS_DEFENSES_TIGHT', w: 3 }] : []),
          ...(g.bestOdds > 1 / Math.max(1e-6, g.marketProb) ? [{ code: 'PRICE_ABOVE_FAIR', w: 2 }] : []),
        ]);
    // regime público: 'anchor' → feed; cualquier otra cosa (edge/legacy) → 'monitor' (track privado, jamás al feed).
    const goalRegime = g.regime === 'anchor' ? 'anchor' : 'monitor';
    fresh.push(mkRecord('GOALS', g.eventId, { league: gm.league, home: g.home, away: g.away, homeId: gm.homeId, awayId: gm.awayId, kickoff: g.kickoff, market_id: g.marketId, side: g.side, line: g.line, best_odds: g.bestOdds, best_book: g.bestBook, books: g.books, model_prob: g.modelProb, market_prob: g.marketProb, confidence: g.confidence, edge_pp: g.edgePp, why, regime: goalRegime }, g.eventId + '|GOALS|' + g.marketId));
  }
  // CORNERS/CARDS (F3.4): 1 pick por (evento, familia), la de mayor edge — mismo criterio que GOALS.
  const bestProp = {};
  for (const g of res.eligible.props) { const k = g.eventId + '|' + g.family; const cur = bestProp[k]; if (!cur || g.edgePp > cur.edgePp) bestProp[k] = g; }
  for (const g of Object.values(bestProp)) {
    const pm2 = propMarkets.find(x => x.eventId === g.eventId && x.marketId === g.marketId) || {};
    const priceAboveFair = g.bestOdds > 1 / Math.max(1e-6, g.marketProb);
    const why = compose([
      ...(priceAboveFair ? [{ code: 'PRICE_ABOVE_FAIR', w: 2 }] : []),
      { code: 'MARKET_ANCHOR', w: 1, books: g.books },
    ]);
    // régimen: 'edge' si el precio le gana al consenso (valor real, promocionable a público); 'monitor' si nació
    // en modo monitoreo (modelo convencido pero mercado eficiente → validamos over-bias con el track privado).
    const regime = priceAboveFair ? 'edge' : (g.monitoring ? 'monitor' : 'edge');
    fresh.push(mkRecord(g.family, g.eventId, { league: pm2.league, home: g.home, away: g.away, homeId: pm2.homeId, awayId: pm2.awayId, kickoff: g.kickoff, market_id: g.marketId, side: g.side, line: g.line, best_odds: g.bestOdds, best_book: g.bestBook, books: g.books, model_prob: g.modelProb, market_prob: g.marketProb, confidence: g.confidence, edge_pp: g.edgePp, why, regime }, g.eventId + '|' + g.family + '|' + g.marketId));
  }
  // PLAYER (assists + anytime goal): 1 pick por (evento, sub-familia), la de mayor confianza — feed limpio.
  const bestPlayer = {};
  for (const g of res.eligible.player) { const k = g.eventId + '|' + g.playerFamily; const cur = bestPlayer[k]; if (!cur || g.confidence > cur.confidence) bestPlayer[k] = g; }
  for (const g of Object.values(bestPlayer)) {
    const pm = playerMarkets.find(x => x.eventId === g.eventId && x.marketId === g.marketId) || {};
    fresh.push(mkRecord('PLAYER', g.eventId, { league: pm.league, home: g.home, away: g.away, homeId: pm.homeId, awayId: pm.awayId, kickoff: g.kickoff, market_id: g.marketId, side: 'yes', player_name: g.player, pid: g.pid, player_family: g.playerFamily, best_odds: g.bestOdds, best_book: g.bestBook, books: g.books, model_prob: g.modelProb, market_prob: g.marketProb, confidence: g.confidence, edge_pp: g.edgePp }, g.eventId + '|PLAYER|' + g.marketId));
  }
  db.clubDailyPicks = db.clubDailyPicks || [];
  // REGLA DE PUBLICACIÓN (autopsia 18-jul): máximo 3 picks PÚBLICAS por evento — SOLID > GOALS > la mejor
  // por confianza. Las regime:'monitor' (track privado, no salen al feed) NO cuentan ni se recortan.
  const pubPrio = { SOLID: 0, GOALS: 1 };
  // el cap de 3 es para el FEED (SOLID/GOALS/COMBO). Props (córners/tarjetas/player) y monitor NO entran al cap:
  // no van al feed y deben liquidar TODAS para contar en el cuadro (decisión Alexis 23-jul).
  const capExempt = (p) => p.regime === 'monitor' || PROP_FAMS.indexOf(p.family) >= 0;
  const freshByEv = {};
  fresh.forEach(p => { if (!capExempt(p)) (freshByEv[p.event.canonical_event_id] = freshByEv[p.event.canonical_event_id] || []).push(p); });
  const keepIds = new Set(fresh.filter(capExempt).map(p => p.pick_id));
  Object.values(freshByEv).forEach(evPicks => {
    evPicks.slice().sort((a, b) => ((pubPrio[a.family] ?? 2) - (pubPrio[b.family] ?? 2)) || ((b.confidence || 0) - (a.confidence || 0))).slice(0, 3).forEach(p => keepIds.add(p.pick_id));
  });
  fresh = fresh.filter(p => keepIds.has(p.pick_id));
  // PRUNE (23-jul): las SOLID/GOALS activas creadas bajo reglas viejas que ya NO pasan el filtro nuevo se
  // superseden (salen del feed Y del cuadro — SUPERSEDED no cuenta). SOLO eventos re-escaneados este ciclo
  // (con data fresca en events/goalMarkets); si el evento no se escaneó, no se toca. Props/COMBO no se prunean.
  const scannedSolid = new Set(events.map(e => e.eventId));
  const scannedGoals = new Set(goalMarkets.map(g => g.eventId));
  const keptSolid = new Set(fresh.filter(p => p.family === 'SOLID').map(p => p.event.canonical_event_id));
  const keptGoals = new Set(fresh.filter(p => p.family === 'GOALS').map(p => p.event.canonical_event_id));
  for (const old of db.clubDailyPicks) {
    if (old.status !== 'ACTIVE') continue;
    const ev = old.event.canonical_event_id;
    const drop = (old.family === 'SOLID' && scannedSolid.has(ev) && !keptSolid.has(ev))
      || (old.family === 'GOALS' && scannedGoals.has(ev) && !keptGoals.has(ev));
    if (drop) { old.status = 'SETTLED'; old.result_code = 'SUPERSEDED'; old.settled_at = new Date().toISOString(); out.pruned = (out.pruned || 0) + 1; }
  }
  const byId = new Set(db.clubDailyPicks.map(p => p.pick_id));
  let added = 0;
  for (const p of fresh) {
    if (byId.has(p.pick_id)) continue;
    // anti-contradicción del Mundial: 1 ACTIVE por (evento, familia) — la nueva SUPERSEDE a la anterior
    for (const old of db.clubDailyPicks) {
      if (old.status === 'ACTIVE' && old.family === p.family && old.event.canonical_event_id === p.event.canonical_event_id) { old.status = 'SETTLED'; old.result_code = 'SUPERSEDED'; old.settled_at = new Date().toISOString(); }
    }
    db.clubDailyPicks.push(p); added++;
  }
  // FLAG DE PALANCA (23-jul): se computa desde las PROBS CONGELADAS de cada SOLID activa (no las frescas del
  // build) → coherente con lo publicado, estable cerca del kickoff, y backfillea/corrige registros previos.
  // lever = favorito claro del consenso (mkt≥55%) donde el modelo es MÁS conservador (mdl < mkt−5pp).
  let updated = 0;
  for (const q of db.clubDailyPicks) {
    if (q.status !== 'ACTIVE' || q.family !== 'SOLID') continue;
    const mk = Number(q.market_prob || 0), md = Number(q.model_prob || 0);
    // por sus PROPIAS probs congeladas: si ya no es favorito claro (mkt<55%) o el modelo está sobreconfiado
    // (mdl>mkt+5pp, la dirección del bucket roto) → supersede (sale de feed Y cuadro). Limpia las viejas
    // grandfathered sin esperar el re-escaneo de su evento.
    if (mk < 0.55 || md > mk + 0.05) { q.status = 'SETTLED'; q.result_code = 'SUPERSEDED'; q.settled_at = new Date().toISOString(); out.pruned = (out.pruned || 0) + 1; continue; }
    const lev = md < mk - 0.05;
    if (q.solid_lever !== lev) { q.solid_lever = lev; updated++; }
  }
  if (added || updated || out.pruned) save();
  out.added = added; out.updated = updated; out.total = db.clubDailyPicks.length;
  return out;
}
// Liquidación: MISMO settleOne del Mundial con el marcador final de clubResults (ligas domésticas = 90').
// PLAYER (goles/assists del jugador): con el player-history de la liga si el backfill trae el match (±4 días);
// sin dato a las 72h del kickoff → VOID (honesto: sin fuente no se inventa el resultado).
function settleClubDailyPicks() {
  const { settleOne } = require('./pick-engine/dailyPicks');
  let settled = 0;
  const phCache = {}; // player-history por liga (archivo grande): una lectura por corrida del settle
  const phRows = (lg) => { if (phCache[lg] === undefined) { try { phCache[lg] = JSON.parse(fs.readFileSync(clubDataFile(`player-history-${lg}.json`), 'utf8')).rows || []; } catch { phCache[lg] = []; } } return phCache[lg]; };
  for (const p of (db.clubDailyPicks || [])) {
    if (p.status !== 'ACTIVE') continue;
    if (p.family === 'PLAYER') {
      try {
        const raw = JSON.parse(fs.readFileSync(clubDataFile(`player-history-${p.league}.json`), 'utf8')).rows || [];
        const ko = +new Date(p.event.kickoff_at || 0);
        const row = raw.find(r => r.pid === p.pid && Math.abs(+new Date(r.date) - ko) < 4 * 86400e3);
        if (row) {
          const val = p.player_family === 'player_assist' ? (Number(row.assists) || 0) : (Number(row.goals) || 0);
          p.status = 'SETTLED'; p.result_code = val > 0 ? 'WIN' : 'LOSS'; p.settled_at = new Date().toISOString(); settled++;
        } else if (ko && Date.now() - ko > 72 * 3600e3) {
          p.status = 'SETTLED'; p.result_code = 'VOID'; p.settled_at = new Date().toISOString(); settled++;
        }
      } catch { /* sin history → espera o VOID por tiempo */ }
      continue;
    }
    // CORNERS/CARDS (F3.4): totales reales del props-history de la liga (backfill AF) por par+fecha ±2d.
    // Sin dato a las 72h → VOID (mismo criterio honesto que PLAYER). El fallback AF en vivo corre aparte
    // (settleClubPropsViaAf, async) para finales recientes que el backfill aún no trae.
    if (p.family === 'CORNERS' || p.family === 'CARDS') {
      try {
        const ms = JSON.parse(fs.readFileSync(clubDataFile(`props-history-${p.league}.json`), 'utf8')).matches || [];
        const ko = +new Date(p.event.kickoff_at || 0);
        const row = ms.find(m2 => ((m2.home.code === p.event.home_team_id && m2.away.code === p.event.away_team_id) || (m2.home.code === p.event.away_team_id && m2.away.code === p.event.home_team_id)) && Math.abs(+new Date(m2.date) - ko) < 2 * 86400e3);
        if (row) {
          const tot = p.family === 'CORNERS'
            ? (Number(row.home.corners) || 0) + (Number(row.away.corners) || 0)
            : (Number(row.home.yellows) || 0) + (Number(row.home.reds) || 0) + (Number(row.away.yellows) || 0) + (Number(row.away.reds) || 0);
          const over = tot > Number(p.line);
          p.status = 'SETTLED'; p.result_code = ((p.side === 'over') === over) ? 'WIN' : 'LOSS'; p.settled_at = new Date().toISOString(); settled++;
        } else {
          // FALLBACK TSA para CARDS (18-jul, API-Football caído a plan Free → props-history congelado):
          // tarjetas del partido = suma de yc+rc del player-history (TSA, vivo vía el pase diario). Se aísla
          // EL cruce agrupando por match id con filas de AMBOS equipos. CORNERS no está en player-history
          // (stat de equipo) → sigue esperando props-history/AF y VOID honesto a las 72h.
          let done = false;
          if (p.family === 'CARDS') {
            const near = phRows(p.league).filter(r2 => Math.abs(+new Date(r2.date) - ko) < 2 * 86400e3 && (r2.team === p.event.home_team_id || r2.team === p.event.away_team_id));
            const byMatch = {};
            near.forEach(r2 => { (byMatch[r2.match] = byMatch[r2.match] || new Set()).add(r2.team); });
            const mid = Object.keys(byMatch).find(k => byMatch[k].has(p.event.home_team_id) && byMatch[k].has(p.event.away_team_id));
            if (mid) {
              const tot2 = near.filter(r2 => r2.match === mid).reduce((a, r2) => a + (Number(r2.yc) || 0) + (Number(r2.rc) || 0), 0);
              const over2 = tot2 > Number(p.line);
              p.status = 'SETTLED'; p.result_code = ((p.side === 'over') === over2) ? 'WIN' : 'LOSS'; p.settled_at = new Date().toISOString(); settled++; done = true;
            }
          }
          if (!done && ko && Date.now() - ko > 72 * 3600e3) {
            p.status = 'SETTLED'; p.result_code = 'VOID'; p.settled_at = new Date().toISOString(); settled++;
          }
        }
      } catch { /* sin history → espera, AF fallback o VOID por tiempo */ }
      continue;
    }
    let r = (db.clubResults || {})[clubScoreKey(p.league, p.event.home_team_id, p.event.away_team_id)];
    if (r && r.status !== 'final') continue; // en juego → esperar
    // FALLBACK (P2 fix): los finales del sync se PODAN a las 3h — si el settle no corrió en esa ventana
    // (redeploy, partido de madrugada), la pick quedaba ACTIVE para siempre. Los resultados PERSISTENTES
    // viven en results-<liga>.json (el pase diario P2.5 los refresca) → liquidar desde ahí por par+fecha ±2d.
    if (!r) {
      try {
        global._clubsResults = global._clubsResults || {};
        if (!global._clubsResults[p.league]) { try { global._clubsResults[p.league] = JSON.parse(fs.readFileSync(clubDataFile(`results-${p.league}.json`), 'utf8')).rows || []; } catch { global._clubsResults[p.league] = []; } }
        const ko = +new Date(p.event.kickoff_at || 0);
        const row = global._clubsResults[p.league].find(m2 => m2.hg != null && ((m2.home_id === p.event.home_team_id && m2.away_id === p.event.away_team_id) || (m2.home_id === p.event.away_team_id && m2.away_id === p.event.home_team_id)) && Math.abs(+new Date(m2.date) - ko) < 2 * 86400e3);
        if (row) r = { status: 'final', home_id: row.home_id, hg: row.hg, ag: row.ag };
      } catch { /* sin archivo → espera */ }
    }
    if (!r || r.status !== 'final') {
      // backstop 72h (18-jul): sin resultado ni del sync ni del archivo (gap del backfill TSA — caso Chicago
      // 17-jul) la pick quedaba ACTIVE para siempre → VOID honesto, mismo criterio que PLAYER/props.
      const ko2 = +new Date(p.event.kickoff_at || 0);
      if (ko2 && Date.now() - ko2 > 72 * 3600e3) { p.status = 'SETTLED'; p.result_code = 'VOID'; p.settled_at = new Date().toISOString(); settled++; }
      continue;
    }
    const homeIsH = r.home_id === p.event.home_team_id;
    const rc = settleOne(p, { homeGoals: homeIsH ? r.hg : r.ag, awayGoals: homeIsH ? r.ag : r.hg });
    if (rc && rc !== 'PENDING') { p.status = 'SETTLED'; p.result_code = rc; p.settled_at = new Date().toISOString(); settled++; }
  }
  if (settled) save();
  return { settled };
}
// F3.4: fallback de liquidación de CORNERS/CARDS vía AF statistics (clubMatchStats) para partidos FINALIZADOS
// que el backfill de props-history aún no trae (el backfill corre por pasadas; esto liquida en horas, no días).
async function settleClubPropsViaAf() {
  let settled = 0;
  for (const p of (db.clubDailyPicks || [])) {
    if (p.status !== 'ACTIVE' || (p.family !== 'CORNERS' && p.family !== 'CARDS')) continue;
    const ko = +new Date(p.event.kickoff_at || 0);
    if (!ko || Date.now() - ko < 2.5 * 3600e3) continue; // el partido debe haber terminado
    // Final confirmado por el sync… O partido con KO hace >3h (el sync PODA los finales a las 3h — gotcha
    // 16-jul; sin este fallback las props de anoche quedaban ACTIVE para siempre). Las stats de AF solo
    // existen para partidos jugados → stats completas + 3h transcurridas = confirmación suficiente.
    const r = (db.clubResults || {})[clubScoreKey(p.league, p.event.home_team_id, p.event.away_team_id)];
    const syncFinal = !!(r && r.status === 'final');
    if (!syncFinal && Date.now() - ko < 3 * 3600e3) continue;
    try {
      const st = await clubMatchStats(p.league, p.event.home_team_id, p.event.away_team_id);
      if (!st || !st.home || !st.away) continue;
      const val = (o, k) => Number(o[k]) || 0;
      const tot = p.family === 'CORNERS'
        ? val(st.home, 'corners') + val(st.away, 'corners')
        : val(st.home, 'yellowCards') + val(st.home, 'redCards') + val(st.away, 'yellowCards') + val(st.away, 'redCards'); // amarillas+rojas = mismo conteo del modelo (fit: yellows+reds)
      if (p.family === 'CORNERS' && !(st.home.corners != null && st.away.corners != null)) continue;
      if (p.family === 'CARDS' && !(st.home.yellowCards != null && st.away.yellowCards != null)) continue;
      const over = tot > Number(p.line);
      p.status = 'SETTLED'; p.result_code = ((p.side === 'over') === over) ? 'WIN' : 'LOSS'; p.settled_at = new Date().toISOString(); settled++;
    } catch { /* siguiente pasada */ }
  }
  if (settled) save();
  return { settled };
}
// CLV fix (18-jul): las picks nacen horas antes del KO y el cierre las bate (CLV medio -4.7%, solo 21% positivo).
// En la VENTANA FINAL (KO ≤ 2h) refrescamos la mejor cuota ejecutable al precio ACTUAL del mercado (misma fuente
// del cierre, sportsbook_goal_quote_current): el usuario ve un precio que de verdad puede tomar y el CLV se mide
// desde ese precio. El precio de CREACIÓN queda preservado en odds_at_create (análisis de deriva). Cada ~20 min.
async function refreshClubPickPrices() {
  const dbc = require('./database/client');
  if (!dbc.isConfigured()) return { skipped: 'db_off' };
  const now = Date.now();
  let refreshed = 0;
  for (const p of (db.clubDailyPicks || [])) {
    if (p.status !== 'ACTIVE') continue;
    const ko = Date.parse((p.event && p.event.kickoff_at) || '');
    if (!isFinite(ko) || ko <= now || ko - now > 2 * 3600e3) continue;
    if (p.odds_refreshed_at && now - Date.parse(p.odds_refreshed_at) < 20 * 60e3) continue;
    const ceid = p.event && p.event.canonical_event_id;
    if (!ceid) continue;
    try {
      let rows = [];
      if (p.family === 'SOLID') {
        rows = (await dbc.query(`SELECT sportsbook_code b, odds_decimal::float o FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family='match_winner' AND lower(side)=$2 AND observed_at > now() - interval '3 hours'`, [ceid, String(p.selection_code || '').toLowerCase()])).rows;
      } else if (['GOALS', 'CORNERS', 'CARDS'].includes(p.family)) {
        const fam = p.family === 'GOALS' ? 'match_total' : p.family === 'CORNERS' ? 'corners_total' : 'cards_total';
        rows = (await dbc.query(`SELECT sportsbook_code b, odds_decimal::float o FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family=$2 AND line=$3 AND lower(side)=$4 AND observed_at > now() - interval '3 hours'`, [ceid, fam, p.line, String(p.side || '').toLowerCase()])).rows;
      } else if (p.family === 'PLAYER') {
        rows = (await dbc.query(`SELECT sportsbook_code b, odds_decimal::float o FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family=$2 AND team_scope=$3 AND observed_at > now() - interval '3 hours'`, [ceid, p.player_family, p.pid])).rows;
      }
      if (!rows.length) continue;
      const best = rows.slice().sort((a, b) => b.o - a.o)[0];
      if (p.odds_at_create == null) p.odds_at_create = p.best_odds;
      p.best_odds = +Number(best.o).toFixed(3); p.best_book = best.b; p.books = new Set(rows.map(r => r.b)).size;
      p.odds_refreshed_at = new Date().toISOString();
      refreshed++;
    } catch { /* siguiente ciclo */ }
  }
  if (refreshed) save();
  return { refreshed };
}
// P2: QUANT de clubes = la MISMA quantMetrics del Mundial (CLV, brier modelo-vs-mercado, calibración)
// sobre db.clubDailyPicks. PRIVADO admin (monitoreo pre-lanzamiento).
function clubDailyPicksQuant() {
  try { return require('./pick-engine/metrics').quantMetrics(db.clubDailyPicks || [], {}); } catch { return null; }
}
// P2: LÍNEA DE CIERRE + CLV para picks de clubes — misma matemática del Mundial (computeClv), fuente =
// sportsbook_goal_quote_current (TODAS las cuotas de clubes viven ahí keyed por el ceid del sweep; el evento
// sale de la ventana al arrancar → las filas quedan CONGELADAS en la última observación pre-KO = cierre).
// fair del cierre: no-vig por casa (mediana entre casas) — 1X2 con los 3 lados, totales con el par over/under;
// PLAYER (one-sided) usa la mediana implícita con vig (mismo caveat que en la creación, consistente para CLV).
async function captureClubPicksClosing({ force = false } = {}) {
  const dbc = require('./database/client');
  if (!dbc.isConfigured()) return { skipped: 'db_off' };
  const metrics = require('./pick-engine/metrics');
  const now = Date.now();
  let captured = 0, clvSet = 0, misses = 0;
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : null; };
  for (const p of (db.clubDailyPicks || [])) {
    if (p.result_code === 'SUPERSEDED') continue;
    const ko = Date.parse((p.event && p.event.kickoff_at) || '');
    if (!isFinite(ko) || ko > now) continue;
    if (p.closing && !force) { /* ya capturada */ }
    else {
      try {
        const ceid = p.event.canonical_event_id;
        const cutoff = new Date(ko + 30 * 60e3).toISOString(); // tolerancia: última observación hasta KO+30min
        let fair = null, odds = null, at = null;
        if (p.family === 'SOLID') {
          const r = await dbc.query(`SELECT sportsbook_code, side, odds_decimal::float o, observed_at FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family='match_winner' AND observed_at <= $2`, [ceid, cutoff]).catch(() => ({ rows: [] }));
          const byBook = {};
          for (const q of r.rows) { (byBook[q.sportsbook_code] = byBook[q.sportsbook_code] || {})[String(q.side).toLowerCase()] = q; }
          const sel = String(p.selection_code || '').toLowerCase();
          const fairs = [], oddsArr = [];
          for (const b of Object.values(byBook)) {
            if (!b.home || !b.draw || !b.away || !b[sel]) continue;
            const inv = 1 / b.home.o + 1 / b.draw.o + 1 / b.away.o;
            fairs.push((1 / b[sel].o) / inv); oddsArr.push(b[sel].o); at = b[sel].observed_at;
          }
          fair = med(fairs); odds = oddsArr.length ? Math.max(...oddsArr) : null;
        } else if (['GOALS', 'CORNERS', 'CARDS'].includes(p.family)) {
          const fam = p.family === 'GOALS' ? 'match_total' : p.family === 'CORNERS' ? 'corners_total' : 'cards_total';
          const r = await dbc.query(`SELECT sportsbook_code, side, odds_decimal::float o, observed_at FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family=$2 AND line=$3 AND observed_at <= $4`, [ceid, fam, p.line, cutoff]).catch(() => ({ rows: [] }));
          const byBook = {};
          for (const q of r.rows) { (byBook[q.sportsbook_code] = byBook[q.sportsbook_code] || {})[String(q.side).toLowerCase()] = q; }
          const side = String(p.side || '').toLowerCase();
          const fairs = [], oddsArr = [];
          for (const b of Object.values(byBook)) {
            if (!b.over || !b.under || !b[side]) continue;
            const pOver = (1 / b.over.o) / (1 / b.over.o + 1 / b.under.o);
            fairs.push(side === 'over' ? pOver : 1 - pOver); oddsArr.push(b[side].o); at = b[side].observed_at;
          }
          fair = med(fairs); odds = oddsArr.length ? Math.max(...oddsArr) : null;
        } else if (p.family === 'PLAYER') {
          const r = await dbc.query(`SELECT odds_decimal::float o, observed_at FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family=$2 AND team_scope=$3 AND observed_at <= $4`, [ceid, p.player_family, p.pid, cutoff]).catch(() => ({ rows: [] }));
          const implied = r.rows.map(q => 1 / q.o);
          fair = med(implied); odds = r.rows.length ? Math.max(...r.rows.map(q => q.o)) : null;
          at = r.rows.length ? r.rows[0].observed_at : null;
        }
        if (fair == null) { misses++; continue; }
        p.closing = { fair_prob: +fair.toFixed(6), odds: odds != null ? +odds.toFixed(4) : null, at: at || new Date(ko).toISOString() };
        captured++;
      } catch { misses++; continue; }
    }
    if (p.closing && (p.clv == null || force) && p.best_odds) {
      const c = metrics.computeClv(Number(p.best_odds), p.closing);
      if (c) { p.clv = c.clv_pct; p.clv_ev_pp = c.ev_close_pp; clvSet++; }
    }
  }
  if (captured || clvSet) save();
  return { captured, clv_set: clvSet, misses };
}
// track record de clubes por liga/familia/gate (misma matemática de unidades del Mundial: 1u por pick).
// PRIVADO: solo admin (monitoreo de la semana); jamás entra al rendimiento público.
function clubDailyPicksTrackRecord() {
  const agg = {};
  for (const p of (db.clubDailyPicks || [])) {
    if (p.status !== 'SETTLED' || !['WIN', 'LOSS', 'PUSH'].includes(p.result_code)) continue;
    const keys = ['overall', p.league, p.family, 'gate:' + (p.gate_status || 'shadow'), 'regime:' + (p.regime || 'pre')];
    if (p.family === 'SOLID') keys.push('solid_lever:' + (p.solid_lever ? 'on' : 'off')); // evaluación de la palanca (lunes)
    for (const key of keys) {
      const a = agg[key] = agg[key] || { n: 0, wins: 0, losses: 0, pushes: 0, pnl: 0 };
      a.n++;
      if (p.result_code === 'WIN') { a.wins++; a.pnl += (Number(p.best_odds) || 1) - 1; }
      else if (p.result_code === 'LOSS') { a.losses++; a.pnl -= 1; }
      else a.pushes++;
    }
  }
  for (const k in agg) { const a = agg[k]; const dec = a.wins + a.losses; a.hit_rate = dec ? +(a.wins / dec).toFixed(3) : null; a.roi = a.n ? +(a.pnl / a.n).toFixed(3) : null; a.pnl = +a.pnl.toFixed(2); }
  return agg;
}
// ===== F1 — MI CARTERA: helpers ==============================================================================
// Flags F1-F4 con TRES estados: off (default) / "admin" (solo admins la ven; el resto 404 = byte-idéntico) /
// "true" (abierta a todos). *On() = el feature corre en el proceso (loops/schedulers); featFor(u) = este
// usuario lo ve (gating de /api/me y endpoints).
function featFor(envName, u) {
  const v = String(process.env[envName] || '').trim();
  if (/^admin$/i.test(v)) return !!(u && u.isAdmin);
  return /^(1|true|yes|on)$/i.test(v);
}
function myBetsOn() { return /^(1|true|yes|on|admin)$/i.test(String(process.env.GP_MY_BETS_ENABLED || '').trim()); }
// Mi cartera (F1) = EXCLUSIVA del plan Sharp (post-Mundial 20-jul): flag encendido + plan efectivo 'sharp'.
// Admin y fase pre-enforcement resuelven a 'sharp' (effectivePlan) → sin cambios hasta aplicar el gating.
function myBetsSharp(u) { return myBetsOn() && featFor('GP_MY_BETS_ENABLED', u) && effectivePlan(u && u.email) === 'sharp'; }
// RECONCILIACIÓN DE PAGOS (20-jul): red de seguridad contra webhooks de Whop perdidos. Compara las membresías
// ACTIVAS de Whop (fuente de verdad de quién pagó) contra db.premiumGrants y linkea/corrige las que falten.
// Idempotente y SILENCIOSA (no manda emails; el webhook es la vía de bienvenida). Corre en schedule + endpoint.
async function reconcileWhopGrants() {
  const key = process.env.WHOP_API_KEY; if (!key) return { skipped: 'no_key' };
  const csv = (k) => (process.env[k] || '').split(',').map(s => s.trim()).filter(Boolean);
  const sharpIds = csv('WHOP_PLAN_SHARP_IDS'), proIds = csv('WHOP_PLAN_PRO_IDS'), founderIds = csv('WHOP_FOUNDER_PLAN_IDS');
  const out = { checked: 0, ok: 0, fixed: 0, unmatched_plan: 0, no_email: 0, fixes: [], at: new Date().toISOString() };
  try {
    const mems = [];
    for (let page = 1; page <= 6; page++) {
      const r = await fetch(`https://api.whop.com/api/v2/memberships?per=50&page=${page}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) break;
      const j = await r.json().catch(() => ({}));
      const data = j.data || [];
      mems.push(...data);
      if (data.length < 50) break;
    }
    for (const m of mems) {
      const valid = m.valid === true || m.status === 'active' || m.status === 'trialing' || m.status === 'completed';
      if (!valid) continue;
      const email = String(m.email || '').toLowerCase();
      const planId = String(m.plan_id || (typeof m.plan === 'string' ? m.plan : (m.plan && m.plan.id)) || '');
      const plan = sharpIds.includes(planId) ? 'sharp' : proIds.includes(planId) ? 'pro' : null;
      if (!email) { out.no_email++; continue; }
      if (!plan) { out.unmatched_plan++; continue; }
      out.checked++;
      const g = db.premiumGrants[email];
      const good = g && g.status === 'active' && (g.plan === plan || (plan === 'pro' && g.plan === 'sharp')); // sharp cubre pro
      if (good) { out.ok++; continue; }
      db.premiumGrants[email] = {
        plan, status: 'active', founder: founderIds.includes(planId) || undefined,
        source: 'whop_reconcile', whop_membership_id: m.id || null, whop_plan_id: planId,
        since: (g && g.since) || new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      out.fixed++; out.fixes.push({ email, plan, was: g ? g.status : 'missing' });
    }
    if (out.fixed) save();
  } catch (e) { out.error = e.message; }
  return out;
}
function myBetsFindPick(pickId) {
  return (db.dailyPicks || []).find(x => x.pick_id === pickId) || (db.clubDailyPicks || []).find(x => x.pick_id === pickId) || null;
}
function myBetsStats(list) {
  const settled = list.filter(b => b.result === 'won' || b.result === 'lost');
  const agg = rows => {
    let pnl = 0, staked = 0, wins = 0;
    for (const b of rows) { staked += b.stake; if (b.result === 'won') { pnl += b.stake * (b.odds - 1); wins++; } else pnl -= b.stake; }
    return { n: rows.length, wins, losses: rows.length - wins, pnl: +pnl.toFixed(2), staked: +staked.toFixed(2), roi: staked > 0 ? +(pnl / staked).toFixed(3) : null };
  };
  // CLV personal: la cuota que TOMÓ el usuario vs el cierre capturado de la pick (misma matemática oficial).
  const { computeClv } = require('./pick-engine/metrics');
  const clvs = [];
  for (const b of list) {
    if (!b.pick_id) continue;
    const pk = myBetsFindPick(b.pick_id);
    if (pk && pk.closing) { const c = computeClv(b.odds, pk.closing); if (c && c.clv_pct != null) clvs.push(c.clv_pct); }
  }
  const open = list.filter(b => b.result === 'open');
  return {
    overall: agg(settled),
    gp: agg(settled.filter(b => b.pick_id)),        // siguiendo picks GP
    manual: agg(settled.filter(b => !b.pick_id)),   // apuestas propias (override)
    open_count: open.length, open_stake: +open.reduce((a, b) => a + b.stake, 0).toFixed(2),
    clv: clvs.length ? { n: clvs.length, avg_pct: +(clvs.reduce((a, x) => a + x, 0) / clvs.length).toFixed(2), positive_rate: +(clvs.filter(x => x > 0).length / clvs.length).toFixed(3) } : null,
  };
}
// ===== F2 — MIS CASAS (flag GP_MY_BOOKS_ENABLED): las casas del usuario filtran feed/value/arb en el cliente =
function myBooksOn() { return /^(1|true|yes|on|admin)$/i.test(String(process.env.GP_MY_BOOKS_ENABLED || '').trim()); }
// Índice "qué casas cotizan cada pick": UNA query sobre sportsbook_goal_quote_current para los eventos de las
// picks activas (frescura 48h), agrupada por (familia, línea, lado, scope) → books_list por pick en el feed.
// El cliente filtra "solo mis casas" con esto. Memo 5 min. Pick sin filas (p.ej. SOLID del Mundial, cuya serie
// vive en goal_value_shadow) → books_list null = el filtro NO la oculta (desconocido ≠ no disponible).
let _booksIdx = { at: 0, map: null };
async function picksBooksIndex() {
  const dbc = require('./database/client');
  if (!dbc.isConfigured()) return {};
  if (_booksIdx.map && Date.now() - _booksIdx.at < 5 * 60e3) return _booksIdx.map;
  // SOLO ceids con forma de UUID: la columna es uuid — un solo id sintético no-UUID (p.ej. seeds de QA) haría
  // fallar la query ENTERA y dejaría a todas las picks sin books_list.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ceids = [...new Set([...(db.dailyPicks || []), ...(db.clubDailyPicks || [])]
    .filter(x => x.status === 'ACTIVE' && x.event && UUID_RE.test(String(x.event.canonical_event_id || '')))
    .map(x => x.event.canonical_event_id))];
  const map = {};
  if (ceids.length) {
    const r = await dbc.query(
      `SELECT canonical_event_id ceid, market_family fam, line::float line, lower(side) side, team_scope scope,
              array_agg(DISTINCT sportsbook_code) books
         FROM sportsbook_goal_quote_current
        WHERE canonical_event_id = ANY($1) AND observed_at > now() - interval '48 hours'
        GROUP BY 1,2,3,4,5`, [ceids]).catch(() => ({ rows: [] }));
    for (const row of r.rows) (map[row.ceid] = map[row.ceid] || []).push({ fam: row.fam, line: row.line, side: row.side, scope: row.scope, books: row.books });
  }
  _booksIdx = { at: Date.now(), map };
  return map;
}
function booksListFor(map, x) {
  const ceid = x.event && x.event.canonical_event_id;
  const rows = ceid && map[ceid];
  if (!rows || !rows.length) return null;
  const eq = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) < 0.01;
  let hit = null;
  if (x.family === 'SOLID') hit = rows.find(r => r.fam === 'match_winner' && r.side === String(x.selection_code || '').toLowerCase());
  else if (x.family === 'GOALS') hit = rows.find(r => r.fam === 'match_total' && r.side === String(x.side || '').toLowerCase() && eq(r.line, x.line));
  else if (x.family === 'CORNERS') hit = rows.find(r => r.fam === 'corners_total' && r.side === String(x.side || '').toLowerCase() && eq(r.line, x.line));
  else if (x.family === 'CARDS') hit = rows.find(r => r.fam === 'cards_total' && r.side === String(x.side || '').toLowerCase() && eq(r.line, x.line));
  else if (x.family === 'PLAYER') hit = rows.find(r => r.fam === x.player_family && r.scope === x.pid);
  return hit ? hit.books : null;
}
// ===== F3 — WATCH PRICE (flag GP_WATCH_PRICE_ENABLED): alerta cuando la mejor cuota alcanza el objetivo ======
// El watch se ancla a una PICK activa (su mercado ya lo observa el sweep → cuotas frescas en Postgres). El
// chequeo corre en el ciclo de 15min con la MISMA fuente del cierre oficial (sportsbook_goal_quote_current);
// al disparar: email al usuario (mailer) + estado "alcanzado" en la lista in-app. KO pasado → watch vencido.
function watchPriceOn() { return /^(1|true|yes|on|admin)$/i.test(String(process.env.GP_WATCH_PRICE_ENABLED || '').trim()); }
async function currentBestOddsForPick(pk) {
  const dbc = require('./database/client');
  if (!dbc.isConfigured() || !pk || !pk.event || !pk.event.canonical_event_id) return null;
  const ceid = pk.event.canonical_event_id;
  try {
    if (pk.family === 'SOLID') {
      const r = await dbc.query(`SELECT max(odds_decimal)::float o FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family='match_winner' AND lower(side)=$2`, [ceid, String(pk.selection_code || '').toLowerCase()]);
      return (r.rows[0] && r.rows[0].o) || null;
    }
    if (['GOALS', 'CORNERS', 'CARDS'].includes(pk.family)) {
      const fam = pk.family === 'GOALS' ? 'match_total' : pk.family === 'CORNERS' ? 'corners_total' : 'cards_total';
      const r = await dbc.query(`SELECT max(odds_decimal)::float o FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family=$2 AND line=$3 AND lower(side)=$4`, [ceid, fam, pk.line, String(pk.side || '').toLowerCase()]);
      return (r.rows[0] && r.rows[0].o) || null;
    }
    if (pk.family === 'PLAYER') {
      const r = await dbc.query(`SELECT max(odds_decimal)::float o FROM sportsbook_goal_quote_current WHERE canonical_event_id=$1 AND market_family=$2 AND team_scope=$3`, [ceid, pk.player_family, pk.pid]);
      return (r.rows[0] && r.rows[0].o) || null;
    }
  } catch { return null; }
  return null;
}
async function checkPriceWatches() {
  if (!watchPriceOn()) return { skipped: 'off' };
  const ws = db.priceWatches = db.priceWatches || [];
  let checked = 0, fired = 0;
  const now = Date.now();
  for (const w of ws) {
    if (w.triggered_at || w.dead) continue;
    const pk = myBetsFindPick(w.pick_id);
    if (!pk) { w.dead = true; continue; }
    const ko = Date.parse((pk.event && pk.event.kickoff_at) || '');
    if (isFinite(ko) && ko < now) { w.dead = true; continue; }
    const o = await currentBestOddsForPick(pk);
    checked++;
    if (o != null) { w.last_odds = +o.toFixed(3); w.last_check = new Date().toISOString(); }
    if (o != null && o >= w.target_odds) {
      w.triggered_at = new Date().toISOString(); fired++;
      try {
        if (mailer.isConfigured()) {
          const en = userLang(w.email) === 'en';
          await mailer.sendMail({
            to: w.email, // Resend (dominio propio): el relay GAS es SOLO para OTP (cuota Gmail, jamás notificaciones)
            subject: en ? `Price alert: ${w.label} hit ${o.toFixed(2)}` : `Alerta de precio: ${w.label} llegó a ${o.toFixed(2)}`,
            text: en
              ? `Your watched price triggered: ${w.label} is now at ${o.toFixed(2)} (your target: ${w.target_odds.toFixed(2)}). Prices move — check the platform before betting. https://gpsimulador.com`
              : `Tu precio vigilado se disparó: ${w.label} está ahora en ${o.toFixed(2)} (tu objetivo: ${w.target_odds.toFixed(2)}). Los precios se mueven — revisá la plataforma antes de apostar. https://gpsimulador.com`,
          });
        }
      } catch { /* la alerta in-app queda igual */ }
    }
  }
  if (checked) save();
  return { checked, fired };
}
// ===== F4 — GP DAILY BRIEF (flag GP_DAILY_BRIEF_ENABLED) =====================================================
// Un solo builder (memo 10min) alimenta los 3 canales: in-app (/api/me/brief), email diario (SOLO opt-in del
// usuario: users[email].brief_email) y Telegram del canal (flag aparte GP_DAILY_BRIEF_TELEGRAM_ENABLED, off).
// Contenido 100% derivado de lo que ya existe: picks activas 24h (top 3 por edge), partidos del día (eventos de
// esas picks), movimientos de línea (line_move), hallazgos del observer y liquidadas de ayer.
function dailyBriefOn() { return /^(1|true|yes|on|admin)$/i.test(String(process.env.GP_DAILY_BRIEF_ENABLED || '').trim()); }
function buildDailyBrief() {
  const now = Date.now();
  if (global._dailyBrief && now - global._dailyBrief.at < 10 * 60e3) return global._dailyBrief.data;
  const all = [...(db.dailyPicks || []), ...(db.clubDailyPicks || [])];
  const in24 = p => { const ko = Date.parse((p.event && p.event.kickoff_at) || ''); return isFinite(ko) && ko > now && ko < now + 24 * 3600e3; };
  const active = all.filter(x => x.status === 'ACTIVE' && in24(x));
  const top = active.slice().sort((a, b) => (b.edge_pp || 0) - (a.edge_pp || 0)).slice(0, 3).map(p => ({
    pick_id: p.pick_id, family: p.family, league: p.competition_name || null,
    home: p.event.home, away: p.event.away, kickoff: p.event.kickoff_at,
    side: p.side, line: p.line, selection_code: p.selection_code, player_name: p.player_name || null, player_family: p.player_family || null,
    odds: p.best_odds, book: p.best_book, edge_pp: p.edge_pp != null ? +Number(p.edge_pp).toFixed(1) : null,
    confidence: p.confidence, regime: p.regime || null,
    club_eid: p.event.club_eid || null, event_id: p.event.is_canonical ? p.event.canonical_event_id : null,
    home_team_id: p.event.home_team_id, away_team_id: p.event.away_team_id,
  }));
  const evs = {};
  active.forEach(p => {
    const k = p.event.club_eid || p.event.canonical_event_id;
    const e = evs[k] = evs[k] || { home: p.event.home, away: p.event.away, home_team_id: p.event.home_team_id, away_team_id: p.event.away_team_id, kickoff: p.event.kickoff_at, league: p.competition_name || null, picks: 0, club_eid: p.event.club_eid || null };
    e.picks++;
  });
  const matches = Object.values(evs).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff)).slice(0, 8);
  const moves = active.filter(p => p.line_move && p.line_move.direction && p.line_move.direction !== 'flat' && p.line_move.pp != null)
    .sort((a, b) => Math.abs(b.line_move.pp) - Math.abs(a.line_move.pp)).slice(0, 3)
    .map(p => ({ home: p.event.home, away: p.event.away, family: p.family, pp: p.line_move.pp, direction: p.line_move.direction }));
  const findings = [];
  try {
    const { assessPlayers } = require('./observer/assess');
    const { narratePlayer } = require('./observer/narrate');
    const teams = new Set();
    active.forEach(p => { if (p.event.home_team_id) teams.add(p.event.home_team_id); if (p.event.away_team_id) teams.add(p.event.away_team_id); });
    for (const tm of teams) {
      const sig = (((db.clubObservations || {})[tm] || {}).signals) || (((db.observations || {})[tm] || {}).signals) || [];
      if (!sig.length) continue;
      const asmts = assessPlayers(sig);
      for (const x of Object.values(asmts)) {
        if (!(x.prob_miss > 0)) continue;
        const nar = narratePlayer(x) || {};
        if (nar.es || nar.en) findings.push({ team_id: tm, player: x.player, status: x.status, why_es: nar.es || null, why_en: nar.en || null });
        if (findings.length >= 5) break;
      }
      if (findings.length >= 5) break;
    }
  } catch { /* sin observer → sección vacía */ }
  const settled = all.filter(x => x.status === 'SETTLED' && x.settled_at && (now - Date.parse(x.settled_at)) < 24 * 3600e3 && ['WIN', 'LOSS', 'PUSH'].includes(x.result_code));
  const yesterday = {
    n: settled.length, wins: settled.filter(x => x.result_code === 'WIN').length, losses: settled.filter(x => x.result_code === 'LOSS').length,
    rows: settled.slice(0, 8).map(p => ({ home: p.event.home, away: p.event.away, family: p.family, result: p.result_code, odds: p.best_odds, league: p.competition_name || null })),
  };
  const data = { generated_at: new Date().toISOString(), top_picks: top, matches, line_moves: moves, findings, yesterday };
  global._dailyBrief = { at: now, data };
  return data;
}
function briefPickText(p, en) {
  const sel = p.family === 'SOLID' ? (p.selection_code === 'home' ? p.home : p.selection_code === 'away' ? p.away : (en ? 'Draw' : 'Empate'))
    : p.family === 'PLAYER' ? `${p.player_name || ''} ${p.player_family === 'player_goal' ? (en ? 'scores' : 'anota') : p.player_family === 'player_assist' ? (en ? 'assists' : 'asiste') : ''}`.trim()
    : `${p.side === 'over' ? 'Over' : 'Under'} ${p.line}${p.family === 'CORNERS' ? (en ? ' corners' : ' córners') : p.family === 'CARDS' ? (en ? ' cards' : ' tarjetas') : ''}`;
  return `${p.home} v ${p.away}: ${sel}${p.odds ? ' @' + Number(p.odds).toFixed(2) : ''}${p.edge_pp != null ? ' (+' + p.edge_pp + 'pp)' : ''}`;
}
function dailyBriefEmailText(b, en) {
  const L = [];
  L.push(en ? 'GP DAILY BRIEF' : 'GP DAILY BRIEF');
  if (b.top_picks.length) {
    L.push('');
    L.push(en ? 'Top opportunities today:' : 'Top oportunidades de hoy:');
    b.top_picks.forEach((p, i) => L.push(`${i + 1}. ${briefPickText(p, en)}${p.league ? ' · ' + p.league : ''}`));
  }
  if (b.yesterday.n) { L.push(''); L.push(en ? `Yesterday: ${b.yesterday.wins}W-${b.yesterday.losses}L of ${b.yesterday.n} settled` : `Ayer: ${b.yesterday.wins}G-${b.yesterday.losses}P de ${b.yesterday.n} liquidadas`); }
  if (b.line_moves.length) {
    L.push(''); L.push(en ? 'Line moves:' : 'Movimientos de línea:');
    b.line_moves.forEach(m => L.push(`· ${m.home} v ${m.away} (${m.family}): ${m.pp > 0 ? '+' : ''}${m.pp}pp ${m.direction === 'with' ? (en ? 'toward our side' : 'a favor') : (en ? 'against' : 'en contra')}`));
  }
  if (b.findings.length) {
    L.push(''); L.push(en ? 'Availability watch:' : 'Radar de bajas:');
    b.findings.forEach(f => L.push('· ' + ((en ? f.why_en : f.why_es) || f.player)));
  }
  L.push('');
  L.push(en ? 'Full analysis: https://gpsimulador.com' : 'Análisis completo: https://gpsimulador.com');
  L.push(en ? 'Model estimates, not financial advice.' : 'Estimaciones de un modelo estadístico, no consejo financiero.');
  return L.join('\n');
}
async function sendDailyBriefEmails() {
  if (!dailyBriefOn() || !mailer.isConfigured()) return { skipped: 'off' };
  const b = buildDailyBrief();
  if (!b.top_picks.length && !b.yesterday.n) return { skipped: 'empty' };
  let sent = 0;
  for (const [email, u] of Object.entries(db.users || {})) {
    if (!u || !u.brief_email) continue;
    const en = userLang(email) === 'en';
    try {
      await mailer.sendMail({
        to: email, // Resend (dominio propio): el relay GAS es SOLO para OTP (cuota Gmail, jamás masivos)
        subject: en ? 'GP Daily Brief — today\'s opportunities' : 'GP Daily Brief — las oportunidades de hoy',
        text: dailyBriefEmailText(b, en),
      });
      sent++;
    } catch { /* siguiente */ }
  }
  return { sent };
}
async function dailyBriefTick() {
  if (!dailyBriefOn()) return;
  const now = new Date(), day = now.toISOString().slice(0, 10), h = now.getUTCHours();
  if (h < 13 || h >= 16 || db.sentBriefDay === day) return;
  db.sentBriefDay = day; save(); // marcar ANTES de enviar: jamás doble envío masivo
  try { await sendDailyBriefEmails(); } catch { }
  try {
    if (/^(1|true|yes|on)$/i.test(String(process.env.GP_DAILY_BRIEF_TELEGRAM_ENABLED || '').trim()) && telegram.configured()) {
      const b = buildDailyBrief();
      if (b.top_picks.length) {
        const lines = b.top_picks.map((p, i) => `${i + 1}. ${briefPickText(p, false)}${p.league ? ' · ' + p.league : ''}`);
        await telegram.post(`🗞 <b>GP Daily Brief</b>\n\n${lines.join('\n')}\n\n👉 <a href="https://gpsimulador.com/?ref=tg">Análisis completo</a>`);
      }
    }
  } catch { }
}
if (dailyBriefOn()) setInterval(() => dailyBriefTick().catch(() => { }), 30 * 60 * 1000);
// ===== P2.5 — PASADAS AUTOMÁTICAS DE DATA (post-jornada) =====================================================
// Corre los backfills de clubes (props-history AF, results TSA, player-history TSA, FotMob) UNA vez al día
// como procesos hijos (los scripts son incrementales/resumibles por done[]). En prod los archivos autoritativos
// viven en el DISCO (/data/clubs) y el repo-dir está vacío post-deploy → HIDRATAR disco→repo antes de correr
// (sin esto cada pase re-descargaría todo) y PUBLICAR repo→disco después (los memos del server invalidan por
// mtime → gates/tactical/xG/settlement se refrescan solos). Kill switch: GP_CLUBS_DATA_PASS_ENABLED=false.
function clubsDataPassOn() { return !/^(0|false|no|off)$/i.test(String(process.env.GP_CLUBS_DATA_PASS_ENABLED || 'true').trim()); }
const CLUB_DATA_FILE_RE = /^(player-history-|results-|props-history-|fotmob-)[a-z0-9]+\.json$|^(player-photos|af-team-map)\.json$/;
let _dataPassRunning = false;
async function clubsDataPass({ force = false } = {}) {
  if (!clubsShadowOn() || !clubsDataPassOn()) return { skipped: 'off' };
  if (_dataPassRunning) return { skipped: 'running' };
  const today = new Date().toISOString().slice(0, 10);
  if (!force && db.clubsDataPassDay === today) return { skipped: 'done_today' };
  _dataPassRunning = true;
  const out = { day: today, scripts: {}, hydrated: 0, published: [] };
  const repoDir = path.join(__dirname, 'data', 'clubs');
  const onDisk = (() => { try { return fs.existsSync(CLUB_DATA_DISK) && path.resolve(CLUB_DATA_DISK) !== path.resolve(repoDir); } catch { return false; } })();
  try {
    // 1) hidratar repo←disco (los scripts leen/escriben el repo-dir; el done[] vive en los archivos)
    if (onDisk) {
      for (const f of fs.readdirSync(CLUB_DATA_DISK)) {
        if (!CLUB_DATA_FILE_RE.test(f)) continue;
        const src = path.join(CLUB_DATA_DISK, f), dst = path.join(repoDir, f);
        try { const s = fs.statSync(src); const d = fs.existsSync(dst) ? fs.statSync(dst) : null; if (!d || s.size !== d.size) { fs.copyFileSync(src, dst); out.hydrated++; } } catch { /* siguiente */ }
      }
    }
    // 2) backfills secuenciales (timeout 25min c/u; scripts incrementales → jornada nueva = pocos requests).
    // Solo ligas ACTIVAS (sin starts): el pase diario alimenta settlement/gates/tactical de la semana; las
    // ligas de pretemporada (EU) se backfillean aparte al arrancar (bajar su season completa acá agotaba el
    // timeout — visto con premier en el QA del pase).
    let actives = [];
    try {
      if (!global._clubsRatings) global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8'));
      actives = Object.keys(global._clubsRatings.leagues || {}).filter(k => !global._clubsRatings.leagues[k].starts);
    } catch { actives = []; }
    const { spawn } = require('child_process');
    const runScript = (file, args = []) => new Promise((resolve) => {
      const ps = spawn(process.execPath, [path.join(__dirname, 'scripts', file), ...args], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let tail = ''; const cap = (d) => { tail = (tail + d.toString()).slice(-600); };
      const to = setTimeout(() => { try { ps.kill('SIGKILL'); } catch { } }, 25 * 60e3);
      ps.stdout.on('data', cap); ps.stderr.on('data', cap);
      ps.on('close', (code) => { clearTimeout(to); resolve({ code, tail: tail.trim().split('\n').slice(-2).join(' | ').slice(-240) }); });
      ps.on('error', (e) => { clearTimeout(to); resolve({ code: -1, tail: e.message }); });
    });
    out.leagues = actives;
    out.scripts.props = await runScript('clubs-props-backfill.js', actives);
    out.scripts.results = await runScript('clubs-results-backfill.js', actives);
    out.scripts.players = await runScript('clubs-player-backfill.js', actives);
    out.scripts.fotmob = await runScript('clubs-fotmob-backfill.js', actives);
    // 3) publicar repo→disco (equivalente in-server de upload-clubs-data.sh) + invalidar memos en memoria
    if (onDisk) {
      for (const f of fs.readdirSync(repoDir)) {
        if (!CLUB_DATA_FILE_RE.test(f)) continue;
        const src = path.join(repoDir, f), dst = path.join(CLUB_DATA_DISK, f);
        try { const s = fs.statSync(src); const d = fs.existsSync(dst) ? fs.statSync(dst) : null; if (!d || s.mtimeMs > d.mtimeMs) { fs.copyFileSync(src, dst); out.published.push(f); } } catch { /* siguiente */ }
      }
    }
    global._clubsResults = {}; // memos por mtime (props/style/goals) se invalidan solos; results usa cache simple
    db.clubsDataPassDay = today; save();
  } catch (e) { out.error = e.message; }
  finally { _dataPassRunning = false; }
  console.log('[clubs-data-pass]', JSON.stringify(out).slice(0, 900));
  return out;
}
// scheduler: chequeo cada 30 min; corre a partir de las 07:00Z (post-jornada americana) si hoy no corrió.
if (clubsShadowOn() && clubsDataPassOn()) {
  setInterval(() => { try { if (new Date().getUTCHours() >= 7) clubsDataPass().catch(() => { }); } catch { } }, 30 * 60e3);
  // RECONCILIACIÓN DE PAGOS (red de seguridad anti-webhook-perdido): al boot + cada 6h linkea grants faltantes.
  setTimeout(() => { reconcileWhopGrants().then(r => { if (r && r.fixed) console.log('[reconcile-grants]', JSON.stringify(r)); }).catch(() => { }); }, 90 * 1000);
  setInterval(() => { reconcileWhopGrants().then(r => { if (r && r.fixed) console.log('[reconcile-grants]', JSON.stringify(r)); }).catch(() => { }); }, 6 * 3600 * 1000);
}
async function evaluateClubDailyPicks() {
  if (!dailyPicksOn() || !clubsShadowOn()) return { skipped: 'off' };
  if (_clubPicksRunning) return { skipped: 'running' };
  _clubPicksRunning = true;
  try {
    const b = await buildClubDailyPicks();
    const s = settleClubDailyPicks();
    const sp = await settleClubPropsViaAf().catch(() => ({ settled: 0 })); // F3.4: córners/tarjetas vía AF stats
    const rf = await refreshClubPickPrices().catch(() => ({ refreshed: 0 })); // CLV fix: precio ejecutable en la ventana final
    const cl = await captureClubPicksClosing().catch(() => ({ captured: 0 })); // P2: cierre + CLV (misma matemática del Mundial)
    _clubPicksLast = { at: new Date().toISOString(), build: b, settle: s, settle_props: sp, refresh: rf, closing: cl };
    if (b.added || s.settled || sp.settled || cl.captured) console.log('[clubs-picks]', JSON.stringify({ added: b.added, settled: s.settled, props_settled: sp.settled, closing: cl.captured, eligible: b.eligible }));
    return _clubPicksLast;
  } finally { _clubPicksRunning = false; }
}
// Timer del ENVÍO PROGRAMADO (broadcast one-shot): chequea cada 5 min; al vencer, marca done ANTES de disparar
// (jamás doble masivo) y re-entra por el propio endpoint con la GP_EXPORT_KEY → reusa toda la lógica de envío.
setInterval(() => {
  try {
    const sb = db.scheduledBroadcast;
    if (!sb || sb.done || !sb.at || Date.now() < Date.parse(sb.at)) return;
    if (typeof bcastState === 'object' && bcastState.running) return; // hay un envío en curso → próximo tick
    sb.done = true; sb.fired_at = new Date().toISOString(); save();
    const xk = process.env.GP_EXPORT_KEY || '';
    if (!xk) { console.error('[broadcast-sched] sin GP_EXPORT_KEY, no puedo disparar'); return; }
    fetch(`http://127.0.0.1:${PORT}/api/admin/broadcast?key=${xk}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant: sb.variant }) })
      .then(r => r.json()).then(j => console.log('[broadcast-sched] disparado', sb.variant, JSON.stringify(j).slice(0, 120)))
      .catch(e => console.error('[broadcast-sched]', e.message));
  } catch (e) { console.error('[broadcast-sched]', e.message); }
}, 5 * 60e3);
if (dailyPicksOn() && clubsShadowOn()) {
  setTimeout(() => evaluateClubDailyPicks().catch(() => { }), 180 * 1000);
  setInterval(() => evaluateClubDailyPicks().catch(() => { }), 15 * 60 * 1000);
}
// F3 Watch price: chequeo en el MISMO ritmo de 15min (las cuotas frescas llegan con los sweeps; el chequeo
// lee sportsbook_goal_quote_current — la fuente del cierre oficial). Flag off → no-op.
if (watchPriceOn()) {
  setTimeout(() => checkPriceWatches().catch(() => { }), 240 * 1000);
  setInterval(() => checkPriceWatches().catch(() => { }), 15 * 60 * 1000);
}
// perfil de disponibilidad narrado de UN jugador de club (para el perfil cplayer).
function clubPlayerAvail(tmId, pid) {
  const slot = db.clubObservations[tmId];
  if (!slot || !slot.signals) return null;
  try {
    const { assessPlayers } = require('./observer/assess');
    const { narratePlayer } = require('./observer/narrate');
    const a = assessPlayers(slot.signals)[pid];
    if (!a || !a.prob_miss) return null;
    const nar = narratePlayer(a);
    return { status: a.status, prob_miss: a.prob_miss, es: nar && nar.es, en: nar && nar.en };
  } catch { return null; }
}
function propPlayerPid(teamCode, rawName) {
  const t = propRoster().byTeam[teamCode]; if (!t) return null;
  const n = _propNorm(rawName);
  if (t.full[n]) return t.full[n];
  const last = _propNorm(String(rawName).trim().split(/\s+/).pop());
  return t.last[last] || null;
}
const _median = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2 : null; };
const _nbOver = (mu, r, line) => { const { nbPmf } = require('./goal-engine/negativeBinomial'); if (!(mu > 0)) return 0; let u = 0; for (let k = 0; k <= Math.floor(line); k++) u += nbPmf(mu, r, k); return Math.max(0, Math.min(1, 1 - u)); };

async function evaluateUpcomingProps() {
  if (!propsOn()) return { skipped: 'disabled' };
  if (_propsRunning) return { skipped: 'running' };
  if (Date.now() - _propsLastRunMs < 100 * 60 * 1000) return { skipped: 'not_due' }; // cadencia ~100 min (créditos)
  const KEY = process.env.SPORTSBOOK_PROVIDER_API_KEY;
  if (!KEY) return { skipped: 'no_key' };
  const dbcfg = require('./database/config');
  if (!dbcfg.db || !dbcfg.db.configured) return { skipped: 'no_db' };
  if (_propsCredits != null && _propsCredits < 2000) return { skipped: 'quota_reserve', credits_remaining: _propsCredits };
  _propsRunning = true; _propsLastRunMs = Date.now();
  const out = { events: 0, team_quotes: 0, team_value: 0, player_quotes: 0, player_value: 0, errors: 0, started: new Date().toISOString() };
  try {
    const dbc = require('./database/client');
    const grepo = require('./goal-engine/repository');
    const noVig = require('./goal-engine/noVig');
    const propModel = require('./prop-engine/model');
    const players = require('./prop-engine/players');
    const F = propFit();
    const PF = (() => { try { return players.fitPlayers(require('./data/player-props-history.json').matches); } catch { return null; } })();
    // eventos próximos del proveedor + mapa de canónicos futuros por par
    const evsR = await fetch(`https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/events?apiKey=${KEY}`, { signal: AbortSignal.timeout(15000) });
    const evs = evsR.ok ? await evsR.json() : [];
    const ces = (await dbc.query(`SELECT id, home_participant, away_participant, scheduled_start FROM canonical_events WHERE scheduled_start > now()`)).rows;
    const ceByPair = {};
    for (const ce of ces) {
      const h = aliasToId[normName(ce.home_participant)], a = aliasToId[normName(ce.away_participant)];
      if (h && a) ceByPair[h + '~' + a] = ce;
    }
    for (const ev of (evs || []).slice(0, 10)) {
      if (!ev.commence_time || +new Date(ev.commence_time) <= Date.now()) continue;
      const hCode = aliasToId[normName(ev.home_team)], aCode = aliasToId[normName(ev.away_team)];
      const ce = hCode && aCode ? ceByPair[hCode + '~' + aCode] : null;
      if (!ce) continue;
      out.events++;
      const xg = gpXgFromCache(hCode, aCode) || {};
      // λ del partido con el factor del observer aplicado (bajas/dudas del once → menos generación).
      const lambdas = (xg.xgA > 0 && xg.xgB > 0)
        ? { home: xg.xgA * observerLambdaFactor(hCode), away: xg.xgB * observerLambdaFactor(aCode) }
        : null;
      // Contexto del partido para el prop-engine: FASE (multiplicador aprendido grupos/eliminatoria) y
      // PARIDAD 1X2 del modelo (partido parejo → más tarjetas). Antes se proyectaba "en el vacío".
      let closeness = null;
      try { const bp = matchProbs(effElo(db.elos, hCode), effElo(db.elos, aCode)); closeness = { home: bp.home, draw: bp.draw, away: bp.away }; } catch { /* sin Elo → sin paridad */ }
      const proj = F ? propModel.project(F, { home: hCode, away: aCode, lambdas, phase: pairPhase(hCode, aCode), closeness1x2: closeness }) : null;
      // ---- CÓRNERS / TARJETAS ----
      try {
        const r1 = await fetch(`https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/events/${ev.id}/odds?apiKey=${KEY}&regions=${ODDS_REGIONS_PROPS}&markets=alternate_totals_corners,alternate_totals_cards&oddsFormat=decimal`, { signal: AbortSignal.timeout(15000) });
        const rem1 = Number(r1.headers.get('x-requests-remaining')); if (Number.isFinite(rem1)) _propsCredits = rem1;
        const d1 = r1.ok ? await r1.json() : null;
        const groups = {}; // fam|line → [{book, side, odds}]
        for (const bk of (d1 && d1.bookmakers) || []) {
          for (const m of bk.markets || []) {
            const fam = m.key === 'alternate_totals_corners' ? 'corners_total' : m.key === 'alternate_totals_cards' ? 'cards_total' : null;
            if (!fam) continue;
            for (const o of m.outcomes || []) {
              const side = /under/i.test(o.name) ? 'under' : 'over';
              const line = Number(o.point), odds = Number(o.price);
              if (!Number.isFinite(line) || !(odds >= 1.05 && odds <= 51)) continue;
              if (Math.abs(line * 10 % 5) > 0.001) continue; // solo .0/.5; el settle usa .5 (sin push en .5)
              const tag = String(line).replace('.', '_');
              const mid = (fam === 'corners_total' ? 'CORNERS_' : 'CARDS_') + side.toUpperCase() + '_' + tag;
              await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: bk.key, external_event_id: ev.id, canonical_event_id: ce.id, market_family: fam, line, side, team_scope: 'total', market_id: mid, odds_decimal: odds, implied_probability: 1 / odds, quote_status: 'open', is_live: false, provider_update: bk.last_update }).catch(() => { });
              out.team_quotes++;
              (groups[fam + '|' + line] = groups[fam + '|' + line] || []).push({ sportsbook_code: bk.key, independence_group: bk.key, side, odds_decimal: odds, quote_status: 'open', is_live: false });
            }
          }
        }
        if (proj) {
          for (const [k, quotes] of Object.entries(groups)) {
            const [fam, lineStr] = k.split('|'); const line = Number(lineStr);
            if (Math.abs(line % 1 - 0.5) > 0.01) continue; // value/picks SOLO líneas .5
            const cons = noVig.consensus(quotes, 'over', 'under', { minGroups: 3 });
            if (!cons.ok) continue;
            const mu = fam === 'corners_total' ? proj.corners.total : proj.cards.total;
            const r = fam === 'corners_total' ? proj.corners.r_total : proj.cards.r_total;
            const fairOver = _nbOver(mu, r, line);
            const bestOver = Math.max(0, ...quotes.filter(q => q.side === 'over').map(q => q.odds_decimal));
            const bestUnder = Math.max(0, ...quotes.filter(q => q.side === 'under').map(q => q.odds_decimal));
            const tag = String(line).replace('.', '_'); const P = fam === 'corners_total' ? 'CORNERS_' : 'CARDS_';
            for (const [mid, fair, consP, best] of [[P + 'OVER_' + tag, fairOver, cons.probability, bestOver], [P + 'UNDER_' + tag, 1 - fairOver, 1 - cons.probability, bestUnder]]) {
              if (!(best > 1)) continue;
              await grepo.recordGoalValue({
                goal_snapshot_id: null, canonical_event_id: ce.id, market_id: mid, market_family: fam, period_code: 'REGULATION',
                gp_probability: fair, market_consensus_probability: consP, best_decimal_odds: best, break_even_probability: 1 / best,
                raw_edge_pp: fair - consP, conservative_probability: fair, adjusted_edge_pp: fair - consP, adjusted_ev: fair * best - 1,
                classification: 'shadow', goal_value_policy_version: 'props-shadow-1',
              }).catch(() => { });
              out.team_value++;
            }
          }
        }
      } catch (e) { out.errors++; }
      // ---- PROPS DE JUGADOR ----
      try {
        const r2 = await fetch(`https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/events/${ev.id}/odds?apiKey=${KEY}&regions=${ODDS_REGIONS_PROPS}&markets=player_goal_scorer_anytime,player_shots,player_shots_on_target,player_assists&oddsFormat=decimal`, { signal: AbortSignal.timeout(15000) });
        const rem2 = Number(r2.headers.get('x-requests-remaining')); if (Number.isFinite(rem2)) _propsCredits = rem2;
        const d2 = r2.ok ? await r2.json() : null;
        const pgroups = {}; // fam|pid|line → { odds:[], side }
        for (const bk of (d2 && d2.bookmakers) || []) {
          for (const m of bk.markets || []) {
            const fam = m.key === 'player_goal_scorer_anytime' ? 'player_goal' : m.key === 'player_shots' ? 'player_shots' : m.key === 'player_shots_on_target' ? 'player_sot' : m.key === 'player_assists' ? 'player_assist' : null;
            if (!fam) continue;
            for (const o of m.outcomes || []) {
              if (fam !== 'player_goal' && /under/i.test(o.name)) continue; // one-sided: solo over/yes
              const raw = o.description || o.name;
              const pid = propPlayerPid(hCode, raw) || propPlayerPid(aCode, raw);
              if (!pid) continue;
              const odds = Number(o.price);
              if (!(odds >= 1.12 && odds <= 34)) continue; // filtra cuotas basura (p.ej. 1.00-1.05)
              const line = fam === 'player_goal' ? 0 : Number(o.point);
              if (fam !== 'player_goal' && !Number.isFinite(line)) continue;
              const tag = fam === 'player_goal' ? '' : '_' + String(line).replace('.', '_');
              const mid = (fam === 'player_goal' ? 'PLAYER_GOAL_' : fam === 'player_shots' ? 'PLAYER_SHOTS_' : fam === 'player_assist' ? 'PLAYER_ASSISTS_' : 'PLAYER_SOT_') + pid + tag;
              await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: bk.key, external_event_id: ev.id, canonical_event_id: ce.id, market_family: fam, line, side: fam === 'player_goal' ? 'yes' : 'over', team_scope: pid, market_id: mid, odds_decimal: odds, implied_probability: 1 / odds, quote_status: 'open', is_live: false, provider_update: bk.last_update }).catch(() => { });
              out.player_quotes++;
              const gk = fam + '|' + pid + '|' + line;
              (pgroups[gk] = pgroups[gk] || { mid, fam, pid, line, odds: [] }).odds.push(odds);
            }
          }
        }
        if (PF) {
          const roster = propRoster().byTeam;
          const STARTERS = projectedStarters();
          const teamOf = pid => (roster[hCode] && Object.values(roster[hCode].full).includes(pid)) || (roster[hCode] && Object.values(roster[hCode].last).includes(pid)) ? 'home' : 'away';
          for (const g of Object.values(pgroups)) {
            if (g.odds.length < 2) continue;
            const side = teamOf(g.pid);
            const teamLambda = lambdas ? (side === 'home' ? lambdas.home : lambdas.away) : null;
            // willStart REAL desde el once proyectado (antes: true para todos = el bug de los edges inflados;
            // suplente proyectado → 30 min → probabilidad honesta también en la capa de value shadow).
            const pp = players.projectPlayer(PF, g.pid, { teamLambda, willStart: STARTERS.has(g.pid) });
            if (!pp) continue;
            let model = null;
            if (g.fam === 'player_goal') model = pp.anytime_goal;
            else if (g.fam === 'player_shots') model = _nbOver(pp.shots_match, 6, g.line);
            else if (g.fam === 'player_assist') model = g.line === 0.5 ? pp.anytime_assist : null; // solo o0.5 (P(>=1) Poisson sobre xA); líneas altas sin modelo aún
            else model = _nbOver(pp.sot_match, 6, g.line);
            if (!(model > 0 && model < 1)) continue;
            const best = Math.max(...g.odds), med = _median(g.odds.map(x => 1 / x));
            await grepo.recordGoalValue({
              goal_snapshot_id: null, canonical_event_id: ce.id, market_id: g.mid, market_family: g.fam, period_code: 'REGULATION',
              gp_probability: model, market_consensus_probability: med, best_decimal_odds: best, break_even_probability: 1 / best,
              raw_edge_pp: model - 1 / best, conservative_probability: model, adjusted_edge_pp: model - 1 / best, adjusted_ev: model * best - 1,
              classification: 'shadow', goal_value_policy_version: 'player-props-shadow-1',
            }).catch(() => { });
            out.player_value++;
          }
        }
      } catch (e) { out.errors++; }
      await new Promise(r => setTimeout(r, 400));
    }
    out.credits_remaining = _propsCredits;
  } catch (e) { out.error = e.message; }
  finally { _propsRunning = false; out.finished = new Date().toISOString(); _propsLast = out; if (out.team_value || out.player_value || out.error) console.log('[props]', JSON.stringify(out)); }
  return out;
}

// Settlement de PROPS vía TheStatsAPI (1 llamada por partido terminado, cache permanente; respeta 12 req/min).
// CORNERS/CARDS: totales del overview a 90'; el proveedor reporta el partido completo, así que si hubo prórroga
// (minute>90 en db.results) se liquida con los datos de 90' verificados de db.reg90 (POST /api/internal/picks-reg90)
// y solo sin ese dato → VOID (último recurso). PLAYER: goles/remates del jugador; si no jugó → VOID.
async function settlePropsPicks() {
  const pending = db.dailyPicks.filter(p => p.status === 'ACTIVE' && PROP_FAMS.includes(p.family));
  if (!pending.length) return 0;
  const tsa = require('./data-providers/theStatsApi');
  if (!tsa.configured()) return 0;
  let settled = 0;
  for (const p of pending) {
    const h = p.event.home_team_id, a = p.event.away_team_id;
    if (!matchFinalFor(h, a)) continue;
    // ¿se definió en prórroga/penales? → VOID (sin 90' limpios)
    let wentEt = false;
    for (const k of KNOCKOUT) {
      const r = db.results[String(k.m)];
      if (r && r.status === 'final' && ((r.home === h && r.away === a) || (r.home === a && r.away === h)) && (Number(r.minute) > 90 || (r.decided && r.decided !== 'reg'))) wentEt = true;
    }
    const key = h + '~' + a;
    try {
      if (wentEt) {
        // Prórroga/penales: las stats de TSA incluyen el tiempo extra → liquidar con los datos de 90'
        // verificados (db.reg90, cargados vía /api/internal/picks-reg90). Sin ese dato → VOID (último recurso).
        const rg = reg90For(h, a);
        let rc = 'VOID';
        if (rg && (p.family === 'CORNERS' || p.family === 'CARDS')) {
          const total = p.family === 'CORNERS' ? rg.corners : rg.cards;
          if (Number.isFinite(total)) { const over = total > Number(p.line); rc = (p.side === 'over' ? over : !over) ? 'WIN' : 'LOSS'; }
        } else if (rg && p.family === 'PLAYER' && p.player_family === 'player_goal' && Array.isArray(rg.scorers)) {
          const target = _propNorm(p.player_name);
          if ((rg.nonstarters || []).some(n => _propNorm(n) === target)) rc = 'VOID';
          else rc = rg.scorers.some(n => _propNorm(n) === target) ? 'WIN' : 'LOSS';
        }
        p.result_code = rc; p.status = 'SETTLED'; p.settled_at = new Date().toISOString(); settled++; continue;
      }
      if (p.family === 'CORNERS' || p.family === 'CARDS') {
        let rep = db.tsaXg[key];
        if (!rep || !rep.corners) {
          const fresh = await tsa.xgReport(h, a).catch(() => null);
          if (fresh && fresh.xg) { rep = { available: true, ...fresh, fetched_at: new Date().toISOString() }; db.tsaXg[key] = rep; save(); await new Promise(r => setTimeout(r, 5500)); }
        }
        if (!rep || !rep.corners) continue; // aún sin stats → reintenta el próximo ciclo
        const total = p.family === 'CORNERS'
          ? Number(rep.corners.home) + Number(rep.corners.away)
          : Number(rep.yellow_cards.home) + Number(rep.yellow_cards.away) + Number((rep.red_cards && rep.red_cards.home) || 0) + Number((rep.red_cards && rep.red_cards.away) || 0);
        if (!Number.isFinite(total)) continue;
        const over = total > Number(p.line);
        p.result_code = (p.side === 'over' ? over : !over) ? 'WIN' : 'LOSS';
      } else { // PLAYER
        db.tsaPlayers = db.tsaPlayers || {};
        let ps = db.tsaPlayers[key];
        if (!ps) {
          ps = await tsa.playerStats(h, a).catch(() => null);
          if (ps) { db.tsaPlayers[key] = ps; save(); await new Promise(r => setTimeout(r, 5500)); }
        }
        if (!ps) continue;
        const target = _propNorm(p.player_name);
        const row = (ps.players || []).find(x => _propNorm(x.name) === target) ||
          (ps.players || []).find(x => _propNorm(x.name).includes(_propNorm(String(p.player_name).trim().split(/\s+/).pop())));
        if (!row || !(row.min > 0)) { p.result_code = 'VOID'; }
        else if (p.player_family === 'player_goal') p.result_code = row.goals > 0 ? 'WIN' : 'LOSS';
        else if (p.player_family === 'player_shots') p.result_code = row.shots > Number(p.line) ? 'WIN' : 'LOSS';
        else if (p.player_family === 'player_assist') p.result_code = (row.assists || 0) > Number(p.line) ? 'WIN' : 'LOSS';
        else p.result_code = row.sot > Number(p.line) ? 'WIN' : 'LOSS';
      }
      p.status = 'SETTLED'; p.settled_at = new Date().toISOString(); settled++;
    } catch (e) { /* reintenta el próximo ciclo */ }
  }
  if (settled) save();
  return settled;
}

// ===== RE-VALIDACIÓN POR ALINEACIÓN CONFIRMADA (8-jul) =======================================================
// El cierre del circuito de props de jugador: ~1h antes del kickoff las alineaciones oficiales salen
// (API-Football→ESPN, ya integrado con cache). Este loop: (1) captura el once CONFIRMADO por par de equipos
// en db.lineupXi (alimenta buildDailyPicks: pisa a la proyección histórica), y (2) si una pick PLAYER activa
// tiene un jugador que NO está en el once confirmado → la RETIRA (VOID preventivo, NOT_IN_LINEUP) antes de
// que arranque el partido. "Se corrobora cuando salga la alineación y se ajusta acorde" (Alexis).
db.lineupXi = db.lineupXi || {}; // pairKey ordenado → { at, names: [{side,name}] }
const _xiPairKey = (a, b) => [a, b].sort().join('~');
function fixtureMetaForPair(h, a) {
  try {
    for (const k of KNOCKOUT) {
      const meta = findFixtureMeta(String(k.m));
      if (meta && meta.home && meta.away && ((meta.home === h && meta.away === a) || (meta.home === a && meta.away === h))) return meta;
    }
  } catch { /* sin bracket */ }
  return null;
}
function confirmedXiPids() {
  const out = {};
  for (const key of Object.keys(db.lineupXi || {})) {
    const xi = db.lineupXi[key]; if (!xi || !Array.isArray(xi.names)) continue;
    const [t1, t2] = key.split('~');
    const set = new Set();
    for (const n of xi.names) {
      const pid = propPlayerPid(t1, n.name) || propPlayerPid(t2, n.name);
      if (pid) set.add(pid);
    }
    if (set.size >= 8) out[key] = set; // menos de 8 matcheados = mapeo poco confiable → no pisar la proyección
  }
  return out;
}
let _lineupRevalRunning = false;
// Captura (con cache 15 min) el once CONFIRMADO de un par de equipos. Compartida por la re-validación de
// picks PLAYER y por la reconciliación observer↔realidad (ya NO depende de que exista una pick de jugador).
async function captureXiForPair(h, a) {
  const key = _xiPairKey(h, a);
  let xi = db.lineupXi[key];
  if (xi && Date.now() - new Date(xi.at).getTime() <= 15 * 60 * 1000) return xi;
  const meta = fixtureMetaForPair(h, a); if (!meta) return xi || null;
  const th = TEAMS.find(t => t.id === h), ta = TEAMS.find(t => t.id === a);
  const namesOf = t => t ? [t.en, t.name, ...(t.aliases || [])] : [];
  const ctx = await providers.getMatchContext({
    homeCode: h, awayCode: a, homeName: th ? th.en : '', awayName: ta ? ta.en : '',
    homeNames: namesOf(th), awayNames: namesOf(ta), isoDate: meta.datetime, espnId: meta.espnId,
    isLive: false, isFinal: false,
  }).catch(() => null);
  const L = ctx && ctx.lineups;
  const names = [];
  for (const s of ['home', 'away']) {
    if (L && L[s] && L[s].confirmed && Array.isArray(L[s].startXI) && L[s].startXI.length >= 10) {
      for (const pl of L[s].startXI) { const nm = pl && (pl.name || (pl.player && pl.player.name)); if (nm) names.push({ side: s, name: nm }); }
    }
  }
  if (!names.length) return xi || null; // aún sin alineación confirmada
  xi = { at: new Date().toISOString(), names };
  db.lineupXi[key] = xi; save();
  return xi;
}

async function revalidateLineups() {
  if (_lineupRevalRunning || !propsOn()) return;
  _lineupRevalRunning = true;
  try {
    const pending = db.dailyPicks.filter(p => p.status === 'ACTIVE' && p.family === 'PLAYER');
    for (const p of pending) {
      const ko = new Date(p.event.kickoff_at || 0).getTime();
      if (!(ko > Date.now()) || ko - Date.now() > 90 * 60 * 1000) continue; // ventana: últimos 90 min pre-KO
      const h = p.event.home_team_id, a = p.event.away_team_id;
      const key = _xiPairKey(h, a);
      const xi = await captureXiForPair(h, a);
      if (!xi) continue; // reintentar en el próximo tick
      const target = _propNorm(p.player_name);
      const lastN = _propNorm(String(p.player_name || '').trim().split(/\s+/).pop());
      const inXi = xi.names.some(n => { const nn = _propNorm(n.name); return nn === target || (lastN.length >= 4 && nn.includes(lastN)); });
      if (!inXi) {
        p.status = 'SETTLED'; p.result_code = 'VOID'; p.void_reason = 'NOT_IN_LINEUP'; p.settled_at = new Date().toISOString(); save();
        console.log('[picks] PLAYER retirada por alineación confirmada (no es titular):', p.player_name, key);
        evaluateDailyPicks().catch(() => { }); // re-curar el evento: con el once confirmado puede salir otra pick válida
      } else if (!p.lineup_confirmed) { p.lineup_confirmed = true; save(); console.log('[picks] PLAYER confirmada en el once:', p.player_name, key); }
    }
  } catch (e) { console.log('[picks] revalidación alineaciones error', e.message); }
  finally { _lineupRevalRunning = false; }
}

// ===== RECONCILIACIÓN OBSERVER ↔ REALIDAD (10-jul, pedido de Alexis: caso Olise) =============================
// La alineación oficial y los minutos jugados son la verdad MÁS DURA sobre disponibilidad: en cuanto llegan,
// cualquier duda/baja previa del observer queda RESUELTA al instante (no esperando el decaimiento de 36h).
// Mecanismo: se inyecta una señal sintética CONFIRMED (source 'alineacion_oficial' / 'jugo_minutos') en
// db.observations; assessPlayers ya hace que la señal más reciente BACK/CONFIRMED limpie al jugador → todas
// las superficies (Match Intel, perfil, narrativa de picks) se corrigen solas. Ventana: 90 min antes del KO
// hasta 3h después (cubre once publicado, partido en vivo y post-partido). Corre cada 10 min.
let _obsReconRunning = false;
function _injectResolutionSignal(team, pid, player, source, title) {
  const obs = db.observations[team];
  if (!obs || !Array.isArray(obs.signals)) return false;
  const now = Date.now();
  // dedup: una resolución por jugador cada 6h alcanza (idempotente entre ticks)
  const recent = obs.signals.some(s => s.pid === pid && s.source === source && now - new Date(s.published_at || 0).getTime() < 6 * 3600e3);
  if (recent) return false;
  obs.signals.push({ category: 'CONFIRMED', severity: 0, player, pid, team, keyword: source, title, source, link: null, published_at: new Date(now).toISOString() });
  if (obs.signals.length > 120) obs.signals = obs.signals.slice(-120); // respeta el ring del observer
  return true;
}
async function reconcileObserverReality() {
  if (_obsReconRunning || !observerOn()) return { skipped: true };
  _obsReconRunning = true;
  try {
    const { assessPlayers } = require('./observer/assess');
    const now = Date.now();
    let resolved = 0;
    // pares en ventana (eliminatorias: el calendario vivo del torneo)
    const pairs = [];
    for (const k of KNOCKOUT) {
      const meta = findFixtureMeta(String(k.m));
      if (!meta || !meta.home || !meta.away || !meta.datetime) continue;
      const ko = new Date(meta.datetime).getTime();
      if (!isFinite(ko)) continue;
      if (now >= ko - 90 * 60e3 && now <= ko + 3 * 3600e3) pairs.push({ h: meta.home, a: meta.away, ko });
    }
    // En ventana de partido el observer también RECOLECTA más seguido (la cadencia base es 3h; una noticia
    // de última hora pre-KO no puede esperar): si la última pasada tiene >45 min, se dispara una ahora.
    if (pairs.length && !_obsRunning) {
      const lastRun = _obsLast && _obsLast.finished ? new Date(_obsLast.finished).getTime() : 0;
      if (now - lastRun > 45 * 60e3) runObserver().catch(() => { });
    }
    for (const { h, a, ko } of pairs) {
      // jugadores con señal de riesgo vigente en cualquiera de los dos equipos
      const risky = {};
      for (const team of [h, a]) {
        const obs = db.observations[team];
        if (!obs || !Array.isArray(obs.signals)) continue;
        const asm = assessPlayers(obs.signals);
        for (const pid in asm) if (asm[pid].prob_miss > 0) risky[pid] = { team, player: asm[pid].player };
      }
      if (!Object.keys(risky).length) continue;
      // 1) ALINEACIÓN OFICIAL: titular confirmado → duda resuelta (independiente de que haya picks PLAYER)
      const xi = await captureXiForPair(h, a).catch(() => null);
      if (xi && Array.isArray(xi.names)) {
        for (const n of xi.names) {
          const pid = propPlayerPid(h, n.name) || propPlayerPid(a, n.name);
          if (!pid || !risky[pid]) continue;
          if (_injectResolutionSignal(risky[pid].team, pid, risky[pid].player || n.name, 'alineacion_oficial', 'Titular en la alineación oficial')) {
            resolved++;
            console.log('[observer] duda resuelta por alineación oficial:', risky[pid].player || n.name, h + '-' + a);
          }
        }
      }
      // 2) MINUTOS JUGADOS (post-partido, cubre también a los que entraron desde el banco): si el partido
      // terminó y tenemos stats por jugador cacheadas (settlement TSA), todo el que jugó queda resuelto.
      if (now > ko + 105 * 60e3) {
        const ps = db.tsaPlayers[h + '~' + a] || db.tsaPlayers[a + '~' + h];
        for (const row of (ps && ps.players) || []) {
          if (!(row.min > 0)) continue;
          const pid = propPlayerPid(h, row.name) || propPlayerPid(a, row.name);
          if (!pid || !risky[pid]) continue;
          if (_injectResolutionSignal(risky[pid].team, pid, risky[pid].player || row.name, 'jugo_minutos', 'Jugó ' + row.min + ' minutos')) resolved++;
        }
      }
    }
    if (resolved) {
      save();
      // las narrativas de picks pueden cargar un caveat de duda ya resuelto → re-anotar con factores frescos
      annotateDailyPicksNarrative({ force: true });
      // y una pick bloqueada por AVAILABILITY_DOUBT puede publicarse ahora que la duda se zanjó (solo si
      // queda algún partido de la ventana sin arrancar; el evaluador ya es idempotente por supersede)
      if (pairs.some(x => now < x.ko)) evaluateDailyPicks().catch(() => { });
    }
    return { pairs: pairs.length, resolved };
  } catch (e) { return { error: e.message }; }
  finally { _obsReconRunning = false; }
}
if (observerOn()) {
  setTimeout(() => reconcileObserverReality().catch(() => { }), 4 * 60 * 1000);
  setInterval(() => reconcileObserverReality().catch(() => { }), 10 * 60 * 1000);
}
if (propsOn()) setInterval(() => revalidateLineups().catch(() => { }), 10 * 60 * 1000);

// ===== FOTOS DE JUGADOR (punto 1 roadmap: capa de inteligencia por jugador) ================================
// Mapea pids (TheStatsAPI) → foto oficial (API-Football players/squads, cacheado por el provider) para los
// equipos VIVOS (≤8 en eliminatorias → ~16 llamadas/día, trivial). Apellidos ambiguos no matchean (colisión
// Theo/Lucas Hernández) → esos quedan sin foto antes que con la foto EQUIVOCADA.
db.playerPhotos = db.playerPhotos || {};
async function buildPlayerPhotoMap() {
  try {
    const af = require('./data-providers/apiFootballProvider');
    if (!af.configured || !af.configured()) return 0;
    let added = 0;
    for (const code of obsAliveTeams()) {
      const t = TEAMS.find(x => x.id === code); if (!t) continue;
      const apiId = await af.resolveTeamId(code, t.en || t.name).catch(() => null);
      if (!apiId) continue;
      const squad = await af.getTeamSquad(apiId).catch(() => []);
      for (const sp of squad || []) {
        if (!sp || !sp.name || !sp.photo) continue;
        const pid = propPlayerPid(code, sp.name);
        if (pid && !db.playerPhotos[pid]) { db.playerPhotos[pid] = { photo: sp.photo, af_id: sp.id || null }; added++; }
      }
      await new Promise(r => setTimeout(r, 300));
    }
    if (added) { save(); console.log('[player-intel] fotos mapeadas: +' + added + ' (total ' + Object.keys(db.playerPhotos).length + ')'); }
    return added;
  } catch { return 0; }
}
if (propsOn()) {
  setTimeout(() => buildPlayerPhotoMap().catch(() => { }), 4 * 60 * 1000);
  setInterval(() => buildPlayerPhotoMap().catch(() => { }), 24 * 3600 * 1000);
}
// FASE CLUBES F0.2: mapa de fotos oficiales de jugadores de clubes (data/clubs/player-photos.json, generado
// offline por scripts/gen-club-player-photos.js). Carga al boot; recarga cada 12h por si el archivo se actualizó.
function loadClubPlayerPhotos() {
  try { global._clubPlayerPhotos = JSON.parse(fs.readFileSync(clubDataFile('player-photos.json'), 'utf8')); }
  catch { global._clubPlayerPhotos = global._clubPlayerPhotos || {}; }
}
loadClubPlayerPhotos();
setInterval(loadClubPlayerPhotos, 12 * 3600 * 1000);
// F1.1: mapa AF (tm_ id → af team id) por liga, para alineaciones/eventos de API-Football por fixture de club.
function loadClubAfMap() {
  try { global._clubAfMap = JSON.parse(fs.readFileSync(clubDataFile('af-team-map.json'), 'utf8')); }
  catch { global._clubAfMap = global._clubAfMap || {}; }
}
loadClubAfMap();
setInterval(loadClubAfMap, 12 * 3600 * 1000);
// liga nuestra → league id de API-Football (mismos ids del generador de fotos)
const CLUB_AF_LEAGUE = { brasileirao: 71, ligamx: 262, mls: 253, argentina: 128, colombia: 239, paraguay: 250, csl: 169, kleague: 292, j1: 98, premier: 39, laliga: 140, bundesliga: 78, seriea: 135, ligue1: 61 };

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
        // PUNTO 4 roadmap (8-jul): la vía de claims BBC/ESPN casi nunca atribuye equipo (team_id null) → no
        // movía probabilidades. El OBSERVER sí sabe el equipo (consulta por equipo) y corrobora multi-fuente:
        // sus evaluaciones se sintetizan como claims y entran por la MISMA vía newsFactors (caps y pesos ya
        // calibrados). Corroborado → FACT (peso 100%); sin corroborar → INFERENCE (55%). Capas conectadas.
        const obsClaims = [];
        try {
          const { assessPlayers } = require('./observer/assess');
          for (const code of [a, b]) {
            if (!db.observations || !db.observations[code]) continue;
            const asmts = assessPlayers((db.observations[code] || {}).signals || []);
            for (const pid in asmts) {
              const x = asmts[pid];
              if (!(x.prob_miss >= 0.3) || !x.player) continue;
              const fc = x.status === 'SUSPENDED' ? 'PLAYER_SUSPENDED' : x.status === 'OUT' ? 'PLAYER_CONFIRMED_OUT' : 'PLAYER_DOUBTFUL';
              obsClaims.push({ factor_code: fc, fact_or_inference: x.corroborated !== false ? 'FACT' : 'INFERENCE', team_id: code, subject_id: code, confidence: x.prob_miss, review_status: 'auto' });
            }
          }
        } catch { /* observer apagado → sin claims sintéticos */ }
        const fused = cf.fuse(deepVec, { weatherRow: wRow, claims: claimRows.concat(obsClaims), homeId: a, awayId: b });
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

// ===== GOLES (G2): pase de evaluación de goles, SEPARADO del loop de contexto. Itera los fixtures canónicos
// próximos, reusa buildH2HDeep (cache TTL → barato si corre tras el pase de contexto) para las lambdas base/
// contextuales y persiste el goal_model_snapshot (shadow, idempotente). NO escribe v2/context snapshots → seguro
// para verificar en preview sin sobrescribir los FULL_CONTEXT de prod. Solo lo lee mvGoals en /x (flag).
let _goalEvalRunning = false, _goalEvalLast = null;
function goalEngineOn() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_GOAL_ENGINE_ENABLED || '')); }
async function evaluateUpcomingGoals({ limit = 60, throttleMs = 150 } = {}) {
  if (_goalEvalRunning) return { skipped: 'running' };
  _goalEvalRunning = true;
  const out = { evaluated: 0, snapshots_new: 0, quotes: 0, value_rows: 0, skipped: 0, errors: 0, source: null, started: new Date().toISOString() };
  try {
    const dbc = require('./database/client');
    const dbcfg = require('./database/config');
    if (!dbcfg.db || !dbcfg.db.configured) return { skipped: 'no_db' };
    const grepo = require('./goal-engine/repository');
    const { stableGoalEventId } = require('./goal-engine/eventKey');

    // Mapa PAR-DE-EQUIPOS → id canónico (si el partido YA es canónico, reusamos su id real; si no, id sintético
    // estable). Desacopla el pipeline de goles de la creación de canonical_events (backbone del arbitraje).
    const canonRows = (await dbc.query(`SELECT id, home_participant, away_participant FROM canonical_events WHERE scheduled_start > now()`)).rows;
    const canonByPair = {};
    for (const c of canonRows) { const a = aliasToId[normName(c.home_participant)], b = aliasToId[normName(c.away_participant)]; if (a && b) canonByPair[a + '|' + b] = c.id; }

    // Fuente primaria: the_odds_api lista los PRÓXIMOS reales con cuotas de totales. Resolvemos equipos por ID
    // (aliasToId cubre los nombres del proveedor: USA→USA, Bosnia & Herzegovina→BIH, DR Congo→COD…).
    const KEY = process.env.SPORTSBOOK_PROVIDER_API_KEY;
    let events = null;
    if (KEY) {
      try {
        const reserve = Number(process.env.SPORTSBOOK_QUOTA_RESERVE || 2000);
        const r = await fetch(`https://api.the-odds-api.com/v4/sports/soccer_fifa_world_cup/odds?regions=${ODDS_REGIONS_SCAN}&markets=h2h,totals&oddsFormat=decimal&dateFormat=iso&apiKey=${KEY}`, { signal: AbortSignal.timeout(15000) });
        const remaining = Number(r.headers.get('x-requests-remaining'));
        if (r.ok && (!Number.isFinite(remaining) || remaining >= reserve)) {
          const body = await r.json(); const now = Date.now();
          events = (Array.isArray(body) ? body : []).filter(e => new Date(e.commence_time).getTime() > now);
          out.source = 'the_odds_api'; out.credits_remaining = Number.isFinite(remaining) ? remaining : null;
        } else if (r.ok) { out.source = 'quota_reserve'; out.credits_remaining = remaining; }
      } catch (e) { out.fetch_error = e.message; }
    }

    const processMatch = async (a, b, eventId, kickoff, theOddsEvent) => {
      if (!a || !b || db.elos[a] == null || db.elos[b] == null) { out.skipped++; return; }
      const deep = await buildH2HDeep(a, b);
      if (!deep || !deep.probs) { out.skipped++; return; }
      const dqA = (deep.context && deep.context.dataQualityA) || { score: 0 }, dqB = (deep.context && deep.context.dataQualityB) || { score: 0 };
      const compl = round4(((Number(dqA.score) || 0) + (Number(dqB.score) || 0)) / 2);
      // PUNTO 3: factor λ del observer sobre la capa de goles (flag + clamp). buildH2HDeep queda intacto
      // (modelo oficial); solo el snapshot de goles/value/picks recibe la generación ajustada por bajas.
      const fH = observerLambdaFactor(a), fA = observerLambdaFactor(b);
      const deepG = (fH !== 1 || fA !== 1)
        ? { ...deep, probs: { ...deep.probs, xgA: deep.probs.xgA * fH, xgB: deep.probs.xgB * fA } }
        : deep;
      const gsnap = await persistGoalSnapshot({ id: eventId, homeId: a, awayId: b, kickoff }, deepG, compl);
      out.evaluated++;
      if (gsnap && gsnap.row && !gsnap.idempotent) out.snapshots_new++;
      // Ingerir las cuotas de totales de ESTE evento bajo el MISMO id (snapshot y cuotas alineados → Value posible).
      if (theOddsEvent) {
        for (const bk of theOddsEvent.bookmakers || []) for (const m of bk.markets || []) {
          if (m.key !== 'totals') continue;
          for (const o of m.outcomes || []) {
            const side = String(o.name || '').toLowerCase();
            await grepo.upsertGoalQuote({ data_provider: 'the_odds_api', sportsbook_code: bk.key, external_event_id: theOddsEvent.id, canonical_event_id: eventId, market_family: 'match_total', line: o.point, side, market_id: `TOTAL_GOALS_${side.toUpperCase()}_${String(o.point).replace('.', '_')}`, odds_decimal: o.price, implied_probability: o.price > 1 ? 1 / o.price : null, quote_status: 'open', is_live: false, provider_update: bk.last_update }).catch(() => {});
            out.quotes++;
          }
        }
      }
      const vrows = await persistGoalValue({ id: eventId }, Number(deep.probs.xgA), Number(deep.probs.xgB), gsnap && gsnap.row ? gsnap.row.goal_snapshot_id : null);
      out.value_rows += vrows || 0;
      // Value de GANADOR (1X2) → habilita picks SÓLIDAS en partidos no canónicos (h2h de the_odds_api).
      const mwRows = await persistMatchWinnerValue({ id: eventId }, deep, theOddsEvent, gsnap && gsnap.row ? gsnap.row.goal_snapshot_id : null);
      out.value_rows += mwRows || 0;
      if (throttleMs) await new Promise(r => setTimeout(r, throttleMs));
    };

    if (events) {
      for (const e of events.slice(0, limit)) {
        try {
          const a = aliasToId[normName(e.home_team)], b = aliasToId[normName(e.away_team)];
          const eventId = (a && b && canonByPair[a + '|' + b]) || (a && b ? stableGoalEventId(a, b) : null);
          if (!eventId) { out.skipped++; continue; }
          await processMatch(a, b, eventId, e.commence_time, e);
        } catch (e2) { out.errors++; }
      }
    } else {
      // Fallback: sin the_odds_api (sin key / quota / fallo), usa los canonical_events próximos (sin cuotas frescas).
      out.source = out.source || 'canonical_fallback';
      const evs = (await dbc.query(`SELECT id, home_participant, away_participant, scheduled_start FROM canonical_events WHERE scheduled_start > now() ORDER BY scheduled_start LIMIT $1`, [limit])).rows;
      for (const ev of evs) {
        try {
          const a = aliasToId[normName(ev.home_participant)], b = aliasToId[normName(ev.away_participant)];
          await processMatch(a, b, ev.id, ev.scheduled_start, null);
        } catch (e) { out.errors++; }
      }
    }
    // G5: tras refrescar Value, evalúa Picks (gated por flag) y liquida los que ya tienen resultado.
    out.picks = await evaluateGoalPicks();
    out.settled = settleGoalPicks();
    // Picks diarias (producto /x): auto-publica las que pasan el gate y liquida las que ya tienen marcador.
    // PROPS end-to-end (7-jul): ingesta+value ANTES de evaluar picks (mismo ciclo publica; throttle ~100min).
    out.props = await evaluateUpcomingProps().catch(e => ({ error: e.message }));
    out.dailyPicks = await evaluateDailyPicks();
    out.dailySettled = settleDailyPicks();
    out.propsSettled = await settlePropsPicks().catch(() => 0);
    // Cierre + CLV: idempotente, solo picks con kickoff pasado y sin closing/clv.
    out.dailyClosing = await captureDailyPicksClosing().catch(e => ({ error: e.message }));
    // Movimiento de línea de picks activas (informativo, no gatea).
    out.lineIntel = await updateDailyPicksLineIntel().catch(e => ({ error: e.message }));
    // Narrativa multi-factor (una vez por pick, estable).
    out.narrative = annotateDailyPicksNarrative();
  } catch (e) { out.error = e.message; }
  finally { _goalEvalRunning = false; out.finished = new Date().toISOString(); _goalEvalLast = out; }
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
// FUSIÓN: sesión desde la cookie wc_token (para decidir, SIN redirección, qué servir en la raíz: plataforma o landing).
// El token es el mismo que va en localStorage/Authorization; la cookie solo hace visible la sesión al servir el HTML.
function sessionEmailFromReq(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)wc_token=([^;]+)/);
  if (!m) return null;
  let tok; try { tok = decodeURIComponent(m[1]); } catch { tok = m[1]; }
  return db.sessions[tok] || null;
}
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
  // Rollout de la beta: el entitlement (grant admin / 5 referidos verificados / fusión) habilita el acceso a
  // la plataforma nueva (/x). Se calcula ANTES de resolver los features: si solo se parchea beta.beta después,
  // los features por módulo (goalInsights/arbitrage/opportunities/premium) quedan false para los entitled
  // → entraban a /x pero sin proyección de goles ni módulos (bug reportado por Alexis, 2-jul).
  const ent = betaEntitlement(email);
  // Fase Q: gating de la experiencia de producto beta (default off → beta:false, nada nuevo se monta).
  const beta = gpProduct.resolveForUser({ email, isAdmin: admin, entitled: ent.access });
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

// Scanner multi-venue: scan con cache TTL (evita re-escanear la DB en cada request). INERTE si el flag está off
// (scanNow devuelve {disabled:true} sin tocar la DB). Refresca a lo sumo cada MARKET_SCANNER_TTL_MS (default 45s).
// Mercados de "campeón del Mundial" como venue del scanner: Polymarket + Kalshi (ya alineados por teamId en
// marketCache). Cada equipo = un mercado binario Sí/No. Precios PM son probabilidades (0-1) → cuota = 1/precio.
// YES cuesta ask; NO cuesta (1−bid). Los PMs SÍ permiten vender la posición (venue_kind='pm' → trade-out real).
// El arb campeón Poly↔Kalshi es históricamente ~0 (mercados eficientes); se incluye para completar el multi-venue.
function buildChampionMarkets(mc) {
  const out = [];
  const ids = new Set([...Object.keys(mc.polymarket || {}), ...Object.keys(mc.kalshi || {})]);
  for (const id of ids) {
    const tm = teamById[id]; if (!tm) continue;
    const quotes = [];
    const add = (venue, label, url, v) => {
      if (!v) return;
      if (v.ask != null && v.ask > 0 && v.ask < 1) quotes.push({ venue, venue_label: label, independence_group: venue, source_role: 'prediction_market', outcome: 'yes', odds_decimal: 1 / v.ask, observed_at: mc.ts, is_exchange: false, venue_kind: 'pm', url });
      if (v.bid != null && v.bid > 0 && v.bid < 1) quotes.push({ venue, venue_label: label, independence_group: venue, source_role: 'prediction_market', outcome: 'no', odds_decimal: 1 / (1 - v.bid), observed_at: mc.ts, is_exchange: false, venue_kind: 'pm', url });
    };
    add('polymarket', 'Polymarket', (mc.polymarket[id] || {}).url, mc.polymarket[id]);
    add('kalshi', 'Kalshi', (mc.kalshi[id] || {}).url, mc.kalshi[id]);
    // hace falta al menos 2 venues para arb (Sí y No de distintas casas)
    if (new Set(quotes.map(q => q.venue)).size < 2) continue;
    out.push({ source: 'prediction_market', venue_kind: 'pm', event_id: 'champ-' + id, market_family: 'champion', period: 'tournament', line: null, universe: ['yes', 'no'], home: tm.name, home_team_id: id, away: null, kickoff: null, quotes });
  }
  return out;
}

// FASE CLUBES (shadow): scan SEPARADO sobre las cuotas de clubes que clubsQuotesSweep dejó en la DB.
// Cache propio: el _scanCache compartido (teaser, telegram, /api/beta/arbitrage no-admin) queda byte-idéntico.
// Frescura propia (75 min): el sweep de clubes corre ~60 min (presupuesto de créditos), no cada 20 como la casa.
let _clubsScanCache = { at: 0, data: null, running: null };
function clubsShadowFlagOn() { return /^(1|true|yes|on)$/i.test(String(process.env.GP_CLUBS_SHADOW_ENABLED || '').trim()); }
// FUSIÓN (lanzamiento post-Mundial): GP_CLUBS_PUBLIC_ENABLED=true abre TODAS las superficies de clubes a
// cualquier usuario con sesión (partidos/equipos/jugadores/cockpit/picks/value/arb/evolución/brackets).
// Off (default) = comportamiento shadow admin-only intacto. Un solo flag enciende la fusión mañana.
function clubsPublicOn() { return clubsShadowFlagOn() && /^(1|true|yes|on)$/i.test(String(process.env.GP_CLUBS_PUBLIC_ENABLED || '').trim()); }
// Gate de sesión para /api/clubs/*: admin siempre; usuario logueado cuando la fusión está abierta.
function clubsAccessOk(sessEmail) { return !!sessEmail && (isAdmin(sessEmail) || clubsPublicOn()); }
async function getClubsScan() {
  if (!clubsShadowFlagOn()) return null;
  const events = db.clubsQuoteEvents || {};
  if (!Object.keys(events).length) return null;
  const ttl = parseInt(process.env.MARKET_SCANNER_TTL_MS, 10) || 45000;
  if (Date.now() - _clubsScanCache.at < ttl) return _clubsScanCache.data; // cachea también el "sin mercados" (null)
  if (_clubsScanCache.running) return _clubsScanCache.running.then(() => _clubsScanCache.data).catch(() => _clubsScanCache.data);
  _clubsScanCache.running = (async () => {
    const dbc = require('./database/client');
    if (!dbc.isConfigured()) return null;
    const markets = await require('./market-scanner/quotes').loadClubsMarkets(dbc, { events, now: Date.now() }).catch(() => []);
    let out = null;
    if (markets.length) {
      const params = { ...marketScanner.params, maxQuoteAgeMs: 75 * 60e3 };
      out = require('./market-scanner/scanner').scan(markets, { params, now: Date.now() });
      out.scanner_version = marketScanner.SCANNER_VERSION;
    }
    _clubsScanCache = { at: Date.now(), data: out, running: null };
    return out;
  })().catch(() => { _clubsScanCache = { at: Date.now(), data: null, running: null }; return null; });
  return _clubsScanCache.running;
}

let _scanCache = { at: 0, data: null, running: null };
async function getMarketScan() {
  const ttl = parseInt(process.env.MARKET_SCANNER_TTL_MS, 10) || 45000;
  if (_scanCache.data && Date.now() - _scanCache.at < ttl) return _scanCache.data;
  if (_scanCache.running) return _scanCache.running.then(() => _scanCache.data).catch(() => _scanCache.data);
  // Campeón (Poly/Kalshi): usa el marketCache que el loop de fondo (fetchMarkets cada 60s) mantiene caliente —
  // NO bloqueamos el endpoint esperando un fetch externo (si está frío, simplemente no hay mercados de campeón aún).
  const withPM = !!(marketScanner.flags && marketScanner.flags.includePredictionMarkets);
  const extraMarkets = withPM ? buildChampionMarkets(marketCache || {}) : [];
  _scanCache.running = marketScanner.scanNow(require('./database/client'), { extraMarkets })
    .then(scan => { _scanCache = { at: Date.now(), data: scan, running: null }; return scan; })
    .catch(err => { _scanCache.running = null; return _scanCache.data || { unavailable: 'scan_error', error: String(err && err.message || err) }; });
  return _scanCache.running;
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm' };
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
      // PICKS DIARIAS (producto): feed EFÍMERO. Solo picks ACTIVE (prepartido/del día); las liquidadas desaparecen
      // del feed del usuario (el track record queda solo para admin).
      // P3 (17-jul, spec de Alexis): "Confidence" se separa en 4 señales — win_prob (la probabilidad del blend),
      // edge_pp (estimado vs consenso), data_confidence (certeza del INPUT: profundidad de casas/cuota) y
      // pick_quality (composite de régimen+edge+profundidad). La confianza habla del input, no sustituye la prob.
      if (p === '/api/beta/picks' && req.method === 'GET') {
        const pickSignals = (x, { isClub = false } = {}) => {
          const books = Number(x.books || 0), odds = Number(x.best_odds || 0);
          const regime = x.regime || (x.family === 'SOLID' || x.family === 'PLAYER' ? 'anchor' : 'edge');
          let edge = x.edge_pp != null ? Number(x.edge_pp) : null;
          if (edge == null && x.model_prob != null && x.market_prob != null) edge = +((x.model_prob - x.market_prob) * 100).toFixed(1);
          const dataConf = !(odds > 1) ? 'low' : books >= 5 ? 'high' : books >= 3 ? 'med' : 'low';
          const quality = (books < 3 || !(odds > 1) || (regime === 'edge' && edge != null && edge < 3)) ? 'marginal'
            : ((regime === 'edge' && edge != null && edge >= 4 && books >= 4) || (regime === 'anchor' && books >= 6)) ? 'strong'
            : 'moderate';
          return { win_prob: x.confidence != null ? +Number(x.confidence).toFixed(3) : null, edge_pp: edge, regime, data_confidence: dataConf, pick_quality: quality, books };
        };
        // El feed muestra solo picks APOSTABLES o EN JUEGO: un partido con KO hace >2h45 ya terminó (90'+
        // descuento) — su pick sale del feed AUNQUE la liquidación siga pendiente (props liquidan con stats/
        // data-pass más tarde; el usuario no debe ver "activa" una pick de un partido terminado).
        const feedShowable = (x) => { const ko = Date.parse((x.event && x.event.kickoff_at) || ''); return !isFinite(ko) || ko > Date.now() - 165 * 60e3; };
        const active = db.dailyPicks.filter(x => x.status === 'ACTIVE').filter(feedShowable)
          .sort((a, b) => new Date(a.event.kickoff_at || 0) - new Date(b.event.kickoff_at || 0));
        // F2 Mis casas: qué casas cotizan cada pick (una query memoizada) → el cliente filtra "solo mis casas"
        const bmap = await picksBooksIndex().catch(() => ({}));
        let items = active.map(x => ({
          pick_id: x.pick_id, family: x.family, event_id: x.event.is_canonical ? x.event.canonical_event_id : null,
          home: x.event.home, away: x.event.away,
          home_team_id: x.event.home_team_id, away_team_id: x.event.away_team_id, kickoff: x.event.kickoff_at,
          selection_code: x.selection_code, market_id: x.market_id, side: x.side, line: x.line, legs: x.legs,
          player_name: x.player_name || null, player_family: x.player_family || null, availability_risk: x.availability_risk || null,
          odds: x.best_odds, book: x.best_book, confidence: x.confidence != null ? +Number(x.confidence).toFixed(3) : null,
          line_move: x.line_move ? { pp: x.line_move.pp, direction: x.line_move.direction } : null,
          why_es: x.why_es || null, why_en: x.why_en || null,
          signals: pickSignals(x),
          books_list: booksListFor(bmap, x),
        }));
        // PROPS admin-first: CORNERS/CARDS/PLAYER solo visibles para admin hasta GP_PROPS_PICKS_PUBLIC=true.
        if (!propsPicksPublic() && !(betaUser && betaUser.isAdmin)) items = items.filter(f => PROP_FAMS.indexOf(f.family) < 0);
        if (!(betaUser && betaUser.isAdmin)) items = items.filter(f => EXPERIMENT_FAMS.indexOf(f.family) < 0); // experimento: solo admin, siempre
        // F3.3: PICKS DE CLUBES — admin siempre; público cuando GP_CLUBS_PUBLIC_ENABLED=true (FUSIÓN post-Mundial).
        // Para NO-admins se aplican los MISMOS filtros de arriba (props/experimentos fuera salvo flag público) y
        // además fuera las picks regime:'monitor' (existen para el track privado, jamás para el feed público).
        if (betaUser && (betaUser.isAdmin || clubsPublicOn()) && !url.searchParams.get('asplan') && clubsShadowFlagOn()) {
          let clubActive = (db.clubDailyPicks || []).filter(x => x.status === 'ACTIVE').filter(feedShowable)
            .sort((a, b) => new Date(a.event.kickoff_at || 0) - new Date(b.event.kickoff_at || 0));
          if (!betaUser.isAdmin) {
            clubActive = clubActive.filter(x => x.regime !== 'monitor');
            // GOLES público = solo ANCLA (19-jul, Alexis): el edge de goles empata al mercado eficiente → al track
            // privado. Autoritativo: excluye también las legacy activas (regime 'edge'/indefinido) sin mutar el track.
            clubActive = clubActive.filter(x => !(x.family === 'GOALS' && x.regime !== 'anchor'));
            // PLAYER de clubes FUERA del feed público (23-jul, decisión Alexis tras autopsia: 2-5, −3.07u,
            // CLV −0.95% — la familia acumula muestra ADMIN-ONLY y se publica cuando demuestre). El guard de
            // disponibilidad (clubPlayerAvail, TSA pago) queda listo en el historial de git para la reapertura.
            clubActive = clubActive.filter(x => x.family !== 'PLAYER');
            // CORNERS/CARDS: el FEED sigue gateado por props-public (activas no se muestran — data fina en
            // acumulación); sus LIQUIDADAS sí cuentan en el cuadro público (picks-record, decisión 23-jul).
            if (!propsPicksPublic()) clubActive = clubActive.filter(x => PROP_FAMS.indexOf(x.family) < 0);
            clubActive = clubActive.filter(x => EXPERIMENT_FAMS.indexOf(x.family) < 0);
            // STOP-LOSS ROLLING: familias bajo break-even en sus últimas 30 públicas salen del feed (dormant hasta ≥30).
            const _stopped = clubFamilyStopped();
            if (_stopped.size) clubActive = clubActive.filter(x => !_stopped.has(x.family));
          }
          const clubItems = clubActive.map(x => ({
              pick_id: x.pick_id, family: x.family, event_id: null, club_eid: x.event.club_eid || null,
              competition_name: x.competition_name || null,
              home: x.event.home, away: x.event.away,
              home_team_id: x.event.home_team_id, away_team_id: x.event.away_team_id, kickoff: x.event.kickoff_at,
              selection_code: x.selection_code, market_id: x.market_id, side: x.side, line: x.line, legs: null,
              // PLAYER: sin estos campos la card caía al template de "shots" con {player}/{line} vacíos
              player_name: x.player_name || null, player_family: x.player_family || null,
              odds: x.best_odds, book: x.best_book, confidence: x.confidence != null ? +Number(x.confidence).toFixed(3) : null,
              why_es: x.why_es || null, why_en: x.why_en || null,
              signals: pickSignals(x, { isClub: true }),
              books_list: booksListFor(bmap, x),
            }));
          items = items.concat(clubItems);
          // P5.1 (spec Alexis): CORRELACIÓN AUTOMÁTICA de picks del mismo evento (ML + Goles) — ρ real desde
          // la matriz de marcadores con las λ del cruce (mismo goal engine del pipeline). El cliente convierte
          // ρ en guía de stake combinado. Memo 10min por evento; solo clubes (los pares vivos hoy).
          try {
            global._pickCorr = global._pickCorr || {};
            const fact = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
            const pois = (l) => { const a = []; for (let k = 0; k <= 10; k++) a.push(Math.exp(-l) * Math.pow(l, k) / fact[k]); return a; };
            const byEid = {};
            for (const it of items) if (it.club_eid) (byEid[it.club_eid] = byEid[it.club_eid] || []).push(it);
            for (const [eid, grp] of Object.entries(byEid)) {
              const ml = grp.find(x => x.family === 'SOLID' && (x.selection_code === 'home' || x.selection_code === 'away'));
              const ou = grp.find(x => x.family === 'GOALS' && x.side && x.line != null);
              if (!ml || !ou) continue;
              let c = global._pickCorr[eid];
              if (!c || Date.now() - c.at > 10 * 60e3) {
                const parts = eid.split('-'); // cl-<liga>-<home>-<away>
                const lg = parts[1], hId = parts.slice(2, parts.length - 1).join('-') || parts[2], aId = parts[parts.length - 1];
                if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { leagues: {} }; } }
                const L = (global._clubsRatings.leagues || {})[lg];
                if (!L) continue;
                let l = null; try { const gf = clubGoalsFit(lg); if (gf) l = require('./clubs-engine/goalsModel').goalLambdas(gf, hId, aId); } catch { l = null; }
                if (!l) { l = lambdas(clubElo(lg, hId) + (L.hfa || 60), clubElo(lg, aId)); }
                const Ph = pois(l[0]), Pa = pois(l[1]);
                let pA = 0, pB = 0, pAB = 0;
                for (let h = 0; h <= 10; h++) for (let a2 = 0; a2 <= 10; a2++) {
                  const pr = Ph[h] * Pa[a2];
                  const mlHit = ml.selection_code === 'home' ? h > a2 : a2 > h;
                  const ouHit = ou.side === 'over' ? (h + a2) > ou.line : (h + a2) < ou.line;
                  if (mlHit) pA += pr; if (ouHit) pB += pr; if (mlHit && ouHit) pAB += pr;
                }
                const rho = pA > 0 && pB > 0 ? pAB / (pA * pB) : 1;
                // guía de stake: correlación positiva reduce el total combinado (clamp honesto 60-100%)
                const stakeFactor = Math.max(0.6, Math.min(1, 1 / rho));
                c = { at: Date.now(), rho: +rho.toFixed(2), stake_factor: +stakeFactor.toFixed(2), joint: +pAB.toFixed(3) };
                global._pickCorr[eid] = c;
              }
              for (const it of grp) it.corr = { rho: c.rho, stake_factor: c.stake_factor, joint_prob: c.joint };
            }
          } catch { /* correlación best-effort: jamás rompe el feed */ }
        }
        // ===== ONBOARDING: PRIMERA PICK GRATIS (conservadora) =====
        // Al registrarse por primera vez, el usuario recibe UNA pick gratis: la MÁS SEGURA del día (mayor
        // win_prob entre las SOLID = favorito claro). ROI/edge no importa — es "mirá cómo ganamos". Se muestra
        // SIEMPRE (bypassa el delay de 60min del plan free) hasta que la descarta (welcomePickSeen). Solo a
        // registros recientes (<30d) que no la vieron → los 900 usuarios viejos no la reciben retroactivamente.
        let welcomePick = null;
        try {
          const wu = db.users[betaUser.email];
          const eligible = wu && !wu.welcomePickSeen && (Date.now() - (wu.createdAt || 0) < 30 * 24 * 3600e3);
          if (eligible && dailyPicksOn()) {
            const cand = items.filter(f => f.family === 'SOLID' && f.confidence != null && Number(f.odds) > 1)
              .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
            if (cand[0]) welcomePick = { ...cand[0], welcome: true };
          }
        } catch { welcomePick = null; }
        // ===== GATING POR PLAN (inerte con GP_PLANS_ENFORCED=off → todos ven todo) =====
        // FREE: 1 pick del día (la SOLID/ganador de mayor confianza), visible recién 60 min antes del kickoff
        // ("con delay"). PRO: todas las familias actuales (ganador+goles+combo). SHARP: además las familias
        // futuras (córners/tarjetas/props) cuando existan. locked_count → el cliente muestra el teaser de upgrade.
        const plan = effectivePlan(betaUser.email, url.searchParams.get('asplan'));
        let lockedCount = 0, planDelayed = false;
        if (plan === 'free') {
          const total = items.length;
          const solid = items.filter(f => f.family === 'SOLID').sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
          const top = solid[0] || null;
          const visible = top && (new Date(top.kickoff).getTime() - Date.now()) <= 60 * 60 * 1000;
          planDelayed = !!(top && !visible);
          items = visible ? [top] : [];
          lockedCount = total - items.length;
        } else if (plan === 'pro') {
          const before = items.length;
          items = items.filter(f => f.family === 'SOLID' || f.family === 'GOALS' || f.family === 'COMBO');
          lockedCount = before - items.length; // familias Sharp futuras (córners/tarjetas/props)
        }
        // RECAP DE AYER (prueba social agregada): solo el marcador W/T del día anterior (UTC). El historial
        // detallado de picks sigue siendo SOLO admin — aquí no viaja ninguna pick vieja, solo el conteo.
        const yd = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
        let yWon = 0, yTot = 0;
        for (const x of db.dailyPicks || []) {
          if (x.status !== 'SETTLED' || !x.event || String(x.event.kickoff_at || '').slice(0, 10) !== yd) continue;
          if (x.result_code === 'WIN') { yWon++; yTot++; }
          else if (x.result_code === 'LOSS') yTot++;
          // PUSH/VOID/SUPERSEDED no cuentan
        }
        // COUNTDOWN (reversible por env): hora real del próximo kickoff para que el feed vacío dé una cita.
        let nextKo = null;
        if (!/^(0|false|no|off)$/i.test(String(process.env.GP_PICKS_COUNTDOWN_ENABLED || 'true').trim())) {
          const now = Date.now();
          const fut = (espnKickoffs || []).filter(t => t > now);
          if (fut.length) nextKo = new Date(Math.min.apply(null, fut)).toISOString();
        }
        const picksLayout = (betaUser && betaUser.isAdmin) || picksSectionsPublic() ? 'sections' : 'flat';
        return json(res, 200, { enabled: dailyPicksOn(), count: items.length, picks: items, plan, locked_count: lockedCount, plan_delayed: planDelayed, welcome_pick: welcomePick, yesterday: yTot > 0 ? { won: yWon, total: yTot } : null, next_kickoff: nextKo, picks_layout: picksLayout, generated_at: new Date().toISOString() });
      }
      // TRACK RECORD de picks (usuarios, todos los planes): prueba social del producto. Agregados + historial de
      // liquidadas SANEADO (sin model%/mercado%/confianza internos; solo qué se publicó, cuota y resultado).
      // SUPERSEDED no viaja (reemplazos internos por coherencia, no picks del usuario).
      if (p === '/api/beta/picks-record' && req.method === 'GET') {
        const isAdm = !!(betaUser && betaUser.isAdmin);
        // CUADRO COMBINADO CON TODO (23-jul, decisión Alexis): el rendimiento público = Mundial + TODAS las
        // familias de clubes que liquidan (SOLID/GOALS/CORNERS/CARDS, incluidas las de monitoreo y las previas
        // al 20-jul — supersede el cutoff CLUBS_CONTINUATION_START y el gate props-public PARA EL RECORD).
        // EXCEPCIÓN: PLAYER (goleador/asistencia, 2-5 y −3u) queda ADMIN-ONLY acumulando muestra — Alexis la
        // publica cuando la familia demuestre. El admin ve el mismo cuadro CON player (su monitoreo).
        const clubRecord = (db.clubDailyPicks || []).filter(x => isAdm || x.family !== 'PLAYER');
        const mundialRecord = (db.dailyPicks || []).filter(x => isAdm || x.family !== 'PLAYER');
        const merged = mundialRecord.concat(clubRecord);
        const settled = merged
          .filter(x => x.status === 'SETTLED' && x.result_code !== 'SUPERSEDED')
          .filter(x => isAdm || EXPERIMENT_FAMS.indexOf(x.family) < 0)
          .sort((a, b) => new Date(b.settled_at || 0) - new Date(a.settled_at || 0))
          .slice(0, 120)
          .map(x => ({
            pick_id: x.pick_id, family: x.family, status: x.status, result_code: x.result_code,
            settled_at: x.settled_at,
            event: { home: x.event.home, away: x.event.away, home_team_id: x.event.home_team_id, away_team_id: x.event.away_team_id, kickoff_at: x.event.kickoff_at },
            selection_code: x.selection_code, side: x.side, line: x.line,
            legs: (x.legs || null) && x.legs.map(l => ({ type: l.type, selection: l.selection || null, side: l.side || null, line: l.line != null ? l.line : null })),
            best_odds: x.best_odds,
            clv: x.clv != null ? x.clv : null,
          }));
        // Métricas quant PÚBLICAS (prueba de calidad, sin internals): CLV agregado, precisión del modelo vs
        // el consenso del mercado (Brier/log loss sobre las mismas picks) y calibración por rangos (n>=5).
        const q = dailyPicksQuant();
        const quantPublic = {
          clv: q.clv && q.clv.n ? { n: q.clv.n, avg_pct: q.clv.avg_pct, positive_rate: q.clv.positive_rate } : null,
          model_vs_market: q.model_vs_market && q.model_vs_market.n >= 10 ? {
            n: q.model_vs_market.n, brier_model: q.model_vs_market.brier_model,
            brier_market: q.model_vs_market.brier_market, skill: q.model_vs_market.skill,
          } : null,
          calibration: (q.calibration || []).filter(b => b.n >= 5),
        };
        return json(res, 200, { enabled: dailyPicksOn(), track_record: dailyPicksTrackRecord(merged), quant: quantPublic, picks: settled, generated_at: new Date().toISOString() });
      }
      // xG OBSERVADO del partido (TheStatsAPI) — SOLO partidos TERMINADOS, cache permanente en db.json
      // (1 fetch por partido; el plan es 12 req/min → jamás en vivo ni pre-partido). Kill switch: GP_XG_PANEL_ENABLED=false.
      if (p === '/api/beta/xg-report' && req.method === 'GET') {
        if (/^(0|false|no|off)$/i.test(String(process.env.GP_XG_PANEL_ENABLED || 'true').trim())) return json(res, 200, { available: false });
        const xh = String(url.searchParams.get('home') || '').toUpperCase(), xa = String(url.searchParams.get('away') || '').toUpperCase();
        if (!/^[A-Z]{3}$/.test(xh) || !/^[A-Z]{3}$/.test(xa)) return json(res, 400, { error: 'params' });
        const xkey = xh + '~' + xa;
        if (db.tsaXg[xkey]) return json(res, 200, db.tsaXg[xkey]);
        if (!matchFinalFor(xh, xa)) return json(res, 200, { available: false, reason: 'not_final' });
        const tsa = require('./data-providers/theStatsApi');
        if (!tsa.configured()) return json(res, 200, { available: false, reason: 'no_key' });
        try {
          const rep = await tsa.xgReport(xh, xa);
          if (!rep || !rep.xg) return json(res, 200, { available: false, reason: 'not_found' });
          const outRep = { available: true, xg: rep.xg, xg_h1: rep.xg_h1, xg_h2: rep.xg_h2, big_chances: rep.big_chances, shots: rep.shots, fetched_at: new Date().toISOString() };
          db.tsaXg[xkey] = outRep; save();
          return json(res, 200, outRep);
        } catch (e) { return json(res, 200, { available: false, reason: 'error' }); }
      }
      // INTEL del partido (7-jul): ANOTADORES PROBABLES (prop-engine de jugador + λ GP) y RADAR DE
      // DISPONIBILIDAD (capa de observación + factor λ sugerido). Admin-first hasta GP_PROPS_PICKS_PUBLIC.
      // ÍNDICE DE JUGADORES (descubribilidad): buscador del header + resolución nombre→pid en alineaciones
      // y plantillas del cliente. Todos los equipos del dataset (~700 filas compactas). Mismo gate que el
      // perfil. Cache 10 min en memoria.
      if (p === '/api/beta/player-index' && req.method === 'GET') {
        if (!propsPicksPublic() && !betaUser.isAdmin) return json(res, 403, { error: 'admin' });
        try {
          if (!global._playerIdxCache || Date.now() - global._playerIdxCache.at > 10 * 60 * 1000) {
            const PF0 = obsFit();
            const ph0 = db.playerPhotos || {};
            const players = PF0 ? Object.values(PF0.players).map(pl => ({
              pid: pl.pid, name: pl.name, team: pl.team, pos: pl.pos,
              min: pl.minutes, photo: ph0[pl.pid] ? 1 : 0,
            })) : [];
            global._playerIdxCache = { at: Date.now(), body: { players, count: players.length } };
          }
          return json(res, 200, global._playerIdxCache.body);
        } catch (e) { return json(res, 200, { players: [], count: 0 }); }
      }
      // GAP-AUDIT 1: player-index de CLUBES (paridad con /api/beta/player-index del Mundial) → jugadores de club
      // buscables en el buscador global. Multi-liga: itera clubsFit.leagueFit de cada liga con data. Mismo gate.
      if (p === '/api/beta/clubs-player-index' && req.method === 'GET') {
        if (!propsPicksPublic() && !betaUser.isAdmin) return json(res, 403, { error: 'admin' });
        try {
          if (!global._clubsPidxCache || Date.now() - global._clubsPidxCache.at > 10 * 60 * 1000) {
            const cf = require('./player-intel/clubsFit');
            let RT = global._clubsRatings;
            if (!RT || !RT.leagues) { try { RT = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); global._clubsRatings = RT; } catch { RT = { leagues: {} }; } }
            const ph = global._clubPlayerPhotos || {};
            const players = [];
            for (const league of Object.keys(RT.leagues || {})) {
              let fit = null; try { fit = cf.leagueFit(league); } catch { fit = null; }
              if (!fit) continue;
              const lname = (RT.leagues[league] && RT.leagues[league].name) || league;
              for (const pl of Object.values(fit.players)) {
                if (!pl.reliable) continue; // solo jugadores con muestra (evita ruido en la búsqueda)
                players.push({ pid: pl.pid, name: pl.name, team: pl.team, league, league_name: lname, pos: pl.pos, min: pl.minutes, photo: ph[pl.pid] ? 1 : 0 });
              }
            }
            global._clubsPidxCache = { at: Date.now(), body: { players, count: players.length } };
          }
          return json(res, 200, global._clubsPidxCache.body);
        } catch (e) { return json(res, 200, { players: [], count: 0 }); }
      }
      // INTELIGENCIA POR JUGADOR (punto 1 roadmap 8-jul): perfil completo — foto, muestra, tasas por 90',
      // forma partido a partido, disponibilidad del observer y la lectura del player-intel engine con los
      // códigos de razón ("por qué el sistema concluye X"). Caja negra: sin fuentes ni métodos. Admin-first.
      if (p === '/api/beta/player' && req.method === 'GET') {
        if (!propsPicksPublic() && !betaUser.isAdmin) return json(res, 403, { error: 'admin' });
        const pid = String(url.searchParams.get('pid') || '');
        if (!/^pl_[A-Za-z0-9]+$/.test(pid)) return json(res, 400, { error: 'params' });
        try {
          const PF = obsFit();
          if (!PF || !PF.players[pid]) return json(res, 404, { error: 'not_found' });
          const pl = PF.players[pid];
          const hist = require('./data/player-props-history.json');
          const form = [];
          for (const m of hist.matches) {
            const r = (m.players || []).find(x => x.pid === pid);
            if (!r) continue;
            form.push({ date: m.date, opponent: m.home === pl.team ? m.away : m.home, home: m.home === pl.team, started: !!r.started, min: r.min, goals: r.goals, shots: r.shots, sot: r.sot, xg: +Number(r.xg || 0).toFixed(2) });
          }
          form.sort((x, y) => new Date(y.date) - new Date(x.date));
          // próximo partido del equipo (bracket vivo) → λ del modelo con el factor del observer
          let next = null;
          try {
            const br = resolveRealBracket();
            for (const k of KNOCKOUT) {
              const x = br[k.m], rr = db.results[String(k.m)];
              if (x && x.home && x.away && (x.home === pl.team || x.away === pl.team) && (!rr || rr.status !== 'final')) { next = { home: x.home, away: x.away }; break; }
            }
          } catch { /* sin bracket */ }
          const nxg = next ? (gpXgFromCache(next.home, next.away) || {}) : {};
          const rawLambda = next ? (pl.team === next.home ? nxg.xgA : nxg.xgB) : null;
          const lambda = rawLambda > 0 ? rawLambda * observerLambdaFactor(pl.team) : null;
          const avail = observerAvailability()[pid] || null;
          // Narrativa del hallazgo del observer para ESTE jugador (con el keyword real → naturaleza).
          let availNarrative = null;
          try {
            if (avail && pl.team && db.observations && db.observations[pl.team]) {
              const { assessPlayers } = require('./observer/assess');
              const asm = assessPlayers((db.observations[pl.team].signals) || [])[pid];
              if (asm) { const nar = require('./observer/narrate').narratePlayer(asm); if (nar) availNarrative = { es: nar.es, en: nar.en, reason_code: nar.reason_code }; }
            }
          } catch { /* sin narrativa */ }
          const starters = projectedStarters();
          const cxi = next ? (confirmedXiPids()[_xiPairKey(next.home, next.away)] || null) : null;
          const intel = require('./player-intel/engine').playerIntel(PF, pid, {
            teamLambda: lambda, projectedStarter: starters.size ? starters.has(pid) : null,
            confirmedStarter: cxi ? cxi.has(pid) : null, availability: avail,
            setPieceReasons: require('./player-intel/setPieces').reasonsFor(pl.team, pl.name),
          });
          const setPieceRoles = require('./player-intel/setPieces').rolesFor(pl.team, pl.name);
          const ph = db.playerPhotos && db.playerPhotos[pid];
          // PERCENTIL vs su posición (jugadores confiables del torneo): dónde está su generación.
          const peers = Object.values(PF.players).filter(x => x.pos === pl.pos && x.reliable);
          const pctl = (arr, v) => arr.length > 1 ? Math.round(100 * arr.filter(x => x < v).length / (arr.length - 1)) : null;
          const percentiles = {
            xg90: pctl(peers.map(x => x.xg90), pl.xg90),
            shots90: pctl(peers.map(x => x.shots90), pl.shots90),
            sot90: pctl(peers.map(x => x.sot90), pl.sot90),
            peers: peers.length,
          };
          // % DEL ATAQUE: qué parte del xG del equipo generó él, en los partidos que jugó.
          let share = null;
          try {
            let mine = 0, teamTot = 0;
            for (const m of hist.matches) {
              const r = (m.players || []).find(x => x.pid === pid);
              if (!r || !(r.min > 0)) continue;
              mine += r.xg || 0;
              for (const q of m.players) if (q.team === pl.team) teamTot += q.xg || 0;
            }
            if (teamTot > 0) share = Math.round(100 * mine / teamTot);
          } catch { /* informativo */ }
          // H2H: partidos previos contra el PRÓXIMO rival (dataset del torneo).
          const rivalCode = next ? (pl.team === next.home ? next.away : next.home) : null;
          const h2h = rivalCode ? form.filter(f => f.opponent === rivalCode) : [];
          // MERCADOS DEL JUGADOR: cuotas vigentes de las casas para SUS props (si el partido está cotizado)
          // + la probabilidad del modelo (goal_value_shadow). Es la vista "inteligencia vs precio".
          let markets = [];
          try {
            const dbcfg2 = require('./database/config');
            if (dbcfg2.db && dbcfg2.db.configured && next) {
              const dbc2 = require('./database/client');
              const mr = (await dbc2.query(
                `SELECT q.market_id, q.market_family, q.line,
                        max(q.odds_decimal)::float best_odds, count(distinct q.sportsbook_code)::int books,
                        (SELECT gv.gp_probability::float FROM goal_value_shadow gv
                          WHERE gv.market_id = q.market_id AND gv.canonical_event_id = q.canonical_event_id
                          ORDER BY gv.created_at DESC LIMIT 1) AS model_prob
                 FROM sportsbook_goal_quote_current q
                 JOIN canonical_events ce ON ce.id = q.canonical_event_id AND ce.scheduled_start > now()
                 WHERE q.team_scope = $1
                 GROUP BY q.market_id, q.market_family, q.line, q.canonical_event_id
                 ORDER BY q.market_family, q.line`, [pid])).rows;
              markets = mr.map(r => ({
                market_id: r.market_id, family: r.market_family, line: r.line != null ? Number(r.line) : null,
                best_odds: r.best_odds, books: r.books, model_prob: r.model_prob != null ? +Number(r.model_prob).toFixed(3) : null,
              })).slice(0, 12);
            }
          } catch { /* sin DB → sin mercados */ }
          // SCOUT CARD: ejes de radar (percentil vs su posición), arquetipo ganado y lectura de scouting.
          let scout = null;
          try {
            scout = require('./player-intel/scout').buildScout(PF, pid, {
              aerial: playerAerial(pl.name),
              attackShare: share != null ? share / 100 : null,
              setPieceRoles,
            });
          } catch { /* sin scout */ }
          return json(res, 200, {
            available: true,
            profile: { pid, name: pl.name, team: pl.team, pos: pl.pos, photo: (ph && ph.photo) || null },
            sample: { minutes: pl.minutes, apps: pl.apps, starts: pl.starts, goals: pl.goals, assists: pl.assists || 0, yc: pl.yc || 0, rc: pl.rc || 0, exp_minutes_start: Math.round(pl.exp_minutes_start) },
            minutes_dist: require('./prop-engine/players').minutesDist(pl), // P2: P(titular) + min si titular/banco + P(60+/75+/90)
            rates90: { xg: +pl.xg90.toFixed(3), shots: +pl.shots90.toFixed(2), sot: +pl.sot90.toFixed(2), xa: +(pl.xa90 || 0).toFixed(3) },
            percentiles, attack_share_pct: share, scout,
            form: form.slice(0, 6),
            h2h_vs_next: h2h.slice(0, 3),
            next_match: next ? { home: next.home, away: next.away } : null,
            markets,
            intel, set_piece: setPieceRoles, availability: avail ? { status: avail.status, prob_miss: avail.prob_miss, corroborated: avail.corroborated } : null, availability_narrative: availNarrative,
            generated_at: new Date().toISOString(),
          });
        } catch (e) { return json(res, 200, { available: false }); }
      }
      // DESTACADOS DE HOY: los jugadores del partido del día (top proyección de gol por lado) con su
      // arquetipo y gancho de scouting → strip del board. Espejo de "players featured" con nuestro remate:
      // cada card abre el perfil completo con mercados y cuotas.
      if (p === '/api/beta/featured-today' && req.method === 'GET') {
        try {
          const PF = obsFit();
          if (!PF) return json(res, 200, { available: false, players: [] });
          const players = require('./prop-engine/players');
          const scoutMod = require('./player-intel/scout');
          const spMod = require('./player-intel/setPieces');
          const avail = observerAvailability();
          const today = new Date().toISOString().slice(0, 10);
          const out = [];
          const seenPair = new Set();
          for (const k of KNOCKOUT) {
            const meta = findFixtureMeta(String(k.m));
            if (!meta || !meta.datetime || !meta.home || !meta.away) continue;
            if (String(meta.datetime).slice(0, 10) !== today) continue;
            const pairKey = [meta.home, meta.away].sort().join('~');
            if (seenPair.has(pairKey)) continue;
            seenPair.add(pairKey);
            const xg = gpXgFromCache(meta.home, meta.away) || {};
            for (const [code, lambda] of [[meta.home, xg.xgA], [meta.away, xg.xgB]]) {
              const rows = players.projectTeam(PF, code, { teamLambda: lambda || null, top: 3 });
              for (const r of rows.slice(0, 3)) {
                const pl = PF.players[r.pid];
                if (!pl) continue;
                let sc = null;
                try { sc = scoutMod.buildScout(PF, r.pid, { aerial: playerAerial(pl.name), setPieceRoles: spMod.rolesFor(code, pl.name) }); } catch { /* sin scout */ }
                const av = avail[r.pid] || null;
                out.push({
                  pid: r.pid, name: r.name, team_id: code, pos: r.pos,
                  photo: (db.playerPhotos && db.playerPhotos[r.pid] && db.playerPhotos[r.pid].photo) || null,
                  anytime: +Number(r.anytime_goal || 0).toFixed(3),
                  archetype: (sc && sc.archetype) || null,
                  hook_es: sc && sc.read && sc.read.strengths[0] ? sc.read.strengths[0].es : null,
                  hook_en: sc && sc.read && sc.read.strengths[0] ? sc.read.strengths[0].en : null,
                  risk: av && av.prob_miss >= 0.3 ? av.status : null,
                  match: { home: meta.home, away: meta.away, kickoff: meta.datetime },
                });
              }
            }
          }
          out.sort((a, b) => b.anytime - a.anytime);
          return json(res, 200, { available: out.length > 0, players: out.slice(0, 8), generated_at: new Date().toISOString() });
        } catch (e) { return json(res, 200, { available: false, players: [] }); }
      }
      // FEATURED PLAYERS DE CLUBES (paridad con /api/beta/featured-today del Mundial): jugadores clave
      // proyectados de los partidos de HOY, multi-liga. MISMO projectTeam + scout + observer del Mundial,
      // parametrizado por club (clubsFit.leagueFit / clubGoalsFit / clubPlayerAvail). Cero llamadas externas:
      // usa global._clubsUpcoming (ya en memoria por /api/clubs/state y el observer). Feature de planes con
      // jugadores (Pro+): free → available:false. Las cards enlazan a #cplayer (perfil de club).
      if (p === '/api/beta/clubs-featured-today' && req.method === 'GET') {
        try {
          if (!clubsShadowOn()) return json(res, 200, { available: false, players: [] });
          const plan = effectivePlan(betaUser.email, url.searchParams.get('asplan'));
          if (plan === 'free') return json(res, 200, { available: false, players: [], locked: true });
          const players = require('./prop-engine/players');
          const cf = require('./player-intel/clubsFit');
          const goalsModel = require('./clubs-engine/goalsModel');
          const today = new Date().toISOString().slice(0, 10);
          const out = [];
          const seenTeam = new Set();
          for (const [league, up] of Object.entries(global._clubsUpcoming || {})) {
            const rows = (up && up.rows) || [];
            let fit = null; try { fit = cf.leagueFit(league); } catch { fit = null; }
            if (!fit) continue;
            const L = (global._clubsRatings && global._clubsRatings.leagues && global._clubsRatings.leagues[league]) || {};
            for (const m of rows) {
              if (!m || !m.utc_date) continue;
              if (String(m.utc_date).slice(0, 10) !== today) continue;
              const hId = String(m.home_team && m.home_team.id), aId = String(m.away_team && m.away_team.id);
              const hName = (m.home_team && m.home_team.name) || null, aName = (m.away_team && m.away_team.name) || null;
              // λ ataque/defensa del goal model (fallback Elo), MISMO que el cockpit de club
              let l = null;
              try { const gf = clubGoalsFit(league); if (gf) l = goalsModel.goalLambdas(gf, hId, aId); } catch { l = null; }
              if (!l) { const rh = clubElo(league, hId), ra = clubElo(league, aId); l = lambdas(rh + (L.hfa || 60), ra); }
              for (const [code, lambda] of [[hId, l && l[0]], [aId, l && l[1]]]) {
                const tk = league + ':' + code;
                if (seenTeam.has(tk)) continue;
                seenTeam.add(tk);
                let prj = [];
                try { prj = players.projectTeam(fit, code, { teamLambda: lambda || null, top: 3 }); } catch { prj = []; }
                for (const r of prj.slice(0, 3)) {
                  const pl = fit.players[r.pid];
                  if (!pl || !r.reliable) continue;
                  let sc = null; try { const cs = cf.clubPlayerScout(league, r.pid); sc = cs && cs.scout; } catch { sc = null; }
                  const av = clubPlayerAvail(code, r.pid);
                  out.push({
                    pid: r.pid, name: r.name, team_id: code, league, pos: r.pos,
                    photo: (global._clubPlayerPhotos && global._clubPlayerPhotos[r.pid] && global._clubPlayerPhotos[r.pid].photo) || null,
                    anytime: +Number(r.anytime_goal || 0).toFixed(3),
                    archetype: (sc && sc.archetype) || null,
                    hook_es: sc && sc.read && sc.read.strengths[0] ? sc.read.strengths[0].es : null,
                    hook_en: sc && sc.read && sc.read.strengths[0] ? sc.read.strengths[0].en : null,
                    risk: av && av.prob_miss >= 0.3 ? av.status : null,
                    match: { home: hId, away: aId, home_name: hName, away_name: aName, kickoff: m.utc_date, league },
                  });
                }
              }
            }
          }
          out.sort((a, b) => b.anytime - a.anytime);
          return json(res, 200, { available: out.length > 0, players: out.slice(0, 8), generated_at: new Date().toISOString() });
        } catch (e) { return json(res, 200, { available: false, players: [] }); }
      }
      // PERFIL TÁCTICO + MATCHUP (style engine, event data): ataque/defensa por situación y zona de los dos
      // equipos + hallazgos cruzados (córners/balón parado/aéreo/contra/zona/volumen). Mismo gate que Match Intel.
      if (p === '/api/beta/style' && req.method === 'GET') {
        if (!propsPicksPublic() && !betaUser.isAdmin) return json(res, 403, { error: 'admin' });
        const sh = String(url.searchParams.get('home') || '').toUpperCase(), sa = String(url.searchParams.get('away') || '').toUpperCase();
        if (!/^[A-Z]{3}$/.test(sh) || !/^[A-Z]{3}$/.test(sa)) return json(res, 400, { error: 'params' });
        const S = styleFit();
        if (!S) return json(res, 200, { available: false });
        const home = S[sh] || null, away = S[sa] || null;
        return json(res, 200, {
          available: !!(home && away),
          home: home && { team_id: sh, ...home }, away: away && { team_id: sa, ...away },
          findings: require('./style-engine/profile').matchupFindings(home, away),
          generated_at: new Date().toISOString(),
        });
      }
      if (p === '/api/beta/match-intel' && req.method === 'GET') {
        if (!propsPicksPublic() && !betaUser.isAdmin) return json(res, 403, { error: 'admin' });
        const ih = String(url.searchParams.get('home') || '').toUpperCase(), ia = String(url.searchParams.get('away') || '').toUpperCase();
        if (!/^[A-Z]{3}$/.test(ih) || !/^[A-Z]{3}$/.test(ia)) return json(res, 400, { error: 'params' });
        try {
          const players = require('./prop-engine/players');
          const { assessPlayers, suggestTeamFactor } = require('./observer/assess');
          const { playerIntel } = require('./player-intel/engine');
          const { narratePlayer } = require('./observer/narrate');
          const PF = obsFit();
          if (!PF) return json(res, 200, { available: false });
          const xg = gpXgFromCache(ih, ia) || {};
          const avail = observerAvailability();
          const starters = projectedStarters();
          const cxi = confirmedXiPids()[_xiPairKey(ih, ia)] || null;
          const side = (code, lambda) => {
            const rows = players.projectTeam(PF, code, { teamLambda: lambda || null, top: 5 }).map(r => {
              const pi = playerIntel(PF, r.pid, {
                teamLambda: lambda || null,
                projectedStarter: starters.size ? starters.has(r.pid) : null,
                confirmedStarter: cxi ? cxi.has(r.pid) : null,
                availability: avail[r.pid] || null,
                setPieceReasons: require('./player-intel/setPieces').reasonsFor(code, r.name),
              });
              return {
                pid: r.pid, name: r.name, pos: r.pos, anytime: +r.anytime_goal.toFixed(3), shots: +r.shots_match.toFixed(1),
                sot_o05: +r.sot_over_0_5.toFixed(3), risk: (avail[r.pid] && avail[r.pid].status) || null,
                role: pi ? pi.role : null, confidence: pi ? pi.confidence : null, reasons: pi ? pi.reasons : [],
                minutes_dist: players.minutesDist(PF.players[r.pid]), // P2
              };
            });
            const asmts = assessPlayers(((db.observations[code] || {}).signals) || []);
            const sug = suggestTeamFactor(PF, code, asmts);
            // CAPA DE NARRATIVA (8-jul): cada jugador señalado lleva su EXPLICACIÓN narrada ES/EN (por qué
            // el sistema lo marcó), sin exponer la fuente. Es lo que la gente no veía: el "porqué" del DUDA.
            const flagged = Object.values(asmts).filter(x => x.prob_miss > 0).map(x => {
              const nar = narratePlayer(x) || {};
              return { player: x.player, status: x.status, prob_miss: x.prob_miss, corroborated: x.corroborated !== false, why_es: nar.es || null, why_en: nar.en || null };
            });
            return { scorers: rows, radar: { players: flagged.slice(0, 6), lambda_factor: sug.factor } };
          };
          return json(res, 200, { available: true, home: side(ih, xg.xgA), away: side(ia, xg.xgB) });
        } catch (e) { return json(res, 200, { available: false }); }
      }
      // Value OUTRIGHT (campeón del Mundial): probabilidad GP del torneo (Monte Carlo) vs mercado
      // (Polymarket/Kalshi). Mismo concepto que la plataforma principal (modelo% vs mercado%). Read-only.
      // GATE SHARP: Value y Arbitraje son del plan Sharp (inerte con GP_PLANS_ENFORCED=off).
      // 403 {error:'upgrade'} → el cliente pinta el candado con CTA, no un error.
      if ((p === '/api/beta/value-outright' || p === '/api/beta/value' || p === '/api/beta/arbitrage') && req.method === 'GET') {
        const planV = effectivePlan(betaUser.email, url.searchParams.get('asplan'));
        if (planV !== 'sharp') return json(res, 403, { error: 'upgrade', need: 'sharp', plan: planV });
      }
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
      // GAP-AUDIT 3: value OUTRIGHT de CLUBES (campeón de liga). Paridad con value-outright del Mundial pero
      // multi-liga: prob de campeón del season sim (clubSeasonSim) por equipo, RANKED. El lado MERCADO (edge vs
      // Polymarket/Kalshi de "campeón de liga") queda listo pero market_available:false hasta cablear un feed de
      // mercados de campeón por liga (no existe hoy: el Polymarket del Mundial es un mercado único WC_WINNER).
      // Sharp-gated como el resto de Value/Arbitraje.
      if (p === '/api/beta/clubs-value-outright' && req.method === 'GET') {
        const planV = effectivePlan(betaUser.email, url.searchParams.get('asplan'));
        if (planV !== 'sharp') return json(res, 403, { error: 'upgrade', need: 'sharp', plan: planV });
        try {
          let RT = global._clubsRatings;
          if (!RT || !RT.leagues) { try { RT = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); global._clubsRatings = RT; } catch { RT = { leagues: {} }; } }
          const only = String(url.searchParams.get('league') || '').trim();
          const leagues = [];
          for (const league of Object.keys(RT.leagues || {})) {
            if (only && league !== only) continue;
            let sim = null; try { sim = clubSeasonSim(league); } catch { sim = null; }
            if (!sim || !sim.teams) continue;
            const L = RT.leagues[league] || {};
            const nameOf = (id) => (L.ratings && L.ratings[id] && L.ratings[id].name) || id;
            const items = Object.entries(sim.teams)
              .map(([id, s]) => ({ team_id: id, team_name: nameOf(id), model_pct: s.champion, market_pct: null, edge_pp: null, exp_rank: s.exp_rank, exp_points: s.exp_points }))
              .filter(x => x.model_pct > 0)
              .sort((a, b) => b.model_pct - a.model_pct)
              .slice(0, 12);
            if (items.length) leagues.push({ league, league_name: (L.name || league).split(' · ')[0], market_available: false, remaining: sim.remaining, items });
          }
          leagues.sort((a, b) => (b.items[0] ? b.items[0].model_pct : 0) - (a.items[0] ? a.items[0].model_pct : 0));
          return json(res, 200, { leagues, count: leagues.length, market_code: 'CLUB_LEAGUE_WINNER', market_available: false, generated_at: new Date().toISOString() });
        } catch (e) { return json(res, 200, { leagues: [], count: 0 }); }
      }
      // ARBITRAJE (scanner multi-venue): DOS familias — "Arbitraje puro" (surebet 2/N patas, cross-venue) y
      // "Precio atrasado" (value 1-pata: casa cuya cuota rezaga el consenso no-vig del resto). Es el MERCADO
      // contradiciéndose entre venues, sin modelo GP (Value=GP-vs-mercado vive aparte, intacto). Cache TTL.
      if (p === '/api/beta/arbitrage' && req.method === 'GET') {
        const scan = await getMarketScan();
        const dto = marketScannerDto.buildDto(scan, { resolveTeamId: (name) => resolveTeamIdLoose(name), maxItems: marketScanner.params.maxOpportunities });
        // FASE CLUBES (shadow): merge de oportunidades de clubes SOLO para admin real (clubs_shadow) y sin
        // preview ?asplan= (la vista "como plan X" debe ser la del usuario normal). Scan separado → el payload
        // de no-admins es byte-idéntico. Los items de clubes viajan con competition/competition_name (liga) y
        // team_ids null (el cliente cae a nombres crudos; la card no navega, informativa como los sintéticos).
        if ((betaUser.isAdmin || clubsPublicOn()) && clubsShadowFlagOn() && !url.searchParams.get('asplan')) {
          try {
            const cs = await getClubsScan();
            if (cs) {
              const cdto = marketScannerDto.buildDto(cs, { resolveTeamId: () => null, maxItems: marketScanner.params.maxOpportunities });
              if (cdto.available && ((cdto.arbitrage || []).length || (cdto.price_lag || []).length || cdto.counts.markets_scanned)) {
                // POST-MUNDIAL: si el scan de la casa (Mundial) no está disponible, el de clubes SE VUELVE el
                // board (antes el merge vivía dentro de dto.available → al morir el Mundial moría el arb de
                // clubes con él). Base vacía + el merge de abajo puebla todo.
                if (!dto.available) {
                  dto.available = true; dto.arbitrage = []; dto.price_lag = []; dto.counts = {};
                  dto.generated_at = cdto.generated_at || new Date().toISOString();
                  dto.scanner_version = cdto.scanner_version || null;
                }
                // resolver los tm_ ids del cruce (por nombre) para que la card navegue al cockpit cl-<liga>-<h>-<a>
                const tag = (it) => { const m = (db.clubsQuoteEvents || {})[it.event_id] || {}; return { ...it, competition: m.league || null, competition_name: m.league_name || null, home_team_id: m.league ? resolveClubId(m.league, it.home) : null, away_team_id: m.league ? resolveClubId(m.league, it.away) : null }; };
                dto.arbitrage = (dto.arbitrage || []).concat((cdto.arbitrage || []).map(tag));
                dto.price_lag = (dto.price_lag || []).concat((cdto.price_lag || []).map(tag));
                for (const k of ['markets_scanned', 'markets_with_consensus', 'arb_total', 'arb_executable', 'lag_total', 'lag_soft', 'lag_reference']) {
                  dto.counts[k] = (dto.counts[k] || 0) + (cdto.counts[k] || 0);
                }
                dto.clubs = { markets: cdto.counts.markets_scanned || 0, lag_soft: cdto.counts.lag_soft || 0, arb_executable: cdto.counts.arb_executable || 0 };
              }
            }
          } catch { /* clubes en shadow: nunca rompe el payload de la casa */ }
        }
        return json(res, 200, dto);
      }
      const ctx = {
        db: require('./database/client'),
        json,
        resolveTeamId: (name) => resolveTeamIdLoose(name),
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
      const { email, lang } = await readBody(req);
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Email inválido' });
      const e = email.toLowerCase();
      // idioma del código: lo manda el cliente (landing conoce el idioma del visitante); usuario existente →
      // su idioma efectivo; fallback ES. Antes el email era SOLO ES → los leads anglófonos (África) recibían
      // un correo que no entendían y encima caía en Promociones por el copy de marketing.
      const mailLang = (lang === 'en' || lang === 'es') ? lang : userLang(e);
      // anti-abuso: máximo 5 solicitudes por email cada 10 minutos (holgado para reenvíos legítimos)
      const prev = db.codes[e];
      if (prev && prev.count >= 5 && prev.exp > Date.now()) {
        return json(res, 429, { error: 'Demasiados intentos. Espera unos minutos y vuelve a intentar.' });
      }
      // REUSO DE CÓDIGO (8-jul): si hay un código vigente, se REUSA el mismo (el "resend" manda el MISMO
      // código → el que ya vieron sigue sirviendo, sin confundir con dos códigos distintos). El magic link
      // también se conserva. Anti-spam de correo: no reenviar el email si el último salió hace <20s.
      const valid = prev && prev.exp > Date.now() && prev.code;
      if (valid && prev.ts && Date.now() - prev.ts < 20 * 1000 && prev.sent) {
        return json(res, 200, { ok: true, sent: true, resent: true });
      }
      const code = valid ? prev.code : String(crypto.randomInt(100000, 999999));
      const magicTok = (valid && prev.magic) ? prev.magic : crypto.randomBytes(24).toString('hex');
      db.codes[e] = {
        code, magic: magicTok, exp: Date.now() + 10 * 60 * 1000, ts: Date.now(), sent: false,
        count: (prev && prev.exp > Date.now() ? prev.count : 0) + 1,
      };
      // magic link: token → email (reverso, para resolver el click desde el correo). TTL = el del código.
      db.magic[magicTok] = { email: e, exp: db.codes[e].exp };
      // CAPTURA DE LEAD: el email es válido (validado arriba) y mostró interés al pedir el código. Si aún
      // no es usuario, lo guardamos marcado como LEAD / no verificado (puede que el código cayera en spam
      // y no llegara a entrar; el haber dejado su correo ya denota interés → posible lead de marketing).
      if (!db.users[e]) {
        db.users[e] = { createdAt: Date.now(), favorites: [], verified: false, lead: true, leadAt: Date.now(), ref: 'lead' };
      }
      save();
      if (mailer.isConfigured()) {
        try {
          // OTP MÍNIMO transaccional (sin marketing ni emoji → Principal, no Promociones) y BILINGÜE.
          // Aprobado por Alexis sobre pruebas reales enviadas el 4-jul.
          // MAGIC LINK: un toque y entra, sin copiar/pegar (mínima fricción, clave en móvil africano).
          const mlink = `https://gpsimulador.com/api/auth/magic?t=${magicTok}`;
          const btnStyle = 'display:inline-block;background:#0BA661;color:#fff;font-weight:bold;font-size:16px;padding:14px 34px;border-radius:99px;text-decoration:none';
          const otp = mailLang === 'en' ? {
            subject: `${code} is your GP Simulador access code`,
            text: `Tap this link to log in instantly:\n${mlink}\n\nOr enter this code: ${code}\n\nBoth expire in 10 minutes.\n\nIf you didn't request it, you can ignore this email.\n\nGP Simulador · gpsimulador.com`,
            html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:440px;margin:0 auto;color:#1a1a1a">
<p style="margin:18px 0 12px;font-size:15px">Tap to log in instantly:</p>
<p style="text-align:center;margin:0 0 20px"><a href="${mlink}" style="${btnStyle}">Log in →</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#666">Or enter this code:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f4f5f4;padding:14px 20px;border-radius:10px;text-align:center;margin:6px 0 12px">${code}</p>
<p style="margin:0 0 4px;font-size:13px;color:#444">Both expire in 10 minutes.</p>
<p style="margin:14px 0 0;font-size:12.5px;color:#999">If you didn't request this, you can ignore this email.</p>
<p style="margin:18px 0 0;font-size:12.5px;color:#999">GP Simulador · gpsimulador.com</p>
</div>`,
          } : {
            subject: `${code} es tu código de acceso · GP Simulador`,
            text: `Toca este link para entrar al instante:\n${mlink}\n\nO ingresa este código: ${code}\n\nAmbos vencen en 10 minutos.\n\nSi no lo pediste, ignora este correo.\n\nGP Simulador · gpsimulador.com`,
            html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:440px;margin:0 auto;color:#1a1a1a">
<p style="margin:18px 0 12px;font-size:15px">Toca para entrar al instante:</p>
<p style="text-align:center;margin:0 0 20px"><a href="${mlink}" style="${btnStyle}">Entrar →</a></p>
<p style="margin:0 0 6px;font-size:13px;color:#666">O ingresa este código:</p>
<p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f4f5f4;padding:14px 20px;border-radius:10px;text-align:center;margin:6px 0 12px">${code}</p>
<p style="margin:0 0 4px;font-size:13px;color:#444">Ambos vencen en 10 minutos.</p>
<p style="margin:14px 0 0;font-size:12.5px;color:#999">Si no pediste esto, ignora este correo.</p>
<p style="margin:18px 0 0;font-size:12.5px;color:#999">GP Simulador · gpsimulador.com</p>
</div>`,
          };
          // FAILOVER DE ENTREGA (10-jul): un RE-pedido de código es la señal "no me llegó" → el reenvío sale
          // por el relay GAS (infra de Gmail, camino distinto; Resend venía encolando 60-96s post-masivos).
          // El primer envío sigue por Resend (protege la cuota diaria del relay).
          const preferRelay = db.codes[e].count >= 2;
          await mailer.sendMail({ to: e, subject: otp.subject, text: otp.text, html: otp.html, prefer: preferRelay ? 'relay' : undefined });
          db.codes[e].sent = true;
          save();
          console.log(`[auth] código enviado por email a ${e}${preferRelay ? ' (reintento → relay)' : ''}`);
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
    // MAGIC LINK: click desde el correo → verifica sin código, setea cookie de sesión y redirige a la
    // plataforma (premium.js sincroniza cookie→localStorage en el boot). Mínima fricción: un toque y entra.
    if (p === '/api/auth/magic' && req.method === 'GET') {
      const tok = String(url.searchParams.get('t') || '');
      const m = db.magic[tok];
      if (!m || !m.email || (m.exp && m.exp < Date.now())) {
        res.writeHead(302, { Location: '/?magicerr=1' });
        return res.end();
      }
      const e = m.email;
      delete db.magic[tok];
      if (db.codes[e]) delete db.codes[e];
      const isNewOrLead = !db.users[e] || db.users[e].lead;
      if (!db.users[e]) db.users[e] = { createdAt: Date.now(), favorites: [] };
      db.users[e].verified = true; db.users[e].lead = false;
      if (!db.users[e].verifiedAt) db.users[e].verifiedAt = Date.now();
      if (db.users[e].ref === 'lead') db.users[e].ref = 'directo';
      const token = crypto.randomBytes(24).toString('hex');
      db.sessions[token] = e;
      save();
      console.log(`[auth] magic link ${isNewOrLead ? '(alta/lead→verificado)' : ''} ${e}`);
      res.writeHead(302, {
        'Set-Cookie': `wc_token=${token};path=/;max-age=31536000;SameSite=Lax`,
        Location: '/?welcome=1',
      });
      return res.end();
    }
    if (p === '/api/me') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'No autenticado' });
      const code = ensureRefCode(u.email);
      // plan (Whop): `plan` = el real del grant; `plan_effective` = el que aplica hoy (pre-lanzamiento todos sharp).
      const g = db.premiumGrants[u.email] || null;
      return json(res, 200, {
        ...u, refCode: code, referrals: (db.users[u.email].referrals || []).length,
        plan: planFor(u.email), plan_effective: effectivePlan(u.email), plans_enforced: plansEnforced(),
        plan_founder: !!(g && g.founder), plan_status: g ? g.status : null, plan_since: g ? g.since || null : null,
        // lanzamiento founder: con la env encendida, "Mi suscripción" y el CTA de upgrade se abren a todos
        founder_public: /^(1|true|yes|on)$/i.test(String(process.env.GP_FOUNDER_PUBLIC_ENABLED || '').trim()),
        founder_spots: await whopFounderSpotsLeft().catch(() => null),
        // FASE CLUBES en SHADOW dentro de la plataforma principal (decisión 13-jul: extensión, no página
        // aparte): solo ADMIN + flag ven las superficies de clubes; para todos los demás la plataforma es
        // byte-idéntica hasta la fusión post-Mundial.
        clubs_shadow: !!(clubsShadowFlagOn() && (u.isAdmin || clubsPublicOn())), // FUSIÓN: público con GP_CLUBS_PUBLIC_ENABLED
        my_bets: myBetsSharp(u),                       // F1 Mi cartera — ACCESO (EXCLUSIVA Sharp)
        my_bets_feature: featFor('GP_MY_BETS_ENABLED', u), // VISIBILIDAD del nav (feature on) → planes menores la VEN pero al entrar reciben el candado "Ver planes"
        my_books: featFor('GP_MY_BOOKS_ENABLED', u),   // F2 Mis casas
        my_books_list: featFor('GP_MY_BOOKS_ENABLED', u) ? ((db.users[u.email] || {}).my_books || []) : undefined,
        watch_price: featFor('GP_WATCH_PRICE_ENABLED', u), // F3 Watch price
        daily_brief: featFor('GP_DAILY_BRIEF_ENABLED', u), // F4 GP Daily Brief
      });
    }
    // ONBOARDING: marca "ya vio el tour de bienvenida" (persistente por cuenta, no por dispositivo).
    if (p === '/api/me/onboarded' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      db.users[u.email].onboarded = Date.now();
      save();
      return json(res, 200, { ok: true });
    }
    // ONBOARDING — la PRIMERA PICK GRATIS ya se mostró/descartó: se persiste por cuenta (no vuelve a aparecer).
    if (p === '/api/me/welcome-pick-seen' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      db.users[u.email].welcomePickSeen = Date.now();
      save();
      return json(res, 200, { ok: true });
    }
    // ===== F1 — MI CARTERA (flag GP_MY_BETS_ENABLED; off → 404 = plataforma byte-idéntica) ===================
    // El usuario registra lo que APOSTÓ (ligado a una pick GP o manual) y marca el resultado. Métricas:
    // P&L/ROI/récord, CLV PERSONAL (apuestas ligadas a picks con cierre capturado → computeClv con SU cuota),
    // adherencia al stake y GP-vs-manual (rendimiento siguiendo picks vs apuestas propias).
    if (p === '/api/me/bets' && (req.method === 'GET' || req.method === 'POST')) {
      if (!myBetsOn()) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req);
      if (!myBetsSharp(u)) return json(res, 404, { error: 'No encontrado' }); // EXCLUSIVA Sharp (post-Mundial); admin-mode invisible
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      db.userBets = db.userBets || {};
      const list = db.userBets[u.email] = db.userBets[u.email] || [];
      if (req.method === 'POST') {
        const b = await readBody(req).catch(() => ({}));
        if (b.delete && b.id) {
          const i = list.findIndex(x => x.id === String(b.id));
          if (i >= 0) list.splice(i, 1);
          save();
        } else if (b.id && b.result !== undefined) {
          const bet = list.find(x => x.id === String(b.id));
          if (!bet) return json(res, 404, { error: 'No existe' });
          if (!['open', 'won', 'lost', 'void'].includes(b.result)) return json(res, 400, { error: 'Resultado inválido' });
          bet.result = b.result; bet.settled_at = b.result === 'open' ? null : new Date().toISOString();
          save();
        } else {
          const odds = Number(b.odds), stake = Number(b.stake);
          if (!(odds > 1 && odds < 1000) || !(stake > 0 && stake < 1e9)) return json(res, 400, { error: 'Cuota o stake inválido' });
          if (list.length >= 500) return json(res, 400, { error: 'Límite de apuestas' });
          const pick = b.pick_id ? myBetsFindPick(String(b.pick_id)) : null;
          list.push({
            id: 'ub_' + crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(),
            pick_id: pick ? pick.pick_id : null, family: pick ? pick.family : null,
            label: String(b.label || '').slice(0, 140) || (pick ? [pick.event && pick.event.home, 'v', pick.event && pick.event.away].join(' ') : '—'),
            kickoff: pick ? (pick.event && pick.event.kickoff_at) : null,
            odds: +odds.toFixed(3), stake: +stake.toFixed(2), book: String(b.book || '').slice(0, 40) || null,
            suggested_conf: pick && pick.confidence != null ? +Number(pick.confidence).toFixed(3) : null,
            result: 'open', settled_at: null,
          });
          save();
        }
      }
      return json(res, 200, { enabled: true, bets: list.slice().reverse().slice(0, 200), stats: myBetsStats(list) });
    }
    // ===== F2 — MIS CASAS: guarda las casas del usuario (el cliente filtra feed/value/arb con ellas) =========
    if (p === '/api/me/books' && req.method === 'POST') {
      if (!myBooksOn()) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req);
      if (!featFor('GP_MY_BOOKS_ENABLED', u)) return json(res, 404, { error: 'No encontrado' }); // modo admin: invisible (incluso anónimo)
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const b = await readBody(req).catch(() => ({}));
      const books = Array.isArray(b.books) ? b.books.map(x => String(x).toLowerCase().slice(0, 40)).filter(x => /^[a-z0-9_ .-]+$/.test(x)).slice(0, 30) : [];
      db.users[u.email].my_books = books;
      save();
      return json(res, 200, { ok: true, books });
    }
    // ===== F3 — WATCH PRICE: registro de vigilancias de precio ancladas a una pick activa ====================
    if (p === '/api/me/watches' && (req.method === 'GET' || req.method === 'POST')) {
      if (!watchPriceOn()) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req);
      if (!featFor('GP_WATCH_PRICE_ENABLED', u)) return json(res, 404, { error: 'No encontrado' }); // modo admin: invisible (incluso anónimo)
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      db.priceWatches = db.priceWatches || [];
      if (req.method === 'POST') {
        const b = await readBody(req).catch(() => ({}));
        if (b.delete && b.id) {
          const i = db.priceWatches.findIndex(x => x.id === String(b.id) && x.email === u.email);
          if (i >= 0) db.priceWatches.splice(i, 1);
          save();
        } else {
          const target = Number(b.target_odds);
          const pk = myBetsFindPick(String(b.pick_id || ''));
          if (!pk) return json(res, 404, { error: 'Pick no encontrada' });
          if (!(target > 1 && target < 1000)) return json(res, 400, { error: 'Cuota objetivo inválida' });
          const mine = db.priceWatches.filter(x => x.email === u.email && !x.dead);
          if (mine.length >= 30) return json(res, 400, { error: 'Límite de watches' });
          db.priceWatches.push({
            id: 'pw_' + crypto.randomBytes(6).toString('hex'), email: u.email, pick_id: pk.pick_id,
            label: [(pk.event && pk.event.home) || '', 'v', (pk.event && pk.event.away) || ''].join(' ').trim(),
            target_odds: +target.toFixed(3), created_at: new Date().toISOString(),
            last_odds: pk.best_odds != null ? +Number(pk.best_odds).toFixed(3) : null, last_check: null, triggered_at: null, dead: false,
          });
          save();
        }
      }
      const mine = db.priceWatches.filter(x => x.email === u.email).slice(-60).reverse();
      return json(res, 200, { enabled: true, watches: mine });
    }
    // ===== F4 — GP DAILY BRIEF in-app + opt-in del email diario ==============================================
    if (p === '/api/me/brief' && (req.method === 'GET' || req.method === 'POST')) {
      if (!dailyBriefOn()) return json(res, 404, { error: 'No encontrado' });
      const u = getUser(req);
      if (!featFor('GP_DAILY_BRIEF_ENABLED', u)) return json(res, 404, { error: 'No encontrado' }); // modo admin: invisible (incluso anónimo)
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      if (req.method === 'POST') {
        const b = await readBody(req).catch(() => ({}));
        db.users[u.email].brief_email = !!b.email_opt_in;
        save();
      }
      const bets = myBetsSharp(u) ? (db.userBets && db.userBets[u.email]) || [] : null;
      return json(res, 200, {
        enabled: true, brief: buildDailyBrief(),
        email_opt_in: !!db.users[u.email].brief_email,
        bankroll: bets ? myBetsStats(bets) : null, // estado del bankroll (F1) si Mi cartera está activa
      });
    }
    // CANCELACIÓN de suscripción con verificación por código al email (fricción intencional + seguridad).
    // Paso 1: POST /api/me/cancel/request → envía código. Paso 2: POST /api/me/cancel {code} → cancela el grant.
    // Marca el grant como cancelled (mantiene acceso hasta fin de ciclo por diseño de Whop); el usuario debe
    // además cancelar el pago recurrente en Whop (le damos el link). No borra la cuenta.
    if (p === '/api/me/cancel/request' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const g = db.premiumGrants[u.email];
      if (!g || g.status === 'cancelled') return json(res, 400, { error: 'No hay suscripción activa que cancelar.' });
      db.cancelCodes = db.cancelCodes || {};
      const code = String(crypto.randomInt(100000, 999999));
      db.cancelCodes[u.email] = { code, exp: Date.now() + 15 * 60 * 1000 };
      save();
      if (mailer.isConfigured()) {
        const en = userLang(u.email) === 'en';
        try {
          await mailer.sendMail({
            to: u.email, prefer: 'relay',
            subject: en ? `${code} is your cancellation code` : `${code} es tu código de cancelación`,
            text: en ? `Your cancellation code is ${code}. It expires in 15 minutes. If you didn't request to cancel, ignore this email and nothing changes.` : `Tu código de cancelación es ${code}. Vence en 15 minutos. Si no pediste cancelar, ignora este correo y nada cambia.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:440px;margin:0 auto;color:#1a1a1a"><p style="font-size:15px">${en ? 'Your cancellation code:' : 'Tu código de cancelación:'}</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;background:#f4f5f4;padding:14px 20px;border-radius:10px;text-align:center">${code}</p><p style="font-size:13px;color:#666">${en ? 'Expires in 15 minutes. If you did not request this, ignore this email and nothing changes.' : 'Vence en 15 minutos. Si no pediste esto, ignora este correo y nada cambia.'}</p></div>`,
          });
        } catch (e) { return json(res, 502, { error: 'No pudimos enviar el código. Intenta de nuevo.' }); }
      }
      return json(res, 200, { ok: true, sent: true });
    }
    if (p === '/api/me/cancel' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { code } = await readBody(req);
      const rec = (db.cancelCodes || {})[u.email];
      if (!rec || rec.exp < Date.now() || String(code) !== rec.code) return json(res, 400, { error: 'Código inválido o vencido.' });
      const g = db.premiumGrants[u.email];
      if (!g) return json(res, 400, { error: 'No hay suscripción activa.' });
      // Cancelar la membresía EN WHOP (fin del ciclo pagado) vía API → el usuario nunca necesita pisar
      // Whop: todo el ciclo de vida de la suscripción vive en gpsimulador.com. Si la API falla, el grant
      // igual queda cancelado local y el cliente muestra la nota de respaldo (cancelar también en Whop).
      let whopCancelled = false;
      if (g.whop_membership_id && process.env.WHOP_API_KEY) {
        try {
          const r = await fetch(`https://api.whop.com/api/v2/memberships/${encodeURIComponent(g.whop_membership_id)}/cancel`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.WHOP_API_KEY}` },
            signal: AbortSignal.timeout(8000),
          });
          whopCancelled = r.ok;
        } catch { /* respaldo: nota al usuario */ }
      }
      db.premiumGrants[u.email] = { ...g, status: 'cancelled', cancelledAt: new Date().toISOString(), whop_cancelled: whopCancelled || undefined, updatedAt: new Date().toISOString() };
      delete db.cancelCodes[u.email];
      save();
      console.log('[sub] cancelación confirmada por', u.email, whopCancelled ? '(membresía Whop cancelada por API)' : '(Whop NO cancelado por API, nota de respaldo)');
      return json(res, 200, { ok: true, cancelled: true, whop_cancelled: whopCancelled });
    }
    // ANALYTICS de retención (admin): DAU + D1/D7 + quiénes vuelven a diario. Fuente: db.dau (histórico se
    // acumula desde el deploy de este feature; las métricas de retención maduran con los días).
    if (p === '/api/admin/analytics') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const days = Object.keys(db.dau || {}).sort();
      const dayStr = (t) => new Date(t).toISOString().slice(0, 10);
      const dau = days.slice(-21).map(d => ({ date: d, n: Object.keys(db.dau[d]).length }));
      // retención D1/D7: usuarios creados el día D que volvieron el día D+1 / D+7 (promedio sobre días con dato)
      const ret = (offset) => {
        let num = 0, den = 0;
        for (const d of days) {
          const target = dayStr(new Date(d + 'T00:00:00Z').getTime() + offset * 86400000);
          if (!db.dau[target]) continue;
          const created = Object.entries(db.users).filter(([, x]) => x && x.createdAt && dayStr(x.createdAt) === d).map(([e]) => e);
          if (!created.length) continue;
          den += created.length;
          num += created.filter(e => db.dau[target][e]).length;
        }
        return den > 0 ? { pct: +(num / den * 100).toFixed(1), sample: den } : null;
      };
      // "vuelven a diario": activos en >=4 de los últimos 7 días con registro
      const last7 = days.slice(-7);
      const counts = {};
      last7.forEach(d => Object.keys(db.dau[d]).forEach(e => { counts[e] = (counts[e] || 0) + 1; }));
      const habituales = Object.entries(counts).filter(([, n]) => n >= Math.min(4, last7.length)).map(([e, n]) => ({ email: e, days: n }))
        .sort((a, b) => b.days - a.days);
      return json(res, 200, {
        tracking_since: days[0] || null, dau,
        today: dau.length ? dau[dau.length - 1].n : 0,
        d1: ret(1), d7: ret(7),
        habituales_count: habituales.length, habituales: habituales.slice(0, 40),
        total_users: Object.keys(db.users).length,
      });
    }
    // ===== SOPORTE in-platform: el usuario escribe desde la plataforma → email al admin (reply-to = el usuario,
    // responder desde Gmail le llega directo). Respaldo local en db.supportMsgs. Rate limit 5/hora por usuario.
    if (p === '/api/support' && req.method === 'POST') {
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const { message, subject } = await readBody(req).catch(() => ({}));
      const msg = String(message || '').trim();
      if (msg.length < 5) return json(res, 400, { error: 'short' });
      global._supRate = global._supRate || {};
      const nowT = Date.now(); const hits = (global._supRate[u.email] || []).filter(t => nowT - t < 3600e3);
      if (hits.length >= 5) return json(res, 429, { error: 'rate' });
      hits.push(nowT); global._supRate[u.email] = hits;
      const entry = { ts: new Date().toISOString(), email: u.email, subject: String(subject || '').slice(0, 120) || null, message: msg.slice(0, 4000) };
      db.supportMsgs.push(entry); if (db.supportMsgs.length > 200) db.supportMsgs = db.supportMsgs.slice(-200); save();
      const adminTo = (process.env.ADMIN_EMAILS || 'alexisgomezico@gmail.com').split(',')[0].trim();
      if (mailer.isConfigured()) {
        try {
          await mailer.sendMail({
            to: adminTo, replyTo: u.email, noListUnsub: true,
            subject: `[Soporte GP] ${entry.subject || msg.slice(0, 60)}`,
            text: `De: ${u.email}\nPlan: ${planFor(u.email)}\nFecha: ${entry.ts}\n\n${msg}\n\n— Respondé este email y le llega directo al usuario.`,
            html: `<div style="font-family:Arial,sans-serif;max-width:560px;color:#1a1a1a"><p><b>De:</b> ${u.email}<br><b>Plan:</b> ${planFor(u.email)}<br><b>Fecha:</b> ${entry.ts}</p><hr><p style="white-space:pre-wrap">${msg.replace(/</g, '&lt;')}</p><hr><p style="color:#888;font-size:12px">Respondé este email y le llega directo al usuario.</p></div>`,
          });
        } catch (e) { console.error('[support] mail error:', e.message); }
      }
      return json(res, 200, { ok: true });
    }
    // RECONCILIACIÓN DE PAGOS: dispara + reporta (key-gated). GET = corre reconcileWhopGrants y devuelve
    // {checked, ok, fixed, fixes[...]} → permite verificar que cada membresía de Whop tenga su grant sin sesión admin.
    if (p === '/api/internal/reconcile-grants') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      return json(res, 200, await reconcileWhopGrants().catch(e => ({ error: e.message })));
    }
    // ===== WEBHOOK DE WHOP: da/quita planes según pagos. INERTE hasta setear WHOP_WEBHOOK_KEY en Render.
    // URL a configurar en Whop: https://gpsimulador.com/api/whop/webhook?key=<WHOP_WEBHOOK_KEY>
    // Mapeo plan de Whop → nuestro: WHOP_PLAN_PRO_IDS / WHOP_PLAN_SHARP_IDS / WHOP_FOUNDER_PLAN_IDS (listas CSV).
    if (p === '/api/whop/webhook' && req.method === 'POST') {
      const wkey = process.env.WHOP_WEBHOOK_KEY;
      if (!wkey) return json(res, 404, { error: 'No encontrado' });
      if (url.searchParams.get('key') !== wkey) return json(res, 403, { error: 'No autorizado' });
      const body = await readBody(req).catch(() => ({}));
      const ev = { ts: new Date().toISOString(), action: body.action || body.event || body.type || null };
      try {
        const d = body.data || body;
        const email = String((d.user && d.user.email) || d.email || (d.metadata && d.metadata.email) || '').toLowerCase();
        const planId = String(d.plan_id || (d.plan && d.plan.id) || '');
        const csv = (k) => (process.env[k] || '').split(',').map(s => s.trim()).filter(Boolean);
        const plan = csv('WHOP_PLAN_SHARP_IDS').includes(planId) ? 'sharp' : csv('WHOP_PLAN_PRO_IDS').includes(planId) ? 'pro' : null;
        const act = String(ev.action || '');
        const valid = /went_valid|payment\.succeeded|membership\.created|activated/i.test(act);
        const invalid = /went_invalid|cancel|expired|refund|payment_failed|past_due/i.test(act);
        ev.parsed = { email: email || null, plan_id: planId || null, plan };
        if (email && plan && valid) {
          const isNewGrant = !db.premiumGrants[email] || db.premiumGrants[email].status !== 'active';
          db.premiumGrants[email] = {
            plan, status: 'active', founder: csv('WHOP_FOUNDER_PLAN_IDS').includes(planId) || undefined,
            source: 'whop', whop_membership_id: d.id || null, whop_plan_id: planId,
            since: (db.premiumGrants[email] && db.premiumGrants[email].since) || new Date().toISOString(), updatedAt: new Date().toISOString(),
          };
          ev.applied = { email, plan, status: 'active' };
          // BIENVENIDA FOUNDER (primera activación): refuerza la compra al instante — status founder, qué
          // tiene, y el precio congelado. Reduce el arrepentimiento post-compra. No bloquea el webhook.
          if (isNewGrant && mailer.isConfigured()) {
            const en = userLang(email) === 'en';
            const planN = plan === 'sharp' ? 'Sharp' : 'Pro';
            mailer.sendMail({
              to: email, noListUnsub: true,
              subject: en ? `You're in: Founder ${planN} activated ★` : `Ya estás dentro: Founder ${planN} activado ★`,
              text: en
                ? `Welcome to the first 100.\n\nYour Founder ${planN} is active and your price is locked for life: it will never go up while your subscription stays active, even when public prices rise after the World Cup.\n\nWhat you have now: the full platform during the World Cup, and when the club calendar starts, everything in your plan at your frozen price.\n\nOne detail: the payment is processed by Whop, so their receipt arrives in a separate email. You do not need their app or their site for anything: your subscription is fully managed inside gpsimulador.com, under My subscription.\n\nYour board: https://gpsimulador.com\nYour subscription: https://gpsimulador.com/#sub\n\nAny questions, just reply to this email.\n\nAlexis · GP Simulador`
                : `Bienvenido a los primeros 100.\n\nTu Founder ${planN} está activo y tu precio quedó congelado de por vida: no sube nunca mientras tu suscripción siga activa, aunque los precios públicos suban después del Mundial.\n\nLo que tenés ahora: la plataforma completa durante el Mundial, y cuando arranque el calendario de clubes, todo lo de tu plan a tu precio congelado.\n\nUn detalle: el pago lo procesa Whop, así que su recibo te llega en un correo aparte. No necesitás su app ni su web para nada: tu suscripción se gestiona completa dentro de gpsimulador.com, en Mi suscripción.\n\nTu tablero: https://gpsimulador.com\nTu suscripción: https://gpsimulador.com/#sub\n\nCualquier duda, respondé este correo.\n\nAlexis · GP Simulador`,
              html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a"><h2 style="color:#0BA661">${en ? `You're in: Founder ${planN} ★` : `Ya estás dentro: Founder ${planN} ★`}</h2><p>${en ? 'Welcome to the first 100. Your price is <b>locked for life</b>: it never goes up while your subscription stays active, even when public prices rise after the World Cup.' : 'Bienvenido a los primeros 100. Tu precio quedó <b>congelado de por vida</b>: no sube nunca mientras tu suscripción siga activa, aunque los precios públicos suban después del Mundial.'}</p><p>${en ? 'What you have now: the full platform during the World Cup, and when the club calendar starts, everything in your plan at your frozen price.' : 'Lo que tenés ahora: la plataforma completa durante el Mundial, y cuando arranque el calendario de clubes, todo lo de tu plan a tu precio congelado.'}</p><p style="font-size:13px;color:#666;background:#f6f8f7;border-radius:10px;padding:10px 14px">${en ? 'One detail: the payment is processed by Whop, so their receipt arrives in a separate email. You do not need their app or their site for anything: your subscription is fully managed inside gpsimulador.com, under <b>My subscription</b>.' : 'Un detalle: el pago lo procesa Whop, así que su recibo te llega en un correo aparte. No necesitás su app ni su web para nada: tu suscripción se gestiona completa dentro de gpsimulador.com, en <b>Mi suscripción</b>.'}</p><p style="text-align:center;margin:22px 0"><a href="https://gpsimulador.com" style="display:inline-block;background:#0BA661;color:#fff;font-weight:bold;padding:13px 30px;border-radius:99px;text-decoration:none">${en ? 'Open my board →' : 'Abrir mi tablero →'}</a></p><p style="font-size:12.5px;color:#888">${en ? 'Any questions, just reply to this email.' : 'Cualquier duda, respondé este correo.'}</p></div>`,
            }).catch(e => console.error('[whop] welcome email falló:', e.message));
          }
        } else if (email && invalid && db.premiumGrants[email]) {
          db.premiumGrants[email] = { ...db.premiumGrants[email], status: /past_due|payment_failed/i.test(act) ? 'past_due' : 'cancelled', updatedAt: new Date().toISOString() };
          ev.applied = { email, status: db.premiumGrants[email].status };
        } else ev.applied = null;
      } catch (e) { ev.error = e.message; }
      db.whopEvents.push(ev); if (db.whopEvents.length > 100) db.whopEvents = db.whopEvents.slice(-100);
      save();
      return json(res, 200, { ok: true }); // siempre 200 (evita tormenta de reintentos); el evento queda logueado
    }
    // ===== PLANES: gestión manual admin (grant/revoke/lista + eventos Whop + soporte reciente) =====
    if (p === '/api/admin/grants') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (req.method === 'GET') {
        const grants = Object.entries(db.premiumGrants).map(([email, g]) => ({ email, ...g }));
        return json(res, 200, { enforced: plansEnforced(), grants, whop_events: db.whopEvents.slice(-20), support_msgs: db.supportMsgs.slice(-20) });
      }
      if (req.method === 'POST') {
        const b = await readBody(req).catch(() => ({}));
        const email = String(b.email || '').trim().toLowerCase();
        if (!/.+@.+\..+/.test(email)) return json(res, 400, { error: 'Email inválido' });
        if (b.action === 'revoke') {
          if (db.premiumGrants[email]) db.premiumGrants[email] = { ...db.premiumGrants[email], status: 'cancelled', updatedAt: new Date().toISOString() };
        } else {
          db.premiumGrants[email] = { plan: b.plan === 'sharp' ? 'sharp' : 'pro', status: 'active', founder: !!b.founder || undefined, source: 'admin', since: new Date().toISOString(), updatedAt: new Date().toISOString(), grantedBy: u.email };
        }
        save();
        return json(res, 200, { ok: true, email, grant: db.premiumGrants[email] || null, plan: planFor(email) });
      }
      return json(res, 404, { error: 'No encontrado' });
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
    // Backup manual (admin): descarga el db.json EN MEMORIA (usuarios/sesiones/picks) para copia offsite.
    // Complementa el backup diario rotativo en disco (backupDbDaily). GET /api/admin/backup?list=1 lista los del disco.
    if (p === '/api/admin/backup') {
      const u = getUser(req);
      if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo admin' });
      if (url.searchParams.get('list') === '1') {
        let files = [];
        try { files = fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().map(f => ({ file: f, bytes: fs.statSync(path.join(BACKUP_DIR, f)).size })); } catch { /* sin backups aún */ }
        return json(res, 200, { dir: BACKUP_DIR, keep: BACKUP_KEEP, backups: files });
      }
      const body = JSON.stringify(db);
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="gp-db-backup-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      });
      return res.end(body);
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
        // landing_v2: la landing producto-first (picks/value/arbitraje). OFF hasta la fusión (se enciende con
        // GP_LANDING_V2_ENABLED en Render); ?landing2=1 la previsualiza sin flag (QA/admin).
        const landingV2 = /^(1|true|yes|on)$/i.test(String(process.env.GP_LANDING_V2_ENABLED || '').trim());
        return json(res, 200, { teaser: true, top, sims: N_SIMS, totalTeams: TEAMS.length, landing_v2: landingV2 });
      }
      // lastSeen se actualiza en memoria siempre, pero solo se PERSISTE como máx. 1/min por usuario:
      // /api/state es un hot path (polling); guardar en cada request presiona innecesariamente el disco.
      const _prevSeen = db.users[u.email].lastSeen || 0;
      db.users[u.email].lastSeen = Date.now();
      // ANALYTICS de retención: registro DIARIO de actividad (día UTC → usuarios que entraron). Permite DAU,
      // D1/D7 y "quién vuelve a diario". Barato: 1 write por usuario por día; poda a 60 días al abrir día nuevo.
      db.dau = db.dau || {};
      const _day = new Date().toISOString().slice(0, 10);
      if (!db.dau[_day]) {
        db.dau[_day] = {};
        const keep = Object.keys(db.dau).sort().slice(-60);
        db.dau = Object.fromEntries(keep.map(k => [k, db.dau[k]]));
      }
      db.dau[_day][u.email] = 1;
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
      const u = getUser(req);
      if (!u) return json(res, 401, { error: 'Inicia sesión' });
      const a = (url.searchParams.get('a') || '').toUpperCase(), b = (url.searchParams.get('b') || '').toUpperCase();
      if (!teamById[a] || !teamById[b] || a === b) return json(res, 400, { error: 'Equipos inválidos' });
      const out = await buildH2HDeep(a, b);
      // GOLES: proyección derivada de las MISMAS lambdas (mismo motor que el snapshot canónico) → el módulo de
      // goles aparece en CUALQUIER partido próximo, no solo en los pocos canonical_events. Detrás del flag del user.
      if (u.beta && u.beta.goalInsights) {
        try {
          const gdto = require('./gp-product/dto');
          const lh = out.probs && Number(out.probs.xgA), la = out.probs && Number(out.probs.xgB);
          if (lh > 0 && la > 0) out.goal_insights = gdto.goalInsights({ lambda_home: lh, lambda_away: la, lambda_total: lh + la });
        } catch { /* best-effort */ }
      }
      // GATING: la proyección de goles es Pro+ → al plan Free no le viaja la data (el cliente muestra el candado).
      if (effectivePlan(u.email, url.searchParams.get('asplan')) === 'free') delete out.goal_insights;
      return json(res, 200, out);
    }
    if (p === '/api/aciertos') {
      // público a propósito: el track record es la credibilidad de la marca
      return json(res, 200, trackRecord());
    }
    // TEASER PÚBLICO de la landing (sin auth): las picks de HOY con la SELECCIÓN OCULTA (solo familia, partido,
    // hora y confianza — "regístrate para ver la pick"), el récord del modelo y los contadores del scanner.
    // Nada sensible: no expone selección/cuota/casa ni oportunidades. Cache 60s.
    if (p === '/api/public/teaser') {
      if (!global._teaserCache || Date.now() - global._teaserCache.at > 60 * 1000) {
        const active = (db.dailyPicks || []).filter(x => x.status === 'ACTIVE')
          .filter(x => propsPicksPublic() || PROP_FAMS.indexOf(x.family) < 0) // props admin-first: fuera del teaser público
          .filter(x => EXPERIMENT_FAMS.indexOf(x.family) < 0) // experimento (PLAYER): nunca en el teaser
          .sort((a, b) => new Date(a.event.kickoff_at || 0) - new Date(b.event.kickoff_at || 0))
          .slice(0, 6)
          .map(x => {
            // nombres en AMBOS idiomas (la landing es ES/EN; antes solo viajaba el nombre ES → "Canadá" en inglés)
            const dic = require('./i18n/dictionary');
            return {
              family: x.family,
              home: x.event.home, away: x.event.away,
              home_en: dic.teamName(x.event.home_team_id, 'en', x.event.home), away_en: dic.teamName(x.event.away_team_id, 'en', x.event.away),
              home_team_id: x.event.home_team_id, away_team_id: x.event.away_team_id,
              kickoff: x.event.kickoff_at,
              confidence_bucket: x.confidence >= 0.6 ? 'high' : x.confidence >= 0.45 ? 'med' : 'low',
              // la selección/cuota NO viaja — es el gancho de registro
            };
          });
        const tr = trackRecord();
        let scanner = null;
        try {
          const scan = await getMarketScan();
          if (scan && !scan.disabled && !scan.unavailable) scanner = { markets: scan.markets_scanned || 0, lag: (scan.counts && scan.counts.lag_soft) || 0, arb: (scan.counts && scan.counts.arb_executable) || 0 };
        } catch { /* scanner apagado → sección omitida */ }
        // LANDING v3 (post-Mundial): datos de CLUBES públicos-seguros — hero con partido real (GP prob),
        // picks con selección OCULTA (mismo gancho del Mundial + chip de liga), carreras por el título
        // (season sim memoizado) y contadores del sweep. Solo nombres/probabilidades/ligas: jamás
        // selecciones, cuotas ni casas. Payload ADITIVO: el cliente lo usa solo con GP_LANDING_V3_ENABLED
        // o ?landing3=1 (preview). Reusa memos existentes (ratings/_clubsUpcoming/seasonSim/clubs scan);
        // cero fetches externos nuevos en un endpoint público sin auth.
        let clubs = null;
        try {
          if (clubsShadowOn()) {
            if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { leagues: {} }; } }
            const RT = global._clubsRatings, LKS = Object.keys(RT.leagues || {});
            const cNameOf = (lg, id) => { const L = RT.leagues[lg]; return (L && L.ratings && L.ratings[id] && L.ratings[id].name) || null; };
            // 1) HERO — partido real para la card del hero: EN VIVO primero (GP condicionada al marcador,
            //    mismo motor del cockpit), si no el próximo <48h con ambos equipos conocidos.
            let hero = null;
            for (const r of Object.values(db.clubResults || {})) {
              if (!r || r.status !== 'live' || !r.league || !RT.leagues[r.league]) continue;
              if (Date.now() - (r.at || 0) > 45 * 60e3) continue; // live "frizado" = final (regla del state)
              if (!cNameOf(r.league, r.home_id) || !cNameOf(r.league, r.away_id)) continue;
              const L = RT.leagues[r.league], hfa = L.hfa || 60;
              const rh = clubElo(r.league, r.home_id), ra = clubElo(r.league, r.away_id);
              const lmb = lambdas(rh + hfa, ra);
              let pr = null; try { pr = liveProbsFromLambdas(lmb[0], lmb[1], r.hg, r.ag, r.minute); } catch { pr = matchProbs(rh + hfa, ra); }
              hero = { league: r.league, league_name: L.name, status: 'live', minute: r.minute || null, hg: r.hg, ag: r.ag, utc: null,
                home: { id: r.home_id, name: cNameOf(r.league, r.home_id), prob: +pr.home.toFixed(3) }, draw: +pr.draw.toFixed(3),
                away: { id: r.away_id, name: cNameOf(r.league, r.away_id), prob: +pr.away.toFixed(3) },
                xg: [+lmb[0].toFixed(2), +lmb[1].toFixed(2)] };
              break;
            }
            if (!hero) {
              const cands = [];
              for (const [k, up] of Object.entries(global._clubsUpcoming || {})) {
                const L = RT.leagues[k]; if (!L) continue;
                for (const m of ((up && up.rows) || [])) {
                  const hId = String(m.home_team && m.home_team.id), aId = String(m.away_team && m.away_team.id);
                  if (!m.utc_date || !cNameOf(k, hId) || !cNameOf(k, aId)) continue;
                  const dt = +new Date(m.utc_date) - Date.now();
                  if (dt < -2 * 3600e3 || dt > 48 * 3600e3) continue;
                  cands.push({ k, hId, aId, utc: m.utc_date, dt: Math.abs(dt) });
                }
              }
              cands.sort((a, b) => a.dt - b.dt);
              const c = cands[0];
              if (c) {
                const L = RT.leagues[c.k], hfa = L.hfa || 60;
                const rh = clubElo(c.k, c.hId), ra = clubElo(c.k, c.aId);
                const pr = matchProbs(rh + hfa, ra), lmb = lambdas(rh + hfa, ra);
                hero = { league: c.k, league_name: L.name, status: 'upcoming', minute: null, hg: null, ag: null, utc: c.utc,
                  home: { id: c.hId, name: cNameOf(c.k, c.hId), prob: +pr.home.toFixed(3) }, draw: +pr.draw.toFixed(3),
                  away: { id: c.aId, name: cNameOf(c.k, c.aId), prob: +pr.away.toFixed(3) },
                  xg: [+lmb[0].toFixed(2), +lmb[1].toFixed(2)] };
              }
            }
            // Fallback estructural: sin live y con el memo de próximos frío (arranque), el hero sale del
            // EVENTO DE LA PICK más próxima (siempre hay mientras el pipeline de picks esté vivo).
            if (!hero) {
              const pk = (db.clubDailyPicks || []).filter(x => x.status === 'ACTIVE' && x.event && x.league && RT.leagues[x.league] && +new Date(x.event.kickoff_at || 0) > Date.now() - 2 * 3600e3)
                .sort((a, b) => new Date(a.event.kickoff_at || 0) - new Date(b.event.kickoff_at || 0))[0];
              if (pk) {
                const L = RT.leagues[pk.league], hfa = L.hfa || 60, ev = pk.event;
                const rh = clubElo(pk.league, ev.home_team_id), ra = clubElo(pk.league, ev.away_team_id);
                const pr = matchProbs(rh + hfa, ra), lmb = lambdas(rh + hfa, ra);
                hero = { league: pk.league, league_name: L.name, status: 'upcoming', minute: null, hg: null, ag: null, utc: ev.kickoff_at,
                  home: { id: ev.home_team_id, name: cNameOf(pk.league, ev.home_team_id) || ev.home, prob: +pr.home.toFixed(3) }, draw: +pr.draw.toFixed(3),
                  away: { id: ev.away_team_id, name: cNameOf(pk.league, ev.away_team_id) || ev.away, prob: +pr.away.toFixed(3) },
                  xg: [+lmb[0].toFixed(2), +lmb[1].toFixed(2)] };
              }
            }
            // 2) PICKS de clubes con la selección OCULTA — 1 por evento (mayor confianza), SOLID/GOALS.
            const seenEv = new Set();
            const cpicks = (db.clubDailyPicks || []).filter(x => x.status === 'ACTIVE' && (x.family === 'SOLID' || x.family === 'GOALS'))
              .filter(x => x.event && +new Date(x.event.kickoff_at || 0) > Date.now() - 2 * 3600e3)
              .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
              .filter(x => { const k = x.event.canonical_event_id || (x.event.home + x.event.away); if (seenEv.has(k)) return false; seenEv.add(k); return true; })
              .sort((a, b) => new Date(a.event.kickoff_at || 0) - new Date(b.event.kickoff_at || 0))
              .slice(0, 6)
              .map(x => ({ family: x.family, home: x.event.home, away: x.event.away,
                home_team_id: x.event.home_team_id, away_team_id: x.event.away_team_id,
                kickoff: x.event.kickoff_at, competition_name: x.competition_name || null, league: x.league || null,
                confidence_bucket: x.confidence >= 0.6 ? 'high' : x.confidence >= 0.45 ? 'med' : 'low' }));
            // 3) CARRERAS POR EL TÍTULO — prob de campeón por liga (clubSeasonSim, memo 30min)
            const races = [];
            for (const k of ['brasileirao', 'ligamx', 'mls', 'argentina', 'colombia', 'kleague', 'j1', 'csl']) {
              if (races.length >= 4) break;
              const L = RT.leagues[k]; if (!L || !(L.standings || []).length) continue;
              let sim = null; try { sim = clubSeasonSim(k); } catch { sim = null; }
              if (!sim || !sim.teams) continue;
              const top = Object.entries(sim.teams).map(([id, t]) => ({ id, name: cNameOf(k, id), prob: +(t.champion || 0).toFixed(3) }))
                .filter(t => t.name && t.prob > 0).sort((a, b) => b.prob - a.prob).slice(0, 3);
              if (!top.length) continue;
              races.push({ league: k, name: L.name, top });
            }
            // 4) contadores del sweep de clubes (memo; best-effort)
            let cscan = null;
            try {
              const cs = await getClubsScan();
              if (cs) { const cdto = marketScannerDto.buildDto(cs, { resolveTeamId: () => null, maxItems: 1 }); if (cdto.available) cscan = { markets: cdto.counts.markets_scanned || 0, lag: cdto.counts.lag_soft || 0, arb: cdto.counts.arb_executable || 0 }; }
            } catch { cscan = null; }
            clubs = { leagues_count: LKS.length, hero, picks: cpicks, races, scanner: cscan };
          }
        } catch { clubs = null; }
        global._teaserCache = { at: Date.now(), data: { picks: active, picks_enabled: dailyPicksOn(), record: { total: tr.total || 0, winners: tr.winners || 0 }, scanner, users: Object.keys(db.users || {}).length, landing_v3: landingV3On(), clubs } };
      }
      return json(res, 200, global._teaserCache.data);
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
    if (p === '/api/internal/goals/evaluate') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (req.method === 'POST') { const r = await evaluateUpcomingGoals({ limit: 80 }).catch(e => ({ error: e.message })); return json(res, 200, r); }
      return json(res, 200, { enabled: goalEngineOn(), running: _goalEvalRunning, last: _goalEvalLast });
    }
    // GOLES (G4): calibración POR FAMILIA + gate de publicación (replay point-in-time sin leakage sobre los
    // resultados reales). Admin-only. Determina qué familias están APPROVED para Picks (G5). Read-only.
    if (p === '/api/internal/goals/calibration') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      try { const rep = require('./calibration/goalGates').report({ results: db.results || {} }); rep.generated_at = new Date().toISOString(); return json(res, 200, rep); }
      catch (e) { return json(res, 200, { error: e.message }); }
    }
    // GOLES (G5): Picks de goles (shadow/admin). GET lista + estado; POST fuerza una evaluación. Admin-only.
    if (p === '/api/internal/goals/picks') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (req.method === 'POST') { const r = await evaluateGoalPicks().catch(e => ({ error: e.message })); settleGoalPicks(); return json(res, 200, r); }
      return json(res, 200, { enabled: goalPicksOn(), running: _goalPicksRunning, last: _goalPicksLast, count: db.goalPicks.length, picks: db.goalPicks.slice(-100) });
    }
    // PICKS DIARIAS (producto /x): track record COMPLETO + estado. Admin-only. GET = estado + rendimiento + todas
    // las picks; POST = fuerza una evaluación + liquidación inmediata (para pruebas internas).
    // EXPORT read-only del historial de picks para análisis offline (bankroll/Kelly, auditorías). Gateado por
    // clave secreta en env (patrón del webhook Whop): sin GP_EXPORT_KEY seteada el endpoint NO existe (404).
    if (p === '/api/internal/picks-export') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      return json(res, 200, { count: db.dailyPicks.length, picks: db.dailyPicks, track_record: dailyPicksTrackRecord(), quant: dailyPicksQuant(), exported_at: new Date().toISOString() });
    }
    // REEMPLAZO EDITORIAL de una pick ACTIVE (one-off, misma key): la vieja queda SUPERSEDED (fuera del feed y
    // del track record, mecanismo existente) y nace una nueva con la línea/cuota indicadas, misma familia/evento.
    // Uso 15-jul (orden de Alexis): mover líneas a versiones más conservadoras en la misma dirección.
    if (p === '/api/internal/picks-replace' && req.method === 'POST') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      let body = ''; req.on('data', c => body += c);
      await new Promise(r => req.on('end', r));
      let b; try { b = JSON.parse(body); } catch { return json(res, 400, { error: 'JSON inválido' }); }
      const old = (db.dailyPicks || []).find(x => x.pick_id === b.pick_id && x.status === 'ACTIVE');
      if (!old) return json(res, 404, { error: 'pick ACTIVE no encontrada' });
      old.status = 'SETTLED'; old.result_code = 'SUPERSEDED'; old.settled_at = new Date().toISOString();
      const crypto = require('crypto');
      const nu = {
        ...old,
        pick_id: 'dp_' + crypto.createHash('sha256').update(old.event.canonical_event_id + '|' + old.family + '|' + b.market_id).digest('hex').slice(0, 16),
        market_id: b.market_id, side: b.side, line: b.line,
        best_odds: b.best_odds, best_book: b.best_book || null, books: b.books != null ? b.books : old.books,
        model_prob: b.model_prob != null ? b.model_prob : null,
        market_prob: b.market_prob != null ? b.market_prob : null,
        confidence: b.confidence != null ? b.confidence : null,
        edge_pp: b.edge_pp != null ? b.edge_pp : null,
        line_move: null, clv: null, editorial: true, // gana la pasada de coherencia (el motor no la pisa)
        status: 'ACTIVE', result_code: 'PENDING', settlement_code: null,
        created_at: new Date().toISOString(), settled_at: null,
      };
      db.dailyPicks.push(nu); save();
      console.log('[picks-replace]', old.pick_id, old.market_id, '→', nu.pick_id, nu.market_id, '@' + nu.best_odds);
      return json(res, 200, { superseded: old.pick_id, new_pick: { pick_id: nu.pick_id, market_id: nu.market_id, side: nu.side, line: nu.line, best_odds: nu.best_odds, model_prob: nu.model_prob, confidence: nu.confidence } });
    }
    // MANTENIMIENTO (one-off, misma key que el export): borra picks de una familia creadas ANTES de un corte.
    // Uso 8-jul: eliminar las picks PLAYER del diseño viejo (edge-first) para que el admin vea solo las del
    // rediseño anclado al mercado. POST /api/internal/picks-prune?key=...&family=PLAYER&before=<ISO>
    if (p === '/api/internal/picks-prune' && req.method === 'POST') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      const fam = String(url.searchParams.get('family') || '');
      const before = new Date(String(url.searchParams.get('before') || ''));
      if (!PROP_FAMS.includes(fam) || !(before.getTime() > 0)) return json(res, 400, { error: 'family (CORNERS|CARDS|PLAYER) y before (ISO) requeridos' });
      const keep = [], removed = [];
      for (const x of db.dailyPicks) {
        if (x.family === fam && new Date(x.created_at || 0) < before) removed.push({ pick_id: x.pick_id, player: x.player_name || null, status: x.status, result_code: x.result_code || null });
        else keep.push(x);
      }
      db.dailyPicks = keep; if (removed.length) save();
      return json(res, 200, { removed: removed.length, detail: removed, remaining: db.dailyPicks.length });
    }
    // DATOS VERIFICADOS DE 90' (misma key que el export): carga marcador/córners/tarjetas/goleadores del
    // reglamentario para un partido que fue a prórroga/penales y RE-LIQUIDA sus picks (las VOID por falta de
    // 90' limpio y las aún activas) a 90', como liquidan las casas. Body JSON: { home, away, hg90, ag90,
    // corners90?, cards90?, scorers90?:[nombres], nonstarters90?:[nombres] } — ids de equipo del dataset.
    // Idempotente: re-postear con los mismos datos produce el mismo resultado. Auditable: db.reg90 conserva
    // el dato, la fuente y el timestamp.
    if (p === '/api/internal/picks-reg90' && req.method === 'POST') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      const b = await readBody(req).catch(() => ({}));
      const home = String(b.home || ''), away = String(b.away || '');
      if (!home || !away || b.hg90 == null || b.ag90 == null) return json(res, 400, { error: 'home, away, hg90, ag90 requeridos' });
      db.reg90 = db.reg90 || {};
      db.reg90[home + '~' + away] = {
        home, away, hg90: Number(b.hg90), ag90: Number(b.ag90),
        corners90: b.corners90 != null ? Number(b.corners90) : null,
        cards90: b.cards90 != null ? Number(b.cards90) : null,
        scorers90: Array.isArray(b.scorers90) ? b.scorers90 : null,
        nonstarters90: Array.isArray(b.nonstarters90) ? b.nonstarters90 : null,
        source: 'manual-verified', set_at: new Date().toISOString(),
      };
      const daily = require('./pick-engine/dailyPicks');
      const changes = [];
      for (const x of db.dailyPicks) {
        const eh = x.event && x.event.home_team_id, ea = x.event && x.event.away_team_id;
        if (!((eh === home && ea === away) || (eh === away && ea === home))) continue;
        // solo picks anuladas por falta de 90' o aún activas; SUPERSEDED y WIN/LOSS reales no se tocan
        if (!(x.result_code === 'VOID' || x.status === 'ACTIVE')) continue;
        if (x.status === 'ACTIVE' && !matchFinalFor(eh, ea)) continue; // guard: nunca liquidar un partido no terminado
        if (x.void_reason === 'NOT_IN_LINEUP') continue; // retiro preventivo legítimo, no re-liquidar
        const rg = reg90For(eh, ea); if (!rg) continue;
        const prev = x.result_code;
        let rc = null;
        if (['SOLID', 'GOALS', 'COMBO'].includes(x.family) && rg.homeGoals != null) {
          rc = daily.settleOne(x, { homeGoals: rg.homeGoals, awayGoals: rg.awayGoals });
        } else if ((x.family === 'CORNERS' || x.family === 'CARDS')) {
          const total = x.family === 'CORNERS' ? rg.corners : rg.cards;
          if (Number.isFinite(total)) { const over = total > Number(x.line); rc = (x.side === 'over' ? over : !over) ? 'WIN' : 'LOSS'; }
        } else if (x.family === 'PLAYER' && x.player_family === 'player_goal' && Array.isArray(rg.scorers)) {
          const target = _propNorm(x.player_name);
          if ((rg.nonstarters || []).some(n => _propNorm(n) === target)) rc = 'VOID';
          else rc = rg.scorers.some(n => _propNorm(n) === target) ? 'WIN' : 'LOSS';
        }
        if (rc == null || rc === prev) continue;
        // La corrección retro NO mueve la pick en el historial (que ordena por settled_at): una pick ya
        // liquidada conserva su fecha original; solo las aún activas se estampan ahora.
        x.result_code = rc; x.status = 'SETTLED';
        if (!x.settled_at) x.settled_at = new Date().toISOString();
        x.resettled_reg90 = true; // marca de auditoría: liquidada con datos verificados de 90'
        changes.push({ pick_id: x.pick_id, family: x.family, market: x.market_id || x.selection_code || x.side, player: x.player_name || null, from: prev, to: rc });
      }
      if (changes.length) save();
      return json(res, 200, { pair: home + '-' + away, changed: changes.length, detail: changes, track_record: dailyPicksTrackRecord() });
    }
    // PARCHE settled_at (misma key, one-off de mantenimiento): restaura la fecha de liquidación ORIGINAL de
    // picks re-liquidadas retro (la corrección del 12-jul les estampó "hoy" y el historial, que ordena por
    // settled_at, las mostraba como si fueran de hoy). Body: { items: [{ pick_id, settled_at }] }.
    if (p === '/api/internal/picks-patch-settled' && req.method === 'POST') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      const b = await readBody(req).catch(() => ({}));
      const items = Array.isArray(b.items) ? b.items : [];
      const changed = [];
      for (const it of items) {
        const x = db.dailyPicks.find(q => q.pick_id === it.pick_id);
        if (!x || x.status !== 'SETTLED' || !it.settled_at || !(new Date(it.settled_at).getTime() > 0)) continue;
        if (x.settled_at === it.settled_at) continue;
        changed.push({ pick_id: x.pick_id, family: x.family, from: x.settled_at, to: it.settled_at });
        x.settled_at = it.settled_at;
      }
      if (changed.length) save();
      return json(res, 200, { changed: changed.length, detail: changed });
    }
    // CUOTAS DE CLUBES (misma key): GET = estado del sweep; POST = forzarlo ya (salta throttle).
    if (p === '/api/internal/clubs-quotes') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (req.method === 'POST') { const r = await clubsQuotesSweep({ force: true }).catch(e => ({ error: e.message })); return json(res, 200, r); }
      return json(res, 200, { last: _clubsQuotesOut, last_at: _clubsQuotesLast ? new Date(_clubsQuotesLast).toISOString() : null, events: Object.keys(db.clubsQuoteEvents || {}).length });
    }
    // SUBIR datos grandes de clubes al disco persistente (/data/clubs/). Body: JSON crudo; ?name=<archivo>&key=.
    // Así los player-history/results/fotos NO viven en git (deploy rápido) y persisten entre deploys.
    if (p === '/api/internal/clubs-data' && req.method === 'POST') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      const name = String(url.searchParams.get('name') || '');
      if (!/^[a-z0-9_-]+\.json$/i.test(name)) return json(res, 400, { error: 'name inválido' });
      // lector de body ampliado (los JSONs pueden pesar varios MB)
      const buf = await new Promise((resolve, reject) => { let b = ''; req.on('data', c => { b += c; if (b.length > 30e6) req.destroy(); }); req.on('end', () => resolve(b)); req.on('error', reject); }).catch(() => null);
      if (!buf) return json(res, 400, { error: 'body vacío o muy grande' });
      try { JSON.parse(buf); } catch { return json(res, 400, { error: 'JSON inválido' }); }
      try { fs.mkdirSync(CLUB_DATA_DISK, { recursive: true }); fs.writeFileSync(path.join(CLUB_DATA_DISK, name), buf); }
      catch (e) { return json(res, 500, { error: e.message }); }
      // invalidar memos en memoria para que el nuevo archivo se recargue
      if (/^results-/.test(name)) { global._clubsResults = {}; }
      if (name === 'player-photos.json') loadClubPlayerPhotos();
      if (name === 'af-team-map.json') loadClubAfMap();
      return json(res, 200, { ok: true, name, bytes: buf.length, dir: CLUB_DATA_DISK });
    }
    // LISTAR los datos de clubes en el disco (verificación).
    if (p === '/api/internal/clubs-data' && req.method === 'GET') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      let files = [];
      try { files = fs.readdirSync(CLUB_DATA_DISK).map(f => ({ name: f, bytes: fs.statSync(path.join(CLUB_DATA_DISK, f)).size })); } catch { /* dir vacío */ }
      return json(res, 200, { dir: CLUB_DATA_DISK, files });
    }
    // MARCADORES DE CLUBES (verificación read-only + disparo manual, misma key).
    if (p === '/api/internal/clubs-scores') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (req.method === 'POST') { const r = await clubScoresSync({ force: true }).catch(e => ({ error: e.message })); return json(res, 200, r); }
      const rows = Object.entries(db.clubResults || {}).map(([k, r]) => ({ key: k, ...r }));
      return json(res, 200, { last: _clubScoresOut, count: rows.length, results: rows });
    }
    // PLAYER PROPS de clubes: disparo manual + estado del sweep (misma key).
    if (p === '/api/internal/clubs-props') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (req.method === 'POST') { const r = await clubsPlayerPropsSweep({ force: true }).catch(e => ({ error: e.message })); return json(res, 200, r); }
      return json(res, 200, { last: _clubsPropsOut });
    }
    // PICKS DE CLUBES (F3.3): verificación + dry-run + disparo manual (misma key). GET ?dry=1 muestra qué
    // produciría curate (candidatos + blockers) SIN persistir; GET normal = estado + track record; POST = evaluar.
    // Edición quirúrgica de una pick ACTIVA (ops, GP_EXPORT_KEY): allowlist de campos de mercado/narrativa.
    // Caso de uso 18-jul: reemplazar la selección de una pick por una más conservadora (marketing) sin tocar
    // el pipeline. El settlement usa side/line del registro → liquida la selección NUEVA correctamente.
    if (p === '/api/internal/pick-edit' && req.method === 'POST') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      const b = await readBody(req).catch(() => ({}));
      const all = [...(db.dailyPicks || []), ...(db.clubDailyPicks || [])];
      const pk = all.find(x => x.pick_id === String(b.pick_id || '') && x.status === 'ACTIVE');
      if (!pk) return json(res, 404, { error: 'pick ACTIVE no encontrada' });
      const ALLOW = ['side', 'line', 'market_id', 'best_odds', 'best_book', 'books', 'model_prob', 'market_prob', 'confidence', 'edge_pp', 'why_es', 'why_en'];
      const applied = {};
      for (const k of ALLOW) if (b.patch && b.patch[k] !== undefined) { pk[k] = b.patch[k]; applied[k] = b.patch[k]; }
      pk.edited_at = new Date().toISOString();
      save();
      return json(res, 200, { ok: true, pick_id: pk.pick_id, applied });
    }
    // Prueba REAL de los emails de F3/F4 (verificación end-to-end pedida por Alexis): envía el brief del día
    // o una alerta de precio de muestra a la dirección dada, por el MISMO camino (mailer → Resend) que usan
    // los flujos automáticos. Diag only (key interna), no toca estado.
    if (p === '/api/internal/feat-mail-test') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      const to = String(url.searchParams.get('to') || '').trim();
      const kind = String(url.searchParams.get('kind') || 'brief');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(res, 400, { error: 'to inválido' });
      if (!mailer.isConfigured()) return json(res, 200, { ok: false, error: 'mailer no configurado' });
      try {
        if (kind === 'watch') {
          await mailer.sendMail({
            to,
            subject: 'Alerta de precio: PRUEBA — Palmeiras v Fluminense: Más de 2.5 goles llegó a 1.95',
            text: 'Tu precio vigilado se disparó: [PRUEBA del sistema] Palmeiras v Fluminense: Más de 2.5 goles está ahora en 1.95 (tu objetivo: 1.90). Los precios se mueven — revisá la plataforma antes de apostar. https://gpsimulador.com',
          });
        } else {
          const b = buildDailyBrief();
          const en = url.searchParams.get('lang') === 'en';
          await mailer.sendMail({
            to,
            subject: (en ? 'GP Daily Brief — today\'s opportunities' : 'GP Daily Brief — las oportunidades de hoy') + ' [PRUEBA]',
            text: dailyBriefEmailText(b, en),
          });
        }
        return json(res, 200, { ok: true, kind, to });
      } catch (e) { return json(res, 200, { ok: false, error: String(e.message || e).slice(0, 200) }); }
    }
    if (p === '/api/internal/clubs-picks') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (req.method === 'POST') { const r = await evaluateClubDailyPicks().catch(e => ({ error: e.message })); return json(res, 200, r); }
      if (url.searchParams.get('dry')) { const r = await buildClubDailyPicks({ dryRun: true }).catch(e => ({ error: e.message })); return json(res, 200, r); }
      return json(res, 200, { enabled: dailyPicksOn() && clubsShadowOn(), last: _clubPicksLast, count: (db.clubDailyPicks || []).length, track_record: clubDailyPicksTrackRecord(), quant: clubDailyPicksQuant(), picks: (db.clubDailyPicks || []).slice(-200) });
    }
    // P2.5: pase de data manual (POST ?force=1 re-corre aunque hoy ya haya corrido) + estado (GET).
    if (p === '/api/internal/clubs-data-pass') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (req.method === 'POST') { const r = await clubsDataPass({ force: url.searchParams.get('force') === '1' }).catch(e => ({ error: e.message })); return json(res, 200, r); }
      return json(res, 200, { enabled: clubsShadowOn() && clubsDataPassOn(), running: _dataPassRunning, last_day: db.clubsDataPassDay || null });
    }
    // OBSERVER DE CLUBES (F2.3): verificación read-only + disparo manual (misma key). GET expone assessments+λ.
    if (p === '/api/internal/clubs-observer') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (req.method === 'POST') { const r = await runClubObserver().catch(e => ({ error: e.message })); return json(res, 200, r); }
      const teams = Object.entries(db.clubObservations || {}).map(([tmId, slot]) => ({
        tmId, league: slot.league, name: slot.name, signals: (slot.signals || []).length, fetched_at: slot.fetched_at,
        findings: clubObserverFindings(tmId), lambda: clubObserverLambdaFactor(slot.league, tmId),
      }));
      return json(res, 200, { last: _clubObsLast, observer_on: observerOn(), lambda_on: observerLambdaOn(), teams });
    }
    // ALINEACIONES de un cruce de club (F1.1): XI + formación + DT de cada equipo, desde API-Football. Busca el
    // fixture AF del cruce (próximo o reciente) por los af team ids del mapa. Memo por cruce 30 min.
    if (p === '/api/clubs/lineups') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      const league = String(url.searchParams.get('league') || ''), hId = String(url.searchParams.get('h') || ''), aId = String(url.searchParams.get('a') || '');
      const afk = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
      const afLg = CLUB_AF_LEAGUE[league], afMap = (global._clubAfMap || {})[league] || {};
      const afH = afMap[hId] && afMap[hId].af_id, afA = afMap[aId] && afMap[aId].af_id;
      if (!afk || !afLg || !afH || !afA) return json(res, 200, { available: false, reason: 'sin mapeo' });
      global._clubLineups = global._clubLineups || {};
      const ck = league + '|' + hId + '|' + aId;
      let c = global._clubLineups[ck];
      if (!c || Date.now() - c.at > 30 * 60e3) {
        c = { at: Date.now(), data: null };
        try {
          const af = async (q) => { const r = await fetch('https://v3.football.api-sports.io' + q, { headers: { 'x-apisports-key': afk }, signal: AbortSignal.timeout(15000) }); const j = r.ok ? await r.json() : null; return (j && j.response) || []; };
          const fx = await clubAfFixture(league, hId, aId); // fixture AF del cruce (resolución compartida con eventos)
          if (fx) {
            const lus = await af(`/fixtures/lineups?fixture=${fx.id}`);
            // resolver nombre AF → pl_ id del roster TSA (XI clickeable al perfil, paridad Mundial)
            const rslvH = clubRosterResolver(await clubRosterRows(hId)), rslvA = clubRosterResolver(await clubRosterRows(aId));
            const side = (afTeamId, resolve) => { const l = lus.find(x => x.team && x.team.id === afTeamId); if (!l) return null; return { formation: l.formation || null, coach: (l.coach && l.coach.name) || null, xi: (l.startXI || []).map(p => ({ name: p.player.name, pos: p.player.pos || null, num: p.player.number || null, pid: resolve(p.player.name) || undefined })), bench: (l.substitutes || []).slice(0, 9).map(p => ({ name: p.player.name, pid: resolve(p.player.name) || undefined })) }; };
            c.data = { fixture_date: fx.date, status: fx.status, home: side(afH, rslvH), away: side(afA, rslvA) };
          }
        } catch { /* AF sin datos este ciclo */ }
        global._clubLineups[ck] = c;
      }
      // P1.3 XI PROYECTADO: si AF aún no publica el once oficial (sale ~40-60 min antes), proyectarlo del fit de
      // la liga — MISMO criterio del Mundial (projectTeam: los 11 con más titularidades). El cliente muestra la
      // MISMA cancha con badge "proyectado" (projected:true → confirmed:false) y hace swap al oficial al llegar.
      const projSide = (tmId) => {
        try {
          const fitL = require('./player-intel/clubsFit').leagueFit(league);
          if (!fitL) return null;
          const rows = require('./prop-engine/players').projectTeam(fitL, tmId, { top: 11 });
          if (!rows || rows.length < 7) return null;
          return { formation: null, coach: null, projected: true, xi: rows.map(r => ({ name: r.name, pos: r.pos || null, num: null, pid: r.pid })), bench: [] };
        } catch { return null; }
      };
      const withProj = (sideData, tmId) => sideData || projSide(tmId);
      const dataOut = c.data || {};
      const homeOut = withProj(dataOut.home, hId), awayOut = withProj(dataOut.away, aId);
      if (!homeOut && !awayOut) return json(res, 200, { available: false, reason: 'sin alineación publicada' });
      return json(res, 200, { available: true, fixture_date: dataOut.fixture_date || null, status: dataOut.status || null, home: homeOut, away: awayOut });
    }
    // CONTEXTO del cruce (F1.4): bajas/lesiones (API-Football) + descanso (días desde el último partido) +
    // forma reciente. Informativo (paridad con el tab Context del Mundial); el ajuste al modelo llega con el
    // observer (F2.3). Memo por cruce 60 min.
    if (p === '/api/clubs/context') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      const league = String(url.searchParams.get('league') || ''), hId = String(url.searchParams.get('h') || ''), aId = String(url.searchParams.get('a') || '');
      if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { leagues: {} }; } }
      const afk = process.env.API_FOOTBALL_KEY || process.env.VITE_API_FOOTBALL_KEY || '';
      const afLg = CLUB_AF_LEAGUE[league], afMap = (global._clubAfMap || {})[league] || {};
      global._clubCtx = global._clubCtx || {};
      const ck = league + '|' + hId + '|' + aId;
      let c = global._clubCtx[ck];
      if (!c || Date.now() - c.at > 60 * 60e3) {
        c = { at: Date.now(), home: { injuries: [] }, away: { injuries: [] } };
        // bajas/lesiones recientes (últimos 21 días, dedupe por jugador) de API-Football
        const injOf = async (afId) => {
          if (!afk || !afLg || !afId) return [];
          try {
            const r = await fetch(`https://v3.football.api-sports.io/injuries?team=${afId}&league=${afLg}&season=2026`, { headers: { 'x-apisports-key': afk }, signal: AbortSignal.timeout(15000) });
            const j = r.ok ? await r.json() : null; const resp = (j && j.response) || [];
            const cutoff = Date.now() - 21 * 86400e3, seen = {};
            const out = [];
            for (const it of resp.sort((a, b) => new Date((b.fixture || {}).date || 0) - new Date((a.fixture || {}).date || 0))) {
              const nm = it.player && it.player.name; if (!nm || seen[nm]) continue;
              const d = (it.fixture || {}).date ? +new Date(it.fixture.date) : 0;
              if (d && d < cutoff) continue;
              seen[nm] = 1;
              out.push({ name: nm, reason: (it.player && it.player.reason) || null, type: (it.player && it.player.type) || null });
              if (out.length >= 8) break;
            }
            return out;
          } catch { return []; }
        };
        c.home.injuries = await injOf(afMap[hId] && afMap[hId].af_id);
        c.away.injuries = await injOf(afMap[aId] && afMap[aId].af_id);
        // descanso: días desde el último partido (results-<liga>.json)
        try {
          global._clubsResults = global._clubsResults || {};
          if (!global._clubsResults[league]) { try { global._clubsResults[league] = JSON.parse(fs.readFileSync(clubDataFile(`results-${league}.json`), 'utf8')).rows || []; } catch { global._clubsResults[league] = []; } }
          const lastOf = (tid) => { const rs = global._clubsResults[league].filter(r => (r.home_id === tid || r.away_id === tid) && r.hg != null).sort((a, b) => (a.date < b.date ? 1 : -1)); return rs[0] ? Math.round((Date.now() - +new Date(rs[0].date)) / 86400e3) : null; };
          c.home.rest = lastOf(hId); c.away.rest = lastOf(aId);
        } catch { /* sin results */ }
        // forma reciente (reusa clubMatchForm)
        try { const f = clubMatchForm(league, hId, aId); if (f) { c.home.form = f.home; c.away.form = f.away; } } catch { /* sin forma */ }
        global._clubCtx[ck] = c;
      }
      // F2.3: hallazgos del OBSERVER (disponibilidad narrada, caja negra) + factor λ — frescos, fuera del memo 60min.
      return json(res, 200, {
        home: { ...c.home, avail: clubObserverFindings(hId) },
        away: { ...c.away, avail: clubObserverFindings(aId) },
        observer_factor: { home: clubObserverLambdaFactor(league, hId), away: clubObserverLambdaFactor(league, aId) },
      });
    }
    // FORMA + RESULTADOS de un equipo de club (F2.1): últimos partidos con marcador (results-<liga>.json).
    if (p === '/api/clubs/team-form') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      const league = String(url.searchParams.get('league') || ''), teamId = String(url.searchParams.get('team') || '');
      if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { leagues: {} }; } }
      const L = (global._clubsRatings.leagues || {})[league];
      const nameOf = (tid) => (L && L.ratings && L.ratings[tid] && L.ratings[tid].name) || tid;
      global._clubsResults = global._clubsResults || {};
      if (!global._clubsResults[league]) {
        try { global._clubsResults[league] = JSON.parse(fs.readFileSync(clubDataFile(`results-${league}.json`), 'utf8')).rows || []; }
        catch { global._clubsResults[league] = []; }
      }
      const mine = global._clubsResults[league]
        .filter(r => (r.home_id === teamId || r.away_id === teamId) && r.hg != null && r.ag != null)
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      const results = mine.map(r => {
        const home = r.home_id === teamId;
        const gf = home ? r.hg : r.ag, ga = home ? r.ag : r.hg;
        return { date: r.date, opp: nameOf(home ? r.away_id : r.home_id), opp_id: home ? r.away_id : r.home_id, home, gf, ag: ga, res: gf > ga ? 'W' : gf < ga ? 'L' : 'D' };
      });
      const form = results.slice(0, 5).map(r => r.res);
      // F2.3: hallazgos del OBSERVER (disponibilidad narrada) para el tab News del equipo — mismo dato que el
      // News/Context del Mundial (caja negra, sin fuente). Fresco (assessPlayers es barato).
      let news = [];
      try { news = clubObserverFindings(teamId); } catch { news = []; }
      // F4.1: proyección de temporada (campeón/top/descenso de ESTE equipo + líderes) — paridad con la prob de
      // campeón del equipo del Mundial. Construida con lo disponible; se actualiza conforme llegan resultados.
      let season = null, season_leaders = null;
      try {
        const sim = clubSeasonSim(league);
        if (sim && sim.teams[teamId]) {
          season = { ...sim.teams[teamId], remaining: sim.remaining, played: sim.played, top_n: sim.top_n, relegate: sim.relegate };
          const nameOf2 = (tid) => (L && L.ratings && L.ratings[tid] && L.ratings[tid].name) || tid;
          season_leaders = Object.entries(sim.teams).map(([id, v]) => ({ id, name: nameOf2(id), champion: v.champion, exp_points: v.exp_points }))
            .sort((a, b) => b.champion - a.champion).slice(0, 6);
        }
      } catch { season = null; }
      return json(res, 200, { team: teamId, form, results: results.slice(0, 20), news, season, season_leaders });
    }
    // MERCADOS de un cruce (F1.5, verificación read-only sin sesión): ?league=&h=&a=
    if (p === '/api/internal/clubs-market' && req.method === 'GET') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { leagues: {} }; } }
      const mk = await clubMatchMarkets(String(url.searchParams.get('league') || ''), String(url.searchParams.get('h') || ''), String(url.searchParams.get('a') || '')).catch(e => ({ error: e.message }));
      return json(res, 200, { markets: mk, events: Object.keys(db.clubsQuoteEvents || {}).length });
    }
    // EVOLUCIÓN por liga (F0.3+F4.2): serie temporal de Elo/posición. GET admin.
    if (p === '/api/clubs/evolution') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      const lg = String(url.searchParams.get('league') || '');
      const RT = global._clubsRatings || {};
      const L = RT.leagues && RT.leagues[lg];
      const hist = (db.clubHistory && db.clubHistory[lg]) || [];
      const nameOf = (tid) => (L && L.ratings && L.ratings[tid] && L.ratings[tid].name) || tid;
      return json(res, 200, { league: lg, snapshots: hist.length, series: hist.map(h => ({ d: h.d, teams: h.teams })), name_of: Object.fromEntries((L ? Object.keys(L.ratings || {}) : []).map(id => [id, nameOf(id)])) });
    }
    // ELO DINÁMICO (F0.4): estado del overlay + prueba manual (?test=lg,hId,aId,hg,ag para simular un resultado).
    if (p === '/api/internal/clubs-elo') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { leagues: {} }; } }
      const test = url.searchParams.get('test');
      if (test && req.method === 'POST') {
        const [lg, hId, aId, hg, ag] = test.split(',');
        const before = { home: clubElo(lg, hId), away: clubElo(lg, aId) };
        applyClubElo(lg, hId, aId, Number(hg), Number(ag)); save();
        return json(res, 200, { lg, hId, aId, score: hg + '-' + ag, before, after: { home: clubElo(lg, hId), away: clubElo(lg, aId) } });
      }
      const overlay = db.clubElos || {};
      return json(res, 200, { fit_at: db.clubElosFitAt || null, adjusted: Object.keys(overlay).length, overlay });
    }
    // SCAN DE CLUBES (verificación read-only, misma key): el DTO que el admin ve mergeado en /api/beta/arbitrage,
    // sin necesitar sesión. Diagnóstico del pipeline sweep → loader → scanner.
    // Cloudbet (crypto): dry-run (GET, muestra qué matchearía SIN escribir) + sweep real (POST). GATED tras key.
    if (p === '/api/internal/cloudbet') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (!process.env.CLOUDBET_API_KEY) return json(res, 200, { enabled: false, note: 'Falta CLOUDBET_API_KEY (registrarse en cloudbet.com → API key gratis)' });
      const r = await cloudbetSweep({ force: true, dryRun: req.method !== 'POST' }).catch(e => ({ error: e.message }));
      return json(res, 200, { enabled: true, ...r });
    }
    if (p === '/api/internal/clubs-scan' && req.method === 'GET') {
      const xk = process.env.GP_EXPORT_KEY || '';
      if (!xk || url.searchParams.get('key') !== xk) return json(res, 404, { error: 'No encontrado' });
      if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { leagues: {} }; } }
      const cs = await getClubsScan().catch(e => ({ error: e.message }));
      if (!cs) return json(res, 200, { available: false, events: Object.keys(db.clubsQuoteEvents || {}).length, flag: clubsShadowFlagOn() });
      if (cs.error) return json(res, 200, { available: false, error: cs.error });
      const cdto = marketScannerDto.buildDto(cs, { resolveTeamId: () => null, maxItems: marketScanner.params.maxOpportunities });
      // muestra la resolución de tm_ ids (misma lógica que el merge de /api/beta/arbitrage) → verificar navegación al cockpit
      const withIds = (it) => { const m = (db.clubsQuoteEvents || {})[it.event_id] || {}; return { competition: m.league, home: it.home, away: it.away, home_team_id: m.league ? resolveClubId(m.league, it.home) : null, away_team_id: m.league ? resolveClubId(m.league, it.away) : null, outcome: it.outcome, odds: it.odds, edge: it.edge }; };
      return json(res, 200, { available: cdto.available !== false, counts: cdto.counts || null, arbitrage: (cdto.arbitrage || []).length, price_lag: (cdto.price_lag || []).length, sample: (cdto.price_lag || []).slice(0, 5).map(withIds) });
    }
    // PROPS (solo admin): estado del pipeline + correr el pase ya (ingesta+value+settle).
    if (p === '/api/internal/props') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (req.method === 'POST') {
        _propsLastRunMs = 0; // forzar (salta el throttle interno)
        const r = await evaluateUpcomingProps().catch(e => ({ error: e.message }));
        const st = await settlePropsPicks().catch(() => 0);
        return json(res, 200, { run: r, settled: st });
      }
      const propPicksAll = db.dailyPicks.filter(x => PROP_FAMS.includes(x.family));
      return json(res, 200, { enabled: propsOn(), picks_public: propsPicksPublic(), running: _propsRunning, last: _propsLast, credits_remaining: _propsCredits, prop_picks: propPicksAll.slice(-40) });
    }
    // CAPA DE OBSERVACIÓN (shadow, solo admin): señales + disponibilidad por jugador + factor λ sugerido.
    // POST = correr el pase ahora. NADA de esto toca el modelo oficial (aplicación pendiente de encendido).
    if (p === '/api/internal/observer') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      if (req.method === 'POST') { const r = await runObserver().catch(e => ({ error: e.message })); return json(res, 200, r); }
      const { assessPlayers, suggestTeamFactor } = require('./observer/assess');
      const fit = obsFit();
      const teams = {};
      for (const code of Object.keys(db.observations)) {
        const slot = db.observations[code] || {};
        const assessments = assessPlayers(slot.signals || []);
        teams[code] = {
          fetched_at: slot.fetched_at || null,
          signals: (slot.signals || []).slice(-25).reverse(),
          players: Object.values(assessments),
          suggested_lambda_factor: fit ? suggestTeamFactor(fit, code, assessments) : null,
        };
      }
      return json(res, 200, { enabled: observerOn(), running: _obsRunning, last: _obsLast, alive_teams: obsAliveTeams(), teams });
    }
    if (p === '/api/internal/daily-picks') {
      // admin por sesión, o GP_EXPORT_KEY (ops/diagnóstico — mismo criterio que clubs-picks)
      const xk0 = process.env.GP_EXPORT_KEY || '';
      const keyOk = xk0 && url.searchParams.get('key') === xk0;
      const u = getUser(req); if (!keyOk && (!u || !u.isAdmin)) return json(res, 403, { error: 'Solo el administrador' });
      if (req.method === 'POST') { const r = await evaluateDailyPicks().catch(e => ({ error: e.message })); const s = settleDailyPicks(); return json(res, 200, { evaluate: r, settled: s }); }
      // CONTINUACIÓN post-Mundial: el admin ve la MISMA tabla unificada que el público (Mundial + clubes
      // públicas, con escudos). El bloque `clubs` de abajo sigue siendo el monitoreo privado congelado (todas
      // las de clubes, incl. regime:monitor) como referencia admin-only.
      const adminMerged = (db.dailyPicks || []).concat(clubPublicPicks({ isAdmin: true }));
      return json(res, 200, { enabled: dailyPicksOn(), running: _dailyPicksRunning, last: _dailyPicksLast, count: db.dailyPicks.length, track_record: dailyPicksTrackRecord(adminMerged), quant: dailyPicksQuant(), picks: adminMerged.slice(-400),
        // CLUBES (monitoreo privado, 15-jul): track record + picks de clubes SOLO en esta vista admin —
        // jamás en el rendimiento público.
        clubs: { count: (db.clubDailyPicks || []).length, track_record: clubDailyPicksTrackRecord(), quant: clubDailyPicksQuant(), picks: (db.clubDailyPicks || []).slice(-200) } });
    }
    // SERIE de línea de un mercado (observatorio admin): goal_value_shadow leída como serie temporal + resumen
    // line-intel (apertura/cierre/dirección/steam). Read-only.
    if (p === '/api/internal/line-intel' && req.method === 'GET') {
      const u = getUser(req); if (!u || !u.isAdmin) return json(res, 403, { error: 'Solo el administrador' });
      const ev = url.searchParams.get('event'), mk = url.searchParams.get('market');
      if (!ev || !mk) return json(res, 400, { error: 'event y market requeridos' });
      const dbc = require('./database/client');
      if (!dbc.isConfigured()) return json(res, 200, { event: ev, market: mk, summary: null, series: [] });
      const r = await dbc.query(
        `SELECT market_consensus_probability AS fair, best_decimal_odds AS odds, created_at AS at
           FROM goal_value_shadow WHERE canonical_event_id = $1 AND market_id = $2
          ORDER BY created_at ASC LIMIT 400`, [ev, mk]).catch(() => null);
      const series = ((r && r.rows) || []).map(x => ({ fair: x.fair != null ? Number(x.fair) : null, odds: x.odds != null ? Number(x.odds) : null, at: x.at }));
      return json(res, 200, { event: ev, market: mk, summary: require('./line-intel/engine').summarize(series), series });
    }
    // NARRATIVA retro/mantenimiento: re-anota las picks activas (?force=1 recalcula las ya anotadas — para
    // cuando el ensamblador de factores evoluciona). Auth: admin o GP_EXPORT_KEY.
    if (p === '/api/internal/picks-narrative' && req.method === 'POST') {
      const xk = process.env.GP_EXPORT_KEY || '';
      const u = getUser(req);
      if (!((u && u.isAdmin) || (xk && url.searchParams.get('key') === xk))) return json(res, 404, { error: 'No encontrado' });
      return json(res, 200, annotateDailyPicksNarrative({ force: url.searchParams.get('force') === '1' }));
    }
    // CIERRE + CLV retro/mantenimiento: captura la línea de cierre (goal_value_shadow) y calcula CLV para
    // picks con kickoff pasado. Idempotente; ?force=1 recalcula todo. Auth: admin o GP_EXPORT_KEY.
    if (p === '/api/internal/picks-clv' && req.method === 'POST') {
      const xk = process.env.GP_EXPORT_KEY || '';
      const u = getUser(req);
      if (!((u && u.isAdmin) || (xk && url.searchParams.get('key') === xk))) return json(res, 404, { error: 'No encontrado' });
      const r = await captureDailyPicksClosing({ force: url.searchParams.get('force') === '1' }).catch(e => ({ error: e.message }));
      return json(res, 200, { result: r, quant: dailyPicksQuant() });
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
      // auth: sesión de admin O la clave de export (env GP_EXPORT_KEY) — permite operar el envío desde fuera
      // de la UI (mismo patrón key-gated del webhook Whop; sin la env, solo admin).
      const keyOk = !!process.env.GP_EXPORT_KEY && url.searchParams.get('key') === process.env.GP_EXPORT_KEY;
      if ((!u || !u.isAdmin) && !keyOk) return json(res, 403, { error: 'Solo el administrador' });
      if (req.method === 'GET') return json(res, 200, { ...bcastState, scheduled: db.scheduledBroadcast || null });
      if (!mailer.isConfigured()) return json(res, 400, { error: 'Email no configurado (modo demo)' });
      const { test, variant, count, schedule_at, cancel_schedule } = await readBody(req);
      // ENVÍO PROGRAMADO one-shot (18-jul, envío dividido ES→EN): {schedule_at:"ISO", variant} lo agenda;
      // un timer de 5min lo dispara re-entrando por este mismo endpoint (reusa TODA la lógica). Persistido
      // en db → sobrevive reinicios. {cancel_schedule:true} lo borra.
      if (cancel_schedule) { db.scheduledBroadcast = null; save(); return json(res, 200, { ok: true, scheduled: null }); }
      if (schedule_at) {
        const at = Date.parse(schedule_at);
        if (!isFinite(at) || at < Date.now()) return json(res, 400, { error: 'schedule_at inválido o en el pasado' });
        db.scheduledBroadcast = { variant: variant || 'beta', at: new Date(at).toISOString(), done: false, created_at: new Date().toISOString() };
        save();
        return json(res, 200, { ok: true, scheduled: db.scheduledBroadcast });
      }
      const link = 'https://gpsimulador.com/?goto=referidos';
      // SEGURIDAD: {count:true} devuelve a cuántos LLEGARÍA el envío SIN mandar nada (verificar el número
      // antes de disparar un masivo, para no equivocar el target).
      if (count) {
        const uk = Object.keys(db.users);
        const leads = uk.filter(e => db.users[e] && db.users[e].lead === true && db.users[e].verified !== true).length;
        const unverified = uk.filter(e => db.users[e] && db.users[e].verified !== true).length;
        const verified = uk.filter(e => db.users[e] && db.users[e].verified === true).length;
        const isReactivate = /^reactivate_(es|en)$/.test(variant || '');
        const freeNoSub = uk.filter(e => planFor(e) === 'free').length; // sin Pro/Sharp (incluye leads); admin=sharp queda fuera
        const wouldSend = variant === 'leads_magic' ? leads : isReactivate ? freeNoSub : uk.length;
        return json(res, 200, { variant: variant || 'beta', would_send: wouldSend, total_users: uk.length, verified, unverified, leads, free_no_sub: freeNoSub });
      }
      // variant 'reengage' = correo de estilo PERSONAL (bandeja Principal): from con nombre + sin List-Unsubscribe.
      // variants 'bankroll_es' / 'bankroll_en' = idioma FIJO (todos reciben ambos, decisión 7-jul).
      // El resto: cada usuario recibe el correo en SU idioma (perfil → idioma; si no, inferido del país; si no, es).
      // buildMail recibe el EMAIL (deriva idioma adentro). 'leads_magic' genera un magic link personalizado
      // por lead (estilo personal → Principal; sin List-Unsubscribe).
      // Secuencia founder: founder{1,2,3}_{es,en}. Los cupos se resuelven UNA vez por request (contador Whop).
      const founderMatch = /^founder([123])_(es|en)$/.exec(variant || '');
      const founderCtx = founderMatch ? { spotsLeft: await whopFounderSpotsLeft().catch(() => null) } : null;
      const buildMailBase = founderMatch
        ? () => founderEmail(Number(founderMatch[1]), founderMatch[2], founderCtx)
        : (variant === 'leads_magic')
          ? (em) => ({ ...leadReactivationEmail(em), from: REENGAGE_FROM, noListUnsub: true })
          : (variant === 'reengage')
            ? (em) => ({ ...reengageEmail(link, userLang(em)), from: REENGAGE_FROM, noListUnsub: true })
            : (variant === 'bankroll_es') ? () => bankrollEmail('es')
              : (variant === 'bankroll_en') ? () => bankrollEmail('en')
                : (variant === 'features_es') ? () => featuresEmail('es')
                  : (variant === 'features_en') ? () => featuresEmail('en')
                    : (variant === 'launch') ? (em) => launchEmail(userLang(em)) // fusión: cada usuario en SU idioma
                      : (variant === 'launch_es') ? () => launchEmail('es')
                        : (variant === 'launch_en') ? () => launchEmail('en')
                          // launch_flip: el idioma OPUESTO al de cada usuario → tras 'launch', todos quedan con ES+EN
                          : (variant === 'launch_flip') ? (em) => launchEmail(userLang(em) === 'en' ? 'es' : 'en')
                            // launch_personal: anti-Promociones (estilo reengage → Principal): 1:1 de Alexis,
                            // sin <a>, sin List-Unsubscribe. _es/_en = idioma FIJO (envío dividido 18-jul:
                            // ES ahora a todos, EN 6-7h después vía schedule_at)
                            : (variant === 'launch_personal') ? (em) => ({ ...launchPersonalEmail(userLang(em)), from: REENGAGE_FROM, noListUnsub: true })
                              : (variant === 'launch_personal_es') ? () => ({ ...launchPersonalEmail('es'), from: REENGAGE_FROM, noListUnsub: true })
                                : (variant === 'launch_personal_en') ? () => ({ ...launchPersonalEmail('en'), from: REENGAGE_FROM, noListUnsub: true })
                                  // last call (cierre founder 19-jul): idioma FIJO, estilo personal anti-Promociones.
                                  : (variant === 'lastcall_en') ? () => ({ ...lastCallEmail('en'), from: REENGAGE_FROM, noListUnsub: true })
                                    : (variant === 'lastcall_es') ? () => ({ ...lastCallEmail('es'), from: REENGAGE_FROM, noListUnsub: true })
                                      // reactivación post-Mundial (idioma FIJO, estilo personal anti-Promociones)
                                      : (variant === 'reactivate_en') ? () => ({ ...reactivateEmail('en'), from: REENGAGE_FROM, noListUnsub: true })
                                        : (variant === 'reactivate_es') ? () => ({ ...reactivateEmail('es'), from: REENGAGE_FROM, noListUnsub: true })
                                          : (em) => broadcastEmail(link, userLang(em));
      // SEPARACIÓN TRANSACCIONAL/MARKETING (10-jul): los masivos degradaron la entrega de los OTP (mismo
      // dominio remitente → Resend/Gmail encolaban los códigos 60-96s). Con BROADCAST_FROM seteado (subdominio
      // mail.gpsimulador.com, ya creado en Resend, pendiente DNS), TODO masivo sale por el subdominio y la
      // reputación de codigo@ queda reservada para transaccional. Sin la env, comportamiento igual que antes.
      const buildMail = (em) => {
        const m = buildMailBase(em);
        if (process.env.BROADCAST_FROM && !m.from) m.from = process.env.BROADCAST_FROM;
        return m;
      };
      const testTo = (u && u.email) || String(process.env.ADMIN_EMAILS || '').split(',')[0].trim();
      if (test) {
        try { ensureRefCode(testTo); await mailer.sendMail({ to: testTo, ...buildMail(testTo) }); console.log(`[broadcast] enviados 1/1 (prueba${variant ? ' ' + variant : ''})`); return json(res, 200, { ok: true, sent: 1, failed: 0, total: 1, test: true, to: testTo }); }
        catch (e) { return json(res, 200, { ok: false, error: e.message, test: true }); }
      }
      if (bcastState.running) return json(res, 200, { ok: false, error: 'Ya hay un envío en curso', state: bcastState });
      // 'leads_magic' apunta SOLO a los LEADS reales (marcados lead:true por el flujo de captura), NO a todo
      // no-verificado (eso incluía cuentas viejas sin el campo verified → falso "nunca entraste"). Guard extra:
      // nunca a un verificado.
      const targets = variant === 'leads_magic'
        ? Object.keys(db.users).filter(e => db.users[e] && db.users[e].lead === true && db.users[e].verified !== true)
        : /^reactivate_(es|en)$/.test(variant || '')
          ? Object.keys(db.users).filter(e => planFor(e) === 'free') // SIN Pro/Sharp (free + leads); admin=sharp fuera
          : Object.keys(db.users);
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
    const fusionOn = betaFusionOn();
    const atRoot = (p === '/' || p === '');
    // FUSIÓN — UN SOLO SITIO en la raíz (gpsimulador.com). /x es alias histórico → 302 a la raíz.
    if (fusionOn && premiumOn && (p === '/x' || p === '/x/')) { res.writeHead(302, { Location: '/' + (url.search || '') }); return res.end(); }
    // La raíz decide SIN redirección por la cookie de sesión: con sesión → plataforma; sin sesión → landing nueva EN la raíz.
    const rootHasSession = fusionOn && premiumOn && atRoot && !!sessionEmailFromReq(req);
    // Shell premium: en /x (pre-fusión) o en la raíz con sesión (post-fusión).
    if ((p === '/x' || p === '/x/') || rootHasSession) {
      if (!premiumOn) { json(res, 404, { error: 'No encontrado' }); return; }
      try {
        const pf = path.join(__dirname, 'public', 'premium.html');
        const vjs = Math.floor(fs.statSync(path.join(__dirname, 'public', 'premium.js')).mtimeMs);
        const vcss = Math.floor(fs.statSync(path.join(__dirname, 'public', 'premium.css')).mtimeMs);
        let html = fs.readFileSync(pf, 'utf8')
          .replace('src="premium.js"', `src="premium.js?v=${vjs}"`)
          .replace('href="premium.css"', `href="premium.css?v=${vcss}"`)
          .replace('</head>', `<script>window.__GPDL=${JSON.stringify(defaultLang())}</script></head>`);
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
    // FUSIÓN — raíz SIN sesión: la landing NUEVA se sirve EN la propia raíz (gpsimulador.com), sin redirección a /landing.
    if (fusionOn && atRoot) {
      try {
        const lf = path.join(__dirname, 'public', 'landing.html');
        const vjs = Math.floor(fs.statSync(path.join(__dirname, 'public', 'landing.js')).mtimeMs);
        // __GPL3: landing v3 (clubes) conocida ANTES del primer paint — sin swap visible de copy/hero.
        let html = fs.readFileSync(lf, 'utf8').replace('src="/landing.js"', `src="/landing.js?v=${vjs}"`).replace('</head>', `<script>window.__GPDL=${JSON.stringify(defaultLang())};window.__GPL3=${landingV3On()}</script></head>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(html);
      } catch { /* si algo falla, cae al servido estático normal (index viejo) */ }
    }
    // FOUNDER PASS (whitelist/planes) — superficie de trabajo PRE-lanzamiento, patrón /x pre-fusión:
    // solo la ve el ADMIN con sesión (cookie); para todo el resto es 404 (ni existe). Al lanzar:
    // GP_FOUNDER_PUBLIC_ENABLED=true la abre al público (+ checkout Whop cuando se cablee).
    // Fase founder CERRADA (20-jul): la página de precios vive en /plans. /founder redirige (back-compat).
    if (p === '/founder' || p === '/founder/') { res.writeHead(302, { Location: '/plans' + (url.search || ''), 'Cache-Control': 'no-store' }); return res.end(); }
    if (p === '/plans' || p === '/plans/') {
      const founderPublic = /^(1|true|yes|on)$/i.test(String(process.env.GP_FOUNDER_PUBLIC_ENABLED || '').trim());
      const sessEmail = sessionEmailFromReq(req);
      if (!founderPublic && (!sessEmail || !isAdmin(sessEmail))) { json(res, 404, { error: 'No encontrado' }); return; }
      try {
        const ff = path.join(__dirname, 'public', 'founder.html');
        // inyectar los plan IDs de Whop (envs) → la página activa los botones de checkout directo.
        // + CONTADOR REAL de cupos founder (membresías vigentes en Whop, memo 5 min, fallback null → 100).
        const W = {
          pro_m: process.env.WHOP_PLAN_PRO_M || '', pro_y: process.env.WHOP_PLAN_PRO_Y || '',
          sharp_m: process.env.WHOP_PLAN_SHARP_M || '', sharp_y: process.env.WHOP_PLAN_SHARP_Y || '',
          left: await whopFounderSpotsLeft().catch(() => null),
          plan: sessEmail ? planFor(sessEmail) : null, // plan ACTUAL del usuario → la página marca "Tu plan actual" en el correcto
        };
        const html = fs.readFileSync(ff, 'utf8').replace('</head>', `<script>window.__WHOP=${JSON.stringify(W)}</script></head>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(html);
      } catch { json(res, 404, { error: 'No encontrado' }); return; }
    }
    // CHECKOUT SIN FRICCIÓN (12-jul): en vez de mandar al link plano de Whop (que al pagar deja al usuario
    // varado en la pantalla "descargá la app de Whop"), creamos una CHECKOUT SESSION con redirect_url →
    // al completar el pago Whop lo devuelve a /founder/activo → su cuenta con la suscripción activa.
    // Fallback: si la API de Whop falla, 302 al checkout plano (el comportamiento de siempre, nunca se rompe).
    if (p === '/api/founder/checkout') {
      const founderPublic = /^(1|true|yes|on)$/i.test(String(process.env.GP_FOUNDER_PUBLIC_ENABLED || '').trim());
      if (!founderPublic) { json(res, 404, { error: 'No encontrado' }); return; }
      const PLANS = {
        pro_m: process.env.WHOP_PLAN_PRO_M, pro_y: process.env.WHOP_PLAN_PRO_Y,
        sharp_m: process.env.WHOP_PLAN_SHARP_M, sharp_y: process.env.WHOP_PLAN_SHARP_Y,
      };
      const planId = PLANS[String(url.searchParams.get('plan') || '')];
      if (!planId) { json(res, 400, { error: 'plan inválido' }); return; }
      let dest = 'https://whop.com/checkout/' + planId; // fallback: link plano
      try {
        if (process.env.WHOP_API_KEY) {
          const r = await fetch('https://api.whop.com/api/v2/checkout_sessions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${process.env.WHOP_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan_id: planId, redirect_url: 'https://gpsimulador.com/plans/activo' }),
            signal: AbortSignal.timeout(6000),
          });
          if (r.ok) { const j = await r.json(); if (j && j.purchase_url) dest = j.purchase_url; }
        }
      } catch { /* fallback al link plano */ }
      res.writeHead(302, { Location: dest, 'Cache-Control': 'no-store' });
      return res.end();
    }
    // RETORNO POST-COMPRA: Whop redirige acá al completar el pago. Con sesión → "Mi suscripción" (el plan
    // Founder ya está activo por webhook); sin sesión (compró anónimo o en otro navegador) → mensaje claro
    // de entrar con el email de la compra. Pausa breve "activando" absorbe la latencia del webhook.
    if (p === '/founder/activo' || p === '/founder/activo/') { res.writeHead(302, { Location: '/plans/activo', 'Cache-Control': 'no-store' }); return res.end(); }
    if (p === '/plans/activo' || p === '/plans/activo/') {
      const en = /^en/i.test(String(req.headers['accept-language'] || ''));
      const sessEmail = sessionEmailFromReq(req);
      const base = `<!DOCTYPE html><html lang="${en ? 'en' : 'es'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>GP Simulador</title><style>
        html,body{margin:0;background:#06090B;color:#EAF1F2;font-family:-apple-system,'Segoe UI',Arial,sans-serif;-webkit-font-smoothing:antialiased}
        .w{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
        .c{max-width:420px}.ok{width:64px;height:64px;border-radius:50%;background:rgba(31,227,164,.12);border:1px solid rgba(31,227,164,.45);display:grid;place-items:center;margin:0 auto 20px;font-size:28px;color:#1FE3A4}
        h1{font-size:24px;margin:0 0 10px;letter-spacing:-.02em}p{color:#9DB0B5;font-size:14.5px;line-height:1.6;margin:0 0 22px}
        .b{display:inline-block;background:#1FE3A4;color:#06231A;font-weight:800;font-size:14.5px;padding:13px 28px;border-radius:99px;text-decoration:none}
        .sp{width:22px;height:22px;border:2.5px solid rgba(31,227,164,.25);border-top-color:#1FE3A4;border-radius:50%;margin:0 auto 18px;animation:r .8s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
      </style></head><body><div class="w"><div class="c">`;
      if (sessEmail) {
        // logueado: pausa de 2s (webhook) → Mi suscripción con el plan Founder ★ visible
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Refresh: '2; url=/#sub' });
        return res.end(base + `<div class="sp"></div><h1>${en ? 'Activating your Founder Pass' : 'Activando tu Founder Pass'}</h1><p>${en ? 'One second, we are taking you to your account.' : 'Un segundo, te llevamos a tu cuenta.'}</p></div></div></body></html>`);
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(base + `<div class="ok">✓</div><h1>${en ? 'Purchase confirmed' : 'Compra confirmada'}</h1><p>${en ? 'Your Founder Pass is active. Sign in with the same email you used at checkout and your plan will be waiting for you.' : 'Tu Founder Pass está activo. Entrá con el mismo correo que usaste al pagar y tu plan te estará esperando.'}</p><a class="b" href="/?auth=1">${en ? 'Sign in to my account' : 'Entrar a mi cuenta'}</a></div></div></body></html>`);
    }
    // ===== FASE CLUBES (post-Mundial) — SHADOW dentro de la plataforma principal (decisión 13-jul) =====
    // La página /clubes se ELIMINÓ: la fase clubes se construye como extensión de la plataforma principal
    // (premium.js) gateada por GP_CLUBS_SHADOW_ENABLED + admin (clubs_shadow en /api/me). Los endpoints
    // /api/clubs/* de abajo son la capa de datos que consumen esas superficies: ratings/gates por liga
    // (data/clubs/ratings.json, fit offline), cockpit de cruce (engines de la casa) y value multi-liga.
    if (p === '/api/clubs/state') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      try {
        if (!global._clubsRatings) {
          try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); }
          catch { global._clubsRatings = { _meta: {}, leagues: {} }; }
        }
        const RT = global._clubsRatings;
        global._clubsUpcoming = global._clubsUpcoming || {};
        const tsaKey = process.env.THESTATSAPI_KEY || '';
        // F1.2: prob GP EN VIVO por partido (condicionada al marcador+minuto) para el tri-cell de la card — mismo
        // gpLiveCheap del Mundial, con los λ del cruce. hg/ag ya orientados al home. Cero llamadas externas.
        const clubGpLive = (rh, ra, hfa, hg, ag, minute) => { try { const l = lambdas(rh + hfa, ra); const gp = liveProbsFromLambdas(l[0], l[1], hg, ag, minute); return { home: +gp.home.toFixed(4), draw: +gp.draw.toFixed(4), away: +gp.away.toFixed(4), live: true }; } catch { return null; } };
        const leagues = [];
        for (const key of Object.keys(RT.leagues || {})) {
          const L = RT.leagues[key];
          // PRÓXIMOS de la liga: TSA status=scheduled, memo 6h. Las ligas de PRETEMPORADA (starts: 'agosto')
          // no se consultan: su season backfilleada ya terminó y la nueva aún no existe en el proveedor.
          let up = global._clubsUpcoming[key];
          if (L.starts) up = up || { at: Date.now(), rows: [] };
          if ((!up || Date.now() - up.at > 6 * 3600e3) && tsaKey) {
            try {
              const r = await fetch(`https://api.thestatsapi.com/api/football/matches?competition_id=${L.comp}&season_id=${L.season}&status=scheduled&per_page=50`, { headers: { Authorization: `Bearer ${tsaKey}` }, signal: AbortSignal.timeout(15000) });
              const j = r.ok ? await r.json().catch(() => null) : null;
              const rows = ((j && j.data) || j || []).filter(m => m && m.utc_date).sort((a, b) => new Date(a.utc_date) - new Date(b.utc_date)).slice(0, 12);
              up = { at: Date.now(), rows };
              global._clubsUpcoming[key] = up;
              await new Promise(r2 => setTimeout(r2, 1200)); // gentileza con el rate limit compartido
            } catch { up = up || { at: Date.now(), rows: [] }; }
          }
          // live STALE → final: si ESPN dejó de refrescar un "live" por >45 min (el minuto avanza cada pasada,
          // así que `at` se renueva mientras el partido corre), el partido terminó o se cayó el feed — mostrarlo
          // congelado como LIVE era el bug del partido "frizado" en la pestaña En vivo.
          const normStatus = (sr) => (sr.status === 'live' && Date.now() - (sr.at || 0) > 45 * 60e3) ? 'final' : sr.status;
          const fixtures = ((up && up.rows) || []).map(m => {
            const hId = String(m.home_team && m.home_team.id), aId = String(m.away_team && m.away_team.id);
            const rh = clubElo(key, hId), ra = clubElo(key, aId); // F0.4: Elo dinámico (overlay sobre el fit)
            const pr = matchProbs(rh + (L.hfa || 60), ra);
            // marcador en vivo/finalizado (ESPN por liga, shadow) si existe para este par
            const sr = (db.clubResults || {})[clubScoreKey(key, hId, aId)] || null;
            const result = sr ? { status: normStatus(sr), hg: sr.home_id === hId ? sr.hg : sr.ag, ag: sr.home_id === hId ? sr.ag : sr.hg, minute: sr.minute, winner: sr.winner || null } : null;
            return {
              id: m.id, utc: m.utc_date,
              home: { id: hId, name: (m.home_team && m.home_team.name) || '?', elo: rh, known: !!L.ratings[hId], prob: +pr.home.toFixed(3) },
              draw: +pr.draw.toFixed(3),
              away: { id: aId, name: (m.away_team && m.away_team.name) || '?', elo: ra, known: !!L.ratings[aId], prob: +pr.away.toFixed(3) },
              result,
              gpProbs: (result && result.status === 'live') ? clubGpLive(rh, ra, L.hfa || 60, result.hg, result.ag, result.minute) : null,
            };
          });
          const table = Object.entries(L.ratings).map(([id, t]) => ({ id, ...t, elo: clubElo(key, id), elo_base: t.elo })).sort((a, b) => b.elo - a.elo);
          // partidos EN VIVO / FINALIZADOS de la liga que ya NO están en upcoming (TSA los saca de scheduled al
          // empezar). Resueltos a nombres+probs desde ratings, ordenados live primero.
          const upPairs = new Set(fixtures.map(f => clubScoreKey(key, f.home.id, f.away.id)));
          const live = Object.entries(db.clubResults || {})
            .filter(([k, r]) => r.league === key && !upPairs.has(k))
            .map(([, r]) => {
              const rh = clubElo(key, r.home_id), ra = clubElo(key, r.away_id);
              const pr = matchProbs(rh + (L.hfa || 60), ra);
              const st = normStatus(r); // live stale → final (partido "frizado")
              return {
                id: null, utc: new Date(r.at || Date.now()).toISOString(),
                home: { id: r.home_id, name: (L.ratings[r.home_id] && L.ratings[r.home_id].name) || r.home_id, elo: rh, known: !!L.ratings[r.home_id], prob: +pr.home.toFixed(3) },
                draw: +pr.draw.toFixed(3),
                away: { id: r.away_id, name: (L.ratings[r.away_id] && L.ratings[r.away_id].name) || r.away_id, elo: ra, known: !!L.ratings[r.away_id], prob: +pr.away.toFixed(3) },
                result: { status: st, hg: r.hg, ag: r.ag, minute: r.minute, winner: r.winner || null },
                gpProbs: st === 'live' ? clubGpLive(rh, ra, L.hfa || 60, r.hg, r.ag, r.minute) : null,
              };
            })
            .sort((a, b) => (a.result.status === 'live' ? 0 : 1) - (b.result.status === 'live' ? 0 : 1));
          // FINALIZADOS persistentes de la liga (results-<liga>.json, últimos 7 días) + finales recientes del
          // sync que el backfill aún no tiene (dedupe por par+día). Antes la pestaña "Finalizados" de clubes
          // quedaba vacía: los finales del sync se podan a las 3h y no había fuente persistente.
          let finished = [];
          try {
            global._clubsResults = global._clubsResults || {};
            if (!global._clubsResults[key]) { try { global._clubsResults[key] = JSON.parse(fs.readFileSync(clubDataFile(`results-${key}.json`), 'utf8')).rows || []; } catch { global._clubsResults[key] = []; } }
            const cutoff = Date.now() - 7 * 86400e3;
            const seenFin = new Set();
            const finKey = (h, a, d) => [h, a].sort().join('~') + '|' + String(d).slice(0, 10);
            for (const l of live) { if (l.result.status === 'final') seenFin.add(finKey(l.home.id, l.away.id, l.utc)); }
            finished = global._clubsResults[key]
              .filter(r => r.hg != null && r.date && +new Date(r.date) > cutoff && !seenFin.has(finKey(r.home_id, r.away_id, r.date)))
              .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12)
              .map(r => {
                const rh = clubElo(key, r.home_id), ra = clubElo(key, r.away_id);
                const pr = matchProbs(rh + (L.hfa || 60), ra);
                return {
                  id: r.id || null, utc: r.date,
                  home: { id: r.home_id, name: (L.ratings[r.home_id] && L.ratings[r.home_id].name) || r.home_id, elo: rh, known: !!L.ratings[r.home_id], prob: +pr.home.toFixed(3) },
                  draw: +pr.draw.toFixed(3),
                  away: { id: r.away_id, name: (L.ratings[r.away_id] && L.ratings[r.away_id].name) || r.away_id, elo: ra, known: !!L.ratings[r.away_id], prob: +pr.away.toFixed(3) },
                  result: { status: 'final', hg: r.hg, ag: r.ag, minute: null, winner: r.winner || null },
                };
              });
          } catch { finished = []; }
          leagues.push({
            key, name: L.name, country: L.country, n_matches: L.n_matches, hfa: L.hfa,
            starts: L.starts || null, odds_key: L.odds_key || null,
            gate: L.backtest ? { status: L.backtest.status, n: L.backtest.n, brier: L.backtest.brier, cal_err: L.backtest.cal_err } : null,
            table, standings: L.standings || [], upcoming: fixtures, live, finished,
          });
        }
        return json(res, 200, { fitted_at: (RT._meta && RT._meta.fitted_at) || null, engine: (RT._meta && RT._meta.engine) || null, leagues });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    // ARQUITECTURA DE COMPETICIÓN — GRUPOS/TABLA por liga: proyección de temporada (campeón/top-N/descenso) de
    // TODA la liga en una llamada, para la columna "avance" de la tabla de posiciones (mismo espíritu que el
    // groupWin+groupSecond del Mundial). Memoizado 30min e invalidado por el overlay de Elo dinámico → se
    // actualiza cada jornada. Carga progresiva en el cliente (regla data-parcial): la tabla se pinta ya, la
    // columna avance se enriquece cuando llega esto.
    // EVOLUCIÓN por liga: historia retrospectiva de prob de campeón (mismo shape que st.history del Mundial)
    if (p === '/api/clubs/evo') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      try {
        const league = String(url.searchParams.get('league') || '');
        if (!/^[a-z0-9]+$/.test(league)) return json(res, 400, { error: 'liga requerida' });
        return json(res, 200, { league, ...(clubEvoHistory(league) || { available: false }) });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    if (p === '/api/clubs/season') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      try {
        const league = String(url.searchParams.get('league') || '');
        if (!league) return json(res, 400, { error: 'liga requerida' });
        const sim = clubSeasonSim(league);
        return json(res, 200, { league, sim: sim || null });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    // ARQUITECTURA DE COMPETICIÓN — BRACKET de playoffs PROYECTADO (MX/MLS). Cuadro sembrado por la proyección del
    // season sim + avance por Elo. Memo 30min invalidado por el overlay de Elo (se actualiza cada jornada).
    if (p === '/api/clubs/bracket') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      try {
        const league = String(url.searchParams.get('league') || '');
        if (!league) return json(res, 400, { error: 'liga requerida' });
        global._clubBracket = global._clubBracket || {};
        const eloVer = JSON.stringify(db.clubElos || {}).length;
        const c = global._clubBracket[league];
        if (c && Date.now() - c.at < 30 * 60e3 && c.eloVer === eloVer) return json(res, 200, { league, bracket: c.bracket });
        const bracket = clubPlayoffBracket(league);
        global._clubBracket[league] = { at: Date.now(), eloVer, bracket };
        return json(res, 200, { league, bracket });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    // COCKPIT DE CLUBES: análisis de un cruce (real o hipotético, incluso ENTRE ligas) reusando los engines
    // de la casa: matchProbs (1X2 calibrado) + lambdas (xG) + goal-engine/distribution (O/U, BTTS, marcadores).
    // Cross-liga: cada liga se fitea alrededor de 1500 → comparación aproximada (flag cross_league, la UI avisa).
    if (p === '/api/clubs/match') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      try {
        if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { _meta: {}, leagues: {} }; } }
        const RT = global._clubsRatings || {};
        const hl = String(url.searchParams.get('hl') || ''), al = String(url.searchParams.get('al') || hl);
        const hId = String(url.searchParams.get('h') || ''), aId = String(url.searchParams.get('a') || '');
        const LH = RT.leagues && RT.leagues[hl], LA = RT.leagues && RT.leagues[al];
        if (!LH || !LA) return json(res, 400, { error: 'liga inválida' });
        // Equipo SIN rating (ascendido/nuevo en la temporada) → prior 1500 con known:false, igual que la
        // cartelera (el 400 anterior rompía el cockpit de los partidos con equipos 'NUEVO').
        const TH = LH.ratings[hId] || null, TA = LA.ratings[aId] || null;
        const cross = hl !== al;
        const neutral = cross || /^(1|true)$/i.test(String(url.searchParams.get('neutral') || ''));
        const hfa = neutral ? 0 : (LH.hfa || 60);
        const rh = TH ? clubElo(hl, hId) : 1500, ra = TA ? clubElo(al, aId) : 1500; // F0.4: Elo dinámico
        const pr = matchProbs(rh + hfa, ra);
        const l = lambdas(rh + hfa, ra); // λ del Elo → 1X2 (gate-approved) + gp_live/momentum (consistencia con el 1X2)
        // F3.1: λ de GOLES REALISTAS por liga (modelo ataque/defensa desde results-<liga>.json). El goal engine
        // sobre Elo predice ~51% over en TODAS las ligas; este discrimina el nivel por liga/cruce. Fallback a Elo
        // si no hay fit. SOLO mejora la proyección de goles; el 1X2/vivo siguen del Elo. No habilita picks (skill ~0).
        let lGoal = l;
        if (!cross) { try { const gf = clubGoalsFit(hl); if (gf) { const lg = require('./clubs-engine/goalsModel').goalLambdas(gf, hId, aId); if (lg) lGoal = lg; } } catch { /* sin fit → Elo */ } }
        // F2.3: OBSERVER — factor λ por bajas del XI (base→contexto→GP). Off (factor=1) = byte-idéntico. Ajusta
        // ambos tracks: l1x2U (Elo→1X2/vivo) y lU (ataque/defensa→goles/intel). l/lGoal/pr son la base.
        const fH = !cross ? clubObserverLambdaFactor(hl, hId) : 1, fA = !cross ? clubObserverLambdaFactor(al, aId) : 1;
        const ctxActive = (fH !== 1 || fA !== 1);
        const l1x2U = ctxActive ? [l[0] * fH, l[1] * fA] : l;        // 1X2 + gp_live (Elo)
        const lU = ctxActive ? [lGoal[0] * fH, lGoal[1] * fA] : lGoal; // goles/xg/intel (ataque/defensa)
        const prU = ctxActive ? probsFromLambdas(l1x2U[0], l1x2U[1]) : pr;
        const dist = require('./goal-engine/distribution');
        const g = dist.goalModelOutput(lU[0], lU[1]);
        const ou25 = (g.over_under || []).find(x => Math.abs((x.line != null ? x.line : x.l) - 2.5) < 0.01) || null;
        // F1.5: MATRIZ DE MERCADOS del cruce (cuotas del sweep en la DB). Solo intra-liga (el ceid sintético es
        // por liga+par). Mejor cuota por resultado + O/U por línea, con la casa que la paga.
        let markets = null;
        if (!cross) { try { markets = await clubMatchMarkets(hl, hId, aId); } catch { markets = null; } }
        // MATCH INTEL COMPLETO (P1.2): MISMO shape que /api/beta/match-intel del Mundial → el cliente lo rinde
        // con mvIntel (capa por jugador: rol/confianza/razones del player-intel + radar de disponibilidad narrado
        // por el observer + factor λ). Antes era solo "anotadores probables" (clubIntelHtml, variante eliminada).
        let matchIntel = null;
        if (!cross) {
          try {
            const fitL = require('./player-intel/clubsFit').leagueFit(hl);
            if (fitL) {
              const players = require('./prop-engine/players');
              const { assessPlayers } = require('./observer/assess');
              const { playerIntel } = require('./player-intel/engine');
              const { narratePlayer } = require('./observer/narrate');
              const sideIntel = (tmId, lambda) => {
                const asmts = assessPlayers(((db.clubObservations || {})[tmId] || {}).signals || []);
                const rows = players.projectTeam(fitL, tmId, { teamLambda: lambda || null, top: 5 }).map(r => {
                  let pi = null; try { pi = playerIntel(fitL, r.pid, { teamLambda: lambda || null, projectedStarter: true, confirmedStarter: null, availability: asmts[r.pid] || null, setPieceReasons: [] }); } catch { pi = null; }
                  return {
                    pid: r.pid, name: r.name, pos: r.pos, anytime: +Number(r.anytime_goal || 0).toFixed(3),
                    shots: +Number(r.shots_match || 0).toFixed(1), sot_o05: r.sot_over_0_5 != null ? +Number(r.sot_over_0_5).toFixed(3) : null,
                    risk: (asmts[r.pid] && asmts[r.pid].status) || null,
                    role: pi ? pi.role : null, confidence: pi ? pi.confidence : null, reasons: pi ? pi.reasons : [],
                    minutes_dist: players.minutesDist(fitL.players[r.pid]), // P2
                  };
                });
                const flagged = Object.values(asmts).filter(x => x.prob_miss > 0).map(x => {
                  const nar = narratePlayer(x) || {};
                  return { player: x.player, status: x.status, prob_miss: x.prob_miss, corroborated: x.corroborated !== false, why_es: nar.es || null, why_en: nar.en || null };
                });
                return { scorers: rows, radar: { players: flagged.slice(0, 6), lambda_factor: clubObserverLambdaFactor(hl, tmId) } };
              };
              matchIntel = { available: true, home: sideIntel(hId, lU[0]), away: sideIntel(aId, lU[1]) };
              if (!(matchIntel.home.scorers || []).length && !(matchIntel.away.scorers || []).length) matchIntel = null;
            }
          } catch { matchIntel = null; }
        }
        // FORMA reciente de ambos equipos + H2H (enfrentamientos directos) — desde results-<liga>.json.
        let form = null;
        if (!cross) { try { form = clubMatchForm(hl, hId, aId); } catch { form = null; } }
        // F1.2: GP EN VIVO + MOMENTUM. Si el cruce tiene marcador en vivo, prob GP condicionada al marcador+minuto
        // (liveProbsFromLambdas con los λ del cruce = mismo engine del Mundial). Momentum = serie muestreada por
        // clubScoresSync. Se orienta al home solicitado (clubResults/serie guardan orientación del sync ESPN).
        let gpLive = null, momentum = null, events = null, statistics = null, xgReport = null;
        if (!cross) {
          const sr = (db.clubResults || {})[clubScoreKey(hl, hId, aId)] || null;
          if (sr) {
            const homeIsH = sr.home_id === hId;
            const shg = homeIsH ? sr.hg : sr.ag, sag = homeIsH ? sr.ag : sr.hg;
            if (sr.status === 'live') {
              try { const gp = liveProbsFromLambdas(l1x2U[0], l1x2U[1], shg, sag, sr.minute); gpLive = { home: +gp.home.toFixed(4), draw: +gp.draw.toFixed(4), away: +gp.away.toFixed(4), likely_score: gp.likelyScore, minute: sr.minute, live: true }; } catch { gpLive = null; }
            }
            const mom = (db.clubMomentum || {})[clubScoreKey(hl, hId, aId)];
            if (mom && mom.points && mom.points.length > 2) {
              momentum = homeIsH ? mom.points : mom.points.map(pt => ({ t: pt.t, h: pt.a, d: pt.d, a: pt.h, hg: pt.ag, ag: pt.hg, at: pt.at }));
            }
            // F1.1b: eventos en vivo (goles/tarjetas/subs) desde AF, solo si el partido juega o acaba de terminar.
            if (sr.status === 'live' || sr.status === 'final') { try { events = await clubMatchEvents(hl, hId, aId); } catch { events = null; } }
            // F1.1c: stats del partido (posesión/remates) en vivo/final — mismo panel mvStats del Mundial.
            if (sr.status === 'live' || sr.status === 'final') { try { statistics = await clubMatchStats(hl, hId, aId); } catch { statistics = null; } }
            // F1.3: xG observado del partido (post-partido; requiere backfill fresco de la liga ±4 días).
            if (sr.status === 'final') {
              try {
                const xr = clubXgReport(hl, hId, aId);
                if (xr && Math.abs(new Date(xr.date) - Date.now()) < 4 * 86400e3) xgReport = xr;
              } catch { xgReport = null; }
            }
          }
        }
        return json(res, 200, {
          home: { id: hId, name: (TH && TH.name) || String(url.searchParams.get('hn') || '—'), elo: rh, known: !!TH, league: hl, league_name: LH.name },
          away: { id: aId, name: (TA && TA.name) || String(url.searchParams.get('an') || '—'), elo: ra, known: !!TA, league: al, league_name: LA.name },
          cross_league: cross, neutral,
          gate: LH.backtest ? LH.backtest.status : null,
          probs: { home: +prU.home.toFixed(3), draw: +prU.draw.toFixed(3), away: +prU.away.toFixed(3) },
          xg: { home: +lU[0].toFixed(2), away: +lU[1].toFixed(2), total: +(lU[0] + lU[1]).toFixed(2) },
          over25: ou25 ? +((ou25.over != null ? ou25.over : ou25.o)).toFixed(3) : null,
          btts: g.btts ? +g.btts.yes.toFixed(3) : null,
          top_scores: (g.top_scorelines || []).slice(0, 3).map(s => ({ score: s.score, p: +s.probability.toFixed(3) })),
          // prob del modelo por línea O/U (para la matriz de mercados)
          ou_lines: (g.over_under || []).map(x => ({ line: (x.line != null ? x.line : x.l), over: +(x.over != null ? x.over : x.o).toFixed(3) })),
          markets,
          match_intel: matchIntel,
          form, // { home:[W/D/L], away:[...], h2h:[{date,hg,ag,home_id}] }
          gp_live: gpLive, // F1.2: prob GP condicionada al marcador+minuto (solo en vivo)
          momentum, // F1.2: serie {t,h,d,a,hg,ag} para el gráfico de evolución
          events, // F1.1b: [{minute,type,player,assist,teamName,side}] goles/tarjetas/subs en vivo
          statistics, // F1.1c: {home:{possession,shots,...},away:{...}} — mismo shape que mvStats del Mundial
          xg_report: xgReport, // F1.3: xG observado del partido (post-partido, del player-history de la liga)
          style: cross ? { available: false } : clubMatchStyle(hl, hId, aId), // F2.4: perfil táctico (event data FotMob de la liga)
          // MISMO builder de goles del Mundial (gp-product/dto.goalInsights) con los λ del cruce → el cockpit de
          // club rinde la MISMA sección Goal projection (distribución, escalera O/U, márgenes, combos, marcadores).
          goal_insights: (() => { try { return require('./gp-product/dto').goalInsights({ lambda_home: lU[0], lambda_away: lU[1], lambda_total: lU[0] + lU[1] }); } catch { return null; } })(),
          // F2.3: OBSERVER — base→contexto→GP. active=el observer ajustó el λ (flag+señales); base_xg = sin contexto.
          context_adjust: ctxActive ? {
            active: true,
            factor: { home: fH, away: fA },
            base_xg: { home: +lGoal[0].toFixed(2), away: +lGoal[1].toFixed(2) },
            base_probs: { home: +pr.home.toFixed(3), draw: +pr.draw.toFixed(3), away: +pr.away.toFixed(3) },
            findings: { home: clubObserverFindings(hId), away: clubObserverFindings(aId) },
          } : { active: false, findings: { home: clubObserverFindings(hId), away: clubObserverFindings(aId) } },
        });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    // VALUE MULTI-LIGA (fase 3, SHADOW): consenso no-vig del mercado (The Odds API h2h) vs nuestro modelo,
    // por liga con cuotas. SOLO informativo interno — las picks nacen cuando la liga tenga gate approved
    // (clubs-gate-1) Y el pipeline editorial (curate) se cablee. Memo 10 min (~8 créditos por refresco).
    if (p === '/api/clubs/value') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      try {
        // auto-carga de ratings (mismo patrón que el sweep): sin esto, si value corre antes que /api/clubs/state
        // (loadClubs dispara ambos en paralelo) veía leagues vacías y memoizaba 0 filas por 10 minutos.
        if (!global._clubsRatings) {
          try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); }
          catch { global._clubsRatings = { _meta: {}, leagues: {} }; }
        }
        const RT = global._clubsRatings || {};
        const oddsKeyEnv = process.env.SPORTSBOOK_PROVIDER_API_KEY || '';
        if (!oddsKeyEnv) return json(res, 200, { shadow: true, rows: [], note: 'sin key de cuotas' });
        global._clubsValue = global._clubsValue || { at: 0, rows: [], skipped: 0 };
        if (Date.now() - global._clubsValue.at > 10 * 60e3) {
          const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/\b(fc|cf|cd|club|deportivo|sc|ac|afc|de|the)\b/g, '').replace(/[^a-z0-9]/g, '');
          const rows = []; let skipped = 0;
          const inSeason = Object.values(RT.leagues || {}).filter(L => L.odds_key && !L.starts);
          for (const L of inSeason) {
            let events = null;
            try {
              const r = await fetch(`https://api.the-odds-api.com/v4/sports/${L.odds_key}/odds?apiKey=${oddsKeyEnv}&regions=${ODDS_REGIONS_SCAN}&markets=h2h&oddsFormat=decimal`, { signal: AbortSignal.timeout(12000) });
              noteOddsCredits(r);
              events = r.ok ? await r.json().catch(() => null) : null;
            } catch { /* liga sin datos este ciclo */ }
            if (!Array.isArray(events)) continue;
            const byNorm = {};
            for (const [id, t] of Object.entries(L.ratings)) byNorm[norm(t.name)] = { id, ...t };
            const find = n => { const k = norm(n); if (byNorm[k]) return byNorm[k]; const hit = Object.keys(byNorm).find(x => x && k && (x.includes(k) || k.includes(x))); return hit ? byNorm[hit] : null; };
            for (const ev of events.slice(0, 20)) {
              const th = find(ev.home_team), ta = find(ev.away_team);
              if (!th || !ta) { skipped++; continue; }
              // consenso no-vig: por casa, prob implícita desproporcionada; mediana entre casas por outcome
              const acc = { home: [], draw: [], away: [] }; const best = { home: [0, ''], draw: [0, ''], away: [0, ''] };
              for (const bk of ev.bookmakers || []) {
                const mk = (bk.markets || []).find(m => m.key === 'h2h'); if (!mk) continue;
                const o = {}; for (const oc of mk.outcomes || []) { if (oc.name === ev.home_team) o.home = oc.price; else if (oc.name === ev.away_team) o.away = oc.price; else o.draw = oc.price; }
                if (!(o.home > 1 && o.draw > 1 && o.away > 1)) continue;
                const s = 1 / o.home + 1 / o.draw + 1 / o.away;
                acc.home.push(1 / o.home / s); acc.draw.push(1 / o.draw / s); acc.away.push(1 / o.away / s);
                if (o.home > best.home[0]) best.home = [o.home, bk.title]; if (o.draw > best.draw[0]) best.draw = [o.draw, bk.title]; if (o.away > best.away[0]) best.away = [o.away, bk.title];
              }
              if (acc.home.length < 3) { skipped++; continue; }
              const med = a => { const s2 = a.slice().sort((x, y) => x - y); return s2[Math.floor(s2.length / 2)]; };
              const cons = { home: med(acc.home), draw: med(acc.draw), away: med(acc.away) };
              const pr = matchProbs(clubElo(L.key, th.id) + (L.hfa || 60), clubElo(L.key, ta.id)); // F0.4: Elo dinámico
              for (const oc of ['home', 'draw', 'away']) {
                const edge = pr[oc] - cons[oc];
                rows.push({
                  league: L.key, league_name: L.name, gate: L.backtest ? L.backtest.status : null,
                  utc: ev.commence_time, home: th.name, away: ta.name, home_id: th.id, away_id: ta.id, outcome: oc,
                  our: +pr[oc].toFixed(3), consensus: +cons[oc].toFixed(3), edge_pp: +(edge * 100).toFixed(1),
                  best_odds: best[oc][0] || null, best_book: best[oc][1] || null, books: acc.home.length,
                });
              }
            }
          }
          rows.sort((a, b) => Math.abs(b.edge_pp) - Math.abs(a.edge_pp));
          global._clubsValue = { at: Date.now(), rows: rows.slice(0, 40), skipped };
        }
        return json(res, 200, { shadow: true, refreshed_at: new Date(global._clubsValue.at).toISOString(), skipped: global._clubsValue.skipped, rows: global._clubsValue.rows });
      } catch (e) { return json(res, 500, { error: e.message }); }
    }
    // PLANTILLA de un club (shadow): roster desde TheStatsAPI (los ids tm_ de ratings.json comparten proveedor),
    // agrupado por posición. Memo por equipo 24h. Datos ricos por jugador: posición, edad, altura, pie, país,
    // valor de mercado, contrato, selección. Base para el perfil de jugador de club (extensión de la capa de
    // inteligencia del Mundial a clubes).
    if (p === '/api/clubs/squad') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      const teamId = String(url.searchParams.get('team') || '');
      if (!/^tm_[a-z0-9]+$/i.test(teamId)) return json(res, 400, { error: 'team inválido' });
      const tsaKey = process.env.THESTATSAPI_KEY || '';
      if (!tsaKey) return json(res, 200, { players: [], note: 'sin key' });
      global._clubsSquad = global._clubsSquad || {};
      let sq = global._clubsSquad[teamId];
      if (!sq || Date.now() - sq.at > 24 * 3600e3) {
        try {
          const r = await fetch(`https://api.thestatsapi.com/api/football/teams/${teamId}/players?per_page=60`, { headers: { Authorization: `Bearer ${tsaKey}` }, signal: AbortSignal.timeout(15000) });
          const j = r.ok ? await r.json().catch(() => null) : null;
          const rows = (j && j.data) || j || [];
          sq = { at: Date.now(), rows: Array.isArray(rows) ? rows : [] };
          global._clubsSquad[teamId] = sq;
        } catch { sq = sq || { at: Date.now(), rows: [] }; }
      }
      // normalizar a la forma que consume la UI; agrupar por línea (POR/DEF/MED/DEL)
      const POSGROUP = { G: 'GK', D: 'DEF', M: 'MID', F: 'FWD', A: 'FWD' };
      const players = (sq.rows || []).map(p => ({
        pid: p.id, name: p.short_name || p.name, full: p.name, pos: p.position || null,
        group: POSGROUP[p.position] || 'OTH',
        age: p.age != null ? p.age : null, height: p.height_cm || null, foot: p.preferred_foot || null,
        nat: p.nationality || null, nat_slug: p.country_slug || null,
        value: p.market_value != null ? p.market_value : null, contract: p.contract_until || null,
        national: p.national_team || null,
      }));
      const order = { GK: 0, DEF: 1, MID: 2, FWD: 3, OTH: 4 };
      players.sort((a, b) => (order[a.group] - order[b.group]) || String(a.name).localeCompare(String(b.name)));
      return json(res, 200, { team: teamId, count: players.length, players, cached_at: new Date(sq.at).toISOString() });
    }
    // PERFIL de un jugador de club (shadow): ficha desde el roster + (fase 2) stats/90 y radar cuando haya
    // backfill de player-stats por liga. Hoy: datos biográficos ricos del roster de TSA.
    if (p === '/api/clubs/player') {
      const sessEmail = sessionEmailFromReq(req);
      if (!clubsAccessOk(sessEmail)) { json(res, 404, { error: 'No encontrado' }); return; } // admin, o todos con la FUSIÓN abierta
      const teamId = String(url.searchParams.get('team') || ''), pid = String(url.searchParams.get('pid') || '');
      const league = String(url.searchParams.get('league') || '');
      if (!/^tm_[a-z0-9]+$/i.test(teamId) || !/^pl_[a-z0-9]+$/i.test(pid)) return json(res, 400, { error: 'params inválidos' });
      if (!global._clubsRatings) { try { global._clubsRatings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'clubs', 'ratings.json'), 'utf8')); } catch { global._clubsRatings = { leagues: {} }; } }
      const tsaKey = process.env.THESTATSAPI_KEY || '';
      global._clubsSquad = global._clubsSquad || {};
      let sq = global._clubsSquad[teamId];
      if ((!sq || Date.now() - sq.at > 24 * 3600e3) && tsaKey) {
        try {
          const r = await fetch(`https://api.thestatsapi.com/api/football/teams/${teamId}/players?per_page=60`, { headers: { Authorization: `Bearer ${tsaKey}` }, signal: AbortSignal.timeout(15000) });
          const j = r.ok ? await r.json().catch(() => null) : null;
          sq = { at: Date.now(), rows: (j && j.data) || j || [] };
          global._clubsSquad[teamId] = sq;
        } catch { sq = sq || { at: Date.now(), rows: [] }; }
      }
      const p0 = ((sq && sq.rows) || []).find(x => x.id === pid);
      if (!p0) return json(res, 404, { error: 'jugador no encontrado' });
      const RT = global._clubsRatings || {};
      const L = RT.leagues && RT.leagues[league];
      const teamName = (L && L.ratings && L.ratings[teamId] && L.ratings[teamId].name) || null;
      // F2.2: scouting nivel Yamal (stats/90 + radar + arquetipo) desde el player-history de la liga (mismos
      // engines del Mundial). null si aún no hay backfill de esa liga → la ficha bio se sirve igual.
      let intel = null, matches = [];
      try {
        const cf = require('./player-intel/clubsFit');
        intel = cf.clubPlayerScout(league, pid);
        matches = cf.clubPlayerMatches(league, pid, L && L.ratings); // MATCH BY MATCH (paridad con el Mundial)
      } catch { intel = null; }
      const photo = (global._clubPlayerPhotos && global._clubPlayerPhotos[pid]) ? global._clubPlayerPhotos[pid].photo : null;
      return json(res, 200, {
        photo,
        intel, // { stats_available, xg90, shots90, ..., scout:{axes,archetype,read} }
        matches, // [{date, opp, min, sh, sot, g, xg}]
        pid, name: p0.name, short: p0.short_name || p0.name, team_id: teamId, team_name: teamName, league,
        league_name: (L && L.name) || null,
        position: p0.position || null, age: p0.age != null ? p0.age : null,
        dob: p0.date_of_birth || null, height: p0.height_cm || null, foot: p0.preferred_foot || null,
        nationality: p0.nationality || null, nat_slug: p0.country_slug || null,
        market_value: p0.market_value != null ? p0.market_value : null, contract_until: p0.contract_until || null,
        national_team: p0.national_team || null, first_name: p0.first_name || null, last_name: p0.last_name || null,
        stats_available: !!(intel && intel.stats_available),
        avail: clubPlayerAvail(teamId, pid), // F2.3: disponibilidad narrada del observer (o null)
        minutes_dist: (() => { // P2: P(titular) + min si titular/banco + P(60+/75+/90) — mismo minutesDist del Mundial
          try { const fit = require('./player-intel/clubsFit').leagueFit(league); return fit ? require('./prop-engine/players').minutesDist(fit.players[pid]) : null; } catch { return null; }
        })(),
        next_projection: (() => { // paridad Mundial "Next match · projection": P(gol)/remates/xG/min del PRÓXIMO partido
          try {
            if (!(intel && intel.stats_available)) return null;
            const up = ((global._clubsUpcoming || {})[league] || {}).rows || [];
            const now = Date.now();
            const nx = up.filter(m => m.utc_date && +new Date(m.utc_date) > now && (String((m.home_team || {}).id) === teamId || String((m.away_team || {}).id) === teamId))
              .sort((a, b) => new Date(a.utc_date) - new Date(b.utc_date))[0];
            if (!nx) return null;
            const isHome = String((nx.home_team || {}).id) === teamId;
            const oppId = String(isHome ? (nx.away_team || {}).id : (nx.home_team || {}).id);
            const oppName = isHome ? (nx.away_team || {}).name : (nx.home_team || {}).name;
            let lam = null;
            try { const gf = clubGoalsFit(league); if (gf) { const lg2 = require('./clubs-engine/goalsModel').goalLambdas(gf, isHome ? teamId : oppId, isHome ? oppId : teamId); if (lg2) lam = isHome ? lg2[0] : lg2[1]; } } catch { /* fallback Elo */ }
            if (lam == null) { const rh = clubElo(league, teamId), ra = clubElo(league, oppId); const le = lambdas(rh + (isHome ? (L.hfa || 60) : 0), ra); lam = le[0]; }
            const fit = require('./player-intel/clubsFit').leagueFit(league);
            const proj = fit ? require('./prop-engine/players').projectTeam(fit, teamId, { teamLambda: lam, top: 40 }).find(x => x.pid === pid) : null;
            if (!proj) return null;
            return { opp: oppName, opp_id: oppId, home: isHome, kickoff: nx.utc_date, anytime: +proj.anytime_goal.toFixed(3), shots: +proj.shots_match.toFixed(1), xg: +proj.xg_match.toFixed(2), minutes: proj.minutes != null ? Math.round(proj.minutes) : null };
          } catch { return null; }
        })(),
      });
    }
    // PANEL DE CALIDAD MEDIDA (marketing) — superficie curada de prueba social: track record + "le ganamos al
    // mercado" (Brier GP vs consenso) + curva de calibración + CLV opcional. Admin-only hasta que Alexis lo
    // apruebe; GP_QUALITY_PUBLIC=true lo abre. Caja negra estricta: solo resultados medidos, nunca método.
    // Los datos se inyectan al servir (mismo patrón que /founder con Whop) → funciona sin fetch.
    if (p === '/calidad' || p === '/calidad/' || p === '/quality' || p === '/quality/') {
      const qualityPublic = /^(1|true|yes|on)$/i.test(String(process.env.GP_QUALITY_PUBLIC || '').trim());
      const sessEmail = sessionEmailFromReq(req);
      if (!qualityPublic && (!sessEmail || !isAdmin(sessEmail))) { json(res, 404, { error: 'No encontrado' }); return; }
      try {
        const tr = dailyPicksTrackRecord().overall || {};
        const q = dailyPicksQuant();
        const mvm = q.model_vs_market || {};
        const QD = {
          public_preview: !qualityPublic,
          settled: tr.settled || 0, wins: tr.wins || 0, hit_rate: tr.hit_rate, roi_pct: tr.roi_pct, pnl_u: tr.pnl_u,
          brier_model: mvm.n >= 10 ? mvm.brier_model : null, brier_market: mvm.n >= 10 ? mvm.brier_market : null, skill: mvm.skill,
          calibration: (q.calibration || []).filter(b => b.n >= 5).map(b => ({ range: b.range, predicted: b.predicted, observed: b.observed, n: b.n })),
          // CLV se muestra solo si el operador lo enciende (hoy delgado → fuera de la v1 pública, se puede activar con GP_QUALITY_CLV=true)
          show_clv: /^(1|true|yes|on)$/i.test(String(process.env.GP_QUALITY_CLV || '').trim()),
          clv: q.clv && q.clv.n ? { avg_pct: q.clv.avg_pct, positive_rate: q.clv.positive_rate, n: q.clv.n } : null,
          generated_at: new Date().toISOString(),
        };
        const qf = path.join(__dirname, 'public', 'quality.html');
        const html = fs.readFileSync(qf, 'utf8').replace('</head>', `<script>window.__QUALITY=${JSON.stringify(QD)}</script></head>`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(html);
      } catch { json(res, 404, { error: 'No encontrado' }); return; }
    }
    // ===== SEO: páginas públicas de PRONÓSTICO por partido (server-rendered → indexables sin JS) =====
    // /pronostico/<local>-vs-<visita> (ES) · /prediction/<home>-vs-<away> (EN) · índices · sitemap dinámico.
    // Muestran las MISMAS probabilidades del board + lectura editorial + CTA de registro. CAJA NEGRA intacta.
    if (p === '/sitemap.xml') {
      const base = 'https://gpsimulador.com';
      const ms = seoMatches();
      const urls = [
        `<url><loc>${base}/</loc><changefreq>hourly</changefreq><priority>1.0</priority></url>`,
        `<url><loc>${base}/pronosticos</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>`,
        `<url><loc>${base}/predictions</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>`,
        `<url><loc>${base}/terms</loc><changefreq>monthly</changefreq><priority>0.2</priority></url>`,
        `<url><loc>${base}/privacy</loc><changefreq>monthly</changefreq><priority>0.2</priority></url>`,
        `<url><loc>${base}/refunds</loc><changefreq>monthly</changefreq><priority>0.2</priority></url>`,
      ];
      for (const m of ms) {
        const done = m.result && m.result.status === 'final';
        const pr = done ? '0.4' : '0.8', cf = done ? 'weekly' : 'hourly';
        urls.push(`<url><loc>${base}/pronostico/${m.slug.es}</loc><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`);
        urls.push(`<url><loc>${base}/prediction/${m.slug.en}</loc><changefreq>${cf}</changefreq><priority>${pr}</priority></url>`);
      }
      // Cards públicas de jugador (muestra confiable del torneo): ES + EN.
      const seenPlayerSlug = new Set();
      try {
        for (const slug of Object.keys(seoPlayers())) {
          seenPlayerSlug.add(slug);
          urls.push(`<url><loc>${base}/jugador/${slug}</loc><changefreq>daily</changefreq><priority>0.6</priority></url>`);
          urls.push(`<url><loc>${base}/player/${slug}</loc><changefreq>daily</changefreq><priority>0.6</priority></url>`);
        }
      } catch { /* sitemap sin jugadores si el fit no está */ }
      // GAP-AUDIT 2: cards de jugador de CLUB (sin duplicar slugs que ya sirve el Mundial).
      try {
        for (const slug of Object.keys(seoClubPlayers())) {
          if (seenPlayerSlug.has(slug)) continue;
          urls.push(`<url><loc>${base}/jugador/${slug}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`);
          urls.push(`<url><loc>${base}/player/${slug}</loc><changefreq>weekly</changefreq><priority>0.5</priority></url>`);
        }
      } catch { /* sitemap sin jugadores de club si el fit no está */ }
      res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`);
    }
    if (p === '/pronosticos' || p === '/predictions') {
      const lang = p === '/pronosticos' ? 'es' : 'en';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' });
      return res.end(seoIndexHtml(lang));
    }
    if (p.startsWith('/pronostico/') || p.startsWith('/prediction/')) {
      const lang = p.startsWith('/pronostico/') ? 'es' : 'en';
      const slug = decodeURIComponent(p.split('/')[2] || '').toLowerCase();
      const m = seoMatches().find(x => x.slug[lang] === slug) || seoMatches().find(x => x.slug.es === slug || x.slug.en === slug);
      if (!m) { res.writeHead(302, { Location: lang === 'es' ? '/pronosticos' : '/predictions' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=120' });
      return res.end(seoMatchHtml(m, lang));
    }
    // CARDS PÚBLICAS DE JUGADOR (SEO): /jugador/<slug> (ES) · /player/<slug> (EN). Server-rendered.
    if (p.startsWith('/jugador/') || p.startsWith('/player/')) {
      const lang = p.startsWith('/jugador/') ? 'es' : 'en';
      const slug = decodeURIComponent(p.split('/')[2] || '').toLowerCase();
      const pl = seoPlayers()[slug];
      try {
        if (pl) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
          return res.end(seoPlayerHtml(pl, lang));
        }
        // GAP-AUDIT 2: fallback a jugador de CLUB (mismo slug), si no era del Mundial
        const ce = seoClubPlayers()[slug];
        const chtml = ce ? seoClubPlayerHtml(ce, lang) : null;
        if (chtml) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
          return res.end(chtml);
        }
        res.writeHead(302, { Location: lang === 'es' ? '/pronosticos' : '/predictions' }); return res.end();
      } catch { json(res, 404, { error: 'No encontrado' }); return; }
    }
    // LEGALES (públicas, sin gating — deben ser accesibles antes de pagar): una sola página con secciones.
    if (p === '/terms' || p === '/privacy' || p === '/refunds' || p === '/legal') {
      try {
        const lf = path.join(__dirname, 'public', 'legal.html');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, must-revalidate' });
        return res.end(fs.readFileSync(lf, 'utf8'));
      } catch { json(res, 404, { error: 'No encontrado' }); return; }
    }
    // Landing standalone (página de marketing dedicada, sin el shell de la app). Cache-busting de landing.js/css por mtime.
    if (p === '/landing' || p === '/landing/') {
      try {
        const lf = path.join(__dirname, 'public', 'landing.html');
        const vjs = Math.floor(fs.statSync(path.join(__dirname, 'public', 'landing.js')).mtimeMs);
        let html = fs.readFileSync(lf, 'utf8').replace('src="/landing.js"', `src="/landing.js?v=${vjs}"`).replace('</head>', `<script>window.__GPDL=${JSON.stringify(defaultLang())};window.__GPL3=${landingV3On()}</script></head>`);
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
      // imágenes sí se cachean. EXCEPCIÓN: /vendor, /fonts y /flags son inmutables (assets versionados que no
      // cambian entre deploys) → cache larga; clave para conexiones lentas (el css de íconos pesa ~250KB).
      const immutableAsset = /^\/(vendor|fonts|flags|books)\//.test(p);
      const cache = immutableAsset
        ? 'public, max-age=2592000, immutable'
        : ['.html', '.js', '.css'].includes(ext)
          ? 'no-cache, must-revalidate'
          : 'public, max-age=86400';
      const hdrsOut = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': cache,
        'Last-Modified': fs.statSync(full).mtime.toUTCString(),
      };
      // /ig/* con CORS: assets de contenido (PNG/JPG de redes) consumibles por herramientas creativas externas
      // (p.ej. fetch desde el editor de un generador de video). Solo lectura de imágenes públicas.
      if (/^\/ig\//.test(p)) hdrsOut['Access-Control-Allow-Origin'] = '*';
      res.writeHead(200, hdrsOut);
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
  // FASE CLUBES (shadow): cuotas de clubes a las tablas de la casa. Gate por env dentro del sweep
  // (GP_CLUBS_SHADOW_ENABLED); throttle interno 30 min — el intervalo solo "pregunta" (cada 10 min).
  setTimeout(() => { clubsQuotesSweep().catch(e => console.error('[clubs] sweep:', e.message)); }, 90 * 1000);
  setInterval(() => { clubsQuotesSweep().catch(e => console.error('[clubs] sweep:', e.message)); }, 10 * 60 * 1000);
  // props de clubes (córners/tarjetas/assists/anytime): throttle interno 3h, eventos <48h; el intervalo pregunta c/30min
  setTimeout(() => { clubsPlayerPropsSweep().catch(e => console.error('[clubs] props:', e.message)); }, 150 * 1000);
  setInterval(() => { clubsPlayerPropsSweep().catch(e => console.error('[clubs] props:', e.message)); }, 30 * 60 * 1000);
  // Cloudbet (crypto sportsbook): fusión de cuotas como una casa más. Gated tras CLOUDBET_API_KEY (sin key =
  // no-op). Throttle interno 20min; el intervalo pregunta cada 10min. Corre tras el sweep de cuotas (necesita
  // db.clubsQuoteEvents ya poblado para matchear).
  if (process.env.CLOUDBET_API_KEY) {
    setTimeout(() => { cloudbetSweep().catch(e => console.error('[cloudbet]', e.message)); }, 210 * 1000);
    setInterval(() => { cloudbetSweep().catch(e => console.error('[cloudbet]', e.message)); }, 10 * 60 * 1000);
  }
  // FASE CLUBES (shadow): marcadores en vivo/finalizados desde ESPN por liga, cada 30 s (como el Mundial).
  // Gate por env dentro de la función; ESPN es gratis. Arranca a los 20 s (deja al boot respirar).
  setTimeout(() => { clubScoresSync().catch(e => console.error('[clubs] scores:', e.message)); }, 20 * 1000);
  setInterval(() => { clubScoresSync().catch(e => console.error('[clubs] scores:', e.message)); }, 30 * 1000);
  // F0.3: snapshot de la liga (posición/Elo) para la Evolución — al boot y cada 6h (dedupe por día).
  setTimeout(() => { try { clubHistorySnapshot(); } catch (e) { console.error('[clubs] history:', e.message); } }, 120 * 1000);
  setInterval(() => { try { clubHistorySnapshot(); } catch (e) { console.error('[clubs] history:', e.message); } }, 6 * 3600 * 1000);
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
  // Motores de contexto y goles con CADENCIA ADAPTATIVA (2-jul): los loops pre-computan snapshots — la navegación
  // del usuario NO depende de ellos (fetch-on-demand con sus caches). API-Football quema ~300 req/h a cadencia
  // fija de 20 min → el límite diario (7500, plan Pro) se agotaba casi a diario. Modo por ventana de partido:
  //   NORMAL (20 min): desde GP_LOOP_PREMATCH_MIN (75) antes de cada kickoff hasta +150 min (partido completo)
  //   ECO (75 min):    el resto (madrugada/huecos) — el contexto no cambia cuando no pasa nada
  // El pase de arranque post-deploy solo corre en NORMAL (los snapshots persisten en DB; un boot en horas muertas
  // no re-quema cuota). GP_LOOP_ADAPTIVE_ENABLED=false revierte a 20 min fijos. SHADOW, aislado/best-effort.
  const loopAdaptiveOn = !/^(0|false|no|off)$/i.test(String(process.env.GP_LOOP_ADAPTIVE_ENABLED || 'true').trim());
  const LOOP_NORMAL_MS = (parseInt(process.env.GP_LOOP_NORMAL_MIN, 10) || 20) * 60 * 1000;
  const LOOP_ECO_MS = (parseInt(process.env.GP_LOOP_ECO_MIN, 10) || 75) * 60 * 1000;
  const LOOP_PRE_MS = (parseInt(process.env.GP_LOOP_PREMATCH_MIN, 10) || 75) * 60 * 1000;
  const LOOP_POST_MS = (parseInt(process.env.GP_LOOP_POSTKO_MIN, 10) || 150) * 60 * 1000;
  function loopModeNow() {
    if (!loopAdaptiveOn) return 'normal';
    try {
      const now = Date.now();
      // horarios REALES de ESPN si ya llegaron (syncFromESPN corre al boot y cada 30s); si no, calendario propio.
      let times = espnKickoffs;
      if (!times.length) {
        times = [];
        for (const f of GROUP_FIXTURES) if (f.datetime) times.push(+new Date(f.datetime));
        for (const k of KNOCKOUT) times.push(+new Date(k.datetime || (k.date + 'T18:00Z')));
      }
      for (const ko of times) {
        if (isFinite(ko) && now >= ko - LOOP_PRE_MS && now <= ko + LOOP_POST_MS) return 'normal';
      }
      return 'eco';
    } catch { return 'normal'; } // ante la duda, no degradar
  }
  try {
    let lastLoopMode = null;
    const dueRunner = (name, fn) => {
      let last = 0;
      return {
        boot() { if (loopModeNow() === 'normal') { last = Date.now(); fn(); } },
        tick() {
          const mode = loopModeNow();
          if (mode !== lastLoopMode) { console.log('[loops] modo', mode, '(intervalo', (mode === 'eco' ? LOOP_ECO_MS : LOOP_NORMAL_MS) / 60000, 'min)'); lastLoopMode = mode; }
          const iv = mode === 'eco' ? LOOP_ECO_MS : LOOP_NORMAL_MS;
          if (Date.now() - last >= iv) { last = Date.now(); fn(); }
        },
      };
    };
    const runners = [];
    if (contextEngineOn()) {
      const runCtx = () => evaluateUpcomingContext({ limit: 60 }).then(r => console.log('[context-engine]', JSON.stringify(r))).catch(() => { });
      const rc = dueRunner('context', runCtx); runners.push(rc);
      setTimeout(() => rc.boot(), 40 * 1000);
    }
    // GOLES (G2): pase de goles independiente. Corre tras el de contexto (cache de buildH2HDeep caliente → barato).
    if (goalEngineOn()) {
      const runGoals = () => evaluateUpcomingGoals({ limit: 60 }).then(r => console.log('[goal-engine]', JSON.stringify(r))).catch(() => { });
      const rg = dueRunner('goals', runGoals); runners.push(rg);
      setTimeout(() => rg.boot(), 55 * 1000);
    }
    // tick cada 4 min: cada runner corre cuando su intervalo (según modo) vence. Stagger de 75s entre runners
    // para no lanzar los dos pases a la vez (buildH2HDeep comparte cache → el segundo es barato si va después).
    if (runners.length) setInterval(() => { runners.forEach((r, i) => setTimeout(() => r.tick(), i * 75 * 1000)); }, 4 * 60 * 1000);
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
