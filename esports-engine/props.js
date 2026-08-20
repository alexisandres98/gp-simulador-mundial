// esports-engine/props.js — PROPS DE JUGADOR: PROYECCIÓN PROPIA CONTRA LIBRO BLANDO, EN SOMBRA (17-ago).
//
// LA TESIS (del análisis de LCS Larry, 17-ago). El flanco blando del mercado de esports no es el ganador
// de la serie —ahí GP ya midió pérdidas y la puerta está cerrada— sino los props de jugador en libros
// estilo DFS: publican "kills en mapas 1-2" por jugador, con precio por pierna, y mueven la línea tarde.
// GP tiene lo que hace falta para atacarlo con base medida y no con supuestos: scoreboard PROPIO de cada
// jugador de CS2 (ventana 180 días, por mapa, con últimos 12 mapas fila a fila).
//
// LO QUE ESTO **NO** ES, escrito antes que nada:
//   · NO toca el ejecutor en la sombra de la casa (bankroll $2.000, `cards_under_v1`, revisión del
//     domingo 23). Este archivo tiene su propio registro, su propio archivo en disco y cero contacto
//     con la lógica de decisión congelada.
//   · NO publica picks. Todo lo que pasa el listón se ANOTA en su sombra propia y se liquida solo, para
//     acumular muestra. Publicar algo aquí exige lo mismo que en el resto de la casa: muestra fuera de
//     muestra que lo aguante, revisada con Alexis.
//   · Solo CS2 proyecta. LoL y Valorant se LISTAN (para ver el mercado) pero sin proyección: no hay base
//     propia de jugador en esos títulos y no se disimula.
//
// EL MODELO, deliberadamente simple y declarado entero en `provenance`:
//   kills esperadas (mapas 1-2) = kpr encogido × rondas esperadas de 2 mapas
//     · kpr encogido: (kpr·rondas + kpr_poblacional·250) / (rondas + 250) — un jugador con 3.000 rondas
//       es casi él; uno con 400 va medio camino a la media. La constante es criterio, no ajuste fino.
//     · rondas esperadas: media RECIENTE medida del pool propio (~21,4 por mapa), no el 22,06 asumido.
//   dispersión = desviación típica de sus kills por mapa (últimos 12) × √2, con suelo poissoniano.
//   P(over) con normal. Ventaja = P(lado) − listón del precio (1/decimal); sin precio por pierna, el
//   listón honesto del pick'em es 50 % y se marca como tal.
//
// LOS VETOS, heredados de las lecciones de la casa:
//   · `muestra_corta`        — menos de 6 mapas recientes o menos de 500 rondas de ventana: no se proyecta.
//   · `ventaja_no_creible`   — ventaja > 20 pp. La lección de LoL (37,83 pp que eran un fallo de lectura):
//                              una ventaja así contra una casa nunca es ventaja, es error propio.
//   · `stat_no_modelada`     — headshots, asistencias, fantasy points: se listan, no se proyectan.
'use strict';

const fs = require('fs');
const path = require('path');
const UD = require('../data-providers/esports/underdog');
const CD = require('./cs2-data');

// El mismo criterio de disco que el resto de esports: histórico al disco persistente (sobrevive deploys);
// sin él (desarrollo local), al repo.
const DISK_DIR = path.join(path.dirname(process.env.DB_FILE || path.join(__dirname, '..', 'db.json')), 'esports');
const REPO_DIR = path.join(__dirname, '..', 'data', 'esports');
const DIR = (() => { try { fs.mkdirSync(DISK_DIR, { recursive: true }); return DISK_DIR; } catch { return REPO_DIR; } })();
const FILE = 'props-cs2.json';
const rd = () => { try { return JSON.parse(fs.readFileSync(path.join(DIR, FILE), 'utf8')); } catch { return { picks: {} }; } };
const wr = (o) => { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, FILE), JSON.stringify(o)); return true; } catch { return false; } };

const G = global._esprops = global._esprops || { board: null, at: 0 };
const BOARD_TTL = 10 * 60e3;

const SHRINK_ROUNDS = 250;
const MIN_RECENT_MAPS = 6;
const MIN_ROUNDS = 500;
// ── LA REGLA, CONGELADA (20-ago) ─────────────────────────────────────────────────────────────────────────
// Mismo criterio que `cards_under_v1` en el ejecutor de la casa: la regla se escribe, se fecha y NO se
// vuelve a tocar mientras se acumula la muestra. Cambiarla a mitad de la ventana destruye lo único que la
// ventana produce, que es una muestra comparable.
//
// v1 entraba desde 6 pp. Era demasiado bajo para esta familia y por dos razones distintas: Underdog es un
// libro DFS que cobra por pierna a −112 (listón 52,83 %), así que 6 pp de ventaja bruta dejan muy poco
// después del listón; y la proyección de kills a dos mapas tiene una dispersión propia grande (sigma de 5
// a 10 kills), de modo que a 6 pp la mitad de lo que entra es ruido con nombre. v2 sube a 10 pp y ahí se
// queda. Cada tesis anotada guarda con qué versión y con qué listón nació, para poder comparar después
// sin depender de la memoria.
const RULE = {
  version: 'props_cs2_v2',
  frozen_at: '2026-08-20',
  edge_min: 0.10,
  edge_cap: 0.20,
  note: 'listón de entrada 10 pp sobre el precio, veto por encima de 20 pp. Congelado: no se toca mientras se acumula muestra. v1 (6 pp, del 17-ago) queda anulada junto con sus liquidaciones, que salieron de una base rota.',
};
// versión del LIQUIDADOR (distinta de la versión de la regla: una dice cómo se decide entrar, la otra cómo
// se decide el resultado). Al subirla, `reopenLegacySettled` rehace todo lo liquidado con versiones viejas.
const SETTLE_VERSION = 'v3';
const EDGE_MIN = RULE.edge_min;
const EDGE_CAP = RULE.edge_cap;
const MODELED = new Set(['kills_on_maps_1_2', 'headshots_on_maps_1_2']);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

// ---- la base propia, indexada una vez por carga ---------------------------------------------------------
function ownBase() {
  const data = CD.load();
  const ps = data.playerStats || {};
  // nick normalizado → slug. Los nicks colisionan poco; si dos jugadores comparten nick normalizado se
  // descarta la entrada entera: adivinar identidades es como se liquidan props del jugador equivocado.
  const byNick = new Map();
  const dupes = new Set();
  for (const [slug, p] of Object.entries(ps)) {
    const k = norm(p.nick || slug);
    if (!k) continue;
    if (byNick.has(k) && byNick.get(k) !== slug) { dupes.add(k); continue; }
    byNick.set(k, slug);
  }
  for (const k of dupes) byNick.delete(k);
  // slug de jugador → equipo (por los cincos de rosters)
  const teamOf = new Map();
  for (const [tid, r] of Object.entries(data.rosters || {})) {
    for (const f of (r && r.five) || []) if (f && f.id) teamOf.set(f.id, tid);
  }
  // medias poblacionales ponderadas por rondas — las anclas del encogimiento
  let kprSum = 0, rSum = 0, dprSum = 0, dprW = 0, hsSum = 0, hsW = 0;
  for (const p of Object.values(ps)) {
    if (p.kpr && p.rounds) { kprSum += p.kpr * p.rounds; rSum += p.rounds; }
    if (p.dpr && p.rounds) { dprSum += p.dpr * p.rounds; dprW += p.rounds; }
    if (p.hs_pct != null && p.rounds) { hsSum += p.hs_pct * p.rounds; hsW += p.rounds; }
  }
  const popKpr = rSum ? kprSum / rSum : 0.66;
  const popDpr = dprW ? dprSum / dprW : 0.70;
  const popHs = hsW ? hsSum / hsW : 0.45;
  // rondas medias RECIENTES del pool activo, medidas por la casa
  let mr = 0, mn = 0;
  for (const m of Object.values(data.maps || {})) {
    if (m && m.in_pool && m.recent_mean_rounds) { mr += m.recent_mean_rounds * (m.recent_n || 1); mn += (m.recent_n || 1); }
  }
  const expRounds = mn ? mr / mn : 21.4;
  return { data, ps, byNick, teamOf, popKpr, popDpr, popHs, expRounds };
}

// ---- factor rival, MEDIDO desde la base propia ----------------------------------------------------------
// Las kills de un jugador salen de las muertes del rival: un cinco rival que muere más por ronda (dpr alto)
// regala más kills. El factor es la media de dpr del cinco rival contra la media poblacional, con dos
// frenos honestos: se exige el cinco casi entero medido (≥3 jugadores) y se recorta a ±12 % — el resolvedor
// de equipos puede confundir filiales (MOUZ→MOUZ NXT, comprobado) y un factor recortado limita el daño de
// una identidad equivocada.
function rivalFactor(rivalName, base) {
  try {
    const CDm = require('./cs2-data');
    const rid = rivalName ? CDm.resolveTeam(rivalName) : null;
    if (!rid) return null;
    const five = ((base.data.rosters[rid] || {}).five) || [];
    const dprs = five.map((f) => (base.ps[f.id] || {}).dpr).filter((x) => Number.isFinite(x));
    if (dprs.length < 3) return null;
    const avg = dprs.reduce((a, b) => a + b, 0) / dprs.length;
    return Math.max(0.88, Math.min(1.12, avg / base.popDpr));
  } catch { return null; }
}

// ---- proyección de un jugador para "kills en mapas 1-2" -------------------------------------------------
function projectKills12(p, base, factor) {
  if (!p) return null;
  if ((p.rounds || 0) < MIN_ROUNDS) return { veto: 'muestra_corta', why: `${p.rounds || 0} rondas en ventana (< ${MIN_ROUNDS})` };
  const recent = (p.recent || []).filter((r) => Number.isFinite(r.k));
  if (recent.length < MIN_RECENT_MAPS) return { veto: 'muestra_corta', why: `${recent.length} mapas recientes (< ${MIN_RECENT_MAPS})` };
  const kprHat = ((p.kpr || 0) * p.rounds + base.popKpr * SHRINK_ROUNDS) / (p.rounds + SHRINK_ROUNDS);
  const mu = kprHat * base.expRounds * 2 * (factor || 1);
  const ks = recent.map((r) => r.k);
  const mean = ks.reduce((a, b) => a + b, 0) / ks.length;
  const sd1 = Math.sqrt(ks.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, ks.length - 1));
  // suelo poissoniano ×1,15: los kills por mapa sobredispersan respecto a Poisson puro (rachas, cierres
  // 13-2, prórrogas), y un sigma optimista fabrica ventajas.
  const sigma = Math.max(sd1 * Math.SQRT2, Math.sqrt(mu) * 1.15, 4.0);
  return { mu: +mu.toFixed(2), sigma: +sigma.toFixed(2), kpr_hat: +kprHat.toFixed(4), recent_maps: recent.length,
    rival_factor: factor != null ? +factor.toFixed(3) : null };
}

// ---- headshots en mapas 1-2: derivada de la de kills ----------------------------------------------------
// mu_hs = mu_kills × proporción de headshot encogida. La dispersión hereda la de kills escalada (+10 % por
// la varianza extra de la proporción, aproximación declarada: la bitácora aún no trae hs fila a fila en
// todos los jugadores; desde la pasada del 18-ago sí, y con eso se liquida).
function projectHs12(p, base, factor) {
  const k = projectKills12(p, base, factor);
  if (!k || k.veto) return k;
  const hsHat = (((p.hs_pct != null ? p.hs_pct : base.popHs) * p.rounds) + base.popHs * SHRINK_ROUNDS) / (p.rounds + SHRINK_ROUNDS);
  const mu = k.mu * hsHat;
  const sigma = Math.max(k.sigma * hsHat * 1.1, Math.sqrt(mu) * 1.15, 3.0);
  return { mu: +mu.toFixed(2), sigma: +sigma.toFixed(2), hs_hat: +hsHat.toFixed(3), kpr_hat: k.kpr_hat,
    recent_maps: k.recent_maps, rival_factor: k.rival_factor };
}

// ---- la pizarra completa --------------------------------------------------------------------------------
async function board({ force = false } = {}) {
  if (G.board && !force && Date.now() - G.at < BOARD_TTL) return G.board;
  const lines = await UD.propLines();
  const base = ownBase();
  const rows = [];
  for (const l of lines.rows || []) {
    const row = {
      book: l.book, game: l.game, player: l.player_nick, stat: l.stat, stat_label: l.stat_label,
      line: l.line, line_type: l.line_type, sides: l.sides, match: l.match,
      slug: null, team: null, rival: null, proj: null, status: null, veto: null, why: null, best: null,
    };
    if (l.game !== 'cs2') { row.status = 'LISTADA'; row.veto = 'sin_base_propia'; row.why = 'GP no tiene scoreboard propio de jugador en este título todavía.'; rows.push(row); continue; }
    if (!MODELED.has(l.stat)) { row.status = 'LISTADA'; row.veto = 'stat_no_modelada'; row.why = 'solo kills en mapas 1-2 tiene modelo por ahora.'; rows.push(row); continue; }
    const slug = base.byNick.get(norm(l.player_nick));
    if (!slug) { row.status = 'LISTADA'; row.veto = 'jugador_no_resuelto'; row.why = 'el nick no casa con la base propia (180 días).'; rows.push(row); continue; }
    row.slug = slug;
    const tid = base.teamOf.get(slug) || null;
    row.team = tid ? ((base.data.teams[tid] || {}).name || tid) : null;
    // El rival se queda con el NOMBRE CRUDO del libro. Se comprobó en vivo que resolverlo es peligroso:
    // "MOUZ" del libro resolvía a MOUZ NXT (la trampa de las filiales, otra vez). El resolvedor solo se
    // usa para decidir QUÉ LADO del cruce es el equipo del jugador; el otro lado, tal cual lo escribe el
    // libro, es además lo que mejor casa con el `vs` de los logs propios en la liquidación.
    if (l.match && l.match.title && tid) {
      const parts = String(l.match.title).split(/\s+vs\.?\s+/i).map((s) => s.trim());
      if (parts.length === 2) {
        const ra = CD.resolveTeam(parts[0]), rb = CD.resolveTeam(parts[1]);
        let mine = ra === tid ? 0 : rb === tid ? 1 : null;
        if (mine == null) {
          const tn = norm(row.team || '');
          mine = tn && norm(parts[0]).includes(tn) ? 0 : tn && norm(parts[1]).includes(tn) ? 1 : null;
        }
        row.rival = mine != null ? parts[1 - mine] : null;
      }
    }
    const rf = rivalFactor(row.rival, base);
    const pr = l.stat === 'headshots_on_maps_1_2'
      ? projectHs12(base.ps[slug], base, rf)
      : projectKills12(base.ps[slug], base, rf);
    if (pr && pr.veto) { row.status = 'VETO'; row.veto = pr.veto; row.why = pr.why; rows.push(row); continue; }
    row.proj = pr;
    const pOver = 1 - phi((l.line - pr.mu) / pr.sigma);
    let best = null;
    const evalSides = [];
    for (const s of l.sides) {
      const pSide = s.side === 'over' ? pOver : 1 - pOver;
      const bar = s.price_dec ? 1 / s.price_dec : 0.5;   // sin precio por pierna, el listón honesto es 50 %
      const edge = pSide - bar;
      const ev = { side: s.side, price_dec: s.price_dec, american: s.american, p_gp: +pSide.toFixed(4), bar: +bar.toFixed(4), edge: +edge.toFixed(4) };
      evalSides.push(ev);
      if (!best || ev.edge > best.edge) best = ev;
    }
    row.p_over = +pOver.toFixed(4);
    row.sides = evalSides;
    row.best = best;
    if (best && best.edge > EDGE_CAP) { row.status = 'VETO'; row.veto = 'ventaja_no_creible'; row.why = `${(best.edge * 100).toFixed(1)} pp contra una casa no es ventaja: es un fallo de lectura propio.`; }
    else if (best && best.edge >= EDGE_MIN) { row.status = 'SOMBRA'; }
    else { row.status = 'SIN_VENTAJA'; }
    rows.push(row);
  }
  // primero lo accionable, luego por hora de la serie
  const ord = { SOMBRA: 0, SIN_VENTAJA: 1, VETO: 2, LISTADA: 3 };
  rows.sort((a, b) => (ord[a.status] - ord[b.status]) || (Date.parse((a.match || {}).start_at || 0) - Date.parse((b.match || {}).start_at || 0)));
  const out = {
    available: !!lines.available, book: lines.book, at: lines.at, rows,
    n: rows.length,
    counts: rows.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {}),
    provenance: {
      lineas: 'Underdog (libro blando DFS), endpoint público, precio por pierna cuando lo publica.',
      proyeccion: `kpr encogido (ancla poblacional ${base.popKpr.toFixed(3)}, K=${SHRINK_ROUNDS} rondas) × ${(base.expRounds * 2).toFixed(1)} rondas esperadas en 2 mapas (media reciente medida del pool propio). Dispersión: sd de sus últimos 12 mapas × √2 con suelo poissoniano ×1,15. Headshots: la de kills × proporción de headshot encogida.`,
      ajuste_rival: `medido desde la base propia: media de dpr del cinco rival contra la poblacional (${base.popDpr.toFixed(3)}), exigiendo ≥3 jugadores medidos y recortado a ±12 % porque el resolvedor puede confundir filiales.`,
      listones: `regla ${RULE.version} (congelada el ${RULE.frozen_at}): sombra desde ${(EDGE_MIN * 100).toFixed(0)} pp sobre el listón del precio; veto por encima de ${(EDGE_CAP * 100).toFixed(0)} pp.`,
      doctrina: 'familia EN SOMBRA: se anota y se liquida sola, no se publica como pick. Separada por completo del ejecutor en la sombra de la casa.',
    },
  };
  G.board = out; G.at = Date.now();
  recordShadow(out);
  return out;
}

// ---- la sombra propia -----------------------------------------------------------------------------------
// UNA anotación por TESIS (día del cruce, jugador, stat, lado) — no por línea. La lección de las 29 "picks"
// que eran 8 opiniones: el mismo over de REZ a 27,5 / 32,5 / 34,5 es UNA tesis en tres precios, y anotarla
// tres veces infla la muestra con copias correladas. De cada tesis se queda la línea de MÁS ventaja, y la
// PRIMERA lectura — la ventaja de un libro lento se mide contra la línea que publicó, no contra la que
// corrige después.
function recordShadow(bd) {
  try {
    const st = rd();
    let added = 0;
    const byThesis = new Map();
    for (const r of bd.rows || []) {
      if (r.status !== 'SOMBRA' || !r.best || !r.match || !r.slug) continue;
      if (!r.match.start_at || Date.parse(r.match.start_at) < Date.now()) continue;  // solo series futuras
      const day = String(r.match.start_at).slice(0, 10);
      const tk = `${day}|${r.slug}|${r.stat}|${r.best.side}`;
      const prev = byThesis.get(tk);
      if (!prev || r.best.edge > prev.best.edge) byThesis.set(tk, r);
    }
    for (const r of byThesis.values()) {
      const day = String(r.match.start_at).slice(0, 10);
      const key = `${day}|${r.slug}|${r.stat}|${r.best.side}`;
      if (st.picks[key]) continue;
      st.picks[key] = {
        key, game: 'cs2', book: r.book, day,
        slug: r.slug, player: r.player, team: r.team, rival: r.rival,
        stat: r.stat, stat_label: r.stat_label, line: r.line, side: r.best.side,
        price_dec: r.best.price_dec, american: r.best.american,
        p_gp: r.best.p_gp, bar: r.best.bar, edge: r.best.edge,
        mu: r.proj.mu, sigma: r.proj.sigma,
        start_at: r.match.start_at, match_title: (r.match || {}).title || null,
        recorded_at: new Date().toISOString(), status: 'ACTIVE',
        rule_version: RULE.version, rule_edge_min: RULE.edge_min,
      };
      added++;
    }
    const closes = updateCloses(bd, st);
    if (added || closes) { st.at = new Date().toISOString(); wr(st); }
    return added;
  } catch { return 0; }
}

// El CIERRE de cada tesis activa, refrescado en cada barrido. Es la métrica de la casa: la ventaja de
// verdad se mide contra la ÚLTIMA línea que el libro publicó antes del inicio (CLV), no contra el
// resultado de una serie. Se guarda la línea del libro más cercana a la anotada, con su precio y su
// listón; la última pasada antes del inicio queda como cierre.
function updateCloses(bd, st) {
  let changed = 0;
  const now = Date.now();
  for (const pk of Object.values(st.picks || {})) {
    if (pk.status !== 'ACTIVE' || !pk.start_at || Date.parse(pk.start_at) < now) continue;
    let bestRow = null, bestDiff = Infinity;
    for (const r of bd.rows || []) {
      if (r.game !== 'cs2' || r.slug !== pk.slug || r.stat !== pk.stat || !r.match) continue;
      if (String(r.match.start_at || '').slice(0, 10) !== pk.day) continue;
      const diff = Math.abs(r.line - pk.line);
      if (diff < bestDiff) { bestDiff = diff; bestRow = r; }
    }
    const sv = bestRow && (bestRow.sides || []).find ? (bestRow.sides || []).find((s) => s.side === pk.side) : null;
    if (!sv) continue;
    pk.close_line = bestRow.line;
    pk.close_price_dec = sv.price_dec || null;
    pk.close_bar = sv.bar != null ? sv.bar : (sv.price_dec ? +(1 / sv.price_dec).toFixed(4) : null);
    pk.close_p_gp = sv.p_gp != null ? sv.p_gp : null;
    pk.close_edge = sv.edge != null ? sv.edge : null;
    pk.close_at = new Date().toISOString();
    changed++;
  }
  return changed;
}

// LIQUIDACIÓN DESDE LA BASE PROPIA — REHECHA EL 20-ago.
//
// La versión anterior filtraba la bitácora del jugador por fecha (±36 h) y rival y se quedaba con "las dos
// últimas filas del montón", asumiendo que el montón era UNA serie y que venía en orden cronológico. Las
// dos cosas eran falsas: ±36 h abarca tres días de calendario y se tragaba series enteras (se vieron grupos
// de 3, 5 y hasta 10 filas), y el orden del log no era cronológico sino de inserción de la cosecha. El
// resultado eran sumas imposibles para dos mapas —44, 51 kills— contra líneas de 27,5 y 31,5.
//
// Ahora la bitácora trae `mid` (serie) y `num` (número de mapa), así que la serie se identifica en vez de
// adivinarse: se agrupa por serie, se elige la serie del cruce y se toman los mapas 1 y 2 POR SU NÚMERO.
// Cuando la identidad de la serie no se puede establecer, esto NO liquida: anula y lo dice. Una prop
// liquidada contra los mapas equivocados es peor que una prop sin liquidar, porque entra en la muestra.
function settleShadow() {
  const st = rd();
  const base = ownBase();
  let settled = 0, voided = 0;
  const now = Date.now();
  for (const pk of Object.values(st.picks || {})) {
    if (pk.status !== 'ACTIVE') continue;
    const started = Date.parse(pk.start_at || 0);
    if (!started || now - started < 6 * 3600e3) continue;   // la serie tiene que haber terminado
    const p = base.ps[pk.slug];
    const field = pk.stat === 'headshots_on_maps_1_2' ? 'hs' : 'k';
    const casaRival = (r) => (pk.rival
      ? norm(r.vs) === norm(pk.rival) || norm(r.vs).includes(norm(pk.rival)) || norm(pk.rival).includes(norm(r.vs))
      : true);
    // ventana estrecha: la referencia es el SAQUE de la serie, no el día suelto, y ±20 h ya cubre cualquier
    // huso sin abarcar el día siguiente entero
    const cerca = (r) => {
      const t = Date.parse(r.ts || r.at || 0);
      if (!Number.isFinite(t)) return false;
      const ref = Number.isFinite(started) ? started : Date.parse(pk.day);
      return Math.abs(t - ref) <= 20 * 3600e3;
    };
    const cand = ((p && p.recent) || []).filter((r) => r && Number.isFinite(r.k) && cerca(r) && casaRival(r));

    // agrupar por serie. Sin `mid` (bitácora vieja) la serie no se puede identificar y el grupo entero
    // queda como una sola candidata "sin identificar".
    const series = new Map();
    for (const r of cand) {
      const k = r.mid != null ? 'm' + r.mid : 'sin_id';
      if (!series.has(k)) series.set(k, []);
      series.get(k).push(r);
    }
    let elegida = null, motivo = null;
    const conId = [...series.entries()].filter(([k]) => k !== 'sin_id');
    if (conId.length === 1) { elegida = conId[0][1]; motivo = 'serie identificada'; }
    else if (conId.length > 1) {
      // dos series del mismo jugador contra el mismo rival en la ventana: se queda la que empieza más cerca
      // del saque anotado, y solo si la otra está claramente más lejos. Si empatan, no se liquida.
      const dist = (g) => Math.min(...g.map((r) => Math.abs(Date.parse(r.ts || r.at || 0) - started)));
      const ord = conId.map(([, g]) => ({ g, d: dist(g) })).sort((a, b) => a.d - b.d);
      if (ord[1].d - ord[0].d >= 4 * 3600e3) { elegida = ord[0].g; motivo = 'serie más cercana al saque'; }
      else motivo = 'dos series indistinguibles en la ventana';
    } else if (series.has('sin_id')) {
      const g = series.get('sin_id');
      // bitácora vieja: solo se acepta cuando el grupo ES la serie de dos mapas. Con tres o más filas no
      // hay forma de saber cuáles son los mapas 1 y 2 y no se inventa.
      if (g.length === 2) { elegida = g; motivo = 'bitácora sin identificador de serie, grupo de dos mapas'; }
      else motivo = `bitácora sin identificador de serie y ${g.length} mapas en la ventana`;
    }

    let dos = null;
    if (elegida) {
      const conNum = elegida.filter((r) => Number.isFinite(r.num));
      if (conNum.length >= 2) {
        dos = conNum.slice().sort((a, b) => a.num - b.num).filter((r) => r.num <= 2);
        if (dos.length !== 2) { dos = null; motivo = 'la serie no trae los mapas 1 y 2 numerados'; }
      } else if (elegida.length === 2) {
        dos = elegida.slice().sort((a, b) => Date.parse(a.ts || a.at || 0) - Date.parse(b.ts || b.at || 0));
        motivo += ' (sin numeración: serie de dos mapas)';
      } else { dos = null; motivo = 'la serie no trae numeración de mapa y tiene más de dos'; }
    }

    if (dos && dos.every((r) => Number.isFinite(r[field]))) {
      const actual = dos.reduce((a, r) => a + r[field], 0);
      const win = pk.side === 'over' ? actual > pk.line : actual < pk.line;
      pk.actual = actual;
      pk.maps_counted = 2;
      pk.maps_in_window = cand.length;
      pk.settle_basis = 'scoreboard propio · ' + motivo + ' · mapas 1 y 2 por número';
      // LAS DOS FILAS QUE SE SUMARON, ESCRITAS EN LA PICK. El comentario prometía auditabilidad y solo
      // guardaba una frase; una suma de 56 kills en dos mapas hay que poder comprobarla sin adivinar.
      pk.settle_rows = dos.map((r) => ({ at: r.ts || r.at, mid: r.mid != null ? r.mid : null,
        num: r.num != null ? r.num : null, map: r.map, vs: r.vs, k: r.k, hs: r.hs }));
      pk.settle_version = SETTLE_VERSION;
      pk.status = win ? 'WIN' : 'LOSS';
      pk.settled_at = new Date().toISOString();
      settled++;
    } else if (now - started > 7 * 86400e3) {
      // una semana sin poder identificar la serie: se anula EN VEZ de liquidar contra el montón
      pk.status = 'VOID';
      pk.void_why = motivo || (cand.length ? 'la bitácora no trae la stat de esa serie' : 'la serie no aparece en el log propio');
      pk.maps_in_window = cand.length;
      pk.settle_version = SETTLE_VERSION;
      pk.settled_at = new Date().toISOString();
      voided++;
    }
  }
  if (settled || voided) { st.at = new Date().toISOString(); wr(st); }
  return { settled, voided };
}

// REAPERTURA DE LO LIQUIDADO CON LA BASE ROTA (20-ago). Las 60 primeras liquidaciones salieron del montón,
// no de la serie: sus `actual` no son de dos mapas y por tanto su WIN/LOSS no significa nada. Se devuelven a
// ACTIVE para que el liquidador nuevo las rehaga; las que ya no estén en la bitácora (el log guarda 12
// mapas por jugador) acabarán en VOID con su motivo, que es la respuesta honesta.
function reopenLegacySettled() {
  const st = rd();
  let n = 0;
  for (const pk of Object.values(st.picks || {})) {
    if (pk.settle_version === SETTLE_VERSION) continue;
    if (pk.status !== 'WIN' && pk.status !== 'LOSS' && pk.status !== 'VOID') continue;
    pk.status = 'ACTIVE';
    pk.reopened_at = new Date().toISOString();
    pk.reopened_why = `liquidada con el liquidador ${pk.settle_version || 'v1'}: se rehace con ${SETTLE_VERSION}`;
    delete pk.actual; delete pk.maps_counted; delete pk.settled_at; delete pk.void_why; delete pk.settle_rows;
    n++;
  }
  if (n) { st.at = new Date().toISOString(); wr(st); }
  return { reopened: n };
}

// `openOnly` calcula el CLV PROVISIONAL de las tesis todavía abiertas: el mismo cálculo, pero contra la
// última lectura del libro en vez de contra el cierre definitivo. Existe porque el CLV es lo que se lee
// ANTES de que haya resultados, y esperar a la primera liquidación para ver si el libro se mueve hacia
// nosotros deja la familia a ciegas justo en sus primeros días.
function perf(picks, { openOnly = false } = {}) {
  const closed = (p) => (openOnly ? p.status === 'ACTIVE' : p.status !== 'ACTIVE');
  const done = picks.filter((p) => p.status === 'WIN' || p.status === 'LOSS');
  const wins = done.filter((p) => p.status === 'WIN').length;
  const priced = done.filter((p) => p.price_dec);
  let units = 0;
  for (const p of priced) units += p.status === 'WIN' ? p.price_dec - 1 : -1;
  // CLV EN UN LIBRO DFS: el precio casi no se mueve, la LÍNEA sí (corregido el 17-ago tras mirar la sombra
  // en producción). Medido: 22 de 24 tesis anotadas al MISMO precio (1,893 → listón 0,5283) y 2 con la línea
  // ya movida. La versión anterior medía solo `close_bar − bar` y encima descartaba las tesis cuya línea
  // había cambiado: es decir, medía cero por construcción justo en los casos informativos. Underdog sí varía
  // precio de vez en cuando (se vieron 1,719 y 2,77), así que el componente de precio se conserva — pero
  // aparte, no como la métrica entera.
  //
  // El CLV de esta familia tiene DOS componentes y se publican los dos por separado:
  //   · línea  = P(nuestro lado en la línea anotada) − P(nuestro lado en la línea de cierre), las dos con la
  //              proyección CONGELADA del momento de anotar (mu/sigma guardados en la tesis). Congelarla es
  //              lo que aísla el movimiento del libro de la deriva de nuestro propio modelo.
  //              Positivo = el libro se movió en contra de nuestro lado, o sea nos dejó la mejor línea.
  //   · precio = listón de cierre − listón de entrada, con la misma dirección.
  // El total es la suma, y es lo que el resto de la casa llama CLV.
  const withClose = picks.filter((p) => closed(p) && p.close_line != null && Number.isFinite(p.mu) && Number.isFinite(p.sigma));
  const pSideAt = (p, line) => {
    const over = 1 - phi((line - p.mu) / p.sigma);
    return p.side === 'over' ? over : 1 - over;
  };
  const clvLine = withClose.map((p) => pSideAt(p, p.line) - pSideAt(p, p.close_line));
  const priced2 = picks.filter((p) => closed(p) && p.bar != null && p.close_bar != null);
  const clvPrice = priced2.map((p) => p.close_bar - p.bar);
  const clvTot = withClose.map((p, i) => clvLine[i] + (p.bar != null && p.close_bar != null ? p.close_bar - p.bar : 0));
  const mean = (a) => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(4) : null);
  const movedN = withClose.filter((p) => p.close_line !== p.line).length;
  return {
    n: done.length, wins, losses: done.length - wins,
    hit: done.length ? +(wins / done.length).toFixed(4) : null,
    priced_n: priced.length,
    units: +units.toFixed(2),
    roi: priced.length ? +(units / priced.length).toFixed(4) : null,
    avg_edge: done.length ? +(done.reduce((a, p) => a + (p.edge || 0), 0) / done.length).toFixed(4) : null,
    clv_n: clvTot.length,
    avg_clv: mean(clvTot),
    clv_line_n: clvLine.length, avg_clv_line: mean(clvLine),
    clv_price_n: clvPrice.length, avg_clv_price: mean(clvPrice),
    lines_moved: movedN,
    clv_note: 'CLV = línea + precio. La línea se evalúa con la proyección congelada al anotar, así que mide el movimiento del libro y no la deriva del modelo. En un libro DFS el precio casi no se mueve: el componente que informa es la línea.',
  };
}

function track() {
  const st = rd();
  const all = Object.values(st.picks || {});
  const active = all.filter((p) => p.status === 'ACTIVE').sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
  const settledRows = all.filter((p) => p.status !== 'ACTIVE').sort((a, b) => Date.parse(b.settled_at || 0) - Date.parse(a.settled_at || 0));
  return {
    active, settled: settledRows.slice(0, 60), perf: perf(all),
    // provisional: el movimiento del libro en las tesis vivas, con la última lectura como cierre interino
    perf_open: perf(all, { openOnly: true }),
    voided: all.filter((p) => p.status === 'VOID').length,
    rule: RULE,
    // la muestra por versión de regla: v1 y v2 no son la misma familia y no se pueden sumar
    by_rule: (() => {
      const g = {};
      for (const p of all) { const k = p.rule_version || 'props_cs2_v1'; (g[k] = g[k] || []).push(p); }
      return Object.fromEntries(Object.entries(g).map(([k, v]) => [k, { n: v.length, ...perf(v) }]));
    })(),
    at: st.at || null,
    doctrine: 'Familia nueva EN SOMBRA (17-ago): proyección propia de kills (mapas 1-2, CS2) contra líneas de libro blando. Se anota y se liquida sola con el scoreboard propio; no publica picks y no toca el ejecutor en la sombra de la casa. Listón de salida: la muestra tiene que aguantar el mismo escrutinio que el resto de familias.',
  };
}

module.exports = { board, track, settleShadow, reopenLegacySettled, RULE, EDGE_MIN, EDGE_CAP };
